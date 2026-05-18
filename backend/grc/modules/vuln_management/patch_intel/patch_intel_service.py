"""Phase 6 orchestrator: MSRC → writes back to a Vulnerability row.

Single entry point: `sync_patch_intel(vuln, db)`. Reads `vuln.cve_id`, asks
the MSRC client for the patch metadata, writes the result columns plus
`psirt_synced_at` / `psirt_source`. Always commits — caller doesn't need to.

Returns a summary dict the on-demand endpoint passes back to the frontend so
the UI can render the new state without a re-fetch.

Vendor detection: we don't try to predict vendor before calling MSRC. MSRC
itself returns 404 for any non-Microsoft CVE; the cost is one negative-cache
HTTP call per CVE per 7 days. That's far simpler than CPE-based pre-filtering
and avoids false negatives when Microsoft owns a CVE under a non-obvious
product name (e.g. WSUS, Defender, Edge).

Future PSIRTs (Red Hat, Cisco) will be added to the dispatch list here and
their results merged into the same `patch_references` JSON column — see the
`PatchReference` shape in `msrc_client.py`.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import List

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
        # MSRC explicitly said "not a Microsoft CVE". We don't wipe existing
        # data (it might have come from a different PSIRT), but we do stamp
        # the sync timestamp so the daily refresh skips this row for a while.
        summary["errors"].append("not_a_microsoft_cve")

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
