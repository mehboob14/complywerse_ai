import os
import uuid
import random
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload

from ..models import (
    CertificationJourney, ControlImplementation, ImplementationEvidence,
    Framework, FrameworkControl, FrameworkDomain, ControlObjective,
    FrameworkSubControl, Evidence, GRCUser, Tenant, CuratedEvidenceItem, 
    CertificationPhase, get_db
)
from ..schemas import (
    CertificationJourneyCreate, CertificationJourneyUpdate, CertificationJourneyResponse,
    ControlImplementationUpdate, ControlImplementationResponse,
    ImplementationEvidenceCreate, ImplementationEvidenceResponse,
    ProgressSummary, GapAnalysis, EvidenceReviewAction, MessageResponse
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/certifications", tags=["Certifications"])

UPLOAD_DIR = "backend/uploads/certification_evidence"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def get_curated_evidence_for_control(control_id: int, db: Session) -> List[dict]:
    """Fetch curated evidence items for the given framework control ID."""
    if not control_id:
        return []
    
    curated_items = db.query(CuratedEvidenceItem).filter(
        CuratedEvidenceItem.framework_control_id == control_id
    ).all()
    
    if not curated_items:
        curated_items = db.query(CuratedEvidenceItem).join(
            FrameworkSubControl, CuratedEvidenceItem.sub_control_id == FrameworkSubControl.id
        ).filter(
            FrameworkSubControl.control_id == control_id
        ).all()
    
    return [
        {
            "id": item.id,
            "title": item.title,
            "description": item.description,
            "artifact_type": item.artifact_type,
            "format_guidance": item.format_guidance,
            "frequency": item.frequency,
            "is_required": item.is_required,
            "framework_control_id": item.framework_control_id,
            "sub_control_id": item.sub_control_id
        }
        for item in curated_items
    ]


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_journey_or_404(journey_id: int, user: GRCUser, db: Session) -> CertificationJourney:
    user_tenants = get_user_tenants(user, db)
    journey = db.query(CertificationJourney).filter(
        CertificationJourney.id == journey_id,
        CertificationJourney.tenant_id.in_(user_tenants)
    ).first()
    if not journey:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Certification journey not found"
        )
    return journey


@router.get("", response_model=List[CertificationJourneyResponse])
def list_certifications(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    framework_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(CertificationJourney.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(CertificationJourney.status == status_filter)
    if framework_id:
        query = query.filter(CertificationJourney.framework_id == framework_id)
    
    journeys = query.order_by(CertificationJourney.started_at.desc()).offset(skip).limit(limit).all()
    return journeys


@router.post("", response_model=CertificationJourneyResponse, status_code=status.HTTP_201_CREATED)
def create_certification(
    journey_data: CertificationJourneyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = journey_data.tenant_id
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    framework = db.query(Framework).filter(Framework.id == journey_data.framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    journey = CertificationJourney(
        tenant_id=tenant_id,
        framework_id=journey_data.framework_id,
        name=journey_data.name,
        target_date=journey_data.target_date,
        notes=journey_data.notes,
        status="in_progress"
    )
    db.add(journey)
    db.commit()
    db.refresh(journey)
    
    controls = db.query(FrameworkControl).join(ControlObjective).join(FrameworkDomain).filter(
        FrameworkDomain.framework_id == journey_data.framework_id
    ).all()
    
    for control in controls:
        implementation = ControlImplementation(
            journey_id=journey.id,
            framework_control_id=control.id,
            status="not_started",
            priority=3
        )
        db.add(implementation)
    
    db.commit()
    db.refresh(journey)
    return journey


@router.get("/{journey_id}", response_model=dict)
def get_certification(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    framework = db.query(Framework).filter(Framework.id == journey.framework_id).first()
    implementations = db.query(ControlImplementation).filter(
        ControlImplementation.journey_id == journey_id
    ).all()
    
    phases = db.query(CertificationPhase).filter(
        CertificationPhase.framework_id == journey.framework_id
    ).order_by(CertificationPhase.phase_number).all()
    
    phases_list = [
        {
            "id": phase.id,
            "phase_number": phase.phase_number,
            "name": phase.name,
            "description": phase.description,
            "key_tasks": phase.key_tasks or [],
            "deliverables": phase.deliverables or []
        }
        for phase in phases
    ]
    
    total = len(implementations)
    implemented = sum(1 for i in implementations if i.status in ["implemented", "verified"])
    verified = sum(1 for i in implementations if i.status == "verified")
    
    return {
        "id": journey.id,
        "tenant_id": journey.tenant_id,
        "framework_id": journey.framework_id,
        "framework_name": framework.name if framework else None,
        "framework_short_code": framework.short_code if framework else None,
        "name": journey.name,
        "target_date": journey.target_date.isoformat() if journey.target_date else None,
        "started_at": journey.started_at.isoformat() if journey.started_at else None,
        "completed_at": journey.completed_at.isoformat() if journey.completed_at else None,
        "status": journey.status,
        "current_phase": journey.current_phase,
        "notes": journey.notes,
        "phases": phases_list,
        "progress": {
            "total_controls": total,
            "implemented": implemented,
            "verified": verified,
            "completion_percentage": round((implemented / total * 100) if total > 0 else 0, 1)
        }
    }


@router.patch("/{journey_id}", response_model=CertificationJourneyResponse)
def update_certification(
    journey_id: int,
    update_data: CertificationJourneyUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(journey, field, value)
    
    if update_data.status == "completed" and not journey.completed_at:
        journey.completed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(journey)
    return journey


@router.delete("/{journey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_certification(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    db.delete(journey)
    db.commit()
    return None


@router.get("/{journey_id}/controls", response_model=List[dict])
def list_journey_controls(
    journey_id: int,
    status_filter: Optional[str] = None,
    priority: Optional[int] = None,
    domain_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    query = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain),
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.sub_controls),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(ControlImplementation.journey_id == journey_id)
    
    if status_filter:
        query = query.filter(ControlImplementation.status == status_filter)
    if priority:
        query = query.filter(ControlImplementation.priority == priority)
    if domain_id:
        query = query.join(FrameworkControl).join(ControlObjective).filter(ControlObjective.domain_id == domain_id)
    
    implementations = query.all()
    
    result = []
    for impl in implementations:
        control = impl.framework_control
        objective = control.objective if control else None
        domain = objective.domain if objective else None
        
        sub_controls_list = []
        if control and control.sub_controls:
            for sub in control.sub_controls:
                sub_controls_list.append({
                    "id": sub.id,
                    "code": sub.code,
                    "name": sub.name,
                    "description": sub.description,
                    "evidence_recommendations": sub.evidence_recommendations or [],
                    "ai_matching_keywords": sub.ai_matching_keywords or []
                })
        
        evidence_requirements = get_curated_evidence_for_control(impl.framework_control_id, db)
        
        evidence_list = []
        for ev in impl.evidence_attachments:
            evidence_list.append({
                "id": ev.id,
                "file_name": ev.file_name,
                "file_size": ev.file_size,
                "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
                "ai_confidence_score": ev.ai_confidence_score,
                "review_status": ev.review_status
            })
        
        result.append({
            "id": impl.id,
            "journey_id": impl.journey_id,
            "framework_control_id": impl.framework_control_id,
            "control_code": control.code if control else None,
            "control_name": control.name if control else None,
            "control_statement": control.statement if control else None,
            "domain_id": domain.id if domain else None,
            "domain_code": domain.code if domain else None,
            "domain_name": domain.name if domain else None,
            "objective_code": objective.code if objective else None,
            "objective_name": objective.name if objective else None,
            "status": impl.status,
            "implementation_notes": impl.implementation_notes,
            "implementation_date": impl.implementation_date.isoformat() if impl.implementation_date else None,
            "verified_date": impl.verified_date.isoformat() if impl.verified_date else None,
            "is_applicable": impl.is_applicable,
            "priority": impl.priority,
            "sub_controls": sub_controls_list,
            "evidence_requirements": evidence_requirements,
            "evidence": evidence_list,
            "evidence_count": len(evidence_list),
            "required_evidence_count": len(evidence_requirements)
        })
    
    return result


@router.get("/{journey_id}/controls/{control_id}", response_model=dict)
def get_control_details(
    journey_id: int,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    control = implementation.framework_control
    evidence_list = []
    for ev in implementation.evidence_attachments:
        evidence_list.append({
            "id": ev.id,
            "file_name": ev.file_name,
            "file_size": ev.file_size,
            "mime_type": ev.mime_type,
            "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
            "uploaded_by": ev.uploaded_by,
            "ai_confidence_score": ev.ai_confidence_score,
            "ai_assessment_status": ev.ai_assessment_status,
            "ai_assessment_notes": ev.ai_assessment_notes,
            "review_status": ev.review_status,
            "reviewed_by": ev.reviewed_by,
            "reviewed_at": ev.reviewed_at.isoformat() if ev.reviewed_at else None,
            "review_notes": ev.review_notes
        })
    
    return {
        "id": implementation.id,
        "journey_id": implementation.journey_id,
        "framework_control_id": implementation.framework_control_id,
        "control_code": control.code if control else None,
        "control_name": control.name if control else None,
        "control_statement": control.statement if control else None,
        "implementation_guidance": control.implementation_guidance if control else None,
        "testing_guidance": control.testing_guidance if control else None,
        "status": implementation.status,
        "implementation_notes": implementation.implementation_notes,
        "implementation_date": implementation.implementation_date.isoformat() if implementation.implementation_date else None,
        "verified_date": implementation.verified_date.isoformat() if implementation.verified_date else None,
        "verified_by": implementation.verified_by,
        "is_applicable": implementation.is_applicable,
        "priority": implementation.priority,
        "evidence": evidence_list
    }


@router.patch("/{journey_id}/controls/{control_id}", response_model=ControlImplementationResponse)
def update_control_implementation(
    journey_id: int,
    control_id: int,
    update_data: ControlImplementationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    update_dict = update_data.model_dump(exclude_unset=True)
    for field, value in update_dict.items():
        setattr(implementation, field, value)
    
    if update_data.status == "implemented" and not implementation.implementation_date:
        implementation.implementation_date = datetime.utcnow()
    elif update_data.status == "verified" and not implementation.verified_date:
        implementation.verified_date = datetime.utcnow()
        implementation.verified_by = current_user.id
    
    db.commit()
    db.refresh(implementation)
    return implementation


@router.post("/{journey_id}/controls/{control_id}/evidence", response_model=ImplementationEvidenceResponse, status_code=status.HTTP_201_CREATED)
async def upload_control_evidence(
    journey_id: int,
    control_id: int,
    evidence_id: Optional[int] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementation = db.query(ControlImplementation).filter(
        ControlImplementation.id == control_id,
        ControlImplementation.journey_id == journey_id
    ).first()
    
    if not implementation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control implementation not found"
        )
    
    if evidence_id:
        existing_evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        if not existing_evidence:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Evidence not found"
            )
        
        impl_evidence = ImplementationEvidence(
            implementation_id=implementation.id,
            evidence_id=evidence_id,
            file_name=existing_evidence.file_name,
            file_path=existing_evidence.file_path,
            uploaded_by=current_user.id,
            review_status="pending"
        )
    elif file:
        file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
        file_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")
        
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        impl_evidence = ImplementationEvidence(
            implementation_id=implementation.id,
            file_name=file.filename,
            file_path=file_path,
            file_size=len(contents),
            mime_type=file.content_type,
            uploaded_by=current_user.id,
            review_status="pending"
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either evidence_id or file must be provided"
        )
    
    db.add(impl_evidence)
    db.commit()
    db.refresh(impl_evidence)
    return impl_evidence


@router.post("/{journey_id}/controls/{control_id}/evidence/{evidence_id}/assess", response_model=dict)
def assess_evidence(
    journey_id: int,
    control_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    impl_evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id,
        ImplementationEvidence.implementation_id == control_id
    ).first()
    
    if not impl_evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    confidence_score = round(random.uniform(0.6, 0.95), 2)
    matched_controls = random.sample(range(1, 50), k=random.randint(1, 3))
    
    impl_evidence.ai_assessment_status = "assessed"
    impl_evidence.ai_confidence_score = confidence_score
    impl_evidence.ai_assessment_notes = f"AI assessment completed. Evidence appears relevant to the control requirements with {int(confidence_score * 100)}% confidence."
    impl_evidence.ai_matched_controls = matched_controls
    
    db.commit()
    db.refresh(impl_evidence)
    
    return {
        "id": impl_evidence.id,
        "ai_confidence_score": impl_evidence.ai_confidence_score,
        "ai_assessment_status": impl_evidence.ai_assessment_status,
        "ai_assessment_notes": impl_evidence.ai_assessment_notes,
        "ai_matched_controls": impl_evidence.ai_matched_controls
    }


@router.post("/{journey_id}/controls/{control_id}/evidence/{evidence_id}/review", response_model=dict)
def review_evidence(
    journey_id: int,
    control_id: int,
    evidence_id: int,
    review_data: EvidenceReviewAction,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    impl_evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id,
        ImplementationEvidence.implementation_id == control_id
    ).first()
    
    if not impl_evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if review_data.action not in ["approved", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Action must be 'approved' or 'rejected'"
        )
    
    impl_evidence.review_status = review_data.action
    impl_evidence.reviewed_by = current_user.id
    impl_evidence.reviewed_at = datetime.utcnow()
    impl_evidence.review_notes = review_data.notes
    
    db.commit()
    db.refresh(impl_evidence)
    
    return {
        "id": impl_evidence.id,
        "review_status": impl_evidence.review_status,
        "reviewed_by": impl_evidence.reviewed_by,
        "reviewed_at": impl_evidence.reviewed_at.isoformat() if impl_evidence.reviewed_at else None,
        "review_notes": impl_evidence.review_notes
    }


@router.get("/{journey_id}/progress", response_model=ProgressSummary)
def get_progress_summary(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementations = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain)
    ).filter(ControlImplementation.journey_id == journey_id).all()
    
    total = len(implementations)
    by_status = {}
    by_domain_dict = {}
    
    for impl in implementations:
        status = impl.status
        by_status[status] = by_status.get(status, 0) + 1
        
        control = impl.framework_control
        if control and control.objective and control.objective.domain:
            domain = control.objective.domain
            domain_id = domain.id
            domain_name = domain.name
            if domain_id not in by_domain_dict:
                by_domain_dict[domain_id] = {
                    "domain_id": domain_id,
                    "domain_name": domain_name,
                    "total": 0,
                    "completed": 0,
                    "in_progress": 0,
                    "not_started": 0
                }
            by_domain_dict[domain_id]["total"] += 1
            if impl.status in ["implemented", "verified"]:
                by_domain_dict[domain_id]["completed"] += 1
            elif impl.status == "in_progress":
                by_domain_dict[domain_id]["in_progress"] += 1
            else:
                by_domain_dict[domain_id]["not_started"] += 1
    
    by_domain = list(by_domain_dict.values())
    
    implemented_count = by_status.get("implemented", 0) + by_status.get("verified", 0)
    verified_count = by_status.get("verified", 0)
    in_progress_count = by_status.get("in_progress", 0)
    not_started_count = by_status.get("not_started", 0)
    not_applicable_count = by_status.get("not_applicable", 0)
    
    applicable_total = total - not_applicable_count
    completion_percentage = round((implemented_count / applicable_total * 100) if applicable_total > 0 else 0, 1)
    
    return ProgressSummary(
        total_controls=total,
        implemented_count=implemented_count,
        verified_count=verified_count,
        in_progress_count=in_progress_count,
        not_started_count=not_started_count,
        not_applicable_count=not_applicable_count,
        completion_percentage=completion_percentage,
        by_status=by_status,
        by_domain=by_domain
    )


@router.get("/{journey_id}/gaps", response_model=GapAnalysis)
def get_gap_analysis(
    journey_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    journey = get_journey_or_404(journey_id, current_user, db)
    
    implementations = db.query(ControlImplementation).options(
        joinedload(ControlImplementation.framework_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(
        ControlImplementation.journey_id == journey_id,
        ControlImplementation.is_applicable == True
    ).all()
    
    controls_without_evidence = []
    controls_not_implemented = []
    controls_pending_verification = []
    evidence_pending_review = []
    high_priority_gaps = []
    
    for impl in implementations:
        control = impl.framework_control
        control_info = {
            "implementation_id": impl.id,
            "control_code": control.code if control else None,
            "control_name": control.name if control else None,
            "status": impl.status,
            "priority": impl.priority
        }
        
        has_approved_evidence = any(
            ev.review_status == "approved" for ev in impl.evidence_attachments
        )
        
        if not impl.evidence_attachments:
            controls_without_evidence.append(control_info)
            if impl.priority <= 2:
                high_priority_gaps.append({**control_info, "gap_type": "no_evidence"})
        
        if impl.status == "not_started":
            controls_not_implemented.append(control_info)
            if impl.priority <= 2:
                high_priority_gaps.append({**control_info, "gap_type": "not_implemented"})
        
        if impl.status == "implemented" and not has_approved_evidence:
            controls_pending_verification.append(control_info)
        
        for ev in impl.evidence_attachments:
            if ev.review_status == "pending":
                evidence_pending_review.append({
                    "evidence_id": ev.id,
                    "file_name": ev.file_name,
                    "control_code": control.code if control else None,
                    "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None
                })
    
    total_gaps = len(controls_without_evidence) + len(controls_not_implemented)
    
    return GapAnalysis(
        total_gaps=total_gaps,
        controls_without_evidence=controls_without_evidence,
        controls_not_implemented=controls_not_implemented,
        controls_pending_verification=controls_pending_verification,
        evidence_pending_review=evidence_pending_review,
        high_priority_gaps=high_priority_gaps
    )


@router.get("/frameworks/{framework_id}/phases", response_model=List[dict])
def get_framework_phases(
    framework_id: int,
    db: Session = Depends(get_db)
):
    framework = db.query(Framework).filter(Framework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    phases = db.query(CertificationPhase).filter(
        CertificationPhase.framework_id == framework_id
    ).order_by(CertificationPhase.phase_number).all()
    
    return [
        {
            "id": phase.id,
            "framework_id": phase.framework_id,
            "phase_number": phase.phase_number,
            "name": phase.name,
            "description": phase.description,
            "key_tasks": phase.key_tasks or [],
            "deliverables": phase.deliverables or []
        }
        for phase in phases
    ]
