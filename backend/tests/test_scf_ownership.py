"""DB-free unit tests for SCF Stage C ownership helpers."""
from __future__ import annotations

import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_compute_next_due_quarterly():
    from grc.modules.scf.ownership import CADENCE_DAYS, compute_next_due

    base = datetime(2026, 1, 1, 12, 0, 0)
    due = compute_next_due(base, "Quarterly")
    assert due == base + timedelta(days=CADENCE_DAYS["Quarterly"])


def test_compute_next_due_missing_returns_none():
    from grc.modules.scf.ownership import CADENCE_DAYS, compute_next_due

    assert compute_next_due(None, "Annual") is None
    # Unknown / blank cadence defaults to Annual so first assign always gets a due date.
    base = datetime(2026, 6, 1)
    assert compute_next_due(base, "Unknown") == base + timedelta(days=CADENCE_DAYS["Annual"])
    assert compute_next_due(base, None) == base + timedelta(days=CADENCE_DAYS["Annual"])


def test_compute_next_due_all_cadences():
    from grc.modules.scf.ownership import CADENCE_DAYS, compute_next_due

    base = datetime(2026, 3, 1)
    for label, days in CADENCE_DAYS.items():
        assert compute_next_due(base, label) == base + timedelta(days=days)


def test_refuse_self_approval():
    from grc.modules.scf.ownership import refuse_self_approval

    refuse_self_approval(1, 2)  # ok
    refuse_self_approval(None, 1)
    refuse_self_approval(1, None)
    with pytest.raises(ValueError):
        refuse_self_approval(5, 5)


def test_refuse_artifact_self_approval():
    from grc.modules.scf.ownership import refuse_artifact_self_approval

    refuse_artifact_self_approval(3, 1, 2)
    with pytest.raises(ValueError):
        refuse_artifact_self_approval(1, 1, 2)
    with pytest.raises(ValueError):
        refuse_artifact_self_approval(2, 1, 2)


def test_assigned_user_ids_round_trip_shape():
    from grc.modules.scf.ownership import _as_int_list

    assert _as_int_list([1, "2", 3]) == [1, 2, 3]
    assert _as_int_list(None) == []
    assert _as_int_list("[4, 5]") == [4, 5]
    assert _as_int_list(["x", 7]) == [7]
