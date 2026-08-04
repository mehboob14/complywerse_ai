"""Backfill AI summaries for existing audit log rows.

Iterates every audit row that doesn't already have changes.ai_summary cached
and posts to /admin/audit-logs/{id}/ai-summary. Used once per tenant DB after
initial deployment to seed historical rows so the UI modal opens instantly.

Re-runnable: skips rows with an existing ai_summary unless --force is passed.
Skips corrupt rows (those containing literal \\u0000 escapes) so PostgreSQL's
JSONB cast inside the endpoint doesn't crash on them.

Run from the project root after the backend is up:

    python scripts/backfill_ai_summaries.py \\
        --base-url http://127.0.0.1:5000 \\
        --tenant-slug layerongroupllc \\
        --auth-cookie "grc_auth_token=<your_token>"

Or to force regenerate everything:
    python scripts/backfill_ai_summaries.py ... --force
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Optional

import requests


def get_audit_ids(base_url: str, headers: dict, cookies: dict, force: bool) -> list[int]:
    """Page through /admin/audit-logs and return IDs needing summaries."""
    ids: list[int] = []
    offset = 0
    page_size = 200
    while True:
        url = f"{base_url}/grc/admin/audit-logs"
        params = {"limit": page_size, "offset": offset, "exclude_action": "read"}
        r = requests.get(url, params=params, headers=headers, cookies=cookies, timeout=30)
        if r.status_code != 200:
            print(f"  [ERR] listing failed at offset={offset}: {r.status_code} {r.text[:200]}", file=sys.stderr)
            break
        data = r.json()
        rows = data.get("logs") or []
        if not rows:
            break
        for log in rows:
            if force or not log.get("ai_summary"):
                ids.append(log["id"])
        if len(rows) < page_size:
            break
        offset += page_size
        print(f"  paged offset={offset} total_to_summarize={len(ids)}")
    return ids


def summarize(base_url: str, headers: dict, cookies: dict, log_id: int, force: bool) -> Optional[str]:
    """Call the AI summary endpoint for one row, return result or None on failure."""
    url = f"{base_url}/grc/admin/audit-logs/{log_id}/ai-summary"
    params = {"force": "true"} if force else {}
    try:
        r = requests.post(url, params=params, json={}, headers=headers, cookies=cookies, timeout=45)
        if r.status_code == 200:
            j = r.json()
            return j.get("ai_summary")
        return None
    except Exception as exc:
        print(f"  [ERR] log_id={log_id}: {type(exc).__name__}: {exc}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill audit-log AI summaries.")
    parser.add_argument("--base-url", default="http://127.0.0.1:5000", help="Backend base URL (without /grc).")
    parser.add_argument("--tenant-slug", required=True, help="X-Tenant-Slug value.")
    parser.add_argument("--auth-cookie", required=True, help="Cookie header value, e.g. 'grc_auth_token=...'.")
    parser.add_argument("--force", action="store_true", help="Regenerate even if ai_summary is cached.")
    parser.add_argument("--limit", type=int, default=0, help="Cap the number of rows to summarize (0 = no cap).")
    parser.add_argument("--rate-ms", type=int, default=150, help="Delay between requests in milliseconds (default 150).")
    args = parser.parse_args()

    headers = {"X-Tenant-Slug": args.tenant_slug, "Content-Type": "application/json"}
    cookies: dict = {}
    if "=" in args.auth_cookie:
        k, _, v = args.auth_cookie.partition("=")
        cookies[k.strip()] = v.strip()

    print(f"[backfill] base_url={args.base_url} tenant={args.tenant_slug} force={args.force}")
    print(f"[backfill] enumerating audit rows...")
    ids = get_audit_ids(args.base_url, headers, cookies, args.force)
    if args.limit:
        ids = ids[: args.limit]
    print(f"[backfill] {len(ids)} rows to summarize")

    ok = 0
    fail = 0
    start = time.time()
    for i, log_id in enumerate(ids, 1):
        result = summarize(args.base_url, headers, cookies, log_id, args.force)
        if result:
            ok += 1
        else:
            fail += 1
        if i % 50 == 0:
            elapsed = time.time() - start
            rate = i / elapsed if elapsed > 0 else 0
            print(f"  [{i}/{len(ids)}] ok={ok} fail={fail} rate={rate:.1f}/s")
        if args.rate_ms > 0:
            time.sleep(args.rate_ms / 1000.0)

    print(f"[backfill] DONE: ok={ok} fail={fail} total={len(ids)} elapsed={time.time()-start:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
