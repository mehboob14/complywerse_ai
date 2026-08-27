"""Cadence is a real deadline, not a label.

Locks the deadline math (weekly/monthly/quarterly), the overdue flip, the
no-cadence/no-cycle None case, and that unknown cadence values never silently
produce a deadline (the router rejects them with 422 via _valid_cadence).
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

from grc.services.ctem_scopes import CADENCE_DAYS, cycle_deadline
from grc.modules.erm.routers.ctem_scopes import _valid_cadence


def test_deadline_math_per_cadence():
    opened = datetime(2026, 8, 1, 12, 0, 0)
    assert cycle_deadline("weekly", opened)[0] == opened + timedelta(days=7)
    assert cycle_deadline("monthly", opened)[0] == opened + timedelta(days=30)
    assert cycle_deadline("quarterly", opened)[0] == opened + timedelta(days=91)


def test_overdue_flips_only_after_the_window():
    fresh = datetime.utcnow() - timedelta(days=2)
    stale = datetime.utcnow() - timedelta(days=8)
    assert cycle_deadline("weekly", fresh) == (fresh + timedelta(days=7), False)
    assert cycle_deadline("weekly", stale)[1] is True


def test_no_cadence_or_no_cycle_means_no_deadline():
    assert cycle_deadline(None, datetime.utcnow()) == (None, False)
    assert cycle_deadline("", datetime.utcnow()) == (None, False)
    assert cycle_deadline("weekly", None) == (None, False)
    # a junk value must not invent a deadline either
    assert cycle_deadline("fortnightly", datetime.utcnow()) == (None, False)


def test_router_rejects_fake_cadence_values():
    assert _valid_cadence("Quarterly ") == "quarterly"   # normalised
    assert _valid_cadence("") is None                     # ad hoc allowed
    assert _valid_cadence(None) is None
    with pytest.raises(HTTPException) as e:
        _valid_cadence("every-blue-moon")
    assert e.value.status_code == 422
    assert set(CADENCE_DAYS) == {"weekly", "monthly", "quarterly"}
