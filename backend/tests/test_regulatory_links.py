"""Each obligation linked to the controls that meet it, and every control showing its obligations.

SCF controls are only ever suggested by keyword ranking: no SCF text reaches a
model. The organisation's own controls go to the model with a shortlist. People
confirm or reject; a rejected pair is never proposed again, and a confirmed one
survives the circular being read again.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AuditLog, AuditObservation, Base, Framework, GovernanceDocument, GRCDepartment, GRCUser, InternalControl,
    NormalizedControl, RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask, RegulatoryLink,
    RegulatoryObligation, Tenant, get_db,
)
from grc.modules.governance import regulatory_engine as engine
from grc.modules.governance import regulatory_links as links
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
           RegulatoryObligation, RegulatoryLink, Framework, NormalizedControl, InternalControl, GovernanceDocument,
           AuditObservation, GRCDepartment, AuditLog]
SCF_PROSE = "Mechanisms exist to conduct penetration testing on systems and applications at least annually"


@pytest.fixture(autouse=True)
def _small_library(monkeypatch):
    # Three controls make tiny BM25 scores; the floor is calibrated on the real library.
    monkeypatch.setattr(links, "MIN_SCF_SCORE", 0.0)


@pytest.fixture()
def db():
    engine_ = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine_, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine_)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(GRCUser(id=7, username="officer", email="o@bank.test", is_active=True))
    s.add_all([
        NormalizedControl(code="VPM-07", scf_id="VPM-07", name="Penetration Testing", statement=SCF_PROSE, source="scf"),
        NormalizedControl(code="IRO-10", scf_id="IRO-10", name="Incident Stakeholder Reporting",
                          statement="Mechanisms exist to timely report incidents to applicable regulatory authorities",
                          source="scf"),
        NormalizedControl(code="HRS-01", scf_id="HRS-01", name="Human Resources Security Management",
                          statement="Mechanisms exist to facilitate personnel security controls", source="scf"),
    ])
    s.add(InternalControl(tenant_id=1, control_id="IC-014", name="Annual external penetration test of internet banking",
                          description="An accredited firm tests every internet and mobile banking channel yearly.",
                          status="active"))
    s.commit()
    yield s
    s.close()


def _obligations(db):
    change = RegulatoryChange(tenant_id=1, title="Cyber circular", source="SBP", status="identified", priority="high")
    db.add(change)
    db.flush()
    pen = RegulatoryObligation(tenant_id=1, regulatory_change_id=change.id, ref="2", summary=(
        "Conduct an independent penetration test of every digital banking channel at least annually."),
        quote="Banks shall conduct an independent penetration test of every digital channel at least once a year.",
        source="ai", verified=True)
    report = RegulatoryObligation(tenant_id=1, regulatory_change_id=change.id, ref="3", summary=(
        "Report every major cyber incident to the regulatory authority within 24 hours."),
        quote="Banks shall report every major cyber incident to the State Bank within 24 hours of detection.",
        source="ai", verified=True)
    db.add_all([pen, report])
    db.commit()
    return change, pen, report


def _model(seen_prompts: list):
    def llm_json(system, prompt, schema, name, **_):
        assert name == "obligation_controls"
        seen_prompts.append(prompt)
        return {"links": [{"obligation": "O1", "control": "IC-014", "meets": "fully",
                           "why": "An accredited firm tests every digital channel yearly."}]}, "gpt-6-astra"
    return llm_json


def test_the_ranking_finds_the_controls_that_share_the_obligations_words():
    ranker = links.Ranker(["Penetration Testing. " + SCF_PROSE, "Human Resources Security Management",
                           "Incident Stakeholder Reporting. report incidents to regulatory authorities"])
    best = ranker.top("penetration test of every digital channel annually", k=3)
    assert best[0][0] == 0 and all(i != 1 for i, _, _ in best)


def test_scf_controls_are_suggested_without_a_model_reading_them(db, monkeypatch):
    seen: list = []
    monkeypatch.setattr(engine, "llm_json", _model(seen))
    change, pen, report = _obligations(db)
    counts = links.suggest_controls(db, change, 7)
    db.commit()
    rows = db.query(RegulatoryLink).all()
    by = {(r.obligation_id, r.target_ref): r for r in rows}
    assert by[(pen.id, "VPM-07")].source == "match" and by[(pen.id, "VPM-07")].status == "proposed"
    assert by[(report.id, "IRO-10")].source == "match"
    assert (pen.id, "HRS-01") not in by                             # shares too few words to suggest
    own = by[(pen.id, "IC-014")]
    assert own.source == "ai" and own.score == 1.0 and "accredited firm" in own.rationale
    assert seen and all(SCF_PROSE not in p and "Penetration Testing" not in p for p in seen)   # no SCF text sent
    assert counts["control_suggestions"] == len(rows)


def test_decisions_stand_and_follow_a_re_read_obligation(db, monkeypatch):
    monkeypatch.setattr(engine, "llm_json", _model([]))
    change, pen, report = _obligations(db)
    links.suggest_controls(db, change, 7)
    db.commit()
    scf = db.query(RegulatoryLink).filter_by(obligation_id=pen.id, target_ref="VPM-07").one()
    wrong = db.query(RegulatoryLink).filter_by(obligation_id=report.id, target_ref="IRO-10").one()
    scf.status, wrong.status = "confirmed", "rejected"
    db.commit()

    links.suggest_controls(db, change, 7)                           # suggested again: decisions stand
    db.commit()
    assert db.query(RegulatoryLink).filter_by(obligation_id=report.id, target_ref="IRO-10").one().status == "rejected"

    new_pen = RegulatoryObligation(tenant_id=1, regulatory_change_id=change.id, ref="2", summary=pen.summary,
                                   quote=pen.quote, source="ai")
    db.add(new_pen)
    db.flush()
    links.carry_decisions(db, {pen.id: new_pen.id})                 # the circular was read again
    db.commit()
    assert db.query(RegulatoryLink).filter_by(target_ref="VPM-07", status="confirmed").one().obligation_id == new_pen.id


def test_links_are_decided_added_searched_and_shown_on_the_controls_own_page(db, monkeypatch):
    monkeypatch.setattr(engine, "llm_json", _model([]))
    change, pen, report = _obligations(db)
    app = FastAPI()
    app.include_router(links.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    http = TestClient(app)

    assert http.post(f"/regulatory-changes/changes/{change.id}/suggest-controls").json()["control_suggestions"] >= 3
    proposed = http.get(f"/regulatory-changes/changes/{change.id}/links").json()["items"]
    first = next(l for l in proposed if l["target_ref"] == "VPM-07")
    decided = http.patch(f"/regulatory-changes/links/{first['id']}", json={"status": "confirmed"}).json()
    assert decided["status"] == "confirmed" and decided["decided_by"] == "officer"

    found = http.get("/regulatory-changes/control-search", params={"q": "stakeholder reporting"}).json()["items"]
    assert found[0]["ref"] == "IRO-10" and found[0]["scf"] is True
    hr = http.get("/regulatory-changes/control-search", params={"q": "HRS-01"}).json()["items"][0]
    added = http.post(f"/regulatory-changes/obligations/{report.id}/links",
                      json={"target_type": hr["type"], "target_id": hr["id"]})
    assert added.status_code == 201 and added.json()["status"] == "confirmed" and added.json()["source"] == "manual"

    page = http.get("/regulatory-changes/links/for", params={"target_type": "control", "target_ref": "VPM-07"}).json()
    assert [(i["obligation"]["ref"], i["change"]["title"]) for i in page["items"]] == [("2", "Cyber circular")]
    assert http.delete(f"/regulatory-changes/links/{added.json()['id']}").status_code == 200
    assert db.query(AuditLog).filter_by(resource_type="regulatory_link").count() == 3
