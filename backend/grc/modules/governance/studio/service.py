"""Studio sessions: starting one, saving the document, accepting the AI's changes, and moving the result into the library.

A session is a working document with its chat, revisions and references. It is not a library document until the person moves
it there; a session opened on a library document saves back to it as a new version. Nothing the AI proposes touches the
document until it is accepted, and an accepted change is placed by block, so a person who kept typing meanwhile loses nothing:
a change whose blocks they edited is reported as a conflict instead of overwriting their words.
"""
from __future__ import annotations

import functools
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

from . import blocks as B
from . import references as refs
from . import templates
from .importers import ImportProblem, import_file

logger = logging.getLogger(__name__)

UPLOAD_DIR = os.environ.get("STUDIO_UPLOAD_DIR") or str(Path(__file__).resolve().parents[4] / "uploads" / "studio")
MAX_UPLOAD_BYTES = int(os.environ.get("STUDIO_MAX_UPLOAD_MB", "30")) * 1024 * 1024
STALE_AFTER = timedelta(minutes=15)


class StudioError(ValueError):
    """Something the person can fix; the message is for them."""


class Conflict(StudioError):
    """The document changed under the person: reload before saving."""


class Forbidden(StudioError):
    """The person may not change that library document (``governance/permissions.py``)."""


def _may_change(db, user, doc) -> None:
    from ..permissions import EDIT_REFUSED, can_edit

    if not can_edit(db, user, doc):
        raise Forbidden(EDIT_REFUSED)


def _now() -> datetime:
    return datetime.utcnow()


def _tenant(db):
    from ....models import Tenant

    return db.query(Tenant).first()


def upload_dir(db, *parts: str) -> str:
    tenant = _tenant(db)
    path = os.path.join(UPLOAD_DIR, (tenant.slug if tenant else "tenant"), *parts)
    os.makedirs(path, exist_ok=True)
    return path


def _copy_into_studio(db, source: str, name: str) -> str:
    """A copy of a library file in the studio's own folder (the session edits the copy; the library's file is never touched)."""
    safe = re.sub(r"[^\w.\- ]", "_", os.path.basename(name))[:120] or "document"
    path = os.path.join(upload_dir(db, "uploads"), f"{uuid.uuid4().hex}_{safe}")
    shutil.copyfile(source, path)
    return path


def user_name(user) -> str:
    return getattr(user, "display_name", None) or getattr(user, "username", None) or "A user"


# ── views ────────────────────────────────────────────────────────────────────
def ref_view(r) -> Dict[str, Any]:
    scope = r.scope or {}
    return {"id": r.id, "key": r.ref_key, "kind": r.kind, "title": r.title, "label": r.source_label, "source_id": r.source_id,
            "chars": r.char_count, "truncated": r.truncated, "include": r.include,
            "scope": {k: scope.get(k) for k in ("mode", "domains", "count", "total", "query") if k in scope} or None, "notes": scope.get("notes", [])}


def may_save(db, s, user) -> bool:
    """Save to library is for someone who may change the session's library document; a reader's comparison is theirs to read, not
    to save (and so theirs to remove from their work)."""
    from ....models import GovernanceDocument
    from ..permissions import can_edit

    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    return doc is None or user is None or can_edit(db, user, doc)


def session_view(db, s, *, content: bool = True, user=None) -> Dict[str, Any]:
    from ....models import GovernanceDocument, StudioReference
    from ..permissions import in_force_number
    from ..routers.document_access import _unsaved

    rows = db.query(StudioReference).filter(StudioReference.session_id == s.id).order_by(StudioReference.id).all()
    blocks = B.parse(s.content)
    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    out = {"id": s.id, "title": s.title, "kind": s.kind, "doc_type": s.doc_type, "status": s.status, "document_id": s.document_id,
           "document_version": doc.current_version if doc is not None else None,          # the library document's own version
           "document_status": doc.status if doc is not None else None,
           # the version everyone else reads until the next one is published (the Save warning says so)
           "document_version_in_force": in_force_number(doc) if doc is not None else None,
           # Save to library is for someone who may change that document, on each row of the list too (a reader's comparison can be
           # removed from their work); only on the session's own page, the work (or a tidied Word file) Save to library would keep
           # ponytail: one rights lookup per library row of the list (at most 100); look the rights up once per list if it gets slow
           # nor while the document is archived (D29; document_status says so): it is restored first
           "may_save": may_save(db, s, user) and not (doc is not None and doc.status == "archived"),
           **({"unsaved_in_library": _unsaved(s) if doc is not None else False} if content else {}),
           "revision": s.revision_no, "base_label": s.base_label, "instructions": s.instructions or {}, "settings": s.settings or {},
           "template_id": s.template_id, "source": {"kind": s.source_kind, "name": s.source_name, "in_place": bool(s.source_kind == "docx" and s.native_map)},
           "references": [ref_view(r) for r in rows], "reference_chars": refs.total_chars(rows),
           "words": sum(b.words for b in blocks), "blocks": len(blocks),
           "created_at": s.created_at.isoformat() if s.created_at else None, "updated_at": s.updated_at.isoformat() if s.updated_at else None}
    if content:
        out["content"] = s.content
        out["original_version"] = _original_version(db, s)
        from .. import proposals

        # saved to the library as a change that waits for the owner (or was not accepted): the draft stays unsaved meanwhile
        out["proposal"] = proposals.for_session(db, s)
    return out


def _original_version(db, s) -> Optional[str]:
    """For an uploaded file not in the library yet and changed here (an upload session from before uploads went into the library at
    once): the version the file states, which Move to the library keeps it as; what the studio made of it becomes the next one,
    minor or major as the person chooses. None when the move makes one version (``move_to_library``'s ``two``)."""
    upload = _uploaded_original(s) if s.document_id is None else None
    if upload is None or _norm_doc(s.content) == _norm_doc(_first_revision_text(db, s)):
        return None
    from .. import doc_version

    # ponytail: reads the uploaded file on each read of such a session (they are rare and older); cache by path if that changes
    return doc_version.detect(*upload)[0]


def message_view(m) -> Dict[str, Any]:
    return {"id": m.id, "role": m.role, "kind": m.kind, "content": m.content, "status": m.status, "stage": m.stage, "error": m.error,
            "live": m.live if m.status == "working" else None,
            "proposal": m.proposal, "references_used": m.references_used or [], "questions": m.questions or [], "notes": m.notes or [],
            "answers": m.answers, "attachments": m.attachments or [], "base_revision": m.base_revision, "usage": m.usage,
            "created_at": m.created_at.isoformat() if m.created_at else None}


def progress(db, s) -> List[Dict[str, Any]]:
    """What the page needs to follow the latest turns: status, the line and the live view, nothing of the (large) answers. Polled several
    times a second while a turn works, so it stays small and writes nothing unless a turn is found dead."""
    from ....models import StudioMessage

    def latest():
        return db.query(StudioMessage).filter(StudioMessage.session_id == s.id).order_by(StudioMessage.id.desc()).limit(4).all()

    rows = latest()
    if any(m.status == "working" and (m.updated_at or m.created_at) < _now() - STALE_AFTER for m in rows):
        reap(db, s)
        rows = latest()
    return [{"id": m.id, "status": m.status, "stage": m.stage, "live": m.live if m.status == "working" else None} for m in reversed(rows)]


# ── creating a session ───────────────────────────────────────────────────────
def _default_instructions(db, extra: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    from ....models import StudioAsset

    tenant = _tenant(db)
    out: Dict[str, Any] = {"entity_name": ((tenant.legal_entity or tenant.name) if tenant else "") or ""}
    logo = db.query(StudioAsset).filter(StudioAsset.kind == "logo", StudioAsset.is_default.is_(True)).first()
    if logo:
        out["logo_asset_id"] = logo.id
    out.update({k: v for k, v in (extra or {}).items() if v is not None})
    return out


def add_revision(db, s, content: str, *, author_type: str, user_id: Optional[int], summary: str, message_id: Optional[int] = None):
    """Keep ``content`` as the session's next revision and make it the working content."""
    from ....models import StudioRevision

    previous = (db.query(StudioRevision).filter(StudioRevision.session_id == s.id).order_by(StudioRevision.number.desc()).first())
    stats = B.stats(B.parse(previous.content if previous else s.base_content), B.parse(content))
    s.revision_no = (previous.number if previous else 0) + 1
    rev = StudioRevision(session_id=s.id, number=s.revision_no, author_type=author_type, author_user_id=user_id, summary=summary[:500],
                         content=content, stats=stats, message_id=message_id)
    db.add(rev)
    s.content, s.updated_at = content, _now()
    db.flush()
    return rev


def create_session(db, user, *, kind: str = "new", title: str = "", doc_type: str = "policy", template_id: Optional[str] = None,
                   document_id: Optional[int] = None, upload: Optional[tuple] = None, instructions: Optional[Dict[str, Any]] = None,
                   details: Optional[Dict[str, Any]] = None, markdown: Optional[str] = None, template_name: Optional[str] = None):
    """Start a session: a new document (from a template or blank), a library document, or an uploaded file (``details``: what the
    library document is created with - classification, description, owner, department, review cycle and dates). A new document
    can start from ``markdown``, a template of the platform's catalogue named ``template_name`` (it stays a studio draft)."""
    from ....models import GovernanceDocument, StudioSession

    s = StudioSession(tenant_id=(_tenant(db).id if _tenant(db) else 1), created_by=user.id, title=(title or template_name or "Untitled document").strip()[:500],
                      kind=kind, doc_type=doc_type or "policy", instructions={}, settings={}, status="active", last_opened_at=_now())
    summary, content, base, base_label = "", "", "", None
    registered = None
    if kind == "new" and markdown is not None:
        try:
            template = templates.from_markdown(markdown, title=s.title, name=template_name or s.title, doc_type=s.doc_type)
        except ValueError as exc:
            raise StudioError(str(exc)) from exc
        s.settings = {"template_name": template["name"]}
    elif kind == "new":
        template = templates.resolve(db, template_id or "default", s.doc_type)
    if kind == "new":
        content = (template["content"] if template else "")
        if template and title:
            content = content.replace("[[Document title]]", title.strip(), 1)
        if not content.strip() and title:
            content = f"# {title.strip()}\n"
        s.template_id = template["id"] if template else None
        if template and template["doc_type"] != "other":
            s.doc_type = template["doc_type"]
        base, base_label = content, (f"Started from {template['name']}" if template else "Started blank")
        summary = base_label
    elif kind == "library":
        doc = db.get(GovernanceDocument, document_id) if document_id else None
        if doc is None:
            raise StudioError("That document was not found.")
        try:
            src, number = refs.read_as(db, doc, user)          # who may not read it is refused; staff get the version in force
        except refs.Refused as exc:
            raise Forbidden(str(exc)) from exc
        s.title, s.doc_type, s.document_id = doc.title, doc.doc_type or "policy", doc.id
        file_type = (src.file_type or "").lower().lstrip(".")
        if not (src.content or "").strip() and src.file_path and os.path.exists(src.file_path) and file_type in ("docx", "pdf"):
            # a document that is its file (an uploaded Word or PDF): the studio works on a copy of the file, a Word file is edited in place
            copy = _copy_into_studio(db, src.file_path, src.file_name or f"document.{file_type}")
            try:
                imported = import_file(copy, src.file_name or copy, twin=True)
            except ImportProblem as exc:
                os.unlink(copy)
                raise StudioError(str(exc)) from exc
            content, base = imported.markdown, imported.base_markdown if imported.base_markdown is not None else imported.markdown
            s.source_kind, s.source_name, s.source_original_path, s.source_path = imported.kind, src.file_name, copy, copy
            if imported.native:
                s.native_map, s.source_path = imported.native.get("map"), imported.native.get("path") or copy
            s.settings = {"file_master": True, "library_file": src.file_path}
            base_label = f"{doc.title} v{number}" + ("" if imported.base_markdown is None else " before its tracked changes")
            summary = f"Opened from the library (v{number})" + "".join(f" ({n})" for n in imported.notes[:1])
        else:
            try:
                content, _notes = refs.text_of(src)
            except refs.ReferenceProblem as exc:
                raise StudioError(str(exc)) from exc
            base, base_label, summary = content, f"{doc.title} v{number}", f"Opened from the library (v{number})"
        if src is not doc:          # the version in force, read instead of a newer one: an export names its number
            s.settings = {**(s.settings or {}), "version_read": number}
    elif kind == "upload":
        if not upload:
            raise StudioError("Choose a file to open.")
        name, data = upload
        if len(data) > MAX_UPLOAD_BYTES:
            raise StudioError(f"That file is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
        safe = re.sub(r"[^\w.\- ]", "_", os.path.basename(name))[:120] or "document"
        path = os.path.join(upload_dir(db, "uploads"), f"{uuid.uuid4().hex}_{safe}")
        with open(path, "wb") as f:
            f.write(data)
        try:
            imported = import_file(path, name, twin=True)
        except ImportProblem as exc:
            os.unlink(path)
            raise StudioError(str(exc)) from exc
        content, base = imported.markdown, imported.base_markdown if imported.base_markdown is not None else imported.markdown
        s.title = title.strip() or os.path.splitext(safe)[0]
        s.source_kind, s.source_name, s.source_original_path, s.source_path = imported.kind, name, path, path
        if imported.native:
            s.native_map = imported.native.get("map")
            s.source_path = imported.native.get("path") or path
        registered = _register_upload(db, s, user, path, name, content, details)
        base_label = f"{s.title} v{registered.current_version}" + ("" if imported.base_markdown is None else " before its tracked changes")
        summary = (f"Opened from {name}, and put in the library as a draft, version {registered.current_version}"
                   + ("".join(f" ({n})" for n in imported.notes[:1])))
    else:
        raise StudioError("Unknown way to start a session.")
    s.instructions = _default_instructions(db, instructions)
    s.content, s.base_content, s.base_label = content, base, base_label and base_label[:200]       # base_label is String(200)
    db.add(s)
    db.flush()
    add_revision(db, s, content, author_type="import" if kind != "new" else "system", user_id=user.id, summary=summary)
    db.commit()
    if registered is not None:
        _announce_registered(db, registered, user)
    return s


def _register_upload(db, s, user, path: str, name: str, content: str, details: Optional[Dict[str, Any]] = None):
    """A file uploaded into the studio goes into the library at once, as a draft whose first version is the file itself, numbered
    as the file states (``doc_version.detect``: its revision table, its document control, else its name, else 1.0), with the
    details the person confirmed. The session then edits that library document, as one opened from the library. Does not commit."""
    from ....models import GovernanceDocument, GovernanceDocumentVersion
    from .. import doc_version
    from ..doc_details import schedule
    from ..routers.documents import GOVERNANCE_UPLOAD_DIR
    from ..routers.versions import create_audit_log

    tenant = _tenant(db)
    version, found_in = doc_version.detect(path, name)
    is_file = s.source_kind in ("docx", "pdf")
    files = _keep_original((path, name), GOVERNANCE_UPLOAD_DIR) if is_file else {}
    d = details or {}
    doc = GovernanceDocument(tenant_id=tenant.id, title=s.title, doc_type=s.doc_type or "policy", classification=d.get("classification") or "internal",
                             description=d.get("description") or None, owner_id=d.get("owner_id") or user.id, author_id=user.id,
                             department_id=d.get("department_id"), review_cycle_months=d.get("review_cycle_months") or 12,
                             effective_date=d.get("effective_date"), next_review_date=d.get("next_review_date"), parent_document_id=d.get("parent_document_id"),
                             framework_ids=[], applicable_framework_ids=[], status="draft", current_version=version,
                             content=None if is_file else content, **files)
    schedule(doc)
    db.add(doc)
    db.flush()
    db.add(GovernanceDocumentVersion(document_id=doc.id, version_number=version, change_type="major", title=doc.title, content=None if is_file else content,
                                     change_summary=doc_version.first_summary(version, found_in), status="current", created_by=user.id, **files))
    create_audit_log(db=db, document_id=doc.id, tenant_id=tenant.id, user_id=user.id, action="created",
                     action_details=f"Document '{doc.title}' created from {name}, uploaded into the Comply AI Studio (version {version})")
    s.document_id, s.kind = doc.id, "library"
    if is_file:
        s.settings = {**(s.settings or {}), "file_master": True, "library_file": files["file_path"]}
    return doc


def _announce_registered(db, doc, user) -> None:
    """The review log entry and the statements' extraction for a document the studio put in the library. Never fails the upload."""
    from ..action_logger import log_governance_action

    try:
        log_governance_action(db=db, tenant_id=doc.tenant_id, action_type="document_draft_created",
                              action_description=f"Governance document draft created from a file uploaded into the Comply AI Studio: '{doc.title}' ({doc.doc_type})",
                              entity_type="governance_document", action_user_id=user.id, entity_id=doc.id,
                              action_metadata={"doc_type": doc.doc_type, "version": doc.current_version, "source": "ai_studio_upload"})
        db.commit()
        from ..routers.documents import _resolve_tenant_slug_for_autoparse
        from ..routers.policy_parser import maybe_autoparse_document

        maybe_autoparse_document(db, _resolve_tenant_slug_for_autoparse(doc.tenant_id), doc.id, user.id)
    except Exception:       # noqa: BLE001 - the document is in the library; its statements can be extracted from its page
        logger.warning("could not log or parse studio upload document %s", doc.id, exc_info=True)


# ── saving and history ───────────────────────────────────────────────────────
def save_content(db, s, content: str, user, *, base_revision: Optional[int] = None, summary: Optional[str] = None):
    """The editor's save. A new revision unless nothing changed. ``base_revision`` is the revision the editor started from: when
    the session has moved on (an accepted AI change, another tab) the save is refused rather than overwriting it."""
    content = (content or "").replace("\r\n", "\n")
    if base_revision is not None and base_revision != s.revision_no:
        raise Conflict("The document changed while you were editing it (a change was accepted or it was saved elsewhere). Reload to see it.")
    if content.strip() == (s.content or "").strip():
        return None
    rev = add_revision(db, s, content, author_type="user", user_id=user.id, summary=summary or f"Edited by {user_name(user)}")
    db.commit()
    return rev


def revisions(db, s) -> List[Dict[str, Any]]:
    from ....models import GRCUser, StudioRevision

    rows = db.query(StudioRevision).filter(StudioRevision.session_id == s.id).order_by(StudioRevision.number.desc()).all()
    names = {u.id: user_name(u) for u in db.query(GRCUser).filter(GRCUser.id.in_({r.author_user_id for r in rows if r.author_user_id} or {0}))}
    return [{"number": r.number, "author_type": r.author_type, "author": names.get(r.author_user_id) if r.author_user_id else None,
             "summary": r.summary, "stats": r.stats, "created_at": r.created_at.isoformat() if r.created_at else None,
             "words": sum(b.words for b in B.parse(r.content))} for r in rows]


def revision_content(db, s, number: int) -> str:
    from ....models import StudioRevision

    if number == 0:
        return s.base_content or ""
    rev = db.query(StudioRevision).filter(StudioRevision.session_id == s.id, StudioRevision.number == number).first()
    if rev is None:
        raise StudioError("That revision does not exist.")
    return rev.content


def diff(db, s, frm: int, to: int) -> Dict[str, Any]:
    """The redline between two revisions (0 = the baseline the session started from; any other number a revision), cut into
    changes. Each change says where it came from (a request to the AI and its sources, or the person's own edit) and, when ``to``
    is the document as it is now, can be taken back (``revert_changes``)."""
    from .. import change_chain as C

    a_md, b_md = revision_content(db, s, frm), revision_content(db, s, to)
    out = C.compare(a_md, b_md)
    origins = session_origins(db, s, since_revision=frm)
    for h in out["hunks"]:
        h["by"] = C.attribute(h, origins)
    return {"from": frm, "to": to, "rows": out["rows"], "stats": out["stats"], "hunks": out["hunks"], "hash": out["hash"],
            "can_revert": to == s.revision_no and frm != to}


def tracked(db, s, user) -> Dict[str, Any]:
    """Tracked changes: the document as it is here against the version everyone else reads (the version in force), or the version it
    started at when it was never published; when nothing changed since then, what that version itself changed (since the version
    before it). The shape of ``diff``, with ``label`` and ``from_version_id`` (what a take back counts from, ``revert_changes``).
    Not in the library, no versions, or someone who may not edit the document: since where this session started."""
    from ....models import GovernanceDocument, GovernanceDocumentVersion as V
    from .. import change_chain as C
    from ..permissions import can_edit

    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    rows = ([r for r in db.query(V).filter(V.document_id == doc.id).order_by(V.id).all() if r.status != "reverted"]
            if doc is not None and can_edit(db, user, doc) else [])
    in_force = getattr(doc, "last_published_version", None) if doc is not None else None
    base = (next((r for r in reversed(rows) if r.version_number == in_force), None) if in_force else None) or (rows[0] if rows else None)
    text = C.version_text(base) if base is not None else None
    if text is None:
        start = 1 if s.revision_no >= 1 else 0        # revision 1 is where the session started; 0 moves with every save to the library
        out = diff(db, s, start, s.revision_no)
        return {**out, "label": "Changes since you opened it" if start else "Changes since the start", "from_version_id": None}

    def against(version, earlier: str) -> Dict[str, Any]:
        out = C.compare(earlier, s.content)
        later = [r for r in rows if r.id > version.id]
        origins = [o for r in later for o in C.origins_of(r.change_set if isinstance(r.change_set, dict) else None)] + session_origins(db, s)
        for h in out["hunks"]:
            h["by"] = C.attribute(h, origins)
        return {"from": None, "to": s.revision_no, "rows": out["rows"], "stats": out["stats"], "hunks": out["hunks"], "hash": out["hash"],
                "can_revert": True, "from_version_id": version.id}

    out = against(base, text)
    if not out["hunks"]:            # nothing since: what that version itself changed
        before = next((r for r in reversed(rows) if r.id < base.id and r.change_type != "signoff"), None)
        earlier = C.version_text(before) if before is not None else None
        if earlier is not None:
            again = against(before, earlier)
            if again["hunks"]:
                return {**again, "label": f"What v{base.version_number} changed (since v{before.version_number})"}
    label = f"Changes since v{base.version_number}" + (", the version in force" if in_force and base.version_number == in_force
                                                      else " (the original)" if base is rows[0] else "")
    return {**out, "label": label}


def restore(db, s, number: int, user):
    rev = revision_content(db, s, number)
    out = add_revision(db, s, rev, author_type="restore", user_id=user.id, summary=f"Restored revision {number}")
    db.commit()
    return out


# ── the AI's changes ─────────────────────────────────────────────────────────
def _norm_doc(md: str) -> str:
    return B.render(B.parse(md)).strip()


def accept_ops(db, s, msg, op_ids: Sequence[str], user_id: Optional[int], *, overrides: Optional[Dict[str, str]] = None, auto: bool = False,
               summary: Optional[str] = None) -> Dict[str, Any]:
    """Apply the chosen pending changes of an AI message to the document as it is now. A change whose blocks the person has
    edited since the AI read them is marked ``conflict`` and left alone. Returns ``{"accepted": n, "conflicts": n}``."""
    from ....models import StudioRevision

    proposal = dict(msg.proposal or {})
    ops = [dict(o) for o in proposal.get("ops") or []]
    base_rev = (db.query(StudioRevision).filter(StudioRevision.session_id == s.id, StudioRevision.number == (msg.base_revision or 0)).first())
    base = B.parse(base_rev.content) if base_rev else []
    now = B.parse(s.content)
    same = _norm_doc(base_rev.content if base_rev else "") == _norm_doc(s.content)
    where = B.locate(base, now)
    chosen = [o for o in ops if o["id"] in set(op_ids) and o["status"] == "pending"]
    tidied = [o for o in chosen if o["kind"] == "tidy" and _tidy_file(s, o)]
    chosen = [o for o in chosen if o["kind"] != "tidy"]
    translated: List[B.Op] = []
    replaced: Dict[str, str] = {}               # op id -> the Markdown it takes out of the document (kept, so the change can be taken back)
    conflicts = 0
    for o in chosen:
        markdown = (overrides or {}).get(o["id"], o["markdown"])
        o["markdown"] = markdown
        if o["kind"] == "replace_all":
            if same or B.is_blank(now):
                translated.append(B.Op(o["id"], "replace_all", markdown=markdown))
            else:
                o["status"], o["why"] = "conflict", "The document was changed after Comply Agent read it."
                conflicts += 1
            continue
        first = B.index_of(o["start"], len(base))
        last = B.index_of(o.get("end") or o["start"], len(base))
        if first is None or last is None:
            o["status"], o["why"] = "conflict", "The blocks it refers to no longer exist."
            conflicts += 1
            continue
        if o["kind"] == "insert":
            anchor = -1 if first == -1 else where.get(first)
            if anchor is None:
                o["status"], o["why"] = "conflict", "The block it follows was changed."
                conflicts += 1
            else:
                translated.append(B.Op(o["id"], "insert", start="START" if anchor == -1 else f"B{anchor + 1}", markdown=markdown))
            continue
        span = range(first, last + 1)
        if not all(i in where for i in span) or any(where[i + 1] != where[i] + 1 for i in span if i + 1 in span):
            o["status"], o["why"] = "conflict", "The text it changes was edited after Comply Agent read it."
            conflicts += 1
            continue
        translated.append(B.Op(o["id"], o["kind"], start=f"B{where[first] + 1}", end=f"B{where[last] + 1}", markdown=markdown))
        replaced[o["id"]] = B.render(now[where[first]:where[last] + 1])
    new_blocks, status = B.apply_ops(now, translated)
    applied = [o for o in chosen if status.get(o["id"]) == "applied"]
    for o in chosen:
        if o["status"] == "pending":
            if status.get(o["id"]) == "applied":
                o["status"] = "accepted"
            else:
                o["status"], o["why"] = "conflict", status.get(o["id"], "It could not be placed.")
                conflicts += 1
    conflicts += sum(1 for o in ops if o["kind"] == "tidy" and o["id"] in set(op_ids) and o["status"] == "conflict")
    if applied or tidied:                       # a tidy changes the file only: still a revision, so the file view and the history follow it
        rev = add_revision(db, s, B.render(new_blocks) if applied else s.content, author_type="ai", user_id=user_id,
                           summary=(summary or ("Comply Agent wrote the first draft" if auto and B.is_blank(now) else
                                                f"Accepted {len(applied)} Comply Agent change(s)" if applied else "Tidied the spacing of the Word file")),
                           message_id=msg.id)
        for o in applied + tidied:              # who accepted it, when, and what it replaced: the change chain reads this
            o["accepted_by"], o["accepted_at"], o["revision"] = user_id, _now().isoformat(), rev.number
            if o["id"] in replaced:
                o["before_markdown"] = replaced[o["id"]]
    proposal["ops"] = ops
    msg.proposal = proposal
    msg.updated_at = _now()
    db.commit()
    return {"accepted": len(applied) + len(tidied), "conflicts": conflicts}


def _tidy_file(s, o: Dict[str, Any]) -> bool:
    """Accept a tidy (``engine.tidy_offer``): the session's Word file with its spacing tidied becomes the file its edits are
    written into. A new file next to it, so the one before is kept and the tidy can be taken back. False, with the change marked
    as a conflict, when it cannot be done."""
    from . import docx_io

    why = None
    if not is_word_in_place(s):
        why = "This document is not a Word file edited in place."
    else:
        try:
            data, counts = docx_io.tidy(s.source_path)
        except Exception:       # noqa: BLE001 - the file is left as it was
            logger.warning("studio session %s: the Word file could not be tidied", s.id, exc_info=True)
            data, counts, why = None, {}, "The Word file could not be tidied."
        if why is None and data is None:
            why = "There is nothing left to tidy."
        if why is None:
            path = os.path.join(os.path.dirname(s.source_path), f"{uuid.uuid4().hex}_tidied.docx")
            with open(path, "wb") as f:
                f.write(data)
            try:
                docx_io.export_in_place(path, s.content)                  # the document's text still goes into the tidied file
            except docx_io.PatchProblem:
                os.unlink(path)
                why = "The tidied file could not take the document's text, so the file was left as it was."
            else:
                o["before_source"], o["tidy"], s.source_path = s.source_path, counts, path
                s.settings = {**(s.settings or {}), "file_changed": True}
    if why:
        o["status"], o["why"] = "conflict", why
        return False
    o["status"] = "accepted"
    return True


def _run_starts(blocks: Sequence[B.Block], signatures: Sequence[str]) -> List[int]:
    """Where in ``blocks`` the run of blocks with these signatures begins (more than one place when the same words repeat)."""
    n = len(signatures)
    if not n:
        return []
    keys = [b.signature for b in blocks]
    return [i for i in range(len(keys) - n + 1) if keys[i:i + n] == list(signatures)]


def _nearest(places: Sequence[int], guess: int) -> int:
    return min(places, key=lambda i: (abs(i - guess), i))


def revert_op(db, s, msg, op_id: str, user_id: Optional[int]) -> Dict[str, Any]:
    """Take an accepted AI change back out of the document as it is now: the blocks it wrote are replaced by the ones it replaced
    (or removed, or put back). It is a new revision, so nothing is lost. A change whose text was edited since cannot be found
    again: it is reported as a conflict and the document is left alone."""
    from ....models import StudioRevision

    proposal = dict(msg.proposal or {})
    ops = [dict(o) for o in proposal.get("ops") or []]
    op = next((o for o in ops if o["id"] == op_id), None)
    if op is None or op.get("status") != "accepted":
        raise StudioError("Only a change that was accepted can be taken back.")
    kind = op["kind"]
    if kind == "tidy":                          # the file from before the tidy is kept: the edits go into it again
        before = op.get("before_source")
        if not before or not os.path.exists(before):
            raise StudioError("The Word file from before the tidy is no longer kept, so the tidy cannot be taken back.")
        s.source_path = before
        s.settings = {**(s.settings or {}), "file_changed": True}
        add_revision(db, s, s.content, author_type="revert", user_id=user_id, summary="Took back the tidy of the Word file's spacing", message_id=msg.id)
        op["status"], op["reverted_by"], op["reverted_at"] = "reverted", user_id, _now().isoformat()
        proposal["ops"] = ops
        msg.proposal, msg.updated_at = proposal, _now()
        db.commit()
        return {"content": s.content, "revision": s.revision_no}
    base_rev = db.query(StudioRevision).filter(StudioRevision.session_id == s.id, StudioRevision.number == (msg.base_revision or 0)).first()
    base = B.parse(base_rev.content if base_rev else "")
    now = B.parse(s.content)
    if kind == "replace_all":
        prior = db.query(StudioRevision).filter(StudioRevision.session_id == s.id, StudioRevision.number == int(op.get("revision") or 0) - 1).first()
        before_md = prior.content if prior is not None else (base_rev.content if base_rev else "")
        if _norm_doc(op["markdown"]) != _norm_doc(s.content):
            raise Conflict("The document has been edited since Comply Agent wrote it, so it cannot be taken back in one step. Restore a version instead.")
        new_md = before_md
    else:
        before_md = op.get("before_markdown")
        if before_md is None:                   # accepted before the text it replaced was kept: it is still in the revision the AI read
            first = B.index_of(op.get("start") or "", len(base))
            last = B.index_of(op.get("end") or op.get("start") or "", len(base))
            if kind == "insert":
                before_md = ""
            elif first is None or last is None or first < 0:
                raise StudioError("This change cannot be taken back: the text it replaced is no longer known.")
            else:
                before_md = B.render(base[first:last + 1])
        before = B.parse(before_md) if before_md else []
        after = B.parse(op["markdown"]) if kind != "delete" else []
        anchor = B.index_of(op.get("start") or "", len(base))
        guess = anchor if anchor is not None and anchor >= 0 else 0
        if after:
            starts = _run_starts(now, [b.signature for b in after])
            if not starts:
                raise Conflict("The text this change wrote has been edited since, so it cannot be taken back automatically. Edit it by hand, or restore a version.")
            i = _nearest(starts, guess)
            new_blocks = list(now[:i]) + before + list(now[i + len(after):])
        else:                                   # a removal: put the blocks back after the block that stood before them
            first = B.index_of(op.get("start") or "", len(base))
            if first is None or first < 0 or not before:
                raise StudioError("This change cannot be taken back: the text it removed is no longer known.")
            if first == 0:
                pos = 0
            else:
                places = [i for i, b in enumerate(now) if b.signature == base[first - 1].signature]
                if not places:
                    raise Conflict("The text before the removed part has been edited since, so it cannot be put back automatically.")
                pos = _nearest(places, first - 1) + 1
            new_blocks = list(now[:pos]) + before + list(now[pos:])
        new_md = B.render(new_blocks)
    if _norm_doc(new_md) == _norm_doc(s.content):
        raise StudioError("The document already reads as it did before this change.")
    what = (op.get("reason") or "").strip() or {"replace": "a reworded passage", "insert": "an addition", "delete": "a removal", "replace_all": "the first draft"}.get(kind, "a change")
    add_revision(db, s, new_md, author_type="revert", user_id=user_id, summary=f"Took back a Comply Agent change: {what}"[:480], message_id=msg.id)
    op["status"], op["reverted_by"], op["reverted_at"] = "reverted", user_id, _now().isoformat()
    proposal["ops"] = ops
    msg.proposal, msg.updated_at = proposal, _now()
    db.commit()
    return {"content": new_md, "revision": s.revision_no}


def _op_sources(op: Dict[str, Any], msg, refs_by_key: Dict[str, Any]) -> List[Dict[str, Any]]:
    """What an accepted change rests on: the references the AI said it used for it (all of its answer's when it did not say), each
    with where in it and the words it quoted, and whether those words were found in it."""
    wanted = set(op.get("refs") or [])
    out: List[Dict[str, Any]] = []
    for u in msg.references_used or []:
        key = str(u.get("ref") or "")
        if wanted and key and key not in wanted and u.get("basis") == "reference":
            continue
        ref = refs_by_key.get(key)
        out.append({"ref": key, "kind": (ref.kind if ref is not None else u.get("kind")) or "", "title": (ref.title if ref is not None else u.get("title")) or "",
                    "source_id": ref.source_id if ref is not None else None, "locator": str(u.get("locator") or ""),
                    "quote": str(u.get("quote") or "")[:400], "how": str(u.get("how") or ""), "basis": u.get("basis") or "reference",
                    "verified": u.get("verified")})
    return out


def session_origins(db, s, since_revision: int = 0) -> List[Dict[str, Any]]:
    """The AI changes accepted in this session after ``since_revision``, oldest first, as the change chain reads them: who accepted
    each, on which request, from which sources, and the blocks it wrote and replaced."""
    from ....models import GRCUser, StudioMessage, StudioReference, StudioRevision
    from .. import change_chain as C

    refs = {r.ref_key: r for r in db.query(StudioReference).filter(StudioReference.session_id == s.id).all()}
    revisions = {r.number: r for r in db.query(StudioRevision).filter(StudioRevision.session_id == s.id).all()}
    by_message = {}
    for r in revisions.values():
        if r.message_id and r.author_type == "ai":
            by_message[r.message_id] = r
    messages = (db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.role == "assistant", StudioMessage.kind == "chat")
                .order_by(StudioMessage.id).all())
    users = {u.id: user_name(u) for u in db.query(GRCUser).filter(GRCUser.id.in_({m.created_by for m in messages if m.created_by} | {r.author_user_id for r in revisions.values() if r.author_user_id} or {0}))}
    out: List[Dict[str, Any]] = []
    for m in messages:
        accepted = [o for o in (m.proposal or {}).get("ops") or [] if o.get("status") == "accepted"]
        if not accepted:
            continue
        ask = (db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.role == "user", StudioMessage.id < m.id)
               .order_by(StudioMessage.id.desc()).first())
        base_rev = revisions.get(m.base_revision or 0)
        base = B.parse(base_rev.content) if base_rev else []
        for o in accepted:
            number = o.get("revision") or (by_message[m.id].number if m.id in by_message else None)
            if number is not None and number <= since_revision:
                continue
            rev = revisions.get(number) if number is not None else None
            by_id = o.get("accepted_by") or (rev.author_user_id if rev is not None else None) or m.created_by
            at = o.get("accepted_at") or (rev.created_at.isoformat() if rev is not None and rev.created_at else None)
            after = [b.digest for b in B.parse(o.get("markdown") or "")] if o["kind"] != "delete" else []
            before_md = o.get("before_markdown")
            if before_md is not None:
                before = [b.digest for b in B.parse(before_md)] if before_md else []
            elif o["kind"] == "replace_all":
                before = [b.digest for b in base]
            elif o["kind"] in ("replace", "delete"):
                first, last = B.index_of(o.get("start") or "", len(base)), B.index_of(o.get("end") or o.get("start") or "", len(base))
                before = [b.digest for b in base[first:last + 1]] if first is not None and last is not None and first >= 0 else []
            else:
                before = []
            out.append(C.make_origin("ai", by=users.get(by_id, ""), by_id=by_id, at=at, request=(ask.content if ask is not None else "")[:600],
                                     reason=str(o.get("reason") or ""), sources=_op_sources(o, m, refs), after=after, before=before,
                                     ref={"session_id": s.id, "message_id": m.id, "op_id": o["id"], "kind": o["kind"]}))
    return out


def revert_changes(db, s, frm: int, hunk_ids: Sequence[int], user, *, content_hash: Optional[str] = None,
                   version_id: Optional[int] = None) -> Dict[str, Any]:
    """Take chosen changes since revision ``frm`` (or since the library version ``version_id``, as ``tracked`` counts them) back out
    of the document as it is now (a new revision)."""
    from ....models import GovernanceDocumentVersion
    from .. import change_chain as C

    if version_id is None and frm == s.revision_no:
        raise StudioError("That is the document as it is now: there is nothing to take back.")
    if content_hash and content_hash != C.content_hash(s.content):
        raise Conflict("The document changed while you were looking at it. Open the changes again.")
    if version_id is not None:
        row = db.get(GovernanceDocumentVersion, version_id)
        earlier = C.version_text(row) if row is not None and s.document_id and row.document_id == s.document_id else None
        if earlier is None:
            raise StudioError("That version of the document cannot be read.")
        label = f"v{row.version_number}"
    else:
        label = "the start" if frm == 0 else f"version {frm}"
        earlier = revision_content(db, s, frm)
    try:
        new_md = C.revert(earlier, s.content, hunk_ids)
    except ValueError as exc:
        raise StudioError(str(exc)) from exc
    if _norm_doc(new_md) == _norm_doc(s.content):
        raise StudioError("Nothing would change.")
    taken = [h for h in C.hunks_of(earlier, s.content) if h["id"] in set(hunk_ids)]
    rev = add_revision(db, s, new_md, author_type="revert", user_id=user.id,
                       summary=f"Took back {len(set(hunk_ids))} change{'' if len(set(hunk_ids)) == 1 else 's'} made since {label}")
    _mark_reverted(db, s, taken, user.id)
    db.commit()
    return {"content": new_md, "revision": rev.number}


def _mark_reverted(db, s, taken: Sequence[Dict[str, Any]], user_id: Optional[int]) -> None:
    """An accepted change whose text was taken back through the tracked changes reads as taken back on its card too."""
    from ....models import StudioMessage

    gone = {d for h in taken for d in h["after_digests"]}
    back = {d for h in taken for d in h["before_digests"]}
    for m in db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.role == "assistant", StudioMessage.kind == "chat").all():
        ops = [dict(o) for o in (m.proposal or {}).get("ops") or []]
        changed = False
        for o in ops:
            if o.get("status") != "accepted":
                continue
            if o["kind"] == "delete":
                removed = {b.digest for b in B.parse(o.get("before_markdown") or "")}
                hit = bool(removed) and removed <= back
            else:
                written = {b.digest for b in B.parse(o.get("markdown") or "")}
                hit = bool(written) and written <= gone
            if hit:
                o["status"], o["reverted_by"], o["reverted_at"] = "reverted", user_id, _now().isoformat()
                changed = True
        if changed:
            m.proposal = {**(m.proposal or {}), "ops": ops}
            m.updated_at = _now()


def reject_ops(db, msg, op_ids: Sequence[str]) -> int:
    proposal = dict(msg.proposal or {})
    ops = [dict(o) for o in proposal.get("ops") or []]
    n = 0
    for o in ops:
        if o["id"] in set(op_ids) and o["status"] in ("pending", "conflict"):
            o["status"] = "rejected"
            n += 1
    proposal["ops"] = ops
    msg.proposal, msg.updated_at = proposal, _now()
    db.commit()
    return n


def pending_redline(db, s, msg) -> Dict[str, Any]:
    """What accepting every pending change of a message would do to the document as it is now (a preview, nothing is saved)."""
    from ....models import StudioRevision

    proposal = msg.proposal or {}
    base_rev = db.query(StudioRevision).filter(StudioRevision.session_id == s.id, StudioRevision.number == (msg.base_revision or 0)).first()
    base = B.parse(base_rev.content if base_rev else "")
    ops = [B.Op(o["id"], o["kind"], o["start"], o.get("end", ""), o["markdown"]) for o in proposal.get("ops") or []
           if o["status"] == "pending" and o["kind"] != "tidy"]          # a tidy changes the file's spacing, not the text
    proposed, status = B.apply_ops(base, ops)
    return {"rows": B.redline(base, proposed), "stats": B.stats(base, proposed), "applied": [k for k, v in status.items() if v == "applied"]}


# ── turns ────────────────────────────────────────────────────────────────────
def reap(db, s) -> None:
    """A turn whose worker died (the server restarted) is not left 'working' for ever."""
    from ....models import StudioMessage

    for m in db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.status == "working").all():
        if (m.updated_at or m.created_at) < _now() - STALE_AFTER:
            m.status, m.stage, m.error = "error", None, "Comply Agent was interrupted before it finished. Send your request again."
    db.commit()


def _working(db, s):
    from ....models import StudioMessage

    reap(db, s)
    return db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.status == "working").first()


def _answers(db, s, reply_to: int, items: Sequence[Dict[str, Any]], decide: bool) -> Tuple[Dict[str, Any], str]:
    """The person's answers to the questions of message ``reply_to``: what is kept with their message ({reply_to, items}) and the
    words the conversation shows. An option that is not one of the question's is dropped; ``decide`` (or a question left open)
    leaves the choice to Comply Agent. The questions are marked answered on their message."""
    from ....models import StudioMessage
    from . import engine

    asked = db.get(StudioMessage, reply_to)
    if asked is None or asked.session_id != s.id or asked.role != "assistant" or not asked.questions:
        raise StudioError("Those questions were not found.")
    questions = engine.questions_of(asked.questions, limit=8)
    by_id = {q["id"]: q for q in questions}
    clean: List[Dict[str, Any]] = []
    for it in items or []:
        q = by_id.get(str((it or {}).get("id") or ""))
        if q is None:
            continue
        labels = {o["label"] for o in q["options"]}
        chosen = [c for c in (str(x).strip()[:200] for x in (it.get("chosen") or [])) if c in labels][: 1 if q["kind"] == "single" else 8]
        other = str(it.get("other") or "").strip()[:1000]
        if chosen or other:
            clean.append({"id": q["id"], "question": q["question"], "chosen": chosen, "other": other})
    if not clean and not decide:
        raise StudioError("Choose or write an answer first, or let Comply Agent decide.")
    said = {a["id"]: a for a in clean}
    lines = [f"- {a['question']} {'; '.join(a['chosen'] + ([a['other']] if a['other'] else []))}" for a in clean]
    open_left = [q for q in questions if q["id"] not in said]
    text = ("My answers:\n" + "\n".join(lines) + ("\nFor the other questions, you decide." if open_left else "") if lines
            else "Decide for me, as you recommend.") + "\nPlease continue with my request."
    asked.questions = [{**q, "answer": said.get(q["id"]) or {"id": q["id"], "decide": True}} for q in questions]
    return {"reply_to": asked.id, "items": clean, "decide": [q["id"] for q in open_left]}, text


# the line that ends a request sent with files: Comply Agent reads which references came with it ("this file")
ATTACHED = "\n\nAttached with this message: "


def _attached(db, s, ids: Sequence[int]) -> List[Dict[str, Any]]:
    """The files attached with a request: references of this session (each uploaded from the chat), all of them included."""
    from ....models import StudioReference

    out: List[Dict[str, Any]] = []
    for rid in list(dict.fromkeys(ids))[:10]:
        ref = db.get(StudioReference, rid)
        if ref is None or ref.session_id != s.id:
            raise StudioError("An attached file was not found. Attach it again.")
        ref.include = True
        out.append({"id": ref.id, "key": ref.ref_key, "title": ref.title})
    return out


def start_turn(db, s, user, text: str, *, reply_to: Optional[int] = None, answers: Optional[Sequence[Dict[str, Any]]] = None, decide: bool = False,
               attachments: Optional[Sequence[int]] = None):
    """Record a request and the assistant's (working) answer to it. The caller runs ``engine.run_chat_turn`` on the returned message.
    With ``reply_to`` the request answers the questions of that message (``answers``: [{id, chosen: [labels], other}], ``decide``: the
    rest is Comply Agent's choice); the words of the request are made from the answers, followed by anything the person typed.
    ``attachments`` are the references uploaded with the request (any file): the request ends by naming them."""
    from ....models import StudioMessage

    text = (text or "").strip()
    if _working(db, s):
        raise StudioError("Comply Agent is still working on the previous request.")
    kept = None
    if reply_to is not None:
        kept, said = _answers(db, s, reply_to, answers or [], decide)
        text = said + (f"\n{text}" if text else "")
    files = _attached(db, s, attachments or [])
    if files:
        text = (text or "Read what I attached and tell me what it is and how it relates to this document.") \
            + ATTACHED + ", ".join(f'{f["key"]} "{f["title"]}"' for f in files)
    if not text:
        raise StudioError("Write what you want done.")
    db.add(StudioMessage(session_id=s.id, role="user", kind="chat", content=text, status="done", created_by=user.id, answers=kept,
                         attachments=files or None))
    db.flush()
    msg = StudioMessage(session_id=s.id, role="assistant", kind="chat", status="working", stage="Starting", created_by=user.id, base_revision=s.revision_no)
    db.add(msg)
    s.updated_at = _now()
    db.commit()
    return msg


STOPPED = "You stopped Comply Agent here. Nothing in the document changed."


def stop_turn(db, m) -> bool:
    """Stop a chat turn that is working: its message says so at once, and the worker, which looks about once a second, abandons what it
    was writing (nothing is applied). False when the turn had already finished: the row is changed only while it is "working", so a
    result written at the same moment is never overwritten."""
    from ....models import StudioMessage

    stopped = (db.query(StudioMessage).filter(StudioMessage.id == m.id, StudioMessage.kind == "chat", StudioMessage.status == "working")
               .update({"status": "stopped", "content": STOPPED, "stage": None, "live": None, "preview": None, "updated_at": _now()},
                       synchronize_session=False))
    db.commit()
    db.refresh(m)
    return stopped == 1


def start_task(db, s, user, kind: str):
    """An assistant message for a check or a comparison."""
    from ....models import StudioMessage

    if _working(db, s):
        raise StudioError("Comply Agent is still working on the previous request.")
    msg = StudioMessage(session_id=s.id, role="assistant", kind=kind, status="working", stage="Starting", created_by=user.id, base_revision=s.revision_no)
    db.add(msg)
    db.commit()
    return msg


def messages(db, s) -> List[Dict[str, Any]]:
    from ....models import StudioMessage

    reap(db, s)
    return [message_view(m) for m in db.query(StudioMessage).filter(StudioMessage.session_id == s.id).order_by(StudioMessage.id).all()]


# ── references and settings ──────────────────────────────────────────────────
def update_session(db, s, patch: Dict[str, Any]):
    if "title" in patch and str(patch["title"]).strip():
        s.title = str(patch["title"]).strip()[:500]
    if "doc_type" in patch and str(patch["doc_type"]).strip():
        s.doc_type = str(patch["doc_type"]).strip()[:50]
    if isinstance(patch.get("instructions"), dict):
        from . import setup

        merged = dict(s.instructions or {})
        for k, v in patch["instructions"].items():
            if k == "requirements":
                v = [str(x).strip() for x in (v or []) if str(x).strip()][:30]
            elif k in setup.LIST_FIELDS:
                v = setup.clean(k, v)
            elif isinstance(v, str):
                v = v.strip()[:3000]
            merged[k] = v
        s.instructions = merged
    if isinstance(patch.get("settings"), dict):
        s.settings = {**(s.settings or {}), **{k: bool(v) for k, v in patch["settings"].items() if k in ("auto_apply",)}}
    s.updated_at = _now()
    db.commit()
    return s


# ── library ──────────────────────────────────────────────────────────────────
def _resolve_slug(db) -> Optional[str]:
    tenant = _tenant(db)
    return tenant.slug if tenant else None


def _uploaded_original(s) -> Optional[Tuple[str, str]]:
    """The file the person uploaded into this session (path, name): the original of the document they are making. None for a document
    started in the studio or opened from the library (whose own file is already its first version)."""
    path = s.source_original_path
    if s.kind == "upload" and s.source_kind in ("docx", "pdf") and path and os.path.exists(path):
        return path, s.source_name or os.path.basename(path)
    return None


def _first_revision_text(db, s) -> str:
    """The session's text as it was imported from the file (revision 1)."""
    from ....models import StudioRevision

    rev = db.query(StudioRevision).filter(StudioRevision.session_id == s.id).order_by(StudioRevision.number.asc()).first()
    return rev.content if rev is not None else (s.base_content or "")


def _keep_original(upload: Tuple[str, str], folder: str) -> Dict[str, Any]:
    """A copy of the uploaded file in the library's folder: the file fields of the version that holds it."""
    import shutil

    path, name = upload
    safe = re.sub(r"[^\w.\- ]", "_", os.path.basename(name))[:120] or "document"
    kept = os.path.join(folder, f"{uuid.uuid4()}_{safe}")
    shutil.copyfile(path, kept)
    return {"file_name": name, "file_path": kept, "file_size": os.path.getsize(kept), "file_type": os.path.splitext(name)[1].lstrip(".").lower() or "docx"}


def move_to_library(db, s, user, *, title: Optional[str] = None, doc_type: Optional[str] = None, classification: Optional[str] = None,
                    parent_document_id: Optional[int] = None, framework_ids: Optional[List[int]] = None, description: Optional[str] = None,
                    owner_id: Optional[int] = None, department_id: Optional[int] = None, review_cycle_months: Optional[int] = None,
                    effective_date: Optional[datetime] = None, next_review_date: Optional[datetime] = None, change_type: Optional[str] = None):
    """Make the session's document a library document (draft, version 1.0). The session then edits that document. The classification
    and review cycle not given are the session's setup (else internal, every 12 months). An uploaded file changed here makes two
    versions, the file and then what the studio made of it: ``change_type`` is the person's minor or major for the second one
    (without it Comply Agent decides); anything else moves as one version and ``change_type`` changes nothing."""
    from ..doc_details import schedule
    from ....models import GovernanceDocument
    from ..action_logger import log_governance_action
    from ..routers.versions import create_audit_log
    from .setup import review_months

    classification = classification or str((s.instructions or {}).get("classification") or "").strip().lower() or "internal"
    review_cycle_months = review_cycle_months or review_months(s.instructions)
    if s.document_id:
        raise StudioError("This document is already in the library.")
    if not (s.content or "").strip():
        raise StudioError("The document is empty.")
    from ....models import GovernanceDocumentVersion
    from ..routers.documents import GOVERNANCE_UPLOAD_DIR

    tenant = _tenant(db)
    if parent_document_id and not db.get(GovernanceDocument, parent_document_id):
        raise StudioError("The parent document was not found.")
    name = (title or s.title).strip()[:500]
    word = is_word_in_place(s)                  # a document that came from Word stays a Word file: the original with the changes in it
    # A file the person uploaded is the original: it is kept as the first version, untouched, and what the studio changed after it is
    # the next one, so the document's history starts from what they brought (a document made in the studio has no such file).
    upload = _uploaded_original(s)
    first_text = _first_revision_text(db, s) if upload else None
    changed = upload is not None and _norm_doc(s.content) != _norm_doc(first_text or "")
    kept: Optional[Dict[str, Any]] = None
    if upload and (changed or not word):
        kept = _keep_original(upload, GOVERNANCE_UPLOAD_DIR)
    file_fields: Dict[str, Any] = {}
    if word:
        if upload and not changed:              # nothing changed since the upload: the file is the person's own, not a copy re-saved
            file_fields = _keep_original(upload, GOVERNANCE_UPLOAD_DIR)
            kept = None
        else:
            data, _ = export_file(db, s, "docx", export_settings(db, s))
            base = re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip()[:80] or "document"
            path = os.path.join(GOVERNANCE_UPLOAD_DIR, f"{uuid.uuid4()}_{base}.docx")
            with open(path, "wb") as f:
                f.write(data)
            file_fields = {"file_name": f"{base}.docx", "file_path": path, "file_size": len(data), "file_type": "docx"}
    two = kept is not None and changed          # the uploaded file, then what the studio made of it
    from .. import doc_version

    start, found_in = doc_version.detect(*upload) if upload else ("1.0", "default")
    decision = _decision(first_text or "", s.content, user, change_type, title=name) if two else None
    number = doc_version.next_version(start, decision["change"]) if decision else start
    doc = GovernanceDocument(tenant_id=tenant.id, title=name, description=description, content=None if word else s.content,
                             doc_type=doc_type or s.doc_type or "policy", classification=classification, parent_document_id=parent_document_id,
                             owner_id=owner_id or user.id, author_id=user.id, department_id=department_id, review_cycle_months=review_cycle_months or 12,
                             effective_date=effective_date, next_review_date=next_review_date,
                             framework_ids=framework_ids or [], applicable_framework_ids=framework_ids or [],
                             status="draft", current_version=number, **file_fields)
    schedule(doc)
    db.add(doc)
    db.flush()
    if two:
        db.add(GovernanceDocumentVersion(document_id=doc.id, version_number=start, change_type="major", title=doc.title, content=None if word else first_text,
                                         change_summary=doc_version.first_summary(start, found_in), status="superseded", created_by=user.id, **kept))
    row_files = file_fields if word or two or kept is None else kept         # an unchanged PDF: its text, with the uploaded file kept on the version
    first = GovernanceDocumentVersion(document_id=doc.id, version_number=number, change_type=decision["change"] if decision else "major", title=doc.title,
                                      change_summary=(doc_version.summary_of("Changed in the Comply AI Studio", decision) if decision
                                                      else doc_version.first_summary(start, found_in) if upload else "Initial version (from the Comply AI Studio)"),
                                      status="current", created_by=user.id, content=None if word else s.content, **row_files)
    db.add(first)
    # the changes after the uploaded file, or for a first version every section and what each rests on
    _record_change_set(db, s, first, (first_text or "") if two else "", s.content, user, stage_before=None, stage_after="draft")
    if word:
        s.settings = {**(s.settings or {}), "file_master": True, "library_file": file_fields["file_path"]}
    else:       # text in the library now: a session whose library file was deleted must not keep pointing at it
        s.settings = {k: v for k, v in (s.settings or {}).items() if k not in ("file_master", "library_file")}
    s.settings = {**(s.settings or {}), "saved_revision": s.revision_no}
    create_audit_log(db=db, document_id=doc.id, tenant_id=tenant.id, user_id=user.id, action="created",
                     action_details=f"Document '{doc.title}' created in the Comply AI Studio" + (f" from the uploaded file {upload[1]}" if upload else ""))
    db.commit()
    log_governance_action(db=db, tenant_id=tenant.id, action_type="document_draft_created",
                          action_description=f"Governance document draft created in the Comply AI Studio: '{doc.title}' ({doc.doc_type})",
                          entity_type="governance_document", action_user_id=user.id, entity_id=doc.id,
                          action_metadata={"doc_type": doc.doc_type, "classification": classification, "source": "ai_studio"})
    s.document_id, s.kind, s.title, s.doc_type = doc.id, "library", doc.title, doc.doc_type
    s.base_content, s.base_label, s.updated_at = s.content, f"{doc.title} v{number}", _now()
    db.commit()
    try:                                       # statements are extracted from a new document, as for any other new document
        from ..routers.documents import _resolve_tenant_slug_for_autoparse
        from ..routers.policy_parser import maybe_autoparse_document

        maybe_autoparse_document(db, _resolve_tenant_slug_for_autoparse(tenant.id), doc.id, user.id)
    except Exception:       # noqa: BLE001 - never fails the move
        logger.warning("auto-parse hook failed for studio document %s", doc.id, exc_info=True)
    return doc


def _change_set(db, s, old_text: str, new_text: str, user, *, stage_before: Optional[str], stage_after: Optional[str],
                version: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """What a save changes and where each change came from (see ``change_chain``): the session's changes since its last save. None
    when it cannot be made (the chain then compares the two texts)."""
    from .. import change_chain as C

    try:
        origins = session_origins(db, s, since_revision=int((s.settings or {}).get("saved_revision") or 0))
        for o in origins:
            o["version"] = version
        return C.build_change_set(old_text or "", new_text or "", origins, default_kind="manual", by=user_name(user), by_id=user.id,
                                  at=_now().isoformat(), extra={"session_id": s.id, "stage_before": stage_before, "stage_after": stage_after})
    except Exception:       # noqa: BLE001 - the chain is derived from the two texts when this is missing
        logger.warning("could not record the change set of version %s of studio session %s", version or "?", s.id, exc_info=True)
        return None


def _record_change_set(db, s, version_row, old_text: str, new_text: str, user, *, stage_before: Optional[str], stage_after: Optional[str]) -> None:
    """Keep on a version what it changed and where each change came from (see ``change_chain``). The save never fails over it."""
    cs = _change_set(db, s, old_text, new_text, user, stage_before=stage_before, stage_after=stage_after, version=version_row.version_number)
    if cs is not None:
        version_row.change_set = cs
    s.settings = {**(s.settings or {}), "saved_revision": s.revision_no}


def _keep_change_set(db, s, row, old_text: str, new_text: str, user, *, stage_before, stage_after, change_set=None) -> None:
    """The version's change set: as it was proposed (``change_set``, an accepted proposal: who made what then), else the session's."""
    if change_set is not None:
        row.change_set = {**change_set, "stage_before": stage_before, "stage_after": stage_after}
    elif s is not None:
        _record_change_set(db, s, row, old_text, new_text, user, stage_before=stage_before, stage_after=stage_after)


def _decision(old_text: str, new_text: str, user, change_type: Optional[str], *, title: str) -> Dict[str, str]:
    """Major or minor for a version saved to the library: the person's own choice when they made one (``change_type``), else
    Comply Agent's decision (by the rule when it cannot answer)."""
    from .. import doc_version

    if change_type in ("major", "minor"):
        return doc_version.chosen(change_type, user_name(user))
    return doc_version.decide(old_text, new_text, title=title)


def _version_row(db, doc, number: str):
    from ....models import GovernanceDocumentVersion

    return (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id, GovernanceDocumentVersion.version_number == number)
            .order_by(GovernanceDocumentVersion.id.desc()).first())


def save_to_document(db, s, user, *, change_reason: Optional[str] = None, force: bool = False, change_type: Optional[str] = None):
    """Save the session's document as the next version of its library document: a minor or a major change as the person chose
    (``change_type``; without it Comply Agent decides). The versions before it stay as they were. Someone who is not the document's
    owner or author proposes it instead (proposals.py): the library is left as it is, the session stays unsaved and waits for the
    owner, and the proposal is returned."""
    from ....models import GovernanceDocument

    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    if doc is None:
        raise StudioError("This session is not linked to a library document.")
    _may_change(db, user, doc)                        # checked again here: the right may have been taken away since the draft was opened
    from ..permissions import ensure_not_archived

    ensure_not_archived(doc)                          # archived since the draft was opened: restored first
    if (s.settings or {}).get("file_master"):
        return _save_file_version(db, s, user, doc, change_reason=change_reason, force=force, change_type=change_type)
    if _norm_doc(s.content) == _norm_doc(doc.content or ""):
        raise StudioError(f"Nothing has changed since the library version: version {doc.current_version or '1.0'} already holds every change.")
    if not force and (doc.content or "").strip() and _norm_doc(doc.content) != _norm_doc(s.base_content):
        raise Conflict("The document was changed in the library after you opened it. Reload it in the studio, or save anyway to replace it.")
    from .. import proposals

    if proposals.required(db, user, doc):
        return _propose(db, s, user, doc, change_reason=change_reason, change_type=change_type, base_text=doc.content or "")
    _save_text(db, s, user, doc, s.content, change_reason=change_reason, change_type=change_type)
    db.commit()
    return doc


def _propose(db, s, user, doc, *, change_reason: Optional[str], change_type: Optional[str], base_text: str, file=None):
    """A save to the library by someone who is not the document's owner or author: kept as a proposal (the text, and for a document
    that is its file the file it would get), who made each change as the session says it. Commits."""
    from .. import proposals

    cs = _change_set(db, s, base_text, s.content, user, stage_before=doc.status, stage_after=None)
    p = proposals.propose(db, doc, user, source="studio", message=change_reason, content=s.content, file=file, change_type=change_type,
                          session_id=s.id, change_set=cs,
                          payload={"change_reason": change_reason, "revision": s.revision_no, "file_master": file is not None})
    s.updated_at = _now()
    db.commit()
    return p


def _save_text(db, s, user, doc, content: str, *, change_reason: Optional[str], change_type: Optional[str], change_set=None,
               revision: Optional[int] = None) -> None:
    """``content`` becomes the library document's next version (Save to the library, and an accepted proposal of one, by its
    proposer: ``change_set`` as it was proposed, ``revision`` the session's then). The session, when there is one, is based on it
    now. Does not commit."""
    from ..routers.documents import _snapshot_content_version
    from ..routers.versions import create_audit_log
    from .. import doc_lifecycle
    from ..doc_version import summary_of

    old_content, old_title, old_version, old_status = doc.content, doc.title, doc.current_version or "1.0", doc.status
    decision = _decision(old_content or "", content, user, change_type, title=doc.title)
    doc.content, doc.updated_at = content, _now()
    new_version = _snapshot_content_version(db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
                                            change_type=decision["change"], change_reason=change_reason, user_id=user.id,
                                            summary=summary_of("Edited in the Comply AI Studio" + (": " + change_reason if change_reason else ""), decision))
    db.flush()
    # edited text is reviewed again: approved or published, and also while in review or approval (a new round)
    doc_lifecycle.changed_after_review(db, doc, old_status, user.id, f"Edited in the Comply AI Studio (version {new_version}), so it needs approving again")
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action="content_edited",
                     action_details=f"Edited in the Comply AI Studio; version {new_version}" + (f". {change_reason}" if change_reason else "")
                     + doc_lifecycle.outcome(old_status, doc.status, doc),
                     field_changed="current_version", old_value=old_version, new_value=new_version)
    row = _version_row(db, doc, new_version)
    if row is not None:
        _keep_change_set(db, s, row, old_content or "", content, user, stage_before=old_status, stage_after=doc.status, change_set=change_set)
    if s is not None:
        s.base_content, s.base_label, s.updated_at = content, f"{doc.title} v{new_version}", _now()
        s.settings = {k: v for k, v in (s.settings or {}).items() if k != "version_read"}       # it holds the newest version now
        if revision is not None:
            s.settings = {**s.settings, "saved_revision": revision}


def apply_proposal(db, doc, user, p) -> None:
    """A save to the library someone proposed, accepted (proposals.py): the text (or the file) as it was proposed becomes the next
    version, by them; their draft, when it is still there, is based on it from now on. Does not commit."""
    from ....models import StudioSession
    from .. import change_chain as C, proposals

    s = db.get(StudioSession, p.studio_session_id) if p.studio_session_id else None
    s = s if s is not None and s.document_id == doc.id else None
    payload = p.payload or {}
    reason, revision = payload.get("change_reason"), payload.get("revision")
    if payload.get("file_master"):
        data = proposals.file_data(p)
        if data is None:
            raise StudioError("The proposed file is no longer there. Reject this change and ask for it again.")
        _save_file(db, s, user, doc, data, p.proposed_content, base_text=C.document_text(doc) or "", change_reason=reason,
                   change_type=p.change_type, change_set=p.change_set, revision=revision)
    else:
        _save_text(db, s, user, doc, p.proposed_content, change_reason=reason, change_type=p.change_type, change_set=p.change_set,
                   revision=revision)


def write_file_version(db, doc, user, data: bytes, *, change_type: str, summary: str, reason: Optional[str], done: str, ext: str = "docx",
                       audit_action: str = "content_edited"):
    """Make ``data`` (a Word file, or a file of type ``ext``) the next version of a document that is its file, and its file. The file it
    replaces stays as the earlier version (put into its row when that row holds no file), and the original is kept first when the
    document has no versions yet. An approved or
    published document goes back to review. ``done`` is what happened, as the history says it ("Edited in the Comply AI Studio"). Does not
    commit. Returns ``(version row, version number, status before)``."""
    from ....models import GovernanceDocumentVersion
    from ..routers.documents import GOVERNANCE_UPLOAD_DIR
    from ..routers.versions import create_audit_log, increment_version
    from .. import doc_lifecycle
    from ..permissions import ensure_not_archived

    ensure_not_archived(doc)                     # every new file of a document passes here
    old_path, old_name, old_type, old_size = doc.file_path, doc.file_name, (doc.file_type or "").lower(), doc.file_size
    ext = (ext or "docx").lower().lstrip(".")
    new_name = f"{os.path.splitext(old_name or doc.title or 'document')[0]}.{ext}"
    new_path = os.path.join(GOVERNANCE_UPLOAD_DIR, f"{uuid.uuid4()}_{new_name}")
    with open(new_path, "wb") as f:
        f.write(data)
    old_version, old_status = doc.current_version or "1.0", doc.status
    versions = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id)
    if versions.count() == 0:
        db.add(GovernanceDocumentVersion(document_id=doc.id, version_number=old_version, change_type="baseline", title=doc.title, file_name=old_name,
                                         file_path=old_path, file_size=old_size, file_type=old_type, change_summary="Original document, before it was changed",
                                         status="superseded", created_by=user.id))
    else:
        replaced = versions.filter(GovernanceDocumentVersion.version_number == old_version).order_by(GovernanceDocumentVersion.id.desc()).first()
        if replaced is not None and not replaced.file_path and old_path:      # its file was put in place before its row held it
            replaced.file_name, replaced.file_path, replaced.file_size, replaced.file_type = old_name, old_path, old_size, old_type
        versions.filter(GovernanceDocumentVersion.status == "current").update({"status": "superseded"})
    new_version = increment_version(old_version, "major" if change_type == "major" else "minor")
    row = GovernanceDocumentVersion(document_id=doc.id, version_number=new_version, change_type=change_type, title=doc.title, file_name=new_name, file_path=new_path,
                                    file_size=len(data), file_type=ext, change_summary=summary, change_reason=reason, status="current", created_by=user.id)
    db.add(row)
    db.flush()
    doc.file_name, doc.file_path, doc.file_size, doc.file_type = new_name, new_path, len(data), ext
    doc.current_version, doc.updated_at = new_version, _now()
    doc_lifecycle.changed_after_review(db, doc, old_status, user.id, f"{done} (version {new_version}), so it needs approving again")
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action=audit_action,
                     action_details=f"{done}; the file was replaced by version {new_version}" + (f". {reason}" if reason else "")
                     + doc_lifecycle.outcome(old_status, doc.status, doc),
                     field_changed="current_version", old_value=old_version, new_value=new_version)
    return row, new_version, old_status


def file_bytes(db, doc, markdown: str) -> Tuple[bytes, List[str]]:
    """The file of a document that is its file, with ``markdown`` as its text, and notes about anything that could not be kept. A Word
    file is the file itself with the changes written into it; a PDF (or a Word file the changes cannot be written into safely) becomes
    a clean Word document built from the text. Raises ``ExportProblem`` when no file can be made."""
    from types import SimpleNamespace

    from . import docx_io, exporters

    notes: List[str] = []
    kind = (doc.file_type or os.path.splitext(doc.file_path or "")[1]).lower().lstrip(".")
    if kind == "docx" and doc.file_path and os.path.exists(doc.file_path):
        twin = None
        try:
            # a file with tracked changes is written into a copy with them accepted: the text we hold is the accepted text (as in a session)
            native = import_file(doc.file_path, doc.file_name or doc.file_path, twin=True).native or {}
            twin = native.get("path")
            return docx_io.export_in_place(twin or doc.file_path, markdown)
        except (docx_io.PatchProblem, ImportProblem) as exc:
            logger.warning("library document %s: the changes could not be written into its Word file: %s", doc.id, exc)
            notes.append("The changes could not be written into the original Word file safely, so this is a clean Word document built from the text.")
        finally:
            if twin and os.path.exists(twin):
                os.unlink(twin)
    elif kind == "pdf":
        notes.append("A PDF cannot be edited, so this is a Word copy built from its text.")
    else:
        notes.append("This kind of file cannot be edited in place, so this is a Word document built from its text.")
    stand_in = SimpleNamespace(instructions=_default_instructions(db, None), title=doc.title, document_id=doc.id)       # no session: the organisation's defaults
    return exporters.export(markdown, "docx", **export_settings(db, stand_in)), notes


def reanchor(db, doc, user_id: Optional[int]) -> None:
    """Statements are anchored in the new file again (organisations that have them tied to the file). Never fails the save."""
    from .. import doc_sync

    try:
        if doc_sync.enabled(db):
            doc_sync.anchor(db, doc, user_id, again=True)
    except Exception:       # noqa: BLE001 - the new version is saved; statements can be anchored again from the document
        logger.warning("could not anchor statements in the new file of document %s", doc.id, exc_info=True)


def _save_file_version(db, s, user, doc, *, change_reason: Optional[str], force: bool, change_type: Optional[str] = None):
    """Save a document that is its file (an uploaded Word or PDF) as the next version: a new file, minor or major as the person
    chose (``change_type``; without it Comply Agent decides). A Word file is the original with the changes written into it; a PDF
    cannot be edited, so its new version is a Word copy built from the text and the PDF stays as the earlier version. Statements are
    anchored in the new file again (organisations that have them tied to the file)."""
    if _norm_doc(s.content) == _norm_doc(s.base_content) and not (s.settings or {}).get("file_changed"):     # (a tidy changes the file only)
        raise StudioError(f"Nothing has changed since the library version: version {doc.current_version or '1.0'} already holds every change.")
    if not force and doc.file_path != (s.settings or {}).get("library_file"):
        raise Conflict("The file of this document was replaced in the library after you opened it. Reload it in the studio, or save anyway to replace it.")
    from .. import proposals

    data, _notes = export_file(db, s, "docx", export_settings(db, s))
    if proposals.required(db, user, doc):
        f = proposals.store_file(data, f"{os.path.splitext(doc.file_name or doc.title or 'document')[0]}.docx")
        return _propose(db, s, user, doc, change_reason=change_reason, change_type=change_type, base_text=s.base_content or "", file=f)
    _save_file(db, s, user, doc, data, s.content, base_text=s.base_content or "", change_reason=change_reason, change_type=change_type)
    db.commit()
    reanchor(db, doc, user.id)
    return doc


def _save_file(db, s, user, doc, data: bytes, content: str, *, base_text: str, change_reason: Optional[str], change_type: Optional[str],
               change_set=None, revision: Optional[int] = None) -> None:
    """``data`` becomes the next version of a document that is its file (``content`` its text): Save to the library, and an accepted
    proposal of one, by its proposer. The session, when there is one, is based on it now. Does not commit."""
    from ..doc_version import summary_of

    decision = _decision(base_text or "", content, user, change_type, title=doc.title)
    row, new_version, old_status = write_file_version(db, doc, user, data, change_type=decision["change"], reason=change_reason, done="Edited in the Comply AI Studio",
                                                      summary=summary_of("Edited in the Comply AI Studio" + (": " + change_reason if change_reason else ""), decision))
    _keep_change_set(db, s, row, base_text or "", content, user, stage_before=old_status, stage_after=doc.status, change_set=change_set)
    if s is not None:
        s.base_content, s.base_label, s.updated_at = content, f"{doc.title} v{new_version}", _now()
        s.settings = {**{k: v for k, v in (s.settings or {}).items() if k not in ("file_changed", "version_read")}, "library_file": doc.file_path}
        if revision is not None:
            s.settings = {**s.settings, "saved_revision": revision}


# ── export ───────────────────────────────────────────────────────────────────
def is_word_in_place(s) -> bool:
    """Whether the session's document came from a Word file whose formatting can be kept (its edits are written into the file)."""
    return bool(s.source_kind == "docx" and s.native_map and s.source_path and os.path.exists(s.source_path))


def word_looks(s) -> List[Dict[str, Any]]:
    """For a Word file edited in place, each block's number, indent and look in the file as it would be saved now (see
    ``word_layout.layout``); nothing for any other document, or when the changes cannot be written into the file."""
    if not is_word_in_place(s):
        return []
    return _word_looks(s.source_path, os.path.getmtime(s.source_path), s.content or "")[0]


def word_page(s) -> Optional[Dict[str, Any]]:
    """The page of a Word file edited in place: its width, margins and normal text (see ``word_layout.page``); None otherwise."""
    if not is_word_in_place(s):
        return None
    return _word_looks(s.source_path, os.path.getmtime(s.source_path), s.content or "")[1]


def source_pdf(s) -> Optional[str]:
    """The PDF the session's text was read from (to look at beside it), if it is still in the studio's folder."""
    path = os.path.abspath(s.source_original_path or "")
    return path if s.source_kind == "pdf" and path.startswith(os.path.abspath(UPLOAD_DIR) + os.sep) and os.path.isfile(path) else None


@functools.lru_cache(maxsize=8)     # ponytail: per process, the last 8 texts; a shared cache if several workers serve the studio
def _word_looks(path: str, mtime: float, content: str) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    from . import docx_io, word_layout

    try:
        data, _ = docx_io.export_in_place(path, content)
    except docx_io.PatchProblem:
        return [], None
    return word_layout.read(data, content)


def export_file(db, s, fmt: str, settings: Dict[str, Any], *, highlight: bool = True, pending: int = 0, build: bool = True) -> Tuple[bytes, List[Dict[str, Any]]]:
    """The document as a file of ``fmt`` and notes about it. A Word file that came from Word is the file itself with the changes
    written into it; when they cannot be written safely a clean Word document is built from the text, and the notes say so.
    With ``build`` off only the notes are made (an error note, or an export that needs no check, stops there)."""
    from . import docx_io, exporters

    notes = export_notes(db, s, fmt, settings, pending)
    if not build or any(n["level"] == "error" for n in notes):
        return b"", notes
    if fmt == "docx" and is_word_in_place(s):
        try:
            data, warnings = docx_io.export_in_place(s.source_path, s.content)
            notes.append({"level": "info", "rule": "word_in_place", "text": "Your original Word file is kept: only the changes were written into it, so its fonts, styles, header and footer are as they were."})
            notes += [{"level": "warning", "rule": "word_note", "text": w} for w in warnings]
            return exporters.watermark_docx(data, settings.get("watermark") or ""), notes
        except docx_io.PatchProblem as exc:
            logger.warning("studio session %s: the changes could not be written into the Word file: %s", s.id, exc)
            notes.append({"level": "warning", "rule": "word_rebuilt", "text": "The changes could not be written into your original Word file safely, so this is a clean Word document built from the text. "
                                                                         "Your original file's own formatting is not in it."})
    elif fmt == "docx" and s.source_kind == "pdf":
        notes.append({"level": "info", "rule": "word_copy", "text": "A PDF cannot be edited, so this is a Word copy built from its text."})
    return exporters.export(s.content, fmt, highlight_placeholders=highlight, **settings), notes
def export_settings(db, s, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What the exporters need besides the Markdown: the entity name and logo from the session's instructions (the person may
    override either for one export), and the document code, version and classification when the session is a library document
    (the version the session was read at: for staff the one in force, not a newer one on its way)."""
    from ....models import GovernanceDocument, StudioAsset
    from . import assets

    ins = {**(s.instructions or {}), **{k: v for k, v in (overrides or {}).items() if v is not None}}
    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    logo = db.get(StudioAsset, ins["logo_asset_id"]) if ins.get("logo_asset_id") and not ins.get("no_logo") else None
    read = (getattr(s, "settings", None) or {}).get("version_read")
    return {"title": s.title, "entity_name": str(ins.get("entity_name") or ""), "logo_path": assets.path_of(logo) if logo else None,
            "logo_position": ins.get("logo_position") or "header-left", "doc_code": (doc.document_code if doc else "") or "",
            "version": (read or (doc.current_version if doc else "")) or "", "classification": ((doc.classification if doc else ins.get("classification")) or ""),
            "watermark": watermark_text(ins)}


def watermark_text(ins: Dict[str, Any]) -> str:
    """The words written faintly across every page of an export, or "" when the person did not ask for a watermark."""
    if not ins.get("watermark"):
        return ""
    return str(ins.get("watermark_text") or "").strip()[:40] or "DRAFT"


def export_name(s, fmt: str, version: str = "") -> str:
    base = re.sub(r"[^\w\- ]+", "", s.title or "", flags=re.UNICODE).strip().replace(" ", "-")[:80] or "document"
    return f"{base}{'-v' + version if version else ''}.{fmt}"


def export_notes(db, s, fmt: str, settings: Dict[str, Any], pending_changes: int = 0) -> List[Dict[str, Any]]:
    """What the person should know before exporting: ``[{level: error|warning|info, text}]``. An error stops the export."""
    from . import checks, exporters

    notes: List[Dict[str, Any]] = []
    left = sum(1 for p in checks.placeholders(B.parse(s.content)) if p["required"])
    if left:
        notes.append({"level": "warning", "rule": "placeholders", "count": left,
                      "text": f"{left} placeholder{'s' if left != 1 else ''} still to be filled in. " + ("They stay as written in the text." if fmt == "md" else "They are highlighted in the file.")})
    if pending_changes:
        notes.append({"level": "info", "rule": "pending", "count": pending_changes,
                      "text": f"{pending_changes} change{'s' if pending_changes != 1 else ''} proposed by Comply Agent {'is' if pending_changes == 1 else 'are'} not accepted yet, so not in the file."})
    if settings.get("watermark") and fmt in ("docx", "pdf", "html"):
        notes.append({"level": "info", "rule": "watermark", "text": f"Every page carries the watermark “{settings['watermark']}”. Turn it off in Instructions."})
    ins = s.instructions or {}
    if not (fmt == "docx" and is_word_in_place(s)):          # a Word file that came from Word keeps its own header; the studio's is not added
        if not settings["entity_name"]:
            notes.append({"level": "warning", "rule": "entity", "text": "No entity name is set, so the header will not name the organisation."})
        if ins.get("logo_required") and not settings["logo_path"]:
            notes.append({"level": "warning", "rule": "logo", "text": "A logo is required for this document but none is available."})
        elif fmt in ("docx", "pdf", "html") and not settings["logo_path"]:
            notes.append({"level": "info", "rule": "logo", "text": "No logo is selected, so the header shows the entity name only."})
    if fmt == "pdf" and exporters._RTL.search(s.content or ""):
        notes.append({"level": "error", "rule": "rtl", "text": "A PDF cannot show right-to-left text (Arabic, Hebrew, Urdu) correctly yet. Export to Word instead."})
    if fmt == "md":
        notes.append({"level": "info", "rule": "plain", "text": "Markdown carries the text and structure only; there is no logo, header or footer."})
    return notes


def delete_session(db, s, user) -> None:
    """Discards a draft that was never in the library, or removes from the person's work a library document they may not save (a
    reader's comparison; the document stays). Their work on a document they may change (an upload is one) is archived there instead."""
    from ....models import StudioMessage, StudioReference, StudioRevision

    if s.document_id and may_save(db, s, user):
        raise StudioError("This document is in the library, so it cannot be deleted here. Archive it from the library instead.")
    for model in (StudioMessage, StudioReference, StudioRevision):
        db.query(model).filter(model.session_id == s.id).delete(synchronize_session=False)
    for path in {s.source_original_path, s.source_path}:
        if path and os.path.exists(path) and os.path.abspath(path).startswith(os.path.abspath(UPLOAD_DIR)):
            try:
                os.unlink(path)
            except OSError:
                pass
    db.delete(s)
    db.commit()
