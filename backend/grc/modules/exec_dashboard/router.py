"""/exec-dashboard/summary — read-only aggregates for the Performance (exec) dashboard.

One GET, no writes. The math lives in service.summarize (self-checked there).
"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from grc.models import GRCUser, ITAsset, Vulnerability, VulnerabilityAssetLink, get_db
from grc.models._pentest_exploit_results import PentestExploitResult
from grc.modules.vuln_management._adhoc_filter import exclude_adhoc, inventory_assets_only
from grc.modules.vuln_management.routers.dashboard import RESOLVED_STATUSES
from grc.routers.auth_router import get_user_tenants, require_auth, require_tenant_permission

from .service import summarize

# the summary is vulnerability findings (with their assets and pentest results): the vulnerability register's view right
router = APIRouter(prefix="/exec-dashboard", tags=["Executive Dashboard"],
                   dependencies=[Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view"))])

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
             .filter(V.tenant_id.in_(tids), exclude_adhoc(db)).all()]
    # INVENTORY ONLY: transient AI-pentest ad-hoc targets (status='adhoc' / source 'pentest-adhoc')
    # are not inventory. exclude_adhoc (above) keeps only vulns linked to >=1 managed asset - the rule
    # the Vulnerability dashboard uses; links are restricted to managed assets so a vuln also linked
    # to an ad-hoc target never attributes risk to that target.
    links = db.query(L.vulnerability_id, L.asset_id).join(V, V.id == L.vulnerability_id) \
        .join(A, A.id == L.asset_id).filter(V.tenant_id.in_(tids), *inventory_assets_only(A)).all()
    ids = {a for _, a in links}
    assets = {i: (n, bool(f1) or bool(f2)) for i, n, f1, f2 in
              db.query(A.id, A.name, A.internet_facing, A.is_internet_facing).filter(A.id.in_(ids), *inventory_assets_only(A)).all()} if ids else {}
    try:
        exploits = [dict(zip(_E_KEYS, r)) for r in db.query(*(getattr(E, k) for k in _E_KEYS))
                    .filter(E.tenant_id.in_(tids),
                            # exploit runs against ad-hoc pentest targets are not inventory evidence
                            or_(E.asset_id.is_(None),
                                ~E.asset_id.in_(db.query(A.id).filter(A.tenant_id.in_(tids),
                                                                      ~and_(*inventory_assets_only(A))))))
                    .order_by(E.created_at, E.id).all()]
    except Exception:  # noqa: BLE001 — table not provisioned on this tenant yet: report "unknown", not 0
        db.rollback()
        exploits = None
    return summarize(vulns, links, assets, exploits, now, RESOLVED_STATUSES)
