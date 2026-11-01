"""Register-owned vulnerability scanning.

Scan ownership lives in the Vulnerability Register: an asset can be scanned with no
follow-on action (no pentest run, no exploit). This REUSES the pentest scan engine
seam verbatim — `service.assess()` (auto-routes lane + scanner + credential decision)
then `service.start_scan()` (find-only; run_id defaults to None) — which already
persists findings into the shared register tables (grc_vulnerabilities +
grc_vulnerability_asset_links, source 'ai-pentest:<tool>'). Nothing new scans here.

Two input modes, mirroring the old pentest launcher (NO manual lane pick — the lane is
auto-routed from the asset's type by assess()):
  * from-inventory  — POST /assets/{id}/scan
  * ad-hoc target   — POST /scan/adhoc  (reuses create_or_get_adhoc_target → same scan)

Plan/recon preview is a per-asset read (assess()), no run needed: GET /assets/{id}/scan-plan.
Poll progress via GET /scan-jobs/{job_id} or /assets/{asset_id}/scan-latest.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import get_db
from ....routers.auth_router import require_auth, get_user_tenants
from ...pentest import service
# Reuse the pentest scan RBAC (fail-open until pentest:* is seeded) — scanning is the
# same capability wherever it is triggered, so no new permission / migration is needed.
from ...pentest.router import _require_scan

router = APIRouter(tags=["Vulnerability Management"])


class AdhocScanIn(BaseModel):
    target: str                       # URL / host / IP / git repo URL (not in inventory)
    authorized: bool = False          # REQUIRED scope gate: operator confirms authorization
    allow_uncredentialed: bool = False
    coverage: str = "auto"
    lane: str | None = None           # operator's chosen engine lane (overrides assess() auto-route)
    find_mcp: str | None = None       # operator's chosen scanner within the lane (optional)
    credential_id: int | None = None  # saved credential to run the scan with (host/cloud/repo lanes)


def _launch_find_scan(db: Session, asset_id: int, user_tenants: list, *,
                      allow_uncredentialed: bool, coverage: str,
                      lane: str | None = None, find_mcp: str | None = None,
                      credential_id: int | None = None) -> dict:
    """Shared body for both scan modes: assess() (auto-route) → credential gate → start_scan()
    (find-only, run_id=None). The operator MAY override the engine: `lane` pins the engine lane and
    `find_mcp` the scanner within it; when neither is given the asset's assess() auto-route is used.
    Raises HTTPException (404/409/422) the router surfaces as-is. Returns the queued job."""
    coverage = (coverage or "auto").lower()
    if coverage not in service._COVERAGE_MODES:
        raise HTTPException(status_code=422,
                            detail=f"coverage must be one of {', '.join(service._COVERAGE_MODES)}.")
    result = service.assess(db, asset_id, user_tenants)
    if result is None:
        raise HTTPException(status_code=404, detail="asset not found")

    # Agent-managed hosts are reached THROUGH their installed agent (typically on a network the cloud
    # can't route to) — a remote scan can't reach them and just hangs. Their vulnerabilities come from
    # the agent's own telemetry, not a remote scan. Refuse the remote scan with a clear message.
    if service._is_agent_managed(db, asset_id, user_tenants):
        raise HTTPException(
            status_code=409,
            detail=("This asset is managed by an installed agent (reachable only via the agent). Its "
                    "vulnerabilities come from the agent's telemetry — a remote scan can't reach it, so "
                    "it was skipped."))

    creds = result["credentials"]
    routing = result["routing"]
    # Creds-required lane with none configured -> refuse by default (don't scan blind),
    # unless the operator explicitly opted into an uncredentialed run.
    if creds["action"] == "prompt" and creds["mode"] == "required" and not allow_uncredentialed:
        lane_lbl = routing.get("lane_label") or routing.get("lane") or "this"
        raise HTTPException(
            status_code=409,
            detail=(f"The {lane_lbl} lane requires credentials and none are configured for this "
                    f"asset. Add a credential profile, or re-run with allow_uncredentialed=true."))

    lane_key = routing.get("lane")                   # assess() auto-routed lane (default)
    chosen = routing.get("selected_find")            # auto-routed scanner for that lane (default)
    if lane:
        # Operator picked the engine lane explicitly -> honour it: use the chosen scanner within that
        # lane (find_mcp if valid for the lane, else the lane's first find tool), and scan in that lane.
        lane_key = lane
        lane_finds = [t.get("id") for l in service.get_fleet().get("lanes", [])
                      if l.get("key") == lane_key for t in (l.get("find") or [])]
        chosen = find_mcp if (find_mcp and find_mcp in lane_finds) else (lane_finds[0] if lane_finds else chosen)
    elif find_mcp:
        chosen = find_mcp                            # explicit scanner, asset's auto-routed lane
    if coverage in ("nessus", "openvas"):            # CONTRACT C force pins the internal scanner
        chosen = coverage
    if not chosen:
        raise HTTPException(
            status_code=422,
            detail=f"No find scanner is available for this asset. {routing.get('reason') or ''}".strip())

    asset = result["asset"]
    target = asset.get("ip") or asset.get("hostname") or asset.get("name")
    if not target:
        raise HTTPException(status_code=422, detail="Asset has no IP or hostname to scan.")

    # An operator-attached credential makes the scan credentialed regardless of the asset's
    # auto-detected profile; otherwise fall back to the assess() credential decision.
    cred_available = bool(credential_id) or bool(creds.get("have_profile")) or creds.get("action") in ("reuse", "available")
    return service.start_scan(
        db, tenant_id=user_tenants[0], asset_id=asset_id, target=target,
        lane=lane_key, find_mcp=chosen,
        credentialed=cred_available and not allow_uncredentialed,
        coverage=coverage, credential_id=credential_id,
        # run_id defaults to None -> find-only, no exploit (register-owned scan).
    )


@router.post("/assets/{asset_id}/scan", dependencies=[Depends(_require_scan)])
def scan_register_asset(
    asset_id: int,
    allow_uncredentialed: bool = False,  # opt-in: scan WITHOUT creds on a creds-required lane
    coverage: str = "auto",              # auto | all | nessus | openvas (passthrough to engine)
    lane: Optional[str] = None,          # operator's chosen engine lane (else assess() auto-route)
    find_mcp: Optional[str] = None,      # operator's chosen scanner within the lane (optional)
    credential_id: Optional[int] = None, # saved credential to scan with (host/cloud/repo lanes)
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Launch a LIVE find-scan of ONE inventory asset FROM the register. The engine lane is the
    operator's `lane`/`find_mcp` when given, else auto-routed by assess(). Findings land in the
    register; this does NOT create a pentest run."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="asset not found")
    return _launch_find_scan(db, asset_id, user_tenants,
                             allow_uncredentialed=allow_uncredentialed, coverage=coverage,
                             lane=lane, find_mcp=find_mcp, credential_id=credential_id)


@router.post("/scan/adhoc", dependencies=[Depends(_require_scan)])
def scan_register_adhoc(
    body: AdhocScanIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Scan an AD-HOC target (not in inventory) from the register. Reuses the pentest engine's
    create_or_get_adhoc_target (transient tagged ITAsset: status='adhoc' / source='pentest-adhoc'),
    then the SAME auto-routed assess()+start_scan path. Ad-hoc findings are stored & viewable in the
    register but EXCLUDED from the inventory-only dashboard rollup (exclude_adhoc). `authorized` is a
    required scope gate. Returns {job_id, status, asset_id, adhoc:true}."""
    if not body.authorized:
        raise HTTPException(status_code=400,
                            detail="Confirm you are authorized to test this target before scanning it.")
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="no tenant")
    try:
        asset = service.create_or_get_adhoc_target(db, user_tenants[0], body.target)
    except ValueError as e:  # empty / loopback / unparseable target
        raise HTTPException(status_code=400, detail=str(e))
    res = _launch_find_scan(db, asset.id, user_tenants,
                            allow_uncredentialed=body.allow_uncredentialed, coverage=body.coverage,
                            lane=body.lane, find_mcp=body.find_mcp, credential_id=body.credential_id)
    return {**res, "asset_id": asset.id, "adhoc": True}


@router.get("/assets/{asset_id}/scan-plan")
def scan_plan(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Plan / recon preview for ONE asset — the auto-routed lane, selected scanner and credential
    decision, plus the asset's current findings/exploitability. Pure read (assess()), NO run, NO
    scan. This is what the register's plan+scan screen shows before launching a scan."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="asset not found")
    result = service.assess(db, asset_id, user_tenants)
    if result is None:
        raise HTTPException(status_code=404, detail="asset not found")
    return result


@router.get("/scan-jobs")
def register_scan_jobs(
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """List recent scan sessions (newest-first, inventory + ad-hoc) for the register's Scan page.
    Reuses grc_pentest_scan_jobs + ITAsset; no new table. Each row:
    {job_id, asset_id, asset_name, target, adhoc, lane, find_mcp, status, progress,
     findings_count, created_at, started_at, finished_at}."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"jobs": []}
    return {"jobs": service.list_scan_jobs(db, user_tenants, limit=limit)}


@router.get("/scan-jobs/{job_id}")
def register_scan_status(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Poll a register scan job: status/progress/stage/findings_count/error, tenant-scoped."""
    user_tenants = get_user_tenants(current_user, db)
    job = service.get_scan_job(db, job_id, user_tenants) if user_tenants else None
    if job is None:
        raise HTTPException(status_code=404, detail="scan job not found")
    return job


@router.delete("/scan-jobs/{job_id}", dependencies=[Depends(_require_scan)])
def register_scan_delete(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Delete a scan SESSION (history row) from the register's Scan page. Removes only the scan-job
    record; the findings it produced stay in the register (manage those there). Refuses a scan that
    is still running (409)."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="scan job not found")
    outcome = service.delete_scan_job(db, job_id, user_tenants)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="scan job not found")
    if outcome == "running":
        raise HTTPException(status_code=409,
                            detail="This scan is still running — stop it first, then delete it.")
    return {"deleted": True, "job_id": job_id}


@router.post("/scan-jobs/{job_id}/cancel", dependencies=[Depends(_require_scan)])
def register_scan_cancel(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Stop a queued/running scan SESSION. Marks it 'cancelled' so a stuck/frozen 'running' row
    clears and becomes deletable; findings already written to the register are kept."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="scan job not found")
    outcome = service.cancel_scan_job(db, job_id, user_tenants)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="scan job not found")
    if outcome == "not_running":
        raise HTTPException(status_code=409, detail="This scan has already finished.")
    return {"cancelled": True, "job_id": job_id}


class MatchedCredsIn(BaseModel):
    asset_ids: list[int]


@router.post("/assets/matched-credentials")
def assets_matched_credentials(
    body: MatchedCredsIn,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """Per-asset CIDR-matched credential for the launcher's inventory rows: {str(asset_id): {cred_id,
    cred_name, cred_kind, cred_username}}. Each host shows its OWN linked login inline with a per-asset
    toggle instead of one global dropdown — scales to many assets, each scanned with its own credential."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {}
    return service.matched_credentials_for_assets(db, body.asset_ids, user_tenants)


@router.get("/assets/{asset_id}/scan-latest")
def register_scan_latest(
    asset_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_auth),
):
    """The asset's most-recent scan job, so the register can reconcile its scan bar to the
    backend's authoritative state on load. {status:'none'} when the asset was never scanned."""
    user_tenants = get_user_tenants(current_user, db)
    job = service.get_latest_scan_job(db, asset_id, user_tenants) if user_tenants else None
    return job or {"status": "none", "asset_id": asset_id}
