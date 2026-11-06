"""The guard end to end: what is replaced, what is refused, what is restored, and what the report may say."""
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.services.ai_gateway import dictionary as dictionaries
from grc.services.ai_gateway import engine, patterns, registry
from grc.services.ai_gateway.errors import AIBlocked
from grc.services.ai_usage import usage_scope

PROMPT = ("Ali Raza (ali.raza@acme.example, +92 300 1234567) owns DB-PROD-01 at 10.1.2.3 for Retail Banking. "
          "password=Winter2024! card 4111 1111 1111 1111. Microsoft Windows Server and NCA ECC apply.")


@pytest.fixture
def tenant(monkeypatch):
    engine_ = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine_)
    with Session(engine_) as s:
        s.add(m.Tenant(id=1, name="Acme Bank", slug="acme"))
        s.add(m.GRCUser(id=1, username="araza", email="ali.raza@acme.example", display_name="Ali Raza"))
        s.add(m.GRCUser(id=2, username="mahmed", email="m@acme.example", display_name="محمد أحمد"))
        s.add(m.GRCUser(id=3, username="zmuller", email="z@acme.example", display_name="Zoë Müller"))
        s.add(m.ITAsset(id=1, tenant_id=1, name="DB-PROD-01", asset_type="server", host_name="db-prod-01"))
        s.add(m.BusinessUnit(id=1, tenant_id=1, name="Retail Banking"))
        s.commit()
        d = dictionaries.build(s)
    monkeypatch.setattr(dictionaries, "get", lambda slug: d)
    with usage_scope(tenant_slug="acme"):
        yield d


def kwargs_for(*messages, **extra):
    return {"model": "gpt-test", "messages": list(messages), **extra}


def answer(content, **message):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content, tool_calls=None, function_call=None, **message))])


def test_names_and_identifiers_are_replaced_the_caller_is_untouched_and_the_answer_is_restored(tenant):
    system = {"role": "system", "content": "You are a GRC assistant for Acme Bank."}
    user = {"role": "user", "content": PROMPT}
    kwargs = kwargs_for(system, user, response_format={"type": "json_object"})
    gw = engine.begin(kwargs)

    sent = json.dumps(kwargs["messages"])
    for original in ("Ali Raza", "ali.raza@acme.example", "+92 300 1234567", "DB-PROD-01", "10.1.2.3", "Retail Banking",
                     "Winter2024!", "4111 1111 1111 1111", "Acme Bank"):
        assert original not in sent, original
    for kept in ("Microsoft Windows Server", "NCA ECC"):
        assert kept in sent
    assert "<REMOVED_SECRET>" in sent and "<REMOVED_PAN>" in sent and "<EMAIL_1>" in sent and "<IP_PRIV_1>" in sent
    assert engine.NOTE in kwargs["messages"][0]["content"] and kwargs["messages"][0]["content"].startswith("You are a GRC assistant for <ORG_1>")
    assert system["content"] == "You are a GRC assistant for Acme Bank." and user["content"] == PROMPT      # the caller's own objects

    reply = answer(json.dumps({"owner": "<PERSON_1>", "mail": "<EMAIL_1>", "host": "<ASSET_1>", "ip": "<IP_PRIV_1>",
                               "unit": "<ORG_UNIT_1>", "org": "<ORG_1>", "phone": "<PHONE_1>", "key": "<REMOVED_SECRET>"}))
    gw.finish(reply)
    out = json.loads(reply.choices[0].message.content)
    assert out == {"owner": "Ali Raza", "mail": "ali.raza@acme.example", "host": "DB-PROD-01", "ip": "10.1.2.3",
                   "unit": "Retail Banking", "org": "Acme Bank", "phone": "+92 300 1234567", "key": "<REMOVED_SECRET>"}


def test_the_report_has_counts_and_decisions_but_never_a_value(tenant):
    kwargs = kwargs_for({"role": "user", "content": PROMPT})
    gw = engine.begin(kwargs)
    gw.finish(answer("<PERSON_1> and <PERSON_9>"))
    report = gw.report
    assert report["decision"] == "allowed" and report["mode"] == "protect" and report["tenant"] is True
    assert report["entities"]["PERSON"] >= 1 and report["entities"]["SECRET"] == 1 and report["dropped"] >= 2
    assert report["tokens"] >= 5 and report["restored"] == 1 and report["unknown_tokens"] == 1 and report["registered"] is False
    dumped = json.dumps(report)
    for value in ("Ali Raza", "acme.example", "Winter2024", "4111", "10.1.2.3", "DB-PROD-01"):
        assert value not in dumped


def test_a_prompt_with_nothing_sensitive_goes_unchanged_and_without_a_note(tenant):
    kwargs = kwargs_for({"role": "user", "content": "Summarise ISO 27001 clause A.5.1 for a policy."})
    gw = engine.begin(kwargs)
    assert kwargs["messages"] == [{"role": "user", "content": "Summarise ISO 27001 clause A.5.1 for a policy."}]
    assert gw.report["tokens"] == 0 and "note" not in gw.report


def test_text_parts_tool_calls_and_every_choice_are_covered(tenant):
    call = {"id": "c1", "type": "function", "function": {"name": "lookup", "arguments": json.dumps({"who": "Ali Raza"})}}
    kwargs = kwargs_for({"role": "user", "content": [{"type": "text", "text": "mail ali.raza@acme.example"}]},
                        {"role": "assistant", "content": None, "tool_calls": [call]})
    gw = engine.begin(kwargs)
    sent = json.dumps(kwargs["messages"])
    assert "ali.raza" not in sent and "Ali Raza" not in sent and kwargs["messages"][0]["role"] == "system"
    two = SimpleNamespace(choices=[
        SimpleNamespace(message=SimpleNamespace(content="<EMAIL_1>", tool_calls=None, function_call=None)),
        SimpleNamespace(message=SimpleNamespace(content="x", function_call=None, tool_calls=[
            SimpleNamespace(function=SimpleNamespace(name="f", arguments=json.dumps({"who": "<PERSON_1>"})))]))])
    gw.finish(two)
    assert two.choices[0].message.content == "ali.raza@acme.example"
    assert json.loads(two.choices[1].message.tool_calls[0].function.arguments) == {"who": "Ali Raza"}


def test_names_inside_json_text_are_found_even_when_non_ascii_is_written_as_escapes(tenant):
    payload = json.dumps({"owner": "محمد أحمد", "reviewer": "Zoë Müller", "note": "see \U0001F600 ok"})    # ensure_ascii escapes it all
    assert "\\u0645" in payload and "\\u00eb" in payload and "\\ud83d" in payload
    kwargs = kwargs_for({"role": "user", "content": payload})
    gw = engine.begin(kwargs)
    sent = next(msg["content"] for msg in kwargs["messages"] if msg["role"] == "user")
    assert "\\u0645" not in sent and "\\u00eb" not in sent
    assert json.loads(sent) == {"owner": "<PERSON_1>", "reviewer": "<PERSON_2>", "note": "see \U0001F600 ok"}   # the emoji is untouched
    reply = answer(json.dumps({"who": "<PERSON_1>", "other": "<PERSON_2>"}))
    gw.finish(reply)
    assert json.loads(reply.choices[0].message.content) == {"who": "محمد أحمد", "other": "Zoë Müller"}


def test_unescaping_maps_every_decoded_character_back_to_its_place_in_the_original():
    text = 'a \\u0645 b \\ud83d\\ude00 c'
    decoded, starts = engine._unescape(text)
    assert decoded == "a م b \U0001F600 c"
    assert [text[starts[i]:starts[i + 1]] for i in range(len(decoded))] == ["a", " ", "\\u0645", " ", "b", " ", "\\ud83d\\ude00", " ", "c"]
    assert engine._unescape("no escapes here") is None


def test_a_secret_the_model_makes_up_is_removed_from_the_answer(tenant):
    gw = engine.begin(kwargs_for({"role": "user", "content": "Ali Raza asks for help"}))
    reply = answer("Use AKIAIOSFODNN7EXAMPLE and password=Hunter22! for <PERSON_1>")
    gw.finish(reply)
    text = reply.choices[0].message.content
    assert "AKIA" not in text and "Hunter22" not in text and "Ali Raza" in text
    assert gw.report["invented"] == 2


# ── refusals ────────────────────────────────────────────────────────────────
def test_images_are_never_sent(tenant):
    part = [{"type": "text", "text": "read this"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]
    with pytest.raises(AIBlocked) as err:
        engine.begin(kwargs_for({"role": "user", "content": part}))
    assert err.value.code == "vision_blocked" and err.value.rule == "B4" and err.value.report["decision"] == "blocked"
    assert "OpenAI" not in str(err.value) and "gpt" not in str(err.value).lower()
    blob = "data:application/pdf;base64," + "A" * 2000
    with pytest.raises(AIBlocked):
        engine.begin(kwargs_for({"role": "user", "content": "here: " + blob}))


def test_streaming_cannot_be_checked_and_is_refused(tenant):
    with pytest.raises(AIBlocked) as err:
        engine.begin(kwargs_for({"role": "user", "content": "hi"}, stream=True))
    assert err.value.code == "stream_unsupported"


def test_a_use_case_registered_as_never_public_is_refused(tenant, monkeypatch):
    monkeypatch.setattr(engine, "_use_case", lambda site: registry.get("complychat.format_results"))
    with pytest.raises(AIBlocked) as err:
        engine.begin(kwargs_for({"role": "user", "content": "rows: 1, 2, 3"}))
    assert err.value.code == "restricted_data" and err.value.use_case == "complychat.format_results" and err.value.rule == "B12"


def test_when_the_tenants_names_cannot_be_loaded_the_call_is_refused_not_sent_raw(monkeypatch):
    def broken(slug):
        raise RuntimeError("db down")
    monkeypatch.setattr(dictionaries, "get", broken)
    with usage_scope(tenant_slug="acme"), pytest.raises(AIBlocked) as err:
        engine.begin(kwargs_for({"role": "user", "content": "Ali Raza"}))
    assert err.value.code == "dictionary_unavailable"


def test_a_secret_that_survives_the_replacement_refuses_the_call(tenant, monkeypatch):
    real = patterns.detect_dropped
    monkeypatch.setattr(engine.patterns, "detect_dropped", lambda text: [patterns.Entity("SECRET", 0, 1, "x", "drop", 100)])
    with pytest.raises(AIBlocked) as err:
        engine.begin(kwargs_for({"role": "user", "content": "Ali Raza"}))
    assert err.value.code == "secret_survived" and err.value.rule == "B1" and err.value.report["residual"] == ["SECRET"]
    monkeypatch.setattr(engine.patterns, "detect_dropped", real)


def test_a_message_that_cannot_be_read_refuses_the_call(tenant):
    with pytest.raises(AIBlocked) as err:
        engine.begin({"model": "x", "messages": ["a bare string is not a message"]})
    assert err.value.code == "unscannable_payload"


# ── tenant, level and mode ───────────────────────────────────────────────────
def test_without_a_tenant_only_the_patterns_apply(monkeypatch):
    def never(slug):
        raise AssertionError("no tenant, so no dictionary")
    monkeypatch.setattr(dictionaries, "get", never)
    kwargs = kwargs_for({"role": "user", "content": "Ali Raza <ali.raza@acme.example> uses 10.1.2.3"})
    gw = engine.begin(kwargs)
    sent = kwargs["messages"][0]["content"] if kwargs["messages"][0]["role"] == "user" else kwargs["messages"][1]["content"]
    assert "Ali Raza" in sent and "ali.raza@" not in sent and "10.1.2.3" not in sent
    assert gw.report["baseline_only"] is True and gw.report["tenant"] is False


def test_library_use_cases_skip_the_dictionary_but_not_the_patterns(tenant, monkeypatch):
    def never(slug):
        raise AssertionError("an L0 use case needs no tenant names")
    monkeypatch.setattr(dictionaries, "get", never)
    monkeypatch.setattr(engine, "_use_case", lambda site: registry.get("certification.journey_phases"))
    kwargs = kwargs_for({"role": "user", "content": "Plan ISO 27001 for Ali Raza, mail ali.raza@acme.example"})
    gw = engine.begin(kwargs)
    sent = json.dumps(kwargs["messages"])
    assert "Ali Raza" in sent and "ali.raza@" not in sent and gw.report["level"] == "L0" and gw.report["dictionary_terms"] == 0


def test_monitor_mode_counts_what_it_would_protect_and_sends_the_original(tenant):
    kwargs = kwargs_for({"role": "user", "content": PROMPT})
    gw = engine.begin(kwargs, "monitor")
    assert kwargs["messages"] == [{"role": "user", "content": PROMPT}]
    assert gw.report["mode"] == "monitor" and gw.report["entities"]["SECRET"] == 1 and gw.report["tokens"] == 0
    reply = answer("<PERSON_1>")
    assert gw.finish(reply) is reply and reply.choices[0].message.content == "<PERSON_1>"
    part = [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]
    assert engine.begin(kwargs_for({"role": "user", "content": part}), "monitor").report["vision"] is True     # noted, not refused


def test_the_most_sensitive_use_case_of_a_shared_helper_decides(monkeypatch):
    site = ("services/assessment_evidence_ai.py", "openai_complete", 1)
    assert engine._use_case(site).level == "L3"
    assert engine._use_case(("nowhere.py", "nothing", 1)) is None and engine._use_case(None) is None
