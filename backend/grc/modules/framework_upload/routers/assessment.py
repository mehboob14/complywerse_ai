from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    FrameworkAssessment, AssessmentItem, AssessmentRemediation,
    ParsedFrameworkControl, UploadedFramework, AssessmentEvidence,
    GRCUser, Tenant, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/assessment", tags=["Framework Upload - Assessment"])


class AssessmentCreate(BaseModel):
    uploaded_framework_id: int
    name: str
    description: Optional[str] = None
    target_completion_date: Optional[datetime] = None
    lead_assessor_id: Optional[int] = None
    department: Optional[str] = None
    scope: Optional[str] = None


class AssessmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    target_completion_date: Optional[datetime] = None
    lead_assessor_id: Optional[int] = None
    department: Optional[str] = None
    scope: Optional[str] = None


class AssessmentItemUpdate(BaseModel):
    compliance_status: Optional[str] = None
    compliance_score: Optional[float] = None
    owner_id: Optional[int] = None
    department: Optional[str] = None
    assessment_notes: Optional[str] = None
    gap_description: Optional[str] = None


class RemediationCreate(BaseModel):
    title: str
    description: Optional[str] = None
    priority: Optional[str] = "medium"
    due_date: Optional[datetime] = None
    owner_id: Optional[int] = None
    estimated_effort: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_assessment(assessment: FrameworkAssessment, items_count: int = 0, compliance_summary: dict = None) -> dict:
    return {
        "id": assessment.id,
        "tenant_id": assessment.tenant_id,
        "uploaded_framework_id": assessment.uploaded_framework_id,
        "name": assessment.name,
        "description": assessment.description,
        "assessment_date": assessment.assessment_date.isoformat() if assessment.assessment_date else None,
        "target_completion_date": assessment.target_completion_date.isoformat() if assessment.target_completion_date else None,
        "status": assessment.status,
        "overall_compliance_score": assessment.overall_compliance_score,
        "lead_assessor_id": assessment.lead_assessor_id,
        "lead_assessor_name": assessment.lead_assessor.display_name if assessment.lead_assessor else None,
        "department": assessment.department,
        "scope": assessment.scope,
        "created_by": assessment.created_by,
        "creator_name": assessment.creator.display_name if assessment.creator else None,
        "created_at": assessment.created_at.isoformat() if assessment.created_at else None,
        "updated_at": assessment.updated_at.isoformat() if assessment.updated_at else None,
        "completed_at": assessment.completed_at.isoformat() if assessment.completed_at else None,
        "items_count": items_count,
        "compliance_summary": compliance_summary or {}
    }


def serialize_assessment_item(item: AssessmentItem, evidence_count: int = 0) -> dict:
    control = item.parsed_control
    return {
        "id": item.id,
        "assessment_id": item.assessment_id,
        "parsed_control_id": item.parsed_control_id,
        "control_id": control.control_id if control else None,
        "control_title": control.title if control else None,
        "control_description": control.description if control else None,
        "control_domain": control.domain if control else None,
        "control_category": control.category if control else None,
        "control_priority": control.priority if control else None,
        "compliance_status": item.compliance_status,
        "compliance_score": item.compliance_score,
        "owner_id": item.owner_id,
        "owner_name": item.owner.display_name if item.owner else None,
        "department": item.department,
        "assessment_notes": item.assessment_notes,
        "gap_description": item.gap_description,
        "assessed_by": item.assessed_by,
        "assessor_name": item.assessor.display_name if item.assessor else None,
        "assessed_at": item.assessed_at.isoformat() if item.assessed_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
        "evidence_count": evidence_count,
        "remediation_count": len(item.remediation_actions) if item.remediation_actions else 0
    }


def serialize_remediation(remediation: AssessmentRemediation) -> dict:
    return {
        "id": remediation.id,
        "assessment_item_id": remediation.assessment_item_id,
        "title": remediation.title,
        "description": remediation.description,
        "priority": remediation.priority,
        "status": remediation.status,
        "due_date": remediation.due_date.isoformat() if remediation.due_date else None,
        "completed_at": remediation.completed_at.isoformat() if remediation.completed_at else None,
        "owner_id": remediation.owner_id,
        "owner_name": remediation.owner.display_name if remediation.owner else None,
        "estimated_effort": remediation.estimated_effort,
        "actual_effort": remediation.actual_effort,
        "completion_notes": remediation.completion_notes,
        "created_by": remediation.created_by,
        "creator_name": remediation.creator.display_name if remediation.creator else None,
        "created_at": remediation.created_at.isoformat() if remediation.created_at else None,
        "updated_at": remediation.updated_at.isoformat() if remediation.updated_at else None
    }


def get_compliance_summary(db: Session, assessment_id: int) -> dict:
    items = db.query(AssessmentItem).filter(AssessmentItem.assessment_id == assessment_id).all()
    summary = {
        "total": len(items),
        "not_assessed": 0,
        "compliant": 0,
        "partially_compliant": 0,
        "non_compliant": 0,
        "not_applicable": 0
    }
    for item in items:
        status_key = item.compliance_status or "not_assessed"
        if status_key in summary:
            summary[status_key] += 1
    return summary


@router.post("", status_code=status.HTTP_201_CREATED)
def create_assessment(
    assessment_data: AssessmentCreate,
    tenant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == assessment_data.uploaded_framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    user_tenants = get_user_tenants(current_user, db)
    if framework.tenant_id and framework.tenant_id not in user_tenants and not framework.is_shared:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this framework"
        )
    
    assessment = FrameworkAssessment(
        tenant_id=tenant_id,
        uploaded_framework_id=assessment_data.uploaded_framework_id,
        name=assessment_data.name,
        description=assessment_data.description,
        target_completion_date=assessment_data.target_completion_date,
        lead_assessor_id=assessment_data.lead_assessor_id,
        department=assessment_data.department,
        scope=assessment_data.scope,
        status="in_progress",
        created_by=current_user.id
    )
    db.add(assessment)
    db.flush()
    
    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == assessment_data.uploaded_framework_id
    ).all()
    
    assessment_items = []
    for control in parsed_controls:
        item = AssessmentItem(
            assessment_id=assessment.id,
            parsed_control_id=control.id,
            compliance_status="not_assessed"
        )
        db.add(item)
        assessment_items.append(item)
    
    db.commit()
    db.refresh(assessment)
    
    return {
        **serialize_assessment(assessment, len(assessment_items)),
        "items": [serialize_assessment_item(item) for item in assessment_items]
    }


@router.get("")
def list_assessments(
    tenant_id: Optional[int] = None,
    uploaded_framework_id: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(FrameworkAssessment).filter(FrameworkAssessment.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(FrameworkAssessment.tenant_id == tenant_id)
    
    if uploaded_framework_id:
        query = query.filter(FrameworkAssessment.uploaded_framework_id == uploaded_framework_id)
    
    if status_filter:
        query = query.filter(FrameworkAssessment.status == status_filter)
    
    total = query.count()
    
    assessments = query.options(
        joinedload(FrameworkAssessment.lead_assessor),
        joinedload(FrameworkAssessment.creator)
    ).order_by(FrameworkAssessment.created_at.desc()).offset(skip).limit(limit).all()
    
    result = []
    for assessment in assessments:
        items_count = db.query(func.count(AssessmentItem.id)).filter(
            AssessmentItem.assessment_id == assessment.id
        ).scalar() or 0
        compliance_summary = get_compliance_summary(db, assessment.id)
        result.append(serialize_assessment(assessment, items_count, compliance_summary))
    
    return {
        "items": result,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/{assessment_id}")
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(FrameworkAssessment).options(
        joinedload(FrameworkAssessment.lead_assessor),
        joinedload(FrameworkAssessment.creator),
        joinedload(FrameworkAssessment.uploaded_framework)
    ).filter(
        FrameworkAssessment.id == assessment_id,
        FrameworkAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    items = db.query(AssessmentItem).options(
        joinedload(AssessmentItem.parsed_control),
        joinedload(AssessmentItem.owner),
        joinedload(AssessmentItem.assessor)
    ).filter(AssessmentItem.assessment_id == assessment_id).all()
    
    items_with_evidence = []
    for item in items:
        evidence_count = db.query(func.count(AssessmentEvidence.id)).filter(
            AssessmentEvidence.assessment_item_id == item.id
        ).scalar() or 0
        items_with_evidence.append(serialize_assessment_item(item, evidence_count))
    
    compliance_summary = get_compliance_summary(db, assessment_id)
    
    return {
        **serialize_assessment(assessment, len(items), compliance_summary),
        "framework_name": assessment.uploaded_framework.name if assessment.uploaded_framework else None,
        "items": items_with_evidence
    }


@router.put("/{assessment_id}")
def update_assessment(
    assessment_id: int,
    update_data: AssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(FrameworkAssessment).filter(
        FrameworkAssessment.id == assessment_id,
        FrameworkAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(assessment, key, value)
    
    if update_data.status == "completed" and not assessment.completed_at:
        assessment.completed_at = datetime.utcnow()
    
    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)
    
    items_count = db.query(func.count(AssessmentItem.id)).filter(
        AssessmentItem.assessment_id == assessment.id
    ).scalar() or 0
    compliance_summary = get_compliance_summary(db, assessment_id)
    
    return serialize_assessment(assessment, items_count, compliance_summary)


@router.get("/{assessment_id}/items")
def list_assessment_items(
    assessment_id: int,
    compliance_status: Optional[str] = None,
    owner_id: Optional[int] = None,
    domain: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(FrameworkAssessment).filter(
        FrameworkAssessment.id == assessment_id,
        FrameworkAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    query = db.query(AssessmentItem).join(
        ParsedFrameworkControl,
        AssessmentItem.parsed_control_id == ParsedFrameworkControl.id
    ).filter(AssessmentItem.assessment_id == assessment_id)
    
    if compliance_status:
        query = query.filter(AssessmentItem.compliance_status == compliance_status)
    
    if owner_id:
        query = query.filter(AssessmentItem.owner_id == owner_id)
    
    if domain:
        query = query.filter(ParsedFrameworkControl.domain == domain)
    
    total = query.count()
    
    items = query.options(
        joinedload(AssessmentItem.parsed_control),
        joinedload(AssessmentItem.owner),
        joinedload(AssessmentItem.assessor),
        joinedload(AssessmentItem.remediation_actions)
    ).offset(skip).limit(limit).all()
    
    result = []
    for item in items:
        evidence_count = db.query(func.count(AssessmentEvidence.id)).filter(
            AssessmentEvidence.assessment_item_id == item.id
        ).scalar() or 0
        result.append(serialize_assessment_item(item, evidence_count))
    
    return {
        "items": result,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.put("/items/{item_id}")
def update_assessment_item(
    item_id: int,
    update_data: AssessmentItemUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(AssessmentItem).options(
        joinedload(AssessmentItem.assessment)
    ).filter(AssessmentItem.id == item_id).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment item not found"
        )
    
    if item.assessment.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this assessment"
        )
    
    update_dict = update_data.dict(exclude_unset=True)
    for key, value in update_dict.items():
        setattr(item, key, value)
    
    if update_data.compliance_status and update_data.compliance_status != "not_assessed":
        item.assessed_by = current_user.id
        item.assessed_at = datetime.utcnow()
    
    item.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(item)
    
    item = db.query(AssessmentItem).options(
        joinedload(AssessmentItem.parsed_control),
        joinedload(AssessmentItem.owner),
        joinedload(AssessmentItem.assessor),
        joinedload(AssessmentItem.remediation_actions)
    ).filter(AssessmentItem.id == item_id).first()
    
    evidence_count = db.query(func.count(AssessmentEvidence.id)).filter(
        AssessmentEvidence.assessment_item_id == item.id
    ).scalar() or 0
    
    return serialize_assessment_item(item, evidence_count)


@router.post("/items/{item_id}/remediation", status_code=status.HTTP_201_CREATED)
def create_remediation(
    item_id: int,
    remediation_data: RemediationCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    item = db.query(AssessmentItem).options(
        joinedload(AssessmentItem.assessment)
    ).filter(AssessmentItem.id == item_id).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment item not found"
        )
    
    if item.assessment.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this assessment"
        )
    
    remediation = AssessmentRemediation(
        assessment_item_id=item_id,
        title=remediation_data.title,
        description=remediation_data.description,
        priority=remediation_data.priority or "medium",
        due_date=remediation_data.due_date,
        owner_id=remediation_data.owner_id,
        estimated_effort=remediation_data.estimated_effort,
        status="open",
        created_by=current_user.id
    )
    db.add(remediation)
    db.commit()
    db.refresh(remediation)
    
    remediation = db.query(AssessmentRemediation).options(
        joinedload(AssessmentRemediation.owner),
        joinedload(AssessmentRemediation.creator)
    ).filter(AssessmentRemediation.id == remediation.id).first()
    
    return serialize_remediation(remediation)


@router.get("/{assessment_id}/dashboard")
def get_assessment_dashboard(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(FrameworkAssessment).filter(
        FrameworkAssessment.id == assessment_id,
        FrameworkAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    items = db.query(AssessmentItem).options(
        joinedload(AssessmentItem.parsed_control)
    ).filter(AssessmentItem.assessment_id == assessment_id).all()
    
    total_items = len(items)
    if total_items == 0:
        return {
            "assessment_id": assessment_id,
            "assessment_name": assessment.name,
            "overall_compliance_score": 0,
            "compliance_breakdown": {},
            "items_by_domain": {},
            "gap_count": 0,
            "progress_percentage": 0,
            "total_items": 0,
            "assessed_items": 0,
            "remediation_stats": {"open": 0, "in_progress": 0, "completed": 0, "deferred": 0},
            "evidence_stats": {
                "controls_with_evidence": 0,
                "controls_without_evidence": 0,
                "total_evidence_uploaded": 0,
                "reviewed_evidence": 0,
                "not_reviewed_evidence": 0,
                "review_breakdown": {"accepted": 0, "rejected": 0, "pending": 0}
            }
        }
    
    compliance_breakdown = {
        "not_assessed": 0,
        "compliant": 0,
        "partially_compliant": 0,
        "non_compliant": 0,
        "not_applicable": 0
    }
    
    items_by_domain = {}
    gap_count = 0
    assessed_count = 0
    
    for item in items:
        status_key = item.compliance_status or "not_assessed"
        if status_key in compliance_breakdown:
            compliance_breakdown[status_key] += 1
        
        if status_key != "not_assessed":
            assessed_count += 1
        
        if item.gap_description:
            gap_count += 1
        
        domain = item.parsed_control.domain if item.parsed_control else "Uncategorized"
        if domain not in items_by_domain:
            items_by_domain[domain] = {
                "total": 0,
                "compliant": 0,
                "partially_compliant": 0,
                "non_compliant": 0,
                "not_assessed": 0,
                "not_applicable": 0
            }
        items_by_domain[domain]["total"] += 1
        if status_key in items_by_domain[domain]:
            items_by_domain[domain][status_key] += 1
    
    remediation_stats = {"open": 0, "in_progress": 0, "completed": 0, "deferred": 0}
    remediations = db.query(AssessmentRemediation).join(
        AssessmentItem,
        AssessmentRemediation.assessment_item_id == AssessmentItem.id
    ).filter(AssessmentItem.assessment_id == assessment_id).all()
    
    for rem in remediations:
        if rem.status in remediation_stats:
            remediation_stats[rem.status] += 1
    
    applicable_items = total_items - compliance_breakdown.get("not_applicable", 0)
    progress_percentage = (assessed_count / applicable_items * 100) if applicable_items > 0 else 0

    item_ids = [item.id for item in items]
    evidence_stats = {
        "controls_with_evidence": 0,
        "controls_without_evidence": total_items,
        "total_evidence_uploaded": 0,
        "reviewed_evidence": 0,
        "not_reviewed_evidence": 0,
        "review_breakdown": {"accepted": 0, "rejected": 0, "pending": 0}
    }

    if item_ids:
        evidence_rows = db.query(
            AssessmentEvidence.assessment_item_id,
            AssessmentEvidence.review_status
        ).filter(AssessmentEvidence.assessment_item_id.in_(item_ids)).all()

        evidence_stats["total_evidence_uploaded"] = len(evidence_rows)

        covered_item_ids = set()
        for evidence_item_id, review_status in evidence_rows:
            covered_item_ids.add(evidence_item_id)

            normalized_status = (review_status or "").lower()
            if normalized_status in {"accepted", "rejected"}:
                evidence_stats["reviewed_evidence"] += 1
                evidence_stats["review_breakdown"][normalized_status] += 1
            else:
                evidence_stats["not_reviewed_evidence"] += 1
                evidence_stats["review_breakdown"]["pending"] += 1

        evidence_stats["controls_with_evidence"] = len(covered_item_ids)
        evidence_stats["controls_without_evidence"] = max(0, total_items - len(covered_item_ids))
    
    return {
        "assessment_id": assessment_id,
        "assessment_name": assessment.name,
        "overall_compliance_score": assessment.overall_compliance_score,
        "compliance_breakdown": compliance_breakdown,
        "items_by_domain": items_by_domain,
        "gap_count": gap_count,
        "progress_percentage": round(progress_percentage, 1),
        "total_items": total_items,
        "assessed_items": assessed_count,
        "remediation_stats": remediation_stats,
        "evidence_stats": evidence_stats
    }


@router.post("/{assessment_id}/calculate-score")
def calculate_compliance_score(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    assessment = db.query(FrameworkAssessment).filter(
        FrameworkAssessment.id == assessment_id,
        FrameworkAssessment.tenant_id.in_(user_tenants)
    ).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment not found"
        )
    
    items = db.query(AssessmentItem).filter(
        AssessmentItem.assessment_id == assessment_id
    ).all()
    
    if not items:
        assessment.overall_compliance_score = 0
        db.commit()
        return {"assessment_id": assessment_id, "overall_compliance_score": 0, "message": "No items to calculate"}
    
    score_mapping = {
        "compliant": 1.0,
        "partially_compliant": 0.5,
        "non_compliant": 0.0,
        "not_assessed": None,
        "not_applicable": None
    }
    
    total_score = 0.0
    scored_items = 0
    
    for item in items:
        status_score = score_mapping.get(item.compliance_status)
        if status_score is not None:
            if item.compliance_score is not None:
                total_score += item.compliance_score
            else:
                total_score += status_score
            scored_items += 1
    
    if scored_items > 0:
        overall_score = (total_score / scored_items) * 100
    else:
        overall_score = 0
    
    assessment.overall_compliance_score = round(overall_score, 2)
    assessment.updated_at = datetime.utcnow()
    db.commit()
    
    return {
        "assessment_id": assessment_id,
        "overall_compliance_score": assessment.overall_compliance_score,
        "scored_items": scored_items,
        "total_items": len(items),
        "message": "Compliance score calculated successfully"
    }


assessment_router = router
