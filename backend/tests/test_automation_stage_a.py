"""Stage A regression tests for automation mapping reviews + sub_type.

DB-free: exercises the pure helpers added for suppressions, retargets,
and Hybrid classification.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow importing the router module without full app boot when possible.
BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def test_effective_mapping_scf_suppress_and_retarget():
    from grc.modules.automation.router import _effective_mapping_scf

    suppressed = {("soc2", "CC6.1", "SCF-IAC-01")}
    retargets = {("soc2", "CC6.2", "SCF-IAC-01"): "SCF-IAC-99"}

    assert _effective_mapping_scf("soc2", "CC6.1", "SCF-IAC-01", suppressed, retargets) is None
    assert _effective_mapping_scf("soc2", "CC6.2", "SCF-IAC-01", suppressed, retargets) == "SCF-IAC-99"
    assert _effective_mapping_scf("soc2", "CC6.3", "SCF-IAC-01", suppressed, retargets) == "SCF-IAC-01"


def test_control_sub_type_hybrid_automated_manual():
    from grc.modules.automation.router import _control_sub_type

    linked = [{"id": 1}]
    assert _control_sub_type([], "T") == "Manual"
    assert _control_sub_type(linked, "T") == "Automated"
    assert _control_sub_type(linked, "PT") == "Hybrid"
    assert _control_sub_type(linked, "P") == "Automated"  # people-only still Automated when checks exist
