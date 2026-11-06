"""The client's audit register workbook parses into rows we can import.

The fixture reproduces what makes the real pack awkward: pivot tables sitting
above the register header, a sheet name with a trailing space, "Issue #" and
"Issue" as different columns, an "Owner" header used twice (the second one is
the validator), and the client's own status codes.
"""
from datetime import date
from decimal import Decimal

import pytest
from openpyxl import Workbook

from grc.modules.issue_management.audit_register.parser import parse_workbook

REGULATORY = [
    "#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
    "Issue Name", "Issue", "Causes", "Consequences", "Corrective Actions",
    "Management Action Plan", "Owner", "Title", "LOB", "Target Date", "Revised Target Date",
    "Management Reported Status", "Date of Validation by CFSB IA",
    "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail",
    "Issue Resolution Status Update", "Source of Validation Materials",
]
ARCHIVE = [
    "Project Name-Year (20XX)", "Issue ID", "Issue / Recommendation", "Recommendation State",
    "Source", "Engagement Year", "As of Date", "Issue Subject", "Condition", "Relative Risk",
    "Recommendation Title", "Counsel", "Management Response", "Original Target Date",
    "Revised Target Date", "Aged Days from Target", "Aged status", "LOB", "Business Unit",
    "OWNER", "TYPE OF AUDIT",
    "REMEDIATION STATUS (NOT STARTED / IN PROGRESS / DELAYED / COMPLETED)", "REMEDIATION TYPE",
    "ISSUE OR VULNERABILITY (FOR IT ONLY)", "VALIDATION STATUS (NOT STARTED/ IN PROGRESS/ CLOSED)",
    "VALIDATION PERFORMED BY: EY/CIAO/TBD/NA-CLOSED", "Owner", "Date Received",
    "Validation Start", "Validation Completed", "LOCATION OF ISSUE VALIDATION",
    "Current Internal Status", "Notes", "Location", "Affected Hosts",
]
SELF_ID = [
    "Date", "Line of Business", "Executive", "Category (Fin/Ops/Reg/IT)", "Description",
    "Monetary Impact", "Impact to Client", "Actions to Address Event", "Risk Level", "Issue Name",
]


@pytest.fixture
def workbook_path(tmp_path):
    wb = Workbook()

    summary = wb.active
    summary.title = "SUMMARY"
    summary.append(["", "CFSB AUDIT SERVICES"])
    summary.append(["", "Source", "Regulator", "CFSB Audit-Mercadien", "CFSB Audit-EY",
                    "Self Identified", "IT Pen Test", "Credit Reviews", "Total"])
    summary.append(["", "Beginning Number of Issues", 21, 7, 16, 0, 91, 0, 135])
    summary.append(["", "Add: Issues opened this month", 0, 0, 3, 0, 15, 0, 18])
    summary.append(["", "Less: Issues closed this month", 0, 4, 6, 0, 0, 0, 10])
    summary.append(["", "Ending Number of Issues", 21, 3, 13, 0, 106, 0, 143])

    reg = wb.create_sheet("Regulatory")
    reg.append(["SUMMARY OF ISSUES AND STATUS REPORT"])
    reg.append(["AS OF", date(2026, 9, 20)])
    reg.append(["", "Row Labels", "Count"])      # the pivot the client keeps on top
    reg.append(["", "IP", 2])
    reg.append(REGULATORY)
    reg.append([1, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-1", "High",
                "Enterprise Risk Management", "The OCC identified…", "Board did not prioritise",
                "ERM programme limited", "Perform the following…", "Hire an ERM lead",
                "Rivera, P", "Director", "ERM", date(2026, 3, 31), date(2026, 6, 30),
                "On track", date(2026, 7, 15), "IP", "Pass", "OPEN", "SharePoint"])
    reg.append([2, "OCC", "R-1", "Report of Examination", date(2024, 5, 20), "MRA-2", "Moderate",
                "Third Party Risk", "Vendor oversight gap", "", "", "", "", "Morgan, L",
                "Director", "TPRM", "", "", "", "", "CD", "Pass", "CLOSED", ""])

    ey = wb.create_sheet("IA-EY Recommendation")   # trailing-space siblings exist too
    ey.append(["SUMMARY OF RECOMMENDATIONS"])
    ey.append(["#", "Source (Mercadien/ EY)", "Report Number", "Audit Report Name",
               "Audit Report Date", "Issue #", "Risk Rating", "Issue Name", "Issue", "Risk",
               "Impact", "Recommendation", "Management Action Plan", "Owner", "Title", "LOB",
               "Target Date", "Revised Target Date", "# extensions", "Days Past Due",
               "Management Self-Reported Status", "Date of Validation by CFSB IA",
               "Status (NS/IP/DE/ PD/ EXT/ CD)", "Validation Pass/Fail",
               "Issue Resolution Status Update (OPEN OR CLOSED)", "Source of Validation Materials"])
    ey.append([1, "EY", "EY-9", "Governance Review-2025", date(2025, 10, 31), "5.1", "Medium",
               "Training assignments", "Courses are assigned manually", "Staff miss training",
               "Not documented", "Enhance the assignment process", "Reviewing the LMS",
               "Robin Blake", "VP", "IT", date(2026, 4, 30), "", 2, 45, "In progress", "", "EX",
               "", "OPEN", ""])

    pen = wb.create_sheet("IT Pen")
    pen.append(ARCHIVE)
    pen.append(["Cloud Console Review", "CLDCA.01", "Recommendation", "Closed-Pending Validation",
                "Outside Assessor", "2023", date(2024, 1, 24), "IAM password length",
                "Password policies enforce complexity", "Moderate", "Require 14 characters",
                "Set the policy", "Policy updated", date(2024, 4, 5), "", 748, ">90", "IT/IS",
                "Information Technology", "ZEPHYR", "SELF ID", "COMPLETED", "REMEDIATION",
                "VULNERABILITY", "IN PROGRESS", "EY", "Priya Shah", date(2024, 2, 1),
                date(2024, 3, 1), "", "S3 bucket", "Awaiting evidence", "See ticket",
                "us-east-1", "web-api-prod"])

    self_id = wb.create_sheet("Self ID")
    self_id.append(["Self Identified Events"])
    self_id.append(SELF_ID)
    self_id.append([date(2026, 3, 31), "Compliance", "J. Rivera", "Reg", "Late filing",
                    "12,500.00", "None", "Working with counsel", "High", "Regulatory filing"])

    path = tmp_path / "register.xlsx"
    wb.save(path)
    return str(path)


def test_rows_parse_from_every_layout(workbook_path):
    book = parse_workbook(workbook_path, file_name="register.xlsx")

    assert book.as_of == date(2026, 9, 20)
    assert book.sheet_counts == {"Regulatory": 2, "IA-EY Recommendation": 1, "IT Pen": 1, "Self ID": 1}
    assert [r.source for r in book.rows] == ["regulator", "regulator", "ey", "it_pen", "self_id"]
    # Record type comes from the sheet for the recommendation register, and from
    # the row's own "Issue / Recommendation" column on the archive layout.
    assert [r.record_type for r in book.rows] == [
        "issue", "issue", "recommendation", "recommendation", "issue",
    ]


def test_regulatory_columns_land_in_the_right_fields(workbook_path):
    row = parse_workbook(workbook_path).rows[0]

    assert row.values["issue_ref"] == "MRA-1"                  # "Issue #" …
    assert row.values["issue_text"].startswith("The OCC")      # … is not "Issue"
    assert row.values["title"] == "Enterprise Risk Management"
    assert row.values["owner_name_raw"] == "Rivera, P"
    assert row.values["owner_title"] == "Director"
    assert row.values["report_date"] == date(2024, 5, 20)      # "Report  Date", two spaces
    assert row.values["target_date"] == date(2026, 3, 31)
    assert row.values["ia_status"] == "IP"
    assert row.values["validation_pass_fail"] == "Pass"
    assert row.values["validation_materials_source"] == "SharePoint"


def test_archive_layout_keeps_the_validator_apart_from_the_owner(workbook_path):
    pen = next(r for r in parse_workbook(workbook_path).rows if r.sheet == "IT Pen")

    assert pen.values["owner_name_raw"] == "ZEPHYR"      # first "OWNER"
    assert pen.values["validation_owner"] == "Priya Shah"  # the second "Owner"
    assert pen.values["validation_performed_by"] == "EY"
    assert pen.values["it_record_kind"] == "VULNERABILITY"
    assert pen.values["affected_hosts"] == "web-api-prod"
    assert pen.values["aged_days_from_target"] == 748
    assert pen.values["remediation_status"] == "COMPLETED"
    assert pen.values["recommendation_state"] == "Closed-Pending Validation"


def test_numbers_and_money_are_typed(workbook_path):
    rows = parse_workbook(workbook_path).rows
    ey = next(r for r in rows if r.sheet == "IA-EY Recommendation")
    event = next(r for r in rows if r.sheet == "Self ID")

    assert ey.values["extensions_count"] == 2
    assert ey.values["days_past_due"] == 45
    assert event.values["monetary_impact"] == Decimal("12500.00")
    assert event.values["event_date"] == date(2026, 3, 31)
    assert event.values["self_id_category"] == "Reg"


def test_summary_roll_forward_is_read_for_reconciliation(workbook_path):
    book = parse_workbook(workbook_path)

    assert book.summary["ey"] == {"beginning": 16, "opened": 3, "closed": 6, "ending": 13}
    assert book.summary["it_pen"]["ending"] == 106
    assert book.summary["credit_review"]["beginning"] == 0


def test_bytes_are_accepted_so_an_upload_needs_no_temp_file(workbook_path):
    with open(workbook_path, "rb") as handle:
        book = parse_workbook(handle.read(), file_name="register.xlsx")

    assert len(book.rows) == 5
