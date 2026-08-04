"""
Lightweight tenant tagging for LangSmith / OpenAI tracing.

Middleware sets the current tenant slug on a ContextVar so wrapped OpenAI
clients can attach ``tenant_slug`` metadata without threading request
objects through every call site.
"""

from __future__ import annotations

import os
from contextvars import ContextVar
from typing import Any, Optional

_tenant_slug: ContextVar[Optional[str]] = ContextVar("grc_ai_tenant_slug", default=None)


def set_ai_tenant_slug(slug: Optional[str]) -> None:
    _tenant_slug.set((slug or "").strip() or None)


def get_ai_tenant_slug() -> Optional[str]:
    return _tenant_slug.get()


def tracing_metadata(**extra: Any) -> dict[str, Any]:
    meta: dict[str, Any] = dict(extra)
    slug = get_ai_tenant_slug()
    if slug:
        meta.setdefault("tenant_slug", slug)
    return meta


def wrap_openai_for_tracing(client: Any, *, feature: Optional[str] = None) -> Any:
    """Wrap an OpenAI client with LangSmith tracing when configured.

    Tags every call with ``tenant_slug`` (from the request ContextVar) so the
    Usage Monitoring screen can filter per-tenant.
    """
    try:
        from ..config import (
            get_langsmith_api_key,
            get_langsmith_project,
            is_langsmith_configured,
        )
        if not is_langsmith_configured():
            return client

        # Enable LangSmith tracing for this process when a key is present.
        key = get_langsmith_api_key()
        if key:
            os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
            os.environ.setdefault("LANGCHAIN_API_KEY", key)
            os.environ.setdefault("LANGSMITH_API_KEY", key)

        slug = get_ai_tenant_slug()
        project = get_langsmith_project(slug)
        os.environ.setdefault("LANGCHAIN_PROJECT", project)
        os.environ.setdefault("LANGSMITH_PROJECT", project)

        from langsmith.wrappers import wrap_openai
        from langsmith.wrappers._openai import TracingExtra

        meta = tracing_metadata(**({"feature": feature} if feature else {}))
        tags = []
        if slug:
            tags.append(f"tenant:{slug}")
            tags.append(slug)
        if feature:
            tags.append(f"feature:{feature}")

        return wrap_openai(
            client,
            tracing_extra=TracingExtra(metadata=meta or None, tags=tags or None),
        )
    except Exception:
        return client
