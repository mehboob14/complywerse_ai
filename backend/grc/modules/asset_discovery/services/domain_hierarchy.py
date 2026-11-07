"""Maintain the apex↔subdomain hierarchy for domain-named assets.

EASM discovers a domain (liztek.ca) and its subdomains (ftp/www/mail…) as
separate, FLAT assets — each keeps its own fqdn and its own IP. This module adds
the missing lineage layer: a directed ``subdomain_of`` edge from each subdomain
asset to the apex asset, stored in grc_asset_relationships.

It is purely additive — it NEVER changes an asset's ip_address, host_name, fqdn
or its vulnerability links. The apex keeps its IP, each subdomain keeps its IP
(mta-sts.liztek.ca stays on its own address even though it shares the parent
domain name). The edge is DNS-based (naming), not host-based (IP), so a subdomain
on a different server is still correctly a child of the apex.

Idempotent: safe to run after every discovery run and to re-run for a backfill.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from grc.models import ITAsset, AssetRelationship

logger = logging.getLogger(__name__)

# Registrable-domain resolution now lives in ONE place — grc.modules.it_assets.
# asset_rollup — so the apex grouping used for subdomain_of edges here matches the
# dashboards and the Asset Register exactly. The old local list here was missing
# ``edu.pk``, so EVERY ``*.superior.edu.pk`` subdomain resolved to ``edu.pk`` (not
# an asset) and was never linked to its apex — which is why the subdomain_of table
# had only a handful of edges and the domain score-rollup was inert. Delegating
# fixes that. ``TWO_LEVEL_SUFFIXES`` is re-exported for any importer of this name.
from grc.modules.it_assets.asset_rollup import (  # noqa: E402
    TWO_LEVEL_SUFFIXES as _TWO_LEVEL_SUFFIXES,
    registrable_domain,
)


def _is_ip_literal(value: str) -> bool:
    import ipaddress
    try:
        ipaddress.ip_address(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def _asset_dns_name(asset: ITAsset) -> Optional[str]:
    """The DNS name an asset is known by — fqdn first, else host_name."""
    for candidate in (getattr(asset, "fqdn", None), getattr(asset, "host_name", None)):
        if candidate and not _is_ip_literal(str(candidate)):
            return str(candidate).strip().lower().rstrip(".")
    return None


def link_domain_hierarchy(db: Session, tenant_id: int) -> int:
    """Ensure a ``subdomain_of`` edge from every subdomain asset to its apex.

    Returns the number of NEW edges written. Only links when the apex itself
    exists as its own asset in this tenant (we never invent an apex asset). A
    subdomain whose apex isn't in inventory is left unlinked — honest, not
    fabricated. Does not touch any asset column or vulnerability link.
    """
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()

    # Map apex domain -> the asset that IS that apex (its own name == apex).
    apex_asset_by_domain: dict[str, ITAsset] = {}
    for a in assets:
        dns = _asset_dns_name(a)
        if dns and registrable_domain(dns) == dns:
            # Prefer the lowest id if two rows claim the same apex name.
            cur = apex_asset_by_domain.get(dns)
            if cur is None or a.id < cur.id:
                apex_asset_by_domain[dns] = a

    created = 0
    for a in assets:
        dns = _asset_dns_name(a)
        if not dns:
            continue
        apex = registrable_domain(dns)
        if not apex or apex == dns:
            continue  # the apex itself, or not a domain — no parent to link
        parent = apex_asset_by_domain.get(apex)
        if parent is None or parent.id == a.id:
            continue  # apex not in inventory yet — leave unlinked, don't invent
        exists = db.query(AssetRelationship.id).filter(
            AssetRelationship.tenant_id == tenant_id,
            AssetRelationship.source_asset_id == a.id,
            AssetRelationship.target_asset_id == parent.id,
            AssetRelationship.relationship_type == "subdomain_of",
        ).first()
        if exists:
            continue
        db.add(AssetRelationship(
            tenant_id=tenant_id,
            source_asset_id=a.id,
            target_asset_id=parent.id,
            relationship_type="subdomain_of",
            notes="Auto-linked: DNS subdomain of the apex domain.",
            created_by_name="EASM discovery",
        ))
        created += 1

    if created:
        db.flush()
        logger.info("domain hierarchy: linked %d subdomain(s) to their apex (tenant=%s)", created, tenant_id)
    return created
