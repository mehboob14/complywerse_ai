"""apex↔subdomain lineage for EASM-discovered domain assets.

Locks: apex computation (incl. two-level ccTLDs), subdomain→apex edges written
only when the apex is in inventory, IPs/fields never mutated, idempotency, and
that non-domain hosts (bare NetBIOS names, IPs) are never linked.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ITAsset, AssetRelationship
from grc.modules.asset_discovery.services.domain_hierarchy import (
    registrable_domain, link_domain_hierarchy,
)

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ITAsset, AssetRelationship):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([
        ITAsset(id=1, tenant_id=TENANT, name="liztek.ca", host_name="liztek.ca", fqdn="liztek.ca",
                ip_address="162.244.93.14", asset_type="infrastructure", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="ftp.liztek.ca", host_name="ftp.liztek.ca", fqdn="ftp.liztek.ca",
                ip_address="162.244.93.14", asset_type="infrastructure", status="active"),
        ITAsset(id=3, tenant_id=TENANT, name="mta-sts.liztek.ca", host_name="mta-sts.liztek.ca", fqdn="mta-sts.liztek.ca",
                ip_address="23.172.139.2", asset_type="infrastructure", status="active"),
        # a bare NetBIOS host — NOT a domain, must never be linked
        ITAsset(id=4, tenant_id=TENANT, name="DESKTOP-CE3EFJB", host_name="DESKTOP-CE3EFJB", fqdn=None,
                ip_address="192.168.1.13", asset_type="infrastructure", status="active"),
        # a subdomain whose apex is NOT in inventory — left unlinked, not invented
        ITAsset(id=5, tenant_id=TENANT, name="api.example.com", host_name="api.example.com", fqdn="api.example.com",
                ip_address="1.2.3.4", asset_type="infrastructure", status="active"),
    ])
    s.flush()
    yield s
    s.close()


def test_registrable_domain():
    assert registrable_domain("ftp.liztek.ca") == "liztek.ca"
    assert registrable_domain("liztek.ca") == "liztek.ca"
    assert registrable_domain("foo.bar.co.uk") == "bar.co.uk"   # two-level ccTLD
    assert registrable_domain("162.244.93.14") is None          # IP, not a domain
    assert registrable_domain("DESKTOP-CE3EFJB") is None        # bare host
    assert registrable_domain(None) is None


def test_subdomains_link_to_apex_including_different_ip(db):
    n = link_domain_hierarchy(db, TENANT)
    assert n == 2  # ftp + mta-sts → liztek.ca; example.com apex absent; desktop skipped
    edges = db.query(AssetRelationship).filter(
        AssetRelationship.relationship_type == "subdomain_of").all()
    pairs = {(e.source_asset_id, e.target_asset_id) for e in edges}
    assert pairs == {(2, 1), (3, 1)}  # mta-sts (different IP) still a child of the apex


def test_ips_and_fields_are_never_mutated(db):
    before = {a.id: (a.ip_address, a.host_name, a.fqdn) for a in db.query(ITAsset).all()}
    link_domain_hierarchy(db, TENANT)
    after = {a.id: (a.ip_address, a.host_name, a.fqdn) for a in db.query(ITAsset).all()}
    assert before == after  # purely additive — no asset column changed


def test_apex_and_non_domain_get_no_parent(db):
    link_domain_hierarchy(db, TENANT)
    for src in (1, 4, 5):  # apex itself, bare NetBIOS host, apex-less subdomain
        assert db.query(AssetRelationship).filter(
            AssetRelationship.source_asset_id == src).count() == 0


def test_idempotent(db):
    assert link_domain_hierarchy(db, TENANT) == 2
    assert link_domain_hierarchy(db, TENANT) == 0  # re-run writes nothing new
