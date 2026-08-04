#!/usr/bin/env python3
"""
Script to add missing database columns to grc_certification_journeys table
"""
import os
import sys

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text, inspect, event
from sqlalchemy.pool import StaticPool

def add_missing_column():
    """Add phases_completion column if it doesn't exist"""
    
    # Get the database URL - use the same as in models.py
    DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/grc_db")
    
    print(f"Database URL: {DATABASE_URL}")
    
    # Create engine with appropriate settings for SQLite or PostgreSQL
    if DATABASE_URL.startswith("sqlite"):
        # SQLite engine setup
        engine = create_engine(
            DATABASE_URL,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
    else:
        # PostgreSQL engine setup
        engine = create_engine(DATABASE_URL)
    
    inspector = inspect(engine)
    
    try:
        # Get existing columns in grc_certification_journeys table
        columns = {col['name'] for col in inspector.get_columns('grc_certification_journeys')}
        
        print(f"Existing columns in grc_certification_journeys: {columns}")
        
        if 'phases_completion' not in columns:
            print("Adding missing phases_completion column...")
            
            with engine.begin() as conn:
                # Check if this is SQLite or PostgreSQL
                if DATABASE_URL.startswith('sqlite'):
                    # SQLite doesn't support JSON type, so use TEXT
                    sql = text("ALTER TABLE grc_certification_journeys ADD COLUMN phases_completion TEXT")
                else:
                    # PostgreSQL - use JSON type
                    sql = text("ALTER TABLE grc_certification_journeys ADD COLUMN phases_completion JSON")
                
                conn.execute(sql)
                print("✓ Successfully added phases_completion column")
        else:
            print("✓ phases_completion column already exists")
    
    except Exception as e:
        print(f"Error: {e}")
        print(f"Stack trace: {type(e).__name__}")
        
        # If table doesn't exist, that's okay - it will be created on startup
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            print("⚠ Table doesn't exist yet - it will be created on application startup")
        else:
            raise

if __name__ == "__main__":
    add_missing_column()
