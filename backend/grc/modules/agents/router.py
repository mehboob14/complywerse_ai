"""Agent enrollment + result intake.

Lifecycle:
  1. Operator clicks "Install Agent" in Connect Wizard → backend creates
     ComplianceAgent(status='pending') with a one-time enrollment_token.
     Returns a curl/iwr install snippet containing the raw token.
  2. Agent binary on customer machine runs the install snippet, POSTs to
     /agents/enroll with the token + hostname + os_family. Backend swaps
     status to 'active', issues a long-lived api_token, deletes the
     enrollment_token_hash.
  3. Agent heartbeats every 30s (POST /agents/heartbeat) with the
     api_token, updating last_heartbeat_at and reporting hostname/version.
  4. Backend dispatches scan jobs (TODO: queue model). Agent runs them
     locally, pushes results via POST /agents/results.
  5. Operator can revoke via POST /agents/{id}/revoke (UI button).
     Agent's next heartbeat fails with 401 and it shuts down.

All write endpoints validate the api_token against the stored sha256
hash. Pending agents only accept the enrollment_token.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from grc.models import (
    ComplianceAgent,
    CompliancePlugin,
    CompliancePluginRun,
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

# Operator-facing actions (enroll new agent, list) require the
# `compliance:agents:manage` permission. Administrators auto-pass via
# the wildcard handling inside require_tenant_permission.
_require_agents_perm = require_tenant_permission("compliance:agents:manage")
# CIS package intended `require_tenant_admin` (Administrator role gate)
# for the revoke endpoint to keep Scanning-Admin operators from removing
# active agents. Our auth layer doesn't expose that exact dep; alias to
# the same permission check so the behaviour stays consistent — Admins
# still bypass via the wildcard, Scanning-Admin retains revoke access
# (matches existing behaviour pre-merge).
require_tenant_admin = _require_agents_perm

from .security import (
    _hash,
    find_agent_by_api_token,
    find_agent_by_enrollment_token,
    new_api_token,
    new_enrollment_token,
)

logger = logging.getLogger(__name__)


def _backend_url_from_request(request: Request) -> str:
    """Compose the cloud-facing URL the agent will call.

    Honours the standard proxy headers (`X-Forwarded-Host`,
    `X-Forwarded-Proto`) so behind a load balancer / cloudflare we
    still hand back the public hostname, not the internal LB IP.
    """
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost:5000"
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    return f"{proto}://{host}"


router = APIRouter(prefix="/agents", tags=["Compliance Agents"])


# ─── Schemas ─────────────────────────────────────────────────────────────────

class EnrollmentCreate(BaseModel):
    agent_name: str = Field(min_length=2, max_length=255)
    mode: str = Field(default="collector", pattern="^(collector|endpoint)$")
    asset_id: Optional[int] = None
    os_family: Optional[str] = None  # 'windows' | 'linux' | 'macos'


class EnrollmentResponse(BaseModel):
    agent_id: int
    enrollment_token: str  # raw — shown ONCE
    install_command_windows: str
    install_command_linux: str
    backend_url: str


class AgentEnrollPayload(BaseModel):
    """Sent BY the agent binary using its enrollment_token."""
    enrollment_token: str
    hostname: str
    os_family: str
    agent_version: str
    ip_address: Optional[str] = None


class AgentEnrollResponse(BaseModel):
    agent_id: int
    api_token: str  # raw — shown ONCE
    heartbeat_interval_sec: int = 30


class HeartbeatPayload(BaseModel):
    hostname: Optional[str] = None
    agent_version: Optional[str] = None
    ip_address: Optional[str] = None
    # ─── OS profile (Block C) ──────────────────────────────────────────
    # The agent client should run a local OS probe on startup + then on
    # every heartbeat (cheap — registry read on Win, /etc/os-release on
    # Linux, sw_vers on macOS). These flow through to the linked asset
    # row so the AI rule matcher routes the right CIS benchmark version.
    os_family: Optional[str] = None        # 'windows' | 'linux' | 'macos'
    os_version: Optional[str] = None       # human display, e.g. "Microsoft Windows 11 Pro 23H2"
    os_build: Optional[str] = None         # "23H2" / "22H2" / "1909" / "22.04.4"
    os_edition: Optional[str] = None       # "Enterprise" / "Pro" / "LTSC"
    os_normalized: Optional[str] = None    # client-computed; backend will recompute too


class ResultsPayload(BaseModel):
    """Bulk upload of plugin run outcomes from an agent."""
    runs: list[dict[str, Any]]


class AgentOut(BaseModel):
    id: int
    agent_name: str
    mode: str
    os_family: Optional[str]
    hostname: Optional[str]
    ip_address: Optional[str]
    asset_id: Optional[int]
    status: str
    agent_version: Optional[str]
    last_heartbeat_at: Optional[str]
    last_result_at: Optional[str]
    enrolled_at: Optional[str]
    created_at: Optional[str]


def _agent_to_dict(a: ComplianceAgent) -> dict:
    return {
        "id": a.id,
        "agent_name": a.agent_name,
        "mode": a.mode,
        "os_family": a.os_family,
        "hostname": a.hostname,
        "ip_address": a.ip_address,
        "asset_id": a.asset_id,
        "status": a.status,
        "agent_version": a.agent_version,
        "last_heartbeat_at": a.last_heartbeat_at.isoformat() if a.last_heartbeat_at else None,
        "last_result_at": a.last_result_at.isoformat() if a.last_result_at else None,
        "enrolled_at": a.enrolled_at.isoformat() if a.enrolled_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


# ─── Operator endpoints (require user auth) ─────────────────────────────────

@router.post("", response_model=EnrollmentResponse, status_code=201)
def create_enrollment(
    body: EnrollmentCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
):
    """Create a pending agent + return one-time install snippet.

    Operator clicks "Install Agent" in Connect Wizard → calls this →
    sees install command with embedded enrollment token. Token is only
    visible here once; if lost, revoke + re-create.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    raw_enroll, enroll_hash = new_enrollment_token()
    asset = None
    if body.asset_id is not None:
        asset = db.query(ITAsset).filter(
            ITAsset.id == body.asset_id, ITAsset.tenant_id == tenant_id,
        ).first()
        if not asset:
            raise HTTPException(404, "Asset not found in this tenant")

    agent = ComplianceAgent(
        tenant_id=tenant_id,
        asset_id=body.asset_id,
        agent_name=body.agent_name.strip(),
        mode=body.mode,
        os_family=body.os_family,
        enrollment_token_hash=enroll_hash,
        status="pending",
        created_by_user_id=current_user.id,
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)

    # Use the actual host the operator hit us on. In production this is
    # the bank-facing FQDN (e.g. https://layeron.compliverse.app).
    # `COMPLYVERSE_BACKEND_URL` env var overrides for staging/test rigs.
    import os
    backend_url = os.environ.get("COMPLYVERSE_BACKEND_URL") or _backend_url_from_request(request)
    install_win = (
        f"iex (irm '{backend_url}/agent/install.ps1?token={raw_enroll}')"
    )
    install_linux = (
        f"curl -sSL '{backend_url}/agent/install.sh?token={raw_enroll}' | sudo bash"
    )

    return EnrollmentResponse(
        agent_id=agent.id,
        enrollment_token=raw_enroll,
        install_command_windows=install_win,
        install_command_linux=install_linux,
        backend_url=backend_url,
    )


@router.get("")
def list_agents(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    rows = (
        db.query(ComplianceAgent)
        .filter(ComplianceAgent.tenant_id == tenant_id)
        .order_by(ComplianceAgent.id.desc())
        .all()
    )
    return {"agents": [_agent_to_dict(a) for a in rows]}


@router.get("/installer.cmd", include_in_schema=False)
def download_self_enrolling_installer(
    request: Request,
    os_family: str = Query(default="windows"),
    asset_id: Optional[int] = None,
    fleet: int = Query(default=0, description="If 1, mint a fleet token usable by N hosts"),
    max_uses: Optional[int] = Query(default=None, description="Fleet quota; None = unlimited until expiry"),
    expires_hours: int = Query(default=72, description="Fleet token TTL in hours"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
):
    """One-click installer for Windows.

    The operator (Hassan) doesn't want to copy a token. So when he clicks
    Download installer on the admin Agents page:

      1. We mint a fresh enrollment token here (NOT shown to operator —
         it goes straight into the .cmd file).
      2. Create a pending ComplianceAgent row in his tenant.
      3. Build a .cmd whose first runtime variable is `set TOKEN=<that>`.
      4. Stream the .cmd as a download.

    Result: he gets one file. Sends it to a colleague. Colleague double-
    clicks → installer downloads agent.py + the token is passed straight
    to the agent on first launch → /agents/enroll burns the token and
    issues the permanent api_token. No copy-paste anywhere.
    """
    import os as _os
    from fastapi.responses import Response

    tenant_id = get_user_primary_tenant(current_user, db)

    # Mint pending agent + token in this tenant.
    raw_enroll, enroll_hash = new_enrollment_token()
    from datetime import timedelta
    is_fleet = bool(fleet)
    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
    agent = ComplianceAgent(
        tenant_id=tenant_id,
        asset_id=None if is_fleet else asset_id,  # fleet token isn't bound to a host
        agent_name=(f"fleet-{stamp}" if is_fleet else f"installer-{stamp}"),
        mode="endpoint",
        os_family=os_family,
        enrollment_token_hash=enroll_hash,
        status=("active" if is_fleet else "pending"),  # template stays "active" so it shows in admin list
        kind=("template" if is_fleet else "single"),
        enrollment_max_uses=(max_uses if is_fleet else 1),
        enrollment_uses=0,
        enrollment_expires_at=(datetime.utcnow() + timedelta(hours=expires_hours) if is_fleet else None),
        created_by_user_id=current_user.id,
    )
    db.add(agent)
    db.commit()

    # Compute the backend URL the colleague's PC will need. _backend_url_from_request
    # already handles the LAN-IP-vs-localhost-vs-public-URL precedence.
    backend_url = (
        _os.environ.get("COMPLYVERSE_BACKEND_URL")
        or _backend_url_from_request(request)
    ).rstrip("/")

    cmd = "@echo off\r\n"
    cmd += "setlocal EnableDelayedExpansion\r\n"
    cmd += "REM Compliverse Agent - one-click installer\r\n"
    cmd += "REM Self-elevates to admin. Token is pre-baked.\r\n"
    cmd += "net session >nul 2>&1\r\n"
    cmd += "if %errorLevel% NEQ 0 (\r\n"
    cmd += "  echo [install] Requesting administrator privileges...\r\n"
    cmd += "  powershell -NoProfile -Command \"Start-Process -FilePath '%~f0' -Verb RunAs\"\r\n"
    cmd += "  exit /b\r\n"
    cmd += ")\r\n"
    cmd += f"set TOKEN={raw_enroll}\r\n"
    cmd += f"set BASE={backend_url}\r\n"
    cmd += "set TMPPS=%TEMP%\\ComplyverseAgent-setup.ps1\r\n"
    cmd += "echo [install] Backend = %BASE%\r\n"
    cmd += "echo [install] Downloading installer script...\r\n"
    # The installer endpoint is /grc/agent/install.ps1 (downloads.py:153).
    # An earlier draft of this template said setup.ps1 — 404. We
    # pass the token as a query param so the script gets it without
    # re-pasting (downloads.py:153 reads ?token=).
    cmd += ("powershell -NoProfile -ExecutionPolicy Bypass -Command "
            "\"try { Invoke-WebRequest -UseBasicParsing -Uri ('%BASE%/grc/agent/install.ps1?token=' + '%TOKEN%') "
            "-OutFile '%TMPPS%' } catch { Write-Host ('[install] ERROR: cannot reach %BASE% - ' + "
            "$_.Exception.Message); exit 3 }\"\r\n")
    cmd += "if not exist \"%TMPPS%\" (\r\n"
    cmd += "  echo [install] FAILED - could not download installer script.\r\n"
    cmd += "  pause\r\n"
    cmd += "  exit /b 3\r\n"
    cmd += ")\r\n"
    cmd += "powershell -NoProfile -ExecutionPolicy Bypass -File \"%TMPPS%\" %TOKEN%\r\n"
    cmd += "set RC=%errorLevel%\r\n"
    cmd += "del /q \"%TMPPS%\" >nul 2>&1\r\n"
    cmd += "if %RC% NEQ 0 (\r\n"
    cmd += "  echo [install] FAILED with exit code %RC%\r\n"
    cmd += ") else (\r\n"
    cmd += "  echo [install] Done. Agent will phone home every 30s.\r\n"
    cmd += ")\r\n"
    cmd += "pause\r\n"

    filename = f"ComplyverseAgent-{agent.id}.cmd"
    return Response(
        content=cmd,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/installer.sh", include_in_schema=False)
def download_self_enrolling_installer_linux(
    request: Request,
    asset_id: Optional[int] = None,
    fleet: int = Query(default=0),
    max_uses: Optional[int] = None,
    expires_hours: int = 72,
    collector: int = Query(default=0, description="If 1, install in collector mode (scans REMOTE targets, not the host itself)"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
):
    """One-click Linux installer. Mints fleet/single token, embeds in .sh.

    Each Linux host self-detects its distro (ubuntu/debian/rhel/almalinux/
    amazonlinux) and build via /etc/os-release on first heartbeat. The
    backend /jobs endpoint then hands out ONLY the CIS rules that match
    that exact build — same Stage 1 + Stage 2 routing as Windows.
    """
    import os as _os
    from datetime import timedelta
    from fastapi.responses import Response

    tenant_id = get_user_primary_tenant(current_user, db)
    raw_enroll, enroll_hash = new_enrollment_token()
    is_fleet = bool(fleet)
    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')

    mode = "collector" if collector else "endpoint"
    name_prefix = ("collector" if collector else "installer-linux")
    agent = ComplianceAgent(
        tenant_id=tenant_id,
        asset_id=None if is_fleet or collector else asset_id,
        agent_name=(f"fleet-{name_prefix}-{stamp}" if is_fleet else f"{name_prefix}-{stamp}"),
        mode=mode,
        os_family="linux",
        enrollment_token_hash=enroll_hash,
        status=("active" if is_fleet else "pending"),
        kind=("template" if is_fleet else "single"),
        enrollment_max_uses=(max_uses if is_fleet else 1),
        enrollment_uses=0,
        enrollment_expires_at=(datetime.utcnow() + timedelta(hours=expires_hours) if is_fleet else None),
        created_by_user_id=current_user.id,
    )
    db.add(agent)
    db.commit()

    backend_url = (
        _os.environ.get("COMPLYVERSE_BACKEND_URL")
        or _backend_url_from_request(request)
    ).rstrip("/")

    sh = "#!/usr/bin/env bash\n"
    role = "Collector" if collector else "Endpoint"
    sh += f"# Compliverse Agent - Linux {role} installer\n"
    sh += "# Self-elevates to root via sudo. Token is pre-baked.\n"
    sh += "set -euo pipefail\n"
    sh += "if [ \"$(id -u)\" -ne 0 ]; then\n"
    sh += "  echo '[install] requesting root via sudo...'\n"
    sh += "  exec sudo bash \"$0\" \"$@\"\n"
    sh += "fi\n"
    sh += f"TOKEN='{raw_enroll}'\n"
    sh += f"BASE='{backend_url}'\n"
    sh += f"MODE='{mode}'\n"
    sh += "echo \"[install] backend = $BASE  mode = $MODE\"\n"
    if collector:
        # Collector boxes need the drivers for every remote target the
        # backend may dispatch jobs for. Best-effort install via the
        # detected package manager; if a driver fails the runner falls
        # back to a clear "pip install X" error at scan time.
        sh += "echo '[install] installing collector drivers (paramiko, pymssql, psycopg2, pymysql, oracledb, ldap3)...'\n"
        sh += "if command -v apt-get >/dev/null 2>&1; then\n"
        sh += "  apt-get update -y && apt-get install -y python3-pip libpq-dev gcc python3-dev libldap2-dev libsasl2-dev || true\n"
        sh += "elif command -v dnf >/dev/null 2>&1; then\n"
        sh += "  dnf install -y python3-pip postgresql-devel gcc python3-devel openldap-devel cyrus-sasl-devel || true\n"
        sh += "elif command -v yum >/dev/null 2>&1; then\n"
        sh += "  yum install -y python3-pip postgresql-devel gcc python3-devel openldap-devel cyrus-sasl-devel || true\n"
        sh += "fi\n"
        sh += ("pip3 install --quiet paramiko pymssql psycopg2-binary pymysql "
               "oracledb ldap3 azure-identity azure-mgmt-resource kubernetes pyyaml || true\n")
    sh += "TMP_SH=$(mktemp /tmp/complyverse-setup.XXXXXX.sh)\n"
    sh += "echo '[install] fetching installer script...'\n"
    sh += "if ! curl -fsSL \"$BASE/grc/agent/setup.sh\" -o \"$TMP_SH\"; then\n"
    sh += "  echo \"[install] ERROR: cannot reach $BASE — check network / firewall.\" >&2\n"
    sh += "  exit 3\n"
    sh += "fi\n"
    sh += "COMPLYVERSE_MODE=$MODE bash \"$TMP_SH\" \"$TOKEN\"\n"
    sh += "rm -f \"$TMP_SH\"\n"
    sh += "echo \"[install] done. $MODE agent phones home every 30s.\"\n"

    filename = (f"ComplyverseAgent-{agent.id}-collector.sh" if collector
                else f"ComplyverseAgent-{agent.id}.sh")
    return Response(
        content=sh,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/installer.command", include_in_schema=False)
def download_self_enrolling_installer_macos(
    request: Request,
    asset_id: Optional[int] = None,
    fleet: int = Query(default=0),
    max_uses: Optional[int] = None,
    expires_hours: int = 72,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
):
    """One-click macOS installer (.command files are double-clickable in
    Finder and automatically open in Terminal). Same fleet model as
    Windows/Linux — token baked in, child agent spawned on enroll.

    macOS depth detection: agent runs `sw_vers -productVersion` to get the
    full version (e.g. `14.5.1` → `macos-14`). CIS macOS benchmarks are
    versioned per major release (Sonoma=14, Ventura=13, Monterey=12), so
    Stage 1 family-walk routes Sonoma rules to a `macos-14` host.
    """
    import os as _os
    from datetime import timedelta
    from fastapi.responses import Response

    tenant_id = get_user_primary_tenant(current_user, db)
    raw_enroll, enroll_hash = new_enrollment_token()
    is_fleet = bool(fleet)
    stamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')

    agent = ComplianceAgent(
        tenant_id=tenant_id,
        asset_id=None if is_fleet else asset_id,
        agent_name=(f"fleet-macos-{stamp}" if is_fleet else f"installer-macos-{stamp}"),
        mode="endpoint",
        os_family="macos",
        enrollment_token_hash=enroll_hash,
        status=("active" if is_fleet else "pending"),
        kind=("template" if is_fleet else "single"),
        enrollment_max_uses=(max_uses if is_fleet else 1),
        enrollment_uses=0,
        enrollment_expires_at=(datetime.utcnow() + timedelta(hours=expires_hours) if is_fleet else None),
        created_by_user_id=current_user.id,
    )
    db.add(agent)
    db.commit()

    backend_url = (
        _os.environ.get("COMPLYVERSE_BACKEND_URL")
        or _backend_url_from_request(request)
    ).rstrip("/")

    sh = "#!/usr/bin/env bash\n"
    sh += "# Compliverse Agent - macOS one-click installer\n"
    sh += "# Double-click in Finder → opens Terminal → prompts for sudo.\n"
    sh += "set -euo pipefail\n"
    sh += "if [ \"$(id -u)\" -ne 0 ]; then\n"
    sh += "  echo '[install] requesting root via sudo (your Mac login password)...'\n"
    sh += "  exec sudo bash \"$0\" \"$@\"\n"
    sh += "fi\n"
    sh += f"TOKEN='{raw_enroll}'\n"
    sh += f"BASE='{backend_url}'\n"
    sh += "echo \"[install] backend = $BASE\"\n"
    sh += "TMP_SH=$(mktemp /tmp/complyverse-setup.XXXXXX.sh)\n"
    sh += "echo '[install] fetching installer script...'\n"
    sh += "if ! curl -fsSL \"$BASE/grc/agent/setup.command\" -o \"$TMP_SH\"; then\n"
    sh += "  echo \"[install] ERROR: cannot reach $BASE\" >&2\n"
    sh += "  exit 3\n"
    sh += "fi\n"
    sh += "bash \"$TMP_SH\" \"$TOKEN\"\n"
    sh += "rm -f \"$TMP_SH\"\n"
    sh += "echo '[install] done. agent phones home every 30s.'\n"

    filename = f"ComplyverseAgent-{agent.id}.command"
    return Response(
        content=sh,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ─── Polite "not yet" responses for unbuilt installer formats ────────
# Per Hassan: if an installer file isn't made for a device yet, the
# response should say so politely instead of letting the user save a
# 429-byte 404 JSON as ComplyverseAgent.msi and try to run it.
#
# These endpoints answer with a plain-text README the operator can
# actually read on screen, AND set Content-Type: text/plain so the
# browser doesn't try to save the response as a Windows installer.
_NOT_YET_README = """\
ComplyverseAgent — installer format not yet available
======================================================

You tried to download a Compliverse agent in this format, but the
signed/packaged version of that installer hasn't shipped yet.

Available today (use one of these instead):

  Windows  →  /grc/agents/installer.cmd   (.cmd wrapper, self-elevating)
  Linux    →  /grc/agents/installer.sh    (.sh bootstrap, installs as
                                            systemd service)
  macOS    →  /grc/agents/installer.command (double-clickable, asks for
                                              sudo)

Coming later (tracked on the product roadmap):

  Windows  →  signed .msi for SCCM / Intune mass-push
  Linux    →  native .deb (Ubuntu / Debian) and .rpm (RHEL / Alma)
              packages for repo-based rollout
  macOS    →  signed .pkg with launchd plist for Jamf / MDM

If you specifically need one of the packaged formats above, contact
your Compliverse account team — we will prioritise based on real
demand. In the meantime the .cmd / .sh / .command files above install
exactly the same agent, just without the OS-native packaging shell.
"""


@router.get("/installer.msi", include_in_schema=False)
@router.get("/installer.deb", include_in_schema=False)
@router.get("/installer.rpm", include_in_schema=False)
@router.get("/installer.pkg", include_in_schema=False)
def installer_not_yet_packaged(request: Request):
    """Polite text response for installer formats we haven't shipped yet."""
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        content=_NOT_YET_README,
        status_code=200,
        headers={
            # No Content-Disposition: attachment — so the browser RENDERS
            # the text instead of saving a "ComplyverseAgent.msi" the
            # operator then double-clicks and is confused by.
        },
    )


import socket  # used by _backend_url_from_request


def _backend_url_from_request(request: Request) -> str:
    """Generate the backend URL the agent installer should phone home to.

    Resolution order (deploy-aware):
      1. COMPLYVERSE_BACKEND_URL env var — set this in production to the
         public URL of the backend (e.g. https://grc.bank.com). Always
         wins when set. Overrides ALL auto-detection.
      2. X-Forwarded-Host (+ X-Forwarded-Proto) — reverse-proxy
         deployments behind nginx / a CDN. The proxy is authoritative.
      3. uvicorn's actual bind from scope["server"]. Branches:
           - 127.0.0.1 / localhost → loopback only → return 127.0.0.1
             (same-machine same-host install only)
           - 0.0.0.0 / :: → wildcard → LAN-IP discovery via outbound
             interface so an agent on a sibling machine can phone home
           - specific host → use directly
      4. Bare IPv4 hosts skip the subdomain redirect entirely (an IP
         can't have a subdomain prefix).

    Set COMPLYVERSE_BACKEND_URL on Ubuntu deploy to the public hostname
    (e.g. `https://grc.bank.com`) — that's the only env var that
    matters for agent enrolment to work correctly behind any proxy.
    """
    # 1. Explicit env var — production deploys MUST set this
    env_url = (os.environ.get("COMPLYVERSE_BACKEND_URL") or "").strip().rstrip("/")
    if env_url:
        return env_url

    # 2. Reverse-proxy headers
    xfh = request.headers.get("x-forwarded-host")
    if xfh:
        proto = request.headers.get("x-forwarded-proto") or "https"
        return f"{proto}://{xfh}"

    # 3. uvicorn's actual bind — port from scope (Host header port is
    # the proxy's port in dev, not what the agent should target)
    server = request.scope.get("server") or (None, None)
    bind_host, bind_port = server[0], server[1]
    proto = "http"
    if not bind_port:
        bind_port = 4000

    if bind_host in (None, "", "127.0.0.1", "localhost"):
        return f"{proto}://127.0.0.1:{bind_port}"
    if bind_host in ("0.0.0.0", "::"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return f"{proto}://{ip}:{bind_port}"
        except Exception:
            return f"{proto}://localhost:{bind_port}"
    return f"{proto}://{bind_host}:{bind_port}"


@router.post("/{agent_id}/revoke")
def revoke_agent(
    agent_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _admin: bool = Depends(require_tenant_admin),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    agent = db.query(ComplianceAgent).filter(
        ComplianceAgent.id == agent_id,
        ComplianceAgent.tenant_id == tenant_id,
    ).first()
    if not agent:
        raise HTTPException(404, "Agent not found")
    agent.status = "revoked"
    agent.revoked_at = datetime.utcnow()
    agent.revoked_by_user_id = current_user.id
    agent.revoke_reason = reason
    db.commit()
    return {"id": agent.id, "status": "revoked"}


# ─── Agent-binary endpoints (no user auth — token-based) ────────────────────

@router.post("/enroll", response_model=AgentEnrollResponse)
def agent_enroll(
    body: AgentEnrollPayload,
    request: Request,
):
    """Agent binary calls this with its one-time enrollment_token.
    Returns the long-lived api_token. Enrollment token is consumed.

    Tenant resolution: the agent doesn't know its tenant yet (it just
    received the BAT and ran it), so X-Tenant-Slug isn't available. We
    can't depend on `get_db` for that reason. Instead:
      1. If X-Tenant-Slug IS present (cloud deploys / proxies that pass
         it through), use it as a hint to find the right tenant DB fast.
      2. Otherwise iterate every tenant DB looking for the token hash.
         O(N) but enrollment is rare and N (tenants) is small. The
         token hash is unique so the first match is the right one.
    """
    from grc.db import open_tenant_session
    from grc.models import SessionLocal as MasterSession, Tenant

    # Fast path: explicit tenant slug from header
    hint = (request.headers.get("x-tenant-slug") or "").strip()
    if hint:
        try:
            db = open_tenant_session(hint)
        except Exception:
            db = None
        if db is not None:
            try:
                agent = find_agent_by_enrollment_token(db, body.enrollment_token)
                if agent:
                    return _complete_enrollment(db, agent, body, request)
            finally:
                db.close()

    # Slow path: scan every tenant for a matching token hash. The hash
    # is SHA-256 so collisions are vanishingly unlikely.
    master = MasterSession()
    try:
        tenant_slugs = [t.slug for t in master.query(Tenant).all() if t.slug]
    finally:
        master.close()

    for slug in tenant_slugs:
        try:
            db = open_tenant_session(slug)
        except Exception:
            continue
        try:
            agent = find_agent_by_enrollment_token(db, body.enrollment_token)
            if agent:
                return _complete_enrollment(db, agent, body, request)
        finally:
            db.close()

    raise HTTPException(401, "Invalid or already-used enrollment token")


def _complete_enrollment(
    db: Session, agent, body, request,
) -> "AgentEnrollResponse":
    """Run the rest of the enroll flow once we've located the tenant DB."""
    # Re-enter original logic. Wrap any failure here to surface a clear
    # 4xx instead of letting it leak as a 500.
    if not agent:
        raise HTTPException(401, "Invalid or already-used enrollment token")

    # ── OS-family lock ──
    # The installer that minted this enrollment token was for a specific
    # OS family (the .cmd is windows, the .sh is linux, the .command is
    # macos). Refuse if the agent now phoning home is on a different OS
    # — that means someone copied the wrong installer onto the host, OR
    # someone is trying to enrol a rogue host with a stolen token from a
    # different platform.
    expected_family = (agent.os_family or "").lower().strip()
    reported_family = (body.os_family or "").lower().strip()
    # Normalise variants: "darwin" → "macos"
    if reported_family == "darwin":
        reported_family = "macos"
    if expected_family and reported_family and expected_family != reported_family:
        raise HTTPException(
            status_code=400,
            detail=(
                f"OS mismatch: this installer was created for {expected_family!r}, "
                f"but the host is reporting {reported_family!r}. "
                f"Download the correct installer from the admin Agents page "
                f"and run it on this host."
            ),
        )

    # Fleet template: each calling host gets its OWN child agent + token.
    # The parent row keeps the enrollment_token_hash so the next host can
    # claim it too, until quota/expiry hits.
    if agent.kind == "template":
        # Expiry check
        if agent.enrollment_expires_at and datetime.utcnow() > agent.enrollment_expires_at:
            raise HTTPException(401, "Fleet enrollment token expired")
        # Revocation check
        if agent.status == "revoked":
            raise HTTPException(401, "Fleet enrollment token revoked")
        # Quota check
        if (agent.enrollment_max_uses is not None
                and agent.enrollment_uses >= agent.enrollment_max_uses):
            raise HTTPException(401, "Fleet enrollment token exhausted")

        # Mint a child endpoint agent for this host.
        raw_api, api_hash = new_api_token()
        child = ComplianceAgent(
            tenant_id=agent.tenant_id,
            asset_id=None,                          # auto-link via heartbeat hostname
            agent_name=f"{agent.agent_name}/{body.hostname or 'unknown'}",
            mode="endpoint",
            os_family=body.os_family or agent.os_family,
            api_token_hash=api_hash,
            status="active",
            kind="spawned",
            spawned_from_agent_id=agent.id,
            hostname=body.hostname,
            ip_address=body.ip_address,
            agent_version=body.agent_version,
            enrolled_at=datetime.utcnow(),
            last_heartbeat_at=datetime.utcnow(),
            created_by_user_id=agent.created_by_user_id,
        )
        db.add(child)
        agent.enrollment_uses = (agent.enrollment_uses or 0) + 1
        db.commit()
        db.refresh(child)
        return AgentEnrollResponse(
            agent_id=child.id,
            api_token=raw_api,
            tenant_id=child.tenant_id,
            mode=child.mode,
        )

    # Single-use enrollment (legacy path): claim THIS row + burn the token.
    raw_api, api_hash = new_api_token()
    agent.api_token_hash = api_hash
    agent.enrollment_token_hash = None  # one-time, burn it
    agent.status = "active"
    agent.hostname = body.hostname
    agent.os_family = body.os_family
    agent.agent_version = body.agent_version
    agent.ip_address = body.ip_address
    agent.enrolled_at = datetime.utcnow()
    agent.last_heartbeat_at = datetime.utcnow()
    db.commit()
    db.refresh(agent)

    logger.info(
        "agent_enrolled tenant_id=%s agent_id=%s hostname=%s mode=%s",
        agent.tenant_id, agent.id, body.hostname, agent.mode,
    )
    return AgentEnrollResponse(agent_id=agent.id, api_token=raw_api)


def _auth_agent(authorization: Optional[str], db: Session) -> ComplianceAgent:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing Bearer token")
    raw = authorization.split(" ", 1)[1].strip()
    agent = find_agent_by_api_token(db, raw)
    if not agent:
        raise HTTPException(401, "Invalid or revoked agent token")
    return agent


@router.post("/heartbeat")
def agent_heartbeat(
    body: HeartbeatPayload,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Agent pings every ~30s. Updates last_heartbeat_at, refreshes the
    AGENT row's hostname/version/ip, and (Block C) syncs the linked
    ITAsset row's OS profile so the AI rule matcher routes the exact
    CIS benchmark version for this host's build.

    Asset-linking algorithm:
      1. If agent.asset_id set → use that asset
      2. Else look up tenant asset where host_name == agent.hostname
         (case-insensitive). Auto-link if found.
      3. Else if hostname is unique within tenant and not yet present,
         auto-create a stub asset row (so the heartbeat is never silently
         dropped).
    """
    agent = _auth_agent(authorization, db)
    agent.last_heartbeat_at = datetime.utcnow()
    if body.hostname:
        agent.hostname = body.hostname
    if body.agent_version:
        agent.agent_version = body.agent_version
    if body.ip_address:
        agent.ip_address = body.ip_address
    if body.os_family and not agent.os_family:
        agent.os_family = body.os_family

    # ─── Asset OS sync ─────────────────────────────────────────────────
    from grc.models import ITAsset

    asset = None
    if agent.asset_id:
        asset = db.query(ITAsset).filter(
            ITAsset.id == agent.asset_id, ITAsset.tenant_id == agent.tenant_id
        ).first()
    if asset is None and (body.hostname or agent.hostname):
        wanted_host = (body.hostname or agent.hostname or "").strip().lower()
        if wanted_host:
            asset = db.query(ITAsset).filter(
                ITAsset.tenant_id == agent.tenant_id,
                func.lower(ITAsset.host_name) == wanted_host,
            ).first()
            # Auto-link if found by hostname
            if asset is not None and not agent.asset_id:
                agent.asset_id = asset.id

    # Auto-create stub asset on FIRST heartbeat — no longer gated on
    # body.os_normalized. The previous gate meant a brand-new agent on
    # a fresh PC that hadn't completed OS detection yet would heartbeat
    # forever without an asset row → Risk Posture / Inventory never
    # showed the host. Dropping the gate creates the stub immediately;
    # OS fields refresh on the next heartbeat that has data.
    #
    # Stamps `owner_id` from `agent.created_by_user_id` (the operator who
    # enrolled this agent) — without it the asset has owner_id IS NULL
    # and the Risk Posture owner-scoped query filters it out, exactly
    # the symptom we hit on Ubuntu.
    if asset is None and (body.hostname or agent.hostname):
        wanted_host = (body.hostname or agent.hostname or "").strip()
        if wanted_host:
            existing = db.query(ITAsset).filter(
                ITAsset.tenant_id == agent.tenant_id,
                func.lower(ITAsset.host_name) == wanted_host.lower(),
            ).first()
            if existing is None:
                # Look up the enroller's display name for the owner_name
                # convenience column (matches what bulk-discover stamps).
                owner_user = None
                if agent.created_by_user_id:
                    from grc.models import GRCUser
                    owner_user = db.query(GRCUser).filter(
                        GRCUser.id == agent.created_by_user_id
                    ).first()
                asset = ITAsset(
                    tenant_id=agent.tenant_id,
                    name=f"agent-host:{wanted_host}",
                    description=f"Auto-created from agent heartbeat (agent #{agent.id})",
                    asset_type="infrastructure",
                    host_name=wanted_host,
                    ip_address=body.ip_address,
                    criticality="medium",
                    status="active",
                    owner_id=agent.created_by_user_id,
                    owner_name=(getattr(owner_user, "display_name", None)
                                or getattr(owner_user, "username", None)) if owner_user else None,
                )
                db.add(asset)
                db.flush()
                agent.asset_id = asset.id
            else:
                # Reuse the existing host. Auto-link the agent to it so
                # subsequent heartbeats skip the lookup branch.
                asset = existing
                agent.asset_id = asset.id

    # Write OS profile through if we ended up with an asset + agent sent
    # anything. Don't clobber non-null fields with nulls — only positive
    # data updates.
    if asset is not None:
        if body.os_family:    asset.os_family = body.os_family
        if body.os_version:   asset.os_version = body.os_version
        if body.os_normalized:asset.os_normalized = body.os_normalized
        if body.os_build:     asset.os_build = body.os_build
        if body.os_edition:   asset.os_edition = body.os_edition

    db.commit()
    return {
        "status": "ok",
        "agent_id": agent.id,
        "heartbeat_interval_sec": 30,
        "linked_asset_id": agent.asset_id,
    }


@router.post("/results")
def agent_results(
    body: ResultsPayload,
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Agent uploads scan run outcomes. Each entry must have at least:
        - plugin_id (or plugin_key)
        - status: 'passed'|'failed'|'error'
        - started_at (ISO)
        - completed_at (ISO)
        - asset_id (optional — defaults to agent's bound asset)
        - result_summary (optional)
        - raw_output (optional JSON)

    Stored as CompliancePluginRun rows just like the existing pull-mode
    scanner, so Risk Posture / Assets tab consume them identically.
    """
    agent = _auth_agent(authorization, db)
    inserted = 0
    skipped = 0
    for entry in body.runs or []:
        plugin_id = entry.get("plugin_id")
        plugin_key = entry.get("plugin_key")
        plugin = None
        if plugin_id:
            plugin = db.query(CompliancePlugin).filter(
                CompliancePlugin.id == plugin_id,
                (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == agent.tenant_id),
            ).first()
        elif plugin_key:
            plugin = db.query(CompliancePlugin).filter(
                CompliancePlugin.plugin_key == plugin_key,
                (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == agent.tenant_id),
            ).first()
        if not plugin:
            skipped += 1
            continue

        # Effective asset: explicit > agent's bound asset
        target_asset_id = entry.get("asset_id") or agent.asset_id
        target_asset = None
        if target_asset_id:
            target_asset = db.query(ITAsset).filter(
                ITAsset.id == target_asset_id,
                ITAsset.tenant_id == agent.tenant_id,
            ).first()

        def _parse_dt(v):
            if not v:
                return None
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                return None

        run = CompliancePluginRun(
            tenant_id=agent.tenant_id,
            plugin_id=plugin.id,
            asset_id=target_asset.id if target_asset else None,
            connection_id=None,
            status=entry.get("status", "error"),
            triggered_by="agent",
            triggered_by_user_id=None,
            started_at=_parse_dt(entry.get("started_at")) or datetime.utcnow(),
            completed_at=_parse_dt(entry.get("completed_at")) or datetime.utcnow(),
            result_summary=entry.get("result_summary"),
            raw_output=entry.get("raw_output"),
            duration_ms=entry.get("duration_ms"),
            remediation_shown=plugin.remediation,
        )
        db.add(run)
        inserted += 1

    agent.last_result_at = datetime.utcnow()
    agent.last_heartbeat_at = datetime.utcnow()
    db.commit()
    logger.info(
        "agent_results tenant_id=%s agent_id=%s inserted=%s skipped=%s",
        agent.tenant_id, agent.id, inserted, skipped,
    )
    return {"inserted": inserted, "skipped": skipped, "agent_id": agent.id}


# ─── Job pull (agent → cloud) ──────────────────────────────────────────────

@router.get("/jobs")
def agent_jobs(
    limit: int = Query(default=50, ge=1, le=500),
    wait: int = Query(default=0, ge=0, le=30,
        description="Long-poll seconds. When set, the endpoint blocks up to N seconds waiting for pending_scan_at to be set, then returns immediately. Use wait=25 from the agent."),
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Agent polls this every ~30s to pull queued check tasks.

    Strategy: hand the agent any approved CIS plugin whose runner_type
    matches what this agent can execute and for which there is no recent
    run (last 24h) for the agent's bound asset. The cloud doesn't keep
    a "job queue" table — we just compute the to-do list on demand,
    which keeps the data model simple and means jobs auto-disappear once
    results come in.

    Endpoint-mode agents (mode='endpoint') get jobs for their own host.
    Collector-mode agents (mode='collector') get jobs for any asset whose
    SSH credentials they have in their local vault — the cloud doesn't
    know which targets the agent has creds for, so we send the full set
    of collector-eligible plugins and let the agent skip the ones it
    can't execute.
    """
    agent = _auth_agent(authorization, db)
    tenant_id = agent.tenant_id

    # Long-poll: if `wait` is set and there's no immediate scan-now flag,
    # sleep in 1-second slices checking the flag. Returns the moment a
    # Scan-now click flips pending_scan_at on this agent OR the budget
    # expires. Cuts perceived Scan-now latency from up-to-30s to ~1s.
    if wait > 0 and agent.pending_scan_at is None:
        import time as _time
        for _ in range(wait):
            db.refresh(agent)
            if agent.pending_scan_at is not None:
                break
            _time.sleep(1)

    # Plugins eligible for execution: approved + enabled + runner the
    # agent can handle. Endpoint agents only get their own runner type;
    # collector agents get the SSH-flavoured ones (Linux/Cisco) AND any
    # platform whose remote-creds they can hold.
    if agent.mode == "endpoint":
        runner_types = [_endpoint_runner_for_os(agent.os_family)]
    else:  # collector
        # Collector agents (one per bank LAN) reach OUT to remote targets,
        # so they handle everything that isn't an endpoint-on-itself runner.
        # The 6 new platforms (MSSQL/Postgres/MySQL/LDAP/Azure/K8s) join
        # the original three (linux_ssh/netdev_ssh/oracle_sql) here.
        runner_types = [
            "linux_ssh", "netdev_ssh", "oracle_sql",
            "mssql_sql", "postgres_sql", "mysql_sql",
            "ldap_query", "azure_readonly", "k8s_api",
        ]

    plugins_q = db.query(CompliancePlugin).filter(
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        CompliancePlugin.enabled.is_(True),
        CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
        CompliancePlugin.runner_type.in_(runner_types),
    )

    # ─── OS-aware Stage 1 + Stage 2 filtering ───────────────────────────
    # Without this, a Windows 11 25H2 endpoint agent would receive every
    # windows_winrm plugin — Server 2022 rules, Windows 10 rules, archived
    # benchmarks — and execute them all, producing thousands of bogus
    # FAIL results. Mirror exactly the logic match-preview and scan-all
    # use so the three sources of truth agree.
    asset = None
    if agent.asset_id:
        asset = db.query(ITAsset).filter(
            ITAsset.id == agent.asset_id,
            ITAsset.tenant_id == tenant_id,
        ).first()
    asset_os = getattr(asset, "os_normalized", None) if asset else None
    asset_os_v = getattr(asset, "os_version", None) if asset else None

    # ── STRICT SINGLE-STAGE MATCHER ──
    # Look up the operator-owned benchmark mapping for this agent's asset OS.
    # The agent receives ONLY rules from the mapped benchmark. If no mapping
    # exists, the agent gets zero jobs (and the admin UI surfaces the
    # missing mapping so the operator can add it).
    picked_bench: Optional[str] = None
    try:
        from grc.modules.compliance_plugins.services.strict_matcher import pick_benchmark_for_os
        if asset and asset_os:
            m = pick_benchmark_for_os(db, tenant_id, asset_os)
            if m:
                picked_bench = m.benchmark_name
    except Exception as exc:  # noqa: BLE001
        logger.warning("agent /jobs strict matcher failed: %s", exc)

    # ─── Build a runner_type → credentials map (collector mode only) ────
    # Collector agents reach OUT to remote targets, so each job needs the
    # decrypted credentials for the target it scans. Endpoint agents
    # execute against their own host and don't need any of this.
    #
    # Trade-off: we ship credentials inline in the /jobs response over
    # TLS. The alternative (a separate /agents/credentials endpoint) is
    # one extra round-trip per scan with no security benefit, because
    # the agent already has its api_token authorising both endpoints.
    # If the agent box is compromised, the attacker is already on the
    # bank's LAN and can dial those targets directly.
    creds_by_runner: dict[str, dict] = {}
    if agent.mode == "collector":
        from grc.modules.compliance_plugins.services.credentials import credentials_for
        for it in runner_types:
            conn = (
                db.query(IntegrationConnection)
                .filter(
                    IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.integration_type == it,
                    IntegrationConnection.is_active.is_(True),
                )
                .order_by(IntegrationConnection.id.desc())
                .first()
            )
            if conn:
                try:
                    creds_by_runner[it] = credentials_for(conn)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("credentials_for(%s) failed: %s", it, exc)

    jobs: list[dict] = []
    for p in plugins_q:
        # Strict single-stage: only emit jobs whose benchmark matches the
        # mapped benchmark for this asset's OS. No family-walk, no AI pick.
        if picked_bench is None:
            # Endpoint agents bound to an asset with no mapping → empty.
            # Collector agents (no asset) still get all runner-type-matched
            # plugins because they decide per-target which to execute.
            if agent.mode == "endpoint":
                continue
        elif p.benchmark != picked_bench:
            continue
        job = {
            "plugin_id": p.id,
            "plugin_key": p.plugin_key,
            "rule_id": p.rule_id,
            "title": p.title,
            "severity": p.severity,
            "runner_type": p.runner_type,
            "check_definition": p.check_definition,
            "asset_id": agent.asset_id,   # endpoint agents are bound to a single asset
        }
        if agent.mode == "collector" and p.runner_type in creds_by_runner:
            job["credentials"] = creds_by_runner[p.runner_type]
        jobs.append(job)
        if len(jobs) >= limit:
            break

    # Clear the pending_scan flag once the agent has actually fetched
    # the rule set — so subsequent natural ticks don't keep getting the
    # Scan-now firehose. If something fails mid-run, the heartbeat path
    # eventually re-flags.
    if jobs and agent.pending_scan_at is not None:
        agent.pending_scan_at = None
        agent.pending_scan_user_id = None
        db.commit()

    return {"jobs": jobs, "agent_id": agent.id, "mode": agent.mode}


@router.post("/scan-now-push/{asset_id}")
def scan_now_push(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Set the pending_scan flag on any agent bound to this asset.

    The Scan-now button on the asset page can call this AS WELL AS the
    regular scan-all endpoint. If an active endpoint agent is bound to
    the asset, this returns 200 with the agent id(s) flagged; otherwise
    it returns {flagged: 0} and the caller falls back to scan-all.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    asset = db.query(ITAsset).filter(
        ITAsset.id == asset_id, ITAsset.tenant_id == tenant_id,
    ).first()
    if not asset:
        raise HTTPException(404, "Asset not found in this tenant")
    agents = (
        db.query(ComplianceAgent)
        .filter(
            ComplianceAgent.tenant_id == tenant_id,
            ComplianceAgent.asset_id == asset_id,
            ComplianceAgent.status == "active",
        )
        .all()
    )
    now = datetime.utcnow()
    for a in agents:
        a.pending_scan_at = now
        a.pending_scan_user_id = current_user.id
    db.commit()
    return {"flagged": len(agents), "agent_ids": [a.id for a in agents]}


def _endpoint_runner_for_os(os_family: Optional[str]) -> str:
    """Pick the appropriate runner_type for an endpoint agent's host OS."""
    f = (os_family or "").lower()
    if "win" in f:
        return "windows_winrm"
    return "linux_ssh"


# ─── Bulk enrollment (mass deploy via GPO/SCCM) ────────────────────────────

class BulkEnrollHost(BaseModel):
    hostname: str
    asset_id: Optional[int] = None
    mode: str = "endpoint"
    os_family: str = "windows"


class BulkEnrollRequest(BaseModel):
    hosts: List[BulkEnrollHost]
    backend_url: Optional[str] = None  # override for what gets baked into install command


@router.post("/bulk-enroll", status_code=201)
def bulk_enroll(
    body: BulkEnrollRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
):
    """Create N pending agents in one shot — used for mass GPO/SCCM push.

    Returns a CSV-style list of (hostname, enrollment_token, install_command)
    rows that the operator pipes into their config-management tooling.
    Each token is one-time; the operator should keep this list secure
    (the install commands embed the tokens).
    """
    import os
    tenant_id = get_user_primary_tenant(current_user, db)
    backend_url = (
        body.backend_url
        or os.environ.get("COMPLYVERSE_BACKEND_URL")
        or _backend_url_from_request(request)
    ).rstrip("/")

    created = []
    for host in body.hosts:
        raw_enroll, enroll_hash = new_enrollment_token()
        agent = ComplianceAgent(
            tenant_id=tenant_id,
            asset_id=host.asset_id,
            agent_name=host.hostname,
            mode=host.mode,
            os_family=host.os_family,
            enrollment_token_hash=enroll_hash,
            status="pending",
            hostname=host.hostname,
            created_by_user_id=current_user.id,
        )
        db.add(agent)
        db.flush()  # need agent.id for the response

        install_win = (
            f"ComplyverseAgent-Setup-1.0.0.exe /S "
            f"/TOKEN={raw_enroll} /BACKEND={backend_url}"
        )
        install_linux = (
            f"sudo dpkg -i complyverse-agent_1.0.0_all.deb && "
            f"sudo -u complyverse /opt/complyverse-agent/bin/complyverse-agent "
            f"enroll --backend {backend_url} --token {raw_enroll} && "
            f"sudo systemctl enable --now complyverse-agent"
        )
        created.append({
            "agent_id": agent.id,
            "hostname": host.hostname,
            "enrollment_token": raw_enroll,
            "install_command_windows": install_win,
            "install_command_linux": install_linux,
        })

    db.commit()
    logger.info(
        "agents.bulk_enroll tenant_id=%s count=%s by_user=%s",
        tenant_id, len(created), current_user.id,
    )
    return {
        "backend_url": backend_url,
        "count": len(created),
        "agents": created,
    }


# ─── Cloud-supplied credentials (Scenario B) ───────────────────────────────

@router.get("/fetch-creds")
def agent_fetch_creds(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    """Authenticated agent pulls the credentials for assets it should scan.

    Used by banks that prefer to manage credentials centrally (Scenario B):
        - operator enters Cisco / Oracle / vCenter creds in the Compliverse
          dashboard (encrypted at rest via the existing IntegrationConnection
          path)
        - agent calls this endpoint every N hours
        - cloud returns the decrypted creds for the agent's assigned assets
          (the agent will only see its own tenant's connections)
        - agent stores them locally in the encrypted vault

    Banks that prefer Scenario A (paranoid mode, no creds in cloud) simply
    never enter creds in the dashboard and use `complyverse_agent cred set`
    on the agent host instead. Same agent code, same vault — different
    population path.
    """
    from grc.crypto import decrypt_secret
    agent = _auth_agent(authorization, db)
    if agent.mode != "collector":
        raise HTTPException(400, "Only collector-mode agents fetch creds; this agent is in endpoint mode.")

    rows = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id == agent.tenant_id,
        IntegrationConnection.is_active.is_(True),
        IntegrationConnection.integration_type.in_(
            ["linux_ssh", "netdev_ssh", "oracle_sql"]
        ),
    ).all()

    creds_by_asset: dict[int, dict] = {}
    for conn in rows:
        # Match connection → asset via host_name (same logic as scan-all).
        # We need an asset_id so the agent can key its vault correctly.
        if not conn.console_url:
            continue
        asset = db.query(ITAsset).filter(
            ITAsset.tenant_id == agent.tenant_id,
            ITAsset.host_name.ilike(conn.console_url),
        ).first()
        if not asset:
            continue
        # Decrypt password for transport — the response goes over HTTPS
        # with mTLS-style bearer auth, so this is OK. Agent re-encrypts
        # in its local vault on receipt.
        try:
            password = decrypt_secret(conn.password)
        except Exception:
            password = None
        creds_by_asset[asset.id] = {
            "type": conn.integration_type,
            "host": conn.console_url,
            "port": conn.console_port,
            "username": conn.username,
            "password": password,
            "connection_id": conn.id,
        }

    agent.last_heartbeat_at = datetime.utcnow()
    db.commit()
    return {
        "agent_id": agent.id,
        "credentials": creds_by_asset,
        "count": len(creds_by_asset),
    }
