"""SLA engine — native FastAPI port of Frappe Helpdesk's SLA logic.

1:1 translation of the owned source (logic spec §1), not a redesign:
  * selection      — hd_service_level_agreement/utils.py:get_sla
  * business math   — hd_service_level_agreement.py:calc_time / calc_elapsed_time
  * apply sequence  — hd_service_level_agreement.py:apply (+ set_hold_time,
                      handle_agreement_status, set_first_response_time,
                      set_resolution_time) and hd_ticket.py:clear_sla_fields

Works on the native SQLAlchemy rows (_60_helpdesk_native_models) instead of
Frappe Documents: Frappe string links become FK ids, `Time` columns are
datetime.time (not timedelta), and `now` is datetime.utcnow(). Every function
returns a 200-safe shape and never raises on empty input.
"""
from __future__ import annotations

import ast
import json
from datetime import date, datetime, time as dtime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    HDHoliday,
    HDServiceDay,
    HDServiceHolidayList,
    HDServiceLevelAgreement,
    HDServiceLevelPriority,
    HDSLATarget,
    Team,
    HDTicket,
    HDTicketPriority,
    get_db,
)
from .common import iso, require_view, require_masterdata_view, tenant_id
try:  # Agent-1 adds this to common.py; resolves at runtime, fallback pre-merge
    from .common import require_settings_manage
except ImportError:  # pragma: no cover
    from ...routers.auth_router import require_tenant_permission
    require_settings_manage = require_tenant_permission("helpdesk:settings:manage")

RESOLVED = "Resolved"
PAUSED = "Paused"

# frappe.utils.get_weekdays() — Monday-first, matching datetime.weekday() (0=Mon)
_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday",
             "Friday", "Saturday", "Sunday"]


# ─── low-level helpers ───────────────────────────────────────────────────────
def _secs(t) -> float:
    """utils.py:convert_to_seconds — seconds since midnight of a time/datetime."""
    if not t:
        return 0
    return t.hour * 3600 + t.minute * 60 + t.second


def _day_start(dt: datetime) -> datetime:
    """Midnight of `dt`'s date (Frappe's `getdate(add_to_date(...))` cursor jump)."""
    return datetime.combine(dt.date(), dtime.min)


def _workdays(sla) -> dict:
    """get_workdays() — {weekday name: HDServiceDay row}."""
    return {d.workday: d for d in sla.service_days}


def _holidays(sla) -> set:
    """get_holidays() — set of holiday dates (empty when no holiday list)."""
    hl = sla.holiday_list
    return {h.holiday_date for h in hl.holidays} if hl else set()


def _priority_row(sla, priority_id):
    """get_priorities()[priority] — the per-priority target row for this ticket."""
    for p in sla.priorities:
        if p.priority_id == priority_id:
            return p
    return None


def _calc_time(start_at, target_seconds, holidays, workdays, hold_time=0):
    """hd_service_level_agreement.py:calc_time — walk business time forward from
    `start_at` by `target_seconds` (+`hold_time` for resolution), skipping
    holidays and non-working days and clamping each day to its workday window.
    Returns the deadline datetime. Reimplemented exactly, including the
    `max(end_time, current_time_in_seconds)` skip-past-shift-end behaviour."""
    if not start_at:
        return None
    result = start_at
    remaining = (target_seconds or 0) + (hold_time or 0)
    guard = 0
    while remaining > 0:
        guard += 1
        if guard > 20000:
            # ponytail: ceiling guards a calendar with no working day at all;
            # a real budget exhausts in far fewer iterations.
            break
        current_dt = result
        current_date = current_dt.date()
        current_day = _WEEKDAYS[current_dt.weekday()]

        if current_date in holidays or current_day not in workdays:
            result = _day_start(current_dt + timedelta(days=1))
            continue

        wd = workdays[current_day]
        current_time_in_seconds = (current_dt - _day_start(current_dt)).total_seconds()
        start_time = max(_secs(wd.start_time), current_time_in_seconds)
        till_start_time = max(start_time - current_time_in_seconds, 0)
        end_time = max(_secs(wd.end_time), current_time_in_seconds)
        time_left = max(end_time - start_time, 0)
        if not time_left:
            result = _day_start(current_dt + timedelta(days=1))
            continue
        time_taken = min(remaining, time_left)
        remaining -= time_taken
        result = result + timedelta(seconds=till_start_time + time_taken)
    return result


def _calc_elapsed_time(start_time, end_time, holidays, workdays):
    """hd_service_level_agreement.py:calc_elapsed_time — working seconds between
    two datetimes, skipping holidays/non-work-days and clamping the first day's
    lower bound and the last day's upper bound to the workday window."""
    if not start_time or not end_time or start_time >= end_time:
        return 0
    total = 0
    current_date = start_time.date()
    end_date = end_time.date()
    while current_date <= end_date:
        if current_date in holidays:
            current_date += timedelta(days=1)
            continue
        day_name = _WEEKDAYS[current_date.weekday()]
        if day_name not in workdays:
            current_date += timedelta(days=1)
            continue
        wd = workdays[day_name]
        work_start = _secs(wd.start_time)
        work_end = _secs(wd.end_time)
        day_start = max(_secs(start_time), work_start) if current_date == start_time.date() else work_start
        day_end = min(_secs(end_time), work_end) if current_date == end_time.date() else work_end
        if day_start < day_end:
            total += day_end - day_start
        current_date += timedelta(days=1)
    return total


# ─── SLA selection (utils.py:get_sla) ────────────────────────────────────────
class _Doc(dict):
    """Attribute-accessible ticket view for condition eval; `doc.x` and
    `doc.get('x')` both work (frappe._dict parity)."""
    __getattr__ = dict.get


def _ctx(ticket) -> dict:
    """utils.get_context — the serialized ticket a condition is evaluated against.
    Link fields are exposed by their human value (Frappe field semantics), not
    FK ids, so authored conditions like `doc.priority == 'High'` work."""
    return {"doc": _Doc(
        subject=ticket.subject,
        status=ticket.status.label_agent if ticket.status else None,
        status_category=ticket.status_category,
        priority=(ticket.priority.name or ticket.priority.level) if ticket.priority else None,
        ticket_type=ticket.ticket_type.name if ticket.ticket_type else None,
        agent_group=ticket.team.name if ticket.team else None,
        customer=ticket.customer.customer_name if ticket.customer else None,
        contact=ticket.contact,
        raised_by=ticket.raised_by,
        process=ticket.process,  # ITSM: per-process SLAs key on doc.process
    )}


# ─── safe condition evaluator (B1: replaces the escapable eval sandbox) ───────
# The SLA `condition` is a tenant-authored boolean expression over the ticket
# fields `_ctx` exposes (`doc.<field>`). It used to run through
# `eval(..., {"__builtins__": {}}, ctx)`, which is NOT a sandbox: attribute
# access alone — `().__class__.__bases__[0].__subclasses__()` — walks to any
# class (subprocess, os-importing gadgets) → RCE on the backend host. This
# evaluator PARSES the expression and walks it against a STRICT allowlist,
# executing it WITHOUT eval/exec. Anything outside the allowlist (calls,
# subscripts, lambdas, comprehensions, dunder/foreign names, non-`doc`
# attribute roots, nested attribute walks) raises ConditionError.
_DOC_FIELDS = frozenset({
    "subject", "status", "status_category", "priority", "ticket_type",
    "agent_group", "customer", "contact", "raised_by", "process",
})

_CMP_OPS = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: a < b,
    ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}


class ConditionError(ValueError):
    """A condition used a construct outside the strict allowlist (or is invalid
    syntax). Subclasses ValueError so the existing `except Exception` guards in
    `_get_sla` (skip) and `_validate_condition` (-> HTTP 400) catch it."""


def _reject(node: ast.AST):
    raise ConditionError(f"disallowed expression element: {type(node).__name__}")


def _doc_field(doc, attr: str):
    """Read `doc.<attr>` for an allow-listed scalar field only. `attr` is already
    checked against `_DOC_FIELDS` (no dunders) by the caller, so this can never
    reach Python internals; works for a `_Doc`/dict or a plain object."""
    if isinstance(doc, dict):
        return doc.get(attr)
    return getattr(doc, attr, None)


def _eval_node(node: ast.AST, doc):
    """Evaluate ONE allow-listed node, returning its Python value. Raises
    ConditionError for anything not explicitly permitted."""
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for value in node.values:
                result = _eval_node(value, doc)
                if not result:
                    return result
            return result
        if isinstance(node.op, ast.Or):
            result = False
            for value in node.values:
                result = _eval_node(value, doc)
                if result:
                    return result
            return result
        _reject(node)
    if isinstance(node, ast.UnaryOp):
        if isinstance(node.op, ast.Not):          # UnaryOp: Not ONLY
            return not _eval_node(node.operand, doc)
        _reject(node)                             # USub/UAdd/Invert disallowed
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, doc)
        for op, comparator in zip(node.ops, node.comparators):
            if type(op) not in _CMP_OPS:
                _reject(op)
            right = _eval_node(comparator, doc)
            if not _CMP_OPS[type(op)](left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.Attribute):
        # ONLY `doc.<field>` — one level deep, root must be the `doc` Name, the
        # field an allow-listed non-dunder scalar. Blocks `doc.__class__`,
        # `x.y.z`, `foo.bar`, any attribute walk.
        if not (isinstance(node.value, ast.Name) and node.value.id == "doc"):
            _reject(node)
        attr = node.attr
        if attr.startswith("__") or attr not in _DOC_FIELDS:
            _reject(node)
        return _doc_field(doc, attr)
    if isinstance(node, ast.Name):
        if node.id != "doc":                      # no foreign names (os, cycler…)
            _reject(node)
        return doc
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.List, ast.Tuple)):   # literal containers (for `in`)
        values = []
        for elt in node.elts:
            if not isinstance(elt, ast.Constant):
                _reject(elt)
            values.append(elt.value)
        return values if isinstance(node, ast.List) else tuple(values)
    _reject(node)   # Call, Subscript, Lambda, comprehensions, Dict, Set, Starred…


def safe_condition_eval(condition: str, context: dict) -> bool:
    """Safely evaluate a tenant-authored SLA `condition` against `context`
    (`{"doc": <ticket view>}`) with NO eval/exec. Returns the boolean result;
    raises ConditionError on invalid syntax or any construct outside the strict
    allowlist (the escapable-eval RCE class, B1)."""
    if not condition or not isinstance(condition, str):
        return False
    try:
        tree = ast.parse(condition, mode="eval")
    except SyntaxError as exc:
        raise ConditionError(f"invalid condition syntax: {exc}") from exc
    doc = context.get("doc") if isinstance(context, dict) else None
    return bool(_eval_node(tree.body, doc))


def _get_sla(db: Session, ticket):
    """utils.py:get_sla — the SLA that applies to `ticket`, or None.

    Enabled + inside [start_date, end_date] (null bound = open); if the ticket
    has a priority, only SLAs that define it. Ordered default_sla ASC (Default
    last), ranked-before-unranked, rank ASC, creation ASC; a default_sla row
    wins immediately, a blank condition is skipped, otherwise first truthy
    condition wins."""
    today = datetime.utcnow().date()
    cands = (
        db.query(HDServiceLevelAgreement)
        .filter(
            HDServiceLevelAgreement.tenant_id == ticket.tenant_id,
            HDServiceLevelAgreement.enabled == True,  # noqa: E712
        )
        .all()
    )
    cands = [
        s for s in cands
        if (s.start_date is None or s.start_date <= today)
        and (s.end_date is None or s.end_date >= today)
    ]
    if ticket.priority_id:
        cands = [s for s in cands
                 if any(p.priority_id == ticket.priority_id for p in s.priorities)]
    cands.sort(key=lambda s: (
        1 if s.default_sla else 0,        # Default considered last
        0 if (s.rank or 0) else 1,        # ranked before unranked (rank 0/None)
        s.rank or 0,
        s.created_at or datetime.min,
    ))

    context = None
    for s in cands:
        if s.default_sla:
            return s
        if not s.condition:
            continue  # a blank condition is not a false positive
        if context is None:
            context = _ctx(ticket)
        try:
            if safe_condition_eval(s.condition, context):
                # B1: AST allow-list evaluation (no eval/exec). A malformed or
                # disallowed condition raises ConditionError and is skipped.
                return s
        except Exception:
            continue
    return None


# ─── apply() sub-steps (hd_service_level_agreement.py) ────────────────────────
def _set_first_response_time(ticket, start, holidays, workdays):
    """set_first_response_time (:212)."""
    if not start or not ticket.first_responded_on:
        return
    ticket.first_response_time = _calc_elapsed_time(
        start, ticket.first_responded_on, holidays, workdays)
    if ticket.response_by and ticket.first_responded_on > ticket.response_by:
        ticket.first_response_failed_by = _calc_elapsed_time(
            ticket.response_by, ticket.first_responded_on, holidays, workdays)


def _set_hold_time(ticket, prev_status_category, now, holidays, workdays):
    """set_hold_time (:242). "Paused" is driven by status CATEGORY. Entering
    pause parks the deadlines + stamps on_hold_since; resuming nulls it and
    accrues the business-seconds held into total_hold_time."""
    was_paused = prev_status_category == PAUSED
    is_paused = ticket.status_category == PAUSED
    paused_since = ticket.on_hold_since
    if not paused_since and ticket.status_category != RESOLVED:
        # time spent resolved counts as hold only when reopened. ponytail: the
        # ticket core nulls the old resolution_date before recompute runs under
        # this wiring, so that fallback can only read what's still on the row.
        paused_since = ticket.resolution_date
    if is_paused and not was_paused:
        ticket.response_by = ticket.resolution_by if ticket.first_responded_on else None
        ticket.resolution_date = None
        ticket.resolution_by = None
        ticket.resolution_time = None
        ticket.on_hold_since = now
    elif not is_paused and was_paused:
        ticket.on_hold_since = None
    if is_paused or not paused_since:
        return
    ticket.on_hold_since = None
    ticket.total_hold_time = (ticket.total_hold_time or 0) + max(
        _calc_elapsed_time(paused_since, now, holidays, workdays), 0)


def _set_resolution_time(ticket, start, holidays, workdays):
    """set_resolution_time (:225) — effective business-seconds to resolve
    (hold time subtracted); resolution_failed_by if past the deadline."""
    if not ticket.resolution_date:
        return
    time_took = _calc_elapsed_time(start, ticket.resolution_date, holidays, workdays)
    ticket.resolution_time = max(time_took - (ticket.total_hold_time or 0), 0)
    if ticket.resolution_by and ticket.resolution_date > ticket.resolution_by:
        ticket.resolution_failed_by = _calc_elapsed_time(
            ticket.resolution_by, ticket.resolution_date, holidays, workdays)


def _handle_agreement_status(ticket, sla, now):
    """handle_agreement_status (:295) — first true wins: Failed → Paused →
    First Response Due → Resolution Due → Fulfilled. get_active_ticket_time =
    on_hold_since when paused else now."""
    active = ticket.on_hold_since or now
    first_failed = bool(ticket.response_by) and \
        ticket.response_by < (ticket.first_responded_on or active)
    reso_failed = bool(sla.apply_sla_for_resolution) and bool(ticket.resolution_by) and \
        ticket.resolution_by < (ticket.resolution_date or active)
    if first_failed or reso_failed:
        ticket.agreement_status = "Failed"
    elif ticket.on_hold_since:
        ticket.agreement_status = "Paused"
    elif not ticket.first_responded_on:
        ticket.agreement_status = "First Response Due"
    elif sla.apply_sla_for_resolution and not ticket.resolution_date:
        ticket.agreement_status = "Resolution Due"
    else:
        ticket.agreement_status = "Fulfilled"


# ─── public entry points ─────────────────────────────────────────────────────
def compute_sla_block(db: Session, ticket) -> dict:
    """§A4 nested `sla` block from the ticket's persisted SLA fields + policy.
    FE derives badge state from the timestamps, breach colour from `breached`
    (= status Failed). Safe when no SLA attaches (all null)."""
    status = ticket.agreement_status
    return {
        "policy": ticket.sla.service_level if ticket.sla else None,
        "agreement_status": status,
        "breached": status == "Failed",
        "first_responded_on": iso(ticket.first_responded_on),
        "resolution_date": iso(ticket.resolution_date),
        "response_by": iso(ticket.response_by),
        "resolution_by": iso(ticket.resolution_by),
        "on_hold_since": iso(ticket.on_hold_since),
        "first_response_failed_by": ticket.first_response_failed_by,
        "resolution_failed_by": ticket.resolution_failed_by,
        "total_hold_time": ticket.total_hold_time,
    }


# ─── ITSM SLA targets (flow #4) ──────────────────────────────────────────────
# The workbook's SLA sheet is ingested into grc_hd_sla_target (process + priority
# + window + response/resolution minutes), NOT the Frappe HDServiceLevelAgreement
# policy table. When a tenant has no Frappe policy for a ticket (the ITSM case),
# the clock is driven from the matching ingested target instead. 24x7 baseline:
# due = anchor + minutes (elapsed), with a simple pause that freezes the clock
# while the ticket is Paused and pushes resolution_by by the held time on resume.
# (Business-hours-window math stays the Frappe engine's job when a policy exists.)

def _itsm_target(db: Session, ticket):
    """The ingested SLA target that drives this ticket's clock, or None.

    Matching is robust to the ingested sheet's shape. The bug it fixes: only the
    incident rows are keyed by priority_code (P1–P5); the service_request / change
    / problem rows are keyed by process-specific labels with a NULL priority_code,
    so a priority-code-only match stranded every non-incident ticket — the ticket
    carried a real priority (code P1–P5) that no row's NULL code equalled, so
    `_itsm_target` returned None and the ticket got no response/resolution due
    date (portal: "As soon as we can"). Resolution order:
      1. exact priority_code                    — incident P1–P5 (unchanged);
      2. priority_label == the ticket priority's name/level — e.g. a problem
         ticket with priority 'High' matches the problem 'High' tier;
      3. per-process default — the first row that carries a resolution clock,
         else the lowest-sort_order row — so a process whose rows are not
         priority-keyed (service_request 'Standard', change 'Normal') still gets
         its baseline tier instead of nothing.
    """
    process = (ticket.process or "incident").lower()
    rows = (db.query(HDSLATarget)
            .filter(HDSLATarget.tenant_id == ticket.tenant_id,
                    func.lower(HDSLATarget.process) == process)
            .order_by(HDSLATarget.sort_order.asc().nullslast(),
                      HDSLATarget.id.asc())
            .all())
    if not rows:
        return None
    code = ticket.priority.code if ticket.priority else None
    if code:
        for r in rows:
            if r.priority_code == code:
                return r
    if ticket.priority:
        labels = {v.lower() for v in (ticket.priority.name, ticket.priority.level) if v}
        for r in rows:
            if r.priority_label and r.priority_label.lower() in labels:
                return r
    for r in rows:
        if r.resolution_minutes:
            return r
    return rows[0]


def _itsm_agreement_status(ticket, now: datetime) -> None:
    if ticket.status_category == RESOLVED:
        ticket.agreement_status = (
            "Failed" if (ticket.resolution_by and ticket.resolution_date
                         and ticket.resolution_date > ticket.resolution_by)
            else "Fulfilled")
        return
    if ticket.status_category == PAUSED or (ticket.approval_state or "") == "pending_approval":
        ticket.agreement_status = "Paused"
        return
    breached = ((ticket.response_by and not ticket.first_responded_on and now > ticket.response_by)
                or (ticket.resolution_by and now > ticket.resolution_by))
    ticket.agreement_status = ("Failed" if breached
                               else ("First Response Due" if not ticket.first_responded_on
                                     else "Resolution Due"))


def _apply_itsm_target(ticket, tgt, now: datetime,
                       prev_status_category: Optional[str] = None) -> None:
    """Set response_by / resolution_by from an ingested target, with a simple
    elapsed-time pause (freeze while Paused, extend resolution by held time)."""
    if not ticket.service_level_agreement_creation:
        ticket.service_level_agreement_creation = ticket.created_at or now
    anchor = ticket.service_level_agreement_creation
    ticket.sla_id = None  # no Frappe policy drives this ticket

    # Paused by an explicit Paused status OR by an open approval (#3 bridge): the
    # SLA clock freezes while a change waits for CAB sign-off. Resume is detected
    # by on_hold_since being set while no longer paused — robust whether the pause
    # came from a status change or an approval, and independent of prev category.
    cat = ticket.status_category
    paused = (cat == PAUSED) or ((ticket.approval_state or "") == "pending_approval")
    if paused and ticket.on_hold_since is None:
        ticket.on_hold_since = now
    held = float(ticket.total_hold_time or 0)
    if (not paused) and ticket.on_hold_since:
        held += (now - ticket.on_hold_since).total_seconds()
        ticket.total_hold_time = held
        ticket.on_hold_since = None

    resp = int(tgt.response_minutes or 0)
    reso = int(tgt.resolution_minutes or 0)
    ticket.response_by = (anchor + timedelta(minutes=resp)) if resp else None
    ticket.resolution_by = (anchor + timedelta(minutes=reso) + timedelta(seconds=held)) if reso else None
    _itsm_agreement_status(ticket, now)


def recompute(db: Session, ticket, *, prev_status_category: Optional[str] = None) -> None:
    """Apply the SLA after a status/field change — the native equivalent of
    set_sla + HDServiceLevelAgreement.apply (spec §1.1–§1.6). Mutates the
    ticket in place; the caller commits.

    Picks the policy via get_sla; with none, clear_sla_fields (hd_ticket.py:977)
    drops policy + targets while keeping the clock, keeping on_hold_since while
    Paused and agreement_status while Failed (both sticky). With a policy, runs
    apply() in Frappe's exact order so first-response/hold/resolution metrics
    read the OLD deadlines before handle_targets resets them."""
    now = datetime.utcnow()
    sla = _get_sla(db, ticket)
    if not sla:
        # flow #4: no Frappe policy — drive the clock from the ingested ITSM target
        # for this process+priority when one exists.
        tgt = _itsm_target(db, ticket)
        if tgt is not None:
            _apply_itsm_target(ticket, tgt, now, prev_status_category=prev_status_category)
            return
        ticket.sla_id = None
        ticket.response_by = None
        ticket.resolution_by = None
        if ticket.status_category != PAUSED:
            ticket.on_hold_since = None
        if ticket.agreement_status != "Failed":
            ticket.agreement_status = None
        return

    ticket.sla_id = sla.id
    holidays = _holidays(sla)
    workdays = _workdays(sla)

    # 1. set_default_priority
    if not ticket.priority_id and sla.default_priority_id:
        ticket.priority_id = sla.default_priority_id
    # 2. start_clock — stamp the target anchor once, when the SLA attaches
    if not ticket.service_level_agreement_creation:
        ticket.service_level_agreement_creation = now
    start = ticket.service_level_agreement_creation
    # 3. handle_doc_status (order matters: reads the previous deadlines)
    _set_first_response_time(ticket, start, holidays, workdays)
    _set_hold_time(ticket, prev_status_category, now, holidays, workdays)
    _set_resolution_time(ticket, start, holidays, workdays)
    # 4. handle_targets — (re)compute response_by / resolution_by
    prow = _priority_row(sla, ticket.priority_id)
    resp_secs = (prow.response_time if prow else 0) or 0
    reso_secs = (prow.resolution_time if prow else 0) or 0
    ticket.response_by = _calc_time(start, resp_secs, holidays, workdays)
    ticket.resolution_by = _calc_time(
        start, reso_secs, holidays, workdays, hold_time=ticket.total_hold_time or 0)
    # 5. handle_agreement_status
    _handle_agreement_status(ticket, sla, now)


def _fmt_duration(secs) -> str:
    """Seconds → human string (`4h`, `2d`, `4h 30m`) for the config table."""
    secs = int(secs or 0)
    if secs <= 0:
        return "0"
    d, rem = divmod(secs, 86400)
    h, rem = divmod(rem, 3600)
    m, s = divmod(rem, 60)
    parts = []
    if d:
        parts.append(f"{d}d")
    if h:
        parts.append(f"{h}h")
    if m:
        parts.append(f"{m}m")
    if s:
        parts.append(f"{s}s")
    return " ".join(parts)


def _pick_config_sla(db: Session, tid):
    """Representative policy for the config view: default first, else best-ranked
    (the inverse of selection, which considers Default last)."""
    slas = (
        db.query(HDServiceLevelAgreement)
        .filter(
            HDServiceLevelAgreement.tenant_id == tid,
            HDServiceLevelAgreement.enabled == True,  # noqa: E712
        )
        .all()
    )
    if not slas:
        return None
    slas.sort(key=lambda s: (
        0 if s.default_sla else 1,
        0 if (s.rank or 0) else 1,
        s.rank or 0,
        s.created_at or datetime.min,
    ))
    return slas[0]


def config(db: Session, tid: int) -> dict:
    """§A20 read-only SLA config. Targets per priority (pre-formatted durations),
    service days as HH:MM:SS, holiday list, and auto_assignment = any team has an
    assignment rule (the assignment agent owns the rule logic). 200-safe: empty
    shape when nothing is configured."""
    sla = _pick_config_sla(db, tid)
    sla_block = {"policy": None, "priorities": [], "service_days": [], "holiday_list": None}
    if sla:
        sla_block = {
            "policy": sla.service_level,
            "priorities": [
                {
                    "priority": (p.priority.name or p.priority.level) if p.priority else None,
                    "response": _fmt_duration(p.response_time),
                    "resolution": _fmt_duration(p.resolution_time),
                }
                for p in sla.priorities
            ],
            "service_days": [
                {
                    "day": d.workday,
                    "start": d.start_time.strftime("%H:%M:%S") if d.start_time else None,
                    "end": d.end_time.strftime("%H:%M:%S") if d.end_time else None,
                }
                for d in sla.service_days
            ],
            "holiday_list": sla.holiday_list.holiday_list_name if sla.holiday_list else None,
        }
    # auto_assignment indicator: the native engine auto-assigns (round-robin /
    # load-balance) for any routed team that has agent members — there is no
    # per-team Frappe "assignment rule" string on the unified ComplyVerse teams. So the
    # signal is simply "at least one active ComplyVerse Administration team exists".
    auto_assignment = (
        db.query(Team)
        .filter(Team.tenant_id == tid, Team.is_active.is_(True))
        .first()
        is not None
    )
    return {"sla": sla_block, "auto_assignment": auto_assignment, "managed": True}


def sla_preview(db: Session, tid: int, process: Optional[str] = None,
                priority: str = "Medium") -> dict:
    """§A5 — the SLA that WOULD apply to a new ticket of this `process`, for the
    given `priority` (default Medium). Matches the per-process SLA by evaluating
    each enabled SLA's `condition` against a doc carrying only `process` (so the
    seeded `doc.process == '<x>'` policies match), falling back to the default
    SLA. 200-safe: nulls when nothing matches or the priority has no target row."""
    priority = priority or "Medium"
    slas = (
        db.query(HDServiceLevelAgreement)
        .filter(HDServiceLevelAgreement.tenant_id == tid,
                HDServiceLevelAgreement.enabled == True)  # noqa: E712
        .all()
    )
    context = {"doc": _Doc(process=process)}
    chosen = default = None
    for s in slas:
        if s.default_sla and default is None:
            default = s
        if not s.condition:
            continue
        try:
            if safe_condition_eval(s.condition, context):  # B1: no eval/exec
                chosen = s
                break
        except Exception:  # noqa: BLE001
            continue
    chosen = chosen or default
    if not chosen:
        return {"policy": None, "response": None, "resolution": None}
    prow = next((p for p in chosen.priorities
                 if ((p.priority.name or p.priority.level) if p.priority else None) == priority),
                None)
    if not prow:
        prow = next((p for p in chosen.priorities if p.default_priority), None)
    if not prow:
        return {"policy": chosen.service_level, "response": None, "resolution": None}
    return {
        "policy": chosen.service_level,
        "response": _fmt_duration(prow.response_time),
        "resolution": _fmt_duration(prow.resolution_time),
    }


# =============================================================================
# CONFIG WRITE-SIDE — native port of the Frappe doctype controllers' validate /
# before_save / on_update logic (CODE CONVERSION, not a redesign). Sources:
#   * hd_service_level_agreement/hd_service_level_agreement.py (validate*,
#     before_save, get_repeated)
#   * hd_service_holiday_list/hd_service_holiday_list.py (validate_days,
#     get_weekly_off_date*, clear_table, on_update -> recalculate_sla)
# Frappe Documents become native SQLAlchemy rows; frappe.throw -> HTTP 400;
# msgprint warnings -> returned `warnings` (never thrown — spec: "warn_* become
# no-ops or returned warnings"). Everything tenant-scoped.
# =============================================================================

# ─── parsing + small helpers ─────────────────────────────────────────────────
def _parse_time(v) -> Optional[dtime]:
    """'HH:MM[:SS]' / Time -> datetime.time (service-day start/end columns)."""
    if v in (None, ""):
        return None
    if isinstance(v, dtime):
        return v
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            return datetime.strptime(str(v), fmt).time()
        except ValueError:
            continue
    raise HTTPException(status_code=400, detail=f"invalid time '{v}'")


def _parse_date(v) -> Optional[date]:
    """'YYYY-MM-DD' / date -> datetime.date (holiday + SLA window columns)."""
    if v in (None, ""):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid date '{v}'")


def _get_repeated(values) -> str:
    """hd_service_level_agreement.py:get_repeated — space-joined duplicates."""
    seen, dupes = set(), []
    for v in values:
        if v in seen and v not in dupes:
            dupes.append(v)
        seen.add(v)
    return " ".join(str(v) for v in dupes)


def _priority_labels(db: Session, tid: int, ids) -> dict:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return {
        r.id: (r.name or r.level)
        for r in db.query(HDTicketPriority)
        .filter(HDTicketPriority.tenant_id == tid, HDTicketPriority.id.in_(ids))
        .all()
    }


# ─── SLA validators (hd_service_level_agreement.py) ──────────────────────────
def _validate_priority_rows(rows, apply_resolution: bool, labels: dict) -> None:
    """validate_priorities -> validate_priority_defaults + validate_response_and
    _resolution_time + validate_unique_priorities (:41–:77)."""
    if sum(1 for p in rows if p.default_priority) > 1:
        raise HTTPException(status_code=400,
                            detail="You cannot set more than one Default Priority.")
    pids = []
    for i, p in enumerate(rows, start=1):
        lbl = labels.get(p.priority_id, p.priority_id)
        if not p.response_time:
            raise HTTPException(status_code=400,
                                detail=f"Set Response Time for Priority {lbl} in row {i}.")
        if apply_resolution:
            if not p.resolution_time:
                raise HTTPException(status_code=400,
                                    detail=f"Set Resolution Time for Priority {lbl} in row {i}.")
            if (p.response_time or 0) > (p.resolution_time or 0):
                raise HTTPException(
                    status_code=400,
                    detail=(f"Response Time for {lbl} priority in row {i} "
                            "can't be greater than Resolution Time."))
        pids.append(p.priority_id)
    if len(pids) != len(set(pids)):
        raise HTTPException(status_code=400,
                            detail=f"Priority {_get_repeated(pids)} has been repeated.")


def _validate_service_days(rows) -> None:
    """validate_support_and_resolution (:121) — start < end, no repeated workday.
    Frappe marks start/end reqd, so a missing bound is a config error here too."""
    days = []
    for i, d in enumerate(rows, start=1):
        if d.start_time is None or d.end_time is None:
            raise HTTPException(status_code=400,
                                detail=f"Start Time and End Time are required in row {i}.")
        if d.start_time >= d.end_time:
            raise HTTPException(
                status_code=400,
                detail=f"Start Time can't be greater than or equal to End Time in row {i}.")
        days.append(d.workday)
    if len(set(days)) != len(days):
        raise HTTPException(status_code=400,
                            detail=f"Workday {_get_repeated(days)} has been repeated.")


def _validate_condition(condition, condition_json) -> None:
    """validate_condition (:160). The expression is checked against the SAME
    doc-only context the runtime selector (_get_sla) evaluates it in — narrower
    than Frappe's get_context (which also exposes frappe.utils), so a condition
    that validates here is one the runtime can actually evaluate."""
    if condition:
        try:
            safe_condition_eval(condition, _ctx_empty())  # B1: no eval/exec
        except Exception as e:  # noqa: BLE001 — surfaced to the author as 400
            raise HTTPException(status_code=400,
                                detail=f"The condition '{condition}' is invalid: {e}")
    if condition_json:
        # is_json_valid (helpdesk/utils.py:487) == json-parseable.
        try:
            json.loads(condition_json)
        except Exception:  # noqa: BLE001
            raise HTTPException(
                status_code=400,
                detail=("The condition json is invalid; use the portal view, "
                        "e.g. [['status','==','open']]."))


def _ctx_empty() -> dict:
    """get_context(new_doc) — an empty ticket: every field reads None (_Doc.get)."""
    return {"doc": _Doc()}


def _resolve_default_priority(rows) -> int:
    """before_save (:180) — the SLA's default_priority is the flagged child row;
    Frappe throws when none is flagged."""
    for p in rows:
        if p.default_priority:
            return p.priority_id
    raise HTTPException(status_code=400, detail="Select a Default Priority.")


def _enforce_single_default(db: Session, tid: int, is_default: bool,
                            new_name: str, self_id: Optional[int]) -> List[str]:
    """validate_default_sla (:143) — only one default SLA per tenant; setting
    this one flips the previous default off (returned as a warning)."""
    if not is_default:
        return []
    q = db.query(HDServiceLevelAgreement).filter(
        HDServiceLevelAgreement.tenant_id == tid,
        HDServiceLevelAgreement.default_sla == True,  # noqa: E712
    )
    if self_id is not None:
        q = q.filter(HDServiceLevelAgreement.id != self_id)
    other = q.first()
    if not other:
        return []
    other.default_sla = False
    return [f"Setting '{new_name}' as the default SLA removes '{other.service_level}' "
            f"as the default SLA. Add a condition to '{other.service_level}' for it "
            "to keep applying."]


def _open_ticket_count(db: Session, tid: int, sla_id: int,
                       priority_id: Optional[int] = None) -> int:
    """count_open_tickets (:114) — on-the-clock tickets (Paused counts; Resolved
    does not) on this SLA, optionally filtered to one priority."""
    q = db.query(func.count(HDTicket.id)).filter(
        HDTicket.tenant_id == tid,
        HDTicket.sla_id == sla_id,
        HDTicket.status_category != RESOLVED,
    )
    if priority_id is not None:
        q = q.filter(HDTicket.priority_id == priority_id)
    return q.scalar() or 0


def _detach_warnings(db: Session, tid: int, before: Optional[dict], sla) -> List[str]:
    """warn_removed_priorities (:79) + warn_detach_on_untick (:99) as returned
    warnings. `before` is the pre-save snapshot (None on create -> no warning)."""
    if not before:
        return []
    warns = []
    now_pids = {p.priority_id for p in sla.priorities}
    for pid in before["priority_ids"] - now_pids:
        c = _open_ticket_count(db, tid, sla.id, pid)
        if c:
            lbl = before["labels"].get(pid, pid)
            warns.append(f"{c} open ticket(s) use priority {lbl}. They lose this "
                         "SLA the next time they are updated.")
    for field, was_set in (("default_sla", before["default_sla"]),
                           ("enabled", before["enabled"])):
        if was_set and not getattr(sla, field):
            c = _open_ticket_count(db, tid, sla.id)
            if c:
                warns.append(f"{c} open ticket(s) will lose this SLA the next time "
                             "they are updated, unless another policy matches them.")
    return warns


# ─── SLA row builders + serialization ────────────────────────────────────────
def _build_priority_rows(payload_list) -> list:
    return [
        HDServiceLevelPriority(
            idx=i,
            priority_id=p.get("priority_id"),
            default_priority=bool(p.get("default_priority")),
            response_time=p.get("response_time") or 0,
            resolution_time=p.get("resolution_time"),
        )
        for i, p in enumerate(payload_list or [], start=1)
    ]


def _build_service_day_rows(payload_list) -> list:
    return [
        HDServiceDay(
            idx=i,
            workday=d.get("workday"),
            start_time=_parse_time(d.get("start_time")),
            end_time=_parse_time(d.get("end_time")),
        )
        for i, d in enumerate(payload_list or [], start=1)
    ]


_SLA_SCALARS = (
    "service_level", "description", "enabled", "default_sla", "rank",
    "condition", "condition_json", "apply_sla_for_resolution",
    "holiday_list_id", "default_priority_id",
    "default_ticket_status_id", "ticket_reopen_status_id",
)


def _apply_sla_scalars(sla, payload: dict) -> None:
    for f in _SLA_SCALARS:
        if f in payload and payload[f] is not None:
            setattr(sla, f, payload[f])
    if "start_date" in payload:
        sla.start_date = _parse_date(payload.get("start_date"))
    if "end_date" in payload:
        sla.end_date = _parse_date(payload.get("end_date"))


def _sla_detail(sla) -> dict:
    return {
        "name": str(sla.id),
        "service_level": sla.service_level,
        "description": sla.description,
        "enabled": bool(sla.enabled),
        "default_sla": bool(sla.default_sla),
        "rank": sla.rank,
        "condition": sla.condition,
        "condition_json": sla.condition_json,
        "start_date": sla.start_date.isoformat() if sla.start_date else None,
        "end_date": sla.end_date.isoformat() if sla.end_date else None,
        "apply_sla_for_resolution": bool(sla.apply_sla_for_resolution),
        "holiday_list_id": sla.holiday_list_id,
        "holiday_list": sla.holiday_list.holiday_list_name if sla.holiday_list else None,
        "default_priority_id": sla.default_priority_id,
        "priorities": [
            {
                "id": p.id,
                "priority_id": p.priority_id,
                "priority": (p.priority.name or p.priority.level) if p.priority else None,
                "default_priority": bool(p.default_priority),
                "response_time": p.response_time,
                "resolution_time": p.resolution_time,
            }
            for p in sla.priorities
        ],
        "service_days": [
            {
                "id": d.id,
                "workday": d.workday,
                "start_time": d.start_time.strftime("%H:%M:%S") if d.start_time else None,
                "end_time": d.end_time.strftime("%H:%M:%S") if d.end_time else None,
            }
            for d in sla.service_days
        ],
    }


def _get_sla_row(db: Session, tid: int, name: str):
    """Tenant-scoped fetch by contract `name` (int PK) — the isolation guard."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDServiceLevelAgreement)
        .filter(HDServiceLevelAgreement.id == pk,
                HDServiceLevelAgreement.tenant_id == tid)
        .first()
    )


# ─── SLA config endpoints (business functions) ───────────────────────────────
def list_sla(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDServiceLevelAgreement)
        .filter(HDServiceLevelAgreement.tenant_id == tid)
        .order_by(HDServiceLevelAgreement.default_sla.desc(),
                  HDServiceLevelAgreement.service_level.asc())
        .all()
    )
    return {"slas": [_sla_detail(s) for s in rows]}


def get_sla_config(db: Session, tid: int, name: str) -> dict:
    sla = _get_sla_row(db, tid, name)
    if not sla:
        raise HTTPException(status_code=404, detail="not found")
    return _sla_detail(sla)


def _validate_and_finalize_sla(db, tid, sla, apply_resolution, before) -> List[str]:
    """Frappe validate() + before_save() order on the in-memory row."""
    warns = _enforce_single_default(db, tid, bool(sla.default_sla),
                                    sla.service_level, sla.id)
    labels = _priority_labels(db, tid, [p.priority_id for p in sla.priorities])
    _validate_priority_rows(sla.priorities, apply_resolution, labels)
    _validate_service_days(sla.service_days)
    _validate_condition(sla.condition, sla.condition_json)
    warns += _detach_warnings(db, tid, before, sla)
    sla.default_priority_id = _resolve_default_priority(sla.priorities)  # before_save
    return warns


def create_sla(db: Session, tid: int, payload: dict) -> dict:
    sla = HDServiceLevelAgreement(tenant_id=tid, service_level=payload.get("service_level"))
    _apply_sla_scalars(sla, payload)
    sla.priorities = _build_priority_rows(payload.get("priorities"))
    sla.service_days = _build_service_day_rows(payload.get("service_days"))
    warns = _validate_and_finalize_sla(
        db, tid, sla, bool(sla.apply_sla_for_resolution), before=None)
    db.add(sla)
    db.commit()
    return {"ok": True, "name": str(sla.id), "warnings": warns}


def update_sla(db: Session, tid: int, name: str, payload: dict) -> dict:
    sla = _get_sla_row(db, tid, name)
    if not sla:
        raise HTTPException(status_code=404, detail="not found")
    before = {
        "priority_ids": {p.priority_id for p in sla.priorities},
        "labels": {p.priority_id: (p.priority.name or p.priority.level)
                   for p in sla.priorities if p.priority},
        "default_sla": bool(sla.default_sla),
        "enabled": bool(sla.enabled),
    }
    _apply_sla_scalars(sla, payload)
    if payload.get("priorities") is not None:
        sla.priorities = _build_priority_rows(payload["priorities"])
    if payload.get("service_days") is not None:
        sla.service_days = _build_service_day_rows(payload["service_days"])
    warns = _validate_and_finalize_sla(
        db, tid, sla, bool(sla.apply_sla_for_resolution), before=before)
    db.commit()
    return {"ok": True, "name": str(sla.id), "warnings": warns}


# ─── Holiday list write-side (hd_service_holiday_list.py) ─────────────────────
def _validate_holiday_days(hl) -> None:
    """validate_days (:43) — from <= to, every holiday inside [from, to]."""
    if hl.from_date and hl.to_date and hl.from_date > hl.to_date:
        raise HTTPException(status_code=400, detail="To Date cannot be before From Date")
    for h in hl.holidays:
        if hl.from_date and hl.to_date and not (hl.from_date <= h.holiday_date <= hl.to_date):
            raise HTTPException(
                status_code=400,
                detail=f"The holiday on {h.holiday_date.isoformat()} is not between "
                       "From Date and To Date")


def _weekly_off_date_list(start_date: date, end_date: date, weekly_off: str,
                          existing: set) -> list:
    """get_weekly_off_date_list (:59) — every `weekly_off` weekday in
    [start, end] not already present. Stdlib weekday math replaces
    dateutil.relativedelta: _WEEKDAYS is Monday=0..Sunday=6, same as
    date.weekday(), so `(target - start.weekday()) % 7` is the first occurrence
    on/after start_date (what relativedelta(weekday=...) returns)."""
    try:
        target = _WEEKDAYS.index(weekly_off.strip().capitalize())
    except (AttributeError, ValueError):
        raise HTTPException(status_code=400, detail="Please select a valid weekly off day")
    ref = start_date + timedelta(days=(target - start_date.weekday()) % 7)
    out = []
    while ref <= end_date:
        if ref not in existing:
            out.append(ref)
        ref += timedelta(days=7)
    return out


def _recalculate_sla(db: Session, tid: int, hl) -> None:
    """on_update -> recalculate_sla (:83). Every Open ticket on each SLA that
    links this holiday list is re-flowed through the engine so new/removed
    holidays shift its deadlines. Frappe re-saves the ticket (-> apply); here we
    call the already-converted recompute() per ticket. prev_status_category =
    the ticket's own category: a holiday edit is not a status change, so this
    must not look like a pause/resume transition."""
    sla_ids = [
        row[0] for row in db.query(HDServiceLevelAgreement.id)
        .filter(HDServiceLevelAgreement.tenant_id == tid,
                HDServiceLevelAgreement.holiday_list_id == hl.id)
        .all()
    ]
    for sla_id in sla_ids:
        tickets = (
            db.query(HDTicket)
            .filter(HDTicket.tenant_id == tid,
                    HDTicket.sla_id == sla_id,
                    HDTicket.status_category == "Open")
            .all()
        )
        for t in tickets:
            recompute(db, t, prev_status_category=t.status_category)


def _build_holiday_rows(payload_list) -> list:
    return [
        HDHoliday(
            idx=i,
            holiday_date=_parse_date(h.get("holiday_date")),
            description=h.get("description"),
            weekly_off=bool(h.get("weekly_off")),
        )
        for i, h in enumerate(payload_list or [], start=1)
    ]


def _holiday_list_detail(hl) -> dict:
    return {
        "name": str(hl.id),
        "holiday_list_name": hl.holiday_list_name,
        "from_date": hl.from_date.isoformat() if hl.from_date else None,
        "to_date": hl.to_date.isoformat() if hl.to_date else None,
        "total_holidays": hl.total_holidays,
        "weekly_off": hl.weekly_off,
        "color": hl.color,
        "description": hl.description,
        "holidays": [
            {
                "id": h.id,
                "holiday_date": h.holiday_date.isoformat() if h.holiday_date else None,
                "description": h.description,
                "weekly_off": bool(h.weekly_off),
            }
            for h in hl.holidays
        ],
    }


def _get_holiday_list_row(db: Session, tid: int, name: str):
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDServiceHolidayList)
        .filter(HDServiceHolidayList.id == pk,
                HDServiceHolidayList.tenant_id == tid)
        .first()
    )


def list_holiday_lists(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDServiceHolidayList)
        .filter(HDServiceHolidayList.tenant_id == tid)
        .order_by(HDServiceHolidayList.holiday_list_name.asc())
        .all()
    )
    return {"holiday_lists": [_holiday_list_detail(h) for h in rows]}


def get_holiday_list(db: Session, tid: int, name: str) -> dict:
    hl = _get_holiday_list_row(db, tid, name)
    if not hl:
        raise HTTPException(status_code=404, detail="not found")
    return _holiday_list_detail(hl)


def create_holiday_list(db: Session, tid: int, payload: dict) -> dict:
    hl = HDServiceHolidayList(
        tenant_id=tid,
        holiday_list_name=payload.get("holiday_list_name"),
        from_date=_parse_date(payload.get("from_date")),
        to_date=_parse_date(payload.get("to_date")),
        weekly_off=payload.get("weekly_off"),
        color=payload.get("color"),
        description=payload.get("description"),
    )
    hl.holidays = _build_holiday_rows(payload.get("holidays"))
    _validate_holiday_days(hl)
    hl.total_holidays = len(hl.holidays)          # validate() tail
    db.add(hl)
    db.commit()
    # on_update.recalculate_sla returns early when is_new() -> no recalc on create.
    return {"ok": True, "name": str(hl.id)}


def update_holiday_list(db: Session, tid: int, name: str, payload: dict) -> dict:
    hl = _get_holiday_list_row(db, tid, name)
    if not hl:
        raise HTTPException(status_code=404, detail="not found")
    for f in ("holiday_list_name", "weekly_off", "color", "description"):
        if payload.get(f) is not None:
            setattr(hl, f, payload[f])
    if "from_date" in payload:
        hl.from_date = _parse_date(payload.get("from_date"))
    if "to_date" in payload:
        hl.to_date = _parse_date(payload.get("to_date"))
    if payload.get("holidays") is not None:
        hl.holidays = _build_holiday_rows(payload["holidays"])
    _validate_holiday_days(hl)
    hl.total_holidays = len(hl.holidays)
    db.commit()
    _recalculate_sla(db, tid, hl)                 # on_update (not is_new)
    db.commit()
    return {"ok": True, "name": str(hl.id)}


def delete_holiday_list(db: Session, tid: int, name: str) -> dict:
    hl = _get_holiday_list_row(db, tid, name)
    if not hl:
        raise HTTPException(status_code=404, detail="not found")
    linked = (
        db.query(func.count(HDServiceLevelAgreement.id))
        .filter(HDServiceLevelAgreement.tenant_id == tid,
                HDServiceLevelAgreement.holiday_list_id == hl.id)
        .scalar()
    )
    if linked:
        raise HTTPException(status_code=400,
                            detail=f"{linked} SLA(s) link this holiday list; detach them first.")
    db.delete(hl)
    db.commit()
    return {"ok": True}


def generate_weekly_off(db: Session, tid: int, name: str) -> dict:
    """get_weekly_off_dates (:22) — append the generated weekly-off holidays and
    re-save (so on_update.recalculate_sla fires)."""
    hl = _get_holiday_list_row(db, tid, name)
    if not hl:
        raise HTTPException(status_code=404, detail="not found")
    if not hl.weekly_off:                          # validate_values (:39)
        raise HTTPException(status_code=400, detail="Please select weekly off day")
    if not hl.from_date or not hl.to_date:
        raise HTTPException(status_code=400, detail="From Date and To Date are required")
    existing = {h.holiday_date for h in hl.holidays}
    last_idx = max([h.idx or 0 for h in hl.holidays] or [0])
    for i, d in enumerate(_weekly_off_date_list(hl.from_date, hl.to_date,
                                                hl.weekly_off, existing)):
        hl.holidays.append(HDHoliday(idx=last_idx + i + 1, holiday_date=d,
                                     description=hl.weekly_off, weekly_off=True))
    _validate_holiday_days(hl)
    hl.total_holidays = len(hl.holidays)
    db.commit()
    _recalculate_sla(db, tid, hl)
    db.commit()
    return {"ok": True, "name": str(hl.id), "total_holidays": hl.total_holidays}


def clear_holidays(db: Session, tid: int, name: str) -> dict:
    """clear_table (:106) — drop all holiday rows and re-save."""
    hl = _get_holiday_list_row(db, tid, name)
    if not hl:
        raise HTTPException(status_code=404, detail="not found")
    hl.holidays = []                               # cascade delete-orphan
    hl.total_holidays = 0
    db.commit()
    _recalculate_sla(db, tid, hl)
    db.commit()
    return {"ok": True, "name": str(hl.id)}


# ─── request bodies + router (main session mounts config_router) ──────────────
class SLAPriorityIn(BaseModel):
    priority_id: int
    default_priority: bool = False
    response_time: float = 0
    resolution_time: Optional[float] = None


class SLAServiceDayIn(BaseModel):
    workday: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None


class SLAConfigIn(BaseModel):
    service_level: str
    description: Optional[str] = None
    enabled: bool = True
    default_sla: bool = False
    rank: Optional[int] = None
    condition: Optional[str] = None
    condition_json: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    apply_sla_for_resolution: bool = True
    holiday_list_id: Optional[int] = None
    default_priority_id: Optional[int] = None
    default_ticket_status_id: Optional[int] = None
    ticket_reopen_status_id: Optional[int] = None
    priorities: Optional[List[SLAPriorityIn]] = None
    service_days: Optional[List[SLAServiceDayIn]] = None


class HolidayIn(BaseModel):
    holiday_date: str
    description: Optional[str] = None
    weekly_off: bool = False


class HolidayListIn(BaseModel):
    holiday_list_name: str
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    weekly_off: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    holidays: Optional[List[HolidayIn]] = None


config_router = APIRouter()


@config_router.get("/sla")
def list_sla_ep(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return list_sla(db, tenant_id(db))


@config_router.get("/sla/{name}")
def get_sla_ep(name: str, db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return get_sla_config(db, tenant_id(db), name)


@config_router.post("/sla")
def create_sla_ep(body: SLAConfigIn, db: Session = Depends(get_db),
                  _: bool = Depends(require_settings_manage)):
    return create_sla(db, tenant_id(db), body.model_dump())


@config_router.put("/sla/{name}")
def update_sla_ep(name: str, body: SLAConfigIn, db: Session = Depends(get_db),
                  _: bool = Depends(require_settings_manage)):
    return update_sla(db, tenant_id(db), name, body.model_dump())


@config_router.get("/holiday-lists")
def list_holiday_lists_ep(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return list_holiday_lists(db, tenant_id(db))


@config_router.get("/holiday-lists/{name}")
def get_holiday_list_ep(name: str, db: Session = Depends(get_db),
                        _: bool = Depends(require_masterdata_view)):
    return get_holiday_list(db, tenant_id(db), name)


@config_router.post("/holiday-lists")
def create_holiday_list_ep(body: HolidayListIn, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return create_holiday_list(db, tenant_id(db), body.model_dump())


@config_router.put("/holiday-lists/{name}")
def update_holiday_list_ep(name: str, body: HolidayListIn, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return update_holiday_list(db, tenant_id(db), name, body.model_dump())


@config_router.delete("/holiday-lists/{name}")
def delete_holiday_list_ep(name: str, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return delete_holiday_list(db, tenant_id(db), name)


@config_router.post("/holiday-lists/{name}/weekly-off")
def generate_weekly_off_ep(name: str, db: Session = Depends(get_db),
                           _: bool = Depends(require_settings_manage)):
    return generate_weekly_off(db, tenant_id(db), name)


@config_router.post("/holiday-lists/{name}/clear")
def clear_holidays_ep(name: str, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    return clear_holidays(db, tenant_id(db), name)


if __name__ == "__main__":
    # Self-check for the business-hours math (no DB). 9–17 Mon–Fri.
    from types import SimpleNamespace

    wd = {d: SimpleNamespace(workday=d, start_time=dtime(9, 0), end_time=dtime(17, 0))
          for d in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]}
    mon = datetime(2024, 1, 1, 9, 0)   # 2024-01-01 is a Monday
    assert _calc_time(mon, 4 * 3600, set(), wd) == datetime(2024, 1, 1, 13, 0)
    assert _calc_time(mon, 8 * 3600, set(), wd) == datetime(2024, 1, 1, 17, 0)
    # spill into the next working day
    assert _calc_time(datetime(2024, 1, 1, 15, 0), 4 * 3600, set(), wd) == datetime(2024, 1, 2, 11, 0)
    # weekend skip: Fri 15:00 + 4h -> Mon 11:00
    assert _calc_time(datetime(2024, 1, 5, 15, 0), 4 * 3600, set(), wd) == datetime(2024, 1, 8, 11, 0)
    # hold time slides the resolution deadline out
    assert _calc_time(mon, 4 * 3600, set(), wd, hold_time=3600) == datetime(2024, 1, 1, 14, 0)
    # holiday skip
    assert _calc_time(mon, 8 * 3600, {datetime(2024, 1, 1).date()}, wd) == datetime(2024, 1, 2, 17, 0)
    # elapsed is the inverse
    assert _calc_elapsed_time(mon, datetime(2024, 1, 1, 13, 0), set(), wd) == 4 * 3600
    assert _calc_elapsed_time(datetime(2024, 1, 1, 16, 0), datetime(2024, 1, 2, 10, 0), set(), wd) == 2 * 3600
    assert _fmt_duration(14400) == "4h" and _fmt_duration(172800) == "2d"

    # ── config write-side validators (pure, no DB) ──────────────────────────
    def _p(pid, dflt=False, resp=3600, reso=7200):
        return SimpleNamespace(priority_id=pid, default_priority=dflt,
                               response_time=resp, resolution_time=reso)

    def _raises(fn):
        try:
            fn()
        except HTTPException:
            return True
        return False

    # priorities: ok / >1 default / missing response / response>resolution / dup
    _validate_priority_rows([_p(1, True), _p(2)], True, {})
    assert _raises(lambda: _validate_priority_rows([_p(1, True), _p(2, True)], True, {}))
    assert _raises(lambda: _validate_priority_rows([_p(1, True, resp=0)], True, {}))
    assert _raises(lambda: _validate_priority_rows([_p(1, True, resp=9000, reso=3600)], True, {}))
    assert _raises(lambda: _validate_priority_rows([_p(1, True), _p(1)], True, {}))
    # apply_resolution=False skips the resolution checks
    _validate_priority_rows([_p(1, True, reso=None)], False, {})

    # service days: start<end, no repeat, both present
    sd = lambda day, s, e: SimpleNamespace(workday=day, start_time=s, end_time=e)
    _validate_service_days([sd("Monday", dtime(9), dtime(17))])
    assert _raises(lambda: _validate_service_days([sd("Monday", dtime(17), dtime(9))]))
    assert _raises(lambda: _validate_service_days([sd("Monday", dtime(9), dtime(17)),
                                                   sd("Monday", dtime(9), dtime(17))]))
    assert _raises(lambda: _validate_service_days([sd("Monday", None, dtime(17))]))

    # condition: valid expr ok, garbage rejected; json validity
    _validate_condition("doc.priority == 'High'", None)
    assert _raises(lambda: _validate_condition("doc ==", None))
    _validate_condition(None, '[["status","==","open"]]')
    assert _raises(lambda: _validate_condition(None, "{not json"))

    # default priority resolution (before_save)
    assert _resolve_default_priority([_p(1), _p(2, True)]) == 2
    assert _raises(lambda: _resolve_default_priority([_p(1), _p(2)]))

    # weekly-off date list: Sundays in Jan 2024 (7,14,21,28), 14th pre-existing
    wk = _weekly_off_date_list(date(2024, 1, 1), date(2024, 1, 31), "Sunday",
                               {date(2024, 1, 14)})
    assert wk == [date(2024, 1, 7), date(2024, 1, 21), date(2024, 1, 28)], wk
    assert _raises(lambda: _weekly_off_date_list(date(2024, 1, 1), date(2024, 1, 31), "Funday", set()))
    assert _get_repeated(["Mon", "Tue", "Mon", "Mon"]) == "Mon"

    # ── B1: safe_condition_eval adversarial allowlist self-check ─────────────
    def _blocked(expr, ctx=None):
        """True iff safe_condition_eval REJECTS (raises on) `expr`."""
        try:
            safe_condition_eval(expr, ctx if ctx is not None else {"doc": _Doc()})
        except Exception:
            return True
        return False

    # RCE / sandbox-escape payloads MUST be rejected (the B1 exploit class)
    assert _blocked("().__class__.__bases__[0].__subclasses__()"), "subclasses walk not blocked"
    assert _blocked("doc.__class__.__mro__[1].__subclasses__()"), "doc mro walk not blocked"
    assert _blocked("__import__('os').system('id')"), "__import__ not blocked"
    assert _blocked("doc.__class__"), "dunder attr not blocked"
    assert _blocked("cycler.__init__.__globals__"), "foreign name/dunder not blocked"
    assert _blocked("[x for x in doc]"), "comprehension not blocked"
    assert _blocked("doc.priority.upper()"), "method call not blocked"
    assert _blocked("doc['priority']"), "subscript not blocked"
    assert _blocked("(lambda: 1)()"), "lambda/call not blocked"
    assert _blocked("open('x')"), "bare call not blocked"
    assert _blocked("os.system('id')"), "foreign attr-call not blocked"
    assert _blocked("doc.priority == 'High'; doc.status == 'Open'"), "statement not blocked"
    assert _blocked("doc.unknown_field == 'x'"), "non-schema field not blocked"
    # legit conditions MUST evaluate (not raise) and return the right boolean
    assert safe_condition_eval("doc.priority == 'High'", {"doc": {"priority": "High"}}) is True
    assert safe_condition_eval("doc.priority == 'High'", {"doc": {"priority": "Low"}}) is False
    assert safe_condition_eval("doc.process == 'Change'", {"doc": _Doc(process="Change")}) is True
    assert safe_condition_eval("doc.priority in ['High', 'Urgent']",
                               {"doc": {"priority": "Urgent"}}) is True
    assert safe_condition_eval("doc.priority in ['High', 'Urgent']",
                               {"doc": {"priority": "Low"}}) is False
    assert safe_condition_eval("doc.status == 'Open' and doc.priority != 'Low'",
                               {"doc": {"status": "Open", "priority": "High"}}) is True
    assert safe_condition_eval("doc.status == 'Open' and doc.priority != 'Low'",
                               {"doc": {"status": "Open", "priority": "Low"}}) is False
    assert safe_condition_eval("not (doc.priority == 'Low')",
                               {"doc": {"priority": "High"}}) is True
    assert safe_condition_eval("doc.process == 'Change' or doc.process == 'Incident'",
                               {"doc": _Doc(process="Incident")}) is True
    assert safe_condition_eval("", {"doc": _Doc()}) is False          # blank is falsy, not RCE
    print("sla B1 safe_condition_eval adversarial self-check ok")

    print("sla self-check ok")
