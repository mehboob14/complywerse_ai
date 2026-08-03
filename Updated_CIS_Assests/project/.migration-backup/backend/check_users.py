import sqlite3
from pathlib import Path

# Connect to the actual database
db_path = Path(__file__).parent / "grc_app.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("=" * 80)
print("CHECKING GRC USERS")
print("=" * 80)

# First get the table structure
cursor.execute("PRAGMA table_info(grc_users)")
columns = cursor.fetchall()
print("\nColumns:")
for col in columns:
    print(f"  {col[1]}: {col[2]}")

col_names = [col[1] for col in columns]

# Get first few users
cursor.execute(f"SELECT * FROM grc_users LIMIT 10")
users = cursor.fetchall()

if users:
    print(f"\nFound {len(users)} users:")
    for user in users:
        print(f"\n  User:")
        for col_name, value in zip(col_names, user):
            if col_name in ['id', 'username', 'email', 'tenant_id', 'full_name', 'is_active']:
                print(f"    {col_name}: {value}")
else:
    print("\nNo users found in database!")

conn.close()
