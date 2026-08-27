"""Phase 4 — choke-point API.

Read endpoints are open to register viewers; recompute is a decision-bearing
write (permission-gated). The list carries `computed_at` and coverage so a
short or stale list reads as coverage-limited, not broken.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ....models import Vulnerability, GRCUser, get_db
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
)
from ....services import choke_points as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/choke-points", tags=["Vulnerabilities - Choke Points"])


def _hydrate(db: Session, tenant_id: int, entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Attach finding title/severity for display — the chains themselves are
    already self-contained on the entry."""
    ids = [e["vulnerability_id"] for e in entries]
    meta = {}
    if ids:
        for v in db.query(Vulnerability.id, Vulnerability.vuln_id, Vulnerability.title,
                          Vulnerability.severity).filter(Vulnerability.id.in_(ids)).all():
            meta[v.id] = {"vuln_id": v.vuln_id, "title": v.title, "severity": v.severity}
    for e in entries:
        e.update(meta.get(e["vulnerability_id"], {}))
    return entries


@router.get("")
def get_choke_points(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    """Latest persisted ranking + its computed_at + coverage honesty. No
    total is returned — chain counts must never be summed across findings
    (shared assets would double-count protection)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    latest = svc.latest_snapshot(db, tenant_id)
    cov = svc.coverage(db, tenant_id)
    if latest:
        latest["entries"] = _hydrate(db, tenant_id, latest["entries"])
    return {
        "snapshot": latest,
        "coverage": cov,
        "coverage_note": (
            f"Ranks remediations across {cov['findings_ranked']} of "
            f"{cov['total_findings']} findings ({cov['total_viable_chains']} viable "
            f"chains total). THREE levers move this, not one: chain GENERATION — "
            f"{cov['findings_chainless']} findings carry no stored chain at all; "
            f"SEVERANCE — {cov['findings_severed']} carry a chain we derived as "
            f"severed (every way in blocked on the asset — real posture, not a fixable "
            f"gap); and DERIVABILITY — {cov['findings_undeterminable']} carry a chain we "
            f"cannot derive at all (no CWE/CVSS to reason from), where 'unlikely' is a "
            f"data-gap default and enrichment is the only lever, and only when the "
            f"finding has a CVE to enrich from. A short list is coverage-limited, not "
            f"broken. 'Viable' means a latest verdict of likely or possible; a severed "
            f"chain is already broken and does not count."
        ),
        "no_total_reason": (
            "Chain counts are per-finding and are NOT summed: the assets they "
            "protect overlap, so a total would double-count protection. Ranking "
            "reshuffles as fixes land — that is correctness."
        ),
    }


@router.post("/recompute")
def recompute_choke_points(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    """Recompute + persist a fresh snapshot (also happens after each sync)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        result = svc.persist_snapshot(db, tenant_id, triggered_by_user_id=current_user.id)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.exception("choke-point recompute failed")
        raise HTTPException(status_code=500, detail="Recompute failed — check logs")
    return result


@router.post("/compute-paths")
def compute_attack_paths(
    ctem_scope_id: Optional[int] = None,
    only_missing: bool = True,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    """Run the attack-path engine over every linked (finding × asset) pair —
    tenant-wide, or one CTEM scope — writing a reachability snapshot per pair via
    the same change-aware writer the Exploit Test tab uses. Then recompute the
    choke-point ranking so Prioritise reflects the new verdicts. Fills the
    "path not calculated yet" bucket honestly (info findings land as
    undeterminable, never invented as dangerous)."""
    from ....services.reachability_batch import compute_paths
    tenant_id = get_user_primary_tenant(current_user, db)
    vuln_ids = None
    if ctem_scope_id:
        from ....models import CtemScope
        from ....services.ctem_scopes import scope_vulnerability_ids
        scope = db.query(CtemScope).filter(CtemScope.id == ctem_scope_id,
                                           CtemScope.tenant_id == tenant_id).first()
        if not scope:
            raise HTTPException(status_code=404, detail="CTEM scope not found")
        vuln_ids = scope_vulnerability_ids(db, tenant_id, scope.membership_rule)
    report = compute_paths(db, tenant_id, vulnerability_ids=vuln_ids, only_missing=only_missing)
    try:
        report["choke_snapshot"] = svc.persist_snapshot(db, tenant_id, triggered_by_user_id=current_user.id)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("choke-point recompute after compute-paths failed")
        report["choke_snapshot"] = None
    return report


@router.get("/findings/{vuln_id}")
def get_finding_choke_detail(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    """The explainability click: the exact chains this finding's fix would
    sever, from the self-contained snapshot entry (no live reachability join)."""
    tenant_id = get_user_primary_tenant(current_user, db)
    latest = svc.latest_snapshot(db, tenant_id)
    if not latest:
        raise HTTPException(status_code=404, detail="No choke-point snapshot computed yet")
    entry = next((e for e in latest["entries"] if e["vulnerability_id"] == vuln_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Finding is not a ranked choke point in the latest snapshot")
    return {"computed_at": latest["computed_at"], **_hydrate(db, tenant_id, [entry])[0]}
