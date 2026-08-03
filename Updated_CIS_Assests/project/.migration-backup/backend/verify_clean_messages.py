"""Run 5 representative rules against Hassan's Dev Box and print the
resulting summary string — exactly what the UI's `Summary` column shows.

Before:
  - 'Allow log on locally' is NOT set to Administrators, Users (CIS requirement).
    (SeInteractiveLogonRight=['GUEST', 'S-1-5-32-544', 'S-1-5-32-545', 'S-1-5-32-551']
     (expected ['S-1-5-32-544', 'S-1-5-32-545']))
  - 'Turn on behavior monitoring' is NOT Disabled (CIS requires this policy to be applied).
  - 'Encryption Oracle Remediation' is NOT Disabled (CIS requires this policy to be applied).

After (target):
  - 'Allow log on locally' is NOT set to 'Administrators, Users' (CIS recommendation).
    (SeInteractiveLogonRight: currently Administrators, Backup Operators, Guest, Users
     — CIS expects Administrators, Users)
  - 'Turn on behavior monitoring' is set to 'Enabled' as CIS recommends.  ← polarity fixed
  - 'Encryption Oracle Remediation' is set to 'Enabled: Force Updated Clients' as CIS recommends.
"""
from __future__ import annotations
import os, json
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])
Session = sessionmaker(bind=eng)

from grc.modules.compliance_plugins.services.credentials import resolve_credentials_for_connection
from grc.modules.compliance_plugins.runners.winrm_runner import windows_winrm_runner
from grc.models import IntegrationConnection

RULES = [
    ("2.2.5",       "Allow log on locally (SID translation test)"),
    ("18.10.42.10.4", "Turn on behavior monitoring (inverse-polarity test)"),
    ("18.9.4.1",    "Encryption Oracle Remediation (registry test)"),
    ("1.1.1",       "Enforce password history (secedit field test)"),
    ("2.2.34",      "Profile system performance (multi-SID match)"),
]

sess = Session()
try:
    # Find Hassan's Windows connection (newest active windows_winrm)
    conn = (sess.query(IntegrationConnection)
            .filter(IntegrationConnection.integration_type == "windows_winrm",
                    IntegrationConnection.is_active.is_(True))
            .order_by(IntegrationConnection.id.desc()).first())
    if not conn:
        raise SystemExit("No active Windows connection found")
    creds = resolve_credentials_for_connection(conn)
    print(f"Testing against: {conn.connection_name}  ({conn.console_url})\n")

    for rid, label in RULES:
        row = sess.execute(text(
            """SELECT title, check_definition FROM grc_compliance_plugins
               WHERE tenant_id IS NULL AND rule_id=:r
               AND benchmark LIKE '%Windows_11%' LIMIT 1"""
        ), {"r": rid}).mappings().first()
        if not row:
            print(f"=== {rid}  [{label}] === NOT FOUND\n")
            continue
        cd = row["check_definition"]
        if isinstance(cd, str):
            cd = json.loads(cd)
        print(f"=== {rid}  [{label}] ===")
        print(f"Plugin title: {row['title']}")
        print(f"Pass template: {cd.get('pass_message')}")
        print(f"Fail template: {cd.get('fail_message')}")
        result = windows_winrm_runner(cd, creds)
        print(f"RESULT: status={result.status}")
        print(f"SUMMARY (what UI shows): {result.summary}")
        print()
finally:
    sess.close()
