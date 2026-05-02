from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
import os
import json

from ....models import (
    RiskAppetiteConfig, GRCUser, Risk, get_db,
)
from ....schemas import (
    RiskAppetiteConfigCreate, RiskAppetiteConfigUpdate, RiskAppetiteConfigResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/appetite")


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
                "full_name": config.escalation_owner.display_name or config.escalation_owner.username
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
                    "full_name": risk.owner.display_name or risk.owner.username
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
        # Upsert: update existing config
        existing.appetite_level = config.appetite_level
        existing.max_acceptable_score = config.max_acceptable_score
        existing.tolerance_threshold = config.tolerance_threshold
        existing.escalation_owner_id = config.escalation_owner_id
        existing.alert_enabled = config.alert_enabled
        existing.description = config.description
        db.commit()
        db.refresh(existing)
        return existing
    
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


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_appetite_config(
    config_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Delete a risk appetite configuration"""
    tenant_ids = get_user_tenants(current_user, db)

    db_config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.id == config_id,
        RiskAppetiteConfig.tenant_id.in_(tenant_ids)
    ).first()

    if not db_config:
        raise HTTPException(status_code=404, detail="Appetite config not found")

    db.delete(db_config)
    db.commit()


@router.post("/seed-defaults")
def seed_default_appetite_configs(
    tenant_id: Optional[int] = Query(None),
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Seed default appetite configurations for all categories"""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # If tenant_id not provided or not in user's tenants, use primary tenant
    if not tenant_id or tenant_id not in tenant_ids:
        tenant_id = get_user_primary_tenant(current_user, db) or tenant_ids[0]
    
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


class AppetiteAISuggestRequest(BaseModel):
    category: str
    description: Optional[str] = None


class AppetiteAISuggestResponse(BaseModel):
    category: str
    appetite_level: str
    tolerance_threshold: float
    max_acceptable_score: float
    description: str
    escalation_criteria: str
    rationale: str


def get_openai_client():
    from openai import OpenAI
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


APPETITE_AI_PROMPT = """You are an expert Enterprise Risk Management (ERM) consultant specializing in risk appetite frameworks. Based on industry best practices (ISO 31000, COSO ERM, Basel III), suggest appropriate risk appetite thresholds for the given risk category.

RISK CATEGORY: {category}
{description_section}

APPETITE LEVELS (from most conservative to most aggressive):
- averse: Organization avoids this risk entirely (score 1)
- minimal: Organization accepts minimal exposure (score 2)
- cautious: Organization prefers low-risk options (score 3)
- moderate: Organization balances risk and reward (score 4)
- open: Organization is willing to accept higher risk for potential returns (score 5)
- hungry: Organization actively seeks this risk for competitive advantage (score 6)

SCORING: Risk scores range from 1-25 (likelihood 1-5 × impact 1-5).

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{{
  "appetite_level": "<one of: averse, minimal, cautious, moderate, open, hungry>",
  "tolerance_threshold": <number between 1 and 25>,
  "max_acceptable_score": <number between 1 and 25>,
  "description": "<2-3 sentence description of the appetite stance for this category>",
  "escalation_criteria": "<when should risks in this category be escalated to senior management>",
  "rationale": "<brief rationale for why these thresholds are appropriate based on industry best practices>"
}}"""


@router.post("/ai-suggest", response_model=AppetiteAISuggestResponse)
def ai_suggest_appetite(
    request: AppetiteAISuggestRequest,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    client = get_openai_client()

    description_section = ""
    if request.description:
        description_section = f"ADDITIONAL CONTEXT: {request.description}"

    prompt = APPETITE_AI_PROMPT.format(
        category=request.category,
        description_section=description_section
    )

    try:
        response = client.chat.completions.create(
            model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "You are an enterprise risk management expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=500
        )

        response_text = response.choices[0].message.content.strip()
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        result = json.loads(response_text.strip())
        result["category"] = request.category

        if result.get("appetite_level") not in APPETITE_LEVELS:
            result["appetite_level"] = "moderate"
        if not isinstance(result.get("tolerance_threshold"), (int, float)) or not (1 <= result["tolerance_threshold"] <= 25):
            result["tolerance_threshold"] = 15.0
        if not isinstance(result.get("max_acceptable_score"), (int, float)) or not (1 <= result["max_acceptable_score"] <= 25):
            result["max_acceptable_score"] = 12.0

        return result

    except json.JSONDecodeError:
        return {
            "category": request.category,
            "appetite_level": "moderate",
            "tolerance_threshold": 15.0,
            "max_acceptable_score": 12.0,
            "description": f"Default moderate appetite for {request.category} risks. Organization balances risk and reward.",
            "escalation_criteria": "Escalate when risk score exceeds tolerance threshold or when multiple risks in this category breach limits simultaneously.",
            "rationale": "AI response could not be parsed. Default moderate values applied based on general best practices."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI suggestion failed: {str(e)}"
        )
