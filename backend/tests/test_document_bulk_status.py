"""A bulk status change never approves, publishes or sends a document for review: approval is its approvers' signatures in its review,
publishing is Publish (bulk Publish for approved documents), review is Send for review. Archiving and the other statuses the screens
set in bulk still work. Over HTTP through the whole governance router, on in-memory SQLite."""
import grc.models as m
from grc.modules.governance.routers.documents import BULK_STATUS_REFUSED

from test_governance_permissions import ADMIN, doc, world  # noqa: F401  (world is a fixture)


def test_a_bulk_status_change_refuses_approved_published_and_the_review_statuses_even_for_an_administrator(world):
    world.me["id"] = ADMIN
    for wanted in ("approved", "published", "pending_review", "pending_approval"):
        r = world.http.post("/governance/documents/bulk-update-status", json={"document_ids": [5, 6], "status": wanted})
        assert r.status_code == 400 and r.json()["detail"] == BULK_STATUS_REFUSED[wanted], wanted
    assert (doc(world, 5).status, doc(world, 6).status) == ("draft", "draft")
    assert world.db.query(m.DocumentAuditLog).count() == 0 and world.db.query(m.DocumentObligation).count() == 0
    assert "Publish" in BULK_STATUS_REFUSED["published"] and "review" in BULK_STATUS_REFUSED["approved"]

    r = world.http.post("/governance/documents/bulk-update-status", json={"document_ids": [5, 6], "status": "archived"})
    assert r.status_code == 200 and (doc(world, 5).status, doc(world, 6).status) == ("archived", "archived")


def test_bulk_publish_still_publishes_approved_documents(world):
    d = doc(world)
    d.status = "approved"
    world.db.commit()
    world.me["id"] = ADMIN
    r = world.http.post("/governance/documents/bulk-publish", json={"document_ids": [5, 6]})
    assert r.status_code == 200 and (r.json()["published_count"], r.json()["skipped_count"]) == (1, 1)
    assert (doc(world, 5).status, doc(world, 5).published_version, doc(world, 6).status) == ("published", "1.0", "draft")
