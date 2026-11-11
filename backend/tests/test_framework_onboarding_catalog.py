"""The framework onboarding catalog (seed_data/framework_onboarding/*.json) is data that
people and auditors read: every slip an author can make is caught here, no database needed."""
import re
from pathlib import Path

import pytest

from grc.modules.framework_onboarding import catalog

REPO = Path(__file__).resolve().parents[2]
FLOWS_TS = REPO / "grc-frontend" / "src" / "app" / "(dashboard)" / "frameworks" / "[id]" / "_data" / "frameworkFlows.ts"


def _flow_ids():
    if not FLOWS_TS.is_file():  # backend deployed without the frontend next to it
        return None
    return set(re.findall(r'^\s{4}"id":\s*"([a-z0-9_\-]+)"', FLOWS_TS.read_text(encoding="utf-8"), re.M))


def test_the_shipped_catalog_has_no_authoring_slips():
    errs = catalog.validate(flow_ids=_flow_ids())
    assert errs == [], "\n".join(errs)


def test_every_family_file_exists_and_is_named_after_its_family():
    assert set(catalog.families()) == set(catalog.FAMILY_KEYS)
    for key, fam in catalog.families().items():
        assert fam["family"] == key


def test_every_library_framework_is_in_exactly_one_family():
    reg = catalog._registry_slugs()
    placed = {}
    for key, fam in catalog.families().items():
        for fw in fam["frameworks"]:
            assert fw["slug"] not in placed, f"{fw['slug']} in {placed.get(fw['slug'])} and {key}"
            placed[fw["slug"]] = key
    assert set(reg) <= set(placed)
    # catalog-only frameworks (not in the library today) are flagged so nobody expects a journey
    for key, fam in catalog.families().items():
        for fw in fam["frameworks"]:
            assert bool(fw.get("not_in_library")) == (fw["slug"] not in reg)


def test_resolution_narrows_steps_by_applies_to_and_falls_back_to_general():
    iso = catalog.resolve("iso_27001")
    keys = {f["key"] for s in iso["steps"] for f in s["fields"]}
    assert "ai_role" not in keys and "bia" not in keys and "soa" in keys and {"goal", "reach", "owner"} <= keys        # 42001 and 22301 questions stay with them; the common ones come first
    assert all(f.get("source") for s in iso["steps"] for f in s["fields"])  # the step's source is inherited
    assert catalog.resolve("iso_42001")["family"] == "iso_management"
    custom = catalog.resolve("my-own-framework")
    assert custom["family"] == catalog.GENERAL and custom["steps"]
    assert catalog.family_key_for_slug(None) == catalog.GENERAL


def test_the_catalog_has_a_stable_version_and_counts():
    s = catalog.stats()
    print(s)
    assert s["profile"]["groups"] == 4
    assert catalog.catalog_version() >= 1


# ---- the validator itself: a slip must be reported, not swallowed
def _broken(monkeypatch, mutate):
    import copy
    data = copy.deepcopy(catalog._load())
    mutate(data)
    monkeypatch.setattr(catalog, "_load", lambda: data)


def test_validator_flags_a_long_label_a_bad_when_and_a_bad_confidence(monkeypatch):
    def mutate(d):
        step = d["families"]["iso_management"]["steps"][1]       # the ISO step: risk method, SoA, BIA
        step["fields"][0]["label"] = "This label is far too long"
        step["fields"][1]["when"] = {"field": "iso.nothing", "eq": "x"}
        step["fields"][2]["source"] = {"ref": "r", "asked_by": "a", "confidence": "certain"}
    _broken(monkeypatch, mutate)
    text = "\n".join(catalog.validate())
    assert "over 3 words" in text
    assert "missing field 'iso.nothing'" in text
    assert "confidence" in text


def test_validator_flags_a_when_value_that_is_not_an_option_and_a_duplicate_key(monkeypatch):
    def mutate(d):
        fields = d["families"]["iso_management"]["steps"][1]["fields"]
        fields[2]["when"] = {"field": "iso.risk_method", "eq": "Certified, probably"}
        fields[3]["key"] = fields[2]["key"]
    _broken(monkeypatch, mutate)
    text = "\n".join(catalog.validate())
    assert "is not an option" in text
    assert "duplicate field key" in text


def test_validator_flags_a_library_framework_with_no_family(monkeypatch):
    def mutate(d):
        d["families"]["payments"]["frameworks"] = [f for f in d["families"]["payments"]["frameworks"] if f["slug"] != "swift_cscf"]
    _broken(monkeypatch, mutate)
    assert any("swift_cscf is in no family" in e for e in catalog.validate())


# ---- onboarding configures a framework; it is not the framework's work (the product owner's rule, 2026-11-11)
CLAUSE_WORK = {
    "interested_parties", "issues", "risk_criteria", "risk_owners", "soa_status", "soa_owner", "policy_status", "internal_audit", "management_review",
    "internal_auditor", "bia_status", "impact_process", "hazard_method", "consultation", "ropa_activities", "breach_runbook",
    "dpia_procedure", "ai_inventory", "stage1_target", "stage2_target", "system_manager", "sponsor",
}


def _all_slugs():
    return sorted({fw["slug"] for fam in catalog.families().values() for fw in fam["frameworks"]})


def test_every_framework_starts_with_the_same_common_steps():
    common = [s["key"] for s in catalog.common()["steps"]]
    assert common == ["objective", "applicability", "scope", "existing", "ownership"]
    for slug in _all_slugs() + ["a-custom-framework"]:
        assert [s["key"] for s in catalog.resolve(slug)["steps"]][: len(common)] == common, slug


def test_a_framework_asks_only_a_few_things_before_it_can_start():
    from grc.modules.framework_onboarding import engine

    for slug in _all_slugs():
        counts = engine.evaluate(catalog.resolve(slug), {}, {})["counts"]
        assert counts["required_total"] <= 12, f"{slug} asks {counts['required_total']} required things"
    assert engine.evaluate(catalog.resolve(None), {}, {})["counts"]["required_total"] == 5             # objective, entity, countries, applies to, owner


def test_no_family_asks_for_what_the_framework_work_produces():
    """What a clause makes an organisation prepare (a register, a plan, a named officer, a date) is compliance work, done after onboarding."""
    for key, fam in catalog.families().items():
        for st in fam["steps"]:
            for f in st["fields"]:
                assert f["key"] not in CLAUSE_WORK, f"{key}.{st['key']}.{f['key']} is the framework's own work"
                assert f["type"] not in ("table", "person", "org_pick", "asset_refs", "vendor_ref"), f"{key}.{st['key']}.{f['key']}: a {f['type']} is an inventory or a named role, which is work"
                if f["level"] == "required":
                    assert f["type"] not in ("date", "longtext", "text"), f"{key}.{st['key']}.{f['key']}: a required {f['type']} is something prepared, not applicability"
        for g in fam["gate"]:
            if g["level"] == "required":
                assert g["check"]["type"] not in ("before", "span_at_least_days", "distinct", "count_at_least"), f"{key}.gate.{g['key']} asks for something prepared"

