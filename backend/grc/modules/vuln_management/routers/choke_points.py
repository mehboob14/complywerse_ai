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
            f"{cov['total_findings']} findings that currently have a VIABLE stored "
            f"attack chain ({cov['findings_with_stored_chains']} findings carry any "
            f"chain). A short list means limited reachability coverage, not a broken "
            f"feature — chain generation is the lever."
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
