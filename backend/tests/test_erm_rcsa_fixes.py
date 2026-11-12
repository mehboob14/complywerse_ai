"""RCSA defects (2026-11-11): answers saved blank, the approvals list that was always empty, findings links that answered 422,
status filters the server ignored, and writes any signed-in user could make. In-memory SQLite.
"""
import os
from datetime import datetime, timedelta

os.environ.setdefault("SESSION_SECRET", "test-secret")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, Permission, RCSAAssessment, RCSACampaign, RCSAFinding, RCSAQuestion,
                        RCSATemplate, Risk, Role, RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.routers import rcsa as routes
from grc.routers.auth_router import create_access_token, require_auth

ADMIN, VIEWER = 7, 8


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="RCSA viewer")])
    s.add(Permission(id=1, name="erm:rcsa:view", resource="erm:rcsa", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=ADMIN, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=VIEWER, username="viewer", display_name="Viewer", email="viewer@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=VIEWER, role_id=2, tenant_id=1)])
    s.add(RCSATemplate(id=1, tenant_id=1, name="Ops", category="operational_risk"))
    s.add_all([RCSAQuestion(id=11, template_id=1, section="A", question_text="Fraud risk?", question_type="risk_rating"),
               RCSAQuestion(id=12, template_id=1, section="A", question_text="Control?", question_type="control_rating"),
               RCSAQuestion(id=13, template_id=1, section="A", question_text="Policy?", question_type="yes_no"),
               RCSAQuestion(id=14, template_id=1, section="A", question_text="Notes", question_type="text")])
    now = datetime.utcnow()
    s.add(RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q4 RCSA", period_type="quarterly", period_label="Q4 2026",
                       start_date=now, due_date=now + timedelta(days=30), status="active"))
    s.add(RCSACampaign(id=2, tenant_id=1, template_id=1, name="Annual", period_type="annual", period_label="Annual 2027",
                       start_date=now, due_date=now + timedelta(days=300), status="draft"))
    s.add_all([BusinessUnit(id=1, tenant_id=1, name="Retail"), BusinessUnit(id=2, tenant_id=1, name="Treasury")])
    s.add_all([RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=ADMIN, status="in_progress"),
               RCSAAssessment(id=2, tenant_id=1, campaign_id=1, business_unit_id=2, assessor_id=VIEWER, status="submitted",
                              submitted_at=now, current_approval_tier=1, overall_risk_score=12.0)])
    s.add(Risk(id=5, tenant_id=1, title="Card fraud", category="operational"))
    s.add_all([RCSAFinding(id=1, tenant_id=1, assessment_id=1, finding_type="control_gap", title="No dual control", status="open"),
               RCSAFinding(id=2, tenant_id=1, assessment_id=1, finding_type="control_gap", title="Old policy", status="closed")])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


ANSWERS = [{"question_id": 11, "likelihood": 4, "impact": 3},
           {"question_id": 12, "effectiveness": "partially_effective"},
           {"question_id": 13, "yes_no_value": False},
           {"question_id": 14, "text_value": "Reviewed monthly"}]


def test_an_answer_saved_in_the_shape_the_page_reads_comes_back(db):
    http = client(db)
    saved = http.post("/rcsa/assessments/1/save", json={"responses": ANSWERS})
    assert saved.status_code == 200, saved.text
    back = {r["question_id"]: r for r in http.get("/rcsa/assessments/1/detail").json()["responses"]}
    assert (back[11]["likelihood"], back[11]["impact"]) == (4, 3)
    assert back[12]["effectiveness"] == "partially_effective"
    assert back[13]["yes_no_value"] is False and back[14]["text_value"] == "Reviewed monthly"
    # and submit averages real values now: risk 4 x 3, control "partially effective" = 2
    submitted = http.post("/rcsa/assessments/1/submit").json()
    assert (submitted["overall_risk_score"], submitted["overall_control_score"]) == (12.0, 2.0)


def test_the_stored_names_still_save(db):
    http = client(db)
    assert http.post("/rcsa/assessments/1/save", json={"responses": [
        {"question_id": 11, "likelihood_rating": 2, "impact_rating": 5}]}).status_code == 200
    back = http.get("/rcsa/assessments/1/detail").json()["responses"]
    assert (back[0]["likelihood"], back[0]["impact"]) == (2, 5)


def test_pending_approvals_lists_the_submitted_assessment_and_is_not_captured_by_the_id_route(db):
    http = client(db)
    pending = http.get("/rcsa/assessments/pending-approvals")
    assert pending.status_code == 200, pending.text
    rows = pending.json()
    assert [r["id"] for r in rows] == [2]
    assert (rows[0]["business_unit_name"], rows[0]["campaign_name"], rows[0]["current_approval_tier"], rows[0]["total_tiers"]) == (
        "Treasury", "Q4 RCSA", 1, 1)
    assert http.get("/rcsa/assessments/pending-approvals", params={"campaign_id": 2}).json() == []


def test_the_approval_detail_carries_tier_and_history(db):
    http = client(db)
    assert http.post("/rcsa/assessments/2/return", json={"comments": "Add evidence"}).status_code == 200
    detail = http.get("/rcsa/assessments/2/detail").json()
    assert detail["status"] == "requires_changes" and detail["total_tiers"] == 1
    assert detail["business_unit_name"] == "Treasury" and detail["overall_risk_score"] == 12.0
    assert [(h["action"], h["performer_name"], h["comments"]) for h in detail["approval_history"]] == [
        ("returned", "Officer", "Add evidence")]
    # a returned assessment is not pending any more, so it cannot be returned again
    assert http.post("/rcsa/assessments/2/return", json={"comments": "again"}).status_code == 400


def test_findings_link_risk_and_control_read_a_json_body_and_the_finding_can_be_read(db):
    http = client(db)
    linked = http.post("/rcsa/findings/1/link-risk", json={"risk_id": 5})
    assert linked.status_code == 200, linked.text
    assert linked.json()["linked_risk_id"] == 5
    assert http.post("/rcsa/findings/1/link-control", json={"control_id": 999}).status_code == 404   # parsed, then not found
    one = http.get("/rcsa/findings/1")
    assert one.status_code == 200, one.text
    body = one.json()
    assert body["linked_risk"] == {"id": 5, "title": "Card fraud"} and body["business_unit_name"] == "Retail"
    assert body["assessment_name"] == "Q4 RCSA" and body["mitigation_actions"] == []
    assert http.get("/rcsa/findings/404").status_code == 404


def test_create_action_keeps_what_the_form_typed(db):
    http = client(db)
    http.post("/rcsa/findings/1/link-risk", json={"risk_id": 5})
    made = http.post("/rcsa/findings/1/create-action", json={"title": "Add maker-checker", "due_date": "2026-12-31"})
    assert made.status_code == 200, made.text
    action = http.get("/rcsa/findings/1").json()["mitigation_actions"][0]
    assert action["title"] == "Add maker-checker" and action["due_date"].startswith("2026-12-31")
    # the action lives on the CAPA tracker (decision 2), and the finding shows the live action
    from grc.models import IssueAction
    live = db.query(IssueAction).filter(IssueAction.id == made.json()["id"]).one()
    assert live.title == "Add maker-checker" and live.status == "planned" and live.issue.source_id == 5
    assert action["id"] == live.id and action["status"] == "planned"


@pytest.mark.parametrize("path,params,expected", [
    ("/rcsa/assessments", {"status": "submitted", "mine": "false"}, [2]),
    ("/rcsa/assessments", {"status_filter": "in_progress", "mine": "false"}, [1]),
    ("/rcsa/findings", {"status": "closed"}, [2]),
    ("/rcsa/campaigns", {"status": "draft"}, [2]),
    ("/rcsa/campaigns", {"period": "Q4 2026"}, [1]),
])
def test_status_and_period_filters_apply(db, path, params, expected):
    assert [r["id"] for r in client(db).get(path, params=params).json()] == expected


def test_a_view_only_user_reads_but_cannot_write(db):
    http = client(db, "viewer")
    assert http.get("/rcsa/assessments/1/detail").status_code == 200
    assert http.post("/rcsa/assessments/1/save", json={"responses": ANSWERS}).status_code == 403
    assert http.post("/rcsa/assessments/2/approve", json={}).status_code == 403
    assert http.post("/rcsa/findings/1/link-risk", json={"risk_id": 5}).status_code == 403
    assert http.delete("/rcsa/campaigns/2").status_code == 403


def test_the_assigned_assessor_answers_and_submits_their_own_assessment_with_view_access(db):
    db.add(RCSAAssessment(id=3, tenant_id=1, campaign_id=2, business_unit_id=2, assessor_id=VIEWER, status="not_started"))
    db.commit()
    http = client(db, "viewer")
    assert http.get("/rcsa/assessments/3/detail").json()["can_answer"] is True
    assert http.get("/rcsa/assessments/1/detail").json()["can_answer"] is False
    assert http.post("/rcsa/assessments/3/start").status_code == 200
    assert http.post("/rcsa/assessments/3/save", json={"responses": ANSWERS}).status_code == 200
    assert http.post("/rcsa/assessments/3/submit").status_code == 200
    db.expire_all()
    assert db.get(RCSAAssessment, 3).status in ("submitted", "under_review")
    assert http.post("/rcsa/assessments/1/save", json={"responses": ANSWERS}).status_code == 403   # someone else's
    # once submitted, the assessor can no longer add evidence (assessment 3 is now submitted)
    late = http.post("/rcsa/evidence/upload", data={"assessment_id": "3", "question_id": "11"},
                     files={"file": ("late.txt", b"after the fact", "text/plain")})
    assert late.status_code == 409, late.text


def test_reminders_mail_open_assessors_and_export_is_csv(db, monkeypatch):
    from grc.modules.workflow_engine.services import email_service
    mailed = []
    monkeypatch.setattr(email_service, "send_email",
                        lambda db, tenant_id, to, subject, body: mailed.append(to) or {"success": True})
    http = client(db)
    sent = http.post("/rcsa/campaigns/1/reminders").json()
    assert mailed == ["officer@bank.test"] and sent["sent"] == 1     # the submitted one is not reminded
    exported = http.get("/rcsa/campaigns/1/export")
    assert exported.status_code == 200 and exported.headers["content-type"].startswith("text/csv")
    lines = exported.text.strip().splitlines()
    assert lines[0].startswith("Business unit,") and lines[1].startswith("Retail,Officer,in_progress")
    assert len(lines) == 3


def test_the_dashboard_summary_keeps_its_pending_and_open_counts(db):
    summary = client(db).get("/rcsa/dashboard/summary").json()
    assert (summary["pending_assessments"], summary["open_findings"], summary["pending_approval"]) == (1, 1, 1)
