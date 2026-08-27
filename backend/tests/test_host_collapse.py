"""Host-centric collapse — subdomains stay, only exact apex duplicates fold.

The reversed rule (owner request): every distinct subdomain (ftp/www/mta-sts.
liztek.ca) is kept as its own asset even on the apex's IP — they must show nested
under the apex, not folded away. Only a genuine DUPLICATE of the apex name on one
IP (a re-scan artifact) collapses, re-pointing its finding links with dedupe.
Still enforced: non-easm hosts and co-located software never fold; unrelated
domains on a shared IP never merge; idempotent.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import importlib

assets_router = importlib.import_module("grc.routers.assets_router")
from grc.models import (
    ITAsset, AssetRelationship, ComplianceAgent, Vulnerability, VulnerabilityAssetLink,
    AssetControlLink, AssetInternalControlLink, RiskAssetLink, AssetRiskAssessment,
    AssetFrameworkControlLink, AssetEvidenceLink, AssetSecurityComplianceSelection,
)
from grc.modules.asset_discovery.services.host_collapse import (
    plan_host_collapse, collapse_hosts,
)

TENANT = 1
IP = "162.244.93.14"


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://")
    for m in (ITAsset, AssetRelationship, ComplianceAgent, Vulnerability, VulnerabilityAssetLink,
              AssetControlLink, AssetInternalControlLink, RiskAssetLink, AssetRiskAssessment,
              AssetFrameworkControlLink, AssetEvidenceLink, AssetSecurityComplianceSelection):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    # The real purge sweeps 20+ prod tables; unit scope here is the collapse
    # logic itself. The live path is exercised by the delete endpoint daily.
    monkeypatch.setattr(assets_router, "_purge_asset_references", lambda db, asset: None)

    def infra(id, name, ip=IP, origin="easm", atype="infrastructure", parent=None):
        return ITAsset(id=id, tenant_id=TENANT, name=name, host_name=name, fqdn=name,
                       ip_address=ip, asset_type=atype, status="active",
                       origin_source=origin, parent_asset_id=parent)

    s.add_all([
        infra(1, "liztek.ca"),
        # a DUPLICATE apex row on the same IP (re-scan artifact) — the ONLY thing
        # that folds now; its links re-point to the primary with dedupe.
        infra(8, "liztek.ca"),
        # true subdomains on the apex's IP — kept as their own rows, NOT folded
        infra(2, "ftp.liztek.ca"),
        infra(3, "www.liztek.ca"),
        # different machine, same apex — must survive untouched
        infra(4, "mta-sts.liztek.ca", ip="23.172.139.2"),
        # co-located SOFTWARE on the same IP — the owner's Postgres rule
        infra(5, "db.liztek.ca", atype="application"),
        # a real HOST that happens to share the IP (origin ≠ easm) — never folds
        infra(6, "win.liztek.ca", origin="network_sweep"),
        # unrelated domain on the same shared-hosting IP — its own group
        infra(7, "other-company.com"),
    ])
    s.add_all([
        Vulnerability(id=100, tenant_id=TENANT, vuln_id="NS-1", title="f1", severity="info", status="open"),
        Vulnerability(id=101, tenant_id=TENANT, vuln_id="NS-2", title="f2", severity="info", status="open"),
    ])
    # f1 on primary AND the duplicate (dup after re-point → must dedupe);
    # f2 only on the duplicate (must re-point to primary).
    s.add_all([
        VulnerabilityAssetLink(vulnerability_id=100, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=100, asset_id=8),
        VulnerabilityAssetLink(vulnerability_id=101, asset_id=8),
    ])
    s.flush()
    yield s
    s.close()


def test_plan_folds_only_duplicate_apex_keeps_subdomains(db):
    plan = plan_host_collapse(db, TENANT)
    assert len(plan) == 1
    g = plan[0]
    assert g["primary"]["name"] == "liztek.ca"           # apex-named row wins
    assert [f["id"] for f in g["fold"]] == [8]           # ONLY the duplicate apex row
    skipped = {x["name"]: x["reasons"] for x in g["skipped"]}
    # subdomains are explicitly kept (new blocker), not folded
    assert any("subdomain" in r for r in skipped.get("ftp.liztek.ca", []))
    assert any("subdomain" in r for r in skipped.get("www.liztek.ca", []))
    # the original guardrails still hold
    assert any("asset_type" in r for r in skipped.get("db.liztek.ca", []))
    assert any("origin_source" in r for r in skipped.get("win.liztek.ca", []))


def test_collapse_keeps_subdomains_folds_duplicate_and_dedupes(db):
    out = collapse_hosts(db, TENANT)
    assert out["folded"] == 1                             # only the duplicate apex row
    alive = {a.name for a in db.query(ITAsset).all()}
    # every subdomain survives as its own row; only the dup apex (id 8) is gone
    assert alive == {"liztek.ca", "ftp.liztek.ca", "www.liztek.ca", "mta-sts.liztek.ca",
                     "db.liztek.ca", "win.liztek.ca", "other-company.com"}
    assert db.get(ITAsset, 8) is None
    primary = db.get(ITAsset, 1)
    assert primary.ip_address == IP                       # identity untouched
    # links: f1 exactly once on primary (dup removed), f2 re-pointed to primary
    links = {(l.vulnerability_id, l.asset_id) for l in db.query(VulnerabilityAssetLink).all()}
    assert links == {(100, 1), (101, 1)}


def test_shared_hosting_domain_never_merges_across_apex(db):
    collapse_hosts(db, TENANT)
    other = db.query(ITAsset).filter(ITAsset.name == "other-company.com").one()
    assert other is not None and (other.dns_aliases or []) == []


def test_idempotent(db):
    assert collapse_hosts(db, TENANT)["folded"] == 1
    assert collapse_hosts(db, TENANT)["folded"] == 0
