"""Orchestrator: NVD + EPSS + CISA KEV → writes back to a Vulnerability row.

Single entry point: `enrich_vulnerability(vuln, db)`. Reads `vuln.cve_id`,
calls each external source in turn (all best-effort), writes the result
columns plus a refreshed `composite_priority`. Always commits — caller
doesn't need to.

Returns a small summary dict the on-demand endpoint passes back to the
frontend so the UI can show what changed without a re-fetch.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ....models import Vulnerability, VulnerabilityAssetLink, ITAsset
from .epss_client import fetch_epss
from .github_poc_client import fetch_github_poc
from .kev_cache import is_kev, kev_metadata
from .nvd_client import fetch_nvd
from .priority import compute_composite_priority

logger = logging.getLogger(__name__)


def _maturity_from_exploits(vuln) -> str:
    """Exploit maturity, inferred from what we actually collected.

    We have no vendor-supplied maturity rating, so this is derived from the two
    corroborating public-exploit sources: GitHub PoC repos and the Exploit-DB
    archive. Several public exploits from either source means the flaw is
    effectively weaponised; a maintainer-*verified* Exploit-DB entry counts the
    same, because someone reproduced it. One or two means a proof of concept
    exists; KEV means it is being used in the wild. Adding the Exploit-DB source
    can only RAISE maturity, never lower it — corroboration strengthens evidence.
    """
    count = int(getattr(vuln, "public_exploit_count", 0) or 0)
    edb_count = int(getattr(vuln, "exploitdb_count", 0) or 0)
    edb_verified = int(getattr(vuln, "exploitdb_verified_count", 0) or 0)
    if getattr(vuln, "kev_flag", False):
        return "weaponized"
    if edb_verified > 0 or count > 2 or edb_count > 2:
        return "weaponized"
    if count > 0 or edb_count > 0:
        return "proof_of_concept"
    return "unproven"


def apply_exploitdb_signal(vuln) -> dict:
    """Populate the Exploit-DB corroboration fields on `vuln` from the offline
    cache, and compute the combined public-exploit provenance string.

    Extracted from `enrich_vulnerability` so the cache -> column write path is
    exercisable on its own (and against a real row), not only through the full
    enrichment flow — that write path was previously covered by unit tests only,
    and unit tests are what missed the status-vocabulary bug. Sets attributes
    only; the caller owns the commit. Absence is recorded as 0 ("checked, none
    found"), distinct from NULL ("never checked"). Pure in-memory lookup, no
    network.
    """
    from .exploitdb_cache import exploit_summary
    edb = exploit_summary(getattr(vuln, "cve_id", None))
    if edb is not None:
        vuln.exploitdb_count = edb["count"]
        vuln.exploitdb_verified_count = edb["verified"]
        vuln.exploitdb_refs = edb["refs"]
    else:
        vuln.exploitdb_count = 0
        vuln.exploitdb_verified_count = 0
        vuln.exploitdb_refs = []

    sources = []
    if int(getattr(vuln, "public_exploit_count", 0) or 0) > 0:
        sources.append("github")
    if int(getattr(vuln, "exploitdb_verified_count", 0) or 0) > 0:
        sources.append("exploit-db (verified)")
    elif int(getattr(vuln, "exploitdb_count", 0) or 0) > 0:
        sources.append("exploit-db")
    vuln.exploit_source = "; ".join(sources) or None
    return {
        "exploitdb_count": vuln.exploitdb_count,
        "exploitdb_verified_count": vuln.exploitdb_verified_count,
        "exploit_source": vuln.exploit_source,
    }


def _vector_from_cvss(vuln):
    """Pull the attack vector out of the packed CVSS vector string.

    A v3 vector looks like "CVSS:3.1/AV:N/AC:L/..." — AV is the attack vector.
    Returns None when there is no vector, which the scorer treats as
    "moderate", not "safe".
    """
    vec = getattr(vuln, "cvss_vector", None)
    if not vec:
        return None
    import re
    m = re.search(r"AV:([NALP])", str(vec))
    if not m:
        return None
    return {"N": "network", "A": "adjacent", "L": "local", "P": "physical"}[m.group(1)]


def _internet_exposed(db, vuln) -> bool:
    """True when any asset this finding affects faces the internet."""
    try:
        from ....models import ITAsset, VulnerabilityAssetLink
        rows = (
            db.query(ITAsset.internet_facing)
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
            .filter(VulnerabilityAssetLink.vulnerability_id == vuln.id)
            .all()
        )
        return any(bool(r[0]) for r in rows)
    except Exception:  # noqa: BLE001 — never let scoring fail on a lookup
        return False


def _resolve_asset_criticality(db: Session, vuln: Vulnerability) -> Optional[str]:
    """Return the highest-criticality asset linked to this vuln, if any.

    Order: critical > high > medium > low. We pick the highest so a vuln
    that affects one critical asset doesn't get under-prioritised when it
    also touches a low-criticality machine.
    """
    try:
        rows = (
            db.query(ITAsset.criticality)
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
            .filter(VulnerabilityAssetLink.vulnerability_id == vuln.id)
            .all()
        )
    except Exception:
        logger.exception("Failed to resolve asset criticality for vuln %s", vuln.id)
        return None

    order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    best = None
    best_score = 0
    for (crit,) in rows:
        key = (crit or "").lower().strip()
        score = order.get(key, 0)
        if score > best_score:
            best = key
            best_score = score
    return best


def _resolve_asset_criticality_score(db: Session, vuln: Vulnerability) -> Optional[float]:
    """Phase 5.4 — Return the max derived criticality_score across linked assets.

    Returns None when no linked asset has the score populated; the caller
    then falls back to the text-based `_resolve_asset_criticality()` path.
    """
    try:
        rows = (
            db.query(ITAsset.criticality_score)
            .join(VulnerabilityAssetLink, VulnerabilityAssetLink.asset_id == ITAsset.id)
            .filter(
                VulnerabilityAssetLink.vulnerability_id == vuln.id,
                ITAsset.criticality_score.isnot(None),
            )
            .all()
        )
    except Exception:
        logger.exception("Failed to resolve asset criticality score for vuln %s", vuln.id)
        return None

    best: Optional[float] = None
    for (score,) in rows:
        if score is None:
            continue
        try:
            val = float(score)
        except (TypeError, ValueError):
            continue
        if best is None or val > best:
            best = val
    return best


def enrich_vulnerability(vuln: Vulnerability, db: Session) -> dict:
    """Pull NVD + EPSS + KEV for `vuln.cve_id`, write back, commit.

    Returns a summary dict:
        {
            "cve_id": str | None,
            "kev_flag": bool,
            "epss_score": float | None,
            "epss_percentile": float | None,
            "composite_priority": float | None,
            "nvd_synced": bool,
            "errors": [str, ...]   # for fields that failed to fetch
        }
    """
    summary: dict = {
        "cve_id": vuln.cve_id,
        "kev_flag": bool(vuln.kev_flag),
        "epss_score": vuln.epss_score,
        "epss_percentile": vuln.epss_percentile,
        "composite_priority": vuln.composite_priority,
        "nvd_synced": False,
        "errors": [],
    }

    cve_id = (vuln.cve_id or "").strip()
    if not cve_id.upper().startswith("CVE-"):
        # No CVE → nothing to enrich. We still recompute composite_priority
        # so a vuln with only CVSS + asset criticality still benefits from
        # the new column without anyone having to click anything.
        priority = compute_composite_priority(
            cvss_score=vuln.cvss_score,
            epss_score=None,
            kev_flag=False,
            asset_criticality=_resolve_asset_criticality(db, vuln),
            asset_criticality_score=_resolve_asset_criticality_score(db, vuln),
            exploit_maturity=_maturity_from_exploits(vuln),
            attack_vector=_vector_from_cvss(vuln),
            internet_exposed=_internet_exposed(db, vuln),
        )
        vuln.composite_priority = priority
        summary["composite_priority"] = priority
        summary["errors"].append("no_cve_id")
        db.commit()
        return summary

    cve_id = cve_id.upper()

    # ---- NVD canonical metadata --------------------------------------------
    try:
        nvd = fetch_nvd(cve_id)
    except Exception:
        nvd = None
        summary["errors"].append("nvd_exception")
    if nvd is not None:
        vuln.nvd_published_at = nvd.published_at or vuln.nvd_published_at
        vuln.nvd_last_modified_at = nvd.last_modified_at or vuln.nvd_last_modified_at

        # Backfill the CVSS vector when we don't already hold one. Scanner
        # imports supply it; manual entries never did, which left the attack
        # vector unknown — and "unknown" is not neutral here. Scoring falls back
        # to a 0.5 guess worth 10% of the total, and the exploitability page
        # cannot say whether the flaw is reachable over the network.
        #
        # Never overwrite an existing vector: a scanner observed this finding on
        # a real host, NVD only describes the CVE in general.
        if not (vuln.cvss_vector or "").strip() and nvd.cvss_vector:
            vuln.cvss_vector = nvd.cvss_vector
            if vuln.cvss_score is None and nvd.cvss_score is not None:
                vuln.cvss_score = nvd.cvss_score
        if nvd.references:
            vuln.exploit_references = nvd.references
        summary["nvd_synced"] = True
        # ---- CPE matcher (Phase 4) -----------------------------------------
        # Walk this CVE's NVD `affected_configurations` against the tenant's
        # SoftwareIdentifier inventory; auto-link any matching assets.
        # Best-effort: a failure here doesn't poison enrichment.
        try:
            from ....services.cpe_matcher import match_cve_to_asset_ids, write_auto_links
            asset_ids = match_cve_to_asset_ids(
                db,
                tenant_id=vuln.tenant_id,
                cve_id=cve_id,
                configurations=nvd.configurations or [],
            )
            if asset_ids:
                added = write_auto_links(
                    db,
                    vuln_id=vuln.id,
                    tenant_id=vuln.tenant_id,
                    asset_ids=asset_ids,
                )
                summary["cpe_matches_added"] = added
        except Exception:
            logger.exception("CPE matcher failed for vuln %s", vuln.id)
            summary["errors"].append("cpe_matcher_exception")
    else:
        summary["errors"].append("nvd_unavailable")

    # ---- EPSS exploit probability ------------------------------------------
    try:
        epss = fetch_epss(cve_id)
    except Exception:
        epss = None
        summary["errors"].append("epss_exception")
    if epss is not None:
        vuln.epss_score = epss.score
        vuln.epss_percentile = epss.percentile
        summary["epss_score"] = epss.score
        summary["epss_percentile"] = epss.percentile
    else:
        summary["errors"].append("epss_unavailable")

    # ---- CISA KEV flag -----------------------------------------------------
    try:
        kev_match = is_kev(cve_id)
    except Exception:
        kev_match = False
        summary["errors"].append("kev_exception")
    vuln.kev_flag = bool(kev_match)
    summary["kev_flag"] = bool(kev_match)
    if kev_match:
        meta = kev_metadata(cve_id)
        if meta and meta.get("date_added"):
            vuln.kev_date_added = meta["date_added"]
    else:
        # Explicitly clear stale KEV metadata when the CVE has been removed
        # from the catalogue (rare but happens during CISA cleanups).
        vuln.kev_date_added = None

    vuln.nvd_last_synced_at = datetime.utcnow()

    # ---- Public-exploit detection (GitHub PoC) -----------------------------
    # Search for clone-and-run exploit repos. A non-zero count means the
    # vuln is no longer theoretically exploitable — any unskilled attacker
    # can run the published code. Best-effort: rate limit / network failures
    # leave the columns untouched so the daily refresh retries.
    try:
        poc = fetch_github_poc(cve_id)
    except Exception:
        poc = None
        summary["errors"].append("github_poc_exception")
    if poc is not None:
        vuln.public_exploit_count = poc.repo_count
        vuln.public_exploit_refs = poc.refs_as_dicts()
        vuln.public_exploit_synced_at = datetime.utcnow()
        summary["public_exploit_count"] = poc.repo_count
        summary["public_exploit_found"] = bool(poc.found)
    else:
        summary["errors"].append("github_poc_unavailable")

    # ---- Public-exploit corroboration (Exploit-DB) -------------------------
    # A second, independent source alongside the GitHub PoC search above; the two
    # corroborate. Delegated to apply_exploitdb_signal() so the cache -> column
    # write path is testable on its own. Best-effort: never fail enrichment on it.
    try:
        edb_result = apply_exploitdb_signal(vuln)
        summary["exploitdb_count"] = edb_result["exploitdb_count"]
        summary["exploitdb_verified_count"] = edb_result["exploitdb_verified_count"]
        summary["exploit_source"] = edb_result["exploit_source"]
    except Exception:
        summary["errors"].append("exploitdb_exception")

    # ---- Composite priority ------------------------------------------------
    asset_criticality = _resolve_asset_criticality(db, vuln)
    asset_criticality_score = _resolve_asset_criticality_score(db, vuln)
    priority = compute_composite_priority(
        cvss_score=vuln.cvss_score,
        epss_score=vuln.epss_score,
        kev_flag=vuln.kev_flag,
        asset_criticality=asset_criticality,
        asset_criticality_score=asset_criticality_score,
        # Three signals added when the scorer moved from four factors to
        # seven. Without them the stored score silently assumed "unknown
        # maturity, moderate vector, internal only" and under-scored every
        # internet-facing finding.
        exploit_maturity=_maturity_from_exploits(vuln),
        attack_vector=_vector_from_cvss(vuln),
        internet_exposed=_internet_exposed(db, vuln),
    )
    # The old +0.5 public-exploit nudge is gone: exploit maturity is now a
    # first-class signal worth up to 15 points, so adding a bonus on top
    # would count the same evidence twice.
    vuln.composite_priority = priority
    summary["composite_priority"] = priority

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to commit enrichment for vuln %s", vuln.id)
        summary["errors"].append("commit_failed")

    # ---- CWE → framework-control auto-mapping ------------------------------
    # Best-effort: the writer never raises into the caller. We pass
    # delete_stale=False here so a casual re-enrichment doesn't remove
    # auto rows mid-investigation; the explicit /controls/auto-map
    # endpoint passes True for the "clean reset" semantics the UI
    # button promises.
    try:
        from ..control_mapping import auto_map_compliance_controls
        cm_summary = auto_map_compliance_controls(
            vuln, db, delete_stale=False, user_id=None,
        )
        summary["compliance_mapping"] = cm_summary
        for err in cm_summary.get("errors") or []:
            summary["errors"].append(f"compliance_mapping_{err}")
    except Exception:
        logger.exception(
            "compliance_mapping auto-map raised unexpectedly for vuln %s", vuln.id
        )
        summary["errors"].append("compliance_mapping_exception")

    return summary
