#!python
# -*- coding: utf-8 -*-
"""Audit which frameworks have artifact-catalog coverage vs which don't.

Compares:
  1) Frameworks seeded in backend/grc/seed_data/frameworks/*.json — the
     curated catalog the user expects to onboard.
  2) Frameworks present in this tenant's grc_frameworks table.
  3) Framework keys covered by backend/grc/seed_data/artifact_catalog.json.
  4) Framework keys present in the grc_artifact_catalog_items table.

The user reported "for some frameworks tried to create artifacts wasn't
creating". The likeliest cause is gap (3) or (4): the framework exists in
the system but has no catalog entries seeded — so the artifacts list page
shows nothing and "Create artifact" silently no-ops because the catalog
items it expects aren't there.
"""
from __future__ import annotations
import os, sys, json
from collections import Counter
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session

SLUG = "liztek-1"


def main():
    # 1) Seed-data frameworks (the canonical list shipped with the product)
    fw_dir = os.path.join(HERE, "grc", "seed_data", "frameworks")
    seeded_keys: set[str] = set()
    if os.path.isdir(fw_dir):
        for fn in sorted(os.listdir(fw_dir)):
            if fn.endswith(".json"):
                try:
                    with open(os.path.join(fw_dir, fn), "r", encoding="utf-8") as f:
                        data = json.load(f)
                    meta = data.get("metadata", data) or {}
                    name = meta.get("name") or os.path.splitext(fn)[0]
                    seeded_keys.add(name)
                except Exception as e:  # noqa: BLE001
                    print(f"  ! couldn't read {fn}: {e}")
    print(f"=== Seeded frameworks ({len(seeded_keys)}) ===")
    for k in sorted(seeded_keys):
        print(f"  - {k}")

    # 2) Frameworks in this tenant DB
    db = open_tenant_session(SLUG)
    try:
        tenant_rows = db.execute(text("""
            SELECT name, id FROM grc_frameworks ORDER BY name
        """)).all()
        print()
        print(f"=== Frameworks in tenant DB ({len(tenant_rows)}) ===")
        tenant_fw_names = []
        for n, fid in tenant_rows:
            tenant_fw_names.append(n)
            print(f"  id={fid}  name={n!r}")

        # 3) Catalog JSON coverage
        catalog_path = os.path.join(HERE, "grc", "seed_data", "artifact_catalog.json")
        print()
        print(f"=== artifact_catalog.json contents ===")
        if not os.path.exists(catalog_path):
            print(f"  FILE MISSING: {catalog_path}")
        else:
            with open(catalog_path, "r", encoding="utf-8") as f:
                catalog = json.load(f)
            if isinstance(catalog, list):
                print(f"  Total items: {len(catalog)}")
                fw_cnt = Counter(it.get("framework_key", "???") for it in catalog)
                print(f"  Per-framework_key item counts:")
                for k, v in sorted(fw_cnt.items()):
                    print(f"    {k:<50} {v} items")
            elif isinstance(catalog, dict):
                print(f"  Top-level keys: {list(catalog.keys())[:20]}")
                # Common shape: {framework_key: [...items...]}
                for k, v in catalog.items():
                    n = len(v) if isinstance(v, list) else "?"
                    print(f"    {k:<50} {n} items")

        # 4) DB catalog table
        print()
        print(f"=== grc_artifact_catalog_items (tenant DB) ===")
        cat_rows = db.execute(text("""
            SELECT framework_key, COUNT(*) as n
            FROM grc_artifact_catalog_items
            GROUP BY framework_key
            ORDER BY framework_key
        """)).all()
        print(f"  Frameworks with catalog rows: {len(cat_rows)}")
        for fk, n in cat_rows:
            print(f"    {fk:<50} {n} items")

        # 5) Cross-reference: which tenant frameworks have NO catalog support?
        print()
        print(f"=== Frameworks in tenant WITHOUT catalog coverage ===")
        covered = {fk for fk, _ in cat_rows}
        missing: list[str] = []
        for name in tenant_fw_names:
            # Heuristic: match by exact name OR by tokens (catalog uses
            # framework_key which can be name or a slug like "ISO27001").
            if name in covered:
                continue
            # Try a relaxed match by token overlap
            relaxed = any(
                name.lower().replace(" ", "").replace("-", "") in (k.lower().replace(" ", "").replace("-", ""))
                or k.lower().replace(" ", "").replace("-", "") in name.lower().replace(" ", "").replace("-", "")
                for k in covered
            )
            if not relaxed:
                missing.append(name)
        if missing:
            print(f"  {len(missing)} frameworks have no artifact-catalog entries — Create Artifact on")
            print(f"  these will show no template options (only freeform 'Custom' creation works):")
            for n in missing:
                print(f"    - {n}")
        else:
            print(f"  All tenant frameworks have at least some catalog coverage.")

        # 6) Sample artifacts already created in tenant
        print()
        print(f"=== Existing artifacts in this tenant (last 10) ===")
        art_rows = db.execute(text("""
            SELECT id, framework_key, name, artifact_type, status, created_at
            FROM grc_tenant_artifacts
            ORDER BY created_at DESC NULLS LAST, id DESC
            LIMIT 10
        """)).all()
        if not art_rows:
            print(f"  None.")
        else:
            for aid, fk, n, at, st, ct in art_rows:
                print(f"  id={aid:>4} framework_key={fk!r:<35} name={(n or '')[:25]:<25} status={st}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
