"""ComplyVerse: shared OpenAI client factory.

Recovered from the removed control_library module so the kept cyber AI features
(vuln control proposals, asset layout AI) keep working without depending on a
GRC-only module. Uses only kept platform pieces: config + ai_tracing.
"""
import os
from openai import OpenAI
from fastapi import HTTPException, status
from ..config import get_openai_api_key


def check_ai_available() -> bool:
    """True if OpenAI is configured (AI Integrations or a direct API key)."""
    if os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY"):
        return True
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key and not api_key.startswith("your-") and len(api_key) >= 20:
        return True
    return False


def raise_ai_unavailable(fallback_available: bool = False):
    """Raise HTTP 503 when AI features are unavailable."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "AI features unavailable",
            "message": "AI integration is not configured. Add OPENAI_API_KEY to enable AI features.",
            "fallback_available": fallback_available,
        },
    )


def get_openai_client() -> OpenAI:
    if not check_ai_available():
        raise_ai_unavailable(fallback_available=False)
    api_key = get_openai_api_key()
    # Empty base URL -> None so the SDK uses its default endpoint.
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL") or None
    from .ai_tracing import wrap_openai_for_tracing
    return wrap_openai_for_tracing(OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=90.0,
        max_retries=2,
    ))
