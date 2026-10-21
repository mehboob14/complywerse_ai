"""A document's proposed changes (modules/governance/proposals.py, DECISIONS D35): changes by anyone but its owner or author, waiting
for them to accept or reject. Reading never writes; accept, reject and withdraw commit once."""
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import DocumentChangeProposal, GRCUser, get_db
from ....routers.auth_router import get_user_tenants, require_auth
from .. import permissions, proposals
from ..permissions import require_doc_reader
from .document_signoff import _doc_or_404

router = APIRouter(prefix="/documents", tags=["Governance - Proposed changes"])
_MEDIA = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "doc": "application/msword", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "xls": "application/vnd.ms-excel"}
CONTENT_REFUSED = "Only the document's owner, author, editors and the people taking part in its sign-off see a proposed change itself."


class DecisionIn(BaseModel):
    note: Optional[str] = None


def _target(db: Session, document_id: int, proposal_id: int, user: GRCUser):
    doc = _doc_or_404(document_id, get_user_tenants(user, db), db)
    p = db.query(DocumentChangeProposal).filter(DocumentChangeProposal.id == proposal_id,
                                                DocumentChangeProposal.document_id == doc.id).first()
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That proposed change was not found for this document.")
    return doc, p


def _sees_content(db: Session, user: GRCUser, doc) -> None:
    """The proposed text or file is a version not in force: for who reads drafts (permissions.sees_draft)."""
    if not permissions.sees_draft(db, user, doc):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=CONTENT_REFUSED)


@router.get("/{document_id}/proposals", dependencies=[Depends(require_doc_reader)])
def list_proposals(document_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The document's proposed changes, newest first, whether the person decides on them, and how many wait."""
    doc = _doc_or_404(document_id, get_user_tenants(current_user, db), db)
    return proposals.listing(db, doc, current_user)


@router.get("/{document_id}/proposals/{proposal_id}", dependencies=[Depends(require_doc_reader)])
def get_proposal(document_id: int, proposal_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    doc, p = _target(db, document_id, proposal_id, current_user)
    return proposals.view(db, p, current_user, doc)


@router.get("/{document_id}/proposals/{proposal_id}/compare", dependencies=[Depends(require_doc_reader)])
def compare_proposal(document_id: int, proposal_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The document as it was when the change was proposed beside the change (rows and changes for the redline); a statement's fields
    before and after."""
    doc, p = _target(db, document_id, proposal_id, current_user)
    _sees_content(db, current_user, doc)
    return proposals.compare(db, doc, p)


@router.get("/{document_id}/proposals/{proposal_id}/file", dependencies=[Depends(require_doc_reader)])
def proposal_file(document_id: int, proposal_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The proposed Word or PDF file (the document's own file is its usual download)."""
    doc, p = _target(db, document_id, proposal_id, current_user)
    _sees_content(db, current_user, doc)
    if not p.proposed_file_path or not os.path.exists(p.proposed_file_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This proposed change has no file.")
    kind = (p.proposed_file_type or os.path.splitext(p.proposed_file_path)[1]).lower().lstrip(".")
    return FileResponse(path=p.proposed_file_path, filename=p.proposed_file_name or f"proposed_{proposal_id}.{kind or 'docx'}",
                        media_type=_MEDIA.get(kind, "application/octet-stream"))


@router.post("/{document_id}/proposals/{proposal_id}/accept", dependencies=[Depends(require_doc_reader)])
def accept_proposal(document_id: int, proposal_id: int, body: Optional[DecisionIn] = None, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    """The owner (or author) accepts it: applied as the next version, credited to whoever proposed it. 409 ``proposal_stale`` when the
    document (or the statement) changed since."""
    doc, p = _target(db, document_id, proposal_id, current_user)
    try:
        version = proposals.accept(db, doc, p, current_user, body.note if body is not None else None)
    except proposals.Stale as exc:
        db.rollback()
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc), "code": "proposal_stale"})
    except HTTPException:
        db.rollback()
        raise
    except ValueError as exc:            # what its writer refuses (a file that cannot be written, a studio problem)
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    db.commit()
    proposals.after_accept(db, doc, p)
    db.refresh(p)
    return {"proposal": proposals.view(db, p, current_user, doc),
            "version": {"id": version.id, "number": version.version_number} if version is not None else None}


@router.post("/{document_id}/proposals/{proposal_id}/reject", dependencies=[Depends(require_doc_reader)])
def reject_proposal(document_id: int, proposal_id: int, body: DecisionIn, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    """The owner (or author) does not accept it (a note is required): nothing changes; its proposer is told and asked to revise it."""
    doc, p = _target(db, document_id, proposal_id, current_user)
    proposals.reject(db, doc, p, current_user, body.note)
    db.commit()
    db.refresh(p)
    return {"proposal": proposals.view(db, p, current_user, doc)}


@router.post("/{document_id}/proposals/{proposal_id}/withdraw", dependencies=[Depends(require_doc_reader)])
def withdraw_proposal(document_id: int, proposal_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Its proposer takes it back (waiting, or not accepted)."""
    doc, p = _target(db, document_id, proposal_id, current_user)
    proposals.withdraw(db, doc, p, current_user)
    db.commit()
    db.refresh(p)
    return {"proposal": proposals.view(db, p, current_user, doc)}
