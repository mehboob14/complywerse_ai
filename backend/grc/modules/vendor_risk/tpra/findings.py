"""A finding beyond scoring: who owns it, whether it holds the approval gate, where it came from, and the Task Management
task that tracks its fix; and how a person starts fixing, closes or reopens one.

Findings are raised by scoring (service.raise_answer_findings), by hand (api.create_finding), from a monitoring signal
(monitoring.raise_finding), from a missed service level (raise_sla_breach below) and from a document review
(paperwork.sync_finding); each says so in `source`. A row from before the column reads as an assessment's when an answer or a
critical control stands behind it, and as raised by hand otherwise (source_of).

Fixing starts with start_remediation: a remediation record, due when the policy says for the severity, and a twin task in
Task Management (grc_critical_tasks, source_module "vendor_risk", source_entity_type "TPRARemediation", source_entity_id the
remediation), as an approval's conditions have one (service.mirror_conditions). The finding keeps the twin's id in task_id.
Each side writes the other through the functions here, so an edit never echoes back: Task Management's endpoints end in
sync_from_task (by way of service.sync_condition_from_task), and the remediation's own endpoints in mirror. Deleting the twin
leaves the remediation as it was.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set

from sqlalchemy.orm import Session

from ....models import (
    CriticalTask, GRCUser, TPRAEngagement, TPRAFinding, TPRARemediation, TPRARiskAcceptance, Vendor, VendorAssessment,
)
from . import service
from .bootstrap import get_tiering_config
from .policy import held_to, remediation_days

OPEN = ("open", "in_remediation")
SOURCES = ("assessment", "manual", "sla_breach", "signal", "document_review", "offboarding")
SEVERITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
TWIN_SOURCE, TWIN_MODULE, TWIN_TYPE = "Vendor Finding", "vendor_risk", "TPRARemediation"
_FROM_TASK = {"Completed": "completed", "Verified": "completed", "In Progress": "in_progress", "Under Review": "in_progress"}
_TO_TASK = {"completed": "Completed", "in_progress": "In Progress"}          # anything else is Open


def source_of(f: TPRAFinding) -> str:
    """Where a finding came from: what it says, else worked out from the row, which had no such column before."""
    if f.source in SOURCES:
        return f.source
    return "assessment" if (f.question_key or f.source_response_id) else "manual"


def note_required(f: TPRAFinding) -> bool:
    """A critical or blocking finding (a failed critical control is both) is closed with a note on how it was resolved."""
    return f.severity == "critical" or bool(f.is_blocking) or bool(f.is_critical_control_fail)


def clean(text: Optional[str]) -> str:
    return " ".join((text or "").split())


def _bump(row) -> None:
    row.row_version = (row.row_version or 1) + 1


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _day(value) -> Optional[str]:
    """The day an acceptance runs to, as a date: it covers the whole of it (service.acceptance_holds)."""
    return value.date().isoformat() if value else None


# ── reading ──────────────────────────────────────────────────────────────────

def names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: u.display_name or u.username or u.email for u in db.query(GRCUser).filter(GRCUser.id.in_(wanted))}


def extras(db: Session, rows: List[TPRAFinding]) -> Dict[int, dict]:
    """What a list of findings says beyond the rows, read in a handful of queries: the owner, the engagement, when the fix
    is due, the acceptance in force and the task tracking it. `sla_due` is when the policy's window for the severity ends,
    counted from the day it was raised, under the policy its assessment was tiered under; `due_date` is the earliest date
    of the fixes still under way; `fix_done` says one is completed (evidence of a fix)."""
    ids = [f.id for f in rows]
    if not ids:
        return {}
    people = names(db, (f.owner_id for f in rows))
    assessments = {a.id: a for a in db.query(VendorAssessment).filter(
        VendorAssessment.id.in_({f.assessment_id for f in rows}))}
    engaged = {e.id: e.name for e in db.query(TPRAEngagement).filter(
        TPRAEngagement.id.in_({a.engagement_id for a in assessments.values() if a.engagement_id} or {-1}))}
    due: Dict[int, datetime] = {}
    count: Dict[int, int] = {}
    treatment: Dict[int, str] = {}
    fixed: Set[int] = set()
    for fid, when, status, how in db.query(TPRARemediation.finding_id, TPRARemediation.due_date, TPRARemediation.status,
                                           TPRARemediation.treatment_type).filter(
            TPRARemediation.finding_id.in_(ids), TPRARemediation.deleted_at.is_(None)).order_by(TPRARemediation.id):
        count[fid] = count.get(fid, 0) + 1
        treatment[fid] = how or "remediate"                  # the latest plan's
        if status == "completed":
            fixed.add(fid)
        elif when is not None and (fid not in due or when < due[fid]):
            due[fid] = when
    accepted: Dict[int, TPRARiskAcceptance] = {}
    for a in db.query(TPRARiskAcceptance).filter(
            TPRARiskAcceptance.finding_id.in_(ids), TPRARiskAcceptance.deleted_at.is_(None),
            TPRARiskAcceptance.status == "active").order_by(TPRARiskAcceptance.id):
        accepted[a.finding_id] = a                          # the latest wins
    states = dict(db.query(CriticalTask.id, CriticalTask.status).filter(
        CriticalTask.id.in_({f.task_id for f in rows if f.task_id} or {-1})))
    signers = names(db, (a.accepted_by for a in accepted.values()))
    tenant_cfg: Dict[int, dict] = {}
    out: Dict[int, dict] = {}
    for f in rows:
        a = assessments.get(f.assessment_id)
        if f.tenant_id not in tenant_cfg:
            tenant_cfg[f.tenant_id] = get_tiering_config(db, f.tenant_id)
        # the window its assessment was tiered under (service.config_for, with the tenant's settings read once)
        days = remediation_days(held_to(tenant_cfg[f.tenant_id], getattr(a, "policy_snapshot", None)), f.severity)
        acc = accepted.get(f.id)
        out[f.id] = {
            "owner": {"id": f.owner_id, "name": people.get(f.owner_id)} if f.owner_id else None,
            "engagement": {"id": a.engagement_id, "name": engaged.get(a.engagement_id)} if a is not None and a.engagement_id else None,
            "due_date": _iso(due.get(f.id)),
            "sla_due": _iso(f.created_at + timedelta(days=days)) if f.created_at else None,
            "accepted_until": _day(acc.expiry) if acc is not None and f.status == "accepted" else None,
            "acceptance": {"id": acc.id, "rationale": acc.rationale, "expiry": _day(acc.expiry),
                           "by": signers.get(acc.accepted_by), "at": _iso(acc.accepted_at)}
            if acc is not None and f.status == "accepted" else None,
            "task": {"id": f.task_id, "status": states.get(f.task_id)} if f.task_id and f.task_id in states else None,
            "remediation_count": count.get(f.id, 0), "fix_done": f.id in fixed,
            # what is being done about it: accepting it, or the latest plan's treatment (remediate unless one says more)
            "treatment": "accept" if f.status == "accepted" else treatment.get(f.id, "remediate"),
        }
    return out


# ── the Task Management twin ─────────────────────────────────────────────────

def twin(db: Session, f: TPRAFinding) -> Optional[CriticalTask]:
    """The task tracking this finding's fix, while it exists."""
    ct = db.get(CriticalTask, f.task_id) if f.task_id else None
    return ct if ct is not None and ct.source_module == TWIN_MODULE and ct.source_entity_type == TWIN_TYPE else None


def fix_due(db: Session, f: TPRAFinding) -> datetime:
    """When a fix started now is due: the policy's window for the severity, as the assessment was tiered under it."""
    a = db.get(VendorAssessment, f.assessment_id)
    return datetime.utcnow() + timedelta(days=remediation_days(service.config_for(db, a) if a is not None else None, f.severity))


def _write_twin(db: Session, f: TPRAFinding, rem: TPRARemediation, user_id: Optional[int]) -> CriticalTask:
    """Create the remediation's task, or bring the one it has in line with the remediation. Caller owns the commit."""
    from ...governance.regulatory_tasks import _history, _ids, _set_status

    vendor = db.get(Vendor, f.vendor_id)
    owner = next(iter(_ids([rem.owner_id])), None)
    wanted = {"title": f"{vendor.name if vendor else 'Vendor'}: {f.title or 'Finding'}"[:255], "due_date": rem.due_date}
    ct = twin(db, f)
    if ct is None:
        ct = CriticalTask(
            tenant_id=f.tenant_id, source=TWIN_SOURCE, source_module=TWIN_MODULE, source_entity_type=TWIN_TYPE,
            source_entity_id=rem.id, category="Remediation", status="Open",
            priority=(f.severity if f.severity in SEVERITY_RANK else "medium").capitalize(), created_by_id=user_id,
            description=(f"Fix for a {f.severity} finding on {vendor.name if vendor else 'a vendor'}, tracked in Third-Party "
                         f"Risk.\n\n{rem.plan or f.description or ''}").strip(),
            assigned_user_ids=[owner] if owner else [], assigned_owner_id=owner, **wanted)
        db.add(ct)
        db.flush()
        _history(db, ct.id, user_id, f"Created from {TWIN_MODULE}", "source_entity", None, f"{TWIN_TYPE} #{rem.id}")
        f.task_id = ct.id
        if rem.status != "open":
            _set_status(ct, _TO_TASK.get(rem.status, "Open"), rem.completed_at)
        db.flush()
        return ct
    changed = False
    for field, value in wanted.items():
        if getattr(ct, field) != value:
            _history(db, ct.id, user_id, "Synced from Vendor Risk", field, getattr(ct, field), value)
            setattr(ct, field, value)
            changed = True
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    if (ids[0] if ids else None) != owner:
        new_ids = [owner] if owner else []
        _history(db, ct.id, user_id, "Synced from Vendor Risk", "assigned_user_ids", ids, new_ids)
        ct.assigned_user_ids, ct.assigned_owner_id = new_ids, owner
        changed = True
    now = _FROM_TASK.get(ct.status, "open")
    if now != rem.status and not (rem.status == "overdue" and now == "open"):
        target = _TO_TASK.get(rem.status, "Open")
        _history(db, ct.id, user_id, "Synced from Vendor Risk", "status", ct.status, target)
        _set_status(ct, target, rem.completed_at)
        changed = True
    if changed:
        ct.updated_at = datetime.utcnow()
    db.flush()
    return ct


def mirror(db: Session, rem: TPRARemediation, user_id: Optional[int] = None) -> None:
    """The remediation changed here: its task, if it has one, follows, and its owner is the finding's. A remediation added
    by hand has no task, and its owner is nobody's but its own."""
    f = db.get(TPRAFinding, rem.finding_id)
    ct = twin(db, f) if f is not None else None
    if ct is not None and ct.source_entity_id == rem.id:
        if f.owner_id != rem.owner_id:
            was, f.owner_id = f.owner_id, rem.owner_id
            _bump(f)
            service.write_audit(db, f.tenant_id, entity="finding", action="assign", vendor_id=f.vendor_id,
                                assessment_id=f.assessment_id, entity_id=f.id, actor_id=user_id, from_value=was,
                                to_value=rem.owner_id, reason="Changed on its remediation")
        _write_twin(db, f, rem, user_id)


def drop_twin(db: Session, rem: TPRARemediation) -> None:
    """The remediation is going: so is its task."""
    f = db.get(TPRAFinding, rem.finding_id)
    ct = twin(db, f) if f is not None else None
    if ct is not None and ct.source_entity_id == rem.id:
        f.task_id = None
        db.delete(ct)


def sync_from_task(db: Session, ct: CriticalTask, user_id: Optional[int] = None) -> None:
    """Task Management changed a twin: the remediation follows (status, owner, due date), and the finding's owner is the
    task's. A finding is never closed or reopened by its task. No-op for any other task."""
    if ct.source_module != TWIN_MODULE or ct.source_entity_type != TWIN_TYPE:
        return
    from ...governance.regulatory_tasks import _ids

    rem = db.get(TPRARemediation, ct.source_entity_id)
    f = db.get(TPRAFinding, rem.finding_id) if rem is not None else None
    if rem is None or f is None or f.task_id != ct.id:
        return
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    owner = ids[0] if ids else None
    status, moved = _FROM_TASK.get(ct.status, "open"), []
    if status != rem.status and not (rem.status == "overdue" and status == "open"):
        rem.status = status
        rem.completed_at = (ct.completed_at or datetime.utcnow()) if status == "completed" else None
        moved.append("status")
    if rem.owner_id != owner:
        rem.owner_id = owner
        moved.append("owner")
    if rem.due_date != ct.due_date:
        rem.due_date = ct.due_date
        moved.append("due date")
    if f.owner_id != owner:
        f.owner_id = owner
        _bump(f)
        moved.append("finding owner")
    if moved:
        _bump(rem)
        service.write_audit(db, rem.tenant_id, entity="remediation", action="update", vendor_id=f.vendor_id,
                            assessment_id=f.assessment_id, entity_id=rem.id, actor_id=user_id,
                            reason="Changed in Task Management", extra={"finding_id": f.id, "changed": moved})


def on_task_deleted(db: Session, ct: CriticalTask, user_id: Optional[int] = None) -> None:
    """Task Management is deleting a twin: the remediation stays as it was, without one. No-op for any other task."""
    if ct.source_module != TWIN_MODULE or ct.source_entity_type != TWIN_TYPE:
        return
    rem = db.get(TPRARemediation, ct.source_entity_id)
    f = db.get(TPRAFinding, rem.finding_id) if rem is not None else None
    if f is not None and f.task_id == ct.id:
        f.task_id = None
        service.write_audit(db, f.tenant_id, entity="finding", action="update", vendor_id=f.vendor_id,
                            assessment_id=f.assessment_id, entity_id=f.id, actor_id=user_id,
                            reason="Its Task Management task was deleted; the remediation stays", extra={"task_id": ct.id})


# ── what a person does with a finding ────────────────────────────────────────

def after_status_change(db: Session, f: TPRAFinding, was: str, actor_id: Optional[int]) -> None:
    """What follows a finding moving between open, accepted and closed: the risk trend, its issue, and a critical on an
    onboarded vendor (suspended while one stands, reactivated once none does)."""
    settled = ("closed", "accepted")
    db.flush()                                # tenant sessions do not autoflush: the gate below asks the database
    if f.status in settled and was not in settled:
        service.snapshot_after_finding_change(db, f)
    if f.status in settled:
        service.close_finding_issue(db, f, actor_id)
    elif f.status in OPEN:
        service.ensure_finding_issue(db, f, actor_id)
    vendor = db.get(Vendor, f.vendor_id)
    assessment = db.get(VendorAssessment, f.assessment_id)
    if vendor and assessment:
        service.enforce_critical_invariant(db, vendor, assessment, actor_id)


def set_owner(db: Session, f: TPRAFinding, owner_id: Optional[int], actor_id: Optional[int]) -> None:
    """Hand the finding to someone (or to no one); the fix in flight, and its task, go with it."""
    if f.owner_id == owner_id:
        return
    was, f.owner_id = f.owner_id, owner_id
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="assign", vendor_id=f.vendor_id,
                        assessment_id=f.assessment_id, entity_id=f.id, actor_id=actor_id, from_value=was, to_value=owner_id)
    ct = twin(db, f)
    rem = db.get(TPRARemediation, ct.source_entity_id) if ct is not None else None
    if rem is not None and rem.deleted_at is None and rem.status != "completed":
        rem.owner_id = owner_id
        _bump(rem)
        mirror(db, rem, actor_id)


def start_remediation(db: Session, f: TPRAFinding, actor_id: Optional[int], owner_id: Optional[int] = None,
                      due: Optional[datetime] = None) -> TPRARemediation:
    """Begin fixing an open finding: the remediation, due when the policy says for the severity, owned by the finding's
    owner (or the one named, who becomes its owner), and its task in Task Management. ValueError says why not."""
    if f.deleted_at is not None or f.status not in OPEN:
        raise ValueError("Only an open finding can be fixed. Reopen it first.")
    if twin(db, f) is not None:
        raise ValueError("This finding is already tracked as a task.")
    if owner_id and owner_id != f.owner_id:
        set_owner(db, f, owner_id, actor_id)
    rem = TPRARemediation(tenant_id=f.tenant_id, finding_id=f.id, title=(f.title or "Remediation")[:255],
                          treatment_type="remediate", owner_id=f.owner_id, due_date=due or fix_due(db, f), status="open")
    db.add(rem)
    db.flush()
    was, f.status = f.status, "in_remediation"
    _bump(f)
    _write_twin(db, f, rem, actor_id)
    service.write_audit(db, f.tenant_id, entity="remediation", action="create", vendor_id=f.vendor_id,
                        assessment_id=f.assessment_id, entity_id=rem.id, actor_id=actor_id,
                        extra={"finding_id": f.id, "task_id": f.task_id})
    service.write_audit(db, f.tenant_id, entity="finding", action="start_remediation", vendor_id=f.vendor_id,
                        assessment_id=f.assessment_id, entity_id=f.id, actor_id=actor_id, from_value=was,
                        to_value=f.status, extra={"task_id": f.task_id})
    return rem


def _revoke_acceptances(db: Session, f: TPRAFinding, actor_id: Optional[int], why: Optional[str]) -> None:
    """The acceptance no longer stands (the finding is closed or reopened): revoked, on the audit trail."""
    now = datetime.utcnow()
    for a in db.query(TPRARiskAcceptance).filter(TPRARiskAcceptance.finding_id == f.id, TPRARiskAcceptance.deleted_at.is_(None),
                                                 TPRARiskAcceptance.status == "active"):
        a.status, a.deleted_at = "revoked", now
        _bump(a)
        service.write_audit(db, f.tenant_id, entity="risk_acceptance", action="delete", vendor_id=f.vendor_id,
                            assessment_id=f.assessment_id, entity_id=a.id, actor_id=actor_id, reason=why)


def close_problem(db: Session, f: TPRAFinding, note: Optional[str]) -> Optional[str]:
    """Why this finding cannot be closed, as a sentence; None when it can. A fix is evidence: a completed remediation, or
    the note saying what was done; a critical or blocking finding always has the note."""
    if f.status == "closed":
        return "This finding is already closed."
    if not clean(note):
        if note_required(f):
            return "Say how this was resolved: a critical or blocking finding is closed with a note."
        done = db.query(TPRARemediation.id).filter(
            TPRARemediation.finding_id == f.id, TPRARemediation.deleted_at.is_(None),
            TPRARemediation.status == "completed").first()
        if not done:
            return ("A finding can only be closed after a remediation is completed (evidence of fix) or with a note saying "
                    "what was done; or record a risk acceptance instead.")
    elif note_required(f) and len(clean(note)) < 10:
        return "Say how this was resolved in a sentence (at least 10 characters)."
    return None


def close(db: Session, f: TPRAFinding, actor_id: Optional[int], note: Optional[str]) -> None:
    """Close it, with the note: the caller then runs after_status_change."""
    problem = close_problem(db, f, note)
    if problem:
        raise ValueError(problem)
    was, f.status = f.status, "closed"
    if was == "accepted":
        _revoke_acceptances(db, f, actor_id, "The finding was closed")
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="close", vendor_id=f.vendor_id,
                        assessment_id=f.assessment_id, entity_id=f.id, actor_id=actor_id, from_value=was,
                        to_value="closed", reason=clean(note)[:4000] or None)


def reopen(db: Session, f: TPRAFinding, actor_id: Optional[int], reason: Optional[str],
           status: Optional[str] = None) -> None:
    """Put a closed or accepted finding back on the open list, saying why: it counts again at the gate. An acceptance is
    revoked, and a fix that did not hold is open again with its task. It goes back in remediation when it has a task,
    else open (or the `status` asked for). The caller then runs after_status_change."""
    why = clean(reason)
    if f.status not in ("closed", "accepted"):
        raise ValueError("This finding is already open.")
    if not why:
        raise ValueError("Say why this finding is being reopened.")
    was = f.status
    if was == "accepted":
        _revoke_acceptances(db, f, actor_id, why[:4000])
    else:
        ct = twin(db, f)
        for rem in db.query(TPRARemediation).filter(TPRARemediation.finding_id == f.id, TPRARemediation.deleted_at.is_(None),
                                                    TPRARemediation.status == "completed"):
            rem.status, rem.completed_at = "open", None
            if ct is not None and ct.source_entity_id == rem.id:
                rem.owner_id = f.owner_id               # the fix under way is the finding's owner's, who may have changed
            _bump(rem)
            mirror(db, rem, actor_id)
    f.status = status or service.reopened_status(f)
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="reopen", vendor_id=f.vendor_id,
                        assessment_id=f.assessment_id, entity_id=f.id, actor_id=actor_id, from_value=was,
                        to_value=f.status, reason=why[:4000])


def raise_sla_breach(db: Session, vendor: Vendor, record, detail: str, actor_id: Optional[int]) -> Optional[TPRAFinding]:
    """A missed service level is a high finding on the supplier (General), once: not while an earlier one for the same level
    is open, in remediation or accepted. None when it already stands."""
    title = f"Service level missed: {record.sla_metric}"[:255]
    if db.query(TPRAFinding.id).filter(
            TPRAFinding.vendor_id == vendor.id, TPRAFinding.source == "sla_breach", TPRAFinding.title == title,
            TPRAFinding.deleted_at.is_(None), TPRAFinding.status.in_((*OPEN, "accepted"))).first():
        return None
    assessment = service.ensure_active_assessment(db, vendor, actor_id)
    f = TPRAFinding(tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id, domain="operational",
                    severity="high", title=title, description=detail, status="open", source="sla_breach",
                    created_by=actor_id)
    db.add(f)
    db.flush()
    service.write_audit(db, vendor.tenant_id, entity="finding", action="create", vendor_id=vendor.id,
                        assessment_id=assessment.id, entity_id=f.id, actor_id=actor_id, to_value=title,
                        extra={"sla_record_id": record.id})
    service.ensure_finding_issue(db, f, actor_id)
    return f
