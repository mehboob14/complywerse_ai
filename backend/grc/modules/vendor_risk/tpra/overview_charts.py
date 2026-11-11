"""The charts of the Third-Party Vendor Risk Overview: the aggregates the program dashboard does not carry.

Read-only, computed live, for the same vendors the dashboard counts (`scope=portfolio|mine`, requests and archived or
retired suppliers left out) and classified the way the register classifies them, so a chart and the tile beside it agree:

* `risk_matrix`: vendors by tier (the untiered apart, as `tier_counts`) and by the band of their residual score on the
  tenant's own thresholds (Setup > Policy; shipped 75 / 50 / 25), those without a score apart;
* `reviews`: when the next reassessment falls, by tier: overdue (the register's definition: the earliest of the
  supplier's own date and its open engagements' dates is before today), in 30, 60 and 90 days, later, or no date.
  Suspended, offboarding and out-of-use suppliers are not in it (`apart`), as they are not in the "Reassessment overdue"
  tile: the register shows them as what they are;
* `stages`: where each supplier is in its review (the stage of its General assessment), in the lifecycle's order;
* `findings`: severity by status, the open ones by age, and the open ones with a fix past its date;
* `signals`: monitoring signals by month (the last six) and by severity, and those still waiting for a decision.

Mounted under /vendor-risk/tpra (a new route: no existing JSON changes).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Dict, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ....models import (
    GRCUser, TPRAEngagement, TPRAFinding, TPRAMonitoringSignal, TPRARemediation, Vendor, VendorAssessment, get_db,
)
from ....routers.auth_router import require_auth
from .alerts import _open_clause
from .bootstrap import DEFAULT_TIERING_CONFIG, get_tiering_config
from .dashboard import _OPEN_F, _REQUESTS, _TIERS, _prep_tpra_db, _tids
from .engine_tiering import score_to_tier
from .stages import STAGE_KEYS, stage_label

router = APIRouter(prefix="/tpra", tags=["TPRA Dashboard"])

BANDS = ("critical", "high", "medium", "low", "none")
TIER_ROWS = (*_TIERS, "not_tiered")
BUCKETS = ("overdue", "d30", "d60", "d90", "later", "none")
STATUSES = ("open", "in_remediation", "accepted", "closed")
AGES = ("d30", "d60", "d90", "older")
SEVERITIES = _TIERS
MONTHS = 6
# Suppliers the register gives no review to: out of use, offboarding or suspended.
_APART = ("retired", "inactive", "terminated", "requested", "rejected", "offboarded", "suspended")


def _day(value):
    return value.date() if isinstance(value, datetime) else value


def _grid(rows, cols) -> Dict[str, Dict[str, int]]:
    return {r: {c: 0 for c in cols} for r in rows}


def _month_keys(today: date, n: int) -> List[str]:
    keys, y, m = [], today.year, today.month
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return keys[::-1]


@router.get("/overview-charts")
def overview_charts(
    scope: str = Query("portfolio", pattern="^(portfolio|mine)$"),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Chart datasets of the Overview, computed live. Every list is in a fixed order and every count is a whole number;
    a grid has every row and column, zeros included, so a page draws what the server counted and never fills a gap."""
    from ..routers.vendors import lifecycle_notes          # late: that router imports this package

    tids = _tids(user, db)
    _prep_tpra_db(db, tids)
    now = datetime.utcnow()
    today = now.date()

    vq = db.query(Vendor).filter(
        Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None), Vendor.status != "retired",
        or_(Vendor.intake_status.is_(None), Vendor.intake_status.notin_(_REQUESTS)),
    )
    if scope == "mine":
        vq = vq.filter(Vendor.owner_id == user.id)
    vendors = vq.all()
    vids = [v.id for v in vendors] or [-1]
    thresholds = (get_tiering_config(db, tids[0]).get("thresholds") if tids[0] > 0 else None) \
        or DEFAULT_TIERING_CONFIG["thresholds"]

    # ── each supplier's tier (the register's: untiered until an inherent score or a tier on an assessment under way) ──
    unscored = [v.id for v in vendors if v.inherent_risk_score is None]
    assessed = {vid for (vid,) in db.query(VendorAssessment.vendor_id).filter(
        VendorAssessment.vendor_id.in_(unscored or [-1]), VendorAssessment.lifecycle_status == "active",
        VendorAssessment.deleted_at.is_(None), VendorAssessment.inherent_tier.isnot(None))}

    def tier_of(v: Vendor) -> str:
        if v.inherent_risk_score is None and v.id not in assessed:
            return "not_tiered"
        t = (v.tier or "").lower()
        return t if t in _TIERS else "not_tiered"

    tier = {v.id: tier_of(v) for v in vendors}

    # ── tier by residual band ──
    matrix = _grid(TIER_ROWS, BANDS)
    for v in vendors:
        band = "none" if v.residual_risk_score is None else score_to_tier(v.residual_risk_score, thresholds)
        matrix[tier[v.id]][band] += 1

    # ── when the next review falls ──
    dates: Dict[int, List[date]] = defaultdict(list)
    for v in vendors:
        if v.next_reassessment_date:
            dates[v.id].append(_day(v.next_reassessment_date))
    for vid, at in db.query(TPRAEngagement.vendor_id, TPRAEngagement.next_reassessment_date).filter(
            TPRAEngagement.vendor_id.in_(vids), TPRAEngagement.is_general.is_(False), TPRAEngagement.status != "ended",
            TPRAEngagement.next_reassessment_date.isnot(None)):
        dates[vid].append(_day(at))
    reviews = _grid(BUCKETS, TIER_ROWS)
    apart = 0
    for v in vendors:
        if (v.status or "").lower() in _APART:
            apart += 1
            continue
        due = min(dates[v.id]) if dates.get(v.id) else None
        if due is None:
            bucket = "none"
        else:
            days = (due - today).days
            bucket = "overdue" if days < 0 else "d30" if days <= 30 else "d60" if days <= 60 else "d90" if days <= 90 else "later"
        reviews[bucket][tier[v.id]] += 1

    # ── where each supplier is in its review ──
    life = lifecycle_notes(db, vendors)
    by_stage = {k: 0 for k in STAGE_KEYS}
    not_started = 0
    for v in vendors:
        if (v.status or "").lower() in ("retired", "inactive", "terminated", "requested", "rejected", "offboarded"):
            continue
        stage = (life.get(v.id) or {}).get("stage")
        if stage in by_stage:
            by_stage[stage] += 1
        else:
            not_started += 1

    # ── findings ──
    archived = select(Vendor.id).where(Vendor.tenant_id.in_(tids), Vendor.deleted_at.isnot(None))
    fq = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None), ~TPRAFinding.vendor_id.in_(archived))
    if scope == "mine":
        fq = fq.filter(TPRAFinding.vendor_id.in_(vids))
    findings = fq.all()
    open_ids = [f.id for f in findings if f.status in _OPEN_F]
    late = {r for (r,) in db.query(TPRARemediation.finding_id).filter(
        TPRARemediation.finding_id.in_(open_ids or [-1]), TPRARemediation.deleted_at.is_(None),
        TPRARemediation.due_date.isnot(None), TPRARemediation.due_date < now, TPRARemediation.status != "completed")}
    f_matrix, f_age, f_late = _grid(SEVERITIES, STATUSES), _grid(SEVERITIES, AGES), {s: 0 for s in SEVERITIES}
    for f in findings:
        sev = (f.severity or "medium").lower()
        if sev not in f_matrix or f.status not in STATUSES:
            continue
        f_matrix[sev][f.status] += 1
        if f.status in _OPEN_F:
            old = (today - f.created_at.date()).days if f.created_at else 0
            f_age[sev]["d30" if old <= 30 else "d60" if old <= 60 else "d90" if old <= 90 else "older"] += 1
            if f.id in late:
                f_late[sev] += 1

    # ── monitoring signals ──
    sig = TPRAMonitoringSignal
    sq = db.query(sig.severity, sig.occurred_at, sig.id).filter(
        sig.tenant_id.in_(tids), sig.deleted_at.is_(None), ~sig.vendor_id.in_(archived), sig.verified.isnot(False))
    if scope == "mine":
        sq = sq.filter(sig.vendor_id.in_(vids))
    months = _month_keys(today, MONTHS)
    by_month = {m: {s: 0 for s in SEVERITIES} for m in months}
    since = datetime(int(months[0][:4]), int(months[0][5:]), 1)
    for severity, at, _id in sq.filter(sig.occurred_at >= since):
        key = at.strftime("%Y-%m") if at else None
        if key in by_month:
            s = (severity or "medium").lower()
            by_month[key][s if s in SEVERITIES else "low"] += 1
    waiting = {s: 0 for s in SEVERITIES}
    for severity, _at, _id in sq.filter(_open_clause()):
        s = (severity or "medium").lower()
        waiting[s if s in SEVERITIES else "low"] += 1

    return {
        "scope": scope, "as_of": today.isoformat(), "thresholds": thresholds,
        "risk_matrix": {"tiers": list(TIER_ROWS), "bands": list(BANDS), "cells": matrix},
        "reviews": {"buckets": list(BUCKETS), "tiers": list(TIER_ROWS), "cells": reviews, "apart": apart},
        "stages": {"items": [{"key": k, "label": stage_label(k), "count": by_stage[k]} for k in STAGE_KEYS],
                   "not_started": not_started},
        "findings": {"severities": list(SEVERITIES), "statuses": list(STATUSES), "matrix": f_matrix,
                     "ages": list(AGES), "age": f_age, "overdue": f_late},
        "signals": {"months": [{"month": m, **by_month[m]} for m in months], "waiting": waiting},
    }
