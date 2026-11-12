"""Risk Management wave 4-M: third-party risk where it meets ERM, on the eleven-stage lifecycle (EBA/GL/2019/02, SBP outsourcing).

1. Materiality: the second line says whether a scope supports a critical or important function, with a reason; the tiering gate
   waits for the answer.
2. A critical or important outsourcing is approved only with an exit plan, the contract's audit, exit and data-location clauses,
   every sub-outsourcer approved and a committee's decision at a meeting; whoever classified it cannot approve it (409).
3. Each sub-outsourcer of a critical or important service waits for approval, by someone other than who added it.
4. The way to Active (onboarding) waits for the regulator's notice where it is required.
5. A vendor incident becomes a Basel loss event once, with its net loss.
6. Critical or important vendors sharing one fourth party over the appetite's concentration limit is a breach in the appetite log.
7. The third-party audience rows: materiality by residual band, and concentration against the limit.
In-memory SQLite through the real /vendor-risk and /erm routers.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, CommitteeMeeting, GovernanceCommittee, GRCUser, Permission, RiskAppetiteBreach,
                        RiskAppetiteConfig, RiskIncident, Role, RolePermission, Tenant, TPRAContract, TPRAEngagement,
                        TPRAFourthParty, TPRAStageInstance, UserRole, Vendor, VendorIncident, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.vendor_risk.router import router as vendor_router
from grc.modules.vendor_risk.tpra import service
from grc.modules.vendor_risk.tpra.stages import STAGE_ORDER
from grc.routers.auth_router import create_access_token, require_auth
from grc.routers.enriched_dashboard_router import router as enriched_router

CLASSIFIER, MOVER, APPROVER, OWNER, CLERK = 7, 8, 9, 10, 11       # the first four are administrators
NAMES = {CLASSIFIER: "classifier", MOVER: "mover", APPROVER: "approver", OWNER: "owner", CLERK: "clerk"}
WHY = "Runs card authorisation: a critical function under EBA/GL/2019/02."


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Vendor clerk")])
    # the clerk may record vendor incidents and edit vendors, but neither approve nor write ERM loss data
    s.add_all([Permission(id=1, name="vendor_risk:monitoring:edit", resource="vendor_risk", action="edit"),
               Permission(id=2, name="vendor_risk:vendors:edit", resource="vendor_risk", action="edit"),
               Permission(id=3, name="vendor_risk:approvals:approve", resource="vendor_risk", action="approve"),
               Permission(id=4, name="vendor_risk:monitoring:create", resource="vendor_risk", action="create")])
    s.add_all([RolePermission(role_id=2, permission_id=i) for i in (1, 2, 4)])
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in NAMES.items()])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (CLASSIFIER, MOVER, APPROVER, OWNER)])
    s.add(UserRole(user_id=CLERK, role_id=2, tenant_id=1))
    s.add(GovernanceCommittee(id=1, tenant_id=1, name="Board Risk Committee", committee_type="risk_committee"))
    s.add(CommitteeMeeting(id=1, tenant_id=1, committee_id=1, title="BRC November", scheduled_date=datetime.utcnow(),
                           status="completed"))
    s.commit()
    yield s
    s.close()


def client(db, uid):
    """One app per test (building it is the slow part); each client says who it is."""
    app = db.info.get("app")
    if app is None:
        app = db.info["app"] = FastAPI()
        app.include_router(vendor_router)
        app.include_router(erm_router)
        app.include_router(enriched_router)
        app.dependency_overrides[get_db] = lambda: db
        def who(request: Request) -> GRCUser:
            return db.get(GRCUser, int(request.headers["x-test-user"]))
        app.dependency_overrides[require_auth] = who
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": NAMES[uid]})
    http.headers["x-test-user"] = str(uid)
    return http


def _vendor(db, name="Card processor", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "high", "status": "active", "data_access_level": "confidential",
                  "data_types_accessed": ["PII"], "owner_id": OWNER, **kw})
    db.add(v)
    db.commit()
    return v


def _work(db, v, current, engagement=None):
    """An assessment at `current`: the stages before it complete, the ones after not started; scored low."""
    a = service.ensure_active_assessment(db, v, actor_id=MOVER, engagement=engagement)
    a.inherent_tier, a.inherent_score, a.current_stage = "low", 20.0, current      # low: no reviewers to name
    a.residual_score, a.residual_rating = 20.0, "low"
    for s in service.get_stage_instances(db, a.id):
        s.status = ("complete" if STAGE_ORDER[s.stage_key] < STAGE_ORDER[current]
                    else "in_progress" if s.stage_key == current else "not_started")
    (engagement or v).lifecycle_stage = current
    db.commit()
    return a


def _classify(db, v, yes=True, uid=CLASSIFIER, **params):
    got = client(db, uid).put(f"/vendor-risk/tpra/vendors/{v.id}/materiality", params=params,
                              json={"critical_important": yes, "reason": WHY})
    assert got.status_code == 200, got.text
    return got.json()


def _gate(db, v, a, stage):
    db.expire_all()
    gate = service.evaluate_current(db, db.get(Vendor, v.id), a, stage)
    return gate, {c["key"]: c["met"] for c in gate["checks"]}


# ── 1. materiality ───────────────────────────────────────────────────────────

def test_materiality_is_the_second_lines_call_with_a_reason_and_the_tiering_gate_waits_for_it(db):
    v = _vendor(db)
    a = _work(db, v, "tiering")
    gate, met = _gate(db, v, a, "tiering")
    assert met == {"tiered": True, "materiality": False}
    assert "critical or important function" in gate["blockers"][0]

    http = client(db, CLASSIFIER)
    short = http.put(f"/vendor-risk/tpra/vendors/{v.id}/materiality", json={"critical_important": True, "reason": "yes"})
    assert short.status_code == 400
    body = _classify(db, v)
    assert body["critical_important"] is True
    assert body["materiality"]["by"] == CLASSIFIER and body["materiality"]["reason"] == WHY
    assert _gate(db, v, a, "tiering")[0]["passed"] is True
    # "not critical or important" is an answer too
    other = _vendor(db, name="Stationery")
    o = _work(db, other, "tiering")
    _classify(db, other, yes=False)
    assert _gate(db, other, o, "tiering")[0]["passed"] is True
    # an engagement is classified on its own row; the supplier keeps its own answer
    e = TPRAEngagement(tenant_id=1, vendor_id=other.id, name="Branch printing", status="active")
    db.add(e)
    db.commit()
    assert _classify(db, other, engagement_id=e.id)["engagement_id"] == e.id
    db.expire_all()
    assert (db.get(TPRAEngagement, e.id).critical_important, db.get(Vendor, other.id).critical_important) == (True, False)


# ── 2. the Approval gate for a critical or important outsourcing ─────────────

def test_a_critical_or_important_outsourcing_is_not_approved_without_exit_plan_clauses_and_a_committee(db):
    v = _vendor(db)
    a = _work(db, v, "approval")
    _classify(db, v)
    gate, met = _gate(db, v, a, "approval")
    assert gate["passed"] is False
    assert met["exit_plan"] is False and met["clauses"] is False and met["committee"] is False
    assert met["sub_outsourcing"] is True

    http = client(db, APPROVER)
    alone = http.post(f"/vendor-risk/tpra/assessments/{a.id}/approvals", json={"decision": "approve"})
    assert alone.status_code == 400 and "committee" in alone.json()["detail"]
    assert http.post(f"/vendor-risk/tpra/assessments/{a.id}/approvals",
                     json={"decision": "approve", "meeting_id": 999}).status_code == 404
    decided = http.post(f"/vendor-risk/tpra/assessments/{a.id}/approvals",
                        json={"decision": "approve", "meeting_id": 1, "rationale": "BRC approved"})
    assert decided.status_code == 201, decided.text
    assert (decided.json()["committee_id"], decided.json()["meeting_id"]) == (1, 1)
    gate, met = _gate(db, v, a, "approval")
    assert met["committee"] is True and gate["passed"] is False      # the exit plan and clauses still hold it

    plan = f"/vendor-risk/tpra/vendors/{v.id}/exit-plan"
    assert http.put(plan, json={"status": "approved"}).status_code == 400     # in place means written down
    assert http.put(plan, json={"status": "approved", "summary": "Move to the second processor in 90 days"}).status_code == 200
    db.add(TPRAContract(tenant_id=1, vendor_id=v.id, title="MSA", status="active", right_to_audit=True, exit_data_return=True))
    db.commit()
    gate, met = _gate(db, v, a, "approval")
    assert met["clauses"] is False and "where the data is held" in " ".join(gate["blockers"])
    db.get(Vendor, v.id).data_location = "Karachi, Pakistan"
    db.commit()
    assert _gate(db, v, a, "approval")[0]["passed"] is True
    # the contracting stage asks for the same clauses, whatever the tier
    assert _gate(db, v, a, "contracting")[1] == {"contract": True, "clauses": True}


def test_whoever_classified_the_outsourcing_cannot_approve_it(db):
    v = _vendor(db)
    a = _work(db, v, "approval")
    _classify(db, v)
    got = client(db, CLASSIFIER).post(f"/vendor-risk/tpra/assessments/{a.id}/approvals",
                                      json={"decision": "approve", "meeting_id": 1})
    assert got.status_code == 409
    # deferring is not approving; and the approvers list says why the classifier is out
    assert client(db, CLASSIFIER).post(f"/vendor-risk/tpra/assessments/{a.id}/approvals",
                                       json={"decision": "defer", "meeting_id": 1}).status_code == 201
    who = {p["user_id"]: p for p in client(db, APPROVER).get(f"/vendor-risk/tpra/assessments/{a.id}/approvers").json()["items"]}
    assert who[CLASSIFIER]["eligible"] is False and who[CLASSIFIER]["reason"] == "Classified its materiality"


# ── 3. sub-outsourcing ───────────────────────────────────────────────────────

def test_each_sub_outsourcer_of_a_critical_service_waits_for_an_independent_approval(db):
    v = _vendor(db)
    a = _work(db, v, "approval")
    db.add(TPRAFourthParty(tenant_id=1, vendor_id=v.id, name="Old host", platform="Old host", created_by=MOVER))
    db.commit()
    _classify(db, v)                       # already listed: now waits too
    added = client(db, MOVER).post(f"/vendor-risk/tpra/vendors/{v.id}/fourth-parties", json={"name": "AWS", "service": "Hosting"})
    assert added.status_code == 201 and added.json()["approval_status"] == "pending"
    gate, met = _gate(db, v, a, "approval")
    assert met["sub_outsourcing"] is False and "AWS, Old host" in " ".join(gate["blockers"])

    fp_id = added.json()["id"]
    decide = f"/vendor-risk/tpra/fourth-parties/{fp_id}/decision"
    assert client(db, MOVER).post(decide, json={"decision": "approve"}).status_code == 409     # who added it
    assert client(db, CLERK).post(decide, json={"decision": "approve"}).status_code == 403     # no right to approve
    ok = client(db, APPROVER).post(decide, json={"decision": "approve", "note": "SOC 2 seen"})
    assert ok.status_code == 200 and ok.json()["approval_status"] == "approved"
    old = db.query(TPRAFourthParty).filter_by(name="Old host").one()
    assert client(db, APPROVER).post(f"/vendor-risk/tpra/fourth-parties/{old.id}/decision",
                                     json={"decision": "reject"}).json()["approval_status"] == "rejected"
    assert _gate(db, v, a, "approval")[1]["sub_outsourcing"] is False          # a rejected one still holds the gate
    assert client(db, MOVER).delete(f"/vendor-risk/tpra/fourth-parties/{old.id}").status_code == 200
    assert _gate(db, v, a, "approval")[1]["sub_outsourcing"] is True
    # renaming an approved one is another sub-outsourcer: decided again
    renamed = client(db, MOVER).put(f"/vendor-risk/tpra/fourth-parties/{fp_id}", json={"name": "Azure", "service": "Hosting"})
    assert renamed.json()["approval_status"] == "pending"
    # a vendor that is not critical or important adds fourth parties as before
    plain = _vendor(db, name="Stationery")
    assert client(db, MOVER).post(f"/vendor-risk/tpra/vendors/{plain.id}/fourth-parties",
                                  json={"name": "AWS"}).json()["approval_status"] is None


# ── 4. the regulator's notice before Active ──────────────────────────────────

def test_the_way_to_active_waits_for_the_regulators_notice_when_required(db):
    v = _vendor(db)
    a = _work(db, v, "onboarding")
    db.query(TPRAStageInstance).filter_by(assessment_id=a.id, stage_key="onboarding").one().checklist = [
        {"text": "Access granted", "done": True}]
    db.commit()
    _classify(db, v)
    gate, met = _gate(db, v, a, "onboarding")
    assert met == {"checklist": True, "regulator": False} and "whether the regulator" in gate["blockers"][0]

    http = client(db, MOVER)
    notice = f"/vendor-risk/tpra/vendors/{v.id}/regulator-notice"
    assert http.put(notice, json={"required": True}).status_code == 200
    gate, met = _gate(db, v, a, "onboarding")
    assert met["regulator"] is False and "when the regulator was notified" in gate["blockers"][0]
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert http.put(notice, json={"required": True, "sent_on": tomorrow}).status_code == 400
    sent = http.put(notice, json={"required": True, "sent_on": date.today().isoformat(), "reference": "SBP/OUT/2026/114"})
    assert sent.json()["regulator"]["reference"] == "SBP/OUT/2026/114"
    assert http.post(f"/vendor-risk/tpra/assessments/{a.id}/advance", json={}).json()["to"] == "monitoring"
    # not required is an answer too
    other = _vendor(db, name="Second processor")
    o = _work(db, other, "onboarding")
    db.query(TPRAStageInstance).filter_by(assessment_id=o.id, stage_key="onboarding").one().checklist = [
        {"text": "Access granted", "done": True}]
    db.commit()
    _classify(db, other)
    http.put(f"/vendor-risk/tpra/vendors/{other.id}/regulator-notice", json={"required": False})
    assert _gate(db, other, o, "onboarding")[0]["passed"] is True


# ── 5. a vendor incident as a loss event ─────────────────────────────────────

def test_a_vendor_incident_becomes_one_basel_loss_event_with_its_net_loss(db):
    v = _vendor(db)
    made = client(db, CLERK).post(f"/vendor-risk/vendors/{v.id}/incidents",
                                  json={"title": "Settlement file late", "severity": "high"})
    assert made.status_code == 201, made.text
    inc_id = made.json()["id"]
    url = f"/vendor-risk/tpra/vendor-incidents/{inc_id}/loss-event"
    loss = {"gross_loss": 120000, "recoveries": 20000, "currency": "usd", "business_line": "Retail banking"}
    assert client(db, CLERK).post(url, json=loss).status_code == 403        # no right to write loss data
    assert client(db, MOVER).post(url, json={"gross_loss": 5}).status_code == 400   # money needs its currency
    got = client(db, MOVER).post(url, json=loss)
    assert got.status_code == 201, got.text
    body = got.json()
    assert (body["net_loss"], body["currency"], body["event_type"]) == (100000, "USD", "execution_delivery")
    event = db.get(RiskIncident, body["loss_event_id"])
    assert event.business_line == "retail_banking" and event.title == "Card processor: Settlement file late"
    assert "third_party" in event.tags and event.validation_status == "pending"
    assert db.get(VendorIncident, inc_id).loss_event_id == event.id
    assert client(db, MOVER).post(url, json=loss).status_code == 409        # once
    listed = client(db, MOVER).get(f"/vendor-risk/vendors/{v.id}/incidents").json()["items"]
    assert listed[0]["loss_event_id"] == event.id


# ── 6. concentration against appetite ────────────────────────────────────────

def _shared_aws(db):
    vendors = [_vendor(db, name=n) for n in ("Card processor", "Core banking", "Stationery")]
    for v in vendors:
        db.add(TPRAFourthParty(tenant_id=1, vendor_id=v.id, name="Amazon Web Services", platform="AWS", created_by=MOVER))
    db.commit()
    for v in vendors[:2]:
        _classify(db, v)
    return vendors


def test_critical_vendors_sharing_one_fourth_party_over_the_limit_is_an_appetite_breach(db):
    _shared_aws(db)
    config = RiskAppetiteConfig(tenant_id=1, category="third_party", max_acceptable_score=12, concentration_limit=1)
    db.add(config)
    db.commit()
    http = client(db, MOVER)
    seen = http.get("/vendor-risk/tpra/concentration/appetite").json()
    assert seen["limit"] == 1 and seen["platforms"][0] == {"platform": "AWS", "count": 2,
                                                          "vendors": ["Card processor", "Core banking"]}
    assert [r["platform"] for r in seen["breaching"]] == ["AWS"]

    log = http.get("/erm/appetite/breach-log")
    assert log.status_code == 200, log.text
    breach = db.query(RiskAppetiteBreach).filter_by(category="third_party").one()
    assert (breach.risk_id, breach.kri_id, breach.measured_value, breach.limit_value, breach.status) == (None, None, 2, 1, "open")
    assert http.post("/erm/appetite/check").json()["opened"] == 0          # idempotent: still the one breach
    # raising the limit on the appetite resolves it
    assert http.put(f"/erm/appetite/{config.id}", json={"concentration_limit": 3}).json()["concentration_limit"] == 3
    db.expire_all()
    assert db.query(RiskAppetiteBreach).filter_by(category="third_party").one().status == "resolved"


# ── 7. the third-party audience rows ─────────────────────────────────────────

def test_the_third_party_rows_read_materiality_by_band_and_concentration_against_the_limit(db):
    vendors = _shared_aws(db)
    vendors[0].residual_risk_score, vendors[0].risk_rating = 80, "critical"
    db.add(_vendor(db, name="Unclassified"))
    db.commit()
    rows = lambda: {r["key"]: r for q in client(db, MOVER).get("/erm/dashboard/audience?view=third_party").json()["questions"]
                    for r in q["rows"]}
    got = rows()
    matrix = {r["materiality"]: r for r in got["vendors_by_band"]["items"]}
    assert got["vendors_by_band"]["value"] == 2
    assert matrix["critical_important"]["critical"] == 1 and matrix["critical_important"]["unscored"] == 1
    assert matrix["unclassified"]["unscored"] == 2 and matrix["other"]["unscored"] == 0
    assert got["concentration"]["value"] is None and "concentration limit" in got["concentration"]["reason"]

    db.add(RiskAppetiteConfig(tenant_id=1, category="third_party", max_acceptable_score=12, concentration_limit=1))
    db.commit()
    c = rows()["concentration"]
    assert (c["value"], c["limit"], c["breached"]) == (2, 1, True)
    assert c["items"] == [{"unit": "AWS", "count": 2}] and c["visual"] == "unit_bars"
