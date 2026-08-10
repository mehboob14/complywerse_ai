"""Cross-module current-value metrics for the trend snapshot layer.

`metrics.py` is the single source of truth for the *risk* register; this module
is its counterpart for the other modules (compliance, controls, evidence,
vulnerabilities, vendors, assets, governance). Each function computes a metric
directly from that module's own model using the *same formula the module's own
dashboard uses*, so a trended value reconciles with the module screen.

Pure/read-only: every function takes an open Session + a tenant-id list, mirroring
metrics.headline_kpis. `collect()` returns a flat list of snapshot samples that
metric_snapshots.write_daily upserts. `backfill_cross()` reconstructs real
history for the two modules that already keep their own point-in-time tables
(compliance → grc_compliance_history, vendors → grc_tpra_risk_snapshots).

Robust by construction: each module block is independently guarded, so one
module (or a model that isn't present in a given tenant) never blocks the rest.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# A vuln is "open" unless it is in one of these terminal states (matches the vuln
# dashboard's RESOLVED_STATUSES).
_VULN_RESOLVED = (
    "resolved", "remediated", "verified", "closed",
    "accepted", "false_positive", "auto_closed_decommissioned",
    "auto_closed_fixed",
)


def _s(metric: str, value, dimension: str = "overall", dimension_value: str = "all",
       meta: Optional[dict] = None) -> Optional[dict]:
    """Build one snapshot sample, or None when there's no value to record."""
    if value is None:
        return None
    return {"metric": metric, "value": value, "dimension": dimension,
            "dimension_value": dimension_value, "meta": meta or {}}


def _compact(items) -> List[dict]:
    return [s for s in items if s is not None]


# ── Per-module current values ─────────────────────────────────────────────────
def compliance_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Per-journey completion/readiness (the exact numbers each journey's charts
    show) + a controls-weighted overall. Uses calculate_progress_summary, the
    canonical per-journey computation that also feeds grc_compliance_history."""
    from ..models import CertificationJourney
    from ..routers.certification_router import calculate_progress_summary

    journeys = (db.query(CertificationJourney)
                .filter(CertificationJourney.tenant_id.in_(tenant_ids)).all())
    out: List[dict] = []
    tot_impl = tot_applicable = 0
    readiness_vals: List[float] = []
    for j in journeys:
        try:
            p = calculate_progress_summary(j, db)
        except Exception:  # noqa: BLE001 — a single bad journey shouldn't drop the rest
            continue
        applicable = (p.total_controls or 0) - (p.not_applicable_count or 0)
        fw = (j.name or f"Journey {j.id}")[:120]
        out.append(_s("compliance_completion_pct", round(p.completion_percentage, 1),
                      "framework", fw, {"total": p.total_controls, "implemented": p.implemented_count}))
        out.append(_s("compliance_readiness_pct", round(p.readiness_percentage, 1), "framework", fw))
        tot_impl += (p.implemented_count or 0)
        tot_applicable += applicable
        if p.readiness_percentage is not None:
            readiness_vals.append(p.readiness_percentage)
    if tot_applicable > 0:
        out.append(_s("compliance_completion_pct", round(tot_impl / tot_applicable * 100, 1),
                      meta={"implemented": tot_impl, "applicable": tot_applicable}))
    if readiness_vals:
        out.append(_s("compliance_readiness_pct", round(sum(readiness_vals) / len(readiness_vals), 1)))
    return _compact(out)


def control_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Implementation / effectiveness / test-coverage ratios off the unified
    control work layer (ControlWorkItem) — the numbers the Control Library hub
    derives. NB: NormalizedControl.maturity_level is unused (defaults 0) so it is
    deliberately NOT snapshotted."""
    from ..models import ControlWorkItem
    items = (db.query(ControlWorkItem)
             .filter(ControlWorkItem.tenant_id.in_(tenant_ids)).all())
    n = len(items)
    out = [_s("controls_total", n)]
    if n:
        applicable = sum(1 for c in items if (c.implementation_status or "") != "not_applicable")
        implemented = sum(1 for c in items if (c.implementation_status or "") in ("implemented", "verified"))
        effective = sum(1 for c in items if (c.operating_effectiveness or "") == "effective")
        tested = sum(1 for c in items if c.last_tested_at is not None)
        if applicable:
            out.append(_s("control_implemented_pct", round(implemented / applicable * 100, 1),
                          meta={"implemented": implemented, "applicable": applicable}))
        out.append(_s("control_effectiveness_pct", round(effective / n * 100, 1),
                      meta={"effective": effective, "total": n}))
        out.append(_s("control_test_coverage_pct", round(tested / n * 100, 1),
                      meta={"tested": tested, "total": n}))
    return _compact(out)


def evidence_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Total / freshness / approved / expiring-soon — matches the evidence
    dashboard summary (freshness% = 1 − stale/total)."""
    from ..models import Evidence
    q = db.query(Evidence).filter(Evidence.tenant_id.in_(tenant_ids))
    total = q.count()
    out = [_s("evidence_total", total)]
    if total:
        stale = q.filter(Evidence.is_stale.is_(True)).count()
        approved = q.filter(func.lower(Evidence.status) == "approved").count()
        out.append(_s("evidence_fresh_pct", round((1 - stale / total) * 100, 1),
                    meta={"stale": stale, "total": total}))
        out.append(_s("evidence_approved_pct", round(approved / total * 100, 1),
                    meta={"approved": approved, "total": total}))
    now = datetime.utcnow()
    expiring = q.filter(Evidence.expiry_date.isnot(None),
                        Evidence.expiry_date > now,
                        Evidence.expiry_date <= now + timedelta(days=30)).count()
    out.append(_s("evidence_expiring_soon", expiring))
    return _compact(out)


def vulnerability_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Open count (overall + by severity), open KEV, overdue, and MTTR — matches
    the vuln dashboard's open/overdue/mttr definitions."""
    from ..models import Vulnerability
    rows = db.query(Vulnerability).filter(Vulnerability.tenant_id.in_(tenant_ids)).all()
    open_rows = [v for v in rows if (v.status or "open") not in _VULN_RESOLVED]
    out = [_s("vuln_open", len(open_rows))]
    for sev in ("critical", "high", "medium", "low"):
        out.append(_s("vuln_open", sum(1 for v in open_rows if (v.severity or "").lower() == sev),
                      "severity", sev))
    out.append(_s("vuln_kev_open", sum(1 for v in open_rows if bool(getattr(v, "kev_flag", False)))))
    now = datetime.utcnow()
    out.append(_s("vuln_overdue", sum(1 for v in open_rows
                                       if v.due_date is not None and v.due_date < now)))
    resolved = [v for v in rows if v.resolved_at is not None and v.discovered_at is not None]
    if resolved:
        mttr = sum((v.resolved_at - v.discovered_at).days for v in resolved) / len(resolved)
        out.append(_s("vuln_mttr_days", round(mttr, 1)))
    return _compact(out)


def vendor_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Active vendors, portfolio residual/inherent, high-risk count, overdue
    reviews — matches the TPRA program dashboard kpis."""
    from ..models import Vendor
    vendors = (db.query(Vendor)
               .filter(Vendor.tenant_id.in_(tenant_ids),
                       Vendor.deleted_at.is_(None),
                       Vendor.status != "retired").all())
    n = len(vendors)
    out = [_s("vendor_active", n)]
    if n:
        res = [v.residual_risk_score for v in vendors if v.residual_risk_score is not None]
        inh = [v.inherent_risk_score for v in vendors if v.inherent_risk_score is not None]
        if res:
            out.append(_s("vendor_portfolio_residual", round(sum(res) / len(res), 1),
                          meta={"count": len(res)}))
        if inh:
            out.append(_s("vendor_portfolio_inherent", round(sum(inh) / len(inh), 1)))
        out.append(_s("vendor_high_risk", sum(1 for v in vendors if (v.residual_risk_score or 0) >= 50)))
    now = datetime.utcnow()
    out.append(_s("vendor_reviews_overdue",
                  sum(1 for v in vendors
                      if getattr(v, "next_reassessment_date", None) is not None
                      and v.next_reassessment_date < now)))
    return _compact(out)


def asset_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Total assets + high-value count — matches the asset dashboard."""
    from ..models import ITAsset
    rows = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tenant_ids)).all()
    high = sum(1 for a in rows if (a.criticality or "").lower() in ("high", "critical"))
    return _compact([_s("assets_total", len(rows)), _s("assets_high_value", high)])


def governance_samples(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Total docs, approved %, overdue reviews — matches the governance dashboard
    summary + overdue-reviews endpoints."""
    from ..models import GovernanceDocument
    q = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(tenant_ids))
    total = q.count()
    out = [_s("gov_docs_total", total)]
    if total:
        approved = q.filter(func.lower(GovernanceDocument.status).in_(("approved", "published"))).count()
        out.append(_s("gov_docs_approved_pct", round(approved / total * 100, 1),
                    meta={"approved": approved, "total": total}))
    now = datetime.utcnow()
    overdue = q.filter(GovernanceDocument.next_review_date.isnot(None),
                       GovernanceDocument.next_review_date < now,
                       func.lower(GovernanceDocument.status).in_(("approved", "published"))).count()
    out.append(_s("gov_reviews_overdue", overdue))
    return _compact(out)


_MODULE_FNS = (
    ("compliance", compliance_samples),
    ("controls", control_samples),
    ("evidence", evidence_samples),
    ("vulnerabilities", vulnerability_samples),
    ("vendors", vendor_samples),
    ("assets", asset_samples),
    ("governance", governance_samples),
)


def collect(db: Session, tenant_ids: List[int]) -> List[dict]:
    """Every cross-module sample for one tenant, each module independently guarded."""
    out: List[dict] = []
    for name, fn in _MODULE_FNS:
        try:
            out.extend(fn(db, tenant_ids))
        except Exception:  # noqa: BLE001 — never let one module break the snapshot
            logger.exception("cross-module metric block failed: %s", name)
    return out


# ── Backfill from modules that already keep their own history ─────────────────
def _month_points(today: date, months: int) -> List[date]:
    return [today - timedelta(days=m * 30) for m in range(months, -1, -1)]


def _backfill_compliance(db: Session, tenant_id: int, months: int) -> int:
    """Reconstruct monthly completion/readiness from grc_compliance_history — the
    per-journey point-in-time table that the framework charts already write."""
    from ..models import CertificationJourney, ComplianceHistory
    from ..services import metric_snapshots as ms
    journeys = (db.query(CertificationJourney)
                .filter(CertificationJourney.tenant_id == tenant_id).all())
    if not journeys:
        return 0
    hist: dict = {}
    for h in (db.query(ComplianceHistory)
              .filter(ComplianceHistory.journey_id.in_([j.id for j in journeys]))
              .order_by(ComplianceHistory.snapshot_day.asc()).all()):
        hist.setdefault(h.journey_id, []).append(h)

    def latest_leq(rows, d: date):
        picked = None
        for r in rows:
            rd = r.snapshot_day.date() if r.snapshot_day else None
            if rd is not None and rd <= d:
                picked = r
            elif rd is not None and rd > d:
                break
        return picked

    written = 0
    for d in _month_points(date.today(), months):
        comp_num = comp_den = 0.0
        readiness: List[float] = []
        for j in journeys:
            r = latest_leq(hist.get(j.id, []), d)
            if r is None:
                continue
            fw = (j.name or f"Journey {j.id}")[:120]
            ms.upsert(db, tenant_id, "compliance_completion_pct", d, round(r.completion_pct or 0, 1),
                      dimension="framework", dimension_value=fw); written += 1
            ms.upsert(db, tenant_id, "compliance_readiness_pct", d, round(r.readiness_pct or 0, 1),
                      dimension="framework", dimension_value=fw); written += 1
            tc = r.total_controls or 0
            comp_num += (r.completion_pct or 0) * tc
            comp_den += tc
            if r.readiness_pct is not None:
                readiness.append(r.readiness_pct)
        if comp_den > 0:
            ms.upsert(db, tenant_id, "compliance_completion_pct", d, round(comp_num / comp_den, 1)); written += 1
        if readiness:
            ms.upsert(db, tenant_id, "compliance_readiness_pct", d, round(sum(readiness) / len(readiness), 1)); written += 1
    return written


def _backfill_vendor(db: Session, tenant_id: int, months: int) -> int:
    """Reconstruct monthly vendor portfolio residual/inherent + count from the
    portfolio-scope rows of grc_tpra_risk_snapshots."""
    from ..models import TPRARiskSnapshot
    from ..services import metric_snapshots as ms
    rows = (db.query(TPRARiskSnapshot)
            .filter(TPRARiskSnapshot.tenant_id == tenant_id,
                    TPRARiskSnapshot.scope == "portfolio")
            .order_by(TPRARiskSnapshot.captured_at.asc()).all())
    if not rows:
        return 0

    def latest_leq(d: date):
        picked = None
        for r in rows:
            rd = r.captured_at.date() if r.captured_at else None
            if rd is not None and rd <= d:
                picked = r
            elif rd is not None and rd > d:
                break
        return picked

    written = 0
    for d in _month_points(date.today(), months):
        r = latest_leq(d)
        if r is None:
            continue
        if r.residual_score is not None:
            ms.upsert(db, tenant_id, "vendor_portfolio_residual", d, round(r.residual_score, 1)); written += 1
        if r.inherent_score is not None:
            ms.upsert(db, tenant_id, "vendor_portfolio_inherent", d, round(r.inherent_score, 1)); written += 1
        if r.vendor_count is not None:
            ms.upsert(db, tenant_id, "vendor_active", d, int(r.vendor_count)); written += 1
    return written


def backfill_cross(db: Session, tenant_id: int, months: int = 12) -> int:
    """Backfill real history for the modules that keep their own point-in-time
    tables. The remaining modules have no history source and simply start
    accumulating from the first daily snapshot."""
    written = 0
    for fn in (_backfill_compliance, _backfill_vendor):
        try:
            written += fn(db, tenant_id, months)
        except Exception:  # noqa: BLE001
            logger.exception("cross-module backfill failed: %s", getattr(fn, "__name__", "?"))
    db.commit()
    return written
