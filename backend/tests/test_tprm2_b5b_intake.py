"""TPRM parity, piece B5b (2026-10-29): the Intake page's rules (R7).

A request carries a department and an urgency beside its answers. A request for something already on
record is not refused: it is filed, the answer lists what it may be, and the review team sees the same
list (name or website, archived suppliers and other requests included). Picking a request up starts the
supplier's lifecycle as it always did, and makes the first engagement when the request names one. A
request is decided once. In-memory SQLite.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, TPRAEngagement, Vendor, VendorAssessment, get_db
from grc.modules.vendor_risk.tpra import intake, onboarding, rbac
from grc.routers.auth_router import require_auth

REQUESTER, TEAM, OTHER = 8, 7, 9
ANSWERS = {
    "engagement_type": "saas", "purpose": "Payroll for all staff", "users_count": 1200, "nda_signed": "yes",
    "personal_data": "yes", "personal_records": 5000, "special_category": "yes", "confidential_data": "no",
    "financial_reporting": "yes", "cross_border": "yes", "hosts_data": "yes", "network_access": "no",
    "source_code": "no", "uses_ai": "no", "sso": "yes", "critical_function": "yes",
    "impact_disclosure": "high", "impact_alteration": "moderate", "impact_outage": "severe",
}
WHY = {k: "Needed to run payroll for every employee" for k in
       ("personal_data", "special_category", "financial_reporting", "cross_border", "hosts_data", "critical_function")}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=TEAM, username="analyst", email="analyst@acme.test", display_name="Tara Analyst", is_active=True),
               GRCUser(id=REQUESTER, username="requester", email="req@acme.test", display_name="Rob Requester", is_active=True),
               GRCUser(id=OTHER, username="other", email="other@acme.test", display_name="Olu Other", is_active=True)])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def as_user(db, monkeypatch):
    """A client acting as a user; the requesters (8, 9) may only raise requests, 7 is the TPRM team."""
    who = {"id": TEAM}

    def require_write(_db, user, resource, action="edit", allow_fallback=True):
        if user.id in (REQUESTER, OTHER) and (resource, action) != ("intake", "create"):
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


def _submitted(as_user, name, **extra):
    """A request raised, fully answered and submitted by the requester; its id."""
    requester = as_user(REQUESTER)
    vid = requester.post("/intake/requests", json={"name": name, **extra}).json()["id"]
    requester.put(f"/vendors/{vid}/intake", json={"answers": ANSWERS, "justifications": WHY})
    assert requester.post(f"/vendors/{vid}/intake/submit").status_code == 200
    return vid


# ── a duplicate is flagged, not refused ──────────────────────────────────────

def test_a_request_for_something_on_record_is_filed_and_lists_what_it_may_be(db, as_user):
    db.add_all([Vendor(id=50, tenant_id=1, name="Payroll Co", website="https://www.payroll.example/", status="active",
                       tier="high"),
                Vendor(id=51, tenant_id=1, name="Gone Ltd", website="gone.example", status="offboarded",
                       deleted_at=datetime.utcnow())])
    db.commit()
    requester = as_user(REQUESTER)

    made = requester.post("/intake/requests", json={"name": "PAYROLL CO., Inc", "website": "other.example"})
    assert made.status_code == 201, made.text
    body = made.json()
    assert [(d["id"], d["match"]) for d in body["duplicates"]] == [(50, "name")]
    assert "name matches" in body["duplicates"][0]["reason"] and body["duplicates"][0]["archived"] is False
    assert db.get(Vendor, body["id"]).intake_status == "draft"                 # filed all the same

    site = requester.post("/intake/requests", json={"name": "Payroll Systems", "website": "payroll.example"}).json()
    assert [(d["id"], d["match"]) for d in site["duplicates"]][:1] == [(50, "website")]
    both = requester.post("/intake/requests", json={"name": "Payroll Company", "website": "payroll.example"}).json()
    assert [(d["id"], d["match"]) for d in both["duplicates"]][0] == (50, "both")
    assert both["id"] not in [d["id"] for d in both["duplicates"]]             # never itself

    archived = requester.post("/intake/requests", json={"name": "Brand New", "website": "https://gone.example"}).json()
    assert [(d["id"], d["archived"], d["match"]) for d in archived["duplicates"]] == [(51, True, "website")]

    fresh = requester.post("/intake/requests", json={"name": "Nobody Heard Of Them"}).json()
    assert fresh["duplicates"] == []


def test_the_direct_add_path_keeps_its_own_refusal(db):
    """The register's Add vendor still asks first: it uses the single-match check, which this piece did not change."""
    db.add(Vendor(id=50, tenant_id=1, name="Payroll Co", website="payroll.example", status="active"))
    db.commit()
    hit = intake.duplicate(db, 1, "payroll co ltd", None)
    assert (hit.id, hit.deleted_at) == (50, None)
    assert intake.duplicate(db, 1, "Somebody Else", "https://www.payroll.example/x").id == 50
    assert intake.duplicate(db, 1, "Somebody Else", None) is None


def test_the_review_team_sees_the_same_flag_on_the_list_and_on_the_request(db, as_user):
    db.add(Vendor(id=50, tenant_id=1, name="Payroll Co", website="payroll.example", status="active"))
    db.commit()
    vid = _submitted(as_user, "Payroll Co Ltd", website="https://payroll.example")
    team = as_user(TEAM)

    row = next(r for r in team.get("/intake/requests").json()["items"] if r["id"] == vid)
    assert row["screening"] == "flagged" and row["duplicate_of"] == 50
    assert [d["id"] for d in row["duplicates"]] == [50]                       # never itself
    one = team.get(f"/vendors/{vid}/intake").json()
    assert one["screening"] == "flagged" and one["duplicate_of"] == 50 and [d["id"] for d in one["duplicates"]] == [50]

    clean = _submitted(as_user, "Entirely New Co")
    row = next(r for r in team.get("/intake/requests").json()["items"] if r["id"] == clean)
    assert (row["screening"], row["duplicates"], row["duplicate_of"]) == ("screened", [], None)


def test_a_request_is_matched_against_other_requests_too_and_a_decided_one_is_not_screened(db, as_user):
    first = _submitted(as_user, "Twin Software", website="twin.example")
    second = _submitted(as_user, "Twin Software Ltd")
    team = as_user(TEAM)
    rows = {r["id"]: r for r in team.get("/intake/requests").json()["items"]}
    assert [d["id"] for d in rows[second]["duplicates"]] == [first] and rows[second]["duplicates"][0]["intake_status"] == "submitted"
    assert [d["id"] for d in rows[first]["duplicates"]] == [second]
    team.post(f"/vendors/{first}/intake/reject", json={"reason": "Same tool as the one we already asked for"})
    rows = {r["id"]: r for r in team.get("/intake/requests").json()["items"]}
    assert (rows[first]["screening"], rows[first]["duplicates"]) == (None, [])    # a decided request has nothing to screen
    assert [d["id"] for d in rows[second]["duplicates"]] == [first]               # and stays a match for the next one


# ── what a request carries ───────────────────────────────────────────────────

def test_a_request_carries_a_department_an_urgency_and_what_it_is_for(db, as_user):
    requester = as_user(REQUESTER)
    made = requester.post("/intake/requests", json={
        "name": "Payroll Co", "department": "  Finance   Ops ", "urgency": "high", "intended_use": "Runs  payroll\nfor staff"})
    assert made.status_code == 201, made.text
    vid = made.json()["id"]
    v = db.get(Vendor, vid)
    assert v.intake["request"] == {"department": "Finance Ops", "urgency": "high"}
    assert v.intake["answers"] == {"purpose": "Runs payroll for staff"}

    one = requester.get(f"/vendors/{vid}/intake").json()
    assert one["request"] == {"department": "Finance Ops", "urgency": "high", "engagement": None}

    plain = requester.post("/intake/requests", json={"name": "Plain Co"}).json()["id"]
    assert requester.get(f"/vendors/{plain}/intake").json()["request"] == {"department": None, "urgency": "normal", "engagement": None}
    assert requester.post("/intake/requests", json={"name": "Odd Co", "urgency": "whenever"}).status_code == 422


def test_the_request_fields_survive_saving_answers_and_can_be_changed(db, as_user):
    requester = as_user(REQUESTER)
    vid = requester.post("/intake/requests", json={"name": "Payroll Co", "department": "HR", "urgency": "low"}).json()["id"]
    saved = requester.put(f"/vendors/{vid}/intake", json={"answers": {"engagement_type": "saas"}})
    assert saved.status_code == 200 and saved.json()["request"]["department"] == "HR"       # the answers' save keeps it

    changed = requester.put(f"/vendors/{vid}/intake", json={"request": {"urgency": "high", "engagement": "Payroll"}})
    assert changed.json()["request"] == {"department": "HR", "urgency": "high", "engagement": "Payroll"}
    assert changed.json()["intake"]["answers"] == {"engagement_type": "saas"}               # and it keeps the answers
    bad = requester.put(f"/vendors/{vid}/intake", json={"request": {"urgency": "now"}})
    assert bad.status_code == 400 and "low, normal or high" in bad.json()["detail"]
    assert intake.merge({"answers": {"a": 1}, "request": {"urgency": "low"}}, {"answers": {}, "justifications": {}})["request"] == {"urgency": "low"}


def test_the_list_gives_each_card_what_it_shows(db, as_user):
    vid = _submitted(as_user, "Payroll Co", department="Finance", urgency="high")
    team = as_user(TEAM)
    row = next(r for r in team.get("/intake/requests").json()["items"] if r["id"] == vid)
    assert (row["department"], row["urgency"], row["purpose"]) == ("Finance", "high", "Payroll for all staff")
    assert {"personal data", "sensitive personal data", "financial reporting data"} <= set(row["data_shared"])
    assert row["requested_by"]["name"] == "Rob Requester" and row["decision"] is None

    team.post(f"/vendors/{vid}/intake/review")
    row = next(r for r in team.get("/intake/requests").json()["items"] if r["id"] == vid)
    assert row["intake_status"] == "in_review" and row["decision"]["by"] == "Tara Analyst" and row["decision"]["reason"] is None
    assert (row["screening"], row["duplicates"]) == (None, [])                   # nothing is left for the team to decide

    other = _submitted(as_user, "Other Co")
    as_user(TEAM).post(f"/vendors/{other}/intake/reject", json={"reason": "We already have a payroll supplier"})
    row = next(r for r in as_user(TEAM).get("/intake/requests").json()["items"] if r["id"] == other)
    assert (row["intake_status"], row["decision"]["by"], row["decision"]["reason"]) == ("rejected", "Tara Analyst", "We already have a payroll supplier")


def test_a_request_approved_at_the_gate_says_who_approved_it_and_why(db, as_user):
    from grc.modules.vendor_risk.tpra import service

    vid = _submitted(as_user, "Payroll Co")
    team = as_user(TEAM)
    team.post(f"/vendors/{vid}/intake/review")
    service.write_audit(db, 1, entity="approval", action="create", vendor_id=vid, actor_id=OTHER,
                        to_value="approve_with_conditions", reason="Approved once the DPA is signed")
    intake.set_status(db.get(Vendor, vid), "approved")                          # what the approval decision does to its request
    db.commit()
    row = next(r for r in team.get("/intake/requests").json()["items"] if r["id"] == vid)
    assert row["intake_status"] == "approved"
    assert (row["decision"]["by"], row["decision"]["reason"]) == ("Olu Other", "Approved once the DPA is signed")
    assert (row["screening"], row["duplicates"]) == (None, [])


# ── approve and create ───────────────────────────────────────────────────────

def test_picking_a_request_up_starts_the_lifecycle_and_makes_the_named_first_engagement(db, as_user):
    vid = _submitted(as_user, "Payroll Co")
    team = as_user(TEAM)
    team.put(f"/vendors/{vid}/intake", json={"request": {"engagement": " Payroll  run "}})
    done = team.post(f"/vendors/{vid}/intake/review")
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["intake_status"] == "in_review" and body["tiering"]["tier"] == "critical"
    v = db.get(Vendor, vid)
    assert (v.status, v.tier) == ("onboarding", "critical")                    # General is tiered from the answers, as before
    assert db.query(VendorAssessment).filter_by(vendor_id=vid, engagement_id=None).count() == 1

    named = db.query(TPRAEngagement).filter_by(vendor_id=vid, is_general=False).one()
    assert (named.name, named.status, named.owner_id) == ("Payroll run", "active", v.owner_id)
    assert named.engagement_type == "saas" and named.intake["answers"]["purpose"] == "Payroll for all staff"
    general = db.query(TPRAEngagement).filter_by(vendor_id=vid, is_general=True).one()
    assert general.tier == "critical" and body["engagement_id"] == named.id
    assert db.query(VendorAssessment).filter_by(vendor_id=vid, engagement_id=named.id).count() == 0   # tiered when someone opens it
    assert ("engagement", "create") in {(r.entity, r.action) for r in db.query(TPRAAuditLog).filter_by(vendor_id=vid)}


def test_without_a_named_engagement_nothing_else_is_made(db, as_user):
    vid = _submitted(as_user, "Payroll Co")
    assert as_user(TEAM).post(f"/vendors/{vid}/intake/review").json()["engagement_id"] is None
    assert db.query(TPRAEngagement).filter_by(vendor_id=vid).count() == 0
    general = _submitted(as_user, "Other Co")
    as_user(TEAM).put(f"/vendors/{general}/intake", json={"request": {"engagement": "General"}})
    as_user(TEAM).post(f"/vendors/{general}/intake/review")
    assert db.query(TPRAEngagement).filter_by(vendor_id=general).count() == 0   # General is the supplier itself


# ── decided once ─────────────────────────────────────────────────────────────

def test_a_request_is_decided_once_and_approved_is_final(db, as_user):
    vid = _submitted(as_user, "Payroll Co")
    team = as_user(TEAM)
    assert team.post(f"/vendors/{vid}/intake/reject", json={"reason": "short"}).status_code == 422     # a real reason, 10 characters or more
    assert team.post(f"/vendors/{vid}/intake/reject", json={"reason": "We already have a payroll supplier"}).status_code == 200
    again = team.post(f"/vendors/{vid}/intake/reject", json={"reason": "We already have a payroll supplier"})
    assert again.status_code == 400 and "rejected cannot be rejected" in again.json()["detail"]
    assert team.post(f"/vendors/{vid}/intake/review").status_code == 400                                # nor picked up
    assert as_user(REQUESTER).post(f"/vendors/{vid}/intake/return", json={"reason": "Changed what we ask for now"}).status_code == 200
    assert db.get(Vendor, vid).intake_status == "draft"                          # the requester may reopen a turned-down request

    approved = _submitted(as_user, "Other Co")
    as_user(TEAM).post(f"/vendors/{approved}/intake/review")
    intake.set_status(db.get(Vendor, approved), "approved")                      # the lifecycle's approval gate
    db.commit()
    for call in ("reject", "return"):
        r = as_user(TEAM).post(f"/vendors/{approved}/intake/{call}", json={"reason": "Changed our mind about this one"})
        assert r.status_code == 400, call
    assert as_user(TEAM).post(f"/vendors/{approved}/intake/review").status_code == 400
    assert db.get(Vendor, approved).intake_status == "approved"


# ── a page of the requests, a queue order, counts that stay whole ────────────

def test_the_requests_come_in_pages_with_a_total_and_without_a_limit_as_before(db, as_user):
    ids = [_submitted(as_user, f"Request {n:02d}") for n in range(5)]
    team = as_user(TEAM)
    everything = team.get("/intake/requests").json()
    assert len(everything["items"]) == 5 and everything["total"] == 5 and everything["limit"] is None
    page = team.get("/intake/requests", params={"limit": 2}).json()
    again = team.get("/intake/requests", params={"limit": 2, "skip": 2}).json()
    last = team.get("/intake/requests", params={"limit": 2, "skip": 4}).json()
    assert [len(p["items"]) for p in (page, again, last)] == [2, 2, 1]
    assert all(p["total"] == 5 and p["counts"]["submitted"] == 5 for p in (page, again, last))
    assert sorted(i["id"] for p in (page, again, last) for i in p["items"]) == sorted(ids)      # every request once, none twice
    assert team.get("/intake/requests", params={"limit": 0}).status_code == 422


def test_several_statuses_at_once_and_the_queue_puts_the_urgent_first_then_the_longest_wait(db, as_user):
    early = _submitted(as_user, "Early Normal")
    urgent = _submitted(as_user, "Urgent One", urgency="high")
    late = _submitted(as_user, "Late Normal")
    draft = as_user(REQUESTER).post("/intake/requests", json={"name": "Still A Draft", "urgency": "low"}).json()["id"]
    team = as_user(TEAM)
    got = team.get("/intake/requests", params={"statuses": "submitted,draft", "sort": "queue"}).json()
    assert [i["id"] for i in got["items"]] == [urgent, early, late, draft]                  # high, then normal oldest first, then low
    assert got["total"] == 4 and got["counts"]["submitted"] == 3 and got["counts"]["draft"] == 1
    only = team.get("/intake/requests", params={"statuses": "draft"}).json()
    assert [i["id"] for i in only["items"]] == [draft] and only["total"] == 1
    assert only["counts"]["submitted"] == 3                                                # counts are what the search leaves, not the filter


def test_a_search_with_a_percent_or_underscore_matches_those_characters_only(db, as_user):
    plain = _submitted(as_user, "Plain Co")
    odd = _submitted(as_user, "Fifty%_Off Ltd")
    team = as_user(TEAM)
    assert [i["id"] for i in team.get("/intake/requests", params={"search": "%"}).json()["items"]] == [odd]
    assert [i["id"] for i in team.get("/intake/requests", params={"search": "y_O"}).json()["items"]] == []
    assert {i["id"] for i in team.get("/intake/requests", params={"search": "co"}).json()["items"]} == {plain}
