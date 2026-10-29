"""TPRM parity, piece B5b (2026-10-29): Shadow SaaS, recorded by hand and linked to a supplier we already have (R10).

An app can be recorded by hand (name, people; source "Entered by hand"). A pending app that already is a supplier is
linked to it, which records the link and the status "Already ours"; onboarding such an app is still refused (409), and
the board says which supplier an app already is. Deny and dismiss keep their required reasons. In-memory SQLite.
"""
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, TPRAShadowApp, Vendor, get_db
from grc.modules.vendor_risk.tpra import graph, rbac, shadow_saas
from grc.routers.auth_router import require_auth

SLACK, ARCHIVED, REQUEST = 1, 2, 3


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="it", email="it@acme.test", display_name="Ira IT", is_active=True))
    s.add_all([Vendor(id=SLACK, tenant_id=1, name="Slack Technologies", status="active", website="https://slack.com", owner_id=7),
               Vendor(id=ARCHIVED, tenant_id=1, name="Old Tool", status="offboarded", website="https://oldtool.example",
                      deleted_at=__import__("datetime").datetime.utcnow())])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(graph, "shadow_suppliers", lambda db, tid, limit=100: [])
    app = FastAPI()
    app.include_router(shadow_saas.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _app(db, name="Canva", domain="canva.com", **kw):
    a = TPRAShadowApp(**{"tenant_id": 1, "name": name, "domain": domain, "status": "pending", "source": "csv", **kw})
    db.add(a)
    db.commit()
    return a


# ── record by hand ───────────────────────────────────────────────────────────

def test_an_app_can_be_recorded_by_hand_with_the_people_who_use_it(db, client):
    made = client.post("/shadow-saas", json={"name": "  Figma ", "users": 14})
    assert made.status_code == 201, made.text
    row = made.json()
    assert (row["name"], row["users"], row["source"], row["status"], row["domain"]) == ("Figma", 14, "manual", "pending", None)
    assert row["risk"] > 0 and row["level"] in ("low", "medium", "high")
    app = db.get(TPRAShadowApp, row["id"])
    assert (app.tenant_id, app.status, app.source, app.users) == (1, "pending", "manual", 14)
    trail = db.query(TPRAAuditLog).filter_by(entity="shadow_app", action="create", entity_id=app.id).one()
    assert trail.actor_id == 7 and trail.to_value == "Figma"

    board = client.get("/shadow-saas").json()
    assert [r["name"] for r in board["items"]] == ["Figma"] and board["counts"]["pending"] == 1 and board["people_on_pending"] == 14


def test_recording_checks_the_fields_and_does_not_list_an_app_twice(db, client):
    with_domain = client.post("/shadow-saas", json={"name": "Notion", "domain": "https://www.Notion.so/login"})
    assert with_domain.status_code == 201 and with_domain.json()["domain"] == "notion.so" and with_domain.json()["users"] is None
    assert client.post("/shadow-saas", json={"name": "notion"}).status_code == 409                    # same name
    assert client.post("/shadow-saas", json={"name": "Notion Calendar", "domain": "notion.so"}).status_code == 409   # same domain
    assert client.post("/shadow-saas", json={"name": "   "}).status_code == 422
    assert client.post("/shadow-saas", json={"name": "Nobody", "users": -3}).status_code == 422
    assert client.post("/shadow-saas", json={"name": "Odd", "domain": "not a domain"}).status_code == 400
    assert db.query(TPRAShadowApp).count() == 1


def test_recording_needs_the_right_to_edit_suppliers(db, monkeypatch):
    def deny(_db, user, resource, action="edit", allow_fallback=True):
        raise HTTPException(403, "Permission denied")

    monkeypatch.setattr(rbac, "require_write", deny)
    app = FastAPI()
    app.include_router(shadow_saas.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    assert TestClient(app).post("/shadow-saas", json={"name": "Figma"}).status_code == 403
    assert db.query(TPRAShadowApp).count() == 0


# ── link to a supplier we already have ───────────────────────────────────────

def test_a_pending_app_can_be_linked_to_the_supplier_it_already_is(db, client):
    app = _app(db, "Slack", "slack.com")
    assert client.post(f"/shadow-saas/{app.id}/onboard", json={}).status_code == 409                # as before: it is a supplier already

    linked = client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": SLACK, "note": "  The same   workspace "})
    assert linked.status_code == 200, linked.text
    row = linked.json()
    assert (row["status"], row["vendor_id"], row["vendor_name"], row["decided_by"]) == ("linked", SLACK, "Slack Technologies", "Ira IT")
    assert row["decision_note"] == "The same workspace" and row["decided_at"]
    trail = db.query(TPRAAuditLog).filter_by(entity="shadow_app", action="decide", entity_id=app.id).one()
    assert (trail.from_value, trail.to_value, trail.vendor_id) == ("pending", "linked", SLACK)

    board = client.get("/shadow-saas").json()
    assert board["counts"]["linked"] == 1 and board["counts"]["pending"] == 0
    assert [r["name"] for r in client.get("/shadow-saas", params={"status": "linked"}).json()["items"]] == ["Slack"]
    assert client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": SLACK}).status_code == 400   # decided once


def test_a_link_needs_a_live_supplier_in_this_tenant(db, client):
    app = _app(db)
    assert client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": 999}).status_code == 404
    assert client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": ARCHIVED}).status_code == 404   # archived: not ours any more
    db.add(Vendor(id=40, tenant_id=2, name="Elsewhere", status="active"))
    db.commit()
    assert client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": 40}).status_code == 404
    assert db.get(TPRAShadowApp, app.id).status == "pending"


def test_a_wrong_link_can_be_undone_and_deny_and_dismiss_keep_their_reasons(db, client):
    app = _app(db)
    client.post(f"/shadow-saas/{app.id}/link", json={"vendor_id": SLACK})
    back = client.post(f"/shadow-saas/{app.id}/reopen")
    assert back.status_code == 200 and back.json()["status"] == "pending" and back.json()["vendor_id"] is None
    assert client.post(f"/shadow-saas/{app.id}/deny", json={"note": "no"}).status_code == 400
    assert client.post(f"/shadow-saas/{app.id}/dismiss", json={"note": "no"}).status_code == 400
    assert client.post(f"/shadow-saas/{app.id}/dismiss", json={"note": "A browser extension, not a service"}).status_code == 200
    onboarded = _app(db, "Miro", "miro.com", status="onboarded", vendor_id=SLACK)
    assert client.post(f"/shadow-saas/{onboarded.id}/reopen").status_code == 400                        # an onboarded app has a request


def test_the_board_says_which_supplier_a_pending_app_already_is(db, client):
    _app(db, "Slack", "slack.com")
    _app(db, "Canva", "canva.com")
    items = {r["name"]: r for r in client.get("/shadow-saas").json()["items"]}
    assert items["Slack"]["supplier"] == {"id": SLACK, "name": "Slack Technologies"} and items["Canva"]["supplier"] is None
    by_name = _app(db, "Slack Technologies", "slack-tech.example")
    assert {r["id"]: r["supplier"] for r in client.get("/shadow-saas").json()["items"]}[by_name.id]["id"] == SLACK
