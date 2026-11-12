"""Third-party risk where it feeds the enterprise Risk Register, and the ways round its lifecycle.

A TPRA score (0–100) reaches the register on the register's own 1–25 scale, in the band of its TPRA rating, with a
likelihood and impact whose product is the score; a promoted finding lands in the band of its severity. Completing an
offboarding closes what the supplier put in the register. An edit cannot set the status, scores or rating; a new
vendor starts on the intake path. A finding a questionnaire raises gets its Issue at once, of its domain's category.
The dashboard counts what its tiles say. In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Issue, Risk, Role, Tenant, TPRAApproval, TPRAAuditLog, TPRAFinding, TPRAMonitoringSignal, TPRAQuestion,
    TPRAQuestionResponse, UserRole, Vendor, VendorAssessment, get_db,
)
from grc.models._11_enterprise_risk_management import risk_priority_for_score
from grc.modules.vendor_risk import lifecycle as legacy_lifecycle
from grc.modules.vendor_risk.routers import lifecycle, vendors as vendor_routes
from grc.modules.vendor_risk.tpra import dashboard, intake, service, stages
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS, score_to_tier, to_erm_scale
from grc.routers.auth_router import require_auth

ADMIN, OWNER = 70, 7
DEFAULTS = {"critical": 75.0, "high": 50.0, "medium": 25.0}
BANK = {"critical": 80.0, "high": 60.0, "medium": 30.0}          # a tenant's own thresholds


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", is_active=True) for uid in (ADMIN, OWNER)])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def _api(db):
    app = FastAPI()
    app.include_router(vendor_routes.router, prefix="/vendor-risk")
    app.include_router(dashboard.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    return TestClient(app)


def _vendor(db, name="Payroll Co", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", "owner_id": OWNER,
                  "data_access_level": "internal", "data_types_accessed": [], **kw})
    db.add(v)
    db.commit()
    return v


def _scored(db, v, level, answer, domain="cybersecurity", critical=False):
    """General's assessment tiered at `level` on every factor (0–4) and scored on one question."""
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    service.run_tiering(db, v, a, actor_id=ADMIN, factors={k: level for k in FACTOR_KEYS})
    q = TPRAQuestion(tenant_id=1, template_id=1, question_key=f"q{a.id}", text=f"Control {a.id}", domain=domain,
                     qtype="yes_no", weight=1.0, critical_control=critical)
    db.add(q)
    db.flush()
    db.add(TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=q.id, question_key=q.question_key,
                                answer=answer))
    db.flush()
    service.run_scoring(db, v, a, actor_id=ADMIN)
    db.commit()
    return a


# ── 1. the 0–100 → 1–25 mapping ──────────────────────────────────────────────

@pytest.mark.parametrize("thresholds", [DEFAULTS, BANK])
def test_every_tpra_score_lands_in_the_register_band_of_its_tpra_band(thresholds):
    last = 0
    for tenth in range(0, 1001):
        score = tenth / 10
        likelihood, impact, erm = to_erm_scale(score, thresholds)
        assert 1 <= likelihood <= 5 and 1 <= impact <= 5 and erm == likelihood * impact
        assert risk_priority_for_score(erm) == score_to_tier(score, thresholds), score
        assert erm >= last, f"{score} ranks below a lower score"                 # a worse score never reads better
        last = erm
    assert to_erm_scale(100.0, thresholds)[2] == 25 and to_erm_scale(0.0, thresholds)[2] == 1


def test_an_unscored_vendor_stays_unscored_and_a_rating_beyond_its_score_sets_the_band():
    assert to_erm_scale(None, DEFAULTS) is None
    # a failed critical control floors the rating at high whatever the score: the register says high too
    assert risk_priority_for_score(to_erm_scale(10.0, DEFAULTS, "high")[2]) == "high"
    assert risk_priority_for_score(to_erm_scale(10.0, DEFAULTS, "HIGH")[2]) == "high"
    assert to_erm_scale(40.0, DEFAULTS, "not-a-band") == to_erm_scale(40.0, DEFAULTS)


def test_scoring_publishes_the_register_scale_with_likelihood_and_impact(db):
    v = _vendor(db)
    a = _scored(db, v, 4, "No")                       # every factor at its worst: inherent 100, nothing reduces it
    risk = db.get(Risk, a.linked_risk_id)
    assert a.inherent_score == 100.0 and a.residual_rating == "critical"
    assert (risk.inherent_likelihood, risk.inherent_impact, risk.inherent_score) == (5, 5, 25)
    assert risk.residual_score == risk.residual_likelihood * risk.residual_impact <= 25
    assert risk_priority_for_score(risk.residual_score) == "critical"

    w = _vendor(db, "Low Co", website="low.example")
    b = _scored(db, w, 1, "Yes")                      # inherent 25 (medium), the control halves it: low
    low = db.get(Risk, b.linked_risk_id)
    assert b.residual_rating == "low" and risk_priority_for_score(low.residual_score) == "low"
    assert risk_priority_for_score(low.inherent_score) == "medium" and low.residual_score <= low.inherent_score
    assert "TPRA scores (0–100): inherent 25" in low.description


# ── 2. a promoted finding ────────────────────────────────────────────────────

@pytest.mark.parametrize("severity", ["critical", "high", "medium", "low"])
def test_a_promoted_finding_lands_in_the_band_of_its_severity(db, severity):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, domain="cybersecurity", severity=severity,
                    title="No MFA on the admin console", status="open")
    db.add(f)
    db.commit()
    risk = db.get(Risk, service.promote_finding_to_register(db, f, actor_id=ADMIN))
    assert risk_priority_for_score(risk.residual_score) == severity
    assert risk.residual_score == risk.residual_likelihood * risk.residual_impact
    assert risk.inherent_score == risk.residual_score
    assert risk.source_reference == f"vendor:{v.id}/tpra_finding:{f.id}"


# ── 3. offboarding closes the register entries ───────────────────────────────

def test_completing_offboarding_closes_the_vendors_register_entries_and_only_its_own(db):
    v = _vendor(db)
    a = _scored(db, v, 2, "No")
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, domain="legal", severity="high",
                    title="No audit rights", status="open")
    db.add(f)
    db.commit()
    promoted = service.promote_finding_to_register(db, f, actor_id=ADMIN)
    other = Risk(tenant_id=1, title="Vendor 1x's", category="third_party", status="open",
                 source_reference=f"vendor:{v.id}0/vendor_assessment:1")          # vendor 10, not vendor 1
    db.add(other)
    db.commit()
    admin = db.get(GRCUser, ADMIN)
    lifecycle.begin_offboarding(v.id, lifecycle.OffboardIn(reason="Contract ended"), db=db, current_user=admin)
    items = lifecycle.get_offboarding(v.id, db=db, current_user=admin)["items"]
    lifecycle.update_offboarding(v.id, lifecycle.OffboardingUpdate(items=[{**i, "done": True} for i in items]),
                                 db=db, current_user=admin)
    assert db.get(Risk, a.linked_risk_id).status == "open"                       # starting it closes nothing yet
    lifecycle.complete_offboarding(v.id, db=db, current_user=admin)
    db.expire_all()
    for rid in (a.linked_risk_id, promoted):
        risk = db.get(Risk, rid)
        assert (risk.status, risk.closure_status, risk.closed_by) == ("closed", "closed", ADMIN)
        assert risk.closed_at is not None and "offboarding of Payroll Co was completed" in risk.closure_notes
    assert db.get(Risk, other.id).status == "open"


# ── 4. an edit cannot move the status, scores or rating ──────────────────────

def test_an_edit_cannot_set_the_status_scores_or_rating(db):
    web = _api(db)
    v = _vendor(db, status="suspended", tier="high", inherent_risk_score=70.0, residual_risk_score=55.0,
                risk_rating="high")
    for body in ({"status": "active"}, {"residual_risk_score": 10.0}, {"risk_rating": "low"},
                 {"inherent_risk_score": 20.0}, {"name": "Payroll Co Ltd", "status": "active"}):
        r = web.put(f"/vendor-risk/vendors/{v.id}", json=body)
        assert r.status_code == 400 and "cannot be edited" in r.json()["detail"], body
    db.expire_all()
    assert (v.name, v.status, v.residual_risk_score, v.risk_rating) == ("Payroll Co", "suspended", 55.0, "high")
    # sent back as they stand they are no change, and the rest of the edit saves
    same = web.put(f"/vendor-risk/vendors/{v.id}", json={"status": "suspended", "risk_rating": "high", "notes": "Hi"})
    assert same.status_code == 200 and same.json()["notes"] == "Hi"
    # an edit may take a supplier out of use: suspend it (on the audit trail) or offboard it (the lifecycle's own)
    w = _vendor(db, "Mail Co", website="mail.example")
    assert web.put(f"/vendor-risk/vendors/{w.id}", json={"status": "suspended"}).json()["status"] == "suspended"
    held = db.query(TPRAAuditLog).filter_by(vendor_id=w.id, action="suspend").one()
    assert (held.from_value, held.to_value, held.actor_id) == ("active", "suspended", ADMIN)
    assert web.put(f"/vendor-risk/vendors/{v.id}", json={"status": "offboarded"}).json()["status"] == "offboarded"
    assert web.put(f"/vendor-risk/vendors/{v.id}", json={"status": "suspended"}).status_code == 400   # nor undo an exit


# ── 5. a new vendor starts on the intake path ────────────────────────────────

def test_a_new_vendor_starts_in_intake_whatever_the_client_sends(db):
    web = _api(db)
    r = web.post("/vendor-risk/vendors", json={"name": "Acme Cloud", "status": "active"})
    assert r.status_code == 201, r.text
    got = r.json()
    assert (got["status"], got["intake_status"], got["tier"], got["inherent_risk_score"]) == (
        "onboarding", "in_review", "medium", None)                                 # medium: the untiered placeholder
    # a tier sent is only a starting value: still not tiered, still in intake (the tiering gate sets the tier)
    low = web.post("/vendor-risk/vendors", json={"name": "Low Co", "status": "active", "tier": "low"}).json()
    assert (low["status"], low["tier"], low["inherent_risk_score"]) == ("onboarding", "low", None)
    db.query(Vendor).filter_by(id=low["id"]).delete()
    db.commit()
    assert [x["name"] for x in web.get("/vendor-risk/vendors").json()["items"]] == ["Acme Cloud"]   # in the register
    v = db.get(Vendor, got["id"])
    intake.set_status(v, "approved")                  # what an approval of General's assessment does (tpra/api.py)
    assert v.status == "active"


# ── 6. a questionnaire finding gets its Issue at once ────────────────────────

def test_a_finding_the_questionnaire_raises_gets_its_issue_with_its_domains_category(db):
    v = _vendor(db)
    a = _scored(db, v, 4, "No", domain="data_privacy")
    found = db.query(TPRAFinding).filter_by(assessment_id=a.id, source="assessment").one()
    issue = db.get(Issue, found.linked_issue_id)
    assert (issue.source_type, issue.source_id, issue.issue_type, issue.category) == (
        "tpra_finding", found.id, "vendor_breach", "privacy")
    w = _vendor(db, "Geo Co", website="geo.example")
    b = _scored(db, w, 4, "No", domain="geographic")                                # no fitting category: as before
    assert db.get(Issue, db.query(TPRAFinding).filter_by(assessment_id=b.id).one().linked_issue_id).category == "security"


# ── 7. the dashboard counts what its tiles say ───────────────────────────────

def test_the_dashboard_counts_active_vendors_signals_and_onboarding_as_they_are(db):
    web = _api(db)
    live = _vendor(db, "Live Co")
    for name, status in (("Held Co", "suspended"), ("Leaving Co", "offboarded"), ("New Co", "onboarding")):
        _vendor(db, name, status=status)
    old = _vendor(db, "Old Co", created_at=datetime.utcnow() - timedelta(days=200))
    a = service.ensure_active_assessment(db, live, actor_id=ADMIN)
    b = service.ensure_active_assessment(db, old, actor_id=ADMIN)
    db.add_all([TPRAApproval(tenant_id=1, vendor_id=live.id, assessment_id=a.id, decision="approve"),
                # Old Co was approved long ago: re-approving it now is not onboarding it
                TPRAApproval(tenant_id=1, vendor_id=old.id, assessment_id=b.id, decision="approve",
                             created_at=datetime.utcnow() - timedelta(days=190)),
                TPRAApproval(tenant_id=1, vendor_id=old.id, assessment_id=b.id, decision="approve")])
    db.add_all([TPRAMonitoringSignal(tenant_id=1, vendor_id=live.id, signal_type="breach", severity="high",
                                     title=f"Signal {i}", occurred_at=datetime.utcnow(), acknowledged=i >= 15)
                for i in range(20)])
    db.commit()
    kpis = web.get("/vendor-risk/tpra/dashboard").json()["kpis"]
    assert kpis["active_vendors"] == 2                         # Live Co and Old Co: not suspended, offboarded or onboarding
    assert kpis["new_signals"] == 15                           # every unacknowledged one, not the feed's twelve
    assert kpis["onboarded_this_period"] == 1                  # Live Co's first approval; five were created this month
    assert (kpis["critical_coverage"], kpis["critical_count"]) == (None, 0)          # no critical vendors: no figure


# ── 8. one reassessment cadence ──────────────────────────────────────────────

def test_the_legacy_cadence_table_is_the_tpra_one():
    assert legacy_lifecycle.TIER_CADENCE_DAYS == stages.DEFAULT_CADENCE_DAYS
    assert legacy_lifecycle.TIER_CADENCE_DAYS["critical"] == 180
