"""The monthly roll-forward, computed from the register and reconciled.

Their SUMMARY sheet counts findings per source: open at the start of the month,
opened, closed, and left at the end. Computing it from the register instead of
storing it means the numbers follow what actually happened — closing a finding
in the platform moves them — and the workbook's own figures are kept beside
ours, so a difference shows up instead of passing unnoticed.

A finding counts as opened on the date the report or event carries, falling back
to when it first reached us; it counts as closed on the date Audit Services
validated it. That is the client's own definition, and it lets the history that
arrives in the first import spread across the months it actually happened in.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import AuditIssueProfile, AuditRegisterImport, Issue
from .template import SOURCE_TITLES, SOURCES, STATUS_LABELS, layout_for

MEASURES = ("beginning", "opened", "closed", "ending")
STATUS_ORDER = ("NS", "IP", "DE", "PD", "EXT", "unstated")
AGING_BUCKETS = (("0-30", 30), ("30-60", 60), ("60-90", 90), ("90-180", 180), ("180+", None))

_CODE_ALIASES = {"EX": "EXT", "CL": "CD", "CLOSED": "CD", "COMPLETE": "CD"}
# The archive and pen-test sheets say it in words rather than codes.
_STATUS_WORDS = (("not started", "NS"), ("past due", "PD"), ("delayed", "DE"),
                 ("extension", "EXT"), ("extended", "EXT"), ("pending validation", "IP"),
                 ("in progress", "IP"), ("completed", "IP"))


def month_bounds(month: str) -> Tuple[date, date]:
    """"2026-04" → the first of April and the first of May."""
    year, _, number = month.partition("-")
    start = date(int(year), int(number), 1)
    return start, date(start.year + (start.month == 12), (start.month % 12) + 1, 1)


def _as_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def _register(db: Session, tenant_id: int) -> List[Tuple[AuditIssueProfile, Issue]]:
    return (db.query(AuditIssueProfile, Issue)
            .join(Issue, Issue.id == AuditIssueProfile.issue_id)
            .filter(AuditIssueProfile.tenant_id == tenant_id,
                    AuditIssueProfile.deleted_at.is_(None))
            .all())


def timeline(profile: AuditIssueProfile, issue: Issue, fallback: date) -> Tuple[date, Optional[date]]:
    """When the finding opened, and when it closed (None while open)."""
    opened_on = (_as_date(issue.detected_at) or _as_date(profile.report_date)
                 or _as_date(profile.event_date) or _as_date(profile.created_at) or fallback)
    closed_on = _as_date(issue.closed_at) if issue.workflow_state == "closed" else None
    # The archive sheets can date a finding by the pack it arrived in, later
    # than the validation that closed it; it was open by then at the latest.
    if closed_on and opened_on > closed_on:
        opened_on = closed_on
    return opened_on, closed_on


def due_date_of(profile: AuditIssueProfile, issue: Issue) -> Optional[date]:
    """The agreed date: the revised target once there is one."""
    return profile.revised_target_date or profile.target_date or _as_date(issue.due_date)


def days_past_due(profile: AuditIssueProfile, issue: Issue, as_of: date) -> int:
    due = due_date_of(profile, issue)
    return max((as_of - due).days, 0) if due else 0


def aging_bucket(days: int) -> Optional[str]:
    if days <= 0:
        return None
    return next(name for name, limit in AGING_BUCKETS if limit is None or days <= limit)


def recorded_status(profile: AuditIssueProfile) -> Optional[str]:
    """The status the register records, as one of NS/IP/DE/PD/EXT/CD."""
    code = (profile.ia_status or "").strip().upper()
    code = _CODE_ALIASES.get(code, code)
    if code in STATUS_LABELS or code == "CD":
        return code
    for text in (profile.recommendation_state, profile.remediation_status,
                 profile.current_internal_status):
        lowered = (text or "").lower()
        for words, found in _STATUS_WORDS:
            if words in lowered:
                return found
    return None


def effective_status(profile: AuditIssueProfile, issue: Issue, as_of: date) -> str:
    """The client's status, with Past Due applied the way they define it:
    "Action Plan has not been implemented by the agreed upon target date".

    Delayed and Past Due stand as recorded. On the regulatory and IA sheets a
    plan management reports done, or one that passed validation, is "In
    Progress: … or the validation is in progress", whatever the date. Anything
    else open past its target (or revised target) date is Past Due — the pen
    test sheet included, which ages pending validations the same way. RM, N/A
    and blanks are "unstated".
    """
    if issue.workflow_state == "closed":
        return "CD"
    code = recorded_status(profile)
    if code in ("DE", "PD"):
        return code
    implemented = (issue.workflow_state == "closure_review"
                   or (profile.validation_pass_fail or "").strip().lower() == "pass")
    if implemented and layout_for(profile.source, profile.source_sheet) != "archive":
        return "IP"
    if days_past_due(profile, issue, as_of) > 0:
        return "PD"
    return code if code in STATUS_LABELS else "unstated"


def roll_forward(db: Session, tenant_id: int, month: str) -> Dict[str, Any]:
    """Beginning / opened / closed / ending per source for one month.

    Issues only: the pack counts recommendations apart, as "not tracked".
    """
    start, end = month_bounds(month)

    counts: Dict[str, Dict[str, int]] = {}
    for profile, issue in _register(db, tenant_id):
        if profile.record_type == "recommendation":
            continue
        source = profile.source or "unassigned"
        bucket = counts.setdefault(source, {m: 0 for m in MEASURES})
        opened_on, closed_on = timeline(profile, issue, start)

        if opened_on < start and (closed_on is None or closed_on >= start):
            bucket["beginning"] += 1
        if start <= opened_on < end:
            bucket["opened"] += 1
        if closed_on and start <= closed_on < end:
            bucket["closed"] += 1
    for bucket in counts.values():
        bucket["ending"] = bucket["beginning"] + bucket["opened"] - bucket["closed"]

    # Their own figures for the same month, from the workbook we imported.
    reported = _reported_for(db, tenant_id, month)
    sources = [s for s in SOURCES if s in counts or s in reported] + \
              [s for s in counts if s not in SOURCES]
    out_rows: List[Dict[str, Any]] = []
    for source in sources:
        ours = counts.get(source, {m: 0 for m in MEASURES})
        theirs = reported.get(source)
        out_rows.append({
            "source": source,
            **ours,
            "reported": theirs,
            "matches": theirs is None or all(theirs.get(m) == ours[m] for m in MEASURES),
        })
    totals = {m: sum(r[m] for r in out_rows) for m in MEASURES}
    return {
        "month": month,
        "rows": out_rows,
        "totals": totals,
        "reported_total": ({m: sum((r["reported"] or {}).get(m, 0) for r in out_rows) for m in MEASURES}
                           if reported else None),
        "has_reported": bool(reported),
    }


def _reported_for(db: Session, tenant_id: int, month: str) -> Dict[str, Dict[str, int]]:
    """The SUMMARY the client's own workbook carried for that month: the one
    titled for it ("April 2026 Issue Summary"), else one dated in it."""
    start, end = month_bounds(month)
    record = (db.query(AuditRegisterImport)
              .filter(AuditRegisterImport.tenant_id == tenant_id,
                      or_(AuditRegisterImport.summary_month == month,
                          AuditRegisterImport.summary_month.is_(None)
                          & (AuditRegisterImport.as_of_date >= start)
                          & (AuditRegisterImport.as_of_date < end)))
              .order_by(AuditRegisterImport.id.desc())
              .first())
    return (record.client_summary or {}) if record else {}


def months_available(db: Session, tenant_id: int, limit: int = 18) -> List[str]:
    """Months worth showing: every month an import covered, newest first."""
    found = set()
    for as_of, titled in (db.query(AuditRegisterImport.as_of_date, AuditRegisterImport.summary_month)
                          .filter(AuditRegisterImport.tenant_id == tenant_id).all()):
        if titled:
            found.add(titled)
        elif as_of:
            found.add(f"{as_of.year:04d}-{as_of.month:02d}")
    months = sorted(found, reverse=True)
    today = date.today()
    current = f"{today.year:04d}-{today.month:02d}"
    if current not in months:
        months.insert(0, current)
    return months[:limit]


def _cell(by_source: Dict[str, int], sources: List[str]) -> Dict[str, Any]:
    return {"by_source": {s: by_source.get(s, 0) for s in sources},
            "total": sum(by_source.get(s, 0) for s in sources)}


def _theirs(reported: Dict[str, Dict[str, int]], sources: List[str], measure: str):
    return {s: reported[s].get(measure) for s in sources if s in reported} if reported else None


def pack(db: Session, tenant_id: int, month: str) -> Dict[str, Any]:
    """The SUMMARY sheet, every section of it, computed from the register.

    Status is as the register has it now, set against the month's last day, so
    an earlier month shows today's codes with that month's aging.
    ponytail: no per-month status snapshots; store one per import if a past
    month's status table must be reproduced exactly.
    """
    start, end = month_bounds(month)
    as_of = min(end - timedelta(days=1), date.today())
    rolled = roll_forward(db, tenant_id, month)
    reported = _reported_for(db, tenant_id, month)

    matrix: Dict[str, Dict[str, int]] = {code: {} for code in STATUS_ORDER}
    aging: Dict[str, Dict[str, int]] = {name: {} for name, _ in AGING_BUCKETS}
    recommendations: Dict[str, int] = {}
    closed: List[Dict[str, Any]] = []
    for profile, issue in _register(db, tenant_id):
        source = profile.source or "unassigned"
        opened_on, closed_on = timeline(profile, issue, start)
        open_at_end = opened_on < end and not (closed_on and closed_on < end)
        if profile.record_type == "recommendation":
            if open_at_end:
                recommendations[source] = recommendations.get(source, 0) + 1
            continue
        if closed_on and start <= closed_on < end:
            closed.append({"issue_id": issue.id, "source": source, "reference": profile.issue_ref,
                           "title": issue.title, "closed_on": closed_on.isoformat()})
        if not open_at_end:
            continue
        overdue = days_past_due(profile, issue, as_of)
        # Closed since the month ended: it was still being worked on then.
        code = effective_status(profile, issue, as_of) if not closed_on else ("PD" if overdue else "IP")
        matrix[code][source] = matrix[code].get(source, 0) + 1
        if bucket := aging_bucket(overdue):
            aging[bucket][source] = aging[bucket].get(source, 0) + 1

    sources = [r["source"] for r in rolled["rows"]]
    sources += [s for s in recommendations if s not in sources]
    status_rows = [{"status": code, "label": STATUS_LABELS[code], **_cell(matrix[code], sources),
                    "reported": _theirs(reported, sources, code) if code != "unstated" else None}
                   for code in STATUS_ORDER if code != "unstated" or matrix[code]]
    open_total = _cell({s: sum(matrix[c].get(s, 0) for c in STATUS_ORDER) for s in sources}, sources)
    by_status = {row["status"]: row["total"] for row in status_rows}
    return {
        "month": month,
        "title": f"{start:%B %Y} Issue Summary",
        "as_of": as_of.isoformat(),
        "columns": [{"source": s, "title": SOURCE_TITLES.get(s, s)} for s in sources],
        "roll_forward": rolled,
        # STATUS OF ISSUE RESOLUTION PROGRESS: their four rows, plus what closed
        # this month, so that "LESS: closed" lands on the month's ending count.
        "resolution": {
            "not_started": by_status.get("NS", 0),
            "in_progress": by_status.get("IP", 0),
            "delayed_past_due": by_status.get("DE", 0) + by_status.get("PD", 0),
            "extended": by_status.get("EXT", 0),
            "unstated": by_status.get("unstated", 0),
            "closed_this_month": len(closed),
            "subtotal": open_total["total"] + len(closed),
            "less_closed": len(closed),
            "total": open_total["total"],
        },
        "aging": [{"bucket": name, **_cell(aging[name], sources)} for name, _ in AGING_BUCKETS],
        "status_rows": status_rows,
        "total_open": {**open_total, "reported": _theirs(reported, sources, "open"),
                       "check": rolled["totals"]["ending"] - open_total["total"]},
        "closed": sorted(closed, key=lambda c: (c["source"], c["reference"] or "")),
        "recommendations": {**_cell(recommendations, sources),
                            "reported": _theirs(reported, sources, "recommendations")},
        "has_reported": bool(reported),
    }


_REPORT_FIELDS = ("regulator", "source_label", "report_number", "report_name", "report_date",
                  "project_name", "engagement_year", "type_of_audit")


def report_prefill(profile: AuditIssueProfile) -> Dict[str, Any]:
    """What another finding on the same report starts from, in the sheet's columns."""
    return {f: (v.isoformat() if isinstance(v, date) else v) for f in _REPORT_FIELDS
            if (v := getattr(profile, f)) not in (None, "")}


def reports(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """The register by audit report or exam, one line per report with how its
    findings stand: the view Audit Services follow a report up from."""
    today = date.today()
    grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for profile, issue in _register(db, tenant_id):
        name = (profile.report_name or profile.project_name or profile.report_number
                or profile.report_key or "No report named")
        key = (profile.source or "unassigned", profile.report_key or name)
        line = grouped.setdefault(key, {
            "source": key[0], "source_title": SOURCE_TITLES.get(key[0], key[0]),
            "key": profile.report_key, "report": name, "report_number": profile.report_number,
            "report_date": profile.report_date.isoformat() if profile.report_date else None,
            "regulator": profile.regulator, "findings": 0, "issues": 0, "recommendations": 0,
            "open": 0, "closed": 0, "past_due": 0, "statuses": {}, "next_due": None,
            "owners": set(),
            "prefill": report_prefill(profile),
        })
        line["findings"] += 1
        line["recommendations" if profile.record_type == "recommendation" else "issues"] += 1
        status = effective_status(profile, issue, today)
        line["statuses"][status] = line["statuses"].get(status, 0) + 1
        if status == "CD":
            line["closed"] += 1
            continue
        line["open"] += 1
        line["past_due"] += status == "PD"
        due = due_date_of(profile, issue)
        if due and (line["next_due"] is None or due.isoformat() < line["next_due"]):
            line["next_due"] = due.isoformat()
        owner = getattr(issue, "owner", None)
        if who := (getattr(owner, "display_name", None) or profile.owner_name_raw):
            line["owners"].add(who)
    for line in grouped.values():
        line["owners"] = sorted(line["owners"])
    return sorted(grouped.values(),
                  key=lambda r: (SOURCES.index(r["source"]) if r["source"] in SOURCES else 99,
                                 r["report_date"] or "", r["report"]))
