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
from grc.modules.governance.router import router as governance_router  # noqa: E402
from grc.routers.auth_router import create_access_token  # noqa: E402

(PLAIN, ADMIN, READER, TOP, MID, LEAF, FIN, EVE, BOTH, EDITOR) = range(1, 11)
OPS, SUP, HELP, FINANCE, LEGACY = 10, 11, 12, 13, 14           # Operations > Support > Helpdesk; Finance > Legacy (switched off)
URL = "/governance/document-overview"
NOW = datetime(2026, 11, 4, 12, 0, 0)
DAY, HOUR = timedelta(days=1), timedelta(hours=1)
REFUSED = "The documents overview is for people who can read the document library and for the head of a department."


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
                                             "in_force", "in_progress", "overdue_reviews", "issues"}
    assert set(body["scope"]) == {"value", "department_id", "name", "path", "level", "level_label", "whole_organisation", "includes_below"}
    assert set(body["choices"][0]) == {"value", "department_id", "name", "path", "level", "level_label", "is_active"}
    assert set(body["waiting"][0]) == {"document_id", "title", "kind", "stage", "waiting_for", "waiting_count", "due_date", "days_late"}
    assert set(body["requests"]["review"]) == {"pending", "overdue", "due_soon", "oldest_days_late"}
    assert datetime.fromisoformat(body["as_of"]) <= datetime.utcnow()
