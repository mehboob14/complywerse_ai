"""Single source of truth for GRC headline metrics (dashboard reconciliation).

Every dashboard endpoint AND the snapshot writer compute headline KPIs through
THESE functions, so the same defensible number appears on /dashboard, the Risk
tab, /erm and the board pack (fixes DASH-002 / DASH-009 — the four different
avg-residual figures). Each metric carries a DEFINITION string the UI surfaces
as a tooltip / footnote (DASH-015).

Locked decisions this encodes:
  • SCALE — everything is normalized to a common 0-100 scale. ERM risks are scored
    on the 5x5 (1-25) likelihood×impact grid; third-party (TPRM) risks are already
    0-100. The root cause of the divergent averages was mixing the two raw scales.
  • PORTFOLIO — the enterprise headline INCLUDES third-party risk (a bank board
    wants one enterprise posture). Third-party risks already live in grc_risks
    (synced from the TPRA lifecycle), so "enterprise" = all open Risk rows.

Pure/read-only: functions take an open Session + the caller's tenant id list.
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import Risk

# ── Common 0-100 scale ───────────────────────────────────────────────────────

def is_third_party(r: Risk) -> bool:
    """A third-party (TPRM) risk is already scored 0-100; ERM risks are 0-25."""
    return bool(
        getattr(r, "category", None) == "third_party"
        or getattr(r, "risk_category", None) == "third_party"
        or getattr(r, "register_type", None) == "Third-Party Risk"
        or str(getattr(r, "source_reference", "") or "").startswith("vendor:")
    )


def _to_100(raw, third_party: bool) -> Optional[float]:
    if raw is None:
        return None
    v = float(raw)
    # ERM 0-25 (5x5) → 0-100; third-party already 0-100. Clamp for safety.
    return min(100.0, v if third_party else v * 4.0)


def residual_on_100(r: Risk) -> Optional[float]:
    """Residual score on the common 0-100 scale (falls back to inherent if unscored)."""
    tp = is_third_party(r)
    raw = r.residual_score if r.residual_score is not None else r.inherent_score
    return _to_100(raw, tp)


def inherent_on_100(r: Risk) -> Optional[float]:
    return _to_100(r.inherent_score, is_third_party(r))


def band_of(score: Optional[float]) -> str:
    """0-100 residual → tier band (matches the exec RAG thresholds)."""
    if score is None:
        return "unscored"
    s = float(score)
    if s >= 75:
        return "critical"
    if s >= 50:
        return "high"
    if s >= 25:
        return "medium"
    return "low"


# Statuses treated as no-longer-open (excluded from the live portfolio headline).
_CLOSED_STATES = ("closed",)


def open_portfolio(db: Session, tenant_ids: List[int]) -> List[Risk]:
    """All OPEN enterprise risks (ERM + third-party), the canonical headline set."""
    return (
        db.query(Risk)
        .filter(Risk.tenant_id.in_(tenant_ids), Risk.status.notin_(_CLOSED_STATES))
        .all()
    )


# ── Metric definitions (surfaced as tooltips) ────────────────────────────────

METRIC_DEFINITIONS = {
    "portfolio_avg_residual":
        "Mean residual risk across all OPEN enterprise risks (ERM register + third-party), "
        "normalized to a 0-100 scale. Excludes closed risks and risks with no score.",
    "portfolio_avg_inherent":
        "Mean inherent (pre-control) risk across all open enterprise risks, 0-100.",
    "risk_reduction_pct":
        "How much controls reduce risk portfolio-wide: 1 - (avg residual / avg inherent), as a %.",
    "open_risks": "Count of open enterprise risks (ERM + third-party), excluding closed.",
    "residual_by_band":
        "Open risks bucketed by residual band on the 0-100 scale "
        "(critical ≥75, high ≥50, medium ≥25, low <25; unscored = no score yet).",
    "control_universe_normalized":
        "Distinct controls in the shared normalized control library (deduped common controls).",
    "control_universe_framework":
        "Framework-instantiated control instances across the tenant's uploaded frameworks "
        "(a control mapped into N frameworks counts N times).",
}


# ── Canonical metrics ────────────────────────────────────────────────────────

def portfolio_avg_residual(db: Session, tenant_ids: List[int]) -> dict:
    """THE canonical avg residual — one number for every dashboard (0-100)."""
    risks = open_portfolio(db, tenant_ids)
    vals = [v for v in (residual_on_100(r) for r in risks) if v is not None]
    avg = round(sum(vals) / len(vals), 1) if vals else None
    return {
        "metric": "portfolio_avg_residual", "value": avg, "scale": "0-100",
        "count": len(vals), "open_risks": len(risks),
        "definition": METRIC_DEFINITIONS["portfolio_avg_residual"],
    }


def portfolio_avg_inherent(db: Session, tenant_ids: List[int]) -> dict:
    risks = open_portfolio(db, tenant_ids)
    vals = [v for v in (inherent_on_100(r) for r in risks) if v is not None]
    avg = round(sum(vals) / len(vals), 1) if vals else None
    return {
        "metric": "portfolio_avg_inherent", "value": avg, "scale": "0-100",
        "count": len(vals), "definition": METRIC_DEFINITIONS["portfolio_avg_inherent"],
    }


def risk_reduction_pct(db: Session, tenant_ids: List[int]) -> dict:
    inh = portfolio_avg_inherent(db, tenant_ids)["value"]
    res = portfolio_avg_residual(db, tenant_ids)["value"]
    pct = round((1 - (res / inh)) * 100, 1) if (inh and res is not None) else None
    return {"metric": "risk_reduction_pct", "value": pct,
            "avg_inherent": inh, "avg_residual": res,
            "definition": METRIC_DEFINITIONS["risk_reduction_pct"]}


def residual_by_band(db: Session, tenant_ids: List[int]) -> dict:
    risks = open_portfolio(db, tenant_ids)
    bands = {"critical": 0, "high": 0, "medium": 0, "low": 0, "unscored": 0}
    for r in risks:
        bands[band_of(residual_on_100(r))] += 1
    return {"metric": "residual_by_band", "bands": bands, "open_risks": len(risks),
            "definition": METRIC_DEFINITIONS["residual_by_band"]}


def open_risks(db: Session, tenant_ids: List[int]) -> dict:
    n = (
        db.query(func.count(Risk.id))
        .filter(Risk.tenant_id.in_(tenant_ids), Risk.status.notin_(_CLOSED_STATES))
        .scalar()
    ) or 0
    return {"metric": "open_risks", "value": int(n),
            "definition": METRIC_DEFINITIONS["open_risks"]}


def control_universe(db: Session, tenant_ids: List[int]) -> dict:
    """Reconciles the 369 vs 3419 discrepancy by returning BOTH, clearly labelled."""
    normalized = framework = None
    try:
        from ..models import NormalizedControl
        normalized = int(db.query(func.count(NormalizedControl.id)).scalar() or 0)
    except Exception:  # noqa: BLE001
        normalized = None
    try:
        from ..models import ParsedFrameworkControl, UploadedFramework
        fw_ids = [f.id for f in db.query(UploadedFramework.id).filter(
            UploadedFramework.tenant_id.in_(tenant_ids)).all()]
        framework = int(
            db.query(func.count(ParsedFrameworkControl.id))
            .filter(ParsedFrameworkControl.uploaded_framework_id.in_(fw_ids)).scalar() or 0
        ) if fw_ids else 0
    except Exception:  # noqa: BLE001
        framework = None
    return {
        "metric": "control_universe",
        "normalized": normalized, "framework": framework,
        "definitions": {
            "normalized": METRIC_DEFINITIONS["control_universe_normalized"],
            "framework": METRIC_DEFINITIONS["control_universe_framework"],
        },
    }


def headline_kpis(db: Session, tenant_ids: List[int]) -> dict:
    """The reconciled headline block every dashboard/board view should read from."""
    return {
        "avg_residual": portfolio_avg_residual(db, tenant_ids),
        "avg_inherent": portfolio_avg_inherent(db, tenant_ids),
        "risk_reduction": risk_reduction_pct(db, tenant_ids),
        "open_risks": open_risks(db, tenant_ids),
        "residual_by_band": residual_by_band(db, tenant_ids),
        "control_universe": control_universe(db, tenant_ids),
    }
