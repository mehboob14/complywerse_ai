"""Seed a mock co-located IP cluster in tenant_liztek1 for browser verification
of the Host-Applications ("room-and-chair") panel.

Idempotent. Re-running deletes any prior mock rows (IP 10.50.0.21 or name prefix
"Mock " / "mock-host-01") before re-seeding so the asset_id stays predictable.

Modes:
  python seed_mock_cluster.py           # seed
  python seed_mock_cluster.py cleanup   # delete mocks, leave nothing behind

Targets (defaults: Low1/Med2/High3/Crit4):
  mock-host-01           infrastructure   windows-server-2022   high       89  (host OS)
  Mock SQL Server 2022   application      mssql-2022            critical  100
  Mock Apache Tomcat 9   application      tomcat-9.0            high       80
  Mock Web-Server IIS    application      iis-10                high       unscanned
  Mock Oracle DB         application      oraclelinux-8         high       unscanned

Expected composite/effective: 89*0.6 + (100*4+80*3)/7 *0.4 = 53.4 + 36.57 = 89.97 -> 90.0
"""

from __future__ import annotations

import os
import sys
from datetime import datetime

# Make sure the package imports resolve against this repo's backend/grc.
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from dotenv import load_dotenv
load_dotenv(os.path.join(HERE, ".env"))

from sqlalchemy import text
from grc.db import open_tenant_session
from grc.models import (
    ITAsset, Tenant, CompliancePlugin, CompliancePluginRun, IntegrationConnection,
    AssetSecurityComplianceSelection,
)

TENANT_SLUG = "liztek-1"  # master DB tenants row id=14, name="liztek"
MOCK_IP = "10.50.0.21"
MOCK_NAME_PREFIX = "Mock "
MOCK_HOST_NAME = "mock-host-01"
MOCK_BENCHMARK_PREFIX = "Mock_CIS_"  # so cleanup can wipe synthetic plugins/runs cleanly

# Synthetic CIS plugin packs for the app benchmarks the real library is missing.
# Each entry: (os_key, benchmark_name, plugin_count). The os_key matches what
# benchmark_for_software_key walks (asset.os_normalized stripped down).
SYNTHETIC_BENCHMARKS = [
    ("windows-server-2022", "Mock_CIS_Win_Server_2022_v1.0", 100),
    ("mssql-2022",          "Mock_CIS_MSSQL_2022_v1.0",      74),
    ("tomcat-9.0",          "Mock_CIS_Tomcat_9_v1.0",        51),
    ("iis-10",              "Mock_CIS_IIS_10_v1.2",          55),
    ("oraclelinux-8",       "Mock_CIS_Oracle_Linux_8_v1.0", 296),
]

# Mock IntegrationConnection name — recognized for cleanup.
MOCK_CONNECTION_NAME = "Mock Room Scan Connection"

MOCK_ASSETS = [
    # (name, asset_type, os_normalized, criticality, target_score_or_None)
    (MOCK_HOST_NAME,        "infrastructure", "windows-server-2022", "high",     89),
    ("Mock SQL Server 2022", "application",   "mssql-2022",          "critical", 100),
    ("Mock Apache Tomcat 9", "application",   "tomcat-9.0",          "high",     80),
    ("Mock Web-Server IIS",  "application",   "iis-10",              "high",     None),
    ("Mock Oracle DB",       "application",   "oraclelinux-8",       "high",     None),
]


def _is_mock_asset(a: ITAsset) -> bool:
    if a.ip_address == MOCK_IP:
        return True
    n = (a.name or "").strip()
    return n == MOCK_HOST_NAME or n.startswith(MOCK_NAME_PREFIX)


def cleanup(session) -> int:
    """Delete every mock asset + its plugin runs + the synthetic CIS plugins.
    Returns the row count touched."""
    mocks = session.query(ITAsset).filter(
        (ITAsset.ip_address == MOCK_IP)
        | (ITAsset.name == MOCK_HOST_NAME)
        | (ITAsset.name.like(f"{MOCK_NAME_PREFIX}%"))
    ).all()
    mocks = [a for a in mocks if _is_mock_asset(a)]

    # Synthetic plugins are identified by their benchmark name prefix.
    synth_plugins = session.query(CompliancePlugin).filter(
        CompliancePlugin.benchmark.like(f"{MOCK_BENCHMARK_PREFIX}%")
    ).all()

    total = 0
    if mocks:
        ids = [a.id for a in mocks]
        run_count = session.query(CompliancePluginRun).filter(
            CompliancePluginRun.asset_id.in_(ids)
        ).delete(synchronize_session=False)
        # Room-scan writes AssetSecurityComplianceSelection rows for the
        # attributed asset — clean those up so the ITAsset rows can drop.
        sel_count = session.query(AssetSecurityComplianceSelection).filter(
            AssetSecurityComplianceSelection.asset_id.in_(ids)
        ).delete(synchronize_session=False)
        asset_count = session.query(ITAsset).filter(ITAsset.id.in_(ids)).delete(
            synchronize_session=False,
        )
        total += asset_count + run_count + sel_count
        print(f"cleanup: deleted {asset_count} assets, {run_count} asset-attributed runs, {sel_count} compliance selections")

    if synth_plugins:
        # Wipe any runs that reference a synthetic plugin (runs from peers' pages
        # written via the room-scan attribution path won't have an asset_id
        # matching our mock cluster — they're attributed to OTHER tenant assets).
        pids = [p.id for p in synth_plugins]
        synth_runs = session.query(CompliancePluginRun).filter(
            CompliancePluginRun.plugin_id.in_(pids)
        ).delete(synchronize_session=False)
        synth_plugin_count = session.query(CompliancePlugin).filter(
            CompliancePlugin.id.in_(pids)
        ).delete(synchronize_session=False)
        total += synth_runs + synth_plugin_count
        print(f"cleanup: deleted {synth_plugin_count} synthetic CIS plugins, {synth_runs} synthetic-plugin runs")

    conn_count = session.query(IntegrationConnection).filter(
        IntegrationConnection.connection_name == MOCK_CONNECTION_NAME
    ).delete(synchronize_session=False)
    if conn_count:
        total += conn_count
        print(f"cleanup: deleted {conn_count} mock integration connection(s)")

    session.commit()
    if total == 0:
        print("cleanup: nothing to delete")
    return total


def seed_synthetic_plugins(session, tenant_id: int) -> int:
    """Create N synthetic CIS plugin rows per missing app benchmark so the
    benchmark_for_software_key soft matcher returns a real benchmark name for
    each mock app asset. Plugins use runner_type='mock_pass' so executing one
    via the normal scan path returns deterministic 'passed' results without
    needing real WinRM/SSH/DB credentials. Returns total plugins created."""
    created = 0
    for os_key, bench_name, count in SYNTHETIC_BENCHMARKS:
        # Already seeded? (idempotent)
        existing = session.query(CompliancePlugin).filter(
            CompliancePlugin.benchmark == bench_name,
        ).count()
        if existing >= count:
            print(f"  synthetic '{bench_name}': {existing} already present, skipping")
            continue
        # Wipe partial / re-seed cleanly.
        if existing > 0:
            session.query(CompliancePlugin).filter(
                CompliancePlugin.benchmark == bench_name
            ).delete(synchronize_session=False)
            session.flush()
        for n in range(1, count + 1):
            session.add(CompliancePlugin(
                tenant_id=tenant_id,
                plugin_key=f"{bench_name}::rule-{n:03d}",
                benchmark=bench_name,
                rule_id=f"{n//10 + 1}.{n}",
                title=f"{bench_name} rule {n}",
                description=f"Synthetic CIS check #{n} for demo of the room-scan model.",
                severity="medium",
                runner_type="mock_pass",
                check_definition={"mock": True},
                enabled=True,
                is_builtin=False,
                review_status="approved",
                os_keys=[os_key],
                classification_source="seed",
            ))
            created += 1
        print(f"  synthetic '{bench_name}': created {count} rules with os_keys=['{os_key}']")
    session.commit()
    return created


def _target_passed_failed(score: int) -> tuple[int, int]:
    """Minimum (passed, failed) pair whose pass-rate rounds to `score` (%).
    _asset_own_compliance aggregates LATEST run per plugin_id, then
    round(100 * passed / total, 1). We use one plugin per run, so total = passed+failed.

    Returns the smallest pair where round(100*p/(p+f), 1) == score.
    """
    if score == 100:
        return (47, 0)   # matches "47 rules" visual
    if score == 80:
        return (8, 2)    # 8/10 = 80.0
    if score == 89:
        return (89, 11)  # 89/100 = 89.0
    # Fallback: brute search for any other target
    for total in range(2, 1000):
        for p in range(0, total + 1):
            if round(100 * p / total, 1) == score:
                return (p, total - p)
    raise ValueError(f"no integer p/f for score={score}")


def seed(session) -> dict:
    """Insert the 5 mock assets + plugin runs. Returns {host_id, ip, assets}."""
    # Step A — discover tenant_id from the self-row in this tenant DB.
    tenant = session.query(Tenant).filter(Tenant.slug == TENANT_SLUG).first()
    if not tenant:
        # Fallback: any Tenant row in this DB is the self-row (per-tenant DB).
        tenant = session.query(Tenant).first()
    if not tenant:
        raise RuntimeError(f"no Tenant row in grc_{TENANT_SLUG} — bad tenant DB?")
    tenant_id = tenant.id
    print(f"resolved tenant_id={tenant_id} (slug={tenant.slug})")

    # Step B — wipe any prior mocks so re-run is safe and host_id is fresh.
    cleanup(session)

    # Step B2 — seed synthetic CIS plugins for the app benchmarks the real
    # library is missing for this tenant (mssql, tomcat, iis). This is what
    # makes the soft matcher resolve a benchmark_name for the Mock SQL Server /
    # Tomcat / IIS rows in the panel, so the user has something to tick into
    # the host's scan.
    seed_synthetic_plugins(session, tenant_id)

    # Step C — pre-flight: enough approved CIS plugin rows to source plugin_ids?
    # Largest demand is 100 (for host 89%). The default seed ships >5,000.
    plugin_rows = (
        session.query(CompliancePlugin.id)
        .filter(
            CompliancePlugin.enabled.is_(True),
            (CompliancePlugin.tenant_id.is_(None))
            | (CompliancePlugin.tenant_id == tenant_id),
        )
        .order_by(CompliancePlugin.id.asc())
        .all()
    )
    plugin_ids = [pid for (pid,) in plugin_rows]
    if len(plugin_ids) < 100:
        raise RuntimeError(
            f"only {len(plugin_ids)} CIS plugins seeded — need 100+ to back the host's 89% score"
        )

    # Step D — insert the 5 assets.
    now = datetime.utcnow()
    created = []
    for name, atype, osn, crit, score in MOCK_ASSETS:
        asset = ITAsset(
            tenant_id=tenant_id,
            name=name,
            asset_type=atype,
            os_normalized=osn,
            host_name=MOCK_HOST_NAME if atype == "infrastructure" else None,
            ip_address=MOCK_IP,
            criticality=crit,
            status="active",
            lifecycle_state="active",
            asset_role="host" if atype == "infrastructure" else "application",
            created_at=now,
        )
        session.add(asset)
        created.append((asset, score))
    session.flush()  # populate IDs without committing yet

    # Step E — synthesize plugin runs to land exactly on each target score.
    runs_total = 0
    for asset, score in created:
        if score is None:
            continue
        passed, failed = _target_passed_failed(score)
        need = passed + failed
        chosen = plugin_ids[:need]
        for i, pid in enumerate(chosen):
            status = "passed" if i < passed else "failed"
            session.add(CompliancePluginRun(
                tenant_id=tenant_id,
                plugin_id=pid,
                asset_id=asset.id,
                status=status,
                started_at=now,
                completed_at=now,
                duration_ms=10,
                triggered_by="mock_seed",
                is_leaked=False,
            ))
            runs_total += 1
        print(f"  scored '{asset.name}' = {passed}/{need} -> {score}%")

    session.commit()

    host = next(a for a, _ in created if a.name == MOCK_HOST_NAME)

    # Step F — seed an IntegrationConnection for the host so scan-all passes
    # its preflight (the asset-pinned-connection lookup matches console_url to
    # host_name). integration_type='mock_pass' so the runner-type compatibility
    # check inside _do_scan_all passes for our synthetic plugins.
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        integration_type="mock_pass",
        category="vuln_scanner",
        connection_name=MOCK_CONNECTION_NAME,
        console_url=MOCK_HOST_NAME,  # asset_pinned_connection joins on lower(console_url) == lower(host.host_name)
        is_active=True,
        status="connected",
        auth_method="api_key",
    )
    session.add(conn)
    session.commit()
    print(f"  seeded IntegrationConnection id={conn.id} pinned to host_name='{MOCK_HOST_NAME}'")
    print(f"seeded {len(created)} assets, {runs_total} plugin runs")
    print(f"HOST asset id = {host.id}   (IP {MOCK_IP})")
    return {
        "host_id": host.id,
        "ip_address": MOCK_IP,
        "assets": [{"id": a.id, "name": a.name, "type": a.asset_type,
                    "os": a.os_normalized, "crit": a.criticality, "score": s}
                   for a, s in created],
    }


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "seed"
    print(f"[seed_mock_cluster] mode={mode} slug={TENANT_SLUG}")
    session = open_tenant_session(TENANT_SLUG)
    try:
        if mode == "cleanup":
            cleanup(session)
        elif mode == "seed":
            result = seed(session)
            print()
            print("==== READY FOR BROWSER ====")
            print(f"  URL: http://liztek1.localhost:3000/assets/{result['host_id']}")
            print(f"  Then click Compliance tab.")
            print(f"  IP group: {MOCK_IP}  ({len(result['assets'])} co-located)")
        else:
            print(f"unknown mode {mode!r} — use 'seed' or 'cleanup'")
            sys.exit(2)
    finally:
        session.close()


if __name__ == "__main__":
    main()
