"""Governance > Documents > Tracker: what each document waits for, read for many documents at once (the library's Tracker layout).

GET /governance/document-tracker/sets         the ids of the documents the person may read that are stuck, on hold, late, waiting more than a week, sent back for
                                              changes or waiting for a proposed change to be accepted (ids only: the Tracker sorts a whole library into groups)
GET /governance/document-tracker/lines?ids=   for up to ``MAX_IDS`` documents (the page the Tracker shows): the stage a document in review or
                                              approval is at, who it waits for and since when, the hold it is in, the changes proposed to it, its versions

Nothing here decides anything: every definition is ``documents_overview``'s (stuck, on hold, late approvals, late acknowledgements) and every
person named is one of the requests the document itself holds (``DocumentObligation``, ``DocumentRouteHold``, ``DocumentChangeProposal``). Only
documents the person may read (``permissions.visible_filter``, the library's own rule) are counted or answered: an id they may not read is left
out, never refused one by one. A fixed number of queries however many documents there are. Nothing writes.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ....models import (DocumentChangeProposal, DocumentObligation, DocumentRouteHold, DocumentRouteStage, GovernanceDocument,
                        GovernanceDocumentVersion, GRCUser, get_db)
from ....routers.auth_router import get_user_primary_tenant, get_user_tenants, require_auth
from .. import doc_lifecycle, documents_overview as overview, permissions, routes

router = APIRouter(prefix="/document-tracker", tags=["Governance Document Tracker"])

MAX_IDS = 100                       # the most documents one ``lines`` request answers
NAMES = 2                           # people named on one line (the rest are counted)
SIGN_OFF = overview.SIGN_OFF        # review, approval
ASKED = ("changes", "decide", "revise")     # the other requests a hold or a proposed change makes of someone
WEEK = timedelta(days=7)                    # "waiting more than a week": the oldest review or approval request of a document in review or approval


def _iso(value) -> Optional[str]:
    return value.isoformat() if value else None


def _tenants(db: Session, user: GRCUser) -> List[int]:
    tenants = get_user_tenants(user, db)
    if not tenants:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    return tenants


def _conds(db: Session, user: GRCUser, tenants: List[int], ids: Optional[List[int]] = None) -> list:
    """The documents the person may read (all of them, or those among ``ids``) as conditions on GovernanceDocument."""
    G = GovernanceDocument
    conds: list = [G.tenant_id.in_(tenants)]
    visible = permissions.visible_filter(db, user)
    if visible is not None:
        conds.append(visible)
    if ids is not None:
        conds.append(G.id.in_(ids))
    return conds


def _documents(db: Session, conds: list) -> list:
    G = GovernanceDocument
    return (db.query(G.id, G.status, G.owner_id, G.author_id, G.route_stage, G.signoff_round_at, G.current_version, G.published_version)
            .filter(*conds).order_by(G.id).all())


def _requests(db: Session, tenants: List[int], conds: list, now: datetime) -> list:
    """The pending requests of the documents in the shape ``documents_overview._attention`` reads. A request to acknowledge is read only
    when it is overdue, since that is all the definitions use of one (a whole library holds one for every person it was asked of)."""
    O = DocumentObligation
    population = select(GovernanceDocument.id).where(*conds)
    return (db.query(O.document_id, O.kind, O.user_id, O.stage_position, O.due_date, O.requested_at)
            .filter(O.tenant_id.in_(tenants), O.status == "pending", O.document_id.in_(population),
                    or_(O.kind.in_(SIGN_OFF), and_(O.kind == "acknowledgement", O.due_date < now))).order_by(O.id).all())


def _hold_rows(db: Session, tenants: List[int], conds: list) -> list:
    H = DocumentRouteHold
    population = select(GovernanceDocument.id).where(*conds)
    return (db.query(H.document_id, H.round_at, H.kind, H.requested_by, H.requested_at, H.stage_position)
            .filter(H.tenant_id.in_(tenants), H.resolved_at.is_(None), H.document_id.in_(population)).order_by(H.id).all())


def _attention(db: Session, user: GRCUser, docs: list, requests: list, holds: list, now: datetime) -> Dict[str, Set[int]]:
    """``documents_overview``'s own definitions of stuck, on hold, late approvals and late acknowledgements, for these documents."""
    data = overview.Loaded(docs, requests, [(h.document_id, h.round_at) for h in holds], [])
    return overview._attention(data, now, doc_lifecycle.settings(db, get_user_primary_tenant(user, db))["admin_after_days"])


def _held(docs: list, holds: list) -> Dict[int, Any]:
    """document id -> its open hold of this round (the newest), as ``routes.open_hold``: a document in review or approval, the round it was asked in."""
    live = {d.id: d for d in docs if d.status in routes.PENDING}
    out: Dict[int, Any] = {}
    for h in holds:
        d = live.get(h.document_id)
        if d is not None and (h.round_at == d.signoff_round_at if d.signoff_round_at else h.round_at is None):
            out[d.id] = h
    return out


def _ids(text: Optional[str]) -> List[int]:
    out: List[int] = []
    for part in (text or "").split(","):
        part = part.strip()
        if not part:
            continue
        if not (part.isascii() and part.isdigit()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ids must be document numbers separated by commas.")
        if int(part) not in out:
            out.append(int(part))
    if len(out) > MAX_IDS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Ask for at most {MAX_IDS} documents at a time.")
    return out


# ── the sets ─────────────────────────────────────────────────────────────────
def sets(db: Session, user: GRCUser, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Which documents the person may read are stuck, on hold, late (approvals, acknowledgements), sent back for changes or have a proposed
    change waiting. Archived documents are in none of them (as in the Documents Overview)."""
    now = now or datetime.utcnow()
    tenants = _tenants(db, user)
    conds = _conds(db, user, tenants)
    docs = _documents(db, conds)
    holds = _hold_rows(db, tenants, conds)
    requests = _requests(db, tenants, conds, now)
    flags = _attention(db, user, docs, requests, holds, now)
    live = {d.id for d in docs if d.status != "archived"}
    pending = {d.id for d in docs if d.status in routes.PENDING}
    asked: Dict[int, datetime] = {}
    for r in requests:
        if r.kind in SIGN_OFF and r.document_id in pending and r.requested_at is not None:
            asked[r.document_id] = min(asked.get(r.document_id, r.requested_at), r.requested_at)
    held = _held(docs, holds)
    P = DocumentChangeProposal
    waiting = {i for (i,) in db.query(P.document_id).filter(P.tenant_id.in_(tenants), P.status == "pending",
                                                             P.document_id.in_(select(GovernanceDocument.id).where(*conds)))} & live
    return {"as_of": now.isoformat(), **{k: sorted(v) for k, v in flags.items()},
            "changes_requested": sorted(i for i, h in held.items() if i in live and (h.kind or "changes") != "proposal"),
            "proposals_waiting": sorted(waiting), "waiting_week": sorted(i for i, at in asked.items() if at < now - WEEK)}


# ── the lines ────────────────────────────────────────────────────────────────
def _people(names: Dict[int, str], user_ids: List[int]) -> Dict[str, Any]:
    """The first ``NAMES`` people (in the order they were asked) and how many more."""
    ordered = list(dict.fromkeys(user_ids))
    return {"names": [names.get(u) or "Someone" for u in ordered[:NAMES]], "more": max(0, len(ordered) - NAMES)}


def lines(db: Session, user: GRCUser, ids: List[int], now: Optional[datetime] = None) -> Dict[str, Any]:
    """The Tracker's compact lines for ``ids`` (those the person may read, in the order asked); see the module docstring."""
    now = now or datetime.utcnow()
    tenants = _tenants(db, user)
    conds = _conds(db, user, tenants, ids)
    docs = _documents(db, conds)
    if not docs:
        return {"as_of": now.isoformat(), "items": []}
    asked = [d.id for d in docs]
    holds = _hold_rows(db, tenants, conds)
    flags = _attention(db, user, docs, _requests(db, tenants, conds, now), holds, now)
    held = _held(docs, holds)
    O, P, V, S = DocumentObligation, DocumentChangeProposal, GovernanceDocumentVersion, DocumentRouteStage

    # what each person is asked to do on these documents now (a request waiting while the route is held is `held`: not read here)
    obligations: Dict[int, list] = defaultdict(list)
    for o in (db.query(O.document_id, O.kind, O.user_id, O.stage_position, O.due_date, O.requested_at, O.proposal_id)
              .filter(O.tenant_id.in_(tenants), O.status == "pending", O.kind.in_(SIGN_OFF + ASKED), O.document_id.in_(asked)).order_by(O.id)):
        obligations[o.document_id].append(o)
    proposals: Dict[int, list] = defaultdict(list)
    for p in (db.query(P.document_id, P.proposed_by, P.proposed_at, P.kind).filter(P.tenant_id.in_(tenants), P.status == "pending", P.document_id.in_(asked))
              .order_by(P.id)):
        proposals[p.document_id].append(p)
    stage_rows: Dict[int, list] = defaultdict(list)
    for s in db.query(S.document_id, S.position, S.name, S.kind).filter(S.tenant_id.in_(tenants), S.document_id.in_(asked)).order_by(S.document_id, S.position, S.id):
        stage_rows[s.document_id].append((s.position, s.name, s.kind))
    numbers: Dict[int, list] = defaultdict(list)                  # each document's version numbers, oldest first (a sign-off stamp repeats one)
    for v in (db.query(V.document_id, V.version_number).filter(V.document_id.in_(asked), func.coalesce(V.change_type, "") != "signoff",
                                                               func.coalesce(V.status, "") != "reverted").order_by(V.id)):
        if v.version_number not in numbers[v.document_id]:
            numbers[v.document_id].append(v.version_number)

    people = {o.user_id for rows in obligations.values() for o in rows} | {p.proposed_by for rows in proposals.values() for p in rows}
    people |= {h.requested_by for h in held.values()} | {d.owner_id for d in docs} | {d.author_id for d in docs}
    names = doc_lifecycle._names(db, {u for u in people if u})
    by_id = {d.id: d for d in docs}
    items: List[Dict[str, Any]] = []
    for i in ids:
        d = by_id.get(i)
        if d is None:
            continue
        mine = obligations.get(i, [])
        item: Dict[str, Any] = {"id": i, "stage": None, "waiting": None, "hold": None, "asked": None, "proposals": None, "versions": None,
                                "flags": [k for k in overview.KINDS if i in flags[k]]}
        if d.status in routes.PENDING:
            name, kind = overview._stage_at(d, stage_rows)
            item["stage"] = {"name": name, "kind": kind}
            waiting = [o for o in mine if o.kind in SIGN_OFF]
            if waiting:
                due = [o.due_date for o in waiting if o.due_date]
                item["waiting"] = {"kind": waiting[0].kind, **_people(names, [o.user_id for o in waiting]), "count": len({o.user_id for o in waiting}),
                                   "since": _iso(min(o.requested_at for o in waiting)), "overdue": sum(1 for t in due if t < now),
                                   "next_due": _iso(min(due)) if due else None}
        h = held.get(i)
        if h is not None:
            own = stage_rows.get(i)
            at = next((n for p, n, _k in own if p == h.stage_position), None) if own else next((s.name for s in routes.DEFAULT_ROUTE if s.position == h.stage_position), None)
            item["hold"] = {"kind": h.kind or "changes", "by": names.get(h.requested_by), "since": _iso(h.requested_at), "stage": at}
        todo = [o for o in mine if o.kind in ASKED]
        if todo:         # the author asked to make the changes, the owner to accept or reject a proposed change, its proposer to revise it
            item["asked"] = {"kind": todo[0].kind, **_people(names, [o.user_id for o in todo]), "since": _iso(min(o.requested_at for o in todo))}
        pending = proposals.get(i, [])
        if pending:
            item["proposals"] = {"count": len(pending), "since": _iso(min(p.proposed_at for p in pending)), **_people(names, [p.proposed_by for p in pending])}
        seen = numbers.get(i, [])
        now_in_force = permissions.in_force_number(d)
        before = seen[seen.index(now_in_force) - 1] if now_in_force in seen and seen.index(now_in_force) > 0 else None
        item["versions"] = {"count": len(seen), "previous": before}
        items.append(item)
    return {"as_of": now.isoformat(), "items": items}


@router.get("/sets")
def get_sets(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    return sets(db, current_user)


@router.get("/lines")
def get_lines(ids: str = Query(..., description="document numbers separated by commas, at most 100"), db: Session = Depends(get_db),
              current_user: GRCUser = Depends(require_auth)):
    return lines(db, current_user, _ids(ids))
