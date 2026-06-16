"""Closure Tracker — aggregate dashboard for the Issues module.

Returns KPIs + status mix + ageing buckets + by-category + by-severity +
SLA breach feed + recent activity in a single round trip, so the UI
mirrors the framework dashboard pattern.
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import Issue, IssueActivity, IssueAction, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

_require_view = require_tenant_permission("issue_management:issues:view")

router = APIRouter(
    prefix="/dashboard",
    tags=["Issue Management - Dashboard"],
    dependencies=[Depends(_require_view)],
)


STATUS_COLORS = {
    "new": "#94a3b8",
    "triage": "#a78bfa",
    "in_progress": "#3b82f6",
    "resolution": "#0ea5e9",
    "closure_review": "#f59e0b",
    "closed": "#10b981",
    "cancelled": "#cbd5e1",
}
STATUS_LABELS = {
    "new": "New",
    "triage": "Triage",
    "in_progress": "In Progress",
    "resolution": "Resolution",
    "closure_review": "Closure Review",
    "closed": "Closed",
    "cancelled": "Cancelled",
}


@router.get("/aggregate")
def get_issues_aggregate(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "kpis": {}, "status_mix": [], "ageing_buckets": [],
            "by_category": [], "by_severity": [],
            "sla_breach_feed": [], "recent_activity": [],
        }

    base = db.query(Issue).filter(Issue.tenant_id.in_(user_tenants))
    all_issues = base.all()
    now = datetime.utcnow()
    thirty_days_ago = now - timedelta(days=30)

    # Status mix ─────────────────────────────────────────────────────────
    status_counts: Dict[str, int] = {}
    for i in all_issues:
        s = (i.workflow_state or "new")
        status_counts[s] = status_counts.get(s, 0) + 1

    status_mix = [
        {
            "key": k,
            "name": STATUS_LABELS.get(k, k.title()),
            "value": v,
            "color": STATUS_COLORS.get(k, "#94a3b8"),
        }
        for k, v in status_counts.items() if v > 0
    ]

    # KPIs ───────────────────────────────────────────────────────────────
    open_states = {"new", "triage", "in_progress", "resolution"}
    closed_30d = sum(
        1 for i in all_issues
        if i.workflow_state == "closed" and i.closed_at and i.closed_at >= thirty_days_ago
    )
    avg_ttc = 0.0
    closed_with_dates = [i for i in all_issues if i.workflow_state == "closed" and i.closed_at and i.created_at]
    if closed_with_dates:
        deltas = [(i.closed_at - i.created_at).total_seconds() / 86400 for i in closed_with_dates]
        avg_ttc = round(sum(deltas) / len(deltas), 1)

    kpis = {
        "open": sum(1 for i in all_issues if (i.workflow_state or "new") in open_states),
        "in_progress": status_counts.get("in_progress", 0),
        "awaiting_closure": status_counts.get("closure_review", 0),
        "closed_30d": closed_30d,
        "sla_breached": sum(1 for i in all_issues if i.sla_breached),
        "avg_time_to_close_days": avg_ttc,
        "critical_open": sum(
            1 for i in all_issues
            if (i.workflow_state or "new") in open_states and (i.severity or "").lower() == "critical"
        ),
        "total": len(all_issues),
    }

    # Ageing buckets (only open issues) ──────────────────────────────────
    buckets = {"0–7d": 0, "8–30d": 0, "31–90d": 0, ">90d": 0}
    for i in all_issues:
        if (i.workflow_state or "new") not in open_states or not i.created_at:
            continue
        age_days = (now - i.created_at).days
        if age_days <= 7:        buckets["0–7d"] += 1
        elif age_days <= 30:     buckets["8–30d"] += 1
        elif age_days <= 90:     buckets["31–90d"] += 1
        else:                    buckets[">90d"] += 1
    ageing_buckets = [{"label": k, "count": v} for k, v in buckets.items()]

    # By category + by severity ──────────────────────────────────────────
    cat_open: Dict[str, int] = {}
    cat_closed_30d: Dict[str, int] = {}
    sev_counts: Dict[str, int] = {}
    for i in all_issues:
        cat = i.category or "uncategorised"
        if (i.workflow_state or "new") in open_states:
            cat_open[cat] = cat_open.get(cat, 0) + 1
        if i.workflow_state == "closed" and i.closed_at and i.closed_at >= thirty_days_ago:
            cat_closed_30d[cat] = cat_closed_30d.get(cat, 0) + 1
        sev = i.severity or "medium"
        sev_counts[sev] = sev_counts.get(sev, 0) + 1
    by_category = sorted(
        [{"category": c, "open": cat_open.get(c, 0), "closed_30d": cat_closed_30d.get(c, 0)}
         for c in set(list(cat_open.keys()) + list(cat_closed_30d.keys()))],
        key=lambda x: x["open"], reverse=True,
    )
    by_severity = sorted(
        [{"severity": s, "count": v} for s, v in sev_counts.items()],
        key=lambda x: ["critical", "high", "medium", "low", "informational"].index(x["severity"])
            if x["severity"] in ["critical", "high", "medium", "low", "informational"] else 99,
    )

    # SLA breach feed ────────────────────────────────────────────────────
    breach_feed = []
    for i in all_issues:
        if not i.sla_breached or (i.workflow_state or "new") not in open_states:
            continue
        days_overdue = (now - i.target_closure_date).days if i.target_closure_date else 0
        breach_feed.append({
            "id": i.id, "code": i.code, "title": i.title,
            "severity": i.severity, "target_closure_date": i.target_closure_date.isoformat() if i.target_closure_date else None,
            "days_overdue": days_overdue,
        })
    breach_feed.sort(key=lambda x: x["days_overdue"], reverse=True)
    breach_feed = breach_feed[:10]

    # Recent activity ────────────────────────────────────────────────────
    issue_ids = [i.id for i in all_issues]
    activity = []
    if issue_ids:
        rows = db.query(IssueActivity).options(joinedload(IssueActivity.user)).filter(
            IssueActivity.issue_id.in_(issue_ids),
        ).order_by(IssueActivity.created_at.desc()).limit(15).all()
        issue_by_id = {i.id: i for i in all_issues}
        for a in rows:
            issue = issue_by_id.get(a.issue_id)
            if not issue:
                continue
            activity.append({
                "type": a.type,
                "issue_id": a.issue_id,
                "code": issue.code,
                "title": issue.title,
                "user": getattr(a.user, "display_name", None) or getattr(a.user, "username", None) if a.user else None,
                "when": a.created_at.isoformat() if a.created_at else None,
            })

    # ── v2: by_source rollup (additive — existing readers ignore) ────────
    SOURCE_LABELS = {
        "vulnerability": "Vulnerability",
        "risk": "Risk",
        "asset": "Asset",
        "control_test": "Control",
        "control_framework": "Control",
        "control_parsed": "Control",
        "control_normalized": "Control",
        "control_internal": "Control",
        "audit": "Audit",
        "vendor_review": "Vendor",
        "governance_document": "Governance",
        "policy_statement": "Governance",
        "kri_breach": "KRI Breach",
        "mitigation_overdue": "Overdue Mitigation",
        "incident_report": "Incident",
        "manual": "Manual",
    }
    SOURCE_COLORS = {
        "Vulnerability": "#f97316",
        "Risk":          "#a855f7",
        "Asset":         "#0ea5e9",
        "Control":       "#3b82f6",
        "Audit":         "#10b981",
        "Vendor":        "#eab308",
        "Governance":    "#6366f1",
        "KRI Breach":    "#ef4444",
        "Overdue Mitigation": "#f43f5e",
        "Incident":      "#dc2626",
        "Manual":        "#94a3b8",
    }
    by_source_counts: Dict[str, int] = {}
    by_source_critical: Dict[str, int] = {}
    for i in all_issues:
        if (i.workflow_state or "new") not in open_states:
            continue
        label = SOURCE_LABELS.get(i.source_type or "manual", "Other")
        by_source_counts[label] = by_source_counts.get(label, 0) + 1
        if (i.severity or "").lower() == "critical":
            by_source_critical[label] = by_source_critical.get(label, 0) + 1
    by_source = [
        {"name": k, "value": v, "critical": by_source_critical.get(k, 0), "color": SOURCE_COLORS.get(k, "#94a3b8")}
        for k, v in sorted(by_source_counts.items(), key=lambda x: x[1], reverse=True)
    ]

    # ── v3: analytical lenses for the new IssueAnalytics panel ───────────
    #
    # Everything below is computed from already-loaded `all_issues` so we
    # don't add new DB round-trips. Existing readers ignore unknown keys —
    # the response shape stays backward-compatible.
    SEVERITY_ORDER = ["critical", "high", "medium", "low", "informational"]
    SEVERITY_COLORS = {
        "critical": "#dc2626",
        "high": "#f97316",
        "medium": "#f59e0b",
        "low": "#3b82f6",
        "informational": "#94a3b8",
    }
    AGE_BUCKETS = ["0–7d", "8–30d", "31–90d", ">90d"]

    # 1) Trend — opened vs closed by ISO-week for the last 12 weeks.
    #
    # We bucket on `created_at` for opens and `closed_at` for closes so the
    # chart reflects throughput, not just current snapshot. Net = opened − closed,
    # surfaced as a 7th key so the chart can shade a "backlog growing /
    # shrinking" band.
    week_starts: list = []
    today_week_start = (now - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    for w in range(11, -1, -1):
        week_starts.append(today_week_start - timedelta(weeks=w))
    trend_12w: list = []
    for ws in week_starts:
        we = ws + timedelta(days=7)
        opened = sum(1 for i in all_issues if i.created_at and ws <= i.created_at < we)
        closed = sum(1 for i in all_issues if i.closed_at and ws <= i.closed_at < we)
        trend_12w.append({
            "week_start": ws.date().isoformat(),
            "label": ws.strftime("%d %b"),
            "opened": opened,
            "closed": closed,
            "net": opened - closed,
        })

    # 2) MTTR by severity — mean & median time-to-close in days for
    # closed issues in the last 90 days. We expose the count too so the
    # UI can show "n=N" alongside the bar (a 3-day MTTR computed from one
    # sample isn't trustworthy and the operator deserves to see that).
    ninety_days_ago = now - timedelta(days=90)
    mttr_by_severity: list = []
    for sev in SEVERITY_ORDER:
        closed_in_window = [
            i for i in all_issues
            if i.workflow_state == "closed"
            and i.closed_at and i.created_at
            and i.closed_at >= ninety_days_ago
            and (i.severity or "medium").lower() == sev
        ]
        n = len(closed_in_window)
        if n == 0:
            mttr_by_severity.append({
                "severity": sev, "count": 0,
                "mean_days": None, "median_days": None,
                "color": SEVERITY_COLORS[sev],
            })
            continue
        deltas = sorted(
            (i.closed_at - i.created_at).total_seconds() / 86400
            for i in closed_in_window
        )
        mean_d = round(sum(deltas) / n, 1)
        # Median: even-n averages the middle two.
        mid = n // 2
        median_d = round(
            deltas[mid] if n % 2 == 1 else (deltas[mid - 1] + deltas[mid]) / 2,
            1,
        )
        mttr_by_severity.append({
            "severity": sev, "count": n,
            "mean_days": mean_d, "median_days": median_d,
            "color": SEVERITY_COLORS[sev],
        })

    # 3) Top assignees — who carries the open load. Top 8 by open count,
    # broken down by severity so a stacked-bar chart can show "Alice has 12
    # open, 3 of them critical".
    open_by_assignee: Dict[int, Dict[str, int]] = {}
    for i in all_issues:
        if (i.workflow_state or "new") not in open_states or not i.assignee_id:
            continue
        bucket = open_by_assignee.setdefault(
            i.assignee_id,
            {s: 0 for s in SEVERITY_ORDER} | {"total": 0},
        )
        sev_l = (i.severity or "medium").lower()
        if sev_l in bucket:
            bucket[sev_l] += 1
        bucket["total"] += 1
    user_ids = list(open_by_assignee.keys())
    user_lookup: Dict[int, str] = {}
    if user_ids:
        rows = db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(
            GRCUser.id.in_(user_ids),
        ).all()
        user_lookup = {
            r.id: (r.display_name or r.username or f"user#{r.id}") for r in rows
        }
    top_assignees = sorted(
        [
            {
                "user_id": uid,
                "name": user_lookup.get(uid, f"user#{uid}"),
                "total": b["total"],
                "critical": b.get("critical", 0),
                "high": b.get("high", 0),
                "medium": b.get("medium", 0),
                "low": b.get("low", 0),
                "informational": b.get("informational", 0),
            }
            for uid, b in open_by_assignee.items()
        ],
        key=lambda x: x["total"],
        reverse=True,
    )[:8]

    # 4) SLA compliance by severity — % of CLOSED issues per severity that
    # closed by their target_closure_date. This is a backward-looking quality
    # metric distinct from `sla_breached` (which counts current overdue
    # opens). Operators ask both: "how many are red right now" and "how
    # often do we hit our SLA when we DO close work" — separate questions.
    sla_compliance_by_severity: list = []
    for sev in SEVERITY_ORDER:
        closed_with_target = [
            i for i in all_issues
            if i.workflow_state == "closed"
            and i.closed_at and i.target_closure_date
            and (i.severity or "medium").lower() == sev
        ]
        n = len(closed_with_target)
        if n == 0:
            sla_compliance_by_severity.append({
                "severity": sev, "count": 0, "compliant_pct": None,
                "color": SEVERITY_COLORS[sev],
            })
            continue
        compliant = sum(
            1 for i in closed_with_target
            if i.closed_at <= i.target_closure_date
        )
        sla_compliance_by_severity.append({
            "severity": sev,
            "count": n,
            "compliant_pct": round(100.0 * compliant / n, 1),
            "color": SEVERITY_COLORS[sev],
        })

    # 5) Severity × Age heatmap — open issues only, counts by
    # (severity, age bucket). Visualised as a matrix so the operator can
    # spot "old + critical" cells immediately (top-right of the grid).
    severity_age_matrix: Dict[str, Dict[str, int]] = {
        s: {b: 0 for b in AGE_BUCKETS} for s in SEVERITY_ORDER
    }
    for i in all_issues:
        if (i.workflow_state or "new") not in open_states or not i.created_at:
            continue
        sev_l = (i.severity or "medium").lower()
        if sev_l not in severity_age_matrix:
            continue
        age_days = (now - i.created_at).days
        bucket = (
            "0–7d" if age_days <= 7
            else "8–30d" if age_days <= 30
            else "31–90d" if age_days <= 90
            else ">90d"
        )
        severity_age_matrix[sev_l][bucket] += 1
    severity_age_matrix_out = [
        {
            "severity": sev,
            "color": SEVERITY_COLORS[sev],
            "cells": [
                {"bucket": b, "count": severity_age_matrix[sev][b]}
                for b in AGE_BUCKETS
            ],
            "total": sum(severity_age_matrix[sev].values()),
        }
        for sev in SEVERITY_ORDER
    ]

    # 6) Reopen stats — heuristic from IssueActivity rows. A "reopen" is
    # any activity whose `type` contains "reopen" OR a transition back from
    # `closed` to any earlier state (state-changed payload). We approximate
    # cheaply from the activity rows we already fetch above + an additional
    # lightweight query for "reopen" activities specifically.
    reopen_count = 0
    if issue_ids:
        reopen_count = (
            db.query(func.count(IssueActivity.id))
            .filter(
                IssueActivity.issue_id.in_(issue_ids),
                IssueActivity.type.ilike("%reopen%"),
            )
            .scalar() or 0
        )
    closed_total = sum(1 for i in all_issues if i.workflow_state == "closed")
    reopen_stats = {
        "reopen_count": int(reopen_count),
        "closed_total": closed_total,
        # Rate is reopens per 100 closures so the chart label reads cleanly.
        "reopen_rate_pct": (
            round(100.0 * reopen_count / closed_total, 1) if closed_total else None
        ),
    }

    return {
        "kpis": kpis,
        "status_mix": status_mix,
        "ageing_buckets": ageing_buckets,
        "by_category": by_category,
        "by_severity": by_severity,
        "by_source": by_source,
        "sla_breach_feed": breach_feed,
        "recent_activity": activity,
        # v3 analytical lenses
        "trend_12w": trend_12w,
        "mttr_by_severity": mttr_by_severity,
        "top_assignees": top_assignees,
        "sla_compliance_by_severity": sla_compliance_by_severity,
        "severity_age_matrix": severity_age_matrix_out,
        "reopen_stats": reopen_stats,
    }
