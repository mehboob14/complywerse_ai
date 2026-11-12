"""Risk treatment, internal controls and dependencies: the defects that lost data or let anyone write.

- "Complete" sent the achieved reduction as a JSON body, the route read a query parameter: it was never saved.
- New actions must count as open (the old duplicate route saved them as "pending", which no count knew).
- Marking an action completed through the edit form left completed_at empty.
- Write routes checked only that the caller was signed in.
In-memory SQLite.
"""
import importlib
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, InternalControl, IssueAction, Risk, RiskControl, Role, Tenant,
                        UserRole, get_db)
from grc.modules.erm.routers import dependencies as dep_routes
from grc.modules.erm.routers import internal_controls as ic_routes
from grc.modules.erm.routers import mitigation_actions as routes
from grc.routers.auth_router import create_access_token, require_auth

auth_router = importlib.import_module("grc.routers.auth_router")      # the package re-exports a router under the same name
OFFICER, VIEWER, OWNER = 7, 8, 9


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=VIEWER, username="viewer", display_name="Viewer", email="viewer@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True)])
    s.add(UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.add_all([Risk(id=1, tenant_id=1, title="Wire fraud", category="operational", status="open"),
               Risk(id=2, tenant_id=1, title="Core outage", category="operational", status="open")])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    for r in (routes.router, routes.risk_actions_router, dep_routes.router, ic_routes.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def _create(http, **extra):
    made = http.post("/risks/1/mitigation-actions", json={"title": "Add call-back checks", "owner_id": OWNER, **extra})
    assert made.status_code == 201, made.text
    return made.json()


def test_a_new_action_is_open_and_shows_in_the_tenant_list_and_the_overdue_count(db):
    http = client(db)
    body = _create(http, due_date=(datetime.utcnow() - timedelta(days=3)).isoformat())
    assert body["status"] == "planned" and body["owner_name"]   # the CAPA list (wave 2-E) == "Olu Owner"
    listed = http.get("/mitigation-actions").json()
    assert [a["id"] for a in listed] == [body["id"]] and listed[0]["owner_name"] == "Olu Owner"
    assert [a["id"] for a in http.get("/mitigation-actions/overdue").json()] == [body["id"]]
    # finished actions leave the overdue count
    http.post(f"/mitigation-actions/{body['id']}/complete", json={})
    assert http.get("/mitigation-actions/overdue").json() == []


def test_completing_saves_the_achieved_reduction_from_the_json_body(db):
    http = client(db)
    action = _create(http, expected_residual_reduction=30)
    done = http.post(f"/mitigation-actions/{action['id']}/complete", json={"actual_residual_reduction": 22.5})
    assert done.status_code == 200, done.text
    row = db.get(IssueAction, action["id"])        # actions are CAPA actions since wave 2-E
    db.refresh(row)
    assert (row.status, row.actual_residual_reduction) == ("completed", 22.5) and row.completed_at is not None
    # the older query-parameter form still works
    other = _create(http)
    assert http.post(f"/mitigation-actions/{other['id']}/complete", params={"actual_reduction": 10}).json()[
        "actual_residual_reduction"] == 10


def test_marking_completed_through_the_edit_form_stamps_completed_at(db):
    http = client(db)
    action = _create(http)
    edited = http.put(f"/mitigation-actions/{action['id']}", json={"status": "completed"})
    assert edited.status_code == 200, edited.text
    assert edited.json()["completed_at"] is not None
    # a blank due date is saved as none, not today
    cleared = http.put(f"/mitigation-actions/{action['id']}", json={"due_date": None})
    assert cleared.json()["due_date"] is None


def test_a_view_only_user_cannot_write(db, monkeypatch):
    viewer = client(db, "viewer")
    assert viewer.post("/risks/1/mitigation-actions", json={"title": "x"}).status_code == 403
    assert db.query(IssueAction).count() == 0
    action = _create(client(db))
    assert viewer.put(f"/mitigation-actions/{action['id']}", json={"title": "y"}).status_code == 403
    assert viewer.post(f"/mitigation-actions/{action['id']}/complete", json={}).status_code == 403
    assert viewer.delete(f"/mitigation-actions/{action['id']}").status_code == 403
    assert viewer.post("/dependencies", json={"source_risk_id": 1, "target_risk_id": 2}).status_code == 403
    assert viewer.post("/internal-controls", json={"name": "Dual control", "tenant_id": 1}).status_code == 403
    assert viewer.get("/mitigation-actions").status_code == 200          # reading stays on the module's view permission
    # a risk editor keeps working through the erm:risks fallback
    monkeypatch.setattr(auth_router, "has_tenant_permission", lambda db_, user, *names: "erm:risks:create" in names)
    assert viewer.post("/risks/1/mitigation-actions", json={"title": "x"}).status_code == 201


def test_ai_suggest_is_told_the_risks_own_controls(db, monkeypatch):
    db.add_all([InternalControl(id=1, tenant_id=1, control_id="IC-001", name="Call-back verification"),
                InternalControl(id=2, tenant_id=1, control_id="IC-002", name="Unrelated badge control")])
    db.add(RiskControl(tenant_id=1, risk_id=1, control_source="internal", control_id=1))   # the one link (wave 5)
    db.commit()
    prompts = []

    def fake_create(**kw):
        prompts.append(kw["messages"][-1]["content"])
        content = json.dumps({"suggestions": []})
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])

    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create)))
    monkeypatch.setattr(routes, "_get_openai_client", lambda: fake)
    http = client(db)
    assert http.post("/mitigation-actions/ai-suggest", json={"risk_id": 1}).status_code == 200
    assert "Call-back verification" in prompts[-1] and "Unrelated badge control" not in prompts[-1]
    # a risk with no linked controls falls back to the tenant's controls
    assert http.post("/mitigation-actions/ai-suggest", json={"risk_id": 2}).status_code == 200
    assert "Unrelated badge control" in prompts[-1]
