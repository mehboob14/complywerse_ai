"""A supplier's paperwork: documents and how long each holds, SOC reports read into fields,
contract clauses, and service levels measured against the contract.

What follows from a SOC review is worked out on read and never shown as a clean
"unqualified" when the auditor found something; the finding a review calls for is
raised once and updated when the review is saved again; a carve-out becomes a
fourth party in one step; a document's coverage window decides when it expires,
here and in the attention queue alike; a missed service level is a monitoring
signal, once. In-memory SQLite.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Tenant, TPRAAuditLog, TPRAContract, TPRAEvidenceLink, TPRAFinding, TPRAFourthParty,
    TPRAMonitoringSignal, TPRASocReview, Vendor, VendorAssessment, VendorSLARecord, get_db,
)
from grc.modules.vendor_risk.routers import monitoring as sla_routes
from grc.modules.vendor_risk.tpra import api, attention, contracts, paperwork, rbac
from grc.routers.auth_router import require_auth

TODAY = datetime.utcnow().date()


def ago(days: int) -> date:
    return TODAY - timedelta(days=days)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="owner", email="owner@acme.test", display_name="Olu Owner", is_active=True),
               GRCUser(id=8, username="ops", email="ops@acme.test", display_name="Opal Ops", is_active=True)])
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=7))
    s.add(Vendor(id=2, tenant_id=1, name="Other Co", status="active", tier="low", owner_id=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(paperwork.router)
    app.include_router(contracts.router)
    app.include_router(sla_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _review(**kw) -> TPRASocReview:
    return TPRASocReview(tenant_id=1, vendor_id=1, opinion=kw.pop("opinion", "unqualified"),
                         exceptions_count=kw.pop("exceptions_count", 0),
                         material_findings=kw.pop("material_findings", False), **kw)


# ── what follows from a review ───────────────────────────────────────────────

def test_too_old_and_bridge_letter_are_worked_out_from_the_period():
    fresh = paperwork.derived(_review(period_end=ago(30)), TODAY)
    assert (fresh["days_since_period_end"], fresh["stale"], fresh["needs_bridge_letter"]) == (30, False, False)

    gap = paperwork.derived(_review(period_end=ago(120)), TODAY)
    assert (gap["stale"], gap["needs_bridge_letter"]) == (False, True)
    covered = _review(period_end=ago(120), bridge_letter="received", bridge_letter_until=ago(10))
    assert paperwork.needs_bridge_letter(covered, TODAY) is False
    lapsed = _review(period_end=ago(300), bridge_letter="received", bridge_letter_until=ago(100))
    assert paperwork.needs_bridge_letter(lapsed, TODAY) is True          # the letter's own date has gone by

    old = paperwork.derived(_review(period_end=ago(400)), TODAY)
    assert old["stale"] is True and paperwork.derived(_review(), TODAY)["stale"] is False


def test_the_verdict_never_says_unqualified_alone_when_the_auditor_found_something():
    assert paperwork.verdict(_review()) == "Unqualified opinion, no exceptions"
    assert paperwork.verdict(_review(exceptions_count=1)) == "Unqualified opinion with 1 exception"
    assert paperwork.verdict(_review(material_findings=True, exceptions_count=3)) == \
        "Unqualified opinion with material findings and 3 exceptions"
    assert paperwork.verdict(_review(opinion="qualified")) == "Qualified opinion"
    tones = [paperwork.derived(r, TODAY)["verdict_tone"] for r in
             (_review(), _review(exceptions_count=2), _review(opinion="adverse"))]
    assert tones == ["green", "amber", "red"]


# ── findings ─────────────────────────────────────────────────────────────────

def _body(**kw):
    return {"report_kind": "soc2", "report_type": "type2", "period_start": ago(400).isoformat(),
            "period_end": ago(35).isoformat(), "auditor_firm": "Able & Co", **kw}


def test_a_review_raises_its_finding_once_and_updates_it_on_a_new_save(db, client):
    made = client.post("/vendors/1/soc-reviews", json=_body(exceptions_count=2, exceptions_summary="Two late leavers"))
    assert made.status_code == 201, made.text
    review = made.json()
    assert review["verdict"] == "Unqualified opinion with 2 exceptions" and review["reviewer_name"] == "Olu Owner"
    finding = db.query(TPRAFinding).one()
    assert (finding.severity, finding.title) == ("medium", "2 exceptions in the SOC 2 Type 2 report")
    assert "Two late leavers" in finding.description and finding.status == "open"
    # there was no assessment, so the first one was opened for it
    assessment = db.get(VendorAssessment, finding.assessment_id)
    assert assessment.vendor_id == 1 and db.get(Vendor, 1).active_assessment_id == assessment.id
    assert review["findings"] == [{"id": finding.id, "severity": "medium", "status": "open",
                                   "title": finding.title, "assessment_id": assessment.id}]

    rid = review["id"]
    assert client.put(f"/vendors/1/soc-reviews/{rid}", json={"notes": "Read twice"}).status_code == 200
    assert db.query(TPRAFinding).count() == 1                                   # saved again: no second finding
    worse = client.put(f"/vendors/1/soc-reviews/{rid}", json={"material_findings": True}).json()
    db.refresh(finding)
    assert db.query(TPRAFinding).count() == 1 and finding.severity == "high"   # the open one follows the review
    assert worse["raised_finding_ids"] == [finding.id]

    finding.status = "closed"                                                   # remediated
    db.commit()
    client.put(f"/vendors/1/soc-reviews/{rid}", json={"notes": "Closed out"})
    assert db.query(TPRAFinding).count() == 1                                   # nothing new at the same severity
    qualified = client.put(f"/vendors/1/soc-reviews/{rid}", json={"opinion": "qualified"}).json()
    critical = db.query(TPRAFinding).filter(TPRAFinding.severity == "critical").one()
    assert qualified["raised_finding_ids"] == [finding.id, critical.id]
    assert critical.title == "Qualified opinion on the SOC 2 Type 2 report" and critical.is_critical_control_fail
    assert db.get(TPRAFinding, finding.id).deleted_at is None                   # a finding is never deleted

    audit = {(a.entity, a.action) for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.vendor_id == 1)}
    assert {("soc_review", "create"), ("soc_review", "update"), ("finding", "create"), ("finding", "update")} <= audit


def test_a_clean_review_raises_nothing_and_a_critical_one_suspends_an_approved_supplier(db, client):
    assert client.post("/vendors/1/soc-reviews", json=_body()).status_code == 201
    assert db.query(TPRAFinding).count() == 0

    a = VendorAssessment(tenant_id=1, vendor_id=1, status="approved", lifecycle_status="active", version_no=1,
                         current_stage="monitoring")
    db.add(a)
    db.flush()
    db.get(Vendor, 1).active_assessment_id = a.id
    db.commit()
    client.post("/vendors/1/soc-reviews", json=_body(opinion="adverse"))
    finding = db.query(TPRAFinding).one()
    assert (finding.assessment_id, finding.severity) == (a.id, "critical")
    assert db.get(Vendor, 1).status == "suspended"
    assert db.query(VendorAssessment).count() == 1                              # the existing assessment was used


def test_the_review_lists_the_latest_period_first_and_archives(db, client):
    client.post("/vendors/1/soc-reviews", json=_body(period_start=ago(800).isoformat(), period_end=ago(440).isoformat()))
    latest = client.post("/vendors/1/soc-reviews", json=_body()).json()
    client.post("/vendors/1/soc-reviews", json={"report_kind": "soc3"})          # no period recorded: last
    items = client.get("/vendors/1/soc-reviews").json()["items"]
    assert [i["period_end"] for i in items] == [ago(35).isoformat(), ago(440).isoformat(), None]
    assert items[1]["stale"] is True and items[0]["needs_bridge_letter"] is False
    assert client.post(f"/vendors/1/soc-reviews/{latest['id']}/archive").status_code == 200
    assert len(client.get("/vendors/1/soc-reviews").json()["items"]) == 2
    assert client.put(f"/vendors/1/soc-reviews/{latest['id']}", json={"notes": "x"}).status_code == 404
    assert client.post("/vendors/1/soc-reviews", json=_body(period_end=ago(500).isoformat())).status_code == 400


def test_cuecs_need_platform_owners_and_keep_their_ids(db, client):
    bad = client.post("/vendors/1/soc-reviews", json=_body(cuecs=[{"text": "Review access", "owner_id": 404}]))
    assert bad.status_code == 400
    made = client.post("/vendors/1/soc-reviews", json=_body(cuecs=[
        {"text": "  Review  user access quarterly ", "owner_id": 8},
        {"text": "Send leavers within a day", "status": "in_place"}])).json()
    first = made["cuecs"][0]
    assert (first["text"], first["owner_name"], first["status"]) == ("Review user access quarterly", "Opal Ops", "open")
    again = client.put(f"/vendors/1/soc-reviews/{made['id']}", json={"cuecs": [
        {**first, "status": "in_place"}]}).json()
    assert again["cuecs"][0]["id"] == first["id"] and again["cuecs"][0]["status"] == "in_place"


# ── the report file, and documents ───────────────────────────────────────────

@pytest.fixture()
def saved_files(monkeypatch):
    async def save(db_, tenant_id, name, evidence_type, file, user_id):
        ev = Evidence(tenant_id=tenant_id, name=name, file_name=file.filename, evidence_type=evidence_type)
        db_.add(ev)
        db_.flush()
        return ev

    monkeypatch.setattr(api, "_save_evidence_file", save)


def test_the_report_is_kept_once_as_the_suppliers_assurance(db, client, saved_files):
    review = client.post("/vendors/1/soc-reviews", json=_body()).json()
    assert client.post(f"/vendors/1/soc-reviews/{review['id']}/report",
                       files={"file": ("run.exe", b"MZ")}).status_code == 400
    up = client.post(f"/vendors/1/soc-reviews/{review['id']}/report", files={"file": ("soc2.pdf", b"%PDF-1.4")})
    assert up.status_code == 200, up.text
    ev = db.query(Evidence).one()
    assert up.json()["evidence"] == {"id": ev.id, "name": "Payroll Co: SOC 2 Type 2 report", "file_name": "soc2.pdf"}
    link = db.query(TPRAEvidenceLink).one()
    assert (link.vendor_id, link.evidence_id, link.requirement) == (1, ev.id, "assurance_report")

    other = client.post("/vendors/1/soc-reviews", json=_body(evidence_id=ev.id))      # the same file from the library
    assert other.status_code == 201 and db.query(TPRAEvidenceLink).count() == 1
    assert client.post("/vendors/1/soc-reviews", json=_body(evidence_id=999)).status_code == 404
    docs = client.get("/vendors/1/paperwork").json()["items"]
    assert [(d["name"], d["kind"], d["state"]) for d in docs] == [
        ("Payroll Co: SOC 2 Type 2 report", "Independent assurance: a SOC 2 report or ISO 27001 certificate", "no_date")]


def _document(db, name, expiry=None, vendor_id=1, links=1, **link_kw):
    ev = Evidence(tenant_id=1, name=name, status="approved",
                  expiry_date=datetime(expiry.year, expiry.month, expiry.day) if expiry else None)
    db.add(ev)
    db.flush()
    rows = [TPRAEvidenceLink(tenant_id=1, vendor_id=vendor_id, evidence_id=ev.id, **link_kw) for _ in range(links)]
    db.add_all(rows)
    db.commit()
    return ev, rows


def test_a_documents_coverage_window_decides_when_it_runs_out(db, client):
    _document(db, "Insurance", links=3)                                           # linked to three questions
    _document(db, "ISO 27001", expiry=TODAY + timedelta(days=200))
    _document(db, "Pen test", expiry=TODAY - timedelta(days=5))
    _document(db, "Someone else's", vendor_id=2)
    body = client.get("/vendors/1/paperwork").json()
    assert [(d["name"], d["state"]) for d in body["items"]] == [
        ("Pen test", "expired"), ("Insurance", "no_date"), ("ISO 27001", "in_date")]
    assert body["counts"] == {"expired": 1, "expiring": 0, "no_date": 1, "in_date": 1}

    insurance = body["items"][1]
    assert client.put(f"/vendors/1/paperwork/{insurance['link_id']}", json={
        "coverage_from": TODAY.isoformat(), "coverage_to": (TODAY - timedelta(days=1)).isoformat()}).status_code == 400
    done = client.put(f"/vendors/1/paperwork/{insurance['link_id']}", json={
        "coverage_from": ago(300).isoformat(), "coverage_to": (TODAY + timedelta(days=45)).isoformat()})
    assert done.status_code == 200, done.text
    row = next(d for d in done.json()["items"] if d["name"] == "Insurance")
    assert (row["state"], row["days_left"], row["reviewed_by_name"]) == ("expiring", 45, "Olu Owner")
    assert {link.coverage_to for link in db.query(TPRAEvidenceLink).filter(TPRAEvidenceLink.evidence_id == row["evidence_id"])} \
        == {TODAY + timedelta(days=45)}                                           # every link to it says the same

    iso = next(d for d in done.json()["items"] if d["name"] == "ISO 27001")
    narrowed = client.put(f"/vendors/1/paperwork/{iso['link_id']}", json={"coverage_to": (TODAY + timedelta(days=20)).isoformat()})
    iso = next(d for d in narrowed.json()["items"] if d["name"] == "ISO 27001")
    assert (iso["ends_on"], iso["state"]) == ((TODAY + timedelta(days=20)).isoformat(), "expiring")   # the earlier date
    reviewed = client.put(f"/vendors/1/paperwork/{iso['link_id']}", json={}).json()                  # just reviewed
    assert next(d for d in reviewed["items"] if d["name"] == "ISO 27001")["coverage_to"] == (TODAY + timedelta(days=20)).isoformat()
    assert client.put(f"/vendors/2/paperwork/{iso['link_id']}", json={}).status_code == 404
    assert db.query(TPRAAuditLog).filter_by(entity="evidence", action="review").count() == 3


def test_the_attention_queue_reads_the_same_dates(db):
    _document(db, "Insurance", coverage_to=TODAY + timedelta(days=50))            # no expiry, a window
    _document(db, "DPA", coverage_to=TODAY + timedelta(days=90))                  # not yet
    _document(db, "ISO 27001", expiry=TODAY + timedelta(days=30))                 # beyond the 14-day reminders
    _document(db, "BCP test", expiry=TODAY + timedelta(days=300), coverage_to=TODAY - timedelta(days=2))
    items = {i["title"].split(" from ")[0]: i for i in attention.open_items(db, 1, TODAY, {})
             if i["condition"] == "certificate_expiring"}
    assert set(items) == {"Insurance", "ISO 27001", "BCP test"}
    assert items["Insurance"]["badge"] == "Expires in 50 days" and items["Insurance"]["tone"] == "amber"
    assert items["BCP test"]["badge"] == "Expired 2 days ago" and items["BCP test"]["tone"] == "red"


# ── fourth parties ───────────────────────────────────────────────────────────

def test_a_carve_out_becomes_a_fourth_party_once(db, client):
    db.add(TPRAFourthParty(tenant_id=1, vendor_id=1, name="Amazon Web Services", platform="AWS", source="manual"))
    db.commit()
    review = client.post("/vendors/1/soc-reviews", json=_body(subservice_orgs=[
        {"name": "Acme Data Centres Ltd", "method": "carve_out"}, {"name": "Amazon Web Services", "method": "carve_out"},
        {"name": "Mail Co", "method": "inclusive", "fourth_party_id": 999}])).json()
    assert review["subservice_orgs"][2]["fourth_party_id"] is None                # not one of the supplier's
    assert client.post(f"/vendors/1/soc-reviews/{review['id']}/fourth-parties", json={"name": "Nobody"}).status_code == 404

    added = client.post(f"/vendors/1/soc-reviews/{review['id']}/fourth-parties", json={"name": "acme data centres"})
    assert added.status_code == 200, added.text
    fp = db.query(TPRAFourthParty).filter(TPRAFourthParty.name == "Acme Data Centres Ltd").one()
    assert (fp.vendor_id, fp.source, fp.created_by) == (1, "declared", 7) and "carved out" in fp.notes
    assert added.json()["subservice_orgs"][0]["fourth_party_id"] == fp.id
    client.post(f"/vendors/1/soc-reviews/{review['id']}/fourth-parties", json={"name": "Acme Data Centres Ltd"})
    assert db.query(TPRAFourthParty).count() == 2                                 # added once
    linked = client.post(f"/vendors/1/soc-reviews/{review['id']}/fourth-parties", json={"name": "Amazon Web Services"}).json()
    aws = db.query(TPRAFourthParty).filter(TPRAFourthParty.name == "Amazon Web Services").one()
    assert linked["subservice_orgs"][1]["fourth_party_id"] == aws.id and db.query(TPRAFourthParty).count() == 2


# ── contract clauses ─────────────────────────────────────────────────────────

def test_contract_clauses_are_recorded_and_leave_the_terms_version_alone(db, client):
    c = TPRAContract(tenant_id=1, vendor_id=1, title="MSA", status="active", row_version=3)
    db.add(c)
    db.commit()
    assert client.put(f"/contracts/{c.id}/clauses", json={"breach_notification_hours": -1}).status_code in (400, 422)
    done = client.put(f"/contracts/{c.id}/clauses", json={"right_to_audit": True, "exit_data_return": False,
                                                          "breach_notification_hours": 24})
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["right_to_audit"], body["exit_data_return"], body["subprocessor_terms"], body["breach_notification_hours"]) \
        == (True, False, None, 24)
    assert body["row_version"] == 3                                               # the drawer saves its terms next
    row = db.query(TPRAAuditLog).filter_by(entity="contract", action="update").one()
    assert row.extra["changes"] == {"right_to_audit": [None, True], "exit_data_return": [None, False],
                                    "breach_notification_hours": [None, 24]}
    client.put(f"/contracts/{c.id}/clauses", json={"right_to_audit": None})
    assert client.get(f"/contracts/{c.id}").json()["right_to_audit"] is None and db.get(TPRAContract, c.id).exit_data_return is False
    assert contracts.clean({"security_addendum": "yes"}) == {"security_addendum": True}


# ── service levels ───────────────────────────────────────────────────────────

def test_a_level_is_met_or_missed_by_its_numbers(db, client):
    assert sla_routes.sla_met(99.9, 99.95, "higher_is_better", False) is True
    assert sla_routes.sla_met(4, 6, "lower_is_better", True) is False
    assert sla_routes.sla_met(None, 6, "lower_is_better", False) is False        # the numbers cannot say
    c = TPRAContract(tenant_id=1, vendor_id=1, title="SLA", contract_type="sla", status="active")
    theirs = TPRAContract(tenant_id=1, vendor_id=2, title="Not ours", status="active")
    db.add_all([c, theirs])
    db.commit()
    assert client.post("/vendors/1/sla", json={"sla_metric": "Uptime", "target_value": 99.9,
                                               "actual_value": 99.95}).status_code == 400        # which way is good?
    assert client.post("/vendors/1/sla", json={"sla_metric": "Uptime", "contract_id": theirs.id}).status_code == 400
    met = client.post("/vendors/1/sla", json={"sla_metric": "Uptime", "target_value": 99.9, "actual_value": 99.95,
                                              "unit": "%", "direction": "higher_is_better", "is_compliant": False,
                                              "contract_id": c.id}).json()
    assert (met["is_compliant"], met["contract_id"], met["signal_id"]) == (True, c.id, None)
    assert db.query(TPRAMonitoringSignal).count() == 0


def test_a_missed_level_is_a_monitoring_signal_once(db, client):
    missed = client.post("/vendors/1/sla", json={"sla_metric": "Uptime", "target_value": 99.9, "actual_value": 99.2,
                                                 "unit": "%", "direction": "higher_is_better"})
    assert missed.status_code == 201, missed.text
    record = missed.json()
    assert record["is_compliant"] is False and record["signal_id"]
    signal = db.get(TPRAMonitoringSignal, record["signal_id"])
    assert (signal.signal_type, signal.severity, signal.source, signal.external_id) == (
        "sla", "medium", "SLA tracking", f"sla:{record['id']}")
    assert signal.title == "Payroll Co missed a service level: Uptime"
    assert signal.detail.startswith("Measured 99.2% against a target of 99.9% (higher is better)")
    assert signal.triggered_assessment_id is None                                # a high-tier supplier waits for a high signal

    again = client.put(f"/vendors/1/sla/{record['id']}", json={"notes": "Outage on the 3rd"}).json()
    assert again["signal_id"] is None and db.query(TPRAMonitoringSignal).count() == 1
    fixed = client.put(f"/vendors/1/sla/{record['id']}", json={"actual_value": 99.95}).json()
    assert fixed["is_compliant"] is True
    assert client.put(f"/vendors/1/sla/{record['id']}", json={"sla_metric": None}).json()["sla_metric"] == "Uptime"
    assert client.put("/vendors/1/sla/999", json={"notes": "x"}).status_code == 404
    queue = {i["condition"] for i in attention.open_items(db, 1, TODAY, {}) if i["record_type"] == "signal"}
    assert queue == {"signal_new"}
    listed = client.get("/vendors/1/sla").json()
    assert listed["items"][0]["direction"] == "higher_is_better" and listed["compliance_rate"] == 100.0
    audit = [(a.entity, a.action) for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "sla")]
    assert audit[0] == ("sla", "create") and ("sla", "update") in audit


def test_a_missed_level_reopens_a_critical_suppliers_assessment(db, client):
    db.get(Vendor, 1).tier = "critical"                                           # reassessed on a medium signal
    db.commit()
    record = client.post("/vendors/1/sla", json={"sla_metric": "Response time", "target_value": 4, "actual_value": 9,
                                                 "unit": "hours", "direction": "lower_is_better"}).json()
    signal = db.get(TPRAMonitoringSignal, record["signal_id"])
    assert signal.triggered_reassessment and signal.triggered_assessment_id
    assert signal.detail.startswith("Measured 9 hours against a target of 4 hours (lower is better)")


def test_existing_databases_get_the_new_columns():
    from grc.modules.compliance.schema_migrations import _COLUMN_ADDS

    added = {(t, c) for t, c, _ddl, _ix in _COLUMN_ADDS}
    assert {("grc_tpra_evidence_links", "coverage_from"), ("grc_tpra_evidence_links", "coverage_to"),
            ("grc_tpra_evidence_links", "reviewed_by"), ("grc_tpra_evidence_links", "reviewed_at"),
            ("grc_vendor_sla_records", "contract_id"), ("grc_vendor_sla_records", "unit"),
            ("grc_vendor_sla_records", "direction")} <= added
    assert {("grc_tpra_contracts", k) for k in contracts.CLAUSE_FIELDS} <= added
    assert VendorSLARecord.__table__.c.direction is not None
