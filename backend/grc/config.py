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

    def _prepare(kwargs):
        model = kwargs.get("model")
        if isinstance(model, str) and model.lower().startswith(("gpt-5", "o1", "o3", "o4")):
            if "max_tokens" in kwargs and "max_completion_tokens" not in kwargs:
                kwargs["max_completion_tokens"] = kwargs.pop("max_tokens")
            else:
                kwargs.pop("max_tokens", None)
            if kwargs.get("temperature") not in (None, 1):
                kwargs.pop("temperature", None)
            if model.lower().startswith("gpt-5") and "reasoning_effort" not in kwargs:
                kwargs["reasoning_effort"] = "low"
        return model

    def _record(response=None, error=None, model=None, started_at=None):
        try:
            from .services.ai_usage import record_provider_attempt
            record_provider_attempt(
                response=response, error=error, requested_model=model,
                provider="openai", api_family="chat_completions",
                started_at=started_at,
            )
        except Exception:
            pass

    def _wrap(orig, is_async=False):
        if is_async:
            async def _patched_async(self, *args, **kwargs):
                model = _prepare(kwargs)
                started_at = time.perf_counter()
                try:
                    response = await orig(self, *args, **kwargs)
                except Exception as exc:
                    _record(error=exc, model=model, started_at=started_at)
                    raise
                _record(response=response, model=model, started_at=started_at)
                return response
            _patched_async._grc_compat = True  # type: ignore[attr-defined]
            return _patched_async

        def _patched(self, *args, **kwargs):
            model = _prepare(kwargs)
            started_at = time.perf_counter()
            try:
                response = orig(self, *args, **kwargs)
            except Exception as exc:
                _record(error=exc, model=model, started_at=started_at)
                raise
            _record(response=response, model=model, started_at=started_at)
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
    return patched_any


# Install at import time so every layer that imports this module — the running
# app *and* standalone scripts (e.g. artifact generation) — gets the shim.
install_openai_compat_shim()
