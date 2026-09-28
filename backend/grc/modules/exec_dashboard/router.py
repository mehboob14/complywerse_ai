"""/exec-dashboard/summary — read-only aggregates for the Performance (exec) dashboard.

One GET, no writes. The math lives in service.summarize (self-checked there).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from grc.models import GRCUser, ITAsset, Vulnerability, VulnerabilityAssetLink, get_db
from grc.models._pentest_exploit_results import PentestExploitResult
from grc.modules.vuln_management.routers.dashboard import RESOLVED_STATUSES
from grc.routers.auth_router import get_user_tenants, require_auth

from .service import summarize

router = APIRouter(prefix="/exec-dashboard", tags=["Executive Dashboard"])

_V_KEYS = ("id", "severity", "status", "source", "discovered_at", "kev_flag", "public_exploit_count",
           "exploitdb_count", "epss_score", "cve_id", "affected_host", "nvd_last_synced_at", "public_exploit_synced_at")
_E_KEYS = ("finding_id", "status", "confirmed", "access_proven", "created_at")


@router.get("/summary")
def summary(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    now = datetime.utcnow()  # discovered_at is naive UTC
    tids = get_user_tenants(current_user, db)
    if not tids:
        return summarize([], [], {}, [], now, RESOLVED_STATUSES)

    V, L, A, E = Vulnerability, VulnerabilityAssetLink, ITAsset, PentestExploitResult
    vulns = [dict(zip(_V_KEYS, r)) for r in db.query(*(getattr(V, k) for k in _V_KEYS))
             .filter(V.tenant_id.in_(tids)).all()]
    links = db.query(L.vulnerability_id, L.asset_id).join(V, V.id == L.vulnerability_id) \
        .filter(V.tenant_id.in_(tids)).all()
    ids = {a for _, a in links}
    assets = {i: (n, bool(f1) or bool(f2)) for i, n, f1, f2 in
              db.query(A.id, A.name, A.internet_facing, A.is_internet_facing).filter(A.id.in_(ids)).all()} if ids else {}
    try:
        exploits = [dict(zip(_E_KEYS, r)) for r in db.query(*(getattr(E, k) for k in _E_KEYS))
                    .filter(E.tenant_id.in_(tids)).order_by(E.created_at, E.id).all()]
    except Exception:  # noqa: BLE001 — table not provisioned on this tenant yet: report "unknown", not 0
        db.rollback()
        exploits = None
    return summarize(vulns, links, assets, exploits, now, RESOLVED_STATUSES)
