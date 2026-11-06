"""DB-free unit tests for SCF Stage E risk-link helpers.

Canonical link table uses ``normalized_control_id`` only
(``grc_risk_control_links``). Decision 4: control status is an indicator —
never mutates residual_score.
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_control_status_indicator_never_mutates_residual():
    from grc.modules.scf.risk_links import control_status_indicator

    risk = SimpleNamespace(residual_score=12.0)
    nc_custom = SimpleNamespace(source="custom", scf_id="CUST-01")
    nc_scf = SimpleNamespace(source="scf", scf_id="GOV-01")

    assert control_status_indicator(None, nc_custom) == "manual"
    assert control_status_indicator(None, nc_scf) == "unknown"  # no tenant_id → unknown
    assert risk.residual_score == 12.0  # untouched


def test_control_status_indicator_returns_string_only():
    from grc.modules.scf.risk_links import control_status_indicator

    out = control_status_indicator(None, SimpleNamespace(source="scf", scf_id="X"))
    assert isinstance(out, str)
    # Decision 4 — helper has no residual / score parameters
    sig = inspect.signature(control_status_indicator)
    assert "residual" not in sig.parameters


def test_ensure_normalized_prefers_existing_nc():
    """Conceptual upsert identity: existing NC with scf_id wins (same id kept)."""
    from grc.modules.scf import risk_links as mod

    existing = SimpleNamespace(id=42, scf_id="GOV-01", source="scf", code="SCF-GOV-01")

    class _Q:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def first(self):
            return existing

    class _DB:
        def query(self, model):
            return _Q()

    out = mod.ensure_normalized_for_control(_DB(), tenant_id=1, scf_id_or_code="GOV-01")
    assert out is existing
    assert out.id == 42


def test_ensure_normalized_raises_when_neither():
    from grc.modules.scf import risk_links as mod

    class _EmptyQ:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def first(self):
            return None

    class _DB:
        def query(self, model):
            return _EmptyQ()

    orig = mod.get_custom
    mod.get_custom = lambda *a, **k: None
    try:
        with pytest.raises(ValueError, match="No SCF or custom"):
            mod.ensure_normalized_for_control(_DB(), tenant_id=1, scf_id_or_code="NOPE")
    finally:
        mod.get_custom = orig


def test_scf_risk_prompts_empty_without_release():
    from grc.modules.scf.risk_links import scf_risk_prompts

    assert scf_risk_prompts(None, None, "GOV-01") == {
        "risks": [],
        "threats": [],
        "risk_if_not_implemented": None,
    }


def test_link_table_uses_normalized_control_id_only():
    """Document: RiskControlLink has normalized_control_id, not scf_id."""
    from grc.models._11_enterprise_risk_management import RiskControlLink

    cols = {c.name for c in RiskControlLink.__table__.columns}
    assert "normalized_control_id" in cols
    assert "scf_id" not in cols
