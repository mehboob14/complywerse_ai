"""CRQM API — scenario, loss models, simulations, control ROI comparison.

Mounted under /erm (module-level erm:risks:view permission applies). The
material-flag gate lives in the UI only — these endpoints work for any risk
the caller can see, deliberately, so broader coverage later costs nothing.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    AuditLog,
    Risk,
    RiskControlLink,
    RiskLossModel,
    RiskSimulationRun,
    GRCUser,
    get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ..quantification import service as crqm
from ..quantification.engine import DEFAULT_ITERATIONS, MAX_ITERATIONS

# Decision-bearing actions (material flag, model lifecycle, simulations,
# control effects) feed board reporting — they require the same edit
# permission the risk register's own mutations use. Read/contributor roles
# with only erm:risks:view can look, not decide. (A dedicated approve tier
# for activation is a future refinement — no approve-level permission string
# exists in the platform today.)
_edit_perm = Depends(require_tenant_permission("risks:risk_register:edit"))

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quantification", tags=["ERM - Risk Quantification"])


# ── request/response bodies ──────────────────────────────────────────────────

class ScenarioUpdate(BaseModel):
    is_material: Optional[bool] = None
    scenario_actor: Optional[str] = Field(default=None, max_length=200)
    scenario_method: Optional[str] = None
    scenario_effect: Optional[Dict[str, bool]] = None
    scenario_statement: Optional[str] = None


class Triple(BaseModel):
    min: float
    ml: float
    max: float


class LossComponentBody(BaseModel):
    key: Optional[str] = None
    label: str = Field(..., min_length=1, max_length=200)
    kind: str = Field(..., pattern="^(primary|secondary)$")
    min: float
    ml: float
    max: float
    probability: float = Field(default=1.0, ge=0.0, le=1.0)
    rationale: str = Field(..., min_length=1)


class LossModelBody(BaseModel):
    currency: str = Field(default="USD", min_length=3, max_length=3)
    tef: Triple
    pos: Triple
    pos_basis: Optional[str] = None
    components: List[LossComponentBody]
    confidence_pct: Optional[float] = Field(default=None, ge=0, le=100)
    assumptions: Optional[str] = None


class SimulateBody(BaseModel):
    iterations: int = Field(default=DEFAULT_ITERATIONS, ge=100, le=MAX_ITERATIONS)
    seed: Optional[int] = Field(default=None, ge=0)
    control_link_ids: Optional[List[int]] = None


class ComparisonBody(BaseModel):
    iterations: int = Field(default=DEFAULT_ITERATIONS, ge=100, le=MAX_ITERATIONS)
    seed: Optional[int] = Field(default=None, ge=0)
    # Each entry is one option: a set of risk-control-link ids to apply
    # together. Baseline (no controls) always runs first.
    control_sets: List[List[int]] = Field(..., min_length=1, max_length=5)


class ControlEffectBody(BaseModel):
    freq_reduction: Optional[Triple] = None
    mag_reduction: Optional[Triple] = None
    rationale: Optional[str] = None


# ── helpers ──────────────────────────────────────────────────────────────────

def _get_risk_or_404(risk_id: int, user: GRCUser, db: Session) -> Risk:
    tenants = get_user_tenants(user, db)
    risk = db.query(Risk).filter(Risk.id == risk_id, Risk.tenant_id.in_(tenants)).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk


def _get_model_or_404(model_id: int, user: GRCUser, db: Session) -> RiskLossModel:
    tenants = get_user_tenants(user, db)
    m = db.query(RiskLossModel).filter(
        RiskLossModel.id == model_id,
        RiskLossModel.tenant_id.in_(tenants),
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Loss model not found")
    return m


def _audit(db: Session, tenant_id: int, user_id: int, action: str,
           resource_type: str, resource_id: int, detail: Dict[str, Any]) -> None:
    try:
        db.add(AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            changes=detail,
        ))
        db.commit()
    except Exception:  # noqa: BLE001 — auditing must never block the operation
        db.rollback()
        logger.exception("CRQM audit write failed (action=%s)", action)


def _model_to_dict(m: RiskLossModel) -> Dict[str, Any]:
    return {
        "id": m.id,
        "risk_id": m.risk_id,
        "version": m.version,
        "status": m.status,
        "currency": m.currency,
        "tef": {"min": m.tef_min, "ml": m.tef_ml, "max": m.tef_max},
        "pos": {"min": m.pos_min, "ml": m.pos_ml, "max": m.pos_max},
        "pos_basis": m.pos_basis,
        "pos_evidence": m.pos_evidence,
        "components": m.loss_components or [],
        "confidence_pct": m.confidence_pct,
        "assumptions": m.assumptions,
        "created_by_user_id": m.created_by_user_id,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def _run_to_dict(r: RiskSimulationRun, include_curve: bool = True) -> Dict[str, Any]:
    out = {
        "id": r.id,
        "scope": r.scope,
        "risk_id": r.risk_id,
        "loss_model_id": r.loss_model_id,
        "status": r.status,
        "error": r.error,
        "trigger": getattr(r, "trigger", "manual"),
        "iterations": r.iterations,
        "seed": r.seed,
        "engine_version": r.engine_version,
        "currency": r.currency,
        "ale_mean": r.ale_mean,
        "ale_median": r.ale_median,
        "p5": r.p5, "p50": r.p50, "p90": r.p90, "p95": r.p95, "p99": r.p99,
        "controls_scenario": r.controls_scenario,
        "assumptions_snapshot": r.assumptions_snapshot,
        "duration_ms": r.duration_ms,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }
    if include_curve:
        out["lec_points"] = r.lec_points or []
        out["component_contributions"] = r.component_contributions or []
    return out


# ── scenario + material flag ─────────────────────────────────────────────────

@router.get("/risks/{risk_id}/scenario")
def get_scenario(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    risk = _get_risk_or_404(risk_id, current_user, db)
    return {
        "id": risk.id,
        "title": risk.title,
        "is_material": bool(getattr(risk, "is_material", False)),
        "scenario_actor": getattr(risk, "scenario_actor", None),
        "scenario_method": getattr(risk, "scenario_method", None),
        "scenario_effect": getattr(risk, "scenario_effect", None),
        "scenario_statement": getattr(risk, "scenario_statement", None),
    }


@router.put("/risks/{risk_id}/scenario")
def update_scenario(
    risk_id: int,
    body: ScenarioUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    risk = _get_risk_or_404(risk_id, current_user, db)
    changes = {}
    for field in ("is_material", "scenario_actor", "scenario_method",
                  "scenario_effect", "scenario_statement"):
        val = getattr(body, field)
        if val is not None and getattr(risk, field, None) != val:
            changes[field] = {"old": getattr(risk, field, None), "new": val}
            setattr(risk, field, val)
    if changes:
        risk.updated_at = datetime.utcnow()
        db.commit()
        _audit(db, risk.tenant_id, current_user.id, "risk.scenario_updated",
               "risk", risk.id, changes)
    return {
        "id": risk.id,
        "is_material": bool(getattr(risk, "is_material", False)),
        "scenario_actor": getattr(risk, "scenario_actor", None),
        "scenario_method": getattr(risk, "scenario_method", None),
        "scenario_effect": getattr(risk, "scenario_effect", None),
        "scenario_statement": getattr(risk, "scenario_statement", None),
    }


# ── loss models ──────────────────────────────────────────────────────────────

@router.get("/risks/{risk_id}/loss-models")
def list_loss_models(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    risk = _get_risk_or_404(risk_id, current_user, db)
    models = db.query(RiskLossModel).filter(
        RiskLossModel.risk_id == risk.id,
    ).order_by(RiskLossModel.version.desc()).all()
    return {"models": [_model_to_dict(m) for m in models]}


@router.post("/risks/{risk_id}/loss-models", status_code=201)
def create_loss_model(
    risk_id: int,
    body: LossModelBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    risk = _get_risk_or_404(risk_id, current_user, db)
    try:
        crqm.validate_loss_model_payload(
            body.tef.dict(), body.pos.dict(), [c.dict() for c in body.components],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    model = RiskLossModel(
        tenant_id=risk.tenant_id,
        risk_id=risk.id,
        version=crqm.next_version(db, risk.id),
        status="draft",
        currency=body.currency.upper(),
        tef_min=body.tef.min, tef_ml=body.tef.ml, tef_max=body.tef.max,
        pos_min=body.pos.min, pos_ml=body.pos.ml, pos_max=body.pos.max,
        pos_basis=body.pos_basis,
        loss_components=[c.dict() for c in body.components],
        confidence_pct=body.confidence_pct,
        assumptions=body.assumptions,
        created_by_user_id=current_user.id,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    _audit(db, risk.tenant_id, current_user.id, "risk.loss_model_created",
           "risk_loss_model", model.id, {"risk_id": risk.id, "version": model.version})
    return {"model": _model_to_dict(model)}


@router.put("/loss-models/{model_id}")
def update_loss_model(
    model_id: int,
    body: LossModelBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    model = _get_model_or_404(model_id, current_user, db)
    if model.status != "draft":
        raise HTTPException(
            status_code=409,
            detail="Only drafts are editable — active/archived versions are immutable "
                   "audit history. Create a new draft instead.",
        )
    try:
        crqm.validate_loss_model_payload(
            body.tef.dict(), body.pos.dict(), [c.dict() for c in body.components],
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    model.currency = body.currency.upper()
    model.tef_min, model.tef_ml, model.tef_max = body.tef.min, body.tef.ml, body.tef.max
    model.pos_min, model.pos_ml, model.pos_max = body.pos.min, body.pos.ml, body.pos.max
    model.pos_basis = body.pos_basis
    model.loss_components = [c.dict() for c in body.components]
    model.confidence_pct = body.confidence_pct
    model.assumptions = body.assumptions
    model.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(model)
    return {"model": _model_to_dict(model)}


@router.post("/loss-models/{model_id}/activate")
def activate_loss_model(
    model_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    model = _get_model_or_404(model_id, current_user, db)
    try:
        model = crqm.activate_model(db, model, actor_user_id=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    _audit(db, model.tenant_id, current_user.id, "risk.loss_model_activated",
           "risk_loss_model", model.id, {"risk_id": model.risk_id, "version": model.version})
    return {"model": _model_to_dict(model)}


# ── simulations ──────────────────────────────────────────────────────────────

@router.post("/loss-models/{model_id}/simulate")
def simulate_loss_model(
    model_id: int,
    body: SimulateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    model = _get_model_or_404(model_id, current_user, db)
    crqm.sweep_stale_runs(db, model.tenant_id)
    run = crqm.run_risk_simulation(
        db, model,
        iterations=body.iterations,
        seed=body.seed,
        control_link_ids=body.control_link_ids,
        user_id=current_user.id,
        trigger="manual",
    )
    _audit(db, model.tenant_id, current_user.id, "risk.simulation_run",
           "risk_simulation_run", run.id,
           {"risk_id": model.risk_id, "loss_model_id": model.id,
            "status": run.status, "seed": run.seed, "iterations": run.iterations})
    if run.status == "failed":
        raise HTTPException(status_code=422, detail=run.error or "Simulation failed")
    return {"run": _run_to_dict(run)}


@router.post("/risks/{risk_id}/control-comparison")
def control_comparison(
    risk_id: int,
    body: ComparisonBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    """Baseline + one run per control set, same seed for a fair comparison.
    Returns the ROI table inputs: each option's ALE delta vs baseline."""
    risk = _get_risk_or_404(risk_id, current_user, db)
    active = db.query(RiskLossModel).filter(
        RiskLossModel.risk_id == risk.id,
        RiskLossModel.status == "active",
    ).first()
    if not active:
        raise HTTPException(status_code=409, detail="No active loss model for this risk")
    crqm.sweep_stale_runs(db, risk.tenant_id)

    baseline = crqm.run_risk_simulation(
        db, active, iterations=body.iterations, seed=body.seed,
        control_link_ids=None, user_id=current_user.id, trigger="comparison",
    )
    if baseline.status == "failed":
        raise HTTPException(status_code=422, detail=baseline.error or "Baseline simulation failed")

    options = []
    unmodelled: List[int] = []
    for control_set in body.control_sets:
        effects = crqm.build_control_effects(db, risk.id, control_set)
        if not any(e["freq"] or e["mag"] for e in effects):
            unmodelled.append(control_set and control_set[0])
        run = crqm.run_risk_simulation(
            db, active, iterations=body.iterations, seed=baseline.seed,
            control_link_ids=control_set, user_id=current_user.id, trigger="comparison",
        )
        options.append({
            "control_link_ids": control_set,
            "run": _run_to_dict(run, include_curve=True),
            "ale_reduction": round((baseline.ale_mean or 0) - (run.ale_mean or 0), 2)
            if run.status == "completed" else None,
            "has_modelled_effect": any(e["freq"] or e["mag"] for e in effects),
        })

    return {
        "baseline": _run_to_dict(baseline),
        "options": options,
        "note": ("Options without modelled control effects equal the baseline by "
                 "construction — set frequency/magnitude reductions on the control "
                 "link first.") if unmodelled else None,
    }


@router.get("/risks/{risk_id}/runs")
def list_runs(
    risk_id: int,
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    risk = _get_risk_or_404(risk_id, current_user, db)
    crqm.sweep_stale_runs(db, risk.tenant_id)
    runs = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.risk_id == risk.id,
    ).order_by(RiskSimulationRun.created_at.desc()).limit(min(limit, 100)).all()
    return {"runs": [_run_to_dict(r, include_curve=False) for r in runs]}


@router.get("/runs/{run_id}")
def get_run(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenants = get_user_tenants(current_user, db)
    run = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.id == run_id,
        RiskSimulationRun.tenant_id.in_(tenants),
    ).first()
    if not run:
        raise HTTPException(status_code=404, detail="Simulation run not found")
    return {"run": _run_to_dict(run)}


# ── portfolio ────────────────────────────────────────────────────────────────

@router.post("/portfolio/simulate")
def simulate_portfolio_endpoint(
    body: SimulateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    from ....routers.auth_router import get_user_primary_tenant
    tenant_id = get_user_primary_tenant(current_user, db)
    crqm.sweep_stale_runs(db, tenant_id)
    try:
        run = crqm.run_portfolio_simulation(
            db, tenant_id,
            iterations=body.iterations, seed=body.seed, user_id=current_user.id,
        )
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    _audit(db, tenant_id, current_user.id, "risk.portfolio_simulation_run",
           "risk_simulation_run", run.id,
           {"status": run.status, "seed": run.seed, "iterations": run.iterations})
    if run.status == "failed":
        raise HTTPException(status_code=422, detail=run.error or "Portfolio simulation failed")
    return {"run": _run_to_dict(run)}


@router.get("/portfolio/runs")
def list_portfolio_runs(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    from ....routers.auth_router import get_user_primary_tenant
    tenant_id = get_user_primary_tenant(current_user, db)
    crqm.sweep_stale_runs(db, tenant_id)
    runs = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.tenant_id == tenant_id,
        RiskSimulationRun.scope == "portfolio",
    ).order_by(RiskSimulationRun.created_at.desc()).limit(min(limit, 50)).all()
    return {"runs": [_run_to_dict(r) for r in runs]}


# ── control effects ──────────────────────────────────────────────────────────

@router.put("/control-links/{link_id}/effect")
def set_control_effect(
    link_id: int,
    body: ControlEffectBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    tenants = get_user_tenants(current_user, db)
    link = db.query(RiskControlLink).join(Risk, Risk.id == RiskControlLink.risk_id).filter(
        RiskControlLink.id == link_id,
        Risk.tenant_id.in_(tenants),
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Risk-control link not found")

    for name, triple in (("freq_reduction", body.freq_reduction),
                         ("mag_reduction", body.mag_reduction)):
        if triple is not None:
            if not (0 <= triple.min <= triple.ml <= triple.max <= 100):
                raise HTTPException(
                    status_code=422,
                    detail=f"{name}: must satisfy 0 <= min <= most-likely <= max <= 100",
                )

    link.freq_reduction_min_pct = body.freq_reduction.min if body.freq_reduction else None
    link.freq_reduction_ml_pct = body.freq_reduction.ml if body.freq_reduction else None
    link.freq_reduction_max_pct = body.freq_reduction.max if body.freq_reduction else None
    link.mag_reduction_min_pct = body.mag_reduction.min if body.mag_reduction else None
    link.mag_reduction_ml_pct = body.mag_reduction.ml if body.mag_reduction else None
    link.mag_reduction_max_pct = body.mag_reduction.max if body.mag_reduction else None
    link.effect_rationale = body.rationale
    link.effect_updated_by = current_user.id
    link.effect_updated_at = datetime.utcnow()
    db.commit()

    risk = db.query(Risk).filter(Risk.id == link.risk_id).first()
    _audit(db, risk.tenant_id, current_user.id, "risk.control_effect_updated",
           "risk_control_link", link.id,
           {"freq_reduction": body.freq_reduction.dict() if body.freq_reduction else None,
            "mag_reduction": body.mag_reduction.dict() if body.mag_reduction else None})
    return {"id": link.id, "updated": True}


# ── dashboard summary ────────────────────────────────────────────────────────

@router.get("/summary")
def quantification_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-risk latest baseline ALE (active models only) + latest portfolio
    headline. The independence caveat travels WITH the data so every surface
    that renders it can show it."""
    from ....routers.auth_router import get_user_primary_tenant
    tenant_id = get_user_primary_tenant(current_user, db)
    return crqm.quantification_summary(db, tenant_id)


# ── PoS suggestion from CTEM evidence ────────────────────────────────────────

@router.get("/risks/{risk_id}/pos-suggestion")
def get_pos_suggestion(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """On-demand, read-only suggestion — computed when asked, never on page
    load, never written anywhere until explicitly accepted."""
    risk = _get_risk_or_404(risk_id, current_user, db)
    return crqm.pos_suggestion(db, risk)


@router.post("/loss-models/{model_id}/accept-pos-suggestion")
def accept_pos_suggestion(
    model_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit_perm,
):
    """Apply the CURRENT evidence-derived suggestion to a DRAFT model. The
    server recomputes the suggestion at accept time (a client cannot forge
    evidence) and freezes the snapshot — finding ids, verdict ids, timestamp,
    fingerprint — into pos_evidence. Active models are never touched: the
    'evidence updated since estimate' badge is computed by comparing this
    frozen fingerprint against a fresh suggestion, not by re-suggesting."""
    model = _get_model_or_404(model_id, current_user, db)
    if model.status != "draft":
        raise HTTPException(
            status_code=409,
            detail="Suggestions apply to drafts only — create a new draft to restate "
                   "an active model's probability.",
        )
    risk = db.query(Risk).filter(Risk.id == model.risk_id).first()
    suggestion = crqm.pos_suggestion(db, risk)
    if not suggestion.get("available"):
        raise HTTPException(status_code=409, detail=suggestion.get("reason", "No evidence available"))

    pos = suggestion["pos"]
    model.pos_min, model.pos_ml, model.pos_max = pos["min"], pos["ml"], pos["max"]
    model.pos_basis = (
        f"Derived from CTEM evidence ({suggestion['band']} band): "
        + "; ".join(suggestion["reasons"])
        + f" [snapshot {suggestion['fingerprint']} @ {suggestion['generated_at']}]"
    )
    model.pos_evidence = {
        "fingerprint": suggestion["fingerprint"],
        "band": suggestion["band"],
        "rule": suggestion["rule"],
        "reasons": suggestion["reasons"],
        "evidence": suggestion["evidence"],
        "generated_at": suggestion["generated_at"],
        "accepted_by_user_id": current_user.id,
    }
    model.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(model)
    _audit(db, model.tenant_id, current_user.id, "risk.pos_suggestion_accepted",
           "risk_loss_model", model.id,
           {"band": suggestion["band"], "fingerprint": suggestion["fingerprint"],
            "pos": pos})
    return {"model": _model_to_dict(model), "suggestion": suggestion}
