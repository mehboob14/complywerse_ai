"""NCA Cybersecurity Risk Management register router."""
import json
import logging
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import NcaRiskEntry, Risk, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant


# ─── Bridge to general Risk ─────────────────────────────────────────────────

_NCA_LIFECYCLE_TO_GENERAL_STATUS = {
    "open":         "open",
    "in_progress":  "in_treatment",
    "mitigated":    "mitigated",
    "accepted":     "accepted",
    "closed":       "closed",
}

_RATING_TO_CATEGORY = "operational"  # NCA template doesn't carry an ERM category — default it


def _ensure_bridged_risk(entry: NcaRiskEntry, db: Session) -> Risk:
    inherent_score = (
        (entry.inherent_likelihood or 0) * (entry.inherent_impact or 0)
        if entry.inherent_likelihood and entry.inherent_impact else None
    )
    residual_score = (
        (entry.residual_likelihood or 0) * (entry.residual_impact or 0)
        if entry.residual_likelihood and entry.residual_impact else None
    )
    lifecycle = (entry.lifecycle_status or "open").lower()
    general_status = _NCA_LIFECYCLE_TO_GENERAL_STATUS.get(lifecycle, "open")

    bridged_id = getattr(entry, "bridged_risk_id", None)
    bridged: Optional[Risk] = None
    if bridged_id:
        bridged = db.query(Risk).filter(Risk.id == bridged_id).first()

    title = (entry.description or entry.risk_identifier or "(NCA risk)")[:255]

    template_fields_payload = {
        "risk_identifier":            entry.risk_identifier,
        "risk_area":                  entry.risk_area,
        "date_identified":            entry.date_identified.isoformat() if entry.date_identified else None,
        "risk_cause":                 entry.risk_cause,
        "threat":                     entry.threat,
        "risk_analysis":              entry.risk_analysis,
        "date_analysis":              entry.date_analysis.isoformat() if entry.date_analysis else None,
        "inherent_likelihood":        entry.inherent_likelihood,
        "inherent_impact":            entry.inherent_impact,
        "inherent_rating_override":   entry.inherent_rating_override,
        "treatment_type":             entry.treatment_type,
        "treatment_description":      entry.treatment_description,
        "treatment_deadline":         entry.treatment_deadline.isoformat() if entry.treatment_deadline else None,
        "residual_description":       entry.residual_description,
        "residual_likelihood":        entry.residual_likelihood,
        "residual_impact":            entry.residual_impact,
        "following_steps":            entry.following_steps,
        "last_evaluation_date":       entry.last_evaluation_date.isoformat() if entry.last_evaluation_date else None,
        "comment":                    entry.comment,
        "lifecycle_status":           entry.lifecycle_status,
    }

    if bridged is None:
        bridged = Risk(
            tenant_id=entry.tenant_id,
            title=title,
            description=entry.description,
            category=_RATING_TO_CATEGORY,
            risk_category=_RATING_TO_CATEGORY,
            register_type="NCA Template",
            owner_id=entry.risk_owner_user_id,
            inherent_likelihood=entry.inherent_likelihood,
            inherent_impact=entry.inherent_impact,
            inherent_score=float(inherent_score) if inherent_score else None,
            residual_likelihood=entry.residual_likelihood,
            residual_impact=entry.residual_impact,
            residual_score=float(residual_score) if residual_score else None,
            status=general_status,
            treatment_plan=entry.treatment_description,
            due_date=datetime.combine(entry.treatment_deadline, datetime.min.time()) if entry.treatment_deadline else None,
            review_date=datetime.combine(entry.last_evaluation_date, datetime.min.time()) if entry.last_evaluation_date else None,
            template_fields=template_fields_payload,
        )
        db.add(bridged)
        db.flush()
        entry.bridged_risk_id = bridged.id
    else:
        bridged.register_type = "NCA Template"
        bridged.title = title
        bridged.description = entry.description if entry.description is not None else bridged.description
        if entry.risk_owner_user_id is not None:
            bridged.owner_id = entry.risk_owner_user_id
        bridged.inherent_likelihood = entry.inherent_likelihood
        bridged.inherent_impact = entry.inherent_impact
        bridged.inherent_score = float(inherent_score) if inherent_score else None
        bridged.residual_likelihood = entry.residual_likelihood
        bridged.residual_impact = entry.residual_impact
        bridged.residual_score = float(residual_score) if residual_score else None
        bridged.status = general_status
        if entry.treatment_description is not None:
            bridged.treatment_plan = entry.treatment_description
        if entry.treatment_deadline is not None:
            bridged.due_date = datetime.combine(entry.treatment_deadline, datetime.min.time())
        if entry.last_evaluation_date is not None:
            bridged.review_date = datetime.combine(entry.last_evaluation_date, datetime.min.time())
        bridged.template_fields = template_fields_payload
    return bridged


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risks/nca", tags=["NCA Risk Register"])

OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


# ─── Schemas ─────────────────────────────────────────────────────────────────

class NcaRiskEntryIn(BaseModel):
    risk_area: Optional[str] = None
    risk_owner: Optional[str] = None
    risk_owner_user_id: Optional[int] = None
    date_identified: Optional[date] = None
    description: Optional[str] = None
    risk_cause: Optional[str] = None
    threat: Optional[str] = None
    risk_analysis: Optional[str] = None
    date_analysis: Optional[date] = None
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None
    inherent_rating_override: Optional[str] = None
    treatment_type: Optional[str] = None
    treatment_description: Optional[str] = None
    treatment_owner: Optional[str] = None
    treatment_owner_user_id: Optional[int] = None
    treatment_deadline: Optional[date] = None
    residual_description: Optional[str] = None
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    following_steps: Optional[str] = None
    last_evaluation_date: Optional[date] = None
    comment: Optional[str] = None
    linked_asset_ids: Optional[List[int]] = None
    linked_control_ids: Optional[List[int]] = None
    mitigation_actions: Optional[List[Dict[str, Any]]] = None
    lifecycle_status: Optional[str] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _calc_rating(likelihood: Optional[int], impact: Optional[int]) -> Optional[str]:
    if not likelihood or not impact:
        return None
    score = likelihood * impact
    if score >= 20:
        return "Critical"
    if score >= 12:
        return "High"
    if score >= 6:
        return "Medium"
    if score >= 3:
        return "Low"
    return "Very Low"


def _next_identifier(tenant_id: int, db: Session) -> str:
    count = db.query(NcaRiskEntry).filter(NcaRiskEntry.tenant_id == tenant_id).count()
    return f"RISK-{(count + 1):03d}"


def _entry_to_dict(e: NcaRiskEntry) -> Dict[str, Any]:
    inherent_rating = _calc_rating(e.inherent_likelihood, e.inherent_impact)
    residual_rating = _calc_rating(e.residual_likelihood, e.residual_impact)
    return {
        "id": e.id,
        "risk_identifier": e.risk_identifier,
        "risk_area": e.risk_area,
        "risk_owner": e.risk_owner,
        "date_identified": e.date_identified.isoformat() if e.date_identified else None,
        "description": e.description,
        "risk_cause": e.risk_cause,
        "threat": e.threat,
        "risk_analysis": e.risk_analysis,
        "date_analysis": e.date_analysis.isoformat() if e.date_analysis else None,
        "inherent_likelihood": e.inherent_likelihood,
        "inherent_impact": e.inherent_impact,
        "inherent_rating": inherent_rating,
        "inherent_rating_override": e.inherent_rating_override,
        "treatment_type": e.treatment_type,
        "treatment_description": e.treatment_description,
        "treatment_owner": e.treatment_owner,
        "treatment_deadline": e.treatment_deadline.isoformat() if e.treatment_deadline else None,
        "residual_description": e.residual_description,
        "residual_likelihood": e.residual_likelihood,
        "residual_impact": e.residual_impact,
        "residual_rating": residual_rating,
        "following_steps": e.following_steps,
        "last_evaluation_date": e.last_evaluation_date.isoformat() if e.last_evaluation_date else None,
        "comment": e.comment,
        "risk_owner_user_id": getattr(e, "risk_owner_user_id", None),
        "treatment_owner_user_id": getattr(e, "treatment_owner_user_id", None),
        "linked_asset_ids": getattr(e, "linked_asset_ids", None) or [],
        "linked_control_ids": getattr(e, "linked_control_ids", None) or [],
        "mitigation_actions": getattr(e, "mitigation_actions", None) or [],
        "lifecycle_status": getattr(e, "lifecycle_status", None) or "open",
        "bridged_risk_id": getattr(e, "bridged_risk_id", None),
        "ai_recommendation": e.ai_recommendation,
        "ai_recommendation_generated_at": e.ai_recommendation_generated_at.isoformat() if e.ai_recommendation_generated_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _summary(entries: List[NcaRiskEntry]) -> Dict[str, int]:
    counts = {"total": len(entries), "critical": 0, "high": 0, "medium": 0, "low": 0, "very_low": 0, "open_treatment": 0}
    for e in entries:
        rating = _calc_rating(e.inherent_likelihood, e.inherent_impact)
        if rating == "Critical":
            counts["critical"] += 1
        elif rating == "High":
            counts["high"] += 1
        elif rating == "Medium":
            counts["medium"] += 1
        elif rating == "Low":
            counts["low"] += 1
        elif rating == "Very Low":
            counts["very_low"] += 1
        if not e.treatment_type or (e.treatment_type or "").lower() not in {"acceptance"}:
            counts["open_treatment"] += 1
    return counts


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
def list_entries(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entries = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.tenant_id == tenant_id,
    ).order_by(NcaRiskEntry.id.desc()).all()
    return {"entries": [_entry_to_dict(e) for e in entries], "summary": _summary(entries)}


@router.post("")
def create_entry(
    body: NcaRiskEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = NcaRiskEntry(
        tenant_id=tenant_id,
        risk_identifier=_next_identifier(tenant_id, db),
        **body.model_dump(exclude_unset=True),
    )
    db.add(entry)
    db.flush()
    # Bridge into the general ERM system so the NCA risk inherits the full
    # detail page, mitigations, asset/control/dept links, KRIs, reviews, etc.
    _ensure_bridged_risk(entry, db)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


# NOTE — static-path routes MUST be declared BEFORE the `/{entry_id}` routes
# below; otherwise FastAPI tries to parse "by-bridged-risk" or "backfill-bridges"
# as an int entry_id and 422s the request before reaching this handler.

@router.get("/by-bridged-risk/{risk_id}")
def get_by_bridged_risk(
    risk_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Reverse lookup — given a bridged general Risk id, return the source
    NCA risk entry. Used by the Edit flow on the general risk detail page so
    NCA risks open in the NCA template modal (with all NCA fields), not the
    general risk modal.
    """
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.tenant_id == tenant_id,
        NcaRiskEntry.bridged_risk_id == risk_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="No NCA risk entry bridged to this risk")
    return _entry_to_dict(entry)


@router.get("/{entry_id}")
def get_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.id == entry_id,
        NcaRiskEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA risk entry not found")
    # Lazy backfill for legacy rows
    if not getattr(entry, "bridged_risk_id", None):
        _ensure_bridged_risk(entry, db)
        db.commit()
        db.refresh(entry)
    return _entry_to_dict(entry)


@router.put("/{entry_id}")
def update_entry(
    entry_id: int,
    body: NcaRiskEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.id == entry_id,
        NcaRiskEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA risk entry not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    entry.updated_at = datetime.utcnow()
    _ensure_bridged_risk(entry, db)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.post("/backfill-bridges")
def backfill_all_bridges(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Walk every NCA risk entry for the tenant and create the backing Risk
    record for any that are missing one. Also re-tags register_type='NCA
    Template' on any bridge that drifted. Idempotent."""
    tenant_id = get_user_primary_tenant(user, db)
    entries = db.query(NcaRiskEntry).filter(NcaRiskEntry.tenant_id == tenant_id).all()
    bridged = 0
    refreshed = 0
    for entry in entries:
        had_bridge = bool(getattr(entry, "bridged_risk_id", None))
        _ensure_bridged_risk(entry, db)
        if had_bridge:
            refreshed += 1
        else:
            bridged += 1
    db.commit()
    return {"total": len(entries), "newly_bridged": bridged, "refreshed": refreshed}


@router.post("/{entry_id}/bridge")
def force_rebridge(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.id == entry_id,
        NcaRiskEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA risk entry not found")
    bridged = _ensure_bridged_risk(entry, db)
    db.commit()
    db.refresh(entry)
    return {"bridged_risk_id": bridged.id}


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.id == entry_id,
        NcaRiskEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA risk entry not found")
    bridged_id = getattr(entry, "bridged_risk_id", None)
    if bridged_id:
        bridged = db.query(Risk).filter(
            Risk.id == bridged_id,
            Risk.tenant_id == tenant_id,
        ).first()
        if bridged:
            db.delete(bridged)
    db.delete(entry)
    db.commit()
    return {"deleted": True}


@router.post("/{entry_id}/ai-recommendation")
def generate_ai_recommendation(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaRiskEntry).filter(
        NcaRiskEntry.id == entry_id,
        NcaRiskEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA risk entry not found")

    if not OPENAI_API_KEY:
        fallback = {
            "summary": "OpenAI API key not configured. Configure AI_INTEGRATIONS_OPENAI_API_KEY to enable AI recommendations.",
            "treatment_strategy": [],
            "residual_mitigation": [],
            "monitoring": [],
        }
        entry.ai_recommendation = json.dumps(fallback)
        entry.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        return {"recommendation": fallback, "generated_at": entry.ai_recommendation_generated_at.isoformat()}

    try:
        from openai import OpenAI
        kwargs = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            kwargs["base_url"] = OPENAI_BASE_URL
        client = OpenAI(**kwargs)

        prompt = f"""You are a senior cybersecurity risk advisor reviewing an NCA Risk Register entry.

Risk identifier: {entry.risk_identifier}
Risk area: {entry.risk_area or 'N/A'}
Description: {entry.description or 'N/A'}
Threat: {entry.threat or 'N/A'}
Risk cause: {entry.risk_cause or 'N/A'}
Risk analysis: {entry.risk_analysis or 'N/A'}
Inherent likelihood/impact: {entry.inherent_likelihood}/{entry.inherent_impact}
Current treatment type: {entry.treatment_type or 'N/A'}
Current treatment description: {entry.treatment_description or 'N/A'}

Return strict JSON with keys:
- summary (2-3 sentences synthesizing the risk and recommended posture)
- treatment_strategy (array of 3-5 specific treatment actions)
- residual_mitigation (array of 3-5 controls to reduce residual risk)
- monitoring (array of 3-5 monitoring/review activities)
"""

        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        data = json.loads(completion.choices[0].message.content)

        entry.ai_recommendation = json.dumps(data)
        entry.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        return {"recommendation": data, "generated_at": entry.ai_recommendation_generated_at.isoformat()}
    except Exception as exc:
        logger.exception("NCA risk AI generation failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
