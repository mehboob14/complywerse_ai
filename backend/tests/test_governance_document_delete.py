"""Deleting a governance document must not trip over rows that point at it.

Deleting a parsed document failed with a foreign-key violation: its statements
were cascaded away while their control mappings still pointed at them. The same
held for gap analysis runs, attestations, sign-offs and more, and internal
controls merely linked to the document were deleted with it.
"""
from types import SimpleNamespace

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.governance.routers.documents import (
    _DELETE_WITH_DOCUMENT, _UNLINK_FROM_DOCUMENT, delete_document,
)


def _cascaded(cls, seen):
    for rel in inspect(cls).relationships:
        if rel.cascade.delete and rel.mapper.local_table.name not in seen:
            seen.add(rel.mapper.local_table.name)
            _cascaded(rel.mapper.class_, seen)
    return seen


def _name(attr):
    return f"{attr.class_.__tablename__}.{attr.key}"


def test_every_reference_to_a_deleted_row_is_listed():
    cascaded = _cascaded(m.GovernanceDocument, {m.GovernanceDocument.__tablename__})
    bulk = {a.class_.__tablename__ for a in _DELETE_WITH_DOCUMENT}
    listed = {_name(a) for a in _DELETE_WITH_DOCUMENT + _UNLINK_FROM_DOCUMENT}
    listed.add("grc_governance_documents.parent_document_id")  # delete is refused while children exist
    missing = [
        f"{t.name}.{fk.parent.name} -> {fk.column.table.name}"
        for t in m.Base.metadata.sorted_tables for fk in t.foreign_keys
        if fk.column.table.name in cascaded | bulk
        # the ORM orders deletes among cascaded rows itself; bulk deletes run first
        and not (t.name in cascaded and fk.column.table.name in cascaded)
        and f"{t.name}.{fk.parent.name}" not in listed
    ]
    assert not missing, missing


def test_bulk_deletes_run_before_the_tables_they_point_at():
    first = {}
    for i, attr in enumerate(_DELETE_WITH_DOCUMENT):
        first.setdefault(attr.class_.__tablename__, i)
    for table, i in first.items():
        for fk in m.Base.metadata.tables[table].foreign_keys:
            target = fk.column.table.name
            assert target == table or first.get(target, len(first) + 99) > i, f"{table} must go before {target}"


def test_deleting_a_parsed_document_removes_its_rows_and_unlinks_controls():
    engine = create_engine("sqlite://")
    event.listen(engine, "connect", lambda conn, _: conn.execute("PRAGMA foreign_keys=ON"))
    m.Base.metadata.create_all(engine)

    with Session(engine) as db:
        db.add(m.Tenant(id=1, name="Acme", slug="acme"))
        db.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy"))
        db.add(m.PolicyStatement(id=87, tenant_id=1, document_id=5, statement_text="MFA for admins"))
        db.add(m.StatementControlMapping(tenant_id=1, statement_id=87, control_kind="normalized", control_code="IAC-06"))
        db.add(m.PolicyGapAnalysisRun(id=3, tenant_id=1, document_id=5))
        db.add(m.PolicyGapFinding(tenant_id=1, analysis_run_id=3, document_id=5, applied_statement_id=87))
        db.add(m.InternalControl(id=9, tenant_id=1, control_id="IC-9", name="Admin MFA",
                                 source_document_id=5, source_statement_id=87))
        db.commit()

        delete_document(document_id=5, db=db, current_user=SimpleNamespace())

        assert db.get(m.GovernanceDocument, 5) is None
        for model in (m.PolicyStatement, m.StatementControlMapping, m.PolicyGapAnalysisRun, m.PolicyGapFinding):
            assert db.query(model).count() == 0, model.__name__
        control = db.get(m.InternalControl, 9)
        assert (control.source_document_id, control.source_statement_id) == (None, None)
