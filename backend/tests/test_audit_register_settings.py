"""The register's settings: SLAs per status, the report list, dropdown lists
and Issue # numbering — set once, then used by reminders and by the form a
finding is added on."""
from datetime import date, datetime, timedelta

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import settings as S, workflow
from grc.modules.issue_management.audit_register.editing import create_finding, options
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

TODAY = date(2026, 9, 21)
REG = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
       "Issue Name", "Issue", "Owner", "LOB", "Target Date", "Management Reported Status",
       "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail", "Source of Validation Materials"]
PEN = ["Project Name-Year (20XX)", "Issue ID", "Issue / Recommendation", "Recommendation State",
       "Source", "Issue Subject", "Relative Risk", "OWNER", "Original Target Date"]


def _book(tmp_path):
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
    path = tmp_path / "sep.xlsx"
    wb.save(path)
    return str(path)


@pytest.fixture
def db(tmp_path):
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        for uid, name in ((7, "Pat Rivera"), (8, "Aisha Auditor"), (9, "Sam Services")):
            session.add(m.GRCUser(id=uid, username=name.split()[0].lower(), is_active=True,
                                  email=f"{name.split()[0].lower()}@bank.example", display_name=name))
        session.commit()
        apply_workbook(session, 1, parse_workbook(_book(tmp_path)), actor_id=8)
        session.commit()
        yield session


def _notes(db, user_id):
    return [n.subject for n in db.query(m.WorkflowNotification)
            .filter(m.WorkflowNotification.user_id == user_id).order_by(m.WorkflowNotification.id)]


def _report(db, key):
    S.sync_reports(db, 1)
    return db.query(m.AuditRegisterReport).filter(m.AuditRegisterReport.report_key == key).one()


# ── SLAs ─────────────────────────────────────────────────────────────────────

def test_the_status_slas_decide_who_is_reminded_and_who_hears_of_escalations(db):
    assert workflow.send_reminders(db, 1, today=TODAY, dry_run=True)["due_soon"] == 1   # 14-day default

    S.save_settings(db, 1, {"sla": {"IP": {"remind_before_due": 3}, "PD": {"escalate_after": 50}}})
    preview = workflow.send_reminders(db, 1, today=TODAY, dry_run=True)
    assert (preview["due_soon"], preview["past_due"], preview["escalated"]) == (0, 1, 0)

    S.save_settings(db, 1, {"sla": {"PD": {"enabled": False}}})
    assert workflow.send_reminders(db, 1, today=TODAY, dry_run=True)["past_due"] == 0

    S.save_settings(db, 1, {"sla": {"PD": {"enabled": True, "escalate_after": 30}},
                            "audit_services": [9], "email": False})
    workflow.send_reminders(db, 1, today=TODAY)
    db.commit()
    assert _notes(db, 9) == ["Escalation: 1 audit finding(s) 30+ days past due"]    # the team chosen
    assert _notes(db, 8) == []                                                      # not the uploader


def test_a_validation_left_waiting_reaches_audit_services_once_past_its_sla(db):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.issue_ref == "MRA-1").one()
    profile.issue.workflow_state = "closure_review"          # imported already reported done
    profile.created_at = datetime(2026, 9, 15)
    S.save_settings(db, 1, {"audit_services": [9]})
    assert workflow.send_reminders(db, 1, today=TODAY, dry_run=True)["validation_waiting"] == 0  # 6 < 10 days

    S.save_settings(db, 1, {"sla": {"validation": {"validate_within": 5}}})
    workflow.send_reminders(db, 1, today=TODAY)
    db.commit()
    assert _notes(db, 9)[-1] == "Validation waiting: 1 finding(s) submitted 5+ days ago"
    assert _notes(db, 7) == ["Audit findings past due: 1"]      # MRA-2 only; the owner has done MRA-1


def test_settings_refuse_what_the_reminders_could_not_use(db):
    for patch in ({"sla": {"XX": {"enabled": True}}},
                  {"sla": {"IP": {"remind_before_due": -1}}},
                  {"sla": {"IP": {"sooner": 3}}},
                  {"audit_services": [404]},
                  {"lists": {"owner": ["x"]}},
                  {"numbering": {"regulatory": "MRA-"}},
                  {"numbering": {"self_id": "SI-{n}"}}):
        with pytest.raises(ValueError):
            S.save_settings(db, 1, patch)
    kept = S.save_settings(db, 1, {"sla": {"NS": {"start_within": ""}}})
    assert kept["sla"]["NS"]["start_within"] is None and kept["sla"]["IP"]["repeat_every"] == 7


# ── dropdown lists ───────────────────────────────────────────────────────────

def test_a_dropdown_offers_the_settings_list_and_what_the_register_uses(db):
    saved = S.save_settings(db, 1, {"lists": {"regulator": ["FDIC", " fdic ", "NYDFS", "", "occ"]}})
    assert saved["lists"]["regulator"] == ["FDIC", "NYDFS", "occ"]
    picks = options(db, 1)["picks"]
    assert picks["regulator"] == ["FDIC", "NYDFS", "occ"]          # the register's "OCC" is the same one
    assert "Outside Assessor" in picks["source_label"]


# ── reports and exams ────────────────────────────────────────────────────────

def test_the_report_list_holds_every_report_the_register_names(db):
    rows = S.report_catalog(db, 1)
    by_key = {r["report_key"]: r for r in rows}
    assert by_key["R-1"]["source_label"] == "OCC" and by_key["R-1"]["findings"] == 2
    assert by_key["CLD-2024"]["project_name"] == "CLD-2024"
    assert len(S.report_catalog(db, 1)) == len(rows)                    # synced once, not again

    with pytest.raises(ValueError):
        S.create_report(db, 1, "regulator", {"report_number": "R-1"})   # already there
    with pytest.raises(ValueError):
        S.create_report(db, 1, "regulator", {"source_label": "OCC"})    # no name or number


def test_correcting_a_report_once_moves_its_findings_and_survives_the_next_upload(db, tmp_path):
    report = _report(db, "R-1")
    moved = S.update_report(db, report, {"source_label": "FDIC", "report_name": "2025 Safety Exam",
                                         "notes": "kept on the report"})
    db.commit()
    assert moved == 2
    profiles = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.report_key == "R-1").all()
    assert {(p.regulator, p.report_name, p.notes) for p in profiles} == {("FDIC", "2025 Safety Exam", None)}

    apply_workbook(db, 1, parse_workbook(_book(tmp_path)), actor_id=8)   # the file still says OCC
    db.commit()
    assert {p.regulator for p in db.query(m.AuditIssueProfile)
            .filter(m.AuditIssueProfile.report_key == "R-1")} == {"FDIC"}


def test_a_report_with_findings_cannot_be_removed(db):
    with pytest.raises(ValueError):
        S.delete_report(db, _report(db, "R-1"))
    spare = S.create_report(db, 1, "regulator", {"source_label": "NYDFS", "report_name": "Cyber exam"})
    S.delete_report(db, spare)
    assert not db.query(m.AuditRegisterReport).filter(m.AuditRegisterReport.report_key == "Cyber exam").count()


# ── numbering, and adding on a picked report ─────────────────────────────────

def test_the_next_issue_number_carries_the_report_s_own_sequence_on(db):
    assert S.next_reference(db, 1, "regulatory", "R-1") == "MRA-3"
    assert S.next_reference(db, 1, "it_pen", "CLD-2024") == "CLDCA.02"
    assert S.next_reference(db, 1, "regulatory", "R-9") == "MRA-1"      # a new report: the pattern
    S.save_settings(db, 1, {"numbering": {"regulatory": "EXAM-{nnn}"}})
    assert S.next_reference(db, 1, "regulatory", None) == "EXAM-001"
    with pytest.raises(ValueError):
        S.next_reference(db, 1, "nonsense", None)


def test_a_finding_added_on_a_picked_report_takes_its_details_and_joins_it(db):
    report = _report(db, "R-1")
    S.update_report(db, report, {"report_number": "R-1A"})      # renamed; findings still match on R-1
    profile = create_finding(db, 1, "regulatory",
                             {"title": "Board reporting", "issue_ref": S.next_reference(db, 1, "regulatory", "R-1"),
                              "regulator": "typed over"}, report_id=report.id)
    assert (profile.report_key, profile.issue_ref) == ("R-1", "MRA-3")
    assert (profile.regulator, profile.report_number, profile.report_name) == ("OCC", "R-1A", "Exam")
    assert profile.report_date == date(2025, 5, 1)

    with pytest.raises(ValueError):                             # an IT Pen project is not an exam
        create_finding(db, 1, "regulatory", {"title": "Other"}, report_id=_report(db, "CLD-2024").id)
