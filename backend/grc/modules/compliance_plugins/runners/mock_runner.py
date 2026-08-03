"""Mock runner for demo / verification of the host-applications panel.

Registered as runner_type='mock_pass' (always passes) and 'mock_fail' (always
fails). Used by synthetic CIS plugin rows the seed_mock_cluster.py script
creates so the room-and-chair UI demo can exercise scan execution without
needing real WinRM / SSH / DB credentials.

The seed script tags every synthetic plugin's benchmark name with prefix
'Mock_CIS_' so they're trivially deletable on cleanup.
"""
from __future__ import annotations

from typing import Any, Dict

from .registry import RunnerResult, register


@register("mock_pass")
def _mock_pass(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    return RunnerResult(
        status="passed",
        summary="mock_pass runner — synthetic OK",
        raw_output={"runner": "mock_pass"},
    )


@register("mock_fail")
def _mock_fail(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    return RunnerResult(
        status="failed",
        summary="mock_fail runner — synthetic FAIL",
        raw_output={"runner": "mock_fail"},
    )
