"""Breach and adverse-media alerts from news coverage, and the checks each passes
before it counts.

The research source is the GDELT Project's article search, which is free and
open for any use, commercial included, with attribution. It is queried only when
a tenant turns adverse-media monitoring on, and only with the vendor's name.

Four checks, in order:
  1. Rejection memory — an article someone ruled out for this vendor is never raised again.
  2. Source structure — a real http(s) link, a headline, a publisher and a date.
  3. Entity in headline — the headline itself names the vendor.
  4. Corroboration — at least two different publishers report the same event.
An article failing any of the first three is dropped. Articles that pass are
grouped into events; an event only one publisher has reported is kept as an
unverified alert — shown, but never emailed and never reopening an assessment.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional


PROVIDER = "GDELT news"
GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
# GDELT asks for no more than one request every five seconds; it answers 429 otherwise.
SPACING_SECONDS = 6
_last_call = [0.0]
_spacing = threading.Lock()
_TERMS: Dict[str, List[str]] = {
    "breach": ["breach", "ransomware", "hacked", "cyberattack", "cyber attack", "data leak", "leaked",
               "compromised", "stolen data"],
    "financial": ["bankruptcy", "insolvency", "chapter 11", "liquidation", "receivership"],
    "adverse_media": ["outage", "fined", "lawsuit", "sued", "sanctions", "investigation", "fraud"],
}
_STOP = {"the", "and", "for", "with", "from", "after", "over", "into", "says", "said", "that", "this", "have",
         "has", "its", "their", "about", "amid", "what", "more", "than", "were", "will", "been", "new"}
SAME_EVENT_DAYS = 3
# Words that make a company name formal rather than distinctive; headlines drop them.
_GENERIC = {"inc", "ltd", "llc", "limited", "corp", "corporation", "plc", "gmbh", "co", "company", "sa", "ag",
            "bv", "group", "holdings", "services", "service", "solutions", "technologies", "technology",
            "systems", "software", "global", "international", "the"}


def core_name(vendor_name: str) -> str:
    """The distinctive part of a company name, as a headline would print it:
    "Acme Cloud Services Ltd (UK)" is "acme cloud"."""
    text = re.sub(r"\(.*?\)", " ", (vendor_name or "").lower())
    words = [w for w in re.split(r"[^a-z0-9]+", text) if w]
    core = [w for w in words if w not in _GENERIC]
    return " ".join(core or words)


def names_vendor(headline: str, vendor_name: str) -> bool:
    """Check 3: the headline itself names the vendor, by its distinctive name."""
    wanted = core_name(vendor_name)
    words = " ".join(w for w in re.split(r"[^a-z0-9]+", (headline or "").lower()) if w)
    return bool(wanted) and f" {wanted} " in f" {words} "


def fingerprint(url: str) -> str:
    return hashlib.sha256((url or "").strip().encode("utf-8", "ignore")).hexdigest()


def query_for(vendor_name: str) -> str:
    terms = [t for words in _TERMS.values() for t in words]
    quoted = " OR ".join(f'"{t}"' if " " in t else t for t in terms)
    return f'"{core_name(vendor_name)}" ({quoted})'


def fetch_gdelt(query: str, start: datetime, end: datetime) -> List[dict]:
    """Articles matching the query between two times. Network errors propagate:
    the connector records the failure and tries the vendor again next run."""
    params = urllib.parse.urlencode({
        "query": query, "mode": "artlist", "format": "json", "maxrecords": "75", "sort": "datedesc",
        "startdatetime": start.strftime("%Y%m%d%H%M%S"), "enddatetime": end.strftime("%Y%m%d%H%M%S"),
    })
    request = urllib.request.Request(f"{GDELT_URL}?{params}", headers={"User-Agent": "Complyverse-TPRM/1.0"})
    with _spacing:                                   # one request at a time, spaced as GDELT asks
        wait = SPACING_SECONDS - (time.monotonic() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:   # noqa: S310 — fixed https host
                body = response.read().decode("utf-8", "replace").strip()
        finally:
            _last_call[0] = time.monotonic()
    return (json.loads(body) if body.startswith("{") else {}).get("articles") or []


def _published(value) -> Optional[datetime]:
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%SZ", "%Y%m%d%H%M%S"):
        try:
            return datetime.strptime(str(value), fmt)
        except (TypeError, ValueError):
            continue
    return None


def well_formed(article: dict) -> Optional[dict]:
    """Check 2: the article as a source, or None when it is not a usable one."""
    url = str(article.get("url") or "").strip()
    title = " ".join(str(article.get("title") or "").split())
    domain = str(article.get("domain") or urllib.parse.urlparse(url).netloc or "").lower()
    published = _published(article.get("seendate"))
    if not url.startswith(("https://", "http://")) or len(title) < 15 or not domain or published is None:
        return None
    return {"url": url, "title": title[:300], "domain": domain, "published": published.isoformat()}


def classify(text: str) -> tuple:
    lowered = text.lower()
    if any(t in lowered for t in _TERMS["breach"]):
        return "breach", "high"
    if any(t in lowered for t in _TERMS["financial"]):
        return "financial", "high"
    return "adverse_media", "medium"


def _words(title: str, vendor_name: str) -> set:
    vendor = set(re.split(r"[^a-z0-9]+", vendor_name.lower()))
    return {w for w in re.split(r"[^a-z0-9]+", title.lower()) if len(w) > 3 and w not in _STOP and w not in vendor}


def events(articles: List[dict], vendor_name: str) -> List[List[dict]]:
    """Group reports of the same event: close in time, and headlines sharing words.

    ponytail: headline-overlap grouping; a model or embeddings would group
    differently worded reports of one incident better."""
    groups: List[List[dict]] = []
    for article in sorted(articles, key=lambda a: a["published"]):
        words = _words(article["title"], vendor_name)
        when = datetime.fromisoformat(article["published"])
        for group in groups:
            first = group[0]
            close = when - datetime.fromisoformat(first["published"]) <= timedelta(days=SAME_EVENT_DAYS)
            theirs = set().union(*(_words(a["title"], vendor_name) for a in group))
            overlap = len(words & theirs) / max(1, min(len(words), len(theirs)))
            if close and overlap >= 0.3:
                group.append(article)
                break
        else:
            groups.append([article])
    return groups


def drafts(vendor_name: str, raw: List[dict], rejected_fingerprints: set) -> List[dict]:
    """The signals a batch of articles supports, each with its sources and verdict."""
    kept = []
    for article in raw:
        source = well_formed(article)                                      # check 2
        if source is None or fingerprint(source["url"]) in rejected_fingerprints:   # check 1
            continue
        if not names_vendor(source["title"], vendor_name):                # check 3
            continue
        kept.append(source)
    out = []
    for group in events(kept, vendor_name):
        publishers = sorted({a["domain"] for a in group})
        corroborated = len(publishers) >= 2                               # check 4
        lead = group[0]
        signal_type, severity = classify(" ".join(a["title"] for a in group))
        out.append({
            "signal_type": signal_type, "severity": severity, "title": lead["title"],
            "detail": f"Reported by {', '.join(publishers)}.",
            "occurred_at": datetime.fromisoformat(lead["published"]),
            "external_id": fingerprint(lead["url"]), "sources": group,
            "verification": {
                "verified": corroborated,
                "checks": {"rejection_memory": "passed", "source_structure": "passed",
                           "entity_in_headline": "passed",
                           "corroboration": f"{len(publishers)} publisher{'s' if len(publishers) != 1 else ''}"},
                "reason": None if corroborated else "Only one publisher has reported this so far",
            },
        })
    return out


def research(vendor_name: str, since: Optional[datetime], now: datetime, rejected_fingerprints: set,
             fetch: Callable[[str, datetime, datetime], List[dict]] = fetch_gdelt) -> List[dict]:
    """News about the vendor since the last look, reaching back three days more so
    a second publisher can corroborate an event first seen last time."""
    start = max((since or now - timedelta(days=30)) - timedelta(days=SAME_EVENT_DAYS), now - timedelta(days=89))
    return drafts(vendor_name, fetch(query_for(vendor_name), start, now), rejected_fingerprints)
