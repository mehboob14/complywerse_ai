"""The question-based RCSA flow end to end, which had no test at all (G8 audit section 10): an assessor starts, saves answers under the field names the
API stores, submits; the reviewer returns it, the assessor fixes and submits again, the reviewer approves; the numbers the Worklist and the dashboard
show are true; a finding is raised, linked and given an action. In-memory SQLite."""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, RCSAApprovalTier, RCSAApprovalWorkflow, RCSAAssessment, RCSACampaign, RCSAQuestion, RCSATemplate,
                        Risk, Role, Tenant, UserRole, get_db)
from grc.modules.erm.routers import rcsa as rcsa_routes
from grc.routers.auth_router import require_auth

auth_router = importlib.import_module("grc.routers.auth_router")      # the package re-exports a router under the same name

ADMIN, ASSESSOR, OTHER, APPROVER = 1, 2, 3, 4


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    for uid, name in [(ADMIN, "Admin"), (ASSESSOR, "Ayesha Assessor"), (OTHER, "Omar Other"), (APPROVER, "Aqib Approver")]:
        s.add(GRCUser(id=uid, username=name.split()[0].lower(), display_name=name, email=f"{uid}@bank.test", is_active=True))
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.add(BusinessUnit(id=1, tenant_id=1, name="Treasury"))
    s.add(BusinessUnit(id=2, tenant_id=1, name="Branch Operations"))
    tpl = RCSATemplate(id=1, tenant_id=1, name="Operational RCSA", category="operational", source="custom", version="1.0", is_system_template=False)
    s.add(tpl)
    s.flush()
    for order, (qtype, required, options) in enumerate([("risk_rating", True, []), ("control_rating", True, []), ("yes_no", True, []),
                                                       ("text", False, []), ("multiple_choice", True, ["Daily", "Weekly"])], start=1):
        s.add(RCSAQuestion(id=order, template_id=1, section="Controls", question_order=order, question_text=f"Question {order}", question_type=qtype,
                           is_required=required, options=options))
    s.add(RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q2 RCSA", period_label="Q2 2026", start_date=datetime.utcnow() - timedelta(days=20),
                       due_date=datetime.utcnow() + timedelta(days=10), status="active", created_by=ADMIN))
    s.add(RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=ASSESSOR, status="not_started"))
    s.add(RCSAAssessment(id=2, tenant_id=1, campaign_id=1, business_unit_id=2, assessor_id=OTHER, status="not_started"))
    s.commit()
    yield s
    s.close()


def client(db, user_id):
    app = FastAPI()
    app.include_router(rcsa_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(id=user_id).one()
    return TestClient(app, base_url="http://testserver/rcsa")


ANSWERS = [
    {"question_id": 1, "likelihood_rating": 4, "impact_rating": 3},
    {"question_id": 2, "control_effectiveness": "partially_effective"},
    {"question_id": 3, "response_value": "yes"},
    {"question_id": 4, "response_value": "Reviewed monthly"},
    {"question_id": 5, "response_value": "Weekly"},
]


def test_what_the_form_saves_is_what_the_detail_reads_back(db):
    """The old page sent likelihood / impact / effectiveness / yes_no_value / text_value, which the API ignores and then overwrote the stored row with:
    the answers were never kept. The fields the API stores are likelihood_rating, impact_rating, control_effectiveness and response_value."""
    me = client(db, ASSESSOR)
    started = me.post("/assessments/1/start")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "in_progress"
    assert me.post("/assessments/1/save", json={"responses": ANSWERS}).status_code == 200
    detail = me.get("/assessments/1/detail").json()
    got = {r["question_id"]: r for r in detail["responses"]}
    assert (got[1]["likelihood"], got[1]["impact"]) == (4, 3)
    assert got[2]["effectiveness"] == "partially_effective"
    assert got[3]["yes_no_value"] is True
    assert got[4]["text_value"] == "Reviewed monthly" and got[5]["text_value"] == "Weekly"
    assert [q["options"] for q in detail["questions"] if q["id"] == 5] == [["Daily", "Weekly"]]


def test_the_old_payload_stores_nothing(db):
    me = client(db, ASSESSOR)
    me.post("/assessments/1/start")
    old = [{"question_id": 1, "likelihood": 4, "impact": 3}, {"question_id": 2, "effectiveness": "effective"}, {"question_id": 3, "yes_no_value": True}]
    me.post("/assessments/1/save", json={"responses": old})
    got = {r["question_id"]: r for r in me.get("/assessments/1/detail").json()["responses"]}
    assert all(r["likelihood"] is None and r["effectiveness"] is None and r["yes_no_value"] is None for r in got.values())


def test_one_answer_at_a_time_keeps_the_others(db):
    """The form saves the question that changed; saving it must not blank the rest."""
    me = client(db, ASSESSOR)
    me.post("/assessments/1/start")
    me.post("/assessments/1/save", json={"responses": ANSWERS})
    me.post("/assessments/1/save", json={"responses": [{"question_id": 1, "likelihood_rating": 5, "impact_rating": 5}]})
    got = {r["question_id"]: r for r in me.get("/assessments/1/detail").json()["responses"]}
    assert (got[1]["likelihood"], got[1]["impact"]) == (5, 5) and got[2]["effectiveness"] == "partially_effective" and got[5]["text_value"] == "Weekly"


def test_submit_return_fix_resubmit_approve_and_the_trail(db):
    me, boss = client(db, ASSESSOR), client(db, ADMIN)
    me.post("/assessments/1/start")
    me.post("/assessments/1/save", json={"responses": ANSWERS})
    sub = me.post("/assessments/1/submit").json()
    assert sub["status"] == "submitted" and sub["overall_risk_score"] == 12 and sub["overall_control_score"] == 2
    assert me.post("/assessments/1/save", json={"responses": ANSWERS}).status_code == 400            # read only while it waits for review

    back = boss.post("/assessments/1/return", json={"comments": "Add evidence for Q2"}).json()
    assert back["status"] == "requires_changes"
    assert me.post("/assessments/1/save", json={"responses": [{"question_id": 2, "control_effectiveness": "effective"}]}).status_code == 200
    assert me.post("/assessments/1/submit").json()["status"] == "submitted"
    done = boss.post("/assessments/1/approve", json={"comments": "Good"}).json()
    assert done["status"] == "approved"

    detail = boss.get("/assessments/1/detail").json()
    assert [h["action"] for h in detail["approval_history"]] == ["submitted", "returned", "submitted", "approved"]
    assert detail["approval_history"][1]["comments"] == "Add evidence for Q2" and detail["approval_history"][1]["performer_name"] == "Admin"
    assert detail["assessor_id"] == ASSESSOR and detail["campaign_status"] == "active" and detail["total_tiers"] == 1
    assert detail["overall_risk_score"] == 12 and detail["template_name"] == "Operational RCSA"


def test_reject_is_a_dead_end_the_server_keeps(db):
    me, boss = client(db, ASSESSOR), client(db, ADMIN)
    me.post("/assessments/1/start")
    me.post("/assessments/1/submit")
    assert boss.post("/assessments/1/reject", json={"comments": "No"}).json()["status"] == "rejected"
    assert me.post("/assessments/1/start").status_code == 400 and me.post("/assessments/1/submit").status_code == 400


def test_the_dashboard_summary_carries_pending_and_open_findings(db):
    """The response model used to drop both, so two tiles read 0 for ever."""
    me = client(db, ASSESSOR)
    me.post("/assessments/1/start")
    db_boss = client(db, ADMIN)
    summary = db_boss.get("/dashboard/summary").json()
    assert summary["pending_assessments"] == 2 and summary["open_findings"] == 0 and summary["total_assessments"] == 2
    db_boss.post("/findings", params={"assessment_id": 1}, json={"finding_type": "control_gap", "severity": "high", "title": "Weak control"})
    assert db_boss.get("/dashboard/summary").json()["open_findings"] == 1


def test_my_work_counts_are_true_and_each_person_sees_their_own(db):
    me, other, boss = client(db, ASSESSOR), client(db, OTHER), client(db, ADMIN)
    work = me.get("/my-work").json()
    assert work["counts"]["to_complete"] == 1 and work["counts"]["to_review"] == 0 and work["roles"] == {"manage": False, "review": False, "assess": True}
    assert [r["business_unit_name"] for r in work["rows"]] == ["Treasury"] and work["rows"][0]["kind"] == "complete"
    me.post("/assessments/1/start")
    me.post("/assessments/1/save", json={"responses": ANSWERS[:3]})
    row = me.get("/my-work").json()["rows"][0]
    assert row["progress"] == 75                                    # 3 of the 4 required questions answered
    me.post("/assessments/1/submit")
    # the assessor never reviews their own; the other unit's person is not a reviewer; the administrator is
    assert me.get("/my-work").json()["counts"]["to_review"] == 0 and other.get("/my-work").json()["counts"]["to_review"] == 0
    admin_work = boss.get("/my-work").json()
    assert admin_work["counts"]["to_review"] == 1 and admin_work["roles"]["manage"] and admin_work["rows"][0]["kind"] == "review"
    assert admin_work["campaigns"][0]["name"] == "Q2 RCSA" and admin_work["campaigns"][0]["waiting_review"] == 1
    boss.post("/assessments/1/return", json={"comments": "Redo Q2"})
    again = me.get("/my-work").json()
    assert again["counts"]["returned"] == 1 and again["rows"][0]["kind"] == "returned" and again["rows"][0]["return_comment"] == "Redo Q2"


def test_a_named_tier_approver_reviews_and_a_stranger_does_not(db):
    wf = RCSAApprovalWorkflow(id=1, tenant_id=1, name="Two steps", is_default=True)
    db.add(wf)
    db.flush()
    db.add(RCSAApprovalTier(workflow_id=1, tier_order=1, tier_name="Line", approver_type="user", approver_user_id=APPROVER))
    db.add(RCSAApprovalTier(workflow_id=1, tier_order=2, tier_name="Risk", approver_type="role", approver_role_id=1))
    db.query(RCSACampaign).filter_by(id=1).one().approval_workflow_id = 1
    db.commit()
    me = client(db, ASSESSOR)
    me.post("/assessments/1/start")
    me.post("/assessments/1/submit")
    assert client(db, APPROVER).get("/my-work").json()["counts"]["to_review"] == 1
    assert client(db, OTHER).get("/my-work").json()["counts"]["to_review"] == 0
    detail = client(db, ADMIN).get("/assessments/1/detail").json()
    assert detail["total_tiers"] == 2 and detail["current_approval_tier"] == 1
    assert client(db, ADMIN).post("/assessments/1/approve", json={}).json()["status"] == "under_review"
    # step two is the role (the administrator role): the line approver no longer has it
    assert client(db, APPROVER).get("/my-work").json()["counts"]["to_review"] == 0


def test_findings_list_names_what_they_link_to_and_the_link_calls_take_query_parameters(db):
    boss = client(db, ADMIN)
    made = boss.post("/findings", params={"assessment_id": 1}, json={"finding_type": "control_gap", "severity": "high", "title": "Weak control"}).json()
    risk = Risk(tenant_id=1, title="Payment fraud", category="operational", owner_id=ADMIN, status="open")
    db.add(risk)
    db.commit()
    assert boss.post(f"/findings/{made['id']}/link-risk", params={"risk_id": risk.id}).status_code == 200
    assert boss.post(f"/findings/{made['id']}/create-action").status_code == 200
    row = boss.get("/findings").json()[0]
    assert (row["campaign_name"], row["business_unit_name"], row["linked_risk_title"]) == ("Q2 RCSA", "Treasury", "Payment fraud")
    assert row["linked_action_title"] == "Remediate: Weak control" and row["linked_control_name"] is None
    assert boss.put(f"/findings/{made['id']}", json={"status": "in_progress"}).json()["status"] == "in_progress"


def test_the_campaign_register_carries_owner_unit_states_and_open_findings(db):
    boss = client(db, ADMIN)
    client(db, ASSESSOR).post("/assessments/1/start")
    boss.post("/findings", params={"assessment_id": 1}, json={"finding_type": "control_gap", "severity": "low", "title": "x"})
    row = boss.get("/campaigns").json()[0]
    assert row["created_by_name"] == "Admin" and row["status_counts"] == {"in_progress": 1, "not_started": 1} and row["open_findings"] == 1
    detail = boss.get("/campaigns/1/detail").json()
    assert detail["status_counts"] == row["status_counts"] and detail["assessments"][0]["current_approval_tier"] == 0
    templates = boss.get("/templates").json()
    assert templates[0]["campaign_count"] == 1 and templates[0]["question_count"] == 5
