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


def _is_owner_scoped(current_user: GRCUser, tenant_id: int, db: Session) -> bool:
    """A user is owner-scoped (sees only their own assets) if NONE of
    their tenant roles grant tenant-wide visibility.

    Adapted to our DB-per-tenant architecture: the original package
    helper raw-SQL'd against ``{schema}.users`` (Postgres schema-per-
    tenant), which doesn't exist for us. Even though the inner SELECT
    was wrapped in try/except, the Postgres transaction was left
    ABORTED — every subsequent query in the request died with
    ``current transaction is aborted, commands ignored until end of
    transaction block``. That manifested as a 500 on every
    `/risk-posture/dashboard` load after the silent rollback.

    The DB-per-tenant equivalent: query our ORM-managed `UserRole` /
    `Role` tables directly. Same end result (tenant-wide role names),
    no raw SQL, no schema gymnastics. Falls back to owner-scoped
    (return True) if anything goes wrong so we never accidentally
    leak tenant-wide data to a Banking User.
    """
    try:
        from grc.models import UserRole, Role
        role_names = [
            r[0] for r in (
                db.query(Role.name)
                .join(UserRole, UserRole.role_id == Role.id)
                .filter(UserRole.user_id == current_user.id)
                .all()
            )
        ]
    except Exception:  # noqa: BLE001
        # Defensive: any DB error here defaults to owner-scoped so an
        # unknown role state doesn't accidentally expose the tenant
        # estate. Roll back the session first so subsequent queries in
        # this request still work.
        try:
            db.rollback()
        except Exception:
            pass
        return True
    if not role_names:
        return True
    return not any(r in {"Administrator", "Auditor", "Scanning Admin"} for r in role_names)


@router.get("/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Tenant-wide unified risk posture. Returns per-asset rows ordered
    by composite score (highest risk first) plus rollup stats.

    Banking-User-style roles are owner-scoped: they see only assets they
    own. Administrator / Scanning Admin / Auditor see the whole estate.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    owner_id = current_user.id if _is_owner_scoped(current_user, tenant_id, db) else None
    return compute_tenant_posture(db, tenant_id, owner_id=owner_id)


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
    # A GET must not mutate. With persist=True this endpoint rewrote
    # effective_risk_score on every linked vulnerability and committed — and
    # now the asset-detail Risk & Controls card calls it on every open, so a
    # plain page view was rewriting vuln rows. The tenant dashboard sweep still
    # persists (warming the cache); a single read stays read-only.
    return compute_asset_risk(db, tenant_id, asset, persist=False)


# ─── Risk Posture v2: live preview ─────────────────────────────────────
# The Business Context panel on /assets/[id] needs to show "if you save
# these toggles your overall risk would change from X → Y" BEFORE the
# operator commits. This endpoint takes the proposed values, computes
# the dimension scores as if the asset had them saved, and returns the
# would-be score — without persisting anything.
from pydantic import BaseModel as _PreviewBaseModel


class BusinessContextProposal(_PreviewBaseModel):
    is_customer_facing: Optional[bool] = None
    is_internet_facing: Optional[bool] = None
    regulated_data_type: Optional[str] = None     # 'none' | 'pii' | 'pci' | 'phi' | 'financial'
    operational_dependency: Optional[str] = None  # 'low' | 'medium' | 'high' | 'critical'


@router.post("/asset/{asset_id}/preview")
def preview_asset_posture(
    asset_id: int,
    proposal: BusinessContextProposal,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Return the would-be risk posture if these business-context values
    were saved on the asset. Read-only: nothing is persisted, no
    audit-log entry is created. The "before" object is what the asset
    currently scores; "after" is the recompute with the proposal applied.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    asset = (
        db.query(ITAsset)
        .filter(ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id)
        .first()
    )
    if not asset:
        raise HTTPException(404, "Asset not found in this tenant")

    # Capture pre-state — the current saved score is the baseline. We
    # call the existing compute path which already returns score/band/
    # components fully shaped. `persist=False` keeps this preview
    # honest: no commits to grc_vulnerabilities, no audit-log writes
    # per keystroke. The original `compute_asset_risk` was writing on
    # every preview tick — see service.py:_vuln_score for the new gate.
    before = compute_asset_risk(db, tenant_id, asset, persist=False)

    # Snapshot the asset's current values so we can restore them. Then
    # mutate the asset object in-memory ONLY (no commit), recompute,
    # restore. This is the safest way to reuse the existing scoring
    # pipeline without forking it for previews.
    # NOTE on column naming — see service.py:339-345. The v2 plan used
    # `operational_dependency` but our ITAsset already had that column
    # (Integer 1-4 from Criticality Assessments), so we renamed the v2
    # business-impact column to `op_dep_business_impact`. The wire field
    # `proposal.operational_dependency` keeps the v2 spec name for the
    # Pydantic body, but it maps to the renamed asset attribute.
    snapshot = {
        "is_customer_facing":     asset.is_customer_facing,
        "is_internet_facing":     asset.is_internet_facing,
        "regulated_data_type":    asset.regulated_data_type,
        "op_dep_business_impact": asset.op_dep_business_impact,
    }
    if proposal.is_customer_facing is not None:
        asset.is_customer_facing = proposal.is_customer_facing
    if proposal.is_internet_facing is not None:
        asset.is_internet_facing = proposal.is_internet_facing
    if proposal.regulated_data_type is not None:
        asset.regulated_data_type = proposal.regulated_data_type
    if proposal.operational_dependency is not None:
        asset.op_dep_business_impact = proposal.operational_dependency

    try:
        # persist=False, matching the `before` call above and this endpoint's own
        # docstring. It was omitted here, so it defaulted to True and the preview
        # committed — writing every linked vuln's effective_risk_* columns AND
        # the user's *unsaved* form values onto the asset row, on every toggle,
        # because the panel refetches with staleTime: 0.
        #
        # The old workaround restored the snapshot and committed again to undo
        # it. That is no longer needed: with nothing written, there is nothing to
        # roll back. The in-memory mutations above are discarded when the session
        # closes, but the snapshot restore stays as cheap insurance against this
        # request object being reused later in the handler.
        after = compute_asset_risk(db, tenant_id, asset, persist=False)
    finally:
        for k, v in snapshot.items():
            setattr(asset, k, v)

    before_eff = (before.get("components") or {}).get("vuln", {}).get("effective_risk") or {}
    after_eff  = (after.get("components")  or {}).get("vuln", {}).get("effective_risk") or {}

    def _strip(eff: dict) -> dict:
        """Carry enough per-vuln data for the right-pane re-score list AND
        for the per-vuln breakdown cards to re-render their weighted
        equation when the operator is mid-preview. Fields below match what
        the per-vuln cards on the page already consume from the posture
        endpoint, so the frontend can use the same component."""
        return {
            "best_score": eff.get("best_score"),
            "per_vuln": [
                {
                    "vuln_id": p.get("vuln_id"),
                    "cve_id": p.get("cve_id"),
                    "score": p.get("score"),
                    "band": p.get("band"),
                    "escalated": p.get("escalated"),
                    "title": p.get("title"),
                    "severity": p.get("severity"),
                    "cvss_score": p.get("cvss_score"),
                    "epss_score": p.get("epss_score"),
                    "kev_flag": p.get("kev_flag"),
                    "contributions": p.get("contributions"),
                    "business_impact_factor": p.get("business_impact_factor"),
                    "reason": p.get("reason"),
                }
                for p in (eff.get("per_vuln") or [])
            ],
        }

    return {
        "before": {
            "score": before.get("score"),
            "band": before.get("band"),
            "vuln_score": (before.get("components") or {}).get("vuln", {}).get("score"),
        },
        "after": {
            "score": after.get("score"),
            "band": after.get("band"),
            "vuln_score": (after.get("components") or {}).get("vuln", {}).get("score"),
            "effective_risk": after_eff,
        },
        "before_effective": _strip(before_eff),
        "after_effective":  _strip(after_eff),
        "delta": round(
            (after.get("score") or 0) - (before.get("score") or 0),
            2,
        ),
    }


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
    """Tenant Admin updates this tenant's risk-weight overrides.

    Tune Weights changes the scoring formula for the entire tenant. Only the
    Administrator role can change it — Scanning Admin / Auditor / Banking
    User can read but not modify. Frontend hides the Tune Weights button for
    non-admins; this server check is the defence-in-depth gate.

    Total must equal 100% ±0.5 (extra tolerance for slider rounding).
    Audited via `updated_by` so we can show "Last changed by X at Y".
    """
    # RBAC gate — Administrator role only.
    # Tune Weights changes the scoring formula for the entire tenant. The
    # frontend hides the button for non-admins; this server check is the
    # defence-in-depth gate. We resolve the user's tenant-scoped roles by
    # querying the tenant schema's `roles` + `user_roles` directly, since
    # the public-schema GRCUser ORM doesn't carry them.
    tenant_id = get_user_primary_tenant(current_user, db)
    from sqlalchemy import text
    tenant_row = db.execute(text("SELECT slug FROM grc_tenants WHERE id=:tid"),
                            {"tid": tenant_id}).fetchone()
    if not tenant_row:
        raise HTTPException(403, "Tenant context not found")
    schema = "tenant_" + tenant_row[0].replace("-", "")
    # Match by email — grc_users.id and tenant_<slug>.users.id are
    # independent sequences, so we join via email which is unique in both.
    is_admin = db.execute(
        text(
            f"SELECT 1 FROM {schema}.users u "
            f"JOIN {schema}.user_roles ur ON ur.user_id = u.id "
            f"JOIN {schema}.roles r ON r.id = ur.role_id "
            f"WHERE u.email = :email AND r.name = 'Administrator' LIMIT 1"
        ),
        {"email": current_user.email},
    ).fetchone()
    if not is_admin:
        raise HTTPException(403, "Only Tenant Administrators can change risk weights.")

    total = (body.weight_cis + body.weight_vuln + body.weight_cia
             + body.weight_ctrl + body.weight_risk)
    if abs(total - 100.0) > 0.5:
        raise HTTPException(
            400,
            f"Weights must sum to 100% (got {total:.2f}%). "
            f"Adjust one dimension up/down before saving.",
        )

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
