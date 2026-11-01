"""Credential-free promotion: a network sweep takes discovered hosts into the IT
Asset Inventory DIRECTLY as `uncredential` assets, and a later credentialed
collect upgrades them to `credential`.

Two proofs:
  1. resolve_observation on an unmatched CIDR observation CREATES an ITAsset
     (origin_source=network_sweep, discovery_state=unmanaged), carries the sweep
     fields + the CIDR it was swept from, and is idempotent on re-sweep.
  2. The scan_mode contract (assets_router._scan_mode) maps the stored columns to
     exactly easm | credential | uncredential — including the uncredential→credential
     flip that a successful credentialed collect performs (discovery_state='managed').
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ITAsset, DiscoveryObservation, AssetExternalIdentity
from grc.modules.asset_discovery.services.resolver import resolve_observation
from grc.routers.assets_router import _scan_mode, _surface_fields

TENANT = 1
CIDR = "10.0.0.0/24"


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for model in (ITAsset, DiscoveryObservation, AssetExternalIdentity):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def _obs(db, ip="10.0.0.5", host="web01"):
    o = DiscoveryObservation(
        tenant_id=TENANT, run_id=1, source="cidr",
        host_name=host, ip_address=ip,
        raw={"open_ports": [80, 443], "scope": CIDR,
             "device_type": "host", "confidence": 0.9},
        resolution="pending",
    )
    db.add(o)
    db.flush()
    return o


def test_sweep_promotes_to_uncredential_inventory_with_cidr(db):
    decision = resolve_observation(db, _obs(db))
    assert decision["action"] == "created"
    assert decision.get("uncredential") is True

    asset = db.query(ITAsset).filter(ITAsset.tenant_id == TENANT).one()
    # Real managed inventory — NOT an adhoc/pentest shell.
    assert asset.status != "adhoc"
    assert asset.origin_source == "network_sweep"
    assert asset.discovery_state == "unmanaged"       # surface, no credential
    assert asset.ip_address == "10.0.0.5"
    assert asset.host_name == "web01"
    # CIDR the sweep found it in — the field the Uncredential view groups by.
    assert asset.network_segment == CIDR
    # Sweep surface evidence survives for the detail popup.
    depth, ports, _dt = _surface_fields(asset)
    assert depth == "surface"
    assert ports == [80, 443]
    # Category contract.
    assert _scan_mode(asset) == "uncredential"


def test_resweep_is_idempotent(db):
    resolve_observation(db, _obs(db))
    db.commit()
    # Same host, new observation (a re-sweep) must MERGE, not duplicate.
    decision = resolve_observation(db, _obs(db))
    assert decision["action"] == "merged"
    assert db.query(ITAsset).count() == 1


def test_scan_mode_contract_including_upgrade():
    # easm wins over everything (EASM assets are never logged into).
    assert _scan_mode(SimpleNamespace(origin_source="easm", discovery_state="managed")) == "easm"
    # Uncredential sweep row.
    assert _scan_mode(SimpleNamespace(origin_source="network_sweep", discovery_state="unmanaged")) == "uncredential"
    # Upgrade: a successful credentialed collect flips discovery_state → 'managed'
    # (deep_collect.collect_host), which recategorizes the SAME network_sweep asset.
    assert _scan_mode(SimpleNamespace(origin_source="network_sweep", discovery_state="managed")) == "credential"
    # Manual/imported assets are not a discovery mode.
    assert _scan_mode(SimpleNamespace(origin_source="manual", discovery_state=None)) is None
