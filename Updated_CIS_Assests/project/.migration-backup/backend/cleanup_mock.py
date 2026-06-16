"""Remove mock assets + their seeded runs from Layeron tenant so the
Assets tab shows only real, connectable assets."""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

MOCK_NAMES = ("DC-01", "FILE-01", "WEB-LINUX-01", "PROD-AWS")

with eng.begin() as c:
    tenant = c.execute(
        text("SELECT id FROM grc_tenants WHERE name ILIKE '%layeron%' LIMIT 1")
    ).scalar()
    if not tenant:
        print("No Layeron tenant; nothing to clean.")
        raise SystemExit(0)

    asset_ids = [r[0] for r in c.execute(text(
        "SELECT id FROM grc_it_assets "
        "WHERE tenant_id=:t AND name = ANY(:n)"
    ), {"t": tenant, "n": list(MOCK_NAMES)}).fetchall()]
    if not asset_ids:
        print("No mock assets found.")
    else:
        print(f"Deleting runs for asset_ids={asset_ids}")
        runs_del = c.execute(text(
            "DELETE FROM grc_compliance_plugin_runs "
            "WHERE asset_id = ANY(:a)"
        ), {"a": asset_ids})
        print(f"  Deleted {runs_del.rowcount} runs")

        # Also wipe any AssetRiskAssessment / control links / vuln links / etc
        # before deleting the asset row itself.
        for tbl in [
            "grc_asset_control_links",
            "grc_asset_internal_control_links",
            "grc_asset_framework_control_links",
            "grc_asset_evidence_links",
            "grc_asset_risk_assessments",
            "grc_asset_security_compliance_selections",
            "grc_risk_asset_links",
            "grc_vulnerability_asset_links",
        ]:
            try:
                r = c.execute(text(
                    f"DELETE FROM {tbl} WHERE asset_id = ANY(:a)"
                ), {"a": asset_ids})
                if r.rowcount:
                    print(f"  Deleted {r.rowcount} rows from {tbl}")
            except Exception as e:
                print(f"  (skipped {tbl}: {type(e).__name__})")

        del_assets = c.execute(text(
            "DELETE FROM grc_it_assets WHERE id = ANY(:a)"
        ), {"a": asset_ids})
        print(f"  Deleted {del_assets.rowcount} mock asset rows")

print("Cleanup done.")
