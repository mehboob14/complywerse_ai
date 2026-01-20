import random
import csv
import io
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from ..models import (
    ITAsset, AssetControlLink, AssetRiskAssessment, AssetFrameworkControlLink,
    AssetEvidenceLink, NormalizedControl, FrameworkControl, Evidence, GRCUser, Tenant, get_db
)
from ..schemas import (
    ITAssetCreate, ITAssetUpdate, ITAssetResponse,
    AssetValuation, AssetControlLinkCreate, AssetRiskAssessmentResponse,
    AssetDashboard, AssetCoverage, MessageResponse,
    AssetFrameworkControlLinkCreate, AssetEvidenceLinkCreate,
    AssetDetailResponse, AssetCoverageAnalysis
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/assets", tags=["IT Assets"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


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
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(ITAsset).filter(ITAsset.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
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
        location=asset.location,
        confidentiality_rating=asset.confidentiality_rating,
        integrity_rating=asset.integrity_rating,
        availability_rating=asset.availability_rating,
        valuation=asset.valuation
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
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return AssetDashboard(
            total_assets=0,
            by_type={},
            by_criticality={},
            by_status={},
            high_value_assets=0,
            assets_needing_assessment=0
        )
    
    query = db.query(ITAsset).filter(ITAsset.tenant_id.in_(user_tenants))
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
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
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return AssetCoverage(
            total_assets=0,
            assets_with_controls=0,
            coverage_percentage=0.0,
            by_criticality={}
        )
    
    query = db.query(ITAsset).options(joinedload(ITAsset.control_links)).filter(ITAsset.tenant_id.in_(user_tenants))
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.risk_links),
        joinedload(ITAsset.risk_assessments)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
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
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
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


@router.get("/{asset_id}/detail", response_model=AssetDetailResponse)
def get_asset_detail(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.risk_links),
        joinedload(ITAsset.risk_assessments),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.evidence_links),
        joinedload(ITAsset.owner)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    linked_controls = []
    for link in asset.control_links:
        control = db.query(NormalizedControl).filter(NormalizedControl.id == link.normalized_control_id).first()
        if control:
            linked_controls.append({
                "id": link.id,
                "control_id": control.id,
                "code": control.code,
                "name": control.name
            })
    
    linked_framework_controls = []
    for link in asset.framework_control_links:
        fc = db.query(FrameworkControl).filter(FrameworkControl.id == link.framework_control_id).first()
        if fc:
            linked_framework_controls.append({
                "id": link.id,
                "framework_control_id": fc.id,
                "code": fc.code,
                "name": fc.name,
                "coverage_status": link.coverage_status,
                "notes": link.notes
            })
    
    linked_risks = [{"risk_id": link.risk_id} for link in asset.risk_links]
    
    linked_evidence = []
    for link in asset.evidence_links:
        ev = db.query(Evidence).filter(Evidence.id == link.evidence_id).first()
        if ev:
            linked_evidence.append({
                "id": link.id,
                "evidence_id": ev.id,
                "name": ev.name,
                "relationship_type": link.relationship_type
            })
    
    risk_assessments = []
    for assessment in asset.risk_assessments:
        risk_assessments.append({
            "id": assessment.id,
            "assessment_date": assessment.assessment_date.isoformat(),
            "risk_score": assessment.risk_score,
            "coverage_percentage": assessment.coverage_percentage,
            "gaps": assessment.gaps
        })
    
    total_controls = len(linked_controls) + len(linked_framework_controls)
    coverage = min(total_controls * 10, 100) if total_controls > 0 else 0
    
    return AssetDetailResponse(
        id=asset.id,
        tenant_id=asset.tenant_id,
        name=asset.name,
        description=asset.description,
        asset_type=asset.asset_type,
        owner_id=asset.owner_id,
        owner_name=asset.owner.display_name if asset.owner else None,
        criticality=asset.criticality,
        confidentiality_rating=asset.confidentiality_rating,
        integrity_rating=asset.integrity_rating,
        availability_rating=asset.availability_rating,
        valuation=asset.valuation,
        vendor=asset.vendor,
        location=asset.location,
        status=asset.status,
        created_at=asset.created_at,
        linked_controls=linked_controls,
        linked_framework_controls=linked_framework_controls,
        linked_risks=linked_risks,
        linked_evidence=linked_evidence,
        risk_assessments=risk_assessments,
        coverage_percentage=float(coverage)
    )


@router.post("/{asset_id}/link-framework-control", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_framework_control(
    asset_id: int,
    link: AssetFrameworkControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    control = db.query(FrameworkControl).filter(
        FrameworkControl.id == link.framework_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework control not found"
        )
    
    existing = db.query(AssetFrameworkControlLink).filter(
        AssetFrameworkControlLink.asset_id == asset_id,
        AssetFrameworkControlLink.framework_control_id == link.framework_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetFrameworkControlLink(
        asset_id=asset_id,
        framework_control_id=link.framework_control_id,
        coverage_status=link.coverage_status,
        notes=link.notes
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Framework control linked successfully", id=db_link.id)


@router.delete("/{asset_id}/link-framework-control/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_framework_control_link(
    asset_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    link = db.query(AssetFrameworkControlLink).filter(
        AssetFrameworkControlLink.id == link_id,
        AssetFrameworkControlLink.asset_id == asset_id
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.post("/{asset_id}/link-evidence", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_asset_to_evidence(
    asset_id: int,
    link: AssetEvidenceLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    evidence = db.query(Evidence).filter(
        Evidence.id == link.evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    existing = db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.asset_id == asset_id,
        AssetEvidenceLink.evidence_id == link.evidence_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = AssetEvidenceLink(
        asset_id=asset_id,
        evidence_id=link.evidence_id,
        relationship_type=link.relationship_type
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Evidence linked successfully", id=db_link.id)


@router.delete("/{asset_id}/link-evidence/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_evidence_link(
    asset_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    link = db.query(AssetEvidenceLink).filter(
        AssetEvidenceLink.id == link_id,
        AssetEvidenceLink.asset_id == asset_id
    ).first()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Link not found"
        )
    
    db.delete(link)
    db.commit()
    return None


@router.get("/{asset_id}/coverage-analysis", response_model=AssetCoverageAnalysis)
def get_asset_coverage_analysis(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.risk_assessments)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    total_controls = len(asset.control_links) + len(asset.framework_control_links)
    
    full_coverage = sum(1 for link in asset.framework_control_links if link.coverage_status == "full")
    partial_coverage = sum(1 for link in asset.framework_control_links if link.coverage_status == "partial")
    covered_controls = len(asset.control_links) + full_coverage + (partial_coverage * 0.5)
    
    expected_controls = 10
    coverage_percentage = min((covered_controls / expected_controls) * 100, 100) if expected_controls > 0 else 0
    
    gaps = []
    if total_controls < 3:
        gaps.append({"type": "insufficient_controls", "message": "Asset has fewer than 3 controls linked"})
    if asset.criticality in ["high", "critical"] and total_controls < 5:
        gaps.append({"type": "critical_asset_gap", "message": "Critical/high priority asset should have at least 5 controls"})
    if not asset.framework_control_links:
        gaps.append({"type": "no_framework_controls", "message": "No framework controls linked to this asset"})
    
    latest_assessment = None
    risk_score = None
    if asset.risk_assessments:
        latest_assessment = sorted(asset.risk_assessments, key=lambda x: x.assessment_date, reverse=True)[0]
        risk_score = latest_assessment.risk_score
    
    return AssetCoverageAnalysis(
        asset_id=asset.id,
        asset_name=asset.name,
        total_controls=total_controls,
        covered_controls=int(covered_controls),
        coverage_percentage=round(coverage_percentage, 2),
        gaps=gaps,
        risk_score=risk_score
    )


@router.post("/{asset_id}/assess-risk", response_model=AssetRiskAssessmentResponse)
def perform_risk_assessment(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    asset = db.query(ITAsset).options(
        joinedload(ITAsset.control_links),
        joinedload(ITAsset.framework_control_links),
        joinedload(ITAsset.evidence_links)
    ).filter(
        ITAsset.id == asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    num_normalized_controls = len(asset.control_links)
    num_framework_controls = len(asset.framework_control_links)
    num_evidence = len(asset.evidence_links)
    
    total_controls = num_normalized_controls + num_framework_controls
    coverage = min(total_controls * 10, 100)
    
    base_risk = 5
    if asset.criticality == "critical":
        base_risk = 9
    elif asset.criticality == "high":
        base_risk = 7
    elif asset.criticality == "low":
        base_risk = 3
    
    control_reduction = total_controls * 0.4
    evidence_reduction = num_evidence * 0.2
    risk_score = max(1, base_risk - control_reduction - evidence_reduction)
    
    gaps = {
        "missing_controls": max(0, 10 - total_controls),
        "missing_evidence": max(0, 5 - num_evidence),
        "recommendations": []
    }
    if total_controls < 3:
        gaps["recommendations"].append("Add more controls to improve coverage")
    if asset.criticality in ["high", "critical"] and total_controls < 5:
        gaps["recommendations"].append("Critical assets should have at least 5 controls")
    if num_evidence < 2:
        gaps["recommendations"].append("Add more evidence documentation")
    if not asset.framework_control_links:
        gaps["recommendations"].append("Link to framework controls for better compliance tracking")
    
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


ASSET_TEMPLATE_COLUMNS = [
    ("name", "Asset Name (Required)", "ERP System"),
    ("description", "Description", "Enterprise Resource Planning system for finance and operations"),
    ("asset_type", "Asset Type (Required: application/infrastructure/data/cloud/third_party)", "application"),
    ("criticality", "Criticality (low/medium/high/critical)", "high"),
    ("vendor", "Vendor Name", "SAP"),
    ("location", "Location", "Primary Data Center"),
    ("confidentiality_rating", "Confidentiality Rating (1-5)", "4"),
    ("integrity_rating", "Integrity Rating (1-5)", "5"),
    ("availability_rating", "Availability Rating (1-5)", "5"),
    ("valuation", "Valuation (USD)", "500000"),
    ("status", "Status (active/inactive/decommissioned)", "active"),
]


@router.get("/template/download")
def download_asset_template(
    current_user: GRCUser = Depends(require_auth)
):
    """Download CSV template for bulk asset import"""
    output = io.StringIO()
    writer = csv.writer(output)
    
    headers = [col[0] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(headers)
    
    descriptions = [col[1] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(descriptions)
    
    examples = [col[2] for col in ASSET_TEMPLATE_COLUMNS]
    writer.writerow(examples)
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=it_assets_template.csv"}
    )


@router.post("/import/upload")
async def upload_assets_file(
    file: UploadFile = File(...),
    tenant_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Upload CSV or Excel file to bulk import IT assets"""
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is not assigned to any tenant"
            )
    
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No file provided"
        )
    
    filename = file.filename.lower()
    if not (filename.endswith('.csv') or filename.endswith('.xlsx') or filename.endswith('.xls')):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be CSV or Excel format (.csv, .xlsx, .xls)"
        )
    
    content = await file.read()
    rows = []
    
    try:
        if filename.endswith('.csv'):
            text_content = content.decode('utf-8')
            reader = csv.DictReader(io.StringIO(text_content))
            rows = list(reader)
        else:
            from openpyxl import load_workbook
            wb = load_workbook(filename=io.BytesIO(content), read_only=True)
            ws = wb.active
            
            headers = []
            for idx, row in enumerate(ws.iter_rows(values_only=True)):
                if idx == 0:
                    headers = [str(cell).strip() if cell else "" for cell in row]
                    continue
                if idx == 1:
                    first_cell = str(row[0]).lower() if row[0] else ""
                    if "required" in first_cell or "description" in first_cell or "name" in first_cell:
                        continue
                
                if not any(row):
                    continue
                    
                row_dict = {}
                for col_idx, cell in enumerate(row):
                    if col_idx < len(headers) and headers[col_idx]:
                        row_dict[headers[col_idx]] = cell
                rows.append(row_dict)
            wb.close()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Error parsing file: {str(e)}"
        )
    
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No data rows found in file"
        )
    
    valid_asset_types = ['application', 'infrastructure', 'data', 'cloud', 'third_party']
    valid_criticality = ['low', 'medium', 'high', 'critical']
    valid_status = ['active', 'inactive', 'decommissioned']
    
    imported = 0
    errors = []
    
    for idx, row in enumerate(rows):
        row_num = idx + 2
        
        name = str(row.get('name', '')).strip()
        if not name:
            errors.append(f"Row {row_num}: Missing required field 'name'")
            continue
        
        asset_type = str(row.get('asset_type', 'application')).strip().lower()
        if asset_type not in valid_asset_types:
            errors.append(f"Row {row_num}: Invalid asset_type '{asset_type}'. Must be one of: {', '.join(valid_asset_types)}")
            continue
        
        criticality = str(row.get('criticality', 'medium')).strip().lower()
        if criticality not in valid_criticality:
            criticality = 'medium'
        
        asset_status = str(row.get('status', 'active')).strip().lower()
        if asset_status not in valid_status:
            asset_status = 'active'
        
        conf_rating = row.get('confidentiality_rating')
        int_rating = row.get('integrity_rating')
        avail_rating = row.get('availability_rating')
        valuation = row.get('valuation')
        
        try:
            conf_rating = int(conf_rating) if conf_rating else None
            if conf_rating and (conf_rating < 1 or conf_rating > 5):
                conf_rating = None
        except (ValueError, TypeError):
            conf_rating = None
            
        try:
            int_rating = int(int_rating) if int_rating else None
            if int_rating and (int_rating < 1 or int_rating > 5):
                int_rating = None
        except (ValueError, TypeError):
            int_rating = None
            
        try:
            avail_rating = int(avail_rating) if avail_rating else None
            if avail_rating and (avail_rating < 1 or avail_rating > 5):
                avail_rating = None
        except (ValueError, TypeError):
            avail_rating = None
            
        try:
            valuation = float(str(valuation).replace(',', '').replace('$', '')) if valuation else None
        except (ValueError, TypeError):
            valuation = None
        
        try:
            db_asset = ITAsset(
                tenant_id=tenant_id,
                name=name,
                description=str(row.get('description', '')).strip() or None,
                asset_type=asset_type,
                criticality=criticality,
                vendor=str(row.get('vendor', '')).strip() or None,
                location=str(row.get('location', '')).strip() or None,
                confidentiality_rating=conf_rating,
                integrity_rating=int_rating,
                availability_rating=avail_rating,
                valuation=valuation,
                status=asset_status
            )
            db.add(db_asset)
            imported += 1
        except Exception as e:
            errors.append(f"Row {row_num}: Error creating asset - {str(e)}")
    
    if imported > 0:
        db.commit()
    
    return {
        "success": True,
        "imported": imported,
        "total_rows": len(rows),
        "errors": errors[:20] if errors else [],
        "total_errors": len(errors),
        "message": f"Successfully imported {imported} assets" + (f" with {len(errors)} errors" if errors else "")
    }
