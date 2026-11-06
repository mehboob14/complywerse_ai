"""Importing the register creates tracked issues, and re-importing updates them.

The client sends the same workbook every month with the month's changes in it,
so an import has to recognise rows it has already seen — keyed on source, record
type, report and issue reference — or the register doubles every month.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

HEADERS = [
    "#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
    "Issue Name", "Issue", "Causes", "Consequences", "Corrective Actions",
    "Management Action Plan", "Owner", "Title", "LOB", "Target Date", "Revised Target Date",
    "Management Reported Status", "Date of Validation by CFSB IA",
    "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail",
    "Issue Resolution Status Update", "Source of Validation Materials",
]


def _workbook(tmp_path, name, *, status="IP", owner="Rivera, P", plan="Hire an ERM lead"):
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 9, 20)])
    sheet.append(HEADERS)
    sheet.append([1, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-1", "High",
                  "Enterprise Risk Management", "The OCC identified a gap", "Not prioritised",
                  "Programme limited", "Perform the corrective actions", plan, owner, "Director",
                  "ERM", date(2026, 3, 31), "", "On track", "", status, "", "OPEN", "SharePoint"])
    sheet.append([2, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-2", "Moderate",
                  "Third Party Risk", "Vendor oversight gap", "", "", "", "", "Unknown Person",
                  "Director", "TPRM", "", "", "", "", "NS", "", "OPEN", ""])
    path = tmp_path / name
    wb.save(path)
    return str(path)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.GRCUser(id=7, username="privera", email="p.rivera@bank.example",
                              display_name="Pat Rivera"))
        session.commit()
        yield session


def test_rows_become_issues_owned_by_real_users(db, tmp_path):
    result = apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, "sep.xlsx")))
    db.commit()

    assert (result.created, result.updated) == (2, 0)
    issue = db.query(m.Issue).join(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-1").one()
    assert issue.title == "Enterprise Risk Management"
    assert issue.owner_id == 7                      # "Rivera, P" → Pat Rivera
    assert issue.severity == "high"                 # from the register's risk rating
    assert issue.workflow_state == "in_progress"    # from IP
    assert issue.due_date.date() == date(2026, 3, 31)
    assert issue.issue_type == "audit_finding" and issue.category == "regulatory"
    assert issue.code == "ISS-0001"

    profile = issue.audit_profile[0] if isinstance(issue.audit_profile, list) else issue.audit_profile
    assert (profile.source, profile.regulator, profile.ia_status) == ("regulator", "OCC", "IP")
    assert profile.causes == "Not prioritised"
    assert profile.validation_materials_source == "SharePoint"
    assert profile.owner_name_raw == "Rivera, P"   # kept as the client writes it


def test_the_action_plan_becomes_the_issue_s_corrective_action(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, "sep.xlsx")))
    db.commit()

    action = db.query(m.IssueAction).join(m.Issue).join(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-1").one()
    assert action.description == "Hire an ERM lead"
    assert action.assignee_id == 7
    assert action.due_date.date() == date(2026, 3, 31)


def test_owner_names_that_match_nobody_are_reported_not_dropped(db, tmp_path):
    result = apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, "sep.xlsx")))
    db.commit()

    assert result.unmatched_owners == ["Unknown Person"]
    orphan = db.query(m.Issue).join(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-2").one()
    assert orphan.owner_id is None                  # imported, waiting for a name to be resolved
    record = db.get(m.AuditRegisterImport, result.import_id)
    assert record.unmatched_owners == [{"name": "Unknown Person", "rows": 1}]
    assert record.created_count == 2


def _repeated_reference_workbook(tmp_path, name, *, second_title="Sanctions screening"):
    """The client numbers several findings in one report identically, e.g. "MRA"."""
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 9, 20)])
    sheet.append(HEADERS)
    for title in ("Transaction monitoring", second_title):
        sheet.append([1, "OCC", "", "BSA AML", date(2025, 1, 31), "MRA", "High", title,
                      f"Finding: {title}", "", "", "", "", "Rivera, P", "Director", "BSA",
                      date(2026, 6, 30), "", "", "", "IP", "", "OPEN", ""])
    path = tmp_path / name
    wb.save(path)
    return str(path)


def test_findings_sharing_a_reference_stay_separate_issues(db, tmp_path):
    first = apply_workbook(db, 1, parse_workbook(_repeated_reference_workbook(tmp_path, "sep.xlsx")))
    db.commit()
    again = apply_workbook(db, 1, parse_workbook(_repeated_reference_workbook(tmp_path, "oct.xlsx")))
    db.commit()

    assert first.created == 2                    # two findings, not one collapsed row
    assert (again.created, again.updated) == (0, 2)
    assert db.query(m.Issue).count() == 2
    assert {i.title for i in db.query(m.Issue)} == {"Transaction monitoring", "Sanctions screening"}


def test_a_renamed_finding_with_its_own_reference_is_not_duplicated(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, "sep.xlsx")))
    db.commit()

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 10, 20)])
    sheet.append(HEADERS)
    sheet.append([1, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-1", "High",
                  "Enterprise Risk Management programme", "The OCC identified a gap", "", "", "",
                  "", "Rivera, P", "Director", "ERM", date(2026, 3, 31), "", "", "", "IP", "",
                  "OPEN", ""])
    path = tmp_path / "renamed.xlsx"
    wb.save(path)

    result = apply_workbook(db, 1, parse_workbook(str(path)))
    db.commit()

    assert (result.created, result.updated) == (0, 1)
    renamed = db.query(m.Issue).join(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-1").one()
    assert renamed.title == "Enterprise Risk Management programme"


def test_next_month_s_file_updates_the_same_issues(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, "sep.xlsx")))
    db.commit()

    # October's pack: the same finding, now validated and closed.
    result = apply_workbook(db, 1, parse_workbook(
        _workbook(tmp_path, "oct.xlsx", status="CD", plan="ERM lead hired")))
    db.commit()

    assert (result.created, result.updated) == (0, 2)
    assert db.query(m.Issue).count() == 2           # not four
    issue = db.query(m.Issue).join(m.AuditIssueProfile).filter(
        m.AuditIssueProfile.issue_ref == "MRA-1").one()
    assert issue.workflow_state == "closed" and issue.status == "closed"
    assert issue.closed_at is not None
    action = db.query(m.IssueAction).filter(m.IssueAction.issue_id == issue.id).one()
    assert action.description == "ERM lead hired"   # updated, not duplicated
    assert action.status == "completed"
