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
from sqlalchemy import func
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
    IntegrationConnection,
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


# Live progress for the "try this login on every discovered device" sweep.
# The worker runs in a background thread and writes its outcome to the DB, but
# an operator watching the screen had no way to tell whether it was running,
# finished, or had silently died — every device just sat there. This is the
# progress the UI polls. Per-process and intentionally in-memory: it is a
# transient view of work in flight, and the durable record is the observation
# rows themselves.
_SWEEP_LOCK = threading.Lock()
_SWEEPS: Dict[int, Dict[str, Any]] = {}


def _sweep_start(tenant_id: int, total: int, kind: Optional[str]) -> None:
    with _SWEEP_LOCK:
        _SWEEPS[tenant_id] = {
            "running": True, "total": total, "done": 0, "connected": 0,
            # Deliberately separate outcomes. "rejected" = we had the right kind
            # of login and the device refused it (fix the credential).
            # "no_login" = we hold no credential of that kind covering it (add
            # one). "unknown_type" = the sweep couldn't classify it at all.
            # Collapsing these into one "skipped" hides the only thing that
            # tells the operator what to do next.
            "rejected": 0, "unreachable": 0, "no_login": 0, "unknown_type": 0, "already": 0,
            "kind": kind, "current": None,
            "started_at": datetime.utcnow().isoformat(timespec="seconds"),
            "finished_at": None, "error": None,
        }


def _sweep_update(tenant_id: int, **fields) -> None:
    with _SWEEP_LOCK:
        s = _SWEEPS.get(tenant_id)
        if s is None:
            return
        for k, v in fields.items():
            if k in ("done", "connected", "rejected", "unreachable", "no_login", "unknown_type", "already"):
                s[k] = s.get(k, 0) + v
            else:
                s[k] = v


def _sweep_finish(tenant_id: int, error: Optional[str] = None) -> None:
    with _SWEEP_LOCK:
        s = _SWEEPS.get(tenant_id)
        if s is None:
            return
        s["running"] = False
        s["current"] = None
        s["error"] = error
        s["finished_at"] = datetime.utcnow().isoformat(timespec="seconds")


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


def _attempt_status(o: DiscoveryObservation) -> Optional[Dict[str, str]]:
    """Classify what happened the last time we tried to connect this device.

    The worker records its outcome in resolution_note with a stable prefix, so
    both the queue and the Inbox can render the same verdict without either of
    them re-deriving it from free text.
    """
    if o.resolution != "unclaimed":
        return None
    note = o.resolution_note or ""
    if note.startswith("login failed"):
        return {"code": "rejected", "label": "Login rejected", "detail": note}
    if note.startswith("unreachable") or "is not open on" in note:
        return {"code": "unreachable", "label": "Service not reachable", "detail": note}
    if note.startswith("collect error"):
        return {"code": "error", "label": "Collect error", "detail": note}
    if note.startswith("no "):
        return {"code": "no_login", "label": "No login for this type", "detail": note}
    if note.startswith("type unknown"):
        return {"code": "unknown_type", "label": "Type unknown", "detail": note}
    return None


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
    # Scopes ride along: the Connect flow pre-fills a host login's subnet
    # restriction from the campaign that found the devices, so the operator
    # never re-types a range they already defined once.
    return {"campaigns": [_campaign_dict(c, scopes=True) for c in rows]}


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
    # `assets_new` is now permanently 0 — a sweep no longer creates assets — so
    # reporting it as "New" would be a column that can never move. What the
    # operator actually needs to know is how many of the devices this run found
    # are still waiting for a login, and how many were promoted into inventory.
    from sqlalchemy import func as _func
    run_ids = [r.id for r in rows]
    by_state: Dict[int, Dict[str, int]] = {}
    if run_ids:
        for rid, res, cnt in db.query(
            DiscoveryObservation.run_id, DiscoveryObservation.resolution,
            _func.count(DiscoveryObservation.id),
        ).filter(
            DiscoveryObservation.tenant_id == tid,
            DiscoveryObservation.run_id.in_(run_ids),
        ).group_by(DiscoveryObservation.run_id, DiscoveryObservation.resolution).all():
            by_state.setdefault(rid, {})[res] = cnt
    out = []
    for r in rows:
        d = _run_dict(r)
        st = by_state.get(r.id, {})
        d["awaiting_login"] = st.get("unclaimed", 0)
        d["in_inventory"] = st.get("created", 0)
        d["matched_existing"] = st.get("merged", 0)
        d["needs_review"] = st.get("review", 0)
        d["dismissed"] = st.get("ignored", 0)
        out.append(d)
    return {"runs": out}


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
    turned into a decision: pending (auto-resolver hasn't run or failed),
    review (ambiguous match), and unclaimed (found on the network, no login
    applied yet). Merged/created/ignored rows are settled and don't show here.

    'unclaimed' MUST be included: since discovery stopped auto-creating assets
    it is the state most devices sit in, and leaving it out of every filter is
    what made this tab come back empty."""
    tid = get_user_primary_tenant(current_user, db)
    q = db.query(DiscoveryObservation).filter(DiscoveryObservation.tenant_id == tid)
    if status_filter == "open":
        q = q.filter(DiscoveryObservation.resolution.in_(("pending", "review", "unclaimed")))
    elif status_filter in ("review", "pending"):
        q = q.filter(DiscoveryObservation.resolution == status_filter)
    rows = q.order_by(DiscoveryObservation.id.desc()).limit(limit).all()
    return {"observations": [_obs_dict(o) for o in rows]}


@router.get("/runs/{run_id}/observations")
def list_run_observations(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Every device a specific run found — IP, hostname, open ports, and where
    each one landed (new asset / merged / left for review)."""
    from grc.models import ITAsset
    tid = get_user_primary_tenant(current_user, db)
    rows = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.tenant_id == tid,
        DiscoveryObservation.run_id == run_id,
    ).order_by(DiscoveryObservation.ip_address).all()
    out = []
    for o in rows:
        d = _obs_dict(o)
        if o.resolved_asset_id:
            a = db.get(ITAsset, o.resolved_asset_id)
            if a:
                d["asset_name"] = a.name
                d["asset_os_family"] = getattr(a, "os_family", None)
                d["asset_type"] = getattr(a, "asset_type", None)
        out.append(d)
    return {"observations": out}


_LINUX_FAMS = ("linux", "ubuntu", "debian", "rhel", "centos", "rocky", "almalinux",
               "oraclelinux", "amazonlinux", "sles", "suse")


@router.get("/discovered-devices")
def list_discovered_devices(
    run_id: Optional[int] = Query(
        default=None,
        description="Filter the queue to devices seen in this discovery run. "
                    "Omit for the full backlog (every unclaimed device across all runs)."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The devices discovery found — read from OBSERVATIONS, not from inventory.

    A swept device is evidence, not an asset. It lives here as an unclaimed
    observation until a credential authenticates to it; only then is an ITAsset
    created (see promote_observation). Rows already promoted are still listed,
    now carrying their asset_id, so the operator sees the whole pipeline in one
    table: found → connected → in inventory.
    """
    tid = get_user_primary_tenant(current_user, db)
    # Newest observation per device across ALL runs (the backlog). A re-scan
    # writes a fresh row for the same host; we keep the newest so the queue is
    # "every device still unclaimed", not scan history. run_id (optional) scopes
    # the queue to one run without losing the union default.
    q = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.tenant_id == tid,
        DiscoveryObservation.resolution.in_(("unclaimed", "created", "pending")),
    )
    if run_id is not None:
        q = q.filter(DiscoveryObservation.run_id == run_id)
    obs_rows = q.order_by(DiscoveryObservation.id.desc()).all()
    latest: Dict[str, DiscoveryObservation] = {}
    for o in obs_rows:
        key = (o.host_name or "").lower() or (o.ip_address or f"obs-{o.id}")
        if key not in latest:
            latest[key] = o
    observations = sorted(latest.values(), key=lambda o: (o.ip_address or ""))

    # The latest run id, so the UI can flag devices NOT seen in it as stale
    # (last seen in an older scan — machine may have been powered off).
    latest_run_id = db.query(DiscoveryRun.id).filter(
        DiscoveryRun.tenant_id == tid,
    ).order_by(DiscoveryRun.id.desc()).limit(1).scalar()
    creds = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id == tid,
        CredentialProfile.is_active.is_(True),
        CredentialProfile.kind.in_(("winrm", "ssh")),
    ).all()
    # Hosts that currently hold an ACTIVE agentless connection — the state the
    # operator thinks of as "connected", and the only state Disconnect applies
    # to. Keyed by console_url, which deep_collect sets to host_name or IP.
    connected_hosts = {
        row[0] for row in db.query(IntegrationConnection.console_url).filter(
            IntegrationConnection.tenant_id == tid,
            IntegrationConnection.is_active.is_(True),
            IntegrationConnection.integration_type.in_(
                ("windows_winrm", "linux_ssh", "netdev_ssh")),
        ).all() if row[0]
    }

    def _covered(ip: Optional[str]) -> bool:
        if not ip:
            return False
        try:
            addr = ipaddress.ip_address(ip)
        except ValueError:
            return False
        for c in creds:
            cidrs = c.applies_to_cidrs or []
            if not cidrs:
                return True
            for cd in cidrs:
                try:
                    if addr in ipaddress.ip_network(cd, strict=False):
                        return True
                except ValueError:
                    continue
        return False

    from grc.modules.asset_discovery.services.deep_collect import transport_for_observation

    out = []
    for o in observations:
        asset = db.get(ITAsset, o.resolved_asset_id) if o.resolved_asset_id else None
        transport = transport_for_observation(o)
        if transport is None and asset is not None:
            fam = (asset.os_family or "").lower()
            transport = "windows" if fam.startswith("windows") else ("linux" if fam.startswith(_LINUX_FAMS) else None)
        raw = o.raw if isinstance(o.raw, dict) else {}
        host = o.host_name or o.ip_address
        out.append({
            "observation_id": o.id,
            # Present only once the device has been promoted into inventory.
            "asset_id": asset.id if asset else None,
            "name": o.host_name or o.fqdn or o.ip_address,
            "host_name": o.host_name,
            "ip_address": o.ip_address,
            "os_family": asset.os_family if asset else None,
            "transport": transport,
            "open_ports": raw.get("open_ports") or [],
            # In inventory with a real collected profile behind it.
            "profiled": bool(asset and asset.os_family),
            "has_credential": _covered(o.ip_address),
            # "connected" requires BOTH a live connection AND an actual asset.
            # A connection that outlived its deleted asset must not read as
            # "In inventory" — that stranded the row with a Disconnect button
            # pointing at a gone asset id.
            "connected": bool(asset and host and host in connected_hosts),
            # Which run last saw this device, and whether that was the latest
            # run. `stale=True` means it was NOT in the most recent scan — the
            # machine may have been powered off — so the UI can dim it.
            "last_seen_run_id": o.run_id,
            "last_seen_at": o.observed_at.isoformat() if o.observed_at else None,
            "stale": bool(latest_run_id and o.run_id != latest_run_id and not asset),
            # The outcome of the last attempt, as a code the UI can style plus
            # the operator-facing reason. Three distinct answers, because each
            # implies a different fix: rejected → the credential is wrong;
            # no_login → you never saved one for this kind; unknown_type → the
            # sweep can't classify the device.
            "attempt": _attempt_status(o),
        })
    # Runs that still have unclaimed/created/pending devices, for the queue's
    # run filter dropdown. Newest first; each with a per-run device count.
    run_rows = db.query(
        DiscoveryObservation.run_id, func.count(DiscoveryObservation.id),
    ).filter(
        DiscoveryObservation.tenant_id == tid,
        DiscoveryObservation.resolution.in_(("unclaimed", "created", "pending")),
    ).group_by(DiscoveryObservation.run_id).all()
    run_meta = {
        r.id: r for r in db.query(DiscoveryRun).filter(
            DiscoveryRun.tenant_id == tid,
            DiscoveryRun.id.in_([rid for rid, _ in run_rows] or [-1]),
        ).all()
    }
    runs = sorted(
        [{
            "run_id": rid,
            "device_count": cnt,
            "finished_at": (run_meta[rid].finished_at.isoformat()
                            if rid in run_meta and run_meta[rid].finished_at else None),
            "is_latest": rid == latest_run_id,
        } for rid, cnt in run_rows],
        key=lambda r: -(r["run_id"] or 0),
    )
    return {"devices": out, "runs": runs, "latest_run_id": latest_run_id,
            "filtered_run_id": run_id}


class DeviceConnectBody(BaseModel):
    username: str
    password: str
    domain: Optional[str] = None
    transport: Optional[str] = None


@router.post("/devices/{observation_id}/connect")
def connect_discovered_device(
    observation_id: int,
    body: DeviceConnectBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Give ONE discovered device a login, and promote it if the login works.

    The device is an observation, not an asset, until this succeeds. On success
    it is deep-collected and enters IT Asset Inventory fully populated; on
    failure nothing is created and the reason is recorded against the
    observation so the queue can show it.
    """
    tid = get_user_primary_tenant(current_user, db)
    obs = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.id == observation_id,
        DiscoveryObservation.tenant_id == tid,
    ).first()
    if not obs:
        raise HTTPException(404, "Device not found")
    if obs.resolved_asset_id:
        raise HTTPException(400, "This device is already in inventory — disconnect it first to change its login.")
    ip = obs.ip_address
    if not ip:
        raise HTTPException(400, "Device has no IP address to connect to")

    from grc.modules.asset_discovery.services.deep_collect import (
        promote_observation, transport_for_observation,
    )
    transport = (body.transport or "").lower()
    if transport not in ("windows", "linux"):
        transport = transport_for_observation(obs) or "windows"
    kind = "winrm" if transport == "windows" else "ssh"
    prof = CredentialProfile(
        tenant_id=tid, name=f"{obs.host_name or ip} - {kind}", kind=kind,
        username=body.username, secret_kind="password",
        secret_encrypted=encrypt_secret(body.password),
        domain=(body.domain or None), applies_to_cidrs=[f"{ip}/32"],
        priority=100, is_active=True,
        created_by_id=getattr(current_user, "id", None),
        created_by_name=getattr(current_user, "username", None),
    )
    db.add(prof)
    db.commit()
    db.refresh(prof)

    result: Dict[str, Any] = {"credential_id": prof.id, "collected": False}
    try:
        asset = promote_observation(db, obs, prof, transport)
        db.commit()
        result.update({"collected": True, "asset_id": asset.id,
                       "os_family": asset.os_family})
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        reason = str(exc)[:300]
        # Record WHY, on the row the operator is looking at.
        obs2 = db.get(DiscoveryObservation, observation_id)
        if obs2 is not None:
            obs2.resolution_note = f"login failed: {reason}"
            db.commit()
        result["error"] = reason
    return result


@router.post("/assets/{asset_id}/reconnect")
def reconnect_asset(
    asset_id: int,
    body: DeviceConnectBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Re-apply a login to a device that is ALREADY in inventory.

    Used after Disconnect, or to swap a credential. The asset already exists, so
    this re-collects onto it rather than promoting — the row keeps its id, its
    links and its history, and the fresh read updates OS / hardware / software.
    """
    tid = get_user_primary_tenant(current_user, db)
    a = db.query(ITAsset).filter(ITAsset.id == asset_id, ITAsset.tenant_id == tid).first()
    if not a:
        raise HTTPException(404, "Asset not found")
    ip = a.ip_address
    if not ip:
        raise HTTPException(400, "Asset has no IP address to connect to")
    transport = (body.transport or "").lower()
    if transport not in ("windows", "linux"):
        fam = (a.os_family or "").lower()
        transport = "linux" if fam.startswith(_LINUX_FAMS) else "windows"
    kind = "winrm" if transport == "windows" else "ssh"
    prof = CredentialProfile(
        tenant_id=tid, name=f"{a.name or ip} - {kind}", kind=kind,
        username=body.username, secret_kind="password",
        secret_encrypted=encrypt_secret(body.password),
        domain=(body.domain or None), applies_to_cidrs=[f"{ip}/32"],
        priority=100, is_active=True,
        created_by_id=getattr(current_user, "id", None),
        created_by_name=getattr(current_user, "username", None),
    )
    db.add(prof)
    db.commit()
    db.refresh(prof)
    result: Dict[str, Any] = {"credential_id": prof.id, "collected": False, "asset_id": a.id}
    try:
        from grc.modules.asset_discovery.services.deep_collect import collect_host
        info = collect_host(db, a, prof, transport)
        db.commit()
        result.update({"collected": True, "os_family": a.os_family,
                       "software": info.get("software")})
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        result["error"] = str(exc)[:300]
    return result


@router.post("/devices/{asset_id}/disconnect")
def disconnect_discovered_device(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Undo a device connection so a different login can be tried.

    Revokes ONLY what connecting this one device created: the host login scoped
    to its /32, and the IntegrationConnection keyed to its host. A fleet login
    (one that covers a whole subnet, or every host) is deliberately left alone —
    deleting it here would silently disconnect every other device it covers.

    Collected facts (OS, hardware, software, posture) are KEPT. They are a true
    record of what the machine reported at last_seen_at; a credential change is
    not a reason to destroy inventory. The device simply becomes connectable
    again so a new login can be applied.
    """
    tid = get_user_primary_tenant(current_user, db)
    a = db.query(ITAsset).filter(ITAsset.id == asset_id, ITAsset.tenant_id == tid).first()
    if not a:
        raise HTTPException(404, "Device not found")

    revoked_creds = 0
    if a.ip_address:
        host_cidr = f"{a.ip_address}/32"
        for prof in db.query(CredentialProfile).filter(
            CredentialProfile.tenant_id == tid,
            CredentialProfile.is_active.is_(True),
        ).all():
            # Exactly this device, and nothing else.
            if (prof.applies_to_cidrs or []) == [host_cidr]:
                prof.is_active = False
                revoked_creds += 1

    deactivated_conns = 0
    host = a.host_name or a.ip_address
    if host:
        for conn in db.query(IntegrationConnection).filter(
            IntegrationConnection.tenant_id == tid,
            IntegrationConnection.console_url == host,
            IntegrationConnection.integration_type.in_(("windows_winrm", "linux_ssh", "netdev_ssh")),
        ).all():
            conn.is_active = False
            conn.status = "disconnected"
            deactivated_conns += 1

    db.commit()
    return {
        "asset_id": asset_id,
        "revoked_credentials": revoked_creds,
        "deactivated_connections": deactivated_conns,
        "kept_profile": True,
    }


@router.get("/connect-progress")
def connect_progress(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Live progress of the credential sweep, so the operator can see whether
    their password is working instead of staring at an unchanged table.

    Returns the in-flight counters when a sweep is running, and the last
    sweep's result once it finishes. `running: false` with `total: 0` means no
    sweep has been started in this process.
    """
    tid = get_user_primary_tenant(current_user, db)
    with _SWEEP_LOCK:
        s = dict(_SWEEPS.get(tid) or {
            "running": False, "total": 0, "done": 0, "connected": 0,
            "rejected": 0, "unreachable": 0, "no_login": 0, "unknown_type": 0, "already": 0,
            "kind": None, "current": None,
            "started_at": None, "finished_at": None, "error": None,
        })
    s["percent"] = round(s["done"] / s["total"] * 100) if s.get("total") else 0
    return s


@router.post("/connect-all-discovered", status_code=202)
def connect_all_discovered(
    kind: Optional[str] = Query(
        None, description="Restrict to one credential type: 'winrm' tries Windows "
                          "devices only, 'ssh' tries Linux only. Omit to try both."),
    run_id: Optional[int] = Query(
        None, description="Scope the sweep to devices from this run. Omit for the "
                          "whole backlog. Matches the queue's run filter."),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Try the saved login(s) against the devices discovery found, and promote
    the ones that accept.

    Transport-matched by design: a WinRM credential is offered ONLY to devices
    whose sweep evidence says Windows, and an SSH credential only to Linux.
    Trying a Windows password against a Linux box cannot succeed, and a run of
    failed logins against a domain account is how you trip lockout policy.

    Devices that reject the login stay unclaimed with the reason recorded — they
    do NOT become empty inventory rows.
    """
    tid = get_user_primary_tenant(current_user, db)
    kinds = ("winrm", "ssh") if kind not in ("winrm", "ssh") else (kind,)
    has_cred = db.query(CredentialProfile.id).filter(
        CredentialProfile.tenant_id == tid,
        CredentialProfile.is_active.is_(True),
        CredentialProfile.kind.in_(kinds),
    ).first()
    if not has_cred:
        raise HTTPException(400, "No host login saved yet — add one first; it is tried on every discovered device.")

    from grc.modules.asset_discovery.services.deep_collect import transport_for_observation
    wanted = {"winrm": "windows", "ssh": "linux"}
    allowed_transports = {wanted[k] for k in kinds}

    _oq = db.query(DiscoveryObservation).filter(
        DiscoveryObservation.tenant_id == tid,
        DiscoveryObservation.resolution == "unclaimed",
    )
    if run_id is not None:
        _oq = _oq.filter(DiscoveryObservation.run_id == run_id)
    # Newest observation per host, so a host seen in two runs is tried once.
    obs_ids: List[int] = []
    _seen_hosts: set = set()
    for o in _oq.order_by(DiscoveryObservation.id.desc()).all():
        hkey = (o.host_name or "").lower() or (o.ip_address or f"obs-{o.id}")
        if hkey in _seen_hosts:
            continue
        _seen_hosts.add(hkey)
        t = transport_for_observation(o)
        if t in allowed_transports:
            obs_ids.append(o.id)
    if not obs_ids:
        return {"attempted": 0, "message": "No matching devices are waiting for this login."}
    tenant_engine = db.get_bind()

    def _connect_in_background() -> None:
        Sess = sessionmaker(bind=tenant_engine, expire_on_commit=False)
        wdb = Sess()
        try:
            from grc.modules.asset_discovery.services.deep_collect import (
                promote_observation, select_credential, transport_for_observation as _t,
                agentless_port_state as _port_state, classify_collect_error as _classify,
            )
            for oid in obs_ids:
                o = wdb.get(DiscoveryObservation, oid)
                if o is None or o.resolved_asset_id:
                    _sweep_update(tid, done=1, already=1)
                    continue
                _sweep_update(tid, current=(o.host_name or o.ip_address))
                # 1) What is it? Without a transport there is no right kind of
                #    credential to even try, and guessing one guarantees a
                #    failed login against the wrong protocol.
                transport = _t(o)
                if transport is None:
                    o.resolution_note = (
                        "type unknown: the sweep saw no Windows (445/3389) or "
                        "Linux (22) port, so no login type applies"
                    )
                    wdb.commit()
                    _sweep_update(tid, done=1, unknown_type=1)
                    continue
                # 2) Do we hold a login OF THAT KIND that covers this IP? This
                #    is a different answer from "the login was refused" and the
                #    operator needs to tell them apart: one means add a
                #    credential, the other means fix the one you have.
                # 3) Is the port the collector dials actually open? Skipping a
                #    host we KNOW is shut turns a 65-second timeout into an
                #    instant, correct answer.
                if _port_state(o, transport) == "closed":
                    svc = "WinRM (5985/5986)" if transport == "windows" else "SSH (22)"
                    o.resolution_note = (
                        f"{svc} is not open on {o.ip_address} — the host answered the "
                        f"sweep but the agentless service is disabled or firewalled. "
                        f"Enable it, or onboard this machine with an agent."
                    )
                    wdb.commit()
                    _sweep_update(tid, done=1, unreachable=1)
                    continue
                prof = select_credential(wdb, tid, o.ip_address, transport)
                if prof is None:
                    label = "Windows" if transport == "windows" else "Linux/SSH"
                    o.resolution_note = (
                        f"no {label} login saved that covers {o.ip_address} — "
                        f"add one under Connect → Add connection → Agentless"
                    )
                    wdb.commit()
                    _sweep_update(tid, done=1, no_login=1)
                    continue
                try:
                    promote_observation(wdb, o, prof, transport)
                    wdb.commit()
                    _sweep_update(tid, done=1, connected=1)
                except Exception as exc:  # noqa: BLE001 — a host that rejects the login is skipped
                    wdb.rollback()
                    # A timeout is NOT a refused password. Label them apart so
                    # the operator fixes the right thing.
                    cls = _classify(exc)
                    o2 = wdb.get(DiscoveryObservation, oid)
                    if o2 is not None:
                        if cls == "unreachable":
                            svc = "WinRM (5986)" if transport == "windows" else "SSH (22)"
                            o2.resolution_note = (
                                f"unreachable: could not open {svc} on {o.ip_address}. "
                                f"The login was never tested — the service is off or blocked."
                            )
                        elif cls == "auth":
                            o2.resolution_note = f"login failed: {str(exc)[:250]}"
                        else:
                            o2.resolution_note = f"collect error: {str(exc)[:250]}"
                        wdb.commit()
                    _sweep_update(tid, done=1,
                                  **({"unreachable": 1} if cls == "unreachable" else {"rejected": 1}))
            _sweep_finish(tid)
        except Exception as exc:  # noqa: BLE001
            logger.exception("connect-all-discovered worker failed for tenant %s", tid)
            # A worker that dies must say so — otherwise the UI spins forever.
            _sweep_finish(tid, error=str(exc)[:300])
        finally:
            wdb.close()

    _sweep_start(tid, len(obs_ids), kind if kind in ("winrm", "ssh") else None)

    threading.Thread(
        target=_connect_in_background, daemon=True, name=f"disc-connect-all-{tid}",
    ).start()
    scope = {"winrm": "Windows", "ssh": "Linux"}.get(kind or "", "")
    label = f"{scope} " if scope else ""
    return {
        "attempted": len(obs_ids),
        "message": f"Trying your login on {len(obs_ids)} discovered {label}device"
                   f"{'s' if len(obs_ids) != 1 else ''}… ones that accept it are "
                   f"scanned in depth and added to IT Asset Inventory.",
    }


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
        # Enforced at the API, not just hidden in the UI: adopting would create
        # an asset with no OS, no hardware and no software — precisely the empty
        # shells this pipeline was rebuilt to stop producing. A device earns an
        # inventory row by accepting a credential, nowhere else.
        raise HTTPException(
            400,
            "Devices are not adopted straight into inventory. Give this device a "
            "login under Connect → Add connection: if it authenticates, it is "
            "scanned in depth and added with its full profile. Use Merge if it is "
            "an asset you already track, or Ignore to dismiss it.",
        )

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
