"""Advisory applicability cross-check.

Answers the question an advisory raises: *which of our assets does this
affect?* The answer comes from DETECTED FINDINGS in the vulnerability register
— the store of record for "which CVEs are on asset X" — not from the installed-
software / CPE inventory.

An asset is **affected** by an advisory CVE when a real register finding for
that exact CVE exists on it: a ``Vulnerability`` row (``grc_vulnerabilities``,
cve_id) linked to the asset via ``VulnerabilityAssetLink`` by something other
than this advisory's own back-link — i.e. a pentest scan, a connector/Nessus
sync, or a manual entry. The Pentest page writes into this same register, so
advisory → register is the one source of truth.

Matching is run against a **scope** of assets the operator chooses: all assets
we have scan data for (default), a saved CTEM scope, or a hand-picked set.
Match-only: the advisory records applicability against the real finding and
never writes its own rows into the register, so advisory CVEs can't inflate it.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import Vulnerability, VulnerabilityAssetLink
from .models import Advisory, AdvisoryAssetApplicability

logger = logging.getLogger(__name__)


def _default_scope_ids(db: Session, tenant_id: int) -> Set[int]:
    """Assets that have at least one real (non-advisory) register finding — the
    ones we actually have scan/connector data for. The default match universe."""
    rows = (
        db.query(VulnerabilityAssetLink.asset_id)
        .join(Vulnerability, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(
            Vulnerability.tenant_id == tenant_id,
            VulnerabilityAssetLink.link_source != "advisory",
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


def _register_finding_assets(
    db: Session, tenant_id: int, cve_id: str, scope_ids: Set[int]
) -> Set[int]:
    """Within ``scope_ids``, the assets a register finding reports this exact CVE
    on. Joins the link on ``vulnerability_id`` (the FK) then compares the
    register row's cve_id; excludes this advisory's own back-links so a match
    reflects a scan/connector/manual finding, never our own bridge."""
    if not cve_id or not scope_ids:
        return set()
    rows = (
        db.query(VulnerabilityAssetLink.asset_id)
        .join(Vulnerability, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(
            Vulnerability.tenant_id == tenant_id,
            func.upper(Vulnerability.cve_id) == cve_id.upper(),
            VulnerabilityAssetLink.link_source != "advisory",
            VulnerabilityAssetLink.asset_id.in_(scope_ids),
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


def _register_finding_details(
    db: Session, tenant_id: int, cve_id: str, scope_ids: Set[int]
) -> List[Dict[str, Any]]:
    """Per-asset register-finding detail for one CVE within scope: asset_id, the
    backing Vulnerability id (for the register link) and its severity. Same real-
    detection filter as ``_register_finding_assets`` (excludes advisory back-links)."""
    if not cve_id or not scope_ids:
        return []
    rows = (
        db.query(
            VulnerabilityAssetLink.asset_id,
            Vulnerability.id,
            Vulnerability.severity,
        )
        .join(Vulnerability, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id)
        .filter(
            Vulnerability.tenant_id == tenant_id,
            func.upper(Vulnerability.cve_id) == cve_id.upper(),
            VulnerabilityAssetLink.link_source != "advisory",
            VulnerabilityAssetLink.asset_id.in_(scope_ids),
        )
        .distinct()
        .all()
    )
    return [{"asset_id": r[0], "vulnerability_id": r[1], "severity": r[2]} for r in rows]


def recheck_advisory(
    advisory: Advisory, db: Session, scope_ids: Optional[Set[int]] = None
) -> Dict[str, Any]:
    """Recompute which assets this advisory affects by matching its CVEs against
    register findings in ``scope_ids``, refresh the rollup, and return a summary.
    Caller commits.

    ``scope_ids`` None → the default scope (every asset with a real finding). The
    match always runs (no NVD gate), so an advisory with no matching finding
    honestly resolves to 0 affected / not_applicable rather than "not checked".
    """
    scope = scope_ids if scope_ids is not None else _default_scope_ids(db, advisory.tenant_id)

    # Recompute from scratch: drop prior applicability rows so a match that no
    # longer holds (asset remediated, scope narrowed) does not linger.
    cve_pks = [c.id for c in advisory.cves]
    if cve_pks:
        (db.query(AdvisoryAssetApplicability)
         .filter(AdvisoryAssetApplicability.advisory_cve_id.in_(cve_pks))
         .delete(synchronize_session=False))

    affected_all: Set[int] = set()
    per_cve: List[Dict[str, Any]] = []
    for cve in advisory.cves:
        hits = _register_finding_assets(db, advisory.tenant_id, cve.cve_id, scope)
        for asset_id in hits:
            db.add(AdvisoryAssetApplicability(
                tenant_id=advisory.tenant_id, advisory_cve_id=cve.id, asset_id=asset_id,
                verdict="affected",
                evidence={"cve": cve.cve_id, "matched": True, "source": "register-finding"},
                checked_at=datetime.utcnow(),
            ))
        affected_all |= hits
        per_cve.append({"cve_id": cve.cve_id, "evaluated": True,
                        "affected": len(hits), "not_affected": len(scope) - len(hits)})

    advisory.asset_affected_count = len(affected_all)
    advisory.asset_total_count = len(scope)  # assets checked
    # Only move an auto/neutral status — never override a manual 'resolved'.
    if advisory.status in ("open", "not_applicable", "pending"):
        advisory.status = "open" if affected_all else "not_applicable"
    db.flush()

    return {
        "advisory_id": advisory.id,
        "status": advisory.status,
        "asset_affected_count": advisory.asset_affected_count,
        "asset_total_count": advisory.asset_total_count,
        "evaluated_any": True,
        "per_cve": per_cve,
    }
