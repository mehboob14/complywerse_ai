#!/usr/bin/env python3
"""Bootstrap Metabase Models from reporting_* views (Phase 2 helper).

Requires a running Metabase with an admin session token and a Postgres
database already connected that exposes the reporting_* views.

Usage:
  export MB_URL=http://127.0.0.1:3001
  export MB_SESSION=<metabase session id from /api/session>
  export MB_DATABASE_ID=<id from /api/database>
  python deploy/metabase/bootstrap_models.py

Creates a collection "ComplyVerse Models" and one Model (card type=model)
per view listed in starter-dashboards.json. Idempotent by name within the
collection: existing cards with the same name are skipped.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STARTER = ROOT / "starter-dashboards.json"


def _req(method: str, path: str, body: dict | None = None) -> dict:
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
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} -> {exc.code}: {detail}") from exc


def main() -> None:
    for key in ("MB_URL", "MB_SESSION", "MB_DATABASE_ID"):
        if not os.environ.get(key):
            raise SystemExit(f"Missing env {key}")

    db_id = int(os.environ["MB_DATABASE_ID"])
    starter = json.loads(STARTER.read_text(encoding="utf-8"))
    models = starter.get("models") or []

    coll = _req(
        "POST",
        "/api/collection",
        {"name": "ComplyVerse Models", "color": "#334155"},
    )
    # If name collision, Metabase may 400 — fall back to root (null) or lookup.
    collection_id = coll.get("id")
    if not collection_id:
        # list and find
        for c in _req("GET", "/api/collection"):
            if isinstance(c, dict) and c.get("name") == "ComplyVerse Models":
                collection_id = c["id"]
                break
    if not collection_id:
        raise SystemExit("Could not create or find collection 'ComplyVerse Models'")

    existing = _req("GET", f"/api/collection/{collection_id}/items")
    existing_names = {
        (it.get("name") or "")
        for it in (existing.get("data") or existing if isinstance(existing, list) else [])
        if isinstance(it, dict)
    }

    created = 0
    skipped = 0
    for m in models:
        name = m["name"]
        view = m["source_view"]
        if name in existing_names:
            print(f"skip existing model: {name}")
            skipped += 1
            continue
        # Native SQL model over the view — works without sync metadata quirks.
        card = {
            "name": name,
            "type": "model",
            "display": "table",
            "visualization_settings": {},
            "dataset_query": {
                "type": "native",
                "native": {"query": f"SELECT * FROM {view}"},
                "database": db_id,
            },
            "collection_id": collection_id,
        }
        out = _req("POST", "/api/card", card)
        print(f"created model id={out.get('id')} name={name} view={view}")
        created += 1

    print(f"done: created={created} skipped={skipped} collection_id={collection_id}")
    print("Next: build dashboards from starter-dashboards.json and enable SMTP for subscriptions.")


if __name__ == "__main__":
    main()
