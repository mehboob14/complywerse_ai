"""The document list (GET /governance/documents): the lean complete load the library draws from (``lean=1``), and what the same change
did to every other caller - no query per row, a sort that cannot fail, pages that never repeat a document.

Over HTTP through the whole governance router, on in-memory SQLite, on a session that does not flush by itself (the shape of
test_document_published_stays.py). The old call is frozen here: its 40 keys in their order, its envelope, its values (equal to the
per-document code path that was not touched), its six type lists and the picker shape."""
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

import grc.models as m
from grc import audit_logger
from grc.modules.governance import library_lean, permissions as P
from grc.modules.governance.router import router
from grc.modules.governance.routers import documents
from grc.routers.auth_router import require_auth

OWNER, REVIEWER, STAFF, EDITOR, ADMIN, AUDITOR, OUTSIDER, PREPARER, ACKER = range(1, 10)
PEOPLE = {"administrator": ADMIN, "editor": EDITOR, "library reader": STAFF, "reviewer asked": REVIEWER, "auditor": AUDITOR, "outsider": OUTSIDER}
WHEN = datetime(2026, 10, 1, 12, 0, 0)
V10 = "# Access policy\n\n## 1. Rules\n\nAccess is reviewed every year.\n"
V11 = V10.replace("every year", "every quarter")
TEXT, WORD, DRAFT, NO_ROW, GAP = 11, 12, 13, 16, 28          # the documents the tests name
HEALS = []                                                   # every call of the self-heal of a missing column

FULL_KEYS = ["id", "tenant_id", "document_code", "title", "description", "content", "file_name", "file_size", "file_type", "has_file",
             "doc_type", "doc_sub_type", "classification", "parent_document_id", "current_version", "version_in_force", "status",
             "owner_id", "owner_name", "author_id", "author_name", "department_id", "effective_date", "expiry_date",
             "review_cycle_months", "next_review_date", "last_reviewed_at", "last_reviewed_by", "regulatory_scope", "framework_ids",
             "applicable_framework_ids", "tags", "approved_by", "approved_at", "published_by", "published_at", "created_at",
             "updated_at", "policy_statement_count", "workflow_instance"]
LEFT_OUT = ("content", "tenant_id", "doc_sub_type", "last_reviewed_by", "approved_by", "published_by", "policy_statement_count", "workflow_instance")
LEAN_KEYS = [k for k in FULL_KEYS if k not in LEFT_OUT] + ["attestation"]
BRIEF_KEYS = ["id", "title", "doc_type", "status", "current_version", "document_code", "parent_document_id", "tags"]


# ── the world ────────────────────────────────────────────────────────────────
def _doc(db, did, title, *, status="published", version="1.0", published=None, last=None, **kw):
    """One INSERT with the state it should have (a later UPDATE would stamp updated_at): ``published`` is the number in force while
    ``version`` is on its way, ``last`` the number published last of a document withdrawn since. Keyword order matters to the listeners."""
    at = kw.pop("updated_at", WHEN + timedelta(hours=did))
    d = m.GovernanceDocument(id=did, tenant_id=1, title=title, doc_type=kw.pop("doc_type", "policy"), current_version=version,
                             published_version=published, last_published_version=last, status=status, updated_at=at, created_at=at - timedelta(days=3), **kw)
    db.add(d)
    return d


def _versions(db, did, *rows):
    for number, status, content, file_path in rows:
        db.add(m.GovernanceDocumentVersion(document_id=did, version_number=number, title="x", status=status, content=content, file_path=file_path,
                                           file_name=file_path, file_type="docx" if file_path else None, file_size=111 if file_path else None))


def seed(db):
    db.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    for uid in range(1, 10):
        db.add(m.GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@cfsb.test", display_name=f"User {uid}" if uid != PREPARER else ""))
    for rid, role, perm in [(20, "Document editors", "governance:policies:edit"), (22, "Administrator", None),
                            (23, "Auditors", "compliance:frameworks:view"), (24, "Document readers", "governance:policies:view")]:
        db.add(m.Role(id=rid, tenant_id=1, name=role))
        if perm:
            db.add(m.Permission(id=rid, name=perm, resource=perm.rsplit(":", 1)[0], action=perm.rsplit(":", 1)[1]))
            db.add(m.RolePermission(role_id=rid, permission_id=rid))
    for uid, rid in [(EDITOR, 20), (ADMIN, 22), (AUDITOR, 23), (STAFF, 24)]:
        db.add(m.UserRole(user_id=uid, role_id=rid, tenant_id=1))
    for i in range(8):                                              # eight people on another domain (rounding: 1 of 8 is 12.5)
        db.add(m.GRCUser(id=100 + i, username=f"e{i}", email=f"e{i}@eight.test", display_name=f"Eight {i}"))
    for fid in range(1, 11):
        db.add(m.UploadedFramework(id=fid, tenant_id=1, name=f"Framework {fid}", file_name="f.pdf", file_path="f.pdf", file_type="pdf", is_shared=False, uploaded_by=1))
    db.add(m.UploadedFramework(id=12, tenant_id=None, name="A shared framework", file_name="f.pdf", file_path="f.pdf", file_type="pdf", is_shared=True, uploaded_by=1))
    db.add(m.UploadedFramework(id=13, tenant_id=2, name="Another tenant's", file_name="f.pdf", file_path="f.pdf", file_type="pdf", is_shared=False, uploaded_by=1))
    db.add(m.GRCDepartment(id=1, tenant_id=1, name="Information Security", code="IS", is_active=True))
    db.add(m.GRCDepartment(id=2, tenant_id=1, name="Closed Department", code="CD", is_active=False))
    db.add(m.WorkflowTemplate(id=1, tenant_id=1, name="Standard approval"))
    db.add(m.WorkflowStep(id=1, template_id=1, name="Review", sequence=1))
    db.flush()

    long_title = "Zürich Çelik 2 ﬁnance سياسة أمن المعلومات " + "x" * 108                     # 150 characters: accents, a ligature, Arabic
    assert len(long_title) == 150
    for did in range(1, 11):                                           # published, varied
        _doc(db, did, f"Policy {did}", owner_id=None if did % 4 == 0 else OWNER, author_id=None if did % 5 == 0 else PREPARER,
             department_id=[1, 2, 99, None][did % 4], framework_ids=[list(range(1, n + 1)) for n in (0, 1, 2, 3, 15)][did % 5],
             tags=["a", "b"] if did % 2 else None, regulatory_scope=["SBP"] if did % 3 == 0 else None, classification=["internal", "restricted", None][did % 3],
             description="Sets the rules." * (did % 4), document_code=f"LIB-{did:03d}", review_cycle_months=12, effective_date=WHEN, expiry_date=WHEN + timedelta(days=400),
             next_review_date=WHEN + timedelta(days=did * 20 - 60), last_reviewed_at=WHEN - timedelta(days=9), published_at=WHEN, approved_at=WHEN,
             file_name="f.pdf" if did == 3 else None, file_path="uploads/f.pdf" if did == 3 else None, file_size=900 if did == 3 else None,
             file_type="pdf" if did == 3 else None)
    # a text in review over 1.0, a Word file in review over a.docx, a draft under it, its draft child
    _doc(db, TEXT, "Access policy", status="pending_review", version="1.1", published="1.0", content=V11, owner_id=OWNER)
    _versions(db, TEXT, ("1.0", "superseded", V10, None), ("1.1", "current", V11, None))
    _doc(db, WORD, "Retention policy", status="pending_review", version="1.1", published="1.0", owner_id=OWNER, file_name="b.docx", file_path="b.docx",
         file_size=222, file_type="docx")
    _versions(db, WORD, ("1.0", "superseded", None, "a.docx"), ("1.1", "current", None, "b.docx"))
    for did in (TEXT, WORD):
        for kind, uid in (("reviewer", REVIEWER), ("prepared_by", PREPARER)):
            db.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=did, role_type=kind, target_type="user", target_id=uid))
        db.add(m.DocumentObligation(tenant_id=1, document_id=did, kind="acknowledgement", user_id=ACKER, document_version="1.0"))
    _doc(db, DRAFT, "Access standard", status="draft", parent_document_id=TEXT, content="# draft", owner_id=OWNER)
    _doc(db, 14, "Access procedure", status="draft", parent_document_id=DRAFT, owner_id=OWNER)
    _doc(db, 15, "Approved, never published", status="approved", owner_id=OWNER)
    _doc(db, NO_ROW, "Newer number, no row to serve", status="pending_approval", version="1.1", published="1.0", owner_id=OWNER)
    _versions(db, NO_ROW, ("1.0", "superseded", "", None))                                   # a version row holding neither text nor file
    _doc(db, 17, "Expired after publication", status="expired", last="1.0", owner_id=OWNER)
    _doc(db, 18, "Exception applied", status="exception_applied", last="1.0", owner_id=OWNER)
    _doc(db, 19, "Flagged for review", status="review_required", published="1.0", owner_id=OWNER)
    _doc(db, 20, "Root", owner_id=OWNER)
    _doc(db, 21, "Child", parent_document_id=20, owner_id=OWNER)
    _doc(db, 22, "Draft grandchild", status="draft", parent_document_id=21, owner_id=OWNER)
    _doc(db, 23, "Archived after publication", status="archived", last="1.0", owner_id=OWNER)
    _doc(db, 24, "Archived, never published", status="archived", owner_id=OWNER)
    _doc(db, 25, long_title, owner_id=OWNER, author_id=OWNER)
    _doc(db, 26, "Fifteen frameworks", framework_ids=list(range(1, 16)), owner_id=OWNER)
    _doc(db, 27, "Applicable overrides", framework_ids=[1, 2], applicable_framework_ids=[3, 4, 12, 13], owner_id=OWNER)
    _doc(db, GAP, "A fix taken back", status="pending_review", version="1.2", published="1.1", content="v1.2", owner_id=OWNER)
    _versions(db, GAP, ("1.0", "superseded", "v1.0", None), ("1.1", "reverted", "the undone gap fix", None),
              ("1.1", "superseded", "v1.1 as published", None), ("1.2", "current", "v1.2", None))
    for did in range(29, 41):
        way = did % 4 == 3
        _doc(db, did, f"Filler {did}", status="pending_review" if way else ["published", "draft"][did % 2], version="1.1" if way else "1.0",
             published="1.0" if way else None, owner_id=OWNER + (did % 3), author_id=ACKER, department_id=1)
        if way:
            _versions(db, did, ("1.0", "superseded", "the published text", None))
    db.flush()
    db.add(m.DocumentWorkflowInstance(document_id=1, template_id=1, current_step_id=1, status="active"))
    db.add(m.DocumentWorkflowInstance(document_id=TEXT, template_id=1, current_step_id=None, status="completed", started_at=WHEN))
    for i in range(3):
        db.add(m.PolicyStatement(tenant_id=1, document_id=2, statement_text=f"The bank shall {i}.", statement_code=f"PS-{i}"))
    db.add(m.PolicyStatement(tenant_id=1, document_id=TEXT, statement_text="The bank shall.", statement_code="PS-9"))
    _campaigns(db)
    db.commit()


def _campaign(db, did, name, status, created, acks, domain="cfsb.test", by=1):
    c = m.DocumentAttestationCampaign(tenant_id=1, document_id=did, name=name, status=status, public_token=f"{did}-{name}", allowed_email_domain=domain,
                                      created_by=by, created_at=created)
    db.add(c)
    db.flush()
    for i in range(acks):
        db.add(m.DocumentAttestationAcknowledgment(campaign_id=c.id, name=f"P{i}", email=f"p{i}@x.test", signature_data="data:image/png;base64,AAAA"))


def _campaigns(db):
    _campaign(db, 1, "active", "active", WHEN, 2)                                      # 2 of the 9 people on cfsb.test
    _campaign(db, 2, "closed-old", "closed", WHEN - timedelta(days=9), 9)
    _campaign(db, 2, "active-new", "active", WHEN, 3)                                  # the active one wins
    _campaign(db, 3, "active-old", "active", WHEN - timedelta(days=9), 4)
    _campaign(db, 3, "closed-new", "closed", WHEN, 9)                                  # an older active one wins over a newer closed one
    _campaign(db, 4, "creator", "active", WHEN, 1, domain=None, by=1)                  # no stored domain: the creator's
    _campaign(db, 5, "nobody", "active", WHEN, 3, domain="nobody.test")                # nobody on that domain: no entry
    _campaign(db, 6, "capped", "active", WHEN, 12)                                     # 12 of 9: capped at 100
    _campaign(db, 7, "eighth", "active", WHEN, 1, domain="eight.test")                 # 1 of 8 = 12.5: the rounding of the route
    _campaign(db, 8, "all-closed", "closed", WHEN, 5)                                  # a closed one is the latest when none is active


def make_world(extra=0):
    """A fresh database with the dataset and ``extra`` more published documents (every tenth in review over a published 1.0 with the
    version row to serve) inserted in bulk."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    seed(db)
    if extra:
        docs, versions = [], []
        for n in range(extra):
            did, way, at = 1000 + n, n % 10 == 9, WHEN + timedelta(minutes=n)
            docs.append(dict(id=did, tenant_id=1, document_code=f"X-{n:05d}", title=f"[UXSEED] Filler {n}" + " title" * (n % 20), description="Applies to all staff. " * 5,
                             doc_type="policy", status="pending_review" if way else "published", current_version="1.1" if way else "1.0", published_version="1.0",
                             last_published_version="1.0", owner_id=OWNER + n % 3, author_id=ACKER, department_id=1 + n % 2, framework_ids=[1 + n % 9, 1 + n % 4],
                             tags=["a"], regulatory_scope=[], classification="internal", review_cycle_months=12, next_review_date=WHEN + timedelta(days=n % 300 - 100),
                             created_at=at, updated_at=at, content="# filler " + "text " * 400, parent_document_id=None if n % 7 else 1000 + max(n - 1, 0)))
            if way:
                versions.append(dict(document_id=did, version_number="1.0", title="x", status="superseded", content="# the published text", created_at=at))
        db.execute(insert(m.GovernanceDocument.__table__), docs)
        db.execute(insert(m.GovernanceDocumentVersion.__table__), versions)
        db.commit()
    app = FastAPI()
    app.include_router(router)
    me = {"id": STAFF}
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, me["id"])
    count = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cursor, statement, parameters, context, executemany):
        count["n"] += 1

    return SimpleNamespace(db=db, engine=engine, me=me, http=TestClient(app), count=count)


@pytest.fixture(autouse=True)
def _heal_counted(monkeypatch):
    """On SQLite the self-heal of a missing column re-runs PostgreSQL's whole schema repair every time; here it only counts."""
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    monkeypatch.setattr("grc.modules.compliance.schema_migrations.ensure_assigned_column", lambda db: HEALS.append(1))
    HEALS.clear()


@pytest.fixture(scope="module")
def world():
    w = make_world()
    yield w
    w.db.close()


def get(w, who, path):
    w.me["id"] = who
    w.db.expire_all()
    return w.http.get(path)


def measured(w, who, path):
    """(statements, seconds, response) of one request on a session with nothing cached."""
    w.me["id"] = who
    w.db.expire_all()
    w.count["n"] = 0
    t = time.perf_counter()
    r = w.http.get(path)
    took = time.perf_counter() - t
    assert r.status_code == 200, r.text
    return w.count["n"], took, r


ALL = "limit=10000&sort_by=id&sort_order=asc"


def ids_of(response):
    return [d["id"] for d in response.json()["items"]]


# ── the old call: frozen ─────────────────────────────────────────────────────
def test_the_old_call_keeps_its_forty_keys_its_envelope_and_the_picker_shape(world):
    for who in PEOPLE.values():
        body = get(world, who, f"/governance/documents?{ALL}").json()
        assert list(body) == ["items", "total", "skip", "limit"], who
        assert all(list(item) == FULL_KEYS for item in body["items"]), who
        assert body["total"] == len(body["items"]) and (body["skip"], body["limit"]) == (0, 10000)
    brief = get(world, STAFF, "/governance/documents?brief=1&limit=1000").json()
    assert list(brief) == ["items", "total", "skip", "limit"] and brief["items"] and all(list(i) == BRIEF_KEYS for i in brief["items"])


def test_every_row_of_the_old_call_equals_the_per_document_code_path_that_was_not_touched(world):
    """The list reads the statement counts, workflow instances, authors and versions for the whole page; the single-document path
    (serialize_document, _in_force_for) still reads them per document and is the oracle."""
    for name, who in PEOPLE.items():
        world.me["id"] = who
        world.db.expire_all()
        user = world.db.get(m.GRCUser, who)
        visible = P.visible_filter(world.db, user)
        in_force = documents._in_force_for(world.db, user, visible is None)
        docs = world.db.query(m.GovernanceDocument).order_by(m.GovernanceDocument.id)
        if visible is not None:
            docs = docs.filter(visible)
        expected = [documents._serve_in_force(documents.serialize_document(d, world.db), in_force(d)) for d in docs]
        got = get(world, who, f"/governance/documents?{ALL}").json()["items"]
        assert [d["id"] for d in got] == [d["id"] for d in expected], name
        assert got == expected, name
    items = {d["id"]: d for d in get(world, ADMIN, f"/governance/documents?{ALL}").json()["items"]}
    assert items[2]["policy_statement_count"] == 3 and items[TEXT]["policy_statement_count"] == 1 and items[3]["policy_statement_count"] == 0
    assert (items[1]["workflow_instance"]["template_name"], items[1]["workflow_instance"]["current_step_name"], items[1]["workflow_instance"]["status"]) \
        == ("Standard approval", "Review", "active")
    assert items[TEXT]["workflow_instance"]["current_step_name"] is None and items[2]["workflow_instance"] is None


def test_the_six_type_lists_are_the_list_of_that_type(world):
    for path, kind in (("policies", "policy"), ("standards", "standard"), ("procedures", "procedure"), ("guidelines", "guideline"),
                       ("charters", "charter"), ("frameworks", "framework")):
        listed = get(world, ADMIN, f"/governance/documents/{path}").json()
        direct = get(world, ADMIN, f"/governance/documents?doc_type={kind}").json()
        assert listed == direct and list(listed) == ["items", "total", "skip", "limit"], path


# ── lean = the full rows without eight keys ──────────────────────────────────
@pytest.mark.parametrize("name", list(PEOPLE))
def test_lean_rows_are_the_full_rows_without_the_eight_keys_for_everyone(world, name):
    who = PEOPLE[name]
    full = get(world, who, f"/governance/documents?{ALL}").json()
    lean = get(world, who, f"/governance/documents?{ALL}&lean=1").json()
    assert [d["id"] for d in lean["items"]] == [d["id"] for d in full["items"]]
    assert lean["total"] == full["total"] == len(full["items"])
    for slim, fat in zip(lean["items"], full["items"]):
        assert list(slim) == LEAN_KEYS, slim["id"]
        assert {k: v for k, v in slim.items() if k != "attestation"} == {k: v for k, v in fat.items() if k not in LEFT_OUT}, slim["id"]
    if name == "library reader":
        assert lean["items"] and DRAFT not in [d["id"] for d in lean["items"]]            # a draft never published is not theirs to read
    if name == "outsider":
        assert lean["items"] == [] and lean["total"] == 0


def test_the_reader_without_draft_rights_is_served_the_file_in_force_lean_and_full(world):
    for path in (f"/governance/documents?{ALL}", f"/governance/documents?{ALL}&lean=1"):
        items = {d["id"]: d for d in get(world, STAFF, path).json()["items"]}
        assert (items[WORD]["file_name"], items[WORD]["file_size"], items[WORD]["file_type"], items[WORD]["has_file"]) == ("a.docx", 111, "docx", True), path
        assert (items[WORD]["current_version"], items[WORD]["version_in_force"], items[WORD]["status"]) == ("1.1", "1.0", "pending_review"), path
        assert items[NO_ROW]["current_version"] == "1.1" and items[NO_ROW]["has_file"] is False, path     # no row to serve: the document's own fields
        assert items[GAP]["version_in_force"] == "1.1" and items[TEXT]["file_name"] is None, path
    editor = {d["id"]: d for d in get(world, EDITOR, f"/governance/documents?{ALL}&lean=1").json()["items"]}
    assert (editor[WORD]["file_name"], editor[WORD]["file_size"]) == ("b.docx", 222) and DRAFT in editor        # who may change it reads the newest


def test_lean_carries_the_names_its_rows_use(world):
    body = get(world, ADMIN, f"/governance/documents?{ALL}&lean=1").json()
    assert body["lean"] is True and list(body) == ["items", "total", "skip", "limit", "truncated", "lean", "frameworks", "departments"]
    assert body["frameworks"]["1"] == {"name": "Framework 1"} and body["frameworks"]["12"] == {"name": "A shared framework"}
    assert set(body["frameworks"]) == {str(i) for i in range(1, 11)} | {"12"}            # not 11, 14, 15 (unknown) nor 13 (another tenant's, not shared)
    assert body["departments"] == {"1": {"name": "Information Security", "is_active": True}, "2": {"name": "Closed Department", "is_active": False}}
    one = get(world, ADMIN, "/governance/documents?lean=1&limit=1&sort_by=id&sort_order=asc").json()            # only the returned rows' names
    assert one["frameworks"] == {"1": {"name": "Framework 1"}} and set(one["departments"]) == {"2"}


def test_total_limit_ceiling_and_truncated_say_what_the_response_holds(world, monkeypatch):
    body = get(world, ADMIN, "/governance/documents?lean=1&limit=10&sort_by=id&sort_order=asc").json()
    assert (len(body["items"]), body["limit"], body["truncated"]) == (10, 10, True) and body["total"] == 40
    body = get(world, ADMIN, "/governance/documents?lean=1&limit=10&skip=35&sort_by=id&sort_order=asc").json()
    assert ([d["id"] for d in body["items"]], body["truncated"], body["skip"]) == ([36, 37, 38, 39, 40], False, 35)
    assert library_lean.LEAN_LIMIT == 10_000
    monkeypatch.setattr(library_lean, "LEAN_LIMIT", 12)
    body = get(world, ADMIN, "/governance/documents?lean=1&limit=10000&sort_by=id&sort_order=asc").json()       # the ceiling cuts: the true total says so
    assert (len(body["items"]), body["limit"], body["total"], body["truncated"]) == (12, 12, 40, True) and body["items"][-1]["id"] == 12
    body = get(world, ADMIN, "/governance/documents?lean=1&limit=-5&skip=-3").json()
    assert (body["items"], body["limit"], body["skip"], body["total"]) == ([], 0, 0, 40)
    assert library_lean.empty(5, 7) == {"items": [], "total": 0, "skip": 5, "limit": 7, "truncated": False, "lean": True, "frameworks": {}, "departments": {}}
    full = get(world, ADMIN, "/governance/documents?limit=10000").json()                 # the ceiling is lean's: the full call is as it was
    assert full["limit"] == 10000 and len(full["items"]) == 40


def test_brief_wins_when_both_are_sent(world):
    body = get(world, ADMIN, "/governance/documents?brief=1&lean=1&limit=5").json()
    assert list(body) == ["items", "total", "skip", "limit"] and body["items"] and all(list(i) == BRIEF_KEYS for i in body["items"])


def test_filters_and_the_tenant_check_work_the_same_lean(world):
    for q in ("doc_type=policy", "status=published", "owner_id=1", "classification=internal", "search=policy", "search=Zürich"):
        for who in (ADMIN, STAFF):
            full = get(world, who, f"/governance/documents?{q}&{ALL}")
            lean = get(world, who, f"/governance/documents?{q}&{ALL}&lean=1")
            assert ids_of(lean) == ids_of(full) and lean.json()["total"] == full.json()["total"], (q, who)
    assert get(world, ADMIN, "/governance/documents?tenant_id=77&lean=1").status_code == 403


# ── attestation: the coverage map's arithmetic ───────────────────────────────
def test_attestation_is_what_the_coverage_map_says_and_only_for_library_readers(world):
    by = {d["id"]: d["attestation"] for d in get(world, STAFF, f"/governance/documents?{ALL}&lean=1").json()["items"]}       # before the route backfills a domain
    assert by[1] == {"pct": 22, "done": 2, "total": 9} and by[2] == {"pct": 33, "done": 3, "total": 9} and by[3] == {"pct": 44, "done": 4, "total": 9}
    assert by[4] == {"pct": 11, "done": 1, "total": 9} and by[5] is None and by[6] == {"pct": 100, "done": 12, "total": 9}
    assert by[7] == {"pct": 12, "done": 1, "total": 8} and by[8] == {"pct": 56, "done": 5, "total": 9} and by[9] is None and by[10] is None
    for who in (STAFF, ADMIN, EDITOR):
        reply = get(world, who, "/governance/document-attestations/coverage-map").json()
        assert len(reply["coverage"]) == 7                                              # documents 1, 2, 3, 4, 6, 7, 8
        for d in get(world, who, f"/governance/documents?{ALL}&lean=1").json()["items"]:
            i = str(d["id"])
            expected = {"pct": reply["coverage"][i], "done": reply["counts"][i]["done"], "total": reply["counts"][i]["total"]} if i in reply["coverage"] else None
            assert d["attestation"] == expected, (who, d["id"])
    # a person who only owns or is asked about documents is refused by the coverage map: they drew "no campaign"
    assert get(world, REVIEWER, "/governance/document-attestations/coverage-map").status_code == 403
    mine = get(world, REVIEWER, f"/governance/documents?{ALL}&lean=1").json()["items"]
    assert mine and all(d["attestation"] is None for d in mine)


# ── no query per row ─────────────────────────────────────────────────────────
def test_statements_do_not_grow_with_the_rows_and_the_self_heal_runs_once_per_page():
    w = make_world(extra=400)
    try:
        for kind, query in (("full", ""), ("lean", "lean=1&"), ("brief", "brief=1&")):
            for who in (ADMIN, STAFF, REVIEWER):
                measured(w, who, f"/governance/documents?{query}limit=1")                    # once-per-engine work (the attestation tables' self-heal) is not the list's
                small, _, r = measured(w, who, f"/governance/documents?{query}limit=44&sort_by=id&sort_order=asc")          # the 40 + 4 fillers: every kind of row
                HEALS.clear()
                large, _, r = measured(w, who, f"/governance/documents?{query}limit=444&sort_by=id&sort_order=asc")
                assert len(r.json()["items"]) >= 100, (kind, who)
                assert large == small and large <= 30, (kind, who, small, large)
                assert len(HEALS) == (1 if kind == "full" else 0), (kind, who, HEALS)
    finally:
        w.db.close()


def test_five_thousand_lean_rows_are_fast_with_a_constant_number_of_statements():
    w = make_world(extra=5000)
    try:
        for who in (ADMIN, STAFF):
            n, took, r = measured(w, who, "/governance/documents?lean=1&limit=10000&sort_by=updated_at&sort_order=desc")
            body = r.json()
            assert body["total"] == len(body["items"]) > 4000 and body["truncated"] is False
            assert n <= 30 and took < 3.0, (n, took)
            print(f"\nlean, {len(body['items'])} rows, user {who}: {took * 1000:.0f} ms, {n} statements, {len(r.content) / 1e6:.2f} MB")
        n, took, r = measured(w, ADMIN, "/governance/documents?limit=10000&sort_by=updated_at&sort_order=desc")
        print(f"full, {len(r.json()['items'])} rows, administrator: {took * 1000:.0f} ms, {n} statements, {len(r.content) / 1e6:.2f} MB")
        assert n <= 30
    finally:
        w.db.close()


# ── sort: an allow-list and a tie-break ──────────────────────────────────────
ODD = ["owner", "author", "versions", "workflow_instance", "metadata", "__table__", "__class__", "query", "nonexistent", "framework_ids", "tags",
       "regulatory_scope", "statement_parts", "content", "description", "file_path", "id; DROP TABLE grc_governance_documents", "", "owner_name"]


@pytest.mark.parametrize("extra", ["", "&lean=1"])
def test_an_odd_sort_by_is_no_error_and_sorts_by_creation(world, extra):
    expected = ids_of(get(world, ADMIN, f"/governance/documents?sort_by=created_at&sort_order=desc&limit=1000{extra}"))
    assert expected == list(range(40, 0, -1))
    for odd in ODD:
        r = get(world, ADMIN, f"/governance/documents?sort_by={quote(odd)}&limit=1000{extra}")
        assert r.status_code == 200, (odd, r.status_code)
        assert ids_of(r) == expected, odd
    assert world.db.query(m.GovernanceDocument).count() == 40                 # and the table is still there


def test_valid_sort_keys_keep_their_order(world):
    def ids(query, extra=""):
        return ids_of(get(world, ADMIN, f"/governance/documents?{query}&limit=1000{extra}"))
    by_title = [r.id for r in sorted(world.db.query(m.GovernanceDocument.id, m.GovernanceDocument.title).all(), key=lambda r: r.title)]
    assert ids("sort_by=title&sort_order=asc") == by_title and ids("sort_by=title&sort_order=desc") == by_title[::-1]
    assert ids("sort_by=title&sort_order=asc", "&lean=1") == by_title
    assert ids("sort_by=updated_at&sort_order=desc") == list(range(40, 0, -1)) and ids("sort_by=updated_at&sort_order=asc") == list(range(1, 41))
    assert ids("sort_by=id&sort_order=asc") == list(range(1, 41)) and ids("sort_by=id&sort_order=desc") == list(range(40, 0, -1))
    assert ids("") == list(range(40, 0, -1))                                      # created_at desc (created = updated - 3 days)


@pytest.mark.parametrize("extra", ["", "&lean=1"])
@pytest.mark.parametrize("order", ["asc", "desc"])
def test_paging_with_equal_sort_values_repeats_and_skips_nothing(order, extra):
    w = make_world()
    try:
        w.db.execute(m.GovernanceDocument.__table__.update().values(updated_at=WHEN))        # every value equal
        w.db.commit()
        whole = ids_of(get(w, ADMIN, f"/governance/documents?sort_by=updated_at&sort_order={order}&limit=1000{extra}"))
        assert whole == (list(range(1, 41)) if order == "asc" else list(range(40, 0, -1)))        # equal values: by id, in the direction of the sort
        paged = []
        for skip in range(0, 40, 7):
            paged += ids_of(get(w, ADMIN, f"/governance/documents?sort_by=updated_at&sort_order={order}&skip={skip}&limit=7{extra}"))
        assert paged == whole
    finally:
        w.db.close()


# ── the audit: unchanged ─────────────────────────────────────────────────────
def test_a_lean_list_is_audited_like_every_other_read():
    """Dropping the lean list from the audit log (like the polling endpoints) is decision 3 of the design note, not made yet: until then
    a library open writes the same 'read' row as before. A change to this test is that decision."""
    def request(path, query=b""):
        return Request({"type": "http", "method": "GET", "path": path, "query_string": query, "headers": []})
    assert audit_logger.should_audit_request(request("/grc/governance/documents", b"lean=1&limit=10000"))
    assert audit_logger.should_audit_request(request("/grc/governance/documents", b"limit=1000"))
    assert not audit_logger.should_audit_request(request("/grc/auth/me"))
