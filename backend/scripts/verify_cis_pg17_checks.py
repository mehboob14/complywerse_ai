"""Verify authored postgres_sql CIS PG17 checks against the live cluster.

Uses the platform DB login from TENANT_DB_URL_TEMPLATE (grc_app @ 5433).
Expect a real PASS/FAIL/ERROR mix — all-green means the checks are wrong.

Usage (from backend/):
  python scripts/verify_cis_pg17_checks.py
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2

from grc.modules.compliance_plugins.runners.extended_runners import _evaluate_sql_row
from grc.modules.compliance_plugins.seed_cis_pg17 import AUTHORED


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if not template:
        raise SystemExit("TENANT_DB_URL_TEMPLATE missing from .env")
    dsn = template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    return dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


def main() -> None:
    dsn = _tenant_dsn()
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute("SHOW server_version")
    print(f"server_version={cur.fetchone()[0]}")

    passed = failed = errored = 0
    print(f"{'rule':8} {'verdict':8} detail")
    print("-" * 88)
    for rule_id, spec in sorted(
        AUTHORED.items(),
        key=lambda kv: [int(x) if x.isdigit() else x for x in kv[0].split(".")],
    ):
        if spec["runner_type"] != "postgres_sql":
            continue
        cd = spec["check_definition"]
        sql = cd.get("sql")
        expect = cd.get("expect") or {}
        try:
            cur.execute(sql)
            rows = cur.fetchall() or []
            rowcount = len(rows)
            first = rows[0] if rows else None
            ok, detail = _evaluate_sql_row(first, expect, rowcount)
            verdict = "PASS" if ok else "FAIL"
            if ok:
                passed += 1
            else:
                failed += 1
            first_val = first[0] if first else None
            detail_s = re.sub(r"[^\x20-\x7E]", "?", f"{detail} first={first_val!r}")
            print(f"{rule_id:8} {verdict:8} {detail_s}")
        except Exception as exc:  # noqa: BLE001
            errored += 1
            msg = re.sub(r"[^\x20-\x7E]", "?", str(exc))
            print(f"{rule_id:8} {'ERROR':8} {msg}")
            conn.rollback()
            cur = conn.cursor()

    cur.close()
    conn.close()
    print("-" * 88)
    print(f"postgres_sql checks: pass={passed} fail={failed} error={errored}")
    if failed == 0 and errored == 0:
        print("WARNING: all-green — suspect the checks, not the server.")
        sys.exit(2)


if __name__ == "__main__":
    main()
