"""Host-centric collapse: one asset per real machine, extra DNS names as aliases.

Six liztek.ca names on one server are ONE house with six nameplates — the
owner's model. This folds the surplus EASM name-rows into the primary asset for
their (ip, apex-domain) pair: their names land in ``primary.dns_aliases``, their
finding links re-point (deduplicated), their external identities follow, and the
folded rows are deleted through the same reference purge the manual delete uses.

GUARDRAILS — the Windows/Postgres rule. A row folds only when ALL hold:
  * origin_source == 'easm'              — born from the domain listing
  * asset_type in (infrastructure, cloud) — never application/data/third-party
  * discovery_state is 'unmanaged'/empty  — never logged into
  * no children (nothing has it as parent_asset_id)
  * carries an ip_address and a DNS name
Grouping is by (ip_address, registrable domain): shared-hosting neighbours on
one IP but another domain never merge, and a subdomain on a different machine
(mta-sts.liztek.ca) stays its own asset. Primary = the apex-named candidate when
present, else the lowest id. Non-foldable same-group rows are reported as
``skipped`` with explicit reasons — never silently. Idempotent.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from sqlalchemy import text as _sql
from sqlalchemy.orm import Session

from grc.models import ITAsset, AssetRelationship, VulnerabilityAssetLink
from .domain_hierarchy import registrable_domain, _asset_dns_name

logger = logging.getLogger(__name__)

FOLDABLE_TYPES = ("infrastructure", "cloud")


def _fold_blockers(a: ITAsset, children_of: set) -> List[str]:
    """Why this row must NOT fold — empty list means it is a fold candidate."""
    reasons: List[str] = []
    if getattr(a, "origin_source", None) != "easm":
        reasons.append(
            f"origin_source is {getattr(a, 'origin_source', None) or 'unknown'!r}, not 'easm' — "
            "a swept/connected/manual host is a real machine record, never an alias")
    if (a.asset_type or "") not in FOLDABLE_TYPES:
        reasons.append(
            f"asset_type {a.asset_type!r} — software/data on a shared IP never inherits a host fold")
    if (getattr(a, "discovery_state", None) or "unmanaged") != "unmanaged":
        reasons.append("discovery_state shows it was profiled with a login — it is its own machine")
    if a.id in children_of:
        reasons.append("has child assets pointing at it (parent_asset_id)")
    return reasons


def plan_host_collapse(db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """Compute the fold plan without touching anything.

    One entry per (ip, apex) group that has ≥2 fold candidates:
    {ip, domain, primary:{id,name}, fold:[{id,name}], skipped:[{id,name,reasons}],
     aliases:[names]}.
    """
    assets = db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
    children_of = {a.parent_asset_id for a in assets if a.parent_asset_id}

    groups: Dict[Tuple[str, str], List[ITAsset]] = {}
    for a in assets:
        dns = _asset_dns_name(a)
        apex = registrable_domain(dns) if dns else None
        if not (a.ip_address and apex):
            continue
        groups.setdefault((a.ip_address, apex), []).append(a)

    plan: List[Dict[str, Any]] = []
    for (ip, apex), members in sorted(groups.items()):
        candidates = [m for m in members if not _fold_blockers(m, children_of)]
        if len(candidates) < 2:
            continue
        primary = next((m for m in candidates if _asset_dns_name(m) == apex), None) \
            or min(candidates, key=lambda m: m.id)
        fold = [m for m in candidates if m.id != primary.id]
        skipped = [
            {"id": m.id, "name": m.name, "reasons": _fold_blockers(m, children_of)}
            for m in members if _fold_blockers(m, children_of)
        ]
        plan.append({
            "ip": ip, "domain": apex,
            "primary": {"id": primary.id, "name": primary.name},
            "fold": [{"id": m.id, "name": m.name} for m in fold],
            "skipped": skipped,
            "aliases": sorted({_asset_dns_name(m) for m in fold if _asset_dns_name(m)}),
        })
    return plan


def collapse_hosts(db: Session, tenant_id: int) -> Dict[str, Any]:
    """Execute the plan: aliases onto the primary, finding links re-pointed with
    dedupe, external identities follow, relationships cleaned, folded rows
    purged (same sweep as manual delete) and deleted. Caller commits."""
    # Late import via importlib so tests can monkeypatch the router module's
    # purge helper (grc.routers re-exports the APIRouter under the same name, so
    # `from grc.routers import assets_router` would grab the router, not the
    # module), and to avoid a router↔service import cycle at module load.
    import importlib
    assets_router = importlib.import_module("grc.routers.assets_router")

    plan = plan_host_collapse(db, tenant_id)
    folded_total = 0
    links_repointed = 0

    for group in plan:
        primary = db.get(ITAsset, group["primary"]["id"])
        fold_ids = [f["id"] for f in group["fold"]]
        if primary is None or not fold_ids:
            continue

        # 1 — aliases (merged with whatever the primary already carries)
        existing = {str(x).lower() for x in (primary.dns_aliases or []) if x}
        primary.dns_aliases = sorted(existing | set(group["aliases"]))

        # 2 — finding links: re-point to the primary; drop exact duplicates
        for link in db.query(VulnerabilityAssetLink).filter(
                VulnerabilityAssetLink.asset_id.in_(fold_ids)).all():
            dup = db.query(VulnerabilityAssetLink.id).filter(
                VulnerabilityAssetLink.vulnerability_id == link.vulnerability_id,
                VulnerabilityAssetLink.asset_id == primary.id,
            ).first()
            if dup:
                db.delete(link)
            else:
                link.asset_id = primary.id
                links_repointed += 1
        db.flush()

        # 3 — external identities follow the host, so the same source re-run
        # matches the primary instead of resurrecting a folded row. ORM-level,
        # portable across PG and the sqlite test harness.
        try:
            from grc.models import AssetExternalIdentity
            for ident in db.query(AssetExternalIdentity).filter(
                    AssetExternalIdentity.asset_id.in_(fold_ids)).all():
                dup = db.query(AssetExternalIdentity.id).filter(
                    AssetExternalIdentity.asset_id == primary.id,
                    AssetExternalIdentity.source_system == ident.source_system,
                    AssetExternalIdentity.external_id == ident.external_id,
                ).first()
                if dup:
                    db.delete(ident)
                else:
                    ident.asset_id = primary.id
            db.flush()
        except Exception:  # noqa: BLE001 — table absent in a minimal test schema
            logger.debug("host collapse: external-identity re-point skipped", exc_info=True)

        # 4 — relationship edges from/to folded rows vanish: they are aliases
        # on the primary card now, not separate graph nodes.
        db.query(AssetRelationship).filter(
            (AssetRelationship.source_asset_id.in_(fold_ids))
            | (AssetRelationship.target_asset_id.in_(fold_ids))
        ).delete(synchronize_session=False)

        # 5 — purge every remaining reference (same sweep as the manual delete
        # endpoint) and remove the folded rows.
        for fid in fold_ids:
            row = db.get(ITAsset, fid)
            if row is None:
                continue
            assets_router._purge_asset_references(db, row)
            db.execute(_sql("UPDATE grc_it_assets SET parent_asset_id = NULL WHERE parent_asset_id = :aid"), {"aid": fid})
            db.execute(_sql("UPDATE grc_it_assets SET replacement_asset_id = NULL WHERE replacement_asset_id = :aid"), {"aid": fid})
            db.delete(row)
            folded_total += 1
        db.flush()
        logger.info("host collapse: %s ← %s (tenant=%s)",
                    group["primary"]["name"], [f["name"] for f in group["fold"]], tenant_id)

    return {"groups": len(plan), "folded": folded_total,
            "links_repointed": links_repointed, "plan": plan}
