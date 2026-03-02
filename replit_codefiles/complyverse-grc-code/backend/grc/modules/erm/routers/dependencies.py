from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from ....models import (
    Risk, RiskDependency, RiskScoreHistory, RiskAppetiteConfig,
    RiskControlLink, GRCUser, get_db
)
from ....schemas import (
    RiskDependencyCreate, RiskDependencyResponse,
    RiskScoreHistoryResponse, RiskTrendData, RiskTrendsResponse,
    RiskAppetiteConfigUpdate, RiskAppetiteConfigResponse,
    ControlEffectivenessUpdate, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/dependencies", tags=["ERM - Dependencies & Trends"])


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


@router.get("", response_model=List[RiskDependencyResponse])
def list_dependencies(
    source_risk_id: Optional[int] = None,
    target_risk_id: Optional[int] = None,
    dependency_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskDependency).join(
        Risk, RiskDependency.source_risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants))
    
    if source_risk_id:
        query = query.filter(RiskDependency.source_risk_id == source_risk_id)
    if target_risk_id:
        query = query.filter(RiskDependency.target_risk_id == target_risk_id)
    if dependency_type:
        query = query.filter(RiskDependency.dependency_type == dependency_type)
    
    dependencies = query.all()
    
    result = []
    for dep in dependencies:
        dep_data = RiskDependencyResponse.model_validate(dep)
        if dep.source_risk:
            dep_data.source_risk_title = dep.source_risk.title
        if dep.target_risk:
            dep_data.target_risk_title = dep.target_risk.title
        result.append(dep_data)
    
    return result


@router.post("", response_model=RiskDependencyResponse, status_code=status.HTTP_201_CREATED)
def create_dependency(
    source_risk_id: int,
    dependency: RiskDependencyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    source_risk = db.query(Risk).filter(
        Risk.id == source_risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not source_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source risk not found"
        )
    
    target_risk = db.query(Risk).filter(
        Risk.id == dependency.target_risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not target_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target risk not found"
        )
    
    if source_risk_id == dependency.target_risk_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A risk cannot depend on itself"
        )
    
    existing = db.query(RiskDependency).filter(
        RiskDependency.source_risk_id == source_risk_id,
        RiskDependency.target_risk_id == dependency.target_risk_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dependency already exists"
        )
    
    db_dependency = RiskDependency(
        source_risk_id=source_risk_id,
        target_risk_id=dependency.target_risk_id,
        dependency_type=dependency.dependency_type,
        impact_factor=dependency.impact_factor,
        description=dependency.description
    )
    db.add(db_dependency)
    db.commit()
    db.refresh(db_dependency)
    
    dep_data = RiskDependencyResponse.model_validate(db_dependency)
    dep_data.source_risk_title = source_risk.title
    dep_data.target_risk_title = target_risk.title
    return dep_data


@router.delete("/{dependency_id}", response_model=MessageResponse)
def delete_dependency(
    dependency_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    dependency = db.query(RiskDependency).join(
        Risk, RiskDependency.source_risk_id == Risk.id
    ).filter(
        RiskDependency.id == dependency_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not dependency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dependency not found"
        )
    
    db.delete(dependency)
    db.commit()
    return {"message": "Dependency deleted successfully", "id": dependency_id}


@router.get("/{risk_id}/cascade")
def get_cascade_impact(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    source_risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not source_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    def get_cascade(current_id: int, visited: set, depth: int = 0) -> List[dict]:
        if current_id in visited or depth > 10:
            return []
        visited.add(current_id)
        
        deps = db.query(RiskDependency).filter(
            RiskDependency.source_risk_id == current_id
        ).all()
        
        results = []
        for dep in deps:
            if dep.target_risk:
                cascade_score = (dep.target_risk.residual_score or dep.target_risk.inherent_score or 0) * dep.impact_factor
                results.append({
                    "risk_id": dep.target_risk_id,
                    "risk_title": dep.target_risk.title,
                    "dependency_type": dep.dependency_type,
                    "impact_factor": dep.impact_factor,
                    "cascade_score": round(cascade_score, 2),
                    "depth": depth + 1,
                    "downstream": get_cascade(dep.target_risk_id, visited, depth + 1)
                })
        return results
    
    cascade_analysis = {
        "source_risk_id": risk_id,
        "source_risk_title": source_risk.title,
        "source_score": source_risk.residual_score or source_risk.inherent_score,
        "cascade_impact": get_cascade(risk_id, set())
    }
    
    total_cascade_score = sum(
        item["cascade_score"] for item in cascade_analysis["cascade_impact"]
    )
    cascade_analysis["total_cascade_score"] = round(total_cascade_score, 2)
    
    return cascade_analysis


@router.get("/history/{risk_id}", response_model=List[RiskScoreHistoryResponse])
def get_score_history(
    risk_id: int,
    days: int = 365,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    start_date = datetime.utcnow() - timedelta(days=days)
    history = db.query(RiskScoreHistory).filter(
        RiskScoreHistory.risk_id == risk_id,
        RiskScoreHistory.recorded_at >= start_date
    ).order_by(RiskScoreHistory.recorded_at.asc()).all()
    
    return history


@router.get("/trends", response_model=List[RiskTrendsResponse])
def get_trends(
    risk_ids: Optional[List[int]] = Query(None),
    category: Optional[str] = None,
    days: int = 180,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants))
    
    if risk_ids:
        query = query.filter(Risk.id.in_(risk_ids))
    if category:
        query = query.filter(or_(Risk.category == category, Risk.risk_category == category))
    
    risks = query.limit(50).all()
    
    start_date = datetime.utcnow() - timedelta(days=days)
    result = []
    
    for risk in risks:
        history = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= start_date
        ).order_by(RiskScoreHistory.recorded_at.asc()).all()
        
        trend_data = [
            RiskTrendData(
                date=h.recorded_at,
                inherent_score=h.inherent_score,
                residual_score=h.residual_score,
                status=h.status
            )
            for h in history
        ]
        
        current_score = risk.residual_score or risk.inherent_score or 0
        first_score = history[0].residual_score or history[0].inherent_score if history else current_score
        score_change = current_score - first_score if first_score else 0
        
        trend_direction = "stable"
        if score_change > 1:
            trend_direction = "increasing"
        elif score_change < -1:
            trend_direction = "decreasing"
        
        result.append(RiskTrendsResponse(
            risk_id=risk.id,
            risk_title=risk.title,
            trend_data=trend_data,
            score_change=round(score_change, 2),
            trend_direction=trend_direction
        ))
    
    return result


@router.get("/trends/summary")
def get_trends_summary(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "period_days": days,
            "total_risks_tracked": 0,
            "avg_score_change": 0,
            "risks_improved": 0,
            "risks_worsened": 0,
            "risks_stable": 0,
            "category_trends": {}
        }
    
    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    start_date = datetime.utcnow() - timedelta(days=days)
    
    improved = 0
    worsened = 0
    stable = 0
    total_change = 0
    category_changes = {}
    
    for risk in risks:
        first_history = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= start_date
        ).order_by(RiskScoreHistory.recorded_at.asc()).first()
        
        if first_history:
            current = risk.residual_score or risk.inherent_score or 0
            initial = first_history.residual_score or first_history.inherent_score or 0
            change = current - initial
            total_change += change
            
            category = risk.risk_category or risk.category
            if category not in category_changes:
                category_changes[category] = {"total_change": 0, "count": 0}
            category_changes[category]["total_change"] += change
            category_changes[category]["count"] += 1
            
            if change < -1:
                improved += 1
            elif change > 1:
                worsened += 1
            else:
                stable += 1
    
    total_tracked = improved + worsened + stable
    
    return {
        "period_days": days,
        "total_risks_tracked": total_tracked,
        "avg_score_change": round(total_change / total_tracked, 2) if total_tracked else 0,
        "risks_improved": improved,
        "risks_worsened": worsened,
        "risks_stable": stable,
        "category_trends": {
            cat: {"avg_change": round(data["total_change"] / data["count"], 2), "count": data["count"]}
            for cat, data in category_changes.items()
        }
    }


@router.get("/appetite", response_model=List[RiskAppetiteConfigResponse])
def get_appetite_config(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    
    return configs


@router.put("/appetite/{category}", response_model=RiskAppetiteConfigResponse)
def update_appetite(
    category: str,
    appetite_update: RiskAppetiteConfigUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id,
        RiskAppetiteConfig.category == category
    ).first()
    
    if not config:
        config = RiskAppetiteConfig(
            tenant_id=tenant_id,
            category=category,
            appetite_level=appetite_update.appetite_level or "moderate",
            max_acceptable_score=appetite_update.max_acceptable_score or 12.0,
            description=appetite_update.description
        )
        db.add(config)
    else:
        update_data = appetite_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(config, key, value)
    
    db.commit()
    db.refresh(config)
    return config


@router.get("/appetite/breaches")
def get_appetite_breaches(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    
    config_map = {c.category: c for c in configs}
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    breaches = []
    for risk in risks:
        category = risk.risk_category or risk.category
        score = risk.residual_score or risk.inherent_score or 0
        
        config = config_map.get(category)
        if config and score > config.max_acceptable_score:
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": category,
                "current_score": score,
                "appetite_level": config.appetite_level,
                "max_acceptable_score": config.max_acceptable_score,
                "breach_amount": round(score - config.max_acceptable_score, 2)
            })
    
    breaches.sort(key=lambda x: x["breach_amount"], reverse=True)
    
    return {
        "total_breaches": len(breaches),
        "breaches": breaches
    }


@router.put("/controls/{link_id}/effectiveness", response_model=MessageResponse)
def update_control_effectiveness(
    link_id: int,
    effectiveness: ControlEffectivenessUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    link = db.query(RiskControlLink).join(Risk).filter(
        RiskControlLink.id == link_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control link not found"
        )
    
    link.effectiveness_rating = effectiveness.effectiveness_rating
    if effectiveness.notes:
        link.notes = effectiveness.notes
    
    db.commit()
    return {"message": "Control effectiveness updated", "id": link_id}
