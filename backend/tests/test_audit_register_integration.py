"""The register in the platform's own Audit Logs and Workflows.

Before this, every register call landed as a generic "issues" row with no id —
"Created new issues" for a reminder click — and fired issue workflows. Now each
action writes one readable row of its own, the generic request row is skipped,
and the workflow engine turns the row into the register's named events.
"""
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc import audit_logger
from grc.models import get_db
from grc.modules.issue_management.routers import audit_register as api
from grc.modules.workflow_engine.services import catalog
from grc.modules.workflow_engine.services.action_handlers import _build_template_context
from grc.modules.workflow_engine.services.trigger_dispatcher import _EVENT_MAP, TriggerDispatcher
from grc.routers.auth_router import require_auth

BASE = "/grc/issue-management/issues/audit-register"


@pytest.mark.parametrize("method,path,expected", [
    ("POST", f"{BASE}/import", ("audit-register", None, "import")),
    ("PATCH", f"{BASE}/profile/42", ("audit-register", 42, "update")),
    ("DELETE", f"{BASE}/findings/42", ("audit-register", 42, "delete")),
    ("POST", f"{BASE}/findings/42/restore", ("audit-register", 42, "restore")),
    ("POST", f"{BASE}/validation/42/decide", ("audit-register", 42, "decide_validation")),
    ("POST", f"{BASE}/extensions/decide/7", ("audit-register", 7, "decide_extension")),
    ("POST", f"{BASE}/reminders", ("audit-register", None, "send_reminders")),
    ("GET", f"{BASE}/pack/export", ("audit-register", None, "export_pack")),
    ("GET", f"{BASE}/rows", ("audit-register", None, "read")),
])
def test_register_requests_are_named_as_the_register(method, path, expected):
    resource_type, resource_id = audit_logger._extract_resource(path)
    action = audit_logger._action_from_method(method, 200, path)

    assert (resource_type, resource_id, action) == expected
    assert audit_logger._action_from_method(method, 400, path) == (
        "read" if expected[2] == "read" else f"{expected[2]}_failed")


def test_other_issue_requests_are_classified_as_before():
    assert audit_logger._extract_resource("/grc/issue-management/issues/12") == ("issues", 12)
    assert audit_logger._action_from_method("POST", 200, "/grc/issue-management/issues") == "create"


def test_the_generic_row_is_skipped_once_the_endpoint_wrote_its_own(monkeypatch):
    opened = []

    def fake_session(slug):
        opened.append(slug)
        raise RuntimeError("stop here")                    # the write would start now
    monkeypatch.setattr("grc.db.open_tenant_session", fake_session)
    monkeypatch.setattr(audit_logger, "_resolve_tenant_slug", lambda request, tenant_id: "cfsb")

    def request(recorded):
        return SimpleNamespace(state=SimpleNamespace(audit_recorded=recorded, tenant_id=1),
                               url=SimpleNamespace(path=f"{BASE}/reminders"), cookies={},
                               headers={}, method="POST", client=None, query_params={})

    audit_logger.write_audit_log(request(False), SimpleNamespace(status_code=200), 0.0, {})
    assert opened == ["cfsb"]                              # without the flag it writes
    audit_logger.write_audit_log(request(True), SimpleNamespace(status_code=200), 0.0, {})
    assert opened == ["cfsb"]                              # with it, nothing more
    audit_logger.write_audit_log(request(True), SimpleNamespace(status_code=500), 0.0, {})
    assert opened == ["cfsb", "cfsb"]                      # a failure is still written


def test_each_register_event_is_in_the_workflow_builder_catalog():
    keys = {entry["key"] for entry in catalog.TRIGGER_NODE_TYPES}
    events = {e for kind in ("audit-register", "audit-register-import")
              for names in _EVENT_MAP[kind].values() for e in names}

    assert events - keys == set()


def test_a_passed_validation_fires_the_register_and_the_issue_events():
    row = m.AuditLog(resource_type="audit-register", action="validation_passed", changes={})

    names = TriggerDispatcher._derive_event_names(row)

    assert "audit_finding_validated" in names and "issue_closed" in names
    assert "issue_created" not in names


# ── through the API: readable rows, and the fields a workflow email can use ──

HEADERS = ["#", "Regulator", "Report #", "Report Name", "Report  Date", "Issue #", "Risk Rating",
           "Issue Name", "Issue", "Owner", "LOB", "Target Date", "Status (NS/IP/DE/ PD/ EXT/CD )"]


@pytest.fixture
def client(tmp_path):
    from grc.main import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    user = m.GRCUser(id=7, username="privera", email="p.rivera@bank.example", display_name="Pat Rivera")
    session.add(user)
    session.commit()
    for dependency in (api._require_create, api._require_edit, api._require_view, api._require_delete):
        app.dependency_overrides[dependency] = lambda: True
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = lambda: user

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Regulatory"
    sheet.append(["AS OF", date(2026, 9, 20)])
    sheet.append(HEADERS)
    sheet.append([1, "OCC", "R-1", "Exam", date(2025, 5, 1), "MRA-1", "High", "Wire controls",
                  "Detail", "Rivera, P", "Ops", date(2026, 12, 31), "IP"])
    path = tmp_path / "sep.xlsx"
    wb.save(path)
    yield TestClient(app), session, path
    app.dependency_overrides.clear()
    session.close()


def _rows(session):
    return [(r.resource_type, r.action, r.changes.get("summary"))
            for r in session.query(m.AuditLog).order_by(m.AuditLog.id)]


def test_register_actions_read_plainly_in_the_audit_log(client):
    http, session, path = client
    base = "/issue-management/issues/audit-register"
    with open(path, "rb") as handle:
        http.post(f"{base}/import", files={"file": ("sep.xlsx", handle, "application/octet-stream")})
    issue_id = session.query(m.AuditIssueProfile).one().issue_id

    http.request("DELETE", f"{base}/findings/{issue_id}", json={"reason": "raised twice"})
    http.post(f"{base}/findings/{issue_id}/restore")

    rows = _rows(session)
    assert rows[0][:2] == ("audit-register-import", "import")
    assert 'Imported the register workbook "sep.xlsx": 1 created' in rows[0][2]
    assert rows[1] == ("audit-register", "delete",
                       f"Deleted MRA-1 · Wire controls ({session.get(m.Issue, issue_id).code}) "
                       "from the register — raised twice")
    assert rows[2][:2] == ("audit-register", "restore")


def test_a_workflow_email_can_name_the_finding(client):
    http, session, path = client
    with open(path, "rb") as handle:
        http.post("/issue-management/issues/audit-register/import",
                  files={"file": ("sep.xlsx", handle, "application/octet-stream")})
    issue_id = session.query(m.AuditIssueProfile).one().issue_id
    instance = SimpleNamespace(tenant_id=1, trigger_payload={
        "resource_type": "audit-register", "resource_id": issue_id, "action": "delete",
        "user_id": 7, "changes": {"snapshot": {"after": {"reason": "raised twice"}}}})

    ctx = _build_template_context(session, instance, SimpleNamespace(name="Tell Audit Services"))

    assert (ctx["reference"], ctx["title"], ctx["source"]) == ("MRA-1", "Wire controls", "Regulator")
    assert ctx["register_status"] == "In Progress" and ctx["owner_name"] == "Pat Rivera"
    assert ctx["reason"] == "raised twice"


# ── the rest of the platform ─────────────────────────────────────────────────

def test_complychat_answers_audit_finding_questions_again():
    from grc.modules.chatbot.complychat.complychat.grc_sql_agent import is_deprecated_audit_query
    from grc.modules.chatbot.router import is_audit_related_question

    for question in ("Which audit findings are past due?", "open audit recommendations by owner",
                     "show the board pack"):
        assert not is_audit_related_question(question) and not is_deprecated_audit_query(question)
    for retired in ("list the audit plan", "PBC list for the engagement", "QAIP review status"):
        assert is_audit_related_question(retired) or is_deprecated_audit_query(retired)


def test_register_findings_carry_the_audit_source_and_old_ones_are_backfilled(client):
    from grc.modules.compliance.schema_migrations import _backfill_audit_register_source_type

    http, session, path = client
    with open(path, "rb") as handle:
        http.post("/issue-management/issues/audit-register/import",
                  files={"file": ("sep.xlsx", handle, "application/octet-stream")})
    issue = session.query(m.Issue).one()
    assert issue.source_type == "audit"

    issue.source_type = None                              # as imported before the change
    session.commit()
    _backfill_audit_register_source_type(session.get_bind())
    session.expire_all()
    assert session.query(m.Issue).one().source_type == "audit"
