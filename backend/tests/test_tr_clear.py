"""CLEAR due-diligence enrichment (Phase 4): flag derivation, permissible purpose,
immutable reports, advisory flags → findings, live XML client with certs."""
import os
import tempfile

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from lxml import etree

from grc.models import TPRAEnrichmentReport, TPRAFinding, TPRAAuditLog, TR_PROVIDER_CLEAR
from grc.integrations_tr import clear, connections, http as trhttp
from grc.modules.vendor_risk.tpra import enrichment, screening_api, service

from tests.test_tr_screening import db, _vendor, _user, _person, _reset_transport  # noqa: F401 — fixtures


def _clear_sim(db, **cfg):
    c = connections.upsert_connection(db, 1, TR_PROVIDER_CLEAR, mode="simulated", config_in=cfg or None)
    db.commit()
    return c


# ── pure mapping ─────────────────────────────────────────────────────────────

def test_derive_flags_from_namespaced_xml():
    xml = b"""<r:ReportResults xmlns:r="urn:clear">
      <r:BusinessOverview><r:Name>ACME</r:Name><r:Status>Administratively Dissolved</r:Status></r:BusinessOverview>
      <r:LienSection><r:Lien><r:Amount>1</r:Amount></r:Lien><r:Lien><r:Amount>2</r:Amount></r:Lien></r:LienSection>
      <r:BankruptcySection><r:Bankruptcy><r:Chapter>7</r:Chapter></r:Bankruptcy></r:BankruptcySection>
      <r:NewsSection/>
    </r:ReportResults>"""
    report = {"ReportResults": clear.xml_to_dict(etree.fromstring(xml))}
    flags = {f["key"]: f for f in clear.derive_flags(report)}
    assert set(flags) == {"bankruptcy", "liens", "business_status"}  # empty news section → no flag
    assert flags["liens"]["count"] == 2 and flags["liens"]["domain"] == "financial"
    assert flags["bankruptcy"]["severity"] == "high"
    assert flags["business_status"]["domain"] == "operational"
    assert clear.risk_score(list(flags.values())) == 25 + 12 + 12


def test_xml_parser_refuses_entities():
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>'
    root = etree.fromstring(evil, parser=etree.XMLParser(resolve_entities=False, no_network=True))
    assert "root:" not in (etree.tostring(root).decode())


# ── service ──────────────────────────────────────────────────────────────────

def test_requires_permissible_purpose(db):
    _clear_sim(db)
    v = _vendor(db, name="Lien Holdings")
    with pytest.raises(enrichment.EnrichmentError):
        enrichment.search(db, v)
    out = enrichment.search(db, v, glb="GLB-5", dppa="DPPA-1")
    assert out["simulated"] and len(out["candidates"]) == 2


def test_purpose_defaults_from_settings(db):
    _clear_sim(db, default_glb_purpose="GLB-5", default_dppa_purpose="DPPA-1")
    v = _vendor(db, name="Lien Holdings")
    assert enrichment.search(db, v)["candidates"]


def test_report_snapshot_flags_and_audit(db):
    _clear_sim(db, default_glb_purpose="GLB-5", default_dppa_purpose="DPPA-1")
    v = _vendor(db, name="Bankrupt Lien Litigation Co")
    cand = enrichment.search(db, v)["candidates"][0]
    rep = enrichment.run_report(db, v, candidate_id=cand["id"], actor_id=1, entity_name=cand["name"])
    db.commit()
    keys = {f["key"] for f in rep.flags}
    assert {"bankruptcy", "liens", "lawsuits"} <= keys
    assert rep.simulated and rep.permissible_purpose == {"glb": "GLB-5", "dppa": "DPPA-1"}
    assert rep.risk_score > 0 and rep.summary.get("registration_number", "").startswith("SIM")
    assert db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "enrichment_report").count() == 1
    # Re-running creates a new immutable report (history kept).
    enrichment.run_report(db, v, candidate_id=cand["id"], actor_id=1, entity_name=cand["name"])
    assert db.query(TPRAEnrichmentReport).count() == 2


def test_clean_entity_has_no_flags(db):
    _clear_sim(db, default_glb_purpose="G", default_dppa_purpose="D")
    v = _vendor(db, name="Clean Supplies")
    rep = enrichment.run_report(db, v, candidate_id="SIM-1", actor_id=1)
    assert rep.flags == [] and rep.risk_score == 0


def test_flags_are_advisory_until_raised(db):
    _clear_sim(db, default_glb_purpose="G", default_dppa_purpose="D")
    v = _vendor(db, name="Crim Dissolved Corp")
    rep = enrichment.run_report(db, v, candidate_id="SIM-2", actor_id=1)
    assert db.query(TPRAFinding).count() == 0
    f = enrichment.raise_finding(db, rep, "criminal", actor_id=1)
    assert (f.severity, f.domain) == ("high", "compliance") and "SIMULATED" in f.description
    assert next(x for x in rep.flags if x["key"] == "criminal")["finding_id"] == f.id
    # Idempotent per flag; severity override honoured for another flag.
    assert enrichment.raise_finding(db, rep, "criminal", actor_id=1).id == f.id
    f2 = enrichment.raise_finding(db, rep, "business_status", actor_id=1, severity="critical")
    assert f2.severity == "critical" and f2.is_critical_control_fail
    assert service.count_open_critical(db, f2.assessment_id) == 1
    with pytest.raises(enrichment.EnrichmentError):
        enrichment.raise_finding(db, rep, "nope", actor_id=1)


def test_person_report(db):
    _clear_sim(db, default_glb_purpose="G", default_dppa_purpose="D")
    v = _vendor(db, name="Clean Supplies")
    p = _person(db, v, "Ann News")
    cands = enrichment.search(db, v, person_id=p.id)["candidates"]
    assert len(cands) == 1  # person search returns a single simulated candidate
    rep = enrichment.run_report(db, v, candidate_id=cands[0]["id"], actor_id=1, person_id=p.id)
    assert rep.person_id == p.id and any(f["key"] == "news" for f in rep.flags)


# ── live client ──────────────────────────────────────────────────────────────

def _self_signed_pem():
    from datetime import datetime, timedelta
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "clear-client.test")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(datetime.utcnow() - timedelta(days=1))
            .not_valid_after(datetime.utcnow() + timedelta(days=1)).sign(key, hashes.SHA256()))
    return (cert.public_bytes(serialization.Encoding.PEM).decode(),
            key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                              serialization.NoEncryption()).decode())


def test_live_client_posts_xml_with_client_cert_and_cleans_up(db, monkeypatch):
    monkeypatch.setenv("CONNECTOR_MASTER_KEY", Fernet.generate_key().decode())
    made = []
    real_mkdtemp = tempfile.mkdtemp
    monkeypatch.setattr(tempfile, "mkdtemp", lambda **kw: made.append(real_mkdtemp(**kw)) or made[-1])
    cert_pem, key_pem = _self_signed_pem()
    connections.upsert_connection(db, 1, TR_PROVIDER_CLEAR, mode="live", base_url_value="https://clear.test",
                                  credentials_in={"client_cert_pem": cert_pem, "client_key_pem": key_pem},
                                  config_in={"default_glb_purpose": "G", "default_dppa_purpose": "D"})
    db.commit()
    seen = {}

    def handler(req):
        seen.setdefault("paths", []).append(req.url.path)
        body = req.content.decode()
        if req.url.path.endswith("searchResults"):
            assert "<GLB>G</GLB><DPPA>D</DPPA>" in body and "<BusinessName>Acme &amp; Co</BusinessName>" in body
            return httpx.Response(200, content=b"<Results><ResultGroup><GroupId>G1</GroupId>"
                                               b"<Name>ACME &amp; CO</Name></ResultGroup></Results>")
        return httpx.Response(200, content=b"<ReportResults><JudgmentSection><Judgment><Amount>5</Amount>"
                                           b"</Judgment></JudgmentSection></ReportResults>")

    trhttp.set_transport(httpx.MockTransport(handler))
    v = _vendor(db, name="Acme & Co")
    cands = enrichment.search(db, v)["candidates"]
    assert cands == [{"id": "G1", "name": "ACME & CO", "address": None}]
    rep = enrichment.run_report(db, v, candidate_id="G1", actor_id=1)
    assert [f["key"] for f in rep.flags] == ["judgments"] and rep.simulated is False
    assert seen["paths"] == ["/v3/business/searchResults", "/v3/business/reportResults"]
    # The PEM temp files are gone as soon as the TLS chain is loaded.
    assert made and all(not os.path.exists(d) for d in made)


def test_bad_certificate_is_a_clear_error():
    with pytest.raises(ValueError) as ei:
        clear.ClearClient("https://clear.test", {"client_cert_pem": "nope", "client_key_pem": "nope"})
    assert "could not be loaded" in str(ei.value)


def test_live_requires_certificate(db, monkeypatch):
    with pytest.raises(ValueError):
        clear.ClearClient("https://clear.test", {"client_cert_pem": "C"})


# ── API ──────────────────────────────────────────────────────────────────────

def test_api_enrichment_flow_and_rbac(db):
    admin = _user(db, 60, admin=True)
    nobody = _user(db, 61)
    v = _vendor(db, name="Lien Holdings")
    with pytest.raises(HTTPException) as ei:
        screening_api.clear_search(v.id, screening_api.ClearSearchIn(glb_purpose="G", dppa_purpose="D"),
                                   db=db, user=admin)
    assert ei.value.status_code == 409
    _clear_sim(db)
    with pytest.raises(HTTPException) as ei:
        screening_api.clear_search(v.id, screening_api.ClearSearchIn(), db=db, user=admin)
    assert ei.value.status_code == 400  # purpose missing
    with pytest.raises(HTTPException) as ei:
        screening_api.vendor_enrichment(v.id, db=db, user=nobody)
    assert ei.value.status_code == 403
    cands = screening_api.clear_search(v.id, screening_api.ClearSearchIn(glb_purpose="G", dppa_purpose="D"),
                                       db=db, user=admin)["candidates"]
    rep = screening_api.clear_report(v.id, screening_api.ClearReportIn(candidate_id=cands[0]["id"],
                                                                       glb_purpose="G", dppa_purpose="D"),
                                     db=db, user=admin)
    assert any(f["key"] == "liens" for f in rep["flags"])
    out = screening_api.clear_raise_finding(rep["id"], "liens", screening_api.RaiseFindingIn(), db=db, user=admin)
    assert out["domain"] == "financial"
    view = screening_api.vendor_enrichment(v.id, db=db, user=admin)
    assert view["connection"]["mode"] == "simulated" and len(view["reports"]) == 1
