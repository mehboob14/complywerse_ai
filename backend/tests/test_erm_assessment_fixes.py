"""Risk Assessments fixes (2026-11-11): manual assessments, framework assessments and the AI-systems risk register.

- an approved or closed assessment is locked underneath too: per-risk edits, links and delete answer 409;
- the Excel upload skips a row whose title the register already holds instead of creating it again;
- the AI register's template download is reachable (GET /{entry_id} no longer shadows it), and creating an entry works;
- every write checks a permission: risks:risk_assessment:<action>, or the erm:risks:<action> a risk editor already holds;
- framework assessment status is one of the values the page offers; bands are the shared ones.
In-memory SQLite.
"""
import ast
import importlib
import io
import pathlib

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (AIRiskAssessmentEntry, Base, FrameworkRiskAssessment, FrameworkRiskQuestion, GRCUser, Permission, Risk,
                        RiskAssessment, RiskAssessmentRisk, Role, RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.routers import framework_risk_assessments as fw_routes
from grc.modules.erm.routers import risk_assessments as ra_routes
from grc.routers.auth_router import create_access_token, require_auth

ai_routes = importlib.import_module("grc.routers.ai_risk_assessment_router")

ADMIN, VIEWER, EDITOR = 1, 2, 3
BACKEND = pathlib.Path(__file__).resolve().parents[1] / "grc"
ROUTER_FILES = [BACKEND / "modules" / "erm" / "routers" / "risk_assessments.py",
                BACKEND / "modules" / "erm" / "routers" / "framework_risk_assessments.py",
                BACKEND / "routers" / "ai_risk_assessment_router.py"]
# POSTs that write nothing: they draft suggestions the person then saves through a gated route
READ_ONLY_POSTS = {"ai_suggest_assessment_risk", "ai_suggest_question_fields"}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Viewer"), Role(id=3, name="Risk editor")])
    s.add_all([GRCUser(id=ADMIN, username="admin", email="admin@bank.test", is_active=True),
               GRCUser(id=VIEWER, username="viewer", email="viewer@bank.test", is_active=True),
               GRCUser(id=EDITOR, username="editor", email="editor@bank.test", is_active=True)])
    for i, name in enumerate(["erm:risks:view", "risks:risk_assessment:view", "erm:risks:create"], start=1):
        resource, action = name.rsplit(":", 1)
        s.add(Permission(id=i, name=name, resource=resource, action=action))
    s.add_all([RolePermission(role_id=2, permission_id=1), RolePermission(role_id=2, permission_id=2),
               RolePermission(role_id=3, permission_id=1), RolePermission(role_id=3, permission_id=3)])
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=VIEWER, role_id=2, tenant_id=1),
               UserRole(user_id=EDITOR, role_id=3, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username="admin"):
    app = FastAPI()
    app.include_router(ra_routes.router)
    app.include_router(fw_routes.router)
    app.include_router(ai_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def assessment_with_a_risk(db, status):
    risk = Risk(tenant_id=1, title="Payments outage", category="operational")
    assessment = RiskAssessment(tenant_id=1, name="Q4 review", status=status)
    db.add_all([risk, assessment])
    db.flush()
    ar = RiskAssessmentRisk(assessment_id=assessment.id, risk_id=risk.id, inherent_likelihood=3, inherent_impact=3)
    db.add(ar)
    db.commit()
    return assessment.id, ar.id, risk.id


# ── an approved or closed assessment is locked underneath ────────────────────

@pytest.mark.parametrize("locked", ["approved", "closed"])
def test_a_signed_off_assessment_refuses_changes_to_its_risks(db, locked):
    aid, arid, rid = assessment_with_a_risk(db, locked)
    http = client(db)
    edit = http.put(f"/risk-assessments/{aid}/risks/{arid}", json={"residual_likelihood": 1, "residual_impact": 1})
    assert edit.status_code == 409 and locked in edit.json()["detail"]
    assert http.delete(f"/risk-assessments/{aid}/risks/{arid}").status_code == 409
    assert http.post(f"/risk-assessments/{aid}/risks/bulk", json={"risk_ids": [rid]}).status_code == 409
    assert http.post(f"/risk-assessments/{aid}/risks/{arid}/kris", json={"kri_id": 1}).status_code == 409
    assert http.delete(f"/risk-assessments/{aid}").status_code == 409
    db.expire_all()
    ar = db.get(RiskAssessmentRisk, arid)
    assert ar is not None and ar.residual_likelihood is None and db.get(RiskAssessment, aid) is not None


def test_an_open_assessment_still_takes_per_risk_edits(db):
    aid, arid, _ = assessment_with_a_risk(db, "in_progress")
    edit = client(db).put(f"/risk-assessments/{aid}/risks/{arid}", json={"residual_likelihood": 2, "residual_impact": 2})
    assert edit.status_code == 200 and edit.json()["residual_score"] == 4


# ── the Excel upload does not import a register risk twice ───────────────────

def workbook(*titles):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Risk Title", "Category", "Inherent Likelihood", "Inherent Impact"])
    for t in titles:
        ws.append([t, "Operational", 3, 4])
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_the_upload_skips_a_title_already_in_the_register(db):
    db.add(Risk(tenant_id=1, title="Payments Outage", category="operational"))
    db.commit()
    files = {"file": ("register.xlsx", workbook("payments outage ", "Vendor failure", "VENDOR FAILURE"),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    res = client(db).post("/risk-assessments/upload-excel", files=files)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["risks_created"] == 1 and body["rows_skipped"] == 2
    assert {d["reason"] for d in body["skipped_details"]} == {"Already in the risk register"}
    assert sorted(t for (t,) in db.query(Risk.title)) == ["Payments Outage", "Vendor failure"]


# ── the AI-systems register ──────────────────────────────────────────────────

def test_the_ai_template_download_is_not_swallowed_by_the_entry_route(db):
    http = client(db)
    res = http.get("/erm/ai-risk-assessment/template")
    assert res.status_code == 200 and res.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert http.get("/erm/ai-risk-assessment/999").status_code == 404           # the entry route still answers


def test_an_ai_entry_can_be_created_and_bridges_without_inventing_a_residual(db):
    http = client(db)
    made = http.post("/erm/ai-risk-assessment", json={"ai_system_use_case": "Credit scoring", "likelihood": 4, "impact": 3})
    assert made.status_code == 201, made.text
    assert made.json()["risk_score"] == 12 and made.json()["residual_risk_level"] == "High"
    bridged = http.post(f"/erm/ai-risk-assessment/{made.json()['id']}/bridge-to-risk")
    risk = db.get(Risk, bridged.json()["risk_id"])
    assert risk.inherent_score == 12 and (risk.residual_likelihood, risk.residual_impact, risk.residual_score) == (None, None, None)


def test_the_ai_residual_level_uses_the_shared_bands_and_unscored_has_none():
    assert [ai_routes._residual_from_score(s) for s in (None, 0, 5, 6, 11, 12, 20, 25)] == \
        [None, None, "Low", "Medium", "Medium", "High", "High", "High"]


# ── permissions ──────────────────────────────────────────────────────────────

def test_a_view_only_user_cannot_create_but_a_risk_editor_still_can(db):
    viewer = client(db, "viewer")
    assert viewer.post("/risk-assessments", json={"name": "Mine"}).status_code == 403
    assert viewer.post("/framework-risk-assessments", json={"uploaded_framework_id": 1}).status_code == 403
    assert viewer.post("/erm/ai-risk-assessment", json={"ai_system_use_case": "Chatbot"}).status_code == 403
    assert db.query(RiskAssessment).count() == 0 and db.query(AIRiskAssessmentEntry).count() == 0
    assert viewer.get("/risk-assessments").status_code == 200
    assert client(db, "editor").post("/risk-assessments", json={"name": "Mine"}).status_code == 201     # erm:risks:create


def _writes(path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) \
                        and dec.func.attr in {"post", "put", "patch", "delete"}:
                    yield node.name, dec


# writes the question's assignee may make with view access: they check _may_answer in the body instead of a route dependency
ANSWERED_BY_ASSIGNEE = {"update_framework_question", "upload_question_evidence"}


def _calls(node, fn):
    return any(isinstance(n, ast.Call) and getattr(n.func, "id", None) == fn for n in ast.walk(node))


def test_every_assessment_write_checks_a_permission():
    seen, unguarded = 0, []
    for path in ROUTER_FILES:
        tree = ast.parse(path.read_text(encoding="utf-8"))
        bodies = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
        for name, dec in _writes(path):
            seen += 1
            if name in READ_ONLY_POSTS or "dependencies" in {kw.arg for kw in dec.keywords}:
                continue
            if name in ANSWERED_BY_ASSIGNEE and _calls(bodies[name], "_may_answer"):
                continue
            unguarded.append(f"{path.name}:{name}")
    assert seen >= 30 and unguarded == [], unguarded


def test_the_assigned_person_answers_their_question_with_view_access_but_cannot_reassign_it(db):
    db.add(FrameworkRiskAssessment(id=6, tenant_id=1, name="SAMA CSF", created_by=ADMIN))
    db.add_all([FrameworkRiskQuestion(id=61, assessment_id=6, question_text="Is MFA enforced?", assigned_user_id=VIEWER,
                                      created_by=ADMIN),
                FrameworkRiskQuestion(id=62, assessment_id=6, question_text="Are backups tested?", created_by=ADMIN)])
    db.commit()
    viewer = client(db, "viewer")
    mine = viewer.put("/framework-risk-assessments/6/questions/61", json={"inherent_likelihood": 4, "inherent_impact": 3})
    assert mine.status_code == 200, mine.text
    assert viewer.put("/framework-risk-assessments/6/questions/61", json={"assigned_user_id": EDITOR}).status_code == 403
    assert viewer.put("/framework-risk-assessments/6/questions/61", json={"is_risk_accepted": True}).status_code == 403
    assert viewer.put("/framework-risk-assessments/6/questions/62", json={"inherent_likelihood": 2}).status_code == 403
    db.expire_all()
    assert (db.get(FrameworkRiskQuestion, 61).assigned_user_id, db.get(FrameworkRiskQuestion, 62).inherent_likelihood) == (VIEWER, None)


# ── framework assessments and bands ──────────────────────────────────────────

def test_a_framework_assessment_status_is_one_the_page_offers(db):
    db.add(FrameworkRiskAssessment(id=5, tenant_id=1, name="ISO", created_by=ADMIN))
    db.commit()
    http = client(db)
    assert http.put("/framework-risk-assessments/5", json={"status": "done-ish"}).status_code == 400
    assert http.put("/framework-risk-assessments/5", json={"status": "completed"}).json()["status"] == "completed"


def test_the_breakdown_bands_on_the_shared_cut_offs_and_leaves_unscored_out(db):
    aid, arid, _ = assessment_with_a_risk(db, "in_progress")          # inherent 9: medium
    for score in (None, 12, 20):
        r = Risk(tenant_id=1, title=f"r{score}", category="operational")
        db.add(r)
        db.flush()
        db.add(RiskAssessmentRisk(assessment_id=aid, risk_id=r.id, inherent_score=score))
    db.query(RiskAssessmentRisk).filter_by(id=arid).update({"inherent_score": 9})
    db.commit()
    bands = client(db).get(f"/risk-assessments/{aid}/risk-breakdown").json()["by_score_range"]
    assert bands == {"critical": 1, "high": 1, "medium": 1, "low": 0}
    assert ra_routes._fallback_suggestion({"title": "x", "residual_score": 20}, [], [], [])["treatment_decision"] == "avoid"
    assert ra_routes._fallback_suggestion({"title": "x", "residual_score": 12}, [], [], [])["treatment_decision"] == "mitigate"
