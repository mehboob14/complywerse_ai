"""Approval routes (modules/governance/routes.py, D33): a document reviewed by X, then Y, then Z, then approved; anyone whose turn
it is may ask for changes, which holds the route until the author resubmits; a minor change starts that stage again for everyone
in it (test_document_rereview.py), a major one the whole route; reject only where the stage allows it; nobody approves a document
they wrote; a step can be delegated; the author can withdraw it. Documents without a route of their own keep the sign-off flow as
it was (test_signoff_rounds.py and the other sign-off suites)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance import routes
from grc.modules.governance.routers import document_signoff as signoff

from test_esignature import _png, _request

OLIVIA, RANA, RAFAY, MINA, MO, UMA, ADAM = 1, 2, 3, 4, 5, 6, 7       # Olivia wrote and owns the document; Adam administers
APPROVERS = 10
TEXT = ("# Access policy\n\n## 1. Purpose\n\nThis policy sets how access to the bank's systems is requested, approved, granted, "
        "reviewed every quarter and removed when people move or leave, so that only the right people reach customer data.\n\n"
        "## 2. Scope\n\nAll staff, contractors, vendors and service accounts with access to production systems.\n")


@pytest.fixture(autouse=True)
def _tenants(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    for uid, name in [(OLIVIA, "Olivia Owner"), (RANA, "Rana Reviewer"), (RAFAY, "Rafay Reviewer"), (MINA, "Mina Manager"),
                      (MO, "Mo Manager"), (UMA, "Uma User"), (ADAM, "Adam Admin")]:
        session.add(m.GRCUser(id=uid, username=name.split()[0].lower(), email=f"{name.split()[0].lower()}@cfsb.test", display_name=name))
    session.add(m.Role(id=APPROVERS, tenant_id=1, name="Approvers"))
    session.add(m.Role(id=11, tenant_id=1, name="Administrator"))
    for uid in (MINA, MO):
        session.add(m.UserRole(user_id=uid, role_id=APPROVERS, tenant_id=1))
    session.add(m.UserRole(user_id=ADAM, role_id=11, tenant_id=1))
    session.add(m.Role(id=900, tenant_id=1, name="Staff"))                       # everyone opens Task Management
    session.add(m.Permission(id=900, name=life.TASKS_VIEW, resource="critical_tasks:tasks", action="view"))
    session.add(m.RolePermission(role_id=900, permission_id=900))
    for uid in range(1, 8):
        session.add(m.UserRole(user_id=uid, role_id=900, tenant_id=1))
    session.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="draft", current_version="1.0",
                                     content=TEXT, owner_id=OLIVIA, author_id=OLIVIA))
    session.commit()
    yield session
    session.close()


# ── helpers ──────────────────────────────────────────────────────────────────
def user(db, uid):
    return db.get(m.GRCUser, uid)


def doc(db):
    return db.get(m.GovernanceDocument, 5)


def person(uid):
    return {"target_type": "user", "target_id": uid}


def stage(kind="review", people=(), **kw):
    return signoff.StageIn(kind=kind, people=[signoff.ParticipantIn(**p) for p in people], **kw)


def set_route(db, *stages, by=OLIVIA):
    return signoff.set_route(5, signoff.RouteUpdate(stages=list(stages)), db, user(db, by))


def send(db, by=OLIVIA):
    return signoff.send_for_review(5, db, user(db, by))


def sign(db, uid):
    return signoff.sign_document(5, signoff.SignRequest(signature_image=_png()), _request(), db, user(db, uid))


def ask_changes(db, uid, comment="Clarify who approves an exception in section 2."):
    return signoff.request_changes(5, signoff.ChangesRequest(comment=comment), db, user(db, uid))


def resubmit(db, note="Section 2 now names the approver.", major=False, by=OLIVIA):
    return signoff.resubmit(5, signoff.ResubmitRequest(note=note, major=major), db, user(db, by))


def view(db, uid=OLIVIA):
    return signoff.get_signoff(5, db, user(db, uid))


def refused(fn, *args):
    with pytest.raises(HTTPException) as e:
        fn(*args)
    return e.value


def pending(db, kind=None):
    q = db.query(m.DocumentObligation).filter_by(document_id=5, status="pending").order_by(m.DocumentObligation.id)
    return [(o.kind, o.user_id) for o in (q.filter_by(kind=kind) if kind else q)]


def states(db, position, uid=OLIVIA):
    s = next(s for s in view(db, uid)["route"]["stages"] if s["position"] == position)
    return [p["state"] for p in s["people"]]


def alerts(db, uid):
    return [n.subject for n in db.query(m.WorkflowNotification).filter_by(user_id=uid).order_by(m.WorkflowNotification.id)]


def actions(db):
    return [a.action for a in db.query(m.DocumentAuditLog).filter_by(document_id=5).order_by(m.DocumentAuditLog.id)]


def x_y_z_then_approvers(db):
    return set_route(db, stage("review", [person(RANA), person(RAFAY), person(UMA)], name="Review", order="in_turn"),
                     stage("approval", [{"target_type": "role", "target_id": APPROVERS}], name="Approval", rule="any"))


# ── the route the user asked for ─────────────────────────────────────────────
def test_x_then_y_then_z_then_approvers_with_y_asking_for_changes_in_the_middle(db):
    out = x_y_z_then_approvers(db)
    assert out["route"]["custom"] and [s["name"] for s in out["route"]["stages"]] == ["Review", "Approval"]
    sent = send(db)
    assert (sent["status"], doc(db).route_stage) == ("pending_review", 1)
    assert pending(db) == [("review", RANA)]                                  # one after another: only X is asked
    assert alerts(db, RANA) == ["Review requested: Access policy"] and alerts(db, RAFAY) == []
    assert refused(sign, db, RAFAY).status_code == 403                        # not Y's turn yet
    assert [i["document_id"] for i in signoff.my_pending_signoffs(db, user(db, RAFAY))["items"]] == []

    assert sign(db, RANA)["status"] == "pending_review"                      # X signs: Y's turn
    assert pending(db) == [("review", RAFAY)]
    assert states(db, 1) == ["signed", "waiting", "not_yet"]
    assert [i["stage_name"] for i in signoff.my_pending_signoffs(db, user(db, RAFAY))["items"]] == ["Review"]

    round_at = doc(db).signoff_round_at
    held = ask_changes(db, RAFAY)                                             # Y asks for changes: the route waits
    assert held["route"]["hold"]["requested_by"] == "Rafay Reviewer" and held["route"]["stages"][0]["status"] == "on_hold"
    assert states(db, 1) == ["signed", "changes_requested", "not_yet"]
    assert pending(db) == [("changes", OLIVIA)]                               # the author is asked to make them, with a task
    task = db.query(m.CriticalTask).filter_by(source_module="document_lifecycle", assigned_owner_id=OLIVIA).one()
    assert task.title == "Revise: Access policy" and alerts(db, OLIVIA)[-1] == "Changes requested: Access policy"
    assert view(db)["can_resubmit"] and not view(db, RAFAY)["can_resubmit"]
    assert refused(sign, db, RAFAY).detail == signoff.ON_HOLD                 # nobody signs while it is held

    d = doc(db)                                                               # the author makes a small change
    d.content = TEXT.replace("contractors, vendors", "contractors, temporary staff, vendors")
    assert life.changed_after_review(db, d, "pending_review", OLIVIA, "Content edited") is True
    db.commit()
    assert doc(db).signoff_round_at == round_at and routes.on_hold(db, doc(db))   # no new round while it is held

    back = resubmit(db)                                                       # a minor change: the stage starts again, from X
    assert back["route"]["hold"] is None and states(db, 1) == ["waiting", "not_yet", "not_yet"]
    assert pending(db) == [("review", RANA)]
    assert alerts(db, RANA)[-1] == "Review again: Access policy" and alerts(db, RAFAY)[-1] == "Resubmitted: Access policy"
    hold = db.query(m.DocumentRouteHold).one()
    assert (hold.change, hold.outcome, hold.resubmit_note) == ("minor", "resumed", "Section 2 now names the approver.")

    sign(db, RANA)                                                            # X signs again: Y's turn, told what they asked
    assert pending(db) == [("review", RAFAY)] and alerts(db, RAFAY)[-1] == "Review again: Access policy"
    sign(db, RAFAY)
    assert pending(db) == [("review", UMA)]
    out = sign(db, UMA)                                                       # Z signs: on to the approvers
    assert (out["status"], doc(db).route_stage) == ("pending_approval", 2)
    assert sorted(pending(db)) == [("approval", MINA), ("approval", MO)]
    assert sign(db, MINA)["status"] == "approved"                            # any one of them
    assert doc(db).approved_by == MINA and pending(db) == []
    assert {"changes_requested", "resubmitted", "route_set"} <= set(actions(db))


def test_a_major_change_starts_the_route_again_from_its_first_stage(db):
    x_y_z_then_approvers(db)
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    d = doc(db)
    d.content = TEXT + "\n## 3. Exceptions\n\nAn exception is approved by the CISO for at most ninety days.\n"     # a section added
    db.commit()
    resubmit(db)
    hold = db.query(m.DocumentRouteHold).one()
    assert (hold.change, hold.outcome) == ("major", "restarted")
    assert (doc(db).status, doc(db).route_stage) == ("pending_review", 1)
    assert states(db, 1) == ["waiting", "not_yet", "not_yet"]                 # X signs again: the earlier signature no longer counts
    assert pending(db) == [("review", RANA)]


def test_the_author_may_call_a_change_major_but_never_minor(db):
    x_y_z_then_approvers(db)
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    resubmit(db, major=True)                                                  # nothing changed, the author still asks everyone again
    assert db.query(m.DocumentRouteHold).one().change == "major" and pending(db) == [("review", RANA)]


# ── the default route ────────────────────────────────────────────────────────
def test_on_the_default_route_changes_asked_for_hold_the_others_and_the_stage_starts_again(db):
    signoff.set_participants(5, signoff.ParticipantsUpdate(reviewers=[signoff.ParticipantIn(**person(RANA)), signoff.ParticipantIn(**person(RAFAY))],
                                                           approvers=[signoff.ParticipantIn(target_type="role", target_id=APPROVERS)]), db, user(db, OLIVIA))
    send(db)
    assert not view(db)["route"]["custom"] and sorted(pending(db)) == [("review", RANA), ("review", RAFAY)]
    sign(db, RANA)
    ask_changes(db, RAFAY, "Section 1 should say who grants access.")
    assert pending(db) == [("changes", OLIVIA)]
    assert alerts(db, RANA)[-1] != "On hold: Access policy"                   # Rana had signed already: nothing is held of hers
    resubmit(db)
    assert sorted(pending(db)) == [("review", RANA), ("review", RAFAY)]       # the review starts again: Rana is asked again too
    assert sign(db, RAFAY)["status"] == "pending_review"                      # her earlier signature no longer counts
    assert sign(db, RANA)["status"] == "pending_approval"


def test_reviewers_who_had_not_signed_are_told_it_is_on_hold_and_asked_again(db):
    signoff.set_participants(5, signoff.ParticipantsUpdate(reviewers=[signoff.ParticipantIn(**person(RANA)), signoff.ParticipantIn(**person(RAFAY))],
                                                           approvers=[signoff.ParticipantIn(**person(MINA))]), db, user(db, OLIVIA))
    send(db)
    ask_changes(db, RAFAY)
    held = db.query(m.DocumentObligation).filter_by(user_id=RANA, status="held").one()
    assert held.critical_task_id is None and alerts(db, RANA)[-1] == "On hold: Access policy"
    resubmit(db)
    assert sorted(pending(db)) == [("review", RANA), ("review", RAFAY)]
    assert held.status == "pending" and held.critical_task_id is not None    # her waiting request is opened again, with a task
    assert db.query(m.DocumentObligation).filter_by(user_id=RANA, kind="review").count() == 1     # not a second one
    assert alerts(db, RANA)[-1] == "Review again: Access policy"


# ── reject, four-eyes, delegation, withdrawal ────────────────────────────────
def test_reject_is_offered_at_approval_stages_and_not_at_review_stages(db):
    set_route(db, stage("review", [person(RANA)]), stage("approval", [person(MINA)]))
    send(db)
    assert view(db, RANA)["my_step"]["can_reject"] is False
    e = refused(signoff.reject_document, 5, signoff.RejectRequest(comment="No"), db, user(db, RANA))
    assert e.status_code == 403 and "ask for changes" in e.detail
    sign(db, RANA)
    assert view(db, MINA)["my_step"]["can_reject"] is True
    assert signoff.reject_document(5, signoff.RejectRequest(comment="Not now"), db, user(db, MINA))["status"] == "draft"
    assert doc(db).route_stage is None


def test_the_author_never_approves_their_own_document_unless_an_administrator_allows_it(db):
    set_route(db, stage("approval", [person(OLIVIA), person(MINA)]))
    send(db)
    assert pending(db) == [("approval", MINA)]                                # the author is not asked
    assert refused(sign, db, OLIVIA).status_code == 403
    assert sign(db, MINA)["status"] == "approved"                             # Olivia's own approval is not needed

    d = doc(db)
    d.status = "draft"
    db.commit()
    set_route(db, stage("approval", [person(OLIVIA)]))
    e = refused(send, db)
    assert e.status_code == 400 and "its author does not approve it" in e.detail
    life.save_settings(db, 1, {"four_eyes": False}, ADAM)
    assert send(db)["status"] == "pending_approval" and pending(db) == [("approval", OLIVIA)]


def test_only_an_administrator_changes_four_eyes(db):
    from grc.modules.governance.routers import document_lifecycle as lifecycle_routes

    e = refused(lifecycle_routes.put_lifecycle_settings, lifecycle_routes.SettingsIn(four_eyes=False), db, user(db, MINA))
    assert e.status_code == 403
    assert life.settings(db, 1)["four_eyes"] is True


def test_a_delegate_signs_for_the_person_who_handed_the_step_over(db):
    x_y_z_then_approvers(db)
    send(db)
    e = refused(signoff.delegate, 5, signoff.DelegateRequest(user_id=RAFAY), db, user(db, RANA))
    assert e.status_code == 400 and "already asked" in e.detail                  # Rafay is on this stage already
    signoff.delegate(5, signoff.DelegateRequest(user_id=MO, note="On leave this week"), db, user(db, RANA))
    assert pending(db) == [("review", MO)] and alerts(db, MO)[-1] == "Delegated to you: Access policy"
    assert refused(sign, db, RANA).status_code == 403                         # handed over: Rana no longer signs
    assert view(db, MO)["my_step"]["on_behalf_of"] == "Rana Reviewer"
    sign(db, MO)
    signature = db.query(m.DocumentSignature).one()
    assert (signature.signer_user_id, signature.on_behalf_of) == (MO, RANA)
    assert states(db, 1)[0] == "signed" and pending(db) == [("review", RAFAY)]   # Rana's turn is done: Rafay next


def test_the_author_withdraws_it_and_everyone_still_asked_is_told(db):
    x_y_z_then_approvers(db)
    send(db)
    ask_changes(db, RANA)
    out = signoff.withdraw(5, signoff.WithdrawRequest(reason="Rewriting it"), db, user(db, OLIVIA))
    assert out["status"] == "draft" and pending(db) == []
    assert db.query(m.DocumentRouteHold).one().outcome == "withdrawn"
    assert send(db)["status"] == "pending_review" and pending(db) == [("review", RANA)]   # a new round from the start
    signoff.withdraw(5, signoff.WithdrawRequest(), db, user(db, OLIVIA))                  # Rana was asked: she is told
    assert alerts(db, RANA)[-1] == "Withdrawn: Access policy" and pending(db) == []


# ── rules, information, editing the route ────────────────────────────────────
def test_at_least_two_of_three_and_the_third_is_no_longer_asked(db):
    set_route(db, stage("review", [person(RANA), person(RAFAY), person(UMA)], rule="at_least", min_count=2), stage("approval", [person(MINA)]))
    send(db)
    assert sorted(pending(db)) == [("review", RANA), ("review", RAFAY), ("review", UMA)]
    sign(db, RANA)
    assert view(db)["route"]["stages"][0]["progress"] == {"required": 2, "signed": 1}
    assert sign(db, UMA)["status"] == "pending_approval"
    assert pending(db) == [("approval", MINA)]                                # Rafay's request ended


def test_people_of_an_information_stage_are_told_and_nobody_waits_for_them(db):
    set_route(db, stage("review", [person(RANA)]), stage("information", [person(UMA)], name="Compliance (for information)"),
              stage("approval", [person(MINA)]))
    send(db)
    sign(db, RANA)
    assert (doc(db).status, doc(db).route_stage) == ("pending_approval", 3)
    assert alerts(db, UMA) == ["For information: Access policy"] and ("review", UMA) not in pending(db)
    assert states(db, 2) == ["informed"]


def test_a_route_is_checked_when_saved_and_kept_while_it_is_in_review(db):
    assert refused(set_route, db, stage("review", [])).detail.endswith("choose who is asked.")
    e = refused(set_route, db, stage("review", [person(RANA)], rule="at_least", min_count=3))
    assert e.status_code == 400 and "from 1 to 1" in e.detail
    set_route(db, stage("review", [person(RANA)], name="Department head"), stage("approval", [person(MINA)], due_days=3))
    send(db)
    assert refused(set_route, db, stage("review", [person(UMA)])).status_code == 409
    ob = db.query(m.DocumentObligation).filter_by(user_id=RANA).one()
    assert ob.stage_position == 1
    # the details dialog sends the reviewers and approvers back as they are: only prepared-by changes; anything else is refused
    keep = signoff.ParticipantsUpdate(prepared_by=[signoff.ParticipantIn(**person(UMA))], reviewers=[signoff.ParticipantIn(**person(RANA))],
                                      approvers=[signoff.ParticipantIn(**person(MINA))])
    assert [p["target_id"] for p in signoff.set_participants(5, keep, db, user(db, OLIVIA))["participants"]["prepared_by"]] == [UMA]
    change = signoff.ParticipantsUpdate(reviewers=[signoff.ParticipantIn(**person(UMA))], approvers=[signoff.ParticipantIn(**person(MINA))])
    assert refused(signoff.set_participants, 5, change, db, user(db, OLIVIA)).status_code == 409
    sign(db, RANA)
    ob = db.query(m.DocumentObligation).filter_by(user_id=MINA).one()
    assert 2.5 < (ob.due_date - ob.requested_at).total_seconds() / 86400 < 3.5        # the stage's own days


def test_no_stages_is_the_default_route_again(db):
    set_route(db, stage("review", [person(RANA)]))
    out = set_route(db)
    assert not out["route"]["custom"] and out["participants"]["reviewer"] == []
    assert db.query(m.DocumentRouteStage).count() == 0


def test_on_the_usual_route_an_author_who_is_the_only_approver_is_named_and_it_never_waits_on_nobody(db):
    signoff.set_participants(5, signoff.ParticipantsUpdate(approvers=[signoff.ParticipantIn(**person(OLIVIA))]), db, user(db, OLIVIA))
    out = send(db)
    assert out["status"] == "draft" and "Olivia Owner wrote this document and does not approve it" in out["notice"]
    signoff.set_participants(5, signoff.ParticipantsUpdate(reviewers=[signoff.ParticipantIn(**person(RANA))],
                                                           approvers=[signoff.ParticipantIn(**person(OLIVIA))]), db, user(db, OLIVIA))
    out = send(db)
    assert out["status"] == "pending_review" and "does not approve it" in out["notice"]
    assert sign(db, RANA)["status"] == "draft"                              # reviewed, nobody may approve it: a draft, not stuck
