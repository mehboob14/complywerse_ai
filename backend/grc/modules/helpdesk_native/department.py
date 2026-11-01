"""Departments — ComplyVerse NET-NEW (not a Frappe conversion).

Frappe Helpdesk has no Department; its only org-grouping unit is HD Team. ComplyVerse
adds a thin Department layer so the Help Desk is a general multi-department
service desk (Sales raises "PC slow", Finance its own categories, IT/Security
vulns) instead of a vuln-only tool. A Department maps to a default Team, so the
ALREADY-CONVERTED assignment + SLA engines route a ticket onward unchanged:

    New ticket -> department -> department.default_team -> ticket.agent_group
               -> existing assignment.py picks an agent, existing sla.py applies.

Dept-scoped ticket types: HDTicketType.department_id (null = available to all
departments; set = that department's own request categories).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import HDDepartment, Team, HDTicketType, get_db
from .common import require_settings_manage, require_view, require_masterdata_view, tenant_id

router = APIRouter(prefix="/helpdesk/departments", tags=["Help Desk (native)"])


class DepartmentBody(BaseModel):
    name: str
    description: Optional[str] = None
    default_team_id: Optional[int] = None
    enabled: bool = True


def _serialize(d: HDDepartment) -> dict:
    return {
        "id": d.id,
        "name": d.name,
        "description": d.description,
        "default_team_id": d.default_team_id,
        "default_team": d.default_team.name if d.default_team else None,
        "enabled": bool(d.enabled),
    }


def _get(db: Session, tid: int, dept_id: int) -> HDDepartment:
    """Tenant-scoped fetch (the tenant filter is the isolation guard; a
    cross-tenant id yields no row -> 404, never another tenant's record)."""
    d = (
        db.query(HDDepartment)
        .filter(HDDepartment.tenant_id == tid, HDDepartment.id == dept_id)
        .first()
    )
    if not d:
        raise HTTPException(status_code=404, detail="Department not found")
    return d


def resolve_department_team(db: Session, tid: int, department_id: Optional[int]) -> Optional[int]:
    """Return the team id a ticket for this department routes to (its
    default_team), or None when there is no department / no default team. Used by
    the create-ticket path to stamp agent_group before the existing
    assignment/SLA pipeline runs. Tenant-scoped + ignores disabled departments."""
    if not department_id:
        return None
    d = (
        db.query(HDDepartment)
        .filter(
            HDDepartment.tenant_id == tid,
            HDDepartment.id == department_id,
            HDDepartment.enabled.is_(True),
        )
        .first()
    )
    return d.default_team_id if d else None


@router.get("")
def list_departments(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    tid = tenant_id(db)
    rows = (
        db.query(HDDepartment)
        .filter(HDDepartment.tenant_id == tid)
        .order_by(HDDepartment.name.asc())
        .all()
    )
    return {"departments": [_serialize(d) for d in rows]}


@router.post("")
def create_department(body: DepartmentBody, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required")
    if db.query(HDDepartment).filter(HDDepartment.tenant_id == tid,
                                     HDDepartment.name == name).first():
        raise HTTPException(status_code=400, detail="A department with this name already exists")
    if body.default_team_id is not None and not (
        db.query(Team).filter(Team.tenant_id == tid,
                                Team.id == body.default_team_id).first()
    ):
        raise HTTPException(status_code=400, detail="Default team not found")
    d = HDDepartment(
        tenant_id=tid, name=name, description=body.description,
        default_team_id=body.default_team_id, enabled=body.enabled,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return {"ok": True, "id": d.id}


@router.put("/{dept_id}")
def update_department(dept_id: int, body: DepartmentBody, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    d = _get(db, tid, dept_id)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Department name is required")
    clash = (
        db.query(HDDepartment)
        .filter(HDDepartment.tenant_id == tid, HDDepartment.name == name,
                HDDepartment.id != dept_id)
        .first()
    )
    if clash:
        raise HTTPException(status_code=400, detail="A department with this name already exists")
    if body.default_team_id is not None and not (
        db.query(Team).filter(Team.tenant_id == tid,
                                Team.id == body.default_team_id).first()
    ):
        raise HTTPException(status_code=400, detail="Default team not found")
    d.name = name
    d.description = body.description
    d.default_team_id = body.default_team_id
    d.enabled = body.enabled
    db.commit()
    return {"ok": True}


@router.delete("/{dept_id}")
def delete_department(dept_id: int, db: Session = Depends(get_db),
                      _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    d = _get(db, tid, dept_id)
    # Detach dept-scoped ticket types so the FK doesn't orphan (they become global).
    db.query(HDTicketType).filter(HDTicketType.tenant_id == tid,
                                  HDTicketType.department_id == dept_id)\
        .update({HDTicketType.department_id: None}, synchronize_session=False)
    db.delete(d)
    db.commit()
    return {"ok": True}
