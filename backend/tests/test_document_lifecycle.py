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
        db.add(m.Role(id=11, tenant_id=1, name="Tenant Admin"))
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
        assert any(e["kind"] == "acknowledged" and e["actor"] == "Uma User" for e in view["timeline"])

        life.acknowledge(db, d, user(db, 6))                                     # again: nothing changes
        assert len(obligations(db, "acknowledgement", "done")) == 2
        with pytest.raises(LookupError):
            life.acknowledge(db, d, user(db, 8))                                 # a deactivated user is not asked
        d.status = "draft"
        with pytest.raises(ValueError):
            life.acknowledge(db, d, user(db, 3))


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
    with world.factory() as db:
        db.query(m.Tenant).one().slug = "acme"
        db.commit()
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert obligations(db) == [] and tasks(db) == [] and not life.enabled(db)
        assert life.sweep(db) == {"asked": 0, "reminded": 0, "owner_told": 0, "admins_told": 0}
        monkeypatch.setattr("grc.config.DOCUMENT_LIFECYCLE_TENANTS", frozenset({"*"}))          # the quick switch for every tenant
        assert life.enabled(db)


def test_the_routes(world):
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
