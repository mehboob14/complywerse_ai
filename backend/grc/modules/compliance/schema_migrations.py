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
    """Add the column if missing. Returns True on success or no-op, False on failure.

    Uses ``ADD COLUMN IF NOT EXISTS`` on Postgres and treats DuplicateColumn /
    concurrent-add races as success so multi-worker startup does not ERROR-spam.
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return True
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column in existing:
            return True
        if engine.dialect.name == "postgresql":
            ddl = f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl_type}'
        else:
            ddl = f'ALTER TABLE {table} ADD COLUMN {column} {ddl_type}'
        with engine.begin() as conn:
            conn.execute(text(ddl))
        logger.info("Added column %s.%s on engine %s", table, column, engine.url.database)
        return True
    except Exception as e:
        from ...db import is_schema_already_exists_error

        if is_schema_already_exists_error(e):
            logger.debug(
                "Column %s.%s already exists on engine %s (concurrent ensure)",
                table, column, getattr(engine.url, "database", "?"),
            )
            return True
        logger.exception("Failed to ensure column %s.%s on engine %s",
                         table, column, getattr(engine.url, "database", "?"))
        return False


def _ensure_column_type(
    engine: Engine, table: str, column: str, expected_type: str,
) -> bool:
    """Convert a column to the expected type if it's currently a different type.

    Only ALTERs if the type is wrong — idempotent + safe to run on every
    process start. Used for the os_keys / target_builds jsonb fixup:
    tenants created BEFORE those columns were declared JSONB still have
    them as plain JSON, which breaks jsonb_array_elements_text() in the
    /library-tree endpoint.

    The USING clause does an in-place conversion. For json→jsonb this
    is lossless. Failed conversions don't raise; they log + return False
    so the request can still complete.
    """
    try:
        inspector = inspect(engine)
        if not inspector.has_table(table):
            return True
        cols = inspector.get_columns(table)
        target = next((c for c in cols if c["name"] == column), None)
        if not target:
            return True  # column doesn't exist yet → _ensure_column will add it
        # Postgres reports JSON as "JSON" and JSONB as "JSONB" via type
        # string. Compare case-insensitively against the expected name
        # (we only call this for jsonb fixups today).
        current = str(target["type"]).upper()
        if expected_type.upper() in current:
            return True  # already correct
        with engine.begin() as conn:
            sql = (
                f'ALTER TABLE {table} ALTER COLUMN {column} '
                f'TYPE {expected_type} USING {column}::{expected_type.lower()}'
            )
            conn.execute(text(sql))
        logger.info(
            "Upgraded column type %s.%s: %s → %s on engine %s",
            table, column, current, expected_type,
            getattr(engine.url, "database", "?"),
        )
        return True
    except Exception:
        logger.exception(
            "Failed to convert column type %s.%s to %s on engine %s",
            table, column, expected_type,
            getattr(engine.url, "database", "?"),
        )
        return False


# Type fixups: columns that landed with the wrong type on some tenant
# DBs (typically a legacy JSON when the schema now requires JSONB).
# _ensure_column won't catch these because it skips when the column
# already exists; _ensure_column_type does the conversion idempotently.
_COLUMN_TYPE_FIXUPS = [
    # /library-tree uses jsonb_array_elements_text(os_keys); JSON breaks.
    ("grc_compliance_plugins", "os_keys", "JSONB"),
    # /os-registry uses jsonb operators on target_builds too.
    ("grc_compliance_plugins", "target_builds", "JSONB"),
]


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
    # IT assets host-applications model (Updated_CIS_Assests migration).
    # detected_software_json holds the enriched inventory the agent / agentless
    # scanner writes. asset_role + parent_asset_id support promoting an
    # application detected on a host into its own child asset.
    ("grc_it_assets", "detected_software_json", "JSON DEFAULT '[]'::json", None),
    ("grc_it_assets", "asset_role", "VARCHAR(50)", None),
    ("grc_it_assets", "parent_asset_id", "INTEGER",
     "ix_grc_it_assets_parent_asset_id"),
    # Per-application properties. One ITAsset row cannot carry a column for
    # every product's own attributes (PostgreSQL has a data directory and
    # listen_addresses; IIS has sites and app pools; Cisco has an IOS image) —
    # so a promoted application stored a name and a version and nothing else.
    # This holds the software's OWN facts, collected by software_profiler.
    ("grc_it_assets", "app_attributes_json", "JSON", None),
    # Typed-asset model: per-platform component block + the kind that drives
    # which dedicated detail card renders (server/database/network/cloud/…).
    ("grc_it_assets", "platform_kind", "VARCHAR(30)",
     "ix_grc_it_assets_platform_kind"),
    ("grc_it_assets", "platform_properties", "JSON", None),
    # Unified saved-login model: every connect type (DB/cloud/network/…) can be
    # saved as a reusable credential, not just hosts. integration_type drives the
    # UI category + reuse; extra_json holds the type-specific encrypted creds.
    ("grc_credential_profiles", "integration_type", "VARCHAR(50)",
     "ix_grc_credential_profiles_integration_type"),
    ("grc_credential_profiles", "extra_json", "JSON", None),
    # Per-campaign SNMP read communities for discovery fingerprinting.
    ("grc_discovery_campaigns", "snmp_communities", "VARCHAR(500)", None),
    # Collector routing for plugin runs (Updated_CIS_Assests migration).
    ("grc_integration_connections", "assigned_collector_agent_id", "INTEGER",
     "ix_grc_integration_connections_assigned_collector_agent_id"),
    ("grc_compliance_plugin_runs", "executed_by_agent_id", "INTEGER",
     "ix_grc_compliance_plugin_runs_executed_by_agent_id"),
    # Vulnerability register grouping — scanner-provided family (Windows,
    # Databases, Web Servers, Misc. …) used as the runtime "domain" the
    # register groups findings under.
    ("grc_vulnerabilities", "plugin_family", "VARCHAR(120)",
     "ix_grc_vulnerabilities_plugin_family"),
    # NVD's CVSS for the labelled CVE, kept beside the scanner's cvss_score so
    # the finding can show scanner-vs-NVD (multi-CVE bundle plugins report the
    # bundle's worst score, not the single attributed CVE's).
    ("grc_vulnerabilities", "nvd_cvss_score", "FLOAT", None),
    ("grc_vulnerabilities", "nvd_cvss_vector", "VARCHAR(120)", None),
    # Scanner-native Nessus fields surfaced in the "Data by source" model.
    ("grc_vulnerabilities", "vpr_score", "FLOAT", None),
    ("grc_vulnerabilities", "cpe", "VARCHAR(255)", None),
    # RCSA custom rows: per-row ownership + cached AI explanation (new feature).
    ("grc_rcsa_custom_rows", "assigned_user_id", "INTEGER",
     "ix_grc_rcsa_custom_rows_assigned_user_id"),
    ("grc_rcsa_custom_rows", "ai_explanation", "TEXT", None),
    ("grc_rcsa_custom_rows", "ai_explanation_at", "TIMESTAMP", None),
    # Evidence pick-from-library: lineage column on the RCSA row evidence
    # table. NULL when the operator uploaded a fresh file, FK when linked.
    ("grc_rcsa_custom_row_evidence", "linked_evidence_id", "INTEGER",
     "ix_grc_rcsa_custom_row_evidence_linked"),
    # Criticality assessments (Phase 2): approval workflow + risk linkage on
    # both ISCA and IACA. Tables are auto-created via Base.metadata; only
    # the new columns on existing tables need an ALTER.
    ("grc_info_system_criticality_items", "approval_status", "VARCHAR(32) DEFAULT 'draft'",
     "ix_grc_isca_approval_status"),
    ("grc_info_system_criticality_items", "current_approval_tier", "INTEGER", None),
    ("grc_info_system_criticality_items", "submitted_at", "TIMESTAMP", None),
    ("grc_info_system_criticality_items", "submitted_by", "INTEGER", None),
    ("grc_info_system_criticality_items", "approved_at", "TIMESTAMP", None),
    ("grc_info_system_criticality_items", "approved_by", "INTEGER", None),
    ("grc_info_system_criticality_items", "rejected_at", "TIMESTAMP", None),
    ("grc_info_system_criticality_items", "rejected_by", "INTEGER", None),
    ("grc_info_system_criticality_items", "rejection_reason", "TEXT", None),
    ("grc_info_system_criticality_items", "linked_risk_id", "INTEGER",
     "ix_grc_isca_linked_risk_id"),
    ("grc_infra_asset_criticality_items", "approval_status", "VARCHAR(32) DEFAULT 'draft'",
     "ix_grc_iaca_approval_status"),
    ("grc_infra_asset_criticality_items", "current_approval_tier", "INTEGER", None),
    ("grc_infra_asset_criticality_items", "submitted_at", "TIMESTAMP", None),
    ("grc_infra_asset_criticality_items", "submitted_by", "INTEGER", None),
    ("grc_infra_asset_criticality_items", "approved_at", "TIMESTAMP", None),
    ("grc_infra_asset_criticality_items", "approved_by", "INTEGER", None),
    ("grc_infra_asset_criticality_items", "rejected_at", "TIMESTAMP", None),
    ("grc_infra_asset_criticality_items", "rejected_by", "INTEGER", None),
    ("grc_infra_asset_criticality_items", "rejection_reason", "TEXT", None),
    ("grc_infra_asset_criticality_items", "linked_risk_id", "INTEGER",
     "ix_grc_iaca_linked_risk_id"),
    # DCC assessment item columns
    ("grc_compliance_assessment_document_items", "control_source", "VARCHAR(50)", None),
    ("grc_compliance_assessment_document_items", "control_type", "VARCHAR(20)", None),
    ("grc_compliance_assessment_document_items", "subdomain_name", "TEXT", None),
    # Remediation Plan tracking — gap items (e.g. PDPL controls scored < 3)
    # get an editable open/in_progress/closed status on the Remediation tab.
    ("grc_compliance_assessment_document_items", "remediation_status",
     "VARCHAR(30)", "ix_assessment_item_remediation_status"),
    # PDPL maturity score (0-5) — assessed per-control on the PDPL page.
    ("grc_compliance_assessment_document_items", "maturity_score", "INTEGER", None),
    # PDPL risk rating (Low/Medium/High/Critical) — editable per-control.
    ("grc_compliance_assessment_document_items", "risk_rating", "VARCHAR(50)", None),
    # SLA / closure tracking per point — each audit point carries its own
    # timeline. target_date = the point's deadline (NULL => derived from the
    # tenant SLA policy by priority); closed_at = when it was closed. Drive the
    # dynamic-SLA closure board. grc_compliance_sla_policy is a new table,
    # auto-created via Base.metadata.create_all.
    ("grc_compliance_assessment_document_items", "target_date", "TIMESTAMP",
     "ix_assessment_item_target_date"),
    ("grc_compliance_assessment_document_items", "closed_at", "TIMESTAMP", None),
    # Per-asset verification status {asset_id: status} for multi-asset assessments (ASVS).
    ("grc_compliance_assessment_document_items", "asset_status", "JSON DEFAULT '{}'::json", None),
    # Assessment ↔ IT Assets scope (application(s) the assessment verifies).
    ("grc_compliance_assessment_documents", "linked_asset_ids", "JSON DEFAULT '[]'::json", None),
    # Per-asset target ASVS level {asset_id: level} for level-scoped assessments.
    ("grc_compliance_assessment_documents", "asset_levels", "JSON DEFAULT '{}'::json", None),
    # Point-score weights on the tenant SLA policy (grc_compliance_sla_policy is
    # a new table via create_all; these ALTERs cover tenants whose table was
    # created before the weight columns existed).
    ("grc_compliance_sla_policy", "score_closed_ontime", "INTEGER DEFAULT 100", None),
    ("grc_compliance_sla_policy", "score_closed_late", "INTEGER DEFAULT 70", None),
    ("grc_compliance_sla_policy", "score_on_track", "INTEGER DEFAULT 40", None),
    ("grc_compliance_sla_policy", "score_due_soon", "INTEGER DEFAULT 20", None),
    ("grc_compliance_sla_policy", "score_overdue", "INTEGER DEFAULT 0", None),
    ("grc_compliance_sla_policy", "score_no_date", "INTEGER DEFAULT 30", None),
    # AI normalization — domain + provenance on NormalizedControl so the Control
    # Library can show normalized controls per domain. The new
    # grc_normalized_control_links table is auto-created via create_all.
    ("grc_normalized_controls", "domain", "VARCHAR(255)", "ix_normalized_control_domain"),
    ("grc_normalized_controls", "source", "VARCHAR(50)", None),
    ("grc_normalized_controls", "common_group_id", "INTEGER", "ix_normalized_control_group"),
    ("grc_normalized_controls", "recommended_evidence", "JSONB", None),
    # Normalization sessions: each grouping/normalization run is isolated so the
    # owner's baseline and a user's custom run coexist. run_id tags each row.
    ("grc_normalized_controls", "run_id", "INTEGER", "ix_normalized_control_run"),
    # Human-review of the AI-built unified control (Control Library review page):
    # review_status = pending | approved | flagged, plus reviewer audit columns.
    ("grc_normalized_controls", "review_status", "VARCHAR(20) DEFAULT 'pending'",
     "ix_normalized_control_review_status"),
    ("grc_normalized_controls", "reviewed_by", "INTEGER", None),
    ("grc_normalized_controls", "reviewed_at", "TIMESTAMP", None),
    ("grc_common_control_groups", "run_id", "INTEGER", "ix_common_group_run"),
    # Human-review of the master list toward 100% correctness.
    ("grc_normalized_controls", "review_status", "VARCHAR(20)", "ix_normalized_control_review"),
    ("grc_normalized_controls", "reviewed_by", "INTEGER", None),
    ("grc_normalized_controls", "reviewed_at", "TIMESTAMP", None),
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
    # Native implementation-order tier (NDMO P1/P2/P3 → Year 1/2/3 roadmap) and
    # control-level prerequisite dependencies. Both preserved verbatim from the
    # source JSON; NULL/[] for frameworks that declare neither.
    ("grc_parsed_framework_controls", "priority_level", "VARCHAR(10)",
     "ix_parsed_control_priority_level"),
    ("grc_parsed_framework_controls", "dependencies", "JSON DEFAULT '[]'::json", None),
    # Per-control version-history rows (NDMO "Version History" table).
    ("grc_parsed_framework_controls", "version_history", "JSON DEFAULT '[]'::json", None),
    # Control-level description (NDMO Figure-2 "Control Description").
    ("grc_parsed_framework_controls", "control_description", "TEXT", None),
    # Assessment criteria parsed from each spec's Control Specification text.
    ("grc_parsed_framework_controls", "assessment_criteria", "JSON DEFAULT '[]'::json", None),
    # Per-criterion met/not-met state on each journey control implementation.
    ("grc_control_implementations", "criteria_status", "JSON DEFAULT '{}'::json", None),
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
    ("grc_policy_gap_findings", "applied_prev_status", "VARCHAR(50)", None),
    # Statement-register sync on clause apply (+ pre-change text for undo).
    ("grc_policy_gap_findings", "applied_statement_id", "INTEGER", None),
    ("grc_policy_gap_findings", "applied_statement_prev_text", "TEXT", None),
    # BCM BIA → IT asset inventory linkage (added after tables were provisioned).
    ("grc_bcm_bia_records", "linked_asset_ids", "JSON", None),
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
    # Per-stage owner assignment on a certification journey (user/team/role).
    ("grc_certification_journeys", "stage_owners", "JSON", None),
    # PCI DSS cardholder-data-inventory attributes on CDE assets.
    ("grc_it_assets", "pci_dss", "JSON", None),
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
    # Phase 1 — real-tenant enrichment inputs. cwe_ids = all NVD weaknesses (the
    # selector reads these); cvss_version = which spec the vector is; the KEV
    # ransomware sub-flag CISA already ships (sharper than bare KEV membership).
    ("grc_vulnerabilities", "cwe_ids", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "cvss_version", "VARCHAR(10)", None),
    ("grc_vulnerabilities", "kev_ransomware_flag", "BOOLEAN", None),
    ("grc_vulnerabilities", "kev_date_added", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_published_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_last_modified_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "nvd_last_synced_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "exploit_references", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "composite_priority", "DOUBLE PRECISION",
     "ix_vuln_composite_priority"),
    # Public-exploit detection (GitHub PoC). count=NULL means we have not
    # checked yet; count=0 is a positive "we checked and found nothing".
    ("grc_vulnerabilities", "public_exploit_count", "INTEGER",
     "ix_vuln_public_exploit_count"),
    ("grc_vulnerabilities", "public_exploit_refs", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "public_exploit_synced_at", "TIMESTAMP", None),
    # Public-exploit corroboration (Exploit-DB). Graded companion to the GitHub
    # PoC columns above: the verified count + exploit type let the signal be
    # graded, not boolean. count=NULL = not checked; 0 = checked, none found.
    ("grc_vulnerabilities", "exploitdb_count", "INTEGER", None),
    ("grc_vulnerabilities", "exploitdb_verified_count", "INTEGER", None),
    ("grc_vulnerabilities", "exploitdb_refs", "JSON DEFAULT '[]'::json", None),
    ("grc_vulnerabilities", "exploit_source", "VARCHAR(120)", None),
    # Parsed-framework FK for CWE auto-mapper — the legacy FrameworkControl
    # table is empty in upload-seeded tenants; the auto-mapper now writes
    # parsed_framework_control_id instead.
    ("grc_vulnerability_control_links", "parsed_framework_control_id",
     "INTEGER REFERENCES grc_parsed_framework_controls(id)",
     "ix_vuln_control_link_parsed"),
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
    # CIS extension — per-integration structured-creds blob (MSSQL / Postgres
    # / MySQL / LDAP / Azure / K8s) populated by the Connect Wizard so the
    # bench-mark runners can pull the shape each adapter expects.
    ("grc_integration_connections", "credentials_extra_json", "JSON", None),
    # ITAsset — manual criticality override audit columns. `criticality_score`
    # is always system-computed; the textual `criticality` bucket can be
    # overridden by a user with a reason captured here for the audit trail.
    ("grc_it_assets", "criticality_manual_override", "BOOLEAN DEFAULT FALSE", None),
    ("grc_it_assets", "criticality_override_reason", "TEXT", None),
    # Issue Management — extends the skeleton Issue table with the columns
    # needed for the new module. All nullable so existing rows render
    # unchanged. New tables (grc_issue_actions, grc_issue_comments, etc.)
    # are auto-created via Base.metadata.create_all(checkfirst=True).
    ("grc_issues", "code", "VARCHAR(50)", "ix_issue_tenant_code"),
    ("grc_issues", "issue_type", "VARCHAR(40)", None),
    ("grc_issues", "category", "VARCHAR(40)", None),
    ("grc_issues", "urgency", "VARCHAR(20)", None),
    ("grc_issues", "impact", "VARCHAR(20)", None),
    ("grc_issues", "severity_override", "VARCHAR(20)", None),
    ("grc_issues", "severity_override_reason", "TEXT", None),
    ("grc_issues", "root_cause", "VARCHAR(255)", None),
    ("grc_issues", "root_cause_analysis", "TEXT", None),
    ("grc_issues", "detected_at", "TIMESTAMP", None),
    ("grc_issues", "target_closure_date", "TIMESTAMP", None),
    ("grc_issues", "resolved_at", "TIMESTAMP", None),
    ("grc_issues", "reporter_id", "INTEGER", None),
    ("grc_issues", "assignee_id", "INTEGER", None),
    ("grc_issues", "source_type", "VARCHAR(40)", "ix_issue_tenant_source"),
    ("grc_issues", "source_id", "INTEGER", None),
    ("grc_issues", "workflow_state", "VARCHAR(40) DEFAULT 'new'", "ix_issue_tenant_workflow_state"),
    ("grc_issues", "sla_breached", "BOOLEAN DEFAULT FALSE", "ix_issue_sla_breached"),
    ("grc_issues", "approved_by_id", "INTEGER", None),
    ("grc_issues", "approved_at", "TIMESTAMP", None),
    ("grc_issues", "closure_notes", "TEXT", None),
    # Issue Management v2 — bidirectional CriticalTask <-> CAPA action link.
    # All nullable; existing rows untouched. The reverse FK (linked_critical_task_id
    # on grc_issue_actions) and forward FKs (linked_issue_id, linked_issue_action_id
    # on grc_critical_tasks) live as plain INTEGER columns at the SQL layer;
    # SQLAlchemy enforces them on new writes.
    ("grc_issue_actions", "linked_critical_task_id", "INTEGER", "ix_issue_action_linked_task"),
    ("grc_critical_tasks", "linked_issue_id", "INTEGER", "ix_critical_task_linked_issue"),
    ("grc_critical_tasks", "linked_issue_action_id", "INTEGER", "ix_critical_task_linked_action"),

    # CIS Agent extensions — fleet enrollment + scan-now push columns on
    # the ComplianceAgent table. Used by the per-OS installer endpoints
    # (one-click mint a fleet token + .cmd / .sh download) and the
    # asset-page Scan-now button (next /jobs poll skips its 30s tick).
    ("grc_compliance_agents", "kind", "VARCHAR(20)", None),
    ("grc_compliance_agents", "enrollment_max_uses", "INTEGER", None),
    ("grc_compliance_agents", "enrollment_uses", "INTEGER", None),
    ("grc_compliance_agents", "enrollment_expires_at", "TIMESTAMP", None),
    ("grc_compliance_agents", "spawned_from_agent_id", "INTEGER", "ix_agent_spawned_from"),
    ("grc_compliance_agents", "pending_scan_at", "TIMESTAMP", None),
    ("grc_compliance_agents", "pending_scan_user_id", "INTEGER", None),

    # CIS OS profile on ITAsset — populated by Connect Wizard probe + agent
    # heartbeats; drives the BenchmarkOsMapping strict matcher (CIS plugin
    # routing). Free-form so we don't lose any probe result we can't
    # categorize yet.
    ("grc_it_assets", "os_family", "VARCHAR(50)", None),
    ("grc_it_assets", "os_version", "VARCHAR(255)", None),
    ("grc_it_assets", "os_normalized", "VARCHAR(80)", "ix_it_assets_os_normalized"),
    ("grc_it_assets", "os_build", "VARCHAR(40)", None),
    ("grc_it_assets", "os_edition", "VARCHAR(80)", None),

    # CIS Phase 4 fallout — package's compliance_plugins/router.py filters
    # CompliancePluginRun.is_leaked.is_(False) on per_user_summary, runs
    # listing, and analytics queries. Existing rows default to FALSE
    # (not-leaked); the runs endpoint exposes ?include_leaked=true for
    # audit traceback. DDL includes DEFAULT + NOT NULL so the column is
    # safe to add to populated tables in a single ALTER.
    ("grc_compliance_plugin_runs", "is_leaked",
     "BOOLEAN DEFAULT FALSE NOT NULL", "ix_plugin_run_is_leaked"),
    # ── CIS Module Updated drop — 8 columns required by /library-tree
    # and /os-registry endpoints. Without these the library page renders
    # "Couldn't load the library tree" because the tree-building SQL
    # references os_keys (Block A) and grc_os_versions. JSON columns
    # default to '[]'::json so existing rows have an empty list rather
    # than NULL, keeping the tree query's jsonb_array_elements_text safe.
    # os_keys + target_builds MUST be jsonb (not json) because the
    # /library-tree and /os-registry endpoints use jsonb-only operators
    # (jsonb_array_elements_text, `?` containment). Plain json doesn't
    # have these operators; using JSON DEFAULT '[]'::json causes the
    # tree query to fail with "function jsonb_array_elements_text(json)
    # does not exist".
    #
    # os_keys is JSONB — needs GIN, not btree. _ensure_index only knows
    # btree, so leave the index out here; a one-shot GIN index can be
    # added manually if the library-tree group-by becomes hot:
    #   CREATE INDEX CONCURRENTLY ix_compliance_plugin_os_keys_gin
    #     ON grc_compliance_plugins USING gin (os_keys);
    ("grc_compliance_plugins", "os_keys", "JSONB DEFAULT '[]'::jsonb", None),
    ("grc_compliance_plugins", "classification_source", "VARCHAR(20)", None),
    ("grc_compliance_plugins", "classified_at", "TIMESTAMP", None),
    ("grc_compliance_plugins", "benchmark_version", "VARCHAR(40)", None),
    ("grc_compliance_plugins", "target_builds", "JSONB DEFAULT '[]'::jsonb", None),
    ("grc_compliance_plugins", "benchmark_section_path", "VARCHAR(500)", None),
    ("grc_compliance_plugins", "rule_id_validated_at", "TIMESTAMP", None),
    ("grc_compliance_plugins", "rule_id_validation_status", "VARCHAR(20)", None),
    # ── Risk Posture v2 — business-impact context on ITAsset ────────────
    # Required by effective_risk.compute_effective_risk to apply business
    # multipliers ON TOP of CVSS/EPSS/KEV. Without these, the v2 service
    # crashes (referenced via getattr — silent default, but the
    # operator-facing UI panels won't render the toggles either).
    # `op_dep_business_impact` is named distinctly from the existing
    # `operational_dependency` Integer column (Criticality Assessment
    # field) to avoid a column-name collision.
    ("grc_it_assets", "is_customer_facing",
     "BOOLEAN DEFAULT FALSE NOT NULL", None),
    ("grc_it_assets", "is_internet_facing",
     "BOOLEAN DEFAULT FALSE NOT NULL", None),
    ("grc_it_assets", "regulated_data_type",
     "VARCHAR(20) DEFAULT 'none' NOT NULL", None),
    ("grc_it_assets", "op_dep_business_impact",
     "VARCHAR(20) DEFAULT 'medium' NOT NULL", None),
    ("grc_it_assets", "business_impact_notes", "TEXT", None),
    # ── Risk Posture v2 — per-vuln effective-risk persistence ───────────
    # Written by _vuln_score() after compute_effective_risk returns. The
    # UI per-vuln cards read these directly so they don't have to
    # recompute the formula on every dashboard load.
    ("grc_vulnerabilities", "effective_risk_score", "FLOAT", None),
    ("grc_vulnerabilities", "effective_risk_reason", "TEXT", None),
    ("grc_vulnerabilities", "effective_risk_computed_at", "TIMESTAMP", None),
    # Workflow engine — multi-trigger OR logic. A workflow fires when ANY of the
    # listed platform events occurs; `trigger_event` stays the primary entry.
    ("grc_workflow_definitions", "trigger_events", "JSON DEFAULT '[]'::json", None),
    # ── Third-Party Risk Assessment (TPRA) lifecycle ──────────────────────────
    # 8-stage lifecycle backbone + per-stage trackers. All additive (JSON / int
    # columns on existing vendor tables — no new tables, no FK constraints).
    ("grc_vendors", "lifecycle_stage", "VARCHAR(40) DEFAULT 'intake'",
     "ix_grc_vendors_lifecycle_stage"),
    ("grc_vendors", "lifecycle_history", "JSON DEFAULT '[]'::json", None),
    ("grc_vendors", "reassessment_cadence_days", "INTEGER", None),
    ("grc_vendors", "next_reassessment_date", "TIMESTAMP",
     "ix_grc_vendors_next_reassessment"),
    ("grc_vendors", "contract_document_id", "INTEGER",
     "ix_grc_vendors_contract_document_id"),
    ("grc_vendors", "offboarding_checklist", "JSON DEFAULT '[]'::json", None),
    ("grc_vendors", "remediation_actions", "JSON DEFAULT '[]'::json", None),
    ("grc_vendor_assessments", "linked_risk_id", "INTEGER",
     "ix_grc_vendor_assessments_linked_risk_id"),
    ("grc_vendor_assessments", "gap_analysis", "JSON DEFAULT '[]'::json", None),
    ("grc_vendor_incidents", "linked_issue_id", "INTEGER",
     "ix_grc_vendor_incidents_linked_issue_id"),
    # ── ERM risk register: reviewable AI-assist fields (root cause + consequences + recommendations) ──
    ("grc_risks", "root_cause", "TEXT", None),
    ("grc_risks", "consequences", "TEXT", None),
    ("grc_risks", "recommendations", "TEXT", None),
    # ── TPRA productionization (11-stage versioned lifecycle). New TPRA tables
    # (grc_tpra_*, grc_risk_domains) are auto-created via create_all; only these
    # additive columns on the existing vendor tables need an ALTER on live DBs. ──
    ("grc_vendors", "active_assessment_id", "INTEGER",
     "ix_grc_vendors_active_assessment_id"),
    ("grc_vendors", "deleted_at", "TIMESTAMP", None),
    ("grc_vendor_assessments", "version_no", "INTEGER DEFAULT 1", None),
    ("grc_vendor_assessments", "supersedes_id", "INTEGER",
     "ix_grc_vendor_assessments_supersedes_id"),
    ("grc_vendor_assessments", "lifecycle_status", "VARCHAR(30) DEFAULT 'active'",
     "ix_grc_vendor_assessments_lifecycle_status"),
    ("grc_vendor_assessments", "current_stage", "VARCHAR(40) DEFAULT 'intake'",
     "ix_grc_vendor_assessments_current_stage"),
    ("grc_vendor_assessments", "inherent_tier", "VARCHAR(20)", None),
    ("grc_vendor_assessments", "residual_rating", "VARCHAR(20)", None),
    ("grc_vendor_assessments", "domain_scores", "JSON DEFAULT '{}'::json", None),
    ("grc_vendor_assessments", "row_version", "INTEGER DEFAULT 1", None),
    ("grc_vendor_assessments", "deleted_at", "TIMESTAMP", None),
    # TPRM revamp — A–F grade snapshot of residual at score time.
    ("grc_vendor_assessments", "rating_grade", "VARCHAR(2)", None),
    # Finding → ERM Risk Register promotion link (vendor-sourced risk).
    ("grc_tpra_findings", "linked_risk_id", "INTEGER",
     "ix_grc_tpra_findings_linked_risk_id"),
    # Governance doc → frameworks it's declared applicable to / audited against.
    # Drives the control-coverage panel (mapped / recommended / missing controls).
    ("grc_governance_documents", "applicable_framework_ids",
     "JSON DEFAULT '[]'::json", None),
    # Statement-of-Applicability template fields on the clause-applicability row
    # (owner / implementation status / linked evidence). Surfaced on the
    # framework detail "Applicability" tab.
    ("grc_clause_applicability", "owner_id", "INTEGER",
     "ix_grc_clause_applicability_owner_id"),
    ("grc_clause_applicability", "owner_name", "VARCHAR(255)", None),
    ("grc_clause_applicability", "implementation_status", "VARCHAR(50)", None),
    ("grc_clause_applicability", "linked_evidence_id", "INTEGER", None),
    # ── ITAM parity block on ITAsset ──────────────────────────────────────────
    # These 14 shipped on the model (_14_it_asset_inventory.py) and are read and
    # written by assets_router (create/update/detail), the agent heartbeat
    # (modules/agents/router.py — hardware write-through) and the ITAsset
    # schemas, but they never got an ALTER TABLE entry. `create_all` adds
    # missing TABLES, never missing COLUMNS, so every tenant DB provisioned
    # before the model change raised UndefinedColumn on any asset query —
    # SQLAlchemy SELECTs all mapped columns, so the whole module 500s.
    # Fresh tenants were unaffected, which is why it stayed hidden.
    # All nullable / additive, matching the model exactly.
    ("grc_it_assets", "cpu_cores", "INTEGER", None),
    ("grc_it_assets", "memory_gb", "INTEGER", None),
    ("grc_it_assets", "storage_gb", "INTEGER", None),
    ("grc_it_assets", "agent_version", "VARCHAR(50)", None),
    ("grc_it_assets", "manufacturer", "VARCHAR(255)", None),
    ("grc_it_assets", "model", "VARCHAR(255)", None),
    # Indexed: the identity resolver matches on serial_number as a strong key.
    ("grc_it_assets", "serial_number", "VARCHAR(255)",
     "ix_grc_it_assets_serial_number"),
    ("grc_it_assets", "department", "VARCHAR(150)", None),
    ("grc_it_assets", "assigned_user", "VARCHAR(255)", None),
    ("grc_it_assets", "purchase_cost", "FLOAT", None),
    ("grc_it_assets", "purchase_date", "TIMESTAMP", None),
    ("grc_it_assets", "warranty_expiry", "TIMESTAMP", None),
    ("grc_it_assets", "eol_date", "TIMESTAMP", None),
    ("grc_it_assets", "environment", "VARCHAR(50)", None),
    # ── Identity resolution keys on ITAsset ───────────────────────────────────
    # The columns the discovery identity resolver matches an observation against
    # so the same host from two sources becomes ONE asset. All nullable/additive.
    #   fqdn / primary_mac / cloud_resource_id — strong-ish identity keys (indexed
    #     because the resolver looks assets up by them on every observation).
    #   source_system   — which system last asserted this asset ('discovery',
    #     'agent', 'aws', 'servicenow', …); provenance, not a match key by itself.
    #   first_seen_at   — when this asset first entered the inventory (paired with
    #     the existing last_seen_at).
    #   discovery_state — 'discovered' (auto-created by a scan, unconfirmed) vs
    #     'managed' (operator-confirmed); NULL for pre-existing/manual rows. Lets
    #     the UI separate freshly-found devices from curated inventory instead of
    #     dumping raw scan hits into the register.
    ("grc_it_assets", "fqdn", "VARCHAR(255)", "ix_grc_it_assets_fqdn"),
    ("grc_it_assets", "primary_mac", "VARCHAR(64)", "ix_grc_it_assets_primary_mac"),
    ("grc_it_assets", "cloud_resource_id", "VARCHAR(255)",
     "ix_grc_it_assets_cloud_resource_id"),
    ("grc_it_assets", "source_system", "VARCHAR(50)", None),
    ("grc_it_assets", "first_seen_at", "TIMESTAMP", None),
    ("grc_it_assets", "discovery_state", "VARCHAR(30)",
     "ix_grc_it_assets_discovery_state"),
    # Endpoint security posture (antivirus / EDR presence + software category
    # breakdown), derived from detected_software_json by the security_classifier
    # on every inventory refresh. Drives the asset's Security Posture card.
    ("grc_it_assets", "security_posture", "JSON", None),
    # ── Scanner closure loop (two-way vulnerability sync) ─────────────────────
    # Provenance + observation window + closure evidence on findings, and the
    # reopen counter on sync history. All nullable/additive — legacy rows are
    # adopted by the next sync (matched by their deterministic vuln_id) and
    # only then become eligible for scanner-verified closure.
    ("grc_vulnerabilities", "connection_id", "INTEGER",
     "ix_grc_vulnerabilities_connection_id"),
    ("grc_vulnerabilities", "source", "VARCHAR(50)", None),
    ("grc_vulnerabilities", "external_vuln_id", "VARCHAR(100)", None),
    ("grc_vulnerabilities", "scanner_status", "VARCHAR(30)", None),
    ("grc_vulnerabilities", "first_detected", "TIMESTAMP", None),
    ("grc_vulnerabilities", "last_seen", "TIMESTAMP", None),
    ("grc_vulnerabilities", "last_seen_scan_id", "VARCHAR(64)", None),
    ("grc_vulnerabilities", "closed_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "closed_by", "VARCHAR(100)", None),
    ("grc_vulnerabilities", "closure_evidence", "JSON", None),
    ("grc_vulnerabilities", "reopened_at", "TIMESTAMP", None),
    ("grc_vulnerabilities", "reopen_count", "INTEGER DEFAULT 0", None),
    ("grc_sync_history", "vulns_reopened", "INTEGER DEFAULT 0", None),
    # ── CRQM (FAIR risk quantification) — Phase 1 ─────────────────────────────
    # Structured scenario + material flag on the register, and FAIR control
    # effects on the risk↔control link. All nullable/additive; the new
    # grc_risk_loss_models / grc_risk_simulation_runs tables are created by
    # safe_metadata_create_all.
    ("grc_risks", "is_material", "BOOLEAN DEFAULT FALSE",
     "ix_grc_risks_is_material"),
    ("grc_risks", "scenario_actor", "VARCHAR(200)", None),
    ("grc_risks", "scenario_method", "TEXT", None),
    ("grc_risks", "scenario_effect", "JSON", None),
    ("grc_risks", "scenario_statement", "TEXT", None),
    ("grc_risk_control_links", "freq_reduction_min_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "freq_reduction_ml_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "freq_reduction_max_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "mag_reduction_min_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "mag_reduction_ml_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "mag_reduction_max_pct", "DOUBLE PRECISION", None),
    ("grc_risk_control_links", "effect_rationale", "TEXT", None),
    ("grc_risk_control_links", "effect_updated_by", "INTEGER", None),
    ("grc_risk_control_links", "effect_updated_at", "TIMESTAMP", None),
    # CRQM follow-up: run provenance + frozen PoS evidence snapshot (the two
    # new tables may already exist on tenants that ran the first CRQM build).
    ("grc_risk_simulation_runs", "trigger", "VARCHAR(30) DEFAULT 'manual'", None),
    ("grc_risk_loss_models", "pos_evidence", "JSON", None),
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
        # Prefer the race-safe helper (advisory lock is held by get_tenant_engine
        # callers; still tolerate duplicate type/table if called elsewhere).
        try:
            from ...db import safe_metadata_create_all
            db_name = getattr(engine.url, "database", None) or "tenant"
            safe_metadata_create_all(engine, slug=str(db_name))
        except Exception:
            logger.exception("Failed to create missing tables on engine %s", getattr(engine.url, "database", "?"))

        all_ok = True
        for table, column, ddl_type, index_name in _COLUMN_ADDS:
            ok = _ensure_column(engine, table=table, column=column, ddl_type=ddl_type)
            all_ok = all_ok and ok
            if ok and index_name:
                _ensure_index(engine, table=table, column=column, index_name=index_name)

        # Type-fixup pass: convert columns that ended up the wrong
        # type on tenants created before the type was tightened in the
        # canonical schema. Idempotent — no-op when the type is already
        # correct.
        for table, column, expected_type in _COLUMN_TYPE_FIXUPS:
            ok = _ensure_column_type(engine, table=table, column=column,
                                     expected_type=expected_type)
            all_ok = all_ok and ok

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
