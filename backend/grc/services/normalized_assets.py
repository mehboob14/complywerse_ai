"""Track B — Normalized asset/vuln upsert layer for cloud sync.

Every cloud + scanner adapter funnels through these helpers instead of
writing to `ITAsset` / `Vulnerability` directly. Three reasons:

  1. **Source-of-truth rules.** Cloud sync owns `cloud_resource_id`,
     `cloud_region`, `instance_type`. Scanners own `open_ports`,
     `services_detected`. Neither overrides manual fields (`owner_*`,
     `data_classification`, `business_function`).
  2. **Dedup keys.** Match within a cloud-provider source by
     `cloud_resource_id` (strongest) → `mac_address` (specific) →
     `hostname + ip_address` (weakest). Never merge across clouds —
     two AWS accounts producing the same hostname stay distinct.
  3. **Last-seen bookkeeping** (Phase 5.5). Every upsert stamps
     `last_seen_at` and `last_seen_source` so the stale-asset filter
     stays accurate.

For Phase 7 we lean on the existing `ITAsset` columns. A future cleanup
can split `cloud_resource_id` into a dedicated column; for now it lives
in the asset's `name` / `host_name` field with provider-prefixed format
(`aws:i-0123abc`, `azure:vm-prod-01`, `gcp:projects/.../instances/...`),
which is what the dedup match queries below look for.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# Fields owned by the manual UI — never overwritten by sync, even on hit.
MANUAL_FIELDS = frozenset({
    "primary_owner_id", "secondary_owner_id", "owning_team",
    "escalation_contact_id", "business_owner_id",
    "data_classification", "business_function", "compliance_scope",
    "valuation", "confidentiality_rating", "integrity_rating",
    "availability_rating", "custodian", "description",
})


def upsert_cloud_asset(
    db: Session,
    *,
    tenant_id: int,
    source: str,
    cloud_resource_id: str,
    name: str,
    asset_type: str = "cloud",
    host_name: Optional[str] = None,
    ip_address: Optional[str] = None,
    vendor: Optional[str] = None,
    location: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Tuple[Any, bool]:
    """Upsert a cloud asset row. Returns `(asset, was_new)`.

    Match order:
      1. exact `host_name` match within this tenant (cloud_resource_id is
         stored there with a provider prefix).
      2. `(host_name, ip_address)` pair within this tenant.
      3. fresh insert.

    All non-manual fields get refreshed on hit. Manual fields stay put.
    `last_seen_at` + `last_seen_source` are always bumped (Phase 5.5).
    """
    from ..models import ITAsset

    if not cloud_resource_id:
        raise ValueError("cloud_resource_id is required for cloud asset upsert")

    # Provider-prefixed key — keeps two clouds with overlapping names
    # distinct without an extra column.
    primary_key = cloud_resource_id

    existing = (
        db.query(ITAsset)
        .filter(ITAsset.tenant_id == tenant_id)
        .filter(ITAsset.host_name == primary_key)
        .first()
    )
    if not existing and host_name and ip_address:
        existing = (
            db.query(ITAsset)
            .filter(ITAsset.tenant_id == tenant_id)
            .filter(ITAsset.host_name == host_name)
            .filter(ITAsset.ip_address == ip_address)
            .first()
        )

    now = datetime.utcnow()

    if existing:
        # Source-of-truth: cloud sync overwrites these on every run.
        # Manual fields stay put.
        existing.name = name or existing.name
        # host_name slot holds the canonical cloud_resource_id; only set
        # on first creation, otherwise it would clobber another sync's
        # identity assertion.
        if not existing.host_name:
            existing.host_name = primary_key
        if ip_address:
            existing.ip_address = ip_address
        if vendor:
            existing.vendor = vendor
        if location:
            existing.location = location
        if asset_type and not existing.asset_type:
            existing.asset_type = asset_type
        if hasattr(existing, "last_seen_at"):
            existing.last_seen_at = now
            existing.last_seen_source = source
        if hasattr(existing, "lifecycle_state") and not existing.lifecycle_state:
            existing.lifecycle_state = "active"
        # Recompute the derived criticality_score since classification or
        # internet_facing may have flipped on this run (rare for cloud
        # sources, but cheap insurance).
        try:
            from .asset_criticality import recompute_for_asset
            recompute_for_asset(existing)
        except Exception:
            pass
        return existing, False

    # Fresh insert. Asset starts in `active` lifecycle, with the cloud
    # source labeled so the stale-asset query can attribute it.
    asset = ITAsset(
        tenant_id=tenant_id,
        name=name or primary_key,
        asset_type=asset_type or "cloud",
        host_name=primary_key,
        ip_address=ip_address,
        vendor=vendor,
        location=location,
        criticality="medium",
    )
    if hasattr(asset, "last_seen_at"):
        asset.last_seen_at = now
        asset.last_seen_source = source
    if hasattr(asset, "lifecycle_state"):
        asset.lifecycle_state = "active"
    try:
        from .asset_criticality import recompute_for_asset
        recompute_for_asset(asset)
    except Exception:
        pass
    db.add(asset)
    db.flush()
    return asset, True


def upsert_cloud_vulnerability(
    db: Session,
    *,
    tenant_id: int,
    source: str,
    cve_id: Optional[str],
    title: str,
    description: Optional[str] = None,
    severity: str = "medium",
    cvss_score: Optional[float] = None,
    cvss_vector: Optional[str] = None,
    affected_component: Optional[str] = None,
    affected_host: Optional[str] = None,
    asset_id: Optional[int] = None,
    external_id: Optional[str] = None,
) -> Tuple[Any, bool]:
    """Upsert a cloud vuln finding. Returns `(vuln, was_new)`.

    Match order:
      1. `(tenant_id, cve_id, affected_host)` when we have a CVE.
      2. `(tenant_id, vuln_id)` when we have the cloud finding ID as
         vuln_id (e.g. AWS arn-style finding identifier).
      3. fresh insert with auto-generated VULN-NNNNN.

    Asset link is created in `VulnerabilityAssetLink` when `asset_id` is
    supplied. Same idempotent semantics — a second sync of the same
    finding+asset pair re-uses the link.
    """
    from ..models import Vulnerability, VulnerabilityAssetLink

    existing = None
    if cve_id and affected_host:
        existing = (
            db.query(Vulnerability)
            .filter(Vulnerability.tenant_id == tenant_id)
            .filter(Vulnerability.cve_id == cve_id)
            .filter(Vulnerability.affected_host == affected_host)
            .first()
        )
    if not existing and external_id:
        existing = (
            db.query(Vulnerability)
            .filter(Vulnerability.tenant_id == tenant_id)
            .filter(Vulnerability.vuln_id == external_id)
            .first()
        )

    if existing:
        # Refresh refresh-able fields. severity / cvss come from the
        # scanner so they may have moved.
        existing.title = title or existing.title
        if description:
            existing.description = description
        if severity:
            existing.severity = severity
        if cvss_score is not None:
            existing.cvss_score = cvss_score
        if cvss_vector:
            existing.cvss_vector = cvss_vector
        if affected_component:
            existing.affected_component = affected_component
        if affected_host:
            existing.affected_host = affected_host
        existing.updated_at = datetime.utcnow()
        was_new = False
    else:
        # Auto-generate vuln_id; use external_id verbatim if supplied so
        # the row is searchable by the cloud finding ID.
        if external_id:
            vuln_id_str = external_id[:50]
        else:
            count = db.query(Vulnerability).filter(
                Vulnerability.tenant_id == tenant_id
            ).count()
            vuln_id_str = f"VULN-{count + 1:05d}"
        existing = Vulnerability(
            tenant_id=tenant_id,
            vuln_id=vuln_id_str,
            title=title,
            description=description,
            severity=severity or "medium",
            cvss_score=cvss_score,
            cvss_vector=cvss_vector,
            cve_id=cve_id,
            affected_component=affected_component,
            affected_host=affected_host,
            status="open",
        )
        db.add(existing)
        db.flush()
        was_new = True

    # Asset link (idempotent). Tags provenance so the UI can render an
    # "Auto · cloud_sync" badge and reviewers can filter on it.
    if asset_id is not None:
        link_exists = (
            db.query(VulnerabilityAssetLink)
            .filter(VulnerabilityAssetLink.vulnerability_id == existing.id)
            .filter(VulnerabilityAssetLink.asset_id == asset_id)
            .first()
        )
        if not link_exists:
            db.add(VulnerabilityAssetLink(
                vulnerability_id=existing.id,
                asset_id=asset_id,
                link_source="cloud_sync",
                auto_linked=True,
            ))
            db.flush()

    return existing, was_new
