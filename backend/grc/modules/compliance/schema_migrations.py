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
    # Phase 5 — Asset Operational Context. All additive, no existing read
    # path depends on these. Defaults chosen so behavior is unchanged until
    # a writer populates the column.
    # 5.1 Exposure metadata
    ("grc_it_assets", "internet_facing", "BOOLEAN DEFAULT FALSE",
     "ix_it_asset_internet_facing"),
    ("grc_it_assets", "network_segment", "VARCHAR(100)", None),
    ("grc_it_assets", "data_classification", "VARCHAR(50)",
     "ix_it_asset_data_classification"),
    ("grc_it_assets", "business_function", "VARCHAR(100)", None),
    ("grc_it_assets", "compliance_scope", "JSON DEFAULT '[]'::json", None),
    # 5.2 Ownership chain — FK constraint not added by ALTER (just the
    # column). New tenant DBs get the FK via create_all; existing ones treat
    # these as plain INTEGER references.
    ("grc_it_assets", "primary_owner_id", "INTEGER", None),
    ("grc_it_assets", "secondary_owner_id", "INTEGER", None),
    ("grc_it_assets", "owning_team", "VARCHAR(100)", None),
    # FK to grc_teams.id; coexists with the legacy `owning_team` text label.
    # New writers fill the FK; old rows keep the text. The detail response
    # derives a single name from whichever is populated.
    ("grc_it_assets", "owning_team_id", "INTEGER", "ix_it_asset_owning_team_id"),
    ("grc_it_assets", "escalation_contact_id", "INTEGER", None),
    ("grc_it_assets", "business_owner_id", "INTEGER", None),
    # 5.3 Lifecycle state machine
    ("grc_it_assets", "lifecycle_state", "VARCHAR(30) DEFAULT 'active'",
     "ix_it_asset_lifecycle_state"),
    ("grc_it_assets", "decommissioned_at", "TIMESTAMP", None),
    ("grc_it_assets", "retirement_reason", "TEXT", None),
    ("grc_it_assets", "replacement_asset_id", "INTEGER", None),
    # 5.4 Derived criticality score
    ("grc_it_assets", "criticality_score", "DOUBLE PRECISION",
     "ix_it_asset_criticality_score"),
    # 5.5 Last-seen tracking
    ("grc_it_assets", "last_seen_at", "TIMESTAMP",
     "ix_it_asset_last_seen_at"),
    ("grc_it_assets", "last_seen_source", "VARCHAR(50)", None),
    # Phase 6 — Vendor Patch Intelligence (MSRC first). All nullable so the
    # column adds are no-ops for existing rows; populated on demand via
    # /vulnerabilities/{id}/sync-patch-info, on ingest via Celery, and by
    # the daily MSRC refresh task. `psirt_source` distinguishes the data
    # provider so future PSIRT connectors (Red Hat, Cisco) can share the
    # same columns without rewriting the schema.
    ("grc_vulnerabilities", "patch_references", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "vendor_advisory_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "remediation_guidance", "TEXT", None),
    ("grc_vulnerabilities", "psirt_synced_at", "TIMESTAMP",
     "ix_vuln_psirt_synced_at"),
    ("grc_vulnerabilities", "psirt_source", "VARCHAR(50)",
     "ix_vuln_psirt_source"),
    # Phase 8 — Exception Workflow state machine. Sits alongside the
    # legacy is_exception/exception_reason/exception_approved_by/
    # exception_expiry columns; new writers fill both for backward compat.
    ("grc_vulnerabilities", "exception_status", "VARCHAR(20) DEFAULT 'none'",
     "ix_vuln_exception_status"),
    ("grc_vulnerabilities", "exception_requested_by_id", "INTEGER", None),
    ("grc_vulnerabilities", "exception_requested_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "exception_justification", "TEXT", None),
    ("grc_vulnerabilities", "exception_compensating_controls",
     "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "exception_approved_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "exception_expires_at", "TIMESTAMP",
     "ix_vuln_exception_expires_at"),
    ("grc_vulnerabilities", "exception_denial_reason", "TEXT", None),
    ("grc_vulnerabilities", "exception_revoked_by_id", "INTEGER", None),
    ("grc_vulnerabilities", "exception_revoked_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "exception_revocation_reason", "TEXT", None),
    ("grc_vulnerabilities", "exception_metadata",
     "JSON DEFAULT '{}'::json", None),
    # Gap-close 2026-05-12 — VulnerabilityAssetLink provenance. `link_source`
    # records which code path created the link (manual / scanner /
    # cpe_match / cloud_sync / nca_bridge). `auto_linked` is the binary
    # "automation created this" flag used by the Auto badge in the UI.
    # Default values are chosen so existing rows look like manually created
    # links — the UI hides the Auto badge for `auto_linked=False`.
    ("grc_vulnerability_asset_links", "link_source",
     "VARCHAR(50) DEFAULT 'manual'", "ix_vuln_asset_link_source"),
    ("grc_vulnerability_asset_links", "auto_linked",
     "BOOLEAN DEFAULT FALSE", "ix_vuln_asset_link_auto"),
    # `lead_user_id` lives on the Team model; the table is auto-created via
    # Base.metadata.create_all so no entries are needed for grc_teams /
    # grc_team_members. This is the only ALTER needed for the Teams feature:
    # the ITAsset.owning_team_id FK above.
    # Committee charter — structured sections JSON for uploaded charters
    # so they render in the same UI as AI-drafted ones.
    ("grc_committee_charters", "sections_json", "JSON", None),
    # External connector framework — extends IntegrationConnection beyond
    # the original Nessus/Nexpose scope to cover ticketing, SIEM, pen-test,
    # collaboration, and transcription connectors.
    ("grc_integration_connections", "category",
     "VARCHAR(30) DEFAULT 'vuln_scanner'", "ix_connection_category"),
    ("grc_integration_connections", "encrypted_credentials", "TEXT", None),
    ("grc_integration_connections", "oauth_tokens", "TEXT", None),
    ("grc_integration_connections", "provider_config", "JSON", None),
    # ITAsset — manual criticality override audit columns. `criticality_score`
    # is always system-computed; the textual `criticality` bucket can be
    # overridden by a user with a reason captured here for the audit trail.
    ("grc_it_assets", "criticality_manual_override", "BOOLEAN DEFAULT FALSE", None),
    ("grc_it_assets", "criticality_override_reason", "TEXT", None),
]


def _backfill_framework_assessment_register_type(engine: Engine) -> None:
    """One-shot data backfill.

    Earlier code in `framework_risk_assessments.py:move_framework_question_to_risk_register`
    tagged every risk that came from a framework risk assessment with
    `register_type = "Framework Assessment #<assessment_id>"` — a value
    that doesn't match the framework's short_code, so:

      • the Risk Register filter dropdown showed "Framework Assessment #42"
        as an option rather than "SWIFT" / "PCI-DSS" / etc.,
      • the Auditor Portal `/risks` endpoint, which filters by
        `register_type == framework.short_code`, returned an empty list.

    The writer is now fixed (uses the framework's short_code or name).
    This backfill re-tags the historical rows so they show up consistently
    in both the filter dropdown and the auditor portal.

    Idempotent: a row that already has a non-legacy `register_type` is
    skipped. Safe on every restart — runs once per engine via the
    `_ensure_for_engine` memoisation.
    """
    try:
        inspector = inspect(engine)
        # Quick guards — bail if the schema isn't ready.
        if not inspector.has_table("grc_risks"):
            return
        if not inspector.has_table("grc_framework_risk_assessments"):
            return
        risk_cols = {c["name"] for c in inspector.get_columns("grc_risks")}
        if "register_type" not in risk_cols:
            return

        with engine.begin() as conn:
            rows = conn.execute(text(
                """
                SELECT id, register_type
                FROM grc_risks
                WHERE register_type LIKE 'Framework Assessment #%'
                """
            )).fetchall()

            if not rows:
                return

            for risk_id, register_type in rows:
                # Parse the assessment id out of the legacy tag.
                try:
                    assessment_id = int(str(register_type).rsplit("#", 1)[-1])
                except (ValueError, IndexError):
                    continue

                assessment_row = conn.execute(text(
                    """
                    SELECT a.id, a.framework_id, a.uploaded_framework_id,
                           f.short_code AS framework_short_code,
                           f.name AS framework_name,
                           uf.name AS uploaded_framework_name
                    FROM grc_framework_risk_assessments a
                    LEFT JOIN grc_frameworks f ON f.id = a.framework_id
                    LEFT JOIN grc_uploaded_frameworks uf ON uf.id = a.uploaded_framework_id
                    WHERE a.id = :aid
                    """
                ), {"aid": assessment_id}).fetchone()
                if not assessment_row:
                    continue

                short_code = (assessment_row[3] or "").strip() if assessment_row[3] else ""
                fw_name = (assessment_row[4] or "").strip() if assessment_row[4] else ""
                uf_name = (assessment_row[5] or "").strip() if assessment_row[5] else ""
                new_register_type = short_code or fw_name or uf_name
                if not new_register_type:
                    continue

                conn.execute(text(
                    """
                    UPDATE grc_risks
                    SET register_type = :rt,
                        source_type = COALESCE(source_type, 'assessment'),
                        source_reference = COALESCE(source_reference, :sref)
                    WHERE id = :rid
                    """
                ), {
                    "rt": new_register_type,
                    "sref": f"framework_assessment:{assessment_id}",
                    "rid": risk_id,
                })
            logger.info(
                "Backfilled framework_assessment register_type for %d legacy risk row(s) on %s",
                len(rows), getattr(engine.url, "database", "?"),
            )
    except Exception:
        logger.exception("Failed framework_assessment register_type backfill")


def _ensure_column_nullable(engine: Engine, table: str, column: str) -> None:
    """Drop NOT NULL on an existing column. Idempotent — a column that's
    already nullable raises no error on Postgres. Used by the connector
    framework migration which relaxed `credential_env_prefix` from
    NOT NULL to nullable for non-scanner integrations.
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return
        cols = {c["name"]: c for c in inspector.get_columns(table)}
        if column not in cols:
            return
        if cols[column].get("nullable", True):
            return
        with engine.begin() as conn:
            conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))
        logger.info("Relaxed NOT NULL on %s.%s on engine %s", table, column, engine.url.database)
    except Exception:
        logger.exception("Failed to relax NOT NULL on %s.%s", table, column)


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

        # Relax NOT NULL on columns the connector framework needs to leave
        # empty for non-scanner providers. Idempotent.
        _ensure_column_nullable(engine, "grc_integration_connections", "credential_env_prefix")

        # One-shot data backfill: re-tag legacy "Framework Assessment #<id>"
        # risks with their actual framework short_code/name so the Risk
        # Register filter dropdown and the Auditor Portal `/risks` view both
        # find them. Idempotent — rows already migrated have a non-legacy
        # `register_type` and are skipped on subsequent runs.
        _backfill_framework_assessment_register_type(engine)

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
