"""An archived document is restored as a draft (D29: archived, never deleted): by whoever may change it, only when it is archived,
with a history row and no version of its own (D28); nothing comes back in force and nobody is asked anything until it is sent for
review again. The library lists archived documents for the people who may change them, and the document says when and by whom."""
import grc.models as m
from grc.modules.governance import permissions

from test_governance_permissions import ADMIN, AUTHOR, EDITOR, OWNER, SAM, doc, world  # noqa: F401  (world is a fixture)


def _archive(world, did=5, who=EDITOR):
    world.me["id"] = who
    assert world.http.post("/governance/documents/bulk-archive", json={"document_ids": [did]}).status_code == 200


def _rows(world, action):
    return world.db.query(m.DocumentAuditLog).filter_by(document_id=5, action=action).all()


def test_an_editor_restores_an_archived_document_as_a_draft_without_a_new_version(world):
    _archive(world)
    versions = world.db.query(m.GovernanceDocumentVersion).filter_by(document_id=5).count()
    world.me["id"] = OWNER
    r = world.http.post("/governance/documents/5/restore")
    assert r.status_code == 200, r.text
    assert (r.json()["status"], r.json()["current_version"]) == ("draft", "1.0")
    d = doc(world)
    assert (d.status, d.current_version, d.published_version) == ("draft", "1.0", None)
    assert world.db.query(m.GovernanceDocumentVersion).filter_by(document_id=5).count() == versions
    [row] = _rows(world, "restored")
    assert (row.performed_by, row.field_changed, row.old_value, row.new_value) == (OWNER, "status", "archived", "draft")
    assert "restored from the archive" in row.action_details.lower()
    events = world.http.get("/governance/documents/5/change-chain").json()["events"]
    assert [(e["kind"], e["to"]) for e in events if e["kind"] in ("archived", "restored")] == [("archived", "archived"), ("restored", "draft")]


def test_someone_who_may_not_change_it_cannot_restore_it(world):
    _archive(world)
    world.me["id"] = SAM
    r = world.http.post("/governance/documents/5/restore")
    assert r.status_code == 403 and r.json()["detail"] == permissions.EDIT_REFUSED
    assert doc(world).status == "archived" and not _rows(world, "restored")


def test_only_an_archived_document_is_restored(world):
    world.me["id"] = EDITOR
    for status in ("draft", "pending_review", "published"):
        d = doc(world)
        d.status = status
        world.db.commit()
        r = world.http.post("/governance/documents/5/restore")
        assert r.status_code == 409 and r.json()["detail"] == "Only an archived document can be restored.", status
        assert doc(world).status == status
    assert not _rows(world, "restored")
    assert world.http.post("/governance/documents/404/restore").status_code == 404


def test_restoring_brings_nothing_back_in_force_and_asks_nobody_until_it_is_sent_for_review(world):
    world.me["id"] = ADMIN
    assert world.http.put("/governance/documents/5/status", json={"status": "published"}).status_code == 200
    O = m.DocumentObligation
    assert world.db.query(O).filter_by(document_id=5, kind="acknowledgement", status="pending").count() > 0
    _archive(world, who=ADMIN)                                              # withdrawn: the acknowledgements are cancelled
    assert world.db.query(O).filter_by(document_id=5, status="pending").count() == 0
    assert world.http.post("/governance/documents/5/restore").status_code == 200
    d = doc(world)
    assert (d.status, d.published_version, d.last_published_version) == ("draft", None, "1.0")
    assert permissions.in_force_number(d) is None                          # it is reviewed, approved and published again first
    assert world.db.query(O).filter_by(document_id=5, status="pending").count() == 0
    assert world.http.get("/governance/documents/5").json()["version_in_force"] is None


def test_archiving_an_archived_document_again_changes_nothing(world):
    _archive(world, who=EDITOR)
    _archive(world, who=OWNER)                                             # e.g. picked again in the library's Archived list
    assert len(_rows(world, "archived")) == 1
    world.me["id"] = OWNER
    assert world.http.get("/governance/documents/5").json()["archived_by_name"] == "Eddie Editor"


def test_the_library_lists_archived_documents_for_who_may_change_them_and_the_document_says_when_and_by_whom(world):
    world.me["id"] = EDITOR
    got = world.http.get("/governance/documents/5").json()
    assert "archived_at" not in got and "archived_by_name" not in got
    _archive(world)
    for who in (EDITOR, OWNER, AUTHOR, ADMIN):
        world.me["id"] = who
        listed = {i["id"]: i["status"] for i in world.http.get("/governance/documents").json()["items"]}
        assert listed.get(5) == "archived", who
    world.me["id"] = SAM                                                   # a draft never published, not his: not listed
    assert 5 not in {i["id"] for i in world.http.get("/governance/documents").json()["items"]}
    world.me["id"] = OWNER
    got = world.http.get("/governance/documents/5").json()
    assert got["archived_by_name"] == "Eddie Editor" and got["archived_at"]
    assert world.http.post("/governance/documents/5/restore").status_code == 200
    assert "archived_at" not in world.http.get("/governance/documents/5").json()
