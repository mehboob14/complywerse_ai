"""Comply Agent chat (modules/chatbot): what the person is told when something goes wrong, and what a deleted chat leaves behind.

Scripted AI only: the model client is replaced by a function that answers, fails or refuses; no real model is reached and no
question text is printed or logged by these tests. Over HTTP on in-memory SQLite, plus the pure helpers.

 * a refusal by the data-protection guard (AIBlocked) or the SCF licence guard is said in plain words at EVERY level that used to
   swallow it (SQL generation, the model's knowledge answer, file analysis, result formatting, the retry after a failed query),
   never as "please rephrase", never with the guard's reason lost, and the exchange is not kept in the session log;
 * a failed model call, a missing key and an unexpected error answer in plain words (no key name, no error text, no query text);
 * an answer with no data never prints the query that found nothing;
 * deleting a chat takes its uploaded files out of the vector store first (and deletes nothing when it cannot);
 * attachments: only the six types, 10 MB each, refused before anything is written;
 * the response only GAINED fields (the older readers, including the Cyber Assurance copy of the page, read the old ones).
"""
import os

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")
os.environ.setdefault("OPENAI_API_KEY", "dummy")

import json  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import grc.models as m  # noqa: E402
from grc.modules.chatbot import router as chat  # noqa: E402
from grc.services.ai_gateway.errors import AIBlocked  # noqa: E402
from grc.services.licence_guard import LicenceRestrictedContent  # noqa: E402

import grc_sql_agent as agent  # noqa: E402  (the router puts the agent's folder on sys.path)

GUARD_SENTENCE = "AI was not used because the request still contained a secret or an account number."
SQL_RISKS = "SELECT id, title FROM grc_risks ORDER BY id LIMIT 10 OFFSET 0"
FORBIDDEN_ON_SCREEN = ("rephras", "OPENAI", "sql", "SELECT ", "```", "Traceback", "boom-detail")


class Script:
    """The scripted model: `steps` are consumed one per call; an Exception is raised, a string is the model's reply."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.calls = 0

    def create(self, **kwargs):
        self.calls += 1
        step = self.steps.pop(0) if self.steps else "ok"
        if isinstance(step, BaseException):
            raise step
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=step))])

    @property
    def client(self):
        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=self.create)))


def sql_reply(sql=SQL_RISKS):
    return json.dumps({"sql": sql, "explanation": "x", "entity_type": "risks", "estimated_rows": "low"})


@pytest.fixture
def world(monkeypatch, tmp_path):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(chat.router)
    app.dependency_overrides[chat.require_auth] = lambda: SimpleNamespace(id=7, username="tester")
    app.dependency_overrides[chat.get_db] = get_db
    monkeypatch.setattr(chat, "get_user_tenants", lambda user, db: [1])
    monkeypatch.setattr("grc.modules.governance.permissions.can_read_library", lambda db, user: True)
    monkeypatch.setattr(chat, "SQL_AGENT_ENABLED", True)
    for name in ("detect_query_type", "generate_sql_query", "validate_sql", "format_query_results", "get_fallback_data_for_question",
                "generate_answer_from_fallback_data", "fetch_table_schema_from_db", "load_full_database_schema", "drop_secret_columns", "NO_USABLE_DATA_TITLE"):
        monkeypatch.setattr(chat, name, getattr(agent, name))      # the router binds these when it is first imported: another test file may have imported it where the agent did not load
    monkeypatch.setattr(chat, "validate_columns_in_sql", lambda sql: {"valid": True, "errors": [], "fixed_sql": None})
    monkeypatch.setattr(chat, "get_qdrant_service", lambda: None)
    monkeypatch.setattr(chat, "CHAT_UPLOAD_ROOT", tmp_path / "uploads")
    monkeypatch.setenv("OPENAI_API_KEY", "dummy")
    monkeypatch.setattr(agent, "DETERMINISTIC_RESULT_FORMATTING", True)

    w = SimpleNamespace(http=TestClient(app), Session=Session, app=app, root=tmp_path / "uploads")

    def script(*steps):
        s = Script(*steps)
        monkeypatch.setattr(agent, "openai_client", s.client)                   # the SQL agent's own client
        import openai
        monkeypatch.setattr(openai, "OpenAI", lambda *a, **k: s.client)         # the router's knowledge / file-analysis client
        return s

    w.script = script
    w.ask = lambda text, session="s1", **extra: w.http.post("/ai/complychat/ask", json={"message": text, "session_id": session, **extra})
    with Session() as db:
        db.add(m.Risk(id=1, tenant_id=1, title="Phishing", category="technology"))
        db.commit()
    yield w


def says_nothing_technical(body):
    text = json.dumps({"answer": body["answer"], "sources": body["sources"], "blocked": body.get("blocked")}).lower()    # what a screen can show
    for word in FORBIDDEN_ON_SCREEN:
        assert word.lower() not in text, word


# ── the guard's refusal, at every level that used to swallow it ────────────────────────────────────────────────────────────────

def assert_refused(response, reason=GUARD_SENTENCE, code="secret_survived"):
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "blocked"
    assert body["blocked"] == {"code": code, "reason": reason}
    assert body["answer"] == "This question includes information that is not sent to the AI."
    assert body["sources"] == [] and body["has_more"] is False
    assert "rephras" not in json.dumps(body).lower() and "could not complete" not in body["answer"]


def test_a_refusal_while_the_query_is_written_is_said_not_swallowed(world):
    world.script(AIBlocked("secret_survived", GUARD_SENTENCE))
    assert_refused(world.ask("list all risks"))


def test_a_refusal_while_the_results_are_formatted_is_said_not_turned_into_a_table(world, monkeypatch):
    monkeypatch.setattr(agent, "DETERMINISTIC_RESULT_FORMATTING", False)           # the AI writes the summary of the rows
    s = world.script(sql_reply(), AIBlocked("secret_survived", GUARD_SENTENCE))
    assert_refused(world.ask("list all risks"))
    assert s.calls == 2


def test_a_refusal_in_the_knowledge_answer_is_said(world):
    world.script(AIBlocked("secret_survived", GUARD_SENTENCE))
    assert_refused(world.ask("What does PCI DSS require for encryption?"))


def test_a_refusal_in_the_file_analysis_is_said(world):
    world.script("unused")
    up = world.http.post("/ai/complychat/upload", data={"session_id": "s1"}, files=[("files", ("policy.txt", b"Access policy text", "text/plain"))])
    assert up.status_code == 200, up.text
    world.script(AIBlocked("secret_survived", GUARD_SENTENCE))
    assert_refused(world.ask("please summarise the uploaded policy", session="s1"))


def test_a_refusal_in_the_retry_after_a_failed_query_is_said_and_not_retried(world, monkeypatch):
    monkeypatch.setattr(chat, "fetch_table_schema_from_db", lambda table: f"{table}: id, title")
    s = world.script(sql_reply("SELECT nope FROM grc_risks LIMIT 10 OFFSET 0"), AIBlocked("secret_survived", GUARD_SENTENCE))
    assert_refused(world.ask("list all risks"))
    assert s.calls == 2                              # the second call is the retry: it was refused, nothing was asked a third time


def test_the_scf_licence_refusal_is_said_too(world):
    world.script(LicenceRestrictedContent("This request included Secure Controls Framework text, which its licence does not allow to be sent to an AI model."))
    r = world.ask("list all risks")
    body = r.json()
    assert (r.status_code, body["outcome"]) == (200, "blocked")
    assert body["blocked"]["code"] == "licence_restricted" and "licence" in body["blocked"]["reason"]
    assert body["answer"] == "This request includes text that cannot be sent to the AI."


def test_a_refused_question_is_not_kept_in_the_session_log(world):
    world.script(AIBlocked("secret_survived", GUARD_SENTENCE))
    world.ask("list all risks", session="refused-session")
    assert chat.session_message_logs.get(chat.get_session_storage_key(7, "refused-session"), []) == []


# ── a failure is said in plain words ───────────────────────────────────────────────────────────────────────────────────────────

def assert_failed(response):
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["outcome"] == "failed" and body["sources"] == []
    says_nothing_technical(body)
    return body


def test_a_provider_fault_in_the_knowledge_answer_is_a_failure_with_no_error_text(world):
    world.script(RuntimeError("boom-detail: 401 invalid key sk-xxxx"))
    body = assert_failed(world.ask("What does PCI DSS require for encryption?"))
    assert body["answer"] == chat.UNAVAILABLE_ANSWER


def test_an_empty_model_answer_is_a_failure_not_an_empty_answer(world):
    world.script("   ")
    assert_failed(world.ask("What does PCI DSS require for encryption?"))


def test_a_missing_key_does_not_name_the_variable(world, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "")
    world.script("unused")
    assert_failed(world.ask("What does PCI DSS require for encryption?"))


def test_a_query_that_cannot_be_written_or_run_is_a_failure_the_person_can_retry(world):
    world.script("this is not json", "still not json", "nor this")
    body = assert_failed(world.ask("list all risks"))
    assert body["answer"].startswith("I could not find a reliable answer to:")


def test_an_unexpected_error_is_a_500_without_its_own_text(world, monkeypatch):
    def explode(*a, **k):
        raise ValueError("boom-detail: connection string postgres://user:pw@host/db")

    monkeypatch.setattr(chat, "classify_request_mode", explode)
    r = world.ask("list all risks")
    assert r.status_code == 500
    assert r.json()["detail"] == "Comply Agent could not answer this right now." and "boom-detail" not in r.text


def test_when_the_agent_is_off_the_503_is_a_sentence(world, monkeypatch):
    monkeypatch.setattr(chat, "SQL_AGENT_ENABLED", False)
    r = world.ask("list all risks")
    assert r.status_code == 503 and r.json()["detail"] == "Comply Agent is not available right now."


# ── no data: never the query ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_no_matching_records_say_so_and_cite_no_source(world):
    world.script(sql_reply("SELECT id, title FROM grc_risks WHERE id < 0 ORDER BY id LIMIT 10 OFFSET 0"))
    r = world.ask("list all risks")
    body = r.json()
    assert (r.status_code, body["outcome"], body["sources"]) == (200, "no_data", [])
    assert body["answer"].startswith("No matching platform data found")
    says_nothing_technical(body)


def test_rows_that_are_empty_in_every_field_never_print_the_query():
    rows = [{"a": None, "b": ""}] * 5
    answer = agent.format_query_results(rows, "show the exception owners", "SELECT a, b FROM grc_secret_join", total_count=5)
    assert answer.startswith(f"## {agent.NO_USABLE_DATA_TITLE}")
    for word in ("SELECT", "```", "grc_", "schema", "JOIN", "administrator"):
        assert word not in answer, word
    assert not any(ord(ch) > 0x2000 for ch in answer), "no emoji or symbol characters"
    assert chat._is_no_data_answer(answer, rows) and not chat._is_no_data_answer("## Executive Summary", rows) and chat._is_no_data_answer("", [])


def test_the_answer_counts_the_real_total_not_the_page(world):
    with world.Session() as db:
        for i in range(2, 13):
            db.add(m.Risk(id=i, tenant_id=1, title=f"Risk {i}", category="technology"))
        db.commit()
    world.script(sql_reply())
    body = world.ask("list all risks").json()
    assert body["total_count"] == 12 and body["has_more"] is True
    assert "Found **12** item(s)" in body["answer"] and "Showing 1-10 of 12" in body["answer"]
    (source,) = body["sources"]
    assert source["kind"] == "live_data" and source["label"] == "Risks"


def test_a_failed_summary_falls_back_to_the_plain_table_without_ids(monkeypatch):
    monkeypatch.setattr(agent, "DETERMINISTIC_RESULT_FORMATTING", False)
    monkeypatch.setattr(agent, "openai_client", Script(RuntimeError("provider down")).client)
    rows = [{"id": 9, "tenant_id": 1, "title": "Phishing", "created_at": "2026-01-01"}]
    answer = agent.format_query_results(rows, "list risks", "SELECT 1", total_count=1)
    assert "Phishing" in answer and "tenant_id" not in answer and "created_at" not in answer
    assert "| Title |" in answer, "column names read as words, not as column keys"


# ── a deleted chat takes its files out of the vector store ──────────────────────────────────────────────────────────────────

class FakeVectors:
    is_available = True

    def __init__(self, fail=False):
        self.fail, self.deleted, self.upserted = fail, [], 0

    def upsert_documents(self, docs):
        self.upserted += len(list(docs))
        return 1

    def delete_source_points(self, tenant_id, source_type, source_id):
        if self.fail:
            raise RuntimeError("vector store unreachable")
        self.deleted.append((tenant_id, source_type, source_id))


def attach(world, name="policy.txt", data=b"Access policy text", session="del-1"):
    r = world.http.post("/ai/complychat/upload", data={"session_id": session}, files=[("files", (name, data, "text/plain"))])
    assert r.status_code == 200, r.text
    return r.json()["uploaded_files"][0]["id"]


def test_deleting_a_chat_deletes_its_uploads_from_the_vector_store_first(world, monkeypatch):
    vectors = FakeVectors()
    monkeypatch.setattr(chat, "get_qdrant_service", lambda: vectors)
    file_id = attach(world)
    assert (world.root / "user_7" / "del-1").exists()
    before = len(vectors.deleted)                    # indexing a file replaces its old points first: those deletes are not the chat's
    r = world.http.delete("/ai/complychat/history/del-1")
    assert r.status_code == 200 and r.json()["success"] is True and r.json()["files_removed"] == 1
    assert vectors.deleted[before:] == [(1, "chat_upload", file_id)]
    assert not (world.root / "user_7" / "del-1").exists()


def test_when_the_vector_store_cannot_be_reached_nothing_is_deleted_and_it_can_be_tried_again(world, monkeypatch):
    vectors = FakeVectors(fail=True)
    monkeypatch.setattr(chat, "get_qdrant_service", lambda: vectors)
    attach(world, session="del-2")
    r = world.http.delete("/ai/complychat/history/del-2")
    assert r.status_code == 503 and "Nothing was deleted" in r.json()["detail"] and "vector" not in r.text.lower()
    assert world.http.get("/ai/complychat/history/del-2").json()["uploaded_files"], "the files are still known, so a second delete can finish the job"
    vectors.fail = False
    before = len(vectors.deleted)
    assert world.http.delete("/ai/complychat/history/del-2").status_code == 200
    assert len(vectors.deleted) == before + 1 and not world.http.get("/ai/complychat/history/del-2").json()["uploaded_files"]


def test_deleting_a_chat_with_no_files_needs_no_vector_store(world):
    assert world.http.delete("/ai/complychat/history/never-used").json() == {
        "message": "History cleared for session never-used", "success": True, "files_removed": 0}


# ── attachments ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_an_unsupported_type_is_refused_before_anything_is_written(world):
    r = world.http.post("/ai/complychat/upload", data={"session_id": "up-1"}, files=[
        ("files", ("notes.txt", b"fine", "text/plain")), ("files", ("model.xlsx", b"PK", "application/octet-stream"))])
    assert r.status_code == 400
    assert r.json()["detail"] == "model.xlsx can't be attached. Use a text, Markdown, CSV, PDF, Word (.docx) or PowerPoint (.pptx) file."
    assert not (world.root / "user_7" / "up-1").exists(), "the first file was not kept either"


def test_a_file_over_ten_megabytes_is_refused(world):
    r = world.http.post("/ai/complychat/upload", data={"session_id": "up-2"}, files=[("files", ("big.csv", b"a" * (10 * 1024 * 1024 + 1), "text/csv"))])
    assert r.status_code == 413 and r.json()["detail"] == "big.csv is larger than 10 MB."


def test_every_supported_type_is_accepted_and_a_path_in_the_name_is_dropped(world):
    for name in ("a.txt", "a.md", "a.csv", "a.pdf", "a.docx", "a.pptx", "..\\..\\up\\evil.TXT", "../../x.md"):
        r = world.http.post("/ai/complychat/upload", data={"session_id": "up-3"}, files=[("files", (name, b"text", "text/plain"))])
        assert r.status_code == 200, (name, r.text)
        assert "/" not in r.json()["uploaded_files"][0]["filename"]
    assert chat.CHAT_UPLOAD_TYPES == {".txt", ".md", ".csv", ".pdf", ".docx", ".pptx"} and chat.CHAT_UPLOAD_MAX_BYTES == 10 * 1024 * 1024


# ── the contract older readers rely on ─────────────────────────────────────────────────────────────────────────────────────────

def test_the_response_only_gained_fields():
    assert {"answer", "sources", "framework_filter", "timestamp", "has_more", "total_count", "current_offset"} <= set(chat.ChatResponse.model_fields)
    assert {"outcome", "blocked"} <= set(chat.ChatResponse.model_fields)
    assert {"rank", "entity_type", "entity_id", "framework_code", "control_code", "control_name", "relevance_score", "snippet"} <= set(chat.ChatSource.model_fields)
    assert {"kind", "label"} <= set(chat.ChatSource.model_fields)
    plain = chat.ChatResponse(answer="a", sources=[], framework_filter=None, timestamp="t")
    assert (plain.outcome, plain.blocked) == ("answer", None)


def test_a_source_is_named_by_its_type_in_plain_words():
    hits = [{"score": 0.9, "payload": {"source_type": t, "source_id": "5", "title": "Access policy", "snippet": "s"}}
            for t in ("governance_document", "evidence_file", "chat_upload", "some_new_type")]
    sources = chat._vector_hits_to_sources(hits)
    assert [(s.kind, s.label) for s in sources] == [("record", "Document"), ("record", "Evidence"), ("your_file", "Your file"), ("record", "Some new type")]
    assert all(s.entity_id == "5" and s.entity_type for s in sources), "the old keys are untouched"
