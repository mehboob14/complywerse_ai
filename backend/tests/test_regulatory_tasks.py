"""A regulatory task is a Task Management task too, for everyone on it.

Tasks raised on a regulatory change show in Task Management with every assignee,
and an edit on either side shows on the other. A task raised from an obligation
stays with that obligation, and deleting either twin deletes both.
"""
import importlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AuditLog, Base, CriticalTask, CriticalTaskApproval, CriticalTaskComment, CriticalTaskHistory, CriticalTaskSubTask,
    GovernanceDocument, GRCUser, NormalizedControl, NotificationPreference, RegulatoryChange,
    RegulatoryImpactAssessment, RegulatoryImplementationTask, RegulatoryLink, RegulatoryObligation, Tenant, get_db,
)
from grc.modules.governance import regulatory_tasks
from grc.modules.governance.routers import regulatory_changes
from grc.routers.auth_router import require_auth

# the module itself: grc.routers re-exports its APIRouter under the same name
critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")

_TABLES = [Tenant, GRCUser, RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
           RegulatoryObligation, RegulatoryLink, GovernanceDocument, NormalizedControl, AuditLog, CriticalTask,
           CriticalTaskSubTask, CriticalTaskComment, CriticalTaskHistory, CriticalTaskApproval, NotificationPreference]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    for uid, name in ((7, "officer"), (8, "ayesha"), (9, "bilal")):
        s.add(GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True))
    s.add(RegulatoryChange(id=1, tenant_id=1, title="Cyber resilience", source="SBP", status="identified",
                           priority="high", created_by=7))
    s.add(RegulatoryObligation(id=5, tenant_id=1, regulatory_change_id=1, ref="4.2",
                               summary="Report major incidents within 24 hours"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(critical_tasks_router, "_send_notification_email", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(regulatory_changes.router)
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    return TestClient(app)


def test_a_task_raised_from_an_obligation_shows_in_task_management_for_everyone_on_it(db, http):
    made = http.post("/regulatory-changes/changes/1/tasks", json={
        "title": "Set up the 24-hour incident report", "task_type": "process_change", "priority": "high",
        "assignee_ids": [8, 9], "obligation_id": 5, "due_date": "2026-11-30"})
    assert made.status_code == 201, made.text
    task = made.json()
    assert task["assignee_ids"] == [8, 9] and task["assigned_to"] == 8 and task["obligation_id"] == 5
    assert [a["display_name"] for a in task["assignees"]] == ["Ayesha", "Bilal"]

    twin = db.get(CriticalTask, task["critical_task_id"])
    assert (twin.source_module, twin.source_entity_type, twin.source_entity_id) == (
        "regulatory_changes", "RegulatoryImplementationTask", task["id"])
    assert twin.assigned_user_ids == [8, 9] and twin.assigned_owner_id == 8 and twin.status == "Open"
    assert twin.priority == "High" and twin.linked_regulatory_change_id == 1
    # the second assignee sees it among their own tasks too
    monkey_user = db.get(GRCUser, 9)
    http.app.dependency_overrides[require_auth] = lambda: monkey_user
    assert [t["id"] for t in http.get("/critical-tasks/my-tasks").json()] == [twin.id]

    # the obligation's tasks, and nothing else
    assert [t["id"] for t in http.get("/regulatory-changes/changes/1/tasks?obligation_id=5").json()] == [task["id"]]
    assert http.post("/regulatory-changes/changes/1/tasks", json={
        "title": "x", "task_type": "process_change", "obligation_id": 999}).status_code == 400


def test_an_edit_on_either_side_shows_on_the_other(db, http):
    task = http.post("/regulatory-changes/changes/1/tasks", json={
        "title": "Brief the board", "task_type": "communication", "assignee_ids": [8]}).json()
    twin_id = task["critical_task_id"]

    # regulatory side → Task Management
    assert http.patch(f"/regulatory-changes/tasks/{task['id']}", json={"status": "completed", "assignee_ids": [9, 8]}).status_code == 200
    db.expire_all()
    twin = db.get(CriticalTask, twin_id)
    assert twin.status == "Completed" and twin.completed_at is not None and twin.assigned_user_ids == [9, 8]

    # Task Management → regulatory side: reopened, reassigned, re-dated
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "Reopened"}).status_code == 200
    assert http.put(f"/critical-tasks/{twin_id}", json={"assigned_user_ids": [8], "due_date": "2026-12-15T00:00:00"}).status_code == 200
    db.expire_all()
    back = db.get(RegulatoryImplementationTask, task["id"])
    assert back.status == "in_progress" and back.completed_at is None
    assert back.assignee_ids == [8] and back.assigned_to == 8 and back.due_date.isoformat().startswith("2026-12-15")

    # a finer Task Management step that means the same isn't flattened by the next regulatory edit
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "In Progress"}).status_code == 200
    assert http.post(f"/critical-tasks/{twin_id}/transition", json={"new_status": "Under Review"}).status_code == 200
    assert http.patch(f"/regulatory-changes/tasks/{task['id']}", json={"title": "Brief the board in October"}).status_code == 200
    db.expire_all()
    assert db.get(CriticalTask, twin_id).status == "Under Review"
    assert db.get(CriticalTask, twin_id).title == "Brief the board in October"


def test_deleting_either_twin_deletes_both(db, http):
    first = http.post("/regulatory-changes/changes/1/tasks", json={"title": "A", "task_type": "training"}).json()
    second = http.post("/regulatory-changes/changes/1/tasks", json={"title": "B", "task_type": "training"}).json()

    assert http.delete(f"/regulatory-changes/tasks/{first['id']}").status_code == 200
    assert http.delete(f"/critical-tasks/{second['critical_task_id']}").status_code == 204
    db.expire_all()
    assert db.query(RegulatoryImplementationTask).count() == 0 and db.query(CriticalTask).count() == 0


def test_tasks_made_before_twins_existed_get_one(db):
    db.add(RegulatoryImplementationTask(id=40, tenant_id=1, regulatory_change_id=1, title="Old task",
                                        task_type="training", status="completed", priority="low", assigned_to=8))
    db.commit()
    assert regulatory_tasks.backfill(db) == 1 and regulatory_tasks.backfill(db) == 0     # once only
    db.commit()
    twin = db.query(CriticalTask).one()
    assert twin.status == "Completed" and twin.assigned_user_ids == [8] and twin.source_entity_id == 40


def test_an_obligation_can_have_several_owners(db, http):
    got = http.patch("/regulatory-changes/obligations/5", json={"owner_ids": [9, 8]})
    assert got.status_code == 200, got.text
    assert got.json()["owner_ids"] == [9, 8] and got.json()["owner_id"] == 9
    assert [o["display_name"] for o in got.json()["owners"]] == ["Bilal", "Ayesha"]
    assert http.patch("/regulatory-changes/obligations/5", json={"owner_ids": [404]}).status_code == 400
