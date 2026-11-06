"""DB-free unit tests for SCF Stage D custom-control helpers."""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_validate_code_accepts_valid():
    from grc.modules.scf.custom_controls import validate_code

    assert validate_code("  my.ctrl-01  ") == "MY.CTRL-01"
    assert validate_code("ab") == "AB"
    assert validate_code("A" * 48) == "A" * 48


def test_validate_code_rejects_bad_format():
    from grc.modules.scf.custom_controls import validate_code

    with pytest.raises(ValueError):
        validate_code("")
    with pytest.raises(ValueError):
        validate_code("a")
    with pytest.raises(ValueError):
        validate_code("BAD CODE")
    with pytest.raises(ValueError):
        validate_code("has/slash")
    with pytest.raises(ValueError):
        validate_code("A" * 49)


def test_validate_code_collision_with_scf_catalog_ids():
    from grc.modules.scf.custom_controls import validate_code

    catalog = {"GOV-01", "IAC-06.2", "AAT-01"}
    assert validate_code("TENANT-CTRL-1", existing_scf_ids=catalog) == "TENANT-CTRL-1"
    with pytest.raises(ValueError, match="collides"):
        validate_code("gov-01", existing_scf_ids=catalog)
    with pytest.raises(ValueError, match="collides"):
        validate_code("IAC-06.2", existing_scf_ids=catalog)


def test_retire_custom_sets_retired_at_on_object():
    """Conceptual retire: stamp retired_at without deleting.

    It also drops the control out of applicability — a retired control must stop
    counting in scope totals — which is why the fake DB answers queries.
    """
    from grc.modules.scf.custom_controls import retire_custom

    state = SimpleNamespace(is_applicable=True, applicability_reason=None, updated_at=None)

    class _FakeQuery:
        def filter(self, *_a, **_k):
            return self

        def first(self):
            return None          # no profile row

        def all(self):
            return [state]       # the control's applicability state

    class _FakeDB:
        def flush(self):
            pass

        def query(self, *_a, **_k):
            return _FakeQuery()

    # Patch only the lookup + audit path so this stays DB-free.
    import grc.modules.scf.custom_controls as mod

    stamp = datetime(2026, 9, 14, 12, 0, 0)
    nc = SimpleNamespace(
        id=7,
        scf_id="CUST-01",
        code="CUST-01",
        tenant_id=1,
        retired_at=None,
        source="custom",
    )
    calls = {"audit": 0}

    def _fake_get(db, tenant_id, code):
        assert code.upper() == "CUST-01" or code == "CUST-01"
        return nc

    def _fake_audit(**kwargs):
        calls["audit"] += 1

    orig_get, orig_audit = mod.get_custom, mod.write_rich_audit_log
    mod.get_custom = _fake_get
    mod.write_rich_audit_log = _fake_audit
    try:
        out = retire_custom(_FakeDB(), 1, "cust-01", actor_id=9, now=stamp)
        assert out is nc
        assert nc.retired_at == stamp
        assert calls["audit"] == 1
        # It left the library, so it stops counting as applicable.
        assert state.is_applicable is False
        # Idempotent second retire
        out2 = retire_custom(_FakeDB(), 1, "CUST-01", actor_id=9, now=stamp)
        assert out2.retired_at == stamp
        assert calls["audit"] == 1
    finally:
        mod.get_custom = orig_get
        mod.write_rich_audit_log = orig_audit


def test_valid_enum_sets():
    from grc.modules.scf.custom_controls import (
        VALID_CADENCE,
        VALID_PPTDF,
        VALID_SUB_TYPE,
    )

    assert "People" in VALID_PPTDF
    assert "Semi-Annual" in VALID_CADENCE
    assert "Hybrid" in VALID_SUB_TYPE
