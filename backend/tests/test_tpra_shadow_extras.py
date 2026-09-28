"""Shadow SaaS extras: who uses each app, a daily Grip sync, and any domain at the gateway.

Grip's users list names the apps each person uses, however it spells them; each
app keeps its roster, and a roster Grip will not give leaves the apps as they
are. The daily sync runs when the tenant asked for it, once a day. Any domain can
be put on the Zscaler block category or taken off it, for a reason that is kept.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, TPRAShadowApp, TPRATieringConfig, get_db
from grc.modules.connectors.providers import saas_governance
from grc.modules.vendor_risk.tpra import monitoring_policy, rbac, shadow_saas
from grc.routers.auth_router import require_auth

CREDS = {"base_url": "https://acme.dep.grip.security/public/saas", "api_token": "t"}


class _Resp:
    def __init__(self, body, code=200):
        self.body, self.status_code = body, code

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


APPS = [{"id": "g1", "name": "FileDrop", "url": "https://filedrop.example", "gripData": {"numberOfUsers": 3}},
        {"id": "g2", "name": "NoteHub", "url": "https://notehub.example", "gripData": {"numberOfUsers": 1}}]
USERS = [{"email": "ann@acme.test", "name": "Ann", "department": "Sales", "saas": [{"id": "g1", "name": "FileDrop"}]},
         {"email": "bo@acme.test", "firstName": "Bo", "lastName": "Li", "apps": ["NoteHub", "filedrop"]},
         {"department": "Nobody"}]


def fake_get(users=USERS):
    def get(url, **kw):
        if url.endswith("/users"):
            if isinstance(users, Exception):
                raise users
            return _Resp(users)
        return _Resp(APPS)
    return get


def test_rosters_come_from_the_users_list_however_it_names_the_apps():
    who = saas_governance.rosters(USERS)
    assert [p["email"] for p in who["g1"]] == ["ann@acme.test"]
    assert [p["name"] for p in who["filedrop"]] == ["Bo Li"] and who["notehub"][0]["email"] == "bo@acme.test"
    assert saas_governance._sibling(CREDS["base_url"], "users") == "https://acme.dep.grip.security/public/users"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.commit()
    yield s
    s.close()


def test_a_sync_keeps_each_apps_roster_and_survives_without_one(db, monkeypatch):
    monkeypatch.setattr(shadow_saas, "connection", lambda db, tid, category, integration: CREDS)
    result = shadow_saas.sync_from_grip(db, 1, 7, get=fake_get())
    apps = {a.name: a for a in db.query(TPRAShadowApp)}
    assert result["new"] == 2 and result["people"] == 3
    assert sorted(p["email"] for p in apps["FileDrop"].people) == ["ann@acme.test", "bo@acme.test"]   # by id or by name
    assert apps["NoteHub"].people[0]["name"] == "Bo Li"
    again = shadow_saas.sync_from_grip(db, 1, 7, get=fake_get(RuntimeError("users endpoint down")))
    assert again["people"] is None and apps["FileDrop"].people                        # kept from last time


def test_the_daily_sync_runs_when_asked_and_once_a_day(db, monkeypatch):
    monkeypatch.setattr(shadow_saas, "connection", lambda db, tid, category, integration: CREDS)
    ran = []
    monkeypatch.setattr(shadow_saas, "sync_from_grip",
                        lambda db, tid, actor, get=None: ran.append(tid) or db.add(TPRAAuditLog(
                            tenant_id=tid, entity="shadow_app", action="sync", created_at=datetime.utcnow())) or {"new": 0})
    assert shadow_saas.scheduled_sync(db, 1) is None and ran == []                 # not asked for
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True, monitoring_policy={"grip_daily": True}))
    db.commit()
    assert shadow_saas.scheduled_sync(db, 1) == {"new": 0} and ran == [1]
    db.commit()
    assert shadow_saas.scheduled_sync(db, 1) is None                                 # once a day
    assert shadow_saas.scheduled_sync(db, 1, now=datetime.utcnow() + timedelta(days=1)) == {"new": 0}
    assert monitoring_policy.clean({"grip_daily": 1}, None)["grip_daily"] is True


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(shadow_saas, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(shadow_saas.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_any_domain_can_be_blocked_or_allowed_for_a_reason(db, http, monkeypatch):
    done = []

    class Gateway:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def block(self, domain):
            done.append(("block", domain))

        def allow(self, domain):
            done.append(("allow", domain))

    db.add(TPRAShadowApp(tenant_id=1, name="FileDrop", domain="filedrop.example", source="csv", status="pending"))
    db.commit()
    monkeypatch.setattr(shadow_saas, "_gateway", lambda db, tid: None)
    assert http.post("/shadow-saas/gateway", json={"domain": "filedrop.example", "action": "block",
                                                   "reason": "Uploads client files"}).status_code == 400
    monkeypatch.setattr(shadow_saas, "_gateway", lambda db, tid: Gateway)
    assert http.post("/shadow-saas/gateway", json={"domain": "not a domain", "action": "block",
                                                   "reason": "Uploads client files"}).status_code == 400
    assert http.post("/shadow-saas/gateway", json={"domain": "https://FileDrop.example/upload", "action": "block",
                                                   "reason": "Uploads client files"}).json() == {"domain": "filedrop.example", "action": "block"}
    assert db.query(TPRAShadowApp).one().blocked is True
    http.post("/shadow-saas/gateway", json={"domain": "filedrop.example", "action": "allow", "reason": "Approved by legal"})
    assert done == [("block", "filedrop.example"), ("allow", "filedrop.example")] and db.query(TPRAShadowApp).one().blocked is False
    monkeypatch.setattr(shadow_saas, "connection", lambda db, tid, category, integration: {"x": 1})
    history = http.get("/shadow-saas/gateway").json()
    assert [(h["action"], h["reason"], h["by"]) for h in history["items"]] == [
        ("allow", "Approved by legal", "Ana Lyst"), ("block", "Uploads client files", "Ana Lyst")]
    app_id = db.query(TPRAShadowApp).one().id
    assert http.get(f"/shadow-saas/{app_id}/people").json()["items"] == []
