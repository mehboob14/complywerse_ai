"""Diagnose unexpected empty pg_settings lookups."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
sys.path.insert(0, str(BACKEND))
import psycopg2

dsn = os.environ["TENANT_DB_URL_TEMPLATE"].replace("{slug}", "complyverse")
dsn = dsn.replace("postgresql+psycopg2://", "postgresql://")
conn = psycopg2.connect(dsn)
cur = conn.cursor()
names = [
    "log_directory",
    "log_filename",
    "shared_preload_libraries",
    "ssl_min_protocol_version",
    "ssl_ciphers",
    "ssl",
]
for n in names:
    cur.execute("SELECT name, setting, source FROM pg_settings WHERE name = %s", (n,))
    rows = cur.fetchall()
    print(n, "->", rows)
cur.execute("SELECT version()")
print("version", cur.fetchone()[0])
cur.execute("SELECT current_user, current_database()")
print("who", cur.fetchone())
cur.close()
conn.close()
