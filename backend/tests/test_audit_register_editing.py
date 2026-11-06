"""Editing a register finding in the platform.

Every column of the finding's own sheet is editable — and only those. An edit
moves the issue with it (status → workflow, revised target → due date, owner →
assignee), is logged, and survives next month's workbook import, which would
otherwise put the file's older value straight back.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register.editing import apply_edit, form_for, options
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


def _pack(tmp_path, name, *, status="IP", lob="ERM"):
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 9, 20)])
    sheet.append(HEADERS)
    sheet.append([1, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-1", "High",
                  "Enterprise Risk Management", "The OCC identified a gap", "", "", "",
                  "Hire an ERM lead", "Rivera, P", "Director", lob, date(2026, 3, 31), "",
                  "On track", "", status, "", "OPEN", ""])
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
        session.add(m.GRCUser(id=8, username="lmorgan", email="l.morgan@bank.example",
                              display_name="Lee Morgan"))
        session.commit()
        yield session


def _finding(db):
    profile = db.query(m.AuditIssueProfile).one()
    return profile.issue, profile


def test_the_form_shows_only_the_finding_s_own_sheet_columns(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)

    form = form_for(issue, profile)
    names = [f["name"] for f in form["fields"]]

    assert form["layout"] == "regulatory"
    assert "causes" in names and "ia_status" in names
    assert "affected_hosts" not in names          # a pen-test column, not on this sheet
    assert "monetary_impact" not in names         # a self-identified column
    owner = next(f for f in form["fields"] if f["name"] == "owner")
    assert owner["value"] == 7 and owner["raw"] == "Rivera, P"


def test_editing_status_dates_and_owner_moves_the_issue_with_it(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)

    changed = apply_edit(db, issue, profile, {
        "ia_status": "CD", "validated_on": "2026-09-25",
        "revised_target_date": "2026-10-31", "owner": 8,
    })
    db.commit()

    assert set(changed) == {"ia_status", "validated_on", "revised_target_date", "owner"}
    assert issue.workflow_state == "closed" and issue.status == "closed"
    assert issue.due_date.date() == date(2026, 10, 31)
    assert issue.owner_id == 8
    action = db.query(m.IssueAction).filter(m.IssueAction.issue_id == issue.id).one()
    assert action.assignee_id == 8 and action.due_date.date() == date(2026, 10, 31)
    activity = db.query(m.IssueActivity).filter(m.IssueActivity.type == "register_edit").one()
    assert activity.payload["changes"]["ia_status"] == ["IP", "CD"]
    assert set(profile.edited_fields) == {"ia_status", "validated_on", "revised_target_date", "owner"}


def test_a_column_from_another_sheet_or_an_unknown_code_is_refused(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)

    with pytest.raises(ValueError, match="not a column"):
        apply_edit(db, issue, profile, {"affected_hosts": "web-01"})
    with pytest.raises(ValueError, match="must be one of"):
        apply_edit(db, issue, profile, {"ia_status": "DONE"})
    with pytest.raises(ValueError, match="platform user"):
        apply_edit(db, issue, profile, {"owner": 999})


def test_next_month_s_import_keeps_an_edit_and_updates_the_rest(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)
    apply_edit(db, issue, profile, {"ia_status": "DE"})      # Audit Services: delayed
    db.commit()

    # October's pack still says IP, and moves the LOB.
    result = apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "oct.xlsx", lob="Enterprise Risk")))
    db.commit()
    issue, profile = _finding(db)

    assert result.kept_edits == 1
    assert profile.ia_status == "DE"               # the platform's edit survived
    assert profile.lob == "Enterprise Risk"        # untouched fields follow the file


def test_the_dropdowns_offer_the_template_codes_and_the_register_s_own_values(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()

    opts = options(db, 1)

    assert opts["choices"]["ia_status"] == ["NS", "IP", "DE", "PD", "EXT", "CD"]
    assert opts["picks"]["lob"] == ["ERM"]
    assert {u["name"] for u in opts["users"]} == {"Pat Rivera", "Lee Morgan"}


# ── adding a finding by hand ─────────────────────────────────────────────────

from grc.modules.issue_management.audit_register.editing import create_finding, entry_templates


def test_each_sheet_has_a_blank_form_in_its_own_columns(db, tmp_path):
    forms = {t["key"]: t for t in entry_templates(db, 1)}

    regulatory = [f["name"] for f in forms["regulatory"]["fields"]]
    assert "causes" in regulatory and "affected_hosts" not in regulatory
    assert "days_past_due" not in [f["name"] for f in forms["ia_ey_issue"]["fields"]]   # worked out
    assert forms["regulatory"]["defaults"] == {"ia_status": "NS"}
    assert forms["it_pen"]["layout"] == "archive" and forms["self_id"]["layout"] == "self_id"


def test_a_finding_added_by_hand_is_a_register_finding_like_any_other(db, tmp_path):
    profile = create_finding(db, 1, "regulatory", {
        "regulator": "OCC", "report_name": "Report of Examination", "issue_ref": "MRA-9",
        "title": "Liquidity stress testing", "ia_status": "IP", "owner": 8,
        "target_date": "2026-12-31", "management_action_plan": "Build the model",
    })
    db.commit()
    issue = profile.issue

    assert issue.code and issue.owner_id == 8 and issue.workflow_state == "in_progress"
    assert issue.due_date.date() == date(2026, 12, 31)
    assert (profile.source, profile.source_sheet, profile.owner_name_raw) == (
        "regulator", "Regulatory", "Lee Morgan")
    assert db.query(m.IssueAction).filter(m.IssueAction.issue_id == issue.id).one().assignee_id == 8
    assert db.query(m.AuditObservationIssueLink).filter(          # an MRA: in Statutory Audit too
        m.AuditObservationIssueLink.issue_id == issue.id).count() == 1


def test_a_hand_added_finding_is_checked_like_an_edit(db):
    with pytest.raises(ValueError, match="its name"):
        create_finding(db, 1, "it_pen", {"issue_ref": "CLDCA.99"})
    with pytest.raises(ValueError, match="not a column of the IT Pen sheet"):
        create_finding(db, 1, "it_pen", {"title": "x", "causes": "y"})
    with pytest.raises(ValueError, match="must be one of"):
        create_finding(db, 1, "regulatory", {"title": "x", "ia_status": "DONE"})
    create_finding(db, 1, "it_pen", {"title": "Open S3 bucket", "issue_ref": "CLDCA.99"})
    with pytest.raises(ValueError, match="already in the register"):
        create_finding(db, 1, "it_pen", {"title": "Open S3 bucket", "issue_ref": "CLDCA.99"})


def test_the_workbook_carrying_it_later_updates_it_instead_of_adding_a_second(db, tmp_path):
    create_finding(db, 1, "regulatory", {
        "regulator": "OCC", "report_number": "R-1", "issue_ref": "MRA-1",
        "title": "Enterprise Risk Management", "ia_status": "NS"})
    db.commit()

    result = apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()

    assert (result.created, result.updated) == (0, 1)
    assert db.query(m.AuditIssueProfile).one().ia_status == "IP"      # the file's newer status


# ── deleting a finding ───────────────────────────────────────────────────────

from grc.modules.issue_management.audit_register.editing import delete_finding, restore_finding
from grc.modules.issue_management.audit_register.summary import pack


def test_a_deleted_finding_leaves_the_register_and_the_next_upload_leaves_it_out(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)

    delete_finding(db, issue, profile, reason="Raised twice")
    db.commit()
    assert issue.workflow_state == "cancelled" and profile.deleted_at is not None
    assert not pack(db, 1, "2026-09")["columns"]                     # gone from the pack

    again = apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "oct.xlsx")))
    db.commit()
    assert (again.created, again.updated, again.skipped) == (0, 0, 1)   # not brought back
    assert "deleted in the platform" in again.warnings[-1]
    assert db.query(m.Issue).count() == 1                            # kept, with its history
    kinds = [a.type for a in db.query(m.IssueActivity).filter(m.IssueActivity.issue_id == issue.id)]
    assert "register_deleted" in kinds


def test_a_restored_finding_is_back_with_its_status(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_pack(tmp_path, "sep.xlsx")))
    db.commit()
    issue, profile = _finding(db)
    delete_finding(db, issue, profile)
    db.commit()

    restore_finding(db, issue, profile)
    db.commit()

    assert profile.deleted_at is None and issue.workflow_state == "in_progress"   # its IP again
    with pytest.raises(ValueError, match="not deleted"):
        restore_finding(db, issue, profile)
