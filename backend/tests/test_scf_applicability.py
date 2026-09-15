"""DB-free unit tests for SCF Stage B applicability engine."""
from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_expand_source_slugs_includes_product_and_scf_keys():
    from grc.modules.scf.registry import expand_source_slugs

    expanded = expand_source_slugs(["soc2", "iso_27001"])
    assert "soc2" in expanded
    assert "iso_27001" in expanded
    # Registry binds soc2 → aicpa_tsc_soc2 and iso_27001 → iso_27002_2022
    assert "aicpa_tsc_soc2" in expanded
    assert "iso_27002_2022" in expanded


def test_resolve_one_facility_gate():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Facility", baselines=[])
    scope = SimpleNamespace(
        has_facilities=False,
        processes_personal_data=True,
        framework_slugs=["soc2"],
        framework_obligations={},
        esp_level=0,
    )
    ans = resolve_one(control, scope, mapping_source_slugs_for_control={"soc2"})
    assert ans["is_applicable"] is False
    assert ans["source"] == "gate"
    assert "facilit" in (ans["reason"] or "").lower()


def test_resolve_one_data_gate():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Data", baselines=[])
    scope = SimpleNamespace(
        has_facilities=True,
        processes_personal_data=False,
        framework_slugs=["soc2"],
        framework_obligations={},
        esp_level=0,
    )
    ans = resolve_one(control, scope, mapping_source_slugs_for_control={"soc2"})
    assert ans["is_applicable"] is False
    assert ans["source"] == "gate"


def test_resolve_one_override_survives_mapping():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Process", baselines=["esp_1"])
    scope = SimpleNamespace(
        has_facilities=True,
        processes_personal_data=True,
        framework_slugs=["soc2"],
        framework_obligations={"soc2": "MCR"},
        esp_level=3,
    )
    state = SimpleNamespace(
        is_applicable=False,
        applicability_source="override",
        obligation=None,
        applicability_reason="Business exception",
    )
    ans = resolve_one(
        control, scope, state_row=state,
        mapping_source_slugs_for_control={"soc2", "aicpa_tsc_soc2"},
    )
    assert ans["is_applicable"] is False
    assert ans["source"] == "override"
    assert ans["reason"] == "Business exception"


def test_resolve_one_derived_mcr_vs_dsr():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Process", baselines=[])
    base_scope = dict(
        has_facilities=True,
        processes_personal_data=True,
        framework_slugs=["soc2"],
        esp_level=0,
    )
    mcr = resolve_one(
        control,
        SimpleNamespace(**base_scope, framework_obligations={"soc2": "MCR"}),
        mapping_source_slugs_for_control={"aicpa_tsc_soc2"},
    )
    assert mcr["is_applicable"] is True
    assert mcr["source"] == "derived"
    assert mcr["obligation"] == "MCR"

    dsr = resolve_one(
        control,
        SimpleNamespace(**base_scope, framework_obligations={"soc2": "DSR"}),
        mapping_source_slugs_for_control={"soc2"},
    )
    assert dsr["is_applicable"] is True
    assert dsr["obligation"] == "DSR"


def test_resolve_one_baseline_esp():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Process", baselines=["esp_1", "esp_2"])
    scope = SimpleNamespace(
        has_facilities=True,
        processes_personal_data=True,
        framework_slugs=[],
        framework_obligations={},
        esp_level=1,
    )
    ans = resolve_one(control, scope, mapping_source_slugs_for_control=set())
    assert ans["is_applicable"] is True
    assert ans["source"] == "baseline"
    assert ans["obligation"] == "DSR"


def test_resolve_one_na_derived():
    from grc.modules.scf.applicability import resolve_one

    control = SimpleNamespace(pptdf="Process", baselines=[])
    scope = SimpleNamespace(
        has_facilities=True,
        processes_personal_data=True,
        framework_slugs=["soc2"],
        framework_obligations={},
        esp_level=0,
    )
    ans = resolve_one(control, scope, mapping_source_slugs_for_control=set())
    assert ans["is_applicable"] is False
    assert ans["source"] == "derived"


def test_can_self_approve_refusal():
    from grc.modules.scf.applicability import can_self_approve

    assert can_self_approve(1, 2) is True
    assert can_self_approve(5, 5) is False
    assert can_self_approve(None, 1) is True
    assert can_self_approve(1, None) is True


def test_framework_catalog_shape():
    from grc.modules.scf.registry import framework_catalog, label_for_slug

    cat = framework_catalog()
    assert cat
    row = next(x for x in cat if x["slug"] == "soc2")
    assert row["label"] == label_for_slug("soc2")
    assert "scf_keys" in row
    assert "file" in row
    # gcrf is emit:false and must not appear
    assert all(x["slug"] != "gcrf" for x in cat)
