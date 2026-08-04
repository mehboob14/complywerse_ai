"""Seed a reversible demo TREND HISTORY for the live Cyber Security KPIs.

The live KPI value is computed fresh each load (real). To draw a trend LINE we need
past points; those accumulate over time via the daily snapshot, but a fresh demo
tenant has none. This backfills ~9 weekly points per live KPI, trending up toward
the current computed value, into grc_metric_snapshot (metric = kpi_<key>). The
newest point (today) is written live by the endpoint, so the line ends on the real
value. Fully reversible.

Usage (from backend/):  python seed_demo_kpi_history.py seed|cleanup [--tenant complyverse]
"""
import argparse
import math
from datetime import datetime, timedelta

from grc.db import open_tenant_session
from grc.routers.auth_router import get_user_tenants
from grc.models import GRCUser, MetricSnapshot
from grc.services import metric_snapshots as ms
from grc.modules.assessments.kpi_live import compute_kpi_metrics

WEEKS = 9  # past weekly points to backfill (today is added live by the endpoint)


def seed(db, tid):
    ms.ensure_table(db)
    now = datetime.utcnow()
    metrics = compute_kpi_metrics(db, now, tenant_ids=[tid])
    today = now.date()
    written = 0
    for key, m in metrics.items():
        cur = m.get("actual")
        if cur is None:
            continue
        offset = sum(ord(c) for c in key) % 7          # deterministic per-KPI wobble phase
        start = max(0.0, cur - 18.0)                    # started ~18pp below where it is now
        for i in range(WEEKS):                          # oldest -> newest (weeks WEEKS..1 ago)
            frac = i / float(WEEKS)                      # 0 -> ~1
            base = start + (cur - start) * frac
            wobble = 5.0 * math.sin(i * 1.1 + offset)
            val = max(0.0, min(100.0, round(base + wobble, 1)))
            d = today - timedelta(weeks=(WEEKS - i))
            ms.upsert(db, tid, f"kpi_{key}", d, val)
            written += 1
    db.commit()
    return written


def cleanup(db, tid):
    q = db.query(MetricSnapshot).filter(
        MetricSnapshot.tenant_id == tid,
        MetricSnapshot.metric.like("kpi_%"),
    )
    n = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()

    db = open_tenant_session(args.tenant)
    try:
        user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
        tids = get_user_tenants(user, db)
        tid = tids[0]
        if args.command == "cleanup":
            print("Removed kpi history rows:", cleanup(db, tid))
        else:
            print("Cleared prior:", cleanup(db, tid))
            print("Seeded kpi history points:", seed(db, tid))
    finally:
        db.close()


if __name__ == "__main__":
    main()
