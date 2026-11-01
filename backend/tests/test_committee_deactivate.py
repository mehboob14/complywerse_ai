"""Deactivating and reactivating a committee: the reversible way to retire one (the screens have no Delete).

Deactivate sets is_active false and removes NOTHING (members, charters, meetings, agendas, votes, minutes, actions and their Task Management
copies stay, open actions and scheduled meetings as they are); while it is off a meeting, an action or a member cannot be added (400); both
calls need governance:committees:delete (enforced on the server, administrators hold it); an audit-register extension request waiting at one of
its meetings blocks it (409). The hard DELETE of a committee, and of an agenda item, answers 409 instead of a bare 500 when a vote or an
extension request points at it and then removes nothing. Over HTTP through the committees router, real tokens and roles, on in-memory SQLite.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import sqlite3  # noqa: E402
import time  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.exc import IntegrityError  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402
from starlette.requests import Request  # noqa: E402
from starlette.responses import Response  # noqa: E402

import grc.models as m  # noqa: E402
from grc import audit_changes  # noqa: E402
from grc.modules.governance.routers import committees  # noqa: E402
from grc.modules.issue_management.audit_register import workflow  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

PLAIN, ADMIN, HOLDER, EDITOR = 1, 2, 3, 4
REFUSED = "This committee is inactive: reactivate it first"
NEXT_WEEK = datetime.utcnow() + timedelta(days=7)


def seed_committee(db, cid, name, ctype="custom", *, vote=False):
    """A committee with everything a committee can hold: a member, a charter, a scheduled meeting with an agenda item (and a vote), minutes."""
    db.add(m.GovernanceCommittee(id=cid, tenant_id=1, name=name, committee_type=ctype, chair_id=PLAIN))
    db.add(m.CommitteeMember(tenant_id=1, committee_id=cid, user_id=PLAIN, role="chair"))
    db.add(m.CommitteeMember(tenant_id=1, committee_id=cid, user_id=EDITOR, role="member"))
    db.add(m.CommitteeCharter(tenant_id=1, committee_id=cid, title=f"{name} charter", status="active"))
    db.add(m.CommitteeMeeting(id=cid * 10, tenant_id=1, committee_id=cid, title=f"{name} meeting", scheduled_date=NEXT_WEEK, status="scheduled"))
    db.add(m.MeetingAgendaItem(id=cid * 10, tenant_id=1, meeting_id=cid * 10, item_number=1, title="Approve the plan"))
    db.add(m.MeetingMinutes(tenant_id=1, meeting_id=cid * 10, content="Minutes"))
    if vote:
        db.add(m.MeetingAgendaItemVote(tenant_id=1, agenda_item_id=cid * 10, user_id=PLAIN, vote="agreed"))
    db.commit()


@pytest.fixture(scope="module")
def schema():
    """The empty schema, built once for the file (create_all takes ~2 s) and copied into each test's own in-memory database."""
    source = sqlite3.connect(":memory:", check_same_thread=False)
    m.Base.metadata.create_all(create_engine("sqlite://", creator=lambda: source, poolclass=StaticPool))
    yield source
    source.close()


@pytest.fixture
def w(schema):
    copy = sqlite3.connect(":memory:", check_same_thread=False)
    schema.backup(copy)
    engine = create_engine("sqlite://", creator=lambda: copy, poolclass=StaticPool)
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Bank", slug="bank", primary_contact_email="boss@bank.test"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (HOLDER, "holder"), (EDITOR, "editor")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@bank.test", display_name=name.title(), is_active=True))
    db.add(m.Role(id=1, tenant_id=1, name="Administrator"))
    db.add(m.Role(id=2, tenant_id=1, name="Committee removers"))
    db.add(m.Role(id=3, tenant_id=1, name="Committee editors"))
    for pid, action in [(1, "delete"), (2, "create"), (3, "view")]:
        db.add(m.Permission(id=pid, name=f"governance:committees:{action}", resource="governance:committees", action=action))
    db.add(m.RolePermission(role_id=2, permission_id=1))
    db.add(m.RolePermission(role_id=3, permission_id=2))
    db.add(m.RolePermission(role_id=3, permission_id=3))
    db.add(m.UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    db.add(m.UserRole(user_id=HOLDER, role_id=2, tenant_id=1))
    db.add(m.UserRole(user_id=EDITOR, role_id=3, tenant_id=1))
    db.commit()
    seed_committee(db, 1, "Audit Committee", "audit_committee")
    seed_committee(db, 2, "Risk Committee", "risk_committee")
    app = FastAPI()
    app.include_router(committees.router)
    app.dependency_overrides[m.get_db] = lambda: db
    http = TestClient(app)

    def as_(uid):
        http.headers["Authorization"] = "Bearer " + create_access_token(
            {"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "bank", "tenant_id": 1})
        return http

    yield db, as_
    db.close()


def held(db, cid):
    """Every record a committee holds, counted (and the Task Management copies of its actions)."""
    meetings = [x.id for x in db.query(m.CommitteeMeeting.id).filter_by(committee_id=cid)]
    items = [x.id for x in db.query(m.MeetingAgendaItem.id).filter(m.MeetingAgendaItem.meeting_id.in_(meetings))]
    return {
        "members": db.query(m.CommitteeMember).filter_by(committee_id=cid).count(),
        "charters": db.query(m.CommitteeCharter).filter_by(committee_id=cid).count(),
        "meetings": len(meetings),
        "agenda": len(items),
        "votes": db.query(m.MeetingAgendaItemVote).filter(m.MeetingAgendaItemVote.agenda_item_id.in_(items)).count(),
        "minutes": db.query(m.MeetingMinutes).filter(m.MeetingMinutes.meeting_id.in_(meetings)).count(),
        "actions": db.query(m.OversightAction).filter_by(committee_id=cid).count(),
        "twins": db.query(m.CriticalTask).filter_by(source_module="committees").count(),
    }


def new_action(http, cid, **fields):
    made = http.post("/committees/actions/manual", json={"committee_id": cid, "title": "Review the policy", **fields})
    assert made.status_code == 201, made.text
    return made.json()


# ── Deactivate keeps everything, and is reversible ───────────────────────────────────────────────────────────────────────────────────────────────

def test_deactivate_removes_nothing_and_reactivate_brings_it_back(w):
    db, as_ = w
    http = as_(ADMIN)
    open_one = new_action(http, 1, priority="high")
    done = new_action(http, 1)
    assert http.patch(f"/committees/actions/{done['id']}", json={"status": "completed"}).status_code == 200
    before = held(db, 1)
    assert before == {"members": 2, "charters": 1, "meetings": 1, "agenda": 1, "votes": 0, "minutes": 1, "actions": 2, "twins": 2}
    other = held(db, 2)

    off = http.post("/committees/1/deactivate")
    assert off.status_code == 200 and off.json()["is_active"] is False and off.json()["id"] == 1
    db.expire_all()
    assert held(db, 1) == before                                   # not one child row, not one Task Management copy
    assert held(db, 2) == other                                    # and nothing of another committee
    assert db.get(m.GovernanceCommittee, 1).is_active is False
    # open actions and scheduled meetings stay exactly as they were
    assert db.get(m.OversightAction, open_one["id"]).status == "open"
    assert db.get(m.CommitteeMeeting, 10).status == "scheduled"
    assert http.get("/committees/1").json()["pending_actions_count"] == 1       # still counted, still readable
    assert len(http.get("/committees/1/members").json()) == 2
    assert http.get("/committees/1/meetings").json()["total"] == 1

    # again: nothing to do, and no harm
    assert http.post("/committees/1/deactivate").json()["is_active"] is False

    on = http.post("/committees/1/reactivate")
    assert on.status_code == 200 and on.json()["is_active"] is True
    db.expire_all()
    assert held(db, 1) == before and db.get(m.GovernanceCommittee, 1).is_active is True
    assert http.post("/committees/1/reactivate").json()["is_active"] is True    # reactivating an active one is a no-op too


def test_an_unknown_committee_is_a_404_for_whoever_may_ask(w):
    _db, as_ = w
    http = as_(ADMIN)
    assert http.post("/committees/99/deactivate").status_code == 404
    assert http.post("/committees/99/reactivate").status_code == 404


# ── the lists ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_default_list_hides_an_inactive_committee_and_all_shows_it(w):
    _db, as_ = w
    http = as_(ADMIN)
    names = lambda params="": {c["name"] for c in http.get("/committees" + params).json()["items"]}   # noqa: E731
    assert names() == {"Audit Committee", "Risk Committee"}
    http.post("/committees/1/deactivate")

    assert names() == {"Risk Committee"}                           # the default, as ever: active only
    assert names("?is_active=true") == {"Risk Committee"}
    assert names("?is_active=false") == {"Audit Committee"}
    assert names("?is_active=0") == {"Audit Committee"}            # every word the old boolean took still means what it meant
    assert names("?is_active=all") == {"Audit Committee", "Risk Committee"}
    total = http.get("/committees?is_active=all&limit=1").json()
    assert total["total"] == 2 and len(total["items"]) == 1       # the total is true however the page is cut
    assert http.get("/committees?is_active=nonsense").status_code == 422

    http.post("/committees/1/reactivate")
    assert names() == {"Audit Committee", "Risk Committee"}        # reactivated: back in the pickers


def test_a_null_is_active_counts_as_active_everywhere_it_is_read(w):
    db, as_ = w
    http = as_(ADMIN)
    db.query(m.GovernanceCommittee).filter_by(id=2).update({"is_active": None})
    db.commit()
    assert {c["name"] for c in http.get("/committees").json()["items"]} == {"Audit Committee", "Risk Committee"}
    assert http.get("/committees?is_active=false").json()["total"] == 0
    assert http.get("/committees/2").json()["is_active"] is True
    rows = {r["id"]: r["is_active"] for r in http.get("/committees/overview").json()["committees"]}
    assert rows == {1: True, 2: True}
    assert http.get("/committees/overview").json()["kpis"]["active_committees"] == 2
    assert http.post("/committees/2/deactivate").json()["is_active"] is False


# ── an inactive committee takes nothing new ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_inactive_committee_refuses_a_new_meeting_action_or_member_until_reactivated(w):
    db, as_ = w
    http = as_(ADMIN)
    existing = new_action(http, 1)
    http.post("/committees/1/deactivate")
    before = held(db, 1)

    def attempts():
        return [
            http.post("/committees/1/meetings", json={"title": "Extra", "scheduled_date": NEXT_WEEK.isoformat()}),
            http.post("/committees/actions/manual", json={"committee_id": 1, "title": "More work"}),
            http.post("/committees/meetings/10/actions", json={"title": "From the meeting"}),
            http.post("/committees/1/members", json={"user_id": HOLDER, "role": "member"}),
        ]

    for refused in attempts():
        assert (refused.status_code, refused.json()["detail"]) == (400, REFUSED), refused.text
    db.expire_all()
    assert held(db, 1) == before                                   # nothing was written

    # what is already there stays workable: an action can be closed, an agenda item edited, everything read
    assert http.patch(f"/committees/actions/{existing['id']}", json={"status": "completed"}).status_code == 200
    assert http.get("/committees/1/meetings").status_code == 200

    http.post("/committees/1/reactivate")
    assert [r.status_code for r in attempts()] == [201, 201, 201, 201]
    db.expire_all()
    assert held(db, 1)["meetings"] == 2 and held(db, 1)["members"] == 3 and held(db, 1)["actions"] == 3


# ── the right to do it is checked on the server ──────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("path", ["/committees/1/deactivate", "/committees/1/reactivate"])
@pytest.mark.parametrize("who", [PLAIN, EDITOR])
def test_without_governance_committees_delete_both_calls_are_refused(w, path, who):
    db, as_ = w
    http = as_(who)
    r = http.post(path)
    assert (r.status_code, r.json()["detail"]) == (403, "Permission denied"), r.text
    db.expire_all()
    assert db.get(m.GovernanceCommittee, 1).is_active is True      # and nothing changed
    as_(ADMIN).post("/committees/1/deactivate")
    assert as_(who).post("/committees/1/reactivate").status_code == 403
    assert db.get(m.GovernanceCommittee, 1).is_active is False


@pytest.mark.parametrize("who", [ADMIN, HOLDER])
def test_an_administrator_or_a_holder_of_the_right_may_deactivate_and_reactivate(w, who):
    db, as_ = w
    http = as_(who)
    assert http.post("/committees/1/deactivate").json()["is_active"] is False
    assert http.post("/committees/1/reactivate").json()["is_active"] is True


def test_the_other_committee_routes_keep_the_rights_they_had(w):
    """Not this change's to move (the permission pass is separate): a plain signed-in user still edits and reads a committee as before."""
    _db, as_ = w
    http = as_(PLAIN)
    assert http.get("/committees/1").status_code == 200
    assert http.put("/committees/1", json={"description": "Oversees internal audit"}).status_code == 200


# ── the audit row ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_the_audit_row_carries_is_active_old_to_new_and_the_dedicated_label(w, monkeypatch):
    from grc import audit_logger, db as grc_db
    from grc.modules.workflow_engine.services import catalog

    db, as_ = w
    http = as_(ADMIN)
    catalog._record_endpoint_labels(http.app)                      # what grc.main does for the whole app: the words each route's audit row uses
    bind = db.get_bind()
    monkeypatch.setattr(grc_db, "open_tenant_session", lambda slug: Session(bind))
    monkeypatch.setattr(audit_logger, "_resolve_tenant_slug", lambda request, tenant_id: "bank")

    def audit(path, call, endpoint):
        token = audit_changes.start()
        call()
        changes = audit_changes.finish(token)
        scope = {"type": "http", "method": "POST", "path": path, "headers": [], "query_string": b"", "endpoint": endpoint, "state": {"tenant_id": 1}}
        audit_logger.write_audit_log(Request(scope), Response(status_code=200), time.time(), None, None, changes)
        return changes

    off = audit("/grc/governance/committees/1/deactivate", lambda: http.post("/committees/1/deactivate"), committees.deactivate_committee)
    on = audit("/grc/governance/committees/1/reactivate", lambda: http.post("/committees/1/reactivate"), committees.reactivate_committee)

    committee = lambda changes: next(r for r in changes["records"] if r["table"] == "grc_governance_committees")   # noqa: E731
    assert committee(off)["fields"]["is_active"] == [True, False] and committee(on)["fields"]["is_active"] == [False, True]
    assert committee(off)["id"] == 1 and committee(off)["name"] == "Audit Committee"

    deactivated, reactivated = db.query(m.AuditLog).order_by(m.AuditLog.id).all()
    assert (deactivated.action, reactivated.action) == ("deactivate", "reactivate")      # not "create": a workflow on "committee created" must not fire
    assert deactivated.changes["feature"] == "Deactivate Committee" and reactivated.changes["feature"] == "Reactivate Committee"
    assert (deactivated.changes["module"], deactivated.changes["submodule"]) == ("Governance", "Committees")
    assert deactivated.changes["db_changes"] == off and reactivated.changes["db_changes"] == on
    assert deactivated.changes["summary"].startswith("Deactivated ")


# ── the hard delete answers 409, not 500, and removes nothing ─────────────────────────────────────────────────────────────────────────────────

def test_a_vote_makes_the_committee_delete_a_409_that_removes_nothing(w):
    db, as_ = w
    seed_committee(db, 3, "Board", "board", vote=True)
    http = as_(ADMIN)
    new_action(http, 3)
    before = held(db, 3)
    assert before["votes"] == 1 and before["twins"] == 1

    r = http.delete("/committees/3")
    assert (r.status_code, r.json()["detail"]) == (409, "A vote was cast on an agenda item. Deactivate the committee instead")
    db.expire_all()
    assert held(db, 3) == before and db.get(m.GovernanceCommittee, 3) is not None   # not even the Task Management copy
    assert http.post("/committees/3/deactivate").status_code == 200                  # which is what the message points to


def test_a_committee_nobody_voted_in_is_still_deleted_with_everything_it_holds(w):
    db, as_ = w
    http = as_(ADMIN)
    new_action(http, 1)
    new_action(http, 2)
    assert http.delete("/committees/1").status_code == 204
    db.expire_all()
    assert db.get(m.GovernanceCommittee, 1) is None
    assert held(db, 1) == {"members": 0, "charters": 0, "meetings": 0, "agenda": 0, "votes": 0, "minutes": 0, "actions": 0, "twins": 1}
    assert held(db, 2)["actions"] == 1                              # the other committee's action and copy are untouched
    assert http.delete("/committees/1").status_code == 404


@pytest.mark.parametrize("status", ["requested", "approved", "rejected", "withdrawn"])
def test_an_audit_extension_request_at_a_meeting_blocks_the_hard_delete(w, status):
    db, as_ = w
    db.add(m.AuditExtensionRequest(tenant_id=1, issue_id=5, requested_date=datetime.utcnow().date(), reason="Contract slipped", status=status, meeting_id=10))
    db.commit()
    http = as_(ADMIN)
    before = held(db, 1)
    r = http.delete("/committees/1")
    assert (r.status_code, r.json()["detail"]) == (409, "An audit extension request points at a meeting of this committee. Deactivate the committee instead")
    db.expire_all()
    assert held(db, 1) == before and db.get(m.GovernanceCommittee, 1) is not None


def test_a_request_on_an_agenda_item_alone_blocks_it_too(w):
    db, as_ = w
    db.add(m.AuditExtensionRequest(tenant_id=1, issue_id=5, requested_date=datetime.utcnow().date(), reason="x", status="approved", agenda_item_id=10))
    db.commit()
    assert as_(ADMIN).delete("/committees/1").status_code == 409


def test_if_the_database_still_refuses_the_delete_it_is_a_409_with_nothing_removed(w, monkeypatch):
    """Something this change does not know about points at the committee: the foreign key refuses at commit. 409, and the rollback brings back
    even the Task Management copies the endpoint had already dropped."""
    db, as_ = w
    http = as_(ADMIN)
    new_action(http, 1)
    before = held(db, 1)

    def refuse():
        raise IntegrityError("DELETE", {}, Exception("foreign key"))

    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", refuse)
        r = http.delete("/committees/1")
    assert (r.status_code, r.json()["detail"]) == (409, "Another record still points at this committee. Deactivate the committee instead")
    db.expire_all()
    assert held(db, 1) == before and db.get(m.GovernanceCommittee, 1) is not None


def test_removing_an_agenda_item_with_a_vote_is_a_409_and_one_without_is_removed(w):
    db, as_ = w
    seed_committee(db, 3, "Board", "board", vote=True)              # its agenda item 30 has a vote
    http = as_(ADMIN)
    r = http.delete("/committees/meetings/agenda/30")
    assert (r.status_code, r.json()["detail"]) == (409, "A vote was cast on an agenda item, so it cannot be removed")
    db.expire_all()
    assert db.get(m.MeetingAgendaItem, 30) is not None and held(db, 3)["votes"] == 1

    assert http.delete("/committees/meetings/agenda/10").status_code == 204    # no vote: removed as before
    db.expire_all()
    assert db.get(m.MeetingAgendaItem, 10) is None


def test_an_agenda_item_an_extension_request_sits_on_cannot_be_removed(w):
    db, as_ = w
    db.add(m.AuditExtensionRequest(tenant_id=1, issue_id=5, requested_date=datetime.utcnow().date(), reason="x", status="requested", meeting_id=10, agenda_item_id=10))
    db.commit()
    r = as_(ADMIN).delete("/committees/meetings/agenda/10")
    assert (r.status_code, r.json()["detail"]) == (409, "An audit extension request is attached to this agenda item, so it cannot be removed")
    assert db.get(m.MeetingAgendaItem, 10) is not None


# ── a removed member can be added again ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_adding_a_removed_member_again_brings_the_kept_row_back(w):
    db, as_ = w
    http = as_(ADMIN)
    assert http.delete(f"/committees/1/members/{PLAIN}").status_code == 200
    row = db.query(m.CommitteeMember).filter_by(committee_id=1, user_id=PLAIN).one()
    assert row.is_active is False and row.left_at is not None
    assert db.get(m.GovernanceCommittee, 1).chair_id is None       # the chair left with the member

    back = http.post("/committees/1/members", json={"user_id": PLAIN, "role": "secretary"})
    assert back.status_code == 201, back.text                      # it used to be a bare 500 (the unique committee + user row)
    assert (back.json()["user_id"], back.json()["role"], back.json()["is_active"], back.json()["left_at"]) == (PLAIN, "secretary", True, None)
    db.expire_all()
    assert db.query(m.CommitteeMember).filter_by(committee_id=1, user_id=PLAIN).count() == 1     # the same row, not a second
    assert db.get(m.GovernanceCommittee, 1).secretary_id == PLAIN  # the role is written onto the committee as for a new member
    assert {x["user_id"] for x in http.get("/committees/1/members").json()} == {PLAIN, EDITOR}

    again = http.post("/committees/1/members", json={"user_id": PLAIN, "role": "member"})
    assert (again.status_code, again.json()["detail"]) == (400, "User is already an active member of this committee")


# ── the numbers other screens show ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_meeting_cadence_counts_only_active_committees_that_met(w):
    db, as_ = w
    http = as_(ADMIN)
    db.add(m.GovernanceCommittee(id=3, tenant_id=1, name="Quiet", committee_type="custom"))
    db.add(m.CommitteeMeeting(tenant_id=1, committee_id=1, title="Held lately", scheduled_date=datetime.utcnow() - timedelta(days=10), status="completed"))
    db.add(m.CommitteeMeeting(tenant_id=1, committee_id=2, title="Held lately too", scheduled_date=datetime.utcnow() - timedelta(days=12), status="completed"))
    db.commit()

    def cadence():
        metric = next(x for x in http.get("/committees/overview").json()["kpis"]["performance"]["metrics"] if x["key"] == "meeting_cadence")
        return metric["numerator"], metric["denominator"], metric["score"]

    off = lambda cid: http.put(f"/committees/{cid}", json={"is_active": False})                      # noqa: E731 — the old way in, so this pins the number itself
    assert cadence() == (2, 3, 66.7)                               # committees 1 and 2 met, 3 did not
    off(2)
    # committee 2 is out of the denominator AND the numerator: 1 of 2, not 2 of 2 (and never more than 100%)
    assert cadence() == (1, 2, 50.0)
    off(1)
    assert cadence() == (0, 1, 0.0)
    overview = http.get("/committees/overview").json()
    assert overview["kpis"]["total_committees"] == 3 and overview["kpis"]["active_committees"] == 1   # the tiles keep counting every committee


def test_a_deactivated_committee_that_met_cannot_push_the_cadence_above_100(w):
    db, as_ = w
    http = as_(ADMIN)
    for cid in (1, 2):
        db.add(m.CommitteeMeeting(tenant_id=1, committee_id=cid, title=f"Held {cid}", scheduled_date=datetime.utcnow() - timedelta(days=3), status="completed"))
    db.commit()
    assert http.put("/committees/1", json={"is_active": False}).status_code == 200
    metric = next(x for x in http.get("/committees/overview").json()["kpis"]["performance"]["metrics"] if x["key"] == "meeting_cadence")
    assert (metric["numerator"], metric["denominator"], metric["score"]) == (1, 1, 100.0)       # it was 2 of 1 = 200%


# ── the audit register ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_deactivate_is_refused_while_an_extension_request_waits_at_one_of_its_meetings(w):
    db, as_ = w
    http = as_(ADMIN)
    request = m.AuditExtensionRequest(tenant_id=1, issue_id=5, requested_date=datetime.utcnow().date(), reason="Vendor contract slipped",
                                      status="requested", meeting_id=10, agenda_item_id=10)
    db.add(request)
    db.commit()

    r = http.post("/committees/1/deactivate")
    assert r.status_code == 409
    assert "1 audit extension request is still waiting for a decision at a meeting of this committee" in r.json()["detail"]
    assert "Auditor Portal > Issue Register" in r.json()["detail"]
    db.expire_all()
    assert db.get(m.GovernanceCommittee, 1).is_active is True      # nothing changed
    assert http.post("/committees/2/deactivate").status_code == 200  # another committee's has no request

    db.add(m.AuditExtensionRequest(tenant_id=1, issue_id=6, requested_date=datetime.utcnow().date(), reason="Second", status="requested", meeting_id=10))
    db.commit()
    assert "2 audit extension requests are still waiting" in http.post("/committees/1/deactivate").json()["detail"]

    # decided (approved, rejected or withdrawn) requests no longer block it
    for ext in db.query(m.AuditExtensionRequest).all():
        ext.status = "approved"
    db.commit()
    assert http.post("/committees/1/deactivate").json()["is_active"] is False


def test_the_audit_registers_meeting_list_skips_an_inactive_committee_and_says_how_it_falls_back(w):
    db, as_ = w
    http = as_(ADMIN)
    today = datetime.utcnow().date()

    def offered():
        return {x["committee"] for x in workflow.audit_committee_meetings(db, 1, today)}

    assert offered() == {"Audit Committee"}                        # the audit-typed committee, and only it
    http.post("/committees/1/deactivate")
    assert offered() == {"Risk Committee"}                         # the explicit fallback: any ACTIVE committee when no active one is audit-typed
    http.post("/committees/2/deactivate")
    assert offered() == set()                                      # nothing active, nothing offered
    http.post("/committees/1/reactivate")
    assert offered() == {"Audit Committee"}                        # reactivated: back in the picker
