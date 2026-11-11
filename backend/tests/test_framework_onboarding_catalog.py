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
    assert "ai_role" not in keys and "work_types" not in keys and "cert_kind" in keys and {"goal", "reach", "owner", "status"} <= keys        # 42001 and 22301 questions stay with them; the common ones come first
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
        fields = d["families"]["attestation"]["steps"][0]["fields"]
        fields[3]["when"] = {"field": "assurance.report_type", "eq": "Certified, probably"}
        fields[4]["key"] = fields[3]["key"]
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
                if f["type"] == "org_pick":              # "which systems support it" is applicability when it is a pick and never required
                    assert f["of"] == "systems" and f["level"] == "advised", f"{key}.{st['key']}.{f['key']}: only an advised pick of systems is asked"
                else:
                    assert f["type"] not in ("table", "person", "asset_refs", "vendor_ref"), f"{key}.{st['key']}.{f['key']}: a {f['type']} is an inventory or a named role, which is work"
                if f["level"] == "required":
                    assert f["type"] not in ("date", "longtext", "text"), f"{key}.{st['key']}.{f['key']}: a required {f['type']} is something prepared, not applicability"
        for g in fam["gate"]:
            if g["level"] == "required":
                assert g["check"]["type"] not in ("before", "span_at_least_days", "distinct", "count_at_least"), f"{key}.gate.{g['key']} asks for something prepared"


# ---- the questions people expect for a framework, as yes / no / a type / a list, and an optional upload after a yes
def _keys(slug):
    return {f["key"] for s in catalog.resolve(slug)["steps"] for f in s["fields"]}


def _field(slug, key):
    return next(f for s in catalog.resolve(slug)["steps"] for f in s["fields"] if f["key"] == key)


def test_each_framework_asks_its_own_applicability_questions():
    assert {"goal", "start", "reach", "defined", "status", "records", "cert_kind", "cert_body"} <= _keys("iso_27001")     # new or existing, scope, what exists, certificate, certification body
    assert {"role", "channels", "chd", "cde", "cde_systems", "level"} <= _keys("pci_dss")
    assert {"swift_user", "type", "swift_systems", "cscf_version", "attest_kind"} <= _keys("swift_cscf")
    assert {"sama_category", "sama_activities", "start", "sama_exam"} <= _keys("sama_csf")                                 # regulated or not is the first choice of sama_category
    assert "Not a SAMA member (voluntary)" in _field("sama_csf", "sama_category")["options"]
    assert "cde" not in _keys("iso_27001") and "swift_user" not in _keys("pci_dss")                                        # nothing of another framework


def test_each_framework_lists_its_own_kinds_of_existing_work():
    """One question for everybody (do you already have something: Yes / No / In progress / Not sure), then the kinds of thing THAT framework has: a certificate is not a SOC 2 report is not an AOC."""
    status = next(f for s in catalog.common()["steps"] if s["key"] == "existing" for f in s["fields"] if f["key"] == "status")
    assert status["options"] == ["Yes", "No", "In progress", "Not sure"]
    records = _field("iso_27001", "records")
    assert records["type"] == "existing" and records["when"] == {"field": "existing.status", "eq": "Yes"} and records["level"] == "advised"
    for slug in _all_slugs() + ["a-custom-framework"]:
        res = catalog.resolve(slug)
        assert len(res["existing_types"]) >= 3 and res["existing_confidence"] in catalog.CONFIDENCE, slug
    t = {s: catalog.resolve(s)["existing_types"] for s in ("iso_27001", "soc2", "pci_dss", "swift_cscf")}
    assert {"External certification", "Statement of Applicability (SoA)", "Risk assessment and treatment", "Previous audit or gap assessment"} <= set(t["iso_27001"])
    assert {"Type I report", "Type II report", "Readiness assessment", "Gap assessment"} <= set(t["soc2"])
    assert {"Report on Compliance (ROC)", "Attestation of Compliance (AOC)", "Self-Assessment Questionnaire (SAQ)", "ASV scan attestation"} <= set(t["pci_dss"])
    assert {"External assessment", "Independent attestation", "Self-assessment", "Previous attestation"} <= set(t["swift_cscf"])
    assert "Type II report" not in t["iso_27001"] and "External certification" not in t["pci_dss"]                           # nothing of another framework
    assert catalog.resolve("a-custom-framework")["existing_types"][0] == "External certification or attestation"          # the general kinds for a framework nobody described


def test_an_upload_follows_a_yes_and_is_never_asked_or_required_before_it():
    uploads = []
    for fam in (*catalog.families().values(), catalog.common()):
        for st in fam["steps"]:
            by_key = {f["key"]: f for f in st["fields"]}
            for f in st["fields"]:
                if f["type"] != "files":
                    continue
                uploads.append(f["key"])
                assert f["level"] == "advised" and f.get("when"), f["key"]
                target = by_key.get(f["when"]["field"].split(".", 1)[1])
                assert target is not None and target["type"] in ("choice", "bool"), f"{f['key']} follows {f['when']['field']}"
    assert "defined_file" in uploads                                      # the other documents are attached to the items of "what exists" (existing.py)


def test_an_upload_cannot_be_required_or_asked_without_a_yes_and_not_in_the_profile(monkeypatch):
    def mutate(d):
        f = next(x for st in d["common"]["steps"] if st["key"] == "scope" for x in st["fields"] if x["key"] == "defined_file")
        f["level"] = "required"
        del f["when"]
    _broken(monkeypatch, mutate)
    text = "\n".join(catalog.validate())
    assert "an upload is never required" in text and "needs a 'when'" in text


def test_the_list_of_what_exists_is_validated(monkeypatch):
    def mutate(d):
        d["families"]["payments"]["frameworks"][0]["existing_types"] = ["Only one", "Only one"]
        d["common"]["existing_types_default"] = ["x" * 80, "ok"]
    _broken(monkeypatch, mutate)
    text = "\n".join(catalog.validate())
    assert "existing_types has duplicates" in text and "over 70 characters" in text


def test_every_supported_framework_asks_what_is_particular_to_it():
    """Not only the five common steps: dropdowns, yes/no and ticks of its own. A floor, not a target: no filler question to reach it."""
    for slug in _all_slugs():
        if slug == "gcrf":                                                 # a synthetic library entry the canonical catalog excludes (it has no questions of its own)
            continue
        own = [f for s in catalog.resolve(slug)["steps"][len(catalog.common()["steps"]):] for f in s["fields"]]
        asked = [f for f in own if f["type"] != "files"]
        assert len(asked) >= 2, f"{slug} asks only {len(asked)} questions of its own"
