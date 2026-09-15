#!/usr/bin/env python3
"""Configure Metabase SMTP (local Mailhog or production SMTP).

Reads MB_SESSION from deploy/metabase/.env.
Defaults target the compose Mailhog service (host.docker.internal:1025 from
Metabase container is mailhog:1025 — already set via compose env; this script
pushes Admin Settings so the UI shows Email as configured).

Usage:
  python deploy/metabase/configure_smtp.py
  MB_SMTP_HOST=smtp.example.com MB_SMTP_PORT=587 MB_SMTP_SECURITY=tls \\
    MB_SMTP_USER=... MB_SMTP_PASS=... python deploy/metabase/configure_smtp.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MB_URL = os.environ.get("MB_URL", "http://127.0.0.1:3001").rstrip("/")


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def _req(method: str, path: str, body: dict | None, session: str):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{MB_URL}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "X-Metabase-Session": session},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode() or "{}"
        return json.loads(raw) if raw.strip() else {}


def main() -> int:
    env = _load_env()
    session = os.environ.get("MB_SESSION") or env.get("MB_SESSION")
    if not session:
        print("MB_SESSION missing — run setup_local.py first", file=sys.stderr)
        return 1

    # From Metabase container, Mailhog hostname is "mailhog".
    host = os.environ.get("MB_SMTP_HOST", "mailhog")
    port = int(os.environ.get("MB_SMTP_PORT", "1025"))
    security = os.environ.get("MB_SMTP_SECURITY", "none")  # none|ssl|tls
    user = os.environ.get("MB_SMTP_USER", "")
    password = os.environ.get("MB_SMTP_PASS", "")
    from_addr = os.environ.get("MB_EMAIL_FROM", "analytics@complyverse.local")

    settings = {
        "email-smtp-host": host,
        "email-smtp-port": port,
        "email-smtp-security": security,
        "email-smtp-username": user,
        "email-smtp-password": password,
        "email-from-address": from_addr,
        "email-from-name": "ComplyVerse Analytics",
    }
    for key, value in settings.items():
        try:
            _req("PUT", f"/api/setting/{key}", {"value": value}, session)
            print(f"ok {key}")
        except urllib.error.HTTPError as exc:
            print(f"fail {key}: {exc.code} {exc.read().decode(errors='replace')[:200]}", file=sys.stderr)

    # Probe
    try:
        props = _req("GET", "/api/setting", None, session)
        if isinstance(props, list):
            by_key = {p.get("key"): p.get("value") for p in props if isinstance(p, dict)}
            print("smtp_host=", by_key.get("email-smtp-host"))
            print("smtp_port=", by_key.get("email-smtp-port"))
            print("from=", by_key.get("email-from-address"))
    except Exception as exc:
        print(f"probe warn: {exc}", file=sys.stderr)

    print("Mailhog UI (local): http://127.0.0.1:8025")
    print("Next: open a dashboard in Metabase > Sharing > Subscriptions")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
