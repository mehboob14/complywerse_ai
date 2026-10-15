"""Claude behind the data-protection guard: what is sent, what comes back, what is refused and what is recorded.

The real SDK talks to a mocked wire (tests/_claude_mock.py), so the request it builds and the stream it parses are the
real ones."""
import json
from types import SimpleNamespace

import pytest

import grc.models as m
from grc.services import ai_usage
from grc.services.ai_gateway import claude_client, ledger, registry
from grc.services.ai_gateway.errors import AIBlocked

from _claude_mock import Wire, error, reply
from test_ai_governance import PROMPT, SECRET_HOST, SECRET_NAME, events, tenant  # noqa: F401  (the fixture and its helpers)

SYSTEM = "You are a careful policy writer."


@pytest.fixture
def wire(tenant, monkeypatch):
    """``wire(respond)`` makes every call go to ``respond(request body) -> response`` and returns the recorder."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("DOCUMENT_STUDIO_MODEL", raising=False)
    monkeypatch.delenv("ANTHROPIC_REFUSAL_FALLBACK", raising=False)
    monkeypatch.setattr(claude_client, "_fallbacks_rejected", False)

    def install(respond):
        recorder = Wire(respond)
        monkeypatch.setattr(claude_client, "_client", recorder.client)
        return recorder
    return install


def call(**extra):
    with ai_usage.usage_scope(tenant_slug="zephyr", actor_user_id=1, actor_username="qmarlowe"):
        return claude_client.complete(use_case="governance.studio_chat", system=SYSTEM,
                                      messages=[{"role": "user", "content": PROMPT}], **extra)


def test_nothing_is_sent_without_credentials(tenant, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    with pytest.raises(claude_client.ClaudeNotConfigured) as exc:
        call()
    assert "AI is not set up" in str(exc.value) and not claude_client.configured()


def test_the_prompt_leaves_without_the_values_and_the_answer_comes_back_with_them(wire, tenant):
    w = wire(lambda body: reply("<PERSON_1> must isolate <ASSET_1> today.", input_tokens=100, output_tokens=40, cache_read=300, cache_write=50))
    out = call(effort="high", max_tokens=5000)
    assert out.text == f"{SECRET_NAME} must isolate {SECRET_HOST} today." and out.model == "claude-opus-5-5"

    (req,) = w.requests
    sent = json.dumps(req.body)
    for secret in (SECRET_NAME, SECRET_HOST, "172.16.99.41", "hunter-ZX81"):
        assert secret not in sent
    assert "<PERSON_1>" in sent and "Values written like" in json.dumps(req.body["system"])      # the placeholders are explained to the model
    assert (req.body["model"], req.body["max_tokens"], req.body["stream"]) == ("claude-opus-5-5", 5000, True)
    assert req.body["output_config"] == {"effort": "high"} and req.body["cache_control"] == {"type": "ephemeral"}
    assert req.body["fallbacks"] == "default" and req.headers["anthropic-beta"] == claude_client.FALLBACK_BETA

    (event,) = events(tenant)
    assert (event.provider, event.api_family, event.use_case_id, event.status) == ("anthropic", "messages", "governance.studio_chat", "success")
    assert (event.prompt_tokens, event.cached_tokens, event.completion_tokens) == (450, 300, 40)       # input + cache read + cache write
    assert event.usage_metadata["gateway"]["decision"] == "allowed" and event.usage_metadata["gateway"]["effort"] == "high"
    with tenant.factory() as s:
        shown = ledger.reveal(s, event.id)
    assert SECRET_NAME not in json.dumps(shown) and "<PERSON_1>" in json.dumps(shown)                   # the ledger keeps what was sent


def test_a_structured_answer_is_parsed_first_and_restored_string_by_string(wire, tenant):
    """A restored value with a quote in it must not break the JSON."""
    from grc.services.ai_gateway import dictionary as dictionaries

    with tenant.factory() as s:
        s.add(m.GRCUser(id=2, username="ace", email="ace@zephyr.test", display_name='Ann "Ace" Lee'))
        s.commit()
        d = dictionaries.build(s)
    dictionaries.get = lambda slug, d=d: d
    schema = {"type": "object", "properties": {"owner": {"type": "string"}}, "required": ["owner"], "additionalProperties": False}
    w = wire(lambda body: reply(json.dumps({"owner": "<PERSON_1>"})))
    with ai_usage.usage_scope(tenant_slug="zephyr"):
        out = claude_client.complete(use_case="governance.studio_checks", system=SYSTEM, schema=schema,
                                     messages=[{"role": "user", "content": 'The owner is Ann "Ace" Lee.'}])
    assert out.data == {"owner": 'Ann "Ace" Lee'} and json.loads(out.text) == out.data
    assert w.requests[0].body["output_config"]["format"] == {"type": "json_schema", "schema": schema}
    assert 'Ann \\"Ace\\" Lee' not in json.dumps(w.requests[0].body)


def test_a_declined_request_and_a_cut_off_answer_are_reported_in_words_for_the_user(wire, tenant):
    wire(lambda body: reply("", stop="refusal", details={"type": "refusal", "category": "cyber", "explanation": "x"}))
    with pytest.raises(claude_client.ClaudeRefused) as exc:
        call()
    assert exc.value.category == "cyber"

    schema = {"type": "object", "properties": {"a": {"type": "string"}}, "required": ["a"], "additionalProperties": False}
    wire(lambda body: reply('{"a": "cut o', stop="max_tokens"))
    with pytest.raises(claude_client.ClaudeFailed) as cut, ai_usage.usage_scope(tenant_slug="zephyr"):
        claude_client.complete(use_case="governance.studio_checks", system=SYSTEM, schema=schema, messages=[{"role": "user", "content": "x"}])
    assert "too long" in str(cut.value)


def test_errors_name_no_vendor_and_say_whether_to_try_again(wire, tenant):
    for status, kind, retry in ((401, "authentication_error", False), (429, "rate_limit_error", True),
                                (500, "api_error", True), (400, "invalid_request_error", False)):
        wire(lambda body, s=status, k=kind: error(s, "boom", k))
        with pytest.raises(claude_client.ClaudeFailed) as exc:
            call()
        assert exc.value.retryable is retry and not any(w in str(exc.value).lower() for w in ("claude", "anthropic", "opus"))
    assert [e.status for e in events(tenant)] == ["failed"] * 4


def test_a_key_that_is_not_tied_to_a_workspace_sends_the_workspace_the_operator_names(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.delenv("ANTHROPIC_WORKSPACE_ID", raising=False)
    assert "anthropic-workspace-id" not in claude_client._client().default_headers
    monkeypatch.setenv("ANTHROPIC_WORKSPACE_ID", "  wrkspc_test_123 ")
    assert claude_client._client().default_headers["anthropic-workspace-id"] == "wrkspc_test_123"


def test_a_key_that_needs_a_workspace_is_reported_as_a_setup_problem_not_a_problem_with_the_document(wire, tenant):
    wire(lambda body: error(400, "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header."))
    with pytest.raises(claude_client.ClaudeFailed) as exc:
        call()
    assert "need a workspace" in str(exc.value) and "workspace-id" in exc.value.detail and exc.value.retryable is False
    assert not any(w in str(exc.value).lower() for w in ("claude", "anthropic", "opus", "document is very large"))


def test_an_account_that_does_not_accept_the_fallback_is_retried_without_it_and_remembered(wire, tenant):
    def respond(body):
        return error(400, "unknown beta: server-side-fallback") if "fallbacks" in body else reply("fine")
    w = wire(respond)
    assert call().text == "fine"
    assert ["fallbacks" in r.body for r in w.requests] == [True, False] and not claude_client.fallbacks_enabled()
    call()
    assert ["fallbacks" in r.body for r in w.requests] == [True, False, False]


def test_the_fallback_can_be_switched_off_by_the_operator(wire, tenant, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_REFUSAL_FALLBACK", "off")
    w = wire(lambda body: reply("ok"))
    call()
    assert "fallbacks" not in w.requests[0].body and "anthropic-beta" not in w.requests[0].headers


def test_the_guard_refuses_what_cannot_be_made_safe_before_anything_is_sent(wire, tenant):
    w = wire(lambda body: reply("never"))
    with ai_usage.usage_scope(tenant_slug="zephyr"), pytest.raises(AIBlocked) as exc:
        claude_client.complete(use_case="governance.studio_chat", system=SYSTEM, messages=[{"role": "user", "content": [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "AAAA"}},
            {"type": "text", "text": "read this"}]}])
    assert exc.value.code == "vision_blocked"
    assert w.requests == []
    (event,) = events(tenant)
    assert event.error_type == "AIBlocked" and event.use_case_id == "governance.studio_chat"


def test_scf_text_never_leaves(wire, tenant, monkeypatch):
    from grc.services import licence_guard

    def refuse(messages):
        raise licence_guard.LicenceRestrictedContent("SCF")
    monkeypatch.setattr(licence_guard, "assert_llm_safe", refuse)
    w = wire(lambda body: reply("never"))
    with pytest.raises(licence_guard.LicenceRestrictedContent):
        call()
    assert w.requests == []


def test_the_model_can_be_set_by_the_operator_and_the_guard_can_be_switched_to_monitor(wire, tenant, monkeypatch):
    monkeypatch.setenv("DOCUMENT_STUDIO_MODEL", "claude-sonnet-5-5")
    w = wire(lambda body: reply("ok"))
    call()
    assert w.requests[0].body["model"] == "claude-sonnet-5-5"
    monkeypatch.setenv("AI_GATEWAY_MODE", "monitor")
    call()
    assert SECRET_NAME in json.dumps(w.requests[1].body)                  # monitor sends the original: calibration only


def test_the_studio_use_cases_are_guarded_and_registered_without_a_vendor_word():
    for uid in ("governance.studio_chat", "governance.studio_checks", "governance.studio_compare"):
        uc = registry.get(uid)
        assert uc is not None and uc.apis == ("anthropic",) and not uc.outside_shim and uc.level == "L3"
    assert registry.get("erm.ai_risk_template").outside_shim          # the older unguarded path is still reported as such
