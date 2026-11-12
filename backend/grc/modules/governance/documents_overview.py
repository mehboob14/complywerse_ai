"""The Documents Overview (Governance > Documents > Overview): the library at a glance for the head of a department or for anyone who
may read the whole library - how many documents, of which types, at which status and stage, who they wait for, which reviews are
due and what needs attention - for the whole organisation or for one department and everything under it.

Who may ask: whoever reads the whole library (an administrator, or a platform-given role holding ``governance:policies:*``) and the
head of at least one department (``org_departments.headed_by``). Nobody else (403). Every figure and the ``ids`` list count only what
``permissions.visible_filter`` lets the viewer read, so the overview never widens what anyone may read. A head without a library
right reads every document of the departments they head and of everything under them (``permissions.headed_units``, the user's
decision of 2026-11-05) and, besides, what they own, wrote or are asked about.

Scope. A whole-organisation reader may pick "Whole organisation", any department (it counts everything under it, switched-off
departments included) or "No department" (``department_id IS NULL``); a head picks the departments they head and what is under them.
A department that is not the viewer's to pick is refused (403), never silently widened. With nothing picked the scope is the first of
the viewer's choices: the whole organisation for a reader, else the first department they head.

Definitions (every figure counts the documents of the scope that the viewer may read, archived ones only in ``totals.archived``):

* in force = status published; in progress = draft, in review, in approval or approved (``review_required``, which a workflow can set,
  is only in ``by_status``).
* a request is a ``DocumentObligation`` still pending, of kind review, approval or acknowledgement; overdue = due before now; due
  soon = due from now to 7 days ahead. Counts are requests (one per person asked).
* a review is owed on a document in force or approved (the library's ``reviewable()``); overdue = its date has passed, due soon =
  its calendar day is within 30 days (``reviewState()``), no date = unscheduled.
* stuck = in review or approval with no pending review/approval request, or whose oldest one is more than ``admin_after_days``
  (Governance > Settings) days overdue. An acknowledgement does not move a document through its stage, so it does not count here.
* on hold = an unresolved row of ``grc_document_route_holds`` of its current round (``routes.open_hold``).
* late approvals = an overdue review or approval request; late acknowledgements = an overdue acknowledgement on a document with a
  version in force (published, or a newer version on its way over a published one).
* ``issues.documents`` = the documents with at least one of the issues (no owner, expired, exception, stuck, on hold, late approvals,
  late acknowledgements), each counted once. Request counts are people asked, not documents.
* ``by_department`` = the tree of the scope in one table: a row for the department asked for and for each department under it (the
  whole organisation: every department, then "No department"), in picker order, each counting the documents filed in it **and below it**
  (documents, in force, in progress, overdue reviews, documents with an issue) with the figures defined above and its own count apart
  (``own``); a switched-off department with nothing in it is left out. "No department" is the one scope that has no rows. Each row also
  breaks its documents down: ``by_status`` and ``by_type`` (the non-zero ones), ``waiting`` (the pending and overdue requests of each kind,
  people asked, as in ``requests``), ``reviews`` (overdue / due soon / no date, among the documents that owe one) and ``issues_by``
  (documents that are stuck, on hold, with late approvals, with late acknowledgements, with no owner).
* ``board`` = the documents of the scope as a Kanban: columns by status (the five steps of the approval flow, always, then ONE last column
  "Needs attention" - key ``status:attention``, value ``attention``, always present - that holds every other live status: expired,
  exception applied, review required, any other that is not archived; its ``statuses`` lists the ones that have a document), by type or by
  department (the scope's own documents, then one column for each department directly under it), each with its true count and its most
  urgent cards (the ones with the most issues first, then the newest); the cards say what is wrong with them and where their attestation
  stands (``attestation``: state none | not_started | in_progress | complete with done / total, the library's own coverage numbers:
  ``library_lean.attestation_by_document`` read for the cards shown, in one go).
* ``export_documents`` = the same documents as a CSV (archived ones left out, as in every figure, an Attestation column in the board's
  words), cells that a spreadsheet would run as a formula neutralised.

Every figure has its address in ``links`` (the library's own parameters, ``dept`` first): the fixed ones by their path in the answer
("totals.in_force", "reviews.overdue", "issues.stuck", "requests.review.overdue"), the rows of a list by their ``key`` ("type:policy",
"status:draft", "stage:review:Review"). A figure the library cannot filter on exactly (a request due soon, a pending acknowledgement)
has none. A stage has no library filter: its address opens the documents with the status of the documents counted at it.

Nothing here writes. Every figure comes from a fixed number of queries however many documents and departments there are.
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import DocumentObligation, DocumentRouteHold, DocumentRouteStage, GovernanceDocument, GRCUser
from ...routers.auth_router import get_user_primary_tenant
from ...services import department_rights, org_departments
from . import doc_lifecycle, library_lean, permissions, routes

KINDS = ("stuck", "late_approvals", "late_acknowledgements", "on_hold")     # what GET /ids answers
SIGN_OFF = ("review", "approval")                       # the requests that move a document through its stages
REQUESTS = SIGN_OFF + ("acknowledgement",)
DUE_SOON_DAYS = 7                                       # a request is due soon from now to this many days ahead
REVIEW_SOON_DAYS = 30                                   # the library's DUE_SOON_DAYS (libraryModel.ts)
WAITING_ROWS = 10                                       # the most overdue steps listed
NAMES_SHOWN = 5                                         # people named on one of them (the rest are counted)
FLOW = ("draft", "pending_review", "pending_approval", "approved", "published")     # the library's STAGE_ORDER
IN_PROGRESS = ("draft", "pending_review", "pending_approval", "approved")
STATUS_ORDER = FLOW + ("expired", "exception_applied")  # by_status lists these always, then any other status that is present
PENDING = routes.PENDING                                # pending_review, pending_approval
_TYPE_LABEL = {"policy": "Policy", "standard": "Standard", "procedure": "Procedure", "guideline": "Guideline", "charter": "Charter",
               "framework": "Framework"}                # the library's DOC_TYPE_LABEL (libraryModel.ts)
_KIND_RANK = {kind: i for i, kind in enumerate(routes.STAGE_KINDS)}
WHOLE, NONE = "", "none"                                # the address values (?dept=) of the two choices that are no department
ISSUE_KINDS = ("stuck", "on_hold", "late_approvals", "late_acknowledgements", "no_owner")     # what ``issues_by`` counts (a subset of ``issues``)
BOARD_GROUPS = ("status", "type", "department")
BOARD_CARDS, BOARD_MAX = 10, 50                         # cards a column lists by default, and at most
ATTENTION = "attention"                                 # the status board's last column: every live status that is not one of the five steps
# the words of a document's attestation (the board's cards and the CSV), by state
ATTESTATION_WORDS = {"none": "No attestation", "not_started": "Attestation not started", "complete": "Everyone acknowledged"}
# the words of lib/status.ts documentStatus (the interface's own), for the CSV
STATUS_WORDS = {"draft": "Draft", "pending_review": "In review", "pending_approval": "In approval", "approved": "Approved", "published": "Published",
                "expired": "Expired", "archived": "Archived", "exception_applied": "Exception", "review_required": "Review required"}

REFUSED = "The documents overview is for people who can read the document library, for the head of a department and for anyone given access to one."
NOT_YOURS = "You can open the overview of the departments you head or were given access to, and of everything under them."


def _type_label(doc_type: Optional[str]) -> str:
    """The library's typeLabel: "policy" is "Policy", "risk_register" is "Risk register"."""
    return _TYPE_LABEL.get(doc_type or "") or ((doc_type[:1].upper() + doc_type[1:].replace("_", " ")) if doc_type else "—")


# ── who is asking, and for what part of the organisation ─────────────────────
@dataclass
class Access:
    tenant_id: int
    whole: bool                         # reads the whole library (an administrator, or a role holding governance:policies:*)
    tree: org_departments.Tree
    choices: List[dict]                 # what the person may pick, in tree order


@dataclass
class Scope:
    choice: dict
    department: Optional[Any]           # the GRCDepartment (None for the whole organisation and for "No department")
    ids: Optional[Set[int]]             # the department and everything under it; None: no limit by department
    no_department: bool = False


def _choices(db: Session, tenant_id: int, whole: bool, tree: org_departments.Tree, headed: Set[int]) -> List[dict]:
    labels = org_departments.level_labels(db, tenant_id)
    allowed = set(tree.rows) if whole else set().union(*(tree.subtree(i) for i in headed))
    by_name = lambda n: (tree.rows[n].name.casefold(), n)     # noqa: E731  (the picker order: A-Z, each followed by what is under it)
    out: List[dict] = []

    def walk(node: int) -> None:
        if node in allowed:
            level = tree.level(node)
            out.append({"value": str(node), "department_id": node, "name": tree.rows[node].name, "path": [d.name for d in tree.path(node)],
                        "level": level, "level_label": labels[min(level, org_departments.MAX_DEPTH) - 1],
                        "is_active": tree.rows[node].is_active is not False})
        for child in sorted(tree.children.get(node, []), key=by_name):
            walk(child)

    for top in sorted((n for n in tree.rows if tree.parent[n] is None), key=by_name):
        walk(top)
    if whole:
        pseudo = {"department_id": None, "path": [], "level": 0, "level_label": "", "is_active": True}
        out = [{"value": WHOLE, "name": "Whole organisation", **pseudo}, *out, {"value": NONE, "name": "No department", **pseudo}]
    return out


def access(db: Session, user: GRCUser) -> Access:
    """What the person may open: 403 for someone who reads no library, heads no department and was given no access to one."""
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    whole = permissions.is_admin(db, user) or permissions.can_read_library(db, user)
    headed = org_departments.headed_by(db, user.id, [tenant_id])
    headed = set(headed) | set(department_rights.unit_rights(db, user))      # a unit the person was given a level on (view and up) is theirs to open, with what is under it
    if not whole and not headed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=REFUSED)
    tree = org_departments.Tree.load(db, tenant_id)
    return Access(tenant_id, whole, tree, _choices(db, tenant_id, whole, tree, headed))


def scope_of(who: Access, department: Optional[str]) -> Scope:
    """The part of the organisation asked for: ``department`` is the address value (nothing: the viewer's first choice, "none": no
    department, else a department id). A department that exists but is not the viewer's to pick is 403, one that does not is 404."""
    wanted = (department or "").strip().lower()
    if not wanted:
        choice = who.choices[0]
    else:
        number = wanted.isascii() and wanted.isdigit()
        if wanted != NONE and not number:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a department from the list.")
        if number and int(wanted) not in who.tree.rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")
        value = str(int(wanted)) if number else wanted
        choice = next((c for c in who.choices if c["value"] == value), None)
        if choice is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=NOT_YOURS)
    if choice["department_id"] is not None:
        return Scope(choice, who.tree.rows[choice["department_id"]], who.tree.subtree(choice["department_id"]))
    return Scope(choice, None, None, no_department=choice["value"] == NONE)


# ── what is read ─────────────────────────────────────────────────────────────
@dataclass
class Loaded:
    docs: list                          # rows: id, title, doc_type, status, owner_id, department_id, next_review_date, route_stage, ...
    requests: list                      # rows of the pending review / approval / acknowledgement requests of those documents
    holds: list                         # rows of their unresolved holds
    conds: list                         # the population as conditions on GovernanceDocument (a select of ids is made from them)


def _load(db: Session, user: GRCUser, who: Access, scope: Scope) -> Loaded:
    """The documents of the scope that the person may read (archived ones too: only the archived total counts them), the pending
    requests on them and their open holds: three queries, whatever their number."""
    G, O, H = GovernanceDocument, DocumentObligation, DocumentRouteHold
    conds: list = [G.tenant_id == who.tenant_id]
    visible = permissions.visible_filter(db, user)
    if visible is not None:
        conds.append(visible)
    if scope.no_department:
        conds.append(G.department_id.is_(None))
    elif scope.ids is not None:
        conds.append(G.department_id.in_(scope.ids))
    docs = (db.query(G.id, G.title, G.doc_type, G.status, G.owner_id, G.department_id, G.next_review_date, G.route_stage, G.signoff_round_at,
                     G.current_version, G.published_version, G.document_code, G.updated_at).filter(*conds).order_by(G.id).all())
    population = select(G.id).where(*conds)
    requests = (db.query(O.document_id, O.kind, O.user_id, O.stage_position, O.due_date)
                .filter(O.tenant_id == who.tenant_id, O.status == "pending", O.kind.in_(REQUESTS), O.document_id.in_(population))
                .order_by(O.id).all())
    holds = (db.query(H.document_id, H.round_at).filter(H.tenant_id == who.tenant_id, H.resolved_at.is_(None), H.document_id.in_(population))
             .order_by(H.id).all())
    return Loaded(docs, requests, holds, conds)


def _live(docs: list) -> Dict[int, Any]:
    return {d.id: d for d in docs if d.status != "archived"}


def _reviewable(d) -> bool:
    """A review is owed: in force (published, or a newer version on its way over a published one) or approved and waiting to be
    published - the library's ``reviewable()``. A draft, an expired or an archived document owes none."""
    if d.status in ("archived", "expired"):
        return False
    return d.status in ("published", "approved") or bool(permissions.in_force_number(d))


def _review_state(d, now: datetime, horizon) -> Optional[str]:
    """Where a document's next review date stands: overdue, due soon (its calendar day is within ``REVIEW_SOON_DAYS``), unscheduled (no date) or up to
    date; None when no review is owed (see ``_reviewable``). ``horizon`` is the last calendar day that counts as soon."""
    if not _reviewable(d):
        return None
    due = d.next_review_date
    if due is None:
        return "unscheduled"
    if due < now:
        return "overdue"
    return "due_soon" if due.date() <= horizon else "up_to_date"


def _attention(data: Loaded, now: datetime, admin_days: int) -> Dict[str, Set[int]]:
    """The documents behind each of ``KINDS``."""
    live = _live(data.docs)
    asked: Dict[int, list] = defaultdict(list)
    for r in data.requests:
        if r.document_id in live:
            asked[r.document_id].append(r)
    out: Dict[str, Set[int]] = {k: set() for k in KINDS}
    for doc_id, rows in asked.items():
        late = [r for r in rows if r.due_date is not None and r.due_date < now]
        if any(r.kind in SIGN_OFF for r in late):
            out["late_approvals"].add(doc_id)
        if any(r.kind == "acknowledgement" for r in late) and permissions.in_force_number(live[doc_id]):
            out["late_acknowledgements"].add(doc_id)
    limit = now - timedelta(days=admin_days)
    for d in live.values():
        if d.status not in PENDING:
            continue
        due = [r.due_date for r in asked.get(d.id, ()) if r.kind in SIGN_OFF]
        oldest = min((x for x in due if x is not None), default=None)
        if not due or (oldest is not None and oldest < limit):
            out["stuck"].add(d.id)
    for doc_id, round_at in data.holds:                  # routes.open_hold: this round's, on a document that is in review or approval
        d = live.get(doc_id)
        if d is not None and d.status in PENDING and (round_at == d.signoff_round_at if d.signoff_round_at else round_at is None):
            out["on_hold"].add(doc_id)
    return out


# ── the answers ──────────────────────────────────────────────────────────────
def _scope_view(scope: Scope) -> dict:
    c = scope.choice
    return {"value": c["value"], "department_id": c["department_id"], "name": c["name"], "path": c["path"], "level": c["level"],
            "level_label": c["level_label"], "whole_organisation": c["value"] == WHOLE, "includes_below": True}


def _stage_rows(db: Session, who: Access, data: Loaded, extra: Set[int]) -> Dict[int, List[Tuple[int, str, str]]]:
    """document id -> its own route's stages (position, name, kind), for the documents in review or approval and ``extra``."""
    S, G = DocumentRouteStage, GovernanceDocument
    cond = S.document_id.in_(select(G.id).where(*data.conds, G.status.in_(PENDING))) | S.document_id.in_(extra or {0})
    out: Dict[int, List[Tuple[int, str, str]]] = defaultdict(list)
    for doc_id, position, name, kind in (db.query(S.document_id, S.position, S.name, S.kind)
                                         .filter(S.tenant_id == who.tenant_id, cond).order_by(S.document_id, S.position, S.id)):
        out[doc_id].append((position, name, kind))
    return out


def _stage_at(d, stages: Dict[int, List[Tuple[int, str, str]]]) -> Tuple[str, str]:
    """(name, kind) of the stage a document in review or approval is at: the default route's Review or Approval, or on a route of its
    own the stage its ``route_stage`` names (the first stage where someone reviews or approves when it names none: ``routes.current``)."""
    own = stages.get(d.id)
    if not own:
        default = routes.DEFAULT_ROUTE[0 if d.status == "pending_review" else 1]
        return default.name, default.kind
    at = next((s for s in own if s[0] == d.route_stage), None) or next((s for s in own if s[2] != "information"), own[0])
    return at[1], at[2]


def _request_figures(rows: list, now: datetime) -> dict:
    overdue = [r.due_date for r in rows if r.due_date is not None and r.due_date < now]
    soon = now + timedelta(days=DUE_SOON_DAYS)
    return {"pending": len(rows), "overdue": len(overdue),
            "due_soon": sum(1 for r in rows if r.due_date is not None and now <= r.due_date <= soon),
            "oldest_days_late": max((now - due).days for due in overdue) if overdue else None}


def _longest_waiting(data: Loaded, live: Dict[int, Any], now: datetime) -> list:
    """The steps that have waited longest: ((document id, kind, route stage), its overdue requests), most overdue first. A step is a
    document's review, approval or acknowledgement; on a route of its own, one for each stage."""
    steps: Dict[Tuple[int, str, Optional[int]], list] = defaultdict(list)
    for r in data.requests:
        if r.document_id in live and r.due_date is not None and r.due_date < now:
            steps[(r.document_id, r.kind, r.stage_position if r.kind in SIGN_OFF else None)].append(r)
    order = lambda kv: (min(r.due_date for r in kv[1]), kv[0][0], REQUESTS.index(kv[0][1]), kv[0][2] or 0)     # noqa: E731
    return sorted(steps.items(), key=order)[:WAITING_ROWS]


def _waiting(db: Session, longest: list, stages: Dict[int, List[Tuple[int, str, str]]], live: Dict[int, Any], now: datetime) -> List[dict]:
    names = doc_lifecycle._names(db, {r.user_id for _step, rows in longest for r in rows}) if longest else {}
    plain = {"review": routes.DEFAULT_ROUTE[0].name, "approval": routes.DEFAULT_ROUTE[1].name, "acknowledgement": "Acknowledgement"}
    out = []
    for (doc_id, kind, position), rows in longest:
        own = {p: n for p, n, _kind in stages.get(doc_id, [])}
        due = min(r.due_date for r in rows)
        people = sorted({names.get(r.user_id, f"User #{r.user_id}") for r in rows}, key=lambda n: (n.casefold(), n))
        out.append({"document_id": doc_id, "title": live[doc_id].title, "kind": kind, "stage": own.get(position, plain[kind]),
                    "waiting_for": people[:NAMES_SHOWN], "waiting_count": len(people), "due_date": due.isoformat(), "days_late": (now - due).days})
    return out


def _by_department(db: Session, who: Access, scope: Scope, live: Dict[int, Any], flagged: Set[int], attention: Dict[str, Set[int]], requests: list,
                   now: datetime) -> List[dict]:
    """The scope as a table (see the module docstring): one row per department, the documents in it and below it, in picker order. The
    keys of the figures that open the library are ``dept:<id>`` (documents), ``dept:<id>:in_force``, ``:in_progress`` and ``:overdue_reviews``."""
    if scope.no_department:
        return []
    tree = who.tree
    ids = scope.ids if scope.ids is not None else set(tree.rows)
    horizon = now.date() + timedelta(days=REVIEW_SOON_DAYS)
    mine: Dict[Optional[int], Counter] = defaultdict(Counter)       # filed in the department itself
    below: Dict[int, Counter] = defaultdict(Counter)                # filed in it or under it

    def add(department_id: Optional[int], one: Counter) -> None:
        mine[department_id].update(one)
        if department_id is not None:
            for node in tree.path(department_id):
                if node.id in ids:
                    below[node.id].update(one)

    def gone(department_id: Optional[int]) -> bool:
        return department_id is not None and department_id not in tree.rows       # a department that is gone (old data): in the totals, in no row

    for d in live.values():
        if gone(d.department_id):
            continue
        one = Counter(documents=1)
        one["s:" + (d.status or "draft")] = 1
        one["t:" + (d.doc_type or "")] = 1
        if d.status == "published":
            one["in_force"] = 1
        if d.status in IN_PROGRESS:
            one["in_progress"] = 1
        state = _review_state(d, now, horizon)
        if state in ("overdue", "due_soon", "unscheduled"):
            one["r:" + state] = 1
        if state == "overdue":
            one["overdue_reviews"] = 1
        if d.id in flagged:
            one["issues"] = 1
        for kind in ISSUE_KINDS:
            if (d.id in attention[kind]) if kind != "no_owner" else d.owner_id is None:
                one["i:" + kind] = 1
        add(d.department_id, one)
    for r in requests:                                              # people asked, as in ``requests``: they follow the document's department
        d = live.get(r.document_id)
        if d is None or gone(d.department_id):
            continue
        one = Counter({f"w:{r.kind}:pending": 1})
        if r.due_date is not None and r.due_date < now:
            one[f"w:{r.kind}:overdue"] = 1
        add(d.department_id, one)

    labels = org_departments.level_labels(db, who.tenant_id)
    root = scope.department.id if scope.department is not None else None
    base = tree.level(root) if root is not None else 1
    heads = {n: tree.rows[n].department_head_user_id for n in ids if tree.rows[n].department_head_user_id}
    owners = doc_lifecycle._names(db, set(heads.values())) if heads else {}
    by_name = lambda n: (tree.rows[n].name.casefold(), n)           # noqa: E731  (the picker order)
    status_rank = {w: i for i, w in enumerate(STATUS_ORDER)}
    rows: List[dict] = []

    def row(node: Optional[int], name: str, path: List[str], level: int, depth: int, active: bool, owner: Optional[str], total: Counter, own: int) -> dict:
        key = f"dept:{node if node is not None else NONE}"
        return {"key": key, "department_id": node, "name": name, "path": path, "level": level,
                "level_label": labels[min(level, org_departments.MAX_DEPTH) - 1] if level else "", "depth": depth, "is_active": active,
                "owner": owner, "own": own, "documents": total["documents"], "in_force": total["in_force"],
                "in_progress": total["in_progress"], "overdue_reviews": total["overdue_reviews"], "issues": total["issues"],
                "by_status": {k[2:]: v for k, v in sorted(total.items(), key=lambda kv: (status_rank.get(kv[0][2:], 99), kv[0])) if v and k.startswith("s:")},
                "by_type": {k[2:]: v for k, v in sorted(total.items()) if v and k.startswith("t:")},
                "waiting": {kind: {"pending": total[f"w:{kind}:pending"], "overdue": total[f"w:{kind}:overdue"]} for kind in REQUESTS},
                "reviews": {state: total["r:" + state] for state in ("overdue", "due_soon", "unscheduled")},
                "issues_by": {kind: total["i:" + kind] for kind in ISSUE_KINDS}}

    def walk(node: int) -> None:
        department = tree.rows[node]
        total = below[node]
        shown = node == root or department.is_active is not False or total["documents"] > 0 or any(
            tree.rows[x].is_active is not False for x in tree.subtree(node))
        if shown:
            rows.append(row(node, department.name, [d.name for d in tree.path(node)], tree.level(node), tree.level(node) - base,
                            department.is_active is not False, owners.get(department.department_head_user_id), total, mine[node]["documents"]))
        for child in sorted(tree.children.get(node, []), key=by_name):
            if child in ids:
                walk(child)

    for top in ([root] if root is not None else sorted((n for n in tree.rows if tree.parent[n] is None), key=by_name)):
        walk(top)
    if scope.ids is None and mine[None]["documents"]:
        rows.append(row(None, "No department", [], 0, 0, True, None, mine[None], mine[None]["documents"]))
    return rows


def summary(db: Session, user: GRCUser, department: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    now = now or datetime.utcnow()
    who = access(db, user)
    scope = scope_of(who, department)
    data = _load(db, user, who, scope)
    live = _live(data.docs)
    admin_days = doc_lifecycle.settings(db, who.tenant_id)["admin_after_days"]
    attention = _attention(data, now, admin_days)
    dept = {"dept": scope.choice["value"]} if scope.choice["value"] else {}

    def link(**params: str) -> dict:
        return {**dept, **params}

    links: Dict[str, dict] = {}

    # totals, by type, by status
    by_status = Counter(d.status or "draft" for d in live.values())
    totals = {"documents": len(live), "in_force": by_status["published"], "in_progress": sum(by_status[s] for s in IN_PROGRESS),
              "expired": by_status["expired"], "exception_applied": by_status["exception_applied"],
              "archived": sum(1 for d in data.docs if d.status == "archived")}
    links.update({"totals.documents": link(), "totals.in_force": link(status="published"), "totals.in_progress": link(status=",".join(IN_PROGRESS)),
                  "totals.expired": link(status="expired"), "totals.exception_applied": link(status="exception_applied"),
                  "totals.archived": link(status="archived")})
    types: Dict[str, List[int]] = defaultdict(lambda: [0, 0])
    for d in live.values():
        t = types[d.doc_type or ""]
        t[0] += 1
        t[1] += d.status == "published"
    by_type = []
    for doc_type, (count, in_force) in sorted(types.items(), key=lambda kv: (-kv[1][0], _type_label(kv[0]).casefold(), kv[0])):
        by_type.append({"key": f"type:{doc_type}", "doc_type": doc_type, "label": _type_label(doc_type), "count": count, "in_force": in_force,
                        "in_force_key": f"type:{doc_type}:in_force"})
        links[f"type:{doc_type}"] = link(type=doc_type)
        links[f"type:{doc_type}:in_force"] = link(type=doc_type, status="published")
    shown = list(STATUS_ORDER) + sorted(s for s in by_status if s not in STATUS_ORDER)
    by_status_rows = [{"key": f"status:{s}", "status": s, "count": by_status[s]} for s in shown]
    links.update({f"status:{s}": link(status=s) for s in shown})

    # the stage each document in review or approval is at
    in_review = [d for d in live.values() if d.status in PENDING]
    longest = _longest_waiting(data, live, now)
    stages = _stage_rows(db, who, data, {doc_id for (doc_id, _kind, _position), _rows in longest})
    at: Dict[Tuple[str, str], list] = defaultdict(list)
    for d in in_review:
        at[_stage_at(d, stages)].append(d.status)
    stage_rows = []
    for (name, kind), statuses in sorted(at.items(), key=lambda kv: (_KIND_RANK.get(kv[0][1], 99), kv[0][0].casefold(), kv[0][1])):
        key = f"stage:{kind}:{name}"
        stage_rows.append({"key": key, "name": name, "kind": kind, "count": len(statuses)})
        links[key] = link(status=",".join(sorted(set(statuses))))        # the library has no stage filter: it opens the documents of those statuses

    # requests
    requests = {}
    for kind in REQUESTS:
        requests[kind] = _request_figures([r for r in data.requests if r.kind == kind and r.document_id in live], now)
    links.update({"requests.review.pending": link(status="pending_review"), "requests.approval.pending": link(status="pending_approval"),
                  "requests.review.overdue": link(attn="late_approvals"), "requests.approval.overdue": link(attn="late_approvals"),
                  "requests.acknowledgement.overdue": link(attn="late_acknowledgements")})

    # reviews
    reviews = {"overdue": 0, "due_soon": 0, "unscheduled": 0, "up_to_date": 0}
    horizon = now.date() + timedelta(days=REVIEW_SOON_DAYS)
    for d in live.values():
        state = _review_state(d, now, horizon)
        if state is not None:
            reviews[state] += 1
    links.update({"reviews.overdue": link(review="overdue"), "reviews.due_soon": link(review="due_soon"),
                  "reviews.unscheduled": link(review="unscheduled"), "reviews.up_to_date": link(review="ok")})

    # issues
    no_owner = {d.id for d in live.values() if d.owner_id is None}
    lapsed = {d.id for d in live.values() if d.status == "expired"}
    excepted = {d.id for d in live.values() if d.status == "exception_applied"}
    flagged = no_owner | lapsed | excepted | set().union(*attention.values())
    issues = {"no_owner": len(no_owner), "expired": len(lapsed), "exception_applied": len(excepted), "stuck": len(attention["stuck"]),
              "on_hold": len(attention["on_hold"]), "late_acknowledgements": len(attention["late_acknowledgements"]),
              "late_approvals": len(attention["late_approvals"]), "documents": len(flagged)}
    links.update({"issues.no_owner": link(owner="none"), "issues.expired": link(status="expired"),
                  "issues.exception_applied": link(status="exception_applied"), "issues.stuck": link(attn="stuck"),
                  "issues.on_hold": link(attn="on_hold"), "issues.late_acknowledgements": link(attn="late_acknowledgements"),
                  "issues.late_approvals": link(attn="late_approvals")})

    by_department = _by_department(db, who, scope, live, flagged, attention, data.requests, now)
    for r in by_department:
        where = {"dept": str(r["department_id"]) if r["department_id"] is not None else NONE}
        links.update({r["key"]: where, f"{r['key']}:in_force": {**where, "status": "published"},
                      f"{r['key']}:in_progress": {**where, "status": ",".join(IN_PROGRESS)},
                      f"{r['key']}:overdue_reviews": {**where, "review": "overdue"}})

    return {"scope": _scope_view(scope), "choices": who.choices, "as_of": now.isoformat(), "totals": totals, "by_type": by_type,
            "by_status": by_status_rows, "by_department": by_department, "stages": stage_rows, "requests": requests,
            "waiting": _waiting(db, longest, stages, live, now), "reviews": reviews, "issues": issues, "links": links}


def ids(db: Session, user: GRCUser, kind: str, department: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    """The documents behind one of ``KINDS`` in the scope, the ones the summary counts, by id."""
    who = access(db, user)                                  # (first: someone who may not ask is refused before they are told what to ask)
    if kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"kind must be one of {', '.join(KINDS)}.")
    now = now or datetime.utcnow()
    data = _load(db, user, who, scope_of(who, department))
    found = sorted(_attention(data, now, doc_lifecycle.settings(db, who.tenant_id)["admin_after_days"])[kind])
    return {"ids": found, "total": len(found)}


# ── the board and the export (D60) ───────────────────────────────────────────
def _flags(d, attention: Dict[str, Set[int]], state: Optional[str]) -> List[str]:
    """What is wrong with a document, worst first: stuck, on hold, late approvals, late acknowledgements, no owner, an overdue review."""
    out = [k for k in ("stuck", "on_hold", "late_approvals", "late_acknowledgements") if d.id in attention[k]]
    if d.owner_id is None:
        out.append("no_owner")
    if state == "overdue":
        out.append("overdue_review")
    return out


def _attestation(db: Session, who: Access, doc_ids: Iterable[int]) -> Dict[int, dict]:
    """``{document id: {"state", "done", "total"}}`` for every id asked, in one go (never a query per document). The numbers are the library's:
    ``library_lean.attestation_by_document`` (the coverage map's arithmetic: active campaign else latest, acknowledgements over the active people
    of its email domain), and the state is the library's ``attestationBucket(pct)`` - none (no entry: no campaign, or nobody on its domain; done
    and total are null), not_started (0 %), in_progress, complete (100 %) - so the board and the library's Attestation filter cannot disagree."""
    wanted = set(doc_ids)
    if not wanted:
        return {}
    from .routers.document_attestations import _ensure_tables       # as the library's list does, before it reads a campaign (cached per engine)
    _ensure_tables(db)
    found = library_lean.attestation_by_document(db, [who.tenant_id], wanted)
    out: Dict[int, dict] = {}
    for doc_id in wanted:
        a = found.get(doc_id)
        state = "none" if a is None else "not_started" if a["pct"] <= 0 else "complete" if a["pct"] >= 100 else "in_progress"
        out[doc_id] = {"state": state, "done": a["done"] if a else None, "total": a["total"] if a else None}
    return out


def _attestation_words(a: dict) -> str:
    """"No attestation", "Attestation not started", "Attestation: 4 of 12 acknowledged", "Everyone acknowledged"."""
    return f"Attestation: {a['done']} of {a['total']} acknowledged" if a["state"] == "in_progress" else ATTESTATION_WORDS[a["state"]]


def board(db: Session, user: GRCUser, department: Optional[str] = None, group: str = "status", per: int = BOARD_CARDS,
          now: Optional[datetime] = None) -> dict:
    """The documents of the scope as columns (``group``: status | type | department), each with its true count and its first ``per`` cards."""
    if group not in BOARD_GROUPS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"group must be one of {', '.join(BOARD_GROUPS)}.")
    per = max(1, min(int(per), BOARD_MAX))
    now = now or datetime.utcnow()
    who = access(db, user)                                  # (first: someone who may not ask is refused before they are told what to ask)
    scope = scope_of(who, department)
    data = _load(db, user, who, scope)
    live = _live(data.docs)
    attention = _attention(data, now, doc_lifecycle.settings(db, who.tenant_id)["admin_after_days"])
    horizon = now.date() + timedelta(days=REVIEW_SOON_DAYS)
    states = {d.id: _review_state(d, now, horizon) for d in live.values()}
    tree = who.tree

    columns: List[dict] = []                                # key, label, value, department_id (department group), own, docs
    if group == "status":
        by: Dict[str, list] = defaultdict(list)
        for d in live.values():
            by[d.status or "draft"].append(d)
        # the five steps always (empty ones too), then ONE last column for every other live status: expired, exception applied, review required, ...
        rest = [w for w in STATUS_ORDER if w not in FLOW and by.get(w)] + sorted(w for w in by if w not in STATUS_ORDER)
        columns = [{"key": f"status:{w}", "label": STATUS_WORDS[w], "value": w, "docs": by.get(w, [])} for w in FLOW]
        columns.append({"key": f"status:{ATTENTION}", "label": "Needs attention", "value": ATTENTION, "statuses": rest, "docs": [d for w in rest for d in by[w]]})
    elif group == "type":
        by = defaultdict(list)
        for d in live.values():
            by[d.doc_type or ""].append(d)
        columns = [{"key": f"type:{t}", "label": _type_label(t), "value": t, "docs": docs}
                   for t, docs in sorted(by.items(), key=lambda kv: (-len(kv[1]), _type_label(kv[0]).casefold(), kv[0]))]
    elif not scope.no_department:                           # the scope's own documents, then each department directly under it (everything in it)
        ids = scope.ids if scope.ids is not None else set(tree.rows)
        root = scope.department.id if scope.department is not None else None
        kids = [c for c in sorted((tree.children.get(root, []) if root is not None else [n for n in tree.rows if tree.parent[n] is None]),
                                  key=lambda n: (tree.rows[n].name.casefold(), n)) if c in ids]
        owner_of: Dict[Optional[int], int] = {}             # department id -> the column it is counted in
        for kid in kids:
            for node in tree.subtree(kid):
                owner_of[node] = kid
        if root is not None:
            owner_of[root] = root
        mine_: Dict[Optional[int], list] = defaultdict(list)
        for d in live.values():
            if d.department_id is None:
                mine_[None].append(d)
            elif d.department_id in owner_of:
                mine_[owner_of[d.department_id]].append(d)
        if root is not None:
            columns.append({"key": f"dept:{root}:own", "label": tree.rows[root].name, "value": str(root), "department_id": root, "own": True, "docs": mine_.get(root, [])})
        for kid in kids:
            department = tree.rows[kid]
            docs = mine_.get(kid, [])
            if docs or department.is_active is not False:
                columns.append({"key": f"dept:{kid}", "label": department.name, "value": str(kid), "department_id": kid, "own": False, "docs": docs})
        if scope.ids is None and mine_.get(None):
            columns.append({"key": f"dept:{NONE}", "label": "No department", "value": NONE, "department_id": None, "own": False, "docs": mine_[None]})
    else:
        columns = [{"key": f"dept:{NONE}", "label": "No department", "value": NONE, "department_id": None, "own": False, "docs": list(live.values())}]

    def urgency(d) -> tuple:
        return (-len(_flags(d, attention, states[d.id])), -(d.updated_at.timestamp() if d.updated_at else 0.0), -d.id)

    shown_docs = {col["key"]: sorted(col["docs"], key=urgency)[:per] for col in columns}
    owners = doc_lifecycle._names(db, {d.owner_id for docs in shown_docs.values() for d in docs if d.owner_id}) if shown_docs else {}
    attested = _attestation(db, who, (d.id for docs in shown_docs.values() for d in docs))      # the cards shown only, one read

    def card(d) -> dict:
        dept = tree.rows.get(d.department_id) if d.department_id is not None else None
        return {"id": d.id, "title": d.title, "code": d.document_code, "doc_type": d.doc_type or "", "type_label": _type_label(d.doc_type),
                "status": d.status or "draft", "version": permissions.in_force_number(d) or d.current_version,
                "department_id": d.department_id if dept is not None else None, "department": dept.name if dept is not None else None,
                "owner": owners.get(d.owner_id) if d.owner_id else None, "next_review": d.next_review_date.isoformat() if d.next_review_date else None,
                "flags": _flags(d, attention, states[d.id]), "attestation": attested[d.id]}

    out = []
    for col in columns:
        docs = col.pop("docs")
        cards = [card(d) for d in shown_docs[col["key"]]]
        out.append({**col, "count": len(docs), "cards": cards, "more": len(docs) - len(cards)})
    return {"scope": _scope_view(scope), "group": group, "per": per, "as_of": now.isoformat(), "total": len(live), "columns": out}


def _safe(cell: Any) -> str:
    """One CSV cell, with what a spreadsheet would run as a formula (a leading = + - @ or a tab or return) made plain text."""
    text = "" if cell is None else str(cell)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def export_documents(db: Session, user: GRCUser, department: Optional[str] = None, now: Optional[datetime] = None) -> Tuple[str, str]:
    """(the CSV text, a file name) for the documents of the scope that the person may read: one row each, archived ones left out as in every figure.
    Columns: Code, Title, Type, Status, Version, Department, Owner, Next review, Issues, Attestation. No internal id: nobody can use it (UX rule U1)."""
    now = now or datetime.utcnow()
    who = access(db, user)
    scope = scope_of(who, department)
    data = _load(db, user, who, scope)
    live = _live(data.docs)
    attention = _attention(data, now, doc_lifecycle.settings(db, who.tenant_id)["admin_after_days"])
    horizon = now.date() + timedelta(days=REVIEW_SOON_DAYS)
    owners = doc_lifecycle._names(db, {d.owner_id for d in live.values() if d.owner_id}) if live else {}
    issue_words = {"stuck": "Stuck in a stage", "on_hold": "On hold", "late_approvals": "Late approval", "late_acknowledgements": "Late acknowledgement",
                   "no_owner": "No owner", "overdue_review": "Review overdue"}

    def where(d) -> str:
        return " > ".join(p.name for p in who.tree.path(d.department_id)) if d.department_id in who.tree.rows else ""

    rows = sorted(live.values(), key=lambda d: (where(d).casefold(), (d.title or "").casefold(), d.id))
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    attested = _attestation(db, who, live)                  # every row, one read
    writer.writerow(["Code", "Title", "Type", "Status", "Version", "Department", "Owner", "Next review", "Issues", "Attestation"])
    for d in rows:
        flags = _flags(d, attention, _review_state(d, now, horizon))
        writer.writerow([_safe(x) for x in [d.document_code, d.title, _type_label(d.doc_type) if d.doc_type else "", STATUS_WORDS.get(d.status or "draft", d.status),
                                            permissions.in_force_number(d) or d.current_version, where(d), owners.get(d.owner_id) if d.owner_id else "",
                                            d.next_review_date.date().isoformat() if d.next_review_date else "", "; ".join(issue_words[f] for f in flags),
                                            _attestation_words(attested[d.id])]])
    name = re.sub(r"[^a-z0-9]+", "-", (scope.choice["name"] or "documents").lower()).strip("-") or "documents"
    return "\ufeff" + out.getvalue(), f"documents-{name}-{now.date().isoformat()}.csv"
