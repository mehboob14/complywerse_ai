"""TPRM parity, piece B2 (2026-10-29): what the vendor record page and its Add / Edit dialog read.

The dialog warns about a possible duplicate as the name is typed, and a supplier's page lists the ones it may duplicate:
both ask GET /vendors/duplicates, which is the check POST /vendors makes before it refuses with 409, without the write.
The dialog's business-unit picker reads GET /vendors/units (the tenant list's own endpoint seeds demo units). The
Subprocessors table says how many of our other vendors rely on the same platform: `also_used_by` on each fourth party.
In-memory SQLite.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, BusinessUnit, GRCUser, Role, Tenant, UserRole, Vendor, get_db
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.modules.vendor_risk.tpra import graph
from grc.routers.auth_router import require_auth

ADMIN = 1


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add(GRCUser(id=ADMIN, username="admin", display_name="Admin", email="admin@acme.test", is_active=True))
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.include_router(graph.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


# ── the duplicate check ──────────────────────────────────────────────────────

def test_duplicates_matches_the_way_create_does_and_says_why(db, http):
    acme = _vendor(db, "Acme Analytics, Inc.", website="https://www.acme.example/home")
    got = http.get("/vendor-risk/vendors/duplicates", params={"name": "ACME analytics ltd"}).json()["items"]
    assert [(m["id"], m["name"], m["match"], m["archived"]) for m in got] == [(acme.id, "Acme Analytics, Inc.", "name", False)]
    assert "name matches" in got[0]["reason"] and got[0]["status"] == "active" and got[0]["intake_status"] is None
    # the website alone is enough, and both together say so
    assert http.get("/vendor-risk/vendors/duplicates", params={"name": "Other", "website": "acme.example"}).json()["items"][0]["match"] == "website"
    assert http.get("/vendor-risk/vendors/duplicates", params={"name": "Acme Analytics", "website": "http://acme.example"}).json()["items"][0]["match"] == "both"
    # the very input POST /vendors refuses is the one the check reports
    refused = http.post("/vendor-risk/vendors", json={"name": "ACME analytics ltd"})
    assert refused.status_code == 409 and "Acme Analytics" in refused.json()["detail"]
    assert http.get("/vendor-risk/vendors/duplicates", params={"name": "Nobody Like This"}).json() == {"items": []}


def test_duplicates_leaves_out_the_supplier_it_is_asked_for_and_marks_archived_ones_and_requests(db, http):
    from datetime import datetime

    me = _vendor(db, "Delta Logistics")
    old = _vendor(db, "Delta Logistics Ltd", deleted_at=datetime.utcnow())
    asked = _vendor(db, "Delta Logistics GmbH", intake_status="submitted")
    items = http.get("/vendor-risk/vendors/duplicates", params={"name": me.name, "exclude_id": me.id}).json()["items"]
    assert {m["id"] for m in items} == {old.id, asked.id} and me.id not in {m["id"] for m in items}
    by_id = {m["id"]: m for m in items}
    assert by_id[old.id]["archived"] is True and by_id[asked.id]["intake_status"] == "submitted"
    # in-use suppliers lead the archived ones
    assert [m["id"] for m in items][0] == asked.id


def test_duplicates_writes_nothing_and_a_blank_name_is_refused(db, http):
    _vendor(db, "Echo Hosting")
    before = db.query(Vendor).count()
    http.get("/vendor-risk/vendors/duplicates", params={"name": "Echo Hosting"})
    assert db.query(Vendor).count() == before and not db.dirty and not db.new
    assert http.get("/vendor-risk/vendors/duplicates", params={"name": ""}).status_code == 422
    assert http.get("/vendor-risk/vendors/duplicates").status_code == 422


# ── the business units the dialog offers ─────────────────────────────────────

def test_units_are_listed_by_name_and_never_seeded(db, http):
    assert http.get("/vendor-risk/vendors/units").json() == {"items": []}
    assert db.query(BusinessUnit).count() == 0                     # the tenant list's own endpoint would have made demo ones
    db.add_all([BusinessUnit(id=1, tenant_id=1, name="treasury"), BusinessUnit(id=2, tenant_id=1, name="Retail"),
                BusinessUnit(id=3, tenant_id=1, name="Audit")])
    db.commit()
    assert [u["name"] for u in http.get("/vendor-risk/vendors/units").json()["items"]] == ["Audit", "Retail", "treasury"]


# ── "also used by" on a fourth party ─────────────────────────────────────────

def _fourth(http, vendor, name, **kw):
    r = http.post(f"/vendor-risk/tpra/vendors/{vendor.id}/fourth-parties", json={"name": name, **kw})
    assert r.status_code == 201
    return r.json()


def test_a_fourth_party_says_how_many_of_our_other_vendors_use_its_platform(db, http):
    payroll, crm, mail, quiet = (_vendor(db, n) for n in ("Payroll Co", "CRM Co", "Mail Co", "Quiet Co"))
    first = _fourth(http, payroll, "Amazon Web Services")
    assert first["also_used_by"] == 0                              # nobody else yet
    _fourth(http, crm, "AWS")
    _fourth(http, mail, "amazon aws")
    _fourth(http, payroll, "Stripe", service="payments")
    _fourth(http, quiet, "Linux")                                  # a generic name counts for nothing
    rows = {fp["name"]: fp for fp in http.get(f"/vendor-risk/tpra/vendors/{payroll.id}/fourth-parties").json()["items"]}
    assert rows["Amazon Web Services"]["also_used_by"] == 2 and rows["Stripe"]["also_used_by"] == 0
    assert http.get(f"/vendor-risk/tpra/vendors/{quiet.id}/fourth-parties").json()["items"][0]["also_used_by"] == 0
    # seen from the other vendor's side: payroll and mail are the other two
    assert http.get(f"/vendor-risk/tpra/vendors/{crm.id}/fourth-parties").json()["items"][0]["also_used_by"] == 2


def test_an_edit_and_an_offboarded_vendor_are_counted_the_same_way(db, http):
    a, b = _vendor(db, "A Co"), _vendor(db, "B Co")
    gone = _vendor(db, "Gone Co", status="offboarded")
    fp = _fourth(http, a, "Hetzner Online GmbH")
    _fourth(http, b, "Hetzner Online GmbH")
    _fourth(http, gone, "Hetzner Online GmbH")                     # no longer in use: not counted
    assert http.put(f"/vendor-risk/tpra/fourth-parties/{fp['id']}", json={"name": "Hetzner Online GmbH", "service": "hosting"}).json()["also_used_by"] == 1
    # its own platform seen from an offboarded vendor's page: the two in use rely on it
    assert http.get(f"/vendor-risk/tpra/vendors/{gone.id}/fourth-parties").json()["items"][0]["also_used_by"] == 2
