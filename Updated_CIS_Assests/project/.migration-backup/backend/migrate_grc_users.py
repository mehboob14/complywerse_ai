"""
Standalone migration script to add missing columns to grc_users table.
Adds: department, group, division, designation columns
"""
import sqlite3
import os

def add_missing_columns():
    """Add missing columns to grc_users table if they don't exist."""
    
    # Find the database file
    db_paths = [
        'grc_app.db',
        'backend/grc_app.db',
        'C:\\Users\\Admin\\Documents\\GRC-Tenant\\backend\\grc_app.db',
        'C:\\Users\\Admin\\Documents\\GRC-Tenant\\grc_app.db',
        os.path.expanduser('~/Documents/GRC-Tenant/backend/grc_app.db'),
    ]
    
    db_path = None
    for path in db_paths:
        if os.path.exists(path):
            db_path = path
            break
    
    if not db_path:
        print("✗ Could not find grc.db file")
        print("Searched paths:")
        for path in db_paths:
            print(f"  - {path}")
        return False
    
    print(f"Found database at: {db_path}")
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get existing columns
        cursor.execute("PRAGMA table_info(grc_users)")
        existing_columns = {row[1] for row in cursor.fetchall()}
        print(f"\nExisting columns in grc_users: {sorted(existing_columns)}")
        
        columns_to_add = [
            ('department', "VARCHAR(255)"),
            ('group', '"group" VARCHAR(255)'),  # group is a reserved keyword
            ('division', "VARCHAR(255)"),
            ('designation', "VARCHAR(255)"),
        ]
        
        print("\nAdding missing columns:")
        for col_name, col_def in columns_to_add:
            if col_name not in existing_columns:
                try:
                    # For 'group', col_def already includes the quoted name
                    if col_name == 'group':
                        sql = f"ALTER TABLE grc_users ADD COLUMN {col_def}"
                    else:
                        sql = f"ALTER TABLE grc_users ADD COLUMN {col_name} {col_def}"
                    cursor.execute(sql)
                    print(f"  ✓ Added '{col_name}' column")
                except sqlite3.OperationalError as e:
                    print(f"  ✗ Failed to add '{col_name}': {str(e)}")
            else:
                print(f"  ✓ '{col_name}' column already exists")
        
        conn.commit()
        conn.close()
        
        print("\n✓ Migration completed successfully!")
        return True
        
    except Exception as e:
        print(f"\n✗ Error during migration: {str(e)}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("GRC Users Missing Columns Migration")
    print("=" * 60)
    add_missing_columns()
    print("=" * 60)
