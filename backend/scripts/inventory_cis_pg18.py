"""Inventory CIS PostgreSQL 18 benchmark rules from the live tenant DB.

Loads credentials from backend/.env (never prints them). Writes a JSON
summary to scripts/_out_cis_pg18_inventory.json for authoring work.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))

import psycopg2


def _tenant_dsn() -> str:
    template = (os.getenv("TENANT_DB_URL_TEMPLATE") or "").strip()
    if template:
        return template.replace("{slug}", "complyverse").replace("{tenant_slug}", "complyverse")
    # Fallbacks used by some local setups
    for key in ("DATABASE_URL", "TENANT_DATABASE_URL", "GRC_TENANT_DB_URL"):
        v = (os.getenv(key) or "").strip()
        if v:
            return v
    raise SystemExit("No TENANT_DB_URL_TEMPLATE / DATABASE_URL in .env")


def _expect_kind(cd: dict) -> str:
    if not isinstance(cd, dict):
        return "missing"
    expect = cd.get("expect") or {}
    if isinstance(expect, dict):
        return str(expect.get("kind") or "?")
    return "?"


def main() -> None:
    dsn = _tenant_dsn()
    # psycopg2 wants postgresql:// not postgres+psycopg2://
    dsn = dsn.replace("postgresql+psycopg2://", "postgresql://").replace(
        "postgres+psycopg2://", "postgresql://"
    )
    conn = psycopg2.connect(dsn)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT id, plugin_key, rule_id, title, runner_type, enabled,
               review_status, auto_generated_check,
               check_definition, audit_steps_text,
               LEFT(COALESCE(description,''), 240) AS description_head
        FROM grc_compliance_plugins
        WHERE benchmark ILIKE %s
        ORDER BY
          CASE WHEN rule_id ~ '^[0-9]+(\\.[0-9]+)*$' THEN 0 ELSE 1 END,
          string_to_array(regexp_replace(rule_id, '[^0-9.]', '', 'g'), '.')::int[] NULLS LAST,
          rule_id
        """,
        ("%PostgreSQL_18%",),
    )
    rows = cur.fetchall()
    cols = [d[0] for d in cur.description]
    out = []
    counts = {"any": 0, "authored_sql": 0, "manual": 0, "other": 0, "todo": 0, "enabled": 0}
    for row in rows:
        rec = dict(zip(cols, row))
        cd = rec.get("check_definition") or {}
        if isinstance(cd, str):
            try:
                cd = json.loads(cd)
            except Exception:
                cd = {"_raw": cd}
        kind = _expect_kind(cd if isinstance(cd, dict) else {})
        has_sql = bool(isinstance(cd, dict) and (cd.get("sql") or cd.get("command")))
        is_todo = "TODO" in json.dumps(cd)
        authored = isinstance(cd, dict) and cd.get("_authored")
        classification = "other"
        if kind == "any":
            classification = "any"
            counts["any"] += 1
        elif has_sql and kind != "any":
            classification = "authored_sql"
            counts["authored_sql"] += 1
        elif (rec.get("runner_type") or "") == "manual":
            classification = "manual"
            counts["manual"] += 1
        else:
            counts["other"] += 1
        if is_todo:
            counts["todo"] += 1
        if rec.get("enabled"):
            counts["enabled"] += 1

        audit = rec.get("audit_steps_text") or ""
        excerpt = ""
        if isinstance(cd, dict):
            excerpt = str(cd.get("_audit_excerpt") or "")[:800]
        out.append(
            {
                "id": rec["id"],
                "plugin_key": rec["plugin_key"],
                "rule_id": rec["rule_id"],
                "title": rec["title"],
                "runner_type": rec["runner_type"],
                "enabled": bool(rec["enabled"]),
                "review_status": rec["review_status"],
                "auto_generated_check": bool(rec["auto_generated_check"]),
                "expect_kind": kind,
                "has_sql": has_sql,
                "authored_tag": authored,
                "classification": classification,
                "check_definition": cd,
                "audit_steps_text": (audit or "")[:2000],
                "audit_excerpt": excerpt,
                "description_head": rec.get("description_head") or "",
            }
        )

    cur.close()
    conn.close()

    dest = BACKEND / "scripts" / "_out_cis_pg18_inventory.json"
    payload = {
        "benchmark_filter": "%PostgreSQL_18%",
        "total": len(out),
        "counts": counts,
        "rules": out,
    }
    dest.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    print(f"wrote {dest} — total={len(out)} counts={counts}")


if __name__ == "__main__":
    main()
