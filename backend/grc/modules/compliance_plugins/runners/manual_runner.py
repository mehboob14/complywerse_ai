"""Manual attestation runner.

Rules sourced from parsed CIS Benchmark PDF text carry no executable check —
they are verified by an operator who reviews the Audit / Remediation guidance
and records a pass / fail / not-applicable decision against an asset. This
runner turns that operator decision (injected by ``execute_plugin`` onto the
check_definition as ``_manual_result`` / ``_manual_note``) into a RunnerResult,
so manual rules flow through the SAME run-row / control-cascade / audit
pipeline as automated checks — i.e. "testing" looks identical in the UI.

Read-only by contract (it performs no system access at all).
"""
from __future__ import annotations

from typing import Any, Dict

from .registry import RunnerResult, register

_PASS = {"pass", "passed", "compliant", "yes", "true", "ok"}
_FAIL = {"fail", "failed", "non_compliant", "noncompliant", "no", "false"}
_NA = {"na", "n/a", "not_applicable", "not-applicable", "skip", "skipped", "exempt", "n_a"}


@register("manual")
def manual_runner(check_definition: Dict[str, Any], credentials: Dict[str, Any]) -> RunnerResult:
    decision = str(check_definition.get("_manual_result") or "").strip().lower()
    note = str(check_definition.get("_manual_note") or "").strip()
    if decision in _PASS:
        return RunnerResult(status="passed",
                            summary=note or "Marked compliant by operator (manual attestation).")
    if decision in _FAIL:
        return RunnerResult(status="failed",
                            summary=note or "Marked non-compliant by operator (manual attestation).")
    if decision in _NA:
        return RunnerResult(status="skipped",
                            summary=note or "Marked not applicable by operator (manual attestation).")
    # No decision supplied — surface a clear prompt rather than a hard error.
    return RunnerResult(
        status="skipped",
        summary=("Manual attestation required — review the audit guidance and record a "
                 "pass / fail / N-A decision for this rule."),
    )
