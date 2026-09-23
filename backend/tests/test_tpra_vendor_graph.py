"""The vendor graph: fourth parties, and how many vendors share one platform.

Concentration only means something when one platform's many spellings count as
one and generic names count as nothing, so names are folded through an alias
map the tenant can extend. A platform we also contract with directly is marked.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAAuditLog, TPRAFourthParty, TPRAPlatformAlias, Vendor, get_db,
)
from grc.modules.vendor_risk.tpra import graph, rbac
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Vendor, TPRAAuditLog, TPRAFourthParty, TPRAPlatformAlias]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(graph.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _vendors(db, *names, tier="medium"):
    rows = [Vendor(tenant_id=1, name=n, status="active", tier=tier) for n in names]
    db.add_all(rows)
    db.commit()
    return rows


def test_one_platform_many_spellings_and_generic_names_count_for_nothing():
    aliases = {}
    assert graph.platform_for("Amazon Web Services, Inc.", aliases) == "AWS"
    assert graph.platform_for("AWS", aliases) == "AWS"
    assert graph.platform_for("Office 365", aliases) == "Microsoft 365"
    assert graph.platform_for("Various", aliases) == ""
    assert graph.platform_for("Hetzner Online GmbH", aliases) == "Hetzner Online GmbH"


def test_concentration_counts_vendors_across_the_alias_set(db, http):
    payroll, crm, mail, other = _vendors(db, "Payroll Co", "CRM Co", "Mail Co", "Other Co")
    critical_co, = _vendors(db, "Critical Co", tier="critical")
    for vendor, name, critical in ((payroll, "Amazon Web Services", True), (crm, "AWS", False),
                                   (mail, "amazon aws", False), (critical_co, "Azure", False),
                                   (other, "Linux", False)):
        assert http.post(f"/tpra/vendors/{vendor.id}/fourth-parties",
                         json={"name": name, "service": "hosting", "critical": critical}).status_code == 201
    platforms = http.get("/tpra/concentration").json()["platforms"]
    assert [(p["platform"], p["vendor_count"], p["critical_count"]) for p in platforms] == [("AWS", 3, 1)]
    assert platforms[0]["vendors"][0]["name"] == "Payroll Co"          # the critical dependency first
    assert http.get("/tpra/concentration", params={"min_vendors": 1}).json()["platforms"][-1]["platform"] == "Azure"


def test_a_tenant_alias_refolds_what_is_already_recorded(db, http):
    a, b = _vendors(db, "A Co", "B Co")
    http.post(f"/tpra/vendors/{a.id}/fourth-parties", json={"name": "Hetzner Online GmbH"})
    http.post(f"/tpra/vendors/{b.id}/fourth-parties", json={"name": "Hetzner Cloud"})
    assert http.get("/tpra/concentration").json()["platforms"] == []
    http.post("/tpra/platform-aliases", json={"alias": "Hetzner Online GmbH", "platform": "Hetzner"})
    http.post("/tpra/platform-aliases", json={"alias": "Hetzner Cloud", "platform": "Hetzner"})
    assert [p["platform"] for p in http.get("/tpra/concentration").json()["platforms"]] == ["Hetzner"]
    excluded = http.post("/tpra/platform-aliases", json={"alias": "Hetzner Cloud", "excluded": True})
    assert excluded.json()["excluded"] is True
    assert http.get("/tpra/concentration").json()["platforms"] == []


def test_a_fourth_party_that_is_also_our_vendor_says_so(db, http):
    payroll, aws = _vendors(db, "Payroll Co", "Amazon Web Services")
    fp = http.post(f"/tpra/vendors/{payroll.id}/fourth-parties", json={"name": "amazon web services"}).json()
    assert fp["also_vendor_id"] == aws.id
    crm, = _vendors(db, "CRM Co")
    http.post(f"/tpra/vendors/{crm.id}/fourth-parties", json={"name": "AWS"})
    top = http.get("/tpra/concentration").json()["platforms"][0]
    assert top["platform"] == "AWS" and top["direct_vendor_id"] == aws.id


def test_the_register_is_audited_and_soft_deleted(db, http):
    vendor, = _vendors(db, "Payroll Co")
    fp = http.post(f"/tpra/vendors/{vendor.id}/fourth-parties",
                   json={"name": "Stripe", "service": "card payments", "data_shared": ["card data", " names "]}).json()
    assert fp["data_shared"] == ["card data", "names"] and fp["platform"] == "Stripe"
    assert http.put(f"/tpra/fourth-parties/{fp['id']}", json={"name": "Adyen"}).json()["platform"] == "Adyen"
    assert http.delete(f"/tpra/fourth-parties/{fp['id']}").status_code == 200
    assert http.get(f"/tpra/vendors/{vendor.id}/fourth-parties").json()["items"] == []
    assert [a.action for a in db.query(TPRAAuditLog)] == ["create", "update", "delete"]


# ── what breaks if a vendor fails ────────────────────────────────────────────

from datetime import datetime, timedelta  # noqa: E402

from grc.models import (  # noqa: E402
    BcmBiaDependency, BcmBiaRecord, BcmPlan, ControlRecordLink, Evidence, ITAsset, NormalizedControl,
    SCFControlState, SoftwareIdentifier, TPRAEvidenceLink, TPRAMonitoringCursor, TPRAMonitoringSignal,
    TPRASignalRejection, TPRATieringConfig, TPRAVendorLink, TPRAVendorProduct, VendorAssessment,
)
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds, service  # noqa: E402

_WIDE = _TABLES + [ITAsset, SoftwareIdentifier, BcmPlan, BcmBiaRecord, BcmBiaDependency, ControlRecordLink,
                   SCFControlState, NormalizedControl, TPRAVendorLink, TPRAVendorProduct, TPRAMonitoringSignal,
                   TPRAMonitoringCursor, TPRASignalRejection, TPRATieringConfig, Evidence, TPRAEvidenceLink,
                   VendorAssessment]


@pytest.fixture()
def wide(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _WIDE])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(service, "create_reassessment_version",
                        lambda db, vendor, **kw: type("A", (), {"id": 999})())
    app = FastAPI()
    app.include_router(graph.router)
    app.dependency_overrides[get_db] = lambda: s
    app.dependency_overrides[require_auth] = lambda: s.get(GRCUser, 7)
    s.http = TestClient(app)
    yield s
    s.close()


def test_a_vendor_page_names_what_depends_on_it(wide):
    db, http = wide, wide.http
    vendor, = _vendors(db, "Payroll Cloud Ltd")
    named = ITAsset(tenant_id=1, name="payroll-app", asset_type="application", vendor="Payroll Cloud",
                    detected_software_json=[{"name": "Payroll Agent", "publisher": "Payroll Cloud Limited"}])
    linked = ITAsset(tenant_id=1, name="hr-db", asset_type="infrastructure", vendor="Someone Else")
    other = ITAsset(tenant_id=1, name="mail", asset_type="application", vendor="Globex")
    db.add_all([named, linked, other])
    db.flush()
    db.add(SoftwareIdentifier(tenant_id=1, asset_id=other.id, identifier_type="cpe", vendor="payroll_cloud",
                              product="payroll_agent", identifier="cpe:2.3:a:payroll_cloud:payroll_agent:1.0"))
    control = NormalizedControl(code="C-PAY", name="Payroll data is reconciled", tenant_id=1)
    provided = NormalizedControl(code="IAC-01", scf_id="IAC-01", name="Identity and access management")
    db.add_all([control, provided])
    db.flush()
    db.add(ControlRecordLink(tenant_id=1, normalized_control_id=control.id, record_type="vendor", record_id=vendor.id))
    db.add(SCFControlState(tenant_id=1, scope_id=1, scf_id="IAC-01", provider_vendor_id=vendor.id,
                           inheritance_type="shared"))
    plan = BcmPlan(tenant_id=1, title="People operations")
    db.add(plan)
    db.flush()
    payroll = BcmBiaRecord(tenant_id=1, plan_id=plan.id, process_name="Pay staff", rto_hours=24, rpo_hours=4)
    hiring = BcmBiaRecord(tenant_id=1, plan_id=plan.id, process_name="Onboard hires", rto_hours=72)
    db.add_all([payroll, hiring])
    db.flush()
    db.add(BcmBiaDependency(tenant_id=1, bia_id=payroll.id, dependency_type="vendor", name="Payroll Cloud Limited",
                            external_bcp_status="requested"))
    db.commit()

    assert http.post(f"/tpra/vendors/{vendor.id}/links",
                     json={"target_type": "asset", "target_ids": [linked.id, 424242]}).status_code == 404
    assert http.post(f"/tpra/vendors/{vendor.id}/links",
                     json={"target_type": "asset", "target_ids": [linked.id], "relation": "hosts"}).json() == {"added": 1}
    assert http.post(f"/tpra/vendors/{vendor.id}/links",
                     json={"target_type": "asset", "target_ids": [linked.id]}).json() == {"added": 0}
    http.post(f"/tpra/vendors/{vendor.id}/links", json={"target_type": "bia_process", "target_ids": [hiring.id]})

    view = http.get(f"/tpra/vendors/{vendor.id}/impact").json()
    assert sorted((a["name"], a["linked"]) for a in view["assets"]) == [("hr-db", True), ("payroll-app", False)]
    assert view["assets_running_its_software"] == 2                  # a detected publisher and a CPE
    assert [(c["code"], c["how"].split(" (")[0]) for c in view["controls"]] == [
        ("C-PAY", "linked to this vendor"), ("IAC-01", "provided by this vendor")]
    assert [(p["process"], p["rto_hours"], p["vendor_bcp"]) for p in view["processes"]] == [
        ("Pay staff", 24, "requested"), ("Onboard hires", 72, None)]
    assert view["shortest_rto_hours"] == 24


def test_a_watched_product_raises_a_known_exploited_vulnerability_once(wide, monkeypatch):
    db, http = wide, wide.http
    payroll, payments = _vendors(db, "Payroll Cloud Ltd", "Payments Co")
    for vendor in (payroll, payments):
        assert http.post(f"/tpra/vendors/{vendor.id}/products",
                         json={"name": "Gateway", "cpe_vendor": "Acme Soft", "cpe_product": "gateway"}).status_code == 201
    assert http.post(f"/tpra/vendors/{payroll.id}/products",
                     json={"name": "Gateway", "cpe_vendor": "Acme Soft", "cpe_product": "gateway"}).status_code == 409
    now = datetime(2026, 9, 24, 9)
    catalogue = {
        "CVE-2026-1111": {"vendor_project": "Acme Soft", "product": "Gateway Server", "date_added": now - timedelta(days=2),
                          "vulnerability_name": "Acme Gateway auth bypass", "known_ransomware_campaign_use": "Unknown"},
        "CVE-2026-2222": {"vendor_project": "Acme Soft", "product": "Gateway", "date_added": now - timedelta(days=1),
                          "vulnerability_name": "Acme Gateway RCE", "known_ransomware_campaign_use": "Known"},
        "CVE-2026-3333": {"vendor_project": "Other Vendor", "product": "Gateway", "date_added": now},
        "CVE-2019-0001": {"vendor_project": "Acme Soft", "product": "Gateway", "date_added": now - timedelta(days=900)},
    }
    monkeypatch.setattr(feeds.ProductWatchConnector, "catalogue", staticmethod(lambda: catalogue))
    feeds.run_connectors(db, 1, now=now)
    feeds.run_connectors(db, 1, now=now + timedelta(days=1))
    db.commit()
    signals = db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.signal_type == "vulnerability").all()
    assert sorted((s.vendor_id, s.external_id, s.severity) for s in signals) == [
        (payroll.id, "kev:CVE-2026-1111", "medium"), (payroll.id, "kev:CVE-2026-2222", "high"),
        (payments.id, "kev:CVE-2026-1111", "medium"), (payments.id, "kev:CVE-2026-2222", "high")]

    shared = http.get("/tpra/concentration/vulnerabilities").json()["vulnerabilities"]
    assert {v["cve"]: sorted(x["name"] for x in v["vendors"]) for v in shared} == {
        "CVE-2026-1111": ["Payments Co", "Payroll Cloud Ltd"], "CVE-2026-2222": ["Payments Co", "Payroll Cloud Ltd"]}


def test_a_product_matches_by_vendor_then_product():
    product = TPRAVendorProduct(name="Gateway", cpe_vendor="acme_soft", cpe_product=None)
    assert feeds.product_matches(product, "Unrelated Name", {"vendor_project": "Acme Soft", "product": "Gateway Pro"})
    assert not feeds.product_matches(product, "Unrelated Name", {"vendor_project": "Acme Soft", "product": "Mailer"})
    whole_vendor = TPRAVendorProduct(name="", cpe_vendor=None, cpe_product=None)
    assert feeds.product_matches(whole_vendor, "Acme Soft Ltd", {"vendor_project": "Acme Soft", "product": "Anything"})
