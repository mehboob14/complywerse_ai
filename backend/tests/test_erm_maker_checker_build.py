"""Maker-checker on every existing approval in Risk Management (wave 1-B). In-memory SQLite.

The person who did the work cannot approve, verify or close it, administrators included (409); a second person with the
right permission can. Closing an issue also waits for its CAPA actions, the workbench moves only from the statuses each
step allows, and a workflow cannot close an issue on its own.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, ControlWorkItem, ControlWorkTest, GRCUser, InternalControl, Issue,
                        IssueAction, RCSAAssessment, RCSACampaign, RCSATemplate, RiskAssessment, RiskKRI,
                        RiskKRIMeasurement, Role, Tenant, UserRole, get_db)
from grc.modules.control_library.routers import workbench
from grc.modules.erm.routers import internal_controls, kris_workflow, rcsa, risk_assessments
from grc.modules.issue_management.routers import actions, issues
from grc.modules.workflow_engine.services.action_handlers import ActionRefused, WorkflowActionHandlers
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER = 7, 8


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=MAKER, username="maker", display_name="Maker", email="maker@bank.test", is_active=True),
               GRCUser(id=CHECKER, username="checker", display_name="Checker", email="checker@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=MAKER, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username):
    app = FastAPI()
    for r in (rcsa.router, internal_controls.router, workbench.router, issues.router, actions.router_issue,
              actions.router_actions, kris_workflow.router, risk_assessments.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def save(db, row):
    db.add(row)
    db.commit()
    return row


def refused_for_the_maker(res):
    assert res.status_code == 409, res.text
    assert "someone else" in res.json()["detail"]


# ── RCSA ──────────────────────────────────────────────────────────────────────

def _rcsa(db, **fields):
    now = datetime.utcnow()
    if not db.get(RCSACampaign, 1):
        db.add(RCSATemplate(id=1, tenant_id=1, name="Ops", category="operational_risk"))
        db.add(RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q4 RCSA", period_type="quarterly",
                            period_label="Q4 2026", start_date=now, due_date=now + timedelta(days=30), status="active"))
    unit = save(db, BusinessUnit(tenant_id=1, name=f"Unit {db.query(BusinessUnit).count() + 1}"))
    return save(db, RCSAAssessment(tenant_id=1, campaign_id=1, business_unit_id=unit.id, **fields))


def test_the_submitter_of_an_rcsa_cannot_approve_reject_or_return_it(db):
    assessment = _rcsa(db, assessor_id=MAKER, status="in_progress")
    maker, checker = client(db, "maker"), client(db, "checker")
    assert maker.post(f"/rcsa/assessments/{assessment.id}/submit").status_code == 200
    db.refresh(assessment)
    assert assessment.submitted_by == MAKER
    for step in ("approve", "reject", "return"):
        refused_for_the_maker(maker.post(f"/rcsa/assessments/{assessment.id}/{step}", json={"comments": "mine"}))
    db.refresh(assessment)
    assert assessment.status == "submitted"
    ok = checker.post(f"/rcsa/assessments/{assessment.id}/approve", json={"comments": "Checked"})
    assert ok.status_code == 200 and ok.json()["status"] == "approved"


def test_an_rcsa_submitted_before_the_column_falls_back_to_its_assessor(db):
    assessment = _rcsa(db, assessor_id=MAKER, status="submitted", current_approval_tier=1)
    refused_for_the_maker(client(db, "maker").post(f"/rcsa/assessments/{assessment.id}/approve", json={}))
    assert client(db, "checker").post(f"/rcsa/assessments/{assessment.id}/return", json={"comments": "More"}).status_code == 200


# ── Internal controls (ERM register) ──────────────────────────────────────────

def test_the_submitter_of_a_control_cannot_approve_or_reject_it(db):
    control = save(db, InternalControl(tenant_id=1, control_id="IC-001", name="Dual control", status="draft"))
    maker, checker = client(db, "maker"), client(db, "checker")
    assert maker.post(f"/internal-controls/{control.id}/submit", json={}).status_code == 200
    db.refresh(control)
    assert control.submitted_by == MAKER
    refused_for_the_maker(maker.post(f"/internal-controls/{control.id}/approve", json={}))
    refused_for_the_maker(maker.post(f"/internal-controls/{control.id}/reject", json={}))
    assert checker.post(f"/internal-controls/{control.id}/approve", json={}).status_code == 200
    db.refresh(control)
    assert (control.status, control.approved_by) == ("active", CHECKER)


def test_a_control_pending_before_the_column_falls_back_to_its_creator(db):
    control = save(db, InternalControl(tenant_id=1, control_id="IC-002", name="Recon", status="pending_approval",
                                       created_by=MAKER))
    refused_for_the_maker(client(db, "maker").post(f"/internal-controls/{control.id}/approve", json={}))
    assert client(db, "checker").post(f"/internal-controls/{control.id}/reject", json={}).status_code == 200


# ── Control Library workbench ─────────────────────────────────────────────────

def _work_item(db, **fields):
    fields.setdefault("source_type", "framework")
    fields.setdefault("source_id", db.query(ControlWorkItem).count() + 1)
    return save(db, ControlWorkItem(tenant_id=1, name="Access review", **fields))


def test_the_workbench_submitter_cannot_approve_and_a_second_person_can(db):
    item = _work_item(db, status="draft")
    maker, checker = client(db, "maker"), client(db, "checker")
    assert maker.post(f"/workbench/items/{item.id}/submit", json={}).json()["status"] == "pending_approval"
    refused_for_the_maker(maker.post(f"/workbench/items/{item.id}/approve", json={}))
    refused_for_the_maker(maker.post(f"/workbench/items/{item.id}/reject", json={}))
    ok = checker.post(f"/workbench/items/{item.id}/approve", json={})
    assert ok.status_code == 200 and ok.json()["status"] == "active"
    db.refresh(item)
    assert item.approved_by == CHECKER


def test_the_workbench_falls_back_to_the_creator_and_reads_a_submit_made_on_the_register(db):
    legacy = _work_item(db, status="pending_approval", created_by=MAKER)
    refused_for_the_maker(client(db, "maker").post(f"/workbench/items/{legacy.id}/approve", json={}))
    control = save(db, InternalControl(tenant_id=1, control_id="IC-003", name="Limits", status="draft"))
    item = _work_item(db, source_type="internal", source_id=control.id, status="pending_approval")
    assert client(db, "maker").post(f"/internal-controls/{control.id}/submit", json={}).status_code == 200
    refused_for_the_maker(client(db, "maker").post(f"/workbench/items/{item.id}/approve", json={}))


@pytest.mark.parametrize("step, status", [("approve", "draft"), ("reject", "active"), ("submit", "pending_approval"),
                                          ("submit", "active")])
def test_a_workbench_step_refuses_a_status_it_does_not_move_from(db, step, status):
    item = _work_item(db, status=status, created_by=MAKER)
    res = client(db, "checker").post(f"/workbench/items/{item.id}/{step}", json={})
    assert res.status_code == 400, res.text
    db.refresh(item)
    assert item.status == status


def test_the_tester_cannot_review_their_own_test(db):
    item = _work_item(db, status="active")
    test = save(db, ControlWorkTest(work_item_id=item.id, tenant_id=1, test_type="operating", result="effective",
                                    tester_id=MAKER, status="completed"))
    refused_for_the_maker(client(db, "maker").post(f"/workbench/tests/{test.id}/review", json={"action": "reviewed"}))
    ok = client(db, "checker").post(f"/workbench/tests/{test.id}/review", json={"action": "reviewed"})
    assert ok.status_code == 200 and ok.json()["status"] == "reviewed"
    db.refresh(test)
    assert test.reviewer_id == CHECKER


# ── Issues and CAPA actions ───────────────────────────────────────────────────

def _issue(db, **fields):
    fields.setdefault("workflow_state", "closure_review")
    return save(db, Issue(tenant_id=1, title="Gap", status="open", **fields))


@pytest.mark.parametrize("role", ["assignee_id", "owner_id"])
def test_the_issue_assignee_or_owner_cannot_close_it(db, role):
    issue = _issue(db, **{role: MAKER})
    maker = client(db, "maker")
    refused_for_the_maker(maker.post(f"/issues/{issue.id}/close", json={"closure_notes": "Done"}))
    refused_for_the_maker(maker.post(f"/issues/{issue.id}/transition", json={"to_state": "closed", "notes": "Done"}))
    ok = client(db, "checker").post(f"/issues/{issue.id}/close", json={"closure_notes": "Checked and done"})
    assert ok.status_code == 200, ok.text
    db.refresh(issue)
    assert (issue.workflow_state, issue.approved_by_id) == ("closed", CHECKER)


def test_an_issue_does_not_close_while_a_capa_action_is_open(db):
    issue = _issue(db)
    save(db, IssueAction(issue_id=issue.id, title="Patch the ledger", status="in_progress"))
    save(db, IssueAction(issue_id=issue.id, title="Retrain staff", status="planned"))
    save(db, IssueAction(issue_id=issue.id, title="Done already", status="verified"))
    save(db, IssueAction(issue_id=issue.id, title="Dropped", status="cancelled"))
    checker = client(db, "checker")
    for res in (checker.post(f"/issues/{issue.id}/close", json={"closure_notes": "Done"}),
                checker.post(f"/issues/{issue.id}/transition", json={"to_state": "closed", "notes": "Done"})):
        assert res.status_code == 409, res.text
        detail = res.json()["detail"]
        assert "Patch the ledger" in detail and "Retrain staff" in detail and "Done already" not in detail
    db.refresh(issue)
    assert issue.workflow_state == "closure_review"
    for action in db.query(IssueAction).filter(IssueAction.status.in_(("in_progress", "planned"))):
        action.status = "completed"
    db.commit()
    assert checker.post(f"/issues/{issue.id}/close", json={"closure_notes": "Done"}).status_code == 200


def test_whoever_completed_a_capa_action_cannot_verify_it(db):
    issue = _issue(db, workflow_state="in_progress")
    action = save(db, IssueAction(issue_id=issue.id, title="Patch the ledger", status="in_progress"))
    maker, checker = client(db, "maker"), client(db, "checker")
    assert maker.patch(f"/actions/{action.id}", json={"status": "completed"}).status_code == 200
    db.refresh(action)
    assert action.completed_by == MAKER
    refused_for_the_maker(maker.post(f"/actions/{action.id}/verify", json={}))
    refused_for_the_maker(maker.patch(f"/actions/{action.id}", json={"status": "verified"}))
    ok = checker.post(f"/actions/{action.id}/verify", json={})
    assert ok.status_code == 200 and ok.json()["verified_by_id"] == CHECKER


def test_completing_and_verifying_in_one_step_is_refused(db):
    issue = _issue(db, workflow_state="in_progress")
    action = save(db, IssueAction(issue_id=issue.id, title="Patch", status="in_progress"))
    res = client(db, "checker").patch(f"/actions/{action.id}", json={"status": "verified"})
    assert res.status_code == 409, res.text
    db.refresh(action)
    assert action.status == "in_progress" and action.verified_by_id is None


def test_the_assignee_of_a_capa_action_cannot_verify_it_either(db):
    issue = _issue(db, workflow_state="in_progress")
    action = save(db, IssueAction(issue_id=issue.id, title="Patch", status="completed", assignee_id=MAKER,
                                  completed_at=datetime.utcnow()))
    refused_for_the_maker(client(db, "maker").post(f"/actions/{action.id}/verify", json={}))
    assert client(db, "checker").post(f"/actions/{action.id}/verify", json={}).status_code == 200


def test_a_workflow_cannot_close_an_issue(db):
    issue = _issue(db)
    run = SimpleNamespace(id=1, tenant_id=1)
    with pytest.raises(ActionRefused):
        WorkflowActionHandlers._transition_issue_state(db, run, SimpleNamespace(id=1),
                                                       {"issue_id": issue.id, "to_state": "closed"})
    db.refresh(issue)
    assert issue.workflow_state == "closure_review" and issue.closed_at is None
    moved = WorkflowActionHandlers._transition_issue_state(db, run, SimpleNamespace(id=1),
                                                           {"issue_id": issue.id, "to_state": "in_progress"})
    assert moved["to_state"] == "in_progress"


# ── KRI values ────────────────────────────────────────────────────────────────

def test_whoever_submitted_a_kri_value_cannot_approve_or_reject_it(db):
    kri = save(db, RiskKRI(tenant_id=1, name="Overdue patches", reviewer_id=CHECKER, green_threshold=1,
                           amber_threshold=3, is_active=True))
    maker, checker = client(db, "maker"), client(db, "checker")
    submitted = maker.post(f"/kri-workflow/kris/{kri.id}/submit", json={"value": 7}).json()
    assert submitted["review_status"] == "submitted"
    mid = submitted["measurement_id"]
    refused_for_the_maker(maker.post(f"/kri-workflow/measurements/{mid}/approve"))
    refused_for_the_maker(maker.post(f"/kri-workflow/measurements/{mid}/reject", json={}))
    ok = checker.post(f"/kri-workflow/measurements/{mid}/approve")
    assert ok.status_code == 200 and ok.json()["current_value"] == 7
    assert db.get(RiskKRIMeasurement, mid).reviewed_by == CHECKER


# ── Risk assessments ──────────────────────────────────────────────────────────

def test_whoever_sent_a_risk_assessment_for_review_cannot_approve_it(db):
    assessment = save(db, RiskAssessment(tenant_id=1, name="Annual", status="in_progress"))
    maker, checker = client(db, "maker"), client(db, "checker")
    assert maker.post(f"/risk-assessments/{assessment.id}/status", json={"status": "under_review"}).status_code == 200
    db.refresh(assessment)
    assert assessment.submitted_by == MAKER
    refused_for_the_maker(maker.post(f"/risk-assessments/{assessment.id}/status", json={"status": "approved"}))
    # sending it back is not an approval
    assert maker.post(f"/risk-assessments/{assessment.id}/status", json={"status": "in_progress"}).status_code == 200
    assert maker.post(f"/risk-assessments/{assessment.id}/status", json={"status": "under_review"}).status_code == 200
    ok = checker.post(f"/risk-assessments/{assessment.id}/status", json={"status": "approved"})
    assert ok.status_code == 200 and ok.json()["approved_by"] == CHECKER


def test_a_risk_assessment_under_review_before_the_column_falls_back_to_its_lead(db):
    assessment = save(db, RiskAssessment(tenant_id=1, name="Ad hoc", status="under_review", lead_assessor_id=MAKER))
    refused_for_the_maker(client(db, "maker").post(f"/risk-assessments/{assessment.id}/status", json={"status": "approved"}))
    assert client(db, "checker").post(f"/risk-assessments/{assessment.id}/status",
                                      json={"status": "approved"}).status_code == 200

# ── found after the build: the workbench approvals check a permission; a task sync cannot self-verify ──

def test_a_user_without_the_control_right_cannot_approve_in_the_workbench(db):
    save(db, GRCUser(id=9, username="reader", display_name="Reader", email="reader@bank.test", is_active=True))
    item = _work_item(db, status="pending_approval")
    assert client(db, "reader").post(f"/workbench/items/{item.id}/approve", json={}).status_code == 403


def test_a_task_marked_verified_by_whoever_completed_the_action_only_completes_it(db):
    from grc.models import CriticalTask
    from grc.modules.issue_management.services.task_sync import sync_action_from_task
    issue = _issue(db)
    action = save(db, IssueAction(issue_id=issue.id, title="Patch", status="in_progress"))
    task = save(db, CriticalTask(tenant_id=1, title="Patch", status="Verified", linked_issue_action_id=action.id))
    sync_action_from_task(task.id, db, user_id=MAKER)
    db.commit()
    db.refresh(action)
    assert action.status == "completed" and action.completed_by == MAKER and action.verified_by_id is None
    sync_action_from_task(task.id, db, user_id=MAKER)          # the same person again: still not verified
    db.commit()
    db.refresh(action)
    assert action.status == "completed"
    sync_action_from_task(task.id, db, user_id=CHECKER)        # a second person verifies
    db.commit()
    db.refresh(action)
    assert action.status == "verified" and action.verified_by_id == CHECKER
