"""The workflow builder groups its nodes the way the sidebar does, from one map.

The catalogue used to name modules itself, so 261 nodes sat under "Compliance",
Business Continuity read "Bcm", and there was no Assessments module at all — a
workflow could not name Cyber Security assessments.
"""
import collections

import pytest

from grc import feature_map
from grc.main import app  # noqa: F401  importing the app is what places the nodes
from grc.modules.workflow_engine.services.catalog import (
    PLATFORM_FUNCTION_NODE_TYPES,
    TRIGGER_NODE_TYPES,
)
from grc.modules.workflow_engine.services.trigger_dispatcher import _matches_when

CYBER_SECURITY = ("submodule", frozenset({"cyber security"}))


def test_every_node_sits_on_a_sidebar_page():
    off_menu = sorted({n["module"] for n in PLATFORM_FUNCTION_NODE_TYPES} - set(feature_map.MODULE_ORDER))
    assert off_menu == [], f"modules the sidebar does not have: {off_menu}"


def test_every_module_that_owns_records_has_nodes():
    counts = collections.Counter(n["module"] for n in PLATFORM_FUNCTION_NODE_TYPES)
    # Performance Overview and My Work only read; there is nothing to automate.
    expected = [m for m in feature_map.MODULE_ORDER if m not in ("Performance Overview", "My Work")]
    assert [m for m in expected if not counts[m]] == []


def test_assessments_are_their_own_module():
    pages = {n["submodule"] for n in PLATFORM_FUNCTION_NODE_TYPES if n["module"] == "Assessments"}
    assert {"Framework Assessments", "NCA"} <= pages
    assert not [n for n in PLATFORM_FUNCTION_NODE_TYPES
                if (n["module"], n["submodule"]) == ("Compliance", "Assessments")]


def test_each_assessment_type_has_its_own_trigger():
    keys = {t["key"] for t in TRIGGER_NODE_TYPES}
    assert {
        "cyber_security_assessment_created", "nca_assessment_created", "dpia_assessment_created",
        "pdpl_assessment_created", "digital_ops_assessment_created", "other_assessment_created",
    } <= keys


@pytest.mark.parametrize("page,fires", [("Cyber Security", True), ("NCA", False), ("Saudi PDPL", False)])
def test_a_typed_assessment_event_fires_only_on_its_own_page(page, fires):
    assert _matches_when(CYBER_SECURITY, {"submodule": page}, {}, {}) is fires


def test_an_upload_is_typed_by_its_format_when_the_row_says_overview():
    assert _matches_when(CYBER_SECURITY, {"submodule": "Overview"}, {"assessment_format": "asvs_checklist"}, {})
    assert not _matches_when(CYBER_SECURITY, {"submodule": "Overview"}, {"assessment_format": "dpia_pia"}, {})


# ── Listed as the sidebar is ─────────────────────────────────────────────────

def test_triggers_are_listed_where_their_page_is_in_the_sidebar():
    assert [t["key"] for t in TRIGGER_NODE_TYPES if not t.get("path")] == []
    tops = list(dict.fromkeys(t["path"][0] for t in TRIGGER_NODE_TYPES))
    assert tops[:5] == ["Task Management", "Governance", "Risk Management", "Third-Party Vendor Risk",
                     "Compliance Management"]
    names = {name for n in [*TRIGGER_NODE_TYPES, *PLATFORM_FUNCTION_NODE_TYPES] for name in n.get("path", [])}
    # Assets and vulnerabilities are Cybersecurity Assurance now; tasks are Task Management.
    assert not names & {"Vulnerability Management", "Asset Management", "IT Asset Management", "Assets",
                        "Critical Tasks"}
    path = {t["key"]: t["path"] for t in TRIGGER_NODE_TYPES}
    assert path["vulnerability_created"] == ["Cybersecurity Assurance", "Vulnerabilities"]
    assert path["discovery_run_started"] == ["Cybersecurity Assurance", "IT Asset Discovery"]
    assert path["asset_created"] == ["Cybersecurity Assurance", "IT Asset Inventory"]
    assert path["bcm_drill_completed"] == ["Compliance Management", "Business Continuity", "Drills & Invocations"]
    assert path["risk_created"] == ["Risk Management", "Operational Risk", "Risk Register"]
    assert path["critical_task_created"] == ["Task Management"]


def test_every_assessment_inside_a_hub_page_has_its_own_triggers():
    assert {fmt for fmt, _ in feature_map.HUB_ASSESSMENTS["Cyber Security"]} == feature_map.CYBER_SECURITY_FORMATS
    for hub, items in feature_map.HUB_ASSESSMENTS.items():
        for _fmt, label in items:
            mine = [t for t in TRIGGER_NODE_TYPES if t["path"] == ["Compliance Management", "Assessments", hub, label]]
            assert len(mine) >= 6, (hub, label)
    cyber = [t["key"] for t in TRIGGER_NODE_TYPES
             if t["path"][:3] == ["Compliance Management", "Assessments", "Cyber Security"]]
    # the page's own "any Cyber Security assessment" events come before the assessments inside it
    assert cyber.index("cyber_security_assessment_created") < cyber.index("owasp_asvs_assessment_created")


@pytest.mark.parametrize("row,body,fires", [
    ({"assessment_format": "asvs_checklist"}, {}, True),      # an edit: the audit row recorded the format
    ({"assessment_format": "csir_maturity"}, {}, False),
    ({}, {"assessment_format": "asvs_checklist"}, True),      # an upload names it in the request
])
def test_an_assessment_inside_a_hub_fires_only_for_its_own_format(row, body, fires):
    assert _matches_when(("assessment_format", frozenset({"asvs_checklist"})), row, body, {}) is fires


def test_completed_needs_both_the_assessment_and_the_status():
    when = (("assessment_format", frozenset({"asvs_checklist"})), ("status", frozenset({"completed"})))
    row = {"assessment_format": "asvs_checklist"}
    assert _matches_when(when, row, {"status": "completed"}, {})
    assert not _matches_when(when, row, {"status": "in_progress"}, {})
