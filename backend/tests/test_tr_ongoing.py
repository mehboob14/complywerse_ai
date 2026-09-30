"""World-Check One ongoing screening → monitoring signals (Phase 2).

The connector registered in monitoring_connectors polls ongoing-screening
updates, upserts new matches and feeds them through the SAME signal-ingest path
as manual entry (dedup, reassessment trigger, audit)."""
import httpx
import pytest
from cryptography.fernet import Fernet

from grc.models import TPRAMonitoringSignal, TPRAScreeningMatch, TPRAScreeningSubject, TR_PROVIDER_WC1
from grc.integrations_tr import connections, http as trhttp
from grc.modules.vendor_risk.tpra import monitoring_connectors as mc, screening, screening_api, service
from grc.modules.vendor_risk.tpra.engine_monitoring import should_trigger_reassessment

from tests.test_tr_screening import db, _sim, _vendor, _user, _reset_transport  # noqa: F401 — fixtures


@pytest.fixture(autouse=True)
def _fresh_registry(monkeypatch):
    monkeypatch.setattr(mc, "CONNECTORS", [])
    monkeypatch.setattr(mc, "_BUILTINS_LOADED", False)


def test_builtin_connector_registered_and_tenant_aware(db):
    assert mc.any_connector_configured(db, 1) is False
    assert [c.provider for c in mc.CONNECTORS] == [TR_PROVIDER_WC1]
    _sim(db)
    assert mc.any_connector_configured(db, 1) is True
    assert mc.any_connector_configured() is False  # no tenant → never "configured"


def test_ongoing_update_creates_signal_and_triggers_reassessment(db):
    _sim(db)
    v = _vendor(db, name="Kestrel Maritime Holdings (ongoing)")
    a1 = service.ensure_active_assessment(db, v)
    screening.screen_vendor(db, v)
    db.commit()
    before = {m.id for m in db.query(TPRAScreeningMatch).all()}

    out = mc.run_connectors(db, 1)
    db.commit()
    assert out["ingested"] == 1 and out["errors"] == []
    sig = db.query(TPRAMonitoringSignal).one()
    assert sig.signal_type == "sanctions" and sig.severity == "critical"
    assert sig.simulated is True and sig.external_id.startswith("wc1:sim-case-")
    assert sig.source == "World-Check One (LSEG)"
    new_match = db.get(TPRAScreeningMatch, sig.source_ref["match_id"])
    assert new_match.id not in before and new_match.first_seen_via == "ongoing"
    assert new_match.resolution_status == "unresolved"
    # A new sanctions match auto-opens a reassessment through the existing engine.
    assert sig.triggered_reassessment and service.get_active_assessment(db, v).id != a1.id

    # The next sweep finds nothing new — no duplicate signal.
    again = mc.run_connectors(db, 1)
    assert again["ingested"] == 0
    assert db.query(TPRAMonitoringSignal).count() == 1


def test_no_signal_without_ongoing_updates(db):
    _sim(db)
    v = _vendor(db, name="Kestrel Maritime Holdings")
    screening.screen_vendor(db, v)
    assert mc.run_connectors(db, 1)["ingested"] == 0


def test_no_signal_when_ongoing_disabled(db):
    _sim(db)
    v = _vendor(db, name="Quiet Vendor (ongoing)", tier="low")  # low tier → ongoing off
    screening.screen_vendor(db, v)
    assert not any(s.ongoing_screening for s in db.query(TPRAScreeningSubject).all())
    assert mc.run_connectors(db, 1)["ingested"] == 0


def test_poll_failure_is_recorded_and_sweep_continues(db, monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())
    conn = connections.upsert_connection(db, 1, TR_PROVIDER_WC1, mode="live", base_url_value="https://wc1.test/v2",
                                         credentials_in={"api_key": "K", "api_secret": "S"},
                                         config_in={"group_id": "g"})
    db.commit()
    trhttp.set_transport(httpx.MockTransport(lambda r: httpx.Response(500, text="down")))
    monkeypatch.setattr("grc.integrations_tr.wc1._LIMITER", trhttp.RateLimiter(rate_per_sec=1000, burst=1000))
    out = mc.run_connectors(db, 1)
    assert out["ingested"] == 0 and out["errors"] == []
    assert conn.status == "error" and "Ongoing screening poll failed" in conn.last_error


def test_ongoing_cursor_advances(db):
    conn = _sim(db)
    assert "wc1_ongoing_cursor" not in (conn.cache or {})
    mc.run_connectors(db, 1)
    assert conn.cache["wc1_ongoing_cursor"].endswith("Z")


def test_sanctions_signal_always_triggers():
    assert should_trigger_reassessment("sanctions", "low") is True
    assert should_trigger_reassessment("pep", "medium") is False


def test_live_feeds_endpoint(db):
    admin = _user(db, 50, admin=True)
    assert screening_api.live_feeds(db=db, user=admin)["any_configured"] is False
    _sim(db)
    feeds = screening_api.live_feeds(db=db, user=admin)
    assert feeds["any_configured"] is True and feeds["items"][0]["mode"] == "simulated"
