"""Dashboard + analytics (contract §A1, §A2).

Native port of the Frappe proxy's `/dashboard` (recent[]) and
`/dashboard-analytics` (compute_analytics) handlers in helpdesk/router.py — the
same KPI formulas, 30-day trend and 4 breakdowns, computed over the native
HDTicket table instead of Frappe rows. Native timestamps are real datetimes, so
no string parsing is needed. Empty tenant → zeros/None/empty, never 4xx (§E).
"""
from __future__ import annotations

import math
from collections import Counter
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...models import (
    GRCUser,
    HDTicket,
    HDTicketStatus,
    Team,
    Permission,
    Role,
    RolePermission,
    Tenant,
    UserRole,
    get_db,
)
from ...routers.auth_router import require_auth
from .common import iso, require_view, tenant_id


def _mean(xs: List[float]) -> Optional[float]:
    return round(sum(xs) / len(xs), 2) if xs else None


def recent(db: Session, tid: int) -> dict:
    """§A1. The dashboard page reads ONLY recent[] — the 8 most recently
    modified tickets (proxy's rows[:8], ordered by modified desc)."""
    rows = (
        db.query(HDTicket)
        .filter(HDTicket.tenant_id == tid)
        .order_by(HDTicket.updated_at.desc())
        .limit(8)
        .all()
    )
    return {"recent": [{
        "name": str(t.id),
        "subject": t.subject,
        "status": t.status.label_agent if t.status else None,
        "priority": (t.priority.name or t.priority.level) if t.priority else None,
        "modified": iso(t.updated_at),
    } for t in rows]}


def analytics(db: Session, tid: int, from_date=None, to_date=None) -> dict:
    """§A2. KPIs + trend + 4 donuts, matching compute_analytics().

    With no dates: KPIs/breakdowns over ALL tickets + a 30-day trailing trend
    (unchanged — this is what /dashboard-analytics serves). When from_date and/or
    to_date are given (the 7/30/90-day selector, via /dashboard-overview), the
    KPIs + breakdowns are scoped to tickets CREATED in [from, to] and the trend
    spans those days. Empty → zeros/None/empty, never 4xx (§E)."""
    all_rows = db.query(HDTicket).filter(HDTicket.tenant_id == tid).all()
    # Native timestamps are UTC (datetime.utcnow); the proxy used datetime.now().
    # Using utcnow keeps the window aligned with how rows are stamped.
    now = datetime.utcnow()

    if from_date or to_date:
        to_d = _to_date(to_date, now.date())
        from_d = _to_date(from_date, to_d - timedelta(days=29))
        lo = datetime.combine(from_d, datetime.min.time())
        hi = datetime.combine(to_d + timedelta(days=1), datetime.min.time())
        rows = [t for t in all_rows if t.created_at and lo <= t.created_at < hi]
        start = from_d
        span = (to_d - from_d).days + 1
    else:
        rows = all_rows
        start = (now - timedelta(days=29)).date()
        span = 30
    total = len(rows)

    # SLA: % Fulfilled among tickets that actually carry an SLA verdict.
    with_sla = [t for t in rows if t.agreement_status]
    fulfilled = sum(1 for t in with_sla if t.agreement_status == "Fulfilled")
    sla_pct = round(fulfilled / len(with_sla) * 100, 1) if with_sla else None

    # Avg first response (hours) and resolution (days), from timestamp deltas.
    resp_hrs, res_days = [], []
    for t in rows:
        c = t.created_at
        if c and t.first_responded_on and t.first_responded_on >= c:
            resp_hrs.append((t.first_responded_on - c).total_seconds() / 3600)
        if c and t.resolution_date and t.resolution_date >= c:
            res_days.append((t.resolution_date - c).total_seconds() / 86400)

    # Avg feedback on a 0–5 scale (stored 0–1); 0/blank ratings excluded.
    ratings = [float(t.feedback_rating) for t in rows
               if t.feedback_rating not in (None, 0, "0", "")]
    avg_feedback = round(_mean(ratings) * 5, 2) if ratings else None

    # Daily trend: created-per-day vs resolved-per-day across the window. Counted
    # over ALL tickets (membership in the day set) so a ticket resolved in the
    # window but created before it still lands in the resolved line.
    days = [start + timedelta(days=i) for i in range(span)]
    day_set = set(days)
    created_by, resolved_by = Counter(), Counter()
    for t in all_rows:
        if t.created_at and t.created_at.date() in day_set:
            created_by[t.created_at.date()] += 1
        if t.resolution_date and t.resolution_date.date() in day_set:
            resolved_by[t.resolution_date.date()] += 1
    trend = [{"date": d.isoformat(), "created": created_by.get(d, 0),
              "resolved": resolved_by.get(d, 0)} for d in days]

    def _by(key, default: str) -> dict:
        return dict(Counter(key(t) or default for t in rows))

    return {
        "total": total,
        "sla_fulfilled_pct": sla_pct,
        "avg_first_response_hours": _mean(resp_hrs),
        "avg_resolution_days": _mean(res_days),
        "avg_feedback_rating": avg_feedback,
        "feedback_count": len(ratings),
        "trend": trend,
        "by_team": _by(lambda t: t.team.name if t.team else None, "Unassigned"),
        "by_priority": _by(
            lambda t: (t.priority.name or t.priority.level) if t.priority else None, "—"),
        "by_type": _by(lambda t: t.ticket_type.name if t.ticket_type else None, "Unset"),
        "by_status_category": _by(lambda t: t.status_category, "Open"),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Full-parity dashboard — native port of helpdesk/api/dashboard.py
# (HelpdeskDashboard + get_master_dashboard_data). The simplified `analytics()`
# above still serves the current §A2 contract; this adds the manager-gated,
# agent/team-scoped, period-delta surface Frappe's get_dashboard_data() exposes
# (number_card / trend / master / tags). Frappe computes with the query builder;
# here the tenant's tickets are fetched once and aggregated in Python — same
# formulas, matching the native style of analytics() and dialect-independent.
# frappe-ui chart config (echartOptions, axis maxima, series colours) is left to
# the ComplyVerse frontend; only the DATA shapes + the pie/bar<7 decision are ported.
# ═══════════════════════════════════════════════════════════════════════════

RESOLVED = "Resolved"
OPEN = "Open"
PAUSED = "Paused"


def pct_change(current: float, previous: float):
    """agent_home/utils.py:calculate_percentage_change — % change; None when the
    prior period was empty but this one isn't; 0 when both are empty."""
    if previous and previous > 0:
        return round(((current - previous) / previous) * 100, 2)
    if current and current > 0:
        return None
    return 0


def _is_manager(db: Session, user: Optional[GRCUser]) -> bool:
    """Native equivalent of Frappe's ``"Agent Manager" in get_roles(user)`` gate.

    Mapped onto ComplyVerse RBAC: tenant primary-contact and the Administrator role are
    managers (they bypass permission checks everywhere), as is any role granted
    ``helpdesk:tickets:edit`` — the elevated Help Desk permission, the native
    stand-in for the Agent-Manager role. A plain viewer (view-only) is not."""
    if user is None:
        return False
    tenant = db.query(Tenant).first()
    if (tenant and tenant.primary_contact_email and user.email
            and tenant.primary_contact_email.lower() == user.email.lower()):
        return True
    role_ids = [ur.role_id for ur in
                db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        return False
    if db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first():
        return True
    perm = db.query(Permission).filter(Permission.name == "helpdesk:tickets:edit").first()
    if not perm:
        return False
    return db.query(RolePermission).filter(
        RolePermission.role_id.in_(role_ids),
        RolePermission.permission_id == perm.id,
    ).first() is not None


def _status_ids_by_category(db: Session, tid: int) -> dict:
    """HD Ticket Status ids grouped by category (Open/Resolved/Paused)."""
    out: dict = {OPEN: set(), RESOLVED: set(), PAUSED: set()}
    for s in db.query(HDTicketStatus).filter(HDTicketStatus.tenant_id == tid).all():
        out.setdefault(s.category, set()).add(s.id)
    return out


def _to_date(value, default: date) -> date:
    """Parse a 'YYYY-MM-DD' filter value; fall back to `default` when blank."""
    if not value:
        return default
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _pie(data, key, title, subtitle, category, value) -> dict:
    """dashboard.py:get_pie_chart_config — data shape only (donut)."""
    return {"type": "donut", "data": data, "key": key, "title": title,
            "subtitle": subtitle, "category": category, "value": value}


def _bar(data, key, title, subtitle, x, y, **opts) -> dict:
    """dashboard.py:get_bar_chart_config — data shape only (bar). `opts` carries
    the ported decisions the FE needs (y2 series, stacked, horizontal); the
    echart styling (axis maxima, minInterval, colours) stays on the FE."""
    chart = {"type": "bar", "data": data, "key": key, "title": title,
             "subtitle": subtitle, "x": x, "y": y}
    chart.update(opts)
    return chart


class NativeDashboard:
    """Port of helpdesk/api/dashboard.py:HelpdeskDashboard. Holds the resolved
    window + scope and the tenant's tickets, fetched once."""

    def __init__(self, db: Session, tid: int, from_date=None, to_date=None,
                 team: Optional[str] = None, agent: Optional[str] = None):
        self.db = db
        self.tid = tid
        today = datetime.utcnow().date()
        # Frappe defaults: to_date = today, from_date = today-29.
        self.to_date = _to_date(to_date, today)
        self.from_date = _to_date(from_date, self.to_date - timedelta(days=29))
        self.team = team
        self.agent = agent

        # compare with the same number of days right before this period
        self.period_days = (self.to_date - self.from_date).days + 1
        self.prev_from_date = self.from_date - timedelta(days=self.period_days)
        self._today = today

        # window bounds as datetimes: [from 00:00, to+1 00:00); prev [prev_from, from)
        self._cur = (datetime.combine(self.from_date, datetime.min.time()),
                     datetime.combine(self.to_date + timedelta(days=1), datetime.min.time()))
        self._prev = (datetime.combine(self.prev_from_date, datetime.min.time()),
                      self._cur[0])

        cats = _status_ids_by_category(db, tid)
        self.open_ids = cats.get(OPEN, set())
        self.resolved_ids = cats.get(RESOLVED, set())

        # team filter is by name (agent_group == team); resolve to the FK id.
        # Teams are the ComplyVerse Administration teams (grc_teams) post-unification. An
        # unknown team name matches nothing (sentinel -1).
        self.team_id = None
        if team:
            row = (db.query(Team)
                   .filter(Team.tenant_id == tid, Team.name == team).first())
            self.team_id = row.id if row else -1

        self.rows = db.query(HDTicket).filter(HDTicket.tenant_id == tid).all()

    # ─── scope / window predicates ──────────────────────────────────────────
    def _scope(self, t) -> bool:
        if self.team_id is not None and t.agent_group_id != self.team_id:
            return False
        if self.agent and t.assigned_agent != self.agent:
            return False
        return True

    @staticmethod
    def _in(dt, window) -> bool:
        return bool(dt) and window[0] <= dt < window[1]

    def _scoped(self, window, date_field="created_at"):
        for t in self.rows:
            if self._scope(t) and self._in(getattr(t, date_field), window):
                yield t

    # ─── number cards (get_number_card_data) ────────────────────────────────
    def number_cards(self) -> list:
        cards = [
            self._card_tickets(),
            self._card_sla_fulfilled(),
            self._card_avg_first_response(),
            self._card_avg_resolution(),
            self._card_avg_feedback(),
        ]
        caption = self._delta_caption()
        for card in cards:
            if card.get("delta") is not None:
                card["deltaCaption"] = caption
        return cards

    def _delta_caption(self) -> str:
        if self.period_days > 1:
            return f"vs prev. {self.period_days} days"
        if self.to_date == self._today:
            return "vs yesterday"
        return "vs prev. day"

    @staticmethod
    def _change(current, prev, digits=1):
        if current is None or prev is None:
            return None
        return round(current - prev, digits)

    @staticmethod
    def _round(value, digits=1):
        return None if value is None else round(value, digits)

    def _card_tickets(self) -> dict:
        current = sum(1 for _ in self._scoped(self._cur))
        prev = sum(1 for _ in self._scoped(self._prev))
        # no previous period to compare against: no delta, not a 0% change
        delta = round((current - prev) / prev * 100) if prev else None
        return {"title": "Tickets", "value": current, "delta": delta,
                "deltaSuffix": "%", "negativeIsBetter": True,
                "tooltip": "Total number of tickets created"}

    def _sla_pct(self, window):
        """(% fulfilled, total) over resolved-status tickets carrying an SLA."""
        total = fulfilled = 0
        for t in self._scoped(window):
            if t.sla_id is None or t.status_id not in self.resolved_ids:
                continue
            total += 1
            if t.agreement_status == "Fulfilled":
                fulfilled += 1
        return (fulfilled / total * 100 if total else None), total

    def _card_sla_fulfilled(self) -> dict:
        cur_pct, _ = self._sla_pct(self._cur)
        prev_pct, _ = self._sla_pct(self._prev)
        return {"title": "% SLA Fulfilled", "value": self._round(cur_pct, 0),
                "suffix": "%", "delta": self._change(cur_pct, prev_pct, 0),
                "deltaSuffix": "%",
                "tooltip": "% of tickets created that were resolved within SLA"}

    def _avg_first_response(self, window):
        vals = [t.first_response_time / 3600 for t in self._scoped(window)
                if t.sla_id is not None and t.first_responded_on is not None
                and t.first_response_time is not None]
        return sum(vals) / len(vals) if vals else None

    def _card_avg_first_response(self) -> dict:
        cur = self._avg_first_response(self._cur)
        prev = self._avg_first_response(self._prev)
        return {"title": "Avg. First Response", "value": self._round(cur),
                "suffix": " hrs", "delta": self._change(cur, prev),
                "deltaSuffix": " hrs", "negativeIsBetter": True,
                "tooltip": "Avg. time taken to first respond to a ticket"}

    def _avg_resolution(self, window):
        vals = [math.ceil(t.resolution_time / 86400) for t in self._scoped(window)
                if t.sla_id is not None and t.status_id in self.resolved_ids
                and t.resolution_time is not None]
        return sum(vals) / len(vals) if vals else None

    def _card_avg_resolution(self) -> dict:
        cur = self._avg_resolution(self._cur)
        prev = self._avg_resolution(self._prev)
        return {"title": "Avg. Resolution", "value": self._round(cur),
                "suffix": " days", "delta": self._change(cur, prev),
                "deltaSuffix": " days", "negativeIsBetter": True,
                "tooltip": "Avg. time taken to resolve a ticket"}

    def _avg_feedback(self, window):
        # keyed off resolution_date (feedback belongs to the resolution period)
        vals = [t.feedback_rating * 5 for t in self._scoped(window, "resolution_date")
                if t.feedback_rating and t.feedback_rating > 0]
        return sum(vals) / len(vals) if vals else None

    def _card_avg_feedback(self) -> dict:
        cur = self._avg_feedback(self._cur)
        prev = self._avg_feedback(self._prev)
        return {"title": "Avg. Feedback Rating", "value": self._round(cur),
                "suffix": "/5", "delta": self._change(cur, prev),
                "deltaSuffix": " stars",
                "tooltip": "Avg. feedback rating for tickets resolved in this period"}

    # ─── trend (get_trend_data) ──────────────────────────────────────────────
    def trend(self) -> list:
        return [self._ticket_trend(), self._feedback_trend()]

    def _ticket_trend(self) -> dict:
        by_day: dict = {}
        total = 0
        for t in self._scoped(self._cur):
            d = t.created_at.date().isoformat()
            row = by_day.setdefault(d, {"date": d, OPEN: 0, "Closed": 0,
                                        "_f": 0, "_sla": 0})
            total += 1
            if t.status_id in self.open_ids:
                row[OPEN] += 1
            if t.status_id in self.resolved_ids:
                row["Closed"] += 1
            if t.sla_id is not None and t.status_id in self.resolved_ids:
                row["_sla"] += 1
                if t.agreement_status == "Fulfilled":
                    row["_f"] += 1
        data = []
        for d in sorted(by_day):
            row = by_day[d]
            sla_pct = (row["_f"] * 100 / row["_sla"]) if row["_sla"] else None
            data.append({"date": d, "Closed": row["Closed"], OPEN: row[OPEN],
                         "SLA Fulfilled": sla_pct})
        avg = total / self.period_days if self.period_days else 0
        return _bar(
            data, "ticket_trend", "Ticket Trend",
            f"Average tickets per day is around {avg:.0f}",
            "date", ["Closed", OPEN], y2="SLA Fulfilled", stacked=True,
            xAxis={"type": "time", "title": "Date", "timeGrain": "day"})

    def _feedback_trend(self) -> dict:
        by_day: dict = {}
        rated_vals = []
        for t in self._scoped(self._cur, "resolution_date"):
            d = t.resolution_date.date().isoformat()
            row = by_day.setdefault(d, {"date": d, "_sum": 0.0, "Rated Tickets": 0})
            if t.feedback_rating and t.feedback_rating > 0:
                row["_sum"] += t.feedback_rating * 5
                row["Rated Tickets"] += 1
                rated_vals.append(t.feedback_rating * 5)
        data = []
        for d in sorted(by_day):
            row = by_day[d]
            rating = (row["_sum"] / row["Rated Tickets"]) if row["Rated Tickets"] else None
            data.append({"date": d, "Rating": rating,
                         "Rated Tickets": row["Rated Tickets"]})
        avg = sum(rated_vals) / len(rated_vals) if rated_vals else 0
        return _bar(
            data, "feedback_trend", "Feedback Trend",
            f"Average feedback rating per day is around {avg:.1f} stars",
            "date", "Rated Tickets", y2="Rating",
            xAxis={"type": "time", "title": "Date", "timeGrain": "day"})

    # ─── master charts (get_master_dashboard_data) ───────────────────────────
    def master(self) -> list:
        return [self._by_team(), self._by_type(), self._by_priority(), self._by_channel()]

    def _counts(self, key):
        """Ordered [{label, count}] over the scoped current window, busiest first."""
        c = Counter(key(t) for t in self._scoped(self._cur))
        return [{"_k": k, "count": n} for k, n in c.most_common()]

    def _pie_or_bar(self, rows, key, label, key_id, title_noun):
        data = [{label: r["_k"], "count": r["count"]} for r in rows]
        if len(data) < 7:
            return _pie(data, f"tickets_by_{key_id}", f"Tickets by {title_noun}",
                        f"Percentage of total tickets by {key_id}", label, "count")
        return _bar(data, f"tickets_by_{key_id}", f"Tickets by {title_noun}",
                    f"Total tickets by {title_noun.lower()}", label, "count",
                    xAxis={"type": "category", "title": title_noun})

    def _by_team(self) -> dict:
        rows = self._counts(lambda t: t.team.name if t.team else "No Team")
        return self._pie_or_bar(rows, None, "team", "team", "Team")

    def _by_type(self) -> dict:
        rows = self._counts(lambda t: t.ticket_type.name if t.ticket_type else None)
        return self._pie_or_bar(rows, None, "type", "type", "Type")

    def _by_priority(self) -> dict:
        rows = self._counts(
            lambda t: (t.priority.name or t.priority.level) if t.priority else None)
        return self._pie_or_bar(rows, None, "priority", "priority", "Priority")

    def _by_channel(self) -> dict:
        rows = self._counts(lambda t: "Portal" if t.via_customer_portal else "Email")
        data = [{"channel": r["_k"], "count": r["count"]} for r in rows]
        return _pie(data, "tickets_by_channel", "Tickets by Channel",
                    "Percentage of total tickets by channel", "channel", "count")


# ─── router (dashboard surface) ───────────────────────────────────────────
# Mirrors Frappe's single get_dashboard_data(dashboard_type, filters) endpoint.
# NOT mounted here (router.py is out of scope for this conversion); the cutover
# step wires dashboard_router + analytics.router onto the app.
dashboard_router = APIRouter(prefix="/helpdesk", tags=["Help Desk analytics (native)"])


@dashboard_router.get("/dashboard-data")
def dashboard_data(
    dashboard_type: Optional[str] = None,
    type: Optional[str] = None,  # noqa: A002 — the dashboard page sends ?type=; dashboard_type kept for callers
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    team: Optional[str] = None,
    agent: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_view),
):
    """§ get_dashboard_data. Agent/team scoped. A non-manager may read the
    tenant-wide aggregate (no agent, no team — read-only, same rollup the ungated
    /dashboard-analytics already exposes) and their OWN agent data, but not
    another agent's or a team's (403). Resolve @me FIRST so an agent reading
    their own stats passes the gate."""
    if agent == "@me":
        agent = current_user.email
    if not _is_manager(db, current_user) and (team or (agent and agent != current_user.email)):
        raise HTTPException(status_code=403,
                            detail="You are not allowed to view this dashboard data.")

    dashboard_type = dashboard_type or type
    nd = NativeDashboard(db, tenant_id(db), from_date, to_date, team, agent)
    if dashboard_type == "number_card":
        return nd.number_cards()
    if dashboard_type == "master":
        return nd.master()
    if dashboard_type == "trend":
        return nd.trend()
    if dashboard_type == "tags":
        from . import analytics  # lazy: analytics imports this module (Frappe does the same)
        return analytics.tag_charts(nd)
    return []


@dashboard_router.get("/dashboard-overview")
def dashboard_overview(
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: Session = Depends(get_db),
    _: bool = Depends(require_view),
):
    """Tenant-wide analytics() with an optional window — the range-aware twin of
    /dashboard-analytics that backs the UI's 7/30/90-day selector. Same shape;
    KPIs + breakdowns scoped to the window, trend spans it. Ungated read-only."""
    return analytics(db, tenant_id(db), from_date, to_date)


if __name__ == "__main__":
    # Self-check for the DB-free helpers.
    assert pct_change(10, 5) == 100.0 and pct_change(5, 10) == -50.0
    assert pct_change(5, 0) is None and pct_change(0, 0) == 0
    assert _to_date("2024-03-15", date(2000, 1, 1)) == date(2024, 3, 15)
    assert _to_date(None, date(2000, 1, 1)) == date(2000, 1, 1)
    assert _to_date("2024-03-15T09:00:00", date(2000, 1, 1)) == date(2024, 3, 15)
    assert NativeDashboard._change(5.0, 2.0) == 3.0
    assert NativeDashboard._change(5.0, None) is None
    assert NativeDashboard._round(None) is None and NativeDashboard._round(1.234) == 1.2
    assert _pie([], "k", "t", "s", "cat", "val")["type"] == "donut"
    assert _bar([], "k", "t", "s", "x", "y", stacked=True)["stacked"] is True
    print("dashboard self-check ok")
