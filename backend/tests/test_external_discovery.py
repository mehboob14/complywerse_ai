"""Stage 2 — EASM external (outside-in) discovery wiring.

DB-free, matching tests/test_asset_discovery.py: assert the new vocab, the domain
scope validation, the executor's external-job field mapping, and the resolver
carve-out ROUTING — the logic that turns a domain seed into internet-facing
assets. The full DB round-trip is exercised separately against a tenant DB.
"""
import types

import pytest

from grc.models._47_asset_discovery_models import DISCOVERY_METHODS, SCOPE_KINDS


def test_external_vocab_present():
    assert "external" in DISCOVERY_METHODS
    assert "domain" in SCOPE_KINDS


def test_validate_scope_accepts_domains_rejects_junk():
    from fastapi import HTTPException
    from grc.modules.asset_discovery.router import _validate_scope
    for good in ("example.com", "sub.example.com", "a.b.c.co.uk", "EXAMPLE.com"):
        _validate_scope("domain", good)  # no exception = accepted
    for bad in ("https://example.com", "example.com/path", "localhost",
                "-bad.com", "bad-.com", "x y.com", "x..y.com"):
        with pytest.raises(HTTPException):
            _validate_scope("domain", bad)


class _FakeDB:
    """Records add()s; flush() is a no-op. Enough for _run_external_job, which
    only touches the session through those two calls."""
    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass


def test_run_external_job_maps_findings_to_observations(monkeypatch):
    from grc.modules.asset_discovery.services import external_collect, executor
    # Two findings, no network: one resolved, one name-only (no A record).
    fake = [
        {"source": "external", "fqdn": "www.example.com", "host_name": "www.example.com",
         "ip_address": "203.0.113.5", "mac_address": None,
         "raw": {"source_system": "external", "external_id": "www.example.com",
                 "internet_facing": True, "evidence": ["crt.sh"], "resolved": True}},
        {"source": "external", "fqdn": "old.example.com", "host_name": "old.example.com",
         "ip_address": None, "mac_address": None,
         "raw": {"source_system": "external", "external_id": "old.example.com",
                 "internet_facing": True, "evidence": ["crt.sh"], "resolved": False}},
    ]
    monkeypatch.setattr(external_collect, "collect_domain", lambda domain, **kw: fake)

    db = _FakeDB()
    run = types.SimpleNamespace(tenant_id=1, id=7)
    job = types.SimpleNamespace(status=None, started_at=None, attempts=0,
                                hosts_seen=None, finished_at=None, id=3)
    scope = types.SimpleNamespace(value="example.com", kind="domain")

    seen = executor._run_external_job(db, run, job, scope)

    assert seen == 2
    assert job.status == "succeeded" and job.hosts_seen == 2
    assert len(db.added) == 2
    first = db.added[0]
    assert first.source == "external"            # not the sweep's hardcoded "cidr"
    assert first.fqdn == "www.example.com"       # the column the sweep leaves NULL
    assert first.ip_address == "203.0.113.5"
    assert first.resolution == "pending"
    # a name with no A record is still recorded as evidence, ip left null
    assert db.added[1].fqdn == "old.example.com"
    assert db.added[1].ip_address is None


def _obs(**kw):
    base = dict(resolution="pending", tenant_id=1, source="external",
                host_name="www.example.com", ip_address=None, fqdn="www.example.com",
                mac_address=None, raw={}, id=11, resolved_asset_id=None,
                resolution_note=None)
    base.update(kw)
    return types.SimpleNamespace(**base)


def test_external_no_match_becomes_internet_facing_asset(monkeypatch):
    from grc.modules.asset_discovery.services import resolver
    monkeypatch.setattr(resolver, "_candidates", lambda db, tid, obs: ("", []))
    monkeypatch.setattr(resolver, "_prior_ignored", lambda db, tid, obs: False)
    fake_asset = types.SimpleNamespace(id=99, internet_facing=False)
    monkeypatch.setattr(resolver, "manual_adopt", lambda db, obs: fake_asset)
    marked = {}
    monkeypatch.setattr(resolver, "_mark_internet_facing",
                        lambda asset: marked.setdefault("asset", asset))

    result = resolver.resolve_observation(object(), _obs(source="external"))

    assert result["action"] == "created"
    assert result["asset_id"] == 99 and result.get("external") is True
    assert marked.get("asset") is fake_asset  # exposure flag + criticality re-rate invoked


def test_internal_no_match_still_waits_for_a_login(monkeypatch):
    from grc.modules.asset_discovery.services import resolver
    monkeypatch.setattr(resolver, "_candidates", lambda db, tid, obs: ("", []))
    monkeypatch.setattr(resolver, "_prior_ignored", lambda db, tid, obs: False)
    # If the carve-out mis-fired for an internal sweep hit, this would be called.
    monkeypatch.setattr(resolver, "manual_adopt",
                        lambda db, obs: pytest.fail("internal obs must NOT be auto-adopted"))

    result = resolver.resolve_observation(object(), _obs(source="cidr", raw={}))

    assert result["action"] == "unclaimed"


def test_mark_internet_facing_writes_both_exposure_columns():
    """Regression guard for the two-column split: exploitability reads
    is_internet_facing first (it's NOT NULL, never falls through), so writing
    only internet_facing would misreport an EASM asset as not exposed. The
    criticality recompute inside is wrapped in try/except, so it can't affect the
    flag writes even on this attribute-light stub."""
    from grc.modules.asset_discovery.services import resolver
    asset = types.SimpleNamespace(internet_facing=False, is_internet_facing=False,
                                  criticality=None, criticality_score=None)
    resolver._mark_internet_facing(asset)
    assert asset.internet_facing is True
    assert asset.is_internet_facing is True


def test_collect_domain_raises_when_all_sources_fail(monkeypatch):
    """A scan where every keyless source errors must FAIL, not report 0 findings —
    a silent empty result reads as 'no external surface' in a security tool. Both
    crt.sh AND its Certspotter fallback must be down for the guard to trip."""
    from grc.modules.asset_discovery.services import external_collect as ec

    def _boom(domain, **kw):
        raise RuntimeError("source down")

    monkeypatch.setattr(ec, "fetch_crtsh", _boom)
    monkeypatch.setattr(ec, "fetch_certspotter", _boom)  # keyless CT fallback also down
    with pytest.raises(RuntimeError):
        ec.collect_domain("example.com", resolve=False)


def test_collect_domain_empty_result_is_not_a_failure(monkeypatch):
    """crt.sh reachable but returning zero names is a legitimate empty surface —
    it returns [], never raises."""
    from grc.modules.asset_discovery.services import external_collect as ec

    monkeypatch.setattr(ec, "fetch_crtsh", lambda domain, **kw: [])
    assert ec.collect_domain("example.com", resolve=False) == []


def test_fetch_crtsh_retries_transient_502s(monkeypatch):
    """crt.sh 502s on valid queries constantly; a transient blip must not fail a
    keyless run, so fetch_crtsh retries with backoff before giving up."""
    from grc.modules.asset_discovery.services import external_collect as ec

    calls = {"n": 0}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"name_value": "www.example.com"}]

    def _get(url, **kw):
        calls["n"] += 1
        if calls["n"] < 2:
            raise ec.requests.exceptions.HTTPError("502 Bad Gateway")
        return _Resp()

    monkeypatch.setattr(ec.requests, "get", _get)
    monkeypatch.setattr(ec.time, "sleep", lambda _s: None)  # no real backoff delay
    rows = ec.fetch_crtsh("example.com")
    assert calls["n"] == 2                       # failed once, retried, succeeded
    assert rows == [{"name_value": "www.example.com"}]


def test_external_asset_risk_shape_is_dashboard_safe():
    """Regression for the dashboard-wide crash: compute_tenant_posture's rollup
    read r["components"]["cis"] for EVERY asset, which KeyError'd on EXTERNAL
    assets (their risk carries tls/headers/transport/email/vuln — never the
    internal cis/cia/ctrl/risk keys) and took down the whole tenant's risk-posture
    page. This pins the external-risk contract the rollup now reads defensively
    (.get() chains) — see compute_tenant_posture in risk_posture/service.py.
    """
    from grc.modules.risk_posture.service import _compute_easm_risk

    asset = types.SimpleNamespace(
        id=1, name="liztek.ca", host_name="liztek.ca", ip_address=None,
        fqdn="liztek.ca", asset_type="web", criticality="medium",
        owner_name=None, internet_facing=True,
    )
    probe = {"health": {"score": 52, "grade": "F", "reason": "weak TLS + no headers",
             "components": {
                 "tls":       {"score": 0.40, "weight": 0.25, "detail": "TLS1.2, 20d to expiry"},
                 "headers":   {"score": 0.00, "weight": 0.25, "detail": "0/6 present"},
                 "transport": {"score": 1.00, "weight": 0.15, "detail": "HTTPS ok"},
                 "email":     {"score": 0.50, "weight": 0.15, "detail": "SPF, no DMARC"},
                 "vuln":      {"score": 0.80, "weight": 0.20, "detail": "1 finding"},
             }}}

    r = _compute_easm_risk(asset, probe)

    assert r["mode"] == "easm"
    # external components only — the internal model's keys are structurally absent
    assert set(r["components"]) == {"tls", "headers", "transport", "email", "vuln"}
    # the exact crash the dashboard hit, and the defensive read that neutralises it
    with pytest.raises(KeyError):
        _ = r["components"]["cis"]
    for k in ("cis", "cia", "ctrl", "risk"):
        assert (r["components"].get(k) or {}).get("pass_rate") is None
    # a real 0..100 risk score falls out (health .40/.00/1.0/.50/.80 → risk 51.5)
    assert isinstance(r["score"], float) and 0.0 <= r["score"] <= 100.0
    assert r["band"]["label"]
