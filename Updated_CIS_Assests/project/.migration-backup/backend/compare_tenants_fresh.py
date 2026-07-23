"""Run the SAME plugins against BOTH Layeron and Hassan tenants with the
current code, then compare pass counts.

Since both connections point at DESKTOP-CE3EFJB with the same scanner
credentials, the pass/fail outcome MUST be identical for every rule.
Any per-tenant difference left after this run is a real bug.

Picks a fixed subset (50 representative Windows plugins) so the run is
fast. Bypasses the API auth path by calling execute_plugin directly.
"""
from __future__ import annotations
import os, json, time
from collections import Counter
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.models import CompliancePlugin, IntegrationConnection
from grc.modules.compliance_plugins.services.run_service import execute_plugin

# Layeron (id=1) connection 6, Hassan/ca connection 7 — both DESKTOP-CE3EFJB
TENANTS = [
    {"name": "Layeron", "tenant_id": 1, "connection_id": 6},
    {"name": "Hassan",  "tenant_id": 5, "connection_id": 7},
]
SAMPLE_RULES = [
    "1.1.1", "1.1.4", "1.2.1", "1.2.2", "1.2.4",
    "2.2.5", "2.2.6", "2.2.8", "2.2.11", "2.2.12", "2.2.28", "2.2.29", "2.2.33", "2.2.34",
    "2.3.1.1", "2.3.6.1", "2.3.6.2", "2.3.6.3", "2.3.6.6",
    "2.3.7.2", "2.3.10.1", "2.3.10.2", "2.3.10.3", "2.3.10.5", "2.3.10.6", "2.3.10.9",
    "2.3.11.5", "2.3.17.4", "2.3.17.5", "2.3.17.6", "2.3.17.7", "2.3.17.8",
    "5.20", "5.21", "5.22", "5.34", "5.39",
    "18.4.7", "18.9.4.1", "18.9.5.1", "18.10.42.10.3",
]

sess = Session()
try:
    plugins_by_rule = {}
    for r in sess.query(CompliancePlugin).filter(
        CompliancePlugin.tenant_id.is_(None),
        CompliancePlugin.rule_id.in_(SAMPLE_RULES),
        CompliancePlugin.benchmark.like("%Windows_11%"),
    ).all():
        plugins_by_rule[r.rule_id] = r
    print(f"Found {len(plugins_by_rule)} plugins from sample")
    print()

    results_per_tenant: dict[str, Counter] = {}
    detailed_per_rule: dict[str, dict[str, str]] = {}

    for t in TENANTS:
        print(f"=== Running against {t['name']} (tenant_id={t['tenant_id']}) ===")
        connection = sess.query(IntegrationConnection).get(t["connection_id"])
        counter = Counter()
        t0 = time.time()
        for rid, plugin in plugins_by_rule.items():
            run = execute_plugin(
                db=sess,
                tenant_id=t["tenant_id"],
                user_id=1,  # fake user
                plugin=plugin,
                asset=None,
                connection=connection,
                triggered_by="compare_test",
            )
            counter[run.status] += 1
            detailed_per_rule.setdefault(rid, {})[t["name"]] = run.status
        sess.commit()
        elapsed = time.time() - t0
        results_per_tenant[t["name"]] = counter
        print(f"  Done in {elapsed:.1f}s — {dict(counter)}\n")

    print("=== Apples-to-apples comparison ===")
    for name, c in results_per_tenant.items():
        total = sum(c.values())
        p = c.get("passed", 0)
        f = c.get("failed", 0)
        e = c.get("error", 0)
        pct = round(100 * p / total, 1) if total else 0
        print(f"  {name:<10} total={total}  passed={p}  failed={f}  errored={e}  pass%={pct}")

    print()
    print("=== Per-rule disagreement (should be EMPTY if everything is consistent) ===")
    disagreements = []
    for rid, by_t in detailed_per_rule.items():
        statuses = set(by_t.values())
        if len(statuses) > 1:
            disagreements.append((rid, by_t))
    if not disagreements:
        print("  ✓ Zero disagreements — same machine state ⇒ same result for both tenants.")
    else:
        for rid, by_t in disagreements:
            print(f"  {rid}: {by_t}")
finally:
    sess.close()
