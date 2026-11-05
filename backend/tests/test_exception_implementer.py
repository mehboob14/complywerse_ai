"""The implementer of an exception approval rule (DECISIONS D62): who carries an approved exception out. Over HTTP through the whole
governance router with real tokens on in-memory SQLite (``_exc_world``).

* writing it: part of a rule, optional, checked and refused in words, shown with names, tested in the rule tester;
* the flow: asked only once the LAST approval is given; any one of the people can act; the unit's owner is read when it opens (and kept);
  the requester is told; a rule without one ends at the approval exactly as before; a rule that cannot reach anybody cannot start;
* the exception's own status never changes (approved stays approved); "Waiting for me" lists what is to be implemented; a revoked
  exception has nothing left to implement; a rejected one never had.
"""
from _exc_world import (APP1, EX, EXCADMIN, IMPL1, IMPL2, PLAIN, REQ, REV1, RULES, SEEN, SETTER, SUP, _schema, approved, decide, get,  # noqa: F401
                        implementer, implementing, make_rule, raise_exception, step, submit, w)

import grc.models as m  # noqa: E402


# ── writing it ───────────────────────────────────────────────────────────────
def test_a_rule_keeps_its_implementer_and_no_implementer_means_none(w):
    rule = make_rule(w, implementer=implementer([{"type": "user", "id": IMPL1}, {"type": "role", "id": 7}], name="Rollout", due_days=5))
    imp = rule["implementer"]
    assert (imp["name"], imp["due_days"]) == ("Rollout", 5)
    assert [(p["type"], p["id"], p["label"]) for p in imp["people"]] == [("user", IMPL1, "Impl1"), ("role", 7, "Implementers")]
    assert w.as_(SETTER).get(RULES).json()["rules"][0]["implementer"]["people"][0]["label"] == "Impl1"
    assert make_rule(w, name="Plain", priorities=["low"])["implementer"] is None
    assert make_rule(w, name="Empty", priorities=["high"], implementer={})["implementer"] is None          # an empty block is no implementer
    r = w.as_(SETTER).put(f"{RULES}/{rule['id']}", json={"name": "Rule", "steps": [step()]})                 # the whole rule is sent again: none this time
    assert r.status_code == 200 and r.json()["implementer"] is None


def test_an_implementer_is_checked_and_refused_in_words(w):
    def refused(**imp):
        r = w.as_(SETTER).post(RULES, json={"name": "R", "steps": [step()], "implementer": imp})
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
    assert w.db.query(m.ExceptionApprovalRule).count() == 0


def test_the_tester_shows_who_the_implementer_would_be_and_what_would_stop_it(w):
    make_rule(w, implementer=implementer([{"type": "unit_owner"}], due_days=4))
    ok = w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 11}).json()
    assert ok["implementer"]["due_days"] == 4 and ok["problems"] == []
    assert [s["members"] for s in ok["implementer"]["slots"]] == [[SUP]]
    stuck = w.as_(SETTER).post(f"{RULES}/preview", json={"department_id": 13}).json()                          # Finance has no owner
    assert any("The implementer (Implementation) has nobody who can act" in p and "for Finance" in p for p in stuck["problems"])


# ── the flow ─────────────────────────────────────────────────────────────────
def test_after_the_last_approval_the_implementer_is_asked_and_the_requester_told(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])],
              implementer=implementer([{"type": "role", "id": 7}], name="Rollout", due_days=3))
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    assert get(w, eid)["implementation"] is None
    assert decide(w, eid, REV1).status_code == 200
    assert get(w, eid)["implementation"] is None                                    # a review is not the last approval: nothing to implement yet
    SEEN.clear()
    assert decide(w, eid, APP1).status_code == 200
    e = get(w, eid)
    assert e["status"] == "approved"                                                # approved stays approved
    impl = e["implementation"]
    assert (impl["state"], impl["name"], impl["stalled"], impl["overdue"]) == ("waiting", "Rollout", False, False)
    assert sorted(p["id"] for p in impl["asked"]) == [IMPL1, IMPL2] and impl["due_at"]
    assert (impl["controls_count"], impl["risks_count"], impl["uncovered_count"]) == (0, 0, 0)
    assert ([IMPL1, IMPL2], "Exception to implement: Skip backups") in SEEN
    assert ([REQ], "Exception approved: Skip backups") in SEEN
    assert get(w, eid, IMPL2)["implementation"]["my_turn"] is True                  # any one of the people can act
    assert get(w, eid, REQ)["implementation"]["my_turn"] is False


def test_without_an_implementer_the_approval_ends_as_before(w):
    eid = approved(w)
    e = get(w, eid)
    assert e["status"] == "approved" and e["implementation"] is None
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    assert not [s for _, s in SEEN if s.startswith("Exception to implement")]
    assert ([REQ], "Exception approved: Skip backups") in SEEN
    assert w.as_(IMPL1).post(f"{EX}/{eid}/controls", json={"title": "x"}).status_code == 403


def test_a_rule_whose_implementer_has_nobody_cannot_start(w):
    make_rule(w, implementer=implementer([{"type": "unit_owner"}]))
    eid = raise_exception(w, document_id=2)["id"]                                   # Finance has no owner
    r = submit(w, eid)
    detail = r.json()["detail"]
    assert r.status_code == 409 and "The implementer (Implementation) has nobody who can act" in detail and "Finance" in detail
    assert get(w, eid)["status"] == "draft" and w.db.query(m.ExceptionApprovalRun).count() == 0


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
    make_rule(w, implementer=implementer())
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    assert [(e["id"], e["waiting_kind"]) for e in w.as_(APP1).get(f"{EX}/waiting-for-me").json()] == [(eid, "decision")]
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    assert decide(w, eid, APP1).status_code == 200
    assert w.as_(APP1).get(f"{EX}/waiting-for-me").json() == []
    todo = w.as_(IMPL1).get(f"{EX}/waiting-for-me").json()
    assert [(e["id"], e["waiting_kind"]) for e in todo] == [(eid, "implementation")] and todo[0]["implementation"]["my_turn"] is True
    assert w.as_(IMPL2).get(f"{EX}/waiting-for-me").json() == []                    # not asked: the rule named IMPL1 alone


def test_revoking_an_exception_cancels_what_was_still_to_implement(w):
    eid, _ = implementing(w)
    r = w.as_(EXCADMIN).post(f"{EX}/{eid}/revoke", json={"reason": "No longer needed"})
    assert r.status_code == 200, r.text
    assert get(w, eid)["implementation"]["state"] == "cancelled"
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
    late = w.as_(IMPL1).post(f"{EX}/{eid}/controls", json={"title": "Late"})
    assert late.status_code == 409 and late.json()["detail"] == "The implementation is finished: its compensating controls are kept as they were."


def test_a_rejected_exception_is_never_implemented(w):
    make_rule(w, implementer=implementer())
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    assert decide(w, eid, APP1, "reject", rejection_reason="Patch first").status_code == 200
    e = get(w, eid)
    assert e["status"] == "rejected" and e["implementation"] is None
    assert w.as_(IMPL1).get(f"{EX}/waiting-for-me").json() == []
