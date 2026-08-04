"""Why does the same device + same rules give different pass counts
across tenants / scan attempts? Two hypotheses to verify:

  H1: The pass-rate KPI aggregates ALL runs ever triggered by that
      user, not just the latest scan-all. So if I ran 5 partial Scan
      Alls (some with the credentials-missing bug), my counts come
      from the cumulative pool, not one consistent snapshot.

  H2: check_definition for many plugins CHANGED between when Layeron's
      old runs were recorded and Hassan's new runs were recorded
      (because I ran resynth_all.py which updated 692 templates).
      Old runs reflect the OLD check; new runs the NEW check. Same
      plugin row, different effective check at scan time.

Output: per-tenant breakdown of runs, plus a head-to-head of the
SAME plugin_id where Layeron passed but Hassan failed (or vice versa).
"""
from __future__ import annotations
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

with eng.connect() as conn:
    # Per-tenant aggregate
    print("=== Per-tenant run totals (cumulative across all time) ===")
    rows = conn.execute(text(
        """SELECT t.name as tenant,
                  COUNT(*) as total,
                  COUNT(*) FILTER (WHERE r.status='passed') as passed,
                  COUNT(*) FILTER (WHERE r.status='failed') as failed,
                  COUNT(*) FILTER (WHERE r.status='error') as errored,
                  ROUND(100.0 * COUNT(*) FILTER (WHERE r.status='passed') / NULLIF(COUNT(*),0), 1) as pass_pct
           FROM grc_compliance_plugin_runs r
           JOIN grc_tenants t ON t.id = r.tenant_id
           GROUP BY t.name ORDER BY total DESC"""
    )).all()
    for r in rows:
        print(f"  {r[0]:<25} total={r[1]:<6} passed={r[2]:<5} failed={r[3]:<5} errored={r[4]:<4} pass%={r[5]}")

    # Most-recent Scan All per tenant — what's the SNAPSHOT pass rate
    # if you only count the LATEST run per plugin per tenant?
    print()
    print("=== Latest-run-per-plugin snapshot (apples-to-apples comparison) ===")
    print("    (this is what 'pass rate' SHOULD show — only the most recent run per rule)")
    rows = conn.execute(text(
        """WITH latest AS (
              SELECT DISTINCT ON (r.tenant_id, r.plugin_id)
                     r.tenant_id, r.plugin_id, r.status, r.started_at
                FROM grc_compliance_plugin_runs r
               ORDER BY r.tenant_id, r.plugin_id, r.started_at DESC
           )
           SELECT t.name as tenant,
                  COUNT(*) as scanned_rules,
                  COUNT(*) FILTER (WHERE l.status='passed') as passed,
                  COUNT(*) FILTER (WHERE l.status='failed') as failed,
                  COUNT(*) FILTER (WHERE l.status='error') as errored,
                  ROUND(100.0 * COUNT(*) FILTER (WHERE l.status='passed') / NULLIF(COUNT(*),0), 1) as pass_pct
             FROM latest l JOIN grc_tenants t ON t.id = l.tenant_id
            GROUP BY t.name ORDER BY scanned_rules DESC"""
    )).all()
    for r in rows:
        print(f"  {r[0]:<25} scanned={r[1]:<6} passed={r[2]:<5} failed={r[3]:<5} errored={r[4]:<4} pass%={r[5]}")

    # Cross-tenant disagreement on SAME plugin
    print()
    print("=== Same plugin, different outcome across tenants (latest run each) ===")
    rows = conn.execute(text(
        """WITH latest AS (
              SELECT DISTINCT ON (r.tenant_id, r.plugin_id)
                     r.tenant_id, r.plugin_id, r.status, r.started_at
                FROM grc_compliance_plugin_runs r
               ORDER BY r.tenant_id, r.plugin_id, r.started_at DESC
           ),
           by_plugin AS (
              SELECT plugin_id,
                     ARRAY_AGG(DISTINCT status) as statuses,
                     COUNT(DISTINCT status) as distinct_statuses
                FROM latest
               WHERE status IN ('passed','failed')
               GROUP BY plugin_id
              HAVING COUNT(DISTINCT status) > 1
           )
           SELECT p.rule_id, p.title, bp.statuses
             FROM by_plugin bp JOIN grc_compliance_plugins p ON p.id = bp.plugin_id
            ORDER BY p.rule_id LIMIT 30"""
    )).all()
    print(f"  Found {len(rows)} plugins where tenants disagree on latest run:")
    for r in rows[:15]:
        print(f"    {r[0]:<14} statuses={r[2]}  | {(r[1] or '')[:70]}")
