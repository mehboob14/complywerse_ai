"""Register missing Rule Library catalog nodes for every plugin os_key.

Fixes orphans (benchmark leaf with no grc_os_versions row) so rules appear
under the correct family folder instead of Other / unclassified.

Usage (from backend/):
  python scripts/ensure_os_catalog_nodes.py              # library-wide
  python scripts/ensure_os_catalog_nodes.py --dry-run
  python scripts/ensure_os_catalog_nodes.py --db-only    # DB engines only
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2
from psycopg2.extras import Json

from grc.modules.compliance_plugins.os_catalog import (
    ensure_catalog_nodes_for_keys,
    ensure_db_engine_nodes,
    ensure_keys_from_benchmarks,
    _parse_leaf,
)


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if not template:
        raise SystemExit("TENANT_DB_URL_TEMPLATE missing from .env")
    dsn = template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    return dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


# Known DB builds (apply-script / tranche convenience).
REQUIRED_DB = [
    ("postgresql", ["10", "11", "12", "13", "14", "15", "16", "17", "18"]),
    ("mysql", ["5.6", "5.7", "8.0", "8.4"]),
    ("oracle-db", ["11", "12", "18", "19c", "21c", "23ai", "26"]),
    ("mssql", ["2008", "2012", "2014", "2016", "2017", "2019", "2022", "2025"]),
]

# Benchmarks whose plugins landed with NULL os_keys (cannot attach to tree).
OS_KEYS_BACKFILL = {
    "CIS_Oracle_MySQL_Community_Server_8.4_Benchmark_v1.1.0": ["mysql-8.4"],
    "CIS_Microsoft_Windows_XP_Benchmark__imported__v3.1.0_ARCHIVE": ["windows", "windows-xp"],
    "CIS_Oracle_Solaris_11.4_Benchmark_v1.1.0": ["unix", "solaris", "solaris-11.4"],
    "CIS_Oracle_Solaris_11.1_Benchmark_v1.0.0_Archive": ["unix", "solaris", "solaris-11.1"],
    "CIS_Oracle_Solaris_11_Benchmark_v1.1.0_Archive": ["unix", "solaris", "solaris-11"],
    "CIS_Oracle_Cloud_Infrastructure_Foundations_Benchmark_v3.1.0": ["cloud", "oci"],
    "CIS_Oracle_SaaS_Cloud_Applications_Benchmark_v1.0.0": ["cloud", "oracle-saas"],
}


def _orphan_report(cur) -> tuple[list[tuple], int]:
    cur.execute("SELECT normalized_key FROM grc_os_versions")
    have = {r[0] for r in cur.fetchall()}
    cur.execute(
        """
        SELECT leaf, count(DISTINCT benchmark) benches, sum(n)::int rules
        FROM (
          SELECT benchmark,
            CASE WHEN jsonb_typeof(CAST(os_keys AS jsonb)) = 'array'
                 THEN CAST(os_keys AS jsonb)->>-1 ELSE NULL END AS leaf,
            count(*) n
          FROM grc_compliance_plugins
          WHERE enabled AND review_status IN ('approved','auto_approved')
            AND os_keys IS NOT NULL
            AND CAST(os_keys AS text) NOT IN ('null','[]','""')
          GROUP BY 1, 2
        ) t
        WHERE leaf IS NOT NULL
        GROUP BY leaf
        ORDER BY rules DESC
        """
    )
    orphans = []
    rules = 0
    for leaf, benches, n in cur.fetchall():
        if leaf not in have:
            orphans.append((leaf, benches, n))
            rules += int(n)
    return orphans, rules


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--db-only",
        action="store_true",
        help="Only ensure DB engine nodes (legacy tranche mode)",
    )
    args = ap.parse_args()

    conn = psycopg2.connect(_tenant_dsn())
    cur = conn.cursor()

    if args.dry_run:
        orphans, rules = _orphan_report(cur)
        print(f"orphan_leaves={len(orphans)} orphan_rules={rules}")
        other = 0
        for leaf, benches, n in orphans:
            parsed = _parse_leaf(leaf)
            fam = parsed[-1][0] if parsed else "?"
            if fam == "other":
                other += 1
            print(f"  {leaf:32} benches={benches:3} rules={n:5} → family={fam}")
        print(f"would_land_in_other_family={other}")
        for bench, keys in OS_KEYS_BACKFILL.items():
            cur.execute(
                """
                SELECT count(*) FROM grc_compliance_plugins
                WHERE benchmark = %s
                  AND (os_keys IS NULL OR CAST(os_keys AS text) IN ('null','[]','""'))
                """,
                (bench,),
            )
            print(f"os_keys_backfill {bench}: would_fix={cur.fetchone()[0]} -> {keys}")
        cur.close()
        conn.close()
        return

    inserted_all: list[str] = []

    # Optional NULL os_keys backfill first so the sweep sees those leaves.
    for bench, keys in OS_KEYS_BACKFILL.items():
        cur.execute(
            """
            UPDATE grc_compliance_plugins
            SET os_keys = %s::jsonb, updated_at = NOW()
            WHERE benchmark = %s
              AND (
                os_keys IS NULL
                OR CAST(os_keys AS text) IN ('null', '[]', '""')
              )
            """,
            (Json(keys), bench),
        )
        if cur.rowcount:
            print(f"os_keys_backfill {bench}: rows={cur.rowcount} -> {keys}")

    if args.db_only:
        for product, builds in REQUIRED_DB:
            inserted = ensure_db_engine_nodes(cur, product=product, builds=builds)
            inserted_all.extend(inserted)
            print(f"{product}: inserted={inserted or 'none (already present)'}")
    else:
        # Library-wide: every distinct os_key element in plugins.
        result = ensure_keys_from_benchmarks(cur, overwrite=False)
        inserted_all.extend(result["inserted"])
        print(
            f"library_wide: distinct_keys={len(result['leaves'])} "
            f"inserted={len(result['inserted'])}"
        )
        if result["inserted"]:
            for k in sorted(result["inserted"]):
                print(f"  + {k}")

    conn.commit()

    orphans, rules = _orphan_report(cur)
    print("\n--- attachment check (orphan leaves remaining) ---")
    if not orphans:
        print("OK  0 orphan leaves — all approved plugin leaves attach to catalog")
    else:
        for leaf, benches, n in orphans:
            print(f"ORPHAN  benches={benches:3} rules={n:5}  leaf={leaf}")
        print(f"remaining orphan_leaves={len(orphans)} orphan_rules={rules}")

    # Spot-check high-value benches
    cur.execute("SELECT normalized_key FROM grc_os_versions")
    have = {r[0] for r in cur.fetchall()}
    cur.execute(
        """
        SELECT benchmark,
          CASE WHEN jsonb_typeof(CAST(os_keys AS jsonb)) = 'array'
               THEN CAST(os_keys AS jsonb)->>-1 ELSE NULL END AS leaf,
          count(*) n
        FROM grc_compliance_plugins
        WHERE enabled AND review_status IN ('approved','auto_approved')
          AND (
            benchmark ILIKE '%Windows_Server_2012_R2%'
            OR benchmark ILIKE '%Debian%'
            OR benchmark ILIKE '%macOS_15%'
            OR benchmark ILIKE '%FortiGate%'
            OR benchmark ILIKE '%Juniper%'
            OR benchmark ILIKE '%Cassandra%'
            OR benchmark ILIKE '%WebSphere%'
            OR benchmark ILIKE '%PostgreSQL_18%'
            OR benchmark ILIKE 'CIS_AKS%'
            OR benchmark ILIKE '%AWS_Database%'
          )
          AND benchmark NOT ILIKE '%vvUNKNOWN%'
        GROUP BY 1, 2
        ORDER BY 1
        """
    )
    print("\n--- spot checks ---")
    for bench, leaf, n in cur.fetchall():
        status = "OK" if leaf and leaf in have else "ORPHAN"
        print(f"{status:6} {n:4}  leaf={leaf}  {bench[:70]}")

    cur.close()
    conn.close()
    print(f"\ninserted_total={len(inserted_all)}")


if __name__ == "__main__":
    main()
