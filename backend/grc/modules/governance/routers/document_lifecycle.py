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
                              f"{doc_lifecycle._VERB[kind].lower()} \"{doc.title}\".", "warning")
    db.commit()
    return {"reminded": len({o.user_id for o in pending})}
