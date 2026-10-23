"""Departments: the organisation's units and who belongs to them (DECISIONS D37). One module owns every rule; the admin API, the
legacy Teams API, the vulnerability module, the sign-off and the document permissions all ask it.

A department (``GRCDepartment``) is the one unit. A person belongs to it in three ways:

* by hand - an active ``GRCDepartmentMember`` row (lead, member or viewer);
* as its head - ``department_head_user_id``;
* through a role - anyone who holds one of its roles (``GRCDepartmentRole``). This is computed whenever it is asked, never
  stored, so a person who gains or loses the role joins or leaves the department at once.

Only active people of this platform count. A deactivated user, an account an access-review connector imported
(``auth_router.platform_account``) and a role link such a connector imported (``auth_router.PLATFORM_GRANT``) give nobody
membership.

Every department also has a picker record: a ``Team`` row linked by ``Team.department_id``. Other records store team ids (an
asset's owning team, assignees, sign-off targets, risk teams, RCSA), so those ids must keep working and show the department's name.
A linked team mirrors its department (name, description, head as lead, active flag) and its people are the department's; a team
with no department is a legacy team and keeps its own ``TeamMember`` rows.

Functions that write only ``flush``: the caller commits. Problems a person can fix raise ``HTTPException`` (400/404/409) with a
sentence to act on.
"""
import logging
import re
from collections import defaultdict
from datetime import datetime
from typing import Dict, Iterable, List, Optional, Set

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import GRCDepartment, GRCDepartmentMember, GRCDepartmentRole, GRCUser, Role, Team, TeamMember, UserRole

logger = logging.getLogger(__name__)

MEMBER_ROLES = ("lead", "member", "viewer")       # what a person added by hand is in the department
NAME_MAX, CODE_MAX, TEAM_NAME_MAX = 255, 50, 100   # GRCDepartment.name / .code, Team.name
MANAGED_BY_DEPARTMENT = "This team is managed as a department. Change it in Administration → Departments."


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _same(a: Optional[str], b: Optional[str]) -> bool:
    """Names and codes are the same when they differ only in case and surrounding spaces."""
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def _member_role(raw: Optional[str]) -> str:
    """The role of a hand-made membership as the admin API names it (the vulnerability module also writes "head")."""
    raw = (raw or "").strip().lower()
    return "lead" if raw in ("lead", "head") else raw if raw in MEMBER_ROLES else "member"


def _who(user: Optional[GRCUser], user_id: int) -> str:
    return (user.display_name or user.username or user.email) if user is not None else f"User {user_id}"


# ── who is in a department ───────────────────────────────────────────────────
def platform_accounts(db: Session, ids: Iterable[int], active_only: bool = True) -> Set[int]:
    """The ids among ``ids`` of users of this platform (not accounts an access review imported); the active ones unless asked."""
    from ..routers.auth_router import platform_account

    ids = {int(i) for i in ids if i}
    if not ids:
        return set()
    q = db.query(GRCUser.id).filter(GRCUser.id.in_(ids), platform_account())
    if active_only:
        q = q.filter(GRCUser.is_active.is_(True))
    return {uid for (uid,) in q}


def _facts(db: Session, departments: List[GRCDepartment]):
    """What decides who is in these departments, in a handful of queries: (hand-made members, roles, role holders, people).
    manual: department id -> {user id: active GRCDepartmentMember}; roles: department id -> [(role id, role name)] by name;
    holders: role id -> user ids holding it as the platform gave it; people: the ids among everyone named above who count."""
    from ..routers.auth_router import PLATFORM_GRANT

    ids = [d.id for d in departments]
    manual: Dict[int, Dict[int, GRCDepartmentMember]] = defaultdict(dict)
    roles: Dict[int, List[tuple]] = defaultdict(list)
    holders: Dict[int, Set[int]] = defaultdict(set)
    if ids:
        for row in db.query(GRCDepartmentMember).filter(GRCDepartmentMember.department_id.in_(ids),
                                                        GRCDepartmentMember.is_active.is_(True)):
            manual[row.department_id][row.user_id] = row
        for dept_id, role_id, name in (db.query(GRCDepartmentRole.department_id, Role.id, Role.name)
                                       .join(Role, Role.id == GRCDepartmentRole.role_id)
                                       .filter(GRCDepartmentRole.department_id.in_(ids)).order_by(func.lower(Role.name), Role.id)):
            roles[dept_id].append((role_id, name))
        role_ids = {role_id for pairs in roles.values() for role_id, _ in pairs}
        if role_ids:
            for role_id, user_id in db.query(UserRole.role_id, UserRole.user_id).filter(
                    UserRole.role_id.in_(role_ids), UserRole.tenant_id.in_({d.tenant_id for d in departments}), PLATFORM_GRANT):
                holders[role_id].add(user_id)
    named = ({u for rows in manual.values() for u in rows} | {d.department_head_user_id for d in departments}
             | {u for users in holders.values() for u in users})
    return manual, roles, holders, platform_accounts(db, named)


def effective_member_sets(db: Session, departments: List[GRCDepartment]) -> Dict[int, Set[int]]:
    """department id -> the ids of its people: added by hand, its head, and the holders of its roles (several departments, no query
    per department)."""
    manual, roles, holders, people = _facts(db, departments)
    out = {}
    for d in departments:
        ids = set(manual[d.id]) | {u for role_id, _ in roles[d.id] for u in holders[role_id]}
        ids.add(d.department_head_user_id)
        out[d.id] = ids & people
    return out


def effective_member_ids(db: Session, department: GRCDepartment) -> Set[int]:
    return effective_member_sets(db, [department])[department.id]


def members_detail(db: Session, department: GRCDepartment) -> List[dict]:
    """Each person of the department, by name: how they belong (``how``: any of "head", "manual", "role"), their role when added
    by hand (``member_role``: lead, member or viewer; None when they only belong as head or through a role), the roles they belong
    through (``via_roles``) and when they were added by hand (``added_at``)."""
    manual, roles, holders, people = _facts(db, [department])
    through = defaultdict(list)
    for role_id, name in roles[department.id]:
        for user_id in holders[role_id]:
            through[user_id].append(name)
    ids = (set(manual[department.id]) | set(through) | {department.department_head_user_id}) & people
    users = {u.id: u for u in db.query(GRCUser).filter(GRCUser.id.in_(ids))} if ids else {}
    rows = []
    for user_id in ids:
        user, row = users[user_id], manual[department.id].get(user_id)
        how = [key for key, on in (("head", user_id == department.department_head_user_id), ("manual", row is not None),
                                   ("role", user_id in through)) if on]
        rows.append({"user_id": user_id, "name": _who(user, user_id), "email": user.email, "designation": user.designation, "how": how,
                     "member_role": _member_role(row.role) if row is not None else None,
                     "via_roles": sorted(through.get(user_id, []), key=str.casefold), "added_at": row.added_at if row is not None else None})
    return sorted(rows, key=lambda r: (r["name"].casefold(), r["user_id"]))


def overview(db: Session, departments: List[GRCDepartment]) -> Dict[int, dict]:
    """For each department id, what a list shows besides its own columns: ``roles`` ([{id, name}]), ``member_count`` (distinct
    people), ``manual_member_count`` (those of them added by hand) and ``team_id`` (its picker record)."""
    manual, roles, holders, people = _facts(db, departments)
    teams = {}
    if departments:
        for team_id, dept_id in db.query(Team.id, Team.department_id).filter(
                Team.department_id.in_([d.id for d in departments])).order_by(Team.id.desc()):
            teams[dept_id] = team_id                                  # the oldest wins (ordered newest first)
    out = {}
    for d in departments:
        ids = set(manual[d.id]) | {u for role_id, _ in roles[d.id] for u in holders[role_id]}
        ids.add(d.department_head_user_id)
        out[d.id] = {"roles": [{"id": role_id, "name": name} for role_id, name in roles[d.id]], "member_count": len(ids & people),
                     "manual_member_count": len(set(manual[d.id]) & people), "team_id": teams.get(d.id)}
    return out


def role_recipients(db: Session, department: GRCDepartment) -> List[GRCUser]:
    """The people who belong to the department only through its roles and could be mailed: active people of this platform who hold
    a role of it and have no active hand-made membership (those are asked by the module that keeps that list, with their own
    notification choice)."""
    manual, roles, holders, people = _facts(db, [department])
    ids = ({u for role_id, _ in roles[department.id] for u in holders[role_id]} & people) - set(manual[department.id])
    users = db.query(GRCUser).filter(GRCUser.id.in_(ids)).order_by(GRCUser.id).all() if ids else []
    return [u for u in users if u.email]


# ── the Team records that stand for departments ──────────────────────────────
def team_member_sets(db: Session, teams: List[Team]) -> Dict[int, Set[int]]:
    """team id -> the people the team asks. A linked team asks its department's people; a legacy team its TeamMember rows and its
    lead, the platform accounts among them, as it always did."""
    out: Dict[int, Set[int]] = {}
    linked = [t for t in teams if t.department_id]
    if linked:
        departments = {d.id: d for d in db.query(GRCDepartment).filter(GRCDepartment.id.in_({t.department_id for t in linked}))}
        sets = effective_member_sets(db, list(departments.values()))
        for t in linked:
            out[t.id] = set(sets.get(t.department_id, ()))              # a department that is gone has nobody
    legacy = [t for t in teams if not t.department_id]
    if legacy:
        named: Dict[int, Set[int]] = defaultdict(set)
        for team_id, user_id in db.query(TeamMember.team_id, TeamMember.user_id).filter(TeamMember.team_id.in_([t.id for t in legacy])):
            named[team_id].add(user_id)
        people = platform_accounts(db, {u for ids in named.values() for u in ids} | {t.lead_user_id for t in legacy}, active_only=False)
        for t in legacy:
            out[t.id] = (named[t.id] | {t.lead_user_id}) & people
    return out


def team_member_ids(db: Session, team: Team) -> Set[int]:
    return team_member_sets(db, [team])[team.id]


def teams_of(db: Session, user: GRCUser):
    """A select of the ids of the teams ``user`` belongs to or leads (for ``.in_()``): a linked team when the person is its
    department's head, a hand-made member or holds one of its roles (as the platform gave it); a legacy team when they are one of
    its members or its lead. The matching of ``team_member_sets``, as one SQL condition."""
    from ..routers.auth_router import platform_role_ids

    D, M, R = GRCDepartment, GRCDepartmentMember, GRCDepartmentRole
    mine = select(D.id).where(or_(
        D.department_head_user_id == user.id,
        D.id.in_(select(M.department_id).where(M.user_id == user.id, M.is_active.is_(True))),
        D.id.in_(select(R.department_id).where(R.role_id.in_(platform_role_ids(db, user))))))
    return select(Team.id).where(or_(
        Team.department_id.in_(mine),
        and_(Team.department_id.is_(None), or_(Team.id.in_(select(TeamMember.team_id).where(TeamMember.user_id == user.id)),
                                               Team.lead_user_id == user.id))))


def _team_name(db: Session, department: GRCDepartment, team_id: Optional[int]) -> str:
    """The department's name as a Team name: at most 100 characters and not another team's (a suffix " (2)", " (3)"... makes it so)."""
    base = (department.name or "").strip()[:TEAM_NAME_MAX].rstrip() or "Department"
    q = db.query(Team.name).filter(Team.tenant_id == department.tenant_id)
    if team_id is not None:
        q = q.filter(Team.id != team_id)
    taken = {name.strip().casefold() for (name,) in q}
    name, n = base, 1
    while name.casefold() in taken:
        n += 1
        suffix = f" ({n})"
        name = base[:TEAM_NAME_MAX - len(suffix)].rstrip() + suffix
    return name


def _absorb_team(db: Session, team: Team, department: GRCDepartment) -> int:
    """A legacy team becomes the picker record of ``department`` without anyone dropping out of it: its members join the department
    by hand, and so does its lead unless the department has them (a membership row the department already has, active or not,
    stays as it is). Returns how many rows were added."""
    have = {uid for (uid,) in db.query(GRCDepartmentMember.user_id).filter(GRCDepartmentMember.department_id == department.id)}
    wanted = [(tm.user_id, tm.role_in_team, tm.added_at, tm.added_by)
              for tm in db.query(TeamMember).filter(TeamMember.team_id == team.id).order_by(TeamMember.id)]
    if team.lead_user_id and team.lead_user_id != department.department_head_user_id:
        wanted.append((team.lead_user_id, "lead", None, None))
    added = 0
    for user_id, role, at, by in wanted:
        if user_id in have:
            continue
        have.add(user_id)
        db.add(GRCDepartmentMember(department_id=department.id, user_id=user_id, role=_member_role(role), added_at=at or datetime.utcnow(),
                                   added_by=by, is_active=True))
        added += 1
    return added


def sync_team_shim(db: Session, department: GRCDepartment) -> Team:
    """The department's picker record, made or brought up to date: named like the department, with its description, its head as
    lead and its active flag. A legacy team of the same name (case aside) is taken over rather than duplicated, with its people."""
    db.flush()                  # tenant sessions do not autoflush (PITFALLS 74): what the caller just changed must be seen below
    team = db.query(Team).filter(Team.department_id == department.id).order_by(Team.id).first()
    if team is None:
        team = next((t for t in db.query(Team).filter(Team.tenant_id == department.tenant_id, Team.department_id.is_(None)).order_by(Team.id)
                     if _same(t.name, department.name)), None)
        if team is not None:
            _absorb_team(db, team, department)
    name = _team_name(db, department, team.id if team is not None else None)
    if team is None:
        team = Team(tenant_id=department.tenant_id, name=name)
        db.add(team)
    team.department_id = department.id
    team.name = name
    team.description = department.description
    team.lead_user_id = department.department_head_user_id
    team.is_active = department.is_active is not False
    db.flush()
    return team


# ── departments ──────────────────────────────────────────────────────────────
def unique_code(db: Session, tenant_id: int, name: str, exclude_id: Optional[int] = None) -> str:
    """A code for a new department, from its name: the initials of its words, or the first letters of a single word, in capitals
    and at most 12 characters; "2", "3"... is added when the tenant already has it."""
    words = re.findall(r"[^\W_]+", name or "")
    base = ("".join(w[0] for w in words) if len(words) > 1 else (words[0][:4] if words else "")).upper()[:12] or "DEPT"
    q = db.query(GRCDepartment.code).filter(GRCDepartment.tenant_id == tenant_id)
    if exclude_id is not None:
        q = q.filter(GRCDepartment.id != exclude_id)
    taken = {c.strip().casefold() for (c,) in q}
    code, n = base, 1
    while code.casefold() in taken:
        n += 1
        code = base[:12 - len(str(n))] + str(n)
    return code


def _text(value, what: str, limit: int) -> str:
    value = str(value or "").strip()
    if not value:
        raise _problem(f"The department {what} is required.")
    if len(value) > limit:
        raise _problem(f"The department {what} is too long ({limit} characters at most).")
    return value


def _check_unique(db: Session, tenant_id: int, name: Optional[str], code: Optional[str], exclude_id: Optional[int] = None) -> None:
    for dept_id, other_name, other_code in db.query(GRCDepartment.id, GRCDepartment.name, GRCDepartment.code).filter(
            GRCDepartment.tenant_id == tenant_id):
        if dept_id == exclude_id:
            continue
        if name is not None and _same(other_name, name):
            raise _problem(f"A department named '{name}' already exists.")
        if code is not None and _same(other_code, code):
            raise _problem(f"A department with the code '{code}' already exists.")


def _check_parent(db: Session, tenant_id: int, parent_id: int, self_id: Optional[int] = None) -> None:
    """The parent exists in the tenant and is not the department itself or one of its own sub-departments (no loop)."""
    node = db.get(GRCDepartment, int(parent_id))
    if node is None or node.tenant_id != tenant_id:
        raise _problem("The parent department chosen does not exist.")
    seen = set()
    while self_id is not None and node is not None and node.id not in seen:
        if node.id == self_id:
            raise _problem("A department cannot be placed under itself or under one of its own sub-departments.")
        seen.add(node.id)
        node = db.get(GRCDepartment, node.parent_department_id) if node.parent_department_id else None


def _check_person(db: Session, user_id: int, missing: HTTPException) -> GRCUser:
    """An active user of this platform; ``missing`` is raised for an id nobody has, 400 for an account an access review imported."""
    from ..routers.auth_router import refuse_imported_accounts

    user = db.get(GRCUser, int(user_id))
    if user is None:
        raise missing
    refuse_imported_accounts(db, [user.id])
    if not user.is_active:
        raise _problem(f"{_who(user, user.id)} is not an active user.")
    return user


def check_roles(db: Session, tenant_id: int, role_ids: Optional[Iterable[int]]) -> List[int]:
    """The distinct role ids, in the order given, when every one is a role of the tenant."""
    ids = list(dict.fromkeys(int(r) for r in role_ids or []))
    if ids and {r for (r,) in db.query(Role.id).filter(Role.id.in_(ids), Role.tenant_id == tenant_id)} != set(ids):
        raise _problem("One of the roles chosen does not exist.")
    return ids


def set_roles(db: Session, department: GRCDepartment, role_ids: Iterable[int], by_user_id: Optional[int] = None) -> None:
    """The department's roles become exactly ``role_ids`` (each a role of the tenant)."""
    wanted = check_roles(db, department.tenant_id, role_ids)
    have = {r.role_id: r for r in db.query(GRCDepartmentRole).filter(GRCDepartmentRole.department_id == department.id)}
    for role_id, row in have.items():
        if role_id not in wanted:
            db.delete(row)
    for role_id in wanted:
        if role_id not in have:
            db.add(GRCDepartmentRole(department_id=department.id, role_id=role_id, added_by=by_user_id))
    db.flush()


def create_department(db: Session, tenant_id: int, *, name, code=None, description=None, parent_department_id=None,
                      department_head_user_id=None, role_ids=None, by_user_id: Optional[int] = None) -> GRCDepartment:
    """A new department (and its picker record). A missing code is made from the name."""
    name = _text(name, "name", NAME_MAX)
    code = _text(code, "code", CODE_MAX) if (code or "").strip() else None
    _check_unique(db, tenant_id, name, code)
    if parent_department_id:
        _check_parent(db, tenant_id, parent_department_id)
    if department_head_user_id:
        _check_person(db, department_head_user_id, _problem("The head chosen does not exist."))
    roles = check_roles(db, tenant_id, role_ids)
    department = GRCDepartment(tenant_id=tenant_id, name=name, code=code or unique_code(db, tenant_id, name),
                               description=(description or "").strip() or None, parent_department_id=parent_department_id or None,
                               department_head_user_id=department_head_user_id or None, is_active=True)
    db.add(department)
    db.flush()
    set_roles(db, department, roles, by_user_id)
    sync_team_shim(db, department)
    return department


def update_department(db: Session, department: GRCDepartment, changes: dict, by_user_id: Optional[int] = None) -> GRCDepartment:
    """Apply the fields present in ``changes`` (name, code, description, parent_department_id, department_head_user_id, is_active,
    role_ids; a field set to None clears it where it may be empty). Everything is checked before anything changes, then the
    picker record follows."""
    tenant_id, fields = department.tenant_id, {}
    if "name" in changes or "code" in changes:
        name = _text(changes["name"], "name", NAME_MAX) if "name" in changes else None
        code = _text(changes["code"], "code", CODE_MAX) if "code" in changes else None
        _check_unique(db, tenant_id, name, code, exclude_id=department.id)
        fields.update({key: value for key, value in (("name", name), ("code", code)) if value is not None})
    if "description" in changes:
        fields["description"] = (changes["description"] or "").strip() or None
    if "parent_department_id" in changes:
        parent = changes["parent_department_id"] or None
        if parent is not None and parent != department.parent_department_id:
            _check_parent(db, tenant_id, parent, self_id=department.id)
        fields["parent_department_id"] = parent
    if "department_head_user_id" in changes:
        head = changes["department_head_user_id"] or None
        if head is not None and head != department.department_head_user_id:        # a head already named may stay
            _check_person(db, head, _problem("The head chosen does not exist."))
        fields["department_head_user_id"] = head
    if changes.get("is_active") is not None:
        fields["is_active"] = bool(changes["is_active"])
    roles = check_roles(db, tenant_id, changes["role_ids"]) if "role_ids" in changes else None
    for key, value in fields.items():
        setattr(department, key, value)
    if roles is not None:
        set_roles(db, department, roles, by_user_id)
    department.updated_at = datetime.utcnow()
    db.flush()
    sync_team_shim(db, department)
    return department


def deactivate(db: Session, department: GRCDepartment) -> GRCDepartment:
    """Departments are never deleted (documents and assignments point at them): they stop being offered."""
    return update_department(db, department, {"is_active": False})


def activate(db: Session, department: GRCDepartment) -> GRCDepartment:
    return update_department(db, department, {"is_active": True})


# ── people added by hand ─────────────────────────────────────────────────────
def _role_of(role: Optional[str]) -> str:
    role = (role or "member").strip().lower()
    if role not in MEMBER_ROLES:
        raise _problem(f"The role must be one of: {', '.join(MEMBER_ROLES)}.")
    return role


def _manual_row(db: Session, department: GRCDepartment, user_id: int) -> Optional[GRCDepartmentMember]:
    return db.query(GRCDepartmentMember).filter(GRCDepartmentMember.department_id == department.id,
                                                GRCDepartmentMember.user_id == user_id).first()


def add_member(db: Session, department: GRCDepartment, user_id: int, role: Optional[str] = "member",
               by_user_id: Optional[int] = None) -> GRCDepartmentMember:
    """Add a person by hand: a removed membership comes back, one that is active takes the new role."""
    role = _role_of(role)
    user = _check_person(db, user_id, _problem("User not found.", status.HTTP_404_NOT_FOUND))
    row = _manual_row(db, department, user.id)
    if row is None:
        row = GRCDepartmentMember(department_id=department.id, user_id=user.id, role=role, added_by=by_user_id, is_active=True)
        db.add(row)
    elif not row.is_active:
        row.is_active, row.role, row.added_at, row.added_by = True, role, datetime.utcnow(), by_user_id
    else:
        row.role = role
    db.flush()
    return row


def update_member(db: Session, department: GRCDepartment, user_id: int, role: Optional[str]) -> GRCDepartmentMember:
    row = _manual_row(db, department, user_id)
    if row is None or not row.is_active:
        raise _problem("That person was not added to this department by hand, so there is no role to change.",
                       status.HTTP_404_NOT_FOUND)
    row.role = _role_of(role)
    db.flush()
    return row


def belongs_otherwise(db: Session, department: GRCDepartment, user_id: int) -> Optional[str]:
    """How a person still belongs to the department apart from being added by hand, as a sentence (None when they do not)."""
    row = next((r for r in members_detail(db, department) if r["user_id"] == user_id and (r["via_roles"] or "head" in r["how"])), None)
    if row is None:
        return None
    parts = []
    if row["via_roles"]:
        names = ", ".join(row["via_roles"])
        parts.append(f"{row['name']} belongs to this department through the role{'s' if len(row['via_roles']) > 1 else ''} {names}; "
                     "remove the role from the department or from the person.")
    if "head" in row["how"]:
        parts.append(f"{row['name']} is the head of this department; choose another head first.")
    return " ".join(parts)


def remove_member(db: Session, department: GRCDepartment, user_id: int) -> Optional[str]:
    """Take a person out of the hand-made members (the row stays, inactive). Returns a sentence when they still belong through a
    role or as head. 409 when they belong only that way; 404 when they do not belong at all."""
    row = _manual_row(db, department, user_id)
    if row is None or not row.is_active:
        why = belongs_otherwise(db, department, user_id)
        if why:
            raise _problem(why, status.HTTP_409_CONFLICT)
        raise _problem("That person is not a member of this department.", status.HTTP_404_NOT_FOUND)
    row.is_active = False
    db.flush()
    return belongs_otherwise(db, department, user_id)


# ── teams become departments ─────────────────────────────────────────────────
def backfill(db: Session) -> Dict[str, int]:
    """Make every legacy team a department and every department a picker record, once, adding and linking only (a row is never
    deleted or rewritten; the TeamMember rows stay). Safe to run again and from two processes at once: each team or department
    is its own transaction, and one that collides with the other process's is skipped and found settled next time.

    * A team with no department is linked to the department of the same name (case aside) when that has no picker record yet,
      else a department is made from it (its name, description, lead as head, active flag). Its members, and its lead if the
      department has another head, join the department by hand.
    * Every active department with no picker record gets one.
    Returns the counts: teams_linked, departments_created, members_copied, pickers_created, skipped."""
    counts = {"teams_linked": 0, "departments_created": 0, "members_copied": 0, "pickers_created": 0, "skipped": 0}
    for team_id in [i for (i,) in db.query(Team.id).filter(Team.department_id.is_(None)).order_by(Team.id)]:
        try:
            team = db.get(Team, team_id)
            if team is None or team.department_id is not None:
                continue
            department = next((d for d in db.query(GRCDepartment).filter(GRCDepartment.tenant_id == team.tenant_id)
                               .order_by(GRCDepartment.id) if _same(d.name, team.name)), None)
            made = department is None
            if made:
                name = (team.name or "").strip() or f"Team {team.id}"
                department = GRCDepartment(tenant_id=team.tenant_id, name=name[:NAME_MAX], code=unique_code(db, team.tenant_id, name),
                                           description=team.description, department_head_user_id=team.lead_user_id,
                                           is_active=team.is_active is not False, created_at=team.created_at or datetime.utcnow())
                db.add(department)
                db.flush()
            elif db.query(Team.id).filter(Team.department_id == department.id).first() is not None:
                counts["skipped"] += 1              # that department already has its picker record: this team stays as it is
                logger.warning("team %s (%s) left as it is: department %s already has a team", team.id, team.name, department.id)
                continue
            team.department_id = department.id
            copied = _absorb_team(db, team, department)
            sync_team_shim(db, department)
            db.commit()
            counts["teams_linked"] += 1
            counts["departments_created"] += int(made)
            counts["members_copied"] += copied
        except IntegrityError:
            db.rollback()
            counts["skipped"] += 1
            logger.warning("team %s left for the next run: another process wrote the same rows", team_id)
    have = {d for (d,) in db.query(Team.department_id).filter(Team.department_id.isnot(None))}
    for department_id in [i for (i,) in db.query(GRCDepartment.id).filter(GRCDepartment.is_active.isnot(False)).order_by(GRCDepartment.id)]:
        if department_id in have:
            continue
        try:
            sync_team_shim(db, db.get(GRCDepartment, department_id))
            db.commit()
            counts["pickers_created"] += 1
        except IntegrityError:
            db.rollback()
            counts["skipped"] += 1
            logger.warning("department %s left for the next run: another process wrote the same rows", department_id)
    return counts
