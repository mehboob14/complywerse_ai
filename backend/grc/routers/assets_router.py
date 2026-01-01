import random
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ..models import (
    ITAsset, AssetControlLink, AssetRiskAssessment,
    NormalizedControl, GRCUser, Tenant, get_db
)
from ..schemas import (
    ITAssetCreate, ITAssetUpdate, ITAssetResponse,
    AssetValuation, AssetControlLinkCreate, AssetRiskAssessmentResponse,
    AssetDashboard, AssetCoverage, MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/assets", tags=["IT Assets"])


@router.get("", response_model=List[ITAssetResponse])
def list_assets(
    tenant_id: Optional[int] = None,
    asset_type: Optional[str] = None,
    criticality: Optional[str] = None,
    owner_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(ITAsset)
    
    if tenant_id:
        query = query.filter(ITAsset.tenant_id == tenant_id)
    if asset_type:
        query = query.filter(ITAsset.asset_type == asset_type)
    if criticality:
        query = query.filter(ITAsset.criticality == criticality)
    if owner_id:
        query = query.filter(ITAsset.owner_id == owner_id)
    if status_filter:
        query = query.filter(ITAsset.status == status_filter)
    
    assets = query.order_by(ITAsset.created_at.desc()).offset(skip).limit(limit).all()
    return assets


@router.post("", response_model=ITAssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    asset: ITAssetCreate,
    tenant_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    db_asset = ITAsset(
        tenant_id=tenant_id,
        name=asset.name,
        description=asset.description,
        asset_type=asset.asset_type,
        owner_id=asset.owner_id,
        criticality=asset.criticality,
        vendor=asset.vendor,
        location=asset.location
    )
    db.add(db_asset)
    db.commit()
    db.refresh(db_asset)
    return db_asset


@router.get("/dashboard", response_model=AssetDashboard)
def get_asset_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(ITAsset)
    if tenant_id:
        query = query.filter(ITAsset.tenant_id == tenant_id)
    
    assets = query.all()
    total = len(assets)
    
    by_type = {}
    by_criticality = {}
    by_status = {}
    high_value_assets = 0
    assets_needing_assessment = 0
    
    for asset in assets:
        by_type[asset.asset_type] = by_type.get(asset.asset_type, 0) + 1
        by_criticality[asset.criticality] = by_criticality.get(asset.criticality, 0) + 1
        by_status[asset.status] = by_status.get(asset.status, 0) + 1
        
        if asset.criticality in ["high", "critical"]:
            high_value_assets += 1
        
        if not asset.risk_assessments:
            assets_needing_assessment += 1
    
    return AssetDashboard(
        total_assets=total,
        by_type=by_type,
        by_criticality=by_criticality,
        by_status=by_status,
        high_value_assets=high_value_assets,
        assets_needing_assessment=assets_needing_assessment
    )


@router.get("/coverage", response_model=AssetCoverage)
def get_asset_coverage(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(ITAsset).options(joinedload(ITAsset.control_links))
    if tenant_id:
        query = query.filter(ITAsset.tenant_id == tenant_id)
    
    assets = query.all()
    total = len(assets)
    assets_with_controls = sum(1 for a in assets if a.control_links)
    
    coverage_by_criticality = {}
    for asset in assets:
        if asset.criticality not in coverage_by_criticality:
            coverage_by_criticality[asset.criticality] = {
                "total": 0,
                "with_controls": 0,
                "coverage_percentage": 0.0
            }
        coverage_by_criticality[asset.criticality]["total"] += 1
        if asset.control_links:
            coverage_by_criticality[asset.criticality]["with_controls"] += 1
    
    for crit, data in coverage_by_criticality.items():
        if data["total"] > 0:
            data["coverage_percentage"] = round(
                (data["with_controls"] / data["total"]) * 100, 2
            )
    
    return AssetCoverage(
        total_assets=total,
        assets_with_controls=assets_with_controls,
        coverage_percentage=round((assets_with_controls / total) * 100, 2) if total > 0 else 0.0,
        by_criticality=coverage_by_criticality
    )


@router.get("/{asset_id}", response_model=dict)
def get_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.risk_links),
        joinedload(ITAsset.risk_assessments)
    ).filter(ITAsset.id == asset_id).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    latest_assessment = None
    if asset.risk_assessments:
        latest = sorted(asset.risk_assessments, key=lambda x: x.assessment_date, reverse=True)[0]
        latest_assessment = {
            "id": latest.id,
            "assessment_date": latest.assessment_date.isoformat(),
            "risk_score": latest.risk_score,
            "coverage_percentage": latest.coverage_percentage,
            "gaps": latest.gaps,
            "assessor_id": latest.assessor_id
        }
    
    return {
        "id": asset.id,
        "tenant_id": asset.tenant_id,
        "name": asset.name,
        "description": asset.description,
        "asset_type": asset.asset_type,
        "owner_id": asset.owner_id,
        "criticality": asset.criticality,
        "confidentiality_rating": asset.confidentiality_rating,
        "integrity_rating": asset.integrity_rating,
        "availability_rating": asset.availability_rating,
        "valuation": asset.valuation,
        "vendor": asset.vendor,
        "location": asset.location,
        "status": asset.status,
        "created_at": asset.created_at.isoformat(),
        "linked_controls": [link.normalized_control_id for link in asset.control_links],
        "linked_risks": [link.risk_id for link in asset.risk_links],
        "latest_assessment": latest_assessment
    }


@router.put("/{asset_id}", response_model=ITAssetResponse)
def update_asset(
    asset_id: int,
    asset_update: ITAssetUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    update_data = asset_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(asset, field, value)
    
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    db.delete(asset)
    db.commit()
    return None


@router.post("/{asset_id}/valuation", response_model=ITAssetResponse)
def update_asset_valuation(
    asset_id: int,
    valuation: AssetValuation,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    asset.valuation = valuation.valuation
    if valuation.confidentiality_rating is not None:
        asset.confidentiality_rating = valuation.confidentiality_rating
    if valuation.integrity_rating is not None:
        asset.integrity_rating = valuation.integrity_rating
    if valuation.availability_rating is not None:
        asset.availability_rating = valuation.availability_rating
    
    db.commit()
    db.refresh(asset)
    return asset


@router.post("/{asset_id}/controls", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_control(
    asset_id: int,
    link: AssetControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    control = db.query(NormalizedControl).filter(
        NormalizedControl.id == link.normalized_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    existing = db.query(AssetControlLink).filter(
        AssetControlLink.asset_id == asset_id,
        AssetControlLink.normalized_control_id == link.normalized_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetControlLink(
        asset_id=asset_id,
        normalized_control_id=link.normalized_control_id
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Control linked successfully")


@router.post("/{asset_id}/assess", response_model=AssetRiskAssessmentResponse)
def assess_asset(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links)
    ).filter(ITAsset.id == asset_id).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    num_controls = len(asset.control_links)
    coverage = min(num_controls * 10, 100)
    
    base_risk = 5
    if asset.criticality == "critical":
        base_risk = 8
    elif asset.criticality == "high":
        base_risk = 6
    elif asset.criticality == "low":
        base_risk = 3
    
    risk_score = max(1, base_risk - (num_controls * 0.5))
    
    gaps = {
        "missing_controls": max(0, 10 - num_controls),
        "recommendations": []
    }
    if num_controls < 3:
        gaps["recommendations"].append("Add more controls to improve coverage")
    if asset.criticality in ["high", "critical"] and num_controls < 5:
        gaps["recommendations"].append("Critical assets should have at least 5 controls")
    
    assessment = AssetRiskAssessment(
        asset_id=asset_id,
        risk_score=round(risk_score, 2),
        coverage_percentage=float(coverage),
        gaps=gaps,
        assessor_id=current_user.id
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)
    return assessment


@router.get("/{asset_id}/assessment", response_model=AssetRiskAssessmentResponse)
def get_latest_assessment(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    asset = db.query(ITAsset).filter(ITAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    assessment = db.query(AssetRiskAssessment).filter(
        AssetRiskAssessment.asset_id == asset_id
    ).order_by(AssetRiskAssessment.assessment_date.desc()).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessment found for this asset"
        )
    
    return assessment
