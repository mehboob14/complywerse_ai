"""The tier earns its keep: it decides what the programme asks of a vendor.

A vendor's tier now chooses its questionnaires, the evidence it must supply,
whose approval it needs and how serious a monitoring signal must be to reopen
it. Change the tier and each of those changes. The facts behind a computed tier
are recorded, so a vendor whose profile moves past them, or who reports a
breach, is due a re-tier; and a tier set by hand needs a justification.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AttentionActivity, AttentionState, Base, Evidence, GRCUser, Role, Tenant, TPRAApproval, TPRAAuditLog,
    TPRAContract, TPRAControlObligation, TPRAEvidenceLink, TPRAFinding, TPRAMonitoringSignal, TPRAQuestion,
    TPRAQuestionResponse, TPRARemediation, TPRARiskAcceptance, TPRARiskSnapshot, TPRAStageInstance,
    TPRATemplateVersion, TPRATieringConfig, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.tpra import api as tpra_api
from grc.modules.vendor_risk.tpra import attention, rbac, service, tier_policy
from grc.modules.vendor_risk.tpra.engine_gates import evaluate_stage_exit
from grc.modules.vendor_risk.tpra.engine_monitoring import should_trigger_reassessment
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, TPRATemplateVersion, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
           TPRATieringConfig, TPRAAuditLog, Evidence, TPRAEvidenceLink, TPRAMonitoringSignal, TPRAApproval,
           TPRAStageInstance, TPRAContract, TPRAControlObligation, TPRARemediation, TPRARiskAcceptance,
           TPRARiskSnapshot, AttentionState, AttentionActivity]
TODAY = datetime.utcnow().date()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="analyst", email="a@x.test", is_active=True),
               GRCUser(id=8, username="ciso", email="c@x.test", is_active=True)])
    s.commit()
    yield s
    s.close()


def _vendor(db, **kw):
    v = Vendor(tenant_id=1, name="Acme Cloud", status="active", owner_id=7, tier=kw.pop("tier", "medium"),
               data_access_level=kw.pop("data_access_level", "internal"),
               data_types_accessed=kw.pop("data_types_accessed", ["contact details"]),
               geographic_locations=kw.pop("geographic_locations", ["UK"]),
               services_provided=kw.pop("services_provided", ["Email delivery"]), **kw)
    db.add(v)
    db.commit()
    return v


def _tiered(db, vendor, tier="high"):
    a = VendorAssessment(tenant_id=1, vendor_id=vendor.id, status="draft", lifecycle_status="active")
    db.add(a)
    db.commit()
    service.run_tiering(db, vendor, a, actor_id=7)
    a.inherent_tier = vendor.tier = tier               # whatever the engine said, the test decides
    db.commit()
    return a


def _policy(db, **tiers):
    row = TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                            tier_policy=tier_policy.clean(tiers, tier_policy.merged({})))
    db.add(row)
    db.commit()


# ── the policy ───────────────────────────────────────────────────────────────

def test_a_policy_patch_is_checked_before_it_is_kept():
    base = tier_policy.merged({})
    changed = tier_policy.clean({"critical": {"evidence": ["pen_test"], "approver_role": "  CISO ",
                                              "reassess_on": "low"}}, base)
    assert changed["critical"] == {"template_ids": [], "evidence": ["pen_test"], "approver_role": "CISO",
                                   "reassess_on": "low"}
    assert changed["low"] == base["low"]
    for bad in ({"extreme": {}}, {"high": {"evidence": ["a hunch"]}}, {"high": {"reassess_on": "whenever"}},
                {"high": {"template_ids": ["seven"]}}, {"high": {"colour": "red"}}):
        with pytest.raises(ValueError):
            tier_policy.clean(bad, base)


def test_the_tier_chooses_the_questionnaires(db):
    sig_core = VendorQuestionnaireTemplate(tenant_id=1, name="SIG Core", questions=[])
    privacy = VendorQuestionnaireTemplate(tenant_id=1, name="Privacy & DPA", questions=[])
    custom = VendorQuestionnaireTemplate(tenant_id=1, name="Our own", questions=[])
    db.add_all([sig_core, privacy, custom])
    db.commit()
    policy = tier_policy.merged({})
    # nothing chosen: the built-in suggestions for the tier, where the tenant has them
    assert [t.name for t in tier_policy.templates_for(db, 1, "high", policy)] == ["SIG Core", "Privacy & DPA"]
    policy = tier_policy.merged({"high": {"template_ids": [custom.id]}})
    assert [t.name for t in tier_policy.templates_for(db, 1, "high", policy)] == ["Our own"]


def test_changing_the_tier_changes_what_is_asked(db):
    vendor = _vendor(db)
    a = _tiered(db, vendor, tier="medium")
    config = service.get_tiering_config(db, 1)
    medium = tier_policy.requirements(db, vendor, a, config)
    service.record_tier_override(db, vendor, a, "critical", "Now processes payment card data", 7)
    db.commit()
    critical = tier_policy.requirements(db, vendor, a, config)
    assert [e["kind"] for e in medium["evidence"]] == ["assurance_report"]
    assert len(critical["evidence"]) == 5 and critical["cadence_days"] < medium["cadence_days"]
    assert (medium["reassess_on"], critical["reassess_on"]) == ("high", "medium")


# ── the evidence the tier asks for ───────────────────────────────────────────

def test_evidence_counts_only_when_tagged_and_in_date(db):
    vendor = _vendor(db)
    soc2 = Evidence(tenant_id=1, name="SOC 2", status="approved", expiry_date=datetime.utcnow() + timedelta(days=90))
    old_pen = Evidence(tenant_id=1, name="Pen test 2023", status="approved", expiry_date=datetime(2024, 1, 1))
    loose = Evidence(tenant_id=1, name="Untagged policy", status="approved")
    db.add_all([soc2, old_pen, loose])
    db.flush()
    db.add_all([TPRAEvidenceLink(tenant_id=1, vendor_id=vendor.id, evidence_id=soc2.id, requirement="assurance_report"),
                TPRAEvidenceLink(tenant_id=1, vendor_id=vendor.id, evidence_id=old_pen.id, requirement="pen_test"),
                TPRAEvidenceLink(tenant_id=1, vendor_id=vendor.id, evidence_id=loose.id)])
    db.commit()
    status = {e["kind"]: e for e in tier_policy.evidence_status(db, vendor, ["assurance_report", "pen_test", "dpa"])}
    assert status["assurance_report"]["satisfied"] is True
    assert status["pen_test"]["satisfied"] is False and status["pen_test"]["items"][0]["expired"] is True
    assert status["dpa"] == {"kind": "dpa", "label": tier_policy.EVIDENCE_KINDS["dpa"], "items": [], "satisfied": False}


def test_the_stage_gates_hold_the_vendor_to_its_tier(db):
    vendor = _vendor(db)
    a = _tiered(db, vendor, tier="high")
    db.add(VendorQuestionnaireTemplate(tenant_id=1, name="SIG Core", questions=[]))
    db.commit()
    planning = evaluate_stage_exit("dd_planning", service.build_stage_context(db, vendor, a, "dd_planning"))
    assert any("Send the questionnaires this tier requires: SIG Core" in b for b in planning["blockers"])
    answering = evaluate_stage_exit("questionnaire", service.build_stage_context(db, vendor, a, "questionnaire"))
    assert any("Evidence this tier requires is missing" in b and "penetration" in b.lower()
               for b in answering["blockers"])


# ── approval authority and monitoring scope ──────────────────────────────────

def test_a_critical_vendor_needs_an_approver_with_the_tiers_role(db):
    ciso = Role(tenant_id=1, name="CISO")
    db.add(ciso)
    db.flush()
    db.add(UserRole(tenant_id=1, user_id=8, role_id=ciso.id))
    db.commit()
    policy = tier_policy.merged({"critical": {"approver_role": "CISO"}})
    analyst, head = db.get(GRCUser, 7), db.get(GRCUser, 8)
    assert "CISO role" in tier_policy.approver_problem(db, analyst, "critical", policy)
    assert tier_policy.approver_problem(db, head, "critical", policy) is None
    assert tier_policy.approver_problem(db, analyst, "high", policy) is None          # no role set for high
    assert tier_policy.approver_problem(db, analyst, "critical", policy, is_admin=True) is None


def test_the_approval_route_enforces_the_tiers_approver(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(rbac, "_is_admin_or_primary", lambda *a, **k: False)
    _policy(db, critical={"approver_role": "CISO"})
    vendor = _vendor(db, tier="critical")
    a = VendorAssessment(tenant_id=1, vendor_id=vendor.id, status="reviewed", inherent_tier="critical",
                         residual_score=30.0, residual_rating="medium", lifecycle_status="active")
    db.add(a)
    db.commit()
    app = FastAPI()
    app.include_router(tpra_api.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    refused = TestClient(app).post(f"/tpra/assessments/{a.id}/approvals", json={"decision": "approve"})
    assert refused.status_code == 403 and "CISO role" in refused.json()["detail"]


@pytest.mark.parametrize("signal,severity,threshold,expected", [
    ("breach", "low", "critical", True),       # a breach always reopens
    ("rating", "medium", "medium", True),      # a critical vendor is reopened by a medium signal
    ("rating", "high", "critical", False),     # a low vendor is not reopened by a high one
    ("rating", "critical", "critical", True),
    ("rating", "high", "high", True),
])
def test_how_serious_a_signal_must_be_follows_the_tier(signal, severity, threshold, expected):
    assert should_trigger_reassessment(signal, severity, threshold) is expected


# ── keeping the tier true ────────────────────────────────────────────────────

def test_a_vendor_whose_facts_move_past_its_tier_is_due_a_re_tier(db):
    vendor = _vendor(db)
    a = _tiered(db, vendor)
    assert tier_policy.retier_reasons(db, vendor, a) == []
    a.tiering_basis = {**a.tiering_basis, "at": (datetime.utcnow() - timedelta(days=30)).isoformat()}

    vendor.data_access_level = "restricted"
    vendor.data_types_accessed = ["contact details", "card data"]
    vendor.geographic_locations = ["UK", "India"]
    vendor.services_provided = ["Email delivery", "Payment processing"]
    db.add(TPRAMonitoringSignal(tenant_id=1, vendor_id=vendor.id, signal_type="breach", severity="high",
                                title="Breach", occurred_at=datetime.utcnow() - timedelta(days=2)))
    db.commit()
    reasons = tier_policy.retier_reasons(db, vendor, a)
    assert reasons[:4] == ["data access went from internal to restricted", "now handles card data",
                           "now operates in india", "the services it provides have changed"]
    assert reasons[4].startswith("a breach was reported on")

    item = next(i for i in attention.open_items(db, 1, TODAY, {}) if i["condition"] == "retier_needed")
    assert item["vendor_name"] == "Acme Cloud" and "card data" in item["title"]

    service.run_tiering(db, vendor, a, actor_id=7)                 # re-tiered: the basis moves on
    db.commit()
    assert tier_policy.retier_reasons(db, vendor, a) == []


def test_a_tier_computed_before_bases_were_kept_is_left_alone(db):
    vendor = _vendor(db)
    a = VendorAssessment(tenant_id=1, vendor_id=vendor.id, inherent_tier="high", lifecycle_status="active")
    db.add(a)
    db.commit()
    vendor.data_access_level = "regulated"
    assert tier_policy.retier_reasons(db, vendor, a) == []


def test_a_tier_set_by_hand_is_justified_audited_and_queued(db):
    vendor = _vendor(db)
    a = _tiered(db, vendor, tier="medium")
    service.record_tier_override(db, vendor, a, "high", "Supplier to our payments platform", 7)
    db.commit()
    assert a.tier_override["computed"] == "medium" and a.tier_override["to"] == "high" and vendor.tier == "high"
    audit = db.query(TPRAAuditLog).filter(TPRAAuditLog.action == "override").one()
    assert (audit.from_value, audit.to_value, audit.reason) == ("medium", "high", "Supplier to our payments platform")
    item = next(i for i in attention.open_items(db, 1, TODAY, {}) if i["condition"] == "tier_overridden")
    assert item["badge"] == "Medium → High"

    # a second override keeps what the engine originally said
    service.record_tier_override(db, vendor, a, "critical", "Board asked for the closest oversight", 7)
    assert a.tier_override["computed"] == "medium"


def test_editing_a_tiered_vendors_tier_needs_a_reason(db, monkeypatch):
    from grc.modules.vendor_risk.routers import vendors as vendor_routes
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    vendor = _vendor(db, inherent_risk_score=40.0)
    _tiered(db, vendor, tier="medium")
    app = FastAPI()
    app.include_router(vendor_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    http = TestClient(app)
    assert http.put(f"/vendors/{vendor.id}", json={"tier": "low"}).status_code == 400
    done = http.put(f"/vendors/{vendor.id}", json={"tier": "low", "tier_justification": "Only sends newsletters now"})
    assert done.status_code == 200, done.text
    assert db.query(TPRAAuditLog).filter(TPRAAuditLog.action == "override").count() == 1
