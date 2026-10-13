"""The result cache: an identical request is answered without another call, never replays a bad answer, never crosses
tenants, and the original values are put back for each caller."""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

import grc.models as m
from grc.services import ai_usage
from grc.services.ai_gateway import cache, engine, registry

from test_ai_governance import PROMPT, SECRET_HOST, SECRET_NAME, events, tenant  # noqa: F401  (the fixture and its helpers)

JSON_REPLY = lambda body: json.dumps({"who": "<PERSON_1>", "host": "<ASSET_1>"})       # noqa: E731


@pytest.fixture
def repeating(tenant, monkeypatch):
    """Calls made here count as the registered, cacheable 'map policy statements' use case."""
    monkeypatch.setattr(engine, "_use_case", lambda site: registry.get("governance.statement_mapping"))
    tenant.reply = JSON_REPLY
    return tenant


def ask(tenant, text=PROMPT, **extra):
    with ai_usage.usage_scope(tenant_slug="zephyr", actor_user_id=1, actor_username="qmarlowe"):
        return tenant.client.chat.completions.create(
            model="gpt-test", response_format={"type": "json_object"}, temperature=0.2,
            messages=[{"role": "user", "content": text}], **extra)


def test_an_identical_request_is_answered_from_the_cache_with_this_callers_own_values(repeating):
    first = ask(repeating)
    assert json.loads(first.choices[0].message.content) == {"who": SECRET_NAME, "host": SECRET_HOST} and len(repeating.bodies) == 1
    again = ask(repeating)
    assert len(repeating.bodies) == 1                                                  # no second call
    assert json.loads(again.choices[0].message.content) == {"who": SECRET_NAME, "host": SECRET_HOST}
    assert again.usage.total_tokens == 0
    miss, hit = events(repeating)
    assert miss.usage_metadata["gateway"]["cache"] == "miss" and miss.total_tokens == 150
    assert hit.usage_metadata["gateway"]["cache"] == "hit" and hit.usage_metadata["gateway"]["saved_tokens"] == 150
    assert hit.total_tokens == 0 and hit.status == "success" and hit.use_case_id == "governance.statement_mapping"


def test_the_same_prompt_about_someone_else_hits_and_is_restored_for_that_someone(repeating):
    with repeating.factory() as s:                                       # another person the guard knows as a user
        s.add(m.GRCUser(id=2, username="asiddiqui", email="a@zephyr.test", display_name="Amina Siddiqui"))
        s.commit()
        from grc.services.ai_gateway import dictionary as dictionaries
        dictionaries.get = lambda slug, d=dictionaries.build(s): d
    ask(repeating, PROMPT)
    out = ask(repeating, PROMPT.replace(SECRET_NAME, "Amina Siddiqui"))             # the model sees <PERSON_1> both times
    assert len(repeating.bodies) == 1
    assert json.loads(out.choices[0].message.content)["who"] == "Amina Siddiqui"


def test_what_is_kept_is_encrypted_and_holds_no_original_value(repeating):
    ask(repeating)
    with repeating.factory() as s:
        row = s.query(m.AIResultCache).one()
        assert row.response_enc.startswith("enc:v1:") and row.use_case_id == "governance.statement_mapping" and row.tokens == 150
        assert SECRET_NAME not in row.response_enc and SECRET_HOST not in row.response_enc
        assert (row.expires_at - row.created_at) > timedelta(days=6)               # 168 hours for this use case


def test_a_different_prompt_model_or_setting_asks_the_model_again(repeating):
    ask(repeating)
    ask(repeating, PROMPT + " One more fact.")
    ask(repeating, PROMPT, top_p=0.5)
    with ai_usage.usage_scope(tenant_slug="zephyr"):
        repeating.client.chat.completions.create(model="gpt-other", response_format={"type": "json_object"}, temperature=0.2,
                                                 messages=[{"role": "user", "content": PROMPT}])
    assert len(repeating.bodies) == 4


def test_a_bad_answer_is_never_replayed(repeating):
    repeating.reply = lambda body: "not json at all"
    ask(repeating)
    ask(repeating)
    assert len(repeating.bodies) == 2                                                  # JSON was asked for and not given
    repeating.reply = lambda body: ""
    ask(repeating, PROMPT + " again")
    ask(repeating, PROMPT + " again")
    assert len(repeating.bodies) == 4


def test_usable_judges_the_whole_answer():
    def chat(content, finish="stop", tool_calls=None):
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish, message=SimpleNamespace(content=content, tool_calls=tool_calls))])
    asked_json = {"response_format": {"type": "json_object"}}
    assert cache.usable("chat", chat('{"a": 1}'), asked_json) and cache.usable("chat", chat('```json\n{"a": 1}\n```'), asked_json)
    assert not cache.usable("chat", chat('{"a": 1}', finish="length"), asked_json)
    assert not cache.usable("chat", chat("   "), {}) and not cache.usable("chat", chat("{oops"), asked_json)
    assert not cache.usable("chat", chat("x", tool_calls=[object()]), {}) and cache.usable("chat", chat("plain words"), {})
    done = SimpleNamespace(status="completed", output=[], output_text='{"a": 1}')
    assert cache.usable("responses", done, {"text": {"format": {"type": "json_object"}}})
    assert not cache.usable("responses", SimpleNamespace(status="incomplete", output=[], output_text="x"), {})


def test_an_expired_entry_is_asked_again_and_the_operator_can_stop_the_cache(repeating, monkeypatch):
    ask(repeating)
    with repeating.factory() as s:
        row = s.query(m.AIResultCache).one()
        row.expires_at = datetime.utcnow() - timedelta(seconds=1)
        s.commit()
    ask(repeating)
    assert len(repeating.bodies) == 2
    monkeypatch.setenv("AI_RESULT_CACHE", "off")
    ask(repeating)
    assert len(repeating.bodies) == 3


def test_only_use_cases_marked_repeatable_are_cached_and_never_while_the_guard_is_not_protecting(tenant, monkeypatch):
    tenant.reply = JSON_REPLY
    ask(tenant)
    ask(tenant)
    assert len(tenant.bodies) == 2                                                     # not a registered use case: never cached
    monkeypatch.setattr(engine, "_use_case", lambda site: registry.get("governance.statement_mapping"))
    monkeypatch.setenv("AI_GATEWAY_MODE", "monitor")
    ask(tenant)
    ask(tenant)
    assert len(tenant.bodies) == 4
    with tenant.factory() as s:
        assert s.query(m.AIResultCache).count() == 0


def test_the_responses_api_is_cached_too(repeating):
    import httpx
    from openai import OpenAI

    calls = []

    def handler(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "resp_1", "object": "response", "created_at": 0, "status": "completed", "model": "gpt-test",
            "output": [{"type": "message", "id": "msg_1", "status": "completed", "role": "assistant",
                        "content": [{"type": "output_text", "text": JSON_REPLY(None), "annotations": []}]}],
            "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
            "usage": {"input_tokens": 100, "output_tokens": 20, "total_tokens": 120,
                      "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}})

    client = OpenAI(api_key="t", base_url="http://mock.invalid/v1", http_client=httpx.Client(transport=httpx.MockTransport(handler)))

    def call():
        with ai_usage.usage_scope(tenant_slug="zephyr"):
            return client.responses.create(model="gpt-test", input=PROMPT, text={"format": {"type": "json_object"}})
    first, again = call(), call()
    assert len(calls) == 1
    assert json.loads(again.output_text) == {"who": SECRET_NAME, "host": SECRET_HOST} and again.usage.total_tokens == 0


def test_the_cache_is_per_tenant(repeating, monkeypatch):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    ask(repeating)
    other = sessionmaker(bind=create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool))
    m.Base.metadata.create_all(other.kw["bind"])
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: other() if slug == "other" else repeating.factory())
    with ai_usage.usage_scope(tenant_slug="other"):
        repeating.client.chat.completions.create(model="gpt-test", response_format={"type": "json_object"}, temperature=0.2,
                                                 messages=[{"role": "user", "content": PROMPT}])
    assert len(repeating.bodies) == 2                                                  # a second tenant's identical text is not served from the first's


def test_the_cost_figures_count_repeats_cache_hits_retries_and_reasoning(tenant):
    from grc.modules.ai_governance import service

    now = datetime.utcnow()

    def event(minutes, digest, *, prompt=1000, completion=200, reasoning=0, cached=0, cache=None, attempt=1, saved=None):
        report = {"decision": "allowed", "hash": digest, **({"cache": cache} if cache else {}), **({"saved_tokens": saved} if saved else {})}
        return m.AIUsageEvent(module_key="governance", feature_key="_ai_match", actor_username="q", provider="openai", status="success",
                              prompt_tokens=prompt, completion_tokens=completion, total_tokens=prompt + completion, reasoning_tokens=reasoning,
                              cached_tokens=cached, attempt_number=attempt, occurred_at=now - timedelta(minutes=minutes),
                              use_case_id="governance.statement_mapping", usage_metadata={"gateway": report})

    with tenant.factory() as s:
        s.add_all([
            event(50, "aaaa", reasoning=120, cached=500),
            event(40, "aaaa"),                                    # the same prompt again and not from the cache: a repeat
            event(30, "aaaa", prompt=0, completion=0, cache="hit", saved=1200),
            event(20, "bbbb", attempt=2),                         # a retry
            event(10, None),                                      # older than the hash: measured on fewer calls
        ])
        s.commit()
        t = service.overview(s, 30)["totals"]
    assert (t["calls"], t["input_tokens"], t["output_tokens"], t["reasoning_tokens"], t["cached_tokens"]) == (5, 4000, 800, 120, 500)
    assert (t["cache_hits"], t["saved_tokens"], t["repeat_calls"], t["repeat_tokens"]) == (1, 1200, 1, 1200)
    assert (t["retries"], t["with_hash"]) == (1, 4)
