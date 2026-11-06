"""Administration → AI Governance: every call is in the tenant's ledger with the prompt as it was sent, an administrator
can find and read it, and nobody else can."""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from openai import OpenAI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.config  # noqa: F401  (installs the shim)
import grc.models as m
from grc.modules.ai_governance import service
from grc.modules.ai_governance.router import router
from grc.routers.admin_router import get_current_tenant_user, get_tenant_db
from grc.services import ai_usage
from grc.services.ai_gateway import dictionary as dictionaries
from grc.services.ai_gateway import ledger

SECRET_NAME, SECRET_HOST = "Quentin Marlowe", "XQ-LEDGER-77"
PROMPT = f"{SECRET_NAME} reported that {SECRET_HOST} at 172.16.99.41 was breached. password=hunter-ZX81-canary!"


@pytest.fixture
def tenant(monkeypatch):
    """A tenant database in memory that ``open_tenant_session`` hands out, a client over a mock transport, and the guard
    knowing the tenant's names."""
    monkeypatch.setenv("SESSION_SECRET", "a-test-secret-for-the-ledger")
    monkeypatch.delenv("AI_GATEWAY_MODE", raising=False)
    monkeypatch.delenv("AI_PAYLOAD_RETENTION_DAYS", raising=False)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as s:
        s.add(m.Tenant(id=1, name="Zephyrion Holdings", slug="zephyr", primary_contact_email="boss@zephyr.test"))
        s.add(m.GRCUser(id=1, username="qmarlowe", email="q@zephyr.test", display_name=SECRET_NAME))
        s.add(m.ITAsset(id=1, tenant_id=1, name=SECRET_HOST, asset_type="server"))
        s.commit()
        d = dictionaries.build(s)
    monkeypatch.setattr(dictionaries, "get", lambda slug: d)
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: factory())

    state = SimpleNamespace(factory=factory, bodies=[], reply=lambda body: "<PERSON_1> must isolate <ASSET_1>")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        state.bodies.append(body)
        return httpx.Response(200, json={
            "id": "c1", "object": "chat.completion", "created": 0, "model": "gpt-test",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": state.reply(body)}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 120, "completion_tokens": 30, "total_tokens": 150}})

    state.client = OpenAI(api_key="test", base_url="http://mock.invalid/v1", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    return state


def ask(tenant):
    with ai_usage.usage_scope(tenant_slug="zephyr", actor_user_id=1, actor_username="qmarlowe", module_key="erm", feature_key="generate_ai_treatment_plan"):
        return tenant.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": PROMPT}])


def events(tenant):
    with tenant.factory() as s:
        return s.query(m.AIUsageEvent).order_by(m.AIUsageEvent.id).all()


def test_a_call_keeps_the_prompt_as_it_was_sent_and_the_answer_as_the_model_wrote_it(tenant):
    out = ask(tenant)
    assert out.choices[0].message.content == f"{SECRET_NAME} must isolate {SECRET_HOST}"       # the caller still gets its values
    (event,) = events(tenant)
    assert event.status == "success" and event.total_tokens == 150 and event.actor_username == "qmarlowe"
    assert event.use_case_id is None or isinstance(event.use_case_id, str)
    assert event.usage_metadata["gateway"]["decision"] == "allowed" and event.usage_metadata["gateway"]["entities"]
    with tenant.factory() as s:
        shown = ledger.reveal(s, event.id)
        row = s.query(m.AICallPayload).one()
        raw = row.request_enc + row.response_enc
    assert SECRET_NAME not in raw and "hunter" not in raw and raw.startswith("enc:v1:")           # encrypted at rest
    for text in (shown["request"], shown["response"]):
        assert SECRET_NAME not in text and SECRET_HOST not in text and "hunter-ZX81" not in text and "172.16.99.41" not in text
    assert "<PERSON_1>" in shown["request"] and "<REMOVED_SECRET>" in shown["request"]
    assert shown["response"] == "<PERSON_1> must isolate <ASSET_1>"                                 # before the originals went back
    assert shown["truncated"] is False


def test_nothing_is_kept_when_the_operator_stops_it_or_the_guard_is_not_protecting(tenant, monkeypatch):
    monkeypatch.setenv("AI_PAYLOAD_RETENTION_DAYS", "0")
    ask(tenant)
    monkeypatch.delenv("AI_PAYLOAD_RETENTION_DAYS")
    monkeypatch.setenv("AI_GATEWAY_MODE", "monitor")                                              # the prompt would be the original
    ask(tenant)
    assert len(events(tenant)) == 2
    with tenant.factory() as s:
        assert s.query(m.AICallPayload).count() == 0


def test_a_refused_call_is_in_the_ledger_with_the_reason_and_no_text(tenant):
    from grc.services.ai_gateway.errors import AIBlocked

    with ai_usage.usage_scope(tenant_slug="zephyr"), pytest.raises(AIBlocked):
        tenant.client.chat.completions.create(model="gpt-test", messages=[{"role": "user", "content": [
            {"type": "text", "text": "read this"}, {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]}])
    (event,) = events(tenant)
    assert event.error_type == "AIBlocked" and event.usage_metadata["gateway"]["blocked"] == "vision_blocked" and tenant.bodies == []
    with tenant.factory() as s:
        assert s.query(m.AICallPayload).count() == 0


def test_what_is_past_its_time_is_removed_and_cannot_be_revealed(tenant):
    ask(tenant)
    with tenant.factory() as s:
        row = s.query(m.AICallPayload).one()
        event_id, row.expires_at = row.event_id, datetime.utcnow() - timedelta(seconds=1)
        s.commit()
        assert ledger.reveal(s, event_id) is None
        assert ledger.purge(s) == 1
        s.commit()
        assert s.query(m.AICallPayload).count() == 0


# ── what the administrator sees ─────────────────────────────────────────────────────────────────────────────────
def seed_ledger(factory):
    now = datetime.utcnow()
    with factory() as s:
        def add(**kw):
            base = dict(module_key="erm", feature_key="x", actor_username="qmarlowe", provider="openai", status="success",
                        prompt_tokens=10, completion_tokens=5, total_tokens=15, occurred_at=now, usage_metadata={})
            base.update(kw)
            s.add(m.AIUsageEvent(**base))
        add(feature_key="generate_ai_treatment_plan", use_case_id="erm.risk_treatment_plan", requested_model="gpt-test",
            usage_metadata={"callsite": "modules/erm/routers/risks.py:3150", "gateway": {"decision": "allowed", "entities": {"PERSON": 2, "IP_PRIV": 1}}},
            estimated_cost=0.002, pricing_version="v1", operation_id="op-1")
        add(feature_key="generate_ai_treatment_plan", use_case_id="erm.risk_treatment_plan", status="failed", error_type="APIConnectionError",
            usage_metadata={"gateway": {"decision": "allowed"}}, operation_id="op-1", attempt_number=2)
        add(module_key="evidence", feature_key="extract_text_with_vision", status="failed", error_type="AIBlocked",
            usage_metadata={"callsite": "modules/evidence/routers/ocr.py:300", "gateway": {"decision": "blocked", "blocked": "vision_blocked", "rule": "B4",
                                                                                              "use_case": "evidence.vision_ocr"}})
        # an older row, from before the guard: found through its call site
        add(feature_key="generate_ai_treatment_plan", usage_metadata={"callsite": "modules/erm/routers/risks.py:3150"},
            occurred_at=now - timedelta(days=3))
        add(module_key="services", feature_key="mystery", usage_metadata={"callsite": "somewhere/unknown.py:1"})
        s.commit()


def test_the_overview_counts_calls_failures_refusals_and_what_was_protected(tenant):
    seed_ledger(tenant.factory)
    with tenant.factory() as s:
        out = service.overview(s, 30)
    t = out["totals"]
    assert (t["calls"], t["failed"], t["blocked"], t["protected"], t["entities"]) == (5, 1, 1, 1, 3)
    assert t["cost_usd"] == pytest.approx(0.002) and t["cost_configured"] is True and t["tokens"] == 75
    by_case = {c["id"]: c for c in out["use_cases"]}
    assert by_case["erm.risk_treatment_plan"]["calls"] == 3                       # two with the use case, one found by call site
    assert by_case["unclassified"]["label"] == "Not in the inventory"
    assert out["recent_blocked"][0]["reason"] == "vision_blocked" and out["recent_blocked"][0]["rule"] == "B4"
    assert {mod["module"] for mod in out["modules"]} == {"erm", "evidence", "services"}


def test_the_inventory_lists_every_use_case_with_its_protection_and_use(tenant):
    seed_ledger(tenant.factory)
    with tenant.factory() as s:
        out = service.inventory(s, 30)
    uses = {u["id"]: u for g in out["modules"] for u in g["use_cases"]}
    assert out["total"] == len(uses) >= 137
    plan = uses["erm.risk_treatment_plan"]
    assert plan["calls"] == 3 and plan["field_policy"] is True and plan["guarded"] is True and plan["level"] == "L2"
    assert plan["last_used"] and plan["trigger_label"] == "On request"
    assert uses["evidence.vision_ocr"]["blocked"] == 1 and uses["complychat.embeddings"]["guarded"] is False
    assert out["unclassified"] == 1


def test_activity_filters_by_module_use_case_status_and_text_and_shows_the_gateway_report(tenant):
    seed_ledger(tenant.factory)
    with tenant.factory() as s:
        assert service.activity(s, status="blocked")["total"] == 1
        assert service.activity(s, status="failed")["total"] == 1
        assert service.activity(s, use_case="erm.risk_treatment_plan")["total"] == 2
        assert service.activity(s, module="evidence")["items"][0]["reason"] == "vision_blocked"
        assert service.activity(s, q="mystery")["total"] == 1
        everything = service.activity(s, days=30)
        assert everything["total"] == 5 and everything["items"][0]["at"] >= everything["items"][-1]["at"]
        first = next(i for i in everything["items"] if i["use_case"] == "erm.risk_treatment_plan" and i["entities"])
        assert first["entities"] == 3 and first["user"] == "qmarlowe" and first["model"] == "gpt-test" and first["cost_usd"] == pytest.approx(0.002)
        assert [i["attempt"] for i in service.trace(s, "op-1")] == [1, 2]


# ── who may see it ──────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def api(tenant):
    seed_ledger(tenant.factory)
    ask(tenant)
    db = tenant.factory()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_tenant_db] = lambda: db
    who = SimpleNamespace(id=1, email="boss@zephyr.test", username="boss")
    app.dependency_overrides[get_current_tenant_user] = lambda: who
    client = TestClient(app)
    client.who, client.db, client.tenant = who, db, tenant
    yield client
    db.close()


def test_the_primary_contact_sees_the_pages_and_can_read_a_prompt_through_a_post(api):
    assert api.get("/admin/ai-governance/overview").json()["totals"]["calls"] == 6
    assert api.get("/admin/ai-governance/inventory").status_code == 200
    rows = api.get("/admin/ai-governance/activity", params={"limit": 100}).json()["items"]
    newest = rows[0]
    detail = api.get(f"/admin/ai-governance/activity/{newest['id']}").json()
    assert detail["payload"]["kept"] is True and detail["payload"]["can_reveal"] is True and "request" not in json.dumps(detail["payload"])
    assert SECRET_NAME not in json.dumps(detail) and detail["gateway"]["decision"] == "allowed"
    assert detail["use_case_detail"] is None or "level" in detail["use_case_detail"]
    shown = api.post(f"/admin/ai-governance/activity/{newest['id']}/reveal").json()
    assert "<PERSON_1>" in shown["request"] and SECRET_NAME not in shown["request"]
    audited = api.db.query(m.AuditLog).filter(m.AuditLog.resource_type == "ai_call").all()           # reading a prompt is on record
    assert len(audited) == 1 and audited[0].resource_id == newest["id"] and "Opened the text of an AI call" in (audited[0].changes or {}).get("summary", "")
    assert api.get("/admin/ai-governance/activity/99999").status_code == 404
    assert api.post("/admin/ai-governance/activity/1/reveal").status_code == 404          # a call with nothing kept


def test_someone_without_the_permission_gets_a_403_and_the_payload_permission_is_separate(api):
    api.who.email = "someone@zephyr.test"                                       # not the primary contact, no roles
    assert api.get("/admin/ai-governance/overview").status_code == 403
    assert api.get("/admin/ai-governance/activity").status_code == 403
    newest = None
    api.who.email = "boss@zephyr.test"
    newest = api.get("/admin/ai-governance/activity").json()["items"][0]["id"]
    api.who.email = "someone@zephyr.test"
    assert api.post(f"/admin/ai-governance/activity/{newest}/reveal").status_code == 403

    db = api.db
    role = m.Role(name="Auditor", tenant_id=1)
    db.add(role)
    view = m.Permission(name="admin:ai_governance:view", resource="admin:ai_governance", action="view")
    db.add(view)
    db.flush()
    db.add(m.UserRole(user_id=api.who.id, role_id=role.id, tenant_id=1))
    db.add(m.RolePermission(role_id=role.id, permission_id=view.id))
    db.commit()
    assert api.get("/admin/ai-governance/overview").status_code == 200              # viewing allowed
    detail = api.get(f"/admin/ai-governance/activity/{newest}").json()
    assert detail["payload"]["kept"] is True and detail["payload"]["can_reveal"] is False   # but not reading the text
    assert api.post(f"/admin/ai-governance/activity/{newest}/reveal").status_code == 403
