"""Outside-in monitoring that fills itself, and alerts that survive scrutiny.

Connectors poll each vendor on its tier's cadence, write signals through one
writer that dedupes on the provider's own id, and move a cursor on. News alerts
pass four checks — rejection memory, source structure, the vendor named in the
headline, and corroboration by a second publisher — and one that is not
corroborated is kept but never reopens an assessment. Ratings are kept as
history, and a drop becomes a signal. Every signal reaches the attention queue.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AttentionActivity, AttentionState, Base, Evidence, GRCUser, Tenant, TPRAApproval, TPRAAuditLog,
    TPRAContract, TPRAControlObligation, TPRAEvidenceLink, TPRAExternalRating, TPRAFinding,
    TPRAMonitoringCursor, TPRAMonitoringSignal, TPRARiskAcceptance, TPRARiskSnapshot, TPRASignalRejection,
    TPRATieringConfig, TPRAVendorProduct, Vendor, VendorAssessment, VendorQuestionnaireResponse,
)
from grc.modules.vendor_risk.tpra import adverse_media, attention, monitoring, ratings, service
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds

NOW = datetime(2026, 9, 24, 12, 0)
_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, VendorQuestionnaireResponse, TPRAFinding, TPRAAuditLog,
           TPRATieringConfig, Evidence, TPRAEvidenceLink, TPRAMonitoringSignal, TPRAMonitoringCursor,
           TPRASignalRejection, TPRAExternalRating, TPRAContract, TPRAControlObligation, TPRAApproval,
           TPRARiskAcceptance, TPRARiskSnapshot, AttentionState, AttentionActivity, TPRAVendorProduct]


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    reopened = []
    monkeypatch.setattr(service, "create_reassessment_version",
                        lambda db, vendor, **kw: reopened.append(vendor.id) or type("A", (), {"id": 900 + len(reopened)})())
    monkeypatch.setattr(service, "ensure_finding_issue", lambda *a, **k: None)
    s.reopened = reopened
    yield s
    s.close()


def _vendor(db, name="Acme Cloud Services Ltd", tier="high", **kw):
    v = Vendor(tenant_id=1, name=name, status="active", tier=tier, owner_id=7, **kw)
    db.add(v)
    db.commit()
    return v


def _article(title, domain, when, url=None):
    return {"url": url or f"https://{domain}/{abs(hash((title, domain))) % 10**8}", "title": title,
            "domain": domain, "seendate": when.strftime("%Y%m%dT%H%M%SZ")}


def _news_on(db):
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             monitoring_policy={"adverse_media": True}))
    db.commit()


# ── who is due ───────────────────────────────────────────────────────────────

def test_each_vendor_is_polled_on_its_tiers_cadence_most_overdue_first(db):
    fresh = _vendor(db, "Never Polled", tier="low")
    critical = _vendor(db, "Critical Two Days", tier="critical")
    low = _vendor(db, "Low Ten Days", tier="low")
    high = _vendor(db, "High Eight Days", tier="high")
    for v, days in ((critical, 2), (low, 10), (high, 8)):
        db.add(TPRAMonitoringCursor(tenant_id=1, vendor_id=v.id, provider="p", last_polled_at=NOW - timedelta(days=days)))
    db.commit()
    due = [v.name for v, _ in monitoring.due_vendors(db, 1, "p", NOW)]
    assert due == ["Never Polled", "High Eight Days", "Critical Two Days"]      # low: not for 90 days
    assert [v.name for v, _ in monitoring.due_vendors(db, 1, "p", NOW, limit=1)] == ["Never Polled"]
    assert fresh and low


# ── the four checks ──────────────────────────────────────────────────────────

def test_the_headline_must_name_the_vendor_by_its_distinctive_name():
    assert adverse_media.core_name("Acme Cloud Services Ltd (UK)") == "acme cloud"
    assert adverse_media.names_vendor("Acme Cloud hit by ransomware attack", "Acme Cloud Services Ltd")
    assert not adverse_media.names_vendor("Acmex Cloud hit by ransomware", "Acme Cloud Services Ltd")
    assert not adverse_media.names_vendor("Cloud providers hit by ransomware", "Acme Cloud Services Ltd")


def test_articles_pass_four_checks_and_one_publisher_is_not_enough():
    d = NOW - timedelta(days=1)
    raw = [
        _article("Acme Cloud confirms ransomware attack on customer systems", "news-a.test", d),
        _article("Acme Cloud ransomware attack disrupts customer systems", "news-b.test", d + timedelta(hours=5)),
        _article("Acme Cloud fined over late filings by regulator", "news-c.test", d),
        _article("Ransomware hits several cloud firms", "news-d.test", d),                     # vendor not named
        {"url": "ftp://bad", "title": "Acme Cloud breach", "domain": "x", "seendate": "nope"},  # malformed
        _article("Acme Cloud data leak rumour denied", "news-e.test", d, url="https://news-e.test/ruled-out"),
    ]
    rejected = {adverse_media.fingerprint("https://news-e.test/ruled-out")}
    found = {f["title"]: f for f in adverse_media.drafts("Acme Cloud Services Ltd", raw, rejected)}
    assert set(found) == {"Acme Cloud confirms ransomware attack on customer systems",
                          "Acme Cloud fined over late filings by regulator"}
    breach = found["Acme Cloud confirms ransomware attack on customer systems"]
    assert (breach["signal_type"], breach["severity"], breach["verification"]["verified"]) == ("breach", "high", True)
    assert len(breach["sources"]) == 2
    fined = found["Acme Cloud fined over late filings by regulator"]
    assert fined["verification"]["verified"] is False and fined["signal_type"] == "adverse_media"


# ── the runner ───────────────────────────────────────────────────────────────

def test_news_monitoring_is_off_until_a_tenant_turns_it_on(db):
    # the certificate feed always; news once turned on; product watch once a product is watched
    assert [p["configured"] for p in feeds.providers(db, 1)] == [True, False, False]


def test_a_feed_fills_the_queue_dedupes_and_is_corroborated_later(db, monkeypatch):
    _news_on(db)
    vendor = _vendor(db, tier="critical")
    first = _article("Acme Cloud confirms ransomware attack on customers", "news-a.test", NOW - timedelta(hours=6))
    later = _article("Acme Cloud ransomware attack hits customers", "news-b.test", NOW + timedelta(hours=10))
    batches = iter([[first], [first, later]])
    monkeypatch.setattr(feeds.AdverseMediaConnector, "fetch", staticmethod(lambda q, s, e: next(batches)))

    feeds.run_connectors(db, 1, now=NOW)
    db.commit()
    sig = db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.source == adverse_media.PROVIDER).one()
    assert sig.verified is False and db.reopened == []                  # one publisher: shown, not acted on
    items = [i for i in attention.open_items(db, 1, NOW.date(), {}) if i["record_type"] == "signal"]
    assert [i["condition"] for i in items] == ["signal_unverified"]

    feeds.run_connectors(db, 1, now=NOW + timedelta(days=1))           # a critical vendor is polled daily
    db.commit()
    assert db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.source == adverse_media.PROVIDER).count() == 1
    db.refresh(sig)
    assert sig.verified is True and len(sig.sources) == 2 and db.reopened == [vendor.id]
    assert [a.action for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "signal")] == ["create", "verify"]


def test_a_failed_poll_leaves_the_vendor_due(db, monkeypatch):
    _news_on(db)
    vendor = _vendor(db)

    def down(q, s, e):
        raise TimeoutError("no route to the news service")
    monkeypatch.setattr(feeds.AdverseMediaConnector, "fetch", staticmethod(down))
    result = feeds.run_connectors(db, 1, now=NOW)
    db.commit()
    assert result["results"][adverse_media.PROVIDER]["failed"] == 1
    cursor = db.query(TPRAMonitoringCursor).filter(TPRAMonitoringCursor.provider == adverse_media.PROVIDER).one()
    assert cursor.last_polled_at is None and "no route" in cursor.last_error
    assert [v.id for v, _ in monitoring.due_vendors(db, 1, adverse_media.PROVIDER, NOW)] == [vendor.id]


def test_a_lapsed_certificate_is_raised_once(db):
    vendor = _vendor(db)
    cert = Evidence(tenant_id=1, name="SOC 2 Type II 2025", status="approved", expiry_date=NOW - timedelta(days=3))
    db.add(cert)
    db.flush()
    db.add(TPRAEvidenceLink(tenant_id=1, vendor_id=vendor.id, evidence_id=cert.id, requirement="assurance_report"))
    db.commit()
    feeds.run_connectors(db, 1, now=NOW)
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=8))           # high tier: due again after a week
    db.commit()
    sig = db.query(TPRAMonitoringSignal).one()
    assert sig.signal_type == "cert_expiry" and sig.title.startswith("SOC 2 Type II 2025 lapsed on")


# ── signal to finding, and ruling one out ────────────────────────────────────

def test_a_signal_becomes_a_finding_once_with_its_sources(db, monkeypatch):
    vendor = _vendor(db)
    assessment = VendorAssessment(tenant_id=1, vendor_id=vendor.id, lifecycle_status="active", status="draft")
    db.add(assessment)
    db.commit()
    monkeypatch.setattr(service, "ensure_active_assessment", lambda db, v, actor: assessment)
    sig, _, _ = monitoring.record_signal(
        db, vendor, signal_type="adverse_media", severity="medium", title="Acme Cloud fined", source="GDELT news",
        sources=[{"url": "https://news-a.test/x", "title": "Acme Cloud fined"}], verification={"verified": True})
    finding = monitoring.raise_finding(db, sig, vendor, 7)
    assert monitoring.raise_finding(db, sig, vendor, 7).id == finding.id
    assert finding.domain == "reputational" and "https://news-a.test/x" in finding.description
    assert sig.finding_id == finding.id


def test_an_alert_ruled_out_is_never_raised_again(db, monkeypatch):
    _news_on(db)
    vendor = _vendor(db, tier="critical")
    article = _article("Acme Cloud outage leaves users offline", "news-a.test", NOW - timedelta(hours=2))
    monkeypatch.setattr(feeds.AdverseMediaConnector, "fetch", staticmethod(lambda q, s, e: [article]))
    feeds.run_connectors(db, 1, now=NOW)
    sig = db.query(TPRAMonitoringSignal).one()
    monitoring.reject(db, sig, 7, "A different Acme")
    db.commit()
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=1))
    db.commit()
    assert db.query(TPRAMonitoringSignal).filter(TPRAMonitoringSignal.deleted_at.is_(None)).count() == 0
    assert db.query(TPRASignalRejection).one().reason == "A different Acme"


# ── ratings ──────────────────────────────────────────────────────────────────

def test_a_ratings_export_is_kept_as_history_and_a_drop_becomes_a_signal(db):
    vendor = _vendor(db, tier="low")
    other = _vendor(db, "Globex")
    csv_text = ("vendor,score,date,grade\n"
                f"{vendor.name},85,2026-07-01,B\n"
                f"{vendor.name},70,2026-09-01,C\n"            # a 15-point fall
                f"{other.id},90,2026-09-01,A\n"
                "Nobody Ltd,50,2026-09-01,D\n"
                f"{vendor.name},high,2026-09-02,C\n")
    rows, problems = ratings.parse(csv_text.encode(), [vendor, other], "ScoreCo")
    assert problems == ["Line 5: no vendor called 'Nobody Ltd'", "Line 6: 'high' is not a score"]
    counts = ratings.import_rows(db, rows, 7)
    db.commit()
    assert counts == {"imported": 3, "already_held": 0, "drops": 1}
    sig = db.query(TPRAMonitoringSignal).one()
    assert (sig.signal_type, sig.severity, sig.source) == ("security_rating", "medium", "ScoreCo")
    assert [r["score"] for r in ratings.history(db, vendor.id)] == [85.0, 70.0]
    assert ratings.import_rows(db, rows, 7)["already_held"] == 3        # importing again changes nothing
    item = next(i for i in attention.open_items(db, 1, NOW.date(), {}) if i["condition"] == "signal_new")
    assert "fell from 85 to 70" in item["title"]


def test_a_file_without_the_right_columns_is_refused():
    with pytest.raises(ValueError):
        ratings.parse(b"name,rating\nAcme,80\n", [], "ScoreCo")
