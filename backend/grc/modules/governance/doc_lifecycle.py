"""A governance document's life as per-person obligations (tenants in ``config.DOCUMENT_LIFECYCLE_TENANTS``; "*" = all).

The sign-off flow (routers/document_signoff.py) decides *whether* a document is approved. This module records *who is
being asked, by when, and what they did*:

* ``review`` / ``approval`` - one row per person for the stage the document is in (a role or team is expanded to its
  members; the first member to sign satisfies it and the others' rows are cancelled);
* ``acknowledgement`` - one row per active user of the tenant, once per document, when it is published (users who join
  later are added by the daily sweep).

Every pending row has a twin in Task Management (``grc_critical_tasks``, source_module ``document_lifecycle``) and an
in-app alert, so it shows up with the person's other work. The twin cannot be completed from Task Management - signing
or acknowledging in the document does that. A sweep reminds before the due date, tells the document owner when it is
overdue and the tenant administrators a week later. Nothing here may stop a sign-off: the hooks swallow their own errors.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

# Defaults, overridable per organisation (Settings in the Approvals & Acknowledgements tab; ``settings``).
DEFAULTS: Dict[str, Any] = {
    "approval_days": int(os.getenv("DOCUMENT_APPROVAL_DUE_DAYS", "7")),     # a reviewer or approver is given this long
    "ack_days": int(os.getenv("DOCUMENT_ACK_DUE_DAYS", "14")),              # an acknowledgement is given this long
    "remind_days": 3,                                                       # a reminder this many days before the due date
    "admin_after_days": 7,                                                  # tenant administrators are told this long after the due date
    "email": True,                                                          # also email, where the organisation has email set up
}
_LIMITS = {"approval_days": (1, 365), "ack_days": (1, 365), "remind_days": (0, 60), "admin_after_days": (1, 365)}
SOURCE_MODULE = "document_lifecycle"
SOURCE_TYPE = "DocumentObligation"
_STAGE_KIND = {"reviewer": "review", "approver": "approval"}
_VERB = {"review": "Review", "approval": "Approve", "acknowledgement": "Acknowledge"}
_PENDING_STAGE = ("pending_review", "pending_approval")


def enabled(db) -> bool:
    from ...config import DOCUMENT_LIFECYCLE_TENANTS
    from ...models import Tenant

    tenant = db.query(Tenant).first()
    return bool(tenant and ("*" in DOCUMENT_LIFECYCLE_TENANTS or (tenant.slug or "").lower() in DOCUMENT_LIFECYCLE_TENANTS))


def settings(db, tenant_id: int) -> Dict[str, Any]:
    from ...models import DocumentLifecycleSettings

    row = db.query(DocumentLifecycleSettings).filter(DocumentLifecycleSettings.tenant_id == tenant_id).first()
    return {**DEFAULTS, **{k: v for k, v in ((row.config if row else None) or {}).items() if k in DEFAULTS}}


def save_settings(db, tenant_id: int, patch: Dict[str, Any], user_id: Optional[int] = None) -> Dict[str, Any]:
    from ...models import DocumentLifecycleSettings

    current = settings(db, tenant_id)
    for key, value in (patch or {}).items():
        if key not in DEFAULTS:
            raise ValueError(f"unknown setting: {key}")
        if key == "email":
            current[key] = bool(value)
            continue
        low, high = _LIMITS[key]
        number = int(value)
        if not low <= number <= high:
            raise ValueError(f"{key} must be between {low} and {high}")
        current[key] = number
    row = db.query(DocumentLifecycleSettings).filter(DocumentLifecycleSettings.tenant_id == tenant_id).first()
    if row is None:
        row = DocumentLifecycleSettings(tenant_id=tenant_id, config={})
        db.add(row)
    row.config, row.updated_by, row.updated_at = dict(current), user_id, datetime.utcnow()
    db.commit()
    return current


def _safe(fn):
    """A lifecycle hook must never stop a sign-off, a publish or a send."""
    def run(db, *args, **kwargs):
        try:
            if not enabled(db):
                return None
            with db.begin_nested():
                return fn(db, *args, **kwargs)
        except Exception:       # noqa: BLE001
            logger.exception("document lifecycle: %s failed", fn.__name__)
            return None
    run.__name__ = fn.__name__
    return run


# ── people, alerts, tasks ────────────────────────────────────────────────────
def _names(db, ids: Iterable[int]) -> Dict[int, str]:
    from ...models import GRCUser

    ids = {int(i) for i in ids if i}
    rows = db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids)).all() if ids else []
    return {i: (d or u or f"User #{i}") for i, d, u in rows}


def _notify(db, doc, user_ids: Iterable[Optional[int]], subject: str, message: str, kind: str = "info", email: bool = False) -> None:
    """An in-app alert, and an email as well when ``email`` and the organisation has it on (and has email set up)."""
    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return
    try:
        from ..workflow_engine.services.notification_service import send_workflow_notification

        channels = ["in_app", "email"] if email and settings(db, doc.tenant_id)["email"] else ["in_app"]
        send_workflow_notification(db, tenant_id=doc.tenant_id, subject=subject[:500], message=message,
                                   workflow_instance_id=None, user_ids=ids, channels=channels, notification_type=kind)
    except Exception:       # noqa: BLE001
        logger.exception("document lifecycle: could not alert users %s", ids)


def _history(db, task_id: int, user_id: Optional[int], action: str, field=None, old=None, new=None) -> None:
    from ...models import CriticalTaskHistory

    db.add(CriticalTaskHistory(task_id=task_id, user_id=user_id, action=action, field_changed=field,
                               old_value=None if old is None else str(old), new_value=None if new is None else str(new)))


def _open_twin(db, ob, doc, by: Optional[int]) -> None:
    from ...models import CriticalTask

    verb = _VERB[ob.kind]
    ct = CriticalTask(
        tenant_id=ob.tenant_id, title=f"{verb}: {doc.title}"[:255],
        description=(f"{verb} the document \"{doc.title}\" (version {ob.document_version or doc.current_version}). "
                     f"Open the document, then Approvals & Acknowledgements. This task closes when you "
                     f"{'acknowledge' if ob.kind == 'acknowledgement' else 'sign'} it there."),
        source="Governance document", source_module=SOURCE_MODULE, source_entity_type=SOURCE_TYPE,
        source_entity_id=ob.id, category="Compliance", status="Open",
        priority="Medium" if ob.kind == "acknowledgement" else "High", due_date=ob.due_date,
        assigned_user_ids=[ob.user_id], assigned_owner_id=ob.user_id, created_by_id=by or doc.owner_id)
    db.add(ct)
    db.flush()
    ob.critical_task_id = ct.id
    _history(db, ct.id, by, "Created from governance documents", "source_entity", None, f"Document #{doc.id}")


def _close(db, ob, completed: bool, by: Optional[int] = None) -> None:
    """The obligation ended: its task is completed when the person did it, removed when it no longer applies."""
    from ...models import CriticalTask

    ct = db.get(CriticalTask, ob.critical_task_id) if ob.critical_task_id else None
    if ct is None:
        ob.critical_task_id = None
        return
    if completed:
        ct.status, ct.completed_at, ct.updated_at = "Completed", datetime.utcnow(), datetime.utcnow()
        _history(db, ct.id, by, "Completed in the document", "status", "Open", "Completed")
    else:
        db.delete(ct)
        ob.critical_task_id = None


def _pending(db, document_id: int, kinds: Iterable[str], user_id: Optional[int] = None):
    from ...models import DocumentObligation

    db.flush()          # tenant sessions do not autoflush: a hook that just closed or cancelled a row must not find it pending again
    q = db.query(DocumentObligation).filter(DocumentObligation.document_id == document_id,
                                            DocumentObligation.kind.in_(list(kinds)), DocumentObligation.status == "pending")
    return q.filter(DocumentObligation.user_id == user_id) if user_id else q


def _request(db, doc, kind: str, user_ids: Iterable[int], by: Optional[int], days: int, assignment_id: Optional[int] = None) -> List[int]:
    """Ask each person (once); returns the ones newly asked."""
    from ...models import DocumentObligation

    already = {o.user_id for o in _pending(db, doc.id, [kind])}
    asked: List[int] = []
    for uid in dict.fromkeys(int(u) for u in user_ids if u):
        if uid in already:
            continue
        ob = DocumentObligation(tenant_id=doc.tenant_id, document_id=doc.id, kind=kind, user_id=uid, assignment_id=assignment_id,
                                document_version=doc.current_version, status="pending", requested_by=by,
                                due_date=datetime.utcnow() + timedelta(days=days))
        db.add(ob)
        db.flush()
        _open_twin(db, ob, doc, by)
        asked.append(uid)
    return asked


# ── hooks called by the sign-off, publish and participant flows ──────────────
def _open_stage(db, doc, stage: str, by: Optional[int]) -> None:
    from .routers.document_signoff import _assignments, _resolve_target_users

    kind = _STAGE_KIND[stage]
    asked: List[int] = []
    for a in (a for a in _assignments(db, doc.id) if a.role_type == stage):
        asked += _request(db, doc, kind, _resolve_target_users(db, [doc.tenant_id], a.target_type, a.target_id), by,
                          settings(db, doc.tenant_id)["approval_days"], a.id)
    _notify(db, doc, asked, f"{_VERB[kind]} requested: {doc.title}",
            f"You have been asked to {'review' if kind == 'review' else 'approve'} \"{doc.title}\". "
            f"It is in your tasks and under Governance > Documents > Approvals & Acknowledgements.", "warning", email=True)
    _mark_emailed(db, doc.id, kind, asked)


def _mark_emailed(db, document_id: int, kind: str, user_ids: Iterable[int]) -> None:
    ids = list(user_ids)
    if ids:
        for ob in _pending(db, document_id, [kind]).all():
            if ob.user_id in ids and ob.emailed_at is None:
                ob.emailed_at = datetime.utcnow()


def _cancel(db, doc, kinds: Iterable[str]) -> None:
    for ob in _pending(db, doc.id, kinds).all():
        ob.status, ob.done_at = "cancelled", datetime.utcnow()
        _close(db, ob, completed=False)


@_safe
def on_sent(db, doc, by: Optional[int]) -> None:
    """The document was sent for review (or straight to approval): a fresh round of requests."""
    _cancel(db, doc, ("review", "approval"))
    _open_stage(db, doc, "reviewer" if doc.status == "pending_review" else "approver", by)


@_safe
def on_signed(db, doc, user_id: int, role_type: str, signature_id: Optional[int], esign_id: Optional[int], advanced_to: Optional[str]) -> None:
    kind = _STAGE_KIND[role_type]
    now = datetime.utcnow()
    assignments = set()
    for ob in _pending(db, doc.id, [kind], user_id).all():
        ob.status, ob.done_at, ob.signature_id, ob.esign_id = "done", now, signature_id, esign_id
        assignments.add(ob.assignment_id)
        _close(db, ob, completed=True, by=user_id)
    for ob in _pending(db, doc.id, [kind]).all():       # a role or team is satisfied by one member
        if ob.assignment_id in assignments:
            ob.status, ob.done_at = "cancelled", now
            _close(db, ob, completed=False)
    if advanced_to == "pending_approval":
        _open_stage(db, doc, "approver", user_id)
    elif advanced_to == "approved":
        _notify(db, doc, [doc.owner_id, doc.author_id], f"Approved: {doc.title}",
                f"\"{doc.title}\" has been approved by all its approvers and can be published.", "success", email=True)


@_safe
def on_rejected(db, doc, user_id: int, role_type: str, comment: str) -> None:
    now = datetime.utcnow()
    for ob in _pending(db, doc.id, [_STAGE_KIND[role_type]], user_id).all():
        ob.status, ob.done_at, ob.comment = "rejected", now, comment
        _close(db, ob, completed=True, by=user_id)
    _cancel(db, doc, ("review", "approval"))
    who = _names(db, [user_id]).get(user_id, "A reviewer")
    _notify(db, doc, [doc.owner_id, doc.author_id], f"Rejected: {doc.title}", f"{who} rejected \"{doc.title}\": {comment}", "error", email=True)


@_safe
def on_participants_changed(db, doc, by: Optional[int]) -> None:
    from .routers.document_signoff import _assignments, _resolve_target_users

    if doc.status not in _PENDING_STAGE:
        return
    stage = "reviewer" if doc.status == "pending_review" else "approver"
    # the assignment rows are replaced whenever participants are saved, so match on the person, not the row id
    wanted: Dict[int, int] = {}
    for a in (a for a in _assignments(db, doc.id) if a.role_type == stage):
        for uid in _resolve_target_users(db, [doc.tenant_id], a.target_type, a.target_id):
            wanted.setdefault(uid, a.id)
    for ob in _pending(db, doc.id, [_STAGE_KIND[stage]]).all():
        if ob.user_id in wanted:
            ob.assignment_id = wanted[ob.user_id]
        else:
            ob.status, ob.done_at = "cancelled", datetime.utcnow()
            _close(db, ob, completed=False)
    _open_stage(db, doc, stage, by)


def start_round(db, doc, by: Optional[int] = None) -> None:
    """The document went to review or approval from anything else (a change to an approved or published one, a status set by
    hand): a new round with the same reviewers and approvers (the round itself is stamped by the models' status listener, so the
    signatures given before no longer count). With nobody to sign that stage it goes to the stage that has someone, as Send
    would, or back to draft to be sent. Runs for every organisation, with or without the life cycle."""
    from .routers.document_signoff import _assignments
    from .routers.versions import create_audit_log

    roles = {a.role_type for a in _assignments(db, doc.id)}
    stage = "reviewer" if doc.status == "pending_review" else "approver"
    if stage in roles:
        return
    other = "approver" if stage == "reviewer" else "reviewer"
    to = ("pending_approval" if other == "approver" else "pending_review") if other in roles else "draft"
    why = {"pending_approval": "No reviewers are set, so it goes to its approvers",
           "pending_review": "No approvers are set, so it goes to its reviewers",
           "draft": "Nobody is set to review or approve it, so it is a draft again: choose reviewers and send it for review"}[to]
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="status_changed", field_changed="status",
                     old_value=doc.status, new_value=to, action_details=why)
    doc.status = to


REVIEWED = ("approved", "published", "exception_applied") + _PENDING_STAGE


def changed_after_review(db, doc, old_status: Optional[str], by: Optional[int], why: str) -> bool:
    """The document's text or file became a new version. One that is approved or published, or in review or approval, is
    reviewed again from the start by the same people (the user's decisions of 2026-10-16): a new round, so signatures given on
    the earlier text no longer count. Writes the status row; True when it is (back) in review or approval afterwards."""
    from .routers.versions import create_audit_log

    if old_status not in REVIEWED:
        return False
    doc.status = "pending_review"
    if old_status == "pending_review":
        doc.signoff_round_at = datetime.utcnow()      # the same status: the models' listener sees no change, so the round is set here
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="status_changed", field_changed="status",
                     old_value=old_status, new_value="pending_review", action_details=why)
    if old_status in _PENDING_STAGE:                  # already in a round: start it again and ask the same people again
        start_round(db, doc, by)
        _reask(db, doc, by)
    else:
        on_status_changed(db, doc, old_status, "pending_review", by)
    return doc.status in _PENDING_STAGE


@_safe
def _reask(db, doc, by: Optional[int] = None) -> None:
    _cancel(db, doc, ("review", "approval"))
    if doc.status in _PENDING_STAGE:
        _open_stage(db, doc, "reviewer" if doc.status == "pending_review" else "approver", by)


def on_status_changed(db, doc, old: Optional[str], new: Optional[str], by: Optional[int] = None) -> None:
    """Every status change the platform makes passes here (the studio's saves, take-back, restore, the status endpoints)."""
    if new in _PENDING_STAGE and old not in _PENDING_STAGE:
        start_round(db, doc, by)
    _status_hooks(db, doc, old, doc.status, by)


@_safe
def _status_hooks(db, doc, old: Optional[str], new: Optional[str], by: Optional[int] = None) -> None:
    if old in _PENDING_STAGE and new not in _PENDING_STAGE:
        _cancel(db, doc, ("review", "approval"))
    if new in _PENDING_STAGE and old not in _PENDING_STAGE:          # back to review: the same people are asked again
        _cancel(db, doc, ("review", "approval"))
        _open_stage(db, doc, "reviewer" if new == "pending_review" else "approver", by)
    if old == "published" and new != "published":
        _cancel(db, doc, ("acknowledgement",))
    if new == "published" and old != "published":
        _ensure_acknowledgements(db, doc, by)


def _ensure_acknowledgements(db, doc, by: Optional[int] = None) -> int:
    from ...models import DocumentObligation, GRCUser  # noqa: F401

    if doc.status != "published":
        return 0
    return request_acknowledgements(db, doc, None, by or doc.published_by)


def request_acknowledgements(db, doc, user_ids: Optional[Iterable[int]] = None, by: Optional[int] = None, days: Optional[int] = None) -> int:
    """Ask people (everyone active when ``user_ids`` is None) to acknowledge the document, those not already asked or done."""
    from ...models import DocumentObligation, GRCUser

    have = {uid for (uid,) in db.query(DocumentObligation.user_id).filter(
        DocumentObligation.document_id == doc.id, DocumentObligation.kind == "acknowledgement",
        DocumentObligation.status.in_(("pending", "done")))}
    active = [uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True)).order_by(GRCUser.id)]
    pool = active if user_ids is None else [u for u in dict.fromkeys(int(i) for i in user_ids) if u in set(active)]
    asked = _request(db, doc, "acknowledgement", [u for u in pool if u not in have], by,
                     days or settings(db, doc.tenant_id)["ack_days"])
    _notify(db, doc, asked, f"Please acknowledge: {doc.title}",
            f"\"{doc.title}\" has been published. Read it and acknowledge it before the due date; it is in your tasks.", "info")
    return len(asked)


def document_for_event(db, tenant_id: int, payload: Dict[str, Any]):
    """The governance document a workflow event is about: named in the payload, or the document of an obligation."""
    from ...models import DocumentObligation, GovernanceDocument

    doc_id = payload.get("document_id")
    rtype, rid = payload.get("resource_type"), payload.get("resource_id")
    if not doc_id and rtype == "grc_governance_documents":
        doc_id = rid
    if not doc_id and rtype == "grc_document_obligations" and rid:
        ob = db.get(DocumentObligation, int(rid))
        doc_id = ob.document_id if ob else None
    try:
        return db.query(GovernanceDocument).filter(GovernanceDocument.id == int(doc_id), GovernanceDocument.tenant_id == tenant_id).first() if doc_id else None
    except (TypeError, ValueError):
        return None


ensure_acknowledgements = _safe(_ensure_acknowledgements)


# ── acknowledging ────────────────────────────────────────────────────────────
def acknowledge(db, doc, user, comment: Optional[str] = None, signature_image: Optional[str] = None, request=None):
    """The current user acknowledges the document. A drawn signature is optional and, when given, is sealed like a sign-off."""
    from ...models import DocumentObligation
    from ...services import esign
    from .routers.versions import create_audit_log

    if doc.status != "published":
        raise ValueError("Only a published document can be acknowledged.")
    _ensure_acknowledgements(db, doc)
    ob = (db.query(DocumentObligation).filter(DocumentObligation.document_id == doc.id, DocumentObligation.kind == "acknowledgement",
                                              DocumentObligation.user_id == user.id, DocumentObligation.status.in_(("pending", "done")))
          .order_by(DocumentObligation.id.desc()).first())
    if ob is None:
        raise LookupError("You are not asked to acknowledge this document.")
    if ob.status == "done":
        return ob
    name = user.display_name or user.username
    if signature_image:
        esig = esign.record(
            db, tenant_id=doc.tenant_id, record_type="document_acknowledgement", record_id=ob.id, signature_image=signature_image,
            meaning=f"Acknowledged: {doc.title}", signer_name=name, signer_user_id=user.id, signer_email=user.email,
            signer_title=getattr(user, "designation", None), document=doc, document_version=doc.current_version,
            content_sha256=esign.document_fingerprint(doc), request=request)
        ob.esign_id = esig.id
    ob.status, ob.done_at, ob.comment = "done", datetime.utcnow(), (comment or None)
    _close(db, ob, completed=True, by=user.id)
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action="acknowledged",
                     action_details=f"Acknowledged version {doc.current_version}" + (f": {comment}" if comment else ""),
                     field_changed="acknowledgement", old_value=None, new_value=name)
    db.commit()
    return ob


# ── Task Management side ─────────────────────────────────────────────────────
def sync_from_critical_task(db, critical_task_id: int, user_id: Optional[int] = None) -> None:
    """Task Management changed one of our tasks. It cannot be completed there (signing or acknowledging in the document
    does that), so an attempt is put back."""
    from ...models import CriticalTask, DocumentObligation

    ct = db.get(CriticalTask, critical_task_id)
    if ct is None or ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    ob = db.get(DocumentObligation, ct.source_entity_id)
    if ob is not None and ob.status == "pending" and ct.status in ("Completed", "Verified"):
        _history(db, ct.id, user_id, "Reopened: complete this in the document", "status", ct.status, "Open")
        ct.status, ct.completed_at, ct.verified_at = "Open", None, None


def on_critical_task_deleted(db, ct) -> None:
    from ...models import DocumentObligation

    if ct.source_module == SOURCE_MODULE and ct.source_entity_type == SOURCE_TYPE:
        ob = db.get(DocumentObligation, ct.source_entity_id)
        if ob is not None and ob.critical_task_id == ct.id:
            ob.critical_task_id = None


# ── reading ──────────────────────────────────────────────────────────────────
def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _row(ob, names: Dict[int, str], now: datetime) -> Dict[str, Any]:
    return {"id": ob.id, "kind": ob.kind, "user_id": ob.user_id, "user": names.get(ob.user_id), "status": ob.status,
            "version": ob.document_version, "requested_at": _iso(ob.requested_at), "due_date": _iso(ob.due_date),
            "done_at": _iso(ob.done_at), "comment": ob.comment, "assignment_id": ob.assignment_id,
            "overdue": bool(ob.status == "pending" and ob.due_date and ob.due_date < now),
            "escalation_level": ob.escalation_level or 0, "task_id": ob.critical_task_id}


def timeline(db, doc, names: Dict[int, str], obligations) -> List[Dict[str, Any]]:
    from ...models import DocumentAuditLog

    events: List[Dict[str, Any]] = []
    audit = (db.query(DocumentAuditLog).filter(DocumentAuditLog.document_id == doc.id)
             .order_by(DocumentAuditLog.performed_at.desc(), DocumentAuditLog.id.desc()).limit(300).all())
    names.update(_names(db, {a.performed_by for a in audit} - set(names)))
    for a in audit:
        events.append({"at": _iso(a.performed_at), "kind": a.action, "actor": names.get(a.performed_by), "detail": a.action_details,
                       "from": a.old_value, "to": a.new_value})
    # requests made together (one send, one publication) are one event, not one line per person
    asked: Dict[tuple, list] = {}
    for ob in obligations:
        asked.setdefault((ob.kind, ob.requested_by, ob.requested_at.strftime("%Y-%m-%d %H:%M")), []).append(ob)
    for (kind, by, _minute), group in asked.items():
        people = [names.get(o.user_id) for o in group]
        shown = ", ".join(people[:4]) + (f" and {len(people) - 4} more" if len(people) > 4 else "")
        due = group[0].due_date
        events.append({"at": _iso(min(o.requested_at for o in group)), "kind": f"{kind}_requested", "actor": names.get(by),
                       "detail": f"{_VERB[kind]} asked of {shown}" + (f", due {due:%Y-%m-%d}" if due else ""), "from": None, "to": shown})
    for ob in obligations:
        who = names.get(ob.user_id)
        if ob.escalated_at:
            events.append({"at": _iso(ob.escalated_at), "kind": "escalated", "actor": None,
                           "detail": f"{_VERB[ob.kind]} by {who} is overdue; "
                                     + ("the document owner was told" if (ob.escalation_level or 0) < 2 else "the tenant administrators were told"),
                           "from": None, "to": who})
    return sorted(events, key=lambda e: e["at"] or "", reverse=True)


def state(db, doc, user) -> Dict[str, Any]:
    from ...models import DocumentObligation

    now = datetime.utcnow()
    obs = db.query(DocumentObligation).filter(DocumentObligation.document_id == doc.id).order_by(DocumentObligation.id).all()
    names = _names(db, {o.user_id for o in obs} | {o.requested_by for o in obs} | {doc.owner_id, doc.author_id})
    rows = [_row(o, names, now) for o in obs]
    acks = [r for r in rows if r["kind"] == "acknowledgement" and r["status"] in ("pending", "done")]
    done = sum(1 for r in acks if r["status"] == "done")
    return {
        "enabled": True,
        "document": {"id": doc.id, "title": doc.title, "status": doc.status, "version": doc.current_version,
                     "owner": names.get(doc.owner_id), "author": names.get(doc.author_id)},
        "approvals": [r for r in rows if r["kind"] in ("review", "approval")],
        "acknowledgements": {"total": len(acks), "done": done, "pending": len(acks) - done,
                             "overdue": sum(1 for r in acks if r["overdue"]),
                             "percent": round(100 * done / len(acks)) if acks else 0, "people": acks},
        "mine": [r for r in rows if r["user_id"] == user.id and r["status"] == "pending"],
        "me": {"id": user.id},                        # so the screen can say "you"
        "timeline": timeline(db, doc, names, obs),
    }


# ── the daily sweep ──────────────────────────────────────────────────────────
def sweep(db) -> Dict[str, int]:
    """Add acknowledgements for users who joined since, remind, and escalate. Called per tenant by the scheduler."""
    from ...models import CriticalTask, DocumentObligation, GovernanceDocument
    from ..access_review.sampling import privileged_user_ids

    out = {"asked": 0, "reminded": 0, "owner_told": 0, "admins_told": 0, "emailed": 0}
    if not enabled(db):
        return out
    for doc in db.query(GovernanceDocument).filter(GovernanceDocument.status == "published").all():
        out["asked"] += _ensure_acknowledgements(db, doc) or 0
    now = datetime.utcnow()
    pending = (db.query(DocumentObligation).filter(DocumentObligation.status == "pending", DocumentObligation.due_date.isnot(None))
               .order_by(DocumentObligation.document_id).all())
    docs = {d.id: d for d in db.query(GovernanceDocument).filter(GovernanceDocument.id.in_({o.document_id for o in pending} or {0}))}
    cfg = settings(db, next(iter(docs.values())).tenant_id) if docs else dict(DEFAULTS)
    out["emailed"] = _email_waiting(db, pending, docs)
    owner_notes: Dict[int, List[str]] = {}
    admin_notes: Dict[int, List[str]] = {}
    names = _names(db, {o.user_id for o in pending})
    for ob in pending:
        doc = docs.get(ob.document_id)
        if doc is None:
            continue
        ct = db.get(CriticalTask, ob.critical_task_id) if ob.critical_task_id else None
        if now < ob.due_date:
            if ob.reminded_at is None and ob.due_date - now <= timedelta(days=cfg["remind_days"]):
                _notify(db, doc, [ob.user_id], f"Due soon: {_VERB[ob.kind]} {doc.title}",
                        f"You are asked to {_VERB[ob.kind].lower()} \"{doc.title}\" by {ob.due_date:%d %b %Y}.", "warning", email=True)
                ob.reminded_at = now
                out["reminded"] += 1
            continue
        line = f"{names.get(ob.user_id)} ({_VERB[ob.kind].lower()}, due {ob.due_date:%d %b})"
        if (ob.escalation_level or 0) < 1:
            ob.escalation_level, ob.escalated_at = 1, now
            _notify(db, doc, [ob.user_id], f"Overdue: {_VERB[ob.kind]} {doc.title}", f"\"{doc.title}\" is overdue for you.", "error", email=True)
            owner_notes.setdefault(doc.id, []).append(line)
        elif ob.escalation_level < 2 and now - ob.due_date >= timedelta(days=cfg["admin_after_days"]):
            ob.escalation_level, ob.escalated_at = 2, now
            admin_notes.setdefault(doc.id, []).append(line)
        else:
            continue
        if ct is not None:
            ct.escalation_level = ob.escalation_level
    admins = sorted(privileged_user_ids(db, next(iter(docs.values())).tenant_id)) if admin_notes else []
    for doc_id, lines in owner_notes.items():
        doc = docs[doc_id]
        _notify(db, doc, [doc.owner_id, doc.author_id], f"Overdue on \"{doc.title}\"", "Overdue: " + "; ".join(lines[:20])
                + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error", email=True)
        out["owner_told"] += len(lines)
    for doc_id, lines in admin_notes.items():
        doc = docs[doc_id]
        _notify(db, doc, admins, f"Still overdue on \"{doc.title}\"", "A week overdue: " + "; ".join(lines[:20])
                + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error", email=True)
        out["admins_told"] += len(lines)
    db.commit()
    return out


def _email_waiting(db, pending, docs) -> int:
    """People asked to acknowledge get one email listing what is waiting, not one per document (the first alert was in-app
    only, because publishing a document asks the whole organisation at once). Returns how many people were emailed."""
    todo: Dict[int, list] = {}
    for ob in pending:
        if ob.emailed_at is None and ob.kind == "acknowledgement" and ob.document_id in docs:
            todo.setdefault(ob.user_id, []).append(ob)
    if not todo:
        return 0
    anchor = next(iter(docs.values()))
    if not settings(db, anchor.tenant_id)["email"]:
        return 0
    for uid, items in todo.items():
        titles = sorted({docs[o.document_id].title for o in items})
        _notify(db, anchor, [uid], f"{len(titles)} document(s) to acknowledge",
                "Please read and acknowledge: " + "; ".join(titles[:15]) + (f" and {len(titles) - 15} more" if len(titles) > 15 else "") + ".",
                "info", email=True)
        for ob in items:
            ob.emailed_at = datetime.utcnow()
    return len(todo)


def mine(db, user_id: int) -> list:
    """Everything the user is currently asked to do on documents, across documents."""
    from ...models import DocumentObligation, GovernanceDocument

    now = datetime.utcnow()
    rows = (db.query(DocumentObligation, GovernanceDocument).join(GovernanceDocument, GovernanceDocument.id == DocumentObligation.document_id)
            .filter(DocumentObligation.user_id == user_id, DocumentObligation.status == "pending")
            .order_by(DocumentObligation.due_date.asc(), DocumentObligation.id).all())
    return [{"id": ob.id, "kind": ob.kind, "document_id": d.id, "title": d.title, "doc_type": d.doc_type, "status": d.status,
             "version": ob.document_version, "due_date": _iso(ob.due_date), "overdue": bool(ob.due_date and ob.due_date < now),
             "escalation_level": ob.escalation_level or 0} for ob, d in rows]
