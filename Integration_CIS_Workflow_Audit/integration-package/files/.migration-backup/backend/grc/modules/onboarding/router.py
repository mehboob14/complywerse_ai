"""Bulk onboarding — CIDR discovery + import of selected hosts.

Two endpoints:
  POST /onboarding/discover   — probe a CIDR, return live hosts
  POST /onboarding/import     — take selected hosts, create
                                  ITAsset + IntegrationConnection rows
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from grc.crypto import encrypt_secret
from grc.models import (
    GRCUser,
    IntegrationConnection,
    ITAsset,
    get_db,
)
from grc.routers.auth_router import (
    get_user_primary_tenant,
    require_auth,
    require_tenant_permission,
)

# Bulk CIDR scan + host import are operator actions that change tenant
# inventory and probe the network. Gate behind explicit permission so a
# banking/risk-mgmt user can't trigger network sweeps.
_require_discover_perm = require_tenant_permission("compliance:discover:execute")

from .service import RUNNER_DEFAULT_PORTS, discover_cidr

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/onboarding", tags=["Bulk Onboarding"])


# ─── Schemas ────────────────────────────────────────────────────────────────

class DiscoverRequest(BaseModel):
    cidr: str = Field(min_length=3, max_length=64)
    runner_type: str = Field(default="windows_winrm")
    port_override: Optional[int] = None
    timeout_s: float = Field(default=1.0, ge=0.1, le=10.0)


class HostToImport(BaseModel):
    ip: str
    hostname: Optional[str] = None
    asset_name: Optional[str] = None  # operator can override


class ImportRequest(BaseModel):
    runner_type: str = Field(default="windows_winrm")
    asset_type: str = Field(default="infrastructure")
    criticality: str = Field(default="medium")
    asset_name_prefix: str = Field(default="")
    username: str
    password: str
    port: Optional[int] = None
    hosts: List[HostToImport]


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.post("/discover")
def discover(
    body: DiscoverRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover_perm),
):
    """Probe a CIDR range for hosts reachable on the runner's port."""
    # tenant gate just to keep this auth-only feature scoped
    _ = get_user_primary_tenant(current_user, db)
    result = discover_cidr(
        cidr=body.cidr,
        runner_type=body.runner_type,
        port_override=body.port_override,
        timeout_s=body.timeout_s,
    )
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.post("/import", status_code=201)
def bulk_import(
    body: ImportRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover_perm),
):
    """Create ITAsset + IntegrationConnection rows for each selected host.

    Reuses the same Connection structure as the Connect Wizard so the
    new assets immediately work with Scan All / per-asset scanning.
    Skips hosts that already exist (matched by host_name) so re-running
    discovery is idempotent.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    port = body.port or RUNNER_DEFAULT_PORTS.get(body.runner_type)
    if not port:
        raise HTTPException(400, f"No default port for runner_type={body.runner_type}")

    created_assets: list[dict] = []
    created_connections: list[dict] = []
    skipped: list[dict] = []
    existing_hosts = {
        (a.host_name or "").lower().strip()
        for a in db.query(ITAsset).filter(ITAsset.tenant_id == tenant_id).all()
        if a.host_name
    }

    # Track hosts we've ALREADY created in this batch so a duplicate row
    # in the input doesn't crash with a UNIQUE-violation. Operators
    # uploading a CSV often have dupes; we silently skip the second one.
    batch_hosts: set[str] = set()
    for h in body.hosts:
        host_key = (h.hostname or h.ip).lower().strip()
        if host_key in existing_hosts:
            skipped.append({"host": host_key, "reason": "already exists in tenant"})
            continue
        if host_key in batch_hosts:
            skipped.append({"host": host_key, "reason": "duplicate within this batch"})
            continue
        batch_hosts.add(host_key)

        asset_name = h.asset_name or (
            f"{body.asset_name_prefix}{h.hostname or h.ip}".strip("-") or f"{body.asset_name_prefix}{h.ip}"
        )
        asset = ITAsset(
            tenant_id=tenant_id,
            name=asset_name,
            description=f"Bulk-imported via CIDR discovery ({body.runner_type})",
            asset_type=body.asset_type,
            host_name=h.hostname or h.ip,
            ip_address=h.ip,
            criticality=body.criticality,
            status="active",
            cde_environment=False,
            owner_id=current_user.id,
            owner_name=getattr(current_user, "display_name", None) or current_user.username,
        )
        db.add(asset)
        db.flush()  # so we can read asset.id

        conn = IntegrationConnection(
            tenant_id=tenant_id,
            integration_type=body.runner_type,
            connection_name=f"{body.runner_type} → {asset_name}",
            console_url=h.hostname or h.ip,
            console_port=port,
            auth_method="ntlm" if body.runner_type == "windows_winrm" else "password",
            credential_env_prefix=f"BULK_{asset.id}",  # placeholder; creds stored on row
            username=body.username,
            password=encrypt_secret(body.password),
            is_active=True,
            status="connected",
            created_by_user_id=current_user.id,
        )
        db.add(conn)
        db.flush()

        created_assets.append({"id": asset.id, "name": asset.name, "host": asset.host_name})
        created_connections.append({"id": conn.id, "name": conn.connection_name})

    db.commit()
    logger.info(
        "bulk_onboarding tenant_id=%s created_assets=%s created_connections=%s skipped=%s",
        tenant_id, len(created_assets), len(created_connections), len(skipped),
    )
    return {
        "created_assets": created_assets,
        "created_connections": created_connections,
        "skipped": skipped,
    }


# ─── Cloud egress IPs (for bank firewall whitelist) ─────────────────────────

@router.get("/egress-ips")
def egress_ips(
    current_user: GRCUser = Depends(require_auth),
):
    """Return the public IPs / FQDNs Compliverse uses to call into the
    tenant's network from cloud-direct (agentless) mode.

    The bank's IT team whitelists these in their firewall — once added,
    cloud-direct scans of WinRM (5986), SSH (22), Oracle (1521), and
    vCenter (443) all work without any agent install on the tenant side.

    The list is configurable per-region via the `COMPLIVERSE_EGRESS_IPS`
    env var (comma-separated). If not set, we fall back to a sentinel
    list — operators must replace this with their real cloud egress
    addresses before sharing with a bank. Empty list with a warning is
    safer than a fake placeholder a bank might add and trust.
    """
    import os
    raw = os.environ.get("COMPLIVERSE_EGRESS_IPS", "").strip()
    region = os.environ.get("COMPLIVERSE_REGION", "default")

    if raw:
        ips = [ip.strip() for ip in raw.split(",") if ip.strip()]
        return {
            "region": region,
            "ips": ips,
            "ports": _whitelist_port_summary(),
            "configured": True,
            "note": (
                "Add these IPs as ALLOW rules in your firewall on the listed "
                "ports. Compliverse will scan from these addresses only."
            ),
        }

    return {
        "region": region,
        "ips": [],
        "ports": _whitelist_port_summary(),
        "configured": False,
        "note": (
            "COMPLIVERSE_EGRESS_IPS env var is not configured on this deploy. "
            "Operators must set it (comma-separated public IPs) before sharing "
            "this with a bank."
        ),
    }


def _whitelist_port_summary() -> list[dict[str, Any]]:
    """The standard inbound port list each bank needs to open. Centralised
    so the egress-ips endpoint, the setup-guide doc, and any future
    onboarding script all see the same source of truth."""
    return [
        {"port": 5986, "protocol": "TCP", "purpose": "WinRM HTTPS (Windows hosts)"},
        {"port": 5985, "protocol": "TCP", "purpose": "WinRM HTTP (legacy, optional)"},
        {"port": 22,   "protocol": "TCP", "purpose": "SSH (Linux + Cisco network devices)"},
        {"port": 443,  "protocol": "TCP", "purpose": "VMware vCenter / ESXi REST API"},
        {"port": 1521, "protocol": "TCP", "purpose": "Oracle TNS Listener (Database)"},
    ]
