from types import SimpleNamespace

import pytest

import grc.services.ai_usage as ai_usage
from grc.services.ai_usage import (
    AIUsageASGIMiddleware,
    AIUsageContext,
    _extract_usage,
    bind_request_context,
    dropped_event_count,
    record_provider_attempt,
    usage_scope,
)


@pytest.fixture(autouse=True)
def _reset_usage_contextvars():
    """Each request/worker starts with a clean context in production; direct
    unit calls to bind_request_context/usage_scope would otherwise leak module
    ContextVar state into the next test (e.g. a stale tenant_slug triggering a
    real DB connect). Reset before every test to mirror per-request isolation.
    """
    ai_usage._context.set(AIUsageContext())
    ai_usage._request_holder.set(None)
    ai_usage._attempts.set({})
    yield


class _Session:
    def __init__(self):
        self.added = []
        self.committed = False
        self.closed = False

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


def _response(prompt=10, completion=4, cached=2, reasoning=1):
    usage = SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        total_tokens=prompt + completion,
        prompt_tokens_details=SimpleNamespace(cached_tokens=cached),
        completion_tokens_details=SimpleNamespace(reasoning_tokens=reasoning),
    )
    return SimpleNamespace(usage=usage, model="gpt-test", id="provider-request-1")


def test_extracts_all_supported_chat_usage_fields():
    usage = _extract_usage(_response(), "chat_completions")
    assert usage == {
        "prompt_tokens": 10,
        "completion_tokens": 4,
        "total_tokens": 14,
        "cached_tokens": 2,
        "reasoning_tokens": 1,
        "response_model": "gpt-test",
        "provider_request_id": "provider-request-1",
        "api_family": "chat_completions",
    }


def test_extracts_anthropic_input_output_usage():
    response = SimpleNamespace(
        usage=SimpleNamespace(input_tokens=7, output_tokens=3),
        model="claude-test",
        id="msg-1",
    )
    usage = _extract_usage(response, "messages")
    assert usage["prompt_tokens"] == 7
    assert usage["completion_tokens"] == 3
    assert usage["total_tokens"] == 10


def test_records_tenant_local_event_without_prompt_or_response(monkeypatch):
    session = _Session()
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: session)
    monkeypatch.setenv("AI_USAGE_ANALYTICS_ENABLED", "true")
    request = SimpleNamespace(
        headers={"x-request-id": "request-1"},
        state=SimpleNamespace(tenant_slug="acme"),
        url=SimpleNamespace(path="/erm/risks/ai-suggest"),
        method="POST",
    )
    bind_request_context(request, SimpleNamespace(id=42, username="analyst"))

    with usage_scope(module_key="erm", feature_key="risk_suggest"):
        record_provider_attempt(response=_response(), requested_model="gpt-requested")

    assert session.committed and session.closed
    event = session.added[0]
    assert event.actor_user_id == 42
    assert event.actor_username == "analyst"
    assert event.module_key == "erm"
    assert event.feature_key == "risk_suggest"
    assert event.total_tokens == 14
    assert event.status == "success"
    assert not hasattr(event, "prompt")
    assert not hasattr(event, "response")


def test_sync_endpoint_deep_call_is_attributed_through_middleware(monkeypatch):
    """Regression: a sync endpoint whose provider call happens deep in a service
    (no db/request/user local in scope) must still record the event with the
    right tenant AND actor. This is the path that silently dropped every event
    before AIUsageASGIMiddleware + the mutable request holder existed, because a
    ContextVar bound in a threadpool dependency never reached the model call.

    Faithful reproduction of FastAPI's execution without TestClient: the
    middleware runs in the request task, while the auth-bind and the provider
    call run in a worker thread with a *copied* context — exactly how FastAPI
    runs sync dependencies and sync endpoints. If attribution relied on
    re-binding a ContextVar in that thread (the old design) it would be lost.
    """
    import asyncio
    import contextvars
    import threading

    session = _Session()
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: session)

    def _run_in_worker_thread(func):
        """Mimic anyio.to_thread: run func in a thread with a copied context."""
        ctx = contextvars.copy_context()
        result = {}
        t = threading.Thread(target=lambda: result.setdefault("v", ctx.run(func)))
        t.start()
        t.join()
        return result.get("v")

    async def fake_app(scope, receive, send):
        # This is the endpoint task. FastAPI would hand sync work to a threadpool:
        def sync_dependency_and_endpoint():
            # (1) auth dependency binds the actor (runs in a worker thread)
            bind_request_context(
                SimpleNamespace(headers={}, state=SimpleNamespace(), url=None, method=None),
                SimpleNamespace(id=7, username="alice"),
            )
            # (2) deep service call — no db/request/user local in scope
            def deep_service():
                record_provider_attempt(response=_response(), requested_model="gpt-4o")
            deep_service()
        _run_in_worker_thread(sync_dependency_and_endpoint)

    scope = {
        "type": "http",
        "path": "/ai",
        "method": "GET",
        "headers": [],
        "state": {"tenant_slug": "acme"},  # placed by TenantMiddleware (outer)
    }
    asyncio.run(AIUsageASGIMiddleware(fake_app)(scope, None, None))

    assert len(session.added) == 1
    event = session.added[0]
    assert event.actor_username == "alice"
    assert event.actor_user_id == 7
    assert event.endpoint == "/ai"
    assert event.total_tokens == 14
    assert event.status == "success"


def test_complychat_style_call_captured_via_auth_stamped_holder(monkeypatch):
    """Regression: an endpoint that never opens a tenant DB (ComplyChat's /ask
    uses the global get_db) and whose usage_scope omits tenant_slug must still be
    captured — the auth dependency stamps the tenant onto the request holder.
    """
    session = _Session()
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: session)

    # 1) ASGI middleware created a holder, but scope state carried no tenant yet.
    ai_usage._request_holder.set(ai_usage.new_request_holder(tenant_slug=None, endpoint="/chatbot/ask"))
    # 2) require_auth runs -> bind_request_context stamps tenant + actor onto it.
    request = SimpleNamespace(headers={}, state=SimpleNamespace(tenant_slug="acme"),
                              url=SimpleNamespace(path="/chatbot/ask"), method="POST")
    bind_request_context(request, SimpleNamespace(id=3, username="analyst"))
    # 3) ComplyChat wraps the call in usage_scope WITHOUT tenant_slug.
    with usage_scope(module_key="complychat", feature_key="vector_rag"):
        record_provider_attempt(response=_response(), requested_model="gpt-4o")

    assert len(session.added) == 1
    event = session.added[0]
    assert event.module_key == "complychat"
    assert event.feature_key == "vector_rag"
    assert event.actor_username == "analyst"
    assert event.total_tokens == 14


def test_provider_call_without_any_tenant_context_is_counted_not_silent():
    before = dropped_event_count()
    record_provider_attempt(response=_response(), requested_model="gpt-4o")
    assert dropped_event_count() == before + 1


def test_records_failed_attempt_without_breaking_caller(monkeypatch):
    session = _Session()
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: session)
    request = SimpleNamespace(
        headers={}, state=SimpleNamespace(tenant_slug="acme"),
        url=SimpleNamespace(path="/test"), method="POST",
    )
    bind_request_context(request, SimpleNamespace(id=1, username="user"))
    record_provider_attempt(error=TimeoutError("secret provider detail"), requested_model="gpt-test")
    event = session.added[0]
    assert event.status == "failed"
    assert event.error_type == "TimeoutError"
    assert "secret" not in (event.usage_metadata or {})

