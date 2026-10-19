"""An archived document is withdrawn (D29): nobody changes it - its text, file, details, versions, gap fixes, statements written
back, the AI Studio - until it is restored; restoring and archiving keep working, and once restored it is changed again as a draft.
Bulk changes refuse archived documents too, so the Archived list cannot approve or publish them past Restore."""
from datetime import datetime

import pytest
from fastapi import HTTPException

import grc.models as m
from grc.modules.governance import doc_sync, permissions
from grc.modules.governance.routers.documents import _snapshot_content_version
from grc.modules.governance.studio import service

from test_governance_permissions import ADMIN, EDITOR, OWNER, PUBLISHER, SAM, TEXT, doc, world  # noqa: F401  (world is a fixture)

LOCKED = (409, permissions.ARCHIVED_LOCKED)


@pytest.fixture
def archived(world, monkeypatch):
    monkeypatch.setattr("grc.services.ai_gateway.claude_client.configured", lambda: False)     # the rule decides major/minor
    world.me["id"] = OWNER
    sid = world.http.post("/governance/studio/sessions", json={"kind": "library", "document_id": 5}).json()["id"]
    world.http.put(f"/governance/studio/sessions/{sid}/content", json={"content": TEXT + "\nA change.\n", "base_revision": 1})
    db = world.db
    d = doc(world)
    d.content = TEXT + "\n\n## Gap\n\nA new clause.\n"
    db.add(m.GovernanceDocumentVersion(id=1, document_id=5, version_number="1.0", change_type="baseline", title="Access policy",
                                       content=TEXT, status="current", created_by=OWNER))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=SAM, added_by=OWNER))
    f = db.get(m.PolicyGapFinding, 1)                         # a gap fix applied before it was archived
    f.applied_at, f.applied_clause_text, f.replacement_mode = datetime.utcnow(), "A new clause.", "append"
    db.commit()
    world.me["id"] = EDITOR
    assert world.http.post("/governance/documents/bulk-archive", json={"document_ids": [5]}).status_code == 200
    world.sid = sid
    return world


def _same(world, before):
    d = doc(world)
    assert (d.status, d.title, d.content, d.current_version, d.owner_id, d.next_review_date) == before
    assert world.db.query(m.GovernanceDocumentVersion).filter_by(document_id=5).count() == 1


def _state(world):
    d = doc(world)
    return d.status, d.title, d.content, d.current_version, d.owner_id, d.next_review_date


def test_every_route_that_changes_a_document_refuses_an_archived_one(archived):
    w, before = archived, _state(archived)
    w.me["id"] = ADMIN                                         # may do anything, but not to an archived document
    for method, path, kw in [
        ("put", "/governance/documents/5", {"json": {"title": "Renamed"}}),
        ("put", "/governance/documents/5", {"json": {"content": TEXT + "\nMore.\n"}}),
        ("post", "/governance/documents/5/signoff", {"json": {"signoffs": [], "classification": "restricted"}}),
        ("post", "/governance/documents/5/upload-file", {"files": {"file": ("p.pdf", b"%PDF-1.4", "application/pdf")}}),
        ("put", "/governance/documents/5/status", {"json": {"status": "published"}}),
        ("put", "/governance/documents/5/status", {"json": {"status": "draft"}}),
        ("post", "/governance/versions/document/5", {"json": {"change_type": "minor", "content": "x"}}),
        ("post", "/governance/versions/document/5/rollback/1", {"json": {}}),
        ("post", "/governance/documents/5/change-chain/revert", {"json": {"from_version_id": 1, "hunks": [1]}}),
        ("post", "/governance/gap-analysis/findings/1/apply-fix", {"json": {"proposed_text": "Another clause.", "mode": "append"}}),
        ("put", "/governance/gap-analysis/findings/1/override", {"json": {"override_status": "not_addressed", "override_justification": "undo"}}),
        ("post", "/governance/studio/documents/5/draft", {"json": {}}),
        ("post", "/governance/documents/5/signoff/send-for-review", {}),             # not out of the archive into review
        ("post", "/governance/workflows/documents/5/start", {"json": {}}),           # nor by the older approval requests
        ("post", "/governance/documents/5/start-workflow", {"json": {}}),
        ("post", "/governance/documents/5/start-review", {"json": {}}),              # a periodic review moves its review dates
        ("post", "/governance/documents/5/complete-review", {"json": {}}),
    ]:
        r = getattr(w.http, method)(path, **kw)
        assert (r.status_code, r.json().get("detail")) == LOCKED, (path, r.text)
    _same(w, before)
    assert w.db.get(m.PolicyGapFinding, 1).applied_at is not None             # the fix was not taken back either
    assert w.db.query(m.PolicyReviewHistory).filter_by(document_id=5).count() == 0
    assert w.db.query(m.DocumentWorkflowInstance).filter_by(document_id=5).count() == 0


def test_bulk_changes_refuse_archived_documents_naming_them(archived):
    w, before = archived, _state(archived)
    w.me["id"] = ADMIN
    for path, body in [("/governance/documents/bulk-update-status", {"document_ids": [5, 6], "status": "approved"}),
                       ("/governance/documents/bulk-update-status", {"document_ids": [5], "status": "draft"}),
                       ("/governance/documents/bulk-publish", {"document_ids": [5]}),
                       ("/governance/documents/bulk-assign-owner", {"document_ids": [5, 6], "owner_id": PUBLISHER}),
                       ("/governance/documents/bulk-set-review-date", {"document_ids": [5], "next_review_date": "2027-01-01T00:00:00"})]:
        r = w.http.post(path, json=body)
        assert r.status_code == 409, (path, r.text)
        assert r.json()["detail"] == f'Nothing was changed: "Access policy" is archived. {permissions.RESTORE_FIRST}', path
    _same(w, before)
    assert (doc(w, 6).status, doc(w, 6).owner_id) == ("draft", SAM)            # all or nothing: the other one is untouched
    assert w.http.post("/governance/documents/bulk-archive", json={"document_ids": [5, 6]}).status_code == 200    # archiving still works
    assert doc(w, 6).status == "archived"


def test_the_ai_studio_does_not_write_an_archived_document(archived):
    w, before = archived, _state(archived)
    w.me["id"] = OWNER
    r = w.http.post(f"/governance/studio/sessions/{w.sid}/save-to-document", json={"force": True})
    assert (r.status_code, r.json()["detail"]) == LOCKED
    s, owner = w.db.get(m.StudioSession, w.sid), w.db.get(m.GRCUser, OWNER)
    got = service.version_after_accept(w.db, s, owner, 1)                     # an accept stays in the studio and says so
    assert got["saved"] is False and got["why"].startswith(permissions.ARCHIVED_LOCKED)
    access = w.http.get("/governance/studio/documents/5/access").json()
    assert (access["openable"], access["reason"]) == (False, permissions.ARCHIVED_LOCKED)    # Edit in Comply AI Studio is disabled
    d = doc(w)
    for call in (lambda: service.write_file_version(w.db, d, owner, b"x", change_type="minor", summary="s", reason=None, done="d"),
                 lambda: _snapshot_content_version(w.db, d, old_content=TEXT, old_title=d.title, old_version="1.0", change_type="minor",
                                                   change_reason=None, user_id=OWNER),
                 lambda: doc_sync.apply(w.db, d, owner)):                       # statements written back into the file
        with pytest.raises(HTTPException) as e:
            call()
        assert (e.value.status_code, e.value.detail) == LOCKED
    w.db.rollback()
    _same(w, before)


def test_once_restored_it_is_changed_again_as_a_draft(archived):
    w = archived
    w.me["id"] = OWNER
    assert w.http.post("/governance/documents/5/restore").status_code == 200
    r = w.http.put("/governance/documents/5", json={"title": "Access policy (restored)"})
    assert r.status_code == 200 and doc(w).title == "Access policy (restored)"
    access = w.http.get("/governance/studio/documents/5/access").json()
    assert access["openable"] is True and access["reason"] is None
    r = w.http.post(f"/governance/studio/sessions/{w.sid}/save-to-document", json={"force": True})
    assert r.status_code == 200, r.text
    assert doc(w).status == "draft" and doc(w).content == TEXT + "\nA change.\n"
