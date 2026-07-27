"""Request context, attribution, and best-effort AI usage persistence."""

from __future__ import annotations

import inspect
import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any, Iterator, Optional
from decimal import Decimal

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AIUsageContext:
    tenant_slug: Optional[str] = None
    actor_user_id: Optional[int] = None
    actor_username: Optional[str] = None
    actor_type: str = "user"
    request_id: Optional[str] = None
    operation_id: Optional[str] = None
    background_job_id: Optional[str] = None
    endpoint: Optional[str] = None
    http_method: Optional[str] = None
    module_key: Optional[str] = None
    feature_key: Optional[str] = None


_context: ContextVar[AIUsageContext] = ContextVar("ai_usage_context", default=AIUsageContext())
_attempts: ContextVar[dict[str, int]] = ContextVar("ai_usage_attempts", default={})

# Mutable per-request holder. Set once by ``AIUsageASGIMiddleware`` inside the
# request's ASGI task, it is copied *by reference* into every downstream context
# — including the threadpool contexts FastAPI uses for sync dependencies and
# sync endpoints. Because it is one shared object, an auth dependency running in
# a worker thread can *mutate* it (``bind_actor``) and the change is visible at
# provider-call time. Re-binding a ContextVar in that thread would be lost (the
# thread gets a *copy* of the context), which is exactly why the older
# ``bind_request_context``-in-a-dependency approach silently recorded nothing.
_request_holder: ContextVar[Optional[dict]] = ContextVar("ai_usage_request_holder", default=None)

# Process-local diagnostics so a mis-wired call path is visible instead of silent.
_dropped_no_tenant = 0


def dropped_event_count() -> int:
    """Number of provider attempts dropped this process for lack of tenant context."""
    return _dropped_no_tenant


def new_request_holder(*, tenant_slug=None, endpoint=None, http_method=None, request_id=None) -> dict:
    return {
        "tenant_slug": tenant_slug,
        "actor_user_id": None,
        "actor_username": None,
        "endpoint": endpoint,
        "http_method": http_method,
        "request_id": request_id or uuid.uuid4().hex,
    }


def bind_tenant(tenant_slug: Any) -> None:
    """Attribute the current request to a tenant.

    Safe from a sync dependency in a threadpool — it mutates the shared holder
    rather than re-binding a ContextVar. Called from the DB dependencies so the
    tenant is present for *any* provider call in the request, no matter how deep
    or which thread it runs on (e.g. ComplyChat's SQL agent, which opens its own
    raw connection and keeps no tenant-bound session near the model call).
    """
    holder = _request_holder.get()
    if holder is not None and tenant_slug and not holder.get("tenant_slug"):
        holder["tenant_slug"] = tenant_slug


def bind_actor(user: Any) -> None:
    """Attribute the authenticated user to the current request.

    Safe to call from a sync dependency running in a threadpool — it mutates the
    shared holder rather than re-binding a ContextVar, so the attribution
    actually reaches the later provider call.
    """
    holder = _request_holder.get()
    if holder is None or user is None:
        return
    if holder.get("actor_user_id") is None and getattr(user, "id", None) is not None:
        holder["actor_user_id"] = getattr(user, "id", None)
    if not holder.get("actor_username") and getattr(user, "username", None):
        holder["actor_username"] = getattr(user, "username", None)


class AIUsageASGIMiddleware:
    """Establish a reliable per-request usage context.

    Must be mounted *inner* to ``TenantMiddleware`` so ``scope['state']`` already
    carries the resolved ``tenant_slug``. Being a pure-ASGI middleware (not
    ``BaseHTTPMiddleware``), the ContextVars it sets propagate into the
    threadpool that runs sync endpoints — the propagation a ``BaseHTTPMiddleware``
    loses, which is why tenant/actor context previously never reached the model
    call and every event was dropped.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        state = scope.get("state") or {}
        headers = {k.decode("latin1").lower(): v.decode("latin1") for k, v in scope.get("headers") or []}
        slug = state.get("tenant_slug") or headers.get("x-tenant-slug")
        holder = new_request_holder(
            tenant_slug=slug,
            endpoint=scope.get("path"),
            http_method=scope.get("method"),
            request_id=headers.get("x-request-id"),
        )
        holder_token = _request_holder.set(holder)
        attempt_token = _attempts.set({})
        try:
            await self.app(scope, receive, send)
        finally:
            _attempts.reset(attempt_token)
            _request_holder.reset(holder_token)


def enabled() -> bool:
    return os.getenv("AI_USAGE_ANALYTICS_ENABLED", "true").strip().lower() not in {
        "0", "false", "no", "off"
    }


def bind_request_context(request: Any, user: Any = None) -> AIUsageContext:
    current = _context.get()
    headers = getattr(request, "headers", {}) or {}
    state = getattr(request, "state", None)
    request_id = headers.get("x-request-id") or current.request_id or uuid.uuid4().hex
    tenant_slug = getattr(state, "tenant_slug", None) or headers.get("x-tenant-slug") or current.tenant_slug
    url = getattr(request, "url", None)
    path = getattr(url, "path", None)
    method = getattr(request, "method", None)
    updated = replace(
        current,
        tenant_slug=tenant_slug,
        actor_user_id=getattr(user, "id", None) if user is not None else current.actor_user_id,
        actor_username=getattr(user, "username", None) if user is not None else current.actor_username,
        request_id=request_id,
        operation_id=current.operation_id or request_id,
        endpoint=path or current.endpoint,
        http_method=method or current.http_method,
    )
    _context.set(updated)
    # The ContextVar write above is lost when this runs in a sync dependency's
    # worker thread; the holder mutations below are what actually survive.
    # Stamp the tenant onto the shared holder so provider calls that never open a
    # tenant DB session (e.g. ComplyChat's /ask uses the global get_db) still
    # resolve a tenant and are not dropped.
    bind_tenant(tenant_slug)
    if user is not None:
        bind_actor(user)
    return updated


@contextmanager
def request_usage_scope(request: Any) -> Iterator[AIUsageContext]:
    token = _context.set(AIUsageContext())
    attempt_token = _attempts.set({})
    try:
        yield bind_request_context(request)
    finally:
        _attempts.reset(attempt_token)
        _context.reset(token)


@contextmanager
def usage_scope(**values: Any) -> Iterator[AIUsageContext]:
    current = _context.get()
    allowed = {k: v for k, v in values.items() if hasattr(current, k) and v is not None}
    token = _context.set(replace(current, **allowed))
    try:
        yield _context.get()
    finally:
        _context.reset(token)


def _callsite_attribution() -> tuple[str, str, str]:
    for frame in inspect.stack()[2:24]:
        filename = frame.filename.replace("\\", "/")
        if (
            "/grc/" not in filename
            or filename.endswith("/services/ai_usage.py")
            or filename.endswith("/grc/config.py")
        ):
            continue
        relative = filename.split("/grc/", 1)[1]
        parts = relative.split("/")
        if parts[0] == "modules" and len(parts) > 1:
            module = parts[1]
        elif parts[0] == "routers":
            stem = parts[-1].removesuffix("_router.py").removesuffix(".py")
            module = {
                "critical_tasks": "tasks",
                "is_projects": "projects",
                "audit_plan": "audit",
                "access_review": "access_review",
                "certification": "certification",
                "dashboard": "dashboard",
            }.get(stem, stem)
        elif parts[0] == "tasks" and len(parts) > 1:
            module = parts[1].removesuffix(".py")
        else:
            module = parts[0].removesuffix(".py")
        feature = frame.function.strip("_") or "provider_call"
        return module[:100], feature[:150], f"{relative}:{frame.lineno}"
    return "unclassified", "provider_call", "unknown"


def _discover_runtime_context(context: AIUsageContext) -> AIUsageContext:
    """Best-effort recovery for sync routes and background workers.

    Explicit context remains authoritative. This fallback only inspects common
    local variable names and never reads prompt/response values.
    """
    values: dict[str, Any] = {}
    for frame in inspect.stack()[2:30]:
        local = frame.frame.f_locals
        request = local.get("request") or local.get("http_request")
        if request is not None:
            state = getattr(request, "state", None)
            headers = getattr(request, "headers", {}) or {}
            values.setdefault("tenant_slug", getattr(state, "tenant_slug", None) or headers.get("x-tenant-slug"))
            values.setdefault("endpoint", getattr(getattr(request, "url", None), "path", None))
            values.setdefault("http_method", getattr(request, "method", None))
        for name in ("current_user", "user", "actor"):
            candidate = local.get(name)
            if candidate is not None and getattr(candidate, "username", None):
                values.setdefault("actor_user_id", getattr(candidate, "id", None))
                values.setdefault("actor_username", getattr(candidate, "username", None))
                break
        for name in ("db", "tenant_db", "session"):
            candidate = local.get(name)
            info = getattr(candidate, "info", None)
            if isinstance(info, dict):
                values.setdefault("tenant_slug", info.get("tenant_slug") or info.get("tenant_schema"))
                values.setdefault("background_job_id", info.get("background_job_id"))
        values.setdefault("tenant_slug", local.get("tenant_slug") or local.get("slug"))
        values.setdefault("actor_user_id", local.get("current_user_id") or local.get("user_id") or local.get("actor_user_id"))
        values.setdefault("actor_username", local.get("username") or local.get("actor_username"))
        values.setdefault("background_job_id", local.get("job_id") or local.get("task_id"))
        values.setdefault("request_id", local.get("request_id"))
        values.setdefault("operation_id", local.get("operation_id"))
    clean = {key: value for key, value in values.items() if value is not None and getattr(context, key) is None}
    return replace(context, **clean) if clean else context


def _usage_value(obj: Any, name: str) -> int:
    value = getattr(obj, name, 0) if obj is not None else 0
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _extract_usage(response: Any, api_family: str) -> dict[str, Any]:
    usage = getattr(response, "usage", None)
    prompt = _usage_value(usage, "prompt_tokens") or _usage_value(usage, "input_tokens")
    completion = _usage_value(usage, "completion_tokens") or _usage_value(usage, "output_tokens")
    total = _usage_value(usage, "total_tokens") or prompt + completion
    prompt_details = getattr(usage, "prompt_tokens_details", None)
    completion_details = getattr(usage, "completion_tokens_details", None)
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": total,
        "cached_tokens": _usage_value(prompt_details, "cached_tokens"),
        "reasoning_tokens": _usage_value(completion_details, "reasoning_tokens"),
        "response_model": getattr(response, "model", None),
        "provider_request_id": getattr(response, "_request_id", None)
        or getattr(response, "request_id", None)
        or getattr(response, "id", None),
        "api_family": api_family,
    }


def _next_attempt(operation_id: str) -> int:
    attempts = dict(_attempts.get())
    attempts[operation_id] = attempts.get(operation_id, 0) + 1
    _attempts.set(attempts)
    return attempts[operation_id]


def _estimate_cost(model: Optional[str], usage: dict[str, Any]) -> tuple[Optional[Decimal], Optional[str]]:
    """Calculate a reproducible estimate from an operator-supplied catalog.

    AI_USAGE_PRICE_CATALOG_JSON shape:
    {"version":"2026-07-15","models":{"gpt-x":{"input_per_million":1,
    "cached_input_per_million":0.1,"output_per_million":4}}}
    """
    raw = os.getenv("AI_USAGE_PRICE_CATALOG_JSON", "").strip()
    if not raw or not model:
        return None, None
    try:
        catalog = json.loads(raw)
        rates = (catalog.get("models") or {}).get(model) or {}
        input_rate = Decimal(str(rates.get("input_per_million", 0)))
        cached_rate = Decimal(str(rates.get("cached_input_per_million", input_rate)))
        output_rate = Decimal(str(rates.get("output_per_million", 0)))
        prompt = Decimal(usage["prompt_tokens"])
        cached = Decimal(usage["cached_tokens"])
        uncached = max(Decimal(0), prompt - cached)
        output = Decimal(usage["completion_tokens"])
        cost = (uncached * input_rate + cached * cached_rate + output * output_rate) / Decimal(1_000_000)
        return cost, str(catalog.get("version") or "operator-configured")[:80]
    except Exception:
        return None, None


def record_provider_attempt(
    *,
    response: Any = None,
    error: Optional[BaseException] = None,
    requested_model: Optional[str] = None,
    provider: str = "openai",
    api_family: str = "chat_completions",
    started_at: Optional[float] = None,
) -> None:
    if not enabled():
        return
    # Precedence: explicit usage_scope() (authoritative — background workers) >
    # the per-request holder (reliable request-path tenant/actor) > best-effort
    # stack inspection (last resort for paths that set neither).
    context = _context.get()
    holder = _request_holder.get()
    if holder:
        context = replace(
            context,
            tenant_slug=context.tenant_slug or holder.get("tenant_slug"),
            actor_user_id=context.actor_user_id if context.actor_user_id is not None else holder.get("actor_user_id"),
            actor_username=context.actor_username or holder.get("actor_username"),
            endpoint=context.endpoint or holder.get("endpoint"),
            http_method=context.http_method or holder.get("http_method"),
            request_id=context.request_id or holder.get("request_id"),
            operation_id=context.operation_id or holder.get("request_id"),
        )
    context = _discover_runtime_context(context)
    if not context.tenant_slug:
        global _dropped_no_tenant
        _dropped_no_tenant += 1
        logger.warning(
            "AI usage event dropped: no tenant context resolved (endpoint=%s, dropped_so_far=%d). "
            "Wrap background/non-request provider calls in usage_scope(tenant_slug=...).",
            context.endpoint, _dropped_no_tenant,
        )
        return
    module, feature, callsite = _callsite_attribution()
    module = context.module_key or module
    feature = context.feature_key or feature
    operation_id = context.operation_id or context.request_id or uuid.uuid4().hex
    usage = _extract_usage(response, api_family)
    billed_model = usage["response_model"] or requested_model
    estimated_cost, pricing_version = _estimate_cost(billed_model, usage)
    duration_ms = max(0, int((time.perf_counter() - (started_at or time.perf_counter())) * 1000))

    try:
        from ..db import open_tenant_session
        from ..models import AIUsageEvent

        db = open_tenant_session(context.tenant_slug)
        try:
            db.add(AIUsageEvent(
                request_id=context.request_id,
                operation_id=operation_id,
                background_job_id=context.background_job_id,
                actor_user_id=context.actor_user_id,
                actor_username=context.actor_username,
                actor_type=context.actor_type,
                module_key=module,
                feature_key=feature,
                attribution_source="explicit" if context.module_key and context.feature_key else "callsite",
                endpoint=context.endpoint,
                http_method=context.http_method,
                provider=provider,
                api_family=usage["api_family"],
                requested_model=requested_model,
                response_model=usage["response_model"],
                provider_request_id=usage["provider_request_id"],
                prompt_tokens=usage["prompt_tokens"],
                completion_tokens=usage["completion_tokens"],
                total_tokens=usage["total_tokens"],
                cached_tokens=usage["cached_tokens"],
                reasoning_tokens=usage["reasoning_tokens"],
                estimated_cost=estimated_cost,
                pricing_version=pricing_version,
                status="failed" if error else "success",
                error_type=type(error).__name__ if error else None,
                duration_ms=duration_ms,
                attempt_number=_next_attempt(operation_id),
                usage_metadata={"callsite": callsite},
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        # Telemetry must never break the product's AI operation.
        return
