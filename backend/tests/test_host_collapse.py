"""Host-centric collapse — the guardrails are the point.

Locks the owner's rules: only EASM-born infrastructure names fold; a Windows/
Linux host (network sweep / connect) and co-located software (application
assets, own logins) are NEVER folded even on the same IP; unrelated domains on
one shared-hosting IP never merge (group key is ip+apex, not ip); different-IP
subdomains stay their own asset; finding links re-point with dedupe; idempotent.
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
    # f1 linked to primary AND to ftp (dup after re-point → must dedupe);
    # f2 linked only to ftp (must re-point to primary).
    s.add_all([
        VulnerabilityAssetLink(vulnerability_id=100, asset_id=1),
        VulnerabilityAssetLink(vulnerability_id=100, asset_id=2),
        VulnerabilityAssetLink(vulnerability_id=101, asset_id=2),
    ])
    s.flush()
    yield s
    s.close()


def test_plan_folds_only_easm_infra_names(db):
    plan = plan_host_collapse(db, TENANT)
    assert len(plan) == 1
    g = plan[0]
    assert g["primary"]["name"] == "liztek.ca"          # apex-named row wins
    assert {f["name"] for f in g["fold"]} == {"ftp.liztek.ca", "www.liztek.ca"}
    skipped = {x["name"]: x["reasons"] for x in g["skipped"]}
    assert "db.liztek.ca" in skipped and any("asset_type" in r for r in skipped["db.liztek.ca"])
    assert "win.liztek.ca" in skipped and any("origin_source" in r for r in skipped["win.liztek.ca"])


def test_collapse_execution_and_dedupe(db):
    out = collapse_hosts(db, TENANT)
    assert out["folded"] == 2
    # folded rows gone; guarded + different-machine + other-domain rows alive
    alive = {a.name for a in db.query(ITAsset).all()}
    assert alive == {"liztek.ca", "mta-sts.liztek.ca", "db.liztek.ca",
                     "win.liztek.ca", "other-company.com"}
    primary = db.get(ITAsset, 1)
    assert primary.dns_aliases == ["ftp.liztek.ca", "www.liztek.ca"]
    assert primary.ip_address == IP                       # identity untouched
    # links: f1 exactly once on primary (dup removed), f2 re-pointed to primary
    links = db.query(VulnerabilityAssetLink).all()
    assert {(l.vulnerability_id, l.asset_id) for l in links} == {(100, 1), (101, 1)}


def test_shared_hosting_domain_never_merges_across_apex(db):
    collapse_hosts(db, TENANT)
    other = db.query(ITAsset).filter(ITAsset.name == "other-company.com").one()
    assert other is not None and (other.dns_aliases or []) == []


def test_idempotent(db):
    assert collapse_hosts(db, TENANT)["folded"] == 2
    assert collapse_hosts(db, TENANT)["folded"] == 0
