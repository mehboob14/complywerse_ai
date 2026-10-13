"""The canary egress test: through the real SDK and the real shim, nothing sensitive reaches the wire.

A client whose HTTP transport is a mock still passes the class-level shim in grc/config.py, so the request body the
transport receives is exactly what would leave the machine. Unique canary strings (organisation, people, hosts,
addresses, identity numbers, secrets) are put in prompts; the test fails if any of them is in that body, and checks that
the caller still gets its original values back.
"""
import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI, OpenAI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.config  # noqa: F401  (installs the shim)
import grc.models as m
from grc.services import ai_usage
from grc.services.ai_gateway import dictionary as dictionaries
from grc.services.ai_gateway.errors import AIBlocked

CANARIES = {
    "org": "Zephyrion Holdings", "person": "Quentin Marlowe", "email": "quentin.marlowe@zephyrion.example",
    "phone": "+92 321 7654321", "asset": "XQ-LEDGER-77", "ip": "172.16.99.41", "unit": "Obsidian Treasury Desk",
    "pan": "5500 0000 0000 0004", "cnic": "35202-7654321-9", "secret": "hunter-ZX81-canary!", "iban": "PK36SCBL0000001123456702",
}
PROMPT = (f"{CANARIES['person']} of {CANARIES['org']} ({CANARIES['email']}, {CANARIES['phone']}) from the "
          f"{CANARIES['unit']} reported that {CANARIES['asset']} at {CANARIES['ip']} was breached. "
          f"password={CANARIES['secret']} card {CANARIES['pan']} cnic {CANARIES['cnic']} iban {CANARIES['iban']}. "
          "Per NCA ECC, advise on remediation.")


@pytest.fixture
def wire(monkeypatch):
    """The tenant (with the canary people, assets and units), a client over a recording mock transport, and the
    usage records the shim writes."""
    engine_ = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine_)
    with Session(engine_) as s:
        s.add(m.Tenant(id=1, name=CANARIES["org"], slug="zephyr"))
        s.add(m.GRCUser(id=1, username="qmarlowe", email=CANARIES["email"], display_name=CANARIES["person"]))
        s.add(m.ITAsset(id=1, tenant_id=1, name=CANARIES["asset"], asset_type="server"))
        s.add(m.BusinessUnit(id=1, tenant_id=1, name=CANARIES["unit"]))
        s.commit()
        d = dictionaries.build(s)
    monkeypatch.setattr(dictionaries, "get", lambda slug: d)

    state = type("Wire", (), {})()
    state.bodies, state.records, state.reply = [], [], None

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        state.bodies.append((request.content.decode(), body))
        text = state.reply(body) if state.reply else "ok"
        if request.url.path.endswith("/responses"):
            return httpx.Response(200, json={
                "id": "resp_1", "object": "response", "created_at": 0, "status": "completed", "model": "gpt-test",
                "output": [{"type": "message", "id": "msg_1", "status": "completed", "role": "assistant",
                            "content": [{"type": "output_text", "text": text, "annotations": []}]}],
                "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15,
                          "input_tokens_details": {"cached_tokens": 0}, "output_tokens_details": {"reasoning_tokens": 0}}})
        return httpx.Response(200, json={
            "id": "chatcmpl-1", "object": "chat.completion", "created": 0, "model": "gpt-test",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})

    state.client = OpenAI(api_key="test", base_url="http://mock.invalid/v1", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    state.aclient = AsyncOpenAI(api_key="test", base_url="http://mock.invalid/v1", http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(ai_usage, "record_provider_attempt", lambda **kw: state.records.append(kw))
    with ai_usage.usage_scope(tenant_slug="zephyr"):
        yield state


def assert_clean(wire):
    raw, body = wire.bodies[-1]
    sent = json.dumps(body)
    leaked = [name for name, value in CANARIES.items() if value in raw or value in sent]
    assert not leaked, f"reached the wire: {leaked}"


def test_no_canary_reaches_the_wire_and_the_caller_gets_its_values_back(wire):
    wire.reply = lambda body: json.dumps({"who": "<PERSON_1>", "org": "<ORG_1>", "host": "<ASSET_1>", "ip": "<IP_PRIV_1>",
                                         "mail": "<EMAIL_1>", "unit": "<ORG_UNIT_1>", "advice": "Isolate <ASSET_1> now."})
    response = wire.client.chat.completions.create(
        model="gpt-test", response_format={"type": "json_object"}, temperature=0.2,
        messages=[{"role": "system", "content": f"You advise {CANARIES['org']}. Return JSON."}, {"role": "user", "content": PROMPT}])
    assert_clean(wire)
    assert json.loads(response.choices[0].message.content) == {
        "who": CANARIES["person"], "org": CANARIES["org"], "host": CANARIES["asset"], "ip": CANARIES["ip"],
        "mail": CANARIES["email"], "unit": CANARIES["unit"], "advice": f"Isolate {CANARIES['asset']} now."}
    assert "NCA ECC" in wire.bodies[-1][0]                                  # a public name is kept
    record = wire.records[-1]
    assert record["error"] is None and record["gateway"]["decision"] == "allowed" and record["gateway"]["restored"] == 7
    assert record["context"].tenant_slug == "zephyr"
    assert not any(value in json.dumps(record["gateway"]) for value in CANARIES.values())


def test_the_async_client_is_protected_the_same_way(wire):
    wire.reply = lambda body: "<PERSON_1> must act"

    async def run():
        return await wire.aclient.chat.completions.create(
            model="gpt-test", messages=[{"role": "user", "content": PROMPT}])

    response = asyncio.run(run())
    assert_clean(wire)
    assert response.choices[0].message.content == f"{CANARIES['person']} must act"


def test_the_responses_api_is_protected_and_restored_too(wire):
    wire.reply = lambda body: json.dumps({"who": "<PERSON_1>", "host": "<ASSET_1>"})
    response = wire.client.responses.create(model="gpt-test", instructions=f"You advise {CANARIES['org']}.", input=PROMPT)
    assert_clean(wire)
    assert json.loads(response.output_text) == {"who": CANARIES["person"], "host": CANARIES["asset"]}
    assert "NCA ECC" in wire.bodies[-1][0] and wire.bodies[-1][1]["instructions"].startswith("You advise <ORG_1>.")
    assert engine_note() in wire.bodies[-1][1]["instructions"]
    record = wire.records[-1]
    assert record["api_family"] == "responses" and record["gateway"]["api"] == "responses" and record["gateway"]["restored"] == 2

    # a list input (messages with typed parts) and no instructions: the note becomes the instructions
    wire.client.responses.create(model="gpt-test", input=[{"role": "user", "content": [{"type": "input_text", "text": PROMPT}]}])
    assert_clean(wire)
    assert engine_note() in wire.bodies[-1][1]["instructions"] and wire.bodies[-1][1]["input"][0]["content"][0]["type"] == "input_text"


def test_the_responses_api_never_carries_an_image_either(wire):
    with pytest.raises(AIBlocked) as err:
        wire.client.responses.create(model="gpt-test", input=[{"role": "user", "content": [
            {"type": "input_text", "text": "read"}, {"type": "input_image", "image_url": "data:image/png;base64,AAAA"}]}])
    assert err.value.code == "vision_blocked" and wire.bodies == []


def test_the_async_responses_client_is_protected_too(wire):
    wire.reply = lambda body: "<PERSON_1> must act"

    async def run():
        return await wire.aclient.responses.create(model="gpt-test", input=PROMPT)

    response = asyncio.run(run())
    assert_clean(wire)
    assert response.output_text == f"{CANARIES['person']} must act"


def test_the_regulatory_engine_is_protected_without_a_single_change_to_how_it_asks(wire, monkeypatch):
    import openai
    from grc.modules.governance import regulatory_engine as engine

    wire.reply = lambda body: json.dumps({"title": "Circular for <ORG_1>", "reference": "<PERSON_1>"})
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: wire.client)
    schema = {"type": "object", "properties": {"title": {"type": "string"}, "reference": {"type": "string"}},
              "required": ["title", "reference"], "additionalProperties": False}

    data, model = engine.llm_json("You read circulars.", PROMPT, schema, "circular_identity", effort="low")

    assert_clean(wire)
    assert data == {"title": f"Circular for {CANARIES['org']}", "reference": CANARIES["person"]}
    assert wire.records[-1]["api_family"] == "responses" and len(wire.records) == 1       # recorded once, by the shim


def engine_note():
    from grc.services.ai_gateway import engine
    return engine.NOTE


def test_a_retry_of_the_same_prompt_sends_the_same_placeholders(wire):
    for _ in range(2):
        wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])
    assert wire.bodies[0][1]["messages"] == wire.bodies[1][1]["messages"]


def test_an_image_never_reaches_the_wire_and_the_refusal_is_recorded(wire):
    with pytest.raises(AIBlocked) as err:
        wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": [
            {"type": "text", "text": "read this scan"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]}])
    assert err.value.code == "vision_blocked" and wire.bodies == []
    assert isinstance(wire.records[-1]["error"], AIBlocked) and wire.records[-1]["gateway"]["blocked"] == "vision_blocked"


def test_a_refusal_reaches_the_screen_as_one_plain_sentence():
    from grc.main import app

    reply = asyncio.run(app.exception_handlers[AIBlocked](None, AIBlocked("vision_blocked", "AI could not read this file.", rule="B4")))
    assert reply.status_code == 403
    assert json.loads(reply.body) == {"detail": "AI could not read this file.", "code": "ai_blocked", "reason": "vision_blocked"}


def test_a_scanned_file_is_refused_with_a_sentence_not_an_api_error(wire, monkeypatch, tmp_path):
    from fastapi import HTTPException
    from PIL import Image
    from grc.modules.evidence.routers import ocr

    path = tmp_path / "scan.png"
    Image.new("RGB", (20, 20), "white").save(path)
    monkeypatch.setattr(ocr, "get_openai_client", lambda: wire.client)
    with pytest.raises(HTTPException) as err:
        ocr.extract_text_with_vision(str(path), "png")
    assert err.value.status_code == 403 and err.value.detail.startswith("AI could not read this file") and wire.bodies == []


def test_the_policy_parser_stops_at_the_first_refused_page_instead_of_asking_every_model_for_every_page(wire, monkeypatch):
    fitz = pytest.importorskip("fitz")
    from grc.modules.governance.routers import policy_parser

    pdf = fitz.open()
    for _ in range(3):
        pdf.new_page()
    monkeypatch.setattr(policy_parser, "_openai_client", lambda: wire.client)
    assert policy_parser._openai_vision_ocr_pdf(pdf.tobytes()) == ""
    assert wire.bodies == [] and len(wire.records) == 1


def test_a_fault_in_the_guard_refuses_the_call_and_never_sends_the_original(wire, monkeypatch):
    from grc.services.ai_gateway import engine

    def boom(kwargs, mode, api="chat"):
        raise RuntimeError("detector bug")

    monkeypatch.setattr(engine, "begin", boom)
    with pytest.raises(AIBlocked) as err:
        wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])
    assert err.value.code == "gateway_error" and wire.bodies == []


def test_the_operator_levers_monitor_and_off_send_the_original(wire, monkeypatch):
    monkeypatch.setenv("AI_GATEWAY_MODE", "monitor")
    wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])
    assert CANARIES["person"] in wire.bodies[-1][0] and wire.records[-1]["gateway"]["mode"] == "monitor"
    monkeypatch.setenv("AI_GATEWAY_MODE", "off")
    wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])
    assert CANARIES["secret"] in wire.bodies[-1][0] and wire.records[-1]["gateway"] is None
    monkeypatch.setenv("AI_GATEWAY_MODE", "protect")
    wire.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])
    assert_clean(wire)


def test_a_real_feature_is_protected_without_a_single_change_to_its_code(wire, monkeypatch):
    """The risk-suggestion endpoint builds its prompt from what a person typed and calls the SDK directly."""
    from types import SimpleNamespace
    from grc.modules.erm.routers import risks

    wire.reply = lambda body: json.dumps({
        "suggested_description": "Breach of <ASSET_1> reported by <PERSON_1>", "suggested_causes": ["weak control"],
        "suggested_consequences": ["loss"], "suggested_recommendations": ["isolate <ASSET_1>"],
        "recommended_control_ids": [], "suggested_likelihood": 3, "suggested_impact": 4, "risk_treatment_options": ["Mitigate"]})
    monkeypatch.setattr(risks, "get_openai_client", lambda: wire.client)
    monkeypatch.setattr(risks, "get_user_tenants", lambda user, db: [1])
    monkeypatch.setattr(risks, "build_control_registry", lambda db, tenants: ("No controls available", {}))
    request = risks.RiskAISuggestionRequest(name="Ledger breach", category="operational", description=PROMPT)

    out = risks.get_risk_ai_suggestions(request=request, db=None, current_user=SimpleNamespace(id=1, username="qmarlowe"))

    assert_clean(wire)
    assert out.suggested_description == f"Breach of {CANARIES['asset']} reported by {CANARIES['person']}"
    assert out.suggested_recommendations == [f"isolate {CANARIES['asset']}"]
    gateway = wire.records[-1]["gateway"]
    assert gateway["registered"] is True and gateway["use_case"] == "erm.risk_suggest" and gateway["level"] == "L2"
