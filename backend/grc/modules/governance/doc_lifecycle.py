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

APPROVAL_DAYS = int(os.getenv("DOCUMENT_APPROVAL_DUE_DAYS", "7"))
ACK_DAYS = int(os.getenv("DOCUMENT_ACK_DUE_DAYS", "14"))
REMIND_DAYS = 3             # a reminder this many days before the due date
ADMIN_AFTER_DAYS = 7        # tenant administrators are told this long after the due date
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


def _notify(db, doc, user_ids: Iterable[Optional[int]], subject: str, message: str, kind: str = "info") -> None:
    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return
    try:
        from ..workflow_engine.services.notification_service import send_workflow_notification

        send_workflow_notification(db, tenant_id=doc.tenant_id, subject=subject[:500], message=message,
                                   workflow_instance_id=None, user_ids=ids, channels=["in_app"], notification_type=kind)
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
        asked += _request(db, doc, kind, _resolve_target_users(db, [doc.tenant_id], a.target_type, a.target_id), by, APPROVAL_DAYS, a.id)
    _notify(db, doc, asked, f"{_VERB[kind]} requested: {doc.title}",
            f"You have been asked to {'review' if kind == 'review' else 'approve'} \"{doc.title}\". "
            f"It is in your tasks and under Governance > Documents > Approvals & Acknowledgements.", "warning")


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
                f"\"{doc.title}\" has been approved by all its approvers and can be published.", "success")


@_safe
def on_rejected(db, doc, user_id: int, role_type: str, comment: str) -> None:
    now = datetime.utcnow()
    for ob in _pending(db, doc.id, [_STAGE_KIND[role_type]], user_id).all():
        ob.status, ob.done_at, ob.comment = "rejected", now, comment
        _close(db, ob, completed=True, by=user_id)
    _cancel(db, doc, ("review", "approval"))
    who = _names(db, [user_id]).get(user_id, "A reviewer")
    _notify(db, doc, [doc.owner_id, doc.author_id], f"Rejected: {doc.title}", f"{who} rejected \"{doc.title}\": {comment}", "error")


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


@_safe
def on_status_changed(db, doc, old: Optional[str], new: Optional[str], by: Optional[int] = None) -> None:
    if old in _PENDING_STAGE and new not in _PENDING_STAGE:
        _cancel(db, doc, ("review", "approval"))
    if old == "published" and new != "published":
        _cancel(db, doc, ("acknowledgement",))
    if new == "published" and old != "published":
        _ensure_acknowledgements(db, doc, by)


def _ensure_acknowledgements(db, doc, by: Optional[int] = None) -> int:
    from ...models import DocumentObligation, GRCUser

    if doc.status != "published":
        return 0
    have = {uid for (uid,) in db.query(DocumentObligation.user_id).filter(
        DocumentObligation.document_id == doc.id, DocumentObligation.kind == "acknowledgement",
        DocumentObligation.status.in_(("pending", "done")))}
    wanted = [uid for (uid,) in db.query(GRCUser.id).filter(GRCUser.is_active.is_(True)).order_by(GRCUser.id) if uid not in have]
    asked = _request(db, doc, "acknowledgement", wanted, by or doc.published_by, ACK_DAYS)
    _notify(db, doc, asked, f"Please acknowledge: {doc.title}",
            f"\"{doc.title}\" has been published. Read it and acknowledge it before the due date; it is in your tasks.", "info")
    return len(asked)


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
                     action_details=f"{name} acknowledged version {doc.current_version}" + (f": {comment}" if comment else ""),
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
    for ob in obligations:
        who = names.get(ob.user_id)
        events.append({"at": _iso(ob.requested_at), "kind": f"{ob.kind}_requested", "actor": names.get(ob.requested_by),
                       "detail": f"{_VERB[ob.kind]} asked of {who}, due {ob.due_date:%Y-%m-%d}" if ob.due_date else f"{_VERB[ob.kind]} asked of {who}",
                       "from": None, "to": who})
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
        "timeline": timeline(db, doc, names, obs),
    }


# ── the daily sweep ──────────────────────────────────────────────────────────
def sweep(db) -> Dict[str, int]:
    """Add acknowledgements for users who joined since, remind, and escalate. Called per tenant by the scheduler."""
    from ...models import CriticalTask, DocumentObligation, GovernanceDocument
    from ..access_review.sampling import privileged_user_ids

    out = {"asked": 0, "reminded": 0, "owner_told": 0, "admins_told": 0}
    if not enabled(db):
        return out
    for doc in db.query(GovernanceDocument).filter(GovernanceDocument.status == "published").all():
        out["asked"] += _ensure_acknowledgements(db, doc) or 0
    now = datetime.utcnow()
    pending = (db.query(DocumentObligation).filter(DocumentObligation.status == "pending", DocumentObligation.due_date.isnot(None))
               .order_by(DocumentObligation.document_id).all())
    docs = {d.id: d for d in db.query(GovernanceDocument).filter(GovernanceDocument.id.in_({o.document_id for o in pending} or {0}))}
    owner_notes: Dict[int, List[str]] = {}
    admin_notes: Dict[int, List[str]] = {}
    names = _names(db, {o.user_id for o in pending})
    for ob in pending:
        doc = docs.get(ob.document_id)
        if doc is None:
            continue
        ct = db.get(CriticalTask, ob.critical_task_id) if ob.critical_task_id else None
        if now < ob.due_date:
            if ob.reminded_at is None and ob.due_date - now <= timedelta(days=REMIND_DAYS):
                _notify(db, doc, [ob.user_id], f"Due soon: {_VERB[ob.kind]} {doc.title}",
                        f"You are asked to {_VERB[ob.kind].lower()} \"{doc.title}\" by {ob.due_date:%d %b %Y}.", "warning")
                ob.reminded_at = now
                out["reminded"] += 1
            continue
        line = f"{names.get(ob.user_id)} ({_VERB[ob.kind].lower()}, due {ob.due_date:%d %b})"
        if (ob.escalation_level or 0) < 1:
            ob.escalation_level, ob.escalated_at = 1, now
            _notify(db, doc, [ob.user_id], f"Overdue: {_VERB[ob.kind]} {doc.title}", f"\"{doc.title}\" is overdue for you.", "error")
            owner_notes.setdefault(doc.id, []).append(line)
        elif ob.escalation_level < 2 and now - ob.due_date >= timedelta(days=ADMIN_AFTER_DAYS):
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
                + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error")
        out["owner_told"] += len(lines)
    for doc_id, lines in admin_notes.items():
        doc = docs[doc_id]
        _notify(db, doc, admins, f"Still overdue on \"{doc.title}\"", "A week overdue: " + "; ".join(lines[:20])
                + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error")
        out["admins_told"] += len(lines)
    db.commit()
    return out
