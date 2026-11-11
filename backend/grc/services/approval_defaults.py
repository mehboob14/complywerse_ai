"""Approval defaults: who reviews and approves by default in a department, sub-department or unit, and who implements an exception there
(the Directory; table ``grc_approval_defaults``, model ``_94_approval_defaults.py``).

A default is set for the whole organisation or for one unit (and so for everything under it), for one of four things:

* ``doc_review`` / ``doc_approval``: who a document of the unit is sent to for review / for approval when its author named nobody;
* ``doc_route``: a whole approval route (the stages of ``modules/governance/routes.py``) instead of those two;
* ``exc_implementer``: who carries out an exception of the unit once it is approved (pre-filled; the author may change it).

**Which default applies.** Per subject, the nearest one up the tree (the unit, then the ones above it, then the organisation's) - except
that a LOCKED one stands over every one below it (the highest locked one wins: the organisation can bind every unit, a department
every unit under it). A document takes the route if a route applies and is not weaker than the reviewers / approvers that apply (the
same unit or higher, or locked); otherwise the reviewers and approvers, each from where it applies.

**Enforcement** (the server, not the screen): sending a document for review with nobody named COPIES the default into the document's own
sign-off (``apply_to_document``: changing a default later never changes a document already in review); a locked default's people can
not be left out of the sign-off (``ensure`` refuses in words at Send; ``on_round`` adds them back when a document goes to review
again). ``document_signoff.get_signoff`` says it all: ``defaults_applied`` / ``defaults_available``.

**Owners.** ``unit_owner`` is the head of the unit, else of the nearest unit above it that has one; ``parent_owner`` the same, starting at
the unit above. A document's sign-off stores both as ``unit_owner`` of one unit (``anchor``): the column that holds a participant's type
is ten characters wide, so ``parent_owner`` is stored as the owner of the parent unit, which reads the same.

Functions that write only ``flush``: the caller commits. Problems a person can fix raise ``HTTPException`` (400/404/409) with a sentence.
"""
from __future__ import annotations

import copy
import json
import logging
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models import ApprovalDefault, DocumentAuditLog, DocumentSignoffAssignment, GRCDepartment, GRCUser, Role, Team
from . import org_departments

logger = logging.getLogger(__name__)

SUBJECTS = ("doc_review", "doc_approval", "doc_route", "exc_implementer")
PEOPLE_TYPES = ("user", "role", "team", "unit_owner", "parent_owner")
OWNERS = ("unit_owner", "parent_owner")
ORG = "org"                                       # the unit in a URL for the whole organisation
ORG_NAME = "The organisation"
AUDIT_ACTION = "defaults_applied"                 # the document's Change log says it (change_chain.EVENT_LABEL)
OWNER_LABEL = {"unit_owner": "Owner of the unit", "parent_owner": "Owner of the unit above"}
GONE = {"user": "Someone who left", "role": "A role that was removed", "team": "A department that was removed"}
NOBODY_CHOSEN = {"doc_review": "Choose at least one reviewer.", "doc_approval": "Choose at least one approver.",
                 "doc_route": "A route needs at least one stage.", "exc_implementer": "Choose who carries the exception out."}
WORDS = {"doc_review": "reviewers", "doc_approval": "approvers", "doc_route": "approval route", "exc_implementer": "implementer"}


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ── owners ───────────────────────────────────────────────────────────────────
def _tree_of(db: Session, department_id: Optional[int]) -> Optional[org_departments.Tree]:
    d = db.get(GRCDepartment, department_id) if department_id else None
    return org_departments.Tree.load(db, d.tenant_id) if d is not None else None


def owner_of(db: Session, department_id: Optional[int], tree: Optional[org_departments.Tree] = None) -> Optional[int]:
    """The unit's head, else the head of the nearest unit above it that has one (None: nobody on the way up)."""
    tree = tree or _tree_of(db, department_id)
    if tree is None or department_id not in tree.rows:
        return None
    return next((d.department_head_user_id for d in reversed(tree.path(department_id)) if d.department_head_user_id), None)


def parent_of(db: Session, department_id: Optional[int], tree: Optional[org_departments.Tree] = None) -> Optional[int]:
    tree = tree or _tree_of(db, department_id)
    return tree.parent.get(department_id) if tree is not None and department_id in tree.rows else None


def owner_user_ids(db: Session, tenant_ids: Iterable[int], department_id: Optional[int]) -> Set[int]:
    """``unit_owner`` of a unit as the people it asks (``document_signoff._resolve_target_users``): its owner, if the unit is in one
    of these tenants and somebody up its tree has one."""
    d = db.get(GRCDepartment, department_id) if department_id else None
    if d is None or d.tenant_id not in set(tenant_ids):
        return set()
    owner = owner_of(db, d.id)
    return {owner} if owner else set()


def owner_label(db: Session, department_id: Optional[int]) -> str:
    """How a sign-off names ``unit_owner`` of a unit: "Owner of Operations"."""
    d = db.get(GRCDepartment, department_id) if department_id else None
    return f"Owner of {d.name}" if d is not None else "Owner of the unit (none)"


def anchor(db: Session, doc, kind: str, ref: int = 0) -> Tuple[str, int]:
    """An owner as a document's sign-off stores it, as ``unit_owner`` of one unit: of the document's unit (or of ``ref``, the unit a
    stored one already names), and ``parent_owner`` of the unit above it. 0 when there is no such unit (a document with no unit, a
    top-level one's parent): nobody, which the sign-off says in words when the document is sent."""
    if kind == "unit_owner":
        return kind, int(ref or 0) or int(doc.department_id or 0)
    return "unit_owner", int(parent_of(db, doc.department_id) or 0)


def owner_options(db: Session, tenant_ids: Iterable[int], department_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """The two owners a participant picker offers, by who they are today for ``department_id`` (None: the person is not known)."""
    d = db.get(GRCDepartment, department_id) if department_id else None
    tree = _tree_of(db, department_id) if d is not None and d.tenant_id in set(tenant_ids) else None
    people = {k: _holder(db, k, department_id, tree) for k in OWNERS}
    return [{"type": k, "name": OWNER_LABEL[k], "person": people[k]} for k in OWNERS]


def _holder(db: Session, kind: str, department_id: Optional[int], tree: Optional[org_departments.Tree]) -> Optional[str]:
    """The name of the person an owner is today, for a unit (None: nobody up its tree has one, or no unit)."""
    if tree is None or department_id not in tree.rows:
        return None
    at = department_id if kind == "unit_owner" else tree.parent.get(department_id)
    owner = owner_of(db, at, tree) if at is not None else None
    user = db.get(GRCUser, owner) if owner else None
    return (user.display_name or user.username or user.email) if user is not None else None


# ── reading ──────────────────────────────────────────────────────────────────
def _rows(db: Session, tenant_id: int) -> List[ApprovalDefault]:
    return db.query(ApprovalDefault).filter(ApprovalDefault.tenant_id == tenant_id).order_by(ApprovalDefault.id).all()


def row_dict(r: ApprovalDefault) -> Dict[str, Any]:
    return {"id": r.id, "department_id": r.department_id, "subject": r.subject, "people": copy.deepcopy(r.people or []),
            "route": copy.deepcopy(r.route) if r.route else None, "locked": bool(r.locked), "is_active": r.is_active is not False,
            "updated_at": _iso(r.updated_at)}


def _depths(tree: org_departments.Tree, department_id: Optional[int]) -> Dict[Optional[int], int]:
    """The unit and the ones above it, by how deep each is (the organisation 0, a top department 1...)."""
    path = tree.path(department_id) if department_id in tree.rows else []
    return {None: 0, **{d.id: i for i, d in enumerate(path, start=1)}}


def _strength(row: ApprovalDefault, depth: int) -> Tuple[int, int]:
    """A locked default stands over every unlocked one, the highest locked one over the lower; else the deepest (nearest) wins."""
    return (1, -depth) if row.locked else (0, depth)


def _best(rows: Sequence[ApprovalDefault], subject: str, depths: Dict[Optional[int], int]):
    fits = [r for r in rows if r.subject == subject and r.is_active is not False and r.department_id in depths
            and (subject != "doc_route" or r.route)]
    row = max(fits, key=lambda r: _strength(r, depths[r.department_id]), default=None)
    return row, (_strength(row, depths[row.department_id]) if row is not None else None)


def _source(tree: org_departments.Tree, row: ApprovalDefault, department_id: Optional[int]) -> Dict[str, Any]:
    where = row.department_id
    return {"department_id": where, "name": tree.rows[where].name if where in tree.rows else ORG_NAME, "inherited": where != department_id}


def _found(tree, row, department_id) -> Optional[Dict[str, Any]]:
    return None if row is None else {"row": row_dict(row), "source": _source(tree, row, department_id)}


def resolve(db: Session, tenant_id: int, subject: str, department_id: Optional[int] = None,
            tree: Optional[org_departments.Tree] = None, rows: Optional[Sequence[ApprovalDefault]] = None) -> Optional[Dict[str, Any]]:
    """The default that applies to a unit for one subject: ``{row, source: {department_id, name, inherited}}``, or None. The nearest
    active one on the path from the unit up (then the organisation's); a locked one higher up stands over it."""
    tree = tree or org_departments.Tree.load(db, tenant_id)
    rows = _rows(db, tenant_id) if rows is None else rows
    row, _s = _best(rows, subject, _depths(tree, department_id))
    return _found(tree, row, department_id)


def resolve_document(db: Session, tenant_id: int, department_id: Optional[int] = None, tree: Optional[org_departments.Tree] = None,
                     rows: Optional[Sequence[ApprovalDefault]] = None) -> Optional[Dict[str, Any]]:
    """What a document of the unit is sent to when its author named nobody: ``{"kind": "route", "route": R}``, or
    ``{"kind": "people", "review": R | None, "approval": R | None}`` (each R as ``resolve`` gives it), or None. A route applies when
    it is not weaker than the reviewers and approvers that apply (the same unit or higher up, or locked)."""
    tree = tree or org_departments.Tree.load(db, tenant_id)
    rows = _rows(db, tenant_id) if rows is None else rows
    depths = _depths(tree, department_id)
    best = {s: _best(rows, s, depths) for s in ("doc_route", "doc_review", "doc_approval")}
    people = [best[s][1] for s in ("doc_review", "doc_approval") if best[s][0] is not None]
    if best["doc_route"][0] is not None and (not people or best["doc_route"][1] >= max(people)):
        return {"kind": "route", "route": _found(tree, best["doc_route"][0], department_id)}
    if people:
        return {"kind": "people", "review": _found(tree, best["doc_review"][0], department_id),
                "approval": _found(tree, best["doc_approval"][0], department_id)}
    return None


def _parts(found: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [found["route"]] if found["kind"] == "route" else [p for p in (found["review"], found["approval"]) if p]


def _summary(found: Dict[str, Any]) -> Dict[str, Any]:
    """Which defaults a document got, in a few words for the sign-off dialog: ``subject`` (doc_route, doc_review, doc_approval, or
    doc_people when both), ``subjects``, ``source`` (the unit's own when it has one) and ``sources`` (all the names)."""
    parts = _parts(found)
    subjects = [p["row"]["subject"] for p in parts]
    return {"subject": subjects[0] if len(subjects) == 1 else "doc_people", "subjects": subjects,
            "source": min(parts, key=lambda p: p["source"]["department_id"] is None)["source"],
            "sources": list(dict.fromkeys(p["source"]["name"] for p in parts))}


# ── showing ──────────────────────────────────────────────────────────────────
def _labels(db: Session, tenant_id: int, items: Iterable[Tuple[str, Optional[int]]]) -> Dict[Tuple[str, int], str]:
    """(type, id) -> name for people, roles and departments (teams): what a screen says instead of an id."""
    want: Dict[str, Set[int]] = {"user": set(), "role": set(), "team": set()}
    for kind, ref in items:
        if kind in want and ref:
            want[kind].add(int(ref))
    out: Dict[Tuple[str, int], str] = {}
    if want["user"]:
        for i, d, u, e in db.query(GRCUser.id, GRCUser.display_name, GRCUser.username, GRCUser.email).filter(GRCUser.id.in_(want["user"])):
            out[("user", i)] = d or u or e
    if want["role"]:
        for i, n in db.query(Role.id, Role.name).filter(Role.id.in_(want["role"]), Role.tenant_id == tenant_id):
            out[("role", i)] = n
    if want["team"]:
        for i, n in db.query(Team.id, Team.name).filter(Team.id.in_(want["team"]), Team.tenant_id == tenant_id):
            out[("team", i)] = n
    return out


def _person_view(kind: str, ref: Optional[int], labels: Dict, holders: Dict[str, Optional[str]]) -> Dict[str, Any]:
    if kind in OWNERS:
        return {"type": kind, "id": None, "label": OWNER_LABEL[kind], "holder": holders.get(kind)}
    name = labels.get((kind, ref))
    return {"type": kind, "id": ref, "label": name or GONE.get(kind, "Unknown"), "gone": name is None}


def _row_view(row: Dict[str, Any], labels: Dict, holders: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """The row with its people by name (``people``: {type, id, label, holder?}); a route's stages' people as {target_type, target_id, label}."""
    out = {**row, "people": [_person_view(p["type"], p.get("id"), labels, holders) for p in row["people"]]}
    if row["route"]:
        out["route"] = [{**s, "people": [{"target_type": p["target_type"], "target_id": p.get("target_id"),
                                          **{k: v for k, v in _person_view(p["target_type"], p.get("target_id"), labels, holders).items()
                                             if k in ("label", "holder", "gone")}} for p in s["people"]]} for s in row["route"]]
    return out


def _named(rows: Iterable[Dict[str, Any]]):
    for r in rows:
        for p in r["people"]:
            yield p["type"], p.get("id")
        for s in r["route"] or []:
            for p in s["people"]:
                yield p["target_type"], p.get("target_id")


def view(db: Session, tenant_id: int, department_id: Optional[int]) -> Dict[str, Any]:
    """Everything the Directory's Approvals tab shows for a unit (None: the organisation): for each subject its own default, the one
    that applies (``effective``, with ``source`` and whether a lock above stops it being changed here) and which of route or
    reviewers / approvers a document would follow (``document``)."""
    tree = org_departments.Tree.load(db, tenant_id)
    rows = _rows(db, tenant_id)
    eff = {s: resolve(db, tenant_id, s, department_id, tree, rows) for s in SUBJECTS}
    own = {s: next((row_dict(r) for r in rows if r.department_id == department_id and r.subject == s), None) for s in SUBJECTS}
    shown = [x for x in (*own.values(), *(e["row"] for e in eff.values() if e)) if x]
    labels = _labels(db, tenant_id, _named(shown))
    holders = {k: _holder(db, k, department_id, tree) for k in OWNERS}
    subjects = {}
    for s in SUBJECTS:
        e = eff[s]
        subjects[s] = {"own": _row_view(own[s], labels, holders) if own[s] else None,
                       "effective": _row_view(e["row"], labels, holders) if e else None, "source": e["source"] if e else None,
                       "locked_above": bool(e and e["row"]["locked"] and e["source"]["department_id"] != department_id)}
    found = resolve_document(db, tenant_id, department_id, tree, rows)
    return {"department_id": department_id, "department_name": tree.rows[department_id].name if department_id in tree.rows else ORG_NAME,
            "subjects": subjects, "document": found["kind"] if found else None}


def overview(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Which units define their own default, for the badges: ``{units: {department id: {subject: bool}}, organisation: {subject: bool}}``
    (a switched-off default does not count)."""
    units: Dict[int, Dict[str, bool]] = {}
    org = {s: False for s in SUBJECTS}
    for r in _rows(db, tenant_id):
        if r.is_active is False or r.subject not in SUBJECTS:
            continue
        (org if r.department_id is None else units.setdefault(r.department_id, {s: False for s in SUBJECTS}))[r.subject] = True
    return {"units": units, "organisation": org}


# ── writing ──────────────────────────────────────────────────────────────────
def _clean_people(db: Session, tenant_id: int, subject: str, raw: Any) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in raw or []:
        kind = (p or {}).get("type")
        if kind not in PEOPLE_TYPES:
            raise _problem("Choose a person, a role, a department or an owner.")
        if kind == "team" and subject == "exc_implementer":
            raise _problem("Someone who carries out an exception is a person, a role or an owner, not a department.")
        if kind in OWNERS:
            item: Dict[str, Any] = {"type": kind}
        else:
            try:
                ref = int(p.get("id"))
            except (TypeError, ValueError):
                ref = 0
            if ref < 1:
                raise _problem("Choose who is asked.")
            item = {"type": kind, "id": ref}
        if item not in out:
            out.append(item)
    if not out:
        raise _problem(NOBODY_CHOSEN[subject])
    _check_exist(db, tenant_id, [(p["type"], p.get("id")) for p in out])
    return out


def _check_exist(db: Session, tenant_id: int, items: Sequence[Tuple[str, Optional[int]]]) -> None:
    """The people, roles and departments named exist, here, and the people are active people of this platform (400 in words)."""
    from ..modules.governance import exception_approvals

    exception_approvals._check_people(db, tenant_id, [{"people": [{"type": k, "id": i} for k, i in items if k in ("user", "role")]}])
    teams = {i for k, i in items if k == "team"}
    if teams and {t for (t,) in db.query(Team.id).filter(Team.id.in_(teams), Team.tenant_id == tenant_id, Team.is_active.is_(True))} != teams:
        raise _problem("A department chosen does not exist.")


def _clean_route(db: Session, tenant_id: int, raw: Any) -> List[Dict[str, Any]]:
    """The stages of a route as saved: ``routes.validate``'s, with each person as {target_type, target_id?} (an owner has no id)."""
    from ..modules.governance import routes

    if not raw:
        raise _problem(NOBODY_CHOSEN["doc_route"])
    try:
        stages = routes.validate([dict(s or {}) for s in raw])
    except ValueError as exc:
        raise _problem(str(exc)) from None
    _check_exist(db, tenant_id, [(t, i) for s in stages for t, i in s["people"] if t not in OWNERS])
    return [{**s, "people": [{"target_type": t, **({"target_id": i} if i else {})} for t, i in s["people"]]} for s in stages]


def save(db: Session, tenant_id: int, department_id: Optional[int], subject: str, body: Dict[str, Any], by_user_id: Optional[int]) -> ApprovalDefault:
    """Set (or change) the unit's default for a subject. Refused (409) when a unit above has locked it: it is changed there."""
    if subject not in SUBJECTS:
        raise _problem("Choose what the default is for.", status.HTTP_404_NOT_FOUND)
    tree = org_departments.Tree.load(db, tenant_id)
    if department_id is not None and department_id not in tree.rows:
        raise _problem("Department not found.", status.HTTP_404_NOT_FOUND)
    above = resolve(db, tenant_id, subject, department_id, tree)
    if above and above["row"]["locked"] and above["source"]["department_id"] != department_id:
        raise _problem(f"{above['source']['name']} has locked the default {WORDS[subject]}. Change them there.", status.HTTP_409_CONFLICT)
    if subject == "doc_route":
        people, route = [], _clean_route(db, tenant_id, body.get("route"))
    else:
        people, route = _clean_people(db, tenant_id, subject, body.get("people")), None
    row = db.query(ApprovalDefault).filter(ApprovalDefault.tenant_id == tenant_id, ApprovalDefault.department_id == department_id,
                                           ApprovalDefault.subject == subject).first()
    now = datetime.utcnow()
    if row is None:
        row = ApprovalDefault(tenant_id=tenant_id, department_id=department_id, subject=subject, created_by=by_user_id, created_at=now)
        db.add(row)
    row.people, row.route, row.locked = people, route, bool(body.get("locked"))
    row.is_active, row.updated_by, row.updated_at = body.get("is_active") is not False, by_user_id, now
    db.flush()
    return row


def remove(db: Session, tenant_id: int, department_id: Optional[int], subject: str) -> bool:
    """Back to inherited: the unit's own default for the subject is deleted. True when there was one."""
    return bool(db.query(ApprovalDefault).filter(ApprovalDefault.tenant_id == tenant_id, ApprovalDefault.department_id == department_id,
                                                 ApprovalDefault.subject == subject).delete())


# ── a document: copy the default in, hold a locked one ───────────────────────
def _assignments(db: Session, doc) -> List[DocumentSignoffAssignment]:
    return db.query(DocumentSignoffAssignment).filter(DocumentSignoffAssignment.document_id == doc.id).order_by(DocumentSignoffAssignment.id).all()


def _named_nobody(db: Session, doc, assignments: Sequence[DocumentSignoffAssignment]) -> bool:
    """No reviewer, no approver and no stages of its own: the sign-off a default may fill."""
    from ..modules.governance import routes

    return not any(a.role_type in ("reviewer", "approver") for a in assignments) and not routes.is_custom(routes.stages(db, doc))


def _person_anchored(db: Session, doc, kind: str, ref: Optional[int]) -> Tuple[str, int]:
    return anchor(db, doc, kind, 0) if kind in OWNERS else (kind, int(ref or 0))


def available_view(db: Session, doc, assignments: Sequence[DocumentSignoffAssignment]) -> Optional[Dict[str, Any]]:
    """What sending the document would copy in now: the default that applies to its unit, when nobody is named yet (else None)."""
    if not _named_nobody(db, doc, assignments):
        return None
    found = resolve_document(db, doc.tenant_id, doc.department_id)
    return _summary(found) if found else None


def apply_to_document(db: Session, doc, by: Optional[int]) -> Optional[Dict[str, Any]]:
    """The document names nobody to review or approve it: copy the default of its unit into its sign-off (a route's stages, or
    reviewers and approvers), as if the author had chosen them, and say so in its history. Returns what was applied (``_summary``),
    None when it names somebody already or no default applies."""
    from ..modules.governance import routes
    from ..modules.governance.routers import document_signoff as signoff
    from ..modules.governance.routers.versions import create_audit_log

    if not _named_nobody(db, doc, _assignments(db, doc)):
        return None
    found = resolve_document(db, doc.tenant_id, doc.department_id)
    if found is None:
        return None
    if found["kind"] == "route":
        try:
            stages = routes.validate([dict(s) for s in found["route"]["row"]["route"]])
        except ValueError as exc:
            raise _problem(f"The default route of {found['route']['source']['name']} cannot be used: {exc}") from None
        signoff.write_route(db, doc, stages, by)
    else:
        now = datetime.utcnow()
        for role_type, key in (("reviewer", "review"), ("approver", "approval")):
            for p in (found[key]["row"]["people"] if found[key] else []):
                kind, ref = _person_anchored(db, doc, p["type"], p.get("id"))
                db.add(DocumentSignoffAssignment(tenant_id=doc.tenant_id, document_id=doc.id, role_type=role_type, target_type=kind,
                                                 target_id=ref, added_by=by, added_at=now))
        signoff.ensure_prepared_by(db, doc, by, now)
        db.flush()
    summary = _summary(found)
    have = [[a.role_type, a.target_type, a.target_id] for a in _assignments(db, doc) if a.role_type in ("reviewer", "approver")]
    create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by or doc.owner_id or doc.author_id, action=AUDIT_ACTION,
                     action_details=f"Defaults from {' and '.join(summary['sources'])} applied: {signoff._round_summary(db, doc)}",
                     field_changed="defaults", new_value=json.dumps({**summary, "people": have}))
    return summary


def applied_view(db: Session, doc, assignments: Sequence[DocumentSignoffAssignment]) -> Optional[Dict[str, Any]]:
    """The defaults that filled the document's sign-off (the last time), while those people are still in it; None otherwise."""
    row = (db.query(DocumentAuditLog.new_value).filter(DocumentAuditLog.document_id == doc.id, DocumentAuditLog.action == AUDIT_ACTION,
                                                       DocumentAuditLog.new_value.isnot(None)).order_by(DocumentAuditLog.id.desc()).first())
    try:
        said = json.loads(row[0]) if row and row[0] else None
    except ValueError:
        return None
    if not said:
        return None
    have = {(a.role_type, a.target_type, a.target_id) for a in assignments}
    if any((r, t, i) not in have for r, t, i in said.get("people", [])):
        return None
    return {k: said.get(k) for k in ("subject", "subjects", "source", "sources")}


def _locked_needs(db: Session, doc) -> List[Tuple[str, str, str, int]]:
    """What a locked default asks of the document's sign-off: (who locks it, reviewer | approver, type, id) for each person."""
    found = resolve_document(db, doc.tenant_id, doc.department_id)
    out: List[Tuple[str, str, str, int]] = []
    if found is None:
        return out
    if found["kind"] == "route":
        r = found["route"]
        if r["row"]["locked"]:
            for s in r["row"]["route"]:
                for p in s["people"]:
                    out.append((r["source"]["name"], "approver" if s["kind"] == "approval" else "reviewer",
                                *_person_anchored(db, doc, p["target_type"], p.get("target_id"))))
        return out
    for role_type, key in (("reviewer", "review"), ("approver", "approval")):
        r = found[key]
        if r and r["row"]["locked"]:
            out.extend((r["source"]["name"], role_type, *_person_anchored(db, doc, p["type"], p.get("id"))) for p in r["row"]["people"])
    return out


def _missing(db: Session, doc) -> List[Tuple[str, str, str, int]]:
    have = {(a.role_type, a.target_type, a.target_id) for a in _assignments(db, doc)}
    return [n for n in _locked_needs(db, doc) if n[1:] not in have]


def _sentences(db: Session, missing: Sequence[Tuple[str, str, str, int]]) -> List[str]:
    from ..modules.governance.routers.document_signoff import _target_display

    groups: Dict[Tuple[str, str], List[str]] = {}
    for source, role_type, kind, ref in missing:
        groups.setdefault((source, role_type), []).append(_target_display(db, kind, ref))
    return [f"{source} requires {', '.join(names)} to stay among the {'reviewers' if role == 'reviewer' else 'approvers'} of its documents. "
            "Add them, then send it again." for (source, role), names in groups.items()]


def ensure(db: Session, doc, by: Optional[int]) -> Optional[Dict[str, Any]]:
    """Send for review: copy in the default when nobody is named, then refuse (400, in words) when a locked default's people were left
    out. Returns what was applied (None: nothing was)."""
    applied = apply_to_document(db, doc, by)
    gone = _sentences(db, _missing(db, doc))
    if gone:
        raise _problem(" ".join(gone))
    return applied


def top_up(db: Session, doc, by: Optional[int]) -> int:
    """A document goes to review again with the people it has: those a locked default asks for and it lacks are added (its history
    says who). Only a document on the usual route (reviewers, then approvers); one with a route of its own is held at Send. Returns how many."""
    from ..modules.governance import routes
    from ..modules.governance.routers.versions import create_audit_log

    if routes.is_custom(routes.stages(db, doc)):
        return 0
    missing = _missing(db, doc)
    now = datetime.utcnow()
    for _source, role_type, kind, ref in missing:
        db.add(DocumentSignoffAssignment(tenant_id=doc.tenant_id, document_id=doc.id, role_type=role_type, target_type=kind, target_id=ref,
                                         added_by=by, added_at=now))
    if missing:
        db.flush()
        from ..modules.governance.routers.document_signoff import _target_display

        names = ", ".join(_target_display(db, kind, ref) for _s, _r, kind, ref in missing)
        create_audit_log(db=db, document_id=doc.id, tenant_id=doc.tenant_id, user_id=by or doc.owner_id or doc.author_id, action=AUDIT_ACTION,
                         action_details=f"Added back as {' and '.join(dict.fromkeys(m[0] for m in missing))} requires: {names}", field_changed="defaults")
    return len(missing)


def on_round(db: Session, doc, by: Optional[int]) -> None:
    """A document goes to review or approval (``doc_lifecycle.start_round``): the unit's default fills a sign-off nobody named, and a
    locked default's people are put back. It never stops a document going on: a failure here is logged and nothing is changed."""
    try:
        with db.begin_nested():
            if apply_to_document(db, doc, by) is None:
                top_up(db, doc, by)
    except Exception:       # noqa: BLE001
        logger.exception("approval defaults: could not apply the defaults of a document's unit")


# ── an exception: the implementer ────────────────────────────────────────────
def implementer_default(db: Session, tenant_id: int, unit_id: Optional[int]) -> Optional[Dict[str, Any]]:
    """The implementer an exception of the unit starts with (an exception's ``implementer``, as ``validate_implementer`` saves it), from
    the unit's ``exc_implementer`` default; None when none applies. Not checked: whoever left is told when it is submitted."""
    found = resolve(db, tenant_id, "exc_implementer", unit_id)
    people = [{"type": p["type"], **({"id": p["id"]} if p.get("id") else {})} for p in (found["row"]["people"] if found else []) if p["type"] != "team"]
    return {"name": "Implementation", "due_days": None, "people": people} if people else None


def enforce_implementer(db: Session, exc, unit_id: Optional[int]) -> None:
    """Submitting an exception: with no implementer it gets its unit's default; with one, a locked default's people have to be in it
    (400, in words). Changes ``exc.implementer`` only; the caller commits."""
    found = resolve(db, exc.tenant_id, "exc_implementer", unit_id)
    if found is None:
        return
    if not exc.implementer or not (exc.implementer.get("people") or []):
        exc.implementer = implementer_default(db, exc.tenant_id, unit_id)
        return
    if not found["row"]["locked"]:
        return
    chosen = {(p["type"], p.get("id")) for p in exc.implementer.get("people") or []}
    need = [p for p in found["row"]["people"] if p["type"] != "team" and (p["type"], p.get("id")) not in chosen]
    if need:
        labels = _labels(db, exc.tenant_id, [(p["type"], p.get("id")) for p in need])
        names = [_person_view(p["type"], p.get("id"), labels, {})["label"] for p in need]
        raise _problem(f"{found['source']['name']} requires {', '.join(names)} among those who carry out its exceptions. "
                       "Add them, then submit again.")
