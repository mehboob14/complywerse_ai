"""Edit a register finding in the platform, field by field.

Every column of the client's template is editable, but only the columns the
finding's own sheet has — a regulatory MRA has no affected hosts to edit. An
edit keeps the issue in step (a new owner becomes the assignee, a revised target
date becomes the due date, a status code moves the workflow), is written to the
issue's activity log, and is marked so next month's workbook import leaves it
alone instead of quietly putting the file's old value back.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import AuditIssueProfile, GRCUser, Issue, IssueAction, IssueActivity
from . import template as T
from .crosslinks import sync_crosslinks
from .parser import RegisterRow, _coerce

# Which issue fields an edited register field feeds.
_ISSUE_FIELDS_FED_BY = {
    "title": ("title",),
    "issue_text": ("description",),
    "condition": ("description",),
    "risk_rating": ("severity",),
    "target_date": ("due_date", "target_closure_date"),
    "revised_target_date": ("due_date", "target_closure_date"),
    "report_date": ("detected_at",),
    "event_date": ("detected_at",),
    "self_id_category": ("category",),
    "ia_status": ("workflow_state", "status", "closed_at"),
    "remediation_status": ("workflow_state", "status", "closed_at"),
    "validation_status": ("workflow_state", "status", "closed_at"),
    "recommendation_state": ("workflow_state", "status", "closed_at"),
    "resolution_status": ("workflow_state", "status", "closed_at"),
    "management_reported_status": ("workflow_state", "status", "closed_at"),
    "validated_on": ("closed_at",),
    "validation_completed_on": ("closed_at",),
}


def layout_of(profile: AuditIssueProfile) -> str:
    return T.layout_for(profile.source, profile.source_sheet)


def register_values(issue: Issue, profile: AuditIssueProfile) -> Dict[str, Any]:
    """The finding as the register holds it now, title included."""
    values = {c.name: getattr(profile, c.name) for c in AuditIssueProfile.__table__.columns}
    values["title"] = issue.title
    return values


def _jsonable(value: Any) -> Any:
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _sync_issue(db: Session, issue: Issue, profile: AuditIssueProfile, fields: List[str]) -> None:
    """Recompute only the issue fields the edited register fields feed."""
    from .service import _issue_fields     # one definition of how the two map

    feeds = {f for field in fields for f in _ISSUE_FIELDS_FED_BY.get(field, ())}
    if not feeds:
        return
    row = RegisterRow(profile.source_sheet or "", profile.source_row or 0,
                      profile.record_type or "issue", profile.source,
                      register_values(issue, profile))
    derived = _issue_fields(row, issue.owner_id, profile.as_of_date)
    if ("closed_at" in feeds and derived.get("workflow_state") == "closed" and issue.closed_at
            and not {"validated_on", "validation_completed_on"} & set(fields)):
        derived["closed_at"] = issue.closed_at          # keep the date it actually closed
    for key in feeds:
        if key in derived:
            setattr(issue, key, derived[key])
    if feeds & {"due_date", "workflow_state"}:
        action = (db.query(IssueAction)
                  .filter(IssueAction.issue_id == issue.id, IssueAction.action_type == "corrective")
                  .first())
        if action:
            action.due_date = issue.due_date
            action.status = "completed" if issue.workflow_state == "closed" else "open"


def apply_edit(db: Session, issue: Issue, profile: AuditIssueProfile,
               changes: Dict[str, Any], actor: Optional[GRCUser] = None) -> Dict[str, Any]:
    """Apply field edits; returns {field: [before, after]} for what actually changed."""
    allowed = set(T.LAYOUT_FIELDS[layout_of(profile)])
    unknown = sorted(set(changes) - allowed)
    if unknown:
        raise ValueError(f"not a column of this finding's sheet: {', '.join(unknown)}")

    changed: Dict[str, List[Any]] = {}
    for field, raw in changes.items():
        if field == "owner":
            user_id = int(raw) if raw not in (None, "") else None
            if user_id is not None and not db.get(GRCUser, user_id):
                raise ValueError("owner must be a platform user")
            if user_id != issue.owner_id:
                changed["owner"] = [issue.owner_id, user_id]
                issue.owner_id = user_id
                action = (db.query(IssueAction)
                          .filter(IssueAction.issue_id == issue.id,
                                  IssueAction.action_type == "corrective").first())
                if action:
                    action.assignee_id = user_id
            continue
        if field == "title":
            value = (str(raw).strip() or issue.title)[:255] if raw is not None else issue.title
            if value != issue.title:
                changed["title"] = [issue.title, value]
                issue.title = value
            continue
        value = _coerce(field, raw) if raw not in (None, "") else None
        if field in T.CHOICES and value is not None and value not in T.CHOICES[field]:
            raise ValueError(f"{field} must be one of {', '.join(T.CHOICES[field])}")
        before = getattr(profile, field)
        if before != value:
            changed[field] = [_jsonable(before), _jsonable(value)]
            setattr(profile, field, value)
        if field == "record_type" and value:
            profile.record_type = value

    if not changed:
        return {}
    profile.edited_fields = sorted(set(profile.edited_fields or []) | set(changed))
    _sync_issue(db, issue, profile, list(changed))
    db.add(IssueActivity(issue_id=issue.id, user_id=getattr(actor, "id", None),
                         type="register_edit", payload={"changes": changed}))
    # The MRA's observation, the loss event and the business unit follow.
    sync_crosslinks(db, issue, profile, actor_id=getattr(actor, "id", None))
    return changed


def _sheet_name(db: Session, tenant_id: int, name: str) -> str:
    """The sheet as the client's workbook spells it ("IA-EY Issue " has a
    trailing space), so a finding added here reads that sheet's definitions."""
    from ....models import AuditRegisterImport

    wanted = T.norm(name)
    for record in (db.query(AuditRegisterImport).filter(AuditRegisterImport.tenant_id == tenant_id)
                   .order_by(AuditRegisterImport.id.desc()).limit(3).all()):
        for sheet in (record.sheet_counts or {}):
            if T.norm(sheet) == wanted:
                return sheet
    return name


def entry_templates(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """The sheets a finding can be added on, each as a blank form in its own columns."""
    out = []
    for key, label, sheet, source, record_type in T.ENTRY_TEMPLATES:
        sheet = _sheet_name(db, tenant_id, sheet)
        layout = T.layout_for(source, sheet)
        names = [n for n in T.LAYOUT_FIELDS[layout] if n not in T.ENTRY_COMPUTED]
        defaults: Dict[str, Any] = {}
        if "ia_status" in names:
            defaults["ia_status"] = "NS"
        if "recommendation_state" in names:
            defaults["recommendation_state"] = "Open"
        if "record_type" in names:
            defaults["record_type"] = record_type
        defaults.update({k: v for k, v in T.ENTRY_DEFAULTS.get(key, {}).items() if k in names})
        title, hint = T.ENTRY_TITLES.get(key, (label, ""))
        out.append({
            "key": key, "label": label, "title": title, "hint": hint, "sheet": sheet, "source": source,
            "record_type": record_type, "layout": layout, "defaults": defaults,
            "fields": [{"name": n, "label": T.FIELD_SPEC[n][0], "group": T.FIELD_SPEC[n][1],
                        "kind": T.FIELD_SPEC[n][2]} for n in names],
        })
    return out


def create_finding(db: Session, tenant_id: int, template: str, raw: Dict[str, Any],
                   actor: Optional[GRCUser] = None, report_id: Optional[int] = None) -> AuditIssueProfile:
    """Add one finding by hand, on one of the client's sheets, in its columns.

    It becomes an issue exactly as an imported row does — status to workflow,
    the action plan as its corrective action, links to assets, vulnerabilities,
    vendors, Statutory Audit, Incidents — so the register cannot tell the two
    apart. If next month's workbook carries the same finding, the import finds
    it by its reference and title and updates it rather than adding it twice.

    ``report_id`` is a report from the Settings list: its details fill the
    finding's report columns and the finding joins that report exactly.
    """
    from ....models import AuditRegisterReport
    from ..services.code_generator import next_issue_code
    from .linkage import (build_asset_index, build_vendor_index, build_vulnerability_index,
                          link_issue)
    from .service import PROFILE_FIELDS, _issue_fields, _sync_action, register_key
    from .settings import REPORT_FIELDS

    spec = next((t for t in entry_templates(db, tenant_id) if t["key"] == template), None)
    if spec is None:
        raise ValueError(f"template must be one of {', '.join(t[0] for t in T.ENTRY_TEMPLATES)}")
    allowed = {f["name"] for f in spec["fields"]}
    unknown = sorted(set(raw) - allowed)
    if unknown:
        raise ValueError(f"not a column of the {spec['label']} sheet: {', '.join(unknown)}")
    report = None
    if report_id:
        report = (db.query(AuditRegisterReport)
                  .filter(AuditRegisterReport.id == report_id,
                          AuditRegisterReport.tenant_id == tenant_id).first())
        if report is None or report.source != spec["source"]:
            raise ValueError(f"That report is not one of the {spec['label']} reports")
        raw = dict(raw)
        for field in ("source_label", *REPORT_FIELDS):
            target = "regulator" if field == "source_label" and "regulator" in allowed else field
            if target in allowed:
                raw[target] = getattr(report, field)

    values: Dict[str, Any] = {}
    owner_id = None
    for field, value in raw.items():
        if value in (None, ""):
            continue
        if field == "owner":
            owner = db.get(GRCUser, int(value))
            if not owner:
                raise ValueError("owner must be a platform user")
            owner_id = owner.id
            values["owner_name_raw"] = getattr(owner, "display_name", None) or owner.username
            continue
        coerced = _coerce(field, value)
        if field in T.CHOICES and coerced not in T.CHOICES[field]:
            raise ValueError(f"{field} must be one of {', '.join(T.CHOICES[field])}")
        if coerced not in (None, ""):
            values[field] = coerced
    if not values.get("title"):
        raise ValueError("Give the finding its name")

    record_type = values.pop("record_type", None) or spec["record_type"]
    row = RegisterRow(spec["sheet"], 0, record_type, spec["source"], values)
    report_key, reference, title_key = register_key(row)
    if report is not None:
        report_key = report.report_key            # stays put even after the report is renamed
    existing = (db.query(AuditIssueProfile)
                .filter(AuditIssueProfile.tenant_id == tenant_id,
                        AuditIssueProfile.source == spec["source"],
                        AuditIssueProfile.record_type == record_type,
                        AuditIssueProfile.report_key == report_key,
                        AuditIssueProfile.issue_ref == reference,
                        AuditIssueProfile.title_key == title_key).first())
    if existing:
        raise ValueError(f"This finding is already in the register ({existing.issue.code})")

    today = date.today()
    issue = Issue(tenant_id=tenant_id, code=next_issue_code(tenant_id, db),
                  reporter_id=getattr(actor, "id", None), **_issue_fields(row, owner_id, today))
    db.add(issue)
    db.flush()
    profile = AuditIssueProfile(tenant_id=tenant_id, issue_id=issue.id, source=spec["source"],
                                record_type=record_type, report_key=report_key,
                                issue_ref=reference, title_key=title_key,
                                source_sheet=spec["sheet"], as_of_date=today)
    for key, value in values.items():
        if key in PROFILE_FIELDS and key != "issue_ref":
            setattr(profile, key, value)
    db.add(profile)
    db.flush()
    _sync_action(db, issue, row, owner_id)
    link_issue(db, issue, profile, assets=build_asset_index(db), vendors=build_vendor_index(db),
               vulnerabilities=build_vulnerability_index(db), actor_id=getattr(actor, "id", None))
    sync_crosslinks(db, issue, profile, actor_id=getattr(actor, "id", None), as_of=today,
                    create=True)
    db.add(IssueActivity(issue_id=issue.id, user_id=getattr(actor, "id", None),
                         type="register_created",
                         payload={"template": template, "fields": sorted(values)}))
    return profile


def delete_finding(db: Session, issue: Issue, profile: AuditIssueProfile,
                   actor: Optional[GRCUser] = None, reason: str = "") -> None:
    """Take a finding out of the register.

    The platform never hard-deletes an issue (its own delete cancels it), and
    a bank's audit trail should not lose a finding either: it is marked
    deleted and its issue cancelled, with the history kept. It leaves the
    register, the pack, reports and reminders; an upload that still carries it
    leaves it out; and it can be restored. Its Statutory Audit observation is
    cancelled and its incident closed the same way.
    """
    from ....models import RiskIncident
    from .crosslinks import observation_for

    if profile.deleted_at is not None:
        raise ValueError("This finding is already deleted")
    before = issue.workflow_state
    profile.deleted_at = datetime.utcnow()
    profile.deleted_by = getattr(actor, "id", None)
    issue.workflow_state, issue.status = "cancelled", "closed"
    observation = observation_for(db, issue.id)
    if observation:
        observation.status = "cancelled"
        observation.updated_at = datetime.utcnow()
    incident = db.get(RiskIncident, profile.incident_id) if profile.incident_id else None
    if incident:
        incident.status = "closed"
    db.add(IssueActivity(issue_id=issue.id, user_id=getattr(actor, "id", None),
                         type="register_deleted",
                         payload={"reason": (reason or "").strip() or None, "workflow_state": before}))


def restore_finding(db: Session, issue: Issue, profile: AuditIssueProfile,
                    actor: Optional[GRCUser] = None) -> None:
    """Undo a delete: back in the register, its status worked out from its columns."""
    if profile.deleted_at is None:
        raise ValueError("This finding is not deleted")
    profile.deleted_at = None
    profile.deleted_by = None
    _sync_issue(db, issue, profile, ["ia_status"])        # workflow from the register's own status
    sync_crosslinks(db, issue, profile, actor_id=getattr(actor, "id", None))
    db.add(IssueActivity(issue_id=issue.id, user_id=getattr(actor, "id", None),
                         type="register_restored", payload={}))


def form_for(issue: Issue, profile: AuditIssueProfile) -> Dict[str, Any]:
    """The finding's own sheet columns, grouped and typed, with current values."""
    values = register_values(issue, profile)
    fields = []
    for name in T.LAYOUT_FIELDS[layout_of(profile)]:
        label, group, kind = T.FIELD_SPEC[name]
        value = issue.owner_id if name == "owner" else values.get(name)
        fields.append({
            "name": name, "label": label, "group": group, "kind": kind,
            "value": _jsonable(value),
            "raw": profile.owner_name_raw if name == "owner" else None,
            "edited": name in (profile.edited_fields or []),
        })
    return {"layout": layout_of(profile), "fields": fields}


def options(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Everything the edit form's dropdowns offer: the template's codes, the
    Settings lists, the values the register already uses, business units for
    the LOB, and the tenant's users."""
    from ....models import BusinessUnit
    from .settings import get_settings, list_values

    picks: Dict[str, List[str]] = dict(list_values(db, tenant_id, get_settings(db, tenant_id)))
    units = [u.name for u in db.query(BusinessUnit).filter(BusinessUnit.tenant_id == tenant_id)]
    for field in ("report_name", "project_name", "lob", "business_unit"):
        column = getattr(AuditIssueProfile, field)
        rows = (db.query(column).filter(AuditIssueProfile.tenant_id == tenant_id,
                                        column.isnot(None)).distinct().all())
        values = {str(v).strip() for (v,) in rows if str(v or "").strip()}
        if field in ("lob", "business_unit"):
            values |= {u for u in units if u}
        picks[field] = sorted(values, key=str.lower)
    users = [{"id": u.id, "name": getattr(u, "display_name", None) or u.username, "email": u.email}
             for u in db.query(GRCUser).order_by(GRCUser.id).all()
             if getattr(u, "is_active", True) is not False]
    return {"choices": T.CHOICES, "picks": picks, "users": users}
