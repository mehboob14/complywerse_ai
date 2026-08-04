import sqlite3
from pathlib import Path

# Connect to the actual database
db_path = Path(__file__).parent / "grc_app.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("CHECKING grc_uploaded_frameworks TABLE STRUCTURE")
print("=" * 80)

# Get table structure
cursor.execute("PRAGMA table_info(grc_uploaded_frameworks)")
columns = cursor.fetchall()
print("\nColumns:")
for col in columns:
    print(f"  {col[1]}: {col[2]} {'NULL' if col[3] == 0 else 'NOT NULL'} {'PK' if col[5] == 1 else ''}")

# Get sample data
print("\nSample Data (first 5 rows):")
cursor.execute("SELECT * FROM grc_uploaded_frameworks LIMIT 5")
rows = cursor.fetchall()
col_names = [col[1] for col in columns]

for i, row in enumerate(rows, 1):
    print(f"\n  Row {i}:")
    for col_name, value in zip(col_names, row):
        if col_name in ['id', 'tenant_id', 'framework_name', 'status', 'uploaded_at', 'total_controls']:
            print(f"    {col_name}: {value}")

# Get counts
cursor.execute("SELECT COUNT(*) FROM grc_uploaded_frameworks")
total = cursor.fetchone()[0]
print(f"\nTotal frameworks: {total}")

cursor.execute("SELECT upload_status, COUNT(*) FROM grc_uploaded_frameworks GROUP BY upload_status")
status_counts = cursor.fetchall()
print(f"By status: {status_counts}")

# Get parsed controls
cursor.execute("SELECT COUNT(*) FROM grc_parsed_framework_controls")
control_count = cursor.fetchone()[0]
print(f"\nTotal parsed controls: {control_count}")

cursor.execute("""
    SELECT upf.name, COUNT(pfc.id) as control_count
    FROM grc_uploaded_frameworks upf
    LEFT JOIN grc_parsed_framework_controls pfc ON upf.id = pfc.uploaded_framework_id
    GROUP BY upf.id, upf.name
    ORDER BY control_count DESC
    LIMIT 10
""")
framework_controls = cursor.fetchall()
print("\nFrameworks with control counts:")
for fw_name, count in framework_controls:
    print(f"  - {fw_name}: {count} controls")

conn.close()
print("\n" + "=" * 80)
