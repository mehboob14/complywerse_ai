"""The owner (head) of a department reads every document of it and of everything under it (the user's decision of 2026-11-05),
and nothing else: no change, no publishing, no deleting, nothing outside the unit. The rule is permissions.headed_units, used by
can_read, visible_filter, readable_ids and readable_among, and so by every list and every route that reads a document. The menu
learns who heads a department from /auth/me (user.heads_department). Over HTTP through the governance router on in-memory SQLite."""
from datetime import datetime

import pytest

import grc.models as m
from grc.modules.governance import permissions
from grc.routers import auth_router
from grc.routers.auth_router import create_access_token

from test_governance_permissions import EDITOR, OWNER, SAM, SIGNED_IN, SSO, TEXT, doc, world  # noqa: F401  (world is a fixture)

HEAD = SIGNED_IN                                   # heads Operations (10): Support (11) and the Helpdesk (12) are under it
FINANCE_HEAD = SSO                                 # heads Finance (13)
OPS, SUP, HELP, FINANCE = 10, 11, 12, 13


@pytest.fixture
def unit(world):
    """Document 5 (Olivia's draft) is filed in the Helpdesk, document 6 (Sam's draft) in Finance."""
    db = world.db
    for did, name, parent, head in [(OPS, "Operations", None, HEAD), (SUP, "Support", OPS, None), (HELP, "Helpdesk", SUP, None),
                                    (FINANCE, "Finance", None, FINANCE_HEAD)]:
        db.add(m.GRCDepartment(id=did, tenant_id=1, name=name, code=name[:4].upper(), parent_department_id=parent, department_head_user_id=head))
    db.get(m.GovernanceDocument, 5).department_id = HELP
    db.get(m.GovernanceDocument, 6).department_id = FINANCE
    db.commit()
    return world


def as_(world, who):
    world.me["id"] = who
    return world.http


def file_under(world, dept, did=5):
    doc(world, did).department_id = dept
    world.db.commit()


def test_the_head_reads_every_document_of_their_department_and_of_everything_under_it(unit):
    http = as_(unit, HEAD)
    r = http.get("/governance/documents/5")                                   # a draft they neither own nor wrote nor are asked about
    assert r.status_code == 200 and r.json()["title"] == "Access policy"
    r = http.get("/governance/documents/6")                                   # Finance's: not theirs
    assert (r.status_code, r.json()["detail"]) == (403, permissions.READ_REFUSED)
    for dept in (OPS, SUP, HELP):                                             # filed in the department they head, or in any one under it
        file_under(unit, dept)
        assert http.get("/governance/documents/5").status_code == 200, dept
    file_under(unit, FINANCE)
    assert http.get("/governance/documents/5").status_code == 403             # moved out of their reach
    file_under(unit, None)
    assert http.get("/governance/documents/5").status_code == 403             # filed nowhere


def test_the_head_of_a_lower_department_reads_what_is_in_it_and_not_what_is_above(unit):
    unit.db.get(m.GRCDepartment, SUP).department_head_user_id = SAM           # Sam heads Support (and owns document 6, in Finance)
    unit.db.commit()
    http = as_(unit, SAM)
    assert http.get("/governance/documents/5").status_code == 200             # the Helpdesk is under Support
    file_under(unit, SUP)
    assert http.get("/governance/documents/5").status_code == 200
    file_under(unit, OPS)
    assert http.get("/governance/documents/5").status_code == 403             # Operations is above it
    assert http.get("/governance/documents/6").status_code == 200             # (their own, as before)


def test_reading_is_all_it_gives(unit):
    http = as_(unit, HEAD)
    user = unit.db.get(m.GRCUser, HEAD)
    assert not permissions.can_edit(unit.db, user, doc(unit))
    assert http.put("/governance/documents/5", json={"title": "Changed"}).status_code == 403
    assert http.put("/governance/documents/5/status", json={"status": "archived"}).status_code == 403
    assert http.delete("/governance/documents/5").status_code == 403
    assert http.post("/governance/documents/5/publish").status_code == 403
    assert (doc(unit).title, doc(unit).status) == ("Access policy", "draft")
    # they are not made a library reader: the library's own rule for the documents outside their department stays
    assert permissions.can_read_library(unit.db, user) is False


def test_an_archived_document_is_read_and_a_new_version_on_its_way_is_not_shown_over_the_one_in_force(unit):
    user = unit.db.get(m.GRCUser, HEAD)
    doc(unit).status = "archived"
    unit.db.commit()
    assert permissions.can_read(unit.db, user, doc(unit)) is True              # archived: as the document's owner would
    d = doc(unit)
    d.status, d.published_at, d.current_version, d.published_version = "pending_review", datetime.utcnow(), "1.1", "1.0"
    unit.db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.0", title=d.title, content=TEXT, status="superseded"))
    unit.db.commit()
    row = permissions.version_for(unit.db, user, doc(unit))
    assert row is not None and row.version_number == "1.0"                     # they read the version in force, as every reader does


def test_every_list_and_helper_follows_the_same_rule(unit):
    db = unit.db
    head, finance = db.get(m.GRCUser, HEAD), db.get(m.GRCUser, FINANCE_HEAD)
    assert permissions.headed_units(db, head) == {OPS, SUP, HELP}
    assert permissions.headed_units(db, finance) == {FINANCE}
    assert permissions.headed_units(db, db.get(m.GRCUser, SAM)) == set()
    ids = lambda cond: {i for (i,) in db.query(m.GovernanceDocument.id).filter(cond)}               # noqa: E731
    assert ids(permissions.visible_filter(db, head)) == {5}                    # (what the person may read: the draft in the Helpdesk)
    assert ids(m.GovernanceDocument.id.in_(permissions.readable_ids(db, head))) == {5}
    assert permissions.readable_among(db, head, [5, 6, None, 999]) == {5}
    assert permissions.readable_among(db, finance, [5, 6]) == {6}
    listed = as_(unit, HEAD).get("/governance/documents").json()               # the library list of the head: this one only
    assert [d["id"] for d in listed["items"]] == [5]
    assert [d["id"] for d in as_(unit, FINANCE_HEAD).get("/governance/documents").json()["items"]] == [6]


def test_a_person_who_heads_nothing_reads_what_they_did_before(unit):
    http = as_(unit, SAM)                                                      # Sam owns document 6 only
    assert http.get("/governance/documents/6").status_code == 200
    assert http.get("/governance/documents/5").status_code == 403
    assert as_(unit, EDITOR).get("/governance/documents/5").status_code == 200          # an editor reads any draft, as before
    assert as_(unit, OWNER).get("/governance/documents/5").status_code == 200           # the owner of the document
    unit.db.get(m.GRCDepartment, OPS).department_head_user_id = None           # the head is taken off: the reading goes with it
    unit.db.commit()
    assert as_(unit, HEAD).get("/governance/documents/5").status_code == 403


def test_the_menu_knows_who_heads_a_department(unit):
    unit.http.app.include_router(auth_router)                                  # (the package exports the router under the module's name)

    def me(uid):
        token = create_access_token({"sub": unit.db.get(m.GRCUser, uid).username, "tenant_slug": "cfsb", "tenant_id": 1})
        r = unit.http.get("/auth/me", headers={"Authorization": "Bearer " + token})
        assert r.status_code == 200
        return r.json()["user"]

    assert me(HEAD)["heads_department"] is True and me(FINANCE_HEAD)["heads_department"] is True
    assert me(SAM)["heads_department"] is False and me(OWNER)["heads_department"] is False       # owning documents is not heading a department
    assert me(HEAD)["permissions"] == [] and me(HEAD)["is_admin"] is False                          # nothing else about their rights changed
