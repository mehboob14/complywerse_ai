"""TPRA teardown / rollback (the repo has no Alembic down-migrations, so this is
the documented reversal for the TPRA productionization). Idempotent.

    # remove only the demo seed data, keep schema:
    SESSION_SECRET=... py -3 -m grc.modules.vendor_risk.tpra.teardown --slug <slug> --demo-only

    # drop the new TPRA tables (schema rollback), keep the additive vendor columns:
    SESSION_SECRET=... py -3 -m grc.modules.vendor_risk.tpra.teardown --slug <slug> --drop-tables

    # full rollback incl. the additive columns on grc_vendors / grc_vendor_assessments:
    SESSION_SECRET=... py -3 -m grc.modules.vendor_risk.tpra.teardown --slug <slug> --drop-tables --drop-columns

WARNING: --drop-tables and --drop-columns are destructive and irreversible (they
delete TPRA data). The legacy vendor/assessment JSON blobs are NOT touched, so
the original 8-stage module keeps working after a rollback.
"""
from __future__ import annotations

import argparse

from sqlalchemy import text

from ....db import get_tenant_engine, open_tenant_session
from ....models import Tenant
from .seed import DEMO_VENDOR_NAME

# Child→parent order so plain DROPs work even without CASCADE.
TPRA_TABLES = [
    "grc_tpra_shared_assessments",
    "grc_tpra_evidence_links",
    "grc_tpra_risk_snapshots",
    "grc_tpra_control_obligations",
    "grc_tpra_contracts",
    "grc_tpra_remediations",
    "grc_tpra_risk_acceptances",
    "grc_tpra_findings",
    "grc_tpra_question_responses",
    "grc_tpra_questions",
    "grc_tpra_stage_instances",
    "grc_tpra_approvals",
    "grc_tpra_monitoring_signals",
    "grc_tpra_audit_log",
    "grc_tpra_tiering_config",
    "grc_risk_domains",
]

# Additive columns introduced on existing tables (full rollback only).
ADDED_COLUMNS = [
    ("grc_vendors", "active_assessment_id"),
    ("grc_vendors", "deleted_at"),
    ("grc_vendor_assessments", "version_no"),
    ("grc_vendor_assessments", "supersedes_id"),
    ("grc_vendor_assessments", "lifecycle_status"),
    ("grc_vendor_assessments", "current_stage"),
    ("grc_vendor_assessments", "inherent_tier"),
    ("grc_vendor_assessments", "residual_rating"),
    ("grc_vendor_assessments", "domain_scores"),
    ("grc_vendor_assessments", "row_version"),
    ("grc_vendor_assessments", "deleted_at"),
    ("grc_vendor_assessments", "rating_grade"),
    ("grc_vendor_assessments", "team_roster"),
    ("grc_tpra_findings", "linked_risk_id"),
    ("grc_tpra_findings", "linked_issue_id"),
]

# Demo-only cleanup: tables that reference the demo vendor by vendor_id.
DEMO_VENDOR_SCOPED = [
    "grc_tpra_stage_instances",
    "grc_tpra_monitoring_signals",
    "grc_tpra_audit_log",
    "grc_tpra_contracts",
]


def drop_tables(slug: str) -> None:
    engine = get_tenant_engine(slug)
    with engine.begin() as conn:
        for tbl in TPRA_TABLES:
            conn.execute(text(f"DROP TABLE IF EXISTS {tbl} CASCADE"))
    print(f"[drop-tables] dropped {len(TPRA_TABLES)} TPRA tables on '{slug}'")


def drop_columns(slug: str) -> None:
    engine = get_tenant_engine(slug)
    with engine.begin() as conn:
        for tbl, col in ADDED_COLUMNS:
            conn.execute(text(f"ALTER TABLE {tbl} DROP COLUMN IF EXISTS {col}"))
    print(f"[drop-columns] dropped {len(ADDED_COLUMNS)} additive columns on '{slug}'")


def remove_demo(slug: str) -> None:
    db = open_tenant_session(slug)
    try:
        from ....models import Vendor, VendorAssessment, TPRAFinding
        tenant = db.query(Tenant).first()
        if not tenant:
            print("[demo-only] no tenant row; nothing to do")
            return
        v = db.query(Vendor).filter(
            Vendor.tenant_id == tenant.id, Vendor.name == DEMO_VENDOR_NAME
        ).first()
        if not v:
            print("[demo-only] demo vendor not present; nothing to do")
            return
        # Children: findings cascade to remediations/acceptances via ORM cascade.
        assessment_ids = [a.id for a in db.query(VendorAssessment.id).filter(VendorAssessment.vendor_id == v.id)]
        for f in db.query(TPRAFinding).filter(TPRAFinding.vendor_id == v.id).all():
            db.delete(f)
        engine_tbls = ", ".join(DEMO_VENDOR_SCOPED)
        for tbl in DEMO_VENDOR_SCOPED:
            db.execute(text(f"DELETE FROM {tbl} WHERE vendor_id = :vid"), {"vid": v.id})
        # question responses are keyed by assessment_id
        for aid in assessment_ids:
            db.execute(text("DELETE FROM grc_tpra_question_responses WHERE assessment_id = :aid"), {"aid": aid})
            db.execute(text("DELETE FROM grc_tpra_approvals WHERE assessment_id = :aid"), {"aid": aid})
        db.query(VendorAssessment).filter(VendorAssessment.vendor_id == v.id).delete()
        db.delete(v)
        db.commit()
        print(f"[demo-only] removed demo vendor #{v.id} and its TPRA rows ({engine_tbls})")
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="TPRA teardown / rollback.")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--demo-only", action="store_true", help="Remove only the demo seed data")
    ap.add_argument("--drop-tables", action="store_true", help="Drop the new TPRA tables")
    ap.add_argument("--drop-columns", action="store_true", help="Also drop additive columns (full rollback)")
    args = ap.parse_args()

    if args.demo_only:
        remove_demo(args.slug)
    if args.drop_tables:
        drop_tables(args.slug)
    if args.drop_columns:
        drop_columns(args.slug)
    if not (args.demo_only or args.drop_tables or args.drop_columns):
        ap.error("nothing to do — pass --demo-only and/or --drop-tables [--drop-columns]")


if __name__ == "__main__":
    main()
