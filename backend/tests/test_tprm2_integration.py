"""TPRM parity, integration fixes (2026-10-30), found by walking the merged module in a browser.

The Register's Tier filter went by the raw tier column, which holds the default "medium" for a supplier nobody has tiered, so
filtering on Medium listed suppliers the page shows as "Not tiered". The program dashboard counted onboarding requests as
suppliers, so its "Active vendors" disagreed with the module header and the register. In-memory SQLite.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Role, Tenant, UserRole, Vendor, get_db
from grc.modules.vendor_risk.routers import vendors as vendor_routes
from grc.modules.vendor_risk.tpra import dashboard
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
def web(db):
    app = FastAPI()
    app.include_router(dashboard.router, prefix="/vendor-risk")
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    return TestClient(app)


def _vendor(db, name, **kw):
    db.add(Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", **kw}))
    db.commit()


def test_a_supplier_nobody_has_tiered_is_not_listed_under_the_default_tier(db, web):
    _vendor(db, "Tiered medium", inherent_risk_score=45.0)
    _vendor(db, "Never tiered")                                   # the column holds the default, "medium"
    _vendor(db, "Tiered high", tier="high", inherent_risk_score=70.0)
    listed = lambda q: [v["name"] for v in web.get(f"/vendor-risk/vendors?{q}").json()["items"]]
    assert listed("tier=medium") == ["Tiered medium"]
    assert listed("tier=medium&tier=high") == ["Tiered high", "Tiered medium"]
    assert sorted(listed("")) == ["Never tiered", "Tiered high", "Tiered medium"]      # no filter: all of them, as before


def test_the_dashboard_counts_suppliers_not_requests(db, web):
    _vendor(db, "In use", inherent_risk_score=45.0)
    _vendor(db, "Being onboarded", intake_status="in_review")
    _vendor(db, "Approved", intake_status="approved")
    for state in ("draft", "submitted", "rejected"):
        _vendor(db, f"Request {state}", intake_status=state, status="requested")
    kpis = web.get("/vendor-risk/tpra/dashboard").json()["kpis"]
    assert kpis["active_vendors"] == 3                            # the three the register lists, not the requests


def test_the_intake_stage_accepts_the_suppliers_own_classification(db):
    from grc.models import VendorAssessment
    from grc.modules.vendor_risk.tpra import service

    v = Vendor(tenant_id=1, name="Classified Co", tier="medium", status="active", owner_id=ADMIN,
               data_classification="confidential", data_access_level="none")
    db.add(v)
    db.commit()
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="in_progress", lifecycle_status="active",
                         current_stage="intake", version_no=1)
    db.add(a)
    db.commit()
    assert service.build_stage_context(db, v, a, "intake")["has_data_classification"] is True
    v.data_classification = None
    db.commit()
    assert service.build_stage_context(db, v, a, "intake")["has_data_classification"] is False     # neither field is set
    v.data_access_level = "confidential"                                                           # the older field still counts
    db.commit()
    assert service.build_stage_context(db, v, a, "intake")["has_data_classification"] is True


def test_seeding_the_defaults_survives_a_request_that_seeded_them_first(db, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    from grc.models import TPRARiskDomain
    from grc.modules.vendor_risk.tpra import bootstrap

    real_commit, calls = db.commit, []

    def raced():                          # the other request's rows are in by the time this commit runs
        calls.append(1)
        if len(calls) == 1:
            db.rollback()
            real_commit()
            raise IntegrityError("insert", {}, Exception("duplicate key value violates unique constraint uq_tpra_domain_tenant_key"))
        real_commit()

    monkeypatch.setattr(db, "commit", raced)
    assert bootstrap.ensure_tpra_tenant_defaults(db, 1) == {"domains_created": 0, "config_created": False}
    monkeypatch.undo()
    assert db.query(TPRARiskDomain).filter_by(tenant_id=1).count() == 0         # nothing half-written is left behind
    assert bootstrap.ensure_tpra_tenant_defaults(db, 1)["domains_created"] > 0   # and the next call seeds them as usual
