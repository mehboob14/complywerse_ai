"""The Committees meeting life cycle, and what the Committees page reads beside it.

Start and end a meeting (scheduled -> in_progress -> completed, idempotent, nothing else), the roll call and the quorum it sets, the outcome and
decision of an agenda item, the decisions feed, "assigned to me" and a due-date range on the actions, the per-committee health fields and the
readiness counts on the meeting rows. Every committee write stays as open as it was (a sign-in), pinned by the freeze tests at the end. Over HTTP
through the committees router, real tokens, in-memory SQLite (as test_committee_deactivate.py).
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import sqlite3  # noqa: E402
import time  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.routing import APIRoute  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import Response  # noqa: E402

import grc.models as m  # noqa: E402
from grc import audit_changes, audit_logger  # noqa: E402
from grc.modules.governance.routers import committees  # noqa: E402
from grc.modules.workflow_engine.services import catalog  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

NOW = datetime.utcnow().replace(microsecond=0)
DAY = timedelta(days=1)
CHAIR, SECRETARY, MEMBER_A, MEMBER_B, OBSERVER, OUTSIDER = 1, 2, 3, 4, 5, 6


def at(days, hours=0):
    return NOW + timedelta(days=days, hours=hours)


def add_committee(db, cid, name, members=(), *, active=True, tenant=1, ctype="custom"):
    db.add(m.GovernanceCommittee(id=cid, tenant_id=tenant, name=name, committee_type=ctype, is_active=active))
    for uid, role in members:
        db.add(m.CommitteeMember(tenant_id=tenant, committee_id=cid, user_id=uid, role=role))
    db.commit()


def add_meeting(db, mid, cid, status="scheduled", when=None, *, quorum=3, title=None, tenant=1):
    db.add(m.CommitteeMeeting(id=mid, tenant_id=tenant, committee_id=cid, title=title or f"Meeting {mid}", scheduled_date=when or at(7),
                              status=status, quorum_required=quorum))
    db.commit()


def add_item(db, iid, mid, n=1, title=None, *, outcome=None, decision=None, status="pending", tenant=1):
    db.add(m.MeetingAgendaItem(id=iid, tenant_id=tenant, meeting_id=mid, item_number=n, title=title or f"Item {iid}", outcome=outcome,
                               decision_made=decision, status=status))
    db.commit()


def add_action(db, aid, *, status="open", due=None, who=None, cid=1, title=None):
    db.add(m.OversightAction(id=aid, tenant_id=1, committee_id=cid, title=title or f"Action {aid}", status=status, due_date=due, assigned_to=who))
    db.commit()


@pytest.fixture(scope="module")
def schema():
    """The empty schema, built once for the file and copied into each test's own in-memory database."""
    source = sqlite3.connect(":memory:", check_same_thread=False)
    m.Base.metadata.create_all(create_engine("sqlite://", creator=lambda: source, poolclass=StaticPool))
    yield source
    source.close()


@pytest.fixture
def w(schema):
    """db, an HTTP client signed in as the user you ask for (default: user 1, who holds NO role), and `as_`.
    Committee 1 "Audit Committee": user 1 chair, 2 secretary, 3 and 4 members, 5 observer; committee 2 "Risk Committee": 1 chair, 6 member."""
    copy = sqlite3.connect(":memory:", check_same_thread=False)
    schema.backup(copy)
    engine = create_engine("sqlite://", creator=lambda: copy, poolclass=StaticPool)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank", primary_contact_email="boss@bank.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other", primary_contact_email="boss@other.test"))
    for uid in range(1, 13):
        db.add(m.GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@bank.test", display_name=f"User {uid:02d}", is_active=True))
    db.commit()
    add_committee(db, 1, "Audit Committee", [(CHAIR, "chair"), (SECRETARY, "secretary"), (MEMBER_A, "member"), (MEMBER_B, "member"), (OBSERVER, "observer")])
    add_committee(db, 2, "Risk Committee", [(CHAIR, "chair"), (OUTSIDER, "member")])
    app = FastAPI()
    app.include_router(committees.router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app)

    def as_(uid=1):
        http.headers["Authorization"] = "Bearer " + create_access_token({"sub": f"u{uid}", "tenant_slug": "bank", "tenant_id": 1})
        return http

    as_(1)
    yield db, http, as_
    db.close()


def states(roll):
    return {p["user_id"]: p["status"] for p in roll["members"]}


# ── start and end ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_a_meeting_goes_scheduled_to_in_progress_to_completed_and_repeating_a_call_changes_nothing(w):
    db, http, _ = w
    add_meeting(db, 10, 1)
    # a meeting that is still to come cannot be ended before it started
    refused = http.post("/committees/meetings/10/end")
    assert (refused.status_code, refused.json()["detail"]) == (409, "This meeting has not started yet: start it first, or cancel it")
    assert db.get(m.CommitteeMeeting, 10).status == "scheduled"

    started = http.post("/committees/meetings/10/start")
    assert started.status_code == 200 and started.json()["status"] == "in_progress"
    assert started.json() == http.get("/committees/meetings/10").json()          # it answers with the meeting, agenda and minutes
    assert http.post("/committees/meetings/10/start").json()["status"] == "in_progress"      # again: nothing to do

    ended = http.post("/committees/meetings/10/end")
    assert ended.status_code == 200 and ended.json()["status"] == "completed"
    assert ended.json() == http.get("/committees/meetings/10").json()
    assert http.post("/committees/meetings/10/end").json()["status"] == "completed"           # again: nothing to do

    gone = http.post("/committees/meetings/10/start")
    assert (gone.status_code, gone.json()["detail"]) == (409, "This meeting is already completed")
    db.expire_all()
    assert db.get(m.CommitteeMeeting, 10).status == "completed"


def test_a_past_meeting_nobody_started_can_be_closed_and_that_invents_no_attendance(w):
    db, http, _ = w
    add_meeting(db, 11, 1, "scheduled", at(-3))
    closed = http.post("/committees/meetings/11/end")
    assert closed.status_code == 200 and closed.json()["status"] == "completed"
    assert closed.json()["quorum_present"] is None and closed.json()["quorum_met"] is None      # "not recorded", not a failed quorum
    assert db.query(m.MeetingAttendance).count() == 0
    # and a past meeting can still be started, if the secretary prefers to run the roll
    add_meeting(db, 12, 1, "scheduled", at(-1))
    assert http.post("/committees/meetings/12/start").json()["status"] == "in_progress"


@pytest.mark.parametrize("path", ["start", "end"])
def test_a_cancelled_meeting_stays_cancelled(w, path):
    db, http, _ = w
    add_meeting(db, 13, 1, "cancelled", at(-2))
    refused = http.post(f"/committees/meetings/13/{path}")
    assert (refused.status_code, refused.json()["detail"]) == (409, "This meeting was cancelled")
    db.expire_all()
    assert db.get(m.CommitteeMeeting, 13).status == "cancelled"


def test_a_status_the_raw_put_stored_is_not_started_or_ended(w):
    db, http, _ = w
    add_meeting(db, 14, 1, "postponed", at(-2))
    assert http.post("/committees/meetings/14/start").json()["detail"] == "A meeting that is postponed cannot be started"
    assert http.post("/committees/meetings/14/end").json()["detail"] == "A meeting that is postponed cannot be ended"
    assert db.get(m.CommitteeMeeting, 14).status == "postponed"


def test_an_unknown_meeting_and_another_tenants_are_a_404(w):
    db, http, _ = w
    db.add(m.GovernanceCommittee(id=90, tenant_id=2, name="Foreign", committee_type="custom"))
    add_meeting(db, 90, 90, "in_progress", at(-1), tenant=2)
    add_item(db, 900, 90, tenant=2)
    for call in (http.post("/committees/meetings/999/start"), http.post("/committees/meetings/999/end"), http.get("/committees/meetings/999/attendance"),
                 http.put("/committees/meetings/999/attendance", json={"members": []}),
                 http.post("/committees/meetings/90/start"), http.post("/committees/meetings/90/end"), http.get("/committees/meetings/90/attendance"),
                 http.put("/committees/meetings/90/attendance", json={"members": [{"user_id": 1, "status": "present"}]}),
                 http.put("/committees/meetings/agenda/900/outcome", json={"outcome": "Approved"}),
                 http.put("/committees/meetings/agenda/999/outcome", json={"outcome": "Approved"})):
        assert call.status_code == 404, call.text
    assert db.get(m.CommitteeMeeting, 90).status == "in_progress" and db.query(m.MeetingAttendance).count() == 0
    assert db.get(m.MeetingAgendaItem, 900).outcome is None


def test_the_meeting_of_an_inactive_committee_can_still_be_run(w):
    db, http, _ = w
    add_committee(db, 4, "Retired", [(CHAIR, "chair")], active=False)
    add_meeting(db, 40, 4)
    assert http.post("/committees/meetings/40/start").status_code == 200          # Deactivate refuses adding, not running what is already there
    assert http.post("/committees/meetings/40/end").status_code == 200


# ── the roll call and the quorum ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_roll_before_anyone_is_marked(w):
    db, http, _ = w
    add_meeting(db, 20, 1, "in_progress", at(0, -1))
    roll = http.get("/committees/meetings/20/attendance").json()
    assert (roll["meeting_id"], roll["committee_id"], roll["meeting_status"]) == (20, 1, "in_progress")
    assert (roll["recorded"], roll["quorum_required"], roll["quorum_present"], roll["quorum_met"], roll["voting_members"]) == (False, 3, None, None, 4)
    assert [(p["user_id"], p["role"], p["status"], p["counts_toward_quorum"]) for p in roll["members"]] == [
        (CHAIR, "chair", None, True), (SECRETARY, "secretary", None, True), (MEMBER_A, "member", None, True), (MEMBER_B, "member", None, True),
        (OBSERVER, "observer", None, False)]
    assert roll["members"][0]["user_name"] == "User 01" and roll["members"][0]["user_email"] == "u1@bank.test"
    assert all(p["is_active_member"] and p["marked_by"] is None and p["marked_at"] is None for p in roll["members"])


def test_a_roll_is_taken_while_the_meeting_runs_and_quorum_follows_it(w):
    db, http, as_ = w
    add_meeting(db, 21, 1, "scheduled", at(0, 1))
    one = {"members": [{"user_id": MEMBER_A, "status": "present"}]}
    early = http.put("/committees/meetings/21/attendance", json=one)
    assert (early.status_code, early.json()["detail"]) == (409, "Start the meeting before taking the roll call")
    assert db.query(m.MeetingAttendance).count() == 0

    http.post("/committees/meetings/21/start")
    first = http.put("/committees/meetings/21/attendance", json=one).json()
    # the first marks also record everyone else absent: the roll is complete from then on
    assert states(first) == {CHAIR: "absent", SECRETARY: "absent", MEMBER_A: "present", MEMBER_B: "absent", OBSERVER: "absent"}
    assert (first["recorded"], first["quorum_present"], first["quorum_met"]) == (True, 1, False)

    both = {"members": [{"user_id": CHAIR, "status": "present"}, {"user_id": SECRETARY, "status": "Late"}]}       # any case; late counts
    second = http.put("/committees/meetings/21/attendance", json=both).json()
    assert (states(second)[CHAIR], states(second)[SECRETARY]) == ("present", "late")
    assert (second["quorum_present"], second["quorum_met"]) == (3, True)
    assert http.get("/committees/meetings/21").json()["quorum_present"] == 3          # the meeting carries the count the overviews read

    observer = http.put("/committees/meetings/21/attendance", json={"members": [{"user_id": OBSERVER, "status": "present"}]}).json()
    assert states(observer)[OBSERVER] == "present" and observer["quorum_present"] == 3        # an observer is on the roll and never counts
    assert [p["counts_toward_quorum"] for p in observer["members"] if p["user_id"] == OBSERVER] == [False]

    left = http.put("/committees/meetings/21/attendance", json={"members": [{"user_id": MEMBER_A, "status": "absent"}]}).json()
    assert (left["quorum_present"], left["quorum_met"]) == (2, False)
    row = db.query(m.MeetingAttendance).filter_by(meeting_id=21, user_id=MEMBER_A).one()
    assert (row.status, row.role, row.marked_by) == ("absent", "member", 1)

    # after the meeting ended the roll can still be corrected
    http.post("/committees/meetings/21/end")
    fixed = http.put("/committees/meetings/21/attendance", json={"members": [{"user_id": MEMBER_A, "status": "present"}]}).json()
    assert (fixed["meeting_status"], fixed["quorum_present"], fixed["quorum_met"]) == ("completed", 3, True)


def test_marking_someone_with_the_status_they_have_changes_nothing_and_the_last_entry_wins(w):
    db, http, _ = w
    add_meeting(db, 22, 1, "in_progress", at(0, -1))
    http.put("/committees/meetings/22/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]})
    before = {p["user_id"]: (p["status"], p["marked_by"], p["marked_at"]) for p in http.get("/committees/meetings/22/attendance").json()["members"]}
    again = http.put("/committees/meetings/22/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]}).json()
    assert {p["user_id"]: (p["status"], p["marked_by"], p["marked_at"]) for p in again["members"]} == before

    dup = http.put("/committees/meetings/22/attendance", json={"members": [{"user_id": MEMBER_B, "status": "present"}, {"user_id": MEMBER_B, "status": "late"},
                                                                          {"user_id": MEMBER_B, "status": "absent"}]}).json()
    assert states(dup)[MEMBER_B] == "absent"
    empty = http.put("/committees/meetings/22/attendance", json={"members": []})
    assert empty.status_code == 200 and states(empty.json()) == states(dup)


def test_a_bad_roll_is_refused_whole(w):
    db, http, _ = w
    add_meeting(db, 23, 1, "in_progress", at(0, -1))
    r = http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": MEMBER_A, "status": "present"}, {"user_id": OUTSIDER, "status": "present"}]})
    assert (r.status_code, r.json()["detail"]) == (400, f"User {OUTSIDER} is not an active member of this committee")
    r = http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": MEMBER_A, "status": "maybe"}]})
    assert (r.status_code, r.json()["detail"]) == (400, "status must be one of: absent, late, present")
    assert http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": 999, "status": "present"}]}).status_code == 400
    assert http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": MEMBER_A}]}).status_code == 422
    assert http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": 1, "status": "present"}] * 201}).status_code == 422
    assert db.query(m.MeetingAttendance).count() == 0 and db.get(m.CommitteeMeeting, 23).quorum_present is None        # nothing was written

    db.query(m.CommitteeMember).filter_by(committee_id=1, user_id=MEMBER_B).update({"is_active": False})
    db.commit()
    gone = http.put("/committees/meetings/23/attendance", json={"members": [{"user_id": MEMBER_B, "status": "present"}]})
    assert gone.status_code == 400                                                  # a member who left cannot be marked
    add_meeting(db, 24, 1, "cancelled", at(-1))
    r = http.put("/committees/meetings/24/attendance", json={"members": [{"user_id": MEMBER_A, "status": "present"}]})
    assert (r.status_code, r.json()["detail"]) == (409, "This meeting was cancelled")


def test_no_threshold_no_members_and_a_member_who_left(w):
    db, http, _ = w
    # quorum not set (or 0): the count is still kept, there is just nothing to judge it by
    for mid, quorum in ((25, None), (26, 0)):
        add_meeting(db, mid, 1, "in_progress", at(0, -1), quorum=quorum)
        roll = http.put(f"/committees/meetings/{mid}/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}, {"user_id": MEMBER_A, "status": "late"}]}).json()
        assert (roll["quorum_present"], roll["quorum_met"], roll["quorum_required"]) == (2, None, quorum)
        assert http.get(f"/committees/meetings/{mid}").json()["quorum_met"] is None

    # a committee with nobody on it: an empty roll, and no one to mark
    add_committee(db, 3, "Empty")
    add_meeting(db, 27, 3, "in_progress", at(0, -1))
    empty = http.get("/committees/meetings/27/attendance").json()
    assert (empty["members"], empty["voting_members"], empty["recorded"], empty["quorum_met"]) == ([], 0, False, None)
    assert http.put("/committees/meetings/27/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]}).status_code == 400

    # a member removed after the roll stays on it, flagged, and the stored count does not move
    http.put("/committees/meetings/25/attendance", json={"members": [{"user_id": MEMBER_B, "status": "present"}]})
    assert http.delete(f"/committees/1/members/{MEMBER_B}").status_code == 200
    roll = http.get("/committees/meetings/25/attendance").json()
    gone = next(p for p in roll["members"] if p["user_id"] == MEMBER_B)
    assert (gone["status"], gone["is_active_member"], gone["role"]) == ("present", False, "member")
    assert roll["quorum_present"] == 3 and roll["voting_members"] == 4        # chair, secretary, member A, member B (still counted: it is on the roll)


def test_a_roll_call_creates_no_minutes_so_the_minutes_measure_does_not_move(w):
    db, http, _ = w
    add_meeting(db, 28, 1, "completed", at(-20))
    db.add(m.MeetingAttendance(tenant_id=1, meeting_id=28, user_id=CHAIR, status="present", role="chair"))
    db.commit()
    add_meeting(db, 29, 1, "scheduled", at(-1))
    http.post("/committees/meetings/29/start")
    http.put("/committees/meetings/29/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]})
    http.post("/committees/meetings/29/end")

    assert db.query(m.MeetingMinutes).count() == 0
    assert http.get("/committees/meetings/29").json()["has_minutes"] is False and http.get("/committees/meetings/29").json()["minutes"] is None
    metric = next(x for x in http.get("/committees/overview").json()["kpis"]["performance"]["metrics"] if x["key"] == "minutes_discipline")
    assert (metric["numerator"], metric["denominator"]) == (0, 2)              # two completed meetings, none minuted
    assert http.get("/committees/overview").json()["kpis"]["meetings_completed"] == 2


def test_a_committee_that_held_a_roll_can_still_be_hard_deleted(w):
    db, http, _ = w
    add_meeting(db, 30, 2, "in_progress", at(-1))
    http.put("/committees/meetings/30/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]})
    assert db.query(m.MeetingAttendance).count() == 2
    assert http.delete("/committees/2").status_code == 204                                # the roll goes with its meeting
    assert db.query(m.MeetingAttendance).count() == 0 and db.get(m.CommitteeMeeting, 30) is None


def test_one_row_per_member_and_meeting(w):
    db, _, _ = w
    add_meeting(db, 31, 1, "in_progress", at(-1))
    db.add(m.MeetingAttendance(tenant_id=1, meeting_id=31, user_id=CHAIR, status="present"))
    db.commit()
    db.add(m.MeetingAttendance(tenant_id=1, meeting_id=31, user_id=CHAIR, status="absent"))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


# ── the outcome of an agenda item ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_outcome_is_one_of_four_words_and_sets_the_items_status(w):
    db, http, _ = w
    add_meeting(db, 50, 1, "in_progress", at(0, -1))
    add_item(db, 500, 50, 1, "Approve the plan")

    def record(**body):
        return http.put("/committees/meetings/agenda/500/outcome", json=body)

    r = record(outcome="approved", decision_made="  Go ahead, review in March  ")
    assert r.status_code == 200
    assert (r.json()["outcome"], r.json()["decision_made"], r.json()["status"], r.json()["id"], r.json()["title"]) == (
        "Approved", "Go ahead, review in March", "discussed", 500, "Approve the plan")
    assert record(outcome="DEFERRED").json()["status"] == "deferred"
    assert record(outcome="Deferred").json()["decision_made"] == "Go ahead, review in March"        # decision left out: the text there is stays
    assert record(outcome="noted", decision_made="").json()["decision_made"] is None                 # sent empty: cleared
    assert (record(outcome="Rejected", decision_made="Not now").json()["outcome"], db.get(m.MeetingAgendaItem, 500).status) == ("Rejected", "discussed")

    refused = record(outcome="maybe")
    assert (refused.status_code, refused.json()["detail"]) == (400, "outcome must be one of: Approved, Rejected, Deferred, Noted")
    assert record(outcome="Approved", decision_made="x" * 10001).status_code == 422
    assert http.put("/committees/meetings/agenda/500/outcome", json={}).status_code == 422
    db.expire_all()
    assert (db.get(m.MeetingAgendaItem, 500).outcome, db.get(m.MeetingAgendaItem, 500).decision_made) == ("Rejected", "Not now")


def test_an_outcome_needs_a_meeting_that_started_and_can_be_corrected_after_it_ended(w):
    db, http, _ = w
    body = {"outcome": "Approved", "decision_made": "Yes"}
    add_meeting(db, 51, 1, "scheduled")
    add_item(db, 510, 51)
    r = http.put("/committees/meetings/agenda/510/outcome", json=body)
    assert (r.status_code, r.json()["detail"]) == (409, "Start the meeting before recording outcomes")
    add_meeting(db, 52, 1, "cancelled", at(-1))
    add_item(db, 520, 52)
    r = http.put("/committees/meetings/agenda/520/outcome", json=body)
    assert (r.status_code, r.json()["detail"]) == (409, "This meeting was cancelled")
    db.expire_all()
    assert db.get(m.MeetingAgendaItem, 510).outcome is None and db.get(m.MeetingAgendaItem, 520).outcome is None

    http.post("/committees/meetings/51/start")
    assert http.put("/committees/meetings/agenda/510/outcome", json=body).status_code == 200
    http.post("/committees/meetings/51/end")
    corrected = http.put("/committees/meetings/agenda/510/outcome", json={"outcome": "Rejected", "decision_made": "Changed after the vote was recounted"})
    assert corrected.status_code == 200 and corrected.json()["outcome"] == "Rejected"


def test_the_raw_puts_still_take_what_they_always_took(w):
    db, http, _ = w
    add_meeting(db, 53, 1)
    add_item(db, 530, 53)
    r = http.put("/committees/meetings/agenda/530", json={"outcome": "Approved with conditions", "decision_made": "See annex", "status": "discussed"})
    assert r.status_code == 200 and r.json()["outcome"] == "Approved with conditions"
    r = http.put("/committees/meetings/53", json={"status": "completed", "quorum_present": 4})
    assert r.status_code == 200 and (r.json()["status"], r.json()["quorum_present"], r.json()["quorum_met"]) == ("completed", 4, True)
    assert http.put("/committees/meetings/53", json={"status": "cancelled"}).json()["status"] == "cancelled"          # cancel is still this call


# ── the decisions feed ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def decided(w):
    """Decisions in four committees' meetings; the feed reads them newest meeting first, then agenda order."""
    db, http, as_ = w
    add_committee(db, 5, "Retired board", [(CHAIR, "chair")], active=False)
    db.add(m.GovernanceCommittee(id=90, tenant_id=2, name="Foreign committee", committee_type="custom"))
    add_meeting(db, 60, 1, "completed", datetime(2026, 10, 31, 23, 59, 59), title="October close")
    add_meeting(db, 61, 1, "completed", datetime(2026, 11, 1, 0, 0, 0), title="November open")
    add_meeting(db, 62, 2, "completed", datetime(2026, 9, 15, 9, 0), title="Risk September")
    add_meeting(db, 63, 5, "completed", datetime(2026, 8, 1, 9, 0), title="Retired August")
    add_meeting(db, 64, 2, "in_progress", datetime(2026, 11, 20, 9, 0), title="Risk November")
    add_meeting(db, 90, 90, "completed", datetime(2026, 11, 2), title="Foreign meeting", tenant=2)
    add_item(db, 600, 60, 1, "Third-party risk appetite", outcome="Approved", decision="Approved with two changes to the café vendor clause")
    add_item(db, 601, 60, 2, "Budget for the audit plan", outcome="Deferred", decision="Back next quarter", status="deferred")
    add_item(db, 602, 60, 3, "Any other business")                                              # no outcome, no decision: not a decision
    add_item(db, 610, 61, 1, "Policy exception for legacy firewall", outcome="Rejected", decision="Too broad")
    add_item(db, 611, 61, 2, "Note the regulator letter", outcome="Noted")                    # an outcome without text
    add_item(db, 612, 61, 3, "Whitespace only", outcome="  ", decision="   ")                  # blank is not a decision
    add_item(db, 620, 62, 1, "Vendor third party review", decision="Handled in the vendor module")      # a decision text without an outcome word
    add_item(db, 630, 63, 1, "Close the old fund", outcome="approved", decision="Closed")
    add_item(db, 640, 64, 1, "Appetite statement", outcome="Approved", decision="Signed")
    add_item(db, 641, 64, 2, "Arabic note", outcome="Noted", decision="تمت المُوَافَقَة على السياسة")
    add_item(db, 900, 90, 1, "Foreign third-party item", outcome="Approved", decision="Hidden from this bank", tenant=2)
    return db, http, as_


def feed(http, **params):
    r = http.get("/committees/decisions", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def ids(payload):
    return [x["id"] for x in payload["items"]]


def test_the_feed_lists_every_decision_newest_meeting_first(decided):
    _, http, _ = decided
    page = feed(http)
    # November 20 (640, 641), November 1 (610, 611), October 31 (600, 601), September 15 (620), August 1 (630); 602 and 612 are not decisions
    assert ids(page) == [640, 641, 610, 611, 600, 601, 620, 630]
    assert (page["total"], page["limit"], page["offset"]) == (8, 50, 0)
    top = page["items"][2]
    assert top == {"id": 610, "item_number": 1, "title": "Policy exception for legacy firewall", "outcome": "Rejected", "decision_made": "Too broad",
                   "status": "pending", "committee_id": 1, "committee_name": "Audit Committee", "committee_is_active": True, "meeting_id": 61,
                   "meeting_title": "November open", "meeting_date": "2026-11-01T00:00:00", "meeting_status": "completed"}
    assert next(x for x in page["items"] if x["id"] == 630)["committee_is_active"] is False
    assert next(x for x in page["items"] if x["id"] == 611)["decision_made"] is None             # an outcome with no text still shows
    assert next(x for x in page["items"] if x["id"] == 620)["outcome"] is None                    # and so does a text with no outcome
    assert 900 not in ids(page)                                                                 # another tenant's decision is not here


def test_the_total_is_true_whatever_the_page(decided):
    _, http, _ = decided
    first = feed(http, limit=3)
    assert ids(first) == [640, 641, 610] and first["total"] == 8
    second = feed(http, limit=3, offset=3)
    assert ids(second) == [611, 600, 601] and second["total"] == 8
    last = feed(http, limit=3, offset=6)
    assert ids(last) == [620, 630] and last["total"] == 8
    past = feed(http, limit=3, offset=60)
    assert (past["items"], past["total"]) == ([], 8)
    assert ids(feed(http, limit=3)) + ids(second) + ids(last) == ids(feed(http))                # pages tile the list: nothing repeated, nothing skipped
    for bad in ({"limit": 0}, {"limit": 201}, {"offset": -1}):
        assert http.get("/committees/decisions", params=bad).status_code == 422


def test_text_search_ignores_case_and_accents_and_wants_every_word(decided):
    _, http, _ = decided
    assert ids(feed(http, q="CAFE")) == [600]                                                  # "café" in the decision text
    assert ids(feed(http, q="Café Vendor")) == [600]
    assert ids(feed(http, q="third-party")) == [600]                                           # a hyphenated word is one word: 620 says "third party"
    assert ids(feed(http, q="third party")) == [600, 620]                                      # each word is found inside "Third-party" and inside "third party"
    assert ids(feed(http, q="third party review")) == [620]                                    # every word must be there: only 620 has "review"
    assert ids(feed(http, q="party RISK third")) == [600]                                      # in any order, across title and decision text
    assert ids(feed(http, q="VENDOR third")) == [600, 620]                                     # 600: "vendor" in its decision text, "third" in its title
    assert ids(feed(http, q="vendor")) == [600, 620]                                           # 600 by its decision text, 620 by its title
    assert ids(feed(http, q="الموافقة")) == [641]                                                # Arabic vowel marks do not hide the word
    assert ids(feed(http, q="موافقة على")) == [641]
    assert feed(http, q="nothing like this") == {"items": [], "total": 0, "limit": 50, "offset": 0}
    page = feed(http, q="vendor", limit=1, offset=1)
    assert ids(page) == [620] and page["total"] == 2                                          # the total is the matches, not the page
    assert feed(http, q="   ")["total"] == 8                                                   # blank search is no search


def test_filters_by_committee_outcome_status_of_committee_and_meeting_day(decided):
    _, http, _ = decided
    assert ids(feed(http, committee_id=2)) == [640, 641, 620]
    assert ids(feed(http, committee_id=1)) == [610, 611, 600, 601]
    assert feed(http, committee_id=90)["total"] == 0                                           # a committee of another tenant has no decisions here
    assert ids(feed(http, outcome="approved")) == [640, 600, 630]                              # any case, matched to the stored word
    assert ids(feed(http, outcome="NOTED")) == [641, 611]
    assert feed(http, outcome="Withdrawn")["total"] == 0
    assert ids(feed(http, is_active="false")) == [630] and 630 not in ids(feed(http, is_active="true"))
    assert feed(http, is_active="all")["total"] == feed(http)["total"] == 8
    assert http.get("/committees/decisions", params={"is_active": "sometimes"}).status_code == 422
    # meeting dates: from is the start of that day, to includes the whole day
    assert ids(feed(http, **{"from": "2026-11-01"})) == [640, 641, 610, 611]                   # 00:00:00 on the 1st is in, 23:59:59 on the 31st is out
    assert ids(feed(http, to="2026-10-31")) == [600, 601, 620, 630]                            # the whole of the 31st is in
    assert ids(feed(http, **{"from": "2026-10-31", "to": "2026-10-31"})) == [600, 601]
    assert feed(http, **{"from": "2026-11-05", "to": "2026-11-01"})["total"] == 0
    assert ids(feed(http, committee_id=1, outcome="Approved", **{"from": "2026-10-01"}, q="two changes")) == [600]


def test_the_route_is_not_taken_for_a_committee_id_and_needs_only_a_sign_in(decided):
    _, http, as_ = decided
    assert as_(OUTSIDER).get("/committees/decisions").status_code == 200           # user 6 has no role at all
    assert http.get("/committees/1").status_code == 200
    del http.headers["Authorization"]
    assert http.get("/committees/decisions").status_code == 401


# ── "assigned to me" and a due-date range on the actions ──────────────────────────────────────────────────────────────────────────────────────

def action_ids(http, **params):
    r = http.get("/committees/actions", params={"limit": 500, **params})
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()["items"]], r.json()["total"]


def test_assigned_to_me_is_the_caller_and_a_number_is_a_user(w):
    db, http, as_ = w
    add_action(db, 1, who=CHAIR)
    add_action(db, 2, who=SECRETARY)
    add_action(db, 3, who=CHAIR, status="completed")
    add_action(db, 4)
    assert action_ids(as_(CHAIR), assigned_to="me") == ([1, 3], 2)
    assert action_ids(as_(SECRETARY), assigned_to="me") == ([2], 1)
    assert action_ids(as_(MEMBER_A), assigned_to="me") == ([], 0)                       # nothing of theirs: an empty list, not everything
    assert action_ids(as_(CHAIR), assigned_to="ME") == ([1, 3], 2)
    assert action_ids(as_(CHAIR), assigned_to=str(SECRETARY)) == ([2], 1)              # a number works as it always did
    assert action_ids(as_(CHAIR), assigned_to="0")[1] == 4 and action_ids(as_(CHAIR), assigned_to="")[1] == 4      # as did "no filter"
    assert action_ids(as_(CHAIR), assigned_to="me", status="open") == ([1], 1)
    bad = as_(CHAIR).get("/committees/actions", params={"assigned_to": "everyone"})
    assert (bad.status_code, bad.json()["detail"]) == (422, "assigned_to must be a user id or me")


def test_status_takes_several_words(w):
    db, http, _ = w
    for aid, status in enumerate(("open", "in_progress", "completed", "overdue", "open"), start=1):
        add_action(db, aid, status=status)
    assert action_ids(http, status="open") == ([1, 5], 2)                                   # one word: as before
    assert action_ids(http, status="open,in_progress") == ([1, 2, 5], 3)
    assert action_ids(http, status=" in_progress , completed ,") == ([2, 3], 2)
    assert action_ids(http, status="")[1] == 5 and action_ids(http, status=",")[1] == 5     # nothing named: no filter


def test_the_due_range_is_exact_at_midnight(w):
    db, http, _ = w
    week = {1: datetime(2026, 11, 1, 23, 59, 59), 2: datetime(2026, 11, 2, 0, 0, 0), 3: datetime(2026, 11, 5, 12, 0, 0), 4: datetime(2026, 11, 8, 23, 59, 59),
            5: datetime(2026, 11, 9, 0, 0, 0), 6: None}
    for aid, due in week.items():
        add_action(db, aid, due=due)
    # this week, Monday 2 Nov to Sunday 8 Nov: a bare date is the whole calendar day, so the range names its first and its last day
    this_week = {"due_after": "2026-11-02", "due_before": "2026-11-08"}
    assert action_ids(http, **this_week) == ([2, 3, 4], 3)                              # 00:00:00 on the 2nd is in, 23:59:59 on the 1st is out, 23:59:59 on the 8th is in, 00:00:00 on the 9th is out
    assert action_ids(http, due_after="2026-11-02") == ([2, 3, 4, 5], 4)                  # no upper bound; the one with no date never matches a range
    assert action_ids(http, due_before="2026-11-01") == ([1], 1)                          # the whole of the 1st
    assert action_ids(http, due_before="2026-11-02") == ([1, 2], 2)                       # and the whole of the 2nd
    assert action_ids(http, due_after="2026-11-09", due_before="2026-11-09") == ([5], 1)  # one day
    assert action_ids(http, due_after="2026-11-08", due_before="2026-11-02") == ([], 0)  # a range that ends before it starts is empty, not an error
    # a date and time is that instant, included at both ends (as Task Management's own due_after / due_before are)
    assert action_ids(http, due_after="2026-11-02T00:00:01", due_before="2026-11-09")[0] == [3, 4, 5]
    assert action_ids(http, due_after="2026-11-05T12:00:00", due_before="2026-11-05T12:00:00") == ([3], 1)
    assert action_ids(http, due_after="2026-11-05T12:00:01", due_before="2026-11-08T23:59:58")[0] == []
    # an offset is converted to UTC: 05:00+05:00 is midnight UTC; so is a Z
    assert action_ids(http, due_after="2026-11-02T05:00:00+05:00", due_before="2026-11-09T04:59:59+05:00")[0] == [2, 3, 4]
    assert action_ids(http, due_after="2026-11-02T00:00:00Z", due_before="2026-11-08T23:59:59Z")[0] == [2, 3, 4]
    assert action_ids(http, due_after="2026-11-02T04:59:59+05:00")[0] == [1, 2, 3, 4, 5]
    assert action_ids(http, **this_week, status="open")[1] == 3                              # and it combines with the other filters
    for bad in ("yesterday", "2026-13-45", "11/02/2026", "2026-11-02T25:00:00"):
        r = http.get("/committees/actions", params={"due_after": bad})
        assert (r.status_code, r.json()["detail"]) == (422, "due_after must be a date (2026-11-02) or a date and time (2026-11-02T14:30:00)"), bad
    assert http.get("/committees/actions", params={"due_before": "soon"}).json()["detail"].startswith("due_before must be")


def test_the_due_range_is_exact_at_the_end_of_a_month_and_on_a_leap_day(w):
    db, http, _ = w
    for aid, due in enumerate((datetime(2026, 11, 30, 23, 59, 59), datetime(2026, 12, 1, 0, 0, 0), datetime(2028, 2, 29, 12, 0, 0), datetime(2028, 3, 1, 0, 0, 0),
                               datetime(2026, 12, 31, 23, 59, 59), datetime(2027, 1, 1)), start=1):
        add_action(db, aid, due=due)
    assert action_ids(http, due_after="2026-11-01", due_before="2026-11-30") == ([1], 1)                  # November: its last day is in, the first of December is out
    assert action_ids(http, due_after="2026-12-01", due_before="2026-12-31")[0] == [2, 5]                  # December: 31 Dec 23:59:59 is in, 1 Jan is out
    assert action_ids(http, due_after="2028-02-01", due_before="2028-02-29") == ([3], 1)                 # February of a leap year: the 29th is in
    assert action_ids(http, due_after="2028-02-01", due_before="2028-02-28") == ([], 0)                  # and a non-leap reading of it would lose it
    assert action_ids(http, due_after="2028-03-01", due_before="2028-03-01") == ([4], 1)
    assert action_ids(http, due_after="2027-01-01", due_before="2027-12-31")[0] == [6]
    # a lane that must be disjoint from "overdue": overdue_only is unchanged (due < now), so the next lane starts at now
    add_action(db, 10, due=datetime.utcnow() - timedelta(hours=2), cid=2)
    add_action(db, 11, due=datetime.utcnow() + timedelta(hours=2), cid=2)
    now = datetime.utcnow().isoformat()
    overdue = action_ids(http, committee_id=2, overdue_only="true")[0]
    upcoming = action_ids(http, committee_id=2, due_after=now, due_before=(datetime.utcnow() + 2 * DAY).isoformat())[0]
    assert overdue == [10] and upcoming == [11]


def test_equal_due_dates_page_in_a_stable_order(w):
    db, http, _ = w
    for aid in range(1, 8):
        add_action(db, aid, due=datetime(2026, 11, 3, 9, 0))
    add_action(db, 8)
    pages = [action_ids(http, limit=3, skip=skip)[0] for skip in (0, 3, 6)]
    assert pages == [[1, 2, 3], [4, 5, 6], [7, 8]]                  # by due date, ties by id, no due date last; each row once
    assert http.get("/committees/actions", params={"limit": 3, "skip": 3}).json()["total"] == 8


# ── the health fields ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

HEALTH = ("attendance_pct", "next_meeting", "charter_in_force", "meetings_in_progress")


def roll_rows(db, mid, marks):
    """marks: (user_id, status, role)"""
    for uid, status, role in marks:
        db.add(m.MeetingAttendance(tenant_id=1, meeting_id=mid, user_id=uid, status=status, role=role))
    db.commit()


def test_attendance_is_the_mean_of_held_meetings_of_the_last_year_with_a_roll(w):
    db, http, _ = w
    add_meeting(db, 100, 1, "completed", at(-30))
    roll_rows(db, 100, [(1, "present", "chair"), (2, "present", "secretary"), (3, "late", "member"), (4, "absent", "member"), (5, "present", "observer")])       # 3 of 4
    add_meeting(db, 101, 1, "completed", at(-60))
    roll_rows(db, 101, [(1, "late", "chair"), (2, "absent", "secretary")])                                                                                      # 1 of 2
    add_meeting(db, 102, 1, "completed", at(-400))
    roll_rows(db, 102, [(1, "absent", "chair"), (2, "absent", "secretary")])                                                                                    # too old
    add_meeting(db, 103, 1, "completed", at(-10))                                                                                                               # no roll
    add_meeting(db, 104, 1, "scheduled", at(5))
    roll_rows(db, 104, [(1, "present", "chair")])                                                                                                               # not held
    add_meeting(db, 105, 1, "in_progress", at(-1))
    roll_rows(db, 105, [(1, "present", "chair")])                                                                                                               # still running
    assert http.get("/committees/1").json()["attendance_pct"] == 62.5                  # (0.75 + 0.5) / 2: observers are not counted either way
    row = next(r for r in http.get("/committees/overview").json()["committees"] if r["id"] == 1)
    assert row["attendance_pct"] == 62.5
    # a meeting started and ended before its time is held all the same
    add_meeting(db, 107, 1, "completed", at(1))
    roll_rows(db, 107, [(1, "present", "chair"), (2, "present", "secretary")])
    assert http.get("/committees/1").json()["attendance_pct"] == 75.0                  # (0.75 + 0.5 + 1.0) / 3
    assert http.get("/committees/2").json()["attendance_pct"] is None                  # no meeting, no figure: never 0
    # only a roll of observers is no roll at all
    add_meeting(db, 106, 2, "completed", at(-5))
    roll_rows(db, 106, [(OUTSIDER, "present", "observer")])
    assert http.get("/committees/2").json()["attendance_pct"] is None


def test_next_meeting_is_the_earliest_scheduled_one_to_come_with_its_readiness(w):
    db, http, _ = w
    add_meeting(db, 110, 1, "scheduled", at(5), title="Later")
    add_meeting(db, 111, 1, "scheduled", at(2), title="Sooner")
    add_meeting(db, 112, 1, "cancelled", at(1))
    add_meeting(db, 113, 1, "scheduled", at(-1))                       # its date has passed and nobody closed it: not "next"
    add_meeting(db, 114, 1, "completed", at(3))
    add_meeting(db, 115, 1, "in_progress", at(1, 3))
    add_item(db, 1101, 111, 1)
    add_item(db, 1102, 111, 2)
    for n in range(3):
        db.add(m.MeetingAttachment(tenant_id=1, meeting_id=111, file_name=f"paper{n}.pdf", file_path=f"/tmp/paper{n}.pdf"))
    db.commit()
    one = http.get("/committees/1").json()
    assert one["next_meeting"] == {"id": 111, "date": at(2).isoformat(), "title": "Sooner", "has_agenda": True, "papers_count": 3, "invitees_count": 5}
    assert one["meetings_in_progress"] == 1
    assert next(r for r in http.get("/committees/overview").json()["committees"] if r["id"] == 1)["next_meeting"] == one["next_meeting"]
    assert http.get("/committees/2").json()["next_meeting"] is None and http.get("/committees/2").json()["meetings_in_progress"] == 0
    # the one before it has neither agenda nor papers
    db.query(m.CommitteeMeeting).filter_by(id=111).update({"status": "cancelled"})
    db.commit()
    assert http.get("/committees/1").json()["next_meeting"] == {"id": 110, "date": at(5).isoformat(), "title": "Later", "has_agenda": False, "papers_count": 0,
                                                                "invitees_count": 5}


def test_charter_in_force_is_the_active_unexpired_one_with_the_latest_effective_date(w):
    db, http, _ = w
    assert http.get("/committees/1").json()["charter_in_force"] is None
    expiry = at(200, 12)
    for cid, version, status, effective, expires in ((1, "0.9", "active", at(-300), at(-1)), (2, "3.0", "draft", at(-5), None), (3, "1.0", "active", at(-100), None),
                                                     (4, "2.0", "active", at(-10), expiry), (5, "1.5", "expired", at(-50), None)):
        db.add(m.CommitteeCharter(id=cid, tenant_id=1, committee_id=1, title=f"Charter {version}", version=version, status=status, effective_date=effective, expiry_date=expires))
    db.commit()
    assert http.get("/committees/1").json()["charter_in_force"] == {"id": 4, "version": "2.0", "expires_on": expiry.date().isoformat()}       # a date, not a timestamp
    db.query(m.CommitteeCharter).filter_by(id=4).update({"status": "draft"})
    db.commit()
    assert http.get("/committees/1").json()["charter_in_force"] == {"id": 3, "version": "1.0", "expires_on": None}
    assert next(r for r in http.get("/committees/overview").json()["committees"] if r["id"] == 1)["charter_in_force"] == {"id": 3, "version": "1.0", "expires_on": None}
    assert http.get("/committees/2").json()["charter_in_force"] is None


def test_the_action_counters_of_a_committee_match_its_overview_row(w):
    db, http, _ = w
    for aid, status, due in ((1, "open", at(3)), (2, "open", at(-3)), (3, "in_progress", at(-1)), (4, "in_progress", at(4)), (5, "completed", at(-9)),
                             (6, "overdue", None), (7, "open", None)):
        add_action(db, aid, status=status, due=due)
    add_action(db, 8, status="open", due=at(-5), cid=2)
    one = http.get("/committees/1").json()
    assert (one["open_actions"], one["in_progress_actions"], one["overdue_actions"]) == (3, 2, 3)      # overdue: 2 and 3 past due, and 6 stored as such
    row = next(r for r in http.get("/committees/overview").json()["committees"] if r["id"] == 1)
    assert (row["open_actions"], row["in_progress_actions"], row["overdue_actions"]) == (3, 2, 3)
    assert (http.get("/committees/2").json()["open_actions"], http.get("/committees/2").json()["overdue_actions"]) == (1, 1)


def test_a_committee_of_forty_members_and_one_with_none_and_an_inactive_one(w):
    db, http, _ = w
    for uid in range(100, 140):
        db.add(m.GRCUser(id=uid, username=f"big{uid}", email=f"big{uid}@bank.test", display_name=f"Big {uid}", is_active=True))
    db.commit()
    add_committee(db, 6, "Forty", [(uid, "member") for uid in range(100, 140)])
    add_committee(db, 7, "Nobody")
    add_committee(db, 8, "Retired", [(CHAIR, "chair")], active=False)
    add_meeting(db, 120, 6, "scheduled", at(4))
    add_meeting(db, 121, 8, "scheduled", at(6))
    forty = http.get("/committees/6").json()
    assert len(forty["members"]) == 40 and forty["next_meeting"]["invitees_count"] == 40
    nobody = http.get("/committees/7").json()
    assert all(nobody[k] in (None, 0) for k in HEALTH) and (nobody["open_actions"], nobody["in_progress_actions"], nobody["overdue_actions"]) == (0, 0, 0)
    retired = http.get("/committees/8").json()
    assert retired["is_active"] is False and retired["next_meeting"]["id"] == 121 and retired["next_meeting"]["invitees_count"] == 1
    rows = {r["id"]: r for r in http.get("/committees/overview").json()["committees"]}
    for cid in (1, 2, 6, 7, 8):
        assert {k: rows[cid][k] for k in HEALTH} == {k: http.get(f"/committees/{cid}").json()[k] for k in HEALTH}, cid       # one definition, two places


def test_the_old_overview_fields_and_the_kpis_are_where_they_were(w):
    db, http, _ = w
    add_meeting(db, 130, 1, "completed", at(-10))
    add_meeting(db, 131, 1, "scheduled", at(3))
    add_action(db, 1, status="open", due=at(-1))
    overview = http.get("/committees/overview").json()
    row = next(r for r in overview["committees"] if r["id"] == 1)
    for key in ("id", "name", "committee_type", "is_active", "members_count", "next_meeting_date", "last_meeting", "open_actions", "in_progress_actions",
                "overdue_actions", "completed_actions", "total_actions"):
        assert key in row, key
    assert row["next_meeting_date"] == at(3).isoformat() and row["last_meeting"]["status"] == "completed" and row["members_count"] == 5
    assert set(overview) == {"kpis", "committees", "upcoming_meetings", "top_performers", "progress_over_time"}
    assert {"total_committees", "active_committees", "meetings_upcoming", "meetings_completed", "meetings_this_quarter", "actions", "avg_attendance_pct", "quorum_met",
            "quorum_meetings", "quorum_met_rate_pct", "charters_active", "performance"} <= set(overview["kpis"])


def test_no_key_the_screens_read_was_removed_or_renamed(w):
    """The documents these routes always returned keep every key they had; the new ones only add."""
    db, http, _ = w
    add_meeting(db, 125, 1, "scheduled", at(2))
    add_item(db, 1250, 125, 1)
    add_action(db, 125)
    meeting_keys = {"id", "tenant_id", "committee_id", "committee_name", "meeting_number", "title", "meeting_type", "scheduled_date", "location", "virtual_link",
                    "status", "quorum_required", "quorum_present", "created_by", "creator_name", "created_at", "agenda_item_count", "action_count", "has_minutes"}
    assert meeting_keys <= set(http.get("/committees/1/meetings").json()["items"][0])
    assert meeting_keys | {"agenda_items", "minutes"} <= set(http.get("/committees/meetings/125").json())
    assert meeting_keys <= set(http.put("/committees/meetings/125", json={"location": "Board room"}).json())
    committee_keys = {"id", "tenant_id", "name", "description", "committee_type", "chair_id", "chair_name", "secretary_id", "secretary_name", "meeting_frequency",
                      "is_active", "created_at", "updated_at", "member_count", "meeting_count", "pending_actions_count"}
    assert committee_keys | {"members", "charters"} <= set(http.get("/committees/1").json())
    assert committee_keys <= set(http.get("/committees").json()["items"][0])               # the list is not given the health strip: it would cost a query per row
    assert not {"attendance_pct", "next_meeting"} & set(http.get("/committees").json()["items"][0])
    agenda_keys = {"id", "tenant_id", "meeting_id", "item_number", "title", "description", "item_type", "presenter_id", "presenter_name", "linked_document_id",
                   "linked_document_title", "linked_risk_id", "linked_risk_title", "linked_regulatory_change_id", "linked_regulatory_change_title",
                   "time_allocated_minutes", "status", "outcome", "decision_made"}
    assert agenda_keys <= set(http.get("/committees/meetings/125/agenda").json()[0])
    assert {"items", "total", "skip", "limit"} <= set(http.get("/committees/actions").json())
    assert {"id", "action_number", "title", "assigned_to", "assignee_name", "due_date", "status", "priority", "sla", "is_overdue"} <= set(http.get("/committees/actions").json()["items"][0])


# ── readiness on the meeting rows ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_meeting_rows_carry_readiness_and_quorum_and_agree_with_the_meeting(w):
    db, http, _ = w
    add_meeting(db, 140, 1, "scheduled", at(2))
    add_item(db, 1401, 140, 1)
    add_item(db, 1402, 140, 2)
    db.add(m.MeetingAttachment(tenant_id=1, meeting_id=140, file_name="paper.pdf", file_path="/tmp/paper.pdf"))
    db.add(m.OversightAction(tenant_id=1, committee_id=1, meeting_id=140, title="Follow up", status="open"))
    add_meeting(db, 141, 1, "completed", at(-5), quorum=2)
    db.add(m.MeetingMinutes(tenant_id=1, meeting_id=141, content="Minutes"))
    roll_rows(db, 141, [(1, "present", "chair"), (2, "late", "secretary")])
    db.query(m.CommitteeMeeting).filter_by(id=141).update({"quorum_present": 2})
    db.commit()
    rows = {r["id"]: r for r in http.get("/committees/1/meetings").json()["items"]}
    assert (rows[140]["agenda_item_count"], rows[140]["action_count"], rows[140]["papers_count"], rows[140]["invitees_count"], rows[140]["has_minutes"],
            rows[140]["quorum_met"]) == (2, 1, 1, 5, False, None)
    assert (rows[141]["agenda_item_count"], rows[141]["papers_count"], rows[141]["has_minutes"], rows[141]["quorum_present"], rows[141]["quorum_met"]) == (0, 0, True, 2, True)
    for mid, row in rows.items():
        one = http.get(f"/committees/meetings/{mid}").json()
        assert all(one[k] == row[k] for k in row), mid                                    # the list and the meeting say the same
    assert set(http.get("/committees/meetings/140").json()) >= {"agenda_items", "minutes", "papers_count", "invitees_count", "quorum_met"}


def test_a_page_of_meetings_costs_the_same_few_queries_however_long_it_is(w):
    db, http, _ = w
    counted = []
    event.listen(db.get_bind(), "before_cursor_execute", lambda *a, **k: counted.append(1))

    def queries(limit):
        counted.clear()
        assert http.get("/committees/1/meetings", params={"limit": limit}).status_code == 200
        return len(counted)

    http.get("/committees/1/meetings")                      # the first request of a session does its sign-in bookkeeping once
    for mid in range(150, 153):
        add_meeting(db, mid, 1, "scheduled", at(mid - 140))
    few = queries(50)
    for mid in range(153, 183):
        add_meeting(db, mid, 1, "scheduled", at(mid - 140))
        add_item(db, mid * 10, mid, 1)
    many = queries(50)
    assert (few, many) == (many, many) and many <= 12


# ── nothing about who may do what moved ──────────────────────────────────────────────────────────────────────────────────────────────────────

BEFORE = [
    ('DELETE', '/committees/meetings/agenda/{item_id}'), ('DELETE', '/committees/meetings/attachments/{attachment_id}'), ('DELETE', '/committees/{committee_id}'),
    ('DELETE', '/committees/{committee_id}/charters/{charter_id}'), ('DELETE', '/committees/{committee_id}/members/{user_id}'), ('GET', '/committees'),
    ('GET', '/committees/actions'), ('GET', '/committees/charters/{charter_id}/download'), ('GET', '/committees/dashboard'),
    ('GET', '/committees/meetings/agenda/{item_id}/votes'), ('GET', '/committees/meetings/attachments/{attachment_id}/download'),
    ('GET', '/committees/meetings/{meeting_id}'), ('GET', '/committees/meetings/{meeting_id}/agenda'), ('GET', '/committees/meetings/{meeting_id}/attachments'),
    ('GET', '/committees/meetings/{meeting_id}/suggested-agenda-items'), ('GET', '/committees/overview'), ('GET', '/committees/{committee_id}'),
    ('GET', '/committees/{committee_id}/charters'), ('GET', '/committees/{committee_id}/meetings'), ('GET', '/committees/{committee_id}/members'),
    ('PATCH', '/committees/actions/{action_id}'), ('POST', '/committees'), ('POST', '/committees/actions/ai/reword'), ('POST', '/committees/actions/ai/summary'),
    ('POST', '/committees/actions/manual'), ('POST', '/committees/meetings/agenda/{item_id}/votes'), ('POST', '/committees/meetings/{meeting_id}/actions'),
    ('POST', '/committees/meetings/{meeting_id}/agenda'), ('POST', '/committees/meetings/{meeting_id}/agenda/upload-parse'),
    ('POST', '/committees/meetings/{meeting_id}/attachments'), ('POST', '/committees/meetings/{meeting_id}/auto-populate-agenda'),
    ('POST', '/committees/meetings/{meeting_id}/minutes'), ('POST', '/committees/meetings/{meeting_id}/minutes/upload'),
    ('POST', '/committees/{committee_id}/ai-compare-charter'), ('POST', '/committees/{committee_id}/ai-generate-charter'), ('POST', '/committees/{committee_id}/charters'),
    ('POST', '/committees/{committee_id}/charters/upload-new'), ('POST', '/committees/{committee_id}/charters/{charter_id}/upload'),
    ('POST', '/committees/{committee_id}/deactivate'), ('POST', '/committees/{committee_id}/meetings'), ('POST', '/committees/{committee_id}/members'),
    ('POST', '/committees/{committee_id}/reactivate'), ('PUT', '/committees/charters/{charter_id}'), ('PUT', '/committees/meetings/agenda/{item_id}'),
    ('PUT', '/committees/meetings/minutes/{minutes_id}'), ('PUT', '/committees/meetings/{meeting_id}'), ('PUT', '/committees/{committee_id}'),
]
NEW = [
    ('GET', '/committees/decisions'), ('GET', '/committees/meetings/{meeting_id}/attendance'), ('POST', '/committees/meetings/{meeting_id}/start'),
    ('POST', '/committees/meetings/{meeting_id}/end'), ('PUT', '/committees/meetings/{meeting_id}/attendance'), ('PUT', '/committees/meetings/agenda/{item_id}/outcome'),
]


def served():
    out = {}
    for route in committees.router.routes:
        if isinstance(route, APIRoute):
            names = [d.call.__qualname__ for d in route.dependant.dependencies]
            for method in route.methods:
                out[(method, route.path)] = names
    return out


def test_every_route_it_had_is_still_served_and_exactly_six_were_added():
    routes = served()
    assert sorted(BEFORE) == sorted(set(BEFORE))
    assert set(BEFORE) <= set(routes)                                     # none removed or renamed
    assert set(routes) - set(BEFORE) == set(NEW)


def test_the_only_routes_that_ask_for_a_permission_are_the_two_that_always_did():
    routes = served()
    asking = {key for key, names in routes.items() if any(n.startswith("require_tenant_permission") for n in names)}
    assert asking == {('POST', '/committees/{committee_id}/deactivate'), ('POST', '/committees/{committee_id}/reactivate')}
    for key in NEW:
        assert any(n == "require_auth" for n in routes[key]) and not any("permission" in n for n in routes[key]), key      # a sign-in, like every committee write
    assert all(any(n == "require_auth" for n in names) for names in routes.values())


def test_a_signed_in_user_with_no_role_can_use_every_new_call_as_with_every_committee_write(w):
    db, http, _ = w
    add_meeting(db, 200, 1, "scheduled", at(1))
    add_item(db, 2000, 200, 1)
    assert db.query(m.UserRole).filter_by(user_id=1).count() == 0                      # user 1 holds no role
    assert http.get("/committees/decisions").status_code == 200
    assert http.get("/committees/actions", params={"assigned_to": "me", "due_after": "2026-01-01"}).status_code == 200
    assert http.post("/committees/meetings/200/start").status_code == 200
    assert http.get("/committees/meetings/200/attendance").status_code == 200
    assert http.put("/committees/meetings/200/attendance", json={"members": [{"user_id": 1, "status": "present"}]}).status_code == 200
    assert http.put("/committees/meetings/agenda/2000/outcome", json={"outcome": "Noted"}).status_code == 200
    assert http.post("/committees/meetings/200/end").status_code == 200
    # and the call that asks for a right still does
    assert http.post("/committees/1/deactivate").status_code == 403


# ── the audit row ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path,expected", [
    ("/grc/governance/committees/meetings/5/start", "start"),
    ("/grc/governance/committees/meetings/5/end", "end"),
    ("/governance/committees/meetings/5/end", "end"),
    ("/grc/governance/reviews/5/start", None),                  # other modules' /start and /end keep logging what they always did
    ("/grc/erm/rcsa/assessments/5/start", None),
    ("/grc/vendor-risk/tpra/engagements/5/end", None),
    ("/grc/governance/committees/5/meetings", None),
])
def test_start_and_end_are_sub_actions_only_of_a_committee_meeting(path, expected):
    assert audit_logger._extract_sub_action(path) == expected
    assert audit_logger._action_from_method("POST", 200, path) == (expected or "create")


def test_audit_logs_describe_a_meeting_start_by_its_label_and_an_assessment_start_as_before():
    from grc.routers.admin_router import _generate_audit_description as describe

    assert describe("start", "committees", None, "/grc/governance/committees/meetings/5/start", None, "Start Meeting") == "Start Meeting"
    assert describe("end", "committees", None, "/grc/governance/committees/meetings/5/end", None, "End Meeting") == "End Meeting"
    assert describe("start_failed", "committees", None, "/grc/governance/committees/meetings/5/start", None, "Start Meeting") == "Failed: Start Meeting"
    assert describe("start", "rcsa", 7, "/grc/erm/rcsa/assessments/7/start", None, "Start Assessment") == "Started assessment #7"      # not touched


def test_the_audit_rows_name_the_action_the_label_and_what_changed(w, monkeypatch):
    from grc import db as grc_db

    db, http, _ = w
    catalog._record_endpoint_labels(http.app)                 # what grc.main does for the whole app
    bind = db.get_bind()
    monkeypatch.setattr(grc_db, "open_tenant_session", lambda slug: Session(bind))
    monkeypatch.setattr(audit_logger, "_resolve_tenant_slug", lambda request, tenant_id: "bank")
    add_meeting(db, 210, 1, "scheduled", at(1))
    add_item(db, 2100, 210, 1)

    def audit(method, path, call, endpoint, body=None):
        token = audit_changes.start()
        call()
        changes = audit_changes.finish(token)
        scope = {"type": "http", "method": method, "path": path, "headers": [], "query_string": b"", "endpoint": endpoint, "state": {"tenant_id": 1}}
        audit_logger.write_audit_log(Request(scope), Response(status_code=200), time.time(), body, None, changes)
        return changes

    started = audit("POST", "/grc/governance/committees/meetings/210/start", lambda: http.post("/committees/meetings/210/start"), committees.start_meeting)
    marked = audit("PUT", "/grc/governance/committees/meetings/210/attendance",
                   lambda: http.put("/committees/meetings/210/attendance", json={"members": [{"user_id": CHAIR, "status": "present"}]}), committees.record_roll_call)
    decided_ = audit("PUT", "/grc/governance/committees/meetings/agenda/2100/outcome",
                     lambda: http.put("/committees/meetings/agenda/2100/outcome", json={"outcome": "Approved", "decision_made": "Yes"}), committees.record_agenda_outcome)
    ended = audit("POST", "/grc/governance/committees/meetings/210/end", lambda: http.post("/committees/meetings/210/end"), committees.end_meeting)

    meeting = lambda changes: next(r for r in changes["records"] if r["table"] == "grc_committee_meetings")      # noqa: E731
    assert meeting(started)["fields"]["status"] == ["scheduled", "in_progress"] and meeting(ended)["fields"]["status"] == ["in_progress", "completed"]
    assert meeting(marked)["fields"]["quorum_present"] == [None, 1]
    assert sum(1 for r in marked["records"] if r["table"] == "grc_meeting_attendance" and r["op"] == "created") == 5      # the marked member and the four recorded absent
    item = next(r for r in decided_["records"] if r["table"] == "grc_meeting_agenda_items")
    assert item["fields"]["outcome"] == [None, "Approved"] and item["fields"]["status"] == ["pending", "discussed"]

    rows = db.query(m.AuditLog).order_by(m.AuditLog.id).all()
    assert [r.action for r in rows] == ["start", "update", "update", "end"]            # not "create": a workflow on "committee created" must not fire
    assert [r.changes["feature"] for r in rows] == ["Start Meeting", "Record Roll Call", "Record Agenda Outcome", "End Meeting"]
    assert all((r.changes["module"], r.changes["submodule"]) == ("Governance", "Committees") for r in rows)
    assert rows[0].changes["summary"].startswith("Started ") and rows[3].changes["summary"].startswith("Ended ")
    assert rows[0].changes["db_changes"] == started and rows[3].changes["db_changes"] == ended
