from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_

from ....models import (
    LikelihoodImpactScale, Tenant, GRCUser, get_db
)
from ....schemas import (
    LikelihoodImpactScaleCreate, LikelihoodImpactScaleUpdate, LikelihoodImpactScaleResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/scales", tags=["ERM - Scales"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("", response_model=List[LikelihoodImpactScaleResponse])
def list_scales(
    tenant_id: Optional[int] = None,
    scale_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = db.query(LikelihoodImpactScale).filter(
            LikelihoodImpactScale.tenant_id == tenant_id
        )
    else:
        query = db.query(LikelihoodImpactScale).filter(
            LikelihoodImpactScale.tenant_id.in_(user_tenants)
        )
    
    if scale_type:
        query = query.filter(LikelihoodImpactScale.scale_type == scale_type)
    
    scales = query.order_by(
        LikelihoodImpactScale.scale_type,
        LikelihoodImpactScale.level
    ).all()
    
    return scales


@router.post("", response_model=LikelihoodImpactScaleResponse, status_code=status.HTTP_201_CREATED)
def create_scale(
    scale: LikelihoodImpactScaleCreate,
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
    
    existing = db.query(LikelihoodImpactScale).filter(
        LikelihoodImpactScale.tenant_id == tenant_id,
        LikelihoodImpactScale.scale_type == scale.scale_type,
        LikelihoodImpactScale.level == scale.level
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Scale level {scale.level} for {scale.scale_type} already exists"
        )
    
    db_scale = LikelihoodImpactScale(
        tenant_id=tenant_id,
        scale_type=scale.scale_type,
        level=scale.level,
        label=scale.label,
        description=scale.description,
        score_value=scale.score_value,
        color=scale.color,
        is_default=scale.is_default
    )
    db.add(db_scale)
    db.commit()
    db.refresh(db_scale)
    return db_scale


@router.put("/{scale_id}", response_model=LikelihoodImpactScaleResponse)
def update_scale(
    scale_id: int,
    scale_update: LikelihoodImpactScaleUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scale not found"
        )
    
    scale = db.query(LikelihoodImpactScale).filter(
        LikelihoodImpactScale.id == scale_id,
        LikelihoodImpactScale.tenant_id.in_(user_tenants)
    ).first()
    
    if not scale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scale not found"
        )
    
    update_data = scale_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(scale, key, value)
    
    db.commit()
    db.refresh(scale)
    return scale


@router.delete("/{scale_id}", response_model=MessageResponse)
def delete_scale(
    scale_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scale not found"
        )
    
    scale = db.query(LikelihoodImpactScale).filter(
        LikelihoodImpactScale.id == scale_id,
        LikelihoodImpactScale.tenant_id.in_(user_tenants)
    ).first()
    
    if not scale:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Scale not found"
        )
    
    db.delete(scale)
    db.commit()
    return {"message": "Scale deleted successfully", "id": scale_id}


@router.post("/seed-defaults", response_model=MessageResponse)
def seed_default_scales(
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
    
    existing = db.query(LikelihoodImpactScale).filter(
        LikelihoodImpactScale.tenant_id == tenant_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Scales already exist for this tenant. Delete existing scales first."
        )
    
    default_likelihood_scales = [
        {"level": 1, "label": "Rare", "description": "May occur only in exceptional circumstances", "score_value": 1.0, "color": "#4CAF50"},
        {"level": 2, "label": "Unlikely", "description": "Could occur at some time", "score_value": 2.0, "color": "#8BC34A"},
        {"level": 3, "label": "Possible", "description": "Might occur at some time", "score_value": 3.0, "color": "#FFEB3B"},
        {"level": 4, "label": "Likely", "description": "Will probably occur in most circumstances", "score_value": 4.0, "color": "#FF9800"},
        {"level": 5, "label": "Almost Certain", "description": "Expected to occur in most circumstances", "score_value": 5.0, "color": "#F44336"},
    ]
    
    default_impact_scales = [
        {"level": 1, "label": "Negligible", "description": "Minimal impact on objectives", "score_value": 1.0, "color": "#4CAF50"},
        {"level": 2, "label": "Minor", "description": "Minor impact, easily managed", "score_value": 2.0, "color": "#8BC34A"},
        {"level": 3, "label": "Moderate", "description": "Noticeable impact requiring management attention", "score_value": 3.0, "color": "#FFEB3B"},
        {"level": 4, "label": "Major", "description": "Significant impact on objectives", "score_value": 4.0, "color": "#FF9800"},
        {"level": 5, "label": "Catastrophic", "description": "Severe impact threatening organization viability", "score_value": 5.0, "color": "#F44336"},
    ]
    
    for scale_data in default_likelihood_scales:
        db_scale = LikelihoodImpactScale(
            tenant_id=tenant_id,
            scale_type="likelihood",
            is_default=True,
            **scale_data
        )
        db.add(db_scale)
    
    for scale_data in default_impact_scales:
        db_scale = LikelihoodImpactScale(
            tenant_id=tenant_id,
            scale_type="impact",
            is_default=True,
            **scale_data
        )
        db.add(db_scale)
    
    db.commit()
    return {"message": "Default scales seeded successfully", "id": tenant_id}
