"""Closure Tracker — aggregate dashboard for the Issues module.

Returns KPIs + status mix + ageing buckets + by-category + by-severity +
SLA breach feed + recent activity in a single round trip, so the UI
mirrors the framework dashboard pattern.
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, Body
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Issue, IssueActivity, IssueAction, GRCUser, get_db, RiskIncident,
    IssueEvidenceLink, IssueControlLink,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ...erm.schema_migrations import ensure_incident_schema

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


@router.get("/sections-overview")
def get_issue_incident_sections_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Issue & Incident Management board — one scored section for Issues and one
    for Incidents. Same numerator/denominator formula-card shape as the other
    module scorecards; feeds the module overview page + the main-dashboard card."""
    # This endpoint is often the FIRST thing to query RiskIncident after login
    # (the main-dashboard card fires immediately). Every ERM incidents endpoint
    # self-heals the incident schema before querying; without the same call
    # here, a tenant DB that predates the `tags` column 500s on the dashboard
    # until some ERM incidents page happens to be visited first.
    ensure_incident_schema(db)
    user_tenants = get_user_tenants(current_user, db)
    scoped = [tenant_id] if (tenant_id and tenant_id in user_tenants) else user_tenants
    now = datetime.utcnow()
    if not scoped:
        return {"as_of": now.isoformat(), "sections": {}, "attention_queue": {},
                "performance": {"score": None, "grade": None, "components": []}}

    def _m(key, label, weight, num, den, formula, inverse=False, empty_score=None):
        if den:
            pct = (num / den) * 100
            score = round(100 - pct, 1) if inverse else round(pct, 1)
        else:
            score = empty_score
        return {"key": key, "label": label, "weight": weight, "score": score,
                "numerator": num, "denominator": den, "formula": formula,
                "inverse": inverse, "target": 85}

    def _sec(metrics):
        av = [m for m in metrics if m["score"] is not None]
        tw = sum(m["weight"] for m in av)
        return round(sum(m["score"] * m["weight"] for m in av) / tw, 1) if av and tw else None

    # ---- Issues ----
    issues = db.query(Issue).filter(Issue.tenant_id.in_(scoped)).all()
    _CLOSED = ("closed", "cancelled")

    def _closed(i):
        return (i.workflow_state in _CLOSED) or ((i.status or "") in ("closed", "resolved")) or bool(i.closed_at)

    open_issues = [i for i in issues if not _closed(i)]
    closed_issues = [i for i in issues if _closed(i)]
    iss_crit_open = sum(1 for i in open_issues if (i.severity or "").lower() in ("critical", "high"))
    iss_breached = sum(1 for i in open_issues if i.sla_breached)
    iss_closed_dated = [i for i in closed_issues if i.target_closure_date and i.closed_at]
    iss_ontime = sum(1 for i in iss_closed_dated if i.closed_at <= i.target_closure_date)
    # Open-item aging (previously invisible): an open issue's age from detected_at
    # (falling back to created_at). Aged-out = open more than 30 days. Closure
    # timeliness only ever looked at *already-closed* items, so a critical issue
    # left open indefinitely used to contribute nothing.
    iss_aged = sum(1 for i in open_issues
                   if (i.detected_at or i.created_at)
                   and (now - (i.detected_at or i.created_at)).days > 30)
    # Resolution rate must reward genuine closure, not cancellation. `_closed()`
    # treats "cancelled" as closed so it stays out of the open backlog, but a
    # cancelled issue is an abandoned one — counting it as resolved would let a
    # tenant inflate the score by mass-cancelling. Numerator = closed/resolved
    # excluding cancelled; denominator stays all issues.
    iss_resolved_ok = sum(1 for i in closed_issues if (i.workflow_state or "") != "cancelled")
    # Ownership coverage — an open issue with no owner AND no assignee is an
    # accountability gap; missing owner is penalised (kept in the denominator).
    iss_owned = sum(1 for i in open_issues if i.owner_id or i.assignee_id)
    # Recurrence — a closed issue that was reopened (IssueActivity of a reopen
    # type) signals the fix didn't hold. Reuses the same `%reopen%` detection as
    # the analytics endpoint's reopen_stats.
    reopened_ids = set()
    if issue_ids := [i.id for i in issues]:
        reopened_ids = {
            r[0] for r in db.query(IssueActivity.issue_id).filter(
                IssueActivity.issue_id.in_(issue_ids),
                IssueActivity.type.ilike("%reopen%"),
            ).distinct().all()
        }
    iss_reopened = sum(1 for i in closed_issues if i.id in reopened_ids)
    # Traceability — a critical/high issue should be substantiated with at least
    # one evidence attachment OR a linked control. Serious issues without either
    # are undocumented findings.
    serious_all = [i for i in issues if (i.severity or "").lower() in ("critical", "high")]
    serious_all_ids = [i.id for i in serious_all]
    traced_ids = set()
    if serious_all_ids:
        traced_ids = {
            r[0] for r in db.query(IssueEvidenceLink.issue_id).filter(
                IssueEvidenceLink.issue_id.in_(serious_all_ids)).distinct().all()
        } | {
            r[0] for r in db.query(IssueControlLink.issue_id).filter(
                IssueControlLink.issue_id.in_(serious_all_ids)).distinct().all()
        }
    iss_traced = sum(1 for i in serious_all if i.id in traced_ids)
    issues_metrics = [
        _m("resolution_rate", "Resolution rate", 0.20, iss_resolved_ok, len(issues),
           "closed/resolved issues excluding cancelled / all issues"),
        _m("sla_adherence", "SLA adherence", 0.15, iss_breached, len(open_issues),
           "1 - (SLA-breached open issues / open issues)", inverse=True),
        _m("critical_containment", "Critical containment", 0.15, iss_crit_open, len(open_issues),
           "1 - (open critical/high issues / open issues)", inverse=True),
        _m("closure_timeliness", "Closed on time", 0.10, iss_ontime, len(iss_closed_dated),
           "issues closed on/before target closure date / closed issues with a target"),
        _m("open_aging", "Open backlog fresh", 0.10, iss_aged, len(open_issues),
           "1 - (open issues aging beyond 30 days / open issues)", inverse=True),
        _m("ownership_coverage", "Open issues owned", 0.10, iss_owned, len(open_issues),
           "open issues with an owner or assignee / open issues"),
        _m("recurrence", "No reopened issues", 0.10, iss_reopened, len(closed_issues),
           "1 - (reopened issues / closed issues)", inverse=True),
        _m("traceability", "Serious issues traceable", 0.10, iss_traced, len(serious_all),
           "critical/high issues with >=1 evidence or control link / all critical/high issues"),
    ]

    # ---- Incidents ----
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id.in_(scoped)).all()
    _INC_DONE = ("resolved", "closed")
    inc_resolved = [i for i in incidents if (i.status or "").lower() in _INC_DONE]
    inc_open = [i for i in incidents if (i.status or "").lower() not in _INC_DONE]
    inc_crit_open = sum(1 for i in inc_open if (i.severity or "").lower() in ("critical", "high"))
    inc_linked = sum(1 for i in incidents if i.risk_id)
    inc_rca = sum(1 for i in inc_resolved if i.root_cause)
    inc_dated = [i for i in inc_resolved if i.resolved_at and i.incident_date]
    inc_fast = sum(1 for i in inc_dated if (i.resolved_at - i.incident_date).days <= 30)
    # MTTD: detected within 7 days of occurrence (discovered_date vs incident_date).
    inc_detect_dated = [i for i in incidents if i.incident_date and i.discovered_date]
    inc_fast_detect = sum(1 for i in inc_detect_dated
                          if (i.discovered_date - i.incident_date).days <= 7)
    # Impact capture: resolved incidents that quantify financial or operational impact.
    inc_impact = sum(1 for i in inc_resolved
                     if (i.financial_impact is not None) or i.operational_impact)
    # Open-incident aging — mirrors the issues `open_aging` lens. An open
    # incident older than 30 days (age from incident_date, falling back to
    # created_at) is a stale, unresolved event that otherwise contributes
    # nothing to the score.
    inc_aged = sum(1 for i in inc_open
                   if (i.incident_date or i.created_at)
                   and (now - (i.incident_date or i.created_at)).days > 30)
    incidents_metrics = [
        _m("resolution_rate", "Resolution rate", 0.22, len(inc_resolved), len(incidents),
           "resolved or closed incidents / all incidents"),
        _m("critical_containment", "Critical containment", 0.18, inc_crit_open, len(inc_open),
           "1 - (open critical/high incidents / open incidents)", inverse=True),
        _m("incident_aging", "Open incidents fresh", 0.12, inc_aged, len(inc_open),
           "1 - (open incidents older than 30 days / open incidents)", inverse=True),
        _m("resolution_speed", "Resolved within 30 days", 0.13, inc_fast, len(inc_dated),
           "incidents resolved within 30 days of occurrence / resolved incidents with dates"),
        _m("detection_speed", "Detected within 7 days", 0.10, inc_fast_detect, len(inc_detect_dated),
           "incidents detected within 7 days of occurrence / incidents with occurrence + discovery dates"),
        _m("impact_assessed", "Impact quantified", 0.09, inc_impact, len(inc_resolved),
           "resolved incidents with financial or operational impact documented / resolved incidents"),
        _m("risk_linkage", "Linked to a risk", 0.09, inc_linked, len(incidents),
           "incidents linked to a risk / all incidents"),
        _m("root_cause", "Root cause captured", 0.07, inc_rca, len(inc_resolved),
           "resolved incidents with a documented root cause / resolved incidents"),
    ]

    # ---- Corrective Actions (CAPA) ----
    # The module's core engine: corrective/preventive/containment/verification
    # actions attached to issues. Scored as its own dimension (mirrors ERM's
    # "Mitigation Actions" section) so effectiveness — not just closure — counts.
    issue_ids = [i.id for i in issues]
    actions = (db.query(IssueAction).filter(IssueAction.issue_id.in_(issue_ids)).all()
               if issue_ids else [])
    _ACT_DONE = ("completed", "verified")
    _ACT_OPEN = ("planned", "in_progress", "blocked")
    act_live = [a for a in actions if (a.status or "planned") != "cancelled"]
    act_done = [a for a in act_live if (a.status or "") in _ACT_DONE]
    act_open = [a for a in act_live if (a.status or "planned") in _ACT_OPEN]
    act_overdue = sum(1 for a in act_open if a.due_date and a.due_date < now)
    act_verified = sum(1 for a in act_done if a.status == "verified" or a.verified_at)
    act_eff_reviewed = sum(1 for a in act_done if a.effectiveness_review_at)
    # Coverage ties CAPA back to issues so the section can't be gamed by simply
    # not creating actions: serious open issues *should* have a corrective action.
    issues_with_action = {a.issue_id for a in actions}
    serious_open = [i for i in open_issues if (i.severity or "").lower() in ("critical", "high")]
    serious_covered = sum(1 for i in serious_open if i.id in issues_with_action)
    capa_metrics = [
        _m("capa_coverage", "Serious issues actioned", 0.20, serious_covered, len(serious_open),
           "open critical/high issues with a corrective action / all open critical/high issues",
           empty_score=100),
        _m("completion_rate", "Actions completed", 0.30, len(act_done), len(act_live),
           "completed or verified actions / all actions (excluding cancelled)"),
        _m("on_time", "Actions on time", 0.20, act_overdue, len(act_open),
           "1 - (overdue open actions / open actions)", inverse=True, empty_score=100),
        _m("verification", "Independently verified", 0.15, act_verified, len(act_done),
           "completed actions independently verified / completed actions"),
        _m("effectiveness", "Effectiveness reviewed", 0.15, act_eff_reviewed, len(act_done),
           "completed actions with an effectiveness review / completed actions"),
    ]

    sections = {
        "issues": {"key": "issues", "label": "Issues", "weight": 0.40,
                   "score": _sec(issues_metrics), "metrics": issues_metrics,
                   "counts": {"total": len(issues), "open": len(open_issues), "closed": len(closed_issues),
                              "critical_open": iss_crit_open, "sla_breached": iss_breached}},
        "incidents": {"key": "incidents", "label": "Incidents", "weight": 0.35,
                      "score": _sec(incidents_metrics), "metrics": incidents_metrics,
                      "counts": {"total": len(incidents), "open": len(inc_open), "resolved": len(inc_resolved),
                                 "critical_open": inc_crit_open, "linked": inc_linked}},
        "corrective_actions": {"key": "corrective_actions", "label": "Corrective Actions", "weight": 0.25,
                   "score": _sec(capa_metrics), "metrics": capa_metrics,
                   "counts": {"total": len(actions), "open": len(act_open), "done": len(act_done),
                              "overdue": act_overdue, "verified": act_verified,
                              "serious_uncovered": len(serious_open) - serious_covered}},
    }

    try:
        from grc.services import scorecard_config as sc_cfg
        _cfg = sc_cfg.get_config(db, scoped[0], "issue_incident") if scoped else {}
        _target = _cfg.get("target", 85)
        sc_cfg.apply_overrides(list(sections.values()), _cfg)
    except Exception:
        _target = 85
    components = [{"key": s["key"], "label": s["label"], "score": s["score"],
                  "weight": s["weight"], "target": _target} for s in sections.values()]
    scored = [c for c in components if c["score"] is not None]
    wsum = sum(c["weight"] for c in scored)
    perf = round(sum(c["score"] * c["weight"] for c in scored) / wsum, 1) if scored and wsum else None
    grade = (None if perf is None else "excellent" if perf >= 85 else "good" if perf >= 70
             else "fair" if perf >= 50 else "poor")

    return {
        "as_of": now.isoformat(),
        "sections": sections,
        "attention_queue": {
            "open_critical_issues": iss_crit_open,
            "sla_breached_issues": iss_breached,
            "open_critical_incidents": inc_crit_open,
            "open_incidents": len(inc_open),
            "overdue_corrective_actions": act_overdue,
            "serious_issues_unactioned": len(serious_open) - serious_covered,
            "total": iss_crit_open + iss_breached + inc_crit_open + act_overdue,
        },
        "performance": {"score": perf, "grade": grade,
                        "formula": ("weighted mean of section scores: "
                                    "issues 40% + incidents 35% + corrective actions 25%"),
                        "components": components},
    }


@router.get("/scorecard-config")
def get_issue_scorecard_config(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Current section weights + target (built-in defaults merged with tenant overrides)."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"module": "issue_incident", "sections": [], "target": 85, "default_target": 85, "customized": False}
    return sc_cfg.merged(db, tenants[0], "issue_incident")


@router.put("/scorecard-config")
def put_issue_scorecard_config(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Save section-weight, metric-weight and/or target overrides for this tenant."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"ok": False}
    cfg = sc_cfg.save_config(
        db, tenants[0], "issue_incident",
        section_weights=body.get("weights"),
        metric_weights=body.get("metric_weights"),
        target=body.get("target"),
        updated_by=getattr(current_user, "id", None),
    )
    return {"ok": True, "config": cfg}


@router.delete("/scorecard-config")
def reset_issue_scorecard_config(
    section: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Reset scorecard tuning to defaults — whole module, or one section (?section=)."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if tenants:
        sc_cfg.reset_config(db, tenants[0], "issue_incident", section=section)
    return {"ok": True}
