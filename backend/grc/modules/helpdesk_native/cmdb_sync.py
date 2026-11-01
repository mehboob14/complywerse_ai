"""CMDB ← ComplyVerse inventory sync (spec docs/HELPDESK_CMDB_INVENTORY_SYNC_SPEC.md).

Mirrors the REAL ComplyVerse IT-asset inventory into the Help Desk CMDB so ITSM
(incidents / changes / CAB) can target configuration items carrying the
inventory's rich signals (EASM / credentialed category, PCI scope, exposure,
OS, hardware, posture, installed software).

Design contract (see spec §1–§7):
  * Source of truth is the inventory, scoped by the SHARED predicate
    ``inventory_assets_only()`` (drops only the transient AI-pentest ad-hoc
    rows) — never re-implemented here.
  * Exposure (EASM vs Internal) is decided in EXACTLY ONE place,
    ``_is_external`` (see its docstring) — no other code path re-derives it.
  * Scan category is ``assets_router._scan_mode`` (lazy import; single source
    of truth), never re-derived.
  * Apex grouping uses the vendored pure module
    ``grc.modules.it_assets.asset_rollup`` so CMDB grouping matches the Asset
    Register by construction.
  * Idempotent: a second run with no inventory change writes nothing (0
    created / 0 updated). One transaction per run; any error rolls the whole
    run back. Dry run performs the identical computation and writes NOTHING.
  * Tenant-scoped throughout; CIs/edges/software never cross a tenant.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    GRCUser,
    HDBusinessService,
    HDCIRelationship,
    HDCIRelationshipType,
    HDCIType,
    HDConfigurationItem,
    HDImportBatch,
    ITAsset,
    get_db,
)
from ...routers.auth_router import require_auth
from ..it_assets.asset_rollup import is_external, registrable_domain, unit_key_for
from ..vuln_management._adhoc_filter import inventory_assets_only
from .audit import hd_audit
from .common import iso, require_settings_manage, require_settings_view, tenant_id

router = APIRouter(prefix="/helpdesk/admin/cmdb")

# ─── column-length guards (HDConfigurationItem) ────────────────────────────
_LEN_CODE = 40
_LEN_NAME = 200
_LEN_STATUS = 20
_LEN_CRIT = 20
_LEN_ENV = 20
_LEN_OWNER = 255

RETIRED = "retired"
IN_USE = "in_use"

# Relationship-type codes the sync wires (already seeded in tenant `ava`).
REL_CONTAINS = "REL-CONTAINS"     # domain  —contains→  endpoint
REL_INSTALLED = "REL-INSTALLED"   # software —installed on→ host
REL_RUNSON = "REL-RUNSON"         # app     —runs on→      parent host

# CI-type code for installed-software child CIs (ensured idempotently).
CIT_SOFTWARE = "CIT-SOFTWARE"

# Display names for the CI types the sync maps assets onto. The sync AUTO-CREATES
# any of these it needs (like CIT-SOFTWARE always has), so "sync from inventory"
# works on a fresh tenant with ZERO manual CI-type setup — previously a missing
# type silently SKIPPED every asset of that kind (QA: 0 of 12 hosts imported until
# you hand-created undocumented codes like CIT-SERVER).
_CIT_NAMES = {
    "CIT-SERVER": "Server",
    "CIT-WORKSTATION": "Workstation",
    "CIT-WEBSVC": "Web Service",
    "CIT-DBINST": "Database Instance",
    "CIT-NETDEV": "Network Device",
    "CIT-CLOUDSVC": "Cloud Service",
    "CIT-K8S": "Kubernetes Cluster",
    "CIT-APP": "Application",
    CIT_SOFTWARE: "Installed Software",
}
# Relationship types the sync creates (forward, inverse) — also auto-created, so
# software→host / domain→endpoint edges link instead of being skipped (which left
# software orphaned as "top-level" CIs and broke the CMDB counts).
_REL_DEFS = {
    REL_CONTAINS: ("Contains", "Contained by"),
    REL_INSTALLED: ("Installed on", "Has installed"),
    REL_RUNSON: ("Runs on", "Hosts"),
}

# ci_kind values (stored in attributes.ava.kind; derived onto /cis rows).
KIND_DOMAIN = "domain"
KIND_ENDPOINT = "endpoint"
KIND_HOST = "host"
KIND_SOFTWARE = "software"

# Default CI-type → standard business service (by service code). Applied ONLY to
# CI types that map to exactly one standard service with no ambiguity, and ONLY
# when the CI has no business service yet (admin assignments are never overwritten,
# per the spec's user-owned business_service_id). Deliberately NO entry for web
# endpoints / domains (CIT-WEBSVC): external EASM sites have no honest 1:1 internal
# service, so they stay unmapped for admin assignment rather than being guessed.
_DEFAULT_BS_BY_CITYPE = {
    "CIT-WORKSTATION": "SVC-0001",   # Managed Workstation (Laptop/Desktop)
    CIT_SOFTWARE: "SVC-0002",        # Desktop Software & Patching
}


# ═══════════════════════════════════════════════════════════════════════════
# Pure helpers (unit-tested — spec §2 / §3)
# ═══════════════════════════════════════════════════════════════════════════
def _trunc(value: Optional[str], limit: int) -> Optional[str]:
    """Clamp a string to a column length, NULL-safe."""
    if value is None:
        return None
    s = str(value)
    return s if len(s) <= limit else s[:limit]


def _without_synced(obj):
    """Deep copy with every ``synced_at`` key removed, so idempotency comparison
    ignores the per-run timestamp (spec §5: touch synced_at only when something
    else changed)."""
    if isinstance(obj, dict):
        return {k: _without_synced(v) for k, v in obj.items() if k != "synced_at"}
    if isinstance(obj, list):
        return [_without_synced(v) for v in obj]
    return obj


def _attrs_changed(before, after) -> bool:
    """True when two attribute blobs differ in anything but ``synced_at``."""
    return _without_synced(before) != _without_synced(after)


def _is_external(asset) -> bool:
    """EXPOSURE DECISION — the single source of truth for external vs internal.

    Delegates to the shared ``asset_rollup.is_external`` (internet_facing OR
    is_internet_facing OR origin_source=='easm' OR last_seen_source=='external')
    so the CMDB's exposure classification is identical to the Asset Register's by
    construction. No other code in this module may re-derive exposure — call
    ``_is_external`` everywhere.
    """
    return is_external(asset)


def _scan_category(asset) -> str:
    """The inventory scan category (``easm|credential|uncredential``), mapping
    ``None`` → ``"manual"``. Uses ``assets_router._scan_mode`` — the single
    source of truth — via a lazy import (assets_router is heavy and owned by
    another session)."""
    from grc.routers.assets_router import _scan_mode
    return _scan_mode(asset) or "manual"


# Windows CLIENT editions → workstation; Server editions / everything-else-with
# -an-OS → server (spec §2 step 4).
_WIN_CLIENT_EDITIONS = ("pro", "home", "enterprise", "education")


def _is_windows_client(asset) -> bool:
    fam = (getattr(asset, "os_family", None) or "").strip().lower()
    if fam != "windows":
        return False
    blob = " ".join(
        str(x or "").lower()
        for x in (
            getattr(asset, "os_normalized", None),
            getattr(asset, "os_version", None),
            getattr(asset, "os_edition", None),
            getattr(asset, "os_build", None),
        )
    )
    if "server" in blob:
        return False
    if "windows 10" in blob or "windows 11" in blob or "windows-10" in blob or "windows-11" in blob:
        return True
    return any(ed in blob for ed in _WIN_CLIENT_EDITIONS)


def map_ci_type_code(asset, category: str) -> str:
    """CI-type CODE for an inventory asset (spec §2, first match wins).

    1. platform_kind  2. asset_role=='application'  3. asset_type
    4. os_family set (Windows client / macOS → workstation, else server)
    5. easm with no other signal → web service   6. fallback → server
    """
    pk = (getattr(asset, "platform_kind", None) or "").strip().lower()
    # platform_kind='server' is the inventory's generic HOST detail model (a box
    # with CPU/RAM/OS), not a server role — a Windows 11 Pro desktop carries it
    # too. So for that kind the OS decides workstation vs server.
    if pk == "server" and (
        (getattr(asset, "os_family", None) or "").strip().lower() == "macos"
        or _is_windows_client(asset)
    ):
        return "CIT-WORKSTATION"
    if pk:
        mapping = {
            "server": "CIT-SERVER",
            "database": "CIT-DBINST",
            "network": "CIT-NETDEV",
            "cloud": "CIT-CLOUDSVC",
            "cluster": "CIT-K8S",
            "identity": "CIT-APP",
        }
        if pk in mapping:
            return mapping[pk]

    if (getattr(asset, "asset_role", None) or "").strip().lower() == "application":
        return "CIT-APP"

    at = (getattr(asset, "asset_type", None) or "").strip().lower()
    at_map = {
        "web": "CIT-WEBSVC",
        "cloud": "CIT-CLOUDSVC",
        "application": "CIT-APP",
        "data": "CIT-DBINST",
    }
    if at in at_map:
        return at_map[at]

    if (getattr(asset, "os_family", None) or "").strip():
        fam = (asset.os_family or "").strip().lower()
        if fam == "macos" or _is_windows_client(asset):
            return "CIT-WORKSTATION"
        return "CIT-SERVER"

    if category == "easm":
        return "CIT-WEBSVC"

    return "CIT-SERVER"


def _derive_pci(asset) -> bool:
    """PCI scope (spec §3): regulated_data_type in (pci|multiple), OR a CDE
    environment, OR 'PCI-DSS' in compliance_scope."""
    rdt = (getattr(asset, "regulated_data_type", None) or "").strip().lower()
    if rdt in ("pci", "multiple"):
        return True
    if bool(getattr(asset, "cde_environment", None)):
        return True
    scope = getattr(asset, "compliance_scope", None) or []
    try:
        return any(str(s).strip().upper() == "PCI-DSS" for s in scope)
    except TypeError:
        return False


def _asset_internet_facing(asset) -> bool:
    """Same exposure flag the ava mirror stores: is_internet_facing OR internet_facing."""
    return bool(getattr(asset, "is_internet_facing", None) or getattr(asset, "internet_facing", None))


def _aggregate_member_exposure(members) -> Tuple[str, bool, bool]:
    """Roll a synthetic domain's exposure up from its member endpoints (a synthetic
    domain has no inventory row of its own). category = easm when ALL members are
    easm, else the most common; internet_facing = ANY member internet-facing;
    pci = ANY member PCI. Pure — unit-tested."""
    cats = [_scan_category(m) for m in members]
    if cats and all(c == "easm" for c in cats):
        category = "easm"
    elif cats:
        category = Counter(cats).most_common(1)[0][0]
    else:
        category = "manual"
    internet = any(_asset_internet_facing(m) for m in members)
    pci = any(_derive_pci(m) for m in members)
    return category, internet, pci


def _owner_display(asset) -> Optional[str]:
    """Owner display string (spec §3): owning team name → primary owner display
    → owner_name."""
    team = getattr(asset, "owning_team_obj", None)
    if team is not None and getattr(team, "name", None):
        return team.name
    if getattr(asset, "owning_team", None):
        return asset.owning_team
    po = getattr(asset, "primary_owner", None)
    if po is not None:
        for attr in ("display_name", "full_name", "name", "email"):
            v = getattr(po, attr, None)
            if v:
                return v
    return getattr(asset, "owner_name", None)


def _asset_status(asset) -> str:
    """CI status from inventory lifecycle (spec §3)."""
    for field in ("status", "lifecycle_state"):
        v = (getattr(asset, field, None) or "").strip().lower()
        if v in ("decommissioned", "retired"):
            return RETIRED
    return IN_USE


def software_code(asset_id: int, software_key: str) -> str:
    """Unique, length-safe CI code for an installed-software child CI (spec §4).
    ``CV-SW-{asset_id}-{software_key}`` truncated to the 40-char column with a
    deterministic hash suffix when it would overflow, so codes stay unique."""
    key = software_key or "unknown"
    raw = f"CV-SW-{asset_id}-{key}"
    if len(raw) <= _LEN_CODE:
        return raw
    h = hashlib.sha1(f"{asset_id}:{key}".encode("utf-8", "replace")).hexdigest()[:8]
    prefix = f"CV-SW-{asset_id}-"
    keep = _LEN_CODE - len(prefix) - 9  # room for "-" + 8-hex hash
    if keep < 0:
        keep = 0
    return (prefix + key[:keep] + "-" + h)[:_LEN_CODE]


def _software_key(entry: dict, idx: int) -> str:
    """The stable key for a detected-software entry."""
    k = entry.get("software_key") or entry.get("name") or f"sw{idx}"
    return str(k)


_SEV_KEYS = ("critical", "high", "medium", "low", "info")


def _asset_security_summaries(db: Session, tid: int, asset_ids: List[int]) -> Dict[int, dict]:
    """Per-asset OPEN-vulnerability + risk snapshot for the ava mirror — the
    Help Desk ↔ security linkage (so a ticket's CI can show the asset's real
    exposure/vuln/risk story, spec: ticket→asset security).

    STRICTLY READ-ONLY over the security side: reuses the canonical
    ``VulnerabilityAssetLink`` ↔ ``Vulnerability`` join and the register's own
    ``_LIST_CLOSED_STATUSES`` (so "open" means exactly what the vuln register
    means) plus the latest ``AssetRiskAssessment.risk_score``. Batched (two
    grouped queries, no N+1). Best-effort: ANY failure (module/table absent on a
    branch, schema drift) yields {} so a CMDB sync is never blocked by the
    security modules. Keyed asset_id -> {open, <severity counts>, risk_score,
    last_finding_at}."""
    if not asset_ids:
        return {}
    out: Dict[int, dict] = {}
    try:
        from ...models import Vulnerability, VulnerabilityAssetLink, AssetRiskAssessment
        from ..vuln_management.routers.vulnerabilities import _LIST_CLOSED_STATUSES
        closed = [s.lower() for s in _LIST_CLOSED_STATUSES]

        def _blank() -> dict:
            d = {"open": 0, "risk_score": None, "last_finding_at": None}
            d.update({k: 0 for k in _SEV_KEYS})
            return d

        # Open findings per asset × severity + newest finding timestamp (1 query).
        rows = (
            db.query(
                VulnerabilityAssetLink.asset_id,
                func.lower(Vulnerability.severity),
                func.count(func.distinct(Vulnerability.id)),
                func.max(Vulnerability.discovered_at),
            )
            .join(Vulnerability, Vulnerability.id == VulnerabilityAssetLink.vulnerability_id)
            .filter(
                VulnerabilityAssetLink.asset_id.in_(asset_ids),
                Vulnerability.tenant_id == tid,
                func.lower(func.coalesce(Vulnerability.status, "open")).notin_(closed),
            )
            .group_by(VulnerabilityAssetLink.asset_id, func.lower(Vulnerability.severity))
            .all()
        )
        for aid, sev, cnt, last_at in rows:
            s = out.setdefault(aid, _blank())
            cnt = int(cnt or 0)
            s["open"] += cnt
            sev = (sev or "").strip().lower()
            if sev in _SEV_KEYS:
                s[sev] += cnt
            iso_last = last_at.isoformat() if last_at else None
            if iso_last and (s["last_finding_at"] is None or iso_last > s["last_finding_at"]):
                s["last_finding_at"] = iso_last

        # Latest risk score per asset (1 query over the newest assessment date).
        try:
            latest = (
                db.query(
                    AssetRiskAssessment.asset_id,
                    func.max(AssetRiskAssessment.assessment_date).label("latest"),
                )
                .filter(AssetRiskAssessment.asset_id.in_(asset_ids))
                .group_by(AssetRiskAssessment.asset_id)
                .subquery()
            )
            for aid, score in (
                db.query(AssetRiskAssessment.asset_id, AssetRiskAssessment.risk_score)
                .join(
                    latest,
                    (AssetRiskAssessment.asset_id == latest.c.asset_id)
                    & (AssetRiskAssessment.assessment_date == latest.c.latest),
                )
                .all()
            ):
                out.setdefault(aid, _blank())["risk_score"] = (
                    round(float(score), 1) if score is not None else None
                )
        except Exception:  # noqa: BLE001 — risk score is optional; findings still count
            pass
    except Exception:  # noqa: BLE001 — security modules are optional; never block a sync
        return {}
    return out


def _ava_mirror(asset, category: str, synced_at: str, security: Optional[dict] = None) -> Dict[str, Any]:
    """The full ``attributes.ava`` mirror (spec §3). Sync owns this key and
    overwrites it each run. ``security`` is the read-only open-vuln/risk snapshot
    from ``_asset_security_summaries`` (None when the asset has no findings or the
    security modules are unavailable)."""
    credentialed = category == "credential"
    internet_facing = bool(
        getattr(asset, "is_internet_facing", None) or getattr(asset, "internet_facing", None)
    )
    return {
        "asset_id": asset.id,
        "asset_url": f"/assets/{asset.id}",
        "synced_at": synced_at,
        "source": {
            "category": category,
            "origin_source": getattr(asset, "origin_source", None),
            "last_seen_source": getattr(asset, "last_seen_source", None),
            "last_seen_at": iso(getattr(asset, "last_seen_at", None)),
            "first_seen_at": iso(getattr(asset, "first_seen_at", None)),
            "discovery_state": getattr(asset, "discovery_state", None),
            "credentialed": credentialed,
        },
        "network": {
            "fqdn": getattr(asset, "fqdn", None),
            "ip_address": getattr(asset, "ip_address", None),
            "known_ips": getattr(asset, "known_ips", None),
            "dns_aliases": getattr(asset, "dns_aliases", None),
            "primary_mac": getattr(asset, "primary_mac", None),
            "network_segment": getattr(asset, "network_segment", None),
            "internet_facing": internet_facing,
        },
        "os": {
            "family": getattr(asset, "os_family", None),
            "version": getattr(asset, "os_version", None),
            "normalized": getattr(asset, "os_normalized", None),
            "build": getattr(asset, "os_build", None),
            "edition": getattr(asset, "os_edition", None),
        },
        "hardware": {
            "cpu_cores": getattr(asset, "cpu_cores", None),
            "memory_gb": getattr(asset, "memory_gb", None),
            "storage_gb": getattr(asset, "storage_gb", None),
            "manufacturer": getattr(asset, "manufacturer", None),
            "model": getattr(asset, "model", None),
            "serial_number": getattr(asset, "serial_number", None),
        },
        "compliance": {
            "pci": _derive_pci(asset),
            "regulated_data_type": getattr(asset, "regulated_data_type", None),
            "cde_environment": bool(getattr(asset, "cde_environment", None)),
            "ephi_environment": bool(getattr(asset, "ephi_environment", None)),
            "compliance_scope": getattr(asset, "compliance_scope", None),
            "data_classification": getattr(asset, "data_classification", None),
        },
        "security_posture": getattr(asset, "security_posture", None),
        # Read-only open-vuln / risk snapshot (Help Desk ↔ security linkage).
        "security": security,
        # platform_properties (full services/DIMM/firmware dump) is deliberately
        # NOT mirrored: nothing renders it, and it bloated every /cis row into
        # multi-MB payloads that stalled the affected-CI picker. Kind is kept —
        # it's tiny and map_ci_type_code reads it off the asset directly anyway.
        "platform": {
            "kind": getattr(asset, "platform_kind", None),
        },
    }


# Best-effort map of inventory values onto a CI type's own defined attribute
# names (spec §3 — fill where an inventory value maps). Keyed by a normalized
# attribute name; value is a getter against the asset.
def _inventory_attr_fill(asset) -> Dict[str, Any]:
    fam = getattr(asset, "os_family", None)
    osver = getattr(asset, "os_version", None)
    candidates = {
        "hostname": getattr(asset, "host_name", None) or getattr(asset, "fqdn", None),
        "fqdn": getattr(asset, "fqdn", None),
        "ip_address": getattr(asset, "ip_address", None),
        "ip address": getattr(asset, "ip_address", None),
        "serial_number": getattr(asset, "serial_number", None),
        "serial number": getattr(asset, "serial_number", None),
        "os": fam,
        "os_version": osver,
        "os version": osver,
        "manufacturer": getattr(asset, "manufacturer", None),
        "model": getattr(asset, "model", None),
        "environment": getattr(asset, "environment", None),
    }
    return {k: v for k, v in candidates.items() if v is not None}


# ═══════════════════════════════════════════════════════════════════════════
# Sync service
# ═══════════════════════════════════════════════════════════════════════════
def _group_name(asset) -> str:
    """The DNS name used for apex grouping — same precedence the shared
    ``unit_key_for`` uses (fqdn → host_name → name)."""
    return (getattr(asset, "fqdn", None) or getattr(asset, "host_name", None)
            or getattr(asset, "name", None) or "")


def _apex_name(asset) -> Optional[str]:
    """The apex when this external asset's own grouping name IS its apex domain."""
    gn = _group_name(asset)
    name = gn.strip().lower().rstrip(".")
    apex = registrable_domain(gn)
    return apex if (apex and name == apex) else None


def sync_inventory_to_cmdb(
    db: Session,
    tid: int,
    *,
    dry_run: bool,
    actor_email: Optional[str] = None,
) -> dict:
    """Mirror the inventory into the CMDB for one tenant (spec §1–§5).

    Pure-ish: it reads the inventory + existing CMDB, computes the full plan,
    and (unless ``dry_run``) applies it inside the caller's session in ONE
    transaction — any exception rolls the whole run back. ``dry_run`` performs
    the identical computation and writes nothing.
    """
    synced_at = datetime.utcnow()
    synced_iso = synced_at.isoformat()

    summary: Dict[str, Any] = {
        "dry_run": dry_run,
        "inventory_count": 0,
        "created": 0,
        "updated": 0,
        "unchanged": 0,
        "retired": 0,
        "restored": 0,
        "software_created": 0,
        "software_updated": 0,
        "software_retired": 0,
        "relationships_created": 0,
        "relationships_removed": 0,
        "by_category": {"easm": 0, "credential": 0, "uncredential": 0, "manual": 0},
        "by_ci_type": {},
        "by_exposure": {"external_domains": 0, "external_endpoints": 0, "internal": 0},
        "skipped": [],
        "sample": [],
        "finished_at": None,
    }

    def _sample(action: str, asset_id, name, ci_type, category):
        if len(summary["sample"]) < 50:
            summary["sample"].append({
                "action": action, "asset_id": asset_id, "name": name,
                "ci_type": ci_type, "category": category,
            })

    # ── 1. inventory scope (shared predicate) ───────────────────────────────
    assets: List[ITAsset] = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tid, *inventory_assets_only(ITAsset))
        .all()
    )
    summary["inventory_count"] = len(assets)
    assets_by_id = {a.id: a for a in assets}

    # Read-only Ava-security snapshot per asset (open vulns / risk) for the ava
    # mirror, so a ticket's CI can show the asset's real exposure/vuln/risk story.
    # Batched + best-effort; never blocks a sync (see helper docstring).
    security_by_asset = _asset_security_summaries(db, tid, list(assets_by_id))

    # ── 2. CI-type code → row map (ensure CIT-SOFTWARE) ──────────────────────
    ci_types = {t.code: t for t in db.query(HDCIType).filter(HDCIType.tenant_id == tid).all()}
    soft_type = ci_types.get(CIT_SOFTWARE)
    if soft_type is None:
        if not dry_run:
            soft_type = HDCIType(
                tenant_id=tid, code=CIT_SOFTWARE, name="Installed Software",
                description="Software detected on a host by ComplyVerse inventory (sync-owned).",
            )
            db.add(soft_type)
            db.flush()
        else:
            # dry run can't write, but must still PLAN software CIs as if the
            # type were ensured first (a real run would create it before use).
            soft_type = _PlaceholderType(CIT_SOFTWARE, "Installed Software")
        ci_types[CIT_SOFTWARE] = soft_type

    type_name_by_code = {c: t.name for c, t in ci_types.items()}

    # defined attribute names per CI-type id (for the best-effort inventory fill)
    from ...models import HDCIAttribute
    attr_names_by_type: Dict[int, set] = {}
    if ci_types:
        tids = [t.id for t in ci_types.values() if t.id is not None]
        for a in db.query(HDCIAttribute).filter(HDCIAttribute.ci_type_id.in_(tids)).all():
            attr_names_by_type.setdefault(a.ci_type_id, set()).add(a.name)

    # ── 3. existing CMDB state (tenant-scoped) ───────────────────────────────
    existing_cis: List[HDConfigurationItem] = (
        db.query(HDConfigurationItem).filter(HDConfigurationItem.tenant_id == tid).all()
    )
    ci_by_asset_id: Dict[int, HDConfigurationItem] = {
        c.ava_asset_id: c for c in existing_cis if c.ava_asset_id is not None
    }
    ci_by_code: Dict[str, HDConfigurationItem] = {c.code: c for c in existing_cis}

    # Resolve the default CI-type→business-service map (code → id) once. Only codes
    # that actually exist as standard services are usable. Tolerant of a tenant /
    # test DB with no business-service catalogue (then no defaults are applied).
    try:
        _bs_id_by_code = {
            s.code: s.id for s in db.query(HDBusinessService)
            .filter(HDBusinessService.tenant_id == tid,
                    HDBusinessService.code.in_(set(_DEFAULT_BS_BY_CITYPE.values()))).all()
        }
    except Exception:  # noqa: BLE001 — no catalogue table / rows → no defaults
        _bs_id_by_code = {}

    def _default_bs_id(ci_type_code: str) -> Optional[int]:
        return _bs_id_by_code.get(_DEFAULT_BS_BY_CITYPE.get(ci_type_code, ""))

    def _is_managed(ci: HDConfigurationItem) -> bool:
        return isinstance(ci.attributes, dict) and "ava" in (ci.attributes or {})

    managed_cis = [c for c in existing_cis if _is_managed(c)]

    rel_types = {
        r.code: r for r in db.query(HDCIRelationshipType).filter(HDCIRelationshipType.tenant_id == tid).all()
    }
    existing_edges = (
        db.query(HDCIRelationship)
        .join(HDConfigurationItem, HDCIRelationship.source_ci_id == HDConfigurationItem.id)
        .filter(HDConfigurationItem.tenant_id == tid)
        .all()
    )
    edge_set = {(e.source_ci_id, e.target_ci_id, e.rel_type_id) for e in existing_edges}

    # CIs created THIS run but not yet flushed need ids to wire edges; collect
    # edge intentions as (source_ci, target_ci, rel_code) and resolve after flush.
    planned_edges: List[Tuple[Any, Any, str]] = []
    # software CIs we touched this run, keyed by code → to compute removals.
    touched_sw_codes: set = set()
    # host CI (object) per asset id that should carry software / run-on edges.
    host_ci_for_asset: Dict[int, Any] = {}

    # ─── upsert one host/endpoint/domain CI by ava_asset_id ──────────────────
    def _upsert_asset_ci(asset, ci_type_code: str, kind: str,
                         domain_block: Optional[dict] = None):
        nonlocal summary
        category = _scan_category(asset)
        tcode = ci_type_code
        # Auto-create the CI type if the tenant doesn't have it yet, so a fresh
        # CMDB syncs every host instead of skipping them for a missing type code.
        ci_type_row = _ensure_ci_type(db, tid, ci_types, tcode, dry_run, type_name_by_code)

        status = _asset_status(asset)
        desired_name = _trunc(asset.name, _LEN_NAME)
        owner = _trunc(_owner_display(asset), _LEN_OWNER)
        crit = _trunc(asset.criticality, _LEN_CRIT)
        env = _trunc(getattr(asset, "environment", None), _LEN_ENV)

        existing = ci_by_asset_id.get(asset.id)
        # Build desired attributes: preserve user keys, overwrite ava mirror,
        # fill defined attribute names, set kind/domain markers.
        base_attrs: Dict[str, Any] = {}
        if existing is not None and isinstance(existing.attributes, dict):
            base_attrs = dict(existing.attributes)
        base_attrs["ava"] = _ava_mirror(asset, category, synced_iso,
                                        security=security_by_asset.get(asset.id))
        base_attrs["ava"]["kind"] = kind
        if domain_block is not None:
            base_attrs["ava"]["domain"] = domain_block
        # best-effort fill of the CI type's own defined attribute names
        defined = attr_names_by_type.get(ci_type_row.id, set())
        if defined:
            fill = _inventory_attr_fill(asset)
            lowered = {k.lower(): v for k, v in fill.items()}
            for an in defined:
                if an in base_attrs and an != "ava":
                    continue  # don't clobber a user-entered value
                v = lowered.get(an.lower())
                if v is not None:
                    base_attrs[an] = v

        category_name = type_name_by_code.get(tcode, tcode)

        if existing is None:
            if not dry_run:
                row = HDConfigurationItem(
                    tenant_id=tid, code=_trunc(f"CV-{asset.id}", _LEN_CODE),
                    name=desired_name, ci_type_id=ci_type_row.id,
                    status=status, criticality=crit, environment=env,
                    owner=owner, ava_asset_id=asset.id, attributes=base_attrs,
                    business_service_id=_default_bs_id(tcode),
                )
                db.add(row)
                db.flush()
                ci_by_asset_id[asset.id] = row
                ci_by_code[row.code] = row
                host_ci_for_asset[asset.id] = row
            else:
                host_ci_for_asset[asset.id] = _Placeholder(asset.id)
            summary["created"] += 1
            summary["by_ci_type"][category_name] = summary["by_ci_type"].get(category_name, 0) + 1
            summary["by_category"][category] = summary["by_category"].get(category, 0) + 1
            _sample("create", asset.id, asset.name, tcode, category)
            return host_ci_for_asset[asset.id]

        # UPDATE path: compare field-by-field; only write + touch synced_at when
        # something actually changed (idempotency §5).
        host_ci_for_asset[asset.id] = existing
        # back-fill the default business service ONLY when the CI has none (never
        # overwrite an admin assignment).
        bs_fill = (existing.business_service_id is None and _default_bs_id(tcode) is not None)
        changed = (
            existing.name != desired_name
            or existing.ci_type_id != ci_type_row.id
            or existing.status != status
            or existing.criticality != crit
            or existing.environment != env
            or existing.owner != owner
            or bs_fill
            or _attrs_changed(existing.attributes, base_attrs)
        )
        summary["by_ci_type"][category_name] = summary["by_ci_type"].get(category_name, 0) + 1
        summary["by_category"][category] = summary["by_category"].get(category, 0) + 1
        if not changed:
            summary["unchanged"] += 1
            return existing
        if not dry_run:
            existing.name = desired_name
            existing.ci_type_id = ci_type_row.id
            existing.status = status
            existing.criticality = crit
            existing.environment = env
            existing.owner = owner
            existing.attributes = base_attrs
            if bs_fill:
                existing.business_service_id = _default_bs_id(tcode)
        summary["updated"] += 1
        _sample("update", asset.id, asset.name, tcode, category)
        # a previously-retired CI that is back in scope is a restore
        if existing.status == RETIRED and status != RETIRED:
            summary["restored"] += 1
        return existing

    # ── 4. grouping via the shared unit_key_for (§2b) ────────────────────────
    # Distinct keys are the top-level units: external groupable → apex domain,
    # external non-groupable → "id:<n>" standalone, internal → "int:<id>"
    # standalone (internal is never merged).
    groups: Dict[str, List[ITAsset]] = {}
    for a in assets:
        groups.setdefault(unit_key_for(a), []).append(a)

    # track which synthetic-domain codes are still backed by members this run
    live_synth_domain_codes: set = set()

    for key, members in groups.items():
        if key.startswith("int:"):
            # internal → flat standalone host CI
            summary["by_exposure"]["internal"] += 1
            a = members[0]
            _upsert_asset_ci(a, map_ci_type_code(a, _scan_category(a)), KIND_HOST)
            continue
        if key.startswith("id:"):
            # non-groupable external (bare IP / single label) → standalone host CI
            a = members[0]
            _upsert_asset_ci(a, map_ci_type_code(a, _scan_category(a)), KIND_HOST)
            continue

        apex = key
        summary["by_exposure"]["external_domains"] += 1
        apex_asset = next((m for m in members if _apex_name(m) == apex), None)
        endpoints = [m for m in members if m is not apex_asset]
        endpoint_ids = [m.id for m in endpoints]
        domain_block = {
            "apex": apex,
            "endpoint_count": len(endpoints),
            "member_asset_ids": endpoint_ids,
        }

        # domain CI
        if apex_asset is not None:
            domain_ci = _upsert_asset_ci(apex_asset, "CIT-WEBSVC", KIND_DOMAIN, domain_block)
        else:
            domain_ci = _upsert_synthetic_domain(
                db, tid, apex, domain_block, ci_types, dry_run, summary,
                ci_by_code, synced_iso, members,
            )
            live_synth_domain_codes.add(f"CV-DOM-{apex}")

        # endpoint CIs + REL-CONTAINS edges
        for ep in endpoints:
            summary["by_exposure"]["external_endpoints"] += 1
            ep_ci = _upsert_asset_ci(ep, map_ci_type_code(ep, _scan_category(ep)), KIND_ENDPOINT)
            if domain_ci is not None and ep_ci is not None:
                planned_edges.append((domain_ci, ep_ci, REL_CONTAINS))

    # ── 4b. installed software (after ALL host CIs exist, so promoted-app
    #        REL-RUNSON edges resolve regardless of processing order) ─────────
    for a in assets:
        _plan_software(a, db, tid, ci_types, dry_run, summary, synced_iso,
                       planned_edges, touched_sw_codes, ci_by_code, host_ci_for_asset,
                       assets_by_id, _default_bs_id(CIT_SOFTWARE))

    # ── 5. retire CIs whose asset left scope (+ their software) ──────────────
    current_asset_ids = set(assets_by_id)
    for ci in managed_cis:
        ava = (ci.attributes or {}).get("ava") if isinstance(ci.attributes, dict) else None
        kind = (ava or {}).get("kind")
        if ci.ava_asset_id is not None:
            if ci.ava_asset_id not in current_asset_ids and ci.status != RETIRED:
                if not dry_run:
                    ci.status = RETIRED
                summary["retired"] += 1
                _sample("retire", ci.ava_asset_id, ci.name, None, None)
                _retire_software_of_host(db, tid, ci, dry_run, summary, edge_set,
                                         rel_types)
        elif kind == KIND_DOMAIN and ci.code.startswith("CV-DOM-"):
            # synthetic domain no longer backed by members → retire
            if ci.code not in live_synth_domain_codes and ci.status != RETIRED:
                if not dry_run:
                    ci.status = RETIRED
                summary["retired"] += 1
                _sample("retire", None, ci.name, "CIT-WEBSVC", None)

    # ── 6. resolve planned edges (check unique triple before insert) ─────────
    _materialize_edges(db, tid, planned_edges, rel_types, edge_set, dry_run, summary)

    # ── 7. remove software edges/CIs no longer detected ──────────────────────
    _remove_stale_software(db, tid, managed_cis, touched_sw_codes, current_asset_ids,
                           dry_run, summary, edge_set, rel_types)

    summary["finished_at"] = datetime.utcnow().isoformat()

    # ── 8. persist (real run only): audit + batch + commit ───────────────────
    if not dry_run:
        try:
            hd_audit(
                db, tenant_id=tid, actor_email=actor_email,
                action="cmdb.inventory_sync", entity="cmdb", entity_id=None,
                after={
                    "inventory_count": summary["inventory_count"],
                    "created": summary["created"], "updated": summary["updated"],
                    "retired": summary["retired"], "restored": summary["restored"],
                    "software_created": summary["software_created"],
                    "software_retired": summary["software_retired"],
                },
            )
            batch = HDImportBatch(
                tenant_id=tid,
                bundle_version="inventory_sync",
                source_filename=f"inventory_sync@{summary['finished_at']}",
                status="applied",
                summary=summary,
                imported_by=actor_email,
                imported_at=synced_at,
            )
            db.add(batch)
            db.commit()
        except Exception:
            db.rollback()
            raise

    return summary


class _Placeholder:
    """Stand-in CI for a would-be-created row during a DRY RUN, so edge planning
    still counts relationships without writing. Carries no id."""
    def __init__(self, asset_id):
        self.id = None
        self.ava_asset_id = asset_id


class _PlaceholderType:
    """Stand-in CI type for CIT-SOFTWARE during a DRY RUN when it does not yet
    exist (a real run ensures it first). Lets software planning/counting run
    without writing."""
    def __init__(self, code, name):
        self.id = None
        self.code = code
        self.name = name


def _ensure_ci_type(db, tid, ci_types, code, dry_run, type_name_by_code=None):
    """Return the CI type for `code`, creating it if missing (mirrors the
    CIT-SOFTWARE ensure) so the sync never skips an asset for a not-yet-created
    type. Dry run returns a placeholder so planning/counting runs without writing."""
    t = ci_types.get(code)
    if t is not None:
        return t
    name = _CIT_NAMES.get(code, code)
    if dry_run:
        t = _PlaceholderType(code, name)
    else:
        t = HDCIType(tenant_id=tid, code=code, name=name,
                     description="Auto-created by the ComplyVerse inventory sync.")
        db.add(t)
        db.flush()
    ci_types[code] = t
    if type_name_by_code is not None:
        type_name_by_code[code] = name
    return t


def _ensure_rel_type(db, tid, rel_types, code, dry_run):
    """Return the relationship type for `code`, creating it if missing, so the
    containment edges (software→host, domain→endpoint) link instead of being
    skipped — which otherwise orphans software as top-level CIs."""
    rt = rel_types.get(code)
    if rt is not None:
        return rt
    fwd, inv = _REL_DEFS.get(code, (code, None))
    if dry_run:
        rt = _PlaceholderType(code, fwd)
    else:
        rt = HDCIRelationshipType(tenant_id=tid, code=code, name=fwd, inverse_name=inv)
        db.add(rt)
        db.flush()
    rel_types[code] = rt
    return rt


def _upsert_synthetic_domain(db, tid, apex, domain_block, ci_types, dry_run,
                             summary, ci_by_code, synced_iso, members):
    code = _trunc(f"CV-DOM-{apex}", _LEN_CODE)
    webtype = _ensure_ci_type(db, tid, ci_types, "CIT-WEBSVC", dry_run)
    # Synthetic domains have no inventory row, so inherit exposure/category from the
    # members (coordinator fix) — otherwise _inventory_derived reports Internal / no
    # category for them in GET /cis.
    category, internet, pci = _aggregate_member_exposure(members)
    attrs = {"ava": {"asset_id": None, "kind": KIND_DOMAIN, "synced_at": synced_iso,
                     "domain": domain_block,
                     "source": {"category": category, "credentialed": category == "credential"},
                     "network": {"internet_facing": internet},
                     "compliance": {"pci": pci}}}
    existing = ci_by_code.get(code)
    tname = webtype.name
    if existing is None:
        if not dry_run:
            row = HDConfigurationItem(
                tenant_id=tid, code=code, name=_trunc(apex, _LEN_NAME),
                ci_type_id=webtype.id, status=IN_USE, ava_asset_id=None, attributes=attrs,
            )
            db.add(row)
            db.flush()
            ci_by_code[code] = row
        else:
            row = _Placeholder(None)
            row.code = code
        summary["created"] += 1
        summary["by_ci_type"][tname] = summary["by_ci_type"].get(tname, 0) + 1
        return row
    # update synthetic domain if its membership changed or it was retired
    changed = _attrs_changed(existing.attributes, attrs) or (existing.status == RETIRED)
    if changed:
        if not dry_run:
            existing.attributes = attrs
            if existing.status == RETIRED:
                existing.status = IN_USE
                summary["restored"] += 1
            existing.name = _trunc(apex, _LEN_NAME)
        summary["updated"] += 1
    else:
        summary["unchanged"] += 1
    return existing


def _plan_software(asset, db, tid, ci_types, dry_run, summary, synced_iso,
                   planned_edges, touched_sw_codes, ci_by_code, host_ci_for_asset,
                   assets_by_id, software_bs_id=None):
    """Installed-software child CIs + REL-INSTALLED edges, and promoted-app
    REL-RUNSON edges (spec §4). ``software_bs_id`` is the default business service
    for software CIs (None = leave unassigned)."""
    host_ci = host_ci_for_asset.get(asset.id)
    soft_type = ci_types.get(CIT_SOFTWARE)
    entries = getattr(asset, "detected_software_json", None) or []
    if not isinstance(entries, list):
        entries = []

    for idx, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        promoted = entry.get("promoted_asset_id")
        if promoted:
            # promoted software is itself an inventory asset → its own host CI;
            # just wire app —runs on→ parent host (no duplicate software CI).
            promoted_ci = host_ci_for_asset.get(promoted)
            # parent host = the asset that detected it (its parent_asset_id or this host)
            promoted_asset = assets_by_id.get(promoted)
            parent_id = getattr(promoted_asset, "parent_asset_id", None) if promoted_asset else None
            parent_ci = host_ci_for_asset.get(parent_id) if parent_id else host_ci
            if promoted_ci is not None and parent_ci is not None:
                planned_edges.append((promoted_ci, parent_ci, REL_RUNSON))
            continue

        if soft_type is None:
            # cannot place software without the type; counted as skip once
            summary["skipped"].append({
                "asset_id": asset.id, "name": entry.get("name"),
                "reason": "CI type CIT-SOFTWARE unavailable",
            })
            continue

        key = _software_key(entry, idx)
        code = software_code(asset.id, key)
        touched_sw_codes.add(code)
        sw_attrs = {
            "version": entry.get("version"),
            "publisher": entry.get("publisher"),
            "source": entry.get("source"),
            "software_key": key,
            "benchmark_available": entry.get("benchmark_available"),
            "ava": {"host_asset_id": asset.id, "synced_at": synced_iso},
        }
        sw_name = _trunc(entry.get("name") or key, _LEN_NAME)
        existing = ci_by_code.get(code)
        tname = soft_type.name
        if existing is None:
            if not dry_run:
                row = HDConfigurationItem(
                    tenant_id=tid, code=code, name=sw_name, ci_type_id=soft_type.id,
                    status=IN_USE, ava_asset_id=None, attributes=sw_attrs,
                    business_service_id=software_bs_id,
                )
                db.add(row)
                db.flush()
                ci_by_code[code] = row
            else:
                row = _Placeholder(None)
                row.code = code
            summary["software_created"] += 1
            summary["by_ci_type"][tname] = summary["by_ci_type"].get(tname, 0) + 1
            sw_ci = row
        else:
            sw_bs_fill = (existing.business_service_id is None and software_bs_id is not None)
            changed = (_attrs_changed(existing.attributes, sw_attrs) or existing.name != sw_name
                       or existing.status == RETIRED or sw_bs_fill)
            if changed:
                if not dry_run:
                    existing.attributes = sw_attrs
                    existing.name = sw_name
                    existing.status = IN_USE
                    if sw_bs_fill:
                        existing.business_service_id = software_bs_id
                summary["software_updated"] += 1
            sw_ci = existing
        if host_ci is not None and sw_ci is not None:
            planned_edges.append((sw_ci, host_ci, REL_INSTALLED))


def _materialize_edges(db, tid, planned_edges, rel_types, edge_set, dry_run, summary):
    for source_ci, target_ci, rel_code in planned_edges:
        # Auto-create the relationship type if missing, so containment edges link
        # (software→host, domain→endpoint) instead of being skipped.
        rt = _ensure_rel_type(db, tid, rel_types, rel_code, dry_run)
        sid = getattr(source_ci, "id", None)
        tgid = getattr(target_ci, "id", None)
        if dry_run:
            # can't resolve ids for not-yet-created CIs; count as a new edge
            # unless both already exist and the triple is already present.
            if sid is not None and tgid is not None and (sid, tgid, rt.id) in edge_set:
                continue
            summary["relationships_created"] += 1
            continue
        if sid is None or tgid is None:
            continue
        triple = (sid, tgid, rt.id)
        if triple in edge_set:
            continue
        db.add(HDCIRelationship(source_ci_id=sid, target_ci_id=tgid, rel_type_id=rt.id))
        edge_set.add(triple)
        summary["relationships_created"] += 1


def _retire_software_of_host(db, tid, host_ci, dry_run, summary, edge_set, rel_types):
    """Retire software children of a host CI and remove their REL-INSTALLED
    edges (host left scope)."""
    rt = rel_types.get(REL_INSTALLED)
    if host_ci.id is None:
        return
    edges = (
        db.query(HDCIRelationship)
        .filter(HDCIRelationship.target_ci_id == host_ci.id)
        .all()
    )
    for e in edges:
        if rt is not None and e.rel_type_id != rt.id:
            continue
        sw = db.query(HDConfigurationItem).filter(
            HDConfigurationItem.id == e.source_ci_id,
            HDConfigurationItem.tenant_id == tid,
        ).first()
        if sw is not None and sw.status != RETIRED:
            if not dry_run:
                sw.status = RETIRED
            summary["software_retired"] += 1
        if not dry_run:
            edge_set.discard((e.source_ci_id, e.target_ci_id, e.rel_type_id))
            db.delete(e)
        summary["relationships_removed"] += 1


def _remove_stale_software(db, tid, managed_cis, touched_sw_codes, current_asset_ids,
                           dry_run, summary, edge_set, rel_types):
    """Software CIs no longer detected on re-sync → retired + REL-INSTALLED edge
    removed (spec §4)."""
    rt = rel_types.get(REL_INSTALLED)
    for ci in managed_cis:
        # software CIs are the ones whose ava mirror carries host_asset_id.
        is_software = (
            isinstance(ci.attributes, dict)
            and isinstance(ci.attributes.get("ava"), dict)
            and "host_asset_id" in ci.attributes["ava"]
        )
        if not is_software:
            continue
        host_id = ci.attributes["ava"].get("host_asset_id")
        # Still detected this run (code touched) → keep. The host leaving scope is
        # handled by _retire_software_of_host; here we catch software dropped while
        # the host remains.
        if ci.code in touched_sw_codes:
            continue
        if host_id not in current_asset_ids:
            continue  # host gone — already retired via host-retire path
        if ci.status != RETIRED:
            if not dry_run:
                ci.status = RETIRED
            summary["software_retired"] += 1
        # remove its REL-INSTALLED edge
        if ci.id is not None:
            edges = db.query(HDCIRelationship).filter(
                HDCIRelationship.source_ci_id == ci.id
            ).all()
            for e in edges:
                if rt is not None and e.rel_type_id != rt.id:
                    continue
                if not dry_run:
                    edge_set.discard((e.source_ci_id, e.target_ci_id, e.rel_type_id))
                    db.delete(e)
                summary["relationships_removed"] += 1


# ═══════════════════════════════════════════════════════════════════════════
# API (spec §6)
# ═══════════════════════════════════════════════════════════════════════════
@router.post("/sync-from-inventory")
def sync_from_inventory(dry_run: bool = Query(False), db: Session = Depends(get_db),
                        current_user: GRCUser = Depends(require_auth),
                        _: bool = Depends(require_settings_manage)):
    tid = tenant_id(db)
    return sync_inventory_to_cmdb(db, tid, dry_run=dry_run, actor_email=current_user.email)


@router.get("/sync-status")
def sync_status(db: Session = Depends(get_db), _: bool = Depends(require_settings_view)):
    tid = tenant_id(db)
    last = (
        db.query(HDImportBatch)
        .filter(HDImportBatch.tenant_id == tid, HDImportBatch.bundle_version == "inventory_sync")
        .order_by(HDImportBatch.id.desc())
        .first()
    )
    linked = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.tenant_id == tid, HDConfigurationItem.ava_asset_id.isnot(None))
        .count()
    )
    retired = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.tenant_id == tid,
                HDConfigurationItem.ava_asset_id.isnot(None),
                HDConfigurationItem.status == RETIRED)
        .count()
    )
    # Installed-software CIs are per-host drill-down detail, not estate: split them
    # out so the UI can headline the real CI estate instead of an inflated total
    # (a 12-host estate otherwise reads as ~1,400 "total CIs", which is noise).
    # estate = ALL CIs minus software — NOT linked_ci_count minus software: software
    # CIs carry ava_asset_id=None so they're already absent from linked_ci_count, and
    # subtracting them from it went negative (QA: "Configuration items: -1,381").
    total = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.tenant_id == tid)
        .count()
    )
    soft_type_id = (
        db.query(HDCIType.id)
        .filter(HDCIType.tenant_id == tid, HDCIType.code == CIT_SOFTWARE)
        .scalar()
    )
    software = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.tenant_id == tid,
                HDConfigurationItem.ci_type_id == soft_type_id)
        .count()
        if soft_type_id else 0
    )
    return {
        "last_run_at": iso(last.imported_at) if last else None,
        "last_summary": last.summary if last else None,
        "inventory_count": (last.summary or {}).get("inventory_count") if last else None,
        "linked_ci_count": linked,
        "software_ci_count": software,
        "estate_ci_count": max(total - software, 0),   # all non-software CIs (hosts/domains/manual)
        "retired_ci_count": retired,
    }


@router.get("/cis/{ci_id}/software")
def ci_software(ci_id: int, db: Session = Depends(get_db),
                _: bool = Depends(require_settings_view)):
    """Installed-software children (via REL-INSTALLED) of a host CI."""
    tid = tenant_id(db)
    host = (
        db.query(HDConfigurationItem)
        .filter(HDConfigurationItem.id == ci_id, HDConfigurationItem.tenant_id == tid)
        .first()
    )
    if host is None:
        raise HTTPException(status_code=404, detail="not found")
    rt = (
        db.query(HDCIRelationshipType)
        .filter(HDCIRelationshipType.tenant_id == tid, HDCIRelationshipType.code == REL_INSTALLED)
        .first()
    )
    if rt is None:
        return {"software": []}
    edges = (
        db.query(HDCIRelationship)
        .filter(HDCIRelationship.target_ci_id == host.id, HDCIRelationship.rel_type_id == rt.id)
        .all()
    )
    sw_ids = [e.source_ci_id for e in edges]
    rows = []
    if sw_ids:
        for sw in (db.query(HDConfigurationItem)
                   .filter(HDConfigurationItem.id.in_(sw_ids),
                           HDConfigurationItem.tenant_id == tid)
                   .order_by(HDConfigurationItem.name.asc()).all()):
            attrs = sw.attributes if isinstance(sw.attributes, dict) else {}
            rows.append({
                "id": sw.id, "code": sw.code, "name": sw.name, "status": sw.status,
                "version": attrs.get("version"), "publisher": attrs.get("publisher"),
                "source": attrs.get("source"),
                "benchmark_available": attrs.get("benchmark_available"),
            })
    return {"software": rows}
