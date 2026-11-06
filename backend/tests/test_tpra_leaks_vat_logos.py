"""Leaked credentials in public code, EU VAT numbers, and suppliers' logos.

A supplier's domains found in public code beside a credential word become
unverified breach alerts, linked and never copied; our own domains are searched
once a day into their own list, and ruling one out needs a reason. A VAT number
is checked with VIES, and its registered name compared with the supplier's. A
logo is fetched from the supplier's own site, never from an internal address,
kept, and lists only show what is kept.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAMonitoringSignal, TPRAOwnLeak, TPRATieringConfig, TPRAVendorLogo, Vendor, get_db,
)
from grc.modules.connectors.providers import code_search
from grc.modules.vendor_risk.tpra import leaks, logos, monitoring_policy, rbac, vat
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow().replace(microsecond=0)
ITEMS = {"items": [{"path": "config/.env", "html_url": "https://github.com/someone/app/blob/main/config/.env",
                    "repository": {"full_name": "someone/app"}, "text_matches": [{"fragment": "password=hunter2"}]}]}


class _Resp:
    def __init__(self, body=None, code=200, headers=None, content=b""):
        self.body, self.status_code, self.headers, self.content = body, code, headers or {}, content
        self.encoding = "utf-8"

    def json(self):
        return self.body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)

    def iter_content(self, size):
        yield self.content

    def close(self):
        pass


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co Ltd", status="active", tier="critical", owner_id=7,
                 website="https://payroll.example"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    for module in (leaks, vat, logos):
        monkeypatch.setattr(module, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    for r in (leaks.router, vat.router, logos.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_public_code_is_searched_and_linked_never_copied(db, monkeypatch):
    assert code_search.search("payroll.example", "t", get=lambda *a, **k: _Resp(ITEMS)) == [
        {"repository": "someone/app", "path": "config/.env", "url": "https://github.com/someone/app/blob/main/config/.env"}]
    assert code_search.search("payroll.example", "t", get=lambda *a, **k: _Resp({}, 422)) == []
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True, monitoring_policy={"leak_search": True}))
    db.commit()
    monkeypatch.setattr(leaks, "token", lambda db, tid: "t")
    real = code_search.search
    monkeypatch.setattr(code_search, "search", lambda domain, key, **kw: real(domain, key, get=lambda *a, **k: _Resp(ITEMS)))
    feeds.run_connectors(db, 1, now=NOW)
    db.commit()
    signal = db.query(TPRAMonitoringSignal).one()
    assert signal.signal_type == "breach" and signal.verified is False and "someone/app" in signal.title
    assert "hunter2" not in f"{signal.title} {signal.detail} {signal.sources}"      # the secret is not kept


def test_our_own_domains_are_searched_daily_and_ruled_out_with_a_reason(db, http, monkeypatch):
    with pytest.raises(ValueError):
        monitoring_policy.clean({"own_domains": ["not a domain"]}, None)
    assert monitoring_policy.clean({"own_domains": ["https://WWW.Acme.example/path"]}, None)["own_domains"] == ["acme.example"]
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             monitoring_policy={"leak_search": True, "own_domains": ["acme.example"]}))
    db.commit()
    monkeypatch.setattr(leaks, "token", lambda db, tid: "t")
    assert leaks.own_sweep(db, 1, get=lambda *a, **k: _Resp(ITEMS)) == {"new": 1, "failed": 0}
    assert leaks.own_sweep(db, 1, get=lambda *a, **k: _Resp(ITEMS)) is None               # once a day
    leak = db.query(TPRAOwnLeak).one()
    assert (leak.domain, leak.status) == ("acme.example", "new")
    assert http.post(f"/leaks/own/{leak.id}", json={"status": "dismissed"}).status_code == 400
    assert http.post(f"/leaks/own/{leak.id}", json={"status": "dismissed", "note": "A test fixture"}).json()["status"] == "dismissed"
    assert http.get("/leaks/own").json()["items"][0]["decided_by"] == "Ana Lyst"


def test_a_vat_number_is_checked_with_vies(db, http, monkeypatch):
    assert vat.split("de 123.456.789") == ("DE", "123456789") and vat.split("GR094014201") == ("EL", "094014201")
    with pytest.raises(ValueError):
        vat.split("US12345")
    body = {"valid": True, "name": "PAYROLL CO LIMITED", "address": "1 High St\nLondon", "userError": "VALID"}
    got = vat.check("DE123456789", post=lambda *a, **k: _Resp(body))
    assert (got["valid"], got["name"], got["address"]) == (True, "PAYROLL CO LIMITED", "1 High St London")
    with pytest.raises(vat.Unavailable):
        vat.check("DE123456789", post=lambda *a, **k: _Resp({"errorWrappers": [{"error": "MS_UNAVAILABLE"}]}))
    assert vat.name_matches("PAYROLL CO LIMITED", "Payroll Co Ltd") is True
    assert vat.name_matches("Someone Else GmbH", "Payroll Co Ltd") is False and vat.name_matches(None, "x") is None
    monkeypatch.setattr(vat, "check", lambda number: {**got, "vat_number": "DE123456789"})
    saved = http.post("/vendors/1/vat", json={"vat_number": "DE123456789"}).json()
    assert saved["name_matches"] is True and db.get(Vendor, 1).vat_check["valid"] is True


def test_a_logo_comes_from_the_suppliers_own_site_and_is_kept(db, http, monkeypatch):
    page = _Resp(code=200, headers={"Content-Type": "text/html"},
                 content=b'<html><head><link rel="icon" href="/static/logo.png"></head></html>')
    icon = _Resp(code=200, headers={"Content-Type": "image/png"}, content=b"\x89PNG....")
    asked = []
    get = lambda url, **kw: asked.append(url) or (page if url.endswith("/") else icon)  # noqa: E731
    assert logos.fetch("https://payroll.example", get=get, public=lambda h: True) == (b"\x89PNG....", "image/png")
    assert asked == ["https://payroll.example/", "https://payroll.example/static/logo.png"]
    assert logos.fetch("https://payroll.example", get=get, public=lambda h: False) is None     # an internal address
    big = _Resp(code=200, headers={"Content-Type": "image/png"}, content=b"x" * (logos.MAX_BYTES + 1))
    assert logos.fetch("payroll.example", get=lambda url, **kw: big, public=lambda h: True) is None

    fetched = []
    monkeypatch.setattr(logos, "fetch", lambda website: fetched.append(website) or (b"\x89PNG", "image/png"))
    assert http.get("/vendors/1/logo?cached_only=true").status_code == 204                   # lists never fetch
    first = http.get("/vendors/1/logo")
    assert first.status_code == 200 and first.content == b"\x89PNG" and fetched == ["https://payroll.example"]
    assert http.get("/vendors/1/logo").content == b"\x89PNG" and len(fetched) == 1            # kept
    assert db.query(TPRAVendorLogo).one().content_type == "image/png"
