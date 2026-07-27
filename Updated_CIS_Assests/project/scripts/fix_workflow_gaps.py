"""One-shot fix script: rebuild workflow 1644 with the correct delete PF
and delete leftover test workflows. Re-uses helpers from seed_workflows.py.

What this script does NOT do (because the required Platform Functions
do not exist in the live /workflow-engine/catalog/node-types):
  - 1636 Clause Coverage  → no platform_action.update.governance.clause_coverage.*
  - 1643 Critical Rule    → no platform_action.create.governance.critical_rules.*
  - 1641 Vuln Report      → no platform_action.update.vulnerability_management.reports.*
  - it_assets create/update → entire module absent from catalog
  - projects create/update  → entire module absent from catalog
  - patch_proposals.update  → only 3 .create variants in catalog
These remain as "needs engineering" — adding the PFs is a backend task.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from seed_workflows import (  # noqa: E402
    BASE,
    edge,
    end_node,
    fetch_definition,
    login,
    make_notify,
    PALETTE_LABEL_EMAIL,
    platform_action,
    session,
    start_plain,
)


def rebuild_1644_as_delete() -> None:
    print("\n[fix] rebuilding 1644 with delete.regulatory_change PF...")
    n_nodes, n_edges, n_first, n_last = make_notify(
        "email", "notify", PALETTE_LABEL_EMAIL,
        "Regulatory Change Deleted",
        "A regulatory change record was deleted. Please review.",
        600,
    )
    nodes = [
        start_plain(),
        platform_action(
            "trigger_action", "Delete Regulatory Change",
            "platform_action.delete.governance.regulatory_changes.regulatory_change",
            320,
        ),
        *n_nodes,
        end_node(900),
    ]
    edges = [
        edge("start", "trigger_action"),
        edge("trigger_action", n_first),
        *n_edges,
        edge(n_last, "end"),
    ]
    payload = {
        "name": "Regulatory Change Deleted: Archive & Notify",
        "description": "Notify when a regulatory change record is deleted.",
        "category": "Governance",
        "trigger_event": "manual.trigger",  # backend re-derives
        "nodes": nodes,
        "edges": edges,
        "is_active": True,
    }
    r = session.put(f"{BASE}/workflow-engine/definitions/1644", json=payload, timeout=30)
    r.raise_for_status()
    fresh = fetch_definition(1644)
    print(f"[fix] 1644 trigger_event = {fresh.get('trigger_event')!r}")
    assert fresh.get("trigger_event") == "governance.regulatory_changes.delete", \
        f"expected .delete, got {fresh.get('trigger_event')!r}"
    print("[fix] 1644 ✅ now fires on .delete")


def delete_test_rows() -> None:
    for did in (1650, 1651):
        r = session.delete(f"{BASE}/workflow-engine/definitions/{did}", timeout=15)
        if r.ok:
            print(f"[fix] deleted test workflow {did}")
        else:
            print(f"[fix] delete {did} failed: HTTP {r.status_code} {r.text[:100]}")


def main() -> int:
    login()
    rebuild_1644_as_delete()
    delete_test_rows()
    print("\n[fix] done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
