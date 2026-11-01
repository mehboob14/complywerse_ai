"""GET /estate-overview — hierarchical estate composition for the IT Asset Inventory
Overview. One read-only GET, no writes, no new tables. Classification + roll-up live
in service.summarize (self-checked there); this file only loads the signals.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from grc.models import DiscoveryObservation, GRCUser, ITAsset, get_db
from grc.routers.auth_router import get_user_tenants, require_auth

from .service import classify_internal, fingerprint, is_external, summarize

router = APIRouter(prefix="/estate-overview", tags=["IT Assets"])

_COLS = ("id", "name", "fqdn", "host_name", "asset_type", "asset_role", "platform_kind", "origin_source",
         "internet_facing", "last_seen_source", "status", "lifecycle_state", "os_family", "os_version",
         "os_normalized", "os_build", "manufacturer", "model", "owner_id", "primary_owner_id", "criticality",
         "last_seen_at", "eol_date",
         # Additive estate-rollup columns — all cheap scalars (several indexed) + one
         # small JSON list (compliance_scope). The heavy JSON (security_posture) is
         # loaded separately below, internal hosts only, so it never lands on every row.
         "environment", "data_classification", "department", "owning_team", "discovery_state",
         "cde_environment", "ephi_environment", "regulated_data_type", "compliance_scope",
         "valuation", "purchase_cost", "cpu_cores", "memory_gb", "storage_gb")
# Only the small platform_properties sections the classifier reads — a full deep-scan
# blob (services, tasks, users…) per asset would make this endpoint heavy at 5k assets.
_PP_KEYS = ("fingerprint", "discovery_classification", "external_probe", "engine")


@router.get("")
def estate_overview(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    now = datetime.utcnow()  # last_seen_at / eol_date are naive UTC
    tids = get_user_tenants(current_user, db)
    if not tids:
        return summarize([], set(), {}, {}, now)
    A, pp = ITAsset, ITAsset.platform_properties
    rows = db.query(*(getattr(A, c) for c in _COLS), *(pp[k] for k in _PP_KEYS)).filter(
        A.tenant_id.in_(tids),
        # the register's own filter: transient AI-pentest ad-hoc targets are not inventory
        func.coalesce(A.status, "") != "adhoc",
        func.coalesce(A.last_seen_source, "") != "pentest-adhoc",
    ).all()
    n = len(_COLS)
    assets = [SimpleNamespace(**dict(zip(_COLS, r[:n])),
                              platform_properties={k: v for k, v in zip(_PP_KEYS, r[n:]) if v is not None},
                              detected_software_json=None) for r in rows]
    ids = [a.id for a in assets]

    # Latest discovery evidence per asset: open ports + device type (EASM enrichment
    # carries exposed ports the same way). Newest observation wins.
    ports, dtypes = {}, {}
    if ids:
        try:
            O = DiscoveryObservation
            for aid, op, dt in db.query(O.resolved_asset_id, O.raw["open_ports"], O.raw["device_type"]).filter(
                    O.tenant_id.in_(tids), O.resolved_asset_id.isnot(None)).order_by(O.id.desc()):
                if aid not in ports:
                    ports[aid] = {int(p) for p in (op or []) if str(p).isdigit()}
                    dtypes[aid] = dt
        except Exception:  # noqa: BLE001 — discovery not provisioned on this tenant: no port evidence
            db.rollback()

    # Server-class hosts only: load installed software + service names so the
    # database-server role check (asset_signals role evidence) can run.
    # ponytail: loads those two blobs per server-class host; store a role flag if server counts reach ~10k.
    servers = {a.id: a for a in assets if not is_external(a)
               and classify_internal(a, (fingerprint(a).get("device_type") or dtypes.get(a.id)), fingerprint(a))[0] == "Server"}
    for i in range(0, len(servers), 500):
        chunk = list(servers)[i:i + 500]
        for aid, sw, svc in db.query(A.id, A.detected_software_json, pp["services"]).filter(A.id.in_(chunk)):
            servers[aid].detected_software_json = sw
            if svc is not None:
                servers[aid].platform_properties["services"] = svc

    # Endpoint security posture (a JSON blob) — internal hosts only; an outside-in asset
    # can never be read for AV/EDR, so there is no point loading it for the external side.
    # Chunked like the software load above so the blob never lands on every row at 5k.
    for a in assets:
        a.security_posture = None
    by_id = {a.id: a for a in assets}
    internal_ids = [a.id for a in assets if not is_external(a)]
    # The per-host software blob rides along for every internal host (not just servers) so
    # the estate-wide top-software + version rollup can aggregate it — same chunked query,
    # one extra column, no new round-trips.
    # ponytail: holds every internal host's software list in memory for one request; if
    # endpoint inventories ever make that too heavy, stream-aggregate it here instead.
    for i in range(0, len(internal_ids), 500):
        chunk = internal_ids[i:i + 500]
        for aid, sp, sw in db.query(A.id, A.security_posture, A.detected_software_json).filter(A.id.in_(chunk)):
            by_id[aid].security_posture = sp
            by_id[aid].detected_software_json = sw

    cis_ids: set = set()
    if ids:
        try:
            from grc.models import CompliancePluginRun as R
            cis_ids = {aid for (aid,) in db.query(R.asset_id).filter(
                R.tenant_id.in_(tids), R.is_leaked.is_(False), R.asset_id.isnot(None)).distinct()}
        except Exception:  # noqa: BLE001 — CIS table not provisioned yet: nothing benchmarked
            db.rollback()
    return summarize(assets, cis_ids, ports, dtypes, now)
