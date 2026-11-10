"""The two lists the issue and corrective-action registers read whole: GET /issue-management/issues and GET /issue-management/actions.

What the registers need, all additive: lean rows (no long text), "mine", the issues linked to one record, lateness read when asked for (not the stored flag), one
"is open" rule, the actions done / open per issue, and the corrective-action list with its issue's code and title and a true total. Nothing here writes.
"""
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.issue_management.routers import actions as actions_api
from grc.modules.issue_management.routers import issues as api
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()


@pytest.fixture
def world():
    from grc.main import app

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="CFSB", slug="cfsb"))
    me = m.GRCUser(id=7, username="privera", email="p.rivera@bank.example", display_name="Pat Rivera")
    other = m.GRCUser(id=8, username="lkhan", email="l.khan@bank.example", display_name="Lina Khan")
    session.add_all([me, other])
    session.commit()
    app.dependency_overrides[get_db] = lambda: session
    app.dependency_overrides[require_auth] = lambda: me
    for dep in (api._require_view, actions_api._require_view):
        app.dependency_overrides[dep] = lambda: True
    yield TestClient(app), session
    app.dependency_overrides.clear()
    session.close()


def _issue(session, code, **kw):
    fields = dict(tenant_id=1, code=code, title=f"Issue {code}", description="long text " * 50, severity="medium", workflow_state="new", status="open",
                  created_at=NOW - timedelta(days=1))
    fields.update(kw)
    row = m.Issue(**fields)
    session.add(row)
    session.commit()
    return row


def _action(session, issue, **kw):
    fields = dict(issue_id=issue.id, title="Patch it", action_type="corrective", status="planned")
    fields.update(kw)
    row = m.IssueAction(**fields)
    session.add(row)
    session.commit()
    return row


def _rows(http, **params):
    r = http.get("/issue-management/issues", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_lean_row_has_no_long_text_and_a_full_row_still_does(world):
    http, session = world
    _issue(session, "ISS-1", severity_override_reason="because")
    full = _rows(http)["items"][0]
    lean = _rows(http, lean=1)["items"][0]
    assert full["description"].startswith("long text") and full["severity_override_reason"] == "because"
    assert "description" not in lean and "severity_override_reason" not in lean
    assert {k for k in full if k not in ("description", "severity_override_reason")} == set(lean)


def test_every_row_says_whether_it_is_open_late_and_how_many_actions_are_done(world):
    http, session = world
    late = _issue(session, "ISS-1", workflow_state="closure_review", target_closure_date=NOW - timedelta(days=3, hours=2))
    _issue(session, "ISS-2", workflow_state="closed", target_closure_date=NOW - timedelta(days=9), sla_breached=True)
    _issue(session, "ISS-3", workflow_state=None, target_closure_date=NOW + timedelta(days=2))
    _action(session, late, status="completed")
    _action(session, late, status="verified")
    _action(session, late, status="blocked")
    _action(session, late, status="cancelled")
    rows = {r["code"]: r for r in _rows(http)["items"]}
    assert rows["ISS-1"]["is_open"] is True, "closure review is open: somebody still has to approve it"
    assert rows["ISS-1"]["sla_breached"] is True and rows["ISS-1"]["overdue_days"] == 3
    assert (rows["ISS-1"]["action_count"], rows["ISS-1"]["actions_done"], rows["ISS-1"]["actions_open"]) == (4, 2, 1)
    assert rows["ISS-2"]["is_open"] is False
    assert rows["ISS-2"]["sla_breached"] is False and rows["ISS-2"]["overdue_days"] is None, "a closed issue is never late, whatever the stored flag says"
    assert rows["ISS-3"]["is_open"] is True, "an issue with no state is a new one"
    assert rows["ISS-3"]["sla_breached"] is False
    assert (rows["ISS-3"]["action_count"], rows["ISS-3"]["actions_done"], rows["ISS-3"]["actions_open"]) == (0, 0, 0)


def test_late_is_read_when_asked_for_not_from_the_stored_flag(world):
    http, session = world
    # nobody wrote the flag: an issue raised by an event or from a record never sets it
    _issue(session, "ISS-1", target_closure_date=NOW - timedelta(days=2), sla_breached=False)
    _issue(session, "ISS-2", target_closure_date=NOW + timedelta(days=2), sla_breached=True)       # a stale flag
    _issue(session, "ISS-3", target_closure_date=None)
    _issue(session, "ISS-4", workflow_state="cancelled", target_closure_date=NOW - timedelta(days=2))
    codes = lambda **p: sorted(r["code"] for r in _rows(http, **p)["items"])
    assert codes(sla_breached="true") == ["ISS-1"]
    assert codes(overdue="true") == ["ISS-1"]
    assert codes(sla_breached="false") == ["ISS-2", "ISS-3", "ISS-4"]
    assert _rows(http, overdue="true")["total"] == 1


def test_mine_means_the_signed_in_person_and_a_bad_value_is_refused(world):
    http, session = world
    _issue(session, "ISS-1", assignee_id=7)
    _issue(session, "ISS-2", assignee_id=8)
    _issue(session, "ISS-3")
    assert [r["code"] for r in _rows(http, assignee_id="me")["items"]] == ["ISS-1"]
    assert [r["code"] for r in _rows(http, assignee_id="ME")["items"]] == ["ISS-1"]
    assert [r["code"] for r in _rows(http, assignee_id=8)["items"]] == ["ISS-2"]
    assert http.get("/issue-management/issues", params={"assignee_id": "nobody"}).status_code == 422


def test_the_issues_linked_to_one_record(world):
    http, session = world
    a, b, c = _issue(session, "ISS-1"), _issue(session, "ISS-2"), _issue(session, "ISS-3")
    session.add_all([m.IssueRiskLink(issue_id=a.id, risk_id=5), m.IssueRiskLink(issue_id=b.id, risk_id=6), m.IssueAssetLink(issue_id=c.id, asset_id=5)])
    session.commit()
    codes = lambda **p: [r["code"] for r in _rows(http, **p)["items"]]
    assert codes(linked_type="risk", linked_id=5) == ["ISS-1"]
    assert codes(linked_type="asset", linked_id=5) == ["ISS-3"], "a risk and an asset can share a number"
    assert codes(linked_type="risk", linked_id=99) == []
    assert _rows(http, linked_type="risk", linked_id=5)["total"] == 1
    assert http.get("/issue-management/issues", params={"linked_type": "risk"}).status_code == 400
    assert http.get("/issue-management/issues", params={"linked_type": "banana", "linked_id": 1}).status_code == 400


def test_the_issues_linked_to_a_task(world):
    http, session = world
    a, _b = _issue(session, "ISS-1"), _issue(session, "ISS-2")
    session.add(m.CriticalTask(id=31, tenant_id=1, title="Fix it", linked_issue_id=a.id))
    session.commit()
    assert [r["code"] for r in _rows(http, linked_type="task", linked_id=31)["items"]] == ["ISS-1"]
    assert _rows(http, linked_type="task", linked_id=32)["items"] == []


def test_the_default_list_is_what_it_was(world):
    http, session = world
    for n in range(3):
        _issue(session, f"ISS-{n}", created_at=NOW - timedelta(days=n))
    body = _rows(http)
    assert [r["code"] for r in body["items"]] == ["ISS-0", "ISS-1", "ISS-2"], "newest first"
    assert body["total"] == 3
    assert {"id", "code", "title", "description", "severity", "workflow_state", "status", "owner", "assignee", "reporter", "target_closure_date", "sla_breached", "action_count"} <= set(body["items"][0])


def test_the_corrective_action_list_names_its_issue_and_says_how_many_there_are(world):
    http, session = world
    one = _issue(session, "ISS-1", title="Unpatched gateway")
    two = _issue(session, "ISS-2")
    _action(session, one, title="Patch", status="in_progress", due_date=NOW - timedelta(days=4), assignee_id=7)
    _action(session, one, title="Verify", status="completed", due_date=NOW - timedelta(days=4))
    _action(session, two, title="Review", status="planned", due_date=NOW + timedelta(days=4), assignee_id=8)
    _action(session, two, title="No date")
    plain = http.get("/issue-management/actions")
    assert plain.status_code == 200 and isinstance(plain.json(), list) and len(plain.json()) == 4
    assert "x-total-count" not in plain.headers, "without a limit it is the list it always was"
    rows = {r["title"]: r for r in plain.json()}
    assert (rows["Patch"]["issue_code"], rows["Patch"]["issue_title"]) == ("ISS-1", "Unpatched gateway")
    assert rows["Patch"]["overdue"] is True and rows["Patch"]["overdue_days"] == 4
    assert rows["Verify"]["overdue"] is False, "a completed action is not late"
    assert rows["Review"]["overdue"] is False and rows["No date"]["overdue"] is False
    assert {"assignee_name", "status", "action_type", "due_date", "linked_critical_task_id"} <= set(rows["Patch"])


def test_the_corrective_action_list_filters_and_cuts_with_a_true_total(world):
    http, session = world
    one, two = _issue(session, "ISS-1"), _issue(session, "ISS-2")
    _action(session, one, title="A", status="in_progress", due_date=NOW - timedelta(days=4), assignee_id=7)
    _action(session, one, title="B", status="planned", due_date=NOW + timedelta(days=1), assignee_id=8)
    _action(session, two, title="C", status="blocked", due_date=NOW - timedelta(days=1), assignee_id=7)
    _action(session, two, title="D", status="verified", due_date=NOW - timedelta(days=1))
    titles = lambda **p: sorted(r["title"] for r in http.get("/issue-management/actions", params=p).json())
    assert titles(assignee_id="me") == ["A", "C"]
    assert titles(overdue="true") == ["A", "C"]
    assert titles(overdue="false") == ["B", "D"]
    assert titles(issue_id=two.id) == ["C", "D"]
    assert titles(status_filter="blocked") == ["C"]
    cut = http.get("/issue-management/actions", params={"limit": 2})
    assert len(cut.json()) == 2 and cut.headers["x-total-count"] == "4"
    rest = http.get("/issue-management/actions", params={"limit": 2, "skip": 2})
    assert len(rest.json()) == 2 and rest.headers["x-total-count"] == "4"
    assert {r["id"] for r in cut.json()}.isdisjoint({r["id"] for r in rest.json()})
    assert http.get("/issue-management/actions", params={"assignee_id": "x"}).status_code == 422
