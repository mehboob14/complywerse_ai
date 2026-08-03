"""Apply tranche 1b seeds (MySQL EE 8.0 + Oracle DB 19c) to live tenant DB.

Tags remain unverified-live. Shape-validates SQL against runner safety filters.
Does NOT claim live pass/fail.

Usage (from backend/):
  python scripts/build_tranche_1b_seeds.py
  python scripts/apply_cis_1b_checks.py
  python scripts/apply_cis_1b_checks.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2
from psycopg2.extras import Json

from grc.modules.compliance_plugins.os_catalog import ensure_keys_from_benchmarks
from grc.modules.compliance_plugins.runners.extended_runners import _is_sql_readonly
from grc.modules.compliance_plugins.runners.oracle_runner import _is_sql_safe

SEEDS = [
    BACKEND
    / "grc/modules/compliance_plugins/seed_data/cis_mysql_ee_8_0_authored.json",
    BACKEND
    / "grc/modules/compliance_plugins/seed_data/cis_oracle_database_19c_authored.json",
]


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if not template:
        raise SystemExit("TENANT_DB_URL_TEMPLATE missing from .env")
    dsn = template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    return dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


def shape_validate(seed: dict) -> list[str]:
    errors = []
    for rid, spec in seed["rules"].items():
        cd = spec["check_definition"]
        runner = spec["runner_type"]
        if cd.get("_verification") != "unverified-live":
            errors.append(f"{rid}: missing unverified-live tag")
        if runner == "mysql_sql":
            ok, reason = _is_sql_readonly(cd.get("sql") or "")
            if not ok:
                errors.append(f"{rid}: mysql sql rejected: {reason}")
            kind = (cd.get("expect") or {}).get("kind")
            if kind not in {
                "row_count_zero",
                "row_count_nonzero",
                "first_value_equals",
                "first_value_contains",
                "first_value_regex",
            }:
                errors.append(f"{rid}: bad mysql expect kind {kind}")
        elif runner == "oracle_sql":
            ok, reason = _is_sql_safe(cd.get("sql") or "")
            if not ok:
                errors.append(f"{rid}: oracle sql rejected: {reason}")
            kind = (cd.get("expect") or {}).get("kind")
            if kind not in {
                "row_count_zero",
                "row_count_nonzero",
                "value_equals",
                "value_in",
                "value_not_in",
                "value_contains",
            }:
                errors.append(f"{rid}: bad oracle expect kind {kind}")
        elif runner == "linux_ssh":
            if "linux" not in (cd.get("applicable_host_families") or []):
                errors.append(f"{rid}: linux_ssh missing host-family gate")
        elif runner == "manual":
            if not cd.get("requires_attestation"):
                errors.append(f"{rid}: manual missing requires_attestation")
        else:
            errors.append(f"{rid}: unexpected runner {runner}")
    return errors


def apply_seed(conn, seed: dict, *, dry_run: bool) -> dict:
    bench = seed["benchmark"]
    cur = conn.cursor()
    updated = 0
    missing = []
    runners = Counter()
    print(f"\n=== APPLY {bench} tag={seed.get('authored_tag')} ver={seed.get('verification')} ===")
    for rid, spec in seed["rules"].items():
        runner = spec["runner_type"]
        cd = spec["check_definition"]
        cur.execute(
            """
            SELECT id FROM grc_compliance_plugins
            WHERE benchmark = %s AND rule_id = %s
            ORDER BY id
            """,
            (bench, rid),
        )
        rows = cur.fetchall()
        if not rows:
            missing.append(rid)
            continue
        for (pid,) in rows:
            if not dry_run:
                cur.execute(
                    """
                    UPDATE grc_compliance_plugins
                    SET runner_type = %s,
                        check_definition = %s,
                        review_status = 'approved',
                        auto_generated_check = FALSE,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (runner, Json(cd), pid),
                )
            updated += 1
            runners[runner] += 1

    cur.execute(
        """
        SELECT count(*) AS total,
               count(*) FILTER (
                 WHERE check_definition::text ILIKE '%%\"kind\": \"any\"%%'
                    OR check_definition::text ILIKE '%%\"kind\":\"any\"%%'
               ) AS hollow,
               count(*) FILTER (
                 WHERE check_definition::text ILIKE '%%unverified-live%%'
               ) AS unverified
        FROM grc_compliance_plugins WHERE benchmark = %s
        """,
        (bench,),
    )
    total, hollow, unverified = cur.fetchone()
    catalog_inserted: list[str] = []
    if not dry_run:
        # Register matching grc_os_versions nodes so Rule Library attaches
        # these benchmarks under Databases (mysql-*/oracle-db-*), not Other.
        catalog = ensure_keys_from_benchmarks(cur, [bench])
        catalog_inserted = catalog.get("inserted") or []
        if catalog_inserted:
            print(f"catalog_nodes_inserted={catalog_inserted}")
        conn.commit()
    else:
        conn.rollback()
    cur.close()
    print(f"updated={updated} missing={missing} runners={dict(runners)}")
    print(f"db total={total} hollow={hollow} unverified_tag={unverified}")
    return {
        "benchmark": bench,
        "updated": updated,
        "missing": missing,
        "runners": dict(runners),
        "total": total,
        "hollow": hollow,
        "unverified": unverified,
        "catalog_inserted": catalog_inserted,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(_tenant_dsn())
    summaries = []
    for path in SEEDS:
        if not path.exists():
            raise SystemExit(f"missing seed {path} — run build_tranche_1b_seeds.py first")
        seed = json.loads(path.read_text(encoding="utf-8"))
        errs = shape_validate(seed)
        if errs:
            print(f"SHAPE ERRORS in {path.name}:")
            for e in errs[:30]:
                print(" ", e)
            if len(errs) > 30:
                print(f"  ... +{len(errs)-30} more")
            raise SystemExit(f"shape validation failed ({len(errs)} errors)")
        print(f"shape OK {path.name} rules={len(seed['rules'])}")
        summaries.append(apply_seed(conn, seed, dry_run=args.dry_run))
    conn.close()

    print("\n" + "=" * 72)
    print("TRANCHE 1b SUMMARY — MySQL EE 8.0 + Oracle DB 19c")
    print("All tagged unverified-live (no local MySQL/Oracle/Docker target).")
    print("=" * 72)
    for s in summaries:
        print(
            f"{s['benchmark']}: total={s['total']} hollow={s['hollow']} "
            f"unverified={s['unverified']} mix={s['runners']}"
        )


if __name__ == "__main__":
    main()
