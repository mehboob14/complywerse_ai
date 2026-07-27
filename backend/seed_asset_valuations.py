"""Fill the IT-asset VALUE column.

Sets a criticality-scaled ``valuation`` on any asset that has none yet, so the
inventory register's VALUE column (and any value-weighted rollups) are populated
for a walkthrough instead of showing a dash.

These are PLACEHOLDER estimates keyed off each asset's criticality tier — replace
them with real figures as they become known. The script is:

  * idempotent  — only assets where ``valuation`` IS NULL are touched, so a value
                  that already exists (real or previously seeded) is never changed;
  * reversible  — ``cleanup`` clears only values that still equal a tier default,
                  so an operator's hand-entered figure survives a reset.

Usage (from backend/):  python seed_asset_valuations.py seed|cleanup [--tenant complyverse]
"""
import argparse

from grc.models import GRCUser, ITAsset
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

# Criticality tier -> placeholder asset value (USD).
TIER = {"critical": 500000.0, "high": 200000.0, "medium": 75000.0, "low": 20000.0}
DEFAULT = 50000.0                       # criticality missing / unrecognised
TIER_VALUES = set(TIER.values()) | {DEFAULT}


def _value_for(asset) -> float:
    crit = (getattr(asset, "criticality", None) or "").strip().lower()
    return TIER.get(crit, DEFAULT)


def seed(db, tids):
    assets = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tids)).all()
    set_count = 0
    for a in assets:
        if a.valuation is None:
            a.valuation = _value_for(a)
            set_count += 1
    db.commit()
    return {"assets_seen": len(assets), "valuation_set": set_count}


def cleanup(db, tids):
    """Clear only placeholder values (still equal to a tier default), leaving any
    real operator-entered figure in place."""
    assets = db.query(ITAsset).filter(ITAsset.tenant_id.in_(tids)).all()
    cleared = 0
    for a in assets:
        if a.valuation is not None and float(a.valuation) in TIER_VALUES:
            a.valuation = None
            cleared += 1
    db.commit()
    return {"assets_seen": len(assets), "valuation_cleared": cleared}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = (db.query(GRCUser).filter(GRCUser.username == "admin").first()
                or db.query(GRCUser).first())
        tids = get_user_tenants(user, db)
        if args.command == "cleanup":
            print("Cleared:", cleanup(db, tids))
        else:
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
