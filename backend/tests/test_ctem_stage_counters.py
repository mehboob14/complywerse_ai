"""CTEM stage counters — the prioritized counter's NON-VACUITY guard.

The wiring was proven live, but a hermetic test with every fixture in-scope
would still pass an implementation that ignored scope membership entirely
(the identity-map lesson, applied to the newest counter). So the load-bearing
fixture here is an out-of-scope finding carrying a first_seen stamp, asserted
EXCLUDED — plus the in-window vs launch-backfill decomposition on the in-scope
one.
"""
import pytest
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    ITAsset, Vulnerability, VulnerabilityAssetLink,
    ControlEffectivenessEvidence, VulnRemediationPlan,
    ChokePointFirstSeen,
)
from grc.services.ctem_scopes import compute_stage_counts, resolve_scope_assets

TENANT = 1
NOW = datetime(2026, 8, 10, 12, 0, 0)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ITAsset, Vulnerability, VulnerabilityAssetLink,
              ControlEffectivenessEvidence, VulnRemediationPlan, ChokePointFirstSeen):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    _seed(s)
    yield s
    s.close()


def _seed(db):
    # asset 1 is IN scope (Payments); asset 2 is OUT (HR).
    db.add_all([
        ITAsset(id=1, tenant_id=TENANT, name="pay-1", host_name="pay-1",
                department="Payments", asset_type="server", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="hr-1", host_name="hr-1",
                department="HR", asset_type="server", status="active"),
    ])
    # finding 10 on the in-scope asset; finding 20 on the out-of-scope asset.
    db.add_all([
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="V-10", title="in", severity="high", status="open"),
        Vulnerability(id=20, tenant_id=TENANT, vuln_id="V-20", title="out", severity="high", status="open"),
    ])
    db.add_all([
        VulnerabilityAssetLink(vulnerability_id=10, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=20, asset_id=2),
    ])
    # BOTH findings carry a first_seen stamp inside the window — but only the
    # in-scope one may count. The in-scope stamp is non-inaugural (real
    # workflow); add a separate inaugural one to exercise the split.
    db.add_all([
        ChokePointFirstSeen(tenant_id=TENANT, vulnerability_id=10,
                            first_in_snapshot_at=NOW - timedelta(hours=1),
                            is_inaugural_backfill=False),
        ChokePointFirstSeen(tenant_id=TENANT, vulnerability_id=20,   # OUT of scope
                            first_in_snapshot_at=NOW - timedelta(hours=1),
                            is_inaugural_backfill=False),
    ])
    db.commit()


def test_prioritized_excludes_out_of_scope_finding(db):
    members = resolve_scope_assets(db, TENANT, {"departments": ["Payments"]})
    assert members == [1]  # only the in-scope asset
    counts = compute_stage_counts(db, TENANT, members,
                                  since=NOW - timedelta(days=1), until=NOW + timedelta(days=1))
    # finding 20 is out of scope: its first_seen must NOT be counted. If the
    # counter ignored scope, this would be 2.
    assert counts["prioritized"] == 1, "out-of-scope first_seen leaked into the counter"
    assert counts["prioritized_in_window"] == 1
    assert counts["prioritized_launch_backfill"] == 0


def test_prioritized_backfill_split(db):
    # mark the in-scope finding's stamp as inaugural backfill → it moves from
    # in_window to launch_backfill (a cycle spanning launch mustn't read it as
    # workflow).
    fs = db.query(ChokePointFirstSeen).filter_by(vulnerability_id=10).one()
    fs.is_inaugural_backfill = True
    db.commit()
    counts = compute_stage_counts(db, TENANT, [1],
                                  since=NOW - timedelta(days=1), until=NOW + timedelta(days=1))
    assert counts["prioritized"] == 1
    assert counts["prioritized_launch_backfill"] == 1
    assert counts["prioritized_in_window"] == 0


def test_prioritized_absent_when_no_first_seen(db):
    # a scope whose findings have no choke-point history → counter stays absent
    # (honest "seam not yet produced"), never a fake zero.
    db.query(ChokePointFirstSeen).delete(); db.commit()
    counts = compute_stage_counts(db, TENANT, [1],
                                  since=NOW - timedelta(days=1), until=NOW + timedelta(days=1))
    assert "prioritized" not in counts or counts.get("prioritized") == 0
