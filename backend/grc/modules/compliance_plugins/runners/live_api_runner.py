"""`live_api` runner — runs one SaaS-provider evidence collection (read-only) and
maps its findings to a single RunnerResult that the plugin engine cascades to the
mapped SOC 2 controls. check_definition = {"provider": "github"}; credentials =
{token, domain?, email?} resolved from the IntegrationConnection.

status: error if the API call couldn't be made / provider errored; failed if any
collected finding failed (e.g. a user without MFA, a public repo); else passed.
The full findings list is the evidence snapshot (durable, hashed by run_service).
"""
from __future__ import annotations

from typing import Any, Dict

from .live_api_catalog import run_provider
from .registry import RunnerResult, register


@register("live_api")
def live_api_runner(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    provider = (check_definition or {}).get("provider")
    if not provider:
        return RunnerResult(status="error", summary="check_definition missing 'provider'.",
                            error_message="invalid_check_definition")

    result = run_provider(provider, credentials or {})
    conn = result.get("connectivity")
    if conn == "error":
        return RunnerResult(status="error", summary=result.get("summary_text", "Collector error"),
                            raw_output=result, error_message="connectivity_error")

    any_fail = any(f.get("status") == "fail" for f in result.get("findings", []))
    return RunnerResult(
        status="failed" if any_fail else "passed",
        summary=result.get("summary_text", ""),
        raw_output=result,
    )
