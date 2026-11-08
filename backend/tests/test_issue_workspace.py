"""The issue record (Issue & Incident Management, the workspace): the state machine, editing, and what is linked.

Held here: a move to ``closed`` through ``POST /transition`` stamps exactly what ``/close`` stamps and needs the same notes (it used to set only the state, so the issue was closed in the list, open
in the scorecard and missing from the closed-in-30-days KPIs); leaving closed or cancelled opens the issue again (``cancelled -> new`` left ``status = closed``); ``to_state`` stays the key of the body;
a PATCH refuses a blank title and a root cause the column cannot hold in plain words and records what changed in words (``diff``); ``link_counts`` counts tasks, projects and documents too; the
tasks linked to an issue are listed for the people who may see them; a link or an unlink names the record on the timeline.
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.routers.auth_router import require_auth

issues_router = importlib.import_module("grc.modules.issue_management.routers.issues")
links_router = importlib.import_module("grc.modules.issue_management.routers.links")

ME, LINA = 1, 2


@pytest.fixture
def http(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    db.add_all([m.Tenant(id=1, name="CFSB", slug="cfsb"), m.Tenant(id=2, name="Acme", slug="acme")])
    db.add_all([m.GRCUser(id=ME, username="olivia", email="o@cfsb.test", display_name="Olivia Owner"),
                m.GRCUser(id=LINA, username="lina", email="l@cfsb.test", display_name="Lina Khan")])
    db.commit()
    for module in (issues_router, links_router):
        monkeypatch.setattr(module, "get_user_tenants", lambda user, session: [1])
    monkeypatch.setattr(issues_router, "get_user_primary_tenant", lambda user, session: 1)
    app = FastAPI()
    app.include_router(issues_router.router)
    app.include_router(links_router.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, ME)
    for gate in (issues_router._require_view, issues_router._require_edit, issues_router._require_create, links_router._require_view, links_router._require_edit):
        app.dependency_overrides[gate] = lambda: True
    client = TestClient(app)
    client.db = db
    yield client
    db.close()


def issue(db, state="new", **fields):
    i = m.Issue(tenant_id=1, title="Unpatched gateway", severity="high", workflow_state=state, status="closed" if state in ("closed", "cancelled") else "open",
                impact="high", urgency="medium", detected_at=datetime.utcnow() - timedelta(days=1), **fields)
    db.add(i)
    db.commit()
    return i


def activity(db, issue_id, type_):
    return [a.payload for a in db.query(m.IssueActivity).filter_by(issue_id=issue_id, type=type_).order_by(m.IssueActivity.id)]


# ── closing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_move_to_closed_needs_the_notes_and_stamps_what_close_stamps(http):
    a, b = issue(http.db, "closure_review", sla_breached=True), issue(http.db, "closure_review", sla_breached=True)
    refused = http.post(f"/issues/{a.id}/transition", json={"to_state": "closed"})
    assert refused.status_code == 400 and "closure_notes" in refused.json()["detail"]
    http.db.expire_all()
    assert (http.db.get(m.Issue, a.id).workflow_state, http.db.get(m.Issue, a.id).closed_at) == ("closure_review", None), "nothing moved"

    assert http.post(f"/issues/{a.id}/transition", json={"to_state": "closed", "closure_notes": "Patched and verified"}).status_code == 200
    assert http.post(f"/issues/{b.id}/close", json={"closure_notes": "Patched and verified"}).status_code == 200
    http.db.expire_all()
    stamped = lambda i: (i.workflow_state, i.status, i.closed_at is not None, i.approved_by_id, i.approved_at is not None, i.closure_notes, i.sla_breached)
    assert stamped(http.db.get(m.Issue, a.id)) == stamped(http.db.get(m.Issue, b.id)) == ("closed", "closed", True, ME, True, "Patched and verified", False)
    assert activity(http.db, a.id, "approved") == activity(http.db, b.id, "approved") == [{"closure_notes": "Patched and verified"}]


def test_closed_is_only_reachable_from_closure_review_as_before(http):
    working = issue(http.db, "in_progress")
    r = http.post(f"/issues/{working.id}/transition", json={"to_state": "closed", "closure_notes": "done"})
    assert r.status_code == 400 and "Invalid transition" in r.json()["detail"]


# ── leaving a terminal state ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_reopening_a_cancelled_issue_opens_it_again(http):
    i = issue(http.db, "cancelled")
    assert http.post(f"/issues/{i.id}/transition", json={"to_state": "new"}).status_code == 200
    http.db.expire_all()
    got = http.db.get(m.Issue, i.id)
    assert (got.workflow_state, got.status) == ("new", "open"), "status is what the scorecard reads: it was left at closed"


def test_moving_a_closed_issue_back_to_work_clears_the_closure(http):
    i = issue(http.db, "closure_review")
    http.post(f"/issues/{i.id}/close", json={"closure_notes": "ok"})
    assert http.post(f"/issues/{i.id}/transition", json={"to_state": "in_progress"}).status_code == 200
    http.db.expire_all()
    got = http.db.get(m.Issue, i.id)
    assert (got.workflow_state, got.status, got.closed_at, got.approved_at, got.approved_by_id) == ("in_progress", "open", None, None, None)


def test_the_other_moves_are_unchanged(http):
    i = issue(http.db, "in_progress")
    http.post(f"/issues/{i.id}/transition", json={"to_state": "resolution"})
    http.db.expire_all()
    assert http.db.get(m.Issue, i.id).resolved_at is not None
    assert http.post(f"/issues/{i.id}/transition", json={"to_state": "cancelled"}).status_code == 200
    http.db.expire_all()
    assert http.db.get(m.Issue, i.id).status == "closed"
    assert activity(http.db, i.id, "status_change")[0] == {"from": "in_progress", "to": "resolution", "notes": None}


# ── editing ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_an_edit_refuses_a_blank_title_and_a_root_cause_that_does_not_fit_in_plain_words(http):
    i = issue(http.db)
    blank = http.patch(f"/issues/{i.id}", json={"title": "   "})
    assert blank.status_code == 400 and blank.json()["detail"] == "An issue needs a title."
    assert http.patch(f"/issues/{i.id}", json={"title": "x" * 256}).status_code == 400
    long = http.patch(f"/issues/{i.id}", json={"root_cause": "x" * 256})
    assert long.status_code == 400 and "root cause" in long.json()["detail"]
    http.db.expire_all()
    assert http.db.get(m.Issue, i.id).title == "Unpatched gateway"
    assert http.patch(f"/issues/{i.id}", json={"title": "  Unpatched edge gateway ", "root_cause": "No window"}).json()["title"] == "Unpatched edge gateway"


def test_a_new_issue_with_a_title_or_root_cause_that_does_not_fit_is_refused_in_words(http):
    too_long = http.post("/issues", json={"title": "x" * 256, "impact": "high", "urgency": "low"})
    assert too_long.status_code == 400 and "255" in too_long.json()["detail"]
    assert http.post("/issues", json={"title": "Fine", "root_cause": "y" * 256}).status_code == 400
    assert http.post("/issues", json={"title": "x" * 255, "impact": "high", "urgency": "low"}).status_code == 201
    assert http.db.query(m.Issue).count() == 1, "the refused ones left nothing behind"


def test_an_edit_records_what_changed_in_words_and_keeps_the_old_changes_key(http):
    i = issue(http.db, assignee_id=ME, due_date=datetime(2026, 11, 20))
    r = http.patch(f"/issues/{i.id}", json={"assignee_id": LINA, "due_date": "2026-12-01", "root_cause_analysis": "y" * 300, "title": "Unpatched gateway"})
    assert r.status_code == 200, r.text
    (payload,) = activity(http.db, i.id, "updated")
    assert set(payload["changes"]) == {"assignee_id", "due_date", "root_cause_analysis"}, "the older key is as it was"
    assert payload["diff"]["assignee_id"] == {"old": "Olivia Owner", "new": "Lina Khan"}, "a person by name, not an id"
    assert payload["diff"]["due_date"] == {"old": "2026-11-20", "new": "2026-12-01"}
    assert payload["diff"]["root_cause_analysis"]["old"] is None and len(payload["diff"]["root_cause_analysis"]["new"]) == 120, "long text is cut"
    assert "title" not in payload["diff"], "an unchanged field is not a change"


def test_a_due_date_can_be_cleared_and_a_severity_change_says_from_what_to_what(http):
    i = issue(http.db, due_date=datetime(2026, 11, 20))
    assert http.patch(f"/issues/{i.id}", json={"due_date": None}).status_code == 200
    http.db.expire_all()
    assert http.db.get(m.Issue, i.id).due_date is None
    r = http.patch(f"/issues/{i.id}", json={"severity_override": "critical", "severity_override_reason": "Customer data"})
    assert r.status_code == 200 and r.json()["severity"] == "critical"
    diff = activity(http.db, i.id, "severity_change")[0]["diff"]
    assert diff["severity"] == {"old": "high", "new": "critical"} and diff["severity_override"] == {"old": None, "new": "critical"}
    assert http.patch(f"/issues/{i.id}", json={"severity_override": "low"}).status_code == 400, "a change of severity needs its reason"


# ── what is linked ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_link_counts_count_tasks_projects_and_documents_too(http):
    db = http.db
    i = issue(db)
    project, doc = m.ISProject(tenant_id=1, name="SOC build"), m.GovernanceDocument(tenant_id=1, title="Access policy", doc_type="policy")
    risk = m.Risk(tenant_id=1, title="Payments outage", category="operational")
    db.add_all([project, doc, risk])
    db.flush()
    db.add_all([m.IssueISProjectLink(issue_id=i.id, is_project_id=project.id), m.IssueGovernanceLink(issue_id=i.id, governance_document_id=doc.id), m.IssueRiskLink(issue_id=i.id, risk_id=risk.id)])
    db.add(m.CriticalTask(tenant_id=1, title="Patch it", status="Open", priority="High", category="Other", linked_issue_id=i.id, assigned_owner_id=ME))
    db.commit()
    counts = http.get(f"/issues/{i.id}").json()["link_counts"]
    assert {k: counts[k] for k in ("risks", "projects", "governance", "tasks")} == {"risks": 1, "projects": 1, "governance": 1, "tasks": 1}
    assert {"vulnerabilities", "assets", "controls", "evidence", "vendors", "actions", "comments"} <= set(counts), "every older key is still there"


def test_the_linked_tasks_are_the_ones_the_person_may_see_and_the_count_agrees(http, monkeypatch):
    db = http.db
    i = issue(db)
    mine = m.CriticalTask(tenant_id=1, title="Patch it", status="In Progress", priority="High", category="Other", linked_issue_id=i.id, assigned_owner_id=ME, linked_issue_action_id=None)
    theirs = m.CriticalTask(tenant_id=1, title="Someone else's", status="Open", priority="Low", category="Other", linked_issue_id=i.id, assigned_owner_id=LINA)
    other_tenant = m.CriticalTask(tenant_id=2, title="Not ours", status="Open", priority="Low", category="Other", linked_issue_id=i.id, assigned_owner_id=ME)
    db.add_all([mine, theirs, other_tenant])
    db.commit()
    from grc.services import task_visibility

    monkeypatch.setattr(task_visibility, "visible", lambda session, user, query: query.filter(m.CriticalTask.assigned_owner_id == user.id))
    rows = http.get(f"/issues/{i.id}/links/tasks").json()
    assert [r["title"] for r in rows] == ["Patch it"] and rows[0]["task_id"] == mine.id and rows[0]["from_action"] is False
    assert http.get(f"/issues/{i.id}").json()["link_counts"]["tasks"] == 1
    assert http.get("/issues/999/links/tasks").status_code == 404


def test_a_link_and_an_unlink_name_the_record_on_the_timeline(http):
    db = http.db
    i = issue(db)
    risk = m.Risk(tenant_id=1, title="Payments outage", category="operational")
    control = m.InternalControl(tenant_id=1, control_id="IC-1", name="Patching")
    db.add_all([risk, control])
    db.commit()
    assert http.post(f"/issues/{i.id}/links/risks", json={"risk_id": risk.id}).status_code == 201
    assert http.post(f"/issues/{i.id}/links/controls", json={"target_type": "internal", "control_id": control.id}).status_code == 201
    link_id = db.query(m.IssueControlLink).filter_by(issue_id=i.id).one().id
    assert http.delete(f"/issues/{i.id}/links/risks/{risk.id}").status_code == 204
    assert http.delete(f"/issues/{i.id}/links/controls/{link_id}").status_code == 204
    linked = activity(db, i.id, "linked")
    unlinked = activity(db, i.id, "unlinked")
    assert [p["name"] for p in linked] == ["Payments outage", "Patching"]
    assert [(p["target_type"], p["name"]) for p in unlinked] == [("risk", "Payments outage"), ("control", "Patching")], "an unlink says which, even for a control removed by its link id"
    assert all({"target_type", "target_id"} <= set(p) for p in linked + unlinked), "the older keys stay"
