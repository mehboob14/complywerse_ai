"""
Migration script to add missing columns to grc_users table.
Adds: department, group, division, designation columns
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import sys
import os

# Add parent directory to path to import models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import get_db

def add_missing_columns():
    """Add missing columns to grc_users table if they don't exist."""
    db = next(get_db())
    
    try:
        # Check which columns already exist
        result = db.execute(text("""
            SELECT name FROM pragma_table_info('grc_users')
        """))
        
        existing_columns = {row[0] for row in result.fetchall()}
        print(f"Existing columns: {existing_columns}")
        
        columns_to_add = [
            ('department', "VARCHAR(255)"),
            ('group', "VARCHAR(255)"),
            ('division', "VARCHAR(255)"),
            ('designation', "VARCHAR(255)"),
        ]
        
        for col_name, col_type in columns_to_add:
            if col_name not in existing_columns:
                print(f"Adding column: {col_name}")
                db.execute(text(f"""
                    ALTER TABLE grc_users 
                    ADD COLUMN {col_name} {col_type}
                """))
                print(f"✓ Successfully added '{col_name}' column to grc_users table")
            else:
                print(f"✓ Column '{col_name}' already exists in grc_users table")
        
        db.commit()
        print("\nAll columns verified/added successfully!")
        
    except Exception as e:
        db.rollback()
        print(f"✗ Error adding columns: {str(e)}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    print("Running migration: Add missing columns to grc_users table")
    print("=" * 60)
    add_missing_columns()
    print("=" * 60)
    print("Migration completed successfully!")
