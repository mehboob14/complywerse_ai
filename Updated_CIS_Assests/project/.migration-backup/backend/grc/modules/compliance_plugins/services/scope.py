"""Credential scoping resolver.

Given an IntegrationConnection (which holds the stored credential) and the
full list of tenant assets, materialise the actual subset of assets this
credential should be used against.

Four modes:
  - tenant_all  : every asset whose protocol matches the connection's
                  integration_type (default — Hassan's "one cred works
                  for the whole fleet" case).
  - asset_list  : scope_value = {"asset_ids": [1, 7, 23]}
  - asset_tag   : scope_value = {"tags": ["Production", "DMZ"]}
                  matches assets whose `tags` JSON array contains any
                  of the listed tags.
  - ip_range    : scope_value = {"cidrs": ["10.20.0.0/16", "10.21.0.0/24"]}
                  matches assets whose ip_address falls in any CIDR.

Each mode is intersected with the protocol filter — a 'linux_ssh'
credential will NEVER be applied to an AWS-account asset even if
scope_mode='tenant_all'. This keeps the user from accidentally pointing
the wrong key at the wrong asset class.

Called from:
  - compliance_plugins.router.scan_all (filters which assets to run on)
  - connect_wizard_router.handshake (preview the resolution count for
    the operator before they save the scope)
"""
from __future__ import annotations

import ipaddress
from typing import Iterable, Optional


# Maps integration_type → the runner_type a CIS plugin must declare to
# be eligible to run with that credential. We keep this here (not in
# benchmark_matcher) because it's auth-scope concern, not OS-fingerprint.
_INTEGRATION_PROTOCOL: dict[str, str] = {
    "windows_winrm": "windows_winrm",
    "linux_ssh": "linux_ssh",
    "netdev_ssh": "netdev_ssh",
    "cisco_ssh": "netdev_ssh",
    "aws_readonly": "aws_readonly",
    "oracle_sql": "oracle_sql",
}


def _asset_protocol(asset) -> Optional[str]:
    """Best guess: which protocol Compliverse will use to scan this asset.

    Driven by the asset's os_family + os_normalized — Windows hosts get
    windows_winrm, Linux hosts get linux_ssh, Cisco devices get
    netdev_ssh, etc. We only look at family-level keys here because the
    protocol is family-stable (Win 10 22H2 vs 21H2 both use WinRM).
    """
    fam = (getattr(asset, "os_family", None) or "").lower()
    norm = (getattr(asset, "os_normalized", None) or "").lower()
    if fam == "windows" or norm.startswith("windows-"):
        return "windows_winrm"
    if fam == "linux" or any(norm.startswith(p) for p in
                              ("ubuntu-", "debian-", "almalinux-", "oraclelinux-",
                               "amazonlinux-", "rhel-")):
        return "linux_ssh"
    if fam == "cisco" or norm.startswith("cisco-"):
        return "netdev_ssh"
    if norm == "aws-account":
        return "aws_readonly"
    if norm.startswith("oracle-db"):
        return "oracle_sql"
    return None


def _asset_in_cidr(asset, cidrs: list[str]) -> bool:
    """True if asset.ip_address falls in any of the listed CIDRs."""
    ip_raw = getattr(asset, "ip_address", None)
    if not ip_raw:
        return False
    try:
        ip = ipaddress.ip_address(ip_raw.strip())
    except (ValueError, AttributeError):
        return False
    for c in cidrs or []:
        try:
            net = ipaddress.ip_network(c.strip(), strict=False)
            if ip in net:
                return True
        except ValueError:
            continue
    return False


def _asset_has_any_tag(asset, tags: list[str]) -> bool:
    """True if asset.tags JSON array intersects with the requested tags.

    Asset tags are stored as a JSON array column on grc_it_assets. We
    do a case-insensitive compare so the operator doesn't have to worry
    about "DMZ" vs "dmz".
    """
    if not tags:
        return False
    asset_tags = getattr(asset, "tags", None) or []
    wanted = {t.lower() for t in tags if isinstance(t, str)}
    have = {t.lower() for t in asset_tags if isinstance(t, str)}
    return bool(wanted & have)


def resolve_assets(connection, all_assets: Iterable) -> list:
    """Return the subset of `all_assets` this connection's credential
    should run against.

    Used by scan_all and by the Connect Wizard preview. Pure function —
    does not mutate the connection. Caller persists
    `last_scope_resolution_count` after the actual scan if it wants.
    """
    integration_type = getattr(connection, "integration_type", None)
    target_protocol = _INTEGRATION_PROTOCOL.get(integration_type)

    # Stage 1 — protocol filter (always applied, even for tenant_all)
    if target_protocol:
        candidates = [a for a in all_assets if _asset_protocol(a) == target_protocol]
    else:
        # Unknown integration_type — be conservative, return nothing rather
        # than running a random cred against unrelated assets.
        candidates = []

    # Stage 2 — scope filter
    mode = getattr(connection, "scope_mode", "tenant_all") or "tenant_all"
    value = getattr(connection, "scope_value", None) or {}

    if mode == "tenant_all":
        return candidates

    if mode == "asset_list":
        wanted_ids = set(value.get("asset_ids") or [])
        return [a for a in candidates if a.id in wanted_ids]

    if mode == "asset_tag":
        tags = value.get("tags") or []
        return [a for a in candidates if _asset_has_any_tag(a, tags)]

    if mode == "ip_range":
        cidrs = value.get("cidrs") or []
        return [a for a in candidates if _asset_in_cidr(a, cidrs)]

    # Unknown scope_mode — fail closed
    return []


def preview_scope(connection, all_assets: Iterable, *, sample: int = 5) -> dict:
    """Lightweight preview for the UI's 'Scope' step.

    Returns the count of in-scope assets plus a sample so the operator
    can sanity-check the rule before saving.
    """
    resolved = resolve_assets(connection, all_assets)
    return {
        "count": len(resolved),
        "sample": [
            {"id": a.id, "name": a.name, "host_name": getattr(a, "host_name", None),
             "ip_address": getattr(a, "ip_address", None),
             "os_normalized": getattr(a, "os_normalized", None)}
            for a in resolved[:sample]
        ],
    }
