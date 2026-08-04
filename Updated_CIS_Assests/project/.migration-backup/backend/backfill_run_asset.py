"""One-off: existing Layeron runs were stored with asset_id=null because
scan_all used to drop the asset for Windows plugins. Backfill them to the
single Windows asset we have (id=7, Hassan's Dev Box) so the new per-asset
view shows historical data, not just runs from this point forward.

Only touches runs in tenant_id=Layeron AND where asset_id is null AND
the plugin's runner_type is windows_winrm — defensive so we don't
incorrectly link Linux/AWS runs.
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

LAYERON_TENANT_ID = 1  # adjust if different
HASSANS_DEVBOX_ID = 7

with eng.begin() as c:
    tenant_row = c.execute(
        text("SELECT id FROM grc_tenants WHERE name ILIKE '%layeron%' LIMIT 1")
    ).first()
    if not tenant_row:
        print("No Layeron tenant found; aborting.")
        raise SystemExit(1)
    tid = tenant_row[0]

    asset_row = c.execute(
        text("SELECT id, name FROM grc_it_assets WHERE tenant_id=:t ORDER BY id LIMIT 1"),
        {"t": tid},
    ).first()
    if not asset_row:
        print(f"No assets in tenant {tid}; aborting.")
        raise SystemExit(1)
    aid, aname = asset_row
    print(f"Targeting tenant_id={tid}, asset_id={aid} ({aname})")

    res = c.execute(
        text(
            """
            UPDATE grc_compliance_plugin_runs r
               SET asset_id = :aid
              FROM grc_compliance_plugins p
             WHERE r.plugin_id = p.id
               AND r.tenant_id = :tid
               AND r.asset_id IS NULL
               AND p.runner_type = 'windows_winrm'
            """
        ),
        {"aid": aid, "tid": tid},
    )
    print(f"Backfilled {res.rowcount} runs to asset_id={aid}.")
