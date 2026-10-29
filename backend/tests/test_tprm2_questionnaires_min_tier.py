"""An answer to an onboarding question can set a minimum tier (TPRM parity, piece B7, contract C15).

The score still decides the tier, and a picked answer can hold it at medium, high or critical whatever the score says: the
tier is the worse of the score's band and the worst minimum among the answers picked. The engine's result says which
minimum applied and which question set it. A yes can carry a minimum (built-in and own yes-or-no questions), and so can
each option of a choice, built-in or own. In-memory SQLite.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRATieringConfig, Vendor, get_db
from grc.modules.vendor_risk.tpra import customisation, intake, onboarding, rbac, service
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS, compute_inherent_tier, minimum_tier
from grc.routers.auth_router import require_auth

SOURCE = intake.QUESTIONS["source_code"]["label"]
ENGAGEMENTS = [dict(o) for o in intake.QUESTIONS["engagement_type"]["options"]]
LOW = {k: 0 for k in FACTOR_KEYS}


def custom(**builtin):
    """A tenant's settings after the change, as the server stores them."""
    return customisation.clean({"builtin": builtin}, None)


def config(c):
    """The tiering config of a tenant with these settings."""
    return {**DEFAULT_TIERING_CONFIG, "customisation": c}


# ── what the settings accept ─────────────────────────────────────────────────

def test_a_yes_and_each_option_can_carry_a_minimum_and_it_is_kept():
    c = customisation.clean({
        "builtin": {"source_code": {"min_tier": "high"},
                    "engagement_type": {"options": [{**o, **({"min_tier": "critical"} if o["value"] == "outsourcing" else {})}
                                                    for o in ENGAGEMENTS]}},
        "sections": [{"key": "c_pay", "title": "Payments"}],
        "questions": [
            {"key": "c_cards", "section": "c_pay", "type": "yes_no", "label": "Card payments?", "min_tier": "medium"},
            {"key": "c_schemes", "section": "c_pay", "type": "multi_choice", "label": "Which schemes?",
             "options": [{"label": "Visa", "min_tier": "high"}, {"label": "Amex"}]},
            {"key": "c_note", "section": "c_pay", "type": "text", "label": "Anything else?", "min_tier": "high"},
        ],
    }, None)
    assert c["builtin"]["source_code"]["min_tier"] == "high"
    options = {o["value"]: o for o in c["builtin"]["engagement_type"]["options"]}
    assert options["outsourcing"]["min_tier"] == "critical" and "min_tier" not in options["saas"]
    questions = {q["key"]: q for q in c["questions"]}
    assert questions["c_cards"]["min_tier"] == "medium"
    assert [o.get("min_tier") for o in questions["c_schemes"]["options"]] == ["high", None]
    assert "min_tier" not in questions["c_note"]               # a text answer has nothing to pick


@pytest.mark.parametrize("bad", ["low", "urgent", "HIGH ", 3])
def test_only_medium_high_or_critical_is_a_minimum(bad):
    with pytest.raises(ValueError, match="medium, high or critical"):
        customisation.clean({"builtin": {"source_code": {"min_tier": bad}}}, None)
    with pytest.raises(ValueError, match="medium, high or critical"):
        customisation.clean({"sections": [{"key": "c_s", "title": "S"}],
                             "questions": [{"key": "c_q", "section": "c_s", "type": "yes_no", "label": "Q?",
                                            "min_tier": bad}]}, None)


def test_no_minimum_is_the_same_as_leaving_it_out():
    c = customisation.clean({"builtin": {"source_code": {"min_tier": ""}}}, None)
    assert "source_code" not in c["builtin"]
    c = customisation.clean({"builtin": {"engagement_type": {"options": [{**o, "min_tier": None} for o in ENGAGEMENTS]}}}, None)
    assert all("min_tier" not in o for o in c["builtin"]["engagement_type"]["options"])


# ── what an answer does to the tier ──────────────────────────────────────────

def test_the_worst_minimum_among_the_answers_picked_wins_and_names_its_question():
    c = custom(source_code={"min_tier": "high"}, critical_function={"min_tier": "critical"},
               network_access={"min_tier": "medium"})
    nothing = {"answers": {"source_code": "no", "critical_function": "no"}}
    assert minimum_tier(nothing, c) == (None, None)
    assert minimum_tier({"answers": {"source_code": "yes", "network_access": "yes"}}, c) == ("high", SOURCE)
    both = {"answers": {"source_code": "yes", "critical_function": "yes"}}
    assert minimum_tier(both, c) == ("critical", intake.QUESTIONS["critical_function"]["label"])
    assert minimum_tier(None, c) == (None, None) and minimum_tier({"answers": {}}, None) == (None, None)


def test_the_first_question_names_a_tie():
    c = custom(source_code={"min_tier": "high"}, hosts_data={"min_tier": "high"})
    both = {"answers": {"source_code": "yes", "hosts_data": "yes"}}
    # hosts_data comes first on the form
    assert minimum_tier(both, c) == ("high", intake.QUESTIONS["hosts_data"]["label"])


def test_a_choice_counts_the_option_picked_and_a_multiple_choice_the_worst_of_those():
    options = [{**o, **({"min_tier": "high"} if o["value"] == "outsourcing" else {})} for o in ENGAGEMENTS]
    c = custom(engagement_type={"options": options})
    assert minimum_tier({"answers": {"engagement_type": "outsourcing"}}, c)[0] == "high"
    assert minimum_tier({"answers": {"engagement_type": "saas"}}, c) == (None, None)

    c = customisation.clean({"sections": [{"key": "c_s", "title": "S"}], "questions": [
        {"key": "c_schemes", "section": "c_s", "type": "multi_choice", "label": "Which schemes?", "options": [
            {"label": "Visa", "min_tier": "medium"}, {"label": "Amex", "min_tier": "critical"}, {"label": "Local"}]}]}, None)
    assert minimum_tier({"answers": {"c_schemes": ["visa", "local"]}}, c) == ("medium", "Which schemes?")
    assert minimum_tier({"answers": {"c_schemes": ["visa", "amex"]}}, c) == ("critical", "Which schemes?")


def test_a_question_that_is_not_asked_sets_no_minimum():
    c = customisation.clean({
        "sections": [{"key": "c_s", "title": "S"}],
        "questions": [{"key": "c_gate", "section": "c_s", "type": "yes_no", "label": "Do they take cards?"},
                      {"key": "c_pci", "section": "c_s", "type": "yes_no", "label": "Do they store card numbers?",
                       "show_if": "c_gate", "min_tier": "critical"}],
        "builtin": {"source_code": {"min_tier": "high", "hidden": True}},
    }, None)
    answers = {"answers": {"c_gate": "no", "c_pci": "yes", "source_code": "yes"}}
    assert minimum_tier(answers, c) == (None, None)             # c_pci is never asked after a no; source_code is hidden
    answers["answers"]["c_gate"] = "yes"
    assert minimum_tier(answers, c) == ("critical", "Do they store card numbers?")

    removed = customisation.clean({"questions": []}, c)         # taken off the form, answers kept
    assert minimum_tier(answers, removed) == (None, None)


def test_the_tier_is_the_worse_of_the_score_and_the_minimum():
    c = custom(source_code={"min_tier": "high"})
    answers = {"answers": {"source_code": "yes"}}
    held = compute_inherent_tier(LOW, config(c), answers)
    assert (held["tier"], held["minimum_tier"], held["minimum_from"]) == ("high", "high", SOURCE)
    assert held["score"] == 0                                   # the score is what it was: the minimum holds the tier

    critical = compute_inherent_tier({k: 4 for k in FACTOR_KEYS}, config(c), answers)
    assert critical["tier"] == "critical" and critical["minimum_tier"] == "high"      # a minimum never lowers a tier


def test_without_answers_the_keys_are_there_and_empty():
    for result in (compute_inherent_tier(LOW), compute_inherent_tier(LOW, DEFAULT_TIERING_CONFIG, {"answers": {}})):
        assert result["tier"] == "low"
        assert result["minimum_tier"] is None and result["minimum_from"] is None


# ── where the tier is computed ───────────────────────────────────────────────

@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", is_active=True))
    s.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                            customisation=custom(source_code={"min_tier": "high"})))
    s.commit()
    yield s
    s.close()


def test_run_tiering_holds_the_tier_at_the_minimum(db):
    v = Vendor(tenant_id=1, name="Code Shop", status="onboarding", owner_id=7, data_access_level="internal",
               intake={"answers": {"source_code": "yes"}, "justifications": {"source_code": "They write our code"}})
    db.add(v)
    db.commit()
    a = service.ensure_active_assessment(db, v, actor_id=7)
    result = service.run_tiering(db, v, a, actor_id=7)
    db.commit()
    assert result["minimum_tier"] == "high" and result["minimum_from"] == SOURCE
    assert a.inherent_tier == "high" and v.tier == "high"

    v.intake = {"answers": {"source_code": "no"}}
    again = service.run_tiering(db, v, a, actor_id=7)
    assert again["minimum_tier"] is None and a.inherent_tier != "high"


def test_a_tier_set_from_given_factors_ignores_the_answers(db):
    v = Vendor(tenant_id=1, name="Code Shop", status="onboarding", owner_id=7, data_access_level="internal",
               intake={"answers": {"source_code": "yes"}})
    db.add(v)
    db.commit()
    a = service.ensure_active_assessment(db, v, actor_id=7)
    result = service.run_tiering(db, v, a, actor_id=7, factors=LOW)
    assert result["tier"] == "low" and result["minimum_tier"] is None


@pytest.fixture()
def preview(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(onboarding.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_the_live_preview_applies_the_minimum_too(db, preview):
    got = preview.post("/intake/preview", json={"answers": {"source_code": "yes"}})
    assert got.status_code == 200, got.text
    body = got.json()
    assert (body["tier"], body["minimum_tier"], body["minimum_from"]) == ("high", "high", SOURCE)
    assert preview.post("/intake/preview", json={"answers": {"source_code": "no"}}).json()["minimum_tier"] is None
