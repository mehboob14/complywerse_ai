"""The Tracker's two read-only endpoints (modules/governance/routers/document_tracker.py): the library's Tracker layout sorts a whole library into
groups (``/sets``: ids only) and draws the compact lines of the page it shows (``/lines?ids=``). Over HTTP with real tokens through the whole
governance router on in-memory SQLite (foreign keys on, a session that does not flush by itself).

* sets: stuck, on hold, late approvals, late acknowledgements (the Documents Overview's own definitions), sent back for changes, a proposed change
  waiting; archived documents and another organisation's are in none; a person without a library right gets only what they own or are asked about;
* lines: the stage a document in review or approval is at (the default route's, or a stage of its own), who it waits for (two names and a count) and
  since when, the hold (who asked, since when, at which stage), who is asked to make the changes or decide on a proposed one, the proposed changes
  waiting, the versions (a sign-off stamp and a taken-back version are not versions); a document the person may not read is left out;
* the ids: at most 100, numbers only; a fixed number of statements however many documents; nothing is written.
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.governance import routers as _routers  # noqa: E402,F401
from grc.modules.governance.router import router as governance_router  # noqa: E402
from grc.modules.governance.routers import document_tracker as T  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

(PLAIN, ADMIN, READER, OWNER, AUTHOR) = range(1, 6)
SETS, LINES = "/governance/document-tracker/sets", "/governance/document-tracker/lines"
NOW = datetime(2026, 11, 12, 12, 0, 0)
DAY = timedelta(days=1)


@pytest.fixture(scope="module")
def _schema():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture
def w(_schema):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    _schema.raw_connection().driver_connection.backup(engine.raw_connection().driver_connection)
    db = sessionmaker(bind=engine, autoflush=False)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", primary_contact_email="boss@acme.test"))
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (READER, "rita"), (OWNER, "olivia"), (AUTHOR, "arun")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    for uid in range(11, 41):                                        # people who are asked to review, approve or acknowledge
        db.add(m.GRCUser(id=uid, username=f"person{uid}", email=f"person{uid}@acme.test", display_name=f"Person {uid:02d}"))
    for rid, name in [(1, "Administrator"), (2, "Library readers")]:
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    db.add(m.Permission(id=1, name="governance:policies:view", resource="governance:policies", action="view"))
    db.add(m.RolePermission(role_id=2, permission_id=1))
    for uid, rid in [(ADMIN, 1), (READER, 2)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=None))
    db.commit()
    app = FastAPI()
    app.include_router(governance_router)
    app.dependency_overrides[m.get_db] = lambda: db

    def as_(uid):
        token = create_access_token({"sub": db.get(m.GRCUser, uid).username, "tenant_slug": "acme", "tenant_id": 1})
        return TestClient(app, headers={"Authorization": "Bearer " + token})

    yield SimpleNamespace(db=db, engine=engine, as_=as_)
    db.close()


# ── helpers ──────────────────────────────────────────────────────────────────
def doc(w, did, status="published", tenant=1, **later):
    d = m.GovernanceDocument(id=did, tenant_id=tenant, title=f"Doc {did}", doc_type="policy", status=status, current_version=later.pop("current_version", "1.0"),
                             owner_id=later.pop("owner", OWNER), author_id=later.pop("author", AUTHOR))
    for key, value in later.items():
        setattr(d, key, value)
    w.db.add(d)
    return d


def ask(w, did, kind="review", uid=11, due=None, status="pending", stage=None, at=None, proposal=None, tenant=1):
    w.db.add(m.DocumentObligation(tenant_id=tenant, document_id=did, kind=kind, user_id=uid, status=status, due_date=due, stage_position=stage,
                                  requested_at=at or NOW - DAY, requested_by=OWNER, proposal_id=proposal))


def hold(w, did, round_at=None, kind="changes", by=11, stage=None, resolved=False, at=None):
    w.db.add(m.DocumentRouteHold(tenant_id=1, document_id=did, round_at=round_at, requested_by=by, requested_at=at or NOW - 2 * DAY, comment="Please change it",
                                 resolved_at=NOW if resolved else None, kind=kind, stage_position=stage))


def propose(w, did, by=12, status="pending", at=None, kind="document", tenant=1):
    w.db.add(m.DocumentChangeProposal(tenant_id=tenant, document_id=did, kind=kind, source="edit", status=status, proposed_by=by, proposed_at=at or NOW - 3 * DAY))


def route(w, did, *stages):
    for position, (name, kind) in enumerate(stages, start=1):
        w.db.add(m.DocumentRouteStage(tenant_id=1, document_id=did, position=position, name=name, kind=kind))


def version(w, did, number, change_type="minor", status=None):
    w.db.add(m.GovernanceDocumentVersion(document_id=did, version_number=number, title=f"Doc {did}", content="text", change_type=change_type, status=status,
                                         created_by=OWNER))


def get(w, uid, path, **params):
    w.db.commit()
    return w.as_(uid).get(path, params=params)


def user(w, uid):
    return w.db.get(m.GRCUser, uid)


def sets_of(w, uid=ADMIN):
    w.db.commit()
    return T.sets(w.db, user(w, uid), now=NOW)


def line(w, did, uid=ADMIN):
    w.db.commit()
    got = {i["id"]: i for i in T.lines(w.db, user(w, uid), [did], now=NOW)["items"]}
    return got.get(did)


# ── sets ─────────────────────────────────────────────────────────────────────
def test_sets_follow_the_overviews_definitions_and_add_changes_and_proposals(w):
    doc(w, 1, "pending_review"); ask(w, 1, "review", 11, NOW - 2 * DAY); ask(w, 1, "review", 12, NOW + DAY)       # one request is late
    doc(w, 2, "pending_review")                                                                                    # nobody can be asked: stuck
    round_at = NOW - 5 * DAY
    doc(w, 3, "pending_approval", signoff_round_at=round_at); hold(w, 3, round_at, kind="changes")               # sent back for changes
    doc(w, 4, "published"); propose(w, 4)                                                                          # a proposed change waits
    doc(w, 5, "pending_review", signoff_round_at=round_at); hold(w, 5, round_at, kind="proposal"); propose(w, 5)  # held for a proposed change
    doc(w, 6, "published"); ask(w, 6, "acknowledgement", 13, NOW - DAY)                                            # an acknowledgement is late
    doc(w, 7, "archived"); propose(w, 7)                                                                           # archived: in none
    doc(w, 8, "pending_review", signoff_round_at=round_at); hold(w, 8, round_at, resolved=True); ask(w, 8, "review", 11, NOW + DAY)  # the hold is resolved
    doc(w, 9, "published", tenant=2); propose(w, 9, tenant=2)                                                      # another organisation's
    doc(w, 10, "published"); ask(w, 10, "acknowledgement", 13, NOW + DAY)                                          # not late yet
    s = sets_of(w)
    assert s["waiting_week"] == []                     # everything was asked yesterday
    assert s["late_approvals"] == [1]
    assert s["stuck"] == [2, 3, 5]                      # a held document has no request to wait on, so the overview counts it as stuck too
    assert s["on_hold"] == [3, 5]
    assert s["late_acknowledgements"] == [6]
    assert s["changes_requested"] == [3]                # a hold for a proposed change is not "changes asked for"
    assert s["proposals_waiting"] == [4, 5]
    assert s["as_of"] == NOW.isoformat()


def test_sets_waiting_more_than_a_week_is_the_oldest_request_of_a_document_in_review_or_approval(w):
    doc(w, 1, "pending_review"); ask(w, 1, "review", 11, None, at=NOW - 8 * DAY); ask(w, 1, "review", 12, None, at=NOW - DAY)      # the oldest one counts
    doc(w, 2, "pending_approval"); ask(w, 2, "approval", 11, None, at=NOW - 7 * DAY + timedelta(hours=1))                          # a little under a week
    doc(w, 3, "published"); ask(w, 3, "review", 11, None, at=NOW - 30 * DAY)                                                       # not in review: not waiting
    doc(w, 4, "pending_review"); ask(w, 4, "acknowledgement", 11, NOW + DAY, at=NOW - 30 * DAY)                                    # an acknowledgement is no step
    assert sets_of(w)["waiting_week"] == [1]


def test_sets_hold_of_an_older_round_does_not_hold(w):
    doc(w, 1, "pending_review", signoff_round_at=NOW - DAY); hold(w, 1, NOW - 9 * DAY, kind="changes"); ask(w, 1, "review", 11, NOW + DAY)
    s = sets_of(w)
    assert s["on_hold"] == [] and s["changes_requested"] == []


def test_sets_only_what_the_person_may_read(w):
    doc(w, 1, "pending_review", owner=PLAIN); ask(w, 1, "review", 11, NOW - 2 * DAY)       # theirs
    doc(w, 2, "pending_review"); ask(w, 2, "review", PLAIN, NOW - 2 * DAY)                  # they are asked
    doc(w, 3, "pending_review"); ask(w, 3, "review", 11, NOW - 2 * DAY)                     # nothing to do with them
    doc(w, 4, "draft"); propose(w, 4)                                                       # a draft: a library reader does not see it
    assert sets_of(w, PLAIN)["late_approvals"] == [1, 2]
    assert sets_of(w, ADMIN)["late_approvals"] == [1, 2, 3]
    assert sets_of(w, READER)["proposals_waiting"] == []
    assert sets_of(w, ADMIN)["proposals_waiting"] == [4]


# ── lines ────────────────────────────────────────────────────────────────────
def test_a_document_in_review_says_its_stage_who_it_waits_for_and_since_when(w):
    doc(w, 1, "pending_review")
    ask(w, 1, "review", 12, NOW + 2 * DAY, at=NOW - 4 * DAY); ask(w, 1, "review", 11, NOW - DAY, at=NOW - 6 * DAY); ask(w, 1, "review", 13, None, at=NOW - 3 * DAY)
    got = line(w, 1)
    assert got["stage"] == {"name": "Review", "kind": "review"}
    assert got["waiting"] == {"kind": "review", "names": ["Person 12", "Person 11"], "more": 1, "count": 3, "since": (NOW - 6 * DAY).isoformat(), "overdue": 1,
                              "next_due": (NOW - DAY).isoformat()}
    assert got["hold"] is None and got["asked"] is None and got["proposals"] is None
    assert got["flags"] == ["late_approvals"]


def test_a_document_in_approval_and_a_stage_of_its_own(w):
    doc(w, 1, "pending_approval"); ask(w, 1, "approval", 11, NOW + DAY)
    doc(w, 2, "pending_approval", route_stage=2); route(w, 2, ("Legal check", "review"), ("Board sign-off", "approval")); ask(w, 2, "approval", 12, NOW + DAY, stage=2)
    doc(w, 3, "pending_review", route_stage=1); route(w, 3, ("Legal check", "concurrence"), ("Board sign-off", "approval")); ask(w, 3, "review", 13, NOW + DAY, stage=1)
    assert line(w, 1)["stage"] == {"name": "Approval", "kind": "approval"} and line(w, 1)["waiting"]["kind"] == "approval"
    assert line(w, 2)["stage"] == {"name": "Board sign-off", "kind": "approval"}
    assert line(w, 3)["stage"] == {"name": "Legal check", "kind": "concurrence"}
    assert line(w, 1)["flags"] == [] and line(w, 2)["waiting"]["names"] == ["Person 12"]


def test_a_stuck_document_waits_for_nobody(w):
    doc(w, 1, "pending_review")
    got = line(w, 1)
    assert got["stage"] == {"name": "Review", "kind": "review"} and got["waiting"] is None and got["flags"] == ["stuck"]


def test_a_hold_says_who_asked_since_when_and_who_is_asked_to_act(w):
    round_at = NOW - 5 * DAY
    doc(w, 1, "pending_approval", signoff_round_at=round_at)
    route(w, 1, ("Review", "review"), ("Board sign-off", "approval"))
    hold(w, 1, round_at, kind="changes", by=11, stage=2, at=NOW - 2 * DAY)
    ask(w, 1, "changes", AUTHOR, NOW + 3 * DAY, at=NOW - 2 * DAY)
    ask(w, 1, "approval", 12, None, status="held")                                           # waits while it is held: not "waiting"
    got = line(w, 1)
    assert got["hold"] == {"kind": "changes", "by": "Person 11", "since": (NOW - 2 * DAY).isoformat(), "stage": "Board sign-off"}
    assert got["asked"] == {"kind": "changes", "names": ["Arun"], "more": 0, "since": (NOW - 2 * DAY).isoformat()}
    assert got["waiting"] is None and "on_hold" in got["flags"]


def test_a_hold_on_the_default_route_names_its_stage(w):
    round_at = NOW - 5 * DAY
    doc(w, 1, "pending_review", signoff_round_at=round_at); hold(w, 1, round_at, stage=1)
    doc(w, 2, "pending_approval", signoff_round_at=round_at); hold(w, 2, round_at, stage=2)
    doc(w, 3, "pending_approval", signoff_round_at=round_at); hold(w, 3, round_at, stage=None)
    assert [line(w, i)["hold"]["stage"] for i in (1, 2, 3)] == ["Review", "Approval", None]


def test_a_proposed_change_waits_for_the_owner(w):
    round_at = NOW - 5 * DAY
    doc(w, 1, "pending_review", signoff_round_at=round_at); hold(w, 1, round_at, kind="proposal", by=12); propose(w, 1, by=12, at=NOW - DAY)
    propose(w, 1, by=13, at=NOW - 3 * DAY, kind="statement"); propose(w, 1, by=14, status="rejected")
    ask(w, 1, "decide", OWNER, NOW + DAY, at=NOW - DAY, proposal=1); ask(w, 1, "decide", AUTHOR, NOW + DAY, at=NOW - DAY, proposal=1)
    doc(w, 2, "published"); propose(w, 2, by=11, at=NOW - 8 * DAY)
    got = line(w, 1)
    assert got["hold"]["kind"] == "proposal" and got["hold"]["by"] == "Person 12"
    assert got["asked"] == {"kind": "decide", "names": ["Olivia", "Arun"], "more": 0, "since": (NOW - DAY).isoformat()}
    assert got["proposals"] == {"count": 2, "since": (NOW - 3 * DAY).isoformat(), "names": ["Person 12", "Person 13"], "more": 0}   # in the order proposed; the rejected one does not wait
    assert line(w, 2)["proposals"] == {"count": 1, "since": (NOW - 8 * DAY).isoformat(), "names": ["Person 11"], "more": 0}
    assert line(w, 2)["hold"] is None and line(w, 2)["stage"] is None


def test_versions_count_what_was_written_not_the_stamps(w):
    doc(w, 1, "published", current_version="1.2")
    for number, change, status in [("1.0", "major", None), ("1.0", "signoff", None), ("1.1", "minor", None), ("1.1", "signoff", None), ("1.15", "minor", "reverted"),
                                   ("1.2", "minor", None)]:
        version(w, 1, number, change, status)
    doc(w, 2, "pending_review", current_version="1.3", published_version="1.1")                         # a newer version over the one in force
    for number in ("1.0", "1.1", "1.2", "1.3"):
        version(w, 2, number)
    doc(w, 3, "draft", current_version="1.0"); version(w, 3, "1.0")
    assert line(w, 1)["versions"] == {"count": 3, "previous": "1.1"}
    assert line(w, 2)["versions"] == {"count": 4, "previous": "1.0"}              # the version in force is 1.1; before it came 1.0
    assert line(w, 3)["versions"] == {"count": 1, "previous": None}


def test_lines_keep_the_order_asked_and_leave_out_what_the_person_may_not_read(w):
    doc(w, 1, "pending_review", owner=PLAIN); doc(w, 2, "pending_review"); doc(w, 3, "draft", owner=PLAIN); doc(w, 4, "published", tenant=2)
    w.db.commit()
    ids = [i["id"] for i in T.lines(w.db, user(w, PLAIN), [3, 2, 1, 4, 99], now=NOW)["items"]]
    assert ids == [3, 1]                                                           # 2 is not theirs, 4 is another organisation's, 99 is nothing
    assert [i["id"] for i in T.lines(w.db, user(w, ADMIN), [3, 2, 1, 4], now=NOW)["items"]] == [3, 2, 1]
    assert T.lines(w.db, user(w, ADMIN), [], now=NOW)["items"] == []


def test_the_ids_are_numbers_and_at_most_a_hundred(w):
    doc(w, 1, "published")
    assert get(w, ADMIN, LINES, ids="1").json()["items"][0]["id"] == 1
    assert get(w, ADMIN, LINES, ids=" 1 , 1,,").json()["items"][0]["id"] == 1
    assert get(w, ADMIN, LINES, ids="1,x").status_code == 400
    assert get(w, ADMIN, LINES, ids="-1").status_code == 400
    assert get(w, ADMIN, LINES, ids=",".join(str(i) for i in range(1, 102))).status_code == 400
    assert get(w, ADMIN, LINES, ids=",".join(str(i) for i in range(1, 101))).status_code == 200
    assert get(w, ADMIN, LINES).status_code == 422
    assert w.as_(ADMIN).get(LINES, params={"ids": "1"}).json()["as_of"]


def test_over_http_and_a_sign_in_is_needed(w):
    doc(w, 1, "pending_review"); ask(w, 1, "review", 11, NOW - DAY)
    w.db.commit()
    assert get(w, ADMIN, SETS).json()["late_approvals"] == [1]
    assert TestClient(w.as_(ADMIN).app).get(SETS).status_code in (401, 403)


def test_a_fixed_number_of_statements_and_nothing_is_written(w):
    seen = []
    event.listen(w.engine, "before_cursor_execute", lambda conn, cursor, statement, params, context, many: seen.append(statement))

    def make(first, count):
        for i in range(first, first + count):
            round_at = NOW - 3 * DAY
            doc(w, i, ("pending_review", "pending_approval", "published", "draft")[i % 4], signoff_round_at=round_at if i % 8 == 0 else None)
            ask(w, i, "review", 11 + i % 20, NOW - DAY); ask(w, i, "approval", 12 + i % 20, None); ask(w, i, "acknowledgement", 13 + i % 20, NOW - DAY)
            if i % 8 == 0:
                hold(w, i, round_at)
            if i % 3 == 0:
                propose(w, i)
            version(w, i, "1.0")
        w.db.commit()

    def cost(path, **params):
        get(w, ADMIN, path, **params)                  # the first request also reads what a sign-in needs (settings, the user): not counted
        seen.clear()
        assert get(w, ADMIN, path, **params).status_code == 200
        return len(seen)

    make(1, 5)
    small = (cost(SETS), cost(LINES, ids="1,2,3,4,5"))
    make(6, 95)
    big = (cost(SETS), cost(LINES, ids=",".join(str(i) for i in range(1, 101))))
    assert small == big
    w.db.rollback()
    before = (len(w.db.new), len(w.db.dirty), len(w.db.deleted))
    T.sets(w.db, user(w, ADMIN), now=NOW)
    T.lines(w.db, user(w, ADMIN), list(range(1, 50)), now=NOW)
    assert (len(w.db.new), len(w.db.dirty), len(w.db.deleted)) == before
