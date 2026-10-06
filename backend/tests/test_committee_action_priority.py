"""A committee action has a priority, the priority sets its SLA, and every action is a Task Management task too.

The SLA is Task Management's own SLA table (Settings, module "tasks"), so changing it once changes both places. An
edit on either side shows on the other, and deleting a twin or a committee removes what it mirrored.
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, CriticalTask, GovernanceCommittee, GRCUser, OversightAction, Tenant, get_db
from grc.modules.governance import committee_tasks
from grc.modules.governance.routers import committees
from grc.routers.auth_router import require_auth
from grc.services import module_settings

# the module itself: grc.routers re-exports its APIRouter under the same name
critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    for uid, name in ((7, "officer"), (8, "ayesha"), (9, "bilal")):
        s.add(GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True))
    s.add(GovernanceCommittee(id=1, tenant_id=1, name="Risk Committee", committee_type="risk_committee"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(critical_tasks_router, "_send_notification_email", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(committees.router)
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    return TestClient(app)


def new_action(http, **fields):
    made = http.post("/committees/actions/manual", json={"committee_id": 1, "title": "Review the cyber policy", **fields})
    assert made.status_code == 201, made.text
    return made.json()


def days_from_now(value):
    return (datetime.fromisoformat(value) - datetime.utcnow()).total_seconds() / 86400


def test_the_priority_sets_the_sla_and_the_action_shows_in_task_management(db, http):
    high = new_action(http, priority="high", assigned_to=8)
    assert high["priority"] == "high" and high["sla"]["target_days"] == 30 and high["sla"]["state"] == "on_track"
    assert round(days_from_now(high["due_date"])) == 30

    twin = db.get(CriticalTask, high["critical_task_id"])
    assert (twin.source_module, twin.source_entity_type, twin.source_entity_id) == ("committees", "OversightAction", high["id"])
    assert twin.priority == "High" and twin.sla_days == 30 and twin.status == "Open"
    assert twin.assigned_user_ids == [8] and twin.assigned_owner_id == 8
    assert twin.due_date.isoformat().startswith(high["due_date"][:16])

    # no priority means medium; a date somebody chose is kept; an unknown priority is refused
    assert new_action(http)["priority"] == "medium"
    medium = new_action(http, due_date="2027-03-01T00:00:00")
    assert medium["due_date"].startswith("2027-03-01") and medium["sla"]["target_days"] == 90
    assert http.post("/committees/actions/manual", json={"committee_id": 1, "title": "x", "priority": "urgent"}).status_code == 400


def test_changing_the_sla_table_changes_the_days_for_new_and_existing_actions(db, http):
    before = new_action(http, priority="critical")
    assert before["sla"]["target_days"] == 7
    module_settings.save_settings(db, 1, "tasks", {"sla": {"targets": {"critical": {"days": 20}}}}, user_id=7)

    after = new_action(http, priority="critical")
    assert round(days_from_now(after["due_date"])) == 20 and db.get(CriticalTask, after["critical_task_id"]).sla_days == 20
    listed = {a["id"]: a for a in http.get("/committees/actions").json()["items"]}
    assert listed[before["id"]]["sla"]["target_days"] == 20         # the clock reads the table live
    assert listed[after["id"]]["sla"]["state"] == "on_track"


def test_an_action_past_its_date_is_breached(db, http):
    late = new_action(http, priority="high", due_date=(datetime.utcnow() - timedelta(days=5)).isoformat())
    row = next(a for a in http.get("/committees/actions").json()["items"] if a["id"] == late["id"])
    assert row["sla"]["state"] == "breached" and row["sla"]["days_overdue"] >= 5 and row["is_overdue"]
    done = http.patch(f"/committees/actions/{late['id']}", json={"status": "completed"}).json()
    assert done["sla"]["state"] == "closed"


def test_an_edit_on_either_side_shows_on_the_other(db, http):
    action = new_action(http, priority="medium", assigned_to=8)
    twin_id = action["critical_task_id"]

    # committee → Task Management: done, and re-prioritised (the date was only the old SLA, so it moves)
    patched = http.patch(f"/committees/actions/{action['id']}", json={"status": "completed", "priority": "critical"}).json()
    assert patched["priority"] == "critical" and patched["sla"]["target_days"] == 7
    assert round(days_from_now(patched["due_date"])) == 7
    db.expire_all()
    twin = db.get(CriticalTask, twin_id)
    assert twin.status == "Completed" and twin.completed_at is not None and twin.priority == "Critical" and twin.sla_days == 7
    assert twin.due_date.isoformat().startswith(patched["due_date"][:16])

    # a date somebody chose stays when the priority changes
    kept = http.patch(f"/committees/actions/{action['id']}", json={"priority": "low", "due_date": "2027-06-30T00:00:00"}).json()
    assert kept["due_date"].startswith("2027-06-30") and kept["priority"] == "low"
    again = http.patch(f"/committees/actions/{action['id']}", json={"priority": "high"}).json()
    assert again["due_date"].startswith("2027-06-30")

    # Task Management → committee: reopened, re-prioritised, re-dated, reassigned to two people
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "Reopened"}).status_code == 200
    assert http.put(f"/critical-tasks/{twin_id}", json={"priority": "Low", "due_date": "2027-08-15T00:00:00",
                                                        "assigned_user_ids": [9, 8], "title": "Review the policy"}).status_code == 200
    db.expire_all()
    back = db.get(OversightAction, action["id"])
    assert back.status == "in_progress" and back.completed_at is None and back.priority == "low"
    assert back.due_date.isoformat().startswith("2027-08-15") and back.assigned_to == 9 and back.title == "Review the policy"

    # a committee edit keeps the extra assignee and a finer Task Management step
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "In Progress"}).status_code == 200
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "Under Review"}).status_code == 200
    assert http.patch(f"/committees/actions/{action['id']}", json={"description": "Now with the new standard"}).status_code == 200
    db.expire_all()
    twin = db.get(CriticalTask, twin_id)
    assert twin.status == "Under Review" and twin.assigned_user_ids == [9, 8] and twin.description == "Now with the new standard"
    assert http.patch(f"/committees/actions/{action['id']}", json={"assigned_to": 7}).status_code == 200
    db.expire_all()
    assert db.get(CriticalTask, twin_id).assigned_user_ids == [7]


def test_deleting_a_twin_or_a_committee_removes_what_it_mirrored(db, http):
    first, second = new_action(http, title="A"), new_action(http, title="B")
    assert http.delete(f"/critical-tasks/{first['critical_task_id']}").status_code == 204
    db.expire_all()
    assert db.get(OversightAction, first["id"]) is None and db.get(OversightAction, second["id"]) is not None

    assert http.delete("/committees/1").status_code == 204
    db.expire_all()
    assert db.query(OversightAction).count() == 0 and db.query(CriticalTask).count() == 0


def test_actions_made_before_twins_existed_get_one(db):
    db.add(OversightAction(id=40, tenant_id=1, committee_id=1, title="Old action", status="completed", assigned_to=8,
                           priority=None, created_at=datetime.utcnow() - timedelta(days=400)))
    db.commit()
    assert committee_tasks.backfill(db) == 1 and committee_tasks.backfill(db) == 0       # once only
    db.commit()
    twin = db.query(CriticalTask).one()
    assert twin.status == "Completed" and twin.assigned_user_ids == [8] and twin.priority == "Medium"
    assert twin.source_entity_id == 40
