"""Discovery execution — turn a campaign's scopes into a run, jobs, and
observations.

This is the worker the foundation was built for. It reuses the existing
per-host probe primitive (modules/onboarding.service._probe_one) — the actual,
already-shipping network touch — and wraps it in discovery-specific
orchestration: one job per scope, exclusion-aware target expansion, and a write
of one DiscoveryObservation per reachable host.

Two invariants it must never break:
  1. It writes ONLY to the discovery tables. It never touches grc_it_assets —
     every observation lands with resolution='pending' and waits for the
     identity resolver. That is what makes running scans safe today.
  2. Excluded ranges are removed from the target set BEFORE probing, not
     filtered out of the results afterwards. An excluded host is never touched.

Threading: probes run in a ThreadPoolExecutor (network I/O), but every DB write
happens on the caller's session in the main thread — the Session is not
thread-safe, so threads only ever return plain dicts.

Execution is synchronous today, matching the existing /onboarding/discover
endpoint. `start_run` is written so the scheduling increment can call it
unchanged from a Celery task.
"""
from __future__ import annotations

import ipaddress
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from grc.models import (
    DiscoveryCampaign, DiscoveryScope, DiscoveryRun, DiscoveryJob, DiscoveryObservation,
)
from grc.modules.onboarding.service import _probe_one, MAX_HOSTS

logger = logging.getLogger(__name__)

# "Is this host up?" — probe a small set of ports that cover the common cases
# (SMB/Windows, SSH/Linux, RDP). A host answering ANY of them is recorded. This
# is host-presence discovery, not a service scan; deep fingerprinting is a later
# authenticated step.
# 5985/5986 are WinRM (HTTP/HTTPS) — the port the agentless Windows collector
# actually dials. Without probing them, a host that answers on 445 looks
# "Windows, ready to connect", the collector then waits out a 65s connect
# timeout on 5986, and the failure gets reported as a refused login. Knowing up
# front whether WinRM is listening is the difference between "your password is
# wrong" and "WinRM is not enabled on this machine" — completely different fixes.
NETWORK_SWEEP_PORTS: tuple = (445, 22, 3389, 5985, 5986)
# Ports that mean "an agentless credential can actually be used here".
WINRM_PORTS = (5985, 5986)
SSH_PORT = 22

# Type of the injectable probe: (ip, port, timeout_s) -> result dict with a
# 'status' of 'reachable'|'unreachable' and optional 'hostname'/'rtt_ms'.
ProbeFn = Callable[[str, int, float], Dict[str, Any]]


def is_in_blackout(campaign: DiscoveryCampaign, now: datetime) -> bool:
    """Is `now` inside one of the campaign's blackout windows?

    Windows are [{ "days": [0-6 Mon..Sun], "start": "HH:MM", "end": "HH:MM" }].
    A window with start > end crosses midnight (e.g. 22:00–06:00). Scheduled runs
    must not start during a blackout — a change freeze or end-of-day batch is
    exactly when a scan must stay off the network. Malformed windows are ignored
    (fail-open on the individual window, not the whole check) rather than
    crashing a scheduler tick.
    """
    windows = campaign.blackout_windows or []
    if not isinstance(windows, list):
        return False
    wd = now.weekday()
    cur = now.hour * 60 + now.minute
    for w in windows:
        try:
            days = w.get("days")
            if days and wd not in days:
                continue
            sh, sm = (int(x) for x in str(w["start"]).split(":"))
            eh, em = (int(x) for x in str(w["end"]).split(":"))
            start, end = sh * 60 + sm, eh * 60 + em
        except Exception:
            continue
        if start == end:
            continue
        inside = (start <= cur < end) if start < end else (cur >= start or cur < end)
        if inside:
            return True
    return False


def _ips_for_scope(scope: DiscoveryScope) -> Set[str]:
    """Expand one scope to a set of IP strings. Unsupported kinds (ad_ou) return
    empty — AD enumeration needs a stored credential and lands with that work."""
    if scope.kind == "cidr":
        net = ipaddress.ip_network(scope.value, strict=False)
        hosts = list(net.hosts()) if net.num_addresses > 2 else list(net)
        return {str(h) for h in hosts}
    if scope.kind == "ip_range":
        start_s, _, end_s = scope.value.partition("-")
        start = ipaddress.ip_address(start_s.strip())
        end = ipaddress.ip_address(end_s.strip())
        if int(end) < int(start):
            start, end = end, start
        return {str(ipaddress.ip_address(i)) for i in range(int(start), int(end) + 1)}
    return set()


def _targets_for_job(job_scope: DiscoveryScope, exclusions: Set[str]) -> List[str]:
    """The include scope's IPs minus every excluded IP. Sorted for deterministic
    ordering (tests, and stable observation order)."""
    return sorted(_ips_for_scope(job_scope) - exclusions,
                  key=lambda ip: int(ipaddress.ip_address(ip)))


def _sweep_host(ip: str, probe: ProbeFn, timeout_s: float) -> Optional[Dict[str, Any]]:
    """Probe one host across the port set. Returns a compact evidence dict if the
    host answered on any port, else None. Never raises — a probe failure is just
    'not reachable'."""
    open_ports: List[int] = []
    hostname = None
    rtt = None
    for port in NETWORK_SWEEP_PORTS:
        try:
            res = probe(ip, port, timeout_s)
        except Exception:  # noqa: BLE001 — a probe error is a non-answer
            continue
        if res.get("status") == "reachable":
            open_ports.append(port)
            hostname = hostname or res.get("hostname")
            rtt = rtt if rtt is not None else res.get("rtt_ms")
    if not open_ports:
        return None
    return {"ip": ip, "hostname": hostname, "open_ports": open_ports, "rtt_ms": rtt}


def _sweep_targets(
    targets: List[str], *, probe: ProbeFn, timeout_s: float, max_workers: int,
    rate_limit_per_min: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Probe a list of hosts concurrently and return the reachable ones.

    When rate_limit_per_min is set the hosts are processed in per-minute batches
    of that size — never more than N hosts touched in any rolling minute. In a
    bank's network an unthrottled sweep is a career-limiting incident, so this
    is a hard cap, not a hint. Unlimited (None/<=0) keeps the fast path."""
    findings: List[Dict[str, Any]] = []
    if not targets:
        return findings

    def _probe_batch(batch: List[str]) -> None:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futs = {pool.submit(_sweep_host, ip, probe, timeout_s): ip for ip in batch}
            for fut in as_completed(futs):
                res = fut.result()
                if res:
                    findings.append(res)

    if not rate_limit_per_min or rate_limit_per_min <= 0:
        _probe_batch(targets)
        return findings

    import time
    for i in range(0, len(targets), rate_limit_per_min):
        batch = targets[i:i + rate_limit_per_min]
        started = time.monotonic()
        _probe_batch(batch)
        # Hold the minute open if this batch finished early and more remain, so
        # the throughput never exceeds rate_limit_per_min hosts/minute.
        if i + rate_limit_per_min < len(targets):
            elapsed = time.monotonic() - started
            if elapsed < 60.0:
                time.sleep(60.0 - elapsed)
    return findings


def _run_job(
    db: Session, run: DiscoveryRun, job: DiscoveryJob, scope: DiscoveryScope,
    exclusions: Set[str], *, probe: ProbeFn, timeout_s: float, max_workers: int,
    rate_limit_per_min: Optional[int] = None,
) -> int:
    """Probe one job's targets and write an observation per reachable host.
    Returns the number of hosts seen. Raises on a target set that's too large so
    the caller can mark the job failed with a real cause."""
    job.status = "running"
    job.started_at = datetime.utcnow()
    job.attempts = (job.attempts or 0) + 1
    db.flush()

    targets = _targets_for_job(scope, exclusions)
    if len(targets) > MAX_HOSTS:
        raise ValueError(
            f"scope {scope.value!r} expands to {len(targets)} hosts; "
            f"max {MAX_HOSTS} per job"
        )

    findings = _sweep_targets(
        targets, probe=probe, timeout_s=timeout_s, max_workers=max_workers,
        rate_limit_per_min=rate_limit_per_min,
    )

    findings.sort(key=lambda f: int(ipaddress.ip_address(f["ip"])))
    now = datetime.utcnow()
    for f in findings:
        db.add(DiscoveryObservation(
            tenant_id=run.tenant_id, run_id=run.id, job_id=job.id,
            source="cidr", observed_at=now,
            host_name=f.get("hostname"), ip_address=f["ip"],
            # probed_ports records what this sweep actually checked, so a later
            # step can tell "WinRM was closed" from "we never looked". Without
            # it, observations written by an older build would be wrongly read
            # as proof that WinRM is disabled.
            raw={"open_ports": f["open_ports"], "rtt_ms": f.get("rtt_ms"),
                 "scope": scope.value, "probed_ports": list(NETWORK_SWEEP_PORTS)},
            resolution="pending",
        ))

    job.hosts_seen = len(findings)
    job.status = "succeeded"
    job.finished_at = datetime.utcnow()
    db.flush()
    return len(findings)


def create_run(
    db: Session, campaign: DiscoveryCampaign, *, trigger: str = "manual", user=None,
) -> DiscoveryRun:
    """Create and commit a run in 'queued' status, so the caller has an id to
    poll before any scanning starts. The request handler calls this, then hands
    the run id to a background worker which calls execute_run."""
    run = DiscoveryRun(
        tenant_id=campaign.tenant_id, campaign_id=campaign.id,
        trigger=trigger, status="queued",
        created_by_id=getattr(user, "id", None),
        created_by_name=(getattr(user, "display_name", None)
                         or getattr(user, "username", None)) if user else None,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def execute_run(
    db: Session,
    run_id: int,
    *,
    probe: Optional[ProbeFn] = None,
    timeout_s: float = 1.0,
    max_workers: int = 32,
) -> DiscoveryRun:
    """Execute a previously-created run: a job per include scope, probe each,
    record observations, transition status. Safe to call from a background
    thread or a scheduled task — it takes a run_id and owns its own session's
    transaction. `probe` is injectable (resolved at call time) so tests drive it
    without touching a real network.

    Returns the finished DiscoveryRun (committed). Never writes to grc_it_assets.
    """
    if probe is None:
        probe = _probe_one

    run = db.get(DiscoveryRun, run_id)
    if run is None:
        raise ValueError(f"discovery run {run_id} not found")
    campaign = db.get(DiscoveryCampaign, run.campaign_id)
    if campaign is None:
        raise ValueError(f"campaign {run.campaign_id} for run {run_id} not found")

    run.status = "running"
    run.started_at = datetime.utcnow()
    db.commit()

    include_scopes = [s for s in campaign.scopes if not s.exclude]
    rate_limit = campaign.rate_limit_hosts_per_min
    exclusions: Set[str] = set()
    for s in campaign.scopes:
        if s.exclude:
            try:
                exclusions |= _ips_for_scope(s)
            except ValueError:
                logger.warning("discovery: skipping unparseable exclusion %r", s.value)

    total_hosts = 0
    total_obs = 0
    errors: List[str] = []

    for scope in include_scopes:
        # ad_ou scopes are accepted by config but have no network executor yet.
        kind = "ad_enum" if scope.kind == "ad_ou" else "cidr_sweep"
        job = DiscoveryJob(
            tenant_id=run.tenant_id, run_id=run.id, kind=kind,
            target=scope.value, status="queued",
        )
        # Commit the job row BEFORE running it, so a failure inside the job's
        # savepoint can roll back that job's observations without also erasing
        # the job row itself (or any earlier job's committed findings).
        db.add(job)
        db.commit()

        if kind == "ad_enum":
            job.status = "failed"
            job.error = "AD enumeration needs a stored credential (not built yet)."
            job.finished_at = datetime.utcnow()
            db.commit()
            errors.append(f"{scope.value}: AD not supported yet")
            continue

        try:
            # Savepoint per job: a failure here rolls back ONLY this job's
            # half-written observations, never a sibling job's. Before this the
            # whole-session rollback wiped every earlier job in the run.
            with db.begin_nested():
                seen = _run_job(db, run, job, scope, exclusions,
                                probe=probe, timeout_s=timeout_s, max_workers=max_workers,
                                rate_limit_per_min=rate_limit)
            db.commit()  # release the savepoint's work to the run
            total_hosts += seen
            # observations for this job = its findings (host_seen == obs written)
            total_obs += seen
        except Exception as exc:  # noqa: BLE001
            db.rollback()  # unwind the failed savepoint; the job row survives
            job = db.get(DiscoveryJob, job.id)
            if job:
                job.status = "failed"
                job.error = str(exc)
                job.finished_at = datetime.utcnow()
                db.commit()
            errors.append(f"{scope.value}: {exc}")
            logger.exception("discovery job failed: campaign=%s scope=%s",
                             campaign.id, scope.value)

    # Re-load counters that a mid-loop rollback may have expired.
    run = db.get(DiscoveryRun, run.id)
    run.hosts_seen = total_hosts
    run.observations = total_obs
    run.finished_at = datetime.utcnow()
    # Honest status: failed only if NOTHING succeeded; otherwise succeeded with
    # per-job errors recorded on the job rows and summarised here.
    any_ok = any(j.status == "succeeded" for j in run.jobs)
    if errors and not any_ok:
        run.status = "failed"
    else:
        run.status = "succeeded"
    if errors:
        run.error = "; ".join(errors)[:2000]

    # Keep the campaign's last-run marker current so the scheduler can compute
    # the next due time.
    campaign = db.get(DiscoveryCampaign, campaign.id)
    campaign.last_run_at = run.finished_at

    db.commit()

    # Resolve this run's observations into assets: confident matches auto-merge,
    # unknown hosts auto-create as 'discovered', ambiguous go to the review
    # queue. This is the deliberate, separate step that is allowed to write
    # grc_it_assets — the sweep above never does. Kept inside execute_run so a
    # scan produces inventory in one pass; a resolver failure must not fail the
    # run (the observations survive and can be resolved later from the inbox).
    try:
        from .resolver import resolve_run
        resolve_run(db, run.id)
    except Exception:
        logger.exception("discovery: auto-resolve failed for run %s", run.id)

    # Deep-collect: for each host we just resolved, if a stored credential covers
    # it, authenticate and pull OS / software / antivirus so a network-discovered
    # box is fully profiled, not just "seen". No-op when no credentials exist, so
    # this adds nothing for tenants that haven't opted in. Best-effort — a failed
    # login must never fail the run.
    try:
        from .deep_collect import deep_collect_run
        deep_collect_run(db, run.id)
    except Exception:
        logger.exception("discovery: deep-collect failed for run %s", run.id)

    db.refresh(run)
    return run


def start_run(
    db: Session,
    campaign: DiscoveryCampaign,
    *,
    trigger: str = "manual",
    user=None,
    probe: Optional[ProbeFn] = None,
    timeout_s: float = 1.0,
    max_workers: int = 32,
) -> DiscoveryRun:
    """Synchronous create-then-execute. Used by scheduled tasks (which are
    already off the request path) and by tests that want a deterministic,
    fully-finished run in one call. The interactive endpoint does NOT use this —
    it calls create_run then runs execute_run on a background thread."""
    run = create_run(db, campaign, trigger=trigger, user=user)
    return execute_run(db, run.id, probe=probe, timeout_s=timeout_s, max_workers=max_workers)
