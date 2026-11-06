"""Comply Agent asks before it writes when a request leaves a material choice open: questions answered by clicking one or several
options, or in words, and the answers continue the request (a whole new document too). The frameworks of the platform and the
documents of the library a request names are attached by themselves, and any standard or regulation may be applied from Comply
Agent's own knowledge. The AI is a mocked wire; the SDK, the guard, the engine, the service and the HTTP routes are the real ones."""
import json
import re
from types import SimpleNamespace

import pytest

import grc.models as m
from grc.modules.governance.studio import auto_refs, draft_prompts, engine, prompts

from _claude_mock import reply, searched
from test_studio_draft import PLAN, drafts, finished, new_policy, part   # noqa: F401  (drafts is a fixture)
from test_studio_flow import answer, change, user_turn, world             # noqa: F401  (world is a fixture)

GLBA = "GLBA Safeguards Rule (16 CFR Part 314)"
FFIEC = "FFIEC IT Examination Handbook, Information Security booklet"
ASK = [
    {"id": "q1", "question": "Which US banking rules should the policy follow?", "why": "Each one expects different controls and evidence.", "kind": "multiple",
     "options": [{"label": GLBA, "detail": "Applies to every financial institution that holds customer data.", "recommended": True},
                 {"label": FFIEC, "detail": "What examiners test banks against.", "recommended": True},
                 {"label": "23 NYCRR Part 500 (NYDFS)", "detail": "Only for institutions licensed in New York.", "recommended": False}], "other": True},
    {"id": "q2", "question": "Which edition of ISO/IEC 27001?", "why": "The control numbers differ between editions.", "kind": "single",
     "options": [{"label": "ISO/IEC 27001:2022", "detail": "The current edition.", "recommended": True},
                 {"label": "ISO/IEC 27001:2013", "detail": "Withdrawn in 2025.", "recommended": True}], "other": False},
    {"id": "q3", "question": "   ", "why": "", "kind": "text", "options": [], "other": True},
    {"id": "odd", "question": "Who approves the policy?", "why": "", "kind": "single", "options": [{"label": "The Board", "detail": "", "recommended": False}], "other": False},
]


# ── what names a framework or a document ─────────────────────────────────────
@pytest.mark.parametrize("text, name, expected", [
    ("i want this policy updated following usa banking security standards, iso 27001, and pci dss", "ISO/IEC 27001", True),
    ("i want this policy updated following usa banking security standards, iso 27001, and pci dss", "PCI DSS", True),
    ("align with ISO/IEC 27001:2022 Annex A", "ISO/IEC 27001", True),
    ("map it to ISO27001", "ISO/IEC 27001", True),
    ("map it to iso 27002", "ISO/IEC 27001", False),
    ("PCI-DSS requirement 8", "PCI DSS", True),
    ("PCIDSS v4", "PCI DSS", True),
    ("as pci dss says", "Payment Card Industry Data Security Standard", True),
    ("follow the NCA ECC", "NCA Essential Cybersecurity Controls", True),
    ("follow the NCA ECC", "NCA ECC-1:2018", True),
    ("we use ECC keys for TLS", "NCA Essential Cybersecurity Controls", False),
    ("we use ECC keys for TLS", "NCA ECC-1:2018", False),
    ("SOC 2 type II report", "SOC 2", True),
    ("SOC 1 report", "SOC 2", False),
    ("keep logs for 2 years and run SOC reviews", "SOC 2", False),
    ("NIST SP 800-53 controls", "NIST SP 800-53 Rev. 5", True),
    ("NIST SP 800-63 identity", "NIST SP 800-53 Rev. 5", False),
    ("follow NIST guidance", "NIST Cybersecurity Framework", False),
    ("align with the NIST CSF", "NIST Cybersecurity Framework", True),
    ("GDPR article 32", "General Data Protection Regulation (GDPR)", True),
    ("the PDPL applies", "Personal Data Protection Law", True),
    ("SAMA CSF domain 3", "SAMA Cyber Security Framework", True),
    ("SAMA rules on outsourcing", "SAMA Cyber Security Framework", False),
    ("ISO 22301 continuity", "ISO 22301:2019", True),
    ("write a business continuity plan", "ISO 22301:2019", False),
    ("cover HIPAA", "Health Insurance Portability and Accountability Act", True),
    ("OWASP ASVS level 2", "OWASP ASVS 4.0.3", True),
])
def test_a_framework_is_named_by_its_name_number_acronyms_or_initials_and_never_by_its_issuer_alone(text, name, expected):
    assert auto_refs.named(text, name) is expected


def test_the_newest_version_is_taken_unless_the_request_names_one():
    old, new = SimpleNamespace(id=1, name="PCI DSS", version="3.2.1"), SimpleNamespace(id=2, name="PCI DSS", version="4.0.1")
    assert [f.id for f in auto_refs.frameworks_named("follow PCI DSS", [old, new])] == [2]
    assert [f.id for f in auto_refs.frameworks_named("follow PCI DSS 3.2.1", [old, new])] == [1]


def test_a_document_is_named_by_its_title_or_its_code():
    docs = [SimpleNamespace(id=1, title="Access Control Policy", document_code="POL-007"), SimpleNamespace(id=2, title="Access Control", document_code=""),
            SimpleNamespace(id=3, title="Information Security Policy", document_code=""), SimpleNamespace(id=4, title="Policy", document_code="")]
    assert [d.id for d in auto_refs.documents_named("align it with our access control policy", docs)] == [1]       # the longer title wins
    assert [d.id for d in auto_refs.documents_named("see POL-007", docs)] == [1]
    assert [d.id for d in auto_refs.documents_named("keep it consistent with the information security policy", docs)] == [3]
    assert auto_refs.documents_named("write a short policy", docs) == []
    assert auto_refs.documents_named("align with the access control policy", docs, exclude=[1]) == [docs[1]]


# ── attaching what a request names ───────────────────────────────────────────
def test_a_request_attaches_the_platform_frameworks_and_library_documents_it_names_once_and_says_so(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")], "Done.")))
    asked = "Update this policy to follow ISO 27001 and PCI DSS, and keep it consistent with the Access Control Standard."
    msg = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": asked}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{msg['id']}")).json()
    refs = world.http.get(world.api(f"/sessions/{s['id']}")).json()["references"]
    assert [(r["key"], r["kind"], r["title"]) for r in refs] == [("R1", "framework", "ISO/IEC 27001 2022"), ("R2", "document", "Access Control Standard")]
    assert done["notes"][0] == ("Attached from the platform because your request names them: ISO/IEC 27001 2022 (R1), Access Control Standard (R2). "
                                "Remove any you do not want in References.")
    sent = json.dumps(world.wire.requests[-1].body)                       # the references travel in their own block of the request
    assert 'reference id=\\"R1\\"' in sent and "A.8.2" in sent and "Accounts shall be reviewed quarterly." in sent

    again = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Now tighten the ISO 27001 wording."}).json()
    later = world.http.get(world.api(f"/sessions/{s['id']}/messages/{again['id']}")).json()
    assert len(world.http.get(world.api(f"/sessions/{s['id']}")).json()["references"]) == 2 and not any("Attached" in n for n in later["notes"])


# ── asking and answering ─────────────────────────────────────────────────────
def test_questions_are_kept_tidy_one_recommendation_for_a_single_choice_and_a_lone_option_becomes_words():
    qs = engine.questions_of(ASK)
    assert [(q["id"], q["kind"], len(q["options"])) for q in qs] == [("q1", "multiple", 3), ("q2", "single", 2), ("q3", "text", 0)]
    assert [o["recommended"] for o in qs[1]["options"]] == [True, False] and qs[0]["other"] is True and qs[2]["other"] is True
    assert engine.questions_of(["Which systems hold card data?"]) == [{"id": "q1", "question": "Which systems hold card data?", "why": "", "kind": "text",
                                                                       "options": [], "other": True}]
    assert "You asked:\n- Which US banking rules should the policy follow? (options: " + GLBA in engine.asked_text(ASK)


def test_an_open_request_is_answered_with_questions_and_the_answers_continue_it(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([], "Before I change it: which rules apply?", questions=ASK)))
    first = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Update this policy following US banking security standards."}).json()
    asked = world.http.get(world.api(f"/sessions/{s['id']}/messages/{first['id']}")).json()
    assert [q["question"] for q in asked["questions"]] == ["Which US banking rules should the policy follow?", "Which edition of ISO/IEC 27001?", "Who approves the policy?"]
    assert asked["proposal"]["ops"] == [] and world.http.get(world.api(f"/sessions/{s['id']}")).json()["revision"] == 1      # nothing written yet

    world.respond(lambda body: reply(answer([change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")], "Done, following GLBA and FFIEC.")))
    sent = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": [
        {"id": "q1", "chosen": [GLBA, "Something that was not offered"]}, {"id": "q2", "chosen": ["ISO/IEC 27001:2022", "ISO/IEC 27001:2013"]}]})
    assert sent.status_code == 200, sent.text
    msgs = world.http.get(world.api(f"/sessions/{s['id']}/messages")).json()["items"]
    person = [x for x in msgs if x["role"] == "user"][-1]
    assert person["content"] == ("My answers:\n- Which US banking rules should the policy follow? " + GLBA + "\n- Which edition of ISO/IEC 27001? ISO/IEC 27001:2022"
                                 "\nFor the other questions, you decide.\nPlease continue with my request.")
    assert person["answers"]["reply_to"] == first["id"] and person["answers"]["decide"] == ["q3"]
    assert [a["chosen"] for a in person["answers"]["items"]] == [[GLBA], ["ISO/IEC 27001:2022"]]       # an option not offered is dropped; one for a single choice
    marked = next(x for x in msgs if x["id"] == first["id"])
    assert [q["answer"].get("chosen") or q["answer"].get("decide") for q in marked["questions"]] == [[GLBA], ["ISO/IEC 27001:2022"], True]
    prompt = json.dumps(user_turn(world))
    assert "Update this policy following US banking security standards." in prompt and "You asked:" in prompt and "My answers:" in prompt and GLBA in prompt


def asks(*args, **kw):
    return json.dumps(dict(json.loads(answer(*args, **kw)), ask_first=True))


def test_first_understand_then_work_nothing_changes_while_comply_agent_asks_and_answers_are_always_worked_on(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    edit = change("replace", "B7", markdown="Access to systems shall be reviewed every quarter.")
    used = [{"ref": "", "locator": "16 CFR 314.4", "quote": "", "how": "access reviews", "basis": "general_knowledge"}]
    world.respond(lambda body: reply(asks([edit], "You want the policy aligned with US banking rules. Once you pick them, I will add them.", used=used, questions=ASK[:2])))
    first = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Update this policy following US banking security standards."}).json()
    asked = world.http.get(world.api(f"/sessions/{s['id']}/messages/{first['id']}")).json()
    assert asked["proposal"]["ask_first"] == "chat" and asked["proposal"]["ops"] == [] and asked["references_used"] == []     # step 1: it only asks
    assert asked["content"].startswith("You want the policy aligned") and [q["id"] for q in asked["questions"]] == ["q1", "q2"]
    assert world.http.get(world.api(f"/sessions/{s['id']}")).json()["revision"] == 1

    world.respond(lambda body: reply(asks([edit], "Done, following GLBA.", used=used, questions=ASK[:1])))      # it wants to ask again: no
    second = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": [{"id": "q1", "chosen": [GLBA]}]}).json()
    done = world.http.get(world.api(f"/sessions/{s['id']}/messages/{second['id']}")).json()
    assert [o["kind"] for o in done["proposal"]["ops"]] == ["replace"] and "ask_first" not in done["proposal"] and len(done["references_used"]) == 1


def test_answers_must_answer_questions_that_were_asked(world):
    s = world.http.post(world.api("/sessions"), json={"kind": "library", "document_id": 10}).json()
    world.respond(lambda body: reply(answer([], "Which rules?", questions=ASK[:2])))
    first = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"text": "Update it for US banking."}).json()
    assert world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": []}).status_code == 400
    assert world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": 999, "answers": [{"id": "q1", "chosen": [GLBA]}]}).status_code == 400
    world.respond(lambda body: reply(answer([], "Decided.")))
    ok = world.http.post(world.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "decide": True, "text": "Keep it short."})
    assert ok.status_code == 200
    person = [x for x in world.http.get(world.api(f"/sessions/{s['id']}/messages")).json()["items"] if x["role"] == "user"][-1]
    assert person["content"] == "Decide for me, as you recommend.\nPlease continue with my request.\nKeep it short." and person["answers"]["decide"] == ["q1", "q2"]


def test_the_prompts_let_comply_agent_apply_any_standard_and_ask_before_writing():
    assert "STANDARDS AND REGULATIONS" in prompts.SYSTEM and "any law, regulation, supervisory guidance, standard or framework of any country" in prompts.SYSTEM
    assert "never quote or number a standard you were not given" not in prompts.SYSTEM and "Do not stop to ask before writing" not in prompts.SYSTEM
    assert "ASKING THE PERSON" in prompts.SYSTEM and "Never ask the same thing twice" in prompts.SYSTEM
    assert "of any country or body" in draft_prompts.SYSTEM and "never a placeholder for a law, standard, edition or version you can name" in draft_prompts.SYSTEM
    assert prompts.TURN_SCHEMA["properties"]["questions"]["items"] is prompts.QUESTION_SCHEMA
    assert list(prompts.TURN_SCHEMA["properties"])[0] == "ask_first" and "ask_first" in prompts.TURN_SCHEMA["required"]   # decided before it writes
    assert "first understand the request, then do the work" in prompts.SYSTEM and "change nothing yet" in prompts.SYSTEM
    assert draft_prompts.PLAN_SCHEMA["properties"]["questions"]["items"] is prompts.QUESTION_SCHEMA and "ask_first" in draft_prompts.PLAN_SCHEMA["required"]


# ── a whole new document ─────────────────────────────────────────────────────
def test_a_new_document_asks_first_when_its_rules_are_open_and_is_written_with_the_answers(drafts):
    calls = []
    plans = iter([dict(PLAN, ask_first=True, questions=ASK[:1])])

    def respond(body):
        if body.get("tools"):                   # the web research before the questions
            calls.append({"task": "research", "body": body})
            return searched("**Binding**\n- " + GLBA, searches=["US bank access control rules"], pages=[("https://www.ftc.gov/glba", GLBA)])
        task = body["messages"][0]["content"][-1]["text"]
        calls.append({"task": task, "body": body})
        if 'kind="scope"' in task:
            return reply(json.dumps({"understood": "An access control policy for a US bank.", "questions": ASK[:2]}))
        if 'kind="plan"' in task:
            return reply(json.dumps(next(plans)))
        kind, number, heading = re.search(r'<task kind="(section|area)" number="([^"]+)" heading="([^"]+)"', task).groups()
        org = (re.findall(r"<ORG_\d+>", json.dumps(body)) or ["<ORG_1>"])[0]
        return reply(json.dumps(part(kind, number, heading, org)))

    drafts.respond(respond)
    s = new_policy(drafts)
    request = "Write the complete access control policy following US banking security standards."
    first = drafts.http.post(drafts.api(f"/sessions/{s['id']}/messages"), json={"text": request}).json()
    asked = finished(drafts, s["id"], first["id"])
    assert asked["proposal"]["ask_first"] == "draft" and [q["id"] for q in asked["questions"]] == ["q1", "q2"] and len(calls) == 2
    assert asked["content"].startswith("An access control policy for a US bank.\n\nBefore I write the policy")
    assert drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 1

    second = drafts.http.post(drafts.api(f"/sessions/{s['id']}/messages"), json={"reply_to": first["id"], "answers": [
        {"id": "q1", "chosen": [GLBA, FFIEC]}, {"id": "q2", "chosen": ["ISO/IEC 27001:2022"]}]}).json()
    done = finished(drafts, s["id"], second["id"])
    replan = calls[2]
    assert 'kind="plan"' in replan["task"] and "The person has already answered your questions" in replan["task"]
    shared = json.dumps(replan["body"])
    assert request in shared and GLBA in shared and "ISO/IEC 27001:2022" in shared            # the request, then the answers, in the brief
    assert "I wrote the complete policy" in done["content"] and drafts.http.get(drafts.api(f"/sessions/{s['id']}")).json()["revision"] == 2
    assert not done["proposal"].get("ask_first")                                            # it asked once; the second plan's wish to ask is ignored
