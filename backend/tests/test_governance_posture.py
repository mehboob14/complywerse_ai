"""The Governance Overview's posture by framework and by department (GET /governance/dashboard/posture): true totals over every document
the caller may read, with the review health of the Documents library.

THE RULE AND HOW IT IS PINNED. The review health is the library's D40 rule, ``reviewable`` and ``reviewState`` in
grc-frontend/src/app/(dashboard)/governance/documents/_workspace/libraryModel.ts (lines ~89-145):

    a review is owed on a document that is not archived or expired and is published, approved, or has a version in force;
    no date -> "unscheduled"; the date is before NOW (an instant) -> "overdue"; whole UTC calendar days from today to the date <= 30
    -> "due_soon"; else "ok". A document a review is not owed on has no bucket.

GOLDEN below is what the REAL TypeScript answered for 35 boundary cases (NOW = 2026-11-01 10:30:00 UTC). It was recorded by importing
that file in Node 24 and calling reviewState()/reviewable() on each case (the generator is scratchpad/ux2/bepost/gen_golden.mjs; the
plan is .agent-context/features/ux-revamp-reports/G6_be_overview_plan.md). If the client rule changes on purpose, regenerate the table and
change posture.review_bucket with it: this file is what tells you they drifted. Three checks stand on it: a Python port of the client rule
(written from the TypeScript) gives the recorded answer, ``in_force_number`` gives the ``version_in_force`` the TypeScript was given, and the
server aggregate - through the route, on a frozen clock, one document per group - counts exactly the recorded bucket for every case. A
seeded random corpus then runs through the route and through the port, group by group.

Over HTTP through the whole governance router, on in-memory SQLite."""
import itertools
import random
from collections import Counter
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import event

import grc.models as m
from grc.modules.governance import permissions, posture
from grc.modules.governance.routers import dashboard

from test_governance_permissions import ADMIN, EDITOR, OWNER, SAM, _grant, world  # noqa: F401  (world is a fixture)

VIEWER, AUDITOR = 14, 15
NOW = datetime(2026, 11, 1, 10, 30, 0)
DAY, DAY_MS = timedelta(days=1), 86_400_000
URL = "/governance/dashboard/posture"

# (case, status, version_in_force the client was given, review date as seconds from NOW or None, bucket the REAL client answered)
GOLDEN = [
    ("published, no date", "published", "1.0", None, "unscheduled"),
    ("published, a second late", "published", "1.0", -1, "overdue"),
    ("published, a year late", "published", "2.0", -31536000, "overdue"),
    ("published, due this very second", "published", "1.0", 0, "due_soon"),
    ("published, a second ahead", "published", "1.0", 1, "due_soon"),
    ("published, later today", "published", "1.0", 18000, "due_soon"),
    ("published, midnight just passed (earlier today)", "published", "1.0", -37800, "overdue"),
    ("published, yesterday evening", "published", "1.0", -39600, "overdue"),
    ("published, tomorrow", "published", "1.0", 86400, "due_soon"),
    ("published, in 29 days", "published", "1.0", 2505600, "due_soon"),
    ("published, in exactly 30 days", "published", "1.0", 2592000, "due_soon"),
    ("published, 30 days plus the rest of the day (30d 13h 29m)", "published", "1.0", 2640564, "due_soon"),
    ("published, last second of the 30th calendar day", "published", "1.0", 2640599, "due_soon"),
    ("published, first second of the 31st calendar day", "published", "1.0", 2640600, "ok"),
    ("published, in 31 days", "published", "1.0", 2678400, "ok"),
    ("published, in 90 days", "published", "1.0", 7776000, "ok"),
    ("approved, overdue", "approved", None, -259200, "overdue"),
    ("approved, due soon", "approved", None, 864000, "due_soon"),
    ("approved, up to date", "approved", None, 17280000, "ok"),
    ("approved, no date", "approved", None, None, "unscheduled"),
    ("draft that was never published, overdue date", "draft", None, -259200, None),
    ("draft that was never published, no date", "draft", None, None, None),
    ("draft with a version in force, overdue", "draft", "1.0", -259200, "overdue"),
    ("draft with a version in force, no date", "draft", "1.0", None, "unscheduled"),
    ("pending_review with a version in force, due soon", "pending_review", "1.0", 1036800, "due_soon"),
    ("pending_approval with a version in force, up to date", "pending_approval", "2.0", 8640000, "ok"),
    ("pending_review never published, due soon", "pending_review", None, 1036800, None),
    ("review_required with a version in force, overdue", "review_required", "1.0", -86400, "overdue"),
    ("review_required never published, overdue", "review_required", None, -86400, None),
    ("expired, overdue", "expired", None, -86400, None),
    ("expired, no date", "expired", None, None, None),
    ("exception_applied, overdue", "exception_applied", None, -86400, None),
    ("archived, overdue", "archived", None, -86400, None),
    ("archived, no date", "archived", None, None, None),
    ("unknown status, overdue", "retired", None, -86400, None),
]
WORDS = {"ok": "current", "due_soon": "due", "overdue": "overdue", "unscheduled": "no_review_date", None: None}      # the client's words -> the rows'
FIELDS = ("documents", "current", "due", "overdue", "no_review_date", "on_time_pct", "due_30d", "needs_attention", "attention", "open_exceptions")


def _ms(when):
    """Date.getTime(): whole milliseconds since the epoch."""
    return (when - datetime(1970, 1, 1)) // timedelta(milliseconds=1)


def client_bucket(status, version_in_force, review_date, now):
    """libraryModel.ts reviewable() + reviewState().bucket, line by line, with the browser's millisecond arithmetic."""
    owed = False if status in ("archived", "expired") else (status in ("published", "approved") or bool(version_in_force))
    if review_date is None:
        return "unscheduled" if owed else None
    days = _ms(review_date) // DAY_MS - _ms(now) // DAY_MS             # utcDay(due) - utcDay(now)
    if not owed:
        return None
    if _ms(review_date) < _ms(now):
        return "overdue"
    return "due_soon" if days <= 30 else "ok"


# ── fixtures and helpers ─────────────────────────────────────────────────────
_ids = itertools.count(1000)


def D(**kw):
    """A row for bulk_insert_mappings (so the ORM events that stamp published_version stay out of the way): every column the rules read."""
    return {"id": kw.pop("id", None) or next(_ids), "tenant_id": 1, "title": kw.pop("title", "Policy"), "doc_type": "policy", "status": "published",
            "current_version": "1.0", "published_version": "1.0", **kw}


def put(db, *rows, model=m.GovernanceDocument):
    db.bulk_insert_mappings(model, list(rows), render_nulls=True)       # an explicit None is a NULL (else the column's default, e.g. status "draft", fills it)
    db.commit()


def exc(document_id, status, expiry=None, tenant=1):
    return {"tenant_id": tenant, "title": status, "document_id": document_id, "status": status, "expiry_date": expiry}


@pytest.fixture
def pw(world, monkeypatch):
    """The permissions world with no documents, a view-only reader, an auditor, and a clock that stands at NOW for the route and the old feeds."""
    db = world.db
    db.query(m.PolicyGapFinding).delete()
    db.query(m.PolicyGapAnalysisRun).delete()
    db.query(m.GovernanceDocument).delete()
    db.add_all([m.GRCUser(id=VIEWER, username="vera", email="vera@cfsb.test", display_name="Vera Viewer"),
                m.GRCUser(id=AUDITOR, username="alan", email="alan@cfsb.test", display_name="Alan Auditor")])
    db.commit()
    _grant(db, VIEWER, "governance:policies:view", rid=41)
    _grant(db, AUDITOR, "compliance:frameworks:view", rid=42)

    class Frozen(datetime):
        @classmethod
        def utcnow(cls):
            return NOW

    monkeypatch.setattr(dashboard, "datetime", Frozen)
    monkeypatch.setattr(posture, "datetime", Frozen)
    world.me["id"] = ADMIN
    return world


def get(w, who=ADMIN, **params):
    w.me["id"] = who
    r = w.http.get(URL, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def by_id(body):
    return {r["id"]: r for r in body["rows"]}


def numbers(row):
    return {k: row[k] for k in FIELDS}


# ── 1. the golden table: the rule, pinned to what the real client answered ───
def test_the_port_of_the_client_rule_gives_what_the_real_client_answered():
    wrong = [(case, got, want) for case, status, vif, off, want in GOLDEN
             for got in [client_bucket(status, vif, None if off is None else NOW + timedelta(seconds=off), NOW)] if got != want]
    assert wrong == [] and len(GOLDEN) == 35


def test_the_version_in_force_the_client_was_given_is_the_one_the_server_computes():
    for case, status, vif, _off, _want in GOLDEN:
        row = SimpleNamespace(status=status, current_version=vif if status == "published" else "9.0", published_version=vif)
        assert permissions.in_force_number(row) == vif, case


def golden_rows():
    return [D(id=i, title=case, status=status, current_version=vif if status == "published" else "9.0", published_version=vif,
              next_review_date=None if off is None else NOW + timedelta(seconds=off), department_id=i)
            for i, (case, status, vif, off, _want) in enumerate(GOLDEN, start=1)]


def test_the_server_buckets_every_golden_case_as_the_real_client_does(pw):
    put(pw.db, *golden_rows())
    body = get(pw, by="department", limit=100)
    rows = by_id(body)
    for i, (case, status, _vif, _off, want) in enumerate(GOLDEN, start=1):
        if status == "archived":                                       # the library hides archived documents: they are in no row
            assert i not in rows, case
            continue
        got = {k: rows[i][k] for k in ("current", "due", "overdue", "no_review_date")}
        assert got == {k: int(k == WORDS[want]) for k in got}, (case, got, want)
        assert rows[i]["documents"] == 1, case
    assert body["documents_total"] == sum(1 for g in GOLDEN if g[1] != "archived")


def test_the_one_calendar_day_by_which_the_library_and_the_old_due_counter_differ_is_pinned(pw):
    put(pw.db, *golden_rows())
    rows = get(pw, by="department", limit=100)["rows"]
    overview = pw.http.get("/governance/dashboard/documents-overview").json()["sections"]["reviews"]["counts"]
    # the Overview's own due_30d compares instants (NOW <= date <= NOW + 30 days); the library, and so the posture, counts whole UTC
    # calendar days: the two cases dated later on the 30th calendar day are "due" for the library and not for that counter
    late_on_the_30th = [g[0] for g in GOLDEN if g[4] == "due_soon" and g[3] > 30 * 86400]
    assert late_on_the_30th == ["published, 30 days plus the rest of the day (30d 13h 29m)", "published, last second of the 30th calendar day"]
    assert (overview["due_30d"], sum(r["due"] for r in rows)) == (8, 10)
    # everything else about the review health is the same test in both: the overdue instant, and who is on a schedule at all
    assert overview["overdue"] == sum(r["overdue"] for r in rows) == 7
    assert overview["scheduled_documents"] == sum(r["current"] + r["due"] + r["overdue"] for r in rows) == 22


# ── 2. a corpus with everything in it, against the plain way of counting it ──
def reference(docs, excs, by):
    """The same numbers worked out the plain way from the rows: the client's rule (the port) and the Overview's definitions.
    Returns the numbers of every group, the groups each live document is counted under, and how many open exceptions found a document."""
    soon = NOW + 30 * DAY
    groups, where = {}, {}
    for d in (d for d in docs if d["status"] != "archived"):
        vif = permissions.in_force_number(SimpleNamespace(status=d["status"], current_version=d["current_version"], published_version=d["published_version"]))
        if by == "department":
            keys = [d.get("department_id")]
        else:
            ids = d.get("applicable_framework_ids") or d.get("framework_ids") or []
            keys = list(dict.fromkeys(i for i in ids if type(i) is int)) or [None]
        where[d["id"]] = keys
        word = WORDS[client_bucket(d["status"], vif, d.get("next_review_date"), NOW)]
        expiring = bool(d.get("expiry_date")) and (d["status"] == "approved" or bool(vif)) and NOW <= d["expiry_date"] <= soon
        for k in keys:
            g = groups.setdefault(k, Counter())
            g["documents"] += 1
            g[word] += bool(word)
            g["awaiting"] += d["status"] in ("pending_review", "pending_approval")
            g["expiring"] += expiring
    placed = 0
    for e in excs:
        keys = where.get(e.get("document_id"))
        if keys is None or e["status"] not in ("draft", "pending_approval", "approved"):
            continue
        placed += 1
        attention = e["status"] == "pending_approval" or (e["status"] == "approved" and e.get("expiry_date") is not None and NOW <= e["expiry_date"] <= soon)
        for k in keys:
            groups[k]["open"] += 1
            groups[k]["exc"] += attention
    out = {}
    for k, g in groups.items():
        scheduled = g["current"] + g["due"] + g["overdue"]
        parts = {"overdue_reviews": g["overdue"], "awaiting_approval": g["awaiting"], "expiring_30d": g["expiring"], "exceptions": g["exc"]}
        out[k] = {"documents": g["documents"], "current": g["current"], "due": g["due"], "overdue": g["overdue"], "no_review_date": g["no_review_date"],
                  "on_time_pct": round(100 * (g["current"] + g["due"]) / scheduled, 1) if scheduled else None, "due_30d": g["due"],
                  "needs_attention": sum(parts.values()), "attention": parts, "open_exceptions": g["open"]}
    return out, where, placed


def corpus(n, seed, archived=0):
    """n live documents (+ archived ones) over every status, all the date edges, frameworks (junk too) and departments (a dangling one too),
    and n // 3 exceptions of every state, some without a document."""
    rnd = random.Random(seed)
    statuses = ["published"] * 5 + ["approved"] * 2 + ["draft"] * 3 + ["pending_review", "pending_approval", "review_required", "expired",
                                                                       "exception_applied", None]

    def when(days):
        if rnd.random() < 0.25:                                        # a quarter of the dates sit within two days of the 30-day edge
            return NOW + timedelta(seconds=rnd.randint(-2 * 86400, 2 * 86400) + 30 * 86400)
        return NOW + timedelta(seconds=rnd.randint(-days * 86400, days * 86400))

    docs = []
    for i in range(n + archived):
        status = "archived" if i >= n else rnd.choice(statuses)
        published = "1.0" if status == "published" else (rnd.choice(["1.0", None, ""]) if status in permissions.ON_ITS_WAY else None)
        fw = [] if rnd.random() < 0.25 else rnd.sample(range(1, 13), rnd.randint(1, 4)) + ([rnd.choice(["x", None, True, 3.5])] if rnd.random() < 0.1 else [])
        docs.append(D(id=5000 + i, title=f"Doc {i}", status=status, current_version="2.0" if status == "published" else "1.1", published_version=published,
                      next_review_date=None if rnd.random() < 0.25 else when(150), expiry_date=None if rnd.random() < 0.6 else when(40),
                      department_id=rnd.choice([None, 1, 2, 3, 99]), framework_ids=fw,
                      applicable_framework_ids=rnd.sample(range(1, 13), rnd.randint(1, 2)) if rnd.random() < 0.3 else []))
    excs = [exc(rnd.choice([None] + [d["id"] for d in docs]), rnd.choice(["draft", "pending_approval", "approved", "approved", "rejected", "revoked", "expired"]),
                None if rnd.random() < 0.3 else when(40)) for _ in range(n // 3)]
    return docs, excs


@pytest.mark.parametrize("by", ["framework", "department"])
def test_a_random_corpus_through_the_route_equals_the_plain_count(pw, by):
    docs, excs = corpus(400, seed=7, archived=30)
    put(pw.db, *docs)
    put(pw.db, *excs, model=m.PolicyException)
    body = get(pw, by=by, limit=100)
    want, where, placed = reference(docs, excs, by)
    assert body["total"] == len(want) == len(body["rows"]) and body["documents_total"] == len(where) == 400
    assert {k: numbers(r) for k, r in by_id(body).items()} == want
    assert body["open_exceptions_total"] == placed > 0


# ── 3. true totals above the browser's 1,000-row cut ─────────────────────────
def test_totals_are_true_past_the_thousand_the_library_list_is_cut_at(pw):
    docs, excs = corpus(2500, seed=11, archived=300)
    put(pw.db, *docs)
    put(pw.db, *excs, model=m.PolicyException)
    body = get(pw, by="department", limit=100)
    want, where, placed = reference(docs, excs, "department")
    assert body["documents_total"] == len(where) == 2500 and sum(r["documents"] for r in body["rows"]) == 2500     # departments partition the library
    assert {k: numbers(r) for k, r in by_id(body).items()} == want and body["open_exceptions_total"] == placed
    framework = get(pw, by="framework", limit=100)
    want, where, _ = reference(docs, excs, "framework")
    assert framework["documents_total"] == 2500
    assert {k: numbers(r) for k, r in by_id(framework).items()} == want
    assert sum(r["documents"] for r in framework["rows"]) == sum(len(k) for k in where.values()) > 2500           # a document counts under each of its frameworks


# ── 4. edge data and reconciliation ──────────────────────────────────────────
def test_edge_documents_are_counted_the_way_the_library_counts_them(pw):
    soon, late = NOW + 10 * DAY, NOW - 3 * DAY
    put(pw.db,
        D(id=1, title="On fifteen frameworks", applicable_framework_ids=list(range(1, 16)), next_review_date=soon, owner_id=None),      # and no owner
        D(id=2, title="Mapped to none", next_review_date=late, owner_id=None),
        D(id=3, title="Expired", status="expired", published_version=None, next_review_date=late, framework_ids=[1]),
        D(id=4, title="Archived", status="archived", published_version=None, next_review_date=late, framework_ids=[1]),
        D(id=5, title="Parent", framework_ids=[2], next_review_date=soon),
        D(id=6, title="Child", framework_ids=[2], next_review_date=late, parent_document_id=5),
        D(id=7, title="Junk ids", framework_ids=[3, "x", None, 3, True, 3.5, {"a": 1}], next_review_date=soon),
        D(id=8, title="Applicable wins", applicable_framework_ids=[7], framework_ids=[8, 9], next_review_date=soon),
        D(id=9, title="Own list when none applicable", applicable_framework_ids=[], framework_ids=[8], next_review_date=soon),
        D(id=10, title="No status", status=None, published_version=None, next_review_date=late, framework_ids=[1]),
        D(id=11, title="Draft with an empty published version", status="draft", published_version="", next_review_date=late, framework_ids=[1]),
        D(id=12, title="A list that is not a list", framework_ids={"a": 1}, next_review_date=soon))
    body = get(pw, by="framework", limit=100)
    rows = by_id(body)
    assert body["documents_total"] == 11 and body["total"] == 16 == len(rows)                       # archived left out; fifteen frameworks + "not mapped"
    assert {i: rows[i]["documents"] for i in range(1, 16)} == {1: 4, 2: 3, 3: 2, 4: 1, 5: 1, 6: 1, 7: 2, 8: 2, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1}
    assert sum(r["documents"] for r in body["rows"]) == 25                                          # the 15-framework document is counted 15 times, once in the total
    assert (rows[1]["due"], rows[1]["overdue"], rows[1]["no_review_date"]) == (1, 0, 0)             # 3 expired, 10 without status and 11 are owed no review
    assert (rows[2]["due"], rows[2]["overdue"]) == (2, 1)                                           # a parent and its child are two documents
    assert rows[None]["name"] == "Not mapped to a framework" and (rows[None]["documents"], rows[None]["due"], rows[None]["overdue"]) == (2, 1, 1)


def test_departments_add_up_to_the_total_and_every_document_has_a_framework_row(pw):
    docs, _ = corpus(300, seed=5, archived=20)
    put(pw.db, *docs)
    departments = get(pw, by="department", limit=100)
    assert sum(r["documents"] for r in departments["rows"]) == departments["documents_total"] == 300
    frameworks = get(pw, by="framework", limit=100)
    _, where, _ = reference(docs, [], "framework")
    assert frameworks["documents_total"] == 300 == len(where)
    assert sum(r["documents"] for r in frameworks["rows"]) == sum(len(k) for k in where.values())
    assert None in by_id(frameworks)                                                                # the documents mapped to none have a row of their own


# ── 5. real names ────────────────────────────────────────────────────────────
def test_departments_and_frameworks_carry_their_real_names(pw):
    db = pw.db
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    db.add_all([m.GRCDepartment(id=1, tenant_id=1, name="Information Security", code="IS"),
                m.GRCDepartment(id=2, tenant_id=1, name="Legal", code="LG", is_active=False),
                m.GRCDepartment(id=50, tenant_id=2, name="Somebody else's department", code="XX")])
    db.add_all([m.UploadedFramework(id=1, tenant_id=1, name="NCA ECC", file_name="a.pdf", file_path="/a", file_type="pdf", uploaded_by=ADMIN),
                m.UploadedFramework(id=2, tenant_id=None, is_shared=True, name="ISO 27001", file_name="b.pdf", file_path="/b", file_type="pdf", uploaded_by=ADMIN),
                m.UploadedFramework(id=3, tenant_id=2, is_shared=False, name="Another tenant's framework", file_name="c.pdf", file_path="/c", file_type="pdf",
                                    uploaded_by=ADMIN)])
    db.commit()
    put(db, D(department_id=1, framework_ids=[1]), D(department_id=2, framework_ids=[2]), D(department_id=50, framework_ids=[3]),
        D(department_id=77, framework_ids=[404]), D(department_id=None, framework_ids=[]))
    departments = {r["id"]: r["name"] for r in get(pw, by="department", limit=100)["rows"]}
    assert departments == {1: "Information Security", 2: "Legal (inactive)", 50: "Unassigned", 77: "Unassigned", None: "No department"}
    frameworks = {r["id"]: r["name"] for r in get(pw, by="framework", limit=100)["rows"]}
    assert frameworks == {1: "NCA ECC", 2: "ISO 27001", 3: "Framework #3", 404: "Framework #404", None: "Not mapped to a framework"}


# ── 6. paging and order ──────────────────────────────────────────────────────
def test_weakest_first_then_name_then_id_and_paged_with_the_true_total(pw):
    db = pw.db
    db.add_all([m.GRCDepartment(id=i, tenant_id=1, name=n, code=n[:3]) for i, n in ((1, "Zeta"), (2, "Beta"), (3, "Gamma"), (4, "Delta"), (5, "Alpha"))])
    db.commit()
    late, ahead, far = NOW - DAY, NOW + 10 * DAY, NOW + 100 * DAY
    put(db,
        D(department_id=1, next_review_date=late), D(department_id=1, next_review_date=far),                                          # 50.0
        D(department_id=5, next_review_date=late), D(department_id=5, next_review_date=ahead),                                        # 50.0, ties Zeta: by name
        D(department_id=2, next_review_date=late), D(department_id=2, next_review_date=far), D(department_id=2, next_review_date=far),    # 66.7
        D(department_id=4, next_review_date=far), D(department_id=4, next_review_date=ahead),                                         # 100.0
        D(department_id=3, next_review_date=None))                                                                                    # nothing to be late on: last
    full = get(pw, by="department", limit=100)
    assert [(r["id"], r["on_time_pct"]) for r in full["rows"]] == [(5, 50.0), (1, 50.0), (2, 66.7), (4, 100.0), (3, None)]
    assert full["total"] == 5 and (full["limit"], full["offset"]) == (100, 0)
    assert [r["id"] for r in get(pw, by="department", limit=2)["rows"]] == [5, 1]
    page = get(pw, by="department", limit=2, offset=2)
    assert [r["id"] for r in page["rows"]] == [2, 4] and page["total"] == 5 and page["offset"] == 2
    assert [r["id"] for r in get(pw, by="department", limit=2, offset=4)["rows"]] == [3]
    past = get(pw, by="department", limit=10, offset=50)
    assert past["rows"] == [] and past["total"] == 5 and past["documents_total"] == 10
    default = get(pw, by="department")
    assert len(default["rows"]) == 5 and default["limit"] == 10                                    # the default page is ten rows
    assert get(pw)["by"] == "framework"                                                            # and the default grouping is by framework
    for bad in ({"by": "owner"}, {"limit": 0}, {"limit": 101}, {"offset": -1}, {"limit": "x"}):
        assert pw.http.get(URL, params=bad).status_code == 422, bad
    # groups of the same name and the same share keep a stable order, by id: two departments that no longer exist
    put(db, D(department_id=77, next_review_date=late), D(department_id=76, next_review_date=late))
    assert [(r["id"], r["name"]) for r in get(pw, by="department", limit=100)["rows"]][:2] == [(76, "Unassigned"), (77, "Unassigned")]


# ── 7. the number of statements does not depend on the number of documents ───
def test_the_statement_count_is_constant(pw):
    db = pw.db
    engine = db.get_bind()
    seen = []
    listener = lambda conn, cur, sql, params, ctx, many: seen.append(sql)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)

    def statements(by):
        get(pw, by=by, limit=100)                                      # a first call warms whatever is cached once
        seen.clear()
        get(pw, by=by, limit=100)
        return len(seen)

    try:
        db.add(m.GRCDepartment(id=1, tenant_id=1, name="Information Security", code="IS"))
        db.commit()
        docs, excs = corpus(10, seed=1)
        put(db, *docs)
        put(db, *excs, model=m.PolicyException)
        small = {by: statements(by) for by in ("framework", "department")}
        more, more_excs = corpus(300, seed=2)
        put(db, *[{**d, "id": d["id"] + 10_000} for d in more])
        put(db, *[{**e, "document_id": e["document_id"] and e["document_id"] + 10_000} for e in more_excs], model=m.PolicyException)
        big = {by: statements(by) for by in ("framework", "department")}
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert small == big, (small, big)
    assert get(pw, by="department", limit=100)["documents_total"] == 310


# ── 8. exceptions ────────────────────────────────────────────────────────────
def test_open_exceptions_are_counted_under_the_group_of_their_document(pw):
    db = pw.db
    soon, far = NOW + 10 * DAY, NOW + 90 * DAY
    put(db, D(id=1, department_id=1, framework_ids=[1, 2]), D(id=2, department_id=2, framework_ids=[2]),
        D(id=3, department_id=1, framework_ids=[1], status="archived", published_version=None))
    put(db, exc(1, "draft"), exc(1, "pending_approval"), exc(1, "approved", soon), exc(1, "approved", far), exc(1, "approved"),
        exc(1, "rejected"), exc(1, "revoked"), exc(1, "expired"),                       # not open
        exc(2, "pending_approval"), exc(2, "approved", NOW - DAY),                      # open; the second has lapsed but is still "approved"
        exc(3, "pending_approval"),                                                     # its document is archived
        exc(None, "draft"), exc(None, "pending_approval"),                              # no document at all
        model=m.PolicyException)
    departments = get(pw, by="department", limit=100)
    rows = by_id(departments)
    assert (rows[1]["open_exceptions"], rows[2]["open_exceptions"]) == (5, 2)
    assert rows[1]["attention"]["exceptions"] == 2        # waiting for a decision, and approved and lapsing within 30 days; not the far one nor the undated
    assert rows[2]["attention"]["exceptions"] == 1        # the pending one; a lapsed approval is not "expiring within 30 days" (as the Overview)
    frameworks = get(pw, by="framework", limit=100)
    rows = by_id(frameworks)
    assert (rows[1]["open_exceptions"], rows[2]["open_exceptions"]) == (5, 7)                  # document 1 is on both frameworks: counted under each
    assert departments["open_exceptions_total"] == frameworks["open_exceptions_total"] == 7    # but it is 7 exceptions


def test_the_open_states_are_the_exceptions_modules_own():
    from grc.services import exception_posture

    assert tuple(posture.OPEN_EXCEPTION_STATES) == exception_posture._OPEN_STATES == ("draft", "pending_approval", "approved")


# ── 9. "needs attention" is the document-bound part of the Overview's own counters ──
def test_the_department_rows_add_up_to_the_overviews_counters(pw):
    db = pw.db
    soon, far, late = NOW + 10 * DAY, NOW + 90 * DAY, NOW - 5 * DAY
    put(db,
        D(id=1, department_id=1, next_review_date=late), D(id=2, department_id=1, next_review_date=late, expiry_date=soon),
        D(id=3, department_id=1, next_review_date=far, expiry_date=far), D(id=4, department_id=2, next_review_date=soon, expiry_date=soon),
        D(id=5, department_id=2, status="pending_review", published_version=None, next_review_date=late),                # waiting; owed no review
        D(id=6, department_id=2, status="pending_approval", published_version="1.0", next_review_date=late),              # waiting, and its review is overdue
        D(id=7, department_id=None, status="approved", published_version=None, next_review_date=soon, expiry_date=soon),
        D(id=8, department_id=3, status="draft", published_version=None),
        D(id=9, department_id=3, status="archived", published_version=None, next_review_date=late, expiry_date=soon))     # archived: in no count
    put(db, exc(1, "pending_approval"), exc(1, "approved", soon), exc(1, "approved", far), exc(1, "rejected"), model=m.PolicyException)
    overview = pw.http.get("/governance/dashboard/documents-overview").json()
    queue, counts = overview["attention_queue"], overview["sections"]["reviews"]["counts"]
    body = get(pw, by="department", limit=100)
    rows = body["rows"]
    total = lambda part: sum(r["attention"][part] for r in rows)  # noqa: E731
    assert (total("overdue_reviews"), total("awaiting_approval"), total("expiring_30d"), total("exceptions")) == (
        queue["overdue_reviews"], queue["documents_awaiting_approval"], queue["expiring_documents_30d"], queue["exceptions_attention"]) == (3, 2, 3, 2)
    assert sum(r["needs_attention"] for r in rows) == 3 + 2 + 3 + 2
    assert sum(r["overdue"] for r in rows) == counts["overdue"] and sum(r["current"] + r["due"] + r["overdue"] for r in rows) == counts["scheduled_documents"] == 6
    assert sum(r["due"] for r in rows) == counts["due_30d"] == sum(r["due_30d"] for r in rows) == 2
    assert body["documents_total"] == overview["sections"]["documents"]["counts"]["active"] == 8
    assert all(r["due_30d"] == r["due"] and r["needs_attention"] == sum(r["attention"].values()) for r in rows)


# ── 10. who may ask, and what they count ─────────────────────────────────────
def test_the_posture_has_the_access_of_every_other_dashboard_feed(pw):
    put(pw.db, D())
    # administrators, editors and a view-only reader read the library; someone with no right to it is refused; so is an auditor (the
    # Auditors' right opens single documents, no library lists: the same 403 as every Governance dashboard feed, not changed here)
    for who, status in ((ADMIN, 200), (EDITOR, 200), (VIEWER, 200), (SAM, 403), (OWNER, 403), (AUDITOR, 403)):
        pw.me["id"] = who
        r = pw.http.get(URL)
        assert r.status_code == status == pw.http.get("/governance/dashboard/documents-overview").status_code, who
        if status == 403:
            assert r.json()["detail"] == permissions.LIBRARY_REFUSED, who


def test_a_view_only_reader_is_counted_over_what_the_library_shows_them(pw):
    put(pw.db,
        D(id=1, department_id=1),                                                                  # in force: everyone who reads the library
        D(id=2, department_id=1, status="draft", published_version=None),                         # never published
        D(id=3, department_id=1, status="pending_review", published_version="1.0"),               # a new version on its way over a published one
        D(id=4, department_id=2, status="draft", published_version=None, owner_id=VIEWER),        # his own draft
        D(id=5, department_id=2, status="approved", published_version=None))                      # approved, not yet published
    assert get(pw, ADMIN, by="department")["documents_total"] == 5
    assert get(pw, EDITOR, by="department")["documents_total"] == 5                                # may edit: sees drafts
    viewer = get(pw, VIEWER, by="department", limit=100)
    assert viewer["documents_total"] == 3 and {r["id"]: r["documents"] for r in viewer["rows"]} == {1: 2, 2: 1}


def test_another_tenants_documents_exceptions_and_departments_are_never_counted(pw):
    db = pw.db
    db.add(m.Tenant(id=2, name="Other", slug="other"))
    db.add_all([m.GRCDepartment(id=1, tenant_id=1, name="Mine", code="M"), m.GRCDepartment(id=2, tenant_id=2, name="Theirs", code="T")])
    db.commit()
    put(db, D(id=1, department_id=1), D(id=2, department_id=2),                                    # mine, the second under THEIR department id: dangling for me
        D(id=3, tenant_id=2, department_id=2), D(id=4, tenant_id=2, department_id=1, next_review_date=NOW - DAY))
    put(db, exc(3, "pending_approval", tenant=2), exc(1, "pending_approval"),
        exc(1, "pending_approval", tenant=2),                                                      # inconsistent: theirs, pointing at my document
        model=m.PolicyException)
    body = get(pw, by="department", limit=100)
    assert body["documents_total"] == 2 and body["open_exceptions_total"] == 1
    assert {r["id"]: (r["name"], r["documents"]) for r in body["rows"]} == {1: ("Mine", 1), 2: ("Unassigned", 1)}
    refused = pw.http.get(URL, params={"tenant_id": 2})
    assert refused.status_code == 403 and refused.json()["detail"] == "Access denied to this tenant's data"
    assert pw.http.get(URL, params={"tenant_id": 1}).json()["documents_total"] == 2


def test_a_library_with_no_documents_answers_with_empty_totals_and_its_notes(pw):
    body = get(pw, by="department")
    assert (body["rows"], body["total"], body["documents_total"], body["open_exceptions_total"]) == ([], 0, 0, 0)
    assert set(body["notes"]) == {"counting", "review_health", "needs_attention", "open_exceptions"}
    assert "more than documents_total" in get(pw, by="framework")["notes"]["counting"]
