"""/report-schedules - scheduled & emailed reports.

GET    /report-schedules            the caller's schedules (administrators: the whole workspace)
                                    + {email: {configured, source, from_email}, frequencies, formats, max_recipients}
POST   /report-schedules            create                              -> the schedule
GET    /report-schedules/{id}       one schedule
PUT    /report-schedules/{id}       edit (only the keys sent change; pause = {"active": false})
DELETE /report-schedules/{id}       remove
POST   /report-schedules/{id}/run   generate + email it right now       -> {ok, status, message, filename,
                                    size_bytes, rows, recipients, refused, schedule}

A schedule's source is EITHER a saved Report Builder definition (`saved_report_slug`,
resolved fresh on every run) OR an inline `dataset` + `columns` + `filters` + `logic`.
Runs (manual or timed) execute with the permissions of the schedule's creator.

Timed firing is driven from outside HTTP: see tasks.py (Celery beat fan-out).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from grc.models import GRCUser, get_db
from grc.routers.auth_router import get_user_primary_tenant, require_auth

from . import mailer, service

router = APIRouter(prefix="/report-schedules", tags=["Report Schedules"])


def _tenant(current_user: GRCUser, db: Session) -> int:
    tid = get_user_primary_tenant(current_user, db)
    if not tid:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant.")
    return tid


def _actor(current_user: GRCUser) -> Optional[str]:
    return getattr(current_user, "display_name", None) or getattr(current_user, "email", None)


def _http(exc: service.ScheduleError) -> HTTPException:
    code = 403 if isinstance(exc, service.ScheduleForbidden) else 400
    return HTTPException(status_code=code, detail=str(exc))


def _owned(db: Session, current_user: GRCUser, schedule_id: int):
    """The schedule, if it exists AND the caller owns it (or is an administrator).
    Someone else's schedule answers 404, not 403, so ids can't be probed."""
    row = service.get_schedule(db, schedule_id)
    if row is None or not service.can_manage(db, current_user, row):
        raise HTTPException(status_code=404, detail="Schedule not found.")
    return row


class FilterBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    col: str
    op: str
    value: Optional[Any] = None


class ScheduleBody(BaseModel):
    """Every field optional: create requires name + recipients + a source (the service
    says what is missing in plain words); update changes only the keys that were sent."""
    model_config = ConfigDict(extra="ignore")

    name: Optional[str] = None
    saved_report_slug: Optional[str] = None
    dataset: Optional[str] = None
    columns: Optional[List[str]] = None
    filters: Optional[List[FilterBody]] = None
    logic: Optional[str] = None
    frequency: Optional[str] = None          # daily | weekly | monthly
    recipients: Optional[Any] = None         # ["a@b.com", ...] or a comma/space separated string
    format: Optional[str] = None             # csv | xlsx | pdf
    message: Optional[str] = None
    start_at: Optional[datetime] = None      # first run / anchor (ISO-8601; naive = UTC)
    active: Optional[bool] = None


@router.get("")
def list_schedules(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    rows = service.list_schedules(db, current_user)
    return {
        "schedules": service.serialize(db, rows, current_user.id),
        "email": mailer.email_status(db, tid),
        "frequencies": list(service.FREQUENCIES),
        "formats": list(service.FORMATS),
        "max_recipients": service.MAX_RECIPIENTS,
    }


@router.post("")
def create_schedule(body: ScheduleBody, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    tid = _tenant(current_user, db)
    try:
        row = service.create_schedule(db, current_user, tid, body.model_dump(exclude_unset=True))
    except service.ScheduleError as exc:
        db.rollback()
        raise _http(exc)
    return service.serialize(db, [row], current_user.id)[0]


@router.get("/{schedule_id}")
def get_schedule(schedule_id: int, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth)):
    row = _owned(db, current_user, schedule_id)
    return service.serialize(db, [row], current_user.id)[0]


@router.put("/{schedule_id}")
def update_schedule(schedule_id: int, body: ScheduleBody, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    row = _owned(db, current_user, schedule_id)
    try:
        row = service.update_schedule(db, current_user, row, body.model_dump(exclude_unset=True))
    except service.ScheduleError as exc:
        db.rollback()
        raise _http(exc)
    return service.serialize(db, [row], current_user.id)[0]


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    row = _owned(db, current_user, schedule_id)
    service.delete_schedule(db, row)
    return {"id": schedule_id, "deleted": True}


@router.post("/{schedule_id}/run")
def run_schedule_now(schedule_id: int, db: Session = Depends(get_db),
                     current_user: GRCUser = Depends(require_auth)):
    """Build the report and email it to the recipients immediately. Expected failures
    (no SMTP, lost permission, unusable filter, mail server error) are a 200 with
    {"ok": false, "message": ...} and are also recorded on the schedule (last_status /
    last_error). Does not move the schedule's next timed run."""
    row = _owned(db, current_user, schedule_id)
    result = service.run_schedule(db, row, trigger="manual", actor=_actor(current_user))
    db.refresh(row)
    result["schedule"] = service.serialize(db, [row], current_user.id)[0]
    return result
