from pathlib import Path
import sqlite3


def find_db() -> Path | None:
    candidates = [
        Path("grc_app.db"),
        Path("grc.db"),
        Path("tenant.db"),
        Path("app.db"),
        Path("grc_tenant.db"),
    ]
    candidates.extend(sorted(Path(".").glob("*.db")))

    seen = set()
    for candidate in candidates:
        if candidate in seen or not candidate.exists() or candidate.stat().st_size == 0:
            continue
        seen.add(candidate)
        try:
            conn = sqlite3.connect(str(candidate))
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='grc_integration_connections'")
            row = cur.fetchone()
            conn.close()
            if row:
                return candidate
        except Exception:
            continue
    return None


def main() -> None:
    db_path = find_db()
    if not db_path:
        print("No sqlite DB file with grc_integration_connections table found; skipping migration")
        return

    print(f"Using DB: {db_path}")
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    cur.execute("PRAGMA table_info('grc_integration_connections')")
    cols = {row[1] for row in cur.fetchall()}

    if "username" not in cols:
        cur.execute("ALTER TABLE grc_integration_connections ADD COLUMN username VARCHAR(255)")
        print("Added column: username")
    else:
        print("Column exists: username")

    if "password" not in cols:
        cur.execute("ALTER TABLE grc_integration_connections ADD COLUMN password VARCHAR(500)")
        print("Added column: password")
    else:
        print("Column exists: password")

    conn.commit()
    conn.close()
    print("Migration complete")


if __name__ == "__main__":
    main()
