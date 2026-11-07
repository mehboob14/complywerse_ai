"""SLA engine — ingested-target matching fix (governance/SLA overnight pass).

Regression + coverage for the bug where non-incident tickets got NO SLA due
dates: `_itsm_target` matched only on priority_code, but service_request / change
/ problem target rows carry a NULL priority_code while the ticket carries a real
priority (code P1–P5), so nothing matched and response_by/resolution_by stayed
None (portal: "As soon as we can").

In-memory SQLite harness, mirroring tests/test_itsm_engine.py.
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-sla-match")

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDTicket, HDTicketPriority, HDSLATarget, HDServiceLevelAgreement,
    HDPriorityMatrix,
)
from grc.modules.helpdesk_native import sla
from grc.modules.helpdesk_native.itsm_seed import backfill_sla_target_resolutions
from grc.modules.helpdesk_native.tickets import priority_from_matrix

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (HDTicket, HDTicketPriority, HDSLATarget, HDServiceLevelAgreement,
              HDPriorityMatrix):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _priorities(db):
    rows = {
        "Urgent":   HDTicketPriority(tenant_id=TENANT, name="Urgent",   level="Urgent", code="P1", rank=1),
        "High":     HDTicketPriority(tenant_id=TENANT, name="High",     level="High",   code="P2", rank=2),
        "Medium":   HDTicketPriority(tenant_id=TENANT, name="Medium",   level="Medium", code="P3", rank=3),
        "Low":      HDTicketPriority(tenant_id=TENANT, name="Low",      level="Low",    code="P4", rank=4),
        "Planning": HDTicketPriority(tenant_id=TENANT, name="Planning", level="Low",    code="P5", rank=5),
    }
    for r in rows.values():
        db.add(r)
    db.commit()
    return {k: v.id for k, v in rows.items()}


def _ticket(db, process, priority_id, created=None):
    t = HDTicket(tenant_id=TENANT, subject="x", process=process,
                 status_category="Open", priority_id=priority_id,
                 created_at=created or datetime.utcnow())
    db.add(t)
    db.commit()
    return t


def _seed_live_like_targets(db):
    """The exact shape of the owner's ingested grc_hd_sla_target (the bug repro):
    incident keyed by P1–P5, every other process keyed by label with NULL code and
    (mostly) NULL resolution."""
    rows = [
        ("incident", "P1 – Critical", "P1", "24x7", 15, 240),
        ("incident", "P3 – Medium", "P3", "business hours", 240, 960),
        ("incident", "P4 – Low", "P4", "business hours", 480, 2400),
        ("service_request", "Standard", None, "business hours", 240, None),
        ("change", "Emergency", None, "24x7", None, None),
        ("change", "Normal", None, "business hours", 960, None),
        ("problem", "High", None, "business hours", 480, 43200),
        ("problem", "Normal", None, "business hours", 960, 86400),
    ]
    for i, (proc, label, code, win, resp, reso) in enumerate(rows):
        db.add(HDSLATarget(tenant_id=TENANT, process=proc, priority_label=label,
                           priority_code=code, service_window=win,
                           response_minutes=resp, resolution_minutes=reso,
                           sort_order=i))
    db.commit()


# ─── _itsm_target matching ────────────────────────────────────────────────────
def test_incident_still_matches_by_priority_code(db):
    ids = _priorities(db)
    _seed_live_like_targets(db)
    t = _ticket(db, "incident", ids["Medium"])  # code P3
    tgt = sla._itsm_target(db, t)
    assert tgt is not None and tgt.priority_code == "P3"


def test_service_request_matches_despite_null_priority_code(db):
    # THE BUG: SR ticket carries priority Low (code P4); the SR target row has a
    # NULL priority_code. Before the fix this returned None -> no due dates.
    ids = _priorities(db)
    _seed_live_like_targets(db)
    t = _ticket(db, "service_request", ids["Low"])
    tgt = sla._itsm_target(db, t)
    assert tgt is not None and tgt.priority_label == "Standard"


def test_problem_matches_by_label_when_priority_name_matches(db):
    ids = _priorities(db)
    _seed_live_like_targets(db)
    t = _ticket(db, "problem", ids["High"])  # name 'High' == problem 'High' tier
    tgt = sla._itsm_target(db, t)
    assert tgt is not None and tgt.priority_label == "High"


def test_fallback_prefers_row_with_resolution_clock(db):
    # change rows: Emergency (no clock) then Normal (has response). With resolution
    # still NULL on both, fallback returns the first row with a resolution clock
    # once one exists; until then the lowest-sort_order row.
    ids = _priorities(db)
    _seed_live_like_targets(db)
    t = _ticket(db, "change", ids["Medium"])
    tgt = sla._itsm_target(db, t)
    # no resolution set anywhere yet -> lowest sort_order (Emergency)
    assert tgt is not None and tgt.priority_label == "Emergency"
    # give Normal a resolution clock -> fallback now prefers it
    normal = next(r for r in db.query(HDSLATarget).all() if r.priority_label == "Normal")
    normal.resolution_minutes = 7200
    db.commit()
    assert sla._itsm_target(db, t).priority_label == "Normal"


# ─── end-to-end due dates via recompute ─────────────────────────────────────────
def test_sr_gets_response_and_resolution_after_backfill(db):
    ids = _priorities(db)
    _seed_live_like_targets(db)
    filled = backfill_sla_target_resolutions(db, TENANT)
    assert filled["filled"] >= 1  # SR + change rows had NULLs
    created = datetime.utcnow()
    t = _ticket(db, "service_request", ids["Low"], created=created)
    sla.recompute(db, t)
    assert t.response_by == created + timedelta(minutes=240)      # real response kept
    assert t.resolution_by == created + timedelta(minutes=2400)   # backfilled clock
    assert t.agreement_status == "First Response Due"


def test_backfill_only_fills_nulls_and_is_idempotent(db):
    _priorities(db)
    _seed_live_like_targets(db)
    before = {r.id: (r.response_minutes, r.resolution_minutes)
              for r in db.query(HDSLATarget).all()}
    backfill_sla_target_resolutions(db, TENANT)
    for r in db.query(HDSLATarget).all():
        # a column that was already set is never overwritten
        resp0, reso0 = before[r.id]
        if resp0 is not None:
            assert r.response_minutes == resp0
        if reso0 is not None:
            assert r.resolution_minutes == reso0
        # no column is left NULL
        assert r.response_minutes is not None and r.resolution_minutes is not None
    # second run touches nothing
    assert backfill_sla_target_resolutions(db, TENANT)["filled"] == 0


def test_no_target_for_process_still_clears(db):
    ids = _priorities(db)  # no targets seeded at all
    t = _ticket(db, "problem", ids["Medium"])
    sla.recompute(db, t)
    assert t.response_by is None and t.resolution_by is None


# ─── task #3: priority_from_matrix -> ticket priority -> SLA selection ──────────
def test_matrix_priority_flows_into_sla_selection(db):
    ids = _priorities(db)
    _seed_live_like_targets(db)
    # owner's matrix: high/high -> Urgent (P1)
    db.add(HDPriorityMatrix(tenant_id=TENANT, impact="high", urgency="high",
                            priority_id=ids["Urgent"]))
    db.commit()
    pid = priority_from_matrix(db, TENANT, "high", "high")
    assert pid == ids["Urgent"]
    created = datetime.utcnow()
    t = _ticket(db, "incident", pid, created=created)
    sla.recompute(db, t)
    # the P1 priority the matrix resolved selects the incident P1 target (15/240)
    assert t.response_by == created + timedelta(minutes=15)
    assert t.resolution_by == created + timedelta(minutes=240)
