"""Saved / canned replies — native read + tenant-isolated CRUD + ACTIONS engine.

Native transcription backed by the single HDSavedReply table (the proxy kept two
Frappe doctypes; the native model consolidated to one). `name` == the integer PK
as string, same convention as tickets.

Isolation (owner's #1 requirement — mirrors the proxy's `_saved_reply_in_tenant`):
  * create tags tenant_id, so the reply can only ever surface for this tenant.
  * edit/delete resolve the row WITH the tenant_id filter first; an out-of-tenant
    id returns no row → 404 (never confirms another tenant's record, never writes
    it). `_get_reply` IS that guard.

`list_canned_responses` returns the `message` body too (the proxy did not), so the
ticket composer's "insert canned reply" inserts the real text, not just the title
(§A11 FLAG).

ACTIONS ENGINE (this module) — 1:1 conversion of the Frappe source:
  * `ACTIONS`, `parse_actions`, `action_key`, `is_action_valid`, `validate_action`,
    `validate_tag_conflict`, `validate_actions`  ← doctype/hd_saved_reply/hd_saved_reply.py
  * `has_permission` / `permission_query` scope filtering  ← same file; ported to
    `can_read_saved_reply` / `_scope_filter`.
  * `get_rendered_saved_reply` / `serialize_action` / `apply_saved_reply_actions`
    ← api/saved_replies.py.
Field sets route through the native ticket-update path (`tickets.update`, which
re-resolves labels, runs the status/SLA hooks and the team-membership cleanup);
agent assignment is a direct assignee write that runs AFTER the field save so an
explicit assignment wins over the team-change cleanup; tags use HDTag/HDTicketTag;
comment uses HDTicketComment. Every query is tenant-scoped.
"""
from __future__ import annotations

import json
import re
from typing import Optional

import jinja2
from jinja2.sandbox import ImmutableSandboxedEnvironment
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ...models import (
    GRCUser,
    HDAgent,
    HDSavedReply,
    HDSavedReplyTeam,
    HDSettings,
    HDTag,
    HDTicketActivity,
    HDTicketComment,
    HDTicketPriority,
    HDTicketStatus,
    HDTicketTag,
    HDTicketType,
    Role,
    Team,
    TeamMember,
    Tenant,
    UserRole,
    get_db,
)
from ...routers.auth_router import require_auth
from . import tickets  # read-only reuse of the ticket-update path (§ field sets)
from .common import iso, require_edit, require_view, tenant_id


def _get_reply(db: Session, tid: int, name: str):
    """Tenant-scoped fetch by contract `name` (our integer PK). The tenant_id
    filter is the isolation guard: a crafted/cross-tenant id yields None."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDSavedReply)
        .filter(HDSavedReply.id == pk, HDSavedReply.tenant_id == tid)
        .first()
    )


# ─── ACTIONS registry (hd_saved_reply.py:ACTIONS) ────────────────────────────
# Native equivalents of the Frappe registry. `target` = (model, name_attr,
# usable_filters): the converted doctype a "field"/"assignment" value must still
# resolve to, keyed on the attribute that held the Frappe doc `name`:
#   Set Status→HDTicketStatus.label_agent, Set Priority→HDTicketPriority.name,
#   Set Team→HDTeam.team_name, Set Ticket Type→HDTicketType.name,
#   Assign Agent→HDAgent.user (Frappe HD Agent autoname = login email).
# `update_key` is the key the native ticket-update path (tickets.update) expects.
ACTIONS: dict[str, dict] = {
    "Set Status": {
        "kind": "field", "update_key": "status",
        "target": (HDTicketStatus, "label_agent", {"enabled": True}),
    },
    "Set Priority": {
        "kind": "field", "update_key": "priority",
        "target": (HDTicketPriority, "name", {"disabled": False}),
    },
    "Set Team": {
        "kind": "field", "update_key": "agent_group",
        "target": (Team, "name", {"is_active": True}),  # ComplyVerse Administration team
    },
    "Set Ticket Type": {
        "kind": "field", "update_key": "ticket_type",
        "target": (HDTicketType, "name", {"disabled": False}),
    },
    "Assign Agent": {
        "kind": "assignment",
        "target": (HDAgent, "user", {"is_active": True}),
    },
    "Assign to Me": {"kind": "assignment", "no_value": True},
    "Add Tag": {"kind": "tag"},
    "Remove Tag": {"kind": "tag"},
    "Add Comment": {"kind": "comment"},
}


def parse_actions(raw) -> list[dict]:
    """Actions arrive as a JSON string (HTTP), a list (the JSON column / Python
    callers) or None. hd_saved_reply.py:parse_actions."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, list) or not all(isinstance(a, dict) for a in parsed):
        raise HTTPException(status_code=400, detail="actions must be a list of objects")
    return parsed


def action_key(action_type: str, value: str):
    """Uniqueness key: one entry per set-type action, tag actions repeat per value.
    hd_saved_reply.py:action_key."""
    return (
        (action_type, value)
        if ACTIONS.get(action_type, {}).get("kind") == "tag"
        else action_type
    )


def validate_tag_conflict(actions: list[dict]) -> None:
    """A tag added and removed by the same reply would silently cancel out.
    hd_saved_reply.py:validate_tag_conflict."""
    added = {a.get("value") for a in actions if a.get("action_type") == "Add Tag"}
    removed = {a.get("value") for a in actions if a.get("action_type") == "Remove Tag"}
    conflict = sorted(tag for tag in added & removed if tag)
    if conflict:
        raise HTTPException(
            status_code=400,
            detail=f"Tag {', '.join(conflict)} cannot be both added and removed",
        )


def is_action_valid(db: Session, tid: int, action_type, value) -> bool:
    """Whether an action can currently be applied to a ticket. Strict type checks
    (values arrive from the client, where a crafted list/dict could slip through a
    query filter). hd_saved_reply.py:is_action_valid — target existence becomes a
    tenant-scoped SQLAlchemy lookup."""
    if not isinstance(action_type, str):
        return False
    spec = ACTIONS.get(action_type)
    if not spec:
        return False
    if spec.get("no_value"):
        return True
    if not isinstance(value, str) or not value.strip():
        return False
    if spec["kind"] == "comment":
        return True
    if spec["kind"] == "tag":
        # tag label is stored as its own row; a comma is still rejected to match
        # the Frappe _user_tags comma-split constraint
        return "," not in value
    model, name_attr, usable_filters = spec["target"]
    return bool(
        db.query(model)
        .filter_by(tenant_id=tid, **{name_attr: value}, **usable_filters)
        .first()
    )


def validate_action(db: Session, tid: int, action_type: str, value: str) -> None:
    if not is_action_valid(db, tid, action_type, value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid action {action_type}: {value} does not exist or is disabled",
        )


def validate_actions(db: Session, tid: int, raw, previous_raw=None) -> list[dict]:
    """Dedupe, block >1 assignment, block add+remove of the same tag, re-validate
    only *changed* actions against live targets, and normalize to the stored
    shape. hd_saved_reply.py:validate_actions. Returns the normalized list (the
    JSON column stores it directly); raises 400 on any violation (pre-send, so a
    hard stop is correct — unlike apply, which skips)."""
    actions = parse_actions(raw)
    unchanged = (
        {(a.get("action_type"), a.get("value") or "") for a in parse_actions(previous_raw)}
        if previous_raw
        else set()
    )
    seen: set = set()
    assignment_count = 0
    for action in actions:
        action_type = action.get("action_type")
        value = action.get("value") or ""
        # A crafted list/dict here is unhashable and would crash the keys below
        if not isinstance(action_type, str) or not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f"Invalid action: {action_type}")
        key = action_key(action_type, value)
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate action: {action_type}")
        seen.add(key)
        if ACTIONS.get(action_type, {}).get("kind") == "assignment":
            assignment_count += 1
        # A target deleted/disabled later must not block unrelated edits, so
        # untouched actions are not re-validated
        if (action_type, value) not in unchanged:
            validate_action(db, tid, action_type, value)
    if assignment_count > 1:
        raise HTTPException(
            status_code=400, detail="Only one of Assign Agent or Assign to Me is allowed"
        )
    validate_tag_conflict(actions)
    return [
        {"action_type": a.get("action_type"), "value": a.get("value") or ""}
        for a in actions
    ]


# ─── scope / permission (hd_saved_reply.py:has_permission / permission_query) ─
def _hd_settings(db: Session, tid: int) -> Optional[HDSettings]:
    """The HD Settings singleton row for this tenant (grc_hd_settings). Flags read
    directly per the task: restrict_tickets_by_agent_group, disable_saved_replies_global_scope."""
    return db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()


def _user_teams(db: Session, tid: int, email: Optional[str]) -> list[str]:
    """Team names the user is a member of — native get_agents_team(user). SOURCE
    CHANGE (teams unification): reads the ComplyVerse Administration teams (grc_teams), whose
    members are GRCUsers, matched to the Help Desk login by GRCUser.email."""
    if not email:
        return []
    rows = (
        db.query(Team.name)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .join(GRCUser, GRCUser.id == TeamMember.user_id)
        .filter(Team.tenant_id == tid, GRCUser.email == email)
        .all()
    )
    return [r[0] for r in rows if r[0]]


def _is_admin(db: Session, user: Optional[GRCUser]) -> bool:
    """Native admin bypass — mirrors auth_router.require_tenant_permission: the
    Administrator role or the tenant's primary-contact email. (Frappe keyed on
    System Manager / Agent Manager; the native convention is Administrator /
    primary contact — MODEL NOTE in the report.)"""
    if user is None:
        return False
    tenant = db.query(Tenant).first()
    if (
        tenant
        and tenant.primary_contact_email
        and user.email
        and tenant.primary_contact_email.lower() == user.email.lower()
    ):
        return True
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if role_ids and db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first():
        return True
    return False


def _team_scoped_ids(db: Session, user_teams: list[str]):
    """Sub-select of saved-reply ids visible to a member of `user_teams` (the
    HDSavedReplyTeam ∩ user's teams join)."""
    return (
        db.query(HDSavedReplyTeam.saved_reply_id)
        .join(Team, HDSavedReplyTeam.team_id == Team.id)
        .filter(Team.name.in_(user_teams))
    )


def can_read_saved_reply(db: Session, tid: int, reply: HDSavedReply, user: Optional[GRCUser]) -> bool:
    """has_permission port. Admin reads all (Frappe: owner==user OR admin — the
    owner leg is a MODEL GAP, HDSavedReply has no owner column). Global: readable
    unless global scope is disabled. Team: readable if team-restriction is off, or
    the user shares one of the reply's teams. Personal: no owner column → not
    readable by a non-admin (reported gap)."""
    if _is_admin(db, user):
        return True
    settings = _hd_settings(db, tid)
    restrict = bool(settings and settings.restrict_tickets_by_agent_group)
    global_disabled = bool(settings and settings.disable_saved_replies_global_scope)
    scope = reply.scope or "Global"
    if scope == "Global":
        return not global_disabled
    if scope == "Team":
        if not restrict:
            return True
        user_teams = _user_teams(db, tid, user.email if user else None)
        if not user_teams:
            return False
        return bool(
            _team_scoped_ids(db, user_teams)
            .filter(HDSavedReplyTeam.saved_reply_id == reply.id)
            .first()
        )
    return False  # Personal — owner unknowable without an owner column


def _scope_filter(db: Session, tid: int, user: Optional[GRCUser]):
    """permission_query port → a SQLAlchemy condition for list filtering, or None
    when no user is supplied (filtering off, preserves the prior list behaviour).
    Personal scope is dropped for everyone (no owner column); admins see every
    non-Personal reply."""
    if user is None:
        return None
    if _is_admin(db, user):
        return HDSavedReply.scope != "Personal"
    settings = _hd_settings(db, tid)
    restrict = bool(settings and settings.restrict_tickets_by_agent_group)
    global_disabled = bool(settings and settings.disable_saved_replies_global_scope)
    conds = []
    if not global_disabled:
        conds.append(HDSavedReply.scope == "Global")
    if restrict:
        user_teams = _user_teams(db, tid, user.email)
        if user_teams:
            conds.append(
                and_(HDSavedReply.scope == "Team", HDSavedReply.id.in_(_team_scoped_ids(db, user_teams)))
            )
    else:
        conds.append(HDSavedReply.scope == "Team")
    if not conds:
        return HDSavedReply.id.is_(None)  # nothing visible
    return or_(*conds)


# ─── teams child wiring (HDSavedReplyTeam) ────────────────────────────────────
def _set_teams(db: Session, tid: int, reply: HDSavedReply, teams) -> None:
    """Replace the reply's team child rows. `teams` None = not supplied (leave as
    is), [] = clear. Each entry resolves by team_name first, then integer id."""
    if teams is None:
        return
    db.query(HDSavedReplyTeam).filter_by(saved_reply_id=reply.id).delete()
    for i, t in enumerate(teams):
        team = db.query(Team).filter_by(tenant_id=tid, name=t).first()
        if not team:
            try:
                team = db.query(Team).filter_by(tenant_id=tid, id=int(t)).first()
            except (TypeError, ValueError):
                team = None
        if team:
            db.add(HDSavedReplyTeam(saved_reply_id=reply.id, team_id=team.id, idx=i))


# ─── reads ────────────────────────────────────────────────────────────────────
def list_saved_replies(db: Session, tid: int, user: Optional[GRCUser] = None) -> dict:
    """§A16. Full replies with body for the settings page. `user` (when passed)
    applies permission_query scope filtering; omitted → every tenant reply (the
    current router calls it without a user — see report)."""
    query = db.query(HDSavedReply).filter(HDSavedReply.tenant_id == tid)
    cond = _scope_filter(db, tid, user)
    if cond is not None:
        query = query.filter(cond)
    rows = query.order_by(HDSavedReply.updated_at.desc()).all()
    return {"saved_replies": [{
        "name": str(r.id),
        "title": r.title or str(r.id),
        "message": r.message or "",
        "owner": None,          # no owner column natively (user→grc_users deferred)
        "modified": iso(r.updated_at),
    } for r in rows]}


def list_canned_responses(db: Session, tid: int, user: Optional[GRCUser] = None) -> dict:
    """§A11. Same store as saved-replies; returns `message` so inserts use the
    real body, not the title. Scope-filtered when a user is supplied."""
    query = db.query(HDSavedReply).filter(HDSavedReply.tenant_id == tid)
    cond = _scope_filter(db, tid, user)
    if cond is not None:
        query = query.filter(cond)
    rows = query.order_by(HDSavedReply.updated_at.desc()).all()
    return {"responses": [{
        "name": str(r.id),
        "title": r.title or str(r.id),
        "message": r.message or "",
        "owner": None,
    } for r in rows]}


# ─── writes ───────────────────────────────────────────────────────────────────
def create_saved_reply(db: Session, tid: int, payload: dict) -> dict:
    """§A17. Tags tenant_id so the reply stays tenant-scoped. Also persists scope,
    validated actions, and the teams child when supplied (message reqd non-null → "")."""
    actions = (
        validate_actions(db, tid, payload.get("actions"), None)
        if payload.get("actions") is not None
        else None
    )
    reply = HDSavedReply(
        tenant_id=tid,
        title=payload.get("title") or "Untitled",
        message=payload.get("message") or "",
        scope=payload.get("scope") or "Global",
        actions=actions,
    )
    db.add(reply)
    db.flush()  # need the PK before wiring the teams child
    _set_teams(db, tid, reply, payload.get("teams"))
    db.commit()
    return {"ok": True}


def update_saved_reply(db: Session, tid: int, name: str, payload: dict) -> dict:
    """§A18. In-tenant guard first (404 on a cross-tenant id), then write. Scope,
    actions (re-validated against the previous value) and the teams child are
    updated when present."""
    r = _get_reply(db, tid, name)
    if not r:
        raise HTTPException(status_code=404, detail="not found")
    if payload.get("title") is not None:
        r.title = payload["title"]
    if payload.get("message") is not None:
        r.message = payload["message"]
    if payload.get("scope"):
        r.scope = payload["scope"]
    if payload.get("actions") is not None:
        r.actions = validate_actions(db, tid, payload["actions"], r.actions)
    db.flush()
    _set_teams(db, tid, r, payload.get("teams"))
    db.commit()
    return {"ok": True}


def delete_saved_reply(db: Session, tid: int, name: str) -> dict:
    """§A19. In-tenant guard first (404 on a cross-tenant id), then delete."""
    r = _get_reply(db, tid, name)
    if not r:
        raise HTTPException(status_code=404, detail="not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# ─── render + apply (api/saved_replies.py) ────────────────────────────────────
def _render_context(ticket, user: Optional[GRCUser]) -> dict:
    """Template context = the ticket's columns + friendly Frappe-field aliases +
    the acting user (api/saved_replies.py merges ticket.as_dict() and the user)."""
    ctx = {c.name: getattr(ticket, c.name) for c in ticket.__table__.columns}
    ctx["name"] = str(ticket.id)
    ctx["status"] = ticket.status.label_agent if ticket.status else None
    ctx["priority"] = (ticket.priority.name or ticket.priority.level) if ticket.priority else None
    ctx["ticket_type"] = ticket.ticket_type.name if ticket.ticket_type else None
    ctx["agent_group"] = ticket.team.name if ticket.team else None
    ctx["customer"] = ticket.customer.customer_name if ticket.customer else None
    if user is not None:
        for f in ("email", "display_name", "username", "department", "designation", "division", "group"):
            ctx[f] = getattr(user, f, None)
        ctx["full_name"] = user.display_name
        ctx["user"] = user.email
    return ctx


# B2: a single IMMUTABLE Jinja sandbox for all saved-reply rendering. The
# default `jinja2.Template` uses the unsandboxed environment, so an
# agent-authored body like `{{ cycler.__init__.__globals__.os.popen('id') }}`
# executes arbitrary Python (SSTI -> RCE). The sandbox raises
# jinja2.exceptions.SecurityError on any unsafe attribute/global access and the
# Immutable variant also blocks mutating shared objects.
_SANDBOX_ENV = ImmutableSandboxedEnvironment(autoescape=False)


def _render(template: str, ctx: dict) -> str:
    """Render the message body against the ticket/user context inside the
    IMMUTABLE Jinja sandbox (B2). The sandbox raises SecurityError on the classic
    SSTI gadgets (`{{ ''.__class__… }}`, `{{ cycler.__init__.__globals__… }}`)
    BEFORE any dangerous access happens, so no code can execute. On any render
    failure (a blocked payload or a malformed template) we return the raw body
    unrendered rather than 500 — the dangerous access never occurred."""
    try:
        return _SANDBOX_ENV.from_string(template or "").render(ctx)
    except Exception:
        return template or ""


def serialize_action(db: Session, tid: int, action: dict) -> dict:
    """api/saved_replies.py:serialize_action — attach a display label: agent name
    for Assign Agent, plain text for Add Comment, the value otherwise."""
    action_type, value = action.get("action_type"), action.get("value") or ""
    label = value
    if action_type == "Assign Agent":
        row = db.query(HDAgent.agent_name).filter_by(tenant_id=tid, user=value).first()
        label = row[0] if row and row[0] else value
    elif action_type == "Add Comment":
        label = re.sub(r"<[^>]+>", "", value)  # strip_html
    return {"action_type": action_type, "value": value, "label": label}


def get_rendered_saved_reply(db: Session, tid: int, ticket_id: str,
                             saved_reply_id: str, user: Optional[GRCUser]) -> dict:
    """api/saved_replies.py:get_rendered_saved_reply. Enforces read scope
    (has_permission), renders the body as a template against ticket+user, and
    returns only the still-valid actions (stale ones are dropped so an agent never
    stages one that fails after the email is already sent)."""
    reply = _get_reply(db, tid, saved_reply_id)
    if not reply:
        raise HTTPException(status_code=404, detail="saved reply not found")
    if not can_read_saved_reply(db, tid, reply, user):
        raise HTTPException(status_code=403, detail="not permitted")
    ticket = tickets._get_ticket(db, tid, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="ticket not found")
    return {
        "title": reply.title,
        "message": _render(reply.message or "", _render_context(ticket, user)),
        "actions": [
            serialize_action(db, tid, a)
            for a in parse_actions(reply.actions)
            if is_action_valid(db, tid, a.get("action_type"), a.get("value"))
        ],
    }


def _assign_agent(db: Session, tid: int, ticket, agent: str) -> None:
    """Direct assignee write (native equivalent of HD Ticket.assign_agent), run
    AFTER the field save so it wins over the team-change cleanup. Preserves the
    ticket's team (unlike tickets.assign, which also resets the team)."""
    ticket.assigned_agent = agent
    db.add(HDTicketActivity(tenant_id=tid, ticket_id=ticket.id, action=f"assigned to {agent}"))
    db.commit()


def _apply_tags(db: Session, tid: int, ticket, added: list[str], removed: list[str]) -> None:
    """api/tags.py port: link/unlink tags, minting the tenant tag master on first
    use, then log one activity row for the batch (HD Ticket only has a feed)."""
    real_added, real_removed = [], []
    for label in added:
        label = label.strip()
        if not label or "," in label:
            continue
        tag = db.query(HDTag).filter_by(tenant_id=tid, name=label).first()
        if not tag:
            tag = HDTag(tenant_id=tid, name=label, color="Gray")
            db.add(tag)
            db.flush()
        if not db.query(HDTicketTag).filter_by(ticket_id=ticket.id, tag_id=tag.id).first():
            db.add(HDTicketTag(ticket_id=ticket.id, tag_id=tag.id))
        real_added.append(label)
    for label in removed:
        label = label.strip()
        if not label:
            continue
        tag = db.query(HDTag).filter_by(tenant_id=tid, name=label).first()
        if tag:
            db.query(HDTicketTag).filter_by(ticket_id=ticket.id, tag_id=tag.id).delete()
        real_removed.append(label)
    parts = []
    if real_added:
        parts.append(f"added tag{'s' if len(real_added) > 1 else ''} {', '.join(real_added)}")
    if real_removed:
        parts.append(f"removed tag{'s' if len(real_removed) > 1 else ''} {', '.join(real_removed)}")
    if parts:
        db.add(HDTicketActivity(tenant_id=tid, ticket_id=ticket.id, action=" & ".join(parts)))
    db.commit()


def _add_comment(db: Session, tid: int, ticket, content: str, author: Optional[str]) -> None:
    """Native HD Ticket.new_comment: an internal note (HDTicketComment) + activity."""
    db.add(HDTicketComment(
        tenant_id=tid, reference_ticket_id=ticket.id, content=content, commented_by=author,
    ))
    db.add(HDTicketActivity(tenant_id=tid, ticket_id=ticket.id, action="added an internal note"))
    db.commit()


def apply_saved_reply_actions(db: Session, tid: int, ticket_id: str,
                              actions, user: Optional[GRCUser]) -> dict:
    """api/saved_replies.py:apply_saved_reply_actions. Apply the actions AFTER the
    reply email is sent: now-invalid or duplicate actions are SKIPPED (not raised)
    because the email is already out. Field sets go through the ticket-update path
    in one save, the agent assignment runs after that save, then tags, then the
    comment."""
    parsed = parse_actions(actions)
    ticket = tickets._get_ticket(db, tid, ticket_id)
    if not ticket:
        return {"applied": [], "skipped": [], "error": "ticket not found"}

    applied: list[dict] = []
    skipped: list[dict] = []
    field_payload: dict = {}
    assign_to: Optional[str] = None
    comment: Optional[str] = None
    added_tags: list[str] = []
    removed_tags: list[str] = []
    seen: set = set()
    me = user.email if user else None

    for action in parsed:
        action_type, value = action.get("action_type"), action.get("value")
        if not is_action_valid(db, tid, action_type, value):
            skipped.append({"action_type": action_type, "value": value})
            continue
        key = action_key(action_type, value)  # a repeat is shadowed by the last → skip
        if key in seen:
            skipped.append({"action_type": action_type, "value": value})
            continue
        seen.add(key)
        if action_type == "Assign Agent":
            assign_to = value
        elif action_type == "Assign to Me":
            if not me or not db.query(HDAgent).filter_by(tenant_id=tid, user=me, is_active=True).first():
                skipped.append({"action_type": action_type, "value": value})
                continue
            assign_to = me
        elif action_type == "Add Tag":
            added_tags.append(value.strip())
        elif action_type == "Remove Tag":
            removed_tags.append(value.strip())
        elif action_type == "Add Comment":
            comment = value
        else:
            field_payload[ACTIONS[action_type]["update_key"]] = value
        applied.append({"action_type": action_type, "value": value})

    # field sets in one save (status runs its SLA/resolution hooks, team runs the
    # membership cleanup — both via the native ticket-update path)
    if field_payload:
        tickets.update(db, tid, str(ticket.id), field_payload)
    # assignment after save: an explicit assignment wins over the team-change cleanup
    if assign_to:
        _assign_agent(db, tid, ticket, assign_to)
    if added_tags or removed_tags:
        _apply_tags(db, tid, ticket, added_tags, removed_tags)
    if comment:
        _add_comment(db, tid, ticket, comment, me)
    return {"applied": applied, "skipped": skipped}


# ─── router (NOT mounted here — see router.py note; parallel to its endpoints) ─
actions_router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


class ApplyActionsBody(BaseModel):
    actions: list[dict] = []


@actions_router.get("/saved-replies/{saved_reply_id}/rendered")
def rendered_saved_reply(saved_reply_id: str, ticket_id: str,
                         db: Session = Depends(get_db),
                         current_user: GRCUser = Depends(require_auth),
                         _: bool = Depends(require_view)):
    return get_rendered_saved_reply(db, tenant_id(db), ticket_id, saved_reply_id, current_user)


@actions_router.post("/tickets/{ticket_id}/apply-saved-reply-actions")
def apply_actions(ticket_id: str, body: ApplyActionsBody,
                  db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_edit)):
    return apply_saved_reply_actions(db, tenant_id(db), ticket_id, body.actions, current_user)


if __name__ == "__main__":  # pure validation/scope logic (no DB needed)
    assert action_key("Add Tag", "x") == ("Add Tag", "x")      # tags repeat per value
    assert action_key("Set Status", "Open") == "Set Status"    # set-actions collapse to type
    assert parse_actions(None) == []
    for bad in ("{not json", [1, 2], {"a": 1}):                # malformed → 400
        try:
            parse_actions(bad)
            raise SystemExit(f"parse_actions failed to reject {bad!r}")
        except HTTPException as e:
            assert e.status_code == 400
    try:
        validate_tag_conflict([{"action_type": "Add Tag", "value": "a"},
                               {"action_type": "Remove Tag", "value": "a"}])
        raise SystemExit("validate_tag_conflict missed add+remove of same tag")
    except HTTPException as e:
        assert e.status_code == 400
    validate_tag_conflict([{"action_type": "Add Tag", "value": "a"},
                           {"action_type": "Remove Tag", "value": "b"}])  # distinct → ok
    assert _scope_filter(None, 1, None) is None                 # no user → filtering off

    # ── B2: Jinja SSTI sandbox adversarial self-check ────────────────────────
    # The sandbox raises SecurityError on the RCE gadgets (any unsafe-attribute
    # WALK / call). A bare single `{{ ''.__class__ }}` is instead silently
    # neutralised to an empty Undefined — also safe (no code runs), asserted
    # separately below.
    from jinja2.exceptions import SecurityError as _SecErr
    for _payload in ("{{ ''.__class__.__mro__ }}",                       # spec-named
                     "{{ cycler.__init__.__globals__ }}",               # spec-named
                     "{{ ''.__class__.__base__.__subclasses__() }}",
                     "{{ ().__class__.__bases__[0].__subclasses__() }}",
                     "{{ cycler.__init__.__globals__['os'].popen('id').read() }}"):
        try:
            _SANDBOX_ENV.from_string(_payload).render({})
            raise SystemExit(f"sandbox FAILED to block SSTI payload: {_payload!r}")
        except _SecErr:
            pass  # blocked as required — the exploit cannot execute
    # bare single-level unsafe attr access is neutralised to '' (no code runs)
    assert _SANDBOX_ENV.from_string("{{ ''.__class__ }}").render({}) == ""
    # a normal substitution still renders through the sandbox
    assert _SANDBOX_ENV.from_string("Hi {{ name }}").render({"name": "Sam"}) == "Hi Sam"
    # production _render: renders legit templates, and NEUTRALISES the exploit by
    # returning the raw (unrendered, un-executed) body instead of running it
    assert _render("Hi {{ name }}", {"name": "Sam"}) == "Hi Sam"
    assert _render("{{ ''.__class__.__mro__ }}", {}) == "{{ ''.__class__.__mro__ }}"
    assert _render("{{ cycler.__init__.__globals__ }}", {}) == "{{ cycler.__init__.__globals__ }}"
    print("saved-reply B2 jinja sandbox adversarial self-check ok")

    print("saved-reply engine self-check ok")
