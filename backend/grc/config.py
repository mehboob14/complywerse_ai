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
