"""Server-side formulas for the Token-usage dashboard.

Everything the page renders is computed here from the tenant-local usage ledger
(`ai_usage_events`) and budget config (`ai_token_budget_config`,
`ai_module_budgets`). No prompt/response content is ever read. The frontend
receives display-ready numbers/labels — no business logic client-side.
"""

from __future__ import annotations

import calendar
import zlib
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func, desc

from ..models import (
    AIUsageEvent,
    AITokenBudgetConfig,
    AIModuleBudget,
    GRCUser,
    DEFAULT_MONTHLY_QUOTA,
    DEFAULT_BLENDED_RATE,
    DEFAULT_BILLING_CYCLE_DAY,
)

# Design module palette (rust, green, blue, violet, gold, slate, + extensions).
_PALETTE = ["#C2542E", "#0E5A46", "#2E5EAA", "#7A5CA8", "#C79A2A", "#55606B", "#3A7D6B", "#9B6A2F"]

# Friendly, business-facing names for the technical module_key values emitted by
# the usage attributor. Unknown keys are humanized on the fly.
_MODULE_LABELS = {
    "erm": "Enterprise Risk Management",
    "risks": "Risk Management",
    "governance": "Policy Management",
    "compliance": "Compliance",
    "compliance_plugins": "Compliance Plugins",
    "control_library": "Control Library",
    "controls": "Controls",
    "audit": "Audit Management",
    "vendor_risk": "Third-Party Risk",
    "access_review": "Access Reviews",
    "certification": "Certifications",
    "assets": "IT Assets",
    "evidence": "Evidence",
    "frameworks": "Frameworks",
    "dashboard": "Dashboard",
    "complychat": "ComplyChat",
    "chatbot": "ComplyChat",
    "tasks": "Tasks",
    "projects": "Projects",
    "incident": "Incident Management",
    "bcm": "Business Continuity",
    "documents": "Documents",
    "unclassified": "Unclassified",
}

# A few fixed colors so the flagship modules match the design; the rest are
# assigned by a stable hash so a module keeps its color across ranges/sessions.
_MODULE_COLORS = {
    "erm": "#C2542E", "risks": "#C2542E",
    "compliance": "#0E5A46", "compliance_plugins": "#0E5A46",
    "audit": "#2E5EAA",
    "vendor_risk": "#7A5CA8",
    "governance": "#C79A2A",
    "incident": "#55606B",
}

_ACRONYMS = {"ai": "AI", "kri": "KRI", "soc2": "SOC 2", "soc": "SOC", "pii": "PII",
             "kpi": "KPI", "sla": "SLA", "rcsa": "RCSA", "bia": "BIA", "id": "ID"}


def module_label(key: str) -> str:
    if key in _MODULE_LABELS:
        return _MODULE_LABELS[key]
    return _humanize(key)


def module_color(key: str) -> str:
    if key in _MODULE_COLORS:
        return _MODULE_COLORS[key]
    return _PALETTE[zlib.crc32(key.encode("utf-8")) % len(_PALETTE)]


def _humanize(key: str) -> str:
    words = [w for w in key.replace("-", "_").split("_") if w]
    return " ".join(_ACRONYMS.get(w.lower(), w.capitalize()) for w in words) or key


# ---------------------------------------------------------------------------
# Range + cycle math
# ---------------------------------------------------------------------------

def _granularity(range_key: str) -> str:
    if range_key == "24h":
        return "hour"
    if range_key == "90d":
        return "3day"
    return "day"


def _resolve_range(range_key: str, now: datetime, cycle_day: int) -> tuple[datetime, datetime, str]:
    """Return (start, previous_start, label) for the selected range.

    previous_start anchors the equal-length preceding window used for trends.
    """
    if range_key == "24h":
        start = now - timedelta(hours=24)
        return start, start - timedelta(hours=24), "Last 24 hours"
    if range_key == "7d":
        start = now - timedelta(days=7)
        return start, start - timedelta(days=7), "Last 7 days"
    if range_key == "90d":
        start = now - timedelta(days=90)
        return start, start - timedelta(days=90), "Last 90 days"
    if range_key == "cycle":
        start = _cycle_start(now, cycle_day)
        length = now - start
        return start, start - length, "Billing cycle"
    # default 30d
    start = now - timedelta(days=30)
    return start, start - timedelta(days=30), "Last 30 days"


def _cycle_start(now: datetime, cycle_day: int) -> datetime:
    day = min(max(cycle_day, 1), 28)
    anchor = now.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    if anchor > now:
        # cycle day hasn't arrived yet this month → cycle started last month
        prev_month = (anchor.replace(day=1) - timedelta(days=1))
        anchor = prev_month.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    return anchor


def _pct(part: float, whole: float) -> float:
    return round((part / whole) * 100, 1) if whole else 0.0


def _trend(current: float, previous: float) -> float:
    if not previous:
        return 0.0
    return round(((current - previous) / previous) * 100, 1)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def get_or_create_config(db) -> AITokenBudgetConfig:
    cfg = db.query(AITokenBudgetConfig).first()
    if not cfg:
        cfg = AITokenBudgetConfig(
            monthly_quota=DEFAULT_MONTHLY_QUOTA,
            blended_rate_per_million=DEFAULT_BLENDED_RATE,
            billing_cycle_day=DEFAULT_BILLING_CYCLE_DAY,
        )
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def budgets_payload(db) -> dict:
    cfg = get_or_create_config(db)
    modules = db.query(AIModuleBudget).order_by(desc(AIModuleBudget.monthly_budget)).all()
    return {
        "monthly_quota": int(cfg.monthly_quota or 0),
        "blended_rate_per_million": float(cfg.blended_rate_per_million or 0),
        "billing_cycle_day": int(cfg.billing_cycle_day or 1),
        "updated_at": cfg.updated_at.isoformat() if cfg.updated_at else None,
        "updated_by": cfg.updated_by,
        "modules": [
            {"module_key": m.module_key, "label": module_label(m.module_key),
             "color": module_color(m.module_key), "monthly_budget": int(m.monthly_budget or 0)}
            for m in modules
        ],
    }


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------

def build_overview(db, range_key: str, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    cfg = get_or_create_config(db)
    quota = int(cfg.monthly_quota or 0)
    rate = float(cfg.blended_rate_per_million or 0)
    cycle_day = int(cfg.billing_cycle_day or 1)

    start, prev_start, label = _resolve_range(range_key, now, cycle_day)
    range_days = max((now - start).days, 1)

    module_budgets = {b.module_key: int(b.monthly_budget or 0)
                      for b in db.query(AIModuleBudget).all()}

    def cost(tokens: float) -> float:
        return round((tokens / 1_000_000.0) * rate, 2)

    # ---- range totals + previous-window total (for the headline trend) ----
    cur_tokens, cur_calls, cur_users = _totals(db, start, now)
    prev_tokens, _, _ = _totals(db, prev_start, start)

    # ---- per-module + per-feature aggregation over the range ----
    module_rows = _grouped(db, start, now, [AIUsageEvent.module_key])
    feature_rows = _grouped(db, start, now, [AIUsageEvent.module_key, AIUsageEvent.feature_key])
    prev_module = {r[0]: r[1] for r in _grouped(db, prev_start, start, [AIUsageEvent.module_key])}
    prev_feature = {(r[0], r[1]): r[2] for r in _grouped(db, prev_start, start, [AIUsageEvent.module_key, AIUsageEvent.feature_key])}

    # ---- billing-cycle usage per module (budget windows are always the cycle) ----
    cycle_start = _cycle_start(now, cycle_day)
    cycle_module = {r[0]: r[1] for r in _grouped(db, cycle_start, now, [AIUsageEvent.module_key])}
    cycle_total = sum(cycle_module.values())

    features_by_module: dict[str, list] = {}
    for mk, fk, toks in feature_rows:
        features_by_module.setdefault(mk, []).append((fk, toks))

    modules = []
    for mk, toks in module_rows:
        m_cycle = cycle_module.get(mk, 0)
        budget = module_budgets.get(mk, 0)
        feats = [
            {
                "feature_key": fk,
                "label": _humanize(fk),
                "tokens": int(ft),
                "cost": cost(ft),
                "share": _pct(ft, cur_tokens),
                "trend": _trend(ft, prev_feature.get((mk, fk), 0)),
            }
            for fk, ft in sorted(features_by_module.get(mk, []), key=lambda x: x[1], reverse=True)
        ]
        modules.append({
            "module_key": mk,
            "label": module_label(mk),
            "color": module_color(mk),
            "tokens": int(toks),
            "cost": cost(toks),
            "share": _pct(toks, cur_tokens),
            "trend": _trend(toks, prev_module.get(mk, 0)),
            "budget": budget,
            "budget_used_cycle": int(m_cycle),
            "budget_pct": _pct(m_cycle, budget) if budget else None,
            "features": feats,
        })
    modules.sort(key=lambda m: m["tokens"], reverse=True)

    # ---- budget utilization (only modules with a configured budget) ----
    utilization = sorted(
        (
            {
                "module_key": mk,
                "label": module_label(mk),
                "color": module_color(mk),
                "used": int(cycle_module.get(mk, 0)),
                "budget": bud,
                "pct": _pct(cycle_module.get(mk, 0), bud),
            }
            for mk, bud in module_budgets.items() if bud > 0
        ),
        key=lambda x: x["pct"], reverse=True,
    )

    # ---- alert banner: modules over 85% of budget within the cycle ----
    over_85 = [u for u in utilization if u["pct"] >= 85]
    days_left = _days_left_in_cycle(now, cycle_day)
    alert = None
    if over_85:
        top = over_85[0]
        others = len(over_85) - 1
        alert = {
            "module_label": top["label"],
            "pct": top["pct"],
            "days_left": days_left,
            "others": others,
            "text": (
                f"{top['label']} has used {top['pct']:.0f}% of its monthly token budget "
                f"with {days_left} day{'s' if days_left != 1 else ''} left in the cycle."
                + (f" {others} other module{'s' if others != 1 else ''} above 85%." if others else "")
            ),
        }

    # ---- month-end projection (cycle usage extrapolated over the month) ----
    elapsed = max((now - cycle_start).days, 1)
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    projection = int(cycle_total / elapsed * days_in_month) if elapsed else cycle_total

    # ---- stacked series (hourly for 24h, daily, or 3-day buckets for 90d) ----
    granularity = _granularity(range_key)
    series = _series(db, start, now, granularity)

    # ---- top consumers over the range ----
    consumers, active_users = _top_consumers(db, start, now)

    top_module = modules[0] if modules else None

    return {
        "range": range_key,
        "range_label": label,
        "granularity": granularity,
        "generated_at": now.isoformat(),
        "currency": "USD",
        "blended_rate_per_million": rate,
        "cost_configured": rate > 0,
        "summary": {
            "total_tokens": int(cur_tokens),
            "total_cost": cost(cur_tokens),
            "calls": int(cur_calls),
            "active_users": int(cur_users),
            "daily_average": int(cur_tokens / range_days),
            "trend_pct": _trend(cur_tokens, prev_tokens),
        },
        "quota": {
            "monthly_quota": quota,
            "cycle_used": int(cycle_total),
            "cycle_pct": _pct(cycle_total, quota),
            "projection": projection,
            "projection_over": projection > quota,
        },
        "top_module": {
            "module_key": top_module["module_key"],
            "label": top_module["label"],
            "color": top_module["color"],
            "tokens": top_module["tokens"],
            "share": top_module["share"],
        } if top_module else None,
        "alert": alert,
        "modules": modules,
        "utilization": utilization,
        "projection_note": {
            "value": projection,
            "quota": quota,
            "over": projection > quota,
        },
        "series": series,
        "consumers": consumers,
        "active_user_count": active_users,
    }


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def _totals(db, start, end):
    row = (
        db.query(
            func.coalesce(func.sum(AIUsageEvent.total_tokens), 0),
            func.count(AIUsageEvent.id),
            func.count(func.distinct(AIUsageEvent.actor_username)),
        )
        .filter(AIUsageEvent.occurred_at >= start, AIUsageEvent.occurred_at < end)
        .one()
    )
    return int(row[0] or 0), int(row[1] or 0), int(row[2] or 0)


def _grouped(db, start, end, cols):
    q = (
        db.query(*cols, func.coalesce(func.sum(AIUsageEvent.total_tokens), 0))
        .filter(AIUsageEvent.occurred_at >= start, AIUsageEvent.occurred_at < end)
        .group_by(*cols)
    )
    return [tuple(r[:-1]) + (int(r[-1] or 0),) if len(cols) > 1 else (r[0], int(r[1] or 0)) for r in q.all()]


def _series(db, start, end, granularity):
    """Stacked token series per module at the requested granularity."""
    if granularity == "hour":
        return _hourly_series(db, start, end)
    bucket_days = 3 if granularity == "3day" else 1
    day_col = func.date(AIUsageEvent.occurred_at)
    rows = (
        db.query(day_col, AIUsageEvent.module_key, func.coalesce(func.sum(AIUsageEvent.total_tokens), 0))
        .filter(AIUsageEvent.occurred_at >= start, AIUsageEvent.occurred_at < end)
        .group_by(day_col, AIUsageEvent.module_key)
        .all()
    )
    # index: bucket_start_date -> {module_key: tokens}
    start_date = start.date()
    total_days = max((end.date() - start_date).days, 1)
    buckets: list[dict] = []
    for i in range(0, total_days, bucket_days):
        buckets.append({"date": (start_date + timedelta(days=i)).isoformat(), "values": {}})

    def bucket_index(d):
        return min((d - start_date).days // bucket_days, len(buckets) - 1)

    for day, mk, toks in rows:
        d = day if hasattr(day, "toordinal") else datetime.fromisoformat(str(day)).date()
        idx = bucket_index(d)
        if 0 <= idx < len(buckets):
            b = buckets[idx]["values"]
            b[mk] = b.get(mk, 0) + int(toks or 0)
    return buckets


def _hourly_series(db, start, end):
    """Per-hour tokens per module (DB-agnostic: buckets raw rows in Python).

    Bounded to a 24h window, so the raw-row scan stays small. Lets live intraday
    usage show up as separate hourly bars rather than one daily bar.
    """
    rows = (
        db.query(AIUsageEvent.occurred_at, AIUsageEvent.module_key, AIUsageEvent.total_tokens)
        .filter(AIUsageEvent.occurred_at >= start, AIUsageEvent.occurred_at < end)
        .all()
    )
    start_hour = start.replace(minute=0, second=0, microsecond=0)
    total_hours = max(int((end - start_hour).total_seconds() // 3600) + 1, 1)
    buckets = [{"date": (start_hour + timedelta(hours=i)).isoformat(), "values": {}} for i in range(total_hours)]
    for ts, mk, toks in rows:
        if ts is None:
            continue
        if isinstance(ts, str):
            ts = datetime.fromisoformat(ts)
        idx = int((ts - start_hour).total_seconds() // 3600)
        if 0 <= idx < len(buckets):
            b = buckets[idx]["values"]
            b[mk] = b.get(mk, 0) + int(toks or 0)
    return buckets


def _top_consumers(db, start, end, limit: int = 5):
    rows = (
        db.query(
            AIUsageEvent.actor_user_id,
            AIUsageEvent.actor_username,
            func.coalesce(func.sum(AIUsageEvent.total_tokens), 0),
        )
        .filter(AIUsageEvent.occurred_at >= start, AIUsageEvent.occurred_at < end)
        .group_by(AIUsageEvent.actor_user_id, AIUsageEvent.actor_username)
        .order_by(desc(func.sum(AIUsageEvent.total_tokens)))
        .all()
    )
    active = len([r for r in rows if r[1]])
    top = rows[:limit]
    # hydrate display_name + department in one pass
    user_ids = [r[0] for r in top if r[0]]
    users = {}
    if user_ids:
        for u in db.query(GRCUser).filter(GRCUser.id.in_(user_ids)).all():
            users[u.id] = u
    consumers = []
    for uid, uname, toks in top:
        u = users.get(uid)
        display = (getattr(u, "display_name", None) or uname or "System")
        consumers.append({
            "user_id": uid,
            "username": uname or "System",
            "display_name": display,
            "department": getattr(u, "department", None),
            "initials": _initials(display),
            "tokens": int(toks or 0),
        })
    return consumers, active


def _initials(name: str) -> str:
    parts = [p for p in (name or "").split() if p]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _days_left_in_cycle(now: datetime, cycle_day: int) -> int:
    start = _cycle_start(now, cycle_day)
    # next cycle start = same day next month
    if start.month == 12:
        nxt = start.replace(year=start.year + 1, month=1)
    else:
        nxt = start.replace(month=start.month + 1)
    return max((nxt.date() - now.date()).days, 0)
