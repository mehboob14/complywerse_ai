"""Governance > Settings: the organisation's due dates, reminders, escalation, alert channels and task creation for document
reviews, approvals and acknowledgements (doc_lifecycle.settings / save_settings), and the life cycle honouring each of them."""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import grc.models as m
from grc.modules.governance import doc_lifecycle as life
from grc.modules.governance.routers import document_signoff as signoff
from grc.routers.auth_router import require_auth

from test_document_lifecycle import (_secret, alerts, doc, obligations, participants, sent_channels, sign, tasks, user,  # noqa: F401
                                     world)


def publish(db):
    d = doc(db)
    d.status = "published"
    life.ensure_acknowledgements(db, d, 1)
    db.commit()
    return d


def ack_of(db, uid=6):
    return db.query(m.DocumentObligation).filter_by(user_id=uid, kind="acknowledgement").one()


# ── the settings themselves ──────────────────────────────────────────────────
def test_defaults_keep_the_old_meanings_and_review_days_follow_approval_days_until_set(world):
    with world.factory() as db:
        s = life.settings(db, 1)
        assert (s["approval_days"], s["review_days"], s["ack_days"], s["remind_days"], s["admin_after_days"]) == (7, 7, 14, 3, 7)
        assert (s["remind_every_days"], s["owner_after_days"], s["escalate_role_id"], s["email"]) == (0, 0, None, True)
        assert s["notify"] == {e: "both" for e in life.EVENTS}
        assert s["task_create"] == {"review": True, "approval": True, "acknowledgement": True, "changes": True}
        assert s["task_priority"] == {"review": "High", "approval": "High", "acknowledgement": "Medium", "changes": "High"}
        assert s["four_eyes"] is True                                                          # authors do not approve their own
        assert life.save_settings(db, 1, {"approval_days": 10}, 1)["review_days"] == 10          # follows until set
        assert life.save_settings(db, 1, {"review_days": 2}, 1)["review_days"] == 2
        saved = life.save_settings(db, 1, {"approval_days": 5, "notify": {"rejected": "off"}}, 1)
        assert (saved["review_days"], saved["approval_days"]) == (2, 5)
        assert saved["notify"]["rejected"] == "off" and saved["notify"]["request"] == "both"     # a map is changed per entry
        assert life.due_days(saved, "review") == 2 and life.due_days(saved, "approval") == 5 and life.due_days(saved, "acknowledgement") == 14


@pytest.mark.parametrize("bad, message", [
    ({"review_days": 0}, "Days to review must be a whole number from 1 to 365."),
    ({"remind_every_days": 61}, "Days between reminders must be a whole number from 0 to 60."),
    ({"ack_days": "soon"}, "Days to acknowledge must be a whole number from 1 to 365."),
    ({"owner_after_days": 7}, "Escalate further later than the owner is told"),               # escalation is 7 by default
    ({"notify": {"request": "loud"}}, "loud is not one of"),
    ({"notify": {"tomorrow": "both"}}, "Unknown entry in notify: tomorrow."),
    ({"task_priority": {"review": "Urgent"}}, "Urgent is not one of Critical, High, Medium, Low."),
    ({"task_title": "{doc}: {action}"}, "Task title: {doc} is not a placeholder."),
    ({"task_title": "{document.__class__}"}, "is not a placeholder"),
    ({"task_description": "Read {document"}, "Task description: a { or } is not closed."),
    ({"task_title": "   "}, "Task title cannot be empty."),
    ({"escalate_role_id": 999}, "The role chosen for escalation no longer exists."),
    ({"nope": 1}, "Unknown setting: nope"),
])
def test_bad_settings_are_refused_with_a_message_and_nothing_is_saved(world, bad, message):
    with world.factory() as db:
        before = life.settings(db, 1)
        with pytest.raises(ValueError) as err:
            life.save_settings(db, 1, {"approval_days": 3, **bad}, 1)
        assert str(err.value).startswith(message) if message.endswith(".") else message in str(err.value)
        db.rollback()
        assert life.settings(db, 1) == before


def test_the_older_single_email_switch_is_still_read_and_written(world):
    with world.factory() as db:
        db.add(m.DocumentLifecycleSettings(tenant_id=1, config={"email": False}))           # saved by the older popup
        db.commit()
        s = life.settings(db, 1)
        assert s["email"] is False and set(s["notify"].values()) == {"in_app"} and life.channels(s, "request") == ["in_app"]
        assert life.save_settings(db, 1, {"email": True}, 1)["notify"] == {e: "both" for e in life.EVENTS}
        s = life.save_settings(db, 1, {"notify": {e: "in_app" for e in life.EVENTS}}, 1)
        assert s["email"] is False and db.query(m.DocumentLifecycleSettings).one().config["email"] is False     # kept in step
        assert life.save_settings(db, 1, {"notify": {"overdue": "email"}}, 1)["email"] is True
        assert life.channels(life.save_settings(db, 1, {"email": False}, 1), "overdue") == ["in_app"]       # off: nothing emailed


# ── the life cycle honouring them ────────────────────────────────────────────
def test_reviewers_and_approvers_get_their_own_number_of_days(world):
    with world.factory() as db:
        life.save_settings(db, 1, {"review_days": 2, "approval_days": 5}, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        soon = datetime.utcnow()
        assert all(soon + timedelta(days=1, hours=23) < o.due_date < soon + timedelta(days=2, minutes=1) for o in obligations(db, "review"))
        sign(db, 2)
        sign(db, 3)
        assert all(soon + timedelta(days=4, hours=23) < o.due_date < soon + timedelta(days=5, minutes=1) for o in obligations(db, "approval"))


def test_reminders_repeat_every_few_days_until_it_is_done(world):
    with world.factory() as db:
        life.save_settings(db, 1, {"remind_days": 3, "remind_every_days": 2}, 1)
        publish(db)
        ob = ack_of(db)
        ob.due_date = datetime.utcnow() + timedelta(days=5)
        db.commit()
        assert life.sweep(db)["reminded"] == 0                                   # not yet within 3 days
        ob.due_date = datetime.utcnow() + timedelta(days=2, hours=23)
        db.commit()
        assert life.sweep(db)["reminded"] == 1 and life.sweep(db)["reminded"] == 0
        ob.reminded_at = datetime.utcnow() - timedelta(days=2, minutes=1)        # two days later: again
        db.commit()
        assert life.sweep(db)["reminded"] == 1 and alerts(db, 6)[-1].subject == "Due soon: Acknowledge Access policy"

        ob.due_date = datetime.utcnow() - timedelta(hours=1)                    # overdue: told once, then again every 2 days
        db.commit()
        life.sweep(db)
        assert alerts(db, 6)[-1].subject == "Overdue: Acknowledge Access policy" and ob.overdue_at is not None
        assert life.sweep(db)["reminded"] == 0
        ob.overdue_at = ob.reminded_at = ob.escalated_at = datetime.utcnow() - timedelta(days=2, minutes=1)    # two days on
        ob.due_date = datetime.utcnow() - timedelta(days=2, hours=1)
        db.commit()
        assert life.sweep(db)["reminded"] == 1 and alerts(db, 6)[-1].subject == "Still overdue: Acknowledge Access policy"


def test_once_by_default_as_before(world):
    with world.factory() as db:
        publish(db)
        ob = ack_of(db)
        ob.due_date, ob.reminded_at = datetime.utcnow() + timedelta(days=1), datetime.utcnow() - timedelta(days=30)
        db.commit()
        assert life.sweep(db)["reminded"] == 0


def test_escalation_waits_for_the_owner_then_goes_to_the_chosen_role(world):
    with world.factory() as db:
        life.save_settings(db, 1, {"owner_after_days": 2, "admin_after_days": 4, "escalate_role_id": 10}, 1)     # the Approvers role
        publish(db)
        ob = ack_of(db)
        ob.due_date = datetime.utcnow() - timedelta(days=1)
        db.commit()
        out = life.sweep(db)
        assert (out["owner_told"], ob.escalation_level) == (0, 0) and alerts(db, 6)[-1].subject.startswith("Overdue")   # the person is
        ob.due_date = datetime.utcnow() - timedelta(days=2, minutes=1)
        db.commit()
        assert life.sweep(db)["owner_told"] == 1 and ob.escalation_level == 1 and "Uma User" in alerts(db, 1)[-1].message
        told = len(alerts(db, 6))
        ob.due_date = datetime.utcnow() - timedelta(days=4, minutes=1)
        db.commit()
        assert life.sweep(db)["admins_told"] == 1 and ob.escalation_level == 2
        assert len(alerts(db, 6)) == told                                        # the person is not told again (no repeat set)
        for uid in (4, 5):                                                       # the role's people
            assert alerts(db, uid)[-1].subject == 'Still overdue on "Access policy"'
            assert alerts(db, uid)[-1].message.startswith("Overdue by 4 days or more: Uma User")
        assert not [a for a in alerts(db, 7) if a.subject.startswith("Still overdue")]           # not the administrators
        assert any(e["detail"].endswith("the members of Approvers were told") for e in life.state(db, doc(db), user(db, 1))["timeline"])


def test_a_role_with_nobody_in_it_escalates_to_the_administrators(world):
    with world.factory() as db:
        db.add(m.Role(id=20, tenant_id=1, name="Empty"))
        db.commit()
        cfg = life.save_settings(db, 1, {"escalate_role_id": 20}, 1)
        assert life.escalation_ids(db, cfg, 1) == [7]
        assert life.save_settings(db, 1, {"escalate_role_id": None}, 1)["escalate_role_id"] is None


def test_each_event_goes_only_where_the_organisation_chose(world, monkeypatch):
    calls = sent_channels(monkeypatch)
    with world.factory() as db:
        life.save_settings(db, 1, {"notify": {"request": "email", "rejected": "off", "published": "off", "reminder": "in_app"}}, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert ("Review requested: Access policy", ("email",)) in calls and alerts(db, 2) == []      # email only: no bell
        signoff.reject_document(5, signoff.RejectRequest(comment="no"), db, user(db, 2))
        assert not [s for s, _ch in calls if s.startswith("Rejected")] and not [a for a in alerts(db, 1) if a.subject.startswith("Rejected")]
        calls.clear()
        publish(db)
        assert calls == [] and alerts(db, 6) == []                               # publication alerts off
        assert life.sweep(db)["emailed"] == 0                                    # and so is its daily email list
        ob = ack_of(db)
        ob.due_date = datetime.utcnow() + timedelta(days=1)
        db.commit()
        life.sweep(db)
        assert ("Due soon: Acknowledge Access policy", ("in_app",)) in calls


def test_a_reminder_asked_for_by_hand_still_goes_in_the_app_when_reminders_are_off(world, monkeypatch):
    from grc.models import get_db
    from grc.modules.governance.routers.document_lifecycle import router

    calls = sent_channels(monkeypatch)
    app = FastAPI()
    app.include_router(router)
    db = world.factory()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: user(db, 1)
    client = TestClient(app)
    life.save_settings(db, 1, {"notify": {"reminder": "off"}}, 1)
    publish(db)
    calls.clear()
    assert client.post("/documents/5/lifecycle/remind").json()["reminded"] == 7
    assert calls == [("Reminder: Acknowledge Access policy", ("in_app",))]
    assert alerts(db, 6)[-1].subject == "Reminder: Acknowledge Access policy"
    life.save_settings(db, 1, {"notify": {"reminder": "email"}}, 1)
    calls.clear()
    client.post("/documents/5/lifecycle/remind")
    assert calls == [("Reminder: Acknowledge Access policy", ("email",))]          # otherwise the organisation's channels
    db.close()


def test_task_creation_can_be_switched_off_per_kind_and_tasks_follow_the_priority_and_templates(world):
    with world.factory() as db:
        life.save_settings(db, 1, {"task_create": {"acknowledgement": False}, "task_priority": {"review": "Critical"},
                                   "task_title": "[{action}] {document} v{version}",
                                   "task_description": "Owner {owner}, due {due_date}. Open {link}"}, 1)
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        t = tasks(db)[0]
        assert (t.title, t.priority) == ("[Review] Access policy v1.0", "Critical")
        assert t.description.startswith("Owner Olivia Owner, due ") and t.description.endswith("Open /governance/documents/5?act=sign")
        before = len(tasks(db))
        publish(db)
        assert len(obligations(db, "acknowledgement", "pending")) == 7 and len(tasks(db)) == before        # asked, without tasks
        ob = ack_of(db)
        ob.due_date = datetime.utcnow() - timedelta(days=9)
        db.commit()
        life.sweep(db)
        life.sweep(db)
        assert ob.escalation_level == 2 and ob.critical_task_id is None          # the sweep needs no task
        life.acknowledge(db, doc(db), user(db, 6))
        assert ack_of(db).status == "done"


def test_a_template_saved_by_hand_that_no_longer_works_falls_back_to_the_default(world):
    with world.factory() as db:
        db.add(m.DocumentLifecycleSettings(tenant_id=1, config={"task_title": "{nope}", "task_description": "{"}))
        db.commit()
        participants(db)
        signoff.send_for_review(5, db, user(db, 1))
        assert tasks(db)[0].title == "Review: Access policy" and tasks(db)[0].description.startswith('Please review and sign "Access policy"')


# ── the routes ───────────────────────────────────────────────────────────────
def test_the_settings_routes_for_administrators_and_holders_of_the_settings_right(world):
    from grc.models import get_db
    from grc.modules.governance.routers.document_lifecycle import router

    app = FastAPI()
    app.include_router(router)
    db = world.factory()
    me = {"u": user(db, 6)}
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: me["u"]
    client = TestClient(app)

    hidden = client.get("/documents/lifecycle/settings")                      # no governance right: not even to read them
    assert hidden.status_code == 403 and hidden.json()["detail"] == "Only an administrator or someone with a governance right can see these settings."
    refused = client.put("/documents/lifecycle/settings", json={"review_days": 3})
    assert refused.status_code == 403 and "governance settings" in refused.json()["detail"]

    db.add(m.Role(id=30, tenant_id=1, name="Policy office"))
    db.add(m.Permission(id=30, name="governance:settings:edit", resource="governance:settings", action="edit"))
    db.add(m.RolePermission(role_id=30, permission_id=30))
    db.add(m.UserRole(user_id=6, role_id=30, tenant_id=1))
    db.commit()
    seen = client.get("/documents/lifecycle/settings").json()
    assert seen["can_edit"] is True and [r["name"] for r in seen["roles"]] == ["Administrator", "Approvers", "Policy office", "Staff"]
    got = client.put("/documents/lifecycle/settings", json={"review_days": 3, "escalate_role_id": 30, "notify": {"approved": "in_app"}}).json()
    assert (got["settings"]["review_days"], got["settings"]["escalate_role_id"], got["settings"]["notify"]["approved"]) == (3, 30, "in_app")
    db.add(m.Role(id=31, tenant_id=1, name="Policy readers"))                   # any governance right reads them
    db.add(m.Permission(id=31, name="governance:policies:read", resource="governance:policies", action="read"))
    db.add(m.RolePermission(role_id=31, permission_id=31))
    db.add(m.UserRole(user_id=2, role_id=31, tenant_id=1))
    db.commit()
    me["u"] = user(db, 2)                                                        # someone who only reads them sees the role's name
    seen = client.get("/documents/lifecycle/settings").json()
    assert seen["escalate_role_name"] == "Policy office" and seen["can_edit"] is False and seen["roles"] == []
    assert seen["defaults"]["review_days"] == 7
    me["u"] = user(db, 6)
    assert client.put("/documents/lifecycle/settings", json={"escalate_role_id": None}).json()["settings"]["escalate_role_id"] is None
    assert client.put("/documents/lifecycle/settings", json={"ack_days": 21}).json()["settings"]["review_days"] == 3   # untouched
    bad = client.put("/documents/lifecycle/settings", json={"task_title": "{who}"})
    assert bad.status_code == 400 and bad.json()["detail"].startswith("Task title: {who} is not a placeholder")
    me["u"] = user(db, 7)                                                        # an administrator
    assert client.put("/documents/lifecycle/settings", json={"ack_days": 20}).json()["can_edit"] is True
    db.close()


def test_the_permission_is_offered_in_the_role_editor():
    from grc.permissions import get_all_permissions

    names = {p["name"] for p in get_all_permissions()}
    assert {"governance:settings:view", "governance:settings:edit"} <= names
