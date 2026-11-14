"""Unit tests for the pkcert PDF-listing scraper (pure HTML parse)."""
from grc.modules.advisories.scrapers import parse_pkcert_listing, list_pdf_sources

_PK_HTML = """
<div class="card-2">
  <a href="https://pkcert.gov.pk/advisory/26/24.pdf" target="_blank"><i class="fa fa-arrow-right"></i> Advisory No 24: Multiple Security Vulnerabilities in Node.js Allow Remote Code Execution</a>
</div>
<div class="card-2">
  <a href="https://pkcert.gov.pk/advisory/26/23.pdf" target="_blank"><i class="fa fa-arrow-right"></i> Advisory No 23: Microsoft Patch Tuesday</a>
</div>
<a href="https://pkcert.gov.pk/d/RFC2350.pdf">RFC2350</a>
"""


def test_parse_pkcert_listing_extracts_targets():
    targets = parse_pkcert_listing(_PK_HTML)
    assert len(targets) == 2  # the non-advisory RFC2350 PDF is ignored
    t = targets[0]
    assert t.url == "https://pkcert.gov.pk/advisory/26/24.pdf"
    assert t.external_id == "pkcert/26/24"
    assert "Node.js" in t.title
    assert t.region == "Pakistan"


def test_parse_pkcert_listing_dedups_by_url():
    assert len(parse_pkcert_listing(_PK_HTML + _PK_HTML)) == 2


def test_list_pdf_sources_covers_pakistan_and_middle_east():
    srcs = list_pdf_sources()
    assert {"Pakistan", "Middle East"} <= {s["region"] for s in srcs}
    pk = next(s for s in srcs if s["key"] == "pkcert")
    assert pk["auto"] is True  # pkcert has a wired scraper
    pta = next(s for s in srcs if s["key"] == "pta")
    assert pta["auto"] is False  # upload-only for now
