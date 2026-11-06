"""Controls Automation: the audit trail keeps secrets out, and list rows carry assurance.

Two ways the new module could go wrong quietly: a connector's second secret
(`secret2`) or an OAuth `client_secret` stored in plain text in the audit log,
and a report or list row that shows "not assessed" and a blank target when the
control has a status and the scope has a default target.
"""
from types import SimpleNamespace

from grc.rich_audit import _sanitize, is_sensitive_key


def test_any_secret_like_key_is_redacted_not_only_exact_names():
    for key in ("token", "secret2", "client_secret", "private_key", "x_api_token", "api_key", "password",
                "DD-APPLICATION-KEY".lower().replace("-", "_") + "_secret"):
        assert is_sensitive_key(key), key
    for key in ("domain", "email", "access_key_id", "provider", "result", "scf_id"):
        assert not is_sensitive_key(key), key


def test_audit_snapshots_are_redacted_at_every_depth():
    payload = {"provider": "datadog", "secret2": "app-key", "after": {"client_secret": "s", "fields": ["token"]},
               "items": [{"password": "p", "name": "ok"}]}
    assert _sanitize(payload) == {"provider": "datadog", "secret2": "***",
                                  "after": {"client_secret": "***", "fields": ["token"]},
                                  "items": [{"password": "***", "name": "ok"}]}


def test_list_rows_carry_assurance_status_maturity_and_latest_tests():
    from datetime import datetime
    from grc.modules.automation.router import _assurance_fields

    assert _assurance_fields(None, None, 3) == {
        "designation": "not_assessed", "cmm_actual": None, "cmm_target": 3, "last_assessed_at": None,
        "design_effectiveness": None, "operating_effectiveness": None, "last_tested_at": None, "next_test_date": None,
    }
    state = SimpleNamespace(designation="partial", cmm_actual=2, cmm_target=None, last_assessed_at=datetime(2026, 9, 1))
    work_item = SimpleNamespace(design_effectiveness="effective", operating_effectiveness="partially_effective",
                                last_tested_at=datetime(2026, 9, 2), next_test_date=datetime(2026, 12, 2))
    row = _assurance_fields(state, work_item, 4)
    assert row["designation"] == "partial" and row["cmm_actual"] == 2
    assert row["cmm_target"] == 4                       # unset on the control: the scope's default target
    assert row["operating_effectiveness"] == "partially_effective"
    assert row["next_test_date"].startswith("2026-12-02")
