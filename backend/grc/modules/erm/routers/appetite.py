from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import datetime

from ....models import (
    SessionLocal, RiskAppetiteConfig, GRCUser, Risk
)
from ....schemas import (
    RiskAppetiteConfigCreate, RiskAppetiteConfigUpdate, RiskAppetiteConfigResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/appetite")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


RISK_CATEGORIES = [
    "strategic", "operational", "financial", "compliance", 
    "technology", "third_party", "project_change"
]

APPETITE_LEVELS = {
    "averse": 1,
    "minimal": 2,
    "cautious": 3,
    "moderate": 4,
    "open": 5,
    "hungry": 6
}


@router.get("", response_model=List[RiskAppetiteConfigResponse])
def get_appetite_configs(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get all risk appetite configurations for user's tenants"""
    tenant_ids = get_user_tenants(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    
    return configs


@router.get("/with-stats")
def get_appetite_configs_with_stats(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get appetite configs with risk count statistics"""
    tenant_ids = get_user_tenants(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    
    result = []
    for config in configs:
        risks_in_category = db.query(Risk).filter(
            Risk.tenant_id.in_(tenant_ids),
            Risk.risk_category == config.category
        ).all()
        
        appetite_value = APPETITE_LEVELS.get(config.appetite_level, 4)
        exceeding_count = 0
        tolerance_breaches = []
        
        tolerance = config.tolerance_threshold if config.tolerance_threshold else config.max_acceptable_score
        
        for risk in risks_in_category:
            if risk.residual_score and risk.residual_score > tolerance:
                exceeding_count += 1
                days_over = 0
                if risk.updated_at:
                    days_over = (datetime.utcnow() - risk.updated_at).days
                elif risk.created_at:
                    days_over = (datetime.utcnow() - risk.created_at).days
                    
                tolerance_breaches.append({
                    "risk_id": risk.id,
                    "risk_title": risk.title,
                    "category": risk.risk_category,
                    "current_score": risk.residual_score,
                    "tolerance": tolerance,
                    "days_over": days_over
                })
        
        escalation_owner_data = None
        if config.escalation_owner:
            escalation_owner_data = {
                "id": config.escalation_owner.id,
                "email": config.escalation_owner.email,
                "full_name": config.escalation_owner.full_name
            }
        
        result.append({
            "id": config.id,
            "tenant_id": config.tenant_id,
            "category": config.category,
            "appetite_level": config.appetite_level,
            "appetite_value": appetite_value,
            "max_acceptable_score": config.max_acceptable_score,
            "tolerance_threshold": tolerance,
            "escalation_owner_id": config.escalation_owner_id,
            "escalation_owner": escalation_owner_data,
            "alert_enabled": config.alert_enabled,
            "description": config.description,
            "risks_count": len(risks_in_category),
            "exceeding_count": exceeding_count,
            "tolerance_breaches": tolerance_breaches
        })
    
    return result


@router.get("/breaches")
def get_tolerance_breaches(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get all risks exceeding their category's tolerance threshold"""
    tenant_ids = get_user_tenants(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).all()
    
    config_map = {c.category: c for c in configs}
    
    breaches = []
    
    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(tenant_ids),
        Risk.closure_status.is_(None)
    ).all()
    
    for risk in risks:
        config = config_map.get(risk.risk_category)
        tolerance = config.tolerance_threshold if config and config.tolerance_threshold else 15
        if config and not config.tolerance_threshold:
            tolerance = config.max_acceptable_score
        
        if risk.residual_score and risk.residual_score > tolerance:
            days_over = 0
            if risk.updated_at:
                days_over = (datetime.utcnow() - risk.updated_at).days
            elif risk.created_at:
                days_over = (datetime.utcnow() - risk.created_at).days
            
            owner_data = None
            if risk.owner:
                owner_data = {
                    "id": risk.owner.id,
                    "email": risk.owner.email,
                    "full_name": risk.owner.full_name
                }
                
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": risk.risk_category,
                "current_score": risk.residual_score,
                "tolerance": tolerance,
                "excess": risk.residual_score - tolerance,
                "days_over": days_over,
                "owner_id": risk.owner_id,
                "owner": owner_data
            })
    
    return {
        "total_breaches": len(breaches),
        "breaches": sorted(breaches, key=lambda x: x["excess"], reverse=True)
    }


@router.post("", response_model=RiskAppetiteConfigResponse)
def create_appetite_config(
    config: RiskAppetiteConfigCreate,
    tenant_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Create a new risk appetite configuration"""
    tenant_ids = get_user_tenants(current_user, db)
    
    if tenant_id not in tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    existing = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id,
        RiskAppetiteConfig.category == config.category
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Appetite config already exists for category {config.category}"
        )
    
    db_config = RiskAppetiteConfig(
        tenant_id=tenant_id,
        category=config.category,
        appetite_level=config.appetite_level,
        max_acceptable_score=config.max_acceptable_score,
        tolerance_threshold=config.tolerance_threshold,
        escalation_owner_id=config.escalation_owner_id,
        alert_enabled=config.alert_enabled,
        description=config.description
    )
    
    db.add(db_config)
    db.commit()
    db.refresh(db_config)
    
    return db_config


@router.put("/{config_id}", response_model=RiskAppetiteConfigResponse)
def update_appetite_config(
    config_id: int,
    config_update: RiskAppetiteConfigUpdate,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Update a risk appetite configuration"""
    tenant_ids = get_user_tenants(current_user, db)
    
    db_config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.id == config_id,
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).first()
    
    if not db_config:
        raise HTTPException(status_code=404, detail="Appetite config not found")
    
    update_data = config_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_config, key, value)
    
    db.commit()
    db.refresh(db_config)
    
    return db_config


@router.post("/seed-defaults")
def seed_default_appetite_configs(
    tenant_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Seed default appetite configurations for all categories"""
    tenant_ids = get_user_tenants(current_user, db)
    
    if tenant_id not in tenant_ids:
        raise HTTPException(status_code=403, detail="Not authorized for this tenant")
    
    created = []
    
    for category in RISK_CATEGORIES:
        existing = db.query(RiskAppetiteConfig).filter(
            RiskAppetiteConfig.tenant_id == tenant_id,
            RiskAppetiteConfig.category == category
        ).first()
        
        if not existing:
            db_config = RiskAppetiteConfig(
                tenant_id=tenant_id,
                category=category,
                appetite_level="moderate",
                max_acceptable_score=15.0,
                tolerance_threshold=15.0,
                alert_enabled=True,
                description=f"Default appetite configuration for {category} risks"
            )
            db.add(db_config)
            created.append(category)
    
    db.commit()
    
    return {
        "message": f"Created appetite configs for {len(created)} categories",
        "created_categories": created
    }
