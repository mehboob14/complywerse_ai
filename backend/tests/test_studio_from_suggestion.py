"""A document suggested for a framework, made in one step and written in full: the suggestion becomes the document's brief, the frameworks are
attached, the organisation's profile is the setup, the person's details are kept for Move to library, and the whole document starts being written
at the Standard length (about 4 to 8 pages). The AI is the scripted wire of test_studio_draft."""
import pytest

from grc.modules.governance.studio import setup
from grc.services.ai_gateway import claude_client

from test_studio_draft import drafts, finished, script          # noqa: F401  (drafts is a fixture)
from test_studio_flow import world                              # noqa: F401  (the fixture drafts builds on)

BODY = {
    "title": "Access Control Policy", "doc_type": "policy", "description": "Sets who may reach the bank's systems and how access is granted, reviewed and removed.",
    "framework_ids": [1], "controls": ["A.5.15", "A.5.16", "A.8.2"],
    "details": {"owner_id": 1, "department_id": 7, "classification": "confidential", "review_cycle_months": 24, "effective_date": "2026-12-01"},
    "signoff": {"reviewers": [{"target_type": "user", "target_id": 2, "display": "Sara"}, {"target_type": "user", "target_id": "x"}],
                "approvers": [{"target_type": "team", "target_id": 5}]},
}


def test_a_suggested_document_is_made_from_the_suggestion_and_written_in_full_at_the_standard_length(drafts):
    calls = []
    drafts.respond(script(calls))
    out = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=BODY)
    assert out.status_code == 200
    answer = out.json()
    assert answer["warnings"] == []
    session_id, message_id = answer["session"]["id"], answer["message"]["id"]
    finished(drafts, session_id, message_id)
    session = drafts.http.get(drafts.api(f"/sessions/{session_id}")).json()

    assert (session["title"], session["doc_type"], session["kind"]) == ("Access Control Policy", "policy", "new")
    ins = session["instructions"]
    assert ins["length"] == "standard" and ins["classification"] == "Confidential" and ins["review_cycle"] == "Every two years"
    assert ins["focus_areas"].startswith("Sets who may reach the bank's systems") and "Answer these requirements of the framework: A.5.15; A.5.16; A.8.2." in ins["focus_areas"]
    assert ins["details"] == {"owner_id": 1, "department_id": 7, "classification": "confidential", "review_cycle_months": 24, "effective_date": "2026-12-01",
                              "description": BODY["description"]}                                                            # Move to library starts with it
    assert ins["signoff"] == {"reviewers": [{"target_type": "user", "target_id": 2, "display": "Sara"}], "approvers": [{"target_type": "team", "target_id": 5}]}   # only who
    assert [r["kind"] for r in session["references"]] == ["framework"] and session["references"][0]["source_id"] == 1
    assert session["content"].startswith("# Access Control Policy") and "## 7. Policy Statements" in session["content"]          # a whole document, not a skeleton
    plan = calls[0]["task"]
    lo, hi = round(300 * setup.LENGTH_FACTOR["standard"]), round(650 * setup.LENGTH_FACTOR["standard"])
    assert f"words (target length, {lo} to {hi}" in plan                                                                      # the Standard length shapes the plan


def test_the_standard_length_is_about_four_to_eight_pages_and_the_others_keep_their_order():
    detail = {x["value"]: x["detail"] for x in setup.LENGTHS}
    assert detail["standard"] == "Complete, about 4 to 8 pages" and detail["short"].endswith("about 2 to 4 pages")
    assert setup.LENGTH_FACTOR["short"] < setup.LENGTH_FACTOR["standard"] < setup.LENGTH_FACTOR["comprehensive"] == 1.0


@pytest.mark.parametrize("doc_type", ["other", "framework", "plan"])
def test_only_a_type_that_can_be_written_in_full_is_started(drafts, doc_type):
    drafts.respond(script([]))
    out = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=dict(BODY, doc_type=doc_type))
    assert out.status_code == 400 and "policy, standard, procedure, guideline or charter" in out.json()["detail"]
    assert drafts.http.post(drafts.api("/sessions/from-suggestion"), json=dict(BODY, title="  ")).status_code == 400
    assert drafts.http.get(drafts.api("/sessions")).json()["items"] == []                                           # nothing was made


def test_a_framework_that_cannot_be_attached_is_said_but_the_document_is_still_made(drafts):
    calls = []
    drafts.respond(script(calls))
    out = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=dict(BODY, framework_ids=[1, 999]))
    assert out.status_code == 200 and len(out.json()["warnings"]) == 1
    finished(drafts, out.json()["session"]["id"], out.json()["message"]["id"])


def test_a_parent_document_is_read_as_context_and_a_missing_one_is_said_but_the_document_is_still_made(drafts):
    calls = []
    drafts.respond(script(calls))
    out = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=dict(BODY, doc_type="procedure", title="Access Review Procedure", parent_document_id=10))
    assert out.status_code == 200 and out.json()["warnings"] == []
    finished(drafts, out.json()["session"]["id"], out.json()["message"]["id"])
    refs = drafts.http.get(drafts.api(f"/sessions/{out.json()['session']['id']}")).json()["references"]
    assert [(r["kind"], r["source_id"]) for r in refs] == [("framework", 1), ("parent_document", 10)]                    # Information Security Policy
    gone = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=dict(BODY, title="Another Policy", parent_document_id=999))
    assert gone.status_code == 200 and len(gone.json()["warnings"]) == 1
    finished(drafts, gone.json()["session"]["id"], gone.json()["message"]["id"])


def test_without_comply_agent_nothing_is_made(drafts, monkeypatch):
    monkeypatch.setattr(claude_client, "configured", lambda: False)
    out = drafts.http.post(drafts.api("/sessions/from-suggestion"), json=BODY)
    assert out.status_code == 503
    assert drafts.http.get(drafts.api("/sessions")).json()["items"] == []
