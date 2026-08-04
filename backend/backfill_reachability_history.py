"""One-time backfill: establish t-zero exploitability history for every assessable
finding (vuln × asset), so the audit timeline has a real baseline at a known moment
instead of a ragged front edge determined by whoever opens which finding first.

Two disciplines this deliberately follows:
  * Through the REAL write path. Each finding is assessed with build_view and written
    via record_snapshot — the same write-on-material-change / first-seen-unconditional
    logic the live endpoints use. NOT a bulk INSERT that stamps every finding: that
    would be write-on-read done once by hand, one baseline row of "the present" per
    finding, which is exactly what Option A rejects. Because it goes through
    record_snapshot, re-running is idempotent (second run finds matching hashes and
    writes nothing) — the way to prove it is to run it twice and see the count hold.
  * Narration stays NULL. No model calls during the sweep — stories no one asked to
    see would bloat the baseline write and cost 15 (or 15,000) generations. Narration
    fills lazily on first expand, exactly as in the live path.

Usage (from backend/):  python backfill_reachability_history.py [--tenant complyverse]
"""
import argparse
import os

from dotenv import load_dotenv

# The grc import chain reads SESSION_SECRET (and DB config) at import time, so load
# .env before importing anything under grc.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from grc.db import open_tenant_session  # noqa: E402
from grc.models import ITAsset, Vulnerability, VulnerabilityAssetLink
from grc.modules.vuln_management.attack.history import record_snapshot
from grc.modules.vuln_management.attack.view import build_view


def backfill(db) -> dict:
    """Assess every (vuln × asset) link through record_snapshot. control_coverage and
    other_assets are omitted on purpose — neither touches the MATERIAL fields (verdict
    + per-technique status/source/confidence), so the baseline hash matches a later
    live assessment's hash and the two paths stay idempotent with each other."""
    links = db.query(VulnerabilityAssetLink).all()
    assessed = 0
    written = 0
    for link in links:
        vuln = db.query(Vulnerability).filter_by(id=link.vulnerability_id).first()
        asset = db.query(ITAsset).filter_by(id=link.asset_id).first()
        if not vuln or not asset:
            continue
        assessed += 1
        view = build_view(vuln, asset)
        _snap, created = record_snapshot(db, vuln.tenant_id, vuln, asset, view)
        if created:
            written += 1
    return {"findings_assessed": assessed, "baseline_snapshots_written": written}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        print("Backfill:", backfill(db))
    finally:
        db.close()


if __name__ == "__main__":
    main()
