"""Idempotent column-add migrations for identity-provider integration.

Mirrors the compliance pattern (see grc.modules.compliance.schema_migrations):
  * `Base.metadata.create_all` creates new tables, but does NOT add columns
    to tables that already exist on a previously-provisioned tenant DB.
  * This module exposes `_ensure_for_engine(engine)` to be called from
    `db.get_tenant_engine` after `create_all`, lazily healing each tenant DB
    once per process lifetime.
"""

import logging
import threading
from typing import Set

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

_ensured_engines: Set[int] = set()
_ensured_lock = threading.Lock()


def _ensure_column(engine: Engine, table: str, column: str, ddl_type: str) -> bool:
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return True
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            return True
        with engine.begin() as conn:
            conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}'))
        logger.info("Added column %s.%s on engine %s", table, column,
                    getattr(engine.url, "database", "?"))
        return True
    except Exception:
        logger.exception("Failed to ensure column %s.%s on engine %s",
                         table, column, getattr(engine.url, "database", "?"))
        return False


def _ensure_password_hash_nullable(engine: Engine) -> None:
    """Drop the legacy NOT NULL constraint on grc_users.password_hash so federated
    (SSO) users can be persisted without a local password. Idempotent."""
    try:
        inspector = inspect(engine)
        if not inspector.has_table("grc_users"):
            return
        cols = {c["name"]: c for c in inspector.get_columns("grc_users")}
        col = cols.get("password_hash")
        if not col or col.get("nullable", True):
            return  # already nullable, nothing to do
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE grc_users ALTER COLUMN password_hash DROP NOT NULL"))
        logger.info("Dropped NOT NULL on grc_users.password_hash")
    except Exception:
        logger.exception("Failed to drop NOT NULL on grc_users.password_hash")


def _ensure_index(engine: Engine, table: str, columns: str, index_name: str) -> None:
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return
        indexes = {ix["name"] for ix in inspector.get_indexes(table)}
        if index_name in indexes:
            return
        with engine.begin() as conn:
            conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({columns})"
            ))
    except Exception:
        logger.exception("Failed to create index %s on %s(%s)", index_name, table, columns)


# Each tuple: (table, column, ddl_type)
_COLUMN_ADDS = [
    ("grc_users", "external_provider", "VARCHAR(32)"),
    ("grc_users", "external_id", "VARCHAR(128)"),
    ("grc_user_roles", "source", "VARCHAR(16)"),
    # SaaS multi-tenant Entra columns
    ("grc_identity_provider_configs", "entra_directory_id", "VARCHAR(64)"),
    ("grc_identity_provider_configs", "connected_at", "TIMESTAMP"),
    ("grc_identity_provider_configs", "connected_by_id", "INTEGER"),
]

_INDEX_ADDS = [
    # (table, columns expr, index name)
    ("grc_users", "external_provider", "ix_grc_users_external_provider"),
    ("grc_users", "external_id", "ix_grc_users_external_id"),
    ("grc_users", "external_provider, external_id", "ix_grc_users_external"),
    ("grc_identity_provider_configs", "entra_directory_id",
     "ix_idp_entra_directory_id"),
]


# Columns to drop NOT NULL on (because the SaaS-pattern flow doesn't fill them).
# Legacy rows written under the previous per-tenant-Azure-app design keep their
# values; new rows leave these NULL.
_NULLABLE_RELAXATIONS = [
    ("grc_identity_provider_configs", "azure_tenant_id"),
    ("grc_identity_provider_configs", "client_id"),
    ("grc_identity_provider_configs", "client_secret_encrypted"),
    ("grc_identity_provider_configs", "redirect_uri"),
]


def _ensure_column_nullable(engine: Engine, table: str, column: str) -> None:
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return
        cols = {c["name"]: c for c in inspector.get_columns(table)}
        col = cols.get(column)
        if not col or col.get("nullable", True):
            return
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))
        logger.info("Dropped NOT NULL on %s.%s", table, column)
    except Exception:
        logger.exception("Failed to drop NOT NULL on %s.%s", table, column)


def _ensure_for_engine(engine: Engine) -> None:
    """Apply identity-related column adds + index adds against a single engine.
    Memoized per Engine instance for the process lifetime."""
    key = id(engine)
    if key in _ensured_engines:
        return
    with _ensured_lock:
        if key in _ensured_engines:
            return
        all_ok = True
        for table, column, ddl_type in _COLUMN_ADDS:
            ok = _ensure_column(engine, table=table, column=column, ddl_type=ddl_type)
            all_ok = all_ok and ok
        _ensure_password_hash_nullable(engine)
        for table, column in _NULLABLE_RELAXATIONS:
            _ensure_column_nullable(engine, table=table, column=column)
        for table, columns, index_name in _INDEX_ADDS:
            _ensure_index(engine, table=table, columns=columns, index_name=index_name)
        if all_ok:
            _ensured_engines.add(key)
