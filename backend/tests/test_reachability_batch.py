"""Batch attack-path computation — fills "path not calculated yet" via the REAL
engine + the REAL change-aware writer, no second code path.

Locks: (1) every linked (vuln × asset) pair gets a snapshot; (2) a CVE-less
"info" finding lands as unlikely/undeterminable — never invented as dangerous;
(3) re-running with only_missing writes nothing new (idempotent); (4) a scope
filter restricts to that scope's findings.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ITAsset, Vulnerability, VulnerabilityAssetLink, ReachabilitySnapshot, ReachabilityStep
from grc.services.reachability_batch import compute_paths

TENANT = 1
NET = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ITAsset, Vulnerability, VulnerabilityAssetLink, ReachabilitySnapshot, ReachabilityStep):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([
        ITAsset(id=1, tenant_id=TENANT, name="DESKTOP-CE3EFJB", host_name="DESKTOP-CE3EFJB",
                asset_type="infrastructure", status="active", is_internet_facing=False),
    ])
    s.add_all([
        # a real CVE finding with CWE + network vector — the engine can reason
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="NS-A", title="PostgreSQL Multiple Vulnerabilities",
                      severity="high", status="open", cve_id="CVE-2026-2003", cwe_id="CWE-1287", cvss_vector=NET),
        # a Nessus "info" item — no CVE / CWE / vector: nothing to reason from
        Vulnerability(id=11, tenant_id=TENANT, vuln_id="NS-B", title="Service Detection",
                      severity="info", status="open", cve_id=None, cwe_id=None, cvss_vector=None),
        # a finding with NO asset link — must be skipped (no pair)
        Vulnerability(id=12, tenant_id=TENANT, vuln_id="NS-C", title="orphan", severity="low", status="open"),
    ])
    s.add_all([VulnerabilityAssetLink(vulnerability_id=10, asset_id=1),
               VulnerabilityAssetLink(vulnerability_id=11, asset_id=1)])
    s.commit()
    yield s
    s.close()


def test_batch_computes_every_linked_pair_and_is_honest_about_info(db):
    r = compute_paths(db, TENANT)
    assert r["pairs"] == 2 and r["evaluated"] == 2 and r["snapshots_written"] == 2
    assert r["errors"] == 0
    snaps = {s.vulnerability_id: s for s in db.query(ReachabilitySnapshot).all()}
    assert set(snaps) == {10, 11}                       # orphan 12 not evaluated
    # the info finding is NOT dressed up as dangerous
    assert snaps[11].verdict == "unlikely"
    # the CVE finding on a non-internet-facing box: engine reached a real verdict
    assert snaps[10].verdict in ("unlikely", "possible", "likely")
    # steps were written for the chain (atomic with the header)
    assert db.query(ReachabilityStep).filter_by(snapshot_id=snaps[10].id).count() >= 1


def test_batch_is_idempotent_with_only_missing(db):
    compute_paths(db, TENANT)
    n = db.query(ReachabilitySnapshot).count()
    r2 = compute_paths(db, TENANT, only_missing=True)
    assert r2["evaluated"] == 0 and r2["snapshots_written"] == 0
    assert db.query(ReachabilitySnapshot).count() == n


def test_batch_scope_filter(db):
    r = compute_paths(db, TENANT, vulnerability_ids=[11])
    assert r["pairs"] == 1 and r["snapshots_written"] == 1
    assert db.query(ReachabilitySnapshot).one().vulnerability_id == 11
    assert compute_paths(db, TENANT, vulnerability_ids=[])["pairs"] == 0   # empty scope, honest
