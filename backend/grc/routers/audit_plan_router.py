"""Cybersecurity audit plan router (NCA template)."""
from ..config import get_openai_api_key
import json
import logging
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import AuditPlanEntry, ComplianceAssessmentDocument, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/compliance/assessments", tags=["Audit Plan"])

OPENAI_API_KEY = get_openai_api_key()
OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


# ─── Schemas ─────────────────────────────────────────────────────────────────

class AuditPlanEntryIn(BaseModel):
    entry_type: Optional[str] = "Audit"
    audit_name: Optional[str] = None
    team_responsible: Optional[str] = None
    lead_auditor: Optional[str] = None
    audit_type: Optional[str] = None
    scope: Optional[str] = None
    methods: Optional[str] = None
    criteria: Optional[str] = None
    sampling: Optional[str] = None
    evidence_needed: Optional[str] = None
    duration: Optional[str] = None
    schedule: Optional[str] = None
    audit_start: Optional[date] = None
    audit_end: Optional[date] = None
    cost: Optional[str] = None
    comment: Optional[str] = None
    status: Optional[str] = "planned"
    priority: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_assessment(assessment_id: int, tenant_id: int, db: Session) -> ComplianceAssessmentDocument:
    doc = db.query(ComplianceAssessmentDocument).filter(
        ComplianceAssessmentDocument.id == assessment_id,
        ComplianceAssessmentDocument.tenant_id == tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return doc


def _next_audit_id(assessment_id: int, entry_type: str, db: Session) -> str:
    prefix = "R" if (entry_type or "").lower() == "review" else "A"
    count = db.query(AuditPlanEntry).filter(
        AuditPlanEntry.assessment_id == assessment_id,
        AuditPlanEntry.entry_type == entry_type,
    ).count()
    return f"{prefix}{(count + 1):03d}"


def _entry_to_dict(e: AuditPlanEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "assessment_id": e.assessment_id,
        "entry_type": e.entry_type,
        "audit_id": e.audit_id,
        "audit_name": e.audit_name,
        "team_responsible": e.team_responsible,
        "lead_auditor": e.lead_auditor,
        "audit_type": e.audit_type,
        "scope": e.scope,
        "methods": e.methods,
        "criteria": e.criteria,
        "sampling": e.sampling,
        "evidence_needed": e.evidence_needed,
        "duration": e.duration,
        "schedule": e.schedule,
        "audit_start": e.audit_start.isoformat() if e.audit_start else None,
        "audit_end": e.audit_end.isoformat() if e.audit_end else None,
        "cost": e.cost,
        "comment": e.comment,
        "status": e.status,
        "priority": e.priority,
        "ai_recommendation": e.ai_recommendation,
        "ai_recommendation_generated_at": e.ai_recommendation_generated_at.isoformat() if e.ai_recommendation_generated_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _summary(entries: List[AuditPlanEntry]) -> Dict[str, int]:
    return {
        "total": len(entries),
        "audits": sum(1 for e in entries if (e.entry_type or "").lower() == "audit"),
        "reviews": sum(1 for e in entries if (e.entry_type or "").lower() == "review"),
        "planned": sum(1 for e in entries if (e.status or "").lower() == "planned"),
        "in_progress": sum(1 for e in entries if (e.status or "").lower() == "in_progress"),
        "completed": sum(1 for e in entries if (e.status or "").lower() == "completed"),
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/{assessment_id}/audit-plan")
def list_entries(
    assessment_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    _get_assessment(assessment_id, tenant_id, db)
    entries = db.query(AuditPlanEntry).filter(
        AuditPlanEntry.assessment_id == assessment_id,
    ).order_by(AuditPlanEntry.id.desc()).all()
    return {"entries": [_entry_to_dict(e) for e in entries], "summary": _summary(entries)}


@router.post("/{assessment_id}/audit-plan")
def create_entry(
    assessment_id: int,
    body: AuditPlanEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    _get_assessment(assessment_id, tenant_id, db)

    entry_type = body.entry_type or "Audit"
    payload = body.model_dump(exclude={"entry_type"}, exclude_unset=True)
    entry = AuditPlanEntry(
        assessment_id=assessment_id,
        tenant_id=tenant_id,
        entry_type=entry_type,
        audit_id=_next_audit_id(assessment_id, entry_type, db),
        **payload,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.put("/{assessment_id}/audit-plan/{entry_id}")
def update_entry(
    assessment_id: int,
    entry_id: int,
    body: AuditPlanEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(AuditPlanEntry).filter(
        AuditPlanEntry.id == entry_id,
        AuditPlanEntry.assessment_id == assessment_id,
        AuditPlanEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit plan entry not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.delete("/{assessment_id}/audit-plan/{entry_id}")
def delete_entry(
    assessment_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(AuditPlanEntry).filter(
        AuditPlanEntry.id == entry_id,
        AuditPlanEntry.assessment_id == assessment_id,
        AuditPlanEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit plan entry not found")
    db.delete(entry)
    db.commit()
    return {"deleted": True}


@router.post("/{assessment_id}/audit-plan/{entry_id}/ai-recommendation")
def generate_ai_recommendation(
    assessment_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(AuditPlanEntry).filter(
        AuditPlanEntry.id == entry_id,
        AuditPlanEntry.assessment_id == assessment_id,
        AuditPlanEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Audit plan entry not found")

    if not OPENAI_API_KEY:
        fallback = {
            "summary": "OpenAI API key not configured. Configure AI_INTEGRATIONS_OPENAI_API_KEY to enable AI recommendations.",
            "scope_advice": [],
            "methods": [],
            "evidence": [],
        }
        entry.ai_recommendation = json.dumps(fallback)
        entry.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        return {"recommendation": fallback, "generated_at": entry.ai_recommendation_generated_at.isoformat()}

    try:
        from openai import OpenAI
        kwargs = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            kwargs["base_url"] = OPENAI_BASE_URL
        client = OpenAI(**kwargs)

        prompt = f"""You are a senior cybersecurity auditor advising on an audit plan entry.

Entry type: {entry.entry_type}
Audit name: {entry.audit_name or 'N/A'}
Audit type: {entry.audit_type or 'N/A'}
Scope: {entry.scope or 'N/A'}
Current methods: {entry.methods or 'N/A'}
Criteria: {entry.criteria or 'N/A'}
Evidence needed: {entry.evidence_needed or 'N/A'}

Return strict JSON with keys:
- summary (2-3 sentences advising the auditor)
- scope_advice (array of 3-5 specific scope refinements)
- methods (array of 3-5 recommended audit methods)
- evidence (array of 3-5 specific evidence items to collect)
"""

        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        content = completion.choices[0].message.content
        data = json.loads(content)

        entry.ai_recommendation = json.dumps(data)
        entry.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        return {"recommendation": data, "generated_at": entry.ai_recommendation_generated_at.isoformat()}
    except Exception as exc:
        logger.exception("Audit plan AI generation failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
