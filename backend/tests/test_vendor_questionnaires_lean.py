"""The Questionnaires > Sent list and the pickers (UX revamp, vendor-questionnaires, 2026-11-10).

GET /vendor-risk/questionnaire-responses?lean=1 is the Sent list: one row per questionnaire with the supplier, questionnaire and assessment
named by the server, how much is answered out of the questions it was SENT on, and NO answers, comments or token (those are read one at a
time, GET /vendor-risk/questionnaire-responses/{id}). Without `lean` the bare list is exactly what it was. GET /vendor-risk/vendor-options is
the light supplier list behind the pickers (every supplier in use, not the first hundred). In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Role, TPRATemplateVersion, Tenant, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import portal
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()
BASE = "/vendor-risk"
QUESTIONS = [{"id": f"q{i}", "text": f"Question {i}", "type": "yes_no"} for i in range(1, 5)]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Acme Bank", slug="acme"), Tenant(id=2, name="Other", slug="other")])
    s.add(Role(id=1, name="Administrator"))
    s.add(GRCUser(id=1, username="admin", display_name="Admin", email="a@acme.test", is_active=True))
    s.add(UserRole(user_id=1, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(routes.router, prefix=BASE)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 1)
    return TestClient(app)


def _vendor(db, name, tenant=1, **kw):
    v = Vendor(**{"tenant_id": tenant, "name": name, "tier": "medium", "status": "active", **kw})
    db.add(v)
    db.commit()
    return v


def _template(db, name="Security basics", questions=QUESTIONS, tenant=1):
    t = VendorQuestionnaireTemplate(tenant_id=tenant, name=name, category="security", questions=questions)
    db.add(t)
    db.commit()
    return t


def _sent(db, vendor, template=None, version=None, assessment=None, tenant=1, **kw):
    qr = VendorQuestionnaireResponse(
        tenant_id=tenant, vendor_id=vendor.id, template_id=template.id if template else None,
        template_version_id=version.id if version else None, assessment_id=assessment.id if assessment else None,
        token=kw.pop("token", portal.sealed_token()), status=kw.pop("status", "pending"), due_date=NOW + timedelta(days=14),
        created_at=kw.pop("created_at", NOW), **kw)
    db.add(qr)
    db.commit()
    return qr


@pytest.fixture()
def world(db):
    alpha, bravo = _vendor(db, "Alpha Pay"), _vendor(db, "Bravo Cloud")
    archived = _vendor(db, "Gone Ltd", deleted_at=NOW)
    t = _template(db)
    # sent when the template had 4 questions; edited since to 2: the denominator is the version it was sent on
    version = TPRATemplateVersion(tenant_id=1, template_id=t.id, version_no=3, name=t.name, questions=QUESTIONS, content_hash="x")
    db.add(version)
    db.commit()
    t.questions = QUESTIONS[:2]
    db.commit()
    a = VendorAssessment(tenant_id=1, vendor_id=alpha.id, assessment_type="annual", status="in_progress")
    db.add(a)
    db.commit()
    first = _sent(db, alpha, t, version, a, status="in_progress", responses={"q1": "yes", "q2": "no"}, created_at=NOW - timedelta(days=2))
    legacy = _sent(db, bravo, t, None, None, token="rawtoken123", responses={"q1": "yes"}, created_at=NOW - timedelta(days=1))
    done = _sent(db, archived, None, None, None, status="accepted", token="rawtoken456", created_at=NOW)
    return {"alpha": alpha, "bravo": bravo, "t": t, "version": version, "a": a, "first": first, "legacy": legacy, "done": done}


def test_lean_rows_name_everything_and_carry_no_answers_or_token(http, world):
    body = http.get(f"{BASE}/questionnaire-responses", params={"lean": 1}).json()
    assert body["total"] == 3 and body["skip"] == 0
    assert [r["id"] for r in body["items"]] == [world["done"].id, world["legacy"].id, world["first"].id], "newest first"
    for row in body["items"]:
        assert not {"responses", "comments", "token", "review", "attested_by"} & set(row), row
    first = next(r for r in body["items"] if r["id"] == world["first"].id)
    assert first["vendor_name"] == "Alpha Pay" and first["template_name"] == "Security basics"
    assert first["assessment_type"] == "annual" and first["assessment_status"] == "in_progress"
    assert first["template_version_no"] == 3
    assert (first["answered"], first["question_count"]) == (2, 4), "out of the questions it was SENT on, not the template as it is now"
    assert first["own_link"] is False, "a personal-link questionnaire has no link of its own"


def test_lean_row_without_a_version_counts_the_templates_questions_and_a_legacy_link_is_flagged(http, world):
    rows = {r["id"]: r for r in http.get(f"{BASE}/questionnaire-responses", params={"lean": 1}).json()["items"]}
    legacy = rows[world["legacy"].id]
    assert (legacy["answered"], legacy["question_count"], legacy["template_version_no"]) == (1, 2, None)
    assert legacy["own_link"] is True
    done = rows[world["done"].id]
    assert done["own_link"] is False, "an accepted questionnaire's link is closed"
    assert done["vendor_archived"] is True and done["template_name"] is None and done["question_count"] == 0


def test_lean_pages_and_filters_keep_their_meaning(http, world):
    page = http.get(f"{BASE}/questionnaire-responses", params={"lean": 1, "limit": 1, "skip": 1}).json()
    assert page["total"] == 3 and [r["id"] for r in page["items"]] == [world["legacy"].id]
    one = http.get(f"{BASE}/questionnaire-responses", params={"lean": 1, "vendor_id": world["alpha"].id}).json()
    assert [r["id"] for r in one["items"]] == [world["first"].id]
    assert http.get(f"{BASE}/questionnaire-responses", params={"lean": 1, "limit": 5001}).status_code == 422


def test_without_lean_the_list_is_exactly_what_it_was(http, world):
    body = http.get(f"{BASE}/questionnaire-responses").json()
    assert isinstance(body, list) and len(body) == 3
    legacy = next(r for r in body if r["id"] == world["legacy"].id)
    assert legacy["responses"] == {"q1": "yes"} and legacy["token"] == "rawtoken123"


def test_one_response_has_its_answers_and_the_questions_it_was_sent_on(http, world):
    got = http.get(f"{BASE}/questionnaire-responses/{world['first'].id}").json()
    assert got["responses"] == {"q1": "yes", "q2": "no"}
    assert [q["id"] for q in got["questions"]] == ["q1", "q2", "q3", "q4"], "the version it was sent on"
    assert (got["vendor_name"], got["template_name"], got["template_version_no"]) == ("Alpha Pay", "Security basics", 3)
    legacy = http.get(f"{BASE}/questionnaire-responses/{world['legacy'].id}").json()
    assert [q["id"] for q in legacy["questions"]] == ["q1", "q2"], "no version: the template as it is"
    assert legacy["token"] == "rawtoken123", "the same data the list always carried, one at a time"


def test_one_response_of_another_organisation_is_not_found(http, db):
    other = _vendor(db, "Elsewhere", tenant=2)
    qr = _sent(db, other, None, tenant=2)
    assert http.get(f"{BASE}/questionnaire-responses/{qr.id}").status_code == 404
    assert http.get(f"{BASE}/questionnaire-responses/99999").status_code == 404
    assert http.get(f"{BASE}/questionnaire-responses", params={"lean": 1}).json()["total"] == 0


def test_vendor_options_lists_every_supplier_in_use_by_name(http, db):
    for i in range(130):
        _vendor(db, f"Supplier {i:03d}")
    _vendor(db, "Archived Co", deleted_at=NOW)
    _vendor(db, "Draft Co", intake_status="draft", status="requested")
    _vendor(db, "In review Co", intake_status="in_review")
    _vendor(db, "Elsewhere", tenant=2)
    body = http.get(f"{BASE}/vendor-options").json()
    names = [v["name"] for v in body["items"]]
    assert body["total"] == 131 and len(names) == 131, "past the first hundred"
    assert names == sorted(names, key=str.lower)
    assert "Archived Co" not in names and "Draft Co" not in names and "Elsewhere" not in names
    assert "In review Co" in names


def test_vendor_options_search_assessment_and_paging(http, db):
    v = _vendor(db, "Zeta Systems", inherent_risk_score=55.0, tier="high", primary_contact_email="z@zeta.test", primary_contact_name="Zed")
    with_a = VendorAssessment(tenant_id=1, vendor_id=v.id, assessment_type="initial", status="in_progress")
    db.add(with_a)
    db.commit()
    v.active_assessment_id = with_a.id
    _vendor(db, "Zulu Cloud")
    db.commit()
    found = http.get(f"{BASE}/vendor-options", params={"search": "zet"}).json()
    assert [x["name"] for x in found["items"]] == ["Zeta Systems"]
    row = found["items"][0]
    assert (row["tier"], row["primary_contact_email"], row["active_assessment_id"]) == ("high", "z@zeta.test", with_a.id)
    only = http.get(f"{BASE}/vendor-options", params={"with_assessment": 1}).json()
    assert [x["name"] for x in only["items"]] == ["Zeta Systems"]
    untiered = http.get(f"{BASE}/vendor-options", params={"search": "zulu"}).json()["items"][0]
    assert untiered["tier"] is None, "a tier counts once someone has tiered the supplier"
    page = http.get(f"{BASE}/vendor-options", params={"limit": 1, "skip": 1}).json()
    assert page["total"] == 2 and [x["name"] for x in page["items"]] == ["Zulu Cloud"]
    assert http.get(f"{BASE}/vendor-options", params={"limit": 5001}).status_code == 422
