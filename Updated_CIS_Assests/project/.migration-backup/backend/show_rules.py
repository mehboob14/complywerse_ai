"""Show extracted check definitions for representative rules."""
from __future__ import annotations
import os, json
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()
eng = create_engine(os.environ["DATABASE_URL"])

samples = [
    ("1.1.5",       "Password complexity (secedit)"),
    ("2.2.6",       "User Right: Allow log on locally"),
    ("2.3.1.1",     "Security Option: Guest account status"),
    ("17.1.1",      "Audit Policy: Credential Validation"),
    ("5.2",         "Service: Bluetooth Support"),
    ("18.4.7",      "WDigest Authentication (registry)"),
    ("19.5.1.1",    "HKCU per-user policy: Toast notifications"),
    ("18.9.19.2",   "Group Policy processing (GUID path)"),
    ("18.10.17.1",  "Download Mode NOT Internet (negation)"),
    ("2.3.10.6",    "REG_MULTI_SZ blank check"),
    ("9.1.4",       "REG_SZ non-empty path"),
]

with eng.connect() as conn:
    for rid, label in samples:
        row = conn.execute(text(
            """SELECT rule_id, title, check_definition
               FROM grc_compliance_plugins
               WHERE tenant_id IS NULL AND rule_id=:r
               AND benchmark LIKE '%Windows_11%' LIMIT 1"""
        ), {"r": rid}).mappings().first()
        if not row:
            print(f"\n=== {rid}  [{label}] === NOT FOUND")
            continue
        cd = row["check_definition"]
        if isinstance(cd, str):
            cd = json.loads(cd)
        print(f"\n=== {rid}  [{label}] ===")
        print(f"TITLE:  {row['title']}")
        cmd = cd.get("command", "")
        if isinstance(cmd, str) and len(cmd) > 160:
            cmd = cmd[:160] + "..."
        print(f"CMD:    {cmd}")
        print(f"EXPECT: {json.dumps(cd.get('expect'), default=str)}")
        ext = cd.get("_extracted")
        if ext:
            print(f"EXTRACTED: {json.dumps(ext, default=str)}")
