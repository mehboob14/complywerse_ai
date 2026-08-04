"""Phase 1 — real-tenant enrichment inputs.

Guards the gap that made every real tenant map generically: the NVD client never
read `cve.weaknesses[]`, so `vuln.cwe_id` stayed null and the engine fell back to
the assumed-generic chain. These lock the CWE extraction (Primary first, NVD
placeholders dropped, whole list kept) and that the selector reads the full list
without regressing the single-CWE path. DB- and network-free (pure functions).
"""
from grc.modules.vuln_management.attack.selection import select_techniques
from grc.modules.vuln_management.enrichment.nvd_client import _extract_payload


def _nvd_raw(weaknesses):
    """Minimal NVD 2.0 response shape carrying just the weaknesses block."""
    return {"vulnerabilities": [{"cve": {
        "id": "CVE-2024-9999",
        "descriptions": [{"lang": "en", "value": "test"}],
        "weaknesses": weaknesses,
    }}]}


def test_nvd_extracts_cwes_primary_first():
    r = _extract_payload(_nvd_raw([
        {"type": "Secondary", "description": [{"lang": "en", "value": "CWE-79"}]},
        {"type": "Primary", "description": [{"lang": "en", "value": "CWE-89"}]},
    ]), "CVE-2024-9999")
    assert r.cwe_ids == ["CWE-89", "CWE-79"]  # Primary leads, so cwe_ids[0] is the Primary


def test_nvd_skips_placeholder_weaknesses():
    r = _extract_payload(_nvd_raw([
        {"type": "Primary", "description": [{"lang": "en", "value": "NVD-CWE-noinfo"}]},
        {"type": "Secondary", "description": [{"lang": "en", "value": "NVD-CWE-Other"}]},
        {"type": "Secondary", "description": [{"lang": "en", "value": "CWE-22"}]},
    ]), "CVE-2024-9999")
    assert r.cwe_ids == ["CWE-22"]  # the two placeholders carry no CWE and are dropped


def test_nvd_no_weaknesses_is_empty_list():
    assert _extract_payload(_nvd_raw([]), "CVE-2024-9999").cwe_ids == []


def test_nvd_dedupes_repeated_cwe():
    r = _extract_payload(_nvd_raw([
        {"type": "Primary", "description": [{"lang": "en", "value": "CWE-89"}]},
        {"type": "Secondary", "description": [{"lang": "en", "value": "CWE-89"}]},
    ]), "CVE-2024-9999")
    assert r.cwe_ids == ["CWE-89"]


def test_selector_reads_full_cwe_list_without_regressing_single():
    # More CWEs = more input, never less: the multi-CWE result is a superset of the
    # single-CWE result. This is why storing the whole list beats keeping only one.
    one = {t["technique_id"] for t in select_techniques("CWE-89", None)}
    many = {t["technique_id"] for t in select_techniques(["CWE-89", "CWE-79", "CWE-22"], None)}
    assert one <= many
    assert len(many) >= len(one)


def test_selector_scalar_and_singleton_list_are_equivalent():
    # Back-compat: the old single-string call and a one-element list must match.
    a = {t["technique_id"] for t in select_techniques("CWE-89", None)}
    b = {t["technique_id"] for t in select_techniques(["CWE-89"], None)}
    assert a == b
