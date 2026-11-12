"""Wave 5 integrity gaps, Monitor (KRIs and risk appetite): each rule holds on the server, one test per gap.

1 a threshold change on an active KRI is proposed and decided by someone else; 2 checkers hear of a value to check and the
submitter of the decision; 3 uploaded values wait in the same check queue; 4 escalation (issue, alert, breach log) happens on
approval, once; 5 orphaned KRIs get their tenant back; 6 approving a statement freezes its limits and a later limit change is
decided by someone else; 7 a plan can be rejected; 8 one open breach per subject under a race; 9 a risk created over its limit
is logged at once; 10 appetite and reports read a risk the same way; 11 the concentration limit is on the page data; 12 plan
handoffs are told. Runs through the real /erm router. In-memory SQLite; email is blocked by conftest.
"""
from datetime import datetime
from io import BytesIO

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Issue, Permission, Risk, RiskAppetiteBreach, RiskAppetiteConfig, RiskKRI,
                        RiskKRIMeasurement, Role, RolePermission, Tenant, UserRole, WorkflowNotification, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import appetite
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, PROVIDER, OWNER, RISK_OWNER = 7, 8, 9, 10, 11


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk viewer")])
    s.add(Permission(id=1, name="erm:risks:view", resource="erm:risks", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((MAKER, "maker"), (CHECKER, "checker"), (PROVIDER, "provider"), (OWNER, "owner"),
                                 (RISK_OWNER, "riskowner"))])
    s.add_all([UserRole(user_id=MAKER, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1),
               UserRole(user_id=OWNER, role_id=2, tenant_id=1), UserRole(user_id=PROVIDER, role_id=2, tenant_id=1)])
    s.add(Risk(id=1, tenant_id=1, title="Patch backlog", category="technology", risk_category="technology",
               owner_id=RISK_OWNER))
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


def kri(db, **fields):
    row = RiskKRI(**{"tenant_id": 1, "name": "Overdue patches", "green_threshold": 1, "amber_threshold": 3,
                     "threshold_direction": "lower_is_better", "frequency": "monthly", "is_active": True, "status": "active",
                     "kind": "kri", "created_by": MAKER, **fields})
    db.add(row)
    db.commit()
    return row


def limit(db, category="operational", tolerance=10, **kw):
    config = RiskAppetiteConfig(**{"tenant_id": 1, "category": category, "tolerance_threshold": tolerance,
                                   "max_acceptable_score": 20, "escalation_owner_id": OWNER, "alert_enabled": True, **kw})
    db.add(config)
    db.commit()
    return config


def risk(db, title, residual, category="operational", **kw):
    row = Risk(**{"tenant_id": 1, "title": title, "category": category, "risk_category": category, "inherent_score": 20,
                  "residual_score": residual, **kw})
    db.add(row)
    db.commit()
    return row


def told(db, user_id):
    """The subjects of the in-app notices a person got, oldest first."""
    db.expire_all()
    return [n.subject for n in db.query(WorkflowNotification).filter_by(user_id=user_id).order_by(WorkflowNotification.id)]


def open_breaches(db):
    db.expire_all()
    return db.query(RiskAppetiteBreach).filter(RiskAppetiteBreach.status != "resolved").all()


def approve_statement(db):
    made = client(db, "maker").post("/erm/appetite/statements", json={"statement": "We accept low operational risk."}).json()
    client(db, "maker").post(f"/erm/appetite/statements/{made['id']}/submit")
    approved = client(db, "checker").post(f"/erm/appetite/statements/{made['id']}/approve", json={"note": "Board"})
    assert approved.status_code == 200, approved.text
    return approved.json()


# ── 1. KRI thresholds ────────────────────────────────────────────────────────

def test_1_a_threshold_change_on_an_active_kri_waits_for_someone_other_than_the_proposer(db):
    k = kri(db)
    maker, checker = client(db, "maker"), client(db, "checker")
    edited = maker.put(f"/erm/kris/{k.id}", json={"green_threshold": 2, "amber_threshold": 5, "name": "Overdue patches (all)"})
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert (body["green_threshold"], body["amber_threshold"], body["name"]) == (1, 3, "Overdue patches (all)"), \
        "the approved thresholds stay in force; other fields change at once"
    change = body["threshold_change"]
    assert (change["status"], change["changes"], change["proposed_by"]) == (
        "pending", {"green_threshold": 2, "amber_threshold": 5}, MAKER)
    assert told(db, CHECKER) and not told(db, MAKER), "the other KRI checkers hear of it, not the proposer"

    path = f"/erm/kris/{k.id}/thresholds"
    assert maker.post(f"{path}/approve", json={}).status_code == 409, "not by the proposer"
    assert checker.post(f"{path}/reject", json={"note": " "}).status_code == 422, "a reason to send it back"
    ok = checker.post(f"{path}/approve", json={})
    assert ok.status_code == 200, ok.text
    assert (ok.json()["green_threshold"], ok.json()["amber_threshold"]) == (2, 5)
    assert (ok.json()["threshold_change"]["status"], ok.json()["threshold_change"]["decided_by"]) == ("approved", CHECKER)
    assert checker.post(f"{path}/approve", json={}).status_code == 409, "nothing waits now"

    maker.put(f"/erm/kris/{k.id}", json={"threshold_direction": "higher_is_better", "green_threshold": 2})
    sent_back = checker.post(f"{path}/reject", json={"note": "Fewer overdue patches is better"}).json()
    assert sent_back["threshold_direction"] == "lower_is_better"
    assert (sent_back["threshold_change"]["status"], sent_back["threshold_change"]["note"]) == (
        "rejected", "Fewer overdue patches is better")
    assert sent_back["threshold_change"]["changes"] == {"threshold_direction": "higher_is_better"}, "an unchanged value is no change"
    assert len(told(db, MAKER)) == 2, "the proposer hears of both decisions"

    draft = kri(db, name="Draft one", status="draft", is_active=False)
    assert maker.put(f"/erm/kris/{draft.id}", json={"green_threshold": 9}).json()["green_threshold"] == 9, \
        "a draft's thresholds are approved with the draft"


# ── 2. who is told about a value ─────────────────────────────────────────────

def test_2_checkers_hear_of_a_value_to_check_and_the_submitter_of_the_decision(db):
    named = kri(db, reviewer_id=CHECKER, data_provider_id=PROVIDER)
    sent = client(db, "provider").post(f"/erm/kris/{named.id}/measure", json={"value": 2})
    assert sent.status_code == 200, sent.text
    assert len(told(db, CHECKER)) == 1 and told(db, PROVIDER) == [] and told(db, MAKER) == [], "the named checker"
    assert db.query(WorkflowNotification).filter_by(user_id=CHECKER).one().link == "/erm/kris?tab=check"

    nobody = kri(db, name="No checker named")
    other = client(db, "maker").post(f"/erm/kri-workflow/kris/{nobody.id}/submit", json={"value": 2}).json()
    assert len(told(db, CHECKER)) == 2 and told(db, MAKER) == [], "every KRI checker but the submitter"

    checker = client(db, "checker")
    assert checker.post(f"/erm/kri-workflow/measurements/{sent.json()['id']}/approve").status_code == 200
    assert len(told(db, PROVIDER)) == 1, "the submitter hears it was approved"
    rejected = checker.post(f"/erm/kri-workflow/measurements/{other['measurement_id']}/reject", json={"notes": "Wrong month"})
    assert rejected.status_code == 200
    [note] = db.query(WorkflowNotification).filter_by(user_id=MAKER).all()
    assert "Wrong month" in note.message

    # the named checker submitted it themselves: the other checkers get it, in their queue too
    own = kri(db, name="Named maker", reviewer_id=MAKER)
    client(db, "maker").post(f"/erm/kris/{own.id}/measure", json={"value": 2})
    assert len(told(db, CHECKER)) == 3
    assert own.id in {i["kri_id"] for i in checker.get("/erm/kri-workflow/pending-reviews").json()["items"]}


# ── 3. uploaded values ───────────────────────────────────────────────────────

def _workbook(*rows) -> bytes:
    wb = openpyxl.Workbook()
    for row in rows:
        wb.active.append(row)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


def test_3_values_in_an_uploaded_file_wait_for_a_checker(db):
    data = _workbook(["KRI Name", "Current Value", "Green Threshold", "Amber Threshold", "Frequency"],
                     ["Failed logins", 7, 2, 5, "Monthly"])
    sent = client(db, "maker").post("/erm/kris/upload", files={"file": ("kris.xlsx", data, "application/octet-stream")})
    assert sent.status_code == 200, sent.text
    assert sent.json()["created"] == 1
    db.expire_all()
    k = db.query(RiskKRI).filter_by(name="Failed logins").one()
    assert k.current_value is None, "the file's value is not the current value until checked"
    [m] = db.query(RiskKRIMeasurement).filter_by(kri_id=k.id).all()
    assert (m.value, m.review_status, m.measured_by) == (7, "submitted", MAKER)
    assert len(told(db, CHECKER)) == 1 and told(db, MAKER) == []
    checker = client(db, "checker")
    assert [i["kri_id"] for i in checker.get("/erm/kri-workflow/pending-reviews").json()["items"]] == [k.id]
    assert checker.post(f"/erm/kri-workflow/measurements/{m.id}/approve").status_code == 200
    db.refresh(k)
    assert k.current_value == 7


# ── 4. escalation on approval, once ──────────────────────────────────────────

def test_4_a_red_value_escalates_only_when_approved_and_only_once(db):
    k = kri(db, owner_id=OWNER, risk_id=1)
    limit(db, "technology", tolerance=25, limit_kri_ids=[k.id])
    sent = client(db, "maker").post(f"/erm/kris/{k.id}/measure", json={"value": 9}).json()
    assert db.query(Issue).count() == 0 and open_breaches(db) == []
    assert not [s for s in told(db, OWNER) if "red" in s.lower() or "breach" in s.lower()]

    checker = client(db, "checker")
    assert checker.post(f"/erm/kri-workflow/measurements/{sent['id']}/approve").status_code == 200
    assert db.query(Issue).filter_by(source_type="kri_breach").count() == 1
    assert [(b.kri_id, b.category, b.measured_value) for b in open_breaches(db)] == [(k.id, "technology", 9)], \
        "the breach log has it without anyone opening the appetite page"
    alerts = len(told(db, OWNER))
    assert checker.post(f"/erm/kri-workflow/measurements/{sent['id']}/approve").status_code == 409
    assert db.query(Issue).count() == 1 and len(open_breaches(db)) == 1 and len(told(db, OWNER)) == alerts


# ── 5. orphaned KRIs ─────────────────────────────────────────────────────────

def test_5_orphaned_kris_get_their_tenant_back_and_are_listed(db):
    by_maker = RiskKRI(tenant_id=None, risk_id=None, name="Uploaded long ago", kind="kri", is_active=True, created_by=MAKER)
    nobody = RiskKRI(tenant_id=None, risk_id=None, name="No people", kind="kri", is_active=True)
    db.add_all([by_maker, nobody])
    db.commit()
    listed = client(db, "maker").get("/erm/kris", params={"kind": "kri"}).json()
    assert {"Uploaded long ago", "No people"} <= {k["name"] for k in listed}, "one tenant in the database: it is theirs"
    assert all(k["risk_id"] is None for k in listed if k["name"] in ("Uploaded long ago", "No people"))
    db.expire_all()
    assert (db.get(RiskKRI, by_maker.id).tenant_id, db.get(RiskKRI, nobody.id).tenant_id) == (1, 1)

    db.add(Tenant(id=2, name="Other", slug="other"))
    stray = RiskKRI(tenant_id=None, name="Cannot tell", kind="kri", is_active=True)
    theirs = RiskKRI(tenant_id=None, name="Checker's", kind="kri", is_active=True, owner_id=CHECKER)
    db.add_all([stray, theirs])
    db.commit()
    client(db, "maker").get("/erm/kris")
    db.expire_all()
    assert (db.get(RiskKRI, stray.id).tenant_id, db.get(RiskKRI, theirs.id).tenant_id) == (None, 1), \
        "two tenants: only a KRI whose people say whose it is"


# ── 6. limits frozen into the approved version ───────────────────────────────

def test_6_approving_a_statement_freezes_its_limits_and_a_later_change_needs_a_second_person(db):
    k = kri(db)
    config = limit(db, "operational", tolerance=10, limit_kri_ids=[k.id])
    over = risk(db, "Ledger outage", 12)
    maker, checker = client(db, "maker"), client(db, "checker")
    approved = approve_statement(db)
    assert approved["limits"]["operational"] == {
        "appetite_level": "moderate", "max_acceptable_score": 20, "tolerance_threshold": 10, "limit_kri_ids": [k.id],
        "escalation_owner_id": OWNER, "concentration_limit": None}

    edited = maker.put(f"/erm/appetite/{config.id}", json={"tolerance_threshold": 15, "description": "Wider"})
    assert edited.status_code == 200, edited.text
    db.refresh(config)
    assert (config.tolerance_threshold, config.description) == (10, "Wider"), "the approved limit stays in force"
    assert maker.put(f"/erm/appetite/{config.id}/kris", json={"kri_ids": []}).status_code == 200
    db.refresh(config)
    assert config.limit_kri_ids == [k.id]
    assert config.limit_change["changes"] == {"tolerance_threshold": 15, "limit_kri_ids": []}, "one proposal, both changes"
    assert told(db, CHECKER), "the approvers hear of it"
    [row] = maker.get("/erm/appetite/with-stats").json()
    assert (row["limit_change"]["status"], row["limit_change"]["proposed_by_name"]) == ("pending", "Maker")
    assert row["limits_source"] == {"version": 1, "state": "as_approved"}
    assert [b.risk_id for b in open_breaches(db)] == [over.id], "still measured against 10"

    path = f"/erm/appetite/{config.id}/limit-change"
    assert maker.post(f"{path}/approve", json={}).status_code == 409
    decided = checker.post(f"{path}/approve", json={"note": "ALCO"})
    assert decided.status_code == 200, decided.text
    db.refresh(config)
    assert (config.tolerance_threshold, config.limit_kri_ids, config.limit_change["status"]) == (15, [], "approved")
    assert open_breaches(db) == [], "the approved limit is applied at once"
    [row] = maker.get("/erm/appetite/with-stats").json()
    assert row["limits_source"] == {"version": 1, "state": "changed"}
    assert maker.get("/erm/appetite/statements/current").json()["limits"]["operational"]["tolerance_threshold"] == 10, \
        "the approved version keeps what it approved"

    gone = maker.delete(f"/erm/appetite/{config.id}")
    assert gone.status_code == 202, "removing a limit is a proposal too"
    assert db.query(RiskAppetiteConfig).count() == 1
    assert checker.post(f"{path}/reject", json={"note": "Keep it"}).status_code == 200
    assert db.query(RiskAppetiteConfig).count() == 1


# ── 7. reject a plan ─────────────────────────────────────────────────────────

def test_7_a_plan_is_rejected_with_a_note_by_someone_other_than_its_author(db):
    limit(db)
    risk(db, "Ledger outage", 12)
    maker, checker = client(db, "maker"), client(db, "checker")
    maker.post("/erm/appetite/check")
    [breach] = open_breaches(db)
    path = f"/erm/appetite/breaches/{breach.id}"
    maker.post(f"{path}/plan", json={"plan": "Wait for the vendor"})
    assert maker.post(f"{path}/reject-plan", json={"note": "Not a plan"}).status_code == 409
    assert checker.post(f"{path}/reject-plan", json={"note": ""}).status_code == 422
    rejected = checker.post(f"{path}/reject-plan", json={"note": "Name a date"})
    assert rejected.status_code == 200, rejected.text
    assert (rejected.json()["status"], rejected.json()["decision_note"], rejected.json()["decided_by"]) == (
        "open", "Name a date", CHECKER)
    assert maker.post(f"{path}/plan", json={"plan": "Second supplier by March"}).json()["status"] == "plan_proposed"


# ── 8. one open breach per subject ───────────────────────────────────────────

def test_8_one_open_breach_per_subject_even_when_two_checks_race(db, monkeypatch):
    limit(db)
    over = risk(db, "Ledger outage", 12)
    row = dict(tenant_id=1, category="operational", risk_id=over.id, status="open", detected_at=datetime.utcnow())
    db.add_all([RiskAppetiteBreach(**row), RiskAppetiteBreach(**row)])
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    db.add_all([RiskAppetiteBreach(**{**row, "status": "resolved"}), RiskAppetiteBreach(**{**row, "status": "resolved"})])
    db.commit()

    real = appetite._breaching

    def racing(db_, config):
        hits = real(db_, config)
        db_.execute(insert(RiskAppetiteBreach).values(**row))      # the other check opened it a moment earlier
        return hits

    monkeypatch.setattr(appetite, "_breaching", racing)
    checked = client(db, "maker").post("/erm/appetite/check")
    assert checked.status_code == 200, checked.text
    assert [b.risk_id for b in open_breaches(db)] == [over.id]


# ── 9. detection on risk create ──────────────────────────────────────────────

def test_9_a_risk_created_over_its_limit_is_in_the_breach_log_at_once(db):
    limit(db)
    made = client(db, "maker").post("/erm/risks", json={"title": "Ledger outage", "category": "operational",
                                                         "inherent_likelihood": 4, "inherent_impact": 4})
    assert made.status_code == 201, made.text
    assert [b.risk_id for b in open_breaches(db)] == [made.json()["id"]]
    assert told(db, OWNER), "the escalation owner hears of it"


# ── 10. one rule for appetite and reports ────────────────────────────────────

def test_10_appetite_and_reports_read_a_risk_the_same_way(db):
    limit(db)
    risk(db, "Fully mitigated", 0)
    old = risk(db, "Old import", None, inherent_score=16)
    db.query(Risk).filter_by(id=old.id).update({"risk_category": None})
    db.commit()
    http = client(db, "maker")
    on_page = {b["risk_id"] for b in http.get("/erm/appetite/breaches").json()["breaches"]}
    in_report = {b["risk_id"] for b in http.get("/erm/reports/executive-dashboard").json()["appetite_breaches"]}
    assert on_page == in_report == {old.id}, "a residual 0 is a score; a risk with no risk_category falls back to its category"


# ── 11. the concentration limit on the page ──────────────────────────────────

def test_11_the_third_party_concentration_limit_is_in_the_page_data_and_follows_the_approval(db):
    config = limit(db, "third_party", tolerance=12, concentration_limit=3)
    http = client(db, "maker")
    [row] = http.get("/erm/appetite/with-stats").json()
    assert row["concentration_limit"] == 3
    approve_statement(db)
    http.put(f"/erm/appetite/{config.id}", json={"concentration_limit": 5})
    [row] = http.get("/erm/appetite/with-stats").json()
    assert (row["concentration_limit"], row["limit_change"]["changes"]) == (3, {"concentration_limit": 5})


# ── 12. plan handoffs ────────────────────────────────────────────────────────

def test_12_a_proposed_plan_reaches_the_approvers_and_the_decision_its_author(db):
    limit(db)
    risk(db, "Ledger outage", 12)
    owner, checker = client(db, "owner"), client(db, "checker")
    checker.post("/erm/appetite/check")
    before = {uid: len(told(db, uid)) for uid in (MAKER, CHECKER, OWNER)}
    [breach] = open_breaches(db)
    planned = owner.post(f"/erm/appetite/breaches/{breach.id}/plan", json={"plan": "Second supplier by March"})
    assert planned.status_code == 200, planned.text
    assert (len(told(db, MAKER)), len(told(db, CHECKER)), len(told(db, OWNER))) == (
        before[MAKER] + 1, before[CHECKER] + 1, before[OWNER]), "the approvers, not the author"
    assert checker.post(f"/erm/appetite/breaches/{breach.id}/approve-plan", json={"note": "Go"}).status_code == 200
    assert len(told(db, OWNER)) == before[OWNER] + 1, "the author hears the decision"
    assert "approved" in told(db, OWNER)[-1].lower()
