"""Risk Posture API — composite asset risk dashboard endpoints."""
from __future__ import annotations

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from grc.models import GRCUser, ITAsset, get_db
from grc.routers.auth_router import get_user_primary_tenant, require_auth

from .service import compute_asset_risk, compute_tenant_posture

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/risk-posture", tags=["Risk Posture"])


@router.get("/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Tenant-wide unified risk posture. Returns per-asset rows ordered
    by composite score (highest risk first) plus rollup stats."""
    tenant_id = get_user_primary_tenant(current_user, db)
    return compute_tenant_posture(db, tenant_id)


@router.get("/asset/{asset_id}")
def get_asset_posture(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Detailed breakdown for a single asset — score, band, and the
    four component sub-scores with raw inputs for the drill-down view."""
    tenant_id = get_user_primary_tenant(current_user, db)
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id)
        .first()
    )
    if not asset:
        raise HTTPException(404, "Asset not found in this tenant")
    return compute_asset_risk(db, tenant_id, asset)


# ─── Per-tenant weight customisation ───────────────────────────────────────

from pydantic import BaseModel, Field

from grc.models import TenantRiskWeights
from .service import DEFAULT_WEIGHTS, resolve_weights_for_tenant


class WeightsPayload(BaseModel):
    """All weights are expressed as PERCENTAGES (0-100). Backend stores
    as percentages and divides by 100 at compute time."""
    weight_cis:  float = Field(ge=0, le=100)
    weight_vuln: float = Field(ge=0, le=100)
    weight_cia:  float = Field(ge=0, le=100)
    weight_ctrl: float = Field(ge=0, le=100)
    weight_risk: float = Field(ge=0, le=100)
    preset_name: Optional[str] = None


# Senior asked for "tunable per-tenant weights" — a single sensible default
# + a slider-only customisation UI. We deliberately do NOT ship named presets
# (Vuln-focused / Compliance-heavy / etc) because each bank's profile is
# unique enough that the operator should think through their own weights
# rather than pick a label off the shelf.
PRESETS = {
    "Banking (default)":  {"cis": 25, "vuln": 30, "cia": 15, "ctrl": 15, "risk": 15},
}


@router.get("/weights")
def get_weights(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Return this tenant's risk-scoring weights + the available presets.

    Always returns a value — never 404 — because there's a sensible
    default. The `is_custom` flag tells the UI whether to highlight
    "Custom" vs one of the named presets.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    row = db.query(TenantRiskWeights).filter(TenantRiskWeights.tenant_id == tenant_id).first()
    if row:
        return {
            "weight_cis":  float(row.weight_cis),
            "weight_vuln": float(row.weight_vuln),
            "weight_cia":  float(row.weight_cia),
            "weight_ctrl": float(row.weight_ctrl),
            "weight_risk": float(row.weight_risk),
            "preset_name": row.preset_name or "Custom",
            "updated_at":  row.updated_at.isoformat() if row.updated_at else None,
            "is_custom":   row.preset_name in (None, "", "Custom"),
            "presets":     PRESETS,
        }
    # Defaults — no row yet
    return {
        "weight_cis":  DEFAULT_WEIGHTS["cis"] * 100,
        "weight_vuln": DEFAULT_WEIGHTS["vuln"] * 100,
        "weight_cia":  DEFAULT_WEIGHTS["cia"] * 100,
        "weight_ctrl": DEFAULT_WEIGHTS["ctrl"] * 100,
        "weight_risk": DEFAULT_WEIGHTS["risk"] * 100,
        "preset_name": "Banking (default)",
        "updated_at":  None,
        "is_custom":   False,
        "presets":     PRESETS,
    }


@router.put("/weights")
def update_weights(
    body: WeightsPayload,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Operator updates this tenant's risk-weight overrides.

    Total must equal 100% ±0.5 (extra tolerance for slider rounding).
    Audited via `updated_by` so we can show "Last changed by X at Y".
    """
    total = (body.weight_cis + body.weight_vuln + body.weight_cia
             + body.weight_ctrl + body.weight_risk)
    if abs(total - 100.0) > 0.5:
        raise HTTPException(
            400,
            f"Weights must sum to 100% (got {total:.2f}%). "
            f"Adjust one dimension up/down before saving.",
        )

    tenant_id = get_user_primary_tenant(current_user, db)
    row = db.query(TenantRiskWeights).filter(TenantRiskWeights.tenant_id == tenant_id).first()
    if not row:
        row = TenantRiskWeights(tenant_id=tenant_id)
        db.add(row)
    row.weight_cis  = body.weight_cis
    row.weight_vuln = body.weight_vuln
    row.weight_cia  = body.weight_cia
    row.weight_ctrl = body.weight_ctrl
    row.weight_risk = body.weight_risk
    row.preset_name = body.preset_name or "Custom"
    row.updated_by  = current_user.id
    db.commit()
    db.refresh(row)
    return {
        "weight_cis":  float(row.weight_cis),
        "weight_vuln": float(row.weight_vuln),
        "weight_cia":  float(row.weight_cia),
        "weight_ctrl": float(row.weight_ctrl),
        "weight_risk": float(row.weight_risk),
        "preset_name": row.preset_name,
        "updated_at":  row.updated_at.isoformat() if row.updated_at else None,
        "updated_by":  row.updated_by,
    }
