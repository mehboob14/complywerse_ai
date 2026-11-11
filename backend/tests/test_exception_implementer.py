"""The implementer of an exception (DECISIONS D62, D67): who carries an approved exception out is chosen by the person raising it, exception by
exception (it differs by type, document and area), not by the approval rule. Over HTTP through the whole governance router with real tokens
on in-memory SQLite (``_exc_world``).

* choosing it: part of the exception, optional, checked and refused in words, shown with names; the rules no longer carry one;
* the flow: asked only once the LAST approval is given, whether a rule or the older flow approves it; any one of the people can act; the unit's
  owner is read when it opens (and kept); the requester is told; an exception with none ends at the approval exactly as before; one whose
  implementer cannot act is not submitted;
* the exception's own status never changes (approved stays approved); "Waiting for me" lists what is to be implemented; a revoked
  exception has nothing left to implement; a rejected one never had.
"""
from _exc_world import (APP1, EX, EXCADMIN, IMPL1, IMPL2, PLAIN, REQ, REV1, RULES, SEEN, SETTER, SUP, _schema, approved, choose_implementer,  # noqa: F401
                        decide, get, implementer, implementing, make_rule, raise_exception, record, step, submit, w)

import grc.models as m  # noqa: E402


# ── choosing it ──────────────────────────────────────────────────────────────
def test_an_exception_keeps_the_implementer_its_requester_chose_and_none_means_none(w):
    made = raise_exception(w, implementer=implementer([{"type": "user", "id": IMPL1}, {"type": "role", "id": 7}], due_days=5))
    imp = made["implementer"]
    assert imp["due_days"] == 5
    assert [(p["type"], p["id"], p["label"]) for p in imp["people"]] == [("user", IMPL1, "Impl1"), ("role", 7, "Implementers")]
    assert get(w, made["id"], PLAIN)["implementer"]["people"][0]["label"] == "Impl1"             # anyone signed in reads it, as they read the exception
    assert raise_exception(w)["implementer"] is None
    assert raise_exception(w, implementer={})["implementer"] is None                              # an empty block is no implementer
    again = w.as_(REQ).put(f"{EX}/{made['id']}", json={"title": "Skip backups, again"})           # a change that does not mention it keeps it
    assert again.json()["implementer"]["due_days"] == 5
    cleared = w.as_(REQ).put(f"{EX}/{made['id']}", json={"implementer": None})
    assert cleared.status_code == 200 and cleared.json()["implementer"] is None
    assert {e["id"]: e["implementer"] for e in w.as_(REQ).get(EX).json()}[made["id"]] is None


def test_an_implementer_is_checked_and_refused_in_words(w):
    def refused(**imp):
        r = w.as_(REQ).post(EX, json={"title": "Skip backups", "justification": "Legacy box", "implementer": imp})
        assert r.status_code == 400, r.text
        return r.json()["detail"]

    assert refused(people=[{"type": "user"}]) == "Implementer (Implementation): choose who is asked."
    assert refused(people=[{"type": "group"}]) == "Implementer (Implementation): choose a person, a role or an owner to ask."
    assert refused(name="Rollout", due_days=3) == "Implementer (Rollout): choose who carries it out."
    ok = {"people": [{"type": "user", "id": IMPL1}]}
    assert refused(**ok, due_days=0) == "Implementer (Implementation): the days to implement must be from 1 to 365."
    assert refused(**ok, due_days=366) == "Implementer (Implementation): the days to implement must be from 1 to 365."
    assert refused(people=[{"type": "user", "id": 999}]) == "A person chosen does not exist."
    assert refused(people=[{"type": "role", "id": 9}]) == "A role chosen does not exist."                      # another organisation's role
    assert w.db.query(m.PolicyException).count() == 0
    bad = w.as_(REQ).put(f"{EX}/{raise_exception(w)['id']}", json={"implementer": {"people": [{"type": "user", "id": 999}]}})
    assert bad.status_code == 400 and bad.json()["detail"] == "A person chosen does not exist."


def test_a_rule_no_longer_carries_an_implementer(w):
    rule = make_rule(w, implementer=implementer())                                                  # an old client may still send one: it is ignored
    assert "implementer" not in rule and "implementer" not in w.as_(SETTER).get(RULES).json()["rules"][0]
    assert "implementer" not in w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 11}).json()
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200 and decide(w, eid, APP1).status_code == 200
    assert get(w, eid)["implementation"] is None                                                   # nothing asked: the exception named nobody


def test_the_people_and_roles_to_choose_from_are_for_whoever_may_raise_exceptions(w):
    got = w.as_(REQ).get(f"{EX}/implementer-options")
    assert got.status_code == 200, got.text
    body = got.json()
    assert IMPL1 in [u["id"] for u in body["users"]] and "Implementers" in [r["name"] for r in body["roles"]]
    assert w.as_(PLAIN).get(f"{EX}/implementer-options").status_code == 403                         # no right to raise or edit exceptions


# ── the flow ─────────────────────────────────────────────────────────────────
def test_after_the_last_approval_the_implementer_is_asked_and_the_requester_told(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    eid = raise_exception(w, implementer=implementer([{"type": "role", "id": 7}], due_days=3))["id"]
    assert submit(w, eid).status_code == 200
    assert get(w, eid)["implementation"] is None
    assert decide(w, eid, REV1).status_code == 200
    assert get(w, eid)["implementation"] is None                                    # a review is not the last approval: nothing to implement yet
    SEEN.clear()
    assert decide(w, eid, APP1).status_code == 200
    e = get(w, eid)
    assert e["status"] == "approved"                                                # approved stays approved
    impl = e["implementation"]
    assert (impl["state"], impl["name"], impl["stalled"], impl["overdue"]) == ("waiting", "Implementation", False, False)
    assert sorted(p["id"] for p in impl["asked"]) == [IMPL1, IMPL2] and impl["due_at"]
    assert (impl["controls_count"], impl["risks_count"], impl["uncovered_count"]) == (0, 0, 0)
    assert ([IMPL1, IMPL2], "Exception to implement: Skip backups") in SEEN
    assert ([REQ], "Exception approved: Skip backups") in SEEN
    assert get(w, eid, IMPL2)["implementation"]["my_turn"] is True                  # any one of the people can act
    assert get(w, eid, REQ)["implementation"]["my_turn"] is False


def test_two_exceptions_under_one_rule_can_have_different_implementers(w):
    make_rule(w)
    first = raise_exception(w, implementer=implementer([{"type": "user", "id": IMPL1}]))["id"]
    second = raise_exception(w, implementer=implementer([{"type": "user", "id": IMPL2}]))["id"]
    for eid in (first, second):
        assert submit(w, eid).status_code == 200 and decide(w, eid, APP1).status_code == 200
    assert [p["id"] for p in get(w, first)["implementation"]["asked"]] == [IMPL1]
    assert [p["id"] for p in get(w, second)["implementation"]["asked"]] == [IMPL2]
    assert [e["id"] for e in w.as_(IMPL2).get(f"{EX}/waiting-for-me").json()] == [second]


def test_the_implementer_may_be_changed_while_the_exception_waits_and_is_read_at_the_last_approval(w):
    make_rule(w)
    eid = raise_exception(w, implementer=implementer([{"type": "user", "id": IMPL1}]))["id"]
    assert submit(w, eid).status_code == 200
    choose_implementer(w, eid, implementer([{"type": "user", "id": IMPL2}]))
    assert decide(w, eid, APP1).status_code == 200
    assert [p["id"] for p in get(w, eid)["implementation"]["asked"]] == [IMPL2]


def test_without_an_implementer_the_approval_ends_as_before(w):
    eid = approved(w)
    e = get(w, eid)
    assert e["status"] == "approved" and e["implementation"] is None
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    assert not [s for _, s in SEEN if s.startswith("Exception to implement")]
    assert ([REQ], "Exception approved: Skip backups") in SEEN
    assert w.as_(IMPL1).post(f"{EX}/{eid}/controls", json={"title": "x"}).status_code == 403


def test_an_exception_no_rule_matches_still_gets_the_implementer_its_requester_chose(w):
    eid = raise_exception(w, implementer=implementer())["id"]                       # no rule at all: the older flow, anyone allowed to approve decides
    assert submit(w, eid).status_code == 200
    risk = record(w, eid, APP1)                                                     # what the approver found, before there is any run
    SEEN.clear()
    assert w.as_(APP1).post(f"{EX}/{eid}/approve", json={}).status_code == 200
    e = get(w, eid)
    assert e["status"] == "approved" and e["approval"] is None                      # the older flow shows no rule and no steps, as before
    assert w.as_(EXCADMIN).get(f"{EX}/{eid}/approval").json()["rounds"] == []
    assert (e["implementation"]["state"], [p["id"] for p in e["implementation"]["asked"]], e["implementation"]["risks_count"]) == ("waiting", [IMPL1], 1)
    assert ([IMPL1], "Exception to implement: Skip backups") in SEEN
    assert [r["id"] for r in w.as_(IMPL1).get(f"{EX}/{eid}/risks").json()["risks"]] == [risk["id"]]
    assert w.as_(IMPL1).post(f"{EX}/{eid}/controls", json={"title": "Monitor the box", "risk_ids": [risk["id"]]}).status_code == 201
    assert w.as_(IMPL1).post(f"{EX}/{eid}/implementation/complete", json={}).status_code == 200
    assert get(w, eid)["implementation"]["state"] == "done"
    assert [e["id"] for e in w.as_(IMPL1).get(f"{EX}/waiting-for-me").json()] == []


def test_an_implementer_with_nobody_who_can_act_stops_the_submission(w):
    make_rule(w)
    eid = raise_exception(w, document_id=2, implementer=implementer([{"type": "unit_owner"}]))["id"]      # Finance has no owner
    r = submit(w, eid)
    detail = r.json()["detail"]
    assert r.status_code == 409 and "The implementer (Implementation) has nobody who can act" in detail and "Finance" in detail
    assert get(w, eid)["status"] == "draft" and w.db.query(m.ExceptionApprovalRun).count() == 0
    fixed = choose_implementer(w, eid, implementer([{"type": "user", "id": IMPL1}]))                    # choose someone else and it goes
    assert fixed["implementer"]["people"][0]["id"] == IMPL1 and submit(w, eid).status_code == 200


def test_the_owner_of_the_unit_is_read_when_the_implementation_opens_and_kept_after(w):
    eid, _ = implementing(w, impl=implementer([{"type": "unit_owner"}]))              # document 1 is in Support, owned by SUP
    assert [p["id"] for p in get(w, eid)["implementation"]["asked"]] == [SUP]
    w.db.get(m.GRCDepartment, 11).department_head_user_id = IMPL2
    w.db.commit()
    assert [p["id"] for p in get(w, eid)["implementation"]["asked"]] == [SUP]       # who was asked stays who was asked


def test_the_requester_may_be_the_implementer(w):
    eid, _ = implementing(w, impl=implementer([{"type": "user", "id": REQ}]))         # in a small organisation the owner is its own coordinator
    assert [p["id"] for p in get(w, eid)["implementation"]["asked"]] == [REQ]
    assert w.as_(REQ).post(f"{EX}/{eid}/controls", json={"title": "Monitor the box"}).status_code == 201


def test_the_people_asked_to_implement_see_how_it_was_approved_and_nobody_else_without_a_right_does(w):
    eid, _ = implementing(w)                                                        # IMPL1 is asked; IMPL2 and PLAIN are not and hold no exception right
    seen = get(w, eid, IMPL1)
    assert seen["approval"] is not None and [d["decision"] for d in seen["approval"]["decisions"]] == ["approve"]
    assert w.as_(IMPL1).get(f"{EX}/{eid}/approval").status_code == 200
    for who in (IMPL2, PLAIN):
        assert get(w, eid, who)["approval"] is None, who
        assert w.as_(who).get(f"{EX}/{eid}/approval").status_code == 403, who


def test_waiting_for_me_lists_what_is_to_be_implemented_after_what_waits_for_a_decision(w):
    make_rule(w)
    eid = raise_exception(w, implementer=implementer())["id"]
    assert submit(w, eid).status_code == 200
    assert [(e["id"], e["waiting_kind"]) for e in w.as_(APP1).get(f"{EX}/waiting-for-me").json()] == [(eid, "decision")]
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    assert decide(w, eid, APP1).status_code == 200
    assert w.as_(APP1).get(f"{EX}/waiting-for-me").json() == []
    todo = w.as_(IMPL1).get(f"{EX}/waiting-for-me").json()
    assert [(e["id"], e["waiting_kind"]) for e in todo] == [(eid, "implementation")] and todo[0]["implementation"]["my_turn"] is True
    assert w.as_(IMPL2).get(f"{EX}/waiting-for-me").json() == []                    # not asked: the exception named IMPL1 alone


def test_revoking_an_exception_cancels_what_was_still_to_implement(w):
    eid, _ = implementing(w)
    r = w.as_(EXCADMIN).post(f"{EX}/{eid}/revoke", json={"reason": "No longer needed"})
    assert r.status_code == 200, r.text
    assert get(w, eid)["implementation"]["state"] == "cancelled"
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    late = w.as_(IMPL1).post(f"{EX}/{eid}/controls", json={"title": "Late"})
    assert late.status_code == 409 and late.json()["detail"] == "The implementation is finished: its compensating controls are kept as they were."


def test_a_rejected_exception_is_never_implemented(w):
    make_rule(w)
    eid = raise_exception(w, implementer=implementer())["id"]
    assert submit(w, eid).status_code == 200
    assert decide(w, eid, APP1, "reject", rejection_reason="Patch first").status_code == 200
    e = get(w, eid)
    assert e["status"] == "rejected" and e["implementation"] is None
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
