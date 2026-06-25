"""Generic AI-recommendation store endpoints.

Lets any module SAVE an AI recommendation (after the user reviews it) so it
persists per tenant and every user with module access sees the same saved
output. Keyed by (module, entity_type, entity_id, recommendation_type) — saving
again for the same key upserts.
"""
import logging
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..models import AIRecommendation, GRCUser, get_db
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/ai-recommendations", tags=["AI Recommendations"])
logger = logging.getLogger(__name__)


def _serialize(r: AIRecommendation) -> dict:
    return {
        "id": r.id,
        "tenant_id": r.tenant_id,
        "module": r.module,
        "entity_type": r.entity_type,
        "entity_id": r.entity_id,
        "recommendation_type": r.recommendation_type,
        "title": r.title,
        "summary": r.summary,
        "output": r.output or {},
        "model": r.model,
        "status": r.status,
        "created_by": r.created_by,
        "updated_by": r.updated_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


class SaveRecommendationRequest(BaseModel):
    module: str
    recommendation_type: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    title: Optional[str] = None
    summary: Optional[str] = None
    output: dict = {}
    model: Optional[str] = None


@router.get("")
def list_recommendations(
    module: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    entity_id: Optional[str] = Query(None),
    recommendation_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": []}
    q = db.query(AIRecommendation).filter(AIRecommendation.tenant_id.in_(tenant_ids))
    if module:
        q = q.filter(AIRecommendation.module == module)
    if entity_type:
        q = q.filter(AIRecommendation.entity_type == entity_type)
    if entity_id is not None:
        q = q.filter(AIRecommendation.entity_id == str(entity_id))
    if recommendation_type:
        q = q.filter(AIRecommendation.recommendation_type == recommendation_type)
    rows = q.order_by(AIRecommendation.updated_at.desc()).limit(200).all()
    return {"items": [_serialize(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def save_recommendation(
    payload: SaveRecommendationRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    eid = None if payload.entity_id is None else str(payload.entity_id)
    # Upsert on the natural key so re-saving replaces the prior reviewed output.
    existing = (
        db.query(AIRecommendation)
        .filter(
            AIRecommendation.tenant_id == tenant_id,
            AIRecommendation.module == payload.module,
            AIRecommendation.entity_type == payload.entity_type,
            AIRecommendation.entity_id == eid,
            AIRecommendation.recommendation_type == payload.recommendation_type,
        )
        .first()
    )
    if existing:
        existing.title = payload.title
        existing.summary = payload.summary
        existing.output = payload.output or {}
        existing.model = payload.model
        existing.status = "saved"
        existing.updated_by = current_user.id
        existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return _serialize(existing)

    rec = AIRecommendation(
        tenant_id=tenant_id,
        module=payload.module,
        entity_type=payload.entity_type,
        entity_id=eid,
        recommendation_type=payload.recommendation_type,
        title=payload.title,
        summary=payload.summary,
        output=payload.output or {},
        model=payload.model,
        status="saved",
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return _serialize(rec)


@router.delete("/{rec_id}")
def delete_recommendation(
    rec_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    rec = db.query(AIRecommendation).filter(
        AIRecommendation.id == rec_id,
        AIRecommendation.tenant_id.in_(tenant_ids),
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    db.delete(rec)
    db.commit()
    return {"message": "Recommendation deleted"}
