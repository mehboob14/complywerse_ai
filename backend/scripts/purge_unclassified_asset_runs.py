"""Delete plugin runs that were created against assets with no os_normalized.

These runs were produced by the pre-fix _do_scan_all path that ran every
approved+enabled plugin against unclassified assets, polluting the
pass/fail dashboard with thousands of bogus FAILs and ERRs.

The fix in router.py:3218 now skips these scans entirely, but the
historical runs are still in the table. This script purges them so:
  - per-asset pass rate stops showing 14% on a never-validly-scanned asset
  - the Compliance tab's "Scan sessions" history stops listing them
  - the workflow_engine pass-rate-dropped trigger stops firing on noise

Targets:
  - runs whose asset has os_normalized IS NULL
  - across every tenant DB

Idempotent — running again deletes nothing new.
"""
from dotenv import load_dotenv
load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from grc.models import SessionLocal, Tenant
from grc.db import open_tenant_session
from sqlalchemy import text

master = SessionLocal()
try:
    tenants = master.query(Tenant).all()
finally:
    master.close()

logger.info("Purging across %d tenants", len(tenants))
total_deleted = 0
for t in tenants:
    slug = getattr(t, "slug", None)
    if not slug:
        continue
    try:
        sess = open_tenant_session(slug)
    except Exception as e:
        logger.error("  open_tenant_session(%s) failed: %s", slug, e)
        continue
    try:
        # First, look at what we'd delete (per-asset breakdown for visibility)
        breakdown = sess.execute(text(
            "SELECT a.id, a.name, COUNT(r.id) AS bogus_runs "
            "FROM grc_compliance_plugin_runs r "
            "JOIN grc_it_assets a ON a.id = r.asset_id "
            "WHERE a.tenant_id = :tid "
            "  AND (a.os_normalized IS NULL OR a.os_normalized = '') "
            "GROUP BY a.id, a.name "
            "HAVING COUNT(r.id) > 0 "
            "ORDER BY COUNT(r.id) DESC"
        ), {"tid": t.id}).all()
        if not breakdown:
            sess.close()
            continue
        for asset_id, asset_name, count in breakdown:
            logger.info("  tenant=%-25s asset=%-40s bogus_runs=%d", slug, asset_name, count)
        # Delete them
        result = sess.execute(text(
            "DELETE FROM grc_compliance_plugin_runs "
            "WHERE asset_id IN ("
            "  SELECT id FROM grc_it_assets "
            "  WHERE tenant_id = :tid "
            "    AND (os_normalized IS NULL OR os_normalized = '')"
            ")"
        ), {"tid": t.id})
        sess.commit()
        deleted = result.rowcount or 0
        total_deleted += deleted
        logger.info("  tenant=%-25s DELETED %d run(s)", slug, deleted)
    except Exception as e:
        logger.error("  tenant=%s ERROR: %s", slug, e)
        sess.rollback()
    finally:
        sess.close()

logger.info("Done. total_runs_deleted=%d", total_deleted)
