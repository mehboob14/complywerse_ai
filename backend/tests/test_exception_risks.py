"""The potential risks of an exception (DECISIONS D62): what the people asked at its review and approval steps record, and the rule that an
approval needs the approver's own assessment. Over HTTP through the whole governance router with real tokens on in-memory SQLite
(``_exc_world``).

* who records: only a person asked at the OPEN step (never the requester, an administrator who is not asked, or someone asked at a later step);
* what is recorded: several risks each with a likelihood and impact, a rating in the risk register's own bands, the organisation's own words
  for a level, a note, an optional link to a register entry; "none identified" is an assessment too;
* the gate: an approval needs the approver's own assessment (a rejection or a question does not); one person's does not stand in for another's;
  one switch turns it off; without a rule nothing is required;
* kept: earlier steps' risks stay visible, every round keeps its own, an author changes theirs only while their step is open.
"""
from _exc_world import (ADMIN, APP1, APP2, EX, PLAIN, REQ, REV1, REV2, _schema, assess, decide, get, make_rule, raise_exception,  # noqa: F401
                        record, step, submit, w)

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_risks as K  # noqa: E402


def reviewed(w):
    """An exception waiting at step 1, a review by REV1, of a rule whose step 2 is APP1's approval: its id."""
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    return eid


def waiting(w):
    """An exception waiting for APP1's approval (a one-step rule): its id."""
    make_rule(w)
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    return eid


# ── who records ──────────────────────────────────────────────────────────────
def test_only_the_people_asked_at_the_open_step_record_potential_risks(w):
    make_rule(w, steps=[step("review", [{"type": "user", "id": REV1}]), step("approval", [{"type": "user", "id": APP1}])])
    eid = raise_exception(w)["id"]
    body = {"title": "Backups could fail unnoticed", "likelihood": 3, "impact": 4}
    assert w.as_(REV1).post(f"{EX}/{eid}/risks", json=body).status_code == 403                  # a draft: nobody is asked yet
    assert submit(w, eid).status_code == 200
    for who in (PLAIN, ADMIN, REQ, APP1, REV2):                                                  # APP1 is asked at step 2, which is not open yet
        r = w.as_(who).post(f"{EX}/{eid}/risks", json=body)
        assert r.status_code == 403 and r.json()["detail"] == K.NOT_YOUR_STEP, who
    assert w.as_(REV1).post(f"{EX}/{eid}/risks", json=body).status_code == 201
    assert decide(w, eid, REV1).status_code == 200
    assert w.as_(REV1).post(f"{EX}/{eid}/risks", json=body).status_code == 403                  # its step is closed
    assert w.as_(APP1).post(f"{EX}/{eid}/risks", json=body).status_code == 201


def test_without_a_rule_a_person_allowed_to_approve_may_record_and_nothing_is_required(w):
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200                                                    # no rule: the older flow
    assert get(w, eid)["approval"] is None
    for who in (REQ, PLAIN):                                                                    # the requester decides nothing; no right to approve
        assert w.as_(who).post(f"{EX}/{eid}/risks", json={"title": "x"}).status_code == 403, who
    record(w, eid, APP1)
    assert w.as_(APP1).get(f"{EX}/{eid}/risks").json()["my_turn"] == {
        "round": None, "step_position": None, "step_name": None, "kind": "approval", "recorded": True, "none_identified": False}
    other = raise_exception(w)["id"]
    assert submit(w, other).status_code == 200
    assert w.as_(APP1).post(f"{EX}/{other}/approve", json={}).status_code == 200                # the older flow asks for no assessment


# ── what is recorded ─────────────────────────────────────────────────────────
def test_a_potential_risk_is_rated_in_the_risk_registers_bands_and_in_the_organisations_own_words(w):
    eid = waiting(w)
    assert w.as_(PLAIN).get(f"{EX}/{eid}/risks").json()["scales"] == {"likelihood": {}, "impact": {}}      # no scales set: plain levels
    for likelihood, impact, score, band in [(5, 4, 20, "critical"), (3, 4, 12, "high"), (2, 3, 6, "medium"), (1, 2, 2, "low")]:
        r = record(w, eid, APP1, likelihood=likelihood, impact=impact)
        assert (r["score"], r["rating"], r["rating_label"]) == (score, band, band.title())
    w.db.add(m.LikelihoodImpactScale(tenant_id=1, scale_type="likelihood", level=3, label="Possible", score_value=3))
    w.db.commit()
    r = record(w, eid, APP1, likelihood=3, impact=1)
    assert r["likelihood_label"] == "Possible" and r["impact_label"] is None                    # a level the organisation has not named has no label
    assert w.as_(PLAIN).get(f"{EX}/{eid}/risks").json()["scales"] == {"likelihood": {"3": "Possible"}, "impact": {}}   # its words come with the list, for a reviewer with no Risk Management right
    half = record(w, eid, APP1, likelihood=3, impact=None)
    assert (half["score"], half["rating"]) == (None, None)                                      # a rating needs both


def test_a_potential_risk_is_checked_in_words(w):
    eid = waiting(w)

    def refused(**body):
        r = w.as_(APP1).post(f"{EX}/{eid}/risks", json=body)
        assert r.status_code == 400, r.text
        return r.json()["detail"]

    assert refused(likelihood=3) == "Say what could go wrong."
    assert refused(title="x", likelihood=6) == "The likelihood is a number from 1 to 5."
    assert refused(title="x", impact="high") == "The impact is a number from 1 to 5."
    assert refused(title="x" * 501) == "What could go wrong is at most 500 characters."
    assert refused(title="x", description="y" * 4001) == "The note is at most 4000 characters."
    assert w.db.query(m.ExceptionRisk).count() == 0


def test_saying_that_nothing_could_go_wrong_is_an_assessment_and_a_real_risk_replaces_it(w):
    eid = waiting(w)

    def mine():
        return get(w, eid, APP1)["approval"]["my_step"]["assessment"]

    assert mine() == {"recorded": False, "none_identified": False, "count": 0}
    first = assess(w, eid, APP1)
    assert first.status_code == 201 and first.json()["none_identified"] is True and first.json()["rating"] is None
    again = assess(w, eid, APP1)                                                                # said twice, recorded once
    assert again.status_code == 201 and again.json()["id"] == first.json()["id"]
    assert mine() == {"recorded": True, "none_identified": True, "count": 0}
    risk = record(w, eid, APP1)
    assert mine() == {"recorded": True, "none_identified": False, "count": 1}                   # the real risk took the place of "none identified"
    r = assess(w, eid, APP1)
    assert r.status_code == 409 and r.json()["detail"].startswith("You recorded potential risks at this step")
    assert [x["id"] for x in w.as_(APP1).get(f"{EX}/{eid}/risks").json()["risks"]] == [risk["id"]]


# ── the gate ─────────────────────────────────────────────────────────────────
def test_an_approval_needs_the_approvers_own_assessment_and_a_question_does_not(w):
    eid = waiting(w)
    r = w.as_(APP1).post(f"{EX}/{eid}/approve", json={})
    assert r.status_code == 400 and r.json()["detail"] == K.NEEDS_ASSESSMENT
    assert get(w, eid)["status"] == "pending_approval"
    assert w.as_(APP1).post(f"{EX}/{eid}/request-changes", json={"comment": "Add a plan"}).status_code == 200      # asking needs none
    assert submit(w, eid).status_code == 200                                                    # round 2: round 1's assessment is not this one's
    assert w.as_(APP1).post(f"{EX}/{eid}/approve", json={}).status_code == 400
    assert decide(w, eid, APP1).status_code == 200 and get(w, eid)["status"] == "approved"


def test_one_persons_assessment_does_not_stand_in_for_anothers(w):
    make_rule(w, steps=[step("approval", [{"type": "user", "id": APP1}, {"type": "user", "id": APP2}])])
    eid = raise_exception(w)["id"]
    assert submit(w, eid).status_code == 200
    assert assess(w, eid, APP1).status_code == 201
    r = w.as_(APP2).post(f"{EX}/{eid}/approve", json={})
    assert r.status_code == 400 and r.json()["detail"] == K.NEEDS_ASSESSMENT
    assert decide(w, eid, APP1).status_code == 200 and get(w, eid)["status"] == "pending_approval"
    assert decide(w, eid, APP2).status_code == 200 and get(w, eid)["status"] == "approved"


def test_the_requirement_is_one_switch(w, monkeypatch):
    monkeypatch.setattr(K, "REQUIRE_ASSESSMENT", False)
    eid = waiting(w)
    assert w.as_(APP1).post(f"{EX}/{eid}/approve", json={}).status_code == 200


# ── kept ─────────────────────────────────────────────────────────────────────
def test_the_risks_of_earlier_steps_stay_visible_and_every_round_keeps_its_own(w):
    eid = reviewed(w)
    first = record(w, eid, REV1, title="Data loss", likelihood=2, impact=5)
    assert decide(w, eid, REV1).status_code == 200
    listing = w.as_(APP1).get(f"{EX}/{eid}/risks").json()
    assert [(x["title"], x["step_name"], x["round"], x["mine"], x["can_edit"]) for x in listing["risks"]] == [("Data loss", "Review", 1, False, False)]
    assert listing["my_turn"]["step_position"] == 2 and listing["my_turn"]["recorded"] is False
    record(w, eid, APP1, title="Outage")
    assert decide(w, eid, APP1, "changes", comment="Add a plan").status_code == 200
    assert submit(w, eid).status_code == 200                                                    # round 2
    listing = w.as_(REV1).get(f"{EX}/{eid}/risks").json()
    assert [x["round"] for x in listing["risks"]] == [1, 1]
    assert listing["my_turn"] == {"round": 2, "step_position": 1, "step_name": "Review", "kind": "review", "recorded": False, "none_identified": False}
    assert w.as_(REV1).post(f"{EX}/{eid}/approve", json={}).status_code == 400                  # round 1's assessment does not count in round 2
    assert w.as_(REV1).put(f"{EX}/{eid}/risks/{first['id']}", json={"title": "x"}).status_code == 409   # and round 1's risk stays as it was


def test_an_author_changes_or_removes_a_risk_only_while_the_step_is_open(w):
    eid = reviewed(w)
    risk = record(w, eid, REV1, likelihood=2, impact=2)
    r = w.as_(REV1).put(f"{EX}/{eid}/risks/{risk['id']}", json={"impact": 5, "title": "Data loss"})
    assert r.status_code == 200 and (r.json()["score"], r.json()["rating"], r.json()["title"]) == (10, "medium", "Data loss")
    for who in (ADMIN, REV2, APP1):
        other = w.as_(who).put(f"{EX}/{eid}/risks/{risk['id']}", json={"title": "Mine"})
        assert other.status_code == 403 and other.json()["detail"] == "Only the person who recorded a potential risk can change or remove it.", who
    assert w.as_(REV1).put(f"{EX}/{eid}/risks/999", json={}).status_code == 404
    assert w.as_(REV1).delete(f"{EX}/{eid}/risks/{risk['id']}").status_code == 204
    assert w.as_(REV1).get(f"{EX}/{eid}/risks").json()["risks"] == []
    later = record(w, eid, REV1)
    assert decide(w, eid, REV1).status_code == 200
    closed = w.as_(REV1).delete(f"{EX}/{eid}/risks/{later['id']}")
    assert closed.status_code == 409 and closed.json()["detail"] == K.CLOSED


def test_a_risk_can_be_linked_to_a_register_entry_of_the_organisation(w):
    eid = waiting(w)
    risk = record(w, eid, APP1)
    link = f"{EX}/{eid}/risks/{risk['id']}/link"
    ok = w.as_(APP1).post(link, json={"risk_id": 5})
    assert ok.status_code == 200 and ok.json()["register_risk_id"] == 5
    other = w.as_(APP1).post(link, json={"risk_id": 90})                                        # another organisation's entry
    assert other.status_code == 400 and other.json()["detail"] == "The register entry chosen does not exist."
    assert w.as_(APP1).post(link, json={"risk_id": None}).json()["register_risk_id"] is None
    assert w.as_(REQ).post(link, json={"risk_id": 5}).status_code == 403
    assert w.as_(APP1).delete(f"{EX}/{eid}/risks/{risk['id']}").status_code == 204
    none = assess(w, eid, APP1).json()
    r = w.as_(APP1).post(f"{EX}/{eid}/risks/{none['id']}/link", json={"risk_id": 5})
    assert r.status_code == 409 and r.json()["detail"] == "That says you found none: there is nothing to link."
    assert w.as_(APP1).put(f"{EX}/{eid}/risks/{none['id']}", json={"title": "x"}).status_code == 409


def test_the_register_entries_to_link_to_are_offered_to_whoever_is_asked_at_the_open_step_with_a_number_and_a_title_only(w):
    eid = waiting(w)                                                                            # APP1 holds no Risk Management right in this organisation
    mine = w.as_(APP1).get(f"{EX}/{eid}/risk-register")
    assert mine.status_code == 200 and mine.json() == [{"id": 5, "title": "Register risk"}]       # the organisation's own entries; entry 90 is another organisation's
    for who in (PLAIN, REQ, ADMIN, APP2):                                                       # not asked at the open step: nothing of the register is shown
        r = w.as_(who).get(f"{EX}/{eid}/risk-register")
        assert r.status_code == 403 and r.json()["detail"] == K.NOT_YOUR_STEP, who
    assert w.as_(APP1).get(f"{EX}/99999/risk-register").status_code == 404
    assert w.db.query(m.ExceptionRisk).count() == 0                                             # a read writes nothing


def test_the_risks_are_read_by_anyone_signed_in_and_a_get_writes_nothing(w):
    eid = reviewed(w)
    record(w, eid, REV1)
    before = w.db.query(m.ExceptionRisk).count()
    r = w.as_(PLAIN).get(f"{EX}/{eid}/risks")
    assert r.status_code == 200 and len(r.json()["risks"]) == 1 and r.json()["my_turn"] is None
    assert w.as_(PLAIN).get(f"{EX}/9999/risks").status_code == 404
    assert w.db.query(m.ExceptionRisk).count() == before
