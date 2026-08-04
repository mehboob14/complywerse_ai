"""Convert grc_compliance_plugins.os_keys + target_builds from json to jsonb.

The /library-tree and /os-registry endpoints use jsonb operators
(`jsonb_array_elements_text`, `?`) that don't work on plain json.
PostgreSQL doesn't auto-cast json→jsonb in operator dispatch, so we
need to change the column type explicitly.

ALTER COLUMN ... TYPE jsonb USING <col>::jsonb is a single statement
that handles existing rows transparently. Idempotent — running on an
already-jsonb column is a no-op (data_type check guards it).
"""
from dotenv import load_dotenv
load_dotenv()

import logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

from grc.models import SessionLocal, Tenant
from grc.db import get_tenant_engine
from sqlalchemy import text

master = SessionLocal()
try:
    tenants = master.query(Tenant).all()
finally:
    master.close()

for t in tenants:
    slug = getattr(t, "slug", None)
    if not slug:
        continue
    try:
        engine = get_tenant_engine(slug)
        with engine.begin() as conn:
            for col in ("os_keys", "target_builds"):
                current_type = conn.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_name = 'grc_compliance_plugins' "
                    "AND column_name = :c"
                ), {"c": col}).scalar()
                if current_type == "jsonb":
                    logger.info("  tenant=%-25s %s already jsonb", slug, col)
                    continue
                if current_type != "json":
                    logger.info("  tenant=%-25s %s unexpected type %r, skipping", slug, col, current_type)
                    continue
                conn.execute(text(
                    f"ALTER TABLE grc_compliance_plugins "
                    f"ALTER COLUMN {col} TYPE jsonb USING {col}::jsonb"
                ))
                logger.info("  tenant=%-25s %s json -> jsonb OK", slug, col)
    except Exception as e:  # noqa: BLE001
        logger.error("  tenant=%s ERROR: %s", slug, e)

logger.info("Done.")
