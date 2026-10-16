"""What the AI Studio's view of a library document needs, without opening a studio session: who may change or publish it, whether
the studio can open its file, and the person's own draft of it.

* Who may change it (the user's decision of 2026-10-16): its owner, its author, and whoever holds governance:policies:edit;
  publishing needs governance:policies:publish. Administrators and the organisation's primary contact always may
  (``admin_router.check_permission``). The screens hide what a person may not do; the server enforces it later (plan P5).
* One draft per person per document: Edit reuses the person's newest active session of the document. A draft with nothing unsaved
  whose library document moved on since is replaced by a fresh one (its instructions and references come along); one with unsaved
  work is offered as it is, marked stale, and ``fresh`` starts again. Replaced drafts are archived, never deleted.
"""
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GovernanceDocument, GRCUser, StudioReference, StudioSession, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import doc_lifecycle
from ..studio import references as refs
from ..studio import service, setup
from ..studio.importers import ALLOWED_EXTENSIONS, ImportProblem
from ..studio.router import require_studio
from .document_signoff import _doc_or_404

router = APIRouter(prefix="/studio", tags=["Governance - AI Studio"])


def can_edit(db: Session, user: GRCUser, doc: GovernanceDocument) -> bool:
    from ....routers.admin_router import check_permission

    return user.id in (doc.owner_id, doc.author_id) or check_permission(user, db, "governance:policies:edit")


def can_publish(db: Session, user: GRCUser) -> bool:
    from ....routers.admin_router import check_permission

    return check_permission(user, db, "governance:policies:publish")


def _openable(doc: GovernanceDocument) -> Tuple[bool, Optional[str]]:
    """Whether the studio can open the document (as ``service.create_session`` does), and why not."""
    import os

    if (doc.content or "").strip():
        return True, None
    if not doc.file_path or not os.path.exists(doc.file_path):
        return False, "This document has no text or file yet. Add its text, or upload its file, to work on it in the AI Studio."
    ext = os.path.splitext(doc.file_name or doc.file_path)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return False, f"The AI Studio opens Word, PDF, text, Markdown and web files; this one is {ext or 'of an unknown type'}. Download it to work on it."
    return True, None


def _draft(db: Session, doc: GovernanceDocument, user: GRCUser) -> Optional[StudioSession]:
    return (db.query(StudioSession).filter(StudioSession.created_by == user.id, StudioSession.document_id == doc.id,
                                           StudioSession.status == "active")
            .order_by(StudioSession.updated_at.desc(), StudioSession.id.desc()).first())


def _state(doc: GovernanceDocument, s: StudioSession) -> Tuple[bool, bool]:
    """(behind: the library changed since the draft was opened or last saved, unsaved: the draft has work not in the library)."""
    settings = s.settings or {}
    if settings.get("file_master"):
        behind = doc.file_path != settings.get("library_file")
        unsaved = service._norm_doc(s.content) != service._norm_doc(s.base_content) or bool(settings.get("file_changed"))
    else:
        behind = service._norm_doc(doc.content or "") != service._norm_doc(s.base_content)
        unsaved = service._norm_doc(s.content) != service._norm_doc(s.base_content)
    return behind, unsaved


def _draft_view(doc: GovernanceDocument, s: Optional[StudioSession]) -> Optional[Dict[str, Any]]:
    if s is None:
        return None
    behind, unsaved = _state(doc, s)
    return {"session_id": s.id, "behind": behind, "unsaved": unsaved, "base_label": s.base_label,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None}


@router.get("/documents/{document_id}/access", dependencies=[Depends(require_studio)])
def document_access(document_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Reads only: what this person may do with the document, and their draft of it."""
    doc = _doc_or_404(document_id, get_user_tenants(user, db), db)
    openable, reason = _openable(doc)
    return {"document_id": doc.id, "status": doc.status, "version": doc.current_version or "1.0",
            "can_edit": can_edit(db, user, doc), "can_publish": can_publish(db, user), "lifecycle": doc_lifecycle.enabled(db),
            "openable": openable, "reason": reason, "draft": _draft_view(doc, _draft(db, doc, user))}


class DraftIn(BaseModel):
    fresh: bool = False          # start again from the library version, setting the current draft aside


def _carry(db: Session, old: StudioSession, new: StudioSession) -> None:
    """A replaced draft's library documents and frameworks come along (an uploaded file or a template cannot be found again from
    the reference, so those stay with the old draft)."""
    have = {(r.kind, r.source_id) for r in db.query(StudioReference).filter(StudioReference.session_id == new.id)}
    for r in db.query(StudioReference).filter(StudioReference.session_id == old.id).order_by(StudioReference.id):
        if r.kind in ("upload", "template") or r.source_id is None or (r.kind, r.source_id) in have:
            continue
        try:
            refs.attach(db, new, r.kind, source_id=r.source_id, scope=r.scope)
        except refs.ReferenceProblem:
            continue


@router.post("/documents/{document_id}/draft", dependencies=[Depends(require_studio)])
def open_draft(document_id: int, body: Optional[DraftIn] = None, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The person's one draft of the document: reused, replaced when it is clean and the library moved on, or started."""
    fresh = bool(body and body.fresh)
    doc = _doc_or_404(document_id, get_user_tenants(user, db), db)
    if not can_edit(db, user, doc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Only the document's owner, its author or someone allowed to edit documents can change it.")
    # two tabs asking at once still give one draft
    db.query(GovernanceDocument.id).filter(GovernanceDocument.id == doc.id).with_for_update().first()
    s, stale, old = _draft(db, doc, user), False, None
    if s is not None:
        behind, unsaved = _state(doc, s)
        if fresh or (behind and not unsaved):
            old, s = s, None
        elif behind:
            stale = True                      # unsaved work on an older version: the person chooses (fresh=true starts again)
    created = s is None
    if created:
        facts = setup.from_document(db, doc)
        carried = dict(old.instructions or {}) if old is not None else {}
        instructions = {**facts, **carried, **{k: facts[k] for k in ("classification", "review_cycle") if k in facts}}   # the document's own facts win
        try:
            s = service.create_session(db, user, kind="library", document_id=doc.id, instructions=instructions)
        except (service.StudioError, ImportProblem) as exc:
            db.rollback()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
        if old is not None:
            old.status, old.updated_at = "archived", service._now()
            _carry(db, old, s)
    s.last_opened_at = service._now()
    db.commit()
    return {"session_id": s.id, "created": created, "stale": stale, "replaced": old.id if old is not None else None,
            "base_label": s.base_label, "library_version": doc.current_version or "1.0"}
