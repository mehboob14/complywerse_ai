"""
Migration script to add parsed_control_id column to grc_ai_evidence_recommendations table
"""
import os
import sys
from sqlalchemy import create_engine, text, inspect

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from grc.models import DATABASE_URL

def migrate():
    """Add parsed_control_id column to grc_ai_evidence_recommendations table"""
    engine = create_engine(DATABASE_URL)
    
    # Check if column already exists
    inspector = inspect(engine)
    columns = [col['name'] for col in inspector.get_columns('grc_ai_evidence_recommendations')]
    
    if 'parsed_control_id' in columns:
        print("✓ Column 'parsed_control_id' already exists in grc_ai_evidence_recommendations")
        return
    
    print("Adding 'parsed_control_id' column to grc_ai_evidence_recommendations...")
    
    with engine.connect() as conn:
        # Add the column (nullable, so no default needed)
        conn.execute(text("""
            ALTER TABLE grc_ai_evidence_recommendations 
            ADD COLUMN parsed_control_id INTEGER
        """))
        conn.commit()
    
    print("✓ Successfully added 'parsed_control_id' column")
    print("✓ Migration complete!")

if __name__ == "__main__":
    migrate()
