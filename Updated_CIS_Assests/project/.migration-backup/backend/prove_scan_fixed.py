"""Run rule 1.1.1 against Hassan's Dev Box using the ACTUAL credential
service (so we exercise the new ssl-validation default), not a hand-crafted
credentials dict."""
from __future__ import annotations
import os, json
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

from grc.modules.compliance_plugins.services.credentials import resolve_credentials_for_connection as build_credentials
from grc.modules.compliance_plugins.runners.winrm_runner import windows_winrm_runner
from grc.models import IntegrationConnection
from sqlalchemy.orm import sessionmaker

Session = sessionmaker(bind=eng)
sess = Session()
try:
    conn_row = sess.get(IntegrationConnection, 7)  # Hassan's Dev Box
    print(f"Connection: {conn_row.connection_name}  ({conn_row.console_url}:{conn_row.console_port})")
    creds = build_credentials(conn_row)
    print("Credentials returned by resolve_credentials_for_connection:")
    for k, v in creds.items():
        if k == "winrm_password":
            print(f"  {k} = {('<' + str(len(v)) + ' chars>') if v else '<EMPTY>'}")
        else:
            print(f"  {k} = {v!r}")
    print()

    # Fetch rule 1.1.1
    row = sess.execute(text(
        """SELECT rule_id, title, check_definition FROM grc_compliance_plugins
           WHERE tenant_id IS NULL AND rule_id='1.1.1'
           AND benchmark LIKE '%Windows_11%' LIMIT 1"""
    )).mappings().first()
    cd = row["check_definition"]
    if isinstance(cd, str):
        cd = json.loads(cd)
    print(f"Rule {row['rule_id']}: {row['title']}")
    print(f"Cmd: {cd.get('command', '')[:120]}...")
    print(f"Expect: {cd.get('expect')}")
    print()
    print("Executing against DESKTOP-CE3EFJB ...")
    result = windows_winrm_runner(cd, creds)
    print(f"  status:  {result.status}")
    print(f"  summary: {result.summary}")
    if result.error_message:
        print(f"  error:   {result.error_message}")
    if result.stdout:
        print(f"  stdout (first 400 chars):")
        for line in result.stdout.splitlines()[:8]:
            print(f"    | {line}")
finally:
    sess.close()
