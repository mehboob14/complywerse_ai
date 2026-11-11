"""Who may do what in a department, handed down the tree: the rights behind the Directory (Governance > Documents > Directory).

A grant (``GRCDepartmentGrant``) gives one principal - a person, or a role (everyone who holds it, as the platform gave it) - a
level on one department:

* ``view``   reads the documents of the department and of everything under it, as a reader of the library does (what is in force,
  or lapsed after it was); never a draft that was not published, nor an archived one.
* ``edit``   also reads every document of the department and below (drafts and archived ones too) and may change them
  (``modules/governance/permissions.py``). Publishing and deleting stay with the global rights.
* ``manage`` also runs the department in the Directory: its details, its people and roles, its grants, its defaults, new
  departments under it (never above it), switching it off.
* ``none``   stops what a department above gave that principal, for this department and everything under it.

A grant on a department counts for every department below it; for one principal the NEAREST grant on the way up to the top wins, so
a grant lower down overrides a higher one. A person's level is the highest among their own principal and the principals of the
roles they hold, each after its own nearest-wins. Grants only ADD: a global right (an administrator, ``admin:organization:edit``,
``governance:policies:*``) or being a department's head is never taken away by a ``none`` or a lower level.

With no grant in the database every function here answers "nothing" after one small query, so what the platform did before
grants is exactly what it does now. Functions that write only ``flush``: the caller commits. Problems a person can fix raise
``HTTPException`` (400/404/409) with a sentence to act on.
"""
from collections import defaultdict
from typing import Dict, Iterable, List, Optional, Set, Tuple

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from ..models import GRCDepartment, GRCDepartmentGrant, GRCUser, Role, UserRole
from . import org_departments

LEVELS = ("none", "view", "edit", "manage")
RANK = {level: i for i, level in enumerate(LEVELS)}
PRINCIPALS = ("user", "role")
MANAGE_RIGHT = "admin:organization:edit"          # the global right to run every department (an administrator holds it)
PICKER_LIMIT = 25


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _name(user: Optional[GRCUser], user_id: int) -> str:
    return (user.display_name or user.username or user.email) if user is not None else f"User {user_id}"


# ── what a person holds ──────────────────────────────────────────────────────
def _own_rows(db: Session, user: GRCUser) -> Tuple[Dict[Tuple[str, int], Dict[int, str]], Set[int]]:
    """(principal type, id) -> {department id: level} for the grants the person's principals hold - their own and the ones of the
    roles the platform gave them - and the tenants those grants are in. ONE statement, and nothing else when there is no grant
    (every document list asks this, so it must stay that cheap); none for a deactivated user."""
    from ..routers.auth_router import PLATFORM_GRANT

    out: Dict[Tuple[str, int], Dict[int, str]] = defaultdict(dict)
    tenants: Set[int] = set()
    if not getattr(user, "is_active", True):
        return out, tenants
    G = GRCDepartmentGrant
    roles = select(UserRole.role_id).where(UserRole.user_id == user.id, PLATFORM_GRANT)
    for row in db.query(G).filter(or_(and_(G.principal_type == "user", G.principal_id == user.id),
                                      and_(G.principal_type == "role", G.principal_id.in_(roles)))).order_by(G.id):
        out[(row.principal_type, row.principal_id)][row.department_id] = row.level
        tenants.add(row.tenant_id)
    return out, tenants


def _nearest(tree: org_departments.Tree, node: Optional[int], own: Dict[int, str]) -> Optional[Tuple[str, int]]:
    """(level, the department it was given on) for one principal: the grant on the department itself, else on the nearest
    department above it, else None."""
    while node is not None:
        if node in own:
            return own[node], node
        node = tree.parent.get(node)
    return None


def _best(tree: org_departments.Tree, node: int, by_principal: Dict[Tuple[str, int], Dict[int, str]]) -> str:
    """A person's level on one department: the highest among their principals, each after nearest-wins."""
    top = 0
    for own in by_principal.values():
        hit = _nearest(tree, node, own)
        if hit is not None:
            top = max(top, RANK.get(hit[0], 0))
    return LEVELS[top]


def levels_for(db: Session, user: GRCUser) -> Dict[int, str]:
    """department id -> 'view' | 'edit' | 'manage' for every department where the person has a level through grants (a department
    where they have none is left out). One statement when the person holds no grant."""
    by_principal, tenants = _own_rows(db, user)
    out: Dict[int, str] = {}
    for tenant_id in sorted(tenants):
        tree = org_departments.Tree.load(db, tenant_id)
        for node in tree.rows:
            level = _best(tree, node, by_principal)
            if level != "none":
                out[node] = level
    return out


def level_of(db: Session, user: GRCUser, dept_id: Optional[int]) -> str:
    """The person's level on one department through grants: 'none' | 'view' | 'edit' | 'manage'."""
    if dept_id is None:
        return "none"
    by_principal, tenants = _own_rows(db, user)
    for tenant_id in sorted(tenants):
        tree = org_departments.Tree.load(db, tenant_id)
        if dept_id in tree.rows:
            return _best(tree, dept_id, by_principal)
    return "none"


def at_least(db: Session, user: GRCUser, dept_id: Optional[int], level: str) -> bool:
    return RANK[level_of(db, user, dept_id)] >= RANK[level]


def reach(db: Session, user: GRCUser) -> Tuple[Set[int], Set[int]]:
    """(the departments the person reads through grants, the ones they edit): the read set holds the edit set. Both empty for
    nearly everyone."""
    levels = levels_for(db, user)
    return ({d for d, level in levels.items() if RANK[level] >= RANK["view"]},
            {d for d, level in levels.items() if RANK[level] >= RANK["edit"]})


def has_global_manage(db: Session, user: GRCUser) -> bool:
    """An administrator, or a role holding ``admin:organization:edit``: runs every department, whatever the grants say."""
    from ..routers.auth_router import has_tenant_permission

    return has_tenant_permission(db, user, MANAGE_RIGHT)


def can_manage(db: Session, user: GRCUser, dept_id: Optional[int]) -> bool:
    """May run the department in the Directory: a tenant administrator, ``admin:organization:edit``, or the manage level on it
    (given on it or on one above). ``None`` (a top department being made, the whole organisation) needs the global right."""
    return has_global_manage(db, user) or (dept_id is not None and level_of(db, user, dept_id) == "manage")


def manages_somewhere(db: Session, user: GRCUser) -> bool:
    return has_global_manage(db, user) or "manage" in levels_for(db, user).values()


def unit_rights(db: Session, user: GRCUser) -> Dict[int, str]:
    """What ``/auth/me`` tells the screens: the departments where grants give the person a level, with the level."""
    return levels_for(db, user)


# ── writing grants ───────────────────────────────────────────────────────────
def _check_principal(db: Session, department: GRCDepartment, principal_type: str, principal_id: int) -> None:
    if principal_type == "user":
        org_departments._check_person(db, principal_id, _problem("That person does not exist.", status.HTTP_404_NOT_FOUND))
        return
    from ..modules.governance.routers.document_signoff import signoff_roles       # the roles a person can be picked through

    role = db.get(Role, int(principal_id))
    if role is None or role.tenant_id != department.tenant_id:
        raise _problem("That role does not exist.", status.HTTP_404_NOT_FOUND)
    if role.id not in {r["id"] for r in signoff_roles(db, [department.tenant_id], people=set())}:
        raise _problem(f"'{role.name}' comes from a connected system, so nobody holds it here. Choose another role.")


def set_grant(db: Session, department: GRCDepartment, principal_type: str, principal_id: int, level: str,
              by_user_id: Optional[int] = None) -> GRCDepartmentGrant:
    """Give a person or a role a level on the department (and everything under it); one that has a row there takes the new level."""
    principal_type = (principal_type or "").strip().lower()
    level = (level or "").strip().lower()
    if principal_type not in PRINCIPALS:
        raise _problem("Choose a person or a role.")
    if level not in LEVELS:
        raise _problem(f"The level must be one of: {', '.join(LEVELS)}.")
    _check_principal(db, department, principal_type, principal_id)
    G = GRCDepartmentGrant
    row = db.query(G).filter(G.department_id == department.id, G.principal_type == principal_type,
                             G.principal_id == int(principal_id)).first()
    if row is None:
        row = G(tenant_id=department.tenant_id, department_id=department.id, principal_type=principal_type,
                principal_id=int(principal_id), level=level, created_by=by_user_id)
        db.add(row)
    else:
        row.level = level
    db.flush()
    return row


def remove_grant(db: Session, department: GRCDepartment, grant_id: int) -> GRCDepartmentGrant:
    """Take a row off this department (what it gave, or blocked, is inherited again). 404 for a row of another department."""
    row = db.get(GRCDepartmentGrant, int(grant_id))
    if row is None or row.department_id != department.id:
        raise _problem("That access entry does not exist.", status.HTTP_404_NOT_FOUND)
    db.delete(row)
    db.flush()
    return row


def labels(db: Session, rows: Iterable[GRCDepartmentGrant]) -> Dict[Tuple[str, int], str]:
    """(principal type, id) -> the person's name or the role's name."""
    rows = list(rows)
    user_ids = {r.principal_id for r in rows if r.principal_type == "user"}
    role_ids = {r.principal_id for r in rows if r.principal_type == "role"}
    out: Dict[Tuple[str, int], str] = {}
    for user in (db.query(GRCUser).filter(GRCUser.id.in_(user_ids)) if user_ids else []):
        out[("user", user.id)] = _name(user, user.id)
    for role_id, name in (db.query(Role.id, Role.name).filter(Role.id.in_(role_ids)) if role_ids else []):
        out[("role", role_id)] = name
    for r in rows:
        out.setdefault((r.principal_type, r.principal_id), f"{'User' if r.principal_type == 'user' else 'Role'} {r.principal_id}")
    return out


def grant_view(row: GRCDepartmentGrant, label: str) -> dict:
    return {"id": row.id, "principal_type": row.principal_type, "principal_id": row.principal_id, "principal_label": label,
            "level": row.level}


# ── who has a way in, and why ────────────────────────────────────────────────
def access_of(db: Session, dept_id: int) -> dict:
    """Everyone with a way into the department and why (see the Directory's Access tab): its head, the people added by hand, the
    holders of its roles, the heads of the departments above it, and whoever a grant on it or above it reaches - each with their
    level and where it comes from - then the grants on the department and the ones it inherits. Tenant-wide rights (an
    administrator, a library reader) are not listed."""
    from ..routers.auth_router import PLATFORM_GRANT

    department = db.get(GRCDepartment, int(dept_id))
    tree = org_departments.Tree.load(db, department.tenant_id)
    path = tree.path(department.id)                                     # the top department first, this one last
    depth = {d.id: i for i, d in enumerate(path)}
    G = GRCDepartmentGrant
    rows = db.query(G).filter(G.department_id.in_(list(depth))).order_by(G.id).all()
    names = labels(db, rows)
    own: Dict[Tuple[str, int], Dict[int, str]] = defaultdict(dict)
    for r in rows:
        own[(r.principal_type, r.principal_id)][r.department_id] = r.level
    nearest = {key: _nearest(tree, department.id, levels) for key, levels in own.items()}      # (level, given on) per principal

    role_ids = {pid for kind, pid in own if kind == "role"}
    holders: Dict[int, Set[int]] = defaultdict(set)
    if role_ids:
        for role_id, user_id in db.query(UserRole.role_id, UserRole.user_id).filter(
                UserRole.role_id.in_(role_ids), UserRole.tenant_id == department.tenant_id, PLATFORM_GRANT):
            holders[role_id].add(user_id)

    members = {m["user_id"]: m for m in org_departments.members_detail(db, department)}
    heads: Dict[int, List[GRCDepartment]] = defaultdict(list)           # person -> the departments on the path they head
    for d in path:
        if d.department_head_user_id:
            heads[d.department_head_user_id].append(d)
    applies: Dict[int, List[Tuple[str, int]]] = defaultdict(list)       # person -> the principals that reach them
    for kind, pid in own:
        for uid in ([pid] if kind == "user" else holders[pid]):
            applies[uid].append((kind, pid))

    ids = org_departments.platform_accounts(db, set(members) | set(heads) | set(applies))
    users = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}
    people = []
    for uid in sorted(ids):
        user, member = users[uid], members.get(uid)
        pool = [(RANK.get(nearest[key][0], 0), depth[nearest[key][1]], key[0] == "user", key) for key in applies.get(uid, [])
                if nearest.get(key) is not None]
        pool.sort(key=lambda t: (t[0], t[1], t[2]), reverse=True)
        given = [t for t in pool if t[0] > 0]                           # the principals that give a level above none, best first
        best = pool[0] if pool else None
        level = LEVELS[best[0]] if best else "none"
        level_from = None
        if best is not None:
            kind, pid = best[3]
            level_from = {"department_id": nearest[best[3]][1], "name": tree.rows[nearest[best[3]][1]].name,
                          "inherited": nearest[best[3]][1] != department.id, "principal_type": kind, "principal_label": names[(kind, pid)]}
        own_head = department.department_head_user_id == uid
        above = [d for d in heads.get(uid, []) if d.id != department.id]
        if (own_head or above) and RANK[level] < RANK["view"]:          # an owner reads all of the unit, whatever the grants say
            seat = department if own_head else above[-1]
            level, level_from = "view", {"department_id": seat.id, "name": seat.name, "inherited": seat.id != department.id,
                                         "principal_type": "owner", "principal_label": "Owner"}
        via_roles = list(member["via_roles"]) if member else []
        granted_roles = [names[t[3]] for t in given if t[3][0] == "role"]
        how = [key for key, on in (("head", own_head or bool(above)), ("manual", bool(member and "manual" in member["how"])),
                                   ("role", bool(via_roles)), ("grant", bool(given))) if on]
        if not how:                                                     # blocked and nothing else: only the grants list shows it
            continue
        via = list(dict.fromkeys(via_roles + granted_roles + [d.name for d in above]))
        direct = own.get(("user", uid), {}).get(department.id)
        grant_id = next((r.id for r in rows if (r.principal_type, r.principal_id, r.department_id) == ("user", uid, department.id)), None)
        can_remove = "manual" in how or (grant_id is not None and direct not in (None, "none"))
        stays = []
        if own_head:
            stays.append(f"{_name(user, uid)} is the owner of this unit; choose another owner first.")
        if above:
            stays.append(f"{_name(user, uid)} owns {', '.join(d.name for d in above)}, above this unit.")
        if via_roles:
            stays.append(f"{_name(user, uid)} belongs through the role{'s' if len(via_roles) > 1 else ''} {', '.join(via_roles)}; "
                         "remove the role from the unit or from the person.")
        if granted_roles:
            stays.append(f"{_name(user, uid)} has access through the role{'s' if len(granted_roles) > 1 else ''} "
                         f"{', '.join(dict.fromkeys(granted_roles))}.")
        if any(t[3][0] == "user" and nearest[t[3]][1] != department.id for t in given):
            stays.append(f"{_name(user, uid)} has access inherited from a unit above; change it there, or block it here.")
        people.append({"user_id": uid, "name": _name(user, uid), "email": user.email, "how": how, "via": via, "level": level,
                       "level_from": level_from, "grant_id": grant_id, "can_remove": can_remove,
                       "remove_blocked": None if can_remove else (" ".join(stays) or None),
                       "remains": (" ".join(stays) or None) if can_remove else None})
    people.sort(key=lambda p: (p["name"].casefold(), p["user_id"]))

    mine = [grant_view(r, names[(r.principal_type, r.principal_id)]) for r in rows if r.department_id == department.id]
    mine.sort(key=lambda g: (g["principal_type"], g["principal_label"].casefold(), g["id"]))
    inherited = [{"from_department_id": r.department_id, "from_name": tree.rows[r.department_id].name,
                  "principal_type": r.principal_type, "principal_id": r.principal_id,
                  "principal_label": names[(r.principal_type, r.principal_id)], "level": r.level,
                  "overridden": nearest[(r.principal_type, r.principal_id)][1] != r.department_id}
                 for r in rows if r.department_id != department.id]
    inherited.sort(key=lambda g: (depth[g["from_department_id"]], g["principal_type"], g["principal_label"].casefold()))
    level_number = tree.level(department.id)
    head = db.get(GRCUser, department.department_head_user_id) if department.department_head_user_id else None
    return {"department": {"id": department.id, "name": department.name, "code": department.code, "level": level_number,
                           "level_label": org_departments.level_labels(db, department.tenant_id)[min(level_number, org_departments.MAX_DEPTH) - 1],
                           "parent_department_id": tree.parent.get(department.id), "path": [d.name for d in path],
                           "head": {"id": head.id, "name": _name(head, head.id)} if head is not None else None,
                           "is_active": department.is_active is not False},
            "people": people, "grants": mine, "inherited_grants": inherited}


# ── the picker for a grant ───────────────────────────────────────────────────
def principals(db: Session, department: GRCDepartment, q: Optional[str] = None) -> dict:
    """The people and roles a grant on this department can name, by name, those matching ``q`` (name, user name or e-mail; a role's
    name) first 25 of each; ``granted`` is the level they already have on this very department (None: no row)."""
    from ..modules.governance.routers.document_signoff import signoff_roles
    from ..routers.auth_router import platform_account

    term = (q or "").strip().lower()
    users = db.query(GRCUser).filter(GRCUser.is_active.is_(True), platform_account())
    if term:
        like = f"%{term}%"
        users = users.filter(or_(func.lower(func.coalesce(GRCUser.display_name, "")).like(like),
                                 func.lower(GRCUser.username).like(like), func.lower(func.coalesce(GRCUser.email, "")).like(like)))
    users = users.order_by(func.lower(func.coalesce(GRCUser.display_name, GRCUser.username)), GRCUser.id).limit(PICKER_LIMIT).all()
    roles = [r for r in signoff_roles(db, [department.tenant_id]) if not term or term in r["name"].lower()][:PICKER_LIMIT]
    G = GRCDepartmentGrant
    have = {(r.principal_type, r.principal_id): r.level for r in db.query(G).filter(G.department_id == department.id)}
    return {"people": [{"id": u.id, "name": _name(u, u.id), "email": u.email, "designation": u.designation,
                        "granted": have.get(("user", u.id))} for u in users],
            "roles": [{"id": r["id"], "name": r["name"], "user_count": r["user_count"], "granted": have.get(("role", r["id"]))} for r in roles]}
