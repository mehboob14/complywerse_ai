"""After changes asked for at a stage are resubmitted with a minor change (or none), that stage starts again for everyone in it (the
user, 2026-10-21; routes.restarts): the signatures given there before stay in the history but no longer count, everyone is asked
again (together: all at once; in turn: from the first; any one / at least N: the count starts again), and each is told what changed
since they signed ("You reviewed this on ... (v1.0). ... made changes since (v1.0 → v1.2). Please review it again.") or since they
asked for the changes. Earlier stages' signatures stand; a major change starts the whole route again, as before. Fixtures as in
test_document_routes.py."""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance import routes
from grc.modules.governance.routers import document_signoff as signoff
from grc.modules.governance.routers.documents import _snapshot_content_version
from grc.services import esign

from test_esignature import _png, _request

OLIVIA, RANA, RAFAY, MINA, MO, UMA, ADAM = 1, 2, 3, 4, 5, 6, 7       # Olivia wrote and owns the document; Adam administers
APPROVERS = 10
TEXT = ("# Access policy\n\n## 1. Purpose\n\nThis policy sets how access to the bank's systems is requested, approved, granted, "
        "reviewed every quarter and removed when people move or leave, so that only the right people reach customer data.\n\n"
        "## 2. Scope\n\nAll staff, contractors, vendors and service accounts with access to production systems.\n")
SMALL = TEXT.replace("contractors, vendors", "contractors, temporary staff, vendors")
ASKED = "Name who approves an exception."
NOTE = "Section 2 now names the approver."


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


def set_route(db, *stages):
    return signoff.set_route(5, signoff.RouteUpdate(stages=list(stages)), db, user(db, OLIVIA))


def send(db):
    return signoff.send_for_review(5, db, user(db, OLIVIA))


def sign(db, uid):
    return signoff.sign_document(5, signoff.SignRequest(signature_image=_png()), _request(), db, user(db, uid))


def ask_changes(db, uid, comment=ASKED):
    return signoff.request_changes(5, signoff.ChangesRequest(comment=comment), db, user(db, uid))


def edit(db, text=SMALL):
    """What a save of the author does while it is held: a new version, and the round left as it is."""
    d = doc(db)
    old, number = d.content, d.current_version
    d.content = text
    _snapshot_content_version(db, d, old_content=old, old_title=d.title, old_version=number, change_type="minor",
                              change_reason="Edited", user_id=OLIVIA)
    assert life.changed_after_review(db, d, d.status, OLIVIA, "Content edited") is True
    db.commit()


def resubmit(db, note=NOTE, major=False):
    return signoff.resubmit(5, signoff.ResubmitRequest(note=note, major=major), db, user(db, OLIVIA))


def view(db, uid=OLIVIA):
    return signoff.get_signoff(5, db, user(db, uid))


def pending(db, kind=None):
    q = db.query(m.DocumentObligation).filter_by(document_id=5, status="pending").order_by(m.DocumentObligation.id)
    return sorted((o.kind, o.user_id) for o in (q.filter_by(kind=kind) if kind else q))


def stage_view(db, position, uid=OLIVIA):
    return next(s for s in view(db, uid)["route"]["stages"] if s["position"] == position)


def states(db, position):
    return [p["state"] for p in stage_view(db, position)["people"]]


def last_alert(db, uid):
    return db.query(m.WorkflowNotification).filter_by(user_id=uid).order_by(m.WorkflowNotification.id.desc()).first()


def open_tasks(db, kind="review"):
    rows = db.query(m.DocumentObligation).filter_by(document_id=5, status="pending", kind=kind).all()
    return {o.user_id: db.get(m.CriticalTask, o.critical_task_id) for o in rows if o.critical_task_id}


def on(dt):
    return f"{dt.day} {dt:%b %Y}"


def version_id(db, number):
    return db.query(m.GovernanceDocumentVersion).filter_by(document_id=5, version_number=number).one().id


def two_reviewers_then_mina(db, **review):
    return set_route(db, stage("review", [person(RANA), person(RAFAY)], name="Review", **review), stage("approval", [person(MINA)], name="Approval"))


# ── the case the user described ──────────────────────────────────────────────
def test_x_signed_y_asked_for_changes_then_both_review_again_and_the_stage_waits_for_both(db):
    two_reviewers_then_mina(db)
    send(db)
    sign(db, RANA)                                                # X reviews 1.0 (no sign-off table in it: no stamp, no version)
    ask_changes(db, RAFAY)                                        # Y asks for changes
    edit(db)                                                      # the author makes them: 1.1 (1.0 kept as the version before)
    out = resubmit(db)
    assert (out["outcome"], out["change"], doc(db).route_stage) == ("resumed", "minor", 1)
    assert pending(db) == [("review", RANA), ("review", RAFAY)]                # both are asked again, with a task each
    assert {u: t.title for u, t in open_tasks(db).items()} == {RANA: "Review again: Access policy", RAFAY: "Review again: Access policy"}
    assert states(db, 1) == ["waiting", "waiting"] and stage_view(db, 1)["progress"] == {"required": 2, "signed": 0}

    x = view(db, RANA)["my_step"]["again"]                        # X: previously signed, the version, where the changes start
    assert (x["kind"], x["version"], x["version_id"], x["now"], x["changed"]) == ("signed", "1.0", version_id(db, "1.0"), "1.1", True)
    assert (x["by"], x["note"], x["stage"], x["stage_kind"]) == ("Olivia Owner", NOTE, "Review", "review")
    y = view(db, RAFAY)["my_step"]["again"]                       # Y: asked for changes, and what (on 1.0: no version kept then)
    assert db.query(m.DocumentRouteHold).one().version_id is None
    assert (y["kind"], y["comment"], y["version_id"], y["version"], y["now"]) == ("changes", ASKED, version_id(db, "1.0"), "1.0", "1.1")

    assert sign(db, RAFAY)["status"] == "pending_review"          # not done until both have signed again
    assert sign(db, RANA)["status"] == "pending_approval" and doc(db).route_stage == 2
    assert pending(db) == [("approval", MINA)] and view(db, MINA)["my_step"]["again"] is None


def test_what_each_person_asked_again_is_told_and_their_task_says(db):
    two_reviewers_then_mina(db)
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    edit(db)
    resubmit(db)
    signed_on = on(db.query(m.DocumentSignature).filter_by(signer_user_id=RANA).one().signed_at)
    asked_on = on(db.query(m.DocumentRouteHold).one().requested_at)
    x = last_alert(db, RANA)
    assert x.subject == "Review again: Access policy" and x.link == "/governance/documents/5?act=sign"
    assert x.message == (f"You reviewed this on {signed_on} (v1.0). Olivia Owner made changes since (v1.0 → v1.1). Please review it again. "
                         f"Olivia Owner wrote: \"{NOTE}\" It is in your tasks and in the document's Approvals.")
    y = last_alert(db, RAFAY)
    assert y.subject == "Review again: Access policy"
    assert y.message.startswith(f"You asked for changes on {asked_on}: \"{ASKED}\". Olivia Owner resubmitted it (v1.1) — see what changed.")
    tasks = open_tasks(db)
    assert tasks[RANA].description.startswith(f"You reviewed this on {signed_on} (v1.0). Olivia Owner made changes since (v1.0 → v1.1). Please review and sign")
    assert tasks[RAFAY].description.startswith(f"You asked for changes on {asked_on}: \"{ASKED}\". Olivia Owner resubmitted it (v1.1). Please review and sign")

    items = {i["kind"]: i for i in life.mine(db, RANA)}           # My Approvals
    assert items["review"]["again"]["kind"] == "signed" and items["review"]["again"]["version_id"] == version_id(db, "1.0")
    shown = life.task_request(db, tasks[RAFAY])                   # Task Management
    assert shown["again"]["kind"] == "changes" and shown["again"]["comment"] == ASKED and shown["action_label"] == "Review and sign"


def test_in_turn_the_stage_starts_again_from_its_first_person(db):
    set_route(db, stage("review", [person(RANA), person(RAFAY), person(UMA)], name="Review", order="in_turn"),
              stage("approval", [person(MINA)], name="Approval"))
    send(db)
    sign(db, RANA)
    sign(db, RAFAY)
    ask_changes(db, UMA)                                          # the third asks for changes
    edit(db)
    resubmit(db)
    assert pending(db) == [("review", RANA)] and states(db, 1) == ["waiting", "not_yet", "not_yet"]
    assert last_alert(db, UMA).subject == "Resubmitted: Access policy" and "when it is your turn" in last_alert(db, UMA).message
    sign(db, RANA)
    assert pending(db) == [("review", RAFAY)] and last_alert(db, RAFAY).subject == "Review again: Access policy"
    sign(db, RAFAY)
    assert pending(db) == [("review", UMA)] and last_alert(db, UMA).subject == "Review again: Access policy"
    assert view(db, UMA)["my_step"]["again"]["kind"] == "changes"
    assert sign(db, UMA)["status"] == "pending_approval"


def test_at_least_n_counts_again_from_nothing(db):
    set_route(db, stage("review", [person(RANA), person(RAFAY), person(UMA)], name="Review", rule="at_least", min_count=2),
              stage("approval", [person(MINA)], name="Approval"))
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    resubmit(db)                                                  # no change to the text: still the stage starts again
    assert db.query(m.DocumentRouteHold).one().change == "none"
    assert stage_view(db, 1)["progress"] == {"required": 2, "signed": 0}
    assert sign(db, UMA)["status"] == "pending_review"            # one of two: Rana's earlier signature does not count
    assert "without changing the text" in last_alert(db, RANA).message
    assert sign(db, RANA)["status"] == "pending_approval"


def test_any_one_asks_everyone_at_the_stage_again(db):
    set_route(db, stage("review", [person(RANA), person(RAFAY)], name="Review"),
              stage("approval", [person(MINA), person(MO)], name="Approval", rule="any"))
    send(db)
    sign(db, RANA)
    sign(db, RAFAY)
    ask_changes(db, MINA)                                         # any one approves; Mina asks for changes instead
    waited = db.query(m.DocumentObligation).filter_by(user_id=MO, status="held").one()
    edit(db)
    resubmit(db)
    assert doc(db).status == "pending_approval" and pending(db) == [("approval", MINA), ("approval", MO)]
    assert pending(db, "review") == [] and stage_view(db, 2)["progress"] == {"required": 1, "signed": 0}
    assert waited.status == "pending" and last_alert(db, MO).subject == "Approve again: Access policy"
    assert last_alert(db, MINA).subject == "Approve again: Access policy" and view(db, MINA)["my_step"]["again"]["kind"] == "changes"
    assert sign(db, MO)["status"] == "approved"


def test_an_earlier_stage_still_stands_and_only_the_stage_asked_at_starts_again(db):
    set_route(db, stage("review", [person(RANA)], name="Department head"),
              stage("review", [person(RAFAY), person(UMA)], name="Compliance"), stage("approval", [person(MINA)], name="Approval"))
    send(db)
    sign(db, RANA)
    sign(db, RAFAY)
    ask_changes(db, UMA)
    edit(db)
    resubmit(db)
    assert doc(db).route_stage == 2 and pending(db) == [("review", RAFAY), ("review", UMA)]      # Rana is not asked again
    assert states(db, 1) == ["signed"] and stage_view(db, 1)["people"][0]["earlier"] is None
    compliance = stage_view(db, 2)
    assert compliance["restarted"] and [p["earlier"]["kind"] for p in compliance["people"]] == ["signed", "changes"]
    assert compliance["people"][0]["earlier"]["version"] == "1.0" and compliance["people"][1]["earlier"]["comment"] == ASKED
    sign(db, RAFAY)
    assert sign(db, UMA)["status"] == "pending_approval"


def test_a_major_change_still_starts_the_whole_route_again(db):
    set_route(db, stage("review", [person(RANA)], name="Department head"),
              stage("review", [person(RAFAY), person(UMA)], name="Compliance"), stage("approval", [person(MINA)], name="Approval"))
    send(db)
    sign(db, RANA)
    sign(db, RAFAY)
    ask_changes(db, UMA)
    edit(db, TEXT + "\n## 3. Exceptions\n\nAn exception is approved by the CISO for at most ninety days.\n")
    assert resubmit(db)["outcome"] == "restarted"
    assert (doc(db).route_stage, pending(db)) == (1, [("review", RANA)])
    assert last_alert(db, RANA).subject == "Review requested: Access policy" and view(db, RANA)["my_step"]["again"] is None
    assert "review_again_requested" not in [a.action for a in db.query(m.DocumentAuditLog).filter_by(document_id=5)]


def test_an_approval_stage_is_approved_again_by_everyone(db):
    set_route(db, stage("review", [person(RANA)], name="Review"),
              stage("approval", [person(MINA), person(MO)], name="Approval"))
    send(db)
    sign(db, RANA)
    sign(db, MINA)
    ask_changes(db, MO)
    edit(db)
    resubmit(db)
    assert pending(db) == [("approval", MINA), ("approval", MO)] and pending(db, "review") == []
    alert = last_alert(db, MINA)
    assert alert.subject == "Approve again: Access policy" and alert.message.startswith("You approved this on ")
    assert "Please approve it again." in alert.message and open_tasks(db, "approval")[MINA].title == "Approve again: Access policy"
    assert sign(db, MO)["status"] == "pending_approval"
    assert sign(db, MINA)["status"] == "approved"


def test_on_the_default_route_the_reviewers_review_again(db):
    signoff.set_participants(5, signoff.ParticipantsUpdate(reviewers=[signoff.ParticipantIn(**person(RANA)), signoff.ParticipantIn(**person(RAFAY))],
                                                           approvers=[signoff.ParticipantIn(**person(MINA))]), db, user(db, OLIVIA))
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    edit(db)
    resubmit(db)
    assert not view(db)["route"]["custom"] and pending(db) == [("review", RANA), ("review", RAFAY)]
    assert view(db, RANA)["my_step"]["again"]["kind"] == "signed" and last_alert(db, RANA).subject == "Review again: Access policy"
    assert view(db)["progress"]["reviewer"] == {"required": 2, "signed": 0}
    assert sign(db, RAFAY)["status"] == "pending_review"
    assert sign(db, RANA)["status"] == "pending_approval"


def test_nobody_is_asked_twice_and_a_waiting_request_is_opened_again(db):
    set_route(db, stage("review", [person(RANA), person(RAFAY), person(UMA)], name="Review"), stage("approval", [person(MINA)], name="Approval"))
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)                                        # Uma had not signed: her request waits
    waited = db.query(m.DocumentObligation).filter_by(user_id=UMA, status="held").one()
    edit(db)
    resubmit(db)
    rows = lambda uid: [(o.status, o.id) for o in db.query(m.DocumentObligation).filter_by(document_id=5, kind="review", user_id=uid).order_by(m.DocumentObligation.id)]
    assert [s for s, _ in rows(RANA)] == ["done", "pending"] and [s for s, _ in rows(RAFAY)] == ["changes_requested", "pending"]
    assert rows(UMA) == [("pending", waited.id)]                  # the same request, not a second one
    assert waited.critical_task_id and db.get(m.CriticalTask, waited.critical_task_id).title == "Review again: Access policy"
    assert last_alert(db, UMA).message.startswith("Olivia Owner resubmitted it (v1.1) after Rafay Reviewer asked for changes. Please review it.")
    assert view(db, UMA)["my_step"]["again"] is None              # she had not reviewed it
    assert db.query(m.CriticalTask).filter_by(source_module="document_lifecycle", assigned_owner_id=RANA, status="Open").count() == 1


def test_the_earlier_signature_is_kept_sealed_and_the_history_says_it_was_asked_again(db):
    two_reviewers_then_mina(db)
    send(db)
    sign(db, RANA)
    before = [(e.id, e.seal, e.document_version) for e in db.query(m.ElectronicSignature).order_by(m.ElectronicSignature.id)]
    ask_changes(db, RAFAY)
    edit(db)
    resubmit(db)
    assert [(e.id, e.seal, e.document_version) for e in db.query(m.ElectronicSignature).order_by(m.ElectronicSignature.id)] == before
    assert all(esign.verify(e)["valid"] for e in db.query(m.ElectronicSignature))
    kept = view(db)["signatures"]
    assert [(s["signer_user_id"], s["asked_again"], s["this_round"]) for s in kept] == [(RANA, True, True)]
    rana = stage_view(db, 1)["people"][0]
    assert (rana["state"], rana["earlier"]["kind"], rana["earlier"]["version"], rana["earlier"]["by"]) == ("waiting", "signed", "1.0", "Rana Reviewer")
    log = db.query(m.DocumentAuditLog).filter_by(document_id=5, action="review_again_requested").one()
    assert log.performed_by == OLIVIA and log.new_value == "Rana Reviewer, Rafay Reviewer"
    assert log.action_details == "Review starts again after the changes: Rana Reviewer (had signed), Rafay Reviewer (asked for the changes) are asked again"
    from grc.modules.governance import change_chain

    assert change_chain.EVENT_LABEL["review_again_requested"] == "Asked again after changes"
    assert "review_again_requested" in [e["kind"] for e in change_chain.chain(db, doc(db))["events"]]
    sign(db, RANA)
    assert [s["asked_again"] for s in view(db)["signatures"]] == [True, False]       # the new one counts


def test_the_delegate_holding_the_step_is_asked_again_not_the_person_who_handed_it_over(db):
    two_reviewers_then_mina(db)
    send(db)
    signoff.delegate(5, signoff.DelegateRequest(user_id=MO, note="On leave"), db, user(db, RANA))
    sign(db, MO)                                                  # Mo signs for Rana
    ask_changes(db, RAFAY)
    edit(db)
    resubmit(db)
    assert pending(db) == [("review", RAFAY), ("review", MO)]     # Mo again, for Rana; Rana does not get it back
    ob = db.query(m.DocumentObligation).filter_by(user_id=MO, status="pending").one()
    assert ob.on_behalf_of == RANA and view(db, RANA)["my_step"] is None
    step = view(db, MO)["my_step"]
    assert step["on_behalf_of"] == "Rana Reviewer" and step["again"]["kind"] == "signed"
    sign(db, MO)
    signature = db.query(m.DocumentSignature).order_by(m.DocumentSignature.id.desc()).first()
    assert (signature.signer_user_id, signature.on_behalf_of) == (MO, RANA)
    assert sign(db, RAFAY)["status"] == "pending_approval"


def test_the_author_is_not_asked_again_at_approval(db):
    set_route(db, stage("approval", [person(OLIVIA), person(MINA), person(MO)], name="Approval"))
    send(db)
    sign(db, MINA)
    ask_changes(db, MO)
    edit(db)
    resubmit(db)
    assert pending(db) == [("approval", MINA), ("approval", MO)]  # four-eyes: Olivia wrote it
    assert view(db, OLIVIA)["my_step"] is None
    sign(db, MO)
    assert sign(db, MINA)["status"] == "approved"


def test_a_second_request_for_changes_starts_the_stage_again_once_more(db):
    two_reviewers_then_mina(db)
    send(db)
    sign(db, RANA)
    ask_changes(db, RAFAY)
    edit(db)
    resubmit(db)
    sign(db, RAFAY)                                               # Rafay signs this time, Rana asks for changes
    ask_changes(db, RANA, "Section 1: quarterly is not enough.")
    edit(db, SMALL.replace("every quarter", "every month"))
    resubmit(db)
    assert pending(db) == [("review", RANA), ("review", RAFAY)]
    rafay, rana = view(db, RAFAY)["my_step"]["again"], view(db, RANA)["my_step"]["again"]
    assert (rafay["kind"], rafay["version"], rafay["version_id"], rafay["now"]) == ("signed", "1.1", version_id(db, "1.1"), "1.2")
    assert (rana["kind"], rana["comment"], rana["version"]) == ("changes", "Section 1: quarterly is not enough.", "1.1")
    assert routes.restarts(db, doc(db)) == {1: max(h.signature_mark for h in db.query(m.DocumentRouteHold))}
    sign(db, RANA)
    assert sign(db, RAFAY)["status"] == "pending_approval"


def test_the_sentences_people_read():
    signed = {"kind": "signed", "at": "2026-10-21T09:15:00", "version": "1.0", "now": "1.2", "by": "Olivia Owner", "changed": True,
              "stage_kind": "review"}
    assert routes.again_text(signed) == ("You reviewed this on 21 Oct 2026 (v1.0). Olivia Owner made changes since (v1.0 → v1.2). "
                                         "Please review it again.")
    assert routes.again_text({**signed, "stage_kind": "approval"}).startswith("You approved this on 21 Oct 2026 (v1.0).")
    assert routes.again_text({**signed, "stage_kind": "approval"}).endswith("Please approve it again.")
    assert routes.again_text({**signed, "changed": False}) == ("You reviewed this on 21 Oct 2026 (v1.0). Olivia Owner resubmitted it "
                                                                "without changing the text (v1.2). Please review it again.")
    asked = {"kind": "changes", "at": "2026-10-02T09:15:00", "comment": ASKED, "now": "1.2", "by": "Olivia Owner", "changed": True}
    assert routes.again_text(asked) == f'You asked for changes on 2 Oct 2026: "{ASKED}". Olivia Owner resubmitted it (v1.2) — see what changed.'
    assert routes.again_text(asked, ask=False).endswith("resubmitted it (v1.2).")
    assert routes.again_text({**asked, "changed": False}).endswith("Olivia Owner resubmitted it without changing the text (v1.2).")
    stage_ = routes.Stage(1, "Review", restarted_after=7)
    sigs = [SimpleNamespace(id=i, stage_position=None, role_type="reviewer") for i in (5, 7, 9)]
    assert [s.id for s in routes.signatures_of(stage_, sigs)] == [9] and [s.id for s in routes.earlier_of(stage_, sigs)] == [5, 7]
    assert [s.id for s in routes.signatures_of(routes.Stage(1, "Review"), sigs)] == [5, 7, 9]
