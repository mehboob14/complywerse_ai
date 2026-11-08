"""Risk Assessments home (GET /erm/risk-assessments/register) and the small additions behind the revamp.

Additive: the register (manual + framework assessments in one list with true totals, no query per row), `search` on available-risks, `source` on the assessed-risk suggestion,
`reuse_existing` on the Excel upload, a cleared axis clearing the stored score, and the residual average dividing by the residual count. In-memory SQLite, over HTTP."""
import importlib
import io
from datetime import datetime, timedelta

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, FrameworkRiskAssessment, FrameworkRiskQuestion, GRCUser, Risk, RiskAssessment, RiskAssessmentRisk, Tenant, UploadedFramework, get_db)
from grc.routers.auth_router import require_auth

ra = importlib.import_module("grc.modules.erm.routers.risk_assessments")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([GRCUser(id=7, username="me", display_name="Me Myself", email="me@bank.test", is_active=True),
               GRCUser(id=8, username="lead", display_name="Lena Lead", email="lead@bank.test", is_active=True)])
    s.add(UploadedFramework(id=5, tenant_id=1, name="ISO 27005", file_name="f", file_path="f", file_type="json", uploaded_by=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(ra.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def seed(db):
    now = datetime(2026, 11, 1, 10, 0)
    db.add_all([Risk(id=i, tenant_id=1, title=f"Risk {i}", category="operational") for i in range(1, 6)])
    db.add(RiskAssessment(id=1, tenant_id=1, name="Q3 IT risks", status="under_review", lead_assessor_id=8, approved_by=None, updated_at=now, created_at=now))
    db.add(RiskAssessment(id=2, tenant_id=1, name="Empty one", status="draft", updated_at=now - timedelta(days=1), created_at=now))
    db.commit()
    db.add_all([
        RiskAssessmentRisk(assessment_id=1, risk_id=1, inherent_likelihood=4, inherent_impact=5, inherent_score=20, residual_likelihood=3, residual_impact=3, residual_score=9),
        RiskAssessmentRisk(assessment_id=1, risk_id=2, inherent_likelihood=2, inherent_impact=2, inherent_score=4),
        RiskAssessmentRisk(assessment_id=1, risk_id=3),
    ])
    fw = FrameworkRiskAssessment(id=1, tenant_id=1, uploaded_framework_id=5, name="ISO 27005 2026", status="in_progress", created_by=8, updated_at=now + timedelta(hours=1), created_at=now)
    db.add(fw)
    db.commit()
    for i, (st, who) in enumerate([("completed", 7), ("in_progress", 7), ("blocked", 8), ("not_started", None), ("not_started", 7)], start=1):
        db.add(FrameworkRiskQuestion(assessment_id=1, question_text=f"Q{i}", status=st, assigned_user_id=who, order_index=i, created_by=8))
    db.commit()


def test_the_register_lists_both_kinds_with_progress_and_the_true_total(db, http):
    seed(db)
    got = http.get("/risk-assessments/register").json()
    assert got["total"] == 3 and got["truncated"] is False and len(got["items"]) == 3
    assert [r["name"] for r in got["items"]] == ["ISO 27005 2026", "Q3 IT risks", "Empty one"]          # newest change first
    fw, manual, empty = got["items"]
    assert (fw["kind"], fw["owner_name"], fw["framework_name"]) == ("framework", "Lena Lead", "ISO 27005")
    assert (fw["total_items"], fw["done_items"], fw["blocked_items"], fw["mine_items"]) == (5, 1, 1, 2)   # mine: assigned to me and not completed (in progress, not started)
    assert (manual["kind"], manual["owner_name"], manual["status"]) == ("manual", "Lena Lead", "under_review")
    assert (manual["total_items"], manual["done_items"]) == (3, 1)                                         # one risk has a residual score
    assert (empty["total_items"], empty["done_items"], empty["owner_name"]) == (0, 0, None)


def test_the_register_runs_the_same_statements_for_a_few_or_many(db, http):
    seed(db)
    counted = []
    event.listen(db.get_bind(), "before_cursor_execute", lambda *a, **k: counted.append(1))
    http.get("/risk-assessments/register")
    few = len(counted)
    now = datetime(2026, 11, 2)
    for i in range(40):
        db.add(RiskAssessment(tenant_id=1, name=f"A{i}", status="draft", lead_assessor_id=8, updated_at=now, created_at=now))
        db.add(FrameworkRiskAssessment(tenant_id=1, uploaded_framework_id=5, name=f"F{i}", created_by=8, updated_at=now, created_at=now))
    db.commit()
    counted.clear()
    http.get("/risk-assessments/register")
    assert len(counted) == few


def test_available_risks_can_be_searched_and_paged(db, http):
    seed(db)
    db.add_all([Risk(id=100 + i, tenant_id=1, title=f"Vendor lock-in {i}", category="operational") for i in range(30)])
    db.commit()
    everything = http.get("/risk-assessments/2/available-risks?limit=500").json()
    assert len(everything) == 35
    vendors = http.get("/risk-assessments/2/available-risks?search=vendor&limit=500").json()
    assert len(vendors) == 30 and all("Vendor" in r["title"] for r in vendors)
    assert len(http.get("/risk-assessments/2/available-risks?search=VENDOR&limit=10&skip=25").json()) == 5     # case-insensitive, and a page of it
    assert [r["title"] for r in http.get("/risk-assessments/1/available-risks?search=risk&limit=500").json()] == ["Risk 4", "Risk 5"]   # the ones already in leave


def test_a_cleared_axis_clears_the_stored_score(db, http):
    seed(db)
    ar = db.query(RiskAssessmentRisk).filter_by(assessment_id=1, risk_id=1).one()
    r = http.put(f"/risk-assessments/1/risks/{ar.id}", json={"residual_impact": None}).json()
    assert r["residual_score"] is None and r["inherent_score"] == 20                      # only the residual score went
    r = http.put(f"/risk-assessments/1/risks/{ar.id}", json={"residual_impact": 4}).json()
    assert r["residual_score"] == 12
    r = http.put(f"/risk-assessments/1/risks/{ar.id}", json={"rationale": "text"}).json()
    assert r["residual_score"] == 12 and r["rationale"] == "text"                          # a note alone leaves the scores


def test_the_summary_divides_each_average_by_its_own_count(db, http):
    seed(db)
    s = http.get("/risk-assessments/1/summary").json()
    # inherent: (20 + 4) / 2 = 12; residual: 9 / 1 = 9 (it used to be 9 / 2)
    assert (s["avg_inherent_score"], s["avg_residual_score"], s["total_risks_assessed"]) == (12.0, 9.0, 3)


def test_the_suggestion_says_where_it_came_from(db, http, monkeypatch):
    seed(db)
    ar = db.query(RiskAssessmentRisk).filter_by(assessment_id=1, risk_id=1).one()
    monkeypatch.setattr(ra, "_get_openai_client", lambda: (_ for _ in ()).throw(RuntimeError("nobody home")))
    r = http.post(f"/risk-assessments/1/risks/{ar.id}/ai-suggest").json()
    assert r["source"] == "rules" and r["treatment_decision"] and r["control_effectiveness"]            # the rules answer is the same shape, now labelled


def workbook(*titles):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Risk Title", "Category", "Inherent Likelihood", "Inherent Impact"])
    for t in titles:
        ws.append([t, "operational", 3, 4])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_the_upload_can_use_the_register_risks_that_already_exist(db, http):
    seed(db)
    files = lambda: {"file": ("r.xlsx", workbook("Risk 1", "A brand new risk", "risk 1"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    plain = http.post("/risk-assessments/upload-excel", files=files(), data={"name": "Plain"}).json()
    assert (plain["risks_created"], plain["risks_reused"]) == (3, 0)                                   # today's behaviour is the default: a risk per row
    before = db.query(Risk).count()
    reused = http.post("/risk-assessments/upload-excel", files=files(), data={"name": "Reuse", "reuse_existing": "true"}).json()
    assert reused["risks_reused"] >= 1 and reused["risks_created"] + reused["risks_reused"] + reused["rows_skipped"] == 3
    assert db.query(Risk).count() == before                                                              # every title was already in the register by now
    one = http.post("/risk-assessments/upload-excel", files={"file": ("r.xlsx", workbook("Risk 2", "Totally different"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
                    data={"name": "Mixed", "reuse_existing": "true"}).json()
    assert (one["risks_created"], one["risks_reused"]) == (1, 1) and db.query(Risk).count() == before + 1


def test_an_ai_system_risk_can_be_created_and_listed(db):
    """The register of the organisation's own AI systems' risks: creating an entry used to answer 500 for everyone (`get_user_primary_tenant` gives an id, the router read `.id` off it)."""
    ai = importlib.import_module("grc.routers.ai_risk_assessment_router")
    app = FastAPI()
    app.include_router(ai.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    http = TestClient(app)
    made = http.post("/erm/ai-risk-assessment", json={"ai_system_use_case": "Fraud model", "risk_description": "Drift", "likelihood": 4, "impact": 5})
    assert made.status_code == 201, made.text
    body = made.json()
    assert (body["ai_system_use_case"], body["risk_score"], body["status"]) == ("Fraud model", 20, "Open")
    assert [r["id"] for r in http.get("/erm/ai-risk-assessment").json()] == [body["id"]]
