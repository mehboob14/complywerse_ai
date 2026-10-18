"""Document approvals and acknowledgements as per-person obligations (cfsb): who is asked, by when, what they did, a task
for each in Task Management, alerts, escalation and one timeline - tested with several different users."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance.routers import document_signoff as signoff
from grc.routers.auth_router import require_auth

from test_esignature import _png, _request

U = SimpleNamespace          # a user as the endpoints receive one


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    monkeypatch.delenv("SESSION_SECRET_OLD", raising=False)
    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])


@pytest.fixture
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        db.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        for uid, name in [(1, "Olivia Owner"), (2, "Rana Reviewer"), (3, "Rafay Reviewer"), (4, "Mina Manager"), (5, "Mo Manager"),
                          (6, "Uma User"), (7, "Adam Admin")]:
            db.add(m.GRCUser(id=uid, username=name.split()[0].lower(), email=f"{name.split()[0].lower()}@cfsb.test", display_name=name))
        db.add(m.GRCUser(id=8, username="gone", email="gone@cfsb.test", display_name="Gone Away", is_active=False))
        db.add(m.Role(id=10, tenant_id=1, name="Approvers"))
        db.add(m.Role(id=11, tenant_id=1, name="Administrator"))                  # Adam administers (governance/permissions.is_admin)
        for uid in (4, 5):
            db.add(m.UserRole(user_id=uid, role_id=10, tenant_id=1))
        db.add(m.UserRole(user_id=7, role_id=11, tenant_id=1))
        db.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="draft",
                                    current_version="1.0", owner_id=1, author_id=1))
        db.commit()
    return SimpleNamespace(factory=factory)


def user(db, uid):
    return db.get(m.GRCUser, uid)


def doc(db):
    return db.get(m.GovernanceDocument, 5)


def participants(db, reviewers=(2, 3), approver_role=10):
    signoff.set_participants(5, signoff.ParticipantsUpdate(
        reviewers=[signoff.ParticipantIn(target_type="user", target_id=i) for i in reviewers],
        approvers=[signoff.ParticipantIn(target_type="role", target_id=approver_role)]), db, user(db, 1))


def sign(db, uid):
    return signoff.sign_document(5, signoff.SignRequest(signature_image=_png()), _request(), db, user(db, uid))


def obligations(db, kind=None, status=None):
    q = db.query(m.DocumentObligation).order_by(m.DocumentObligation.id)
    if kind:
        q = q.filter_by(kind=kind)
    if status:
        q = q.filter_by(status=status)
    return q.all()


def tasks(db):
    return db.query(m.CriticalTask).filter_by(source_module="document_lifecycle").order_by(m.CriticalTask.id).all()


def alerts(db, uid):
    return db.query(m.WorkflowNotification).filter_by(user_id=uid).all()


def test_sending_for_review_asks_each_reviewer_with_a_task_and_an_alert(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        rows = obligations(db)
        assert [(o.kind, o.user_id, o.status) for o in rows] == [("review", 2, "pending"), ("review", 3, "pending")]
        assert all(o.due_date > datetime.utcnow() + timedelta(days=6) for o in rows)
        mine = [t for t in tasks(db) if t.assigned_user_ids == [2]]
        assert len(tasks(db)) == 2 and mine[0].title == "Review: Access policy" and mine[0].source_entity_id == rows[0].id
        assert mine[0].description.startswith('Please review and sign "Access policy", version 1.0, by ')   # plain words, no bare path
        assert life.task_values(db, rows[0], doc(db))["link"] == "/governance/documents/5?tab=lifecycle"     # {link}: its Approvals
        assert len(alerts(db, 2)) == 1 and len(alerts(db, 3)) == 1 and alerts(db, 6) == []


def test_the_whole_chain_with_different_users_and_who_is_pending_at_each_step(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        sign(db, 2)
        pending = life.state(db, doc(db), user(db, 1))["approvals"]
        assert {(r["user"], r["status"]) for r in pending} == {("Rana Reviewer", "done"), ("Rafay Reviewer", "pending")}
        assert doc(db).status == "pending_review"

        sign(db, 3)
        assert doc(db).status == "pending_approval"
        approvers = obligations(db, "approval")
        assert sorted(o.user_id for o in approvers) == [4, 5]                    # the role's two members are each asked
        assert db.get(m.CriticalTask, [o for o in approvers if o.user_id == 4][0].critical_task_id).title == "Approve: Access policy"

        sign(db, 4)                                                              # one member of the role satisfies it
        assert doc(db).status == "approved"
        by_user = {o.user_id: o for o in obligations(db, "approval")}
        assert (by_user[4].status, by_user[5].status) == ("done", "cancelled")
        assert by_user[4].signature_id and by_user[4].esign_id
        shown = {r["user_id"]: r for r in life.state(db, doc(db), user(db, 1))["approvals"] if r["kind"] == "approval"}
        seal = db.get(m.ElectronicSignature, by_user[4].esign_id).image_sha256
        assert shown[4]["esign"] == {"id": by_user[4].esign_id, "image_sha256": seal} and len(seal) == 64 and shown[5]["esign"] is None
        open_tasks = [t for t in tasks(db) if t.status != "Completed"]
        assert open_tasks == []                                                  # Mo's task went with his cancelled request; the rest are completed
        assert alerts(db, 1)[-1].subject.startswith("Approved")

        view = life.state(db, doc(db), user(db, 1))
        kinds = [e["kind"] for e in view["timeline"]]
        assert kinds.count("signed") == 3 and "sent_for_review" in kinds and "approval_requested" in kinds
        assert {e["actor"] for e in view["timeline"] if e["kind"] == "signed"} == {"Rana Reviewer", "Rafay Reviewer", "Mina Manager"}


def test_a_rejection_ends_every_open_request_and_tells_the_owner(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        signoff.reject_document(5, signoff.RejectRequest(comment="Scope is wrong"), db, user(db, 3))
        assert doc(db).status == "draft"
        assert {(o.user_id, o.status) for o in obligations(db)} == {(2, "cancelled"), (3, "rejected")}
        assert [t.assigned_user_ids for t in tasks(db) if t.status != "Completed"] == []
        assert "Scope is wrong" in alerts(db, 1)[-1].message
        assert obligations(db, status="rejected")[0].comment == "Scope is wrong"


def test_changing_the_reviewers_while_it_is_out_updates_who_is_asked(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        participants(db, reviewers=(3,))
        assert {(o.user_id, o.status) for o in obligations(db)} == {(2, "cancelled"), (3, "pending")}
        assert len(tasks(db)) == 1


def test_publishing_asks_every_active_user_once_and_they_acknowledge(world):
    with world.factory() as db:
        d = doc(db)
        d.status = "approved"
        db.commit()
        d.status = "published"
        life.on_status_changed(db, d, "approved", "published", 1)
        db.commit()
        asked = obligations(db, "acknowledgement")
        assert sorted(o.user_id for o in asked) == [1, 2, 3, 4, 5, 6, 7]         # not the deactivated user
        assert all(o.due_date > datetime.utcnow() + timedelta(days=13) for o in asked)
        life.on_status_changed(db, d, "published", "published", 1)               # asking again adds nobody
        assert len(obligations(db, "acknowledgement")) == 7

        life.acknowledge(db, d, user(db, 6), "read it", signature_image=_png(), request=_request())
        life.acknowledge(db, d, user(db, 2))
        done = {o.user_id: o for o in obligations(db, "acknowledgement", "done")}
        assert sorted(done) == [2, 6] and done[6].esign_id and done[2].esign_id is None
        assert db.get(m.CriticalTask, done[6].critical_task_id).status == "Completed"
        view = life.state(db, d, user(db, 6))
        assert (view["acknowledgements"]["total"], view["acknowledgements"]["done"], view["acknowledgements"]["percent"]) == (7, 2, 29)
        assert {p["user"] for p in view["acknowledgements"]["people"] if p["status"] == "pending"} == {
            "Olivia Owner", "Rafay Reviewer", "Mina Manager", "Mo Manager", "Adam Admin"}
        assert view["mine"] == []
        people = {p["user_id"]: p for p in view["acknowledgements"]["people"]}
        assert people[6]["esign"]["id"] == done[6].esign_id and len(people[6]["esign"]["image_sha256"]) == 64     # verifiable, with its seal
        assert people[2]["esign"] is None
        assert any(e["kind"] == "acknowledged" and e["actor"] == "Uma User" for e in view["timeline"])

        life.acknowledge(db, d, user(db, 6))                                     # again: nothing changes
        assert len(obligations(db, "acknowledgement", "done")) == 2
        with pytest.raises(LookupError):
            life.acknowledge(db, d, user(db, 8))                                 # a deactivated user is not asked
        d.status = "archived"                                                    # withdrawn: nothing in force (a draft keeps 1.0 in force)
        with pytest.raises(ValueError):
            life.acknowledge(db, d, user(db, 3))


def test_a_major_version_asks_everyone_again_and_a_minor_one_does_not(world):
    with world.factory() as db:
        d = doc(db)

        def publish(version):
            if d.status == "published":                                          # a new version is reviewed first
                d.status = "approved"
                life.on_status_changed(db, d, "published", "approved", 1)
            d.current_version, d.status = version, "published"
            life.on_status_changed(db, d, "approved", "published", 1)
            db.commit()

        def pending():
            return {o.user_id: o.document_version for o in obligations(db, "acknowledgement", "pending")}

        publish("1.0")
        life.acknowledge(db, d, user(db, 6))
        publish("1.1")                                                           # minor: Uma acknowledged 1.0, she is not asked again
        assert pending() == {1: "1.1", 2: "1.1", 3: "1.1", 4: "1.1", 5: "1.1", 7: "1.1"}
        life.acknowledge(db, d, user(db, 2))
        acks = life.state(db, d, user(db, 1))["acknowledgements"]
        assert (acks["total"], acks["done"]) == (7, 2)
        assert {p["user_id"]: (p["status"], p["version"]) for p in acks["people"]}[6] == ("done", "1.0")     # the version she acknowledged

        publish("2.0")                                                           # major: everyone, Uma and Rana too
        assert pending() == {uid: "2.0" for uid in (1, 2, 3, 4, 5, 6, 7)}
        acks = life.state(db, d, user(db, 1))["acknowledgements"]
        assert (acks["total"], acks["done"], acks["pending"]) == (7, 0, 7)        # one row per person: the newest
        life.acknowledge(db, d, user(db, 6))
        assert {o.user_id for o in obligations(db, "acknowledgement", "done")} == {2, 6} and len(obligations(db, "acknowledgement", "done")) == 3


def test_a_task_cannot_be_completed_in_task_management_and_deleting_it_leaves_the_request(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        t = tasks(db)[0]
        t.status, t.completed_at = "Completed", datetime.utcnow()
        life.sync_from_critical_task(db, t.id, 2)
        assert (t.status, t.completed_at) == ("Open", None)
        ob = db.get(m.DocumentObligation, t.source_entity_id)
        life.on_critical_task_deleted(db, t)
        assert ob.critical_task_id is None and ob.status == "pending"


def test_reminder_then_the_owner_then_the_tenant_administrators(world):
    with world.factory() as db:
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        ob = db.query(m.DocumentObligation).filter_by(user_id=6).one()
        ob.due_date = datetime.utcnow() + timedelta(days=2)
        db.commit()
        assert life.sweep(db)["reminded"] == 1 and life.sweep(db)["reminded"] == 0           # once
        assert "Due soon" in alerts(db, 6)[-1].subject

        ob.due_date = datetime.utcnow() - timedelta(days=1)
        db.commit()
        out = life.sweep(db)
        assert out["owner_told"] == 1 and out["admins_told"] == 0 and ob.escalation_level == 1
        assert "Uma User" in alerts(db, 1)[-1].message and db.get(m.CriticalTask, ob.critical_task_id).escalation_level == 1
        assert life.sweep(db)["owner_told"] == 0                                                # once

        ob.due_date = datetime.utcnow() - timedelta(days=8)
        db.commit()
        out = life.sweep(db)
        assert out["admins_told"] == 1 and ob.escalation_level == 2
        assert "Uma User" in alerts(db, 7)[-1].message
        assert any(e["kind"] == "escalated" for e in life.state(db, d, user(db, 1))["timeline"])


def test_someone_who_joins_after_publishing_is_asked_by_the_daily_sweep(world):
    with world.factory() as db:
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.add(m.GRCUser(id=9, username="new", email="new@cfsb.test", display_name="New Joiner"))
        db.commit()
        assert life.sweep(db)["asked"] == 1
        assert db.query(m.DocumentObligation).filter_by(user_id=9, kind="acknowledgement").count() == 1


def test_other_organisations_are_untouched_until_switched_on(world, monkeypatch):
    monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"cfsb"}))          # every one by default; limited to named ones
    with world.factory() as db:
        db.query(m.Tenant).one().slug = "acme"
        db.commit()
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert obligations(db) == [] and tasks(db) == [] and not life.enabled(db)
        assert life.sweep(db) == {"asked": 0, "reminded": 0, "owner_told": 0, "admins_told": 0, "emailed": 0, "dropped": 0}
        monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"*"}))          # the quick switch for every tenant
        assert life.enabled(db)


def test_the_routes(world, monkeypatch):
    from grc.models import get_db
    from grc.modules.governance.routers.document_lifecycle import router

    app = FastAPI()
    app.include_router(router)
    db = world.factory()
    me = {"u": user(db, 6)}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: me["u"]
    client = TestClient(app)
    d = doc(db)
    d.status = "published"
    life.ensure_acknowledgements(db, d, 1)
    db.commit()

    seen = client.get("/documents/5/lifecycle").json()
    assert seen["enabled"] and [m_["kind"] for m_ in seen["mine"]] == ["acknowledgement"]
    done = client.post("/documents/5/lifecycle/acknowledge", json={"comment": "ok"}).json()
    assert done["mine"] == [] and done["acknowledgements"]["done"] == 1
    me["u"] = user(db, 8)
    assert client.post("/documents/5/lifecycle/acknowledge", json={}).status_code == 403
    me["u"] = user(db, 1)
    assert client.post("/documents/5/lifecycle/remind").json()["reminded"] == 6
    monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"cfsb"}))          # limited to named organisations
    db.query(m.Tenant).one().slug = "acme"
    db.commit()
    assert client.get("/documents/5/lifecycle").json() == {"enabled": False}
    assert client.post("/documents/5/lifecycle/acknowledge", json={}).status_code == 404


def test_deleting_the_document_removes_its_requests_and_their_tasks(world):
    from grc.modules.governance.routers.documents import delete_document

    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert obligations(db) and tasks(db)
        delete_document(document_id=5, db=db, current_user=user(db, 1))
        assert obligations(db) == [] and tasks(db) == []


# ── the second round: settings, email, workflow actions and events, "my requests" ──
def sent_channels(monkeypatch):
    calls = []
    import grc.modules.workflow_engine.services.notification_service as ns
    real = ns.send_workflow_notification

    def spy(db, **kw):
        calls.append((kw["subject"], tuple(kw["channels"])))
        return real(db, **kw)
    monkeypatch.setattr(ns, "send_workflow_notification", spy)
    sent_emails(monkeypatch)
    return calls


def sent_emails(monkeypatch):
    """The emails sent, as (to, subject, html); no mail server in a test."""
    import grc.modules.workflow_engine.services.notification_service as ns

    mails = []
    monkeypatch.setattr(ns, "send_email", lambda db, **kw: mails.append((kw["to"], kw["subject"], kw["body_html"])) or {"success": True})
    return mails


def test_the_organisation_sets_how_long_people_have_and_when_escalation_starts(world):
    with world.factory() as db:
        assert life.settings(db, 1)["approval_days"] == 7 and life.settings(db, 1)["ack_days"] == 14
        saved = life.save_settings(db, 1, {"approval_days": 3, "ack_days": 30, "admin_after_days": 2, "email": False}, 1)
        assert (saved["approval_days"], saved["ack_days"], saved["admin_after_days"], saved["email"]) == (3, 30, 2, False)
        for bad in ({"approval_days": 0}, {"ack_days": 999}, {"nope": 1}):
            with pytest.raises(ValueError):
                life.save_settings(db, 1, bad, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert all(o.due_date < datetime.utcnow() + timedelta(days=3, minutes=1) for o in obligations(db))
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        assert obligations(db, "acknowledgement")[0].due_date > datetime.utcnow() + timedelta(days=29)
        ob = db.query(m.DocumentObligation).filter_by(user_id=6, kind="acknowledgement").one()
        ob.due_date = datetime.utcnow() - timedelta(days=3)
        db.commit()
        assert life.sweep(db)["owner_told"] == 1
        ob.due_date = datetime.utcnow() - timedelta(days=2, hours=1)         # the administrators' wait is now 2 days
        db.commit()
        assert life.sweep(db)["admins_told"] == 1


def test_requests_are_emailed_and_the_organisation_can_turn_that_off(world, monkeypatch):
    calls = sent_channels(monkeypatch)
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert ("Review requested: Access policy", ("in_app", "email")) in calls
        assert all(o.emailed_at for o in obligations(db, "review"))
        calls.clear()
        life.save_settings(db, 1, {"email": False}, 1)
        signoff.reject_document(5, signoff.RejectRequest(comment="no"), db, user(db, 2))
        assert calls and all(channels == ("in_app",) for _s, channels in calls)


def test_a_publication_alerts_in_the_app_and_the_daily_sweep_sends_one_email_per_person(world, monkeypatch):
    calls = sent_channels(monkeypatch)
    with world.factory() as db:
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        assert calls and all(channels == ("in_app",) for _s, channels in calls)       # the whole organisation at once: no mail yet
        calls.clear()
        out = life.sweep(db)
        assert out["emailed"] == 7 and sum(1 for _s, ch in calls if ch == ("in_app", "email")) >= 7
        calls.clear()
        assert life.sweep(db)["emailed"] == 0                                           # once


def test_the_workflow_can_create_a_real_task_and_request_acknowledgements(world):
    from grc.modules.workflow_engine.services.action_handlers import WorkflowActionHandlers as H

    with world.factory() as db:
        instance, definition = SimpleNamespace(id=1, tenant_id=1), SimpleNamespace(id=1, name="Escalate late approvals")
        out = H._create_policy_review_task(db, instance, definition, {"resource_type": "grc_governance_documents", "resource_id": 5, "due_days": 5})
        task = db.get(m.CriticalTask, out["task_id"])
        assert (task.title, task.assigned_user_ids, task.source_module) == ("Review: Access policy", [1], "workflow_engine")
        assert task.due_date > datetime.utcnow() + timedelta(days=4)

        d = doc(db)
        assert H._request_attestation(db, instance, definition, {"document_id": 5})["requested"] == 0       # not published yet
        d.status = "published"
        db.commit()
        got = H._request_attestation(db, instance, definition, {"document_id": 5, "assignee_user_ids": [2, 6, 8], "deadline_days": 4})
        assert got["requested"] == 2                                                                   # the deactivated user is not asked
        assert {o.user_id for o in obligations(db, "acknowledgement")} == {2, 6}

        # an overdue obligation names its document
        ob = obligations(db, "acknowledgement")[0]
        assert life.document_for_event(db, 1, {"resource_type": "grc_document_obligations", "resource_id": ob.id}).id == 5


def test_sign_off_and_acknowledgement_raise_events_workflows_can_use():
    from grc.modules.workflow_engine.services.catalog import ENDPOINT_TRIGGERS, TRIGGER_NODE_TYPES, DUE_DATE_EVENTS

    wanted = {"api.governance.document_signoff.send_for_review": "document_sent_for_review",
              "api.governance.document_signoff.sign_document": "document_signed_off",
              "api.governance.document_signoff.reject_document": "document_rejected",
              "api.governance.document_lifecycle.acknowledge": "document_acknowledged"}
    for endpoint, key in wanted.items():
        assert any(k == key for k, _when in ENDPOINT_TRIGGERS[endpoint])
    keys = {t["key"] for t in TRIGGER_NODE_TYPES}
    assert set(wanted.values()) | {"document_obligation_overdue"} <= keys
    assert any(e[0] == "document_obligation_overdue" and e[3] == "DocumentObligation" for e in DUE_DATE_EVENTS)


def test_my_requests_across_documents_and_the_settings_routes(world, monkeypatch):
    from grc.models import get_db
    from grc.modules.governance.routers.document_lifecycle import router

    app = FastAPI()
    app.include_router(router)
    db = world.factory()
    me = {"u": user(db, 6)}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: me["u"]
    client = TestClient(app)
    d = doc(db)
    d.status = "published"
    db.add(m.GovernanceDocument(id=6, tenant_id=1, title="Backup policy", doc_type="policy", status="published", current_version="1.0", owner_id=1))
    db.flush()
    life.ensure_acknowledgements(db, d, 1)
    life.ensure_acknowledgements(db, db.get(m.GovernanceDocument, 6), 1)
    db.commit()

    mine = client.get("/documents/lifecycle/mine").json()
    assert mine["total"] == 2 and {i["title"] for i in mine["items"]} == {"Access policy", "Backup policy"}
    assert client.get("/documents/lifecycle/settings").json()["can_edit"] is False
    assert client.put("/documents/lifecycle/settings", json={"ack_days": 21}).status_code == 403          # not an administrator
    me["u"] = user(db, 7)
    got = client.put("/documents/lifecycle/settings", json={"ack_days": 21, "email": False}).json()
    assert got["settings"]["ack_days"] == 21 and got["settings"]["email"] is False and got["can_edit"]
    assert client.put("/documents/lifecycle/settings", json={"ack_days": 0}).status_code == 400
    monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"cfsb"}))          # limited to named organisations
    db.query(m.Tenant).one().slug = "acme"
    db.commit()
    assert client.get("/documents/lifecycle/mine").json() == {"enabled": False, "items": []}


def test_the_hooks_see_their_own_changes_on_a_session_that_does_not_autoflush(world):
    """Tenant sessions are made with autoflush=False (grc/db.py): a signed request must not be found pending again, and a document
    sent back to review must ask its reviewers again."""
    from sqlalchemy import event

    engine = world.factory.kw["bind"]
    event.listen(engine, "connect", lambda conn, _r: conn.execute("PRAGMA foreign_keys=ON"))
    plain = sessionmaker(bind=engine, autoflush=False)
    with plain() as db:
        participants(db, reviewers=(2,))
        signoff.send_for_review(5, db, user(db, 1))
        sign(db, 2)                                                            # the review is done: approvers asked
        assert [o.status for o in obligations(db, "review")] == ["done"] and len(obligations(db, "approval", "pending")) == 2
        for uid in (4,):
            sign(db, uid)
        d = doc(db)
        assert d.status == "approved"
        d.status = "pending_review"                                            # changed after approval: back to review
        life.on_status_changed(db, d, "approved", "pending_review", 1)
        db.commit()
        assert [o.user_id for o in obligations(db, "review", "pending")] == [2]   # the same reviewer is asked again
        assert signoff.get_signoff(5, db, user(db, 2))["my_actionable_role"] == "reviewer"


# ── the end-to-end test's findings (2026-10-17) ──────────────────────────────
def test_requests_and_rejections_are_worded_as_people_say_them_and_alerts_open_the_document(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert alerts(db, 2)[-1].link == "/governance/documents/5?tab=lifecycle"                           # the bell opens the document
        sign(db, 2)
        sign(db, 3)
        assert alerts(db, 4)[-1].subject == "Approval requested: Access policy"
        details = [e["detail"] for e in life.state(db, doc(db), user(db, 1))["timeline"]]
        assert any(d.startswith("Review asked of Rana Reviewer") for d in details) and any(d.startswith("Approval asked of") for d in details)
        signoff.reject_document(5, signoff.RejectRequest(comment="Name the rotation period"), db, user(db, 4))
        assert db.query(m.DocumentAuditLog).filter_by(document_id=5, action="rejected").one().action_details == "Rejected at approval: Name the rotation period"
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        assert any(e["detail"].startswith("Acknowledgement asked of") for e in life.state(db, d, user(db, 1))["timeline"])
        ack = db.query(m.DocumentObligation).filter_by(user_id=6, kind="acknowledgement").one()
        assert life.task_values(db, ack, d)["link"] == "/governance/documents/5"                 # {link}: the document itself, to read
        assert "/governance/" not in db.get(m.CriticalTask, ack.critical_task_id).description
        assert alerts(db, 6)[-1].link == "/governance/documents/5" and "Open:" not in alerts(db, 6)[-1].message


def test_the_sweep_sends_one_email_per_request_and_counts_the_emails_it_sent(world, monkeypatch):
    mails = sent_emails(monkeypatch)
    monkeypatch.setenv("FRONTEND_URL", "https://app.example.test")              # the Open it button needs the app's address
    with world.factory() as db:
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)                                   # the whole organisation, in the app only
        for ob in obligations(db, "acknowledgement"):
            ob.due_date = datetime.utcnow() + timedelta(days=2)                  # already due soon at the first sweep
        db.commit()
        out = life.sweep(db)
        assert out["reminded"] == 7 and out["emailed"] == len(mails) == 7       # "Due soon" alone, not also "1 document to acknowledge"
        assert {s for _to, s, _h in mails} == {"Due soon: Acknowledge Access policy"} and len({to for to, _s, _h in mails}) == 7
        assert all("/governance/documents/5" in h and "Open it" in h for _to, _s, h in mails)

        db.add(m.GovernanceDocument(id=6, tenant_id=1, title="Backup policy", doc_type="policy", status="published", current_version="1.0", owner_id=1))
        db.flush()
        life.ensure_acknowledgements(db, db.get(m.GovernanceDocument, 6), 1)
        db.commit()
        mails.clear()
        out = life.sweep(db)                                                      # not due soon: the list of what waits, worded for one
        assert out["emailed"] == len(mails) == 7 and {s for _to, s, _h in mails} == {"1 document to acknowledge"}

        for ob in obligations(db, "acknowledgement", "pending"):
            if ob.document_id == 5:
                ob.due_date = datetime.utcnow() - timedelta(days=1)
        db.commit()
        mails.clear()
        out = life.sweep(db)
        assert out["owner_told"] == 7 and out["emailed"] == len(mails) == 8     # each person once, and the owner once


def test_a_new_round_asks_with_fresh_due_dates(world):
    with world.factory() as db:
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        for ob in obligations(db, "review"):
            ob.due_date = datetime.utcnow() - timedelta(days=3)                  # the first round's dates have passed
        db.commit()
        life.changed_after_review(db, doc(db), "pending_review", 1, "Edited, so it needs approving again")
        db.commit()
        fresh = obligations(db, "review", "pending")
        assert sorted(o.user_id for o in fresh) == [2, 3] and all(o.due_date > datetime.utcnow() + timedelta(days=6) for o in fresh)


def test_who_acknowledged_an_earlier_version_is_kept_after_a_major_version_asks_again(world):
    with world.factory() as db:
        d = doc(db)
        d.status = "published"
        life.ensure_acknowledgements(db, d, 1)
        db.commit()
        life.acknowledge(db, d, user(db, 6), signature_image=_png(), request=_request())
        first = db.query(m.DocumentObligation).filter_by(user_id=6, status="done").one()
        d.status = "approved"
        life.on_status_changed(db, d, "published", "approved", 1)
        d.current_version, d.status = "2.0", "published"
        life.on_status_changed(db, d, "approved", "published", 1)
        db.commit()
        acks = life.state(db, d, user(db, 1))["acknowledgements"]
        assert {p["user_id"]: (p["status"], p["version"]) for p in acks["people"]}[6] == ("pending", "2.0")
        seal = db.get(m.ElectronicSignature, first.esign_id).image_sha256
        assert [(h["user_id"], h["version"], h["status"], h["esign"]) for h in acks["history"]] == [(6, "1.0", "done", {"id": first.esign_id, "image_sha256": seal})]
        assert acks["history"][0]["done_at"]


def test_an_approved_document_is_announced_to_its_owner_and_to_whoever_may_publish_it(world):
    with world.factory() as db:
        participants(db, reviewers=(2,))
        signoff.send_for_review(5, db, user(db, 1))
        sign(db, 2)
        sign(db, 4)                                                        # the approvers' role: approved
        assert doc(db).status == "approved"
        approved = lambda uid: [a for a in alerts(db, uid) if a.subject == "Approved: Access policy"]     # noqa: E731
        assert approved(1) and approved(7) and not approved(6)             # nobody holds the right: the administrators are told
    with world.factory() as db:
        db.add(m.Role(id=12, tenant_id=1, name="Publishers"))
        db.add(m.Permission(id=12, name="governance:policies:publish", resource="governance:policies", action="publish"))
        db.add(m.RolePermission(role_id=12, permission_id=12))
        db.add(m.UserRole(user_id=6, role_id=12, tenant_id=1))
        db.add(m.UserRole(user_id=3, role_id=12, tenant_id=1, source="app:salesforce"))       # imported: holds nothing here
        db.commit()
        from grc.modules.governance.permissions import publisher_ids

        assert publisher_ids(db) == {6}                                    # the holder, not the administrators any more


# ── the published version stays in force while a new one is in review (the user's decisions of 2026-10-17) ──
@pytest.fixture
def noflush(world):
    """Tenant sessions do not autoflush (grc/db.py): what the life cycle changes must be flushed before it looks again."""
    return sessionmaker(bind=world.factory.kw["bind"], autoflush=False)


def in_review(db, number="1.1"):
    """The Access policy published at 1.0 (its text kept in a version row, everyone asked to acknowledge it), then edited to
    ``number``, which goes to its reviewers."""
    participants(db)
    d = doc(db)
    d.content = "Version one."
    db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.0", title=d.title, content=d.content, status="superseded"))
    d.status = "published"
    life.on_status_changed(db, d, "approved", "published", 1)
    db.commit()
    d.content, d.current_version = "Version one, with a new rule.", number
    db.add(m.GovernanceDocumentVersion(document_id=5, version_number=number, title=d.title, content=d.content, status="current"))
    life.changed_after_review(db, d, "published", 1, f"Content edited (version {number})")
    db.commit()
    return d


def test_a_new_version_in_review_keeps_the_published_one_acknowledgeable(noflush):
    from grc.services import esign

    with noflush() as db:
        d = in_review(db)
        assert (d.status, d.published_version) == ("pending_review", "1.0")
        waiting = obligations(db, "acknowledgement", "pending")
        assert len(waiting) == 7 and {o.document_version for o in waiting} == {"1.0"}           # the re-review withdrew nothing
        assert all(db.get(m.CriticalTask, o.critical_task_id).status == "Open" for o in waiting)
        life.acknowledge(db, d, user(db, 6), signature_image=_png(), request=_request())
        ob = db.query(m.DocumentObligation).filter_by(user_id=6, kind="acknowledgement").one()
        sig = db.get(m.ElectronicSignature, ob.esign_id)
        in_force = db.query(m.GovernanceDocumentVersion).filter_by(version_number="1.0").one()
        assert (ob.status, ob.document_version, sig.document_version) == ("done", "1.0", "1.0")
        assert sig.content_sha256 == esign.document_fingerprint(in_force) != esign.document_fingerprint(doc(db))   # the text in force
        assert db.query(m.DocumentAuditLog).filter_by(action="acknowledged").one().action_details == "Acknowledged version 1.0"
        assert life.state(db, doc(db), user(db, 6))["document"]["in_force"] == "1.0"
        signoff.reject_document(5, signoff.RejectRequest(comment="Not yet"), db, user(db, 3))
        assert doc(db).status == "draft" and len(obligations(db, "acknowledgement", "pending")) == 6     # nor did the rejection
        life.acknowledge(db, doc(db), user(db, 2))
        assert db.query(m.DocumentObligation).filter_by(user_id=2, kind="acknowledgement").one().document_version == "1.0"


def test_publishing_a_minor_version_keeps_the_waiting_people_and_their_due_dates(noflush):
    with noflush() as db:
        d = in_review(db)
        life.acknowledge(db, d, user(db, 6))                                    # Uma acknowledged 1.0
        late = db.query(m.DocumentObligation).filter_by(user_id=4, kind="acknowledgement").one()
        late.due_date, late.escalation_level = datetime.utcnow() - timedelta(days=2), 1
        db.commit()
        late_id, due, told = late.id, late.due_date, len(alerts(db, 4))
        d = doc(db)
        d.status = "published"
        life.on_status_changed(db, d, "pending_review", "published", 1)
        db.commit()
        assert {o.user_id: o.document_version for o in obligations(db, "acknowledgement", "pending")} == {u: "1.1" for u in (1, 2, 3, 4, 5, 7)}
        late = db.get(m.DocumentObligation, late_id)
        assert (late.status, late.due_date, late.escalation_level) == ("pending", due, 1)      # the same request, date and escalation
        assert len(obligations(db, "acknowledgement")) == 7 and len(alerts(db, 4)) == told        # nobody asked again, no new alert


def test_publishing_a_major_version_asks_the_waiting_people_again(noflush):
    with noflush() as db:
        in_review(db, "2.0")
        first = db.query(m.DocumentObligation).filter_by(user_id=6, kind="acknowledgement").one()
        first.due_date = datetime.utcnow() - timedelta(days=2)
        db.commit()
        d = doc(db)
        d.status = "published"
        life.on_status_changed(db, d, "pending_review", "published", 1)
        db.commit()
        rows = db.query(m.DocumentObligation).filter_by(user_id=6, kind="acknowledgement").order_by(m.DocumentObligation.id).all()
        assert [(o.status, o.document_version) for o in rows] == [("cancelled", "1.0"), ("pending", "2.0")]
        assert rows[0].critical_task_id is None and [t.source_entity_id for t in tasks(db) if t.assigned_user_ids == [6]] == [rows[1].id]
        assert rows[1].due_date > datetime.utcnow() + timedelta(days=13)          # asked again from today
        assert {o.user_id for o in obligations(db, "acknowledgement", "pending")} == {1, 2, 3, 4, 5, 6, 7}


def test_archiving_ends_the_acknowledgements(noflush):
    with noflush() as db:
        d = in_review(db)
        d.status = "archived"
        life.on_status_changed(db, d, "pending_review", "archived", 1)
        db.commit()
        assert obligations(db, "acknowledgement", "pending") == [] and [t for t in tasks(db) if t.status == "Open"] == []
        with pytest.raises(ValueError):
            life.acknowledge(db, doc(db), user(db, 6))


def test_people_who_join_during_a_review_are_asked_for_the_version_in_force(noflush):
    with noflush() as db:
        in_review(db)
        db.add(m.GRCUser(id=9, username="new", email="new@cfsb.test", display_name="New Joiner"))
        db.commit()
        assert life.sweep(db)["asked"] == 1
        assert db.query(m.DocumentObligation).filter_by(user_id=9, kind="acknowledgement").one().document_version == "1.0"


def test_people_who_do_not_read_drafts_see_no_text_of_a_content_edit_in_the_timeline(noflush):
    from grc.modules.governance.routers.versions import create_audit_log

    with noflush() as db:
        d = in_review(db)
        create_audit_log(db=db, document_id=5, tenant_id=1, user_id=1, action="content_edited", field_changed="content",
                         old_value="Version one.", new_value=d.content, action_details="Content edited")
        db.commit()

        def edit(uid):
            return [(e["from"], e["to"]) for e in life.state(db, doc(db), user(db, uid))["timeline"] if e["kind"] == "content_edited"]
        assert edit(6) == [(None, None)]                                        # Uma reads the version in force only
        assert edit(1) == edit(2) == [("Version one.", "Version one, with a new rule.")]       # the owner, a reviewer


def test_the_acknowledge_route_takes_the_version_in_force(noflush):
    from grc.models import get_db
    from grc.modules.governance.routers.document_lifecycle import router

    app = FastAPI()
    app.include_router(router)
    db = noflush()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user(db, 6)
    client = TestClient(app)
    in_review(db)
    seen = client.get("/documents/5/lifecycle").json()
    assert seen["document"]["in_force"] == "1.0" and [r["version"] for r in seen["mine"]] == ["1.0"]
    newest = client.post("/documents/5/lifecycle/acknowledge", json={"version": "1.1"})
    assert newest.status_code == 409 and "version in force" in newest.json()["detail"]
    assert client.post("/documents/5/lifecycle/acknowledge", json={"version": "1.0"}).json()["mine"] == []
    db.close()


def test_an_attestation_campaign_shows_and_seals_the_version_in_force(noflush, monkeypatch, tmp_path):
    from grc.modules.governance.routers import document_attestations as external
    from grc.services import esign

    monkeypatch.setattr(external, "_SIG_DIR", str(tmp_path))
    with noflush() as db:
        in_review(db)
        db.add(m.DocumentAttestationCampaign(id=1, tenant_id=1, document_id=5, name="Access policy", status="active",
                                             public_token="tok", allowed_email_domain="cfsb.test"))
        db.commit()
        req = SimpleNamespace(**vars(_request()), state=SimpleNamespace())
        shown = external.public_get_by_token(token="tok", request=req, db=db)["document"]
        assert (shown["version"], shown["title"], shown["doc_type"]) == ("1.0", "Access policy", "policy")
        assert "Version one." in shown["html"] and "new rule" not in shown["html"]
        body = external.PublicAckSubmit(name="Ali Raza", email="ali@cfsb.test", designation="Analyst", signature_data=_png())
        external.public_acknowledge(token="tok", body=body, request=req, db=db)
        sig = db.query(m.ElectronicSignature).filter_by(record_type="doc_attestation_ack").one()
        in_force = db.query(m.GovernanceDocumentVersion).filter_by(version_number="1.0").one()
        assert (sig.document_version, sig.content_sha256) == ("1.0", esign.document_fingerprint(in_force))
