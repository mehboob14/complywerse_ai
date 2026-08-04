"""Job pull / execute / push results loop — the agent's brain.

Each tick:
  1. Heartbeat the cloud so it knows we're alive.
  2. GET /agents/jobs to pull queued check tasks.
  3. For each job, pick the right local executor:
       - runner_type=windows_winrm + mode=endpoint  → local_windows.run_local_check
       - runner_type=linux_ssh + mode=endpoint      → local_linux.run_local_check (TODO)
       - runner_type=netdev_ssh / linux_ssh + mode=collector → collector_ssh.run_ssh_check
       - runner_type=oracle_sql / vmware_vcenter (TODO collector implementations)
  4. POST /agents/results with the batch of outcomes.

We deliberately keep this thin — the executors do the actual work. This
file is just the orchestration / batching / error-handling glue.
"""
from __future__ import annotations

import logging
import platform
import socket
import time
from datetime import datetime
from typing import Any

from . import vault
from . import collector_ssh
from . import local_windows
from .config import (
    HEARTBEAT_INTERVAL_DEFAULT_SEC,
    JOB_PULL_TIMEOUT_SEC,
    RESULT_PUSH_TIMEOUT_SEC,
    load_config,
)
from .transport import TransportError, get, post

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def heartbeat() -> dict:
    """Tell the cloud we're alive. Returns the heartbeat response (which
    may include an updated interval the cloud wants us to use)."""
    cfg = load_config()
    api_token = vault.get_api_token()
    if not api_token:
        raise RuntimeError("agent not enrolled — run `complyverse_agent enroll ...` first")

    body = {
        "hostname": socket.gethostname(),
        "agent_version": "1.0.0",
        "ip_address": _local_ip(),
    }
    return post(
        f"{cfg['backend_url']}/grc/agents/heartbeat",
        body=body, token=api_token, timeout=JOB_PULL_TIMEOUT_SEC,
    )


def _local_ip() -> str | None:
    """Best-effort local IP. None on failure — agent isn't required to know."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return None


def fetch_jobs(limit: int = 50) -> list[dict]:
    """Pull queued check tasks from the cloud."""
    cfg = load_config()
    api_token = vault.get_api_token()
    response = get(
        f"{cfg['backend_url']}/grc/agents/jobs?limit={limit}",
        token=api_token, timeout=JOB_PULL_TIMEOUT_SEC,
    )
    return response.get("jobs", [])


def fetch_collector_creds() -> int:
    """Scenario B: pull cloud-supplied credentials into the agent's vault.

    The cloud has the bank's SSH / Oracle / vCenter creds (entered by the
    operator via the Integrations page, encrypted at rest with Fernet).
    Collector-mode agents pull them here so they can scan remote devices.

    Endpoint-mode agents skip this — they only need their own host's creds
    (i.e. nothing, because local execution doesn't need network creds).

    Returns the number of credential entries refreshed.
    """
    cfg = load_config()
    api_token = vault.get_api_token()
    try:
        response = get(
            f"{cfg['backend_url']}/grc/agents/fetch-creds",
            token=api_token, timeout=JOB_PULL_TIMEOUT_SEC,
        )
    except TransportError as e:
        # 400 = endpoint mode agent, harmless; 401 = revoked; everything
        # else is a transient cloud issue. Log + carry on, never crash.
        if e.status == 400:
            return 0
        raise

    creds_by_asset = response.get("credentials") or {}
    refreshed = 0
    for asset_id_str, cred in creds_by_asset.items():
        try:
            asset_id = int(asset_id_str)
        except (TypeError, ValueError):
            continue
        # Re-encrypt locally with our DPAPI/Fernet — server-supplied creds
        # never sit in plaintext on disk.
        vault.set_collector_cred(asset_id, cred)
        refreshed += 1
    return refreshed


def execute_job(job: dict) -> dict:
    """Run one job and return a result dict ready for /agents/results.

    Routes to the right executor based on runner_type and the agent's mode.
    Falls back to an error result for runner_types we don't yet implement
    locally (so the cloud sees explicit "not supported by this agent"
    instead of silent drops).
    """
    started = _now_iso()
    runner_type = job.get("runner_type")
    check_def = job.get("check_definition") or {}
    plugin_id = job.get("plugin_id")
    asset_id = job.get("asset_id")

    t0 = time.monotonic()
    try:
        if runner_type == "windows_winrm":
            # Endpoint mode — execute locally against this Windows host
            r = local_windows.run_local_check(check_def)
            status, summary = r.status, r.summary
            raw_output, error_message = r.raw_output, r.error_message
        elif runner_type in ("linux_ssh", "netdev_ssh"):
            # Collector mode — need SSH creds for the target asset from the vault
            creds = vault.get_collector_cred(asset_id) if asset_id else None
            if not creds:
                status, summary = "error", f"No SSH credentials in agent vault for asset_id={asset_id}"
                raw_output, error_message = {}, "missing_collector_cred"
            else:
                r = collector_ssh.run_ssh_check(check_def, creds)
                status, summary = r.status, r.summary
                raw_output, error_message = r.raw_output, r.error_message
        else:
            # oracle_sql, vmware_vcenter, aws_readonly — agent-side
            # implementations land in a later sub-phase. For now we emit
            # a clear "skipped" so the cloud knows we received the job
            # but didn't execute (vs silently dropping it).
            status = "error"
            summary = f"Runner type {runner_type!r} not implemented in this agent build"
            raw_output, error_message = {}, "runner_not_implemented_on_agent"
    except Exception as e:  # noqa: BLE001
        status, summary = "error", f"Agent crashed executing job: {e}"
        raw_output, error_message = {}, str(e)

    duration_ms = int((time.monotonic() - t0) * 1000)
    return {
        "plugin_id": plugin_id,
        "plugin_key": job.get("plugin_key"),
        "asset_id": asset_id,
        "status": status,
        "started_at": started,
        "completed_at": _now_iso(),
        "duration_ms": duration_ms,
        "result_summary": summary,
        "raw_output": raw_output,
        "error_message": error_message,
    }


def push_results(runs: list[dict]) -> dict:
    """Upload a batch of results to the cloud."""
    if not runs:
        return {"inserted": 0, "skipped": 0}
    cfg = load_config()
    api_token = vault.get_api_token()
    return post(
        f"{cfg['backend_url']}/grc/agents/results",
        body={"runs": runs}, token=api_token, timeout=RESULT_PUSH_TIMEOUT_SEC,
    )


def tick() -> dict:
    """One iteration of the agent loop. Returns a small status dict for the
    CLI / service log so the operator can see what's happening."""
    summary = {"heartbeat_ok": False, "creds_refreshed": 0,
               "jobs_pulled": 0, "results_pushed": 0, "errors": []}
    try:
        hb = heartbeat()
        summary["heartbeat_ok"] = True
        summary["interval"] = hb.get("heartbeat_interval_sec", HEARTBEAT_INTERVAL_DEFAULT_SEC)
    except TransportError as e:
        summary["errors"].append(f"heartbeat: {e}")
        return summary

    # Scenario B: refresh cloud-supplied collector credentials.
    # Endpoint agents get back 400 here and we no-op. Collector agents
    # refresh their vault from cloud — bank's IT team enters creds in
    # the Integrations page, agent pulls them on each tick.
    try:
        summary["creds_refreshed"] = fetch_collector_creds()
    except TransportError as e:
        summary["errors"].append(f"fetch_creds: {e}")

    try:
        jobs = fetch_jobs(limit=50)
        summary["jobs_pulled"] = len(jobs)
    except TransportError as e:
        summary["errors"].append(f"fetch_jobs: {e}")
        return summary

    if jobs:
        results = [execute_job(j) for j in jobs]
        try:
            push = push_results(results)
            summary["results_pushed"] = push.get("inserted", 0)
        except TransportError as e:
            summary["errors"].append(f"push_results: {e}")

    return summary


def run_loop(
    once: bool = False,
    interval_sec: int = HEARTBEAT_INTERVAL_DEFAULT_SEC,
    stop_event=None,
) -> None:
    """Main agent loop. Called from CLI and from the Windows Service wrapper.

    Args:
        once: run a single tick and return (for testing / debugging).
        interval_sec: sleep between ticks. Default 30s.
        stop_event: optional ``threading.Event`` the service wrapper
            flips on SvcStop. When set we exit at the next loop check —
            without it, ``service stop`` had to wait up to ``interval_sec``
            (typically 30s) before the loop noticed shutdown, which is
            long enough for Windows SCM to give up and kill us.
    """
    while True:
        out = tick()
        logger.info("agent.tick %s", out)
        # Echo to stdout for foreground / debug runs
        print(f"[{_now_iso()}] tick: heartbeat={out['heartbeat_ok']} "
              f"jobs={out['jobs_pulled']} pushed={out['results_pushed']} "
              f"errors={out['errors'] or 'none'}")
        if once:
            return
        if stop_event is not None:
            # Interruptible sleep — wakes immediately on shutdown signal.
            if stop_event.wait(interval_sec):
                logger.info("run_loop: stop_event set, exiting cleanly")
                return
        else:
            time.sleep(interval_sec)
