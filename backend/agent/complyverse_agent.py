#!/usr/bin/env python3
"""Compliverse Compliance Agent — minimal collector reference.

This is the agent binary that runs on the customer's host. In production
this would be a packaged .msi / .deb / .rpm with auto-update and a
signed certificate. For dev / proof-of-concept this is a single Python
script.

Lifecycle:
  python complyverse_agent.py enroll --backend URL --token ENROLL_TOKEN
        → POSTs /agents/enroll, stores api_token in ~/.complyverse_agent
  python complyverse_agent.py run
        → on a 30s loop:
           - POSTs /agents/heartbeat
           - (if jobs queued, would fetch + execute — TODO: job queue)
           - POSTs /agents/results (currently scans the local machine
             using stub checks; production runs the real CIS rule
             check_definition over WinRM/SSH like the backend does)

For real CIS work the agent would import the same runner code used
server-side (grc.modules.compliance_plugins.runners). For this PoC we
ship a small set of hand-written local checks so the loop can be
demonstrated end-to-end without a full runner port.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CONFIG_PATH = Path.home() / ".complyverse_agent"


def _post(url: str, body: dict, token: str | None = None) -> tuple[int, dict]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            body_text = e.read().decode()
        except Exception:
            body_text = ""
        return e.code, {"detail": body_text}


def _save_config(cfg: dict) -> None:
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    try:
        # Best-effort chmod 600 on POSIX; harmless on Windows
        os.chmod(CONFIG_PATH, 0o600)
    except Exception:
        pass


def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    return json.loads(CONFIG_PATH.read_text())


def cmd_enroll(backend: str, token: str) -> None:
    """One-time enrollment. Trades enroll_token for long-lived api_token."""
    os_family = platform.system().lower()
    hostname = socket.gethostname()
    try:
        ip = socket.gethostbyname(hostname)
    except Exception:
        ip = None
    body = {
        "enrollment_token": token,
        "hostname": hostname,
        "os_family": os_family if os_family in ("windows", "linux", "darwin") else "linux",
        "agent_version": "0.1.0-poc",
        "ip_address": ip,
    }
    status, data = _post(f"{backend.rstrip('/')}/grc/agents/enroll", body)
    if status != 200:
        print(f"Enrollment failed: HTTP {status} — {data.get('detail', data)}")
        sys.exit(1)
    cfg = {
        "backend_url": backend.rstrip("/"),
        "agent_id": data["agent_id"],
        "api_token": data["api_token"],
        "heartbeat_interval_sec": data.get("heartbeat_interval_sec", 30),
        "hostname": hostname,
    }
    _save_config(cfg)
    print(f"Enrolled successfully. agent_id={cfg['agent_id']}")
    print(f"Config saved to {CONFIG_PATH}")


def heartbeat(cfg: dict) -> None:
    body = {
        "hostname": cfg.get("hostname"),
        "agent_version": "0.1.0-poc",
    }
    status, data = _post(
        f"{cfg['backend_url']}/grc/agents/heartbeat", body, token=cfg["api_token"],
    )
    if status != 200:
        print(f"Heartbeat failed: HTTP {status} — {data}")
    else:
        print(f"Heartbeat OK (agent_id={data.get('agent_id')})")


def run_local_checks() -> list[dict]:
    """Stub: returns a few synthetic check results.

    Production: would import or re-implement check_definition execution
    (registry reads, secedit/export, Get-Service, etc.) like the backend
    runners do, but locally. For the PoC we emit 3 synthetic outcomes so
    the loop can be demonstrated and the server's intake path verified.
    """
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    return [
        {
            "plugin_key": "agent_poc_check_passed",
            "status": "passed",
            "started_at": now,
            "completed_at": now,
            "duration_ms": 12,
            "result_summary": "Local check OK (agent stub)",
        },
        {
            "plugin_key": "agent_poc_check_failed",
            "status": "failed",
            "started_at": now,
            "completed_at": now,
            "duration_ms": 18,
            "result_summary": "Synthetic failure for end-to-end test",
        },
    ]


def push_results(cfg: dict) -> None:
    runs = run_local_checks()
    body = {"runs": runs}
    status, data = _post(
        f"{cfg['backend_url']}/grc/agents/results", body, token=cfg["api_token"],
    )
    if status != 200:
        print(f"Results push failed: HTTP {status} — {data}")
    else:
        print(f"Pushed {len(runs)} results -> inserted={data.get('inserted')} skipped={data.get('skipped')}")


def cmd_run(once: bool) -> None:
    cfg = _load_config()
    if not cfg.get("api_token"):
        print("Not enrolled yet. Run `agent enroll --backend ... --token ...` first.")
        sys.exit(1)
    interval = int(cfg.get("heartbeat_interval_sec", 30))
    while True:
        try:
            heartbeat(cfg)
            push_results(cfg)
        except Exception as e:
            print(f"Tick failed: {e}")
        if once:
            return
        time.sleep(interval)


def main():
    p = argparse.ArgumentParser(prog="complyverse_agent", description="Compliverse compliance agent")
    sub = p.add_subparsers(dest="cmd", required=True)

    enr = sub.add_parser("enroll", help="One-time enrollment with backend")
    enr.add_argument("--backend", required=True, help="Backend URL e.g. https://tenant.complyverse.app")
    enr.add_argument("--token", required=True, help="Enrollment token from Connect Wizard")

    run = sub.add_parser("run", help="Run the heartbeat + results loop")
    run.add_argument("--once", action="store_true", help="Single tick then exit (for testing)")

    args = p.parse_args()
    if args.cmd == "enroll":
        cmd_enroll(args.backend, args.token)
    elif args.cmd == "run":
        cmd_run(once=args.once)


if __name__ == "__main__":
    main()
