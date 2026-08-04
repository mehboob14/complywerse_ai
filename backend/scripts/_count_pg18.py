import json, os, sys
from pathlib import Path
from dotenv import load_dotenv
BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")
import psycopg2
dsn = os.environ["TENANT_DB_URL_TEMPLATE"].replace("{slug}", "complyverse").replace("postgresql+psycopg2://", "postgresql://")
conn = psycopg2.connect(dsn)
cur = conn.cursor()
cur.execute("""
SELECT
  count(*) FILTER (WHERE check_definition::text ILIKE '%%"kind": "any"%%'
                    OR check_definition::text ILIKE '%%"kind":"any"%%') AS hollow_any,
  count(*) FILTER (WHERE check_definition::text ILIKE '%%cis-pg18%%') AS authored,
  count(*) FILTER (WHERE runner_type = 'manual') AS manual,
  count(*) FILTER (WHERE runner_type = 'postgres_sql') AS postgres_sql,
  count(*) FILTER (WHERE runner_type = 'linux_ssh') AS linux_ssh,
  count(*) FILTER (WHERE runner_type = 'windows_winrm') AS winrm,
  count(*) FILTER (WHERE enabled) AS enabled,
  count(*) AS total
FROM grc_compliance_plugins
WHERE benchmark = 'CIS_PostgreSQL_18_Benchmark_v1.0.0'
""")
cols = [d[0] for d in cur.description]
print(dict(zip(cols, cur.fetchone())))
cur.close(); conn.close()
