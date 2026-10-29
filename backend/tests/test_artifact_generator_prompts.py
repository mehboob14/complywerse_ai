"""The prompts of the artifact content generator (scripts/generate_artifact_content.py), as scripts/generate_grounded_artifact_content.py
sends them for the UAE IA catalogue: each artifact's own description, the evidence it provides and the text of its control.

Nothing is called. The generator's own dry-run client records the messages `generate_one` would send and stops, the AI client is replaced
by one that fails the test if it is asked for, and backend/.env is not loaded. A collection guide is written for an organization from
its own systems, so its prompt keeps the standard's numbering out of the text (the control is only an "internal scope hint"), asks for
frequencies, retention periods and sample sizes as bracketed suggestions, names no product and covers own data centers as well as cloud;
a document leaves retention periods and review frequencies to the entity.
"""
import importlib
import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
SEED = ROOT / "grc" / "seed_data"
KEY = "uae_ia"
FIRST_TEMPLATE = 257                       # UAEIA-257 on are the round-5 templates of records and outputs
HINT = re.compile(r"\(internal scope hint, do NOT print it or any control, clause or annex number: ([^)]*)\)")
# the standard's numbering as it is printed (M1.2.1; T.3.2.3 and M.3.4.1 misprinted; M2.3; E1-2.1.1; F1-5.7) and a clause or annex reference
NUMBER = re.compile(r"\b[MTEF]\.?\d+(?:[.-]\d+)+\b|\bClauses? \d|\bAnnex [A-G]\b")
GUIDE_RULES = (
    "never print any control, clause or annex number",
    "never say what the framework or an auditor expects or will accept",
    "as a [bracketed] suggestion for the organisation to set, never as a fixed number or a requirement of the framework",
    "name kinds of systems, not products or vendors",
    "cover on-premises and own data center systems as well as cloud",
)
DOCUMENT_RULE = ("6. Use [bracketed placeholders] only for genuinely org-specific values "
                 "(names, dates, systems, retention periods, review frequencies).")


@pytest.fixture(scope="module")
def grounded():
    """scripts/generate_grounded_artifact_content.py imported the way it runs (scripts/ first on the path), without the .env both scripts load."""
    names = ("generate_artifact_content", "generate_grounded_artifact_content")
    with pytest.MonkeyPatch.context() as mp:
        mp.setitem(sys.modules, "dotenv", None)               # `from dotenv import load_dotenv` fails and the scripts carry on without it
        mp.syspath_prepend(str(SCRIPTS))
        for name in names:
            mp.delitem(sys.modules, name, raising=False)
        module = importlib.import_module("generate_grounded_artifact_content")
    yield module
    for name in names:
        sys.modules.pop(name, None)


@pytest.fixture(scope="module")
def entry():
    return json.loads((SEED / "artifact_catalog.json").read_text(encoding="utf-8"))[KEY]


@pytest.fixture(scope="module")
def controls(grounded):
    return grounded._framework_controls(KEY)


@pytest.fixture(scope="module")
def prompts(grounded, entry, controls):
    """artifact id -> {mode, system, user}: what `generate_one` would send for it, built with the generator's dry-run client."""
    out = {}
    for artifact in entry["artifacts"]:
        client = grounded._DryClient()
        try:
            grounded.gen.generate_one(client, entry["name"], grounded._grounded(artifact, controls), "dry-run-model")
        except grounded._Stop:
            pass
        system, user = client.messages
        out[artifact["artifact_id"]] = {"mode": grounded.gen._content_mode(artifact["format"], artifact["type"]),
                                        "system": system["content"], "user": user["content"]}
    return out


def _of_mode(entry, prompts, mode):
    return [a for a in entry["artifacts"] if prompts[a["artifact_id"]]["mode"] == mode]


def test_a_guide_prompt_names_the_control_only_as_an_internal_scope_hint(entry, prompts):
    guides = _of_mode(entry, prompts, "guide")
    assert len(guides) == 88 and all(int(a["artifact_id"].split("-")[1]) >= FIRST_TEMPLATE for a in guides)
    for a in guides:
        user = prompts[a["artifact_id"]]["user"]
        assert HINT.findall(user) == [a["control_ref"]], a["artifact_id"]               # once, and it is this artifact's control
        left = NUMBER.search(HINT.sub("", user))
        assert left is None, (a["artifact_id"], left and left.group(0))                 # no control, clause or annex number anywhere else
        assert "(control " not in user and "tie explicitly to the control" not in user, a["artifact_id"]


def test_a_guide_prompt_asks_for_suggestions_not_requirements_or_promises(entry, prompts):
    for a in _of_mode(entry, prompts, "guide"):
        user = prompts[a["artifact_id"]]["user"]
        for rule in GUIDE_RULES:
            assert rule in user, (a["artifact_id"], rule)
        assert "Acceptance Criteria (what a reviewer should check before signing off; a suggestion, not a promise of audit acceptance)" in user
        assert "What This Evidences (say in plain words what the evidence shows about the safeguard, never cite a control" in user
        assert "what an auditor accepts as sufficient" not in user and "Intent: Collection guide for" in user, a["artifact_id"]


def test_a_document_prompt_leaves_retention_periods_and_review_frequencies_to_the_entity(entry, prompts):
    documents = _of_mode(entry, prompts, "markdown")
    assert len(documents) > 150
    for a in documents:
        assert DOCUMENT_RULE in prompts[a["artifact_id"]]["user"], a["artifact_id"]


def test_the_hardening_is_in_the_shared_guide_prompt_so_every_framework_gets_it(grounded):
    user = grounded.gen._prompt_guide("ISO/IEC 27001:2022", "Stage 1 Audit Evidence Pack", "Evidence", "A.5.1", "Documentation review pack.", "ZIP/Drive")
    assert HINT.findall(user) == ["A.5.1"] and "A.5.1" not in HINT.sub("", user)
    assert all(rule in user for rule in GUIDE_RULES)
    assert DOCUMENT_RULE in grounded.gen._prompt("ISO/IEC 27001:2022", "Plan", "Plan", "A.5.1", "A plan.", ["Purpose"])


def test_the_standards_misprinted_and_partial_references_are_stripped_from_the_grounded_text(grounded, controls):
    # the malware control prints "(refer to T.3.2.3)" and "(refer to M.3.4.1)"; the risk treatment control prints "(see also M2.3)"
    for cid, printed in (("T3.1.6", ("T.3.2.3", "M.3.4.1")), ("M2.3.1", ("M2.3)",))):
        text = controls[cid]["full_text"]
        assert all(p in text for p in printed), cid
        assert NUMBER.search(text) and not NUMBER.search(grounded._no_ids(text)), cid
    # text that only looks like a reference is left alone
    assert grounded._no_ids("TLS 1.2 on Table 2.1 and M2M links, v1.2.3") == "TLS 1.2 on Table 2.1 and M2M links, v1.2.3"


def test_no_control_number_reaches_a_prompt_through_the_standards_text_or_the_evidence_descriptions(grounded, entry, controls):
    for a in entry["artifacts"]:
        art = grounded._grounded(a, controls)
        text = "\n".join([art["requirement"]] + [f"{e['name']} {e['description']}" for e in art["evidence_items"]])
        found = NUMBER.search(text)
        assert found is None, (a["artifact_id"], found and found.group(0))


def test_the_grounded_generators_dry_run_prints_the_hardened_prompts_and_calls_nothing(grounded, monkeypatch, capsys):
    def refuse(*args, **kwargs):
        raise AssertionError("a dry run must not reach the AI client")

    monkeypatch.setattr(grounded.gen, "_client", refuse)
    monkeypatch.setattr(grounded.gen, "_ai_available", refuse)
    monkeypatch.setattr(sys, "argv", ["generate_grounded_artifact_content.py", "--framework", KEY, "--ids", "UAEIA-257,UAEIA-290,UAEIA-404",
                                      "--force", "--dry-run"])
    grounded.main()
    sections = re.split(r"\n===== ", capsys.readouterr().out)[1:]
    assert [s.split(" ", 1)[0] for s in sections] == ["UAEIA-257", "UAEIA-290", "UAEIA-404"]
    assert "(Form/Template, DOCX)" in sections[0] and DOCUMENT_RULE in sections[0]
    for section, control in ((sections[1], "M4.2.1"), (sections[2], "T8.1.2")):
        user = section.split("--- user ---\n", 1)[1]                    # the system prompt quotes "Clause 5.1" and "A.5.9" to forbid them
        assert "(Evidence, " in section.split("\n", 1)[0]
        assert HINT.findall(user) == [control] and NUMBER.search(HINT.sub("", user)) is None
        assert all(rule in user for rule in GUIDE_RULES)


def test_a_template_is_told_the_sub_controls_it_serves_not_the_whole_control(grounded, entry, controls):
    """UAEIA-441 serves two of the sixteen data requirements of its control and UAEIA-409 all five of its clauses: the prompt of each carries
    exactly the sub-controls of the artifact, so the five contract schedules of one control no longer all get the whole clause list."""
    for artifact_id, whole in (("UAEIA-441", False), ("UAEIA-409", True)):
        art = next(a for a in entry["artifacts"] if a["artifact_id"] == artifact_id)
        nodes = controls[art["control_ref"]]["native_attributes"]["sub_controls"]
        assert (len(art["sub_controls"]) == len(nodes)) == whole, artifact_id
        requirement = grounded._grounded(art, controls)["requirement"]
        for node in nodes:
            assert (grounded._no_ids(node["text"]).strip() in requirement) == (node["code"] in art["sub_controls"]), (artifact_id, node["code"])


def test_an_artifact_that_serves_no_sub_control_is_still_told_its_control(grounded, entry, controls):
    art = next(a for a in entry["artifacts"] if not a["sub_controls"])
    control = controls[art["control_ref"]]
    whole = (control.get("full_text") or control.get("description") or "").strip()
    assert grounded._grounded(art, controls)["requirement"] == grounded._no_ids(whole).strip()


def test_the_served_text_keeps_a_shared_lead_in_once_and_the_points_under_their_sub_control(grounded):
    control = {"full_text": "WHOLE", "native_attributes": {"sub_controls": [
        {"code": "X.1", "lead_in": "The entity shall:", "text": "do a.", "points": []},
        {"code": "X.2", "lead_in": "The entity shall:", "text": "do b.",
         "points": [{"label": "a.", "text": "first", "points": [{"label": "i.", "text": "nested"}]}]},
        {"code": "X.3", "lead_in": "The entity shall:", "text": "not served.", "points": []}]}}
    assert grounded._served_text(control, {"X.1", "X.2"}) == "The entity shall:\n- do a.\n- do b.\n  a. first\n    i. nested"
    assert grounded._served_text(control, {"elsewhere"}) == "WHOLE"
