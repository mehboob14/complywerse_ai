"""The Assurance reads of a control do not write (hard rule 8; audit P-5 of the Controls Automation revamp).

`GET .../assurance` and `GET .../assurance/testing` used to create the control's work item and commit, so a control became "tracked" because somebody browsed it.
They now read the item as it stands (none yet: the shape of an empty one, no id), `POST .../assurance/track` creates it, and every write still creates it itself.
"""
from __future__ import annotations

import inspect
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from grc.models import ControlWorkItem  # noqa: E402
from grc.modules.automation import assurance  # noqa: E402


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    ControlWorkItem.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_a_control_with_no_work_item_reads_as_an_empty_one_and_nothing_is_written(db):
    wi = assurance._work_item_as_it_stands(db, tenant_id=1, nc_id=42)
    assert wi.id is None
    assert wi.implementation_status == "not_started" and wi.priority == "medium" and wi.is_key_control is False
    assert wi.design_effectiveness is None and wi.operating_effectiveness is None and wi.next_test_date is None
    assert not db.new and not db.dirty, "the empty item was not added to the session"
    db.commit()
    assert db.query(ControlWorkItem).count() == 0


def test_an_existing_work_item_is_read_as_it_is(db):
    row = ControlWorkItem(tenant_id=1, source_type="normalized", source_id=42, code="IAC-06", name="MFA", implementation_status="in_progress",
                          design_effectiveness="effective", priority="high", is_key_control=True, assigned_user_ids=[])
    db.add(row)
    db.commit()
    wi = assurance._work_item_as_it_stands(db, tenant_id=1, nc_id=42)
    assert wi.id == row.id and wi.implementation_status == "in_progress" and wi.is_key_control is True
    assert db.query(ControlWorkItem).count() == 1


def test_another_tenants_or_another_controls_item_is_not_this_ones(db):
    db.add(ControlWorkItem(tenant_id=2, source_type="normalized", source_id=42, assigned_user_ids=[]))
    db.add(ControlWorkItem(tenant_id=1, source_type="normalized", source_id=43, assigned_user_ids=[]))
    db.commit()
    assert assurance._work_item_as_it_stands(db, tenant_id=1, nc_id=42).id is None


def test_the_testing_record_of_an_untracked_control_is_empty(db):
    wi = assurance._work_item_as_it_stands(db, tenant_id=1, nc_id=42)
    assert assurance._testing_record(db, wi) == {"procedures": [], "control_files": [], "tests": []}


def test_the_two_reads_never_create_a_work_item():
    for fn in (assurance.get_control_assurance, assurance.get_testing_record):
        source = inspect.getsource(fn)
        assert "_control_work_item" not in source and "_get_or_create_work_item" not in source, fn.__name__
        assert "db.commit()" not in source, f"{fn.__name__} commits"
        assert "_work_item_as_it_stands" in source, fn.__name__


def test_tracking_is_an_explicit_post_that_creates_the_item():
    source = inspect.getsource(assurance.track_control)
    assert "_control_work_item" in source and "db.commit()" in source
    routes = {(r.path, tuple(sorted(r.methods))) for r in assurance.router.routes}
    assert any(p.endswith("/controls/{scf_id}/assurance/track") and m == ("POST",) for p, m in routes)
