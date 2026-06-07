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
def get_openai_api_key() -> str | None:
    """Resolve the OpenAI API key.

    Prefers ``AI_INTEGRATIONS_OPENAI_API_KEY`` and falls back to
    ``OPENAI_API_KEY`` — the dominant resolution order already used across the
    codebase. Returns ``None`` if neither is set (callers degrade gracefully).
    """
    return os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
