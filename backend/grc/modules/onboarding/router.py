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
from grc.modules.asset_discovery.services.deep_collect import winrm_endpoint_for
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
        # ─── OS detection — populate os_family / version / normalized ──
        # We probe each host ONCE here so scan_all can later route only
        # the right CIS benchmark family to it (Win-11 rules to Win 11,
        # not to Server 2022). Detection is best-effort: failure returns
        # (None, None, None) and we still create the asset, the matcher
        # falls back to runner_type filtering for unknown hosts.
        from grc.modules.compliance_plugins.services.os_detector import detect_for_runner
        detect_creds: dict
        if body.runner_type == "windows_winrm":
            detect_creds = {
                "winrm_endpoint": winrm_endpoint_for(h.hostname or h.ip, int(port)),
                "winrm_username": body.username,
                "winrm_password": body.password,
                "winrm_transport": "ntlm",
                "winrm_server_cert_validation": "ignore",
            }
        elif body.runner_type in ("linux_ssh", "netdev_ssh"):
            detect_creds = {
                "ssh_host": h.hostname or h.ip,
                "ssh_port": port,
                "ssh_username": body.username,
                "ssh_password": body.password,
            }
        else:
            detect_creds = {}
        os_family, os_version, os_normalized = detect_for_runner(
            body.runner_type, detect_creds,
        )

        asset = ITAsset(
            tenant_id=tenant_id,
            name=asset_name,
            description=f"Bulk-imported via CIDR discovery ({body.runner_type})",
            asset_type=body.asset_type,
            host_name=h.hostname or h.ip,
            ip_address=h.ip,
            os_family=os_family,
            os_version=os_version,
            os_normalized=os_normalized,
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


# ═══════════════════════════════════════════════════════════════════════════
# Active Directory enumeration — credential-driven discovery
# ═══════════════════════════════════════════════════════════════════════════
#
# Banks have ONE service account that has WinRM access on every domain-joined
# Windows host. Asking the operator to type each hostname is wrong. AD already
# knows every machine in the domain — bind once, enumerate the computers OU,
# get back a hostname list. Then the operator selects + onboards in bulk.
#
# Flow:
#   1. POST /onboarding/ad/discover  — given LDAP bind creds, return list
#                                       of (cn, dnsHostName, operatingSystem)
#   2. POST /onboarding/ad/onboard   — given selected hosts + shared WinRM
#                                       creds, create ITAsset rows + ONE
#                                       IntegrationConnection per host
#                                       (all sharing the same creds)
#
# No CIDR sweeping, no per-host token. The shared service account from AD
# is what scans the fleet.


class ADDiscoverIn(BaseModel):
    """LDAP bind credentials + search scope for AD computer enumeration."""
    ldap_url: str = Field(..., description="ldap://dc01.bank.local:389 or ldaps://...:636")
    bind_dn: str = Field(..., description="CN=svc-compliverse,OU=Service Accounts,DC=bank,DC=local — or DOMAIN\\\\user for NTLM")
    bind_password: str = Field(..., description="Plaintext for the bind call; never persisted unless /ad/onboard is called")
    base_dn: str = Field(..., description="DC=bank,DC=local — where to search")
    computer_filter: Optional[str] = Field(
        default="(&(objectClass=computer)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))",
        description="LDAP filter. Default excludes disabled accounts. Override to scope to one OU.",
    )
    use_ssl: Optional[bool] = Field(default=None, description="True for LDAPS. Auto-derived from ldap_url if omitted.")
    page_size: Optional[int] = Field(default=200, description="LDAP paged-search page size")


class ADDiscoveredComputer(BaseModel):
    cn: str
    dns_hostname: Optional[str]
    operating_system: Optional[str]
    operating_system_version: Optional[str]
    distinguished_name: str


class ADDiscoverOut(BaseModel):
    computers: List[ADDiscoveredComputer]
    total: int
    truncated: bool
    note: Optional[str] = None


@router.post("/ad/discover", response_model=ADDiscoverOut)
def ad_discover(
    body: ADDiscoverIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("compliance:agents:manage")),
) -> ADDiscoverOut:
    """Bind to AD, enumerate computer accounts, return hostnames.

    Read-only — does NOT persist anything. The operator inspects the list
    and calls `/ad/onboard` to actually create assets + shared connection.

    Credentials live in memory for the request duration and are never
    written to disk. /ad/onboard re-receives them so the operator can
    confirm before persisting.

    Demo / try-it-out mode: if the operator submits the literal sentinel
    ldap_url "mock://demo" we return 8 realistic-looking fake hosts so
    the operator can walk the rest of the UI (select + onboard) without
    having a real AD server. The onboard step still hits the real DB —
    if you confirm, you get 8 real ITAsset + IntegrationConnection rows
    in YOUR tenant (with placeholder credential bytes). Useful for
    walking a stakeholder through the bulk flow.
    """
    if (body.ldap_url or "").strip().lower() == "mock://demo":
        demo = [
            ADDiscoveredComputer(cn="DC-01",           dns_hostname="dc-01.bank.local",           operating_system="Windows Server 2022", operating_system_version="10.0.20348", distinguished_name="CN=DC-01,OU=Domain Controllers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="DC-02",           dns_hostname="dc-02.bank.local",           operating_system="Windows Server 2022", operating_system_version="10.0.20348", distinguished_name="CN=DC-02,OU=Domain Controllers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="WEB-PROD-01",     dns_hostname="web-prod-01.bank.local",     operating_system="Windows Server 2019", operating_system_version="10.0.17763", distinguished_name="CN=WEB-PROD-01,OU=Servers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="WEB-PROD-02",     dns_hostname="web-prod-02.bank.local",     operating_system="Windows Server 2019", operating_system_version="10.0.17763", distinguished_name="CN=WEB-PROD-02,OU=Servers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="APP-CORE-BANK",   dns_hostname="app-core-bank.bank.local",   operating_system="Windows Server 2022", operating_system_version="10.0.20348", distinguished_name="CN=APP-CORE-BANK,OU=Servers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="FILE-SRV-01",     dns_hostname="file-srv-01.bank.local",     operating_system="Windows Server 2016", operating_system_version="10.0.14393", distinguished_name="CN=FILE-SRV-01,OU=Servers,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="DESKTOP-FRONT-A", dns_hostname="desktop-front-a.bank.local", operating_system="Windows 11 Enterprise", operating_system_version="10.0.22631", distinguished_name="CN=DESKTOP-FRONT-A,OU=Workstations,DC=bank,DC=local"),
            ADDiscoveredComputer(cn="LAPTOP-MEHBOOB",  dns_hostname="laptop-mehboob.bank.local",  operating_system="Windows 11 Enterprise", operating_system_version="10.0.22631", distinguished_name="CN=LAPTOP-MEHBOOB,OU=Workstations,DC=bank,DC=local"),
        ]
        return ADDiscoverOut(
            computers=demo, total=len(demo), truncated=False,
            note="DEMO mode — 8 realistic-looking fake hosts. Onboard will still write real DB rows in your tenant if you click through.",
        )

    try:
        from ldap3 import Server, Connection, ALL, NTLM, SUBTREE, SIMPLE  # type: ignore
    except ImportError:
        raise HTTPException(
            500,
            "AD discovery requires the `ldap3` Python package. "
            "Install: `pip install ldap3` in the backend env."
        )

    use_ssl = body.use_ssl if body.use_ssl is not None else body.ldap_url.lower().startswith("ldaps://")
    server_uri = body.ldap_url
    if server_uri.lower().startswith("ldap://"):
        server_uri = server_uri[len("ldap://"):]
    elif server_uri.lower().startswith("ldaps://"):
        server_uri = server_uri[len("ldaps://"):]

    try:
        server = Server(server_uri, use_ssl=use_ssl, get_info=ALL)
        auth_method = NTLM if "\\" in body.bind_dn else SIMPLE
        conn = Connection(
            server,
            user=body.bind_dn,
            password=body.bind_password,
            authentication=auth_method,
            auto_bind=True,
            read_only=True,
            receive_timeout=15,
        )
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "invalidcredentials" in msg or "credential" in msg:
            raise HTTPException(401, "AD rejected the bind credentials. Check bind_dn and password.")
        if "connection" in msg or "refused" in msg or "timeout" in msg:
            raise HTTPException(503, f"Cannot reach AD at {server_uri}: {exc}")
        raise HTTPException(500, f"AD bind failed: {exc}")

    try:
        filter_ = body.computer_filter or "(objectClass=computer)"
        attrs = ["cn", "dNSHostName", "operatingSystem", "operatingSystemVersion"]
        results: list[ADDiscoveredComputer] = []
        truncated = False
        for entry in conn.extend.standard.paged_search(
            search_base=body.base_dn,
            search_filter=filter_,
            search_scope=SUBTREE,
            attributes=attrs,
            paged_size=int(body.page_size or 200),
            generator=True,
        ):
            if entry.get("type") != "searchResEntry":
                continue
            attrs_d = entry.get("attributes") or {}

            def _first(v: Any) -> Optional[str]:
                if isinstance(v, list):
                    return v[0] if v else None
                return v if v else None

            results.append(ADDiscoveredComputer(
                cn=_first(attrs_d.get("cn")) or "<unknown>",
                dns_hostname=_first(attrs_d.get("dNSHostName")),
                operating_system=_first(attrs_d.get("operatingSystem")),
                operating_system_version=_first(attrs_d.get("operatingSystemVersion")),
                distinguished_name=entry.get("dn", ""),
            ))
            if len(results) >= 5000:
                truncated = True
                break
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"AD search failed: {exc}")
    finally:
        try:
            conn.unbind()
        except Exception:
            pass

    return ADDiscoverOut(
        computers=results,
        total=len(results),
        truncated=truncated,
        note=(
            f"Searched {body.base_dn} with filter {filter_!r}. "
            f"Returned {len(results)} computer(s)."
            + (" Truncated at 5000 — narrow the OU or filter to see more." if truncated else "")
        ),
    )


class ADOnboardIn(BaseModel):
    """Selected hosts from /ad/discover + ONE shared WinRM credential to
    link to all of them. The credential is stored once per host
    (encrypted via the tenant Fernet key) on an IntegrationConnection
    row; the existing scan-all path matches by host_name."""
    hostnames: List[str] = Field(..., description="DNS hostnames the operator confirmed to onboard")
    winrm_username: str = Field(..., description="DOMAIN\\\\user or user@domain")
    winrm_password: str = Field(..., description="Encrypted at rest with tenant Fernet key")
    winrm_port: Optional[int] = Field(default=5986, description="WinRM HTTPS port")
    integration_type: str = Field(default="windows_winrm", description="Runner type for all created connections")
    connection_label_prefix: Optional[str] = Field(
        default="AD",
        description="Connection-name prefix (e.g. 'AD' → 'AD · dc-01.bank.local')",
    )


class ADOnboardOut(BaseModel):
    created_assets: int
    updated_assets: int
    created_connections: int
    skipped: List[dict]


@router.post("/ad/onboard", response_model=ADOnboardOut, status_code=201)
def ad_onboard(
    body: ADOnboardIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("compliance:agents:manage")),
) -> ADOnboardOut:
    """Bulk-create asset + connection rows for AD-discovered hosts.

    For each hostname:
      - get-or-create ITAsset (host_name match within tenant)
      - get-or-create IntegrationConnection with the shared credential
        (Fernet-encrypted)
      - existing scan-all flow finds the connection by host_name match
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(400, "User has no tenant context")

    created_assets = 0
    updated_assets = 0
    created_connections = 0
    skipped: list[dict] = []

    encrypted_password = encrypt_secret(body.winrm_password)
    label_prefix = (body.connection_label_prefix or "").strip()

    for raw_host in body.hostnames:
        host = (raw_host or "").strip().lower()
        if not host:
            continue
        asset = (
            db.query(ITAsset)
            .filter(ITAsset.tenant_id == tenant_id, ITAsset.host_name == host)
            .first()
        )
        if asset is None:
            asset = ITAsset(
                tenant_id=tenant_id,
                name=host,
                description=f"Auto-discovered via Active Directory ({body.integration_type})",
                asset_type="infrastructure",
                host_name=host,
                os_family="windows",
                os_normalized="windows",  # family-fallback until first scan refines
                status="active",
                owner_id=current_user.id,
                owner_name=current_user.display_name or current_user.username,
                criticality="medium",
            )
            db.add(asset)
            db.flush()
            created_assets += 1
        else:
            if asset.owner_id is None:
                asset.owner_id = current_user.id
                asset.owner_name = current_user.display_name or current_user.username
                updated_assets += 1

        existing_conn = (
            db.query(IntegrationConnection)
            .filter(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.console_url == host,
                IntegrationConnection.integration_type == body.integration_type,
            )
            .first()
        )
        if existing_conn is None:
            label = f"{label_prefix} · {host}" if label_prefix else host
            conn = IntegrationConnection(
                tenant_id=tenant_id,
                connection_name=label,
                integration_type=body.integration_type,
                console_url=host,
                service_account=body.winrm_username,
                encrypted_credentials=encrypted_password,
                endpoint_url=winrm_endpoint_for(host, int(body.winrm_port or 5986)),
                is_active=True,
                status="pending_verification",
            )
            db.add(conn)
            created_connections += 1
        else:
            skipped.append({
                "hostname": host,
                "reason": "Connection already exists for this host + integration_type",
                "existing_connection_id": existing_conn.id,
            })

    db.commit()
    return ADOnboardOut(
        created_assets=created_assets,
        updated_assets=updated_assets,
        created_connections=created_connections,
        skipped=skipped,
    )


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
