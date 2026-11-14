"""Additive column self-heal for the advisory tables.

``create_all`` only creates missing *tables*, not missing *columns*, so a column
added to an already-provisioned ``grc_advisories`` must be ALTERed in. Mapped
columns are emitted on every INSERT/SELECT, so this MUST run before any advisory
query on an un-migrated DB. Registered once from ``db.py`` per tenant engine,
mirroring the identity module's self-heal.
"""
from __future__ import annotations

from sqlalchemy import inspect as sa_inspect, text
from sqlalchemy.engine import Engine


def ensure_advisory_columns(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    inspector = sa_inspect(engine)
    if not inspector.has_table("grc_advisories"):
        return
    # Existence check first (metadata-only, no table lock) so the migrated path
    # — the normal case — never takes an ACCESS EXCLUSIVE lock on the table.
    if any(c["name"] == "extraction_meta" for c in inspector.get_columns("grc_advisories")):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE grc_advisories ADD COLUMN IF NOT EXISTS extraction_meta JSON"
        ))
