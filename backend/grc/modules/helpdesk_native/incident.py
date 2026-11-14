"""Incidents — process-scoped view over the shared ticket engine (spec §5).

Thin: an incident is just an HDTicket with process='incident'. The list reuses
Agent A's `list_tickets(..., process=...)` filter; create/update/reply all go
through the existing ticket routes (process defaults to 'incident'), so this
module only adds the process-filtered list.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...models import get_db
from . import tickets  # Agent A's write path; attrs resolve at call time
from .common import require_processes_view, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


@router.get("/incidents")
def list_incidents(db: Session = Depends(get_db), _: bool = Depends(require_processes_view)):
    return tickets.list_tickets(db, tenant_id(db), process="incident")
