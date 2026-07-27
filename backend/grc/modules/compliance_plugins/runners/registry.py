"""Registry of check runners for the CIS Benchmark Plugin Engine.

A runner is a callable that takes a `check_definition` dict and a credential
dict and returns a `RunnerResult`. The registry is keyed by `runner_type`.
All runners are read-only by contract — they MUST NOT perform any state
mutation against the target system. Any runner that violates this contract
should be rejected at code-review time.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional


@dataclass
class RunnerResult:
    status: str  # "passed" | "failed" | "error" | "skipped"
    summary: str
    raw_output: Dict[str, Any] = field(default_factory=dict)
    error_message: Optional[str] = None


RunnerFn = Callable[[Dict[str, Any], Dict[str, Any]], RunnerResult]
RUNNERS: Dict[str, RunnerFn] = {}


def register(runner_type: str):
    def deco(fn: RunnerFn) -> RunnerFn:
        RUNNERS[runner_type] = fn
        return fn
    return deco


def run_check(runner_type: str, check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    fn = RUNNERS.get(runner_type)
    if not fn:
        return RunnerResult(
            status="error",
            summary=f"No runner registered for type '{runner_type}'.",
            error_message=f"Unsupported runner_type: {runner_type}",
        )
    try:
        return fn(check_definition, credentials)
    except Exception as exc:  # noqa: BLE001
        return RunnerResult(
            status="error",
            summary=f"Runner crashed: {exc}",
            error_message=str(exc),
            raw_output={"exception": exc.__class__.__name__},
        )


# Import side-effects: register built-in runners
from . import aws_runner  # noqa: E402,F401
from . import oracle_runner  # noqa: E402,F401
from . import ssh_runner  # noqa: E402,F401
from . import winrm_runner  # noqa: E402,F401
from . import extended_runners  # noqa: E402,F401  (MSSQL, Postgres, MySQL, LDAP/AD, Azure, K8s)
from . import mock_runner  # noqa: E402,F401  (mock_pass / mock_fail for demo seeding)
from . import manual_runner  # noqa: E402,F401  (operator attestation for text-only CIS rules)
