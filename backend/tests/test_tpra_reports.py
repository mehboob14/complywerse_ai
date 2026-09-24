"""The regulator and board pack: generated, frozen, approved, and shared read-only.

The committee pack counts what happened in its period and nothing else. Cycle
time needs the moment an assessment was submitted kept apart from the moment it
was decided. The register maps contract obligations onto the frameworks in scope
by requirement code, never by SCF prose. A report shared with an examiner is the
frozen copy, behind a link that expires, can be withdrawn, and logs every view.
"""
import json
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, BcmBiaDependency, BcmBiaRecord, BcmPlan, Evidence, GRCUser, MetricSnapshot, SCFControl, SCFMapping,
    SCFMappingReview, SCFRelease, SCFScope, Tenant, TPRAApproval, TPRAAuditLog, TPRAContract, TPRAControlObligation,
    TPRAEvidenceLink, TPRAFinding, TPRAFourthParty, TPRAMonitoringSignal, TPRAPlatformAlias, TPRARemediation,
    TPRAReport, TPRARiskAcceptance, TPRAStageInstance, TPRATemplateVersion, TPRATieringConfig, TPRAVendorLink, Vendor,
    VendorAssessment, VendorIncident, VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.tpra import rbac, reports
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, TPRAStageInstance, TPRAApproval, TPRAAuditLog, TPRAFinding,
           TPRARemediation, TPRARiskAcceptance, TPRAMonitoringSignal, VendorIncident, TPRAFourthParty, TPRAPlatformAlias,
           TPRAVendorLink, BcmPlan, BcmBiaRecord, BcmBiaDependency, TPRAContract, TPRAControlObligation, SCFRelease,
           SCFControl, SCFMapping, SCFScope, SCFMappingReview, TPRAReport, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, TPRATemplateVersion, TPRATieringConfig, Evidence, TPRAEvidenceLink,
           MetricSnapshot]
Q3 = (date(2026, 7, 1), date(2026, 9, 30))
DAY = datetime(2026, 7, 1, 9)
TODAY = date(2026, 10, 2)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(reports.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _vendor(db, name, tier="medium", **kw):
    v = Vendor(tenant_id=1, name=name, status=kw.pop("status", "active"), tier=tier, **kw)
    db.add(v)
    db.flush()
    return v


def _decided(db, vendor, begun, submitted, decided, decision="approve"):
    """An assessment started at `begun`, submitted for approval at `submitted`, decided at `decided`."""
    a = VendorAssessment(tenant_id=1, vendor_id=vendor.id, created_at=begun)
    db.add(a)
    db.flush()
    db.add(TPRAStageInstance(tenant_id=1, vendor_id=vendor.id, assessment_id=a.id, stage_key="approval", stage_order=8,
                             status="completed", started_at=submitted, completed_at=decided))
    db.add(TPRAApproval(tenant_id=1, vendor_id=vendor.id, assessment_id=a.id, decision=decision, created_at=decided,
                        residual_rating="medium", conditions=["Encrypt backups"] if decision != "approve" else []))
    db.flush()
    return a


def test_quarters_and_their_labels():
    assert reports.quarter_of(date(2026, 9, 24)) == Q3
    assert reports.quarter_of(date(2026, 11, 1)) == (date(2026, 10, 1), date(2026, 12, 31))
    assert reports.last_quarter(date(2026, 1, 15)) == (date(2025, 10, 1), date(2025, 12, 31))
    assert reports.period_label(*Q3) == "Q3 2026"
    assert reports.period_label(date(2026, 7, 1), date(2026, 8, 15)) == "01 Jul 2026 to 15 Aug 2026"


def test_the_wait_for_a_decision_is_measured_from_submission_not_from_the_start(db):
    v = _vendor(db, "Acme Hosting")
    _decided(db, v, DAY, DAY + timedelta(days=20), DAY + timedelta(days=30))
    _decided(db, v, DAY, DAY + timedelta(days=5), DAY + timedelta(days=10))
    _decided(db, v, DAY - timedelta(days=200), DAY - timedelta(days=100), DAY - timedelta(days=90))   # decided last quarter
    db.add(VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, token="q-1", status="accepted", created_at=DAY,
                                       submitted_at=DAY + timedelta(days=6), accepted_at=DAY + timedelta(days=8)))
    a = db.query(VendorAssessment).first()
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, title="No MFA", created_at=DAY)
    db.add(f)
    db.flush()
    db.add_all([TPRARemediation(tenant_id=1, finding_id=f.id, status="completed", completed_at=DAY + timedelta(days=12)),
                TPRARemediation(tenant_id=1, finding_id=f.id, status="completed", completed_at=DAY + timedelta(days=15))])
    db.commit()

    m = reports.measures(db, 1, *Q3)
    assert m["cycle"] == {"median_days": 20.0, "count": 2}
    assert m["decision_wait"] == {"median_days": 7.5, "count": 2}
    assert m["questionnaire_turnaround"] == {"median_days": 6.0, "count": 1}
    assert m["review"] == {"median_days": 2.0, "count": 1}
    assert m["remediation"] == {"median_days": 12.0, "count": 1}      # a finding counts once, at its first fix


def test_coverage_is_in_date_overdue_or_never_approved(db):
    fresh, late, never = _vendor(db, "Fresh"), _vendor(db, "Late"), _vendor(db, "Never")
    _vendor(db, "Gone", status="retired")
    fresh.next_reassessment_date = datetime(2027, 1, 1)
    late.next_reassessment_date = datetime(2026, 9, 1)
    for v in (fresh, late):
        _decided(db, v, DAY, DAY, DAY)
    db.commit()
    cov = reports.coverage(db, 1, TODAY)
    assert cov["states"] == {fresh.id: "in_date", late.id: "overdue", never.id: "never"}
    assert (cov["active"], cov["coverage_pct"], cov["overdue_pct"]) == (3, 33.3, 33.3)


def test_the_committee_pack_counts_its_period_only(db):
    pay = _vendor(db, "Payments Co", tier="critical", risk_rating="high")
    crm = _vendor(db, "CRM Co", tier="low", risk_rating="low")
    pay.next_reassessment_date = datetime(2026, 9, 1)
    in_q = _decided(db, pay, DAY, DAY + timedelta(days=3), DAY + timedelta(days=9), decision="approve_with_conditions")
    _decided(db, crm, DAY - timedelta(days=120), DAY - timedelta(days=100), DAY - timedelta(days=95))
    db.add(TPRAAuditLog(tenant_id=1, vendor_id=crm.id, entity="tiering", action="override", from_value="medium",
                        to_value="low", reason="No customer data", created_at=DAY + timedelta(days=4)))
    old = TPRAFinding(tenant_id=1, vendor_id=pay.id, assessment_id=in_q.id, title="Old gap", severity="critical",
                      status="open", created_at=datetime(2026, 5, 1))
    new = TPRAFinding(tenant_id=1, vendor_id=pay.id, assessment_id=in_q.id, title="New gap", severity="high",
                      status="open", created_at=datetime(2026, 9, 20))
    db.add_all([old, new])
    db.flush()
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=new.id, accepted_at=DAY + timedelta(days=40),
                              expiry=datetime(2027, 1, 1)))
    db.add(TPRARemediation(tenant_id=1, finding_id=old.id, status="open", due_date=datetime(2026, 9, 1)))
    db.add_all([VendorIncident(tenant_id=1, vendor_id=pay.id, title="Outage", severity="high", occurred_at=DAY),
                VendorIncident(tenant_id=1, vendor_id=pay.id, title="Last year", occurred_at=datetime(2025, 7, 1))])
    db.add_all([
        TPRAMonitoringSignal(tenant_id=1, vendor_id=pay.id, signal_type="breach", severity="medium", title="Breach",
                             occurred_at=DAY + timedelta(days=30)),
        TPRAMonitoringSignal(tenant_id=1, vendor_id=pay.id, signal_type="breach", severity="high", title="Rumour",
                             verified=False, occurred_at=DAY),
        TPRAMonitoringSignal(tenant_id=1, vendor_id=crm.id, signal_type="news", severity="low", title="Noise",
                             occurred_at=DAY),
    ])
    db.commit()

    pack = reports.committee_pack(db, 1, *Q3, TODAY)
    sections = {s["key"]: s for s in pack["sections"]}
    assert pack["title"].endswith("Q3 2026")
    assert sections["portfolio"]["rows"] == [["Critical", 0, 1, 0, 0, 0, 1], ["Low", 0, 0, 0, 1, 0, 1]]
    assert sections["overdue"]["rows"] == [["Payments Co", "Critical", "2026-09-01", 31]]
    assert [r[2] for r in sections["decisions"]["rows"]] == ["Tier overridden", "Approve with conditions", "Risk accepted"]
    assert sections["decisions"]["rows"][1][3] == "residual medium, 1 condition"
    assert [(r[2], r[4]) for r in sections["incidents"]["rows"]] == [("Outage", "Incident log"),
                                                                    ("Breach", "Monitoring: breach")]
    assert sections["ageing"]["rows"] == [["Critical", 0, 0, 0, 1, 1], ["High", 1, 0, 0, 0, 1]]
    assert sections["ageing"]["note"] == "Remediation plans past their due date: 1."
    assert {h["label"]: h["value"] for h in pack["headline"]}["Incidents in the period"] == 2


def _scf(db, scope_slugs):
    rel = SCFRelease(version="2026.2", is_current=True, import_status="ready")
    db.add(rel)
    db.flush()
    db.add(SCFControl(release_id=rel.id, scf_id="TPM-05", name="PROSE THAT MUST NOT TRAVEL"))
    for slug, code in (("iso_27001", "A.5.19"), ("soc2", "CC9.2"), ("nist_csf", "GV.SC-05")):
        db.add(SCFMapping(release_id=rel.id, scf_id="TPM-05", source_slug=slug, requirement_code=code,
                          provenance="resolver"))
    db.add(SCFScope(tenant_id=1, name="Default", release_id=rel.id, framework_slugs=scope_slugs, is_default=True))
    db.flush()


def test_the_register_maps_obligations_by_code_to_the_frameworks_in_scope(db):
    pay = _vendor(db, "Zenvia Payments Ltd", tier="critical")
    crm = _vendor(db, "CRM Co", tier="low")
    plan = BcmPlan(tenant_id=1, title="Finance continuity")
    db.add(plan)
    db.flush()
    cards = BcmBiaRecord(tenant_id=1, plan_id=plan.id, process_name="Take card payments", criticality_rating="critical",
                         rto_hours=4, rpo_hours=1)
    mail = BcmBiaRecord(tenant_id=1, plan_id=plan.id, process_name="Send newsletters", criticality_rating="low")
    db.add_all([cards, mail])
    db.flush()
    db.add(BcmBiaDependency(tenant_id=1, bia_id=cards.id, dependency_type="vendor", name="Zenvia Payments",
                            external_bcp_status="tested"))
    db.add(TPRAVendorLink(tenant_id=1, vendor_id=crm.id, target_type="bia_process", target_id=mail.id))
    contract = TPRAContract(tenant_id=1, vendor_id=pay.id, title="Master services")
    db.add(contract)
    db.flush()
    db.add_all([TPRAControlObligation(tenant_id=1, contract_id=contract.id, obligation="Flow down our security terms",
                                      control_ref="tpm-05"),
                TPRAControlObligation(tenant_id=1, contract_id=contract.id, obligation="Supplier review each year",
                                      control_ref="A.5.19"),
                TPRAControlObligation(tenant_id=1, contract_id=contract.id, obligation="Something bespoke",
                                      control_ref="OUR-7")])
    _scf(db, ["iso_27001", "soc2"])
    db.commit()

    reg = reports.register(db, 1, TODAY)
    sections = {s["key"]: s for s in reg["sections"]}
    funcs = sections["functions"]["rows"]
    assert [(r[0], r[1], r[5], r[11]) for r in funcs] == [("Take card payments", "Yes", "Zenvia Payments Ltd", "Tested"),
                                                          ("Send newsletters", "No", "CRM Co", None)]
    rows = {r[3]: r for r in sections["obligations"]["rows"]}
    assert rows["tpm-05"][4] == "TPM-05" and rows["A.5.19"][4] == "TPM-05" and rows["OUR-7"][4] is None
    for ref in ("tpm-05", "A.5.19"):
        assert "A.5.19" in rows[ref][5] and "CC9.2" in rows[ref][5] and "GV.SC-05" not in rows[ref][5]
    assert {r[1] for r in sections["regimes"]["rows"]} == {2}
    assert "PROSE THAT MUST NOT TRAVEL" not in json.dumps(reg)

    db.add(SCFMappingReview(tenant_id=1, source_slug="soc2", requirement_code="CC9.2", scf_id="TPM-05",
                            verdict="suppressed", reviewed_by=7))
    db.commit()
    rows = {r[3]: r for r in reports.register(db, 1, TODAY)["sections"][1]["rows"]}
    assert "CC9.2" not in rows["tpm-05"][5] and "A.5.19" in rows["tpm-05"][5]


def test_a_vendor_file_carries_answers_evidence_and_the_decision_trail(db):
    v = _vendor(db, "Acme Hosting", tier="high", risk_rating="medium")
    a = _decided(db, v, DAY, DAY + timedelta(days=2), DAY + timedelta(days=5))
    t = VendorQuestionnaireTemplate(tenant_id=1, name="Security basics", questions=[
        {"id": "mfa", "text": "Do you enforce MFA?", "type": "yes_no"},
        {"id": "dr", "text": "Do you test recovery?", "type": "yes_no"}])
    db.add(t)
    db.flush()
    db.add(VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, assessment_id=a.id, template_id=t.id, token="q-2",
                                       status="accepted", responses={"mfa": "yes", "dr": "no"}, created_at=DAY,
                                       submitted_at=DAY + timedelta(days=1), attested_name="Jo Vendor"))
    ev = Evidence(tenant_id=1, name="SOC 2 report", expiry_date=datetime(2026, 8, 1))
    db.add(ev)
    db.flush()
    db.add(TPRAEvidenceLink(tenant_id=1, vendor_id=v.id, assessment_id=a.id, evidence_id=ev.id,
                            requirement="assurance_report"))
    db.commit()

    doc = reports.vendor_file(db, 1, v, TODAY)
    sections = {s["key"]: s for s in doc["sections"]}
    assert sections["assessments"]["rows"][0][3:6] == ["2026-07-03", "2026-07-06", "Approve"]
    assert sections["answers"]["rows"] == [["Do you enforce MFA?", "Yes", "100%"], ["Do you test recovery?", "No", "0%"]]
    assert sections["evidence"]["rows"] == [["SOC 2 report", "Assurance report", sections["evidence"]["rows"][0][2],
                                             "2026-08-01", "Expired"]]
    assert sections["decisions"]["rows"][0][2] == "Approve"


def test_a_report_is_frozen_then_approved_then_shared_and_every_view_logged(db, http):
    _vendor(db, "Acme Hosting")
    db.commit()
    made = http.post("/tpra/reports", json={"kind": "register"})
    assert made.status_code == 201, made.text
    rid, frozen = made.json()["id"], made.json()["content"]
    _vendor(db, "Later Co")
    db.commit()
    assert http.get(f"/tpra/reports/{rid}").json()["content"] == frozen

    assert http.post(f"/tpra/reports/{rid}/share", json={"days": 7}).status_code == 409      # not approved yet
    assert http.post(f"/tpra/reports/{rid}/approve").status_code == 200
    assert http.post(f"/tpra/reports/{rid}/approve").status_code == 409
    assert http.delete(f"/tpra/reports/{rid}").status_code == 409                            # stays on record
    assert http.post(f"/tpra/reports/{rid}/share", json={"days": 45}).status_code == 422     # 30 days at most

    first = http.post(f"/tpra/reports/{rid}/share", json={"days": 7}).json()["token"]
    assert db.get(TPRAReport, rid).share_token_hash != first                          # only the hash is kept
    seen = http.get(f"/tpra/examiner/{first}")
    assert seen.status_code == 200 and seen.json()["content"] == frozen
    assert http.get("/tpra/reports").json()["items"][0]["share"]["views"] == 1
    assert db.query(TPRAAuditLog).filter_by(entity="report", action="examiner_view").one().extra["ip"]

    second = http.post(f"/tpra/reports/{rid}/share", json={"days": 7}).json()["token"]
    assert http.get(f"/tpra/examiner/{first}").status_code == 404                           # a new link replaces the old
    assert http.get(f"/tpra/examiner/{second}").status_code == 200
    assert http.delete(f"/tpra/reports/{rid}/share").json()["share"]["active"] is False
    assert http.get(f"/tpra/examiner/{second}").status_code == 404

    third = http.post(f"/tpra/reports/{rid}/share", json={"days": 1}).json()["token"]
    db.get(TPRAReport, rid).share_expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert http.get(f"/tpra/examiner/{third}").status_code == 404
    assert http.get("/tpra/examiner/not-a-token").status_code == 404


def test_drafts_can_be_discarded_and_bad_requests_are_refused(db, http):
    rid = http.post("/tpra/reports", json={"kind": "committee_pack"}).json()["id"]
    assert db.get(TPRAReport, rid).period_start == reports.last_quarter(date.today())[0]
    assert http.delete(f"/tpra/reports/{rid}").status_code == 204
    assert http.get(f"/tpra/reports/{rid}").status_code == 404
    assert http.post("/tpra/reports", json={"kind": "vendor_file"}).status_code == 400
    assert http.get("/tpra/reports/preview", params={"kind": "committee_pack", "period_start": "2026-09-30",
                                                     "period_end": "2026-07-01"}).status_code == 400


def test_the_daily_snapshot_makes_trends_a_read(db):
    v = _vendor(db, "Acme Hosting")
    v.next_reassessment_date = datetime(2027, 1, 1)
    _decided(db, v, datetime(2026, 9, 1), datetime(2026, 9, 10), datetime(2026, 9, 20))
    db.commit()
    assert reports.write_snapshot(db, 1, TODAY) == 4       # coverage, overdue, cycle and decision wait
    got = {m.metric: m.value for m in db.query(MetricSnapshot)}
    assert got["tprm_coverage_pct"] == 100.0 and got["tprm_overdue_pct"] == 0.0
    assert got["tprm_cycle_days"] == 19.0 and got["tprm_decision_wait_days"] == 10.0
