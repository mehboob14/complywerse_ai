"""Task Management's register (Stage 4 tasks-register): the complete lean load (``GET /critical-tasks?lean=1``), the filters both lists share, the words a task's source and links and its history
need, and the additive bug fixes (trend months, recurrence copying, sub-task title length, the AI's failure text). Who sees which task is test_task_visibility's rule; here the lean list is held
to the full list: the same tasks for the same person, the same SLA words, and nothing written by a read."""
import importlib
from datetime import datetime, timedelta
from types import SimpleNamespace as NS

import pytest
from dateutil.relativedelta import relativedelta

import grc.models as m

from test_document_lifecycle import _secret, tasks, user, world  # noqa: F401  (_secret and world are fixtures)
from test_document_tasks import grant, http  # noqa: F401  (http is a fixture)

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")

OWNER, CO, REVIEWER, CREATOR, OTHER, ADMIN = 1, 2, 3, 4, 6, 7           # the people of test_document_lifecycle.world


def add(db, title="Task", **kw):
    fields = dict(tenant_id=1, title=title, status="Open", priority="High", category="Other", assigned_owner_id=OWNER, assigned_user_ids=[OWNER], created_by_id=CREATOR)
    fields.update(kw)
    t = m.CriticalTask(**fields)
    db.add(t)
    db.commit()
    return t


def ids(response):
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()["items"]}


# ── the lean list is the full list, compact ──────────────────────────────────────────────────────────────────────────────────────────────
def test_lean_is_the_complete_compact_list_with_true_counts(http):
    db = http.db
    t = add(db, "Patch the VPN", description="a long text " * 50, evidence_notes="notes", custom_values={"team": "net"}, assigned_user_ids=[OWNER, CO], reviewer_id=REVIEWER,
            due_date=datetime.utcnow() + timedelta(days=2))
    for title, status in (("a", "Completed"), ("b", "Open"), ("c", "Completed")):
        db.add(m.CriticalTaskSubTask(task_id=t.id, title=title, status=status))
    db.add(m.CriticalTaskComment(task_id=t.id, user_id=OWNER, content="hello"))
    db.add(m.CriticalTaskComment(task_id=t.id, user_id=CO, content="again"))
    db.commit()
    http.me["u"] = ADMIN
    got = http.get("/critical-tasks", params={"lean": 1, "limit": 10000}).json()
    assert got["lean"] is True and got["total"] == 1 and got["truncated"] is False and got["scope"] == "all" and got["limit"] == 10000
    row = got["items"][0]
    assert (row["sub_task_total"], row["sub_task_done"], row["comment_count"]) == (3, 2, 2)
    for heavy in ("description", "evidence_notes", "custom_values", "approval_comment", "tenant_id"):
        assert heavy not in row, heavy
    assert row["assignees"] == [{"id": OWNER, "display_name": "Olivia Owner"}, {"id": CO, "display_name": "Rana Reviewer"}]
    assert row["assigned_owner"] == {"id": OWNER, "display_name": "Olivia Owner"} and row["reviewer"]["id"] == REVIEWER and row["created_by"]["id"] == CREATOR
    assert row["sla_status"] == "At Risk" and row["approval_required"] is False and row["links"] == [] and row["source_label"] is None


def test_lean_answers_the_same_tasks_and_the_same_sla_words_as_the_full_list(http):
    db, now = http.db, datetime.utcnow()
    for i, due in enumerate([None, now - timedelta(days=10), now - timedelta(hours=2), now + timedelta(hours=2), now + timedelta(days=3, hours=12), now + timedelta(days=4, hours=12), now + timedelta(days=40)]):
        add(db, f"Open {i}", due_date=due)
    add(db, "Done late", status="Completed", due_date=now - timedelta(days=5), completed_at=now)
    add(db, "Verified", status="Verified", due_date=now + timedelta(days=1))
    http.me["u"] = ADMIN
    full = {r["id"]: r for r in http.get("/critical-tasks", params={"limit": 500}).json()["items"]}
    lean = {r["id"]: r for r in http.get("/critical-tasks", params={"lean": 1, "limit": 500}).json()["items"]}
    assert set(full) == set(lean) and len(lean) == 9
    for tid, row in lean.items():
        assert row["sla_status"] == full[tid]["sla_status"], row["title"]
        assert row["due_date"] == full[tid]["due_date"] and row["status"] == full[tid]["status"]
    assert sorted(r["sla_status"] for r in lean.values()) == ["At Risk", "At Risk", "Breached", "Breached", "Completed", "Completed", "No SLA", "On Track", "On Track"]


def test_lean_is_cut_to_what_the_person_may_see_and_says_when_it_holds_fewer_than_there_are(http):
    db = http.db
    add(db, "Mine", assigned_owner_id=OTHER, assigned_user_ids=[OTHER])
    for i in range(5):
        add(db, f"Theirs {i}")
    http.me["u"] = OTHER
    got = http.get("/critical-tasks", params={"lean": 1}).json()
    assert [r["title"] for r in got["items"]] == ["Mine"] and got["total"] == 1 and got["scope"] == "mine"
    http.me["u"] = ADMIN
    page = http.get("/critical-tasks", params={"lean": 1, "limit": 4}).json()
    assert (len(page["items"]), page["total"], page["truncated"], page["limit"]) == (4, 6, True, 4)
    assert http.get("/critical-tasks", params={"lean": 1, "limit": 99999}).json()["limit"] == 10000, "the ceiling"
    rest = http.get("/critical-tasks", params={"lean": 1, "limit": 4, "skip": 4}).json()
    assert len(rest["items"]) == 2 and rest["truncated"] is False
    assert {r["id"] for r in page["items"]}.isdisjoint({r["id"] for r in rest["items"]}), "pages never repeat a task"


def test_a_lean_read_writes_nothing_and_shows_the_escalation_the_full_list_would_raise(http):
    db = http.db
    late = add(db, "Late", due_date=datetime.utcnow() - timedelta(days=9), escalation_level=0)
    soon = add(db, "Soon", due_date=datetime.utcnow() + timedelta(days=2), escalation_level=0)
    http.me["u"] = ADMIN
    rows = {r["title"]: r for r in http.get("/critical-tasks", params={"lean": 1}).json()["items"]}
    assert (rows["Late"]["escalation_level"], rows["Soon"]["escalation_level"]) == (3, 1)
    db.expire_all()
    assert (db.get(m.CriticalTask, late.id).escalation_level, db.get(m.CriticalTask, soon.id).escalation_level) == (0, 0)
    assert db.query(m.CriticalTaskHistory).count() == 0, "no history row was written by a read"
    http.get("/critical-tasks")                              # the full list raises the stored level, as it always did
    db.expire_all()
    assert (db.get(m.CriticalTask, late.id).escalation_level, db.get(m.CriticalTask, soon.id).escalation_level) == (3, 1)


# ── the filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_filters_by_any_assignee_reviewer_creator_overdue_sla_approval_and_module(http):
    db, now = http.db, datetime.utcnow()
    a = add(db, "A", assigned_owner_id=OWNER, assigned_user_ids=[OWNER, CO], reviewer_id=REVIEWER, due_date=now - timedelta(days=2), approval_required=True, approval_status="Pending")
    b = add(db, "B", assigned_owner_id=CO, assigned_user_ids=[CO], created_by_id=OTHER, due_date=now + timedelta(days=30), approval_required=True, approval_status="Approved")
    c = add(db, "C", assigned_owner_id=None, assigned_user_ids=[], source_module="committees", source_entity_type="OversightAction", source_entity_id=1)
    d = add(db, "D", status="Completed", due_date=now - timedelta(days=9), completed_at=now)
    http.me["u"] = ADMIN

    def ask(**params):
        return ids(http.get("/critical-tasks", params={"lean": 1, **params}))

    assert ask(assignee_id=CO) == {a.id, b.id}, "a co-assignee is found (the owner filter looks at the first owner only)"
    assert ask(assigned_owner_id=CO) == {b.id}
    assert ask(reviewer_id=REVIEWER) == {a.id}
    assert ask(created_by_id=OTHER) == {b.id}
    assert ask(overdue=1) == {a.id}, "overdue is open and past due: a completed task is not"
    assert ask(sla_status="Breached") == {a.id}
    assert ask(sla_status="On Track") == {b.id}
    assert ask(sla_status="No SLA") == {c.id}
    assert ask(sla_status="Completed") == {d.id}
    assert ask(sla_status="Nonsense") == {a.id, b.id, c.id, d.id}, "an unknown SLA word filters nothing"
    assert ask(approval_status="Pending") == {a.id}
    assert ask(approval_status="Approved") == {b.id}
    assert ask(approval_status="none") == {c.id, d.id}
    assert ask(source_module="committees") == {c.id}
    assert ask(assignee_id=CO, overdue=1) == {a.id}
    assert ids(http.get("/critical-tasks", params={"assignee_id": CO})) == {a.id, b.id}, "the full list takes them too"


def test_the_sql_sla_states_equal_the_servers_words_at_either_side_of_every_edge(http):
    db, now = http.db, datetime.utcnow()
    for i, due in enumerate([now - timedelta(days=30), now - timedelta(hours=1), now + timedelta(hours=1), now + timedelta(days=2), now + timedelta(days=3, hours=20),
                             now + timedelta(days=4, hours=2), now + timedelta(days=90), None]):
        add(db, f"T{i}", due_date=due)
    add(db, "Done", status="Verified", due_date=now - timedelta(days=3))
    http.me["u"] = ADMIN
    words = {r["id"]: r["sla_status"] for r in http.get("/critical-tasks", params={"lean": 1}).json()["items"]}
    for word in ("Completed", "No SLA", "Breached", "At Risk", "On Track"):
        assert ids(http.get("/critical-tasks", params={"lean": 1, "sla_status": word})) == {tid for tid, w in words.items() if w == word}, word


# ── where a task came from, what it is linked to, its history in words ───────────────────────────────────────────────────────────────────
def test_the_lean_rows_and_the_task_say_where_they_came_from_and_name_what_they_are_linked_to(http):
    db = http.db
    risk = m.Risk(tenant_id=1, title="Supplier outage", category="operational")
    ctl = m.InternalControl(tenant_id=1, control_id="IC-7", name="Backups tested")
    vuln = m.Vulnerability(tenant_id=1, vuln_id="VULN-1", title="Open SSH", severity="high")
    jr = m.CertificationJourney(tenant_id=1, name="ISO 27001")
    action = m.OversightAction(tenant_id=1, committee_id=5, title="Follow up")
    db.add_all([risk, ctl, vuln, jr, action])
    db.commit()
    manual = add(db, "By hand", linked_risk_id=risk.id, linked_control_id=ctl.id, linked_vulnerability_id=vuln.id, linked_framework_id=jr.id, linked_requirement_id=99)
    gone = add(db, "Dangling", linked_risk_id=424242)
    committee = add(db, "Committee", source_module="committees", source_entity_type="OversightAction", source_entity_id=action.id)
    reg = add(db, "Regulatory", source_module="regulatory_changes", source_entity_type="RegulatoryImplementationTask", linked_regulatory_change_id=12)
    issue = add(db, "Issue", source_module="issue_management", source_entity_type="IssueAction", linked_issue_id=3)
    flow = add(db, "Flow", source_module="workflow_engine", source_entity_type="WorkflowInstance", source_entity_id=8)
    find = add(db, "Finding", source_module="vendor_risk", source_entity_type="TPRARemediation", source_entity_id=1)
    db.add(m.TPRAFinding(tenant_id=1, vendor_id=77, assessment_id=1, task_id=find.id))
    db.commit()
    http.me["u"] = ADMIN
    lean = {r["title"]: r for r in http.get("/critical-tasks", params={"lean": 1}).json()["items"]}
    assert lean["By hand"]["source_label"] is None
    assert lean["By hand"]["links"] == [
        {"kind": "risk", "id": risk.id, "title": "Supplier outage", "href": f"/erm/risks/{risk.id}"},
        {"kind": "control", "id": ctl.id, "title": "IC-7 - Backups tested", "href": f"/erm/internal-controls/{ctl.id}"},
        {"kind": "vulnerability", "id": vuln.id, "title": "Open SSH", "href": f"/cyber-assurance/vulnerabilities/{vuln.id}"},
        {"kind": "framework", "id": jr.id, "title": "ISO 27001", "href": f"/frameworks/{jr.id}"},
        {"kind": "requirement", "id": 99, "title": "A requirement of the framework", "href": f"/frameworks/{jr.id}"},
    ]
    assert lean["Dangling"]["links"] == [{"kind": "risk", "id": 424242, "title": None, "href": None}], "a deleted record keeps its place with no title"
    assert (lean["Committee"]["source_label"], lean["Committee"]["source_href"]) == ("Committee action", "/governance/committees/5")
    assert (lean["Regulatory"]["source_label"], lean["Regulatory"]["source_href"]) == ("Regulatory change", "/governance/regulatory-changes/12?tab=tasks")
    assert (lean["Issue"]["source_label"], lean["Issue"]["source_href"]) == ("Issue action", "/issues/3")
    assert (lean["Flow"]["source_label"], lean["Flow"]["source_href"]) == ("Workflow", None)
    assert (lean["Finding"]["source_label"], lean["Finding"]["source_href"]) == ("Vendor finding", "/vendor-risk/vendors/77")
    one = http.get(f"/critical-tasks/{manual.id}").json()
    assert one["links"] == lean["By hand"]["links"] and one["source_label"] is None
    assert http.get(f"/critical-tasks/{committee.id}").json()["source_href"] == "/governance/committees/5"
    assert http.get(f"/critical-tasks/{issue.id}").json()["linked_issue_id"] == 3, "the issue link was never sent before"
    assert http.get(f"/critical-tasks/{gone.id}").json()["links"][0]["title"] is None
    assert reg.id and flow.id


def test_a_document_requests_source_is_its_document(http):
    db = http.db
    t = add(db, "Acknowledge the policy", source="Governance document", source_module="document_lifecycle", source_entity_type="DocumentObligation", source_entity_id=1)
    db.add(m.DocumentObligation(id=1, tenant_id=1, document_id=5, user_id=OWNER, kind="acknowledgement", status="pending", critical_task_id=t.id, document_version="1.0"))
    db.commit()
    http.me["u"] = ADMIN
    row = http.get("/critical-tasks", params={"lean": 1}).json()["items"][0]
    assert (row["source_label"], row["source_href"]) == ("Document request", "/governance/documents/5")
    assert row["document_request"]["kind"] == "acknowledgement" and "again" not in row["document_request"]


def test_the_history_names_the_people_instead_of_their_ids(http):
    db = http.db
    t = add(db, "Handover", assigned_owner_id=OWNER, assigned_user_ids=[OWNER], reviewer_id=None)
    http.me["u"] = ADMIN
    assert http.put(f"/critical-tasks/{t.id}", json={"assigned_user_ids": [CO, OTHER]}).status_code == 200
    assert http.put(f"/critical-tasks/{t.id}", json={"reviewer_id": REVIEWER}).status_code == 200
    assert http.put(f"/critical-tasks/{t.id}", json={"priority": "Low"}).status_code == 200
    history = {h["field_changed"]: h for h in http.get(f"/critical-tasks/{t.id}").json()["history"]}
    assert (history["assigned_user_ids"]["old_label"], history["assigned_user_ids"]["new_label"]) == ("Olivia Owner", "Rana Reviewer, Uma User")
    assert (history["assigned_owner_id"]["old_label"], history["assigned_owner_id"]["new_label"]) == ("Olivia Owner", "Rana Reviewer")
    assert (history["reviewer_id"]["old_label"], history["reviewer_id"]["new_label"]) == ("Nobody", "Rafay Reviewer")
    assert history["priority"]["old_label"] is None and history["priority"]["old_value"] == "High", "words stay as they are"
    again = {h["field_changed"]: h for h in http.get(f"/critical-tasks/{t.id}/history").json()}
    assert again["reviewer_id"]["new_label"] == "Rafay Reviewer"
    db.add(m.CriticalTaskHistory(task_id=t.id, user_id=ADMIN, action="Updated", field_changed="reviewer_id", old_value="8", new_value="None"))
    db.commit()
    gone = [h for h in http.get(f"/critical-tasks/{t.id}").json()["history"] if h["old_value"] == "8"][0]
    assert (gone["old_label"], gone["new_label"]) == ("Gone Away", "Nobody")


# ── the bug fixes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_trend_is_twelve_consecutive_calendar_months_even_in_march(http, monkeypatch):
    class March(datetime):
        @classmethod
        def utcnow(cls):
            return cls(2026, 3, 31, 12, 0, 0)

    monkeypatch.setattr(critical_tasks_router, "datetime", March)
    add(http.db, "Feb task", created_at=datetime(2026, 2, 15), status="Completed", completed_at=datetime(2026, 2, 20))
    add(http.db, "Mar task", created_at=datetime(2026, 3, 2))
    http.me["u"] = ADMIN
    trend = http.get("/critical-tasks/reports/summary").json()["trend_data"]
    assert [t["month"] for t in trend] == ["Apr 2025", "May 2025", "Jun 2025", "Jul 2025", "Aug 2025", "Sep 2025", "Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026"]
    by = {t["month"]: t for t in trend}
    assert (by["Feb 2026"]["created"], by["Feb 2026"]["completed"], by["Mar 2026"]["created"]) == (1, 1, 1)


def test_a_recurring_task_comes_back_with_its_people_links_custom_values_and_notes(http):
    db = http.db
    t = add(db, "Monthly access check", assigned_owner_id=OWNER, assigned_user_ids=[OWNER, CO, OTHER], reviewer_id=REVIEWER, recurrence_pattern="monthly", recurrence_interval=1,
            due_date=datetime.utcnow() + timedelta(days=5), linked_risk_id=11, linked_control_id=12, linked_vulnerability_id=13, linked_framework_id=14, linked_requirement_id=15,
            linked_regulatory_change_id=16, custom_values={"team": "net"}, evidence_notes="screenshots in the drive")
    http.me["u"] = ADMIN
    for step in ("In Progress", "Under Review", "Completed"):
        assert http.post(f"/critical-tasks/{t.id}/transition", json={"new_status": step}).status_code == 200, step
    db.expire_all()
    nxt = db.query(m.CriticalTask).filter(m.CriticalTask.parent_task_id == t.id).one()
    assert nxt.status == "Open" and nxt.assigned_user_ids == [OWNER, CO, OTHER] and nxt.assigned_owner_id == OWNER and nxt.reviewer_id == REVIEWER
    assert (nxt.linked_risk_id, nxt.linked_control_id, nxt.linked_vulnerability_id, nxt.linked_framework_id, nxt.linked_requirement_id) == (11, 12, 13, 14, 15)
    assert nxt.linked_regulatory_change_id is None, "a regulatory change belongs to one task"
    assert nxt.custom_values == {"team": "net"} and nxt.evidence_notes == "screenshots in the drive"
    assert nxt.custom_values is not t.custom_values
    said = [h.new_value for h in nxt.history]
    assert said == ["Repeated from “Monthly access check”"], said


def test_a_sub_task_title_over_255_characters_is_refused_in_words_not_a_500(http):
    db = http.db
    t = add(db, "Checklist")
    http.me["u"] = ADMIN
    long = http.post(f"/critical-tasks/{t.id}/sub-tasks", json={"title": "x" * 256})
    assert long.status_code == 400 and "255 characters at most" in long.json()["detail"] and "256" in long.json()["detail"]
    ok = http.post(f"/critical-tasks/{t.id}/sub-tasks", json={"title": "x" * 255})
    assert ok.status_code == 201
    renamed = http.put(f"/critical-tasks/{t.id}/sub-tasks/{ok.json()['id']}", json={"title": "y" * 300})
    assert renamed.status_code == 400 and "255 characters at most" in renamed.json()["detail"]
    assert http.put(f"/critical-tasks/{t.id}/sub-tasks/{ok.json()['id']}", json={"status": "Completed"}).status_code == 200
    assert db.query(m.CriticalTaskSubTask).count() == 1


def test_the_ais_failures_say_a_plain_sentence_not_the_exception(http, monkeypatch):
    def boom(**kw):
        raise RuntimeError("upstream exploded: key sk-secret-123 at https://internal.example/v1")

    monkeypatch.setattr(critical_tasks_router, "_get_openai_client", lambda: NS(chat=NS(completions=NS(create=boom))))
    monkeypatch.setattr(critical_tasks_router, "_get_openai_model", lambda: "test")
    t = add(http.db, "Open one", due_date=datetime.utcnow() + timedelta(days=2))
    http.me["u"] = ADMIN
    for url in ("/critical-tasks/ai/prioritize-tasks", "/critical-tasks/ai/predict-escalations", "/critical-tasks/ai/balance-workload", f"/critical-tasks/{t.id}/ai/analyze-root-cause"):
        r = http.post(url)
        assert r.status_code == 500, url
        assert r.json()["detail"] == "The AI could not finish this just now. Try again in a moment.", url
    r = http.post("/critical-tasks/ai/generate-description", json={"title": "x", "context": "y"})
    assert r.status_code in (500, 422) and "sk-secret" not in r.text and "exploded" not in r.text


def test_the_router_names_no_exception_in_a_response():
    src = open(critical_tasks_router.__file__, encoding="utf-8").read()
    assert "failed: {str(e)}" not in src


def test_the_task_list_still_answers_its_old_shape(http):
    add(http.db, "Plain")
    http.me["u"] = ADMIN
    got = http.get("/critical-tasks").json()
    assert set(got) == {"items", "total", "scope"} and "lean" not in got
    row = got["items"][0]
    for key in ("description", "evidence_notes", "custom_values", "approval_comment", "tenant_id", "linked_issue_id"):
        assert key in row, key


def test_the_rule_of_the_escalation_levels_is_the_one_the_list_always_used():
    from grc.services import task_lean

    now = datetime(2026, 11, 10, 12)
    cases = [(None, 0), (now - timedelta(days=8), 3), (now - timedelta(days=7, hours=23), 2), (now - timedelta(days=7), 2), (now - timedelta(hours=25), 2), (now - timedelta(hours=1), 1), (now + timedelta(days=1), 1),
             (now + timedelta(days=3), 1), (now + timedelta(days=4), 0)]
    for due, level in cases:
        assert task_lean.escalation_for("Open", due, now) == level, due
    assert task_lean.escalation_for("Completed", now - timedelta(days=30), now) == 0
    assert task_lean.sla_word("Open", now - timedelta(seconds=1), now) == "Breached"
    assert task_lean.sla_word("Open", now + timedelta(days=3, hours=23), now) == "At Risk"
    assert task_lean.sla_word("Open", now + timedelta(days=4), now) == "On Track"
