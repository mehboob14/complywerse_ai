"""Per-advisory history/session timeline.

Records a short, human-readable event at each lifecycle step (ingested →
confirmed → bridged → rechecked → status change) so every advisory carries an
auditable record of its journey, with actor + timestamp. ``record_event`` is
called inside the same DB transaction as the step it describes; ``history_for``
reads an advisory's events for the detail page.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from .models import AdvisoryEvent


def record_event(db: Session, *, tenant_id: int, advisory_id: int, event: str,
                 detail: Optional[Dict[str, Any]] = None, actor: Any = None) -> AdvisoryEvent:
    """Append one event. ``actor`` is a GRCUser (or None for automated steps);
    its name is denormalised so the timeline renders without a user join."""
    actor_id = getattr(actor, "id", None) if actor is not None else None
    actor_name = None
    if actor is not None:
        actor_name = getattr(actor, "username", None) or getattr(actor, "email", None)
    ev = AdvisoryEvent(
        tenant_id=tenant_id, advisory_id=advisory_id, event=event,
        detail=detail or {}, actor_id=actor_id, actor_name=actor_name,
    )
    db.add(ev)
    return ev


def _serialize(ev: AdvisoryEvent) -> Dict[str, Any]:
    return {
        "id": ev.id,
        "event": ev.event,
        "detail": ev.detail or {},
        "actor": ev.actor_name,
        "at": ev.at.isoformat() if ev.at else None,
    }


def history_for(db: Session, tenant_id: int, advisory_id: int) -> List[Dict[str, Any]]:
    events = (
        db.query(AdvisoryEvent)
        .filter(AdvisoryEvent.tenant_id == tenant_id, AdvisoryEvent.advisory_id == advisory_id)
        .order_by(AdvisoryEvent.at.asc(), AdvisoryEvent.id.asc())
        .all()
    )
    return [_serialize(e) for e in events]
