"""Idempotent self-heal for TPRA columns added after initial provisioning.

`Base.metadata.create_all` creates missing TABLES but not missing COLUMNS, so a
tenant provisioned before a column was introduced needs an explicit ALTER. This
mirrors the compliance module's `ensure_assigned_column` pattern: memoized per
engine so it costs a single set lookup after the first call, and best-effort
(a failure never blocks a request).
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

# Engines already healed this process (keyed by connection URL).
_HEALED: set = set()

# (table, column, DDL type) — additive, nullable, no default needed (JSON).
_TPRA_ADDS = [
    ("grc_tpra_stage_instances", "checklist", "JSON"),
    ("grc_vendor_assessments", "team_roster", "JSON"),
    ("grc_tpra_findings", "linked_issue_id", "INTEGER"),
    ("grc_tpra_monitoring_signals", "acknowledged_by", "INTEGER"),
    ("grc_tpra_monitoring_signals", "acknowledged_at", "TIMESTAMP"),
]


def ensure_tpra_columns(db: Session) -> None:
    """Add any post-provisioning TPRA columns to an existing tenant DB. Idempotent."""
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _HEALED:
        return
    try:
        for tbl, col, ddl in _TPRA_ADDS:
            db.execute(text(f"ALTER TABLE {tbl} ADD COLUMN IF NOT EXISTS {col} {ddl}"))
        db.commit()
        _HEALED.add(key)
    except Exception:  # noqa: BLE001 — self-heal must never break a request
        db.rollback()
