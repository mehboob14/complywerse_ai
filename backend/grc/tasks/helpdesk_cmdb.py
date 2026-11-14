"""Help Desk CMDB ← inventory auto-sync (spec §7).

Beat-scheduled fan-out (every 6h) that mirrors each tenant's ComplyVerse IT-asset
inventory into its Help Desk CMDB by calling
``helpdesk_native.cmdb_sync.sync_inventory_to_cmdb`` with ``dry_run=False``.

Best-effort and isolated per tenant: a tenant whose session can't be built, or
that lacks the ITSM/CMDB tables (``grc_hd_ci``), is skipped; one tenant's error
logs + continues and never poisons the run. The sync itself runs in ONE
transaction and rolls back on error, so a partial write can't land.
"""
from __future__ import annotations

import logging

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from ..celery_app import celery_app

logger = logging.getLogger(__name__)

# CMDB tables must exist before we try to sync a tenant.
_REQUIRED_TABLES = ("grc_hd_ci", "grc_hd_ci_type", "grc_hd_ci_relationship")


def _has_cmdb_tables(db: Session) -> bool:
    try:
        names = set(sa_inspect(db.get_bind()).get_table_names())
    except Exception:
        return False
    return all(t in names for t in _REQUIRED_TABLES)


def _sync_one_tenant(db: Session) -> dict:
    """Run a real (non-dry) inventory→CMDB sync for the tenant bound to ``db``."""
    from ..modules.helpdesk_native.common import tenant_id
    from ..modules.helpdesk_native.cmdb_sync import sync_inventory_to_cmdb

    tid = tenant_id(db)
    if tid is None:
        return {"status": "skipped", "reason": "no_tenant_row"}
    if not _has_cmdb_tables(db):
        return {"status": "skipped", "reason": "no_cmdb_tables"}
    summary = sync_inventory_to_cmdb(db, tid, dry_run=False, actor_email="system:beat")
    return {
        "status": "ok",
        "inventory_count": summary.get("inventory_count"),
        "created": summary.get("created"),
        "updated": summary.get("updated"),
        "retired": summary.get("retired"),
    }


@celery_app.task(
    bind=True,
    name="grc.tasks.helpdesk_cmdb.cmdb_inventory_sync_fan_out",
    queue="parsing",
    max_retries=0,
)
def cmdb_inventory_sync_fan_out(self) -> dict:
    """Beat-scheduled every 6h. Walk every active tenant, sync its CMDB from
    inventory. Non-fatal per tenant."""
    from ..db import MasterSession, get_tenant_session_factory
    from ..models import Tenant

    master = MasterSession()
    try:
        rows = master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
        slugs = [t.slug for t in rows if t.slug]
    except Exception:
        # Some deployments don't carry `is_active`; fall back to all slugs.
        try:
            rows = master.query(Tenant.slug).all()
            slugs = [t.slug for t in rows if t.slug]
        except Exception:
            logger.exception("cmdb_inventory_sync_fan_out: could not list tenants")
            slugs = []
    finally:
        master.close()

    synced = 0
    skipped = 0
    for slug in slugs:
        try:
            session_factory = get_tenant_session_factory(slug)
            db = session_factory()
        except Exception:
            logger.exception("cmdb_inventory_sync_fan_out: tenant session failed slug=%s", slug)
            continue
        try:
            result = _sync_one_tenant(db)
            if result.get("status") == "ok":
                synced += 1
                logger.info(
                    "cmdb_inventory_sync tenant=%s inventory=%s created=%s updated=%s retired=%s",
                    slug, result.get("inventory_count"), result.get("created"),
                    result.get("updated"), result.get("retired"),
                )
            else:
                skipped += 1
                logger.info("cmdb_inventory_sync tenant=%s skipped (%s)", slug, result.get("reason"))
        except Exception:
            logger.exception("cmdb_inventory_sync_fan_out: per-tenant sync failed slug=%s", slug)
        finally:
            try:
                db.close()
            except Exception:
                pass

    logger.info("cmdb_inventory_sync_fan_out DONE synced=%d skipped=%d total=%d",
                synced, skipped, len(slugs))
    return {"status": "ok", "synced": synced, "skipped": skipped, "total": len(slugs)}
