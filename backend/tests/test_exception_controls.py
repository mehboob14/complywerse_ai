"""The compensating controls of an approved exception (DECISIONS D62): what its implementer records, and marking it implemented. Over HTTP through
the whole governance router with real tokens on in-memory SQLite (``_exc_world``).

* who records: only a person the rule asked to implement it (any one of them), never an administrator who was not asked or the requester;
* what a control holds: what it is, the potential risks and the assets of THIS exception it covers, an owner, a date, planned or in place,
  evidence (a link, or an item of the organisation's Evidence library), all checked in words;
* the work: the first control starts it (waiting -> in progress); Mark implemented needs a control, and potential risks no control covers need
  the person's say-so; once it is done the controls are kept as they were; the exception's status is approved throughout.
"""
from _exc_world import (ADMIN, APP1, EX, IMPL1, IMPL2, PLAIN, REQ, SEEN, _schema, approved, decide, get, implementer, implementing,  # noqa: F401
                        make_rule, raise_exception, submit, w)

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_controls as C  # noqa: E402


def controls_url(eid):
    return f"{EX}/{eid}/controls"


def test_only_the_people_asked_to_implement_record_controls_and_the_first_one_starts_the_work(w):
    eid, risk = implementing(w)
    body = {"title": "Daily restore test", "risk_ids": [risk["id"]]}
    for who in (PLAIN, ADMIN, APP1, REQ, IMPL2):
        r = w.as_(who).post(controls_url(eid), json=body)
        assert r.status_code == 403 and r.json()["detail"] == C.NOT_YOURS, who
    assert get(w, eid)["implementation"]["state"] == "waiting"
    r = w.as_(IMPL1).post(controls_url(eid), json=body)
    assert r.status_code == 201 and r.json()["title"] == "Daily restore test" and r.json()["created_by"]["id"] == IMPL1
    impl = get(w, eid)["implementation"]
    assert (impl["state"], impl["controls_count"], impl["uncovered_count"]) == ("in_progress", 1, 0)
    assert get(w, eid)["status"] == "approved"                                       # the exception itself is untouched
    assert [c["can_edit"] for c in w.as_(PLAIN).get(controls_url(eid)).json()["controls"]] == [False]    # anyone signed in reads, only the implementer edits
    assert [c["can_edit"] for c in w.as_(IMPL1).get(controls_url(eid)).json()["controls"]] == [True]


def test_a_control_is_checked_in_words(w):
    eid, risk = implementing(w)
    assert w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [1]}).status_code == 200      # asset 1 is on the exception, asset 2 is not

    def refused(**body):
        r = w.as_(IMPL1).post(controls_url(eid), json={"title": "t", **body})
        assert r.status_code == 400, r.text
        return r.json()["detail"]

    assert w.as_(IMPL1).post(controls_url(eid), json={}).json()["detail"] == "Say what the control is."
    assert refused(title="x" * 501) == "The control's name is at most 500 characters."
    assert refused(risk_ids=[999]) == "A potential risk chosen does not belong to this exception."
    assert refused(asset_ids=[2]) == "An asset chosen does not belong to this exception."
    assert refused(owner_id=999) == "The owner chosen is not an active person of this platform."
    assert refused(due_date="soon") == "The due date is not a date."
    assert refused(status="done") == "A control is planned or in place."
    assert refused(evidence=[{"kind": "link", "url": "ftp://files.test/x"}]) == "A link has to start with http:// or https://."
    assert refused(evidence=[{"kind": "evidence", "evidence_id": 90}]) == "The evidence chosen does not exist."          # another organisation's
    assert refused(evidence=[{"kind": "file"}]) == "Evidence is a link or an item of the Evidence library."
    assert w.db.query(m.ExceptionControl).count() == 0


def test_a_control_holds_its_risks_assets_owner_date_state_and_evidence_and_is_changed_and_removed(w):
    eid, risk = implementing(w)
    assert w.as_(REQ).post(f"{EX}/{eid}/assets", json={"asset_ids": [1]}).status_code == 200
    body = {"title": "Daily restore test", "description": "Restore the nightly backup to a scratch host and compare checksums.",
            "risk_ids": [risk["id"]], "asset_ids": [1], "owner_id": IMPL1, "due_date": "2026-12-01", "status": "in_place",
            "evidence": [{"kind": "link", "url": "https://wiki.acme.test/backups", "label": "Runbook"}, {"kind": "evidence", "evidence_id": 1}]}
    c = w.as_(IMPL1).post(controls_url(eid), json=body).json()
    assert (c["risk_ids"], c["asset_ids"], c["status"]) == ([risk["id"]], [1], "in_place")
    assert c["owner"] == {"id": IMPL1, "name": "Impl1"} and c["due_date"].startswith("2026-12-01")
    assert c["evidence"] == [{"kind": "link", "url": "https://wiki.acme.test/backups", "label": "Runbook"},
                             {"kind": "evidence", "evidence_id": 1, "label": "Penetration test summary"}]
    r = w.as_(IMPL1).put(f"{controls_url(eid)}/{c['id']}", json={"status": "planned", "evidence": [], "due_date": None})
    assert r.status_code == 200
    changed = r.json()
    assert (changed["status"], changed["evidence"], changed["due_date"], changed["title"]) == ("planned", [], None, "Daily restore test")
    assert w.as_(IMPL2).put(f"{controls_url(eid)}/{c['id']}", json={"title": "Mine"}).status_code == 403
    assert w.as_(IMPL1).put(f"{controls_url(eid)}/999", json={"title": "x"}).status_code == 404
    assert w.as_(IMPL1).delete(f"{controls_url(eid)}/{c['id']}").status_code == 204
    assert w.as_(IMPL1).get(controls_url(eid)).json()["controls"] == []


def test_marking_it_implemented_needs_a_control_and_the_persons_say_so_for_a_risk_no_control_covers(w):
    eid, risk = implementing(w)
    done = f"{EX}/{eid}/implementation/complete"
    r = w.as_(IMPL1).post(done, json={})
    assert r.status_code == 400 and r.json()["detail"] == "Record at least one compensating control before you mark it implemented."
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "Daily restore test"}).status_code == 201       # covers no risk
    assert get(w, eid)["implementation"]["uncovered_count"] == 1
    lst = w.as_(IMPL1).get(controls_url(eid)).json()
    assert lst["uncovered_risks"] == [{"id": risk["id"], "title": "Backups could fail unnoticed"}]
    r = w.as_(IMPL1).post(done, json={})
    assert r.status_code == 409 and r.json()["detail"] == (
        "1 potential risk has no compensating control: Backups could fail unnoticed. Mark it implemented anyway?")
    assert w.as_(IMPL2).post(done, json={"confirm_uncovered": True}).status_code == 403                       # not asked
    SEEN.clear()
    r = w.as_(IMPL1).post(done, json={"note": "Restore test passed", "confirm_uncovered": True})
    assert r.status_code == 200, r.text
    e = r.json()
    impl = e["implementation"]
    assert e["status"] == "approved" and (impl["state"], impl["completed_by_name"], impl["note"], impl["can_complete"]) == ("done", "Impl1", "Restore test passed", False)
    assert ([REQ], "Exception implemented: Skip backups") in SEEN
    assert "Implemented: Restore test passed" in [c.comment for c in w.db.query(m.PolicyExceptionComment).filter(m.PolicyExceptionComment.exception_id == eid)]
    for call in (lambda: w.as_(IMPL1).post(controls_url(eid), json={"title": "More"}), lambda: w.as_(IMPL1).post(done, json={}),
                 lambda: w.as_(IMPL1).delete(f"{controls_url(eid)}/1")):
        late = call()
        assert late.status_code == 409 and late.json()["detail"] == C.CLOSED                                   # kept as they were
    assert [x["title"] for x in w.as_(PLAIN).get(controls_url(eid)).json()["controls"]] == ["Daily restore test"]


def test_a_control_that_covers_the_risks_needs_no_confirmation(w):
    eid, risk = implementing(w)
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "Daily restore test", "risk_ids": [risk["id"]]}).status_code == 201
    assert w.as_(IMPL1).get(controls_url(eid)).json()["uncovered_risks"] == []
    assert w.as_(IMPL1).post(f"{EX}/{eid}/implementation/complete", json={}).status_code == 200


def test_an_assessment_that_found_no_risk_leaves_nothing_to_cover(w):
    make_rule(w)
    eid = raise_exception(w, implementer=implementer())["id"]
    assert submit(w, eid).status_code == 200
    assert decide(w, eid, APP1).status_code == 200                                    # approved with "none identified"
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "Review access monthly"}).status_code == 201
    assert w.as_(IMPL1).post(f"{EX}/{eid}/implementation/complete", json={}).status_code == 200


def test_the_exception_shows_how_many_potential_risks_and_controls_it_has(w):
    eid, risk = implementing(w)
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "One"}).status_code == 201
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "Two"}).status_code == 201
    e = get(w, eid)
    assert (e["risks_count"], e["controls_count"]) == (1, 2)
    listed = next(x for x in w.as_(PLAIN).get(EX).json() if x["id"] == eid)
    assert (listed["risks_count"], listed["controls_count"], listed["implementation"]["state"]) == (1, 2, "in_progress")


def test_move_to_the_risk_register_carries_the_recorded_risks_and_controls(w):
    eid, risk = implementing(w)
    assert w.as_(IMPL1).post(controls_url(eid), json={"title": "Daily restore test", "status": "in_place"}).status_code == 201
    r = w.as_(APP1).post(f"{EX}/{eid}/promote-to-risk")
    assert r.status_code == 200, r.text
    text = w.db.get(m.Risk, r.json()["risk_id"]).description
    assert "Potential risks:\n1. Backups could fail unnoticed (high rating)" in text
    assert "Compensating controls:\n1. Daily restore test (in place)" in text


def test_an_exception_with_no_implementer_has_no_controls_to_record(w):
    eid = approved(w)
    r = w.as_(IMPL1).post(controls_url(eid), json={"title": "x"})
    assert r.status_code == 403 and r.json()["detail"] == C.NOT_YOURS
    lst = w.as_(IMPL1).get(controls_url(eid)).json()
    assert lst == {"controls": [], "implementation": None, "uncovered_risks": []}
