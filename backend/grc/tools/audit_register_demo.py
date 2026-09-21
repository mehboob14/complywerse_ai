"""Load or remove the audit register's demo data for one tenant.

    python -m grc.tools.audit_register_demo seed --tenant cfsb
    python -m grc.tools.audit_register_demo cleanup --tenant cfsb

Like scf_import, it loads backend/.env before importing the app: the issue
module's package pulls in the auth router, which refuses to import without
SESSION_SECRET, and a person running this by hand does not have it exported.
"""
from __future__ import annotations

import argparse
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
except ImportError:   # a pre-exported environment still works
    pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit register demo data")
    parser.add_argument("action", choices=["seed", "cleanup"])
    parser.add_argument("--tenant", required=True, help="tenant slug, e.g. cfsb")
    args = parser.parse_args()

    from grc.db import open_tenant_session
    from grc.models import Tenant
    from grc.modules.issue_management.audit_register import demo

    db = open_tenant_session(args.tenant)
    try:
        tenant_id = db.query(Tenant).first().id
        if args.action == "seed":
            print("created:", demo.seed(db, tenant_id))
            print("linked:", demo.relink(db, tenant_id))
        else:
            print("removed:", demo.cleanup(db, tenant_id))
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
