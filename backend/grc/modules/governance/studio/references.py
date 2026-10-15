"""What the AI may be given as reference: a library document (a parent or any other), a platform framework (all of it, some
domains or chosen controls), an uploaded file or a template.

A reference is turned into text *when it is attached* and that text is kept with the session, so every turn reads the same
words (and the provider's prompt cache can reuse them) and the person can see exactly what was provided. Text carrying
Secure Controls Framework prose is refused here, before it is ever part of a prompt (its licence does not allow AI use).
``verify_quote`` is how the studio checks the quotes the AI reports against what it was given.
"""
from __future__ import annotations

import os
import re
import tempfile
from typing import Any, Dict, List, Optional, Sequence, Tuple

MAX_REF_CHARS = 150_000                    # one reference
MAX_TOTAL_CHARS = 420_000                  # all references of a session in one prompt
KINDS = ("parent_document", "document", "framework", "upload", "template")


class ReferenceProblem(ValueError):
    """A reference that cannot be used; the message is for the person."""


def natural_key(text: str) -> List[Any]:
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text or "")]


def _cut(text: str, limit: int) -> Tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    head = text[:limit]
    return head[:max(head.rfind("\n\n"), limit // 2)].rstrip() + "\n\n[... the rest was left out: too long ...]", True


# ── sources ──────────────────────────────────────────────────────────────────
def library_text(db, doc) -> Tuple[str, List[str]]:
    """The text of a library document: its Markdown, else the text of its file."""
    if (doc.content or "").strip():
        return doc.content, []
    if doc.file_path and os.path.exists(doc.file_path):
        from .importers import import_file

        imported = import_file(doc.file_path, doc.file_name or doc.file_path)
        return imported.markdown, imported.notes
    raise ReferenceProblem("This document has no text to use as a reference.")


def framework_text(db, framework, scope: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """A framework's controls as compact text, grouped by domain and in natural order (A.5 before A.10)."""
    from ....models import ParsedFrameworkControl

    rows = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.uploaded_framework_id == framework.id).all()
    if not rows:
        raise ReferenceProblem("This framework has no parsed controls yet.")
    mode = scope.get("mode", "all")
    domains = {d.strip().lower() for d in scope.get("domains", []) if d}
    wanted = {r.strip().lower() for r in scope.get("control_refs", []) if r}
    query = [w for w in re.findall(r"\w+", (scope.get("query") or "").lower()) if len(w) > 3]
    picked = []
    for c in rows:
        ref = (c.original_reference or c.control_id or "").strip()
        hay = f"{c.title} {c.description or ''} {c.domain or ''}".lower()
        if mode == "domains" and (c.domain or "").strip().lower() not in domains:
            continue
        if mode == "controls" and ref.lower() not in wanted and (c.control_id or "").lower() not in wanted:
            continue
        if mode == "query" and not any(w in hay for w in query):
            continue
        picked.append((ref, c))
    if not picked:
        raise ReferenceProblem("No control of this framework matches that selection.")
    picked.sort(key=lambda rc: (natural_key(rc[1].domain or ""), natural_key(rc[0])))
    org = framework.source_organization or framework.regulatory_authority or ""
    lines = [f"FRAMEWORK: {framework.name}{' ' + framework.version if framework.version else ''}{' (' + org + ')' if org else ''}"]
    domain = object()
    for ref, c in picked:
        if c.domain != domain:
            domain = c.domain
            lines += ["", f"## {c.domain or 'General'}"]
        body = re.sub(r"\s+", " ", (c.description or c.full_text or "")).strip()
        lines.append(f"[{ref}] {c.title.strip()}" + (f" — {body[:450]}" + ("…" if len(body) > 450 else "") if body else ""))
    return "\n".join(lines), {"mode": mode, "domains": sorted(domains), "count": len(picked), "total": len(rows),
                              "refs": [ref for ref, _ in picked][:2000]}


def available_frameworks(db) -> List[Tuple[Any, int]]:
    """The platform frameworks that can be a reference, with how many controls each has: parsed, active, this organisation's or
    shared, and with controls. Ordered by name."""
    from sqlalchemy import func

    from ....models import ParsedFrameworkControl, Tenant, UploadedFramework

    tenant = db.query(Tenant).first()
    rows = (db.query(UploadedFramework).filter(UploadedFramework.is_active.is_(True),
                                               UploadedFramework.upload_status.in_(("parsed", "completed", "published", "classified")))
            .order_by(UploadedFramework.name).all())
    rows = [f for f in rows if f.tenant_id in (None, tenant.id if tenant else None) or f.is_shared]
    counts = dict(db.query(ParsedFrameworkControl.uploaded_framework_id, func.count(ParsedFrameworkControl.id))
                  .filter(ParsedFrameworkControl.uploaded_framework_id.in_([f.id for f in rows] or [0]))
                  .group_by(ParsedFrameworkControl.uploaded_framework_id).all())
    return [(f, counts[f.id]) for f in rows if counts.get(f.id)]


def _framework_for(db, framework_id: int):
    from ....models import Tenant, UploadedFramework

    fw = db.get(UploadedFramework, framework_id)
    tenant = db.query(Tenant).first()
    if (fw is None or not fw.is_active or (fw.tenant_id not in (None, tenant.id if tenant else None) and not fw.is_shared)
            or (fw.upload_status or "") not in ("parsed", "completed", "published", "classified")):
        raise ReferenceProblem("This framework is not available as a reference.")
    return fw


# ── attaching ────────────────────────────────────────────────────────────────
def next_key(db, session_id: int) -> str:
    from ....models import StudioReference

    used = [int(r[0][1:]) for r in db.query(StudioReference.ref_key).filter(StudioReference.session_id == session_id) if r[0][1:].isdigit()]
    return f"R{max(used, default=0) + 1}"


def attach(db, session, kind: str, *, source_id: Optional[int] = None, scope: Optional[Dict[str, Any]] = None,
           upload: Optional[Tuple[str, bytes]] = None, template_id: Optional[str] = None):
    """Resolve a reference to text and keep it with the session. Returns the ``StudioReference`` (an existing one when the same
    source and selection is already attached)."""
    from ....models import GovernanceDocument, StudioReference
    from . import templates
    from ....services.licence_guard import find_restricted

    if kind not in KINDS:
        raise ReferenceProblem("Unknown kind of reference.")
    scope = scope or {}
    notes: List[str] = []
    meta: Dict[str, Any] = {}
    label = ""
    if kind in ("parent_document", "document"):
        if kind == "parent_document" and source_id is None and session.document_id:
            parent = db.get(GovernanceDocument, session.document_id)
            source_id = parent.parent_document_id if parent else None
        doc = db.get(GovernanceDocument, source_id) if source_id else None
        if doc is None:
            raise ReferenceProblem("That document was not found." if source_id else "This document has no parent document.")
        text, notes = library_text(db, doc)
        title = doc.title
        label = " · ".join(x for x in (doc.document_code, f"v{doc.current_version}" if doc.current_version else None, doc.doc_type) if x)
    elif kind == "framework":
        fw = _framework_for(db, int(source_id or 0))
        text, meta = framework_text(db, fw, scope)
        title = f"{fw.name}{' ' + fw.version if fw.version else ''}"
        label = (f"{meta['count']} of {meta['total']} controls" if meta["count"] != meta["total"] else f"{meta['total']} controls")
    elif kind == "upload":
        if not upload:
            raise ReferenceProblem("No file was provided.")
        from .importers import ImportProblem, read_attachment

        name, data = upload
        suffix = os.path.splitext(name)[1].lower()
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
        try:
            imported = read_attachment(tmp.name, name)          # any file: documents, workbooks, slides, data, scans and pictures (read here)
        except ImportProblem as exc:
            raise ReferenceProblem(str(exc)) from exc
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass
        text, notes, title, label = imported.markdown, imported.notes, name, "uploaded file"
    else:
        template = templates.resolve(db, template_id or "default", scope.get("doc_type", "policy"))
        if not template:
            raise ReferenceProblem("That template was not found.")
        text, title, label = template["content"], template["name"], "template"
    if not text.strip():
        raise ReferenceProblem("There is no text in it to use.")
    if find_restricted(text):
        raise ReferenceProblem("This contains Secure Controls Framework text, which its licence does not allow to be sent to an AI model.")
    existing = (db.query(StudioReference).filter(StudioReference.session_id == session.id, StudioReference.kind == kind,
                                                 StudioReference.source_id == source_id).all() if source_id else [])
    for r in existing:
        if (r.scope or {}).get("mode") == meta.get("mode") and (r.scope or {}).get("domains") == meta.get("domains") \
                and (r.scope or {}).get("count") == meta.get("count"):
            r.include = True
            return r
    text, truncated = _cut(text, MAX_REF_CHARS)
    ref = StudioReference(session_id=session.id, ref_key=next_key(db, session.id), kind=kind, title=title[:500], source_id=source_id,
                          source_label=label[:300], scope={**meta, **({"notes": notes} if notes else {})} or None, text=text,
                          char_count=len(text), truncated=truncated)
    db.add(ref)
    db.flush()
    return ref


# ── using ────────────────────────────────────────────────────────────────────
def total_chars(refs: Sequence[Any]) -> int:
    return sum(r.char_count for r in refs if r.include)


def render(refs: Sequence[Any]) -> str:
    """The references as the model reads them."""
    out = []
    for r in refs:
        if r.include:
            out.append(f'<reference id="{r.ref_key}" kind="{r.kind}" title="{r.title.replace(chr(34), chr(39))}">\n{r.text}\n</reference>')
    return "\n".join(out)


_SPACES = re.compile(r"\s+")


def _canon(text: str) -> str:
    text = (text or "").lower()
    text = text.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", " ": " "}))
    text = re.sub(r"[*_`#>|\\]", " ", text)
    return _SPACES.sub(" ", text).strip()


def verify_quote(reference_text: str, quote: str) -> bool:
    """Whether ``quote`` is in the reference, word for word (ignoring case, white space, quotation marks and Markdown marks).
    A quote with an ellipsis is checked in parts, in order."""
    parts = [p for p in re.split(r"\s*(?:\.{3}|…)\s*", quote or "") if len(_canon(p)) >= 8]
    if not parts:
        return False
    hay, at = _canon(reference_text), 0
    for p in parts:
        found = hay.find(_canon(p), at)
        if found < 0:
            return False
        at = found + len(_canon(p))
    return True


def verify_locator(ref, locator: str) -> Optional[bool]:
    """For a framework, whether the control the AI names is one of those it was given (None when there is nothing to check)."""
    refs = (ref.scope or {}).get("refs") if ref.kind == "framework" else None
    if not refs or not (locator or "").strip():
        return None
    low = locator.lower()
    return any(r.lower() in low for r in refs if r)
