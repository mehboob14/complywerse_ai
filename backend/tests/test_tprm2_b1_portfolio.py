"""TPRM parity, piece B1 (2026-10-29): the small server sides the portfolio pages need.

The register's Business unit filter lists the units a supplier sits in (a read that writes nothing: the tenant list of
units seeds demo ones on a GET); its Archived view lists only the archived suppliers; the Roster and Policy pages are
placed under their own names in the menu the audit log and the workflow builder use. In-memory SQLite.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc import feature_map
from grc.models import BusinessUnit, Base, GRCUser, Role, Tenant, UserRole, Vendor, get_db
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.modules.vendor_risk.tpra import dashboard
from grc.routers.auth_router import require_auth

ADMIN = 1


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Acme Bank", slug="acme"), Tenant(id=2, name="Other Bank", slug="other")])
    s.add(Role(id=1, name="Administrator"))
    s.add(GRCUser(id=ADMIN, username="admin", display_name="Admin", email="admin@acme.test", is_active=True))
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def web(db):
    app = FastAPI()
    app.include_router(dashboard.portfolio_router, prefix="/vendor-risk")
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    return TestClient(app)


def _vendor(db, name, **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


# ── the Business unit filter's options ───────────────────────────────────────

def test_units_are_the_ones_a_supplier_sits_in_by_name_and_only_this_tenants(db):
    db.add_all([BusinessUnit(id=1, tenant_id=1, name="Operations"), BusinessUnit(id=2, tenant_id=1, name="Finance"),
                BusinessUnit(id=3, tenant_id=1, name="Nobody here"), BusinessUnit(id=4, tenant_id=2, name="Elsewhere")])
    db.commit()
    _vendor(db, "A", business_unit_id=1)
    _vendor(db, "B", business_unit_id=1)                     # a second supplier in a unit is still one option
    _vendor(db, "C", business_unit_id=2)
    _vendor(db, "D")                                         # none
    got = web(db).get("/vendor-risk/portfolio/units").json()
    assert got == {"items": [{"id": 2, "name": "Finance"}, {"id": 1, "name": "Operations"}]}


def test_listing_units_is_a_read_it_seeds_nothing(db):
    before = db.query(BusinessUnit).count()
    assert web(db).get("/vendor-risk/portfolio/units").json() == {"items": []}
    assert db.query(BusinessUnit).count() == before == 0


def test_the_register_filters_by_the_unit_the_options_name(db):
    db.add(BusinessUnit(id=1, tenant_id=1, name="Finance"))
    db.commit()
    _vendor(db, "In Finance", business_unit_id=1)
    _vendor(db, "Elsewhere")
    api = web(db)
    unit = api.get("/vendor-risk/portfolio/units").json()["items"][0]["id"]
    assert [r["name"] for r in api.get(f"/vendor-risk/vendors?business_unit_id={unit}").json()["items"]] == ["In Finance"]


# ── the Archived view ────────────────────────────────────────────────────────

def test_the_archived_view_lists_only_archived_suppliers(db):
    _vendor(db, "Live Co", tier="high")
    _vendor(db, "Gone Co", tier="high", deleted_at=datetime.utcnow())
    _vendor(db, "Gone Low", tier="low", deleted_at=datetime.utcnow())
    api = web(db)
    names = lambda url: sorted(r["name"] for r in api.get(url).json()["items"])        # noqa: E731
    assert names("/vendor-risk/vendors") == ["Live Co"]                                   # as it always was
    assert names("/vendor-risk/vendors?include_archived=true") == ["Gone Co", "Gone Low", "Live Co"]
    assert names("/vendor-risk/vendors?archived_only=true") == ["Gone Co", "Gone Low"]
    assert names("/vendor-risk/vendors?archived_only=true&tier=high") == ["Gone Co"]      # filters and paging still apply
    got = api.get("/vendor-risk/vendors?archived_only=true&limit=1").json()
    assert (got["total"], len(got["items"])) == (2, 1)
    assert all(r["archived_at"] for r in got["items"])


# ── Roster and Policy in the menu ────────────────────────────────────────────

def test_the_roster_and_policy_pages_are_placed_under_their_own_names():
    assert feature_map.place(None, "/grc/vendor-risk/roster") == ("Third-Party Vendor Risk", "Roster")
    assert feature_map.place(None, "/grc/vendor-risk/roster/legal/members") == ("Third-Party Vendor Risk", "Roster")
    assert feature_map.place(None, "/grc/vendor-risk/policy") == ("Third-Party Vendor Risk", "Policy")
    assert feature_map.place(None, "/grc/vendor-risk/vendors/4") == ("Third-Party Vendor Risk", "Vendors")   # the rest is unchanged
    pages = {m["module"]: m["submodules"] for m in feature_map.modules()}["Third-Party Vendor Risk"]
    assert {"Roster", "Policy", "Vendors"} <= set(pages)
