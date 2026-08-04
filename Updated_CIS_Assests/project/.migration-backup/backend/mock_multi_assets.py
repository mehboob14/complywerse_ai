"""Mock fixture: add 4 fake assets to Layeron tenant and seed varied
scan results against each so the Assets tab demonstrates real per-asset
differentiation. Idempotent — re-running won't duplicate.

Assets added:
  DC-01            Windows Server  — 92% pass rate (well-hardened DC)
  FILE-01          Windows Server  — 45% pass rate (legacy, lots of issues)
  WEB-LINUX-01     Linux Server    — no Linux rules yet, so 'never scanned'
  PROD-AWS         AWS Account     — no AWS rules yet, so 'never scanned'

The Windows assets get mock CompliancePluginRun rows with the targeted
pass rate spread across the 424 approved Windows rules.
"""
import os
import random
from datetime import datetime, timedelta
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

TENANT_NAME_LIKE = "%layeron%"

MOCK_ASSETS = [
    {
        "name": "DC-01",
        "description": "Primary Domain Controller — Windows Server 2022",
        "asset_type": "infrastructure",
        "host_name": "DC-01.layeron.local",
        "ip_address": "10.0.0.5",
        "criticality": "critical",
        "owner_name": "Mehboob",
        "target_pass_rate": 0.92,
    },
    {
        "name": "FILE-01",
        "description": "File Server — Windows Server 2016 (legacy)",
        "asset_type": "infrastructure",
        "host_name": "FILE-01.layeron.local",
        "ip_address": "10.0.0.10",
        "criticality": "high",
        "owner_name": "Aisha",
        "target_pass_rate": 0.45,
    },
    {
        "name": "WEB-LINUX-01",
        "description": "Web Server — Ubuntu 22.04 Linux",
        "asset_type": "infrastructure",
        "host_name": "web01.layeron.local",
        "ip_address": "10.0.0.20",
        "criticality": "high",
        "owner_name": "Mehboob",
        "target_pass_rate": None,  # never scanned (no Linux rules in lib)
    },
    {
        "name": "PROD-AWS",
        "description": "Production AWS Account — us-east-1",
        "asset_type": "cloud",
        "host_name": None,
        "ip_address": None,
        "criticality": "high",
        "owner_name": "Hassan",
        "target_pass_rate": None,  # never scanned (no AWS rules in lib)
    },
]


with eng.begin() as c:
    tenant = c.execute(
        text("SELECT id FROM grc_tenants WHERE name ILIKE :n LIMIT 1"),
        {"n": TENANT_NAME_LIKE},
    ).first()
    if not tenant:
        print("Layeron tenant not found"); raise SystemExit(1)
    tid = tenant[0]

    # Find a user_id to attribute mock runs to (use the scanner who already ran scans)
    user_row = c.execute(text(
        "SELECT id FROM grc_users WHERE email='shahnawazkhan79@gmail.com' "
        "OR email='hassan@layeron.com' LIMIT 1"
    )).first()
    if not user_row:
        user_row = c.execute(text("SELECT id FROM grc_users ORDER BY id LIMIT 1")).first()
    user_id = user_row[0]
    print(f"Tenant={tid}, attributing mock runs to user_id={user_id}")

    # Pull approved windows plugins for the run-fabrication step
    win_plugins = c.execute(text(
        "SELECT id FROM grc_compliance_plugins "
        "WHERE runner_type='windows_winrm' "
        "AND review_status IN ('approved', 'auto_approved') "
        "AND enabled=true "
        "AND (tenant_id IS NULL OR tenant_id=:t)"
    ), {"t": tid}).fetchall()
    win_plugin_ids = [r[0] for r in win_plugins]
    print(f"Approved Windows plugins available: {len(win_plugin_ids)}")

    for a in MOCK_ASSETS:
        existing = c.execute(text(
            "SELECT id FROM grc_it_assets WHERE tenant_id=:t AND name=:n"
        ), {"t": tid, "n": a["name"]}).first()
        if existing:
            asset_id = existing[0]
            print(f"  ↻ {a['name']} already exists at id={asset_id}, skipping insert")
        else:
            r = c.execute(text(
                "INSERT INTO grc_it_assets "
                "(tenant_id, name, description, asset_type, host_name, ip_address, "
                " criticality, owner_name, status, cde_environment, created_at) "
                "VALUES (:t, :n, :d, :at, :h, :ip, :c, :o, 'active', false, NOW()) "
                "RETURNING id"
            ), {
                "t": tid, "n": a["name"], "d": a["description"],
                "at": a["asset_type"], "h": a["host_name"], "ip": a["ip_address"],
                "c": a["criticality"], "o": a["owner_name"],
            })
            asset_id = r.scalar()
            print(f"  + {a['name']} inserted at id={asset_id}")

        # Mock runs for assets with target_pass_rate
        if a["target_pass_rate"] is not None and win_plugin_ids:
            # Wipe any prior mock runs for this asset so re-runs are clean
            c.execute(text(
                "DELETE FROM grc_compliance_plugin_runs "
                "WHERE asset_id=:aid AND triggered_by='mock_seed'"
            ), {"aid": asset_id})
            n_pass = int(len(win_plugin_ids) * a["target_pass_rate"])
            shuffled = list(win_plugin_ids)
            random.seed(asset_id)
            random.shuffle(shuffled)
            pass_set = set(shuffled[:n_pass])
            base_time = datetime.utcnow() - timedelta(minutes=10)
            for i, pid in enumerate(win_plugin_ids):
                status = "passed" if pid in pass_set else "failed"
                summary = (
                    "Mock: matches CIS expected value" if status == "passed"
                    else "Mock: value mismatch — review remediation"
                )
                c.execute(text(
                    "INSERT INTO grc_compliance_plugin_runs "
                    "(tenant_id, plugin_id, asset_id, connection_id, status, "
                    " triggered_by, triggered_by_user_id, started_at, completed_at, "
                    " result_summary, duration_ms, remediation_shown) "
                    "VALUES (:t, :p, :a, NULL, :s, 'mock_seed', :u, :st, :ct, :sm, 250, NULL)"
                ), {
                    "t": tid, "p": pid, "a": asset_id, "s": status, "u": user_id,
                    "st": base_time + timedelta(seconds=i),
                    "ct": base_time + timedelta(seconds=i, milliseconds=250),
                    "sm": summary,
                })
            print(f"     seeded {len(win_plugin_ids)} runs ({n_pass} passed, "
                  f"{len(win_plugin_ids)-n_pass} failed)")

print("\nDone. Refresh /compliance/plugins → Assets tab.")
