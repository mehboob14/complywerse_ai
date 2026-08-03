"""Mock fixture — used ONLY to verify the OS classifier groups assets
correctly when devices of different types appear in the tenant.

Inserts 4 lightweight asset rows (NO mock scan runs) so the Assets tab
shows them grouped by OS family. They all carry has_connection=False
which is what the new strict matching produces.

After verification, run cleanup_mock.py to drop them again.
"""
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

CLASSIFICATION_FIXTURES = [
    # Windows Server (by name + description)
    ("WIN-DC-LAB", "Windows Server 2022 Domain Controller (lab)", "infrastructure",
     "win-dc-lab.example.local", "10.0.5.1", "high"),
    # Linux Server (by description)
    ("LNX-WEB-LAB", "Ubuntu 22.04 LTS web server (lab)", "infrastructure",
     "lnx-web-lab.example.local", "10.0.5.2", "medium"),
    # AWS Account (by name + type)
    ("AWS-PROD-LAB", "Production AWS Account us-east-1 (lab)", "cloud",
     None, None, "high"),
    # Network Device (by description)
    ("CISCO-SW-LAB", "Cisco Catalyst 9300 switch core (lab)", "infrastructure",
     "cisco-sw-lab.example.local", "10.0.5.10", "medium"),
]

with eng.begin() as c:
    tenant = c.execute(
        text("SELECT id FROM grc_tenants WHERE name ILIKE '%layeron%' LIMIT 1")
    ).scalar()
    if not tenant:
        print("No Layeron tenant; aborting."); raise SystemExit(1)

    for name, desc, atype, host, ip, crit in CLASSIFICATION_FIXTURES:
        existing = c.execute(text(
            "SELECT id FROM grc_it_assets WHERE tenant_id=:t AND name=:n"
        ), {"t": tenant, "n": name}).first()
        if existing:
            print(f"  - {name} already exists at id={existing[0]}, skip")
            continue
        new_id = c.execute(text(
            "INSERT INTO grc_it_assets "
            "(tenant_id, name, description, asset_type, host_name, ip_address, "
            " criticality, status, cde_environment, created_at) "
            "VALUES (:t, :n, :d, :at, :h, :ip, :c, 'active', false, NOW()) "
            "RETURNING id"
        ), {
            "t": tenant, "n": name, "d": desc, "at": atype,
            "h": host, "ip": ip, "c": crit,
        }).scalar()
        print(f"  + inserted {name} id={new_id} (type={atype}, host={host})")

print("\nDone. Refresh /compliance/plugins -> Assets tab to verify groups.")
print("To remove again: python cleanup_mock_classification.py")
