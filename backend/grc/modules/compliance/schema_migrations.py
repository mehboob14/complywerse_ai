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
    # AI-driven criticality flags on parsed framework controls. Populated on
    # demand via /certifications/{journey_id}/analyze-critical and consumed by
    # the applicability flow (critical = no self-approve, must go through
    # reviewer approval).
    ("grc_parsed_framework_controls", "is_critical", "BOOLEAN DEFAULT FALSE",
     "ix_parsed_control_critical"),
    ("grc_parsed_framework_controls", "criticality_reason", "TEXT", None),
    ("grc_parsed_framework_controls", "criticality_analyzed_at", "TIMESTAMP", None),
    # Gap-analysis remediation: AI-drafted clause text + apply-to-document
    # audit columns. Populated via /gap-analysis/findings/{id}/generate-fix
    # and /apply-fix endpoints with human-in-the-loop edit/approve.
    ("grc_policy_gap_findings", "suggested_clause_text", "TEXT", None),
    ("grc_policy_gap_findings", "suggested_clause_generated_at", "TIMESTAMP", None),
    ("grc_policy_gap_findings", "applied_at", "TIMESTAMP", None),
    ("grc_policy_gap_findings", "applied_by", "INTEGER", None),
    ("grc_policy_gap_findings", "applied_clause_text", "TEXT", None),
    # Side-by-side replace flow + version-id link for audit trail.
    ("grc_policy_gap_findings", "replacement_mode", "VARCHAR(20)", None),
    ("grc_policy_gap_findings", "original_clause_text", "TEXT", None),
    ("grc_policy_gap_findings", "applied_version_id", "INTEGER", None),
    # ERM provenance — where each risk originated (manual entry, register
    # import, assessment, incident, RCSA, framework gap, UBL/NCA bridge).
    # All nullable so existing risks remain untouched; populated by writers
    # going forward and surfaced in the new dashboards.
    ("grc_risks", "source_type", "VARCHAR(50)", "ix_grc_risks_source_type"),
    ("grc_risks", "source_assessment_id", "INTEGER", "ix_grc_risks_source_assessment_id"),
    ("grc_risks", "source_incident_id", "INTEGER", "ix_grc_risks_source_incident_id"),
    ("grc_risks", "source_rcsa_finding_id", "INTEGER", "ix_grc_risks_source_rcsa_finding_id"),
    ("grc_risks", "source_reference", "VARCHAR(255)", None),
    # Framework risk-assessment methodology fields. Populated when the
    # question was generated by a methodology-driven flow (ISO 27005, PCI
    # DSS TRA, NIST 800-30, SOC 2 TSC); NULL for AI-generated or manual
    # questions so existing rows keep working.
    ("grc_framework_risk_questions", "methodology_code", "VARCHAR(50)",
     "ix_grc_framework_risk_questions_methodology_code"),
    ("grc_framework_risk_questions", "phase_code", "VARCHAR(50)", None),
    ("grc_framework_risk_questions", "clause_reference", "VARCHAR(100)", None),
    ("grc_framework_risk_questions", "methodology_fields", "JSON", None),
    ("grc_framework_risk_questions", "source_quote", "TEXT", None),
    # Vulnerability enrichment columns — NVD / EPSS / CISA KEV. All nullable
    # with conservative defaults so existing rows stay valid; populated on
    # demand via /vulnerabilities/{id}/enrich, on ingest via Celery, and by
    # the daily refresh task.
    ("grc_vulnerabilities", "epss_score", "DOUBLE PRECISION", None),
    ("grc_vulnerabilities", "epss_percentile", "DOUBLE PRECISION",
     "ix_vuln_epss_percentile"),
    ("grc_vulnerabilities", "kev_flag", "BOOLEAN DEFAULT FALSE",
     "ix_vuln_kev_flag"),
    ("grc_vulnerabilities", "kev_date_added", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_published_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_last_modified_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_last_synced_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "exploit_references", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "composite_priority", "DOUBLE PRECISION",
     "ix_vuln_composite_priority"),
    # Account lockout + activity tracking on grc_users. All nullable so the
    # column adds are pure no-ops for existing users; login handler treats
    # NULL as "0 failed attempts / no lock / never seen activity yet".
    ("grc_users", "failed_login_attempts", "INTEGER DEFAULT 0", None),
    ("grc_users", "locked_until", "TIMESTAMP", "ix_grc_users_locked_until"),
    ("grc_users", "last_activity_at", "TIMESTAMP", None),
    ("grc_users", "password_changed_at", "TIMESTAMP", None),
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
