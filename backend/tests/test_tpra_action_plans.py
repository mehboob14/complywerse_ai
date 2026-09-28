"""A supplier's action plan, alert emails and the weekly procurement digest.

An action is planned for a date and for someone (the owner when nobody is
chosen). A to-do waits for a person: from its date it is in their attention
queue and reminded weekly until it is done. The rest happen on their date: a
questionnaire is sent, the check-in falls due, a reassessment opens; one that
cannot happen says why and is flagged. New verified alerts at or above the
tenant's severity are emailed once. The procurement digest goes once a week, on
the tenant's day, and only when someone is waiting.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Tenant, TPRAActionItem, TPRAAuditLog, TPRAMonitoringSignal, TPRAReminder, Vendor,
    VendorAssessment, VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.tpra import action_plans, attention, checkins, rbac, reminders, service
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.routers.auth_router import require_auth

TODAY = datetime.utcnow().date()
POLICY = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="owner", email="o@acme.test", display_name="Olu Owner", is_active=True),
               GRCUser(id=8, username="buyer", email="b@acme.test", display_name="Bea Buyer", is_active=True)])
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=7,
                 primary_contact_name="Sam", primary_contact_email="sam@payroll.test",
                 created_at=datetime.utcnow() - timedelta(days=30)))
    s.add(Vendor(id=2, tenant_id=1, name="Print Co", status="active", tier="low", owner_id=7))
    s.add(VendorQuestionnaireTemplate(id=5, tenant_id=1, name="Security basics", questions=[
        {"id": "q1", "text": "Do you encrypt data at rest?", "type": "yes_no"}]))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(action_plans, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(action_plans.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 8)
    return TestClient(app)


def _item(db, **kw):
    item = TPRAActionItem(tenant_id=1, vendor_id=kw.pop("vendor_id", 1), kind=kw.pop("kind", "todo"),
                          title=kw.pop("title", "Call them about the SOC 2 renewal"), due_on=kw.pop("due_on", TODAY),
                          status=kw.pop("status", "scheduled"), **kw)
    db.add(item)
    db.commit()
    return item


def test_an_action_is_planned_for_a_date_and_someone(db, http):
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    assert http.post("/vendors/1/actions", json={"kind": "todo", "title": "Call", "due_on": "2020-01-01"}).status_code == 400
    assert http.post("/vendors/1/actions", json={"kind": "todo", "due_on": tomorrow}).status_code == 400
    assert http.post("/vendors/1/actions", json={"kind": "questionnaire", "due_on": tomorrow}).status_code == 400
    assert http.post("/vendors/1/actions", json={"kind": "todo", "title": "Call", "due_on": tomorrow,
                                                 "assignee_ids": [99]}).status_code == 400
    todo = http.post("/vendors/1/actions", json={"kind": "todo", "title": "  Call  them ", "due_on": tomorrow}).json()
    assert todo["title"] == "Call them" and todo["people"] == [{"id": 7, "name": "Olu Owner"}]   # nobody chosen: the owner
    sent = http.post("/vendors/1/actions", json={"kind": "questionnaire", "template_id": 5, "due_on": tomorrow,
                                                 "assignee_ids": [8]}).json()
    assert sent["title"] == "Send 'Security basics'" and sent["automatic"] and sent["people"][0]["id"] == 8
    listed = http.get("/vendors/1/actions").json()
    assert [i["kind"] for i in listed["items"]] == ["questionnaire", "todo"] and "checkin" in listed["kinds"]
    done = http.patch(f"/actions/{todo['id']}", json={"status": "done"}).json()
    assert done["status"] == "done" and done["done_by"] == "Bea Buyer"
    assert http.patch(f"/actions/{todo['id']}", json={"title": "Changed"}).status_code == 400   # plan it again first
    again = http.patch(f"/actions/{todo['id']}", json={"status": "scheduled"}).json()
    assert again["status"] == "scheduled" and again["result"] is None
    assert db.query(TPRAAuditLog).filter_by(entity="action").count() == 4
    assert http.get("/actions?state=open").json()["counts"] == {"due": 0, "failed": 0}


def test_automatic_actions_happen_on_their_date(db, monkeypatch):
    invited = []
    send = _item(db, kind="questionnaire", template_id=5, title="Send 'Security basics'")
    no_contact = _item(db, vendor_id=2, kind="questionnaire", template_id=5, title="Send it")
    checkin = _item(db, kind="checkin", title="Ask for the yearly check-in")
    reassess = _item(db, kind="reassessment", title="Reassess after the acquisition")
    later = _item(db, kind="reassessment", title="Next year", due_on=TODAY + timedelta(days=30))
    opened = []
    monkeypatch.setattr(service, "create_reassessment_version",
                        lambda db, vendor, actor_id, reason: opened.append((vendor.id, reason)))
    counts = action_plans.fire_due(db, 1, TODAY, invite=lambda db, qr: invited.append(qr.respondent_email))
    assert counts == {"done": 3, "failed": 1}
    qr = db.query(VendorQuestionnaireResponse).one()
    assert (qr.vendor_id, qr.template_id, qr.status, invited) == (1, 5, "pending", ["sam@payroll.test"])
    assert send.status == "done" and "sam@payroll.test" in send.result
    assert no_contact.status == "failed" and "no contact email" in no_contact.result
    assert opened == [(1, "Planned: Reassess after the acquisition")] and reassess.status == "done"
    assert later.status == "scheduled"
    assert action_plans.fire_due(db, 1, TODAY)["done"] == 0                       # each happens once
    # The yearly check-in, a year away, is due now that one was asked for.
    due = {i["vendor"].id: i for i in checkins.schedule(db, 1, TODAY)}[1]
    assert due["due"] == TODAY and checkin.status == "done"


def test_a_todo_is_queued_and_reminded_until_done_and_a_failure_is_flagged(db):
    todo = _item(db, assignee_ids=[8], due_on=TODAY - timedelta(days=2))
    failed = _item(db, kind="questionnaire", status="failed", result="This could not happen: no contact email.",
                   title="Send it")
    notices = {(n.kind, n.subject_id): n for n in reminders.due_notices(db, 1, TODAY, POLICY)}
    assert notices[("action_due", todo.id)].recipients == [8] and "2 days overdue" in notices[("action_due", todo.id)].title
    assert notices[("action_failed", failed.id)].recipients == [7]
    mine = attention.queue(db, 1, 8, scope="mine")["items"]
    assert [i["condition"] for i in mine] == ["action_due"]
    everyone = {i["condition"] for i in attention.queue(db, 1, None)["items"]}
    assert {"action_due", "action_failed"} <= everyone
    todo.status = "done"
    db.commit()
    assert ("action_due", todo.id) not in {(n.kind, n.subject_id) for n in reminders.due_notices(db, 1, TODAY, POLICY)}


def test_new_alerts_are_emailed_once_from_the_chosen_severity(db):
    def signal(severity, title, **kw):
        s = TPRAMonitoringSignal(tenant_id=1, vendor_id=1, signal_type="breach", severity=severity, title=title,
                                 created_at=kw.pop("created_at", datetime.utcnow()), **kw)
        db.add(s)
        return s
    signal("high", "Customer data exposed")
    signal("medium", "A minor incident")
    signal("critical", "Only one source", verified=False)
    signal("critical", "Old news", created_at=datetime.utcnow() - timedelta(days=10))
    signal("critical", "Ruled out", triage_status="not_relevant")
    db.commit()
    policy = {**POLICY, "alert_notify": ["user:8"]}
    sent = []
    reminders.run(db, 1, policy, today=TODAY, deliver=lambda db, tid, uid, subject, message: sent.append((uid, subject)))
    assert sorted(sent) == [(7, "New high alert on Payroll Co: Customer data exposed"),
                            (8, "New high alert on Payroll Co: Customer data exposed")]
    reminders.run(db, 1, policy, today=TODAY, deliver=lambda *a: sent.append(a))
    assert len(sent) == 2                                                        # once, however often it runs
    assert reminders.clean_policy({"alert_min_severity": "critical", "digest_weekday": 3}, POLICY)["digest_weekday"] == 3
    with pytest.raises(ValueError):
        reminders.clean_policy({"alert_min_severity": "urgent"}, POLICY)


def test_the_procurement_digest_goes_weekly_to_the_people_named(db):
    monday = TODAY - timedelta(days=TODAY.weekday())
    policy = {**POLICY, "digest_to": ["user:8"], "digest_weekday": 0}
    sent = []
    deliver = lambda db, tid, uid, subject, message: sent.append((uid, subject, message))  # noqa: E731
    reminders.run(db, 1, policy, today=monday, deliver=deliver)
    assert sent == []                                                            # nobody waiting: no digest
    db.add(Vendor(id=3, tenant_id=1, name="Cloud Co", status="requested", intake_status="submitted", owner_id=7,
                  submitted_at=datetime.utcnow() - timedelta(days=5)))
    db.commit()
    reminders.run(db, 1, policy, today=monday + timedelta(days=1), deliver=deliver)
    assert sent == []                                                            # not the digest's day
    reminders.run(db, 1, policy, today=monday, deliver=deliver)
    reminders.run(db, 1, policy, today=monday, deliver=deliver)
    assert len(sent) == 1 and sent[0][0] == 8 and sent[0][1] == "1 suppliers waiting on onboarding review"
    assert "Cloud Co: Waiting for review" in sent[0][2]
    assert db.query(TPRAReminder).filter_by(kind="procurement_digest").count() == 1
