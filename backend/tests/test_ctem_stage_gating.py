"""Gated CTEM loop — the stage ladder is strict and server-stamped.

Scope → Discover → Prioritise → Validate → Mobilise: a stage cannot be stamped
before its predecessor; Validate is stamped by the AI mapping run's completion
(never by hand), which is what unlocks Mobilise.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import CtemScope, CtemCycle
from grc.services.ctem_scopes import advance_stage, stamp_validate_stage

TENANT = 1


@pytest.fixture
def db():
    e = create_engine("sqlite://")
    for m in (CtemScope, CtemCycle):
        m.__table__.create(e)
    s = sessionmaker(bind=e)()
    s.add(CtemScope(id=1, tenant_id=TENANT, name="Workstations", membership_rule={}))
    s.commit()
    yield s
    s.close()


def test_no_open_cycle_blocks_the_loop(db):
    with pytest.raises(LookupError):
        advance_stage(db, TENANT, 1, "discover")


def test_ladder_is_sequential(db):
    db.add(CtemCycle(id=10, tenant_id=TENANT, scope_id=1, status="open")); db.commit()
    with pytest.raises(ValueError):
        advance_stage(db, TENANT, 1, "prioritise")          # discover not run yet
    out = advance_stage(db, TENANT, 1, "discover"); db.commit()
    assert "discover" in out["stage_progress"]
    out = advance_stage(db, TENANT, 1, "prioritise"); db.commit()
    assert "prioritise" in out["stage_progress"]
    # idempotent — the first timestamp stands
    t1 = out["stage_progress"]["discover"]
    assert advance_stage(db, TENANT, 1, "discover")["stage_progress"]["discover"] == t1
    with pytest.raises(ValueError):
        advance_stage(db, TENANT, 1, "mobilise")            # unknown stage


def test_validate_is_stamped_by_the_mapping_run(db):
    db.add(CtemCycle(id=10, tenant_id=TENANT, scope_id=1, status="open")); db.commit()
    stamp_validate_stage(db, TENANT, 1); db.commit()
    cyc = db.query(CtemCycle).get(10)
    assert "validate" in (cyc.stage_progress or {})          # Mobilise now unlocks
    # implied predecessors are backfilled so the strip reads sanely
    assert "discover" in cyc.stage_progress and "prioritise" in cyc.stage_progress


def test_validate_stamp_ignores_closed_cycles(db):
    db.add(CtemCycle(id=11, tenant_id=TENANT, scope_id=1, status="closed")); db.commit()
    stamp_validate_stage(db, TENANT, 1); db.commit()         # no open cycle — no-op, no raise
    assert (db.query(CtemCycle).get(11).stage_progress or {}) == {}
