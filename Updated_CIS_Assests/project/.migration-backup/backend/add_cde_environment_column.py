"""Add cde_environment column to grc_it_assets table (idempotent)."""

import os
from pathlib import Path

from sqlalchemy import create_engine, inspect, text


TABLE_NAME = "grc_it_assets"
COLUMN_NAME = "cde_environment"


def resolve_database_url() -> str:
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        return database_url

    backend_dir = Path(__file__).resolve().parent
    sqlite_candidates = [backend_dir / "grc_app.db", backend_dir / "grc.db"]

    for candidate in sqlite_candidates:
        if candidate.exists():
            return f"sqlite:///{candidate.as_posix()}"

    return "sqlite:///grc_app.db"


def get_alter_sql(dialect_name: str) -> str:
    if dialect_name == "postgresql":
        return (
            f"ALTER TABLE {TABLE_NAME} "
            f"ADD COLUMN IF NOT EXISTS {COLUMN_NAME} BOOLEAN DEFAULT FALSE"
        )

    return (
        f"ALTER TABLE {TABLE_NAME} "
        f"ADD COLUMN {COLUMN_NAME} BOOLEAN DEFAULT 0"
    )


def main() -> None:
    database_url = resolve_database_url()

    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    engine = create_engine(database_url)
    inspector = inspect(engine)

    print(f"Using database: {database_url}")

    if not inspector.has_table(TABLE_NAME):
        print(f"⚠ Table '{TABLE_NAME}' does not exist. No changes made.")
        return

    existing_columns = {column["name"] for column in inspector.get_columns(TABLE_NAME)}
    if COLUMN_NAME in existing_columns:
        print(f"✓ Column '{COLUMN_NAME}' already exists. No migration needed.")
        return

    alter_sql = get_alter_sql(engine.dialect.name)

    with engine.begin() as connection:
        connection.execute(text(alter_sql))

    refreshed_columns = {column["name"] for column in inspect(engine).get_columns(TABLE_NAME)}
    if COLUMN_NAME in refreshed_columns:
        print(f"✓ Added '{COLUMN_NAME}' column to '{TABLE_NAME}'.")
    else:
        raise RuntimeError(
            f"Migration did not succeed: '{COLUMN_NAME}' missing from '{TABLE_NAME}'."
        )


if __name__ == "__main__":
    main()
