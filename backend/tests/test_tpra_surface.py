"""Outside-in security of suppliers: what their domains show, scored, waived and reported.

Findings come from what any visitor's browser sees (and Shodan's passive record
when a key is held); each weakness counts once per supplier, a category can
only take so much, and a waiver in date lifts the finding until it lapses. The
paid providers' scores land on one 0–100 scale, and the quarter's report covers
every critical supplier, rated or not.
"""
import json
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAExternalRating, TPRAMonitoringSignal, TPRASurfaceScan, TPRASurfaceWaiver,
    TPRATieringConfig, Vendor, get_db,
)
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds
from grc.modules.vendor_risk.tpra import outside_in, rating_feeds, rbac, reminders, reports, service
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow().replace(microsecond=0)
TODAY = NOW.date()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="owner", email="owner@acme.test", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7,
                 website="https://www.payroll.test/about", domains=["payroll-mail.test"]))
    s.commit()
    yield s
    s.close()


def _facts(fqdn, **kw):
    base = {"fqdn": fqdn, "live": True, "scheme": "https", "https_available": True, "redirected_to_https": True,
            "security_headers": {"hsts": "max-age=1", "csp": "x", "x_frame_options": "DENY", "x_content_type_options": "nosniff"},
            "tls_not_after": (NOW + timedelta(days=200)).isoformat(), "tls_expired": False, "tls_days_to_expiry": 200,
            "tls_version": "TLSv1.3", "tls_cipher": "TLS_AES_256_GCM_SHA384", "tls_key": "RSA 2048", "server": "nginx",
            "dns_mx": [], "spf": None, "dmarc": None, "set_cookies": []}
    base.update(kw)
    return base


def test_findings_come_from_what_a_browser_sees():
    keys = {f["key"]: f["severity"] for f in outside_in.host_findings(_facts(
        "old.payroll.test", tls_expired=True, tls_version="TLSv1", tls_key="RSA 1024", redirected_to_https=False,
        security_headers={}, server="Apache/2.4.1", set_cookies=["sid=1; Path=/"]))}
    assert keys == {"tls_expired": "high", "tls_old_protocol": "medium", "tls_short_key": "medium",
                    "no_https_redirect": "low", "no_hsts": "low", "missing_headers": "low", "version_disclosed": "low",
                    "cookie_flags": "low"}
    assert [f["key"] for f in outside_in.host_findings(_facts("plain.payroll.test", scheme="http", https_available=False,
                                                                tls_not_after=None))] == ["no_https"]
    mail = {f["key"]: f["severity"] for f in outside_in.email_findings(_facts("payroll.test", dns_mx=["mx.payroll.test"],
                                                                              spf="v=spf1 +all"))}
    assert mail == {"spf_allows_all": "high", "no_dmarc": "medium"}
    assert outside_in.email_findings(_facts("payroll.test", dns_mx=[])) == []        # no mail, nothing to spoof-check


def _f(key, severity, category="web", host="payroll.test"):
    return {"key": key, "severity": severity, "category": category, "host": host, "title": key}


def test_each_weakness_counts_once_a_category_is_capped_and_waivers_lift_it():
    findings = [_f("no_hsts", "low", host=h) for h in ("a.test", "b.test", "c.test")]
    findings += [_f("tls_expired", "high", "tls")]
    findings += [_f(f"cve:CVE-2026-000{i}", "critical", "vulns") for i in range(5)]
    base = outside_in.score(findings, [], TODAY)
    assert (base["score"], base["grade"]) == (100 - 2 - 15 - 40, "F")
    assert base["categories"]["vulns"] == 0 and base["categories"]["tls"] == 85
    waived = TPRASurfaceWaiver(finding_key="tls_expired", host=None, expires_on=TODAY + timedelta(days=30))
    assert outside_in.score(findings, [waived], TODAY)["score"] == 58
    lapsed = TPRASurfaceWaiver(finding_key="tls_expired", expires_on=TODAY - timedelta(days=1))
    revoked = TPRASurfaceWaiver(finding_key="tls_expired", expires_on=TODAY + timedelta(days=9), revoked_at=NOW)
    assert outside_in.score(findings, [lapsed, revoked], TODAY)["score"] == 43
    one_host = TPRASurfaceWaiver(finding_key="no_hsts", host="a.test", expires_on=TODAY + timedelta(days=9))
    assert outside_in.score(findings, [one_host], TODAY)["score"] == 43           # b and c still lack it


def test_a_scan_picks_hosts_and_adds_shodan_when_a_key_is_held():
    observed = {"payroll.test": [
        {"fqdn": "api.payroll.test", "raw": {"ip_addresses": ["10.0.0.3"]}},
        {"fqdn": "*.payroll.test", "raw": {"ip_addresses": ["10.0.0.9"]}},
        {"fqdn": "gone.payroll.test", "raw": {"ip_addresses": []}},
    ], "payroll-mail.test": []}
    resolved = {"payroll.test": ["10.0.0.1"], "www.payroll.test": ["10.0.0.2"], "payroll-mail.test": ["10.0.0.4"]}
    probed = {"payroll.test": _facts("payroll.test", dns_mx=["mx"], spf="v=spf1 -all", dmarc="v=DMARC1; p=none")}
    shodan = {"10.0.0.3": {"ports": [443, 3389], "vulns": {"CVE-2026-1111": {"cvss": 9.8}, "CVE-2026-2222": {"cvss": 5.0}}}}
    hosts, findings = outside_in.scan_facts(
        ["payroll.test", "payroll-mail.test"], sources={"shodan": {"api_key": "k"}},
        collect=lambda d, s: observed[d], resolve=lambda n: resolved.get(n, []),
        probe=lambda fqdn, ip: probed.get(fqdn, _facts(fqdn)),
        shodan=lambda ip, key: shodan.get(ip, {"ports": [], "vulns": {}}), kev=lambda: {"CVE-2026-1111"})
    assert [h["fqdn"] for h in hosts] == ["payroll.test", "www.payroll.test", "payroll-mail.test", "api.payroll.test"]
    got = {(f["key"], f["host"]): f["severity"] for f in findings}
    assert got == {("dmarc_monitor_only", "payroll.test"): "low", ("port:3389", "api.payroll.test"): "high",
                   ("cve:CVE-2026-1111", "api.payroll.test"): "critical", ("cve:CVE-2026-2222", "api.payroll.test"): "medium"}
    _, keyless = outside_in.scan_facts(["payroll.test"], sources={}, collect=lambda d, s: observed[d],
                                       resolve=lambda n: resolved.get(n, []), probe=lambda f, ip: _facts(f),
                                       shodan=lambda ip, key: pytest.fail("no key, no Shodan"))
    assert not [f for f in keyless if f["category"] in ("exposure", "vulns")]


def _scan_with(findings, hosts=None):
    hosts = hosts or [{"fqdn": "payroll.test", "live": True, "tls_expires": "2027-01-01"}]
    return lambda domains, sources=None: (hosts, findings)


def _complete(db, vendor, when, facts):
    scan = TPRASurfaceScan(tenant_id=1, vendor_id=1, status="running", started_at=when)
    db.add(scan)
    db.flush()
    return scan, outside_in.complete(db, scan, vendor, when, facts=facts, sources={})


def test_the_first_scan_is_a_baseline_and_later_ones_alert_on_what_is_new(db):
    vendor = db.get(Vendor, 1)
    assert outside_in.domains_for(vendor) == ["payroll.test", "payroll-mail.test"]
    found = [_f("tls_expired", "high", "tls"), _f("no_hsts", "low"), _f("cve:CVE-2026-7", "critical", "vulns")]
    scan, fresh = _complete(db, vendor, NOW, _scan_with(found))
    assert (scan.status, scan.score, scan.grade) == ("done", 53, "F")
    assert [f["key"] for f in fresh] == ["cve:CVE-2026-7"]                 # only critical alerts on the baseline
    rating = db.query(TPRAExternalRating).one()
    assert (rating.provider, rating.score, rating.grade) == (outside_in.PROVIDER, 53, "F")
    exposed = found + [_f("port:3389", "high", "exposure")]
    _, fresh = _complete(db, vendor, NOW + timedelta(days=8), _scan_with(exposed))
    assert [f["key"] for f in fresh] == ["port:3389"]
    _, fresh = _complete(db, vendor, NOW + timedelta(days=16), _scan_with(exposed))
    assert fresh == []
    quiet, _ = _complete(db, vendor, NOW + timedelta(days=17),
                         _scan_with([], hosts=[{"fqdn": "payroll.test", "live": False, "tls_expires": None}]))
    assert quiet.score is None and quiet.error == "Nothing answered at these domains"


def test_the_runner_scans_on_the_tier_cadence(db, monkeypatch):
    assert not feeds.SurfaceScanConnector().is_configured(db, 1)           # off until a tenant turns it on
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True, monitoring_policy={"outside_in": True}))
    db.commit()
    reopened = []
    monkeypatch.setattr(service, "create_reassessment_version",
                        lambda db, vendor, **kw: reopened.append(vendor.id) or type("A", (), {"id": 99})())
    monkeypatch.setattr(outside_in, "scan_facts", _scan_with([_f("port:2375", "critical", "exposure")]))
    feeds.run_connectors(db, 1, now=NOW)
    db.commit()
    assert db.query(TPRASurfaceScan).filter_by(status="done").count() == 1
    signal = db.query(TPRAMonitoringSignal).one()
    assert signal.source == outside_in.PROVIDER and signal.severity == "critical" and "2375" in signal.title
    assert reopened == [1]                                                   # a critical supplier, a critical finding
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=3))            # critical: weekly, not daily
    assert db.query(TPRASurfaceScan).count() == 1
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=8))
    db.commit()
    assert db.query(TPRASurfaceScan).count() == 2 and db.query(TPRAMonitoringSignal).count() == 1


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(outside_in, "_sources", lambda db, tid: {})
    app = FastAPI()
    app.include_router(outside_in.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_waivers_need_a_reason_an_end_and_a_real_finding(db, client):
    db.add(TPRASurfaceScan(tenant_id=1, vendor_id=1, status="done", started_at=NOW, finished_at=NOW, score=83, grade="B",
                           hosts=[], findings=[_f("tls_expired", "high", "tls"), _f("no_hsts", "low")]))
    db.commit()
    body = lambda **kw: {"finding_key": "tls_expired", "reason": "Certificate renewal is booked for next week",
                         "expires_on": (TODAY + timedelta(days=30)).isoformat(), **kw}
    assert client.post("/vendors/1/outside-in/waivers", json=body(reason="ok")).status_code == 400
    assert client.post("/vendors/1/outside-in/waivers", json=body(expires_on=(TODAY + timedelta(days=500)).isoformat())).status_code == 400
    assert client.post("/vendors/1/outside-in/waivers", json=body(finding_key="no_spf")).status_code == 400
    made = client.post("/vendors/1/outside-in/waivers", json=body())
    assert made.status_code == 201, made.text
    assert client.post("/vendors/1/outside-in/waivers", json=body()).status_code == 409
    view = client.get("/vendors/1/outside-in").json()
    assert view["latest"]["score"] == 98 and view["latest"]["scanned_score"] == 83
    assert next(f for f in view["latest"]["findings"] if f["key"] == "tls_expired")["waiver"]["state"] == "active"
    assert client.get("/outside-in").json()["items"][0]["waived"] == 1
    assert client.delete(f"/outside-in/waivers/{made.json()['id']}").status_code == 200
    assert client.get("/vendors/1/outside-in").json()["latest"]["score"] == 83

    soon = TPRASurfaceWaiver(tenant_id=1, vendor_id=1, finding_key="no_hsts", reason="Fixing it in the next release",
                             expires_on=TODAY + timedelta(days=10), created_by=7)
    db.add(soon)
    db.commit()
    notices = [n for n in reminders.due_notices(db, 1, TODAY, {}) if n.kind == "waiver_expiring"]
    assert [(n.subject_id, sorted(n.recipients)) for n in notices] == [(soon.id, [7])]


def test_domains_are_cleaned(db, client):
    assert client.put("/vendors/1/domains", json={"domains": ["not a domain"]}).status_code == 400
    saved = client.put("/vendors/1/domains", json={"domains": ["HTTPS://Mail.Payroll.test/x", "www.payroll.test"]}).json()
    assert saved == {"domains": ["payroll.test", "mail.payroll.test"], "extra_domains": ["mail.payroll.test"]}


class _Resp:
    def __init__(self, body, code=200):
        self.body, self.status_code = body, code

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def test_each_provider_lands_on_one_scale():
    creds = {"api_key": "k"}
    assert rating_feeds.upguard("a.test", creds, get=lambda *a, **k: _Resp({"score": 760})) == \
        {"score": 80.0, "native": 760.0, "grade": "B"}
    assert rating_feeds.upguard("a.test", creds, get=lambda *a, **k: _Resp({}, 404)) is None
    assert rating_feeds.securityscorecard("a.test", creds, get=lambda *a, **k: _Resp({"score": 87, "grade": "B"}))["score"] == 87.0
    answers = iter([_Resp({"results": [{"guid": "g-1", "name": "A"}]}),
                    _Resp({"ratings": [{"rating_date": "2026-08-01", "rating": 690}, {"rating_date": "2026-09-01", "rating": 705}]})])
    assert rating_feeds.bitsight("a.test", creds, get=lambda *a, **k: next(answers)) == {"score": 70.0, "native": 705.0, "grade": None}


def test_the_quarter_report_covers_every_critical_supplier(db):
    start, end = date(2026, 4, 1), date(2026, 6, 30)
    db.add(Vendor(id=2, tenant_id=1, name="Quiet Co", status="active", tier="critical", owner_id=7))
    db.add(Vendor(id=3, tenant_id=1, name="Minor Co", status="active", tier="low", owner_id=7, website="minor.test"))
    at = lambda d: datetime(d.year, d.month, d.day)
    db.add_all([
        TPRAExternalRating(tenant_id=1, vendor_id=1, provider=outside_in.PROVIDER, score=80, grade="B", captured_at=at(date(2026, 3, 20))),
        TPRAExternalRating(tenant_id=1, vendor_id=1, provider=outside_in.PROVIDER, score=74, grade="C", captured_at=at(date(2026, 5, 1))),
        TPRAExternalRating(tenant_id=1, vendor_id=1, provider=outside_in.PROVIDER, score=66, grade="D", captured_at=at(date(2026, 6, 1))),
        TPRAExternalRating(tenant_id=1, vendor_id=1, provider="UpGuard", score=75, grade="B", captured_at=at(date(2026, 5, 2))),
        TPRAExternalRating(tenant_id=1, vendor_id=3, provider=outside_in.PROVIDER, score=50, grade="F", captured_at=at(date(2026, 5, 2))),
        TPRASurfaceWaiver(tenant_id=1, vendor_id=1, finding_key="no_hsts", reason="Planned", expires_on=date(2026, 8, 1),
                          created_at=at(date(2026, 5, 3))),
    ])
    db.commit()
    content = reports.ratings_quarter(db, 1, start, end, date(2026, 7, 2))
    head = {h["label"]: h["value"] for h in content["headline"]}
    assert head["Rated in the period"] == "1 of 2" and head["Average outside-in score"] == 70.0
    assert head["Average UpGuard"] == 75.0 and head["Graded D or F"] == 1 and head["Waivers in force at the end"] == 1
    rated, unrated, _ = content["sections"]
    assert rated["columns"][6] == "UpGuard"
    assert rated["rows"] == [["Payroll Co", 2, 70.0, 66, "D", -14.0, 75.0, None, 1]]
    assert unrated["rows"] == [["Quiet Co", "Never", "No domain on record"]]
    assert json.dumps(content)                                              # frozen as JSON
