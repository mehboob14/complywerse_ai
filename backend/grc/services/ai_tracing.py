"""
Tenant tagging for AI calls. Tracing to an outside service is off (see wrap_openai_for_tracing).

Middleware sets the current tenant slug on a ContextVar so wrapped OpenAI
clients can attach ``tenant_slug`` metadata without threading request
objects through every call site.
"""

from __future__ import annotations

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
    """Returns the client as it is: tracing is off.

    LangSmith's wrapper records a call's prompt and answer from outside the shim, i.e. before the data-protection
    guard has replaced names, hosts, addresses and secrets, and would send them to an outside service. Every call is
    in the tenant's usage ledger instead (``ai_usage_events``; the sanitised prompt in ``ai_call_payloads``).
    """
    return client
