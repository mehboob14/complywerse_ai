"""Strip literal backslash-u0000 escape sequences from grc_audit_logs.changes.

PostgreSQL's `json` type tolerates these escape sequences, but `jsonb` does not.
Legacy rows from CIS Windows plugin scans occasionally contain them
(Windows registry values that are byte 0x00). Any row with one of these will
crash queries that `CAST(changes AS jsonb)`.

Run once per tenant DB after deploying:

    python scripts/sanitize_audit_nul_escapes.py \\
        --dsn "postgresql://user:pass@host:port/db" \\
        --tenant-id 1

Safe to re-run — it scans, fixes, and reports the count of cleaned rows.
"""
from __future__ import annotations

import argparse
import sys

import psycopg2


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dsn", required=True, help="Postgres DSN URL.")
    parser.add_argument("--tenant-id", type=int, required=True, help="grc_tenants.id to sanitize.")
    parser.add_argument("--dry-run", action="store_true", help="Report counts without writing.")
    args = parser.parse_args()

    needle = chr(92) + "u0000"  # 6 chars: backslash + u + 0000

    print(f"[sanitize] connecting...")
    conn = psycopg2.connect(args.dsn)
    cur = conn.cursor()

    cur.execute(
        "SELECT id FROM grc_audit_logs WHERE tenant_id=%s ORDER BY id",
        (args.tenant_id,),
    )
    ids = [r[0] for r in cur.fetchall()]
    print(f"[sanitize] scanning {len(ids)} rows for tenant_id={args.tenant_id}")

    bad = 0
    fixed = 0
    for rid in ids:
        cur.execute("SELECT changes::text FROM grc_audit_logs WHERE id=%s", (rid,))
        raw = cur.fetchone()[0]
        if needle in raw:
            bad += 1
            if args.dry_run:
                print(f"  [{rid}] would clean ({raw.count(needle)} occurrences)")
                continue
            cleaned = raw.replace(needle, "")
            cur.execute(
                "UPDATE grc_audit_logs SET changes = %s::json WHERE id=%s",
                (cleaned, rid),
            )
            # Verify jsonb cast now succeeds:
            try:
                cur.execute(
                    "SELECT jsonb_extract_path_text(CAST(changes AS jsonb), 'actor_type') "
                    "FROM grc_audit_logs WHERE id=%s",
                    (rid,),
                )
                cur.fetchone()
                conn.commit()
                fixed += 1
                print(f"  [{rid}] cleaned ({raw.count(needle)} occurrences)")
            except Exception as exc:
                conn.rollback()
                print(f"  [{rid}] verify failed after clean: {type(exc).__name__}: {exc}", file=sys.stderr)
        if rid % 5000 == 0:
            print(f"  ...scanned {rid}")

    print(f"[sanitize] DONE: found={bad}, fixed={fixed}, dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
