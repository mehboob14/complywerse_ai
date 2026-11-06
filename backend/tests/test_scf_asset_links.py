"""DB-free unit tests for SCF Stage F asset-link helpers.

Canonical link table ``grc_asset_control_links`` (``AssetControlLink``) has
only ``asset_id`` + ``normalized_control_id``. Per-asset check status is an
indicator — never mutates scores.
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


def test_asset_control_link_columns_documented():
    """AssetControlLink is asset_id + normalized_control_id only (no scf_id FK)."""
    from grc.models._14_it_asset_inventory import AssetControlLink

    cols = {c.name for c in AssetControlLink.__table__.columns}
    assert "asset_id" in cols
    assert "normalized_control_id" in cols
    assert "scf_id" not in cols
    assert "framework_control_id" not in cols
    # id is the PK; nothing else for Stage F canonical link
    assert cols <= {"id", "asset_id", "normalized_control_id"}


def test_resource_candidates_arn_and_aws_short():
    from grc.modules.scf.asset_links import _resource_candidates

    arn = "arn:aws:ec2:us-east-1:123456789012:instance/i-0abc"
    cands = _resource_candidates(arn)
    assert arn in cands
    assert "i-0abc" in cands
    assert "aws:ec2:i-0abc" in cands

    short = "aws:ec2:i-0abc"
    short_cands = _resource_candidates(short)
    assert short in short_cands
    assert "i-0abc" in short_cands

    assert _resource_candidates("") == []
    assert _resource_candidates("  ") == []


def test_match_asset_by_resource_uses_candidates(monkeypatch):
    """With a fake DB, matching prefers external_id then cloud/host fields."""
    from grc.modules.scf import asset_links as mod

    calls = []

    class _Q:
        def __init__(self, result=None):
            self._result = result

        def filter(self, *a, **k):
            return self

        def first(self):
            return self._result

    class _DB:
        def query(self, *cols):
            # First queries hit AssetExternalIdentity — return None, then ITAsset hit
            calls.append(cols)
            if len(calls) <= 2:
                return _Q(None)
            # ITAsset.id query — return (42,)
            return _Q((42,))

    # Force candidates so we exercise the ITAsset path
    monkeypatch.setattr(mod, "_resource_candidates", lambda r: ["i-0abc"])
    assert mod.match_asset_by_resource(_DB(), tenant_id=1, resource="i-0abc") == 42


def test_per_asset_check_status_returns_string_never_mutates():
    from grc.modules.scf.asset_links import per_asset_check_status

    # No db / empty → unknown (does not raise, does not write)
    sentinel = SimpleNamespace(residual_score=9.5, criticality_score=3.0)
    out = per_asset_check_status(None, 1, "GOV-01", 99)
    assert isinstance(out, str)
    assert out == "unknown"
    assert sentinel.residual_score == 9.5
    assert sentinel.criticality_score == 3.0

    # Signature must not accept score mutation knobs
    sig = inspect.signature(per_asset_check_status)
    for forbidden in ("residual", "score", "criticality"):
        assert forbidden not in sig.parameters


def test_per_asset_check_status_empty_scf_id():
    from grc.modules.scf.asset_links import per_asset_check_status

    class _DB:
        def query(self, *a, **k):
            raise AssertionError("should not query when scf_id empty")

    assert per_asset_check_status(_DB(), 1, "", 1) == "unknown"
    assert per_asset_check_status(_DB(), 1, "  ", 1) == "unknown"


def test_aggregate_and_normalize_status_helpers():
    from grc.modules.scf.asset_links import _aggregate_statuses, _normalize_status

    assert _normalize_status("pass") == "passed"
    assert _normalize_status("FAIL") == "failed"
    assert _aggregate_statuses([]) == "not_run"
    assert _aggregate_statuses(["pass", "pass"]) == "passed"
    assert _aggregate_statuses(["fail"]) == "failed"
    assert _aggregate_statuses(["pass", "fail"]) == "partial"
