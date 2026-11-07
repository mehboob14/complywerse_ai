"""CTEM Validate's SCF crosswalk: the pure rule logic (no DB)."""
from grc.services.scf_validate import CWE_TO_OWASP, _norm_cwe, rules_for

BY_CAT = {"A05:2025": ["CFG-03", "VPM-02"], "A01:2025": ["IAC-07"]}
FLAW = ["VPM-01", "VPM-02", "VPM-05"]


def test_cwe_is_normalised_from_scanner_spellings():
    assert _norm_cwe("CWE-89") == "CWE-89"
    assert _norm_cwe(" cwe-89, CWE-564") == "CWE-89"
    assert _norm_cwe("89") == "CWE-89"
    assert _norm_cwe("NVD-CWE-Other") is None
    assert _norm_cwe(None) is None


def test_each_cwe_belongs_to_one_owasp_category():
    assert CWE_TO_OWASP["CWE-89"] == "A05:2025"
    assert CWE_TO_OWASP["CWE-918"] == "A01:2025"   # SSRF folded into Broken Access Control
    assert "CWE-787" not in CWE_TO_OWASP           # memory safety is not an OWASP Top 10 category


def test_cwe_finding_gets_its_category_controls_and_cve_adds_flaw_remediation_once():
    rules = rules_for("CWE-89", "CVE-2024-1", BY_CAT, FLAW)
    assert [s for s, _ in rules] == ["CFG-03", "VPM-02", "VPM-01", "VPM-05"]
    assert rules[0][1] == "auto:cwe:CWE-89 · OWASP A05:2025 → SCF CFG-03"
    assert rules[2][1] == "auto:cwe:vuln-mgmt · CVE-2024-1 → NIST SI-02 → SCF VPM-01"


def test_finding_with_no_rule_gets_no_link():
    assert rules_for("CWE-787", None, BY_CAT, FLAW) == []
    assert [s for s, _ in rules_for("CWE-787", "CVE-2024-2", BY_CAT, FLAW)] == FLAW
