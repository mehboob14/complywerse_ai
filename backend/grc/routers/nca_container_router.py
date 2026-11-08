"""Tenant-level NCA container.

Provides a singleton ComplianceAssessmentDocument per tenant that owns the
NCA DCC compliance assessment + Cybersecurity Audit Plan. This lets the
frontend's top-level "NCA" tab attach to a stable assessment_id without
requiring the user to first create a regular assessment.

The singleton is identified by `assessment_format == 'nca_container'` and is
hidden from the regular assessment list.
"""
from datetime import datetime
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..models import ComplianceAssessmentDocument, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant

router = APIRouter(prefix="/compliance/nca", tags=["NCA Container"])

NCA_CONTAINER_FORMAT = "nca_container"
NCA_CONTAINER_NAME = "NCA Cybersecurity Workspace"


def _serialize(doc: ComplianceAssessmentDocument) -> Dict[str, Any]:
    return {
        "id": doc.id,
        "tenant_id": doc.tenant_id,
        "name": doc.name,
        "assessment_type": doc.assessment_type,
        "assessment_format": doc.assessment_format,
        "status": doc.status,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "exists": True,
    }


def _find(db: Session, tenant_id: int):
    return db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.tenant_id == tenant_id,
        ComplianceAssessmentDocument.assessment_format == NCA_CONTAINER_FORMAT,
    ).first()


@router.get("/container")
def get_nca_container(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """The tenant's singleton NCA container. A read never writes: when the tenant has none yet the answer has the same keys with
    id null and exists false, and POST /container makes it."""
    tenant_id = get_user_primary_tenant(user, db)
    doc = _find(db, tenant_id)
    if doc:
        return _serialize(doc)
    return {"id": None, "tenant_id": tenant_id, "name": NCA_CONTAINER_NAME, "assessment_type": "nca_template",
            "assessment_format": NCA_CONTAINER_FORMAT, "status": None, "created_at": None, "exists": False}


@router.post("/container")
def create_nca_container(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Make the tenant's singleton NCA container if it is missing, and return it (asking twice returns the same one)."""
    tenant_id = get_user_primary_tenant(user, db)
    doc = _find(db, tenant_id)
    if doc:
        return _serialize(doc)

    doc = ComplianceAssessmentDocument(
        tenant_id=tenant_id,
        name=NCA_CONTAINER_NAME,
        assessment_type="nca_template",
        assessment_format=NCA_CONTAINER_FORMAT,
        status="in_progress",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        created_by=getattr(user, "id", None),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return _serialize(doc)
