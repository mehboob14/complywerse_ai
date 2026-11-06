#!/usr/bin/env python3
"""Provision Metabase for one ComplyVerse tenant (DB connection + collection).

Prereqs:
  - Metabase up; admin session token
  - reporting_* views already on grc_<slug> (POST /reporting/metabase/ensure-views)
  - Postgres role readonly_reporting exists (readonly_reporting.sql)

Usage:
  export MB_URL=http://127.0.0.1:3001
  export MB_SESSION=<session>
  export TENANT_SLUG=acme
  export PG_HOST=host.docker.internal   # or postgres hostname Metabase can reach
  export PG_PORT=5432
  export PG_USER=readonly_reporting
  export PG_PASSWORD=...
  python deploy/metabase/provision_tenant.py

Creates:
  - Database "ComplyVerse — <slug>" → grc_<slug>
  - Collection "Tenants/<slug>"
  Prints JWT group hint: tenant_<slug> (map in Metabase Admin → Auth → JWT)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def _req(method: str, path: str, body: dict | None = None):
    base = os.environ["MB_URL"].rstrip("/")
    session = os.environ["MB_SESSION"]
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}{path}",
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "X-Metabase-Session": session,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}") from exc


def main() -> None:
    needed = ("MB_URL", "MB_SESSION", "TENANT_SLUG", "PG_HOST", "PG_USER", "PG_PASSWORD")
    missing = [k for k in needed if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing env: {', '.join(missing)}")

    slug = os.environ["TENANT_SLUG"].strip().lower()
    dbname = os.environ.get("PG_DATABASE") or f"grc_{slug}"
    display = f"ComplyVerse — {slug}"

    # Avoid duplicate DB connections by name
    databases = _req("GET", "/api/database")
    data = databases.get("data") if isinstance(databases, dict) else databases
    for d in data or []:
        if isinstance(d, dict) and d.get("name") == display:
            print(f"database already exists id={d.get('id')} name={display}")
            db_id = d["id"]
            break
    else:
        payload = {
            "name": display,
            "engine": "postgres",
            "details": {
                "host": os.environ["PG_HOST"],
                "port": int(os.environ.get("PG_PORT") or "5432"),
                "dbname": dbname,
                "user": os.environ["PG_USER"],
                "password": os.environ["PG_PASSWORD"],
                "ssl": False,
                "tunnel-enabled": False,
            },
            "is_full_sync": True,
            "is_on_demand": False,
        }
        created = _req("POST", "/api/database", payload)
        db_id = created.get("id")
        print(f"created database id={db_id} name={display} dbname={dbname}")
        if db_id:
            _req("POST", f"/api/database/{db_id}/sync_schema")
            print("triggered schema sync")

    # Nested collection: ensure parent "Tenants", then child slug
    collections = _req("GET", "/api/collection")
    if not isinstance(collections, list):
        collections = collections.get("data") or []

    parent_id = None
    child_id = None
    for c in collections:
        if not isinstance(c, dict):
            continue
        if c.get("name") == "Tenants" and c.get("location") in ("/", None, ""):
            parent_id = c.get("id")
        if c.get("name") == slug:
            child_id = c.get("id")

    if parent_id is None:
        parent = _req("POST", "/api/collection", {"name": "Tenants", "color": "#0f172a"})
        parent_id = parent.get("id")
        print(f"created collection Tenants id={parent_id}")

    if child_id is None:
        child = _req(
            "POST",
            "/api/collection",
            {"name": slug, "color": "#334155", "parent_id": parent_id},
        )
        child_id = child.get("id")
        print(f"created collection Tenants/{slug} id={child_id}")
    else:
        print(f"collection Tenants/{slug} already id={child_id}")

    print()
    print("JWT group for this tenant (map in Metabase Auth > JWT > Group mappings):")
    print(f"  tenant_{slug}  ->  collection Tenants/{slug} + database {display}")
    print("Next: run bootstrap_models.py with MB_DATABASE_ID=", db_id)


if __name__ == "__main__":
    main()
