#!/usr/bin/env python3
"""One-shot local Metabase bootstrap for ComplyVerse Analytics.

- Completes first-run setup (if needed)
- Enables JWT SSO with a shared secret
- Writes secrets to deploy/metabase/.env (not stdout)
- Optionally appends METABASE_* to backend/.env when --wire-backend is set

Usage:
  python deploy/metabase/setup_local.py
  python deploy/metabase/setup_local.py --wire-backend
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
MB_URL = os.environ.get("MB_URL", "http://127.0.0.1:3001").rstrip("/")
ADMIN_EMAIL = os.environ.get("MB_ADMIN_EMAIL", "admin@complyverse.local")
ADMIN_PASSWORD = os.environ.get("MB_ADMIN_PASSWORD", "ComplyVerse!Metabase1")
ADMIN_FIRST = os.environ.get("MB_ADMIN_FIRST", "ComplyVerse")
ADMIN_LAST = os.environ.get("MB_ADMIN_LAST", "Admin")
SITE_NAME = os.environ.get("MB_SITE_NAME", "ComplyVerse Analytics")


def _req(method: str, path: str, body: dict | None = None, session: str | None = None):
    headers = {"Content-Type": "application/json"}
    if session:
        headers["X-Metabase-Session"] = session
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f"{MB_URL}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc


def _upsert_dotenv(path: Path, updates: dict[str, str]) -> None:
    lines: list[str] = []
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines()
    keys = set(updates)
    out: list[str] = []
    seen: set[str] = set()
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            if k in keys:
                out.append(f"{k}={updates[k]}")
                seen.add(k)
                continue
        out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append(f"{k}={v}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--wire-backend",
        action="store_true",
        help="Also write METABASE_* into backend/.env",
    )
    args = parser.parse_args()

    props = _req("GET", "/api/session/properties")
    has_setup = bool(props.get("has-user-setup"))
    setup_token = props.get("setup-token")

    session_id: str | None = None
    if not has_setup:
        if not setup_token:
            print("Metabase not set up and no setup-token — cannot continue", file=sys.stderr)
            return 1
        result = _req(
            "POST",
            "/api/setup",
            {
                "token": setup_token,
                "user": {
                    "email": ADMIN_EMAIL,
                    "password": ADMIN_PASSWORD,
                    "first_name": ADMIN_FIRST,
                    "last_name": ADMIN_LAST,
                    "site_name": SITE_NAME,
                },
                "prefs": {
                    "site_name": SITE_NAME,
                    "site_locale": "en",
                    "allow_tracking": False,
                },
            },
        )
        session_id = result.get("id")
        print("Metabase setup completed")
    else:
        # Login with known admin
        try:
            login = _req(
                "POST",
                "/api/session",
                {"username": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            )
            session_id = login.get("id")
            print("Metabase already set up; logged in")
        except RuntimeError as exc:
            print(f"Already set up but login failed: {exc}", file=sys.stderr)
            print("Set MB_ADMIN_EMAIL / MB_ADMIN_PASSWORD and retry", file=sys.stderr)
            return 1

    if not session_id:
        print("No session id after setup/login", file=sys.stderr)
        return 1

    # Reuse existing secret from deploy/.env if present; else generate.
    env_path = ROOT / ".env"
    jwt_secret = None
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("METABASE_JWT_SHARED_SECRET=") and line.split("=", 1)[1].strip():
                jwt_secret = line.split("=", 1)[1].strip()
                break
    if not jwt_secret:
        jwt_secret = secrets.token_hex(32)

    # Enable JWT auth (settings keys vary slightly by version).
    settings = {
        "jwt-enabled": True,
        "jwt-identity-provider-uri": f"{MB_URL}/auth/sso",
        "jwt-shared-secret": jwt_secret,
        "jwt-attribute-email": "email",
        "jwt-attribute-firstname": "first_name",
        "jwt-attribute-lastname": "last_name",
        "jwt-group-sync": True,
        "jwt-group-attribute": "groups",
    }
    for key, value in settings.items():
        try:
            _req("PUT", f"/api/setting/{key}", {"value": value}, session=session_id)
        except RuntimeError as exc:
            # Some OSS builds gate JWT behind premium; record and continue.
            print(f"setting {key}: {exc}")

    _upsert_dotenv(
        env_path,
        {
            "METABASE_HOST_PORT": "3001",
            "MB_DB_PASSWORD": "metabase_dev_change_me",
            "METABASE_JWT_SHARED_SECRET": jwt_secret,
            "MB_ADMIN_EMAIL": ADMIN_EMAIL,
            "MB_SESSION": session_id,
        },
    )
    print(f"Wrote {env_path.relative_to(REPO)} (JWT secret stored there, not printed)")

    snippet = ROOT / "backend-metabase.env"
    snippet.write_text(
        "\n".join(
            [
                "METABASE_SITE_URL=http://127.0.0.1:3001",
                f"METABASE_JWT_SHARED_SECRET={jwt_secret}",
                "METABASE_EMBED_ENABLED=0",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"Wrote {snippet.relative_to(REPO)} for backend wiring")

    if args.wire_backend:
        backend_env = REPO / "backend" / ".env"
        _upsert_dotenv(
            backend_env,
            {
                "METABASE_SITE_URL": "http://127.0.0.1:3001",
                "METABASE_JWT_SHARED_SECRET": jwt_secret,
                "METABASE_EMBED_ENABLED": "0",
            },
        )
        print(f"Wired Metabase vars into {backend_env.relative_to(REPO)}")

    # Persist session for follow-on scripts
    print(f"MB_SESSION ready (length={len(session_id)})")
    print("Next: create readonly role, then provision_tenant.py + bootstrap_models.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
