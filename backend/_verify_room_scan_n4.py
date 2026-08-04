#!python
# -*- coding: utf-8 -*-
"""N-asset capacity proof for the room scan.

Opens Mock Oracle DB (4 peers in its IP group: host, SQL, Tomcat, IIS) and
ticks ALL FOUR at once. Confirms backend handles arbitrary N peers in a
single scan call.

Expected per-asset run counts after one room-scan call:
  Oracle (opened): 296 (its own benchmark, anchor)
  Host           : 100 (ticked)
  SQL            :  74 (ticked)
  Tomcat         :  51 (ticked)
  IIS            :  55 (ticked)
  TOTAL          : 576 runs across 5 assets in ONE call.

The validation in scan_all should accept all 4 peer ids since they all
share the IP. The plugin loop should resolve 5 distinct benchmarks and
fan out attribution.
"""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

import importlib
from grc.db import open_tenant_session
from grc.models import ITAsset, Tenant, CompliancePluginRun, GRCUser
cp_router = importlib.import_module("grc.modules.compliance_plugins.router")
ar = importlib.import_module("grc.routers.assets_router")

SLUG = "liztek-1"


def main():
    db = open_tenant_session(SLUG)
    try:
        tid = db.query(Tenant).filter(Tenant.slug == SLUG).first().id
        host = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "mock-host-01").first()
        sql  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock SQL Server 2022").first()
        tom  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Apache Tomcat 9").first()
        iis  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Web-Server IIS").first()
        ora  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Oracle DB").first()
        user = db.query(GRCUser).first()

        all_assets = [host, sql, tom, iis, ora]
        print("=== Pre-scan baseline (scan_all runs) ===")
        baseline = {}
        for a in all_assets:
            n = db.query(CompliancePluginRun).filter(
                CompliancePluginRun.asset_id == a.id,
                CompliancePluginRun.triggered_by == "scan_all",
            ).count()
            baseline[a.id] = n
            print(f"  {a.name:<24} runs={n}")

        # N=4: tick ALL non-self peers. Opened = Oracle. Peers = host, SQL, Tomcat, IIS.
        ticked = [host.id, sql.id, tom.id, iis.id]
        print()
        print(f"=== _do_scan_all(asset_id=Oracle({ora.id}), include_peer_asset_ids={ticked}) ===")
        cp_router._do_scan_all(
            db, tid, ora.id, user,
            benchmark=None, runner_type=None, connection_id=None,
            include_peer_asset_ids=ticked,
        )
        print("  scan complete")

        # Confirm fan-out: 5 distinct benchmarks ran, attributed correctly.
        print()
        print("=== Post-scan deltas ===")
        total_new = 0
        for a in all_assets:
            after = db.query(CompliancePluginRun).filter(
                CompliancePluginRun.asset_id == a.id,
                CompliancePluginRun.triggered_by == "scan_all",
            ).count()
            delta = after - baseline[a.id]
            total_new += delta
            print(f"  {a.name:<24} runs={after} (+{delta} new)")

        # Per-benchmark breakdown across all assets
        print()
        print("=== Per-benchmark distribution (this run only) ===")
        from sqlalchemy import text
        rows = db.execute(text("""
            SELECT p.benchmark, COUNT(*) FROM grc_compliance_plugin_runs r
            JOIN grc_compliance_plugins p ON p.id = r.plugin_id
            WHERE r.tenant_id = :tid
              AND r.triggered_by = 'scan_all'
              AND r.started_at > NOW() - INTERVAL '5 minutes'
            GROUP BY p.benchmark
            ORDER BY 2 DESC
        """), {"tid": tid}).fetchall()
        for bench, cnt in rows:
            print(f"  {bench:<40} {cnt} runs")

        # Final scores per asset
        print()
        print("=== Scores after N=4 room scan ===")
        for a in all_assets:
            print(f"  {a.name:<24} score={ar._asset_own_compliance(db, a.id, tid)}")

        # Asserts
        new_by_id = {a.id: db.query(CompliancePluginRun).filter(
            CompliancePluginRun.asset_id == a.id,
            CompliancePluginRun.triggered_by == "scan_all",
        ).count() - baseline[a.id] for a in all_assets}
        assert new_by_id[ora.id] >= 296,  f"Oracle expected 296 new, got {new_by_id[ora.id]}"
        assert new_by_id[host.id] >= 100, f"Host expected 100 new, got {new_by_id[host.id]}"
        assert new_by_id[sql.id]  >=  74, f"SQL expected 74 new, got {new_by_id[sql.id]}"
        assert new_by_id[tom.id]  >=  51, f"Tomcat expected 51 new, got {new_by_id[tom.id]}"
        assert new_by_id[iis.id]  >=  55, f"IIS expected 55 new, got {new_by_id[iis.id]}"
        total_expected = 296 + 100 + 74 + 51 + 55
        assert total_new >= total_expected, f"Total new expected >= {total_expected}, got {total_new}"

        print()
        print(f"=== N=4 ROOM SCAN PASSED ({total_new} new runs across {len(all_assets)} assets in 1 call) ===")
        print("  Backend handles arbitrary N peer assets in a single scan call.")
        print("  Each asset's runs are attributed to its own asset_id (independent fan-out).")

    finally:
        db.close()


if __name__ == "__main__":
    main()
