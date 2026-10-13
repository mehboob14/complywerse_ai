"""
Central configuration for the GRC backend.

Single source of truth for environment-driven settings that were previously
read (and defaulted) in many places. Import the values/helpers from here
instead of calling ``os.getenv`` inline, so a default only ever changes in
one spot.

Notes:
- ``.env`` is loaded by ``backend/main.py`` (via ``python-dotenv``) before this
  module is imported, so the values below reflect the environment at startup.
- This module must stay dependency-free (only the stdlib) to avoid import
  cycles — it is imported very early and from many layers.
"""

import os
import time


# ----- Redis / Celery -------------------------------------------------------
# Default Redis (cache / job-status / enrichment client caches) on DB 0;
# Celery broker on DB 1 and result backend on DB 2. Mirrors the historical
# inline defaults exactly.
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/1")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://127.0.0.1:6379/2")


# ----- Client-specific modules ----------------------------------------------
# The audit issue register runs on CFSB's own workbook template, so it is on
# only for the tenants named here (comma-separated slugs). Elsewhere its menu
# entry, API, report datasets and workflow triggers do not exist.
AUDIT_REGISTER_TENANTS = frozenset(
    slug.strip().lower() for slug in os.getenv("AUDIT_REGISTER_TENANTS", "cfsb").split(",") if slug.strip())


# ----- OpenAI ---------------------------------------------------------------
# Default chat-completions model. Centralized so the model can be swapped in a
# single place; mirrors the literal ``"gpt-4o"`` that was inlined across the
# codebase. Behaviour is unchanged — the value is still ``"gpt-4o"``.
DEFAULT_OPENAI_MODEL = "gpt-4o"


def get_openai_api_key() -> str | None:
    """Resolve the OpenAI API key.

    Prefers ``AI_INTEGRATIONS_OPENAI_API_KEY`` and falls back to
    ``OPENAI_API_KEY`` — the dominant resolution order already used across the
    codebase. Returns ``None`` if neither is set (callers degrade gracefully).
    """
    return os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")


def get_openai_model(default: str = DEFAULT_OPENAI_MODEL) -> str:
    """Resolve the OpenAI chat-completions model name.

    Prefers ``AI_INTEGRATIONS_OPENAI_MODEL``, then ``OPENAI_MODEL``, then
    ``default`` — the exact precedence that was previously duplicated inline as
    ``os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o"``.
    """
    return os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or default


# CTEM Validate — the confidence gate. A model suggestion whose confidence is at
# or above this floor is LINKED automatically by the mapping run (reversible: a
# Reject removes it); a weaker one lands as `proposed` for a human to review, so
# a low-confidence guess never silently becomes a link. "high" = only high
# auto-links; "medium" (default) = high+medium; "off"/"none" = nothing auto-links
# (every suggestion waits for review, the pre-gate behaviour).
_VALID_CONF_FLOOR = {"off", "none", "high", "medium", "low"}


def get_ai_autolink_min_confidence() -> str:
    """Confidence floor for auto-linking AI control suggestions (env
    ``AI_AUTOLINK_MIN_CONFIDENCE``: high | medium | low | off). Default medium."""
    v = (os.environ.get("AI_AUTOLINK_MIN_CONFIDENCE") or "medium").strip().lower()
    return v if v in _VALID_CONF_FLOOR else "medium"


def get_openai_base_url() -> str | None:
    """Resolve the OpenAI (or OpenAI-compatible, e.g. ModelFarm) base URL.

    Returns ``AI_INTEGRATIONS_OPENAI_BASE_URL`` or ``None``. This is the bare
    read that was inlined in many client factories; callers keep their own
    error handling and any extra fallbacks (e.g. ``or OPENAI_BASE_URL``).
    """
    # An empty ``AI_INTEGRATIONS_OPENAI_BASE_URL=`` (as .env.example ships it) is
    # "not set": the SDK would otherwise send every request to an empty URL.
    return os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or None


# ----- gpt-5.x / o-series compatibility shim --------------------------------
# The codebase was written for gpt-4o-era chat completions: ~all call sites pass
# ``max_tokens=`` and ``temperature=0.x``. The newer reasoning models
# (gpt-5.x, gpt-6-*, o1/o3/o4) reject both — they require ``max_completion_tokens`` and
# only accept the default ``temperature`` (1). Rather than edit dozens of call
# sites (and risk regressions), we wrap ``Completions.create`` once so legacy
# params are translated transparently *only* for those models. gpt-4o and any
# OpenAI-compatible model are passed through untouched. Idempotent + best-effort
# (a no-op if the openai SDK isn't importable).
#
# A reasoning model's hidden thinking is paid out of the same ``max_completion_tokens`` as its visible
# answer, so a ceiling sized for the answer alone returns nothing when the model thinks first (gpt-5-nano
# answered an 800-token request with an empty string in 2 of 4 tries). The old ``max_tokens`` therefore
# becomes the answer's size *plus* this room to think; it is only a ceiling, so a model that answers
# straight away is not slower or dearer for it.
REASONING_HEADROOM = 4000


def install_openai_compat_shim() -> bool:
    try:
        from openai.resources.chat import completions as _cc  # type: ignore
    except Exception:
        return False

    def _prepare(kwargs):
        model = kwargs.get("model")
        if isinstance(model, str) and model.lower().startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
            if "max_tokens" in kwargs and "max_completion_tokens" not in kwargs:
                asked = kwargs.pop("max_tokens")
                kwargs["max_completion_tokens"] = asked + REASONING_HEADROOM if isinstance(asked, int) else asked
            else:
                kwargs.pop("max_tokens", None)
            if kwargs.get("temperature") not in (None, 1):
                kwargs.pop("temperature", None)
            if model.lower().startswith(("gpt-5", "gpt-6")) and "reasoning_effort" not in kwargs:
                kwargs["reasoning_effort"] = "low"
        return model

    def _record(response=None, error=None, model=None, started_at=None, gw=None, gateway=None, api="chat", payload=None):
        try:
            from .services.ai_usage import record_provider_attempt
            record_provider_attempt(
                response=response, error=error, requested_model=model,
                provider="openai", api_family="responses" if api == "responses" else "chat_completions",
                started_at=started_at,
                context=gw.context if gw is not None else None,
                gateway=gateway if gateway is not None else (gw.report if gw is not None else None),
                payload=payload,
            )
        except Exception:
            pass

    def _answer(gw, response):
        # The model's own words, taken before the guard puts the original values back. Only while the guard protects:
        # otherwise the prompt (and so the answer) is the original text and nothing is kept.
        if gw is None or gw.mode != "protect":
            return None
        try:
            from .services.ai_gateway import ledger
            return ledger.answer_text(response)
        except Exception:
            return None

    def _payload(gw, kwargs, api, answer=None):
        # What an administrator can read later: the prompt exactly as it was sent (kwargs is the guard's rewrite).
        if gw is None or gw.mode != "protect":
            return None
        try:
            from .services.ai_gateway import ledger
            return {"request": ledger.request_snapshot(kwargs, api), "answer": answer}
        except Exception:
            return None

    def _cache_hours(gw):
        # Result cache (services/ai_gateway/cache.py): only for a use case the registry marks repeatable, only while the
        # guard protects (the key is the sanitised prompt) and only for a tenant (the cache lives in its database).
        if gw is None or gw.mode != "protect" or not gw.context.tenant_slug:
            return 0
        try:
            from .services.ai_gateway import cache, registry
            use_case = registry.get(gw.report.get("use_case") or "")
            return use_case.cache_hours if use_case and cache.enabled() else 0
        except Exception:
            return 0

    def _from_cache(gw, kwargs, api):
        if not _cache_hours(gw):
            return None
        try:
            from .services.ai_gateway import cache
            gw.cache_key = cache.make_key(kwargs, api)
            found = cache.lookup(gw.context.tenant_slug, gw.cache_key, api)
            if found is None:
                gw.report["cache"] = "miss"
                return None
            response, tokens = found
            gw.report.update(cache="hit", saved_tokens=tokens)
            return response
        except Exception:
            return None

    def _keep(gw, kwargs, api, response):
        # Called with the answer as the model wrote it, before the original values are put back.
        hours = _cache_hours(gw)
        if not hours or not getattr(gw, "cache_key", None):
            return
        try:
            from .services.ai_gateway import cache
            if cache.usable(api, response, kwargs):
                cache.store(gw.context.tenant_slug, gw.cache_key, gw.report.get("use_case"), api, kwargs.get("model"), response, hours)
        except Exception:
            pass

    def _guard(kwargs, model, api="chat"):
        # Data protection (services/ai_gateway): what must not leave is replaced or the call is refused (AIBlocked)
        # before the prompt goes anywhere. Returns the handle that restores the answer, or None when the guard is
        # off. A fault in the guard itself refuses the call: the original prompt is never sent instead.
        # AI_GATEWAY_MODE: protect (default) | monitor (find and count, send the original) | off (emergency).
        mode = os.environ.get("AI_GATEWAY_MODE", "protect").strip().lower()
        if mode == "off":
            return None
        import logging
        log = logging.getLogger(__name__)
        from .services.ai_gateway.errors import AIBlocked
        try:
            from .services.ai_gateway import engine
            return engine.begin(kwargs, "monitor" if mode == "monitor" else "protect", api)
        except AIBlocked as exc:
            _record(error=exc, model=model, gateway=exc.report, api=api)
            raise
        except Exception as exc:
            blocked = AIBlocked("gateway_error", "AI was not used because the data-protection check could not run.", rule="B13")
            log.exception("the data-protection guard failed; the prompt was not sent")
            _record(error=blocked, model=model, api=api)
            raise blocked from exc

    def _screen(kwargs, api="chat"):
        # Licence gate: refuse any prompt carrying SCF prose before it leaves the
        # process. Imported lazily, like ai_usage, so this module stays importable
        # on its own. LicenceRestrictedContent propagates; anything else the guard
        # raises must not take the model call down with it.
        try:
            from .services.licence_guard import LicenceRestrictedContent, assert_llm_safe
        except Exception:
            return
        try:
            if api == "responses":     # instructions + input are the Responses API's messages
                parts = [kwargs.get("instructions"), kwargs.get("input")]
                assert_llm_safe([{"role": "user", "content": p} for p in parts if isinstance(p, str)])
            else:
                assert_llm_safe(kwargs.get("messages"))
        except LicenceRestrictedContent:
            raise
        except Exception:
            pass

    def _wrap(orig, is_async=False, api="chat"):
        # api: "chat" (chat completions; legacy parameters are translated for reasoning models) or "responses"
        prepare = _prepare if api == "chat" else (lambda kwargs: kwargs.get("model"))
        if is_async:
            async def _patched_async(self, *args, **kwargs):
                _screen(kwargs, api)
                model = prepare(kwargs)
                gw = _guard(kwargs, model, api)
                started_at = time.perf_counter()
                response = _from_cache(gw, kwargs, api)         # the same request answered before: no call
                if response is not None:
                    response = gw.finish(response)
                    _record(response=response, model=model, started_at=started_at, gw=gw, api=api)
                    return response
                try:
                    response = await orig(self, *args, **kwargs)
                except Exception as exc:
                    _record(error=exc, model=model, started_at=started_at, gw=gw, api=api, payload=_payload(gw, kwargs, api))
                    raise
                answer = _answer(gw, response)
                _keep(gw, kwargs, api, response)
                if gw is not None:
                    response = gw.finish(response)
                _record(response=response, model=model, started_at=started_at, gw=gw, api=api,
                        payload=_payload(gw, kwargs, api, answer))
                return response
            _patched_async._grc_compat = True  # type: ignore[attr-defined]
            return _patched_async

        def _patched(self, *args, **kwargs):
            _screen(kwargs, api)
            model = prepare(kwargs)
            gw = _guard(kwargs, model, api)
            started_at = time.perf_counter()
            response = _from_cache(gw, kwargs, api)             # the same request answered before: no call
            if response is not None:
                response = gw.finish(response)
                _record(response=response, model=model, started_at=started_at, gw=gw, api=api)
                return response
            try:
                response = orig(self, *args, **kwargs)
            except Exception as exc:
                _record(error=exc, model=model, started_at=started_at, gw=gw, api=api, payload=_payload(gw, kwargs, api))
                raise
            answer = _answer(gw, response)
            _keep(gw, kwargs, api, response)
            if gw is not None:
                response = gw.finish(response)
            _record(response=response, model=model, started_at=started_at, gw=gw, api=api,
                    payload=_payload(gw, kwargs, api, answer))
            return response
        _patched._grc_compat = True  # type: ignore[attr-defined]
        return _patched

    patched_any = False
    if not getattr(_cc.Completions.create, "_grc_compat", False):
        _cc.Completions.create = _wrap(_cc.Completions.create)
        patched_any = True
    Async = getattr(_cc, "AsyncCompletions", None)
    if Async is not None and not getattr(Async.create, "_grc_compat", False):
        Async.create = _wrap(Async.create, is_async=True)
        patched_any = True
    try:     # the Responses API (the regulatory engine) goes through the same guard and the same usage record
        from openai.resources.responses import responses as _rr  # type: ignore
        if not getattr(_rr.Responses.create, "_grc_compat", False):
            _rr.Responses.create = _wrap(_rr.Responses.create, api="responses")
            patched_any = True
        AsyncResponses = getattr(_rr, "AsyncResponses", None)
        if AsyncResponses is not None and not getattr(AsyncResponses.create, "_grc_compat", False):
            AsyncResponses.create = _wrap(AsyncResponses.create, is_async=True, api="responses")
            patched_any = True
    except Exception:
        pass
    return patched_any


# Install at import time so every layer that imports this module — the running
# app *and* standalone scripts (e.g. artifact generation) — gets the shim.
install_openai_compat_shim()

# A tracing service sees a prompt before the shim's data-protection guard has cleaned it (LangSmith wraps the client
# from outside), so tracing is off for the whole process, whatever the environment says. The tenant's own usage ledger
# (ai_usage_events, and the sanitised prompts in services/ai_gateway/ledger.py) replaces it.
for _tracing_flag in ("LANGCHAIN_TRACING_V2", "LANGCHAIN_TRACING", "LANGSMITH_TRACING"):
    os.environ[_tracing_flag] = "false"


# ----- LangSmith (AI usage tracing / monitoring) ----------------------------
def get_langsmith_api_key() -> str | None:
    """Resolve LangSmith API key (LANGSMITH_API_KEY or LANGCHAIN_API_KEY)."""
    return os.environ.get("LANGSMITH_API_KEY") or os.environ.get("LANGCHAIN_API_KEY")


def get_langsmith_api_url() -> str | None:
    """Optional custom LangSmith API host."""
    return os.environ.get("LANGSMITH_ENDPOINT") or os.environ.get("LANGCHAIN_ENDPOINT")


def get_langsmith_project(tenant_slug: str | None = None) -> str:
    """Resolve the LangSmith project name for this deployment / tenant.

    Supports ``LANGSMITH_PROJECT_TEMPLATE`` with ``{slug}`` for per-tenant
    projects (e.g. ``compliverse-{slug}``). Falls back to ``LANGSMITH_PROJECT``
    / ``LANGCHAIN_PROJECT`` / ``compliverse``.
    """
    template = (os.environ.get("LANGSMITH_PROJECT_TEMPLATE") or "").strip()
    if template and tenant_slug:
        try:
            return template.format(slug=tenant_slug)
        except Exception:
            pass
    return (
        os.environ.get("LANGSMITH_PROJECT")
        or os.environ.get("LANGCHAIN_PROJECT")
        or "compliverse"
    )


def is_langsmith_configured() -> bool:
    """True when an API key is present (tracing / usage queries can run)."""
    return bool(get_langsmith_api_key())
