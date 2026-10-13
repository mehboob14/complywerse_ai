"""The registry of AI use cases and the source code agree.

Every place the code calls an AI provider must belong to a registered use case (so the inventory the tenant admin sees
is complete and a switch can be placed), and every registered call must still exist. Adding an AI call without
registering it fails here: add a row to grc/services/ai_gateway/registry.py.
"""
import re
from collections import Counter

from grc.services.ai_gateway import callsites, registry

# files that legitimately hold a provider URL: the default API address of a client, or a connector catalogue that
# reads an organisation's own account at a provider (not a call that sends tenant data to a model)
HOSTS_ALLOWED_IN = {
    "services/ai_gateway/callsites.py",     # the scanner's own pattern
    "modules/compliance_plugins/runners/live_api_catalog.py",
    "modules/governance/ai_drafting/pipeline.py",
    "modules/governance/routers/documents.py",
    "modules/governance/routers/gap_analysis.py",
    "modules/governance/routers/policy_parser.py",
}
SDKS_ALLOWED_IN = {("routers/ai_risk_assessment_router.py", "anthropic")}
VENDOR_WORDS = re.compile(r"openai|gpt|chatgpt|anthropic|claude|gemini|llama|langsmith|qdrant", re.I)


def _engine_here() -> bool:
    return callsites.ENGINE.is_dir()


def _in_scope(callsite: str) -> bool:
    return _engine_here() or not callsite.startswith("ava-pentest-engine/")


def test_every_provider_call_is_registered():
    registered = {cs for u in registry.USE_CASES for cs in u.callsites}
    missing = sorted({s.key for s in callsites.scan_calls()} - registered)
    assert not missing, (
        "AI provider calls with no registered use case; add them to grc/services/ai_gateway/registry.py:\n  " + "\n  ".join(missing))


def test_every_registered_call_still_exists():
    found = {s.key for s in callsites.scan_calls()}
    stale = sorted(cs for u in registry.USE_CASES for cs in u.callsites if _in_scope(cs) and cs not in found)
    assert not stale, "registered AI calls that no longer exist in the code:\n  " + "\n  ".join(stale)


def test_use_cases_are_well_formed():
    ids = [u.id for u in registry.USE_CASES]
    assert len(ids) == len(set(ids)), [i for i, n in Counter(ids).items() if n > 1]
    for u in registry.USE_CASES:
        assert u.module in registry.MODULES, f"{u.id}: unknown module {u.module!r}"
        assert u.trigger in registry.TRIGGERS and u.profile in registry.PROFILES and u.level in registry.LEVELS, u.id
        assert u.modality in registry.MODALITIES and set(u.apis) <= set(registry.APIS), u.id
        assert u.callsites and all(re.fullmatch(r"[\w./-]+\.py:[\w.<>]+", cs) for cs in u.callsites), u.id
        assert u.label.strip() and u.value.strip() and u.surface.strip() and u.records, u.id
        assert len(u.label) <= 60 and u.value.endswith("."), f"{u.id}: label under 60 characters, value one sentence ending in a full stop"
        for text in (u.label, u.value, u.surface):
            assert not VENDOR_WORDS.search(text), f"{u.id}: the product says 'AI', not a model or vendor ({text!r})"
        if u.modality == "vision":
            assert u.profile == "VISION" and u.level == "L4", u.id


def test_the_api_of_each_use_case_matches_what_the_code_calls():
    kinds = {}
    for s in callsites.scan_calls():
        kinds.setdefault(s.key, set()).add(s.api)
    for u in registry.USE_CASES:
        seen = set().union(*(kinds.get(cs, set()) for cs in u.callsites if _in_scope(cs)))
        if seen:
            assert seen == set(u.apis), f"{u.id}: the code calls {sorted(seen)}, the registry says {sorted(u.apis)}"


def test_a_function_shared_by_several_use_cases_names_who_starts_each():
    uses = Counter(cs for u in registry.USE_CASES for cs in u.callsites)
    for u in registry.USE_CASES:
        if any(uses[cs] > 1 for cs in u.callsites):
            assert u.entry, f"{u.id}: shares a provider call with another use case, so it must name its entry function(s)"
    functions = callsites.index().functions
    for u in registry.USE_CASES:
        for e in u.entry:
            path, _, qual = e.partition(":")
            assert (path, qual) in functions, f"{u.id}: entry {e} is not a function in backend/grc"


def test_provider_addresses_and_other_sdks_only_where_expected():
    stray = sorted({(path, line, text) for path, _f, line, text in callsites.index().hosts if path not in HOSTS_ALLOWED_IN})
    assert not stray, f"provider addresses outside the allowed files (a raw call would bypass the gateway): {stray}"
    sdks = sorted(set(callsites.index().sdk_imports) - SDKS_ALLOWED_IN)
    assert not sdks, f"another provider's SDK is imported; it needs a decision and a registry entry: {sdks}"


def test_the_pentest_engine_calls_are_all_registered():
    if not _engine_here():
        return
    engine = {s.key for s in callsites.scan_calls() if s.path.startswith("ava-pentest-engine/")}
    assert engine, "the scanner found no provider call in the pentest engine"
    registered = {cs for u in registry.USE_CASES for cs in u.callsites if cs.startswith("ava-pentest-engine/")}
    assert engine == registered, (sorted(engine - registered), sorted(registered - engine))
    assert all(u.outside_shim for u in registry.USE_CASES if u.module == "pentest")


def test_lookup_names_the_use_case_of_a_function_and_every_one_for_a_shared_helper():
    one = registry.lookup("modules/erm/routers/risks.py", "generate_ai_treatment_plan")
    assert [u.id for u in one] == ["erm.risk_treatment_plan"]
    shared = {u.id for u in registry.lookup("services/assessment_evidence_ai.py", "openai_complete")}
    assert {"assessments.evidence_draft", "evidence.quality_check", "third_party.contract_terms"} <= shared
    assert registry.lookup("modules/erm/routers/risks.py", "no_such_function") == []
    assert registry.get("erm.risk_treatment_plan").module == "erm" and registry.module_label("erm") == "Risk Management"


# Use cases that reach a provider around the guard in the shim (embeddings, another SDK, raw HTTP), by decision. A new
# path of that kind fails here until someone adds it, knowing that nothing cleans what it sends.
KNOWN_AROUND_THE_GUARD = {
    "complychat.embeddings", "erm.ai_risk_template", "pentest.assign_tool", "pentest.choose_exploit", "pentest.choose_tools",
    "pentest.classify_findings", "pentest.plan", "pentest.verify_exploit",
}


def test_nothing_new_reaches_a_provider_around_the_guard():
    around = {u.id for u in registry.USE_CASES if u.outside_shim}
    assert around == KNOWN_AROUND_THE_GUARD, (sorted(around - KNOWN_AROUND_THE_GUARD), sorted(KNOWN_AROUND_THE_GUARD - around))


def test_ambient_and_outside_shim_follow_from_the_trigger_and_the_api():
    ids = {u.id: u for u in registry.USE_CASES}
    assert ids["dashboard.ai_insights"].ambient and not ids["erm.risk_treatment_plan"].ambient
    assert ids["complychat.embeddings"].outside_shim and not ids["regulatory.read_circular"].outside_shim   # Responses is guarded now
    assert ids["erm.ai_risk_template"].outside_shim and not ids["erm.risk_suggest"].outside_shim
    # nothing that reads scans or images is a click-only feature: both vision paths fire on their own
    assert all(u.ambient for u in registry.USE_CASES if u.modality == "vision")


def test_the_inventory_report_matches_a_ledger_event_to_its_use_case():
    from grc.tools.ai_inventory_report import match_event

    # by the function the event names
    assert [u.id for u in match_event("modules/erm/routers/risks.py:3154", "generate_ai_treatment_plan")] == ["erm.risk_treatment_plan"]
    # an explicit feature key that is no function name: by the file, when the file holds one use case
    assert [u.id for u in match_event("modules/governance/statement_auto_map.py:1", "statement_auto_mapping")] == ["governance.statement_mapping"]
    # a shared helper stays ambiguous (that is what an explicit usage_scope at the entry point will settle)
    assert len(match_event("services/assessment_evidence_ai.py:1", "openai_complete")) > 1
    assert match_event("", "anything") == []
