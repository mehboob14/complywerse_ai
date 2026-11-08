"""The Task Management register's complete load, and the words a task's source and links need: ``GET /critical-tasks?lean=1`` (Stage 4 tasks-register, B-1 / B-3).

``GET /critical-tasks`` returns one page of full tasks (text, notes, custom fields) and writes a task's escalation level inside the GET; a register that draws its rows, facet counts, board and
exports from the list needs EVERY task the person may see, compact, in one request (the same approach as the Documents library, ``governance/library_lean.py``, and the Risk Register). A lean
row is the keys the register reads: people as ``{id, display_name}``, the due moment and the server's SLA state, the approval fields, the true counts of sub-tasks and comments (one grouped query
for the page), where the task came from in words and the page it opens (``source_label`` / ``source_href``), and the titles of the records it is linked to (``links``). Who sees which task is
the full list's rule, not a second one: the query is the full list's own, with its filters. Nothing is written: the escalation level is worked out on read (the full list raises the stored one
when it is read; this shows the level it would have raised it to, so the two never disagree).

``source_info`` and ``linked_records`` are also used by ``GET /critical-tasks/{id}``; ``history_labels`` words the people in a task's history for the task page (B-4).
"""
import json
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple

from fastapi.responses import JSONResponse
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session, defer

from ..models import (CertificationJourney, CriticalTask, CriticalTaskComment, CriticalTaskSubTask, GRCUser, InternalControl, Issue, OversightAction, Risk, TPRAApproval,
                      TPRAFinding, Vulnerability)

# the most rows one lean request returns (a larger ``limit`` is clamped and the envelope echoes the clamped value)
LEAN_LIMIT = 10_000
DONE = ("Completed", "Verified")


def chunks(seq: Sequence, size: int = 5000) -> Iterator[Sequence]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


# ── the server's own rules, written once ─────────────────────────────────────────────────────────────────────────────────────────────────
def escalation_for(status: Optional[str], due_date: Optional[datetime], now: datetime) -> int:
    """The escalation level a task reaches: 3 when it is 7+ days past due, 2 when past due, 1 within 3 days of its due date, else 0; none once it is done or has no due date.
    ``_auto_escalate_task`` raises the stored level to this; the lean list shows the higher of the two."""
    if status in DONE or not due_date:
        return 0
    days_overdue = (now - due_date).days
    if days_overdue > 7:
        return 3
    if days_overdue > 0:
        return 2
    return 1 if days_overdue >= -3 else 0


def sla_word(status: Optional[str], due_date: Optional[datetime], now: datetime) -> str:
    """A task's SLA state, the one rule (the router's ``_calc_sla_status`` calls it with the clock): Completed once done, No SLA without a due date, Breached when the due moment has passed
    (``(due - now).days < 0``, Python rounding a negative gap down), At Risk within 3 whole days, else On Track."""
    if status in DONE:
        return "Completed"
    if not due_date:
        return "No SLA"
    days = (due_date - now).days
    if days < 0:
        return "Breached"
    return "At Risk" if days <= 3 else "On Track"


def sla_clause(sla: str, now: datetime):
    """SQL for ``_calc_sla_status(task) == sla``: Completed (done), No SLA (no due date), Breached (``(due - now).days < 0``: the due moment has passed), At Risk (due within 3 whole
    days: before ``now + 4 days``), On Track (later). ``None`` for a word that is not one of the five (the filter then means nothing)."""
    T = CriticalTask
    open_ = T.status.notin_(DONE)
    if sla == "Completed":
        return T.status.in_(DONE)
    if sla == "No SLA":
        return (open_) & T.due_date.is_(None)
    if sla == "Breached":
        return open_ & (T.due_date < now)
    if sla == "At Risk":
        return open_ & (T.due_date >= now) & (T.due_date < now + timedelta(days=4))
    if sla == "On Track":
        return open_ & (T.due_date >= now + timedelta(days=4))
    return None


# ── people, counts ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def person(user) -> Optional[Dict[str, Any]]:
    """A person on a row: the id and the name to show (the display name, else the username)."""
    if not user:
        return None
    return {"id": user.id, "display_name": user.display_name or user.username}


def counts_of(db: Session, ids: Sequence[int]) -> Tuple[Dict[int, Tuple[int, int]], Dict[int, int]]:
    """``({task id: (sub-tasks, done)}, {task id: comments})``: the true counts, one grouped query for each, in slices short enough for one IN list."""
    subs: Dict[int, Tuple[int, int]] = {}
    comments: Dict[int, int] = {}
    S, C = CriticalTaskSubTask, CriticalTaskComment
    for chunk in chunks(list(ids)):
        for task_id, total, done in (db.query(S.task_id, func.count(S.id), func.sum(case((S.status == "Completed", 1), else_=0)))
                                     .filter(S.task_id.in_(chunk)).group_by(S.task_id)):
            subs[task_id] = (int(total or 0), int(done or 0))
        for task_id, n in db.query(C.task_id, func.count(C.id)).filter(C.task_id.in_(chunk)).group_by(C.task_id):
            comments[task_id] = int(n or 0)
    return subs, comments


# ── where a task came from ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
def source_info(db: Session, tasks: Sequence[Any], requests: Optional[Dict[int, Any]] = None) -> Dict[int, Tuple[str, Optional[str]]]:
    """``{task id: (source_label, source_href)}`` for the tasks a module made (a task made by hand has none): a document request opens its document; a committee action its committee;
    a regulatory change its tasks; a vendor finding or approval its vendor; an issue action its issue; a workflow run is named. The page is None where the record has none. Every
    lookup is one query for the whole list."""
    out: Dict[int, Tuple[str, Optional[str]]] = {}
    actions = {t.source_entity_id for t in tasks if t.source_module == "committees" and t.source_entity_type == "OversightAction" and t.source_entity_id}
    committee_of: Dict[int, int] = {}
    for chunk in chunks(sorted(actions)):
        committee_of.update(dict(db.query(OversightAction.id, OversightAction.committee_id).filter(OversightAction.id.in_(chunk))))
    finding_tasks = [t.id for t in tasks if t.source_module == "vendor_risk" and t.source_entity_type == "TPRARemediation"]
    vendor_of_task: Dict[int, int] = {}
    for chunk in chunks(finding_tasks):
        vendor_of_task.update(dict(db.query(TPRAFinding.task_id, TPRAFinding.vendor_id).filter(TPRAFinding.task_id.in_(chunk))))
    approvals = {t.source_entity_id for t in tasks if t.source_module == "vendor_risk" and t.source_entity_type == "TPRAApprovalCondition" and t.source_entity_id}
    vendor_of_approval: Dict[int, int] = {}
    for chunk in chunks(sorted(approvals)):
        vendor_of_approval.update(dict(db.query(TPRAApproval.id, TPRAApproval.vendor_id).filter(TPRAApproval.id.in_(chunk))))
    vendor = lambda vid: f"/vendor-risk/vendors/{vid}" if vid else None          # noqa: E731

    for t in tasks:
        module = t.source_module
        if module == "document_lifecycle":
            request = (requests or {}).get(t.id)
            if request:
                out[t.id] = ("Document request", request.get("open_href"))
        elif module == "committees":
            committee = committee_of.get(t.source_entity_id)
            out[t.id] = ("Committee action", f"/governance/committees/{committee}" if committee else None)
        elif module == "regulatory_changes" or getattr(t, "linked_regulatory_change_id", None):
            change = getattr(t, "linked_regulatory_change_id", None)
            out[t.id] = ("Regulatory change", f"/governance/regulatory-changes/{change}?tab=tasks" if change else None)
        elif module == "vendor_risk":
            if t.source_entity_type == "TPRAApprovalCondition":
                out[t.id] = ("Vendor approval", vendor(vendor_of_approval.get(t.source_entity_id)))
            else:
                out[t.id] = ("Vendor finding", vendor(vendor_of_task.get(t.id)))
        elif module == "issue_management":
            issue = getattr(t, "linked_issue_id", None)
            out[t.id] = ("Issue action", f"/issues/{issue}" if issue else None)
        elif module == "workflow_engine":
            out[t.id] = ("Workflow", None)
    return out


def linked_records(db: Session, tasks: Sequence[Any]) -> Dict[int, List[Dict[str, Any]]]:
    """``{task id: [{kind, id, title, href}]}`` for the records a task is linked to, with their titles (a record that is gone keeps its place with no title). One query for each kind."""
    wanted: Dict[str, set] = {k: set() for k in ("risk", "control", "vulnerability", "framework", "issue")}
    for t in tasks:
        for kind, column in (("risk", "linked_risk_id"), ("control", "linked_control_id"), ("vulnerability", "linked_vulnerability_id"),
                             ("framework", "linked_framework_id"), ("issue", "linked_issue_id")):
            value = getattr(t, column, None)
            if value:
                wanted[kind].add(value)
    titles: Dict[str, Dict[int, str]] = {k: {} for k in wanted}

    def read(kind: str, model, label) -> None:
        for chunk in chunks(sorted(wanted[kind])):
            for row in db.query(model).filter(model.id.in_(chunk)).with_entities(model.id, *label[0]):
                titles[kind][row[0]] = label[1](*row[1:])

    read("risk", Risk, ((Risk.title,), lambda title: title))
    read("control", InternalControl, ((InternalControl.control_id, InternalControl.name), lambda code, name: f"{code} - {name}" if code else name))
    read("vulnerability", Vulnerability, ((Vulnerability.title,), lambda title: title))
    read("framework", CertificationJourney, ((CertificationJourney.name,), lambda name: name))
    read("issue", Issue, ((Issue.title,), lambda title: title))
    pages = {"risk": "/erm/risks/{}", "control": "/erm/internal-controls/{}", "vulnerability": "/cyber-assurance/vulnerabilities/{}", "framework": "/frameworks/{}", "issue": "/issues/{}"}

    out: Dict[int, List[Dict[str, Any]]] = {}
    for t in tasks:
        links: List[Dict[str, Any]] = []
        for kind, column in (("risk", "linked_risk_id"), ("control", "linked_control_id"), ("vulnerability", "linked_vulnerability_id"),
                             ("framework", "linked_framework_id"), ("issue", "linked_issue_id")):
            value = getattr(t, column, None)
            if value:
                title = titles[kind].get(value)
                links.append({"kind": kind, "id": value, "title": title, "href": pages[kind].format(value) if title else None})
        requirement = getattr(t, "linked_requirement_id", None)
        if requirement:        # a requirement has no page of its own: it opens its framework
            framework = next((link for link in links if link["kind"] == "framework"), None)
            links.append({"kind": "requirement", "id": requirement, "title": "A requirement of the framework", "href": framework["href"] if framework else None})
        if links:
            out[t.id] = links
    return out


# ── the history, in words (B-4) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
_PEOPLE_FIELDS = ("assigned_owner_id", "reviewer_id", "approved_by_id")
_LIST_FIELDS = ("assigned_user_ids",)


def _ids_of(value: Optional[str]) -> List[int]:
    """The user ids a history value holds: "7", "[7, 9]" or "None"."""
    if value is None:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return []
    if isinstance(parsed, bool):
        return []
    if isinstance(parsed, int):
        return [parsed]
    return [i for i in parsed if isinstance(i, int)] if isinstance(parsed, list) else []


def history_labels(db: Session, entries: Sequence[Any]) -> Dict[int, Tuple[Optional[str], Optional[str]]]:
    """``{history id: (old_label, new_label)}`` for the entries that name people (owner, reviewer, approver, the assignee list): "Rana Shah" or "Rana Shah, Omar Khan"; a person no longer there
    reads "Someone no longer here"; nobody reads "Nobody". Other entries are left out (their values are words already, or the page words them)."""
    ids: set = set()
    for h in entries:
        if h.field_changed in _PEOPLE_FIELDS or h.field_changed in _LIST_FIELDS:
            ids.update(_ids_of(h.old_value))
            ids.update(_ids_of(h.new_value))
    names: Dict[int, str] = {}
    for chunk in chunks(sorted(ids)):
        for uid, display, username in db.query(GRCUser.id, GRCUser.display_name, GRCUser.username).filter(GRCUser.id.in_(chunk)):
            names[uid] = display or username

    def words(value: Optional[str]) -> str:
        found = _ids_of(value)
        return ", ".join(names.get(i, "Someone no longer here") for i in found) if found else "Nobody"

    return {h.id: (words(h.old_value), words(h.new_value)) for h in entries if h.field_changed in _PEOPLE_FIELDS or h.field_changed in _LIST_FIELDS}


# ── the lean list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def lean_query(query):
    """``query`` (the full list's filtered query) without the long columns, which stay on ``GET /critical-tasks/{id}``."""
    return query.options(defer(CriticalTask.description), defer(CriticalTask.evidence_notes), defer(CriticalTask.custom_values), defer(CriticalTask.approval_comment))


def list_lean(db: Session, rows: Sequence[Any], total: int, skip: int, limit: int, prefetched: Dict[str, Any], now: datetime) -> Dict[str, Any]:
    """The lean envelope for ``rows`` (a page of the full list's query, already cut to what the person may see), ``total`` its true count. ``prefetched`` is the router's ``_prefetch``
    (the assignees and the document requests)."""
    ids = [t.id for t in rows]
    subs, comments = counts_of(db, ids)
    requests = prefetched["requests"]
    where = source_info(db, rows, requests)
    links = linked_records(db, rows)
    users = prefetched["users"]
    items: List[Dict[str, Any]] = []
    for t in rows:
        assigned = getattr(t, "assigned_user_ids", None)
        assigned = assigned if isinstance(assigned, list) and assigned else ([t.assigned_owner_id] if t.assigned_owner_id else [])
        assignees = [person(users[i]) for i in assigned if i in users]
        request = requests.get(t.id) if t.source_module == "document_lifecycle" else None
        if request:
            request = {k: v for k, v in request.items() if k != "again"}         # the register does not draw it
        label, href = where.get(t.id, (None, None))
        sub_total, sub_done = subs.get(t.id, (0, 0))
        item = {
            "id": t.id, "title": t.title, "source": t.source, "source_module": t.source_module, "source_entity_type": t.source_entity_type,
            "priority": t.priority, "severity": t.severity, "status": t.status, "category": t.category,
            "assigned_owner_id": t.assigned_owner_id, "assigned_owner": person(t.assigned_owner), "assigned_user_ids": [a["id"] for a in assignees], "assignees": assignees,
            "reviewer_id": t.reviewer_id, "reviewer": person(t.reviewer), "created_by_id": t.created_by_id, "created_by": person(t.created_by),
            "due_date": _iso(t.due_date), "sla_days": t.sla_days, "sla_status": sla_word(t.status, t.due_date, now),
            "escalation_level": max(t.escalation_level or 0, escalation_for(t.status, t.due_date, now)),
            "completed_at": _iso(t.completed_at), "created_at": _iso(t.created_at), "updated_at": _iso(t.updated_at),
            "approval_required": bool(t.approval_required), "approval_status": t.approval_status,
            "recurrence_pattern": t.recurrence_pattern, "recurrence_interval": t.recurrence_interval, "parent_task_id": t.parent_task_id,
            "linked_regulatory_change_id": t.linked_regulatory_change_id, "linked_issue_id": t.linked_issue_id,
            "sub_task_total": sub_total, "sub_task_done": sub_done, "comment_count": comments.get(t.id, 0),
            "source_label": label, "source_href": href, "links": links.get(t.id, []),
        }
        if t.source_module == "document_lifecycle":
            item["document_request"] = request
        items.append(item)
    return {"items": items, "total": total, "skip": skip, "limit": limit, "truncated": skip + len(items) < total, "lean": True}


def respond(payload: Dict[str, Any]) -> JSONResponse:
    """A ``JSONResponse`` built here: the standard library's encoder is far cheaper than FastAPI's for thousands of rows (every value in a lean row is already JSON-safe)."""
    return JSONResponse(payload)


def clamp(limit: int) -> int:
    return max(1, min(limit, LEAN_LIMIT))
