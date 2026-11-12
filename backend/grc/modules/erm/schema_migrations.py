"""Idempotent self-heal for Incident Management columns / link tables.

`create_all` creates missing tables but not missing columns on existing DBs.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

_HEALED: set = set()
_LABELS_HEALED: set = set()

# Columns the Risk Management redesign adds to existing tables: (table, column, Postgres type). New tables come from create_all.
# Each build area owns one list; _ensure_for_engine (called from db._init_tenant_schema) adds them to every tenant database.
_REGISTER_COLUMNS: list = [      # risk record: owner, target, response, acceptance, review
    ("grc_risks", "target_likelihood", "INTEGER"),
    ("grc_risks", "target_impact", "INTEGER"),
    ("grc_risks", "target_score", "DOUBLE PRECISION"),
    ("grc_risks", "response", "VARCHAR(20)"),
    ("grc_risks", "acceptance_status", "VARCHAR(20)"),
    ("grc_risks", "acceptance_reason", "TEXT"),
    ("grc_risks", "acceptance_requested_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risks", "acceptance_requested_at", "TIMESTAMP"),
    ("grc_risks", "accepted_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risks", "accepted_at", "TIMESTAMP"),
    ("grc_risks", "acceptance_expires_at", "TIMESTAMP"),
    ("grc_risk_score_history", "target_score", "DOUBLE PRECISION"),
    ("grc_risk_score_history", "reason", "TEXT"),
]
_LOSS_COLUMNS: list = [          # Basel loss events on grc_risk_incidents
    ("grc_risk_incidents", "event_type", "VARCHAR(50)"),
    ("grc_risk_incidents", "event_type_l2", "VARCHAR(255)"),
    ("grc_risk_incidents", "business_line", "VARCHAR(50)"),
    ("grc_risk_incidents", "gross_loss", "NUMERIC(18,2)"),
    ("grc_risk_incidents", "recoveries", "NUMERIC(18,2)"),
    ("grc_risk_incidents", "net_loss", "NUMERIC(18,2)"),
    ("grc_risk_incidents", "currency", "VARCHAR(3)"),
    ("grc_risk_incidents", "accounting_date", "TIMESTAMP"),
    ("grc_risk_incidents", "is_near_miss", "BOOLEAN"),
    ("grc_risk_incidents", "boundary_type", "VARCHAR(20)"),
    ("grc_risk_incidents", "validation_status", "VARCHAR(20)"),
    ("grc_risk_incidents", "validated_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_incidents", "validated_at", "TIMESTAMP"),
    ("grc_risk_incidents", "validation_note", "TEXT"),
]
_APPROVAL_COLUMNS: list = [      # maker-checker: who submitted / completed a piece of work
    ("grc_rcsa_assessments", "submitted_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_internal_controls", "submitted_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_assessments", "submitted_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_issue_actions", "completed_by", "INTEGER REFERENCES grc_users(id)"),
]
_ACTION_COLUMNS: list = [        # risk actions on the CAPA engine (the old mitigation-action fields; the legacy marker)
    ("grc_issue_actions", "priority", "VARCHAR(20)"),
    ("grc_issue_actions", "expected_residual_reduction", "DOUBLE PRECISION"),
    ("grc_issue_actions", "actual_residual_reduction", "DOUBLE PRECISION"),
    ("grc_issue_actions", "notes", "TEXT"),
    ("grc_issue_actions", "legacy_mitigation_action_id", "INTEGER"),
    ("grc_risk_mitigation_actions", "migrated_to_issue_action_id", "INTEGER"),
]
_APPETITE_COLUMNS: list = [      # appetite limits linked to KRIs (statements and breaches are new tables)
    ("grc_risk_appetite_config", "limit_kri_ids", "JSON"),
]
_REVIEW_COLUMNS: list = [        # risk reviews: the proposal a second person approves
    ("grc_risk_reviews", "proposed_inherent_likelihood", "INTEGER"),
    ("grc_risk_reviews", "proposed_inherent_impact", "INTEGER"),
    ("grc_risk_reviews", "proposed_residual_likelihood", "INTEGER"),
    ("grc_risk_reviews", "proposed_residual_impact", "INTEGER"),
    ("grc_risk_reviews", "submitted_by", "INTEGER REFERENCES grc_users(id)"),
]
_KRI_COLUMNS: list = [           # KRIs: a new indicator is a draft until a second person approves it
    ("grc_risk_kris", "status", "VARCHAR(20)"),
    ("grc_risk_kris", "created_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_kris", "approved_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_kris", "approved_at", "TIMESTAMP"),
]
_PACK_COLUMNS: list = [          # committee packs on grc_risk_reports: committee, meeting, commentary, who froze it
    ("grc_risk_reports", "committee_id", "INTEGER REFERENCES grc_governance_committees(id)"),
    ("grc_risk_reports", "meeting_id", "INTEGER REFERENCES grc_committee_meetings(id)"),
    ("grc_risk_reports", "commentary", "JSON"),
    ("grc_risk_reports", "approved_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_reports", "approved_at", "TIMESTAMP"),
]
_RCSA_COLUMNS: list = [          # RCSA: template versions; questions linked to register risks and controls
    ("grc_rcsa_templates", "previous_version_id", "INTEGER REFERENCES grc_rcsa_templates(id)"),
    ("grc_rcsa_questions", "risk_id", "INTEGER REFERENCES grc_risks(id)"),
    ("grc_rcsa_questions", "internal_control_id", "INTEGER REFERENCES grc_internal_controls(id)"),
]
_ASSESSMENT_COLUMNS: list = [    # framework IT risk assessments: completed, then approved by a second person
    ("grc_framework_risk_assessments", "submitted_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_framework_risk_assessments", "approved_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_framework_risk_assessments", "approved_at", "TIMESTAMP"),
]
_TPRM_COLUMNS: list = [         # third party where it meets ERM: materiality, exit plan, notice, sub-outsourcing, committee
    ("grc_vendors", "critical_important", "BOOLEAN"),
    ("grc_vendors", "outsourcing", "JSON"),
    ("grc_tpra_engagements", "critical_important", "BOOLEAN"),
    ("grc_tpra_engagements", "outsourcing", "JSON"),
    ("grc_tpra_fourth_parties", "approval_status", "VARCHAR(20)"),
    ("grc_tpra_fourth_parties", "approval", "JSON"),
    ("grc_tpra_approvals", "committee_id", "INTEGER REFERENCES grc_governance_committees(id)"),
    ("grc_tpra_approvals", "meeting_id", "INTEGER REFERENCES grc_committee_meetings(id)"),
    ("grc_vendor_incidents", "loss_event_id", "INTEGER REFERENCES grc_risk_incidents(id)"),
    ("grc_risk_appetite_config", "concentration_limit", "INTEGER"),
]
_LINK_COLUMNS: list = [         # the one risk–control link carries what the old link tables said (and FAIR's effect)
    ("grc_risk_controls", "effectiveness_rating", "VARCHAR(50)"),
    ("grc_risk_controls", "mitigation_effectiveness", "VARCHAR(50)"),
    ("grc_risk_controls", "freq_reduction_min_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "freq_reduction_ml_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "freq_reduction_max_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "mag_reduction_min_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "mag_reduction_ml_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "mag_reduction_max_pct", "DOUBLE PRECISION"),
    ("grc_risk_controls", "effect_rationale", "TEXT"),
    ("grc_risk_controls", "effect_updated_by", "INTEGER REFERENCES grc_users(id)"),
    ("grc_risk_controls", "effect_updated_at", "TIMESTAMP"),
]
_MONITOR_COLUMNS: list = [      # KRI threshold changes and appetite limit changes decided by a second person; frozen limits
    ("grc_risk_kris", "threshold_change", "JSON"),
    ("grc_risk_appetite_config", "limit_change", "JSON"),
    ("grc_risk_appetite_statements", "limits", "JSON"),
]
# One open appetite breach per subject: duplicates a race left behind are resolved (the oldest stays) before the index.
_OPEN_BREACH_INDEX = [
    """UPDATE grc_risk_appetite_breaches b SET status = 'resolved', resolved_at = NOW()
       WHERE b.status <> 'resolved' AND EXISTS (SELECT 1 FROM grc_risk_appetite_breaches o WHERE o.status <> 'resolved'
         AND o.tenant_id = b.tenant_id AND o.category = b.category AND COALESCE(o.risk_id, 0) = COALESCE(b.risk_id, 0)
         AND COALESCE(o.kri_id, 0) = COALESCE(b.kri_id, 0) AND o.id < b.id)""",
    """CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_appetite_open_breach ON grc_risk_appetite_breaches
       (tenant_id, category, COALESCE(risk_id, 0), COALESCE(kri_id, 0)) WHERE status <> 'resolved'""",
]


def _ensure_monitor_for_engine(engine) -> None:
    """The open-breach index, in its own transaction so a failure there never undoes the columns."""
    with engine.begin() as conn:
        for sql in _OPEN_BREACH_INDEX:
            conn.execute(text(sql))


def _ensure_for_engine(engine) -> None:
    """Add the redesign's columns to an existing tenant database. Idempotent; Postgres only."""
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        for table, column, sql_type in (*_REGISTER_COLUMNS, *_LOSS_COLUMNS, *_APPROVAL_COLUMNS, *_ACTION_COLUMNS, *_APPETITE_COLUMNS, *_REVIEW_COLUMNS, *_KRI_COLUMNS, *_PACK_COLUMNS, *_RCSA_COLUMNS, *_ASSESSMENT_COLUMNS, *_TPRM_COLUMNS, *_LINK_COLUMNS, *_MONITOR_COLUMNS):
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {sql_type}"))
    from .services.risk_control_links import copy_legacy_links_for_engine
    copy_legacy_links_for_engine(engine)        # once per database: the old risk–control link rows, after the columns exist
    _ensure_monitor_for_engine(engine)


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
