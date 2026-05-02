"""Standalone migration: add `grc_policy_statements.assigned_to_user_id`.

Usage (from repo root, with the backend venv activated):

    python -m backend.grc.migrate_add_statement_assignee              # all tenants in master catalog
    python -m backend.grc.migrate_add_statement_assignee <slug>       # specific tenant slug

This duplicates what the lazy in-process self-heal does, for operators who
want explicit, observable migration runs (CI, deploy scripts, etc.). Idempotent.
"""

import os
import sys

# Make `from grc...` work when this file is executed as a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from grc.modules.compliance.schema_migrations import _ensure_for_engine, _iter_tenant_slugs
from grc.db import get_tenant_engine


def migrate(slugs):
    for slug in slugs:
        try:
            engine = get_tenant_engine(slug)
        except Exception as exc:
            print(f"[skip] {slug}: could not open engine ({exc})")
            continue
        print(f"[run]  {slug}: ensuring grc_policy_statements.assigned_to_user_id ...")
        _ensure_for_engine(engine)
        print(f"[ok]   {slug}")


def main():
    if len(sys.argv) > 1:
        slugs = sys.argv[1:]
    else:
        slugs = _iter_tenant_slugs()
        if not slugs:
            print("No tenants found in master catalog. Pass slug(s) as args to target specific DBs.")
            return
    migrate(slugs)


if __name__ == "__main__":
    main()
