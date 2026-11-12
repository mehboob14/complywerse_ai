"""RCSA on the one Assessments engine (wave 3, I-b): versioned templates, questions linked to register risks and controls,
assessors told on activation, approved control ratings proposing a residual through a Risk Review (a second person
approves; the RCSA approval itself never writes the risk), ineffective controls raised as findings, and no one approving
two tiers of the same assessment. Non-admin roles throughout. In-memory SQLite, the real /erm router.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, InternalControl, Permission, RCSAApprovalTier, RCSAApprovalWorkflow,
                        RCSAAssessment, RCSACampaign, RCSAFinding, RCSAQuestion, RCSAResponse, RCSATemplate, Risk,
                        RiskReview, Role, RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import rcsa as rcsa_routes
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, SECOND, RISKER = 7, 8, 9, 10
ROLE_PERMS = {1: ("erm:risks:view", "erm:rcsa:view"),            # /erm itself asks for erm:risks:view
              2: ("erm:risks:view", "erm:rcsa:view", "erm:rcsa:edit", "erm:rcsa:create"),
              3: ("erm:risks:view", "erm:risks:edit")}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add_all([Role(id=1, name="1st line"), Role(id=2, name="RCSA manager"), Role(id=3, name="Risk team")])
    names = sorted({p for perms in ROLE_PERMS.values() for p in perms})
    s.add_all([Permission(id=i, name=n, resource=n.rsplit(":", 1)[0], action=n.rsplit(":", 1)[1])
               for i, n in enumerate(names, 1)])
    s.add_all([RolePermission(role_id=role, permission_id=names.index(p) + 1)
               for role, perms in ROLE_PERMS.items() for p in perms])
    users = ((MAKER, "maker", 1), (CHECKER, "checker", 2), (SECOND, "second", 2), (RISKER, "risker", 3))
    s.add_all([GRCUser(id=uid, username=n, display_name=n.title(), email=f"{n}@bank.test", is_active=True)
               for uid, n, _ in users])
    s.add_all([UserRole(user_id=uid, role_id=role, tenant_id=1) for uid, _, role in users])
    s.add_all([Risk(id=5, tenant_id=1, title="Card fraud", category="operational", inherent_likelihood=4, inherent_impact=4,
                    inherent_score=16, residual_likelihood=2, residual_impact=4, residual_score=8, owner_id=RISKER),
               Risk(id=6, tenant_id=1, title="Payments outage", category="operational", inherent_likelihood=4,
                    inherent_impact=3, inherent_score=12, residual_likelihood=2, residual_impact=3, residual_score=6),
               Risk(id=9, tenant_id=2, title="Someone else's risk", category="operational")])
    s.add(InternalControl(id=3, tenant_id=1, control_id="IC-003", name="Dual authorisation"))
    s.add(RCSATemplate(id=1, tenant_id=1, name="Ops", category="operational_risk", version="1.0"))
    s.add_all([RCSAQuestion(id=11, template_id=1, section="A", question_order=1, question_text="Fraud risk?",
                            question_type="risk_rating"),
               RCSAQuestion(id=12, template_id=1, section="A", question_order=2, question_text="Card checks?",
                            question_type="control_rating", risk_id=5),
               RCSAQuestion(id=15, template_id=1, section="A", question_order=3, question_text="Dual authorisation?",
                            question_type="control_rating", risk_id=5, internal_control_id=3),
               RCSAQuestion(id=16, template_id=1, section="B", question_order=4, question_text="Failover tested?",
                            question_type="control_rating", risk_id=6)])
    now = datetime.utcnow()
    s.add_all([RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q4 RCSA", period_type="quarterly", start_date=now,
                            due_date=now + timedelta(days=30), status="active"),
               RCSACampaign(id=2, tenant_id=1, template_id=1, name="Q1 RCSA", period_type="quarterly", start_date=now,
                            due_date=now + timedelta(days=90), status="draft")])
    s.add_all([BusinessUnit(id=1, tenant_id=1, name="Retail"), BusinessUnit(id=2, tenant_id=1, name="Treasury")])
    s.commit()
    yield s
    s.close()


def client(db, username):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def submitted(db, ratings, campaign_id=1):
    """The maker's assessment of Retail, submitted with these control ratings ({question id: effectiveness})."""
    db.add(RCSAAssessment(id=1, tenant_id=1, campaign_id=campaign_id, business_unit_id=1, assessor_id=MAKER,
                          status="in_progress"))
    db.commit()
    maker = client(db, "maker")
    answers = [{"question_id": q, "effectiveness": e} for q, e in ratings.items()]
    assert maker.post("/erm/rcsa/assessments/1/save", json={"responses": answers}).status_code == 200
    assert maker.post("/erm/rcsa/assessments/1/submit").status_code == 200


QUESTIONS = [{"id": 11, "question_text": "Fraud risk, card not present?", "question_type": "risk_rating"},
             {"id": 12, "question_text": "Card checks?", "question_type": "control_rating", "risk_id": 5}]


def test_editing_a_template_a_launched_campaign_uses_makes_the_next_version(db):
    http = client(db, "checker")
    saved = http.put("/erm/rcsa/templates/1", json={"questions": QUESTIONS})
    assert saved.status_code == 200, saved.text
    new = saved.json()
    assert new["id"] != 1 and new["version"] == "2.0" and new["previous_version_id"] == 1
    assert new["question_count"] == 2

    old = http.get("/erm/rcsa/templates/1").json()
    assert [q["question_text"] for q in old["questions"]][:1] == ["Fraud risk?"] and len(old["questions"]) == 4
    assert old["is_active"] is False
    assert [t["id"] for t in http.get("/erm/rcsa/templates").json()] == [new["id"]]
    # the superseded version cannot be edited into a second branch
    again = http.put("/erm/rcsa/templates/1", json={"name": "Ops (fork)"})
    assert again.status_code == 409, again.text


def test_a_campaign_keeps_the_version_it_launched_with(db):
    db.add(RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=MAKER, status="in_progress"))
    db.commit()
    http = client(db, "checker")
    new_id = http.put("/erm/rcsa/templates/1", json={"questions": QUESTIONS}).json()["id"]
    campaign = http.get("/erm/rcsa/campaigns/1").json()
    assert (campaign["template_id"], campaign["template_version"]) == (1, "1.0")
    texts = [q["question_text"] for q in http.get("/erm/rcsa/assessments/1/detail").json()["questions"]]
    assert texts == ["Fraud risk?", "Card checks?", "Dual authorisation?", "Failover tested?"]
    assert http.get(f"/erm/rcsa/templates/{new_id}").json()["version"] == "2.0"


def test_a_template_no_campaign_has_launched_is_edited_in_place(db):
    db.query(RCSACampaign).filter_by(id=1).update({"status": "draft"})
    db.commit()
    saved = client(db, "checker").put("/erm/rcsa/templates/1", json={"questions": QUESTIONS})
    assert saved.status_code == 200 and (saved.json()["id"], saved.json()["version"]) == (1, "1.0")


def test_question_links_are_saved_checked_and_returned(db):
    http = client(db, "checker")
    made = http.post("/erm/rcsa/templates", json={"name": "Linked", "category": "operational_risk", "questions": [
        {"question_text": "Dual authorisation works?", "question_type": "control_rating", "risk_id": 5,
         "internal_control_id": 3}]})
    assert made.status_code == 201, made.text
    tid = made.json()["id"]
    q = http.get(f"/erm/rcsa/templates/{tid}").json()["questions"][0]
    assert (q["risk_id"], q["risk_title"], q["internal_control_id"], q["control_name"]) == (
        5, "Card fraud", 3, "Dual authorisation")
    # edited on the template screen (no launched campaign: in place)
    q_id = q["id"]
    edited = http.put(f"/erm/rcsa/templates/{tid}", json={"questions": [
        {"id": q_id, "question_text": "Dual authorisation works?", "question_type": "control_rating", "risk_id": 6,
         "internal_control_id": None}]})
    assert edited.status_code == 200 and edited.json()["id"] == tid
    q = http.get(f"/erm/rcsa/templates/{tid}").json()["questions"][0]
    assert (q["risk_id"], q["internal_control_id"]) == (6, None)
    # another tenant's risk, or a control that does not exist, is refused
    for bad in ({"risk_id": 9}, {"internal_control_id": 404}):
        refused = http.put(f"/erm/rcsa/templates/{tid}", json={"questions": [
            {"question_text": "x", "question_type": "control_rating", **bad}]})
        assert refused.status_code == 404, refused.text
    # the assessment shows them beside each question
    db.add(RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=1, assessor_id=MAKER, status="in_progress"))
    db.commit()
    by_id = {q["id"]: q for q in http.get("/erm/rcsa/assessments/1/detail").json()["questions"]}
    assert (by_id[15]["risk_title"], by_id[15]["control_name"]) == ("Card fraud", "Dual authorisation")
    assert by_id[11]["risk_id"] is None


def test_activation_tells_each_assessor_where_their_assessment_is(db, monkeypatch):
    sent = []
    monkeypatch.setattr(rcsa_routes, "send_workflow_notification", lambda db_, **kw: sent.append(kw) or {"notified_users": 1})
    db.add_all([RCSAAssessment(id=21, tenant_id=1, campaign_id=2, business_unit_id=1, assessor_id=MAKER),
                RCSAAssessment(id=22, tenant_id=1, campaign_id=2, business_unit_id=2)])   # nobody assigned yet
    db.commit()
    activated = client(db, "checker").post("/erm/rcsa/campaigns/2/activate")
    assert activated.status_code == 200, activated.text
    assert [(kw["user_ids"], kw["link"], kw["tenant_id"]) for kw in sent] == [([MAKER], "/erm/rcsa/assessments/21", 1)]
    assert "Q1 RCSA" in sent[0]["subject"] and "Retail" in sent[0]["message"]
    db.expire_all()
    assert db.get(RCSAAssessment, 21).assigned_at is not None


def test_approval_proposes_the_residual_through_a_review_and_leaves_the_risk_alone(db):
    # risk 5: card checks partly effective, dual authorisation ineffective -> the weakest rating keeps the inherent
    # likelihood (4); risk 6: failover effective -> 4 - 2 = 2, its residual already, so nothing is proposed
    submitted(db, {12: "partially_effective", 15: "ineffective", 16: "effective"})
    approved = client(db, "checker").post("/erm/rcsa/assessments/1/approve", json={"comments": "Agreed"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    db.expire_all()
    risk = db.get(Risk, 5)
    assert (risk.residual_likelihood, risk.residual_impact, risk.residual_score) == (2, 4, 8)   # not written directly
    reviews = db.query(RiskReview).all()
    assert [(r.risk_id, r.status, r.proposed_residual_likelihood, r.proposed_residual_impact, r.reviewer_id,
             r.submitted_by) for r in reviews] == [(5, "submitted", 4, 4, MAKER, CHECKER)]
    assert "Q4 RCSA" in reviews[0].findings and "Retail" in reviews[0].findings

    # the RCSA approver cannot also approve the residual, even holding the risk grant; someone else does, and only
    # then the risk moves
    db.add(UserRole(user_id=CHECKER, role_id=3, tenant_id=1))
    db.commit()
    review_id = reviews[0].id
    same = client(db, "checker").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    assert same.status_code == 409, same.text
    done = client(db, "risker").put(f"/erm/reviews/{review_id}", json={"status": "approved"})
    assert done.status_code == 200, done.text
    db.expire_all()
    assert (db.get(Risk, 5).residual_likelihood, db.get(Risk, 5).residual_score) == (4, 16)

    # the ineffective control is a finding on the assessment, linked to its risk and control
    findings = db.query(RCSAFinding).all()
    assert [(f.finding_type, f.linked_risk_id, f.linked_internal_control_id, f.assessment_id) for f in findings] == [
        ("control_gap", 5, 3, 1)]


def test_no_one_approves_two_tiers_of_the_same_assessment(db):
    db.add(RCSAApprovalWorkflow(id=1, tenant_id=1, name="Unit head then risk"))
    db.add_all([RCSAApprovalTier(workflow_id=1, tier_order=1, tier_name="Unit head", approver_type="role"),
                RCSAApprovalTier(workflow_id=1, tier_order=2, tier_name="Risk", approver_type="role")])
    db.query(RCSACampaign).filter_by(id=1).update({"approval_workflow_id": 1})
    db.commit()
    submitted(db, {12: "effective"})
    assert client(db, "maker").post("/erm/rcsa/assessments/1/approve", json={}).status_code == 403   # view-only maker
    first = client(db, "checker").post("/erm/rcsa/assessments/1/approve", json={})
    assert first.status_code == 200 and first.json()["status"] == "under_review", first.text
    twice = client(db, "checker").post("/erm/rcsa/assessments/1/approve", json={})
    assert twice.status_code == 409, twice.text
    second = client(db, "second").post("/erm/rcsa/assessments/1/approve", json={})
    assert second.status_code == 200 and second.json()["status"] == "approved", second.text


def test_the_maker_cannot_approve_even_with_the_edit_grant(db):
    db.add(UserRole(user_id=MAKER, role_id=2, tenant_id=1))
    db.commit()
    submitted(db, {12: "effective"})
    refused = client(db, "maker").post("/erm/rcsa/assessments/1/approve", json={})
    assert refused.status_code == 409, refused.text
