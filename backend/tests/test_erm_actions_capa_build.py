"""Actions & Acceptances on the CAPA engine (wave 2-E, decision 2). In-memory SQLite.

A risk action is an IssueAction on the risk's one treatment issue (made on first use, linked to the risk). The old
/erm/mitigation-actions API keeps its paths and fields but reads and writes those actions, so they get the engine's
due dates, completion, verification by a second person and the issue's closure rule. Existing RiskMitigationAction
rows are copied over once and stay as they were.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, Evidence, GRCUser, Issue, IssueAction, IssueRiskLink, Risk, RiskMitigationAction,
                        RiskMitigationActionEvidence, Role, Tenant, UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.issue_management.routers import actions as capa, issues
from grc.modules.issue_management.services.risk_actions import RISK_TREATMENT
from grc.modules.workflow_engine.services.action_handlers import WorkflowActionHandlers
from grc.routers.auth_router import create_access_token, require_auth

OFFICER, CHECKER, OWNER = 7, 8, 9
OLD_FIELDS = {"id", "risk_id", "risk_title", "title", "description", "action_type", "status", "priority", "due_date",
              "owner_id", "owner_name", "expected_residual_reduction", "actual_residual_reduction", "completed_at",
              "evidence", "evidence_id", "notes", "created_at", "updated_at"}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((OFFICER, "officer"), (CHECKER, "checker"), (OWNER, "owner"))])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (OFFICER, CHECKER, OWNER)])
    s.add_all([Risk(id=1, tenant_id=1, title="Wire fraud", category="operational", status="open", owner_id=OWNER,
                    inherent_score=20, residual_score=16),
               Risk(id=2, tenant_id=1, title="Core outage", category="operational", status="open"),
               Risk(id=3, tenant_id=2, title="Someone else's risk", category="operational", status="open")])
    s.add_all([Evidence(id=1, tenant_id=1, name="Call-back log"), Evidence(id=2, tenant_id=1, name="Training record")])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    for r in (erm_router, issues.router, capa.router_issue, capa.router_actions):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def add_action(http, risk_id=1, **extra):
    made = http.post(f"/erm/risks/{risk_id}/mitigation-actions",
                     json={"title": "Add call-back checks", "owner_id": OWNER, **extra})
    assert made.status_code == 201, made.text
    return made.json()


def test_an_action_on_a_risk_is_a_capa_action_on_its_one_treatment_issue(db):
    http = client(db)
    first = add_action(http, expected_residual_reduction=30)
    second = add_action(http, title="Dual control on releases")
    [issue] = db.query(Issue).all()
    assert (issue.issue_type, issue.source_type, issue.source_id) == (RISK_TREATMENT, "risk", 1)
    assert issue.title == "Treat: Wire fraud" and issue.owner_id == OWNER and issue.tenant_id == 1
    assert [(link.issue_id, link.risk_id) for link in db.query(IssueRiskLink).all()] == [(issue.id, 1)]
    rows = db.query(IssueAction).order_by(IssueAction.id).all()
    assert [a.id for a in rows] == [first["id"], second["id"]]          # the ids returned are IssueAction ids
    assert {a.issue_id for a in rows} == {issue.id} and rows[0].expected_residual_reduction == 30
    assert first["status"] == "planned" and first["issue_id"] == issue.id
    # no due date given: the engine's SLA for the issue sets one
    assert first["due_date"] and rows[0].due_date == issue.target_closure_date
    # the issue module sees the same actions
    assert [a["id"] for a in http.get(f"/issues/{issue.id}/actions").json()] == [first["id"], second["id"]]
    assert http.post("/erm/risks/3/mitigation-actions", json={"title": "x"}).status_code == 404


def test_list_get_and_the_risk_list_keep_the_old_fields(db):
    http = client(db)
    made = add_action(http, due_date=(datetime.utcnow() + timedelta(days=5)).isoformat(), priority="high",
                      expected_residual_reduction=25, notes="Ask payments ops")
    for body in (http.get("/erm/mitigation-actions").json()[0], http.get(f"/erm/mitigation-actions/{made['id']}").json(),
                 http.get("/erm/risks/1/mitigation-actions").json()[0]):
        assert OLD_FIELDS <= set(body), OLD_FIELDS - set(body)
        assert (body["risk_id"], body["risk_title"], body["owner_name"], body["priority"]) == (1, "Wire fraud", "Owner", "high")
        assert (body["expected_residual_reduction"], body["notes"], body["evidence"]) == (25, "Ask payments ops", [])
    assert http.get("/erm/risks/1/mitigation-actions", params={"status_filter": "completed"}).json() == []
    assert http.get("/erm/risks/2/mitigation-actions").json() == []
    edited = http.put(f"/erm/mitigation-actions/{made['id']}", json={"title": "Call back every release", "owner_id": CHECKER})
    assert (edited.json()["title"], edited.json()["owner_name"]) == ("Call back every release", "Checker")
    assert {r["id"]: r["mitigation_action_count"] for r in http.get("/erm/risks").json()}[1] == 1


def test_complete_with_evidence_then_a_second_person_verifies(db):
    http = client(db)
    action = add_action(http, expected_residual_reduction=30)
    done = http.post(f"/erm/mitigation-actions/{action['id']}/complete",
                     json={"actual_residual_reduction": 20, "evidence_id": 1})
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["status"], body["actual_residual_reduction"], body["evidence_id"]) == ("completed", 20, 1)
    assert [e["evidence_id"] for e in body["evidence"]] == [1] and body["completed_at"]
    assert db.get(IssueAction, action["id"]).completed_by == OFFICER
    # the maker and the assignee cannot verify; someone else can
    for who in ("officer", "owner"):
        refused = client(db, who).post(f"/erm/mitigation-actions/{action['id']}/verify", json={})
        assert refused.status_code == 409 and "someone else" in refused.json()["detail"]
    assert client(db, "officer").put(f"/erm/mitigation-actions/{action['id']}", json={"status": "verified"}).status_code == 409
    ok = client(db, "checker").post(f"/erm/mitigation-actions/{action['id']}/verify", json={"notes": "Log checked"})
    assert ok.status_code == 200, ok.text
    assert (ok.json()["status"], ok.json()["verified_by_name"]) == ("verified", "Checker")
    # an action that is not done yet is not verified
    other = add_action(http)
    assert client(db, "checker").post(f"/erm/mitigation-actions/{other['id']}/verify", json={}).status_code == 400


def test_old_status_words_still_work_on_edit(db):
    http = client(db)
    action = add_action(http)
    assert http.put(f"/erm/mitigation-actions/{action['id']}", json={"status": "in_progress"}).json()["status"] == "in_progress"
    assert http.put(f"/erm/mitigation-actions/{action['id']}", json={"status": "overdue"}).json()["status"] == "planned"
    assert http.put(f"/erm/mitigation-actions/{action['id']}", json={"status": "open"}).json()["status"] == "planned"
    assert http.put(f"/erm/mitigation-actions/{action['id']}", json={"status": "nonsense"}).status_code == 400


def _legacy(db, **fields):
    row = RiskMitigationAction(risk_id=fields.pop("risk_id", 1), title=fields.pop("title", "Old action"), **fields)
    db.add(row)
    db.commit()
    return row


def test_existing_mitigation_actions_are_copied_once_with_mapped_statuses_and_evidence(db):
    now = datetime.utcnow()
    due = now + timedelta(days=9)
    rows = {
        "pending": _legacy(db, title="Pending one", status="pending", due_date=due, owner_id=OWNER, priority="high",
                           expected_residual_reduction=15, notes="from 2025", evidence_id=2),
        "open": _legacy(db, title="Open one", status="open", due_date=due),
        "in_progress": _legacy(db, title="Doing", status="in_progress", risk_id=2),
        "completed": _legacy(db, title="Finished", status="completed", completed_at=now - timedelta(days=3),
                             actual_residual_reduction=12),
        "overdue": _legacy(db, title="Late", status="overdue", due_date=now - timedelta(days=4)),
        "cancelled": _legacy(db, title="Dropped", status="cancelled"),
        "other tenant": _legacy(db, title="Not ours", status="open", risk_id=3),
    }
    db.add_all([RiskMitigationActionEvidence(mitigation_action_id=rows["pending"].id, evidence_id=1, tenant_id=1, notes="first"),
                RiskMitigationActionEvidence(mitigation_action_id=rows["pending"].id, evidence_id=2, tenant_id=1)])
    db.commit()
    http = client(db)
    listed = {a["title"]: a for a in http.get("/erm/mitigation-actions").json()}
    assert set(listed) == {"Pending one", "Open one", "Doing", "Finished", "Late", "Dropped"}
    assert {t: a["status"] for t, a in listed.items()} == {
        "Pending one": "planned", "Open one": "planned", "Doing": "in_progress", "Finished": "completed",
        "Late": "planned", "Dropped": "cancelled"}
    pending = listed["Pending one"]
    assert (pending["owner_id"], pending["priority"], pending["expected_residual_reduction"], pending["notes"]) == (
        OWNER, "high", 15, "from 2025")
    assert pending["due_date"].startswith(due.isoformat()[:10])
    assert sorted(e["evidence_id"] for e in pending["evidence"]) == [1, 2] and pending["evidence_id"] == 2
    assert listed["Finished"]["completed_at"] and listed["Finished"]["actual_residual_reduction"] == 12
    assert listed["Late"]["id"] in [a["id"] for a in http.get("/erm/mitigation-actions/overdue").json()]
    assert listed["Doing"]["risk_id"] == 2 and db.query(Issue).filter_by(issue_type=RISK_TREATMENT).count() == 2
    copied = db.query(IssueAction).filter(IssueAction.legacy_mitigation_action_id.isnot(None)).all()
    assert {a.legacy_mitigation_action_id for a in copied} == {r.id for k, r in rows.items() if k != "other tenant"}
    # once only: listing again, or deleting a copy, does not bring the row back
    http.get("/erm/mitigation-actions")
    assert http.delete(f"/erm/mitigation-actions/{listed['Dropped']['id']}").status_code == 200
    http.get("/erm/mitigation-actions")
    assert db.query(IssueAction).filter(IssueAction.legacy_mitigation_action_id.isnot(None)).count() == 5
    # the old rows stay for audit, marked with where they went
    assert db.query(RiskMitigationAction).count() == 7
    assert db.get(RiskMitigationAction, rows["pending"].id).status == "pending"
    assert db.get(RiskMitigationAction, rows["pending"].id).migrated_to_issue_action_id == pending["id"]


def test_the_overview_overdue_count_reads_the_new_actions(db):
    http = client(db)
    late = add_action(http, due_date=(datetime.utcnow() - timedelta(days=2)).isoformat())
    add_action(http, due_date=(datetime.utcnow() + timedelta(days=20)).isoformat())
    overview = http.get("/erm/dashboard/sections-overview").json()
    assert overview["attention_queue"]["overdue_mitigation_actions"] == 1
    http.post(f"/erm/mitigation-actions/{late['id']}/complete", json={})
    assert http.get("/erm/dashboard/sections-overview").json()["attention_queue"]["overdue_mitigation_actions"] == 0


def test_the_treatment_issue_does_not_close_while_an_action_is_open(db):
    http = client(db)
    action = add_action(http)
    issue_id = action["issue_id"]
    checker = client(db, "checker")
    refused = checker.post(f"/issues/{issue_id}/close", json={"closure_notes": "Treated"})
    assert refused.status_code == 409 and "Add call-back checks" in refused.json()["detail"]
    http.post(f"/erm/mitigation-actions/{action['id']}/complete", json={})
    checker.post(f"/erm/mitigation-actions/{action['id']}/verify", json={})
    closed = checker.post(f"/issues/{issue_id}/close", json={"closure_notes": "Treated"})
    assert closed.status_code == 200, closed.text
    # a new action reopens the treatment issue instead of making a second one
    add_action(http, title="Second round")
    assert db.query(Issue).count() == 1 and db.get(Issue, issue_id).workflow_state == "in_progress"


def test_evidence_links_live_on_the_action(db):
    http = client(db)
    action = add_action(http)
    linked = http.post(f"/erm/mitigation-actions/{action['id']}/evidence", json={"evidence_id": 2, "notes": "signed"})
    assert linked.status_code == 201, linked.text
    assert http.post(f"/erm/mitigation-actions/{action['id']}/evidence", json={"evidence_id": 2}).status_code == 409
    assert [e["title"] for e in http.get(f"/erm/mitigation-actions/{action['id']}/evidence").json()] == ["Training record"]
    assert db.get(IssueAction, action["id"]).evidence_id == 2
    assert http.delete(f"/erm/mitigation-actions/{action['id']}/evidence/{linked.json()['id']}").status_code == 204
    assert http.get(f"/erm/mitigation-actions/{action['id']}/evidence").json() == []
    db.expire_all()
    assert db.get(IssueAction, action["id"]).evidence_id is None


def test_a_workflow_creates_and_moves_risk_actions_on_the_engine(db):
    instance, definition = SimpleNamespace(id=1, tenant_id=1), SimpleNamespace(id=1)
    made = WorkflowActionHandlers._create_mitigation_plan(db, instance, definition, {"risk_id": 1, "title": "From a workflow"})
    action = db.get(IssueAction, made["mitigation_id"])
    assert action.title == "From a workflow" and action.issue.issue_type == RISK_TREATMENT
    WorkflowActionHandlers._update_mitigation_status(db, instance, definition,
                                                     {"mitigation_id": action.id, "status": "completed"})
    assert action.status == "completed" and action.completed_at is not None
    WorkflowActionHandlers._link_risk_to_mitigation(db, instance, definition, {"mitigation_id": action.id, "risk_id": 2})
    assert action.issue.source_id == 2
    other_tenant = SimpleNamespace(id=2, tenant_id=2)
    assert WorkflowActionHandlers._create_mitigation_plan(db, other_tenant, definition, {"risk_id": 1})["result"] == \
        "risk_not_found_or_unauthorized"


# ── found in the live check: deleting a risk with actions, and the dashboards' shaped rows ──

def test_deleting_a_risk_with_actions_cancels_its_treatment_issue_and_keeps_it(db):
    http = client(db)
    add_action(http)
    assert http.delete("/erm/risks/1").status_code == 204
    assert db.query(Risk).filter_by(id=1).first() is None and db.query(IssueRiskLink).count() == 0
    [issue] = db.query(Issue).all()
    assert (issue.workflow_state, issue.closure_notes) == ("cancelled", "Risk deleted: Wire fraud")
    assert {a.status for a in db.query(IssueAction).all()} == {"cancelled"}


def test_the_dashboard_rows_carry_what_the_treatment_dashboards_read(db):
    from grc.modules.issue_management.services.risk_actions import legacy_shaped_actions
    add_action(client(db), action_type="corrective")
    [row] = legacy_shaped_actions(db, [1])
    assert (row.risk_id, row.action_type, row.owner_id, row.status) == (1, "corrective", OWNER, "planned")
