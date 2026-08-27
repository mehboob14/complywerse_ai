"""Identity resolution — turn discovery observations into canonical assets.

This is the seam the whole discovery design defers to. A scan only ever writes
`DiscoveryObservation` rows (resolution='pending'); NOTHING becomes an asset at
scan time. This module is the separate, deliberate step that reads pending
observations and decides, per observation:

    confident single match  → MERGE  into the existing asset (enrich + last_seen)
    no match                → CREATE a new asset, tagged discovery_state='discovered'
    more than one candidate  → REVIEW (leave for a human; never guess)

Matching is strict precedence, strongest key first — the rule that stops the
same host from two sources becoming two assets:

    1. external identity   (source_system, external_id) in grc_asset_external_identities
    2. hardware serial      obs.raw['serial_number'] == asset.serial_number
    3. MAC address          obs.mac_address == asset.primary_mac   (case-insensitive)
    4. FQDN                 obs.fqdn == asset.fqdn                  (case-insensitive)
    5. hostname             obs.host_name == asset.host_name        (case-insensitive)
    6. IP (bare)            obs.ip_address == asset.ip_address, only when neither
                            side has a hostname — the weakest tier, used so a
                            reverse-DNS-less sweep is still idempotent

The first tier with any hit decides. If that tier matches >1 asset the
observation goes to REVIEW rather than merging two real hosts together.

Merging only ever FILLS BLANKS and bumps last_seen — it never overwrites a
value an operator curated. Creating tags the asset `discovery_state='discovered'`
and `source_system='discovery'` so the UI can separate freshly-found devices
from confirmed inventory instead of dumping raw scan hits into the register.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from grc.models import (
    ITAsset, DiscoveryObservation, DiscoveryRun, AssetExternalIdentity,
)

logger = logging.getLogger(__name__)


def _obj(obs: DiscoveryObservation) -> Dict[str, Any]:
    return obs.raw if isinstance(obs.raw, dict) else {}


def _candidates(db: Session, tenant_id: int, obs: DiscoveryObservation) -> Tuple[str, List[int]]:
    """Return (tier, [asset_ids]) for the strongest tier with any match, or
    ('', []) if nothing matches. Case-insensitive on string keys."""
    raw = _obj(obs)

    def ids(query) -> List[int]:
        return [row[0] for row in query.limit(5).all()]

    base = db.query(ITAsset.id).filter(ITAsset.tenant_id == tenant_id)

    # 1 — external identity (only for sourced observations that carry one)
    src = raw.get("source_system") or obs.source
    ext = raw.get("external_id")
    if ext and src:
        rows = [r[0] for r in db.query(AssetExternalIdentity.asset_id).filter(
            AssetExternalIdentity.tenant_id == tenant_id,
            AssetExternalIdentity.source_system == src,
            AssetExternalIdentity.external_id == str(ext),
        ).limit(5).all()]
        if rows:
            return "external_id", rows

    # 2 — hardware serial
    serial = raw.get("serial_number")
    if serial:
        hit = ids(base.filter(func.lower(ITAsset.serial_number) == str(serial).lower()))
        if hit:
            return "serial", hit

    # 3 — MAC
    if obs.mac_address:
        hit = ids(base.filter(func.lower(ITAsset.primary_mac) == obs.mac_address.lower()))
        if hit:
            return "mac", hit

    # 4 — FQDN
    if obs.fqdn:
        hit = ids(base.filter(func.lower(ITAsset.fqdn) == obs.fqdn.lower()))
        if hit:
            return "fqdn", hit

    # 5 — hostname
    if obs.host_name:
        hit = ids(base.filter(func.lower(ITAsset.host_name) == obs.host_name.lower()))
        if hit:
            return "hostname", hit

    # 5b — DNS alias: a name folded into a host-centric asset (dns_aliases).
    # Without this, the next EASM run would re-create ftp.liztek.ca as its own
    # row right after the collapse merged it away. JSON-as-text LIKE, same
    # pattern the orphan-vuln linker uses for host_identity.
    from sqlalchemy import String as _Str, cast as _cast
    for candidate in (obs.fqdn, obs.host_name):
        if not candidate:
            continue
        hit = ids(base.filter(
            ITAsset.dns_aliases.isnot(None),
            func.lower(_cast(ITAsset.dns_aliases, _Str)).like(f'%"{candidate.lower()}"%'),
        ))
        if hit:
            return "dns_alias", hit

    # 6 — bare IP, only when neither the observation nor the asset has a hostname
    if obs.ip_address and not obs.host_name:
        hit = ids(base.filter(ITAsset.ip_address == obs.ip_address,
                              ITAsset.host_name.is_(None)))
        if hit:
            return "ip", hit

    return "", []


def _record_external_identity(db: Session, tenant_id: int, asset_id: int,
                              source_system: str, external_id: str,
                              id_type: Optional[str] = None) -> None:
    """Upsert the (source_system, external_id) → asset mapping so a later
    observation with the same external id resolves at tier 1."""
    now = datetime.utcnow()
    row = db.query(AssetExternalIdentity).filter(
        AssetExternalIdentity.tenant_id == tenant_id,
        AssetExternalIdentity.source_system == source_system,
        AssetExternalIdentity.external_id == str(external_id),
    ).first()
    if row:
        row.asset_id = asset_id
        row.last_seen_at = now
    else:
        db.add(AssetExternalIdentity(
            tenant_id=tenant_id, asset_id=asset_id, source_system=source_system,
            external_id=str(external_id), id_type=id_type,
            first_seen_at=now, last_seen_at=now,
        ))


def _merge_into(db: Session, asset: ITAsset, obs: DiscoveryObservation) -> None:
    """Enrich an existing asset from an observation. Fills blanks only; never
    clobbers a curated value. Always bumps last-seen."""
    raw = _obj(obs)
    now = datetime.utcnow()
    if obs.host_name and not asset.host_name:
        asset.host_name = obs.host_name
    if obs.ip_address and not asset.ip_address:
        asset.ip_address = obs.ip_address
    if obs.fqdn and not asset.fqdn:
        asset.fqdn = obs.fqdn
    if obs.mac_address and not asset.primary_mac:
        asset.primary_mac = obs.mac_address
    if asset.first_seen_at is None:
        asset.first_seen_at = asset.created_at or now
    asset.last_seen_at = now
    asset.last_seen_source = obs.source or "discovery"
    ext = raw.get("external_id")
    src = raw.get("source_system") or obs.source
    if ext and src:
        _record_external_identity(db, asset.tenant_id, asset.id, src, ext, raw.get("id_type"))
    # Enrich with the protocol-aware classification — fill blanks only.
    _apply_classification(asset, _classification(obs), fill_only=True)


# ── Discovery classification -> inventory mapping ───────────────────────────
# A protocol fingerprint (SNMP sysDescr / SSH banner / DNS) is evidence of a
# DEVICE, so a confidently-identified router / printer / DNS box is inventory,
# not a rumour — unlike a bare TCP host, which still needs a login to be real.
_PLATFORM_KIND = {
    "network_device": "network", "printer": "printer", "dns_server": "server",
    "host": "server", "hypervisor": "server", "storage": "storage",
    "camera": "camera", "voip": "voip", "ups": "ups",
}
_DEVICE_LABEL = {
    "network_device": "network device", "printer": "printer",
    "dns_server": "DNS server", "appliance": "appliance",
    "hypervisor": "hypervisor", "storage": "storage", "camera": "camera",
    "voip": "VoIP phone", "ups": "UPS",
}


def _classification(obs: DiscoveryObservation) -> Dict[str, Any]:
    raw = _obj(obs)
    return {
        "device_type": raw.get("device_type"), "os_guess": raw.get("os_guess"),
        "vendor": raw.get("vendor"), "product": raw.get("product"),
        "confidence": raw.get("confidence"), "evidence": raw.get("evidence") or [],
        "fingerprint": raw.get("fingerprint") or {},
    }


def _confidently_identified(cls: Dict[str, Any]) -> bool:
    """True when the fingerprint identifies a NON-host device well enough to be
    inventory on its own — an SNMP sysDescr naming a Cisco switch / HP printer,
    or a DNS responder. Hosts (Windows/Linux) are deliberately excluded: a bare
    sweep hit is a rumour until a login + deep-collect proves it. This is what
    lets network gear you can't SSH into still enter inventory."""
    dt = cls.get("device_type")
    if dt in (None, "host", "unknown", "appliance"):
        return False  # hosts wait for a login; unknowns aren't identified
    conf = cls.get("confidence") or 0
    ev = cls.get("evidence") or []
    strong = any(e in ("snmp_sysdescr", "ssh_banner", "http_server") for e in ev)
    return conf >= 0.7 and (strong or dt == "dns_server")


def _display_name(obs: DiscoveryObservation, cls: Dict[str, Any]) -> str:
    if obs.host_name:
        return obs.host_name
    if obs.fqdn:
        return obs.fqdn
    label = _DEVICE_LABEL.get(cls.get("device_type"))
    if label:
        vendor = cls.get("vendor")
        return (f"{vendor + ' ' if vendor else ''}{label} ({obs.ip_address})").strip()
    return obs.ip_address or "discovered-host"


def _apply_classification(asset: ITAsset, cls: Dict[str, Any], *, fill_only: bool) -> None:
    """Write the protocol-aware classification onto an asset. On create
    (fill_only=False) sets everything; on merge (fill_only=True) fills blanks
    only — never clobbers a curated value, matching the merge contract."""
    dt = cls.get("device_type")
    vendor = cls.get("vendor")
    os_guess = cls.get("os_guess")

    def _set(field: str, value: Any) -> None:
        if value is None:
            return
        if fill_only and getattr(asset, field, None):
            return
        setattr(asset, field, value)

    _set("vendor", vendor)
    _set("manufacturer", vendor)
    _set("os_family", os_guess if os_guess in ("windows", "linux") else None)
    _set("asset_role", "host" if dt == "host" else None)
    _set("description", cls.get("product"))
    _set("platform_kind", _PLATFORM_KIND.get(dt))
    # platform_properties: refresh the discovery block (it's evidence, not a
    # curated field), preserving any other keys already there.
    pp = dict(asset.platform_properties or {})
    pp["discovery_classification"] = {
        "device_type": dt, "vendor": vendor, "product": cls.get("product"),
        "confidence": cls.get("confidence"), "evidence": cls.get("evidence"),
    }
    if cls.get("fingerprint"):
        pp["fingerprint"] = cls["fingerprint"]
    asset.platform_properties = pp


def _create_from(db: Session, tenant_id: int, obs: DiscoveryObservation) -> ITAsset:
    """Create a new asset from an observation, tagged as discovered, carrying the
    protocol-aware classification so a network device / printer / DNS box keeps
    its real identity instead of collapsing to bare 'infrastructure'."""
    raw = _obj(obs)
    cls = _classification(obs)
    now = datetime.utcnow()
    asset = ITAsset(
        origin_source="easm" if (obs.source or "") == "external" else "network_sweep",  # stamped once at birth; never mutated
        tenant_id=tenant_id,
        name=_display_name(obs, cls),
        asset_type="infrastructure",
        host_name=obs.host_name,
        ip_address=obs.ip_address,
        fqdn=obs.fqdn,
        primary_mac=obs.mac_address,
        # A sweep cannot assess criticality — unrated until a human rates it.
        criticality=None,
        source_system="discovery",
        last_seen_source=obs.source or "discovery",
        last_seen_at=now,
        first_seen_at=now,
        discovery_state="discovered",
    )
    _apply_classification(asset, cls, fill_only=False)
    db.add(asset)
    db.flush()  # assign id for the external-identity link + later same-run matches
    ext = raw.get("external_id")
    src = raw.get("source_system") or obs.source
    if ext and src:
        _record_external_identity(db, tenant_id, asset.id, src, ext, raw.get("id_type"))
    try:
        from grc.services.asset_criticality import recompute_for_asset
        recompute_for_asset(asset)
    except Exception:
        logger.exception("resolver: criticality recompute failed for new asset")
    return asset


def _prior_ignored(db: Session, tenant_id: int, obs: DiscoveryObservation) -> bool:
    """Has a previous observation for this same host/IP been explicitly ignored?
    If so a later scan must NOT resurrect it as new inventory or re-queue it for
    review — a dismissal has to stick across scans, not just for one run."""
    from sqlalchemy import or_
    conds = []
    if obs.host_name:
        conds.append(func.lower(DiscoveryObservation.host_name) == obs.host_name.lower())
    if obs.ip_address:
        conds.append(DiscoveryObservation.ip_address == obs.ip_address)
    if not conds:
        return False
    q = db.query(DiscoveryObservation.id).filter(
        DiscoveryObservation.tenant_id == tenant_id,
        DiscoveryObservation.resolution == "ignored",
        DiscoveryObservation.id != obs.id,
        or_(*conds),
    )
    return db.query(q.exists()).scalar()


def _mark_internet_facing(asset: ITAsset) -> None:
    """Assert internet exposure and re-rate criticality so the exposure boost
    lands. An external (outside-in) sighting is proof of a public face; the
    recompute inside _create_from ran BEFORE this flag was set, so it must run
    again here for the internet-facing boost to reach the score.

    BOTH exposure columns are written together — the same contract deep_collect
    follows — because a consumer that reads is_internet_facing first (e.g.
    exploitability._other_linked_assets) never falls through to internet_facing
    (is_internet_facing is NOT NULL, so it's never the sentinel None). Setting
    one and not the other is how the two scores end up disagreeing about the same
    fact."""
    asset.internet_facing = True
    if hasattr(asset, "is_internet_facing"):
        asset.is_internet_facing = True
    try:
        from grc.services.asset_criticality import recompute_for_asset
        recompute_for_asset(asset)
    except Exception:
        logger.exception("resolver: criticality recompute failed for internet-facing asset")


def resolve_observation(db: Session, obs: DiscoveryObservation) -> Dict[str, Any]:
    """Resolve one observation. Mutates the observation (and possibly creates or
    updates an asset). Caller commits. Returns a small decision dict."""
    if obs.resolution not in ("pending", "review"):
        return {"action": "skip", "reason": f"already {obs.resolution}"}

    tier, candidate_ids = _candidates(db, obs.tenant_id, obs)
    # Link any scanner findings already imported for a just-adopted external host
    # (lazy import avoids a resolver<->deep_collect cycle).
    from .deep_collect import link_orphan_vulns_to_asset

    if len(candidate_ids) == 1:
        asset = db.get(ITAsset, candidate_ids[0])
        if asset is None:  # vanished between query and fetch — treat as no match
            tier, candidate_ids = "", []
        else:
            # A confident match still enriches the known asset even if a sibling
            # host was once ignored — ignore suppresses NEW inventory, not the
            # last-seen update of an asset we already track.
            _merge_into(db, asset, obs)
            # An external sighting proves internet exposure — assert it on the
            # matched asset too, even one first discovered on the internal network.
            if obs.source == "external":
                _mark_internet_facing(asset)
                link_orphan_vulns_to_asset(db, asset)
            obs.resolution = "merged"
            obs.resolved_asset_id = asset.id
            obs.resolution_note = f"matched existing asset #{asset.id} by {tier}"
            return {"action": "merged", "asset_id": asset.id, "tier": tier}

    # Weak outcome (would create or review) — honour a standing dismissal first.
    if _prior_ignored(db, obs.tenant_id, obs):
        obs.resolution = "ignored"
        obs.resolved_asset_id = None
        obs.resolution_note = "auto-dismissed (this host was previously ignored)"
        return {"action": "ignored"}

    if len(candidate_ids) > 1:
        obs.resolution = "review"
        obs.resolved_asset_id = None
        obs.resolution_note = (
            f"ambiguous: {len(candidate_ids)} assets match by {tier} "
            f"({', '.join('#' + str(i) for i in candidate_ids)})"
        )
        return {"action": "review", "candidates": candidate_ids, "tier": tier}

    # EASM carve-out: an external (outside-in) find can never be logged into — we
    # reached it from the public internet, so there is no credential to wait for.
    # Adopt it now as an evidence-only, unmanaged, internet-facing asset instead
    # of parking it in the Connect queue as 'unclaimed' (which asks for a login
    # that can never come). manual_adopt reuses _create_from — including the
    # external-identity record (external_id=fqdn) that makes a re-scan idempotent.
    if obs.source == "external":
        asset = manual_adopt(db, obs)
        _mark_internet_facing(asset)
        # Carry known scanner findings for this host into the new internet-facing
        # asset, so it isn't stuck at 0 findings when a CTEM scope picks it up.
        link_orphan_vulns_to_asset(db, asset)
        obs.resolution_note = (
            f"external attack surface — evidence-only asset #{asset.id} (internet-facing)")
        return {"action": "created", "asset_id": asset.id, "external": True}

    # No match, nothing ignored. Discovery NEVER writes inventory on its own — a
    # swept device is evidence, not an asset. Everything unmatched lands in the
    # Connect queue as 'unclaimed'; it earns an inventory row only when a human
    # promotes it from Connect (save a credential, select the device, run the
    # login → deep-collect), or by an explicit merge into an asset already
    # tracked. Even a positively-identified non-host device (printer / switch /
    # DNS) waits here rather than auto-creating an empty shell — this pipeline
    # was rebuilt to stop producing those. The identification is preserved on the
    # observation (raw + note) so Connect can show "what we think this is".
    cls = _classification(obs)
    dt = cls.get("device_type")
    identified = bool(dt and dt not in ("host", "unknown", None)
                      and (cls.get("confidence") or 0) >= 0.7)
    obs.resolution = "unclaimed"
    obs.resolved_asset_id = None
    obs.resolution_note = (
        f"identified as {dt} via {', '.join(cls.get('evidence') or [])} — "
        f"promote from Connect to add to inventory"
        if identified else
        "found on the network — needs a login before it enters inventory"
    )
    return {"action": "unclaimed", "identified": identified}


# ── Operator-driven resolution (the Inbox actions) ──────────────────────────
# The auto-resolver leaves ambiguous observations in 'review'. These are the
# explicit decisions a human makes from the inbox; the caller commits.

def manual_adopt(db: Session, obs: DiscoveryObservation) -> ITAsset:
    """Operator explicitly adopts a device we cannot log into (printer / switch /
    IoT) as an UNMANAGED, evidence-only asset — IP + MAC + vendor + fingerprint,
    no authenticated deep-collect. Flagged unmanaged so the inventory clearly
    distinguishes it from a fully-profiled, credentialed host."""
    asset = _create_from(db, obs.tenant_id, obs)
    try:
        asset.discovery_state = "unmanaged"
    except Exception:  # column may not exist on older schemas — best-effort flag
        pass
    obs.resolution = "created"
    obs.resolved_asset_id = asset.id
    obs.resolution_note = f"operator adopted as unmanaged (evidence-only) asset #{asset.id}"
    return asset


def manual_merge(db: Session, obs: DiscoveryObservation, asset: ITAsset) -> None:
    """Operator says 'this is that existing asset' — merge into their choice."""
    _merge_into(db, asset, obs)
    obs.resolution = "merged"
    obs.resolved_asset_id = asset.id
    obs.resolution_note = f"operator merged into asset #{asset.id}"


def manual_ignore(db: Session, obs: DiscoveryObservation) -> None:
    """Operator says 'not an asset I care about' — dismiss it. The evidence row
    stays (so it isn't rediscovered as new every scan) but produces no asset."""
    obs.resolution = "ignored"
    obs.resolved_asset_id = None
    obs.resolution_note = "operator dismissed"


def resolve_run(db: Session, run_id: int) -> Dict[str, int]:
    """Resolve every pending observation for a run. Confident matches are
    applied automatically; ambiguous ones are left in 'review'. Updates the
    run's assets_new / assets_updated counters. Commits. Returns the tally."""
    run = db.get(DiscoveryRun, run_id)
    if run is None:
        raise ValueError(f"discovery run {run_id} not found")

    pending = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.run_id == run_id,
        DiscoveryObservation.resolution == "pending",
    ).order_by(DiscoveryObservation.id).all()

    created = updated = review = ignored = unclaimed = 0
    for obs in pending:
        try:
            # Savepoint per observation: a failure resolving one host rolls back
            # only that host's work, never the assets already created/merged for
            # earlier observations in this run.
            with db.begin_nested():
                decision = resolve_observation(db, obs)
        except Exception:
            logger.exception("resolver: observation %s failed", obs.id)
            continue
        action = decision["action"]
        if action == "created":
            created += 1
        elif action == "merged":
            updated += 1
        elif action == "review":
            review += 1
        elif action == "ignored":
            ignored += 1
        elif action == "unclaimed":
            unclaimed += 1
        db.flush()  # so same-run duplicates of a host see the row we just created

    run = db.get(DiscoveryRun, run_id)
    # assets_new counts rows that actually entered inventory. A network sweep
    # creates none (its unmatched hosts wait for a login), so a CIDR run holds
    # this at 0 until credentials promote the devices. An external (EASM) run
    # DOES increment it — an outside-in find is adopted as an evidence-only asset
    # right here, because there's no login to wait for.
    run.assets_new = (run.assets_new or 0) + created
    run.assets_updated = (run.assets_updated or 0) + updated
    db.commit()
    return {"created": created, "updated": updated, "review": review,
            "ignored": ignored, "unclaimed": unclaimed}
