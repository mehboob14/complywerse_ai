"""DB-free unit tests for SCF Stage H assurance helpers."""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_soa_oscal_profile_shape():
    from grc.modules.scf.assurance import soa_oscal_profile

    scope = SimpleNamespace(
        id=7,
        name="Default",
        framework_slugs=["soc2", "iso_27001"],
        target_cmm=3,
    )
    snapshot = {
        "built_at": "2026-09-15T00:00:00Z",
        "framework_slugs": ["soc2", "iso_27001"],
        "controls": [
            {"scf_id": "GOV-01", "is_applicable": True, "reason": None},
            {"scf_id": "FAC-01", "is_applicable": False, "reason": "no facilities"},
            {"scf_id": "IAC-06", "is_applicable": True, "reason": None},
        ],
    }
    out = soa_oscal_profile(snapshot, scope)
    assert "profile" in out
    profile = out["profile"]
    assert profile["uuid"] == "soa-scope-7"
    assert "metadata" in profile
    assert len(profile["imports"]) == 2
    assert profile["imports"][0]["framework_slug"] == "soc2"
    merge = profile["merge"]
    include_ids = {c["control-id"] for c in merge["include-controls"]}
    assert include_ids == {"GOV-01", "IAC-06"}
    exclude = merge["exclude-controls"]
    assert len(exclude) == 1
    assert exclude[0]["control-id"] == "FAC-01"
    assert exclude[0]["remarks"] == "no facilities"
    assert profile["modify"]["set-parameters"][0]["param-id"] == "cmm_target"


def test_framework_status_returns_keys_with_indicative_flag(monkeypatch):
    from grc.modules.scf import assurance as mod

    scope = SimpleNamespace(id=1, release_id=9, framework_slugs=["soc2"])

    monkeypatch.setattr(mod, "get_applicable_scf_ids", lambda *a, **k: {"GOV-01", "IAC-06", "OTH-01"})
    monkeypatch.setattr(mod, "_mapped_scf_ids_for_slug", lambda *a, **k: {"GOV-01", "IAC-06"})
    monkeypatch.setattr(mod, "_covers_scf_ids", lambda: {"IAC-06"})
    monkeypatch.setattr(mod, "_scf_ids_with_check_results", lambda *a, **k: set())

    st_gov = SimpleNamespace(
        scf_id="GOV-01",
        designation="satisfactory",
        linked_evidence_ids=[1],
    )
    st_iac = SimpleNamespace(
        scf_id="IAC-06",
        designation="not_assessed",
        linked_evidence_ids=None,
    )
    monkeypatch.setattr(
        mod,
        "_states_by_scf",
        lambda *a, **k: {"GOV-01": st_gov, "IAC-06": st_iac},
    )

    out = mod.framework_status(MagicMock(), tenant_id=1, scope=scope, framework_slug="soc2")
    for key in (
        "automation_coverage_pct",
        "evidence_coverage_pct",
        "indicative_conformity_pct",
        "applicable_count",
        "not_assessed_count",
        "controls_with_checks",
        "framework_slug",
        "label",
        "indicative",
        "conformity_basis",
    ):
        assert key in out, key
    assert out["indicative"] is True
    assert out["conformity_basis"] == "INDICATIVE"
    assert out["framework_slug"] == "soc2"
    assert out["applicable_count"] == 2
    assert out["controls_with_checks"] == 1  # IAC-06 via covers
    assert out["not_assessed_count"] == 1
    assert out["automation_coverage_pct"] == 50.0
    # evidence: GOV has evidence+designation; IAC has neither → 1/2
    assert out["evidence_coverage_pct"] == 50.0
    # conformity: of assessed (GOV only), 1/1 satisfactory
    assert out["indicative_conformity_pct"] == 100.0


def test_freeze_sets_soa_snapshot_conceptually():
    from grc.models import SCFControlState, SCFScope
    from grc.modules.scf.assurance import freeze_audit_period

    scope = SimpleNamespace(
        id=3,
        name="Default",
        framework_slugs=["soc2"],
        target_cmm=3,
    )
    period = SimpleNamespace(
        id=11,
        tenant_id=1,
        scope_id=3,
        soa_snapshot=None,
        frozen_at=None,
        frozen_by=None,
        status="open",
    )

    state_row = SimpleNamespace(
        scf_id="GOV-01",
        is_applicable=True,
        applicability_source="derived",
        applicability_reason=None,
        obligation="MCR",
        designation="not_assessed",
        owner_user_id=5,
    )

    class _StateQ:
        def filter(self, *a, **k):
            return self

        def order_by(self, *a, **k):
            return self

        def all(self):
            return [state_row]

    class _ScopeQ:
        def filter(self, *a, **k):
            return self

        def first(self):
            return scope

    class _DB:
        def query(self, model):
            if model is SCFScope:
                return _ScopeQ()
            if model is SCFControlState:
                return _StateQ()
            return _StateQ()

        def flush(self):
            pass

    out = freeze_audit_period(_DB(), period, actor_id=42)
    assert out is period
    assert period.soa_snapshot is not None
    assert period.soa_snapshot["count"] == 1
    assert period.soa_snapshot["controls"][0]["scf_id"] == "GOV-01"
    assert period.frozen_by == 42
    assert isinstance(period.frozen_at, datetime)
    assert period.status == "open"  # freeze does not close
