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

# Two-level public suffixes we handle without a full Public Suffix List. Covers
# the common ccTLD-with-second-level cases so "foo.co.uk" → "foo.co.uk", not
# "co.uk". Not exhaustive — a domain under an unusual multi-part suffix falls
# back to last-two-labels, which is correct for the vast majority (.com, .ca,
# .net, .org, .io, …). Swap in `publicsuffix2` later if full PSL fidelity is
# needed; the callers don't change.
_TWO_LEVEL_SUFFIXES = frozenset({
    "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
    "co.nz", "net.nz", "org.nz", "govt.nz",
    "com.br", "com.cn", "com.mx", "com.tr", "com.sg", "com.hk", "com.tw",
    "co.in", "net.in", "org.in", "co.jp", "or.jp", "ne.jp", "co.za", "co.kr",
    "com.pk", "net.pk", "org.pk", "gov.pk",
})


def _is_ip_literal(value: str) -> bool:
    import ipaddress
    try:
        ipaddress.ip_address(value.strip())
        return True
    except (ValueError, AttributeError):
        return False


def registrable_domain(name: Optional[str]) -> Optional[str]:
    """The apex (registrable) domain of a DNS name, or None if not a domain.

    'ftp.liztek.ca' → 'liztek.ca'; 'liztek.ca' → 'liztek.ca';
    'foo.bar.co.uk' → 'bar.co.uk'; an IP or a single-label host → None.
    """
    if not name:
        return None
    host = name.strip().lower().rstrip(".")
    if not host or _is_ip_literal(host):
        return None
    labels = host.split(".")
    if len(labels) < 2:
        return None  # a bare NetBIOS name like "desktop-ce3efjb" is not a domain
    last_two = ".".join(labels[-2:])
    if len(labels) >= 3 and last_two in _TWO_LEVEL_SUFFIXES:
        return ".".join(labels[-3:])
    return last_two


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
