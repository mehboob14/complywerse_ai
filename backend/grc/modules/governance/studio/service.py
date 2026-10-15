"""Studio sessions: starting one, saving the document, accepting the AI's changes, and moving the result into the library.

A session is a working document with its chat, revisions and references. It is not a library document until the person moves
it there; a session opened on a library document saves back to it as a new version. Nothing the AI proposes touches the
document until it is accepted, and an accepted change is placed by block, so a person who kept typing meanwhile loses nothing:
a change whose blocks they edited is reported as a conflict instead of overwriting their words.
"""
from __future__ import annotations

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
            "scope": {k: scope.get(k) for k in ("mode", "domains", "count", "total") if k in scope} or None, "notes": scope.get("notes", [])}


def session_view(db, s, *, content: bool = True) -> Dict[str, Any]:
    from ....models import StudioReference

    rows = db.query(StudioReference).filter(StudioReference.session_id == s.id).order_by(StudioReference.id).all()
    blocks = B.parse(s.content)
    out = {"id": s.id, "title": s.title, "kind": s.kind, "doc_type": s.doc_type, "status": s.status, "document_id": s.document_id,
           "revision": s.revision_no, "base_label": s.base_label, "instructions": s.instructions or {}, "settings": s.settings or {},
           "template_id": s.template_id, "source": {"kind": s.source_kind, "name": s.source_name, "in_place": bool(s.source_kind == "docx" and s.native_map)},
           "references": [ref_view(r) for r in rows], "reference_chars": refs.total_chars(rows),
           "words": sum(b.words for b in blocks), "blocks": len(blocks),
           "created_at": s.created_at.isoformat() if s.created_at else None, "updated_at": s.updated_at.isoformat() if s.updated_at else None}
    if content:
        out["content"] = s.content
    return out


def message_view(m) -> Dict[str, Any]:
    return {"id": m.id, "role": m.role, "kind": m.kind, "content": m.content, "status": m.status, "stage": m.stage, "error": m.error,
            "proposal": m.proposal, "references_used": m.references_used or [], "questions": m.questions or [], "notes": m.notes or [],
            "base_revision": m.base_revision, "usage": m.usage, "created_at": m.created_at.isoformat() if m.created_at else None}


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
                   document_id: Optional[int] = None, upload: Optional[tuple] = None, instructions: Optional[Dict[str, Any]] = None):
    """Start a session: a new document (from a template or blank), a library document, or an uploaded file."""
    from ....models import GovernanceDocument, StudioSession

    s = StudioSession(tenant_id=(_tenant(db).id if _tenant(db) else 1), created_by=user.id, title=(title or "Untitled document").strip()[:500],
                      kind=kind, doc_type=doc_type or "policy", instructions={}, settings={}, status="active", last_opened_at=_now())
    summary, content, base, base_label = "", "", "", None
    if kind == "new":
        template = templates.resolve(db, template_id or "default", s.doc_type)
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
        s.title, s.doc_type, s.document_id = doc.title, doc.doc_type or "policy", doc.id
        file_type = (doc.file_type or "").lower().lstrip(".")
        if not (doc.content or "").strip() and doc.file_path and os.path.exists(doc.file_path) and file_type in ("docx", "pdf"):
            # a document that is its file (an uploaded Word or PDF): the studio works on a copy of the file, a Word file is edited in place
            copy = _copy_into_studio(db, doc.file_path, doc.file_name or f"document.{file_type}")
            try:
                imported = import_file(copy, doc.file_name or copy, twin=True)
            except ImportProblem as exc:
                os.unlink(copy)
                raise StudioError(str(exc)) from exc
            content, base = imported.markdown, imported.base_markdown if imported.base_markdown is not None else imported.markdown
            s.source_kind, s.source_name, s.source_original_path, s.source_path = imported.kind, doc.file_name, copy, copy
            if imported.native:
                s.native_map, s.source_path = imported.native.get("map"), imported.native.get("path") or copy
            s.settings = {"file_master": True, "library_file": doc.file_path}
            base_label = f"{doc.title} v{doc.current_version or '1.0'}" + ("" if imported.base_markdown is None else " before its tracked changes")
            summary = f"Opened from the library (v{doc.current_version or '1.0'})" + "".join(f" ({n})" for n in imported.notes[:1])
        else:
            try:
                content, notes = refs.library_text(db, doc)
            except refs.ReferenceProblem as exc:
                raise StudioError(str(exc)) from exc
            base, base_label, summary = content, f"{doc.title} v{doc.current_version or '1.0'}", f"Opened from the library (v{doc.current_version or '1.0'})"
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
        base_label = f"{name} as uploaded" if imported.base_markdown is None else f"{name} before its tracked changes"
        summary = "Opened from " + name + ("".join(f" ({n})" for n in imported.notes[:1]))
    else:
        raise StudioError("Unknown way to start a session.")
    s.instructions = _default_instructions(db, instructions)
    s.content, s.base_content, s.base_label = content, base, base_label
    db.add(s)
    db.flush()
    add_revision(db, s, content, author_type="import" if kind != "new" else "system", user_id=user.id, summary=summary)
    db.commit()
    return s


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
    """The redline between two revisions (0 = the baseline the session started from; any other number a revision)."""
    a, b = B.parse(revision_content(db, s, frm)), B.parse(revision_content(db, s, to))
    return {"from": frm, "to": to, "rows": B.redline(a, b), "stats": B.stats(a, b)}


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
    translated: List[B.Op] = []
    conflicts = 0
    for o in chosen:
        markdown = (overrides or {}).get(o["id"], o["markdown"])
        o["markdown"] = markdown
        if o["kind"] == "replace_all":
            if same or B.is_blank(now):
                translated.append(B.Op(o["id"], "replace_all", markdown=markdown))
            else:
                o["status"], o["why"] = "conflict", "The document was changed after the AI read it."
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
            o["status"], o["why"] = "conflict", "The text it changes was edited after the AI read it."
            conflicts += 1
            continue
        translated.append(B.Op(o["id"], o["kind"], start=f"B{where[first] + 1}", end=f"B{where[last] + 1}", markdown=markdown))
    new_blocks, status = B.apply_ops(now, translated)
    applied = [o for o in chosen if status.get(o["id"]) == "applied"]
    for o in chosen:
        if o["status"] == "pending":
            if status.get(o["id"]) == "applied":
                o["status"] = "accepted"
            else:
                o["status"], o["why"] = "conflict", status.get(o["id"], "It could not be placed.")
                conflicts += 1
    if applied:
        add_revision(db, s, B.render(new_blocks), author_type="ai", user_id=user_id,
                     summary=(summary or ("The AI wrote the first draft" if auto and B.is_blank(now) else f"Accepted {len(applied)} AI change(s)")), message_id=msg.id)
    proposal["ops"] = ops
    msg.proposal = proposal
    msg.updated_at = _now()
    db.commit()
    return {"accepted": len(applied), "conflicts": conflicts}


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
    ops = [B.Op(o["id"], o["kind"], o["start"], o.get("end", ""), o["markdown"]) for o in proposal.get("ops") or [] if o["status"] == "pending"]
    proposed, status = B.apply_ops(base, ops)
    return {"rows": B.redline(base, proposed), "stats": B.stats(base, proposed), "applied": [k for k, v in status.items() if v == "applied"]}


# ── turns ────────────────────────────────────────────────────────────────────
def reap(db, s) -> None:
    """A turn whose worker died (the server restarted) is not left 'working' for ever."""
    from ....models import StudioMessage

    for m in db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.status == "working").all():
        if (m.updated_at or m.created_at) < _now() - STALE_AFTER:
            m.status, m.stage, m.error = "error", None, "The AI was interrupted before it finished. Send your request again."
    db.commit()


def _working(db, s):
    from ....models import StudioMessage

    reap(db, s)
    return db.query(StudioMessage).filter(StudioMessage.session_id == s.id, StudioMessage.status == "working").first()


def start_turn(db, s, user, text: str):
    """Record a request and the assistant's (working) answer to it. The caller runs ``engine.run_chat_turn`` on the returned message."""
    from ....models import StudioMessage

    text = (text or "").strip()
    if not text:
        raise StudioError("Write what you want done.")
    if _working(db, s):
        raise StudioError("The AI is still working on the previous request.")
    db.add(StudioMessage(session_id=s.id, role="user", kind="chat", content=text, status="done", created_by=user.id))
    db.flush()
    msg = StudioMessage(session_id=s.id, role="assistant", kind="chat", status="working", stage="Starting", created_by=user.id, base_revision=s.revision_no)
    db.add(msg)
    s.updated_at = _now()
    db.commit()
    return msg


def start_task(db, s, user, kind: str):
    """An assistant message for a check or a comparison."""
    from ....models import StudioMessage

    if _working(db, s):
        raise StudioError("The AI is still working on the previous request.")
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
        merged = dict(s.instructions or {})
        for k, v in patch["instructions"].items():
            if k == "requirements":
                v = [str(x).strip() for x in (v or []) if str(x).strip()][:30]
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


def move_to_library(db, s, user, *, title: Optional[str] = None, doc_type: Optional[str] = None, classification: str = "internal",
                    parent_document_id: Optional[int] = None, framework_ids: Optional[List[int]] = None, description: Optional[str] = None):
    """Make the session's document a library document (draft, version 1.0). The session then edits that document."""
    from ....models import GovernanceDocument
    from ..action_logger import log_governance_action
    from ..routers.versions import create_audit_log

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
    file_fields: Dict[str, Any] = {}
    if word:
        data, _ = export_file(db, s, "docx", export_settings(db, s))
        base = re.sub(r"[^\w\- ]+", "", name, flags=re.UNICODE).strip()[:80] or "document"
        path = os.path.join(GOVERNANCE_UPLOAD_DIR, f"{uuid.uuid4()}_{base}.docx")
        with open(path, "wb") as f:
            f.write(data)
        file_fields = {"file_name": f"{base}.docx", "file_path": path, "file_size": len(data), "file_type": "docx"}
    doc = GovernanceDocument(tenant_id=tenant.id, title=name, description=description, content=None if word else s.content,
                             doc_type=doc_type or s.doc_type or "policy", classification=classification, parent_document_id=parent_document_id,
                             owner_id=user.id, author_id=user.id, framework_ids=framework_ids or [], applicable_framework_ids=framework_ids or [],
                             status="draft", current_version="1.0", **file_fields)
    db.add(doc)
    db.flush()
    if word:
        db.add(GovernanceDocumentVersion(document_id=doc.id, version_number="1.0", change_type="major", title=doc.title, change_summary="Initial version (from the AI Studio)",
                                         status="current", created_by=user.id, **file_fields))
        s.settings = {**(s.settings or {}), "file_master": True, "library_file": file_fields["file_path"]}
    else:       # text in the library now: a session whose library file was deleted must not keep pointing at it
        s.settings = {k: v for k, v in (s.settings or {}).items() if k not in ("file_master", "library_file")}
    create_audit_log(db=db, document_id=doc.id, tenant_id=tenant.id, user_id=user.id, action="created",
                     action_details=f"Document '{doc.title}' created in the AI Studio")
    db.commit()
    log_governance_action(db=db, tenant_id=tenant.id, action_type="document_draft_created",
                          action_description=f"Governance document draft created in the AI Studio: '{doc.title}' ({doc.doc_type})",
                          entity_type="governance_document", action_user_id=user.id, entity_id=doc.id,
                          action_metadata={"doc_type": doc.doc_type, "classification": classification, "source": "ai_studio"})
    s.document_id, s.kind, s.title, s.doc_type = doc.id, "library", doc.title, doc.doc_type
    s.base_content, s.base_label, s.updated_at = s.content, f"{doc.title} v1.0", _now()
    db.commit()
    try:                                       # statements are extracted from a new document, as for any other new document
        from ..routers.documents import _resolve_tenant_slug_for_autoparse
        from ..routers.policy_parser import maybe_autoparse_document

        maybe_autoparse_document(db, _resolve_tenant_slug_for_autoparse(tenant.id), doc.id, user.id)
    except Exception:       # noqa: BLE001 - never fails the move
        logger.warning("auto-parse hook failed for studio document %s", doc.id, exc_info=True)
    return doc


def save_to_document(db, s, user, *, change_reason: Optional[str] = None, force: bool = False):
    """Save the session's document as the next version of its library document."""
    from ....models import GovernanceDocument
    from ..routers.documents import _snapshot_content_version
    from ..routers.versions import create_audit_log
    from .. import doc_lifecycle

    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    if doc is None:
        raise StudioError("This session is not linked to a library document.")
    if (s.settings or {}).get("file_master"):
        return _save_file_version(db, s, user, doc, change_reason=change_reason, force=force)
    if _norm_doc(s.content) == _norm_doc(doc.content or ""):
        raise StudioError("Nothing has changed since the library version.")
    if not force and (doc.content or "").strip() and _norm_doc(doc.content) != _norm_doc(s.base_content):
        raise Conflict("The document was changed in the library after you opened it. Reload it in the studio, or save anyway to replace it.")
    old_content, old_title, old_version, old_status = doc.content, doc.title, doc.current_version or "1.0", doc.status
    doc.content, doc.updated_at = s.content, _now()
    new_version = _snapshot_content_version(db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
                                            change_type="studio", change_reason=change_reason, user_id=user.id)
    if old_status in ("approved", "published", "exception_applied"):       # edited text needs approving again
        doc.status = "pending_review"
        doc_lifecycle.on_status_changed(db, doc, old_status, "pending_review", user.id)
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action="content_edited",
                     action_details=f"Edited in the AI Studio; version {new_version}" + (f". {change_reason}" if change_reason else "")
                     + ("; sent back to review" if doc.status != old_status else ""),
                     field_changed="current_version", old_value=old_version, new_value=new_version)
    s.base_content, s.base_label, s.updated_at = s.content, f"{doc.title} v{new_version}", _now()
    db.commit()
    return doc


def _save_file_version(db, s, user, doc, *, change_reason: Optional[str], force: bool):
    """Save a document that is its file (an uploaded Word or PDF) as the next version: a new file. A Word file is the original with
    the changes written into it; a PDF cannot be edited, so its new version is a Word copy built from the text and the PDF stays as
    the earlier version. Statements are anchored in the new file again (organisations that have them tied to the file)."""
    from ....models import GovernanceDocumentVersion
    from ..routers.documents import GOVERNANCE_UPLOAD_DIR
    from ..routers.versions import create_audit_log, increment_version
    from .. import doc_lifecycle, doc_sync

    if _norm_doc(s.content) == _norm_doc(s.base_content):
        raise StudioError("Nothing has changed since the library version.")
    if not force and doc.file_path != (s.settings or {}).get("library_file"):
        raise Conflict("The file of this document was replaced in the library after you opened it. Reload it in the studio, or save anyway to replace it.")
    data, _notes = export_file(db, s, "docx", export_settings(db, s))
    old_path, old_name, old_type, old_size = doc.file_path, doc.file_name, (doc.file_type or "").lower(), doc.file_size
    new_name = f"{os.path.splitext(old_name or doc.title or 'document')[0]}.docx"
    new_path = os.path.join(GOVERNANCE_UPLOAD_DIR, f"{uuid.uuid4()}_{new_name}")
    with open(new_path, "wb") as f:
        f.write(data)
    old_version, old_status = doc.current_version or "1.0", doc.status
    versions = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id)
    if versions.count() == 0:
        db.add(GovernanceDocumentVersion(document_id=doc.id, version_number=old_version, change_type="baseline", title=doc.title, file_name=old_name,
                                         file_path=old_path, file_size=old_size, file_type=old_type, change_summary="Original document, before it was edited in the AI Studio",
                                         status="superseded", created_by=user.id))
    else:
        versions.filter(GovernanceDocumentVersion.status == "current").update({"status": "superseded"})
    new_version = increment_version(old_version, "minor")
    row = GovernanceDocumentVersion(document_id=doc.id, version_number=new_version, change_type="studio", title=doc.title, file_name=new_name, file_path=new_path,
                                    file_size=len(data), file_type="docx", change_summary="Edited in the AI Studio" + (": " + change_reason if change_reason else ""),
                                    change_reason=change_reason, status="current", created_by=user.id)
    db.add(row)
    db.flush()
    doc.file_name, doc.file_path, doc.file_size, doc.file_type = new_name, new_path, len(data), "docx"
    doc.current_version, doc.updated_at = new_version, _now()
    if old_status in ("approved", "published", "exception_applied"):
        doc.status = "pending_review"
        doc_lifecycle.on_status_changed(db, doc, old_status, "pending_review", user.id)
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action="content_edited",
                     action_details=f"Edited in the AI Studio; the file was replaced by version {new_version}" + (f". {change_reason}" if change_reason else "")
                     + ("; sent back to review" if doc.status != old_status else ""),
                     field_changed="current_version", old_value=old_version, new_value=new_version)
    s.base_content, s.base_label, s.updated_at = s.content, f"{doc.title} v{new_version}", _now()
    s.settings = {**(s.settings or {}), "library_file": new_path}
    db.commit()
    try:
        if doc_sync.enabled(db):
            doc_sync.anchor(db, doc, user.id, again=True)
    except Exception:       # noqa: BLE001 - the new version is saved; statements can be anchored again from the document
        logger.warning("could not anchor statements in the new file of document %s", doc.id, exc_info=True)
    return doc


# ── export ───────────────────────────────────────────────────────────────────
def is_word_in_place(s) -> bool:
    """Whether the session's document came from a Word file whose formatting can be kept (its edits are written into the file)."""
    return bool(s.source_kind == "docx" and s.native_map and s.source_path and os.path.exists(s.source_path))


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
            return data, notes
        except docx_io.PatchProblem as exc:
            logger.warning("studio session %s: the changes could not be written into the Word file: %s", s.id, exc)
            notes.append({"level": "warning", "rule": "word_rebuilt", "text": "The changes could not be written into your original Word file safely, so this is a clean Word document built from the text. "
                                                                         "Your original file's own formatting is not in it."})
    elif fmt == "docx" and s.source_kind == "pdf":
        notes.append({"level": "info", "rule": "word_copy", "text": "A PDF cannot be edited, so this is a Word copy built from its text."})
    return exporters.export(s.content, fmt, highlight_placeholders=highlight, **settings), notes
def export_settings(db, s, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """What the exporters need besides the Markdown: the entity name and logo from the session's instructions (the person may
    override either for one export), and the document code, version and classification when the session is a library document."""
    from ....models import GovernanceDocument, StudioAsset
    from . import assets

    ins = {**(s.instructions or {}), **{k: v for k, v in (overrides or {}).items() if v is not None}}
    doc = db.get(GovernanceDocument, s.document_id) if s.document_id else None
    logo = db.get(StudioAsset, ins["logo_asset_id"]) if ins.get("logo_asset_id") and not ins.get("no_logo") else None
    return {"title": s.title, "entity_name": str(ins.get("entity_name") or ""), "logo_path": assets.path_of(logo) if logo else None,
            "logo_position": ins.get("logo_position") or "header-left", "doc_code": (doc.document_code if doc else "") or "",
            "version": (doc.current_version if doc else "") or "", "classification": ((doc.classification if doc else ins.get("classification")) or "")}


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
                      "text": f"{pending_changes} change{'s' if pending_changes != 1 else ''} proposed by the AI {'is' if pending_changes == 1 else 'are'} not accepted yet, so not in the file."})
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


def delete_session(db, s) -> None:
    from ....models import StudioMessage, StudioReference, StudioRevision

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
