"""The Risk Register's complete load (GET /erm/risks?lean=1) and the fields the detail endpoints gained.

The old call is frozen here (a bare array, 100 newest by default, the RiskResponse keys); the lean call returns EVERY risk with the
true total, a compact row, and no query per row. In-memory SQLite, over HTTP through the module's risks router."""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, Risk, RiskFrameworkRequirementLink, RiskMitigationAction, Tenant, UploadedFramework, get_db)
from grc.routers.auth_router import require_auth
from grc.schemas import RiskResponse

risks = importlib.import_module("grc.modules.erm.routers.risks")
old_risks = importlib.import_module("grc.routers.risks_router")

LEAN_KEYS = {
    "id", "tenant_id", "title", "description_preview", "category", "risk_category", "risk_sub_category", "register_type", "source_type", "status",
    "priority", "effective_priority", "closure_status", "is_material", "inherent_likelihood", "inherent_impact", "inherent_score",
    "residual_likelihood", "residual_impact", "residual_score", "owner_id", "owner_name", "business_owner_id", "business_owner_name",
    "business_unit_id", "business_unit_name", "due_date", "review_date", "has_plan", "sla", "framework_ids", "in_assessment", "actions_total", "actions_open",
    "created_at", "updated_at",
}
NEW_DETAIL_KEYS = {"priority", "effective_priority", "sla", "root_cause", "consequences", "recommendations", "business_owner_id", "business_owner_name",
                   "business_unit_id", "business_unit_name", "custom_values", "template_fields", "source_type", "source_label", "closure_status",
                   "actions_total", "actions_open"}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Tenant(id=2, name="Other", slug="other"))
    s.add_all([GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=8, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True)])
    s.add(BusinessUnit(id=3, tenant_id=1, name="Payments"))
    s.add(UploadedFramework(id=5, tenant_id=1, name="ISO 27001", file_name="f", file_path="f", file_type="json", uploaded_by=7))
    s.commit()
    yield s
    s.close()


def client(db, router):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


@pytest.fixture()
def http(db):
    return client(db, risks.router)


def bulk(db, n, tenant_id=1):
    """n risks in one INSERT, the newest first by id order of creation."""
    start = datetime(2026, 1, 1)
    db.execute(insert(Risk), [dict(tenant_id=tenant_id, title=f"Risk {i}", category="operational", risk_category="technology" if i % 3 else None, status="open",
                                   owner_id=8 if i % 2 else None, inherent_score=float(i % 25 + 1), residual_score=float(i % 12 + 1) if i % 4 else None,
                                   created_at=start + timedelta(minutes=i), updated_at=start + timedelta(minutes=i)) for i in range(n)])
    db.commit()


def test_the_old_call_is_what_it_was(db, http):
    bulk(db, 130)
    old = http.get("/risks")
    assert old.status_code == 200 and isinstance(old.json(), list) and len(old.json()) == 100             # the default cap, as before
    assert set(old.json()[0]) == set(RiskResponse.model_fields)                                           # the same keys
    assert old.json()[0]["title"] == "Risk 129"                                                           # newest first
    assert len(http.get("/risks?limit=500").json()) == 130 and len(http.get("/risks?skip=100&limit=100").json()) == 30


def test_lean_holds_every_risk_with_the_true_total(db, http):
    bulk(db, 2000)
    bulk(db, 5, tenant_id=2)                                                  # another organisation's risks are not in it
    got = http.get("/risks?lean=1&limit=10000").json()
    assert got["lean"] is True and got["total"] == 2000 and len(got["items"]) == 2000 and got["truncated"] is False
    assert {r["id"] for r in got["items"]} == {r.id for r in db.query(Risk).filter_by(tenant_id=1)}
    first = got["items"][0]
    assert set(first) == LEAN_KEYS and first["title"] == "Risk 1999"           # newest first, full title
    assert "root_cause" not in first and "treatment_plan" not in first and "description" not in first
    cut = http.get("/risks?lean=1&limit=500&skip=1800").json()                 # a page says it is not the end
    assert (cut["total"], len(cut["items"]), cut["truncated"]) == (2000, 200, False)
    page = http.get("/risks?lean=1&limit=500").json()
    assert (page["total"], len(page["items"]), page["truncated"]) == (2000, 500, True)
    assert http.get("/risks?lean=1&limit=999999").json()["limit"] == 10000    # a larger limit is clamped
    assert http.get("/risks?lean=1&skip=-5&limit=-1").json()["items"] == []   # a negative page is no request


def test_lean_respects_the_filters_and_counts_them(db, http):
    bulk(db, 60)
    assert http.get("/risks?lean=1&category=technology").json()["total"] == 40       # stored risk_category (the list's own rule)
    assert http.get("/risks?lean=1&status_filter=closed").json() == {"items": [], "total": 0, "skip": 0, "limit": 100, "truncated": False, "lean": True, "frameworks": {}}


def test_a_lean_row_carries_names_counts_and_the_sla(db, http):
    now = datetime.utcnow()
    db.add(Risk(id=500, tenant_id=1, title="A" * 300, description="D" * 1000, category="operational", priority="high", owner_id=8, business_owner_id=7,
                business_unit_id=3, status="open", inherent_score=16, residual_score=12, treatment_plan="Do the thing", created_at=now - timedelta(days=400)))
    db.add(Risk(id=501, tenant_id=1, title="Bare", category="operational", created_at=now))
    db.commit()
    db.add(RiskMitigationAction(risk_id=500, title="Patch", status="open"))
    db.add(RiskMitigationAction(risk_id=500, title="Review", status="completed"))
    db.add(RiskMitigationAction(risk_id=500, title="Late", status="overdue"))
    db.execute(insert(RiskFrameworkRequirementLink), [dict(risk_id=500, uploaded_framework_id=5, parsed_control_id=i, control_code=f"C{i}") for i in (1, 2)])
    db.commit()
    rows = {r["id"]: r for r in http.get("/risks?lean=1").json()["items"]}
    a, bare = rows[500], rows[501]
    assert len(a["title"]) == 300 and len(a["description_preview"]) == 240
    assert (a["owner_name"], a["business_owner_name"], a["business_unit_name"]) == ("Olu Owner", "Officer", "Payments")
    assert (a["actions_total"], a["actions_open"], a["has_plan"]) == (3, 2, True)
    assert a["framework_ids"] == [5] and a["effective_priority"] == "high" and a["sla"]["state"] == "breached"
    assert (bare["owner_name"], bare["business_owner_name"], bare["has_plan"], bare["framework_ids"], bare["actions_total"]) == (None, None, False, [], 0)
    assert bare["effective_priority"] is None
    assert http.get("/risks?lean=1").json()["frameworks"] == {"5": {"name": "ISO 27001"}}


def test_lean_runs_the_same_number_of_statements_for_ten_or_two_hundred_risks(db, http):
    counted = []
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", lambda *a, **k: counted.append(1))

    def statements(n_extra):
        bulk(db, n_extra)
        for rid in [r.id for r in db.query(Risk).order_by(Risk.id.desc()).limit(n_extra)]:
            db.add(RiskMitigationAction(risk_id=rid, title="x", status="open"))
        db.commit()
        counted.clear()
        assert http.get("/risks?lean=1").status_code == 200
        return len(counted)

    few = statements(10)
    many = statements(200)
    assert few == many, (few, many)


@pytest.mark.parametrize("router", [risks.router, old_risks.router])
def test_both_detail_endpoints_keep_their_keys_and_gain_the_record(db, router):
    db.add(Risk(id=500, tenant_id=1, title="Card fraud", category="operational", register_type="NCA", risk_sub_category="Payments", priority="high",
                owner_id=8, business_owner_id=7, business_unit_id=3, root_cause="Weak limits", consequences="Loss", recommendations="Cap it",
                custom_values={"k": 1}, template_fields={"risk_cause": "x"}, source_type="manual", status="open", inherent_score=16, residual_score=12))
    db.commit()
    old = client(db, router)
    got = old.get("/risks/500/detail")
    assert got.status_code == 200, got.text
    body = got.json()
    for key in ("id", "title", "owner_id", "owner_name", "status", "inherent_score", "residual_score", "treatment_plan", "linked_controls",
                "linked_internal_controls", "linked_framework_controls", "linked_framework_requirements", "linked_assets", "linked_evidence",
                "linked_governance", "due_date", "review_date", "created_at", "updated_at"):
        assert key in body, key
    assert NEW_DETAIL_KEYS <= set(body)
    assert (body["root_cause"], body["business_owner_name"], body["business_unit_name"], body["register_type"], body["template_fields"]) == (
        "Weak limits", "Officer", "Payments", "NCA", {"risk_cause": "x"})
    assert body["priority"] == "high" and body["sla"]["state"] in ("on_track", "due_soon", "breached") and body["owner_name"] == "Olu Owner"
