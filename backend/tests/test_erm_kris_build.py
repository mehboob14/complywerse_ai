"""KRIs (wave 2-F): owner, provider, due date, maker-checker on manual values, escalation on by default. In-memory SQLite.

Define → Approve: a new KRI is a draft until someone other than its creator approves the indicator and its thresholds.
Submit → Check: a KRI value waits for a second person; only then is it published, the next due date moves on, and the
value is escalated: amber tells the owners, red also raises one issue linked to the risk (kri_red_breach counts as on
when the tenant never set it). KPIs still publish at once. Values due are listed and providers reminded.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Issue, IssueAutomationFlags, IssueRiskLink, Risk, RiskKRI, RiskKRIMeasurement,
                        Role, Tenant, UserRole, WorkflowNotification, get_db)
from grc.modules.erm.routers import kris, kris_workflow
from grc.modules.issue_management.routers import automation_flags
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, PROVIDER, OWNER, RISK_OWNER = 7, 8, 9, 10, 11


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((MAKER, "maker"), (CHECKER, "checker"), (PROVIDER, "provider"), (OWNER, "owner"),
                                 (RISK_OWNER, "riskowner"))])
    s.add_all([UserRole(user_id=MAKER, role_id=1, tenant_id=1), UserRole(user_id=CHECKER, role_id=1, tenant_id=1)])
    s.add(Risk(id=1, tenant_id=1, title="Patch backlog", category="technology", owner_id=RISK_OWNER))
    s.commit()
    yield s
    s.close()


def client(db, username):
    app = FastAPI()
    app.include_router(kris.router)
    app.include_router(kris_workflow.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def active_kri(db, **fields):
    row = RiskKRI(tenant_id=1, name=fields.pop("name", "Overdue patches"), green_threshold=1, amber_threshold=3,
                  threshold_direction="lower_is_better", frequency="monthly", is_active=True, status="active",
                  kind="kri", **fields)
    db.add(row)
    db.commit()
    return row


def submit_and_approve(db, kri_id, value):
    sent = client(db, "maker").post(f"/kris/{kri_id}/measure", json={"value": value})
    assert sent.status_code == 200, sent.text
    ok = client(db, "checker").post(f"/kri-workflow/measurements/{sent.json()['id']}/approve")
    assert ok.status_code == 200, ok.text
    return ok.json()


HANDOFFS = ("KRI value to check", "KRI value approved", "KRI value sent back")   # wave 5: maker / checker notices


def notified(db):
    """Who heard of an escalation or a reminder (the check handoffs are pinned in test_erm_integrity_monitor.py)."""
    return sorted(n.user_id for n in db.query(WorkflowNotification).all() if not n.subject.startswith(HANDOFFS))


# ── Define → Approve ─────────────────────────────────────────────────────────

def test_a_new_kri_is_a_draft_until_someone_other_than_its_creator_approves_it(db):
    maker, checker = client(db, "maker"), client(db, "checker")
    made = maker.post("/kris", json={"name": "Failed logins", "frequency": "monthly", "owner_id": OWNER,
                                     "data_provider_id": PROVIDER, "reviewer_id": CHECKER,
                                     "green_threshold": 5, "amber_threshold": 10})
    assert made.status_code == 201, made.text
    kri = made.json()
    assert (kri["status"], kri["is_active"], kri["created_by"]) == ("draft", False, MAKER)
    assert [k["id"] for k in maker.get("/kris", params={"kind": "kri"}).json()] == [kri["id"]], "a draft is on the list"
    assert maker.get("/kris/alerts").json() == [] and maker.get("/kris/report").json()["summary"]["total"] == 0

    # due date computed from the frequency when left blank
    due = datetime.fromisoformat(kri["next_due_date"])
    assert timedelta(days=27) < due - datetime.utcnow() < timedelta(days=32)

    # the edit form cannot switch a draft on
    maker.put(f"/kris/{kri['id']}", json={"is_active": True})
    assert db.get(RiskKRI, kri["id"]).is_active is False

    refused = maker.post(f"/kris/{kri['id']}/activate")
    assert refused.status_code == 409 and "someone else" in refused.json()["detail"]
    ok = checker.post(f"/kris/{kri['id']}/activate")
    assert ok.status_code == 200, ok.text
    assert (ok.json()["status"], ok.json()["is_active"], ok.json()["approved_by"]) == ("active", True, CHECKER)
    assert checker.post(f"/kris/{kri['id']}/activate").status_code == 409, "approved once only"


def test_a_new_kpi_is_active_at_once_and_an_existing_kri_stays_active(db):
    kpi = client(db, "maker").post("/kris", json={"name": "Training completion", "kind": "kpi"}).json()
    assert (kpi["status"], kpi["is_active"]) == ("active", True)
    legacy = RiskKRI(tenant_id=1, name="Legacy", is_active=True)          # stored before wave 2: no status
    db.add(legacy)
    db.commit()
    assert client(db, "maker").get(f"/kris/{legacy.id}").json()["is_active"] is True
    assert client(db, "checker").post(f"/kris/{legacy.id}/activate").status_code == 409, "already active"


# ── Submit → Check ───────────────────────────────────────────────────────────

def test_measuring_a_kri_stores_a_submitted_value_and_does_not_move_the_current_value(db):
    kri = active_kri(db, current_value=1)
    sent = client(db, "maker").post(f"/kris/{kri.id}/measure", json={"value": 2, "review_status": "approved"})
    assert sent.status_code == 200 and sent.json()["review_status"] == "submitted"
    assert sent.json()["reviewed_by"] is None
    via_workflow = client(db, "maker").post(f"/kri-workflow/kris/{kri.id}/submit", json={"value": 2.5}).json()
    assert via_workflow["review_status"] == "submitted", "no reviewer set is no way round the check"
    db.refresh(kri)
    assert (kri.current_value, kri.last_measured_at) == (1, None)


def test_approval_by_another_person_publishes_the_value_and_moves_the_due_date_on(db):
    kri = active_kri(db, next_due_date=datetime(2026, 11, 1))
    sent = client(db, "maker").post(f"/kris/{kri.id}/measure", json={"value": 0.5}).json()
    refused = client(db, "maker").post(f"/kri-workflow/measurements/{sent['id']}/approve")
    assert refused.status_code == 409, "the maker cannot check their own value"
    ok = client(db, "checker").post(f"/kri-workflow/measurements/{sent['id']}/approve")
    assert ok.status_code == 200 and ok.json()["current_value"] == 0.5
    db.refresh(kri)
    assert kri.current_value == 0.5 and kri.last_measured_at is not None
    assert kri.next_due_date == datetime(2026, 12, 1)
    assert [m["value"] for m in client(db, "maker").get(f"/kris/{kri.id}/trend").json()] == [0.5]


def test_a_kpi_value_still_publishes_at_once(db):
    kpi = active_kri(db, name="Training completion")
    kpi.kind = "kpi"
    db.commit()
    sent = client(db, "maker").post(f"/kris/{kpi.id}/measure", json={"value": 2})
    assert sent.json()["review_status"] == "approved"
    db.refresh(kpi)
    assert kpi.current_value == 2


def test_the_checker_sees_the_value_with_its_source_and_the_last_published_value(db):
    kri = active_kri(db, reviewer_id=CHECKER, current_value=1, data_source="Patch console")
    client(db, "maker").post(f"/kris/{kri.id}/measure", json={"value": 2, "notes": "export 3 Nov"})
    items = client(db, "checker").get("/kri-workflow/pending-reviews").json()["items"]
    assert [(i["value"], i["previous_value"], i["data_source"], i["notes"]) for i in items] == [
        (2, 1, "Patch console", "export 3 Nov")]
    # a KRI with no reviewer and no owner is still checked: by any KRI editor
    orphan = active_kri(db, name="Orphan")
    client(db, "maker").post(f"/kris/{orphan.id}/measure", json={"value": 2})
    assert {i["kri_id"] for i in client(db, "checker").get("/kri-workflow/pending-reviews").json()["items"]} == {
        kri.id, orphan.id}


# ── Escalate ────────────────────────────────────────────────────────────────

def test_an_amber_value_notifies_the_kri_owner_and_the_risk_owner(db):
    kri = active_kri(db, owner_id=OWNER, risk_id=1)
    submit_and_approve(db, kri.id, 2)
    assert notified(db) == [OWNER, RISK_OWNER]
    assert db.query(Issue).count() == 0


def test_a_red_value_raises_one_issue_linked_to_the_risk_while_it_is_open(db):
    assert db.query(IssueAutomationFlags).count() == 0, "the tenant never set the flag"
    assert automation_flags.is_enabled(1, "kri_red_breach", db) is True
    assert automation_flags.is_enabled(1, "overdue_mitigation", db) is False, "only the KRI flag is on by default"
    kri = active_kri(db, owner_id=OWNER, risk_id=1)
    submit_and_approve(db, kri.id, 9)
    submit_and_approve(db, kri.id, 12)
    issues = db.query(Issue).all()
    assert len(issues) == 1, "a second red value does not raise a second issue while the first is open"
    assert (issues[0].source_type, issues[0].source_id, issues[0].assignee_id) == ("kri_breach", kri.id, OWNER)
    assert [link.risk_id for link in db.query(IssueRiskLink).all()] == [1]
    assert notified(db) == [OWNER, OWNER, RISK_OWNER, RISK_OWNER]


def test_a_tenant_that_turned_the_flag_off_gets_no_issue(db):
    db.add(IssueAutomationFlags(tenant_id=1, kri_red_breach=False))
    db.commit()
    kri = active_kri(db, owner_id=OWNER, risk_id=1)
    submit_and_approve(db, kri.id, 9)
    assert db.query(Issue).count() == 0
    assert notified(db) == [OWNER, RISK_OWNER], "the owners are still told"


def test_a_submitted_red_value_raises_nothing_until_it_is_checked(db):
    kri = active_kri(db, owner_id=OWNER, risk_id=1)
    client(db, "maker").post(f"/kris/{kri.id}/measure", json={"value": 9})
    assert db.query(Issue).count() == 0 and notified(db) == []


# ── Collect / remind ────────────────────────────────────────────────────────

def _due_world(db):
    now = datetime.utcnow()
    mine = active_kri(db, name="Mine", data_provider_id=PROVIDER, next_due_date=now - timedelta(days=3))
    theirs = active_kri(db, name="Theirs", data_provider_id=OWNER, next_due_date=now - timedelta(days=1))
    later = active_kri(db, name="Later", data_provider_id=PROVIDER, next_due_date=now + timedelta(days=60))
    owner_only = active_kri(db, name="Owner only", owner_id=OWNER, next_due_date=now - timedelta(days=2))
    held = active_kri(db, name="Held", data_provider_id=PROVIDER, next_due_date=now - timedelta(days=5))
    db.add(RiskKRIMeasurement(kri_id=held.id, value=1, measured_by=PROVIDER, review_status="submitted"))
    draft = RiskKRI(tenant_id=1, name="Draft", kind="kri", status="draft", is_active=False,
                    data_provider_id=PROVIDER, next_due_date=now - timedelta(days=9))
    db.add(draft)
    db.commit()
    return mine, theirs, later, owner_only, held


def test_values_due_lists_my_overdue_values_and_all_of_them_for_an_editor(db):
    mine, theirs, later, owner_only, held = _due_world(db)
    for_provider = client(db, "provider").get("/kris/due").json()["due"]
    assert [(d["id"], d["overdue"], d["pending_review"]) for d in for_provider] == [
        (held.id, True, True), (mine.id, True, False)], "overdue first; not someone else's, not a draft, not next month"
    assert for_provider[1]["days_overdue"] == 3
    for_editor = client(db, "maker").get("/kris/due").json()["due"]
    assert {d["id"] for d in for_editor} == {mine.id, theirs.id, owner_only.id, held.id}


def test_reminders_go_to_the_provider_of_each_overdue_value(db):
    mine, theirs, later, owner_only, held = _due_world(db)
    assert client(db, "provider").post("/kris/reminders").status_code == 403, "an editor sends reminders"
    sent = client(db, "maker").post("/kris/reminders")
    assert sent.status_code == 200, sent.text
    assert sent.json()["reminded"] == 3
    # the provider, the provider of the other one, and the owner where no provider is set; a held value is not chased
    assert notified(db) == [PROVIDER, OWNER, OWNER]
    assert db.query(WorkflowNotification).filter_by(user_id=PROVIDER).one().link.startswith("/erm/kris")


def test_the_daily_reminder_job_is_on_the_platform_clock():
    from grc.celery_app import celery_app
    from grc.tasks import kri_reminders

    entry = celery_app.conf.beat_schedule["kri-values-due-daily-reminders"]
    assert entry["task"] == kri_reminders.daily_reminder_sweep.name == "grc.tasks.kri_reminders.daily_reminder_sweep"
    assert entry["schedule"] == 24 * 60 * 60


# ── the data provider submits with view access (added after the build) ───────

def test_the_data_provider_submits_values_for_their_kri_but_not_for_others_or_for_a_kpi(db):
    mine = active_kri(db, data_provider_id=PROVIDER)
    other = active_kri(db, name="Failed logins")
    kpi = RiskKRI(tenant_id=1, name="Training completion", green_threshold=90, amber_threshold=80, frequency="monthly",
                  threshold_direction="higher_is_better", is_active=True, status="active", kind="kpi", data_provider_id=PROVIDER)
    db.add(kpi)
    db.commit()
    provider = client(db, "provider")
    sent = provider.post(f"/kris/{mine.id}/measure", json={"value": 5})
    assert sent.status_code == 200 and sent.json()["review_status"] == "submitted"
    assert provider.post(f"/kri-workflow/kris/{mine.id}/submit", json={"value": 4}).status_code == 200
    assert provider.post(f"/kris/{other.id}/measure", json={"value": 5}).status_code == 403
    assert provider.post(f"/kris/{kpi.id}/measure", json={"value": 90}).status_code == 403   # a KPI publishes at once
    db.refresh(mine)
    assert mine.current_value is None                                                         # still waits for a checker
