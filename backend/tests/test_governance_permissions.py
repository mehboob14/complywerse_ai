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
    ("post", "/governance/workflows/submit", {"json": {"document_id": 5}}),                 # the older approvals engine
    ("post", "/governance/workflows/documents/5/start", {"json": {}}),
    ("post", "/governance/workflows/documents/5/rollback", {"json": {}}),
    ("post", "/governance/workflows/documents/5/cancel", {"json": {}}),
    ("post", "/governance/documents/5/start-workflow", {"json": {}}),
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
    assert world.db.query(m.DocumentSignoffAssignment).count() == 0 and world.db.query(m.DocumentApprovalStep).count() == 0
    # someone who may not read it cannot open it in the AI Studio either (the read rules are tested below)
    r = world.http.post("/governance/studio/sessions", json={"kind": "library", "document_id": 5})
    assert r.status_code == 403 and r.json()["detail"] == permissions.READ_REFUSED
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
        got = world.http.get("/governance/documents/lifecycle/settings")                      # nobody else holds a governance right
        assert (got.status_code, got.json().get("can_edit")) == ((200, True) if admin else (403, None)), who
        assert world.http.put("/governance/documents/lifecycle/settings", json={"ack_days": 20}).status_code == (200 if admin else 403), who
        assert world.http.get("/governance/studio/status").json()["is_admin"] is admin, who
    assert permissions.admin_user_ids(world.db) == {ADMIN, CONTACT}
    world.me["id"] = EDITOR                                                                     # a governance right reads them
    assert world.http.get("/governance/documents/lifecycle/settings").json()["can_edit"] is False


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


def test_a_step_of_the_older_approvals_engine_is_decided_by_its_approver_only(world):
    db = world.db
    d = doc(world)
    d.status = "pending_review"
    db.add(m.DocumentApprovalStep(id=1, document_id=5, step_sequence=1, step_name="Approval", approver_id=OWNER, status="pending"))
    db.commit()
    for path in ("/governance/workflows/steps/1/approve", "/governance/workflows/steps/1/reject"):
        r = world.http.post(path, json={"comments": "fine"})
        assert r.status_code == 403 and "approver" in r.json()["detail"], path
    assert db.get(m.DocumentApprovalStep, 1).status == "pending" and doc(world).status == "pending_review"
    world.me["id"] = OWNER
    assert world.http.post("/governance/workflows/steps/1/approve", json={"comments": "fine"}).status_code == 200


def test_a_new_text_of_a_published_document_is_reviewed_again_whichever_route_wrote_it(world):
    db = world.db
    d = doc(world)
    d.status = "published"
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=EDITOR, added_by=OWNER))
    db.commit()
    world.me["id"] = OWNER
    assert world.http.put("/governance/documents/5", json={"content": TEXT + "\nNew rules.\n"}).status_code == 200
    assert doc(world).status == "pending_review"                               # the new wording is not in force until approved
    d = doc(world)
    d.status = "published"
    db.commit()
    r = world.http.post("/governance/versions/document/5", json={"change_type": "minor", "content": TEXT + "\nOther rules.\n"})
    assert r.status_code == 201 and doc(world).status == "pending_review"
    r = world.http.post("/governance/documents/5/signoff", json={"signoffs": [], "mark_approved": True})
    assert r.status_code == 403 and r.json()["detail"] == permissions.PUBLISH_REFUSED          # approving by hand needs publish
    world.me["id"] = ADMIN
    assert world.http.post("/governance/documents/5/signoff", json={"signoffs": [], "mark_approved": True}).status_code == 200


def test_an_entitlement_named_administrator_that_a_connector_imported_makes_nobody_an_admin(world):
    db = world.db
    db.add(m.UserRole(user_id=CLOUD, role_id=22, tenant_id=1, source="okta"))             # the app's "Administrator" group, imported
    db.add(m.UserRole(user_id=SSO, role_id=22, tenant_id=1, source="sso"))                # an SSO group mapped to the role: an admin
    db.commit()
    assert not permissions.is_admin(db, db.get(m.GRCUser, CLOUD))
    assert permissions.is_admin(db, db.get(m.GRCUser, SSO))
    assert permissions.admin_user_ids(db) == {ADMIN, CONTACT, SSO}
    assert not permissions.can_edit(db, db.get(m.GRCUser, CLOUD), doc(world))


def test_accounts_the_directory_sync_imported_are_not_people_until_they_sign_in(world):
    db = world.db
    db.add(m.GRCUser(id=12, username="room", email="room-1@cfsb.test", display_name="Meeting Room 1", external_provider="entra_id",
                     access_synced_at=datetime.utcnow()))                      # imported by the access-review directory sync
    db.commit()
    assert 12 not in life._people(db) and SSO in life._people(db)
    db.get(m.GRCUser, 12).last_login = datetime.utcnow()
    db.commit()
    assert 12 in life._people(db)


def test_a_request_to_a_few_people_does_not_make_everyone_follow_and_old_requests_to_non_people_end(world):
    db = world.db
    old = doc(world, 6)
    old.status = "published"
    db.commit()
    life.request_acknowledgements(db, old, [SAM], OWNER)                      # a workflow asks one person
    db.commit()
    assert old.acks_everyone_at is None and life._add_joiners(db, old) == 0
    assert {o.user_id for o in db.query(m.DocumentObligation).filter_by(document_id=6)} == {SAM}
    life.request_acknowledgements(db, old, None, OWNER)                       # asked of everyone
    db.commit()
    assert old.acks_everyone_at is not None
    db.add(m.GRCUser(id=13, username="neo", email="neo@cfsb.test", display_name="Neo New"))
    db.commit()
    assert life._add_joiners(db, old) == 1                                    # people who join later are asked too, now
    db.add(m.DocumentObligation(tenant_id=1, document_id=6, kind="acknowledgement", user_id=CLOUD, status="pending",
                                due_date=datetime.utcnow()))               # asked before the people rule
    db.commit()
    assert life.drop_non_people(db) == 1
    assert db.query(m.DocumentObligation).filter_by(user_id=CLOUD).one().status == "cancelled"


def test_the_details_a_save_is_given_are_checked_before_any_file_is_written(world):
    from grc.modules.governance.doc_details import check_details

    db = world.db
    db.get(m.GRCUser, SAM).is_active = False
    db.commit()
    for kw, words in [({"owner_id": SAM}, "owner"), ({"owner_id": 999}, "owner"), ({"department_id": 999}, "department"),
                      ({"review_cycle_months": 1000}, "between")]:
        with pytest.raises(ValueError, match=words):
            check_details(db, **kw)
    check_details(db, owner_id=OWNER, review_cycle_months=24)
    world.me["id"] = OWNER
    r = world.http.post("/governance/documents/upload-with-file", data={"title": "T", "doc_type": "policy", "owner_id": "999"},
                        files={"file": ("../../evil.pdf", b"%PDF-1.4", "application/pdf")})
    assert r.status_code == 400 and "owner" in r.json()["detail"]


# ── who may read: the life cycle, the sign-off, the studio's access, signatures and attestation campaigns (2026-10-17) ──
def _grant(db, uid, perm, rid=40):
    db.add(m.Role(id=rid, tenant_id=1, name=f"Holders of {perm}"))
    db.add(m.Permission(id=rid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
    db.add(m.RolePermission(role_id=rid, permission_id=rid))
    db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1))
    db.commit()


# every route of these routers that reads or acts on document 5 (signing and acknowledging keep their own checks after this one)
DOCUMENT_READS = [
    ("get", "/governance/documents/5/lifecycle", {}),
    ("post", "/governance/documents/5/lifecycle/acknowledge", {"json": {}}),
    ("get", "/governance/documents/5/signoff", {}),
    ("post", "/governance/documents/5/signoff/sign", {"json": {"signature_image": "x"}}),
    ("post", "/governance/documents/5/signoff/reject", {"json": {"comment": "no"}}),
    ("get", "/governance/studio/documents/5/access", {}),
]
CAMPAIGNS = [
    ("get", "/governance/document-attestations/coverage-map", {}),
    ("get", "/governance/document-attestations/campaigns", {}),
    ("post", "/governance/document-attestations/campaigns", {"json": {"document_id": 5}}),
    ("get", "/governance/document-attestations/campaigns/1", {}),
    ("patch", "/governance/document-attestations/campaigns/1", {"json": {"name": "Renamed"}}),
    ("get", "/governance/document-attestations/campaigns/1/acknowledgments/1/signature", {}),
    ("delete", "/governance/document-attestations/campaigns/1", {}),
]


def _signature_on(db, document):
    from grc.services import esign
    from test_esignature import _png

    sig = esign.record(db, tenant_id=1, record_type="document_signoff", record_id=1, signature_image=_png(), meaning="Approved",
                       signer_name="Ada Admin", content_sha256="0" * 64, document=document)
    db.commit()
    return sig.id


def test_someone_who_may_not_read_a_document_gets_none_of_its_life_cycle_sign_off_or_signatures(world):
    db = world.db
    signed, loose = _signature_on(db, doc(world)), _signature_on(db, None)
    for method, path, kw in DOCUMENT_READS + [("get", f"/governance/esignatures/{signed}", {}), ("get", f"/governance/esignatures/{signed}/image", {})]:
        r = getattr(world.http, method)(path, **kw)
        assert r.status_code == 403 and r.json()["detail"] == permissions.READ_REFUSED, (path, r.status_code, r.text)
    assert world.http.get("/governance/documents/404/lifecycle").status_code == 404           # a missing document first
    assert world.http.get(f"/governance/esignatures/{loose}").status_code == 200              # a signature on no document: its tenant
    for path in ("/governance/documents/lifecycle/mine", "/governance/documents/signoff/my-pending"):
        assert world.http.get(path).status_code == 200, path                                   # personal queues stay open
    assert world.http.get("/governance/documents/lifecycle/settings").status_code == 403      # the settings need a governance right
    assert db.query(m.DocumentObligation).count() == 0 and db.query(m.DocumentSignature).count() == 0


def test_a_sign_off_naming_the_person_opens_the_life_cycle_the_sign_off_and_its_signatures(world):
    db = world.db
    signed = _signature_on(db, doc(world))
    db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="reviewer", target_type="user", target_id=SAM, added_by=OWNER))
    db.commit()
    for path in ("/governance/documents/5/lifecycle", "/governance/documents/5/signoff", "/governance/studio/documents/5/access",
                 f"/governance/esignatures/{signed}"):
        assert world.http.get(path).status_code == 200, path
    assert world.http.get("/governance/documents/5/lifecycle").json()["document"]["in_force"] is None      # never published


def test_attestation_campaigns_are_for_library_readers_and_a_draft_never_published_stays_hidden_from_them(world):
    db = world.db
    db.add(m.DocumentAttestationCampaign(id=1, tenant_id=1, document_id=5, name="Access policy", status="active",
                                         public_token="tok", allowed_email_domain="cfsb.test"))
    db.commit()
    for method, path, kw in CAMPAIGNS:
        r = getattr(world.http, method)(path, **kw)
        assert r.status_code == 403 and r.json()["detail"] == permissions.LIBRARY_REFUSED, (path, r.status_code, r.text)
    assert world.http.get("/governance/document-attestations/public/tok").status_code == 200          # the public link is untouched
    _grant(db, SAM, "governance:policies:view")
    assert world.http.get("/governance/document-attestations/campaigns").json()["count"] == 1
    assert world.http.get("/governance/documents/5/lifecycle").status_code == 403                     # a draft that was never published
    d = doc(world)
    d.status = "published"
    db.commit()
    d.current_version, d.status = "1.1", "pending_review"                                             # a new version on its way
    db.commit()
    seen = world.http.get("/governance/documents/5/lifecycle")
    assert seen.status_code == 200 and seen.json()["document"]["in_force"] == "1.0"
    assert world.http.get("/governance/documents/5/signoff").status_code == 200

