"""Seed 1LINK's ERM framework into one tenant — committees, qualitative risk
appetite, a 3x3 likelihood/impact scale, and a representative RCSA risk register
(with controls, mitigation actions and KRIs). Additive + idempotent; safe to
re-run and never touches other tenants.

Usage (from backend/):
    py -3.11 scripts/seed_onelink.py --slug <tenant-slug>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
try:
    from dotenv import load_dotenv
    load_dotenv(_BACKEND / ".env")
except Exception:
    pass

from grc.db import open_tenant_session          # noqa: E402
from grc.models import Tenant                    # noqa: E402
from grc.services.onelink_seed import seed_onelink  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed 1LINK ERM framework data into a tenant.")
    ap.add_argument("--slug", required=True, help="Tenant slug to seed (e.g. onelink)")
    args = ap.parse_args()

    db = open_tenant_session(args.slug)
    try:
        tenant = db.query(Tenant).first()
        if not tenant:
            print(f"[seed] {args.slug}: no tenant row found; aborted", file=sys.stderr)
            sys.exit(1)
        summary = seed_onelink(db, tenant.id)
        print(f"[seed] {args.slug}: seeded {summary}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
