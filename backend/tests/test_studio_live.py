"""What the screen is shown while the AI works: the answer as it is written (with the real names back in it, never half a placeholder), the
steps taken, the changes being prepared, and each part of a document with its words so far. The AI is a mocked wire (tests/_claude_mock.py):
the SDK, the data-protection guard, the pipeline, the service and the HTTP routes are the real ones. Only the timing is turned up."""
import copy
import json
import re

import pytest

from grc.modules.governance.studio import live
from grc.services import ai_usage
from grc.services.ai_gateway import claude_client
from grc.services.ai_gateway.engine import Gateway
from grc.services.ai_gateway.tokens import TokenMap

from _claude_mock import reply
from test_studio_draft import drafts, finished, new_policy, script          # noqa: F401  (drafts is a fixture)
from test_studio_flow import ENTITY, answer, change, world                    # noqa: F401  (world is a fixture)


@pytest.fixture
def trail(monkeypatch):
    """Every state the live view of a message went through, in order: ``(stage, live)``."""
    seen = []
    real = live._save

    def spy(db, msg, view, stage=None):
        real(db, msg, view, stage)
        seen.append((msg.stage, copy.deepcopy(msg.live)))

    monkeypatch.setattr(live, "_save", spy)
    monkeypatch.setattr(claude_client, "PROGRESS_EVERY", 0)         # report every delta, not every 0.4 s
    monkeypatch.setattr(live, "SAVE_EVERY", 0)
    return seen


# ── the guard and the half-written answer ────────────────────────────────────
def test_a_placeholder_still_being_written_is_held_back_and_the_report_is_not_counted_twice():
    scope = TokenMap()
    assert scope.token("ORG", ENTITY) == "<ORG_1>"
    gw = Gateway("protect", scope, {"decision": "allowed"})
    assert gw.restore_partial(f"Policy of <ORG_1> and <OR") == f"Policy of {ENTITY} and "
    assert gw.restore_partial("Policy of <ORG_") == "Policy of " and gw.restore_partial("Policy of <") == "Policy of "
    assert gw.restore_partial("Policy of <ORG_1>") == f"Policy of {ENTITY}"
    assert gw.restore_partial("nothing to restore") == "nothing to restore"
    assert "restored" not in gw.report                                  # the finished answer is counted once, by restore_json
    assert Gateway("monitor", scope, {}).restore_partial("<ORG_1>") == "<ORG_1>"       # monitor mode replaced nothing


def test_a_half_written_structured_answer_is_read_as_far_as_it_goes():
    part = claude_client._partial_json('{"reply": "One\\ntwo <ORG_1>", "changes": [{"kind": "replace", "start": "B4", "markdown": "## Ti')
    assert part["reply"] == "One\ntwo <ORG_1>"
    assert part["changes"][0]["kind"] == "replace" and part["changes"][0]["markdown"] == "## Ti"
    assert claude_client._partial_json("") is None and claude_client._partial_json('{"rep') in (None, {})


def test_the_reply_is_shown_as_it_arrives_with_the_real_names_back(world, monkeypatch):
    monkeypatch.setattr(claude_client, "PROGRESS_EVERY", 0)
    schema = {"type": "object", "properties": {"reply": {"type": "string"}}, "required": ["reply"], "additionalProperties": False}
    world.respond(lambda body: reply(json.dumps({"reply": "The policy of <ORG_1> is ready; <ORG_1> owns it."}), chunk=9))
    seen = []

    def call(**kw):
        with ai_usage.usage_scope(tenant_slug="cfsb", actor_user_id=1, actor_username="olivia"):
            return claude_client.complete(use_case="governance.studio_chat", system="s", schema=schema,
                                          messages=[{"role": "user", "content": f"Write the policy of {ENTITY}."}], **kw)

    out = call(on_progress=lambda p: seen.append((p.phase, p.show(str((p.data or {}).get("reply") or "")), p.protected)))
    assert seen[0][0] == "reading" and seen[0][2] >= 1                      # the AI has the request, and the name was replaced before it went
    shown = [text for phase, text, _ in seen if phase == "writing" and text]
    assert len(shown) > 3 and all("<" not in text for text in shown)       # never half a placeholder, never a placeholder
    assert shown == sorted(shown, key=len) and ENTITY in shown[-1]
    assert out.data["reply"] == f"The policy of {ENTITY} is ready; {ENTITY} owns it."
    assert out.report["restored"] == call().report["restored"]              # watching the answer did not change what the report counts


def test_a_screen_that_fails_does_not_fail_the_call(world, monkeypatch):
    monkeypatch.setattr(claude_client, "PROGRESS_EVERY", 0)
    world.respond(lambda body: reply(json.dumps({"reply": "Fine."}), chunk=3))
    calls = []

    def broken(p):
        calls.append(p.phase)
        raise RuntimeError("the screen broke")

    with ai_usage.usage_scope(tenant_slug="cfsb", actor_user_id=1, actor_username="olivia"):
        out = claude_client.complete(use_case="governance.studio_chat", system="s", messages=[{"role": "user", "content": "Say fine."}],
                                     schema={"type": "object", "properties": {"reply": {"type": "string"}}, "required": ["reply"], "additionalProperties": False},
                                     on_progress=broken)
    assert out.data == {"reply": "Fine."} and calls == ["reading"]          # dropped after the first failure, the answer still arrived


# ── a chat turn ──────────────────────────────────────────────────────────────
def test_a_chat_turn_shows_its_steps_the_reply_and_each_change_as_the_ai_writes_it(world, trail):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.", reason="quarterly"),
                                             change("insert", "B3", markdown="## 4. Review\n\nThis policy is reviewed every year.", reason="missing")],
                                            "I made the review quarterly for <ORG_1> and added a review section."), chunk=11))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Review quarterly please"}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{sent['id']}")).json()
    assert done["status"] == "done" and done["live"] is None and done["stage"] is None            # nothing of the live view is kept

    views = [v for _, v in trail if v]
    labels = [[st["label"] for st in v["steps"]] for v in views]
    assert any(l[:1] == ["Reading the document and the references"] for l in labels)
    reading = next(v for v in views if v["steps"][0].get("detail"))
    assert reading["steps"][0]["detail"].endswith("no references") and "blocks" in reading["steps"][0]["detail"]
    ai = next(v for v in views if any(st["label"] == "The AI is reading your request" for st in v["steps"]))
    assert re.fullmatch(r"Protected \d+ values? \(names, numbers, secrets\) before sending", next(st for st in ai["steps"] if st["label"] == "The AI is reading your request")["detail"])

    replies = [v["text"] for v in views if v.get("text")]
    assert len(replies) > 2 and all("<" not in t for t in replies) and ENTITY in replies[-1] and replies[-1].startswith("I made the review quarterly")
    items = [v["groups"][0]["items"] for v in views if v.get("groups")]
    assert items[0][0].startswith("Rewording block 7") and items[-1][0].startswith("Rewording block 7") and items[-1][1].startswith("Adding after block 3")
    assert next(v for v in views if v.get("tail"))["tail_label"].startswith("Rewording block 7")
    stages = [st for st, _ in trail if st]
    assert "Writing the reply" in stages and "Preparing the changes: 2 so far" in stages

    # the page asks for this, small: no proposal, no content of the answers
    out = world.http.get(world.api(f"/sessions/{s['id']}/progress")).json()["items"]
    assert out[-1]["id"] == sent["id"] and set(out[-1]) == {"id", "status", "stage", "live"} and out[-1]["status"] == "done"
    world.me["id"] = 2
    assert world.http.get(world.api(f"/sessions/{s['id']}/progress")).status_code == 404       # somebody else's session


def test_the_progress_poll_shows_a_working_turn_and_closes_a_dead_one_without_writing_otherwise(world):
    from datetime import datetime, timedelta

    import grc.models as m

    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "T", "template_id": "builtin:blank", "doc_type": "other"}).json()
    working = m.StudioMessage(session_id=s["id"], role="assistant", kind="chat", status="working", stage="Writing", created_by=1,
                              live={"seq": 3, "steps": [{"label": "Writing the reply", "state": "active"}], "text": "Half a rep"})
    world.db.add(working)
    world.db.commit()
    (row,) = world.http.get(world.api(f"/sessions/{s['id']}/progress")).json()["items"]
    assert row == {"id": working.id, "status": "working", "stage": "Writing", "live": {"seq": 3, "steps": [{"label": "Writing the reply", "state": "active"}], "text": "Half a rep"}}
    assert world.http.get(world.api(f"/sessions/{s['id']}/messages")).json()["items"][0]["live"]["text"] == "Half a rep"

    working.updated_at = datetime.utcnow() - timedelta(minutes=30)
    world.db.commit()
    (row,) = world.http.get(world.api(f"/sessions/{s['id']}/progress")).json()["items"]
    assert row["status"] == "error" and row["live"] is None and world.db.get(m.StudioMessage, working.id).live is None       # finishing a message forgets its live view


def test_a_whole_document_written_in_one_go_says_how_many_words_so_far(world, trail):
    s = world.http.post(world.api("/sessions"), json={"kind": "new", "title": "Memo", "template_id": "builtin:blank", "doc_type": "other"}).json()
    md = "# Memo\n\n## Purpose\n\n" + "<ORG_1> shall control access to its systems. " * 30
    world.respond(lambda body: reply(answer([change("replace_all", markdown=md)], "Drafted."), chunk=40))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Write a short memo"}).json()
    assert world.http.get(world.api(f"/sessions/{s['id']}/messages/{sent['id']}")).json()["status"] == "done"
    stages = [st for st, _ in trail if st and st.startswith("Writing the whole document")]
    counts = [int(re.search(r"([\d,]+) words so far", st).group(1).replace(",", "")) for st in stages]
    assert len(counts) > 3 and counts == sorted(counts) and counts[-1] > counts[0]
    tails = [v["tail"] for _, v in trail if v and v.get("tail")]
    assert tails and all("<" not in t for t in tails) and ENTITY in tails[-1]


def test_a_check_says_how_many_problems_it_has_found_so_far(world, trail):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    issue = {"block": "B5", "kind": "grammar", "quote": "All employees and contractors", "suggestion": "All employees, and all contractors", "message": "comma", "severity": "info"}
    world.respond(lambda body: reply(json.dumps({"issues": [issue, dict(issue, kind="spelling"), dict(issue, kind="style")], "requirements": [], "summary": "Mostly clean."}), chunk=30))
    world.http.post(world.api(f"/sessions/{s['id']}/checks?ai=true"))
    stages = [st for st, _ in trail if st]
    assert "Checking" in stages and any(re.fullmatch(r"Checking: [123] problems? so far", st) for st in stages)
    assert "Checking: 3 problems so far" in stages


# ── a whole document ─────────────────────────────────────────────────────────
def test_a_draft_shows_the_plan_then_every_part_with_its_words_and_leaves_nothing_behind(drafts, trail):
    drafts.respond(script([]))
    s = new_policy(drafts)
    out = drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()
    done = finished(drafts, s["id"], out["id"])
    assert done["live"] is None and done["stage"] is None
    views = [v for _, v in trail if v]

    plan = [v for v in views if len(v.get("groups") or []) == 2][-1]            # the choices the plan makes, and the areas it will cover
    assert plan["text"].startswith("This policy governs who may reach the bank's systems") and plan["text_label"] == "How it will approach the document"
    choices, areas = plan["groups"]
    assert choices["label"] == "Choices made" and choices["items"][0].startswith("Access review frequency: Quarterly for privileged access")
    assert choices["items"][0].endswith("(usual practice)") and choices["items"][1].endswith("(from your instruction)")
    assert areas == {"label": "Areas to cover", "items": ["Privileged access", "Joiners, movers and leavers", "Access reviews"]}

    details = [st["detail"] for v in views for st in v["steps"] if st["label"] == "Planning the document" and st.get("detail")]          # what the plan call is doing, from the first moment
    assert details[0] == "The AI is reading the brief" and "Writing the plan" in details and details[-1].endswith("choices made")

    with_parts = [v for v in views if v.get("parts")]
    labels = [p["label"] for p in with_parts[0]["parts"]]
    assert "7.1 Privileged access" in labels and "7.3 Access reviews" in labels and any(l.startswith("3. Purpose") for l in labels)
    written_last = [p for p in with_parts[0]["parts"] if p.get("note") == "Written last, from the rest of the document"]
    assert len(written_last) == 3                                                  # the glossary, the related documents and the matrix wait for the rest
    states = {p["label"]: [] for p in with_parts[0]["parts"]}
    for v in with_parts:
        for p in v["parts"]:
            states[p["label"]].append((p["state"], p["words"]))
    for label, seq in states.items():
        order = [st for st, _ in seq]
        assert order[0] == "todo" and order[-1] == "done", (label, order)
    assert any(state == "writing" and words > 0 for seq in states.values() for state, words in seq)        # the words grow while it is written
    assert any(p.get("phase") == "reading" for v in with_parts for p in v["parts"])                       # and before the first word the AI is reading the brief
    assert not any(p.get("phase") and p["words"] for v in with_parts for p in v["parts"])                  # once there are words the phase is not shown
    assert any(v.get("tail") and v["tail_label"].startswith("Writing ") for v in with_parts)
    assert all(re.fullmatch(r"[^<]*", v["tail"]) for v in with_parts if v.get("tail"))
    counts = [re.search(r"Writing the document: (\d+) of (\d+) parts", st) for st, _ in trail if st]
    counts = [(int(c.group(1)), int(c.group(2))) for c in counts if c]
    assert counts[0][0] == 0 and counts[-1][1] == len(with_parts[-1]["parts"]) and counts[-1][0] == counts[-1][1] - len(written_last)      # the three written last are counted too
    final = [st for st, _ in trail if st]
    assert final.index("Planning the document") < final.index("Putting the document together")


def test_a_part_that_falls_short_is_shown_as_rewritten_with_the_reason(drafts, trail, monkeypatch):
    short = {"markdown": "<ORG_1> shall control access.", "references_used": [], "assumptions": []}

    def respond(body):
        task = body["messages"][0]["content"][-1]["text"]
        if 'heading="Purpose"' in task and "too short" not in task:
            return reply(json.dumps(short))
        return script([])(body)

    drafts.respond(respond)
    s = new_policy(drafts)
    finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    purpose = [p for _, v in trail if v and v.get("parts") for p in v["parts"] if p["label"].endswith("Purpose")]
    rewriting = [p for p in purpose if p["state"] == "rewriting"]
    assert rewriting and rewriting[0]["note"].startswith("Rewriting: It is too short") and purpose[-1]["state"] == "done" and purpose[-1]["note"] == "Rewritten once"


def test_parts_written_on_other_threads_report_through_the_board_and_never_touch_the_session(drafts, trail, monkeypatch):
    import threading

    from sqlalchemy import event

    monkeypatch.setattr(claude_client, "_record", lambda **kw: None)            # the usage ledger is not under test, and the test database is one connection
    monkeypatch.setattr("grc.modules.governance.studio.drafting.PARALLEL", 4)
    seen = []
    event.listen(drafts.factory.kw["bind"], "before_cursor_execute", lambda conn, cur, stmt, params, ctx, many: seen.append((threading.current_thread().name, stmt)))
    drafts.respond(script([]))
    s = new_policy(drafts)
    finished(drafts, s["id"], drafts.http.post(drafts.api(f"/sessions/{s['id']}/draft"), json={}).json()["id"])
    assert [stmt for name, stmt in seen if name.startswith("studio-draft")] == []
    assert any(v and v.get("parts") and any(p["state"] in ("writing", "done") for p in v["parts"]) for _, v in trail)      # saved by the main thread from what the workers reported
