import sqlite3

DB_PATH = "grc_app.db"

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        cursor.execute("""
        ALTER TABLE grc_audit_reports 
        ADD COLUMN ai_recommendations TEXT;
        """)
        conn.commit()
        print("Column added successfully.")
    except Exception as e:
        print("Migration skipped or failed:", e)

    conn.close()

if __name__ == "__main__":
    migrate()