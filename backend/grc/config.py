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


# ----- Redis / Celery -------------------------------------------------------
# Default Redis (cache / job-status / enrichment client caches) on DB 0;
# Celery broker on DB 1 and result backend on DB 2. Mirrors the historical
# inline defaults exactly.
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/1")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://127.0.0.1:6379/2")


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


def get_openai_base_url() -> str | None:
    """Resolve the OpenAI (or OpenAI-compatible, e.g. ModelFarm) base URL.

    Returns ``AI_INTEGRATIONS_OPENAI_BASE_URL`` or ``None``. This is the bare
    read that was inlined in many client factories; callers keep their own
    error handling and any extra fallbacks (e.g. ``or OPENAI_BASE_URL``).
    """
    return os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


# ----- gpt-5.x / o-series compatibility shim --------------------------------
# The codebase was written for gpt-4o-era chat completions: ~all call sites pass
# ``max_tokens=`` and ``temperature=0.x``. The newer reasoning models
# (gpt-5.x, o1/o3/o4) reject both — they require ``max_completion_tokens`` and
# only accept the default ``temperature`` (1). Rather than edit dozens of call
# sites (and risk regressions), we wrap ``Completions.create`` once so legacy
# params are translated transparently *only* for those models. gpt-4o and any
# OpenAI-compatible model are passed through untouched. Idempotent + best-effort
# (a no-op if the openai SDK isn't importable).
def install_openai_compat_shim() -> bool:
    try:
        from openai.resources.chat import completions as _cc  # type: ignore
    except Exception:
        return False

    def _wrap(orig):
        def _patched(self, *args, **kwargs):
            model = kwargs.get("model")
            if isinstance(model, str) and model.lower().startswith(("gpt-5", "o1", "o3", "o4")):
                # gpt-4o used ``max_tokens``; reasoning models need ``max_completion_tokens``.
                if "max_tokens" in kwargs and "max_completion_tokens" not in kwargs:
                    kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")
                else:
                    kwargs.pop("max_tokens", None)
                # Reasoning models only accept the default temperature (1); drop others.
                temp = kwargs.get("temperature", None)
                if temp is not None and temp != 1:
                    kwargs.pop("temperature", None)
                # Reasoning tokens count against the completion budget, so a small
                # ``max_tokens`` (fine on gpt-4o) can be fully consumed by reasoning and
                # return an EMPTY message. The platform uses these models for extraction
                # / drafting, not deep reasoning, so default to the lowest effort
                # (≈0 reasoning tokens → budget goes to output, like gpt-4o). gpt-5.x
                # supports "low"; o-series accept it too. Caller-set values win.
                if model.lower().startswith("gpt-5") and "reasoning_effort" not in kwargs:
                    kwargs["reasoning_effort"] = "low"
            return orig(self, *args, **kwargs)
        _patched._grc_compat = True  # type: ignore[attr-defined]
        return _patched

    patched_any = False
    if not getattr(_cc.Completions.create, "_grc_compat", False):
        _cc.Completions.create = _wrap(_cc.Completions.create)
        patched_any = True
    # Also cover the async client, if present, for symmetry.
    Async = getattr(_cc, "AsyncCompletions", None)
    if Async is not None and not getattr(Async.create, "_grc_compat", False):
        Async.create = _wrap(Async.create)
        patched_any = True
    return patched_any


# Install at import time so every layer that imports this module — the running
# app *and* standalone scripts (e.g. artifact generation) — gets the shim.
install_openai_compat_shim()


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
