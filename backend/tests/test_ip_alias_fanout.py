"""Same-IP alias fan-out for scanner findings.

When the scanner knew a host only by its bare IP, the finding belongs on every
machine-type asset carrying exactly that IP — six DNS names of one server are
one attack surface. The rule must NEVER pull in co-located software: an
application asset on the same IP (e.g. "PostgreSQL @ host") must not inherit
the host's findings, and a host the scanner knew by NAME links to exactly one
asset (name-first) with no fan-out at all.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ITAsset
from grc.modules.integrations.services.sync_service import SyncService

TENANT = 1
IP = "162.244.93.14"


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    ITAsset.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([
        ITAsset(id=1, tenant_id=TENANT, name="ftp.liztek.ca", host_name="ftp.liztek.ca",
                ip_address=IP, asset_type="infrastructure", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="www.liztek.ca", host_name="www.liztek.ca",
                ip_address=IP, asset_type="infrastructure", status="active"),
        ITAsset(id=3, tenant_id=TENANT, name="mail.liztek.ca", host_name="mail.liztek.ca",
                ip_address=IP, asset_type="cloud", status="active"),
        # co-located software on the SAME IP — must never be an alias target
        ITAsset(id=4, tenant_id=TENANT, name="PostgreSQL @ liztek", host_name=None,
                ip_address=IP, asset_type="application", status="active"),
        # different server entirely
        ITAsset(id=5, tenant_id=TENANT, name="mta-sts.liztek.ca", host_name="mta-sts.liztek.ca",
                ip_address="23.172.139.2", asset_type="infrastructure", status="active"),
        # same IP but another tenant
        ITAsset(id=6, tenant_id=99, name="other-tenant", host_name="x",
                ip_address=IP, asset_type="infrastructure", status="active"),
    ])
    s.flush()
    yield s
    s.close()


def test_aliases_are_machine_assets_on_the_exact_ip_only(db):
    ids = {a.id for a in SyncService._ip_alias_assets(db, TENANT, IP, primary_asset_id=1)}
    assert ids == {2, 3}  # infra + cloud siblings; never the app, other IP, other tenant


def test_primary_asset_is_excluded_from_its_own_aliases(db):
    assert all(a.id != 2 for a in SyncService._ip_alias_assets(db, TENANT, IP, primary_asset_id=2))


def test_application_assets_never_inherit_host_findings(db):
    assert all(
        a.asset_type != "application"
        for a in SyncService._ip_alias_assets(db, TENANT, IP, primary_asset_id=1)
    )
