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
