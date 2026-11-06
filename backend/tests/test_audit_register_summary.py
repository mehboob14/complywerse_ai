"""The monthly roll-forward, computed, and checked against the client's own.

Their SUMMARY sheet is the number the audit committee sees. Ours has to be
derived from the register — so it follows what actually happened — and any
difference from their figure has to be visible rather than quietly reconciled.
"""
from datetime import date

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook
from grc.modules.issue_management.audit_register.summary import months_available, roll_forward

HEADERS = [
    "#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
    "Issue Name", "Issue", "Owner", "LOB", "Target Date",
    "Status (NS/IP/DE/ PD/ EXT/CD )", "Date of Validation by CFSB IA",
]


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.commit()
        yield session


def _workbook(tmp_path, *, reported_beginning=1):
    wb = Workbook()
    summary = wb.active
    summary.title = "SUMMARY"
    summary.append(["", "Source", "Regulator", "CFSB Audit-EY", "IT Pen Test"])
    summary.append(["", "Beginning Number of Issues", reported_beginning, 0, 0])
    summary.append(["", "Add: Issues opened this month", 1, 0, 0])
    summary.append(["", "Less: Issues closed this month", 1, 0, 0])
    summary.append(["", "Ending Number of Issues", 1, 0, 0])

    reg = wb.create_sheet("Regulatory")
    reg.append(["AS OF", date(2026, 4, 30)])
    reg.append(HEADERS)
    # Raised in March, validated in April: open at the start of April, closed in it.
    reg.append([1, "OCC", "R-1", "Exam", date(2026, 3, 10), "MRA-1", "High", "Wire controls",
                "Detail", "Rivera, P", "Ops", date(2026, 6, 30), "CD", date(2026, 4, 15)])
    # Raised in April and still open.
    reg.append([2, "OCC", "R-1", "Exam", date(2026, 4, 5), "MRA-2", "Low", "Vendor oversight",
                "Detail", "Rivera, P", "TPRM", date(2026, 9, 30), "IP", ""])
    path = tmp_path / "april.xlsx"
    wb.save(path)
    return str(path)


def test_the_month_rolls_forward_from_the_register(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path)))
    db.commit()

    april = roll_forward(db, 1, "2026-04")
    regulator = next(r for r in april["rows"] if r["source"] == "regulator")

    assert (regulator["beginning"], regulator["opened"], regulator["closed"],
            regulator["ending"]) == (1, 1, 1, 1)
    assert april["totals"]["ending"] == 1
    assert regulator["matches"] is True          # same as the pack's own figures


def test_march_counts_only_what_existed_then(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path)))
    db.commit()

    march = roll_forward(db, 1, "2026-03")
    regulator = next(r for r in march["rows"] if r["source"] == "regulator")

    assert (regulator["beginning"], regulator["opened"], regulator["closed"]) == (0, 1, 0)
    assert regulator["ending"] == 1
    assert regulator["reported"] is None         # that month's pack was never imported


def test_a_difference_from_the_client_s_figures_is_flagged(db, tmp_path):
    # Their sheet claims two open at the start of April; the register holds one.
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path, reported_beginning=2)))
    db.commit()

    regulator = next(r for r in roll_forward(db, 1, "2026-04")["rows"]
                     if r["source"] == "regulator")

    assert regulator["beginning"] == 1
    assert regulator["reported"]["beginning"] == 2
    assert regulator["matches"] is False


def test_the_months_offered_are_the_ones_imported(db, tmp_path):
    apply_workbook(db, 1, parse_workbook(_workbook(tmp_path)))
    db.commit()

    assert "2026-04" in months_available(db, 1)
