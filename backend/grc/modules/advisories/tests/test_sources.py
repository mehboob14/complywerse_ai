"""Unit tests for advisory source normalisation (the pure, network-free half)."""
from grc.modules.advisories.sources import (
    kev_entry_to_draft,
    github_entry_to_draft,
    redhat_entry_to_draft,
    nvd_item_to_draft,
    parse_rss_items,
    rss_text_to_drafts,
    list_sources,
)


def test_kev_entry_to_draft():
    d = kev_entry_to_draft({
        "cveID": "CVE-2021-44228",
        "vulnerabilityName": "Apache Log4j2 RCE",
        "product": "Log4j2",
        "shortDescription": "Remote code execution.",
        "dateAdded": "2021-12-10",
    })
    assert d is not None
    assert d.external_id == "CVE-2021-44228"
    assert d.severity == "critical"  # KEV = actively exploited
    assert d.cves == [{"cve_id": "CVE-2021-44228", "product": "Log4j2", "versions": None}]
    assert d.published_at is not None


def test_kev_skips_non_cve():
    assert kev_entry_to_draft({"cveID": ""}) is None
    assert kev_entry_to_draft({"cveID": "not-a-cve"}) is None


def test_github_entry_to_draft():
    d = github_entry_to_draft({
        "ghsa_id": "GHSA-abcd-1234-wxyz",
        "cve_id": "cve-2022-1234",
        "summary": "Prototype pollution",
        "severity": "high",
        "html_url": "https://github.com/advisories/GHSA-abcd-1234-wxyz",
        "vulnerabilities": [{"package": {"name": "left-pad", "ecosystem": "npm"},
                             "vulnerable_version_range": "< 1.3.0"}],
    })
    assert d is not None
    assert d.external_id == "GHSA-abcd-1234-wxyz"
    assert d.severity == "high"
    assert d.cves == [{"cve_id": "CVE-2022-1234", "product": "left-pad", "versions": "< 1.3.0"}]


def test_github_skips_without_cve():
    assert github_entry_to_draft({"ghsa_id": "GHSA-x", "cve_id": None}) is None


def test_redhat_entry_to_draft():
    d = redhat_entry_to_draft({
        "CVE": "CVE-2024-1234",
        "severity": "important",
        "public_date": "2024-03-01T00:00:00Z",
        "affected_packages": ["php-8.0.1-1.el8"],
        "bugzilla_description": "Heap overflow in php",
    })
    assert d is not None
    assert d.external_id == "CVE-2024-1234"
    assert d.severity == "high"  # Red Hat "important" -> our "high"
    assert d.cves == [{"cve_id": "CVE-2024-1234", "product": "php", "versions": None}]


def test_redhat_skips_non_cve():
    assert redhat_entry_to_draft({"CVE": "RHSA-2024:0001"}) is None


def test_nvd_item_to_draft():
    d = nvd_item_to_draft({"cve": {
        "id": "CVE-2025-9999",
        "published": "2025-01-15T10:00:00.000",
        "descriptions": [{"lang": "en", "value": "Example flaw"}],
        "metrics": {"cvssMetricV31": [{"cvssData": {"baseSeverity": "HIGH"}}]},
    }})
    assert d is not None
    assert d.external_id == "CVE-2025-9999"
    assert d.title == "Example flaw"
    assert d.severity == "high"
    assert d.cves == [{"cve_id": "CVE-2025-9999", "product": None, "versions": None}]


def test_parse_rss_items_returns_all_items():
    xml = ("<rss><channel>"
           "<item><title>CVE-2023-0001 in Foo</title><link>http://x/1</link></item>"
           "<item><title>No cve here</title><link>http://x/2</link></item>"
           "</channel></rss>")
    items = parse_rss_items(xml)
    assert len(items) == 2  # unlike rss_text_to_drafts, this keeps every item
    assert items[0]["link"] == "http://x/1"


def test_rss_keeps_only_cve_items():
    xml = """<rss><channel>
      <item><title>Advisory: CVE-2023-0001 in Foo</title><link>http://x/1</link></item>
      <item><title>CISA releases guidance</title><link>http://x/2</link></item>
    </channel></rss>"""
    drafts = rss_text_to_drafts(xml, "http://x")
    assert len(drafts) == 1  # the no-CVE item is dropped (PDF/page parser handles those)
    assert drafts[0].cves == [{"cve_id": "CVE-2023-0001", "product": None, "versions": None}]


def test_list_sources_has_core_and_region():
    srcs = list_sources()
    keys = {s["key"] for s in srcs}
    assert {"cisa_kev", "github", "redhat", "nvd_recent", "cisa_all", "cert_eu"} <= keys
    assert all("region" in s for s in srcs)
