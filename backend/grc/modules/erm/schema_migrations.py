"""Idempotent self-heal for Incident Management columns / link tables.

`create_all` creates missing tables but not missing columns on existing DBs.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

_HEALED: set = set()
_LABELS_HEALED: set = set()


def ensure_register_labels(db: Session) -> None:
    """Retag legacy '1LINK ERM RCSA' risks as '1LINK' — the register was renamed
    so 1LINK and RCSA are separate register types. Idempotent, once per bind."""
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _LABELS_HEALED:
        return
    try:
        db.execute(text(
            "UPDATE grc_risks SET register_type = '1LINK' "
            "WHERE register_type = '1LINK ERM RCSA'"
        ))
        db.commit()
        _LABELS_HEALED.add(key)
    except Exception:  # noqa: BLE001
        db.rollback()


def ensure_incident_schema(db: Session) -> None:
    """Add tags column + ensure link tables exist. Safe to call repeatedly."""
    try:
        bind = db.get_bind()
        key = str(getattr(bind, "url", bind))
    except Exception:  # noqa: BLE001
        key = "default"
    if key in _HEALED:
        return
    try:
        db.execute(text(
            "ALTER TABLE grc_risk_incidents ADD COLUMN IF NOT EXISTS tags JSON"
        ))
        # Link tables — create_all covers new tenants; these catch older DBs.
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS grc_incident_asset_links (
                id SERIAL PRIMARY KEY,
                incident_id INTEGER NOT NULL REFERENCES grc_risk_incidents(id),
                asset_id INTEGER NOT NULL REFERENCES grc_it_assets(id),
                notes TEXT,
                created_at TIMESTAMP,
                created_by INTEGER REFERENCES grc_users(id)
            )
        """))
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS grc_incident_vulnerability_links (
                id SERIAL PRIMARY KEY,
                incident_id INTEGER NOT NULL REFERENCES grc_risk_incidents(id),
                vulnerability_id INTEGER NOT NULL REFERENCES grc_vulnerabilities(id),
                notes TEXT,
                created_at TIMESTAMP,
                created_by INTEGER REFERENCES grc_users(id)
            )
        """))
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS grc_incident_risk_links (
                id SERIAL PRIMARY KEY,
                incident_id INTEGER NOT NULL REFERENCES grc_risk_incidents(id),
                risk_id INTEGER NOT NULL REFERENCES grc_risks(id),
                notes TEXT,
                created_at TIMESTAMP,
                created_by INTEGER REFERENCES grc_users(id)
            )
        """))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_asset_link "
            "ON grc_incident_asset_links (incident_id, asset_id)"
        ))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_vuln_link "
            "ON grc_incident_vulnerability_links (incident_id, vulnerability_id)"
        ))
        db.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_risk_link "
            "ON grc_incident_risk_links (incident_id, risk_id)"
        ))
        db.commit()
        _HEALED.add(key)
    except Exception:  # noqa: BLE001
        db.rollback()
