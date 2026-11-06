"""A chat turn searches the internet first when the request asks for it: it names the internet or the latest, gives a link, or names a
law or standard the platform does not hold. The sources are listed under the answer, as they are under the questions before a new
document is written. Every other request is sent as before, with no tools and no extra call. The AI is a mocked wire; the SDK, the
data-protection guard, the engine and the HTTP routes are the real ones."""
import json

import pytest

import grc.models as m
from grc.modules.governance.studio import drafting, engine
from grc.services.ai_gateway import claude_client

import httpx2

from _claude_mock import _event, error, reply, searched
from test_studio_flow import ENTITY, answer, change, world          # noqa: F401  (world is a fixture)

SBP = ("https://www.sbp.org.pk/bprd/2023/C1.htm", "Framework on Risk Management in Outsourcing to Cloud Service Providers")
FOUND = "**Binding**\n- SBP Framework on Risk Management in Outsourcing to Cloud Service Providers (BPRD Circular No. 01 of 2023) — State Bank of Pakistan."
GAPS = "| Requirement | Status |\n| --- | --- |\n| Cloud outsourcing approval by the Board | missing |"


def fetched(text, *, page, cited, preface="I'll open the page."):
    """An answer that searched (finding ``cited``), then opened ``page`` ((url, title)) with the web fetch tool, as the provider streams
    it, then wrote ``text`` citing ``cited``."""
    usage = {"input_tokens": 300, "output_tokens": 1, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
    events = [("message_start", {"type": "message_start", "message": {"id": "msg_test", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
                                                                       "content": [], "stop_reason": None, "stop_sequence": None, "usage": usage}})]
    blocks = [({"type": "server_tool_use", "id": "srvtoolu_0", "name": "web_search", "input": {}}, [{"type": "input_json_delta", "partial_json": json.dumps({"query": "SBP cloud circular"})}]),
              ({"type": "web_search_tool_result", "tool_use_id": "srvtoolu_0",
                "content": [{"type": "web_search_result", "url": cited[0], "title": cited[1], "encrypted_content": "enc", "page_age": None}]}, []),
              ({"type": "text", "text": ""}, [{"type": "text_delta", "text": preface}]),
              ({"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_fetch", "input": {}}, [{"type": "input_json_delta", "partial_json": json.dumps({"url": page[0]})}]),
              ({"type": "web_fetch_tool_result", "tool_use_id": "srvtoolu_1",
                "content": {"type": "web_fetch_result", "url": page[0], "retrieved_at": "2026-10-17T00:00:00Z",
                            "content": {"type": "document", "title": page[1], "source": {"type": "text", "media_type": "text/plain", "data": "1.1 The Board shall approve ..."}}}}, []),
              ({"type": "text", "text": ""}, [{"type": "citations_delta", "citation": {"type": "web_search_result_location", "cited_text": cited[1], "url": cited[0],
                                                                                       "title": cited[1], "encrypted_index": "enc"}}, {"type": "text_delta", "text": text}])]
    for i, (block, deltas) in enumerate(blocks):
        events += [("content_block_start", {"type": "content_block_start", "index": i, "content_block": block})]
        events += [("content_block_delta", {"type": "content_block_delta", "index": i, "delta": d}) for d in deltas]
        events += [("content_block_stop", {"type": "content_block_stop", "index": i})]
    events += [("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 60}}),
               ("message_stop", {"type": "message_stop"})]
    return httpx2.Response(200, content="".join(_event(n, d) for n, d in events).encode("utf-8"), headers={"content-type": "text/event-stream"})


def script(calls, chat=None):
    """The web search when a call carries tools, else the chat answer (``chat``, or a gap analysis that changes nothing)."""
    def respond(body):
        calls.append(body)
        if body.get("tools"):
            return searched(FOUND, searches=["SBP circular cloud outsourcing latest"], pages=[SBP], cited=[SBP])
        return reply(chat or answer([], GAPS))
    return respond


def turn(world, text, doc=10, **extra):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": doc}).json()
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": text, **extra}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{sent['id']}")).json()
    assert done["status"] == "done", done.get("error")
    return s, done


@pytest.mark.parametrize("text", [
    "Do a gap analysis against the latest SBP circular on cloud.",
    f"Do a gap analysis against {SBP[0]}",
    "Do a gap analysis of this policy against the cloud outsourcing rules, from the internet.",
    "Align this policy with DORA.",                                         # a law the platform does not hold
])
def test_a_request_that_asks_for_the_internet_is_searched_first_and_the_sources_are_listed_under_the_answer(world, text):
    calls = []
    world.respond(script(calls))
    _, done = turn(world, text)
    research, chat = calls
    assert research["tools"] == ([drafting.WEB_SEARCH, drafting.WEB_FETCH] if "https://" in text else [drafting.WEB_SEARCH]) and "tools" not in chat
    assert "clause by clause" in json.dumps(research["system"])                          # the named rule's requirements, not a list of what applies
    asked = json.dumps(research["messages"])
    assert "Information Security Policy" in asked                                         # the document's title and the request ...
    assert "Access to systems shall be reviewed every year." not in asked and ENTITY not in asked     # ... never its text or the organisation's name
    shown = json.dumps(chat["messages"])
    assert "<internet_research>" in shown and "BPRD Circular No. 01 of 2023" in shown       # what was found is what the answer is written from
    assert "the requirements to analyse against" in shown and "cite their clause numbers" in shown
    assert done["content"] == GAPS + f"\n\n**Found on the internet:** [{SBP[1]}](<{SBP[0]}>)"
    assert done["proposal"]["research"] == {"text": FOUND, "sources": [{"url": SBP[0], "title": SBP[1]}]}
    assert done["usage"]["input_tokens"] == 300 + 120                                    # the search is counted with the answer


def test_a_link_in_the_request_is_opened_and_the_page_is_listed_among_the_sources(world):
    page = ("https://www.sbp.org.pk/bprd/2023/C1-annex.htm", "Annexure: cloud outsourcing requirements")
    calls = []

    def respond(body):
        calls.append(body)
        return fetched(FOUND, page=page, cited=SBP) if body.get("tools") else reply(answer([], GAPS))
    world.respond(respond)
    _, done = turn(world, f"Do a gap analysis of this policy against {page[0]}")
    research, chat = calls
    assert research["tools"] == [drafting.WEB_SEARCH, drafting.WEB_FETCH] and page[0] in json.dumps(research["messages"])
    assert done["proposal"]["research"] == {"text": FOUND, "sources": [{"url": page[0], "title": page[1]}, {"url": SBP[0], "title": SBP[1]}]}
    assert "I'll open the page." not in json.dumps(chat["messages"])                  # what it wrote before it opened the page is not research
    assert done["content"] == GAPS + f"\n\n**Found on the internet:** [{page[1]}](<{page[0]}>) · [{SBP[1]}](<{SBP[0]}>)"


@pytest.mark.parametrize("text", ["Make the review quarterly.", "Add a clause on online banking and internet access.",
                                  "Align this policy with ISO/IEC 27001.",      # the platform holds it: attached, not searched for
                                  "Make the review quarterly, as required by CFSB's board."])     # the organisation's own name is no law
def test_every_other_request_is_sent_as_before_with_no_tools_and_no_search(world, text):
    calls = []
    world.respond(script(calls, answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")], "Done.")))
    s, done = turn(world, text)
    assert len(calls) == 1 and "tools" not in calls[0]
    assert "Found on the internet" not in done["content"] and "research" not in done["proposal"]
    assert "<internet_research>" not in json.dumps(calls[0]) and done["usage"]["input_tokens"] == 120
    if "27001" in text:
        refs = world.http.get(world.api(f"/sessions/{s['id']}")).json()["references"]
        assert [r["title"] for r in refs] == ["ISO/IEC 27001 2022"]


def test_the_search_goes_through_the_guard_like_every_other_call(world, monkeypatch):
    calls, cases = [], []
    world.respond(script(calls))
    real = claude_client.complete
    monkeypatch.setattr(claude_client, "complete", lambda **kw: cases.append(kw["use_case"]) or real(**kw))
    turn(world, "Search online for the latest SBP guidance. Our service account password=hunter-ZX81-canary! is rotated by IT.")
    assert cases == ["governance.studio_research", "governance.studio_chat"]
    assert "hunter-ZX81-canary" not in json.dumps(calls[0]) and "hunter-ZX81-canary" not in json.dumps(calls[1])   # the secret never leaves


def test_the_search_is_shown_while_it_runs_with_what_was_searched_for(world):
    seen = []

    def respond(body):
        if body.get("tools"):
            return searched(FOUND, searches=["SBP circular cloud outsourcing latest"], pages=[SBP], cited=[SBP])
        with world.factory() as other:                                                    # as the screen reads it while the answer is written
            seen.append(other.query(m.StudioMessage).filter_by(role="assistant").order_by(m.StudioMessage.id.desc()).first().live)
        return reply(answer([], GAPS))
    world.respond(respond)
    turn(world, "What does the latest SBP circular on cloud require?")
    step = next(s for s in seen[0]["steps"] if s["label"] == "Searching the internet")
    assert step["state"] == "done" and step["detail"] == "1 search · 1 source"
    assert {"label": "Searched the internet for", "items": ["SBP circular cloud outsourcing latest"]} in seen[0]["groups"]


def test_when_the_internet_cannot_be_searched_the_answer_still_comes_and_says_so(world):
    calls = []
    scripted = script(calls)
    world.respond(lambda body: error(400, "web search is not enabled for this organization") if body.get("tools") else scripted(body))
    _, done = turn(world, "Do a gap analysis against the latest SBP circular on cloud.")
    assert len(calls) == 1 and done["content"] == GAPS and "research" not in done["proposal"]
    assert any("could not search the internet" in n for n in done["notes"])


def test_answers_to_comply_agents_questions_are_worked_on_with_what_was_found_when_it_asked(world):
    calls = []
    asks = json.dumps(dict(json.loads(answer([], "Which edition?", questions=[{"id": "q1", "question": "Which circular?", "why": "They differ.", "kind": "text",
                                                                                "options": [], "other": True}])), ask_first=True))
    world.respond(script(calls, asks))
    s, first = turn(world, "Do a gap analysis against the latest SBP circular on cloud.")
    assert first["proposal"]["ask_first"] == "chat" and first["content"].endswith(f"[{SBP[1]}](<{SBP[0]}>)")

    world.respond(script(calls))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": [{"id": "q1", "other": "The 2023 one"}]}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{sent['id']}")).json()
    assert len(calls) == 3 and "tools" not in calls[2]                                       # no second search
    assert "BPRD Circular No. 01 of 2023" in json.dumps(calls[2]["messages"])
    assert done["content"].endswith(f"[{SBP[1]}](<{SBP[0]}>)") and done["proposal"]["research"] == first["proposal"]["research"]


@pytest.mark.parametrize("text, expected", [
    ("Search the internet for the cloud rules.", True), ("Look it up online.", True), ("Use the latest edition.", True),
    ("Do a gap analysis against the latest SBP circular on cloud.", True), ("Search online for the latest SBP guidance.", True),
    ("Do a gap analysis of this policy against the cloud outsourcing rules, from the internet.", True),
    ("See https://example.org/rule", True), ("Map it to NIST SP 800-207.", True),
    ("Follow the Data Protection Act 2018.", True), ("Check it against the SBP circular.", False),        # the attached file is that circular
    ("Make it compliant with PCI DSS v4.0 and ISO 27001.", False), ("Keep it consistent with POL-007.", False),
    ("The CISO approves exceptions; send it to HR and IT.", False), ("Cover internet banking and web applications.", False),
    ("Follow the RACI and the SLA.", False), ("Update the Access Control Standard per the Information Security Policy.", False),
    # ordinary edits that only mention the internet, "latest" or a date
    ("Files downloaded from the internet must be scanned.", False), ("Add a rule on posting on the internet.", False),
    ("Staff browsing the internet must use the proxy.", False), ("Add a control for checking online transactions.", False),
    ("This policy is effective as of 2026.", False), ("Valid as of 2026?", False), ("Accept the latest edits and tidy the spacing.", False),
    ("Show me the latest version of this document.", False),
    ("Make the review quarterly, as required by CFSB's board.", False),           # the organisation's own name
    ("Exceptions are approved as required by the CCO.", False),                   # a role
])
def test_what_asks_for_the_internet(text, expected):
    held = lambda: ["ISO/IEC 27001", "PCI DSS", "SBP Circular No. 5 of 2026", "CFSB", ENTITY, "cfsb"]       # noqa: E731  (frameworks, references, the organisation)
    assert engine.wants_web(text, held) is expected
