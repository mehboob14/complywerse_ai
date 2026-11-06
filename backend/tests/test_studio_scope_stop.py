"""Before a new document is written the person settles its scope and rules (Comply Agent looks them up on the internet and in the
platform, and asks); while it is written the document is shown as far as it goes; and the person can stop Comply Agent at any point,
which applies nothing. The AI is a mocked wire (tests/_claude_mock.py): the SDK, the guard, the engine, the service and the routes are real."""
import json

import pytest

import grc.models as m
from grc.modules.governance.studio import drafting, live, service
from grc.services.ai_gateway import claude_client

from _claude_mock import error, reply, searched
from test_studio_draft import RESEARCH, SBP, SCOPE, drafts, finished, new_policy, script   # noqa: F401  (drafts is a fixture)
from test_studio_flow import ENTITY, answer, change, world                                 # noqa: F401  (world is a fixture)

REQUEST = "Write the complete access control policy for our bank in Pakistan."


def task_of(body) -> str:
    content = body["messages"][0]["content"]
    return content[-1]["text"] if isinstance(content, list) else content


def ask(world, sid, text=REQUEST):
    return world.http.post(world.api(f"/sessions/{sid}/messages"), json={"text": text}).json()


def stop_latest(world):
    """What the Stop button does, from another session: the turn's own session must see it."""
    with world.factory() as other:
        msg = other.query(m.StudioMessage).filter_by(role="assistant").order_by(m.StudioMessage.id.desc()).first()
        assert service.stop_turn(other, msg)


@pytest.fixture
def quick(monkeypatch):
    monkeypatch.setattr(live, "STOP_EVERY", 0)              # look at the Stop on every event, not once a second
    monkeypatch.setattr(live, "SAVE_EVERY", 0)
    monkeypatch.setattr(drafting, "PREVIEW_EVERY", 0)


# ── the web search ───────────────────────────────────────────────────────────
def test_a_web_searched_answer_is_what_was_written_after_the_last_search_with_the_pages_it_cites(world):
    wire = world.respond(lambda body: searched(RESEARCH, searches=["access control rules banks Pakistan"], pages=[SBP, ("https://example.org/x", "Other")],
                                               cited=[SBP], preface="I'll search for that."))
    out = claude_client.complete(use_case="governance.studio_research", system="s", messages=[{"role": "user", "content": "q"}],
                                 tools=[drafting.WEB_SEARCH], max_tokens=100)
    assert out.text == RESEARCH and out.searches == ["access control rules banks Pakistan"]
    assert out.sources == [{"url": SBP[0], "title": SBP[1]}]                                  # the page it cites, not every page it saw
    body = wire.requests[0].body
    assert body["tools"] == [drafting.WEB_SEARCH] and "format" not in body["output_config"]


def test_a_stop_before_or_during_a_call_abandons_it(world):
    wire = world.respond(lambda body: reply(json.dumps({"x": 1}) * 3, chunk=4))
    with pytest.raises(claude_client.ClaudeStopped):
        claude_client.complete(use_case="governance.studio_chat", system="s", messages=[{"role": "user", "content": "q"}], should_stop=lambda: True)
    assert wire.requests == []                                                                # nothing was sent
    seen = []
    with pytest.raises(claude_client.ClaudeStopped):
        claude_client.complete(use_case="governance.studio_chat", system="s", messages=[{"role": "user", "content": "q"}],
                               should_stop=lambda: seen.append(1) or len(seen) > 3)
    assert len(wire.requests) == 1 and len(seen) == 4


# ── asking before a new document is written ──────────────────────────────────
def test_the_questions_before_a_new_document_come_from_the_internet_and_the_platform(drafts):
    calls = []
    drafts.respond(script(calls))
    s = new_policy(drafts)
    asked = finished(drafts, s["id"], ask(drafts, s["id"])["id"])

    research, scope = calls[0]["body"], calls[1]["body"]
    sent = json.dumps(research)
    assert research["tools"] == [drafting.WEB_SEARCH] and "Access Control Policy" in sent and "in Pakistan" in sent
    assert ENTITY not in sent and "<ORG_" not in json.dumps(research["messages"])             # the search never carries the organisation's name
    shown = json.dumps(scope["messages"])
    assert "<internet_research>" in shown and "BPRD Circular No. 05 of 2017" in shown          # what was found, for the options
    assert "<platform_frameworks>" in shown and "- ISO/IEC 27001 (2022)" in shown               # what the platform holds, labelled to be attached
    assert ENTITY not in json.dumps(scope)

    assert asked["content"].startswith(SCOPE["understood"]) and "Before I write the policy, settle what it covers" in asked["content"]
    assert f"**Found on the internet:** [{SBP[1]}](<{SBP[0]}>)" in asked["content"]
    assert asked["proposal"]["research"] == {"text": RESEARCH, "sources": [{"url": SBP[0], "title": SBP[1]}]}
    assert asked["proposal"]["ops"] == [] and asked["references_used"] == [] and len(asked["questions"]) == 2
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1         # the document is untouched
    assert drafting.asked_before(drafts.db, s["id"], asked["id"] + 1)


def test_when_the_internet_cannot_be_searched_it_still_asks_and_says_so(drafts):
    calls = []
    scripted = script(calls)
    drafts.respond(lambda body: error(400, "web search is not enabled for this organization") if body.get("tools") else scripted(body))
    s = new_policy(drafts)
    asked = finished(drafts, s["id"], ask(drafts, s["id"])["id"])
    assert len(calls) == 1 and "What Comply Agent found on the internet" not in json.dumps(calls[0]["body"]) and len(asked["questions"]) == 2
    assert any("could not search the internet" in n for n in asked["notes"]) and "Found on the internet" not in asked["content"]


def test_it_never_writes_without_asking_even_when_no_questions_come_back(drafts):
    calls = []
    scripted = script(calls)
    drafts.respond(lambda body: reply(json.dumps({"understood": "", "questions": []})) if 'kind="scope"' in task_of(body) else scripted(body))
    s = new_policy(drafts)
    asked = finished(drafts, s["id"], ask(drafts, s["id"])["id"])
    assert [(q["id"], q["kind"]) for q in asked["questions"]] == [("q1", "text")] and "which laws, regulations" in asked["questions"][0]["question"]
    assert asked["proposal"]["ask_first"] == "draft" and drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1


# ── the document while it is written ─────────────────────────────────────────
def test_the_document_is_shown_as_far_as_it_is_written_and_forgotten_when_it_is_done(drafts, quick):
    calls, seen = [], []
    scripted = script(calls)

    def respond(body):
        if 'heading="Access reviews"' in task_of(body):                                      # the third area is about to be written
            with drafts.factory() as other:
                msg = other.query(m.StudioMessage).filter_by(role="assistant").order_by(m.StudioMessage.id.desc()).first()
                seen.append((msg.preview, (msg.live or {}).get("preview_seq")))
        return scripted(body)

    drafts.respond(respond)
    s = new_policy(drafts)
    mid = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"]
    preview, seq = seen[0]
    assert seq and preview.startswith("# Access Control Policy\n\n## 1. Document Description")
    assert "| Document Owner | Head of Information Security Governance |" in preview                          # the parts that are not written
    assert "### 7.1 Privileged access\n\n7.1.1 " in preview and f"{ENTITY} shall remove the access of a leaver" in preview   # done, names put back
    assert "### 7.3 Access reviews\n\n*Comply Agent is writing this part…*" in preview                       # about to be written
    assert "*Written last, from the rest of the document.*" in preview and "<ORG_" not in preview
    done = finished(drafts, s["id"], mid)
    row = drafts.db.get(m.StudioMessage, mid)
    drafts.db.refresh(row)
    assert row.preview is None and done["live"] is None
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages/{mid}/preview")).json() == {"seq": 0, "markdown": ""}


# ── stopping ─────────────────────────────────────────────────────────────────
def test_a_draft_that_is_stopped_writes_nothing_more_and_changes_nothing(drafts, quick):
    calls = []
    scripted = script(calls)

    def respond(body):
        out = scripted(body)
        if len(calls) == 3:                    # the plan and two parts: then the person presses Stop
            stop_latest(drafts)
        return out

    drafts.respond(respond)
    s = new_policy(drafts)
    mid = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"]
    assert len(calls) == 3                                                                   # no part was asked for after the Stop
    msg = drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages/{mid}")).json()
    assert (msg["status"], msg["content"], msg["live"], msg["proposal"]) == ("stopped", service.STOPPED, None, None)
    row = drafts.db.get(m.StudioMessage, mid)
    drafts.db.refresh(row)
    assert row.preview is None and row.stage is None
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1


def test_a_stop_that_comes_after_the_last_part_still_applies_nothing(drafts, monkeypatch):
    """The parts never noticed (the Stop is looked at rarely here): the result is not applied because the message is checked, locked, before."""
    monkeypatch.setattr(live, "STOP_EVERY", 10 ** 6)
    calls = []
    scripted = script(calls)

    def respond(body):
        out = scripted(body)
        if len(calls) == 15:                   # the plan and every part: the last part is being written when the person presses Stop
            stop_latest(drafts)
        return out

    drafts.respond(respond)
    s = new_policy(drafts)
    mid = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"]
    assert len(calls) == 15                                                                  # every part was written
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages/{mid}")).json()["status"] == "stopped"
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1         # and none of it was applied


def test_asking_again_after_a_stop_keeps_the_answers_already_given(drafts, quick):
    calls, stop_at = [], {"n": 0}
    scripted = script(calls)

    def respond(body):
        out = scripted(body)
        if len(calls) == stop_at["n"]:
            stop_latest(drafts)
        return out

    drafts.respond(respond)
    s = new_policy(drafts)
    first = ask(drafts, s["id"])                                                              # the research and the questions
    stop_at["n"] = 4                                                                         # then the plan and one part, and Stop
    answered = drafts.http.post(drafts.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": [
        {"id": "q1", "chosen": ["SBP ETGRM Framework 2017"]}]}).json()
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}/messages/{answered['id']}")).json()["status"] == "stopped"

    stop_at["n"] = 0
    again = ask(drafts, s["id"], "Write the complete policy.")
    finished(drafts, s["id"], again["id"])
    plan = [c for c in calls if 'kind="plan"' in c["task"]][-1]
    sent = json.dumps(plan["body"])
    assert REQUEST in sent and "SBP ETGRM Framework 2017" in sent and "Write the complete policy." in sent               # the answers are not lost
    assert "The person has already answered your questions" in plan["task"] and "<internet_research>" in sent
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 2


def test_a_chat_turn_that_is_stopped_proposes_nothing(world, quick):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()

    def respond(body):
        stop_latest(world)
        return reply(answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")], "Made it quarterly."), chunk=20)

    world.respond(respond)
    mid = ask(world, s["id"], "Make access reviews quarterly.")["id"]
    msg = world.http.get(world.api(f"/sessions/{s['id']}/messages/{mid}")).json()
    assert (msg["status"], msg["content"], msg["proposal"]) == ("stopped", service.STOPPED, None)
    assert world.http.get(world.api(f"/sessions/{s['id']}")).json()["revision"] == 1
    again = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Now make them monthly."})
    assert again.status_code == 200                                                          # a stopped turn does not block the next one


def test_the_stop_route_stops_only_a_turn_that_is_working(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    working = service.start_turn(world.db, world.db.get(m.StudioSession, s["id"]), world.db.get(m.GRCUser, 1), "Shorten it.")   # not run
    out = world.http.post(world.api(f"/sessions/{s['id']}/messages/{working.id}/stop"))
    assert out.status_code == 200 and (out.json()["status"], out.json()["content"]) == ("stopped", service.STOPPED)
    assert world.http.post(world.api(f"/sessions/{s['id']}/messages/{working.id}/stop")).status_code == 409   # already stopped
    world.me["id"] = 2
    assert world.http.post(world.api(f"/sessions/{s['id']}/messages/{working.id}/stop")).status_code == 404   # someone else's session
