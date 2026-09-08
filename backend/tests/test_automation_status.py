"""Control status derivation: evidence expiry (C3) and collection health (C5).

DB-free, matching the rest of the suite. Both rules exist to stop the automation
engine overstating what it knows — one about age, one about reachability — so
the cases that matter are the ones where a naive reading says "passed".
"""
from datetime import datetime, timedelta

from grc.modules.automation.router import (
    COLLECTION_STALE_DAYS,
    _CADENCE_DAYS,
    _aggregate_status,
    _is_stale,
    _status_from_run,
)


class Run:
    """The two attributes the status functions read off a CompliancePluginRun."""

    def __init__(self, *, days_ago=1, status="passed", findings=None):
        self.started_at = datetime.utcnow() - timedelta(days=days_ago)
        self.status = status
        self.raw_output = {"findings": findings if findings is not None else [
            {"check": "github.connectivity", "control_codes": ["CC6.1"], "status": "pass"},
        ]}


CODES = ["CC6.1"]
IDS = {"github.connectivity"}


# ── C3: a verdict older than the control's reassessment window is not a verdict ──

def test_cadence_windows_are_scfs_three():
    assert _CADENCE_DAYS == {"Quarterly": 90, "Semi-Annual": 180, "Annual": 365}


def test_fresh_result_passes():
    assert _status_from_run(Run(days_ago=5), IDS, CODES, "Quarterly") == "passed"


def test_result_past_its_cadence_expires():
    assert _status_from_run(Run(days_ago=120), IDS, CODES, "Quarterly") == "expired"
    assert _status_from_run(Run(days_ago=200), IDS, CODES, "Semi-Annual") == "expired"
    assert _status_from_run(Run(days_ago=400), IDS, CODES, "Annual") == "expired"


def test_same_result_is_current_under_a_looser_cadence():
    # 120 days is stale quarterly and fine annually — the window is the control's,
    # not the engine's.
    assert _status_from_run(Run(days_ago=120), IDS, CODES, "Annual") == "passed"


def test_unknown_cadence_defaults_to_the_loosest_window():
    # Never expire a result early because SCF left the field blank.
    assert _status_from_run(Run(days_ago=200), IDS, CODES, None) == "passed"
    assert _status_from_run(Run(days_ago=400), IDS, CODES, None) == "expired"


def test_a_failing_result_still_fails_when_fresh():
    fail = [{"check": "github.connectivity", "control_codes": CODES, "status": "fail"}]
    assert _status_from_run(Run(days_ago=5, findings=fail), IDS, CODES, "Annual") == "failed"


def test_expiry_outranks_a_passing_sibling():
    # One stale assertion means the control is not fully vouched for.
    assert _aggregate_status(["passed", "expired"]) == "expired"
    assert _aggregate_status(["passed", "passed"]) == "passed"


def test_a_real_failure_still_outranks_expiry():
    assert _aggregate_status(["expired", "failed"]) == "failed"


def test_is_stale_needs_a_timestamp():
    class NoTime:
        started_at = None
    assert _is_stale(NoTime(), "Quarterly") is False


# ── C5: a collector that could not collect says nothing about the control ────

def test_errored_run_is_a_collection_failure_not_a_control_failure():
    assert _status_from_run(Run(status="error", findings=[]), IDS, CODES, "Annual") == "collection_failed"


def test_collection_failure_is_not_masked_by_a_passing_sibling():
    assert _aggregate_status(["passed", "collection_failed"]) == "collection_failed"


def test_a_real_failure_still_outranks_a_collection_failure():
    # A check that ran and failed is information; a collector that could not run
    # is the absence of information, and the information wins.
    assert _aggregate_status(["collection_failed", "failed"]) == "failed"


def test_collection_failure_ignores_stale_findings_entirely():
    # An errored run may still carry the previous run's findings in raw_output;
    # none of them should reach the verdict.
    stale_pass = [{"check": "github.connectivity", "control_codes": CODES, "status": "pass"}]
    assert _status_from_run(Run(status="error", days_ago=1, findings=stale_pass),
                            IDS, CODES, "Annual") == "collection_failed"


def test_a_run_with_no_findings_for_this_control_is_not_run():
    other = [{"check": "aws.mfa", "control_codes": ["CC6.7"], "status": "pass"}]
    assert _status_from_run(Run(findings=other), IDS, CODES, "Annual") == "not_run"


def test_collection_goes_stale_after_a_quarter():
    assert COLLECTION_STALE_DAYS == 90
