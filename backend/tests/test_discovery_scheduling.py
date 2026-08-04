"""Scheduled discovery + scan-safety: blackout windows and rate-limit pacing.

The DB-touching selection/fan-out is exercised live elsewhere; here we lock down
the pure safety logic (blackout evaluation, rate-limit batching) and the beat
wiring, none of which need a database.
"""
from datetime import datetime

import pytest

from grc.modules.asset_discovery.services.executor import is_in_blackout, _sweep_targets


class _Camp:
    def __init__(self, windows):
        self.blackout_windows = windows


# 2026-07-27 is a Monday (weekday 0); 07-28 is Tuesday.
MON_NOON = datetime(2026, 7, 27, 12, 0)
MON_2300 = datetime(2026, 7, 27, 23, 0)
MON_0200 = datetime(2026, 7, 27, 2, 0)
TUE_0200 = datetime(2026, 7, 28, 2, 0)


def test_same_day_window():
    c = _Camp([{"days": [0], "start": "11:00", "end": "13:00"}])
    assert is_in_blackout(c, MON_NOON) is True
    assert is_in_blackout(c, MON_2300) is False


def test_midnight_crossing_window():
    c = _Camp([{"days": [0], "start": "22:00", "end": "06:00"}])
    assert is_in_blackout(c, MON_2300) is True   # after 22:00
    assert is_in_blackout(c, MON_0200) is True   # before 06:00
    assert is_in_blackout(c, MON_NOON) is False  # midday


def test_day_of_week_is_respected():
    c = _Camp([{"days": [0], "start": "01:00", "end": "03:00"}])
    assert is_in_blackout(c, MON_0200) is True
    assert is_in_blackout(c, TUE_0200) is False  # window is Monday only


def test_empty_days_means_every_day():
    c = _Camp([{"start": "11:00", "end": "13:00"}])
    assert is_in_blackout(c, MON_NOON) is True
    assert is_in_blackout(c, datetime(2026, 7, 28, 12, 0)) is True  # Tuesday too


def test_no_windows_and_malformed_are_safe():
    assert is_in_blackout(_Camp(None), MON_NOON) is False
    assert is_in_blackout(_Camp([]), MON_NOON) is False
    assert is_in_blackout(_Camp([{"bad": "data"}]), MON_NOON) is False
    assert is_in_blackout(_Camp("not-a-list"), MON_NOON) is False


def _up(ip, port, tmo):
    return {"status": "reachable", "hostname": None, "rtt_ms": 1} if port == 445 else {"status": "unreachable"}


def test_rate_limit_batches_and_paces(monkeypatch):
    import time as _t
    paused = []
    monkeypatch.setattr(_t, "sleep", lambda s: paused.append(s))
    targets = [f"10.0.0.{i}" for i in range(1, 8)]  # 7 hosts, limit 3 -> batches 3,3,1
    res = _sweep_targets(targets, probe=_up, timeout_s=0.001, max_workers=8, rate_limit_per_min=3)
    assert len(res) == 7                 # every host still probed
    assert len(paused) == 2              # a pause after batch 1 and batch 2, none after the last
    assert all(0 < s <= 60 for s in paused)


def test_unlimited_rate_does_not_pause(monkeypatch):
    import time as _t
    paused = []
    monkeypatch.setattr(_t, "sleep", lambda s: paused.append(s))
    res = _sweep_targets([f"10.0.0.{i}" for i in range(1, 5)], probe=_up,
                         timeout_s=0.001, max_workers=8, rate_limit_per_min=None)
    assert len(res) == 4
    assert paused == []


def test_beat_schedule_registers_discovery_fan_out():
    from grc.celery_app import celery_app
    assert "discovery-scheduled-fan-out" in celery_app.conf.beat_schedule


def test_due_selection_helpers_exist():
    from grc.tasks import discovery
    for fn in ("due_campaign_ids", "run_discovery_campaign",
               "discovery_scheduled_fan_out", "run_discovery_campaign_task"):
        assert hasattr(discovery, fn)
