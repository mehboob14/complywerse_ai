import sqlite3
from pathlib import Path

# Connect to the actual database
db_path = Path(__file__).parent / "grc_app.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("CHECKING ACTUAL DATABASE CONTENT")
print("=" * 80)

# Check frameworks
print("\n1. FRAMEWORKS:")
print("-" * 80)
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%framework%'")
framework_tables = cursor.fetchall()
print(f"Framework-related tables: {[t[0] for t in framework_tables]}")

for table in framework_tables:
    table_name = table[0]
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"  - {table_name}: {count} rows")
        
        if count > 0 and count <= 5:
            cursor.execute(f"SELECT * FROM {table_name} LIMIT 3")
            rows = cursor.fetchall()
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [col[1] for col in cursor.fetchall()]
            print(f"    Columns: {columns[:5]}...")
            print(f"    Sample data: {rows[0][:5] if rows else 'None'}...")
    except Exception as e:
        print(f"  - {table_name}: Error - {e}")

# Check governance documents
print("\n2. GOVERNANCE DOCUMENTS:")
print("-" * 80)
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%governance%document%'")
gov_doc_tables = cursor.fetchall()
print(f"Governance document tables: {[t[0] for t in gov_doc_tables]}")

for table in gov_doc_tables:
    table_name = table[0]
    try:
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"  - {table_name}: {count} rows")
        
        if count > 0 and count <= 10:
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = [col[1] for col in cursor.fetchall()]
            print(f"    Columns: {', '.join(columns[:8])}")
            
            cursor.execute(f"SELECT * FROM {table_name} LIMIT 3")
            rows = cursor.fetchall()
            for i, row in enumerate(rows, 1):
                print(f"    Row {i}: {row[:5]}...")
    except Exception as e:
        print(f"  - {table_name}: Error - {e}")

# Check risks for context
print("\n3. RISKS (for context):")
print("-" * 80)
cursor.execute("SELECT COUNT(*) FROM grc_risks")
risk_count = cursor.fetchone()[0]
print(f"Total risks: {risk_count}")

cursor.execute("SELECT status, COUNT(*) FROM grc_risks GROUP BY status")
status_counts = cursor.fetchall()
print(f"Risks by status: {status_counts}")

# Check compliance frameworks specifically
print("\n4. COMPLIANCE FRAMEWORKS SPECIFICALLY:")
print("-" * 80)
try:
    cursor.execute("SELECT COUNT(*) FROM grc_compliance_frameworks")
    count = cursor.fetchone()[0]
    print(f"grc_compliance_frameworks: {count} rows")
    
    if count > 0:
        cursor.execute("PRAGMA table_info(grc_compliance_frameworks)")
        columns = [col[1] for col in cursor.fetchall()]
        print(f"Columns: {', '.join(columns)}")
        
        cursor.execute("SELECT * FROM grc_compliance_frameworks LIMIT 5")
        rows = cursor.fetchall()
        for i, row in enumerate(rows, 1):
            print(f"  Framework {i}: {row}")
except Exception as e:
    print(f"Error: {e}")

conn.close()
print("\n" + "=" * 80)
