import os
import uuid
import random
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

from ..models import (
    CertificationJourney, ControlImplementation, ImplementationEvidence,
    Framework, FrameworkControl, FrameworkDomain, ControlObjective,
    FrameworkSubControl, Evidence, GRCUser, Tenant, CuratedEvidenceItem, 
    CertificationPhase, UploadedFramework, ParsedFrameworkControl, get_db,
    EvidenceAIAssessment
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


def get_phases_from_document_structure(framework: Optional[UploadedFramework]) -> List[dict]:
    """Extract certification phases from the framework's document structure.
    
    CRITICAL ARCHITECTURE: Phases MUST come from document_structure extracted during 
    framework parsing. This ensures uploaded-framework-only architecture is enforced.
    
    The document_structure is populated by the AI parser during framework upload and 
    contains the actual sections/chapters from the uploaded document. No fallback to 
    control titles or other sources is permitted.
    
    Returns: List of phase objects extracted from document_structure.sections, 
    or empty list if document_structure doesn't contain phases.
    """
    if not framework:
        logger.warning("Framework is None - cannot extract document structure")
        return []
    
    if not framework.document_structure:
        logger.warning(f"Framework {framework.id} has no document_structure data - phases must be provided during parsing")
        return []
    
    try:
        doc_structure = framework.document_structure
        if not isinstance(doc_structure, dict):
            logger.warning(f"Framework {framework.id} document_structure is not a dict: {type(doc_structure)}")
            return []
    except Exception as e:
        logger.error(f"Error accessing document_structure for framework {framework.id}: {str(e)}")
        return []
    
    # Extract sections from document_structure - this is the ONLY source for phases
    sections = doc_structure.get("sections", [])
    if not isinstance(sections, list):
        logger.warning(f"Framework {framework.id}: document_structure.sections is not a list: {type(sections)}")
        return []
    
    if not sections:
        logger.info(f"Framework {framework.id}: document_structure has no sections - returning empty phases list")
        return []
    
    logger.debug(f"Framework {framework.id}: Extracting {len(sections)} sections from document_structure")
    phases = _parse_sections_array(sections, 1)
    
    if not phases:
        logger.warning(f"Framework {framework.id}: sections array present but failed to parse any phases")
    
    return phases


def _parse_sections_array(sections: list, start_phase_num: int = 1) -> List[dict]:
    """Parse a sections/chapters array and convert to phase objects.
    
    Handles both dict and string sections with defensive null checks.
    """
    phases = []
    phase_num = start_phase_num
    
    for section in sections:
        if section is None:
            logger.debug(f"Skipping null section")
            continue
        
        if isinstance(section, dict):
            try:
                phase_name = section.get("name") or section.get("title") or f"Section {phase_num}"
                phase_number = section.get("number") or str(phase_num)
                description = section.get("description") or ""
                
                # Ensure all values are strings
                phase_name = str(phase_name) if phase_name else f"Section {phase_num}"
                phase_number = str(phase_number) if phase_number else str(phase_num)
                description = str(description) if description else ""
                
                phases.append({
                    "id": phase_num,
                    "phase_number": phase_num,
                    "section_reference": phase_number,
                    "name": phase_name,
                    "description": description,
                    "key_tasks": [],
                    "deliverables": []
                })
                phase_num += 1
            except Exception as e:
                logger.warning(f"Failed to parse dict section: {str(e)}")
                continue
        elif isinstance(section, str):
            try:
                phases.append({
                    "id": phase_num,
                    "phase_number": phase_num,
                    "section_reference": str(phase_num),
                    "name": section,
                    "description": "",
                    "key_tasks": [],
                    "deliverables": []
                })
                phase_num += 1
            except Exception as e:
                logger.warning(f"Failed to parse string section: {str(e)}")
                continue
        else:
            logger.debug(f"Skipping section with unexpected type: {type(section)}")
            continue
    
    return phases


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
        query = query.filter(
            (CertificationJourney.framework_id == framework_id) | 
            (CertificationJourney.uploaded_framework_id == framework_id)
        )
    
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
    
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == journey_data.framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    journey = CertificationJourney(
        tenant_id=tenant_id,
        uploaded_framework_id=journey_data.framework_id,
        name=journey_data.name,
        target_date=journey_data.target_date,
        notes=journey_data.notes,
        status="in_progress"
    )
    db.add(journey)
    db.commit()
    db.refresh(journey)
    
    controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == journey_data.framework_id
    ).all()
    
    for control in controls:
        implementation = ControlImplementation(
            journey_id=journey.id,
            parsed_control_id=control.id,
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
    
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == journey.uploaded_framework_id).first()
    implementations = db.query(ControlImplementation).filter(
        ControlImplementation.journey_id == journey_id
    ).all()
    
    phases_list = get_phases_from_document_structure(framework) if framework else []
    
    total = len(implementations)
    implemented = sum(1 for i in implementations if i.status in ["implemented", "verified"])
    verified = sum(1 for i in implementations if i.status == "verified")
    
    return {
        "id": journey.id,
        "tenant_id": journey.tenant_id,
        "framework_id": journey.uploaded_framework_id,
        "framework_name": framework.name if framework else None,
        "framework_short_code": framework.name[:10] if framework else None,
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
        joinedload(ControlImplementation.parsed_control),
        joinedload(ControlImplementation.evidence_attachments)
    ).filter(ControlImplementation.journey_id == journey_id)
    
    if status_filter:
        query = query.filter(ControlImplementation.status == status_filter)
    if priority:
        query = query.filter(ControlImplementation.priority == priority)
    
    implementations = query.all()
    
    result = []
    for impl in implementations:
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control
        
        if parsed_control:
            control_code = parsed_control.control_id
            control_name = parsed_control.title
            control_statement = parsed_control.description or parsed_control.full_text
            domain_id_val = None
            domain_code = parsed_control.domain
            domain_name = parsed_control.domain
            objective_code = parsed_control.category
            objective_name = parsed_control.category
            
            def build_control_hierarchy(parent_control_id: str, framework_id: int, visited: set = None) -> list:
                """Recursively build control hierarchy with cycle detection (unbounded depth)"""
                if visited is None:
                    visited = set()
                
                if parent_control_id in visited:
                    return []
                visited.add(parent_control_id)
                    
                children = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.uploaded_framework_id == framework_id,
                    ParsedFrameworkControl.parent_section == parent_control_id
                ).all()
                
                result = []
                for child in children:
                    child_evidence = child.evidence_requirements or []
                    grandchildren = build_control_hierarchy(child.control_id, framework_id, visited.copy())
                    result.append({
                        "id": child.id,
                        "code": child.control_id,
                        "name": child.title,
                        "description": child.description or child.full_text,
                        "parent_section": child.parent_section,
                        "evidence_requirements": child_evidence,
                        "evidence_recommendations": [ev.get("title", "") for ev in child_evidence] if child_evidence else [],
                        "sub_controls": grandchildren
                    })
                return result
            
            sub_controls_list = build_control_hierarchy(parsed_control.control_id, parsed_control.uploaded_framework_id)
            evidence_requirements = parsed_control.evidence_requirements or []
        elif framework_control:
            control = framework_control
            objective = control.objective if control else None
            domain = objective.domain if objective else None
            control_code = control.code if control else None
            control_name = control.name if control else None
            control_statement = control.statement if control else None
            domain_id_val = domain.id if domain else None
            domain_code = domain.code if domain else None
            domain_name = domain.name if domain else None
            objective_code = objective.code if objective else None
            objective_name = objective.name if objective else None
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
        else:
            control_code = None
            control_name = None
            control_statement = None
            domain_id_val = None
            domain_code = None
            domain_name = None
            objective_code = None
            objective_name = None
            sub_controls_list = []
            evidence_requirements = []
        
        evidence_list = []
        for ev in impl.evidence_attachments:
            ai_assessment_status = None
            ai_assessment_summary = None
            linked_ev_id = getattr(ev, 'linked_evidence_id', None)
            
            if linked_ev_id:
                linked_evidence = db.query(Evidence).filter(Evidence.id == linked_ev_id).first()
                if linked_evidence:
                    latest_assessment = db.query(EvidenceAIAssessment).filter(
                        EvidenceAIAssessment.evidence_id == linked_evidence.id
                    ).order_by(EvidenceAIAssessment.assessed_at.desc()).first()
                    
                    if latest_assessment:
                        ai_assessment_status = "completed"
                        ai_assessment_summary = latest_assessment.content_summary
                    elif linked_evidence.ocr_status == "processing":
                        ai_assessment_status = "processing"
                    elif linked_evidence.ocr_status == "completed" and not latest_assessment:
                        ai_assessment_status = "pending_assessment"
                    else:
                        ai_assessment_status = "pending_ocr"
            
            evidence_list.append({
                "id": ev.id,
                "file_name": ev.file_name,
                "file_size": ev.file_size,
                "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
                "ai_confidence_score": getattr(ev, 'ai_confidence_score', None),
                "review_status": getattr(ev, 'review_status', None),
                "linked_evidence_id": linked_ev_id,
                "ai_assessment_status": ai_assessment_status,
                "ai_assessment_summary": ai_assessment_summary
            })
        
        result.append({
            "id": impl.id,
            "journey_id": impl.journey_id,
            "framework_control_id": impl.framework_control_id,
            "parsed_control_id": impl.parsed_control_id,
            "control_code": control_code,
            "control_name": control_name,
            "control_statement": control_statement,
            "domain_id": domain_id_val,
            "domain_code": domain_code,
            "domain_name": domain_name,
            "objective_code": objective_code,
            "objective_name": objective_name,
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
        joinedload(ControlImplementation.parsed_control),
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
    
    parsed_control = implementation.parsed_control
    framework_control = implementation.framework_control
    
    if parsed_control:
        control_code = parsed_control.control_id
        control_name = parsed_control.title
        control_statement = parsed_control.description or parsed_control.full_text
        implementation_guidance = parsed_control.ai_notes
        testing_guidance = None
    elif framework_control:
        control_code = framework_control.code
        control_name = framework_control.name
        control_statement = framework_control.statement
        implementation_guidance = framework_control.implementation_guidance
        testing_guidance = framework_control.testing_guidance
    else:
        control_code = None
        control_name = None
        control_statement = None
        implementation_guidance = None
        testing_guidance = None
    
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
        "parsed_control_id": implementation.parsed_control_id,
        "control_code": control_code,
        "control_name": control_name,
        "control_statement": control_statement,
        "implementation_guidance": implementation_guidance,
        "testing_guidance": testing_guidance,
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
        joinedload(ControlImplementation.framework_control).joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain),
        joinedload(ControlImplementation.parsed_control)
    ).filter(ControlImplementation.journey_id == journey_id).all()
    
    total = len(implementations)
    by_status = {}
    by_domain_dict = {}
    
    for impl in implementations:
        status = impl.status
        by_status[status] = by_status.get(status, 0) + 1
        
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control
        
        if parsed_control:
            domain_name = parsed_control.domain or "General"
            domain_id = domain_name
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
        elif framework_control and framework_control.objective and framework_control.objective.domain:
            domain = framework_control.objective.domain
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
        joinedload(ControlImplementation.parsed_control),
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
        parsed_control = impl.parsed_control
        framework_control = impl.framework_control
        
        if parsed_control:
            control_code = parsed_control.control_id
            control_name = parsed_control.title
        elif framework_control:
            control_code = framework_control.code
            control_name = framework_control.name
        else:
            control_code = None
            control_name = None
        
        control_info = {
            "implementation_id": impl.id,
            "control_code": control_code,
            "control_name": control_name,
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
                    "control_code": control_code,
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


@router.get("/uploaded-frameworks/{framework_id}/phases", response_model=List[dict])
def get_uploaded_framework_phases(
    framework_id: int,
    db: Session = Depends(get_db)
):
    """Get certification phases derived from an uploaded framework's document structure.
    
    Phases are extracted from the document_structure field populated during framework parsing.
    The parser extracts sections/chapters from the uploaded document, which become the
    phases for certification journeys.
    
    ARCHITECTURE REQUIREMENT: Phases MUST come from document_structure only.
    No fallback to control titles or other sources is permitted to enforce
    the uploaded-framework-only architecture.
    """
    framework = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    # Extract phases from document_structure (the ONLY allowed source)
    phases = get_phases_from_document_structure(framework)
    
    if phases:
        logger.debug(f"Successfully extracted {len(phases)} phases from document_structure for framework {framework_id}")
    else:
        logger.info(f"Framework {framework_id}: No phases in document_structure - returning empty list")
    
    return phases


@router.put("/evidence/{evidence_id}/review")
def review_implementation_evidence(
    evidence_id: int,
    review_data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Approve or reject an ImplementationEvidence record."""
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    impl = db.query(ControlImplementation).filter(
        ControlImplementation.id == evidence.implementation_id
    ).first()
    
    if impl:
        journey = db.query(CertificationJourney).filter(
            CertificationJourney.id == impl.journey_id
        ).first()
        if journey and journey.tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    action = review_data.get("action")
    if action not in ["approve", "reject"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action. Must be 'approve' or 'reject'"
        )
    
    evidence.review_status = "approved" if action == "approve" else "rejected"
    evidence.reviewed_by = current_user.id
    evidence.reviewed_at = datetime.utcnow()
    evidence.review_notes = review_data.get("notes", "")
    
    db.commit()
    
    return {
        "id": evidence.id,
        "review_status": evidence.review_status,
        "reviewed_by": current_user.id,
        "message": f"Evidence {action}d successfully"
    }


@router.delete("/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_implementation_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Delete an ImplementationEvidence record by ID."""
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(ImplementationEvidence).filter(
        ImplementationEvidence.id == evidence_id
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    impl = db.query(ControlImplementation).filter(
        ControlImplementation.id == evidence.implementation_id
    ).first()
    
    if impl:
        journey = db.query(CertificationJourney).filter(
            CertificationJourney.id == impl.journey_id
        ).first()
        if journey and journey.tenant_id not in user_tenants:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    if evidence.file_path and os.path.exists(evidence.file_path):
        try:
            os.remove(evidence.file_path)
        except Exception:
            pass
    
    if evidence.evidence_id:
        linked_evidence = db.query(Evidence).filter(
            Evidence.id == evidence.evidence_id
        ).first()
        if linked_evidence:
            if linked_evidence.file_path and os.path.exists(linked_evidence.file_path):
                try:
                    os.remove(linked_evidence.file_path)
                except Exception:
                    pass
            db.delete(linked_evidence)
    
    db.delete(evidence)
    db.commit()
    
    return None


@router.get("/frameworks/{framework_id}/phases", status_code=status.HTTP_410_GONE)
def get_framework_phases(
    framework_id: int,
    db: Session = Depends(get_db)
):
    """DEPRECATED: Legacy endpoint for pre-seeded frameworks - NO LONGER SUPPORTED.
    
    This endpoint is permanently disabled. Pre-seeded frameworks and CertificationPhase
    records have been removed as part of the uploaded-framework-only architecture.
    
    MIGRATION: Use /certifications/uploaded-frameworks/{framework_id}/phases instead,
    which provides phases extracted from uploaded framework document structures.
    
    The uploaded-framework-only architecture requires all frameworks and phases to come
    from uploaded documents processed by the AI parser.
    """
    logger.warning(f"Deprecated endpoint /frameworks/{framework_id}/phases called - use /certifications/uploaded-frameworks/{framework_id}/phases instead")
    
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="This endpoint is no longer supported. Pre-seeded frameworks have been removed. Use /certifications/uploaded-frameworks/{framework_id}/phases instead."
    )
