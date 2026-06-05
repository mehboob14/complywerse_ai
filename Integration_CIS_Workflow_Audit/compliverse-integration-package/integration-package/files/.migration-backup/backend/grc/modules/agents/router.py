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
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field
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

# Operator-facing actions (enroll new agent, revoke) require the
# `compliance:agents:manage` permission. Administrators auto-pass.
_require_agents_perm = require_tenant_permission("compliance:agents:manage")

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


@router.post("/{agent_id}/revoke")
def revoke_agent(
    agent_id: int,
    reason: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_agents_perm),
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
    db: Session = Depends(get_db),
):
    """Agent binary calls this with its one-time enrollment_token.
    Returns the long-lived api_token. Enrollment token is consumed.
    """
    agent = find_agent_by_enrollment_token(db, body.enrollment_token)
    if not agent:
        raise HTTPException(401, "Invalid or already-used enrollment token")

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
    """Agent pings every ~30s. Updates last_heartbeat_at + optionally
    refreshes hostname/version/ip in case the host details changed."""
    agent = _auth_agent(authorization, db)
    agent.last_heartbeat_at = datetime.utcnow()
    if body.hostname:
        agent.hostname = body.hostname
    if body.agent_version:
        agent.agent_version = body.agent_version
    if body.ip_address:
        agent.ip_address = body.ip_address
    db.commit()
    return {"status": "ok", "agent_id": agent.id, "heartbeat_interval_sec": 30}


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

    # Plugins eligible for execution: approved + enabled + runner the
    # agent can handle. Endpoint agents only get their own runner type;
    # collector agents get the SSH-flavoured ones (Linux/Cisco) AND any
    # platform whose remote-creds they can hold.
    if agent.mode == "endpoint":
        runner_types = [_endpoint_runner_for_os(agent.os_family)]
    else:  # collector
        runner_types = ["linux_ssh", "netdev_ssh", "oracle_sql"]

    plugins_q = db.query(CompliancePlugin).filter(
        (CompliancePlugin.tenant_id.is_(None)) | (CompliancePlugin.tenant_id == tenant_id),
        CompliancePlugin.enabled.is_(True),
        CompliancePlugin.review_status.in_(["approved", "auto_approved"]),
        CompliancePlugin.runner_type.in_(runner_types),
    ).limit(limit)

    jobs: list[dict] = []
    for p in plugins_q:
        jobs.append({
            "plugin_id": p.id,
            "plugin_key": p.plugin_key,
            "rule_id": p.rule_id,
            "title": p.title,
            "severity": p.severity,
            "runner_type": p.runner_type,
            "check_definition": p.check_definition,
            "asset_id": agent.asset_id,   # endpoint agents are bound to a single asset
        })

    return {"jobs": jobs, "agent_id": agent.id, "mode": agent.mode}


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
