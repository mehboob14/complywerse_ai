"""TPRM parity, piece P0 (2026-10-29): the register and the fields it slices a supplier by.

A supplier gains personal data, classification, where the data lives, the systems it touches, tags, and a security and
a relationship owner beside the business owner (people who are active and sign in here; null is "not recorded"). The
register lists as before (newest first, same {items,total,skip,limit}) and gains repeated tier/status filters, the
next-action codes, the owner, personal data and business unit, and a server-side order: risk, name, tier, status,
grade, owner, next reassessment, annual value. Grade and the next action are worked out in Python over the whole
filtered set, then paged; every other order is the database's. Each row gains its grade and score. In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, BusinessUnit, GRCUser, Role, Tenant, UserRole, Vendor, VendorAssessment, get_db,
)
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.routers.auth_router import require_auth

ADMIN, ADA, BEN, SEC, REL, GONE, BOT = 1, 2, 3, 4, 5, 6, 7
NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add_all([BusinessUnit(id=1, tenant_id=1, name="Retail"), BusinessUnit(id=2, tenant_id=1, name="Treasury")])
    s.add(Role(id=1, name="Administrator"))
    names = {ADMIN: "Admin", ADA: "Ada", BEN: "Ben", SEC: "Sam Security", REL: "Rae Relations", GONE: "Gone"}
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=name, email=f"u{uid}@acme.test", is_active=uid != GONE)
               for uid, name in names.items()])
    s.add(GRCUser(id=BOT, username="bot", email="bot@do.test", is_active=True, external_provider="digitalocean"))
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, uid=ADMIN):
    app = FastAPI()
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, uid)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


def _graded(db, v, grade, score):
    db.add(VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status="active",
                            current_stage="monitoring", rating_grade=grade, residual_score=score, version_no=1))
    db.commit()


@pytest.fixture()
def register(db):
    """Six suppliers in use, made in this order, and two the register leaves out. What each waits on is in brackets."""
    scored = {"inherent_risk_score": 60.0}
    ids = {}
    for name, kw in [
        ("Alpha", dict(tier="critical", owner_id=ADA, business_unit_id=1, holds_personal_data=True, contract_value=100.0,
                       next_reassessment_date=NOW + timedelta(days=100), **scored)),                       # [nothing]
        ("Bravo", dict(tier="critical", owner_id=None, business_unit_id=2, holds_personal_data=False, contract_value=50.0,
                       next_reassessment_date=NOW + timedelta(days=10), **scored)),                        # [no_owner]
        ("Charlie", dict(tier="high", owner_id=BEN, business_unit_id=1, **scored)),                        # [nothing]
        ("Delta", dict(tier="medium", owner_id=ADA)),                                                      # [not_tiered]
        ("Echo", dict(tier="low", owner_id=ADA, status="suspended", **scored)),                            # [suspended]
        ("Foxtrot", dict(tier="high", owner_id=BEN, status="onboarding",
                         next_reassessment_date=NOW - timedelta(days=5), **scored)),                       # [reassessment_overdue]
    ]:
        ids[name] = _vendor(db, name, **kw)
    _graded(db, ids["Alpha"], "B", 42.0)
    _graded(db, ids["Bravo"], "C", 55.54)
    _graded(db, ids["Foxtrot"], "F", 90.0)
    _vendor(db, "Golf", intake_status="draft", status="requested")
    _vendor(db, "Hotel", deleted_at=NOW)
    return ids


def names(response):
    assert response.status_code == 200, response.text
    return [r["name"] for r in response.json()["items"]]


# ── the fields ───────────────────────────────────────────────────────────────

FIELDS = {"holds_personal_data": True, "data_classification": "Confidential", "data_location": "  Frankfurt  and  Dubai ",
          "systems_in_scope": ["Core banking", " Payroll ", "Core banking", ""], "tags": ["payments", "Tier-1", "payments"],
          "security_owner_id": SEC, "relationship_owner_id": REL, "business_unit_id": 2}


def test_a_supplier_is_made_with_the_register_fields_tidied_and_its_people_named(db):
    web = client(db)
    r = web.post("/vendor-risk/vendors", json={"name": "Acme Cloud", **FIELDS})
    assert r.status_code == 201, r.text
    got = r.json()
    assert got["holds_personal_data"] is True and got["data_classification"] == "confidential"
    assert got["data_location"] == "Frankfurt and Dubai"
    assert got["systems_in_scope"] == ["Core banking", "Payroll"] and got["tags"] == ["payments", "Tier-1"]
    assert (got["security_owner_id"], got["relationship_owner_id"]) == (SEC, REL)
    assert got["security_owner"] == {"id": SEC, "full_name": "Sam Security", "email": "u4@acme.test"}
    assert got["relationship_owner"]["full_name"] == "Rae Relations"
    assert got["business_unit"] == {"id": 2, "name": "Treasury"}
    assert web.get(f"/vendor-risk/vendors/{got['id']}").json()["security_owner"]["id"] == SEC


def test_a_supplier_made_without_them_has_nothing_recorded_not_a_no(db):
    got = client(db).post("/vendor-risk/vendors", json={"name": "Plain Co"}).json()
    assert got["holds_personal_data"] is None and got["data_classification"] is None and got["data_location"] is None
    assert (got["systems_in_scope"], got["tags"]) == ([], [])
    assert (got["security_owner"], got["relationship_owner"], got["business_unit"]) == (None, None, None)
    assert got["owner_id"] is None and "owner" not in got                    # the business owner is as it was


@pytest.mark.parametrize("fields, words", [
    ({"data_classification": "secret"}, "one of: public, internal, confidential, restricted"),
    ({"data_location": "x" * 256}, "255"),
    ({"tags": [1, 2]}, "list of names"),
    ({"tags": [f"tag{i}" for i in range(31)]}, "at most 30"),
    ({"tags": ["y" * 41]}, "up to 40 characters"),
    ({"systems_in_scope": ["s"] * 2 + [f"s{i}" for i in range(50)]}, "at most 50"),
    ({"security_owner_id": GONE}, "active user"),
    ({"relationship_owner_id": 999}, "active user"),
    ({"security_owner_id": BOT}, "access review imported"),
])
def test_a_register_field_that_is_not_valid_is_refused_with_a_reason(db, fields, words):
    web = client(db)
    r = web.post("/vendor-risk/vendors", json={"name": "Bad Co", **fields})
    assert r.status_code == 400 and words in r.json()["detail"]
    v = _vendor(db, "Good Co")
    r = web.put(f"/vendor-risk/vendors/{v.id}", json=fields)
    assert r.status_code == 400 and words in r.json()["detail"]
    assert db.query(Vendor).filter(Vendor.name == "Bad Co").count() == 0


def test_the_fields_change_one_at_a_time_and_are_cleared_by_null(db):
    web = client(db)
    v = _vendor(db, "Acme Cloud", owner_id=ADA)
    put = lambda **kw: web.put(f"/vendor-risk/vendors/{v.id}", json=kw)       # noqa: E731
    assert put(**FIELDS).status_code == 200
    got = put(tags=["new"]).json()
    assert got["tags"] == ["new"] and got["security_owner"]["id"] == SEC and got["data_classification"] == "confidential"
    got = put(holds_personal_data=None, security_owner_id=None, data_classification=None, systems_in_scope=None).json()
    assert got["holds_personal_data"] is None and got["security_owner"] is None and got["security_owner_id"] is None
    assert got["data_classification"] is None and got["systems_in_scope"] == [] and got["relationship_owner"]["id"] == REL
    assert put(holds_personal_data=False).json()["holds_personal_data"] is False
    assert got["owner_id"] == ADA                                              # not touched


def test_an_owner_who_has_since_left_may_be_sent_back_but_not_newly_chosen(db):
    web = client(db)
    v = _vendor(db, "Acme Cloud", security_owner_id=GONE)
    assert web.put(f"/vendor-risk/vendors/{v.id}", json={"security_owner_id": GONE, "tags": ["a"]}).status_code == 200
    assert web.put(f"/vendor-risk/vendors/{v.id}", json={"relationship_owner_id": GONE}).status_code == 400


# ── the register ─────────────────────────────────────────────────────────────

def test_without_a_sort_the_register_is_newest_first_as_it_always_was(db, register):
    got = client(db).get("/vendor-risk/vendors").json()
    assert [r["name"] for r in got["items"]] == ["Foxtrot", "Echo", "Delta", "Charlie", "Bravo", "Alpha"]
    assert (got["total"], got["skip"], got["limit"]) == (6, 0, 100)             # requests and archived are left out
    assert names(client(db).get("/vendor-risk/vendors?include_archived=true&include_requests=true")) == [
        "Hotel", "Golf", "Foxtrot", "Echo", "Delta", "Charlie", "Bravo", "Alpha"]


def test_each_row_carries_its_grade_its_score_and_what_the_register_slices_by(db, register):
    rows = {r["name"]: r for r in client(db).get("/vendor-risk/vendors").json()["items"]}
    assert (rows["Alpha"]["grade"], rows["Alpha"]["grade_score"]) == ("B", 42.0)
    assert (rows["Bravo"]["grade"], rows["Bravo"]["grade_score"]) == ("C", 55.5)       # rounded to a tenth
    assert (rows["Charlie"]["grade"], rows["Charlie"]["grade_score"]) == (None, None)
    assert rows["Alpha"]["holds_personal_data"] is True and rows["Bravo"]["holds_personal_data"] is False
    assert rows["Charlie"]["holds_personal_data"] is None
    assert rows["Alpha"]["business_unit"] == {"id": 1, "name": "Retail"} and rows["Delta"]["business_unit"] is None
    assert rows["Alpha"]["owner"]["full_name"] == "Ada" and "owner" not in rows["Bravo"]
    assert {"next_action", "open_engagements", "security_owner", "relationship_owner", "data_classification"} <= set(rows["Alpha"])
    assert rows["Foxtrot"]["next_action"]["code"] == "reassessment_overdue"


def test_a_supplier_with_two_graded_assessments_shows_the_worst_one_with_its_own_score(db, register):
    _graded(db, register["Alpha"], "D", 61.0)
    _graded(db, register["Alpha"], "D", 66.0)
    row = next(r for r in client(db).get("/vendor-risk/vendors").json()["items"] if r["name"] == "Alpha")
    assert (row["grade"], row["grade_score"]) == ("D", 66.0)                  # the worse score of the worst grade


def test_the_register_people_come_from_one_lookup_per_page_not_one_per_row(db, register):
    for name in ("Alpha", "Bravo", "Charlie", "Delta"):
        v = db.query(Vendor).filter_by(name=name).one()
        v.security_owner_id, v.relationship_owner_id = SEC, REL
    db.commit()
    seen = []

    def spy(conn, cursor, statement, parameters, *rest):
        seen.append((" ".join(statement.split()), parameters))

    event.listen(db.get_bind(), "before_cursor_execute", spy)
    try:
        rows = client(db).get("/vendor-risk/vendors").json()["items"]
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", spy)
    assert [r["security_owner"]["id"] for r in rows if r["security_owner"]] == [SEC] * 4
    assert sum(1 for q, _ in seen if "FROM grc_users WHERE grc_users.id IN" in q) == 1
    assert not [p for q, p in seen if "FROM grc_users WHERE grc_users.id = " in q and p[0] in (SEC, REL)]


@pytest.mark.parametrize("query, expect", [
    ("tier=critical", ["Bravo", "Alpha"]),
    ("tier=critical&tier=high", ["Foxtrot", "Charlie", "Bravo", "Alpha"]),
    ("tier=critical,high", ["Foxtrot", "Charlie", "Bravo", "Alpha"]),
    ("tier=", ["Foxtrot", "Echo", "Delta", "Charlie", "Bravo", "Alpha"]),
    ("status=suspended", ["Echo"]),
    ("status=suspended&status=onboarding", ["Foxtrot", "Echo"]),
    ("tier=high&status=onboarding", ["Foxtrot"]),
    ("attention=not_tiered", ["Delta"]),
    ("attention=suspended&attention=not_tiered", ["Echo", "Delta"]),
    ("attention=reassessment_overdue", ["Foxtrot"]),
    ("attention=no_owner", ["Bravo"]),
    ("attention=none", ["Charlie", "Alpha"]),
    ("attention=none&attention=no_owner", ["Charlie", "Bravo", "Alpha"]),
    ("attention=weak_grade", []),
    ("attention=nonsense", []),
    ("owner=unassigned", ["Bravo"]),
    (f"owner={ADA}", ["Echo", "Delta", "Alpha"]),
    ("owner=nobody-at-all", []),
    ("owner=9999", []),
    ("holds_personal_data=true", ["Alpha"]),
    ("holds_personal_data=false", ["Bravo"]),
    ("business_unit_id=1", ["Charlie", "Alpha"]),
    ("business_unit_id=1&business_unit_id=2", ["Charlie", "Bravo", "Alpha"]),
    ("tier=critical&holds_personal_data=true&business_unit_id=1", ["Alpha"]),
    ("tier=critical&holds_personal_data=true&business_unit_id=2", []),
    ("attention=none&owner=unassigned", []),
    ("search=zzz", []),
    ("search=ha", ["Charlie", "Alpha"]),
    ("search=ha&attention=none&tier=high", ["Charlie"]),
])
def test_the_register_filters_and_its_total_follows_them(db, register, query, expect):
    r = client(db).get(f"/vendor-risk/vendors?{query}")
    assert names(r) == expect and r.json()["total"] == len(expect)


def test_me_is_the_person_asking(db, register):
    assert names(client(db, BEN).get("/vendor-risk/vendors?owner=me")) == ["Foxtrot", "Charlie"]
    assert names(client(db, ADMIN).get("/vendor-risk/vendors?owner=me")) == []


ORDERS = {
    "risk": ["Bravo", "Alpha", "Delta", "Charlie", "Foxtrot", "Echo"],            # critical (unowned first), untiered, high, low
    "name": ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
    "tier": ["Alpha", "Bravo", "Delta", "Charlie", "Foxtrot", "Echo"],
    "status": ["Echo", "Foxtrot", "Alpha", "Bravo", "Charlie", "Delta"],          # suspended, onboarding, then active
    "grade": ["Alpha", "Bravo", "Foxtrot", "Charlie", "Delta", "Echo"],           # B, C, F, then the ungraded by name
    "owner": ["Alpha", "Delta", "Echo", "Charlie", "Foxtrot", "Bravo"],           # Ada, Ben, then nobody
    "next_reassessment": ["Foxtrot", "Bravo", "Alpha", "Charlie", "Delta", "Echo"],
    "annual_value": ["Bravo", "Alpha", "Charlie", "Delta", "Echo", "Foxtrot"],
}
DESCENDING = {
    "risk": list(reversed(ORDERS["risk"])),
    "name": list(reversed(ORDERS["name"])),
    "tier": ["Echo", "Charlie", "Foxtrot", "Delta", "Alpha", "Bravo"],             # the name still runs a to z within a tier
    "status": ["Alpha", "Bravo", "Charlie", "Delta", "Foxtrot", "Echo"],
    "grade": ["Foxtrot", "Bravo", "Alpha", "Charlie", "Delta", "Echo"],           # the ungraded stay last
    "owner": ["Charlie", "Foxtrot", "Alpha", "Delta", "Echo", "Bravo"],           # nobody stays last; ties by name
    "next_reassessment": ["Alpha", "Bravo", "Foxtrot", "Charlie", "Delta", "Echo"],
    "annual_value": ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"],
}


@pytest.mark.parametrize("sort", ORDERS)
def test_the_register_is_ordered_by_the_server_whole_not_page_by_page(db, register, sort):
    web = client(db)
    assert names(web.get(f"/vendor-risk/vendors?sort={sort}")) == ORDERS[sort]
    assert names(web.get(f"/vendor-risk/vendors?sort={sort}&dir=asc")) == ORDERS[sort]
    assert names(web.get(f"/vendor-risk/vendors?sort={sort}&dir=desc")) == DESCENDING[sort]
    pages = [names(web.get(f"/vendor-risk/vendors?sort={sort}&limit=2&skip={n}")) for n in (0, 2, 4)]
    assert sum(pages, []) == ORDERS[sort] and all(len(p) == 2 for p in pages)         # no overlap, nothing skipped


def test_a_filter_by_the_next_action_pages_over_the_whole_filtered_set_in_any_order(db, register):
    web = client(db)
    q = "attention=none&attention=not_tiered&attention=suspended&attention=no_owner"   # Charlie Alpha Delta Echo Bravo
    r = web.get(f"/vendor-risk/vendors?{q}&sort=grade&limit=2&skip=1")
    assert names(r) == ["Bravo", "Charlie"] and r.json()["total"] == 5
    assert names(web.get(f"/vendor-risk/vendors?{q}&sort=risk")) == ["Bravo", "Alpha", "Delta", "Charlie", "Echo"]
    assert names(web.get(f"/vendor-risk/vendors?{q}&sort=owner&dir=desc&limit=1&skip=4")) == ["Bravo"]
    assert names(web.get(f"/vendor-risk/vendors?{q}&limit=2&skip=4")) == ["Alpha"]         # newest first, the last page


def test_a_sort_or_direction_the_register_does_not_know_is_refused(db, register):
    web = client(db)
    assert web.get("/vendor-risk/vendors?sort=colour").status_code == 422
    assert web.get("/vendor-risk/vendors?sort=name&dir=sideways").status_code == 422


@pytest.mark.parametrize("sort", [k for k in ORDERS if k != "grade"])        # grade is the one order worked out in Python
@pytest.mark.parametrize("descending", [False, True])
def test_every_order_is_an_order_by_on_postgres_with_the_empty_last_and_the_id_last(db, sort, descending):
    q = db.query(Vendor).outerjoin(GRCUser, GRCUser.id == Vendor.owner_id).order_by(*vendor_routes._order(sort, descending))
    sql = str(q.statement.compile(dialect=postgresql.dialect()))
    order = sql.split("ORDER BY", 1)[1]
    assert "NULLS LAST" in order and "grc_vendors.id" in order.replace('"', "")


def test_the_default_order_is_an_order_by_newest_first_on_postgres(db):
    sql = str(db.query(Vendor).order_by(*vendor_routes._order(None, False)).statement.compile(dialect=postgresql.dialect()))
    assert sql.split("ORDER BY", 1)[1].strip() == "grc_vendors.created_at DESC, grc_vendors.id DESC"
