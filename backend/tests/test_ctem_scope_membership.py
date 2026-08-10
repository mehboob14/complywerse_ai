"""CTEM scope membership — the load-bearing invariants, promoted from live
one-off checks into the permanent suite so a future refactor of the register
filter or the resolver can't break them silently with nobody re-running a
script.

DB-backed but hermetic: in-memory SQLite holding just the tables these
functions touch, fixture data built in-test (no dev-tenant dependency).

Locked here:
  * scope_vulnerability_ids is THE one definition of "in scope" — its output
    equals independently-computed ground truth over every membership mode
    (rule ×N dimensions, explicit, mixed-with-overlap);
  * a mixed scope whose explicit list and rule both match an asset counts
    that asset's findings ONCE (dedup, proven from output);
  * the membership hash is deterministic (recompute matches) AND sensitive
    (adding a matching asset changes it) — both legs, since a constant hash
    passes a recompute test too.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    ITAsset, Vulnerability, VulnerabilityAssetLink,
)
from grc.services.ctem_scopes import (
    resolve_scope_assets, scope_vulnerability_ids, membership_hash,
)

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for model in (ITAsset, Vulnerability, VulnerabilityAssetLink):
        model.__table__.create(engine)
    session = sessionmaker(bind=engine)()
    _seed(session)
    yield session
    session.close()


def _seed(db):
    # Four assets across two departments / two types, plus one that matches
    # nothing but an explicit id.
    assets = [
        ITAsset(id=1, tenant_id=TENANT, name="pay-web-01", host_name="pay-web-01",
                department="Payments", asset_type="server", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="pay-db-01", host_name="pay-db-01",
                department="Payments", asset_type="database", status="active"),
        ITAsset(id=3, tenant_id=TENANT, name="hr-app-01", host_name="hr-app-01",
                department="HR", asset_type="server", status="active"),
        ITAsset(id=4, tenant_id=TENANT, name="isolated-box", host_name="isolated-box",
                department="Lab", asset_type="appliance", status="active"),
    ]
    db.add_all(assets)
    # Findings: two on asset 1, one on asset 2, one on asset 3, none on 4.
    vulns = [Vulnerability(id=i, tenant_id=TENANT, vuln_id=f"V-{i}", title=f"v{i}",
                           severity="high", status="open") for i in range(1, 5)]
    db.add_all(vulns)
    db.add_all([
        VulnerabilityAssetLink(vulnerability_id=1, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=2, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=3, asset_id=2),
        VulnerabilityAssetLink(vulnerability_id=4, asset_id=3),
    ])
    db.commit()


def _ground_truth_vulns(db, asset_ids):
    """Independent computation — do NOT reuse the service helpers, or the test
    checks the code against itself."""
    got = set()
    for link in db.query(VulnerabilityAssetLink).all():
        if link.asset_id in asset_ids:
            got.add(link.vulnerability_id)
    return got


# ── membership modes: resolver output == independent ground truth ────────────

def test_rule_department(db):
    rule = {"departments": ["Payments"]}
    assert resolve_scope_assets(db, TENANT, rule) == [1, 2]
    assert set(scope_vulnerability_ids(db, TENANT, rule)) == _ground_truth_vulns(db, {1, 2}) == {1, 2, 3}


def test_rule_asset_type(db):
    rule = {"asset_types": ["server"]}
    assert resolve_scope_assets(db, TENANT, rule) == [1, 3]
    assert set(scope_vulnerability_ids(db, TENANT, rule)) == _ground_truth_vulns(db, {1, 3}) == {1, 2, 4}


def test_rule_name_contains(db):
    rule = {"name_contains": "pay-"}
    assert resolve_scope_assets(db, TENANT, rule) == [1, 2]
    assert set(scope_vulnerability_ids(db, TENANT, rule)) == {1, 2, 3}


def test_rule_criteria_AND_narrows(db):
    # Payments AND server → only asset 1 (asset 2 is Payments but database).
    rule = {"departments": ["Payments"], "asset_types": ["server"]}
    assert resolve_scope_assets(db, TENANT, rule) == [1]
    assert set(scope_vulnerability_ids(db, TENANT, rule)) == {1, 2}


def test_explicit_membership(db):
    rule = {"asset_ids": [1, 3]}
    assert resolve_scope_assets(db, TENANT, rule) == [1, 3]
    assert set(scope_vulnerability_ids(db, TENANT, rule)) == _ground_truth_vulns(db, {1, 3}) == {1, 2, 4}


def test_mixed_explicit_and_rule_dedup(db):
    # explicit {1} UNION rule {1,2} → {1,2}, asset 1 counted ONCE (a naive
    # list-concat would yield [1,1,2] and double asset 1's findings).
    rule = {"asset_ids": [1], "departments": ["Payments"]}
    members = resolve_scope_assets(db, TENANT, rule)
    assert members == [1, 2], f"expected deduped [1,2], got {members}"
    vulns = scope_vulnerability_ids(db, TENANT, rule)
    assert len(vulns) == len(set(vulns)), "findings must not double-count"
    assert set(vulns) == {1, 2, 3}


def test_empty_rule_is_empty_scope_not_all(db):
    # A missing/empty rule must resolve to NOTHING, never accidentally "all".
    assert resolve_scope_assets(db, TENANT, {}) == []
    assert resolve_scope_assets(db, TENANT, None) == []
    assert scope_vulnerability_ids(db, TENANT, {}) == []


# ── membership hash: determinism AND sensitivity ─────────────────────────────

def test_hash_deterministic(db):
    members = resolve_scope_assets(db, TENANT, {"departments": ["Payments"]})
    assert membership_hash(members) == membership_hash(members)
    assert membership_hash(members) == membership_hash(list(reversed(members)))  # order-independent


def test_hash_sensitive_to_drift(db):
    rule = {"departments": ["Payments"]}
    before = membership_hash(resolve_scope_assets(db, TENANT, rule))
    # change the world: a new asset newly matches the rule
    db.add(ITAsset(id=5, tenant_id=TENANT, name="pay-cache-01", host_name="pay-cache-01",
                   department="Payments", asset_type="cache", status="active"))
    db.commit()
    after = membership_hash(resolve_scope_assets(db, TENANT, rule))
    assert after != before, "hash must DETECT membership drift, not just reproduce"


def test_hash_stable_when_world_unchanged(db):
    rule = {"departments": ["Payments"]}
    h1 = membership_hash(resolve_scope_assets(db, TENANT, rule))
    # unrelated asset added — does NOT match the rule → hash unchanged
    db.add(ITAsset(id=6, tenant_id=TENANT, name="hr-extra", host_name="hr-extra",
                   department="HR", asset_type="server", status="active"))
    db.commit()
    h2 = membership_hash(resolve_scope_assets(db, TENANT, rule))
    assert h1 == h2, "membership unchanged → hash must not move"
