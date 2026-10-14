"""The document's Approvals & Acknowledgements tab: who it is waiting for, who signed or acknowledged, the full timeline.

The approval chain itself is still driven by routers/document_signoff.py; this reads the per-person obligations
(modules/governance/doc_lifecycle.py) and takes acknowledgements. Tenants without it get ``{"enabled": false}``.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import DocumentObligation, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import doc_lifecycle
from .document_signoff import _doc_or_404

router = APIRouter(prefix="/documents", tags=["Governance - Lifecycle"])


class AcknowledgeIn(BaseModel):
    comment: Optional[str] = None
    signature_image: Optional[str] = None     # optional PNG data URL; sealed like a sign-off when given


@router.get("/{document_id}/lifecycle")
def get_lifecycle(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    return doc_lifecycle.state(db, doc, current_user)


@router.post("/{document_id}/lifecycle/acknowledge")
def acknowledge(document_id: int, body: AcknowledgeIn, request: Request, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth)):
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Acknowledgements are not enabled for this organisation")
    try:
        doc_lifecycle.acknowledge(db, doc, current_user, body.comment, body.signature_image, request)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except LookupError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc))
    return doc_lifecycle.state(db, doc, current_user)


@router.post("/{document_id}/lifecycle/remind")
def remind(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Alert everyone who still has something to do on this document."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not enabled for this organisation")
    pending = db.query(DocumentObligation).filter(DocumentObligation.document_id == document_id,
                                                  DocumentObligation.status == "pending").all()
    for kind in {o.kind for o in pending}:
        ids = [o.user_id for o in pending if o.kind == kind]
        doc_lifecycle._notify(db, doc, ids, f"Reminder: {doc_lifecycle._VERB[kind]} {doc.title}",
                              f"{current_user.display_name or current_user.username} reminds you to "
                              f"{doc_lifecycle._VERB[kind].lower()} \"{doc.title}\".", "warning", email=True)
    db.commit()
    return {"reminded": len({o.user_id for o in pending})}


class SettingsIn(BaseModel):
    approval_days: Optional[int] = None
    ack_days: Optional[int] = None
    remind_days: Optional[int] = None
    admin_after_days: Optional[int] = None
    email: Optional[bool] = None


def _tenant_id(db: Session, user: GRCUser) -> int:
    return get_user_tenants(user, db)[0]


@router.get("/lifecycle/mine")
def my_requests(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Everything the current user is asked to review, approve or acknowledge, across documents."""
    if not doc_lifecycle.enabled(db):
        return {"enabled": False, "items": []}
    items = doc_lifecycle.mine(db, current_user.id)
    return {"enabled": True, "total": len(items), "items": items}


@router.get("/lifecycle/settings")
def get_lifecycle_settings(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    if not doc_lifecycle.enabled(db):
        return {"enabled": False}
    from ...access_review.sampling import privileged_user_ids

    tenant_id = _tenant_id(db, current_user)
    return {"enabled": True, "settings": doc_lifecycle.settings(db, tenant_id),
            "can_edit": current_user.id in privileged_user_ids(db, tenant_id)}


@router.put("/lifecycle/settings")
def put_lifecycle_settings(body: SettingsIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """How long approvals and acknowledgements are given, when to remind and when to escalate. Administrators only."""
    if not doc_lifecycle.enabled(db):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not enabled for this organisation")
    from ...access_review.sampling import privileged_user_ids

    tenant_id = _tenant_id(db, current_user)
    if current_user.id not in privileged_user_ids(db, tenant_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can change these settings.")
    try:
        saved = doc_lifecycle.save_settings(db, tenant_id, body.model_dump(exclude_none=True), current_user.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"enabled": True, "settings": saved, "can_edit": True}
