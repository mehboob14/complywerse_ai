"""Test-fire every workflow definition in a tenant once, then report which
completed, which failed, and which never produced an execution instance.

Usage:
    python scripts/test_all_workflows.py [--tenant-slug layeron-group-llc]
                                         [--username info@layeron.com]
                                         [--password Admin123!]
                                         [--base-url http://127.0.0.1:8080/api]
                                         [--limit N]

Side effects (intentional):
    - Each workflow that has an email action will send an email via SMTP.
    - In-app alerts will be posted to whatever user is configured.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from collections import Counter
from typing import Any

import requests  # type: ignore

from sqlalchemy import create_engine, text  # type: ignore


def login(base_url: str, tenant_slug: str, username: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{base_url}/auth/login",
        headers={"Content-Type": "application/json", "X-Tenant-Slug": tenant_slug},
        json={"username": username, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return s


def list_workflow_ids(base_url: str, sess: requests.Session, tenant_slug: str) -> list[tuple[int, str, str]]:
    """Return (id, name, trigger_event) for every workflow in the tenant."""
    items: list[tuple[int, str, str]] = []
    offset = 0
    while True:
        r = sess.get(
            f"{base_url}/workflow-engine/definitions",
            headers={"X-Tenant-Slug": tenant_slug},
            params={"limit": 200, "offset": offset},
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        # The endpoint may return a list or a paginated dict — handle both.
        rows = data if isinstance(data, list) else data.get("items") or data.get("definitions") or []
        if not rows:
            break
        for row in rows:
            items.append((row["id"], row.get("name") or "", row.get("trigger_event") or ""))
        if len(rows) < 200:
            break
        offset += 200
    return items


def trigger_one(base_url: str, sess: requests.Session, tenant_slug: str, wf_id: int, trigger_event: str) -> tuple[bool, str]:
    """Manually trigger a workflow. Returns (ok, error_message)."""
    try:
        r = sess.post(
            f"{base_url}/workflow-engine/executions/trigger",
            headers={"Content-Type": "application/json", "X-Tenant-Slug": tenant_slug},
            json={
                "workflow_definition_id": wf_id,
                "trigger_event": trigger_event or "manual.trigger",
                "payload": {"_test": True, "fired_by": "scripts/test_all_workflows.py"},
                "correlation_id": f"batch_test:{int(time.time())}:{wf_id}",
            },
            timeout=15,
        )
        if r.status_code == 202:
            return True, ""
        return False, f"http={r.status_code} body={r.text[:160]}"
    except Exception as e:
        return False, f"exception: {e}"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--tenant-slug", default="layeron-group-llc")
    p.add_argument("--username", default="info@layeron.com")
    p.add_argument("--password", default="Admin123!")
    p.add_argument("--base-url", default="http://127.0.0.1:8080/api")
    p.add_argument("--limit", type=int, default=0, help="stop after N workflows (0 = no limit)")
    p.add_argument("--wait-seconds", type=int, default=60, help="seconds to wait for instances to drain")
    p.add_argument("--no-side-effects", action="store_true", help="skip workflows containing email actions")
    args = p.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL required.", file=sys.stderr); return 2

    print(f"Logging in to {args.base_url} as {args.username} (tenant {args.tenant_slug}) …")
    sess = login(args.base_url, args.tenant_slug, args.username, args.password)

    print("Fetching workflow definitions …")
    workflows = list_workflow_ids(args.base_url, sess, args.tenant_slug)
    total = len(workflows)
    print(f"Found {total} workflow definitions.")

    # Snapshot instance count BEFORE firing so we know what's new.
    engine = create_engine(db_url)
    with engine.connect() as conn:
        baseline = conn.execute(text(
            "SELECT COUNT(*) FROM grc_workflow_instances WHERE tenant_id = 1"
        )).scalar() or 0
    print(f"Baseline instance count: {baseline}")

    if args.no_side_effects:
        # Filter out workflows whose nodes include action_name = 'send_notification_email'
        with engine.connect() as conn:
            email_ids = set(r[0] for r in conn.execute(text("""
                SELECT DISTINCT workflow_definition_id
                  FROM grc_workflow_nodes
                 WHERE config::text LIKE '%send_notification_email%'
            """)).fetchall())
        before = len(workflows)
        workflows = [w for w in workflows if w[0] not in email_ids]
        print(f"--no-side-effects: excluded {before - len(workflows)} workflows with email actions; {len(workflows)} remaining")

    if args.limit:
        workflows = workflows[: args.limit]
        print(f"--limit {args.limit}: firing {len(workflows)} workflows")

    # ── Fire every workflow ──────────────────────────────────────────────────
    fired_ok: list[tuple[int, str]] = []
    fired_fail: list[tuple[int, str, str]] = []
    start = time.time()
    for i, (wf_id, name, trigger_event) in enumerate(workflows, 1):
        ok, err = trigger_one(args.base_url, sess, args.tenant_slug, wf_id, trigger_event)
        if ok:
            fired_ok.append((wf_id, name))
        else:
            fired_fail.append((wf_id, name, err))
        if i % 25 == 0 or i == len(workflows):
            elapsed = time.time() - start
            print(f"  fired {i}/{len(workflows)}  ok={len(fired_ok)}  fail={len(fired_fail)}  elapsed={elapsed:.1f}s")

    # ── Wait for the runtime to drain ────────────────────────────────────────
    print(f"\nWaiting up to {args.wait_seconds}s for workflows to complete …")
    fired_ok_ids = {wid for wid, _ in fired_ok}
    deadline = time.time() + args.wait_seconds
    last_done = -1
    while time.time() < deadline:
        with engine.connect() as conn:
            row = conn.execute(text("""
                SELECT
                  COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                  COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
                  COUNT(*) FILTER (WHERE status NOT IN ('completed','failed')) AS in_progress
                  FROM grc_workflow_instances
                 WHERE tenant_id = 1
                   AND workflow_definition_id = ANY(:ids)
            """), {"ids": list(fired_ok_ids)}).fetchone()
        completed, failed, in_progress = row
        done = completed + failed
        if done != last_done:
            print(f"  completed={completed}  failed={failed}  in_progress={in_progress}")
            last_done = done
        if in_progress == 0 and done > 0:
            break
        time.sleep(2)

    # ── Final report ────────────────────────────────────────────────────────
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT i.workflow_definition_id, d.name, i.status, i.error_message
              FROM grc_workflow_instances i
              JOIN grc_workflow_definitions d ON d.id = i.workflow_definition_id
             WHERE i.tenant_id = 1
               AND i.workflow_definition_id = ANY(:ids)
               AND i.started_at > NOW() - INTERVAL '20 minutes'
        """), {"ids": list(fired_ok_ids)}).fetchall()

    by_status: Counter[str] = Counter()
    failure_buckets: Counter[str] = Counter()
    completed_ids: set[int] = set()
    failed_rows: list[tuple[int, str, str]] = []
    for wf_id, name, status_, err in rows:
        by_status[status_] += 1
        if status_ == "completed":
            completed_ids.add(wf_id)
        elif status_ == "failed":
            failed_rows.append((wf_id, name, (err or "(no message)")[:200]))
            failure_buckets[(err or "(no message)").split("\n")[0][:80]] += 1

    no_instance_ids = fired_ok_ids - {r[0] for r in rows}

    print("\n" + "=" * 72)
    print("WORKFLOW BATCH TEST RESULTS")
    print("=" * 72)
    print(f"Workflows in catalog (total):        {total}")
    print(f"Trigger requests sent:               {len(fired_ok)}")
    print(f"Trigger requests rejected:           {len(fired_fail)}")
    print(f"Instances completed:                 {by_status['completed']}")
    print(f"Instances failed:                    {by_status['failed']}")
    print(f"Triggered but no instance produced:  {len(no_instance_ids)}")
    print(f"Distinct workflow defs that completed: {len(completed_ids)}")
    print()

    if fired_fail:
        print("── Trigger requests rejected ──")
        for wf_id, name, err in fired_fail[:10]:
            print(f"  #{wf_id:5d}  {name[:50]:50}  → {err}")
        if len(fired_fail) > 10:
            print(f"  ... and {len(fired_fail) - 10} more")
        print()

    if failed_rows:
        print("── Failed instance buckets ──")
        for err, c in failure_buckets.most_common(8):
            print(f"  {c:3d}  {err}")
        print()
        print("── Failed workflows (first 10) ──")
        for wf_id, name, err in failed_rows[:10]:
            print(f"  #{wf_id:5d}  {name[:40]:40}  → {err[:80]}")
        print()

    if no_instance_ids:
        print(f"── Workflows triggered but no instance row appeared ({len(no_instance_ids)}) ──")
        print(f"   These may need longer to start, or dispatcher silently skipped them.")
        sample = list(no_instance_ids)[:8]
        print(f"   sample ids: {sample}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
