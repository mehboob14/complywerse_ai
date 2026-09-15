#!/usr/bin/env python3
"""Enable Metabase static embedding (OSS) and persist embedding secret.

Uses MB_SESSION from deploy/metabase/.env (created by setup_local.py).
"""
from __future__ import annotations

import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MB_URL = "http://127.0.0.1:3001"


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        raise SystemExit("Missing deploy/metabase/.env — run setup_local.py first")
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


def _upsert(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        if "=" in line and not line.lstrip().startswith("#"):
            k = line.split("=", 1)[0].strip()
            if k in updates:
                out.append(f"{k}={updates[k]}")
                seen.add(k)
                continue
        out.append(line)
    for k, v in updates.items():
        if k not in seen:
            out.append(f"{k}={v}")
    path.write_text("\n".join(out).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    env = _load_env()
    session = env.get("MB_SESSION")
    if not session:
        raise SystemExit("MB_SESSION missing in deploy/metabase/.env")

    secret = env.get("METABASE_EMBEDDING_SECRET_KEY") or env.get("METABASE_JWT_SHARED_SECRET")
    if not secret:
        secret = secrets.token_hex(32)

    try:
        _req("PUT", "/api/setting/enable-embedding", {"value": True}, session)
        _req("PUT", "/api/setting/enable-embedding-static", {"value": True}, session)
        _req("PUT", "/api/setting/embedding-secret-key", {"value": secret}, session)
    except urllib.error.HTTPError as exc:
        print(exc.read().decode(errors="replace")[:500], file=sys.stderr)
        return 1

    _upsert(
        ROOT / ".env",
        {
            "METABASE_EMBEDDING_SECRET_KEY": secret,
            "METABASE_EMBED_ENABLED": "1",
        },
    )
    snippet = ROOT / "backend-metabase.env"
    existing = snippet.read_text(encoding="utf-8") if snippet.exists() else ""
    lines = {
        "METABASE_SITE_URL": "http://127.0.0.1:3001",
        "METABASE_EMBEDDING_SECRET_KEY": secret,
        "METABASE_EMBED_ENABLED": "1",
        "METABASE_JWT_SHARED_SECRET": env.get("METABASE_JWT_SHARED_SECRET", secret),
    }
    # Keep any prior JWT secret line if present in snippet
    for line in existing.splitlines():
        if line.startswith("METABASE_JWT_SHARED_SECRET=") and line.split("=", 1)[1].strip():
            lines["METABASE_JWT_SHARED_SECRET"] = line.split("=", 1)[1].strip()
    snippet.write_text("\n".join(f"{k}={v}" for k, v in lines.items()) + "\n", encoding="utf-8")
    print("Static embedding enabled; secrets written to deploy/metabase/.env and backend-metabase.env")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
