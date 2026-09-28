"""Third-party risk settings name roles and people that exist.

Approvers, escalation and contract contacts are chosen from the tenant's roles
(its own and the built-in ones) and its active people, so a typo cannot point a
reminder at nobody.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Role, Tenant, TPRAAuditLog, TPRATieringConfig, get_db
from grc.modules.vendor_risk.tpra import api as tpra_api
from grc.modules.vendor_risk.tpra import rbac
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Role, TPRATieringConfig, TPRAAuditLog]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Acme", slug="acme"), Tenant(id=2, name="Other", slug="other")])
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", display_name="Ana Lyst", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(tpra_api, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(tpra_api.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_settings_offer_the_roles_and_people_that_exist(db, http):
    db.add_all([Role(tenant_id=1, name="Head of Third-Party Risk"), Role(tenant_id=None, name="admin"),
                Role(tenant_id=2, name="Someone else's role"), Role(tenant_id=1, name="  ")])
    db.add(GRCUser(id=8, username="left", email="l@x.test", is_active=False))
    db.commit()
    got = http.get("/tpra/config/directory").json()
    assert got["roles"] == ["admin", "Head of Third-Party Risk"]
    assert got["people"] == [{"id": 7, "name": "Ana Lyst"}]
