"""Administration → Departments: the organisation's units, their head, their roles and their people (DECISIONS D37).

Owns /admin/departments. A department's people are the ones added by hand, its head, and everyone who holds one of its roles
(computed, never stored); every rule lives in ``services/org_departments.py``. Reading is open to anyone signed in (the list is a
picker for every module and for the documents' Department dropdown); changing a department needs ``admin:organization:edit``
(an administrator holds it), like the department routes of the vulnerability module - or the manage level on that department,
given on it or on one above it (``services/department_rights.py``, the Directory): then only that department and what is under it
(a department made under it, a unit moved to a parent the person also manages); a top department needs the global right.

The Directory (Governance > Documents > Directory) reads ``GET /directory`` (every department, flat, in tree order, with what the
caller may do) and ``GET /{id}/access`` (who has a way in and why), and writes ``PUT /{id}/grants`` and ``DELETE /{id}/grants/{grant_id}``.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..models import GovernanceDocument, GRCDepartment, GRCUser, get_db
from ..services import department_rights, org_departments
from .auth_router import get_user_primary_tenant, get_user_tenants, require_auth, require_tenant_permission

router = APIRouter(prefix="/admin/departments", tags=["Departments"])

_manage = Depends(require_tenant_permission("admin:organization:edit"))
DENIED = "Permission denied"


def _unit_manager(department_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)) -> bool:
    """A route of one department: the global right, or the manage level on it (given on it or above it)."""
    if not department_rights.can_manage(db, current_user, department_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED)
    return True


def _manager_somewhere(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)) -> bool:
    """A route a person who runs any department may need (the roles a department can take people from)."""
    if not department_rights.manages_somewhere(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED)
    return True


_manage_unit = Depends(_unit_manager)
_manage_some = Depends(_manager_somewhere)


# ─── Schemas ─────────────────────────────────────────────────────────────────

class RoleRef(BaseModel):
    id: int
    name: str


class DepartmentOut(BaseModel):
    id: int
    tenant_id: int
    name: str
    code: str
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    parent_department_name: Optional[str] = None
    department_head_user_id: Optional[int] = None
    department_head_name: Optional[str] = None
    is_active: bool
    roles: List[RoleRef] = []
    member_count: int = 0                   # distinct people: added by hand, the head, holders of the roles
    manual_member_count: int = 0            # those of them added by hand
    team_id: Optional[int] = None           # the picker record other modules store (Administration → Teams' id)
    document_count: int = 0                 # its documents the caller may read, archived ones left out
    document_count_total: int = 0           # the same for it and everything under it
    level: int = 1                          # 1 = a top department, 2 = under one, 3 = the deepest the tree goes (D57)
    level_label: str = "Department"         # what the organisation calls that level
    path: List[str] = []                    # the names from the top department down to this one
    child_count: int = 0                    # departments directly under it, switched off ones included
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class MemberOut(BaseModel):
    user_id: int
    name: str
    email: Optional[str] = None
    designation: Optional[str] = None
    how: List[str] = []                     # any of "head", "manual", "role"
    member_role: Optional[str] = None       # lead | member | viewer when added by hand, else None
    via_roles: List[str] = []
    added_at: Optional[datetime] = None


class SubDepartmentOut(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool


class DepartmentDetailOut(DepartmentOut):
    members: List[MemberOut] = []
    sub_departments: List[SubDepartmentOut] = []


class RoleOptionOut(BaseModel):
    id: int
    name: str
    user_count: int


class DepartmentCreate(BaseModel):
    name: str
    code: Optional[str] = None
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None
    role_ids: List[int] = []


class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None
    is_active: Optional[bool] = None
    role_ids: Optional[List[int]] = None    # present = the roles become exactly these


class RolesIn(BaseModel):
    role_ids: List[int] = []


class LevelsIn(BaseModel):
    labels: List[Optional[str]]             # one name per level, top first; blank = the default


class LevelsOut(BaseModel):
    labels: List[str]
    defaults: List[str]
    max_depth: int


class MemberIn(BaseModel):
    user_id: int
    role: Optional[str] = "member"          # lead | member | viewer


class MemberRoleIn(BaseModel):
    role: str


class GrantIn(BaseModel):
    principal_type: str                     # user | role
    principal_id: int
    level: str                              # none | view | edit | manage


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _department(db: Session, user: GRCUser, department_id: int) -> GRCDepartment:
    row = (db.query(GRCDepartment)
           .filter(GRCDepartment.id == department_id, GRCDepartment.tenant_id.in_(get_user_tenants(user, db))).first())
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found.")
    return row


def _document_counts(db: Session, rows: List[GRCDepartment], user: GRCUser) -> dict:
    """department id -> how many of its documents ``user`` may read, archived ones (withdrawn: D29) left out. One grouped query
    however many departments there are. The reader's own rule (``permissions.visible_filter``) is applied so the number never
    includes a document the library would not show them: for an administrator or an editor that is every document."""
    from ..modules.governance import permissions        # here, not at the top: importing the governance package loads its router and every module under it

    if not rows:
        return {}
    G = GovernanceDocument
    q = db.query(G.department_id, func.count(G.id)).filter(
        G.department_id.in_([r.id for r in rows]), G.tenant_id.in_({r.tenant_id for r in rows}),
        or_(G.status.is_(None), G.status != "archived"))
    readable = permissions.visible_filter(db, user)
    if readable is not None:
        q = q.filter(readable)
    return dict(q.group_by(G.department_id).all())


def _views(db: Session, rows: List[GRCDepartment], user: GRCUser) -> List[DepartmentOut]:
    """The departments as the API shows them, in a handful of queries however many there are."""
    info = org_departments.overview(db, rows)
    trees = {t: org_departments.Tree.load(db, t) for t in {r.tenant_id for r in rows}}
    labels = {t: org_departments.level_labels(db, t) for t in trees}
    # the counts cover the whole tree of each organisation: a department's total takes in departments that are not in `rows`
    documents = _document_counts(db, [d for tree in trees.values() for d in tree.rows.values()], user)
    parent_ids = {r.parent_department_id for r in rows if r.parent_department_id}
    head_ids = {r.department_head_user_id for r in rows if r.department_head_user_id}
    parents = dict(db.query(GRCDepartment.id, GRCDepartment.name).filter(GRCDepartment.id.in_(parent_ids)).all()) if parent_ids else {}
    heads = ({u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(head_ids))} if head_ids else {})
    out = []
    for r in rows:
        tree = trees[r.tenant_id]
        level = tree.level(r.id)
        out.append(DepartmentOut(
            id=r.id, tenant_id=r.tenant_id, name=r.name, code=r.code, description=r.description,
            parent_department_id=r.parent_department_id, parent_department_name=parents.get(r.parent_department_id),
            department_head_user_id=r.department_head_user_id, department_head_name=heads.get(r.department_head_user_id),
            is_active=r.is_active is not False, document_count=documents.get(r.id, 0),
            document_count_total=sum(documents.get(i, 0) for i in tree.subtree(r.id)),
            level=level, level_label=labels[r.tenant_id][min(level, org_departments.MAX_DEPTH) - 1],
            path=[d.name for d in tree.path(r.id)], child_count=len(tree.children.get(r.id, [])),
            created_at=r.created_at, updated_at=r.updated_at, **info[r.id]))
    return out


def _detail(db: Session, row: GRCDepartment, user: GRCUser) -> DepartmentDetailOut:
    kids = (db.query(GRCDepartment).filter(GRCDepartment.parent_department_id == row.id)
            .order_by(func.lower(GRCDepartment.name), GRCDepartment.id).all())
    return DepartmentDetailOut(
        **_views(db, [row], user)[0].model_dump(), members=[MemberOut(**m) for m in org_departments.members_detail(db, row)],
        sub_departments=[SubDepartmentOut(id=k.id, name=k.name, code=k.code, is_active=k.is_active is not False) for k in kids])


def _member(db: Session, row: GRCDepartment, user_id: int) -> MemberOut:
    found = next((m for m in org_departments.members_detail(db, row) if m["user_id"] == user_id), None)
    if found is None:               # added a moment ago, so only an account that stopped counting in between
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="That person is not a member of this department.")
    return MemberOut(**found)


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("", response_model=List[DepartmentOut])
def list_departments(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The departments of the caller's organisation by name. Open to anyone signed in: every module's picker and the documents'
    Department dropdown read it."""
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return []
    q = db.query(GRCDepartment).filter(GRCDepartment.tenant_id.in_(tenants))
    if not include_inactive:
        q = q.filter(GRCDepartment.is_active.isnot(False))
    return _views(db, q.order_by(func.lower(GRCDepartment.name), GRCDepartment.id).all(), current_user)


@router.get("/role-options", response_model=List[RoleOptionOut])
def role_options(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_some,
):
    """The roles a department can take its members from, with how many people hold each: the roles an access-review connector made
    (every link imported) are left out, as they are for a document's reviewers and approvers."""
    from ..modules.governance.routers.document_signoff import signoff_roles

    return signoff_roles(db, get_user_tenants(current_user, db))


@router.get("/levels", response_model=LevelsOut)
def get_levels(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """What the organisation calls the levels of its department tree (a Department, a Sub-department, a Unit until it says
    otherwise). Open to anyone signed in: every picker names the levels."""
    tenant_id = get_user_primary_tenant(current_user, db)
    return LevelsOut(labels=org_departments.level_labels(db, tenant_id) if tenant_id else list(org_departments.DEFAULT_LEVEL_LABELS),
                     defaults=list(org_departments.DEFAULT_LEVEL_LABELS), max_depth=org_departments.MAX_DEPTH)


@router.put("/levels", response_model=LevelsOut)
def set_levels(
    payload: LevelsIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    labels = org_departments.set_level_labels(db, tenant_id, payload.labels, by_user_id=current_user.id)
    db.commit()
    return LevelsOut(labels=labels, defaults=list(org_departments.DEFAULT_LEVEL_LABELS), max_depth=org_departments.MAX_DEPTH)


@router.post("", response_model=DepartmentOut, status_code=status.HTTP_201_CREATED)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    if not department_rights.can_manage(db, current_user, payload.parent_department_id or None):    # a top department needs the global right
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=DENIED)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is not assigned to any tenant.")
    row = org_departments.create_department(
        db, tenant_id, name=payload.name, code=payload.code, description=payload.description,
        parent_department_id=payload.parent_department_id, department_head_user_id=payload.department_head_user_id,
        role_ids=payload.role_ids, by_user_id=current_user.id)
    db.commit()
    db.refresh(row)
    return _views(db, [row], current_user)[0]


@router.get("/directory")
def directory(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every department of the organisation for the Directory, flat and in tree order (the top ones by name, each followed by what
    is under it), switched-off ones included and marked. ``counts``: its documents the caller may read (archived ones left out;
    ``documents_total`` takes in everything under it), its people, the departments directly under it. ``can_manage``: the caller
    may run it (the global right, or the manage level on it or above it); ``can_create_top``: the caller may make a top department."""
    everything = department_rights.has_global_manage(db, current_user)
    out = {"levels": list(org_departments.DEFAULT_LEVEL_LABELS), "max_depth": org_departments.MAX_DEPTH,
           "can_create_top": everything, "nodes": []}               # a top department needs the global right
    held = {} if everything else department_rights.levels_for(db, current_user)
    for tenant_id in get_user_tenants(current_user, db):
        tree = org_departments.Tree.load(db, tenant_id)
        rows = list(tree.rows.values())
        labels = org_departments.level_labels(db, tenant_id)
        out["levels"] = labels
        info = org_departments.overview(db, rows)
        documents = _document_counts(db, rows, current_user)
        head_ids = {r.department_head_user_id for r in rows if r.department_head_user_id}
        heads = ({u.id: u.display_name or u.username for u in db.query(GRCUser).filter(GRCUser.id.in_(head_ids))} if head_ids else {})

        def by_name(node_id: int):
            return (tree.rows[node_id].name.casefold(), node_id)

        def walk(node_id: int) -> None:
            r, level = tree.rows[node_id], tree.level(node_id)
            out["nodes"].append({
                "id": r.id, "parent_id": tree.parent.get(r.id), "name": r.name, "code": r.code, "level": level,
                "level_label": labels[min(level, org_departments.MAX_DEPTH) - 1],
                "head": ({"id": r.department_head_user_id, "name": heads.get(r.department_head_user_id, "")}
                         if r.department_head_user_id else None),
                "is_active": r.is_active is not False,
                "counts": {"documents": documents.get(r.id, 0), "documents_total": sum(documents.get(i, 0) for i in tree.subtree(r.id)),
                           "members": info[r.id]["member_count"], "children": len(tree.children.get(r.id, []))},
                "can_manage": everything or held.get(r.id) == "manage"})
            for child in sorted(tree.children.get(node_id, []), key=by_name):
                walk(child)

        for top in sorted((n for n in tree.rows if tree.parent.get(n) is None), key=by_name):
            walk(top)
    return out


@router.get("/{department_id}", response_model=DepartmentDetailOut)
def get_department(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    return _detail(db, _department(db, current_user, department_id), current_user)


@router.patch("/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    row = _department(db, current_user, department_id)
    changes = payload.model_dump(exclude_unset=True)
    moved_to = changes.get("parent_department_id") or None
    if "parent_department_id" in changes and moved_to != row.parent_department_id and not department_rights.can_manage(db, current_user, moved_to):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="A department can only be moved under a department you also manage; a top department needs the "
                                   "right to administer the organisation.")
    org_departments.update_department(db, row, changes, by_user_id=current_user.id)
    db.commit()
    db.refresh(row)
    return _views(db, [row], current_user)[0]


@router.delete("/{department_id}")
def delete_department(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    """Departments are never deleted: documents and assignments keep pointing at them. This stops offering it."""
    row = _department(db, current_user, department_id)
    org_departments.deactivate(db, row)
    db.commit()
    return {"message": "Department deactivated. Records that use it keep it.", "id": row.id}


@router.put("/{department_id}/roles", response_model=DepartmentDetailOut)
def set_department_roles(
    department_id: int,
    payload: RolesIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    row = _department(db, current_user, department_id)
    org_departments.set_roles(db, row, payload.role_ids, by_user_id=current_user.id)
    db.commit()
    return _detail(db, row, current_user)


@router.post("/{department_id}/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED)
def add_member(
    department_id: int,
    payload: MemberIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    row = _department(db, current_user, department_id)
    org_departments.add_member(db, row, payload.user_id, payload.role, by_user_id=current_user.id)
    db.commit()
    return _member(db, row, payload.user_id)


@router.patch("/{department_id}/members/{user_id}", response_model=MemberOut)
def update_member(
    department_id: int,
    user_id: int,
    payload: MemberRoleIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    row = _department(db, current_user, department_id)
    org_departments.update_member(db, row, user_id, payload.role)
    db.commit()
    return _member(db, row, user_id)


@router.delete("/{department_id}/members/{user_id}")
def remove_member(
    department_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    """Take a person out of the members added by hand. Someone who belongs only through a role or as head is not removed here
    (409 says how to)."""
    row = _department(db, current_user, department_id)
    still = org_departments.remove_member(db, row, user_id)
    db.commit()
    return {"message": "Removed from the members added by hand." + (f" {still}" if still else ""), "id": user_id}


# ─── Who has access (the Directory's Access tab) ─────────────────────────────

@router.get("/{department_id}/access")
def department_access(
    department_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Everyone with a way into the department and why, the level each has and where it comes from, the grants on the department
    and the ones it inherits from the departments above (``department_rights.access_of``). Open to anyone signed in, like the
    department and its members."""
    return department_rights.access_of(db, _department(db, current_user, department_id).id)


@router.get("/{department_id}/principals")
def department_principals(
    department_id: int,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    """The people and roles a grant on this department can name, by name (the first 25 of each that match ``q``)."""
    return department_rights.principals(db, _department(db, current_user, department_id), q)


@router.put("/{department_id}/grants")
def set_department_grant(
    department_id: int,
    payload: GrantIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    """Give a person or a role a level on the department and everything under it (view, edit, manage), or block what a department
    above gave them (none). A row that exists takes the new level."""
    row = _department(db, current_user, department_id)
    grant = department_rights.set_grant(db, row, payload.principal_type, payload.principal_id, payload.level, by_user_id=current_user.id)
    db.commit()
    return department_rights.grant_view(grant, department_rights.labels(db, [grant])[(grant.principal_type, grant.principal_id)])


@router.delete("/{department_id}/grants/{grant_id}")
def remove_department_grant(
    department_id: int,
    grant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _manage_unit,
):
    """Take a row off this department: what it gave, or blocked, comes from the departments above again."""
    department_rights.remove_grant(db, _department(db, current_user, department_id), grant_id)
    db.commit()
    return {"message": "Access entry removed.", "id": grant_id}
