"""What the register's rows say for the Register chips and the Queues, and where an alert opens.

`GET /rows` keeps its shape and gains four fields (`mine`, `awaiting_validation`, `waiting_since`,
`extension_requested`) and the header `X-Total-Count`; the five per-finding alerts link to the
finding (`?finding=`), the reminder summaries to the register. All data here is synthetic.
"""
from datetime import date, timedelta

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.responses import Response

import grc.models as m
from grc.modules.issue_management.audit_register import workflow
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook
from grc.modules.issue_management.routers import audit_register as api

TODAY = date.today()
REG = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
       "Issue Name", "Issue", "Owner", "LOB", "Target Date", "Management Reported Status",
       "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail", "Source of Validation Materials"]


def _book(tmp_path):
    wb = Workbook()
    reg = wb.active
    reg.title = "Regulatory"
    reg.append(["AS OF", TODAY])
    reg.append(REG)
    reg.append([1, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-1", "High", "Wire controls",
                "Detail", "Rivera, P", "Ops", TODAY + timedelta(days=5), "", "IP", "", ""])
    reg.append([2, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-2", "High", "Vendor oversight",
                "Detail", "Nobody Here", "TPRM", TODAY - timedelta(days=40), "", "IP", "", ""])
    path = tmp_path / "synthetic.xlsx"
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
        apply_workbook(session, 1, parse_workbook(_book(tmp_path)), actor_id=8)
        session.commit()
        yield session


def _rows(db, user_id, **kwargs):
    response = Response()
    rows = api.list_register_rows(response, db=db, current_user=db.get(m.GRCUser, user_id), **kwargs)
    return rows, response


def _row(rows, ref):
    return next(r for r in rows if r["reference"] == ref)


def _finding(db, ref):
    profile = db.query(m.AuditIssueProfile).filter(m.AuditIssueProfile.issue_ref == ref).one()
    return profile.issue, profile


def _links(db):
    return [n.link for n in db.query(m.WorkflowNotification).order_by(m.WorkflowNotification.id)]


def test_the_rows_keep_their_shape_and_say_how_many_there_are(db):
    rows, response = _rows(db, 7)
    assert len(rows) == 2
    assert response.headers["X-Total-Count"] == "2"
    first = _row(rows, "MRA-1")
    # what the page always read is still there
    for key in ("issue_id", "code", "source", "regulator", "report", "report_key", "reference", "title", "risk_rating",
                "lob", "owner", "owner_id", "owner_name", "target_date", "revised_target_date", "status",
                "days_past_due", "workflow_state", "deleted"):
        assert key in first, key
    assert first["owner_id"] == 7 and first["owner_name"] == "Pat Rivera"
    assert _row(rows, "MRA-2")["owner_id"] is None and _row(rows, "MRA-2")["owner"] == "Nobody Here"


def test_the_total_is_the_whole_register_not_what_was_listed(db):
    _, response = _rows(db, 7)
    assert response.headers["X-Total-Count"] == "2"
    deleted, response = _rows(db, 7, deleted=True)
    assert deleted == [] and response.headers["X-Total-Count"] == "0"


def test_mine_is_the_signed_in_persons_own_findings(db):
    mine, _ = _rows(db, 7)
    assert [r["mine"] for r in sorted(mine, key=lambda r: r["reference"])] == [True, False]
    other, _ = _rows(db, 8)
    assert not any(r["mine"] for r in other)


def test_a_submitted_finding_waits_for_audit_services_since_the_day_it_was_submitted(db):
    issue, profile = _finding(db, "MRA-1")
    before = _row(_rows(db, 8)[0], "MRA-1")
    assert before["awaiting_validation"] is False and before["waiting_since"] is None

    workflow.submit_for_validation(db, issue, profile, db.get(m.GRCUser, 7), "Policy attached", [], today=TODAY)
    db.commit()
    waiting = _row(_rows(db, 8)[0], "MRA-1")
    assert waiting["awaiting_validation"] is True
    assert waiting["waiting_since"] == db.query(m.IssueActivity).filter(
        m.IssueActivity.issue_id == issue.id, m.IssueActivity.type == "validation_submitted").one().created_at.date().isoformat()
    assert _row(_rows(db, 8)[0], "MRA-2")["awaiting_validation"] is False

    workflow.decide_validation(db, issue, profile, db.get(m.GRCUser, 8), "pass", "", today=TODAY)
    db.commit()
    done = _row(_rows(db, 8)[0], "MRA-1")
    assert done["awaiting_validation"] is False and done["waiting_since"] is None and done["status"] == "CD"


def test_an_imported_finding_already_in_review_waits_since_the_register_first_had_it(db):
    issue, profile = _finding(db, "MRA-2")
    issue.workflow_state = "closure_review"          # imported already reported done: no submit activity exists
    db.commit()
    row = _row(_rows(db, 8)[0], "MRA-2")
    assert row["awaiting_validation"] is True
    assert row["waiting_since"] == profile.created_at.date().isoformat()


def test_an_extension_request_shows_until_the_committee_decides(db):
    issue, profile = _finding(db, "MRA-1")
    assert _row(_rows(db, 8)[0], "MRA-1")["extension_requested"] is False
    request = workflow.request_extension(db, issue, profile, db.get(m.GRCUser, 7), TODAY + timedelta(days=90),
                                         "Vendor delay", None, today=TODAY)
    db.commit()
    assert _row(_rows(db, 8)[0], "MRA-1")["extension_requested"] is True
    workflow.decide_extension(db, request, db.get(m.GRCUser, 8), True, "Approved as minuted", today=TODAY)
    db.commit()
    assert _row(_rows(db, 8)[0], "MRA-1")["extension_requested"] is False


def test_an_alert_about_one_finding_opens_that_finding_and_a_summary_opens_the_register(db):
    issue, profile = _finding(db, "MRA-1")
    workflow.submit_for_validation(db, issue, profile, db.get(m.GRCUser, 7), "Policy attached", [], today=TODAY)
    workflow.decide_validation(db, issue, profile, db.get(m.GRCUser, 8), "more_info", "Need logs", today=TODAY)
    db.commit()
    links = _links(db)
    assert links == [f"/auditor-portal/issue-register?finding={issue.id}"] * 2
    assert workflow._notify(db, 1, [7], "Audit findings past due: 2", "Two findings.") == 1
    assert _links(db)[-1] == "/auditor-portal/issue-register"


def test_the_ai_assist_answer_never_names_the_model(db, monkeypatch):
    """The page-facing payload keeps its `model` key and says "AI" instead of the provider's model name."""
    from grc.modules.issue_management.audit_register import assist

    monkeypatch.setattr(assist, "get_openai_model", lambda: "a-secret-model-name")
    result = assist.suggest(db, 1, "regulatory", {"title": "Wire callbacks skipped", "issue_text": "Callbacks were skipped."},
                            today=TODAY, complete=lambda messages: '{"fields": {"risk_rating": {"value": "High", "reason": "Wires"}}}')
    assert result["model"] == "AI"
    assert "a-secret-model-name" not in str(result)


def test_the_extension_list_can_ask_for_the_undecided_ones_only(db):
    one, two = _finding(db, "MRA-1"), _finding(db, "MRA-2")
    owner, auditor = db.get(m.GRCUser, 7), db.get(m.GRCUser, 8)
    first = workflow.request_extension(db, one[0], one[1], owner, TODAY + timedelta(days=60), "Vendor delay", None, today=TODAY)
    workflow.request_extension(db, two[0], two[1], owner, TODAY + timedelta(days=90), "Staffing", None, today=TODAY)
    workflow.decide_extension(db, first, auditor, True, "Approved", today=TODAY)
    db.commit()
    user = db.get(m.GRCUser, 8)
    everything = api.list_extensions(db=db, current_user=user)
    waiting = api.list_extensions(status="requested", db=db, current_user=user)
    assert len(everything) == 2
    assert [x["status"] for x in waiting] == ["requested"] and waiting[0]["reference"] == "MRA-2"
