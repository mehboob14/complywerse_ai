from typing import List, Optional
from datetime import datetime
import io
import re
import os
import json
import logging

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from openai import OpenAI

from ....models import (
    RiskAssessment, RiskAssessmentRisk, RiskAssessmentKRI,
    RiskAssessmentIncident, RiskAssessmentRCSAFinding,
    Risk, RiskKRI, RiskIncident, RCSAFinding,
    GRCUser, BusinessUnit, Framework, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risk-assessments", tags=["ERM - Risk Assessments"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


class RiskAssessmentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    assessment_type: Optional[str] = "periodic"
    methodology: Optional[str] = None
    scope: Optional[str] = None
    assessment_period_start: Optional[datetime] = None
    assessment_period_end: Optional[datetime] = None
    lead_assessor_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    framework_id: Optional[int] = None
    notes: Optional[str] = None


class RiskAssessmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    assessment_type: Optional[str] = None
    methodology: Optional[str] = None
    scope: Optional[str] = None
    assessment_period_start: Optional[datetime] = None
    assessment_period_end: Optional[datetime] = None
    lead_assessor_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    framework_id: Optional[int] = None
    notes: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class AssessmentRiskCreate(BaseModel):
    risk_id: int
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    risk_rating: Optional[str] = None
    treatment_decision: Optional[str] = None
    rationale: Optional[str] = None
    control_effectiveness: Optional[str] = None
    notes: Optional[str] = None


class AssessmentRiskUpdate(BaseModel):
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    risk_rating: Optional[str] = None
    treatment_decision: Optional[str] = None
    rationale: Optional[str] = None
    control_effectiveness: Optional[str] = None
    notes: Optional[str] = None


class BulkAddRisks(BaseModel):
    risk_ids: List[int]


class KRILinkCreate(BaseModel):
    kri_id: int
    observed_value: Optional[float] = None
    threshold_status: Optional[str] = None
    notes: Optional[str] = None


class IncidentLinkCreate(BaseModel):
    incident_id: int
    impact_on_rating: Optional[str] = None


class RCSAFindingLinkCreate(BaseModel):
    rcsa_finding_id: int
    relevance_notes: Optional[str] = None


class RiskAssessmentResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str] = None
    assessment_type: Optional[str] = None
    methodology: Optional[str] = None
    scope: Optional[str] = None
    assessment_period_start: Optional[datetime] = None
    assessment_period_end: Optional[datetime] = None
    status: Optional[str] = None
    lead_assessor_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    framework_id: Optional[int] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    assessed_risks_count: int = 0

    class Config:
        orm_mode = True


class MessageResponse(BaseModel):
    message: str
    id: Optional[int] = None


VALID_STATUS_TRANSITIONS = {
    "draft": ["in_progress"],
    "in_progress": ["under_review"],
    "under_review": ["approved", "in_progress"],
    "approved": ["closed"],
}


def _get_assessment_or_404(assessment_id: int, user_tenants: list, db: Session) -> RiskAssessment:
    assessment = db.query(RiskAssessment).filter(
        RiskAssessment.id == assessment_id,
        RiskAssessment.tenant_id.in_(user_tenants)
    ).first()
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk assessment not found")
    return assessment


def _get_assessment_risk_or_404(assessment_id: int, assessment_risk_id: int, db: Session) -> RiskAssessmentRisk:
    ar = db.query(RiskAssessmentRisk).filter(
        RiskAssessmentRisk.id == assessment_risk_id,
        RiskAssessmentRisk.assessment_id == assessment_id
    ).first()
    if not ar:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment risk not found")
    return ar


@router.get("", response_model=List[RiskAssessmentResponse])
def list_risk_assessments(
    skip: int = 0,
    limit: int = 100,
    status_filter: Optional[str] = Query(None, alias="status"),
    assessment_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(RiskAssessment).filter(RiskAssessment.tenant_id.in_(user_tenants))

    if status_filter:
        query = query.filter(RiskAssessment.status == status_filter)
    if assessment_type:
        query = query.filter(RiskAssessment.assessment_type == assessment_type)

    assessments = query.order_by(RiskAssessment.created_at.desc()).offset(skip).limit(limit).all()

    return [
        RiskAssessmentResponse(
            id=a.id,
            tenant_id=a.tenant_id,
            name=a.name,
            description=a.description,
            assessment_type=a.assessment_type,
            methodology=a.methodology,
            scope=a.scope,
            assessment_period_start=a.assessment_period_start,
            assessment_period_end=a.assessment_period_end,
            status=a.status,
            lead_assessor_id=a.lead_assessor_id,
            business_unit_id=a.business_unit_id,
            framework_id=a.framework_id,
            approved_by=a.approved_by,
            approved_at=a.approved_at,
            notes=a.notes,
            created_at=a.created_at,
            updated_at=a.updated_at,
            completed_at=a.completed_at,
            assessed_risks_count=len(a.assessed_risks)
        )
        for a in assessments
    ]


@router.get("/{assessment_id}")
def get_risk_assessment_detail(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    assessment = db.query(RiskAssessment).options(
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.risk),
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_kris).joinedload(RiskAssessmentKRI.kri),
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_incidents).joinedload(RiskAssessmentIncident.incident),
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_rcsa_findings).joinedload(RiskAssessmentRCSAFinding.rcsa_finding),
        joinedload(RiskAssessment.lead_assessor),
        joinedload(RiskAssessment.approver),
        joinedload(RiskAssessment.business_unit),
        joinedload(RiskAssessment.framework),
    ).filter(
        RiskAssessment.id == assessment_id,
        RiskAssessment.tenant_id.in_(user_tenants)
    ).first()

    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk assessment not found")

    assessed_risks_data = []
    for ar in assessment.assessed_risks:
        linked_kris_data = [{
            "id": lk.id,
            "kri_id": lk.kri_id,
            "kri_name": lk.kri.name if lk.kri else None,
            "observed_value": lk.observed_value,
            "threshold_status": lk.threshold_status,
            "notes": lk.notes,
            "created_at": lk.created_at.isoformat() if lk.created_at else None,
        } for lk in ar.linked_kris]

        linked_incidents_data = [{
            "id": li.id,
            "incident_id": li.incident_id,
            "incident_title": li.incident.title if li.incident else None,
            "incident_severity": li.incident.severity if li.incident else None,
            "impact_on_rating": li.impact_on_rating,
            "created_at": li.created_at.isoformat() if li.created_at else None,
        } for li in ar.linked_incidents]

        linked_rcsa_data = [{
            "id": lf.id,
            "rcsa_finding_id": lf.rcsa_finding_id,
            "finding_title": lf.rcsa_finding.title if lf.rcsa_finding else None,
            "finding_severity": lf.rcsa_finding.severity if hasattr(lf.rcsa_finding, 'severity') and lf.rcsa_finding else None,
            "relevance_notes": lf.relevance_notes,
            "created_at": lf.created_at.isoformat() if lf.created_at else None,
        } for lf in ar.linked_rcsa_findings]

        assessed_risks_data.append({
            "id": ar.id,
            "risk_id": ar.risk_id,
            "risk_title": ar.risk.title if ar.risk else None,
            "risk_category": (ar.risk.risk_category or ar.risk.category) if ar.risk else None,
            "inherent_likelihood": ar.inherent_likelihood,
            "inherent_impact": ar.inherent_impact,
            "inherent_score": ar.inherent_score,
            "residual_likelihood": ar.residual_likelihood,
            "residual_impact": ar.residual_impact,
            "residual_score": ar.residual_score,
            "risk_rating": ar.risk_rating,
            "treatment_decision": ar.treatment_decision,
            "rationale": ar.rationale,
            "control_effectiveness": ar.control_effectiveness,
            "notes": ar.notes,
            "assessed_by": ar.assessed_by,
            "assessed_at": ar.assessed_at.isoformat() if ar.assessed_at else None,
            "linked_kris": linked_kris_data,
            "linked_kris_count": len(linked_kris_data),
            "linked_incidents": linked_incidents_data,
            "linked_incidents_count": len(linked_incidents_data),
            "linked_rcsa_findings": linked_rcsa_data,
            "linked_rcsa_findings_count": len(linked_rcsa_data),
        })

    return {
        "id": assessment.id,
        "tenant_id": assessment.tenant_id,
        "name": assessment.name,
        "description": assessment.description,
        "assessment_type": assessment.assessment_type,
        "methodology": assessment.methodology,
        "scope": assessment.scope,
        "assessment_period_start": assessment.assessment_period_start.isoformat() if assessment.assessment_period_start else None,
        "assessment_period_end": assessment.assessment_period_end.isoformat() if assessment.assessment_period_end else None,
        "status": assessment.status,
        "lead_assessor_id": assessment.lead_assessor_id,
        "lead_assessor_name": assessment.lead_assessor.display_name if assessment.lead_assessor else None,
        "business_unit_id": assessment.business_unit_id,
        "business_unit_name": assessment.business_unit.name if assessment.business_unit else None,
        "framework_id": assessment.framework_id,
        "framework_name": assessment.framework.name if assessment.framework else None,
        "approved_by": assessment.approved_by,
        "approver_name": assessment.approver.display_name if assessment.approver else None,
        "approved_at": assessment.approved_at.isoformat() if assessment.approved_at else None,
        "notes": assessment.notes,
        "created_at": assessment.created_at.isoformat() if assessment.created_at else None,
        "updated_at": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "completed_at": assessment.completed_at.isoformat() if assessment.completed_at else None,
        "assessed_risks": assessed_risks_data,
        "assessed_risks_count": len(assessed_risks_data),
    }


@router.post("", response_model=RiskAssessmentResponse, status_code=status.HTTP_201_CREATED)
def create_risk_assessment(
    data: RiskAssessmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")

    assessment = RiskAssessment(
        tenant_id=tenant_id,
        name=data.name,
        description=data.description,
        assessment_type=data.assessment_type,
        methodology=data.methodology,
        scope=data.scope,
        assessment_period_start=data.assessment_period_start,
        assessment_period_end=data.assessment_period_end,
        status="draft",
        lead_assessor_id=data.lead_assessor_id,
        business_unit_id=data.business_unit_id,
        framework_id=data.framework_id,
        notes=data.notes,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)

    return RiskAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        name=assessment.name,
        description=assessment.description,
        assessment_type=assessment.assessment_type,
        methodology=assessment.methodology,
        scope=assessment.scope,
        assessment_period_start=assessment.assessment_period_start,
        assessment_period_end=assessment.assessment_period_end,
        status=assessment.status,
        lead_assessor_id=assessment.lead_assessor_id,
        business_unit_id=assessment.business_unit_id,
        framework_id=assessment.framework_id,
        approved_by=assessment.approved_by,
        approved_at=assessment.approved_at,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        completed_at=assessment.completed_at,
        assessed_risks_count=0,
    )


@router.put("/{assessment_id}", response_model=RiskAssessmentResponse)
def update_risk_assessment(
    assessment_id: int,
    data: RiskAssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    if assessment.status in ("approved", "closed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot update assessment with status '{assessment.status}'"
        )

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(assessment, key, value)

    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)

    return RiskAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        name=assessment.name,
        description=assessment.description,
        assessment_type=assessment.assessment_type,
        methodology=assessment.methodology,
        scope=assessment.scope,
        assessment_period_start=assessment.assessment_period_start,
        assessment_period_end=assessment.assessment_period_end,
        status=assessment.status,
        lead_assessor_id=assessment.lead_assessor_id,
        business_unit_id=assessment.business_unit_id,
        framework_id=assessment.framework_id,
        approved_by=assessment.approved_by,
        approved_at=assessment.approved_at,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        completed_at=assessment.completed_at,
        assessed_risks_count=len(assessment.assessed_risks),
    )


@router.post("/{assessment_id}/status", response_model=RiskAssessmentResponse)
def update_assessment_status(
    assessment_id: int,
    data: StatusUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    allowed = VALID_STATUS_TRANSITIONS.get(assessment.status, [])
    if data.status not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status transition from '{assessment.status}' to '{data.status}'. Allowed: {allowed}"
        )

    assessment.status = data.status
    if data.notes:
        assessment.notes = data.notes

    now = datetime.utcnow()
    if data.status == "approved":
        assessment.approved_by = current_user.id
        assessment.approved_at = now
    if data.status == "closed":
        assessment.completed_at = now

    assessment.updated_at = now
    db.commit()
    db.refresh(assessment)

    return RiskAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        name=assessment.name,
        description=assessment.description,
        assessment_type=assessment.assessment_type,
        methodology=assessment.methodology,
        scope=assessment.scope,
        assessment_period_start=assessment.assessment_period_start,
        assessment_period_end=assessment.assessment_period_end,
        status=assessment.status,
        lead_assessor_id=assessment.lead_assessor_id,
        business_unit_id=assessment.business_unit_id,
        framework_id=assessment.framework_id,
        approved_by=assessment.approved_by,
        approved_at=assessment.approved_at,
        notes=assessment.notes,
        created_at=assessment.created_at,
        updated_at=assessment.updated_at,
        completed_at=assessment.completed_at,
        assessed_risks_count=len(assessment.assessed_risks),
    )


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_risk_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    if assessment.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only delete assessments with 'draft' status"
        )

    db.delete(assessment)
    db.commit()
    return None


@router.post("/{assessment_id}/risks", status_code=status.HTTP_201_CREATED)
def add_risk_to_assessment(
    assessment_id: int,
    data: AssessmentRiskCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    risk = db.query(Risk).filter(
        Risk.id == data.risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    if not risk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk not found")

    existing = db.query(RiskAssessmentRisk).filter(
        RiskAssessmentRisk.assessment_id == assessment_id,
        RiskAssessmentRisk.risk_id == data.risk_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Risk already added to this assessment"
        )

    inherent_score = None
    if data.inherent_likelihood and data.inherent_impact:
        inherent_score = data.inherent_likelihood * data.inherent_impact

    residual_score = None
    if data.residual_likelihood and data.residual_impact:
        residual_score = data.residual_likelihood * data.residual_impact

    ar = RiskAssessmentRisk(
        assessment_id=assessment_id,
        risk_id=data.risk_id,
        inherent_likelihood=data.inherent_likelihood,
        inherent_impact=data.inherent_impact,
        inherent_score=inherent_score,
        residual_likelihood=data.residual_likelihood,
        residual_impact=data.residual_impact,
        residual_score=residual_score,
        risk_rating=data.risk_rating,
        treatment_decision=data.treatment_decision,
        rationale=data.rationale,
        control_effectiveness=data.control_effectiveness,
        notes=data.notes,
        assessed_by=current_user.id,
        assessed_at=datetime.utcnow(),
    )
    db.add(ar)
    db.commit()
    db.refresh(ar)

    return {
        "id": ar.id,
        "assessment_id": ar.assessment_id,
        "risk_id": ar.risk_id,
        "inherent_likelihood": ar.inherent_likelihood,
        "inherent_impact": ar.inherent_impact,
        "inherent_score": ar.inherent_score,
        "residual_likelihood": ar.residual_likelihood,
        "residual_impact": ar.residual_impact,
        "residual_score": ar.residual_score,
        "risk_rating": ar.risk_rating,
        "treatment_decision": ar.treatment_decision,
        "rationale": ar.rationale,
        "control_effectiveness": ar.control_effectiveness,
        "notes": ar.notes,
        "assessed_by": ar.assessed_by,
        "assessed_at": ar.assessed_at.isoformat() if ar.assessed_at else None,
    }


@router.put("/{assessment_id}/risks/{assessment_risk_id}")
def update_assessment_risk(
    assessment_id: int,
    assessment_risk_id: int,
    data: AssessmentRiskUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    ar = _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ar, key, value)

    il = ar.inherent_likelihood
    ii = ar.inherent_impact
    if il and ii:
        ar.inherent_score = il * ii

    rl = ar.residual_likelihood
    ri = ar.residual_impact
    if rl and ri:
        ar.residual_score = rl * ri

    ar.assessed_by = current_user.id
    ar.assessed_at = datetime.utcnow()
    ar.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ar)

    return {
        "id": ar.id,
        "assessment_id": ar.assessment_id,
        "risk_id": ar.risk_id,
        "inherent_likelihood": ar.inherent_likelihood,
        "inherent_impact": ar.inherent_impact,
        "inherent_score": ar.inherent_score,
        "residual_likelihood": ar.residual_likelihood,
        "residual_impact": ar.residual_impact,
        "residual_score": ar.residual_score,
        "risk_rating": ar.risk_rating,
        "treatment_decision": ar.treatment_decision,
        "rationale": ar.rationale,
        "control_effectiveness": ar.control_effectiveness,
        "notes": ar.notes,
        "assessed_by": ar.assessed_by,
        "assessed_at": ar.assessed_at.isoformat() if ar.assessed_at else None,
    }


@router.delete("/{assessment_id}/risks/{assessment_risk_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_risk_from_assessment(
    assessment_id: int,
    assessment_risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    ar = _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    db.delete(ar)
    db.commit()
    return None


@router.post("/{assessment_id}/risks/bulk", status_code=status.HTTP_201_CREATED)
def bulk_add_risks(
    assessment_id: int,
    data: BulkAddRisks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)

    existing_risk_ids = {
        r.risk_id for r in db.query(RiskAssessmentRisk.risk_id).filter(
            RiskAssessmentRisk.assessment_id == assessment_id
        ).all()
    }

    risks = db.query(Risk).filter(
        Risk.id.in_(data.risk_ids),
        Risk.tenant_id.in_(user_tenants)
    ).all()

    added = []
    for risk in risks:
        if risk.id in existing_risk_ids:
            continue

        inherent_score = None
        if risk.inherent_likelihood and risk.inherent_impact:
            inherent_score = risk.inherent_likelihood * risk.inherent_impact

        residual_score = None
        if risk.residual_likelihood and risk.residual_impact:
            residual_score = risk.residual_likelihood * risk.residual_impact

        ar = RiskAssessmentRisk(
            assessment_id=assessment_id,
            risk_id=risk.id,
            inherent_likelihood=risk.inherent_likelihood,
            inherent_impact=risk.inherent_impact,
            inherent_score=inherent_score,
            residual_likelihood=risk.residual_likelihood,
            residual_impact=risk.residual_impact,
            residual_score=residual_score,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow(),
        )
        db.add(ar)
        added.append(risk.id)
        existing_risk_ids.add(risk.id)

    db.commit()

    return {"message": f"Added {len(added)} risks to assessment", "added_risk_ids": added}


@router.post("/{assessment_id}/risks/{assessment_risk_id}/kris", status_code=status.HTTP_201_CREATED)
def link_kri_to_assessment_risk(
    assessment_id: int,
    assessment_risk_id: int,
    data: KRILinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    kri = db.query(RiskKRI).filter(RiskKRI.id == data.kri_id).first()
    if not kri:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KRI not found")

    link = RiskAssessmentKRI(
        assessment_risk_id=assessment_risk_id,
        kri_id=data.kri_id,
        observed_value=data.observed_value,
        threshold_status=data.threshold_status,
        notes=data.notes,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return {
        "id": link.id,
        "assessment_risk_id": link.assessment_risk_id,
        "kri_id": link.kri_id,
        "observed_value": link.observed_value,
        "threshold_status": link.threshold_status,
        "notes": link.notes,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


@router.delete("/{assessment_id}/risks/{assessment_risk_id}/kris/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_kri(
    assessment_id: int,
    assessment_risk_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    link = db.query(RiskAssessmentKRI).filter(
        RiskAssessmentKRI.id == link_id,
        RiskAssessmentKRI.assessment_risk_id == assessment_risk_id
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KRI link not found")

    db.delete(link)
    db.commit()
    return None


@router.post("/{assessment_id}/risks/{assessment_risk_id}/incidents", status_code=status.HTTP_201_CREATED)
def link_incident_to_assessment_risk(
    assessment_id: int,
    assessment_risk_id: int,
    data: IncidentLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    incident = db.query(RiskIncident).filter(RiskIncident.id == data.incident_id).first()
    if not incident:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")

    link = RiskAssessmentIncident(
        assessment_risk_id=assessment_risk_id,
        incident_id=data.incident_id,
        impact_on_rating=data.impact_on_rating,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return {
        "id": link.id,
        "assessment_risk_id": link.assessment_risk_id,
        "incident_id": link.incident_id,
        "impact_on_rating": link.impact_on_rating,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


@router.delete("/{assessment_id}/risks/{assessment_risk_id}/incidents/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_incident(
    assessment_id: int,
    assessment_risk_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    link = db.query(RiskAssessmentIncident).filter(
        RiskAssessmentIncident.id == link_id,
        RiskAssessmentIncident.assessment_risk_id == assessment_risk_id
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident link not found")

    db.delete(link)
    db.commit()
    return None


@router.post("/{assessment_id}/risks/{assessment_risk_id}/rcsa-findings", status_code=status.HTTP_201_CREATED)
def link_rcsa_finding_to_assessment_risk(
    assessment_id: int,
    assessment_risk_id: int,
    data: RCSAFindingLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    finding = db.query(RCSAFinding).filter(RCSAFinding.id == data.rcsa_finding_id).first()
    if not finding:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RCSA finding not found")

    link = RiskAssessmentRCSAFinding(
        assessment_risk_id=assessment_risk_id,
        rcsa_finding_id=data.rcsa_finding_id,
        relevance_notes=data.relevance_notes,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return {
        "id": link.id,
        "assessment_risk_id": link.assessment_risk_id,
        "rcsa_finding_id": link.rcsa_finding_id,
        "relevance_notes": link.relevance_notes,
        "created_at": link.created_at.isoformat() if link.created_at else None,
    }


@router.delete("/{assessment_id}/risks/{assessment_risk_id}/rcsa-findings/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_rcsa_finding(
    assessment_id: int,
    assessment_risk_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    link = db.query(RiskAssessmentRCSAFinding).filter(
        RiskAssessmentRCSAFinding.id == link_id,
        RiskAssessmentRCSAFinding.assessment_risk_id == assessment_risk_id
    ).first()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RCSA finding link not found")

    db.delete(link)
    db.commit()
    return None


@router.get("/{assessment_id}/summary")
def get_assessment_summary(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    assessment = db.query(RiskAssessment).options(
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_kris),
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_incidents),
        joinedload(RiskAssessment.assessed_risks).joinedload(RiskAssessmentRisk.linked_rcsa_findings),
    ).filter(
        RiskAssessment.id == assessment_id,
        RiskAssessment.tenant_id.in_(user_tenants)
    ).first()

    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Risk assessment not found")

    risks = assessment.assessed_risks
    total = len(risks)

    by_rating = {}
    by_treatment = {}
    total_inherent = 0.0
    total_residual = 0.0
    scored_count = 0
    total_kris = 0
    total_incidents = 0
    total_rcsa_findings = 0

    for ar in risks:
        rating = ar.risk_rating or "unrated"
        by_rating[rating] = by_rating.get(rating, 0) + 1

        treatment = ar.treatment_decision or "undecided"
        by_treatment[treatment] = by_treatment.get(treatment, 0) + 1

        if ar.inherent_score is not None:
            total_inherent += ar.inherent_score
            scored_count += 1
        if ar.residual_score is not None:
            total_residual += ar.residual_score

        total_kris += len(ar.linked_kris)
        total_incidents += len(ar.linked_incidents)
        total_rcsa_findings += len(ar.linked_rcsa_findings)

    return {
        "assessment_id": assessment.id,
        "assessment_name": assessment.name,
        "status": assessment.status,
        "total_risks_assessed": total,
        "by_risk_rating": by_rating,
        "by_treatment_decision": by_treatment,
        "avg_inherent_score": round(total_inherent / scored_count, 2) if scored_count > 0 else 0,
        "avg_residual_score": round(total_residual / scored_count, 2) if scored_count > 0 else 0,
        "total_linked_kris": total_kris,
        "total_linked_incidents": total_incidents,
        "total_linked_rcsa_findings": total_rcsa_findings,
    }


def _get_openai_client() -> OpenAI:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(api_key=api_key, base_url=base_url)


@router.post("/{assessment_id}/risks/{assessment_risk_id}/ai-suggest")
def ai_suggest_assessment_risk(
    assessment_id: int,
    assessment_risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    ar = _get_assessment_risk_or_404(assessment_id, assessment_risk_id, db)

    risk = db.query(Risk).filter(Risk.id == ar.risk_id).first()

    linked_kris = db.query(RiskAssessmentKRI).filter(
        RiskAssessmentKRI.assessment_risk_id == assessment_risk_id
    ).all()
    linked_incidents = db.query(RiskAssessmentIncident).filter(
        RiskAssessmentIncident.assessment_risk_id == assessment_risk_id
    ).all()
    linked_rcsa = db.query(RiskAssessmentRCSAFinding).filter(
        RiskAssessmentRCSAFinding.assessment_risk_id == assessment_risk_id
    ).all()

    risk_context = {
        "title": risk.title if risk else f"Risk #{ar.risk_id}",
        "description": risk.description if risk else None,
        "category": (risk.risk_category or risk.category) if risk else None,
        "inherent_likelihood": ar.inherent_likelihood,
        "inherent_impact": ar.inherent_impact,
        "inherent_score": ar.inherent_score,
        "residual_likelihood": ar.residual_likelihood,
        "residual_impact": ar.residual_impact,
        "residual_score": ar.residual_score,
    }

    kri_info = []
    for lk in linked_kris:
        kri = db.query(RiskKRI).filter(RiskKRI.id == lk.kri_id).first()
        kri_info.append({
            "name": kri.name if kri else f"KRI #{lk.kri_id}",
            "observed_value": lk.observed_value,
            "threshold_status": lk.threshold_status,
        })

    incident_info = []
    for li in linked_incidents:
        inc = db.query(RiskIncident).filter(RiskIncident.id == li.incident_id).first()
        incident_info.append({
            "title": inc.title if inc else f"Incident #{li.incident_id}",
            "severity": inc.severity if inc else None,
            "impact_on_rating": li.impact_on_rating,
        })

    rcsa_info = []
    for lf in linked_rcsa:
        finding = db.query(RCSAFinding).filter(RCSAFinding.id == lf.rcsa_finding_id).first()
        rcsa_info.append({
            "title": finding.title if finding else f"Finding #{lf.rcsa_finding_id}",
            "severity": finding.severity if finding and hasattr(finding, 'severity') else None,
            "relevance_notes": lf.relevance_notes,
        })

    prompt = f"""You are an enterprise risk management expert. Analyze the following assessed risk and provide suggestions for a risk assessment.

Risk Details:
- Title: {risk_context['title']}
- Description: {risk_context['description'] or 'Not provided'}
- Category: {risk_context['category'] or 'Not specified'}
- Inherent Scores: Likelihood={risk_context['inherent_likelihood']}, Impact={risk_context['inherent_impact']}, Score={risk_context['inherent_score']}
- Residual Scores: Likelihood={risk_context['residual_likelihood']}, Impact={risk_context['residual_impact']}, Score={risk_context['residual_score']}

Linked KRIs: {json.dumps(kri_info) if kri_info else 'None'}
Linked Incidents: {json.dumps(incident_info) if incident_info else 'None'}
Linked RCSA Findings: {json.dumps(rcsa_info) if rcsa_info else 'None'}

Based on this information, provide your assessment recommendations in the following JSON format:
{{
  "treatment_decision": "<one of: accept, mitigate, transfer, avoid>",
  "control_effectiveness": "<one of: effective, partially_effective, ineffective>",
  "rationale": "<2-3 sentence rationale for the treatment decision and control effectiveness assessment>",
  "notes": "<additional observations, recommendations, or action items for the risk assessor>"
}}

Consider:
- The risk scores and their severity
- KRI threshold breaches indicate control weaknesses
- Linked incidents suggest realized risk events
- RCSA findings indicate process-level control gaps
- Higher residual scores relative to inherent scores suggest ineffective controls

Return ONLY the JSON object, no additional text."""

    try:
        client = _get_openai_client()
        model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=600,
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        result = json.loads(content)

        valid_treatments = ["accept", "mitigate", "transfer", "avoid"]
        valid_effectiveness = ["effective", "partially_effective", "ineffective"]
        if result.get("treatment_decision") not in valid_treatments:
            result["treatment_decision"] = "mitigate"
        if result.get("control_effectiveness") not in valid_effectiveness:
            result["control_effectiveness"] = "partially_effective"

        return result

    except HTTPException:
        raise
    except json.JSONDecodeError:
        logger.warning("AI returned non-JSON response for assessment risk suggestion")
        return _fallback_suggestion(risk_context, kri_info, incident_info, rcsa_info)
    except Exception as e:
        logger.error(f"AI suggestion error: {e}")
        return _fallback_suggestion(risk_context, kri_info, incident_info, rcsa_info)


def _fallback_suggestion(risk_context, kri_info, incident_info, rcsa_info):
    residual_score = risk_context.get("residual_score")
    inherent_score = risk_context.get("inherent_score")
    has_breached_kris = any(k.get("threshold_status") == "breached" for k in kri_info)
    has_incidents = len(incident_info) > 0

    if residual_score and residual_score >= 21:
        treatment = "avoid"
        effectiveness = "ineffective"
    elif residual_score and residual_score >= 13:
        treatment = "mitigate"
        effectiveness = "partially_effective" if has_breached_kris or has_incidents else "effective"
    elif residual_score and residual_score >= 6:
        treatment = "mitigate"
        effectiveness = "partially_effective"
    else:
        treatment = "accept"
        effectiveness = "effective"

    if has_breached_kris:
        effectiveness = "partially_effective" if effectiveness == "effective" else effectiveness

    rationale_parts = [f"Risk '{risk_context['title']}' has a residual score of {residual_score or 'N/A'}."]
    if has_breached_kris:
        rationale_parts.append(f"{sum(1 for k in kri_info if k.get('threshold_status') == 'breached')} KRI(s) have breached thresholds, indicating control weaknesses.")
    if has_incidents:
        rationale_parts.append(f"{len(incident_info)} linked incident(s) suggest this risk has materialized previously.")

    notes_parts = []
    if has_breached_kris:
        notes_parts.append("Review and strengthen controls associated with breached KRIs.")
    if has_incidents:
        notes_parts.append("Conduct root cause analysis on linked incidents to prevent recurrence.")
    if len(rcsa_info) > 0:
        notes_parts.append(f"Address {len(rcsa_info)} RCSA finding(s) to improve control environment.")
    if not notes_parts:
        notes_parts.append("Continue monitoring risk indicators and maintain current control framework.")

    return {
        "treatment_decision": treatment,
        "control_effectiveness": effectiveness,
        "rationale": " ".join(rationale_parts),
        "notes": " ".join(notes_parts),
    }


@router.get("/{assessment_id}/available-risks")
def get_available_risks(
    assessment_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)

    existing_risk_ids = {
        r.risk_id for r in db.query(RiskAssessmentRisk.risk_id).filter(
            RiskAssessmentRisk.assessment_id == assessment_id
        ).all()
    }

    query = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants))
    if existing_risk_ids:
        query = query.filter(~Risk.id.in_(existing_risk_ids))

    risks = query.order_by(Risk.title).offset(skip).limit(limit).all()

    return [
        {
            "id": r.id,
            "title": r.title,
            "category": r.risk_category or r.category,
            "inherent_likelihood": r.inherent_likelihood,
            "inherent_impact": r.inherent_impact,
            "inherent_score": r.inherent_score,
            "residual_likelihood": r.residual_likelihood,
            "residual_impact": r.residual_impact,
            "residual_score": r.residual_score,
            "status": r.status,
        }
        for r in risks
    ]


EXCEL_HEADER_MAPPINGS = {
    "risk_id": ["risk id", "risk_id", "id", "ref", "reference", "risk ref", "risk reference", "risk no", "risk number"],
    "category": ["risk category", "category", "risk_category", "risk type", "type", "domain", "risk area", "risk area domain", "risk domain"],
    "title": ["risk title", "title", "risk name", "name", "risk", "risk_title", "risk scenario", "scenario", "risk statement"],
    "description": ["risk description", "description", "risk_description", "details", "risk detail", "risk details"],
    "owner": ["risk owner", "owner", "risk_owner", "assigned to", "responsible"],
    "inherent_likelihood": ["inherent likelihood", "inherent_likelihood", "inh likelihood", "inh. likelihood", "inherent probability", "likelihood", "l(1-5)", "inh l", "likelihood (1-5)"],
    "inherent_impact": ["inherent impact", "inherent_impact", "inh impact", "inh. impact", "impact", "i(1-5)", "inh i", "impact (1-5)"],
    "inherent_score": ["inherent score", "inherent_score", "inh score", "inh. score", "inherent risk score", "inherent rating"],
    "controls": ["controls", "control", "existing controls", "control description", "current controls", "mitigating controls", "key controls"],
    "control_effectiveness": ["control effectiveness", "control_effectiveness", "effectiveness", "control rating", "eff", "design eff", "control design effectiveness"],
    "residual_likelihood": ["residual likelihood", "residual_likelihood", "res likelihood", "res. likelihood", "res l", "residual l"],
    "residual_impact": ["residual impact", "residual_impact", "res impact", "res. impact", "res i", "residual i"],
    "residual_score": ["residual score", "residual_score", "res score", "res. score", "residual risk score", "residual rating"],
    "status": ["status", "risk status", "current status", "state", "level"],
    "mitigation_actions": ["mitigation actions", "mitigation_actions", "mitigations", "action plan", "treatment", "mitigation", "treatment plan", "actions"],
    "target_date": ["target date", "target_date", "due date", "deadline", "completion date", "target completion", "target"],
}

VALID_CATEGORIES = ["strategic", "operational", "financial", "compliance", "technology", "third_party", "project_change"]

STATUS_MAPPING = {
    "open": "open",
    "active": "open",
    "in progress": "open",
    "mitigated": "mitigated",
    "closed": "closed",
    "accepted": "accepted",
    "monitoring": "monitoring",
    "under review": "open",
    "new": "open",
}


def _normalize(text: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', str(text).lower())).strip()


def _map_headers(header_row):
    col_map = {}
    normalized_aliases = {
        field: [_normalize(alias) for alias in aliases]
        for field, aliases in EXCEL_HEADER_MAPPINGS.items()
    }

    for idx, cell in enumerate(header_row):
        if cell is None:
            continue
        normalized = _normalize(str(cell))
        for field, aliases in normalized_aliases.items():
            if normalized in aliases:
                col_map[field] = idx
                break
    return col_map


def _safe_int(val, default=None):
    if val is None:
        return default
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def _safe_float(val, default=None):
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _map_category(raw_category: str) -> str:
    if not raw_category:
        return "operational"
    normalized = raw_category.lower().strip()
    for valid in VALID_CATEGORIES:
        if valid in normalized or normalized in valid:
            return valid

    category_keywords = {
        "strategic": ["strategy", "strategic", "business strategy"],
        "operational": ["operational", "operations", "process", "people"],
        "financial": ["financial", "finance", "monetary", "fiscal", "liquidity", "credit", "market risk"],
        "compliance": ["compliance", "regulatory", "legal", "regulation", "law"],
        "technology": ["technology", "tech", "it", "cyber", "information", "data", "system", "digital", "infrastructure"],
        "third_party": ["third party", "vendor", "supplier", "outsourcing", "third-party", "external"],
        "project_change": ["project", "change", "transformation", "implementation"],
    }
    for cat, keywords in category_keywords.items():
        for keyword in keywords:
            if keyword in normalized:
                return cat
    return "operational"


def _map_status(raw_status: str) -> str:
    if not raw_status:
        return "open"
    normalized = raw_status.lower().strip()
    return STATUS_MAPPING.get(normalized, "open")


def _map_control_effectiveness(raw: str) -> str:
    if not raw:
        return "partially_effective"
    normalized = raw.lower().strip()
    if "effective" in normalized and "partially" not in normalized and "in" not in normalized:
        return "effective"
    if "partial" in normalized:
        return "partially_effective"
    if "ineffective" in normalized or "not effective" in normalized or "weak" in normalized:
        return "ineffective"
    return "partially_effective"


@router.post("/upload-excel")
async def upload_excel_risk_assessment(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    assessment_type: str = Form("ad_hoc"),
    methodology: str = Form("qualitative"),
    scope: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if not file.filename or not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only Excel files (.xlsx, .xls) are supported"
        )

    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")

    try:
        import openpyxl

        contents = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        ws = wb.active

        rows = list(ws.iter_rows(values_only=True))
        if len(rows) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Excel file must have a header row and at least one data row"
            )

        header_row_index = None
        col_map = {}
        best_match_count = 0

        for idx, header_candidate in enumerate(rows[:20]):
            candidate_map = _map_headers(header_candidate)
            match_count = len(candidate_map)
            if match_count > best_match_count:
                best_match_count = match_count
                col_map = candidate_map
                header_row_index = idx

        if "title" not in col_map:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not identify a 'Risk Title' or 'Title' column in the header row"
            )

        if header_row_index is None:
            header_row_index = 0

        assessment_name = name or (file.filename.rsplit('.', 1)[0] if file.filename else "Imported Risk Assessment")

        assessment = RiskAssessment(
            tenant_id=tenant_id,
            name=assessment_name,
            description=f"Imported from Excel file: {file.filename}",
            assessment_type=assessment_type if assessment_type in ["periodic", "annual", "ad_hoc", "triggered"] else "ad_hoc",
            methodology=methodology if methodology in ["qualitative", "quantitative", "semi_quantitative"] else "qualitative",
            scope=scope or f"Auto-imported from {file.filename}",
            status="draft",
        )
        db.add(assessment)
        db.flush()

        created_risks = []
        skipped_rows = []
        error_rows = []

        for row_idx, row in enumerate(rows[header_row_index + 1:], start=header_row_index + 2):
            try:
                all_none = all(cell is None or str(cell).strip() == "" for cell in row)
                if all_none:
                    skipped_rows.append({"row": row_idx, "reason": "Empty row"})
                    continue

                title_val = row[col_map["title"]] if "title" in col_map else None
                if not title_val or str(title_val).strip() == "":
                    skipped_rows.append({"row": row_idx, "reason": "Missing title"})
                    continue

                title_str = str(title_val).strip()
                if title_str.lower() in ["risk title", "title", "risk name", "name"]:
                    skipped_rows.append({"row": row_idx, "reason": "Header-like row"})
                    continue

                raw_category = str(row[col_map["category"]]).strip() if "category" in col_map and row[col_map["category"]] else ""
                description = str(row[col_map["description"]]).strip() if "description" in col_map and row[col_map["description"]] else ""
                raw_status = str(row[col_map["status"]]).strip() if "status" in col_map and row[col_map["status"]] else ""
                mitigation = str(row[col_map["mitigation_actions"]]).strip() if "mitigation_actions" in col_map and row[col_map["mitigation_actions"]] else ""
                controls_text = str(row[col_map["controls"]]).strip() if "controls" in col_map and row[col_map["controls"]] else ""
                raw_effectiveness = str(row[col_map["control_effectiveness"]]).strip() if "control_effectiveness" in col_map and row[col_map["control_effectiveness"]] else ""

                inh_likelihood = _safe_int(row[col_map["inherent_likelihood"]] if "inherent_likelihood" in col_map else None)
                inh_impact = _safe_int(row[col_map["inherent_impact"]] if "inherent_impact" in col_map else None)
                inh_score = _safe_float(row[col_map["inherent_score"]] if "inherent_score" in col_map else None)
                res_likelihood = _safe_int(row[col_map["residual_likelihood"]] if "residual_likelihood" in col_map else None)
                res_impact = _safe_int(row[col_map["residual_impact"]] if "residual_impact" in col_map else None)
                res_score = _safe_float(row[col_map["residual_score"]] if "residual_score" in col_map else None)

                if inh_score is None and inh_likelihood and inh_impact:
                    inh_score = float(inh_likelihood * inh_impact)
                if res_score is None and res_likelihood and res_impact:
                    res_score = float(res_likelihood * res_impact)

                mapped_category = _map_category(raw_category)

                target_date = None
                if "target_date" in col_map and row[col_map["target_date"]]:
                    td_val = row[col_map["target_date"]]
                    if isinstance(td_val, datetime):
                        target_date = td_val
                    else:
                        try:
                            target_date = datetime.strptime(str(td_val).strip(), "%Y-%m-%d")
                        except ValueError:
                            try:
                                target_date = datetime.strptime(str(td_val).strip(), "%m/%d/%Y")
                            except ValueError:
                                target_date = None

                risk = Risk(
                    tenant_id=tenant_id,
                    title=title_str,
                    description=description or None,
                    category=mapped_category,
                    risk_category=mapped_category,
                    inherent_likelihood=inh_likelihood,
                    inherent_impact=inh_impact,
                    inherent_score=inh_score,
                    residual_likelihood=res_likelihood,
                    residual_impact=res_impact,
                    residual_score=res_score,
                    status=_map_status(raw_status),
                    treatment_plan=mitigation or None,
                    due_date=target_date,
                )
                db.add(risk)
                db.flush()

                assessment_risk = RiskAssessmentRisk(
                    assessment_id=assessment.id,
                    risk_id=risk.id,
                    inherent_likelihood=inh_likelihood,
                    inherent_impact=inh_impact,
                    inherent_score=inh_score,
                    residual_likelihood=res_likelihood,
                    residual_impact=res_impact,
                    residual_score=res_score,
                    control_effectiveness=_map_control_effectiveness(raw_effectiveness),
                    notes=controls_text or None,
                    assessed_by=current_user.id,
                    assessed_at=datetime.utcnow(),
                )
                db.add(assessment_risk)

                created_risks.append({
                    "row": row_idx,
                    "risk_id": risk.id,
                    "title": title_str,
                    "category": mapped_category,
                })

            except Exception as row_error:
                logger.error(f"Error processing row {row_idx}: {str(row_error)}")
                error_rows.append({"row": row_idx, "error": str(row_error)})

        db.commit()
        wb.close()

        return {
            "assessment_id": assessment.id,
            "assessment_name": assessment.name,
            "risks_created": len(created_risks),
            "rows_skipped": len(skipped_rows),
            "rows_errored": len(error_rows),
            "skipped_details": skipped_rows[:10],
            "error_details": error_rows[:10],
            "mapped_columns": list(col_map.keys()),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Risk assessment Excel upload failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to upload risk assessment file: {str(e)}"
        )
