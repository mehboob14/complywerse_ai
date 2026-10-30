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
from sqlalchemy import and_, asc, case, desc, func, or_, select
from sqlalchemy.orm import Session

from ....models import (
    get_db, GRCUser, Vendor, VendorAssessment, TPRAFinding, TPRARemediation,
    TPRAMonitoringSignal, TPRARiskSnapshot,
)
from ....routers.auth_router import require_auth, get_user_tenants
from . import intake
from . import findings
from .engine_scoring import grade_for
from .bootstrap import get_tiering_config, ensure_tpra_tenant_defaults
from .schema_migrations import ensure_tpra_columns
from .attention import queue as attention_queue

router = APIRouter(prefix="/tpra", tags=["TPRA Dashboard"])
# The module's header counts (/vendor-risk/portfolio/counts) belong to no tpra/ page, so they sit outside its prefix.
portfolio_router = APIRouter(prefix="/portfolio", tags=["TPRA Dashboard"])

_TIERS = ["critical", "high", "medium", "low"]
_OPEN_F = ("open", "in_remediation")
_DEFAULT_APPETITE = 45.0
_REQUESTS = ("draft", "submitted", "rejected")      # onboarding requests the register leaves out unless asked for


def _avg(xs: List[float]) -> Optional[float]:
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 1) if xs else None


def _tids(user: GRCUser, db: Session) -> List[int]:
    return get_user_tenants(user, db) or [-1]


def _prep_tpra_db(db: Session, tids: List[int]) -> None:
    ensure_tpra_columns(db)
    if tids and tids[0] > 0:
        ensure_tpra_tenant_defaults(db, tids[0])


def _register_view(db: Session, vendors: List[Vendor], today) -> dict:
    """The portfolio as the register lists it, for the Overview's tiles and cards (each links to the register
    filtered the same way): suppliers in use only, not requests still to be picked up or turned down."""
    from ..routers.vendors import NEXT_ACTIONS, _OUT_OF_USE, register_notes      # late: that router imports this package

    in_use = [v for v in vendors if (v.intake_status or "") not in _REQUESTS]
    notes = register_notes(db, in_use, today)
    seen: dict = {}
    for v in in_use:
        code = (notes[v.id]["next_action"] or {}).get("code")
        if code:
            seen[code] = seen.get(code, 0) + 1
    attention_counts = {code: seen[code] for code in NEXT_ACTIONS if code in seen}

    # Tiered: an inherent score, or a tier computed on an assessment under way (what next_action goes by).
    unscored = [v.id for v in in_use if v.inherent_risk_score is None]
    assessed = {vid for (vid,) in db.query(VendorAssessment.vendor_id).filter(
        VendorAssessment.vendor_id.in_(unscored or [-1]), VendorAssessment.lifecycle_status == "active",
        VendorAssessment.deleted_at.is_(None), VendorAssessment.inherent_tier.isnot(None))}
    tier_counts = {**{t: 0 for t in _TIERS}, "not_tiered": 0}
    by_status: dict = {}
    for v in in_use:
        if v.inherent_risk_score is None and v.id not in assessed:
            tier_counts["not_tiered"] += 1
        elif (v.tier or "").lower() in _TIERS:
            tier_counts[v.tier.lower()] += 1
        by_status[v.status or "unset"] = by_status.get(v.status or "unset", 0) + 1

    # Coverage is asked of the suppliers a short cadence applies to, still in use: critical and high, whose next
    # reassessment is not past. One with no date is outside it.
    held = [v for v in in_use if (v.tier or "").lower() in ("critical", "high")
            and (v.status or "").lower() not in (*_OUT_OF_USE, "offboarded")]
    inside = sum(1 for v in held if v.next_reassessment_date is not None and v.next_reassessment_date.date() >= today)
    return {
        "not_tiered": attention_counts.get("not_tiered", 0),
        "no_owner": sum(1 for v in in_use if not v.owner_id),
        "reassessment_overdue": attention_counts.get("reassessment_overdue", 0),
        "attention_counts": attention_counts,
        "by_status": by_status,
        "tier_counts": tier_counts,
        "coverage": {"in_window": inside, "total": len(held),
                     "percent": round(inside / len(held) * 100) if held else None},
    }


def _intake_pending(db: Session, tids: List[int]) -> dict:
    """Onboarding requests waiting for review, longest waiting first: how many, and the first four. `duplicate` says
    another supplier on record (archived ones too) has the request's name or website."""
    q = db.query(Vendor).filter(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None),
                                Vendor.intake_status == "submitted")
    total = q.count()
    rows = q.order_by(Vendor.submitted_at.asc().nullslast(), Vendor.created_at.asc(), Vendor.id.asc()).limit(4).all()
    if not rows:
        return {"total": total, "items": []}
    on_record = [(r.id, intake.name_key(r.name), intake.host(r.website))
                 for r in db.query(Vendor.id, Vendor.name, Vendor.website).filter(Vendor.tenant_id.in_(tids))]
    people = {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(
        GRCUser.id.in_({v.requested_by for v in rows if v.requested_by} or {-1}))}
    items = []
    for v in rows:
        key, site = intake.name_key(v.name), intake.host(v.website)
        items.append({
            "id": v.id, "name": v.name, "requested_by": people.get(v.requested_by), "requested_by_id": v.requested_by,
            "submitted_at": (v.submitted_at or v.created_at).isoformat() if (v.submitted_at or v.created_at) else None,
            "duplicate": any(vid != v.id and ((key and key == k) or (site and site == h)) for vid, k, h in on_record),
        })
    return {"total": total, "items": items}


@router.get("/dashboard")
def program_dashboard(
    scope: str = Query("portfolio", pattern="^(portfolio|mine)$"),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """KPI cards + chart datasets, computed live. `scope=mine` filters to the
    vendors the caller owns (analyst queue); `portfolio` is the exec view."""
    tids = _tids(user, db)
    _prep_tpra_db(db, tids)
    now = datetime.utcnow()

    vq = db.query(Vendor).filter(
        Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None), Vendor.status != "retired",
        or_(Vendor.intake_status.is_(None), Vendor.intake_status.notin_(_REQUESTS)),     # requests are not suppliers yet
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
    # An archived supplier's findings and signals are not counted, as the supplier itself is not.
    archived = select(Vendor.id).where(Vendor.tenant_id.in_(tids), Vendor.deleted_at.isnot(None))
    fq = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None), ~TPRAFinding.vendor_id.in_(archived),
    )
    if scope == "mine":
        fq = fq.filter(TPRAFinding.vendor_id.in_(vids))
    findings = fq.all()
    posture = {"open": 0, "in_remediation": 0, "accepted": 0, "closed": 0}
    severity = {t: 0 for t in _TIERS}
    by_domain: dict = {}
    for f in findings:
        posture[f.status] = posture.get(f.status, 0) + 1
        if f.status in _OPEN_F:                 # severity and domain count what is open, not what is closed or accepted
            s = (f.severity or "medium").lower()
            if s in severity:
                severity[s] += 1
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
        ~TPRAMonitoringSignal.vendor_id.in_(archived),
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

    # ── Top-residual vendors (the grade never reads better than the rating beside it) ──
    top = sorted([v for v in vendors if v.residual_risk_score is not None],
                 key=lambda v: v.residual_risk_score, reverse=True)[:8]
    thresholds = get_tiering_config(db, tids[0]).get("thresholds") if tids[0] > 0 else None
    top_vendors = [{
        "id": v.id, "name": v.name, "tier": v.tier,
        "residual": v.residual_risk_score, "inherent": v.inherent_risk_score,
        "rating": v.risk_rating, "grade": grade_for(v.residual_risk_score, v.risk_rating, thresholds),
    } for v in top]

    # The attention tile asks the queue itself, so the two always agree.
    attention = attention_queue(db, tids[0], user.id, scope=scope)["counts"] if tids[0] > 0 else {}

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
            "attention_open": attention.get("open", 0),
            "attention_urgent": attention.get("urgent", 0),
        },
        "tier_distribution": tiers,
        "inherent_vs_residual": inherent_vs_residual,
        "findings_posture": posture,
        "findings_severity": severity,
        "findings_by_domain": by_domain,
        "monitoring_feed": feed,
        "top_residual_vendors": top_vendors,
        # The Overview's tiles and cards, each a link to the register filtered the same way (TPRM parity).
        **_register_view(db, vendors, now.date()),
        "intake_pending": _intake_pending(db, tids),
    }


@portfolio_router.get("/counts")
def portfolio_counts(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """What the module header and the rail show: suppliers in use as the register lists them, how many are critical,
    the findings still open (open or in remediation), and the requests waiting for review. Cheap, and read-only."""
    tids = _tids(user, db)
    in_use = and_(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None),
                  or_(Vendor.intake_status.is_(None), Vendor.intake_status.in_(("in_review", "approved"))))
    archived = select(Vendor.id).where(Vendor.tenant_id.in_(tids), Vendor.deleted_at.isnot(None))

    def count(*clauses) -> int:
        return db.query(func.count(Vendor.id)).filter(*clauses).scalar() or 0

    return {
        "vendors": count(in_use),
        "critical": count(in_use, Vendor.tier == "critical"),
        "open_findings": db.query(func.count(TPRAFinding.id)).filter(
            TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None), TPRAFinding.status.in_(_OPEN_F),
            ~TPRAFinding.vendor_id.in_(archived)).scalar() or 0,
        "intake_pending": count(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None),
                                Vendor.intake_status == "submitted"),
    }


@portfolio_router.get("/units")
def portfolio_units(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The business units the register can be filtered by: the ones a supplier sits in, by name. Read-only (the tenant
    list in /tenants/{id}/business-units seeds demo units on a GET, which a page of filters must not do)."""
    from ....models import BusinessUnit             # late: this file's import block is shared with other pieces

    tids = _tids(user, db)
    rows = (db.query(BusinessUnit.id, BusinessUnit.name).join(Vendor, Vendor.business_unit_id == BusinessUnit.id)
            .filter(BusinessUnit.tenant_id.in_(tids), Vendor.tenant_id.in_(tids))
            .distinct().order_by(BusinessUnit.name, BusinessUnit.id))
    return {"items": [{"id": uid, "name": name} for uid, name in rows]}


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
    _prep_tpra_db(db, tids)
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
    scope: str = Query("all", pattern="^(open|accepted|closed|all)$"),
    sort: str = Query("created_at"),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: GRCUser = Depends(require_auth),
):
    """Cross-portfolio findings register — every gap across vendors, with vendor
    name, SLA due date and overdue flag. Filter / sort / paginate. `scope` is open
    (open + in remediation), accepted, closed or all; `status` still asks for one
    status. `blocking_total` counts the open findings that hold the approval gate,
    whatever the scope. `sort` also takes vendor, owner and due (the earliest fix
    date, none last); severity sorts by seriousness, so desc is the worst first."""
    tids = _tids(user, db)
    _prep_tpra_db(db, tids)
    now = datetime.utcnow()
    overdue_ids = _overdue_finding_ids(db, tids, now)

    q = db.query(TPRAFinding).filter(
        TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None),
    )
    if severity:
        q = q.filter(TPRAFinding.severity == severity)
    if domain:
        q = q.filter(TPRAFinding.domain == domain)
    if vendor_id:
        q = q.filter(TPRAFinding.vendor_id == vendor_id)
    blocking_total = q.filter(TPRAFinding.status.in_(_OPEN_F), TPRAFinding.is_blocking.is_(True)).count()
    if status_filter:
        q = q.filter(TPRAFinding.status == status_filter)
    if scope != "all":
        q = q.filter(TPRAFinding.status.in_(_OPEN_F if scope == "open" else (scope,)))
    if overdue_only:
        q = q.filter(TPRAFinding.id.in_(overdue_ids or [-1]))

    total = q.count()
    sort_col = {
        "created_at": TPRAFinding.created_at, "status": TPRAFinding.status, "domain": TPRAFinding.domain,
        # worst = highest: critical 4 … low 1, so `desc` lists the worst first
        "severity": case((TPRAFinding.severity == "critical", 4), (TPRAFinding.severity == "high", 3),
                         (TPRAFinding.severity == "medium", 2), (TPRAFinding.severity == "low", 1), else_=0),
    }.get(sort)
    if sort == "vendor":
        q = q.join(Vendor, Vendor.id == TPRAFinding.vendor_id)
        sort_col = func.lower(Vendor.name)
    elif sort == "owner":
        q = q.outerjoin(GRCUser, GRCUser.id == TPRAFinding.owner_id)
        sort_col = func.lower(func.coalesce(GRCUser.display_name, GRCUser.username))
    elif sort == "due":
        sort_col = (select(func.min(TPRARemediation.due_date))
                    .where(TPRARemediation.finding_id == TPRAFinding.id, TPRARemediation.deleted_at.is_(None),
                           TPRARemediation.status != "completed")
                    .correlate(TPRAFinding).scalar_subquery())
    elif sort_col is None:
        sort_col = TPRAFinding.created_at
    ordered = desc(sort_col) if order == "desc" else asc(sort_col)
    if sort in ("owner", "due"):
        ordered = ordered.nulls_last()          # nobody, and no date, come last whichever way it runs
    # the other sorts are as they were; a list ends in a fixed order, so the newest breaks a tie
    q = q.order_by(ordered, desc(TPRAFinding.id))
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

    more = findings.extras(db, rows)
    items = [{
        "id": f.id, "vendor_id": f.vendor_id, "vendor_name": vname.get(f.vendor_id),
        "assessment_id": f.assessment_id, "domain": f.domain, "severity": f.severity,
        "title": f.title, "status": f.status, "is_critical_control_fail": f.is_critical_control_fail,
        "due_date": due_by_finding[f.id].isoformat() if f.id in due_by_finding else None,
        "overdue": f.id in overdue_ids,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        # who sees it through, whether it holds the approval gate, where it came from, how long an acceptance runs, its task,
        # and when the policy's window for its severity ends
        "owner": more[f.id]["owner"], "is_blocking": bool(f.is_blocking), "source": findings.source_of(f),
        "accepted_until": more[f.id]["accepted_until"], "task_id": f.task_id, "sla_due": more[f.id]["sla_due"],
        "engagement": more[f.id]["engagement"],
    } for f in rows]
    return {"items": items, "total": total, "blocking_total": blocking_total, "skip": skip, "limit": limit}


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
    _prep_tpra_db(db, tids)
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
    # Per-vendor 10-domain residual breakdown from the active assessment (TPRM-014),
    # an engagement's entry (`vendor:{id}/engagement:{id}`) from that engagement's.
    dmap = {}
    for vid_, eid_, ds in db.query(VendorAssessment.vendor_id, VendorAssessment.engagement_id,
                                   VendorAssessment.domain_scores).filter(
        VendorAssessment.tenant_id.in_(tids),
        VendorAssessment.lifecycle_status == "active",
    ).all():
        if ds:
            dmap[(vid_, eid_)] = ds

    items = []
    for r in risks:
        vid = eid = None
        if r.source_reference and r.source_reference.startswith("vendor:"):
            try:
                vid = int(r.source_reference.split(":", 1)[1].split("/", 1)[0])
                tail = r.source_reference.split("/", 1)[1] if "/" in r.source_reference else ""
                eid = int(tail.split(":", 1)[1]) if tail.startswith("engagement:") else None
            except (ValueError, IndexError):
                vid = None
        items.append({
            "id": r.id, "title": r.title, "vendor_id": vid, "vendor_name": vname.get(vid),
            "tier": r.risk_sub_category, "inherent_score": r.inherent_score,
            "residual_score": r.residual_score, "status": r.status,
            "register_type": r.register_type, "owner_id": r.owner_id,
            "source_type": r.source_type, "source_reference": r.source_reference,
            "domain_scores": dmap.get((vid, eid)),
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
    _prep_tpra_db(db, tids)
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
        "verified": s.verified is not False,
    } for s in rows]
    return {"items": items, "total": total, "skip": skip, "limit": limit}
