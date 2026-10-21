"""The library tree shows each document's versions, base first, with who made each and why; restoring a version keeps the
person's why as that version's reason."""
from datetime import datetime, timedelta

from sqlalchemy import event

import grc.models as m
from grc.modules.governance.routers import documents as doc_routes
from grc.modules.governance.routers import versions as version_routes

from test_studio_flow import world                  # noqa: F401  (world is a fixture: documents 10 and its child 11, users 1 and 2)

T0 = datetime(2026, 10, 1, 9, 0)


def _version(db, doc_id, number, at, *, kind="minor", status="superseded", by=1, reason=None, summary=None, content="text", file_path=None):
    row = m.GovernanceDocumentVersion(document_id=doc_id, version_number=number, change_type=kind, title="T", content=content, status=status,
                                      created_by=by, created_at=at, change_reason=reason, change_summary=summary, file_path=file_path)
    db.add(row)
    db.flush()
    return row


def _tree(world, monkeypatch):
    monkeypatch.setattr(doc_routes, "get_user_tenants", lambda user, db: [1])
    return doc_routes.get_document_hierarchy(tenant_id=None, parent_id=None, db=world.db, current_user=world.db.get(m.GRCUser, 1))


def test_the_tree_lists_each_documents_versions_base_first_without_repeats_and_caps_them(world, monkeypatch):
    db = world.db
    _version(db, 10, "1.0", T0, kind="baseline", summary="Baseline snapshot", file_path="/files/orig.docx")
    _version(db, 10, "1.0", T0 + timedelta(minutes=1), summary="Pre-fix snapshot")          # repeats the number before it: not shown
    _version(db, 10, "1.2", T0 + timedelta(hours=2))                                         # made after 1.1, though written first
    _version(db, 10, "1.1", T0 + timedelta(hours=1), by=2, reason="Review frequency", summary="Content edited")
    for n in range(3, 8):                                                                   # 1.3 … 1.7, 1.7 the current one
        _version(db, 10, f"1.{n}", T0 + timedelta(hours=n), status="current" if n == 7 else "superseded", reason="x" * 400)
    db.add(m.GovernanceDocument(id=12, tenant_id=1, title="Zeta Procedure", doc_type="procedure", status="draft", current_version="1.0", parent_document_id=10))
    db.commit()

    statements = []

    def seen(conn, cursor, sql, *rest):
        statements.append(sql)
    event.listen(db.get_bind(), "before_cursor_execute", seen)
    try:
        (root,) = _tree(world, monkeypatch)
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", seen)
    assert root["id"] == 10 and root["version_count"] == 8
    numbers = [v["number"] for v in root["versions"]]
    assert numbers == ["1.0", "1.3", "1.4", "1.5", "1.6", "1.7"]                            # the base, then the newest five
    base, *_, newest = root["versions"]
    assert (base["kind"], base["summary"], base["has_file"], base["current"], base["by"]) == ("baseline", "Baseline snapshot", True, False, "Olivia Owner")
    assert newest["current"] is True and [v["current"] for v in root["versions"]].count(True) == 1
    assert len(newest["reason"]) == 300 and newest["at"].startswith("2026-10-01T16:00")
    assert set(base) == {"id", "number", "kind", "current", "at", "by", "reason", "summary", "has_file"}
    # the children come in a fixed order (type, then title), each with its own versions
    assert [c["id"] for c in root["children"]] == [12, 11] and root["children"][1]["version_count"] == 0 and root["children"][1]["versions"] == []
    # one query of columns: the versions' content is never read for the tree
    assert not [s for s in statements if "grc_governance_document_versions.content" in s]


def test_a_short_history_is_shown_whole_in_the_order_it_was_made(world, monkeypatch):
    db = world.db
    _version(db, 11, "1.0", T0, kind="baseline")
    _version(db, 11, "2.0", T0 + timedelta(hours=2), kind="major", status="current", by=2, reason="New scope")
    _version(db, 11, "1.1", T0 + timedelta(hours=1), reason="Monthly reviews")
    db.commit()
    (root,) = _tree(world, monkeypatch)
    child = next(c for c in root["children"] if c["id"] == 11)
    assert [(v["number"], v["reason"], v["by"]) for v in child["versions"]] == [("1.0", "", "Olivia Owner"), ("1.1", "Monthly reviews", "Olivia Owner"),
                                                                               ("2.0", "New scope", "Sam Other")]
    assert child["version_count"] == 3 and root["version_count"] == 0


def test_restoring_a_version_keeps_the_persons_why_as_its_reason(world, monkeypatch):
    db = world.db
    doc = db.get(m.GovernanceDocument, 11)
    first = _version(db, 11, "1.0", T0, content="# Access Control Standard\n\nAccess to systems is reviewed every year by the system owner and the CISO.\n")
    wrong = "# Access Control Standard\n\nAccess to systems is reviewed every month by the system owner and the CISO.\n"     # a small change: minor
    _version(db, 11, "1.1", T0 + timedelta(hours=1), status="current", content=wrong)
    doc.current_version, doc.content = "1.1", wrong
    db.commit()
    monkeypatch.setattr(version_routes, "get_user_tenants", lambda user, db: [1])
    me = db.get(m.GRCUser, 1)

    out = version_routes.rollback_to_version(document_id=11, version_id=first.id, rollback_data=version_routes.VersionRollback(rollback_reason="  The edit was wrong  "),
                                             db=db, current_user=me)
    row = db.get(m.GovernanceDocumentVersion, out["new_version"]["id"])
    assert (row.version_number, row.change_reason, row.change_summary) == ("1.2", "The edit was wrong", "Rollback to version 1.0: The edit was wrong")
    assert "every year" in db.get(m.GovernanceDocument, 11).content
    wrong_row = db.query(m.GovernanceDocumentVersion).filter_by(document_id=11, version_number="1.1").one()      # the version restored over stays
    assert (wrong_row.status, wrong_row.content) == ("superseded", wrong)

    out = version_routes.rollback_to_version(document_id=11, version_id=first.id, rollback_data=None, db=db, current_user=me)      # no why given
    assert db.get(m.GovernanceDocumentVersion, out["new_version"]["id"]).change_reason == "Rollback from version 1.2 to version 1.0"
