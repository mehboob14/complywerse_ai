"""Guards _auto_cfg — the auto-ticket trigger's enable/severity/limit resolution.

Env wins over per-connection config (the Help Desk engine is operator-managed,
never customer-tuned); default is OFF so enabling is a deliberate act.
"""
from types import SimpleNamespace

import pytest

from grc.modules.connectors.sync_runner import _auto_cfg

ENV_KEYS = ("HELPDESK_AUTO_TICKET", "HELPDESK_AUTO_SEVERITIES", "HELPDESK_AUTO_LIMIT",
            "HELPDESK_AUTO_INTERNET_FACING")


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    for k in ENV_KEYS:
        monkeypatch.delenv(k, raising=False)


def _conn(cfg=None):
    return SimpleNamespace(provider_config=cfg)


def test_default_off_critical_only():
    c = _auto_cfg(_conn(None))
    assert c == {"enabled": False, "severities": ["critical"], "limit": 25,
                 "require_internet_facing": False}


def test_critical_plus_internet_facing_policy(monkeypatch):
    monkeypatch.setenv("HELPDESK_AUTO_TICKET", "true")
    monkeypatch.setenv("HELPDESK_AUTO_SEVERITIES", "critical")
    monkeypatch.setenv("HELPDESK_AUTO_INTERNET_FACING", "true")
    c = _auto_cfg(_conn(None))
    assert c["enabled"] is True
    assert c["severities"] == ["critical"]
    assert c["require_internet_facing"] is True


def test_env_enables_and_overrides_config(monkeypatch):
    monkeypatch.setenv("HELPDESK_AUTO_TICKET", "true")
    monkeypatch.setenv("HELPDESK_AUTO_SEVERITIES", "Critical, High")
    monkeypatch.setenv("HELPDESK_AUTO_LIMIT", "5")
    c = _auto_cfg(_conn({"auto_ticket": False, "auto_severities": ["low"], "auto_limit": 99}))
    assert c["enabled"] is True
    assert c["severities"] == ["critical", "high"]  # normalised + env wins
    assert c["limit"] == 5


def test_per_connection_config_when_no_env():
    c = _auto_cfg(_conn({"auto_ticket": True, "auto_severities": ["High"], "auto_limit": 10}))
    assert c == {"enabled": True, "severities": ["high"], "limit": 10,
                 "require_internet_facing": False}


def test_bad_limit_falls_back():
    c = _auto_cfg(_conn({"auto_limit": "not-a-number"}))
    assert c["limit"] == 25


if __name__ == "__main__":  # runnable without pytest
    import os
    for k in ENV_KEYS:
        os.environ.pop(k, None)
    assert _auto_cfg(_conn(None))["enabled"] is False
    os.environ["HELPDESK_AUTO_TICKET"] = "1"
    assert _auto_cfg(_conn(None))["enabled"] is True
    print("ok")
