import os
import uuid
import shutil
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    AssessmentEvidence, AssessmentItem, FrameworkAssessment,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/evidence", tags=["Framework Upload - Evidence"])

UPLOAD_DIR = "uploads/assessment_evidence"
VALID_EVIDENCE_TYPES = ["policy", "procedure", "configuration", "log", "report", "contract"]

os.makedirs(UPLOAD_DIR, exist_ok=True)


class EvidenceReview(BaseModel):
    review_status: str
    review_notes: Optional[str] = None


def serialize_evidence(evidence: AssessmentEvidence) -> dict:
    return {
        "id": evidence.id,
        "assessment_item_id": evidence.assessment_item_id,
        "evidence_type": evidence.evidence_type,
        "file_name": evidence.file_name,
        "file_path": evidence.file_path,
        "file_size": evidence.file_size,
        "mime_type": evidence.mime_type,
        "description": evidence.description,
        "collection_date": evidence.collection_date.isoformat() if evidence.collection_date else None,
        "review_status": evidence.review_status,
        "reviewed_by": evidence.reviewed_by,
        "reviewer_name": evidence.reviewer.display_name if evidence.reviewer else None,
        "reviewed_at": evidence.reviewed_at.isoformat() if evidence.reviewed_at else None,
        "review_notes": evidence.review_notes,
        "uploaded_by": evidence.uploaded_by,
        "uploader_name": evidence.uploader.display_name if evidence.uploader else None,
        "uploaded_at": evidence.uploaded_at.isoformat() if evidence.uploaded_at else None
    }


def get_item_with_access_check(item_id: int, user_tenants: List[int], db: Session) -> AssessmentItem:
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
    
    return item


def get_evidence_with_access_check(evidence_id: int, user_tenants: List[int], db: Session) -> AssessmentEvidence:
    evidence = db.query(AssessmentEvidence).options(
        joinedload(AssessmentEvidence.assessment_item).joinedload(AssessmentItem.assessment),
        joinedload(AssessmentEvidence.uploader),
        joinedload(AssessmentEvidence.reviewer)
    ).filter(AssessmentEvidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    if evidence.assessment_item.assessment.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this evidence"
        )
    
    return evidence


@router.get("/types")
def get_evidence_types(
    current_user: GRCUser = Depends(require_auth)
):
    return {
        "evidence_types": VALID_EVIDENCE_TYPES
    }


@router.post("/item/{item_id}", status_code=status.HTTP_201_CREATED)
async def upload_evidence(
    item_id: int,
    file: UploadFile = File(...),
    evidence_type: str = Form(...),
    description: Optional[str] = Form(None),
    collection_date: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    item = get_item_with_access_check(item_id, user_tenants, db)
    
    if evidence_type not in VALID_EVIDENCE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid evidence type. Valid types: {', '.join(VALID_EVIDENCE_TYPES)}"
        )
    
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)
    
    try:
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        file_size = len(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save file: {str(e)}"
        )
    
    parsed_collection_date = None
    if collection_date:
        try:
            parsed_collection_date = datetime.fromisoformat(collection_date.replace('Z', '+00:00'))
        except ValueError:
            try:
                parsed_collection_date = datetime.strptime(collection_date, "%Y-%m-%d")
            except ValueError:
                pass
    
    evidence = AssessmentEvidence(
        assessment_item_id=item_id,
        evidence_type=evidence_type,
        file_name=file.filename,
        file_path=file_path,
        file_size=file_size,
        mime_type=file.content_type,
        description=description,
        collection_date=parsed_collection_date,
        review_status="pending",
        uploaded_by=current_user.id
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    
    evidence = db.query(AssessmentEvidence).options(
        joinedload(AssessmentEvidence.uploader),
        joinedload(AssessmentEvidence.reviewer)
    ).filter(AssessmentEvidence.id == evidence.id).first()
    
    return serialize_evidence(evidence)


@router.get("/item/{item_id}")
def list_item_evidence(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    item = get_item_with_access_check(item_id, user_tenants, db)
    
    evidence_list = db.query(AssessmentEvidence).options(
        joinedload(AssessmentEvidence.uploader),
        joinedload(AssessmentEvidence.reviewer)
    ).filter(
        AssessmentEvidence.assessment_item_id == item_id
    ).order_by(AssessmentEvidence.uploaded_at.desc()).all()
    
    return {
        "assessment_item_id": item_id,
        "items": [serialize_evidence(e) for e in evidence_list],
        "total": len(evidence_list)
    }


@router.get("/assessment/{assessment_id}")
def list_assessment_evidence(
    assessment_id: int,
    evidence_type: Optional[str] = None,
    review_status: Optional[str] = None,
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
    
    item_ids = [item.id for item in items]
    
    query = db.query(AssessmentEvidence).options(
        joinedload(AssessmentEvidence.uploader),
        joinedload(AssessmentEvidence.reviewer),
        joinedload(AssessmentEvidence.assessment_item)
    ).filter(AssessmentEvidence.assessment_item_id.in_(item_ids))
    
    if evidence_type:
        if evidence_type not in VALID_EVIDENCE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid evidence type. Valid types: {', '.join(VALID_EVIDENCE_TYPES)}"
            )
        query = query.filter(AssessmentEvidence.evidence_type == evidence_type)
    
    if review_status:
        query = query.filter(AssessmentEvidence.review_status == review_status)
    
    evidence_list = query.order_by(AssessmentEvidence.uploaded_at.desc()).all()
    
    grouped_evidence = {}
    for e in evidence_list:
        item_id = e.assessment_item_id
        if item_id not in grouped_evidence:
            grouped_evidence[item_id] = {
                "assessment_item_id": item_id,
                "evidence": []
            }
        grouped_evidence[item_id]["evidence"].append(serialize_evidence(e))
    
    return {
        "assessment_id": assessment_id,
        "groups": list(grouped_evidence.values()),
        "total_items": len(grouped_evidence),
        "total_evidence": len(evidence_list)
    }


@router.get("/{evidence_id}")
def get_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    evidence = get_evidence_with_access_check(evidence_id, user_tenants, db)
    return serialize_evidence(evidence)


@router.delete("/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    evidence = get_evidence_with_access_check(evidence_id, user_tenants, db)
    
    file_path = evidence.file_path
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass
    
    db.delete(evidence)
    db.commit()
    
    return None


@router.put("/{evidence_id}/review")
def review_evidence(
    evidence_id: int,
    review_data: EvidenceReview,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    evidence = get_evidence_with_access_check(evidence_id, user_tenants, db)
    
    if review_data.review_status not in ["pending", "accepted", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid review status. Valid values: pending, accepted, rejected"
        )
    
    evidence.review_status = review_data.review_status
    evidence.review_notes = review_data.review_notes
    evidence.reviewed_by = current_user.id
    evidence.reviewed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(evidence)
    
    evidence = db.query(AssessmentEvidence).options(
        joinedload(AssessmentEvidence.uploader),
        joinedload(AssessmentEvidence.reviewer)
    ).filter(AssessmentEvidence.id == evidence.id).first()
    
    return serialize_evidence(evidence)
