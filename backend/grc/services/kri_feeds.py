"""Live-fed KRIs — resolve a KRI's value and history from the cross-module metric
layer instead of manual measurements.

A KRI with `metric_key` set binds to a `metric_catalog` metric; its current value is
computed on demand from the same canonical sources the dashboards/trends use
(metrics.py for risk, metrics_cross.py for the other modules), and its history is the
reconciled daily series already stored in grc_metric_snapshot. So a live KRI stays in
lock-step with the rest of the platform with no hand-entry.

Also owns `ensure_kri_columns` — the additive self-heal that brings existing tenant
DBs up to the new RiskKRI shape (tenant_id + metric_key, nullable risk_id) and
backfills tenant_id from the parent risk.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from . import metric_catalog, metric_snapshots, metrics, metrics_cross

logger = logging.getLogger(__name__)

_ENSURED: set = set()

# Additive columns for the full KPI/KRI lifecycle (Postgres ADD COLUMN types).
_KRI_ADDS = [
    ("tenant_id", "INTEGER"), ("metric_key", "VARCHAR(60)"),
    ("kind", "VARCHAR(10)"), ("category", "VARCHAR(100)"), ("formula", "TEXT"),
    ("target", "DOUBLE PRECISION"), ("reporting_period", "VARCHAR(40)"),
    ("next_due_date", "TIMESTAMP"), ("data_provider_id", "INTEGER"),
    ("reviewer_id", "INTEGER"), ("linked_control_ids", "JSON"),
    ("linked_objective_ids", "JSON"), ("linked_framework_id", "INTEGER"),
]
_MEAS_ADDS = [
    ("period_label", "VARCHAR(40)"), ("target", "DOUBLE PRECISION"),
    ("review_status", "VARCHAR(20)"), ("reviewed_by", "INTEGER"),
    ("reviewed_at", "TIMESTAMP"),
]


def ensure_kri_columns(db: Session) -> None:
    """Additive self-heal for the KPI/KRI tables: add every lifecycle column, relax
    the risk_id NOT NULL constraint, and backfill tenant_id from the parent risk.
    Runs once per engine. Never raises."""
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", "default"))
    except Exception:  # noqa: BLE001
        return
    if key in _ENSURED:
        return
    try:
        bind = db.get_bind()
        for table, adds in (("grc_risk_kris", _KRI_ADDS), ("grc_risk_kri_measurements", _MEAS_ADDS)):
            try:
                cols = {c["name"] for c in inspect(bind).get_columns(table)}
            except Exception:  # noqa: BLE001
                cols = set()
            for name, typ in adds:
                if name not in cols:
                    try:
                        db.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {typ}"))
                    except Exception:  # noqa: BLE001
                        pass
        if bind.dialect.name == "postgresql":
            try:
                db.execute(text("ALTER TABLE grc_risk_kris ALTER COLUMN risk_id DROP NOT NULL"))
            except Exception:  # noqa: BLE001 — already nullable
                pass
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    # Backfill tenant_id from the parent risk for pre-existing rows.
    try:
        db.execute(text(
            "UPDATE grc_risk_kris SET tenant_id = "
            "(SELECT tenant_id FROM grc_risks WHERE grc_risks.id = grc_risk_kris.risk_id) "
            "WHERE tenant_id IS NULL AND risk_id IS NOT NULL"
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    # Older rows may have NULL kind after the column was added without a DEFAULT fill.
    try:
        db.execute(text(
            "UPDATE grc_risk_kris SET kind = 'kri' WHERE kind IS NULL OR kind = ''"
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    _ENSURED.add(key)


# Risk headline metrics come from metrics.headline_kpis (not metrics_cross).
def _risk_headline(db: Session, tenant_ids: List[int]) -> dict:
    try:
        k = metrics.headline_kpis(db, tenant_ids)
        return {
            "portfolio_avg_residual": k["avg_residual"]["value"],
            "portfolio_avg_inherent": k["avg_inherent"]["value"],
            "risk_reduction_pct": k["risk_reduction"]["value"],
            "open_risks": k["open_risks"]["value"],
        }
    except Exception:  # noqa: BLE001
        return {}


def current_value(db: Session, tenant_ids: List[int], metric_key: str) -> Optional[float]:
    """The KRI's live value for `metric_key`, computed fresh from the canonical
    sources; falls back to the latest daily snapshot for metrics computed only in
    the snapshot writer (issues / exceptions)."""
    if not metric_key:
        return None
    # 1) cross-module metrics (overall dimension)
    try:
        for s in metrics_cross.collect(db, tenant_ids):
            if s["metric"] == metric_key and s.get("dimension", "overall") == "overall":
                return s["value"]
    except Exception:  # noqa: BLE001
        pass
    # 2) risk headline metrics
    rh = _risk_headline(db, tenant_ids)
    if metric_key in rh:
        return rh[metric_key]
    # 3) fall back to the most recent daily snapshot (covers issues/exceptions keys)
    try:
        pts = metric_snapshots.read_trend(db, tenant_ids, metric_key, days=730)
        if pts:
            return pts[-1]["value"]
    except Exception:  # noqa: BLE001
        pass
    return None


def history(db: Session, tenant_ids: List[int], metric_key: str, days: int = 180) -> List[dict]:
    """Reconciled daily series for the metric from grc_metric_snapshot."""
    try:
        return metric_snapshots.read_trend(db, tenant_ids, metric_key, days=days)
    except Exception:  # noqa: BLE001
        return []


def metric_options() -> List[dict]:
    """The catalog of metrics a KRI can bind to (for the create/edit picker)."""
    out = []
    for m in metric_catalog.METRICS:
        out.append({
            "key": m.key, "label": m.label, "module": m.module,
            "module_label": metric_catalog.MODULE_LABELS.get(m.module, m.module),
            "unit": m.unit, "direction": m.direction, "definition": m.definition,
            "suggested_target": m.target, "suggested_warn": m.warn,
        })
    return out


def catalog_meta(metric_key: str):
    """The MetricDef for a bound metric (unit/direction/target), or None."""
    return metric_catalog.get(metric_key)
