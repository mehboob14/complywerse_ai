"""Policy exceptions: the approval rules a tenant writes in Governance > Settings, and the run of one exception through the rule
that applies to it (DECISIONS D58). The pure rules are in ``exception_rules.py``; the older flow (anyone allowed to approve
exceptions decides) is in ``routers/policy_exception_router.py`` and stays as it was for an exception no rule matches.

* **Submit** picks the rule (``matching_rule``), copies its steps into a run (``start``) and asks the first step's people. A rule
  nobody can follow for this exception's unit (a step with nobody who can decide) is refused at submit, in words, and nothing changes.
* **Decide** (``decide``): approve, reject (where the step allows it) or ask for changes (back to draft; the rules start again when
  the requester submits again). Only people asked at the open step decide, and never the requester: the rule binds everyone,
  administrators included, but for an organisation's only administrator when nobody else could decide (the history says so).
  Every decision is kept with who, which step and when.
* **Edits** to what chose the rule (priority, unit, type, policy) are refused while a run is open (``locked_fields``): withdraw first.
* People are resolved when a step opens (a role's holders, the unit's owner and its parent's owner as they are then), so a person who
  joins the role meanwhile is asked from the next step on.
* **An approval needs the approver's own assessment** (``exception_risks``: potential risks, or "none identified"), and **after the last
  approval the exception's own implementer is asked** (chosen by whoever raises it, not by the rule: ``open_implementation``;
  ``exception_controls`` records the compensating controls and marks it implemented). The exception's status is not touched by the
  implementation (D62, D67). An exception no rule matches has no run: its approval writes a closed one so that the implementation has a home
  (``open_direct_implementation``).

Functions that write only ``flush``: the caller commits.
"""
from __future__ import annotations

import copy
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from fastapi import HTTPException, status
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.orm import Session

from ...models import (ExceptionApprovalDecision, ExceptionApprovalRule, ExceptionApprovalRun, ExceptionControl, ExceptionRisk, GovernanceDocument,
                       GRCUser, PolicyException, PolicyExceptionComment, Role)
from ...services import org_departments
from . import exception_rules as R

logger = logging.getLogger(__name__)

LINK = "/governance/exceptions?open={}"
NOT_YOUR_TURN = "It is not your turn: {step} waits for {who}."
OWN = "You requested this exception, so someone else has to decide it."
NO_RUN = "This exception is not waiting for a decision under an approval rule."
LOCKED = ("The approval rule was chosen when it was submitted, so its priority, department, type and policy cannot change while it waits. "
          "Withdraw it first.")
LOCKED_FIELDS = ("priority", "department_id", "exception_type", "document_id")


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _when(raw: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(raw) if raw else None
    except ValueError:
        return None


def _names(db: Session, ids: Iterable[int]) -> Dict[int, str]:
    from . import doc_lifecycle

    return doc_lifecycle._names(db, ids)


def _people(db: Session, ids: Iterable[int]) -> Set[int]:
    """The active users among ``ids`` who are people of this platform (not accounts an access review imported)."""
    from . import doc_lifecycle

    return set(doc_lifecycle._people(db, ids))


def _role_members(db: Session, tenant_id: int, role_id: int) -> Set[int]:
    from .routers.document_signoff import _resolve_target_users

    return _people(db, _resolve_target_users(db, [tenant_id], "role", role_id))


def lone_decider(db: Session, user: Optional[GRCUser]) -> bool:
    """The person is the organisation's only administrator and nobody else holds the right to approve exceptions: nobody else could ever
    decide their exception, so (and only so) they may decide their own. The history says it."""
    from ...routers.auth_router import is_tenant_admin, tenant_permission_names
    from . import doc_lifecycle

    if user is None or not is_tenant_admin(db, user):
        return False
    others = set(doc_lifecycle._people(db)) - {user.id}
    return not any(is_tenant_admin(db, o) or "governance:policy_exceptions:approve" in tenant_permission_names(db, o)
                   for o in db.query(GRCUser).filter(GRCUser.id.in_(others))) if others else True


def lone_decider_for(db: Session, user_id: Optional[int]) -> bool:
    return bool(user_id) and lone_decider(db, db.get(GRCUser, user_id))


def _alone(step: Optional[Dict[str, Any]], user_id: int) -> bool:
    """The step was opened with this person, the requester, as its only possible decider (``resolve_slots`` with ``self_ok``)."""
    return any(s.get("self") and user_id in (s.get("members") or []) for s in (step or {}).get("slots") or [])


# ── the rules ────────────────────────────────────────────────────────────────
def rule_dict(rule: ExceptionApprovalRule) -> Dict[str, Any]:
    return {"id": rule.id, "name": rule.name, "department_id": rule.department_id, "priorities": list(rule.priorities or []),
            "doc_types": list(rule.doc_types or []), "exception_types": list(rule.exception_types or []),
            "steps": copy.deepcopy(rule.steps or []), "is_active": rule.is_active is not False}


def rule_dicts(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    return [rule_dict(r) for r in db.query(ExceptionApprovalRule).filter(ExceptionApprovalRule.tenant_id == tenant_id)
            .order_by(ExceptionApprovalRule.id)]


def _unit_name(tree: org_departments.Tree, unit_id: Optional[int]) -> Optional[str]:
    return tree.rows[unit_id].name if unit_id in tree.rows else None


def _person_label(p: Dict[str, Any], users: Dict[int, str], roles: Dict[int, str]) -> str:
    """Who a step (or an exception's implementer) asks, in words: a person by name, a role, or one of the two owners."""
    if p["type"] == "user":
        return users.get(p["id"], f"User #{p['id']}")
    if p["type"] == "role":
        return roles.get(p["id"], f"Role #{p['id']}")
    return "Owner of the unit" if p["type"] == "unit_owner" else "Owner of its parent"


def rules_view(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """The rules for the Settings page: where each applies, its conditions, its steps with the people named."""
    tree = org_departments.Tree.load(db, tenant_id)
    rules = db.query(ExceptionApprovalRule).filter(ExceptionApprovalRule.tenant_id == tenant_id).order_by(ExceptionApprovalRule.id).all()
    people = [p for r in rules for s in r.steps or [] for p in s.get("people", [])]
    users = _names(db, {p["id"] for p in people if p["type"] == "user"})
    role_ids = {p["id"] for p in people if p["type"] == "role"}
    roles = {i: n for i, n in db.query(Role.id, Role.name).filter(Role.id.in_(role_ids))} if role_ids else {}
    out = []
    for r in rules:
        steps = copy.deepcopy(r.steps or [])
        for s in steps:
            for p in s.get("people", []):
                p["label"] = _person_label(p, users, roles)
        where = [d.name for d in tree.path(r.department_id)] if r.department_id in tree.rows else []
        out.append({**rule_dict(r), "steps": steps, "department_path": where,
                    "department_level": tree.level(r.department_id) if where else None,
                    "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at)})
    return out


def _check_people(db: Session, tenant_id: int, steps: Sequence[Dict[str, Any]]) -> None:
    """The people the steps (or an implementer, given as one step) name exist and are active people of this platform: a 400 with a sentence if not."""
    users = {p["id"] for s in steps for p in s["people"] if p["type"] == "user"}
    roles = {p["id"] for s in steps for p in s["people"] if p["type"] == "role"}
    if users:
        from ...routers.auth_router import refuse_imported_accounts

        found = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(users))}
        for uid in sorted(users):
            if uid not in found:
                raise _problem("A person chosen does not exist.")
        refuse_imported_accounts(db, sorted(users))
        gone = [found[u].display_name or found[u].username for u in sorted(users) if not found[u].is_active]
        if gone:
            raise _problem(f"{gone[0]} is not an active user.")
    if roles and {r for (r,) in db.query(Role.id).filter(Role.id.in_(roles), Role.tenant_id == tenant_id)} != roles:
        raise _problem("A role chosen does not exist.")


def save_rule(db: Session, tenant_id: int, payload: Dict[str, Any], by_user_id: Optional[int],
              rule: Optional[ExceptionApprovalRule] = None) -> ExceptionApprovalRule:
    """Create a rule, or change ``rule`` to ``payload`` (the whole rule). Problems a person can fix are 400s with a sentence."""
    try:
        name = R.clean_name(payload.get("name"))
        steps = R.validate_steps(payload.get("steps"))
        priorities, doc_types = R.clean_conditions(payload.get("priorities"), payload.get("doc_types"))
        exception_types = R.clean_types(payload.get("exception_types"))
    except ValueError as exc:
        raise _problem(str(exc)) from None
    from . import exception_types as types

    types.check_known(db, tenant_id, exception_types)
    tree = org_departments.Tree.load(db, tenant_id)
    where = payload.get("department_id")
    where = int(where) if where not in (None, "") else None
    if where is not None and where not in tree.rows:
        raise _problem("The department chosen does not exist.")
    active = payload.get("is_active") is not False
    if active:
        _check_people(db, tenant_id, steps)                        # a rule that is switched off is never asked: someone who left does not stop it being switched off
        for other in db.query(ExceptionApprovalRule).filter(ExceptionApprovalRule.tenant_id == tenant_id, ExceptionApprovalRule.is_active.is_(True)):
            if (rule is None or other.id != rule.id) and other.department_id == where and \
                    set(other.priorities or []) == set(priorities) and set(other.doc_types or []) == set(doc_types) and \
                    set(other.exception_types or []) == set(exception_types):
                raise _problem(f"The rule '{other.name}' already covers the same department and conditions. Change that one, or "
                               "switch it off first.")
    now = datetime.utcnow()
    if rule is None:
        rule = ExceptionApprovalRule(tenant_id=tenant_id, created_by=by_user_id, created_at=now)
        db.add(rule)
    rule.name, rule.department_id, rule.priorities, rule.doc_types, rule.steps = name, where, priorities, doc_types, steps
    rule.exception_types = exception_types
    rule.is_active, rule.updated_by, rule.updated_at = active, by_user_id, now
    db.flush()
    return rule


# ── which rule applies to an exception ───────────────────────────────────────
def unit_of(db: Session, exc: PolicyException) -> Optional[int]:
    """The department an exception is raised for: its own, else its policy's."""
    if exc.department_id:
        return exc.department_id
    doc = db.get(GovernanceDocument, exc.document_id) if exc.document_id else None
    return doc.department_id if doc is not None else None


def _doc_type(db: Session, exc: PolicyException) -> Optional[str]:
    doc = db.get(GovernanceDocument, exc.document_id) if exc.document_id else None
    return doc.doc_type if doc is not None else None


def pick_rule(db: Session, tenant_id: int, unit_id: Optional[int], priority: Optional[str], doc_type: Optional[str],
              tree: Optional[org_departments.Tree] = None, exception_type: Optional[str] = None) -> Optional[Dict[str, Any]]:
    tree = tree or org_departments.Tree.load(db, tenant_id)
    path = [d.id for d in tree.path(unit_id)] if unit_id in tree.rows else []
    return R.pick(rule_dicts(db, tenant_id), path, priority, doc_type, lambda i: tree.level(i) if i in tree.rows else 1, exception_type)


def matching_rule(db: Session, exc: PolicyException) -> Optional[Dict[str, Any]]:
    return pick_rule(db, exc.tenant_id, unit_of(db, exc), exc.priority, _doc_type(db, exc), exception_type=exc.exception_type)


# ── the people a step asks ───────────────────────────────────────────────────
def resolve_slots(db: Session, tenant_id: int, unit_id: Optional[int], step: Dict[str, Any], requester_id: Optional[int],
                  tree: Optional[org_departments.Tree] = None, self_ok: bool = False) -> List[Dict[str, Any]]:
    """One slot for each person / role / owner the step names, with the people who may answer for it now (the requester never; ``self_ok``:
    unless that leaves the step with nobody, then the requester alone, marked ``self``: the organisation's only administrator)."""
    tree = tree or org_departments.Tree.load(db, tenant_id)
    unit = tree.rows.get(unit_id) if unit_id else None
    parent = tree.rows.get(tree.parent.get(unit.id)) if unit is not None and tree.parent.get(unit.id) is not None else None
    users = _names(db, [p["id"] for p in step["people"] if p["type"] == "user"])
    roles = {i: n for i, n in db.query(Role.id, Role.name).filter(Role.id.in_([p["id"] for p in step["people"] if p["type"] == "role"]))} \
        if any(p["type"] == "role" for p in step["people"]) else {}
    slots = []
    for p in step["people"]:
        kind = p["type"]
        if kind == "user":
            members, label, key = _people(db, [p["id"]]), users.get(p["id"], f"User #{p['id']}"), f"user:{p['id']}"
        elif kind == "role":
            members, label, key = _role_members(db, tenant_id, p["id"]), f"Role: {roles.get(p['id'], p['id'])}", f"role:{p['id']}"
        else:
            holder = unit if kind == "unit_owner" else parent
            owner = holder.department_head_user_id if holder is not None else None
            members = _people(db, [owner]) if owner else set()
            label = (f"Owner of {holder.name}" if holder is not None
                     else "Owner of the unit" if kind == "unit_owner" else "Owner of the parent department")
            if holder is not None and not members:
                label += " (none set)"
            key = f"{kind}:{holder.id if holder is not None else 0}"
        slots.append({"key": key, "type": kind, "ref": p.get("id"), "label": label,
                      "members": sorted(members - ({requester_id} if requester_id else set())), "_had": bool(requester_id and requester_id in members)})
    if self_ok and requester_id and not any(s["members"] for s in slots):
        for s in slots:
            if s["_had"]:
                s["members"], s["self"] = [requester_id], True
    for s in slots:
        s.pop("_had", None)
    return slots


def preview(db: Session, tenant_id: int, unit_id: Optional[int], priority: Optional[str], doc_type: Optional[str],
            exception_type: Optional[str] = None) -> Dict[str, Any]:
    """Which rule would apply to an exception like this, and who each of its steps would ask (for the Settings page's tester)."""
    tree = org_departments.Tree.load(db, tenant_id)
    if unit_id is not None and unit_id not in tree.rows:
        raise _problem("The department chosen does not exist.")
    rule = pick_rule(db, tenant_id, unit_id, priority, doc_type, tree, (exception_type or "").strip() or None)
    if rule is None:
        return {"rule": None, "steps": [], "problems": []}
    steps = copy.deepcopy(rule["steps"])
    for step in steps:
        step["slots"] = resolve_slots(db, tenant_id, unit_id, step, None, tree)
    return {"rule": {"id": rule["id"], "name": rule["name"], "department_id": rule["department_id"]}, "steps": steps,
            "problems": R.problems(steps, _unit_name(tree, unit_id))}


# ── a run ────────────────────────────────────────────────────────────────────
def runs_of(db: Session, exc_id: int) -> List[ExceptionApprovalRun]:
    return db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id == exc_id).order_by(ExceptionApprovalRun.round).all()


def _lock(db: Session, model, row_id: int):
    """The row read again under a lock (SELECT ... FOR UPDATE on PostgreSQL; nothing on SQLite): two people deciding at the same moment
    are taken one after the other, so the step is judged on everybody's decision. What the session holds unwritten is flushed first:
    reading the row again would otherwise drop it."""
    db.flush()
    return db.query(model).filter(model.id == row_id).with_for_update().populate_existing().one()


def open_run(db: Session, exc: PolicyException) -> Optional[ExceptionApprovalRun]:
    return db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id == exc.id, ExceptionApprovalRun.status == "open") \
        .order_by(ExceptionApprovalRun.round.desc()).first()


def _decisions(db: Session, run_id: int) -> List[ExceptionApprovalDecision]:
    return db.query(ExceptionApprovalDecision).filter(ExceptionApprovalDecision.run_id == run_id) \
        .order_by(ExceptionApprovalDecision.decided_at, ExceptionApprovalDecision.id).all()


def _approvers(db: Session, run: ExceptionApprovalRun, position: int) -> Set[int]:
    return {d.user_id for d in db.query(ExceptionApprovalDecision).filter(
        ExceptionApprovalDecision.run_id == run.id, ExceptionApprovalDecision.step_position == position,
        ExceptionApprovalDecision.decision == "approve")}


def _step(run: ExceptionApprovalRun, position: Optional[int]) -> Optional[Dict[str, Any]]:
    return next((s for s in run.steps or [] if s["position"] == position), None)


def _save_steps(run: ExceptionApprovalRun, steps: List[Dict[str, Any]]) -> None:
    run.steps = steps                       # a new list: the change is seen
    flag_modified(run, "steps")
    run.updated_at = datetime.utcnow()


def _alert(db: Session, tenant_id: int, user_ids: Iterable[int], subject: str, message: str, exception_id: int) -> None:
    """An in-app alert that opens the exception. Never raises: a failed alert must not undo a decision."""
    ids = sorted({int(u) for u in user_ids if u})
    if not ids:
        return
    try:
        from ..workflow_engine.services.notification_service import send_workflow_notification

        send_workflow_notification(db, tenant_id=tenant_id, subject=subject[:500], message=message, workflow_instance_id=None,
                                   user_ids=ids, channels=["in_app"], notification_type="info", link=LINK.format(exception_id))
    except Exception:       # noqa: BLE001
        logger.exception("policy exception %s: could not alert users %s", exception_id, ids)


def _log(db: Session, exc: PolicyException, user_id: int, what: str, text: Optional[str]) -> None:
    """The decision as a line of the exception's comments, with who and when: its history (as the older flow writes it)."""
    text = (text or "").strip()
    db.add(PolicyExceptionComment(exception_id=exc.id, user_id=user_id, comment=f"{what}: {text}" if text else f"{what}."))


def _activate(db: Session, run: ExceptionApprovalRun, exc: PolicyException, position: int) -> None:
    """Open a step: its people are read as they are now, its days start, and the people asked are told."""
    steps = copy.deepcopy(run.steps or [])
    step = next(s for s in steps if s["position"] == position)
    now = datetime.utcnow()
    step["slots"] = resolve_slots(db, exc.tenant_id, run.department_id, step, exc.requested_by, self_ok=lone_decider_for(db, exc.requested_by))
    step["state"], step["activated_at"] = "active", now.isoformat()
    step["due_at"] = (now + timedelta(days=step["due_days"])).isoformat() if step.get("due_days") else None
    run.current_step = position
    _save_steps(run, steps)
    run.asked = R.asked_now(step, _approvers(db, run, position))
    flag_modified(run, "asked")
    verb = "review" if step["kind"] == "review" else "approve"
    _alert(db, exc.tenant_id, run.asked, f"Exception to {verb}: {exc.title}",
           f"Step {position} ({step['name']}) of '{run.rule_name}' waits for you to {verb} \"{exc.title}\".", exc.id)


def start(db: Session, exc: PolicyException, user: GRCUser) -> Optional[ExceptionApprovalRun]:
    """Submit under the rule that applies, or None when no rule does (the exception then follows the older flow)."""
    rule = matching_rule(db, exc)
    if rule is None:
        return None
    exc = _lock(db, PolicyException, exc.id)                          # a second submission at the same moment waits here, then finds it submitted
    if exc.status != "draft" or open_run(db, exc) is not None:
        raise _problem("This exception has already been submitted.", status.HTTP_409_CONFLICT)
    tree = org_departments.Tree.load(db, exc.tenant_id)
    unit = unit_of(db, exc)
    steps = copy.deepcopy(rule["steps"])
    for step in steps:
        step["slots"] = resolve_slots(db, exc.tenant_id, unit, step, exc.requested_by, tree, self_ok=lone_decider_for(db, exc.requested_by))
        step["state"] = "waiting"
    bad = R.problems(steps, _unit_name(tree, unit))
    if bad:
        raise _problem(f"This exception follows the rule '{rule['name']}', which cannot start: " + " ".join(bad)
                       + " Ask an administrator to change the rule or to set the owners.", status.HTTP_409_CONFLICT)
    last = max((r.round for r in runs_of(db, exc.id)), default=0)
    run = ExceptionApprovalRun(tenant_id=exc.tenant_id, exception_id=exc.id, round=last + 1, rule_id=rule["id"], rule_name=rule["name"],
                               department_id=unit, steps=steps, status="open", asked=[], started_by=user.id)
    db.add(run)
    db.flush()
    _activate(db, run, exc, 1)
    exc.status = "pending_approval"
    exc.updated_at = datetime.utcnow()
    return run


def _asked_text(db: Session, run: ExceptionApprovalRun) -> str:
    names = sorted(_names(db, run.asked or []).values(), key=str.casefold)
    if not names:
        return "nobody who can act now"
    return ", ".join(names[:5]) + (f" and {len(names) - 5} more" if len(names) > 5 else "")


def decide(db: Session, exc: PolicyException, user: GRCUser, decision: str, comment: Optional[str]) -> ExceptionApprovalRun:
    """Approve, reject or ask for changes at the open step. Refused (403 / 409 / 400, with a sentence) unless it is the person's turn."""
    run = open_run(db, exc)
    if run is None or decision not in R.DECISIONS:
        raise _problem(NO_RUN, status.HTTP_409_CONFLICT)
    run = _lock(db, ExceptionApprovalRun, run.id)
    exc = _lock(db, PolicyException, exc.id)
    if run.status != "open" or exc.status != "pending_approval":      # decided by someone else while this request waited its turn
        raise _problem(NO_RUN, status.HTTP_409_CONFLICT)
    if exc.requested_by == user.id and not _alone(_step(run, run.current_step), user.id):
        raise _problem(OWN, status.HTTP_403_FORBIDDEN)
    step = _step(run, run.current_step)
    if step is None or user.id not in (run.asked or []):
        label = f"step {step['position']} ({step['name']})" if step else "the next step"
        raise _problem(NOT_YOUR_TURN.format(step=label, who=_asked_text(db, run)), status.HTTP_403_FORBIDDEN)
    text = (comment or "").strip()
    if decision == "reject" and not step.get("allow_reject"):
        raise _problem(f"Step {step['position']} ({step['name']}) cannot reject. Approve it, or ask for changes.", status.HTTP_409_CONFLICT)
    if decision == "changes" and not step.get("allow_changes"):
        raise _problem(f"Step {step['position']} ({step['name']}) cannot ask for changes.", status.HTTP_409_CONFLICT)
    if decision in ("reject", "changes") and not text:
        raise _problem("Say why: a reason is required." if decision == "reject" else "Say what has to change: a comment is required.")
    if decision == "approve":
        from . import exception_risks

        exception_risks.require_assessment(db, run, step, user)         # what could go wrong, or that nothing could: said before approving
    now = datetime.utcnow()
    db.add(ExceptionApprovalDecision(run_id=run.id, exception_id=exc.id, step_position=step["position"], step_name=step["name"],
                                     user_id=user.id, decision=decision, comment=text or None, decided_at=now))
    db.flush()
    where = f"step {step['position']}, {step['name']}" + (", by the requester, as nobody else could decide" if exc.requested_by == user.id else "")
    if decision == "reject":
        run.status, run.finished_at, run.asked = "rejected", now, []
        exc.status, exc.rejected_by, exc.rejected_at, exc.rejection_reason = "rejected", user.id, now, text
        _log(db, exc, user.id, f"Rejected ({where})", text)
        _alert(db, exc.tenant_id, [exc.requested_by], f"Exception rejected: {exc.title}", f"Rejected at {where}: {text}", exc.id)
    elif decision == "changes":
        run.status, run.finished_at, run.asked = "changes_requested", now, []
        exc.status = "draft"
        _log(db, exc, user.id, f"Changes asked for ({where})", text)
        _alert(db, exc.tenant_id, [exc.requested_by], f"Changes asked for: {exc.title}",
               f"Changes asked for at {where}: {text} Edit it and submit it again.", exc.id)
    else:
        _log(db, exc, user.id, f"Approved ({where})", text)
        approvers = _approvers(db, run, step["position"])
        if R.step_done(step, approvers):
            steps = copy.deepcopy(run.steps)
            mine = next(s for s in steps if s["position"] == step["position"])
            mine["state"], mine["completed_at"] = "done", now.isoformat()
            _save_steps(run, steps)
            if any(s["position"] > step["position"] for s in steps):
                _activate(db, run, exc, step["position"] + 1)
            else:
                run.status, run.finished_at, run.asked = "approved", now, []
                exc.status, exc.approved_by, exc.approved_at, exc.approval_comments = "approved", user.id, now, text or None
                opened = open_implementation(db, run, exc)
                _alert(db, exc.tenant_id, [exc.requested_by], f"Exception approved: {exc.title}",
                       f"Approved under '{run.rule_name}'." + (" It now waits for its compensating controls." if opened else ""), exc.id)
        else:
            run.asked = R.asked_now(step, approvers)
            _alert(db, exc.tenant_id, run.asked, f"Exception to {'review' if step['kind'] == 'review' else 'approve'}: {exc.title}",
                   f"It is now your turn at step {step['position']} ({step['name']}).", exc.id)
        flag_modified(run, "asked")
    exc.updated_at = run.updated_at = now
    db.flush()
    return run


def withdraw(db: Session, exc: PolicyException, user: GRCUser) -> ExceptionApprovalRun:
    """Take a waiting exception back to a draft (its rule and steps are chosen again when it is submitted again)."""
    run = open_run(db, exc)
    if run is None:
        raise _problem(NO_RUN, status.HTTP_409_CONFLICT)
    run = _lock(db, ExceptionApprovalRun, run.id)
    if run.status != "open":
        raise _problem(NO_RUN, status.HTTP_409_CONFLICT)
    now = datetime.utcnow()
    run.status, run.finished_at, run.asked = "withdrawn", now, []
    exc.status, exc.updated_at, run.updated_at = "draft", now, now
    _log(db, exc, user.id, "Withdrawn", None)
    db.flush()
    return run


def locked_fields(db: Session, exc: PolicyException, data: Dict[str, Any]) -> Optional[str]:
    """The sentence to refuse an edit with while a run is open and the edit changes what chose its rule; None when it is fine."""
    if open_run(db, exc) is None:
        return None

    def same(field: str, value: Any) -> bool:
        if field == "priority":
            return str(value or "").lower() == str(getattr(exc, field) or "").lower()
        if field == "exception_type":
            return str(value or "").strip() == str(exc.exception_type or "")
        try:
            return (int(value) if value not in (None, "", 0) else None) == (getattr(exc, field) or None)
        except (TypeError, ValueError):
            return False

    return LOCKED if any(field in data and not same(field, data[field]) for field in LOCKED_FIELDS) else None


# ── what the API shows ───────────────────────────────────────────────────────
def _step_view(db: Session, step: Dict[str, Any], decisions: Sequence[ExceptionApprovalDecision], names: Dict[int, str], now: datetime) -> Dict[str, Any]:
    mine = [d for d in decisions if d.step_position == step["position"]]
    approvers = {d.user_id for d in mine if d.decision == "approve"}
    due = _when(step.get("due_at"))
    slots = [{"label": s["label"], "answered": bool(set(s.get("members") or []) & approvers),
              "by": sorted({names.get(u, f"User #{u}") for u in set(s.get("members") or []) & approvers}, key=str.casefold),
              "people": sorted({names.get(u, f"User #{u}") for u in s.get("members") or []}, key=str.casefold)} for s in step.get("slots") or []]
    return {"position": step["position"], "name": step["name"], "kind": step["kind"], "order": step["order"], "rule": step["rule"],
            "min_count": step.get("min_count"), "due_days": step.get("due_days"), "allow_reject": step.get("allow_reject", False),
            "allow_changes": step.get("allow_changes", True), "state": step.get("state", "waiting"),
            "activated_at": step.get("activated_at"), "due_at": step.get("due_at"), "completed_at": step.get("completed_at"),
            "overdue": step.get("state") == "active" and due is not None and due < now, "slots": slots,
            "progress": R.progress(step, approvers) if step.get("slots") else {"required": 0, "answered": 0}}


def _run_view(db: Session, run: ExceptionApprovalRun, decisions: Sequence[ExceptionApprovalDecision], names: Dict[int, str],
              viewer_id: Optional[int], now: datetime) -> Dict[str, Any]:
    step = _step(run, run.current_step) if run.status == "open" else None
    mine = None
    if step is not None and viewer_id in (run.asked or []):
        from . import exception_risks

        mine = {"position": step["position"], "name": step["name"], "kind": step["kind"], "can_reject": bool(step.get("allow_reject")),
                "can_ask_changes": bool(step.get("allow_changes", True)),
                "assessment": exception_risks.assessment_for(db, run.id, run.exception_id, step["position"], viewer_id)}
    return {"run_id": run.id, "round": run.round, "status": run.status, "rule": {"id": run.rule_id, "name": run.rule_name},
            "department_id": run.department_id, "current_step": run.current_step,
            "steps": [_step_view(db, s, decisions, names, now) for s in run.steps or []],
            "asked": [{"id": u, "name": names.get(u, f"User #{u}")} for u in (run.asked or [])],
            "stalled": run.status == "open" and not run.asked, "my_step": mine,
            "started_at": _iso(run.started_at), "finished_at": _iso(run.finished_at),
            "decisions": [{"step_position": d.step_position, "step_name": d.step_name, "user_id": d.user_id,
                           "user_name": names.get(d.user_id, f"User #{d.user_id}"), "decision": d.decision, "comment": d.comment,
                           "decided_at": _iso(d.decided_at)} for d in decisions]}


def bulk_views(db: Session, exceptions: Sequence[PolicyException], viewer_id: Optional[int]) -> Dict[int, Dict[str, Any]]:
    """exception id -> the latest run as the API shows it, for those exceptions that have one (a few queries however many)."""
    ids = [e.id for e in exceptions]
    if not ids:
        return {}
    latest: Dict[int, ExceptionApprovalRun] = {}
    for run in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id.in_(ids)).order_by(ExceptionApprovalRun.round):
        if not _direct(run):                  # an approval with no rule has no rule to show
            latest[run.exception_id] = run
    if not latest:
        return {}
    by_run: Dict[int, List[ExceptionApprovalDecision]] = {r.id: [] for r in latest.values()}
    for d in db.query(ExceptionApprovalDecision).filter(ExceptionApprovalDecision.run_id.in_(list(by_run))) \
            .order_by(ExceptionApprovalDecision.decided_at, ExceptionApprovalDecision.id):
        by_run[d.run_id].append(d)
    people = {u for run in latest.values() for u in (run.asked or [])} | {d.user_id for ds in by_run.values() for d in ds}
    people |= {m for run in latest.values() for s in run.steps or [] for slot in s.get("slots") or [] for m in slot.get("members") or []}
    names = _names(db, people)
    now = datetime.utcnow()
    return {eid: _run_view(db, run, by_run[run.id], names, viewer_id, now) for eid, run in latest.items()}


def history(db: Session, exc: PolicyException, viewer_id: Optional[int]) -> Dict[str, Any]:
    """Every round: the rule, how it ended and who decided what at which step (the audit trail)."""
    runs = [r for r in runs_of(db, exc.id) if not _direct(r)]
    decisions = db.query(ExceptionApprovalDecision).filter(ExceptionApprovalDecision.exception_id == exc.id) \
        .order_by(ExceptionApprovalDecision.decided_at, ExceptionApprovalDecision.id).all()
    names = _names(db, {d.user_id for d in decisions} | {r.started_by for r in runs if r.started_by})
    return {"rounds": [{"round": r.round, "status": r.status, "rule_name": r.rule_name, "started_at": _iso(r.started_at),
                        "started_by": names.get(r.started_by), "finished_at": _iso(r.finished_at),
                        "decisions": [{"step_position": d.step_position, "step_name": d.step_name, "user_name": names.get(d.user_id),
                                       "decision": d.decision, "comment": d.comment, "decided_at": _iso(d.decided_at)}
                                      for d in decisions if d.run_id == r.id]} for r in runs]}


def _asked_anywhere(run: ExceptionApprovalRun, user_id: int) -> bool:
    """Asked at a step of the run, or (once it was approved) asked to implement it."""
    return user_id in (run.asked or []) or user_id in ((run.implementation or {}).get("asked") or [])


def involved(db: Session, exc: PolicyException, user_id: int) -> bool:
    """Whether the person was asked at a step of this exception or to implement it, or decided on it."""
    if db.query(ExceptionApprovalDecision.id).filter(ExceptionApprovalDecision.exception_id == exc.id,
                                                     ExceptionApprovalDecision.user_id == user_id).first() is not None:
        return True
    return any(_asked_anywhere(r, user_id) for r in runs_of(db, exc.id))


def involved_ids(db: Session, exception_ids: Iterable[int], user_id: int) -> Set[int]:
    """The ids among ``exception_ids`` the person was asked about at some step or to implement, or decided on (``involved`` for many at once)."""
    ids = list(exception_ids)
    if not ids:
        return set()
    out = {e for (e,) in db.query(ExceptionApprovalDecision.exception_id).filter(
        ExceptionApprovalDecision.exception_id.in_(ids), ExceptionApprovalDecision.user_id == user_id)}
    out |= {r.exception_id for r in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id.in_(ids)) if _asked_anywhere(r, user_id)}
    return out


def waiting_for(db: Session, user_id: int, tenant_ids: Iterable[int]) -> List[PolicyException]:
    """The exceptions waiting for this person to decide now."""
    ids = list(tenant_ids)
    if not ids:
        return []
    runs = [r for r in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.tenant_id.in_(ids), ExceptionApprovalRun.status == "open")
            if user_id in (r.asked or [])]
    if not runs:
        return []
    by_id = {e.id: e for e in db.query(PolicyException).filter(PolicyException.id.in_([r.exception_id for r in runs]))}
    return [by_id[r.exception_id] for r in sorted(runs, key=lambda r: r.started_at or datetime.min) if r.exception_id in by_id]


# ── the implementer (D62; D67: the person raising the exception chooses it, not the rule) ──────────
OPEN_IMPLEMENTATION = ("waiting", "in_progress")


def clean_implementer(db: Session, tenant_id: int, raw: Any) -> Optional[Dict[str, Any]]:
    """What the person raising an exception chose, as saved: nobody (None), or people and days, checked. A 400 with a sentence if it cannot work."""
    try:
        spec = R.validate_implementer(raw)
    except ValueError as exc:
        raise _problem(str(exc)) from None
    if spec:
        _check_people(db, tenant_id, [spec])
    return spec


def check_implementer(db: Session, exc: PolicyException) -> None:
    """Submitting: the implementer chosen can act now. A person who left, or the owner of a unit that has none, would leave the exception
    approved with nobody to carry it out, so it is refused in words (409) and nothing changes."""
    if not exc.implementer:
        return
    tree = org_departments.Tree.load(db, exc.tenant_id)
    unit = unit_of(db, exc)
    slots = resolve_slots(db, exc.tenant_id, unit, {"people": exc.implementer.get("people") or []}, None, tree)
    bad = R.implementer_problems({**exc.implementer, "slots": slots}, _unit_name(tree, unit))
    if bad:
        raise _problem(" ".join(bad) + " Choose who implements it, then submit again.", status.HTTP_409_CONFLICT)


def bulk_implementer_views(db: Session, exceptions: Sequence[PolicyException]) -> Dict[int, Dict[str, Any]]:
    """exception id -> the implementer its requester chose, with the people named, for those that have one (a few queries however many)."""
    given = {e.id: e.implementer for e in exceptions if e.implementer}
    people = [p for spec in given.values() for p in spec.get("people") or []]
    if not people:
        return {}
    users = _names(db, {p["id"] for p in people if p["type"] == "user"})
    role_ids = {p["id"] for p in people if p["type"] == "role"}
    roles = {i: n for i, n in db.query(Role.id, Role.name).filter(Role.id.in_(role_ids))} if role_ids else {}
    return {eid: {"due_days": spec.get("due_days"), "people": [{**p, "label": _person_label(p, users, roles)} for p in spec.get("people") or []]}
            for eid, spec in given.items()}


def open_implementation(db: Session, run: ExceptionApprovalRun, exc: PolicyException) -> bool:
    """The last approval is given and the exception has an implementer: its people are read as they are now (the requester is not left out: a
    small organisation's owner may be its coordinator), its days start, and they are told. False when the exception has none."""
    spec = exc.implementer
    if not spec:
        return False
    run.implementer = copy.deepcopy(spec)
    slots = resolve_slots(db, exc.tenant_id, run.department_id, {"people": spec.get("people") or []}, None)
    members = sorted({m for s in slots for m in s["members"]})
    now = datetime.utcnow()
    due_days = spec.get("due_days")
    run.implementation = {"name": spec.get("name") or R.IMPLEMENTER_NAME, "slots": slots, "asked": members, "due_days": due_days,
                          "due_at": (now + timedelta(days=due_days)).isoformat() if due_days else None, "opened_at": now.isoformat(),
                          "completed_by": None, "completed_at": None, "note": None}
    flag_modified(run, "implementation")
    run.implementation_state = "waiting"
    _alert(db, exc.tenant_id, members, f"Exception to implement: {exc.title}",
           f"\"{exc.title}\" was approved. You are asked to carry it out: record its compensating controls.", exc.id)
    return True


def _direct(run: ExceptionApprovalRun) -> bool:
    """The closed run an approval with no rule leaves to hold its implementation (``open_direct_implementation``): it has no rule and no steps."""
    return run.rule_id is None and not run.steps


def open_direct_implementation(db: Session, exc: PolicyException, user: GRCUser) -> bool:
    """An exception approved with no rule (the older flow) that names an implementer: a closed run holds the implementation, and the potential
    risks its approvers recorded (they had no run) move to it so the implementer sees them. False when it has no implementer."""
    if not exc.implementer:
        return False
    now = datetime.utcnow()
    run = ExceptionApprovalRun(tenant_id=exc.tenant_id, exception_id=exc.id, round=max((r.round for r in runs_of(db, exc.id)), default=0) + 1,
                               department_id=unit_of(db, exc), steps=[], status="approved", asked=[], started_by=user.id, started_at=now, finished_at=now)
    db.add(run)
    db.flush()
    db.query(ExceptionRisk).filter(ExceptionRisk.exception_id == exc.id, ExceptionRisk.run_id.is_(None)) \
        .update({"run_id": run.id, "round": run.round}, synchronize_session=False)
    return open_implementation(db, run, exc)


def cancel_implementation(db: Session, exc: PolicyException) -> None:
    """The exception was revoked before its implementation was finished: nothing is left to implement."""
    now = datetime.utcnow()
    for run in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id == exc.id,
                                                     ExceptionApprovalRun.implementation_state.in_(OPEN_IMPLEMENTATION)):
        impl = copy.deepcopy(run.implementation or {})
        impl["cancelled_at"] = now.isoformat()
        run.implementation = impl
        flag_modified(run, "implementation")
        run.implementation_state, run.updated_at = "cancelled", now


def _implementation_view(run: ExceptionApprovalRun, exc: PolicyException, names: Dict[int, str], viewer_id: Optional[int], now: datetime,
                         controls: List[Sequence[int]], risk_ids: Sequence[int]) -> Dict[str, Any]:
    impl = run.implementation or {}
    state = run.implementation_state
    due = _when(impl.get("due_at"))
    asked = impl.get("asked") or []
    mine = state in OPEN_IMPLEMENTATION and exc.status == "approved" and viewer_id in asked
    covered = {int(i) for ids in controls for i in (ids or [])}
    return {"state": state, "name": impl.get("name") or R.IMPLEMENTER_NAME, "asked": [{"id": u, "name": names.get(u, f"User #{u}")} for u in asked],
            "due_at": impl.get("due_at"), "overdue": state in OPEN_IMPLEMENTATION and due is not None and due < now,
            "opened_at": impl.get("opened_at"), "completed_at": impl.get("completed_at"),
            "completed_by_name": names.get(impl.get("completed_by")) if impl.get("completed_by") else None, "note": impl.get("note"),
            "stalled": state in OPEN_IMPLEMENTATION and not asked, "my_turn": mine, "can_complete": mine,
            "controls_count": len(controls), "risks_count": len(risk_ids), "uncovered_count": len([r for r in risk_ids if r not in covered])}


def _implementation_views(db: Session, runs: Dict[int, ExceptionApprovalRun], by_id: Dict[int, PolicyException],
                          viewer_id: Optional[int]) -> Dict[int, Dict[str, Any]]:
    """exception id -> the implementation as the API shows it, for the given runs (a few queries however many)."""
    if not runs:
        return {}
    run_ids = [r.id for r in runs.values()]
    controls: Dict[int, List[Sequence[int]]] = defaultdict(list)
    for run_id, risk_ids in db.query(ExceptionControl.run_id, ExceptionControl.risk_ids).filter(ExceptionControl.run_id.in_(run_ids)):
        controls[run_id].append(risk_ids or [])
    risks: Dict[int, List[int]] = defaultdict(list)
    for rid, run_id in db.query(ExceptionRisk.id, ExceptionRisk.run_id).filter(ExceptionRisk.run_id.in_(run_ids), ExceptionRisk.none_identified.is_(False)):
        risks[run_id].append(rid)
    people = {u for r in runs.values() for u in ((r.implementation or {}).get("asked") or [])}
    people |= {(r.implementation or {}).get("completed_by") for r in runs.values() if (r.implementation or {}).get("completed_by")}
    names = _names(db, people)
    now = datetime.utcnow()
    return {eid: _implementation_view(run, by_id[eid], names, viewer_id, now, controls[run.id], risks[run.id]) for eid, run in runs.items() if eid in by_id}


def bulk_implementations(db: Session, exceptions: Sequence[PolicyException], viewer_id: Optional[int]) -> Dict[int, Dict[str, Any]]:
    """exception id -> its latest implementation as the API shows it, for those that have one."""
    ids = [e.id for e in exceptions]
    if not ids:
        return {}
    latest: Dict[int, ExceptionApprovalRun] = {}
    for run in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.exception_id.in_(ids), ExceptionApprovalRun.implementation_state.isnot(None)) \
            .order_by(ExceptionApprovalRun.round):
        latest[run.exception_id] = run
    return _implementation_views(db, latest, {e.id: e for e in exceptions}, viewer_id)


def implementation_view(db: Session, run: ExceptionApprovalRun, exc: PolicyException, viewer_id: Optional[int]) -> Dict[str, Any]:
    return _implementation_views(db, {exc.id: run}, {exc.id: exc}, viewer_id)[exc.id]


def to_implement_for(db: Session, user_id: int, tenant_ids: Iterable[int]) -> List[PolicyException]:
    """The approved exceptions waiting for this person to implement them now."""
    ids = list(tenant_ids)
    if not ids:
        return []
    runs = [r for r in db.query(ExceptionApprovalRun).filter(ExceptionApprovalRun.tenant_id.in_(ids), ExceptionApprovalRun.implementation_state.in_(OPEN_IMPLEMENTATION))
            if user_id in ((r.implementation or {}).get("asked") or [])]
    if not runs:
        return []
    by_id = {e.id: e for e in db.query(PolicyException).filter(PolicyException.id.in_([r.exception_id for r in runs]), PolicyException.status == "approved")}
    return [by_id[r.exception_id] for r in sorted(runs, key=lambda r: (r.implementation or {}).get("opened_at") or "") if r.exception_id in by_id]
