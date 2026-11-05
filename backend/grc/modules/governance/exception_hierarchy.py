"""The exceptions by the unit they cover and by their documents (DECISIONS D62): the two hierarchical views of the Exceptions page.

An exception is **for a unit** (a department, sub-department or unit of the organisation): its own, else its document's. A unit's exceptions cover
everything under it, so a row of the tree counts the exceptions raised for that unit **and for the units under it** (``own`` is the ones raised for
it itself). ``by_unit`` is the tree with those counts; ``by_document`` puts the documents that have exceptions under the unit they were raised
for, like the library's Folders view. Both read what the list reads (every exception of the person's organisation) and never name a document the
person may not open. Nothing here writes.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from sqlalchemy.orm import Session

from ...models import GovernanceDocument, GRCUser, PolicyException
from ...services import org_departments
from . import exception_approvals as A
from .permissions import readable_among

OPEN = ("draft", "pending_approval")
EXPIRING_DAYS = 30


def _tenants(db: Session, user: GRCUser) -> List[int]:
    from ...routers.auth_router import get_user_tenants

    return list(get_user_tenants(user, db))


def load(db: Session, user: GRCUser):
    """(the exceptions of the person's organisation, the documents they are about by id)."""
    tenants = _tenants(db, user)
    if not tenants:
        return [], {}
    items = db.query(PolicyException).filter(PolicyException.tenant_id.in_(tenants)).order_by(PolicyException.created_at.desc(), PolicyException.id.desc()).all()
    doc_ids = {e.document_id for e in items if e.document_id}
    docs = {d.id: d for d in db.query(GovernanceDocument.id, GovernanceDocument.title, GovernanceDocument.doc_type, GovernanceDocument.document_code,
                                      GovernanceDocument.department_id).filter(GovernanceDocument.id.in_(doc_ids))} if doc_ids else {}
    return items, docs


def unit_of(exc: PolicyException, docs: Dict[int, Any], tree: org_departments.Tree) -> Optional[int]:
    """The unit an exception is raised for: its own, else its document's; None when it has neither (or the unit is gone)."""
    unit = exc.department_id or (docs[exc.document_id].department_id if exc.document_id in docs else None)
    return unit if unit in tree.rows else None


def counts(items: Sequence[PolicyException], implementing: Set[int], now: datetime) -> Dict[str, int]:
    """total, open (a draft or waiting for a decision), approved (in effect), expiring (approved, ends within 30 days), to_implement."""
    horizon = now + timedelta(days=EXPIRING_DAYS)
    return {"total": len(items), "open": sum(1 for e in items if e.status in OPEN), "approved": sum(1 for e in items if e.status == "approved"),
            "expiring": sum(1 for e in items if e.status == "approved" and e.expiry_date is not None and now <= e.expiry_date <= horizon),
            "to_implement": sum(1 for e in items if e.id in implementing)}


def _order(tree: org_departments.Tree) -> List[tuple]:
    """(department id, depth) in the picker's order: the tree from the top, each level by name."""
    key = lambda n: (tree.rows[n].name.casefold(), n)           # noqa: E731
    out: List[tuple] = []

    def walk(node: int, depth: int) -> None:
        out.append((node, depth))
        for child in sorted(tree.children.get(node, []), key=key):
            walk(child, depth + 1)

    for top in sorted((n for n in tree.rows if tree.parent[n] is None), key=key):
        walk(top, 0)
    return out


def _implementing(db: Session, items: Iterable[PolicyException]) -> Set[int]:
    """The ids of the exceptions whose implementation is open (a waiting or an in-progress one)."""
    ids = [e.id for e in items if e.status == "approved"]
    if not ids:
        return set()
    from ...models import ExceptionApprovalRun

    return {eid for (eid,) in db.query(ExceptionApprovalRun.exception_id).filter(
        ExceptionApprovalRun.exception_id.in_(ids), ExceptionApprovalRun.implementation_state.in_(A.OPEN_IMPLEMENTATION))}


def _groups(items: Sequence[PolicyException], docs: Dict[int, Any], tree: org_departments.Tree):
    """exception -> (the unit it is raised for), grouped: ``own`` (unit -> exceptions raised for it) and ``none`` (for no unit)."""
    own: Dict[int, List[PolicyException]] = {}
    none: List[PolicyException] = []
    for e in items:
        unit = unit_of(e, docs, tree)
        (own.setdefault(unit, []) if unit is not None else none).append(e)
    return own, none


def by_unit(db: Session, user: GRCUser) -> Dict[str, Any]:
    """The tree of units that have exceptions, each with the counts of its unit and everything under it."""
    items, docs = load(db, user)
    now = datetime.utcnow()
    implementing = _implementing(db, items)
    units: List[Dict[str, Any]] = []
    trees: Dict[int, org_departments.Tree] = {}
    for tenant in sorted({e.tenant_id for e in items}):
        tree = trees[tenant] = org_departments.Tree.load(db, tenant)
        mine = [e for e in items if e.tenant_id == tenant]
        own, none = _groups(mine, docs, tree)
        labels = org_departments.level_labels(db, tenant)
        for node, depth in _order(tree):
            below = tree.subtree(node)
            rolled = [e for u in below for e in own.get(u, [])]
            if not rolled:
                continue
            row = tree.rows[node]
            level = tree.level(node)
            units.append({"department_id": node, "name": row.name, "path": [d.name for d in tree.path(node)], "level": level,
                          "level_label": labels[min(level, org_departments.MAX_DEPTH) - 1], "depth": depth, "is_active": row.is_active is not False,
                          "own": len(own.get(node, [])), "counts": counts(rolled, implementing, now)})
    none_items = [e for tenant, tree in trees.items() for e in _groups([x for x in items if x.tenant_id == tenant], docs, tree)[1]]
    return {"units": units, "no_unit": {"own": len(none_items), "counts": counts(none_items, implementing, now)}, "totals": counts(items, implementing, now)}


def _exception_row(e: PolicyException, waiting: Dict[int, str], labels: Dict[str, str]) -> Dict[str, Any]:
    return {"id": e.id, "title": e.title, "status": e.status, "priority": e.priority,
            "expiry_date": e.expiry_date.isoformat() if e.expiry_date else None,
            "exception_type_label": labels.get(e.exception_type or "") if e.exception_type else None, "waiting_kind": waiting.get(e.id)}


def _documents(db: Session, user: GRCUser, group: Sequence[PolicyException], docs: Dict[int, Any], readable: Set[int], implementing: Set[int],
               waiting: Dict[int, str], labels: Dict[str, str], now: datetime) -> List[Dict[str, Any]]:
    """The documents the given exceptions are about (one entry each, the ones with no document last), each with its exceptions."""
    by_doc: Dict[Optional[int], List[PolicyException]] = {}
    for e in group:
        by_doc.setdefault(e.document_id if e.document_id in docs else None, []).append(e)
    out = []
    for doc_id, members in sorted(by_doc.items(), key=lambda kv: (kv[0] is None, (docs[kv[0]].title or "").casefold() if kv[0] else "", kv[0] or 0)):
        d = docs.get(doc_id)
        may_read = doc_id in readable
        out.append({"document_id": doc_id if may_read else None, "title": d.title if d is not None and may_read else None,
                    "doc_type": d.doc_type if d is not None else None, "code": d.document_code if d is not None and may_read else None,
                    "counts": counts(members, implementing, now), "exceptions": [_exception_row(e, waiting, labels) for e in members]})
    return out


def by_document(db: Session, user: GRCUser) -> Dict[str, Any]:
    """The units that have exceptions raised for them (as ``by_unit`` rolls them up) with, under each, the documents that have exceptions
    raised for that unit itself and the exceptions under each document; exceptions raised for no unit are in ``no_unit``."""
    from . import exception_types

    items, docs = load(db, user)
    now = datetime.utcnow()
    implementing = _implementing(db, items)
    readable = set(readable_among(db, user, [d for d in docs]))
    waiting = {e.id: "decision" for e in A.waiting_for(db, user.id, _tenants(db, user))}
    waiting.update({e.id: "implementation" for e in A.to_implement_for(db, user.id, _tenants(db, user))})
    units: List[Dict[str, Any]] = []
    no_unit: List[Dict[str, Any]] = []
    for tenant in sorted({e.tenant_id for e in items}):
        tree = org_departments.Tree.load(db, tenant)
        labels = exception_types.labels(db, tenant)
        mine = [e for e in items if e.tenant_id == tenant]
        own, none = _groups(mine, docs, tree)
        for node, depth in _order(tree):
            rolled = [e for u in tree.subtree(node) for e in own.get(u, [])]
            if not rolled:
                continue
            row = tree.rows[node]
            units.append({"department_id": node, "name": row.name, "path": [d.name for d in tree.path(node)], "depth": depth,
                          "is_active": row.is_active is not False, "counts": counts(rolled, implementing, now),
                          "documents": _documents(db, user, own.get(node, []), docs, readable, implementing, waiting, labels, now)})
        no_unit += _documents(db, user, none, docs, readable, implementing, waiting, labels, now)
    return {"units": units, "no_unit": no_unit, "total": len(items)}


def filter_by_unit(db: Session, user: GRCUser, items: Sequence[PolicyException], unit_id: int) -> List[PolicyException]:
    """The exceptions of ``items`` raised for the unit or for any unit under it (its own, else its document's)."""
    if not items:
        return []
    _, docs = load_docs_for(db, items)
    out: List[PolicyException] = []
    trees: Dict[int, org_departments.Tree] = {}
    for e in items:
        tree = trees.get(e.tenant_id) or trees.setdefault(e.tenant_id, org_departments.Tree.load(db, e.tenant_id))
        if unit_id in tree.rows and unit_of(e, docs, tree) in tree.subtree(unit_id):
            out.append(e)
    return out


def load_docs_for(db: Session, items: Sequence[PolicyException]):
    doc_ids = {e.document_id for e in items if e.document_id}
    docs = {d.id: d for d in db.query(GovernanceDocument.id, GovernanceDocument.title, GovernanceDocument.doc_type, GovernanceDocument.document_code,
                                      GovernanceDocument.department_id).filter(GovernanceDocument.id.in_(doc_ids))} if doc_ids else {}
    return items, docs
