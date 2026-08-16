"""P1 — backfill host-name linker: match findings to the asset they sit on.

Locks the matcher's behaviour, including the two that matter for real Nessus
data: an EXACT host match on the clean identity field, and the guarded
substring fallback (a finding on "DESKTOP-CE3EFJB" links to the asset named
"PostgreSQL 18 @ DESKTOP-CE3EFJB"). Plus idempotency and an honest unmatched
count — a host with no asset is reported, never silently dropped or invented.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import ITAsset, Vulnerability, VulnerabilityAssetLink
from grc.services.finding_asset_linker import backfill_host_links

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (ITAsset, Vulnerability, VulnerabilityAssetLink):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    _seed(s)
    yield s
    s.close()


def _seed(db):
    db.add_all([
        # the OS host (clean host_name) and an app asset whose NAME embeds the host
        ITAsset(id=1, tenant_id=TENANT, name="DESKTOP-CE3EFJB", host_name="DESKTOP-CE3EFJB",
                asset_type="server", status="active"),
        ITAsset(id=2, tenant_id=TENANT, name="PostgreSQL 18 @ DESKTOP-CE3EFJB",
                host_name=None, asset_type="application", status="active"),
        ITAsset(id=3, tenant_id=TENANT, name="web-01", host_name="web-01",
                ip_address="68.183.198.54", asset_type="server", status="active"),
    ])
    db.add_all([
        # exact host match → asset 1
        Vulnerability(id=10, tenant_id=TENANT, vuln_id="V-10", title="win", severity="high",
                      status="open", affected_host="DESKTOP-CE3EFJB"),
        # IP match → asset 3
        Vulnerability(id=11, tenant_id=TENANT, vuln_id="V-11", title="ip", severity="high",
                      status="open", affected_host="68.183.198.54"),
        # case-insensitive exact → asset 1 (not a second link)
        Vulnerability(id=12, tenant_id=TENANT, vuln_id="V-12", title="case", severity="low",
                      status="open", affected_host="desktop-ce3efjb"),
        # host with NO asset → unmatched, honestly counted
        Vulnerability(id=13, tenant_id=TENANT, vuln_id="V-13", title="ghost", severity="low",
                      status="open", affected_host="unknown-host-99"),
        # no host at all → skipped entirely
        Vulnerability(id=14, tenant_id=TENANT, vuln_id="V-14", title="nohost", severity="low",
                      status="open", affected_host=None),
    ])
    db.commit()


def test_backfill_links_by_host(db):
    r = backfill_host_links(db, TENANT, commit=True)
    assert r["assets"] == 3
    assert r["findings_with_host"] == 4          # 10,11,12,13 (14 has no host)
    assert r["matched"] == 3                      # 10,11,12
    assert r["newly_linked"] == 3
    assert r["unmatched"] == 1                     # 13 (unknown-host-99)

    # the exact/case matches both landed on asset 1
    links = {(l.vulnerability_id, l.asset_id) for l in db.query(VulnerabilityAssetLink).all()}
    assert (10, 1) in links
    assert (12, 1) in links                        # case-insensitive
    assert (11, 3) in links                        # IP match
    # provenance is honest: auto + host_match
    l = db.query(VulnerabilityAssetLink).filter_by(vulnerability_id=10).one()
    assert l.auto_linked is True and l.link_source == "host_match"


def test_substring_fallback_links_app_asset(db):
    # a finding whose host is DESKTOP-CE3EFJB also matches the app asset named
    # "PostgreSQL 18 @ DESKTOP-CE3EFJB" only via the guarded substring path —
    # but exact host_name wins first (asset 1). Prove the fallback works when
    # there is NO exact identity: a finding on a host only present in a name.
    db.add(ITAsset(id=4, tenant_id=TENANT, name="svc @ APPBOX-7", host_name=None,
                   asset_type="application", status="active"))
    db.add(Vulnerability(id=20, tenant_id=TENANT, vuln_id="V-20", title="app", severity="high",
                         status="open", affected_host="APPBOX-7"))
    db.commit()
    r = backfill_host_links(db, TENANT, commit=True)
    link = db.query(VulnerabilityAssetLink).filter_by(vulnerability_id=20).one()
    assert link.asset_id == 4                       # matched via name substring


def test_backfill_is_idempotent(db):
    backfill_host_links(db, TENANT, commit=True)
    first = db.query(VulnerabilityAssetLink).count()
    r2 = backfill_host_links(db, TENANT, commit=True)   # run again
    assert r2["newly_linked"] == 0
    assert r2["already_linked"] == 3
    assert db.query(VulnerabilityAssetLink).count() == first   # no duplicates


def test_assign_unmatched_to_chosen_asset(db):
    # the orphaned finding (13, host unknown-host-99) can't match — but an
    # operator assigns all unmatched to asset 1. It links there with the
    # manual_bulk provenance; the auto-matched ones keep their own asset.
    r = backfill_host_links(db, TENANT, commit=True, assign_unmatched_to_asset_id=1)
    assert r["assigned_unmatched"] == 1
    orphan = db.query(VulnerabilityAssetLink).filter_by(vulnerability_id=13).one()
    assert orphan.asset_id == 1
    assert orphan.link_source == "manual_bulk"
    # a host-matched finding is untouched by the override — keeps its real asset
    assert db.query(VulnerabilityAssetLink).filter_by(vulnerability_id=11).one().asset_id == 3


def test_assign_unmatched_ignores_foreign_asset(db):
    # an asset id that isn't in this tenant must NEVER receive links.
    r = backfill_host_links(db, TENANT, commit=True, assign_unmatched_to_asset_id=999)
    assert r["assigned_unmatched"] == 0
    assert db.query(VulnerabilityAssetLink).filter_by(vulnerability_id=13).first() is None


def test_dry_run_writes_nothing(db):
    r = backfill_host_links(db, TENANT, commit=False)
    # nothing committed; the staged adds are rolled back by not committing
    db.rollback()
    assert db.query(VulnerabilityAssetLink).count() == 0
    assert r["newly_linked"] == 3                    # but the report still says what WOULD link
