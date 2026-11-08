"""The control work items and tests the Compliance and Assurance scorecards score - read, never written.

Both scorecards used to call ``sync_internal_control_work_items`` + ``db.flush()`` inside their GET: every internal control that had
no work item got one (with a copy of its tests) so the control would be scored, and the request's session closed without a commit,
so the same rows were inserted and thrown away again on the next request. Here the controls that have no work item yet are scored as
the work item the sync would have made (``workbench._seed_from_internal_control`` + ``_migrate_internal_children``), in memory, so every
number stays what it was and nothing is written. A virtual work item has a NEGATIVE id (minus the internal control's id) so it
can never meet a stored one; its tests carry the same id.
"""
from types import SimpleNamespace

from sqlalchemy.exc import SQLAlchemyError

from ...models import ControlWorkItem, ControlWorkTest, InternalControl, InternalControlTest
from .routers.workbench import ensure_tables


def work_rows(db, tenant_ids):
    """``(items, tests)`` for the tenants: the stored work items and tests, plus a virtual one for each internal control that has
    none. Items carry id, tenant_id, source_type, source_id, status, design_effectiveness, operating_effectiveness, last_tested_at,
    next_test_date, is_key_control; tests carry work_item_id, tenant_id, exceptions_found, tester_id, reviewer_id, status."""
    ensure_tables(db)                       # create-if-missing, once per engine: the tables, not a row (as before)
    try:
        items = list(db.query(
            ControlWorkItem.id, ControlWorkItem.tenant_id, ControlWorkItem.source_type, ControlWorkItem.source_id,
            ControlWorkItem.status, ControlWorkItem.design_effectiveness, ControlWorkItem.operating_effectiveness,
            ControlWorkItem.last_tested_at, ControlWorkItem.next_test_date, ControlWorkItem.is_key_control,
        ).filter(ControlWorkItem.tenant_id.in_(tenant_ids)).all())
    except SQLAlchemyError:
        db.rollback()
        items = []
    try:
        tests = list(db.query(
            ControlWorkTest.work_item_id, ControlWorkTest.tenant_id, ControlWorkTest.exceptions_found,
            ControlWorkTest.tester_id, ControlWorkTest.reviewer_id, ControlWorkTest.status,
        ).filter(ControlWorkTest.tenant_id.in_(tenant_ids)).all())
    except SQLAlchemyError:
        db.rollback()
        tests = []

    try:
        have = {(w.tenant_id, w.source_id) for w in items if w.source_type == "internal"}
        controls = [c for c in db.query(
            InternalControl.id, InternalControl.tenant_id, InternalControl.status, InternalControl.design_effectiveness,
            InternalControl.operating_effectiveness, InternalControl.last_tested_at, InternalControl.next_test_date,
            InternalControl.is_key_control,
        ).filter(InternalControl.tenant_id.in_(tenant_ids)).all() if (c.tenant_id, c.id) not in have]
        if controls:
            by_id = {c.id: c for c in controls}
            for c in controls:
                items.append(SimpleNamespace(
                    id=-c.id, tenant_id=c.tenant_id, source_type="internal", source_id=c.id,
                    status=c.status or "draft", design_effectiveness=c.design_effectiveness,
                    operating_effectiveness=c.operating_effectiveness, last_tested_at=c.last_tested_at,
                    next_test_date=c.next_test_date, is_key_control=bool(c.is_key_control)))
            for t in db.query(
                InternalControlTest.control_id, InternalControlTest.tenant_id, InternalControlTest.exceptions_found,
                InternalControlTest.tester_id, InternalControlTest.reviewer_id, InternalControlTest.status,
            ).filter(InternalControlTest.control_id.in_(list(by_id))).all():
                tests.append(SimpleNamespace(
                    work_item_id=-t.control_id, tenant_id=by_id[t.control_id].tenant_id, exceptions_found=t.exceptions_found or 0,
                    tester_id=t.tester_id, reviewer_id=t.reviewer_id, status=t.status or "completed"))
    except SQLAlchemyError:
        db.rollback()
    return items, tests
