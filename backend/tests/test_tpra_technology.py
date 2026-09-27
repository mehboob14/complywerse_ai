"""What suppliers run, read from outside: detected, versioned, searched and counted.

A probe keeps the technologies a response shows; a scan adds the mail and DNS
providers a domain's records name and the software Shodan has seen, flags
versions out of support, and keeps one list per scan. "Who runs X?" answers from
scans and from the fourth-party register through the same aliases, and
concentration counts platforms seen from outside next to declared ones.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAFourthParty, TPRASurfaceScan, TPRASurfaceWaiver, Vendor, get_db
from grc.modules.asset_discovery.services import external_probe
from grc.modules.vendor_risk.tpra import graph, outside_in, technology
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow().replace(microsecond=0)


class _Resp:
    status_code = 200
    url = "https://payroll.test/"
    text = '<html><head><title>Payroll</title><script src="/js/jquery-1.12.4.min.js"></script></head></html>'
    content = text.encode()
    elapsed = timedelta(milliseconds=120)
    headers = {"Server": "Apache/2.4.58", "X-Powered-By": "PHP/7.4.33", "cf-ray": "8b1"}
    raw = None


def test_the_probe_keeps_what_a_response_shows(monkeypatch):
    monkeypatch.setattr(external_probe.requests, "get", lambda *a, **k: _Resp())
    for name in ("_probe_tls", "_probe_dns"):
        monkeypatch.setattr(external_probe, name, lambda *a, **k: None)
    facts = external_probe.probe_asset("payroll.test", extras=False)
    assert {t["name"]: t["version"] for t in facts["technologies"]} == {
        "Apache HTTP Server": "2.4.58", "PHP": "7.4.33", "Cloudflare": None, "jQuery": "1.12.4"}


def _facts(fqdn, tech=(), **kw):
    return {"fqdn": fqdn, "live": True, "scheme": "https", "https_available": True, "redirected_to_https": True,
            "security_headers": {"hsts": "1", "csp": "1", "x_frame_options": "1", "x_content_type_options": "1"},
            "tls_not_after": (NOW + timedelta(days=200)).isoformat(), "tls_days_to_expiry": 200, "tls_version": "TLSv1.3",
            "tls_key": "RSA 2048", "technologies": list(tech), "dns_mx": [], "dns_ns": [], **kw}


def test_a_scan_lists_what_hosts_run_and_flags_what_is_out_of_date():
    php = {"name": "PHP", "category": "Language", "version": "7.4.33", "evidence": "x-powered-by"}
    wp = {"name": "WordPress", "category": "CMS", "version": None, "evidence": "html"}
    probed = {"payroll.test": _facts("payroll.test", [php, wp], dns_mx=["10 payroll-test.mail.protection.outlook.com."],
                                     dns_ns=["ns-12.awsdns-01.com."]),
              "www.payroll.test": _facts("www.payroll.test", [dict(php, version="8.3.2"), wp])}
    hosts, findings = outside_in.scan_facts(
        ["payroll.test"], sources={"shodan": {"api_key": "k"}}, collect=lambda d, s: [],
        resolve=lambda n: {"payroll.test": ["10.0.0.1"], "www.payroll.test": ["10.0.0.2"]}.get(n, []),
        probe=lambda fqdn, ip: probed[fqdn], kev=lambda: set(),
        shodan=lambda ip, key: {"ports": [22], "vulns": {}, "products": [
            {"name": "OpenSSH", "category": "Service", "version": "7.4", "evidence": "Shodan, port 22"}]})
    assert [f["key"] for f in findings if f["category"] == "software"] == ["outdated:PHP"]
    assert next(f for f in findings if f["key"] == "outdated:PHP")["host"] == "payroll.test"
    seen = {t["name"]: t for t in outside_in.technologies(hosts)}
    assert set(seen) == {"PHP", "WordPress", "Microsoft 365", "Amazon Route 53", "OpenSSH"}
    assert seen["PHP"]["versions"] == ["7.4.33", "8.3.2"] and seen["WordPress"]["hosts"] == ["payroll.test", "www.payroll.test"]
    assert seen["Microsoft 365"]["category"] == "Email" and seen["OpenSSH"]["evidence"] == "Shodan, port 22"


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="owner", email="owner@acme.test", is_active=True))
    s.add_all([Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7),
               Vendor(id=2, tenant_id=1, name="Print Co", status="active", tier="low", owner_id=7),
               Vendor(id=3, tenant_id=1, name="Data Co", status="active", tier="high", owner_id=7),
               Vendor(id=4, tenant_id=1, name="Gone Co", status="offboarded", tier="high", owner_id=7)])
    tech = lambda name, category, versions=(), hosts=("a.test",): {
        "name": name, "category": category, "versions": list(versions), "hosts": list(hosts), "evidence": "html"}
    cve = {"key": "cve:CVE-2026-1111", "category": "vulns", "severity": "critical", "host": "a.test", "title": "x"}
    for vid, techs, findings in (
            (1, [tech("WordPress", "CMS", ["6.4"]), tech("Amazon CloudFront", "CDN"), tech("Microsoft 365", "Email"),
                 tech("jQuery", "JavaScript library", ["3.7.1"])], [cve]),
            (2, [tech("WordPress", "CMS", ["5.8"]), tech("jQuery", "JavaScript library", ["1.12.4"])], []),
            (4, [tech("WordPress", "CMS")], [cve])):
        s.add(TPRASurfaceScan(tenant_id=1, vendor_id=vid, status="done", started_at=NOW, finished_at=NOW, score=90,
                              grade="A", hosts=[], findings=findings, technologies=techs))
    s.add(TPRASurfaceScan(tenant_id=1, vendor_id=2, status="done", started_at=NOW - timedelta(days=30), finished_at=NOW,
                          hosts=[], findings=[cve], technologies=[tech("Drupal", "CMS")]))       # older: not read
    s.add(TPRAFourthParty(tenant_id=1, vendor_id=3, name="Amazon Web Services", platform="AWS", service="Hosting"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db):
    app = FastAPI()
    app.include_router(technology.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_search_by_technology_platform_and_vulnerability(db, client):
    body = client.get("/technologies").json()
    assert [(i["name"], i["vendors"], i["critical"]) for i in body["items"][:2]] == [("jQuery", 2, 1), ("WordPress", 2, 1)]
    assert "Drupal" not in {i["name"] for i in body["items"]} and body["scanned"] == 2
    assert [i["name"] for i in client.get("/technologies", params={"category": "CDN"}).json()["items"]] == ["Amazon CloudFront"]

    aws = client.get("/technologies/vendors", params={"name": "AWS"}).json()
    assert aws["platform"] == "AWS"
    assert [(r["vendor"]["name"], [s["name"] for s in r["seen"]], [f["name"] for f in r["fourth_parties"]])
            for r in aws["items"]] == [("Payroll Co", ["Amazon CloudFront"], []), ("Data Co", [], ["Amazon Web Services"])]
    wp = client.get("/technologies/vendors", params={"name": "wordpress"}).json()["items"]
    assert [r["vendor"]["name"] for r in wp] == ["Payroll Co", "Print Co"]            # not the offboarded one

    db.add(TPRASurfaceWaiver(tenant_id=1, vendor_id=1, finding_key="cve:CVE-2026-1111", reason="Patched, awaiting rescan",
                             expires_on=NOW.date() + timedelta(days=5)))
    db.commit()
    shown = client.get("/technologies/cve", params={"id": "cve-2026-1111"}).json()
    assert shown["id"] == "CVE-2026-1111"
    assert [(r["vendor"]["name"], r["hosts"], r["waived"]) for r in shown["items"]] == [("Payroll Co", ["a.test"], True)]
    assert client.get("/technologies/cve", params={"id": "not-a-cve"}).status_code == 422


def test_concentration_counts_platforms_seen_from_outside(db):
    groups = {g["platform"]: g for g in graph.concentration(db, 1, min_vendors=1)}
    aws = groups["AWS"]
    assert aws["vendor_count"] == 2
    assert {v["name"]: v["via"] for v in aws["vendors"]} == {
        "Payroll Co": ["seen from outside: Amazon CloudFront"], "Data Co": ["fourth party: Hosting"]}
    assert "Microsoft 365" in groups and not {"WordPress", "jQuery"} & set(groups)       # tools are not platforms
    assert "AWS" in {g["platform"] for g in graph.concentration(db, 1)}                  # two vendors: shown by default
