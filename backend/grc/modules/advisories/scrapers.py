"""PDF-advisory scrapers — the ingestion side of the PDF flow.

Separate from ``sources.py`` on purpose: ``sources.py`` pulls *structured* feeds
(JSON/RSS) where the CVEs are already machine-readable; here the payload is a PDF
whose CVEs only exist inside the document, so a scraper's job is just to enumerate
the PDF URLs + their listing titles. Each URL is then downloaded and run through
the one extraction core (``extraction.py``) by ``ingest.py``.

Pakistan NCERT (pkcert.gov.pk) publishes at the stable path
``/advisory/{YY}/{N}.pdf`` with the headline in the listing anchor text, so it has
a real scraper. Other regional CERTs (PTA, and the Middle East CERTs) are
registered with their region so the UI shows coverage; their documents come in via
upload for now (same parser, with a region hint) until a per-site scraper is added.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 25
_UA = {"User-Agent": "complyverse-advisory-sync/1.0"}


@dataclass
class PdfTarget:
    url: str
    title: str
    external_id: str          # stable per-document id for de-dup on re-scrape
    source_name: str
    region: str
    source_hint: str          # passed to the extractor so it knows the format


# ── Pakistan NCERT (pkcert.gov.pk) ──────────────────────────────────────────

_PKCERT_LISTING = "https://pkcert.gov.pk/advisories.asp"
_PKCERT_NAME = "Pakistan NCERT (pkcert)"
# <a href=".../advisory/26/24.pdf" ...><i ...></i> Advisory No 24: ... </a>
_PKCERT_LINK_RE = re.compile(
    r'href="(https://pkcert\.gov\.pk/advisory/(\d+)/(\d+)\.pdf)"[^>]*>'
    r'\s*(?:<i[^>]*>\s*</i>)?\s*([^<]+?)\s*</a>',
    re.IGNORECASE,
)


def parse_pkcert_listing(html: str) -> List[PdfTarget]:
    """Pure HTML→targets parse (unit-testable). Distinct by PDF url, in order."""
    out: List[PdfTarget] = []
    seen: set = set()
    for url, yy, seq, title in _PKCERT_LINK_RE.findall(html or ""):
        if url in seen:
            continue
        seen.add(url)
        out.append(PdfTarget(
            url=url,
            title=" ".join(title.split()) or f"pkcert advisory {yy}/{seq}",
            external_id=f"pkcert/{yy}/{seq}",
            source_name=_PKCERT_NAME,
            region="Pakistan",
            source_hint="Pakistan NCERT (pkcert.gov.pk)",
        ))
    return out


def scrape_pkcert(limit: int = 25) -> List[PdfTarget]:
    """Fetch the pkcert listing and return the newest advisory PDF targets.
    Raises on a hard fetch failure so the caller can report it (not silent)."""
    resp = requests.get(_PKCERT_LISTING, headers=_UA, timeout=_TIMEOUT)
    resp.raise_for_status()
    return parse_pkcert_listing(resp.text)[: max(limit, 1)]


# ── Registry ────────────────────────────────────────────────────────────────
# auto=True → a scraper is wired; auto=False → PDF source known, use upload for
# now (the parser still handles it via the region hint).

PDF_SOURCE_REGISTRY: Dict[str, Dict] = {
    "pkcert": {"name": _PKCERT_NAME, "region": "Pakistan", "scrape": scrape_pkcert},
    "pta":    {"name": "Pakistan PTA / ntCERT", "region": "Pakistan", "scrape": None},
    "sa_nca": {"name": "Saudi Arabia NCA / HISN", "region": "Middle East", "scrape": None},
    "ae_cert": {"name": "UAE Cyber Security Council / aeCERT", "region": "Middle East", "scrape": None},
    "qa_cert": {"name": "Qatar National CERT (Q-CERT)", "region": "Middle East", "scrape": None},
    "om_cert": {"name": "Oman National CERT (OCERT)", "region": "Middle East", "scrape": None},
    "bh_cert": {"name": "Bahrain National CSIRT", "region": "Middle East", "scrape": None},
}


def list_pdf_sources() -> List[Dict]:
    return [
        {"key": k, "name": v["name"], "region": v["region"], "auto": v["scrape"] is not None}
        for k, v in PDF_SOURCE_REGISTRY.items()
    ]


def get_scraper(key: str) -> Optional[Callable[[int], List[PdfTarget]]]:
    src = PDF_SOURCE_REGISTRY.get(key)
    return src["scrape"] if src else None


def source_hint_for(key: str) -> str:
    src = PDF_SOURCE_REGISTRY.get(key) or {}
    return src.get("name", "")
