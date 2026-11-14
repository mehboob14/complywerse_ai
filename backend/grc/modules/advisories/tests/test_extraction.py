"""Unit tests for advisory CVE extraction (the deterministic parser half)."""
from grc.modules.advisories.extraction import find_cves, extract_from_text, filter_ai_cves

_SAMPLE = """National CERT Advisory NCA-19.211026
Critical PHP Vulnerabilities (CVE-2026-109618 and CVE-2026-109619).
Both affect the PHP runtime. See also cve-2026-109618 (duplicate, lowercase).
Contact pkcert.gov.pk. Not a CVE: AB-2026-1, CVE-20-1.
"""


def test_find_cves_dedupes_and_normalises_case():
    cves = find_cves(_SAMPLE)
    assert cves == ["CVE-2026-109618", "CVE-2026-109619"]


def test_find_cves_ignores_malformed():
    # CVE-20-1 has too few digits; AB-... is not a CVE.
    assert find_cves("CVE-20-1 AB-2026-1 nothing here") == []


def test_find_cves_empty():
    assert find_cves("") == []


def test_extract_from_text_builds_proposals():
    result = extract_from_text(_SAMPLE, filename="advisory.pdf")
    ids = [c["cve_id"] for c in result["cves"]]
    assert ids == ["CVE-2026-109618", "CVE-2026-109619"]
    assert result["title"]  # falls back to filename stem when no AI title
    assert result["summary"]
    # Every proposed CVE carries the product/versions keys (values may be None
    # when no AI key is configured — a human fills them at the review step).
    assert all("affected_product" in c and "affected_versions" in c for c in result["cves"])


def test_filter_ai_cves_drops_hallucinations_and_dupes():
    found = ["CVE-2026-109618", "CVE-2026-109619"]
    ai = [
        {"cve_id": "cve-2026-109618", "product": "php", "versions": "< 8.2.35"},
        {"cve_id": "CVE-2099-00000", "product": "evil", "versions": "all"},  # not found → dropped
        {"cve_id": "CVE-2026-109618", "product": "dup", "versions": "x"},     # dup → first wins
        "garbage",                                                            # non-dict → ignored
    ]
    out = filter_ai_cves(ai, found)
    assert set(out) == {"CVE-2026-109618"}
    assert out["CVE-2026-109618"]["product"] == "php"


def test_extract_from_text_exposes_normalised_template_keys():
    r = extract_from_text(_SAMPLE, filename="advisory.pdf")
    for key in ("title", "summary", "severity", "external_id", "published_at", "cves", "ai_used"):
        assert key in r
