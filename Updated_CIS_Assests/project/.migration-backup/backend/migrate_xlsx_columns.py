"""Migration: Add assessment_format and xlsx_data columns to compliance assessment documents"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from grc.models import engine, text

with engine.connect() as conn:
    if engine.dialect.name == "sqlite":
        result = conn.execute(text("PRAGMA table_info(grc_compliance_assessment_documents)"))
        cols = [r[1] for r in result]
    else:
        result = conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name='grc_compliance_assessment_documents'"
        ))
        cols = [r[0] for r in result]

    print("Existing columns:", cols)

    if 'assessment_format' not in cols:
        conn.execute(text(
            "ALTER TABLE grc_compliance_assessment_documents "
            "ADD COLUMN assessment_format VARCHAR(50) DEFAULT 'standard'"
        ))
        print("Added: assessment_format")
    else:
        print("Already exists: assessment_format")

    if 'xlsx_data' not in cols:
        conn.execute(text(
            "ALTER TABLE grc_compliance_assessment_documents "
            "ADD COLUMN xlsx_data TEXT"
        ))
        print("Added: xlsx_data")
    else:
        print("Already exists: xlsx_data")

    conn.commit()
    print("Migration complete.")
