"""
Migration script to add register_type column to grc_risks table.
Run this script once to update the database schema.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import sys
import os

# Add parent directory to path to import models
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models import get_db

def add_register_type_column():
    """Add register_type column to grc_risks table if it doesn't exist."""
    db = next(get_db())
    
    try:
        # Check if column already exists
        result = db.execute(text("""
            SELECT COUNT(*) as count
            FROM pragma_table_info('grc_risks')
            WHERE name = 'register_type'
        """))
        
        exists = result.fetchone()[0] > 0
        
        if exists:
            print("✓ Column 'register_type' already exists in grc_risks table")
            return
        
        # Add the column
        db.execute(text("""
            ALTER TABLE grc_risks 
            ADD COLUMN register_type VARCHAR(100)
        """))
        
        db.commit()
        print("✓ Successfully added 'register_type' column to grc_risks table")
        
    except Exception as e:
        db.rollback()
        print(f"✗ Error adding column: {str(e)}")
        raise
    finally:
        db.close()

if __name__ == "__main__":
    print("Running migration: Add register_type column to grc_risks table")
    add_register_type_column()
    print("Migration completed successfully!")
