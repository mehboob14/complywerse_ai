"""Apply the os_keys + OsVersion migration across every tenant DB.

Idempotent: re-running is safe — `_ensure_for_engine` no-ops on engines
already ensured this process, and the underlying `ALTER TABLE ADD COLUMN
IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS` are themselves idempotent.

Usage:
    python -m scripts.apply_os_keys_migration
"""
from dotenv import load_dotenv
load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from grc.models import SessionLocal, Tenant
from grc.db import get_tenant_engine
from grc.modules.compliance.schema_migrations import _ensure_for_engine

master = SessionLocal()
try:
    tenants = master.query(Tenant).all()
finally:
    master.close()

logger.info("Applying migration to %d tenants", len(tenants))
ok, fail = 0, 0
for t in tenants:
    slug = getattr(t, "slug", None)
    if not slug:
        continue
    try:
        engine = get_tenant_engine(slug)
        _ensure_for_engine(engine)
        ok += 1
        logger.info("  OK   tenant=%s", slug)
    except Exception as e:  # noqa: BLE001
        fail += 1
        logger.error("  FAIL tenant=%s: %s", slug, e)

logger.info("Done. ok=%d  fail=%d", ok, fail)
