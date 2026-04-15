import os
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    AuditableEntity, AuditEngagement, AuditFinding, Risk,
    BusinessUnit, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/universe", tags=["Audit - Universe"])


INDUSTRIES = [
    "Banking", "Healthcare", "Insurance", "Technology", "Energy",
    "Government", "Manufacturing", "Retail", "Telecom", "Other",
]


class AuditableEntityCreate(BaseModel):
    name: str
    entity_type: str
    description: Optional[str] = None
    business_unit_id: Optional[int] = None
    risk_score: Optional[float] = 0
    risk_rating: Optional[str] = "low"
    audit_cycle_months: Optional[int] = 12
    owner_id: Optional[int] = None
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_designation: Optional[str] = None
    metadata_json: Optional[dict] = {}


class AuditableEntityUpdate(BaseModel):
    name: Optional[str] = None
    entity_type: Optional[str] = None
    description: Optional[str] = None
    business_unit_id: Optional[int] = None
    risk_score: Optional[float] = None
    risk_rating: Optional[str] = None
    audit_cycle_months: Optional[int] = None
    owner_id: Optional[int] = None
    status: Optional[str] = None
    industry: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_designation: Optional[str] = None
    metadata_json: Optional[dict] = None


class AIDescriptionRequest(BaseModel):
    entity_name: str
    entity_type: str
    industry: Optional[str] = None


def score_to_rating(score: float) -> str:
    if score >= 80:
        return "critical"
    elif score >= 70:
        return "high"
    elif score >= 50:
        return "medium"
    return "low"


CATEGORY_TO_TYPE = {
    "technology": "technology",
    "compliance": "compliance",
    "operational": "process",
    "strategic": "process",
    "financial": "process",
    "third_party": "process",
    "project_change": "process",
}


def serialize_entity(e: AuditableEntity) -> dict:
    risk_ids = e.linked_risk_ids or []
    return {
        "id": e.id,
        "tenant_id": e.tenant_id,
        "name": e.name,
        "entity_type": e.entity_type,
        "description": e.description,
        "business_unit_id": e.business_unit_id,
        "business_unit_name": e.business_unit.name if e.business_unit else None,
        "risk_score": e.risk_score,
        "risk_rating": e.risk_rating,
        "audit_cycle_months": e.audit_cycle_months,
        "last_audited_date": e.last_audited_date.isoformat() if e.last_audited_date else None,
        "next_audit_due": e.next_audit_due.isoformat() if e.next_audit_due else None,
        "owner_id": e.owner_id,
        "owner_name": (e.owner.display_name or e.owner.username) if e.owner else None,
        "status": e.status,
        "industry": getattr(e, "industry", None),
        "contact_name": getattr(e, "contact_name", None),
        "contact_email": getattr(e, "contact_email", None),
        "contact_phone": getattr(e, "contact_phone", None),
        "contact_designation": getattr(e, "contact_designation", None),
        "linked_risk_ids": risk_ids,
        "linked_risk_count": len(risk_ids),
        "metadata_json": e.metadata_json,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


@router.get("")
def list_auditable_entities(
    entity_type: Optional[str] = None,
    risk_rating: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"entities": [], "total": 0}
    
    query = db.query(AuditableEntity).filter(AuditableEntity.tenant_id.in_(user_tenants))
    
    if entity_type:
        query = query.filter(AuditableEntity.entity_type == entity_type)
    if risk_rating:
        query = query.filter(AuditableEntity.risk_rating == risk_rating)
    if status:
        query = query.filter(AuditableEntity.status == status)
    
    entities = query.order_by(AuditableEntity.risk_score.desc()).all()
    return {"entities": [serialize_entity(e) for e in entities], "total": len(entities)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_auditable_entity(
    data: AuditableEntityCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    next_due = datetime.utcnow() + timedelta(days=data.audit_cycle_months * 30)
    
    if data.industry and data.industry not in INDUSTRIES:
        raise HTTPException(status_code=422, detail=f"Invalid industry. Must be one of: {', '.join(INDUSTRIES)}")

    entity = AuditableEntity(
        tenant_id=tenant_id,
        name=data.name,
        entity_type=data.entity_type,
        description=data.description,
        business_unit_id=data.business_unit_id,
        risk_score=data.risk_score,
        risk_rating=data.risk_rating,
        audit_cycle_months=data.audit_cycle_months,
        next_audit_due=next_due,
        owner_id=data.owner_id,
        industry=data.industry,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        contact_designation=data.contact_designation,
        metadata_json=data.metadata_json or {},
    )
    db.add(entity)
    db.commit()
    db.refresh(entity)
    return serialize_entity(entity)


def _get_openai_client():
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


@router.post("/generate-description")
def generate_entity_description(
    data: AIDescriptionRequest,
    current_user: GRCUser = Depends(require_auth),
):
    if data.industry and data.industry not in INDUSTRIES:
        raise HTTPException(status_code=422, detail=f"Invalid industry. Must be one of: {', '.join(INDUSTRIES)}")

    client = _get_openai_client()
    industry_ctx = f" in the {data.industry} industry" if data.industry else ""
    prompt = (
        f"You are an enterprise GRC (Governance, Risk & Compliance) expert. "
        f"Generate a concise professional description for an auditable entity named "
        f"\"{data.entity_name}\" of type \"{data.entity_type}\"{industry_ctx}.\n\n"
        f"Cover the following in 3-5 sentences:\n"
        f"1. What this entity does and its role in the organization\n"
        f"2. Key business processes it supports\n"
        f"3. Regulatory relevance and compliance considerations\n"
        f"4. Inherent risk factors\n"
        f"5. Typical audit focus areas\n\n"
        f"Write in a professional tone suitable for an audit universe record. "
        f"Do not use bullet points or numbered lists — use flowing prose."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.7,
        )
        description = resp.choices[0].message.content.strip()
        return {"description": description}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI service error: {str(e)}")


@router.get("/coverage-gaps")
def get_coverage_gaps(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"gaps": [], "stats": {}}
    
    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id.in_(user_tenants),
        AuditableEntity.status == "active"
    ).all()
    
    now = datetime.utcnow()
    never_audited = []
    overdue = []
    upcoming = []
    on_track = []
    
    for e in entities:
        if not e.last_audited_date:
            never_audited.append(serialize_entity(e))
        elif e.next_audit_due and e.next_audit_due < now:
            overdue.append(serialize_entity(e))
        elif e.next_audit_due and e.next_audit_due < now + timedelta(days=90):
            upcoming.append(serialize_entity(e))
        else:
            on_track.append(serialize_entity(e))
    
    total = len(entities)
    coverage_pct = ((total - len(never_audited)) / total * 100) if total > 0 else 0
    
    return {
        "gaps": {
            "never_audited": never_audited,
            "overdue": overdue,
            "upcoming_90_days": upcoming,
            "on_track": on_track,
        },
        "stats": {
            "total_entities": total,
            "never_audited_count": len(never_audited),
            "overdue_count": len(overdue),
            "upcoming_count": len(upcoming),
            "on_track_count": len(on_track),
            "coverage_percentage": round(coverage_pct, 1),
        }
    }


@router.get("/risk-enrichment")
def get_risk_enrichment(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"risk_summary": [], "total_risks": 0}
    
    risks = db.query(
        Risk.category,
        func.count(Risk.id).label("count"),
        func.avg(Risk.residual_score).label("avg_score"),
        func.max(Risk.residual_score).label("max_score")
    ).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status != "closed"
    ).group_by(Risk.category).all()
    
    total = sum(r.count for r in risks)
    
    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id.in_(user_tenants)
    ).all()
    linked_count = sum(1 for e in entities if e.linked_risk_ids and len(e.linked_risk_ids) > 0)
    total_linked_risks = sum(len(e.linked_risk_ids or []) for e in entities)
    
    return {
        "risk_summary": [{
            "category": r.category,
            "count": r.count,
            "avg_score": round(float(r.avg_score or 0), 1),
            "max_score": float(r.max_score or 0),
        } for r in risks],
        "total_risks": total,
        "linked_entities": linked_count,
        "total_linked_risks": total_linked_risks,
        "total_entities": len(entities),
    }


@router.post("/sync-from-risks")
def sync_from_risk_register(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    open_risks = db.query(Risk).filter(
        Risk.tenant_id == tenant_id,
        Risk.status != "closed"
    ).all()
    
    if not open_risks:
        return {"message": "No open risks found in Risk Register", "created": 0, "updated": 0}
    
    by_category = {}
    for risk in open_risks:
        cat = risk.category or "operational"
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(risk)
    
    created = 0
    updated = 0
    results = []
    
    for category, cat_risks in by_category.items():
        risk_ids = [r.id for r in cat_risks]
        max_score = max((r.residual_score or r.inherent_score or 0) for r in cat_risks)
        entity_type = CATEGORY_TO_TYPE.get(category, "process")
        entity_name = f"{category.replace('_', ' ').title()} Risk Area"
        
        existing = db.query(AuditableEntity).filter(
            AuditableEntity.tenant_id == tenant_id,
            AuditableEntity.name == entity_name,
        ).first()
        
        if existing:
            existing.risk_score = max_score
            existing.risk_rating = score_to_rating(max_score)
            existing.linked_risk_ids = risk_ids
            existing.updated_at = datetime.utcnow()
            updated += 1
            results.append({"name": entity_name, "action": "updated", "risk_score": max_score, "risk_count": len(risk_ids)})
        else:
            entity = AuditableEntity(
                tenant_id=tenant_id,
                name=entity_name,
                entity_type=entity_type,
                description=f"Auto-generated from {len(cat_risks)} {category} risk(s) in the Risk Register",
                risk_score=max_score,
                risk_rating=score_to_rating(max_score),
                audit_cycle_months=12 if max_score < 70 else 6,
                next_audit_due=datetime.utcnow() + timedelta(days=180 if max_score < 70 else 90),
                linked_risk_ids=risk_ids,
                status="active",
            )
            db.add(entity)
            created += 1
            results.append({"name": entity_name, "action": "created", "risk_score": max_score, "risk_count": len(risk_ids)})
    
    for risk in open_risks:
        score = risk.residual_score or risk.inherent_score or 0
        if score < 80:
            continue
        
        entity_name = risk.title
        existing = db.query(AuditableEntity).filter(
            AuditableEntity.tenant_id == tenant_id,
            AuditableEntity.name == entity_name,
        ).first()
        
        if existing:
            existing.risk_score = score
            existing.risk_rating = score_to_rating(score)
            if not existing.linked_risk_ids or risk.id not in existing.linked_risk_ids:
                existing.linked_risk_ids = list(set((existing.linked_risk_ids or []) + [risk.id]))
            existing.updated_at = datetime.utcnow()
            updated += 1
            results.append({"name": entity_name, "action": "updated", "risk_score": score, "risk_count": 1})
        else:
            cat = risk.category or "operational"
            entity = AuditableEntity(
                tenant_id=tenant_id,
                name=entity_name,
                entity_type=CATEGORY_TO_TYPE.get(cat, "process"),
                description=risk.description or f"Critical risk requiring dedicated audit coverage",
                risk_score=score,
                risk_rating=score_to_rating(score),
                audit_cycle_months=6,
                next_audit_due=datetime.utcnow() + timedelta(days=90),
                linked_risk_ids=[risk.id],
                status="active",
            )
            db.add(entity)
            created += 1
            results.append({"name": entity_name, "action": "created", "risk_score": score, "risk_count": 1})
    
    db.commit()
    
    return {
        "message": f"Synced {created + updated} entities from Risk Register",
        "created": created,
        "updated": updated,
        "details": results,
    }


@router.post("/refresh-risk-scores")
def refresh_risk_scores(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id == tenant_id,
    ).all()
    
    refreshed = 0
    for entity in entities:
        risk_ids = entity.linked_risk_ids or []
        if not risk_ids:
            continue
        
        linked_risks = db.query(Risk).filter(Risk.id.in_(risk_ids), Risk.tenant_id == tenant_id).all()
        if not linked_risks:
            continue
        
        active_risks = [r for r in linked_risks if r.status != "closed"]
        if active_risks:
            max_score = max((r.residual_score or r.inherent_score or 0) for r in active_risks)
            active_ids = [r.id for r in active_risks]
        else:
            max_score = 0
            active_ids = []
        
        entity.risk_score = max_score
        entity.risk_rating = score_to_rating(max_score)
        entity.linked_risk_ids = active_ids
        entity.updated_at = datetime.utcnow()
        refreshed += 1
    
    db.commit()
    
    return {
        "message": f"Refreshed risk scores for {refreshed} linked entities",
        "refreshed": refreshed,
        "total_entities": len(entities),
    }


@router.get("/{entity_id}")
def get_auditable_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == entity_id,
        AuditableEntity.tenant_id.in_(user_tenants)
    ).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    
    engagements = db.query(AuditEngagement).filter(
        AuditEngagement.auditable_entity_id == entity_id
    ).order_by(AuditEngagement.created_at.desc()).all()
    
    result = serialize_entity(entity)
    result["audit_history"] = [{
        "id": eng.id,
        "title": eng.title,
        "status": eng.status,
        "opinion": eng.opinion,
        "planned_start": eng.planned_start.isoformat() if eng.planned_start else None,
        "planned_end": eng.planned_end.isoformat() if eng.planned_end else None,
    } for eng in engagements]
    
    risk_ids = entity.linked_risk_ids or []
    if risk_ids:
        linked_risks = db.query(Risk).filter(Risk.id.in_(risk_ids), Risk.tenant_id.in_(user_tenants)).all()
        result["linked_risks"] = [{
            "id": r.id,
            "title": r.title,
            "category": r.category,
            "residual_score": r.residual_score,
            "inherent_score": r.inherent_score,
            "status": r.status,
            "risk_rating": score_to_rating(r.residual_score or r.inherent_score or 0),
        } for r in linked_risks]
    else:
        result["linked_risks"] = []
    
    return result


@router.put("/{entity_id}")
def update_auditable_entity(
    entity_id: int,
    data: AuditableEntityUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == entity_id,
        AuditableEntity.tenant_id.in_(user_tenants)
    ).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")

    if data.industry is not None and data.industry and data.industry not in INDUSTRIES:
        raise HTTPException(status_code=422, detail=f"Invalid industry. Must be one of: {', '.join(INDUSTRIES)}")

    for field, value in data.dict(exclude_unset=True).items():
        setattr(entity, field, value)
    
    if data.audit_cycle_months and entity.last_audited_date:
        entity.next_audit_due = entity.last_audited_date + timedelta(days=data.audit_cycle_months * 30)
    
    entity.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entity)
    return serialize_entity(entity)


@router.delete("/{entity_id}")
def delete_auditable_entity(
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == entity_id,
        AuditableEntity.tenant_id.in_(user_tenants)
    ).first()
    if not entity:
        raise HTTPException(status_code=404, detail="Entity not found")
    
    db.delete(entity)
    db.commit()
    return {"message": "Entity deleted"}
