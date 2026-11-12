"""Approval defaults per department, sub-department and unit (the Directory; services/approval_defaults.py, routes under
/governance/approval-defaults). Over HTTP through the whole governance router with real tokens on in-memory SQLite (``_exc_world``):

    Operations (owner OPS) > Support (owner SUP) > Helpdesk (no owner);  Finance (no owner);  Old unit (switched off)

* which default applies: the nearest one up the tree, the organisation's last, a switched-off one skipped, a locked one above stands
  over a lower one (and cannot be changed below), a route against reviewers and approvers;
* sending a document with nobody named copies the default into its sign-off (people or a whole route), says so, and is not redone
  once somebody is named; changing a default later never changes a document already in review;
* ``unit_owner`` / ``parent_owner``: the head of the unit or of the nearest one above it, stored as the owner of one unit;
* a locked default's people have to stay in the sign-off (400 at Send, in words; put back when a document goes to review again);
* the two ways round the engine are closed (a PUT of a status that starts a review, the older workflows/submit);
* an exception starts with its unit's default implementer, and a locked one's people have to stay among the implementers;
* who may read and write, and what is refused in words.
"""
from _exc_world import (ADMIN, APP1, APP2, EX, IMPL1, OPS, OTHER, PLAIN, REQ, REV1, REV2, SETTER, SUP, EXCADMIN, _schema, raise_exception, submit, w)  # noqa: F401

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance import routes

DEF = "/governance/approval-defaults"
OPERATIONS, SUPPORT, HELPDESK, FINANCE, OLD = 10, 11, 12, 13, 14
APPROVERS, IMPLEMENTERS, RISK = 3, 7, 5
STRUCTURE = 20                                           # a role that may change the organisation's structure (manages a unit for now)


# ── helpers ──────────────────────────────────────────────────────────────────
def user(uid):
    return {"type": "user", "id": uid}


def role(rid):
    return {"type": "role", "id": rid}


def set_default(w, unit, subject, people=None, as_user=SETTER, expect=200, **body):
    r = w.as_(as_user).put(f"{DEF}/{unit}/{subject}", json={"people": people or [], **body})
    assert r.status_code == expect, r.text
    return r.json()


def effective(w, unit, subject, as_user=SETTER):
    r = w.as_(as_user).get(DEF, params={"department_id": unit})
    assert r.status_code == 200, r.text
    return r.json()["subjects"][subject]


def new_doc(w, unit, doc_id=21, **kw):
    w.db.add(m.GovernanceDocument(id=doc_id, tenant_id=1, title=f"Draft {doc_id}", doc_type="policy", status="draft", current_version="1.0",
                                  owner_id=REQ, author_id=REQ, department_id=unit, document_code=f"DOC-{doc_id}", **kw))
    w.db.commit()
    return doc_id


def sign(w, doc_id):
    return f"/governance/documents/{doc_id}/signoff"


def send(w, doc_id, as_user=REQ):
    return w.as_(as_user).post(sign(w, doc_id) + "/send-for-review")


def asked(w, doc_id):
    q = w.db.query(m.DocumentObligation).filter_by(document_id=doc_id, status="pending").order_by(m.DocumentObligation.id)
    return sorted((o.kind, o.user_id) for o in q)


def named(w, doc_id):
    got = w.as_(REQ).get(sign(w, doc_id)).json()["participants"]
    return {rt: [(p["target_type"], p["target_id"], p["display"]) for p in got[rt]] for rt in ("reviewer", "approver")}


def stage(kind="approval", people=None, **kw):
    return {"kind": kind, "people": people if people is not None else [{"target_type": "user", "target_id": APP1}], **kw}


def route_of(w, doc_id):
    return [(s["name"], s["kind"], [p["display"] for p in s["people"]]) for s in w.as_(REQ).get(sign(w, doc_id)).json()["route"]["stages"]]


# ── which default applies ────────────────────────────────────────────────────
def test_the_nearest_default_applies_the_organisations_is_the_last_and_a_switched_off_one_is_skipped(w):
    set_default(w, "org", "doc_approval", [user(APP1)])
    set_default(w, OPERATIONS, "doc_approval", [user(APP2)])
    rows = w.db.query(m.ApprovalDefault).count()
    helpdesk = effective(w, HELPDESK, "doc_approval")
    assert helpdesk["own"] is None and helpdesk["effective"]["people"][0]["label"] == "App2"
    assert helpdesk["source"] == {"department_id": OPERATIONS, "name": "Operations", "inherited": True}
    finance = effective(w, FINANCE, "doc_approval")
    assert finance["source"] == {"department_id": None, "name": "The organisation", "inherited": True}
    assert finance["effective"]["people"][0]["label"] == "App1"
    own = effective(w, OPERATIONS, "doc_approval")
    assert own["source"]["inherited"] is False and own["own"]["people"][0]["label"] == "App2"
    org = effective(w, "org", "doc_approval")
    assert org["source"] == {"department_id": None, "name": "The organisation", "inherited": False}
    set_default(w, SUPPORT, "doc_approval", [user(APP1)])                       # a unit's own wins over the one above
    assert effective(w, HELPDESK, "doc_approval")["source"]["name"] == "Support"
    set_default(w, SUPPORT, "doc_approval", [user(APP1)], is_active=False)      # switched off: the one above applies again
    assert effective(w, HELPDESK, "doc_approval")["source"]["name"] == "Operations"
    assert effective(w, SUPPORT, "doc_approval")["own"]["is_active"] is False
    gone = w.as_(SETTER).delete(f"{DEF}/{SUPPORT}/doc_approval")                # back to inherited: the row is deleted
    assert gone.status_code == 200 and gone.json()["own"] is None and gone.json()["source"]["name"] == "Operations"
    assert w.db.query(m.ApprovalDefault).count() == rows                        # (the switched-off row was Support's only one)
    assert effective(w, FINANCE, "doc_review")["effective"] is None             # nothing set for a subject: None, not an error
    reads = w.db.query(m.ApprovalDefault).count()
    for unit in ("org", OPERATIONS, HELPDESK):
        w.as_(SETTER).get(DEF, params={"department_id": unit})
        w.as_(SETTER).get(f"{DEF}/resolve", params={"department_id": unit})
    w.as_(SETTER).get(f"{DEF}/overview")
    assert w.db.query(m.ApprovalDefault).count() == reads                       # a GET never writes


def test_a_locked_default_stands_over_a_lower_one_and_cannot_be_changed_below(w):
    set_default(w, SUPPORT, "doc_approval", [user(APP2)])                       # Support's own, set before the lock
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)], locked=True)
    under = effective(w, HELPDESK, "doc_approval")
    assert under["source"]["name"] == "Operations" and under["locked_above"] is True
    assert effective(w, SUPPORT, "doc_approval")["effective"]["people"][0]["label"] == "App1"      # the lock stands over Support's own
    assert effective(w, OPERATIONS, "doc_approval")["locked_above"] is False
    refused = w.as_(SETTER).put(f"{DEF}/{HELPDESK}/doc_approval", json={"people": [user(APP2)]})
    assert refused.status_code == 409 and refused.json()["detail"] == "Operations has locked the default approvers. Change them there."
    assert w.as_(SETTER).delete(f"{DEF}/{SUPPORT}/doc_approval").status_code == 200       # taking a shadowed one away is allowed
    set_default(w, "org", "doc_approval", [user(APP2)], locked=True)            # a lock higher up beats a lock below it
    assert effective(w, HELPDESK, "doc_approval")["source"]["name"] == "The organisation"
    assert w.as_(SETTER).put(f"{DEF}/{OPERATIONS}/doc_approval", json={"people": [user(APP1)]}).status_code == 409
    set_default(w, "org", "doc_approval", [user(APP2)], locked=False)
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)], locked=False)      # unlocked: a unit may override again
    assert effective(w, HELPDESK, "doc_approval")["locked_above"] is False


def test_a_route_beats_reviewers_and_approvers_at_the_same_unit_and_a_locked_one_beats_a_deeper_one(w):
    set_default(w, OPERATIONS, "doc_route", route=[stage()])
    set_default(w, OPERATIONS, "doc_review", [user(REV1)])
    assert w.as_(SETTER).get(DEF, params={"department_id": HELPDESK}).json()["document"] == "route"     # the same unit: the route supersedes
    set_default(w, SUPPORT, "doc_approval", [user(APP2)])
    assert w.as_(SETTER).get(DEF, params={"department_id": HELPDESK}).json()["document"] == "people"    # a deeper approver is more specific
    assert w.as_(SETTER).get(DEF, params={"department_id": OPERATIONS}).json()["document"] == "route"
    set_default(w, OPERATIONS, "doc_route", route=[stage()], locked=True)
    assert w.as_(SETTER).get(DEF, params={"department_id": HELPDESK}).json()["document"] == "route"     # a locked route stands over it
    resolved = w.as_(REQ).get(f"{DEF}/resolve", params={"department_id": HELPDESK}).json()               # anyone signed in, for forms
    assert resolved["document"] == "route" and resolved["subjects"]["doc_route"]["source"]["name"] == "Operations"
    one = w.as_(REQ).get(f"{DEF}/resolve", params={"department_id": HELPDESK, "subject": "doc_review"}).json()
    assert one["subject"] == "doc_review" and one["effective"]["people"][0]["label"] == "Rev1"


def test_the_overview_says_which_units_define_their_own(w):
    set_default(w, "org", "doc_review", [user(REV1)])
    set_default(w, SUPPORT, "doc_approval", [user(APP1)])
    set_default(w, OPERATIONS, "exc_implementer", [role(IMPLEMENTERS)])
    set_default(w, OPERATIONS, "doc_review", [user(REV1)], is_active=False)     # switched off: not counted
    got = w.as_(PLAIN).get(f"{DEF}/overview").json()                            # booleans only: anyone signed in
    assert got["organisation"] == {"doc_review": True, "doc_approval": False, "doc_route": False, "exc_implementer": False}
    assert got["units"][str(SUPPORT)] == {"doc_review": False, "doc_approval": True, "doc_route": False, "exc_implementer": False}
    assert got["units"][str(OPERATIONS)]["exc_implementer"] is True and got["units"][str(OPERATIONS)]["doc_review"] is False
    assert str(HELPDESK) not in got["units"]


# ── sending a document ───────────────────────────────────────────────────────
def test_sending_a_document_nobody_reviews_copies_the_units_default_and_says_so(w):
    set_default(w, OPERATIONS, "doc_review", [user(REV1), role(RISK)])
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)])
    doc_id = new_doc(w, HELPDESK)                                               # Helpdesk has none of its own: Operations' applies
    before = w.as_(REQ).get(sign(w, doc_id)).json()
    assert before["defaults_applied"] is None and before["defaults_available"]["sources"] == ["Operations"]
    sent = send(w, doc_id)
    assert sent.status_code == 200, sent.text
    body = sent.json()
    assert body["status"] == "pending_review"
    assert body["defaults_applied"]["subject"] == "doc_people" and body["defaults_applied"]["source"]["name"] == "Operations"
    assert body["defaults_applied"]["source"]["inherited"] is True and body["defaults_available"] is None
    got = named(w, doc_id)
    assert got["reviewer"] == [("user", REV1, "Rev1"), ("role", RISK, "Role: Risk committee")] and got["approver"] == [("user", APP1, "App1")]
    assert ("review", REV1) in asked(w, doc_id) and ("review", REV2) in asked(w, doc_id)           # the role's people are asked too
    again = w.as_(REQ).get(sign(w, doc_id)).json()                              # it is still said later
    assert again["defaults_applied"]["sources"] == ["Operations"]
    history = w.db.query(m.DocumentAuditLog).filter_by(document_id=doc_id, action="defaults_applied").all()
    assert len(history) == 1 and history[0].action_details.startswith("Defaults from Operations applied: Review: Rev1")
    set_default(w, OPERATIONS, "doc_review", [user(REV2)])                      # a later change never touches a document already in review
    assert named(w, doc_id)["reviewer"][0] == ("user", REV1, "Rev1")


def test_a_document_that_names_people_is_not_given_defaults_and_none_at_all_is_still_refused(w):
    doc_id = new_doc(w, FINANCE)
    refused = send(w, doc_id)                                                   # no default anywhere, nobody named: as ever
    assert refused.status_code == 400 and refused.json()["detail"] == "Assign at least one reviewer or approver before sending."
    set_default(w, FINANCE, "doc_approval", [user(APP1)])
    w.as_(REQ).put(sign(w, doc_id) + "/participants", json={"reviewers": [{"target_type": "user", "target_id": REV2}]})
    sent = send(w, doc_id)                                                      # somebody is named: the default is not added
    assert sent.status_code == 200 and sent.json()["defaults_applied"] is None
    assert named(w, doc_id) == {"reviewer": [("user", REV2, "Rev2")], "approver": []}
    assert w.db.query(m.DocumentAuditLog).filter_by(document_id=doc_id, action="defaults_applied").count() == 0


def test_a_default_route_becomes_the_documents_own_route(w):
    set_default(w, OPERATIONS, "doc_route", route=[
        stage("review", [{"target_type": "unit_owner"}], name="Owner check"),
        stage("approval", [{"target_type": "user", "target_id": APP1}, {"target_type": "role", "target_id": APPROVERS}], rule="any")])
    doc_id = new_doc(w, SUPPORT)
    body = send(w, doc_id).json()
    assert body["status"] == "pending_review" and body["route"]["custom"] is True
    assert body["defaults_applied"]["subject"] == "doc_route" and body["defaults_applied"]["source"]["name"] == "Operations"
    assert route_of(w, doc_id) == [("Owner check", "review", ["Owner of Support"]), ("Approval", "approval", ["App1", "Role: Approvers"])]
    assert asked(w, doc_id) == [("review", SUP)]                                # the owner of Support, not of Operations
    assert w.db.query(m.DocumentRouteStage).filter_by(document_id=doc_id).count() == 2
    assert w.db.query(m.DocumentSignoffAssignment).filter_by(document_id=doc_id, role_type="prepared_by").count() == 1


def test_the_owner_of_the_unit_is_its_head_else_the_nearest_one_above_and_the_owner_above_is_that_of_the_parent(w):
    set_default(w, "org", "doc_approval", [{"type": "unit_owner"}])
    support, helpdesk = new_doc(w, SUPPORT, 21), new_doc(w, HELPDESK, 22)
    assert send(w, support).status_code == 200 and send(w, helpdesk).status_code == 200
    assert asked(w, support) == [("approval", SUP)] and asked(w, helpdesk) == [("approval", SUP)]    # Helpdesk has no owner: Support's
    assert named(w, helpdesk)["approver"] == [("unit_owner", HELPDESK, "Owner of Helpdesk")]
    set_default(w, "org", "doc_approval", [{"type": "parent_owner"}])
    support2, ops = new_doc(w, SUPPORT, 23), new_doc(w, OPERATIONS, 24)
    assert send(w, support2).status_code == 200
    assert asked(w, support2) == [("approval", OPS)]                            # the unit above Support is Operations
    assert named(w, support2)["approver"] == [("unit_owner", OPERATIONS, "Owner of Operations")]
    top = send(w, ops)                                                          # a top-level unit has nothing above it: nobody can sign, said in words
    assert top.status_code == 200 and "Nobody in Owner of the unit (none) can sign it" in top.json()["notice"]
    assert top.json()["status"] == "draft"
    set_default(w, "org", "doc_approval", [{"type": "unit_owner"}])
    finance = send(w, new_doc(w, FINANCE, 25))                                  # no owner anywhere up the tree
    assert finance.json()["status"] == "draft" and "Nobody in Owner of Finance can sign it" in finance.json()["notice"]


def test_the_two_owners_are_offered_with_the_people_they_are_today(w):
    got = w.as_(REQ).get("/governance/documents/signoff/targets", params={"department_id": HELPDESK}).json()
    assert got["owners"] == [{"type": "unit_owner", "name": "Owner of the unit", "person": "Sup"},
                             {"type": "parent_owner", "name": "Owner of the unit above", "person": "Sup"}]
    deeper = w.as_(REQ).get("/governance/documents/signoff/targets", params={"department_id": SUPPORT}).json()["owners"]
    assert [o["person"] for o in deeper] == ["Sup", "Ops"]
    assert [o["person"] for o in w.as_(REQ).get("/governance/documents/signoff/targets").json()["owners"]] == [None, None]
    assert "users" in got and "roles" in got and "teams" in got                 # what it always held is still there


def test_a_document_route_of_its_own_may_name_the_owners_too(w):
    doc_id = new_doc(w, SUPPORT)
    r = w.as_(REQ).put(sign(w, doc_id) + "/route", json={"stages": [{"kind": "approval", "people": [{"target_type": "parent_owner"}]}]})
    assert r.status_code == 200, r.text
    assert route_of(w, doc_id) == [("Approval", "approval", ["Owner of Operations"])]
    assert routes.validate([{"kind": "approval", "people": [{"target_type": "parent_owner"}, {"target_type": "parent_owner"}]}])[0]["people"] \
        == [("parent_owner", 0)]
    mixed = routes.validate([{"kind": "review", "people": [{"target_type": "unit_owner"}, {"target_type": "user", "target_id": 4}]}])
    assert mixed[0]["people"] == [("unit_owner", 0), ("user", 4)]


# ── a locked default ─────────────────────────────────────────────────────────
def test_a_locked_default_has_to_stay_among_the_participants_at_send(w):
    set_default(w, "org", "doc_approval", [user(APP1)], locked=True)
    doc_id = new_doc(w, FINANCE)
    w.as_(REQ).put(sign(w, doc_id) + "/participants", json={"approvers": [{"target_type": "user", "target_id": APP2}]})
    refused = send(w, doc_id)
    assert refused.status_code == 400
    assert refused.json()["detail"] == ("The organisation requires App1 to stay among the approvers of its documents. Add them, then send it again.")
    assert w.db.get(m.GovernanceDocument, doc_id).status == "draft"
    w.as_(REQ).put(sign(w, doc_id) + "/participants",
                   json={"approvers": [{"target_type": "user", "target_id": APP2}, {"target_type": "user", "target_id": APP1}]})
    assert send(w, doc_id).status_code == 200                                   # one more is fine: the lock asks for those, not for only those
    set_default(w, "org", "doc_approval", [user(APP1)], locked=False)           # unlocked: the author may name whoever they like
    other = new_doc(w, FINANCE, 22)
    w.as_(REQ).put(sign(w, other) + "/participants", json={"approvers": [{"target_type": "user", "target_id": APP2}]})
    assert send(w, other).status_code == 200


def test_a_locked_route_asks_each_stage_s_people_to_stay_and_they_are_put_back_when_it_goes_to_review_again(w):
    doc_id = new_doc(w, FINANCE)
    w.as_(REQ).put(sign(w, doc_id) + "/participants",
                   json={"reviewers": [{"target_type": "user", "target_id": REV1}], "approvers": [{"target_type": "user", "target_id": APP2}]})
    assert send(w, doc_id).status_code == 200                                   # in review with the people it chose; no default yet
    set_default(w, FINANCE, "doc_review", [user(REV2)], locked=True)            # a lock arrives afterwards
    doc = w.db.get(m.GovernanceDocument, doc_id)
    life.start_round(w.db, doc, REQ)                                            # it goes to review again (a changed text, a major resubmit...)
    w.db.commit()
    assert named(w, doc_id)["reviewer"] == [("user", REV1, "Rev1"), ("user", REV2, "Rev2")]
    note = w.db.query(m.DocumentAuditLog).filter_by(document_id=doc_id, action="defaults_applied").one()
    assert note.action_details == "Added back as Finance requires: Rev2"
    route_doc = new_doc(w, SUPPORT, 23)                                         # a locked route: its people must stay in the sign-off
    set_default(w, SUPPORT, "doc_route", route=[stage("review", [{"target_type": "user", "target_id": REV1}]), stage()], locked=True)
    w.as_(REQ).put(sign(w, route_doc) + "/participants", json={"reviewers": [{"target_type": "user", "target_id": REV2}]})
    refused = send(w, route_doc)                                                # (no route of its own: the people it has are checked)
    assert refused.status_code == 400 and "Support requires Rev1 to stay among the reviewers" in refused.json()["detail"]
    assert "App1 to stay among the approvers" in refused.json()["detail"]


def test_a_document_whose_defaults_were_changed_by_hand_is_no_longer_said_to_have_them(w):
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)])
    doc_id = new_doc(w, SUPPORT)
    assert send(w, doc_id).json()["defaults_applied"]["source"]["name"] == "Operations"
    assert w.as_(REQ).post(sign(w, doc_id) + "/withdraw", json={"reason": "wrong"}).status_code == 200
    w.as_(REQ).put(sign(w, doc_id) + "/participants", json={"approvers": [{"target_type": "user", "target_id": APP2}]})
    assert w.as_(REQ).get(sign(w, doc_id)).json()["defaults_applied"] is None


# ── the two ways round the engine ────────────────────────────────────────────
def test_a_status_put_cannot_start_a_review_and_the_older_submit_uses_the_same_engine(w):
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)], locked=True)
    doc_id = new_doc(w, SUPPORT)
    for status in ("pending_review", "pending_approval"):
        r = w.as_(REQ).put(f"/governance/documents/{doc_id}", json={"status": status})
        assert r.status_code == 400 and r.json()["detail"].startswith("A document goes to review and approval with Send for review"), r.text
    assert w.db.get(m.GovernanceDocument, doc_id).status == "draft"
    assert w.as_(REQ).put(f"/governance/documents/{doc_id}", json={"status": "draft", "title": "Same status is fine"}).status_code == 200
    w.as_(REQ).put(sign(w, doc_id) + "/participants", json={"approvers": [{"target_type": "user", "target_id": REQ}]})      # naming themselves
    older = w.as_(REQ).post("/governance/workflows/submit", json={"document_id": doc_id})
    assert older.status_code == 400 and "Operations requires App1 to stay among the approvers" in older.json()["detail"]   # the lock holds here too
    assert w.db.query(m.DocumentApprovalStep).count() == 0 and w.db.get(m.GovernanceDocument, doc_id).status == "draft"
    w.as_(REQ).put(sign(w, doc_id) + "/participants", json={"approvers": []})
    ok = w.as_(REQ).post("/governance/workflows/submit", json={"document_id": doc_id})
    assert ok.status_code == 200, ok.text
    assert ok.json()["message"] == "Document submitted for approval" and ok.json()["steps_created"] == 1
    assert ok.json()["defaults_applied"]["source"]["name"] == "Operations"
    assert w.db.query(m.DocumentApprovalStep).count() == 0                      # no step the submitter could approve themselves
    assert asked(w, doc_id) == [("approval", APP1)]
    again = w.as_(REQ).post("/governance/workflows/submit", json={"document_id": doc_id})
    assert again.status_code == 400 and again.json()["detail"] == "Document already has pending approval steps"


def test_a_status_set_by_hand_to_review_still_gets_the_default(w):
    set_default(w, OPERATIONS, "doc_approval", [user(APP1)])
    doc_id = new_doc(w, SUPPORT)
    r = w.as_(REQ).put(f"/governance/documents/{doc_id}/status", json={"status": "pending_review"})
    assert r.status_code == 200, r.text
    assert w.db.get(m.GovernanceDocument, doc_id).status == "pending_approval"      # there are no reviewers: it goes to the approvers
    assert asked(w, doc_id) == [("approval", APP1)]


# ── exceptions ───────────────────────────────────────────────────────────────
def test_an_exception_starts_with_its_units_implementer_and_its_author_may_change_it(w):
    set_default(w, OPERATIONS, "exc_implementer", [role(IMPLEMENTERS), {"type": "unit_owner"}])
    made = raise_exception(w, document_id=1)                                    # document 1 is in Support: Operations' default applies
    assert [(p["type"], p["label"]) for p in made["implementer"]["people"]] == [("role", "Implementers"), ("unit_owner", "Owner of the unit")]
    mine = raise_exception(w, document_id=1, implementer={"people": [user(IMPL1)]})
    assert [p["label"] for p in mine["implementer"]["people"]] == ["Impl1"]     # what the author chose is kept
    assert raise_exception(w, document_id=2)["implementer"] is None             # Finance has no default
    cleared = w.as_(REQ).put(f"{EX}/{made['id']}", json={"implementer": None})
    assert cleared.status_code == 200 and cleared.json()["implementer"] is None  # the author may clear it...
    assert submit(w, made["id"]).status_code == 200
    got = w.as_(EXCADMIN).get(f"{EX}/{made['id']}").json()
    assert [p["type"] for p in got["implementer"]["people"]] == ["role", "unit_owner"]     # ...and submitting fills it in again


def test_a_locked_implementer_has_to_stay_among_those_chosen_at_submit(w):
    set_default(w, OPERATIONS, "exc_implementer", [role(IMPLEMENTERS)], locked=True)
    eid = raise_exception(w, document_id=1, implementer={"people": [user(IMPL1)]})["id"]
    refused = submit(w, eid)
    assert refused.status_code == 400
    assert refused.json()["detail"] == "Operations requires Implementers among those who carry out its exceptions. Add them, then submit again."
    assert w.db.get(m.PolicyException, eid).status == "draft"
    fixed = w.as_(REQ).put(f"{EX}/{eid}", json={"implementer": {"people": [user(IMPL1), role(IMPLEMENTERS)]}})
    assert fixed.status_code == 200
    assert submit(w, eid).status_code == 200


def test_an_implementer_default_cannot_name_a_department_and_a_default_that_cannot_work_is_told_at_submit(w):
    w.db.add(m.Team(id=1, tenant_id=1, name="Support", department_id=SUPPORT, is_active=True))
    w.db.commit()
    r = w.as_(SETTER).put(f"{DEF}/{OPERATIONS}/exc_implementer", json={"people": [{"type": "team", "id": 1}]})
    assert r.status_code == 400 and r.json()["detail"] == "Someone who carries out an exception is a person, a role or an owner, not a department."
    set_default(w, FINANCE, "exc_implementer", [{"type": "unit_owner"}])        # Finance has no owner: nobody could carry it out
    eid = raise_exception(w, document_id=2)["id"]
    refused = submit(w, eid)
    assert refused.status_code == 409 and "has nobody who can act" in refused.json()["detail"]


# ── who may do what, and what is refused ─────────────────────────────────────
def test_reading_needs_a_governance_right_writing_the_settings_right_or_managing_the_unit(w):
    w.db.add(m.Role(id=STRUCTURE, tenant_id=1, name="Structure"))
    w.db.add(m.Permission(id=99, name="admin:organization:edit", resource="admin:organization", action="edit"))
    w.db.add(m.RolePermission(role_id=STRUCTURE, permission_id=99))
    w.db.add(m.UserRole(user_id=OTHER, role_id=STRUCTURE, tenant_id=1, source=None))
    w.db.commit()
    assert w.as_(PLAIN).get(DEF, params={"department_id": SUPPORT}).status_code == 403
    assert w.as_(PLAIN).put(f"{DEF}/{SUPPORT}/doc_review", json={"people": [user(REV1)]}).status_code == 403
    assert w.as_(REQ).put(f"{DEF}/{SUPPORT}/doc_review", json={"people": [user(REV1)]}).status_code == 403      # no right to change them
    assert w.as_(PLAIN).delete(f"{DEF}/{SUPPORT}/doc_review").status_code == 403
    assert w.as_(EXCADMIN).get(DEF, params={"department_id": SUPPORT}).json()["can_edit"] is False             # a governance right reads
    assert w.as_(ADMIN).get(DEF, params={"department_id": "org"}).json()["can_edit"] is True
    assert w.as_(OTHER).get(DEF, params={"department_id": SUPPORT}).json()["can_edit"] is True                  # manages the unit
    assert w.as_(OTHER).put(f"{DEF}/{SUPPORT}/doc_review", json={"people": [user(REV1)]}).status_code == 200
    org = w.as_(OTHER).put(f"{DEF}/org/doc_review", json={"people": [user(REV1)]})                              # the organisation's: settings right only
    assert org.status_code == 403 and org.json()["detail"].startswith("Only an administrator or someone allowed to change governance settings")
    assert w.as_(SETTER).put(f"{DEF}/org/doc_review", json={"people": [user(REV1)]}).status_code == 200
    assert w.as_(ADMIN).delete(f"{DEF}/org/doc_review").status_code == 200


def test_what_cannot_be_saved_is_refused_in_words_and_nothing_changes(w):
    def refused(unit, subject, expect=400, **body):
        r = w.as_(SETTER).put(f"{DEF}/{unit}/{subject}", json=body)
        assert r.status_code == expect, r.text
        return r.json()["detail"]

    assert refused(SUPPORT, "doc_review", people=[]) == "Choose at least one reviewer."
    assert refused(SUPPORT, "doc_approval", people=[]) == "Choose at least one approver."
    assert refused(SUPPORT, "exc_implementer", people=[]) == "Choose who carries the exception out."
    assert refused(SUPPORT, "doc_route", route=[]) == "A route needs at least one stage."
    assert refused(SUPPORT, "doc_review", people=[{"type": "group", "id": 1}]) == "Choose a person, a role, a department or an owner."
    assert refused(SUPPORT, "doc_review", people=[{"type": "user"}]) == "Choose who is asked."
    assert refused(SUPPORT, "doc_review", people=[user(999)]) == "A person chosen does not exist."
    assert refused(SUPPORT, "doc_review", people=[role(9)]) == "A role chosen does not exist."                      # another organisation's role
    assert refused(SUPPORT, "doc_review", people=[{"type": "team", "id": 77}]) == "A department chosen does not exist."
    assert refused(SUPPORT, "doc_route", route=[stage(people=[])]) == "Stage 1 (Approval): choose who is asked."
    assert refused(SUPPORT, "doc_route", route=[stage("information", [{"target_type": "user", "target_id": APP1}])]) \
        == "A route needs at least one stage where someone reviews or approves."
    assert refused(99, "doc_review", expect=404, people=[user(REV1)]) == "Department not found."
    assert refused(90, "doc_review", expect=404, people=[user(REV1)]) == "Department not found."                      # another organisation's unit
    assert refused("x", "doc_review", expect=404, people=[user(REV1)]) == "Department not found."
    assert refused(SUPPORT, "doc_other", expect=404, people=[user(REV1)]) == "Choose what the default is for."
    assert w.as_(SETTER).get(DEF, params={"department_id": 99}).status_code == 404
    assert w.as_(SETTER).delete(f"{DEF}/99/doc_review").status_code == 404
    assert w.db.query(m.ApprovalDefault).count() == 0
    ok = set_default(w, SUPPORT, "doc_review", [user(REV1), user(REV1), role(RISK)])                              # a repeat counts once
    assert [p["label"] for p in ok["own"]["people"]] == ["Rev1", "Risk committee"]
    saved = set_default(w, SUPPORT, "doc_route", route=[stage("review", [{"target_type": "parent_owner"}, {"target_type": "user", "target_id": REV1}]),
                                                         stage()])
    assert [(s["name"], [p["label"] for p in s["people"]]) for s in saved["own"]["route"]] \
        == [("Review", ["Owner of the unit above", "Rev1"]), ("Approval", ["App1"])]
    assert saved["own"]["people"] == []
    twice = set_default(w, SUPPORT, "doc_review", [user(REV2)])                                                    # one row per unit and subject
    assert twice["own"]["people"][0]["label"] == "Rev2" and w.db.query(m.ApprovalDefault).filter_by(department_id=SUPPORT).count() == 2
    set_default(w, "org", "doc_review", [user(REV1)])
    set_default(w, "org", "doc_review", [user(REV2)])
    assert w.db.query(m.ApprovalDefault).filter_by(department_id=None).count() == 1                                # (the organisation's too)


def test_a_person_who_left_is_shown_without_an_id_and_the_default_is_not_lost(w):
    set_default(w, OPERATIONS, "doc_review", [user(REV1), role(RISK)])
    w.db.query(m.UserRole).filter(m.UserRole.user_id == REV1).delete()
    w.db.query(m.UserRole).filter(m.UserRole.role_id == RISK).delete()
    w.db.query(m.GRCUser).filter_by(id=REV1).delete()
    w.db.query(m.Role).filter_by(id=RISK).delete()
    w.db.commit()
    shown = effective(w, OPERATIONS, "doc_review")["own"]["people"]
    assert [(p["label"], p["gone"]) for p in shown] == [("Someone who left", True), ("A role that was removed", True)]
