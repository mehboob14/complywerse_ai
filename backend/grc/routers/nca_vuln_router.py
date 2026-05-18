"""NCA Vulnerability Register router."""
import json
import logging
import os
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..models import NcaVulnEntry, Vulnerability, GRCUser, get_db
from .auth_router import require_auth, get_user_primary_tenant


# ─── Bridge to general Vulnerability ────────────────────────────────────────

_NCA_STATUS_TO_GENERAL = {
    "OPEN": "open",
    "IN PROGRESS": "in_progress",
    "ON HOLD": "in_progress",
    "RESOLVED": "resolved",
}

_LEVEL_TO_SEVERITY = {
    "Critical": "critical",
    "High": "high",
    "Medium": "medium",
    "Low": "low",
    "Very Low": "info",
}


def _next_general_vuln_id(tenant_id: int, db: Session) -> str:
    count = db.query(Vulnerability).filter(Vulnerability.tenant_id == tenant_id).count()
    return f"VULN-{count + 1:05d}"


def _ensure_bridged_vulnerability(entry: NcaVulnEntry, db: Session) -> Vulnerability:
    """Create or update the backing general Vulnerability that powers all the
    detail-page tabs (mitigations, assets, controls, departments, workflow,
    escalations, exception, AI analysis). Idempotent — no-ops if up to date.
    """
    risk_level = _calc_risk_level(entry.risk_likelihood, entry.risk_severity) or "Medium"
    severity = _LEVEL_TO_SEVERITY.get(risk_level, "medium")
    general_status = _NCA_STATUS_TO_GENERAL.get((entry.status or "OPEN").upper(), "open")

    # Preserve every NCA template field on the bridged Vulnerability so the
    # general detail page can surface them in a "NCA Template Fields" panel.
    # Owner / Affected Assets are intentionally omitted because those use
    # platform pickers (assigned_to / linked assets) and would be redundant.
    template_fields_payload = {
        "vendor_link":             entry.vendor_link,
        "cve_score":               entry.cve_score,
        "affected_technology":     entry.affected_technology,
        "affected_assets_text":    entry.affected_assets,  # raw text label, separate from platform asset links
        "threat_analysis":         entry.threat_analysis,
        "threat_severity":         entry.threat_severity,
        "risk_likelihood":         entry.risk_likelihood,
        "risk_severity":           entry.risk_severity,
        "risk_level":              risk_level,
        "status":                  entry.status,
        "first_observation_date":  entry.first_observation_date.isoformat() if entry.first_observation_date else None,
        "due_date":                entry.due_date.isoformat() if entry.due_date else None,
        "resolution_date":         entry.resolution_date.isoformat() if entry.resolution_date else None,
        "comments":                entry.comments,
        "vuln_identifier":         entry.vuln_identifier,
    }

    bridged_id = getattr(entry, "bridged_vulnerability_id", None)
    bridged: Optional[Vulnerability] = None
    if bridged_id:
        bridged = db.query(Vulnerability).filter(Vulnerability.id == bridged_id).first()

    if bridged is None:
        bridged = Vulnerability(
            tenant_id=entry.tenant_id,
            vuln_id=_next_general_vuln_id(entry.tenant_id, db),
            title=entry.title or entry.vuln_identifier or "(NCA vulnerability)",
            description=entry.description,
            severity=severity,
            cvss_score=entry.cve_score,
            cve_id=entry.cve_number,
            affected_component=entry.affected_technology,
            affected_host=entry.affected_assets,
            recommendation=entry.threat_analysis,
            status=general_status,
            assigned_to=entry.owner_user_id,
            discovered_at=datetime.utcnow(),
            due_date=datetime.combine(entry.due_date, datetime.min.time()) if entry.due_date else None,
            template_type="NCA Template",
            template_fields=template_fields_payload,
        )
        db.add(bridged)
        db.flush()  # populate id
        entry.bridged_vulnerability_id = bridged.id
    else:
        bridged.template_type = "NCA Template"
        # Sync the most-likely-to-change fields
        bridged.title = entry.title or bridged.title
        bridged.description = entry.description if entry.description is not None else bridged.description
        bridged.severity = severity
        bridged.cvss_score = entry.cve_score if entry.cve_score is not None else bridged.cvss_score
        bridged.cve_id = entry.cve_number or bridged.cve_id
        bridged.affected_component = entry.affected_technology or bridged.affected_component
        bridged.affected_host = entry.affected_assets or bridged.affected_host
        bridged.recommendation = entry.threat_analysis if entry.threat_analysis is not None else bridged.recommendation
        bridged.status = general_status
        if entry.owner_user_id is not None:
            bridged.assigned_to = entry.owner_user_id
        if entry.due_date is not None:
            bridged.due_date = datetime.combine(entry.due_date, datetime.min.time())
        bridged.template_fields = template_fields_payload

    # Fan out async enrichment when the bridged row has a CVE-ID. Best
    # effort — broker/redis failure here never blocks the bridge. The daily
    # Celery refresh will pick up anything that slips through.
    if bridged.cve_id:
        _tenant_slug_for_async = None
        try:
            from ..db import MasterSession as _MS
            from ..models import Tenant as _MT
            _m = _MS()
            try:
                _row = _m.query(_MT.slug).filter(_MT.id == entry.tenant_id).first()
            finally:
                _m.close()
            _tenant_slug_for_async = _row[0] if (_row and _row[0]) else None
        except Exception:
            _tenant_slug_for_async = None

        if _tenant_slug_for_async:
            try:
                from ..tasks.vulnerabilities import enrich_vuln as _enrich_vuln_task
                _enrich_vuln_task.delay(
                    tenant_slug=_tenant_slug_for_async, vuln_id=bridged.id
                )
            except Exception:
                # Logged at debug — bridge success is what matters; the daily
                # refresh closes the loop on any missed enrichments.
                pass
            # Phase 6 — same dispatch for vendor patch intelligence.
            try:
                from ..tasks.patch_intel import sync_msrc_vuln as _sync_msrc_task
                _sync_msrc_task.delay(
                    tenant_slug=_tenant_slug_for_async, vuln_id=bridged.id
                )
            except Exception:
                pass

    return bridged

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vulnerabilities/nca", tags=["NCA Vulnerability Register"])

OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


# ─── Schemas ─────────────────────────────────────────────────────────────────

class NcaVulnEntryIn(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    vendor_link: Optional[str] = None
    cve_number: Optional[str] = None
    cve_score: Optional[float] = None
    affected_technology: Optional[str] = None
    affected_assets: Optional[str] = None
    threat_analysis: Optional[str] = None
    threat_severity: Optional[int] = None
    risk_likelihood: Optional[int] = None
    risk_severity: Optional[int] = None
    owner: Optional[str] = None
    owner_user_id: Optional[int] = None
    status: Optional[str] = "OPEN"
    first_observation_date: Optional[date] = None
    due_date: Optional[date] = None
    resolution_date: Optional[date] = None
    comments: Optional[str] = None
    linked_asset_ids: Optional[List[int]] = None
    linked_control_ids: Optional[List[int]] = None
    mitigation_actions: Optional[List[Dict[str, Any]]] = None


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _calc_risk_level(likelihood: Optional[int], severity: Optional[int]) -> Optional[str]:
    if not likelihood or not severity:
        return None
    score = likelihood * severity
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
    count = db.query(NcaVulnEntry).filter(NcaVulnEntry.tenant_id == tenant_id).count()
    return f"VULN-{(count + 1):03d}"


def _entry_to_dict(e: NcaVulnEntry) -> Dict[str, Any]:
    return {
        "id": e.id,
        "vuln_identifier": e.vuln_identifier,
        "title": e.title,
        "description": e.description,
        "vendor_link": e.vendor_link,
        "cve_number": e.cve_number,
        "cve_score": e.cve_score,
        "affected_technology": e.affected_technology,
        "affected_assets": e.affected_assets,
        "threat_analysis": e.threat_analysis,
        "threat_severity": e.threat_severity,
        "risk_likelihood": e.risk_likelihood,
        "risk_severity": e.risk_severity,
        "risk_level": _calc_risk_level(e.risk_likelihood, e.risk_severity),
        "owner": e.owner,
        "status": e.status,
        "first_observation_date": e.first_observation_date.isoformat() if e.first_observation_date else None,
        "due_date": e.due_date.isoformat() if e.due_date else None,
        "resolution_date": e.resolution_date.isoformat() if e.resolution_date else None,
        "comments": e.comments,
        "owner_user_id": getattr(e, "owner_user_id", None),
        "linked_asset_ids": getattr(e, "linked_asset_ids", None) or [],
        "linked_control_ids": getattr(e, "linked_control_ids", None) or [],
        "mitigation_actions": getattr(e, "mitigation_actions", None) or [],
        "bridged_vulnerability_id": getattr(e, "bridged_vulnerability_id", None),
        "ai_recommendation": e.ai_recommendation,
        "ai_recommendation_generated_at": e.ai_recommendation_generated_at.isoformat() if e.ai_recommendation_generated_at else None,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


def _summary(entries: List[NcaVulnEntry]) -> Dict[str, int]:
    counts = {"total": len(entries), "critical": 0, "high": 0, "medium": 0, "low": 0, "very_low": 0, "open": 0, "resolved": 0}
    for e in entries:
        level = _calc_risk_level(e.risk_likelihood, e.risk_severity)
        if level == "Critical":
            counts["critical"] += 1
        elif level == "High":
            counts["high"] += 1
        elif level == "Medium":
            counts["medium"] += 1
        elif level == "Low":
            counts["low"] += 1
        elif level == "Very Low":
            counts["very_low"] += 1
        status = (e.status or "").upper()
        if status == "RESOLVED":
            counts["resolved"] += 1
        else:
            counts["open"] += 1
    return counts


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("")
def list_entries(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entries = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.tenant_id == tenant_id,
    ).order_by(NcaVulnEntry.id.desc()).all()
    return {"entries": [_entry_to_dict(e) for e in entries], "summary": _summary(entries)}


@router.post("")
def create_entry(
    body: NcaVulnEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = NcaVulnEntry(
        tenant_id=tenant_id,
        vuln_identifier=_next_identifier(tenant_id, db),
        **body.model_dump(exclude_unset=True),
    )
    db.add(entry)
    db.flush()
    # Bridge into the general vuln-management system so the user gets the
    # full detail page with mitigations, asset/control/dept links, workflow,
    # escalations, exception handling, AI analysis — exactly like a regular vuln.
    _ensure_bridged_vulnerability(entry, db)
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
    entry = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.id == entry_id,
        NcaVulnEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA vulnerability entry not found")
    # Lazy backfill: legacy entries created before the bridge existed
    if not getattr(entry, "bridged_vulnerability_id", None):
        _ensure_bridged_vulnerability(entry, db)
        db.commit()
        db.refresh(entry)
    return _entry_to_dict(entry)


@router.put("/{entry_id}")
def update_entry(
    entry_id: int,
    body: NcaVulnEntryIn,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.id == entry_id,
        NcaVulnEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA vulnerability entry not found")

    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(entry, k, v)
    entry.updated_at = datetime.utcnow()
    # Keep the bridged Vulnerability in sync with NCA-side edits
    _ensure_bridged_vulnerability(entry, db)
    db.commit()
    db.refresh(entry)
    return _entry_to_dict(entry)


@router.post("/backfill-bridges")
def backfill_all_bridges(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Walk every NCA vuln entry for the tenant and create the backing
    Vulnerability record for any that are missing one. Also re-tags
    template_type='NCA Template' on any bridge that drifted. Idempotent —
    safe to call repeatedly. Used by the frontend after upload + when the
    user toggles to the NCA register so legacy entries appear in the
    template_type filter."""
    tenant_id = get_user_primary_tenant(user, db)
    entries = db.query(NcaVulnEntry).filter(NcaVulnEntry.tenant_id == tenant_id).all()
    bridged = 0
    refreshed = 0
    for entry in entries:
        had_bridge = bool(getattr(entry, "bridged_vulnerability_id", None))
        _ensure_bridged_vulnerability(entry, db)
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
    """Explicitly create or refresh the backing Vulnerability — useful for
    legacy entries or to recover after manual database edits.
    """
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.id == entry_id,
        NcaVulnEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA vulnerability entry not found")
    bridged = _ensure_bridged_vulnerability(entry, db)
    db.commit()
    db.refresh(entry)
    return {"bridged_vulnerability_id": bridged.id, "vuln_id": bridged.vuln_id}


@router.delete("/{entry_id}")
def delete_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(user, db)
    entry = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.id == entry_id,
        NcaVulnEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA vulnerability entry not found")
    bridged_id = getattr(entry, "bridged_vulnerability_id", None)
    if bridged_id:
        bridged = db.query(Vulnerability).filter(
            Vulnerability.id == bridged_id,
            Vulnerability.tenant_id == tenant_id,
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
    entry = db.query(NcaVulnEntry).filter(
        NcaVulnEntry.id == entry_id,
        NcaVulnEntry.tenant_id == tenant_id,
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="NCA vulnerability entry not found")

    if not OPENAI_API_KEY:
        fallback = {
            "summary": "OpenAI API key not configured. Configure AI_INTEGRATIONS_OPENAI_API_KEY to enable AI recommendations.",
            "remediation_steps": [],
            "patching_guidance": "",
            "compensating_controls": [],
            "verification_steps": [],
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

        prompt = f"""You are a senior vulnerability remediation engineer.

Vulnerability: {entry.vuln_identifier}
Title: {entry.title or 'N/A'}
Description: {entry.description or 'N/A'}
CVE: {entry.cve_number or 'N/A'} (Score: {entry.cve_score})
Affected technology: {entry.affected_technology or 'N/A'}
Affected assets: {entry.affected_assets or 'N/A'}
Threat analysis: {entry.threat_analysis or 'N/A'}
Risk likelihood/severity: {entry.risk_likelihood}/{entry.risk_severity}

Return strict JSON with keys:
- summary (2-3 sentences on the vulnerability and recommended response)
- remediation_steps (array of 3-6 ordered remediation steps)
- patching_guidance (string with specific patching/upgrade instructions)
- compensating_controls (array of 2-4 controls to apply if patching is delayed)
- verification_steps (array of 2-4 verification steps post-remediation)
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
        logger.exception("NCA vulnerability AI generation failed")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {exc}")
