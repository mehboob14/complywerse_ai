"""TPRM program dashboard + risk-trend API.

Read-only aggregation over the live TPRA tables (vendors, findings, signals) and
the RiskSnapshot time-series. Powers the executive dashboard's KPI cards and
charts (tier donut, inherent-vs-residual bars, findings posture/severity/domain,
top-residual vendors, monitoring feed) and the risk-over-time trend. Role-aware
via `scope=portfolio|mine`. Mounted under /vendor-risk/tpra.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import asc, desc, or_
from sqlalchemy.orm import Session

from ....models import (
    get_db, GRCUser, Vendor, TPRAFinding, TPRARemediation,
    TPRAMonitoringSignal, TPRARiskSnapshot,
)
from ....routers.auth_router import require_auth, get_user_tenants
from .engine_scoring import residual_to_grade
from .bootstrap import get_tiering_config

router = APIRouter(prefix="/tpra", tags=["TPRA Dashboard"])

_TIERS = ["critical", "high", "medium", "low"]
_OPEN_F = ("open", "in_remediation")
_DEFAULT_APPETITE = 45.0


def _avg(xs: List[float]) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def _tids(user: GRCUser, db: Session) -> List[int]:
    return get_user_tenants(user, db) or [-1]


@router.get("/dashboard")
def program_dashboard(
    scope: str = Query("portfolio", pattern="^(portfolio|mine)$"),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """KPI cards + chart datasets, computed live. `scope=mine` filters to the
    vendors the caller owns (analyst queue); `portfolio` is the exec view."""
    tids = _tids(user, db)
    now = datetime.utcnow()

    vq = db.query(Vendor).filter(
        Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None), Vendor.status != "retired",
    )
    if scope == "mine":
        vq = vq.filter(Vendor.owner_id == user.id)
    vendors = vq.all()
    vids = [v.id for v in vendors] or [-1]

    # ── Tier distribution + inherent-vs-residual by tier ──
    tiers = {t: 0 for t in _TIERS}
    by_tier = {t: {"inh": [], "res": []} for t in _TIERS}
    for v in vendors:
        t = (v.tier or "low").lower()
        if t in tiers:
            tiers[t] += 1
            by_tier[t]["inh"].append(v.inherent_risk_score)
            by_tier[t]["res"].append(v.residual_risk_score)
    inherent_vs_residual = [
        {"tier": t, "inherent": _avg(by_tier[t]["inh"]) or 0, "residual": _avg(by_tier[t]["res"]) or 0}
        for t in _TIERS
    ]

    # ── Portfolio inherent/residual + critical coverage ──
    port_inh = _avg([v.inherent_risk_score for v in vendors]) or 0
    port_res = _avg([v.residual_risk_score for v in vendors]) or 0
    crit = [v for v in vendors if (v.tier or "").lower() == "critical"]
    covered = [v for v in crit if v.residual_risk_score is not None]
    coverage = round(len(covered) / len(crit) * 100) if crit else 100

    # ── Findings posture / severity / domain ──
    fq = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None),
    )
    if scope == "mine":
        fq = fq.filter(TPRAFinding.vendor_id.in_(vids))
    findings = fq.all()
    posture = {"open": 0, "in_remediation": 0, "accepted": 0, "closed": 0}
    severity = {t: 0 for t in _TIERS}
    by_domain: dict = {}
    for f in findings:
        posture[f.status] = posture.get(f.status, 0) + 1
        s = (f.severity or "medium").lower()
        if s in severity:
            severity[s] += 1
        if f.status in _OPEN_F:
            by_domain[f.domain] = by_domain.get(f.domain, 0) + 1
    open_findings = [f for f in findings if f.status in _OPEN_F]
    open_crit = [f for f in open_findings if (f.severity or "").lower() == "critical"]
    closed = [f for f in findings if f.status in ("closed", "accepted")]
    closure_rate = round(len(closed) / len(findings) * 100) if findings else 0

    # Overdue = open finding with a non-complete remediation past due.
    open_fids = [f.id for f in open_findings] or [-1]
    overdue_fids = {
        r.finding_id for r in db.query(TPRARemediation).filter(
            TPRARemediation.finding_id.in_(open_fids),
            TPRARemediation.deleted_at.is_(None),
            TPRARemediation.due_date.isnot(None),
            TPRARemediation.due_date < now,
            TPRARemediation.status != "completed",
        ).all()
    }
    open_crit_overdue = sum(1 for f in open_crit if f.id in overdue_fids)

    # ── Reviews due / overdue ──
    reviews_due = sum(1 for v in vendors if v.next_reassessment_date
                      and 0 <= (v.next_reassessment_date - now).days <= 30)
    overdue_reviews = sum(1 for v in vendors if v.next_reassessment_date
                          and (v.next_reassessment_date - now).days < 0)

    # ── Monitoring feed (latest signals) ──
    sq = db.query(TPRAMonitoringSignal).filter(
        TPRAMonitoringSignal.tenant_id.in_(tids), TPRAMonitoringSignal.deleted_at.is_(None),
    )
    if scope == "mine":
        sq = sq.filter(TPRAMonitoringSignal.vendor_id.in_(vids))
    signals = sq.order_by(TPRAMonitoringSignal.occurred_at.desc()).limit(12).all()
    vname = {v.id: v.name for v in vendors}
    feed = [{
        "id": s.id, "vendor_id": s.vendor_id, "vendor_name": vname.get(s.vendor_id),
        "signal_type": s.signal_type, "severity": s.severity, "title": s.title,
        "source": s.source, "occurred_at": s.occurred_at.isoformat() if s.occurred_at else None,
        "acknowledged": s.acknowledged, "triggered_reassessment": s.triggered_reassessment,
    } for s in signals]
    new_signals = sum(1 for s in signals if not s.acknowledged)

    # ── Onboarded this period (last 30 days) ──
    onboarded_30 = sum(1 for v in vendors if v.created_at and (now - v.created_at).days <= 30)

    # ── Top-residual vendors ──
    top = sorted([v for v in vendors if v.residual_risk_score is not None],
                 key=lambda v: v.residual_risk_score, reverse=True)[:8]
    top_vendors = [{
        "id": v.id, "name": v.name, "tier": v.tier,
        "residual": v.residual_risk_score, "inherent": v.inherent_risk_score,
        "rating": v.risk_rating, "grade": residual_to_grade(v.residual_risk_score)
        if v.residual_risk_score is not None else None,
    } for v in top]

    return {
        "scope": scope,
        "kpis": {
            "active_vendors": len(vendors),
            "onboarded_this_period": onboarded_30,
            "critical_coverage": coverage,
            "critical_count": len(crit),
            "critical_covered": len(covered),
            "portfolio_inherent": port_inh,
            "portfolio_residual": port_res,
            "open_critical_findings": len(open_crit),
            "open_critical_overdue": open_crit_overdue,
            "closure_rate": closure_rate,
            "reviews_due_30d": reviews_due,
            "overdue_reviews": overdue_reviews,
            "new_signals": new_signals,
        },
        "tier_distribution": tiers,
        "inherent_vs_residual": inherent_vs_residual,
        "findings_posture": posture,
        "findings_severity": severity,
        "findings_by_domain": by_domain,
        "monitoring_feed": feed,
        "top_residual_vendors": top_vendors,
    }


@router.get("/risk-trend")
def risk_trend(
    scope: str = Query("portfolio", pattern="^(portfolio|vendor)$"),
    vendor_id: Optional[int] = Query(None),
    months: int = Query(12, ge=1, le=24),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Risk-over-time series from RiskSnapshot (monthly buckets, latest per month),
    with the risk-appetite threshold line."""
    tids = _tids(user, db)
    since = datetime.utcnow() - timedelta(days=months * 31)

    q = db.query(TPRARiskSnapshot).filter(
        TPRARiskSnapshot.tenant_id.in_(tids),
        TPRARiskSnapshot.captured_at >= since,
    )
    if scope == "vendor" and vendor_id:
        q = q.filter(TPRARiskSnapshot.scope == "vendor", TPRARiskSnapshot.vendor_id == vendor_id)
    else:
        q = q.filter(TPRARiskSnapshot.scope == "portfolio")
    snaps = q.order_by(TPRARiskSnapshot.captured_at.asc()).all()

    # Monthly bucket → keep the latest snapshot in each month.
    buckets: dict = {}
    for s in snaps:
        key = s.captured_at.strftime("%Y-%m")
        buckets[key] = s  # ordered asc, so last write wins = latest in month
    series = [{
        "month": k,
        "inherent": buckets[k].inherent_score,
        "residual": buckets[k].residual_score,
    } for k in sorted(buckets.keys())]

    cfg = get_tiering_config(db, tids[0]) if tids and tids[0] > 0 else {}
    appetite = float((cfg or {}).get("appetite") or _DEFAULT_APPETITE)

    return {"scope": scope, "vendor_id": vendor_id, "appetite": appetite, "series": series}


def _overdue_finding_ids(db: Session, tids: List[int], now: datetime) -> set:
    """Finding ids with a non-complete remediation past its due date."""
    return {
        r.finding_id for r in db.query(TPRARemediation.finding_id).filter(
            TPRARemediation.tenant_id.in_(tids),
            TPRARemediation.deleted_at.is_(None),
            TPRARemediation.due_date.isnot(None),
            TPRARemediation.due_date < now,
            TPRARemediation.status != "completed",
        ).all()
    }


@router.get("/findings-register")
def findings_register(
    status_filter: Optional[str] = Query(None, alias="status"),
    severity: Optional[str] = Query(None),
    domain: Optional[str] = Query(None),
    vendor_id: Optional[int] = Query(None),
    overdue_only: bool = Query(False),
    sort: str = Query("created_at"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Cross-portfolio findings register — every gap across vendors, with vendor
    name, SLA due date and overdue flag. Filter / sort / paginate."""
    tids = _tids(user, db)
    now = datetime.utcnow()
    overdue_ids = _overdue_finding_ids(db, tids, now)

    q = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None),
    )
    if status_filter:
        q = q.filter(TPRAFinding.status == status_filter)
    if severity:
        q = q.filter(TPRAFinding.severity == severity)
    if domain:
        q = q.filter(TPRAFinding.domain == domain)
    if vendor_id:
        q = q.filter(TPRAFinding.vendor_id == vendor_id)
    if overdue_only:
        q = q.filter(TPRAFinding.id.in_(overdue_ids or [-1]))

    total = q.count()
    sort_col = {
        "created_at": TPRAFinding.created_at, "severity": TPRAFinding.severity,
        "status": TPRAFinding.status, "domain": TPRAFinding.domain,
    }.get(sort, TPRAFinding.created_at)
    q = q.order_by(desc(sort_col) if order == "desc" else asc(sort_col))
    rows = q.offset(skip).limit(limit).all()

    fids = [f.id for f in rows] or [-1]
    vids = {f.vendor_id for f in rows} or {-1}
    vname = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(vids)).all())
    # Earliest remediation due-date per finding (for the page).
    due_by_finding: dict = {}
    for fid, due in db.query(TPRARemediation.finding_id, TPRARemediation.due_date).filter(
        TPRARemediation.finding_id.in_(fids), TPRARemediation.deleted_at.is_(None),
        TPRARemediation.due_date.isnot(None),
    ).all():
        cur = due_by_finding.get(fid)
        if cur is None or due < cur:
            due_by_finding[fid] = due

    items = [{
        "id": f.id, "vendor_id": f.vendor_id, "vendor_name": vname.get(f.vendor_id),
        "assessment_id": f.assessment_id, "domain": f.domain, "severity": f.severity,
        "title": f.title, "status": f.status, "is_critical_control_fail": f.is_critical_control_fail,
        "due_date": due_by_finding[f.id].isoformat() if f.id in due_by_finding else None,
        "overdue": f.id in overdue_ids,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    } for f in rows]
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.get("/risk-register")
def third_party_risk_register(
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Third-party risks from the enterprise Risk Register (Risk 360° integration).
    These are the real `Risk` rows the TPRA lifecycle rolls up (category='third_party'),
    linked back to their vendor — not TPRA-internal findings."""
    from ....models import Risk  # lazy: avoid cross-module import cost at boot
    tids = _tids(user, db)
    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(tids),
        or_(
            Risk.category == "third_party",
            Risk.risk_category == "third_party",
            Risk.register_type == "Third-Party Risk",
            Risk.source_reference.like("vendor:%"),
        ),
    ).all()
    vname = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.tenant_id.in_(tids)).all())

    items = []
    for r in risks:
        vid = None
        if r.source_reference and r.source_reference.startswith("vendor:"):
            try:
                vid = int(r.source_reference.split(":", 1)[1].split("/", 1)[0])
            except (ValueError, IndexError):
                vid = None
        items.append({
            "id": r.id, "title": r.title, "vendor_id": vid, "vendor_name": vname.get(vid),
            "tier": r.risk_sub_category, "inherent_score": r.inherent_score,
            "residual_score": r.residual_score, "status": r.status,
            "register_type": r.register_type, "owner_id": r.owner_id,
            "source_type": r.source_type, "source_reference": r.source_reference,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        })
    items.sort(key=lambda x: (x["residual_score"] is not None, x["residual_score"] or 0), reverse=True)

    open_n = sum(1 for r in risks if (r.status or "open") not in ("closed",))
    residuals = [r.residual_score for r in risks if r.residual_score is not None]
    return {
        "items": items,
        "total": len(items),
        "open": open_n,
        "avg_residual": round(sum(residuals) / len(residuals), 1) if residuals else None,
    }


@router.get("/monitoring-feed")
def monitoring_feed(
    severity: Optional[str] = Query(None),
    signal_type: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    vendor_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Portfolio monitoring feed — outside-in signals across all vendors, newest
    first. Filter / paginate."""
    tids = _tids(user, db)
    q = db.query(TPRAMonitoringSignal).filter(
        TPRAMonitoringSignal.tenant_id.in_(tids), TPRAMonitoringSignal.deleted_at.is_(None),
    )
    if severity:
        q = q.filter(TPRAMonitoringSignal.severity == severity)
    if signal_type:
        q = q.filter(TPRAMonitoringSignal.signal_type == signal_type)
    if acknowledged is not None:
        q = q.filter(TPRAMonitoringSignal.acknowledged.is_(acknowledged))
    if vendor_id:
        q = q.filter(TPRAMonitoringSignal.vendor_id == vendor_id)

    total = q.count()
    rows = q.order_by(desc(TPRAMonitoringSignal.occurred_at)).offset(skip).limit(limit).all()
    vids = {s.vendor_id for s in rows} or {-1}
    vname = dict(db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(vids)).all())
    items = [{
        "id": s.id, "vendor_id": s.vendor_id, "vendor_name": vname.get(s.vendor_id),
        "signal_type": s.signal_type, "severity": s.severity, "title": s.title,
        "source": s.source, "detail": s.detail,
        "occurred_at": s.occurred_at.isoformat() if s.occurred_at else None,
        "acknowledged": s.acknowledged, "triggered_reassessment": s.triggered_reassessment,
    } for s in rows]
    return {"items": items, "total": total, "skip": skip, "limit": limit}
