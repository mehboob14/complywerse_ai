"""Writing a whole document: a new policy is planned and then written part by part, checked, put together and applied as the first
draft, instead of opening as a skeleton of placeholders. The AI is a mocked wire (tests/_claude_mock.py): the SDK, the data-protection
guard, the pipeline, the service and the HTTP routes are the real ones."""
import json
import re

import pytest

import grc.models as m
from grc.modules.governance.studio import blocks as B
from grc.modules.governance.studio import draft_prompts as P
from grc.modules.governance.studio import drafting

from _claude_mock import error, reply
from test_studio_flow import ENTITY, world          # noqa: F401  (world is a fixture)

PLAN = {
    "approach": "This policy governs who may reach the bank's systems and how that access is granted, reviewed and removed.",
    "decisions": [{"name": "Access review frequency", "value": "Quarterly for privileged access, every six months for all other access", "basis": "industry_default", "note": "usual"},
                  {"name": "Leaver access removal", "value": "Within 24 hours of the leaving date", "basis": "instruction", "note": ""}],
    "core_intro": "The policy statements are grouped by how access is requested, used and ended.",
    "areas": [{"title": "Privileged access", "focus": "How privileged access is granted and monitored.", "must_cover": ["approval", "session logging"], "refs": ["R1"], "words": 350},
              {"title": "Joiners, movers and leavers", "focus": "Access through the employee lifecycle.", "must_cover": ["joiner", "leaver"], "refs": [], "words": 350},
              {"title": "Access reviews", "focus": "Periodic recertification.", "must_cover": ["frequency", "evidence"], "refs": [], "words": 350}],
    "terms": ["Privileged account", "Least privilege"], "related_documents": [{"title": "Information Classification Standard", "kind": "standard"}],
    "external_sources": ["ISO/IEC 27001:2022", "PCI DSS v4.0"], "questions": ["Which systems hold customer card data?"],
}
CLAUSE = "{org} shall remove the access of a leaver within 24 hours of the leaving date and the Information Security Function shall record the removal in the access register. "


def text(words: int, org: str = "<ORG_1>") -> str:
    out = []
    while len(" ".join(out).split()) < words:
        out.append(CLAUSE.format(org=org).strip())
    return " ".join(out)


def part(kind: str, number: str, heading: str, org: str = "<ORG_1>") -> dict:
    if kind == "area":
        body = "\n\n".join(f"{number}.{i} {text(60, org)}" for i in range(1, 7))
    elif "Definitions" in heading:
        body = "| Term | Definition |\n| --- | --- |\n" + "\n".join(f"| Term {i} | {text(40, org)} |" for i in range(1, 8))
    else:
        body = text(480, org)
    return {"markdown": body, "references_used": [{"ref": "R1", "locator": "AC-6", "quote": "allocation and use of privileged access rights shall be restricted",
                                                   "how": "privileged access", "basis": "reference"}] if number == "7.1" else [],
            "assumptions": [f"{heading}: 12 months between reviews"] if number == "10" else []}


def script(calls, overrides=None):
    """The scripted AI: a plan, then a part for whatever the task asks for. ``overrides[heading](task)`` answers a part itself."""
    def respond(body):
        task = body["messages"][0]["content"][-1]["text"]
        calls.append({"task": task, "body": body})
        if 'kind="plan"' in task:
            return reply(json.dumps(PLAN))
        kind, number, heading = re.search(r'<task kind="(section|area)" number="([^"]+)" heading="([^"]+)"', task).groups()
        if overrides and heading in overrides:
            return overrides[heading](task)
        org = (re.findall(r"<ORG_\d+>", json.dumps(body)) or ["<ORG_1>"])[0]          # the token the guard gave the organisation's name
        return reply(json.dumps(part(kind, number, heading, org)))
    return respond


@pytest.fixture
def drafts(world, monkeypatch):
    monkeypatch.setattr(drafting, "PARALLEL", 1)                 # in order, on this thread: the scripted AI and the test database are one connection
    monkeypatch.setattr(drafting, "RETRY_WAITS", (0, 0, 0))
    world.db.add(m.GovernanceCommittee(tenant_id=1, name="IT Steering Committee of the Bank", committee_type="it_steering", meeting_frequency="monthly", is_active=True))
    world.db.add(m.GovernanceCommittee(tenant_id=1, name="test", committee_type="custom", meeting_frequency="quarterly", is_active=True))
    world.db.commit()
    return world


def new_policy(world, **extra):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Access Control Policy", "doc_type": "policy", **extra}).json()
    world.http.post(world.api(f"/sessions/{s['id']}/references"), json={"kind": "framework", "source_id": 1, "scope": {"mode": "all"}})
    return s


def finished(world, sid, mid):
    done = world.http.get(world.api(f"/sessions/{sid}/messages/{mid}")).json()
    assert done["status"] == "done", done.get("error")
    return done


# ── the whole document ───────────────────────────────────────────────────────
def test_a_new_policy_is_written_whole_planned_first_and_applied_as_the_first_draft(drafts):
    calls = []
    drafts.respond(script(calls))
    s = new_policy(drafts)
    out = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={})
    assert out.status_code == 200
    done = finished(drafts, s["id"], out.json()["id"])

    # one plan, then every part: 8 sections + 3 areas + 3 that need the rest of the document
    assert 'kind="plan"' in calls[0]["task"] and len(calls) == 1 + 8 + 3 + 3
    doc = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()
    content = doc["content"]
    headings = [b.text for b in B.parse(content) if b.kind == "heading" and b.level == 2]
    assert headings[:4] == ["1. Document Description", "2. Approval Signoff", "3. Purpose", "4. Scope and Applicability"] and "7. Policy Statements" in headings
    assert [b.text for b in B.parse(content) if b.kind == "heading" and b.level == 3][:3] == ["7.1 Privileged access", "7.2 Joiners, movers and leavers", "7.3 Access reviews"]
    assert content.startswith("# Access Control Policy") and "The policy statements are grouped by how access is requested" in content
    assert doc["revision"] == 2 and drafts.http.get(drafts.api(f"/sessions/{s['id']}/revisions")).json()["items"][0]["summary"] == "Comply Agent wrote the first draft"
    assert [o["status"] for o in done["proposal"]["ops"]] == ["accepted"]

    # the parts that are not written by the AI are real, and the organisation's own names are used where they exist
    assert "| Document Owner | Head of Information Security Governance |" in content and "| Regulatory Alignment | ISO/IEC 27001:2022; PCI DSS v4.0 |" in content
    assert "IT Steering Committee of the Bank" in content and "| Effective Date | [[Effective date]] |" in content
    assert "[[Effective date]]" in content and len([p for p in re.findall(r"\[\[[^\]]+\]\]", content)]) <= 8
    assert f"{ENTITY} shall remove the access of a leaver" in content and "<ORG_" not in content          # the real name was put back

    # what was sent: the banking craft in the system prompt, the plan's decisions in every part, nothing the guard removes
    wire = json.dumps([c["body"] for c in calls])
    assert ENTITY not in wire and "<ORG_1>" in wire
    for c in calls:
        assert "POLICY DRAFTING CRAFT" in json.dumps(c["body"]["system"]) and "VALUES YOU WERE NOT GIVEN" in json.dumps(c["body"]["system"])
    sent = [json.dumps(c["body"]["messages"]) for c in calls]                              # the user turns: the system prompt only names these blocks
    assert "<decisions>" not in sent[0] and "Access review frequency: Quarterly for privileged access" in sent[1]
    assert "<outline>" in sent[1] and "    7.1 Privileged access" in sent[1]
    assert "Committees (use these names exactly):\\n- IT Steering Committee of the Bank" in sent[0] and "- test" not in sent[0]

    # what the person is told
    assert done["content"].startswith("Written for Capital Financial Services Bank") or "<ORG_" not in done["content"]
    assert "I wrote the complete policy" in done["content"] and "3 areas in policy statements" in done["content"]
    assert any("Where nothing was specified" in n and "Access review frequency" in n for n in done["notes"])
    assert [(q["id"], q["question"], q["kind"]) for q in done["questions"]] == [("q1", "Which systems hold customer card data?", "text")]
    assert [(u["ref"], u["locator"], u["verified"]) for u in done["references_used"]] == [("R1", "AC-6", True)]
    assert done["usage"]["output_tokens"] > 0 and not drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages")).json()["items"][0]["status"] == "working"


def test_parts_written_on_other_threads_never_read_the_session(drafts, monkeypatch):
    """The session is the main thread's: a part that read it (an expired attribute reloads itself) corrupted the connection in a real run."""
    import threading

    from sqlalchemy import event

    from grc.services.ai_gateway import claude_client

    monkeypatch.setattr(drafting, "PARALLEL", 3)
    monkeypatch.setattr(claude_client, "_record", lambda **kw: None)           # the usage ledger is not what is under test, and the test database is one connection
    seen = []
    event.listen(drafts.factory.kw["bind"], "before_cursor_execute", lambda conn, cur, stmt, params, ctx, many: seen.append((threading.current_thread().name, stmt)))
    drafts.respond(script([]))
    s = new_policy(drafts)
    finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    on_workers = [stmt for name, stmt in seen if name.startswith("studio-draft")]
    assert on_workers == [], on_workers[:2]
    assert any(not name.startswith("studio-draft") for name, _ in seen)
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 2


def test_a_part_that_comes_back_short_or_vague_is_written_again_once_with_the_problems_named(drafts):
    calls, seen = [], []

    def purpose(task):
        seen.append(task)
        body = "The Bank will ensure that access is appropriate as needed." if len(seen) == 1 else text(480, "the Bank")
        return reply(json.dumps({"markdown": body, "references_used": [], "assumptions": []}))
    drafts.respond(script(calls, {"Purpose": purpose}))
    s = new_policy(drafts)
    done = finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    assert len(seen) == 2 and "too short" in seen[1] and "Your previous attempt had these problems" in seen[1] and "Your previous attempt" not in seen[0]
    content = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert "ensure that access is appropriate" not in content and done["status"] == "done"


def test_a_part_that_cannot_be_written_is_marked_and_the_rest_of_the_document_stands(drafts):
    calls = []
    drafts.respond(script(calls, {"Scope and Applicability": lambda task: error(400, "the request was rejected")}))
    s = new_policy(drafts)
    done = finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    content = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert "[[This part could not be written" in content and "## 5. Governance and Oversight" in content and "7.1 Privileged access" in content
    assert any("could not be written and are marked" in n and "Scope and Applicability" in n for n in done["notes"])


def test_a_part_that_fails_once_is_tried_again_before_it_is_given_up(drafts):
    seen = []

    def scope(task):
        seen.append(task)
        return error(400, "a one-off problem") if len(seen) == 1 else reply(json.dumps(part("section", "4", "Scope and Applicability")))
    drafts.respond(script([], {"Scope and Applicability": scope}))
    s = new_policy(drafts)
    done = finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    assert len(seen) == 2 and "could not be written" not in drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert not any("could not be written" in n for n in done["notes"])


def test_an_area_title_the_plan_numbered_itself_is_not_numbered_twice(drafts, monkeypatch):
    numbered = dict(PLAN, areas=[dict(a, title=f"7.{i} {a['title']}") for i, a in enumerate(PLAN["areas"], start=1)])
    inner = script([])
    drafts.respond(lambda body: reply(json.dumps(numbered)) if 'kind="plan"' in body["messages"][0]["content"][-1]["text"] else inner(body))
    s = new_policy(drafts)
    finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    content = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert "### 7.1 Privileged access" in content and "### 7.2 Joiners, movers and leavers" in content and "7.1 7.1" not in content


def test_clause_numbers_mentioned_but_not_in_the_document_are_found():
    md = ("## 3. Purpose\n\n3.1 See clause 7.2.1 and areas 7.1 to 7.3.\n\n## 7. Statements\n\n### 7.1 A\n\n7.1.1 Text.\n\n7.2.1 Text.\n\n### 7.2 B\n\nSection 9 applies; so does Section 7.\n")
    assert drafting.dangling_references(md) == ["7.3", "9"]


def test_credentials_the_provider_refuses_end_the_whole_draft_with_a_sentence_and_leave_the_document_alone(drafts):
    drafts.respond(lambda body: error(401, "invalid x-api-key", "authentication_error"))
    s = new_policy(drafts)
    mid = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"]
    done = drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages/{mid}")).json()
    assert done["status"] == "error" and "credentials were not accepted" in done["error"] and "anthropic" not in done["error"].lower()
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1


def test_a_plan_that_cannot_be_made_does_not_stop_the_document(drafts):
    calls = []
    inner = script(calls)
    drafts.respond(lambda body: error(400, "no plan today") if 'kind="plan"' in body["messages"][0]["content"][-1]["text"] else inner(body))
    s = new_policy(drafts, instructions={"focus_areas": "Remote access; Third-party access"})
    done = finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    content = drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["content"]
    assert "### 7.1 Remote access" in content and "### 7.2 Third-party access" in content          # the person's own focus areas stand in for the plan's
    assert any("plan could not be made" in n for n in done["notes"])


# ── asking for it ────────────────────────────────────────────────────────────
def test_a_new_document_is_written_as_soon_as_it_is_created_and_waits_for_the_person_to_open_it(drafts, monkeypatch):
    """The start page creates the document, attaches the references one by one, then opens it: the draft starts when it is opened."""
    monkeypatch.setenv("DOCUMENT_STUDIO_AUTO_DRAFT", "on")
    monkeypatch.setattr(drafting, "SETTLE_GRACE", 0)
    seen = []

    def opened(db, session_id, since):                 # the person opens the document: the references are attached by now
        seen.append(session_id)
        row = db.get(m.StudioSession, session_id)
        assert db.query(m.StudioReference).filter_by(session_id=session_id).count() == 0            # nothing attached yet: it waited for the open
        row.last_opened_at = since + __import__("datetime").timedelta(seconds=3)
        db.commit()
        return real(db, session_id, since)
    real = drafting.wait_until_opened
    monkeypatch.setattr(drafting, "wait_until_opened", opened)
    calls = []
    drafts.respond(script(calls))
    s = drafts.http.post(drafts.api("/sessions"), json={"kind": "new", "title": "Access Control Policy", "doc_type": "policy"}).json()
    items = drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages")).json()["items"]
    assert seen == [s["id"]] and [(x["role"], x["content"]) for x in items][0] == ("user", "Write the complete document.")
    assert items[1]["status"] == "done" and drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 2 and len(calls) == 15


def test_a_new_document_is_not_written_on_creation_when_it_is_blank_or_other_or_declined_or_switched_off(drafts, monkeypatch):
    monkeypatch.setenv("DOCUMENT_STUDIO_AUTO_DRAFT", "on")
    monkeypatch.setattr(drafting, "SETTLE_GRACE", 0)
    monkeypatch.setattr(drafting, "SETTLE_MAX", 0.2)
    calls = []
    drafts.respond(script(calls))

    def created(**body):
        s = drafts.http.post(drafts.api("/sessions"), json={"kind": "new", "title": "T", **body}).json()
        return drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages")).json()["items"]
    assert created(doc_type="policy", template_id="builtin:blank") == []                      # the blank template is a deliberate empty start
    assert created(doc_type="other", template_id="builtin:blank") == []
    assert created(doc_type="policy", draft=False) == []                                      # the caller said not to
    monkeypatch.setenv("DOCUMENT_STUDIO_AUTO_DRAFT", "off")
    assert created(doc_type="policy") == []                                                   # the operator switched it off
    monkeypatch.setenv("DOCUMENT_STUDIO_AUTO_DRAFT", "on")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert created(doc_type="policy") == []                                                   # the AI is not set up: nothing is started
    assert calls == []
    library = drafts.http.post(drafts.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    assert drafts.http.get(drafts.api(f"/sessions/{library['id']}/messages")).json()["items"] == []


def test_the_draft_waits_for_the_document_to_be_opened_and_no_longer_than_the_limit(drafts, monkeypatch):
    from datetime import timedelta

    monkeypatch.setattr(drafting, "SETTLE_GRACE", 0)
    s = drafts.http.post(drafts.api("/sessions"), json={"kind": "new", "title": "T", "doc_type": "policy"}).json()
    since = drafts.db.get(m.StudioSession, s["id"]).last_opened_at
    monkeypatch.setattr(drafting, "SETTLE_MAX", 0.6)
    started = drafting.time.monotonic()
    drafting.wait_until_opened(drafts.db, s["id"], since)                                        # never opened: gives up at the limit
    assert 0.5 <= drafting.time.monotonic() - started < 3
    monkeypatch.setattr(drafting, "SETTLE_MAX", 30)
    drafts.db.get(m.StudioSession, s["id"]).last_opened_at = since + timedelta(seconds=2)
    drafts.db.commit()
    started = drafting.time.monotonic()
    drafting.wait_until_opened(drafts.db, s["id"], since)                                        # opened: returns at once
    assert drafting.time.monotonic() - started < 2
    drafting.wait_until_opened(drafts.db, 99999, since)                                          # deleted meanwhile: returns


def test_the_chat_writes_the_whole_document_when_asked_for_it_on_a_document_not_yet_started(drafts):
    calls = []
    drafts.respond(script(calls))
    s = new_policy(drafts)
    msg = drafts.http.post(drafts.api(f"/sessions/{s['id']}/messages"), json={"text": "Write the complete access control policy."}).json()
    done = finished(drafts, s["id"], msg["id"])
    assert 'kind="plan"' in calls[0]["task"] and len(calls) == 15 and "The person's request: Write the complete access control policy." in json.dumps(calls[0]["body"])
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 2 and done["kind"] == "chat"


def test_what_counts_as_a_request_for_the_whole_document():
    class S:                    # a session that has not been started
        kind, doc_type, revision_no = "new", "policy", 1
    blank = B.parse("")
    started = type("T", (), {"kind": "new", "doc_type": "policy", "revision_no": 3})()
    for yes in ("Write the complete access control policy", "Draft the full policy", "write a detailed standard from scratch", "Create the Information Security Policy"):
        assert drafting.wants_whole_document(S, blank, yes), yes
    for no in ("Make the purpose shorter", "Write an introduction", "Add a section on contractors", "Write the scope paragraph", "What does section 3 say?"):
        assert not drafting.wants_whole_document(S, blank, no), no
    assert not drafting.wants_whole_document(started, B.parse("# A\n\ntext\n"), "Write the complete policy")           # already started: edit it, do not replace it
    assert not drafting.wants_whole_document(type("L", (), {"kind": "library", "doc_type": "policy", "revision_no": 1})(), blank, "Write the complete policy")
    assert not drafting.wants_whole_document(type("O", (), {"kind": "new", "doc_type": "other", "revision_no": 1})(), blank, "Write the complete memo")


def test_the_draft_route_refuses_what_it_cannot_write(drafts, monkeypatch):
    drafts.respond(script([]))
    memo = drafts.http.post(drafts.api("/sessions"), json={"kind": "new", "title": "Memo", "template_id": "builtin:blank", "doc_type": "other"}).json()
    assert drafts.http.post(drafts.api(f"/sessions/{memo['id']}/draft"), json={}).status_code == 400
    library = drafts.http.post(drafts.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    assert drafts.http.post(drafts.api(f"/sessions/{library['id']}/draft"), json={}).status_code == 400
    s = new_policy(drafts)
    drafts.http.put(drafts.api(f"/sessions/{s['id']}/content"), json={"content": s["content"] + "\nMy own paragraph.\n", "base_revision": s["revision"]})
    started = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={})
    assert started.status_code == 400 and "already been started" in started.json()["detail"]
    assert drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={"rewrite": True}).status_code == 200
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    fresh = new_policy(drafts)
    assert drafts.http.post(drafts.api(f"/sessions/{fresh['id']}/draft"), json={}).status_code == 503


# ── the checks and the parts that are not the AI's ───────────────────────────
def test_what_a_reviewer_would_send_back():
    good = "\n\n".join(f"4.{i} The Chief Information Security Officer shall review privileged accounts every 90 days and keep the result for 7 years." for i in range(1, 8))
    assert drafting.problems(good, minimum_words=60, minimum_clauses=5, number="4") == []
    short = drafting.problems("4.1 The Bank shall act.", minimum_words=100, minimum_clauses=3, number="4")
    assert any("too short" in p for p in short) and any("numbered items" in p for p in short)
    vague = drafting.problems(("The Bank will ensure that controls are appropriate as needed. " * 6).strip(), minimum_words=10)
    assert any("vague wording" in p for p in vague)
    assert any("phrases a finished document never has" in p for p in drafting.problems("Your organization should do this TBD and more words here to pass.", minimum_words=5))
    assert any("5 placeholders" not in p and "placeholders" in p for p in drafting.problems("[[a]] [[b]] [[c]] [[d]] [[e]] [[f]] words " * 3, minimum_words=5))


def test_a_part_is_kept_to_its_own_heading_and_to_the_levels_below_the_sections():
    section = drafting.Section(number="3", heading="Purpose", full_heading="3. Purpose", key="purpose", kind="narrative", focus="", min_words=10, target_words=20)
    assert drafting._clean("## 3. Purpose\n\nThe text.\n\n## Another\n\nMore.", section) == "The text.\n\n### Another\n\nMore."
    assert drafting._clean("```markdown\n# Purpose\n\nThe text.\n```", section) == "The text."
    assert drafting._clean("### 3.1 Sub heading\n\nThe text.", section).startswith("### 3.1 Sub heading")


def test_committees_in_the_profile_that_are_test_data_are_not_given_to_the_writer():
    assert P.real_name("Board Risk Management Committee") and not P.real_name("test") and not P.real_name("Demo committee") and P.real_name("IT", 2)
    assert not P.real_name("abc") and not P.real_name("")
