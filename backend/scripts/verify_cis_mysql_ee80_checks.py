"""Verify authored mysql_sql CIS MySQL EE 8.0 checks against a live instance.

Default target: local MariaDB/MySQL on 127.0.0.1:3307 (throwaway verify box).
Expect a real PASS/FAIL/ERROR mix — all-green means the checks are wrong.

Usage (from backend/):
  set MYSQL_HOST=127.0.0.1
  set MYSQL_PORT=3307
  set MYSQL_USER=root
  set MYSQL_PASSWORD=
  python scripts/verify_cis_mysql_ee80_checks.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import pymysql

from grc.modules.compliance_plugins.runners.extended_runners import _evaluate_sql_row

SEED = (
    BACKEND
    / "grc/modules/compliance_plugins/seed_data/cis_mysql_ee_8_0_authored.json"
)


def main() -> None:
    seed = json.loads(SEED.read_text(encoding="utf-8"))
    host = os.getenv("MYSQL_HOST", "127.0.0.1")
    port = int(os.getenv("MYSQL_PORT", "3307"))
    user = os.getenv("MYSQL_USER", "root")
    password = os.getenv("MYSQL_PASSWORD", "")
    database = os.getenv("MYSQL_DATABASE", "mysql")

    conn = pymysql.connect(
        host=host, port=port, user=user, password=password or None,
        database=database, connect_timeout=10, read_timeout=15,
    )
    cur = conn.cursor()
    cur.execute("SELECT VERSION()")
    version = cur.fetchone()[0]
    print(f"target={host}:{port} version={version}")
    print(f"{'rule':8} {'verdict':8} detail")
    print("-" * 88)

    passed = failed = errored = 0
    for rule_id, spec in sorted(
        seed["rules"].items(),
        key=lambda kv: [int(x) if x.isdigit() else x for x in kv[0].split(".")],
    ):
        if spec["runner_type"] != "mysql_sql":
            continue
        cd = spec["check_definition"]
        sql = cd.get("sql") or ""
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
    print(f"mysql_sql checks: pass={passed} fail={failed} error={errored}")
    print(
        "NOTE: verified against a local MariaDB/MySQL throwaway — tags stay "
        "unverified-live until promoted after review of this mix."
    )
    if failed == 0 and errored == 0:
        print("WARNING: all-green — suspect the checks, not the server.")
        sys.exit(2)


if __name__ == "__main__":
    main()
