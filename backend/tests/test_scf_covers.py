"""DB-free unit tests for SCF Stage G covers bindings."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def _load_covers():
    """Load covers.py without importing compliance_plugins.__init__ (router deps)."""
    path = BACKEND / "grc" / "modules" / "compliance_plugins" / "runners" / "covers.py"
    spec = importlib.util.spec_from_file_location("scf_covers_standalone", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def test_scf_targets_from_covers():
    mod = _load_covers()
    assert mod.scf_targets_from_covers(["IAC-06_A01", "IAC-06"]) == {"IAC-06"}
    assert mod.scf_targets_from_covers(["IAC-06.2_A01"]) == {"IAC-06.2"}
    assert mod.scf_targets_from_covers(["IAC-06.1_A02", "GOV-01"]) == {"IAC-06.1", "GOV-01"}
    assert mod.scf_targets_from_covers([]) == set()
    assert mod.scf_targets_from_covers(["", "  "]) == set()


def test_covers_for_check_prefers_inline_then_overlay(monkeypatch):
    mod = _load_covers()
    monkeypatch.setattr(
        mod,
        "load_covers_overlay",
        lambda: {
            "github.org_2fa_required": {
                "covers": ["IAC-06"],
                "rationale": "overlay",
                "reviewed_by": None,
            }
        },
    )
    assert mod.covers_for_check(
        {"id": "github.org_2fa_required", "covers": ["IAC-06_A01"]}
    ) == ["IAC-06_A01"]
    assert mod.covers_for_check({"id": "github.org_2fa_required"}) == ["IAC-06"]
    assert mod.covers_for_check({"id": "no.such.check"}) == []


def test_binding_preference_covers_hits_iac06():
    """Conceptual: when covers map a check to IAC-06, soc2-only path is not required."""
    mod = _load_covers()
    overlay = mod.load_covers_overlay()
    assert "github.org_2fa_required" in overlay
    covers = mod.covers_for_check({"id": "github.org_2fa_required"})
    targets = mod.scf_targets_from_covers(covers)
    assert "IAC-06" in targets
    assert bool(covers) is True


def test_bound_check_ids_shape_validation():
    """bound_check_ids is a JSON list of non-empty strings (custom control column)."""
    from grc.modules.scf.custom_controls import set_bound_checks
    import grc.modules.scf.custom_controls as mod

    class _FakeDB:
        def flush(self):
            pass

    nc = SimpleNamespace(
        id=3,
        scf_id="CUST-MFA",
        code="CUST-MFA",
        tenant_id=1,
        retired_at=None,
        bound_check_ids=None,
        source="custom",
    )
    calls = {"audit": 0}

    def _fake_get(db, tenant_id, code):
        return nc

    def _fake_audit(**kwargs):
        calls["audit"] += 1

    orig_get, orig_audit = mod.get_custom, mod.write_rich_audit_log
    mod.get_custom = _fake_get
    mod.write_rich_audit_log = _fake_audit
    try:
        out = set_bound_checks(
            _FakeDB(), 1, "CUST-MFA",
            [" github.org_2fa_required ", "aws.root_mfa", "", "aws.root_mfa"],
            actor_id=1,
        )
        assert out is nc
        assert nc.bound_check_ids == ["github.org_2fa_required", "aws.root_mfa"]
        assert calls["audit"] == 1
    finally:
        mod.get_custom = orig_get
        mod.write_rich_audit_log = orig_audit
