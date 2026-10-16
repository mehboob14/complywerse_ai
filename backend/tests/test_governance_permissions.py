"""Who may change, publish or delete a governance document, enforced by the server on every route that changes a document or its
sign-off (governance/permissions.py), and the life cycle that is now on for every organisation: only people are asked, and switching
it on asks nobody about documents published before. Over HTTP through the whole governance router, on in-memory SQLite."""
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance import permissions
from grc.modules.governance.router import router
from grc.modules.governance.studio import service
from grc.routers.auth_router import require_auth

OWNER, AUTHOR, SAM, EDITOR, PUBLISHER, ADMIN, CONTACT, CLOUD, SSO, SIGNED_IN = range(1, 11)
TEXT = "# Access policy\n\n## 1. Purpose\n\nAccess is reviewed every year.\n"


@pytest.fixture
def world(monkeypatch, tmp_path):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    monkeypatch.setattr(service, "UPLOAD_DIR", str(tmp_path / "studio"))
    monkeypatch.setattr("grc.modules.governance.routers.documents._resolve_tenant_slug_for_autoparse", lambda tenant_id: None)  # never the real master database
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(m.Tenant(id=1, name="CFSB", slug="cfsb", primary_contact_email="Boss@CFSB.test"))
        for uid, name, extra in [(OWNER, "Olivia Owner", {}), (AUTHOR, "Anna Author", {}), (SAM, "Sam Other", {}),
                                 (EDITOR, "Eddie Editor", {}), (PUBLISHER, "Pat Publisher", {}), (ADMIN, "Ada Admin", {}),
                                 (CONTACT, "Boss Contact", {"email": "boss@cfsb.test"}),
                                 (CLOUD, "droplet-root", {"external_provider": "digitalocean"}),          # imported, never signed in
                                 (SSO, "Sia Sso", {"external_provider": "entra_id"}),                     # the organisation's SSO
                                 (SIGNED_IN, "Otto Okta", {"external_provider": "okta", "last_login": datetime.utcnow()})]:
            first = name.split()[0].lower()
            db.add(m.GRCUser(id=uid, username=first, display_name=name, **{"email": f"{first}@cfsb.test", **extra}))
        for rid, role, perm in [(20, "Document editors", "governance:policies:edit"), (21, "Document publishers", "governance:policies:publish"),
                                (22, "Administrator", None), (23, "DigitalOcean: SSH root access to droplets", None)]:
            db.add(m.Role(id=rid, tenant_id=1, name=role))
            if perm:
                db.add(m.Permission(id=rid, name=perm, resource="governance:policies", action=perm.rsplit(":", 1)[1]))
                db.add(m.RolePermission(role_id=rid, permission_id=rid))
        for uid, rid in [(EDITOR, 20), (PUBLISHER, 21), (ADMIN, 22), (CLOUD, 23)]:
            db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1))
        db.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="draft", current_version="1.0",
                                    content=TEXT, owner_id=OWNER, author_id=AUTHOR))
        db.add(m.GovernanceDocument(id=6, tenant_id=1, title="Backup policy", doc_type="policy", status="draft", current_version="1.0",
                                    content="# Backup policy\n", owner_id=SAM))
        db.add(m.PolicyGapAnalysisRun(id=1, tenant_id=1, document_id=5))
        db.add(m.PolicyGapFinding(id=1, tenant_id=1, analysis_run_id=1, document_id=5))
        db.commit()
    app = FastAPI()
    app.include_router(router)
    db = factory()
    me = {"id": SAM}
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["id"])
    yield SimpleNamespace(db=db, me=me, http=TestClient(app))
    db.close()


def doc(world, did=5):
    world.db.expire_all()
    return world.db.get(m.GovernanceDocument, did)


# every route that changes document 5 or its sign-off, with a body it would accept
CHANGES = [
    ("put", "/governance/documents/5", {"json": {"title": "Changed"}}),
    ("post", "/governance/documents/5/signoff", {"json": {"signoffs": []}}),
    ("post", "/governance/documents/5/start-review", {"json": {}}),
    ("post", "/governance/documents/5/complete-review", {"json": {}}),
    ("post", "/governance/documents/5/upload-file", {"files": {"file": ("p.pdf", b"%PDF-1.4", "application/pdf")}}),
    ("put", "/governance/documents/5/status", {"json": {"status": "archived"}}),
    ("put", "/governance/documents/5/signoff/participants", {"json": {"reviewers": [{"target_type": "user", "target_id": SAM}]}}),
    ("post", "/governance/documents/5/signoff/send-for-review", {}),
    ("post", "/governance/versions/document/5", {"json": {"change_type": "minor", "content": "x"}}),
    ("post", "/governance/versions/document/5/rollback/1", {"json": {}}),
    ("post", "/governance/documents/5/change-chain/revert", {"json": {"from_version_id": 1, "hunks": [1]}}),
    ("post", "/governance/documents/5/lifecycle/remind", {}),
    ("post", "/governance/reviews/5/start", {}),
    ("post", "/governance/reviews/5/complete", {"json": {}}),
    ("put", "/governance/reviews/5/review-cycle", {"json": {"review_cycle_months": 6}}),
    ("post", "/governance/reviews/5/skip", {"json": {"reason": "not now"}}),
    ("post", "/governance/documents/5/document-sync/apply", {"json": {}}),
    ("post", "/governance/gap-analysis/findings/1/apply-fix", {"json": {"proposed_text": "A new clause.", "mode": "append"}}),
    ("post", "/governance/studio/sessions", {"json": {"kind": "library", "document_id": 5}}),
]


def test_every_route_that_changes_a_document_refuses_someone_who_may_not_change_it(world):
    for method, path, kw in CHANGES:
        r = getattr(world.http, method)(path, **kw)
        assert r.status_code == 403, (path, r.status_code, r.text)
        assert r.json()["detail"] == permissions.EDIT_REFUSED, path
    assert world.http.delete("/governance/documents/5").status_code == 403
    assert world.http.post("/governance/documents/5/publish").status_code == 403
    d = doc(world)
    assert (d.title, d.status, d.content) == ("Access policy", "draft", TEXT)
    assert world.db.query(m.DocumentSignoffAssignment).count() == 0 and world.db.query(m.StudioSession).count() == 0
    assert world.http.put("/governance/documents/404", json={"title": "x"}).status_code == 404       # a document that is not there


@pytest.mark.parametrize("who", [OWNER, AUTHOR, EDITOR, ADMIN, CONTACT])
def test_the_owner_the_author_a_role_with_the_right_an_administrator_and_the_primary_contact_may_change_it(world, who):
    world.me["id"] = who
    r = world.http.put("/governance/documents/5", json={"description": f"by {who}"})
    assert r.status_code == 200 and doc(world).description == f"by {who}"
    assert world.http.post("/governance/studio/sessions", json={"kind": "library", "document_id": 5}).status_code == 200


def test_publishing_and_approving_by_hand_need_the_publish_right(world):
    world.me["id"] = OWNER                                                     # may change it, may not publish it
    for status in ("published", "approved"):
        r = world.http.put("/governance/documents/5/status", json={"status": status})
        assert r.status_code == 403 and r.json()["detail"] == permissions.PUBLISH_REFUSED
    assert world.http.put("/governance/documents/5", json={"status": "published"}).status_code == 403
    assert world.http.put("/governance/documents/5", json={"status": "draft", "title": "Same status is fine"}).status_code == 200
    assert world.http.post("/governance/documents/5/publish").status_code == 403
    assert world.http.post("/governance/documents/bulk-publish", json={"document_ids": [5]}).status_code == 403
    assert doc(world).status == "draft"
    world.me["id"] = PUBLISHER                                                 # may publish, may not change it
    assert world.http.put("/governance/documents/5/status", json={"status": "published"}).status_code == 403
    assert world.http.post("/governance/documents/5/publish").status_code == 400    # allowed, but only an approved document is published
    world.me["id"] = ADMIN
    assert world.http.put("/governance/documents/5/status", json={"status": "published"}).status_code == 200
    assert doc(world).status == "published"


def test_a_bulk_change_is_refused_whole_naming_the_documents_the_person_may_not_change(world):
    world.me["id"] = OWNER                                                     # owns 5, not 6
    for path, body in [("bulk-archive", {}), ("bulk-update-status", {"status": "archived"}), ("bulk-assign-owner", {"owner_id": OWNER}),
                       ("bulk-set-review-date", {"next_review_date": "2027-01-01T00:00:00"})]:
        r = world.http.post(f"/governance/documents/{path}", json={"document_ids": [5, 6], **body})
        assert r.status_code == 403 and '"Backup policy"' in r.json()["detail"] and '"Access policy"' not in r.json()["detail"], path
    assert (doc(world, 5).status, doc(world, 6).status, doc(world, 6).owner_id) == ("draft", "draft", SAM)
    world.me["id"] = EDITOR                                                    # may change both, may not publish
    assert world.http.post("/governance/documents/bulk-update-status", json={"document_ids": [5, 6], "status": "published"}).status_code == 403
    assert world.http.post("/governance/documents/bulk-archive", json={"document_ids": [5, 6]}).status_code == 200
    assert (doc(world, 5).status, doc(world, 6).status) == ("archived", "archived")


def test_deleting_is_for_the_owner_the_author_or_the_delete_right(world):
    world.me["id"] = PUBLISHER
    r = world.http.delete("/governance/documents/5")
    assert r.status_code == 403 and r.json()["detail"] == permissions.DELETE_REFUSED
    world.me["id"] = AUTHOR
    assert world.http.delete("/governance/documents/5").status_code == 204 and doc(world) is None


def test_saving_a_studio_draft_into_the_library_is_checked_again_when_it_is_saved(world):
    world.me["id"] = OWNER
    sid = world.http.post("/governance/studio/sessions", json={"kind": "library", "document_id": 5}).json()["id"]
    world.http.put(f"/governance/studio/sessions/{sid}/content", json={"content": TEXT + "\nOlivia's change.\n", "base_revision": 1})
    d = doc(world)
    d.owner_id = d.author_id = SAM                                             # the document is handed to someone else meanwhile
    world.db.commit()
    r = world.http.post(f"/governance/studio/sessions/{sid}/save-to-document", json={})
    assert r.status_code == 403 and r.json()["detail"] == permissions.EDIT_REFUSED
    s = world.db.get(m.StudioSession, sid)
    assert service.version_after_accept(world.db, s, world.db.get(m.GRCUser, OWNER), 1) == {"saved": False, "why": permissions.EDIT_REFUSED}
    assert doc(world).content == TEXT and world.db.query(m.GovernanceDocumentVersion).count() == 0


def test_lifecycle_settings_and_the_studio_follow_the_administrator_rule(world):
    for who, admin in [(OWNER, False), (CLOUD, False), (ADMIN, True), (CONTACT, True)]:   # a "root" role imported from a cloud is not
        world.me["id"] = who
        assert world.http.get("/governance/documents/lifecycle/settings").json()["can_edit"] is admin, who
        assert world.http.put("/governance/documents/lifecycle/settings", json={"ack_days": 20}).status_code == (200 if admin else 403), who
        assert world.http.get("/governance/studio/status").json()["is_admin"] is admin, who
    assert permissions.admin_user_ids(world.db) == {ADMIN, CONTACT}


def test_only_people_are_asked_never_an_identity_a_connector_imported_that_never_signed_in(world):
    db = world.db
    db.add(m.Role(id=30, tenant_id=1, name="Approvers"))
    for uid in (EDITOR, CLOUD):
        db.add(m.UserRole(user_id=uid, role_id=30, tenant_id=1))
    d = doc(world)
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="approver", target_type="role", target_id=30, added_by=OWNER))
    d.status = "pending_approval"
    db.flush()
    life.on_sent(db, d, OWNER)
    assert [o.user_id for o in db.query(m.DocumentObligation).filter_by(kind="approval")] == [EDITOR]
    d.status = "published"
    life.on_status_changed(db, d, "pending_approval", "published", OWNER)
    db.commit()
    asked = {o.user_id for o in db.query(m.DocumentObligation).filter_by(kind="acknowledgement")}
    assert asked == {OWNER, AUTHOR, SAM, EDITOR, PUBLISHER, ADMIN, CONTACT, SSO, SIGNED_IN}            # not the droplet identity


def test_switching_the_life_cycle_on_asks_nobody_about_a_document_published_before(world):
    db = world.db
    old = doc(world, 6)
    old.status = "published"                                                   # published while the life cycle was off
    db.commit()
    assert life.enabled(db)                                                    # on for every organisation by default
    assert life.sweep(db)["asked"] == 0
    with pytest.raises(LookupError):
        life.acknowledge(db, old, db.get(m.GRCUser, SAM))
    assert db.query(m.DocumentObligation).count() == 0 and db.query(m.CriticalTask).count() == 0
    assert db.query(m.WorkflowNotification).count() == 0

    new = doc(world, 5)                                                        # published now: everyone is asked, once
    new.status = "published"
    life.on_status_changed(db, new, "approved", "published", OWNER)
    db.commit()
    first = db.query(m.DocumentObligation).count()
    db.add(m.GRCUser(id=11, username="nia", email="nia@cfsb.test", display_name="Nia New"))
    db.commit()
    assert life.sweep(db)["asked"] == 1                                        # the new joiner, on the new document only
    assert db.query(m.DocumentObligation).count() == first + 1
    assert db.query(m.DocumentObligation).filter_by(document_id=6).count() == 0
