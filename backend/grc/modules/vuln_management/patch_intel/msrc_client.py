"""MSRC (Microsoft Security Response Center) lookup with optional Redis cache.

Given a CVE ID, returns the KB articles, vendor advisory IDs, and verbatim
remediation text Microsoft publishes for it. Returns None when Microsoft
doesn't recognise the CVE (i.e. it's not a Microsoft product).

Cache strategy:
  * Redis key `msrc:{cve_id}` with 7-day TTL — KB → CVE mappings are
    immutable post-publication, so a long TTL is safe.
  * On Redis miss: hit the API directly. No API key required.
  * On any failure (timeout, 4xx, 5xx, parse error): returns None. Caller
    decides what to do with a missing result; never raises.

MSRC has no published rate limit but is shared infrastructure — the cache
keeps us polite, and the per-vuln dedup means a tenant with N vulns hits the
service at most N times per week.

Defensive parsing: MSRC's JSON shape has evolved over the years. Rather than
binding to specific field paths (which break when MSRC ships v3 / v4 / v5),
we (a) try the well-known fields first, then (b) fall back to regex
extraction of `KB\\d{6,8}` and `support.microsoft.com` URLs across the entire
serialised response. That keeps the connector working through schema drift.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import requests

from ....config import REDIS_URL

logger = logging.getLogger(__name__)

MSRC_CVE_URL_TEMPLATE = "https://api.msrc.microsoft.com/sug/v2.0/en-US/cve/{cve_id}"
MSRC_TIMEOUT_SECONDS = 10
MSRC_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days

# KB articles are referenced as "KB5009543" (typically 7 digits, sometimes 6-8).
_KB_PATTERN = re.compile(r"\bKB\d{6,8}\b", re.IGNORECASE)
# Microsoft advisory IDs look like "ADV200005" or "ADV-2024-12-001".
_ADVISORY_PATTERN = re.compile(r"\bADV[-_]?\d{4,10}\b", re.IGNORECASE)
# Support article URL pattern. Microsoft links KB articles via support.microsoft.com.
_KB_URL_PATTERN = re.compile(
    r"https?://(?:support|learn|msrc)\.microsoft\.com/[^\s\"'<>)]+",
    re.IGNORECASE,
)


@dataclass
class PatchReference:
    """One item in `Vulnerability.patch_references`. The shape mirrors what
    Red Hat / Cisco connectors will produce, so the JSON column is uniform
    across PSIRTs."""
    source: str          # "msrc", "rhsa", "cisco_psirt", ...
    id: str              # "KB5009543", "RHSA-2021:5106", "cisco-sa-..."
    url: str             # canonical link to the advisory
    type: str            # "kb", "advisory", "patch_url"

    def to_dict(self) -> Dict[str, str]:
        return {"source": self.source, "id": self.id, "url": self.url, "type": self.type}


@dataclass
class MsrcResult:
    cve_id: str
    found: bool = False
    kb_articles: List[PatchReference] = field(default_factory=list)
    advisory_ids: List[str] = field(default_factory=list)
    remediation_text: Optional[str] = None

    def patch_references_as_dicts(self) -> List[Dict[str, str]]:
        return [ref.to_dict() for ref in self.kb_articles]


def _redis_client():
    """Return a redis client or None. Imported lazily so the rest of the
    module loads cleanly when redis isn't available (tests, local dev).
    """
    try:
        import redis  # type: ignore
    except Exception:
        return None
    url = REDIS_URL
    try:
        return redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _from_cache(redis_client, cve_id: str) -> Optional[MsrcResult]:
    if redis_client is None:
        return None
    try:
        raw = redis_client.get(f"msrc:{cve_id}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    return MsrcResult(
        cve_id=payload.get("cve_id") or cve_id,
        found=bool(payload.get("found")),
        kb_articles=[
            PatchReference(**ref) for ref in (payload.get("kb_articles") or [])
            if isinstance(ref, dict) and ref.get("source")
        ],
        advisory_ids=list(payload.get("advisory_ids") or []),
        remediation_text=payload.get("remediation_text"),
    )


def _to_cache(redis_client, result: MsrcResult) -> None:
    if redis_client is None:
        return
    try:
        payload = {
            "cve_id": result.cve_id,
            "found": result.found,
            "kb_articles": result.patch_references_as_dicts(),
            "advisory_ids": result.advisory_ids,
            "remediation_text": result.remediation_text,
        }
        redis_client.set(
            f"msrc:{result.cve_id}",
            json.dumps(payload),
            ex=MSRC_CACHE_TTL_SECONDS,
        )
    except Exception:
        logger.debug("MSRC cache write failed for %s", result.cve_id, exc_info=False)


def _extract_remediation_text(raw: Dict[str, Any]) -> Optional[str]:
    """Try the well-known JSON paths first; if MSRC has changed its schema
    we still capture *something* by falling back to whichever string field
    is longest."""
    # Path 1: top-level `remediations` array with `description` strings.
    rems = raw.get("remediations") or []
    if isinstance(rems, list) and rems:
        for entry in rems:
            if isinstance(entry, dict):
                txt = (entry.get("description") or "").strip()
                if txt:
                    return txt[:4000]  # cap so we don't bloat the DB row

    # Path 2: `description` field — sometimes a string, sometimes [{lang,value}].
    desc = raw.get("description")
    if isinstance(desc, str) and desc.strip():
        return desc.strip()[:4000]
    if isinstance(desc, list):
        for entry in desc:
            if isinstance(entry, dict) and (entry.get("lang") or "").lower().startswith("en"):
                val = (entry.get("value") or "").strip()
                if val:
                    return val[:4000]

    # Path 3: `cveTitle` as a last-ditch human-readable label.
    title = raw.get("cveTitle")
    if isinstance(title, str) and title.strip():
        return title.strip()[:4000]

    return None


def _extract_patch_references(raw_text: str, cve_id: str) -> List[PatchReference]:
    """Regex-based extraction from the whole serialised response. Survives
    MSRC schema changes because it doesn't bind to specific field paths."""
    # De-duplicate while preserving discovery order.
    seen_ids: set = set()
    refs: List[PatchReference] = []

    # KB IDs first — these are the most useful for the operator.
    for match in _KB_PATTERN.finditer(raw_text):
        kb_id = match.group(0).upper()
        if kb_id in seen_ids:
            continue
        seen_ids.add(kb_id)
        refs.append(PatchReference(
            source="msrc",
            id=kb_id,
            # Microsoft's canonical KB URL pattern. Works for all numeric KB IDs.
            url=f"https://support.microsoft.com/help/{kb_id[2:]}",
            type="kb",
        ))
        if len(refs) >= 20:
            break

    # Also capture full support URLs that weren't matched as `KBxxxxx` (e.g.
    # links to topic pages rather than KB articles). De-duped by URL.
    seen_urls: set = set()
    for match in _KB_URL_PATTERN.finditer(raw_text):
        url = match.group(0).rstrip(".,);")
        if url in seen_urls:
            continue
        seen_urls.add(url)
        # Skip URLs we already represented as KB entries.
        if any(ref.url == url for ref in refs):
            continue
        refs.append(PatchReference(
            source="msrc",
            id=url.split("/")[-1] or "msrc-link",
            url=url,
            type="patch_url",
        ))
        if len(refs) >= 25:
            break

    return refs


def _extract_advisory_ids(raw_text: str) -> List[str]:
    """Extract Microsoft advisory IDs (e.g. ADV200005) from the response."""
    seen: set = set()
    ids: List[str] = []
    for match in _ADVISORY_PATTERN.finditer(raw_text):
        adv = match.group(0).upper().replace("_", "")
        if adv in seen:
            continue
        seen.add(adv)
        ids.append(adv)
        if len(ids) >= 10:
            break
    return ids


def fetch_msrc(cve_id: str) -> Optional[MsrcResult]:
    """Look up a CVE in MSRC. Returns:
        * `MsrcResult(found=True, ...)` — Microsoft recognises this CVE.
        * `MsrcResult(found=False, ...)` — explicit not-found from MSRC.
        * `None` — transient failure (network / 5xx / parse).

    Callers should treat the third case as "try again later", and the second
    as a stable "not a Microsoft CVE" signal.
    """
    if not cve_id or not cve_id.upper().startswith("CVE-"):
        return None
    cve_id = cve_id.upper().strip()

    redis_client = _redis_client()
    cached = _from_cache(redis_client, cve_id)
    if cached is not None:
        return cached

    url = MSRC_CVE_URL_TEMPLATE.format(cve_id=cve_id)
    headers = {
        "User-Agent": "complywerse-patch-intel/1.0",
        "Accept": "application/json",
    }

    try:
        response = requests.get(url, headers=headers, timeout=MSRC_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.info("MSRC lookup network error for %s: %s", cve_id, exc)
        return None

    if response.status_code == 404:
        # Stable "not a Microsoft CVE" — cache the negative so we don't
        # re-pound MSRC every refresh for the same non-MSFT CVEs.
        result = MsrcResult(cve_id=cve_id, found=False)
        _to_cache(redis_client, result)
        return result

    if response.status_code != 200:
        logger.info("MSRC lookup non-200 for %s: %s", cve_id, response.status_code)
        return None

    raw_text = response.text or ""
    try:
        raw = response.json()
    except Exception:
        logger.info("MSRC lookup invalid JSON for %s", cve_id)
        return None

    if not isinstance(raw, dict):
        return None

    kb_refs = _extract_patch_references(raw_text, cve_id)
    advisory_ids = _extract_advisory_ids(raw_text)
    remediation = _extract_remediation_text(raw)

    # If nothing useful came back even from a 200 — treat as a soft "not
    # really known" but cache it so we don't retry endlessly.
    found = bool(kb_refs or advisory_ids or remediation)
    result = MsrcResult(
        cve_id=cve_id,
        found=found,
        kb_articles=kb_refs,
        advisory_ids=advisory_ids,
        remediation_text=remediation,
    )
    _to_cache(redis_client, result)
    return result
