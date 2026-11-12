"""The Risk Management Overview per audience (wave 3-K): Board / CRO, risk team, risk owner, internal audit, third party.

Each view answers the template's DASH rows from the records, one aggregate query per measure (never one per risk). A row is
{key, label, definition, visual, link, value, reason, ...}: `value` is None only when the data behind it does not exist yet, and
then `reason` says why; an empty tenant gets zeros and empty lists, not a healthy score. Net loss stays per currency.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple

from sqlalchemy import exists, func, or_
from sqlalchemy.orm import Session

from ....models import (BusinessUnit, GRCUser, InternalControl, InternalControlTest, Issue, IssueAction, RCSAApprovalHistory,
                        RCSAAssessment, RCSACampaign, Risk, RiskAppetiteBreach, RiskAppetiteConfig, RiskAppetiteStatement,
                        RiskAssessment, RiskIncident, RiskKRI, RiskKRIMeasurement, RiskReview, RiskScoreHistory, TPRAFinding,
                        Vendor, risk_priority_for_score)
from ....routers.auth_router import has_tenant_permission
from ....services import kri_feeds
from ...issue_management.services.risk_actions import OPEN_ACTION_STATUSES, risk_actions_query
from ...vendor_risk.tpra import outsourcing
from ...vendor_risk.tpra.engine_tiering import to_erm_scale
from ..loss_taxonomy import EVENT_TYPES
from .appetite import _breaches, _open_risks, _score, _tolerance
from .incidents import _net_by_currency, _quarter_start
from .kris import DUE_SOON, _held_ids, _provided_by, calculate_kri_status

LIST_LIMIT = 20                 # rows a list shows; the row's value is always the full count
OVERDUE_DAYS = 30
MY_ACTIONS_DAYS = 14
CHANGE_PERIOD_DAYS = 90
COVERAGE_TARGET = 85
YEAR = timedelta(days=365)
BANDS = ("critical", "high", "medium", "low")
KRI_ONLY = or_(RiskKRI.kind == "kri", RiskKRI.kind.is_(None))     # KPIs publish at once and are not risk indicators

Row = dict


def _row(key: str, label: str, definition: str, visual: str, link: str, value=None, reason: Optional[str] = None,
         **extra) -> Row:
    return {"key": key, "label": label, "definition": definition, "visual": visual, "link": link, "value": value,
            "reason": reason if value is None else None, **extra}


def _pct(num: int, den: int) -> Optional[float]:
    return round(num / den * 100, 1) if den else None


def _iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: u.display_name or u.username for u in
            db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids))}


# ── Board / CRO ──────────────────────────────────────────────────────────────────────────────────────────────────────

def _outside_appetite(db: Session, tids: List[int]) -> Row:
    """The appetite page's one breach rule: residual (else inherent) above the category's tolerance (else its maximum)."""
    args = ("outside_appetite", "Risks outside appetite",
            "Open risks whose residual score (inherent when not scored after controls) is above their category's tolerance",
            "category_bars", "/erm/appetite")
    limits = {c.category: _tolerance(c) for c in db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id.in_(tids))}
    if not limits:
        return _row(*args, reason="No appetite limits are set yet: add them on Risk Appetite.")
    risks = (_open_risks(db, tids).filter(Risk.risk_category.in_(list(limits)))
             .with_entities(Risk.risk_category, Risk.residual_score, Risk.inherent_score).all())
    outside, scored = Counter(), Counter()
    for r in risks:
        if _score(r) is not None:
            scored[r.risk_category] += 1
            outside[r.risk_category] += _breaches(_score(r), limits[r.risk_category])
    items = [{"category": c, "tolerance": t, "outside": outside[c], "scored": scored[c], "link": "/erm/appetite"}
             for c, t in sorted(limits.items())]
    return _row(*args, value=sum(outside.values()), items=items)


def _top_risks(db: Session, tids: List[int]) -> Row:
    score = func.coalesce(Risk.residual_score, Risk.inherent_score)
    top = (_open_risks(db, tids).filter(score > 0)
           .with_entities(Risk.id, Risk.title, Risk.inherent_score, Risk.residual_score)
           .order_by(score.desc(), Risk.id).limit(10).all())
    ids = [r.id for r in top]
    approved = {}
    if ids:
        for rid, residual in (db.query(RiskReview.risk_id, RiskReview.new_residual_score)
                              .filter(RiskReview.risk_id.in_(ids), RiskReview.status == "approved",
                                      RiskReview.new_residual_score.isnot(None))
                              .order_by(RiskReview.completed_at, RiskReview.id)):
            approved[rid] = residual          # the last approved review wins
    history = defaultdict(list)
    if ids:
        for rid, residual in (db.query(RiskScoreHistory.risk_id, RiskScoreHistory.residual_score)
                              .filter(RiskScoreHistory.risk_id.in_(ids), RiskScoreHistory.residual_score.isnot(None))
                              .order_by(RiskScoreHistory.recorded_at, RiskScoreHistory.id)):
            history[rid].append(residual)
    items = []
    for r in top:
        change = (r.residual_score - approved[r.id]) if r.residual_score is not None and r.id in approved else None
        items.append({"id": r.id, "title": r.title, "inherent": r.inherent_score, "residual": r.residual_score,
                      "change": change,
                      "direction": None if change is None else "up" if change > 0 else "down" if change < 0 else "same",
                      "history": history[r.id][-8:], "link": f"/erm/risks/{r.id}"})
    return _row("top_risks", "Top 10 risks with direction",
                "Residual score, and its change since the last approved review", "ranked", "/erm/risks/list",
                value=len(items), items=items)


def _kri_status(db: Session, tids: List[int], kri, live: dict) -> str:
    """The published value's band, as the KRI page shows it (a live-fed KRI reads the metric layer, once per metric)."""
    value = kri.current_value
    if kri.metric_key:
        if kri.metric_key not in live:
            live[kri.metric_key] = kri_feeds.current_value(db, tids, kri.metric_key)
        value = live[kri.metric_key] if live[kri.metric_key] is not None else value
    return calculate_kri_status(value, kri) if value is not None else "unknown"


def _red_kris(db: Session, tids: List[int]) -> Row:
    live: dict = {}
    kris = db.query(RiskKRI).filter(RiskKRI.tenant_id.in_(tids), RiskKRI.is_active == True, KRI_ONLY).all()  # noqa: E712
    red = [k for k in kris if _kri_status(db, tids, k, live) == "red"]
    items = [{"id": k.id, "name": k.name, "value": k.current_value, "unit": k.unit, "risk_id": k.risk_id,
              "link": f"/erm/risks/{k.risk_id}" if k.risk_id else "/erm/kris"} for k in red[:LIST_LIMIT]]
    return _row("red_kris", "Red KRIs", "Active KRIs whose latest published value is red", "count_list", "/erm/kris",
                value=len(red), items=items)


def _net_loss(db: Session, tids: List[int], now: datetime) -> Row:
    """Net loss this quarter and last, per event type and currency; a loss counts in the quarter it was booked."""
    this_q = _quarter_start(now)
    last_q = _quarter_start(this_q - timedelta(days=1))
    events = (db.query(RiskIncident.event_type, RiskIncident.currency, RiskIncident.net_loss,
                       func.coalesce(RiskIncident.accounting_date, RiskIncident.incident_date).label("booked"))
              .filter(RiskIncident.tenant_id.in_(tids), RiskIncident.net_loss.isnot(None),
                      func.coalesce(RiskIncident.accounting_date, RiskIncident.incident_date) >= last_q).all())
    this = [e for e in events if e.booked >= this_q]
    last = [e for e in events if e.booked < this_q]
    paired: Dict[Tuple, dict] = {}
    for quarter, rows in (("this_quarter", _net_by_currency(this, "event_type")),
                          ("last_quarter", _net_by_currency(last, "event_type"))):
        for r in rows:
            item = paired.setdefault((r["event_type"], r["currency"]), {
                "event_type": r["event_type"], "label": EVENT_TYPES.get(r["event_type"] or "", "Not classified"),
                "currency": r["currency"], "this_quarter": 0.0, "last_quarter": 0.0})
            item[quarter] = r["net_loss"]
    totals: Dict[Optional[str], dict] = {}
    for quarter, rows in (("this_quarter", _net_by_currency(this)), ("last_quarter", _net_by_currency(last))):
        for r in rows:
            totals.setdefault(r["currency"], {"currency": r["currency"], "this_quarter": 0.0, "last_quarter": 0.0})[quarter] = r["net_loss"]
    return _row("net_loss", "Net operational loss, quarter vs last",
                "Gross loss less recoveries, by quarter booked, per currency (currencies are never added together)",
                "paired_bars", "/erm/incidents", value=sorted(totals.values(), key=lambda t: str(t["currency"] or "")),
                items=sorted(paired.values(), key=lambda i: (str(i["event_type"] or ""), str(i["currency"] or ""))),
                period={"this_quarter": this_q.isoformat(), "last_quarter": last_q.isoformat()})


def _overdue_actions_30(db: Session, tids: List[int], now: datetime) -> Row:
    rows = (risk_actions_query(db, tids).join(Risk, Risk.id == Issue.source_id)
            .outerjoin(BusinessUnit, BusinessUnit.id == Risk.business_unit_id)
            .filter(IssueAction.status.in_(OPEN_ACTION_STATUSES), IssueAction.due_date < now - timedelta(days=OVERDUE_DAYS))
            .with_entities(BusinessUnit.name, func.count(IssueAction.id)).group_by(BusinessUnit.name).all())
    items = sorted(({"unit": name or "No unit", "count": n} for name, n in rows), key=lambda i: (-i["count"], i["unit"]))
    return _row("overdue_actions_30", "Actions overdue more than 30 days",
                "Open risk actions more than 30 days past their due date, by the risk's unit", "unit_bars",
                "/erm/mitigation-actions?filter=overdue", value=sum(i["count"] for i in items), items=items)


def _acceptances_expiring(db: Session, tids: List[int], now: datetime) -> Row:
    rows = (_open_risks(db, tids)
            .filter(Risk.status == "accepted", Risk.acceptance_status == "approved", Risk.acceptance_expires_at.isnot(None),
                    Risk.acceptance_expires_at <= now + timedelta(days=Risk.ACCEPTANCE_EXPIRING_DAYS))
            .order_by(Risk.acceptance_expires_at).with_entities(Risk.id, Risk.title, Risk.acceptance_expires_at).all())
    items = [{"id": r.id, "title": r.title, "expires_at": _iso(r.acceptance_expires_at),
              "state": "expired" if r.acceptance_expires_at < now else "expiring", "link": f"/erm/risks/{r.id}"}
             for r in rows[:LIST_LIMIT]]
    return _row("acceptances_expiring", "Acceptances expiring in 60 days",
                "Accepted risks whose acceptance ends within 60 days (or has already ended)", "list",
                "/erm/mitigation-actions?tab=acceptances", value=len(rows), items=items)


def _programme_score(programme: dict) -> Row:
    args = ("programme_score", "Risk programme score", "The Overview's weighted section score (0-100, target 85)",
            "score_card", "/erm#programme")
    active = (((programme.get("sections") or {}).get("register") or {}).get("counts") or {}).get("active")
    score = (programme.get("performance") or {}).get("score")
    if not active:
        return _row(*args, reason="Nothing to score yet: the register has no active risks.")
    return _row(*args, value=score, reason="No section has data to score yet.")


def board(db: Session, tids: List[int], user: GRCUser, now: datetime, programme: dict):
    return [
        ("Are we inside appetite?", [_outside_appetite(db, tids), _red_kris(db, tids), _programme_score(programme)]),
        ("Which top risks moved?", [_top_risks(db, tids)]),
        ("How much did we lose?", [_net_loss(db, tids, now)]),
        ("What is overdue?", [_overdue_actions_30(db, tids, now), _acceptances_expiring(db, tids, now)]),
    ]


# ── Risk team (2nd line) ─────────────────────────────────────────────────────────────────────────────────────────────

def _counts(programme: dict, section: str) -> dict:
    return (((programme.get("sections") or {}).get(section) or {}).get("counts")) or {}


def _attention(programme: dict) -> Row:
    queue = programme.get("attention_queue") or {}
    return _row("attention_queue", "Attention queue", "What waits on the risk team, from each source page", "count_list",
                "/erm/risks/list", value=queue.get("total", 0),
                items=[{"key": k, "count": n} for k, n in queue.items() if k != "total"])


def _coverage(programme: dict) -> Row:
    num = _counts(programme, "assessments").get("risks_assessed_12m", 0)
    den = _counts(programme, "register").get("active", 0)
    return _row("assessment_coverage", "Assessment coverage, 12 months",
                "Distinct active risks assessed in the last 12 months / active risks", "figure", "/erm/risks/list",
                value=_pct(num, den), reason="No active risks to cover yet.", numerator=num, denominator=den,
                target=COVERAGE_TARGET)


def _campaign_progress(db: Session, tids: List[int]) -> Row:
    args = ("campaign_progress", "Campaign progress by unit",
            "Per unit in running campaigns: assessments submitted / assigned, and approved / submitted", "stacked_bars",
            "/erm/rcsa/campaigns")
    rows = (db.query(RCSAAssessment.status, RCSAAssessment.campaign_id, BusinessUnit.name)
            .join(RCSACampaign, RCSACampaign.id == RCSAAssessment.campaign_id)
            .outerjoin(BusinessUnit, BusinessUnit.id == RCSAAssessment.business_unit_id)
            .filter(RCSACampaign.tenant_id.in_(tids), RCSACampaign.status == "active").all())
    if not rows:
        return _row(*args, reason="No assessment campaign is running.")
    units: Dict[str, dict] = {}
    for r in rows:
        u = units.setdefault(r.name or "No unit", {"unit": r.name or "No unit", "assigned": 0, "submitted": 0, "approved": 0,
                                                   "link": f"/erm/rcsa/campaigns/{r.campaign_id}"})
        u["assigned"] += 1
        u["submitted"] += r.status in ("submitted", "under_review", "approved")
        u["approved"] += r.status == "approved"
    return _row(*args, value=len(rows), items=sorted(units.values(), key=lambda u: u["unit"]))


def _unscored_unowned(db: Session, tids: List[int]) -> Row:
    unscored = or_(Risk.inherent_score.is_(None), Risk.residual_score.is_(None))   # the register's "unscored" filter
    active = _open_risks(db, tids)
    items = [{"key": "unscored", "label": "Not fully scored", "count": active.filter(unscored).count(),
              "link": "/erm/risks/list?filter=unscored"},
             {"key": "unowned", "label": "No risk owner", "count": active.filter(Risk.owner_id.is_(None)).count(),
              "link": "/erm/risks/list"}]
    return _row("unscored_unowned", "Unscored and unowned risks",
                "Active risks missing a score before or after controls, and active risks with no risk owner", "two_counts",
                "/erm/risks/list", value=active.filter(or_(unscored, Risk.owner_id.is_(None))).count(), items=items)


def _kri_freshness(programme: dict) -> Row:
    counts = _counts(programme, "kris")
    num, den = counts.get("fresh", 0), counts.get("active", 0)
    return _row("kri_freshness", "KRI freshness", "Active KRIs measured within their frequency window / active KRIs",
                "figure", "/erm/kris?tab=due", value=_pct(num, den), reason="No active KRIs yet.", numerator=num,
                denominator=den)


def _heatmap(db: Session, tids: List[int]) -> Row:
    """The 5x5 cell counts /erm/risks/heatmap gives, both sides in two grouped queries."""
    cells = {}
    for side in ("inherent", "residual"):
        lik, imp = getattr(Risk, f"{side}_likelihood"), getattr(Risk, f"{side}_impact")
        rows = (db.query(lik, imp, func.count(Risk.id)).filter(Risk.tenant_id.in_(tids), Risk.status.is_distinct_from("draft"),
                                                               lik > 0, imp > 0)
                .group_by(lik, imp).order_by(lik.desc(), imp).all())
        cells[side] = [{"likelihood": lk, "impact": im, "count": n} for lk, im, n in rows]
    return _row("heatmap", "Before vs after controls", "5x5 likelihood x impact cell counts, before and after controls",
                "heatmap", "/erm/risks", value=sum(c["count"] for c in cells["inherent"]), cells=cells)


def team(db: Session, tids: List[int], user: GRCUser, now: datetime, programme: dict):
    return [
        ("What needs my attention today?", [_attention(programme), _unscored_unowned(db, tids)]),
        ("Is the register complete and current?", [_coverage(programme), _kri_freshness(programme), _heatmap(db, tids)]),
        ("Are campaigns on track?", [_campaign_progress(db, tids)]),
    ]


# ── Risk owner (1st line): the signed-in user's own items ────────────────────────────────────────────────────────────

def _my_risks(db: Session, tids: List[int], uid: int) -> Row:
    rows = (_open_risks(db, tids).filter(Risk.owner_id == uid)
            .order_by(func.coalesce(Risk.residual_score, -1).desc(), Risk.id)
            .with_entities(Risk.id, Risk.title, Risk.residual_score, Risk.review_date).all())
    band = lambda r: risk_priority_for_score(r.residual_score) or "unscored"  # noqa: E731
    bands = {b: 0 for b in (*BANDS, "unscored")}
    bands.update(Counter(band(r) for r in rows))
    items = [{"id": r.id, "title": r.title, "band": band(r), "residual": r.residual_score,
              "review_date": _iso(r.review_date), "link": f"/erm/risks/{r.id}"} for r in rows[:LIST_LIMIT]]
    return _row("my_risks", "My risks by band", "My active risks by band after controls, with the next review date",
                "band_list", "/erm/risks/list", value=len(rows), bands=bands, items=items)


def _my_actions(db: Session, tids: List[int], uid: int, now: datetime) -> Row:
    rows = (risk_actions_query(db, tids)
            .filter(IssueAction.assignee_id == uid, IssueAction.status.in_(OPEN_ACTION_STATUSES),
                    IssueAction.due_date.isnot(None), IssueAction.due_date <= now + timedelta(days=MY_ACTIONS_DAYS))
            .order_by(IssueAction.due_date)
            .with_entities(IssueAction.id, IssueAction.title, IssueAction.due_date, Issue.source_id).all())
    items = [{"id": a.id, "title": a.title, "due_date": _iso(a.due_date), "overdue": a.due_date < now,
              "risk_id": a.source_id, "link": "/erm/mitigation-actions"} for a in rows[:LIST_LIMIT]]
    return _row("my_actions", "My actions due or overdue", "Open risk actions I own, due within 14 days or overdue",
                "list", "/erm/mitigation-actions", value=len(rows), items=items)


def _my_kri_values(db: Session, tids: List[int], uid: int, now: datetime) -> Row:
    """The KRI page's "Values due" rule for the KRIs I provide (their owner, when no provider is set)."""
    rows = (db.query(RiskKRI)
            .filter(RiskKRI.tenant_id.in_(tids), RiskKRI.is_active == True, RiskKRI.metric_key.is_(None),  # noqa: E712
                    RiskKRI.next_due_date.isnot(None), RiskKRI.next_due_date <= now + DUE_SOON, _provided_by(uid))
            .order_by(RiskKRI.next_due_date).all())
    held = _held_ids(db, [k.id for k in rows])
    items = [{"id": k.id, "name": k.name, "next_due_date": _iso(k.next_due_date), "overdue": k.next_due_date < now,
              "pending_review": k.id in held, "link": "/erm/kris?tab=due"} for k in rows[:LIST_LIMIT]]
    return _row("my_kri_values", "My KRI values due", "KRIs I provide whose value is overdue or due within a week", "list",
                "/erm/kris?tab=due", value=len(rows), items=items)


def _returned_to_me(db: Session, tids: List[int], uid: int) -> Row:
    items = []
    rcsa = (db.query(RCSAAssessment.id, BusinessUnit.name)
            .outerjoin(BusinessUnit, BusinessUnit.id == RCSAAssessment.business_unit_id)
            .filter(RCSAAssessment.tenant_id.in_(tids), RCSAAssessment.assessor_id == uid,
                    RCSAAssessment.status == "requires_changes").all())
    notes = {}
    if rcsa:
        for aid, comment in (db.query(RCSAApprovalHistory.assessment_id, RCSAApprovalHistory.comments)
                             .filter(RCSAApprovalHistory.assessment_id.in_([a.id for a in rcsa]),
                                     RCSAApprovalHistory.action == "returned")
                             .order_by(RCSAApprovalHistory.performed_at, RCSAApprovalHistory.id)):
            notes[aid] = comment
    items += [{"kind": "assessment", "id": a.id, "title": f"Self-assessment: {a.name or 'unit'}", "note": notes.get(a.id),
               "link": f"/erm/rcsa/assessments/{a.id}"} for a in rcsa]
    reviews = (db.query(RiskReview.id, RiskReview.approval_notes, Risk.title).join(Risk, Risk.id == RiskReview.risk_id)
               .filter(Risk.tenant_id.in_(tids), RiskReview.reviewer_id == uid, RiskReview.status == "in_review",
                       RiskReview.approval_notes.isnot(None), RiskReview.approval_notes != "").all())
    items += [{"kind": "review", "id": r.id, "title": f"Review: {r.title}", "note": r.approval_notes,
               "link": "/erm/reviews"} for r in reviews]
    losses = (db.query(RiskIncident.id, RiskIncident.title, RiskIncident.validation_note)
              .filter(RiskIncident.tenant_id.in_(tids), RiskIncident.reported_by == uid,
                      RiskIncident.validation_status == "returned").all())
    items += [{"kind": "loss_event", "id": e.id, "title": f"Loss event: {e.title}", "note": e.validation_note,
               "link": "/erm/incidents"} for e in losses]
    return _row("returned_to_me", "Returned to me",
                "My self-assessments, reviews and loss events sent back with comments (actions have no send-back step)",
                "list", "/erm/reviews", value=len(items), items=items[:LIST_LIMIT])


def owner(db: Session, tids: List[int], user: GRCUser, now: datetime, programme: dict):
    return [("What do I have to do this week?", [
        _my_risks(db, tids, user.id), _my_actions(db, tids, user.id, now), _my_kri_values(db, tids, user.id, now),
        _returned_to_me(db, tids, user.id)])]


# ── Internal audit (3rd line) ────────────────────────────────────────────────────────────────────────────────────────

def _score_changes(db: Session, tids: List[int], now: datetime) -> Row:
    q = (db.query(RiskScoreHistory, Risk.title).join(Risk, Risk.id == RiskScoreHistory.risk_id)
         .filter(Risk.tenant_id.in_(tids), RiskScoreHistory.recorded_at >= now - timedelta(days=CHANGE_PERIOD_DAYS)))
    total = q.count()
    rows = q.order_by(RiskScoreHistory.recorded_at.desc(), RiskScoreHistory.id.desc()).limit(LIST_LIMIT).all()
    names = _names(db, (h.changed_by for h, _ in rows))
    items = [{"risk_id": h.risk_id, "risk_title": title, "when": _iso(h.recorded_at), "by": names.get(h.changed_by),
              "label": h.change_reason, "reason": h.reason, "inherent": h.inherent_score, "residual": h.residual_score,
              "target": h.target_score, "link": f"/erm/risks/{h.risk_id}"} for h, title in rows]
    return _row("score_changes", "Score changes, last 90 days", "Score edits with who, when and why", "table",
                "/erm/risks/list", value=total, items=items)


def _self_approval_checks(db: Session, tids: List[int]) -> List[Tuple[str, str, object, str]]:
    """Every approval record that keeps both the maker and the approver: (source, label, count query, page)."""
    n = lambda col: db.query(func.count(func.distinct(col)))  # noqa: E731
    return [
        ("rcsa", "Self-assessments", n(RCSAAssessment.id).join(
            RCSAApprovalHistory, RCSAApprovalHistory.assessment_id == RCSAAssessment.id).filter(
            RCSAAssessment.tenant_id.in_(tids), RCSAApprovalHistory.action == "approved",
            RCSAApprovalHistory.performed_by == RCSAAssessment.submitted_by), "/erm/rcsa/approvals"),
        ("internal_controls", "Internal controls", n(InternalControl.id).filter(
            InternalControl.tenant_id.in_(tids), InternalControl.approved_by == InternalControl.submitted_by),
         "/erm/internal-controls"),
        ("control_tests", "Control tests", n(InternalControlTest.id).filter(
            InternalControlTest.tenant_id.in_(tids), InternalControlTest.reviewer_id == InternalControlTest.tester_id),
         "/erm/internal-controls"),
        ("risk_assessments", "Risk assessments", n(RiskAssessment.id).filter(
            RiskAssessment.tenant_id.in_(tids), RiskAssessment.approved_by == RiskAssessment.submitted_by),
         "/erm/risk-assessments"),
        ("issue_actions", "Action verification", n(IssueAction.id).join(Issue, Issue.id == IssueAction.issue_id).filter(
            Issue.tenant_id.in_(tids), IssueAction.verified_by_id == IssueAction.completed_by), "/issues"),
        ("loss_validation", "Loss event validation", n(RiskIncident.id).filter(
            RiskIncident.tenant_id.in_(tids), RiskIncident.validation_status == "validated",
            RiskIncident.validated_by == RiskIncident.reported_by), "/erm/incidents"),
        ("acceptances", "Risk acceptances", n(Risk.id).filter(
            Risk.tenant_id.in_(tids), Risk.accepted_by == Risk.acceptance_requested_by),
         "/erm/mitigation-actions?tab=acceptances"),
        ("kri_values", "KRI values", n(RiskKRIMeasurement.id).join(RiskKRI, RiskKRI.id == RiskKRIMeasurement.kri_id).filter(
            RiskKRI.tenant_id.in_(tids), KRI_ONLY, RiskKRIMeasurement.review_status == "approved",
            RiskKRIMeasurement.reviewed_by == RiskKRIMeasurement.measured_by), "/erm/kris?tab=check"),
        ("kri_definitions", "KRI definitions", n(RiskKRI.id).filter(
            RiskKRI.tenant_id.in_(tids), KRI_ONLY, RiskKRI.approved_by == RiskKRI.created_by), "/erm/kris"),
        ("reviews", "Risk reviews", n(RiskReview.id).join(Risk, Risk.id == RiskReview.risk_id).filter(
            Risk.tenant_id.in_(tids), or_(RiskReview.approver_id == RiskReview.submitted_by,
                                          RiskReview.approver_id == RiskReview.reviewer_id)), "/erm/reviews"),
        ("appetite_statements", "Appetite statements", n(RiskAppetiteStatement.id).filter(
            RiskAppetiteStatement.tenant_id.in_(tids), RiskAppetiteStatement.approved_by == RiskAppetiteStatement.submitted_by),
         "/erm/appetite"),
        ("appetite_breaches", "Appetite breach decisions", n(RiskAppetiteBreach.id).filter(
            RiskAppetiteBreach.tenant_id.in_(tids), RiskAppetiteBreach.decided_by == RiskAppetiteBreach.plan_by),
         "/erm/appetite"),
    ]


def _self_approvals(db: Session, tids: List[int]) -> Row:
    checks = _self_approval_checks(db, tids)
    items = []
    for source, label, query, link in checks:
        count = query.scalar() or 0
        if count:
            items.append({"source": source, "label": label, "count": count, "link": link})
    return _row("self_approvals", "Self-approvals", "Approvals where the approver is the maker (should be 0)", "figure",
                "/erm#self-approvals", value=sum(i["count"] for i in items), items=items,
                checked=[label for _, label, _, _ in checks])


def _closed_unverified(db: Session, tids: List[int]) -> Row:
    unverified = exists().where(IssueAction.issue_id == Issue.id, IssueAction.status.notin_(("verified", "cancelled")))
    q = db.query(Issue.id, Issue.code, Issue.title).filter(
        Issue.tenant_id.in_(tids), or_(Issue.workflow_state == "closed", Issue.status == "closed"), unverified)
    items = [{"id": i.id, "code": i.code, "title": i.title, "link": f"/issues/{i.id}"}
             for i in q.order_by(Issue.id.desc()).limit(LIST_LIMIT)]
    return _row("closed_unverified", "Issues closed without verification",
                "Closed issues with any action not verified by a second person", "count_list", "/issues",
                value=q.count(), items=items)


def _not_reviewed(db: Session, tids: List[int], now: datetime) -> Row:
    reviewed = exists().where(RiskReview.risk_id == Risk.id, RiskReview.completed_at >= now - YEAR)
    q = _open_risks(db, tids).filter(~reviewed)
    items = [{"id": r.id, "title": r.title, "link": f"/erm/risks/{r.id}"}
             for r in q.with_entities(Risk.id, Risk.title).order_by(Risk.id).limit(LIST_LIMIT)]
    return _row("not_reviewed_12m", "Risks not reviewed in 12 months",
                "Active risks with no review completed in the last 12 months", "count_list", "/erm/reviews",
                value=q.count(), items=items)


def audit(db: Session, tids: List[int], user: GRCUser, now: datetime, programme: dict):
    return [("Can I trust the record?", [_score_changes(db, tids, now), _self_approvals(db, tids),
                                         _closed_unverified(db, tids), _not_reviewed(db, tids, now)])]


# ── Third-party risk ─────────────────────────────────────────────────────────────────────────────────────────────────

def third_party(db: Session, tids: List[int], user: GRCUser, now: datetime, programme: dict):
    names_ok = has_tenant_permission(db, user, "vendor_risk:vendors:view")   # names only for vendor-risk readers
    vendors = (db.query(Vendor.id, Vendor.name, Vendor.tier, Vendor.residual_risk_score, Vendor.risk_rating,
                        Vendor.next_reassessment_date)
               .filter(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None),
                       or_(Vendor.status.is_(None), Vendor.status == "active")).all())
    critical, classified = outsourcing.critical_vendor_ids(db, tids), outsourcing.classified_vendor_ids(db, tids)
    matrix = {key: {"materiality": key, "label": label, **{b: 0 for b in (*BANDS, "unscored")}}
              for key, label in MATERIALITY_ROWS}
    for v in vendors:
        pair = to_erm_scale(v.residual_risk_score, None, v.risk_rating)
        row = "critical_important" if v.id in critical else "other" if v.id in classified else "unclassified"
        matrix[row][risk_priority_for_score(pair[2]) if pair else "unscored"] += 1
    by_band = _row("vendors_by_band", "Critical or important vendors by residual band",
                   "Active vendors by materiality (critical or important function) and residual band on the register's 1-25 scale",
                   "matrix", "/vendor-risk/vendors", value=sum(1 for v in vendors if v.id in critical),
                   items=list(matrix.values()))
    overdue = sorted((v for v in vendors if v.next_reassessment_date and v.next_reassessment_date < now),
                     key=lambda v: v.next_reassessment_date)
    reassess = _row("reassessments_overdue", "Reassessments overdue", "Active vendors past their next reassessment date",
                    "count_list", "/vendor-risk/vendors", value=len(overdue),
                    items=[{"id": v.id, "name": v.name, "due": _iso(v.next_reassessment_date),
                            "link": f"/vendor-risk/vendors/{v.id}"} for v in overdue[:LIST_LIMIT]] if names_ok else [])
    critical = (db.query(func.count(TPRAFinding.id))
                .filter(TPRAFinding.tenant_id.in_(tids), TPRAFinding.deleted_at.is_(None),
                        TPRAFinding.status.in_(("open", "in_remediation")), TPRAFinding.severity == "critical").scalar())
    findings = _row("critical_findings", "Open critical findings", "Third-party findings open with critical severity",
                    "count", "/vendor-risk/findings", value=critical or 0)
    concentration = _concentration(db, tids)
    return [("Which vendors matter most and are they current?", [by_band, reassess, findings, concentration])]


MATERIALITY_ROWS = (("critical_important", "Critical or important"), ("other", "Not critical or important"),
                    ("unclassified", "Not classified"))


def _concentration(db: Session, tids: List[int]) -> Row:
    """The most critical or important vendors relying on one fourth party, against the third-party appetite's limit."""
    limit = outsourcing.concentration_limit(db, tids[0]) if tids else None
    if limit is None:
        return _row("concentration", "Concentration vs appetite", "Shared fourth parties against a concentration limit",
                    "unit_bars", "/vendor-risk/concentration",
                    reason="No concentration limit is set: add one to the third-party risk appetite.")
    rows = outsourcing.concentration_rows(db, tids[0])
    return _row("concentration", "Concentration vs appetite",
                f"Critical or important vendors relying on one fourth party, against a limit of {limit}", "unit_bars",
                "/vendor-risk/concentration", value=rows[0]["count"] if rows else 0, limit=limit,
                breached=bool(rows) and rows[0]["count"] > limit,
                items=[{"unit": r["platform"], "count": r["count"]} for r in rows[:LIST_LIMIT]])


VIEWS: Dict[str, Tuple[str, Callable]] = {
    "board": ("Board / CRO", board),
    "team": ("Risk team (2nd line)", team),
    "owner": ("Risk owner (1st line)", owner),
    "audit": ("Internal audit (3rd line)", audit),
    "third_party": ("Third-party risk", third_party),
}
NEEDS_PROGRAMME = ("board", "team")      # views that show the Overview's section scores


def build(view: str, db: Session, tids: List[int], user: GRCUser, programme: Optional[dict]) -> dict:
    now = datetime.utcnow()
    title, rows_of = VIEWS[view]
    body = {"view": view, "title": title, "as_of": now.isoformat(),
            "questions": [{"question": q, "rows": rows} for q, rows in rows_of(db, tids, user, now, programme or {})]}
    if programme is not None:
        body["programme"] = programme
    return body
