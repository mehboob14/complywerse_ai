"""Population accounting and the vacuous pass (build steps 1 and 2).

The engine's whole job is to say how much it actually looked at. Two ways it used
to overstate that: a count check over an empty population returned pass, and no
finding carried the population it was drawn from, so a result over 3 rows and a
result over 3,000 were indistinguishable downstream.
"""
from grc.modules.compliance_plugins.runners.evidence_engine import MAX_FINDINGS, _eval_check
from grc.modules.compliance_plugins.runners.live_api_catalog import _finding
from grc.modules.compliance_plugins.services.check_result_recorder import (
    _CADENCE_DAYS,
    _MAX_STATUS,
    _VERDICTS,
)

MAXC = {"id": "x.admins", "kind": "max_count", "max": 5, "controls": ["CC6.3"], "title": "Admins"}
MINC = {"id": "x.fw", "kind": "min_count", "min": 1, "controls": ["CC6.1"], "title": "Firewalls"}
ALLT = {"id": "x.mfa", "kind": "all_true", "field": "mfa", "controls": ["CC6.1"],
        "title": "MFA", "item_name": "n"}


def summary(out):
    """The directory line — the one that carries the verdict and the counts."""
    return out[-1]


# ── the vacuous pass ─────────────────────────────────────────────────────────

def test_max_count_over_an_empty_population_is_not_a_pass():
    # "no more than 5 admins" with zero rows is vacuously true and evidences
    # nothing. It used to return pass, which is how a connector that could see
    # nothing produced a satisfied control.
    assert summary(_eval_check(MAXC, []))["status"] == "not_run"


def test_max_count_still_discriminates_on_a_real_population():
    assert summary(_eval_check(MAXC, [{"n": i} for i in range(3)]))["status"] == "pass"
    assert summary(_eval_check(MAXC, [{"n": i} for i in range(9)]))["status"] == "fail"


def test_min_count_over_an_empty_population_is_still_a_fail():
    # Asymmetric on purpose: "at least one firewall exists" with zero rows means
    # the thing that should exist does not. That is a real finding, not a gap.
    assert summary(_eval_check(MINC, []))["status"] == "fail"


def test_a_failed_collection_is_never_confused_with_an_empty_one():
    assert summary(_eval_check(MAXC, [], collect_failed=True))["status"] == "error"


def test_offender_kinds_were_already_correct_and_stay_correct():
    assert summary(_eval_check(ALLT, []))["status"] == "not_run"


# ── population accounting ────────────────────────────────────────────────────

def test_every_verdict_carries_the_population_it_was_drawn_from():
    for check, rows in ((MAXC, [{"n": i} for i in range(3)]),
                        (MINC, [{"n": 1}]),
                        (ALLT, [{"n": i, "mfa": True} for i in range(4)])):
        s = summary(_eval_check(check, rows))
        assert s["population_size"] == len(rows), check["id"]
        assert s["tested_size"] is not None, check["id"]


def test_population_and_tested_diverge_when_a_check_scopes_itself():
    # 5 accounts, 2 of them bots that the check skips. An assessor asking "of how
    # many?" must get 5 and 3, not whichever number flatters the result.
    scoped = {**ALLT, "skip_if_field_true": "bot"}
    rows = [{"n": i, "mfa": True, "bot": i < 2} for i in range(5)]
    s = summary(_eval_check(scoped, rows))
    assert (s["population_size"], s["tested_size"]) == (5, 3)


def test_an_empty_result_still_reports_the_population_it_saw():
    s = summary(_eval_check(ALLT, []))
    assert s["population_size"] == 0 and s["tested_size"] == 0


def test_truncation_is_flagged_when_offenders_exceed_the_cap():
    rows = [{"n": i, "mfa": False} for i in range(MAX_FINDINGS + 5)]
    assert summary(_eval_check(ALLT, rows))["truncated"] is True


def test_findings_without_a_population_stay_silent_rather_than_claim_one():
    # A connectivity probe has no population. Emitting population_size=1 would be
    # a fabricated denominator.
    f = _finding(["CC6.1"], "x.connectivity", "github", "info", "ok")
    assert "population_size" not in f and "tested_size" not in f


# ── recorder honesty rules ───────────────────────────────────────────────────

def test_inventory_is_not_a_verdict():
    # `info` enumerates what exists and asserts nothing, so it must never become
    # a recorded control result.
    assert "info" not in _VERDICTS
    assert _VERDICTS == {"pass", "fail", "error", "not_run"}


def test_every_recordable_status_fits_the_column():
    # SCFCheckResult.status is String(10). A longer status would truncate
    # silently, which is how `not_applicable` would have become `not_applic`.
    for s in _VERDICTS:
        assert len(s) <= _MAX_STATUS, s
    assert len("not_applicable") > _MAX_STATUS, "widen the column before adding this status"


def test_expiry_uses_scfs_own_three_windows():
    assert _CADENCE_DAYS == {"Quarterly": 90, "Semi-Annual": 180, "Annual": 365}
