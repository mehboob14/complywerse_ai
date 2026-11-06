"""Reporting semantic layer — SQL views for Metabase (and future BI).

Creates `reporting_*` views on each tenant DB so analysts start from
GRC-named Models (Risks, Vendors & TPRA, …) instead of raw table joins.
Views are idempotent CREATE OR REPLACE; missing source tables are skipped.

Called from compliance schema self-heal so every tenant engine gets them
lazily on first touch — same pattern as column adds.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, Tuple

from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# (view_name, create_sql) — CREATE OR REPLACE VIEW … AS …
# Keep column names stable; Metabase Models are built on these.
_REPORTING_VIEWS: List[Tuple[str, str]] = [
    (
        "reporting_risks",
        """
        CREATE OR REPLACE VIEW reporting_risks AS
        SELECT
            r.id,
            r.title,
            r.description,
            r.category,
            r.risk_category,
            r.risk_sub_category,
            r.status,
            r.closure_status,
            r.inherent_likelihood,
            r.inherent_impact,
            r.inherent_score,
            r.residual_likelihood,
            r.residual_impact,
            r.residual_score,
            r.risk_appetite,
            r.source_type,
            r.source_reference,
            r.due_date,
            r.review_date,
            r.created_at,
            r.updated_at,
            r.owner_id,
            ou.display_name AS owner_name,
            ou.email AS owner_email,
            r.business_unit_id,
            bu.name AS business_unit_name,
            (
                SELECT COUNT(*)::int FROM grc_issue_risk_links irl
                WHERE irl.risk_id = r.id
            ) AS linked_issue_count,
            (
                SELECT COUNT(*)::int FROM grc_issue_risk_links irl
                JOIN grc_issues i ON i.id = irl.issue_id
                WHERE irl.risk_id = r.id
                  AND COALESCE(i.workflow_state, i.status) NOT IN ('closed', 'cancelled')
            ) AS open_linked_issue_count
        FROM grc_risks r
        LEFT JOIN grc_users ou ON ou.id = r.owner_id
        LEFT JOIN grc_business_units bu ON bu.id = r.business_unit_id
        """,
    ),
    (
        "reporting_risks_with_issues",
        """
        CREATE OR REPLACE VIEW reporting_risks_with_issues AS
        SELECT
            r.id AS risk_id,
            r.title AS risk_title,
            r.category AS risk_category,
            r.status AS risk_status,
            r.residual_score,
            r.inherent_score,
            r.owner_id AS risk_owner_id,
            rou.display_name AS risk_owner_name,
            i.id AS issue_id,
            i.code AS issue_code,
            i.title AS issue_title,
            i.severity AS issue_severity,
            i.status AS issue_status,
            i.workflow_state,
            i.sla_breached,
            i.due_date AS issue_due_date,
            i.assignee_id,
            iau.display_name AS issue_assignee_name,
            irl.link_type,
            r.created_at AS risk_created_at,
            i.created_at AS issue_created_at
        FROM grc_risks r
        JOIN grc_issue_risk_links irl ON irl.risk_id = r.id
        JOIN grc_issues i ON i.id = irl.issue_id
        LEFT JOIN grc_users rou ON rou.id = r.owner_id
        LEFT JOIN grc_users iau ON iau.id = i.assignee_id
        """,
    ),
    (
        "reporting_vendors_tpra",
        """
        CREATE OR REPLACE VIEW reporting_vendors_tpra AS
        SELECT
            v.id AS vendor_id,
            v.name AS vendor_name,
            v.tier,
            v.status AS vendor_status,
            v.vendor_type,
            v.lifecycle_stage,
            v.inherent_risk_score,
            v.residual_risk_score,
            v.risk_rating,
            v.data_access_level,
            v.next_reassessment_date,
            v.reassessment_cadence_days,
            v.primary_contact_name,
            v.primary_contact_email,
            v.owner_id,
            ou.display_name AS owner_name,
            v.business_unit_id,
            bu.name AS business_unit_name,
            v.deleted_at,
            v.created_at,
            v.updated_at,
            f.id AS finding_id,
            f.title AS finding_title,
            f.domain AS finding_domain,
            f.severity AS finding_severity,
            f.status AS finding_status,
            f.is_critical_control_fail,
            f.linked_risk_id,
            f.linked_issue_id,
            f.assessment_id,
            f.created_at AS finding_created_at
        FROM grc_vendors v
        LEFT JOIN grc_tpra_findings f
            ON f.vendor_id = v.id AND f.deleted_at IS NULL
        LEFT JOIN grc_users ou ON ou.id = v.owner_id
        LEFT JOIN grc_business_units bu ON bu.id = v.business_unit_id
        WHERE v.deleted_at IS NULL
        """,
    ),
    (
        "reporting_issues_tasks",
        """
        CREATE OR REPLACE VIEW reporting_issues_tasks AS
        SELECT
            i.id,
            i.code,
            i.title,
            i.description,
            i.severity,
            i.status,
            i.workflow_state,
            i.issue_type,
            i.category,
            i.urgency,
            i.impact,
            i.sla_breached,
            i.source_type,
            i.source_id,
            i.due_date,
            i.target_closure_date,
            i.detected_at,
            i.resolved_at,
            i.closed_at,
            i.created_at,
            i.owner_id,
            ou.display_name AS owner_name,
            i.assignee_id,
            au.display_name AS assignee_name,
            i.reporter_id,
            ru.display_name AS reporter_name,
            (
                SELECT COUNT(*)::int FROM grc_issue_risk_links irl WHERE irl.issue_id = i.id
            ) AS linked_risk_count,
            (
                SELECT COUNT(*)::int FROM grc_issue_vendor_links ivl WHERE ivl.issue_id = i.id
            ) AS linked_vendor_count,
            (
                SELECT COUNT(*)::int FROM grc_issue_actions ia
                WHERE ia.issue_id = i.id AND COALESCE(ia.status, '') NOT IN ('completed', 'cancelled')
            ) AS open_action_count
        FROM grc_issues i
        LEFT JOIN grc_users ou ON ou.id = i.owner_id
        LEFT JOIN grc_users au ON au.id = i.assignee_id
        LEFT JOIN grc_users ru ON ru.id = i.reporter_id
        """,
    ),
    (
        "reporting_evidence_controls",
        """
        CREATE OR REPLACE VIEW reporting_evidence_controls AS
        SELECT
            e.id AS evidence_id,
            e.name AS evidence_name,
            e.evidence_type,
            e.status AS evidence_status,
            e.is_stale,
            e.collection_date,
            e.expiry_date,
            e.recertification_date,
            e.validity_period_days,
            e.source_system,
            e.quality_score,
            e.file_type,
            e.owner_id,
            ou.display_name AS owner_name,
            e.uploaded_by,
            uu.display_name AS uploaded_by_name,
            e.uploaded_at,
            ecm.framework_control_id,
            ecm.normalized_control_id,
            ecm.confidence_score AS mapping_confidence
        FROM grc_evidence e
        LEFT JOIN grc_evidence_control_mappings ecm ON ecm.evidence_id = e.id
        LEFT JOIN grc_users ou ON ou.id = e.owner_id
        LEFT JOIN grc_users uu ON uu.id = e.uploaded_by
        """,
    ),
    (
        "reporting_assets_vulns",
        """
        CREATE OR REPLACE VIEW reporting_assets_vulns AS
        SELECT
            v.id AS vulnerability_id,
            v.vuln_id,
            v.title AS vulnerability_title,
            v.severity,
            v.status AS vulnerability_status,
            v.cvss_score,
            v.cve_id,
            v.affected_host,
            v.affected_component,
            v.plugin_family,
            v.assigned_to,
            au.display_name AS assignee_name,
            v.discovered_at,
            v.due_date,
            v.resolved_at,
            v.is_exception,
            v.tenant_id,
            v.created_at,
            v.updated_at
        FROM grc_vulnerabilities v
        LEFT JOIN grc_users au ON au.id = v.assigned_to
        """,
    ),
    (
        "reporting_scf_check_results",
        """
        CREATE OR REPLACE VIEW reporting_scf_check_results AS
        SELECT
            cr.id,
            cr.scf_id AS control_code,
            c.name AS control_title,
            c.domain_name AS control_domain,
            cr.ao_id,
            cr.check_id,
            cr.connector,
            cr.connection_id,
            cr.method,
            cr.status,
            cr.severity,
            cr.resource,
            cr.detail,
            cr.population_size,
            cr.tested_size,
            cr.truncated,
            cr.collected_at,
            cr.expires_at,
            cr.scope_id,
            cr.run_id
        FROM grc_scf_check_result cr
        LEFT JOIN grc_scf_control c ON c.scf_id = cr.scf_id
        """,
    ),
]

# Tables each view needs — if any are missing, skip that view.
_VIEW_REQUIRES: dict[str, Tuple[str, ...]] = {
    "reporting_risks": ("grc_risks", "grc_users"),
    "reporting_risks_with_issues": ("grc_risks", "grc_issues", "grc_issue_risk_links"),
    "reporting_vendors_tpra": ("grc_vendors", "grc_tpra_findings"),
    "reporting_issues_tasks": ("grc_issues",),
    "reporting_evidence_controls": ("grc_evidence",),
    "reporting_assets_vulns": ("grc_vulnerabilities",),
    "reporting_scf_check_results": ("grc_scf_check_result", "grc_scf_control"),
}


def _table_exists(engine: Engine, table: str) -> bool:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).fetchone()
    return row is not None


def ensure_reporting_views(engine: Engine) -> List[str]:
    """Create/replace reporting_* views. Returns names successfully applied."""
    applied: List[str] = []
    for name, ddl in _REPORTING_VIEWS:
        required = _VIEW_REQUIRES.get(name, ())
        missing = [t for t in required if not _table_exists(engine, t)]
        if missing:
            logger.info(
                "Skip view %s on %s — missing tables %s",
                name,
                getattr(engine.url, "database", "?"),
                missing,
            )
            continue
        # Optional joins (business_units, evidence mappings, issue_actions, assets)
        # — if absent, try a stripped variant is too heavy; log and skip on failure.
        try:
            with engine.begin() as conn:
                conn.execute(text(ddl))
            applied.append(name)
            logger.info("Ensured view %s on %s", name, getattr(engine.url, "database", "?"))
        except Exception:
            logger.exception(
                "Failed to create view %s on %s",
                name,
                getattr(engine.url, "database", "?"),
            )
    return applied


def list_reporting_view_catalog() -> List[dict]:
    """Metadata for Admin / Metabase bootstrap docs."""
    return [
        {
            "view": name,
            "requires": list(_VIEW_REQUIRES.get(name, ())),
            "metabase_model_hint": name.replace("reporting_", "").replace("_", " ").title(),
        }
        for name, _ in _REPORTING_VIEWS
    ]


# Canonical SQL lives in deploy/metabase/readonly_reporting.sql
READONLY_ROLE_SQL = """
-- Run as a superuser / CREATEROLE owner against EACH tenant database (grc_<slug>).
-- Metabase connects with this role — SELECT only on reporting views + needed dims.
-- See deploy/metabase/readonly_reporting.sql for a runnable script.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'readonly_reporting') THEN
    CREATE ROLE readonly_reporting LOGIN PASSWORD 'CHANGE_ME_PASSWORD';
  END IF;
END
$$;

-- GRANT CONNECT ON DATABASE grc_<slug> TO readonly_reporting;
GRANT USAGE ON SCHEMA public TO readonly_reporting;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly_reporting;

-- Prefer narrowing to views once validated:
-- REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM readonly_reporting;
-- GRANT SELECT ON reporting_risks, reporting_risks_with_issues, reporting_vendors_tpra,
--   reporting_issues_tasks, reporting_evidence_controls, reporting_assets_vulns,
--   reporting_scf_check_results TO readonly_reporting;
"""
