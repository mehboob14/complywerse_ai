"""Uploading the register workbook: preview first, then import.

Preview must write nothing — the monthly pack is the bank's own record, and it
gets looked at before it lands.
"""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

import grc.models as m
from grc.models import get_db
from grc.modules.issue_management.routers import audit_register as api
from grc.routers.auth_router import require_auth

HEADERS = [
    "#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
    "Issue Name", "Issue", "Owner", "Title", "LOB", "Target Date",
    "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail",
]


@pytest.fixture
def workbook(tmp_path):
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 9, 20)])
    sheet.append(HEADERS)
    sheet.append([1, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-1", "High",
                  "Enterprise Risk Management", "The OCC identified a gap", "Rivera, P",
                  "Director", "ERM", date(2026, 3, 31), "IP", ""])
    sheet.append([2, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-2", "Low",
                  "Third Party Risk", "Vendor oversight gap", "Nobody Here", "Director", "TPRM",
                  "", "NS", ""])
    path = tmp_path / "register.xlsx"
    wb.save(path)
    return path


@pytest.fixture
def client():
    from grc.main import app

    # TestClient runs the endpoint in another thread, so the in-memory database
    # has to be one connection shared across threads.
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    user = m.GRCUser(id=7, username="privera", email="p.rivera@bank.example",
                     display_name="Pat Rivera")
    session.add(user)
    session.commit()

    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = lambda: user
    app.dependency_overrides[api._require_create] = lambda: True
    app.dependency_overrides[api._require_view] = lambda: True
    app.dependency_overrides[api._require_edit] = lambda: True
    app.dependency_overrides[api._require_delete] = lambda: True
    yield TestClient(app), session
    app.dependency_overrides.clear()
    session.close()


def _upload(client, path, endpoint):
    with open(path, "rb") as handle:
        return client.post(f"/issue-management/issues/audit-register/{endpoint}",
                           files={"file": (path.name, handle,
                                           "application/vnd.openxmlformats-officedocument."
                                           "spreadsheetml.sheet")})


def test_preview_reports_what_would_happen_and_writes_nothing(client, workbook):
    http, session = client

    body = _upload(http, workbook, "preview").json()

    assert body["rows"] == 2
    assert body["as_of"] == "2026-09-20"
    assert body["sheet_counts"] == {"Regulatory": 2}
    assert body["by_source"] == {"regulator": 2}
    assert body["unmatched_owners"] == [{"name": "Nobody Here", "rows": 1}]
    assert body["sample"][0]["reference"] == "MRA-1"
    assert session.query(m.Issue).count() == 0        # preview stays read-only


def test_import_creates_the_issues_and_lists_the_run(client, workbook):
    http, session = client

    body = _upload(http, workbook, "import").json()
    assert (body["created"], body["updated"], body["skipped"]) == (2, 0, 0)
    assert session.query(m.Issue).count() == 2

    rows = http.get("/issue-management/issues/audit-register/rows").json()
    assert [r["reference"] for r in rows] == ["MRA-1", "MRA-2"]
    assert rows[0]["owner_id"] == 7 and rows[0]["ia_status"] == "IP"
    assert rows[0]["report"] == "Report of Examination"

    history = http.get("/issue-management/issues/audit-register/imports").json()
    assert history[0]["created"] == 2 and history[0]["file_name"] == "register.xlsx"


def test_a_file_that_is_not_a_workbook_is_refused(client, tmp_path):
    http, _ = client
    junk = tmp_path / "notes.txt"
    junk.write_text("not a workbook")

    response = _upload(http, junk, "import")

    assert response.status_code == 400
    assert "Excel workbook" in response.json()["detail"]


def test_an_asset_named_by_a_finding_shows_its_audit_tag(client, workbook):
    http, session = client
    _upload(http, workbook, "import")
    issue = session.query(m.Issue).filter(m.Issue.title == "Enterprise Risk Management").one()
    session.add(m.ITAsset(id=40, tenant_id=1, name="erm-db", asset_type="server"))
    session.add(m.IssueAssetLink(issue_id=issue.id, asset_id=40))
    session.commit()

    url = "/issue-management/issues/audit-register/findings-for"
    tags = http.get(url, params={"kind": "asset", "record_id": 40}).json()

    assert [t["reference"] for t in tags] == ["MRA-1"]
    assert http.get(url, params={"kind": "asset", "record_id": 41}).json() == []
    assert http.get(url, params={"kind": "vendor", "record_id": 40}).status_code == 400


def test_the_pack_reports_validation_and_mappings_are_served(client, workbook):
    http, session = client
    _upload(http, workbook, "import")
    base = "/issue-management/issues/audit-register"
    issue_id = session.query(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-1").one().issue_id

    pack = http.get(f"{base}/pack", params={"month": "2026-09"}).json()
    assert pack["title"] == "September 2026 Issue Summary" and pack["status_rows"]
    export = http.get(f"{base}/pack/export", params={"month": "2026-09"})
    assert export.status_code == 200 and export.content[:2] == b"PK"      # an .xlsx
    assert http.get(f"{base}/reports").json()[0]["report"] == "Report of Examination"
    state = http.get(f"{base}/validation/{issue_id}").json()
    assert state["has_validation"] is True and state["stage"] == "open"
    owners = http.get(f"{base}/mappings/owners").json()
    assert {r["name"]: r["how"] for r in owners["rows"]}["Nobody Here"] == "unmatched"
    assert http.get(f"{base}/pack", params={"month": "April"}).status_code == 400


def test_a_finding_is_added_on_a_sheet_and_the_register_says_it_exists(client, workbook):
    http, session = client
    base = "/issue-management/issues/audit-register"
    assert http.get(f"{base}/status").json()["has_register"] is False

    forms = {t["key"]: t for t in http.get(f"{base}/templates").json()}
    assert "affected_hosts" in [f["name"] for f in forms["it_pen"]["fields"]]
    made = http.post(f"{base}/findings", json={"template": "it_pen", "values": {
        "title": "Open S3 bucket", "issue_ref": "CLDCA.99", "affected_hosts": "web-api-prod",
        "owner": 7}})
    assert made.status_code == 200, made.text
    body = made.json()
    assert body["added_in_platform"] is True and body["owner_id"] == 7 and body["layout"] == "archive"

    status = http.get(f"{base}/status").json()
    assert status["has_register"] is True and status["findings"] == 1
    rows = http.get(f"{base}/rows").json()
    assert rows[0]["reference"] == "CLDCA.99" and rows[0]["added_in_platform"] is True
    refused = http.post(f"{base}/findings", json={"template": "it_pen", "values": {"causes": "x"}})
    assert refused.status_code == 400 and "not a column" in refused.json()["detail"]


def test_a_finding_is_deleted_restored_and_the_template_downloads(client, workbook):
    http, session = client
    base = "/issue-management/issues/audit-register"
    _upload(http, workbook, "import")
    issue_id = session.query(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-2").one().issue_id

    assert http.request("DELETE", f"{base}/findings/{issue_id}", json={"reason": "duplicate"}).status_code == 200
    assert [r["reference"] for r in http.get(f"{base}/rows").json()] == ["MRA-1"]
    assert [r["reference"] for r in http.get(f"{base}/rows", params={"deleted": True}).json()] == ["MRA-2"]
    edit = http.patch(f"{base}/profile/{issue_id}", json={"changes": {"lob": "x"}})
    assert edit.status_code == 400 and "restore it" in edit.json()["detail"]

    assert http.post(f"{base}/findings/{issue_id}/restore").status_code == 200
    assert len(http.get(f"{base}/rows").json()) == 2

    blank = http.get(f"{base}/template")
    assert blank.status_code == 200 and blank.content[:2] == b"PK"
    assert "register - blank.xlsx" in blank.headers["content-disposition"]


def test_settings_reports_and_numbering_are_served_and_a_picked_report_fills_the_finding(client, workbook):
    http, session = client
    base = "/issue-management/issues/audit-register"
    _upload(http, workbook, "import")

    settings = http.get(f"{base}/settings").json()
    assert settings["sla"]["PD"]["escalate_after"] == 30 and "OCC" in settings["values"]["regulator"]
    saved = http.put(f"{base}/settings", json={"sla": {"PD": {"escalate_after": 45}},
                                                "lists": {"regulator": ["FDIC"]}})
    assert saved.status_code == 200 and saved.json()["values"]["regulator"] == ["FDIC", "OCC"]
    bad = http.put(f"{base}/settings", json={"numbering": {"regulatory": "MRA"}})
    assert bad.status_code == 400 and "{n}" in bad.json()["detail"]

    catalog = http.get(f"{base}/report-catalog").json()
    exam = next(r for r in catalog if r["report_key"] == "R-1")
    assert exam["findings"] == 2 and exam["source_label"] == "OCC"
    assert http.get(f"{base}/next-reference", params={"template": "regulatory",
                                                       "report_key": "R-1"}).json() == {"reference": "MRA-3"}

    moved = http.put(f"{base}/report-catalog/{exam['id']}", json={"report_date": "2024-06-01"}).json()
    assert moved["findings_updated"] == 2 and moved["report_date"] == "2024-06-01"
    assert http.delete(f"{base}/report-catalog/{exam['id']}").status_code == 400    # findings use it

    made = http.post(f"{base}/findings", json={"template": "regulatory", "report_id": exam["id"],
                                                "values": {"title": "Board reporting", "issue_ref": "MRA-3"}})
    assert made.status_code == 200, made.text
    profile = session.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.issue_ref == "MRA-3").one()
    assert (profile.report_key, profile.regulator, profile.report_date) == ("R-1", "OCC", date(2024, 6, 1))

    spare = http.post(f"{base}/report-catalog", json={"source": "regulator", "source_label": "FDIC",
                                                       "report_name": "Cyber exam"}).json()
    assert http.delete(f"{base}/report-catalog/{spare['id']}").json() == {"deleted": True}
    actions = {r.action for r in session.query(m.AuditLog).filter(m.AuditLog.resource_type == "audit-register")}
    assert {"settings_updated", "report_updated", "report_added", "report_deleted"} <= actions


def test_ai_assist_suggests_and_the_finding_records_what_ai_drafted(client, workbook, monkeypatch):
    import json as _json

    from grc.modules.issue_management.audit_register import assist

    http, session = client
    base = "/issue-management/issues/audit-register"
    _upload(http, workbook, "import")
    monkeypatch.setattr(assist, "openai_complete", lambda messages: _json.dumps({"fields": {
        "risk_rating": {"value": "Moderate", "reason": "Control gap, no loss"},
        "causes": {"value": "1. No owner for the procedure", "reason": "Common cause"}}}))

    body = http.post(f"{base}/assist", json={"template": "regulatory",
                                             "values": {"title": "Board reporting gaps"}}).json()
    got = {s["field"]: s["value"] for s in body["suggestions"]}
    assert got["risk_rating"] == "Moderate" and got["causes"] == "1. No owner for the procedure"
    assert "target_date" in got and body["notice"] is None
    assert http.post(f"{base}/assist", json={"template": "regulatory", "values": {}}).status_code == 400

    made = http.post(f"{base}/findings", json={"template": "regulatory", "ai_fields": ["causes", "risk_rating"],
                                                "values": {"title": "Board reporting gaps", "causes": got["causes"]}})
    assert made.status_code == 200, made.text
    row = session.query(m.AuditLog).filter(m.AuditLog.action == "create",
                                           m.AuditLog.resource_type == "audit-register").all()[-1]
    assert "AI-drafted and accepted: Causes" in row.changes["summary"]
