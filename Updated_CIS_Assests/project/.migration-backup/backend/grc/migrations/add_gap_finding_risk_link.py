"""
Migration: Add risk_register_id to PolicyGapFinding to link accepted risks to risk register

This migration adds a foreign key column to track when a gap finding is accepted as a risk
and creates a corresponding entry in the risk register.
"""

from sqlalchemy import create_engine, text
import os

def run_migration():
    """Add risk_register_id column to grc_policy_gap_findings table"""
    
    # Get database URL from environment or use default
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        # Look for grc_app.db in the backend directory
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        db_path = os.path.join(backend_dir, "grc_app.db")
        database_url = f"sqlite:///{db_path}"
    
    print(f"Using database: {database_url}")
    
    engine = create_engine(database_url)
    
    with engine.connect() as conn:
        # Check if column already exists
        try:
            result = conn.execute(text("""
                SELECT COUNT(*) 
                FROM pragma_table_info('grc_policy_gap_findings') 
                WHERE name='risk_register_id'
            """))
            exists = result.scalar() > 0
            
            if exists:
                print("✓ Column 'risk_register_id' already exists in grc_policy_gap_findings table")
                return
        except Exception as e:
            print(f"Warning: Could not check if column exists: {e}")
        
        # Add the column
        try:
            conn.execute(text("""
                ALTER TABLE grc_policy_gap_findings 
                ADD COLUMN risk_register_id INTEGER 
                REFERENCES grc_risks(id)
            """))
            conn.commit()
            print("✓ Added 'risk_register_id' column to grc_policy_gap_findings table")
            
            # Create index for the new foreign key
            try:
                conn.execute(text("""
                    CREATE INDEX IF NOT EXISTS ix_gap_finding_risk_register 
                    ON grc_policy_gap_findings(risk_register_id)
                """))
                conn.commit()
                print("✓ Created index on risk_register_id column")
            except Exception as e:
                print(f"Warning: Could not create index: {e}")
                
        except Exception as e:
            print(f"Error adding column: {e}")
            conn.rollback()
            raise

if __name__ == "__main__":
    print("Running migration: Add risk_register_id to PolicyGapFinding")
    run_migration()
    print("Migration completed successfully!")
