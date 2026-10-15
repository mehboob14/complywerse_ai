"""A document's change chain: every version with what it changed from -> to, who changed it and on whose request, the approvals
between the versions, the document as a redline against any earlier version (with a way to take a change back), and the whole
chain as an Excel / PDF / CSV catalog. Tenants that do not have the document life cycle get ``{"enabled": false}``.

Reading never writes. Taking a change back is an ordinary edit: a new version by the person who did it, which sends an approved
or published document back to review (the same rule the AI Studio follows when it saves a document).
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GovernanceDocumentVersion, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import change_chain as C
from .. import change_chain_export, doc_lifecycle
from .document_signoff import _doc_or_404
from .documents import _snapshot_content_version, create_audit_log

router = APIRouter(prefix="/documents", tags=["Governance - Change chain"])


def _enabled_or_404(db: Session) -> None:
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The change chain is not enabled for this organisation")


@router.get("/{document_id}/change-chain")
def get_chain(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    return C.chain(db, doc)


@router.get("/{document_id}/change-chain/redline")
def get_redline(document_id: int, from_version: int = Query(..., alias="from"), to: Optional[int] = None,
                db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The document as it changed from version ``from`` to version ``to`` (the document as it is now when ``to`` is left out):
    rows to read, the changes with who made each and on whose request, and whether they can be taken back here."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    try:
        out = C.redline(db, doc, from_version, to)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    out["versions"] = C.baseline_options(db, doc)
    return out


class RevertIn(BaseModel):
    from_version_id: int                         # the version the changes are counted from
    hunks: List[int]                             # the changes to take back, by the ids the redline gave them
    hash: Optional[str] = None                   # the redline's fingerprint of the document: an edit made meanwhile is refused
    reason: Optional[str] = None


@router.post("/{document_id}/change-chain/revert")
def revert_changes(document_id: int, body: RevertIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Take chosen changes back to what an earlier version had, leaving every other change as it is. A new version."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    _enabled_or_404(db)
    if not (doc.content or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="This document is its file. Open it in the AI Studio to take a change back.")
    base_v = db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.id == body.from_version_id,
                                                        GovernanceDocumentVersion.document_id == doc.id).first()
    if base_v is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That version was not found for this document.")
    base_text = C.version_text(base_v)
    if base_text is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The text of that version cannot be read.")
    old_content = doc.content
    if body.hash and body.hash != C.content_hash(old_content):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The document was edited while you were looking at it. Open the changes again.")
    wanted = set(body.hunks)
    locked = [h for h in C.hunks_of(base_text, old_content) if h["id"] in wanted and h["locked"]]
    if locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A sign-off record cannot be taken back: it is stamped by the sign-off.")
    try:
        new_content = C.revert(base_text, old_content, wanted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if C.content_hash(new_content) == C.content_hash(old_content):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing would change.")

    n = len(wanted)
    reason = (body.reason or "").strip() or f"Took back {n} change{'' if n == 1 else 's'} made since version {base_v.version_number}"
    old_title, old_version, old_status = doc.title, doc.current_version or "1.0", doc.status
    name = current_user.display_name or current_user.username or "A user"
    doc.content, doc.updated_at = new_content, datetime.utcnow()
    new_version = _snapshot_content_version(db, doc, old_content=old_content, old_title=old_title, old_version=old_version,
                                            change_type="revert", change_reason=reason, user_id=current_user.id)
    db.flush()
    row = (db.query(GovernanceDocumentVersion).filter(GovernanceDocumentVersion.document_id == doc.id, GovernanceDocumentVersion.version_number == new_version)
           .order_by(GovernanceDocumentVersion.id.desc()).first())
    if row is not None:
        row.change_summary = reason
        cs = C.build_change_set(old_content, new_content, [], default_kind="revert", by=name, by_id=current_user.id, at=datetime.utcnow().isoformat(),
                                extra={"reverts": {"since_version": base_v.version_number, "changes": n}, "stage_before": old_status})
        for item in cs["items"]:
            item["reason"] = reason
        row.change_set = cs
    if old_status in ("approved", "published", "exception_applied"):
        doc.status = "pending_review"
        create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="status_changed", field_changed="status",
                         old_value=old_status, new_value="pending_review", action_details=f"Changes were taken back (version {new_version}), so it needs approving again")
        doc_lifecycle.on_status_changed(db, doc, old_status, "pending_review", current_user.id)
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=current_user.id, action="content_edited", field_changed="current_version",
                     old_value=old_version, new_value=new_version, action_details=f"{reason}; version {new_version}"
                     + ("; sent back to review" if doc.status != old_status else ""))
    db.commit()
    return {"version": new_version, "status": doc.status, "changes_taken_back": n}


@router.get("/{document_id}/change-chain/export")
def export_chain(document_id: int, format: str = "xlsx", db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The whole chain as one file: Excel (a sheet each for versions, changes, sources and approvals), PDF or CSV."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    _enabled_or_404(db)
    fmt = (format or "xlsx").lower()
    if fmt not in ("xlsx", "pdf", "csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose xlsx, pdf or csv.")
    data, media_type, filename = change_chain_export.build(C.chain(db, doc), fmt, current_user.display_name or current_user.username or "a user")
    return Response(content=data, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="{filename}"'})
