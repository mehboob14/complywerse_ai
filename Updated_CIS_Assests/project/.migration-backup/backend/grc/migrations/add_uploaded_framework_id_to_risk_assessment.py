"""
Migration: Add uploaded_framework_id to grc_framework_risk_assessments
and make framework_id nullable so all UploadedFramework statuses can be used.
"""
from sqlalchemy import create_engine, text
import os


def run_migration():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        db_path = os.path.join(backend_dir, "grc_app.db")
        database_url = f"sqlite:///{db_path}"

    print(f"Using database: {database_url}")
    engine = create_engine(database_url)
    is_postgres = "postgresql" in database_url or "postgres" in database_url

    with engine.connect() as conn:
        # 1 - Add uploaded_framework_id column if it doesn't already exist
        try:
            if is_postgres:
                conn.execute(text("""
                    ALTER TABLE grc_framework_risk_assessments
                    ADD COLUMN IF NOT EXISTS uploaded_framework_id INTEGER
                    REFERENCES grc_uploaded_frameworks(id)
                """))
            else:
                # SQLite: check first, then add
                result = conn.execute(text(
                    "SELECT COUNT(*) FROM pragma_table_info('grc_framework_risk_assessments') WHERE name='uploaded_framework_id'"
                ))
                if result.scalar() == 0:
                    conn.execute(text(
                        "ALTER TABLE grc_framework_risk_assessments ADD COLUMN uploaded_framework_id INTEGER REFERENCES grc_uploaded_frameworks(id)"
                    ))
            conn.commit()
            print("✓ uploaded_framework_id column ready")
        except Exception as e:
            print(f"  uploaded_framework_id: {e}")
            conn.rollback()

        # 2 - Make framework_id nullable (Postgres only; SQLite ignores constraints)
        if is_postgres:
            try:
                conn.execute(text(
                    "ALTER TABLE grc_framework_risk_assessments ALTER COLUMN framework_id DROP NOT NULL"
                ))
                conn.commit()
                print("✓ framework_id is now nullable")
            except Exception as e:
                print(f"  framework_id nullable: {e}")
                conn.rollback()

        # 3 - Add index on uploaded_framework_id
        try:
            if is_postgres:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_fw_risk_assessment_uploaded_fw ON grc_framework_risk_assessments(uploaded_framework_id)"
                ))
            else:
                conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS ix_fw_risk_assessment_uploaded_fw ON grc_framework_risk_assessments(uploaded_framework_id)"
                ))
            conn.commit()
            print("✓ Index on uploaded_framework_id ready")
        except Exception as e:
            print(f"  Index: {e}")
            conn.rollback()

    print("Migration complete.")


if __name__ == "__main__":
    run_migration()
