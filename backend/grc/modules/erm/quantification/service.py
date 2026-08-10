"""CRQM service — loss-model lifecycle + simulation orchestration.

The engine (engine.py) is pure math; everything stateful lives here:
draft/activate versioning (transactional), run persistence (immutable rows,
seed + engine version stamped), the assumptions snapshot frozen onto every
run, and the lazy sweep that fails-out runs orphaned by a process death.
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    Risk,
    RiskAssetLink,
    RiskControlLink,
    RiskLossModel,
    RiskSimulationRun,
)
from .engine import ENGINE_VERSION, simulate, simulate_portfolio

logger = logging.getLogger(__name__)

# A run that still says "running" after this long was orphaned by a process
# death mid-request (runs execute inline in milliseconds). Failed-out lazily,
# never retried silently.
_STALE_RUN_MINUTES = 15

PORTFOLIO_INDEPENDENCE_NOTE = (
    "Portfolio percentiles assume independence between scenarios. Correlated "
    "risks (one campaign affecting several business units) make real tail "
    "risk HIGHER than shown."
)


def sweep_stale_runs(db: Session, tenant_id: int) -> int:
    """Fail-out orphaned 'running' rows. Called lazily before run listings and
    new runs — no scheduler needed."""
    cutoff = datetime.utcnow() - timedelta(minutes=_STALE_RUN_MINUTES)
    stale = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.tenant_id == tenant_id,
        RiskSimulationRun.status == "running",
        RiskSimulationRun.created_at < cutoff,
    ).all()
    for run in stale:
        run.status = "failed"
        run.error = "Orphaned: process terminated before the run completed."
        run.completed_at = datetime.utcnow()
    if stale:
        db.commit()
        logger.warning("CRQM: failed-out %d orphaned simulation run(s) for tenant %s",
                       len(stale), tenant_id)
    return len(stale)


def _validate_triple(name: str, lo, ml, hi, *, lo_bound=0.0, hi_bound=None):
    if lo is None or ml is None or hi is None:
        raise ValueError(f"{name}: min, most-likely and max are all required")
    lo, ml, hi = float(lo), float(ml), float(hi)
    if not (lo <= ml <= hi):
        raise ValueError(f"{name}: must satisfy min <= most-likely <= max")
    if lo < lo_bound:
        raise ValueError(f"{name}: values must be >= {lo_bound}")
    if hi_bound is not None and hi > hi_bound:
        raise ValueError(f"{name}: values must be <= {hi_bound}")


def validate_loss_model_payload(tef: Dict, pos: Dict, components: List[Dict]) -> None:
    _validate_triple("Event frequency", tef.get("min"), tef.get("ml"), tef.get("max"))
    _validate_triple("Probability of success", pos.get("min"), pos.get("ml"), pos.get("max"),
                     hi_bound=1.0)
    if not components:
        raise ValueError("At least one loss component is required")
    for i, c in enumerate(components):
        label = c.get("label") or c.get("key") or f"component {i + 1}"
        _validate_triple(f"Loss component '{label}'", c.get("min"), c.get("ml"), c.get("max"))
        prob = c.get("probability", 1.0)
        if prob is None:
            prob = 1.0
        if not (0.0 <= float(prob) <= 1.0):
            raise ValueError(f"Loss component '{label}': probability must be between 0 and 1")
        if c.get("kind") not in ("primary", "secondary"):
            raise ValueError(f"Loss component '{label}': kind must be 'primary' or 'secondary'")
        if not (c.get("rationale") or "").strip():
            raise ValueError(
                f"Loss component '{label}': a rationale is required — the estimate's "
                "defensibility lives in its reasoning"
            )


def build_engine_model(m: RiskLossModel) -> Dict[str, Any]:
    return {
        "tef": (m.tef_min, m.tef_ml, m.tef_max),
        "pos": (m.pos_min, m.pos_ml, m.pos_max),
        "components": [
            {
                "key": c.get("key") or c.get("label"),
                "label": c.get("label") or c.get("key"),
                "min": c["min"], "ml": c["ml"], "max": c["max"],
                "probability": c.get("probability", 1.0),
            }
            for c in (m.loss_components or [])
        ],
    }


def build_control_effects(db: Session, risk_id: int, control_link_ids: Optional[List[int]]) -> List[Dict[str, Any]]:
    """Engine-shaped effects for the selected risk↔control links. Links with
    no modelled effect contribute nothing (and are reported as such by the
    router so a 'comparison' against an unmodelled control can't silently
    equal the baseline)."""
    if not control_link_ids:
        return []
    links = db.query(RiskControlLink).filter(
        RiskControlLink.risk_id == risk_id,
        RiskControlLink.id.in_(control_link_ids),
    ).all()
    effects = []
    for link in links:
        freq = None
        if link.freq_reduction_ml_pct is not None:
            freq = (link.freq_reduction_min_pct or 0.0,
                    link.freq_reduction_ml_pct,
                    link.freq_reduction_max_pct or link.freq_reduction_ml_pct)
        mag = None
        if link.mag_reduction_ml_pct is not None:
            mag = (link.mag_reduction_min_pct or 0.0,
                   link.mag_reduction_ml_pct,
                   link.mag_reduction_max_pct or link.mag_reduction_ml_pct)
        label = None
        try:
            label = getattr(link.normalized_control, "name", None) or getattr(
                link.normalized_control, "title", None)
        except Exception:
            pass
        effects.append({
            "control_link_id": link.id,
            "label": label or f"control link {link.id}",
            "freq": freq,
            "mag": mag,
        })
    return effects


def next_version(db: Session, risk_id: int) -> int:
    current = db.query(RiskLossModel).filter(
        RiskLossModel.risk_id == risk_id,
    ).count()
    return current + 1


def activate_model(db: Session, model: RiskLossModel,
                   actor_user_id: Optional[int] = None) -> RiskLossModel:
    """Promote a draft to active, archiving the previous active — under a row
    lock on the risk's models so two concurrent activations serialize instead
    of racing into two actives.

    Activation immediately executes a system-attributed BASELINE run
    (trigger="activation"): runs cost milliseconds, and this guarantees the
    dashboard's per-risk ALE can never come from a superseded model. A failed
    auto-run never blocks the activation — the dashboard just keeps the
    previous number until the next successful run."""
    if model.status != "draft":
        raise ValueError("Only a draft model can be activated")
    # Lock every model row of this risk for the duration of the transaction.
    siblings = db.query(RiskLossModel).filter(
        RiskLossModel.risk_id == model.risk_id,
    ).with_for_update().all()
    for sib in siblings:
        if sib.id != model.id and sib.status == "active":
            sib.status = "archived"
            sib.updated_at = datetime.utcnow()
    model.status = "active"
    model.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(model)

    try:
        run_risk_simulation(
            db, model,
            iterations=10_000, seed=None, control_link_ids=None,
            user_id=actor_user_id, trigger="activation",
        )
    except Exception:
        logger.exception(
            "Activation baseline run failed for loss model %s (activation stands)", model.id,
        )
    return model


def _model_snapshot(m: RiskLossModel) -> Dict[str, Any]:
    """The assumptions as they were at run time — frozen onto the run row so
    the figure stays explainable even after the model gains new versions."""
    return {
        "loss_model_id": m.id,
        "version": m.version,
        "currency": m.currency,
        "tef": {"min": m.tef_min, "ml": m.tef_ml, "max": m.tef_max},
        "pos": {"min": m.pos_min, "ml": m.pos_ml, "max": m.pos_max, "basis": m.pos_basis},
        "components": m.loss_components or [],
        "confidence_pct": m.confidence_pct,
        "assumptions": m.assumptions,
    }


def run_risk_simulation(
    db: Session,
    model: RiskLossModel,
    *,
    iterations: int,
    seed: Optional[int],
    control_link_ids: Optional[List[int]],
    user_id: Optional[int],
    trigger: str = "manual",
) -> RiskSimulationRun:
    effects = build_control_effects(db, model.risk_id, control_link_ids)
    run = RiskSimulationRun(
        tenant_id=model.tenant_id,
        scope="risk",
        risk_id=model.risk_id,
        loss_model_id=model.id,
        status="running",
        trigger=trigger,
        iterations=iterations,
        seed=0,  # replaced below once the engine picks/uses the real seed
        engine_version=ENGINE_VERSION,
        currency=model.currency,
        controls_scenario=[
            {"control_link_id": e["control_link_id"], "label": e["label"],
             "freq": e["freq"], "mag": e["mag"]}
            for e in effects
        ] or None,
        assumptions_snapshot={"model": _model_snapshot(model)},
        triggered_by_user_id=user_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    started = datetime.utcnow()
    try:
        result = simulate(
            build_engine_model(model),
            iterations=iterations,
            seed=seed,
            control_effects=[{"freq": e["freq"], "mag": e["mag"]} for e in effects],
        )
        run.seed = result["seed"]
        run.iterations = result["iterations"]
        run.ale_mean = result["ale_mean"]
        run.ale_median = result["ale_median"]
        run.p5, run.p50, run.p90 = result["p5"], result["p50"], result["p90"]
        run.p95, run.p99 = result["p95"], result["p99"]
        run.lec_points = result["lec_points"]
        run.component_contributions = result["component_contributions"]
        run.status = "completed"
    except Exception as e:
        logger.exception("CRQM simulation failed for loss model %s", model.id)
        run.status = "failed"
        run.error = str(e)[:1000]
    run.duration_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
    run.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


def run_portfolio_simulation(
    db: Session,
    tenant_id: int,
    *,
    iterations: int,
    seed: Optional[int],
    user_id: Optional[int],
) -> RiskSimulationRun:
    """Joint run over every ACTIVE loss model in the tenant. Currencies are
    not converted — a mixed-currency portfolio is refused rather than summed
    into a meaningless number."""
    actives = db.query(RiskLossModel).join(Risk, Risk.id == RiskLossModel.risk_id).filter(
        RiskLossModel.tenant_id == tenant_id,
        RiskLossModel.status == "active",
    ).all()
    if not actives:
        raise ValueError("No active loss models to simulate — activate at least one first")
    currencies = {m.currency for m in actives}
    if len(currencies) > 1:
        raise ValueError(
            f"Active loss models use multiple currencies ({', '.join(sorted(currencies))}) — "
            "portfolio totals across currencies are not meaningful"
        )

    run = RiskSimulationRun(
        tenant_id=tenant_id,
        scope="portfolio",
        status="running",
        iterations=iterations,
        seed=0,
        engine_version=ENGINE_VERSION,
        currency=actives[0].currency,
        assumptions_snapshot={
            "independence": PORTFOLIO_INDEPENDENCE_NOTE,
            "models": [_model_snapshot(m) for m in actives],
        },
        triggered_by_user_id=user_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    started = datetime.utcnow()
    try:
        engine_models = []
        for m in actives:
            em = build_engine_model(m)
            em["risk_id"] = m.risk_id
            em["label"] = getattr(m.risk, "title", None) or f"risk {m.risk_id}"
            engine_models.append(em)
        result = simulate_portfolio(engine_models, iterations=iterations, seed=seed)
        run.seed = result["seed"]
        run.iterations = result["iterations"]
        run.ale_mean = result["ale_mean"]
        run.ale_median = result["ale_median"]
        run.p5, run.p50, run.p90 = result["p5"], result["p50"], result["p90"]
        run.p95, run.p99 = result["p95"], result["p99"]
        run.lec_points = result["lec_points"]
        run.component_contributions = result["component_contributions"]
        run.status = "completed"
    except Exception as e:
        logger.exception("CRQM portfolio simulation failed for tenant %s", tenant_id)
        run.status = "failed"
        run.error = str(e)[:1000]
    run.duration_ms = int((datetime.utcnow() - started).total_seconds() * 1000)
    run.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(run)
    return run


# ── dashboard summary ────────────────────────────────────────────────────────

def quantification_summary(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Per-risk headline figures for the dashboard card.

    The ALE source per risk is the LATEST completed BASELINE run
    (controls_scenario null) of the ACTIVE model — activation auto-runs
    guarantee this is never a superseded model's number. The portfolio
    headline comes from the latest completed joint run; its p95 is the joint
    distribution's percentile, never a sum of per-risk percentiles (means
    add; tails don't)."""
    sweep_stale_runs(db, tenant_id)

    actives = db.query(RiskLossModel).join(Risk, Risk.id == RiskLossModel.risk_id).filter(
        RiskLossModel.tenant_id == tenant_id,
        RiskLossModel.status == "active",
    ).all()

    risks_out = []
    for m in actives:
        run = db.query(RiskSimulationRun).filter(
            RiskSimulationRun.loss_model_id == m.id,
            RiskSimulationRun.status == "completed",
            RiskSimulationRun.controls_scenario.is_(None),
        ).order_by(RiskSimulationRun.created_at.desc()).first()
        risks_out.append({
            "risk_id": m.risk_id,
            "title": getattr(m.risk, "title", None) or f"risk {m.risk_id}",
            "model_version": m.version,
            "currency": m.currency,
            "ale_mean": run.ale_mean if run else None,
            "p95": run.p95 if run else None,
            "run_id": run.id if run else None,
            "run_created_at": run.created_at.isoformat() if run and run.created_at else None,
        })
    risks_out.sort(key=lambda r: r["ale_mean"] or 0, reverse=True)

    portfolio = db.query(RiskSimulationRun).filter(
        RiskSimulationRun.tenant_id == tenant_id,
        RiskSimulationRun.scope == "portfolio",
        RiskSimulationRun.status == "completed",
    ).order_by(RiskSimulationRun.created_at.desc()).first()

    return {
        "risks": risks_out,
        "portfolio": {
            "run_id": portfolio.id,
            "currency": portfolio.currency,
            "ale_mean": portfolio.ale_mean,
            "p95": portfolio.p95,
            "p99": portfolio.p99,
            "lec_points": portfolio.lec_points or [],
            "created_at": portfolio.created_at.isoformat() if portfolio.created_at else None,
            "independence_note": PORTFOLIO_INDEPENDENCE_NOTE,
        } if portfolio else None,
        "independence_note": PORTFOLIO_INDEPENDENCE_NOTE,
    }


# ── PoS suggestion from CTEM evidence ────────────────────────────────────────

# The explicit, conservative signal→range table. Shown to the user verbatim
# as "why this range" — an unexplainable suggested probability is worse than
# none in front of an auditor.
POS_BANDS = {
    "upper": {"pos": {"min": 0.5, "ml": 0.7, "max": 0.9},
              "rule": "Validated-reachable finding AND an open CISA-KEV exploited vulnerability on a linked asset"},
    "mid": {"pos": {"min": 0.25, "ml": 0.45, "max": 0.65},
            "rule": "A reachable finding OR an open KEV vulnerability on a linked asset"},
    "lower": {"pos": {"min": 0.05, "ml": 0.15, "max": 0.3},
              "rule": "No open reachable/KEV findings; scanner-verified remediation history on linked assets"},
}

_OPEN_EXCLUDED_STATUSES = (
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned", "auto_closed_fixed",
)


def pos_suggestion(db: Session, risk: Risk) -> Dict[str, Any]:
    """Suggest a probability-of-success range from CTEM evidence on the
    risk's linked assets. Read-only and on-demand — nothing is written until
    the user explicitly accepts (the router freezes the snapshot then)."""
    from ....models import Vulnerability, VulnerabilityAssetLink, ReachabilitySnapshot

    asset_ids = [l.asset_id for l in db.query(RiskAssetLink).filter(
        RiskAssetLink.risk_id == risk.id).all()]
    if not asset_ids:
        return {"available": False,
                "reason": "No assets linked to this risk — link assets first so evidence can be gathered."}

    kev_rows = db.query(Vulnerability.id, Vulnerability.cve_id).join(
        VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id,
    ).filter(
        VulnerabilityAssetLink.asset_id.in_(asset_ids),
        Vulnerability.kev_flag.is_(True),
        ~Vulnerability.status.in_(_OPEN_EXCLUDED_STATUSES),
    ).all()
    kev_ids = sorted({r[0] for r in kev_rows})

    # Latest reachability verdict per (vulnerability, asset) pair.
    snaps = db.query(ReachabilitySnapshot).filter(
        ReachabilitySnapshot.asset_id.in_(asset_ids),
    ).order_by(ReachabilitySnapshot.assessed_at.desc()).limit(500).all()
    latest_by_pair: Dict[tuple, Any] = {}
    for s in snaps:
        pair = (s.vulnerability_id, s.asset_id)
        if pair not in latest_by_pair:
            latest_by_pair[pair] = s
    reachable = [
        {"vulnerability_id": s.vulnerability_id, "asset_id": s.asset_id,
         "verdict": s.verdict, "snapshot_id": s.id,
         "assessed_at": s.assessed_at.isoformat() if s.assessed_at else None}
        for s in latest_by_pair.values() if s.verdict in ("likely", "possible")
    ]
    reachable_likely = [r for r in reachable if r["verdict"] == "likely"]

    verified_closures = db.query(Vulnerability.id).join(
        VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id,
    ).filter(
        VulnerabilityAssetLink.asset_id.in_(asset_ids),
        Vulnerability.status == "auto_closed_fixed",
    ).count()

    reasons: List[str] = []
    if reachable_likely and kev_ids:
        band = "upper"
        reasons.append(f"{len(reachable_likely)} finding(s) with a 'likely' reachability verdict on linked assets")
        reasons.append(f"{len(kev_ids)} open CISA-KEV (known-exploited) vulnerability(ies) on linked assets")
    elif reachable or kev_ids:
        band = "mid"
        if reachable:
            reasons.append(f"{len(reachable)} finding(s) assessed reachable (likely/possible) on linked assets")
        if kev_ids:
            reasons.append(f"{len(kev_ids)} open CISA-KEV vulnerability(ies) on linked assets")
    elif verified_closures > 0:
        band = "lower"
        reasons.append(f"No open reachable/KEV findings; {verified_closures} scanner-verified closure(s) show remediation works")
    else:
        return {"available": False,
                "reason": "No CTEM evidence (reachability verdicts, KEV findings, or verified closures) on the linked assets yet."}

    evidence = {
        "finding_ids": kev_ids,
        "reachability": reachable,
        "verified_closures": verified_closures,
        "asset_ids": sorted(asset_ids),
    }
    fingerprint = hashlib.sha256(
        json.dumps(evidence, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]

    return {
        "available": True,
        "band": band,
        "pos": POS_BANDS[band]["pos"],
        "rule": POS_BANDS[band]["rule"],
        "bands_table": {k: {"pos": v["pos"], "rule": v["rule"]} for k, v in POS_BANDS.items()},
        "reasons": reasons,
        "evidence": evidence,
        "fingerprint": fingerprint,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }
