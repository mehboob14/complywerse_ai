import os
import uuid
import random
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload

from ..models import (
    Evidence, EvidenceVersion, EvidenceControlMapping, EvidenceAIAssessment,
    NormalizedControl, GRCUser, Tenant, get_db,
    ParsedFrameworkControl, ControlImplementation, ImplementationEvidence, CertificationJourney
)
from ..schemas import (
    EvidenceCreate, EvidenceUpdate, EvidenceResponse,
    EvidenceVersionCreate, EvidenceVersionResponse,
    EvidenceControlMappingCreate, EvidenceControlMappingResponse,
    AIAssessmentResponse, EvidenceReview, MessageResponse
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/evidence", tags=["Evidence"])

UPLOAD_DIR = "backend/uploads/evidence"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("", response_model=List[EvidenceResponse])
def list_evidence(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    file_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Evidence).filter(Evidence.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Evidence.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(Evidence.status == status_filter)
    if file_type:
        query = query.filter(Evidence.file_type == file_type)
    
    evidence_list = query.order_by(Evidence.uploaded_at.desc()).offset(skip).limit(limit).all()
    return evidence_list


@router.post("", response_model=EvidenceResponse, status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    name: str = Form(...),
    description: Optional[str] = Form(None),
    tenant_id: Optional[int] = Form(None),
    evidence_type: Optional[str] = Form(None),
    collection_date: Optional[str] = Form(None),
    validity_period_days: Optional[int] = Form(None),
    source_system: Optional[str] = Form(None),
    owner_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
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

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )

    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    # Optional metadata: parse the date string and compute expiry from validity.
    parsed_collection_date = None
    if collection_date:
        try:
            parsed_collection_date = datetime.fromisoformat(collection_date.replace("Z", "+00:00"))
        except ValueError:
            parsed_collection_date = None

    expiry_date = None
    if parsed_collection_date and validity_period_days and validity_period_days > 0:
        from datetime import timedelta
        expiry_date = parsed_collection_date + timedelta(days=validity_period_days)

    db_evidence = Evidence(
        tenant_id=tenant_id,
        name=name,
        description=description,
        file_path=file_path,
        file_name=file.filename,
        file_type=file.content_type,
        uploaded_by=current_user.id,
        status="draft",
        evidence_type=evidence_type or None,
        collection_date=parsed_collection_date,
        validity_period_days=validity_period_days,
        expiry_date=expiry_date,
        source_system=source_system or None,
    )
    # owner_id lives on the Evidence model only when the schema has been
    # migrated to add the column. Set conditionally so older deployments
    # that haven't run the ALTER yet don't blow up.
    if hasattr(Evidence, "owner_id") and owner_id:
        try:
            setattr(db_evidence, "owner_id", owner_id)
        except Exception:
            pass

    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)
    return db_evidence


@router.get("/pending-review", response_model=List[EvidenceResponse])
def list_pending_review(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Evidence).filter(
        Evidence.status == "pending_review",
        Evidence.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Evidence.tenant_id == tenant_id)
    
    evidence_list = query.order_by(Evidence.uploaded_at.desc()).all()
    return evidence_list


@router.get("/{evidence_id}", response_model=dict)
def get_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).options(
        joinedload(Evidence.ai_assessments),
        joinedload(Evidence.control_mappings)
    ).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    latest_assessment = None
    if evidence.ai_assessments:
        latest = sorted(evidence.ai_assessments, key=lambda x: x.assessed_at, reverse=True)[0]
        latest_assessment = {
            "id": latest.id,
            "relevance_score": latest.relevance_score,
            "adequacy_score": latest.adequacy_score,
            "confidence_score": latest.confidence_score,
            "gap_analysis": latest.gap_analysis,
            "audit_readiness": latest.audit_readiness,
            "assessed_at": latest.assessed_at.isoformat()
        }
    
    return {
        "id": evidence.id,
        "tenant_id": evidence.tenant_id,
        "name": evidence.name,
        "description": evidence.description,
        "file_path": evidence.file_path,
        "file_name": evidence.file_name,
        "file_type": evidence.file_type,
        "version": evidence.version,
        "uploaded_by": evidence.uploaded_by,
        "uploaded_at": evidence.uploaded_at.isoformat(),
        "status": evidence.status,
        "latest_assessment": latest_assessment,
        "control_mappings": [
            {
                "id": m.id,
                "normalized_control_id": m.normalized_control_id,
                "framework_control_id": m.framework_control_id
            }
            for m in evidence.control_mappings
        ]
    }


@router.put("/{evidence_id}", response_model=EvidenceResponse)
def update_evidence(
    evidence_id: int,
    evidence_update: EvidenceUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    update_data = evidence_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(evidence, field, value)
    
    db.commit()
    db.refresh(evidence)
    return evidence


@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if evidence.file_path and os.path.exists(evidence.file_path):
        os.remove(evidence.file_path)
    
    db.delete(evidence)
    db.commit()
    return None


@router.get("/{evidence_id}/versions", response_model=List[EvidenceVersionResponse])
def get_evidence_versions(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    versions = db.query(EvidenceVersion).filter(
        EvidenceVersion.evidence_id == evidence_id
    ).order_by(EvidenceVersion.version_number.desc()).all()
    return versions


@router.post("/{evidence_id}/versions", response_model=EvidenceVersionResponse, status_code=status.HTTP_201_CREATED)
async def create_evidence_version(
    evidence_id: int,
    changes: Optional[str] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{file_ext}")
    
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)
    
    new_version_number = evidence.version + 1
    
    db_version = EvidenceVersion(
        evidence_id=evidence_id,
        version_number=new_version_number,
        file_path=file_path,
        changes=changes,
        created_by=current_user.id
    )
    db.add(db_version)
    
    evidence.version = new_version_number
    evidence.file_path = file_path
    evidence.file_name = file.filename
    evidence.file_type = file.content_type
    
    db.commit()
    db.refresh(db_version)
    return db_version


@router.post("/{evidence_id}/assess", response_model=AIAssessmentResponse)
def trigger_ai_assessment(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    assessment = EvidenceAIAssessment(
        evidence_id=evidence_id,
        relevance_score=round(random.uniform(0.6, 1.0), 2),
        adequacy_score=round(random.uniform(0.5, 1.0), 2),
        confidence_score=round(random.uniform(0.7, 0.95), 2),
        gap_analysis={
            "gaps_identified": random.randint(0, 3),
            "recommendations": [
                "Consider adding more detailed documentation",
                "Include timestamps for all entries",
                "Add approval signatures"
            ][:random.randint(1, 3)]
        },
        audit_readiness=round(random.uniform(0.6, 0.95), 2)
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


@router.get("/{evidence_id}/assessment", response_model=AIAssessmentResponse)
def get_latest_assessment(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    assessment = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(EvidenceAIAssessment.assessed_at.desc()).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessment found for this evidence"
        )
    
    return assessment


@router.post("/{evidence_id}/controls", response_model=EvidenceControlMappingResponse, status_code=status.HTTP_201_CREATED)
def map_evidence_to_control(
    evidence_id: int,
    mapping: EvidenceControlMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if mapping.normalized_control_id:
        control = db.query(NormalizedControl).filter(
            NormalizedControl.id == mapping.normalized_control_id
        ).first()
        if not control:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Normalized control not found"
            )

    parsed_control = None
    if mapping.parsed_control_id:
        parsed_control = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.id == mapping.parsed_control_id
        ).first()
        if not parsed_control:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parsed control not found"
            )

    db_mapping = EvidenceControlMapping(
        evidence_id=evidence_id,
        normalized_control_id=mapping.normalized_control_id,
        framework_control_id=mapping.framework_control_id,
        parsed_control_id=mapping.parsed_control_id,
        uploaded_framework_id=mapping.uploaded_framework_id or (parsed_control.uploaded_framework_id if parsed_control else None),
    )
    db.add(db_mapping)

    # Auto-link to existing control implementations for auditor visibility
    impl_query = db.query(ControlImplementation).join(CertificationJourney).filter(
        CertificationJourney.tenant_id.in_(user_tenants)
    )
    if mapping.parsed_control_id:
        impl_query = impl_query.filter(ControlImplementation.parsed_control_id == mapping.parsed_control_id)
    elif mapping.framework_control_id:
        impl_query = impl_query.filter(ControlImplementation.framework_control_id == mapping.framework_control_id)
    implementations = impl_query.all()

    for impl in implementations:
        exists_impl_ev = db.query(ImplementationEvidence).filter(
            ImplementationEvidence.implementation_id == impl.id,
            ImplementationEvidence.evidence_id == evidence_id
        ).first()
        if exists_impl_ev:
            continue
        impl_ev = ImplementationEvidence(
            implementation_id=impl.id,
            evidence_id=evidence_id,
            file_name=evidence.file_name or evidence.name,
            file_path=evidence.file_path,
            file_size=getattr(evidence, "file_size", None),
            mime_type=evidence.file_type,
            uploaded_by=current_user.id,
            review_status="pending"
        )
        db.add(impl_ev)

    db.commit()
    db.refresh(db_mapping)
    return db_mapping


@router.delete("/{evidence_id}/controls/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_control_mapping(
    evidence_id: int,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    mapping = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id,
        EvidenceControlMapping.normalized_control_id == control_id
    ).first()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    return None


@router.post("/{evidence_id}/review", response_model=MessageResponse)
def review_evidence(
    evidence_id: int,
    review: EvidenceReview,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if review.action == "approve":
        evidence.status = "approved"
    elif review.action == "reject":
        evidence.status = "rejected"
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid action. Use 'approve' or 'reject'"
        )
    
    db.commit()
    
    return MessageResponse(message=f"Evidence {review.action}d successfully")
