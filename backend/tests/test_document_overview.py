"""The Documents Overview (Governance > Documents > Overview, modules/governance/documents_overview.py): the library at a glance for
the head of a department and for whoever reads the whole library. Over HTTP with real tokens through the whole governance router on
in-memory SQLite (foreign keys on, a session that does not flush by itself); the definitions with boundaries are read at a fixed
instant through the service.

* who may ask (an administrator, a library reader, the head of a department; nobody else) and what each may pick;
* the scopes and the roll-up through three levels, switched-off departments, "No department", another organisation's rows;
* readability: a head without a library right counts only what they own, wrote or are asked about, in every figure and in ``ids``;
* the figures: totals, types, statuses, the stage each document in review is at (default and own route), requests, reviews, issues;
* the definitions: stuck, on hold, late approvals, late acknowledgements, with their boundaries; ``ids`` equals the summary;
* archived documents, the library links, a fixed number of queries however many documents and departments there are, no writes.
"""
import os
import re

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
from grc.modules.governance import documents_overview as S  # noqa: E402
from grc.modules.governance import library_lean  # noqa: E402
from grc.modules.governance.router import router as governance_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

(PLAIN, ADMIN, READER, TOP, MID, LEAF, FIN, EVE, BOTH, EDITOR) = range(1, 11)
OPS, SUP, HELP, FINANCE, LEGACY = 10, 11, 12, 13, 14           # Operations > Support > Helpdesk; Finance > Legacy (switched off)
URL = "/governance/document-overview"
NOW = datetime(2026, 11, 4, 12, 0, 0)
DAY, HOUR = timedelta(days=1), timedelta(hours=1)
REFUSED = "The documents overview is for people who can read the document library, for the head of a department and for anyone given access to one."


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
    for uid, name in [(PLAIN, "plain"), (ADMIN, "ada"), (READER, "rita"), (TOP, "tom"), (MID, "mia"), (LEAF, "leo"), (FIN, "fay"),
                      (EVE, "eve"), (BOTH, "bo"), (EDITOR, "ed")]:
        db.add(m.GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title()))
    for uid in range(11, 41):                                        # people who are asked to review, approve or acknowledge
        db.add(m.GRCUser(id=uid, username=f"person{uid}", email=f"person{uid}@acme.test", display_name=f"Person {uid:02d}"))
    for rid, name in [(1, "Administrator"), (2, "Library readers"), (3, "Library editors")]:
        db.add(m.Role(id=rid, tenant_id=1, name=name))
    for pid, rid, name in [(1, 2, "governance:policies:view"), (2, 3, "governance:policies:edit")]:
        db.add(m.Permission(id=pid, name=name, resource="governance:policies", action=name.rsplit(":", 1)[1]))
        db.add(m.RolePermission(role_id=rid, permission_id=pid))
    for uid, rid in [(ADMIN, 1), (READER, 2), (BOTH, 2), (EDITOR, 3)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1, source=None))
    for did, name, parent, head, active in [(OPS, "Operations", None, TOP, True), (SUP, "Support", OPS, MID, True),
                                            (HELP, "Helpdesk", SUP, LEAF, True), (FINANCE, "Finance", None, FIN, True),
                                            (LEGACY, "Legacy", FINANCE, None, False)]:
        db.add(m.GRCDepartment(id=did, tenant_id=1, name=name, code=name[:4].upper(), parent_department_id=parent, department_head_user_id=head,
                               is_active=active))
    db.add(m.GRCDepartment(id=900, tenant_id=2, name="Elsewhere", code="ELSE"))
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

def doc(w, did, dept=None, status="published", owner=ADMIN, tenant=1, **later):
    """A document. What the status listeners reset (route_stage, signoff_round_at) and the version numbers are set after it exists."""
    d = m.GovernanceDocument(id=did, tenant_id=tenant, title=f"Doc {did}", doc_type=later.pop("doc_type", "policy"), status=status,
                             current_version="1.0", owner_id=owner, department_id=dept)
    for key, value in later.items():
        setattr(d, key, value)
    w.db.add(d)
    return d


def ask(w, did, kind="review", uid=40, due=None, status="pending", stage=None, tenant=1):
    w.db.add(m.DocumentObligation(tenant_id=tenant, document_id=did, kind=kind, user_id=uid, status=status, due_date=due, stage_position=stage))


def hold(w, did, round_at, resolved=False, kind="changes", tenant=1):
    w.db.add(m.DocumentRouteHold(tenant_id=tenant, document_id=did, round_at=round_at, requested_by=ADMIN, requested_at=NOW, comment="Please change it",
                                 resolved_at=NOW if resolved else None, kind=kind))


def route(w, did, *stages, tenant=1):
    for position, (name, kind) in enumerate(stages, start=1):
        w.db.add(m.DocumentRouteStage(tenant_id=tenant, document_id=did, position=position, name=name, kind=kind))


def user(w, uid):
    return w.db.get(m.GRCUser, uid)


def get(w, uid, department=None, path=URL, **params):
    if department is not None:
        params["department_id"] = department
    return w.as_(uid).get(path, params=params)


def figures(w, uid=ADMIN, department=None, now=NOW):
    """The summary at the fixed instant, for the definitions that have boundaries."""
    w.db.commit()
    return S.summary(w.db, user(w, uid), None if department is None else str(department), now=now)


def ids_of(w, kind, uid=ADMIN, department=None, now=NOW):
    w.db.commit()
    return S.ids(w.db, user(w, uid), kind, None if department is None else str(department), now=now)


# ── who may ask, and what they may pick ──────────────────────────────────────

def test_who_may_ask_and_what_they_may_pick(w):
    doc(w, 1, HELP)
    w.db.commit()
    for path, params in [(URL, {}), (URL + "/ids", {"kind": "stuck"})]:
        r = get(w, PLAIN, path=path, **params)
        assert (r.status_code, r.json()["detail"]) == (403, REFUSED), path
        assert get(w, EVE, path=path, **params).status_code == 403            # owns documents, heads nothing, reads no library
        for uid in (ADMIN, READER, EDITOR, TOP, MID, LEAF, FIN, BOTH):
            assert get(w, uid, path=path, **params).status_code == 200, (path, uid)
    # a department head picks the departments they head and what is under them, never one outside
    assert [get(w, MID, d).status_code for d in (SUP, HELP, OPS, FINANCE, LEGACY, "none")] == [200, 200, 403, 403, 403, 403]
    assert [get(w, LEAF, d).status_code for d in (HELP, SUP, OPS)] == [200, 403, 403]
    r = get(w, MID, OPS)
    assert r.json()["detail"] == S.NOT_YOURS
    assert get(w, MID, OPS, path=URL + "/ids", kind="stuck").status_code == 403
    # whoever reads the library picks any department and "No department"
    for uid in (ADMIN, READER, EDITOR, BOTH):
        assert [get(w, uid, d).status_code for d in (OPS, SUP, HELP, FINANCE, LEGACY, "none", "NONE", "011")] == [200] * 8, uid
    # a department that does not exist (or is another organisation's) is 404 for everyone; a word that is no department is 400
    for uid in (ADMIN, MID):
        assert [get(w, uid, d).status_code for d in (999, 900, 0)] == [404, 404, 404]
        assert [get(w, uid, d).status_code for d in ("abc", "-1", "1.5", "1,2")] == [400] * 4
    assert get(w, ADMIN, path=URL + "/ids", kind="nonsense").status_code == 400
    assert get(w, PLAIN, path=URL + "/ids", kind="nonsense").status_code == 403     # refused before being told what to ask
    assert get(w, ADMIN, path=URL + "/ids").status_code == 422                      # kind is required


def test_the_choices_are_the_departments_of_the_tree_in_picker_order(w):
    names = lambda r: [(c["value"], c["name"], c["level"], c["level_label"]) for c in r.json()["choices"]]       # noqa: E731
    expected = [("", "Whole organisation", 0, ""), (str(FINANCE), "Finance", 1, "Department"), (str(LEGACY), "Legacy", 2, "Sub-department"),
                (str(OPS), "Operations", 1, "Department"), (str(SUP), "Support", 2, "Sub-department"), (str(HELP), "Helpdesk", 3, "Unit"),
                ("none", "No department", 0, "")]
    for uid in (ADMIN, READER, EDITOR):
        assert names(get(w, uid)) == expected, uid
    full = get(w, ADMIN).json()["choices"]
    assert full[5]["path"] == ["Operations", "Support", "Helpdesk"] and full[2]["is_active"] is False and full[0]["department_id"] is None
    assert [c["department_id"] for c in full] == [None, FINANCE, LEGACY, OPS, SUP, HELP, None]
    # a head: what they head and everything under it; the head of a middle department starts at it, with the path above it
    assert names(get(w, TOP)) == expected[3:6]
    assert names(get(w, MID)) == [(str(SUP), "Support", 2, "Sub-department"), (str(HELP), "Helpdesk", 3, "Unit")]
    assert get(w, MID).json()["choices"][0]["path"] == ["Operations", "Support"]
    assert names(get(w, LEAF)) == [(str(HELP), "Helpdesk", 3, "Unit")]
    # the head of two departments sees both in picker order, and a department under another that is also headed is listed once
    w.db.get(m.GRCDepartment, HELP).department_head_user_id = FIN
    w.db.get(m.GRCDepartment, SUP).department_head_user_id = FIN
    w.db.commit()
    assert [c[1] for c in names(get(w, FIN))] == ["Finance", "Legacy", "Support", "Helpdesk"]
    # the organisation names its levels (Administration > Departments): the choices say them, and another organisation's names change nothing
    S.org_departments.set_level_labels(w.db, 1, ["Division", "Branch", "Team"])
    S.org_departments.set_level_labels(w.db, 2, ["Region", "Country", "Office"])
    w.db.commit()
    assert [(c[1], c[3]) for c in names(get(w, ADMIN))] == [
        ("Whole organisation", ""), ("Finance", "Division"), ("Legacy", "Branch"), ("Operations", "Division"), ("Support", "Branch"),
        ("Helpdesk", "Team"), ("No department", "")]
    assert get(w, ADMIN, HELP).json()["scope"]["level_label"] == "Team"


def test_the_default_scope_is_the_whole_organisation_for_a_reader_and_the_first_department_for_a_head(w):
    scope = lambda uid, d=None: get(w, uid, d).json()["scope"]      # noqa: E731
    assert scope(ADMIN)["whole_organisation"] is True and scope(ADMIN)["name"] == "Whole organisation" and scope(ADMIN)["department_id"] is None
    assert scope(READER)["value"] == "" and scope(EDITOR)["value"] == ""
    assert (scope(TOP)["value"], scope(TOP)["name"], scope(TOP)["whole_organisation"]) == (str(OPS), "Operations", False)
    assert (scope(MID)["value"], scope(MID)["path"], scope(MID)["level_label"]) == (str(SUP), ["Operations", "Support"], "Sub-department")
    assert scope(LEAF)["name"] == "Helpdesk" and scope(LEAF)["includes_below"] is True
    # a reader who also heads a department starts on the whole organisation and may pick their own
    w.db.get(m.GRCDepartment, FINANCE).department_head_user_id = BOTH
    w.db.commit()
    assert scope(BOTH)["whole_organisation"] is True and scope(BOTH, FINANCE)["name"] == "Finance"
    none = scope(ADMIN, "none")
    assert (none["name"], none["department_id"], none["whole_organisation"], none["value"], none["path"]) == ("No department", None, False, "none", [])


# ── the scopes ───────────────────────────────────────────────────────────────

def test_a_department_counts_everything_under_it_through_three_levels(w):
    for did, dept in [(1, OPS), (2, SUP), (3, SUP), (4, HELP), (5, FINANCE), (6, LEGACY), (7, None), (8, 4242)]:
        doc(w, did, dept)
    doc(w, 9, HELP, status="archived")
    w.db.commit()
    total = lambda d: get(w, ADMIN, d).json()["totals"]            # noqa: E731
    assert [total(d)["documents"] for d in (OPS, SUP, HELP, FINANCE, LEGACY, "none", None)] == [4, 3, 1, 2, 1, 1, 8]    # whole: also the one in a gone department
    assert [total(d)["archived"] for d in (OPS, SUP, HELP, FINANCE, "none", None)] == [1, 1, 1, 0, 0, 1]
    assert get(w, MID).json()["totals"]["documents"] == 3                  # a head without a library right reads everything in the departments they head (2, 3, 4)
    assert get(w, READER, SUP).json()["totals"]["documents"] == 3 and get(w, EDITOR, OPS).json()["totals"]["documents"] == 4
    for uid in (ADMIN, READER):
        assert get(w, uid, SUP).json()["scope"]["path"] == ["Operations", "Support"]


def test_a_head_without_a_library_right_reads_every_document_of_their_departments_and_nothing_else_of_the_library(w):
    """The user's decision of 2026-11-05: the owner of a unit reads all of the unit (drafts included) and of what is under it."""
    doc(w, 1, OPS, status="draft", owner=EVE)                              # a draft in Operations, somebody else's
    doc(w, 2, SUP, owner=ADMIN, author_id=EVE)                             # published
    doc(w, 3, SUP, status="archived", owner=EVE)                           # archived: only the archived total counts it
    doc(w, 4, HELP, status="pending_review", owner=EVE)
    doc(w, 5, HELP, status="draft", owner=EVE)
    doc(w, 6, HELP, status="pending_review", published_version="1.0", owner=EVE)      # a new version on its way over a published one
    doc(w, 7, FINANCE, status="draft", owner=EVE)                          # another department's draft
    doc(w, 8, None, status="draft", owner=EVE)                             # filed under no department
    w.db.commit()
    count = lambda uid, d=None: get(w, uid, d).json()["totals"]["documents"]     # noqa: E731
    assert count(ADMIN) == 7 and count(EDITOR) == 7                        # whoever may edit reads every draft (all but the archived one)
    assert count(READER) == 2                                              # 2 (in force) and 6 (a version in force): no draft that was never published
    assert count(TOP) == 5 and count(TOP, OPS) == 5                        # 1, 2, 4, 5, 6: all of Operations and below, not Finance's draft nor the unfiled one
    assert count(TOP, SUP) == 4 and count(TOP, HELP) == 3
    assert count(MID) == 4 and count(MID, HELP) == 3                       # Support and what is under it, not Operations' own draft (1)
    assert count(LEAF) == 3                                                # the Helpdesk
    assert count(FIN) == 1                                                 # Finance's draft, theirs as its head
    assert get(w, MID).json()["totals"]["archived"] == 1
    assert get(w, EVE, path=URL).status_code == 403                        # owning drafts everywhere is not heading a department
    assert get(w, MID, FINANCE).status_code == 403 and get(w, LEAF, SUP).status_code == 403      # never outside their departments


def test_a_reader_is_never_shown_a_document_they_may_not_read_in_any_figure_or_list(w):
    doc(w, 1, HELP, status="pending_review", owner=READER)                 # READER's own: late approval, listed
    ask(w, 1, "review", 11, NOW - 3 * DAY)
    doc(w, 2, HELP, status="pending_review", owner=ADMIN)                  # a draft not in force: stuck, late, no owner shown to them
    ask(w, 2, "review", 12, NOW - 20 * DAY)
    doc(w, 3, HELP, status="pending_review", owner=None)                   # nobody's
    doc(w, 4, HELP, status="published", owner=ADMIN)                       # in force: READER reads it; an overdue acknowledgement
    ask(w, 4, "acknowledgement", 13, NOW - DAY)
    w.db.commit()
    mine, everything = figures(w, READER), figures(w, ADMIN)
    assert (mine["totals"]["documents"], everything["totals"]["documents"]) == (2, 4)
    assert (mine["issues"]["late_approvals"], everything["issues"]["late_approvals"]) == (1, 2)
    assert (mine["issues"]["stuck"], everything["issues"]["stuck"]) == (0, 2)         # doc 1's review is 3 days late: not stuck yet; 2 and 3 are
    assert (mine["issues"]["no_owner"], everything["issues"]["no_owner"]) == (0, 1)
    assert (mine["issues"]["late_acknowledgements"], everything["issues"]["late_acknowledgements"]) == (1, 1)
    assert (mine["requests"]["review"]["overdue"], everything["requests"]["review"]["overdue"]) == (1, 2)
    assert [r["document_id"] for r in mine["waiting"]] == [1, 4] and [r["document_id"] for r in everything["waiting"]] == [2, 1, 4]    # 4: the acknowledgement
    assert mine["waiting"][0]["waiting_for"] == ["Person 11"]
    assert ids_of(w, "late_approvals", READER)["ids"] == [1] and ids_of(w, "late_approvals")["ids"] == [1, 2]
    assert ids_of(w, "stuck", READER)["ids"] == [] and ids_of(w, "stuck")["ids"] == [2, 3]
    assert ids_of(w, "late_acknowledgements", READER)["ids"] == [4] and ids_of(w, "late_acknowledgements")["ids"] == [4]
    assert {t["doc_type"] for t in mine["by_type"]} == {"policy"} and sum(t["count"] for t in mine["by_type"]) == 2
    assert mine["stages"] == [{"key": "stage:review:Review", "name": "Review", "kind": "review", "count": 1}]
    # the head of the department all four are filed in (LEAF) reads them all: their figures are the administrator's for that department
    for key in ("totals", "issues", "requests"):
        assert figures(w, LEAF, HELP)[key] == figures(w, ADMIN, HELP)[key], key
    assert [r["document_id"] for r in figures(w, LEAF, HELP)["waiting"]] == [2, 1, 4]


def test_another_organisations_rows_are_never_counted_or_listed(w):
    doc(w, 1, OPS)
    doc(w, 2, OPS, tenant=2)                                               # another organisation's, in a department id that is also ours
    doc(w, 3, 900, tenant=2, status="pending_review")
    ask(w, 3, "review", 11, NOW - 30 * DAY, tenant=2)
    ask(w, 2, "acknowledgement", 11, NOW - 30 * DAY, tenant=2)
    hold(w, 3, None, tenant=2)
    route(w, 3, ("Elsewhere stage", "review"), tenant=2)
    doc(w, 4, OPS, status="pending_review")                                # ours, so the numbers below are not all zero
    ask(w, 4, "review", 12, NOW - DAY)
    w.db.commit()
    for uid, d in [(ADMIN, None), (ADMIN, OPS), (EDITOR, None)]:           # who read every document of ours: two, and none of the other organisation's
        f = figures(w, uid, d)
        assert f["totals"]["documents"] == 2, (uid, d)
        assert f["requests"]["review"]["overdue"] == 1 and f["requests"]["acknowledgement"]["pending"] == 0
        assert [r["document_id"] for r in f["waiting"]] == [4] and f["issues"]["on_hold"] == 0
        assert [s["name"] for s in f["stages"]] == ["Review"]
    reader = figures(w, READER)                                            # reads our published one only (doc 4 was never published)
    assert reader["totals"]["documents"] == 1 and reader["requests"]["review"]["pending"] == 0 and reader["waiting"] == [] and reader["stages"] == []
    assert figures(w, TOP)["totals"]["documents"] == 2                     # heads Operations: reads both of ours there, none of the other organisation's
    assert [ids_of(w, k)["ids"] for k in S.KINDS] == [[], [4], [], []]
    assert get(w, ADMIN, 900).status_code == 404 and get(w, TOP, 900).status_code == 404
    assert {c["name"] for c in get(w, ADMIN).json()["choices"]} == {"Whole organisation", "Finance", "Legacy", "Operations", "Support", "Helpdesk", "No department"}


# ── the figures ──────────────────────────────────────────────────────────────

def test_totals_types_and_statuses(w):
    for did, status, kind in [(10, "published", "policy"), (11, "published", "policy"), (12, "draft", "standard"), (13, "pending_review", "procedure"),
                              (14, "pending_approval", "procedure"), (15, "approved", "guideline"), (16, "expired", "charter"),
                              (17, "exception_applied", "policy"), (18, "archived", "policy"), (19, "review_required", "risk_register")]:
        doc(w, did, HELP, status=status, doc_type=kind)
    w.db.commit()
    f = figures(w, ADMIN, HELP)
    assert f["totals"] == {"documents": 9, "in_force": 2, "in_progress": 4, "expired": 1, "exception_applied": 1, "archived": 1}
    assert [(t["doc_type"], t["label"], t["count"], t["in_force"]) for t in f["by_type"]] == [
        ("policy", "Policy", 3, 2), ("procedure", "Procedure", 2, 0), ("charter", "Charter", 1, 0), ("guideline", "Guideline", 1, 0),
        ("risk_register", "Risk register", 1, 0), ("standard", "Standard", 1, 0)]
    assert [(s["status"], s["count"]) for s in f["by_status"]] == [
        ("draft", 1), ("pending_review", 1), ("pending_approval", 1), ("approved", 1), ("published", 2), ("expired", 1), ("exception_applied", 1),
        ("review_required", 1)]
    assert sum(s["count"] for s in f["by_status"]) == f["totals"]["documents"]
    empty = figures(w, ADMIN, FINANCE)                                      # a department with nothing: the same shape, all zero (no status is left out)
    assert empty["totals"] == {k: 0 for k in f["totals"]} and empty["by_type"] == [] and empty["waiting"] == [] and empty["stages"] == []
    assert [s["status"] for s in empty["by_status"]] == list(S.STATUS_ORDER) and not any(s["count"] for s in empty["by_status"])


def test_reviews_are_owed_on_documents_in_force_or_approved_and_the_edges_are_the_librarys(w):
    due = lambda delta: NOW + delta     # noqa: E731
    rows = [
        (1, "published", due(-timedelta(seconds=1)), {}),                   # a second ago: overdue
        (2, "published", due(timedelta(0)), {}),                            # this instant: not overdue yet, due today
        (3, "published", datetime(2026, 12, 4, 23, 59, 59), {}),            # 30 days ahead, the last second of that calendar day: due soon
        (4, "published", datetime(2026, 12, 5, 0, 0, 0), {}),               # the next calendar day: up to date
        (5, "published", None, {}),                                         # no date
        (6, "approved", due(10 * DAY), {}),                                 # approved and waiting to be published owes one
        (7, "draft", due(-5 * DAY), {"published_version": "1.0"}),          # a new version on its way over a published one: overdue
        (8, "draft", due(-5 * DAY), {}),                                    # a draft owes none
        (9, "expired", due(-5 * DAY), {}),
        (10, "archived", due(-5 * DAY), {}),
        (11, "pending_review", None, {}),                                   # in review, nothing in force: none
        (12, "exception_applied", due(-5 * DAY), {}),
        (13, "pending_approval", due(-1 * DAY), {"published_version": "1.0"}),    # in force while the new version is approved: overdue
    ]
    for did, status, when, extra in rows:
        doc(w, did, HELP, status=status, next_review_date=when, **extra)
    w.db.commit()
    f = figures(w, ADMIN, HELP)
    assert f["reviews"] == {"overdue": 3, "due_soon": 3, "unscheduled": 1, "up_to_date": 1}
    assert f["links"]["reviews.overdue"] == {"dept": str(HELP), "review": "overdue"} and f["links"]["reviews.up_to_date"]["review"] == "ok"
    assert f["links"]["reviews.due_soon"]["review"] == "due_soon" and f["links"]["reviews.unscheduled"]["review"] == "unscheduled"


def test_requests_pending_overdue_due_soon_and_the_oldest_late(w):
    for did, status in [(1, "pending_review"), (2, "pending_review"), (3, "pending_approval"), (4, "published")]:
        doc(w, did, HELP, status=status)
    for due in [NOW - 10 * DAY, NOW - HOUR, NOW, NOW + 7 * DAY, NOW + 7 * DAY + timedelta(seconds=1), None]:
        ask(w, 1, "review", 11, due)
    ask(w, 2, "review", 12, NOW - 30 * DAY, status="done")                 # answered: not pending
    ask(w, 2, "changes", 12, NOW - 30 * DAY)                               # the author's, not one of the three
    ask(w, 3, "approval", 13, NOW - 3 * DAY - 12 * HOUR)
    ask(w, 3, "approval", 14, NOW + DAY)
    ask(w, 4, "acknowledgement", 15, NOW - 2 * DAY)
    ask(w, 4, "acknowledgement", 16, NOW - 2 * DAY)
    doc(w, 5, OPS, status="pending_review")                                # another department
    ask(w, 5, "review", 17, NOW - 40 * DAY)
    doc(w, 6, HELP, status="archived")                                     # withdrawn: its requests are not counted
    ask(w, 6, "review", 18, NOW - 40 * DAY)
    w.db.commit()
    f = figures(w, ADMIN, HELP)
    assert f["requests"]["review"] == {"pending": 6, "overdue": 2, "due_soon": 2, "oldest_days_late": 10}
    assert f["requests"]["approval"] == {"pending": 2, "overdue": 1, "due_soon": 1, "oldest_days_late": 3}
    assert f["requests"]["acknowledgement"] == {"pending": 2, "overdue": 2, "due_soon": 0, "oldest_days_late": 2}
    assert set(f["requests"]) == {"review", "approval", "acknowledgement"}
    assert figures(w, ADMIN, FINANCE)["requests"]["review"] == {"pending": 0, "overdue": 0, "due_soon": 0, "oldest_days_late": None}
    assert figures(w, ADMIN, OPS)["requests"]["review"]["pending"] == 7              # the whole tree: Operations and the Helpdesk under it
    assert f["links"]["requests.review.overdue"] == f["links"]["requests.approval.overdue"] == {"dept": str(HELP), "attn": "late_approvals"}
    assert f["links"]["requests.acknowledgement.overdue"]["attn"] == "late_acknowledgements"


# ── the definitions: stuck, on hold, late ────────────────────────────────────

def test_stuck_means_no_request_or_the_oldest_more_than_the_escalation_days_overdue(w):
    assert S.doc_lifecycle.settings(w.db, 1)["admin_after_days"] == 7
    doc(w, 30, HELP, status="pending_review")                                                    # nobody was asked
    doc(w, 31, HELP, status="pending_review"); ask(w, 31, "review", 11, NOW - 7 * DAY)           # exactly 7 days: not more than 7
    doc(w, 32, HELP, status="pending_review"); ask(w, 32, "review", 11, NOW - 7 * DAY - timedelta(seconds=1))
    doc(w, 33, HELP, status="pending_approval")                                                  # the oldest one decides, not the newest
    ask(w, 33, "approval", 11, NOW - 8 * DAY); ask(w, 33, "approval", 12, NOW + 3 * DAY)
    doc(w, 34, HELP, status="pending_review"); ask(w, 34, "review", 11, None)                    # asked, no due date: not late
    doc(w, 35, HELP, status="pending_review", published_version="1.0")                           # a new version in review; only acknowledgements wait
    ask(w, 35, "acknowledgement", 11, NOW - 30 * DAY)
    doc(w, 36, HELP, status="pending_approval"); ask(w, 36, "approval", 11, NOW + DAY)
    doc(w, 37, HELP, status="published")                                                         # not in a stage
    doc(w, 38, HELP, status="draft")
    doc(w, 39, HELP, status="archived")
    doc(w, 40, HELP, status="pending_review"); ask(w, 40, "review", 11, NOW - 9 * DAY, status="done")     # answered requests are not requests
    doc(w, 41, HELP, status="pending_review"); ask(w, 41, "changes", 11, NOW + DAY)                 # the author's changes are not one of the three
    w.db.commit()
    stuck = [30, 32, 33, 35, 40, 41]
    assert ids_of(w, "stuck")["ids"] == stuck and figures(w)["issues"]["stuck"] == len(stuck)
    # the days are the organisation's (Governance > Settings): at 30 days a request 8 days late is no longer stuck; those with no review or approval request still are
    S.doc_lifecycle.save_settings(w.db, 1, {"admin_after_days": 30})
    assert ids_of(w, "stuck")["ids"] == [30, 35, 40, 41]
    assert ids_of(w, "stuck", department=OPS)["ids"] == [30, 35, 40, 41]                           # a department counts what is under it
    assert ids_of(w, "stuck", department=FINANCE) == {"ids": [], "total": 0}


def test_on_hold_means_an_unresolved_hold_of_the_current_round(w):
    r0, r1 = NOW - 5 * DAY, NOW - 2 * DAY
    for did, status, round_at in [(40, "pending_review", r1), (41, "pending_review", r1), (42, "pending_review", None), (43, "pending_review", r1),
                                  (44, "draft", r1), (45, "pending_approval", r1), (46, "pending_review", r1), (47, "pending_review", r1)]:
        doc(w, did, HELP, status=status, signoff_round_at=round_at)
        if status in S.PENDING:
            ask(w, did, "review" if status == "pending_review" else "approval", 11, NOW + 10 * DAY)    # someone is on it: not stuck
    hold(w, 40, r1)                                  # this round: on hold
    hold(w, 41, r0)                                  # an earlier round's: the document was sent again since
    hold(w, 42, None)                                # no round recorded on either side: on hold
    hold(w, 43, r1, resolved=True)                   # resubmitted
    hold(w, 44, r1)                                  # not in review or approval any more
    hold(w, 45, r1, kind="proposal")                 # a proposed change waiting for the owner holds the route too
    hold(w, 46, r1, resolved=True); hold(w, 46, r1)  # one resolved, one open: on hold
    hold(w, 47, None)                                # a hold with no round on a document that has one: not this round's
    doc(w, 48, HELP, status="archived", signoff_round_at=r1); hold(w, 48, r1)
    w.db.commit()
    assert ids_of(w, "on_hold")["ids"] == [40, 42, 45, 46] and figures(w)["issues"]["on_hold"] == 4
    assert ids_of(w, "stuck")["ids"] == []


def test_late_approvals_and_late_acknowledgements(w):
    doc(w, 50, HELP, status="pending_review"); ask(w, 50, "review", 11, NOW - DAY)
    doc(w, 51, HELP, status="pending_approval"); ask(w, 51, "approval", 11, NOW - HOUR)
    doc(w, 52, HELP, status="pending_review"); ask(w, 52, "review", 11, NOW)                  # due this instant: not late
    doc(w, 53, HELP, status="published"); ask(w, 53, "acknowledgement", 11, NOW - DAY)
    doc(w, 54, HELP, status="published"); ask(w, 54, "acknowledgement", 11, NOW + DAY)
    doc(w, 55, HELP, status="draft"); ask(w, 55, "acknowledgement", 11, NOW - DAY)             # nothing in force: no acknowledgement is owed
    doc(w, 56, HELP, status="draft", published_version="1.0"); ask(w, 56, "acknowledgement", 11, NOW - DAY)   # the published version is still in force
    doc(w, 57, HELP, status="published"); ask(w, 57, "review", 11, NOW - DAY)                  # a review request on a published document is late approvals
    doc(w, 58, HELP, status="published"); ask(w, 58, "acknowledgement", 11, NOW - DAY); ask(w, 58, "acknowledgement", 12, NOW - 2 * DAY)   # two people: one document
    doc(w, 59, HELP, status="archived"); ask(w, 59, "acknowledgement", 11, NOW - DAY); ask(w, 59, "approval", 11, NOW - DAY)
    w.db.commit()
    assert ids_of(w, "late_approvals")["ids"] == [50, 51, 57] and ids_of(w, "late_acknowledgements")["ids"] == [53, 56, 58]
    issues = figures(w)["issues"]
    assert (issues["late_approvals"], issues["late_acknowledgements"]) == (3, 3)
    assert figures(w)["requests"]["acknowledgement"]["overdue"] == 5                    # the people: 53, 55, 56 and the two on 58 (people are counted, not documents)


def test_the_ids_are_the_documents_the_summary_counts(w):
    doc(w, 1, SUP, status="pending_review", owner=None)                                          # stuck, no owner
    doc(w, 2, HELP, status="pending_review", signoff_round_at=NOW); hold(w, 2, NOW); ask(w, 2, "review", 11, NOW - 2 * DAY)
    doc(w, 3, HELP, status="pending_approval"); ask(w, 3, "approval", 12, NOW - 20 * DAY)
    doc(w, 4, OPS, status="published"); ask(w, 4, "acknowledgement", 13, NOW - 3 * DAY)
    doc(w, 5, FINANCE, status="published"); ask(w, 5, "acknowledgement", 13, NOW - 3 * DAY)
    doc(w, 6, None, status="expired")
    doc(w, 7, HELP, status="exception_applied")
    w.db.commit()
    for uid, department in [(ADMIN, None), (ADMIN, OPS), (ADMIN, SUP), (ADMIN, HELP), (ADMIN, "none"), (READER, FINANCE), (EDITOR, None)]:
        f = figures(w, uid, department)
        for kind in S.KINDS:
            got = ids_of(w, kind, uid, department)
            assert got["total"] == len(got["ids"]) == f["issues"][kind], (uid, department, kind)
            assert got["ids"] == sorted(got["ids"])
    assert figures(w, ADMIN, OPS)["issues"] == {"no_owner": 1, "expired": 0, "exception_applied": 1, "stuck": 2, "on_hold": 1,        # stuck: 1 (nobody asked) and 3 (20 days late)
                                                "late_acknowledgements": 1, "late_approvals": 2, "documents": 5}
    assert figures(w, ADMIN, None)["issues"]["documents"] == 7                        # every one of the seven has an issue; each is counted once
    assert figures(w, ADMIN, "none")["issues"]["documents"] == 1 and figures(w, ADMIN, "none")["issues"]["expired"] == 1


def test_the_stage_each_document_in_review_is_at(w):
    for did, status in [(60, "pending_review"), (61, "pending_review"), (62, "pending_approval")]:
        doc(w, did, HELP, status=status)                                                         # the default route: its status is its stage
    stages = (("Legal review", "review"), ("CISO sign-off", "approval"), ("Board noted", "information"))
    doc(w, 63, HELP, status="pending_review", route_stage=1); route(w, 63, *stages)
    doc(w, 64, HELP, status="pending_approval", route_stage=2); route(w, 64, *stages)
    doc(w, 65, HELP, status="pending_review"); route(w, 65, *stages)                              # no stage recorded: the first where someone acts
    doc(w, 66, HELP, status="pending_review", route_stage=99); route(w, 66, *stages)              # one that is not on its route: the same
    doc(w, 67, HELP, status="pending_review", route_stage=1); route(w, 67, ("Review", "review"))   # a stage called like the default one: the same row
    doc(w, 68, HELP, status="draft"); route(w, 68, *stages)                                       # not in review: no stage
    doc(w, 69, HELP, status="archived")
    doc(w, 70, OPS, status="pending_approval")                                                   # in Operations itself: the default route's Approval
    w.db.commit()
    f = figures(w, ADMIN, HELP)
    assert [(s["name"], s["kind"], s["count"]) for s in f["stages"]] == [
        ("Legal review", "review", 3), ("Review", "review", 3), ("Approval", "approval", 1), ("CISO sign-off", "approval", 1)]
    assert [s["key"] for s in f["stages"]][:2] == ["stage:review:Legal review", "stage:review:Review"]
    assert f["links"]["stage:review:Review"] == {"dept": str(HELP), "status": "pending_review"}
    assert f["links"]["stage:approval:Approval"]["status"] == "pending_approval"
    assert sum(s["count"] for s in figures(w, ADMIN, SUP)["stages"]) == 8 and sum(s["count"] for s in figures(w, ADMIN, OPS)["stages"]) == 9
    assert {(s["name"], s["count"]) for s in figures(w, ADMIN, OPS)["stages"]} >= {("Approval", 2)}      # 62 and 70


def test_the_steps_that_have_waited_longest(w):
    doc(w, 70, HELP, status="pending_review")
    for uid, due in [(12, NOW - 3 * DAY), (11, NOW - 5 * DAY), (13, NOW + DAY)]:
        ask(w, 70, "review", uid, due)
    doc(w, 71, HELP, status="pending_approval"); route(w, 71, ("Legal review", "review"), ("CISO sign-off", "approval"))
    ask(w, 71, "approval", 14, NOW - 9 * DAY - 6 * HOUR, stage=2)
    doc(w, 72, HELP, status="published")
    for uid in range(20, 28):                                                                     # eight people have not acknowledged
        ask(w, 72, "acknowledgement", uid, NOW - 2 * DAY)
    for n in range(80, 92):                                                                       # twelve more, each an hour later than the one before
        doc(w, n, HELP, status="pending_review")
        ask(w, n, "review", 30, NOW - (n - 79) * HOUR)
    doc(w, 92, HELP, status="archived"); ask(w, 92, "review", 31, NOW - 100 * DAY)                # withdrawn: never listed
    doc(w, 93, OPS, status="pending_review"); ask(w, 93, "review", 31, NOW - 100 * DAY)           # another department
    w.db.commit()
    rows = figures(w, ADMIN, HELP)["waiting"]
    assert [r["document_id"] for r in rows] == [71, 70, 72, 91, 90, 89, 88, 87, 86, 85]            # ten, the oldest first
    assert rows[0] == {"document_id": 71, "title": "Doc 71", "kind": "approval", "stage": "CISO sign-off", "waiting_for": ["Person 14"],
                       "waiting_count": 1, "due_date": (NOW - 9 * DAY - 6 * HOUR).isoformat(), "days_late": 9}
    assert rows[1]["waiting_for"] == ["Person 11", "Person 12"] and rows[1]["stage"] == "Review" and rows[1]["days_late"] == 5       # the late ones, A to Z; not the one still on time
    assert (rows[2]["kind"], rows[2]["stage"], rows[2]["waiting_count"], rows[2]["waiting_for"]) == (
        "acknowledgement", "Acknowledgement", 8, [f"Person {n}" for n in range(20, 25)])               # five named, eight counted
    assert rows[3]["days_late"] == 0 and rows[3]["waiting_for"] == ["Person 30"]
    assert 93 in [r["document_id"] for r in figures(w, ADMIN, OPS)["waiting"]] and 92 not in [r["document_id"] for r in figures(w, ADMIN)["waiting"]]


def test_the_order_of_everything_is_the_same_every_time_and_ties_break_by_name_and_id(w):
    for did, dept, kind in [(3, HELP, "policy"), (1, HELP, "standard"), (2, HELP, "guideline"), (4, HELP, "procedure")]:
        doc(w, did, dept, status="pending_review", doc_type=kind)
        ask(w, did, "review", 11 + did, NOW - 2 * DAY)                                            # the same instant on all four
    w.db.commit()
    first = figures(w, ADMIN)
    assert [r["document_id"] for r in first["waiting"]] == [1, 2, 3, 4]
    assert [t["label"] for t in first["by_type"]] == ["Guideline", "Policy", "Procedure", "Standard"]      # one each: by name
    assert first == figures(w, ADMIN) and ids_of(w, "late_approvals")["ids"] == [1, 2, 3, 4]
    assert [list(r) for r in first["by_status"]] == [["key", "status", "count"]] * 7


def test_archived_documents_are_only_in_the_archived_total(w):
    doc(w, 1, HELP, status="archived", owner=None, next_review_date=NOW - 3 * DAY, doc_type="charter")
    ask(w, 1, "review", 11, NOW - 30 * DAY); ask(w, 1, "acknowledgement", 11, NOW - 30 * DAY); hold(w, 1, None)
    doc(w, 2, HELP, status="published")
    w.db.commit()
    f = figures(w)
    assert f["totals"] == {"documents": 1, "in_force": 1, "in_progress": 0, "expired": 0, "exception_applied": 0, "archived": 1}
    assert [t["doc_type"] for t in f["by_type"]] == ["policy"] and f["waiting"] == [] and f["stages"] == []
    assert f["reviews"] == {"overdue": 0, "due_soon": 0, "unscheduled": 1, "up_to_date": 0}
    assert f["requests"]["review"]["pending"] == 0 and f["requests"]["acknowledgement"]["pending"] == 0
    assert {k: v for k, v in f["issues"].items()} == {"no_owner": 0, "expired": 0, "exception_applied": 0, "stuck": 0, "on_hold": 0,
                                                       "late_acknowledgements": 0, "late_approvals": 0, "documents": 0}
    assert [ids_of(w, k)["ids"] for k in S.KINDS] == [[], [], [], []]
    assert f["links"]["totals.archived"] == {"status": "archived"}


# ── the library links ────────────────────────────────────────────────────────

def test_every_figure_has_the_address_that_opens_the_library_on_it(w):
    doc(w, 1, SUP, doc_type="policy"); doc(w, 2, SUP, doc_type="standard", status="draft")
    w.db.commit()
    whole, scoped, none = figures(w), figures(w, ADMIN, SUP), figures(w, ADMIN, "none")
    assert whole["links"]["totals.documents"] == {} and whole["links"]["totals.in_force"] == {"status": "published"}
    assert scoped["links"]["totals.documents"] == {"dept": str(SUP)} and none["links"]["totals.documents"] == {"dept": "none"}
    assert scoped["links"]["totals.in_progress"] == {"dept": str(SUP), "status": "draft,pending_review,pending_approval,approved"}
    assert scoped["links"]["type:policy"] == {"dept": str(SUP), "type": "policy"}
    assert scoped["links"]["type:policy:in_force"] == {"dept": str(SUP), "type": "policy", "status": "published"}
    assert scoped["links"]["status:draft"] == {"dept": str(SUP), "status": "draft"}
    assert scoped["links"]["issues.no_owner"] == {"dept": str(SUP), "owner": "none"}
    for kind in S.KINDS:
        assert scoped["links"][f"issues.{kind}"] == {"dept": str(SUP), "attn": kind}
    for row in scoped["by_type"]:
        assert row["key"] in scoped["links"] and row["in_force_key"] in scoped["links"]
    for row in scoped["by_status"] + scoped["stages"] + scoped["by_department"]:
        assert row["key"] in scoped["links"]
    # every address carries the scope, none says another department; the rows of the department table carry their own (the scope or under it)
    assert all(v.get("dept") in (None, str(SUP)) for k, v in scoped["links"].items() if not k.startswith("dept:"))
    assert scoped["links"][f"dept:{HELP}"] == {"dept": str(HELP)} and scoped["links"][f"dept:{HELP}:in_force"] == {"dept": str(HELP), "status": "published"}
    assert scoped["links"][f"dept:{SUP}:in_progress"] == {"dept": str(SUP), "status": "draft,pending_review,pending_approval,approved"}
    assert scoped["links"][f"dept:{SUP}:overdue_reviews"] == {"dept": str(SUP), "review": "overdue"}
    assert whole["links"]["dept:" + str(OPS)] == {"dept": str(OPS)} and none["links"] == {k: v for k, v in none["links"].items() if not k.startswith("dept:")}


# ── the table by department ──────────────────────────────────────────────────

def test_by_department_is_the_tree_of_the_scope_with_what_is_in_each_department_and_below_it(w):
    """Operations (10) > Support (11) > Helpdesk (12); Finance (13) > Legacy (14, switched off)."""
    doc(w, 1, OPS, status="draft")                                         # in progress, directly in Operations
    doc(w, 2, SUP, next_review_date=NOW - DAY)                             # in force, review overdue
    doc(w, 3, SUP, owner=None)                                             # in force, no owner: an issue
    doc(w, 4, HELP, status="pending_review"); ask(w, 4, "review", 11, NOW - 30 * DAY)       # in progress, late and stuck: an issue
    doc(w, 5, HELP, status="archived")                                     # archived: in no figure
    doc(w, 6, FINANCE)                                                     # in force
    doc(w, 7, None)                                                        # no department
    doc(w, 8, 4242)                                                        # a department that is gone (old data): in the totals, in no row
    w.db.commit()
    whole = figures(w, ADMIN)
    rows = {r["department_id"]: r for r in whole["by_department"]}
    # picker order (A-Z, each followed by what is under it); a switched-off department with nothing in it is left out; "No department" is last
    assert [r["name"] for r in whole["by_department"]] == ["Finance", "Operations", "Support", "Helpdesk", "No department"]
    assert [r["depth"] for r in whole["by_department"]] == [0, 0, 1, 2, 0]
    assert [r["level_label"] for r in whole["by_department"]] == ["Department", "Department", "Sub-department", "Unit", ""]
    figs = lambda r: (r["own"], r["documents"], r["in_force"], r["in_progress"], r["overdue_reviews"], r["issues"])      # noqa: E731
    assert figs(rows[OPS]) == (1, 4, 2, 2, 1, 2)                           # itself and below: 1, 2, 3, 4 (not the archived 5)
    assert figs(rows[SUP]) == (2, 3, 2, 1, 1, 2)
    assert figs(rows[HELP]) == (1, 1, 0, 1, 0, 1)
    assert figs(rows[FINANCE]) == (1, 1, 1, 0, 0, 0)
    assert figs(rows[None]) == (1, 1, 1, 0, 0, 0)
    assert rows[HELP]["path"] == ["Operations", "Support", "Helpdesk"] and rows[HELP]["level"] == 3 and rows[None]["path"] == []
    assert whole["totals"]["documents"] == 7                               # the one in a gone department is in the totals and in no row
    # the owner (head) of each department is named; a department with none says so
    assert (rows[OPS]["owner"], rows[SUP]["owner"], rows[HELP]["owner"], rows[FINANCE]["owner"]) == ("Tom", "Mia", "Leo", "Fay") and rows[None]["owner"] is None
    # the scope is the root: a department shows itself and what is under it, depth counted from it
    sup = figures(w, ADMIN, SUP)["by_department"]
    assert [(r["name"], r["depth"]) for r in sup] == [("Support", 0), ("Helpdesk", 1)] and figs(sup[0]) == figs(rows[SUP])
    assert [r["name"] for r in figures(w, ADMIN, HELP)["by_department"]] == ["Helpdesk"]
    assert figures(w, ADMIN, "none")["by_department"] == []                # "No department" is no tree
    # a switched-off department shows once something is filed in it (and its parent with it)
    doc(w, 9, LEGACY)
    w.db.commit()
    again = figures(w, ADMIN)["by_department"]
    assert [r["name"] for r in again] == ["Finance", "Legacy", "Operations", "Support", "Helpdesk", "No department"]
    assert next(r for r in again if r["name"] == "Legacy")["is_active"] is False and figs(next(r for r in again if r["name"] == "Finance")) == (1, 2, 2, 0, 0, 0)
    # a head without a library right gets the table of their own departments, with the numbers of what they read (all of it)
    mine = figures(w, MID)["by_department"]
    assert [(r["name"], r["documents"]) for r in mine] == [("Support", 3), ("Helpdesk", 1)]
    # the library reader's table counts what they read: the draft in Operations and the late one in the Helpdesk are not theirs
    reader = {r["name"]: r["documents"] for r in figures(w, READER)["by_department"]}
    assert reader["Operations"] == 2 and reader["Helpdesk"] == 0 and reader["Support"] == 2


# ── the department table's breakdowns, the board and the export (D60) ────────

def seed_matrix(w):
    """Operations (10) > Support (11) > Helpdesk (12); Finance (13). Seven documents of every kind and a few requests, at NOW."""
    doc(w, 1, OPS, status="draft", next_review_date=None)                                  # a policy
    doc(w, 2, SUP, next_review_date=NOW - DAY)                                             # a policy in force, its review overdue
    doc(w, 3, SUP, doc_type="procedure", owner=None, next_review_date=None)                # in force, no owner, no review date
    doc(w, 4, HELP, status="pending_review", doc_type="standard", next_review_date=None)   # a review asked 30 days ago: late and stuck
    ask(w, 4, "review", 11, NOW - 30 * DAY)
    doc(w, 5, HELP, status="pending_approval", next_review_date=None)                      # an approval due in three days: waiting, not late
    ask(w, 5, "approval", 12, NOW + 3 * DAY)
    doc(w, 6, FINANCE, doc_type="guideline", next_review_date=None)                        # in force: one acknowledgement late, one not yet due
    ask(w, 6, "acknowledgement", 13, NOW - DAY)
    ask(w, 6, "acknowledgement", 14, NOW + 5 * DAY)
    doc(w, 7, None, next_review_date=None)                                                 # in force, in no department
    w.db.commit()


def test_each_department_row_breaks_its_documents_down_by_status_type_waiting_reviews_and_issues(w):
    seed_matrix(w)
    rows = {r["department_id"]: r for r in figures(w, ADMIN)["by_department"]}
    ops, sup, help_, fin, none = rows[OPS], rows[SUP], rows[HELP], rows[FINANCE], rows[None]
    # operations: itself and below, in the order of the approval flow
    assert list(ops["by_status"].items()) == [("draft", 1), ("pending_review", 1), ("pending_approval", 1), ("published", 2)]
    assert ops["by_type"] == {"policy": 3, "procedure": 1, "standard": 1}
    assert ops["waiting"] == {"review": {"pending": 1, "overdue": 1}, "approval": {"pending": 1, "overdue": 0}, "acknowledgement": {"pending": 0, "overdue": 0}}
    assert ops["reviews"] == {"overdue": 1, "due_soon": 0, "unscheduled": 1}                # 2 is overdue, 3 has no date; a draft and a document in review owe none
    assert ops["issues_by"] == {"stuck": 1, "on_hold": 0, "late_approvals": 1, "late_acknowledgements": 0, "no_owner": 1}
    assert (ops["documents"], ops["in_force"], ops["in_progress"], ops["overdue_reviews"], ops["issues"]) == (5, 2, 3, 1, 2)       # the figures that were there are the same
    # a department under it counts what is in it and below it, and the requests of the documents there
    assert (sup["documents"], sup["by_status"], sup["waiting"]["review"]) == (4, {"pending_review": 1, "pending_approval": 1, "published": 2}, {"pending": 1, "overdue": 1})
    assert help_["by_status"] == {"pending_review": 1, "pending_approval": 1} and help_["by_type"] == {"policy": 1, "standard": 1}
    assert help_["reviews"] == {"overdue": 0, "due_soon": 0, "unscheduled": 0}
    assert help_["issues_by"] == {"stuck": 1, "on_hold": 0, "late_approvals": 1, "late_acknowledgements": 0, "no_owner": 0}
    # acknowledgements count as requests of the department the document is filed in; a late one on a document in force is an issue
    assert fin["waiting"]["acknowledgement"] == {"pending": 2, "overdue": 1} and fin["waiting"]["review"] == {"pending": 0, "overdue": 0}
    assert fin["issues_by"]["late_acknowledgements"] == 1 and fin["issues"] == 1 and fin["by_type"] == {"guideline": 1}
    # "No department" has the same breakdowns
    assert (none["documents"], none["by_status"], none["by_type"], none["reviews"]["unscheduled"]) == (1, {"published": 1}, {"policy": 1}, 1)
    # the rows add up: the top departments and "No department" are every document (all filed somewhere that exists), the requests are all of them
    top = [r for r in rows.values() if r["depth"] == 0]
    assert sum(r["documents"] for r in top) == figures(w, ADMIN)["totals"]["documents"] == 7
    assert sum(r["waiting"][k]["pending"] for r in top for k in ("review", "approval", "acknowledgement")) == 4
    assert sum(r["by_status"].get("published", 0) for r in top) == figures(w, ADMIN)["totals"]["in_force"]
    # a scope shows its own breakdowns, and what a person may not read is in none of them
    assert figures(w, ADMIN, SUP)["by_department"][0]["by_type"] == sup["by_type"]
    reader = {r["department_id"]: r for r in figures(w, READER)["by_department"]}
    assert reader[OPS]["by_status"] == {"published": 2} and reader[OPS]["waiting"]["review"] == {"pending": 0, "overdue": 0}       # the documents in review are not READER's to see
    assert reader[FINANCE]["waiting"]["acknowledgement"] == {"pending": 2, "overdue": 1}


def board(w, uid=ADMIN, department=None, group="status", per=S.BOARD_CARDS, now=NOW):
    w.db.commit()
    return S.board(w.db, user(w, uid), None if department is None else str(department), group, per, now=now)


def test_the_board_by_status_lists_the_flow_with_true_counts_and_the_most_urgent_cards(w):
    seed_matrix(w)
    for did in (8, 9):
        doc(w, did, SUP, next_review_date=NOW + 60 * DAY)                                   # two more clean documents in force
    doc(w, 10, FINANCE, status="expired", next_review_date=None)
    doc(w, 11, FINANCE, status="archived", next_review_date=None)                           # archived: on no board
    b = board(w, per=3)
    assert (b["group"], b["per"], b["total"], b["scope"]["whole_organisation"]) == ("status", 3, 10, True)
    assert [(c["value"], c["label"], c["count"]) for c in b["columns"]] == [
        ("draft", "Draft", 1), ("pending_review", "In review", 1), ("pending_approval", "In approval", 1), ("approved", "Approved", 0), ("published", "Published", 6),
        ("attention", "Needs attention", 1)]                                                # the expired one: every other live status is in the one last column
    assert [c["key"] for c in b["columns"]][:2] == ["status:draft", "status:pending_review"] and b["columns"][-1]["key"] == "status:attention"
    published = next(c for c in b["columns"] if c["value"] == "published")
    assert (len(published["cards"]), published["more"]) == (3, 3)                           # the true count is 6; three cards are listed, three are not
    assert {c["id"] for c in published["cards"]} == {2, 3, 6}                               # the ones with something wrong come first (2: review overdue, 3: no owner, 6: a late acknowledgement)
    assert next(c for c in b["columns"] if c["value"] == "approved") == {"key": "status:approved", "label": "Approved", "value": "approved", "count": 0, "cards": [], "more": 0}
    card = next(c for c in b["columns"] if c["value"] == "pending_review")["cards"][0]
    assert card == {"id": 4, "title": "Doc 4", "code": None, "doc_type": "standard", "type_label": "Standard", "status": "pending_review", "version": "1.0",
                    "department_id": HELP, "department": "Helpdesk", "owner": "Ada", "next_review": None, "flags": ["stuck", "late_approvals"],
                    "attestation": {"state": "none", "done": None, "total": None}}
    assert next(c for c in published["cards"] if c["id"] == 3)["flags"] == ["no_owner"] and next(c for c in published["cards"] if c["id"] == 3)["owner"] is None
    assert next(c for c in published["cards"] if c["id"] == 2)["flags"] == ["overdue_review"]
    assert board(w, per=1)["columns"][0]["more"] == 0                                       # nothing left out of a column that fits
    assert board(w, per=999)["per"] == S.BOARD_MAX                                          # a long column is cut at most at the limit
    # nothing has expired in Operations: the last column is still there, empty, and holds no status
    ops = board(w, department=OPS)["columns"]
    assert ops[-1] == {"key": "status:attention", "label": "Needs attention", "value": "attention", "statuses": [], "count": 0, "cards": [], "more": 0}
    assert "expired" not in {c["value"] for c in ops}


def test_the_board_by_type_and_by_department(w):
    seed_matrix(w)
    types = board(w, group="type")["columns"]
    assert [(c["value"], c["label"], c["count"]) for c in types] == [("policy", "Policy", 4), ("guideline", "Guideline", 1), ("procedure", "Procedure", 1), ("standard", "Standard", 1)]
    # by department: the top departments of the whole organisation, then "No department"
    cols = board(w, group="department")["columns"]
    assert [(c["label"], c["value"], c["count"], c["own"]) for c in cols] == [("Finance", str(FINANCE), 1, False), ("Operations", str(OPS), 5, False), ("No department", "none", 1, False)]
    # under a department: its own documents, then each department directly under it (with everything in that one)
    under = board(w, department=OPS, group="department")["columns"]
    assert [(c["label"], c["department_id"], c["count"], c["own"]) for c in under] == [("Operations", OPS, 1, True), ("Support", SUP, 4, False)]
    assert [(c["label"], c["count"], c["own"]) for c in board(w, department=SUP, group="department")["columns"]] == [("Support", 2, True), ("Helpdesk", 2, False)]
    assert [(c["label"], c["count"]) for c in board(w, department=HELP, group="department")["columns"]] == [("Helpdesk", 2)]
    assert [(c["label"], c["count"]) for c in board(w, department="none", group="department")["columns"]] == [("No department", 1)]
    # a department scope with nothing under it still has a column for the scope
    assert board(w, department=FINANCE, group="department")["columns"][0]["count"] == 1
    # a switched-off department with nothing in it has no column; with a document it has
    assert LEGACY not in {c["department_id"] for c in board(w, department=FINANCE, group="department")["columns"]}
    doc(w, 12, LEGACY)
    assert [(c["label"], c["count"]) for c in board(w, department=FINANCE, group="department")["columns"]] == [("Finance", 1), ("Legacy", 1)]


def test_the_board_asks_for_the_same_rights_as_the_figures_and_counts_only_what_the_person_may_read(w):
    seed_matrix(w)
    b = lambda uid, **q: get(w, uid, path=URL + "/board", **q)                              # noqa: E731
    assert b(PLAIN).status_code == 403 and b(PLAIN).json()["detail"] == REFUSED
    assert b(ADMIN, group="nonsense").status_code == 400 and b(ADMIN, per=0).status_code == 422
    assert b(ADMIN, department=999).status_code == 404 and b(MID, department=OPS).status_code == 403 and b(MID, department=OPS).json()["detail"] == S.NOT_YOURS
    ok = b(MID)                                                                             # the head of Support, who reads no library: their scope, all of it
    assert ok.status_code == 200 and ok.json()["scope"]["department_id"] == SUP and ok.json()["total"] == 4
    reader = board(w, READER)                                                               # a library reader: what is in force, none of the documents in review
    assert reader["total"] == 4 and {c["value"] for c in reader["columns"] if c["count"]} == {"published"}
    assert all(card["id"] not in (1, 4, 5) for c in reader["columns"] for card in c["cards"])


def campaign(w, did, acks, domain="twelve.test", status="active", created=NOW, tenant=1):
    """An attestation campaign on a document, with ``acks`` acknowledgements (the library's coverage numbers read them over the active people on ``domain``)."""
    c = m.DocumentAttestationCampaign(tenant_id=tenant, document_id=did, name=f"Campaign {did}", status=status, public_token=f"token-{did}-{status}",
                                      allowed_email_domain=domain, created_by=ADMIN, created_at=created)
    w.db.add(c)
    w.db.flush()
    for i in range(acks):
        w.db.add(m.DocumentAttestationAcknowledgment(campaign_id=c.id, name=f"P{i}", email=f"p{i}@{domain}", signature_data="data:image/png;base64,AAAA"))
    return c


def twelve_people(w):
    for i in range(12):
        w.db.add(m.GRCUser(id=100 + i, username=f"t{i}", email=f"t{i}@twelve.test", display_name=f"Twelve {i}"))


def card_of(b, did):
    return next(c for col in b["columns"] for c in col["cards"] if c["id"] == did)


def test_every_card_says_where_its_attestation_stands_in_the_librarys_own_numbers(w):
    twelve_people(w)
    doc(w, 1, SUP)                                                                          # no attestation requested
    doc(w, 2, SUP)                                                                          # requested, nobody has acknowledged
    campaign(w, 2, 0)
    doc(w, 3, SUP)                                                                          # 4 of the 12 people on the domain
    campaign(w, 3, 4)
    doc(w, 4, SUP)                                                                          # everyone
    campaign(w, 4, 12)
    doc(w, 5, SUP)                                                                          # a campaign on a domain nobody is on: as in the library, none
    campaign(w, 5, 2, domain="nobody.test")
    doc(w, 6, SUP, status="draft")                                                          # a closed campaign is the latest when none is active
    campaign(w, 6, 3, status="closed")
    doc(w, 7, SUP)                                                                          # an active older one wins over a newer closed one
    campaign(w, 7, 6, created=NOW - 9 * DAY)
    campaign(w, 7, 12, status="closed", created=NOW)
    w.db.commit()
    expected = [{"state": "none", "done": None, "total": None}, {"state": "not_started", "done": 0, "total": 12}, {"state": "in_progress", "done": 4, "total": 12},
                {"state": "complete", "done": 12, "total": 12}, {"state": "none", "done": None, "total": None}, {"state": "in_progress", "done": 3, "total": 12},
                {"state": "in_progress", "done": 6, "total": 12}]
    for group in ("status", "type", "department"):
        assert [card_of(board(w, department=SUP, group=group), did)["attestation"] for did in range(1, 8)] == expected, group
    # the numbers are the library's: the lean list's attestation_by_document gives the same done / total for the same documents
    lean = library_lean.attestation_by_document(w.db, [1], range(1, 8))
    on_board = {did: card_of(board(w, department=SUP), did)["attestation"] for did in range(1, 8)}
    assert {did: (a["done"], a["total"]) for did, a in on_board.items() if a["state"] != "none"} == {did: (a["done"], a["total"]) for did, a in lean.items()}
    assert {did for did, a in on_board.items() if a["state"] == "none"} == set(range(1, 8)) - set(lean)
    # the words (D41: short), the same on the card and in the CSV
    words = ["No attestation", "Attestation not started", "Attestation: 4 of 12 acknowledged", "Everyone acknowledged"]
    assert [S._attestation_words(on_board[did]) for did in (1, 2, 3, 4)] == words
    rows = {r[1]: r[9] for r in csv_rows(S.export_documents(w.db, user(w, ADMIN), str(SUP), now=NOW)[0])[1:]}
    assert [rows[f"Doc {did}"] for did in (1, 2, 3, 4)] == words


def test_the_attestation_is_read_for_the_cards_shown_in_a_fixed_number_of_queries_and_only_for_documents_the_person_may_read(w):
    twelve_people(w)
    for did in range(1, 31):
        doc(w, did, SUP)
        campaign(w, did, did % 13)
    doc(w, 40, SUP, status="pending_review")                                                # in review: not a library reader's to read
    campaign(w, 40, 5)
    doc(w, 41, FINANCE, tenant=2)                                                           # another organisation's: never read
    campaign(w, 41, 5, tenant=2)
    w.db.commit()
    seen = []
    event.listen(w.engine, "before_cursor_execute", lambda conn, cursor, statement, params, context, many: seen.append(statement))
    board(w, READER, group="type", per=1)                                                   # (the first request of a person notes their activity, and the tables are checked once)
    seen.clear()
    reader = board(w, READER, group="type", per=5)                                          # five cards shown
    few = len(seen)
    assert sum(len(c["cards"]) for c in reader["columns"]) == 5 and reader["total"] == 30 and any("attestation" in s for s in seen)
    seen.clear()
    more = board(w, READER, group="type", per=30)                                           # thirty cards cost the same statements as five
    assert sum(len(c["cards"]) for c in more["columns"]) == 30 and len(seen) == few
    assert all(card["id"] not in (40, 41) for c in more["columns"] for card in c["cards"])
    admin = board(w, ADMIN, group="type", per=50)                                           # an administrator reads the one in review too, never the other organisation's
    assert card_of(admin, 40)["attestation"] == {"state": "in_progress", "done": 5, "total": 12}
    assert all(card["id"] != 41 for c in admin["columns"] for card in c["cards"]) and admin["total"] == 31


def test_the_status_board_ends_in_one_needs_attention_column_that_counts_every_other_live_status_once(w):
    doc(w, 1, SUP, status="draft")
    doc(w, 2, SUP)
    doc(w, 3, SUP, status="expired")
    doc(w, 4, SUP, status="exception_applied")
    doc(w, 5, SUP, status="expired")
    doc(w, 6, SUP, status="review_required")
    doc(w, 7, SUP, status="archived")                                                       # archived: on no board, in no column
    w.db.commit()
    b = board(w, department=SUP)
    assert [c["value"] for c in b["columns"]] == ["draft", "pending_review", "pending_approval", "approved", "published", "attention"]
    last = b["columns"][-1]
    assert (last["key"], last["label"], last["value"], last["count"], last["more"]) == ("status:attention", "Needs attention", "attention", 4, 0)
    assert last["statuses"] == ["expired", "exception_applied", "review_required"]          # the ones that have a document: the flow's order first, then any other
    assert sorted(c["id"] for c in last["cards"]) == [3, 4, 5, 6] and {c["status"] for c in last["cards"]} == set(last["statuses"])      # the cards say which status
    assert all("statuses" not in c for c in b["columns"][:-1])                              # the five steps keep their shape
    assert sum(c["count"] for c in b["columns"]) == b["total"] == 6                         # each live document is counted once, in exactly one column
    # a long column keeps its true count and lists only the most urgent cards
    for did in range(10, 20):
        doc(w, did, SUP, status="expired")
    w.db.commit()
    long = board(w, department=SUP, per=3)["columns"][-1]
    assert (long["count"], len(long["cards"]), long["more"]) == (14, 3, 11)
    # the other groupings have no such column; a scope with nothing to attend to has the column, empty
    assert all(c["value"] != "attention" for g in ("type", "department") for c in board(w, department=SUP, group=g)["columns"])
    assert board(w, department=FINANCE)["columns"][-1]["count"] == 0
    # a person who reads only what is in force has an empty last column: what is expired is not theirs to read
    assert board(w, READER)["columns"][-1] == {"key": "status:attention", "label": "Needs attention", "value": "attention", "statuses": [], "count": 0, "cards": [], "more": 0}


BOM = chr(0xFEFF)                                                           # the byte-order mark Excel reads as UTF-8


def csv_rows(text):
    import csv as csv_module
    import io
    return list(csv_module.reader(io.StringIO(text.lstrip(BOM))))


def test_the_export_is_a_csv_of_the_documents_in_scope_with_what_is_wrong_with_each(w):
    seed_matrix(w)
    doc(w, 8, SUP, next_review_date=NOW + 60 * DAY)
    doc(w, 9, FINANCE, status="archived", next_review_date=None)
    w.db.commit()
    text, name = S.export_documents(w.db, user(w, ADMIN), None, now=NOW)
    assert text.startswith(BOM) and name == "documents-whole-organisation-2026-11-04.csv"
    rows = csv_rows(text)
    assert rows[0] == ["Code", "Title", "Type", "Status", "Version", "Department", "Owner", "Next review", "Issues", "Attestation"]       # no internal id: nobody can use it (UX rule U1)
    assert len(rows) == 1 + 8                                                               # the archived one is left out, as in every figure
    by_title = {r[1]: r for r in rows[1:]}
    assert by_title["Doc 4"] == ["", "Doc 4", "Standard", "In review", "1.0", "Operations > Support > Helpdesk", "Ada", "", "Stuck in a stage; Late approval", "No attestation"]
    assert by_title["Doc 2"][3:] == ["Published", "1.0", "Operations > Support", "Ada", "2026-11-03", "Review overdue", "No attestation"]
    assert by_title["Doc 3"][6] == "" and by_title["Doc 3"][8] == "No owner" and by_title["Doc 7"][5] == "" and by_title["Doc 6"][8] == "Late acknowledgement"
    assert [r[5] for r in rows[1:]] == sorted((r[5] for r in rows[1:]), key=str.casefold)       # in department order, then by title
    # a scope is its own file; the file's name says which
    scoped, scoped_name = S.export_documents(w.db, user(w, ADMIN), str(SUP), now=NOW)
    assert scoped_name == "documents-support-2026-11-04.csv" and sorted(r[1] for r in csv_rows(scoped)[1:]) == ["Doc 2", "Doc 3", "Doc 4", "Doc 5", "Doc 8"]
    # a title a spreadsheet would run as a formula is text
    for did, title in [(20, '=HYPERLINK("http://evil.test","x")'), (21, "+1+1"), (22, "-2+3"), (23, "@SUM(A1)"), (24, "\tTabbed")]:
        doc(w, did, FINANCE).title = title
    w.db.commit()
    titles = {r[1] for r in csv_rows(S.export_documents(w.db, user(w, ADMIN), str(FINANCE), now=NOW)[0])[1:]}
    assert {"'" + '=HYPERLINK("http://evil.test","x")', "'+1+1", "'-2+3", "'@SUM(A1)", "'\tTabbed"} <= titles
    assert not any(t[:1] in "=+-@\t\r" for t in titles if t)                                # none is left for a spreadsheet to run
    assert "Doc 6" in titles                                                                # an ordinary title is untouched


def test_the_export_is_an_attachment_and_asks_for_the_same_rights_as_the_figures(w):
    seed_matrix(w)
    r = get(w, ADMIN, path=URL + "/export")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert re.fullmatch(r'attachment; filename="documents-whole-organisation-\d{4}-\d{2}-\d{2}\.csv"', r.headers["content-disposition"])
    assert r.content.startswith(b"\xef\xbb\xbf") and len(csv_rows(r.content.decode("utf-8"))) == 1 + 7
    mine = get(w, MID, path=URL + "/export")                                                # the head of Support: their own scope
    assert mine.status_code == 200 and "documents-support-" in mine.headers["content-disposition"] and len(csv_rows(mine.content.decode("utf-8"))) == 1 + 4
    assert get(w, PLAIN, path=URL + "/export").status_code == 403
    assert get(w, MID, OPS, path=URL + "/export").status_code == 403 and get(w, ADMIN, 999, path=URL + "/export").status_code == 404
    reader = csv_rows(get(w, READER, path=URL + "/export").content.decode("utf-8"))        # what a library reader may read: the documents in force
    assert {r[1] for r in reader[1:]} == {"Doc 2", "Doc 3", "Doc 6", "Doc 7"}
    assert S.STATUS_WORDS["pending_review"] == "In review"


def test_the_pdf_export_is_a_pdf_of_the_same_figures_under_the_same_rights(w):
    import io

    from PyPDF2 import PdfReader

    def words(content: bytes) -> str:
        return " ".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(content)).pages)

    seed_matrix(w)
    r = get(w, ADMIN, path=URL + "/export/pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert re.fullmatch(r'attachment; filename="at-a-glance-whole-organisation-\d{4}-\d{2}-\d{2}\.pdf"', r.headers["content-disposition"])
    whole = words(r.content)
    assert "At a glance" in whole and "Whole organisation" in whole and "Published" in whole and "In force" not in whole
    assert "Finance" in whole and "Support" in whole and "Waiting on people" in whole
    mine = get(w, MID, path=URL + "/export/pdf")                                           # the head of Support: their own scope, and nothing of Finance
    assert mine.status_code == 200 and "at-a-glance-support-" in mine.headers["content-disposition"]
    assert "Support" in words(mine.content) and "Finance" not in words(mine.content)
    assert get(w, PLAIN, path=URL + "/export/pdf").status_code == 403
    assert get(w, MID, OPS, path=URL + "/export/pdf").status_code == 403 and get(w, ADMIN, 999, path=URL + "/export/pdf").status_code == 404


# ── queries, writes ──────────────────────────────────────────────────────────

def test_the_number_of_queries_does_not_depend_on_the_number_of_documents_or_departments(w):
    seen = []
    event.listen(w.engine, "before_cursor_execute", lambda conn, cursor, statement, params, context, many: seen.append(statement))
    n = {"doc": 100, "dept": 100}

    def grow(departments, documents):
        for _ in range(departments):
            n["dept"] += 1
            w.db.add(m.GRCDepartment(id=n["dept"], tenant_id=1, name=f"Unit {n['dept']}", code=f"U{n['dept']}", parent_department_id=OPS if n["dept"] % 2 else FINANCE))
        for k in range(documents):
            n["doc"] += 1
            status = ("pending_review", "pending_approval", "published", "draft")[k % 4]
            doc(w, n["doc"], n["dept"] if k % 3 else HELP, status=status, owner=TOP if k % 5 == 0 else ADMIN, next_review_date=NOW - DAY * (k % 9 - 3),
                signoff_round_at=NOW)
            if status in S.PENDING:
                ask(w, n["doc"], "review" if status == "pending_review" else "approval", 11 + k % 20, NOW - DAY * (k % 12))
                if k % 2:
                    hold(w, n["doc"], NOW)
            if k % 7 == 0:
                route(w, n["doc"], ("Stage one", "review"), ("Stage two", "approval"))
            if status == "published":
                ask(w, n["doc"], "acknowledgement", 11 + k % 25, NOW - DAY * (k % 5))
        w.db.commit()

    def cost(uid, **params):
        client = w.as_(uid)
        client.get(URL, params=params)                                       # (the first request of a person also notes their activity)
        seen.clear()
        assert client.get(URL, params=params).status_code == 200
        total = len(seen)
        seen.clear()
        assert client.get(URL + "/ids", params={"kind": "stuck", **params}).status_code == 200
        return total, len(seen)

    grow(2, 8)
    few = {(uid, tuple(p.items())): cost(uid, **p) for uid, p in [(ADMIN, {}), (TOP, {}), (READER, {"department_id": OPS})]}
    grow(40, 400)
    for (uid, params), was in few.items():
        assert cost(uid, **dict(params)) == was, (uid, params)                  # 400 more documents in 40 more departments cost the same statements


def test_nothing_is_written(w):
    doc(w, 1, HELP, status="pending_review"); ask(w, 1, "review", 11, NOW - 20 * DAY)
    doc(w, 2, HELP, status="published"); ask(w, 2, "acknowledgement", 11, NOW - 20 * DAY)
    hold(w, 1, None)
    w.db.commit()
    writes = []
    event.listen(w.engine, "before_cursor_execute",
                 lambda conn, cursor, statement, params, context, many: writes.append(statement) if statement.lstrip()[:6].upper() in ("INSERT", "UPDATE", "DELETE") else None)
    before = {t: w.db.query(t).count() for t in (m.GovernanceDocument, m.DocumentObligation, m.DocumentRouteHold, m.DocumentRouteStage, m.GRCDepartment)}
    get(w, ADMIN)                                                           # (a person's first request notes their activity: not ours)
    writes.clear()
    for uid in (ADMIN, TOP, READER):
        assert get(w, uid).status_code == 200 and get(w, uid, path=URL + "/ids", kind="stuck").status_code == 200
    ours = [s for s in writes if any(t in s for t in ("grc_governance_documents", "grc_document_", "grc_departments"))]
    assert ours == []
    w.db.expire_all()
    assert before == {t: w.db.query(t).count() for t in before}
    assert w.db.get(m.DocumentObligation, 1).status == "pending" and w.db.get(m.DocumentObligation, 1).escalation_level == 0


def test_the_response_has_the_documented_shape(w):
    doc(w, 1, HELP, status="pending_review"); ask(w, 1, "review", 11, NOW - 20 * DAY)
    w.db.commit()
    r = get(w, ADMIN, HELP)
    assert r.status_code == 200
    body = r.json()
    assert list(body) == ["scope", "choices", "as_of", "totals", "by_type", "by_status", "by_department", "stages", "requests", "waiting", "reviews", "issues",
                          "links"]
    assert set(body["by_department"][0]) == {"key", "department_id", "name", "path", "level", "level_label", "depth", "is_active", "owner", "own", "documents",
                                             "in_force", "in_progress", "overdue_reviews", "issues", "by_status", "by_type", "waiting", "reviews", "issues_by"}
    assert set(body["scope"]) == {"value", "department_id", "name", "path", "level", "level_label", "whole_organisation", "includes_below"}
    assert set(body["choices"][0]) == {"value", "department_id", "name", "path", "level", "level_label", "is_active"}
    assert set(body["waiting"][0]) == {"document_id", "title", "kind", "stage", "waiting_for", "waiting_count", "due_date", "days_late"}
    assert set(body["requests"]["review"]) == {"pending", "overdue", "due_soon", "oldest_days_late"}
    assert datetime.fromisoformat(body["as_of"]) <= datetime.utcnow()


def test_a_person_given_access_to_a_unit_may_open_the_overview_of_that_unit_and_what_is_under_it(w):
    """Cascading access (grc_department_grants): any level on a unit opens the overview of the unit and below, with only what the level lets them read."""
    doc(w, 1, OPS, status="published", owner=ADMIN)
    doc(w, 2, SUP, status="published", owner=ADMIN)
    doc(w, 3, SUP, status="draft", owner=ADMIN)                            # a draft: a view grant does not read it
    doc(w, 4, HELP, status="published", owner=ADMIN)
    doc(w, 5, FINANCE, status="published", owner=ADMIN)
    w.db.commit()
    assert get(w, EVE, path=URL).status_code == 403                        # no grant yet: not a head, not a reader
    w.db.add(m.GRCDepartmentGrant(tenant_id=1, department_id=SUP, principal_type="user", principal_id=EVE, level="view"))
    w.db.commit()
    first = get(w, EVE)
    assert first.status_code == 200
    assert [c["department_id"] for c in first.json()["choices"]] == [SUP, HELP]            # Support and what is under it, nothing else
    assert get(w, EVE, SUP).json()["totals"]["documents"] == 2             # 2 and 4: the published ones of Support and below
    assert get(w, EVE, OPS).status_code == 403 and get(w, EVE, FINANCE).status_code == 403   # never outside the unit
