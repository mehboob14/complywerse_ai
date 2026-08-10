"""Phase 4 — first-appearance durability + the no-stamp guard.

  * persist_snapshot stamps first_seen first-write-wins (never updated), with
    the inaugural-backfill marker set on the tenant's first-ever snapshot;
  * stamp_first_seen=False persists the snapshot but leaves the append-only
    fact table untouched (the mandatory setting for synthetic verification).
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    ReachabilitySnapshot, ReachabilityStep,
    ChokePointSnapshot, ChokePointEntry, ChokePointFirstSeen,
)
from grc.services.choke_points import persist_snapshot

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ReachabilitySnapshot, ReachabilityStep,
              ChokePointSnapshot, ChokePointEntry, ChokePointFirstSeen):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


_id = [0]
def _viable(db, vuln, asset):
    _id[0] += 1
    db.add(ReachabilitySnapshot(id=_id[0], tenant_id=TENANT, vulnerability_id=vuln,
                                asset_id=asset, verdict="possible", content_hash=f"h{_id[0]}",
                                assessed_at=datetime.utcnow()))


def test_first_seen_stamped_inaugural(db):
    _viable(db, 10, 1); _viable(db, 10, 2)
    persist_snapshot(db, TENANT)
    db.commit()
    fs = db.query(ChokePointFirstSeen).filter_by(vulnerability_id=10).one()
    assert fs.is_inaugural_backfill is True  # tenant's first snapshot = backfill


def test_first_write_wins_never_updated(db):
    _viable(db, 10, 1)
    persist_snapshot(db, TENANT); db.commit()
    first = db.query(ChokePointFirstSeen).filter_by(vulnerability_id=10).one()
    t0 = first.first_in_snapshot_at
    # a later snapshot must NOT move the stamp
    persist_snapshot(db, TENANT); db.commit()
    again = db.query(ChokePointFirstSeen).filter_by(vulnerability_id=10).one()
    assert again.first_in_snapshot_at == t0
    assert again.is_inaugural_backfill is True  # not re-marked by the 2nd snapshot


def test_second_snapshot_not_inaugural(db):
    _viable(db, 10, 1)
    persist_snapshot(db, TENANT); db.commit()        # inaugural
    _viable(db, 11, 1)
    persist_snapshot(db, TENANT); db.commit()        # not inaugural
    fs11 = db.query(ChokePointFirstSeen).filter_by(vulnerability_id=11).one()
    assert fs11.is_inaugural_backfill is False        # 11 appeared post-launch


def test_no_stamp_flag_leaves_fact_table_untouched(db):
    _viable(db, 99, 1); _viable(db, 99, 2)
    persist_snapshot(db, TENANT, stamp_first_seen=False)
    db.commit()
    # the snapshot + entries exist, but NO first_seen row was written
    assert db.query(ChokePointSnapshot).count() == 1
    assert db.query(ChokePointEntry).count() == 1
    assert db.query(ChokePointFirstSeen).count() == 0
