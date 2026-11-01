"""Advisory API sources (Sprint 5).

Pulls advisories from machine-readable feeds and normalises them into a common
``AdvisoryDraft`` the sync step upserts. Fetchers are auth-free and best-effort
(return [] on any failure); the normalise helpers are pure and unit-tested.

Implemented now (all auth-free; APIs are structured, RSS keeps CVE-bearing items):
  * cisa_kev   — CISA Known Exploited Vulnerabilities catalogue (US; actively
    exploited → treated as critical). One advisory per KEV CVE.
  * cisa_all   — CISA Cybersecurity Advisories RSS (US).
  * github     — GitHub global advisory database REST / GHSA (Global).
  * nvd_recent — NVD recent-CVE window (Global); product/versions are filled by
    the applicability matcher's own NVD pull, not duplicated here.
  * redhat     — Red Hat Security Data API (Global, public — NOT the
    subscription API; CVE data needs no token).
  * cert_eu    — CERT-EU advisories RSS (EU).

On hold (need a token/key the owner will supply): Cisco openVuln, Microsoft MSRC.
Region CERTs that publish PDF-only (Pakistan pkcert/PTA, Saudi NCA, UAE, Qatar,
Oman, Bahrain) ride the PDF upload/scrape + extraction path, not this registry.
"""
from __future__ import annotations

import logging
import os
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, List, Optional

import requests

from .extraction import find_cves

logger = logging.getLogger(__name__)

_TIMEOUT = 20
_UA = {"User-Agent": "complyverse-advisory-sync/1.0"}
_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
_GITHUB_URL = "https://api.github.com/advisories"
_REDHAT_URL = "https://access.redhat.com/hydra/rest/securitydata/cve.json"
_NVD_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"


@dataclass
class AdvisoryDraft:
    external_id: str
    title: str
    summary: Optional[str] = None
    severity: Optional[str] = None
    url: Optional[str] = None
    published_at: Optional[datetime] = None
    cves: List[Dict[str, Any]] = field(default_factory=list)  # {cve_id, product, versions}


def _parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            return datetime.strptime(value, fmt)
        except (ValueError, TypeError):
            continue
    return None


def _parse_rss_date(value: Optional[str]) -> Optional[datetime]:
    """RSS <pubDate> is RFC-822 (e.g. 'Tue, 20 Oct 2026 12:00:00 GMT'). Return it
    as a naive-UTC datetime (the published_at column is naive), or None."""
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return _parse_date(value)
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


# ── CISA KEV ──────────────────────────────────────────────────────────────

def kev_entry_to_draft(entry: Dict[str, Any]) -> Optional[AdvisoryDraft]:
    cve = str(entry.get("cveID") or "").strip().upper()
    if not cve.startswith("CVE-"):
        return None
    product = entry.get("product") or None
    return AdvisoryDraft(
        external_id=cve,
        title=entry.get("vulnerabilityName") or cve,
        summary=entry.get("shortDescription"),
        severity="critical",  # KEV = confirmed exploited in the wild
        url="https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
        published_at=_parse_date(entry.get("dateAdded")),
        cves=[{"cve_id": cve, "product": product, "versions": None}],
    )


def fetch_cisa_kev(limit: int = 50) -> List[AdvisoryDraft]:
    # The FULL KEV catalogue — every entry across all years (2021 → present), so
    # the year hierarchy is populated end-to-end. `limit` is ignored: a re-sync
    # re-pulls the whole catalogue, picking up newly-added CVEs (future years
    # included) automatically. Published date comes from each entry's dateAdded.
    resp = requests.get(_KEV_URL, headers=_UA, timeout=_TIMEOUT)
    resp.raise_for_status()
    vulns = resp.json().get("vulnerabilities") or []
    return [d for d in (kev_entry_to_draft(v) for v in vulns) if d]


# ── GitHub advisory database (GHSA) ─────────────────────────────────────────

def github_entry_to_draft(entry: Dict[str, Any]) -> Optional[AdvisoryDraft]:
    cve = str(entry.get("cve_id") or "").strip().upper()
    if not cve.startswith("CVE-"):
        return None  # CVE-bearing entries only — matching is CVE-based
    product = None
    versions = None
    vulns = entry.get("vulnerabilities") or []
    if vulns and isinstance(vulns[0], dict):
        pkg = vulns[0].get("package") or {}
        product = pkg.get("name") or None
        versions = vulns[0].get("vulnerable_version_range") or None
    return AdvisoryDraft(
        external_id=str(entry.get("ghsa_id") or cve),
        title=entry.get("summary") or cve,
        summary=entry.get("description"),
        severity=(entry.get("severity") or None),
        url=entry.get("html_url"),
        published_at=_parse_date(entry.get("published_at")),
        cves=[{"cve_id": cve, "product": product, "versions": versions}],
    )


def fetch_github_advisories(limit: int = 50) -> List[AdvisoryDraft]:
    resp = requests.get(
        _GITHUB_URL,
        params={"per_page": min(max(limit, 1), 100)},
        headers={"Accept": "application/vnd.github+json", **_UA},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    entries = resp.json() or []
    return [d for d in (github_entry_to_draft(e) for e in entries) if d]


# ── Red Hat Security Data API (free, public, no token) ──────────────────────
# NB: the subscription-management API (offline token) is a different service;
# CVE/advisory data is this public endpoint and needs no auth.
_REDHAT_SEV = {"critical": "critical", "important": "high", "moderate": "medium", "low": "low"}


def redhat_entry_to_draft(entry: Dict[str, Any]) -> Optional[AdvisoryDraft]:
    cve = str(entry.get("CVE") or "").strip().upper()
    if not cve.startswith("CVE-"):
        return None
    pkgs = entry.get("affected_packages") or []
    product = re.split(r"[-:]", str(pkgs[0]))[0] or None if pkgs else None
    return AdvisoryDraft(
        external_id=cve,
        title=cve,
        summary=entry.get("bugzilla_description") or None,
        severity=_REDHAT_SEV.get(str(entry.get("severity") or "").lower()),
        url=entry.get("resource_url") or f"https://access.redhat.com/security/cve/{cve.lower()}",
        published_at=_parse_date((entry.get("public_date") or "")[:10]),
        cves=[{"cve_id": cve, "product": product, "versions": None}],
    )


def fetch_redhat(limit: int = 50) -> List[AdvisoryDraft]:
    resp = requests.get(_REDHAT_URL, params={"per_page": min(max(limit, 1), 100)},
                        headers=_UA, timeout=_TIMEOUT)
    resp.raise_for_status()
    entries = resp.json() or []
    return [d for d in (redhat_entry_to_draft(e) for e in entries) if d]


# ── NVD recent CVEs (free; product/versions left to the matcher's own NVD pull)
def nvd_item_to_draft(item: Dict[str, Any]) -> Optional[AdvisoryDraft]:
    cve = item.get("cve") or {}
    cid = str(cve.get("id") or "").strip().upper()
    if not cid.startswith("CVE-"):
        return None
    descs = cve.get("descriptions") or []
    desc = next((d.get("value") for d in descs if d.get("lang") == "en"), None) or ""
    # NVD gives only a long description — use its first sentence as a readable
    # title and keep the full text as the summary (shown non-bold in the UI).
    first = desc.split(". ")[0].strip()
    title = (first[:140] if first else "") or cid
    sev = None
    metrics = cve.get("metrics") or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        arr = metrics.get(key) or []
        if arr:
            data = arr[0].get("cvssData") or {}
            sev = (data.get("baseSeverity") or arr[0].get("baseSeverity") or "").lower() or None
            break
    return AdvisoryDraft(
        external_id=cid,
        title=title,
        summary=desc or None,
        severity=sev,
        url=f"https://nvd.nist.gov/vuln/detail/{cid}",
        published_at=_parse_date((cve.get("published") or "")[:10]),
        cves=[{"cve_id": cid, "product": None, "versions": None}],
    )


def fetch_nvd_recent(limit: int = 50) -> List[AdvisoryDraft]:
    end = datetime.utcnow()
    start = end - timedelta(days=7)
    params = {
        "pubStartDate": start.strftime("%Y-%m-%dT00:00:00.000"),
        "pubEndDate": end.strftime("%Y-%m-%dT23:59:59.999"),
        "resultsPerPage": min(max(limit, 1), 100),
    }
    headers = dict(_UA)
    key = os.environ.get("NVD_API_KEY")  # optional, lifts the public rate limit
    if key:
        headers["apiKey"] = key
    resp = requests.get(_NVD_URL, params=params, headers=headers, timeout=_TIMEOUT)
    resp.raise_for_status()
    vulns = resp.json().get("vulnerabilities") or []
    return [d for d in (nvd_item_to_draft(v) for v in vulns) if d]


# ── Generic RSS (CERT advisory feeds) ───────────────────────────────────────
# CERT RSS items usually name the CVE only in the linked advisory page, not the
# feed item, so the fetcher follows the link when the item itself has no CVE.
_RSS_PAGE_FOLLOW_CAP = 20  # max item-pages fetched per sync (bounds latency)


def parse_rss_items(xml_text: str) -> List[Dict[str, str]]:
    """Pure XML→items parse (unit-testable): every <item>'s title/link/desc."""
    items: List[Dict[str, str]] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return items
    for item in root.iter("item"):
        items.append({
            "title": (item.findtext("title") or "").strip(),
            "link": (item.findtext("link") or "").strip(),
            "desc": item.findtext("description") or "",
            "pubDate": (item.findtext("pubDate") or item.findtext("pubdate") or "").strip(),
        })
    return items


def _item_to_draft(it: Dict[str, str], source_url: str, cves: List[str]) -> AdvisoryDraft:
    return AdvisoryDraft(
        external_id=(it["link"] or it["title"])[:160] or cves[0],
        title=it["title"] or cves[0],
        url=it["link"] or source_url,
        published_at=_parse_rss_date(it.get("pubDate")),
        cves=[{"cve_id": c, "product": None, "versions": None} for c in cves],
    )


def rss_text_to_drafts(xml_text: str, source_url: str) -> List[AdvisoryDraft]:
    """Drafts from the feed alone (inline CVEs only) — pure, no page fetches."""
    out: List[AdvisoryDraft] = []
    for it in parse_rss_items(xml_text):
        cves = find_cves(f"{it['title']} {it['desc']}")
        if cves:
            out.append(_item_to_draft(it, source_url, cves))
    return out


def _cves_from_page(url: str) -> List[str]:
    try:
        resp = requests.get(url, headers=_UA, timeout=_TIMEOUT)
        resp.raise_for_status()
        return find_cves(resp.text)
    except Exception:
        logger.info("advisory rss: item page fetch failed %s", url)
        return []


def _make_rss_fetcher(url: str) -> Callable[[int], List[AdvisoryDraft]]:
    def _fetch(limit: int = 50) -> List[AdvisoryDraft]:
        resp = requests.get(url, headers=_UA, timeout=_TIMEOUT)
        resp.raise_for_status()
        drafts: List[AdvisoryDraft] = []
        followed = 0
        for it in parse_rss_items(resp.text)[:limit]:
            cves = find_cves(f"{it['title']} {it['desc']}")
            if not cves and it["link"] and followed < _RSS_PAGE_FOLLOW_CAP:
                followed += 1
                cves = _cves_from_page(it["link"])
            if cves:
                drafts.append(_item_to_draft(it, url, cves))
        return drafts
    return _fetch


SOURCE_REGISTRY: Dict[str, Dict[str, Any]] = {
    "cisa_kev": {"name": "CISA Known Exploited Vulnerabilities", "region": "US",
                 "kind": "api", "fetch": fetch_cisa_kev},
    "cisa_all": {"name": "CISA Cybersecurity Advisories", "region": "US", "kind": "rss",
                 "fetch": _make_rss_fetcher("https://www.cisa.gov/cybersecurity-advisories/all.xml")},
    "github": {"name": "GitHub Advisory Database", "region": "Global",
               "kind": "api", "fetch": fetch_github_advisories},
    "nvd_recent": {"name": "NVD (recent CVEs)", "region": "Global",
                   "kind": "api", "fetch": fetch_nvd_recent},
    "redhat": {"name": "Red Hat Security Data", "region": "Global",
               "kind": "api", "fetch": fetch_redhat},
    "cert_eu": {"name": "CERT-EU Advisories", "region": "EU", "kind": "rss",
                "fetch": _make_rss_fetcher("https://cert.europa.eu/publications/security-advisories-rss")},
}


def list_sources() -> List[Dict[str, str]]:
    return [{"key": k, "name": v["name"], "region": v.get("region", "Global"), "kind": v["kind"]}
            for k, v in SOURCE_REGISTRY.items()]


def get_fetcher(key: str) -> Optional[Callable[[int], List[AdvisoryDraft]]]:
    src = SOURCE_REGISTRY.get(key)
    return src["fetch"] if src else None
