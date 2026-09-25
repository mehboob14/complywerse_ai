"""A circular is read clause by clause, and every obligation rests on its own words.

The old analysis read the first 12,000 characters. Now every section is read, an
obligation found twice where sections overlap is kept once, and a quote the
circular doesn't contain is marked unverified rather than trusted. A second
reading keeps what people decided about the obligations that recur.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    AuditLog, AuditObservation, Base, CriticalTask, CriticalTaskApproval, CriticalTaskComment, CriticalTaskHistory,
    CriticalTaskSubTask, Framework, GovernanceDocument, GRCDepartment, GRCUser, InternalControl, MeetingAgendaItem,
    NormalizedControl, RegulatoryChange, RegulatoryFeedItem, RegulatoryImpactAssessment, RegulatoryImplementationTask,
    RegulatoryLink, RegulatoryObligation, Tenant, get_db,
)
from grc.modules.governance import regulatory_engine as engine
from grc.modules.governance.routers import regulatory_changes
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
           RegulatoryObligation, RegulatoryLink, Framework, NormalizedControl, InternalControl, GovernanceDocument,
           AuditObservation, GRCDepartment, AuditLog, RegulatoryFeedItem, MeetingAgendaItem,
           # AI tasks show in Task Management too (regulatory_tasks)
           CriticalTask, CriticalTaskHistory, CriticalTaskSubTask, CriticalTaskComment, CriticalTaskApproval]

CIRCULAR = "\n\n".join([
    "STATE BANK OF PAKISTAN. BPRD Circular No. 07 of 2026. Subject: Cyber Resilience of Digital Channels.",
    "1. Definitions. Digital channel means any internet or mobile banking service.",
    "2. Banks shall conduct an independent penetration test of every digital channel at least once a year.",
    "x" * 300,
    "3. Banks shall report every major cyber incident to the State Bank within 24 hours of detection.",
    "4. The Board shall approve the cyber resilience framework by 31 December 2026.",
])


@pytest.fixture()
def db():
    engine_ = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine_, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine_)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(GRCUser(id=7, username="officer", email="o@bank.test", is_active=True))
    s.commit()
    yield s
    s.close()


def _fake_llm(sections_seen: list, invented_quote: str = "Banks shall encrypt all backups daily."):
    """Stands in for the model: identifies the circular, finds the numbered duties in
    each section it is shown, and maps the impact."""
    def llm_json(system, prompt, schema, name, **_):
        if name == "circular_identity":
            return {"title": "Cyber Resilience of Digital Channels", "issuer": "SBP", "reference": "BPRD Circular No. 07 of 2026",
                    "issue_date": "2026-09-01", "effective_date": "2026-12-31", "applicability": "Banks",
                    "summary": "Banks must test, report and govern cyber resilience.", "supersedes": []}, "gpt-6-luna"
        if name == "circular_obligations":
            sections_seen.append(prompt)
            found = []
            for ref, quote, kind in (("2", "Banks shall conduct an independent penetration test of every digital "
                                           "channel at least once a year.", "requirement"),
                                     ("3", "Banks shall report every major cyber incident to the State Bank within 24 "
                                           "hours of detection.", "reporting"),
                                     ("4", "The Board shall approve the cyber resilience framework by 31 December 2026.",
                                      "governance")):
                if quote in prompt:
                    found.append({"ref": ref, "quote": quote, "summary": quote, "obligation_type": kind,
                                  "applies_to": ["banks"], "deadline": "2026-12-31" if ref == "4" else None,
                                  "deadline_text": "by 31 December 2026" if ref == "4" else None, "priority": "high"})
            if "SECTION" in prompt and len(sections_seen) == 1:        # one the circular does not say
                found.append({"ref": "9", "quote": invented_quote, "summary": "Encrypt backups", "obligation_type":
                              "requirement", "applies_to": [], "deadline": None, "deadline_text": None,
                              "priority": "medium"})
            return {"obligations": found}, "gpt-6-luna"
        assert name == "regulatory_impact" and "penetration test" in prompt   # the whole circular, asked in parallel
        return {"title": "Cyber Resilience", "summary": "Test, report, govern.", "priority": "high",
                "effective_date_estimate": None, "impact_overview": "Material for digital channels.",
                "impacted_policies": [], "impacted_controls": [],
                "implementation_tasks": [{"title": "Commission annual penetration tests", "description": "Per para 2",
                                          "priority": "high", "suggested_deadline_days": 60, "task_tags": []}],
                "compliance_gaps": [], "recommendations": []}, "gpt-6-luna"
    return llm_json


def _change(db, text=CIRCULAR):
    change = RegulatoryChange(tenant_id=1, title="upload.pdf", source="SBP", source_text=text, status="identified",
                              priority="medium", created_by=7)
    db.add(change)
    db.commit()
    return change


def test_every_section_is_read_and_sections_overlap():
    text = "\n\n".join(f"Para {i}. Banks shall do thing {i}." + " y" * 400 for i in range(40))
    sections = engine.split_sections(text, size=3000, overlap=300)
    assert len(sections) > 5 and all(len(s) <= 3000 + 300 + 2 for s in sections)
    assert "Para 39." in sections[-1] and "Para 0." in sections[0]
    assert sections[1][:300] == sections[0][-300:]                     # a clause cut in two is read whole
    assert len(engine.split_sections("z" * 9000, size=3000, overlap=100)) >= 3   # one huge paragraph still splits


def test_a_quote_counts_only_if_the_circular_says_it():
    checker = engine.QuoteChecker("Banks shall report every major cyber incident to the State Bank within 24 hours.")
    assert checker.score("banks shall report every major cyber incident") == 1.0
    assert checker.score("Banks shall report every major cyber incident to the State Bank within 42 hours.") >= 0.8
    assert checker.score("Banks shall encrypt all backups daily and store them offshore.") < 0.3
    # a table cell the PDF extraction split across lines, other cells in between
    table = engine.QuoteChecker("As per respective bank's risk\n15 Credit Scorecard , :\nappetite & credit policy\n")
    assert table.score("As per respective bank's risk appetite & credit policy") >= 0.8
    assert table.score("As decided by the board's credit committee each quarter") < 0.5


def test_the_whole_circular_becomes_verified_obligations_and_their_impact(db, monkeypatch):
    seen: list = []
    monkeypatch.setattr(engine, "SECTION_CHARS", 260)
    monkeypatch.setattr(engine, "SECTION_OVERLAP", 120)
    monkeypatch.setattr(engine, "llm_json", _fake_llm(seen))
    change = _change(db)
    counts = engine.analyse(db, change, db.get(GRCUser, 7), update_change_fields=True)
    db.commit()

    assert counts["sections"] == len(seen) > 2                         # every section was read
    rows = db.query(RegulatoryObligation).filter_by(deleted_at=None).order_by(RegulatoryObligation.id).all()
    refs = [r.ref for r in rows]
    assert sorted(refs) == ["2", "3", "4", "9"] and len(set(refs)) == len(refs)   # found twice, kept once
    by_ref = {r.ref: r for r in rows}
    assert by_ref["3"].verified and by_ref["3"].obligation_type == "reporting"
    assert not by_ref["9"].verified and by_ref["9"].match_score < 0.5  # invented: kept, flagged
    assert str(by_ref["4"].deadline) == "2026-12-31"
    assert (counts["verified"], counts["unverified"], counts["model"]) == (3, 1, "gpt-6-luna")
    assert change.regulation_reference == "BPRD Circular No. 07 of 2026" and change.effective_date is not None
    assert [t.title for t in db.query(RegulatoryImplementationTask)] == ["Commission annual penetration tests"]


def test_a_second_reading_keeps_what_people_decided(db, monkeypatch):
    monkeypatch.setattr(engine, "llm_json", _fake_llm([]))
    change = _change(db)
    user = db.get(GRCUser, 7)
    engine.analyse(db, change, user, update_change_fields=False)
    db.commit()
    reporting = db.query(RegulatoryObligation).filter_by(ref="3", deleted_at=None).one()
    reporting.compliance_status, reporting.department, reporting.owner_ids = "partially_compliant", "IT Security", [7]
    db.add(RegulatoryObligation(tenant_id=1, regulatory_change_id=change.id, summary="Our own addition",
                                source="manual"))
    started = db.query(RegulatoryImplementationTask).filter_by(is_ai_generated=True).one()
    started.status, started.obligation_id = "in_progress", reporting.id           # someone picked it up
    db.commit()

    monkeypatch.setattr(engine, "llm_json", _fake_llm([]))
    engine.analyse(db, change, user, update_change_fields=False)
    db.commit()
    live = db.query(RegulatoryObligation).filter_by(deleted_at=None).all()
    again = next(o for o in live if o.ref == "3")
    assert again.id != reporting.id and (again.compliance_status, again.department, again.owner_ids) == (
        "partially_compliant", "IT Security", [7])
    assert any(o.source == "manual" for o in live)                     # a person's own entry is untouched
    # the task in hand stays (not replaced, not duplicated) and follows its re-read obligation
    tasks = db.query(RegulatoryImplementationTask).all()
    assert [t.id for t in tasks] == [started.id] and tasks[0].obligation_id == again.id
    assert db.query(CriticalTask).count() == 1                         # one task, one twin in Task Management


def test_a_run_the_server_lost_shows_as_stopped(db):
    change = _change(db)
    change.analysis = {"status": "running", "updated_at": (datetime.utcnow() - timedelta(hours=1)).isoformat()}
    assert engine.analysis_state(change)["status"] == "failed" and not engine.is_running(change)
    change.analysis = {"status": "running", "updated_at": datetime.utcnow().isoformat()}
    assert engine.is_running(change)


def test_obligations_can_be_listed_added_assessed_and_removed(db):
    change = _change(db)
    app = FastAPI()
    app.include_router(regulatory_changes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    http = TestClient(app)
    made = http.post(f"/regulatory-changes/changes/{change.id}/obligations",
                     json={"summary": "Keep incident logs for five years", "ref": "5", "obligation_type": "record_keeping"})
    assert made.status_code == 201, made.text
    oid = made.json()["id"]
    assert http.patch(f"/regulatory-changes/obligations/{oid}", json={"compliance_status": "wrong"}).status_code == 422
    done = http.patch(f"/regulatory-changes/obligations/{oid}", json={"compliance_status": "compliant", "owner_id": 7})
    assert done.json()["compliance_status"] == "compliant" and done.json()["owner_name"] == "officer"
    assert [o["ref"] for o in http.get(f"/regulatory-changes/changes/{change.id}/obligations").json()["items"]] == ["5"]
    assert http.delete(f"/regulatory-changes/obligations/{oid}").status_code == 200
    assert http.get(f"/regulatory-changes/changes/{change.id}/obligations").json()["items"] == []
    assert db.query(AuditLog).filter_by(resource_type="regulatory_obligation").count() == 3


def test_the_background_run_reports_progress_and_finishes(db, monkeypatch):
    from sqlalchemy.orm import sessionmaker as _sm
    from grc import db as grc_db

    monkeypatch.setattr(engine, "llm_json", _fake_llm([]))
    monkeypatch.setattr(grc_db, "open_tenant_session", lambda slug: _sm(bind=db.get_bind())())
    change = _change(db)
    engine.run_job("bank", change.id, 7, {"update_change_fields": True})
    db.expire_all()
    state = engine.analysis_state(db.get(RegulatoryChange, change.id))
    assert state["status"] == "done" and state["counts"]["obligations"] == 4
    # the page is told "AI", never which model; the server keeps it
    assert "model" not in state and "model" not in state["counts"]
    assert db.get(RegulatoryChange, change.id).analysis["model"] == "gpt-6-luna"

    def broken(*a, **k):
        raise RuntimeError("OpenAI is down")
    monkeypatch.setattr(engine, "llm_json", broken)
    engine.run_job("bank", change.id, 7, {"update_change_fields": False})
    db.expire_all()
    failed = engine.analysis_state(db.get(RegulatoryChange, change.id))
    assert failed["status"] == "failed" and "OpenAI is down" in failed["error"]
    assert db.query(RegulatoryObligation).filter_by(deleted_at=None).count() == 4   # a failed run changes nothing


def test_the_upload_form_fills_itself_from_the_circular():
    identify = regulatory_changes.identify_circular
    sbp = ("estos State Bank of Pakistan\n\nHome - Circulars - SH&SFD Circular No. 04\n\n"
           "COST SHARING SCHEME FOR ELECTRIC BIKES AND\n\nRICKSHAWS/LOADERS\n\nSeptember 29, 2025\n\nDear Sir/Madam,")
    assert identify(sbp) == {"source": "SBP", "reference": "SH&SFD Circular No. 04",
                             "title": "Cost Sharing Scheme for Electric Bikes and Rickshaws/Loaders (SH&SFD Circular No. 04)"}
    sama = "Saudi Central Bank\nCircular No. 44047144 dated 2026\nSubject: Outsourcing of Cloud Services\nThe SEC and..."
    assert identify(sama) == {"source": "SAMA", "reference": "Circular No. 44047144 dated 2026",
                              "title": "Outsourcing of Cloud Services (Circular No. 44047144 dated 2026)"}
    # a scan with no text layer: only the file name to go on
    assert identify("", "mas-notice-626.pdf") == {"source": "MAS", "reference": None, "title": None}
    assert identify("Securities and Exchange Commission of Pakistan\nNotice")["source"] is None     # SECP is not the SEC

    app = FastAPI()
    app.include_router(regulatory_changes.router)
    app.dependency_overrides[require_auth] = lambda: None
    got = TestClient(app).post("/regulatory-changes/changes/identify",
                               files={"file": ("circular.txt", sbp.encode(), "text/plain")})
    assert got.status_code == 200 and got.json()["source"] == "SBP", got.text


def test_deleting_a_change_takes_its_obligations_and_control_links(db):
    change = _change(db)
    duty = RegulatoryObligation(tenant_id=1, regulatory_change_id=change.id, summary="Report incidents within 24 hours")
    db.add(duty)
    db.flush()
    db.add(RegulatoryLink(tenant_id=1, regulatory_change_id=change.id, obligation_id=duty.id,
                          target_type="internal_control", target_id=1))
    db.commit()
    app = FastAPI()
    app.include_router(regulatory_changes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    assert TestClient(app).delete(f"/regulatory-changes/changes/{change.id}").status_code == 200
    assert db.query(RegulatoryObligation).count() == 0 and db.query(RegulatoryLink).count() == 0
