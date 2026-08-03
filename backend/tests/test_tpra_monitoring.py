"""Unit tests for the monitoring trigger engine + cadence helpers."""
import pytest

from grc.modules.vendor_risk.tpra.engine_monitoring import (
    should_trigger_reassessment, next_review_in_days,
)
from grc.modules.vendor_risk.tpra.stages import DEFAULT_CADENCE_DAYS, cadence_days_for, can_skip


@pytest.mark.parametrize("stype,sev,expected", [
    ("breach", "low", True),          # breach always triggers
    ("cert_expiry", "critical", True),
    ("financial", "high", True),
    ("sla", "medium", False),
    ("adverse_media", "low", False),
])
def test_should_trigger_reassessment(stype, sev, expected):
    assert should_trigger_reassessment(stype, sev) is expected


def test_next_review_in_days_by_tier():
    assert next_review_in_days("critical") == DEFAULT_CADENCE_DAYS["critical"]
    assert next_review_in_days("low") == DEFAULT_CADENCE_DAYS["low"]


def test_cadence_override():
    assert cadence_days_for("high", {"high": 90}) == 90
    assert cadence_days_for("high") == DEFAULT_CADENCE_DAYS["high"]


def test_gate_stages_never_skippable():
    assert can_skip("low", "tiering") is False
    assert can_skip("low", "approval") is False
    # Low tier may skip heavy diligence planning.
    assert can_skip("low", "dd_planning") is True
    # Critical tier may skip nothing.
    assert can_skip("critical", "dd_planning") is False
