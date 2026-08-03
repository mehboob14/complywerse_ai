"""Live end-to-end verification of the newly-synthesized rules.

Picks one representative rule per category, runs the actual generated
check_definition through the WinRM runner against DESKTOP-CE3EFJB, and
prints PASS/FAIL with raw output.

This proves the rules don't just "look executable in the DB" — they
actually execute on a real Windows box and the expect-evaluator parses
the output correctly.
"""
from __future__ import annotations
import os, json
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

from grc.modules.compliance_plugins.runners.winrm_runner import windows_winrm_runner

CREDS = {
    "winrm_endpoint": "https://DESKTOP-CE3EFJB:5986/wsman",
    "winrm_username": "compliverse_scanner",
    "winrm_password": "ScannerSvc!2026",
    "winrm_transport": "ntlm",
    "winrm_server_cert_validation": "ignore",
}

REPRESENTATIVE_RULES = [
    "1.1.5",        # secedit_field_equals
    "2.2.6",        # user_rights_check (new kind)
    "2.3.1.1",      # secedit_field_equals (Guest)
    "17.1.1",       # stdout_regex auditpol
    "5.2",          # stdout_regex service
    "18.4.7",       # stdout_regex registry (WDigest)
    "18.9.19.2",    # stdout_regex registry with GUID path
    "18.10.17.1",   # stdout_not_regex (Download Mode != Internet)
    "2.3.10.6",     # REG_MULTI_SZ blank check
    "9.1.4",        # REG_SZ non-empty
    "19.5.1.1",     # all_lines_match HKCU iteration (new kind)
]

with eng.connect() as conn:
    print(f"{'RULE':<14} {'CATEGORY':<22} {'STATUS':<8} {'DETAIL'}")
    print("-" * 110)
    for rid in REPRESENTATIVE_RULES:
        row = conn.execute(text(
            """SELECT rule_id, title, check_definition
               FROM grc_compliance_plugins
               WHERE tenant_id IS NULL AND rule_id=:r
               AND benchmark LIKE '%Windows_11%' LIMIT 1"""
        ), {"r": rid}).mappings().first()
        if not row:
            print(f"{rid:<14} NOT_FOUND")
            continue
        cd = row["check_definition"]
        if isinstance(cd, str):
            cd = json.loads(cd)
        expect_kind = (cd.get("expect") or {}).get("kind", "?")
        extracted_cat = (cd.get("_extracted") or {}).get("category", "?")
        try:
            result = windows_winrm_runner(cd, CREDS)
            status = result.status.upper() if hasattr(result, "status") else str(result)
            summary = result.summary if hasattr(result, "summary") else ""
            err = result.error_message if hasattr(result, "error_message") else ""
            detail = summary or err
        except Exception as e:
            status = "ERROR"
            detail = f"exception: {e}"
        title_short = (row["title"] or "")[:50]
        print(f"{rid:<14} {extracted_cat:<22} {status:<8} {detail[:70]}")
        print(f"               expect.kind={expect_kind}  title={title_short}")
