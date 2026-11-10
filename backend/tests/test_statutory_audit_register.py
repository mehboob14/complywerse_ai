"""Statutory Audit: what the revamped register and record rely on (UX revamp G-2, 2026-11-10).

A GET never runs DDL; an observation code is the highest number in use + 1 (never a count, so a delete cannot hand out a live code again, and a
copy of a register finding or a bulk import continues after it); the list carries who owns each observation, whether it is a copy of a register
finding and a true total; a record says how many changes it has; evidence uploads are held to the 25 MB and the file types the panel lists; the AI
import says what it read, flags a draft that repeats a registered observation and never prints a setting, a vendor or a raw error. In-memory SQLite,
the route functions called directly.
"""
import asyncio
import io
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.auditor_portal.routers import statutory_audit as sa
from grc.services.ai_gateway.errors import AIBlocked

T0 = datetime(2026, 11, 1, 9, 0, 0)


@pytest.fixture()
def world(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    sa._ensured_engines.discard(id(engine))
    db = sessionmaker(bind=engine)()
    db.add(m.Tenant(id=1, name="Acme", slug="acme", is_active=True, primary_contact_email="ada@acme.test"))
    db.add_all([
        m.GRCUser(id=7, username="ada", email="ada@acme.test", display_name="Ada Admin", is_active=True),
        m.GRCUser(id=8, username="vic", email="vic@acme.test", display_name="Vic Viewer", is_active=True),
    ])
    db.commit()
    db.engine_for_test = engine
    yield db
    db.close()


def me(db):
    return db.get(m.GRCUser, 7)


def create(db, title, **kw):
    return sa.create_observation(sa.ObservationCreate(title=title, **kw), db=db, current_user=me(db))


def listing(db, **kw):
    args = dict(search=None, status_filter=None, priority=None, regulator_source=None, audit_period=None, observation_type=None, category=None,
                skip=0, limit=200, db=db, current_user=me(db))
    args.update(kw)
    return sa.list_observations(**args)


# ── no DDL in a GET ─────────────────────────────────────────────────────────
def test_a_read_never_runs_ddl_and_a_missing_table_reads_as_empty(world):
    db = world
    statements = []
    event.listen(db.engine_for_test, "before_cursor_execute", lambda c, cur, stmt, p, ctx, many: statements.append(stmt.strip().split()[0].upper()))
    create(db, "First")
    statements.clear()
    for _ in range(3):
        listing(db)
        sa.observations_meta(db=db, current_user=me(db))
        sa.get_observation(1, db=db, current_user=me(db))
    assert not [s for s in statements if s in ("ALTER", "CREATE", "DROP")], statements

    # a database without the tables: the list is empty, the record is not found, and nothing is created by asking
    bare = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Tenant.__table__.create(bare)
    m.GRCUser.__table__.create(bare)
    bare_db = sessionmaker(bind=bare)()
    bare_db.add(m.Tenant(id=1, name="Acme", slug="acme", is_active=True, primary_contact_email="ada@acme.test"))
    bare_db.add(m.GRCUser(id=7, username="ada", email="ada@acme.test", display_name="Ada Admin", is_active=True))
    bare_db.commit()
    try:
        assert listing(bare_db) == {"items": [], "total": 0, "skip": 0, "limit": 200}
        with pytest.raises(HTTPException) as err:
            sa.get_observation(1, db=bare_db, current_user=bare_db.get(m.GRCUser, 7))
        assert err.value.status_code == 404
    finally:
        bare_db.close()


# ── codes ───────────────────────────────────────────────────────────────────
def test_a_code_follows_the_highest_number_so_a_delete_cannot_repeat_a_live_code(world):
    db = world
    first, second, third = (create(db, f"Observation {i}") for i in range(3))
    assert [first["code"], second["code"], third["code"]] == ["SAO-001", "SAO-002", "SAO-003"]
    sa.delete_observation(second["id"], db=db, current_user=me(db))                       # a count would now say 3 + ... = SAO-003 again
    fourth = create(db, "Observation 4")
    assert fourth["code"] == "SAO-004"
    codes = [o["code"] for o in listing(db)["items"]]
    assert len(codes) == len(set(codes)) == 3


def test_codes_of_other_shapes_are_ignored_and_a_bulk_import_continues_after_the_highest(world):
    db = world
    create(db, "Kept")
    row = db.get(m.AuditObservation, 1)
    row.code = "SAO-017"
    db.add(m.AuditObservation(tenant_id=1, code="MRA-9", title="Odd code", observation_type="finding"))
    db.commit()
    got = sa.confirm_import(
        sa.ConfirmImportRequest(observations=[sa.ConfirmImportItem(title="From a circular"), sa.ConfirmImportItem(title="Another one")],
                                source_document_name="circular.pdf"),
        db=db, current_user=me(db))
    assert [o["code"] for o in got["created"]] == ["SAO-018", "SAO-019"]
    assert sa._next_code(db, 1) == "SAO-020"


# ── the list ────────────────────────────────────────────────────────────────
def test_the_list_names_the_owner_gives_a_true_total_and_pages_without_repeating_a_row(world):
    db = world
    for i in range(7):
        create(db, f"Observation {i}", owner_id=8 if i % 2 else None)
    page1 = listing(db, limit=3)
    page2 = listing(db, limit=3, skip=3)
    page3 = listing(db, limit=3, skip=6)
    assert page1["total"] == page2["total"] == page3["total"] == 7
    ids = [o["id"] for p in (page1, page2, page3) for o in p["items"]]
    assert len(ids) == 7 and len(set(ids)) == 7, "no row twice, none skipped"
    owned = [o for o in page1["items"] + page2["items"] + page3["items"] if o["owner_id"] == 8]
    assert owned and all(o["owner_name"] == "Vic Viewer" for o in owned)
    assert all(o["owner_name"] is None for o in page1["items"] + page2["items"] + page3["items"] if o["owner_id"] is None)
    assert all(o["mirrored"] is False and o["mirrored_issue_id"] is None for o in page1["items"])


def test_a_copy_of_a_register_finding_says_so_and_a_hand_made_one_does_not(world):
    db = world
    mine = create(db, "Entered here")
    copy = create(db, "MRA from the regulator")
    issue = m.Issue(id=5, tenant_id=1, code="ISS-005", title="MRA from the regulator", status="open", workflow_state="new")
    db.add(issue)
    db.add(m.AuditIssueProfile(issue_id=5, tenant_id=1, source="regulator", issue_ref="MRA-1", title_key="mra"))
    db.add(m.AuditObservationIssueLink(observation_id=copy["id"], issue_id=5, notes="From the audit issue register"))
    # a link to an issue that is not a regulator finding does not make an observation a copy
    db.add(m.Issue(id=6, tenant_id=1, code="ISS-006", title="Own issue", status="open", workflow_state="new"))
    db.add(m.AuditObservationIssueLink(observation_id=mine["id"], issue_id=6, notes=None))
    db.commit()
    by_title = {o["title"]: o for o in listing(db)["items"]}
    assert by_title["MRA from the regulator"]["mirrored"] is True and by_title["MRA from the regulator"]["mirrored_issue_id"] == 5
    assert by_title["Entered here"]["mirrored"] is False
    one = sa.get_observation(copy["id"], db=db, current_user=me(db))
    assert one["mirrored"] is True and one["mirrored_issue_id"] == 5


# ── the record ──────────────────────────────────────────────────────────────
def test_a_record_carries_its_latest_changes_and_how_many_there_are(world):
    db = world
    obs = create(db, "Busy one")
    for i in range(sa.HISTORY_LIMIT + 5):
        sa._log_activity(db, obs["id"], 7, "update", f"Change {i}", {"fields": ["title"]})
    db.commit()
    got = sa.get_observation(obs["id"], db=db, current_user=me(db))
    assert len(got["history"]) == sa.HISTORY_LIMIT
    assert got["history_total"] == sa.HISTORY_LIMIT + 6              # the 55 changes and the "created" row
    assert got["history"][0]["message"] == f"Change {sa.HISTORY_LIMIT + 4}", "newest first"
    assert got["history"][0]["user_name"] == "Ada Admin"


def test_links_are_named_in_the_history_not_numbered(world):
    db = world
    obs = create(db, "Linked one")
    db.add(m.InternalControl(id=3, tenant_id=1, control_id="IC-003", name="Access review"))
    db.add(m.Risk(id=9, tenant_id=1, title="Phishing risk", category="Operational"))
    db.commit()
    sa.link_control(obs["id"], {"internal_control_id": 3}, db=db, current_user=me(db))
    sa.link_risk(obs["id"], {"risk_id": 9}, db=db, current_user=me(db))
    messages = [h["message"] for h in sa.get_observation(obs["id"], db=db, current_user=me(db))["history"]]
    assert 'Linked control IC-003' in messages and 'Linked risk Phishing risk' in messages
    assert not [t for t in messages if "#" in t]


# ── evidence uploads ────────────────────────────────────────────────────────
def upload(db, obs_id, name, data):
    return asyncio.run(sa.upload_evidence(obs_id, file=UploadFile(filename=name, file=io.BytesIO(data)), name=None, notes=None, relationship_type="proof",
                                          db=db, current_user=me(db)))


def test_an_evidence_upload_is_held_to_the_listed_types_and_the_size(world, monkeypatch, tmp_path):
    db = world
    monkeypatch.setattr(sa, "_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(sa.evidence_review, "rate_upload", lambda *a, **k: None)
    monkeypatch.setattr(sa, "_MAX_UPLOAD_BYTES", 10)
    obs = create(db, "Needs proof")
    ok = upload(db, obs["id"], "scan.pdf", b"0123456789")
    assert ok["file_name"] == "scan.pdf"
    with pytest.raises(HTTPException) as too_big:
        upload(db, obs["id"], "scan.pdf", b"0123456789A")
    assert too_big.value.status_code == 413 and "too large" in too_big.value.detail and "MB" in too_big.value.detail
    with pytest.raises(HTTPException) as odd:
        upload(db, obs["id"], "setup.exe", b"MZ")
    assert odd.value.status_code == 400 and "can't be attached" in odd.value.detail
    with pytest.raises(HTTPException) as bare:
        upload(db, obs["id"], "no-extension", b"x")
    assert bare.value.status_code == 400
    with pytest.raises(HTTPException) as empty:
        upload(db, obs["id"], "empty.pdf", b"")
    assert empty.value.status_code == 400
    assert len(sa.get_observation(obs["id"], db=db, current_user=me(db))["evidence"]) == 1, "only the accepted file is attached"
    assert sa.EVIDENCE_EXTENSIONS >= {"pdf", "docx", "xlsx", "png", "zip"}


# ── the AI import ───────────────────────────────────────────────────────────
class FakeClient:
    """A stand-in for the AI client: `answer` is the JSON text, or an exception to raise."""

    def __init__(self, answer, finish="stop", refusal=None):
        def create(**kwargs):
            if isinstance(answer, Exception):
                raise answer
            msg = SimpleNamespace(content=answer, refusal=refusal)
            return SimpleNamespace(choices=[SimpleNamespace(message=msg, finish_reason=finish)])
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))


def parse(db, monkeypatch, *, client, text="x" * 200, filename="circular.pdf"):
    monkeypatch.setattr("grc.modules.governance.routers.policy_parser.extract_text_from_bytes", lambda *a, **k: text)
    monkeypatch.setattr(sa, "_get_openai_client", lambda: (client, None) if client is not None else (None, "AI is not available for this organisation yet."))
    return asyncio.run(sa.upload_parse_observations(file=UploadFile(filename=filename, file=io.BytesIO(b"data")), regulator_hint=None,
                                                    audit_period_hint=None, category_hint=None, db=db, current_user=me(db)))


JSON = json.dumps({"regulator_source": "SBP", "observations": [
    {"title": "Strengthen AML thresholds", "priority": "high", "observation_type": "requirement"},
    {"title": "  strengthen   aml THRESHOLDS ", "priority": "bogus"},
    {"title": "Review the sanctions list", "priority": "low"}]})


def test_the_import_flags_a_draft_that_repeats_a_registered_observation_and_says_what_was_read(world, monkeypatch):
    db = world
    old = create(db, "Review the sanctions list")
    got = parse(db, monkeypatch, client=FakeClient(JSON), text="y" * 20000)
    by_title = {d["title"].strip().lower(): d for d in got["draft_observations"]}
    twin = by_title["review the sanctions list"]
    assert twin["duplicate_of"] == {"id": old["id"], "code": "SAO-001"} and twin["selected"] is False
    assert by_title["strengthen aml thresholds"]["duplicate_of"] is None and by_title["strengthen aml thresholds"]["selected"] is True
    assert got["truncated"] is True and got["characters_read"] == sa.IMPORT_CHARACTERS and got["characters_total"] == 20000
    assert got["page_limit"] == sa.IMPORT_PAGES
    short = parse(db, monkeypatch, client=FakeClient(JSON), text="y" * 500, filename="note.docx")
    assert short["truncated"] is False and short["characters_read"] == 500 and short["page_limit"] is None


def detail_of(db, monkeypatch, **kw):
    with pytest.raises(HTTPException) as err:
        parse(db, monkeypatch, **kw)
    return err.value


BANNED = ("openai", "api key", "api_key", "tesseract", "model", "server", "gpt", "traceback", "exception")


def test_the_import_says_what_went_wrong_in_plain_words_never_a_setting_or_a_vendor(world, monkeypatch):
    db = world
    cases = {
        "no AI": dict(client=None),
        "refused": dict(client=FakeClient("", refusal="I can't help with that")),
        "empty": dict(client=FakeClient("")),
        "not JSON": dict(client=FakeClient("not json")),
        "cut short": dict(client=FakeClient('{"observations": [{"title": "a"', finish="length")),
        "not an object": dict(client=FakeClient("[1, 2]")),
        "authentication": dict(client=FakeClient(RuntimeError("Incorrect API key provided: sk-secret"))),
        "wrong model": dict(client=FakeClient(RuntimeError("The model `gpt-9` does not exist (404)"))),
        "rate limit": dict(client=FakeClient(RuntimeError("Rate limit reached 429"))),
        "anything else": dict(client=FakeClient(RuntimeError("Traceback: boom at /srv/app/x.py"))),
        "too little text": dict(client=FakeClient(JSON), text="short"),
        "no observations": dict(client=FakeClient(json.dumps({"observations": []}))),
    }
    for name, kw in cases.items():
        err = detail_of(db, monkeypatch, **kw)
        text = str(err.detail).lower()
        assert err.status_code in (422, 502, 503), (name, err.status_code)
        assert not [w for w in BANNED if w in text], (name, err.detail)
        assert "sk-secret" not in text and "/srv/app" not in text, name
    cut = detail_of(db, monkeypatch, **cases["cut short"])
    assert "shorter part" in cut.detail, "a list cut off by the output limit says to split the file"


def test_a_refusal_of_the_data_protection_guard_is_said_as_it_is_written_not_as_a_failure(world, monkeypatch):
    db = world
    err = detail_of(db, monkeypatch, client=FakeClient(AIBlocked("restricted_data", "This document holds data that must not leave the platform.")))
    assert err.status_code == 422 and err.detail == "This document holds data that must not leave the platform."


def test_a_file_that_cannot_be_read_is_not_described_by_its_exception(world, monkeypatch):
    db = world

    def broken(*a, **k):
        raise RuntimeError("pdfminer exploded at /tmp/x.pdf")
    monkeypatch.setattr("grc.modules.governance.routers.policy_parser.extract_text_from_bytes", broken)
    with pytest.raises(HTTPException) as err:
        asyncio.run(sa.upload_parse_observations(file=UploadFile(filename="a.pdf", file=io.BytesIO(b"data")), regulator_hint=None, audit_period_hint=None,
                                                 category_hint=None, db=db, current_user=me(db)))
    assert err.value.status_code == 422 and "pdfminer" not in err.value.detail and "/tmp" not in err.value.detail
