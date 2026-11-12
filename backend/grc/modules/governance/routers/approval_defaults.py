"""Governance > Documents > Directory > Approvals: who reviews and approves by default in a department, sub-department or unit, and who
implements an exception there (``services/approval_defaults.py``; the table, the inheritance, the lock and how a document gets its
defaults are explained there).

Reading a unit's defaults needs a governance right (the same test as the exception rules: an administrator, or any ``governance:*``
right) or the right to manage that unit; writing needs ``governance:settings:edit`` (administrators hold it) or the right to manage
that unit (``_may_manage``). The organisation-wide defaults are the settings right's alone. Nothing here decides a document: the
defaults only say who will be asked when one is sent for review; one already in review keeps the people it started with.

A unit in a URL is its id, or ``org`` for the whole organisation.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import GRCUser, get_db
from ....routers.auth_router import get_user_primary_tenant, has_tenant_permission, is_tenant_admin, require_auth, tenant_permission_names
from ....services import approval_defaults as svc
from ....services import department_rights
from ....services import org_departments

router = APIRouter(prefix="/approval-defaults", tags=["Governance Approval Defaults"])

SETTINGS_RIGHT = "governance:settings:edit"
STRUCTURE_RIGHT = "admin:organization:edit"
WRITE_REFUSED = "Only an administrator, someone allowed to change governance settings or someone who manages this unit can change its defaults."
ORG_WRITE_REFUSED = "Only an administrator or someone allowed to change governance settings can change the organisation's defaults."
READ_REFUSED = "Only an administrator, someone with a governance right or someone who manages this unit can see its defaults."


class PersonIn(BaseModel):
    type: str                               # user | role | team | unit_owner | parent_owner
    id: Optional[int] = None


class DefaultIn(BaseModel):
    people: List[PersonIn] = []             # doc_review, doc_approval, exc_implementer
    route: Optional[List[Dict[str, Any]]] = None      # doc_route: the stages as routes.validate takes them
    locked: bool = False
    is_active: bool = True


def _tenant(db: Session, user: GRCUser) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    return tenant_id


def _unit(raw: str) -> Optional[int]:
    if raw == svc.ORG:
        return None
    if raw.isdigit():
        return int(raw)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")


def _may_manage(db: Session, user: GRCUser, department_id: Optional[int]) -> bool:
    """Whether the person manages this unit (the organisation: nobody does, only the settings right): wired to
    ``department_rights.can_manage(db, user, department_id)`` (cascading rights); until then it is the right to change the structure."""
    return department_id is not None and department_rights.can_manage(db, user, department_id)


def _may_write(db: Session, user: GRCUser, department_id: Optional[int]) -> bool:
    return has_tenant_permission(db, user, SETTINGS_RIGHT) or _may_manage(db, user, department_id)


def _may_read(db: Session, user: GRCUser, department_id: Optional[int]) -> bool:
    return (is_tenant_admin(db, user) or any(n.startswith("governance:") for n in tenant_permission_names(db, user))
            or _may_manage(db, user, department_id))


def _known(db: Session, tenant_id: int, department_id: Optional[int]) -> None:
    if department_id is not None and department_id not in org_departments.Tree.load(db, tenant_id).rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")


def _subject(subject: str) -> str:
    if subject not in svc.SUBJECTS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Choose what the default is for.")
    return subject


@router.get("")
def get_defaults(department_id: str = Query(svc.ORG), db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """A unit's defaults, subject by subject: its own, the one that applies (and where it comes from), and whether a lock above stops
    it being changed here."""
    unit = _unit(department_id)
    if not _may_read(db, current_user, unit):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=READ_REFUSED)
    tenant_id = _tenant(db, current_user)
    _known(db, tenant_id, unit)
    return {**svc.view(db, tenant_id, unit), "can_edit": _may_write(db, current_user, unit)}


@router.get("/overview")
def get_overview(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Which units define their own default, for the badges. Booleans only, so anyone signed in reads it."""
    return svc.overview(db, _tenant(db, current_user))


@router.get("/resolve")
def resolve_default(department_id: str = Query(svc.ORG), subject: Optional[str] = None, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    """What a document or an exception of this unit would get (for forms): the default that applies and where it comes from, for one
    ``subject`` or for all, and whether a document follows a route or reviewers and approvers (``document``). Anyone signed in, as the
    people a document may be sent to are."""
    unit = _unit(department_id)
    tenant_id = _tenant(db, current_user)
    _known(db, tenant_id, unit)
    shown = svc.view(db, tenant_id, unit)
    pick = {s: {"effective": b["effective"], "source": b["source"]} for s, b in shown["subjects"].items()}
    if subject is not None:
        return {"department_id": unit, "subject": _subject(subject), **pick[subject], "document": shown["document"]}
    return {"department_id": unit, "subjects": pick, "document": shown["document"]}


@router.put("/{department_id}/{subject}")
def put_default(department_id: str, subject: str, body: DefaultIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    unit = _unit(department_id)
    if not _may_write(db, current_user, unit):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED if unit is not None else ORG_WRITE_REFUSED)
    tenant_id = _tenant(db, current_user)
    svc.save(db, tenant_id, unit, _subject(subject), body.model_dump(), current_user.id)
    db.commit()
    return {"department_id": unit, "subject": subject, **svc.view(db, tenant_id, unit)["subjects"][subject]}


@router.delete("/{department_id}/{subject}")
def delete_default(department_id: str, subject: str, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Back to inherited: the unit's own default for this subject is removed (documents already in review keep the people they have)."""
    unit = _unit(department_id)
    if not _may_write(db, current_user, unit):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED if unit is not None else ORG_WRITE_REFUSED)
    tenant_id = _tenant(db, current_user)
    _known(db, tenant_id, unit)
    svc.remove(db, tenant_id, unit, _subject(subject))
    db.commit()
    return {"department_id": unit, "subject": subject, **svc.view(db, tenant_id, unit)["subjects"][subject]}
