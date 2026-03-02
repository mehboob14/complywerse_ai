from typing import List, Optional
from datetime import datetime
import json
import logging
import os
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    AuditPlan, AuditPlanItem, AuditableEntity, AuditEngagement,
    RegulatoryChange, RegulatoryFeedItem,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/plans", tags=["Audit - Plans"])
logger = logging.getLogger(__name__)


class AuditPlanCreate(BaseModel):
    name: str
    fiscal_year: str
    description: Optional[str] = None
    total_budget_days: Optional[float] = 0


class AuditPlanUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    total_budget_days: Optional[float] = None


class PlanItemCreate(BaseModel):
    auditable_entity_id: Optional[int] = None
    name: str
    risk_score: Optional[float] = 0
    quarter: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    budget_days: Optional[float] = 0
    framework_id: Optional[int] = None
    assigned_auditor_id: Optional[int] = None
    priority: Optional[str] = "medium"
    notes: Optional[str] = None


class PlanItemUpdate(BaseModel):
    name: Optional[str] = None
    risk_score: Optional[float] = None
    quarter: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    budget_days: Optional[float] = None
    framework_id: Optional[int] = None
    assigned_auditor_id: Optional[int] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class PlanApprovalRequest(BaseModel):
    action: str
    notes: Optional[str] = None


class GenerateFromUniverseRequest(BaseModel):
    fiscal_year: str
    name: Optional[str] = None
    total_budget_days: Optional[float] = None
    min_risk_score: Optional[float] = 0


def get_openai_client() -> Optional[OpenAI]:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        return None
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _keyword_score(change_text: str, plan_text: str) -> int:
    if not change_text or not plan_text:
        return 0
    change_tokens = {t for t in change_text.lower().split() if len(t) > 3}
    plan_tokens = {t for t in plan_text.lower().split() if len(t) > 3}
    return len(change_tokens.intersection(plan_tokens))


def serialize_plan(p: AuditPlan) -> dict:
    items = []
    if p.items:
        for item in p.items:
            items.append({
                "id": item.id,
                "name": item.name,
                "auditable_entity_id": item.auditable_entity_id,
                "entity_name": item.auditable_entity.name if item.auditable_entity else None,
                "risk_score": item.risk_score,
                "quarter": item.quarter,
                "scheduled_start": item.scheduled_start.isoformat() if item.scheduled_start else None,
                "scheduled_end": item.scheduled_end.isoformat() if item.scheduled_end else None,
                "budget_days": item.budget_days,
                "framework_id": item.framework_id,
                "framework_name": item.framework.name if item.framework else None,
                "assigned_auditor_id": item.assigned_auditor_id,
                "assigned_auditor_name": item.assigned_auditor.display_name or item.assigned_auditor.username if item.assigned_auditor else None,
                "priority": item.priority,
                "status": item.status,
                "notes": item.notes,
            })
    
    return {
        "id": p.id,
        "tenant_id": p.tenant_id,
        "name": p.name,
        "fiscal_year": p.fiscal_year,
        "description": p.description,
        "status": p.status,
        "approval_status": p.approval_status,
        "approved_by_id": p.approved_by_id,
        "approved_at": p.approved_at.isoformat() if p.approved_at else None,
        "total_budget_days": p.total_budget_days,
        "ai_generated": p.ai_generated,
        "risk_alignment_score": p.risk_alignment_score,
        "created_by_id": p.created_by_id,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "items": items,
        "items_count": len(items),
    }


@router.get("")
def list_audit_plans(
    fiscal_year: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"plans": [], "total": 0}
    
    query = db.query(AuditPlan).options(
        joinedload(AuditPlan.items)
    ).filter(AuditPlan.tenant_id.in_(user_tenants))
    
    if fiscal_year:
        query = query.filter(AuditPlan.fiscal_year == fiscal_year)
    if status:
        query = query.filter(AuditPlan.status == status)
    
    plans = query.order_by(AuditPlan.created_at.desc()).all()
    return {"plans": [serialize_plan(p) for p in plans], "total": len(plans)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_audit_plan(
    data: AuditPlanCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    plan = AuditPlan(
        tenant_id=tenant_id,
        name=data.name,
        fiscal_year=data.fiscal_year,
        description=data.description,
        total_budget_days=data.total_budget_days or 0,
        created_by_id=current_user.id,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan)


@router.post("/generate-from-universe", status_code=status.HTTP_201_CREATED)
def generate_plan_from_universe(
    data: GenerateFromUniverseRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id == tenant_id,
        AuditableEntity.status == "active",
        AuditableEntity.risk_score >= (data.min_risk_score or 0)
    ).order_by(AuditableEntity.risk_score.desc()).all()
    
    if not entities:
        raise HTTPException(status_code=400, detail="No eligible entities found in Audit Universe")
    
    plan_name = data.name or f"Risk-Based Audit Plan FY {data.fiscal_year}"
    plan = AuditPlan(
        tenant_id=tenant_id,
        name=plan_name,
        fiscal_year=data.fiscal_year,
        description=f"Auto-generated from Audit Universe based on risk scores. {len(entities)} entities included.",
        status="draft",
        total_budget_days=data.total_budget_days or len(entities) * 15,
        created_by_id=current_user.id,
    )
    db.add(plan)
    db.flush()
    
    for idx, entity in enumerate(entities):
        risk_rating = entity.risk_rating or "medium"
        if risk_rating in ("critical", "high"):
            quarter = "Q1" if idx % 2 == 0 else "Q2"
            priority = "critical" if risk_rating == "critical" else "high"
        elif risk_rating == "medium":
            quarter = "Q2" if idx % 2 == 0 else "Q3"
            priority = "medium"
        else:
            quarter = "Q3" if idx % 2 == 0 else "Q4"
            priority = "low"
        
        item = AuditPlanItem(
            plan_id=plan.id,
            auditable_entity_id=entity.id,
            name=f"{entity.name} Audit",
            risk_score=entity.risk_score or 0,
            quarter=quarter,
            budget_days=15 if risk_rating in ("critical", "high") else 10,
            priority=priority,
            status="planned",
        )
        db.add(item)
    
    risk_scores = [e.risk_score or 0 for e in entities]
    plan.risk_alignment_score = round(sum(risk_scores) / len(risk_scores), 1) if risk_scores else 0
    
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan)


@router.get("/{plan_id}")
def get_audit_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).options(
        joinedload(AuditPlan.items)
    ).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return serialize_plan(plan)


@router.put("/{plan_id}")
def update_audit_plan(
    plan_id: int,
    data: AuditPlanUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(plan, field, value)
    
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan)


@router.post("/{plan_id}/approve")
def approve_audit_plan(
    plan_id: int,
    data: PlanApprovalRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    if data.action == "approve":
        plan.approval_status = "approved"
        plan.status = "approved"
        plan.approved_by_id = current_user.id
        plan.approved_at = datetime.utcnow()
    elif data.action == "reject":
        plan.approval_status = "rejected"
        plan.status = "draft"
    elif data.action == "submit":
        plan.approval_status = "pending_review"
        plan.status = "under_review"
    
    plan.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(plan)
    return serialize_plan(plan)


@router.post("/{plan_id}/items", status_code=status.HTTP_201_CREATED)
def add_plan_item(
    plan_id: int,
    data: PlanItemCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    item = AuditPlanItem(
        plan_id=plan_id,
        auditable_entity_id=data.auditable_entity_id,
        name=data.name,
        risk_score=data.risk_score or 0,
        quarter=data.quarter,
        scheduled_start=data.scheduled_start,
        scheduled_end=data.scheduled_end,
        budget_days=data.budget_days or 0,
        framework_id=data.framework_id,
        assigned_auditor_id=data.assigned_auditor_id,
        priority=data.priority,
        notes=data.notes,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    
    return {"id": item.id, "name": item.name, "status": item.status}


@router.put("/{plan_id}/items/{item_id}")
def update_plan_item(
    plan_id: int,
    item_id: int,
    data: PlanItemUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    item = db.query(AuditPlanItem).filter(
        AuditPlanItem.id == item_id,
        AuditPlanItem.plan_id == plan_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Plan item not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(item, field, value)
    
    db.commit()
    db.refresh(item)
    return {"id": item.id, "name": item.name, "status": item.status}


@router.delete("/{plan_id}/items/{item_id}")
def delete_plan_item(
    plan_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    item = db.query(AuditPlanItem).filter(
        AuditPlanItem.id == item_id,
        AuditPlanItem.plan_id == plan_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Plan item not found")
    
    db.delete(item)
    db.commit()
    return {"message": "Plan item deleted"}


@router.get("/{plan_id}/calendar")
def get_plan_calendar(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).options(
        joinedload(AuditPlan.items)
    ).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    calendar_items = []
    for item in plan.items:
        calendar_items.append({
            "id": item.id,
            "title": item.name,
            "start": item.scheduled_start.isoformat() if item.scheduled_start else None,
            "end": item.scheduled_end.isoformat() if item.scheduled_end else None,
            "quarter": item.quarter,
            "priority": item.priority,
            "status": item.status,
            "auditor": (item.assigned_auditor.display_name or item.assigned_auditor.username) if item.assigned_auditor else "Unassigned",
            "budget_days": item.budget_days,
        })
    
    return {"plan_id": plan_id, "fiscal_year": plan.fiscal_year, "calendar": calendar_items}


@router.get("/regulatory-impact")
def get_regulatory_impact_on_audit_plans(
    plan_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"summary": {}, "impacts": [], "pending_feed_items": {"total": 0}}

    plans_query = db.query(AuditPlan).options(
        joinedload(AuditPlan.items).joinedload(AuditPlanItem.auditable_entity)
    ).filter(AuditPlan.tenant_id.in_(user_tenants))
    if plan_id:
        plans_query = plans_query.filter(AuditPlan.id == plan_id)
    plans = plans_query.all()

    changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(user_tenants),
        RegulatoryChange.status.in_(["identified", "under_assessment", "implementation"])
    ).order_by(RegulatoryChange.priority.desc(), RegulatoryChange.created_at.desc()).all()

    pending_feed_new = db.query(func.count(RegulatoryFeedItem.id)).filter(
        RegulatoryFeedItem.tenant_id.in_(user_tenants),
        RegulatoryFeedItem.status == "new"
    ).scalar() or 0

    pending_feed_processed_unmapped = db.query(func.count(RegulatoryFeedItem.id)).filter(
        RegulatoryFeedItem.tenant_id.in_(user_tenants),
        RegulatoryFeedItem.status == "processed",
        RegulatoryFeedItem.regulatory_change_id.is_(None)
    ).scalar() or 0

    client = get_openai_client()
    impacts = []

    for change in changes:
        change_text = f"{change.title or ''} {change.description or ''} {change.regulation_reference or ''}"
        affected_items = []

        for plan in plans:
            for item in (plan.items or []):
                plan_text = " ".join([
                    item.name or "",
                    item.notes or "",
                    item.priority or "",
                    item.auditable_entity.name if item.auditable_entity else "",
                    item.auditable_entity.description if item.auditable_entity and item.auditable_entity.description else "",
                ])
                score = _keyword_score(change_text, plan_text)
                if score > 0:
                    affected_items.append({
                        "plan_id": plan.id,
                        "plan_name": plan.name,
                        "plan_item_id": item.id,
                        "plan_item_name": item.name,
                        "match_score": score,
                    })

        affected_items = sorted(affected_items, key=lambda x: x["match_score"], reverse=True)[:8]

        ai_recommendation = None
        if client and affected_items:
            try:
                completion = client.chat.completions.create(
                    model="gpt-4o",
                    temperature=0.2,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are an internal audit planning assistant. Return strict JSON with keys: impact_level, rationale, suggested_actions (array)."
                        },
                        {
                            "role": "user",
                            "content": f"Regulatory change: {change.title}\nDescription: {change.description or ''}\nPriority: {change.priority}\nAffected audit plan items: {json.dumps(affected_items)}"
                        },
                    ],
                )
                ai_recommendation = json.loads((completion.choices[0].message.content or "{}").strip())
            except Exception as exc:
                logger.warning(f"Regulatory plan impact AI fallback: {exc}")

        if affected_items or change.priority in ["critical", "high"]:
            impacts.append({
                "regulatory_change_id": change.id,
                "title": change.title,
                "priority": change.priority,
                "status": change.status,
                "effective_date": change.effective_date.isoformat() if change.effective_date else None,
                "affected_plan_items": affected_items,
                "impact_level": (ai_recommendation or {}).get("impact_level") or ("high" if change.priority in ["critical", "high"] else "medium"),
                "rationale": (ai_recommendation or {}).get("rationale") or "Regulatory requirement potentially alters audit scope/timing.",
                "suggested_actions": (ai_recommendation or {}).get("suggested_actions") or [
                    "Review audit scope against new regulation",
                    "Adjust testing procedures for impacted controls",
                    "Re-prioritize impacted plan items",
                ],
            })

    return {
        "summary": {
            "total_changes_considered": len(changes),
            "changes_with_plan_impact": len(impacts),
            "high_priority_changes": len([c for c in changes if c.priority in ["critical", "high"]]),
            "plans_considered": len(plans),
        },
        "pending_feed_items": {
            "new": pending_feed_new,
            "processed_unmapped": pending_feed_processed_unmapped,
            "total": pending_feed_new + pending_feed_processed_unmapped,
        },
        "impacts": impacts,
    }


@router.delete("/{plan_id}")
def delete_audit_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    plan = db.query(AuditPlan).filter(
        AuditPlan.id == plan_id,
        AuditPlan.tenant_id.in_(user_tenants)
    ).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    db.delete(plan)
    db.commit()
    return {"message": "Plan deleted"}
