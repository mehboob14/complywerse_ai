"""A bell notification opens what it is about: SCF control alerts open the control, audit-register alerts the Issue Register.

They had no link, so the top bar showed them as dead text (the user, 2026-10-18: "when I click on any item it isn't clickable").
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import grc.models as m
from grc.modules.issue_management.audit_register import workflow as register
from grc.modules.scf import ownership
from grc.modules.workflow_engine.services import notification_service


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(notification_service, "send_email", lambda *a, **k: {"success": False})   # no mail in a test
    engine = create_engine("sqlite://")
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.add(m.GRCUser(id=3, username="sara", email="sara@bank.example", display_name="Sara Khan", is_active=True))
        session.commit()
        yield session


def _links(db):
    return [n.link for n in db.query(m.WorkflowNotification).order_by(m.WorkflowNotification.id)]


def test_a_control_assignment_opens_the_control(db):
    ownership._notify_ownership(db, tenant_id=1, scf_id="IAC-01.2", user_ids=[3])
    assert _links(db) == ["/automation/soc2-controls/IAC-01.2"]


def test_a_control_id_is_one_part_of_the_path():
    assert ownership.control_link("CUS/01 a") == "/automation/soc2-controls/CUS%2F01%20a"


def test_an_attestation_reminder_opens_the_control(db):
    from grc.tasks.scf import attestation_reminders_for_tenant

    db.add(m.SCFControlState(tenant_id=1, scope_id=1, scf_id="GOV-02", owner_user_id=3,
                             next_due_at=datetime.utcnow() + timedelta(days=3)))
    db.commit()
    assert attestation_reminders_for_tenant.run("demo", db=db)["notified"] == 1
    assert _links(db) == ["/automation/soc2-controls/GOV-02"]


def test_an_audit_register_alert_opens_the_issue_register(db):
    assert register._notify(db, 1, [3], "Ready for validation: MRA-1", "Two files were submitted.") == 1
    assert _links(db) == ["/auditor-portal/issue-register"]
