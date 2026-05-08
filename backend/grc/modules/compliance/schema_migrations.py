"""Idempotent column-add migrations for the compliance module.

Per-tenant DBs are originally provisioned with `Base.metadata.create_all`, which
creates new tables but does NOT add columns to tables that already exist. When a
new column is introduced on a model, existing tenant DBs need an explicit
`ALTER TABLE`.

This module exposes two flavors of self-heal:

1. `ensure_compliance_columns()` — startup walk over every tenant slug listed
   in the master catalog. Best-effort; if the master DB is unreachable or a
   tenant DB is missing entries, it logs and moves on.

2. `ensure_assigned_column(db)` — request-time helper that operates on the
   bound engine of an active session. The result is memoized per-engine, so
   the inspection + ALTER only runs once per tenant DB in the process
   lifetime. This is the reliable path: every request that hits the policy
   statements / governance documents code touches it before issuing the
   ORM query, so even tenants the startup walk missed are healed lazily.
"""

import logging
import threading
from typing import Set

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from ...db import MasterSession, get_tenant_engine

logger = logging.getLogger(__name__)

# Engines we have already verified for the current process. Keyed by id() of
# the Engine — Engine instances are cached per slug in `db._tenant_engines`,
# so this stays bounded by the number of tenants the process has touched.
_ensured_engines: Set[int] = set()
_ensured_lock = threading.Lock()


def _ensure_column(engine: Engine, table: str, column: str, ddl_type: str) -> bool:
    """Add the column if missing. Returns True on success or no-op, False on failure."""
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return True
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            return True
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}'))
        logger.info("Added column %s.%s on engine %s", table, column, engine.url.database)
        return True
    except Exception:
        logger.exception("Failed to ensure column %s.%s on engine %s",
                         table, column, getattr(engine.url, "database", "?"))
        return False


def _ensure_index(engine: Engine, table: str, column: str, index_name: str) -> None:
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return
        indexes = {ix["name"] for ix in inspector.get_indexes(table)}
        if index_name in indexes:
            return
        with engine.begin() as conn:
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"
            ))
    except Exception:
        logger.exception("Failed to create index %s on %s.%s", index_name, table, column)


# Each tuple: (table, column, ddl_type, optional_index_name)
# Postgres types. ddl_type may include defaults (e.g. "TIMESTAMP DEFAULT NOW()")
# for columns we want backfilled on existing rows.
_COLUMN_ADDS = [
    ("grc_policy_statements", "assigned_to_user_id", "INTEGER",
     "ix_grc_policy_statements_assigned_to_user_id"),
    ("grc_roles", "created_at", "TIMESTAMP DEFAULT NOW()", None),
    ("grc_roles", "updated_at", "TIMESTAMP DEFAULT NOW()", None),
    ("grc_user_roles", "assigned_by", "INTEGER", None),
    ("grc_user_roles", "assigned_at", "TIMESTAMP DEFAULT NOW()", None),
    ("grc_control_implementations", "assigned_to_user_id", "INTEGER",
     "ix_grc_control_implementations_assigned_to_user_id"),
    ("grc_control_implementations", "assigned_user_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_critical_tasks", "assigned_user_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_critical_tasks", "linked_framework_id", "INTEGER",
     "ix_grc_critical_tasks_linked_framework_id"),
    ("grc_critical_tasks", "linked_requirement_id", "INTEGER",
     "ix_grc_critical_tasks_linked_requirement_id"),
    # DCC assessment item columns
    ("grc_compliance_assessment_document_items", "control_source", "VARCHAR(50)", None),
    ("grc_compliance_assessment_document_items", "control_type", "VARCHAR(20)", None),
    ("grc_compliance_assessment_document_items", "subdomain_name", "TEXT", None),
    # NCA risk register: platform-aware ownership + asset linking
    ("grc_nca_risk_entries", "risk_owner_user_id", "INTEGER", None),
    ("grc_nca_risk_entries", "treatment_owner_user_id", "INTEGER", None),
    ("grc_nca_risk_entries", "linked_asset_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_risk_entries", "linked_control_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_risk_entries", "mitigation_actions", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_risk_entries", "lifecycle_status", "VARCHAR(30) DEFAULT 'open'", None),
    ("grc_nca_risk_entries", "bridged_risk_id", "INTEGER",
     "ix_grc_nca_risk_entries_bridged_risk_id"),
    # NCA vuln register: parity feature columns
    ("grc_nca_vuln_entries", "owner_user_id", "INTEGER", None),
    ("grc_nca_vuln_entries", "linked_asset_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_vuln_entries", "linked_control_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_vuln_entries", "mitigation_actions", "JSON DEFAULT '[]'::json", None),
    ("grc_nca_vuln_entries", "bridged_vulnerability_id", "INTEGER",
     "ix_grc_nca_vuln_entries_bridged_vulnerability_id"),
    # Tag general vulns with their template source (e.g. "NCA Template")
    ("grc_vulnerabilities", "template_type", "VARCHAR(50)",
     "ix_grc_vulnerabilities_template_type"),
    # Verbatim NCA template fields preserved on bridged Vulnerability rows so
    # the general detail page can render the full NCA register data.
    ("grc_vulnerabilities", "template_fields", "JSON DEFAULT '{}'::json", None),
    # Same for Risk — verbatim NCA template fields preserved on bridged Risk rows.
    ("grc_risks", "template_fields", "JSON DEFAULT '{}'::json", None),
]


def _ensure_for_engine(engine: Engine) -> None:
    """Apply all registered column adds against a single engine. Memoized."""
    key = id(engine)
    if key in _ensured_engines:
        return
    with _ensured_lock:
        if key in _ensured_engines:
            return

        # Create any tables that are in the ORM models but missing from the DB.
        # This handles new tables introduced after a tenant DB was provisioned.
        try:
            from ...models import Base
            Base.metadata.create_all(engine, checkfirst=True)
        except Exception:
            logger.exception("Failed to create missing tables on engine %s", getattr(engine.url, "database", "?"))

        all_ok = True
        for table, column, ddl_type, index_name in _COLUMN_ADDS:
            ok = _ensure_column(engine, table=table, column=column, ddl_type=ddl_type)
            all_ok = all_ok and ok
            if ok and index_name:
                _ensure_index(engine, table=table, column=column, index_name=index_name)
        # Only mark the engine as "ensured" if every column add succeeded (or
        # was a no-op) — otherwise let a later request retry, since the
        # underlying issue might be transient.
        if all_ok:
            _ensured_engines.add(key)


def ensure_assigned_column(db: Session) -> None:
    """Request-time helper: ensure the active session's tenant DB has the
    `grc_policy_statements.assigned_to_user_id` column. Cheap after the first
    call per engine.
    """
    bind = db.get_bind()
    if bind is None:
        return
    if not isinstance(bind, Engine):
        # Connection objects expose `engine`; fall back to that.
        engine = getattr(bind, "engine", None)
        if engine is None:
            return
        bind = engine
    _ensure_for_engine(bind)


def _iter_tenant_slugs():
    from ...models import Tenant  # local import to avoid circulars at import time

    master = MasterSession()
    try:
        rows = master.query(Tenant.slug).all()
    finally:
        master.close()
    return [r[0] for r in rows if r[0]]


def ensure_compliance_columns() -> None:
    """Walk all tenants in the master catalog and add any missing compliance
    columns. Failures are logged and skipped — request-time `ensure_assigned_column`
    is the reliable backstop.
    """
    try:
        slugs = _iter_tenant_slugs()
    except Exception:
        logger.exception("Could not enumerate tenants for compliance column self-heal")
        return

    for slug in slugs:
        try:
            engine = get_tenant_engine(slug)
        except Exception:
            logger.exception("Could not get engine for tenant slug=%s", slug)
            continue
        _ensure_for_engine(engine)
