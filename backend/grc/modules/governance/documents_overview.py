"""The Documents Overview (Governance > Documents > Overview): the library at a glance for the head of a department or for anyone who
may read the whole library - how many documents, of which types, at which status and stage, who they wait for, which reviews are
due and what needs attention - for the whole organisation or for one department and everything under it.

Who may ask: whoever reads the whole library (an administrator, or a platform-given role holding ``governance:policies:*``) and the
head of at least one department (``org_departments.headed_by``). Nobody else (403). A head without a library right is held to the
library's own rule: only the documents they own, wrote or are asked about are counted (``permissions.visible_filter``, applied to
every figure and to the ``ids`` list); the overview never widens what anyone may read.

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

Nothing here writes. Every figure comes from a fixed number of queries however many documents and departments there are.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models import DocumentObligation, DocumentRouteHold, DocumentRouteStage, GovernanceDocument, GRCUser
from ...routers.auth_router import get_user_primary_tenant
from ...services import org_departments
from . import doc_lifecycle, permissions, routes

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

REFUSED = "The documents overview is for people who can read the document library and for the head of a department."
NOT_YOURS = "You can open the overview of the departments you head and of everything under them."


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
    """What the person may open: 403 for someone who reads no library and heads no department."""
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    whole = permissions.is_admin(db, user) or permissions.can_read_library(db, user)
    headed = org_departments.headed_by(db, user.id, [tenant_id])
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
                     G.current_version, G.published_version).filter(*conds).order_by(G.id).all())
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
        if not _reviewable(d):
            continue
        due = d.next_review_date
        if due is None:
            reviews["unscheduled"] += 1
        elif due < now:
            reviews["overdue"] += 1
        elif due.date() <= horizon:
            reviews["due_soon"] += 1
        else:
            reviews["up_to_date"] += 1
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

    return {"scope": _scope_view(scope), "choices": who.choices, "as_of": now.isoformat(), "totals": totals, "by_type": by_type,
            "by_status": by_status_rows, "stages": stage_rows, "requests": requests, "waiting": _waiting(db, longest, stages, live, now),
            "reviews": reviews, "issues": issues, "links": links}


def ids(db: Session, user: GRCUser, kind: str, department: Optional[str] = None, now: Optional[datetime] = None) -> dict:
    """The documents behind one of ``KINDS`` in the scope, the ones the summary counts, by id."""
    if kind not in KINDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"kind must be one of {', '.join(KINDS)}.")
    now = now or datetime.utcnow()
    who = access(db, user)
    data = _load(db, user, who, scope_of(who, department))
    found = sorted(_attention(data, now, doc_lifecycle.settings(db, who.tenant_id)["admin_after_days"])[kind])
    return {"ids": found, "total": len(found)}
