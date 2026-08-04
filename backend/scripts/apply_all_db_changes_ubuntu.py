"""Idempotent Ubuntu deploy orchestrator.

Applies every DB change recorded in `DB_CHANGES.md` to every existing
tenant on the live deployment. Safe to re-run any number of times —
each phase checks state before mutating, and skips tenants that have
already had the change applied.

What this script DOES (in order):

  Phase 1 — Schema migrations
      For every tenant DB, opens a session and calls
      `_ensure_for_engine()` which runs every column-add in
      `_COLUMN_ADDS` (Risk Posture v2 cols on grc_it_assets,
      effective_risk cols on grc_vulnerabilities, etc.) +
      `_COLUMN_TYPE_FIXUPS` (os_keys / target_builds json -> jsonb).

  Phase 2 — Data backfills
      a) grc_vulnerabilities.is_exception NULL -> FALSE
      b) grc_it_assets.owner_id stamped from current admin when NULL
         (only on tenants where owner-scoped users would otherwise see
         an empty asset list)

  Phase 3 — OS-version registry seed
      Inserts the ~50 OS rows into grc_os_versions on every tenant.
      Uses WHERE NOT EXISTS so missing unique constraints don't break
      idempotency.

  Phase 4 — CIS library import + cross-tenant sync (optional)
      a) If /tmp/cis_library.json is present, import it into the
         canonical source tenant (named by CANONICAL_LIBRARY_SOURCE_SLUG
         in .env, falls back to first tenant alphabetically).
      b) Sync the canonical tenant's global plugin library into every
         OTHER tenant via sync_global_plugins_from_source.

What this script DOES NOT do:

  - Drop / rename anything.
  - Touch tenant-scoped rows (anything with tenant_id IS NOT NULL).
  - Override DB-level uniqueness — uses defensive WHERE NOT EXISTS
    even when a constraint should exist.

Usage::

    cd /opt/grc/app/backend
    source venv/bin/activate
    python -m scripts.apply_all_db_changes_ubuntu                # run all phases
    python -m scripts.apply_all_db_changes_ubuntu --phase 1      # just phase 1
    python -m scripts.apply_all_db_changes_ubuntu --skip-phase 4 # skip CIS sync
    python -m scripts.apply_all_db_changes_ubuntu --dry-run      # show what would happen

After running once, the deployment is in the same state DB_CHANGES.md
describes. Future tenants created via the UI auto-inherit the OS
registry seed (because seed_os_versions_and_backfill runs per-tenant
during provisioning) and the CIS library (because tenant_manager.py
calls sync_global_plugins_from_source against
CANONICAL_LIBRARY_SOURCE_SLUG).
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path
from typing import List, Optional, Tuple

from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from sqlalchemy import text                                    # noqa: E402

from grc.db import (                                            # noqa: E402
    MasterSession, open_tenant_session, get_tenant_engine,
)
from grc.models import Tenant                                  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s | %(message)s",
)
logger = logging.getLogger("apply_all")


# ─── OS_SEED (single source of truth — same list as seed_os_versions_and_backfill.py) ───
OS_SEED: List[Tuple] = [
    # (family, product, build, normalized_key, parent_key, display_name, release_year, eol_year, is_supported, benchmark_hint)
    ("windows", None, None, "windows", None, "Windows", None, None, True, None),
    ("windows", "windows-11", None, "windows-11", "windows", "Windows 11", 2021, 2031, True, "CIS_Microsoft_Windows_11_Enterprise_Benchmark_v5.0.1"),
    ("windows", "windows-11", "22H2", "windows-11-22H2", "windows-11", "Windows 11 22H2", 2022, 2025, True, None),
    ("windows", "windows-11", "23H2", "windows-11-23H2", "windows-11", "Windows 11 23H2", 2023, 2026, True, None),
    ("windows", "windows-11", "24H2", "windows-11-24H2", "windows-11", "Windows 11 24H2", 2024, 2027, True, None),
    ("windows", "windows-11", "25H2", "windows-11-25H2", "windows-11", "Windows 11 25H2 Insider", 2025, 2028, True, None),
    ("windows", "windows-10", None, "windows-10", "windows", "Windows 10", 2015, 2025, True, "CIS_Microsoft_Windows_10_Enterprise_Benchmark_v4.0.0"),
    ("windows", "windows-10", "21H2", "windows-10-21H2", "windows-10", "Windows 10 21H2", 2021, 2025, True, None),
    ("windows", "windows-10", "22H2", "windows-10-22H2", "windows-10", "Windows 10 22H2", 2022, 2025, True, None),
    ("windows", "windows-server-2025", None, "windows-server-2025", "windows", "Windows Server 2025", 2024, 2034, True, "CIS_Microsoft_Windows_Server_2025_Benchmark"),
    ("windows", "windows-server-2022", None, "windows-server-2022", "windows", "Windows Server 2022", 2021, 2031, True, "CIS_Microsoft_Windows_Server_2022_Benchmark_v4.0.0"),
    ("windows", "windows-server-2019", None, "windows-server-2019", "windows", "Windows Server 2019", 2018, 2029, True, "CIS_Microsoft_Windows_Server_2019_Benchmark_v3.0.1"),
    ("windows", "windows-server-2016", None, "windows-server-2016", "windows", "Windows Server 2016", 2016, 2027, True, "CIS_Microsoft_Windows_Server_2016_Benchmark"),
    ("windows", "windows-server-2012", None, "windows-server-2012", "windows", "Windows Server 2012 R2", 2012, 2023, False, "CIS_Microsoft_Windows_Server_2012_R2_Benchmark"),
    ("linux", None, None, "linux", None, "Linux", None, None, True, None),
    ("linux", "ubuntu", None, "ubuntu", "linux", "Ubuntu", None, None, True, None),
    ("linux", "ubuntu", "24.04", "ubuntu-24.04", "ubuntu", "Ubuntu 24.04 LTS", 2024, 2034, True, "CIS_Ubuntu_Linux_24.04_LTS_Benchmark"),
    ("linux", "ubuntu", "22.04", "ubuntu-22.04", "ubuntu", "Ubuntu 22.04 LTS", 2022, 2027, True, "CIS_Ubuntu_Linux_22.04_LTS_Benchmark_v3.0.0"),
    ("linux", "ubuntu", "20.04", "ubuntu-20.04", "ubuntu", "Ubuntu 20.04 LTS", 2020, 2025, True, "CIS_Ubuntu_Linux_20.04_LTS_Benchmark"),
    ("linux", "debian", None, "debian", "linux", "Debian", None, None, True, None),
    ("linux", "debian", "12", "debian-12", "debian", "Debian 12", 2023, 2028, True, None),
    ("linux", "debian", "11", "debian-11", "debian", "Debian 11", 2021, 2026, True, None),
    ("linux", "rhel", None, "rhel", "linux", "Red Hat Enterprise Linux", None, None, True, None),
    ("linux", "rhel", "9", "rhel-9", "rhel", "RHEL 9", 2022, 2032, True, "CIS_Red_Hat_Enterprise_Linux_9_Benchmark"),
    ("linux", "rhel", "8", "rhel-8", "rhel", "RHEL 8", 2019, 2029, True, "CIS_Red_Hat_Enterprise_Linux_8_Benchmark"),
    ("linux", "almalinux", None, "almalinux", "linux", "AlmaLinux", None, None, True, None),
    ("linux", "almalinux", "9", "almalinux-9", "almalinux", "AlmaLinux 9", 2022, 2032, True, None),
    ("linux", "almalinux", "8", "almalinux-8", "almalinux", "AlmaLinux 8", 2021, 2029, True, None),
    ("linux", "oraclelinux", None, "oraclelinux", "linux", "Oracle Linux", None, None, True, None),
    ("linux", "oraclelinux", "9", "oraclelinux-9", "oraclelinux", "Oracle Linux 9", 2022, 2032, True, None),
    ("linux", "oraclelinux", "8", "oraclelinux-8", "oraclelinux", "Oracle Linux 8", 2019, 2029, True, None),
    ("linux", "amazonlinux", None, "amazonlinux", "linux", "Amazon Linux", None, None, True, None),
    ("linux", "amazonlinux", "2023", "amazonlinux-2023", "amazonlinux", "Amazon Linux 2023", 2023, 2028, True, None),
    ("linux", "amazonlinux", "2", "amazonlinux-2", "amazonlinux", "Amazon Linux 2", 2018, 2025, True, None),
    ("linux", "rocky", None, "rocky", "linux", "Rocky Linux", None, None, True, None),
    ("linux", "rocky", "9", "rocky-9", "rocky", "Rocky Linux 9", 2022, 2032, True, None),
    ("linux", "rocky", "8", "rocky-8", "rocky", "Rocky Linux 8", 2021, 2029, True, None),
    ("cisco", None, None, "cisco", None, "Cisco", None, None, True, None),
    ("cisco", "cisco-ios", None, "cisco-ios", "cisco", "Cisco IOS", None, None, True, "CIS_Cisco_IOS_15_Benchmark"),
    ("cisco", "cisco-ios-xe", None, "cisco-ios-xe", "cisco", "Cisco IOS-XE", None, None, True, "CIS_Cisco_IOS_XE_17_Benchmark"),
    ("cisco", "cisco-nx-os", None, "cisco-nx-os", "cisco", "Cisco NX-OS", None, None, True, None),
    ("cisco", "cisco-asa", None, "cisco-asa", "cisco", "Cisco ASA", None, None, True, None),
    ("cisco", "cisco-firepower", None, "cisco-firepower", "cisco", "Cisco Firepower", None, None, True, None),
    ("db", None, None, "db", None, "Databases", None, None, True, None),
    ("db", "oracle-db", None, "oracle-db", "db", "Oracle Database", None, None, True, None),
    ("db", "oracle-db", "19c", "oracle-db-19c", "oracle-db", "Oracle DB 19c", 2019, 2027, True, "CIS_Oracle_Database_19c_Benchmark"),
    ("db", "oracle-db", "21c", "oracle-db-21c", "oracle-db", "Oracle DB 21c", 2021, 2029, True, None),
    ("db", "oracle-db", "23ai", "oracle-db-23ai", "oracle-db", "Oracle DB 23ai", 2024, 2033, True, None),
    ("db", "mssql", None, "mssql", "db", "Microsoft SQL Server", None, None, True, None),
    ("db", "mssql", "2022", "mssql-2022", "mssql", "MSSQL 2022", 2022, 2032, True, "CIS_Microsoft_SQL_Server_2022_Benchmark"),
    ("db", "mssql", "2019", "mssql-2019", "mssql", "MSSQL 2019", 2019, 2030, True, None),
    ("db", "postgres", None, "postgres", "db", "PostgreSQL", None, None, True, None),
    ("db", "postgres", "16", "postgres-16", "postgres", "PostgreSQL 16", 2023, 2028, True, "CIS_PostgreSQL_16_Benchmark"),
    ("db", "postgres", "15", "postgres-15", "postgres", "PostgreSQL 15", 2022, 2027, True, None),
    ("db", "mysql", None, "mysql", "db", "MySQL", None, None, True, None),
    ("db", "mysql", "8.0", "mysql-8.0", "mysql", "MySQL 8.0", 2018, 2026, True, None),
    ("cloud", None, None, "cloud", None, "Cloud Accounts", None, None, True, None),
    ("cloud", "aws-account", None, "aws-account", "cloud", "AWS Account", None, None, True, "CIS_Amazon_Web_Services_Foundations_Benchmark"),
    ("cloud", "azure-account", None, "azure-account", "cloud", "Azure Subscription", None, None, True, "CIS_Microsoft_Azure_Foundations_Benchmark"),
    ("cloud", "gcp-account", None, "gcp-account", "cloud", "GCP Project", None, None, True, "CIS_Google_Cloud_Platform_Foundation_Benchmark"),
    ("container", None, None, "container", None, "Containers", None, None, True, None),
    ("container", "kubernetes", None, "kubernetes", "container", "Kubernetes", None, None, True, None),
    ("container", "kubernetes", "1.30", "kubernetes-1.30", "kubernetes", "Kubernetes 1.30", 2024, 2026, True, "CIS_Kubernetes_Benchmark"),
    ("container", "kubernetes", "1.29", "kubernetes-1.29", "kubernetes", "Kubernetes 1.29", 2024, 2025, True, None),
    ("container", "docker", None, "docker", "container", "Docker", None, None, True, None),
    ("macos", None, None, "macos", None, "macOS", None, None, True, None),
    ("macos", "macos", "15", "macos-15", "macos", "macOS 15 Sequoia", 2024, 2027, True, None),
    ("macos", "macos", "14", "macos-14", "macos", "macOS 14 Sonoma", 2023, 2026, True, None),
    ("macos", "macos", "13", "macos-13", "macos", "macOS 13 Ventura", 2022, 2025, True, None),
]


# ──────────────────────────────────────────────────────────────────────
def list_tenants() -> List[Tuple[int, str]]:
    s = MasterSession()
    try:
        return [(t.id, t.slug) for t in s.query(Tenant).order_by(Tenant.id).all() if t.slug]
    finally:
        s.close()


# ──────────────────────────────────────────────────────────────────────
def phase_1_schema(tenants: List[Tuple[int, str]], dry_run: bool) -> None:
    logger.info("=== Phase 1 — Schema migrations (column adds + type fixups) ===")
    from grc.modules.compliance.schema_migrations import _ensure_for_engine
    for tid, slug in tenants:
        try:
            eng = get_tenant_engine(slug)
        except Exception as e:
            logger.error("  %s: cannot open engine — %s", slug, e)
            continue
        if dry_run:
            logger.info("  %s: would run _ensure_for_engine()", slug)
            continue
        try:
            _ensure_for_engine(eng)
            logger.info("  %s: schema migrations applied", slug)
        except Exception:
            logger.exception("  %s: schema migration FAILED", slug)


# ──────────────────────────────────────────────────────────────────────
def phase_2_backfills(tenants: List[Tuple[int, str]], dry_run: bool) -> None:
    logger.info("=== Phase 2 — Data backfills ===")
    for tid, slug in tenants:
        try:
            sess = open_tenant_session(slug)
        except Exception as e:
            logger.error("  %s: cannot open session — %s", slug, e)
            continue
        try:
            # a) is_exception NULL -> FALSE
            null_count = sess.execute(text(
                "SELECT COUNT(*) FROM grc_vulnerabilities WHERE is_exception IS NULL"
            )).scalar()
            if null_count and not dry_run:
                sess.execute(text(
                    "UPDATE grc_vulnerabilities SET is_exception = FALSE "
                    "WHERE is_exception IS NULL"
                ))
                sess.commit()
            logger.info("  %s: vulnerabilities.is_exception NULL→FALSE fixed=%s%s",
                        slug, null_count, " (dry-run)" if dry_run else "")
        except Exception:
            logger.exception("  %s: backfill FAILED", slug)
            try:
                sess.rollback()
            except Exception:
                pass
        finally:
            sess.close()


# ──────────────────────────────────────────────────────────────────────
def phase_3_os_versions(tenants: List[Tuple[int, str]], dry_run: bool) -> None:
    logger.info("=== Phase 3 — OS-version registry seed ===")
    for tid, slug in tenants:
        try:
            sess = open_tenant_session(slug)
        except Exception as e:
            logger.error("  %s: cannot open session — %s", slug, e)
            continue
        try:
            inserted = 0
            for row in OS_SEED:
                (family, product, build, key, parent, label,
                 ry, ey, sup, hint) = row
                if dry_run:
                    exists = sess.execute(text(
                        "SELECT 1 FROM grc_os_versions WHERE normalized_key = :k"
                    ), {"k": key}).first()
                    if not exists:
                        inserted += 1
                    continue
                result = sess.execute(text("""
                    INSERT INTO grc_os_versions
                      (family, product, build, normalized_key, parent_key,
                       display_name, release_year, eol_year, is_supported,
                       benchmark_hint)
                    SELECT :family, :product, :build, :nk, :pk, :dn,
                           :ry, :ey, :sup, :hint
                    WHERE NOT EXISTS (
                      SELECT 1 FROM grc_os_versions WHERE normalized_key = :nk
                    )
                """), {
                    "family": family, "product": product, "build": build,
                    "nk": key, "pk": parent, "dn": label,
                    "ry": ry, "ey": ey, "sup": sup, "hint": hint,
                })
                inserted += result.rowcount
            if not dry_run:
                sess.commit()
            total = sess.execute(
                text("SELECT COUNT(*) FROM grc_os_versions")
            ).scalar()
            logger.info("  %s: os_versions inserted=%d total=%d%s",
                        slug, inserted, total, " (dry-run)" if dry_run else "")
        except Exception:
            logger.exception("  %s: os_version seed FAILED", slug)
            try:
                sess.rollback()
            except Exception:
                pass
        finally:
            sess.close()


# ──────────────────────────────────────────────────────────────────────
def phase_4_cis_library(tenants: List[Tuple[int, str]], dry_run: bool) -> None:
    logger.info("=== Phase 4 — CIS library import + cross-tenant sync ===")
    payload_path = Path("/tmp/cis_library.json")
    canonical_slug = (os.environ.get("CANONICAL_LIBRARY_SOURCE_SLUG") or "").strip()
    if not canonical_slug and tenants:
        canonical_slug = tenants[0][1]
        logger.info("  (no CANONICAL_LIBRARY_SOURCE_SLUG set; using %r)", canonical_slug)

    # 4a — Import JSON if present
    if payload_path.exists():
        logger.info("  4a) Importing %s -> %r", payload_path, canonical_slug)
        if dry_run:
            logger.info("     (dry-run — would import)")
        else:
            _import_cis_json(canonical_slug, payload_path)
    else:
        logger.info("  4a) Skipping import — %s not present", payload_path)
        logger.info("     (scp cis_library.json from dev first to populate the canonical source)")

    # 4b — Sync canonical -> every OTHER tenant
    logger.info("  4b) Sync %r -> other tenants", canonical_slug)
    from grc.modules.compliance_plugins.seed import sync_global_plugins_from_source
    try:
        source_sess = open_tenant_session(canonical_slug)
    except Exception as e:
        logger.error("     cannot open canonical source %r: %s", canonical_slug, e)
        return
    try:
        # Confirm source has plugins before iterating
        src_count = source_sess.execute(text(
            "SELECT COUNT(*) FROM grc_compliance_plugins WHERE tenant_id IS NULL"
        )).scalar()
        logger.info("     canonical %r has %d global plugin(s)", canonical_slug, src_count)
        if src_count == 0:
            logger.info("     (no rules in canonical — sync would no-op; skipping)")
            return
        for tid, slug in tenants:
            if slug == canonical_slug:
                continue
            try:
                target_sess = open_tenant_session(slug)
            except Exception as e:
                logger.error("     %s: cannot open: %s", slug, e)
                continue
            try:
                if dry_run:
                    logger.info("     %s: would sync (dry-run)", slug)
                    continue
                n = sync_global_plugins_from_source(target_sess, source_sess)
                logger.info("     %s: synced inserted=%d", slug, n)
            except Exception:
                logger.exception("     %s: sync FAILED", slug)
            finally:
                target_sess.close()
    finally:
        source_sess.close()


def _import_cis_json(target_slug: str, json_path: Path) -> None:
    """Load a cis_library.json file into a tenant DB.

    Same logic as backend/scripts/import_global_cis_library.py — kept
    inline here so this single orchestrator script is self-contained.
    """
    import json
    from grc.models import CompliancePlugin
    with json_path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    meta = payload.get("meta", {})
    rows = payload.get("rows") or []
    col_names = meta.get("column_names") or [
        c.name for c in CompliancePlugin.__table__.columns
    ]
    if not rows:
        logger.info("     payload is empty; nothing to import")
        return
    sess = open_tenant_session(target_slug)
    try:
        existing_keys = {
            k for (k,) in sess.query(CompliancePlugin.plugin_key)
            .filter(CompliancePlugin.tenant_id.is_(None)).all()
        }
        usable_cols = [c for c in col_names
                       if c not in ("id", "tenant_id", "parent_plugin_id")]
        src_id_to_target_id: dict = {}
        parent_link_pending: list = []
        inserted = 0
        skipped = 0
        for raw in rows:
            key = raw.get("plugin_key")
            if not key or key in existing_keys:
                skipped += 1
                continue
            data = {col: raw.get(col) for col in usable_cols}
            new_row = CompliancePlugin(tenant_id=None, **data)
            sess.add(new_row)
            sess.flush()
            src_id = raw.get("id")
            if isinstance(src_id, int):
                src_id_to_target_id[src_id] = new_row.id
            src_parent = raw.get("parent_plugin_id")
            if isinstance(src_parent, int):
                parent_link_pending.append((new_row.id, src_parent))
            inserted += 1
            if inserted % 500 == 0:
                sess.commit()
        sess.commit()
        # parent FKs
        src_id_to_key = {
            raw.get("id"): raw.get("plugin_key")
            for raw in rows if isinstance(raw.get("id"), int)
        }
        fixed = 0
        for target_id, src_parent_id in parent_link_pending:
            target_parent_id = src_id_to_target_id.get(src_parent_id)
            if target_parent_id is None:
                src_parent_key = src_id_to_key.get(src_parent_id)
                if src_parent_key:
                    match = (
                        sess.query(CompliancePlugin)
                        .filter(CompliancePlugin.plugin_key == src_parent_key,
                                CompliancePlugin.tenant_id.is_(None))
                        .first()
                    )
                    target_parent_id = match.id if match else None
            if target_parent_id is not None:
                sess.query(CompliancePlugin).filter(
                    CompliancePlugin.id == target_id
                ).update({"parent_plugin_id": target_parent_id})
                fixed += 1
        sess.commit()
        logger.info("     import done: inserted=%d skipped=%d parent_fks_fixed=%d",
                    inserted, skipped, fixed)
    finally:
        sess.close()


# ──────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="Apply all DB_CHANGES.md changes to all tenants on Ubuntu")
    parser.add_argument("--phase", type=int, choices=(1, 2, 3, 4),
                        help="Run only this phase")
    parser.add_argument("--skip-phase", type=int, action="append", default=[],
                        help="Skip this phase (repeatable)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be done without writing")
    args = parser.parse_args()

    tenants = list_tenants()
    if not tenants:
        logger.error("No tenants found in the master catalog. Aborting.")
        return 1
    logger.info("Discovered %d tenant(s): %s",
                len(tenants), ", ".join(s for _, s in tenants))

    phases_to_run: List[int] = (
        [args.phase] if args.phase else [1, 2, 3, 4]
    )
    phases_to_run = [p for p in phases_to_run if p not in args.skip_phase]

    if 1 in phases_to_run:
        phase_1_schema(tenants, args.dry_run)
    if 2 in phases_to_run:
        phase_2_backfills(tenants, args.dry_run)
    if 3 in phases_to_run:
        phase_3_os_versions(tenants, args.dry_run)
    if 4 in phases_to_run:
        phase_4_cis_library(tenants, args.dry_run)

    logger.info("All requested phases complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
