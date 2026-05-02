"""
Wipe all GRC databases on the configured Postgres server.

Drops the master DB and every database whose name starts with `grc_`. Intended
for local development resets — DO NOT run against a shared / production server.

Usage:
    python -m backend.scripts.reset_pg
"""

import os
import sys

from dotenv import load_dotenv

# Load .env from the backend folder so POSTGRES_ADMIN_URL is available.
HERE = os.path.dirname(__file__)
BACKEND_DIR = os.path.abspath(os.path.join(HERE, ".."))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from sqlalchemy import create_engine, text  # noqa: E402


def _normalize(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def main() -> int:
    admin_url = _normalize(os.environ.get("POSTGRES_ADMIN_URL", ""))
    if not admin_url:
        print("POSTGRES_ADMIN_URL not set. Aborting.", file=sys.stderr)
        return 1

    print(f"Connecting to admin URL: {admin_url}")
    engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", future=True)
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT datname FROM pg_database WHERE datname LIKE 'grc_%' OR datname = 'grc_master'")
        ).fetchall()
        names = sorted({r[0] for r in rows})
        if not names:
            print("No grc_* databases found. Nothing to drop.")
            return 0

        print(f"Will drop: {', '.join(names)}")
        for name in names:
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :n AND pid <> pg_backend_pid()"
                ),
                {"n": name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{name}"'))
            print(f"  dropped {name}")
    engine.dispose()
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
