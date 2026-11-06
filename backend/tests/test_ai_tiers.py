"""Model classes: a use case that needs little runs on the light model and one that judges long documents on the deep model,
but only once the operator names them, only for a call that used the platform's default model, and never with settings the
new model refuses."""
import pytest

from grc.services import ai_usage
from grc.services.ai_gateway import registry, tiers

from test_ai_governance import PROMPT, events, tenant  # noqa: F401  (the fixture and its helpers)

LIGHT, DEEP = registry.get("evidence.link_picker"), registry.get("evidence.match_clauses")


@pytest.fixture
def classed(tenant, monkeypatch):
    """Calls made here count as ``evidence.link_picker`` (light); the platform default model is ``gpt-test``."""
    monkeypatch.setenv("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-test")
    monkeypatch.delenv("AI_MODEL_LIGHT", raising=False)
    monkeypatch.delenv("AI_MODEL_DEEP", raising=False)
    monkeypatch.setattr(tiers, "_found", lambda: [LIGHT])
    return tenant


def ask(tenant, model="gpt-test", **extra):
    with ai_usage.usage_scope(tenant_slug="zephyr", actor_user_id=1, actor_username="qmarlowe"):
        return tenant.client.chat.completions.create(model=model, messages=[{"role": "user", "content": PROMPT}], **extra)


def test_nothing_changes_until_a_model_is_named(classed):
    ask(classed)
    assert classed.bodies[0]["model"] == "gpt-test"
    assert "tier" not in events(classed)[0].usage_metadata["gateway"]


def test_a_light_use_case_runs_on_the_light_model_and_the_ledger_says_so(classed, monkeypatch):
    monkeypatch.setenv("AI_MODEL_LIGHT", "gpt-light")
    ask(classed)
    assert classed.bodies[0]["model"] == "gpt-light"
    (event,) = events(classed)
    assert event.requested_model == "gpt-light" and event.usage_metadata["gateway"]["tier"] == "light"


def test_only_the_class_with_a_model_named_moves(classed, monkeypatch):
    monkeypatch.setenv("AI_MODEL_DEEP", "gpt-deep")
    ask(classed)
    assert classed.bodies[0]["model"] == "gpt-test"                                    # light, and no light model named
    monkeypatch.setattr(tiers, "_found", lambda: [DEEP])
    ask(classed)
    assert classed.bodies[1]["model"] == "gpt-deep"
    monkeypatch.setattr(tiers, "_found", lambda: [registry.get("governance.statement_mapping")])
    ask(classed)
    assert classed.bodies[2]["model"] == "gpt-test"                                    # standard is never moved


def test_a_call_that_pinned_its_model_keeps_it(classed, monkeypatch):
    monkeypatch.setenv("AI_MODEL_LIGHT", "gpt-light")
    ask(classed, model="gpt-pinned")
    assert classed.bodies[0]["model"] == "gpt-pinned"


def test_reasoning_settings_go_with_a_model_that_refuses_them(classed, monkeypatch):
    monkeypatch.setenv("AI_MODEL_LIGHT", "gpt-4o-mini")
    ask(classed, reasoning_effort="none")
    assert classed.bodies[0]["model"] == "gpt-4o-mini" and "reasoning_effort" not in classed.bodies[0]
    monkeypatch.setenv("AI_MODEL_LIGHT", "gpt-5-mini")
    ask(classed, reasoning_effort="none")
    assert classed.bodies[1]["model"] == "gpt-5-mini" and classed.bodies[1]["reasoning_effort"] == "none"


def test_a_helper_serving_different_classes_stays_standard(classed, monkeypatch):
    monkeypatch.setenv("AI_MODEL_LIGHT", "gpt-light")
    monkeypatch.setenv("AI_MODEL_DEEP", "gpt-deep")
    monkeypatch.setattr(tiers, "_found", lambda: [LIGHT, DEEP])
    assert tiers.tier_of_call() == "standard"
    ask(classed)
    assert classed.bodies[0]["model"] == "gpt-test"


def test_every_listed_class_names_a_real_use_case():
    assert set(registry._TIER) <= {u.id for u in registry.USE_CASES}
    assert set(registry._TIER.values()) <= set(registry.TIERS)
    assert registry.get("evidence.link_picker").tier == "light" and registry.get("governance.statement_mapping").tier == "standard"
