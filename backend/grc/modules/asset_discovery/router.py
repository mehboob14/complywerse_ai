"""Asset discovery API — configure campaigns and scopes, read run history.

Scope of this increment (foundation):
  * campaign CRUD + scope CRUD          → live
  * run history (read)                  → live
  * POST .../run (trigger a scan)       → 501 until the execution worker lands

Every write is gated behind `compliance:discover:execute` — the same permission
that guards the existing CIDR/AD probes — because defining a scan scope is a
security-sensitive action even before the scan runs. Reads require auth only.

Tenant isolation: this is a database-per-tenant app, but we still filter every
query by the caller's primary tenant so a stray cross-tenant id cannot leak, and
every nested resource is re-checked against the parent it claims to belong to.
"""
from __future__ import annotations

import ipaddress
import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from grc.crypto import encrypt_secret
from grc.models import (
    GRCUser,
    ITAsset,
    DiscoveryCampaign,
    DiscoveryScope,
    DiscoveryRun,
    DiscoveryObservation,
    CredentialProfile,
    get_db,
)
from grc.models._47_asset_discovery_models import CREDENTIAL_KINDS, SECRET_KINDS
from grc.models._47_asset_discovery_models import (
    DISCOVERY_METHODS,
    SCOPE_KINDS,
)
from grc.routers.auth_router import (
    get_user_primary_tenant,
    require_auth,
    require_tenant_permission,
)

logger = logging.getLogger(__name__)

# Defining what to scan is a security-sensitive act — gate writes the same way
# the live CIDR/AD probes are gated.
_require_discover = require_tenant_permission("compliance:discover:execute")

router = APIRouter(prefix="/discovery", tags=["Asset Discovery"])

# Per-campaign run guard. A campaign must not have two runs executing at once —
# overlapping sweeps double the network load and race on the same observations.
# Mirrors the process-level lock the CIS scan-all endpoint uses. Keyed by
# (tenant_id, campaign_id). This is per-process; a multi-process deployment
# additionally relies on the DiscoveryJob lease columns for cross-worker safety.
_RUN_LOCK = threading.Lock()
_ACTIVE_RUNS: Dict[Tuple[int, int], str] = {}


def _acquire_run_lock(tenant_id: int, campaign_id: int) -> bool:
    key = (tenant_id, campaign_id)
    with _RUN_LOCK:
        if key in _ACTIVE_RUNS:
            return False
        _ACTIVE_RUNS[key] = datetime.utcnow().isoformat(timespec="seconds")
        return True


def _release_run_lock(tenant_id: int, campaign_id: int) -> None:
    with _RUN_LOCK:
        _ACTIVE_RUNS.pop((tenant_id, campaign_id), None)


# ── Request bodies ───────────────────────────────────────────────────────────

class ScopeIn(BaseModel):
    kind: str = Field(default="cidr")
    value: str = Field(min_length=1, max_length=500)
    exclude: bool = False
    note: Optional[str] = Field(default=None, max_length=500)


class CampaignIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    method: str = Field(default="network")
    is_active: bool = True
    schedule_seconds: Optional[int] = Field(default=None, ge=300)  # >= 5 min if set
    scopes: List[ScopeIn] = Field(default_factory=list)


class CampaignPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    method: Optional[str] = None
    is_active: Optional[bool] = None
    schedule_seconds: Optional[int] = Field(default=None, ge=300)


# ── Validation helpers ───────────────────────────────────────────────────────

def _validate_scope(kind: str, value: str) -> None:
    """Reject a scope the scanner could never act on, at write time rather than
    at scan time — a bad CIDR should fail when the operator saves it, not
    silently produce an empty run later."""
    if kind not in SCOPE_KINDS:
        raise HTTPException(400, f"Invalid scope kind '{kind}'. One of: {', '.join(SCOPE_KINDS)}")
    if kind == "cidr":
        try:
            ipaddress.ip_network(value, strict=False)
        except ValueError:
            raise HTTPException(400, f"'{value}' is not a valid CIDR (e.g. 10.0.0.0/24).")
    elif kind == "ip_range":
        parts = value.split("-")
        if len(parts) != 2:
            raise HTTPException(400, f"IP range must be 'start-end' (got '{value}').")
        try:
            ipaddress.ip_address(parts[0].strip())
            ipaddress.ip_address(parts[1].strip())
        except ValueError:
            raise HTTPException(400, f"'{value}' is not a valid IP range.")
    # ad_ou: any non-empty string is accepted; AD validates it at scan time.


def _validate_method(method: str) -> None:
    if method not in DISCOVERY_METHODS:
        raise HTTPException(400, f"Invalid method '{method}'. One of: {', '.join(DISCOVERY_METHODS)}")


# ── Serializers ──────────────────────────────────────────────────────────────

def _scope_dict(s: DiscoveryScope) -> dict:
    return {"id": s.id, "kind": s.kind, "value": s.value,
            "exclude": s.exclude, "note": s.note}


def _obs_dict(o: DiscoveryObservation) -> dict:
    return {
        "id": o.id, "run_id": o.run_id, "source": o.source,
        "observed_at": o.observed_at.isoformat() if o.observed_at else None,
        "host_name": o.host_name, "ip_address": o.ip_address,
        "fqdn": o.fqdn, "mac_address": o.mac_address,
        "raw": o.raw,
        "resolution": o.resolution, "resolved_asset_id": o.resolved_asset_id,
        "resolution_note": o.resolution_note,
    }


def _run_dict(r: DiscoveryRun) -> dict:
    return {
        "id": r.id, "campaign_id": r.campaign_id, "trigger": r.trigger,
        "status": r.status,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "hosts_seen": r.hosts_seen, "observations": r.observations,
        "assets_new": r.assets_new, "assets_updated": r.assets_updated,
        "error": r.error, "created_by_name": r.created_by_name,
    }


def _campaign_dict(c: DiscoveryCampaign, *, scopes=False, runs=False) -> dict:
    out = {
        "id": c.id, "name": c.name, "description": c.description,
        "method": c.method, "is_active": c.is_active,
        "schedule_seconds": c.schedule_seconds,
        "last_run_at": c.last_run_at.isoformat() if c.last_run_at else None,
        "next_run_at": c.next_run_at.isoformat() if c.next_run_at else None,
        "blackout_windows": c.blackout_windows,
        "rate_limit_hosts_per_min": c.rate_limit_hosts_per_min,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "created_by_name": c.created_by_name,
        "scope_count": len(c.scopes),
    }
    if scopes:
        out["scopes"] = [_scope_dict(s) for s in c.scopes]
    if runs:
        out["recent_runs"] = [_run_dict(r) for r in c.runs[:10]]
    return out


def _assert_name_available(db: Session, tenant_id: int, name: str,
                           *, exclude_id: Optional[int] = None) -> None:
    """Campaign names are unique per tenant. Check in the app layer so the
    operator gets a clean 409 with a useful message rather than a raw 500 from
    the DB constraint. The constraint is still the backstop against races."""
    q = db.query(DiscoveryCampaign.id).filter(
        DiscoveryCampaign.tenant_id == tenant_id,
        DiscoveryCampaign.name == name,
    )
    if exclude_id is not None:
        q = q.filter(DiscoveryCampaign.id != exclude_id)
    if db.query(q.exists()).scalar():
        raise HTTPException(409, f"A campaign named '{name}' already exists.")


def _get_campaign_or_404(db: Session, tenant_id: int, campaign_id: int) -> DiscoveryCampaign:
    c = db.query(DiscoveryCampaign).filter(
        DiscoveryCampaign.id == campaign_id,
        DiscoveryCampaign.tenant_id == tenant_id,
    ).first()
    if not c:
        raise HTTPException(404, "Campaign not found")
    return c


# ── Campaign endpoints ───────────────────────────────────────────────────────

@router.get("/campaigns")
def list_campaigns(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tid = get_user_primary_tenant(current_user, db)
    rows = db.query(DiscoveryCampaign).filter(
        DiscoveryCampaign.tenant_id == tid,
    ).order_by(DiscoveryCampaign.id.desc()).all()
    return {"campaigns": [_campaign_dict(c) for c in rows]}


@router.get("/campaigns/{campaign_id}")
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tid = get_user_primary_tenant(current_user, db)
    c = _get_campaign_or_404(db, tid, campaign_id)
    return _campaign_dict(c, scopes=True, runs=True)


@router.post("/campaigns", status_code=201)
def create_campaign(
    body: CampaignIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    if not tid:
        raise HTTPException(400, "No tenant for user")
    _validate_method(body.method)
    _assert_name_available(db, tid, body.name)
    for s in body.scopes:
        _validate_scope(s.kind, s.value)

    c = DiscoveryCampaign(
        tenant_id=tid, name=body.name, description=body.description,
        method=body.method, is_active=body.is_active,
        schedule_seconds=body.schedule_seconds,
        # Schedule the first automatic run one interval out — never the moment
        # of creation, so saving a campaign can't kick off a surprise network
        # scan. The operator gets an immediate baseline via the Run button.
        next_run_at=(datetime.utcnow() + timedelta(seconds=body.schedule_seconds))
        if body.schedule_seconds else None,
        created_by_id=current_user.id,
        created_by_name=(getattr(current_user, "display_name", None)
                         or getattr(current_user, "username", None)),
    )
    db.add(c)
    db.flush()
    for s in body.scopes:
        db.add(DiscoveryScope(
            tenant_id=tid, campaign_id=c.id, kind=s.kind,
            value=s.value, exclude=s.exclude, note=s.note,
        ))
    try:
        db.commit()
    except IntegrityError:
        # The unique(tenant_id, name) constraint fired — a concurrent create
        # slipped between the app-level check and here. Same clean 409.
        db.rollback()
        raise HTTPException(409, f"A campaign named '{body.name}' already exists.")
    db.refresh(c)
    return _campaign_dict(c, scopes=True)


@router.patch("/campaigns/{campaign_id}")
def update_campaign(
    campaign_id: int,
    body: CampaignPatch,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    c = _get_campaign_or_404(db, tid, campaign_id)
    data = body.model_dump(exclude_unset=True)
    if "method" in data and data["method"] is not None:
        _validate_method(data["method"])
    if data.get("name") and data["name"] != c.name:
        _assert_name_available(db, tid, data["name"], exclude_id=c.id)
    schedule_changed = "schedule_seconds" in data and data["schedule_seconds"] != c.schedule_seconds
    for field, value in data.items():
        setattr(c, field, value)
    # Recompute the next automatic run when the cadence changes: a new interval
    # from now, or cleared when scheduling is turned off.
    if schedule_changed:
        c.next_run_at = (datetime.utcnow() + timedelta(seconds=c.schedule_seconds)) \
            if c.schedule_seconds else None
    db.commit()
    db.refresh(c)
    return _campaign_dict(c, scopes=True)


@router.delete("/campaigns/{campaign_id}", status_code=204)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    c = _get_campaign_or_404(db, tid, campaign_id)
    db.delete(c)  # scopes + runs + jobs + observations cascade
    db.commit()
    return None


# ── Scope endpoints ──────────────────────────────────────────────────────────

@router.post("/campaigns/{campaign_id}/scopes", status_code=201)
def add_scope(
    campaign_id: int,
    body: ScopeIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    c = _get_campaign_or_404(db, tid, campaign_id)
    _validate_scope(body.kind, body.value)
    s = DiscoveryScope(
        tenant_id=tid, campaign_id=c.id, kind=body.kind,
        value=body.value, exclude=body.exclude, note=body.note,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _scope_dict(s)


@router.delete("/scopes/{scope_id}", status_code=204)
def delete_scope(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    s = db.query(DiscoveryScope).filter(
        DiscoveryScope.id == scope_id,
        DiscoveryScope.tenant_id == tid,
    ).first()
    if not s:
        raise HTTPException(404, "Scope not found")
    db.delete(s)
    db.commit()
    return None


# ── Run history ──────────────────────────────────────────────────────────────

@router.get("/runs")
def list_runs(
    campaign_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tid = get_user_primary_tenant(current_user, db)
    q = db.query(DiscoveryRun).filter(DiscoveryRun.tenant_id == tid)
    if campaign_id is not None:
        q = q.filter(DiscoveryRun.campaign_id == campaign_id)
    rows = q.order_by(DiscoveryRun.id.desc()).limit(limit).all()
    return {"runs": [_run_dict(r) for r in rows]}


@router.post("/campaigns/{campaign_id}/run", status_code=202)
def trigger_run(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    """Start a campaign's network sweep and return the run immediately (202).

    A real sweep of a /20 can take minutes — far too long to hold an HTTP
    request open (the browser and the Next.js proxy both time out, and the
    client sees a 5xx while the scan actually succeeds). So this follows the
    same production pattern the CIS scan-all endpoint uses: fast synchronous
    preflight, then execute on a background daemon thread with its own
    tenant-bound session, and return a queued run the client polls via
    GET /discovery/runs?campaign_id=. A per-campaign lock rejects a second
    concurrent run with 409.

    Only network scopes (cidr / ip_range) run today. A campaign whose only
    ranges are AD OUs is rejected with a clear message until credential storage
    lands — better than a run that silently finds nothing.
    """
    from .services.executor import create_run, execute_run

    tid = get_user_primary_tenant(current_user, db)
    campaign = _get_campaign_or_404(db, tid, campaign_id)

    # ── Fast preflight (before we commit a run or take the lock) ──
    include = [s for s in campaign.scopes if not s.exclude]
    if not include:
        raise HTTPException(400, "Campaign has no ranges to scan. Add a scope first.")
    if all(s.kind == "ad_ou" for s in include):
        raise HTTPException(
            400,
            "This campaign only has Active Directory OUs, and AD enumeration "
            "needs stored credentials, which aren't built yet. Add a CIDR or IP "
            "range scope to run a network sweep now.",
        )

    if not _acquire_run_lock(tid, campaign_id):
        started = _ACTIVE_RUNS.get((tid, campaign_id), "earlier")
        raise HTTPException(
            409, f"A run for this campaign is already in progress (started {started}).",
        )

    # Cross-process guard: the in-process lock only covers this worker. Under a
    # multi-worker deployment a second worker could still start a duplicate run,
    # so also reject if the campaign already has a run the DB shows in flight.
    inflight = db.query(DiscoveryRun.id).filter(
        DiscoveryRun.campaign_id == campaign_id,
        DiscoveryRun.status.in_(("queued", "running")),
    ).first()
    if inflight:
        _release_run_lock(tid, campaign_id)
        raise HTTPException(
            409, f"A run for this campaign is already in progress (run #{inflight[0]}).",
        )

    # Create the run row up front so the client has an id to poll, then hand
    # off to the worker thread. Capture the engine + ids before the request
    # session closes (the thread must not touch this session).
    try:
        run = create_run(db, campaign, trigger="manual", user=current_user)
    except Exception:
        _release_run_lock(tid, campaign_id)
        raise

    tenant_engine = db.get_bind()
    run_id = run.id

    def _execute_in_background() -> None:
        Sess = sessionmaker(bind=tenant_engine, expire_on_commit=False)
        worker_db = Sess()
        try:
            execute_run(worker_db, run_id)
        except Exception:
            logger.exception("discovery run %s failed in worker", run_id)
            # execute_run transitions status itself for job-level errors; a
            # catastrophic failure before that must still leave a terminal
            # status rather than a run stuck 'running'.
            try:
                stuck = worker_db.get(DiscoveryRun, run_id)
                if stuck and stuck.status in ("queued", "running"):
                    stuck.status = "failed"
                    stuck.error = "Run worker crashed; see server logs."
                    stuck.finished_at = datetime.utcnow()
                    worker_db.commit()
            except Exception:
                logger.exception("discovery run %s: could not mark failed", run_id)
        finally:
            worker_db.close()
            _release_run_lock(tid, campaign_id)

    threading.Thread(
        target=_execute_in_background, daemon=True,
        name=f"discovery-run-{tid}-{campaign_id}-{run_id}",
    ).start()

    return _run_dict(run)


# ── Inbox: observations awaiting a decision ──────────────────────────────────

class ResolveIn(BaseModel):
    # adopt = create a new asset · merge = fold into an existing one · ignore = dismiss
    action: str = Field(pattern="^(adopt|merge|ignore)$")
    target_asset_id: Optional[int] = None  # required for merge


@router.get("/inbox")
def discovery_inbox(
    status_filter: str = Query(default="open", pattern="^(open|review|pending|all)$"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Observations that need a human eye. 'open' (default) = anything not yet
    turned into a decision: pending (auto-resolver hasn't run or failed) plus
    review (ambiguous). Auto-created/merged/ignored rows are settled and don't
    show here."""
    tid = get_user_primary_tenant(current_user, db)
    q = db.query(DiscoveryObservation).filter(DiscoveryObservation.tenant_id == tid)
    if status_filter == "open":
        q = q.filter(DiscoveryObservation.resolution.in_(("pending", "review")))
    elif status_filter in ("review", "pending"):
        q = q.filter(DiscoveryObservation.resolution == status_filter)
    rows = q.order_by(DiscoveryObservation.id.desc()).limit(limit).all()
    return {"observations": [_obs_dict(o) for o in rows]}


@router.post("/observations/{obs_id}/resolve")
def resolve_observation_endpoint(
    obs_id: int,
    body: ResolveIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    """Operator decision on an inbox observation: adopt as a new asset, merge
    into an existing one, or dismiss it."""
    from .services import resolver

    tid = get_user_primary_tenant(current_user, db)
    obs = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.id == obs_id,
        DiscoveryObservation.tenant_id == tid,
    ).first()
    if not obs:
        raise HTTPException(404, "Observation not found")
    if obs.resolution in ("created", "merged", "ignored"):
        raise HTTPException(409, f"Observation is already resolved ({obs.resolution}).")

    if body.action == "adopt":
        asset = resolver.manual_adopt(db, obs)
        db.commit()
        return {"action": "adopt", "asset_id": asset.id}

    if body.action == "merge":
        if not body.target_asset_id:
            raise HTTPException(400, "target_asset_id is required to merge.")
        target = db.query(ITAsset).filter(
            ITAsset.id == body.target_asset_id, ITAsset.tenant_id == tid,
        ).first()
        if not target:
            raise HTTPException(404, "Target asset not found in this tenant.")
        resolver.manual_merge(db, obs, target)
        db.commit()
        return {"action": "merge", "asset_id": target.id}

    resolver.manual_ignore(db, obs)
    db.commit()
    return {"action": "ignore"}


# ── Credential profiles (encrypted; secrets never returned) ──────────────────

class CredentialIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str  # winrm | ssh | ldap
    username: str = Field(min_length=1, max_length=255)
    secret: str = Field(min_length=1)          # password or PEM key — write-only
    secret_kind: str = "password"              # password | ssh_key
    domain: Optional[str] = None
    port: Optional[int] = Field(default=None, ge=1, le=65535)
    winrm_transport: Optional[str] = None
    ssh_accept_unknown_hosts: bool = False
    applies_to_cidrs: Optional[List[str]] = None
    priority: int = 100


def _credential_dict(c: CredentialProfile) -> dict:
    # Deliberately omits the secret. `has_secret` tells the UI a secret is set
    # without ever exposing it — this is the one object we must never serialise
    # in full.
    return {
        "id": c.id, "name": c.name, "kind": c.kind, "username": c.username,
        "secret_kind": c.secret_kind, "has_secret": bool(c.secret_encrypted),
        "domain": c.domain, "port": c.port, "winrm_transport": c.winrm_transport,
        "ssh_accept_unknown_hosts": c.ssh_accept_unknown_hosts,
        "applies_to_cidrs": c.applies_to_cidrs, "priority": c.priority,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "created_by_name": c.created_by_name,
    }


@router.get("/credentials")
def list_credentials(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tid = get_user_primary_tenant(current_user, db)
    rows = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id == tid,
    ).order_by(CredentialProfile.priority, CredentialProfile.id).all()
    return {"credentials": [_credential_dict(c) for c in rows]}


@router.post("/credentials", status_code=201)
def create_credential(
    body: CredentialIn,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    if body.kind not in CREDENTIAL_KINDS:
        raise HTTPException(400, f"Invalid kind. One of: {', '.join(CREDENTIAL_KINDS)}")
    if body.secret_kind not in SECRET_KINDS:
        raise HTTPException(400, f"Invalid secret_kind. One of: {', '.join(SECRET_KINDS)}")
    for cidr in (body.applies_to_cidrs or []):
        try:
            ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            raise HTTPException(400, f"'{cidr}' is not a valid CIDR.")
    if db.query(CredentialProfile.id).filter(
        CredentialProfile.tenant_id == tid, CredentialProfile.name == body.name,
    ).first():
        raise HTTPException(409, f"A credential named '{body.name}' already exists.")

    c = CredentialProfile(
        tenant_id=tid, name=body.name, kind=body.kind, username=body.username,
        secret_kind=body.secret_kind,
        secret_encrypted=encrypt_secret(body.secret),  # encrypted at rest
        domain=body.domain, port=body.port, winrm_transport=body.winrm_transport,
        ssh_accept_unknown_hosts=body.ssh_accept_unknown_hosts,
        applies_to_cidrs=body.applies_to_cidrs, priority=body.priority,
        created_by_id=current_user.id,
        created_by_name=(getattr(current_user, "display_name", None)
                         or getattr(current_user, "username", None)),
    )
    db.add(c)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, f"A credential named '{body.name}' already exists.")
    db.refresh(c)
    return _credential_dict(c)  # no secret in the response


@router.delete("/credentials/{cred_id}", status_code=204)
def delete_credential(
    cred_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(_require_discover),
):
    tid = get_user_primary_tenant(current_user, db)
    c = db.query(CredentialProfile).filter(
        CredentialProfile.id == cred_id, CredentialProfile.tenant_id == tid,
    ).first()
    if not c:
        raise HTTPException(404, "Credential not found")
    db.delete(c)
    db.commit()
    return None
