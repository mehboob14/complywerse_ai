"""Analytics — native FastAPI port of the Frappe Helpdesk analytics APIs.

1:1 conversions (DATA shapes; frappe-ui chart config stays on the ComplyVerse FE):
  * api/analytics_utils.py  -> get_avg_time / get_avg_time_metric
  * api/ticket_stats.py     -> per-entity feedback / SLA-violation / avg-time
                               stats + validate_agent_access (manager gate)
  * api/dashboard_tags.py   -> tag_charts (Top-10 bar + Top-5 daily trend)
  * api/ticket_analytics.py -> get_ticket_analytics (per-ticket SLA timeline)

Computed over the native HDTicket / HDCommunication / HDTicketActivity / HDTag
rows instead of Frappe DocTypes. Business-seconds come from sla.py's calc
(imported read-only). Native timestamps are real datetimes (datetime.utcnow),
so Frappe's string parsing is gone. Empty tenant -> zeros/empty, never 4xx (§E).
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Optional

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...models import (
    GRCUser,
    HDAgent,
    HDCommunication,
    HDCustomer,
    HDTag,
    HDTicket,
    HDTicketActivity,
    HDTicketComment,
    HDTicketStatus,
    HDTicketTag,
    get_db,
)
from ...routers.auth_router import require_auth
from . import sla as sla_mod
from .common import require_view, tenant_id
from .dashboard import (
    NativeDashboard,
    _bar,
    _is_manager,
    _status_ids_by_category,
    pct_change,
)

# periods → trailing-day counts (ticket_stats.periods / analytics_utils)
PERIODS = {"last week": 7, "last month": 30, "last 3 months": 90, "last 6 months": 180}

# ticket_stats.DT_FIELD_MAP — the per-entity doctypes the stats endpoints accept.
DT_FIELD_MAP = {"HD Customer": "customer", "Contact": "contact",
                "customer": "customer", "contact": "contact"}


# ═══════════════════════════════════════════════════════════════════════════
# analytics_utils.py  →  get_avg_time / get_avg_time_metric
# ═══════════════════════════════════════════════════════════════════════════
def _resolve_customer_id(db: Session, tid: int, name) -> Optional[int]:
    row = (db.query(HDCustomer)
           .filter(HDCustomer.tenant_id == tid, HDCustomer.customer_name == name)
           .first())
    return row.id if row else -1  # unknown customer matches nothing


def _scope_match(t, scope: str, identifier, customer_id: Optional[int]) -> bool:
    """analytics_utils._apply_scope — agent/customer/contact predicate.
    `all` is the ComplyVerse net-new tenant-wide scope (every ticket; backs the
    dashboard's tenant-wide feedback distribution + SLA-breach trend)."""
    if scope == "all":
        return True
    if scope == "agent":
        return t.assigned_agent == identifier
    if scope == "customer":
        return t.customer_id == customer_id
    if scope == "contact":
        return t.contact == identifier
    return False


def get_avg_time(db: Session, tid: int, from_date: date, to_date: date,
                 time_field: str, scope: str, identifier, resolved_ids: set,
                 group_by_date: bool = False) -> list:
    """analytics_utils.get_avg_time — average of `time_field` (seconds) over
    HD Ticket rows in [from_date, to_date] matching scope. Durations are only
    meaningful under a policy, so sla must be set; resolution_time additionally
    restricts to Resolved-category statuses. group_by_date → [{date, avg_time}]."""
    lo = datetime.combine(from_date, datetime.min.time())
    hi = datetime.combine(to_date + timedelta(days=1), datetime.min.time())
    customer_id = _resolve_customer_id(db, tid, identifier) if scope == "customer" else None

    buckets: dict = {}
    flat: list = []
    for t in db.query(HDTicket).filter(HDTicket.tenant_id == tid).all():
        if t.created_at is None or not (lo <= t.created_at < hi):
            continue
        val = getattr(t, time_field, None)
        if val is None or t.sla_id is None:
            continue
        if time_field == "resolution_time" and t.status_id not in resolved_ids:
            continue
        if not _scope_match(t, scope, identifier, customer_id):
            continue
        if group_by_date:
            buckets.setdefault(t.created_at.date(), []).append(val)
        else:
            flat.append(val)

    if group_by_date:
        return [{"date": d.isoformat(), "avg_time": sum(v) / len(v)}
                for d in sorted(buckets) for v in [buckets[d]]]
    return [{"avg_time": (sum(flat) / len(flat)) if flat else None}]


def _scalar_avg_time(db, tid, from_date, to_date, time_field, scope, identifier,
                     resolved_ids) -> float:
    r = get_avg_time(db, tid, from_date, to_date, time_field, scope, identifier,
                     resolved_ids, group_by_date=False)
    return r[0]["avg_time"] if r and r[0]["avg_time"] is not None else 0.0


def get_avg_time_metric(db: Session, tid: int, period: str, time_field: str,
                        scope: str, identifier) -> dict:
    """analytics_utils.get_avg_time_metric — {data[], average, percentage_change}
    for the period, zero-filled across every day."""
    resolved_ids = _status_ids_by_category(db, tid).get("Resolved", set())
    days = PERIODS.get(period, 7)
    today = datetime.utcnow().date()
    current_from = today - timedelta(days=days - 1)
    current_to = today
    previous_from = today - timedelta(days=2 * days - 1)
    previous_to = today - timedelta(days=days)

    current_series = get_avg_time(db, tid, current_from, current_to, time_field,
                                  scope, identifier, resolved_ids, group_by_date=True)
    current_avg = _scalar_avg_time(db, tid, current_from, current_to, time_field,
                                   scope, identifier, resolved_ids)
    previous_avg = _scalar_avg_time(db, tid, previous_from, previous_to, time_field,
                                    scope, identifier, resolved_ids)

    date_dict: dict = {}
    cur = current_from
    while cur <= current_to:
        date_dict[cur.isoformat()] = 0
        cur += timedelta(days=1)
    for row in current_series:
        date_dict[str(row["date"])] = round(row["avg_time"] or 0, 2)

    data = [{"date": d, "avg_time": v} for d, v in sorted(date_dict.items())]
    return {"data": data, "average": round(current_avg, 2),
            "percentage_change": pct_change(current_avg, previous_avg)}


# ═══════════════════════════════════════════════════════════════════════════
# ticket_stats.py  →  per-entity feedback / SLA violations / avg-time
# ═══════════════════════════════════════════════════════════════════════════
def _resolve_scope(dt: str) -> str:
    if dt not in DT_FIELD_MAP:
        raise HTTPException(status_code=400,
                            detail=f"Unsupported doctype '{dt}' for ticket stats.")
    return DT_FIELD_MAP[dt]


def validate_agent_access(db: Session, user: GRCUser, scope: str, value) -> None:
    """ticket_stats.validate_agent_access — only the agent themselves or a
    manager may read an agent's stats."""
    viewing_other = scope == "agent" and value and value != user.email
    if viewing_other and not _is_manager(db, user):
        raise HTTPException(status_code=403,
                            detail="You are not allowed to view another agent's stats.")


def get_feedback_received(db: Session, tid: int, scope: str, value) -> dict:
    """ticket_stats.get_feedback_received — 1–5 star distribution + weighted avg."""
    customer_id = _resolve_customer_id(db, tid, value) if scope == "customer" else None
    distribution = dict.fromkeys(range(1, 6), 0)
    total = weighted = 0
    for t in db.query(HDTicket).filter(HDTicket.tenant_id == tid).all():
        if not (t.feedback_rating and t.feedback_rating > 0):
            continue
        if not _scope_match(t, scope, value, customer_id):
            continue
        star = max(1, min(5, int(round(float(t.feedback_rating) * 5))))
        distribution[star] += 1
        total += 1
        weighted += star
    average = round(weighted / total, 1) if total else 0.0
    return {"data": distribution, "average": average, "total": total}


def get_sla_violations(db: Session, tid: int, scope: str, value,
                       period: str = "last month") -> dict:
    """ticket_stats._get_sla_violations — Failed-SLA series with adaptive
    daily/weekly/monthly bucketing + prior-period % change."""
    days = PERIODS.get(period, 7)
    bucket = "daily" if days <= 7 else ("weekly" if days <= 90 else "monthly")
    today = datetime.utcnow().date()
    current_from = today - timedelta(days=days - 1)
    current_to = today
    previous_from = today - timedelta(days=2 * days - 1)
    previous_to = today - timedelta(days=days)
    customer_id = _resolve_customer_id(db, tid, value) if scope == "customer" else None

    def _failed_dates(lo_d, hi_d):
        lo = datetime.combine(lo_d, datetime.min.time())
        hi = datetime.combine(hi_d + timedelta(days=1), datetime.min.time())
        out = []
        for t in db.query(HDTicket).filter(HDTicket.tenant_id == tid).all():
            if t.created_at is None or not (lo <= t.created_at < hi):
                continue
            if t.agreement_status != "Failed":
                continue
            if not _scope_match(t, scope, value, customer_id):
                continue
            out.append(t.created_at.date())
        return out

    current = _failed_dates(current_from, current_to)
    current_total = len(current)
    previous_total = len(_failed_dates(previous_from, previous_to))

    if bucket == "daily":
        counts = Counter(d.isoformat() for d in current)
        data, cur = [], current_from
        while cur <= current_to:
            data.append({"date": cur.isoformat(), "count": counts.get(cur.isoformat(), 0)})
            cur += timedelta(days=1)
    elif bucket == "weekly":
        counts = Counter(d.strftime("%G-%V") for d in current)
        week, cur = {}, current_from - timedelta(days=current_from.weekday())
        while cur <= current_to:
            iso = cur.strftime("%G-%V")
            end = cur + timedelta(days=6)
            label = f"{cur.strftime('%b')} {cur.day} – {end.strftime('%b')} {end.day}"
            week[iso] = {"date": label, "count": counts.get(iso, 0)}
            cur += timedelta(weeks=1)
        data = list(week.values())
    else:  # monthly
        counts = Counter(d.strftime("%b %Y") for d in current)
        num_months = days // 30
        now = datetime.utcnow()
        data = []
        for i in range(num_months - 1, -1, -1):
            label = (now - relativedelta(months=i)).strftime("%b %Y")
            data.append({"date": label, "count": counts.get(label, 0)})

    return {"data": data, "total": current_total,
            "percentage_change": pct_change(current_total, previous_total)}


def get_ticket_stats(db: Session, tid: int, scope: str, value,
                     period: str = "last month") -> dict:
    """ticket_stats.get_ticket_stats — the four per-entity stat blocks."""
    return {
        "feedback_received": get_feedback_received(db, tid, scope, value),
        "sla_violations": get_sla_violations(db, tid, scope, value, period),
        "avg_first_response_time": get_avg_time_metric(
            db, tid, period, "first_response_time", scope, value),
        "avg_resolution_time": get_avg_time_metric(
            db, tid, period, "resolution_time", scope, value),
    }


# ═══════════════════════════════════════════════════════════════════════════
# dashboard_tags.py  →  Top-10 tags bar + Top-5 tag daily stacked trend
# ═══════════════════════════════════════════════════════════════════════════
TOP_TAG_COUNT = 10
TREND_TAG_COUNT = 5


def _scoped_tagged(db: Session, nd: NativeDashboard):
    """`HD Ticket Tag` rows for the tickets this dashboard is scoped to (date +
    team + agent), as (ticket_date, tag_name) pairs — dashboard_tags.get_tagged_tickets."""
    dates = {t.id: t.created_at for t in nd.rows
             if nd._scope(t) and nd._in(t.created_at, nd._cur)}
    if not dates:
        return []
    rows = (db.query(HDTicketTag.ticket_id, HDTag.name)
            .join(HDTag, HDTicketTag.tag_id == HDTag.id)
            .filter(HDTicketTag.ticket_id.in_(list(dates)))
            .all())
    return [(dates[tid].date().isoformat(), name) for tid, name in rows if name]


def tag_charts(nd: NativeDashboard) -> list:
    """dashboard_tags.get_tag_chart_data — [top tags bar, tag trend stacked]."""
    pairs = _scoped_tagged(db=nd.db, nd=nd)
    counts = Counter(tag for _, tag in pairs)

    top = counts.most_common(TOP_TAG_COUNT)
    top_data = [{"tag": tag, "Tickets": n} for tag, n in top]
    top_chart = _bar(
        top_data, "top_tags", "Top Tags", "Most used tags in this period",
        "tag", "Tickets", horizontal=True, xAxis={"type": "category"})

    trend_tags = [tag for tag, _ in counts.most_common(TREND_TAG_COUNT)]
    trend_set = set(trend_tags)
    by_date: dict = {}
    for day, tag in pairs:
        if tag not in trend_set:
            continue
        row = by_date.setdefault(day, {"date": day, **dict.fromkeys(trend_tags, 0)})
        row[tag] += 1
    trend_data = [by_date[d] for d in sorted(by_date)]
    trend_chart = _bar(
        trend_data, "tag_trend", "Tag Trend",
        f"Daily volume of the top {TREND_TAG_COUNT} tags", "date", trend_tags,
        stacked=True, xAxis={"type": "time", "title": "Date", "timeGrain": "day"})
    return [top_chart, trend_chart]


# ═══════════════════════════════════════════════════════════════════════════
# ticket_analytics.py  →  per-ticket SLA timeline, metrics, events, summary
# ═══════════════════════════════════════════════════════════════════════════
def _now() -> datetime:
    return datetime.utcnow()


def _cint(x) -> int:
    return int(x or 0)


def elapsed(start, end):
    """ticket_analytics.elapsed — wall-clock seconds, clamped at 0."""
    if not start or not end:
        return None
    return max(0, int((end - start).total_seconds()))


def _working_seconds_fn(db: Session, ticket: HDTicket):
    """ticket_analytics.working_seconds_fn — business seconds via the ticket's
    SLA calendar (sla.py:_calc_elapsed_time, read-only); wall-clock without SLA."""
    sla = ticket.sla
    if not sla:
        return elapsed
    holidays = sla_mod._holidays(sla)
    workdays = sla_mod._workdays(sla)

    def working_seconds(start, end):
        if not start or not end:
            return None
        return max(0, int(sla_mod._calc_elapsed_time(start, end, holidays, workdays)))

    return working_seconds


def _conversation(db: Session, tid: int, ticket: HDTicket) -> list:
    """ticket_analytics.conversation — the reply thread (HDCommunication),
    oldest first; `creation` = communication_date (fallback created_at)."""
    rows = (db.query(HDCommunication)
            .filter(HDCommunication.tenant_id == tid,
                    HDCommunication.reference_ticket_id == ticket.id)
            .all())
    msgs = [SimpleNamespace(
        sent_or_received=c.sent_or_received, sender=c.sender,
        creation=c.communication_date or c.created_at) for c in rows]
    msgs.sort(key=lambda m: m.creation or datetime.min)
    return msgs


def _status_changes(db: Session, tid: int, ticket: HDTicket):
    """HDTicketActivity rows (native Version equivalent). Yields
    (creation, field, old, new) tuples for status + team changes, oldest first.
    Status activity is logged as 'changed status to <label>' and team as
    'moved to team <team>' by tickets.py:_activity."""
    rows = (db.query(HDTicketActivity)
            .filter(HDTicketActivity.tenant_id == tid,
                    HDTicketActivity.ticket_id == ticket.id)
            .order_by(HDTicketActivity.created_at.asc(), HDTicketActivity.id.asc())
            .all())
    prev_status = None
    for a in rows:
        action = a.action or ""
        if action.startswith("changed status to "):
            new = action[len("changed status to "):]
            yield (a.created_at, "status", prev_status, new)
            prev_status = new
        elif action.startswith("moved to team "):
            yield (a.created_at, "agent_group", None, action[len("moved to team "):])


def _paused_labels(db: Session, tid: int) -> set:
    return {s.label_agent for s in
            db.query(HDTicketStatus).filter(
                HDTicketStatus.tenant_id == tid,
                HDTicketStatus.category == "Paused").all()}


def pause_spans(changes: list, paused_labels: set) -> list:
    """ticket_analytics.pause_spans — (start, end) paused windows from status
    changes; end None while still running."""
    spans, start = [], None
    for creation, field, old, new in changes:
        if field != "status":
            continue
        if new in paused_labels and old not in paused_labels:
            start = start or creation
        elif old in paused_labels and new not in paused_labels and start:
            spans.append((start, creation))
            start = None
    if start:
        spans.append((start, None))
    return spans


def churn(changes: list) -> dict:
    """ticket_analytics.churn — routing churn from the change log. sla changes
    are not logged by the native ticket core (model gap), so only team moves
    are counted here."""
    changed = [field for _, field, _, _ in changes]
    return {"sla_changes": changed.count("sla"),
            "team_changes": changed.count("agent_group")}


def paused_overlap(start, end, spans, working_seconds) -> int:
    total = 0
    for span_start, span_end in spans:
        a = max(start, span_start)
        b = min(end, span_end) if span_end else end
        if a < b:
            total += working_seconds(a, b) or 0
    return total


def is_description(index, message, ticket) -> bool:
    return (index == 0 and message.sent_or_received == "Received"
            and (elapsed(ticket.created_at, message.creation) or 0) <= 60)


def average(values):
    return round(sum(values) / len(values)) if values else None


def _fullname(db: Session, tid: int, email) -> str:
    if not email:
        return ""
    a = (db.query(HDAgent)
         .filter(HDAgent.tenant_id == tid, HDAgent.user == email).first())
    if a and a.agent_name:
        return a.agent_name
    u = db.query(GRCUser).filter(GRCUser.email == email).first()
    return (u.display_name if u and u.display_name else email)


def _user_info(db: Session, tid: int, email) -> dict:
    """Native stand-in for frappe.utils.get_user_info_for_avatar."""
    a = (db.query(HDAgent)
         .filter(HDAgent.tenant_id == tid, HDAgent.user == email).first())
    return {"user": email, "name": _fullname(db, tid, email),
            "image": a.user_image if a else None}


def event_series(db, tid, messages, ticket, working_seconds, spans):
    """ticket_analytics.event_series — conversation events + per-side hand-off gaps."""
    events = []
    gaps = {"agent": [], "customer": []}
    names: dict = {}
    previous = None
    first_sent_seen = False
    for index, message in enumerate(messages):
        wait = None
        if (previous and previous.sent_or_received == "Received"
                and message.sent_or_received == "Sent"):
            wait = max(0, (working_seconds(previous.creation, message.creation) or 0)
                       - paused_overlap(previous.creation, message.creation, spans,
                                        working_seconds))
            gaps["agent"].append(wait)
        elif (previous and previous.sent_or_received == "Sent"
              and message.sent_or_received == "Received"):
            gaps["customer"].append(
                working_seconds(previous.creation, message.creation) or 0)
        is_first_response = (message.sent_or_received == "Sent"
                             and not first_sent_seen
                             and bool(ticket.first_responded_on))
        if message.sent_or_received == "Sent":
            first_sent_seen = True
        if not is_description(index, message, ticket) and not is_first_response:
            if message.sender not in names:
                names[message.sender] = _fullname(db, tid, message.sender)
            events.append({
                "side": "customer" if message.sent_or_received == "Received" else "agent",
                "at": sla_mod.iso(message.creation),
                "sender": message.sender,
                "sender_name": names[message.sender],
                "wait_seconds": wait,
            })
        previous = message
    return events, gaps


def hold_seconds(ticket, working_seconds) -> int:
    paused = _cint(ticket.total_hold_time)
    if ticket.status_category == "Paused" and ticket.on_hold_since:
        paused += working_seconds(ticket.on_hold_since, _now()) or 0
    return paused


def resolution_seconds(ticket):
    if not ticket.resolution_date:
        return None
    return _cint(ticket.resolution_time) or elapsed(ticket.created_at, ticket.resolution_date)


def compute_metrics(gaps, ticket, working_seconds) -> dict:
    return {"avg_agent_gap": average(gaps["agent"]),
            "avg_customer_gap": average(gaps["customer"]),
            "hold_time": hold_seconds(ticket, working_seconds) or None}


def involved_agents(messages, assigned) -> list:
    """ticket_analytics.involved_agents — reply senders oldest first, then the
    assignee if they never replied (native assignee is a single email)."""
    users = []
    for m in messages:
        if m.sent_or_received == "Sent" and m.sender and m.sender not in users:
            users.append(m.sender)
    if assigned and assigned not in users:
        users.append(assigned)
    return users


def summary(db, tid, ticket, messages, changes) -> dict:
    customer = sum(1 for m in messages if m.sent_or_received == "Received")
    internal = (db.query(HDTicketComment)
                .filter(HDTicketComment.tenant_id == tid,
                        HDTicketComment.reference_ticket_id == ticket.id)
                .count())
    return {
        "customer_messages": customer,
        "agent_messages": len(messages) - customer,
        "internal_comments": internal,
        "agents_involved": [_user_info(db, tid, u)
                            for u in involved_agents(messages, ticket.assigned_agent)],
        "churn": churn(changes),
    }


# ─── timeline nodes (ticket_analytics.build_timeline + nodes) ───────────────
def badge(text, tone) -> dict:
    return {"text": text, "tone": tone}


def fmt(seconds) -> str:
    """ticket_analytics.fmt — at most two units: '20h 25m', '3d 2h', '45s'."""
    seconds = _cint(seconds)
    minutes, days = (seconds // 60) % 60, seconds // 86400
    hours = (seconds // 3600) % 24
    if days:
        return f"{days}d {hours}h" if hours else f"{days}d"
    if hours:
        return f"{hours}h {minutes}m" if minutes else f"{hours}h"
    if minutes:
        return f"{minutes}m"
    return f"{seconds}s"


def milestone(node, state, took, target, failed_by=0, badge_text=None) -> dict:
    if state == "breach":
        text, tone = f"Failed by {fmt(failed_by)}", "red"
    else:
        text, tone = badge_text or f"Fulfilled in {fmt(took)}", "green"
    return {**node, "state": state, "badge": badge(text, tone),
            "took": took, "target": target}


def pending_milestone(node, due_by, start, working_seconds) -> dict:
    if not due_by:
        return {**node, "state": "pending", "badge": None}
    now = _now()
    target = working_seconds(start, due_by) or 0
    spent = working_seconds(start, now) or 0
    remaining = int((due_by.replace(second=0, microsecond=0)
                     - now.replace(second=0, microsecond=0)).total_seconds())
    if remaining < 0:
        return {**node, "state": "breach", "eta": sla_mod.iso(due_by),
                "badge": badge(f"Overdue by {fmt(-remaining)}", "red"),
                "took": spent, "target": target}
    return {**node, "state": "pending", "eta": sla_mod.iso(due_by),
            "badge": badge(f"Due in {fmt(remaining)}", "gray"),
            "took": spent, "target": target}


def first_response_node(ticket, working_seconds) -> dict:
    start = ticket.service_level_agreement_creation or ticket.created_at
    target = working_seconds(start, ticket.response_by)
    node = {"key": "first_response",
            "timestamp": sla_mod.iso(ticket.first_responded_on), "eta": None}
    if ticket.first_responded_on:
        took = _cint(ticket.first_response_time) or elapsed(
            ticket.created_at, ticket.first_responded_on)
        failed_by = _cint(ticket.first_response_failed_by)
        if failed_by:
            node["eta"] = sla_mod.iso(ticket.response_by)
            return milestone(node, "breach", took, max(took - failed_by, 0), failed_by)
        if target is None:
            return {**node, "state": "done",
                    "badge": badge(f"Responded in {fmt(took)}", "green"),
                    "took": took, "target": None}
        return milestone(node, "done", took, target)
    return pending_milestone(node, ticket.response_by, start, working_seconds)


def resolution_node(ticket, working_seconds) -> dict:
    start = ticket.service_level_agreement_creation or ticket.created_at
    node = {"key": "resolution",
            "timestamp": sla_mod.iso(ticket.resolution_date), "eta": None}
    if ticket.resolution_date:
        took = resolution_seconds(ticket)
        failed_by = _cint(ticket.resolution_failed_by)
        if failed_by:
            node["eta"] = sla_mod.iso(ticket.resolution_by)
            return milestone(node, "breach", took, max(took - failed_by, 0), failed_by)
        spare = working_seconds(ticket.resolution_date, ticket.resolution_by)
        if spare is None:
            return {**node, "state": "done",
                    "badge": badge(f"Resolved in {fmt(took)}", "green"),
                    "took": took, "target": None}
        return milestone(node, "done", took, took + spare,
                         badge_text=f"{fmt(spare)} to spare")
    if ticket.status_category == "Resolved":
        return {**node, "state": "done",
                "badge": badge("Closed without resolution", "gray")}
    return pending_milestone(node, ticket.resolution_by, start, working_seconds)


def pause_window(spans, active, on_hold_since):
    start = spans[0][0] if spans else None
    end = spans[-1][1] if spans else None
    if active:
        start, end = start or on_hold_since, None
    if not start:
        return None
    return {"start": sla_mod.iso(start), "end": sla_mod.iso(end)}


def hold_node(ticket, working_seconds, spans):
    active = ticket.status_category == "Paused"
    paused = hold_seconds(ticket, working_seconds)
    if not paused and not active:
        return None
    return {"key": "hold", "state": "hold", "active": active,
            "timestamp": sla_mod.iso(ticket.on_hold_since) if active else None,
            "window": pause_window(spans, active, ticket.on_hold_since),
            "took": paused, "badge": badge(f"{fmt(paused)} paused", "amber")}


def build_timeline(ticket, working_seconds, spans) -> list:
    nodes = [
        {"key": "created", "state": "done",
         "timestamp": sla_mod.iso(ticket.created_at), "badge": None},
        first_response_node(ticket, working_seconds),
    ]
    hold = hold_node(ticket, working_seconds, spans)
    if hold:
        nodes.append(hold)
    nodes.append(resolution_node(ticket, working_seconds))
    return nodes


def _empty_ticket_analytics() -> dict:
    return {"has_sla": False, "timeline": [], "metrics": {}, "events": [],
            "summary": {}}


def get_ticket_analytics(db: Session, tid: int, name: str) -> dict:
    """ticket_analytics.get_ticket_analytics — SLA timeline + metrics + events +
    conversation summary for one ticket. Not-found → safe empty shape (§E)."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return _empty_ticket_analytics()
    ticket = (db.query(HDTicket)
              .filter(HDTicket.id == pk, HDTicket.tenant_id == tid).first())
    if not ticket:
        return _empty_ticket_analytics()

    working_seconds = _working_seconds_fn(db, ticket)
    messages = _conversation(db, tid, ticket)
    changes = list(_status_changes(db, tid, ticket))
    spans = pause_spans(changes, _paused_labels(db, tid))
    events, gaps = event_series(db, tid, messages, ticket, working_seconds, spans)
    return {
        "has_sla": bool(ticket.sla_id),
        "timeline": build_timeline(ticket, working_seconds, spans),
        "metrics": compute_metrics(gaps, ticket, working_seconds),
        "events": events,
        "summary": summary(db, tid, ticket, messages, changes),
    }


# ═══════════════════════════════════════════════════════════════════════════
# router — NOT mounted here (cutover wires it onto the app; router.py is out of
# scope for this conversion).
# ═══════════════════════════════════════════════════════════════════════════
router = APIRouter(prefix="/helpdesk", tags=["Help Desk analytics (native)"])


@router.get("/analytics/ticket-stats")
def ticket_stats(dt: str, dn: str, period: str = "last month",
                 db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth),
                 _: bool = Depends(require_view)):
    scope = _resolve_scope(dt)
    validate_agent_access(db, current_user, scope, dn)
    return get_ticket_stats(db, tenant_id(db), scope, dn, period)


@router.get("/analytics/sla-violations")
def sla_violations(dt: str, dn: str, period: str = "last month",
                   db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth),
                   _: bool = Depends(require_view)):
    scope = _resolve_scope(dt)
    validate_agent_access(db, current_user, scope, dn)
    return get_sla_violations(db, tenant_id(db), scope, dn, period)


@router.get("/analytics/avg-first-response")
def avg_first_response(dt: str, dn: str, period: str = "last month",
                       db: Session = Depends(get_db),
                       current_user: GRCUser = Depends(require_auth),
                       _: bool = Depends(require_view)):
    scope = _resolve_scope(dt)
    validate_agent_access(db, current_user, scope, dn)
    return get_avg_time_metric(db, tenant_id(db), period, "first_response_time", scope, dn)


@router.get("/analytics/avg-resolution")
def avg_resolution(dt: str, dn: str, period: str = "last month",
                   db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth),
                   _: bool = Depends(require_view)):
    scope = _resolve_scope(dt)
    validate_agent_access(db, current_user, scope, dn)
    return get_avg_time_metric(db, tenant_id(db), period, "resolution_time", scope, dn)


@router.get("/analytics/sla-violations-overview")
def sla_violations_overview(period: str = "last month",
                            db: Session = Depends(get_db),
                            _: bool = Depends(require_view)):
    """Tenant-wide Failed-SLA time-series (no customer/contact scope) — the
    dashboard's SLA-breach trend. Ungated read-only; empty → zeros (§E)."""
    return get_sla_violations(db, tenant_id(db), "all", None, period)


@router.get("/analytics/feedback-overview")
def feedback_overview(db: Session = Depends(get_db),
                      _: bool = Depends(require_view)):
    """Tenant-wide 1–5 star CSAT distribution + weighted average — the
    dashboard's feedback histogram. Ungated read-only; empty → zeros (§E)."""
    return get_feedback_received(db, tenant_id(db), "all", None)


@router.get("/analytics/ticket/{name}")
def ticket_analytics(name: str, db: Session = Depends(get_db),
                     _: bool = Depends(require_view)):
    return get_ticket_analytics(db, tenant_id(db), name)


if __name__ == "__main__":
    # Self-check for the DB-free parsing/bucketing/formatting logic.
    assert fmt(14400) == "4h" and fmt(45) == "45s" and fmt(0) == "0s"
    assert fmt(90000) == "1d 1h" and fmt(3660) == "1h 1m"

    assert pct_change(10, 5) == 100.0 and pct_change(5, 10) == -50.0
    assert pct_change(5, 0) is None and pct_change(0, 0) == 0

    t1 = datetime(2024, 1, 1, 9)
    t2 = datetime(2024, 1, 1, 10)
    t3 = datetime(2024, 1, 1, 12)
    changes = [(t1, "status", None, "Open"),
               (t2, "status", "Open", "On Hold"),
               (t3, "status", "On Hold", "Open"),
               (t3, "agent_group", None, "Tier 2")]
    assert pause_spans(changes, {"On Hold"}) == [(t2, t3)]
    assert pause_spans(changes[:2], {"On Hold"}) == [(t2, None)]  # still paused
    assert churn(changes) == {"sla_changes": 0, "team_changes": 1}

    msgs = [SimpleNamespace(sent_or_received="Received", sender="c@x", creation=t1),
            SimpleNamespace(sent_or_received="Sent", sender="a@x", creation=t2),
            SimpleNamespace(sent_or_received="Sent", sender="a@x", creation=t3)]
    assert involved_agents(msgs, "b@x") == ["a@x", "b@x"]
    assert average([2, 4]) == 3 and average([]) is None
    assert elapsed(t1, t2) == 3600 and elapsed(None, t2) is None

    desc = SimpleNamespace(sent_or_received="Received", sender="c@x",
                           creation=t1 + timedelta(seconds=30))
    assert is_description(0, desc, SimpleNamespace(created_at=t1)) is True
    assert is_description(1, desc, SimpleNamespace(created_at=t1)) is False
    print("analytics self-check ok")
