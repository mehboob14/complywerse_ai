"""Departments replace teams (DECISIONS D37): Administration → Departments (/admin/departments) with roles and hand-added members;
the Team rows other modules store become the departments' picker records; the documents' Department dropdown reads the same
departments. Over HTTP with real tokens on in-memory SQLite, on a session that does not flush by itself and with foreign keys on
(as Postgres does).

* who may read and who may change (a plain user reads, an administrator or a holder of admin:organization:edit changes);
* a department's people: added by hand, its head and the holders of its roles, once each, and never an inactive user, an account
  an access review imported or a role link a connector imported;
* the member endpoints and the sentence that says how to remove someone who belongs through a role;
* the picker record (create, rename, deactivate, adoption of a legacy team of the same name, long and clashing names);
* the legacy Teams API (linked teams are managed in Departments, unlinked ones work as before, a new team makes its department);
* sign-off and document permissions through a department (a role holder is asked and reads the draft);
* the vulnerability module (code optional, the picker follows, role holders are mailed);
* the backfill of teams into departments (additive, idempotent, nothing deleted);
* the documents' department checks and the Change log entry;
* a deleted role leaves no department role behind; GET endpoints write nothing.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.routers.admin_departments_router import router as departments_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402
from grc.routers.teams_router import router as teams_router  # noqa: E402
from grc.services import org_departments as D  # noqa: E402

(PLAIN, ADMIN, HOLDER, ANA, BOB, CARA, DAN, ARIF, HEADY, EVE) = range(1, 11)
ADMIN_ROLE, EDITORS, ANALYSTS, AUDITORS, DO_ROLE = 1, 2, 3, 4, 5

DEPARTMENT_KEYS = {"id", "tenant_id", "name", "code", "description", "parent_department_id", "parent_department_name",
                   "department_head_user_id", "department_head_name", "is_active", "roles", "member_count", "manual_member_count",
                   "team_id", "created_at", "updated_at"}
MEMBER_KEYS = {"user_id", "name", "email", "designation", "how", "member_role", "via_roles", "added_at"}
MANAGED = "This team is managed as a department. Change it in Administration → Departments."


@pytest.fixture(scope="module")
def _schema():
    """The whole schema, built once: a test copies it instead of building ~430 tables again."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def w(monkeypatch, _schema):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    _schema.raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    db = sessionmaker(bind=engine, autoflush=False)()
    now = datetime.utcnow()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    for uid, name, extra in [
        (PLAIN, "plain", {}), (ADMIN, "ada", {}), (HOLDER, "holder", {}), (ANA, "ana", {}), (BOB, "bob", {}), (CARA, "cara", {}),
        (DAN, "dan", {"is_active": False}),
        (ARIF, "arif", {"external_provider": "digitalocean", "external_id": "do:1", "access_synced_at": now}),   # an imported account
        (HEADY, "heady", {}), (EVE, "eve", {}),
    ]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title(), **extra))
    for rid, name in [(ADMIN_ROLE, "Administrator"), (EDITORS, "Organisation editors"), (ANALYSTS, "Analysts"), (AUDITORS, "Auditors"),
                      (DO_ROLE, "DigitalOcean: team My Team")]:
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    db.add(m.Role(id=9, tenant_id=2, name="Somebody else's role"))
    db.add(m.Permission(id=1, name="admin:organization:edit", resource="admin:organization", action="edit"))
    db.add(m.RolePermission(role_id=EDITORS, permission_id=1))
    for uid, rid, source in [(ADMIN, ADMIN_ROLE, None), (HOLDER, EDITORS, None),
                             (ANA, ANALYSTS, None), (BOB, ANALYSTS, "sso"),          # given by the platform: both count
                             (CARA, ANALYSTS, "okta"), (CARA, DO_ROLE, "digitalocean"),   # imported links give nothing
                             (DAN, ANALYSTS, None),                                  # deactivated
                             (ARIF, ANALYSTS, None), (ARIF, DO_ROLE, "digitalocean")]:   # an imported account
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=source))
    db.add(m.GRCDepartment(id=900, tenant_id=2, name="Elsewhere", code="ELSE", is_active=False))   # another organisation's (inactive, so the backfill leaves it)
    db.commit()

    app = FastAPI()
    app.include_router(departments_router)
    app.include_router(teams_router)
    app.dependency_overrides[m.get_db] = lambda: db

    def as_(uid):               # a client of its own, signed in as that person
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    yield SimpleNamespace(db=db, engine=engine, as_=as_, app=app)
    db.close()


def make(w, **body):
    """A department made through the API as an administrator."""
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Finance", **body})
    assert r.status_code == 201, r.text
    return r.json()


def detail(w, dept_id, as_user=ADMIN):
    r = w.as_(as_user).get(f"/admin/departments/{dept_id}")
    assert r.status_code == 200, r.text
    return r.json()


def people(w, dept_id):
    return {x["user_id"]: x for x in detail(w, dept_id)["members"]}


def add_roles(w, dept_id, *role_ids):
    r = w.as_(ADMIN).put(f"/admin/departments/{dept_id}/roles", json={"role_ids": list(role_ids)})
    assert r.status_code == 200, r.text
    return r.json()


# ── rights and shapes ────────────────────────────────────────────────────────

def test_a_plain_user_reads_departments_and_changes_nothing(w):
    d = make(w, name="Finance", role_ids=[ANALYSTS])
    before = [(x.id, x.name, x.is_active, x.department_head_user_id) for x in w.db.query(m.GRCDepartment)]
    http = w.as_(PLAIN)
    assert [x["name"] for x in http.get("/admin/departments").json()] == ["Finance"]
    assert http.get(f"/admin/departments/{d['id']}").status_code == 200
    writes = [("post", "/admin/departments", {"json": {"name": "Legal"}}),
              ("patch", f"/admin/departments/{d['id']}", {"json": {"name": "Money"}}),
              ("delete", f"/admin/departments/{d['id']}", {}),
              ("put", f"/admin/departments/{d['id']}/roles", {"json": {"role_ids": []}}),
              ("post", f"/admin/departments/{d['id']}/members", {"json": {"user_id": EVE}}),
              ("patch", f"/admin/departments/{d['id']}/members/{ANA}", {"json": {"role": "lead"}}),
              ("delete", f"/admin/departments/{d['id']}/members/{ANA}", {}),
              ("get", "/admin/departments/role-options", {})]
    for method, path, kw in writes:
        r = getattr(http, method)(path, **kw)
        assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), (method, path, r.text)
    w.db.expire_all()
    assert [(x.id, x.name, x.is_active, x.department_head_user_id) for x in w.db.query(m.GRCDepartment)] == before
    assert w.db.query(m.GRCDepartmentRole).count() == 1 and w.db.query(m.GRCDepartmentMember).count() == 0


@pytest.mark.parametrize("who", [ADMIN, HOLDER])
def test_an_administrator_or_a_holder_of_the_right_changes_departments(w, who):
    http = w.as_(who)
    r = http.post("/admin/departments", json={"name": "Finance", "description": "Money", "role_ids": [ANALYSTS],
                                              "department_head_user_id": HEADY})
    assert r.status_code == 201, r.text
    d = r.json()
    assert set(d) == DEPARTMENT_KEYS
    assert (d["name"], d["description"], d["is_active"], d["department_head_user_id"], d["department_head_name"]) == (
        "Finance", "Money", True, HEADY, "Heady")
    assert d["roles"] == [{"id": ANALYSTS, "name": "Analysts"}] and d["team_id"] is not None and d["code"] == "FINA"
    assert http.patch(f"/admin/departments/{d['id']}", json={"name": "Money"}).json()["name"] == "Money"
    assert http.put(f"/admin/departments/{d['id']}/roles", json={"role_ids": []}).json()["roles"] == []
    assert http.post(f"/admin/departments/{d['id']}/members", json={"user_id": EVE, "role": "lead"}).status_code == 201
    assert http.patch(f"/admin/departments/{d['id']}/members/{EVE}", json={"role": "member"}).status_code == 200
    assert http.delete(f"/admin/departments/{d['id']}/members/{EVE}").status_code == 200
    assert http.get("/admin/departments/role-options").status_code == 200
    gone = http.delete(f"/admin/departments/{d['id']}")
    assert (gone.status_code, gone.json()) == (200, {"message": gone.json()["message"], "id": d["id"]})
    assert w.db.get(m.GRCDepartment, d["id"]).is_active is False          # deactivated, never deleted


def test_the_list_and_the_detail_have_the_documented_shapes(w):
    parent = make(w, name="Operations")
    child = make(w, name="Support", parent_department_id=parent["id"], role_ids=[ANALYSTS], department_head_user_id=HEADY)
    w.as_(ADMIN).post(f"/admin/departments/{child['id']}/members", json={"user_id": EVE})
    rows = w.as_(PLAIN).get("/admin/departments").json()
    assert [r["name"] for r in rows] == ["Operations", "Support"] and all(set(r) == DEPARTMENT_KEYS for r in rows)
    s = next(r for r in rows if r["name"] == "Support")
    assert (s["parent_department_name"], s["member_count"], s["manual_member_count"]) == ("Operations", 4, 1)   # ana, bob, heady, eve
    d = detail(w, child["id"], as_user=PLAIN)
    assert set(d) == DEPARTMENT_KEYS | {"members", "sub_departments"} and all(set(x) == MEMBER_KEYS for x in d["members"])
    assert [x["name"] for x in d["members"]] == ["Ana", "Bob", "Eve", "Heady"]
    top = detail(w, parent["id"])
    assert top["sub_departments"] == [{"id": child["id"], "name": "Support", "code": "SUPP", "is_active": True}]
    assert w.as_(PLAIN).get("/admin/departments/9999").status_code == 404
    assert w.as_(PLAIN).get(f"/admin/departments/{900}").status_code == 404           # another organisation's


def test_inactive_departments_are_listed_only_when_asked(w):
    a, b = make(w, name="Finance"), make(w, name="Legal")
    w.as_(ADMIN).delete(f"/admin/departments/{b['id']}")
    assert [r["name"] for r in w.as_(PLAIN).get("/admin/departments").json()] == ["Finance"]
    every = w.as_(PLAIN).get("/admin/departments", params={"include_inactive": True}).json()
    assert [(r["name"], r["is_active"]) for r in every] == [("Finance", True), ("Legal", False)]
    assert w.as_(ADMIN).patch(f"/admin/departments/{b['id']}", json={"is_active": True}).json()["is_active"] is True
    assert a["id"] != b["id"]


def test_role_options_leave_out_connector_roles_and_count_platform_holders(w):
    rows = w.as_(ADMIN).get("/admin/departments/role-options").json()
    by_name = {r["name"]: r for r in rows}
    assert set(by_name["Analysts"]) == {"id", "name", "user_count"}
    assert by_name["Analysts"]["user_count"] == 2                      # ana and bob; not cara (imported link), dan (inactive), arif
    assert "DigitalOcean: team My Team" not in by_name                 # every link of it was imported by a connector
    assert by_name["Auditors"]["user_count"] == 0 and "Somebody else's role" not in by_name


# ── validation ───────────────────────────────────────────────────────────────

def test_a_department_needs_a_new_name_and_a_new_code(w):
    http = w.as_(ADMIN)
    assert make(w, name="Information Security")["code"] == "IS"
    assert make(w, name="Internal Services")["code"] == "IS2"            # the code is made from the name and kept unique
    assert make(w, name="Finance")["code"] == "FINA"
    assert make(w, name="Compliance", code="CMP-1")["code"] == "CMP-1"
    for body, words in [({"name": "  "}, "required"), ({"name": "information security"}, "already exists"),
                        ({"name": "X" * 300}, "too long"), ({"name": "Other", "code": "cmp-1"}, "code 'cmp-1'"),
                        ({"name": "Other", "code": "C" * 60}, "too long")]:
        r = http.post("/admin/departments", json=body)
        assert r.status_code == 400 and words in r.json()["detail"], (body, r.text)
    d = make(w, name="Legal")
    for body, words in [({"name": "finance"}, "already exists"), ({"code": "is"}, "code 'is'"), ({"name": ""}, "required")]:
        r = http.patch(f"/admin/departments/{d['id']}", json=body)
        assert r.status_code == 400 and words in r.json()["detail"], (body, r.text)
    assert http.patch(f"/admin/departments/{d['id']}", json={"name": "LEGAL", "code": "lgl"}).status_code == 200   # its own, case aside


def test_the_parent_exists_in_the_organisation_and_never_loops(w):
    http = w.as_(ADMIN)
    a = make(w, name="A")
    b = make(w, name="B", parent_department_id=a["id"])
    c = make(w, name="C", parent_department_id=b["id"])
    for parent in (9999, 900):                                                         # unknown; another organisation's
        r = http.post("/admin/departments", json={"name": "D", "parent_department_id": parent})
        assert r.status_code == 400 and "parent" in r.json()["detail"]
    for target, parent in [(a, a), (a, b), (a, c), (b, c)]:                            # itself, a child, a grandchild
        r = http.patch(f"/admin/departments/{target['id']}", json={"parent_department_id": parent["id"]})
        assert r.status_code == 400 and "under itself or under one of its own sub-departments" in r.json()["detail"], (target, parent)
    assert http.patch(f"/admin/departments/{c['id']}", json={"parent_department_id": a["id"]}).status_code == 200
    assert http.patch(f"/admin/departments/{c['id']}", json={"parent_department_id": None}).json()["parent_department_id"] is None


def test_a_head_is_an_active_user_of_the_platform_and_roles_exist_in_the_organisation(w):
    http = w.as_(ADMIN)
    for head, words in [(ARIF, "access review imported"), (DAN, "not an active user"), (9999, "does not exist")]:
        r = http.post("/admin/departments", json={"name": "Finance", "department_head_user_id": head})
        assert r.status_code == 400 and words in r.json()["detail"], (head, r.text)
    for roles in ([9999], [9]):                                                        # unknown; another organisation's
        r = http.post("/admin/departments", json={"name": "Finance", "role_ids": roles})
        assert r.status_code == 400 and "roles chosen does not exist" in r.json()["detail"]
    assert w.db.query(m.GRCDepartment).filter_by(tenant_id=1).count() == 0 and w.db.query(m.Team).count() == 0   # nothing half made
    d = make(w, department_head_user_id=HEADY)
    r = http.patch(f"/admin/departments/{d['id']}", json={"name": "Money", "department_head_user_id": ARIF})
    assert r.status_code == 400
    w.db.expire_all()
    assert w.db.get(m.GRCDepartment, d["id"]).name == "Finance"                        # a refused change changes nothing
    w.db.get(m.GRCUser, HEADY).is_active = False                                        # a head already named may stay
    w.db.commit()
    assert http.patch(f"/admin/departments/{d['id']}", json={"name": "Money", "department_head_user_id": HEADY}).status_code == 200


# ── who is in a department ───────────────────────────────────────────────────

def test_holders_of_a_departments_roles_belong_to_it_but_not_who_does_not_count(w):
    d = make(w, name="Analytics", role_ids=[ANALYSTS])
    members = people(w, d["id"])
    assert set(members) == {ANA, BOB}                              # not cara (a connector's link), dan (inactive), arif (imported)
    assert members[ANA]["how"] == ["role"] and members[ANA]["via_roles"] == ["Analysts"] and members[ANA]["member_role"] is None
    assert members[ANA]["added_at"] is None and members[ANA]["email"] == "ana@acme.test"
    assert detail(w, d["id"])["member_count"] == 2
    # the person loses the role: gone at once; gains it: back
    link = w.db.query(m.UserRole).filter_by(user_id=ANA, role_id=ANALYSTS).one()
    w.db.delete(link)
    w.db.commit()
    assert set(people(w, d["id"])) == {BOB}
    w.db.add(m.UserRole(user_id=ANA, role_id=ANALYSTS, tenant_id=1))
    w.db.commit()
    assert set(people(w, d["id"])) == {ANA, BOB}
    # the department loses the role
    add_roles(w, d["id"])
    assert people(w, d["id"]) == {}
    add_roles(w, d["id"], ANALYSTS, AUDITORS)
    assert set(people(w, d["id"])) == {ANA, BOB}


def test_someone_by_hand_a_head_and_a_role_holder_is_one_person_counted_once(w):
    d = make(w, name="Analytics", role_ids=[ANALYSTS], department_head_user_id=ANA)
    http = w.as_(ADMIN)
    http.post(f"/admin/departments/{d['id']}/members", json={"user_id": BOB, "role": "lead"})
    http.post(f"/admin/departments/{d['id']}/members", json={"user_id": ANA})
    http.post(f"/admin/departments/{d['id']}/members", json={"user_id": EVE, "role": "viewer"})
    members = people(w, d["id"])
    assert set(members) == {ANA, BOB, EVE}
    assert members[ANA]["how"] == ["head", "manual", "role"] and members[ANA]["member_role"] == "member"
    assert members[BOB]["how"] == ["manual", "role"] and members[BOB]["member_role"] == "lead"
    assert members[EVE]["how"] == ["manual"] and members[EVE]["via_roles"] == [] and members[EVE]["member_role"] == "viewer"
    d = detail(w, d["id"])
    assert (d["member_count"], d["manual_member_count"]) == (3, 3)
    only_head = make(w, name="Board", department_head_user_id=HEADY)
    assert people(w, only_head["id"])[HEADY]["how"] == ["head"] and detail(w, only_head["id"])["member_count"] == 1
    assert detail(w, only_head["id"])["manual_member_count"] == 0


def test_an_inactive_or_imported_person_added_by_hand_counts_for_nobody(w):
    d = make(w, name="Finance")
    now = datetime.utcnow()
    for uid in (DAN, ARIF):                              # rows that an older write, or a later change, left behind
        w.db.add(m.GRCDepartmentMember(department_id=d["id"], user_id=uid, role="member", is_active=True, added_at=now))
    w.db.commit()
    assert people(w, d["id"]) == {}
    assert D.effective_member_ids(w.db, w.db.get(m.GRCDepartment, d["id"])) == set()
    w.db.get(m.GRCUser, DAN).is_active = True
    w.db.commit()
    assert set(people(w, d["id"])) == {DAN}


# ── members added by hand ────────────────────────────────────────────────────

def test_people_are_added_by_hand_with_a_role_and_taken_out_again(w):
    d = make(w, name="Finance")
    http, base = w.as_(ADMIN), f"/admin/departments/{d['id']}/members"
    r = http.post(base, json={"user_id": EVE, "role": "viewer"})
    assert r.status_code == 201 and set(r.json()) == MEMBER_KEYS
    assert (r.json()["how"], r.json()["member_role"]) == (["manual"], "viewer")
    assert http.post(base, json={"user_id": EVE, "role": "lead"}).json()["member_role"] == "lead"      # again: the role is updated
    assert http.post(base, json={"user_id": EVE}).json()["member_role"] == "member"                    # no role: member
    assert w.db.query(m.GRCDepartmentMember).filter_by(department_id=d["id"], user_id=EVE).count() == 1
    assert http.patch(f"{base}/{EVE}", json={"role": "viewer"}).json()["member_role"] == "viewer"
    for body, code, words in [({"user_id": EVE, "role": "boss"}, 400, "must be one of: lead, member, viewer"),
                              ({"user_id": ARIF}, 400, "access review imported"), ({"user_id": DAN}, 400, "not an active user"),
                              ({"user_id": 9999}, 404, "User not found")]:
        r = http.post(base, json=body)
        assert r.status_code == code and words in r.json()["detail"], (body, r.text)
    assert http.patch(f"{base}/{EVE}", json={"role": "boss"}).status_code == 400
    assert http.patch(f"{base}/{ANA}", json={"role": "lead"}).status_code == 404                       # not added by hand
    gone = http.delete(f"{base}/{EVE}")
    assert gone.status_code == 200 and gone.json()["id"] == EVE
    assert people(w, d["id"]) == {}
    row = w.db.query(m.GRCDepartmentMember).filter_by(department_id=d["id"], user_id=EVE).one()
    assert row.is_active is False                                       # soft: the row stays
    assert http.delete(f"{base}/{EVE}").status_code == 404 and http.patch(f"{base}/{EVE}", json={"role": "lead"}).status_code == 404
    back = http.post(base, json={"user_id": EVE, "role": "lead"})       # a removed person comes back
    assert back.status_code == 201 and back.json()["member_role"] == "lead"
    assert w.db.query(m.GRCDepartmentMember).filter_by(department_id=d["id"], user_id=EVE).count() == 1


def test_someone_who_belongs_through_a_role_or_as_head_is_not_removed_as_a_member(w):
    d = make(w, name="Analytics", role_ids=[ANALYSTS], department_head_user_id=HEADY)
    http, base = w.as_(ADMIN), f"/admin/departments/{d['id']}/members"
    r = http.delete(f"{base}/{ANA}")
    assert r.status_code == 409
    assert r.json()["detail"] == ("Ana belongs to this department through the role Analysts; remove the role from the department "
                                  "or from the person.")
    r = http.delete(f"{base}/{HEADY}")
    assert r.status_code == 409 and r.json()["detail"] == "Heady is the head of this department; choose another head first."
    assert http.delete(f"{base}/{EVE}").status_code == 404
    http.post(base, json={"user_id": BOB})                                # by hand and through the role: the hand-made row goes
    r = http.delete(f"{base}/{BOB}")
    assert r.status_code == 200 and "through the role Analysts" in r.json()["message"]
    assert people(w, d["id"])[BOB]["how"] == ["role"]


# ── the picker record ────────────────────────────────────────────────────────

def test_a_department_has_a_team_that_follows_it(w):
    d = make(w, name="Payments", description="Cards", department_head_user_id=HEADY)
    team = w.db.get(m.Team, d["team_id"])
    assert (team.name, team.description, team.lead_user_id, team.is_active, team.department_id, team.tenant_id) == (
        "Payments", "Cards", HEADY, True, d["id"], 1)
    http = w.as_(ADMIN)
    http.patch(f"/admin/departments/{d['id']}", json={"name": "Payment Services", "description": None, "department_head_user_id": EVE})
    w.db.expire_all()
    assert (team.name, team.description, team.lead_user_id) == ("Payment Services", None, EVE)
    assert w.db.query(m.Team).count() == 1                                          # renamed, not duplicated
    http.delete(f"/admin/departments/{d['id']}")
    w.db.expire_all()
    assert team.is_active is False
    assert [t["name"] for t in w.as_(PLAIN).get("/admin/teams").json()] == []        # not offered any more
    assert [t["name"] for t in w.as_(PLAIN).get("/admin/teams", params={"include_inactive": True}).json()] == ["Payment Services"]
    http.patch(f"/admin/departments/{d['id']}", json={"is_active": True})
    w.db.expire_all()
    assert team.is_active is True and team.id == d["team_id"]                         # the same id other records store


def test_a_legacy_team_of_the_same_name_is_taken_over_with_its_people(w):
    legacy = m.Team(id=70, tenant_id=1, name="payments ", lead_user_id=EVE)
    w.db.add(legacy)
    w.db.add(m.TeamMember(team_id=70, user_id=ANA, role_in_team="member", added_by=HOLDER, added_at=datetime(2026, 1, 2)))
    w.db.add(m.TeamMember(team_id=70, user_id=BOB, role_in_team="lead"))
    w.db.commit()
    d = make(w, name="Payments")
    assert d["team_id"] == 70 and w.db.query(m.Team).count() == 1                      # adopted, not a second team
    team = w.db.get(m.Team, 70)
    assert (team.name, team.department_id) == ("Payments", d["id"])
    members = people(w, d["id"])
    assert set(members) == {ANA, BOB, EVE}                                            # nobody dropped out: the lead too
    assert (members[ANA]["member_role"], members[BOB]["member_role"], members[EVE]["member_role"]) == ("member", "lead", "lead")
    assert members[ANA]["added_at"] == "2026-01-02T00:00:00"
    row = w.db.query(m.GRCDepartmentMember).filter_by(department_id=d["id"], user_id=ANA).one()
    assert row.added_by == HOLDER
    assert w.db.query(m.TeamMember).filter_by(team_id=70).count() == 2                  # the legacy rows are left in place


def test_long_and_clashing_team_names_stay_valid(w):
    long = "Corporate Governance, Risk, Compliance and Regulatory Affairs Division for the Whole Group of Companies " * 2
    a = make(w, name=long.strip())
    b = make(w, name=long.strip() + " (Karachi)")                                    # the first 100 characters are the same
    names = [w.db.get(m.Team, x["team_id"]).name for x in (a, b)]
    assert all(len(n) <= 100 for n in names) and names[0] != names[1]
    assert names[0] == long.strip()[:100].rstrip() and names[1].endswith(" (2)")
    assert w.db.get(m.GRCDepartment, a["id"]).name == long.strip()                    # the department keeps its full name
    c = make(w, name=long.strip() + " (Lahore)")
    assert w.db.get(m.Team, c["team_id"]).name.endswith(" (3)") and len(w.db.get(m.Team, c["team_id"]).name) <= 100
    assert len({t.name.casefold() for t in w.db.query(m.Team)}) == w.db.query(m.Team).count()      # no two teams share a name


# ── the Teams API ────────────────────────────────────────────────────────────

def test_a_team_that_is_a_department_is_managed_there(w):
    d = make(w, name="Analytics", role_ids=[ANALYSTS], department_head_user_id=HEADY)
    w.as_(ADMIN).post(f"/admin/departments/{d['id']}/members", json={"user_id": EVE, "role": "viewer"})
    http, tid = w.as_(ADMIN), d["team_id"]
    for method, path, kw in [("patch", f"/admin/teams/{tid}", {"json": {"name": "Other"}}), ("delete", f"/admin/teams/{tid}", {}),
                             ("post", f"/admin/teams/{tid}/members", {"json": {"user_id": ANA}}),
                             ("patch", f"/admin/teams/{tid}/members/{EVE}", {"json": {"role_in_team": "lead"}}),
                             ("delete", f"/admin/teams/{tid}/members/{EVE}", {})]:
        r = getattr(http, method)(path, **kw)
        assert (r.status_code, r.json()["detail"]) == (409, MANAGED), (method, path, r.text)
    r = w.as_(PLAIN).get(f"/admin/teams/{tid}")
    assert r.status_code == 200
    team = r.json()
    assert (team["department_id"], team["member_count"], team["name"], team["lead_user_id"]) == (d["id"], 4, "Analytics", HEADY)
    assert sorted((x["user_display_name"], x["role_in_team"]) for x in team["members"]) == [
        ("Ana", "member"), ("Bob", "member"), ("Eve", "viewer"), ("Heady", "member")]
    assert all(set(x) == {"id", "user_id", "user_display_name", "user_email", "role_in_team", "added_at"} for x in team["members"])
    assert [x["user_id"] for x in w.as_(PLAIN).get(f"/admin/teams/{tid}/members").json()] == [ANA, BOB, EVE, HEADY]
    listed = w.as_(PLAIN).get("/admin/teams").json()
    assert [(t["name"], t["member_count"], t["department_id"]) for t in listed] == [("Analytics", 4, d["id"])]
    assert w.db.get(m.Team, tid).name == "Analytics" and w.db.query(m.GRCDepartmentRole).count() == 1     # nothing changed


def test_a_team_with_no_department_works_as_it_always_did(w):
    w.db.add(m.Team(id=50, tenant_id=1, name="Legacy"))
    w.db.add(m.TeamMember(id=5, team_id=50, user_id=ANA, role_in_team="member"))
    w.db.commit()
    http = w.as_(ADMIN)
    team = w.as_(PLAIN).get("/admin/teams/50").json()
    assert (team["department_id"], team["member_count"], [x["user_id"] for x in team["members"]]) == (None, 1, [ANA])
    assert http.patch("/admin/teams/50", json={"name": "Legacy 2"}).json()["name"] == "Legacy 2"
    assert http.post("/admin/teams/50/members", json={"user_id": BOB, "role_in_team": "lead"}).status_code == 201
    assert http.patch("/admin/teams/50/members/5", json={"role_in_team": "viewer"}).json()["role_in_team"] == "viewer"
    assert http.delete("/admin/teams/50/members/5").status_code == 204
    assert w.as_(PLAIN).get("/admin/teams/50").json()["member_count"] == 1
    assert http.delete("/admin/teams/50").status_code == 204
    assert w.db.query(m.GRCDepartment).filter_by(tenant_id=1).count() == 0            # none of it made a department


def test_a_new_team_makes_its_department(w):
    r = w.as_(ADMIN).post("/admin/teams", json={"name": "Identity", "description": "Sign-in", "lead_user_id": HEADY})
    assert r.status_code == 201, r.text
    team = r.json()
    dept = w.db.query(m.GRCDepartment).filter_by(name="Identity").one()
    assert (team["department_id"], team["lead_user_id"], team["member_count"], team["description"]) == (dept.id, HEADY, 1, "Sign-in")
    assert (dept.department_head_user_id, dept.code, dept.description, dept.is_active) == (HEADY, "IDEN", "Sign-in", True)
    assert w.db.get(m.Team, team["id"]).department_id == dept.id
    assert [x["name"] for x in w.as_(PLAIN).get("/admin/departments").json()] == ["Identity"]
    again = w.as_(ADMIN).post("/admin/teams", json={"name": "Identity"})
    assert again.status_code == 400 and again.json()["detail"] == "A team named 'Identity' already exists."
    assert w.as_(ADMIN).post("/admin/teams", json={"name": "Risk", "lead_user_id": ARIF}).status_code == 400    # an imported lead
    assert w.db.query(m.GRCDepartment).filter_by(tenant_id=1).count() == 1 and w.db.query(m.Team).count() == 1
    assert w.as_(PLAIN).post("/admin/teams", json={"name": "Nope"}).status_code == 403


# ── sign-off and document permissions ────────────────────────────────────────

def _draft_for(w, team_id, kind="reviewer", status="pending_review"):
    w.db.add(m.GovernanceDocument(id=60, tenant_id=1, title="Access policy", doc_type="policy", status=status, current_version="1.0",
                                  owner_id=PLAIN, author_id=PLAIN))
    w.db.flush()                    # the document first: foreign keys are on and there is no relationship to order them
    w.db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=60, role_type=kind, target_type="team", target_id=team_id))
    w.db.commit()
    return w.db.get(m.GovernanceDocument, 60)


def test_a_department_asked_to_review_asks_its_people_and_opens_the_draft_to_them(w):
    from grc.modules.governance import permissions as P
    from grc.modules.governance.routers import document_signoff as S

    d = make(w, name="Reviewers", role_ids=[ANALYSTS], department_head_user_id=HEADY)
    w.as_(ADMIN).post(f"/admin/departments/{d['id']}/members", json={"user_id": EVE})
    doc = _draft_for(w, d["team_id"])
    user = lambda uid: w.db.get(m.GRCUser, uid)                                    # noqa: E731
    asked = {ANA, BOB, HEADY, EVE}
    assert S._resolve_target_users(w.db, [1], "team", d["team_id"]) == asked
    for uid in (ANA, BOB, HEADY, EVE):                                             # a role holder, the head, a hand-made member
        assert P.participant(w.db, user(uid), doc.id) is True and P.can_read(w.db, user(uid), doc) is True, uid
        assert S._step(w.db, doc, uid) is not None, uid                             # and each may sign
    for uid in (CARA, ADMIN, HOLDER):                                               # not who does not count, nor everyone else
        assert P.participant(w.db, user(uid), doc.id) is False, uid
    assert [S._step(w.db, doc, uid) for uid in (CARA, DAN, ARIF)] == [None, None, None]     # nor an inactive or imported account
    assert sorted(i for (i,) in w.db.execute(P.asked_ids(w.db, user(ANA)))) == [doc.id]
    # the person loses the role: no longer asked, and no longer reads it
    w.db.delete(w.db.query(m.UserRole).filter_by(user_id=ANA, role_id=ANALYSTS).one())
    w.db.commit()
    assert P.participant(w.db, user(ANA), doc.id) is False and S._step(w.db, doc, ANA) is None
    # the picker offers the department with the people it would ask, and the document names it a department
    targets = S.signoff_targets(w.db, [1])
    assert targets["teams"] == [{"id": d["team_id"], "name": "Reviewers", "member_count": 3}]
    assert S._target_display(w.db, "team", d["team_id"]) == "Department: Reviewers"
    assert S._target_display(w.db, "team", 4242) == "Department #4242"


def test_a_department_nobody_in_can_sign_is_told_so(w):
    from grc.modules.governance.routers import document_signoff as S

    d = make(w, name="Ghosts")
    now = datetime.utcnow()
    w.db.add(m.GRCDepartmentMember(department_id=d["id"], user_id=DAN, role="member", is_active=True, added_at=now))
    w.db.commit()
    doc = _draft_for(w, d["team_id"], kind="approver", status="pending_approval")
    assert S.nobody_can_sign(w.db, doc) == ["Nobody in Ghosts can sign it; choose other approvers."]
    assert S.signoff_targets(w.db, [1])["teams"][0]["member_count"] == 0


def test_a_legacy_team_is_still_asked_as_before(w):
    from grc.modules.governance import permissions as P
    from grc.modules.governance.routers import document_signoff as S

    w.db.add(m.Team(id=40, tenant_id=1, name="Policy team", lead_user_id=EVE))
    w.db.add(m.TeamMember(team_id=40, user_id=ANA))
    w.db.add(m.TeamMember(team_id=40, user_id=ARIF))                              # an imported member
    w.db.commit()
    doc = _draft_for(w, 40)
    assert S._resolve_target_users(w.db, [1], "team", 40) == {ANA, EVE}
    user = lambda uid: w.db.get(m.GRCUser, uid)                                    # noqa: E731
    assert [P.participant(w.db, user(uid), doc.id) for uid in (ANA, EVE, BOB)] == [True, True, False]
    assert S._step(w.db, doc, ARIF) is None                                       # an imported account is never asked
    assert S.signoff_targets(w.db, [1])["teams"] == [{"id": 40, "name": "Policy team", "member_count": 2}]


# ── what the screens send: only the changed fields, nulls to clear ───────────

def test_a_change_sends_only_the_fields_it_changes_and_a_null_clears(w):
    http = w.as_(ADMIN)
    parent = make(w, name="Operations")
    d = make(w, name="Support", description="Help desk", parent_department_id=parent["id"], department_head_user_id=HEADY,
             role_ids=[ANALYSTS])
    base = f"/admin/departments/{d['id']}"
    team = w.db.get(m.Team, d["team_id"])
    same = {k: d[k] for k in ("name", "code", "description", "parent_department_id", "department_head_user_id", "is_active")}

    def now():
        w.db.expire_all()
        r = w.as_(PLAIN).get(base).json()
        return {k: r[k] for k in same}, [x["id"] for x in r["roles"]]

    assert http.patch(base, json={}).status_code == 200 and now() == (same, [ANALYSTS])            # nothing sent: nothing changes
    assert http.patch(base, json={"name": "Help"}).json()["name"] == "Help"
    assert now()[0] == {**same, "name": "Help"}                                                    # the rest is as it was
    assert http.patch(base, json={"parent_department_id": None}).json()["parent_department_id"] is None
    assert now()[0] == {**same, "name": "Help", "parent_department_id": None}
    cleared = http.patch(base, json={"department_head_user_id": None}).json()
    assert (cleared["department_head_user_id"], cleared["department_head_name"]) == (None, None)
    w.db.expire_all()
    assert team.lead_user_id is None                                                               # the picker record lost its lead too
    assert now()[0] == {**same, "name": "Help", "parent_department_id": None, "department_head_user_id": None}
    for empty in ("", None, "   "):                                                                # a blank description clears it
        http.patch(base, json={"description": "Again"})
        assert http.patch(base, json={"description": empty}).json()["description"] is None, empty
    assert now()[1] == [ANALYSTS]                                                                  # roles were never named: kept
    assert http.patch(base, json={"role_ids": []}).json()["roles"] == [] and now()[1] == []
    assert http.patch(base, json={"is_active": False}).json()["is_active"] is False
    assert now()[0]["name"] == "Help"
    back = http.patch(base, json={"department_head_user_id": HEADY, "parent_department_id": parent["id"]}).json()
    assert (back["department_head_user_id"], back["parent_department_id"]) == (HEADY, parent["id"])


def test_a_head_who_is_also_added_by_hand_is_one_person_lead_and_member(w):
    d = make(w, name="Board", department_head_user_id=HEADY)
    w.as_(ADMIN).post(f"/admin/departments/{d['id']}/members", json={"user_id": HEADY, "role": "lead"})
    member = people(w, d["id"])[HEADY]
    assert (member["how"], member["member_role"], member["via_roles"]) == (["head", "manual"], "lead", [])
    assert detail(w, d["id"])["member_count"] == 1
    r = w.as_(ADMIN).delete(f"/admin/departments/{d['id']}/members/{HEADY}")          # the hand-made row goes, the head stays
    assert r.status_code == 200 and "head of this department" in r.json()["message"]
    assert people(w, d["id"])[HEADY]["how"] == ["head"]


# ── the vulnerability module ─────────────────────────────────────────────────

@pytest.fixture
def vuln(w):
    from grc.modules.vuln_management.router import router as vuln_router

    app = FastAPI()
    app.include_router(vuln_router)
    app.dependency_overrides[m.get_db] = lambda: w.db

    def as_(uid):
        token = create_access_token({"sub": w.db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    w.vuln = as_
    return w


def test_a_department_made_in_the_vulnerability_module_needs_no_code_and_has_its_team(vuln):
    http = vuln.vuln(ADMIN)
    r = http.post("/vuln-management/departments", json={"name": "Legal"})                # the form used to give 422 without a code
    assert r.status_code == 201 and r.json()["code"] == "LEGA"
    dept = vuln.db.get(m.GRCDepartment, r.json()["id"])
    team = vuln.db.query(m.Team).filter_by(department_id=dept.id).one()
    assert (team.name, team.is_active, team.tenant_id) == ("Legal", True, 1)
    assert http.post("/vuln-management/departments", json={"name": "Legal Two", "code": "LEGA"}).status_code == 400   # as before
    assert http.post("/vuln-management/departments", json={"name": "Compliance", "code": "CMP"}).json()["code"] == "CMP"
    r = http.put(f"/vuln-management/departments/{dept.id}", json={"name": "Legal Affairs", "department_head_user_id": HEADY})
    assert r.status_code == 200
    vuln.db.expire_all()
    assert (team.name, team.lead_user_id) == ("Legal Affairs", HEADY)                    # the picker record follows
    assert http.post(f"/vuln-management/departments/{dept.id}/members", json={"user_id": EVE, "role": "lead"}).status_code == 201
    assert [x["name"] for x in vuln.as_(PLAIN).get("/admin/departments").json()][:2] == ["Compliance", "Legal Affairs"]
    assert vuln.as_(PLAIN).get(f"/admin/teams/{team.id}").json()["member_count"] == 2             # eve by hand, heady the head
    assert http.delete(f"/vuln-management/departments/{dept.id}/members/{EVE}").status_code == 200
    assert http.delete(f"/vuln-management/departments/{dept.id}").status_code == 200
    vuln.db.expire_all()
    assert team.is_active is False and vuln.db.query(m.Team).filter_by(department_id=dept.id).count() == 1


def _mail_world(vuln, monkeypatch):
    """A department with the Analysts role (ana and bob hold it, fred too) and people added by hand: eve (mail on), heady (mail off),
    bob (on: he is also in the role) and ana (off: she is also in the role)."""
    from grc.modules.vuln_management.services.email_service import EmailService

    sent = []
    monkeypatch.setattr(EmailService, "send_assignment_notification", lambda **kw: sent.append(kw["recipient_email"]) or True)
    vuln.db.add(m.GRCUser(id=11, username="fred", email="fred@acme.test", display_name="Fred"))
    vuln.db.add(m.UserRole(user_id=11, role_id=ANALYSTS, tenant_id=1))
    for n in (1, 2):
        vuln.db.add(m.Vulnerability(id=n, tenant_id=1, vuln_id=f"V-{n}", title=f"Finding {n}", severity="high"))
    vuln.db.commit()
    roles = make(vuln, name="Security", role_ids=[ANALYSTS])
    plain = make(vuln, name="Plain")
    for dept, uid, mail in [(roles["id"], EVE, True), (roles["id"], HEADY, False), (roles["id"], BOB, True), (roles["id"], ANA, False),
                            (plain["id"], EVE, True), (plain["id"], HEADY, False)]:
        vuln.db.add(m.GRCDepartmentMember(department_id=dept, user_id=uid, role="member", is_active=True, added_at=datetime.utcnow(),
                                          email_notifications_enabled=mail))
    vuln.db.commit()
    return sent, roles, plain


def test_assigning_a_vulnerability_mails_the_departments_role_holders_once_each(vuln, monkeypatch):
    sent, roles, plain = _mail_world(vuln, monkeypatch)
    http = vuln.vuln(PLAIN)
    r = http.post("/vuln-management/vulnerabilities/1/assign-department", json={"department_id": roles["id"]})
    assert r.status_code == 201 and r.json()["notification_sent"] is True
    # eve and bob by hand (as before); fred through the role. Not heady or ana (their own choice), not cara (a connector's link),
    # dan (inactive) or arif (imported); bob once, though he is in both lists
    assert sorted(sent) == ["bob@acme.test", "eve@acme.test", "fred@acme.test"]
    sent.clear()
    r = http.post("/vuln-management/vulnerabilities/1/assign-department", json={"department_id": plain["id"]})
    assert r.status_code == 201 and sent == ["eve@acme.test"]                              # a department with no roles: as before


def test_assigning_vulnerabilities_in_bulk_mails_the_role_holders_for_each(vuln, monkeypatch):
    sent, roles, plain = _mail_world(vuln, monkeypatch)
    http = vuln.vuln(PLAIN)
    r = http.post("/vuln-management/vulnerabilities/bulk-assign", json={"vulnerability_ids": [1, 2], "department_id": roles["id"]})
    assert r.status_code == 200 and r.json()["success_count"] == 2
    assert sorted(sent) == ["bob@acme.test"] * 2 + ["eve@acme.test"] * 2 + ["fred@acme.test"] * 2
    sent.clear()
    r = http.post("/vuln-management/vulnerabilities/bulk-assign", json={"vulnerability_ids": [1, 2], "department_id": plain["id"]})
    assert r.status_code == 200 and sent == ["eve@acme.test"] * 2
    assert all(a.notification_sent for a in vuln.db.query(m.GRCVulnerabilityDepartmentAssignment))


# ── teams become departments ─────────────────────────────────────────────────

def _team(db, tid, name, lead=None, active=True, members=(), description=None, when=None):
    db.add(m.Team(id=tid, tenant_id=1, name=name, lead_user_id=lead, is_active=active, description=description))
    db.flush()
    for uid, role, by in members:
        db.add(m.TeamMember(team_id=tid, user_id=uid, role_in_team=role, added_by=by, added_at=when or datetime(2026, 3, 1)))
    db.commit()


def _members_of(db, dept_id):
    return {r.user_id: (r.role, r.is_active, r.added_by, r.added_at) for r in db.query(m.GRCDepartmentMember).filter_by(department_id=dept_id)}


def test_every_team_becomes_a_department_with_its_people_and_nothing_is_deleted(w):
    db = w.db
    _team(db, 21, "Payments", lead=BOB, description="Cards and wallets", when=datetime(2026, 3, 1),
          members=[(ANA, "member", HOLDER), (CARA, "lead", None), (EVE, "viewer", ADMIN)])
    _team(db, 22, "Identity", lead=None, active=False)
    counts = D.backfill(db)
    assert counts == {"teams_linked": 2, "departments_created": 2, "members_copied": 3, "pickers_created": 0, "skipped": 0}
    pay = db.query(m.GRCDepartment).filter_by(name="Payments").one()
    assert (pay.tenant_id, pay.code, pay.description, pay.department_head_user_id, pay.is_active) == (1, "PAYM", "Cards and wallets", BOB, True)
    assert _members_of(db, pay.id) == {ANA: ("member", True, HOLDER, datetime(2026, 3, 1)), CARA: ("lead", True, None, datetime(2026, 3, 1)),
                                       EVE: ("viewer", True, ADMIN, datetime(2026, 3, 1))}
    ident = db.query(m.GRCDepartment).filter_by(name="Identity").one()
    assert (ident.is_active, ident.department_head_user_id, ident.code) == (False, None, "IDEN")
    assert [(t.id, t.name, t.department_id) for t in db.query(m.Team).order_by(m.Team.id)] == [(21, "Payments", pay.id), (22, "Identity", ident.id)]
    assert db.get(m.Team, 22).is_active is False
    assert db.query(m.TeamMember).filter_by(team_id=21).count() == 3                       # the legacy rows stay where they were
    # the people the team asks are the same as before (the head counts as a member now, as the lead always did)
    assert D.team_member_ids(db, db.get(m.Team, 21)) == {ANA, BOB, CARA, EVE} == D.effective_member_ids(db, pay)
    # a second run finds nothing to do and changes nothing
    snapshot = ([(d.id, d.name, d.code) for d in db.query(m.GRCDepartment).order_by(m.GRCDepartment.id)], _members_of(db, pay.id), db.query(m.Team).count())
    assert D.backfill(db) == {"teams_linked": 0, "departments_created": 0, "members_copied": 0, "pickers_created": 0, "skipped": 0}
    assert snapshot == ([(d.id, d.name, d.code) for d in db.query(m.GRCDepartment).order_by(m.GRCDepartment.id)], _members_of(db, pay.id),
                        db.query(m.Team).count())


def test_a_team_joins_the_department_of_its_name_and_keeps_everyone_in_it(w):
    db = w.db
    boss = make(w, name="Finance", department_head_user_id=HEADY)
    db.get(m.Team, boss["team_id"]).department_id = None                                  # as if its picker record were not made yet
    db.delete(db.get(m.Team, boss["team_id"]))
    db.commit()
    db.add(m.GRCDepartmentMember(department_id=boss["id"], user_id=EVE, role="lead", is_active=False, added_at=datetime(2026, 1, 1)))
    db.commit()
    _team(db, 23, "  finance ", lead=ANA, members=[(BOB, "member", None), (EVE, "member", None)])
    counts = D.backfill(db)
    assert counts["departments_created"] == 0 and counts["teams_linked"] == 1 and counts["members_copied"] == 2    # bob, and ana the lead
    assert db.query(m.GRCDepartment).filter_by(tenant_id=1).count() == 1
    team = db.get(m.Team, 23)
    assert (team.department_id, team.name, team.lead_user_id) == (boss["id"], "Finance", HEADY)       # it now mirrors the department
    rows = _members_of(db, boss["id"])
    assert rows[BOB][:2] == ("member", True) and rows[ANA][:2] == ("lead", True)
    assert rows[EVE][:2] == ("lead", False)                                                # a membership taken away there stays taken away
    assert db.get(m.GRCDepartment, boss["id"]).department_head_user_id == HEADY


def test_the_code_of_a_department_made_from_a_team_is_never_taken(w):
    db = w.db
    db.add(m.GRCDepartment(id=300, tenant_id=1, name="Internal Services", code="IS"))
    db.commit()
    _team(db, 24, "Information Security")
    _team(db, 25, "Infrastructure Support")
    D.backfill(db)
    codes = {d.name: d.code for d in db.query(m.GRCDepartment).filter_by(tenant_id=1)}
    assert codes["Information Security"] == "IS2" and codes["Infrastructure Support"] == "IS3" and codes["Internal Services"] == "IS"


def test_a_department_without_a_picker_record_gets_one_unless_it_is_inactive(w):
    db = w.db
    db.add(m.GRCDepartment(id=310, tenant_id=1, name="Treasury", code="TRE", department_head_user_id=HEADY, description="Cash"))
    db.add(m.GRCDepartment(id=311, tenant_id=1, name="Closed", code="CLO", is_active=False))
    db.commit()
    counts = D.backfill(db)
    assert counts["pickers_created"] == 1 and counts["teams_linked"] == 0
    team = db.query(m.Team).filter_by(department_id=310).one()
    assert (team.name, team.lead_user_id, team.description, team.is_active) == ("Treasury", HEADY, "Cash", True)
    assert db.query(m.Team).filter_by(department_id=311).count() == 0


def test_a_team_beside_a_department_that_already_has_one_is_left_alone(w):
    db = w.db
    d = make(w, name="Finance")
    _team(db, 26, "FINANCE", members=[(ANA, "member", None)])                              # the same name, case aside, but taken
    counts = D.backfill(db)
    assert counts["skipped"] == 1 and counts["teams_linked"] == 0
    assert db.get(m.Team, 26).department_id is None                                        # it keeps working as a legacy team
    assert D.team_member_ids(db, db.get(m.Team, 26)) == {ANA}
    assert db.query(m.GRCDepartment).filter_by(tenant_id=1).count() == 1 and d["team_id"] != 26


def test_the_start_up_fix_runs_on_an_engine_and_is_safe_to_repeat(w):
    from grc.modules.compliance.schema_migrations import _backfill_departments_from_teams

    _team(w.db, 27, "Payments", lead=BOB, members=[(ANA, "member", None)])
    _backfill_departments_from_teams(w.engine)
    w.db.expire_all()
    dept = w.db.query(m.GRCDepartment).filter_by(name="Payments").one()
    assert w.db.get(m.Team, 27).department_id == dept.id and set(_members_of(w.db, dept.id)) == {ANA}
    _backfill_departments_from_teams(w.engine)
    w.db.expire_all()
    assert w.db.query(m.GRCDepartment).filter_by(name="Payments").count() == 1 and len(_members_of(w.db, dept.id)) == 1


def test_a_collision_with_another_process_skips_that_team_and_goes_on(w, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    _team(w.db, 28, "Payments")
    _team(w.db, 29, "Identity")
    real = D.sync_team_shim

    def collide(db, department):
        if department.name == "Payments":
            raise IntegrityError("insert", {}, Exception("the other process wrote the same rows"))
        return real(db, department)

    monkeypatch.setattr(D, "sync_team_shim", collide)
    counts = D.backfill(w.db)
    assert counts["skipped"] >= 1 and counts["teams_linked"] == 1
    assert w.db.get(m.Team, 29).department_id is not None and w.db.get(m.Team, 28).department_id is None   # rolled back, the next run does it
    monkeypatch.setattr(D, "sync_team_shim", real)
    assert D.backfill(w.db)["teams_linked"] == 1 and w.db.get(m.Team, 28).department_id is not None


# ── the documents ────────────────────────────────────────────────────────────

@pytest.fixture
def gov(w, monkeypatch):
    from grc.modules.governance import doc_lifecycle as life
    from grc.modules.governance.router import router as governance_routes
    from grc.routers.auth_router import require_auth

    monkeypatch.setattr("grc.modules.governance.routers.documents._resolve_tenant_slug_for_autoparse", lambda tenant_id: None)
    monkeypatch.setattr(life, "_task_viewers", lambda db: set(range(1, 12)))
    app = FastAPI()
    app.include_router(governance_routes)
    app.dependency_overrides[m.get_db] = lambda: w.db
    app.dependency_overrides[require_auth] = lambda: w.db.get(m.GRCUser, ADMIN)
    w.docs = TestClient(app)
    return w


def _notes(db, doc_id):
    return [(a.action_details, a.field_changed, a.old_value, a.new_value) for a in
            db.query(m.DocumentAuditLog).filter_by(document_id=doc_id, action="department_changed").order_by(m.DocumentAuditLog.id)]


def test_a_document_is_filed_under_a_department_of_the_organisation(gov):
    finance, legal, dormant = make(gov, name="Finance"), make(gov, name="Legal"), make(gov, name="Dormant")
    gov.as_(ADMIN).delete(f"/admin/departments/{dormant['id']}")
    body = {"title": "Travel policy", "doc_type": "policy"}
    for dept, words in [(9999, "The department chosen does not exist."), (900, "The department chosen does not exist."),   # unknown; another organisation's
                        (dormant["id"], "The department chosen is not active.")]:
        r = gov.docs.post("/governance/documents", json={**body, "department_id": dept})
        assert r.status_code == 400 and r.json()["detail"] == words, (dept, r.text)
    assert gov.db.query(m.GovernanceDocument).count() == 0
    made = gov.docs.post("/governance/documents", json={**body, "department_id": finance["id"]})
    assert made.status_code == 201 and made.json()["department_id"] == finance["id"]
    assert gov.docs.post("/governance/documents", json=body).json()["department_id"] is None
    doc = made.json()["id"]
    url = f"/governance/documents/{doc}"
    for dept, words in [(9999, "does not exist"), (900, "does not exist"), (dormant["id"], "not active")]:
        r = gov.docs.put(url, json={"department_id": dept})
        assert r.status_code == 400 and words in r.json()["detail"], (dept, r.text)
    gov.db.expire_all()
    assert gov.db.get(m.GovernanceDocument, doc).department_id == finance["id"] and _notes(gov.db, doc) == []
    assert gov.docs.put(url, json={"department_id": finance["id"], "title": "Travel"}).status_code == 200      # unchanged: no note
    assert _notes(gov.db, doc) == []
    # a document keeps the department it has after that was deactivated
    gov.as_(ADMIN).delete(f"/admin/departments/{finance['id']}")
    assert gov.docs.put(url, json={"department_id": finance["id"], "title": "Travel abroad"}).status_code == 200
    assert gov.docs.put(url, json={"department_id": legal["id"]}).status_code == 200


def test_a_change_of_department_is_noted_for_the_change_log(gov):
    from grc.modules.governance import change_chain as C

    finance, legal = make(gov, name="Finance"), make(gov, name="Legal")
    doc = gov.docs.post("/governance/documents", json={"title": "Travel policy", "doc_type": "policy"}).json()["id"]
    url = f"/governance/documents/{doc}"
    for dept in (finance["id"], legal["id"], None, legal["id"]):
        assert gov.docs.put(url, json={"department_id": dept}).status_code == 200
    assert [n[0] for n in _notes(gov.db, doc)] == [
        "Department changed from none to Finance", "Department changed from Finance to Legal",
        "Department changed from Legal to none", "Department changed from none to Legal"]
    first = _notes(gov.db, doc)[1]
    assert first[1:] == ("department_id", str(finance["id"]), str(legal["id"]))
    # the Change log lists it as other activity - the chain, the screen and the filtered export agree (frontend: lib/changeLog.ts)
    assert C.EVENT_LABEL["department_changed"] == "Department changed" and "department_changed" in C._OTHER_EVENTS
    assert C.event_group({"kind": "department_changed", "to": None}) == "other"
    chain = C.chain(gov.db, gov.db.get(m.GovernanceDocument, doc))
    events = [e for e in chain["events"] if e["kind"] == "department_changed"]
    assert [e["detail"] for e in events][1] == "Department changed from Finance to Legal" and len(events) == 4
    assert {e["kind"] for e in C.filter_chain(chain, kinds=["other"])["events"]} >= {"department_changed", "created"}
    assert "department_changed" not in {e["kind"] for e in C.filter_chain(chain, kinds=["review"])["events"]}
    assert [e["kind"] for e in C.filter_chain(chain, search="finance to legal")["events"]] == ["department_changed"]


def test_the_documents_dropdown_and_the_studio_read_the_departments_made_in_administration(gov):
    from grc.modules.governance import doc_details
    from grc.modules.governance.studio import setup
    from grc.modules.vuln_management.router import router as vuln_router

    finance = make(gov, name="Finance")
    make(gov, name="Legal", description="Contracts")
    dormant = make(gov, name="Dormant")
    gov.as_(ADMIN).delete(f"/admin/departments/{dormant['id']}")
    app = FastAPI()
    app.include_router(vuln_router)
    app.dependency_overrides[m.get_db] = lambda: gov.db
    token = create_access_token({"sub": "plain", "tenant_slug": "acme", "tenant_id": 1})
    # the Department dropdown of the document forms (it showed nothing: nobody filled this table) ...
    listed = TestClient(app, headers={"Authorization": "Bearer " + token}).get("/vuln-management/departments", params={"limit": 500}).json()
    assert [(d["name"], d["is_active"]) for d in listed] == [("Dormant", False), ("Finance", True), ("Legal", True)]
    # ... a department a file names is found, and a document's department is the studio's starting point
    assert doc_details._department(gov.db, "finance") == finance["id"] and doc_details._department(gov.db, "Dormant") is None
    doc = gov.docs.post("/governance/documents", json={"title": "Travel policy", "doc_type": "policy", "department_id": finance["id"]}).json()
    assert setup.from_document(gov.db, gov.db.get(m.GovernanceDocument, doc["id"]))["departments"] == ["Finance"]


# ── roles, the workflow builder, the audit trail and reads ───────────────────

def test_a_deleted_role_leaves_no_department_role_behind(w):
    import grc.routers.admin_router as admin_mod

    d = make(w, name="Analytics", role_ids=[ANALYSTS, AUDITORS])
    w.db.commit()
    w.db.execute(text("PRAGMA foreign_keys=OFF"))              # so the database itself does not cascade: the code must
    out = admin_mod.delete_role(role_id=AUDITORS, user=w.db.get(m.GRCUser, ADMIN), tenant_db=w.db)
    assert out == {"message": "Role deleted successfully"}
    assert [(r.department_id, r.role_id) for r in w.db.query(m.GRCDepartmentRole)] == [(d["id"], ANALYSTS)]
    assert set(people(w, d["id"])) == {ANA, BOB}                                       # the department works on with its other role


def test_departments_have_their_place_in_the_audit_trail_and_the_workflow_builder(w):
    from fastapi.routing import APIRoute

    from grc import feature_map
    from grc.main import app
    from grc.modules.workflow_engine.services import catalog as C
    from grc.modules.workflow_engine.services import route_events

    assert feature_map.place(None, "/grc/admin/departments/5/members") == ("Administration", "Departments")
    assert feature_map.place(None, "/grc/admin/teams/5") == ("Administration", "Teams")
    events = {key: eps for key, _label, _module, eps, _when in C.ENDPOINT_EVENT_TYPES}
    assert events["department_created"] == ("admin_departments_router.create_department",)
    assert events["department_updated"] == ("admin_departments_router.update_department",)
    assert events["department_member_added"] == ("admin_departments_router.add_member",)
    assert events["department_member_removed"] == ("admin_departments_router.remove_member",)
    assert events["team_created"] == ("teams_router.create_team",) and events["team_member_removed"] == ("teams_router.remove_member",)
    live = {route_events.endpoint_id(r.endpoint.__module__, r.endpoint.__name__) for r in app.routes if isinstance(r, APIRoute)}
    assert {e for k in ("department_created", "department_updated", "department_member_added", "department_member_removed")
            for e in events[k]} <= live
    assert C.ROUTE_FILE_MODULES["grc.routers.admin_departments_router"] == ("Administration", "Departments")


def _tables(db):
    return {name: sorted(map(tuple, db.execute(text(f"SELECT * FROM {name}")).fetchall()), key=repr)
            for name in ("grc_departments", "grc_department_members", "grc_department_roles", "grc_teams", "grc_team_members")}


def test_reading_departments_and_teams_writes_nothing(w):
    db = w.db
    db.add(m.GRCDepartment(id=320, tenant_id=1, name="No record yet", code="NRY"))                  # no picker record: a read must not make one
    _team(db, 61, "Legacy", members=[(ANA, "member", None)])
    made = make(w, name="Analytics", role_ids=[ANALYSTS], department_head_user_id=HEADY)
    before = _tables(db)
    http, admin = w.as_(PLAIN), w.as_(ADMIN)
    for path in ("/admin/departments", "/admin/departments?include_inactive=true", f"/admin/departments/{made['id']}", "/admin/departments/320",
                 "/admin/teams", "/admin/teams?include_inactive=true", f"/admin/teams/{made['team_id']}", "/admin/teams/61",
                 f"/admin/teams/{made['team_id']}/members", "/admin/teams/61/members"):
        assert http.get(path).status_code == 200, path
    assert admin.get("/admin/departments/role-options").status_code == 200
    assert _tables(db) == before
    assert http.get("/admin/departments/320").json()["team_id"] is None


def test_the_lists_read_the_database_the_same_number_of_times_however_many_departments_there_are(w):
    counted = []
    event.listen(w.engine, "before_cursor_execute", lambda conn, cursor, statement, params, context, many: counted.append(statement))
    http = w.as_(PLAIN)
    ids = []

    def made(n):
        for _ in range(n):
            d = make(w, name=f"Department {len(ids)}", role_ids=[ANALYSTS, AUDITORS], department_head_user_id=HEADY)
            w.as_(ADMIN).post(f"/admin/departments/{d['id']}/members", json={"user_id": EVE})
            ids.append((d["id"], d["team_id"]))

    def reads():
        out = []
        for path in ("/admin/departments", "/admin/teams", f"/admin/departments/{ids[0][0]}", f"/admin/teams/{ids[0][1]}"):
            counted.clear()
            assert http.get(path).status_code == 200, path
            out.append(len(counted))
        return out

    made(2)
    reads()                                             # (the first request of a person also notes their activity)
    few = reads()
    made(20)
    assert reads() == few
    assert len(http.get("/admin/departments").json()) == 22
