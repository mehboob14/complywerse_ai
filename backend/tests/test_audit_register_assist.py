"""AI Assist on the add-a-finding form.

The model proposes the empty columns only; a list column only ever gets a value
the platform already has; the owner's own record decides their title and LOB;
the target date comes from the remediation windows in Settings; and without a
key, or when the provider fails, it says so and still offers what needs no model.
"""
import json
from datetime import date, timedelta

import pytest
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import assist, settings as S
from grc.modules.issue_management.audit_register.editing import create_finding
from grc.modules.issue_management.audit_register.parser import parse_workbook
from grc.modules.issue_management.audit_register.service import apply_workbook

TODAY = date(2026, 9, 21)
REG = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
       "Issue Name", "Issue", "Owner", "Title", "LOB", "Target Date",
       "Status (NS/IP/DE/ PD/ EXT/CD )", "Validation Pass/Fail"]


@pytest.fixture
def db(tmp_path):
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", TODAY])
    sheet.append(REG)
    sheet.append([1, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-1", "High", "Wire controls",
                  "Detail", "Rivera, P", "Director", "Ops", TODAY + timedelta(days=5), "IP", ""])
    sheet.append([2, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-2", "Low", "Vendor oversight",
                  "Detail", "Morgan, L", "Manager", "TPRM", TODAY - timedelta(days=40), "IP", ""])
    path = tmp_path / "sep.xlsx"
    wb.save(path)

    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
        session.add(m.GRCUser(id=7, username="privera", email="p.rivera@bank.example", is_active=True,
                              display_name="Pat Rivera", designation="Payments Operations Director",
                              department="Operations"))
        session.add(m.GRCUser(id=8, username="lmorgan", email="l.morgan@bank.example", is_active=True,
                              display_name="Lee Morgan", designation="Vendor Manager"))
        session.commit()
        apply_workbook(session, 1, parse_workbook(str(path)), actor_id=8)
        session.commit()
        yield session


def _exam(db):
    S.sync_reports(db, 1)
    return db.query(m.AuditRegisterReport).filter(m.AuditRegisterReport.report_key == "R-1").one()


class FakeModel:
    def __init__(self, answer):
        self.answer, self.messages = answer, None

    def __call__(self, messages):
        self.messages = messages
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer if isinstance(self.answer, str) else json.dumps(self.answer)

    @property
    def prompt(self):
        return self.messages[1]["content"]


def test_it_proposes_only_the_empty_columns_and_only_values_the_platform_has(db):
    model = FakeModel("```json\n" + json.dumps({"fields": {
        "risk_rating": {"value": "HIGH", "reason": "Wires move money"},
        "causes": {"value": ["No written callback procedure", "No training"], "reason": "Typical"},
        "consequences": {"value": "1. Fraud losses\n2. A repeat MRA", "reason": "Exposure"},
        "owner": {"value": 7, "reason": "Owns the wire findings"},
        "owner_title": {"value": "Chief Wizard", "reason": "made up"},
        "lob": {"value": "Imaginary LOB", "reason": "made up"},
        "management_action_plan": {"value": "1. Write the procedure\n2. Train [team]", "reason": "Fixes cause"},
        "title": {"value": "A different name", "reason": "already given"},
        "foo": {"value": "bar", "reason": "not a column"},
    }}) + "\n```")
    result = assist.suggest(db, 1, "regulatory", {
        "title": "Wire callbacks skipped", "issue_text": "Examiners found callbacks were skipped for [number] wires.",
        "ia_status": "NS", "issue_ref": "MRA-3"}, report_id=_exam(db).id, today=TODAY, complete=model)

    got = {s["field"]: s for s in result["suggestions"]}
    assert got["risk_rating"]["value"] == "High"                         # the template's own spelling
    assert got["causes"]["value"] == "1. No written callback procedure\n2. No training"
    assert got["owner"]["value"] == 7 and got["owner"]["display"] == "Pat Rivera"
    assert (got["owner_title"]["value"], got["owner_title"]["source"]) == ("Director", "register")
    assert (got["lob"]["value"], got["lob"]["source"]) == ("Ops", "register")
    # 90 days from the 2025 report date is long past: counted from today instead.
    assert got["target_date"] == {**got["target_date"], "value": "2026-12-20", "source": "rule"}
    assert "title" not in got and "issue_text" not in got and "foo" not in got
    assert result["dropped"] == ["lob", "owner_title"] and result["notice"] is None
    assert [s["field"] for s in result["suggestions"]] == [
        "risk_rating", "causes", "consequences", "management_action_plan", "owner", "owner_title", "lob",
        "target_date"]                                                    # the sheet's own order

    prompt = model.prompt
    assert "REPORT: OCC · Exam · #R-1 · 2025-05-01" in prompt
    assert "Allowed values: High; Moderate; Medium; Low" in prompt
    assert "MRA-1 · Wire controls · High · owner Pat Rivera (user id 7) · LOB Ops" in prompt
    assert "7 | Pat Rivera | Payments Operations Director | Operations | 1 findings" in prompt
    assert "- title:" not in prompt and "- issue_text:" not in prompt   # already entered
    assert "never invent" in model.messages[0]["content"].lower()


def test_without_an_ai_key_it_says_so_and_still_offers_what_needs_no_model(db, monkeypatch):
    monkeypatch.setattr(assist, "get_openai_api_key", lambda: None)
    S.save_settings(db, 1, {"target_days": {"Low": 60}})
    result = assist.suggest(db, 1, "regulatory", {"title": "Vendor list stale", "risk_rating": "Low",
                                                  "owner": 8}, today=TODAY)
    assert "no AI key" in result["notice"] and result["model"] is None
    got = {s["field"]: s["value"] for s in result["suggestions"]}
    assert got == {"owner_title": "Manager", "lob": "TPRM", "target_date": "2026-11-20"}


@pytest.mark.parametrize("answer, notice", [
    ("Sorry, I cannot help with that.", "could not be read"),
    (RuntimeError("connection reset"), "did not answer (RuntimeError)"),
])
def test_an_unusable_answer_or_a_provider_failure_is_a_notice_not_an_error(db, answer, notice):
    result = assist.suggest(db, 1, "regulatory", {"title": "Wire callbacks skipped"}, today=TODAY,
                            complete=FakeModel(answer))
    assert notice in result["notice"] and result["suggestions"] == []


def test_it_needs_something_to_work_from(db):
    with pytest.raises(ValueError, match="issue name"):
        assist.suggest(db, 1, "regulatory", {"issue_ref": "MRA-3", "ia_status": "NS"}, complete=FakeModel({}))
    with pytest.raises(ValueError):
        assist.suggest(db, 1, "nonsense", {"title": "x" * 10}, complete=FakeModel({}))
    with pytest.raises(ValueError):
        assist.suggest(db, 1, "it_pen", {"title": "Open bucket"}, report_id=_exam(db).id, complete=FakeModel({}))


def test_the_remediation_windows_are_checked(db):
    for patch in ({"target_days": {"Critical": 30}}, {"target_days": {"High": 0}}):
        with pytest.raises(ValueError):
            S.save_settings(db, 1, patch)
    assert S.save_settings(db, 1, {"target_days": {"High": 45}})["target_days"]["High"] == 45


def test_the_finding_s_history_says_which_columns_ai_drafted(db):
    profile = create_finding(db, 1, "regulatory", {"title": "Wire callbacks skipped", "causes": "1. No procedure"},
                             ai_fields=["causes", "consequences"])
    activity = db.query(m.IssueActivity).filter(m.IssueActivity.issue_id == profile.issue_id,
                                                m.IssueActivity.type == "register_created").one()
    assert activity.payload["ai_fields"] == ["causes"]                  # consequences was not kept
