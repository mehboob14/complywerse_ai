"""Export the global CIS compliance plugin library from a populated
tenant DB to a portable JSON file you can ship to another deployment.

Usage:
    cd backend
    python -m scripts.export_global_cis_library \
        --source company \
        --out /tmp/cis_library.json

What it exports:
    - Every row in grc_compliance_plugins where tenant_id IS NULL
      (the canonical "global" rules — PDF-ingested CIS benchmarks
      that should be visible to every tenant).
    - Preserves enough metadata to reconstruct the parent_plugin_id
      hierarchy on the target via the import companion script.

What it does NOT touch:
    - Tenant-scoped rules (tenant_id IS NOT NULL).
    - The source tenant's data — pure read.

Output format: a single JSON object with `meta` + `rows` arrays. The
companion `import_global_cis_library.py` reads this and inserts with
proper FK fixup.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import os
import sys
from typing import Any

from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from grc.db import open_tenant_session                       # noqa: E402
from grc.models import CompliancePlugin                       # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s | %(message)s")
logger = logging.getLogger("export_global_cis_library")


def _serialize_value(v: Any) -> Any:
    """Make a column value JSON-friendly (datetime → ISO, set → list,
    everything else passes through)."""
    if isinstance(v, _dt.datetime):
        return v.isoformat()
    if isinstance(v, _dt.date):
        return v.isoformat()
    if isinstance(v, set):
        return list(v)
    return v


def main() -> int:
    parser = argparse.ArgumentParser(description="Export global CIS plugin library from a tenant DB")
    parser.add_argument("--source", required=True,
                        help="Tenant slug to read from (must have the full ~5300 rules)")
    parser.add_argument("--out", required=True,
                        help="Path to write the JSON export (e.g. /tmp/cis_library.json)")
    args = parser.parse_args()

    logger.info("Opening source tenant %s ...", args.source)
    sess = open_tenant_session(args.source)
    try:
        rows = sess.query(CompliancePlugin).filter(
            CompliancePlugin.tenant_id.is_(None)
        ).all()
        logger.info("Found %d global rules (tenant_id IS NULL)", len(rows))

        if not rows:
            logger.error(
                "Source tenant '%s' has no global rules. Pick a tenant that"
                " has the full library (e.g. ingested CIS PDFs).",
                args.source,
            )
            return 2

        col_names = [c.name for c in CompliancePlugin.__table__.columns]

        # Build records. We keep the source `id` so the import script can
        # rebuild the parent_plugin_id self-FK in a second pass.
        records: list[dict] = []
        for r in rows:
            rec = {col: _serialize_value(getattr(r, col)) for col in col_names}
            records.append(rec)

        payload = {
            "meta": {
                "schema_version": 1,
                "exported_at": _dt.datetime.utcnow().isoformat(),
                "source_tenant": args.source,
                "column_names": col_names,
                "row_count": len(records),
            },
            "rows": records,
        }

        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        size_mb = os.path.getsize(args.out) / 1024 / 1024
        logger.info("Wrote %s (%.2f MB, %d rows)", args.out, size_mb, len(records))
        return 0
    finally:
        sess.close()


if __name__ == "__main__":
    sys.exit(main())
