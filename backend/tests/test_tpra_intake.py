"""Onboarding requests: the requester's answers are the facts tiering uses.

A request is raised, answered (saved as you go), submitted, picked up by the TPRM
team and then decided by the lifecycle's approval. A yes to an exposure question
needs a reason. The answers set the five tiering factors, land on the vendor
record, and a later answer that raises the risk is a reason to re-tier.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, Vendor, VendorAssessment, get_db
from grc.modules.vendor_risk.tpra import attention, intake, onboarding, rbac, tier_policy
from grc.routers.auth_router import require_auth

FULL = {
    "engagement_type": "saas", "purpose": "Payroll for all staff", "users_count": 1200, "nda_signed": "yes",
    "personal_data": "yes", "personal_records": 5000, "special_category": "yes", "confidential_data": "no",
    "financial_reporting": "yes", "cross_border": "yes", "hosts_data": "yes", "network_access": "no",
    "source_code": "no", "uses_ai": "no", "sso": "yes", "critical_function": "yes",
    "impact_disclosure": "high", "impact_alteration": "moderate", "impact_outage": "severe",
}
WHY = {k: "Needed to run payroll for every employee" for k in
       ("personal_data", "special_category", "financial_reporting", "cross_border", "hosts_data", "critical_function")}


# ── the rules, without a database ────────────────────────────────────────────

def test_answers_set_the_five_factors_with_reasons():
    scores, why = intake.factors({"answers": FULL})
    assert scores == {"data_sensitivity": 4.0, "business_criticality": 4.0, "system_access": 3.0,
                      "regulatory_scope": 4.0, "fourth_party": 2.0}
    assert "includes sensitive personal data" in why["data_sensitivity"]
    assert "a critical service depends on them" in why["business_criticality"]
    assert intake.factors({"answers": {}})[0] == dict.fromkeys(scores, 0.0)


def test_answers_are_checked_and_unknown_questions_refused():
    cleaned = intake.clean({"personal_data": True, "impact_outage": "HIGH", "users_count": "40"}, {})
    assert cleaned["answers"] == {"personal_data": "yes", "impact_outage": "high", "users_count": 40}
    with pytest.raises(ValueError, match="not an intake question"):
        intake.clean({"favourite_colour": "blue"}, {})
    with pytest.raises(ValueError, match="must be one of"):
        intake.clean({"impact_outage": "catastrophic"}, {})
    with pytest.raises(ValueError, match="does not take a reason"):
        intake.clean({}, {"purpose": "because"})


def test_a_yes_needs_a_reason_and_follow_ups_are_asked_only_after_a_yes():
    base = {k: v for k, v in FULL.items()}
    missing = [p["key"] for p in intake.problems({"answers": base, "justifications": {}})]
    assert set(missing) == set(WHY)
    base.update(personal_data="no", special_category=None)
    left = [p["key"] for p in intake.problems({"answers": base, "justifications": WHY})]
    assert left == []            # special_category is not asked once personal data is no


def test_the_answers_land_on_the_vendor_and_access_only_goes_up():
    v = Vendor(name="Payroll Co", data_access_level="internal", data_types_accessed=["email"])
    intake.apply_to_vendor(v, {"answers": FULL})
    assert v.data_access_level == "restricted"
    assert {"email", "personal data", "sensitive personal data", "financial reporting data"} <= set(v.data_types_accessed)
    assert v.vendor_type == "Software as a service" and v.description == "Payroll for all staff"
    intake.apply_to_vendor(v, {"answers": {"personal_data": "no"}})
    assert v.data_access_level == "restricted"          # a lower answer is for a reviewer to accept


def test_an_answer_that_raises_the_risk_is_a_reason_to_re_tier():
    v = Vendor(name="Payroll Co", data_access_level="internal", intake={"answers": {**FULL, "network_access": "no"}})
    recorded = tier_policy.basis(v)
    v.intake = {"answers": {**FULL, "network_access": "yes", "impact_outage": "severe", "impact_disclosure": "severe"}}
    reasons = intake.changes_since(recorded["intake"], v)
    assert "now yes: will they connect to our network or internal systems" in reasons
    assert any(r.startswith("harm if our data held by them were exposed went from high to severe") for r in reasons)


# ── over HTTP ────────────────────────────────────────────────────────────────

@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="analyst@acme.test", display_name="Tara Analyst", is_active=True))
    s.add(GRCUser(id=8, username="requester", email="req@acme.test", display_name="Rob Requester", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def as_user(db, monkeypatch):
    """A client acting as a user; user 8 may only raise requests, user 7 is the TPRM team."""
    who = {"id": 7}

    def require_write(_db, user, resource, action="edit", allow_fallback=True):
        if user.id == 8 and (resource, action) != ("intake", "create"):
            raise HTTPException(403, "Permission denied")

    monkeypatch.setattr(rbac, "require_write", require_write)
    app = FastAPI()
    app.include_router(onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, who["id"])
    client = TestClient(app)

    def use(user_id):
        who["id"] = user_id
        return client
    return use


def test_a_request_goes_from_draft_to_review_and_is_tiered_from_its_answers(db, as_user):
    requester = as_user(8)
    made = requester.post("/intake/requests", json={"name": "Payroll Co", "website": "https://www.payroll.example/"})
    assert made.status_code == 201, made.text
    vid = made.json()["id"]
    assert requester.post("/intake/requests", json={"name": "Other", "website": "payroll.example"}).status_code == 409

    saved = requester.put(f"/vendors/{vid}/intake", json={"answers": {"engagement_type": "saas", "personal_data": "yes"}})
    assert saved.status_code == 200 and saved.json()["intake_status"] == "draft"
    early = requester.post(f"/vendors/{vid}/intake/submit")
    assert early.status_code == 400 and early.json()["detail"]["problems"]

    done = requester.put(f"/vendors/{vid}/intake", json={"answers": FULL, "justifications": WHY,
                                                          "vendor": {"stakeholder_ids": [7], "notify_emails": "a@acme.test; a@acme.test"}})
    assert done.json()["vendor"]["notify_emails"] == "a@acme.test"
    assert done.json()["preview"]["tier"] == "critical"
    assert requester.post(f"/vendors/{vid}/intake/submit").json()["intake_status"] == "submitted"
    # the requester can no longer change it, and cannot pick it up
    assert requester.put(f"/vendors/{vid}/intake", json={"answers": {"users_count": 1}}).status_code == 403
    assert requester.post(f"/vendors/{vid}/intake/review").status_code == 403

    queue = attention.open_items(db, 1, datetime.utcnow().date(), {})
    assert [i["condition"] for i in queue if i["vendor_id"] == vid] == ["request_to_review"]

    team = as_user(7)
    listed = team.get("/intake/requests", params={"status": "submitted"}).json()
    assert [r["id"] for r in listed["items"]] == [vid] and listed["counts"]["submitted"] == 1
    reviewed = team.post(f"/vendors/{vid}/intake/review")
    assert reviewed.status_code == 200, reviewed.text
    body = reviewed.json()
    assert body["intake_status"] == "in_review" and body["tiering"]["tier"] == "critical"
    vendor = db.get(Vendor, vid)
    assert (vendor.status, vendor.tier, vendor.data_access_level) == ("onboarding", "critical", "restricted")
    assert db.query(VendorAssessment).filter_by(vendor_id=vid).count() == 1
    trail = [(r.from_value, r.to_value) for r in db.query(TPRAAuditLog).filter_by(vendor_id=vid, entity="request")]
    assert (None, "draft") in trail and ("draft", "submitted") in trail and ("submitted", "in_review") in trail


def test_a_request_can_be_sent_back_or_turned_down_with_a_reason(db, as_user):
    requester = as_user(8)
    vid = requester.post("/intake/requests", json={"name": "Maybe Ltd"}).json()["id"]
    requester.put(f"/vendors/{vid}/intake", json={"answers": FULL, "justifications": WHY})
    requester.post(f"/vendors/{vid}/intake/submit")
    team = as_user(7)
    assert team.post(f"/vendors/{vid}/intake/return", json={"reason": "short"}).status_code == 422
    back = team.post(f"/vendors/{vid}/intake/return", json={"reason": "Tell us which team will own it"})
    assert back.json()["intake_status"] == "draft"
    as_user(8).post(f"/vendors/{vid}/intake/submit")
    turned = as_user(7).post(f"/vendors/{vid}/intake/reject", json={"reason": "We already have a payroll supplier"})
    assert turned.json()["intake_status"] == "rejected" and db.get(Vendor, vid).status == "rejected"
    assert as_user(7).post(f"/vendors/{vid}/intake/review").status_code == 400


def test_procurement_sees_what_it_is_waiting_on(db, as_user):
    requester = as_user(8)
    vid = requester.post("/intake/requests", json={"name": "Waiting Co"}).json()["id"]
    requester.put(f"/vendors/{vid}/intake", json={"answers": FULL, "justifications": WHY})
    requester.post(f"/vendors/{vid}/intake/submit")
    db.get(Vendor, vid).submitted_at = datetime.utcnow() - timedelta(days=5)
    db.commit()
    items = as_user(7).get("/intake/procurement").json()["items"]
    assert items[0]["name"] == "Waiting Co" and items[0]["days_waiting"] == 5
    assert items[0]["stage"]["label"] == "Waiting for review"
    assert items[0]["last_update"]["what"] == "request status → submitted"


def test_import_shows_what_it_would_do_then_applies_all_or_nothing(db, as_user):
    db.add(Vendor(tenant_id=1, name="Known Ltd", website="https://known.example", status="active", tier="low"))
    db.commit()
    team = as_user(7)
    good = ("name,website,owner_email,contract_value,data_access_level,data_types,tier\n"
            "New Co,new.example,analyst@acme.test,\"12,000\",confidential,personal data;invoices,high\n"
            ",known.example,,,internal,,\n")
    plan = team.post("/vendors/import", files={"file": ("v.csv", good, "text/csv")}).json()
    assert plan["dry_run"] and plan["summary"] == {"create": 1, "update": 1, "error": 0}
    assert plan["rows"][1]["changes"] == ["data_access_level"]   # the same site written without https:// is no change
    bad = good + "Broken,broken.example,nobody@acme.test,,secret,,\n"
    refused = team.post("/vendors/import", params={"dry_run": "false"}, files={"file": ("v.csv", bad, "text/csv")})
    assert refused.status_code == 400 and db.query(Vendor).count() == 1
    applied = team.post("/vendors/import", params={"dry_run": "false"}, files={"file": ("v.csv", good, "text/csv")})
    assert applied.status_code == 200, applied.text
    new = db.query(Vendor).filter_by(name="New Co").one()
    assert (new.owner_id, new.contract_value, new.tier, new.data_types_accessed) == (7, 12000.0, "high",
                                                                                     ["personal data", "invoices"])
    assert db.query(Vendor).filter_by(name="Known Ltd").one().data_access_level == "internal"
    assert as_user(8).post("/vendors/import", files={"file": ("v.csv", good, "text/csv")}).status_code == 403
