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


# ── the review's findings (2026-10-19) ───────────────────────────────────────
def count_queries(http, url):
    from sqlalchemy import event

    engine, seen = http.db.get_bind(), []
    listen = lambda *a, **k: seen.append(1)                                     # noqa: E731
    event.listen(engine, "before_cursor_execute", listen)
    try:
        r = http.get(url)
    finally:
        event.remove(engine, "before_cursor_execute", listen)
    assert r.status_code == 200, r.text
    return len(seen), r.json()


def test_a_list_of_document_tasks_reads_their_requests_at_once_not_per_task(http):
    db = http.db
    publish(db)                                                                  # one acknowledgement task per person
    http.me["u"] = 7                                                             # an administrator sees them all
    count_queries(http, "/critical-tasks")                                       # (anything read once per process)
    few, board = count_queries(http, "/critical-tasks")
    mine_few, _ = count_queries(http, "/critical-tasks/my-tasks")
    db.add(m.GovernanceDocument(id=6, tenant_id=1, title="Backup policy", doc_type="policy", status="published", current_version="1.0", owner_id=1))
    db.commit()
    life.ensure_acknowledgements(db, db.get(m.GovernanceDocument, 6), 1)
    db.commit()
    many, board2 = count_queries(http, "/critical-tasks")
    mine_many, mine = count_queries(http, "/critical-tasks/my-tasks")
    assert board2["total"] == 2 * board["total"] >= 14 and len(mine) == 2
    assert (many, mine_many) == (few, mine_few)                                 # the same number of queries for twice the tasks
    assert all(t["document_request"]["document_title"] in ("Access policy", "Backup policy") for t in board2["items"])
    assert {t["document_request"]["user_id"] for t in board2["items"]} == {t["assigned_owner_id"] for t in board2["items"]}


def test_document_tasks_show_only_to_the_person_asked_and_to_who_may_read_the_document(http):
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))                                 # a draft: Rana (2) and Rafay (3) review it
    rana = [x for x in tasks(db) if x.assigned_user_ids == [2]][0]
    other = manual_task(db)

    http.me["u"] = 6                                                             # neither asked nor allowed to read the draft
    board = http.get("/critical-tasks").json()
    assert [t["id"] for t in board["items"]] == [other.id] and board["total"] == 1
    for call in (lambda: http.get(f"/critical-tasks/{rana.id}"), lambda: http.get(f"/critical-tasks/{rana.id}/history"),
                 lambda: http.put(f"/critical-tasks/{rana.id}", json={"priority": "Low"}),
                 lambda: http.post(f"/critical-tasks/{rana.id}/comments", json={"content": "hi"})):
        assert call().status_code == 404                                         # as if it did not exist
    assert http.get(f"/critical-tasks/{other.id}").status_code == 200           # other tasks: as before

    http.me["u"] = 2                                                             # the person asked
    assert rana.id in [t["id"] for t in http.get("/critical-tasks").json()["items"]]
    assert http.get(f"/critical-tasks/{rana.id}").json()["document_request"]["kind"] == "review"
    http.me["u"] = 3                                                             # the other reviewer reads the draft: opens it by its link
    assert http.get(f"/critical-tasks/{rana.id}").status_code == 200
    assert rana.id not in [t["id"] for t in http.get("/critical-tasks").json()["items"]]     # but lists show their own
    http.me["u"] = 7                                                             # an administrator: everything
    assert {rana.id, other.id} <= {t["id"] for t in http.get("/critical-tasks").json()["items"]}
    assert http.get(f"/critical-tasks/{rana.id}").status_code == 200

    rana.reviewer_id = 6                                                         # a reviewer set by hand is not the person asked
    db.commit()
    http.me["u"] = 6
    assert rana.id not in [t["id"] for t in http.get("/critical-tasks/my-tasks").json()]


def test_the_reports_on_tasks_leave_out_other_peoples_document_tasks_too(http):
    reporting = importlib.import_module("grc.routers.reporting_router")
    db = http.db
    participants(db)
    signoff.send_for_review(5, db, user(db, 1))                                 # a draft: Rana (2) and Rafay (3) review it
    other = manual_task(db)                     # Uma may report on tasks (everyone holds the world's Staff role), not read the draft
    app = FastAPI()
    app.include_router(reporting.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, http.me["u"])
    client = TestClient(app)

    http.me["u"] = 6
    rows = client.post("/reporting/query", json={"dataset": "tasks"}).json()
    assert [r["id"] for r in rows["rows"]] == [other.id] and rows["total"] == 1
    grouped = client.post("/reporting/aggregate", json={"dataset": "tasks", "group_by": ["title"],
                                                        "measures": [{"id": "n", "pct_of_total": True}]}).json()
    assert [r["title"] for r in grouped["rows"]] == ["Patch the VPN"] and grouped["grand"]["m_n"] == 1
    http.me["u"] = 7                                                             # an administrator: every task
    assert client.post("/reporting/query", json={"dataset": "tasks"}).json()["total"] == 1 + len(tasks(db)) >= 3


def test_a_task_cannot_be_linked_to_a_document_request_by_hand(http):
    db = http.db
    publish(db)
    ob, real = ack_task(db)
    for body in ({"title": "x", "source_module": "document_lifecycle", "source_entity_type": "DocumentObligation", "source_entity_id": ob.id},
                 {"title": "x", "source_entity_type": "DocumentObligation"}, {"title": "x", "source_module": "document_lifecycle"}):
        r = http.post("/critical-tasks", json=body)
        assert r.status_code == 400 and r.json()["detail"] == life.LINK_REFUSED, body
    r = http.post("/critical-tasks/from-module", json={"title": "x", "source_module": "document_lifecycle", "source_entity_id": ob.id,
                                                        "source_entity_type": "DocumentObligation"})
    assert r.status_code == 400
    other = manual_task(db)
    assert http.put(f"/critical-tasks/{other.id}", json={"source_module": "document_lifecycle"}).status_code == 400
    assert http.put(f"/critical-tasks/{other.id}", json={"source_entity_type": "DocumentObligation", "source_entity_id": ob.id}).status_code == 400
    assert http.put(f"/critical-tasks/{real.id}", json={"source_module": "document_lifecycle", "priority": "Low"}).status_code == 200  # its own

    # one made before that was refused, naming Uma's request: an ordinary task, not hers
    forged = m.CriticalTask(tenant_id=1, title="Forged", status="Open", source_module="document_lifecycle", source_entity_type="DocumentObligation",
                            source_entity_id=ob.id, assigned_owner_id=2, assigned_user_ids=[2])
    db.add(forged)
    db.commit()
    assert life.is_task(real) and not life.is_task(forged)
    assert life.task_request(db, forged) is None and life.locked_change(forged, {"status": "In Progress"}) is None
    http.me["u"] = 2
    assert http.get(f"/critical-tasks/{forged.id}").json()["document_request"] is None
    assert http.post(f"/critical-tasks/{forged.id}/transition", json={"new_status": "In Progress"}).status_code == 200
    assert http.delete(f"/critical-tasks/{forged.id}").status_code == 204       # no administrator needed
    db.expire_all()
    assert ob.critical_task_id == real.id and db.get(m.CriticalTask, real.id) is not None


def test_balancing_the_workload_counts_document_tasks_but_never_moves_them(http, monkeypatch):
    import json
    from types import SimpleNamespace as NS

    db = http.db
    publish(db)
    ob, ack = ack_task(db)
    other = manual_task(db)
    prompts = []

    def create(**kw):
        prompts.append(kw["messages"][-1]["content"])
        answer = {"suggestions": [{"task_id": ack.id, "suggested_owner": "P1"}, {"task_id": other.id, "suggested_owner": "P1"}], "summary": "s"}
        return NS(choices=[NS(message=NS(content=json.dumps(answer)))])

    monkeypatch.setattr(critical_tasks_router, "_get_openai_client", lambda: NS(chat=NS(completions=NS(create=create))))
    monkeypatch.setattr(critical_tasks_router, "_get_openai_model", lambda: "test")
    http.me["u"] = 7
    out = http.post("/critical-tasks/ai/balance-workload").json()
    workload = json.loads(prompts[0].split("Current workload:\n", 1)[1].split("\n\nTasks:\n", 1)[0])
    offered = json.loads(prompts[0].split("\n\nTasks:\n", 1)[1].split("\n\nReturn JSON", 1)[0])
    assert [t["id"] for t in offered] == [other.id]                              # the only one it may move
    assert sum(w["count"] for w in workload.values()) == len(tasks(db)) + 1      # the document tasks still count
    assert [s["task_id"] for s in out["suggestions"]] == [other.id]             # a document task it names anyway is dropped


def test_the_alert_says_it_is_in_your_tasks_only_when_a_task_was_made(world):
    from test_document_lifecycle import alerts

    with world.factory() as db:
        life.save_settings(db, 1, {"task_create": {"review": False, "acknowledgement": False}}, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert not tasks(db) and "in your tasks" not in alerts(db, 2)[-1].message
        assert alerts(db, 2)[-1].message.endswith("It is in the document's Approvals.")
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        assert "in your tasks" not in alerts(db, 6)[-1].message
    with world.factory() as db:
        d = doc(db)
        d.status = "draft"
        db.commit()
        life.save_settings(db, 1, {"task_create": {"review": True, "acknowledgement": True}}, 1)
        signoff.send_for_review(5, db, user(db, 1))
        assert "It is in your tasks and in the document's Approvals." in alerts(db, 2)[-1].message


def test_the_link_in_a_task_is_the_apps_address_when_it_is_known(world, monkeypatch):
    for name in ("FRONTEND_URL", "NEXT_PUBLIC_APP_URL"):
        monkeypatch.delenv(name, raising=False)
    with world.factory() as db:
        life.save_settings(db, 1, {"task_description": "Open {link}"}, 1)
        publish(db)
        assert ack_task(db)[1].description == "Open /governance/documents/5?act=ack"       # no address set: the path
        monkeypatch.setenv("FRONTEND_URL", "https://cfsb.example.test/")
        assert life.task_values(db, ack_task(db)[0], doc(db))["link"] == "https://cfsb.example.test/governance/documents/5?act=ack"
