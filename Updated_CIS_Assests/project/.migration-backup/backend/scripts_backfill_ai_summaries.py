"""One-shot backfill: populate `changes.ai_summary` on every audit log row
that doesn't have one yet. Reads are skipped by default (set --include-reads
to summarize them too).

Usage:
    python scripts_backfill_ai_summaries.py [--tenant-id 1] [--include-reads]
                                            [--workers 8] [--limit N]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, Optional

# Allow `from grc.audit_ai_summary import generate_ai_summary` regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified

from grc.audit_ai_summary import generate_ai_summary
from grc.models import AuditLog, Base  # noqa: F401


def _build_row_dict(log_id: int, user_id: Optional[int], user_name: str,
                    action: str, resource_type: str,
                    resource_id: Optional[int], changes: Dict[str, Any]) -> Dict[str, Any]:
    actor_type = changes.get("actor_type", "user")
    if not user_name:
        user_name = "Workflow Engine" if actor_type == "workflow_engine" else "System"
    return {
        "user_name": user_name,
        "actor_type": actor_type,
        "action": action,
        "resource_type": resource_type,
        "resource_id": resource_id,
        "resource_name": changes.get("resource_name"),
        "method": changes.get("method"),
        "path": changes.get("path"),
        "status_code": changes.get("status_code"),
        "summary": changes.get("summary"),
        "request": changes.get("request"),
        "snapshot": changes.get("snapshot"),
        "field_diff": changes.get("field_diff"),
        "response_error": changes.get("response_error"),
    }


def summarize_one(row_id: int, row_dict: Dict[str, Any]) -> Optional[str]:
    try:
        return generate_ai_summary(row_dict)
    except Exception as e:
        print(f"  [{row_id}] error: {e}", flush=True)
        return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--tenant-id", type=int, default=1)
    p.add_argument("--include-reads", action="store_true")
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--limit", type=int, default=999999)
    args = p.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL must be set.", file=sys.stderr); sys.exit(2)
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY must be set.", file=sys.stderr); sys.exit(2)

    engine = create_engine(db_url, pool_size=args.workers + 4, max_overflow=8)
    Session = sessionmaker(bind=engine)

    # Some legacy rows contain a literal 6-char sequence "" embedded in
    # their stored JSON. PG refuses to convert those to text, which crashes the
    # whole query if we touch jsonb on those rows. Use a position() check on
    # the raw stored TEXT (never triggers JSON parsing) to filter them out.
    bad_marker = chr(0x5C) + "u0000"
    skip_read_sql = "" if args.include_reads else " AND a.action <> 'read'"

    # Step 1: get just the IDs first (no JSON column touched, can't fail).
    ids_sql = text(
        "SELECT a.id FROM grc_audit_logs a\n"
        " WHERE a.tenant_id = :tid\n"
        + skip_read_sql + "\n"
        " ORDER BY a.id DESC\n"
        " LIMIT :limit\n"
    )
    with engine.connect() as conn:
        candidate_ids = [r[0] for r in conn.execute(
            ids_sql, {"tid": args.tenant_id, "limit": args.limit}
        ).fetchall()]
    print(f"Candidate audit log rows: {len(candidate_ids)}", flush=True)

    # Step 2: fetch each row individually. Skip rows whose JSON can't be
    # converted (the ~17 legacy rows with embedded NUL escape sequences). Also
    # skip rows that already have ai_summary cached.
    row_sql = text(
        "SELECT a.user_id, a.action, a.resource_type, a.resource_id,\n"
        "       a.changes, u.display_name\n"
        "  FROM grc_audit_logs a\n"
        "  LEFT JOIN grc_users u ON u.id = a.user_id\n"
        " WHERE a.id = :rid"
    )
    rows = []
    skipped_corrupt = 0
    skipped_cached = 0
    with engine.connect() as conn:
        for rid in candidate_ids:
            try:
                row = conn.execute(row_sql, {"rid": rid}).fetchone()
                if row is None:
                    continue
                user_id, action, rtype, resource_id, changes, display_name = row
                # check cache flag without converting full json to text
                if isinstance(changes, dict) and changes.get("ai_summary"):
                    skipped_cached += 1
                    continue
                rows.append((rid, user_id, action, rtype, resource_id, changes, display_name))
            except Exception as e:
                skipped_corrupt += 1
                # Rollback the transaction so subsequent queries work.
                conn.rollback()
    print(f"After row-level filter: {len(rows)} to process, "
          f"skipped_corrupt={skipped_corrupt}, skipped_cached={skipped_cached}",
          flush=True)

    total = len(rows)
    print(f"Backfilling {total} rows (workers={args.workers}, include_reads={args.include_reads})", flush=True)
    if not total:
        print("Nothing to do."); return

    work: Dict[int, Dict[str, Any]] = {}
    for r in rows:
        log_id, user_id, action, rtype, rid, changes, display_name = r
        if isinstance(changes, str):
            try:
                changes = json.loads(changes)
            except Exception:
                changes = {}
        elif changes is None:
            changes = {}
        work[log_id] = _build_row_dict(log_id, user_id, display_name or "", action, rtype, rid, changes)

    done = 0
    failed = 0
    start = time.time()
    write_session = Session()

    def runner(log_id: int):
        return log_id, summarize_one(log_id, work[log_id])

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(runner, lid) for lid in work.keys()]
        for fut in as_completed(futures):
            log_id, summary = fut.result()
            done += 1
            if not summary:
                failed += 1
            else:
                log = write_session.query(AuditLog).filter(AuditLog.id == log_id).first()
                if log is None:
                    failed += 1
                else:
                    c = dict(log.changes) if isinstance(log.changes, dict) else (json.loads(log.changes) if isinstance(log.changes, str) else {})
                    c["ai_summary"] = summary
                    log.changes = c
                    flag_modified(log, "changes")
                    if done % 100 == 0:
                        write_session.commit()
            if done % 50 == 0 or done == total:
                elapsed = time.time() - start
                rate = done / max(elapsed, 0.001)
                eta = (total - done) / max(rate, 0.001)
                print(f"  {done}/{total}  ok={done-failed} fail={failed}  rate={rate:.1f}/s  eta={int(eta)}s", flush=True)

    write_session.commit()
    write_session.close()

    print(f"\nDone. ok={total-failed} failed={failed} elapsed={int(time.time()-start)}s")


if __name__ == "__main__":
    main()
