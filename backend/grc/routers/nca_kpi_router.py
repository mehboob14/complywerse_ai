"""NCA Cybersecurity KPI/KRI Report Template router.

Captures the NCA Saudi "Key Performance Indicator Report Template" data — both
the KPI definitions and the quarterly measurement targets/actuals — under a
single flat table so the user can upload the template Excel as-is and edit
everything in one form.
"""
from ..config import get_openai_api_key, get_openai_model

import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import NcaKpiEntry, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risks/nca-kpi", tags=["NCA KPI Report"])

OPENAI_API_KEY = get_openai_api_key()
OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


# ─── Schemas ─────────────────────────────────────────────────────────────────

class NcaKpiEntryIn(BaseModel):
    cybersecurity_domain: Optional[str] = None
    kpi_name: Optional[str] = None
    kpi_description: Optional[str] = None
    kpi_definition: Optional[str] = None
    kpi_type: Optional[str] = None
    frequency: Optional[str] = None
    data_source: Optional[str] = None
    reporting_year: Optional[int] = None
    prior_year_q4_actual: Optional[float] = None
    q1_target: Optional[float] = None
    q1_actual: Optional[float] = None
    q1_notes: Optional[str] = None
    q2_target: Optional[float] = None
    q2_actual: Optional[float] = None
    q2_notes: Optional[str] = None
    q3_target: Optional[float] = None
    q3_actual: Optional[float] = None
    q3_notes: Optional[str] = None
    q4_target: Optional[float] = None
    q4_actual: Optional[float] = None
    q4_notes: Optional[str] = None
    owner_user_id: Optional[int] = None
    linked_risk_ids: Optional[List[int]] = None
    linked_control_ids: Optional[List[int]] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _next_identifier(tenant_id: int, db: Session) -> str:
    count = db.query(NcaKpiEntry).filter(NcaKpiEntry.tenant_id == tenant_id).count()
    return f"KPI-{(count + 1):03d}"


def _entry_to_dict(e: NcaKpiEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "kpi_identifier": e.kpi_identifier,
        "cybersecurity_domain": e.cybersecurity_domain,
        "kpi_name": e.kpi_name,
        "kpi_description": e.kpi_description,
        "kpi_definition": e.kpi_definition,
        "kpi_type": e.kpi_type,
        "frequency": e.frequency,
        "data_source": e.data_source,
        "reporting_year": e.reporting_year,
        "prior_year_q4_actual": e.prior_year_q4_actual,
        "q1_target": e.q1_target,
        "q1_actual": e.q1_actual,
        "q1_notes": e.q1_notes,
        "q2_target": e.q2_target,
        "q2_actual": e.q2_actual,
        "q2_notes": e.q2_notes,
        "q3_target": e.q3_target,
        "q3_actual": e.q3_actual,
        "q3_notes": e.q3_notes,
        "q4_target": e.q4_target,
        "q4_actual": e.q4_actual,
        "q4_notes": e.q4_notes,
        "owner_user_id": e.owner_user_id,
        "linked_risk_ids": e.linked_risk_ids or [],
        "linked_control_ids": e.linked_control_ids or [],
        "ai_recommendation": e.ai_recommendation,
        "ai_recommendation_generated_at": e.ai_recommendation_generated_at.isoformat() if e.ai_recommendation_generated_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _summary(entries: List[NcaKpiEntry]) -> Dict[str, Any]:
    total = len(entries)
    domains = sorted({e.cybersecurity_domain for e in entries if e.cybersecurity_domain})
    on_track = 0
    behind = 0
    for e in entries:
        # On-track if the latest available actual hits or beats target
        for q in (4, 3, 2, 1):
            target = getattr(e, f"q{q}_target")
            actual = getattr(e, f"q{q}_actual")
            if target is not None and actual is not None:
                if actual >= target:
                    on_track += 1
                else:
                    behind += 1
                break
    return {
        "total": total,
        "domains": len(domains),
        "on_track": on_track,
        "behind": behind,
    }


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
def list_entries(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entries = db.query(NcaKpiEntry).filter(
        NcaKpiEntry.tenant_id == tenant_id,
    ).order_by(NcaKpiEntry.id.desc()).all()
    return {"entries": [_entry_to_dict(e) for e in entries], "summary": _summary(entries)}


@router.post("")
def create_entry(
    body: NcaKpiEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = NcaKpiEntry(
        tenant_id=tenant_id,
        kpi_identifier=_next_identifier(tenant_id, db),
        **body.model_dump(exclude_unset=True),
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.get("/{entry_id}")
def get_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaKpiEntry).filter(
        NcaKpiEntry.id == entry_id,
        NcaKpiEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA KPI entry not found")
    return _entry_to_dict(entry)


@router.put("/{entry_id}")
def update_entry(
    entry_id: int,
    body: NcaKpiEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaKpiEntry).filter(
        NcaKpiEntry.id == entry_id,
        NcaKpiEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA KPI entry not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaKpiEntry).filter(
        NcaKpiEntry.id == entry_id,
        NcaKpiEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA KPI entry not found")
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
    entry = db.query(NcaKpiEntry).filter(
        NcaKpiEntry.id == entry_id,
        NcaKpiEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA KPI entry not found")

    if not OPENAI_API_KEY:
        fallback = {
            "summary": "OpenAI API key not configured.",
            "trend_analysis": [],
            "recommended_actions": [],
        }
        entry.ai_recommendation = json.dumps(fallback)
        entry.ai_recommendation_generated_at = datetime.utcnow()
        db.commit()
        return {"recommendation": fallback, "generated_at": entry.ai_recommendation_generated_at.isoformat()}

    try:
        from openai import OpenAI
        kwargs: Dict[str, Any] = {"api_key": OPENAI_API_KEY}
        if OPENAI_BASE_URL:
            kwargs["base_url"] = OPENAI_BASE_URL
        client = OpenAI(**kwargs)

        prompt = f"""You are a senior cybersecurity performance analyst reviewing a KPI from an NCA Saudi KPI Report.

KPI: {entry.kpi_name or '(unnamed)'}
Domain: {entry.cybersecurity_domain or 'N/A'}
Definition: {entry.kpi_definition or 'N/A'}
Type: {entry.kpi_type or 'N/A'} | Frequency: {entry.frequency or 'N/A'}
Data source: {entry.data_source or 'N/A'}

Measurements (target / actual):
  Prior Year Q4 Actual: {entry.prior_year_q4_actual}
  Q1: {entry.q1_target} / {entry.q1_actual}
  Q2: {entry.q2_target} / {entry.q2_actual}
  Q3: {entry.q3_target} / {entry.q3_actual}
  Q4: {entry.q4_target} / {entry.q4_actual}

Return strict JSON with keys:
- summary (2-3 sentences on the trend)
- trend_analysis (array of 3-5 specific observations comparing quarters and target adherence)
- recommended_actions (array of 3-5 actions to improve or sustain this KPI)
- target_adjustment_advice (string — should the next-quarter target change?)
"""

        completion = client.chat.completions.create(
            model=get_openai_model(),
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
        logger.exception("NCA KPI AI generation failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
