"""Phase 6 orchestrator: MSRC + KEV + NVD-derived patch links → Vulnerability.

Single entry point: `sync_patch_intel(vuln, db)`. Reads `vuln.cve_id`, asks
the MSRC client for the patch metadata. When MSRC has nothing (most CVEs
aren't Microsoft) we fall back to two universally-available sources so the
button always produces something useful:

  1. CISA KEV `required_action` text — populated for ~1,200 actively-
     exploited CVEs and explicitly designed as remediation guidance.
  2. Patch / advisory URLs detected in the NVD `exploit_references` we
     already pulled during enrichment — covers Apache, Red Hat, Cisco,
     Oracle, packetstorm advisory pages, etc.

Always commits — caller doesn't need to.

Future PSIRTs (Red Hat, Cisco) will be added to the dispatch list here and
their results merged into the same `patch_references` JSON column — see the
`PatchReference` shape in `msrc_client.py`.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from ....models import Vulnerability
from .msrc_client import MsrcResult, fetch_msrc

logger = logging.getLogger(__name__)


def _merge_patch_references(
    existing: List[dict], incoming: List[dict],
) -> List[dict]:
    """Add new references without dropping ones that came from other PSIRTs.

    De-dups by (source, id) so a re-sync of the same MSRC data doesn't
    multiply the rows. Refs from a different source (e.g. a future Red Hat
    connector) are preserved untouched.
    """
    seen: set = set()
    merged: List[dict] = []

    # Existing entries first — keep their relative order.
    for ref in existing or []:
        if not isinstance(ref, dict):
            continue
        key = ((ref.get("source") or "").lower(), (ref.get("id") or "").upper())
        if key in seen:
            continue
        seen.add(key)
        merged.append(ref)

    # Then the new ones, only adding those not already present.
    for ref in incoming or []:
        if not isinstance(ref, dict):
            continue
        key = ((ref.get("source") or "").lower(), (ref.get("id") or "").upper())
        if key in seen:
            continue
        seen.add(key)
        merged.append(ref)

    return merged


def _merge_advisory_ids(existing: List[str], incoming: List[str]) -> List[str]:
    seen: set = set()
    merged: List[str] = []
    for item in (existing or []) + (incoming or []):
        if not isinstance(item, str):
            continue
        key = item.upper().strip()
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _refs_only_from(refs: List[dict], source: str) -> List[dict]:
    """Filter helper — keeps refs that came from a different PSIRT when we
    want to overwrite our own source's entries (e.g. on a re-sync where MSRC
    has removed a previously-listed KB)."""
    return [
        ref for ref in (refs or [])
        if isinstance(ref, dict) and (ref.get("source") or "").lower() != source.lower()
    ]


# ── NVD-reference fallback ───────────────────────────────────────────────
# When MSRC has nothing, scan the NVD exploit_references we already
# enriched and pull out vendor advisory / patch URLs. Most CVEs have
# vendor advisory links in their NVD references; making them visible as
# patch info immediately makes the panel useful for non-Microsoft CVEs.

# (regex, source, type, id-extractor) — order matters; first match wins.
_NVD_PATCH_PATTERNS: list[tuple[re.Pattern, str, str]] = [
    # Red Hat — RHSA-YYYY:NNNN
    (re.compile(r"access\.redhat\.com/errata/(RHSA-\d{4}:\d+)", re.IGNORECASE), "rhsa", "advisory"),
    (re.compile(r"access\.redhat\.com/security/cve/", re.IGNORECASE), "rhsa", "advisory"),
    # Microsoft — support.microsoft.com / KB articles / msrc
    (re.compile(r"support\.microsoft\.com/[^\s\"'<>]+", re.IGNORECASE), "msrc", "kb"),
    (re.compile(r"msrc\.microsoft\.com/update-guide/[^\s\"'<>]+", re.IGNORECASE), "msrc", "advisory"),
    # Cisco
    (re.compile(r"tools\.cisco\.com/security/center/content/CiscoSecurityAdvisory/[^\s\"'<>]+", re.IGNORECASE), "cisco_psirt", "advisory"),
    # Oracle
    (re.compile(r"oracle\.com/security-alerts/[^\s\"'<>]+", re.IGNORECASE), "oracle", "advisory"),
    # Apache
    (re.compile(r"issues\.apache\.org/[^\s\"'<>]+", re.IGNORECASE), "apache", "advisory"),
    (re.compile(r"apache\.org/[^/]*security[^\s\"'<>]*", re.IGNORECASE), "apache", "advisory"),
    # VMware
    (re.compile(r"vmware\.com/security/advisories/[^\s\"'<>]+", re.IGNORECASE), "vmware", "advisory"),
    # GitHub Security Advisory (GHSA)
    (re.compile(r"github\.com/[^/]+/[^/]+/security/advisories/(GHSA-[^/\s\"'<>]+)", re.IGNORECASE), "ghsa", "advisory"),
    # Generic packetstormsecurity advisory pages — useful as patch context
    (re.compile(r"packetstormsecurity\.com/files/\d+/[^\s\"'<>]+(?:Advisory|Patch|Fix)[^\s\"'<>]*", re.IGNORECASE), "vendor", "advisory"),
]

_KB_PATTERN = re.compile(r"\bKB\d{6,8}\b", re.IGNORECASE)


def _derive_ref_id(url: str, fallback_match: Optional[re.Match] = None) -> str:
    """Pick a short human-readable ID for the patch chip.

    Prefer a captured group (RHSA-2021:5106, GHSA-xxx), else a KB number
    spotted in the URL, else the last meaningful path segment.
    """
    if fallback_match is not None and fallback_match.groups():
        return fallback_match.group(1)
    kb = _KB_PATTERN.search(url)
    if kb:
        return kb.group(0).upper()
    try:
        path = urlparse(url).path
        last = [p for p in path.split("/") if p][-1] if path else ""
        return last[:60] or urlparse(url).hostname or "advisory"
    except Exception:
        return "advisory"


def _extract_patch_refs_from_nvd(
    references: List[str], existing_urls: set,
) -> List[dict]:
    """Walk NVD references and pull out any vendor patch / advisory URLs.

    Each match becomes one entry in the patch_references JSON column with
    a sensible source tag (`rhsa`, `cisco_psirt`, `oracle`, ...). Returns
    only refs whose URLs aren't already represented.
    """
    out: List[dict] = []
    seen: set = set(existing_urls)
    for url in references or []:
        if not isinstance(url, str) or not url:
            continue
        if url in seen:
            continue
        for pattern, source, ref_type in _NVD_PATCH_PATTERNS:
            m = pattern.search(url)
            if not m:
                continue
            ref_id = _derive_ref_id(url, m)
            out.append({
                "source": source,
                "id": ref_id,
                "url": url,
                "type": ref_type,
            })
            seen.add(url)
            break
    return out


def sync_patch_intel(vuln: Vulnerability, db: Session) -> dict:
    """Pull MSRC (and later other PSIRTs) for `vuln.cve_id`, write back, commit.

    Returns:
        {
            "cve_id": str | None,
            "psirt_source": str | None,   # "msrc" when MSRC owned the data
            "psirt_synced_at": datetime | None,
            "kb_count": int,
            "advisory_count": int,
            "has_remediation": bool,
            "patch_references": [...],
            "vendor_advisory_ids": [...],
            "remediation_guidance": str | None,
            "errors": [str, ...],
        }
    """
    summary: dict = {
        "cve_id": vuln.cve_id,
        "psirt_source": vuln.psirt_source,
        "psirt_synced_at": vuln.psirt_synced_at,
        "kb_count": 0,
        "advisory_count": 0,
        "has_remediation": False,
        "patch_references": list(vuln.patch_references or []),
        "vendor_advisory_ids": list(vuln.vendor_advisory_ids or []),
        "remediation_guidance": vuln.remediation_guidance,
        "errors": [],
    }

    cve_id = (vuln.cve_id or "").strip()
    if not cve_id.upper().startswith("CVE-"):
        summary["errors"].append("no_cve_id")
        return summary

    cve_id = cve_id.upper()

    # ── MSRC dispatch ───────────────────────────────────────────────────
    msrc: MsrcResult | None
    try:
        msrc = fetch_msrc(cve_id)
    except Exception:
        # Defence in depth — fetch_msrc already swallows failures, but if a
        # caller imports a broken redis stub we still want the row save to
        # succeed.
        logger.exception("MSRC client raised for %s", cve_id)
        msrc = None
        summary["errors"].append("msrc_exception")

    if msrc is None:
        summary["errors"].append("msrc_unavailable")
        # Don't stamp psirt_synced_at on a transient failure — we want the
        # daily refresh to retry. And don't wipe existing data.
        try:
            db.commit()
        except Exception:
            db.rollback()
        return summary

    if msrc.found:
        # Re-sync semantics: replace our own MSRC entries with the fresh
        # set, but preserve refs from other PSIRTs (Red Hat, Cisco, ...).
        existing_non_msrc = _refs_only_from(vuln.patch_references or [], "msrc")
        incoming = msrc.patch_references_as_dicts()
        merged_refs = _merge_patch_references(existing_non_msrc, incoming)

        vuln.patch_references = merged_refs
        vuln.vendor_advisory_ids = _merge_advisory_ids(
            vuln.vendor_advisory_ids or [], msrc.advisory_ids,
        )
        if msrc.remediation_text:
            vuln.remediation_guidance = msrc.remediation_text
        vuln.psirt_source = "msrc"

        summary["patch_references"] = merged_refs
        summary["vendor_advisory_ids"] = vuln.vendor_advisory_ids
        summary["remediation_guidance"] = vuln.remediation_guidance
        summary["psirt_source"] = "msrc"
        summary["kb_count"] = sum(
            1 for r in merged_refs if isinstance(r, dict) and r.get("type") == "kb"
        )
        summary["advisory_count"] = len(vuln.vendor_advisory_ids or [])
        summary["has_remediation"] = bool(vuln.remediation_guidance)
    else:
        # MSRC explicitly said "not a Microsoft CVE". Fall back to two
        # universally-available sources so the operator still gets useful
        # patch info instead of an empty panel.
        summary["errors"].append("not_a_microsoft_cve")

        # Fallback 1 — scan NVD references for vendor advisory / patch URLs.
        existing_urls = {
            (ref.get("url") or "") for ref in (vuln.patch_references or [])
            if isinstance(ref, dict)
        }
        nvd_refs = _extract_patch_refs_from_nvd(
            list(vuln.exploit_references or []), existing_urls,
        )
        if nvd_refs:
            merged_refs = _merge_patch_references(
                list(vuln.patch_references or []), nvd_refs,
            )
            vuln.patch_references = merged_refs
            summary["patch_references"] = merged_refs
            summary["kb_count"] = sum(
                1 for r in merged_refs if isinstance(r, dict) and r.get("type") == "kb"
            )
            summary["advisory_count"] = len(vuln.vendor_advisory_ids or [])
            # Mark the dominant non-MSRC source so the UI badge is honest.
            non_msrc_sources = {
                (r.get("source") or "").lower() for r in merged_refs
                if isinstance(r, dict) and (r.get("source") or "").lower() != "msrc"
            }
            if non_msrc_sources:
                # Prefer specific PSIRT sources over the generic "vendor" bucket.
                for preferred in ("rhsa", "cisco_psirt", "oracle", "vmware", "apache", "ghsa", "vendor"):
                    if preferred in non_msrc_sources:
                        vuln.psirt_source = preferred
                        summary["psirt_source"] = preferred
                        break

        # Fallback 2 — CISA KEV publishes verbatim "required action" text for
        # every entry. If this vuln is KEV-listed and we still have no
        # remediation guidance, use that text. It's authoritative and
        # remediation-shaped (e.g. "Apply mitigations per vendor instructions
        # by 2021-12-24" or "Disconnect product from networks").
        if not vuln.remediation_guidance and bool(vuln.kev_flag):
            try:
                from ..enrichment.kev_cache import kev_metadata
                meta = kev_metadata(vuln.cve_id or "") or {}
                kev_text_parts: list[str] = []
                if meta.get("required_action"):
                    kev_text_parts.append(
                        f"CISA required action: {meta['required_action']}"
                    )
                if meta.get("short_description"):
                    kev_text_parts.append(
                        f"CISA description: {meta['short_description']}"
                    )
                if meta.get("due_date"):
                    try:
                        kev_text_parts.append(
                            f"CISA due date (federal agencies): "
                            f"{meta['due_date'].strftime('%Y-%m-%d')}"
                        )
                    except Exception:
                        pass
                if kev_text_parts:
                    vuln.remediation_guidance = "\n\n".join(kev_text_parts)
                    summary["remediation_guidance"] = vuln.remediation_guidance
                    summary["has_remediation"] = True
                    if not vuln.psirt_source:
                        vuln.psirt_source = "cisa_kev"
                        summary["psirt_source"] = "cisa_kev"
            except Exception:
                logger.exception(
                    "KEV-based remediation lookup failed for vuln %s", vuln.id
                )

        if not (summary["kb_count"] or summary["advisory_count"] or summary["has_remediation"]):
            # Truly nothing found anywhere — tag the summary so the UI can
            # surface a clear "no patch info available" message instead of
            # the silent failure the user reported.
            summary["errors"].append("no_patch_info_anywhere")

    now = datetime.utcnow()
    vuln.psirt_synced_at = now
    summary["psirt_synced_at"] = now

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to commit patch-intel for vuln %s", vuln.id)
        summary["errors"].append("commit_failed")

    return summary
