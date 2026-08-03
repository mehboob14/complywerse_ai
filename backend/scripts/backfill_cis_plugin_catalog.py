"""One-shot backfill: seed the built-in CIS plugin catalog into every existing tenant DB.

Newly-provisioned tenants get the catalog automatically via ``_seed_tenant_database``
(see ``grc/tenant_manager.py``). This script handles tenants that already
exist by the time the CIS module landed — it iterates every active row in
``grc_master.grc_tenants`` and runs ``seed_compliance_plugins`` against each
tenant's own DB.

The seeder is idempotent (UPSERT on ``plugin_key`` with ``tenant_id IS NULL``)
so running this twice is safe — only metadata changes from PLUGIN_LIBRARY
are reflected on the second pass.

Usage::

    cd backend && python -m scripts.backfill_cis_plugin_catalog

    # Or dry-run to see which tenants would be touched, no DB writes:
    python -m scripts.backfill_cis_plugin_catalog --dry-run

Exits non-zero if any tenant DB fails so CI / ops can spot partial runs.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from typing import List, Tuple

from dotenv import load_dotenv

# Load .env from the backend folder so DB URLs + SESSION_SECRET resolve when
# this is invoked as `python -m backend.scripts.backfill_cis_plugin_catalog`.
HERE = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from grc.db import MasterSession, open_tenant_session  # noqa: E402
from grc.models import Tenant  # noqa: E402
from grc.modules.compliance_plugins.seed import (  # noqa: E402
    PLUGIN_LIBRARY,
    seed_compliance_plugins,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
)
logger = logging.getLogger("backfill_cis")


def list_active_tenants() -> List[Tuple[int, str, str]]:
    """Return ``[(id, slug, name)]`` for every active tenant in the catalog."""
    db = MasterSession()
    try:
        rows = (
            db.query(Tenant.id, Tenant.slug, Tenant.name)
            .filter(Tenant.is_active.is_(True))
            .order_by(Tenant.id.asc())
            .all()
        )
        return [(r.id, r.slug, r.name) for r in rows]
    finally:
        db.close()


def backfill_one(slug: str, dry_run: bool) -> int:
    """Seed the catalog into one tenant DB. Returns the number of rows touched."""
    if dry_run:
        logger.info("[dry-run] would seed %d plugins into %s", len(PLUGIN_LIBRARY), slug)
        return len(PLUGIN_LIBRARY)
    session = open_tenant_session(slug)
    try:
        touched = seed_compliance_plugins(session)
        return touched
    finally:
        session.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Don't write anything; just list the tenants that would be touched.",
    )
    parser.add_argument(
        "--slug", action="append", default=None,
        help="Limit backfill to one or more specific tenant slugs (repeatable).",
    )
    args = parser.parse_args()

    tenants = list_active_tenants()
    if args.slug:
        wanted = set(args.slug)
        tenants = [t for t in tenants if t[1] in wanted]
        if not tenants:
            logger.error("No active tenants matched --slug %s", args.slug)
            return 2

    logger.info(
        "Backfilling CIS plugin catalog (%d rules) into %d tenant(s)%s",
        len(PLUGIN_LIBRARY), len(tenants), " [dry-run]" if args.dry_run else "",
    )

    failures: List[Tuple[str, str]] = []
    total_touched = 0
    for tid, slug, name in tenants:
        try:
            touched = backfill_one(slug, args.dry_run)
            total_touched += touched
            logger.info("  ✓ %-30s tid=%-4d touched=%d", slug, tid, touched)
        except Exception as exc:  # noqa: BLE001
            logger.exception("  ✗ %-30s tid=%-4d failed", slug, tid)
            failures.append((slug, f"{type(exc).__name__}: {exc}"))

    logger.info("Backfill complete. tenants=%d touched=%d failures=%d",
                len(tenants), total_touched, len(failures))
    if failures:
        logger.error("Failed tenants:")
        for slug, reason in failures:
            logger.error("  %-30s %s", slug, reason)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
