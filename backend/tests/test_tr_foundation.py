"""Thomson Reuters / LSEG integration — Phase 0 foundation tests.

HTTP resilience (retry / 429 / auth errors), per-tenant encrypted connections,
the connection router's RBAC, the shared signal-ingest path (manual behaviour
unchanged + external_id dedup), the tenant-aware connector sweep, and the World-
Check One HMAC signer. No network: httpx.MockTransport stands in for providers.
"""
import base64
import hashlib
import hmac

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, GRCUser, Role, Permission, RolePermission, UserRole,
    Vendor, VendorAssessment, TPRAStageInstance, TPRAMonitoringSignal, TPRAAuditLog,
    TPRATieringConfig, TPRARiskSnapshot, TPRAFinding, TPRARemediation, TPRARiskAcceptance,
    TRProviderConnection, TR_PROVIDER_WC1,
)
from grc.integrations_tr import http as trhttp, connections, wc1
from grc.integrations_tr import router as trrouter
from grc.modules.vendor_risk.tpra import service, monitoring_connectors as mc
from grc.modules.vendor_risk.tpra.monitoring_connectors import MonitoringConnector, SignalDraft

_TABLES = [
    Tenant, GRCUser, Role, Permission, RolePermission, UserRole, Vendor, VendorAssessment,
    TPRAStageInstance, TPRAMonitoringSignal, TPRAAuditLog, TPRATieringConfig, TPRARiskSnapshot,
    TPRAFinding, TPRARemediation, TPRARiskAcceptance, TRProviderConnection,
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def master_key(monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())


@pytest.fixture(autouse=True)
def _no_transport():
    yield
    trhttp.set_transport(None)


def _user(db, uid, admin=False):
    u = GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test")
    db.add(u)
    if admin:
        role = db.query(Role).filter(Role.name == "Administrator").first() or Role(name="Administrator")
        db.add(role)
        db.flush()
        db.add(UserRole(user_id=uid, role_id=role.id, tenant_id=1))
    db.commit()
    return u


def _vendor(db, **kw):
    d = dict(tenant_id=1, name="Acme Cloud", tier="high", status="active", owner_id=7,
             data_access_level="confidential", data_types_accessed=["PII"])
    d.update(kw)
    v = Vendor(**d)
    db.add(v)
    db.commit()
    return v


# ── HTTP resilience ──────────────────────────────────────────────────────────

def test_http_retries_429_honouring_retry_after():
    calls, sleeps = [], []

    def handler(req):
        calls.append(req)
        if len(calls) == 1:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(200, json={"ok": True})

    trhttp.set_transport(httpx.MockTransport(handler))
    resp = trhttp.request("GET", "https://example.test/x", sleep=sleeps.append)
    assert resp.json() == {"ok": True}
    assert len(calls) == 2 and sleeps == [2.0]


def test_http_regenerates_headers_each_attempt():
    seen = []
    counter = iter(range(10))

    def handler(req):
        seen.append(req.headers["X-Attempt"])
        return httpx.Response(503) if len(seen) == 1 else httpx.Response(200)

    trhttp.set_transport(httpx.MockTransport(handler))
    trhttp.request("GET", "https://example.test/x", headers=lambda: {"X-Attempt": str(next(counter))},
                   sleep=lambda s: None)
    assert seen == ["0", "1"]


def test_http_auth_failure_is_not_retried():
    calls = []
    trhttp.set_transport(httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(401, text="bad key")))
    with pytest.raises(trhttp.ProviderError) as ei:
        trhttp.request("GET", "https://example.test/x", sleep=lambda s: None)
    assert ei.value.status_code == 401 and not ei.value.retryable
    assert "credentials" in str(ei.value) and len(calls) == 1


def test_http_network_error_retries_then_raises_retryable():
    def handler(req):
        raise httpx.ConnectError("boom", request=req)

    trhttp.set_transport(httpx.MockTransport(handler))
    sleeps = []
    with pytest.raises(trhttp.ProviderError) as ei:
        trhttp.request("GET", "https://example.test/x", max_retries=2, sleep=sleeps.append)
    assert ei.value.retryable and sleeps == [1.0, 2.0]


def test_rate_limiter_waits_when_bucket_empty():
    lim = trhttp.RateLimiter(rate_per_sec=1.0, burst=1)
    waits = []
    lim.acquire("k", sleep=waits.append)
    assert waits == []
    # Second immediate acquire must wait; a fake sleep that doesn't advance the
    # clock would loop forever, so advance by patching the state instead.
    def fake_sleep(s):
        waits.append(s)
        lim._state["k"][0] = 1.0
    lim.acquire("k", sleep=fake_sleep)
    assert waits and waits[0] > 0


# ── Connections ──────────────────────────────────────────────────────────────

def test_simulated_connection_needs_no_credentials(db, monkeypatch):
    monkeypatch.delenv("CONNECTOR_MASTER_KEY", raising=False)
    conn = connections.upsert_connection(db, 1, TR_PROVIDER_WC1, mode="simulated")
    db.commit()
    out = connections.serialize(conn, TR_PROVIDER_WC1)
    assert out["configured"] and out["mode"] == "simulated"
    assert out["config"]["auto_screen_at_dd"] is True
    assert out["config"]["ongoing_screening_tiers"] == ["critical", "high"]


def test_storing_credentials_requires_master_key(db, monkeypatch):
    monkeypatch.delenv("CONNECTOR_MASTER_KEY", raising=False)
    with pytest.raises(connections.ConnectionError_):
        connections.upsert_connection(db, 1, TR_PROVIDER_WC1, credentials_in={"api_key": "k"})


def test_credentials_encrypted_write_only_and_blank_keeps(db, master_key):
    conn = connections.upsert_connection(db, 1, TR_PROVIDER_WC1, mode="live",
                                         credentials_in={"api_key": "KEY123", "api_secret": "SECRET456"})
    db.commit()
    assert "KEY123" not in (conn.encrypted_credentials or "")
    out = connections.serialize(conn, TR_PROVIDER_WC1)
    assert out["credentials_set"] == {"api_key": True, "api_secret": True}
    assert "KEY123" not in str(out) and "SECRET456" not in str(out)
    # Blank value keeps the stored secret.
    connections.upsert_connection(db, 1, TR_PROVIDER_WC1, credentials_in={"api_key": "", "api_secret": "NEW"})
    creds = connections.credentials(conn)
    assert creds == {"api_key": "KEY123", "api_secret": "NEW"}


def test_live_mode_requires_all_required_credentials(db, master_key):
    with pytest.raises(connections.ConnectionError_) as ei:
        connections.upsert_connection(db, 1, TR_PROVIDER_WC1, mode="live", credentials_in={"api_key": "k"})
    assert "API secret" in str(ei.value)


def test_rejects_non_https_base_url_and_unknown_fields(db):
    with pytest.raises(connections.ConnectionError_):
        connections.upsert_connection(db, 1, TR_PROVIDER_WC1, base_url_value="http://insecure.test")
    with pytest.raises(connections.ConnectionError_):
        connections.upsert_connection(db, 1, TR_PROVIDER_WC1, config_in={"nope": 1})


def test_router_requires_manage_permission_and_test_works_in_simulated(db):
    plain = _user(db, 10)
    admin = _user(db, 11, admin=True)
    with pytest.raises(HTTPException) as ei:
        trrouter.save_connection(TR_PROVIDER_WC1, trrouter.ConnectionIn(mode="simulated"), db=db, user=plain)
    assert ei.value.status_code == 403
    saved = trrouter.save_connection(TR_PROVIDER_WC1, trrouter.ConnectionIn(mode="simulated"), db=db, user=admin)
    assert saved["mode"] == "simulated"
    res = trrouter.test_connection(TR_PROVIDER_WC1, db=db, user=admin)
    assert res["ok"] is True and res["connection"]["status"] == "connected"
    listing = trrouter.list_connections(module="tprm", db=db, user=plain)
    assert {i["provider"] for i in listing["items"]} == {"lseg_world_check_one", "tr_clear"}


def test_router_bad_input_rolls_back_and_returns_400(db):
    admin = _user(db, 12, admin=True)
    with pytest.raises(HTTPException) as ei:
        trrouter.save_connection(TR_PROVIDER_WC1, trrouter.ConnectionIn(mode="bogus"), db=db, user=admin)
    assert ei.value.status_code == 400
    assert db.query(TRProviderConnection).count() == 0


# ── Signal ingest (shared by manual route + connectors) ──────────────────────

def test_manual_signal_route_behaviour_unchanged(db):
    from grc.modules.vendor_risk.tpra import api
    admin = _user(db, 20, admin=True)
    v = _vendor(db)
    r = api.create_signal(v.id, api.SignalIn(signal_type="sla", severity="low", title="late"), db=db, user=admin)
    assert r["triggered_reassessment_id"] is None
    assert r["signal"]["external_id"] is None and r["signal"]["simulated"] is False
    audit = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "signal").one()
    assert audit.extra == {"triggered_assessment_id": None}


def test_ingest_signal_dedups_by_external_id(db):
    v = _vendor(db)
    s1, t1, c1 = service.ingest_signal(db, v, signal_type="adverse_media", severity="medium",
                                       external_id="wc1:case:r1", simulated=True)
    s2, t2, c2 = service.ingest_signal(db, v, signal_type="adverse_media", severity="medium",
                                       external_id="wc1:case:r1", simulated=True)
    assert c1 is True and c2 is False and s1.id == s2.id
    assert db.query(TPRAMonitoringSignal).count() == 1


def test_ingest_signal_high_severity_triggers_reassessment(db):
    v = _vendor(db)
    service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    sig, triggered, created = service.ingest_signal(db, v, signal_type="sanctions", severity="critical",
                                                    external_id="x1")
    assert created and triggered is not None and sig.triggered_reassessment


class _FakeConnector(MonitoringConnector):
    provider = "fake"

    def __init__(self, drafts, fail=False):
        self.drafts, self.fail = drafts, fail

    def is_configured(self, db=None, tenant_id=None):
        return True

    def poll(self, db, tenant_id):
        if self.fail:
            raise RuntimeError("feed down")
        return self.drafts


def test_run_connectors_ingests_dedups_and_isolates_failures(db, monkeypatch):
    v = _vendor(db)
    good = _FakeConnector([SignalDraft(vendor_id=v.id, signal_type="adverse_media", severity="low",
                                       external_id="e1", source="Fake")])
    bad = _FakeConnector([], fail=True)
    monkeypatch.setattr(mc, "CONNECTORS", [bad, good])
    monkeypatch.setattr(mc, "_BUILTINS_LOADED", True)
    r1 = mc.run_connectors(db, 1)
    db.commit()
    assert r1["ingested"] == 1 and r1["errors"] == ["fake: RuntimeError"]
    r2 = mc.run_connectors(db, 1)
    assert r2["ingested"] == 0 and r2["duplicates"] == 1
    assert mc.any_connector_configured(db, 1) is True


def test_run_connectors_skips_foreign_tenant_vendor(db, monkeypatch):
    fake = _FakeConnector([SignalDraft(vendor_id=999, signal_type="breach", external_id="z")])
    monkeypatch.setattr(mc, "CONNECTORS", [fake])
    monkeypatch.setattr(mc, "_BUILTINS_LOADED", True)
    assert mc.run_connectors(db, 1)["ingested"] == 0


# ── World-Check One HMAC signing ─────────────────────────────────────────────

def test_wc1_string_to_sign_get_and_post():
    get = wc1.build_string_to_sign("GET", "api.test", "/v2/groups", "Tue, 07 Jun 2016 20:51:35 GMT", None)
    assert get == "(request-target): get /v2/groups\nhost: api.test\ndate: Tue, 07 Jun 2016 20:51:35 GMT"
    body = '{"a":1}'
    post = wc1.build_string_to_sign("POST", "api.test", "/v2/cases/screeningRequest", "D", body)
    assert post == ("(request-target): post /v2/cases/screeningRequest\nhost: api.test\ndate: D\n"
                    "content-type: application/json\ncontent-length: 7\n" + body)


def test_wc1_signature_verifies_with_secret():
    h = wc1.sign("KEY", "SECRET", "POST", "api.test", "/v2/cases", "D", '{"x":"é"}')
    assert h["Content-Length"] == str(len('{"x":"é"}'.encode()))
    expected = base64.b64encode(hmac.new(
        b"SECRET", wc1.build_string_to_sign("POST", "api.test", "/v2/cases", "D", '{"x":"é"}').encode(),
        hashlib.sha256).digest()).decode()
    assert f'signature="{expected}"' in h["Authorization"]
    assert 'keyId="KEY"' in h["Authorization"]
    assert 'headers="(request-target) host date content-type content-length"' in h["Authorization"]


def test_wc1_live_client_sends_signed_request_to_gateway_path():
    seen = {}

    def handler(req):
        seen["path"] = req.url.path
        seen["auth"] = req.headers["Authorization"]
        seen["date"] = req.headers["Date"]
        return httpx.Response(200, json=[{"id": "g1", "name": "Group", "children": [{"id": "g2", "name": "Sub"}]}])

    trhttp.set_transport(httpx.MockTransport(handler))
    client = wc1.WC1Client("https://api.test/v2", "KEY", "SECRET", limiter_key="t-live")
    groups = client.list_groups()
    assert [g["id"] for g in groups] == ["g1", "g2"]
    assert seen["path"] == "/v2/groups"
    expected = base64.b64encode(hmac.new(
        b"SECRET", wc1.build_string_to_sign("GET", "api.test", "/v2/groups", seen["date"], None).encode(),
        hashlib.sha256).digest()).decode()
    assert f'signature="{expected}"' in seen["auth"]
