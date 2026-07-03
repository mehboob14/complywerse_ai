"""Metric-snapshot writer/reader — the history layer behind dashboard trends.

Writes daily portfolio KPI snapshots (computed through grc.services.metrics, the
single source of truth) into grc_metric_snapshot, and backfills real historical
points from grc_risk_score_history so trends aren't empty on day one. A daily
Celery beat task fans this out per tenant; a CLI backfill seeds history.

Idempotent: one UPSERT per (tenant, metric, dimension, dimension_value, as_of_date).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import metrics

# Table ensured (create-if-missing) once per engine — existing tenants provisioned
# before this table need it created lazily (create_all only runs at provisioning).
_ENSURED: set = set()


def ensure_table(db: Session) -> None:
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _ENSURED:
        return
    try:
        from ..models import MetricSnapshot
        MetricSnapshot.__table__.create(bind=db.get_bind(), checkfirst=True)
        _ENSURED.add(key)
    except Exception:  # noqa: BLE001 — never block the caller
        pass


def upsert(db: Session, tenant_id: int, metric: str, as_of: date, value,
           dimension: str = "overall", dimension_value: str = "all",
           meta: Optional[dict] = None) -> None:
    from ..models import MetricSnapshot
    row = db.query(MetricSnapshot).filter(
        MetricSnapshot.tenant_id == tenant_id,
        MetricSnapshot.metric == metric,
        MetricSnapshot.dimension == dimension,
        MetricSnapshot.dimension_value == dimension_value,
        MetricSnapshot.as_of_date == as_of,
    ).first()
    if row:
        row.value = value
        if meta is not None:
            row.meta = meta
    else:
        db.add(MetricSnapshot(
            tenant_id=tenant_id, metric=metric, dimension=dimension,
            dimension_value=dimension_value, as_of_date=as_of, value=value, meta=meta or {},
        ))


def write_daily(db: Session, tenant_id: int, as_of: Optional[date] = None) -> int:
    """Capture today's reconciled headline KPIs. Returns rows written/updated."""
    ensure_table(db)
    d = as_of or date.today()
    tids = [tenant_id]
    k = metrics.headline_kpis(db, tids)
    n = 0
    upsert(db, tenant_id, "portfolio_avg_residual", d, k["avg_residual"]["value"],
           meta={"count": k["avg_residual"]["count"], "scale": "0-100"}); n += 1
    upsert(db, tenant_id, "portfolio_avg_inherent", d, k["avg_inherent"]["value"]); n += 1
    upsert(db, tenant_id, "risk_reduction_pct", d, k["risk_reduction"]["value"]); n += 1
    upsert(db, tenant_id, "open_risks", d, k["open_risks"]["value"]); n += 1
    for band, count in k["residual_by_band"]["bands"].items():
        upsert(db, tenant_id, "open_risks_band", d, count, dimension="band", dimension_value=band); n += 1
    # Cheap, high-value module metric for the exec banner: open critical issues.
    try:
        from ..models import Issue
        oc = db.query(func.count(Issue.id)).filter(
            Issue.tenant_id == tenant_id, Issue.severity == "critical",
            Issue.workflow_state.notin_(("closed", "cancelled")),
        ).scalar() or 0
        upsert(db, tenant_id, "open_critical_issues", d, int(oc)); n += 1
    except Exception:  # noqa: BLE001
        pass
    # Exception risk posture (dashboard item 17) — trend on the exceptions page + main dashboard.
    try:
        from . import exception_posture
        ex = exception_posture.analytics(db, tids)
        if ex.get("avg_posture") is not None:
            upsert(db, tenant_id, "exception_risk_posture", d, ex["avg_posture"]); n += 1
        upsert(db, tenant_id, "open_exceptions", d, ex.get("open", 0)); n += 1
        upsert(db, tenant_id, "overdue_exceptions", d, ex.get("overdue", 0)); n += 1
        if ex.get("closed_on_time_pct") is not None:
            upsert(db, tenant_id, "exceptions_closed_on_time_pct", d, ex["closed_on_time_pct"]); n += 1
    except Exception:  # noqa: BLE001
        pass
    db.commit()
    return n


def _month_points(today: date, months: int) -> List[date]:
    """A date per month-back (approx 30-day steps), oldest → today."""
    return [today - timedelta(days=m * 30) for m in range(months, -1, -1)]


def _latest_leq(rows: list, d: date):
    """Last history row recorded on/before date d (rows must be ascending)."""
    picked = None
    for h in rows:
        rec = h.recorded_at.date() if getattr(h, "recorded_at", None) else None
        if rec is not None and rec <= d:
            picked = h
        elif rec is not None and rec > d:
            break
    return picked


def backfill(db: Session, tenant_id: int, months: int = 12) -> int:
    """Reconstruct a real monthly avg residual/inherent series from risk history
    (grc_risk_score_history), normalized to the 0-100 enterprise scale. Risks with
    no history at a date fall back to their current score (a flat line) so every
    risk contributes; ERM risks (which change) drive the trend."""
    from ..models import Risk, RiskScoreHistory
    ensure_table(db)
    risks = db.query(Risk).filter(
        Risk.tenant_id == tenant_id, Risk.status.notin_(("closed",))
    ).all()
    if not risks:
        return 0
    rids = [r.id for r in risks]
    by_risk: dict = {}
    for h in (db.query(RiskScoreHistory)
              .filter(RiskScoreHistory.risk_id.in_(rids))
              .order_by(RiskScoreHistory.recorded_at.asc()).all()):
        by_risk.setdefault(h.risk_id, []).append(h)

    tp = {r.id: metrics.is_third_party(r) for r in risks}
    cur_res = {r.id: (r.residual_score if r.residual_score is not None else r.inherent_score) for r in risks}
    cur_inh = {r.id: r.inherent_score for r in risks}

    def norm(raw, third_party):
        if raw is None:
            return None
        return min(100.0, float(raw) if third_party else float(raw) * 4.0)

    written = 0
    for d in _month_points(date.today(), months):
        res_vals, inh_vals = [], []
        for r in risks:
            hr = _latest_leq(by_risk.get(r.id, []), d)
            raw_res = (hr.residual_score if (hr and hr.residual_score is not None)
                       else (hr.inherent_score if hr else None))
            if raw_res is None:
                raw_res = cur_res[r.id]
            raw_inh = (hr.inherent_score if (hr and hr.inherent_score is not None) else None)
            if raw_inh is None:
                raw_inh = cur_inh[r.id]
            v = norm(raw_res, tp[r.id])
            if v is not None:
                res_vals.append(v)
            iv = norm(raw_inh, tp[r.id])
            if iv is not None:
                inh_vals.append(iv)
        if res_vals:
            upsert(db, tenant_id, "portfolio_avg_residual", d, round(sum(res_vals) / len(res_vals), 1)); written += 1
        if inh_vals:
            upsert(db, tenant_id, "portfolio_avg_inherent", d, round(sum(inh_vals) / len(inh_vals), 1)); written += 1
    db.commit()
    return written


def read_trend(db: Session, tenant_ids: List[int], metric: str, days: int = 180,
               dimension: str = "overall", dimension_value: str = "all") -> List[dict]:
    from ..models import MetricSnapshot
    cutoff = date.today() - timedelta(days=days)
    rows = (db.query(MetricSnapshot)
            .filter(MetricSnapshot.tenant_id.in_(tenant_ids),
                    MetricSnapshot.metric == metric,
                    MetricSnapshot.dimension == dimension,
                    MetricSnapshot.dimension_value == dimension_value,
                    MetricSnapshot.as_of_date >= cutoff)
            .order_by(MetricSnapshot.as_of_date.asc()).all())
    return [{"date": r.as_of_date.isoformat(), "value": r.value} for r in rows]
