"""Apply + shape-verify CIS PostgreSQL 13–16 authored checks (family batch).

Per-version deltas come from ``seed_cis_postgresql_family.PROFILES`` (audit-prose
driven). Checks are tagged ``_verification=shape-verified`` because the only
live target is the platform PG18 instance on :5433 — do NOT claim verified-live
on a native major.

Usage (from backend/):
  python scripts/apply_cis_pg_family_checks.py              # 16 15 14 13
  python scripts/apply_cis_pg_family_checks.py --versions 16,15
  python scripts/apply_cis_pg_family_checks.py --dry-run
  python scripts/apply_cis_pg_family_checks.py --verify-only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2
from psycopg2.extras import Json

from grc.modules.compliance_plugins.runners.extended_runners import _evaluate_sql_row
from grc.modules.compliance_plugins.os_catalog import ensure_db_engine_nodes
from grc.modules.compliance_plugins.seed_cis_postgresql_family import (
    PROFILES,
    build_postgresql_family,
    export_filename,
    merge_windows_variant,
)


DEFAULT_ORDER = (16, 15, 14, 13)


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if not template:
        raise SystemExit("TENANT_DB_URL_TEMPLATE missing from .env")
    dsn = template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    return dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )


def apply_one(conn, major: int, *, dry_run: bool) -> dict:
    built = build_postgresql_family(major)
    profile = built["profile"]
    authored = built["authored"]
    windows = built["windows_variants"]
    cur = conn.cursor()
    updated = 0
    missing: list[str] = []
    by_runner: dict[str, int] = {}

    print(f"\n=== APPLY PG{major}  {profile.benchmark}  tag={profile.auth_tag} ===")
    print("deltas:")
    for d in built["deltas"]:
        print(f"  - {d}")

    for rule_id, spec in authored.items():
        cd = merge_windows_variant(windows, rule_id, dict(spec["check_definition"]))
        runner = spec["runner_type"]
        cur.execute(
            """
            SELECT id, runner_type
            FROM grc_compliance_plugins
            WHERE benchmark = %s AND rule_id = %s
            ORDER BY id
            """,
            (profile.benchmark, rule_id),
        )
        rows = cur.fetchall()
        if not rows:
            missing.append(rule_id)
            continue
        for pid, _old in rows:
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
            by_runner[runner] = by_runner.get(runner, 0) + 1

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
        (profile.benchmark,),
    )
    hollow, total = cur.fetchone()

    export_path = (
        BACKEND
        / "grc"
        / "modules"
        / "compliance_plugins"
        / "seed_data"
        / export_filename(major)
    )
    payload = {
        "benchmark": profile.benchmark,
        "authored_tag": profile.auth_tag,
        "verification": profile.verification,
        "deltas": built["deltas"],
        "note": (
            "shape-verified against platform PostgreSQL 18 via grc_app — "
            "not a native PG{major} instance".format(major=major)
        ),
        "rules": {
            rid: {
                "runner_type": spec["runner_type"],
                "check_definition": merge_windows_variant(
                    windows, rid, dict(spec["check_definition"])
                ),
            }
            for rid, spec in authored.items()
        },
    }
    if not dry_run:
        inserted = ensure_db_engine_nodes(
            cur, product="postgresql", builds=[str(major)]
        )
        if inserted:
            print(f"catalog_nodes_inserted={inserted}")
        export_path.parent.mkdir(parents=True, exist_ok=True)
        export_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        conn.commit()
        print(f"wrote {export_path}")
    else:
        conn.rollback()

    print(
        f"updated_rows={updated} missing={missing} runner_mix={by_runner} "
        f"total={total} hollow={hollow if not dry_run else 'n/a'}"
    )
    cur.close()
    return {
        "major": major,
        "updated": updated,
        "missing": missing,
        "by_runner": by_runner,
        "total": total,
        "hollow": hollow if not dry_run else None,
        "deltas": built["deltas"],
        "verification": profile.verification,
        "authored": authored,
    }


def verify_one(conn, major: int, authored: dict) -> dict:
    cur = conn.cursor()
    cur.execute("SHOW server_version")
    server_version = cur.fetchone()[0]
    passed = failed = errored = 0
    print(f"\n=== VERIFY PG{major} (shape-verified on server_version={server_version}) ===")
    print(f"{'rule':8} {'verdict':8} detail")
    print("-" * 88)
    for rule_id, spec in sorted(
        authored.items(),
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
    print("-" * 88)
    print(f"postgres_sql: pass={passed} fail={failed} error={errored}")
    if failed == 0 and errored == 0:
        print("WARNING: all-green — suspect the checks, not the server.")
    return {
        "major": major,
        "server_version": server_version,
        "pass": passed,
        "fail": failed,
        "error": errored,
        "verification": "shape-verified",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--versions",
        default=",".join(str(v) for v in DEFAULT_ORDER),
        help="Comma-separated majors, default 16,15,14,13",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    args = ap.parse_args()

    versions = [int(x.strip()) for x in args.versions.split(",") if x.strip()]
    for v in versions:
        if v not in PROFILES:
            raise SystemExit(f"unsupported major {v}; known={sorted(PROFILES)}")

    conn = psycopg2.connect(_tenant_dsn())
    apply_summaries = []
    verify_summaries = []

    for major in versions:
        if args.verify_only:
            built = build_postgresql_family(major)
            verify_summaries.append(verify_one(conn, major, built["authored"]))
        else:
            s = apply_one(conn, major, dry_run=args.dry_run)
            apply_summaries.append(s)
            if not args.dry_run:
                verify_summaries.append(verify_one(conn, major, s["authored"]))

    conn.close()

    print("\n" + "=" * 72)
    print("BATCH SUMMARY (PostgreSQL family 13–16) — stop before MySQL/Oracle")
    print("=" * 72)
    for s in apply_summaries:
        print(
            f"PG{s['major']}: total={s['total']} hollow={s['hollow']} "
            f"mix={s['by_runner']} deltas={s['deltas']}"
        )
    for v in verify_summaries:
        print(
            f"PG{v['major']} shape-verify on PG{v['server_version']}: "
            f"{v['pass']} PASS / {v['fail']} FAIL / {v['error']} ERROR "
            f"[{v['verification']}]"
        )


if __name__ == "__main__":
    main()
