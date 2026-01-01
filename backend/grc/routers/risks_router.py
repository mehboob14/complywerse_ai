from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ..models import (
    Risk, RiskControlLink, RiskAssetLink, RiskEvidenceLink,
    NormalizedControl, ITAsset, Evidence, GRCUser, Tenant, get_db
)
from ..schemas import (
    RiskCreate, RiskUpdate, RiskResponse,
    RiskAssessment, RiskTreatment,
    RiskControlLinkCreate, RiskAssetLinkCreate, RiskEvidenceLinkCreate,
    RiskDashboard, RiskHeatmapCell, MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/risks", tags=["Risk Management"])


def calculate_risk_score(likelihood: int, impact: int) -> float:
    return likelihood * impact


@router.get("", response_model=List[RiskResponse])
def list_risks(
    tenant_id: Optional[int] = None,
    category: Optional[str] = None,
    status_filter: Optional[str] = None,
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Risk)
    
    if tenant_id:
        query = query.filter(Risk.tenant_id == tenant_id)
    if category:
        query = query.filter(Risk.category == category)
    if status_filter:
        query = query.filter(Risk.status == status_filter)
    if min_score is not None:
        query = query.filter(Risk.inherent_score >= min_score)
    if max_score is not None:
        query = query.filter(Risk.inherent_score <= max_score)
    
    risks = query.order_by(Risk.created_at.desc()).offset(skip).limit(limit).all()
    return risks


@router.post("", response_model=RiskResponse, status_code=status.HTTP_201_CREATED)
def create_risk(
    risk: RiskCreate,
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
    
    db_risk = Risk(
        tenant_id=tenant_id,
        title=risk.title,
        description=risk.description,
        category=risk.category,
        owner_id=risk.owner_id
    )
    db.add(db_risk)
    db.commit()
    db.refresh(db_risk)
    return db_risk


@router.get("/dashboard", response_model=RiskDashboard)
def get_risk_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Risk)
    if tenant_id:
        query = query.filter(Risk.tenant_id == tenant_id)
    
    risks = query.all()
    total = len(risks)
    
    by_category = {}
    by_status = {}
    high_risks = 0
    medium_risks = 0
    low_risks = 0
    
    for risk in risks:
        by_category[risk.category] = by_category.get(risk.category, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        if risk.inherent_score:
            if risk.inherent_score >= 15:
                high_risks += 1
            elif risk.inherent_score >= 8:
                medium_risks += 1
            else:
                low_risks += 1
    
    return RiskDashboard(
        total_risks=total,
        by_category=by_category,
        by_status=by_status,
        by_score_range={
            "high": high_risks,
            "medium": medium_risks,
            "low": low_risks
        },
        high_risks=high_risks,
        medium_risks=medium_risks,
        low_risks=low_risks
    )


@router.get("/heatmap")
def get_risk_heatmap(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Risk).filter(
        Risk.inherent_likelihood.isnot(None),
        Risk.inherent_impact.isnot(None)
    )
    if tenant_id:
        query = query.filter(Risk.tenant_id == tenant_id)
    
    risks = query.all()
    
    heatmap = {}
    for risk in risks:
        key = f"{risk.inherent_likelihood}_{risk.inherent_impact}"
        if key not in heatmap:
            heatmap[key] = {
                "likelihood": risk.inherent_likelihood,
                "impact": risk.inherent_impact,
                "count": 0,
                "risk_ids": []
            }
        heatmap[key]["count"] += 1
        heatmap[key]["risk_ids"].append(risk.id)
    
    return {"cells": list(heatmap.values())}


@router.get("/{risk_id}", response_model=dict)
def get_risk(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).options(
        joinedload(Risk.control_links),
        joinedload(Risk.asset_links),
        joinedload(Risk.evidence_links)
    ).filter(Risk.id == risk_id).first()
    
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    return {
        "id": risk.id,
        "tenant_id": risk.tenant_id,
        "title": risk.title,
        "description": risk.description,
        "category": risk.category,
        "owner_id": risk.owner_id,
        "inherent_likelihood": risk.inherent_likelihood,
        "inherent_impact": risk.inherent_impact,
        "inherent_score": risk.inherent_score,
        "residual_likelihood": risk.residual_likelihood,
        "residual_impact": risk.residual_impact,
        "residual_score": risk.residual_score,
        "risk_appetite": risk.risk_appetite,
        "status": risk.status,
        "treatment_plan": risk.treatment_plan,
        "created_at": risk.created_at.isoformat(),
        "updated_at": risk.updated_at.isoformat(),
        "linked_controls": [link.normalized_control_id for link in risk.control_links],
        "linked_assets": [link.asset_id for link in risk.asset_links],
        "linked_evidence": [link.evidence_id for link in risk.evidence_links]
    }


@router.put("/{risk_id}", response_model=RiskResponse)
def update_risk(
    risk_id: int,
    risk_update: RiskUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    update_data = risk_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(risk, field, value)
    
    risk.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(risk)
    return risk


@router.delete("/{risk_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_risk(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    db.delete(risk)
    db.commit()
    return None


@router.post("/{risk_id}/assess", response_model=RiskResponse)
def assess_risk(
    risk_id: int,
    assessment: RiskAssessment,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    risk.inherent_likelihood = assessment.inherent_likelihood
    risk.inherent_impact = assessment.inherent_impact
    risk.inherent_score = calculate_risk_score(
        assessment.inherent_likelihood,
        assessment.inherent_impact
    )
    
    if assessment.residual_likelihood and assessment.residual_impact:
        risk.residual_likelihood = assessment.residual_likelihood
        risk.residual_impact = assessment.residual_impact
        risk.residual_score = calculate_risk_score(
            assessment.residual_likelihood,
            assessment.residual_impact
        )
    
    if assessment.risk_appetite:
        risk.risk_appetite = assessment.risk_appetite
    
    risk.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(risk)
    return risk


@router.post("/{risk_id}/treatment", response_model=RiskResponse)
def add_treatment_plan(
    risk_id: int,
    treatment: RiskTreatment,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    risk.treatment_plan = treatment.treatment_plan
    risk.status = "mitigating"
    risk.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(risk)
    return risk


@router.post("/{risk_id}/controls", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_risk_to_control(
    risk_id: int,
    link: RiskControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    control = db.query(NormalizedControl).filter(
        NormalizedControl.id == link.normalized_control_id
    ).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    existing = db.query(RiskControlLink).filter(
        RiskControlLink.risk_id == risk_id,
        RiskControlLink.normalized_control_id == link.normalized_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = RiskControlLink(
        risk_id=risk_id,
        normalized_control_id=link.normalized_control_id
    )
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Control linked successfully")


@router.post("/{risk_id}/assets", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_risk_to_asset(
    risk_id: int,
    link: RiskAssetLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    asset = db.query(ITAsset).filter(ITAsset.id == link.asset_id).first()
    if not asset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    existing = db.query(RiskAssetLink).filter(
        RiskAssetLink.risk_id == risk_id,
        RiskAssetLink.asset_id == link.asset_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = RiskAssetLink(risk_id=risk_id, asset_id=link.asset_id)
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Asset linked successfully")


@router.post("/{risk_id}/evidence", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def link_risk_to_evidence(
    risk_id: int,
    link: RiskEvidenceLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = db.query(Risk).filter(Risk.id == risk_id).first()
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    evidence = db.query(Evidence).filter(Evidence.id == link.evidence_id).first()
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    existing = db.query(RiskEvidenceLink).filter(
        RiskEvidenceLink.risk_id == risk_id,
        RiskEvidenceLink.evidence_id == link.evidence_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Link already exists"
        )
    
    db_link = RiskEvidenceLink(risk_id=risk_id, evidence_id=link.evidence_id)
    db.add(db_link)
    db.commit()
    
    return MessageResponse(message="Evidence linked successfully")
