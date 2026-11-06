"""One workflow trigger event per API endpoint.

Every write request's audit row records the endpoint that handled it
(audit_logger), the dispatcher raises ``api.<file>.<function>`` for it, and
each Platform Function node in the builder carries the same name as its
``trigger_event`` — so a node used as a trigger fires on exactly that
endpoint, in every module, with no per-module tables to keep in step.

``<file>`` is the endpoint's Python module relative to ``grc``, without the
``modules.`` and ``.routers`` segments: ``grc.modules.erm.routers.risks`` →
``erm.risks``, ``grc.routers.reporting_router`` → ``reporting_router``,
``grc.modules.automation.router`` → ``automation.router``.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

# Writes a workflow can start from. A failed request (4xx/5xx) is logged as
# "<verb>_failed" and never raises the endpoint's event.
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def endpoint_id(module: str, function: str) -> str:
    """``grc.modules.erm.routers.risks`` + ``create_risk`` → ``erm.risks.create_risk``."""
    parts = [p for p in (module or "").split(".") if p]
    if parts and parts[0] == "grc":
        parts = parts[1:]
    if parts and parts[0] == "modules":
        parts = parts[1:]
    parts = [p for p in parts if p != "routers"]
    return ".".join([*parts, function])


def event_name(module: str, function: str) -> str:
    return f"api.{endpoint_id(module, function)}"


def endpoint_of(scope: Dict[str, Any]) -> Optional[str]:
    """The endpoint an ASGI request was routed to, as ``module:function``."""
    endpoint = (scope or {}).get("endpoint")
    module = getattr(endpoint, "__module__", None)
    function = getattr(endpoint, "__name__", None)
    return f"{module}:{function}" if module and function else None


def event_for_audit(changes: Dict[str, Any], action: str) -> Optional[str]:
    """The endpoint event an audit row raises, if any: a successful write that
    recorded its endpoint."""
    endpoint = (changes or {}).get("endpoint")
    method = str((changes or {}).get("method") or "").upper()
    status = (changes or {}).get("status_code")
    if not endpoint or ":" not in str(endpoint) or method not in _MUTATING:
        return None
    if str(action or "").endswith("_failed") or (isinstance(status, int) and status >= 400):
        return None
    module, function = str(endpoint).split(":", 1)
    return event_name(module, function)
