"""A governance document's life as per-person obligations (tenants in ``config.DOCUMENT_LIFECYCLE_TENANTS``; "*" = all, the default).

The sign-off flow (routers/document_signoff.py) decides *whether* a document is approved. This module records *who is
being asked, by when, and what they did*:

* ``review`` / ``approval`` - one row per person for the stage the document is in (a role or team is expanded to its
  members; the first member to sign satisfies it and the others' rows are cancelled);
* ``acknowledgement`` - one row per person of the tenant, once per major version (2.0 asks again, 2.1 does not), when it is
  published (people who join later are added by the daily sweep, on documents whose acknowledgements were asked for:
  switching the life cycle on asks nobody about documents published before). It is for the version in force
  (``permissions.in_force_number``): while a new version is in review the published one stays in force and acknowledgeable;
  only archiving, expiry or an exception withdraws the requests. At the next publication a major version cancels the waiting
  requests and asks again; a minor one moves them up, keeping their due dates and escalation (the user's decisions of 2026-10-17).

Only people are asked (``_people``): active users who signed up here or through the organisation's SSO, or who signed in at
least once. An identity an access-review connector imported (a cloud account, a directory entry) that never signed in is not.

Every pending row has a twin in Task Management (``grc_critical_tasks``, source_module ``document_lifecycle``) and an
in-app alert, so it shows up with the person's other work. The twin cannot be completed from Task Management - signing
or acknowledging in the document does that (its buttons open the document there, ``task_request``); its person, due date and
status are read-only there and only an administrator may delete it (``locked_change``, ``DELETE_REFUSED``); it shows only to the
person asked and to whoever may read the document (``may_see_task``, ``without_others_tasks``). A sweep reminds before the due date (and again every few days, if set), tells
the person when it is overdue, then the document owner, then the tenant administrators (or a chosen role); the days, the
channels of every alert and the tasks are the organisation's (Governance > Settings, ``settings``). Nothing here may stop a
sign-off: the hooks swallow their own errors.
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional

from . import permissions

logger = logging.getLogger(__name__)

# Defaults, overridable per organisation (Governance > Settings; ``settings``). Keys are only ever added, never renamed.
KINDS = ("review", "approval", "acknowledgement")
EVENTS = ("request", "reminder", "overdue", "escalation", "approved", "published", "rejected")
CHANNELS: Dict[str, tuple] = {"in_app": ("in_app",), "email": ("email",), "both": ("in_app", "email"), "off": ()}
PRIORITIES = ("Critical", "High", "Medium", "Low")              # Task Management's
PLACEHOLDERS = ("document", "version", "due_date", "action", "owner", "link", "verb")
DEFAULTS: Dict[str, Any] = {
    "approval_days": int(os.getenv("DOCUMENT_APPROVAL_DUE_DAYS", "7")),     # an approver (and a reviewer, unless review_days) is given this long
    "ack_days": int(os.getenv("DOCUMENT_ACK_DUE_DAYS", "14")),              # an acknowledgement is given this long
    "remind_days": 3,                                                       # a reminder this many days before the due date
    "admin_after_days": 7,                                                  # the escalation (administrators, or escalate_role_id) this long after the due date
    "email": True,                                                          # older single switch: read when "notify" was never saved
    "review_days": None,                                                    # a reviewer is given this long (None: approval_days)
    "remind_every_days": 0,                                                 # then again every this many days until done (0: once)
    "owner_after_days": 0,                                                  # the document owner is told this long after the due date
    "escalate_role_id": None,                                               # the members of this role are the escalation (None: administrators)
    "notify": {e: "both" for e in EVENTS},                                  # per event: in_app | email | both | off
    "task_create": {k: True for k in KINDS},                                # a Task Management task for each request
    "task_priority": {"review": "High", "approval": "High", "acknowledgement": "Medium"},
    "task_title": "{action}: {document}",
    # plain words; Task Management shows the links as buttons (task_request), never as a path in the text
    "task_description": "Please {verb} \"{document}\", version {version}, by {due_date}.",
    "task_category": "Compliance",                                          # the Task Management category of every request's task
}
_LIMITS = {"approval_days": (1, 365), "ack_days": (1, 365), "remind_days": (0, 60), "admin_after_days": (1, 365),
           "review_days": (1, 365), "remind_every_days": (0, 60), "owner_after_days": (0, 365)}
_LABELS = {"approval_days": "Days to approve", "review_days": "Days to review", "ack_days": "Days to acknowledge",
           "remind_days": "Days before the due date for the first reminder", "remind_every_days": "Days between reminders",
           "owner_after_days": "Days overdue before the owner is told", "admin_after_days": "Days overdue before escalating further"}
_MAPS = {"notify": (EVENTS, CHANNELS), "task_create": (KINDS, None), "task_priority": (KINDS, PRIORITIES)}
_TEMPLATES = {"task_title": ("Task title", 200), "task_description": ("Task description", 2000)}
SOURCE_MODULE = "document_lifecycle"
SOURCE_TYPE = "DocumentObligation"
_STAGE_KIND = {"reviewer": "review", "approver": "approval"}
_VERB = {"review": "Review", "approval": "Approve", "acknowledgement": "Acknowledge"}
_STEP = {"review": "review and sign", "approval": "approve and sign", "acknowledgement": "acknowledge"}     # {verb}
ACTION_LABEL = {"review": "Review and sign", "approval": "Approve and sign", "acknowledgement": "Acknowledge"}
_ACT = {"review": "sign", "approval": "sign", "acknowledgement": "ack"}      # ?act= on the document page opens that popup
_NOUN = {"review": "Review", "approval": "Approval", "acknowledgement": "Acknowledgement"}
_PENDING_STAGE = ("pending_review", "pending_approval")


def _link(doc, kind: str = "") -> str:
    """Where a notification or a task about ``doc`` opens: the document itself to acknowledge it, else its Approvals."""
    return f"/governance/documents/{doc.id}" + ("" if kind == "acknowledgement" else "?tab=lifecycle")


def _app_url(path: str) -> str:
    """``path`` as an address to click outside the app (a task's text): absolute when the app's address is set, as the emails
    make their buttons (workflow_engine notification_service); else the path itself."""
    return (os.environ.get("FRONTEND_URL") or os.environ.get("NEXT_PUBLIC_APP_URL") or "").rstrip("/") + path


def enabled(db) -> bool:
    from ...config import DOCUMENT_LIFECYCLE_TENANTS
    from ...models import Tenant

    tenant = db.query(Tenant).first()
    return bool(tenant and ("*" in DOCUMENT_LIFECYCLE_TENANTS or (tenant.slug or "").lower() in DOCUMENT_LIFECYCLE_TENANTS))


def _no_email(channel: str) -> str:
    return "in_app" if "email" in CHANNELS.get(channel, ()) else channel


def resolved(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Every setting, from what was saved (``raw``) over the defaults: maps keep the entries added since, review_days follows
    approval_days until it is set, and "notify" follows the older ``email`` switch until it is saved itself."""
    out = {**DEFAULTS, **{k: v for k, v in raw.items() if k in DEFAULTS}}
    for key, (names, _allowed) in _MAPS.items():
        saved = raw.get(key) if isinstance(raw.get(key), dict) else {}
        out[key] = {n: saved.get(n, DEFAULTS[key][n]) for n in names}
    if out["review_days"] is None:
        out["review_days"] = out["approval_days"]
    if not isinstance(raw.get("notify"), dict) and not out["email"]:
        out["notify"] = {e: _no_email(c) for e, c in out["notify"].items()}
    out["email"] = any("email" in CHANNELS.get(c, ()) for c in out["notify"].values())
    return out


def _stored(db, tenant_id: int):
    from ...models import DocumentLifecycleSettings

    return db.query(DocumentLifecycleSettings).filter(DocumentLifecycleSettings.tenant_id == tenant_id).first()


def settings(db, tenant_id: int) -> Dict[str, Any]:
    row = _stored(db, tenant_id)
    return resolved((row.config if row else None) or {})


def _template_problem(label: str, text: str) -> Optional[str]:
    from string import Formatter

    try:
        fields = [(name, spec, conv) for _lit, name, spec, conv in Formatter().parse(text) if name is not None]
    except ValueError:
        return f"{label}: a {{ or }} is not closed. Placeholders look like {{document}}."
    for name, spec, conv in fields:
        if name not in PLACEHOLDERS or spec or conv:
            return f"{label}: {{{name}}} is not a placeholder. Use " + ", ".join(f"{{{p}}}" for p in PLACEHOLDERS) + "."
    return None


def _valid(db, tenant_id: int, key: str, value: Any, current: Dict[str, Any]) -> Any:
    """One setting as it is stored, or ValueError with a message for the person."""
    if key == "email":
        return bool(value)
    if key in _LIMITS:
        low, high = _LIMITS[key]
        try:
            number = int(value)
        except (TypeError, ValueError):
            number = None
        if number is None or isinstance(value, bool) or not low <= number <= high:
            raise ValueError(f"{_LABELS[key]} must be a whole number from {low} to {high}.")
        return number
    if key == "escalate_role_id":
        if value in (None, "", 0):
            return None
        from ...models import Role

        role = db.query(Role).filter(Role.id == int(value), Role.tenant_id == tenant_id).first() if str(value).isdigit() else None
        if role is None:
            raise ValueError("The role chosen for escalation no longer exists. Choose another, or the administrators.")
        return role.id
    if key in _MAPS:
        names, allowed = _MAPS[key]
        if not isinstance(value, dict):
            raise ValueError(f"{key} must be a list of choices.")
        merged = dict(current[key])
        for name, choice in value.items():
            if name not in names:
                raise ValueError(f"Unknown entry in {key}: {name}.")
            if allowed is None:
                merged[name] = bool(choice)
            elif choice not in allowed:
                raise ValueError(f"{choice} is not one of " + ", ".join(allowed) + ".")
            else:
                merged[name] = choice
        return merged
    if key == "task_category":
        text = str(value or "").strip()
        if not text or len(text) > 100:
            raise ValueError("Task category must be 1 to 100 characters.")
        return text
    label, limit = _TEMPLATES[key]
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{label} cannot be empty.")
    if len(text) > limit:
        raise ValueError(f"{label} is too long (at most {limit} characters).")
    problem = _template_problem(label, text)
    if problem:
        raise ValueError(problem)
    return text


def save_settings(db, tenant_id: int, patch: Dict[str, Any], user_id: Optional[int] = None) -> Dict[str, Any]:
    """Validate and save ``patch`` (only the keys it names); returns every setting. Raises ValueError for the person to read."""
    from ...models import DocumentLifecycleSettings

    row = _stored(db, tenant_id)
    raw = {k: v for k, v in ((row.config if row else None) or {}).items() if k in DEFAULTS}
    for key, value in (patch or {}).items():
        if key not in DEFAULTS:
            raise ValueError(f"Unknown setting: {key}")
        raw[key] = _valid(db, tenant_id, key, value, resolved(raw))
    if "email" in (patch or {}) and "notify" not in (patch or {}):        # an older screen's single switch
        if not raw["email"]:
            raw["notify"] = {e: _no_email(c) for e, c in resolved(raw)["notify"].items()}
        elif not resolved(raw)["email"]:
            raw.pop("notify", None)                                        # back on: the default channels
    out = resolved(raw)
    if out["admin_after_days"] <= out["owner_after_days"]:
        raise ValueError("Escalate further later than the owner is told: make its days overdue larger.")
    raw["email"] = out["email"]                                            # kept for anything still reading the single switch
    if row is None:
        row = DocumentLifecycleSettings(tenant_id=tenant_id, config={})
        db.add(row)
    row.config, row.updated_by, row.updated_at = dict(raw), user_id, datetime.utcnow()
    db.commit()
    return out


# ── typed getters (what the life cycle and Task Management read) ─────────────
@dataclass(frozen=True)
class TaskSettings:
    """How a request becomes a Task Management task (Governance > Settings > Task creation)."""
    create: bool
    priority: str
    title: str              # templates with PLACEHOLDERS, rendered by ``render``
    description: str
    category: str = DEFAULTS["task_category"]


def due_days(cfg: Dict[str, Any], kind: str) -> int:
    """How many days a request of ``kind`` is given."""
    return cfg["ack_days"] if kind == "acknowledgement" else cfg["review_days"] if kind == "review" else cfg["approval_days"]


def channels(cfg: Dict[str, Any], event: str) -> List[str]:
    """Where an alert about ``event`` goes: in_app and/or email, or nowhere."""
    return list(CHANNELS.get(cfg["notify"].get(event, "both"), ()))


def task_settings(cfg: Dict[str, Any], kind: str) -> TaskSettings:
    return TaskSettings(create=bool(cfg["task_create"].get(kind, True)), priority=cfg["task_priority"].get(kind) or "Medium",
                        title=cfg["task_title"], description=cfg["task_description"], category=cfg["task_category"])


def render(template: str, values: Dict[str, Any], fallback: str) -> str:
    """A template with its placeholders filled; the default one when it cannot be (saved by hand, a placeholder since removed)."""
    try:
        return template.format(**values)
    except (KeyError, ValueError, IndexError, AttributeError):
        return fallback.format(**values)


def task_values(db, ob, doc, spec: Optional[TaskSettings] = None) -> Dict[str, str]:
    """What a task's placeholders say for one request (the owner's name is looked up only when ``spec`` uses it)."""
    owner = "-"
    if doc.owner_id and (spec is None or "{owner}" in spec.title + spec.description):
        owner = _names(db, [doc.owner_id]).get(doc.owner_id, "-")
    return {"document": doc.title or "", "version": ob.document_version or doc.current_version or "",
            "due_date": f"{ob.due_date:%d %b %Y}" if ob.due_date else "no date", "action": _VERB[ob.kind],
            "owner": owner, "link": _app_url(_link(doc, ob.kind)), "verb": _STEP[ob.kind]}


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
def _people(db, ids: Optional[Iterable[int]] = None) -> List[int]:
    """The active users who are people (of ``ids``, or all): platform accounts (auth_router.platform_account), not accounts an
    access-review connector imported."""
    from ...models import GRCUser
    from ...routers.auth_router import platform_account

    q = db.query(GRCUser.id).filter(GRCUser.is_active.is_(True), platform_account())
    if ids is not None:
        q = q.filter(GRCUser.id.in_({int(i) for i in ids if i}))
    return [uid for (uid,) in q.order_by(GRCUser.id)]


def _members(db, doc, a) -> List[int]:
    """Who a sign-off participant asks: the people among the chosen user or a role's or a team's members (an account an access
    review imported that was named before the pickers left such accounts out is not asked; the daily sweep would cancel it)."""
    from .routers.document_signoff import _resolve_target_users

    return _people(db, _resolve_target_users(db, [doc.tenant_id], a.target_type, a.target_id))


def _names(db, ids: Iterable[int]) -> Dict[int, str]:
    from ...models import GRCUser

    ids = {int(i) for i in ids if i}
    rows = db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(ids)).all() if ids else []
    return {i: (d or u or f"User #{i}") for i, d, u in rows}


def _notify(db, doc, user_ids: Iterable[Optional[int]], subject: str, message: str, kind: str = "info", email: bool = False,
            link: Optional[str] = None, event: Optional[str] = None, only: Iterable[str] = ("in_app", "email")) -> int:
    """An alert on the channels the organisation chose for ``event`` (Governance > Settings; without an event: in-app, and email
    too when ``email`` and the organisation has email on), of those in ``only``. Email needs the organisation's email set up.
    Both say where to open it (``link``, the document's Approvals by default). Returns how many emails were sent."""
    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return 0
    link = link or _link(doc)
    try:
        from ..workflow_engine.services.notification_service import send_workflow_notification

        cfg = settings(db, doc.tenant_id)
        sent_to = channels(cfg, event) if event else ["in_app", "email"] if email and cfg["email"] else ["in_app"]
        sent_to = [c for c in sent_to if c in only]
        if not sent_to:
            return 0
        out = send_workflow_notification(db, tenant_id=doc.tenant_id, subject=subject[:500], message=message,
                                         workflow_instance_id=None, user_ids=ids, channels=sent_to, notification_type=kind, link=link)
        return sum(1 for r in (out or {}).get("results") or [] if ((r or {}).get("email_result") or {}).get("success"))
    except Exception:       # noqa: BLE001
        logger.exception("document lifecycle: could not alert users %s", ids)
        return 0


def _history(db, task_id: int, user_id: Optional[int], action: str, field=None, old=None, new=None) -> None:
    from ...models import CriticalTaskHistory

    db.add(CriticalTaskHistory(task_id=task_id, user_id=user_id, action=action, field_changed=field,
                               old_value=None if old is None else str(old), new_value=None if new is None else str(new)))


def _open_twin(db, ob, doc, by: Optional[int], cfg: Optional[Dict[str, Any]] = None) -> None:
    """The request's Task Management task, as Governance > Settings > Task creation says (none when it is switched off)."""
    from ...models import CriticalTask

    spec = task_settings(cfg or settings(db, ob.tenant_id), ob.kind)
    if not spec.create:
        return
    values = task_values(db, ob, doc, spec)
    ct = CriticalTask(
        tenant_id=ob.tenant_id, title=render(spec.title, values, DEFAULTS["task_title"])[:255],
        description=render(spec.description, values, DEFAULTS["task_description"]),
        source="Governance document", source_module=SOURCE_MODULE, source_entity_type=SOURCE_TYPE,
        source_entity_id=ob.id, category=spec.category[:100], status="Open",
        priority=spec.priority, due_date=ob.due_date,
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


def _request(db, doc, kind: str, user_ids: Iterable[int], by: Optional[int], days: int, assignment_id: Optional[int] = None,
             version: Optional[str] = None) -> List[int]:
    """Ask each person (once) about ``version`` (the newest by default); returns the ones newly asked."""
    from ...models import DocumentObligation

    already = {o.user_id for o in _pending(db, doc.id, [kind])}
    asked: List[int] = []
    cfg = settings(db, doc.tenant_id)
    for uid in dict.fromkeys(int(u) for u in user_ids if u):
        if uid in already:
            continue
        ob = DocumentObligation(tenant_id=doc.tenant_id, document_id=doc.id, kind=kind, user_id=uid, assignment_id=assignment_id,
                                document_version=version or doc.current_version, status="pending", requested_by=by,
                                due_date=datetime.utcnow() + timedelta(days=days))
        db.add(ob)
        db.flush()
        _open_twin(db, ob, doc, by, cfg)
        asked.append(uid)
    return asked


# ── hooks called by the sign-off, publish and participant flows ──────────────
def _open_stage(db, doc, stage: str, by: Optional[int]) -> None:
    """Ask the people of each participant of ``stage`` that nobody has signed for this round (one already signed for is not
    asked again when the participants are saved)."""
    from .routers.document_signoff import _assignments, _resolve_target_users, _signatures

    kind = _STAGE_KIND[stage]
    asked: List[int] = []
    cfg = settings(db, doc.tenant_id)
    days = due_days(cfg, kind)
    db.flush()          # the round just started (the models' listener) must be the one read
    signed = {s.signer_user_id for s in _signatures(db, doc.id) if s.role_type == stage}
    for a in (a for a in _assignments(db, doc.id) if a.role_type == stage):
        if not signed & _resolve_target_users(db, [doc.tenant_id], a.target_type, a.target_id):     # as _stage_complete counts it
            asked += _request(db, doc, kind, _members(db, doc, a), by, days, a.id)
    where = "in your tasks and " if task_settings(cfg, kind).create else ""      # no task when Settings switched them off
    _notify(db, doc, asked, f"{_NOUN[kind]} requested: {doc.title}",
            f"You have been asked to {'review' if kind == 'review' else 'approve'} \"{doc.title}\". "
            f"It is {where}in the document's Approvals.", "warning", event="request")
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
    _advanced(db, doc, user_id, advanced_to)


@_safe
def on_advanced(db, doc, by: Optional[int], advanced_to: Optional[str]) -> None:
    """The stage ended without a signature just now (``recheck_stage``: a signer who had not signed was removed): what was still
    asked of it ends, and the next stage is asked as after a last signature."""
    _cancel(db, doc, ("review", "approval"))
    _advanced(db, doc, by, advanced_to)


def _advanced(db, doc, by: Optional[int], advanced_to: Optional[str]) -> None:
    """After a stage ended: the approvers are asked, or the owner and whoever may publish it are told it is approved."""
    if advanced_to == "pending_approval":
        _open_stage(db, doc, "approver", by)
    elif advanced_to == "draft":                 # reviewed, but none of its named approvers can sign it
        _notify(db, doc, {doc.owner_id, doc.author_id}, f"Choose other approvers: {doc.title}",
                f"\"{doc.title}\" has been reviewed, but none of its approvers can sign it, so it is a draft again. "
                "Choose other approvers and send it for review.", "warning", event="rejected")
    elif advanced_to == "approved":
        from .permissions import publisher_ids

        # the owner, and whoever may publish it (the owner often may not)
        _notify(db, doc, {doc.owner_id, doc.author_id} | publisher_ids(db), f"Approved: {doc.title}",
                f"\"{doc.title}\" has been approved by all its approvers and can be published.", "success", event="approved")


@_safe
def on_rejected(db, doc, user_id: int, role_type: str, comment: str) -> None:
    now = datetime.utcnow()
    for ob in _pending(db, doc.id, [_STAGE_KIND[role_type]], user_id).all():
        ob.status, ob.done_at, ob.comment = "rejected", now, comment
        _close(db, ob, completed=True, by=user_id)
    _cancel(db, doc, ("review", "approval"))
    who = _names(db, [user_id]).get(user_id, "A reviewer")
    _notify(db, doc, [doc.owner_id, doc.author_id], f"Rejected: {doc.title}", f"{who} rejected \"{doc.title}\": {comment}", "error", event="rejected")


@_safe
def on_participants_changed(db, doc, by: Optional[int]) -> None:
    from .routers.document_signoff import _assignments

    if doc.status not in _PENDING_STAGE:
        return
    stage = "reviewer" if doc.status == "pending_review" else "approver"
    # the assignment rows are replaced whenever participants are saved, so match on the person, not the row id
    wanted: Dict[int, int] = {}
    for a in (a for a in _assignments(db, doc.id) if a.role_type == stage):
        for uid in _members(db, doc, a):
            wanted.setdefault(uid, a.id)
    for ob in _pending(db, doc.id, [_STAGE_KIND[stage]]).all():
        if ob.user_id in wanted:
            ob.assignment_id = wanted[ob.user_id]
        else:
            ob.status, ob.done_at = "cancelled", datetime.utcnow()
            _close(db, ob, completed=False)
    _open_stage(db, doc, stage, by)


def start_round(db, doc, by: Optional[int] = None) -> Optional[str]:
    """The document went to review or approval from anything else (a change to an approved or published one, a status set by
    hand): a new round with the same reviewers and approvers (the round itself is stamped by the models' status listener, so the
    signatures given before no longer count). With nobody who can sign that stage (none set, or only roles, teams or accounts
    without users of this platform: ``_members``) it goes to the stage that has someone, as Send would, or back to draft to be
    sent. Runs for every organisation, with or without the life cycle. Returns why it moved (also written to the history)."""
    from .routers.document_signoff import _assignments
    from .routers.versions import create_audit_log

    assignments = [a for a in _assignments(db, doc.id) if a.role_type in _STAGE_KIND]
    named = {a.role_type for a in assignments}
    roles = {a.role_type for a in assignments if _members(db, doc, a)}
    stage = "reviewer" if doc.status == "pending_review" else "approver"
    if stage in roles:
        return None
    other = "approver" if stage == "reviewer" else "reviewer"
    to = ("pending_approval" if other == "approver" else "pending_review") if other in roles else "draft"
    if to == "draft" and named:
        why = "None of its reviewers or approvers can sign it, so it is a draft again: choose others and send it for review"
    elif stage in named:
        why = f"None of its {stage}s can sign it, so it goes to its {other}s"
    else:
        why = {"pending_approval": "No reviewers are set, so it goes to its approvers",
               "pending_review": "No approvers are set, so it goes to its reviewers",
               "draft": "Nobody is set to review or approve it, so it is a draft again: choose reviewers and send it for review"}[to]
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="status_changed", field_changed="status",
                     old_value=doc.status, new_value=to, action_details=why)
    doc.status = to
    return why


_ENDED = {("pending_review", "pending_approval"): "Everyone left to review it has signed, so it goes to its approvers",
          ("pending_review", "approved"): "Everyone left to review it has signed and nobody approves it, so it is approved",
          ("pending_approval", "approved"): "Everyone left to approve it has signed, so it is approved",
          ("pending_review", "draft"): "Reviewed, but none of its approvers can sign it, so it is a draft again: choose other approvers and send it for review"}


def recheck_stage(db, doc, by: Optional[int] = None) -> bool:
    """A reviewer or approver was removed (participants saved, the one-off fix of imported accounts): the stage in progress may have
    nobody left who can sign it (``start_round``: the other stage, or a draft) or only people who signed this round
    (``document_signoff.advance_if_complete``: it ends as at a last signature). Either way a history row says why and the next
    stage's people are asked. Runs for every organisation; True when the status changed."""
    from .routers.document_signoff import advance_if_complete
    from .routers.versions import create_audit_log

    was = doc.status
    if was not in _PENDING_STAGE:
        return False
    if start_round(db, doc, by):
        _reask(db, doc, by)                     # the old requests end; the new stage's people are asked
        return True
    to = advance_if_complete(db, doc, [doc.tenant_id], by)
    if to is None:
        return False
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by, action="status_changed", field_changed="status",
                     old_value=was, new_value=to, action_details=_ENDED[(was, to)])
    on_advanced(db, doc, by, to)
    return True


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


def outcome(old: Optional[str], new: Optional[str]) -> str:
    """What ``changed_after_review`` did, as the history and the screen say it after a new version ("" when nothing changed)."""
    if new not in _PENDING_STAGE:
        return "; it is a draft again" if new != old else ""
    who = "its reviewers" if new == "pending_review" else "its approvers"
    return f"; {'signed again from the start by' if old in _PENDING_STAGE else 'sent back to'} {who}"


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
    if new not in ("published",) + permissions.ON_ITS_WAY:          # withdrawn (archived, expired, an exception): nothing in force
        _cancel(db, doc, ("acknowledgement",))
    if new == "published" and old != "published":
        _ensure_acknowledgements(db, doc, by)


def _ensure_acknowledgements(db, doc, by: Optional[int] = None) -> int:
    if permissions.in_force_number(doc) is None:                    # also while a new version is in review: the one in force
        return 0
    return request_acknowledgements(db, doc, None, by or doc.published_by)


def _add_joiners(db, doc) -> int:
    """People who joined since are asked too, but only on a document whose acknowledgements were asked for: one published before
    the life cycle was switched on asks nobody until it is published again (or someone asks for acknowledgements)."""
    from ...models import DocumentObligation

    if doc.acks_everyone_at is None:
        # ponytail: documents asked before the marker existed count as asked of everyone when most people were asked; a request
        # to a few people (a workflow's attestation) does not make the whole organisation follow
        asked = db.query(DocumentObligation.user_id).filter(DocumentObligation.document_id == doc.id,
                                                            DocumentObligation.kind == "acknowledgement").distinct().count()
        if not asked or asked < max(3, len(_people(db)) // 2):
            return 0
        doc.acks_everyone_at = datetime.utcnow()
    return _ensure_acknowledgements(db, doc)


def _major(version: Optional[str]) -> str:
    head = str(version or "").strip().lstrip("vV").split(".")[0]
    return str(int(head)) if head.isdigit() else head


def request_acknowledgements(db, doc, user_ids: Optional[Iterable[int]] = None, by: Optional[int] = None, days: Optional[int] = None) -> int:
    """Ask people (everyone when ``user_ids`` is None) to acknowledge the version in force, those not already asked, nor done for
    this major version (the user's decision of 2026-10-16: 2.0 asks everyone again, 2.1 does not). A request still waiting for an
    earlier version is asked again from today on a new major version, and on a minor one moves up with its due date and
    escalation (2026-10-17)."""
    from ...models import DocumentObligation

    number = permissions.in_force_number(doc) or doc.current_version
    major = _major(number)
    people = _people(db)
    if user_ids is None and doc.acks_everyone_at is None:
        doc.acks_everyone_at = datetime.utcnow()                    # asked of everyone: people who join later are asked too
    pool = people if user_ids is None else [u for u in dict.fromkeys(int(i) for i in user_ids) if u in set(people)]
    wanted = set(pool)              # a workflow asks only some people: the others' requests are left as they are
    for ob in _pending(db, doc.id, ["acknowledgement"]).all():
        if ob.user_id not in wanted or ob.document_version == number:
            continue
        if ob.document_version and _major(ob.document_version) != major:
            ob.status, ob.done_at = "cancelled", datetime.utcnow()
            _close(db, ob, completed=False)
        else:
            ob.document_version = number
    db.flush()                      # tenant sessions do not autoflush: the cancelled requests must not count as pending below
    have = {uid for uid, status, version in db.query(DocumentObligation.user_id, DocumentObligation.status, DocumentObligation.document_version).filter(
        DocumentObligation.document_id == doc.id, DocumentObligation.kind == "acknowledgement",
        DocumentObligation.status.in_(("pending", "done")))
        if status == "pending" or not version or _major(version) == major}      # (a row with no version cannot tell: it counts)
    cfg = settings(db, doc.tenant_id)
    asked = _request(db, doc, "acknowledgement", [u for u in pool if u not in have], by,
                     days or due_days(cfg, "acknowledgement"), version=number)
    _notify(db, doc, asked, f"Please acknowledge: {doc.title}",
            f"\"{doc.title}\" has been published. Read it and acknowledge it before the due date"
            + ("; it is in your tasks." if task_settings(cfg, "acknowledgement").create else "."), "info",
            link=_link(doc, "acknowledgement"), event="published", only=("in_app",))    # its email: one daily list per person (_email_waiting)
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
    """The current user acknowledges the version in force (while a new one is in review, the one published). A drawn signature is
    optional and, when given, is sealed like a sign-off, with the fingerprint of that version."""
    from ...models import DocumentObligation
    from ...services import esign
    from .routers.versions import create_audit_log

    number = permissions.in_force_number(doc)
    if number is None:
        raise ValueError("Only a published document can be acknowledged.")
    _add_joiners(db, doc)
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
            signer_title=getattr(user, "designation", None), document=doc, document_version=number,
            content_sha256=esign.document_fingerprint(permissions.in_force_row(db, doc) or doc), request=request)
        ob.esign_id = esig.id
    ob.status, ob.done_at, ob.comment, ob.document_version = "done", datetime.utcnow(), (comment or None), number
    _close(db, ob, completed=True, by=user.id)
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=user.id, action="acknowledged",
                     action_details=f"Acknowledged version {number}" + (f": {comment}" if comment else ""),
                     field_changed="acknowledgement", old_value=None, new_value=name)
    db.commit()
    return ob


# ── Task Management side ─────────────────────────────────────────────────────
DELETE_REFUSED = ("Only an administrator can delete this task. It comes from a document review, approval or acknowledgement "
                  "request and closes by itself when the person does it in the document.")
# what the request decides (who, by when, done or not, which request): read-only in Task Management (critical_tasks_router)
_LOCKED = {
    "assigned_owner_id": "The person on this task is the one asked in the document. To ask someone else, change the document's reviewers or approvers.",
    "assigned_user_ids": "The person on this task is the one asked in the document. To ask someone else, change the document's reviewers or approvers.",
    "due_date": "The due date follows the request in the document; Governance > Settings sets how many days people have.",
    "status": "This task closes by itself when the person does it in the document. Open the document to do it.",
    "source_module": "This task belongs to a document request; what it is linked to cannot be changed.",
    "source_entity_type": "This task belongs to a document request; what it is linked to cannot be changed.",
    "source_entity_id": "This task belongs to a document request; what it is linked to cannot be changed.",
}


LINK_REFUSED = ("A task for a document review, approval or acknowledgement is made by the document's request itself. "
                "Choose another source for this task.")


def _claims(ct) -> bool:
    """Its source says it is one of our tasks; ``is_task`` checks that the request says so too."""
    return ct is not None and ct.source_module == SOURCE_MODULE and ct.source_entity_type == SOURCE_TYPE


def is_task(ct, db=None) -> bool:
    """One of our tasks: the twin a review, approval or acknowledgement request names (only ``_open_twin`` links one). A task that
    only claims the link (typed in Task Management before that was refused, ``refused_link``) is an ordinary task."""
    if not _claims(ct) or not ct.source_entity_id or ct.id is None:
        return False
    from sqlalchemy.orm import object_session

    from ...models import DocumentObligation

    db = db or object_session(ct)
    return db is not None and db.query(DocumentObligation.id).filter(
        DocumentObligation.id == ct.source_entity_id, DocumentObligation.critical_task_id == ct.id).first() is not None


def refused_link(values: Dict[str, Any], ct=None) -> Optional[str]:
    """Why a task created (``ct`` None) or edited in Task Management may not take our source values, or None."""
    for key, ours in (("source_module", SOURCE_MODULE), ("source_entity_type", SOURCE_TYPE)):
        if values.get(key) == ours and (ct is None or getattr(ct, key) != ours):
            return LINK_REFUSED
    return None


def may_see_task(db, user, ct) -> bool:
    """One of our tasks names a document and its version, which may be a draft: it shows to the person asked and to whoever may
    read the document (administrators among them). Any other task: to everyone who sees tasks."""
    from ...models import DocumentObligation, GovernanceDocument

    if not is_task(ct, db) or user.id == ct.assigned_owner_id or user.id in (ct.assigned_user_ids or []):
        return True
    doc = (db.query(GovernanceDocument).join(DocumentObligation, DocumentObligation.document_id == GovernanceDocument.id)
           .filter(DocumentObligation.id == ct.source_entity_id).first())
    return doc is not None and permissions.can_read(db, user, doc)


def without_others_tasks(query, user, reads_all: bool = False):
    """A list of tasks without other people's document tasks (one SQL condition, not a check per task), unless ``reads_all``: the
    person reads every document (``permissions.visible_filter`` is None: administrators, and whoever may edit or publish any).
    Someone who may read only some documents still opens another person's task about one of them by its link (``may_see_task``);
    a list does not check each document for them. The person of our tasks is ``assigned_owner_id`` (locked to the request)."""
    from sqlalchemy import func, or_

    from ...models import CriticalTask

    if reads_all:
        return query
    return query.filter(or_(func.coalesce(CriticalTask.source_module, "") != SOURCE_MODULE, CriticalTask.assigned_owner_id == user.id))


def action_href(document_id: int, kind: str) -> str:
    """The document with the person's own step open (Review and sign / Approve and sign / Acknowledge)."""
    return f"/governance/documents/{document_id}?act={_ACT[kind]}"


def locked_change(ct, changes: Dict[str, Any]) -> Optional[str]:
    """Why an edit from Task Management may not be made to one of our tasks (it would no longer match the request), or None."""
    if not is_task(ct):
        return None
    current = {"assigned_owner_id": ct.assigned_owner_id, "assigned_user_ids": list(ct.assigned_user_ids or []), "due_date": ct.due_date,
               "status": ct.status, "source_module": ct.source_module, "source_entity_type": ct.source_entity_type,
               "source_entity_id": ct.source_entity_id}
    for key, value in changes.items():
        if key in _LOCKED and value != current[key]:
            return _LOCKED[key]
    return None


def task_request(db, ct) -> Optional[Dict[str, Any]]:
    """What Task Management shows on one of our tasks: the document, the person's step, its due date and where to do it. Read
    from the request itself, so tasks made before these fields existed show them too and nothing goes stale (a minor version
    moves a waiting acknowledgement up to the new number). None for other tasks, or when the request is gone."""
    return task_requests(db, [ct]).get(getattr(ct, "id", None))


def task_requests(db, tasks) -> Dict[int, Optional[Dict[str, Any]]]:
    """``task_request`` of every one of our tasks in a list, read with one query (a board lists a hundred tasks, most of them
    acknowledgements): {task id: what it shows, or None when its request is gone or does not name it}."""
    from ...models import DocumentObligation, GovernanceDocument

    ours = [ct for ct in tasks if _claims(ct) and ct.source_entity_id]
    if not ours:
        return {}
    rows = (db.query(DocumentObligation, GovernanceDocument.title).join(GovernanceDocument, GovernanceDocument.id == DocumentObligation.document_id)
            .filter(DocumentObligation.id.in_({ct.source_entity_id for ct in ours})).all())
    found = {ob.id: (ob, title) for ob, title in rows}
    now, out = datetime.utcnow(), {}
    for ct in ours:
        ob, title = found.get(ct.source_entity_id, (None, None))
        if ob is None or ob.critical_task_id != ct.id:          # a task that only claims the link shows nothing of the request
            out[ct.id] = None
            continue
        pending = ob.status == "pending"
        out[ct.id] = {"request_id": ob.id, "kind": ob.kind, "document_id": ob.document_id, "document_title": title,
                      "version": ob.document_version, "status": ob.status, "user_id": ob.user_id, "due_date": _iso(ob.due_date),
                      "done_at": _iso(ob.done_at), "overdue": bool(pending and ob.due_date and ob.due_date < now),
                      "open_href": f"/governance/documents/{ob.document_id}", "action_label": ACTION_LABEL[ob.kind],
                      "action_href": action_href(ob.document_id, ob.kind) if pending else None}
    return out


def sync_from_critical_task(db, critical_task_id: int, user_id: Optional[int] = None) -> None:
    """Task Management changed one of our tasks. It cannot be completed there (signing or acknowledging in the document
    does that), so an attempt is put back."""
    from ...models import CriticalTask, DocumentObligation

    ct = db.get(CriticalTask, critical_task_id)
    if ct is None or ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    ob = db.get(DocumentObligation, ct.source_entity_id)
    if ob is not None and ob.critical_task_id == ct.id and ob.status == "pending" and ct.status in ("Completed", "Verified"):
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


def _row(ob, names: Dict[int, str], now: datetime, seals: Optional[Dict[int, str]] = None) -> Dict[str, Any]:
    return {"id": ob.id, "kind": ob.kind, "user_id": ob.user_id, "user": names.get(ob.user_id), "status": ob.status,
            "version": ob.document_version, "requested_at": _iso(ob.requested_at), "due_date": _iso(ob.due_date),
            "done_at": _iso(ob.done_at), "comment": ob.comment, "assignment_id": ob.assignment_id,
            "overdue": bool(ob.status == "pending" and ob.due_date and ob.due_date < now),
            "escalation_level": ob.escalation_level or 0, "task_id": ob.critical_task_id,
            "esign": {"id": ob.esign_id, "image_sha256": (seals or {}).get(ob.esign_id)} if ob.esign_id else None}


def timeline(db, doc, names: Dict[int, str], obligations, previews: bool = True) -> List[Dict[str, Any]]:
    """Everything that happened to the document, newest first. Without ``previews`` (someone who does not read drafts) a content
    edit's before and after text is left out: it may be a version not in force."""
    from ...models import DocumentAuditLog

    events: List[Dict[str, Any]] = []
    audit = (db.query(DocumentAuditLog).filter(DocumentAuditLog.document_id == doc.id)
             .order_by(DocumentAuditLog.performed_at.desc(), DocumentAuditLog.id.desc()).limit(300).all())
    names.update(_names(db, {a.performed_by for a in audit} - set(names)))
    for a in audit:
        hide = not previews and a.field_changed == "content"
        events.append({"at": _iso(a.performed_at), "kind": a.action, "actor": names.get(a.performed_by), "detail": a.action_details,
                       "from": None if hide else a.old_value, "to": None if hide else a.new_value})
    # requests made together (one send, one publication) are one event, not one line per person
    asked: Dict[tuple, list] = {}
    for ob in obligations:
        asked.setdefault((ob.kind, ob.requested_by, ob.requested_at.strftime("%Y-%m-%d %H:%M")), []).append(ob)
    for (kind, by, _minute), group in asked.items():
        people = [names.get(o.user_id) for o in group]
        shown = ", ".join(people[:4]) + (f" and {len(people) - 4} more" if len(people) > 4 else "")
        due = group[0].due_date
        events.append({"at": _iso(min(o.requested_at for o in group)), "kind": f"{kind}_requested", "actor": names.get(by),
                       "detail": f"{_NOUN[kind]} asked of {shown}" + (f", due {due:%Y-%m-%d}" if due else ""), "from": None, "to": shown})
    further = None
    for ob in obligations:
        who = names.get(ob.user_id)
        if ob.escalated_at:
            if further is None and (ob.escalation_level or 0) >= 2:
                further = _escalation_name(db, settings(db, doc.tenant_id))
            events.append({"at": _iso(ob.escalated_at), "kind": "escalated", "actor": None,
                           "detail": f"{_NOUN[ob.kind]} by {who} is overdue; "
                                     + ("the document owner was told" if (ob.escalation_level or 0) < 2 else f"{further} were told"),
                           "from": None, "to": who})
    return sorted(events, key=lambda e: e["at"] or "", reverse=True)


def state(db, doc, user) -> Dict[str, Any]:
    from ...models import DocumentObligation, ElectronicSignature

    now = datetime.utcnow()
    obs = db.query(DocumentObligation).filter(DocumentObligation.document_id == doc.id).order_by(DocumentObligation.id).all()
    names = _names(db, {o.user_id for o in obs} | {o.requested_by for o in obs} | {doc.owner_id, doc.author_id})
    ids = {o.esign_id for o in obs if o.esign_id}
    seals = dict(db.query(ElectronicSignature.id, ElectronicSignature.image_sha256).filter(ElectronicSignature.id.in_(ids))) if ids else {}
    rows = [_row(o, names, now, seals) for o in obs]
    # one row per person, their newest: a major version asks again, and the version each row is for says what they acknowledged
    newest = {r["user_id"]: r for r in rows if r["kind"] == "acknowledgement" and r["status"] in ("pending", "done")}
    acks = list(newest.values())
    # and who acknowledged an earlier version (asked again by a major one), newest first
    earlier = sorted((r for r in rows if r["kind"] == "acknowledgement" and r["status"] == "done" and newest.get(r["user_id"]) is not r),
                     key=lambda r: r["done_at"] or "", reverse=True)
    done = sum(1 for r in acks if r["status"] == "done")
    return {
        "enabled": True,
        "document": {"id": doc.id, "title": doc.title, "status": doc.status, "version": doc.current_version,
                     "owner": names.get(doc.owner_id), "author": names.get(doc.author_id),
                     "in_force": permissions.in_force_number(doc)},     # what acknowledgements are for (None: nothing in force)
        "approvals": [r for r in rows if r["kind"] in ("review", "approval")],
        "acknowledgements": {"total": len(acks), "done": done, "pending": len(acks) - done,
                             "overdue": sum(1 for r in acks if r["overdue"]),
                             "percent": round(100 * done / len(acks)) if acks else 0, "people": acks, "history": earlier},
        "mine": [r for r in rows if r["user_id"] == user.id and r["status"] == "pending"],
        "me": {"id": user.id},                        # so the screen can say "you"
        "timeline": timeline(db, doc, names, obs, previews=permissions.sees_draft(db, user, doc)),
    }


# ── the daily sweep ──────────────────────────────────────────────────────────
def escalation_ids(db, cfg: Dict[str, Any], tenant_id: Optional[int]) -> List[int]:
    """Who is told when a request is still overdue ``admin_after_days`` after its due date: the people of the chosen role, else
    (or when it has nobody) the tenant administrators."""
    from .permissions import admin_user_ids
    from .routers.document_signoff import _resolve_target_users

    if cfg.get("escalate_role_id") and tenant_id:
        ids = _people(db, _resolve_target_users(db, [tenant_id], "role", cfg["escalate_role_id"]))
        if ids:
            return ids
    return sorted(admin_user_ids(db))


def _escalation_name(db, cfg: Dict[str, Any]) -> str:
    from ...models import Role

    role = db.get(Role, cfg["escalate_role_id"]) if cfg.get("escalate_role_id") else None
    return f"the members of {role.name}" if role else "the tenant administrators"


def drop_non_people(db) -> int:
    """Requests to accounts that are not people (asked before the people rule, e.g. identities a connector imported) end, with
    their tasks, so nobody is reminded or escalated about them and they leave the counts."""
    from ...models import DocumentObligation

    people = set(_people(db))
    gone = [ob for ob in db.query(DocumentObligation).filter(DocumentObligation.status == "pending").all() if ob.user_id not in people]
    for ob in gone:
        ob.status, ob.done_at = "cancelled", datetime.utcnow()
        _close(db, ob, completed=False)
    return len(gone)


def sweep(db) -> Dict[str, int]:
    """Add acknowledgements for people who joined since, remind, and escalate. Called per tenant by the scheduler."""
    from sqlalchemy import and_, or_

    from ...models import CriticalTask, DocumentObligation, GovernanceDocument

    out = {"asked": 0, "reminded": 0, "owner_told": 0, "admins_told": 0, "emailed": 0, "dropped": 0}
    if not enabled(db):
        return out
    out["dropped"] = drop_non_people(db)
    G = GovernanceDocument
    in_force = or_(G.status == "published", and_(G.status.in_(permissions.ON_ITS_WAY), G.published_version.isnot(None)))
    for doc in db.query(G).filter(in_force).order_by(G.id).all():       # joiners are asked for the version in force, in review too
        out["asked"] += _add_joiners(db, doc)
    now = datetime.utcnow()
    pending = (db.query(DocumentObligation).filter(DocumentObligation.status == "pending", DocumentObligation.due_date.isnot(None))
               .order_by(DocumentObligation.document_id).all())
    docs = {d.id: d for d in db.query(GovernanceDocument).filter(GovernanceDocument.id.in_({o.document_id for o in pending} or {0}))}
    tenant_id = next(iter(docs.values())).tenant_id if docs else None
    cfg = settings(db, tenant_id) if docs else resolved({})
    every = timedelta(days=cfg["remind_every_days"]) if cfg["remind_every_days"] else None
    owner_notes: Dict[int, List[str]] = {}
    admin_notes: Dict[int, List[str]] = {}
    names = _names(db, {o.user_id for o in pending})

    def tell(ob, doc, subject: str, message: str, tone: str, event: str) -> None:
        """One email about one request; the list of what waits (``_email_waiting``) then leaves it out, so nobody gets two."""
        out["emailed"] += _notify(db, doc, [ob.user_id], subject, message, tone, link=_link(doc, ob.kind), event=event)
        if "email" in channels(cfg, event) and ob.emailed_at is None:          # emailed (as the list marks what it emailed)
            ob.emailed_at = now

    for ob in pending:
        doc = docs.get(ob.document_id)
        if doc is None:
            continue
        ct = db.get(CriticalTask, ob.critical_task_id) if ob.critical_task_id else None
        verb = _VERB[ob.kind]
        if now < ob.due_date:
            first = ob.reminded_at is None and ob.due_date - now <= timedelta(days=cfg["remind_days"])
            if first or (every and ob.reminded_at is not None and now - ob.reminded_at >= every):     # then every N days
                tell(ob, doc, f"Due soon: {verb} {doc.title}",
                     f"You are asked to {verb.lower()} \"{doc.title}\" by {ob.due_date:%d %b %Y}.", "warning", "reminder")
                ob.reminded_at = now
                out["reminded"] += 1
            continue
        late = now - ob.due_date
        if ob.overdue_at is None and (ob.escalation_level or 0) < 1:      # (a request escalated before overdue_at existed was told)
            tell(ob, doc, f"Overdue: {verb} {doc.title}", f"\"{doc.title}\" is overdue for you.", "error", "overdue")
            ob.overdue_at = now
        elif every and now - max(t for t in (ob.reminded_at, ob.overdue_at, ob.escalated_at, ob.due_date) if t) >= every:
            tell(ob, doc, f"Still overdue: {verb} {doc.title}",
                 f"You were asked to {verb.lower()} \"{doc.title}\" by {ob.due_date:%d %b %Y}. Please do it now.", "error", "reminder")
            ob.reminded_at = now
            out["reminded"] += 1
        line = f"{names.get(ob.user_id)} ({_NOUN[ob.kind].lower()}, due {ob.due_date:%d %b})"
        if (ob.escalation_level or 0) < 1 and late >= timedelta(days=cfg["owner_after_days"]):
            ob.escalation_level, ob.escalated_at = 1, now
            owner_notes.setdefault(doc.id, []).append(line)
        elif (ob.escalation_level or 0) == 1 and late >= timedelta(days=cfg["admin_after_days"]):
            ob.escalation_level, ob.escalated_at = 2, now
            admin_notes.setdefault(doc.id, []).append(line)
        else:
            continue
        if ct is not None:
            ct.escalation_level = ob.escalation_level
    further = escalation_ids(db, cfg, tenant_id) if admin_notes else []
    for doc_id, lines in owner_notes.items():
        doc = docs[doc_id]
        out["emailed"] += _notify(db, doc, [doc.owner_id, doc.author_id], f"Overdue on \"{doc.title}\"", "Overdue: " + "; ".join(lines[:20])
                                  + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error", event="escalation")
        out["owner_told"] += len(lines)
    for doc_id, lines in admin_notes.items():
        doc = docs[doc_id]
        out["emailed"] += _notify(db, doc, further, f"Still overdue on \"{doc.title}\"",
                                  f"Overdue by {cfg['admin_after_days']} days or more: " + "; ".join(lines[:20])
                                  + (f" and {len(lines) - 20} more" if len(lines) > 20 else ""), "error", event="escalation")
        out["admins_told"] += len(lines)
    out["emailed"] += _email_waiting(db, pending, docs)          # last: what was not just emailed on its own
    db.commit()
    return out


def _email_waiting(db, pending, docs) -> int:
    """People asked to acknowledge get one email listing what is waiting, not one per document (the first alert was in-app
    only, because publishing a document asks the whole organisation at once). Returns how many emails were sent."""
    todo: Dict[int, list] = {}
    for ob in pending:
        if ob.emailed_at is None and ob.kind == "acknowledgement" and ob.document_id in docs:
            todo.setdefault(ob.user_id, []).append(ob)
    if not todo:
        return 0
    anchor = next(iter(docs.values()))
    if "email" not in channels(settings(db, anchor.tenant_id), "published"):
        return 0
    sent = 0
    for uid, items in todo.items():
        titles = sorted({docs[o.document_id].title for o in items})
        ids = {o.document_id for o in items}
        one = docs[items[0].document_id] if len(ids) == 1 else None
        sent += _notify(db, one or anchor, [uid], f"{len(ids)} document{'' if len(ids) == 1 else 's'} to acknowledge",
                        "Please read and acknowledge: " + "; ".join(titles[:15]) + (f" and {len(titles) - 15} more" if len(titles) > 15 else "") + ".",
                        "info", link=_link(one, "acknowledgement") if one else "/governance/approvals", event="published")
        for ob in items:
            ob.emailed_at = datetime.utcnow()
    return sent


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
