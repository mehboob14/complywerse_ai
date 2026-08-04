import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import (
    ComplianceAssessmentDocument,
    ComplianceAssessmentDocumentItem,
    GRCUser,
    get_db,
)
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compliance/assessments", tags=["DCC Assessment"])

_CATALOG_PATH = Path(__file__).parent.parent / "seed_data" / "dcc_catalog.json"

# ─── Status mappings ─────────────────────────────────────────────────────────

DCC_STATUS_LABELS = {
    "complied":            "Fully Implemented",
    "partially_complied":  "Partially Implemented",
    "not_complied":        "Not Implemented",
    "na":                  "Not Applicable",
    "in_progress":         "In Progress",
}

# ─── Helpers ─────────────────────────────────────────────────────────────────

def _load_catalog() -> List[Dict[str, Any]]:
    try:
        with open(_CATALOG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.exception("Failed to load DCC catalog from %s", _CATALOG_PATH)
        return []


def _get_assessment(assessment_id: int, tenant_id: int, db: Session) -> ComplianceAssessmentDocument:
    doc = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id == tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return doc


def _summary(items: List[ComplianceAssessmentDocumentItem]) -> Dict[str, int]:
    summary: Dict[str, int] = {
        "total": len(items),
        "complied": 0,
        "partially_complied": 0,
        "not_complied": 0,
        "na": 0,
        "in_progress": 0,
    }
    for item in items:
        key = item.compliance_status or "in_progress"
        if key in summary:
            summary[key] += 1
    return summary


def _item_to_dict(item: ComplianceAssessmentDocumentItem) -> Dict[str, Any]:
    return {
        "id": item.id,
        "assessment_id": item.assessment_id,
        "item_number": item.item_number,
        "area_domain": item.area_domain,
        "subdomain_name": item.subdomain_name,
        "control_type": item.control_type,
        "control_description": item.control_description,
        "compliance_status": item.compliance_status,
        "status_label": DCC_STATUS_LABELS.get(item.compliance_status or "in_progress", "In Progress"),
        "gaps_identified": item.gaps_identified,
        "proposed_solution": item.proposed_solution,
        "responsible_party": item.responsible_party,
        "timeline": item.timeline,
        "priority": item.priority,
        "remarks": item.remarks,
        "ai_evidence_recommendation": item.ai_evidence_recommendation,
        "ai_recommendation_generated_at": (
            item.ai_recommendation_generated_at.isoformat()
            if item.ai_recommendation_generated_at else None
        ),
        "control_source": item.control_source,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }

# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/{assessment_id}/dcc/initialize")
def initialize_dcc_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Seed all 66 DCC-1:2022 controls as assessment items. Idempotent."""
    tenant_id = get_user_primary_tenant(user, db)
    _get_assessment(assessment_id, tenant_id, db)

    existing = db.query(ComplianceAssessmentDocumentItem).filter(
        ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
        ComplianceAssessmentDocumentItem.control_source == "dcc",
    ).count()

    if existing > 0:
        return {"created": 0, "total": existing, "message": f"DCC items already initialized ({existing} controls)"}

    catalog = _load_catalog()
    if not catalog:
        raise HTTPException(status_code=500, detail="DCC catalog could not be loaded")

    created = 0
    for ctrl in catalog:
        item = ComplianceAssessmentDocumentItem(
            assessment_id=assessment_id,
            tenant_id=tenant_id,
            item_number=ctrl.get("ref", ""),
            area_domain=ctrl.get("main_domain", ""),
            subdomain_name=ctrl.get("subdomain", ""),
            control_type=ctrl.get("control_type", "basic"),
            control_description=ctrl.get("control_text_en") or ctrl.get("control_text_ar", ""),
            compliance_status="in_progress",
            control_source="dcc",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(item)
        created += 1

    db.commit()
    return {"created": created, "total": created, "message": f"Initialized {created} DCC controls"}


@router.get("/{assessment_id}/dcc")
def get_dcc_items(
    assessment_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Return all DCC assessment items grouped by domain, with summary stats."""
    tenant_id = get_user_primary_tenant(user, db)
    _get_assessment(assessment_id, tenant_id, db)

    items = (
        db.query(ComplianceAssessmentDocumentItem)
        .filter(
            ComplianceAssessmentDocumentItem.assessment_id == assessment_id,
            ComplianceAssessmentDocumentItem.control_source == "dcc",
        )
        .order_by(ComplianceAssessmentDocumentItem.item_number)
        .all()
    )

    # Group by main domain
    grouped: Dict[str, List] = {}
    for item in items:
        domain = item.area_domain or "Other"
        grouped.setdefault(domain, []).append(_item_to_dict(item))

    return {
        "initialized": len(items) > 0,
        "summary": _summary(items),
        "domains": [
            {"name": domain, "items": domain_items}
            for domain, domain_items in grouped.items()
        ],
    }
