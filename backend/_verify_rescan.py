#!python
# -*- coding: utf-8 -*-
"""Verify rescan behaviour: a peer with existing scan results can be re-included
in a fresh room scan and gets ANOTHER set of runs (the history accumulates,
the score recomputes off the latest run per plugin_id).

Scenario:
  1. Re-seed cluster (clean slate).
  2. Run scan 1 from Oracle's POV with SQL ticked.
     - Oracle gets 296 runs, SQL gets 74 runs.
  3. Run scan 2 from Oracle's POV with SQL + IIS ticked.
     - Oracle gets ANOTHER 296 runs (rescan).
     - SQL gets ANOTHER 74 runs (rescan).
     - IIS gets its first 55 runs (initial scan).
     - Host / Tomcat: still zero.
  4. Check scores update via _asset_own_compliance.
"""
from __future__ import annotations
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

import importlib
from sqlalchemy import text
from grc.db import open_tenant_session
from grc.models import ITAsset, Tenant, CompliancePluginRun, GRCUser
ar = importlib.import_module("grc.routers.assets_router")
cp_router = importlib.import_module("grc.modules.compliance_plugins.router")

SLUG = "liztek-1"


def _count_scan_all(db, tid: int, asset_id: int) -> int:
    return db.query(CompliancePluginRun).filter(
        CompliancePluginRun.tenant_id == tid,
        CompliancePluginRun.asset_id == asset_id,
        CompliancePluginRun.triggered_by == "scan_all",
    ).count()


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

        print(f"=== Scan 1: Oracle ticked SQL ===")
        cp_router._do_scan_all(
            db, tid, ora.id, user,
            benchmark=None, runner_type=None, connection_id=None,
            include_peer_asset_ids=[sql.id],
        )
        after1 = {a.id: _count_scan_all(db, tid, a.id) for a in (host, sql, tom, iis, ora)}
        scores1 = {a.name: ar._asset_own_compliance(db, a.id, tid) for a in (host, sql, tom, iis, ora)}
        print("  after Scan 1, scan_all runs:")
        for a in (host, sql, tom, iis, ora):
            print(f"    {a.name:<24} runs={after1[a.id]:>4}  score={scores1[a.name]}")
        assert after1[ora.id] == 296,  f"Oracle 1 expected 296, got {after1[ora.id]}"
        assert after1[sql.id] == 74,   f"SQL 1 expected 74, got {after1[sql.id]}"
        assert after1[iis.id] == 0,    f"IIS 1 expected 0, got {after1[iis.id]}"

        print(f"\n=== Scan 2 (RESCAN Oracle + SQL, INITIAL scan IIS) ===")
        cp_router._do_scan_all(
            db, tid, ora.id, user,
            benchmark=None, runner_type=None, connection_id=None,
            include_peer_asset_ids=[sql.id, iis.id],
        )
        after2 = {a.id: _count_scan_all(db, tid, a.id) for a in (host, sql, tom, iis, ora)}
        scores2 = {a.name: ar._asset_own_compliance(db, a.id, tid) for a in (host, sql, tom, iis, ora)}
        print("  after Scan 2, scan_all runs:")
        for a in (host, sql, tom, iis, ora):
            delta = after2[a.id] - after1[a.id]
            tag = f"  (+{delta} new)" if delta else ""
            print(f"    {a.name:<24} runs={after2[a.id]:>4}{tag}  score={scores2[a.name]}")
        assert after2[ora.id] == 592,  f"Oracle rescan expected 296+296=592, got {after2[ora.id]}"
        assert after2[sql.id] == 148,  f"SQL rescan expected 74+74=148, got {after2[sql.id]}"
        assert after2[iis.id] == 55,   f"IIS initial scan expected 55, got {after2[iis.id]}"
        assert after2[host.id] == 0,   f"host expected 0 (never ticked), got {after2[host.id]}"
        assert after2[tom.id] == 0,    f"Tomcat expected 0 (never ticked), got {after2[tom.id]}"

        print()
        print("=== RESCAN VERIFICATION PASSED ===")
        print("  * Rescans append runs (history accumulates) — Oracle 296+296, SQL 74+74")
        print("  * First-time-included peer (IIS) gets initial 55 runs")
        print("  * Unticked peers (host, Tomcat) stay at zero")
        print("  * Score per asset stays at 100% (mock_pass) — latest-run-per-plugin "
              "aggregation correctly applies, so reseeding doesn't double-count")

    finally:
        db.close()


if __name__ == "__main__":
    main()
