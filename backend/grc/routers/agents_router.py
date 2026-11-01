"""Compliance Agent fleet API — the backend the /admin/agents page calls.

Two audiences:
  * USER-facing (require_auth): enroll / list / revoke / bulk-enroll — the console.
  * AGENT-facing (token auth, NO user session): the installed agent on a customer
    device calls enroll → gets a long-lived api_token → then report / heartbeat.

The agent runs the up-front discovery + inventory collection LOCALLY on the host
(for machines we can't reach over the network or where the client won't share
credentials) and POSTs the result here; we land it on the asset the same way the
agentless path does (ITAsset + platform_properties), so both converge on one
record. (CIS/compliance execution by the agent is Phase 2.)

Token model: a short-lived ENROLLMENT token (one install) is exchanged for a
long-lived API token. Only SHA-256 hashes are stored; plaintext is returned once.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import os

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from grc.models import get_db, ITAsset
from grc.models._37_artifact_catalog_tenant_artifacts import ComplianceAgent
from grc.routers.auth_router import get_user_primary_tenant, require_auth, GRCUser

router = APIRouter(prefix="/endpoint-agents", tags=["Compliance Agents"])

# A heartbeat older than this flips an active agent to "stale" — computed
# server-side (the old UI only derived it in the browser, so nothing authoritative
# ever marked an agent stale).
STALE_AFTER = timedelta(minutes=10)

# The agent version currently shipped in agent-dist. Returned on heartbeat so a
# running agent self-updates when it differs (bump this AND the Go agentVersion
# together, and rebuild the binaries, to roll a new version to the fleet).
AGENT_VERSION = "1.3.0"
ENROLLMENT_TTL = timedelta(hours=24)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _effective_status(a: ComplianceAgent, now: datetime) -> str:
    """Authoritative status: revoked/pending as stored; active decays to stale
    when the heartbeat goes quiet."""
    if a.status in ("revoked", "pending"):
        return a.status
    if a.last_heartbeat_at and (now - a.last_heartbeat_at) > STALE_AFTER:
        return "stale"
    return a.status or "active"


def _agent_dict(a: ComplianceAgent, now: datetime) -> Dict[str, Any]:
    return {
        "id": a.id, "agent_name": a.agent_name, "mode": a.mode,
        "os_family": a.os_family, "agent_version": a.agent_version,
        "hostname": a.hostname, "ip_address": a.ip_address,
        "status": _effective_status(a, now), "asset_id": a.asset_id,
        "last_heartbeat_at": a.last_heartbeat_at.isoformat() if a.last_heartbeat_at else None,
        "last_result_at": a.last_result_at.isoformat() if a.last_result_at else None,
        "enrolled_at": a.enrolled_at.isoformat() if a.enrolled_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "allowed_domain": a.allowed_domain,
    }


def _install_hint(enrollment_token: str, os_family: Optional[str]) -> Dict[str, str]:
    """One-liners the console shows next to a fresh enrollment token. The real
    binary is served from /endpoint-agents/installer/* (wired when the agent ships); the
    token is what matters for the handshake."""
    return {
        "linux": f"curl -fsSL $COMPLYVERSE_URL/api/endpoint-agents/installer/linux | sudo COMPLYVERSE_ENROLL={enrollment_token} sh",
        "windows": f"iwr $COMPLYVERSE_URL/api/endpoint-agents/installer/windows -UseB | iex   # COMPLYVERSE_ENROLL={enrollment_token}",
    }


# ── USER-facing (console) ──────────────────────────────────────────────────
class EnrollIn(BaseModel):
    agent_name: str
    mode: Optional[str] = "collector"
    asset_id: Optional[int] = None
    os_family: Optional[str] = None
    allowed_domain: Optional[str] = None   # AD domain the enrolling PC must be joined to; blank = any
    reachability: Optional[str] = "public"  # 'public' (testing: the host the browser used) or 'private' (production: AVA_AGENT_PRIVATE_URL)


class BulkHost(BaseModel):
    hostname: str
    mode: Optional[str] = "collector"
    os_family: Optional[str] = None
    asset_id: Optional[int] = None


class BulkEnrollIn(BaseModel):
    hosts: List[BulkHost]
    backend_url: Optional[str] = None


def _new_agent(db: Session, tenant_id: int, *, name: str, mode: str,
               os_family: Optional[str], asset_id: Optional[int],
               user_id: Optional[int], hostname: Optional[str] = None,
               allowed_domain: Optional[str] = None) -> tuple[ComplianceAgent, str]:
    now = datetime.utcnow()
    enr = "enr_" + secrets.token_urlsafe(32)
    # agent_name is UNIQUE per tenant. The console auto-names by OS ("windows
    # agent"), so enrolling a second host of the same OS would collide and 500.
    # Suffix to keep it unique and readable: "windows agent", "windows agent 2", …
    base, n = name, 1
    while db.query(ComplianceAgent.id).filter(
            ComplianceAgent.tenant_id == tenant_id,
            ComplianceAgent.agent_name == name).first():
        n += 1
        name = f"{base} {n}"
    agent = ComplianceAgent(
        tenant_id=tenant_id, agent_name=name, mode=(mode or "collector"),
        os_family=os_family, asset_id=asset_id, hostname=hostname,
        status="pending", kind="single",
        enrollment_token_hash=_hash(enr), enrollment_max_uses=1, enrollment_uses=0,
        enrollment_expires_at=now + ENROLLMENT_TTL,
        allowed_domain=(allowed_domain.strip() or None) if allowed_domain else None,
        created_by_user_id=user_id, created_at=now, updated_at=now,
    )
    db.add(agent)
    return agent, enr


@router.get("")
def list_agents(current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    tenant_id = get_user_primary_tenant(current_user, db)
    now = datetime.utcnow()
    rows = (db.query(ComplianceAgent)
            .filter(ComplianceAgent.tenant_id == tenant_id)
            .order_by(ComplianceAgent.created_at.desc()).all())
    return {"items": [_agent_dict(a, now) for a in rows]}


@router.post("")
def enroll_agent(body: EnrollIn, request: Request,
                 current_user: GRCUser = Depends(require_auth),
                 db: Session = Depends(get_db)):
    if not body.agent_name.strip():
        raise HTTPException(422, "agent_name is required")
    tenant_id = get_user_primary_tenant(current_user, db)
    agent, enr = _new_agent(db, tenant_id, name=body.agent_name.strip(),
                            mode=body.mode or "collector", os_family=body.os_family,
                            asset_id=body.asset_id, user_id=current_user.id,
                            allowed_domain=body.allowed_domain)
    db.commit(); db.refresh(agent)
    slug = getattr(request.state, "tenant_slug", None) or ""
    return {"id": agent.id, "agent_name": agent.agent_name, "status": agent.status,
            "enrollment_token": enr, "expires_in": int(ENROLLMENT_TTL.total_seconds()),
            "tenant_slug": slug, "commands": _install_commands(request, enr, slug, body.reachability),
            "install": _install_hint(enr, body.os_family)}


@router.post("/bulk-enroll")
def bulk_enroll(body: BulkEnrollIn, current_user: GRCUser = Depends(require_auth),
                db: Session = Depends(get_db)):
    if not body.hosts:
        raise HTTPException(422, "hosts is empty")
    tenant_id = get_user_primary_tenant(current_user, db)
    out = []
    for h in body.hosts:
        agent, enr = _new_agent(db, tenant_id, name=h.hostname.strip() or "agent",
                                mode=h.mode or "collector", os_family=h.os_family,
                                asset_id=h.asset_id, user_id=current_user.id,
                                hostname=h.hostname.strip() or None)
        out.append({"hostname": h.hostname, "agent_id": agent.id, "enrollment_token": enr})
    db.commit()
    return {"count": len(out), "enrollments": out}


@router.post("/{agent_id}/revoke")
def revoke_agent(agent_id: int, reason: Optional[str] = None,
                 current_user: GRCUser = Depends(require_auth), db: Session = Depends(get_db)):
    tenant_id = get_user_primary_tenant(current_user, db)
    agent = (db.query(ComplianceAgent)
             .filter(ComplianceAgent.id == agent_id, ComplianceAgent.tenant_id == tenant_id).first())
    if not agent:
        raise HTTPException(404, "Agent not found")
    now = datetime.utcnow()
    agent.status = "revoked"
    agent.revoked_at = now
    agent.revoked_by_user_id = current_user.id
    agent.revoke_reason = reason
    agent.api_token_hash = None          # the agent can no longer report
    agent.enrollment_token_hash = None   # and the install link is dead
    agent.updated_at = now
    db.commit()
    return {"ok": True, "id": agent_id, "status": "revoked"}


# ── AGENT-facing (token auth, no user session) ──────────────────────────────
class AgentEnrollIn(BaseModel):
    enrollment_token: str
    hostname: Optional[str] = None
    os_family: Optional[str] = None
    agent_version: Optional[str] = None
    ip_address: Optional[str] = None
    domain: Optional[str] = None            # AD/DNS domain the machine is joined to (WORKGROUP if none)
    part_of_domain: Optional[bool] = None   # true only when actually AD-joined


class ReportIn(BaseModel):
    hostname: Optional[str] = None
    os_name: Optional[str] = None
    os_family: Optional[str] = None
    ip_address: Optional[str] = None
    agent_version: Optional[str] = None
    software: Optional[List[Dict[str, Any]]] = None   # [{name, version, ...}]
    inventory: Optional[Dict[str, Any]] = None         # hardware/os/network block
    deep: Optional[str] = None                         # raw stdout of the deep probe (JSON on win, sectioned on linux)
    recon: Optional[Dict[str, Any]] = None             # {open_ports:[{port,proto,service,version,evidence}], packages:[{name,version}], collected_at}


def _agent_by_api_token(db: Session, authorization: Optional[str]) -> ComplianceAgent:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer api_token")
    token = authorization.split(" ", 1)[1].strip()
    agent = (db.query(ComplianceAgent)
             .filter(ComplianceAgent.api_token_hash == _hash(token)).first())
    if not agent or agent.status == "revoked":
        raise HTTPException(401, "Invalid or revoked api_token")
    return agent


def _domain_allowed(allowed_domain: Optional[str], reported: Optional[str],
                    part_of_domain: Optional[bool]) -> bool:
    """Whether a machine reporting (reported, part_of_domain) may enrol under
    allowed_domain. No binding (None/blank) → always allowed. Match is
    case-insensitive; a dotted AD domain additionally requires a real domain
    join, so merely renaming a workgroup to the domain name won't pass."""
    if not allowed_domain or not allowed_domain.strip():
        return True
    want = allowed_domain.strip().lower()
    got = (reported or "").strip().lower()
    if got != want:
        return False
    if "." in want and not part_of_domain:
        return False
    return True


@router.post("/enroll")
def agent_enroll(body: AgentEnrollIn, db: Session = Depends(get_db)):
    """The installed agent exchanges its one-time enrollment token for a
    long-lived api_token. No user session — the enrollment token IS the auth."""
    agent = (db.query(ComplianceAgent)
             .filter(ComplianceAgent.enrollment_token_hash == _hash(body.enrollment_token)).first())
    if not agent or agent.status == "revoked":
        raise HTTPException(401, "Invalid or revoked enrollment token")
    now = datetime.utcnow()
    if agent.enrollment_expires_at and now > agent.enrollment_expires_at:
        raise HTTPException(401, "Enrollment token expired")
    if agent.enrollment_max_uses is not None and (agent.enrollment_uses or 0) >= agent.enrollment_max_uses:
        raise HTTPException(401, "Enrollment token already used")
    # Domain binding: refuse a machine that isn't joined to the required domain,
    # even with a valid token — this is what stops a leaked install command from
    # onboarding an outside PC (it reports WORKGROUP / a different domain).
    # shortcut: trusts the agent's self-reported domain; upgrade to a machine-cert
    # / AD-attested join proof if spoofing by a token-holder becomes a concern.
    if not _domain_allowed(agent.allowed_domain, body.domain, body.part_of_domain):
        raise HTTPException(
            403,
            f"This machine is not joined to the required domain "
            f"('{agent.allowed_domain}'); enrollment refused.")
    api_token = "aak_" + secrets.token_urlsafe(32)
    agent.api_token_hash = _hash(api_token)
    agent.status = "active"
    agent.enrolled_at = now
    agent.enrollment_uses = (agent.enrollment_uses or 0) + 1
    agent.enrollment_token_hash = None  # single-use: burn it
    agent.last_heartbeat_at = now
    if body.hostname:
        agent.hostname = body.hostname
    if body.os_family:
        agent.os_family = body.os_family
    if body.agent_version:
        agent.agent_version = body.agent_version
    if body.ip_address:
        agent.ip_address = body.ip_address
    agent.updated_at = now
    db.commit()
    return {"agent_id": agent.id, "api_token": api_token, "report_interval_s": 3600}


def _upsert_asset_from_report(db: Session, agent: ComplianceAgent, body: ReportIn, now: datetime) -> int:
    """Land the agent's locally-collected inventory on an ITAsset — additive,
    mirroring the agentless credentialed path (platform_properties + software).
    Matches the agent's linked asset, else by hostname within the tenant, else
    creates one. Returns the asset id."""
    asset: Optional[ITAsset] = None
    if agent.asset_id:
        asset = db.get(ITAsset, agent.asset_id)
    host = (body.hostname or agent.hostname or "").strip()
    if asset is None and host:
        asset = (db.query(ITAsset)
                 .filter(ITAsset.tenant_id == agent.tenant_id,
                         ITAsset.host_name == host).first())
    if asset is None:
        asset = ITAsset(
            tenant_id=agent.tenant_id, name=host or f"agent-{agent.id}",
            asset_type="infrastructure", host_name=host or None,
            ip_address=body.ip_address, origin_source="agent",
            source_system="agent", discovery_state="discovered",
            first_seen_at=now,
        )
        db.add(asset)
        db.flush()
    # Fill blanks only for curated identity; always refresh observed telemetry.
    if body.ip_address and not asset.ip_address:
        asset.ip_address = body.ip_address
    if body.os_family:
        asset.os_family = body.os_family
    # Normalize the reported OS caption to the benchmark key (e.g. "Microsoft
    # Windows 11 Pro" → "windows-11"). Without os_normalized the CIS scan's
    # per-asset benchmark filter skips every plugin for an agent host (the
    # pinned-asset NO-OS guard), so local CIS would silently run nothing.
    if body.os_name:
        from grc.modules.compliance_plugins.services.os_detector import normalize_os_string
        _fam, _norm, _build, _edition = normalize_os_string(body.os_name)
        if _norm:
            asset.os_normalized = _norm
            if not asset.os_version:
                asset.os_version = body.os_name
    pp = dict(asset.platform_properties or {})
    pp["agent"] = {
        "provenance": "agent", "agent_id": agent.id,
        "os_name": body.os_name, "os_family": body.os_family,
        "agent_version": body.agent_version, "reported_at": now.isoformat(),
        "inventory": body.inventory or {},
    }
    # Rich local telemetry: the agent runs the SAME deep probe the credentialed
    # path uses, but locally (LocalSystem/root — no creds), so we parse it with
    # the SAME parser and merge the {status,data} domains (os/cpu/memory/storage/
    # defender/firewall/security_products/bitlocker/…) at the top level. The
    # Overview then renders an agent host exactly like an agentless credentialed
    # scan. A parse hiccup must never fail the report.
    if body.deep:
        fam = (body.os_family or "").lower()
        try:
            from grc.modules.compliance_plugins.services.agentless_inventory import (
                _parse_deep_windows, _parse_deep_linux,
            )
            if fam == "windows":
                sections = _parse_deep_windows(body.deep)
            elif fam in ("linux", "unix"):
                sections = _parse_deep_linux(body.deep)
            else:
                sections = {}
            for k, v in (sections or {}).items():
                pp[k] = v
        except Exception:
            pass
    # Local recon (ground truth from the host itself): namespaced under 'recon'
    # so the pentest arming can read authoritative open ports/services. Projected
    # to the agreed keys (evidence is dropped here — it rides the finding rows).
    if body.recon:
        # Keep the agent's recon block as-is (os_family + windows surface + any
        # future keys the pentest lane reads) and only strip the per-port evidence
        # (that rides the finding rows, not platform_properties).
        _rec = dict(body.recon)
        _rec["open_ports"] = [
            {"port": _p.get("port"), "proto": _p.get("proto"),
             "service": _p.get("service"), "version": _p.get("version")}
            for _p in (body.recon.get("open_ports") or []) if isinstance(_p, dict)
        ]
        _rec.setdefault("os_family", (body.os_family or "").lower() or None)
        _rec.setdefault("collected_at", now.isoformat())
        pp["recon"] = _rec
    asset.platform_properties = pp
    if body.software:
        # Windows registers some products under more than one uninstall key, so
        # the raw list can carry the same (name, version) twice. Collapse to one.
        _seen, _sw = set(), []
        for s in body.software:
            k = (s.get("name"), s.get("version"))
            if k in _seen:
                continue
            _seen.add(k)
            _sw.append(s)
        asset.detected_software_json = _sw
    asset.last_seen_at = now
    asset.last_seen_source = "agent"
    # Recompute the security posture from the fresh deep data + software, so the
    # agent host's antivirus/EDR/endpoint-protected summary reflects what the
    # agent just reported — the agentless path does this via apply_posture, and
    # without it an enriched agent host stays stuck at its pre-enrichment
    # "unprotected" summary even though Defender/EDR data is now present.
    try:
        from grc.modules.compliance_plugins.services.security_classifier import apply_posture
        apply_posture(asset)
    except Exception:
        pass
    return asset.id


def _ensure_agent_connection(db: Session, agent: ComplianceAgent, asset: ITAsset, now: datetime) -> None:
    """Give a Linux agent a host-pinned connection tagged with itself as the
    collector, so a UI/scheduled CIS scan on the agent's asset is dispatched to
    the agent (run_service.execute_plugin collector branch) rather than attempting
    an agentless SSH reach we don't have for a NAT'd / firewalled endpoint.

    The connection's integration_type is the transport family the scan's
    per-plugin filter requires: ``linux_ssh`` for Linux (oscap runs locally) and
    ``windows_winrm`` for Windows (the agent runs the plugin's PowerShell check
    locally and ships raw stdout; the server scores it). Either way the collector
    tag (assigned_collector_agent_id) makes execute_plugin create a PENDING agent
    job instead of a remote reach we don't have for a NAT'd / firewalled endpoint.
    macOS has no local CIS engine yet → inventory only. The connection's
    console_url is the asset host, so it matches ONLY this asset
    (connection_matcher) and never another host. Idempotent on the agent id."""
    from grc.models import IntegrationConnection
    fam = (agent.os_family or "").lower()
    itype = ("linux_ssh" if fam in ("linux", "unix")
             else "windows_winrm" if fam == "windows" else None)
    if itype is None:
        return
    host = (asset.host_name or asset.ip_address or "").strip()
    if not host:
        return
    existing = (db.query(IntegrationConnection)
                .filter(IntegrationConnection.tenant_id == agent.tenant_id,
                        IntegrationConnection.assigned_collector_agent_id == agent.id)
                .first())
    if existing is not None:
        existing.console_url = host  # asset IP/name can drift; keep it current
        existing.integration_type = itype  # OS could be learned after first report
        existing.is_active = True
        existing.status = "connected"
        existing.updated_at = now
        return
    db.add(IntegrationConnection(
        tenant_id=agent.tenant_id,
        integration_type=itype,                  # transport family the scan filter accepts
        category="collector",
        connection_name=f"Agent · {agent.agent_name} (#{agent.id})"[:200],
        console_url=host,
        assigned_collector_agent_id=agent.id,
        is_active=True,
        status="connected",
        created_at=now, updated_at=now,
    ))


def _auto_cis_first_scan(tenant_engine, tenant_id: int, asset_id: int) -> None:
    """Enrolment IS the trigger — the agent host shouldn't have to click 'Scan'.
    On a fresh install's FIRST report we auto-run its CIS sweep in the background
    (the collector connection + os_normalized are already in place by now, so the
    scan dispatches to the agent). Fire-once is durable, not just in-memory: we
    skip if ANY prior compliance run exists for this asset, and the per-asset scan
    lock stops a concurrent re-fire mid-window (restart, re-report, heartbeat).
    A later manual 'Scan' re-runs as normal. Never raises into the report path."""
    import threading
    import logging

    def _worker():
        from sqlalchemy.orm import sessionmaker
        from grc.modules.compliance_plugins.router import (
            _do_scan_all, _scan_lock_acquire, _scan_lock_release,
        )
        from grc.models._37_artifact_catalog_tenant_artifacts import CompliancePluginRun
        Sess = sessionmaker(bind=tenant_engine, expire_on_commit=False)
        wdb = Sess()
        acquired = False
        try:
            asset = wdb.get(ITAsset, asset_id)
            if asset is None or not asset.os_normalized:
                return  # no OS benchmark key → the scan would run zero plugins
            prior = (wdb.query(CompliancePluginRun.id)
                     .filter(CompliancePluginRun.tenant_id == tenant_id,
                             CompliancePluginRun.asset_id == asset_id).first())
            if prior is not None:
                return  # already scanned once (install run done, or a user run)
            actor = (wdb.query(GRCUser)
                     .filter(GRCUser.is_active.is_(True))
                     .order_by(GRCUser.id).first())
            if actor is None:
                return
            if not _scan_lock_acquire(tenant_id, asset_id):
                return  # a scan is already running for this asset
            acquired = True
            _do_scan_all(wdb, tenant_id, asset_id, actor,
                         benchmark=None, runner_type=None, connection_id=None)
        except Exception:
            logging.getLogger(__name__).exception("agent auto-CIS first scan failed (non-fatal)")
        finally:
            if acquired:
                _scan_lock_release(tenant_id, asset_id)
            wdb.close()

    threading.Thread(target=_worker, daemon=True,
                     name=f"agent-cis-autoscan-t{tenant_id}-a{asset_id}").start()


def _recon_rows(asset_id: int, host: str, ports: list) -> list:
    """Normalized finding rows (the pentest _lrow shape) from recon open ports —
    one info row per port, affected_component = service + version (what the
    pentest arming keys on). Stable vid so a re-report UPSERTS instead of
    duplicating. Pure (no DB), so it is unit-checkable."""
    import hashlib
    rows = []
    for p in ports:
        if not isinstance(p, dict):
            continue
        try:
            port = int(p.get("port"))
        except (TypeError, ValueError):
            continue
        if port <= 0:
            continue
        proto = str(p.get("proto") or "tcp").lower()[:8]
        service = str(p.get("service") or "").strip()
        version = str(p.get("version") or "").strip()
        component = (f"{service} {version}".strip() or service)[:120] or None
        title = f"Open port {port}/{proto}: {service or 'unknown service'}"
        if version:
            title = f"{title} ({version})"
        title = title[:500]
        digest = hashlib.sha1(f"recon|{title}|{port}/{proto}".encode("utf-8", "replace")).hexdigest()[:12]
        fields = {
            "title": title, "severity": "info", "affected_host": (host or "")[:255],
            "evidence": str(p.get("evidence") or title)[:4000], "status": "open",
            "source": "agent:recon", "plugin_family": "Agent Recon", "affected_port": port,
        }
        if component:
            fields["affected_component"] = component
        rows.append({
            "vid": f"AGENT-RECON-{asset_id}-{digest}"[:50], "kind": "network",
            "source_slug": "recon", "title": title, "affected_url": None,
            "affected_component": component, "affected_port": port, "cve_id": None,
            "fields": fields,
        })
    return rows


def _ingest_recon_findings(db: Session, tenant_id: int, asset_id: int, host: str,
                           recon: Dict[str, Any]) -> int:
    """Persist agent recon open ports as 'agent:recon' register findings through the
    SAME writer the pentest engine uses (dedup + grc_vulnerability_asset_links), so
    agent-reported ground truth lands in the register exactly like engine findings."""
    rows = _recon_rows(asset_id, host, list(recon.get("open_ports") or []))
    if not rows:
        return 0
    from grc.modules.pentest import service as _pt
    return _pt._write_rows(db, tenant_id, asset_id, _pt._dedup_findings(rows))


@router.post("/report")
def agent_report(body: ReportIn, authorization: Optional[str] = Header(default=None),
                 db: Session = Depends(get_db)):
    """The agent POSTs its locally-collected inventory. Authed by the api_token."""
    agent = _agent_by_api_token(db, authorization)
    now = datetime.utcnow()
    first_report = agent.last_result_at is None  # capture before we stamp it below
    asset_id = _upsert_asset_from_report(db, agent, body, now)
    agent.asset_id = asset_id
    _asset = db.get(ITAsset, asset_id)
    if _asset is not None:
        _ensure_agent_connection(db, agent, _asset, now)
    agent.last_result_at = now
    agent.last_heartbeat_at = now
    agent.status = "active"
    if body.hostname and not agent.hostname:
        agent.hostname = body.hostname
    if body.agent_version:
        agent.agent_version = body.agent_version
    agent.updated_at = now
    # One agent per host (take-over): a freshly (re)installed agent reporting for
    # this asset supersedes any OLDER agent bound to the same asset — the new one
    # takes over, the old row is revoked and its collector connection retired, so
    # re-installing never leaves a duplicate/stale agent in the list.
    from grc.models import IntegrationConnection
    for old in (db.query(ComplianceAgent)
                .filter(ComplianceAgent.tenant_id == agent.tenant_id,
                        ComplianceAgent.asset_id == asset_id,
                        ComplianceAgent.id != agent.id,
                        ComplianceAgent.status != "revoked").all()):
        old.status = "revoked"
        old.revoked_at = now
        old.revoke_reason = f"superseded by re-install (agent #{agent.id})"
        old.api_token_hash = None
        old.enrollment_token_hash = None
        old.updated_at = now
        (db.query(IntegrationConnection)
         .filter(IntegrationConnection.assigned_collector_agent_id == old.id)
         .update({"is_active": False, "status": "revoked"}, synchronize_session=False))
    db.commit()
    # Local recon → register findings (best-effort; isolated so it never fails the
    # report, like the deep-probe parse above). Agent hosts are refused REMOTE scan
    # by the pentest engine, so this ground truth is how they get into the register.
    if body.recon:
        try:
            _a2 = db.get(ITAsset, asset_id)
            _rh = (_a2.host_name or _a2.ip_address or "") if _a2 else ""
            _ingest_recon_findings(db, agent.tenant_id, asset_id, _rh, body.recon)
        except Exception:
            db.rollback()
    # Fresh install → auto-run CIS once, no click needed (guards inside).
    if first_report and asset_id:
        _auto_cis_first_scan(db.get_bind(), agent.tenant_id, asset_id)
    return {"ok": True, "asset_id": asset_id}


@router.get("/collect-script/{os_family}", response_class=PlainTextResponse)
def agent_collect_script(os_family: str, authorization: Optional[str] = Header(default=None),
                         db: Session = Depends(get_db)):
    """The deep inventory probe the agent runs LOCALLY (as LocalSystem/root, so no
    credentials are needed). It is the SAME script the agentless credentialed path
    runs over WinRM/SSH — served whole here because local execution has no command-
    line size limit. Token-gated: only an enrolled agent fetches it."""
    _agent_by_api_token(db, authorization)  # authz: must be a valid agent token
    from grc.modules.compliance_plugins.services.agentless_inventory import (
        _WIN_DEEP_PS, _LINUX_DEEP_SH,
    )
    fam = (os_family or "").lower()
    if fam == "windows":
        return _WIN_DEEP_PS
    if fam in ("linux", "unix"):
        return _LINUX_DEEP_SH
    raise HTTPException(404, "No deep probe for this OS")


@router.post("/heartbeat")
def agent_heartbeat(authorization: Optional[str] = Header(default=None),
                    db: Session = Depends(get_db)):
    agent = _agent_by_api_token(db, authorization)
    now = datetime.utcnow()
    agent.last_heartbeat_at = now
    if agent.status != "active":
        agent.status = "active"
    agent.updated_at = now
    db.commit()
    # Tell the agent whether a scan-now was requested, and the version it should be
    # running (it self-updates when this differs from its own).
    return {"ok": True, "scan_now": bool(agent.pending_scan_at), "agent_version": AGENT_VERSION}


# ── Agent CIS jobs (local compliance execution) ─────────────────────────────
class CisResultIn(BaseModel):
    run_id: int
    status: Optional[str] = None      # final verdict (oscap path); None for windows raw
    summary: Optional[str] = ""
    raw_output: Optional[Dict[str, Any]] = None
    # Windows checks: the agent ships the RAW command output and the server
    # scores it with the same evaluator the credentialed WinRM path uses.
    stdout: Optional[str] = None
    exit_status: Optional[int] = None
    stderr: Optional[str] = None


class CisResultsIn(BaseModel):
    results: List[CisResultIn]


@router.get("/jobs")
def agent_jobs(authorization: Optional[str] = Header(default=None),
               db: Session = Depends(get_db)):
    """Pending CIS rules this agent must run locally. Each carries the oscap
    datastream+profile+rule_id so the agent runs `oscap xccdf eval` itself and
    posts verdicts to /endpoint-agents/jobs/results. These rows were created as 'pending'
    by the agentless executor's collector branch (run_service.execute_plugin)."""
    from grc.models import CompliancePlugin, CompliancePluginRun
    from grc.modules.compliance_plugins.runners.winrm_runner import is_command_safe
    agent = _agent_by_api_token(db, authorization)
    rows = (db.query(CompliancePluginRun, CompliancePlugin)
            .join(CompliancePlugin, CompliancePlugin.id == CompliancePluginRun.plugin_id)
            .filter(CompliancePluginRun.executed_by_agent_id == agent.id,
                    CompliancePluginRun.status == "pending").all())
    jobs = []
    for run, plugin in rows:
        cd = plugin.check_definition if isinstance(plugin.check_definition, dict) else {}
        # Windows CIS: the agent runs the plugin's PowerShell/cmd check locally
        # (as SYSTEM, no creds) and ships raw stdout — the server scores it with
        # the SAME evaluator the credentialed WinRM path uses. Only ship a command
        # that passes the read-only safety gate, so a mutating command never runs
        # on the endpoint. Unsafe curated content (rare) is left pending.
        win = None
        if plugin.runner_type == "windows_winrm":
            # check_definition is usually FLAT ({shell,command,expect,...}); some
            # may nest it under a "windows_winrm" key. Prefer the nested form,
            # else use cd itself — mirrors run_service's effective_check handling.
            wcd = cd.get("windows_winrm") if isinstance(cd.get("windows_winrm"), dict) else cd
            cmd = (wcd or {}).get("command")
            if wcd and isinstance(cmd, str) and is_command_safe(cmd)[0]:
                win = {"shell": (wcd.get("shell") or "powershell"),
                       "command": cmd,
                       "timeout": int(wcd.get("timeout_seconds") or 30)}
        jobs.append({
            "run_id": run.id, "plugin_id": plugin.id,
            "rule_id": plugin.rule_id, "plugin_key": plugin.plugin_key,
            "benchmark": plugin.benchmark, "runner_type": plugin.runner_type,
            "oscap": cd.get("oscap"),  # {rule_id, datastream, profile} for linux oscap rules
            "win": win,                # {shell, command, timeout} for windows checks
        })
    if agent.pending_scan_at is not None:  # work pulled — clear the nudge
        agent.pending_scan_at = None
        db.commit()
    return {"jobs": jobs, "count": len(jobs)}


@router.post("/jobs/results")
def agent_jobs_results(body: CisResultsIn,
                       authorization: Optional[str] = Header(default=None),
                       db: Session = Depends(get_db)):
    """Accept locally-produced CIS verdicts and finalize the pending run rows
    through the SAME path agentless uses — identical scoring, cascades and
    audit (run_service._finalize_run)."""
    from grc.models import CompliancePlugin, CompliancePluginRun
    from grc.modules.compliance_plugins.runners.registry import RunnerResult
    from grc.modules.compliance_plugins.services.run_service import _finalize_run
    agent = _agent_by_api_token(db, authorization)
    applied, skipped = 0, 0
    for r in body.results:
        run = db.get(CompliancePluginRun, r.run_id)
        if (run is None or run.executed_by_agent_id != agent.id
                or run.tenant_id != agent.tenant_id or run.status != "pending"):
            skipped += 1
            continue
        plugin = db.get(CompliancePlugin, run.plugin_id)
        if plugin is None:
            skipped += 1
            continue
        if plugin.runner_type == "windows_winrm" and r.exit_status is not None:
            # Windows: score the agent's raw output server-side with the SAME
            # evaluator (expect kinds + no-evidence guard) the WinRM runner uses,
            # so an agent verdict is identical to a credentialed-scan verdict.
            from grc.modules.compliance_plugins.runners.winrm_runner import evaluate_windows_result
            cd = plugin.check_definition if isinstance(plugin.check_definition, dict) else {}
            wcd = cd.get("windows_winrm") if isinstance(cd.get("windows_winrm"), dict) else cd
            result = evaluate_windows_result(wcd, r.stdout or "", int(r.exit_status), r.stderr or "")
        else:
            status = r.status if r.status in ("passed", "failed", "error", "skipped") else "error"
            result = RunnerResult(
                status=status, summary=(r.summary or "")[:4000],
                raw_output=r.raw_output or {},
                error_message=(r.summary or "")[:500] if status == "error" else None)
        _finalize_run(db, run, result, plugin=plugin, tenant_id=agent.tenant_id,
                      user_id=None, triggered_by="agent")
        applied += 1
    now = datetime.utcnow()
    agent.last_result_at = now
    agent.last_heartbeat_at = now
    db.commit()
    return {"ok": True, "applied": applied, "skipped": skipped}


# SCAP content roots the agent may fetch a datastream from. Serving the server's
# OWN datastream to the agent means it runs oscap against the exact same content
# the cloud uses, so rule IDs align perfectly and the host needs only the oscap
# binary (no local SCAP content to install or keep in sync).
_SCAP_DIRS = ("/opt/ssg", "/usr/share/xml/scap")


@router.get("/datastream")
def download_datastream(p: str, authorization: Optional[str] = Header(default=None),
                        db: Session = Depends(get_db)):
    """Stream a SCAP datastream to an enrolled agent. Whitelisted to the SCAP
    content dirs and realpath-checked, so `p` can't traverse out."""
    _agent_by_api_token(db, authorization)  # token-gated
    real = os.path.realpath(p)
    if not any(real.startswith(d + os.sep) for d in _SCAP_DIRS) or not os.path.isfile(real):
        raise HTTPException(404, "datastream not available")
    return FileResponse(real, media_type="application/xml", filename=os.path.basename(real))


# ── Installer download (the "Download agent" buttons) ───────────────────────
# Compiled binaries live outside git (built on the droplet), served from here.
AGENT_DIST = os.environ.get("AVA_AGENT_DIST", "/root/ComplyVerse/agent-dist")
_BIN = {
    "linux": "complyverse-agent-linux",
    "windows": "complyverse-agent-windows.exe",
    # macOS ships per-arch; the installer picks by `uname -m`.
    "darwin-amd64": "complyverse-agent-darwin-amd64",
    "darwin-arm64": "complyverse-agent-darwin-arm64",
}


def _public_base(request: Request) -> str:
    """The cloud origin the agent reports to — the same host the operator
    downloaded from, via the reverse proxy's X-Forwarded-* (nginx terminates TLS)."""
    override = os.environ.get("CONNECT_WIZARD_PUBLIC_URL", "").strip().rstrip("/")
    if override:
        return override
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host")
            or request.url.netloc).split(",")[0].strip()
    return f"{proto}://{host}"


def _agent_base(request: Request, reachability: Optional[str]) -> str:
    """Where the installed agent phones home FOREVER (baked into the service).
      • 'public'  — the host the operator reached the console on (default; good
                    for testing, reachable from anywhere).
      • 'private' — the production address agents reach the server over their own
                    network (VPN / internal DNS), set once by ops in
                    AVA_AGENT_PRIVATE_URL. NOT the droplet's VPC private IP: that
                    is reachable only by other droplets in the VPC, not by agents
                    on client machines. We only pick which base to bake; the
                    actual private value is ops's to configure."""
    if (reachability or "public").strip().lower() == "private":
        priv = os.environ.get("COMPLYVERSE_AGENT_PRIVATE_URL", "").strip().rstrip("/")
        if not priv:
            raise HTTPException(409, "Private agent reachability is not configured on "
                                "the server. Set AVA_AGENT_PRIVATE_URL to the VPN / "
                                "internal address agents should reach, or use Public.")
        return priv
    return _public_base(request)


def _install_commands(request: Request, token: str, tenant: str,
                      reachability: Optional[str] = "public") -> Dict[str, str]:
    """One-line install commands the console shows for a fresh enrollment token —
    run in an elevated terminal on the target host. This is the primary install
    path (no downloaded .ps1/.sh to "open with…"): the one-liner fetches the
    personalised installer and executes it. ``?tenant_slug`` is carried so the
    tenant is baked even though the fetch has no browser session (TenantMiddleware
    resolves it from the query param). ``?reach`` is carried so the installer the
    agent fetches bakes the SAME base (public vs private) the console chose, rather
    than re-deriving it from the fetch host."""
    base = _agent_base(request, reachability)
    params = []
    if tenant:
        params.append(f"tenant_slug={tenant}")
    if (reachability or "public").strip().lower() == "private":
        params.append("reach=private")
    q = ("?" + "&".join(params)) if params else ""
    return {
        # Elevated PowerShell. iwr → iex runs the installer in the current session.
        "windows": f'iwr "{base}/api/endpoint-agents/installer/windows/{token}{q}" -UseBasicParsing | iex',
        "linux": f'curl -fsSL "{base}/api/endpoint-agents/installer/linux/{token}{q}" | sudo sh',
        "macos": f'curl -fsSL "{base}/api/endpoint-agents/installer/macos/{token}{q}" | sudo sh',
    }


@router.get("/installer/{os_family}/bin")
def download_agent_binary(os_family: str):
    """The raw compiled agent binary. No auth — the enrollment token (needed to
    actually report) is what gates access to the tenant's data."""
    name = _BIN.get(os_family)
    if not name:
        raise HTTPException(404, "Unknown OS")
    path = os.path.join(AGENT_DIST, name)
    if not os.path.exists(path):
        raise HTTPException(503, "Agent binary not built yet for this platform")
    return FileResponse(path, media_type="application/octet-stream", filename=name)


def _linux_installer(url: str, token: str, tenant: str) -> str:
    return f"""#!/bin/sh
# ComplyVerse Compliance Agent installer (Linux). Downloads the agent, installs it as a
# systemd service, enrolls, and sends the first inventory to the cloud.
set -e
COMPLYVERSE_URL="{url}"
COMPLYVERSE_ENROLL="{token}"
COMPLYVERSE_TENANT="{tenant}"
[ "$(id -u)" -eq 0 ] || {{ echo "Run as root (sudo)"; exit 1; }}
install -d /opt/complyverse-agent
# Idempotent re-install: stop any running agent so the binary isn't busy (ETXTBSY).
systemctl stop complyverse-agent 2>/dev/null || true
# Clear the saved token so this (re)install claims the FRESH enrollment (take-over).
rm -f /etc/complyverse-agent/agent.json
echo "Downloading agent..."
curl -fsSL "$COMPLYVERSE_URL/api/endpoint-agents/installer/linux/bin" -o /opt/complyverse-agent/complyverse-agent
chmod +x /opt/complyverse-agent/complyverse-agent
# OpenSCAP binary for the CIS scan (the datastream content is fetched from the
# server per job, so only the oscap engine is needed here). Best-effort —
# inventory still works without it.
echo "Installing the compliance scanner (OpenSCAP)..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y openscap-scanner >/dev/null 2>&1 || apt-get install -y libopenscap8 >/dev/null 2>&1 || true
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y openscap-scanner >/dev/null 2>&1 || true
elif command -v yum >/dev/null 2>&1; then
  yum install -y openscap-scanner >/dev/null 2>&1 || true
fi
cat > /etc/systemd/system/complyverse-agent.service <<UNIT
[Unit]
Description=ComplyVerse Compliance Agent
After=network-online.target
Wants=network-online.target
[Service]
Environment=COMPLYVERSE_URL=$COMPLYVERSE_URL
Environment=COMPLYVERSE_ENROLL=$COMPLYVERSE_ENROLL
Environment=COMPLYVERSE_TENANT=$COMPLYVERSE_TENANT
ExecStart=/opt/complyverse-agent/complyverse-agent
Restart=always
RestartSec=10
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now complyverse-agent
echo "ComplyVerse agent installed and started. It will appear in your console shortly."
"""


def _windows_installer(url: str, token: str, tenant: str) -> str:
    return f"""# ComplyVerse Compliance Agent installer (Windows). Run in an elevated PowerShell.
$ErrorActionPreference = "Stop"
$CvUrl = "{url}"
$CvEnroll = "{token}"
$CvTenant = "{tenant}"
$dir = "$env:ProgramData\\ComplyVerseAgent"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
# Lock the dir to SYSTEM + Administrators only — it holds the api_token + enrollment
# token, and default ProgramData is world-readable. New files inherit this ACL.
icacls "$dir" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" 2>$null | Out-Null
# Idempotent re-install + migrate off the old scheduled-task installs: stop the
# service (if any), remove the old task, and free the .exe. ALL best-effort — a
# fresh PC has no service/task, so these are EXPECTED to "fail". schtasks writes
# that failure to stderr, which PowerShell 5.1 turns into a TERMINATING error
# under -ErrorAction Stop (and 2>$null does not always suppress it), so we lower
# the preference here and let cmd own the redirection (no NativeCommandError).
$ErrorActionPreference = "SilentlyContinue"
sc.exe stop ComplyVerseAgent 2>$null | Out-Null
cmd /c "schtasks /End /TN ComplyVerseAgent >nul 2>nul"
cmd /c "schtasks /Delete /TN ComplyVerseAgent /F >nul 2>nul"
Stop-Process -Name complyverse-agent -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
# Clear the saved token so this (re)install claims the FRESH enrollment — the new
# agent takes over and the backend supersedes the old row (one agent per host).
Remove-Item "$dir\\agent.json" -Force -ErrorAction SilentlyContinue
$ErrorActionPreference = "Stop"
Write-Host "Downloading agent..."
Invoke-WebRequest "$CvUrl/api/endpoint-agents/installer/windows/bin" -OutFile "$dir\\complyverse-agent.exe" -UseBasicParsing
# Config the service reads at startup. A Windows service does NOT reliably inherit
# Machine env vars set in this same session, so the file — not the registry — is
# the dependable source; Machine env is kept only for an interactive/debug run.
$cfg = @{{ URL = $CvUrl; Tenant = $CvTenant; Enroll = $CvEnroll }} | ConvertTo-Json -Compress
Set-Content -Path "$dir\\config.json" -Value $cfg -Encoding UTF8
[Environment]::SetEnvironmentVariable('COMPLYVERSE_URL', $CvUrl, 'Machine')
[Environment]::SetEnvironmentVariable('COMPLYVERSE_ENROLL', $CvEnroll, 'Machine')
[Environment]::SetEnvironmentVariable('COMPLYVERSE_TENANT', $CvTenant, 'Machine')
# Real Windows service: auto-start at boot AND auto-restart on crash (SCM failure
# actions). 'create' no-ops if it already exists; 'config' then updates it.
$bin = "`"$dir\\complyverse-agent.exe`""
sc.exe create ComplyVerseAgent binPath= $bin start= auto obj= LocalSystem DisplayName= "ComplyVerse Compliance Agent" 2>$null | Out-Null
sc.exe config ComplyVerseAgent binPath= $bin start= auto obj= LocalSystem | Out-Null
sc.exe failure ComplyVerseAgent reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
sc.exe description ComplyVerseAgent "ComplyVerse Compliance Agent - inventory + CIS hardening checks" | Out-Null
sc.exe start ComplyVerseAgent | Out-Null
Write-Host "ComplyVerse agent installed as an auto-restarting Windows service. It will appear in your console shortly."
"""


def _macos_installer(url: str, token: str, tenant: str) -> str:
    return f"""#!/bin/sh
# ComplyVerse Compliance Agent installer (macOS). Downloads the agent, installs it as a
# LaunchDaemon, enrolls, and sends the first inventory to the cloud. macOS agents
# report hardware/software inventory; local CIS (OpenSCAP) is Linux-only.
set -e
COMPLYVERSE_URL="{url}"
COMPLYVERSE_ENROLL="{token}"
COMPLYVERSE_TENANT="{tenant}"
[ "$(id -u)" -eq 0 ] || {{ echo "Run with sudo"; exit 1; }}
case "$(uname -m)" in
  arm64) BIN="darwin-arm64" ;;
  x86_64) BIN="darwin-amd64" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac
install -d /opt/complyverse-agent
# Idempotent re-install: unload any running agent so the binary isn't busy.
launchctl bootout system /Library/LaunchDaemons/io.complyverse.agent.plist 2>/dev/null || launchctl unload /Library/LaunchDaemons/io.complyverse.agent.plist 2>/dev/null || true
# Clear the saved token so this (re)install claims the FRESH enrollment (take-over).
rm -f /etc/complyverse-agent/agent.json
echo "Downloading agent..."
curl -fsSL "$COMPLYVERSE_URL/api/endpoint-agents/installer/$BIN/bin" -o /opt/complyverse-agent/complyverse-agent
chmod +x /opt/complyverse-agent/complyverse-agent
cat > /Library/LaunchDaemons/io.complyverse.agent.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>io.complyverse.agent</string>
  <key>ProgramArguments</key><array><string>/opt/complyverse-agent/complyverse-agent</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>COMPLYVERSE_URL</key><string>$COMPLYVERSE_URL</string>
    <key>COMPLYVERSE_ENROLL</key><string>$COMPLYVERSE_ENROLL</string>
    <key>COMPLYVERSE_TENANT</key><string>$COMPLYVERSE_TENANT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
PLIST
launchctl load -w /Library/LaunchDaemons/io.complyverse.agent.plist
echo "ComplyVerse agent installed and started. It will appear in your console shortly."
"""


@router.get("/installer/{os_family}/{enrollment_token}", response_class=PlainTextResponse)
def download_installer(os_family: str, enrollment_token: str, request: Request,
                       reach: str = "public"):
    """Personalised one-shot installer script with the tenant's enrollment token
    AND tenant slug baked in (the agent sends the slug as X-Tenant-Slug so the
    backend routes to the right per-tenant DB). The token IS the auth (same model
    as the connect wizard), so this is intentionally not user-session gated — but
    the tenant slug comes from the authenticated browser that downloads it. ``reach``
    (from the one-liner) decides whether COMPLYVERSE_URL is baked public or private."""
    url = _agent_base(request, reach)
    tenant = getattr(request.state, "tenant_slug", None) or ""
    if os_family == "linux":
        return _linux_installer(url, enrollment_token, tenant)
    if os_family == "windows":
        return _windows_installer(url, enrollment_token, tenant)
    if os_family in ("macos", "darwin"):
        return _macos_installer(url, enrollment_token, tenant)
    raise HTTPException(404, "Unknown OS")


if __name__ == "__main__":  # self-check — pure logic, no DB
    assert _hash("x") == _hash("x") and _hash("x") != _hash("y")
    assert len(_hash("anything")) == 64  # fits String(128)

    class _A:
        def __init__(self, status, hb):
            self.status = status; self.last_heartbeat_at = hb
    now = datetime.utcnow()
    assert _effective_status(_A("pending", None), now) == "pending"
    assert _effective_status(_A("revoked", now), now) == "revoked"
    assert _effective_status(_A("active", now), now) == "active"
    assert _effective_status(_A("active", now - timedelta(minutes=30)), now) == "stale"
    assert _effective_status(_A("active", now - timedelta(minutes=5)), now) == "active"

    lin = _linux_installer("https://app.example.com", "enr_abc", "ava")
    assert 'COMPLYVERSE_URL="https://app.example.com"' in lin and 'COMPLYVERSE_ENROLL="enr_abc"' in lin
    assert 'COMPLYVERSE_TENANT="ava"' in lin and "Environment=COMPLYVERSE_TENANT=$COMPLYVERSE_TENANT" in lin
    assert "/api/endpoint-agents/installer/linux/bin" in lin and "systemctl enable --now complyverse-agent" in lin
    win = _windows_installer("https://app.example.com", "enr_xyz", "ava")
    assert '$CvEnroll = "enr_xyz"' in win and '$CvTenant = "ava"' in win

    # Domain binding gate.
    assert _domain_allowed(None, "WORKGROUP", False)          # no binding → any machine
    assert _domain_allowed("", "anything", False)             # blank binding → any machine
    assert _domain_allowed("bank.local", "bank.local", True)  # joined to the right AD domain
    assert _domain_allowed("bank.local", "BANK.LOCAL", True)  # case-insensitive
    assert not _domain_allowed("bank.local", "WORKGROUP", False)   # home/off-domain PC refused
    assert not _domain_allowed("bank.local", "other.local", True)  # wrong domain refused
    assert not _domain_allowed("bank.local", "bank.local", False)  # dotted domain requires real join
    assert _domain_allowed("WORKGROUP", "WORKGROUP", False)   # non-dotted name (e.g. test box) matches by name
    assert "complyverse-agent.exe" in win and "schtasks" in win and "COMPLYVERSE_TENANT" in win
    assert _BIN["linux"] == "complyverse-agent-linux" and _BIN["windows"] == "complyverse-agent-windows.exe"

    # Reachability: public derives from the request host; private uses the ops env
    # (and refuses when unset). A tiny fake Request is enough for the pure logic.
    class _Url:
        scheme = "https"; netloc = "app.example.com"
    class _Req:
        headers = {"host": "app.example.com"}; url = _Url()
    req = _Req()
    os.environ.pop("CONNECT_WIZARD_PUBLIC_URL", None)
    os.environ.pop("COMPLYVERSE_AGENT_PRIVATE_URL", None)
    assert _agent_base(req, "public") == "https://app.example.com"
    try:
        _agent_base(req, "private"); assert False, "private must refuse when unset"
    except HTTPException as e:
        assert e.status_code == 409
    os.environ["COMPLYVERSE_AGENT_PRIVATE_URL"] = "https://ava.internal/"
    assert _agent_base(req, "private") == "https://ava.internal"   # trailing slash stripped
    cmd_pub = _install_commands(req, "enr_1", "ava", "public")
    assert "app.example.com" in cmd_pub["linux"] and "tenant_slug=ava" in cmd_pub["linux"]
    assert "reach=private" not in cmd_pub["linux"]
    cmd_priv = _install_commands(req, "enr_1", "ava", "private")
    assert "ava.internal" in cmd_priv["linux"] and "reach=private" in cmd_priv["linux"]
    os.environ.pop("COMPLYVERSE_AGENT_PRIVATE_URL", None)

    # Recon finding rows: contract shape for the pentest gate (source/severity/
    # component/stable vid), and junk ports dropped.
    rr = _recon_rows(7, "10.0.0.5", [
        {"port": 22, "proto": "tcp", "service": "sshd", "version": "OpenSSH 8.9", "evidence": "x"},
        {"port": 80, "proto": "tcp", "service": "nginx", "version": ""},
        {"port": 0, "proto": "tcp", "service": "bad"},   # dropped: port <= 0
        {"port": "nope"},                                 # dropped: non-int
        "not-a-dict",                                     # dropped: not a mapping
    ])
    assert len(rr) == 2, rr
    r0 = rr[0]
    assert r0["fields"]["source"] == "agent:recon" and r0["fields"]["severity"] == "info"
    assert r0["fields"]["plugin_family"] == "Agent Recon" and r0["fields"]["status"] == "open"
    assert r0["fields"]["affected_port"] == 22 and r0["affected_component"] == "sshd OpenSSH 8.9"
    assert r0["fields"]["title"] == "Open port 22/tcp: sshd (OpenSSH 8.9)"
    assert r0["vid"].startswith("AGENT-RECON-7-") and len(r0["vid"]) <= 50
    assert rr[1]["affected_component"] == "nginx" and rr[1]["fields"]["title"] == "Open port 80/tcp: nginx"
    # Stable vid: re-reporting the same port upserts (does not duplicate).
    assert _recon_rows(7, "10.0.0.5", [{"port": 22, "proto": "tcp", "service": "sshd", "version": "OpenSSH 8.9"}])[0]["vid"] == r0["vid"]
    print("agents_router self-check PASSED")
