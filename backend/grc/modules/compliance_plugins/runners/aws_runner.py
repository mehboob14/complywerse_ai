"""AWS read-only runner stub.

The CIS integration package's registry side-imports ``aws_runner`` but the
actual runner file was not shipped in the handoff bundle. This stub keeps
the registry loadable and registers the ``aws_readonly`` runner_type so
plugin rows referencing it don't blow up at validation time. When the
full ``boto3``-backed implementation lands, replace this file.
"""

from __future__ import annotations

from typing import Any, Dict

from .registry import RunnerResult, register


@register("aws_readonly")
def aws_readonly(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    return RunnerResult(
        status="skipped",
        summary="AWS read-only runner not yet implemented in this build.",
        raw_output={"check_definition": check_definition},
        error_message="aws_readonly runner is a stub; install boto3 + provide real runner to enable.",
    )
