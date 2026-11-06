"""Statements follow every new version of their document, and only what changed is read again (modules/governance/
statement_reparse.py): the first parse keeps the hash of every part of the text and of the part each statement came from; a new
version sends only its new or changed parts to the AI, updates the statement of a changed part in place (same id and code, links
people made kept, mapped again), adds what is new under a code no statement has, marks what went as no longer in the document,
never touches a person's own wording, asks nothing for a sign-off stamp, and reads a version saved meanwhile in a second pass.
Documents parsed before this start from the version before the current one. The update starts by itself when a tenant session
commits a new text or file. In-memory SQLite; the AI and the mapper's AI are fakes, nothing reaches a provider or a tenant DB."""
import re
from datetime import datetime
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.governance import statement_auto_map, statement_reparse
from grc.modules.governance.routers import documents, policy_parser
from grc.services import ai_usage
from grc.tasks import governance as jobs

OWNER, EDITOR = 1, 2
REQUEST = SimpleNamespace(state=SimpleNamespace(tenant_slug=None))
SHARED = "Shared accounts shall not be used."
TEXT = f"""# Access policy

## Document Description

| Field | Value |
| --- | --- |
| Version | 1.0 |
| Effective date | ___________________ |

## 1. Purpose

Access to systems must be approved by the owner.

## 2. Accounts

Passwords must be at least 12 characters. Accounts must be reviewed every quarter.

{SHARED}

## 3. Approval Signoff

| Role | Name | Designation | Signature / Date |
| --- | --- | --- | --- |
| Owner | ___________________ | ___________________ | ___________________ |
"""
SENTENCES = ["Access to systems must be approved by the owner.", "Passwords must be at least 12 characters.",
             "Accounts must be reviewed every quarter.", SHARED]


class FakeAI:
    """Stands in for parse_policy_statements_with_openai: every sentence with 'must' or 'shall' is a statement. Records what it read."""
    def __init__(self):
        self.calls = []

    def __call__(self, text, title, progress_callback=None, at_least=15):
        self.calls.append({"text": text, "at_least": at_least})
        found, section = [], ""
        for line in text.split("\n"):
            line = line.strip()
            if line.startswith("Section: ") or line.startswith("#"):
                section = line.split(": ", 1)[-1].lstrip("# ")
                continue
            for sentence in re.findall(r"[^.]*\b(?:must|shall)\b[^.]*\.", line):
                found.append({"statement_text": sentence.strip(), "statement_summary": "What it asks", "category": "security",
                              "priority": "high", "is_mandatory": True, "source_section": section, "ai_confidence": 0.9,
                              "ai_extracted_keywords": ["access"]})
        return found


@pytest.fixture
def world(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)          # as tenant sessions are (PITFALLS 74)
    with factory() as db:
        db.add(m.Tenant(id=1, name="CFSB", slug="cfsb", primary_contact_email="boss@cfsb.test"))
        db.add(m.GRCUser(id=OWNER, username="olivia", display_name="Olivia Owner", email="olivia@cfsb.test"))
        db.add(m.GRCUser(id=EDITOR, username="eddie", display_name="Eddie Editor", email="eddie@cfsb.test"))
        db.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="draft", current_version="1.0",
                                    content=TEXT, owner_id=OWNER))
        db.commit()
    ai = FakeAI()
    monkeypatch.setattr(policy_parser, "parse_policy_statements_with_openai", ai)
    mapped = []
    real_map = statement_auto_map.auto_map_statement
    monkeypatch.setattr(statement_auto_map, "_ai_available", lambda: False)        # the real mapper, without its AI call

    def remap(db, stmt, fw_ids=None):
        mapped.append(stmt.id)
        return real_map(db, stmt, fw_ids)

    monkeypatch.setattr(statement_auto_map, "auto_map_statement", remap)
    db = factory()
    yield SimpleNamespace(db=db, factory=factory, ai=ai, mapped=mapped)
    db.close()
    for store in (policy_parser._parsing_status, policy_parser._reparse_proposals):
        store.pop(5, None)
        store.pop(6, None)


def parse(w, incremental=False, user=OWNER):
    return policy_parser._parse_policy_body(w.db, 5, user, None, incremental=incremental)


def edit(w, old, new):
    d = w.db.get(m.GovernanceDocument, 5)
    assert old in d.content
    d.content = d.content.replace(old, new)
    w.db.commit()


def doc(w):
    w.db.expire_all()
    return w.db.get(m.GovernanceDocument, 5)


def statement(w, start):
    w.db.expire_all()
    return w.db.query(m.PolicyStatement).filter(m.PolicyStatement.statement_text.like(f"{start}%")).one()


def last_snapshot(w, s):
    return (w.db.query(m.PolicyStatementVersion).filter(m.PolicyStatementVersion.statement_id == s.id)
            .order_by(m.PolicyStatementVersion.version_number.desc()).first())


def change_log(w):
    return w.db.query(m.DocumentAuditLog).filter(m.DocumentAuditLog.action == "statements_updated_from_document").all()


def parsed(w):
    """The first parse, then a clean slate for what the next version does."""
    parse(w)
    w.ai.calls.clear()
    w.mapped.clear()


# ── the first parse ──────────────────────────────────────────────────────────
def test_the_first_parse_keeps_the_hash_of_every_part_and_of_the_part_each_statement_came_from(world):
    parse(world)
    parts = statement_reparse.parts_of(TEXT)
    assert [p.text for p in parts] == [                    # the sign-off table and the rows a sign-off fills in are no part
        "# Access policy", "## Document Description", "| Field | Value |", "## 1. Purpose", SENTENCES[0], "## 2. Accounts",
        " ".join(SENTENCES[1:3]), SHARED]
    assert parts[7].path == "2. Accounts"
    assert doc(world).statement_parts == [p.hash for p in parts]
    by_text = {p.text: p.hash for p in parts}
    got = {s.statement_text: s.source_hash for s in world.db.query(m.PolicyStatement)}
    assert got == {SENTENCES[0]: by_text[SENTENCES[0]], SENTENCES[1]: by_text[" ".join(SENTENCES[1:3])],
                   SENTENCES[2]: by_text[" ".join(SENTENCES[1:3])], SHARED: by_text[SHARED]}
    assert world.ai.calls[0]["at_least"] == 15                # the whole document is read as before


# ── a new version ────────────────────────────────────────────────────────────
def test_an_edited_paragraph_alone_is_read_again_and_its_statement_is_updated_in_place(world):
    parsed(world)
    s = statement(world, "Shared")
    for code, kw in [("LOCKED-1", {"is_locked": True}), ("MANUAL-1", {"created_by_ai": False, "link_source": "manual"}), ("AI-1", {})]:
        world.db.add(m.StatementControlMapping(tenant_id=1, statement_id=s.id, control_kind="parsed", control_code=code, **kw))
    world.db.commit()
    before = (s.id, s.statement_code)
    edit(world, SHARED, "Shared accounts shall never be used.")

    out = parse(world, incremental=True)

    assert world.ai.calls == [{"text": "Section: 2. Accounts\nShared accounts shall never be used.", "at_least": 0}]   # only that part
    s = statement(world, "Shared")
    assert (s.id, s.statement_code, s.statement_text, s.status) == (*before, "Shared accounts shall never be used.", "active")
    assert (last_snapshot(world, s).change_type, s.source_hash) == ("auto_reparse", statement_reparse.part_hash(s.statement_text))
    assert world.mapped == [s.id]                                                                     # mapped again, it alone
    links = sorted(c for (c,) in world.db.query(m.StatementControlMapping.control_code).filter(m.StatementControlMapping.statement_id == s.id))
    assert links == ["LOCKED-1", "MANUAL-1"]                  # the AI's own link was redone; a person's and a locked one stay
    assert world.db.query(m.PolicyStatement).count() == 4
    assert {last_snapshot(world, x).change_type for x in world.db.query(m.PolicyStatement) if x.id != s.id} == {"initial_parse"}
    [row] = change_log(world)
    assert (row.field_changed, row.action_details, row.performed_by) == ("statement", "v1.0: 1 changed (PS-0005-004)", OWNER)
    assert out == {"status": "completed", "added": 0, "changed": 1, "removed": 0}
    status = policy_parser._parsing_status[5]
    assert (status["status"], status["automatic"], status["message"]) == ("completed", True, "Statements updated from version 1.0: 1 changed.")


def test_a_new_paragraph_adds_a_statement_under_a_code_no_other_statement_has(world):
    parsed(world)
    world.db.delete(statement(world, "Passwords"))              # a code is free again: counting statements would reuse PS-0005-004
    world.db.commit()
    new = "Remote access must use multi-factor authentication."
    edit(world, SENTENCES[0], f"{SENTENCES[0]}\n\n{new}")

    parse(world, incremental=True)

    assert [c["text"] for c in world.ai.calls] == [f"Section: 1. Purpose\n{new}"]
    s = statement(world, "Remote")
    codes = [c for (c,) in world.db.query(m.PolicyStatement.statement_code)]
    assert s.statement_code == "PS-0005-005" and len(codes) == len(set(codes)) == 4
    assert (s.source_hash, s.status, last_snapshot(world, s).change_type) == (statement_reparse.part_hash(new), "active", "auto_reparse")
    assert world.db.query(m.PolicyStatementCompliance).filter(m.PolicyStatementCompliance.statement_id == s.id).count() == 1
    assert world.mapped == [s.id]
    assert [r.action_details for r in change_log(world)] == ["v1.0: 1 added (PS-0005-005)"]


def test_a_removed_paragraph_marks_its_statement_no_longer_in_the_document_without_asking_the_ai(world):
    parsed(world)
    edit(world, f"{SHARED}\n\n", "")

    out = parse(world, incremental=True)

    assert world.ai.calls == [] and world.mapped == []
    s = statement(world, "Shared")
    snap = last_snapshot(world, s)
    assert (s.status, snap.change_type, snap.change_reason) == ("superseded", "auto_reparse", "No longer in the document (version 1.0)")
    assert out["removed"] == 1 and world.db.query(m.PolicyStatement).count() == 4                  # never deleted
    assert [r.action_details for r in change_log(world)] == ["v1.0: 1 no longer in the document (PS-0005-004)"]
    assert policy_parser.serialize_statement(s)["status"] == "superseded"                          # what the badge reads


def test_a_sign_off_stamp_changes_no_statement_and_asks_the_ai_nothing(world):
    parsed(world)
    d = doc(world)
    parts = list(d.statement_parts)
    stamped = documents._patch_signoff_content(d.content, [{"role": "Owner", "name": "Olivia Owner", "date": "2026-10-21"}],
                                               {"version": "1.1", "effective_date": "2026-11-01"})
    assert "Olivia Owner" in stamped and "| Version | 1.1 |" in stamped
    d.content = stamped
    world.db.commit()

    out = parse(world, incremental=True)

    assert world.ai.calls == [] and world.mapped == [] and change_log(world) == []
    assert (out["added"], out["changed"], out["removed"]) == (0, 0, 0)
    assert doc(world).statement_parts == parts
    assert policy_parser._parsing_status[5]["message"] == "The statements already match version 1.0."


def test_a_statement_edited_by_hand_that_the_document_does_not_say_is_never_overwritten_or_superseded(world):
    parsed(world)
    s = statement(world, "Shared")
    s.statement_text = "Shared accounts shall not be used by staff."
    policy_parser._create_version_snapshot(world.db, s, "manual_edit", EDITOR, "Stricter")
    world.db.commit()
    first = statement(world, "Access")
    first.source_text, first.statement_text = first.statement_text, "Access to systems must be approved by its owner in writing."
    world.db.commit()                                         # (document sync: edited, not written into the document yet)
    edit(world, SHARED, "Shared accounts shall never be used.")

    parse(world, incremental=True)

    s = statement(world, "Shared")
    assert (s.statement_text, s.status, last_snapshot(world, s).change_type) == ("Shared accounts shall not be used by staff.", "active", "manual_edit")
    assert world.db.query(m.PolicyStatement).count() == 4    # the document's new wording is that statement's part, not a new one
    assert world.mapped == []

    edit(world, "Shared accounts shall never be used.\n\n", "")       # the paragraphs go
    edit(world, f"{SENTENCES[0]}\n\n", "")
    parse(world, incremental=True)
    assert (statement(world, "Shared").status, statement(world, "Access").status) == ("active", "active")


def test_a_version_saved_while_the_ai_reads_is_read_in_a_second_pass(world, monkeypatch):
    parsed(world)
    other = world.factory()

    def saved_meanwhile(text, title, progress_callback=None, at_least=15):
        if not world.ai.calls:                                # someone saves again while the AI reads the first change
            d = other.get(m.GovernanceDocument, 5)
            d.content = d.content.replace(SENTENCES[0], "Access to systems must be approved by the system owner.")
            other.commit()
        return world.ai(text, title, progress_callback, at_least)

    monkeypatch.setattr(policy_parser, "parse_policy_statements_with_openai", saved_meanwhile)
    edit(world, SHARED, "Shared accounts shall never be used.")

    out = parse(world, incremental=True)
    other.close()

    assert [c["text"] for c in world.ai.calls] == ["Section: 2. Accounts\nShared accounts shall never be used.",
                                                    "Section: 1. Purpose\nAccess to systems must be approved by the system owner."]
    assert statement(world, "Access").statement_text == "Access to systems must be approved by the system owner."
    assert statement(world, "Shared").statement_text == "Shared accounts shall never be used."
    assert out["changed"] == 2 and sorted(world.mapped) == sorted([statement(world, "Access").id, statement(world, "Shared").id])
    assert doc(world).statement_parts == [p.hash for p in statement_reparse.parts_of(doc(world).content)]


# ── documents parsed before this existed ─────────────────────────────────────
def _old_statements(w):
    for n, text in enumerate(SENTENCES, start=1):
        w.db.add(m.PolicyStatement(id=n, tenant_id=1, document_id=5, statement_code=f"PS-0005-{n:03d}", statement_text=text, status="active"))
    w.db.commit()


def test_statements_made_before_this_are_compared_with_the_version_before_the_current_one(world):
    _old_statements(world)
    new = TEXT.replace(SHARED, "Shared accounts shall never be used.")
    world.db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.0", change_type="baseline", title="Access policy", content=TEXT,
                                             status="superseded", created_by=OWNER, created_at=datetime(2026, 10, 1)))
    world.db.add(m.GovernanceDocumentVersion(document_id=5, version_number="1.1", change_type="minor", title="Access policy", content=new,
                                             status="current", created_by=EDITOR, created_at=datetime(2026, 10, 2)))
    d = doc(world)
    d.content, d.current_version = new, "1.1"
    world.db.commit()

    parse(world, incremental=True, user=None)                 # nobody named: the person who made the newest version

    assert [c["text"] for c in world.ai.calls] == ["Section: 2. Accounts\nShared accounts shall never be used."]
    assert world.db.get(m.PolicyStatement, 4).statement_text == "Shared accounts shall never be used."
    assert all(s.source_hash for s in world.db.query(m.PolicyStatement))
    [row] = change_log(world)
    assert (row.action_details, row.performed_by) == ("v1.1: 1 changed (PS-0005-004)", EDITOR)


def test_statements_made_before_this_without_an_earlier_version_only_record_the_parts(world):
    _old_statements(world)

    out = parse(world, incremental=True)

    assert world.ai.calls == [] and out["changed"] == 0
    assert doc(world).statement_parts == [p.hash for p in statement_reparse.parts_of(TEXT)]
    assert all(s.source_hash for s in world.db.query(m.PolicyStatement))


# ── the update starts by itself ──────────────────────────────────────────────
@pytest.fixture
def dispatched(monkeypatch):
    calls = []
    monkeypatch.setattr(jobs, "dispatch_parse_in_thread", lambda *a, **k: calls.append((a, k)) or "thread-x")
    monkeypatch.setattr(jobs, "dispatch_parse", lambda *a, **k: calls.append((a, k)) or "celery-x")
    return calls


def tenant_session(w):
    db = w.factory()
    db.info["tenant_slug"] = "cfsb"                           # as open_tenant_session marks a real tenant session
    return db


def test_a_committed_new_text_or_file_starts_one_update_per_document(world, dispatched):
    world.db.add(m.GovernanceDocument(id=6, tenant_id=1, title="Backup policy", doc_type="policy", status="draft", content="# Backup policy\n"))
    world.db.commit()
    holder = ai_usage.new_request_holder(tenant_slug="cfsb")
    holder["actor_user_id"] = EDITOR                          # the signed-in person whose request it is
    ai_usage._request_holder.set(holder)
    db = tenant_session(world)
    five, six = db.get(m.GovernanceDocument, 5), db.get(m.GovernanceDocument, 6)
    five.content += "\nOne more line."
    five.content += "\nAnd another."                          # two changes of one document in one commit
    five.file_path = "/no/such/file.docx"
    six.content = "# Backup policy\n\nBackups must be tested."
    db.commit()

    assert sorted(dispatched, key=lambda c: c[0][1]) == [(("cfsb", 5, EDITOR), {"incremental": True}), (("cfsb", 6, EDITOR), {"incremental": True})]
    queued = policy_parser._parsing_status[5]
    assert (queued["status"], queued["automatic"], queued["message"]) == ("queued", True, "Updating statements from the new version…")
    # the create path does not start a second parse of a document its committed text already started
    assert policy_parser.maybe_autoparse_document(db, "cfsb", 6, OWNER) is True and len(dispatched) == 2
    db.close()


def test_nothing_starts_without_a_tenant_without_a_real_change_or_for_what_the_update_itself_writes(world, dispatched):
    parsed(world)
    plain = world.factory()                                   # a session that is not a tenant's (a test's, the master database)
    plain.get(m.GovernanceDocument, 5).content = TEXT.replace(SENTENCES[0], f"{SENTENCES[0]}\n\nVisitors must sign in.")
    plain.commit()
    plain.close()
    db = tenant_session(world)
    d = db.get(m.GovernanceDocument, 5)
    d.content = d.content                                     # the same text again
    d.title = "Access policy (renamed)"                       # not its text
    db.query(m.PolicyStatement).filter(m.PolicyStatement.statement_text == SHARED).one().priority = "low"
    db.commit()
    d.content = d.content + "\nA change that is rolled back."
    db.rollback()
    db.commit()
    # the update's own commits change statements and the parts they reflect, never the document's text
    policy_parser._parse_policy_body(db, 5, OWNER, None, incremental=True)
    assert [c["text"] for c in world.ai.calls] == ["Section: 1. Purpose\nVisitors must sign in."]   # the plain session's change
    assert db.query(m.PolicyStatement).filter(m.PolicyStatement.statement_text == "Visitors must sign in.").count() == 1
    db.close()
    assert dispatched == []


# ── "Parse again" and its proposals ──────────────────────────────────────────
def test_applying_what_parsing_again_proposed_places_and_maps_the_accepted_statements_again(world):
    parsed(world)
    new = TEXT.replace(SHARED, "Shared accounts shall never be used.")
    edit(world, SHARED, "Shared accounts shall never be used.")
    parse(world)                                              # Parse again: proposals for review, nothing changed yet
    proposals = policy_parser._reparse_proposals[5]
    assert proposals["parts"] == [p.hash for p in statement_reparse.parts_of(new)]
    owner = world.db.get(m.GRCUser, OWNER)
    assert "parts" not in policy_parser.get_reparse_proposals(5, REQUEST, world.db, owner)
    pick = next(p["index"] for p in proposals["proposals"] if p["new_statement"]["statement_text"] == "Shared accounts shall never be used.")
    decisions = [{"index": p["index"], "action": "accept" if p["index"] == pick else "reject"} for p in proposals["proposals"]]
    assert doc(world).statement_parts != proposals["parts"]   # still the first version's

    policy_parser.apply_reparse_proposals(5, policy_parser.ApplyReparseProposalsRequest(decisions=decisions), REQUEST, world.db, owner)

    s = statement(world, "Shared")
    assert s.statement_text == "Shared accounts shall never be used." and world.mapped == [s.id]
    assert s.source_hash == statement_reparse.part_hash(s.statement_text)
    assert doc(world).statement_parts == proposals["parts"]


def test_the_whole_document_is_asked_for_as_before_and_the_changed_parts_without_a_floor(monkeypatch):
    sent = []

    class Completions:
        def create(self, **kw):
            sent.append(kw["messages"][1]["content"])
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"statements": []}'))])

    monkeypatch.setattr(policy_parser, "OpenAI", lambda **kw: SimpleNamespace(chat=SimpleNamespace(completions=Completions())))
    monkeypatch.setattr(policy_parser, "AI_INTEGRATIONS_OPENAI_API_KEY", "test-key")      # a fake client: nothing is sent anywhere
    policy_parser.parse_policy_statements_with_openai("Access must be approved.", "Access policy")
    policy_parser.parse_policy_statements_with_openai("Access must be approved.", "Access policy", at_least=0)
    assert len(sent) == 2                                     # one call each: a short text is one chunk (it used to be 12)
    assert ("30-100+ statements.\n\nYou must extract AT LEAST 15 statements from this section if it contains policy language.\n\n"
            "IMPORTANT: Extract EVERY distinct statement.") in sent[0]
    assert "AT LEAST" not in sent[1] and "30-100+ statements.\n\nIMPORTANT: Extract EVERY distinct statement." in sent[1]


def test_a_text_is_cut_into_chunks_that_end_where_it_ends():
    line = "All staff must lock their screens when they leave their desks. "
    for size, expected in [(3_000, 1), (25_000, 2), (60_000, 4)]:
        chunks = policy_parser._split_text_into_chunks((line * 1_000)[:size])
        assert len(chunks) == expected, (size, [len(c) for c in chunks])
