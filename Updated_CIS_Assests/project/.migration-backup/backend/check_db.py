import sqlite3

conn = sqlite3.connect('grc_app.db')
cur = conn.cursor()

# Get all GRC tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'grc_%' ORDER BY name")
tables = [row[0] for row in cur.fetchall()]

print(f"Total GRC tables: {len(tables)}")
print("\nFirst 30 tables:")
for i, table in enumerate(tables[:30], 1):
    # Get row count
    cur.execute(f"SELECT COUNT(*) FROM {table}")
    count = cur.fetchone()[0]
    print(f"{i}. {table} ({count} rows)")

# Check specific new tables
print("\n\nChecking specific tables:")
new_tables = [
    'grc_policy_gap_findings',
    'grc_policy_gap_analysis_runs',
    'grc_governance_action_reviews',
    'grc_risks',
    'grc_governance_documents'
]

for table in new_tables:
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"✓ {table}: {count} rows")
        
        # Show columns
        cur.execute(f"PRAGMA table_info({table})")
        cols = [row[1] for row in cur.fetchall()]
        print(f"  Columns: {', '.join(cols[:10])}{'...' if len(cols) > 10 else ''}")
    except Exception as e:
        print(f"✗ {table}: Error - {e}")

conn.close()
