"""Thomson Reuters Regulatory Intelligence → Governance regulatory feeds (Phase 5).

Covers the document mapper, simulated + live (OAuth) ingestion into
RegulatoryFeedItem with guid dedup, the poll dispatcher (RSS path unchanged),
the new source type on the existing create route, and scheduled-poll selection
(RSS stays manual by default)."""
from datetime import datetime, timedelta

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, GRCUser, Role, UserRole, RegulatoryFeedSource, RegulatoryFeedItem, RegulatoryFeedAssignment,
    TRProviderConnection, TR_PROVIDER_TRRI,
)
from grc.integrations_tr import connections, http as trhttp, trri
from grc.modules.governance.routers import regulatory_feeds as rf
from grc.modules.governance.regulatory_intelligence import poll_trri_feed
from grc.schemas import RegulatoryFeedSourceCreate
from grc.tasks.regulatory_feeds import due_sources

_TABLES = [Tenant, GRCUser, Role, UserRole, RegulatoryFeedSource, RegulatoryFeedItem, RegulatoryFeedAssignment,
           TRProviderConnection]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=1, username="u1", email="u1@acme.test"))
    s.commit()
    yield s
    s.close()


@pytest.fixture(autouse=True)
def _reset():
    yield
    trhttp.set_transport(None)
    trri._TOKENS.clear()


def _source(db, source_type=rf.TRRI_SOURCE_TYPE, **kw):
    d = dict(tenant_id=1, name="TR RI", source_url="https://api.thomsonreuters.com/regulatory-intelligence/v1",
             source_type=source_type, is_active=True, poll_interval_hours=24)
    d.update(kw)
    s = RegulatoryFeedSource(**d)
    db.add(s)
    db.commit()
    return s


# ── mapping ──────────────────────────────────────────────────────────────────

def test_normalise_document_field_variants():
    n = trri.normalise_document({"documentId": "D1", "headline": "Rule", "abstract": "sum",
                                 "publicationDate": "2026-09-01T10:00:00Z", "jurisdiction": "UK",
                                 "regulators": [{"name": "FCA"}], "topics": ["Outsourcing"],
                                 "docType": "Final rule", "effectiveDate": "2027-01-01"})
    assert n["guid"] == "trri:D1" and n["title"] == "Rule" and n["description"] == "sum"
    assert n["published_date"] == datetime(2026, 9, 1, 10, 0)
    assert n["metadata"]["jurisdiction"] == ["UK"] and n["metadata"]["regulator"] == ["FCA"]
    assert n["metadata"]["document_type"] == "Final rule" and n["metadata"]["effective_date"] == "2027-01-01"


def test_extract_documents_shapes():
    assert trri.extract_documents([{"id": 1}]) == [{"id": 1}]
    assert trri.extract_documents({"results": [{"id": 2}]}) == [{"id": 2}]
    assert trri.extract_documents({"nope": 1}) == []


# ── simulated ingestion ──────────────────────────────────────────────────────

def test_poll_without_connection_reports_failure(db):
    s = _source(db)
    res = poll_trri_feed(s, db, 1)
    assert res.success is False and "not configured" in res.error_message
    assert s.last_polled_at is not None and s.last_successful_poll is None


def test_simulated_poll_ingests_with_metadata_and_dedups(db):
    connections.upsert_connection(db, 1, TR_PROVIDER_TRRI, mode="simulated")
    db.commit()
    s = _source(db, provider_query={"jurisdictions": ["Freedonia"]})
    r1 = poll_trri_feed(s, db, 1)
    assert r1.success and r1.new_items >= 1
    item = db.query(RegulatoryFeedItem).first()
    assert item.guid.startswith("trri:SIM-") and item.status == "new"
    assert item.external_metadata["jurisdiction"] == ["Freedonia"] and item.external_metadata["simulated"]
    r2 = poll_trri_feed(s, db, 1)
    assert r2.success and r2.new_items == 0
    assert s.items_processed == r1.new_items and s.last_successful_poll is not None


def test_dispatch_keeps_rss_path(db, monkeypatch):
    called = {}
    def fake_rss(src, d, t):
        called.setdefault("rss", []).append(src.id)
        return "rss-result"

    monkeypatch.setattr(rf, "poll_rss_feed", fake_rss)
    rss = _source(db, source_type="rss", source_url="https://example.test/feed.xml")
    assert rf.poll_feed(rss, db, 1) == "rss-result"
    api_src = _source(db, source_type="api", source_url="https://example.test/api")
    rf.poll_feed(api_src, db, 1)  # 'api' keeps its original (RSS) poller
    assert called["rss"] == [rss.id, api_src.id]


def _served_create_route():
    """The file defines create_feed_source twice; HTTP is served by the FIRST
    registered POST /sources route — test that one."""
    return next(r.endpoint for r in rf.router.routes
                if getattr(r, "path", "") == "/regulatory-feeds/sources" and "POST" in r.methods)


def test_create_route_accepts_trri_type_and_cleans_query(db):
    admin = db.get(GRCUser, 1)
    create = _served_create_route()
    body = RegulatoryFeedSourceCreate(name="TR RI", source_url="https://api.thomsonreuters.com/regulatory-intelligence/v1",
                                      source_type=rf.TRRI_SOURCE_TYPE,
                                      provider_query={"jurisdictions": " Freedonia , Ruritania", "bogus": ["x"],
                                                      "topics": ["", "Outsourcing"]})
    out = create(body, db=db, current_user=admin)
    assert out.source_type == rf.TRRI_SOURCE_TYPE
    assert out.provider_query == {"jurisdictions": ["Freedonia", "Ruritania"], "topics": ["Outsourcing"]}
    with pytest.raises(HTTPException):
        create(RegulatoryFeedSourceCreate(name="x", source_url="u", source_type="ftp"), db=db, current_user=admin)
    rss = create(RegulatoryFeedSourceCreate(name="r", source_url="https://e.test/rss"), db=db, current_user=admin)
    assert rss.source_type == "rss" and rss.provider_query is None


# ── live client ──────────────────────────────────────────────────────────────

def test_live_oauth_token_cached_and_params_mapped(db, monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())
    connections.upsert_connection(db, 1, TR_PROVIDER_TRRI, mode="live", base_url_value="https://ri.test/v1",
                                  credentials_in={"client_id": "CID", "client_secret": "CS"})
    db.commit()
    calls = {"token": 0, "docs": []}

    def handler(req):
        if req.url.path == "/v1/oauth2/token":
            calls["token"] += 1
            assert b"grant_type=client_credentials" in req.content and b"client_id=CID" in req.content
            return httpx.Response(200, json={"access_token": "TOK", "expires_in": 3600})
        if req.url.path == "/v1/documents":
            assert req.headers["Authorization"] == "Bearer TOK"
            calls["docs"].append(dict(req.url.params))
            return httpx.Response(200, json={"documents": [{"id": "R1", "title": "New outsourcing rule",
                                                            "publishedDate": "2026-09-29"}]})
        return httpx.Response(404)

    trhttp.set_transport(httpx.MockTransport(handler))
    s = _source(db, provider_query={"jurisdictions": ["UK", "EU"], "topics": ["Outsourcing"]})
    r1 = poll_trri_feed(s, db, 1)
    r2 = poll_trri_feed(s, db, 1)
    assert r1.new_items == 1 and r2.new_items == 0 and calls["token"] == 1  # token reused
    assert calls["docs"][0]["jurisdiction"] == "UK,EU" and calls["docs"][0]["topic"] == "Outsourcing"
    assert "updatedSince" in calls["docs"][0]


def test_live_auth_failure_recorded(db, monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())
    conn = connections.upsert_connection(db, 1, TR_PROVIDER_TRRI, mode="live", base_url_value="https://ri.test/v1",
                                         credentials_in={"client_id": "CID", "client_secret": "bad"})
    db.commit()
    trhttp.set_transport(httpx.MockTransport(lambda r: httpx.Response(401, text="invalid_client")))
    res = poll_trri_feed(_source(db), db, 1)
    assert res.success is False and "credentials" in res.error_message
    assert conn.status == "error"


# ── scheduled polling selection ──────────────────────────────────────────────

def test_due_sources_trri_only_by_default_and_interval(db, monkeypatch):
    monkeypatch.delenv("REGULATORY_FEEDS_AUTO_POLL_RSS", raising=False)
    now = datetime.utcnow()
    trri_new = _source(db)
    trri_recent = _source(db, name="recent", last_polled_at=now - timedelta(hours=1))
    trri_old = _source(db, name="old", last_polled_at=now - timedelta(hours=25))
    rss = _source(db, source_type="rss", source_url="https://e.test/rss")
    ids = {s.id for s in due_sources(db, 1, now=now)}
    assert ids == {trri_new.id, trri_old.id}
    assert trri_recent.id not in ids and rss.id not in ids
    monkeypatch.setenv("REGULATORY_FEEDS_AUTO_POLL_RSS", "1")
    assert rss.id in {s.id for s in due_sources(db, 1, now=now)}
