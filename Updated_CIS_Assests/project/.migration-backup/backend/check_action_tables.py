import sqlite3

conn = sqlite3.connect('grc_app.db')
cur = conn.cursor()

# Search for action/review related tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%action%' OR name LIKE '%review%') ORDER BY name")
tables = [row[0] for row in cur.fetchall()]

print("Tables with 'action' or 'review' in name:")
for table in tables:
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    count = cur.fetchone()[0]
    print(f"  - {table} ({count} rows)")

conn.close()
