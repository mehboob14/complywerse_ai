from typing import List, Optional
from datetime import datetime
from difflib import SequenceMatcher
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    UploadedFramework, ParsedFrameworkControl, FrameworkControlAlignment,
    NormalizedControl, FrameworkControl, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/alignment", tags=["Framework Upload - Alignment"])


class AlignmentUpdate(BaseModel):
    alignment_type: Optional[str] = None
    normalized_control_id: Optional[int] = None
    framework_control_id: Optional[int] = None
    match_reason: Optional[str] = None


def validate_framework_access(user: GRCUser, framework: UploadedFramework, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if framework.tenant_id and framework.tenant_id not in user_tenants and not framework.is_shared:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this framework"
        )


def calculate_similarity(text1: str, text2: str) -> float:
    if not text1 or not text2:
        return 0.0
    text1_lower = text1.lower().strip()
    text2_lower = text2.lower().strip()
    return SequenceMatcher(None, text1_lower, text2_lower).ratio()


def get_alignment_type(score: float) -> str:
    if score >= 0.9:
        return "exact"
    elif score >= 0.5:
        return "partial"
    else:
        return "new"


def serialize_alignment(alignment: FrameworkControlAlignment) -> dict:
    parsed = alignment.parsed_control
    normalized = alignment.normalized_control
    framework = alignment.framework_control
    
    return {
        "id": alignment.id,
        "parsed_control_id": alignment.parsed_control_id,
        "normalized_control_id": alignment.normalized_control_id,
        "framework_control_id": alignment.framework_control_id,
        "alignment_type": alignment.alignment_type,
        "match_score": alignment.match_score,
        "match_reason": alignment.match_reason,
        "is_confirmed": alignment.is_confirmed,
        "confirmed_by": alignment.confirmed_by,
        "confirmed_at": alignment.confirmed_at.isoformat() if alignment.confirmed_at else None,
        "created_at": alignment.created_at.isoformat() if alignment.created_at else None,
        "parsed_control": {
            "id": parsed.id,
            "control_id": parsed.control_id,
            "original_reference": parsed.original_reference,
            "title": parsed.title,
            "description": parsed.description,
            "domain": parsed.domain,
            "category": parsed.category,
            "is_mandatory": parsed.is_mandatory,
            "priority": parsed.priority
        } if parsed else None,
        "normalized_control": {
            "id": normalized.id,
            "code": normalized.code,
            "name": normalized.name,
            "statement": normalized.statement,
            "objective": normalized.objective
        } if normalized else None,
        "framework_control": {
            "id": framework.id,
            "code": framework.code,
            "name": framework.name,
            "statement": framework.statement
        } if framework else None
    }


def find_best_match(parsed_control: ParsedFrameworkControl, normalized_controls: List[NormalizedControl], framework_controls: List[FrameworkControl]) -> dict:
    best_score = 0.0
    best_normalized = None
    best_framework = None
    best_reason = None
    
    parsed_text = f"{parsed_control.title or ''} {parsed_control.description or ''}"
    
    for nc in normalized_controls:
        nc_text = f"{nc.name or ''} {nc.statement or ''}"
        score = calculate_similarity(parsed_text, nc_text)
        if score > best_score:
            best_score = score
            best_normalized = nc
            best_reason = f"Matched normalized control '{nc.code}' by text similarity"
    
    for fc in framework_controls:
        fc_text = f"{fc.name or ''} {fc.statement or ''}"
        score = calculate_similarity(parsed_text, fc_text)
        if score > best_score:
            best_score = score
            best_framework = fc
            best_normalized = None
            best_reason = f"Matched framework control '{fc.code}' by text similarity"
    
    return {
        "score": best_score,
        "normalized_control": best_normalized,
        "framework_control": best_framework,
        "reason": best_reason
    }


@router.post("/{framework_id}/analyze")
def analyze_and_align_controls(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).all()
    
    if not parsed_controls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No parsed controls found for this framework. Please parse the framework first."
        )
    
    normalized_controls = db.query(NormalizedControl).all()
    framework_controls = db.query(FrameworkControl).all()
    
    db.query(FrameworkControlAlignment).filter(
        FrameworkControlAlignment.parsed_control_id.in_(
            [pc.id for pc in parsed_controls]
        )
    ).delete(synchronize_session=False)
    
    alignments_created = {
        "exact": 0,
        "partial": 0,
        "new": 0
    }
    created_alignments = []
    
    for parsed_control in parsed_controls:
        match_result = find_best_match(parsed_control, normalized_controls, framework_controls)
        alignment_type = get_alignment_type(match_result["score"])
        
        alignment = FrameworkControlAlignment(
            parsed_control_id=parsed_control.id,
            normalized_control_id=match_result["normalized_control"].id if match_result["normalized_control"] else None,
            framework_control_id=match_result["framework_control"].id if match_result["framework_control"] else None,
            alignment_type=alignment_type,
            match_score=match_result["score"],
            match_reason=match_result["reason"] if match_result["score"] > 0 else "No matching control found in library",
            is_confirmed=False
        )
        db.add(alignment)
        alignments_created[alignment_type] += 1
        created_alignments.append(alignment)
    
    db.commit()
    
    for alignment in created_alignments:
        db.refresh(alignment)
    
    total = len(parsed_controls)
    return {
        "message": f"Analyzed and aligned {total} controls",
        "framework_id": framework_id,
        "framework_name": framework.name,
        "summary": {
            "total_controls": total,
            "exact_matches": alignments_created["exact"],
            "partial_matches": alignments_created["partial"],
            "new_controls": alignments_created["new"],
            "exact_percentage": round((alignments_created["exact"] / total * 100), 2) if total > 0 else 0,
            "partial_percentage": round((alignments_created["partial"] / total * 100), 2) if total > 0 else 0,
            "new_percentage": round((alignments_created["new"] / total * 100), 2) if total > 0 else 0
        }
    }


@router.get("/{framework_id}")
def get_framework_alignments(
    framework_id: int,
    alignment_type: Optional[str] = None,
    is_confirmed: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    parsed_control_ids = db.query(ParsedFrameworkControl.id).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).subquery()
    
    query = db.query(FrameworkControlAlignment).options(
        joinedload(FrameworkControlAlignment.parsed_control),
        joinedload(FrameworkControlAlignment.normalized_control),
        joinedload(FrameworkControlAlignment.framework_control)
    ).filter(
        FrameworkControlAlignment.parsed_control_id.in_(parsed_control_ids)
    )
    
    if alignment_type:
        if alignment_type not in ["exact", "partial", "new"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="alignment_type must be one of: exact, partial, new"
            )
        query = query.filter(FrameworkControlAlignment.alignment_type == alignment_type)
    
    if is_confirmed is not None:
        query = query.filter(FrameworkControlAlignment.is_confirmed == is_confirmed)
    
    total = query.count()
    alignments = query.order_by(FrameworkControlAlignment.id).offset(skip).limit(limit).all()
    
    grouped = {
        "exact": [],
        "partial": [],
        "new": []
    }
    
    for alignment in alignments:
        serialized = serialize_alignment(alignment)
        grouped[alignment.alignment_type].append(serialized)
    
    return {
        "items": [serialize_alignment(a) for a in alignments],
        "grouped": grouped if not alignment_type else None,
        "total": total,
        "skip": skip,
        "limit": limit,
        "framework_id": framework_id,
        "framework_name": framework.name
    }


@router.get("/summary/{framework_id}")
def get_alignment_summary(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    parsed_control_ids = db.query(ParsedFrameworkControl.id).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).subquery()
    
    counts = db.query(
        FrameworkControlAlignment.alignment_type,
        func.count(FrameworkControlAlignment.id).label("count")
    ).filter(
        FrameworkControlAlignment.parsed_control_id.in_(parsed_control_ids)
    ).group_by(
        FrameworkControlAlignment.alignment_type
    ).all()
    
    counts_dict = {row.alignment_type: row.count for row in counts}
    exact_count = counts_dict.get("exact", 0)
    partial_count = counts_dict.get("partial", 0)
    new_count = counts_dict.get("new", 0)
    total = exact_count + partial_count + new_count
    
    confirmed_count = db.query(func.count(FrameworkControlAlignment.id)).filter(
        FrameworkControlAlignment.parsed_control_id.in_(parsed_control_ids),
        FrameworkControlAlignment.is_confirmed == True
    ).scalar() or 0
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "total_alignments": total,
        "exact_matches": exact_count,
        "partial_matches": partial_count,
        "new_controls": new_count,
        "confirmed_alignments": confirmed_count,
        "unconfirmed_alignments": total - confirmed_count,
        "percentages": {
            "exact": round((exact_count / total * 100), 2) if total > 0 else 0,
            "partial": round((partial_count / total * 100), 2) if total > 0 else 0,
            "new": round((new_count / total * 100), 2) if total > 0 else 0,
            "confirmed": round((confirmed_count / total * 100), 2) if total > 0 else 0
        }
    }


@router.put("/{alignment_id}")
def update_alignment(
    alignment_id: int,
    update_data: AlignmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    alignment = db.query(FrameworkControlAlignment).options(
        joinedload(FrameworkControlAlignment.parsed_control).joinedload(ParsedFrameworkControl.uploaded_framework),
        joinedload(FrameworkControlAlignment.normalized_control),
        joinedload(FrameworkControlAlignment.framework_control)
    ).filter(
        FrameworkControlAlignment.id == alignment_id
    ).first()
    
    if not alignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alignment not found"
        )
    
    validate_framework_access(current_user, alignment.parsed_control.uploaded_framework, db)
    
    if update_data.alignment_type is not None:
        if update_data.alignment_type not in ["exact", "partial", "new"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="alignment_type must be one of: exact, partial, new"
            )
        alignment.alignment_type = update_data.alignment_type
    
    if update_data.normalized_control_id is not None:
        if update_data.normalized_control_id > 0:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == update_data.normalized_control_id
            ).first()
            if not nc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Normalized control not found"
                )
            alignment.normalized_control_id = update_data.normalized_control_id
            alignment.framework_control_id = None
        else:
            alignment.normalized_control_id = None
    
    if update_data.framework_control_id is not None:
        if update_data.framework_control_id > 0:
            fc = db.query(FrameworkControl).filter(
                FrameworkControl.id == update_data.framework_control_id
            ).first()
            if not fc:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Framework control not found"
                )
            alignment.framework_control_id = update_data.framework_control_id
            alignment.normalized_control_id = None
        else:
            alignment.framework_control_id = None
    
    if update_data.match_reason is not None:
        alignment.match_reason = update_data.match_reason
    
    db.commit()
    db.refresh(alignment)
    
    return serialize_alignment(alignment)


@router.post("/{alignment_id}/confirm")
def confirm_alignment(
    alignment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    alignment = db.query(FrameworkControlAlignment).options(
        joinedload(FrameworkControlAlignment.parsed_control).joinedload(ParsedFrameworkControl.uploaded_framework),
        joinedload(FrameworkControlAlignment.normalized_control),
        joinedload(FrameworkControlAlignment.framework_control)
    ).filter(
        FrameworkControlAlignment.id == alignment_id
    ).first()
    
    if not alignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alignment not found"
        )
    
    validate_framework_access(current_user, alignment.parsed_control.uploaded_framework, db)
    
    alignment.is_confirmed = True
    alignment.confirmed_by = current_user.id
    alignment.confirmed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(alignment)
    
    return {
        "message": "Alignment confirmed successfully",
        "alignment": serialize_alignment(alignment)
    }


@router.post("/{framework_id}/create-new-controls")
def create_new_normalized_controls(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    parsed_control_ids = db.query(ParsedFrameworkControl.id).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).subquery()
    
    new_alignments = db.query(FrameworkControlAlignment).options(
        joinedload(FrameworkControlAlignment.parsed_control)
    ).filter(
        FrameworkControlAlignment.parsed_control_id.in_(parsed_control_ids),
        FrameworkControlAlignment.alignment_type == "new"
    ).all()
    
    if not new_alignments:
        return {
            "message": "No unmatched controls to create",
            "created_count": 0,
            "controls": []
        }
    
    max_code = db.query(func.max(NormalizedControl.code)).scalar()
    if max_code and max_code.startswith("NC-"):
        try:
            current_max = int(max_code.split("-")[1])
        except (IndexError, ValueError):
            current_max = 0
    else:
        current_max = 0
    
    created_controls = []
    for idx, alignment in enumerate(new_alignments, start=1):
        parsed = alignment.parsed_control
        new_code = f"NC-{current_max + idx:04d}"
        
        normalized_control = NormalizedControl(
            code=new_code,
            name=parsed.title[:255] if parsed.title else f"Control from {parsed.control_id}",
            statement=parsed.description,
            objective=parsed.full_text[:500] if parsed.full_text else None,
            implementation_guidance=f"Derived from uploaded framework: {framework.name}",
            maturity_level=0
        )
        db.add(normalized_control)
        db.flush()
        
        alignment.normalized_control_id = normalized_control.id
        alignment.alignment_type = "exact"
        alignment.match_score = 1.0
        alignment.match_reason = f"New normalized control created from parsed control {parsed.control_id}"
        
        created_controls.append({
            "id": normalized_control.id,
            "code": normalized_control.code,
            "name": normalized_control.name,
            "statement": normalized_control.statement,
            "source_control_id": parsed.control_id
        })
    
    db.commit()
    
    return {
        "message": f"Created {len(created_controls)} new normalized controls",
        "created_count": len(created_controls),
        "controls": created_controls
    }


alignment_router = router
