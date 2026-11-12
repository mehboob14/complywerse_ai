"""One Assessments entry point and approved results written to the register (wave 3-I-a, decision 1).

- GET /erm/assessments lists risk workshops, RCSA self-assessments and framework IT risk assessments in one status vocabulary
  (Planned / In progress / Under review / Returned / Approved / Closed), the caller's own first; RCSA rows only for someone
  with an RCSA right (or the assessor the row is assigned to);
- approving a risk workshop writes each assessed risk's scores to the register, with the assessment as the reason in its history;
- approving a framework assessment raises its unacceptable questions as register risks, once.
Non-admin roles throughout. In-memory SQLite, the real /erm router.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, FrameworkRiskAssessment, FrameworkRiskQuestion, GRCUser, Permission,
                        RCSAAssessment, RCSACampaign, RCSATemplate, Risk, RiskAssessment, RiskAssessmentRisk,
                        RiskScoreHistory, Role, RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.routers.auth_router import create_access_token, require_auth

LEAD, CHECKER, OWNER, OTHER = 7, 8, 9, 10
DUE = datetime(2026, 12, 15)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Risk team"), Role(id=2, name="Risk viewer")])
    perms = {1: "erm:risks:view", 2: "erm:risks:edit", 3: "erm:risks:create", 4: "erm:rcsa:view"}
    s.add_all([Permission(id=i, name=n, resource=n.rsplit(":", 1)[0], action=n.rsplit(":", 1)[1]) for i, n in perms.items()])
    s.add_all([RolePermission(role_id=1, permission_id=p) for p in (1, 2, 3, 4)] + [RolePermission(role_id=2, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((LEAD, "lead"), (CHECKER, "checker"), (OWNER, "owner"), (OTHER, "other"))])
    s.add_all([UserRole(user_id=LEAD, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1),
               UserRole(user_id=OWNER, role_id=2, tenant_id=1), UserRole(user_id=OTHER, role_id=2, tenant_id=1)])
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


def save(db, *rows):
    db.add_all(rows)
    db.commit()
    return rows[0]


@pytest.fixture()
def cycle(db):
    """Two of each kind, in statuses that cover the vocabulary."""
    treasury, payments, ops = (BusinessUnit(id=i, tenant_id=1, name=n) for i, n in ((1, "Treasury"), (2, "Payments"), (3, "Ops")))
    save(db, treasury, payments, ops)
    save(db, RiskAssessment(id=1, tenant_id=1, name="Treasury workshop", status="draft", lead_assessor_id=LEAD,
                            business_unit_id=1, assessment_period_end=DUE),
         RiskAssessment(id=2, tenant_id=1, name="Payments workshop", status="in_progress", lead_assessor_id=CHECKER,
                        submitted_by=CHECKER, business_unit_id=2))                                # sent back from review
    save(db, RCSATemplate(id=1, tenant_id=1, name="Ops", category="operational_risk"))
    save(db, RCSACampaign(id=1, tenant_id=1, template_id=1, name="Q4 RCSA", start_date=DUE - timedelta(days=30),
                          due_date=DUE, status="active"))
    save(db, RCSAAssessment(id=1, tenant_id=1, campaign_id=1, business_unit_id=3, status="submitted", assessor_id=OWNER),
         RCSAAssessment(id=2, tenant_id=1, campaign_id=1, business_unit_id=1, status="requires_changes", assessor_id=CHECKER))
    save(db, FrameworkRiskAssessment(id=1, tenant_id=1, name="ISO 27001 IT risk", status="completed", created_by=CHECKER),
         FrameworkRiskAssessment(id=2, tenant_id=1, name="PCI DSS IT risk", status="archived", created_by=CHECKER))
    save(db, FrameworkRiskQuestion(assessment_id=1, question_text="Is MFA enforced?", assigned_user_id=LEAD, created_by=CHECKER))


def rows_of(res):
    assert res.status_code == 200, res.text
    return {(r["kind"], r["id"]): r for r in res.json()}


# ── one list ─────────────────────────────────────────────────────────────────

def test_the_list_holds_every_kind_in_one_status_vocabulary(db, cycle):
    rows = rows_of(client(db, "lead").get("/erm/assessments"))
    assert {k: r["status"] for k, r in rows.items()} == {
        ("risk_workshop", 1): "Planned", ("risk_workshop", 2): "Returned",
        ("self_assessment", 1): "Under review", ("self_assessment", 2): "Returned",
        ("framework_it_risk", 1): "Under review", ("framework_it_risk", 2): "Closed",
    }
    workshop = rows[("risk_workshop", 1)]
    assert (workshop["title"], workshop["unit"], workshop["lead"], workshop["due_date"][:10], workshop["url"]) == \
        ("Treasury workshop", "Treasury", "Lead", "2026-12-15", "/erm/risk-assessments/1")
    rcsa = rows[("self_assessment", 1)]
    assert (rcsa["title"], rcsa["unit"], rcsa["lead"], rcsa["due_date"][:10], rcsa["url"]) == \
        ("Q4 RCSA", "Ops", "Owner", "2026-12-15", "/erm/rcsa/assessments/1")
    assert rows[("framework_it_risk", 1)]["url"] == "/erm/risk-assessments/framework/1"
    assert rows[("self_assessment", 2)]["raw_status"] == "requires_changes"


def test_my_assignments_come_first(db, cycle):
    listed = client(db, "lead").get("/erm/assessments").json()
    mine = [(r["kind"], r["id"]) for r in listed if r["mine"]]
    assert sorted(mine) == [("framework_it_risk", 1), ("risk_workshop", 1)]       # lead assessor; a question assigned to them
    assert [r["mine"] for r in listed] == [True] * 2 + [False] * (len(listed) - 2)


def test_rcsa_rows_need_an_rcsa_right_except_the_assessors_own(db, cycle):
    other = rows_of(client(db, "other").get("/erm/assessments"))
    assert not [k for k in other if k[0] == "self_assessment"]
    assert {k for k in other if k[0] != "self_assessment"} == {("risk_workshop", 1), ("risk_workshop", 2),
                                                               ("framework_it_risk", 1), ("framework_it_risk", 2)}
    owner = rows_of(client(db, "owner").get("/erm/assessments"))
    assert [k for k in owner if k[0] == "self_assessment"] == [("self_assessment", 1)]
    assert owner[("self_assessment", 1)]["mine"] is True
    assert len([k for k in rows_of(client(db, "lead").get("/erm/assessments")) if k[0] == "self_assessment"]) == 2


# ── approved workshop results reach the register ─────────────────────────────

def workshop_under_review(db):
    scored = Risk(id=1, tenant_id=1, title="Payments outage", category="operational", inherent_likelihood=2,
                  inherent_impact=2, inherent_score=4, residual_likelihood=1, residual_impact=2, residual_score=2)
    unscored = Risk(id=2, tenant_id=1, title="Vendor failure", category="operational", inherent_likelihood=3,
                    inherent_impact=3, inherent_score=9)
    save(db, scored, unscored)
    save(db, RiskAssessment(id=5, tenant_id=1, name="Q4 workshop", status="under_review", lead_assessor_id=LEAD,
                            submitted_by=LEAD))
    save(db, RiskAssessmentRisk(assessment_id=5, risk_id=1, inherent_likelihood=4, inherent_impact=4, inherent_score=16,
                                residual_likelihood=3, residual_impact=2, residual_score=6),
         RiskAssessmentRisk(assessment_id=5, risk_id=2, inherent_likelihood=5))          # half a score: the register keeps its own


def test_approval_writes_the_assessed_scores_to_the_register_with_the_assessment_as_reason(db):
    workshop_under_review(db)
    refused = client(db, "lead").post("/erm/risk-assessments/5/status", json={"status": "approved"})
    assert refused.status_code == 409
    db.expire_all()
    assert db.get(Risk, 1).inherent_score == 4 and db.query(RiskScoreHistory).count() == 0

    ok = client(db, "checker").post("/erm/risk-assessments/5/status", json={"status": "approved"})
    assert ok.status_code == 200, ok.text
    db.expire_all()
    risk = db.get(Risk, 1)
    assert (risk.inherent_likelihood, risk.inherent_impact, risk.inherent_score) == (4, 4, 16)
    assert (risk.residual_likelihood, risk.residual_impact, risk.residual_score) == (3, 2, 6)
    [history] = db.query(RiskScoreHistory).filter_by(risk_id=1).all()
    assert "Q4 workshop" in history.reason and history.changed_by == CHECKER and history.residual_score == 6
    untouched = db.get(Risk, 2)
    assert (untouched.inherent_likelihood, untouched.inherent_score) == (3, 9)
    assert db.query(RiskScoreHistory).filter_by(risk_id=2).count() == 0


# ── framework approval raises the unacceptable questions, once ───────────────

def framework_completed(db):
    save(db, Risk(id=40, tenant_id=1, title="Raised before", category="framework_assessment"))
    save(db, FrameworkRiskAssessment(id=9, tenant_id=1, name="SAMA CSF IT risk", status="completed", created_by=LEAD,
                                     submitted_by=LEAD))
    q = dict(assessment_id=9, created_by=LEAD)
    save(db, FrameworkRiskQuestion(id=91, question_text="Are backups tested?", residual_likelihood=4, residual_impact=4,
                                   residual_score=16, **q),                                            # high: unacceptable
         FrameworkRiskQuestion(id=92, question_text="Is there a clean-desk rule?", residual_likelihood=1,
                               residual_impact=2, residual_score=2, **q),                              # low: stays
         FrameworkRiskQuestion(id=93, question_text="Is the DR site tested?", inherent_likelihood=4, inherent_impact=5,
                               inherent_score=20, **q),                                                # no residual: inherent
         FrameworkRiskQuestion(id=94, question_text="Are vendors vetted?", residual_score=4, is_risk_accepted=True, **q),
         FrameworkRiskQuestion(id=95, question_text="Is MFA enforced?", residual_score=20, linked_risk_id=40, **q))


def test_framework_approval_raises_unacceptable_questions_as_register_risks_once(db):
    framework_completed(db)
    assert client(db, "lead").put("/erm/framework-risk-assessments/9", json={"status": "approved"}).status_code == 409
    assert db.query(Risk).count() == 1

    checker = client(db, "checker")
    ok = checker.put("/erm/framework-risk-assessments/9", json={"status": "approved"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved" and ok.json()["approved_by"] == CHECKER
    db.expire_all()
    linked = {q.id: q.linked_risk_id for q in db.query(FrameworkRiskQuestion).filter_by(assessment_id=9)}
    assert linked[92] is None and linked[95] == 40                                   # an earlier raise is reused
    raised = [db.get(Risk, linked[i]) for i in (91, 93, 94)]
    assert all(r.source_reference == "framework_assessment:9" and r.status == "open" for r in raised)
    assert db.query(Risk).count() == 4

    assert checker.put("/erm/framework-risk-assessments/9", json={"status": "approved"}).status_code == 200
    assert checker.put("/erm/framework-risk-assessments/9", json={"status": "in_progress"}).status_code == 409
    assert db.query(Risk).count() == 4


def test_a_framework_assessment_is_approved_only_once_completed_and_the_old_move_call_still_works(db):
    framework_completed(db)
    db.query(FrameworkRiskAssessment).filter_by(id=9).update({"status": "in_progress"})
    db.commit()
    checker = client(db, "checker")
    assert checker.put("/erm/framework-risk-assessments/9", json={"status": "approved"}).status_code == 409
    moved = checker.post("/erm/framework-risk-assessments/9/questions/94/move-to-risk-register")
    assert moved.status_code == 200, moved.text
    again = checker.post("/erm/framework-risk-assessments/9/questions/94/move-to-risk-register")
    assert again.json()["risk_id"] == moved.json()["risk_id"] and db.query(Risk).count() == 2
    completed = client(db, "lead").put("/erm/framework-risk-assessments/9", json={"status": "completed"})
    assert completed.status_code == 200 and completed.json()["submitted_by"] == LEAD


def test_the_new_framework_columns_reach_existing_tenant_databases():
    from grc.modules.erm import schema_migrations
    listed = {col for table, col, _ in schema_migrations._ASSESSMENT_COLUMNS if table == "grc_framework_risk_assessments"}
    assert listed == {"submitted_by", "approved_by", "approved_at"}
