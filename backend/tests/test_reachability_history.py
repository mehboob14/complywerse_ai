"""Phase 3 — exploitability assessment history (write-on-material-change).

Locks the contract of the audit record: snapshots write only on a material change
(never per re-render), the header + its steps are one atomic transaction (no orphan
headers), the narration back-fill is a column update that never creates a snapshot
or moves the hash, and first-seen always writes. DB-backed but hermetic — an
in-memory SQLite holding just the two new tables; no Postgres, no network.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ReachabilitySnapshot, ReachabilityStep
from grc.modules.vuln_management.attack.history import (
    attach_narration,
    latest_snapshot,
    record_snapshot,
)
from grc.modules.vuln_management.attack.snapshot import assessment_hash


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    ReachabilitySnapshot.__table__.create(engine)
    ReachabilityStep.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


class _Row:
    def __init__(self, **kw):
        self.__dict__.update(kw)


VULN = _Row(id=1, tenant_id=7)
ASSET = _Row(id=2)


def _view(verdict="likely", techs=None, attack_version="19.1"):
    techs = techs if techs is not None else [
        {"technique_id": "T1190", "status": "likely", "mapping_source": "cvss_derived",
         "mapping_confidence": "high", "assumed": False, "tactic": "initial-access", "why": "kev"},
        {"technique_id": "T1595", "status": "possible", "mapping_source": "cvss_derived",
         "mapping_confidence": "medium", "assumed": False, "tactic": "reconnaissance", "why": "open"},
    ]
    return {
        "verdict": {"verdict": verdict, "verdict_reason": "r", "signal_pct": 50, "data_completeness": 100},
        "chain": techs, "attack_version": attack_version, "evaluated_at": "2026-07-24T00:00:00",
    }


# ── the hash: material only ─────────────────────────────────────────────────
def test_hash_excludes_timestamp():
    a, b = _view(), _view()
    a["evaluated_at"], b["evaluated_at"] = "2026-01-01T00:00:00", "2026-12-31T23:59:59"
    assert assessment_hash(a) == assessment_hash(b)  # timestamp is not material


def test_hash_moves_on_verdict_or_status_change():
    assert assessment_hash(_view(verdict="likely")) != assessment_hash(_view(verdict="unlikely"))
    flipped = [{"technique_id": "T1190", "status": "blocked", "mapping_source": "cvss_derived",
                "mapping_confidence": "high", "assumed": False}]
    assert assessment_hash(_view(techs=flipped)) != assessment_hash(_view(techs=[
        {"technique_id": "T1190", "status": "likely", "mapping_source": "cvss_derived",
         "mapping_confidence": "high", "assumed": False}]))


def test_hash_moves_on_mapping_source_change():
    a = [{"technique_id": "T1190", "status": "likely", "mapping_source": "capec_chain",
          "mapping_confidence": "high", "assumed": False}]
    b = [{"technique_id": "T1190", "status": "likely", "mapping_source": "cvss_derived",
          "mapping_confidence": "high", "assumed": False}]
    assert assessment_hash(_view(techs=a)) != assessment_hash(_view(techs=b))  # provenance is an audit event


# ── write-on-change ─────────────────────────────────────────────────────────
def test_first_seen_writes_unconditionally(db):
    snap, created = record_snapshot(db, 7, VULN, ASSET, _view())
    assert created is True and snap is not None
    assert db.query(ReachabilitySnapshot).count() == 1
    assert db.query(ReachabilityStep).count() == 2
    assert snap.verdict == "likely" and snap.attack_version == "19.1"


def test_unchanged_does_not_write(db):
    record_snapshot(db, 7, VULN, ASSET, _view())
    snap, created = record_snapshot(db, 7, VULN, ASSET, _view())  # identical material
    assert created is False
    assert db.query(ReachabilitySnapshot).count() == 1  # no duplicate row per re-render


def test_material_change_appends_new(db):
    record_snapshot(db, 7, VULN, ASSET, _view(verdict="likely"))
    _, created = record_snapshot(db, 7, VULN, ASSET, _view(verdict="unlikely"))
    assert created is True
    assert db.query(ReachabilitySnapshot).count() == 2
    assert latest_snapshot(db, 1, 2).verdict == "unlikely"  # history keeps both; latest is the flip


def test_steps_carry_provenance(db):
    snap, _ = record_snapshot(db, 7, VULN, ASSET, _view())
    steps = db.query(ReachabilityStep).filter_by(snapshot_id=snap.id).all()
    assert {s.technique_id for s in steps} == {"T1190", "T1595"}
    t1190 = next(s for s in steps if s.technique_id == "T1190")
    assert t1190.mapping_source == "cvss_derived" and t1190.status == "likely" and t1190.tactic == "initial-access"


# ── atomicity: header + steps commit together, or not at all ─────────────────
def test_write_is_atomic_on_step_failure(db):
    # A chain technique with no technique_id violates NOT NULL → the whole write must
    # roll back, leaving NO orphan snapshot header (a header with no steps is corrupt).
    bad = _view(techs=[{"technique_id": None, "status": "likely"}])
    snap, created = record_snapshot(db, 7, VULN, ASSET, bad)
    assert created is False and snap is None
    assert db.query(ReachabilitySnapshot).count() == 0
    assert db.query(ReachabilityStep).count() == 0


# ── narration back-fill is off the change path ──────────────────────────────
def test_attach_narration_updates_only_its_row(db):
    snap, _ = record_snapshot(db, 7, VULN, ASSET, _view())
    hash_before = snap.content_hash
    ok = attach_narration(db, snap, "the attacker injects SQL to dump the table", "gpt-4o-mini")
    assert ok is True
    assert snap.narration.startswith("the attacker") and snap.narration_model == "gpt-4o-mini"
    assert snap.content_hash == hash_before                      # hash untouched
    assert db.query(ReachabilitySnapshot).count() == 1           # no new snapshot from an expand


def test_attach_narration_is_noop_on_empty_or_missing(db):
    snap, _ = record_snapshot(db, 7, VULN, ASSET, _view())
    assert attach_narration(db, snap, "", "m") is False
    assert attach_narration(db, None, "x", "m") is False
    assert db.query(ReachabilitySnapshot).count() == 1
