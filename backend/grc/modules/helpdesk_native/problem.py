"""Problems — process actions over the shared ticket engine (spec §5).

A problem is an HDTicket with process='problem'. Beyond the process-scoped list
it owns: linking/unlinking incidents (a JSON id array on the problem ticket),
the known-error toggle, and editing root_cause/workaround/problem_resolution.
Every write routes through Agent A's `update_ticket` (which serializes a
linked_incident_ids list → JSON string and coerces known_error → bool); the
array is read here to mutate it idempotently. Missing/cross-tenant ids follow
the ticket write path's soft-error convention ({"ok": False, "error": ...}).
"""
from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDTicket, get_db
from ...routers.auth_router import require_auth
from . import tickets  # Agent A's write path; attrs resolve at call time
from .audit import hd_audit
from .common import require_processes_manage, require_processes_view, tenant_id

router = APIRouter(prefix="/helpdesk/problems", tags=["Help Desk (native)"])


def _get_problem(db: Session, tid: int, pid: int) -> Optional[HDTicket]:
    """Tenant-scoped fetch (the tenant filter is the isolation guard; a
    cross-tenant id yields no row). Mirrors tickets._get_ticket."""
    return (
        db.query(HDTicket)
        .filter(HDTicket.id == pid, HDTicket.tenant_id == tid)
        .first()
    )


def _linked_ids(ticket: HDTicket) -> list:
    """Parse linked_incident_ids (JSON array string) → list[int]; tolerate
    null/garbage so a corrupt value never 500s the link action."""
    try:
        v = json.loads(ticket.linked_incident_ids or "[]")
    except (ValueError, TypeError):
        return []
    return [int(x) for x in v] if isinstance(v, list) else []


class IncidentLink(BaseModel):
    incident_id: int


class KnownError(BaseModel):
    known_error: bool


class ProblemUpdate(BaseModel):
    root_cause: Optional[str] = None
    workaround: Optional[str] = None
    problem_resolution: Optional[str] = None


@router.get("")
def list_problems(db: Session = Depends(get_db), _: bool = Depends(require_processes_view)):
    return tickets.list_tickets(db, tenant_id(db), process="problem")


@router.post("/{pid}/link-incident")
def link_incident(pid: int, body: IncidentLink, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    tid = tenant_id(db)
    ticket = _get_problem(db, tid, pid)
    if not ticket:
        return {"ok": False, "error": "not found"}
    ids = _linked_ids(ticket)
    if body.incident_id not in ids:          # idempotent
        ids.append(body.incident_id)
    r = tickets.update_ticket(db, tid, pid, {"linked_incident_ids": ids})
    if r.get("ok"):
        hd_audit(db, tenant_id=tid, actor_email=current_user.email,
                 action="problem.link_incident", entity="problem", entity_id=pid,
                 after={"incident_id": body.incident_id, "linked_count": len(ids)})
    return r


@router.post("/{pid}/unlink-incident")
def unlink_incident(pid: int, body: IncidentLink, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth),
                    _: bool = Depends(require_processes_manage)):
    tid = tenant_id(db)
    ticket = _get_problem(db, tid, pid)
    if not ticket:
        return {"ok": False, "error": "not found"}
    ids = [i for i in _linked_ids(ticket) if i != body.incident_id]   # idempotent
    r = tickets.update_ticket(db, tid, pid, {"linked_incident_ids": ids})
    if r.get("ok"):
        hd_audit(db, tenant_id=tid, actor_email=current_user.email,
                 action="problem.unlink_incident", entity="problem", entity_id=pid,
                 after={"incident_id": body.incident_id, "linked_count": len(ids)})
    return r


@router.post("/{pid}/known-error")
def set_known_error(pid: int, body: KnownError, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth),
                    _: bool = Depends(require_processes_manage)):
    # update_ticket soft-errors on a missing/cross-tenant id, so no separate fetch.
    tid = tenant_id(db)
    r = tickets.update_ticket(db, tid, pid, {"known_error": body.known_error})
    if r.get("ok"):
        hd_audit(db, tenant_id=tid, actor_email=current_user.email,
                 action="problem.known_error", entity="problem", entity_id=pid,
                 after={"known_error": body.known_error})
    return r


@router.put("/{pid}")
def update_problem(pid: int, body: ProblemUpdate, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth),
                   _: bool = Depends(require_processes_manage)):
    tid = tenant_id(db)
    payload = body.model_dump(exclude_unset=True)
    r = tickets.update_ticket(db, tid, pid, payload)
    if r.get("ok"):
        # root_cause/workaround/problem_resolution are free-text → log field NAMES only.
        hd_audit(db, tenant_id=tid, actor_email=current_user.email,
                 action="problem.update", entity="problem", entity_id=pid,
                 after={"fields_set": sorted(payload.keys())})
    return r
