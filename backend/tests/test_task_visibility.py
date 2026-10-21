"""Who sees which Task Management task (the user's rule, 2026-10-21): a person sees the tasks they take part in - the owner, one of
the assignees, the reviewer or whoever created it - and no other: not in a list, a count, a report, the AI's input, a picker or by
its id; an administrator, and whoever holds critical_tasks:tasks:view_all, sees every task. A document request's task stays the
asked person's own (services/task_visibility)."""
import importlib
import json
import re
from datetime import datetime, timedelta
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import grc.models as m
from grc.routers.auth_router import require_auth
from grc.services import task_visibility

from test_document_lifecycle import _secret, tasks, user, world  # noqa: F401  (_secret and world are fixtures)
from test_document_tasks import grant, http, publish  # noqa: F401  (http is a fixture)

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")

CREATOR, OWNER, ASSIGNEE, MINA, REVIEWER, UMA, ADMIN = 1, 2, 3, 4, 5, 6, 7       # the people of test_document_lifecycle.world
SEES = {OWNER: {"A"}, ASSIGNEE: {"B"}, REVIEWER: {"C"}, CREATOR: {"D"}, MINA: {"B", "C", "D"}, UMA: set(), ADMIN: {"A", "B", "C", "D"}}


@pytest.fixture
def board(http):
    """Four tasks, each with one more person on it: Rana owns A; Rafay is the second of B's assignees (only in the JSON list); Mo
    reviews C; Olivia created D. Mina owns B, C and D; Uma takes part in none; Adam administers."""
    db, soon = http.db, datetime.utcnow() + timedelta(days=3)
    people = {"A": dict(assigned_owner_id=OWNER, assigned_user_ids=[OWNER]),
              "B": dict(assigned_owner_id=MINA, assigned_user_ids=[MINA, ASSIGNEE]),
              "C": dict(assigned_owner_id=MINA, assigned_user_ids=[MINA], reviewer_id=REVIEWER),
              "D": dict(assigned_owner_id=MINA, assigned_user_ids=[MINA], created_by_id=CREATOR)}
    made = {}
    for name, on_it in people.items():
        t = m.CriticalTask(tenant_id=1, title=f"Task {name}", status="Open", priority="High", category="Compliance", due_date=soon, **on_it)
        db.add(t)
        db.flush()
        made[name] = t.id
    db.commit()
    return made


def names(rows):
    return {r["title"].split()[-1] for r in rows}


def test_a_person_sees_the_tasks_they_take_part_in_and_an_administrator_sees_all(http, board):
    for uid, theirs in SEES.items():
        http.me["u"] = uid
        got = http.get("/critical-tasks").json()
        assert names(got["items"]) == theirs and got["total"] == len(theirs), uid
        assert got["scope"] == ("all" if uid == ADMIN else "mine")
        summary = http.get("/critical-tasks/reports/summary").json()
        assert summary["total"] == sum(summary["by_status"].values()) == len(theirs) and summary["scope"] == got["scope"], uid
        for name, tid in board.items():
            assert http.get(f"/critical-tasks/{tid}").status_code == (200 if name in theirs else 404), (uid, name)


def test_someone_who_takes_no_part_cannot_open_change_or_act_on_it(http, board):
    db, tid = http.db, board["B"]
    http.me["u"] = UMA
    for call in (lambda: http.put(f"/critical-tasks/{tid}", json={"priority": "Low"}),
                 lambda: http.post(f"/critical-tasks/{tid}/transition", json={"new_status": "In Progress"}),
                 lambda: http.post(f"/critical-tasks/{tid}/comments", json={"content": "hi"}),
                 lambda: http.post(f"/critical-tasks/{tid}/sub-tasks", json={"title": "x"}),
                 lambda: http.get(f"/critical-tasks/{tid}/history"),
                 lambda: http.post(f"/critical-tasks/{tid}/request-approval", json={}),
                 lambda: http.delete(f"/critical-tasks/{tid}")):
        assert call().status_code == 404                                         # as if it did not exist
    bulk = http.post("/critical-tasks/bulk-action", json={"task_ids": list(board.values()), "action": "change_priority", "value": "Low"})
    assert bulk.json()["updated"] == 0
    assert http.post("/critical-tasks/escalate/run").json()["evaluated"] == 0
    db.expire_all()
    t = db.get(m.CriticalTask, tid)
    assert (t.priority, t.status, t.comments, t.sub_tasks, t.escalation_level) == ("High", "Open", [], [], 0)

    http.me["u"] = ASSIGNEE                                                      # one of its assignees: may
    assert http.put(f"/critical-tasks/{tid}", json={"priority": "Low"}).json()["priority"] == "Low"
    assert http.post(f"/critical-tasks/{tid}/comments", json={"content": "on it"}).status_code == 201


def test_the_ai_works_on_the_persons_tasks_only(http, board, monkeypatch):
    prompts = []

    def create(**kw):
        prompts.append(kw["messages"][-1]["content"])
        return NS(choices=[NS(message=NS(content=json.dumps({"suggestions": [], "predictions": [], "summary": "s"})))])

    monkeypatch.setattr(critical_tasks_router, "_get_openai_client", lambda: NS(chat=NS(completions=NS(create=create))))
    monkeypatch.setattr(critical_tasks_router, "_get_openai_model", lambda: "test")
    http.me["u"] = ASSIGNEE
    for url in ("/critical-tasks/ai/prioritize-tasks", "/critical-tasks/ai/predict-escalations", "/critical-tasks/ai/balance-workload"):
        assert http.post(url).status_code == 200, url
    assert [{int(i) for i in re.findall(r'"id": (\d+)', p)} for p in prompts] == [{board["B"]}] * 3
    assert http.post(f"/critical-tasks/{board['A']}/ai/analyze-root-cause").status_code == 404
    http.me["u"] = UMA
    assert http.post("/critical-tasks/ai/prioritize-tasks").json()["message"] == "No open tasks to prioritize"
    assert len(prompts) == 3                                                     # nothing was sent for her


def test_view_all_gives_a_manager_the_whole_board(http, board):
    http.me["u"] = UMA
    grant(http.db, UMA, task_visibility.VIEW_ALL)
    got = http.get("/critical-tasks").json()
    assert names(got["items"]) == {"A", "B", "C", "D"} and got["scope"] == "all" and "owners" not in got
    assert http.get("/critical-tasks/reports/summary").json()["total"] == 4
    assert http.get(f"/critical-tasks/{board['A']}").status_code == 200
    assert http.get("/critical-tasks/my-tasks").json() == []                    # her own work is still hers only


def test_the_roles_screen_offers_view_all():
    from grc.permissions import get_all_permissions, get_permission_matrix_for_ui

    assert task_visibility.VIEW_ALL in {p["name"] for p in get_all_permissions()}
    board_actions = [s["actions"] for mod in get_permission_matrix_for_ui() if mod["module"] == "critical_tasks"
                     for s in mod["submodules"] if s["name"] == "tasks"]
    assert board_actions == [["view", "create", "edit", "delete", "view_all"]]


def test_the_owner_filter_offers_the_owners_of_the_persons_tasks_whatever_is_filtered(http, board):
    http.me["u"] = CREATOR
    got = http.get("/critical-tasks", params={"assigned_owner_id": OWNER}).json()
    assert got["total"] == 0
    assert got["owners"] == [{"id": MINA, "username": "mina", "display_name": "Mina Manager", "email": "mina@cfsb.test"}]


def test_my_tasks_are_the_ones_given_to_the_person(http, board):
    for uid, theirs in {OWNER: {"A"}, ASSIGNEE: {"B"}, REVIEWER: {"C"}, CREATOR: set(), MINA: {"B", "C", "D"}, ADMIN: set()}.items():
        http.me["u"] = uid                                                       # (not what they created for someone else)
        assert names(http.get("/critical-tasks/my-tasks").json()) == theirs, uid


def test_reports_pickers_and_links_elsewhere_see_the_same_tasks(http, board):
    reporting = importlib.import_module("grc.routers.reporting_router")
    record_links = importlib.import_module("grc.modules.scf.record_links")
    issues = importlib.import_module("grc.modules.issue_management.routers.issues")
    db = http.db
    app = FastAPI()
    app.include_router(reporting.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, http.me["u"])
    client = TestClient(app)

    http.me["u"] = ASSIGNEE
    rows = client.post("/reporting/query", json={"dataset": "tasks"}).json()
    assert [r["id"] for r in rows["rows"]] == [board["B"]] and rows["total"] == 1
    grouped = client.post("/reporting/aggregate", json={"dataset": "tasks", "group_by": ["status"], "measures": [{"id": "n"}]}).json()
    assert grouped["rows"] == [{"status": "Open", "m_n": 1.0}]
    assert [r["id"] for r in record_links.search_targets(db, 1, "task", user=user(db, ASSIGNEE))] == [board["B"]]   # a control's picker
    db.add(m.Issue(id=50, tenant_id=1, title="Leaked keys"))
    db.commit()
    linked = issues._apply_inline_linkages(db, issue=db.get(m.Issue, 50), tenant_id=1,
                                           body={"linked_task_ids": [board["A"], board["B"]]}, user_id=ASSIGNEE)
    assert linked == {"tasks": 1}                                                # another person's task is left alone
    assert (db.get(m.CriticalTask, board["A"]).linked_issue_id, db.get(m.CriticalTask, board["B"]).linked_issue_id) == (None, 50)

    http.me["u"] = ADMIN
    assert client.post("/reporting/query", json={"dataset": "tasks"}).json()["total"] == 4
    assert len(record_links.search_targets(db, 1, "task", user=user(db, ADMIN))) == 4


def test_a_document_requests_task_stays_with_the_person_asked(http):
    """Publishing asks everyone to acknowledge, each with a task that Olivia (who published) created: she sees her own only. Seeing
    every task shows the others by their link to whoever may read the document, and in lists to whoever reads every document."""
    db = http.db
    publish(db)
    acks = {t.assigned_owner_id: t.id for t in tasks(db)}
    assert {db.get(m.CriticalTask, i).created_by_id for i in acks.values()} == {CREATOR} and UMA in acks
    http.me["u"] = CREATOR
    assert [t["id"] for t in http.get("/critical-tasks").json()["items"]] == [acks[CREATOR]]
    assert http.get(f"/critical-tasks/{acks[UMA]}").status_code == 404
    grant(db, CREATOR, task_visibility.VIEW_ALL)
    assert http.get(f"/critical-tasks/{acks[UMA]}").status_code == 200        # she reads the document: opens it by its link
    assert [t["id"] for t in http.get("/critical-tasks").json()["items"]] == [acks[CREATOR]]     # lists: their own, as before
    grant(db, CREATOR, "governance:policies:edit")                              # reads every document: everyone's requests too
    assert set(acks.values()) <= {t["id"] for t in http.get("/critical-tasks").json()["items"]}
    http.me["u"] = UMA
    assert [t["id"] for t in http.get("/critical-tasks").json()["items"]] == [acks[UMA]]
    http.me["u"] = ADMIN
    assert set(acks.values()) <= {t["id"] for t in http.get("/critical-tasks").json()["items"]}


def test_on_postgres_the_assignee_list_is_matched_in_the_query(monkeypatch):
    """Production runs Postgres, where assigned_user_ids is a json column: membership is jsonb containment inside the query (the
    SQLite tests above run json_each), so counts and pages are cut by the database, never in Python."""
    from sqlalchemy import create_engine
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.orm import Session

    pg = Session(bind=create_engine("postgresql://nobody@127.0.0.1:1/none"))   # never connects: the query is only compiled
    monkeypatch.setattr(task_visibility, "sees_all", lambda db, person: False)
    cut, everyone = task_visibility.scope(pg, NS(id=UMA))
    compiled = cut(pg.query(m.CriticalTask.id)).statement.compile(dialect=postgresql.dialect())
    sql = " ".join(str(compiled).split())
    assert not everyone and "json_each" not in sql
    assert re.search(r"CAST\(grc_critical_tasks\.assigned_user_ids AS JSONB\) @> %\((\w+)\)s", sql), sql
    param = re.search(r"AS JSONB\) @> %\((\w+)\)s", sql).group(1)
    assert compiled.params[param] == [UMA]
    for column in ("assigned_owner_id", "reviewer_id", "created_by_id"):
        assert f"grc_critical_tasks.{column} = " in sql
