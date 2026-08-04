"""Framework template document endpoints (ISMS Scope Statement / Internal Audit Procedure).

Structured documents: a metadata/control box plus ordered sections (heading +
body, optionally an editable table). One document per (tenant, journey, doc_type),
created on first open from the ISO 27001 template.
"""
from typing import List, Optional, Any, Dict
from datetime import datetime
import copy

from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import FrameworkDocument, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ..schema import ensure_framework_template_tables
from ..seed_data import DOC_TYPES, DOCUMENT_TEMPLATES
from .. import definitions as D


def _ensure_schema(db: Session = Depends(get_db)) -> None:
    ensure_framework_template_tables(db)


router = APIRouter(
    prefix="/documents",
    tags=["Framework Template Documents"],
    dependencies=[Depends(_ensure_schema)],
)


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    organization: Optional[str] = None
    owner_id: Optional[int] = None
    owner_name: Optional[str] = None
    classification: Optional[str] = None
    version: Optional[str] = None
    approved_by: Optional[str] = None
    approval_date: Optional[datetime] = None
    effective_date: Optional[datetime] = None
    next_review_date: Optional[datetime] = None
    status: Optional[str] = None
    reviewer_id: Optional[int] = None
    approver_id: Optional[int] = None
    sections: Optional[List[Dict[str, Any]]] = None


def _tenant_id(user: GRCUser, db: Session) -> int:
    tenants = get_user_tenants(user, db)
    if not tenants:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant context")
    return tenants[0]


def _tenant_name(db: Session) -> str:
    try:
        from ....models import Tenant
        t = db.query(Tenant).first()
        return (getattr(t, "name", "") or "") if t else ""
    except Exception:
        return ""


def _validate_type(doc_type: str) -> None:
    if doc_type not in DOC_TYPES and doc_type not in D.all_doc_types():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Unknown doc_type '{doc_type}'")


def _doc_template(doc_type: str) -> dict:
    """ISO 27001 hand-tuned template, or a generated framework's document def."""
    tpl = DOCUMENT_TEMPLATES.get(doc_type)
    if tpl:
        return tpl
    dd = D.document_def(doc_type)
    if dd:
        return {"title": dd.get("label") or doc_type, "control_ref": dd.get("control_ref"),
                "sections": dd.get("sections", [])}
    return {}


def _serialize(d: FrameworkDocument) -> Dict[str, Any]:
    return {
        "id": d.id,
        "doc_type": d.doc_type,
        "title": d.title,
        "control_ref": d.control_ref,
        "organization": d.organization,
        "owner_id": d.owner_id,
        "owner_name": d.owner_name,
        "classification": d.classification,
        "version": d.version,
        "approved_by": d.approved_by,
        "approval_date": d.approval_date.isoformat() if d.approval_date else None,
        "effective_date": d.effective_date.isoformat() if d.effective_date else None,
        "next_review_date": d.next_review_date.isoformat() if d.next_review_date else None,
        "status": d.status,
        "reviewer_id": d.reviewer_id,
        "approver_id": d.approver_id,
        "submitted_for_review_at": d.submitted_for_review_at.isoformat() if d.submitted_for_review_at else None,
        "sections": d.sections or [],
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@router.get("/{doc_type}")
def get_or_create_document(
    doc_type: str,
    journey_id: int = Query(...),
    framework_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    _validate_type(doc_type)
    tid = _tenant_id(user, db)
    d = db.query(FrameworkDocument).filter(
        FrameworkDocument.tenant_id == tid,
        FrameworkDocument.journey_id == journey_id,
        FrameworkDocument.doc_type == doc_type,
    ).first()
    if not d:
        tpl = _doc_template(doc_type)
        d = FrameworkDocument(
            tenant_id=tid,
            journey_id=journey_id,
            uploaded_framework_id=framework_id,
            doc_type=doc_type,
            title=tpl.get("title") or doc_type,
            control_ref=tpl.get("control_ref"),
            organization=_tenant_name(db) or None,
            sections=copy.deepcopy(tpl.get("sections") or []),
            created_by=user.id,
        )
        db.add(d)
        db.commit()
        db.refresh(d)
    return _serialize(d)


@router.put("/{doc_id}")
def update_document(
    doc_id: int,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tid = _tenant_id(user, db)
    d = db.query(FrameworkDocument).filter(
        FrameworkDocument.id == doc_id,
        FrameworkDocument.tenant_id == tid,
    ).first()
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    updates = payload.model_dump(exclude_unset=True)
    for k, v in updates.items():
        setattr(d, k, v)
    # Review-workflow transitions.
    if updates.get("status") == "approved" and not d.approval_date:
        d.approval_date = datetime.utcnow()
    if updates.get("status") == "in_review":
        d.submitted_for_review_at = datetime.utcnow()
        d.submitted_by = user.id
    db.commit()
    db.refresh(d)
    return _serialize(d)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tid = _tenant_id(user, db)
    d = db.query(FrameworkDocument).filter(
        FrameworkDocument.id == doc_id,
        FrameworkDocument.tenant_id == tid,
    ).first()
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    db.delete(d)
    db.commit()
    return None


@router.post("/{doc_type}/reset")
def reset_document(
    doc_type: str,
    journey_id: int = Query(...),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Reset a document's sections back to the ISO 27001 template (keeps the metadata box)."""
    _validate_type(doc_type)
    tid = _tenant_id(user, db)
    d = db.query(FrameworkDocument).filter(
        FrameworkDocument.tenant_id == tid,
        FrameworkDocument.journey_id == journey_id,
        FrameworkDocument.doc_type == doc_type,
    ).first()
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    tpl = _doc_template(doc_type)
    d.sections = copy.deepcopy(tpl.get("sections") or [])
    db.commit()
    db.refresh(d)
    return _serialize(d)
