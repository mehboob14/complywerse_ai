#!/usr/bin/env python3
"""Create starter dashboards in Metabase from reporting Models.

Requires MB_URL, MB_SESSION. Looks up cards named in starter-dashboards.json
models and places count/table cards on four dashboards.
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


def _req(method: str, path: str, body: dict | None = None):
    base = os.environ["MB_URL"].rstrip("/")
    session = os.environ["MB_SESSION"]
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "X-Metabase-Session": session},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode() or "{}"
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} -> {exc.code}: {exc.read().decode(errors='replace')[:800]}") from exc


def main() -> None:
    for key in ("MB_URL", "MB_SESSION"):
        if not os.environ.get(key):
            raise SystemExit(f"Missing {key}")

    starter = json.loads(STARTER.read_text(encoding="utf-8"))
    search = _req("GET", "/api/search?q=reporting&models=card")
    # Also list collection items for ComplyVerse Models
    cards_by_name: dict[str, int] = {}
    for item in search.get("data") or []:
        if item.get("model") in ("card", "dataset") and item.get("name"):
            cards_by_name[item["name"]] = item["id"]

    # Fallback: scan root cards
    if len(cards_by_name) < 3:
        for c in _req("GET", "/api/card") or []:
            if isinstance(c, dict) and c.get("name"):
                cards_by_name[c["name"]] = c["id"]

    model_to_card = {}
    for m in starter.get("models") or []:
        name = m["name"]
        if name in cards_by_name:
            model_to_card[m["source_view"]] = cards_by_name[name]
            print(f"model mapped: {name} -> card {cards_by_name[name]}")
        else:
            print(f"WARN missing model card: {name}")

    # Collection for dashboards
    coll = _req("POST", "/api/collection", {"name": "ComplyVerse Dashboards", "color": "#0f172a"})
    coll_id = coll.get("id")
    if not coll_id:
        for c in _req("GET", "/api/collection"):
            if isinstance(c, dict) and c.get("name") == "ComplyVerse Dashboards":
                coll_id = c["id"]
                break
    if not coll_id:
        raise SystemExit("Could not create dashboards collection")

    # Map dashboard keys to primary model views
    dash_models = {
        "risk_posture": ["reporting_risks", "reporting_risks_with_issues"],
        "vendor_tpra": ["reporting_vendors_tpra"],
        "issues_vulns": ["reporting_issues_tasks", "reporting_assets_vulns"],
        "evidence_compliance": ["reporting_evidence_controls", "reporting_scf_check_results"],
    }

    existing = {
        (d.get("name") or "")
        for d in (_req("GET", "/api/dashboard") or [])
        if isinstance(d, dict)
    }

    created_map: dict[str, dict] = {}

    for ddef in starter.get("dashboards") or []:
        title = ddef["title"]
        key = ddef["key"]
        if title in existing:
            print(f"skip dashboard: {title}")
            continue
        dash = _req(
            "POST",
            "/api/dashboard",
            {
                "name": title,
                "description": "; ".join(ddef.get("cards") or [])[:500],
                "collection_id": coll_id,
            },
        )
        dash_id = dash.get("id")
        if not dash_id:
            print(f"failed create dashboard {title}")
            continue

        cards = []
        col = 0
        row = 0
        for view in dash_models.get(key, []):
            card_id = model_to_card.get(view)
            if not card_id:
                continue
            cards.append(
                {
                    "id": -1 - len(cards),
                    "card_id": card_id,
                    "row": row,
                    "col": col,
                    "size_x": 12,
                    "size_y": 8,
                    "parameter_mappings": [],
                    "visualization_settings": {},
                }
            )
            col = 12 if col == 0 else 0
            if col == 0:
                row += 8

        if cards:
            # Metabase API evolved; try PUT dashboard cards
            try:
                _req("PUT", f"/api/dashboard/{dash_id}/cards", {"cards": cards})
            except SystemExit:
                # v0.53 uses /api/dashboard/:id with dashcards
                payload = {**dash, "dashcards": [
                    {
                        "id": c["id"],
                        "card_id": c["card_id"],
                        "row": c["row"],
                        "col": c["col"],
                        "size_x": c["size_x"],
                        "size_y": c["size_y"],
                        "parameter_mappings": [],
                        "visualization_settings": {},
                    }
                    for c in cards
                ]}
                _req("PUT", f"/api/dashboard/{dash_id}", payload)
            # Enable embedding for this dashboard
            try:
                _req(
                    "PUT",
                    f"/api/dashboard/{dash_id}",
                    {"enable_embedding": True, "embedding_params": {}},
                )
            except SystemExit as exc:
                print(f"embed enable warn for {title}: {exc}")

        print(f"created dashboard id={dash_id} title={title} cards={len(cards)}")
        created_map[key] = {"id": dash_id, "title": title}

    # Refresh map from live Metabase titles (covers skipped creates)
    title_to_key = {d["title"]: d["key"] for d in (starter.get("dashboards") or [])}
    for d in _req("GET", "/api/dashboard") or []:
        if isinstance(d, dict) and d.get("name") in title_to_key:
            created_map[title_to_key[d["name"]]] = {"id": d["id"], "title": d["name"]}

    ids_path = ROOT / "dashboard_ids.json"
    ids_path.write_text(json.dumps(created_map, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {ids_path.name}")
    print("done")


if __name__ == "__main__":
    main()
