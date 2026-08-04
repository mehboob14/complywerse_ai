"""Workflow health report — validates every workflow definition in a tenant
against the canvas validator (workflow_validator.py). Outputs:

  * counts: total / valid / invalid / trigger_mismatch
  * per-failure list: workflow id + name + the validator error
  * trigger-event mismatches: persisted value vs computed value

Run:
    python scripts/audit_workflow_health.py [--tenant-id 1]
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter

# Allow `from workflow_validator import ...` regardless of cwd.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import create_engine, text  # type: ignore
from workflow_validator import validate_graph  # type: ignore


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--tenant-id", type=int, default=1)
    p.add_argument("--show-passing", action="store_true",
                   help="also list passing workflow names (default: only show failures)")
    args = p.parse_args()

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("DATABASE_URL must be set.", file=sys.stderr)
        return 2

    engine = create_engine(db_url)
    with engine.connect() as conn:
        wf_rows = conn.execute(text("""
            SELECT id, name, trigger_event, is_active
              FROM grc_workflow_definitions
             WHERE tenant_id = :tid
             ORDER BY id
        """), {"tid": args.tenant_id}).fetchall()

        node_rows = conn.execute(text("""
            SELECT workflow_definition_id, node_key, node_type, name, config,
                   is_start, is_terminal
              FROM grc_workflow_nodes
             WHERE workflow_definition_id IN (
                 SELECT id FROM grc_workflow_definitions WHERE tenant_id = :tid
             )
        """), {"tid": args.tenant_id}).fetchall()

        edge_rows = conn.execute(text("""
            SELECT workflow_definition_id, source_node_key, target_node_key, condition
              FROM grc_workflow_edges
             WHERE workflow_definition_id IN (
                 SELECT id FROM grc_workflow_definitions WHERE tenant_id = :tid
             )
        """), {"tid": args.tenant_id}).fetchall()

    nodes_by_wf: dict[int, list[dict]] = {}
    for r in node_rows:
        wf_id, node_key, node_type, name, config, is_start, is_terminal = r
        nodes_by_wf.setdefault(wf_id, []).append({
            "node_key": node_key,
            "node_type": node_type,
            "name": name,
            "config": config or {},
            "is_start": bool(is_start),
            "is_terminal": bool(is_terminal),
        })
    edges_by_wf: dict[int, list[dict]] = {}
    for r in edge_rows:
        wf_id, src, tgt, cond = r
        edges_by_wf.setdefault(wf_id, []).append({
            "source_node_key": src,
            "target_node_key": tgt,
            "condition": cond or {},
        })

    total = len(wf_rows)
    passing: list[tuple[int, str]] = []
    failing: list[tuple[int, str, str]] = []
    inactive: list[tuple[int, str]] = []
    mismatches: list[tuple[int, str, str, str]] = []  # id, name, persisted, computed
    empty_graphs: list[tuple[int, str]] = []
    error_counter: Counter[str] = Counter()

    for wf in wf_rows:
        wf_id, name, persisted_trigger, is_active = wf
        nodes = nodes_by_wf.get(wf_id, [])
        edges = edges_by_wf.get(wf_id, [])

        if not is_active:
            inactive.append((wf_id, name))

        if not nodes:
            empty_graphs.append((wf_id, name))
            failing.append((wf_id, name, "no nodes persisted"))
            error_counter["no nodes persisted"] += 1
            continue

        ok, err, computed = validate_graph(nodes, edges)
        if not ok:
            failing.append((wf_id, name, err))
            error_counter[err] += 1
            continue

        passing.append((wf_id, name))
        if computed and persisted_trigger and computed != persisted_trigger:
            mismatches.append((wf_id, name, persisted_trigger, computed))

    # ── Report ──────────────────────────────────────────────────────────────
    print(f"Workflow health for tenant {args.tenant_id}")
    print("=" * 72)
    print(f"Total definitions      : {total}")
    print(f"  passing validator    : {len(passing)}")
    print(f"  failing validator    : {len(failing)}")
    print(f"  trigger mismatch     : {len(mismatches)}")
    print(f"  inactive (is_active=False) : {len(inactive)}")
    print(f"  empty graph (no nodes)     : {len(empty_graphs)}")
    print()

    if failing:
        print("── Failures (top error buckets) ──")
        for err, count in error_counter.most_common():
            print(f"  {count:3d}  {err}")
        print()
        print("── Failing workflows (first 30) ──")
        for wf_id, name, err in failing[:30]:
            print(f"  #{wf_id:5d}  {name[:50]:50}  → {err}")
        if len(failing) > 30:
            print(f"  ... and {len(failing) - 30} more")
        print()

    if mismatches:
        print("── Trigger-event mismatches (first 15) ──")
        for wf_id, name, persisted, computed in mismatches[:15]:
            print(f"  #{wf_id:5d}  {name[:40]:40}  persisted={persisted!r}  computed={computed!r}")
        if len(mismatches) > 15:
            print(f"  ... and {len(mismatches) - 15} more")
        print()

    if args.show_passing:
        print("── Passing workflows ──")
        for wf_id, name in passing:
            print(f"  #{wf_id:5d}  {name}")

    return 0 if not failing else 1


if __name__ == "__main__":
    sys.exit(main())
