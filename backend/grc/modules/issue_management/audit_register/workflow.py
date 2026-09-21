"""A finding's life after import: validation, extensions and reminders.

Validation: the owner submits the materials; Audit Services pass the finding
(closed), ask for more (Delayed: "more materials are needed to complete
validation") or fail it (Past Due: "materials provided for validation are not
sufficient"). Each step writes the finding's own sheet columns, through the
same edit path as the form, so it is logged and survives the next import.

Extensions: a new target date is the Audit Committee's to approve. A request
becomes an agenda item on the committee's next meeting; the decision recorded
here sets the revised target date, counts the extension and marks it EXT, and
for an MRA keeps the date the regulator was told.

Reminders: owners hear about findings coming due or past due in the platform's
notifications, one message per owner; long-overdue ones escalate to Audit
Services. The daily Celery sweep runs this, and so does the register's button.
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from ....models import (AuditExtensionRequest, AuditIssueProfile, AuditRegisterImport,
                        CommitteeMeeting, Evidence, GovernanceCommittee, GRCUser, Issue,
                        IssueActivity, IssueEvidenceLink, MeetingAgendaItem)
from . import template as T
from .editing import apply_edit, layout_of
from .summary import days_past_due, due_date_of, effective_status

VALIDATED_LAYOUTS = ("regulatory", "internal_audit", "archive")
DECISIONS = ("pass", "more_info", "fail")
MAX_FILE_BYTES = 25 * 1024 * 1024


def _name(user: Optional[GRCUser]) -> Optional[str]:
    return (getattr(user, "display_name", None) or getattr(user, "username", None)) if user else None


def _notify(db: Session, tenant_id: int, user_ids: Iterable[Optional[int]], subject: str,
            message: str, *, email: bool = False, kind: str = "info") -> int:
    from ...workflow_engine.services.notification_service import send_workflow_notification

    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return 0
    sent = send_workflow_notification(db, tenant_id=tenant_id, subject=subject[:500],
                                      message=message, workflow_instance_id=None, user_ids=ids,
                                      channels=["in_app", "email"] if email else ["in_app"],
                                      notification_type=kind)
    return sent.get("notified_users", 0)


def audit_services(db: Session, tenant_id: int) -> List[int]:
    """Who Audit Services are: the team named in Settings, else whoever
    uploaded the latest workbooks."""
    from .settings import get_settings

    named = get_settings(db, tenant_id).get("audit_services") or []
    if named:
        return sorted(named)
    rows = (db.query(AuditRegisterImport.created_by)
            .filter(AuditRegisterImport.tenant_id == tenant_id,
                    AuditRegisterImport.created_by.isnot(None))
            .order_by(AuditRegisterImport.id.desc()).limit(5).all())
    return sorted({r for (r,) in rows})


def _label(issue: Issue, profile: AuditIssueProfile) -> str:
    return " · ".join(x for x in (profile.issue_ref, issue.title) if x)


# ── validation ───────────────────────────────────────────────────────────────

def _upload_dir() -> str:
    from ...evidence.routers.evidence import EVIDENCE_UPLOAD_DIR
    return EVIDENCE_UPLOAD_DIR


def _store_evidence(db: Session, issue: Issue, actor: GRCUser, file_name: str,
                    content_type: Optional[str], data: bytes) -> int:
    """The file goes into the evidence library, linked to the issue."""
    folder = os.path.join(_upload_dir(), str(issue.tenant_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4()}{os.path.splitext(file_name or '')[1].lower()}")
    with open(path, "wb") as handle:
        handle.write(data)
    evidence = Evidence(tenant_id=issue.tenant_id, name=(file_name or "Validation material")[:255],
                        description=f"Validation material for {issue.code or issue.id}",
                        file_path=path, file_name=file_name, file_type=content_type,
                        evidence_type="validation_material", uploaded_by=actor.id,
                        status="pending_review", source_system="audit_register")
    db.add(evidence)
    db.flush()
    db.add(IssueEvidenceLink(issue_id=issue.id, evidence_id=evidence.id,
                             relationship_type="validation", created_by=actor.id,
                             notes="Submitted for Audit Services validation"))
    return evidence.id


def _submit_changes(layout: str, profile: AuditIssueProfile, today: date) -> Dict[str, Any]:
    if layout in ("regulatory", "internal_audit"):
        changes: Dict[str, Any] = {"management_reported_status": "Completed"}
        if (profile.ia_status or "").strip().upper() in ("", "NS", "DE", "PD", "RM", "N/A"):
            changes["ia_status"] = "IP"          # "…or the validation is in progress"
        return changes
    changes = {"remediation_status": "COMPLETED",
               "recommendation_state": "Closed-Pending Validation",
               "validation_status": "IN PROGRESS"}
    if not profile.validation_started_on:
        changes["validation_started_on"] = today
    return changes


def _decision_changes(layout: str, result: str, today: date) -> Dict[str, Any]:
    sheet_codes = layout in ("regulatory", "internal_audit")
    if result == "pass":
        return ({"ia_status": "CD", "validation_pass_fail": "Pass", "validated_on": today}
                if sheet_codes else
                {"validation_status": "CLOSED", "recommendation_state": "Closed-Validated",
                 "validation_completed_on": today})
    if result == "more_info":
        return ({"ia_status": "DE"} if sheet_codes else
                {"recommendation_state": "Open", "remediation_status": "DELAYED"})
    return ({"ia_status": "PD", "validation_pass_fail": "Fail"} if sheet_codes else
            {"recommendation_state": "Open", "remediation_status": "IN PROGRESS",
             "validation_status": "NOT STARTED"})


def submit_for_validation(db: Session, issue: Issue, profile: AuditIssueProfile, actor: GRCUser,
                          note: str, files: List[Tuple[str, Optional[str], bytes]],
                          today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    layout = layout_of(profile)
    if layout not in VALIDATED_LAYOUTS:
        raise ValueError("Self-identified events have no validation step in the template")
    if issue.workflow_state == "closed":
        raise ValueError("This finding is already closed")
    if not (note or "").strip() and not files:
        raise ValueError("Attach the validation materials or say where they are")
    changed = apply_edit(db, issue, profile, _submit_changes(layout, profile, today), actor)
    evidence_ids = [_store_evidence(db, issue, actor, name, kind, data) for name, kind, data in files]
    if (note or "").strip() and not profile.validation_materials_source and layout != "archive":
        apply_edit(db, issue, profile, {"validation_materials_source": note.strip()}, actor)
    db.add(IssueActivity(issue_id=issue.id, user_id=actor.id, type="validation_submitted",
                         payload={"note": note, "evidence_ids": evidence_ids,
                                  "changes": changed}))
    _notify(db, issue.tenant_id, audit_services(db, issue.tenant_id),
            f"Ready for validation: {_label(issue, profile)}",
            f"{_name(actor) or 'The owner'} submitted {len(evidence_ids)} file(s) for validation."
            + (f"\n\n{note.strip()}" if (note or "").strip() else ""))
    return {"evidence_ids": evidence_ids, "changes": changed}


def decide_validation(db: Session, issue: Issue, profile: AuditIssueProfile, actor: GRCUser,
                      result: str, reason: str, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    layout = layout_of(profile)
    if layout not in VALIDATED_LAYOUTS:
        raise ValueError("Self-identified events have no validation step in the template")
    if result not in DECISIONS:
        raise ValueError("result must be pass, more_info or fail")
    if issue.workflow_state == "closed":
        raise ValueError("This finding is already closed")
    if result != "pass" and not (reason or "").strip():
        raise ValueError("Say what is missing, so the owner knows what to send")
    changed = apply_edit(db, issue, profile, _decision_changes(layout, result, today), actor)
    verdict = {"pass": "approved", "fail": "rejected"}.get(result)
    if verdict:
        for link in (db.query(IssueEvidenceLink)
                     .filter(IssueEvidenceLink.issue_id == issue.id,
                             IssueEvidenceLink.relationship_type == "validation").all()):
            evidence = db.get(Evidence, link.evidence_id)
            if evidence and evidence.status == "pending_review":
                evidence.status = verdict
    db.add(IssueActivity(issue_id=issue.id, user_id=actor.id, type="validation_decision",
                         payload={"result": result, "reason": reason, "changes": changed}))
    words = {"pass": "passed validation and is closed",
             "more_info": "needs more materials before validation can finish",
             "fail": "did not pass validation"}[result]
    _notify(db, issue.tenant_id, [issue.owner_id],
            f"{_label(issue, profile)}: {words}",
            f"Audit Services: {words}." + (f"\n\n{reason.strip()}" if (reason or "").strip() else ""),
            kind="info" if result == "pass" else "warning")
    return {"changes": changed}


def status_definitions(db: Session, tenant_id: int, profile: AuditIssueProfile) -> Dict[str, str]:
    """The client's own definitions for this finding's sheet, from the latest
    workbook that stated them."""
    for record in (db.query(AuditRegisterImport)
                   .filter(AuditRegisterImport.tenant_id == tenant_id)
                   .order_by(AuditRegisterImport.id.desc()).limit(12).all()):
        found = (record.status_definitions or {}).get(profile.source_sheet or "")
        if found:
            return found
    return {}


def validation_state(db: Session, issue: Issue, profile: AuditIssueProfile) -> Dict[str, Any]:
    today = date.today()
    evidence = []
    for link in (db.query(IssueEvidenceLink)
                 .filter(IssueEvidenceLink.issue_id == issue.id,
                         IssueEvidenceLink.relationship_type == "validation")
                 .order_by(IssueEvidenceLink.id).all()):
        item = db.get(Evidence, link.evidence_id)
        if item:
            evidence.append({"id": item.id, "name": item.name, "file_name": item.file_name,
                             "status": item.status,
                             "uploaded_at": item.uploaded_at.isoformat() if item.uploaded_at else None})
    history = []
    for activity in (db.query(IssueActivity)
                     .filter(IssueActivity.issue_id == issue.id,
                             IssueActivity.type.in_(("validation_submitted", "validation_decision")))
                     .order_by(IssueActivity.id.desc()).limit(30).all()):
        payload = activity.payload or {}
        history.append({"type": activity.type, "result": payload.get("result"),
                        "text": payload.get("reason") or payload.get("note"),
                        "files": len(payload.get("evidence_ids") or []),
                        "by": _name(db.get(GRCUser, activity.user_id)) if activity.user_id else None,
                        "at": activity.created_at.isoformat() if activity.created_at else None})
    stage = ("closed" if issue.workflow_state == "closed"
             else "awaiting_validation" if issue.workflow_state == "closure_review" else "open")
    due = due_date_of(profile, issue)
    validated = profile.validated_on or profile.validation_completed_on
    return {
        "layout": layout_of(profile),
        "has_validation": layout_of(profile) in VALIDATED_LAYOUTS,
        "stage": stage,
        "status": effective_status(profile, issue, today),
        "recorded_status": profile.ia_status or profile.recommendation_state or profile.remediation_status,
        "days_past_due": days_past_due(profile, issue, today),
        "due_date": due.isoformat() if due else None,
        "validated_on": validated.isoformat() if validated else None,
        "pass_fail": profile.validation_pass_fail,
        "definitions": status_definitions(db, profile.tenant_id, profile),
        "evidence": evidence,
        "history": history,
    }


# ── extensions ───────────────────────────────────────────────────────────────

def audit_committee_meetings(db: Session, tenant_id: int, today: Optional[date] = None) -> List[Dict[str, Any]]:
    """Upcoming meetings of the Audit Committee (any committee, if none is typed as one)."""
    today = today or date.today()
    committees = (db.query(GovernanceCommittee)
                  .filter(GovernanceCommittee.tenant_id == tenant_id,
                          GovernanceCommittee.is_active.isnot(False)).all())
    audit = [c for c in committees
             if c.committee_type == "audit_committee" or "audit" in (c.name or "").lower()]
    pool = {c.id: c for c in (audit or committees)}
    if not pool:
        return []
    meetings = (db.query(CommitteeMeeting)
                .filter(CommitteeMeeting.tenant_id == tenant_id,
                        CommitteeMeeting.committee_id.in_(list(pool)),
                        CommitteeMeeting.scheduled_date >= datetime.combine(today, datetime.min.time()))
                .order_by(CommitteeMeeting.scheduled_date).limit(12).all())
    return [{"id": m.id, "title": m.title, "committee": pool[m.committee_id].name,
             "scheduled_date": m.scheduled_date.isoformat() if m.scheduled_date else None,
             "status": m.status}
            for m in meetings if (m.status or "").lower() not in ("cancelled", "completed")]


def request_extension(db: Session, issue: Issue, profile: AuditIssueProfile, actor: GRCUser,
                      requested_date: date, reason: str, meeting_id: Optional[int] = None,
                      today: Optional[date] = None) -> AuditExtensionRequest:
    today = today or date.today()
    if issue.workflow_state == "closed":
        raise ValueError("This finding is already closed")
    if not (reason or "").strip():
        raise ValueError("Give the committee a reason for the extension")
    if (db.query(AuditExtensionRequest)
            .filter(AuditExtensionRequest.issue_id == issue.id,
                    AuditExtensionRequest.status == "requested").first()):
        raise ValueError("An extension for this finding is already waiting for the committee")
    current = due_date_of(profile, issue)
    if requested_date <= max(current or today, today):
        raise ValueError(f"The new date must be after {max(current or today, today).isoformat()}")

    meeting = None
    if meeting_id:
        meeting = (db.query(CommitteeMeeting)
                   .filter(CommitteeMeeting.id == meeting_id,
                           CommitteeMeeting.tenant_id == issue.tenant_id).first())
        if not meeting:
            raise ValueError("That meeting was not found")
    else:
        upcoming = audit_committee_meetings(db, issue.tenant_id, today)
        meeting = db.get(CommitteeMeeting, upcoming[0]["id"]) if upcoming else None

    request = AuditExtensionRequest(tenant_id=issue.tenant_id, issue_id=issue.id,
                                    previous_date=current, requested_date=requested_date,
                                    reason=reason.strip(), requested_by=actor.id,
                                    meeting_id=meeting.id if meeting else None)
    db.add(request)
    db.flush()
    if meeting:
        number = (db.query(func.max(MeetingAgendaItem.item_number))
                  .filter(MeetingAgendaItem.meeting_id == meeting.id).scalar() or 0) + 1
        item = MeetingAgendaItem(
            tenant_id=issue.tenant_id, meeting_id=meeting.id, item_number=number,
            title=f"Extension request — {_label(issue, profile)}"[:500],
            description=(f"{T.SOURCE_TITLES.get(profile.source, profile.source)} finding "
                         f"{issue.code or ''}: move the target date from "
                         f"{current.isoformat() if current else 'none set'} to "
                         f"{requested_date.isoformat()}.\n\nReason: {reason.strip()}\n\n"
                         "Record the decision in Auditor Portal → Issue Register."),
            item_type="decision", status="pending")
        db.add(item)
        db.flush()
        request.agenda_item_id = item.id
        committee = db.get(GovernanceCommittee, meeting.committee_id)
        _notify(db, issue.tenant_id, [committee.chair_id, committee.secretary_id] if committee else [],
                f"Extension request for the {meeting.title} agenda",
                f"{_label(issue, profile)}: new target date {requested_date.isoformat()} requested.")
    db.add(IssueActivity(issue_id=issue.id, user_id=actor.id, type="extension_requested",
                         payload={"request_id": request.id, "to": requested_date.isoformat(),
                                  "meeting_id": request.meeting_id}))
    return request


def decide_extension(db: Session, request: AuditExtensionRequest, actor: GRCUser, approve: bool,
                     notes: str = "", regulator_notified_on: Optional[date] = None,
                     today: Optional[date] = None) -> AuditExtensionRequest:
    today = today or date.today()
    if request.status != "requested":
        raise ValueError(f"This request was already {request.status}")
    issue = db.get(Issue, request.issue_id)
    profile = db.query(AuditIssueProfile).filter(AuditIssueProfile.issue_id == issue.id).one()
    request.status = "approved" if approve else "rejected"
    request.decided_on, request.decided_by = today, actor.id
    request.decision_notes = (notes or "").strip() or None
    request.regulator_notified_on = regulator_notified_on
    if request.agenda_item_id and (item := db.get(MeetingAgendaItem, request.agenda_item_id)):
        item.status = "discussed"
        item.outcome = "Approved" if approve else "Rejected"
        item.decision_made = request.decision_notes or item.outcome
    if approve:
        fields = set(T.LAYOUT_FIELDS[layout_of(profile)])
        changes: Dict[str, Any] = {"revised_target_date": request.requested_date}
        if "ia_status" in fields:
            changes["ia_status"] = "EXT"
        if "extensions_count" in fields:
            changes["extensions_count"] = (profile.extensions_count or 0) + 1
        apply_edit(db, issue, profile, {k: v for k, v in changes.items() if k in fields}, actor)
    db.add(IssueActivity(issue_id=issue.id, user_id=actor.id, type="extension_decided",
                         payload={"request_id": request.id, "approved": approve,
                                  "notes": request.decision_notes}))
    _notify(db, issue.tenant_id, [issue.owner_id, request.requested_by],
            f"Extension {'approved' if approve else 'not approved'}: {_label(issue, profile)}",
            (f"The Audit Committee approved the new target date {request.requested_date.isoformat()}."
             if approve else "The Audit Committee did not approve the extension.")
            + (f"\n\n{request.decision_notes}" if request.decision_notes else ""),
            kind="info" if approve else "warning")
    return request


def extension_payload(db: Session, request: AuditExtensionRequest) -> Dict[str, Any]:
    meeting = db.get(CommitteeMeeting, request.meeting_id) if request.meeting_id else None
    profile = db.query(AuditIssueProfile).filter(AuditIssueProfile.issue_id == request.issue_id).first()
    return {
        "id": request.id, "issue_id": request.issue_id, "status": request.status,
        "previous_date": request.previous_date.isoformat() if request.previous_date else None,
        "requested_date": request.requested_date.isoformat(),
        "reason": request.reason, "decision_notes": request.decision_notes,
        "decided_on": request.decided_on.isoformat() if request.decided_on else None,
        "regulator_notified_on": (request.regulator_notified_on.isoformat()
                                  if request.regulator_notified_on else None),
        "needs_regulator_notice": bool(profile and profile.source == "regulator"
                                       and request.status == "approved"
                                       and not request.regulator_notified_on),
        "meeting": ({"id": meeting.id, "title": meeting.title,
                     "scheduled_date": meeting.scheduled_date.isoformat() if meeting.scheduled_date else None}
                    if meeting else None),
        "requested_by": _name(db.get(GRCUser, request.requested_by)) if request.requested_by else None,
        "created_at": request.created_at.isoformat() if request.created_at else None,
    }


# ── reminders ────────────────────────────────────────────────────────────────

def _open_findings(db: Session, tenant_id: int):
    return (db.query(AuditIssueProfile, Issue)
            .join(Issue, Issue.id == AuditIssueProfile.issue_id)
            .filter(AuditIssueProfile.tenant_id == tenant_id,
                    AuditIssueProfile.deleted_at.is_(None),
                    AuditIssueProfile.record_type != "recommendation",
                    Issue.workflow_state.notin_(("closed", "cancelled"))).all())


def _due_again(profile: AuditIssueProfile, today: date, every: Optional[int]) -> bool:
    last = profile.last_reminded_on
    return not last or (today - last).days >= (every or 7)


def reminder_candidates(db: Session, tenant_id: int, today: date,
                        sla: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Findings whose owner should hear from us today, by the status SLAs in
    Settings: coming due, past due, delayed (materials needed), or not
    started long after the report. Each rule says how often to repeat."""
    from .settings import get_settings
    from .summary import timeline

    sla = sla or get_settings(db, tenant_id)["sla"]
    out = []
    for profile, issue in _open_findings(db, tenant_id):
        if issue.workflow_state == "closure_review" or not issue.owner_id:
            continue          # submitted: Audit Services' move (validation_waiting)
        status = effective_status(profile, issue, today)
        rule = sla.get("IP" if status == "unstated" else status) or {}
        if not rule.get("enabled") or not _due_again(profile, today, rule.get("repeat_every")):
            continue
        due = due_date_of(profile, issue)
        left = (due - today).days if due else None
        window = rule.get("remind_before_due")
        kind = None
        if status == "PD":
            kind = "past_due"
        elif status == "DE":
            kind = "delayed"
        elif left is not None and window is not None and 0 <= left <= window:
            kind = "due_soon"
        elif status == "NS" and rule.get("start_within") is not None:
            opened, _ = timeline(profile, issue, today)
            if (today - opened).days >= rule["start_within"]:
                kind = "not_started"
        if kind:
            out.append({"profile": profile, "issue": issue, "due": due, "kind": kind,
                        "past_due": max(-left, 0) if left is not None else 0})
    return out


def validation_waiting(db: Session, tenant_id: int, today: date,
                       rule: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Findings submitted for validation longer ago than Audit Services' SLA."""
    within = rule.get("validate_within")
    if not rule.get("enabled") or within is None:
        return []
    out = []
    for profile, issue in _open_findings(db, tenant_id):
        if issue.workflow_state != "closure_review" or not _due_again(profile, today, rule.get("repeat_every")):
            continue
        submitted = (db.query(func.max(IssueActivity.created_at))
                     .filter(IssueActivity.issue_id == issue.id,
                             IssueActivity.type == "validation_submitted").scalar())
        # Imported already reported done: waiting at least since the register first had it.
        since = (submitted.date() if submitted else profile.validation_started_on
                 or (profile.created_at.date() if profile.created_at else None))
        if since and (today - since).days >= within:
            out.append({"profile": profile, "issue": issue, "waited": (today - since).days})
    return out


def send_reminders(db: Session, tenant_id: int, *, today: Optional[date] = None,
                   email: Optional[bool] = None, dry_run: bool = False) -> Dict[str, Any]:
    from .settings import get_settings

    today = today or date.today()
    settings = get_settings(db, tenant_id)
    sla = settings["sla"]
    email = settings.get("email", False) if email is None else email
    items = reminder_candidates(db, tenant_id, today, sla)
    waiting = validation_waiting(db, tenant_id, today, sla["validation"])
    by_owner: Dict[int, List[Dict[str, Any]]] = {}
    for item in items:
        by_owner.setdefault(item["issue"].owner_id, []).append(item)

    def line(item):
        text = f"- {_label(item['issue'], item['profile'])}"
        if item["kind"] == "delayed":
            return text + " — validation needs more materials from you"
        if item["kind"] == "not_started":
            return text + " — not started yet"
        text += f" — due {item['due'].isoformat()}" if item["due"] else ""
        return text + (f" ({item['past_due']} days past due)" if item["past_due"] else "")

    escalate_after = sla["PD"].get("escalate_after")
    escalate = [i for i in items if i["kind"] == "past_due" and escalate_after is not None
                and i["past_due"] >= escalate_after]
    count = lambda kind: sum(i["kind"] == kind for i in items)  # noqa: E731
    summary = {"due_soon": count("due_soon"), "past_due": count("past_due"),
               "delayed": count("delayed"), "not_started": count("not_started"),
               "validation_waiting": len(waiting), "owners": len(by_owner), "escalated": len(escalate),
               "email": email,
               "items": [{"issue_id": i["issue"].id, "reference": i["profile"].issue_ref,
                          "title": i["issue"].title, "owner_id": i["issue"].owner_id,
                          "due": i["due"].isoformat() if i["due"] else None,
                          "past_due": i["past_due"], "kind": i["kind"]} for i in items]
               + [{"issue_id": w["issue"].id, "reference": w["profile"].issue_ref,
                   "title": w["issue"].title, "owner_id": None, "due": None, "past_due": 0,
                   "kind": "validation_waiting", "waited": w["waited"]} for w in waiting]}
    if dry_run:
        return summary
    for owner_id, mine in by_owner.items():
        overdue = any(i["kind"] == "past_due" for i in mine)
        acting = any(i["kind"] in ("delayed", "not_started") for i in mine)
        _notify(db, tenant_id, [owner_id],
                f"Audit findings {'past due' if overdue else 'need your action' if acting else 'coming due'}: {len(mine)}",
                "These audit findings need your action plan completed and submitted for "
                "validation:\n" + "\n".join(line(i) for i in mine),
                email=email, kind="warning" if overdue or acting else "info")
    team = audit_services(db, tenant_id)
    if escalate:
        _notify(db, tenant_id, team,
                f"Escalation: {len(escalate)} audit finding(s) {escalate_after}+ days past due",
                "\n".join(line(i) for i in escalate), email=email, kind="warning")
    if waiting:
        _notify(db, tenant_id, team,
                f"Validation waiting: {len(waiting)} finding(s) submitted "
                f"{sla['validation']['validate_within']}+ days ago",
                "\n".join(f"- {_label(w['issue'], w['profile'])} — waiting {w['waited']} days"
                          for w in waiting), email=email, kind="warning")
    for item in [*items, *waiting]:
        item["profile"].last_reminded_on = today
    return summary
