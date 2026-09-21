"""Validation, extensions and reminders — each in the client's own terms.

Validation writes the finding's own sheet columns (CD / DE / PD and Pass/Fail on
the regulatory and IA sheets; the recommendation state and validation status on
the pen-test sheet), so the pack counts it and next month's import keeps it.
An extension goes to the Audit Committee as an agenda item; only its decision
moves the date. Reminders reach each owner once, and escalate the overdue.
"""
from datetime import date, datetime, timedelta

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import workflow
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

TODAY = date(2026, 9, 21)
REG = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
       "Issue Name", "Issue", "Owner", "LOB", "Target Date", "Management Reported Status",
       "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail",
       "Source of Validation Materials"]
PEN = ["Project Name-Year (20XX)", "Issue ID", "Issue / Recommendation", "Recommendation State",
       "Source", "Issue Subject", "Relative Risk", "OWNER", "Original Target Date"]
SELF = ["Date", "Line of Business", "Executive", "Category (Fin/Ops/Reg/IT)", "Description",
        "Monetary Impact", "Risk Level ", "Issue Name"]


def _book(tmp_path, name="sep.xlsx"):
    wb = Workbook()
    reg = wb.active
    reg.title = "Regulatory"
    reg.append(["AS OF", TODAY])
    reg.append(REG)
    reg.append([1, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-1", "High", "Wire controls",
                "Detail", "Rivera, P", "Ops", TODAY + timedelta(days=5), "", "IP", "", ""])
    reg.append([2, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-2", "High", "Vendor oversight",
                "Detail", "Rivera, P", "TPRM", TODAY - timedelta(days=40), "", "IP", "", ""])
    pen = wb.create_sheet("IT Pen")
    pen.append(PEN)
    pen.append(["CLD-2024", "CLDCA.01", "Issue", "Open", "Outside Assessor",
                "IAM password policy", "Moderate", "Rivera, P", TODAY + timedelta(days=60)])
    self_id = wb.create_sheet("Self ID")
    self_id.append(SELF)
    self_id.append([date(2026, 3, 31), "Ops", "Rivera, P", "Ops", "A missed wire",
                    1200, "High", "Wire cut-off missed"])
    path = tmp_path / name
    wb.save(path)
    return str(path)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(workflow, "_upload_dir", lambda: str(tmp_path / "uploads"))
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.GRCUser(id=7, username="privera", email="p.rivera@bank.example",
                              display_name="Pat Rivera", is_active=True))
        session.add(m.GRCUser(id=8, username="auditor", email="audit@bank.example",
                              display_name="Aisha Auditor", is_active=True))
        session.commit()
        apply_workbook(session, 1, parse_workbook(_book(tmp_path)), actor_id=8)   # Audit Services
        session.commit()
        yield session


def _finding(db, ref):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.issue_ref == ref).one()
    return profile.issue, profile


def _notes(db, user_id):
    return [n.subject for n in db.query(m.WorkflowNotification)
            .filter(m.WorkflowNotification.user_id == user_id).order_by(m.WorkflowNotification.id)]


def test_submit_then_pass_closes_the_finding_and_approves_the_evidence(db, tmp_path):
    issue, profile = _finding(db, "MRA-1")
    owner, auditor = db.get(m.GRCUser, 7), db.get(m.GRCUser, 8)

    workflow.submit_for_validation(db, issue, profile, owner, "Policy attached",
                                   [("policy.pdf", "application/pdf", b"%PDF-1.4")], today=TODAY)
    db.commit()
    assert issue.workflow_state == "closure_review"
    assert profile.management_reported_status == "Completed" and profile.ia_status == "IP"
    link = db.query(m.IssueEvidenceLink).filter(m.IssueEvidenceLink.issue_id == issue.id).one()
    assert link.relationship_type == "validation"
    assert _notes(db, 8) == ["Ready for validation: MRA-1 · Wire controls"]

    workflow.decide_validation(db, issue, profile, auditor, "pass", "", today=TODAY)
    db.commit()
    assert issue.workflow_state == "closed" and issue.closed_at.date() == TODAY
    assert (profile.ia_status, profile.validation_pass_fail, profile.validated_on) == ("CD", "Pass", TODAY)
    assert db.get(m.Evidence, link.evidence_id).status == "approved"
    assert _notes(db, 7)[-1].endswith("passed validation and is closed")


def test_next_month_s_file_does_not_reopen_what_was_validated(db, tmp_path):
    issue, profile = _finding(db, "MRA-1")
    workflow.decide_validation(db, issue, profile, db.get(m.GRCUser, 8), "pass", "", today=TODAY)
    db.commit()

    apply_workbook(db, 1, parse_workbook(_book(tmp_path, "oct.xlsx")), actor_id=8)   # still says IP
    db.commit()
    issue, profile = _finding(db, "MRA-1")

    assert profile.ia_status == "CD" and issue.workflow_state == "closed"


def test_more_materials_is_delayed_and_a_fail_is_past_due(db):
    issue, profile = _finding(db, "MRA-2")
    auditor = db.get(m.GRCUser, 8)

    with pytest.raises(ValueError, match="what is missing"):
        workflow.decide_validation(db, issue, profile, auditor, "more_info", "", today=TODAY)
    workflow.decide_validation(db, issue, profile, auditor, "more_info", "Need Q3 logs", today=TODAY)
    assert profile.ia_status == "DE" and issue.workflow_state == "in_progress"

    workflow.decide_validation(db, issue, profile, auditor, "fail", "Logs do not cover it", today=TODAY)
    assert (profile.ia_status, profile.validation_pass_fail) == ("PD", "Fail")


def test_the_pen_test_sheet_is_validated_in_its_own_columns(db):
    issue, profile = _finding(db, "CLDCA.01")
    owner, auditor = db.get(m.GRCUser, 7), db.get(m.GRCUser, 8)

    workflow.submit_for_validation(db, issue, profile, owner, "Policy changed in IAM", [], today=TODAY)
    assert (profile.recommendation_state, profile.validation_status) == (
        "Closed-Pending Validation", "IN PROGRESS")
    assert issue.workflow_state == "closure_review"

    workflow.decide_validation(db, issue, profile, auditor, "pass", "", today=TODAY)
    assert (profile.recommendation_state, profile.validation_status) == ("Closed-Validated", "CLOSED")
    assert profile.validation_completed_on == TODAY and issue.workflow_state == "closed"


def test_self_identified_events_have_no_validation_step(db):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.source == "self_id").one()

    with pytest.raises(ValueError, match="no validation step"):
        workflow.submit_for_validation(db, profile.issue, profile, db.get(m.GRCUser, 7), "x", [])


def _committee(db):
    committee = m.GovernanceCommittee(id=3, tenant_id=1, name="Audit Committee",
                                      committee_type="audit_committee", chair_id=8)
    db.add(committee)
    db.add(m.CommitteeMeeting(id=11, tenant_id=1, committee_id=3, title="Q4 Audit Committee",
                              scheduled_date=datetime(2026, 10, 15), status="scheduled"))
    db.commit()


def test_an_extension_goes_on_the_committee_agenda_and_approval_moves_the_date(db):
    _committee(db)
    issue, profile = _finding(db, "MRA-2")
    owner, auditor = db.get(m.GRCUser, 7), db.get(m.GRCUser, 8)

    with pytest.raises(ValueError, match="must be after"):
        workflow.request_extension(db, issue, profile, owner, TODAY - timedelta(days=1), "x", today=TODAY)
    request = workflow.request_extension(db, issue, profile, owner, date(2026, 12, 31),
                                         "Vendor contract renewal slipped", today=TODAY)
    db.commit()
    item = db.get(m.MeetingAgendaItem, request.agenda_item_id)
    assert item.meeting_id == 11 and item.title.startswith("Extension request")
    assert _notes(db, 8)[-1] == "Extension request for the Q4 Audit Committee agenda"
    with pytest.raises(ValueError, match="already waiting"):
        workflow.request_extension(db, issue, profile, owner, date(2027, 1, 31), "again", today=TODAY)

    workflow.decide_extension(db, request, auditor, True, "Approved at the Q4 meeting", today=TODAY)
    db.commit()
    assert profile.revised_target_date == date(2026, 12, 31) and profile.ia_status == "EXT"
    assert issue.due_date.date() == date(2026, 12, 31)
    assert (item.status, item.outcome) == ("discussed", "Approved")
    # An MRA's extension also needs the regulator told — until then it says so.
    assert workflow.extension_payload(db, request)["needs_regulator_notice"] is True


def test_a_rejected_extension_leaves_the_date_alone(db):
    _committee(db)
    issue, profile = _finding(db, "MRA-1")
    request = workflow.request_extension(db, issue, profile, db.get(m.GRCUser, 7),
                                         date(2026, 12, 31), "Need more time", today=TODAY)
    workflow.decide_extension(db, request, db.get(m.GRCUser, 8), False, "Not justified", today=TODAY)

    assert profile.revised_target_date is None and profile.ia_status == "IP"
    assert request.status == "rejected"


def test_reminders_reach_each_owner_once_and_escalate_the_long_overdue(db):
    preview = workflow.send_reminders(db, 1, today=TODAY, dry_run=True)
    assert (preview["due_soon"], preview["past_due"], preview["escalated"]) == (1, 1, 1)
    assert db.query(m.WorkflowNotification).count() == 0            # a preview sends nothing

    workflow.send_reminders(db, 1, today=TODAY)
    db.commit()
    assert _notes(db, 7) == ["Audit findings past due: 2"]          # one message, both findings
    assert _notes(db, 8) == ["Escalation: 1 audit finding(s) 30+ days past due"]

    again = workflow.send_reminders(db, 1, today=TODAY + timedelta(days=1))
    assert again["due_soon"] == again["past_due"] == 0              # at most weekly
