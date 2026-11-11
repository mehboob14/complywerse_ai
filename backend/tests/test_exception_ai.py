"""AI assist at every step of an exception (DECISIONS D62): the owner (draft, period, assets), the reviewer and approver (potential risks and a
summary), the implementer (compensating controls). Over HTTP through the whole governance router with a stand-in for the shared AI client
(``_exc_world``); nothing here reaches a model.

* each is a draft: nothing is saved by the call; who may ask is who the thing is for (raise/edit, the person asked at the open step, the implementer);
* what is sent: the exception's words and the assets' declared columns only (never an address, an owner or a description); the document's text
  only when the person may open it;
* what comes back is checked: ids must be ones the prompt held, levels 1 to 5, an answer that is empty, cut off or not what was asked is an
  error in plain words (never a draft, never the provider's own text); without AI configured it says so; the guard's refusal passes through.
"""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from _exc_world import (ADMIN, APP1, EX, EXCADMIN, IMPL1, IMPL2, PLAIN, REQ, _schema, implementing, make_rule, raise_exception, record,  # noqa: F401
                        submit, w)

import grc.models as m  # noqa: E402
from grc.modules.governance import exception_ai as AI  # noqa: E402
from grc.modules.governance import exception_controls as C  # noqa: E402
from grc.modules.governance import exception_risks as K  # noqa: E402
from grc.services import openai_client as client  # noqa: E402
from grc.services.ai_gateway.errors import AIBlocked  # noqa: E402


class Fake:
    """A stand-in for the shared client: answers in order (the last repeats) and keeps the prompts it was given."""

    def __init__(self, *answers):
        self.answers, self.prompts = list(answers), []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def create(self, **kw):
        self.prompts.append(kw["messages"][-1]["content"])
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        content, finish = answer if isinstance(answer, tuple) else (answer, "stop")
        return SimpleNamespace(choices=[SimpleNamespace(finish_reason=finish, message=SimpleNamespace(content=content))])


@pytest.fixture
def ai(monkeypatch):
    def install(*answers):
        fake = Fake(*answers)
        monkeypatch.setattr(client, "check_ai_available", lambda: True)
        monkeypatch.setattr(client, "get_openai_client", lambda: fake)
        return fake

    return install


def dress_asset(w):
    """Asset 1 with the columns a prompt must never carry."""
    a = w.db.get(m.ITAsset, 1)
    a.description, a.ip_address, a.host_name, a.owner_name = "SECRET-DESC", "10.9.8.7", "core-db-01.acme.local", "Dana Owner"
    w.db.commit()


def none_of_it(prompt):
    return all(s not in prompt for s in ("SECRET-DESC", "10.9.8.7", "core-db-01", "Dana Owner"))


def pending(w, **kw):
    """An exception waiting for APP1's approval under a one-step rule (made here unless one exists): its id."""
    if not w.db.query(m.ExceptionApprovalRule).count():
        make_rule(w)
    eid = raise_exception(w, **kw)["id"]
    assert submit(w, eid).status_code == 200
    return eid


# ── not configured, and who may ask ──────────────────────────────────────────
def test_without_ai_configured_each_helper_says_so_in_words(w, monkeypatch):
    monkeypatch.setattr(client, "check_ai_available", lambda: False)
    approved_id, _ = implementing(w)
    waiting_id = raise_exception(w)["id"]
    assert submit(w, waiting_id).status_code == 200
    calls = [(REQ, f"{EX}/ai/draft", {"title": "t"}), (REQ, f"{EX}/ai/schedule", {"title": "t"}), (REQ, f"{EX}/ai/assets", {"title": "t"}),
             (APP1, f"{EX}/{waiting_id}/ai/risks", None), (IMPL1, f"{EX}/{approved_id}/ai/controls", None)]
    for who, url, body in calls:
        r = w.as_(who).post(url, json=body) if body else w.as_(who).post(url)
        assert r.status_code == 503 and r.json()["detail"] == AI.UNAVAILABLE, url
    assert "gpt" not in AI.UNAVAILABLE.lower() and AI.UNAVAILABLE.startswith("AI ")


def test_each_helper_is_for_the_person_the_thing_is_for(w, ai):
    fake = ai("{}")
    for url in (f"{EX}/ai/draft", f"{EX}/ai/schedule", f"{EX}/ai/assets"):
        r = w.as_(PLAIN).post(url, json={"title": "Skip backups"})
        assert r.status_code == 403 and r.json()["detail"] == "Only someone allowed to request or edit policy exceptions can ask AI to help with one.", url
    assert w.as_(REQ).post(f"{EX}/ai/draft", json={"title": "  "}).status_code == 400
    approved_id, _ = implementing(w)
    waiting_id = pending(w)
    for who in (REQ, PLAIN, ADMIN, IMPL1):
        r = w.as_(who).post(f"{EX}/{waiting_id}/ai/risks")
        assert r.status_code == 403 and r.json()["detail"] == K.NOT_YOUR_STEP, who
    for who in (REQ, PLAIN, ADMIN, IMPL2, APP1):
        r = w.as_(who).post(f"{EX}/{approved_id}/ai/controls")
        assert r.status_code == 403 and r.json()["detail"] == C.NOT_YOURS, who
    assert fake.prompts == []                                                                        # nothing was asked of the model


def test_a_document_the_person_may_not_open_is_refused_before_anything_is_sent(w, ai):
    fake = ai("{}")
    r = w.as_(EXCADMIN).post(f"{EX}/ai/draft", json={"title": "Skip backups", "document_id": 1})     # may edit exceptions, may not open the document
    assert r.status_code == 403
    assert fake.prompts == []


# ── the owner ────────────────────────────────────────────────────────────────
def test_the_owner_helpers_draft_a_period_and_assets_and_save_nothing(w, ai):
    w.db.get(m.GovernanceDocument, 1).content = "Backups must be tested monthly."
    dress_asset(w)
    fake = ai(json.dumps({"justification": "  The legacy box   cannot run the agent.  ", "business_impact": "Refusing it stops the migration."}),
              json.dumps({"priority": "High", "duration_days": 90, "rationale": "Short, to finish the migration."}),
              json.dumps({"assets": [{"id": 1, "reason": "Runs the backups"}, {"id": 99, "reason": "invented"}, {"id": 1, "reason": "again"}, {"id": "x"}]}))
    r = w.as_(REQ).post(f"{EX}/ai/draft", json={"title": "Skip backups", "document_id": 1})
    assert r.status_code == 200
    assert r.json() == {"justification": "The legacy box cannot run the agent.", "business_impact": "Refusing it stops the migration.", "source": "ai"}
    assert "Document title: Doc 1" in fake.prompts[0] and "Backups must be tested monthly." in fake.prompts[0]
    today = datetime.utcnow().date()
    r = w.as_(REQ).post(f"{EX}/ai/schedule", json={"title": "Skip backups", "justification": "Legacy box", "document_id": 1, "priority": "medium"})
    assert r.status_code == 200
    assert r.json() == {"priority": "high", "effective_date": today.isoformat(), "expiry_date": (today + timedelta(days=90)).isoformat(),
                        "rationale": "Short, to finish the migration."}
    r = w.as_(REQ).post(f"{EX}/ai/assets", json={"title": "Skip backups", "justification": "Legacy box", "document_id": 1})
    assert r.status_code == 200
    assert r.json() == {"assets": [{"id": 1, "name": "Core banking", "asset_type": "application", "criticality": "critical", "reason": "Runs the backups"}]}
    assert none_of_it(fake.prompts[2]) and "Core banking" in fake.prompts[2]
    assert w.db.query(m.PolicyException).count() == 0 and w.db.query(m.ExceptionAssetLink).count() == 0


# ── a reviewer or an approver ────────────────────────────────────────────────
def test_the_reviewer_helper_suggests_risks_and_a_summary_to_the_person_asked_only_and_saves_nothing(w, ai):
    dress_asset(w)
    eid = pending(w, linked_asset_ids=[1], business_impact="Audit finding")
    record(w, eid, APP1, title="Existing risk")
    many = [{"title": f"Risk {i}", "description": "d", "likelihood": 3, "impact": 3} for i in range(8)]
    fake = ai(json.dumps({"summary": "  Backups are skipped on a legacy box. ", "risks": [
        {"title": "Data loss", "description": " Nightly   copies stop. ", "likelihood": 4, "impact": 5},
        {"title": "Out of range", "likelihood": 9, "impact": 2}, {"title": "", "likelihood": 2, "impact": 2},
        {"title": "No levels"}, *many]}))
    before = w.db.query(m.ExceptionRisk).count()
    r = w.as_(APP1).post(f"{EX}/{eid}/ai/risks")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["summary"] == "Backups are skipped on a legacy box."
    assert body["risks"][0] == {"title": "Data loss", "description": "Nightly copies stop.", "likelihood": 4, "impact": 5}
    assert [x["title"] for x in body["risks"]] == ["Data loss"] + [f"Risk {i}" for i in range(5)]       # the invalid ones are dropped, at most six
    prompt = fake.prompts[0]
    assert "Exception title: Skip backups" in prompt and "Justification: Legacy box" in prompt and "Business impact: Audit finding" in prompt
    assert "Core banking" in prompt and none_of_it(prompt) and '["Existing risk"]' in prompt
    assert "Document excerpt" not in prompt                                                          # APP1 may not open the document: no text from it
    assert w.db.query(m.ExceptionRisk).count() == before                                             # a draft: saved only when the person saves it


def test_the_reviewer_helper_carries_the_document_when_the_person_asked_may_open_it(w, ai):
    w.db.get(m.GovernanceDocument, 1).content = "Backups must be tested monthly."
    w.db.commit()
    make_rule(w, steps=[{"kind": "approval", "people": [{"type": "user", "id": REQ}]}])               # the document's owner is the one asked
    eid = raise_exception(w, as_user=ADMIN)["id"]
    assert submit(w, eid, as_user=ADMIN).status_code == 200
    fake = ai(json.dumps({"summary": "A summary", "risks": [{"title": "Data loss", "likelihood": 3, "impact": 3}]}))
    assert w.as_(REQ).post(f"{EX}/{eid}/ai/risks").status_code == 200
    assert "Document title: Doc 1" in fake.prompts[0] and "Document excerpt: Backups must be tested monthly." in fake.prompts[0]


# ── the implementer ──────────────────────────────────────────────────────────
def test_the_implementer_helper_suggests_controls_for_the_recorded_risks_and_the_exceptions_assets_only(w, ai):
    dress_asset(w)
    eid, risk = implementing(w, linked_asset_ids=[1])
    fake = ai(json.dumps({"controls": [
        {"title": "Restore test every week", "description": " Restore to a   scratch host. ", "risk_ids": [risk["id"], 777], "asset_ids": [1, 2]},
        {"title": "", "risk_ids": [risk["id"]]}, {"title": "Alert on a failed job", "risk_ids": "all", "asset_ids": None}]}))
    r = w.as_(IMPL1).post(f"{EX}/{eid}/ai/controls")
    assert r.status_code == 200, r.text
    assert r.json() == {"controls": [
        {"title": "Restore test every week", "description": "Restore to a scratch host.", "risk_ids": [risk["id"]], "asset_ids": [1]},
        {"title": "Alert on a failed job", "description": "", "risk_ids": [], "asset_ids": []}]}
    prompt = fake.prompts[0]
    assert "Backups could fail unnoticed" in prompt and "Core banking" in prompt and none_of_it(prompt)
    assert w.db.query(m.ExceptionControl).count() == 0


def test_the_implementer_helper_has_nothing_to_cover_when_no_risk_was_recorded(w, ai):
    fake = ai("{}")
    make_rule(w)
    eid = raise_exception(w, implementer={"people": [{"type": "user", "id": IMPL1}]})["id"]
    assert submit(w, eid).status_code == 200
    assert w.as_(APP1).post(f"{EX}/{eid}/risks", json={"none_identified": True}).status_code == 201
    assert w.as_(APP1).post(f"{EX}/{eid}/approve", json={}).status_code == 200
    r = w.as_(IMPL1).post(f"{EX}/{eid}/ai/controls")
    assert r.status_code == 409 and r.json()["detail"] == "No potential risks were recorded, so there is nothing to cover yet."
    assert fake.prompts == []


# ── what comes back is checked ───────────────────────────────────────────────
@pytest.mark.parametrize("answer", [("{}", "length"), "", "not json at all", json.dumps(["a", "b"]), json.dumps({"unrelated": 1}),
                                    "```json\n{\"justification\": \"only half\"}\n```"])
def test_an_answer_that_is_empty_cut_off_or_not_what_was_asked_is_an_error_never_a_draft(w, ai, answer):
    ai(answer)
    r = w.as_(REQ).post(f"{EX}/ai/draft", json={"title": "Skip backups"})
    assert r.status_code == 502 and r.json()["detail"] == AI.UNUSABLE


@pytest.mark.parametrize("answer", [{"priority": "urgent", "duration_days": 30, "rationale": "x"}, {"priority": "low", "duration_days": 3, "rationale": "x"},
                                    {"priority": "low", "duration_days": 400, "rationale": "x"}, {"priority": "low", "duration_days": "soon", "rationale": "x"},
                                    {"priority": "low", "duration_days": 30, "rationale": ""}])
def test_a_period_outside_what_was_asked_is_refused(w, ai, answer):
    ai(json.dumps(answer))
    r = w.as_(REQ).post(f"{EX}/ai/schedule", json={"title": "Skip backups"})
    assert r.status_code == 502 and r.json()["detail"] == AI.UNUSABLE


def test_risks_and_controls_with_nothing_usable_in_them_are_errors(w, ai):
    other, _ = implementing(w)
    eid = pending(w)
    ai(json.dumps({"summary": "A summary", "risks": [{"title": "x", "likelihood": 0, "impact": 9}]}))
    assert w.as_(APP1).post(f"{EX}/{eid}/ai/risks").json()["detail"] == AI.UNUSABLE
    ai(json.dumps({"summary": "", "risks": [{"title": "Data loss", "likelihood": 3, "impact": 3}]}))
    assert w.as_(APP1).post(f"{EX}/{eid}/ai/risks").status_code == 502
    ai(json.dumps({"controls": [{"title": ""}, {"description": "no title"}]}))
    assert w.as_(IMPL1).post(f"{EX}/{other}/ai/controls").status_code == 502


def test_a_failed_call_is_said_in_words_and_never_in_the_providers(w, ai):
    ai(RuntimeError("provider says: key sk-live-123 over quota for model gpt-x"))
    r = w.as_(REQ).post(f"{EX}/ai/draft", json={"title": "Skip backups"})
    assert r.status_code == 502 and r.json()["detail"] == AI.FAILED
    assert "sk-live" not in r.text and "gpt" not in r.text


def test_the_guards_refusal_is_not_swallowed(w, ai):
    ai(AIBlocked("restricted_data", "That cannot be sent to AI."))
    with pytest.raises(AIBlocked) as refused:
        w.as_(REQ).post(f"{EX}/ai/draft", json={"title": "Skip backups"})
    assert refused.value.code == "restricted_data"
