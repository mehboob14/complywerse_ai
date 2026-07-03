"""Per-tenant framework citation index.

Drafts must cite *only* frameworks the tenant has actually started a
`CertificationJourney` for. This module turns those journeys into a
topic-bucketed slice of `ParsedFrameworkControl` rows the pipeline can
hand to the LLM section-by-section.

The output is keyed by governance topic (access_control, password_policy,
incident_management, …) so a section about password rotation sees only
the relevant control clauses from the tenant's active frameworks — not
the full ~5,000-control catalogue.

Cached for 1h in Redis per (tenant_id, sorted_framework_ids) tuple so
repeated draft calls during a session don't re-classify the same rows.
Cache failure falls through to a live DB read — never raises.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from ....models import (
    CertificationJourney,
    Framework,
    ParsedFrameworkControl,
    UploadedFramework,
)
from ....tasks.base import get_redis

logger = logging.getLogger(__name__)


# ─── Topic taxonomy ──────────────────────────────────────────────────
# Section authors ask for clauses by *topic*. The classifier maps each
# parsed control into one or more of these buckets via keyword scoring.
# The taxonomy is intentionally coarse — finer matching happens inside
# the LLM call itself once it has the topic slice in hand.
TOPIC_KEYWORDS: Dict[str, List[str]] = {
    "governance_oversight": [
        "governance", "oversight", "board", "committee", "steering",
        "policy management", "management review", "accountability",
        "approval authority",
    ],
    "risk_management": [
        "risk assessment", "risk register", "risk treatment", "risk appetite",
        "risk tolerance", "residual risk", "risk mitigation", "risk methodology",
    ],
    "asset_management": [
        "asset inventory", "asset classification", "asset owner", "media handling",
        "asset disposal", "asset lifecycle", "information asset",
    ],
    "access_control": [
        "access control", "access management", "user access", "privileged access",
        "least privilege", "segregation of duties", "joiner mover leaver",
        "remote access", "session", "logical access",
    ],
    "password_policy": [
        "password", "credential", "passphrase", "authentication factor",
        "multi-factor", "mfa", "password history", "password complexity",
        "account lockout",
    ],
    "logging_monitoring": [
        "logging", "log review", "monitoring", "audit log", "siem", "security event",
        "detection", "alert", "telemetry", "anomaly",
    ],
    "incident_management": [
        "incident response", "incident management", "breach", "forensic",
        "incident escalation", "incident classification", "post-incident review",
    ],
    "business_continuity": [
        "business continuity", "disaster recovery", "bcp", "drp", "resilience",
        "recovery time", "recovery point", "rto", "rpo",
    ],
    "vulnerability_management": [
        "vulnerability", "patch management", "penetration test", "vulnerability scan",
        "remediation", "exploit", "hardening", "configuration baseline",
    ],
    "change_management": [
        "change management", "change advisory", "release management", "rollback",
        "deployment", "cab", "promotion",
    ],
    "third_party_management": [
        "third party", "vendor", "supplier", "outsourcing", "due diligence",
        "service provider", "contract", "sla",
    ],
    "data_protection": [
        "data protection", "privacy", "personal data", "data retention",
        "data classification", "encryption", "data disposal", "dlp",
        "confidentiality", "data subject",
    ],
    "secure_development": [
        "secure development", "sdlc", "secure coding", "code review",
        "application security", "devsecops", "static analysis", "dynamic analysis",
    ],
    "physical_security": [
        "physical access", "physical security", "perimeter", "visitor",
        "surveillance", "facility", "environmental controls",
    ],
    "awareness_training": [
        "awareness", "training", "education", "competence", "phishing simulation",
        "disciplinary",
    ],
    "cryptography": [
        "cryptography", "encryption", "key management", "certificate", "cipher",
        "tls", "ssl", "hashing", "signing",
    ],
    "network_security": [
        "network security", "firewall", "segmentation", "vpn", "intrusion",
        "ips", "ids", "ddos", "wireless",
    ],
    "exception_management": [
        "exception", "deviation", "risk acceptance", "waiver", "compensating control",
    ],
}


@dataclass
class FrameworkCitation:
    """A single citable control clause."""
    framework_code: str       # e.g. "ISO-27001", "PCI-DSS"
    framework_name: str       # e.g. "ISO/IEC 27001:2022"
    framework_version: Optional[str]
    control_ref: str          # e.g. "A.9.4.3" or "8.1.6"
    title: str
    excerpt: str              # truncated description for LLM prompt

    def as_prompt_line(self) -> str:
        """One-line citation the LLM should quote verbatim when relevant."""
        ver = f" {self.framework_version}" if self.framework_version else ""
        return f"[{self.framework_code}{ver}, clause {self.control_ref}] {self.title} — {self.excerpt}"


@dataclass
class FrameworkIndex:
    """Tenant-scoped citation pool indexed by topic."""

    tenant_id: int
    framework_summaries: List[dict] = field(default_factory=list)
    # Each: {"code": str, "name": str, "version": str|None, "regulator": str|None, "control_count": int}

    topics: Dict[str, List[FrameworkCitation]] = field(default_factory=dict)

    def active_framework_codes(self) -> List[str]:
        return [f["code"] for f in self.framework_summaries if f.get("code")]

    def slice(self, topic: str, limit: int = 8) -> List[FrameworkCitation]:
        """Return up to `limit` citations for the requested topic.

        Falls back to `governance_oversight` when the topic itself has no
        matches — so sections never get an empty citation pool.
        """
        hits = self.topics.get(topic) or []
        if not hits and topic != "governance_oversight":
            hits = self.topics.get("governance_oversight") or []
        return hits[:limit]

    def all_topics_with_hits(self) -> List[str]:
        return [t for t, citations in self.topics.items() if citations]

    def all_citations(self) -> List["FrameworkCitation"]:
        """Deduplicated flat list of every citation across all topics."""
        seen: set = set()
        out: List[FrameworkCitation] = []
        for citations in self.topics.values():
            for c in citations:
                key = (c.framework_code, c.control_ref)
                if key in seen:
                    continue
                seen.add(key)
                out.append(c)
        return out

    def known_clause_refs(self) -> Dict[str, set]:
        """Map framework_code → set of valid control_refs, for QA citation checks."""
        refs: Dict[str, set] = {}
        for c in self.all_citations():
            if c.control_ref:
                refs.setdefault(c.framework_code, set()).add(c.control_ref)
        return refs

    def slice_by_refs(self, refs: List[str], limit: int = 12) -> List["FrameworkCitation"]:
        """Return citations whose control_ref matches one of `refs` (order preserved).

        Used when the user pins specific clauses (`target_clauses`) so those
        exact clauses drive the citation slice rather than a topic bucket.
        """
        wanted = {re.sub(r"\s+", "", str(r)).lower() for r in (refs or []) if r}
        if not wanted:
            return []
        out: List[FrameworkCitation] = []
        for c in self.all_citations():
            if re.sub(r"\s+", "", str(c.control_ref)).lower() in wanted:
                out.append(c)
                if len(out) >= limit:
                    break
        return out


def _classify_topics(haystack: str) -> List[str]:
    """Score a control's text against the topic taxonomy. Returns ordered list."""
    if not haystack:
        return []
    haystack = haystack.lower()
    scored: List[tuple] = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        score = sum(1 for kw in keywords if kw in haystack)
        if score:
            scored.append((score, topic))
    scored.sort(reverse=True)
    return [t for _, t in scored]


def classify_topics(text: str) -> List[str]:
    """Public wrapper: classify free text (a focus area, a parent statement) into
    governance topics, most-relevant first. Empty when nothing matches."""
    return _classify_topics(text or "")


def resolve_area_to_topic(area: str) -> Optional[str]:
    """Resolve a user-supplied focus area to a topic key.

    Accepts an exact topic key (`access_control`) or free text ("password
    rotation") which is classified to its best topic. Returns None if nothing
    matches — the caller then falls back to the section's own topic.
    """
    if not area:
        return None
    key = area.strip().lower().replace(" ", "_").replace("-", "_")
    if key in TOPIC_KEYWORDS:
        return key
    topics = _classify_topics(area)
    return topics[0] if topics else None


def _resolve_framework_meta(journey: CertificationJourney, db: Session) -> Optional[dict]:
    """Pull display name / code / version off whichever framework the journey points at."""
    fw = journey.framework
    if fw is not None:
        return {
            "code": fw.short_code or fw.name,
            "name": fw.name,
            "version": fw.version,
            "regulator": fw.regulator,
            "uploaded_framework_id": None,
            "framework_id": fw.id,
        }
    uf = journey.uploaded_framework
    if uf is not None:
        return _meta_from_uploaded(uf)
    return None


def _meta_from_uploaded(uf: UploadedFramework) -> dict:
    """Framework display meta from an UploadedFramework row directly (used when the
    draft modal selects specific frameworks, bypassing the journey indirection)."""
    code = (uf.source_organization or uf.regulatory_authority or uf.name or "UNKNOWN")
    return {
        "code": code,
        "name": uf.name,
        "version": uf.version,
        "regulator": uf.regulatory_authority or uf.certification_body,
        "uploaded_framework_id": uf.id,
        "framework_id": None,
    }


def _index_framework_controls(idx: "FrameworkIndex", meta: dict, controls: list) -> None:
    """Classify a framework's controls into the index's topic buckets."""
    idx.framework_summaries.append({
        "code": meta["code"],
        "name": meta["name"],
        "version": meta["version"],
        "regulator": meta["regulator"],
        "control_count": len(controls),
    })
    for ctrl in controls:
        text_bits = [ctrl.title, ctrl.description, ctrl.full_text, ctrl.parent_section, ctrl.domain]
        haystack = " ".join(b for b in text_bits if b)
        topics = _classify_topics(haystack) or ["governance_oversight"]
        ref = ctrl.original_reference or ctrl.control_id
        excerpt = (ctrl.description or ctrl.full_text or "").strip()
        if len(excerpt) > 220:
            excerpt = excerpt[:220].rsplit(" ", 1)[0] + "…"
        citation = FrameworkCitation(
            framework_code=meta["code"],
            framework_name=meta["name"],
            framework_version=meta["version"],
            control_ref=ref,
            title=ctrl.title or "",
            excerpt=excerpt,
        )
        for topic in topics[:3]:  # primary + 2 secondary buckets
            idx.topics.setdefault(topic, []).append(citation)


def _cache_key(tenant_id: int, journey_ids: List[int]) -> str:
    payload = f"{tenant_id}:" + ",".join(str(i) for i in sorted(journey_ids))
    digest = hashlib.sha1(payload.encode()).hexdigest()[:16]
    return f"ai_draft:framework_index:{digest}"


def _load_from_cache(key: str) -> Optional[FrameworkIndex]:
    try:
        raw = get_redis().get(key)
    except Exception:
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        idx = FrameworkIndex(tenant_id=payload["tenant_id"])
        idx.framework_summaries = payload.get("framework_summaries", [])
        for topic, citations in (payload.get("topics") or {}).items():
            idx.topics[topic] = [FrameworkCitation(**c) for c in citations]
        return idx
    except Exception:
        return None


def _write_to_cache(key: str, idx: FrameworkIndex, ttl_seconds: int = 3600) -> None:
    try:
        payload = {
            "tenant_id": idx.tenant_id,
            "framework_summaries": idx.framework_summaries,
            "topics": {
                topic: [c.__dict__ for c in citations]
                for topic, citations in idx.topics.items()
            },
        }
        get_redis().set(key, json.dumps(payload), ex=ttl_seconds)
    except Exception:
        pass


def build_framework_index(
    tenant_id: int,
    db: Session,
    *,
    journey_ids: Optional[List[int]] = None,
    uploaded_framework_ids: Optional[List[int]] = None,
    max_clauses_per_framework: int = 200,
) -> FrameworkIndex:
    """Build (or load from cache) the topic-bucketed citation pool.

    Scoping precedence:
      • `uploaded_framework_ids` (the draft modal's explicit framework picks) —
        scope STRICTLY to those uploaded frameworks, pulling clause text directly
        from their ParsedFrameworkControl rows. This never falls back to other
        frameworks, so an ISO-only draft can only cite ISO clauses (fixes the
        cross-framework leak) and the selected framework's clauses are always
        loaded so they can actually be cited. An empty list → empty index.
      • `journey_ids` — restrict to specific journeys (legacy path).
      • both None → every journey row for the tenant (best-effort citations when
        the user made no explicit selection).
    """
    # Explicit framework selection — strict, journey-independent scoping.
    if uploaded_framework_ids is not None:
        idx = FrameworkIndex(tenant_id=tenant_id)
        ids = [int(i) for i in uploaded_framework_ids]
        if not ids:
            return idx
        cache_key = _cache_key(tenant_id, [-i for i in ids])  # namespace apart from journeys
        cached = _load_from_cache(cache_key)
        if cached is not None:
            return cached
        ufs = (
            db.query(UploadedFramework)
            .filter(UploadedFramework.tenant_id == tenant_id, UploadedFramework.id.in_(ids))
            .all()
        )
        for uf in ufs:
            meta = _meta_from_uploaded(uf)
            controls = (
                db.query(ParsedFrameworkControl)
                .filter(ParsedFrameworkControl.uploaded_framework_id == uf.id)
                .order_by(ParsedFrameworkControl.original_reference.asc())
                .limit(max_clauses_per_framework)
                .all()
            )
            _index_framework_controls(idx, meta, controls)
        _write_to_cache(cache_key, idx)
        return idx

    query = db.query(CertificationJourney).filter(
        CertificationJourney.tenant_id == tenant_id,
    )
    if journey_ids:
        query = query.filter(CertificationJourney.id.in_(journey_ids))
    journeys = query.all()
    if not journeys:
        return FrameworkIndex(tenant_id=tenant_id)

    cache_key = _cache_key(tenant_id, [j.id for j in journeys])
    cached = _load_from_cache(cache_key)
    if cached is not None:
        return cached

    idx = FrameworkIndex(tenant_id=tenant_id)

    seen_uploaded: set = set()
    seen_framework: set = set()

    for journey in journeys:
        meta = _resolve_framework_meta(journey, db)
        if not meta:
            continue

        # Avoid double-counting when two journeys reference the same framework.
        dedup_key = ("u", meta["uploaded_framework_id"]) if meta["uploaded_framework_id"] else ("f", meta["framework_id"])
        if dedup_key in seen_uploaded or dedup_key in seen_framework:
            continue
        seen_uploaded.add(dedup_key) if dedup_key[0] == "u" else seen_framework.add(dedup_key)

        # Pull parsed controls — only uploaded frameworks have rich clause text.
        controls: List[ParsedFrameworkControl] = []
        if meta["uploaded_framework_id"] is not None:
            controls = (
                db.query(ParsedFrameworkControl)
                .filter(ParsedFrameworkControl.uploaded_framework_id == meta["uploaded_framework_id"])
                .order_by(ParsedFrameworkControl.original_reference.asc())
                .limit(max_clauses_per_framework)
                .all()
            )

        _index_framework_controls(idx, meta, controls)

    _write_to_cache(cache_key, idx)
    return idx
