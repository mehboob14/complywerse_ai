"""A document review, approval or acknowledgement request as a task in Task Management: plain words, buttons that open the
person's own step in the document, nothing that would take the task out of step with the request (its person, due date and
status follow the request; only an administrator may delete it), and every field of it set in Governance > Settings."""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.routers.auth_router import require_auth

from test_document_lifecycle import _secret, doc, obligations, participants, signoff, tasks, user, world  # noqa: F401

# the module itself: grc.routers re-exports its APIRouter under the same name
critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")


def publish(db):
    d = doc(db)
    d.status = "published"
    life.ensure_acknowledgements(db, d, 1)
    db.commit()
    return d


def ack_task(db, uid=6):
    ob = db.query(m.DocumentObligation).filter_by(user_id=uid, kind="acknowledgement").one()
    return ob, db.get(m.CriticalTask, ob.critical_task_id)


@pytest.fixture
def http(world, monkeypatch):
    monkeypatch.setattr(critical_tasks_router, "_send_notification_email", lambda *a, **k: None)
    db = world.factory()
    me = {"u": 6}
    app = FastAPI()
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["u"])
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    client = TestClient(app)
    client.db, client.me = db, me
    yield client
    db.close()


def manual_task(db, owner=6):
    t = m.CriticalTask(tenant_id=1, title="Patch the VPN", status="Open", priority="High", assigned_owner_id=owner,
                       assigned_user_ids=[owner], due_date=datetime.utcnow() + timedelta(days=3))
    db.add(t)
    db.commit()
    return t


# ── what the task says ───────────────────────────────────────────────────────
def test_the_task_says_in_plain_words_what_to_do_and_by_when(world):
    with world.factory() as db:
        publish(db)
        ob, t = ack_task(db)
        assert t.description == f'Please acknowledge "Access policy", version 1.0, by {ob.due_date:%d %b %Y}.'
        assert "/governance/" not in t.description                              # the links are buttons, not text
        assert (t.title, t.priority, t.category) == ("Acknowledge: Access policy", "Medium", "Compliance")


def test_every_field_of_the_task_comes_from_the_settings(world):
    with world.factory() as db:
        life.save_settings(db, 1, {"task_category": "Governance", "task_priority": {"acknowledgement": "Low"},
                                   "task_title": "{action} {document} v{version}",
                                   "task_description": "Please {verb} it by {due_date}. Owner: {owner}."}, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        review = [x for x in tasks(db) if x.assigned_user_ids == [2]][0]
        assert review.description.startswith("Please review and sign it by ") and review.category == "Governance"
        publish(db)
        ob, t = ack_task(db)
        assert (t.title, t.priority, t.category) == ("Acknowledge Access policy v1.0", "Low", "Governance")
        assert t.description == f"Please acknowledge it by {ob.due_date:%d %b %Y}. Owner: Olivia Owner."
        assert t.due_date == ob.due_date                                         # the request's own due date (Settings > Due dates)
        with pytest.raises(ValueError) as err:
            life.save_settings(db, 1, {"task_category": "  "}, 1)
        assert str(err.value) == "Task category must be 1 to 100 characters."


# ── Task Management: buttons, read-only fields, delete ───────────────────────
def test_the_task_carries_buttons_to_the_document_and_to_the_persons_own_step(http):
    db = http.db
    publish(db)
    ob, t = ack_task(db)
    got = http.get(f"/critical-tasks/{t.id}").json()["document_request"]
    assert got["open_href"] == "/governance/documents/5" and got["action_href"] == "/governance/documents/5?act=ack"
    assert (got["kind"], got["action_label"], got["version"], got["status"], got["user_id"]) == ("acknowledgement", "Acknowledge", "1.0", "pending", 6)
    assert got["document_title"] == "Access policy" and got["overdue"] is False and got["due_date"] == ob.due_date.isoformat()
    mine = [x for x in http.get("/critical-tasks/my-tasks").json() if x["id"] == t.id][0]
    assert mine["document_request"]["action_href"].endswith("?act=ack")         # in the lists too

    ob.due_date = datetime.utcnow() - timedelta(days=1)
    db.commit()
    assert http.get(f"/critical-tasks/{t.id}").json()["document_request"]["overdue"] is True
    life.acknowledge(db, doc(db), user(db, 6))
    done = http.get(f"/critical-tasks/{t.id}").json()
    assert done["status"] == "Completed" and done["document_request"]["status"] == "done" and done["document_request"]["action_href"] is None

    other = manual_task(db)
    assert "document_request" not in http.get(f"/critical-tasks/{other.id}").json()        # other tasks: unchanged


def test_review_and_approval_tasks_open_the_signing_popup(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))
    t = [x for x in tasks(db) if x.assigned_user_ids == [2]][0]
    http.me["u"] = 2
    got = http.get(f"/critical-tasks/{t.id}").json()["document_request"]
    assert (got["kind"], got["action_label"], got["action_href"]) == ("review", "Review and sign", "/governance/documents/5?act=sign")


def test_a_task_made_before_the_buttons_existed_shows_them_too(http):
    db = http.db
    publish(db)
    ob, t = ack_task(db)
    t.description = 'Acknowledge the document "Access policy" (version 1.0). Open it at /governance/documents/5. This task closes when you acknowledge it there.'
    db.commit()
    assert http.get(f"/critical-tasks/{t.id}").json()["document_request"]["action_href"] == "/governance/documents/5?act=ack"


def test_only_an_administrator_may_delete_a_document_task(http):
    db = http.db
    publish(db)
    ob, t = ack_task(db)
    refused = http.delete(f"/critical-tasks/{t.id}")                             # the person it is assigned to
    assert refused.status_code == 403 and refused.json()["detail"] == life.DELETE_REFUSED
    assert db.get(m.CriticalTask, t.id) is not None
    http.me["u"] = 7                                                             # an administrator
    assert http.delete(f"/critical-tasks/{t.id}").status_code == 204
    db.expire_all()
    assert db.get(m.CriticalTask, t.id) is None
    assert ob.status == "pending" and ob.critical_task_id is None                # the request itself goes on

    http.me["u"] = 6
    other = manual_task(db)
    assert http.delete(f"/critical-tasks/{other.id}").status_code == 204         # other tasks: as before


def test_who_when_and_done_follow_the_request_and_cannot_be_changed_in_task_management(http):
    db = http.db
    publish(db)
    ob, t = ack_task(db)
    for change, words in [({"assigned_user_ids": [2]}, "The person on this task is the one asked"),
                          ({"assigned_owner_id": 2}, "The person on this task is the one asked"),
                          ({"due_date": "2030-01-01T00:00:00"}, "The due date follows the request"),
                          ({"source_entity_id": 999}, "This task belongs to a document request"),
                          # nor unlinked from its request, which would let anyone delete it
                          ({"source_module": None}, "This task belongs to a document request"),
                          ({"source_entity_type": "risk"}, "This task belongs to a document request")]:
        r = http.put(f"/critical-tasks/{t.id}", json=change)
        assert r.status_code == 400 and r.json()["detail"].startswith(words), change
    same = {"assigned_owner_id": 6, "assigned_user_ids": [6], "priority": "Critical", "category": "Policy"}
    ok = http.put(f"/critical-tasks/{t.id}", json=same)                          # the unchanged values with an edit: fine
    assert ok.status_code == 200 and (ok.json()["priority"], ok.json()["category"]) == ("Critical", "Policy")

    for status in ("In Progress", "Completed"):
        r = http.post(f"/critical-tasks/{t.id}/transition", json={"new_status": status})
        assert r.status_code == 400 and r.json()["detail"].startswith("This task closes by itself")
    db.expire_all()
    assert (db.get(m.CriticalTask, t.id).status, ob.status) == ("Open", "pending")      # completing it there closes nothing

    other = manual_task(db)
    bulk = http.post("/critical-tasks/bulk-action", json={"task_ids": [t.id, other.id], "action": "change_status", "value": "In Progress"}).json()
    assert bulk == {"updated": 1, "left_document_tasks": 1}
    db.expire_all()
    assert (db.get(m.CriticalTask, t.id).status, db.get(m.CriticalTask, other.id).status) == ("Open", "In Progress")
    assert http.put(f"/critical-tasks/{other.id}", json={"assigned_owner_id": 2}).json()["assigned_owner_id"] == 2   # others: as before
    assert http.post(f"/critical-tasks/{other.id}/transition", json={"new_status": "Under Review"}).json()["status"] == "Under Review"
