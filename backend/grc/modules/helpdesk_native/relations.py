"""ITIL cross-process relationship resolver (Batch 4 linkage A) — read side.

Surfaces the cross-process links the ticket columns already store, reverse-
resolved so every process sees its counterparts without the caller joining:

  * incident → the problem(s) that reference it (reverse of
    problem.linked_incident_ids) + any change raised from it
  * problem  → its linked incidents (its own linked_incident_ids) + the
    change(s) raised to resolve it
  * change   → its originating incident/problem (origin_ticket_id/origin_process)

Pure read, tenant-scoped (the tenant filter is the isolation guard; a value that
points at another tenant's ticket resolves to nothing). No write path here, so it
imports no sibling module and cannot create an import cycle; the write endpoints
live in problem.py (incident↔problem, pre-existing) and change.py (origin).
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy.orm import Session

from ...models import HDTicket
from .common import iso


def _ref(t: HDTicket) -> dict:
    """The compact ticket object a related-block entry carries — enough for the UI
    to render a link to /helpdesk/tickets/{name} with its process + status."""
    return {
        "name": str(t.id),
        "subject": t.subject,
        "process": t.process or "incident",
        "status": t.status.label_agent if t.status else None,
    }


def _linked_ids(raw) -> list:
    """Parse a linked_incident_ids JSON array string → list[int]; tolerate
    null/garbage (never raise on a corrupt value)."""
    try:
        v = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    out = []
    for x in v if isinstance(v, list) else []:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def _by_ids(db: Session, tid: int, ids: list) -> list:
    if not ids:
        return []
    rows = (
        db.query(HDTicket)
        .filter(HDTicket.tenant_id == tid, HDTicket.id.in_(list(set(ids))))
        .order_by(HDTicket.id.asc())
        .all()
    )
    return [_ref(r) for r in rows]


def _changes_from(db: Session, tid: int, ticket: HDTicket) -> list:
    """Changes raised FROM this incident/problem (reverse of origin_ticket_id)."""
    proc = ticket.process or "incident"
    rows = (
        db.query(HDTicket)
        .filter(HDTicket.tenant_id == tid, HDTicket.process == "change",
                HDTicket.origin_ticket_id == ticket.id,
                HDTicket.origin_process == proc)
        .order_by(HDTicket.id.asc())
        .all()
    )
    return [_ref(r) for r in rows]


def _problems_referencing(db: Session, tid: int, incident_id: int) -> list:
    """Problems whose linked_incident_ids contains this incident id (the reverse
    surfacing an incident previously lacked). Scans only problems that have a
    non-null linked_incident_ids — a small set per tenant — and tests membership
    in Python so it is JSON-store agnostic (SQLite + Postgres TEXT alike)."""
    out = []
    rows = (
        db.query(HDTicket)
        .filter(HDTicket.tenant_id == tid, HDTicket.process == "problem",
                HDTicket.linked_incident_ids.isnot(None))
        .order_by(HDTicket.id.asc())
        .all()
    )
    for p in rows:
        if incident_id in _linked_ids(p.linked_incident_ids):
            out.append(_ref(p))
    return out


def related_block(db: Session, tid: int, ticket: HDTicket) -> dict:
    """The `related` block for a ticket detail: incidents / problems / changes /
    origin, each a list (origin is a single object or null). Only the fields that
    make sense for the ticket's process are populated; the rest stay empty."""
    proc = ticket.process or "incident"
    incidents: list = []
    problems: list = []
    changes: list = []
    origin: Optional[dict] = None

    if proc == "problem":
        incidents = _by_ids(db, tid, _linked_ids(ticket.linked_incident_ids))
        changes = _changes_from(db, tid, ticket)
    elif proc == "incident":
        problems = _problems_referencing(db, tid, ticket.id)
        changes = _changes_from(db, tid, ticket)
    elif proc == "change":
        if ticket.origin_ticket_id:
            row = (
                db.query(HDTicket)
                .filter(HDTicket.id == ticket.origin_ticket_id,
                        HDTicket.tenant_id == tid)
                .first()
            )
            if row is not None:
                origin = _ref(row)

    return {
        "related": {
            "incidents": incidents,
            "problems": problems,
            "changes": changes,
            "origin": origin,
        }
    }
