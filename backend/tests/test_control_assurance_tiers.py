"""Tier-derivation contract tests — the precedence rules the audit story
rests on: recent fail dominates, closures cap at remediation-verified, old
passes decay to stale, no evidence means attested-only."""

from datetime import datetime, timedelta

from grc.services.control_assurance import derive_tier

NOW = datetime(2026, 8, 10, 12, 0, 0)


def _e(source, result, days_ago):
    return {"source_type": source, "result": result,
            "tested_at": NOW - timedelta(days=days_ago)}


def test_no_evidence_is_attested_only():
    assert derive_tier([], now=NOW)["tier"] == "attested_only"


def test_closure_pass_caps_at_remediation_verified():
    r = derive_tier([_e("scanner_closure", "pass", 10)], now=NOW)
    assert r["tier"] == "remediation_verified"
    assert "not that the control works" in r["basis"]


def test_retest_pass_reaches_tested_effective():
    r = derive_tier([_e("retest", "pass", 10)], now=NOW)
    assert r["tier"] == "tested_effective"


def test_recent_fail_dominates_older_pass():
    r = derive_tier([_e("retest", "pass", 100), _e("scanner_closure", "fail", 5)], now=NOW)
    assert r["tier"] == "tested_failed"


def test_pass_after_fail_recovers():
    r = derive_tier([_e("scanner_closure", "fail", 100), _e("retest", "pass", 5)], now=NOW)
    assert r["tier"] == "tested_effective"


def test_closure_pass_plus_fresh_retest_pass_is_tested_effective():
    r = derive_tier([_e("scanner_closure", "pass", 3), _e("retest", "pass", 30)], now=NOW)
    assert r["tier"] == "tested_effective"
    assert r["last_source"] == "retest"


def test_old_pass_decays_to_stale():
    r = derive_tier([_e("retest", "pass", 600)], now=NOW)
    assert r["tier"] == "stale"


def test_window_boundary_exact():
    inside = derive_tier([_e("retest", "pass", 548)], now=NOW, window_days=548)
    outside = derive_tier([_e("retest", "pass", 549)], now=NOW, window_days=548)
    assert inside["tier"] == "tested_effective"
    assert outside["tier"] == "stale"


def test_stale_genuine_pass_with_fresh_closure_is_remediation_verified():
    # The retest expired; only the fresh closure keeps it above attested —
    # but a closure can only carry it to remediation-verified.
    r = derive_tier([_e("retest", "pass", 700), _e("scanner_closure", "pass", 10)], now=NOW)
    assert r["tier"] == "remediation_verified"


def test_old_fail_does_not_dominate_fresh_pass():
    r = derive_tier([_e("retest", "fail", 400), _e("retest", "pass", 10)], now=NOW)
    assert r["tier"] == "tested_effective"
