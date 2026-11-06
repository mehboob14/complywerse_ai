"""Third-party risk settings: real roles and people, and the tenant's own words.

Approvers, escalation and contract contacts are chosen from roles and people
that exist. A tenant adds its own onboarding questions of any answer type, in
its own sections, rewords or hides the built-in ones and adds to the built-in
choices; a question's answer can raise a tiering factor (built-in or the
tenant's own) and a yes can ask the supplier for evidence (built-in or the
tenant's own type). What a question points at must exist, what is taken out is
archived with its answers kept, and a saved question keeps its answer type.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Role, Tenant, TPRAAuditLog, TPRAEvidenceLink, TPRATieringConfig, Vendor,
    VendorAssessment, get_db,
)
from grc.modules.vendor_risk.tpra import api as tpra_api
from grc.modules.vendor_risk.tpra import customisation, intake, rbac, tier_policy
from grc.modules.vendor_risk.tpra.bootstrap import get_tiering_config
from grc.modules.vendor_risk.tpra.engine_tiering import compute_inherent_tier
from grc.routers.auth_router import require_auth

ENGAGEMENTS = [dict(o) for o in intake.QUESTIONS["engagement_type"]["options"]]
CUSTOM = {
    "factors": [{"key": "c_reputation", "label": "Reputational impact"}],
    "evidence": [{"key": "c_pci_aoc", "label": "PCI DSS attestation of compliance"}],
    "evidence_builtin": {"financials": {"hidden": True}},
    "sections": [{"key": "c_payments", "title": "Payments"}],
    "builtin": {
        "nda_signed": {"hidden": True},
        "purpose": {"label": "What will they do for us?"},
        "personal_data": {"evidence": "dpa"},
        "engagement_type": {"options": ENGAGEMENTS + [{"label": "Consultancy"}]},
    },
    "questions": [
        {"key": "c_card_data", "section": "c_payments", "type": "yes_no", "label": "Will they process card payments?",
         "required": True, "justify": True, "factor": "data_sensitivity", "points": 4, "evidence": "c_pci_aoc"},
        {"key": "c_brands", "section": "c_payments", "type": "multi_choice", "label": "Which card schemes?",
         "show_if": "c_card_data", "factor": "c_reputation",
         "options": [{"value": "visa", "label": "Visa", "points": 1}, {"value": "amex", "label": "Amex", "points": 3}]},
        {"key": "c_contact", "section": "relationship", "type": "text", "label": "Who is their account manager?"},
    ],
}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Acme", slug="acme"), Tenant(id=2, name="Other", slug="other")])
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", display_name="Ana Lyst", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(tpra_api, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(tpra_api.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_settings_offer_the_roles_and_people_that_exist(db, http):
    db.add_all([Role(tenant_id=1, name="Head of Third-Party Risk"), Role(tenant_id=None, name="admin"),
                Role(tenant_id=2, name="Someone else's role"), Role(tenant_id=1, name="  ")])
    db.add(GRCUser(id=8, username="left", email="l@x.test", is_active=False))
    db.commit()
    got = http.get("/tpra/config/directory").json()
    assert got["roles"] == ["admin", "Head of Third-Party Risk"]
    assert got["people"] == [{"id": 7, "name": "Ana Lyst"}]


def test_a_tenants_own_questions_are_asked_scored_and_ask_for_evidence():
    c = customisation.clean(CUSTOM, None)
    sections = {s["key"]: s for s in intake.catalogue(c)["sections"]}
    assert [q["key"] for q in sections["c_payments"]["questions"]] == ["c_card_data", "c_brands"]
    relationship = [q["key"] for q in sections["relationship"]["questions"]]
    assert "nda_signed" not in relationship and relationship[-1] == "c_contact"
    assert next(q for q in sections["relationship"]["questions"] if q["key"] == "purpose")["label"] == "What will they do for us?"
    assert "consultancy" in [o["value"] for o in intake.spec(c)["questions"]["engagement_type"]["options"]]

    cleaned = intake.clean({"c_card_data": "yes", "c_brands": ["amex", "visa", "amex"], "personal_data": "yes"},
                           {"c_card_data": "We take card payments online"}, c)
    assert cleaned["answers"]["c_brands"] == ["amex", "visa"]
    with pytest.raises(ValueError, match="must be chosen from"):
        intake.clean({"c_brands": ["diners"]}, {}, c)
    keys = [p["key"] for p in intake.problems({"answers": {}}, None, c)]
    assert "c_card_data" in keys and "nda_signed" not in keys and "c_brands" not in keys   # asked only after a yes

    scores, why = intake.factors(cleaned, c)
    assert scores["data_sensitivity"] == 4 and scores["c_reputation"] == 3
    assert "Which card schemes: Amex" in why["c_reputation"]
    assert intake.evidence_asked(cleaned, c) == [("dpa", intake.QUESTIONS["personal_data"]["label"]),
                                                  ("c_pci_aoc", "Will they process card payments?")]
    weights = {"data_sensitivity": 0.3, "business_criticality": 0.25, "system_access": 0.2, "regulatory_scope": 0.15,
               "fourth_party": 0.0, "c_reputation": 0.1}
    tiered = compute_inherent_tier(scores, {"weights": weights, "thresholds": {"critical": 75, "high": 50, "medium": 25}})
    assert tiered["contributions"]["c_reputation"] == 7.5 and "c_reputation" in tiered["factors"]


def test_what_a_question_points_at_must_be_there():
    saved = customisation.clean(CUSTOM, None)

    def bad(change, match):
        with pytest.raises(ValueError, match=match):
            customisation.clean(change, saved)

    bad({"questions": [{**CUSTOM["questions"][0], "factor": "c_nothing"}]}, "still used by")
    bad({"questions": [{**CUSTOM["questions"][1], "show_if": "c_contact"}]}, "another yes-or-no question")
    bad({"questions": [{**CUSTOM["questions"][0], "evidence": "financials"}]}, "evidence that is not in use")
    bad({"factors": []}, "Reputational impact' is still used")
    bad({"sections": []}, "Move or remove the questions in the section 'Payments'")
    bad({"questions": [{**CUSTOM["questions"][2], "type": "number"}]}, "add a new question")
    bad({"questions": [{**CUSTOM["questions"][2], "key": "contact"}]}, "must start with c_")
    bad({"guesswork": 1}, "Unknown customisation")

    fewer = customisation.clean({"questions": CUSTOM["questions"][:2]}, saved)
    assert next(q for q in fewer["questions"] if q["key"] == "c_contact")["archived"] is True
    with pytest.raises(ValueError, match="taken off the form"):
        intake.clean({"c_contact": "Sam"}, {}, fewer)
    no_saas = customisation.clean({"builtin": {"engagement_type": {"options": ENGAGEMENTS[1:]}}}, saved)
    saas = next(o for o in no_saas["builtin"]["engagement_type"]["options"] if o["value"] == "saas")
    assert saas["archived"] is True                                    # a built-in option is archived, never dropped


def test_settings_save_the_tenants_factors_questions_and_evidence(db, http):
    weights = {"data_sensitivity": 30, "business_criticality": 25, "system_access": 20, "regulatory_scope": 15,
               "fourth_party": 0, "c_reputation": 10}
    saved = http.put("/tpra/config", json={"customisation": CUSTOM, "weights": weights})
    assert saved.status_code == 200, saved.text
    assert saved.json()["weights"]["c_reputation"] == 0.1
    got = http.get("/tpra/config").json()
    assert got["meta"]["factor_keys"][-1] == "c_reputation" and got["meta"]["factor_labels"]["c_reputation"] == "Reputational impact"
    assert "c_pci_aoc" in got["meta"]["evidence_kinds"] and "financials" not in got["meta"]["evidence_kinds"]
    assert got["customisation"]["questions"][0]["key"] == "c_card_data"
    assert http.put("/tpra/config", json={"tier_policy": {"low": {"evidence": ["c_pci_aoc"]}}}).status_code == 200
    assert http.put("/tpra/config", json={"tier_policy": {"low": {"evidence": ["financials"]}}}).status_code == 400
    assert http.put("/tpra/config", json={"customisation": {"factors": []}}).status_code == 400
    assert db.query(TPRAAuditLog).filter_by(entity="customisation").count() == 1

    # A removed factor leaves the weights; the rest still add up to one.
    http.put("/tpra/config", json={"customisation": {"questions": [CUSTOM["questions"][0], CUSTOM["questions"][2]],
                                                     "factors": []}})
    after = get_tiering_config(db, 1)["weights"]
    assert "c_reputation" not in after and abs(sum(after.values()) - 1) < 0.001


def test_a_yes_asks_the_supplier_for_evidence_and_it_can_be_tagged(db, http):
    http.put("/tpra/config", json={"customisation": CUSTOM})
    v = Vendor(tenant_id=1, name="Payroll Co", status="active", tier="low", owner_id=7,
               intake={"answers": {"c_card_data": "yes", "c_brands": ["visa"]}, "justifications": {}})
    db.add(v)
    db.flush()
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, inherent_tier="low", lifecycle_status="active")
    ev = Evidence(tenant_id=1, name="AoC 2026", status="approved")
    db.add_all([a, ev])
    db.flush()
    link = TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, assessment_id=a.id, evidence_id=ev.id)
    db.add(link)
    db.commit()

    wanted = tier_policy.requirements(db, v, a, get_tiering_config(db, 1))["evidence"]
    assert [(e["kind"], e["satisfied"]) for e in wanted] == [("c_pci_aoc", False)]
    assert "Will they process card payments?" in wanted[0]["because"]
    assert http.patch(f"/tpra/evidence-links/{link.id}", json={"requirement": "financials"}).status_code == 400
    assert http.patch(f"/tpra/evidence-links/{link.id}", json={"requirement": "c_pci_aoc"}).status_code == 200
    assert tier_policy.requirements(db, v, a, get_tiering_config(db, 1))["evidence"][0]["satisfied"] is True

    # The tier was computed with Visa; Amex scores higher, so the tier is due another look.
    a.tiering_basis = tier_policy.basis(v, get_tiering_config(db, 1)["customisation"])
    a.tiering_basis["at"] = datetime.utcnow().isoformat()
    v.intake = {"answers": {"c_card_data": "yes", "c_brands": ["amex"]}, "justifications": {}}
    db.commit()
    assert tier_policy.retier_reasons(db, v, a, get_tiering_config(db, 1)["customisation"]) == [
        "which card schemes changed to Amex"]
