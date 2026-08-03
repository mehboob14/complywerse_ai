"""Apply hand-authored CIS PostgreSQL 17 checks to the live tenant DB.

Idempotent UPSERT of check_definition / runner_type / review flags.
Tags `_authored=cis-pg17`. Exports seed snapshot beside the module.

Usage (from backend/):
  python scripts/apply_cis_pg17_checks.py
  python scripts/apply_cis_pg17_checks.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2
from psycopg2.extras import Json

from grc.modules.compliance_plugins.seed_cis_pg17 import (
    AUTHORED,
    AUTH_TAG,
    BENCHMARK,
    merge_windows_variant,
)
from grc.modules.compliance_plugins.os_catalog import ensure_db_engine_nodes


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if not template:
        raise SystemExit("TENANT_DB_URL_TEMPLATE missing from .env")
    dsn = template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    return dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    conn = psycopg2.connect(_tenant_dsn())
    cur = conn.cursor()
    updated = 0
    missing = []
    by_runner: dict[str, int] = {}
    for rule_id, spec in AUTHORED.items():
        cd = merge_windows_variant(rule_id, dict(spec["check_definition"]))
        runner = spec["runner_type"]
        cur.execute(
            """
            SELECT id, runner_type
            FROM grc_compliance_plugins
            WHERE benchmark = %s AND rule_id = %s
            ORDER BY id
            """,
            (BENCHMARK, rule_id),
        )
        rows = cur.fetchall()
        if not rows:
            missing.append(rule_id)
            continue
        for pid, old_runner in rows:
            if args.dry_run:
                print(f"DRY  {rule_id:8} id={pid} {old_runner} -> {runner}")
            else:
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
                print(f"OK   {rule_id:8} id={pid} -> {runner}")
            updated += 1
            by_runner[runner] = by_runner.get(runner, 0) + 1

    # Confirm nothing left hollow on this benchmark.
    cur.execute(
        """
        SELECT count(*) FILTER (
                 WHERE check_definition::text ILIKE '%%\"kind\": \"any\"%%'
                    OR check_definition::text ILIKE '%%\"kind\":\"any\"%%'
               ) AS hollow,
               count(*) AS total
        FROM grc_compliance_plugins
        WHERE benchmark = %s
        """,
        (BENCHMARK,),
    )
    hollow, total = cur.fetchone()

    if not args.dry_run:
        inserted = ensure_db_engine_nodes(cur, product="postgresql", builds=["17"])
        if inserted:
            print(f"catalog_nodes_inserted={inserted}")
        conn.commit()
    cur.close()
    conn.close()

    export_path = (
        BACKEND
        / "grc"
        / "modules"
        / "compliance_plugins"
        / "seed_data"
        / "cis_postgresql_17_authored.json"
    )
    export_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "benchmark": BENCHMARK,
        "authored_tag": AUTH_TAG,
        "rules": {
            rid: {
                "runner_type": spec["runner_type"],
                "check_definition": merge_windows_variant(
                    rid, dict(spec["check_definition"])
                ),
            }
            for rid, spec in AUTHORED.items()
        },
    }
    if not args.dry_run:
        export_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"wrote export {export_path}")

    print(f"updated_rows={updated} missing_rule_ids={missing}")
    print(f"runner_mix={by_runner}")
    print(f"benchmark_rows total={total} hollow_after_apply={hollow if not args.dry_run else 'n/a (dry-run)'}")


if __name__ == "__main__":
    main()
