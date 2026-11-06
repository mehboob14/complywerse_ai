"""Governance > Settings > Exception approvals: who reviews and approves a policy exception, for the whole organisation or for a
department / sub-department / unit (DECISIONS D58; rules and flow: ``exception_approvals.py``, ``exception_rules.py``).

Reading the rules needs a governance right (the same test as the document settings: an administrator, or any ``governance:*``
right). Writing needs ``governance:settings:edit`` (administrators hold it). Nothing here decides an exception: the rules only say who
will be asked when one is submitted; one already waiting keeps the steps it started with.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import ExceptionApprovalRule, GRCUser, Role, get_db
from ....routers.auth_router import get_user_primary_tenant, get_user_tenants, has_tenant_permission, is_tenant_admin, require_auth, tenant_permission_names
from ....services import org_departments
from .. import exception_approvals as svc
from .. import exception_rules as R
from .. import exception_types as types

router = APIRouter(prefix="/exception-approval-rules", tags=["Policy Exception Approval Rules"])

SETTINGS_RIGHT = "governance:settings:edit"
WRITE_REFUSED = "Only an administrator or someone allowed to change governance settings can change these rules."
READ_REFUSED = "Only an administrator or someone with a governance right can see these rules."
TYPES_REFUSED = "Only an administrator or someone allowed to change governance settings can change the exception types."


class PersonIn(BaseModel):
    type: str                               # user | role | unit_owner | parent_owner
    id: Optional[int] = None


class StepIn(BaseModel):
    name: Optional[str] = None
    kind: str = "review"                    # review | approval
    order: str = "together"                 # together | in_turn
    rule: str = "all"                       # all | any | at_least
    min_count: Optional[int] = None
    due_days: Optional[int] = None
    allow_changes: Optional[bool] = True
    allow_reject: Optional[bool] = None     # None: an approval may reject, a review may not
    people: List[PersonIn] = []


class ImplementerIn(BaseModel):
    name: Optional[str] = None              # "Implementation" when left out
    due_days: Optional[int] = None
    people: List[PersonIn] = []             # any one of them carries the exception out


class RuleIn(BaseModel):
    name: str
    department_id: Optional[int] = None     # None: the whole organisation
    priorities: List[str] = []
    doc_types: List[str] = []
    exception_types: List[str] = []         # values of the organisation's list of exception types ([] = any)
    is_active: bool = True
    steps: List[StepIn] = []
    implementer: Optional[ImplementerIn] = None   # asked once the last approval is given; None: nobody implements it


class PreviewIn(BaseModel):
    department_id: Optional[int] = None
    priority: Optional[str] = None
    doc_type: Optional[str] = None
    exception_type: Optional[str] = None


class TypeIn(BaseModel):
    value: Optional[str] = None             # a new type has none: it is made from its name
    label: str
    archived: bool = False


class TypesIn(BaseModel):
    types: List[TypeIn]


def _tenant(db: Session, user: GRCUser) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    return tenant_id


def _may_write(db: Session, user: GRCUser) -> bool:
    return has_tenant_permission(db, user, SETTINGS_RIGHT)


def _may_read(db: Session, user: GRCUser) -> bool:
    return is_tenant_admin(db, user) or any(n.startswith("governance:") for n in tenant_permission_names(db, user))


def _rule(db: Session, user: GRCUser, rule_id: int) -> ExceptionApprovalRule:
    row = db.query(ExceptionApprovalRule).filter(ExceptionApprovalRule.id == rule_id,
                                                 ExceptionApprovalRule.tenant_id.in_(get_user_tenants(user, db))).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found.")
    return row


def _options(db: Session, tenant_id: int) -> dict:
    """What the rule editor picks from: people, roles (not one an access-review connector made), the priorities and the kinds of policy."""
    from ..doc_lifecycle import _people
    from .document_signoff import signoff_roles

    ids = _people(db)
    people = [{"id": u.id, "name": u.display_name or u.username, "email": u.email}
              for u in db.query(GRCUser).filter(GRCUser.id.in_(ids)).order_by(GRCUser.display_name, GRCUser.username)] if ids else []
    return {"users": people, "roles": signoff_roles(db, [tenant_id]), "priorities": list(R.PRIORITIES),
            "doc_types": ["policy", "standard", "procedure", "guideline", "charter", "framework"]}


@router.get("")
def list_rules(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    if not _may_read(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=READ_REFUSED)
    tenant_id = _tenant(db, current_user)
    can_edit = _may_write(db, current_user)
    return {"rules": svc.rules_view(db, tenant_id), "can_edit": can_edit,
            "options": _options(db, tenant_id) if can_edit else None,
            "level_labels": org_departments.level_labels(db, tenant_id),
            "exception_types": types.options(db, tenant_id)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_rule(body: RuleIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    if not _may_write(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED)
    tenant_id = _tenant(db, current_user)
    row = svc.save_rule(db, tenant_id, body.model_dump(), current_user.id)
    db.commit()
    return next(r for r in svc.rules_view(db, tenant_id) if r["id"] == row.id)


@router.post("/preview")
def preview_rule(body: PreviewIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Which rule would apply to an exception like this, and who each of its steps would ask now."""
    if not _may_write(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED)
    return svc.preview(db, _tenant(db, current_user), body.department_id, body.priority, body.doc_type, body.exception_type)


@router.get("/types")
def list_types(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """The organisation's exception types (the exceptions page offers the ones in use; archived ones are listed so a name still shows).
    Like the exceptions themselves, readable by anyone signed in."""
    return {"types": types.options(db, _tenant(db, current_user)), "can_edit": _may_write(db, current_user)}


@router.put("/types")
def set_types(body: TypesIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Set the list of types. A type left out is archived, not lost: exceptions and rules that hold it keep it and its name."""
    if not _may_write(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=TYPES_REFUSED)
    tenant_id = _tenant(db, current_user)
    before = types.options(db, tenant_id)
    rows = types.save(db, tenant_id, [t.model_dump() for t in body.types], current_user.id)
    try:
        from ....rich_audit import write_rich_audit_log

        write_rich_audit_log(db, tenant_id=tenant_id, user_id=current_user.id, action="settings_updated", resource_type="module_settings",
                             resource_id=None, before={"exception_types": before}, after={"exception_types": rows},
                             summary="Policy exception types updated", resource_name="Policy exceptions")
    except Exception:       # the audit trail is best effort here, as for every module's settings
        pass
    return {"types": rows, "can_edit": True}


@router.put("/{rule_id}")
def update_rule(rule_id: int, body: RuleIn, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    if not _may_write(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED)
    row = _rule(db, current_user, rule_id)
    svc.save_rule(db, row.tenant_id, body.model_dump(), current_user.id, rule=row)
    db.commit()
    return next(r for r in svc.rules_view(db, row.tenant_id) if r["id"] == row.id)


@router.delete("/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    """Delete a rule. Exceptions already waiting keep the steps they started with; later ones match the other rules, or none."""
    if not _may_write(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=WRITE_REFUSED)
    row = _rule(db, current_user, rule_id)
    db.delete(row)
    db.commit()
    return {"message": "Rule deleted. Exceptions already waiting keep the steps they started with.", "id": rule_id}
