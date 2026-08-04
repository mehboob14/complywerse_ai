import os
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
import psycopg2
conn = psycopg2.connect(os.environ["POSTGRES_ADMIN_URL"])
cur = conn.cursor()
cur.execute("SELECT datname FROM pg_database WHERE datname LIKE 'grc_%' ORDER BY datname;")
for (n,) in cur.fetchall():
    print(n)
print("---tenants in master---")
mconn = psycopg2.connect(os.environ["MASTER_DATABASE_URL"])
mcur = mconn.cursor()
mcur.execute("SELECT id, name, slug FROM grc_tenants ORDER BY id;")
for r in mcur.fetchall():
    print(r)
