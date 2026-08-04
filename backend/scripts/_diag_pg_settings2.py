from __future__ import annotations
import os, sys
from pathlib import Path
from dotenv import load_dotenv
BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
import psycopg2
dsn = os.environ["TENANT_DB_URL_TEMPLATE"].replace("{slug}", "complyverse").replace("postgresql+psycopg2://", "postgresql://")
conn = psycopg2.connect(dsn)
cur = conn.cursor()
for n in ["log_directory", "shared_preload_libraries", "ssl", "log_connections"]:
    try:
        cur.execute("SELECT current_setting(%s, true)", (n,))
        print(n, "current_setting=", cur.fetchone())
    except Exception as e:
        conn.rollback()
        print(n, "ERR", e)
cur.execute("SELECT count(*) FROM pg_settings")
print("visible_settings", cur.fetchone()[0])
cur.execute("SELECT name FROM pg_settings WHERE name LIKE 'log_%' ORDER BY 1")
print("log_* visible:", [r[0] for r in cur.fetchall()])
cur.close(); conn.close()
