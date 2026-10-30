"""TPRM parity, piece B5a (2026-10-29): findings with an owner, a blocking flag, a source and a task; signals decided
and raised as findings; a missed service level raised as one.

1. A finding says who owns it (an active person of this platform, never an imported account), whether it holds the
   approval gate, where it came from (rows from before read it from what stands behind them) and its Task Management task.
2. Start remediation: a remediation due when the policy says for the severity, and a twin task, synced both ways with the
   remediation (status, owner, due date); a deleted task leaves the remediation, a deleted remediation takes its task.
3. Close (a note for a critical or blocking finding; else a completed remediation or a note), Reopen (a reason; an
   acceptance is revoked, a fix that did not hold is open again), on the new routes and on PUT alike.
4. The vendor-wide list (open first, worst first) and the cross-vendor register (scope, owner, blocking, source,
   accepted until, sort keys, `blocking_total`).
5. Signals: acknowledge / dismiss, "raise a finding with it"; a missed service level is a high finding, once per level.
In-memory SQLite.
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, CriticalTask, GRCUser, Permission, Role, RolePermission, Tenant, TPRAAuditLog, TPRAEngagement, TPRAFinding,
    TPRAMonitoringSignal, TPRARemediation, TPRARiskAcceptance, TPRASignalRejection, TPRASocReview, TPRATieringConfig,
    UserRole, Vendor, VendorAssessment, get_db,
)
from grc.modules.vendor_risk.routers import monitoring as sla_routes
from grc.modules.vendor_risk.tpra import api, attention, dashboard, engagements, findings, monitoring, paperwork, service
from grc.routers.auth_router import require_auth

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")

ADMIN, OWNER, ANA, IMPORTED, GONE, NOBODY, ASSESSOR = 1, 2, 3, 4, 5, 6, 7
NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Analyst"),
               Permission(id=1, name="vendor_risk:findings:edit", resource="vendor_risk", action="edit"),
               RolePermission(role_id=2, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=name, email=f"u{uid}@acme.test", is_active=active,
                       external_provider=provider)
               for uid, name, active, provider in ((ADMIN, "Ada Admin", True, None), (OWNER, "Olu Owner", True, None),
                                                   (ANA, "Ana Analyst", True, None), (IMPORTED, "Ian Imported", True, "okta"),
                                                   (GONE, "Gus Gone", False, None), (NOBODY, "Nia Nobody", True, None),
                                                   (ASSESSOR, "Ari Assessor", True, None))])
    s.add_all([UserRole(user_id=ADMIN, role_id=1, tenant_id=1), UserRole(user_id=OWNER, role_id=1, tenant_id=1),
               UserRole(user_id=ANA, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def web(db, uid=ADMIN):
    app = FastAPI()
    for r in (api.router, dashboard.router, sla_routes.router):
        app.include_router(r, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, uid)
    return TestClient(app)


@pytest.fixture()
def tasks_http(db, monkeypatch):
    monkeypatch.setattr(critical_tasks_router, "_send_notification_email", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, ADMIN)
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    return TestClient(app)


def _vendor(db, name="Acme Cloud", **kw):
    v = Vendor(**{"tenant_id": 1, "name": name, "tier": "medium", "status": "active", "owner_id": OWNER, **kw})
    db.add(v)
    db.commit()
    return v


def _assessment(db, v):
    a = service.ensure_active_assessment(db, v, actor_id=ADMIN)
    db.commit()
    return a


def _finding(db, a, severity="medium", status="open", **kw):
    f = TPRAFinding(**{"tenant_id": 1, "vendor_id": a.vendor_id, "assessment_id": a.id, "severity": severity,
                       "status": status, "title": f"{severity} {status}", "domain": "cybersecurity",
                       "created_by": ADMIN, **kw})
    db.add(f)
    db.commit()
    return f


T = "/vendor-risk/tpra"


# ── 1. the fields ────────────────────────────────────────────────────────────

def test_existing_databases_get_the_new_columns():
    from grc.modules.compliance.schema_migrations import _COLUMN_ADDS

    added = {(t, c) for t, c, _ddl, _ix in _COLUMN_ADDS}
    assert {("grc_tpra_findings", c) for c in ("owner_id", "is_blocking", "source", "task_id")} <= added


def test_a_row_from_before_reads_its_source_from_what_stands_behind_it():
    assert findings.source_of(TPRAFinding(question_key="mfa")) == "assessment"
    assert findings.source_of(TPRAFinding(source_response_id=3, is_critical_control_fail=True)) == "assessment"
    assert findings.source_of(TPRAFinding(severity="critical", is_critical_control_fail=True)) == "manual"
    assert findings.source_of(TPRAFinding(source="sla_breach")) == "sla_breach"
    assert findings.source_of(TPRAFinding(source="offboarding")) == "offboarding"      # B5b's exit may raise one
    assert findings.source_of(TPRAFinding(source="made-up", question_key="x")) == "assessment"
    got = api.s_finding(TPRAFinding(id=1, severity="medium", status="open"))
    assert (got["owner_id"], got["is_blocking"], got["source"], got["task_id"]) == (None, False, "manual", None)


def test_answers_raise_findings_and_a_failed_critical_control_blocks(db):
    v = _vendor(db)
    a = _assessment(db, v)
    base = {"domain": "cybersecurity", "label": "No", "answer": "No", "response_id": None, "template_version_id": None}
    service.raise_answer_findings(db, v, a, [
        {**base, "finding": "critical", "question_key": "mfa", "critical_control": True, "score": 0.0, "title": "MFA?"},
        {**base, "finding": "medium", "question_key": "logs", "critical_control": False, "score": 0.0, "title": "Logs?"},
    ], ADMIN)
    db.commit()
    got = {f.title: (f.source, f.is_blocking) for f in db.query(TPRAFinding)}
    assert got == {"MFA?": ("assessment", True), "Logs?": ("assessment", False)}


def test_a_document_review_raises_a_finding_that_says_so(db):
    v = _vendor(db)
    review = TPRASocReview(tenant_id=1, vendor_id=v.id, opinion="unqualified", exceptions_count=0, material_findings=True,
                           report_kind="soc2")
    db.add(review)
    db.commit()
    made = paperwork.sync_finding(db, v, review, ADMIN)
    assert (made.source, made.severity) == ("document_review", "high")


# ── raising by hand ──────────────────────────────────────────────────────────

def test_a_finding_raised_by_hand_has_an_owner_and_can_hold_the_gate(db):
    v = _vendor(db)
    c = web(db)
    made = c.post(f"{T}/vendors/{v.id}/findings", json={
        "title": "No MFA on their support console", "severity": "medium", "owner_id": ANA, "is_blocking": True})
    assert made.status_code == 201, made.text
    body = made.json()
    assert (body["status"], body["source"], body["is_blocking"], body["owner"]) == (
        "open", "manual", True, {"id": ANA, "name": "Ana Analyst"})
    row = db.get(TPRAFinding, body["id"])
    assert (row.owner_id, row.is_blocking, row.source, row.created_by) == (ANA, True, "manual", ADMIN)
    # the old route, on an assessment, takes the same fields
    a = service.get_active_assessment(db, v)
    old = c.post(f"{T}/assessments/{a.id}/findings", json={"title": "Old route", "severity": "low"}).json()
    assert (old["is_blocking"], old["source"], old["owner_id"]) == (False, "manual", None)


def test_an_owner_is_an_active_person_of_this_platform(db):
    v = _vendor(db)
    c = web(db)
    for who, why in ((IMPORTED, "access review imported"), (GONE, "active user"), (999, "active user")):
        refused = c.post(f"{T}/vendors/{v.id}/findings", json={"title": "x", "owner_id": who})
        assert refused.status_code == 400 and why in refused.json()["detail"], (who, refused.text)
    assert db.query(TPRAFinding).count() == 0
    made = c.post(f"{T}/vendors/{v.id}/findings", json={"title": "x"}).json()
    for who in (IMPORTED, GONE):
        assert c.put(f"{T}/findings/{made['id']}", json={"owner_id": who}).status_code == 400
    assert c.put(f"{T}/findings/{made['id']}", json={"owner_id": ANA}).json()["owner_id"] == ANA
    assert c.put(f"{T}/findings/{made['id']}", json={"owner_id": None}).json()["owner_id"] is None      # null clears it
    audit = [(r.action, r.from_value, r.to_value) for r in db.query(TPRAAuditLog).filter_by(entity="finding", action="assign")]
    assert audit == [("assign", None, str(ANA)), ("assign", str(ANA), None)]


def test_a_finding_can_be_raised_on_an_engagement_and_says_so(db):
    v = _vendor(db)
    c = web(db)
    payroll = engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll run", owner_id=ANA),
                                            db=db, user=db.get(GRCUser, ADMIN))
    on_payroll = c.post(f"{T}/vendors/{v.id}/findings", json={"title": "Payroll gap", "engagement_id": payroll["id"]}).json()
    general = c.post(f"{T}/vendors/{v.id}/findings", json={"title": "Whole supplier gap"}).json()
    assert on_payroll["engagement"] == {"id": payroll["id"], "name": "Payroll run"} and general["engagement"] is None
    assert db.get(VendorAssessment, on_payroll["assessment_id"]).engagement_id == payroll["id"]
    assert db.get(VendorAssessment, general["assessment_id"]).engagement_id is None
    listed = c.get(f"{T}/vendors/{v.id}/findings").json()
    assert sorted(i["title"] for i in listed["items"]) == ["Payroll gap", "Whole supplier gap"]
    only = c.get(f"{T}/vendors/{v.id}/findings", params={"engagement_id": payroll["id"]}).json()
    assert [i["title"] for i in only["items"]] == ["Payroll gap"]
    general_row = service.general_row(db, v)                              # General's own id asks for General
    assert [i["title"] for i in c.get(f"{T}/vendors/{v.id}/findings", params={"engagement_id": general_row.id}).json()["items"]] \
        == ["Whole supplier gap"]
    ended = engagements.create_engagement(v.id, engagements.EngagementIn(name="Old"), db=db, user=db.get(GRCUser, ADMIN))
    db.get(TPRAEngagement, ended["id"]).status = "ended"
    db.commit()
    assert c.post(f"{T}/vendors/{v.id}/findings", json={"title": "x", "engagement_id": ended["id"]}).status_code == 400
    assert c.post(f"{T}/vendors/{v.id}/findings", json={"title": "x", "engagement_id": 9999}).status_code == 404


def test_raising_needs_the_right_and_a_stranger_cannot_start_or_close(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a)
    nobody = web(db, NOBODY)
    assert nobody.post(f"{T}/vendors/{v.id}/findings", json={"title": "x"}).status_code == 403
    assert nobody.post(f"{T}/findings/{f.id}/start-remediation", json={}).status_code == 403
    assert nobody.post(f"{T}/findings/{f.id}/close", json={"note": "fixed"}).status_code == 403
    assert nobody.post(f"{T}/findings/{f.id}/reopen", json={"reason": "no"}).status_code == 403
    analyst = web(db, ANA)                                              # vendor_risk:findings:edit
    assert analyst.post(f"{T}/findings/{f.id}/close", json={"note": "fixed"}).status_code == 200
    assert nobody.get(f"{T}/vendors/{v.id}/findings").status_code == 200       # reads are open to the signed in


# ── the vendor-wide list ─────────────────────────────────────────────────────

def test_the_vendor_list_puts_the_open_and_the_worst_first_and_counts_what_blocks(db):
    v = _vendor(db)
    a = _assessment(db, v)
    closed = _finding(db, a, "critical", "closed")
    medium = _finding(db, a, "medium", "open")
    high = _finding(db, a, "high", "in_remediation", is_blocking=True)
    critical = _finding(db, a, "critical", "open")
    accepted = _finding(db, a, "high", "accepted")
    removed = _finding(db, a, "critical", "open", deleted_at=NOW, is_blocking=True)
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=accepted.id, rationale="Compensating control", accepted_by=ADMIN,
                              accepted_at=NOW, expiry=datetime(2030, 3, 5), status="active"))
    db.commit()
    c = web(db)
    got = c.get(f"{T}/vendors/{v.id}/findings").json()
    assert [i["id"] for i in got["items"]] == [critical.id, high.id, medium.id, accepted.id, closed.id]
    assert (got["total"], got["blocking_total"]) == (5, 1)
    row = {i["id"]: i for i in got["items"]}[accepted.id]
    assert (row["accepted_until"], row["acceptance"]["rationale"], row["acceptance"]["by"]) == (
        "2030-03-05", "Compensating control", "Ada Admin")
    by_id = {i["id"]: i for i in got["items"]}
    assert (row["treatment"], by_id[critical.id]["treatment"], by_id[critical.id]["fix_done"]) == ("accept", "remediate", False)
    db.add(TPRARemediation(tenant_id=1, finding_id=medium.id, title="Patch", treatment_type="mitigate", status="completed"))
    db.commit()
    patched = {i["id"]: i for i in c.get(f"{T}/vendors/{v.id}/findings").json()["items"]}[medium.id]
    assert (patched["treatment"], patched["fix_done"], patched["remediation_count"]) == ("mitigate", True, 1)
    assert {i["id"] for i in c.get(f"{T}/vendors/{v.id}/findings", params={"scope": "open"}).json()["items"]} \
        == {critical.id, high.id, medium.id}
    assert [i["id"] for i in c.get(f"{T}/vendors/{v.id}/findings", params={"scope": "closed"}).json()["items"]] == [closed.id]
    again = c.get(f"{T}/vendors/{v.id}/findings", params={"scope": "open", "include_deleted": True}).json()
    assert removed.id in {i["id"] for i in again["items"]} and again["blocking_total"] == 1      # a removed one blocks nothing
    assert c.get(f"{T}/vendors/{v.id}/findings", params={"scope": "weird"}).status_code == 422
    # the lifecycle's own list carries the same fields
    own = c.get(f"{T}/assessments/{a.id}/findings").json()["items"][0]
    assert {"owner", "is_blocking", "source", "task", "sla_due", "due_date", "accepted_until"} <= set(own)


def test_a_findings_fix_is_due_when_the_policy_says_for_its_severity(db):
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True, remediation_days={"high": 10}))
    db.commit()
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "high")
    got = web(db).get(f"{T}/vendors/{v.id}/findings").json()["items"][0]
    assert datetime.fromisoformat(got["sla_due"]) == f.created_at + timedelta(days=10) and got["due_date"] is None

    # work under way keeps the window it was tiered under, in the list and when the fix is started
    a.policy_snapshot = {"remediation_days": {"high": 3}}
    db.commit()
    kept = web(db).get(f"{T}/vendors/{v.id}/findings").json()["items"][0]
    assert datetime.fromisoformat(kept["sla_due"]) == f.created_at + timedelta(days=3)
    web(db).post(f"{T}/findings/{f.id}/start-remediation", json={})
    assert abs((db.query(TPRARemediation).one().due_date - (datetime.utcnow() + timedelta(days=3))).total_seconds()) < 60


# ── 2. start remediation, and its twin ───────────────────────────────────────

def test_start_remediation_opens_a_remediation_and_a_task(db):
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True, remediation_days={"high": 10}))
    db.commit()
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "high", title="No MFA on the console")
    c = web(db)
    started = c.post(f"{T}/findings/{f.id}/start-remediation", json={"owner_id": ANA})
    assert started.status_code == 201, started.text
    body = started.json()
    assert (body["status"], body["owner"]["name"], body["remediation_count"]) == ("in_remediation", "Ana Analyst", 1)
    db.expire_all()
    rem = db.query(TPRARemediation).one()
    assert (rem.finding_id, rem.owner_id, rem.status, rem.treatment_type) == (f.id, ANA, "open", "remediate")
    assert abs((rem.due_date - (datetime.utcnow() + timedelta(days=10))).total_seconds()) < 60
    task = db.get(CriticalTask, db.get(TPRAFinding, f.id).task_id)
    assert body["task_id"] == task.id and body["task"] == {"id": task.id, "status": "Open"}
    assert (task.source_module, task.source_entity_type, task.source_entity_id, task.category) == (
        "vendor_risk", "TPRARemediation", rem.id, "Remediation")
    assert (task.title, task.assigned_user_ids, task.due_date, task.priority) == (
        "Acme Cloud: No MFA on the console", [ANA], rem.due_date, "High")
    assert body["due_date"] == rem.due_date.isoformat()
    done = {(r.entity, r.action) for r in db.query(TPRAAuditLog)}
    assert {("remediation", "create"), ("finding", "assign"), ("finding", "start_remediation")} <= done

    # once; and only an open finding can be fixed
    assert c.post(f"{T}/findings/{f.id}/start-remediation", json={}).status_code == 409
    other = _finding(db, a, "low", "closed")
    assert c.post(f"{T}/findings/{other.id}/start-remediation", json={}).status_code == 409
    assert c.post(f"{T}/findings/{_finding(db, a).id}/start-remediation", json={"owner_id": IMPORTED}).status_code == 400
    # an owner already on the finding is the remediation's, a due date given is kept
    mine = _finding(db, a, "medium", owner_id=OWNER)
    soon = (datetime.utcnow() + timedelta(days=2)).replace(microsecond=0)
    c.post(f"{T}/findings/{mine.id}/start-remediation", json={"due_date": soon.isoformat()})
    rem2 = db.query(TPRARemediation).filter_by(finding_id=mine.id).one()
    assert (rem2.owner_id, rem2.due_date) == (OWNER, soon)


def _started(db, severity="high", owner=ANA, name="Acme Cloud"):
    v = _vendor(db, name)
    a = _assessment(db, v)
    f = _finding(db, a, severity, title="No MFA on the console")
    body = web(db).post(f"{T}/findings/{f.id}/start-remediation", json={"owner_id": owner}).json()
    db.expire_all()
    return v, a, db.get(TPRAFinding, f.id), db.query(TPRARemediation).filter_by(finding_id=f.id).one(), \
        db.get(CriticalTask, body["task_id"])


def test_the_task_and_the_remediation_follow_each_other(db, tasks_http):
    v, a, f, rem, task = _started(db)
    # Task Management → the remediation, and the finding's owner
    for step, want in (("In Progress", "in_progress"), ("Under Review", "in_progress"), ("Completed", "completed")):
        assert tasks_http.post(f"/critical-tasks/{task.id}/transition", json={"new_status": step}).status_code == 200
        db.expire_all()
        assert db.get(TPRARemediation, rem.id).status == want
    done = db.get(TPRARemediation, rem.id)
    assert done.completed_at is not None and db.get(TPRAFinding, f.id).status == "in_remediation"    # closing is explicit
    assert tasks_http.put(f"/critical-tasks/{task.id}", json={"assigned_user_ids": [OWNER],
                                                             "due_date": "2031-03-01T00:00:00"}).status_code == 200
    db.expire_all()
    rem, f = db.get(TPRARemediation, rem.id), db.get(TPRAFinding, f.id)
    assert (rem.owner_id, rem.due_date, f.owner_id) == (OWNER, datetime(2031, 3, 1), OWNER)
    assert db.query(TPRAAuditLog).filter(TPRAAuditLog.reason == "Changed in Task Management").count() >= 2

    # the remediation → its task
    c = web(db)
    assert c.put(f"{T}/remediations/{rem.id}", json={"status": "open"}).status_code == 200
    db.expire_all()
    assert db.get(CriticalTask, task.id).status == "Open" and db.get(CriticalTask, task.id).completed_at is None
    assert c.put(f"{T}/remediations/{rem.id}", json={"status": "completed"}).status_code == 200
    db.expire_all()
    assert db.get(CriticalTask, task.id).status == "Completed"
    assert c.put(f"{T}/remediations/{rem.id}", json={"owner_id": ANA, "due_date": "2032-01-05T00:00:00"}).status_code == 200
    db.expire_all()
    assert (db.get(CriticalTask, task.id).assigned_user_ids, db.get(CriticalTask, task.id).due_date) == (
        [ANA], datetime(2032, 1, 5))
    assert db.get(TPRARemediation, rem.id).status == "completed"          # a PUT naming the owner leaves the status alone
    assert db.get(TPRAFinding, f.id).owner_id == ANA                      # and the fix's owner is the finding's

    # the finding's owner → the fix in flight, and its task
    other = web(db).put(f"{T}/findings/{f.id}", json={"owner_id": OWNER}).json()
    assert other["owner_id"] == OWNER
    db.expire_all()
    assert db.get(TPRARemediation, rem.id).status == "completed"          # a finished fix keeps its owner
    c.put(f"{T}/remediations/{rem.id}", json={"status": "in_progress"})
    c.put(f"{T}/findings/{f.id}", json={"owner_id": ANA})
    db.expire_all()
    assert db.get(TPRARemediation, rem.id).owner_id == ANA and db.get(CriticalTask, task.id).assigned_user_ids == [ANA]


def test_a_deleted_task_leaves_the_remediation_and_a_deleted_remediation_takes_its_task(db, tasks_http):
    v, a, f, rem, task = _started(db)
    assert tasks_http.delete(f"/critical-tasks/{task.id}").status_code == 204
    db.expire_all()
    f = db.get(TPRAFinding, f.id)
    assert f.task_id is None and f.status == "in_remediation"
    assert db.get(TPRARemediation, rem.id).deleted_at is None and db.get(CriticalTask, task.id) is None
    got = web(db).get(f"{T}/vendors/{v.id}/findings").json()["items"][0]
    assert got["task"] is None and got["task_id"] is None

    v2, a2, f2, rem2, task2 = _started(db, name="Payroll Co")
    assert web(db).delete(f"{T}/remediations/{rem2.id}").status_code == 200
    db.expire_all()
    assert db.get(CriticalTask, task2.id) is None and db.get(TPRAFinding, f2.id).task_id is None


def test_a_remediation_added_by_hand_has_no_task(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a)
    c = web(db)
    made = c.post(f"{T}/findings/{f.id}/remediations", json={"title": "Roll out MFA"}).json()
    assert c.put(f"{T}/remediations/{made['id']}", json={"status": "completed"}).status_code == 200
    assert db.query(CriticalTask).count() == 0 and db.get(TPRAFinding, f.id).task_id is None


# ── 3. close and reopen ──────────────────────────────────────────────────────

def test_a_critical_or_blocking_finding_is_closed_with_a_note(db):
    v = _vendor(db)
    a = _assessment(db, v)
    critical = _finding(db, a, "critical")
    blocking = _finding(db, a, "medium", is_blocking=True)
    control = _finding(db, a, "medium", is_critical_control_fail=True)
    c = web(db)
    for f in (critical, blocking, control):
        refused = c.post(f"{T}/findings/{f.id}/close", json={})
        assert refused.status_code == 400 and "note" in refused.json()["detail"], f.id
        assert c.post(f"{T}/findings/{f.id}/close", json={"note": "   "}).status_code == 400
        assert c.put(f"{T}/findings/{f.id}", json={"status": "closed"}).status_code == 400      # PUT holds to it too
    done = c.post(f"{T}/findings/{critical.id}/close", json={"note": "MFA enabled, screenshot received"})
    assert done.status_code == 200 and done.json()["status"] == "closed"
    assert c.put(f"{T}/findings/{blocking.id}", json={"status": "closed", "note": "Fixed in the 4.2 release"}).json()["status"] == "closed"
    closed = db.query(TPRAAuditLog).filter_by(entity="finding", action="close", entity_id=critical.id).one()
    assert (closed.from_value, closed.to_value, closed.reason) == ("open", "closed", "MFA enabled, screenshot received")
    assert c.post(f"{T}/findings/{critical.id}/close", json={"note": "again"}).status_code == 400      # already closed


def test_any_other_finding_is_closed_by_a_fix_or_a_note(db):
    v = _vendor(db)
    a = _assessment(db, v)
    c = web(db)
    bare, fixed, noted = (_finding(db, a, "medium") for _ in range(3))
    refused = c.post(f"{T}/findings/{bare.id}/close", json={})
    assert refused.status_code == 400 and "remediation is completed" in refused.json()["detail"]
    db.add(TPRARemediation(tenant_id=1, finding_id=fixed.id, title="Rolled out", status="completed"))
    db.commit()
    assert c.post(f"{T}/findings/{fixed.id}/close", json={}).status_code == 200
    assert c.post(f"{T}/findings/{noted.id}/close", json={"note": "Not applicable to this service"}).status_code == 200


def test_closing_an_accepted_finding_ends_its_acceptance(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "medium")
    c = web(db, OWNER)
    c.post(f"{T}/findings/{f.id}/acceptances", json={"rationale": "Compensating control", "expiry": "2031-01-01"})
    assert db.get(TPRAFinding, f.id).status == "accepted"
    assert c.post(f"{T}/findings/{f.id}/close", json={"note": "Fixed after all"}).status_code == 200
    db.expire_all()
    acc = db.query(TPRARiskAcceptance).one()
    assert (acc.status, acc.deleted_at is not None) == ("revoked", True)
    assert service.acceptance_holds(db, db.get(TPRAFinding, f.id)) is False


def test_reopening_says_why_and_the_finding_counts_again(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "critical")
    db.add(TPRARemediation(tenant_id=1, finding_id=f.id, title="Rolled out MFA", status="completed",
                           completed_at=NOW))
    db.commit()
    c = web(db)
    assert service.count_open_critical(db, a.id) == 0                      # a completed fix mitigates it
    assert c.post(f"{T}/findings/{f.id}/reopen", json={"reason": "x"}).status_code == 400      # still open
    assert c.post(f"{T}/findings/{f.id}/close", json={"note": "MFA enabled"}).status_code == 200
    assert c.post(f"{T}/findings/{f.id}/reopen", json={"reason": "  "}).status_code == 400
    back = c.post(f"{T}/findings/{f.id}/reopen", json={"reason": "The fix was rolled back in the last release"})
    assert back.status_code == 200 and back.json()["status"] == "open"
    db.expire_all()
    assert db.query(TPRARemediation).one().status == "open"                # the fix that did not hold is open again
    assert service.count_open_critical(db, a.id) == 1                      # and the critical counts at the gate again
    row = db.query(TPRAAuditLog).filter_by(entity="finding", action="reopen").one()
    assert (row.from_value, row.to_value, row.reason) == ("closed", "open", "The fix was rolled back in the last release")


def test_reopening_a_finding_with_a_task_puts_it_back_in_remediation_and_the_task_open(db, tasks_http):
    v, a, f, rem, task = _started(db, "critical")
    for step in ("In Progress", "Under Review", "Completed"):
        tasks_http.post(f"/critical-tasks/{task.id}/transition", json={"new_status": step})
    c = web(db)
    assert c.post(f"{T}/findings/{f.id}/close", json={"note": "Done and verified"}).status_code == 200
    db.expire_all()
    assert db.get(TPRAFinding, f.id).status == "closed" and db.get(CriticalTask, task.id).status == "Completed"
    assert c.put(f"{T}/findings/{f.id}", json={"owner_id": OWNER}).json()["owner_id"] == OWNER       # handed on while closed
    back = c.post(f"{T}/findings/{f.id}/reopen", json={"reason": "It came back"}).json()
    assert (back["status"], back["task"]) == ("in_remediation", {"id": task.id, "status": "Open"})
    db.expire_all()
    assert db.get(TPRARemediation, rem.id).status == "open" and db.get(CriticalTask, task.id).completed_at is None
    # the fix under way is the new owner's, and the finding keeps the owner it was given
    assert (db.get(TPRAFinding, f.id).owner_id, db.get(TPRARemediation, rem.id).owner_id,
            db.get(CriticalTask, task.id).assigned_user_ids) == (OWNER, OWNER, [OWNER])


def test_reopening_an_accepted_finding_revokes_the_acceptance(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "medium")
    c = web(db, OWNER)
    c.post(f"{T}/findings/{f.id}/acceptances", json={"rationale": "Compensating control", "expiry": "2031-01-01"})
    assert service.acceptance_holds(db, db.get(TPRAFinding, f.id)) is True
    back = c.post(f"{T}/findings/{f.id}/reopen", json={"reason": "The control was withdrawn"}).json()
    assert back["status"] == "open" and back["accepted_until"] is None and back["acceptance"] is None
    db.expire_all()
    assert service.acceptance_holds(db, db.get(TPRAFinding, f.id)) is False
    assert db.query(TPRARiskAcceptance).one().status == "revoked"


def test_the_legacy_status_route_holds_to_the_same_rules(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "high", status="closed")
    c = web(db)
    refused = c.put(f"{T}/findings/{f.id}", json={"status": "in_remediation"})
    assert refused.status_code == 400 and "why" in refused.json()["detail"]
    back = c.put(f"{T}/findings/{f.id}", json={"status": "in_remediation", "reason": "Regressed"})
    assert back.json()["status"] == "in_remediation"
    assert c.put(f"{T}/findings/{f.id}", json={"status": "open"}).json()["status"] == "open"        # open <-> in remediation is free
    assert c.put(f"{T}/findings/{f.id}", json={"status": "accepted"}).status_code == 400
    assert c.put(f"{T}/findings/{f.id}", json={"is_blocking": True}).json()["is_blocking"] is True


def test_the_expiry_sweep_and_a_revoked_acceptance_put_a_finding_with_a_task_back_in_remediation(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "medium", status="accepted", task_id=77)
    service.reopen_finding(db, f, None, "Acceptance expired")
    assert f.status == "in_remediation"
    g = _finding(db, a, "medium", status="accepted")
    service.reopen_finding(db, g, None, "Acceptance expired")
    assert g.status == "open"


# ── 4. the register ──────────────────────────────────────────────────────────

def _register(db):
    core = _vendor(db, "Core Bank")
    pay = _vendor(db, "Payroll Co")
    a1, a2 = _assessment(db, core), _assessment(db, pay)
    items = {
        "crit_open": _finding(db, a1, "critical", "open", owner_id=ANA, is_blocking=True, source="manual"),
        "high_rem": _finding(db, a2, "high", "in_remediation", owner_id=OWNER),
        "med_open": _finding(db, a2, "medium", "open"),
        "low_acc": _finding(db, a1, "low", "accepted"),
        "high_closed": _finding(db, a1, "high", "closed", question_key="mfa"),
    }
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=items["low_acc"].id, rationale="Fine", accepted_by=ADMIN,
                              accepted_at=NOW, expiry=datetime(2031, 6, 30), status="active"))
    db.add(TPRARemediation(tenant_id=1, finding_id=items["high_rem"].id, title="Fix", due_date=NOW + timedelta(days=5),
                           status="open"))
    db.add(TPRARemediation(tenant_id=1, finding_id=items["crit_open"].id, title="Fix", due_date=NOW + timedelta(days=2),
                           status="open"))
    items["high_rem"].task_id = 4
    db.commit()
    return items


def test_the_register_has_a_scope_and_says_who_owns_what_holds_the_gate_and_where_it_came_from(db):
    f = _register(db)
    c = web(db)
    got = c.get(f"{T}/findings-register").json()
    assert got["total"] == 5 and got["blocking_total"] == 1
    for scope, want in (("open", {"crit_open", "high_rem", "med_open"}), ("accepted", {"low_acc"}),
                        ("closed", {"high_closed"}), ("all", set(f))):
        found = c.get(f"{T}/findings-register", params={"scope": scope}).json()
        assert {i["id"] for i in found["items"]} == {f[k].id for k in want}, scope
    assert c.get(f"{T}/findings-register", params={"scope": "nope"}).status_code == 422
    # the old status filter works, and the blocking line does not depend on the scope
    closed = c.get(f"{T}/findings-register", params={"status": "closed"}).json()
    assert closed["total"] == 1 and closed["blocking_total"] == 1
    rows = {i["id"]: i for i in got["items"]}
    top = rows[f["crit_open"].id]
    assert (top["owner"], top["is_blocking"], top["source"], top["task_id"], top["vendor_name"]) == (
        {"id": ANA, "name": "Ana Analyst"}, True, "manual", None, "Core Bank")
    assert rows[f["low_acc"].id]["accepted_until"] == "2031-06-30" and top["accepted_until"] is None
    assert rows[f["high_closed"].id]["source"] == "assessment" and rows[f["high_rem"].id]["task_id"] == 4
    assert rows[f["med_open"].id]["owner"] is None and top["sla_due"] and top["engagement"] is None
    # what it always had
    assert {"due_date", "overdue", "created_at", "vendor_id", "domain", "is_critical_control_fail"} <= set(top)
    only = c.get(f"{T}/findings-register", params={"vendor_id": f["high_rem"].vendor_id}).json()
    assert only["total"] == 2 and only["blocking_total"] == 0


def test_the_register_sorts_by_seriousness_vendor_owner_and_due_date_with_none_last(db):
    f = _register(db)
    c = web(db)

    def ids(**params):
        return [i["id"] for i in c.get(f"{T}/findings-register", params=params).json()["items"]]

    def named(*keys):
        return [f[k].id for k in keys]

    # a tie ends with the newest first
    assert ids(sort="severity", order="desc") == named("crit_open", "high_closed", "high_rem", "med_open", "low_acc")
    assert ids(sort="severity", order="asc") == named("low_acc", "med_open", "high_closed", "high_rem", "crit_open")
    assert ids(sort="vendor", order="asc") == named("high_closed", "low_acc", "crit_open", "med_open", "high_rem")
    assert ids(sort="owner", order="asc") == named("crit_open", "high_rem", "high_closed", "low_acc", "med_open")
    assert ids(sort="owner", order="desc") == named("high_rem", "crit_open", "high_closed", "low_acc", "med_open")   # nobody last
    assert ids(sort="due", order="asc") == named("crit_open", "high_rem", "high_closed", "low_acc", "med_open")     # 2 days, 5 days
    assert ids(sort="due", order="desc") == named("high_rem", "crit_open", "high_closed", "low_acc", "med_open")    # none still last
    assert ids(sort="whatever") == ids(sort="created_at", order="desc") == named(
        "high_closed", "low_acc", "med_open", "high_rem", "crit_open")                                              # unknown: as before


def test_the_register_orders_in_the_database_even_for_ties(db):
    _register(db)
    seen = []

    @event.listens_for(db.get_bind(), "before_cursor_execute")
    def grab(conn, cursor, statement, *a):
        seen.append(statement)

    sorts = ("created_at", "severity", "vendor", "owner", "due")
    for sort in sorts:
        web(db).get(f"{T}/findings-register", params={"sort": sort})
    page = [s for s in seen if "FROM grc_tpra_findings" in s and "LIMIT" in s]
    assert len(page) == 5 and all("ORDER BY" in s and "grc_tpra_findings.id DESC" in s for s in page)
    nulls = {sort: "NULLS LAST" in s for sort, s in zip(sorts, page)}
    assert nulls == {"created_at": False, "severity": False, "vendor": False, "owner": True, "due": True}   # only where there can be none
    assert "CASE WHEN" in page[1] and "grc_tpra_findings.severity = " in page[1]                              # severity goes by rank


# ── 5. signals ───────────────────────────────────────────────────────────────

def _queue(db):
    return {i["condition"] for i in attention.open_items(db, 1, NOW.date(), {}) if i["record_type"] == "signal"}


def test_a_signal_recorded_with_a_finding_raises_it_at_its_severity_on_the_supplier(db):
    v = _vendor(db)
    c = web(db)
    made = c.post(f"{T}/vendors/{v.id}/signals", json={
        "signal_type": "financial", "severity": "high", "title": "Auditor resigned", "raise_finding": True})
    assert made.status_code == 201, made.text
    body = made.json()
    f = db.get(TPRAFinding, body["finding_id"])
    assert (f.source, f.severity, f.title, f.status, f.domain, f.vendor_id) == (
        "signal", "high", "Auditor resigned", "open", "financial", v.id)
    assert db.get(TPRAMonitoringSignal, body["signal"]["id"]).finding_id == f.id
    assert db.get(VendorAssessment, f.assessment_id).engagement_id is None            # on the supplier, not an engagement
    plain = c.post(f"{T}/vendors/{v.id}/signals", json={"signal_type": "financial", "severity": "low", "title": "Rumour"}).json()
    assert plain["finding_id"] is None and db.query(TPRAFinding).count() == 1


def test_raising_a_finding_with_a_signal_needs_the_right_to_raise_one(db):
    v = _vendor(db)
    db.add(Permission(id=2, name="vendor_risk:monitoring:create", resource="vendor_risk", action="create"))
    db.add(RolePermission(role_id=2, permission_id=2))
    db.commit()
    c = web(db, ANA)                                                                   # monitoring:create, not findings:create
    refused = c.post(f"{T}/vendors/{v.id}/signals", json={"signal_type": "breach", "title": "x", "raise_finding": True})
    assert refused.status_code == 403 and db.query(TPRAMonitoringSignal).count() == 0
    assert c.post(f"{T}/vendors/{v.id}/signals", json={"signal_type": "breach", "title": "x", "severity": "low"}).status_code == 201


def test_a_signal_is_acknowledged_or_dismissed_with_no_questions(db):
    v = _vendor(db)
    c = web(db)
    ids = [c.post(f"{T}/vendors/{v.id}/signals", json={"signal_type": "financial", "severity": "low", "title": t}).json()["signal"]["id"]
           for t in ("one", "two", "three")]
    assert {c.get(f"{T}/vendors/{v.id}/signals").json()["items"][i]["status"] for i in range(3)} == {"new"}
    assert _queue(db) == {"signal_new"}
    ack = c.put(f"{T}/signals/{ids[0]}", json={"acknowledged": True}).json()
    assert (ack["status"], ack["acknowledged_by"]) == ("acknowledged", ADMIN)
    gone = c.post(f"{T}/signals/{ids[1]}/dismiss")
    assert gone.status_code == 200 and gone.json()["status"] == "dismissed" and gone.json()["acknowledged"] is True
    again = c.post(f"{T}/signals/{ids[1]}/dismiss").json()
    assert again["row_version"] == gone.json()["row_version"]                          # nothing to do twice
    assert c.post(f"{T}/signals/{ids[2]}/dismiss").status_code == 200
    assert _queue(db) == set()                                                         # none waiting on a decision
    assert [(r.action, r.actor_id) for r in db.query(TPRAAuditLog).filter_by(entity="signal", action="dismiss")] == [
        ("dismiss", ADMIN), ("dismiss", ADMIN)]
    assert web(db, NOBODY).post(f"{T}/signals/{ids[0]}/dismiss").status_code == 403
    assert c.post(f"{T}/signals/9999/dismiss").status_code == 404


def test_dismissing_a_fetched_alert_remembers_its_articles(db):
    v = _vendor(db)
    sig, _, _ = monitoring.record_signal(db, v, signal_type="adverse_media", severity="medium", title="News",
                                         source="GDELT", external_id="g1",
                                         sources=[{"url": "https://news.example/a", "title": "A"}])
    db.commit()
    got = web(db).post(f"{T}/signals/{sig.id}/dismiss").json()
    assert got["status"] == "dismissed" and got["triage_status"] == "not_relevant"
    assert db.query(TPRASignalRejection).filter_by(vendor_id=v.id).count() == 1


# ── a missed service level ───────────────────────────────────────────────────

def _miss(c, v, metric="Uptime", actual=99.2):
    return c.post(f"/vendor-risk/vendors/{v.id}/sla", json={
        "sla_metric": metric, "target_value": 99.9, "actual_value": actual, "unit": "%", "direction": "higher_is_better"})


def test_a_missed_service_level_is_a_high_finding_once_per_level(db):
    v = _vendor(db)
    c = web(db)
    first = _miss(c, v)
    assert first.status_code == 201, first.text
    f = db.get(TPRAFinding, first.json()["finding_id"])
    assert (f.severity, f.source, f.status, f.domain, f.title) == ("high", "sla_breach", "open", "operational",
                                                                   "Service level missed: Uptime")
    assert f.description.startswith("Measured 99.2% against a target of 99.9% (higher is better)")
    assert db.get(VendorAssessment, f.assessment_id).engagement_id is None
    assert first.json()["signal_id"] is not None                                       # the signal it always raised

    # the next month's miss, while that one stands: a signal, no second finding
    second = _miss(c, v, actual=98.0).json()
    assert second["signal_id"] is not None and second["finding_id"] is None and db.query(TPRAFinding).count() == 1
    # an edit to a record already missed raises nothing
    assert c.put(f"/vendor-risk/vendors/{v.id}/sla/{first.json()['id']}", json={"notes": "Outage on the 3rd"}).json()["finding_id"] is None
    # another level has its own
    assert _miss(c, v, "Response time").json()["finding_id"] is not None and db.query(TPRAFinding).count() == 2
    # one that was met raises none
    met = c.post(f"/vendor-risk/vendors/{v.id}/sla", json={
        "sla_metric": "Backups", "target_value": 99.0, "actual_value": 99.5, "direction": "higher_is_better"}).json()
    assert met["finding_id"] is None and db.query(TPRAFinding).count() == 2

    # closed, the level can be missed afresh
    assert c.post(f"{T}/findings/{f.id}/close", json={"note": "Root cause fixed"}).status_code == 200
    assert _miss(c, v, actual=97.0).json()["finding_id"] not in (None, f.id) and db.query(TPRAFinding).count() == 3


def test_a_level_missed_while_its_finding_is_accepted_raises_nothing(db):
    v = _vendor(db)
    c = web(db, OWNER)
    f = db.get(TPRAFinding, _miss(c, v).json()["finding_id"])
    c.post(f"{T}/findings/{f.id}/acceptances", json={"rationale": "Known, being replaced", "expiry": "2031-01-01"})
    assert _miss(c, v, actual=90.0).json()["finding_id"] is None and db.query(TPRAFinding).count() == 1


def test_reopening_a_critical_on_an_onboarded_supplier_suspends_it_without_autoflush(db, monkeypatch):
    """Tenant sessions do not autoflush: the reopened fix has to be in the database before the gate asks about it."""
    monkeypatch.setattr(service, "_past_approval", lambda *a, **k: True)
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "critical", status="closed")
    db.add(TPRARemediation(tenant_id=1, finding_id=f.id, title="MFA rolled out", status="completed", completed_at=NOW))
    db.commit()
    db.autoflush = False
    findings.reopen(db, f, ADMIN, "The fix was rolled back")
    findings.after_status_change(db, f, "closed", ADMIN)
    assert db.get(Vendor, v.id).status == "suspended"


def test_lowering_a_finding_that_holds_the_gate_leaves_a_record_of_from_what_to_what(db):
    v = _vendor(db)
    a = _assessment(db, v)
    f = _finding(db, a, "critical", is_blocking=True)
    assert web(db).put(f"{T}/findings/{f.id}", json={"severity": "low", "is_blocking": False}).status_code == 200
    row = db.query(TPRAAuditLog).filter_by(entity="finding", action="update", entity_id=f.id).one()
    assert (row.from_value, row.to_value) == ("critical, blocking", "low")
