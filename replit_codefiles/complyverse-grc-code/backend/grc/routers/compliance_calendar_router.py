from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, extract

from ..models import ComplianceCalendarEvent, GRCUser, Tenant, get_db
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/compliance-calendar", tags=["Compliance Calendar"])


@router.get("/events")
def list_events(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    framework_id: Optional[int] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.tenant_id.in_(user_tenants)
    )

    if date_from:
        query = query.filter(ComplianceCalendarEvent.due_date >= datetime.fromisoformat(date_from))
    if date_to:
        query = query.filter(ComplianceCalendarEvent.due_date <= datetime.fromisoformat(date_to))
    if event_type:
        query = query.filter(ComplianceCalendarEvent.event_type == event_type)
    if status_filter:
        query = query.filter(ComplianceCalendarEvent.status == status_filter)
    if framework_id:
        query = query.filter(
            ComplianceCalendarEvent.related_entity_type == "framework",
            ComplianceCalendarEvent.related_entity_id == framework_id
        )

    events = query.order_by(ComplianceCalendarEvent.due_date.asc()).offset(skip).limit(limit).all()
    return [_event_to_dict(e) for e in events]


@router.post("/events", status_code=status.HTTP_201_CREATED)
def create_event(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant")

    event = ComplianceCalendarEvent(
        tenant_id=tenant_id,
        title=data.get("title"),
        description=data.get("description"),
        event_type=data.get("event_type", "custom"),
        related_entity_type=data.get("related_entity_type"),
        related_entity_id=data.get("related_entity_id"),
        due_date=datetime.fromisoformat(data["due_date"]) if data.get("due_date") else datetime.utcnow(),
        reminder_date=datetime.fromisoformat(data["reminder_date"]) if data.get("reminder_date") else None,
        status=data.get("status", "upcoming"),
        priority=data.get("priority", "medium"),
        assigned_to=data.get("assigned_to"),
        created_by=current_user.id,
        recurrence_type=data.get("recurrence_type", "none"),
        recurrence_end_date=datetime.fromisoformat(data["recurrence_end_date"]) if data.get("recurrence_end_date") else None,
        metadata_=data.get("metadata", {})
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_to_dict(event)


@router.put("/events/{event_id}")
def update_event(
    event_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    event = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.id == event_id,
        ComplianceCalendarEvent.tenant_id.in_(user_tenants)
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    updatable = ["title", "description", "event_type", "related_entity_type", "related_entity_id",
                 "status", "priority", "assigned_to", "recurrence_type", "metadata"]
    for field in updatable:
        if field in data:
            if field == "metadata":
                event.metadata_ = data[field]
            else:
                setattr(event, field, data[field])

    for date_field in ["due_date", "reminder_date", "recurrence_end_date"]:
        if date_field in data:
            setattr(event, date_field, datetime.fromisoformat(data[date_field]) if data[date_field] else None)

    event.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return _event_to_dict(event)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    event = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.id == event_id,
        ComplianceCalendarEvent.tenant_id.in_(user_tenants)
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    db.delete(event)
    db.commit()
    return None


@router.get("/upcoming")
def get_upcoming_events(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    now = datetime.utcnow()
    upcoming_end = now + timedelta(days=30)

    events = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.tenant_id.in_(user_tenants),
        ComplianceCalendarEvent.due_date >= now,
        ComplianceCalendarEvent.due_date <= upcoming_end,
        ComplianceCalendarEvent.status != "completed"
    ).order_by(ComplianceCalendarEvent.due_date.asc()).all()
    return [_event_to_dict(e) for e in events]


@router.get("/overdue")
def get_overdue_events(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    now = datetime.utcnow()
    events = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.tenant_id.in_(user_tenants),
        ComplianceCalendarEvent.due_date < now,
        ComplianceCalendarEvent.status != "completed"
    ).order_by(ComplianceCalendarEvent.due_date.asc()).all()
    return [_event_to_dict(e) for e in events]


@router.post("/events/{event_id}/complete")
def complete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    event = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.id == event_id,
        ComplianceCalendarEvent.tenant_id.in_(user_tenants)
    ).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    event.status = "completed"
    event.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(event)
    return _event_to_dict(event)


@router.get("/summary")
def get_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"total": 0, "by_type": {}, "by_status": {}, "by_priority": {}}

    events = db.query(ComplianceCalendarEvent).filter(
        ComplianceCalendarEvent.tenant_id.in_(user_tenants)
    ).all()

    by_type = {}
    by_status = {}
    by_priority = {}
    for e in events:
        by_type[e.event_type] = by_type.get(e.event_type, 0) + 1
        by_status[e.status] = by_status.get(e.status, 0) + 1
        by_priority[e.priority] = by_priority.get(e.priority, 0) + 1

    return {
        "total": len(events),
        "by_type": by_type,
        "by_status": by_status,
        "by_priority": by_priority
    }


def _event_to_dict(event: ComplianceCalendarEvent) -> dict:
    return {
        "id": event.id,
        "tenant_id": event.tenant_id,
        "title": event.title,
        "description": event.description,
        "event_type": event.event_type,
        "related_entity_type": event.related_entity_type,
        "related_entity_id": event.related_entity_id,
        "due_date": event.due_date.isoformat() if event.due_date else None,
        "reminder_date": event.reminder_date.isoformat() if event.reminder_date else None,
        "status": event.status,
        "priority": event.priority,
        "assigned_to": event.assigned_to,
        "created_by": event.created_by,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        "recurrence_type": event.recurrence_type,
        "recurrence_end_date": event.recurrence_end_date.isoformat() if event.recurrence_end_date else None,
        "metadata": event.metadata_
    }
