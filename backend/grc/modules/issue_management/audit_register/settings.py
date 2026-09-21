"""The register's settings: set once, used everywhere a finding is handled.

- SLAs per status: when an owner is reminded, when Audit Services hear of a
  finding long past due or a validation left waiting, and whether email goes
  too. The reminder sweep (workflow.send_reminders) reads these.
- Who Audit Services are (escalations, "ready for validation" notices).
- Dropdown lists for the columns people otherwise type: regulators,
  reviewers and audit firms, types of audit, owner titles and the rest.
- The audit reports and exams findings belong to, defined once and picked
  when a finding is added (AuditRegisterReport, kept in step with findings).
- How a new finding's Issue # is numbered (Self ID has no Issue # column).
"""
from __future__ import annotations

import copy
import re
from collections import Counter
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import false
from sqlalchemy.orm import Session

from ....models import AuditIssueProfile, AuditRegisterReport, AuditRegisterSettings, GRCUser
from . import template as T

SLA_STATUSES = ("NS", "IP", "DE", "PD", "EXT", "validation")
# The columns a dropdown list can be kept for (lob and business unit come from
# business units instead; owners are users).
LIST_FIELDS = ("regulator", "source_label", "type_of_audit", "owner_title", "remediation_type",
               "current_internal_status")
REPORT_FIELDS = ("report_number", "report_name", "report_date", "engagement_year", "project_name")

DEFAULTS: Dict[str, Any] = {
    "sla": {
        "NS": {"enabled": True, "remind_before_due": 14, "repeat_every": 7, "start_within": 30},
        "IP": {"enabled": True, "remind_before_due": 14, "repeat_every": 7},
        "DE": {"enabled": True, "repeat_every": 7},
        "PD": {"enabled": True, "repeat_every": 7, "escalate_after": 30},
        "EXT": {"enabled": True, "remind_before_due": 14, "repeat_every": 7},
        "validation": {"enabled": True, "validate_within": 10, "repeat_every": 7},
    },
    "email": False,
    "audit_services": [],                      # user ids; none set → whoever uploads the workbook
    "lists": {field: [] for field in LIST_FIELDS},
    "numbering": {
        "regulatory": "MRA-{n}", "ia_mercadien": "{n}", "ia_ey_issue": "{n}",
        "ia_ey_recommendation": "R{n}", "it_pen": "PT-{nn}", "credit_review": "CR-{n}",
    },
}
_SLA_NUMBERS = ("remind_before_due", "repeat_every", "start_within", "escalate_after", "validate_within")


def _merged(stored: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    out = copy.deepcopy(DEFAULTS)
    stored = stored or {}
    for status, rule in (stored.get("sla") or {}).items():
        if status in out["sla"] and isinstance(rule, dict):
            out["sla"][status].update(rule)
    for key in ("email", "audit_services"):
        if key in stored:
            out[key] = stored[key]
    for field, values in (stored.get("lists") or {}).items():
        if field in out["lists"]:
            out["lists"][field] = values
    out["numbering"].update(stored.get("numbering") or {})
    return out


def get_settings(db: Session, tenant_id: int) -> Dict[str, Any]:
    row = (db.query(AuditRegisterSettings)
           .filter(AuditRegisterSettings.tenant_id == tenant_id).first())
    return _merged(row.config if row else None)


def save_settings(db: Session, tenant_id: int, patch: Dict[str, Any],
                  actor: Optional[GRCUser] = None) -> Dict[str, Any]:
    """Validate and store the changed parts; returns the full settings."""
    current = get_settings(db, tenant_id)
    if "sla" in patch:
        for status, rule in (patch["sla"] or {}).items():
            if status not in current["sla"] or not isinstance(rule, dict):
                raise ValueError(f"unknown status in sla: {status}")
            for key, value in rule.items():
                if key == "enabled":
                    current["sla"][status][key] = bool(value)
                elif key in _SLA_NUMBERS:
                    if value in (None, ""):
                        current["sla"][status][key] = None
                        continue
                    number = int(value)
                    if not 0 <= number <= 3650:
                        raise ValueError(f"{key} must be between 0 and 3650 days")
                    current["sla"][status][key] = number
                else:
                    raise ValueError(f"unknown sla setting: {key}")
    if "email" in patch:
        current["email"] = bool(patch["email"])
    if "audit_services" in patch:
        ids = sorted({int(u) for u in patch["audit_services"] or []})
        found = {u.id for u in db.query(GRCUser).filter(GRCUser.id.in_(ids)).all()} if ids else set()
        if set(ids) - found:
            raise ValueError("Audit Services must be platform users")
        current["audit_services"] = ids
    if "lists" in patch:
        for field, values in (patch["lists"] or {}).items():
            if field not in LIST_FIELDS:
                raise ValueError(f"no dropdown list for {field}")
            current["lists"][field] = _unique(values or [])
    if "numbering" in patch:
        for key, pattern in (patch["numbering"] or {}).items():
            if key not in current["numbering"]:
                raise ValueError(f"unknown finding type: {key}")
            if not re.search(r"\{n+\}", str(pattern or "")):
                raise ValueError("A numbering pattern needs {n}, {nn} or {nnn} where the number goes")
            current["numbering"][key] = str(pattern).strip()
    row = (db.query(AuditRegisterSettings)
           .filter(AuditRegisterSettings.tenant_id == tenant_id).first())
    if row is None:
        row = AuditRegisterSettings(tenant_id=tenant_id)
        db.add(row)
    row.config = current
    row.updated_by = getattr(actor, "id", None)
    row.updated_at = datetime.utcnow()
    db.flush()
    return current


def _unique(values) -> List[str]:
    """Tidied, one per spelling regardless of case (the first one wins), sorted."""
    seen: Dict[str, str] = {}
    for value in values:
        text = " ".join(str(value or "").split())
        if text:
            seen.setdefault(text.lower(), text)
    return sorted(seen.values(), key=str.lower)


def list_values(db: Session, tenant_id: int, settings: Dict[str, Any]) -> Dict[str, List[str]]:
    """Each dropdown's values: the settings list plus what the register already uses."""
    out: Dict[str, List[str]] = {}
    for field in LIST_FIELDS:
        column = getattr(AuditIssueProfile, field)
        used = sorted(str(v) for (v,) in db.query(column)
                      .filter(AuditIssueProfile.tenant_id == tenant_id, column.isnot(None)).distinct())
        out[field] = _unique([*(settings["lists"].get(field) or []), *used])
    return out


# ── audit reports and exams ──────────────────────────────────────────────────

def _report_values(profile: AuditIssueProfile) -> Dict[str, Any]:
    return {"source_label": profile.regulator or profile.source_label,
            **{f: getattr(profile, f) for f in REPORT_FIELDS}}


def sync_reports(db: Session, tenant_id: int) -> None:
    """Every report the register's findings name is in the catalog."""
    known = {(r.source, r.report_key) for r in db.query(AuditRegisterReport)
             .filter(AuditRegisterReport.tenant_id == tenant_id)}
    for profile in (db.query(AuditIssueProfile)
                    .filter(AuditIssueProfile.tenant_id == tenant_id,
                            AuditIssueProfile.deleted_at.is_(None)).all()):
        key = (profile.source, profile.report_key or "")
        if not profile.report_key or key in known:
            continue
        known.add(key)
        db.add(AuditRegisterReport(tenant_id=tenant_id, source=profile.source,
                                   report_key=profile.report_key, **_report_values(profile)))
    db.flush()


def report_payload(report: AuditRegisterReport, findings: int = 0) -> Dict[str, Any]:
    return {"id": report.id, "source": report.source,
            "source_title": T.SOURCE_TITLES.get(report.source, report.source),
            "report_key": report.report_key, "source_label": report.source_label,
            "report_number": report.report_number, "report_name": report.report_name,
            "report_date": report.report_date.isoformat() if report.report_date else None,
            "engagement_year": report.engagement_year, "project_name": report.project_name,
            "notes": report.notes, "findings": findings}


def report_catalog(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    sync_reports(db, tenant_id)
    counts = Counter((p.source, p.report_key) for p in db.query(AuditIssueProfile)
                     .filter(AuditIssueProfile.tenant_id == tenant_id,
                             AuditIssueProfile.deleted_at.is_(None)).all())
    rows = (db.query(AuditRegisterReport)
            .filter(AuditRegisterReport.tenant_id == tenant_id).all())
    return sorted((report_payload(r, counts[(r.source, r.report_key)]) for r in rows),
                  key=lambda r: (r["source"], r["report_date"] or "", r["report_name"] or ""))


def _report_fields(values: Dict[str, Any]) -> Dict[str, Any]:
    from .parser import _coerce

    out: Dict[str, Any] = {}
    for field in ("source_label", *REPORT_FIELDS, "notes"):
        if field in values:
            raw = values[field]
            out[field] = None if raw in (None, "") else (
                _coerce(field, raw) if field != "notes" else str(raw).strip())
    return out


def create_report(db: Session, tenant_id: int, source: str, values: Dict[str, Any],
                  actor: Optional[GRCUser] = None) -> AuditRegisterReport:
    if source not in T.SOURCES:
        raise ValueError(f"source must be one of {', '.join(T.SOURCES)}")
    fields = _report_fields(values)
    key = str(fields.get("report_number") or fields.get("report_name")
              or fields.get("project_name") or "").strip()[:255]
    if not key:
        raise ValueError("Give the report a name or number")
    exists = (db.query(AuditRegisterReport)
              .filter(AuditRegisterReport.tenant_id == tenant_id, AuditRegisterReport.source == source,
                      AuditRegisterReport.report_key == key).first())
    if exists:
        raise ValueError("That report is already in the list")
    report = AuditRegisterReport(tenant_id=tenant_id, source=source, report_key=key,
                                 created_by=getattr(actor, "id", None), **fields)
    db.add(report)
    db.flush()
    return report


def update_report(db: Session, report: AuditRegisterReport, values: Dict[str, Any]) -> int:
    """Change a report once; its findings follow. The key findings are matched
    on across uploads stays as it was. Returns how many findings changed."""
    fields = _report_fields(values)
    for field, value in fields.items():
        setattr(report, field, value)
    report.updated_at = datetime.utcnow()
    moved = 0
    for profile in (db.query(AuditIssueProfile)
                    .filter(AuditIssueProfile.tenant_id == report.tenant_id,
                            AuditIssueProfile.source == report.source,
                            AuditIssueProfile.report_key == report.report_key).all()):
        layout = set(T.LAYOUT_FIELDS[T.layout_for(profile.source, profile.source_sheet)])
        changed = []
        for field, value in fields.items():
            if field == "notes":                      # the report's own note, not the findings'
                continue
            target = "regulator" if field == "source_label" and "regulator" in layout else field
            if target in layout and getattr(profile, target) != value:
                setattr(profile, target, value)
                changed.append(target)
        if changed:
            # A correction made here is newer than the workbook it came from.
            profile.edited_fields = sorted(set(profile.edited_fields or []) | set(changed))
            moved += 1
    db.flush()
    return moved


def delete_report(db: Session, report: AuditRegisterReport) -> None:
    used = (db.query(AuditIssueProfile)
            .filter(AuditIssueProfile.tenant_id == report.tenant_id,
                    AuditIssueProfile.source == report.source,
                    AuditIssueProfile.report_key == report.report_key,
                    AuditIssueProfile.deleted_at.is_(None)).count())
    if used:
        raise ValueError(f"{used} finding(s) belong to this report; move or delete them first")
    db.delete(report)
    db.flush()


# ── numbering ────────────────────────────────────────────────────────────────

_NUMBERED = re.compile(r"^(.*?)(\d+)$")


def next_reference(db: Session, tenant_id: int, template_key: str,
                   report_key: Optional[str] = None) -> str:
    """The next Issue #: the report's own sequence carried on ("MRA-3" → "MRA-4",
    "5.2" → "5.3", "CLDCA.07" → "CLDCA.08"), else the finding type's pattern."""
    spec = next((t for t in T.ENTRY_TEMPLATES if t[0] == template_key), None)
    if spec is None:
        raise ValueError("unknown finding type")
    query = (db.query(AuditIssueProfile.issue_ref)
             .filter(AuditIssueProfile.tenant_id == tenant_id, AuditIssueProfile.source == spec[3]))
    refs = [r for (r,) in (query.filter(AuditIssueProfile.report_key == report_key) if report_key
                           else query.filter(false())).all() if r]
    numbered = [(m.group(1), m.group(2)) for r in refs if (m := _NUMBERED.match(r.strip()))]
    if numbered:
        prefix = Counter(p for p, _ in numbered).most_common(1)[0][0]
        digits = [n for p, n in numbered if p == prefix]
        width = max(len(n) for n in digits)
        return f"{prefix}{max(int(n) for n in digits) + 1:0{width}d}"
    pattern = get_settings(db, tenant_id)["numbering"].get(template_key) or "{n}"
    number = len(refs) + 1
    return (pattern.replace("{nnn}", f"{number:03d}").replace("{nn}", f"{number:02d}")
            .replace("{n}", str(number)))
