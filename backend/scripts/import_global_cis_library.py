"""Import a global-CIS-library JSON export into a target tenant DB.

Counterpart to `export_global_cis_library.py`. Inserts each row with
`tenant_id = NULL` (so it's conceptually global), in a two-pass
FK-safe manner — the `parent_plugin_id` self-FK references source-DB
ids that don't exist on the target, so we:

  Pass 1: insert each row with parent_plugin_id = NULL,
          remember source.id -> target.id mapping.
  Pass 2: UPDATE parent_plugin_id using the mapping; fall back to
          plugin_key lookup if the parent existed pre-import.

Idempotent on plugin_key: rows whose plugin_key already exists in the
target are skipped, NOT updated. Re-running this against an already-
imported tenant produces an "inserted=0" run.

After running this on ONE tenant, set CANONICAL_LIBRARY_SOURCE_SLUG
in backend/.env to that tenant's slug so newly-created tenants
auto-inherit the library via the provisioning sync.

Usage:
    cd /opt/grc/app/backend
    python -m scripts.import_global_cis_library \
        --target liztek-1 \
        --in /tmp/cis_library.json

    # Then backfill any other under-seeded tenants the same way:
    python -m scripts.import_global_cis_library --target acme --in /tmp/cis_library.json
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from grc.db import open_tenant_session                       # noqa: E402
from grc.models import CompliancePlugin                       # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s | %(message)s")
logger = logging.getLogger("import_global_cis_library")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a global CIS library JSON export into a tenant DB")
    parser.add_argument("--target", required=True,
                        help="Tenant slug to write into")
    parser.add_argument("--in", dest="in_path", required=True,
                        help="Path to the JSON export produced by export_global_cis_library")
    args = parser.parse_args()

    logger.info("Reading %s ...", args.in_path)
    with open(args.in_path, "r", encoding="utf-8") as f:
        payload = json.load(f)

    meta = payload.get("meta", {})
    rows: list[dict] = payload.get("rows") or []
    col_names: list[str] = meta.get("column_names") or [c.name for c in CompliancePlugin.__table__.columns]
    logger.info("Payload: %d rows from source tenant %r (exported %s)",
                len(rows), meta.get("source_tenant"), meta.get("exported_at"))

    if not rows:
        logger.error("Payload contains no rows. Nothing to do.")
        return 2

    logger.info("Opening target tenant %s ...", args.target)
    sess = open_tenant_session(args.target)
    try:
        # Pre-compute which plugin_keys already exist on the target so we
        # don't overwrite anything.
        existing_keys = {
            k for (k,) in sess.query(CompliancePlugin.plugin_key)
            .filter(CompliancePlugin.tenant_id.is_(None)).all()
        }
        logger.info("Target already has %d global rules; will skip duplicates by plugin_key", len(existing_keys))

        # Pass 1: insert with parent_plugin_id = NULL. Track src_id -> target_id.
        inserted = 0
        skipped = 0
        src_id_to_target_id: dict[int, int] = {}
        parent_link_pending: list[tuple[int, int]] = []  # (target_id, src_parent_id)

        # Columns we always force to known values: tenant_id NULL,
        # parent_plugin_id NULL (resolved in pass 2). Skip the source `id`
        # — let the target autoincrement issue a fresh one.
        usable_cols = [c for c in col_names if c not in ("id", "tenant_id", "parent_plugin_id")]

        for i, raw in enumerate(rows, start=1):
            key = raw.get("plugin_key")
            if not key:
                logger.warning("row %d has no plugin_key; skipping", i)
                continue
            if key in existing_keys:
                skipped += 1
                continue

            data = {col: raw.get(col) for col in usable_cols}
            new_row = CompliancePlugin(tenant_id=None, **data)
            sess.add(new_row)
            sess.flush()  # populate id

            src_id = raw.get("id")
            if isinstance(src_id, int):
                src_id_to_target_id[src_id] = new_row.id

            src_parent = raw.get("parent_plugin_id")
            if isinstance(src_parent, int):
                parent_link_pending.append((new_row.id, src_parent))

            inserted += 1
            if inserted % 500 == 0:
                sess.commit()
                logger.info("  ... %d inserted so far", inserted)
        sess.commit()
        logger.info("Pass 1 done: inserted=%d  skipped(dup plugin_key)=%d", inserted, skipped)

        # Pass 2: rebuild parent_plugin_id FKs on inserted rows.
        # If the parent was also in this import, the map has it. If the
        # parent existed on target pre-import (one of the 36 built-ins),
        # look it up by plugin_key.
        fixed = 0
        for target_id, src_parent_id in parent_link_pending:
            target_parent_id = src_id_to_target_id.get(src_parent_id)
            if target_parent_id is None:
                # Try plugin_key lookup. We need the source row's plugin_key
                # to find the equivalent on target.
                # Find it in the payload (linear scan; rare path).
                src_parent_key = None
                for raw in rows:
                    if raw.get("id") == src_parent_id:
                        src_parent_key = raw.get("plugin_key")
                        break
                if src_parent_key:
                    match = (
                        sess.query(CompliancePlugin)
                        .filter(CompliancePlugin.plugin_key == src_parent_key,
                                CompliancePlugin.tenant_id.is_(None))
                        .first()
                    )
                    target_parent_id = match.id if match else None
            if target_parent_id is not None:
                sess.query(CompliancePlugin).filter(
                    CompliancePlugin.id == target_id
                ).update({"parent_plugin_id": target_parent_id})
                fixed += 1
        sess.commit()
        logger.info("Pass 2 done: %d parent FKs resolved", fixed)

        total_after = sess.query(CompliancePlugin).filter(
            CompliancePlugin.tenant_id.is_(None)
        ).count()
        logger.info("Target tenant %s now has %d global rules total", args.target, total_after)
        return 0
    except Exception:
        sess.rollback()
        logger.exception("Import failed; rolled back partial changes")
        return 1
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
