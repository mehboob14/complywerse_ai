"""The rules of scoping a Cyber Security assessment (no database): which assessments are of an asset and which of a function, the shape and limits of a scope,
what must be filled before the questions open, and the paragraph the AI advice reads."""
import pytest

from grc.feature_map import CYBER_SECURITY_FORMATS, HUB_ASSESSMENTS
from grc.modules.assessments import scoping as s


def asset_scope(**more):
    base = {"assets": [{"asset_id": 5, "role": "primary"}], "environment": "staging", "version": "6.2", "level": 2,
            "participants": [{"kind": "user", "user_id": 2, "role": "owner"}, {"kind": "user", "user_id": 3, "role": "assessor", "independent": True}]}
    return s.validate_scope("asset", {**base, **more})


def process_scope(**more):
    base = {"function": "Security Operations Centre", "organisation": "Demo Bank", "period_start": "2026-01-01", "period_end": "2026-10-31",
            "participants": [{"kind": "user", "user_id": 2, "role": "owner"}]}
    return s.validate_scope("process", {**base, **more})


def failing(model, fmt, scope, owner=1, required=True):
    r = s.readiness(model, fmt, scope, owner)
    return {c["key"] for c in r["checks"] if not c["ok"] and c["required"] == required}, r


def test_the_seven_assessments_are_the_hubs_and_each_is_of_an_asset_or_of_a_function():
    assert set(s.SCOPE_MODEL) == set(CYBER_SECURITY_FORMATS) == {f for f, _ in HUB_ASSESSMENTS["Cyber Security"]}
    assert [s.SCOPE_MODEL[f] for f in ("asvs_checklist", "owasp_v4_testing_checklist", "mobile_app_security")] == ["asset"] * 3
    assert [s.SCOPE_MODEL[f] for f in ("csir_maturity", "cti_maturity", "incident_maturity", "itsecops_maturity")] == ["process"] * 4
    assert s.ORDER == [f for f, _ in HUB_ASSESSMENTS["Cyber Security"]] and s.LABELS["asvs_checklist"] == "OWASP ASVS"


def test_a_scope_is_stored_whole_with_dates_as_text_and_unknown_keys_are_refused():
    stored = asset_scope(window_start="2026-11-10", window_end="2026-11-20", test_roles=[" customer ", "", "administrator"])
    assert stored["window_start"] == "2026-11-10" and stored["test_roles"] == ["customer", "administrator"]
    assert stored["rules_of_engagement"] == {"approved_by": "", "approved_on": None, "notes": ""}            # every key present
    with pytest.raises(s.ScopeError) as err:
        s.validate_scope("asset", {"colour": "red"})
    assert err.value.errors[0]["field"] == "colour"


def test_blank_dates_and_choices_from_a_form_are_nothing_and_bad_ones_say_where():
    assert s.validate_scope("asset", {"environment": "", "level": "", "window_start": "", "trigger": ""})["level"] is None
    with pytest.raises(s.ScopeError) as err:
        s.validate_scope("asset", {"environment": "moon", "level": 4})
    assert {e["field"] for e in err.value.errors} == {"environment", "level"}
    with pytest.raises(s.ScopeError) as err:
        s.validate_scope("asset", {"window_start": "2026-11-20", "window_end": "2026-11-10"})
    assert "ends before it starts" in err.value.errors[0]["message"]
    with pytest.raises(s.ScopeError) as err:
        s.validate_scope("process", {"period_start": "2026-10-31", "period_end": "2026-01-01"})
    assert "period ends before it starts" in err.value.errors[0]["message"]


def test_a_participant_is_a_person_a_team_or_an_outside_party_with_their_organisation():
    ok = s.validate_scope("process", {"participants": [{"kind": "user", "user_id": "7", "role": "owner"}, {"kind": "team", "team_id": 2, "domains": ["Prepare", " Prepare ", ""]},
                                                       {"kind": "external", "name": "Sana", "organisation": "Managed SOC Ltd"}]})
    assert ok["participants"][0]["user_id"] == 7 and ok["participants"][1]["domains"] == ["Prepare"]
    for bad in ({"kind": "user"}, {"kind": "team"}, {"kind": "external", "name": "Sana"}, {"kind": "external", "organisation": "X"}):
        with pytest.raises(s.ScopeError):
            s.validate_scope("process", {"participants": [bad]})


def test_a_patch_replaces_a_key_whole_and_the_keys_that_changed_are_named():
    before = process_scope()
    merged = s.merge_scope(before, {"geography": ["Pakistan"], "participants": []})
    after = s.validate_scope("process", merged)
    assert s.changed_keys(before, after) == ["geography", "participants"]
    assert s.changed_keys(before, s.validate_scope("process", s.merge_scope(before, {"function": before["function"]}))) == []     # sent back unchanged: nothing changed
    assert s.OPEN_AFTER_START["asset"] == {"participants", "notes"} and "evidence_plan" in s.OPEN_AFTER_START["process"]


def test_an_asset_assessment_needs_the_subject_its_environment_version_level_people_and_in_production_the_rules_of_engagement():
    missing, _ = failing("asset", "asvs_checklist", s.validate_scope("asset", {}), owner=None)
    assert missing == {"subject", "environment", "version", "level", "owner", "application_owner", "assessor"}
    missing, ready = failing("asset", "asvs_checklist", asset_scope())
    assert missing == set() and ready["ready"]
    assert {c["key"] for c in ready["checks"] if not c["required"] and not c["ok"]} == {"window", "reviewer", "rules_of_engagement"}      # advice, not a block
    missing, ready = failing("asset", "asvs_checklist", asset_scope(environment="production"))
    assert missing == {"rules_of_engagement"} and not ready["ready"]
    assert failing("asset", "asvs_checklist", asset_scope(intrusive=True))[0] == {"rules_of_engagement"}                      # an intrusive test too
    signed = asset_scope(environment="production", rules_of_engagement={"approved_by": "CISO", "approved_on": "2026-11-01"})
    assert failing("asset", "asvs_checklist", signed)[0] == set()


def test_the_level_is_asked_for_asvs_and_the_platform_for_a_mobile_app_and_neither_for_owasp_testing():
    no_level = asset_scope(level=None)
    assert failing("asset", "asvs_checklist", no_level)[0] == {"level"}
    assert failing("asset", "owasp_v4_testing_checklist", no_level)[0] == set()
    assert failing("asset", "mobile_app_security", no_level)[0] == {"platforms"}
    assert failing("asset", "mobile_app_security", asset_scope(level=None, platforms=["android"]))[0] == set()


def test_a_function_needs_its_name_organisation_period_and_owners_and_advice_asks_for_the_rest():
    missing, _ = failing("process", "incident_maturity", s.validate_scope("process", {}), owner=None)
    assert missing == {"function", "organisation", "period", "owner", "process_owner"}
    missing, ready = failing("process", "incident_maturity", process_scope())
    assert missing == set() and ready["ready"]
    assert {c["key"] for c in ready["checks"] if not c["required"] and not c["ok"]} == {"sponsor", "contributors", "reviewer", "assets", "evidence_plan"}
    full = process_scope(participants=[{"kind": "user", "user_id": 2, "role": "owner"}, {"kind": "user", "user_id": 3, "role": "contributor"},
                                       {"kind": "external", "name": "Sana", "organisation": "Managed SOC Ltd", "role": "contributor"},
                                       {"kind": "user", "user_id": 4, "role": "reviewer"}, {"kind": "user", "user_id": 5, "role": "sponsor"}],
                         assets=[{"asset_id": 9, "role": "supporting"}], evidence_plan={"deadline": "2026-12-15"})
    assert {c["key"] for c in s.readiness("process", "incident_maturity", full, 1)["checks"] if not c["ok"]} == set()


def test_the_paragraph_the_ai_reads_says_what_is_assessed_and_names_no_person():
    facts = {5: {"name": "Digital Banking Web", "asset_type": "application", "criticality": "critical", "internet_facing": True, "data_classification": "confidential"},
             6: {"name": "Payments API"}, 7: {"name": "Core banking"}}
    text = s.summary_text("asset", "asvs_checklist", asset_scope(assets=[{"asset_id": 5, "role": "primary"}, {"asset_id": 6, "role": "component"}, {"asset_id": 7, "role": "excluded"}],
                                                                 level_reason="holds card data", test_roles=["customer"], exclusions=[{"what": "Mainframe batch", "reason": "out of reach"}]), facts)
    assert "Subject: Digital Banking Web (application; criticality critical; internet-facing; data classification confidential)." in text
    assert "ASVS level: 2 (holds card data)." in text and "Related assets in scope: Payments API." in text
    assert "Excluded: Core banking, Mainframe batch." in text and "The assessor is independent of the application's team." in text
    unrecorded = s.summary_text("asset", "asvs_checklist", asset_scope(participants=[{"kind": "user", "user_id": 3, "role": "assessor"}]), facts)
    assert "The assessor's independence of the application's team is not recorded." in unrecorded and "part of the application" not in unrecorded     # no claim beyond what was recorded
    process =s.summary_text("process", "csir_maturity", process_scope(participants=[{"kind": "user", "user_id": 2, "role": "owner"}, {"kind": "external", "name": "Sana", "organisation": "Managed SOC Ltd", "role": "contributor"}],
                                                                       assets=[{"asset_id": 6, "role": "supporting"}], services=["24x7 monitoring"]), facts)
    assert 'Subject: the function or process "Security Operations Centre" of Demo Bank.' in process
    assert "Assessment period: 2026-01-01 to 2026-10-31." in process and "Supporting assets (context for the evidence, not scored): Payments API." in process
    assert "1 contributor, 1 owner (1 from outside providers" in process and "Sana" not in process and "Managed SOC" not in process
    assert len(s.summary_text("process", "csir_maturity", process_scope(services=["x" * 150] * 30), {})) <= 1500


def test_the_scope_rules_out_the_requirements_above_the_asvs_level_and_the_platform_not_assessed():
    na = s.not_applicable
    l2 = {"level": 2}
    assert na("asvs_checklist", l2, "ASVS Level: 3 | CWE: 285") == "Outside the selected ASVS level 2."
    assert na("asvs_checklist", l2, "ASVS Level: 2") is None and na("asvs_checklist", l2, "ASVS Level: 1") is None       # level 2 includes level 1
    assert na("asvs_checklist", l2, None) is None and na("asvs_checklist", {}, "ASVS Level: 3") is None                  # no level chosen: all apply
    assert na("asvs_checklist", {"level": 3}, "ASVS Level: 3") is None
    android = {"platforms": ["android"]}
    assert na("mobile_app_security", android, "Platform: iOS | MASVS: L1,L2") == "iOS is not in scope."
    assert na("mobile_app_security", android, "Platform: Android | MASVS: L2") is None
    assert na("mobile_app_security", {"platforms": ["android", "ios"]}, "Platform: iOS") is None
    assert na("mobile_app_security", android, "MASVS: L2") is None and na("mobile_app_security", {}, "Platform: iOS") is None
    assert na("incident_maturity", l2, "ASVS Level: 3") is None and na("owasp_v4_testing_checklist", android, "Platform: iOS") is None


def test_only_people_who_answer_and_listed_a_domain_are_assigned_its_questions():
    people = [{"kind": "user", "user_id": 2, "role": "owner", "domains": ["Prepare"]}, {"kind": "team", "team_id": 4, "role": "contributor", "domains": ["Prepare", "Respond"]},
              {"kind": "user", "user_id": 3, "role": "contributor", "domains": []}, {"kind": "user", "user_id": 5, "role": "reviewer", "domains": ["Prepare"]},
              {"kind": "external", "name": "Sana", "organisation": "MSSP", "role": "contributor", "domains": ["Prepare"]}]
    assert s.assignment_targets(people, "Prepare") == [{"type": "user", "id": 2}, {"type": "team", "id": 4}]
    assert s.assignment_targets(people, "Respond") == [{"type": "team", "id": 4}]
    assert s.assignment_targets(people, "Follow up") == [] and s.assignment_targets(people, None) == []
