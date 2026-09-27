"""Breach alerts worked like cases, researched from their own sources.

An alert moves new → investigating → confirmed or not relevant → closed; each
move is audited with its note, and moving on from new takes it off the
attention queue. Not relevant remembers the articles. The AI reads only public
pages behind the alert and its answer is cleaned before it is kept. New
known-exploited vulnerabilities in software seen on an estate raise unverified
alerts.
"""
import json
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAAuditLog, TPRAMonitoringSignal, TPRASignalRejection, TPRASurfaceScan, Vendor, get_db,
)
from grc.modules.vendor_risk.tpra import alerts, attention, monitoring, rbac
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow().replace(microsecond=0)
ARTICLES = [{"url": "https://news-a.test/payroll-breach", "title": "Payroll Co confirms breach", "domain": "news-a.test"},
            {"url": "https://news-b.test/p", "title": "Payroll Co hit by ransomware", "domain": "news-b.test"}]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7,
                 description="Runs our payroll", data_access_level="confidential", data_types_accessed=["employee PII"]))
    s.add(TPRAMonitoringSignal(id=1, tenant_id=1, vendor_id=1, signal_type="breach", severity="high",
                               source="GDELT news", title="Payroll Co confirms breach", occurred_at=NOW,
                               sources=ARTICLES))
    s.add(TPRAMonitoringSignal(id=2, tenant_id=1, vendor_id=1, signal_type="cert_expiry", severity="low",
                               title="Not an alert", occurred_at=NOW))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(alerts.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _queue(db):
    return {i["record_id"] for i in attention.open_items(db, 1, NOW.date(), {}) if i["record_type"] == "signal"}


def test_an_alert_is_worked_from_new_to_closed(db, client, monkeypatch):
    board = client.get("/alerts").json()
    assert [(i["id"], i["status"]) for i in board["items"]] == [(1, "new")] and board["counts"]["new"] == 1
    assert 1 in _queue(db)
    assert client.post("/alerts/1/move", json={"status": "closed", "note": "done"}).status_code == 400
    picked = client.post("/alerts/1/move", json={"status": "investigating"}).json()
    assert picked["status"] == "investigating" and picked["owner"]["name"] == "Ana Lyst"
    assert 1 not in _queue(db)                                              # acknowledged: off the queue
    assert client.post("/alerts/1/move", json={"status": "confirmed"}).status_code == 400    # a decision says why
    monkeypatch.setattr(monitoring, "raise_finding", lambda db, sig, v, actor: SimpleNamespace(id=55))
    confirmed = client.post("/alerts/1/move", json={"status": "confirmed", "note": "Supplier confirmed it by phone",
                                                   "raise_finding": True}).json()
    assert confirmed["finding_id"] == 55 and confirmed["moves"] == ["closed", "investigating"]
    client.post("/alerts/1/move", json={"status": "closed", "note": "Notified affected staff"})
    detail = client.get("/alerts/1").json()
    assert detail["status"] == "closed" and detail["supplier"]["data_types"] == ["employee PII"]
    assert [(h["from"], h["to"], h["note"]) for h in reversed(detail["history"])] == [
        ("new", "investigating", None), ("investigating", "confirmed", "Supplier confirmed it by phone"),
        ("confirmed", "closed", "Notified affected staff")]
    assert client.get("/alerts/2").status_code == 404                     # a certificate lapse is not an alert


def test_not_relevant_remembers_the_articles_and_keeps_the_alert(db, client):
    moved = client.post("/alerts/1/move", json={"status": "not_relevant", "note": "A different Payroll Co, in Canada"})
    assert moved.status_code == 200
    assert db.query(TPRASignalRejection).filter_by(vendor_id=1).count() == 2
    assert db.get(TPRAMonitoringSignal, 1).deleted_at is None
    assert client.get("/alerts", params={"status": "not_relevant"}).json()["items"][0]["id"] == 1


def test_alerts_from_before_triage_read_sensibly():
    sig = lambda **kw: TPRAMonitoringSignal(**{"acknowledged": False, "triage_status": None, **kw})
    assert alerts.status_of(sig()) == "new"
    assert alerts.status_of(sig(acknowledged=True)) == "closed"            # cleared in the Signals feed
    assert alerts.status_of(sig(acknowledged=True, triage_status="new")) == "closed"
    assert alerts.status_of(sig(acknowledged=True, triage_status="confirmed")) == "confirmed"


class _Page:
    def __init__(self, code=200, body=b"", headers=None):
        self.status_code, self.body, self.headers, self.encoding = code, body, headers or {"Content-Type": "text/html"}, "utf-8"

    def iter_content(self, size):
        yield self.body

    def close(self):
        pass


def test_pages_are_read_only_from_public_addresses():
    public = lambda host: host.endswith(".test") and not host.startswith("intranet")
    html = b"<html><script>steal()</script><nav>menu</nav><p>Payroll Co said 40,000 records were taken.</p></html>"
    assert alerts.read_page("https://news-a.test/x", get=lambda *a, **k: _Page(body=html), public=public) == \
        "Payroll Co said 40,000 records were taken."
    assert alerts.read_page("http://intranet.test/admin", get=lambda *a, **k: pytest.fail("never fetched"), public=public) is None
    assert alerts.read_page("file:///etc/passwd", get=lambda *a, **k: pytest.fail("never fetched"), public=public) is None
    bounce = lambda *a, **k: _Page(302, headers={"Location": "http://intranet.test/secret"})
    assert alerts.read_page("https://news-a.test/x", get=bounce, public=public) is None       # a redirect is checked too


def test_the_ai_reads_the_sources_and_its_answer_is_cleaned(db):
    sig, vendor = db.get(TPRAMonitoringSignal, 1), db.get(Vendor, 1)
    asked = {}

    def complete(messages):
        asked["prompt"] = messages[1]["content"]
        return json.dumps({"summary": " Payroll Co   lost employee data. ", "about_this_supplier": "YES",
                           "affects_us": "certainly", "when": "2026-09-20T10:00", "data_involved": ["names", "bank details"],
                           "actions": ["Ask for the incident report"] * 7, "suggested_status": "confirmed"})

    found = alerts.research(sig, vendor, read=lambda url: "40,000 payroll records" if "news-a" in url else None,
                            complete=complete)
    assert "Runs our payroll" in asked["prompt"] and "40,000 payroll records" in asked["prompt"]
    assert "could not be read" in asked["prompt"]                          # the second article, headline only
    assert found["summary"] == "Payroll Co lost employee data." and found["about_this_supplier"] == "yes"
    assert found["affects_us"] == "unknown" and found["when"] == "2026-09-20" and len(found["actions"]) == 5
    assert found["sources_read"] == ["https://news-a.test/payroll-breach"]


def test_the_reading_is_kept_on_the_alert(db, client, monkeypatch):
    monkeypatch.setattr(alerts, "research", lambda sig, v: {"summary": "s", "suggested_status": "investigating",
                                                             "sources_read": []})
    assert client.post("/alerts/1/research").json()["by"] == "Ana Lyst"
    kept = client.get("/alerts/1").json()["research"]
    assert kept["summary"] == "s" and kept["by"] == "Ana Lyst"
    assert db.query(TPRAAuditLog).filter_by(entity="signal", action="research").count() == 1


def test_new_known_exploited_flaws_in_software_seen_on_an_estate_raise_unverified_alerts(db):
    assert feeds.tech_matches("Apache HTTP Server", {"vendor_project": "Apache", "product": "HTTP Server"})
    assert feeds.tech_matches("Microsoft IIS", {"vendor_project": "Microsoft", "product": "Internet Information Services (IIS)"})
    assert not feeds.tech_matches("PHP", {"vendor_project": "phpMyAdmin", "product": "phpMyAdmin"})
    assert not feeds.tech_matches("Apache HTTP Server", {"vendor_project": "Apache", "product": "Tomcat"})
    db.add(TPRASurfaceScan(tenant_id=1, vendor_id=1, status="done", started_at=NOW, hosts=[], findings=[],
                           technologies=[{"name": "Apache HTTP Server", "category": "Web server", "versions": ["2.4.49"],
                                          "hosts": ["payroll.test"], "evidence": "server"}]))
    db.commit()
    connector = feeds.TechnologyWatchConnector()
    connector.catalogue = lambda: {
        "CVE-2026-1001": {"vendor_project": "Apache", "product": "HTTP Server", "date_added": NOW - timedelta(days=1),
                          "short_description": "Path traversal.", "known_ransomware_campaign_use": "Known"},
        "CVE-2021-41773": {"vendor_project": "Apache", "product": "HTTP Server", "date_added": NOW - timedelta(days=400)},
        "CVE-2026-2002": {"vendor_project": "Microsoft", "product": "Exchange Server", "date_added": NOW},
    }
    drafts = connector.poll(db, db.get(Vendor, 1), NOW - timedelta(days=2), NOW)
    assert [(d.external_id, d.severity, d.verification["verified"]) for d in drafts] == [("kev-tech:CVE-2026-1001", "high", False)]
    assert "payroll.test" in drafts[0].detail and "version 2.4.49" in drafts[0].detail
