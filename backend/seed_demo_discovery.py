"""Reversible DEMO for the Asset Discovery module, so the /asset-discovery screen
is alive and CONSISTENT with the IT Asset inventory demo: a couple of campaigns,
recent scan runs whose counts line up, an inbox with a few unresolved hosts, and
a couple of encrypted credential profiles.

The resolved observations link to the SAME [DEMO] assets that
seed_demo_it_assets.py creates, so "found last scan" on Discovery reconciles with
what shows in Inventory — nothing mismatches.

Everything is [DEMO]-tagged; cleanup deletes only the demo rows (deleting the demo
campaigns cascades their scopes/runs/jobs/observations).

Usage (from backend/):  python seed_demo_discovery.py seed|cleanup [--tenant complyverse]
"""
import argparse
from datetime import datetime, timedelta

from grc.models import (
    GRCUser, ITAsset,
    DiscoveryCampaign, DiscoveryScope, DiscoveryRun, DiscoveryObservation,
    CredentialProfile,
)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants

TAG = "[DEMO]"


def _demo_campaign_ids(db, tids):
    return [c.id for c in db.query(DiscoveryCampaign).filter(
        DiscoveryCampaign.tenant_id.in_(tids), DiscoveryCampaign.name.like(f"{TAG}%")).all()]


def cleanup(db, tids):
    removed = {"campaigns": 0, "credentials": 0}
    for c in db.query(DiscoveryCampaign).filter(
            DiscoveryCampaign.id.in_(_demo_campaign_ids(db, tids) or [-1])).all():
        db.delete(c)  # cascades scopes / runs / jobs / observations
        removed["campaigns"] += 1
    removed["credentials"] = db.query(CredentialProfile).filter(
        CredentialProfile.tenant_id.in_(tids),
        CredentialProfile.name.like(f"{TAG}%"),
    ).delete(synchronize_session=False)
    db.commit()
    return removed


def seed(db, tids):
    now = datetime.utcnow()
    tid = tids[0]
    user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
    cleanup(db, tids)

    # Link discovery findings to the existing [DEMO] inventory assets so the two
    # modules reconcile. If the asset demo hasn't run, we still seed coherent
    # observations without an asset link.
    demo_assets = db.query(ITAsset).filter(
        ITAsset.tenant_id.in_(tids), ITAsset.name.like(f"{TAG}%")).order_by(ITAsset.id).all()
    aids = [a.id for a in demo_assets]

    # ---- credential profiles (encrypted secrets) ----
    try:
        from grc.crypto import encrypt_secret
    except Exception:  # pragma: no cover
        encrypt_secret = lambda s: s  # noqa: E731
    for name, kind, uname, cidrs in [
        (f"{TAG} Windows domain", "winrm", "CORP\\svc_scan", ["10.10.0.0/24"]),
        (f"{TAG} Linux fleet", "ssh", "svc_scan", ["10.20.0.0/24"]),
    ]:
        db.add(CredentialProfile(
            tenant_id=tid, name=name, kind=kind, username=uname,
            secret_kind="password", secret_encrypted=encrypt_secret("demo-not-a-real-secret"),
            applies_to_cidrs=cidrs, priority=50, is_active=True,
            created_by_id=getattr(user, "id", None), created_by_name="Demo",
        ))
    db.commit()

    # ---- campaigns + scopes ----
    corp = DiscoveryCampaign(
        tenant_id=tid, name=f"{TAG} Corp network", method="network", is_active=True,
        schedule_seconds=21600, last_run_at=now - timedelta(hours=3),
        next_run_at=now + timedelta(hours=3), created_at=now - timedelta(days=20),
        created_by_id=getattr(user, "id", None), created_by_name="Demo",
    )
    dc = DiscoveryCampaign(
        tenant_id=tid, name=f"{TAG} Data centre", method="network", is_active=True,
        schedule_seconds=None, last_run_at=now - timedelta(days=1),
        created_at=now - timedelta(days=18),
        created_by_id=getattr(user, "id", None), created_by_name="Demo",
    )
    db.add_all([corp, dc])
    db.flush()
    db.add_all([
        DiscoveryScope(tenant_id=tid, campaign_id=corp.id, kind="cidr", value="10.10.0.0/24"),
        DiscoveryScope(tenant_id=tid, campaign_id=corp.id, kind="cidr", value="10.10.0.1/32",
                       exclude=True, note="gateway"),
        DiscoveryScope(tenant_id=tid, campaign_id=dc.id, kind="cidr", value="10.20.0.0/24"),
    ])
    db.commit()

    # ---- runs: a short history whose latest run's counts match the inbox ----
    # Latest Corp run: 12 hosts seen -> 8 new + 2 updated resolved, 2 left for review.
    resolved = min(10, len(aids))            # how many we can link to real assets
    new_count = max(0, resolved - 2)
    upd_count = resolved - new_count
    review_count = 2
    hosts_seen = resolved + review_count

    runs_spec = [
        (corp, now - timedelta(days=6, hours=1), "scheduled", "succeeded", 11, 11, 0, 0),
        (dc,   now - timedelta(days=1), "manual", "succeeded", 7, 5, 1, 0),
        (corp, now - timedelta(hours=3), "scheduled", "succeeded", hosts_seen, new_count, upd_count, review_count),
    ]
    latest_run = None
    for camp, when, trig, status, seen, newc, updc, rev in runs_spec:
        r = DiscoveryRun(
            tenant_id=tid, campaign_id=camp.id, trigger=trig, status=status,
            started_at=when, finished_at=when + timedelta(minutes=4), created_at=when,
            hosts_seen=seen, observations=seen, assets_new=newc, assets_updated=updc,
        )
        db.add(r)
        db.flush()
        latest_run = (r, newc, updc, rev)

    # ---- observations for the latest Corp run (drives the inbox + reconciliation) ----
    if latest_run is not None:
        r, newc, updc, rev = latest_run
        base_ip = 20
        # resolved (created/merged) observations -> linked to real demo assets
        for k in range(resolved):
            asset_id = aids[k] if k < len(aids) else None
            action = "created" if k < newc else "merged"
            note = (f"created new discovered asset #{asset_id}" if action == "created"
                    else f"matched existing asset #{asset_id} by hostname")
            db.add(DiscoveryObservation(
                tenant_id=tid, run_id=r.id, source="cidr", observed_at=r.started_at,
                host_name=f"corp-host-{k+1:02d}", ip_address=f"10.10.0.{base_ip + k}",
                raw={"open_ports": [445] if k % 2 else [22], "scope": "10.10.0.0/24"},
                resolution=action, resolved_asset_id=asset_id, resolution_note=note,
            ))
        # unresolved (review) observations -> populate the inbox
        for j in range(rev):
            db.add(DiscoveryObservation(
                tenant_id=tid, run_id=r.id, source="cidr", observed_at=r.started_at,
                host_name=None, ip_address=f"10.10.0.{base_ip + resolved + j}",
                raw={"open_ports": [3389], "scope": "10.10.0.0/24"},
                resolution="review", resolved_asset_id=None,
                resolution_note="ambiguous: 2 assets match by ip",
            ))
    db.commit()

    return {
        "campaigns": 2, "credentials": 2, "runs": len(runs_spec),
        "resolved_observations": resolved, "review_observations": review_count,
        "linked_assets": len(aids),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["seed", "cleanup"])
    ap.add_argument("--tenant", default="complyverse")
    args = ap.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        user = db.query(GRCUser).filter(GRCUser.username == "admin").first() or db.query(GRCUser).first()
        tids = get_user_tenants(user, db)
        if args.command == "cleanup":
            print("Reset:", cleanup(db, tids))
        else:
            print("Cleared prior:", cleanup(db, tids))
            print("Seeded:", seed(db, tids))
    finally:
        db.close()


if __name__ == "__main__":
    main()
