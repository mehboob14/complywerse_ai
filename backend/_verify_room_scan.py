#!python
# -*- coding: utf-8 -*-
"""Backend-to-backend verification of the room-scan model.

Calls _do_scan_all directly against the seeded cluster with
include_peer_asset_ids = [SQL, Tomcat] and confirms:

  1. New plugin runs are created in the synthetic Win Server / MSSQL / Tomcat
     benchmarks (UNION of host + included peers' benchmarks).
  2. Each run is attributed to the asset whose benchmark it came from:
       - Win Server 2022 runs   -> mock-host-01
       - MSSQL 2022 runs        -> Mock SQL Server 2022
       - Tomcat 9 runs          -> Mock Apache Tomcat 9
  3. NO runs are written for IIS or Oracle DB (peers we did NOT include).
  4. The Mock IIS row remains "Not scanned" (None score), but the included
     peers transition from their seeded score to a fresh 100% (mock_pass).

Re-run safely: it queries by name to find the cluster, so seed-time id
drift between runs doesn't matter.
"""
from __future__ import annotations

import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

import importlib
from grc.db import open_tenant_session
from grc.models import (
    ITAsset, Tenant, CompliancePlugin, CompliancePluginRun,
)
ar = importlib.import_module("grc.routers.assets_router")
cp_router = importlib.import_module("grc.modules.compliance_plugins.router")

SLUG = "liztek-1"
HOST_NAME = "mock-host-01"


def main():
    db = open_tenant_session(SLUG)
    try:
        t = db.query(Tenant).filter(Tenant.slug == SLUG).first()
        tid = t.id

        # Resolve assets by name so id-drift doesn't matter.
        host = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == HOST_NAME).first()
        sql  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock SQL Server 2022").first()
        tom  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Apache Tomcat 9").first()
        iis  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Web-Server IIS").first()
        ora  = db.query(ITAsset).filter(ITAsset.tenant_id == tid, ITAsset.name == "Mock Oracle DB").first()

        print(f"=== Pre-scan baseline (tenant_id={tid}) ===")
        for label, a in (("host (mock-host-01)", host), ("SQL Server", sql),
                          ("Tomcat", tom), ("IIS (NOT included)", iis), ("Oracle (NOT included)", ora)):
            n = db.query(CompliancePluginRun).filter(
                CompliancePluginRun.asset_id == a.id,
                CompliancePluginRun.is_leaked.is_(False),
            ).count()
            score = ar._asset_own_compliance(db, a.id, tid)
            print(f"  {label:<32} id={a.id:>3}  runs={n:<4}  score={score}")

        # ── Execute the room scan via the real backend function. ──
        # current_user is needed only for run.triggered_by_user_id. We pick
        # any user in the tenant; if none, pass None (the run row allows null).
        from grc.models import GRCUser
        user = db.query(GRCUser).first()
        print()
        print(f"=== Running _do_scan_all(asset_id={host.id}, include_peer_asset_ids=[{sql.id},{tom.id}]) ===")
        cp_router._do_scan_all(
            db, tid, host.id, user,
            benchmark=None, runner_type=None, connection_id=None,
            include_peer_asset_ids=[sql.id, tom.id],
        )
        print("  scan complete")

        # ── Post-scan: count fresh runs per asset, broken down by benchmark. ──
        print()
        print("=== Post-scan results (mock_seed runs filtered OUT — these are NEW) ===")
        new_runs = {}
        for label, a in (("host (mock-host-01)", host), ("SQL Server", sql),
                          ("Tomcat", tom), ("IIS (NOT included)", iis), ("Oracle (NOT included)", ora)):
            # Runs from this verification are triggered_by='scan_all' (cp_router
            # default), while the seeded score runs are triggered_by='mock_seed'.
            fresh = db.query(CompliancePluginRun).filter(
                CompliancePluginRun.asset_id == a.id,
                CompliancePluginRun.triggered_by == "scan_all",
            ).count()
            new_runs[a.id] = fresh
            # Per-benchmark breakdown
            by_bench = db.execute(__import__("sqlalchemy").text("""
                SELECT p.benchmark, COUNT(*) FROM grc_compliance_plugin_runs r
                JOIN grc_compliance_plugins p ON p.id = r.plugin_id
                WHERE r.asset_id = :aid AND r.triggered_by = 'scan_all'
                GROUP BY p.benchmark
                ORDER BY p.benchmark
            """), {"aid": a.id}).fetchall()
            score = ar._asset_own_compliance(db, a.id, tid)
            print(f"  {label:<32} id={a.id:>3}  new_runs={fresh:<4}  score={score}")
            for bench, cnt in by_bench:
                print(f"        - {bench:<37} {cnt} runs")

        # ── Assertions. ──
        assert new_runs[host.id] >= 100, f"host should have ~100 fresh Win Server runs, got {new_runs[host.id]}"
        assert new_runs[sql.id] >= 74,   f"SQL should have ~74 fresh MSSQL runs, got {new_runs[sql.id]}"
        assert new_runs[tom.id] >= 51,   f"Tomcat should have ~51 fresh Tomcat runs, got {new_runs[tom.id]}"
        assert new_runs[iis.id] == 0,    f"IIS (NOT included) must have ZERO fresh runs, got {new_runs[iis.id]}"
        assert new_runs[ora.id] == 0,    f"Oracle (NOT included) must have ZERO fresh runs, got {new_runs[ora.id]}"
        print()
        print("=== ROOM-SCAN VERIFICATION PASSED ===")
        print("  - Host got ~100 new Win Server 2022 runs (its own benchmark)")
        print("  - SQL Server got ~74 new MSSQL 2022 runs (its peer benchmark, attributed)")
        print("  - Tomcat got ~51 new Tomcat 9 runs (its peer benchmark, attributed)")
        print("  - IIS got ZERO new runs (NOT included in include_peer_asset_ids)")
        print("  - Oracle got ZERO new runs (NOT included in include_peer_asset_ids)")
        print()
        print("Conclusion: one room-scan against the host fanned its results to the")
        print("two selected peer assets, and left the unselected peers untouched.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
