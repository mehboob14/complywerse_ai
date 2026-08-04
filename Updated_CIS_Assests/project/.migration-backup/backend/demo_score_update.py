"""Demo script: improve MSSQL (asset 135) score to show mutual risk posture update."""
import sqlite3
from datetime import datetime

db_path = "grc_app.db"
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Get current latest runs for asset 135 (MSSQL, tenant 6)
cur.execute("""
    SELECT r.plugin_id, r.status, r.id
    FROM grc_compliance_plugin_runs r
    JOIN (
        SELECT plugin_id, MAX(id) AS max_id
        FROM grc_compliance_plugin_runs
        WHERE asset_id = 135 AND tenant_id = 6
          AND status IN ('passed', 'failed')
        GROUP BY plugin_id
    ) latest ON latest.max_id = r.id
    ORDER BY r.id
""")
rows = cur.fetchall()

if not rows:
    print("No runs found for asset 135")
    conn.close()
    exit()

passed = [r for r in rows if r[1] == 'passed']
failed = [r for r in rows if r[1] == 'failed']
print(f"BEFORE: {len(rows)} rules, {len(passed)} passed, {len(failed)} failed = {round(100*len(passed)/len(rows),1)}%")

# Insert new "passed" runs for all currently-failed plugin IDs
now = datetime.utcnow().isoformat()
for row in failed:
    plugin_id = row[0]
    cur.execute("""
        INSERT INTO grc_compliance_plugin_runs
          (tenant_id, plugin_id, asset_id, status, triggered_by, started_at, completed_at)
        VALUES (6, ?, 135, 'passed', 'manual_demo', ?, ?)
    """, (plugin_id, now, now))

conn.commit()
print(f"Inserted {len(failed)} new 'passed' runs")

# Verify new score
cur.execute("""
    SELECT r.status FROM grc_compliance_plugin_runs r
    JOIN (
        SELECT plugin_id, MAX(id) AS max_id
        FROM grc_compliance_plugin_runs
        WHERE asset_id = 135 AND tenant_id = 6
          AND status IN ('passed', 'failed')
        GROUP BY plugin_id
    ) latest ON latest.max_id = r.id
""")
rows2 = cur.fetchall()
p2 = sum(1 for r in rows2 if r[0] == 'passed')
print(f"AFTER: {len(rows2)} rules, {p2} passed = {round(100*p2/len(rows2),1)}%")
conn.close()
print("Done.")
