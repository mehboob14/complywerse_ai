"""Backfill + write the dashboard metric-snapshot history layer (DASH-001).

Seeds real historical trend points from grc_risk_score_history and captures today's
reconciled KPIs (computed via grc.services.metrics). Idempotent — safe to re-run.
The daily Celery sweep does this automatically; this is for on-demand seeding.

Usage (from backend/):
    py -3 scripts/snapshot_metrics.py --slug layeronon                 # backfill 12mo + today
    py -3 scripts/snapshot_metrics.py --slug layeronon --months 24
    py -3 scripts/snapshot_metrics.py --slug layeronon --daily-only    # just today's snapshot
    py -3 scripts/snapshot_metrics.py --all                            # every active tenant
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

from grc.db import open_tenant_session, MasterSession   # noqa: E402
from grc.models import Tenant                            # noqa: E402
from grc.services import metric_snapshots as ms          # noqa: E402


def run_for_slug(slug: str, months: int, daily_only: bool) -> None:
    db = open_tenant_session(slug)
    try:
        tenant = db.query(Tenant).first()
        if not tenant:
            print(f"[snapshot] {slug}: no tenant row; skipped", flush=True)
            return
        ms.ensure_table(db)
        bf = 0 if daily_only else ms.backfill(db, tenant.id, months=months)
        wd = ms.write_daily(db, tenant.id)
        print(f"[snapshot] {slug}: backfilled={bf} rows, wrote_today={wd} metrics", flush=True)
    finally:
        db.close()


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill + write dashboard metric snapshots.")
    ap.add_argument("--slug", help="Tenant slug (e.g. layeronon)")
    ap.add_argument("--all", action="store_true", help="Run for every active tenant")
    ap.add_argument("--months", type=int, default=12, help="Months of history to backfill (default 12)")
    ap.add_argument("--daily-only", action="store_true", help="Skip backfill; only write today's snapshot")
    args = ap.parse_args()

    if not args.slug and not args.all:
        ap.error("pass --slug <slug> or --all")

    if args.all:
        master = MasterSession()
        try:
            slugs = [t.slug for t in master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all() if t.slug]
        finally:
            master.close()
    else:
        slugs = [args.slug]

    for slug in slugs:
        try:
            run_for_slug(slug, args.months, args.daily_only)
        except Exception as exc:  # noqa: BLE001
            print(f"[snapshot] {slug}: FAILED — {exc}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
