"""Cascading rights on the department tree (the Directory): a grant (view, edit, manage, or none to block) on a department counts for
everything under it, the nearest one wins, a person's level is the highest of their own principal and their roles', and grants only
ADD - they never take a global right or a head's read away. They reach the documents (permissions.can_read / can_edit / visible_filter /
edit_filter / readable_among), the department write routes, /auth/me (user.unit_rights) and the Directory API
(/admin/departments/directory, /{id}/access, /{id}/principals, PUT /{id}/grants, DELETE /{id}/grants/{grant_id}).
Over HTTP through the governance and the departments routers on in-memory SQLite."""
from datetime import datetime

import pytest
from sqlalchemy import text

import grc.models as m
from grc.modules.governance import permissions
from grc.routers import auth_router
from grc.routers.admin_departments_router import router as departments_router
from grc.routers.auth_router import create_access_token
from grc.services import department_rights as R
from grc.services import org_departments as D

from test_governance_permissions import (ADMIN, AUTHOR, CLOUD, EDITOR, OWNER, PUBLISHER, SAM, SIGNED_IN, SSO,  # noqa: F401  (world is a fixture)
                                         doc, world)

# Operations (10) > Support (11) > Helpdesk (12); Finance (13) is a tree of its own
OPS, SUP, HELP, FINANCE = 10, 11, 12, 13
HEAD, FINANCE_HEAD = SIGNED_IN, SSO
READERS, CONNECTOR_ROLE = 24, 25                       # "Unit readers" (held by Sam and Anna, as the platform gave it), a role only a connector imported
DEPARTMENT_ENDPOINTS = ("set_department_grant", "remove_department_grant")


@pytest.fixture
def unit(world):
    """The tree, and documents in it: 5 draft (Helpdesk), 6 draft (Finance, Sam's own), 7 published (Operations), 8 published (Support),
    9 draft (Support), 10 archived (Helpdesk), 11 published (Finance), 12 expired after being published (Helpdesk)."""
    db = world.db
    for did, name, parent, head in [(OPS, "Operations", None, HEAD), (SUP, "Support", OPS, None), (HELP, "Helpdesk", SUP, None),
                                    (FINANCE, "Finance", None, FINANCE_HEAD)]:
        db.add(m.GRCDepartment(id=did, tenant_id=1, name=name, code=name[:4].upper(), parent_department_id=parent, department_head_user_id=head))
    db.add(m.Role(id=READERS, tenant_id=1, name="Unit readers"))
    db.add(m.Role(id=CONNECTOR_ROLE, tenant_id=1, name="Okta: engineers"))
    db.add(m.UserRole(user_id=SAM, role_id=READERS, tenant_id=1))
    db.add(m.UserRole(user_id=AUTHOR, role_id=READERS, tenant_id=1))
    db.add(m.UserRole(user_id=SSO, role_id=CONNECTOR_ROLE, tenant_id=1, source="okta"))          # imported: no right of its own
    db.get(m.GovernanceDocument, 5).department_id = HELP
    db.get(m.GovernanceDocument, 6).department_id = FINANCE
    for did, title, status, dept, extra in [
            (7, "Operations handbook", "published", OPS, {}), (8, "Support handbook", "published", SUP, {}),
            (9, "Support draft", "draft", SUP, {}), (10, "Helpdesk old", "archived", HELP, {}),
            (11, "Finance handbook", "published", FINANCE, {}),
            (12, "Helpdesk expired", "expired", HELP, {"last_published_version": "1.0"})]:
        db.add(m.GovernanceDocument(id=did, tenant_id=1, title=title, doc_type="policy", status=status, current_version="1.0", content="# x\n",
                                    owner_id=OWNER, author_id=OWNER, department_id=dept, **extra))
    db.commit()
    return world


class _As:
    """The shared client, signed in as ``who`` for each request it makes (a variable keeps meaning that person)."""

    def __init__(self, world, who):
        self.world, self.who = world, who

    def __getattr__(self, verb):
        def call(*args, **kwargs):
            self.world.me["id"] = self.who
            return getattr(self.world.http, verb)(*args, **kwargs)
        return call


def as_(world, who):
    return _As(world, who)


def grant(world, dept, kind, who, level):
    row = R.set_grant(world.db, world.db.get(m.GRCDepartment, dept), kind, who, level, by_user_id=ADMIN)
    world.db.commit()
    return row


def levels(world, who=SAM):
    return R.levels_for(world.db, world.db.get(m.GRCUser, who))


def readable(world, who):
    db, user = world.db, world.db.get(m.GRCUser, who)
    cond = permissions.visible_filter(db, user)
    q = db.query(m.GovernanceDocument.id)
    return {i for (i,) in (q if cond is None else q.filter(cond))}


def editable(world, who):
    db, user = world.db, world.db.get(m.GRCUser, who)
    cond = permissions.edit_filter(db, user)
    q = db.query(m.GovernanceDocument.id)
    return {i for (i,) in (q if cond is None else q.filter(cond))}


# ── the rule ─────────────────────────────────────────────────────────────────
def test_a_grant_counts_for_everything_under_the_department_and_the_nearest_one_wins(unit):
    assert levels(unit) == {} and R.level_of(unit.db, unit.db.get(m.GRCUser, SAM), HELP) == "none"        # nothing granted: nothing
    grant(unit, OPS, "user", SAM, "view")
    assert levels(unit) == {OPS: "view", SUP: "view", HELP: "view"}                                         # Finance is another tree
    low = grant(unit, HELP, "user", SAM, "edit")                                                            # lower down: its own level, even a higher one
    assert levels(unit) == {OPS: "view", SUP: "view", HELP: "edit"}
    R.set_grant(unit.db, unit.db.get(m.GRCDepartment, HELP), "user", SAM, "view")                           # lower down overrides downwards too
    unit.db.commit()
    grant(unit, OPS, "user", SAM, "manage")
    grant(unit, HELP, "user", SAM, "view")
    assert levels(unit) == {OPS: "manage", SUP: "manage", HELP: "view"}
    R.remove_grant(unit.db, unit.db.get(m.GRCDepartment, HELP), low.id)
    unit.db.commit()
    assert levels(unit) == {OPS: "manage", SUP: "manage", HELP: "manage"}                                   # back to what it inherits
    assert R.level_of(unit.db, unit.db.get(m.GRCUser, SAM), HELP) == "manage"
    assert R.level_of(unit.db, unit.db.get(m.GRCUser, SAM), FINANCE) == "none" and R.level_of(unit.db, unit.db.get(m.GRCUser, SAM), None) == "none"


def test_none_blocks_what_a_department_above_gave_that_principal_below(unit):
    grant(unit, OPS, "user", SAM, "edit")
    grant(unit, SUP, "user", SAM, "none")
    assert levels(unit) == {OPS: "edit"}                                                                    # Support and the Helpdesk are blocked
    grant(unit, HELP, "user", SAM, "view")                                                                  # a grant lower again lifts the block there
    assert levels(unit) == {OPS: "edit", HELP: "view"}


def test_a_person_has_the_highest_level_of_their_own_principal_and_their_roles(unit):
    grant(unit, OPS, "role", READERS, "manage")                                                             # Sam holds Unit readers
    grant(unit, SUP, "user", SAM, "view")                                                                   # lower, but a different principal: the roles still give manage
    assert levels(unit) == {OPS: "manage", SUP: "manage", HELP: "manage"}
    grant(unit, SUP, "user", SAM, "none")                                                                   # a person's own block does not stop their role's grant
    assert levels(unit)[HELP] == "manage"
    grant(unit, SUP, "role", READERS, "view")                                                               # block or lower the role itself: that stops it
    assert levels(unit) == {OPS: "manage", SUP: "view", HELP: "view"}
    grant(unit, HELP, "role", READERS, "none")
    assert levels(unit) == {OPS: "manage", SUP: "view"}
    assert levels(unit, AUTHOR) == {OPS: "manage", SUP: "view"}                                              # the other holder of the role
    assert levels(unit, EDITOR) == {}                                                                       # someone who does not


def test_only_roles_the_platform_gave_and_active_people_count(unit):
    unit.db.add(m.GRCDepartmentGrant(tenant_id=1, department_id=OPS, principal_type="role", principal_id=CONNECTOR_ROLE, level="manage"))   # (the API refuses it)
    unit.db.commit()
    assert levels(unit, SSO) == {}                                                                          # a link a connector imported gives nothing
    grant(unit, OPS, "user", SAM, "view")
    unit.db.get(m.GRCUser, SAM).is_active = False
    unit.db.commit()
    assert levels(unit) == {}                                                                               # a deactivated user has no level


def test_with_no_grant_in_the_database_nothing_changes(unit):
    db = unit.db
    assert db.query(m.GRCDepartmentGrant).count() == 0
    for who in (OWNER, AUTHOR, SAM, EDITOR, PUBLISHER, ADMIN, HEAD, FINANCE_HEAD):
        user = db.get(m.GRCUser, who)
        assert R.levels_for(db, user) == {} and R.reach(db, user) == (set(), set()) and R.unit_rights(db, user) == {}
    assert readable(unit, SAM) == {6}                                                                       # his own draft, as before
    assert editable(unit, SAM) == {6} and editable(unit, EDITOR) == {i for (i,) in db.query(m.GovernanceDocument.id)}
    assert readable(unit, HEAD) == {5, 7, 8, 9, 10, 12}                                                     # the head of Operations: as before


# ── additive only ────────────────────────────────────────────────────────────
def test_grants_never_take_a_right_away(unit):
    db = unit.db
    grant(unit, OPS, "user", EDITOR, "none")                                                                # an editor blocked on Operations still edits (global right)
    grant(unit, OPS, "user", HEAD, "none")                                                                  # the head still reads all of Operations
    grant(unit, OPS, "user", ADMIN, "none")
    grant(unit, OPS, "role", 20, "none")
    editor, head, admin = (db.get(m.GRCUser, i) for i in (EDITOR, HEAD, ADMIN))
    assert permissions.can_edit(db, editor, doc(unit)) and permissions.can_read(db, head, doc(unit)) and permissions.can_read(db, head, doc(unit, 9))
    assert R.can_manage(db, admin, SUP) is True and R.has_global_manage(db, admin) is True
    assert readable(unit, HEAD) == {5, 7, 8, 9, 10, 12} and editable(unit, EDITOR) == {i for (i,) in db.query(m.GovernanceDocument.id)}
    # the grant of someone else changes nothing for the others
    before = {who: (readable(unit, who), editable(unit, who)) for who in (OWNER, AUTHOR, PUBLISHER, SSO)}
    grant(unit, OPS, "user", SAM, "manage")
    assert before == {who: (readable(unit, who), editable(unit, who)) for who in (OWNER, AUTHOR, PUBLISHER, SSO)}
    assert permissions.can_read(db, db.get(m.GRCUser, AUTHOR), doc(unit, 11)) is False                      # not a reader: still not
    assert R.can_manage(db, db.get(m.GRCUser, PUBLISHER), OPS) is False


# ── the documents ────────────────────────────────────────────────────────────
def test_view_reads_what_a_library_reader_reads_in_the_department_and_under_it(unit):
    db = unit.db
    grant(unit, SUP, "user", SAM, "view")
    sam = db.get(m.GRCUser, SAM)
    assert readable(unit, SAM) == {6, 8, 12}                                                                # in force or lapsed after it was, under Support; his own draft
    assert permissions.can_read(db, sam, doc(unit, 8)) and permissions.can_read(db, sam, doc(unit, 12))
    for refused in (5, 9, 10):                                                                              # a draft never published, an archived one
        assert permissions.can_read(db, sam, doc(unit, refused)) is False, refused
    assert permissions.can_read(db, sam, doc(unit, 7)) is False and permissions.can_read(db, sam, doc(unit, 11)) is False      # Operations is above, Finance elsewhere
    assert permissions.readable_among(db, sam, [5, 6, 7, 8, 9, 10, 11, 12, None]) == {6, 8, 12}
    assert {i for (i,) in db.query(m.GovernanceDocument.id).filter(m.GovernanceDocument.id.in_(permissions.readable_ids(db, sam)))} == {6, 8, 12}
    http = as_(unit, SAM)
    assert http.get("/governance/documents/8").status_code == 200
    assert http.get("/governance/documents/9").status_code == 403
    assert {d["id"] for d in http.get("/governance/documents").json()["items"]} == {6, 8, 12}                # the library list shows the same
    # reading is all it gives
    assert not permissions.can_edit(db, sam, doc(unit, 8)) and http.put("/governance/documents/8", json={"description": "x"}).status_code == 403
    assert http.delete("/governance/documents/8").status_code == 403 and http.post("/governance/documents/8/publish").status_code == 403
    assert editable(unit, SAM) == {6}
    assert R.can_manage(db, sam, SUP) is False


def test_edit_reads_all_of_it_and_changes_it_but_neither_publishes_nor_deletes(unit):
    db = unit.db
    grant(unit, SUP, "user", SAM, "edit")
    sam = db.get(m.GRCUser, SAM)
    assert readable(unit, SAM) == {5, 6, 8, 9, 10, 12}                                                      # drafts and the archived one too, under Support
    assert editable(unit, SAM) == {5, 6, 8, 9, 10, 12}
    assert permissions.can_edit(db, sam, doc(unit, 5)) and not permissions.can_edit(db, sam, doc(unit, 7)) and not permissions.can_edit(db, sam, doc(unit, 11))
    assert permissions.can_publish(db, sam) is False and permissions.can_delete(db, sam, doc(unit, 5)) is False
    http = as_(unit, SAM)
    assert http.get("/governance/documents/5").status_code == 200 and http.get("/governance/documents/10").status_code == 200
    assert http.put("/governance/documents/5", json={"description": "by Sam"}).status_code == 200 and doc(unit, 5).description == "by Sam"
    assert http.put("/governance/documents/7", json={"description": "x"}).status_code == 403                # Operations: above
    assert http.put("/governance/documents/11", json={"description": "x"}).status_code == 403               # Finance
    assert http.put("/governance/documents/10", json={"description": "x"}).status_code == 409               # archived: restored first, as for everybody
    assert http.put("/governance/documents/5/status", json={"status": "published"}).status_code == 403      # publishing stays global
    assert http.post("/governance/documents/5/publish").status_code == 403
    assert http.delete("/governance/documents/5").status_code == 403
    assert not permissions.can_edit(db, db.get(m.GRCUser, PUBLISHER), doc(unit, 5))


def test_edit_reads_the_newest_version_and_view_the_one_in_force(unit):
    db = unit.db
    d = doc(unit, 8)
    d.status, d.published_at, d.current_version, d.published_version = "pending_review", datetime.utcnow(), "1.1", "1.0"
    db.add(m.GovernanceDocumentVersion(document_id=8, version_number="1.0", title=d.title, content="# in force\n", status="superseded"))
    db.commit()
    sam = db.get(m.GRCUser, SAM)
    grant(unit, SUP, "user", SAM, "view")
    row = permissions.version_for(db, sam, doc(unit, 8))
    assert row is not None and row.version_number == "1.0"                                                  # what a reader reads while a new one is on its way
    grant(unit, SUP, "user", SAM, "edit")
    assert permissions.version_for(db, sam, doc(unit, 8)) is None                                           # an editor reads the newest


def test_a_grant_on_a_role_reaches_its_holders_and_manage_edits_like_edit(unit):
    grant(unit, OPS, "role", READERS, "manage")
    assert readable(unit, AUTHOR) == {5, 7, 8, 9, 10, 12} and readable(unit, SAM) == {5, 6, 7, 8, 9, 10, 12}      # (Sam also owns document 6, in Finance)
    assert editable(unit, AUTHOR) >= {5, 7, 8, 9, 10, 12}
    assert as_(unit, AUTHOR).put("/governance/documents/7", json={"description": "by Anna"}).status_code == 200
    assert as_(unit, EDITOR).put("/governance/documents/11", json={"description": "global"}).status_code == 200      # (a role with the global right, untouched)


# ── the write guards ─────────────────────────────────────────────────────────
def test_the_department_routes_need_the_global_right_or_manage_on_that_department(unit):
    unit.http.app.include_router(departments_router)
    grant(unit, SUP, "user", SAM, "manage")
    nobody = as_(unit, PUBLISHER)
    for method, path, body in [("post", "/admin/departments", {"name": "New"}), ("patch", f"/admin/departments/{SUP}", {"name": "X"}),
                               ("delete", f"/admin/departments/{SUP}", None), ("put", f"/admin/departments/{SUP}/roles", {"role_ids": []}),
                               ("post", f"/admin/departments/{SUP}/members", {"user_id": OWNER}),
                               ("put", f"/admin/departments/{SUP}/grants", {"principal_type": "user", "principal_id": OWNER, "level": "view"}),
                               ("get", f"/admin/departments/{SUP}/principals", None), ("get", "/admin/departments/role-options", None)]:
        r = getattr(nobody, method)(path, **({"json": body} if body is not None else {}))
        assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), (method, path)
    assert unit.db.query(m.GRCDepartmentGrant).count() == 1 and unit.db.query(m.GRCDepartment).count() == 4

    sam = as_(unit, SAM)                                                                                    # manage on Support: Support and the Helpdesk
    assert sam.patch(f"/admin/departments/{SUP}", json={"description": "Customer support"}).status_code == 200
    assert sam.patch(f"/admin/departments/{HELP}", json={"name": "Service desk"}).status_code == 200
    assert sam.patch(f"/admin/departments/{OPS}", json={"name": "X"}).status_code == 403                     # above it
    assert sam.patch(f"/admin/departments/{FINANCE}", json={"name": "X"}).status_code == 403                 # another tree
    assert sam.delete(f"/admin/departments/{OPS}").status_code == 403
    assert sam.put(f"/admin/departments/{OPS}/roles", json={"role_ids": []}).status_code == 403
    assert sam.post(f"/admin/departments/{OPS}/members", json={"user_id": OWNER}).status_code == 403
    assert sam.put(f"/admin/departments/{OPS}/grants", json={"principal_type": "user", "principal_id": OWNER, "level": "view"}).status_code == 403
    assert sam.get("/admin/departments/role-options").status_code == 200                                    # the picker of a department's roles
    assert sam.get(f"/admin/departments/{OPS}").status_code == 200                                          # reading stays open
    # new units: under what they manage only, a top department needs the global right
    assert sam.post("/admin/departments", json={"name": "Top"}).status_code == 403
    assert sam.post("/admin/departments", json={"name": "Beside", "parent_department_id": OPS}).status_code == 403
    r = sam.post("/admin/departments", json={"name": "Escalations", "parent_department_id": SUP})
    assert r.status_code == 201 and r.json()["level"] == 3
    r = sam.post("/admin/departments", json={"name": "Too deep", "parent_department_id": HELP})
    assert r.status_code == 400 and "nothing can be placed under it" in r.json()["detail"]                  # the depth cap still holds
    assert sam.post("/admin/departments", json={"name": "Finance", "parent_department_id": SUP}).status_code == 400      # names stay unique
    # people and roles of a unit they manage, then switching it off (never deleting it)
    assert sam.post(f"/admin/departments/{HELP}/members", json={"user_id": OWNER, "role": "member"}).status_code == 201
    assert sam.patch(f"/admin/departments/{HELP}/members/{OWNER}", json={"role": "lead"}).status_code == 200
    assert sam.delete(f"/admin/departments/{HELP}/members/{OWNER}").status_code == 200
    assert sam.put(f"/admin/departments/{HELP}/roles", json={"role_ids": [READERS]}).status_code == 200
    assert sam.delete(f"/admin/departments/{HELP}").status_code == 200
    assert unit.db.get(m.GRCDepartment, HELP).is_active is False and unit.db.query(m.GRCDepartment).filter_by(id=HELP).count() == 1


def test_moving_a_unit_needs_manage_on_where_it_goes(unit):
    unit.http.app.include_router(departments_router)
    grant(unit, SUP, "user", SAM, "manage")
    sam = as_(unit, SAM)
    assert sam.patch(f"/admin/departments/{HELP}", json={"parent_department_id": OPS}).status_code == 403   # Operations is not theirs
    assert sam.patch(f"/admin/departments/{HELP}", json={"parent_department_id": None}).status_code == 403  # nor the top of the organisation
    assert unit.db.get(m.GRCDepartment, HELP).parent_department_id == SUP
    admin = as_(unit, ADMIN)
    assert admin.patch(f"/admin/departments/{HELP}", json={"parent_department_id": OPS}).status_code == 200
    assert sam.patch(f"/admin/departments/{HELP}", json={"name": "Helpdesk 2"}).status_code == 403          # it left what they manage
    assert admin.patch(f"/admin/departments/{HELP}", json={"parent_department_id": SUP}).status_code == 200
    assert sam.patch(f"/admin/departments/{HELP}", json={"name": "Helpdesk 2"}).status_code == 200


# ── the Directory API ────────────────────────────────────────────────────────
def test_the_directory_lists_every_unit_flat_in_tree_order_with_what_the_caller_may_do(unit):
    unit.http.app.include_router(departments_router)
    unit.db.add(m.GRCDepartmentMember(department_id=SUP, user_id=SAM, role="member"))
    unit.db.get(m.GRCDepartment, HELP).is_active = False
    unit.db.commit()
    grant(unit, SUP, "user", AUTHOR, "manage")
    r = as_(unit, ADMIN).get("/admin/departments/directory")
    assert r.status_code == 200
    body = r.json()
    assert body["levels"] == list(D.DEFAULT_LEVEL_LABELS) and body["max_depth"] == 3 and body["can_create_top"] is True
    assert [(n["id"], n["parent_id"], n["level"], n["level_label"]) for n in body["nodes"]] == [
        (FINANCE, None, 1, "Department"), (OPS, None, 1, "Department"), (SUP, OPS, 2, "Sub-department"), (HELP, SUP, 3, "Unit")]
    nodes = {n["id"]: n for n in body["nodes"]}
    assert set(nodes[OPS]) == {"id", "parent_id", "name", "code", "level", "level_label", "head", "is_active", "counts", "can_manage"}
    assert nodes[OPS]["head"] == {"id": HEAD, "name": "Otto Okta"} and nodes[SUP]["head"] is None
    assert nodes[HELP]["is_active"] is False and nodes[OPS]["is_active"] is True
    assert {i: n["counts"] for i, n in nodes.items()} == {                                                  # archived ones are left out (10 is under the Helpdesk)
        OPS: {"documents": 1, "documents_total": 5, "members": 1, "children": 1}, SUP: {"documents": 2, "documents_total": 4, "members": 1, "children": 1},
        HELP: {"documents": 2, "documents_total": 2, "members": 0, "children": 0}, FINANCE: {"documents": 2, "documents_total": 2, "members": 1, "children": 0}}
    assert all(n["can_manage"] for n in body["nodes"])                                                      # an administrator manages every unit
    # who manages what: a manager of Support, a person with a lower level, someone with nothing
    nodes = {n["id"]: n["can_manage"] for n in as_(unit, AUTHOR).get("/admin/departments/directory").json()["nodes"]}
    assert nodes == {FINANCE: False, OPS: False, SUP: True, HELP: True}
    assert as_(unit, AUTHOR).get("/admin/departments/directory").json()["can_create_top"] is False             # (a manager makes units under theirs)
    assert {n["can_manage"] for n in as_(unit, SAM).get("/admin/departments/directory").json()["nodes"]} == {False}
    # the caller's own reading limits the counts of documents (a plain person reads nothing of the units here)
    assert [n["counts"]["documents"] for n in as_(unit, SAM).get("/admin/departments/directory").json()["nodes"]] == [1, 0, 0, 0]       # Finance (his own draft) only


def test_access_says_who_has_a_way_in_and_why(unit):
    unit.http.app.include_router(departments_router)
    grant(unit, OPS, "role", READERS, "view")
    grant(unit, SUP, "user", OWNER, "edit")
    grant(unit, HELP, "role", READERS, "edit")
    grant(unit, HELP, "user", AUTHOR, "none")
    D.add_member(unit.db, unit.db.get(m.GRCDepartment, HELP), PUBLISHER, "member")
    unit.db.commit()
    r = as_(unit, PUBLISHER).get(f"/admin/departments/{HELP}/access")                                       # reading is open to anyone signed in
    assert r.status_code == 200
    body = r.json()
    assert body["department"] == {"id": HELP, "name": "Helpdesk", "code": "HELP", "level": 3, "level_label": "Unit", "parent_department_id": SUP,
                                  "path": ["Operations", "Support", "Helpdesk"], "head": None, "is_active": True}
    people = {p["name"]: p for p in body["people"]}
    assert list(people) == sorted(people, key=str.casefold) and set(people) == {"Sam Other", "Anna Author", "Olivia Owner", "Otto Okta", "Pat Publisher"}
    sam = people["Sam Other"]                                                                               # through the role, given on the Helpdesk itself
    assert (sam["how"], sam["via"], sam["level"], sam["can_remove"]) == (["grant"], ["Unit readers"], "edit", False)
    assert sam["level_from"] == {"department_id": HELP, "name": "Helpdesk", "inherited": False, "principal_type": "role", "principal_label": "Unit readers"}
    assert "through the role Unit readers" in sam["remove_blocked"] and sam["grant_id"] is None
    anna = people["Anna Author"]                                                                            # blocked as a person, not as a holder of the role
    assert (anna["level"], anna["how"]) == ("edit", ["grant"])
    olivia = people["Olivia Owner"]                                                                         # a person's grant on the unit above
    assert (olivia["level"], olivia["how"], olivia["can_remove"]) == ("edit", ["grant"], False)
    assert olivia["level_from"] == {"department_id": SUP, "name": "Support", "inherited": True, "principal_type": "user", "principal_label": "Olivia Owner"}
    assert "inherited from a unit above" in olivia["remove_blocked"]
    otto = people["Otto Okta"]                                                                              # the head of Operations, above this unit
    assert (otto["how"], otto["via"], otto["level"], otto["can_remove"]) == (["head"], ["Operations"], "view", False)
    assert otto["level_from"]["principal_type"] == "owner" and otto["level_from"]["inherited"] is True
    assert "owns Operations" in otto["remove_blocked"]
    pat = people["Pat Publisher"]                                                                           # added by hand: can be removed, no level
    assert (pat["how"], pat["level"], pat["can_remove"], pat["remove_blocked"], pat["level_from"]) == (["manual"], "none", True, None, None)
    assert [(g["principal_type"], g["principal_label"], g["level"]) for g in body["grants"]] == [("role", "Unit readers", "edit"), ("user", "Anna Author", "none")]
    assert [(g["from_name"], g["principal_label"], g["level"], g["overridden"]) for g in body["inherited_grants"]] == [
        ("Operations", "Unit readers", "view", True), ("Support", "Olivia Owner", "edit", False)]
    # a person with a grant of their own on the unit can be taken off it; one added by hand and given a grant too stays reachable
    grant(unit, HELP, "user", PUBLISHER, "view")
    pat = {p["name"]: p for p in as_(unit, PUBLISHER).get(f"/admin/departments/{HELP}/access").json()["people"]}["Pat Publisher"]
    assert (pat["how"], pat["level"], pat["can_remove"], pat["grant_id"] is not None) == (["manual", "grant"], "view", True, True)
    # a unit of its own: nothing inherited, nobody
    other = as_(unit, SAM).get(f"/admin/departments/{FINANCE}/access").json()
    assert [(p["name"], p["how"], p["level"]) for p in other["people"]] == [("Sia Sso", ["head"], "view")] and other["grants"] == [] and other["inherited_grants"] == []
    assert as_(unit, SAM).get("/admin/departments/9999/access").status_code == 404


def test_grants_are_given_changed_and_taken_back_through_the_api(unit):
    unit.http.app.include_router(departments_router)
    admin = as_(unit, ADMIN)
    put = lambda dept, **body: admin.put(f"/admin/departments/{dept}/grants", json=body)                    # noqa: E731
    r = put(OPS, principal_type="user", principal_id=SAM, level="view")
    assert r.status_code == 200 and r.json() == {"id": r.json()["id"], "principal_type": "user", "principal_id": SAM, "principal_label": "Sam Other", "level": "view"}
    first = r.json()["id"]
    r = put(OPS, principal_type="user", principal_id=SAM, level="edit")                                       # a row that exists takes the new level
    assert (r.status_code, r.json()["id"], r.json()["level"]) == (200, first, "edit") and unit.db.query(m.GRCDepartmentGrant).count() == 1
    assert put(SUP, principal_type="role", principal_id=READERS, level="manage").json()["principal_label"] == "Unit readers"
    assert unit.db.query(m.GRCDepartmentGrant).filter_by(created_by=ADMIN).count() == 2
    for body, code, words in [
            (dict(principal_type="team", principal_id=1, level="view"), 400, "person or a role"),
            (dict(principal_type="user", principal_id=SAM, level="owner"), 400, "none, view, edit, manage"),
            (dict(principal_type="user", principal_id=999, level="view"), 404, "does not exist"),
            (dict(principal_type="user", principal_id=CLOUD, level="view"), 400, "access review imported"),
            (dict(principal_type="role", principal_id=999, level="view"), 404, "does not exist"),
            (dict(principal_type="role", principal_id=CONNECTOR_ROLE, level="view"), 400, "connected system")]:
        r = put(OPS, **body)
        assert r.status_code == code and words in r.json()["detail"], (body, r.text)
    unit.db.get(m.GRCUser, EDITOR).is_active = False
    unit.db.commit()
    assert "not an active user" in put(OPS, principal_type="user", principal_id=EDITOR, level="view").json()["detail"]
    assert unit.db.query(m.GRCDepartmentGrant).count() == 2
    # taking a row off: a row of another department is not found
    other = unit.db.query(m.GRCDepartmentGrant).filter_by(department_id=SUP).one().id
    assert admin.delete(f"/admin/departments/{OPS}/grants/{other}").status_code == 404
    assert admin.delete(f"/admin/departments/{SUP}/grants/{other}").json() == {"message": "Access entry removed.", "id": other}
    assert admin.delete(f"/admin/departments/{SUP}/grants/{other}").status_code == 404
    assert [(g.department_id, g.level) for g in unit.db.query(m.GRCDepartmentGrant)] == [(OPS, "edit")]
    assert put(9999, principal_type="user", principal_id=SAM, level="view").status_code == 404


def test_a_manager_hands_out_access_under_their_own_unit_only(unit):
    unit.http.app.include_router(departments_router)
    grant(unit, SUP, "user", SAM, "manage")
    sam = as_(unit, SAM)
    assert as_(unit, SSO).get("/governance/documents/5").status_code == 403
    sam = as_(unit, SAM)
    assert sam.put(f"/admin/departments/{HELP}/grants", json={"principal_type": "user", "principal_id": SSO, "level": "edit"}).status_code == 200
    assert as_(unit, SSO).get("/governance/documents/5").status_code == 200                                  # the new editor reads the draft at once
    r = as_(unit, SAM).put(f"/admin/departments/{OPS}/grants", json={"principal_type": "user", "principal_id": SSO, "level": "none"})
    assert r.status_code == 403
    row = unit.db.query(m.GRCDepartmentGrant).filter_by(department_id=HELP).one()
    assert as_(unit, SAM).delete(f"/admin/departments/{HELP}/grants/{row.id}").status_code == 200


def test_the_picker_names_people_and_roles_a_grant_can_take(unit):
    unit.http.app.include_router(departments_router)
    grant(unit, SUP, "user", SAM, "view")
    admin = as_(unit, ADMIN)
    body = admin.get(f"/admin/departments/{SUP}/principals").json()
    assert {p["name"] for p in body["people"]} >= {"Sam Other", "Olivia Owner"} and "droplet-root" not in {p["name"] for p in body["people"]}   # an imported account is not offered
    assert {r["name"] for r in body["roles"]} >= {"Unit readers", "Document editors"} and "Okta: engineers" not in {r["name"] for r in body["roles"]}
    assert {p["name"]: p["granted"] for p in body["people"]}["Sam Other"] == "view" and {p["name"]: p["granted"] for p in body["people"]}["Olivia Owner"] is None
    found = admin.get(f"/admin/departments/{SUP}/principals", params={"q": "sam"}).json()
    assert [p["name"] for p in found["people"]] == ["Sam Other"] and found["roles"] == []
    assert [r["name"] for r in admin.get(f"/admin/departments/{SUP}/principals", params={"q": "readers"}).json()["roles"]] == ["Unit readers"]
    assert set(found["people"][0]) == {"id", "name", "email", "designation", "granted"}


def test_the_directory_reads_write_nothing_and_the_workflow_builder_knows_the_new_events(unit):
    from fastapi.routing import APIRoute

    from grc import feature_map
    from grc.main import app
    from grc.modules.workflow_engine.services import catalog as C
    from grc.modules.workflow_engine.services import route_events

    unit.http.app.include_router(departments_router)
    grant(unit, SUP, "user", SAM, "view")
    before = [sorted(map(tuple, unit.db.execute(text(f"SELECT * FROM {t}")).fetchall()), key=repr)
              for t in ("grc_department_grants", "grc_departments", "grc_department_members", "grc_teams", "grc_audit_logs")]
    http = as_(unit, ADMIN)
    for path in ("/admin/departments/directory", f"/admin/departments/{HELP}/access", f"/admin/departments/{HELP}/principals"):
        assert http.get(path).status_code == 200
    unit.db.expire_all()
    assert before == [sorted(map(tuple, unit.db.execute(text(f"SELECT * FROM {t}")).fetchall()), key=repr)
                      for t in ("grc_department_grants", "grc_departments", "grc_department_members", "grc_teams", "grc_audit_logs")]
    assert feature_map.place(None, f"/grc/admin/departments/{SUP}/grants") == ("Administration", "Departments")
    events = {key: eps for key, _label, _module, eps, _when in C.ENDPOINT_EVENT_TYPES}
    assert events["department_access_granted"] == ("admin_departments_router.set_department_grant",)
    assert events["department_access_removed"] == ("admin_departments_router.remove_department_grant",)
    live = {route_events.endpoint_id(r.endpoint.__module__, r.endpoint.__name__) for r in app.routes if isinstance(r, APIRoute)}
    assert {e for k in ("department_access_granted", "department_access_removed") for e in events[k]} <= live


# ── /auth/me and the roles ───────────────────────────────────────────────────
def test_the_menu_learns_the_levels_from_auth_me(unit):
    unit.http.app.include_router(auth_router)

    def me(uid):
        token = create_access_token({"sub": unit.db.get(m.GRCUser, uid).username, "tenant_slug": "cfsb", "tenant_id": 1})
        r = unit.http.get("/auth/me", headers={"Authorization": "Bearer " + token})
        assert r.status_code == 200
        return r.json()["user"]

    assert me(SAM)["unit_rights"] == {} and me(ADMIN)["unit_rights"] == {}
    grant(unit, OPS, "user", SAM, "view")
    grant(unit, HELP, "role", READERS, "manage")
    grant(unit, SUP, "user", SAM, "none")
    assert me(SAM)["unit_rights"] == {str(OPS): "view", str(HELP): "manage"}                                # only where there is a level; ids as keys
    assert me(AUTHOR)["unit_rights"] == {str(HELP): "manage"}
    assert me(SAM)["heads_department"] is False and me(SAM)["permissions"] == [] and me(SAM)["is_admin"] is False     # nothing else about their rights changed


def test_deleting_a_role_takes_its_grants_with_it(unit):
    grant(unit, OPS, "role", READERS, "manage")
    grant(unit, OPS, "user", SAM, "view")
    unit.db.query(m.UserRole).filter(m.UserRole.role_id == READERS).delete()
    unit.db.commit()
    import grc.routers.admin_router as admin_mod

    out = admin_mod.delete_role(role_id=READERS, user=unit.db.get(m.GRCUser, ADMIN), tenant_db=unit.db)
    assert out == {"message": "Role deleted successfully"}
    assert [(g.principal_type, g.principal_id) for g in unit.db.query(m.GRCDepartmentGrant)] == [("user", SAM)]


def test_a_lookup_costs_one_statement_when_nobody_granted_anything(unit):
    """Every document list asks (visible_filter, edit_filter, can_edit): it must stay one statement, whatever the library holds
    (tests/test_documents_lean.py holds the lists to a fixed number of statements)."""
    from sqlalchemy import event

    db, sam = unit.db, unit.db.get(m.GRCUser, SAM)
    engine, seen = db.get_bind(), []
    record = lambda *args: seen.append(args[2])                                                              # noqa: E731
    event.listen(engine, "before_cursor_execute", record)
    try:
        for ask in (lambda: R.levels_for(db, sam), lambda: R.level_of(db, sam, HELP), lambda: R.reach(db, sam),
                    lambda: R.at_least(db, sam, HELP, "edit"), lambda: R.unit_rights(db, sam)):
            seen.clear()
            ask()
            assert len(seen) == 1, seen
    finally:
        event.remove(engine, "before_cursor_execute", record)
