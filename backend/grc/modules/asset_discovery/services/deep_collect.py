"""Deep collection — turn a discovered network host into a fully-profiled asset.

A network sweep only proves a host is up. The answers an operator actually wants
— what OS, what software, is there antivirus / an EDR — come from an
AUTHENTICATED probe. This module runs that probe against the hosts a run just
resolved, using the stored CredentialProfiles, and writes the result onto the
asset (installed software → detected_software_json, and via apply_posture the
antivirus/EDR posture).

It reuses the existing agentless collectors (collect_windows / collect_linux),
driven directly from a credential profile — no IntegrationConnection needed.

Safety / isolation:
  * Only runs when the tenant has an active winrm/ssh credential; otherwise a
    complete no-op (no logins attempted).
  * Each host is probed inside its own savepoint, so one unreachable or
    auth-failing host never rolls back another host's collected inventory.
  * Bounded per run so a huge sweep can't fan out into thousands of logins in
    one pass.
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from grc.crypto import decrypt_secret
from grc.models import (
    ITAsset, DiscoveryRun, DiscoveryObservation, CredentialProfile,
)

logger = logging.getLogger(__name__)

# Cap authenticated logins per run. A sweep can find thousands of hosts; deep-
# collecting all of them synchronously in one pass would be abusive. The rest
# get collected on the next run (or an on-demand probe).
MAX_DEEP_COLLECT_PER_RUN = 512


def _transport_for_host(asset: ITAsset, obs: Optional[DiscoveryObservation]) -> Optional[str]:
    """windows | linux | None. Prefer a known OS; otherwise infer from the open
    ports the sweep saw (445/3389 → Windows, 22 → Linux)."""
    fam = (getattr(asset, "os_family", None) or getattr(asset, "os_normalized", None) or "").lower()
    if fam.startswith("windows"):
        return "windows"
    if fam.startswith(("linux", "ubuntu", "debian", "rhel", "centos", "rocky",
                       "almalinux", "oraclelinux", "amazonlinux", "sles", "suse")):
        return "linux"
    ports = []
    if obs is not None and isinstance(obs.raw, dict):
        ports = obs.raw.get("open_ports") or []
    if 445 in ports or 3389 in ports:
        return "windows"
    if 22 in ports:
        return "linux"
    return None


def _cidr_match(ip: Optional[str], cidrs: Optional[List[str]]) -> bool:
    """A profile with no cidrs applies to any host; otherwise the host IP must
    fall inside one of them."""
    if not cidrs:
        return True
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    for c in cidrs:
        try:
            if addr in ipaddress.ip_network(c, strict=False):
                return True
        except ValueError:
            continue
    return False


def select_credential(db: Session, tenant_id: int, ip: Optional[str],
                      transport: str) -> Optional[CredentialProfile]:
    """The highest-priority active credential of the right kind whose
    applicability covers this host."""
    kind = "winrm" if transport == "windows" else "ssh"
    candidates = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id == tenant_id,
        CredentialProfile.kind == kind,
        CredentialProfile.is_active.is_(True),
    ).order_by(CredentialProfile.priority, CredentialProfile.id).all()
    for c in candidates:
        if _cidr_match(ip, c.applies_to_cidrs):
            return c
    return None


def _credentials_dict(profile: CredentialProfile, ip: str, transport: str) -> Dict[str, Any]:
    """Build the dict shape collect_windows / collect_linux expect from a stored
    profile. The secret is decrypted here and nowhere else."""
    secret = decrypt_secret(profile.secret_encrypted)
    if transport == "windows":
        user = f"{profile.domain}\\{profile.username}" if profile.domain else profile.username
        port = profile.port or 5986
        return {
            "winrm_endpoint": f"https://{ip}:{port}/wsman",
            "winrm_username": user,
            "winrm_password": secret,
            "winrm_transport": profile.winrm_transport or "ntlm",
            # Discovered hosts routinely present self-signed WinRM certs; skip
            # cert validation for the probe (a profile could tighten this later).
            "winrm_server_cert_validation": "ignore",
        }
    return {
        "ssh_host": ip,
        "ssh_username": profile.username,
        "ssh_password": secret if profile.secret_kind == "password" else None,
        "ssh_private_key": secret if profile.secret_kind == "ssh_key" else None,
        "ssh_port": profile.port or 22,
        "ssh_accept_unknown_hosts": "1" if profile.ssh_accept_unknown_hosts else "0",
    }


def collect_host(db: Session, asset: ITAsset, profile: CredentialProfile,
                 transport: str) -> Dict[str, Any]:
    """Authenticate to one host, inventory it, and write the result onto the
    asset (software + hardware + security posture). Raises RuntimeError with a
    human cause on transport/auth failure."""
    from grc.modules.compliance_plugins.services.agentless_inventory import (
        collect_windows, collect_linux,
    )
    from grc.modules.compliance_plugins.services.software_normaliser import (
        enrich_inventory, preserve_promotions,
    )
    from grc.modules.compliance_plugins.services.security_classifier import apply_posture

    ip = asset.ip_address
    if not ip:
        raise RuntimeError("asset has no ip_address to probe")
    creds = _credentials_dict(profile, ip, transport)
    raw, hardware = collect_windows(creds) if transport == "windows" else collect_linux(creds)

    # Auto-discovered hardware (vCPU / RAM / disk / OEM / serial) — fill blanks,
    # never clobber a curated value.
    for col, val in (hardware or {}).items():
        if val is not None and getattr(asset, col, None) in (None, "", 0):
            setattr(asset, col, val)

    enriched = enrich_inventory(db, raw)
    asset.detected_software_json = preserve_promotions(asset.detected_software_json, enriched)
    apply_posture(asset)
    asset.last_seen_at = datetime.utcnow()
    asset.last_seen_source = "agentless"
    db.add(asset)
    db.flush()
    return {"software": len(enriched), "posture": asset.security_posture}


def deep_collect_run(db: Session, run_id: int) -> Dict[str, int]:
    """After a run's observations are resolved, authenticate to each resolved
    host that a credential covers and pull its full inventory. No-op if the
    tenant has no active winrm/ssh credentials. Best-effort, per-host isolated."""
    run = db.get(DiscoveryRun, run_id)
    if run is None:
        return {"collected": 0, "failed": 0, "skipped": 0}

    has_creds = db.query(CredentialProfile.id).filter(
        CredentialProfile.tenant_id == run.tenant_id,
        CredentialProfile.is_active.is_(True),
        CredentialProfile.kind.in_(("winrm", "ssh")),
    ).first()
    if not has_creds:
        return {"collected": 0, "failed": 0, "skipped": 0, "reason": "no_credentials"}

    obs_rows = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.run_id == run_id,
        DiscoveryObservation.resolution.in_(("created", "merged")),
        DiscoveryObservation.resolved_asset_id.isnot(None),
    ).all()

    collected = failed = skipped = 0
    seen_assets: set = set()
    for obs in obs_rows:
        if collected + failed >= MAX_DEEP_COLLECT_PER_RUN:
            logger.info("deep_collect: run %s hit the per-run cap", run_id)
            break
        if obs.resolved_asset_id in seen_assets:
            continue
        seen_assets.add(obs.resolved_asset_id)
        asset = db.get(ITAsset, obs.resolved_asset_id)
        if asset is None:
            continue
        transport = _transport_for_host(asset, obs)
        if transport is None:
            skipped += 1
            continue
        profile = select_credential(db, run.tenant_id, asset.ip_address, transport)
        if profile is None:
            skipped += 1
            continue
        try:
            with db.begin_nested():
                collect_host(db, asset, profile, transport)
            db.commit()
            collected += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            failed += 1
            logger.info("deep_collect: host %s failed: %s", asset.ip_address, exc)
    return {"collected": collected, "failed": failed, "skipped": skipped}
