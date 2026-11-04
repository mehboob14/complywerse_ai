"""The department tree (DECISIONS D57): a department can sit under another, three levels deep at most, and the organisation names
the levels. Over HTTP with real tokens on in-memory SQLite (foreign keys on, a session that does not flush by itself).

* depth: three levels fit, a fourth is refused with the level names in the sentence; a move is checked with everything under it;
* no loop, no switched-off parent; a flat setup behaves exactly as before (level 1, no children, totals = own counts);
* the level names: defaults, set, reset by a blank, no two alike, too long, who may change them, one organisation's never another's;
* what the list carries: level, level name, path, children, own and rolled-up document counts (only documents the caller may read);
* old data: a loop, a self-parent, a parent that is gone, a chain deeper than three - read without a crash, nothing lost;
* the owner (head) of a department, which scopes the Documents Overview.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

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
from grc.services import org_departments as D  # noqa: E402

PLAIN, ADMIN, OWNER, EVE = 1, 2, 3, 4


@pytest.fixture(scope="module")
def _schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def w(_schema):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    _schema.raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    db = sessionmaker(bind=engine, autoflush=False)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (OWNER, "olga"), (EVE, "eve")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    db.add(m.Role(id=1, tenant_id=1, name="Administrator"))
    db.add(m.UserRole(user_id=ADMIN, role_id=1, tenant_id=1, source=None))
    db.commit()
    app = FastAPI()
    app.include_router(departments_router)
    app.dependency_overrides[m.get_db] = lambda: db

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    yield SimpleNamespace(db=db, as_=as_)
    db.close()


def make(w, name, parent=None, **body):
    r = w.as_(ADMIN).post("/admin/departments", json={"name": name, "parent_department_id": parent, **body})
    assert r.status_code == 201, r.text
    return r.json()


def by_name(w, include_inactive=True, as_user=ADMIN):
    rows = w.as_(as_user).get("/admin/departments", params={"include_inactive": include_inactive}).json()
    return {r["name"]: r for r in rows}


def chain(w):
    """Operations > Support > Helpdesk: three levels."""
    ops = make(w, "Operations")
    support = make(w, "Support", ops["id"])
    desk = make(w, "Helpdesk", support["id"])
    return ops, support, desk


# ── depth ────────────────────────────────────────────────────────────────────

def test_three_levels_fit_and_each_row_says_where_it_sits(w):
    ops, support, desk = chain(w)
    rows = by_name(w)
    assert [(rows[n]["level"], rows[n]["level_label"]) for n in ("Operations", "Support", "Helpdesk")] == [
        (1, "Department"), (2, "Sub-department"), (3, "Unit")]
    assert rows["Helpdesk"]["path"] == ["Operations", "Support", "Helpdesk"] and rows["Operations"]["path"] == ["Operations"]
    assert [rows[n]["child_count"] for n in ("Operations", "Support", "Helpdesk")] == [1, 1, 0]
    assert rows["Support"]["parent_department_name"] == "Operations"


def test_a_fourth_level_is_refused_in_the_words_of_the_organisation(w):
    ops, support, desk = chain(w)
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Night shift", "parent_department_id": desk["id"]})
    assert r.status_code == 400
    assert r.json()["detail"] == ("'Helpdesk' is a Unit: nothing can be placed under it. "
                                  "The tree has 3 levels: Department › Sub-department › Unit.")
    assert w.as_(ADMIN).put("/admin/departments/levels", json={"labels": ["Division", "Branch", "Team"]}).status_code == 200
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Night shift", "parent_department_id": desk["id"]})
    assert "'Helpdesk' is a Team" in r.json()["detail"] and "Division › Branch › Team" in r.json()["detail"]
    assert w.db.query(m.GRCDepartment).filter_by(name="Night shift").count() == 0


def test_a_move_is_checked_with_everything_under_the_department(w):
    ops, support, desk = chain(w)
    other = make(w, "Finance")
    under_finance = make(w, "Treasury", other["id"])
    # Support (with Helpdesk under it) placed under Treasury would make Helpdesk the fourth level
    r = w.as_(ADMIN).patch(f"/admin/departments/{support['id']}", json={"parent_department_id": under_finance["id"]})
    assert r.status_code == 400 and "4 levels deep" in r.json()["detail"] and "'Treasury'" in r.json()["detail"]
    # under Finance directly it fits (Finance > Support > Helpdesk)
    r = w.as_(ADMIN).patch(f"/admin/departments/{support['id']}", json={"parent_department_id": other["id"]})
    assert r.status_code == 200 and r.json()["level"] == 2 and r.json()["path"] == ["Finance", "Support"]
    assert by_name(w)["Helpdesk"]["path"] == ["Finance", "Support", "Helpdesk"]
    # a department can go back to the top: a null parent clears it
    r = w.as_(ADMIN).patch(f"/admin/departments/{support['id']}", json={"parent_department_id": None})
    assert r.status_code == 200 and r.json()["level"] == 1 and by_name(w)["Helpdesk"]["level"] == 2


def test_no_loops_and_no_switched_off_parent(w):
    ops, support, desk = chain(w)
    for target in (support["id"], desk["id"], ops["id"]):
        r = w.as_(ADMIN).patch(f"/admin/departments/{ops['id']}", json={"parent_department_id": target})
        assert r.status_code == 400 and "under itself or under one of its own sub-departments" in r.json()["detail"], target
    off = make(w, "Legacy")
    assert w.as_(ADMIN).delete(f"/admin/departments/{off['id']}").status_code == 200
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Old team", "parent_department_id": off["id"]})
    assert r.status_code == 400 and "'Legacy' is switched off" in r.json()["detail"]
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Orphan", "parent_department_id": 99999})
    assert r.status_code == 400 and "does not exist" in r.json()["detail"]


def test_switching_a_parent_off_touches_only_the_parent(w):
    ops, support, desk = chain(w)
    assert w.as_(ADMIN).delete(f"/admin/departments/{ops['id']}").status_code == 200
    rows = by_name(w)
    assert rows["Operations"]["is_active"] is False and rows["Support"]["is_active"] is True and rows["Helpdesk"]["is_active"] is True
    assert rows["Support"]["path"] == ["Operations", "Support"]          # the path still names the switched-off parent
    assert "Operations" not in by_name(w, include_inactive=False)        # the picker no longer offers it, its children stay


def test_a_flat_setup_behaves_as_before(w):
    make(w, "Finance")
    make(w, "Legal")
    for row in by_name(w).values():
        assert (row["level"], row["level_label"], row["path"], row["child_count"], row["parent_department_id"]) == (
            1, "Department", [row["name"]], 0, None)
        assert row["document_count_total"] == row["document_count"] == 0


# ── level names ──────────────────────────────────────────────────────────────

def test_level_names_default_set_reset_and_validated(w):
    http = w.as_(PLAIN)
    assert http.get("/admin/departments/levels").json() == {
        "labels": ["Department", "Sub-department", "Unit"], "defaults": ["Department", "Sub-department", "Unit"], "max_depth": 3}
    admin = w.as_(ADMIN)
    ok = admin.put("/admin/departments/levels", json={"labels": ["  Division ", "", "Cell"]})
    assert ok.status_code == 200 and ok.json()["labels"] == ["Division", "Sub-department", "Cell"]
    assert w.db.query(m.GRCDepartmentLevel).count() == 2                  # the default is stored as no row
    assert http.get("/admin/departments/levels").json()["labels"] == ["Division", "Sub-department", "Cell"]
    assert admin.put("/admin/departments/levels", json={"labels": ["", "", ""]}).json()["labels"] == list(D.DEFAULT_LEVEL_LABELS)
    assert w.db.query(m.GRCDepartmentLevel).count() == 0
    for bad, why in [(["A", "a", "C"], "own name"), (["A", "B"], "each of the 3 levels"), (["x" * 41, "B", "C"], "at most 40"),
                     (["Unit", "Sub-department", ""], "own name")]:
        r = admin.put("/admin/departments/levels", json={"labels": bad})
        assert r.status_code == 400 and why in r.json()["detail"], (bad, r.text)


def test_only_someone_who_may_edit_the_organisation_names_the_levels(w):
    r = w.as_(PLAIN).put("/admin/departments/levels", json={"labels": ["A", "B", "C"]})
    assert (r.status_code, r.json()["detail"]) == (403, "Permission denied")
    assert w.db.query(m.GRCDepartmentLevel).count() == 0


def test_one_organisations_level_names_are_never_anothers(w):
    D.set_level_labels(w.db, 2, ["Region", "Country", "Office"])
    w.db.commit()
    assert w.as_(PLAIN).get("/admin/departments/levels").json()["labels"] == list(D.DEFAULT_LEVEL_LABELS)
    assert D.level_labels(w.db, 2) == ["Region", "Country", "Office"]


# ── counts: own, rolled up, and only what the caller may read ────────────────

def _doc(db, did, department_id, status="published", owner=None, **kw):
    db.add(m.GovernanceDocument(id=did, tenant_id=1, title=f"Doc {did}", doc_type="policy", status=status, owner_id=owner,
                                department_id=department_id, published_version="1.0" if status == "published" else None, **kw))


def test_the_roll_up_counts_a_department_and_everything_under_it(w):
    ops, support, desk = chain(w)
    other = make(w, "Finance")
    _doc(w.db, 1, ops["id"])
    _doc(w.db, 2, support["id"])
    _doc(w.db, 3, support["id"])
    _doc(w.db, 4, desk["id"])
    _doc(w.db, 5, other["id"])
    _doc(w.db, 6, desk["id"], status="archived")                          # archived documents are left out, as before
    w.db.commit()
    rows = by_name(w)
    got = {n: (rows[n]["document_count"], rows[n]["document_count_total"]) for n in rows}
    assert got == {"Operations": (1, 4), "Support": (2, 3), "Helpdesk": (1, 1), "Finance": (1, 1)}


def test_the_roll_up_never_counts_a_document_the_caller_may_not_read(w):
    ops, support, desk = chain(w)
    _doc(w.db, 1, support["id"])                                          # in force: a library reader reads it
    _doc(w.db, 2, support["id"], status="draft", owner=EVE)               # a draft only its owner (and editors) read
    w.db.commit()
    plain = {r["name"]: r for r in w.as_(PLAIN).get("/admin/departments").json()}
    admin = {r["name"]: r for r in w.as_(ADMIN).get("/admin/departments").json()}
    eve = {r["name"]: r for r in w.as_(EVE).get("/admin/departments").json()}
    assert (admin["Support"]["document_count"], admin["Operations"]["document_count_total"]) == (2, 2)
    assert (eve["Support"]["document_count"], eve["Operations"]["document_count_total"]) == (1, 1)       # their own draft only
    assert (plain["Support"]["document_count"], plain["Operations"]["document_count_total"]) == (0, 0)  # no library right, asked about nothing


# ── old data and the Tree itself ─────────────────────────────────────────────

def test_old_data_is_read_without_a_crash_and_nothing_is_lost(w):
    db = w.db
    db.execute(text("PRAGMA foreign_keys=OFF"))                           # a loop can only have been written without the check
    for i, name, parent in [(10, "A", 11), (11, "B", 10),                 # a loop: A <-> B
                            (12, "C", 12),                                # its own parent
                            (14, "E", 10)]:                               # hangs off the loop
        db.add(m.GRCDepartment(id=i, tenant_id=1, name=name, code=name, parent_department_id=parent))
    db.commit()
    db.execute(text("PRAGMA foreign_keys=ON"))
    tree = D.Tree.load(db, 1)
    assert {i: tree.level(i) for i in (10, 11, 12, 14)} == {10: 1, 11: 1, 12: 1, 14: 2}
    assert tree.subtree(10) == {10, 14} and tree.subtree(11) == {11}
    rows = by_name(w)
    assert set(rows) == {"A", "B", "C", "E"} and rows["E"]["path"] == ["A", "E"]


def test_a_chain_deeper_than_three_from_before_the_limit_stays_and_refuses_more(w):
    db = w.db
    for i, parent in [(20, None), (21, 20), (22, 21), (23, 22)]:
        db.add(m.GRCDepartment(id=i, tenant_id=1, name=f"L{i - 19}", code=f"L{i - 19}", parent_department_id=parent))
    db.commit()
    rows = by_name(w)
    assert (rows["L4"]["level"], rows["L4"]["level_label"], rows["L4"]["path"]) == (4, "Unit", ["L1", "L2", "L3", "L4"])
    r = w.as_(ADMIN).post("/admin/departments", json={"name": "Below", "parent_department_id": 23})
    assert r.status_code == 400
    # the deep chain can still be repaired: L3 (with L4 under it) moved up under nothing, and renaming never checks the tree
    assert w.as_(ADMIN).patch("/admin/departments/22", json={"name": "L3 renamed"}).status_code == 200
    assert w.as_(ADMIN).patch("/admin/departments/22", json={"parent_department_id": None}).status_code == 200
    assert by_name(w)["L4"]["level"] == 2


def test_tree_helpers_height_path_and_owner(w):
    ops, support, desk = chain(w)
    w.as_(ADMIN).patch(f"/admin/departments/{support['id']}", json={"department_head_user_id": OWNER})
    tree = D.Tree.load(w.db, 1)
    assert [tree.height(i) for i in (ops["id"], support["id"], desk["id"])] == [2, 1, 0]
    assert [d.name for d in tree.path(desk["id"])] == ["Operations", "Support", "Helpdesk"]
    assert D.headed_by(w.db, OWNER, [1]) == {support["id"]} and D.headed_by(w.db, OWNER, [2]) == set()
    assert tree.subtree(support["id"]) == {support["id"], desk["id"]}
