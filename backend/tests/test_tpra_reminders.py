"""Third-party risk dates get acted on, once per reminder period.

Five dates in the vendor module carried a promise and nothing acted on any of
them. These pin the rhythm (one notice when the window opens, then weekly once
overdue), who is told, the escalation threshold, and — the part that matters
most — that however often the sweep runs, nobody is told the same thing twice.
"""
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
    TPRAFinding, TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAReminder,
)
from grc.modules.vendor_risk.tpra import reminders
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG

TODAY = date(2026, 9, 23)
POLICY = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])      # 14 before, weekly, escalate at 14
_TABLES = [Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
           TPRAFinding, TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAReminder]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


def _at(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, 9, 0)


def _vendor(db, **kw):
    v = Vendor(tenant_id=1, name=kw.pop("name", "Acme Cloud"), status=kw.pop("status", "active"),
               owner_id=7, **kw)
    db.add(v)
    db.commit()
    return v


class Inbox:
    def __init__(self):
        self.sent = []

    def __call__(self, db, tenant_id, user_id, subject, message):
        self.sent.append((user_id, subject))


# ── the rhythm ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("days_left,expected", [
    (30, None),                    # outside the window: nothing yet
    (14, -14), (3, -14), (0, -14),  # one period for the whole run-up
    (-1, 0), (-6, 0),               # first overdue week
    (-7, 7), (-13, 7), (-14, 14),   # then weekly
])
def test_one_notice_as_the_window_opens_then_weekly(days_left, expected):
    due = TODAY + timedelta(days=days_left)
    period = reminders.reminder_period(due, TODAY, before=14, every=7)
    assert (None if period is None else (period - due).days) == expected


def test_something_that_lapses_once_gets_one_overdue_notice():
    due = TODAY - timedelta(days=30)
    assert reminders.reminder_period(due, TODAY, 14, 7, once_overdue=True) == due


# ── each date ────────────────────────────────────────────────────────────────

def test_a_reassessment_coming_due_tells_the_owner(db):
    _vendor(db, next_reassessment_date=_at(TODAY + timedelta(days=5)))
    inbox = Inbox()
    counts = reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    assert counts["sent"] == 1 and inbox.sent[0][0] == 7
    assert "Reassessment of Acme Cloud is due in 5 days" in inbox.sent[0][1]


def test_a_retired_vendor_is_left_alone(db):
    _vendor(db, status="retired", next_reassessment_date=_at(TODAY))
    assert reminders.run(db, 1, POLICY, today=TODAY, deliver=Inbox())["owed"] == 0


def test_a_questionnaire_waiting_on_the_vendor_is_chased_internally(db):
    v = _vendor(db)
    db.add(VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, token="x", status="pending",
                                       expires_at=_at(TODAY + timedelta(days=2))))
    db.commit()
    inbox = Inbox()
    reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    assert inbox.sent and "still unanswered" in inbox.sent[0][1]


def test_overdue_remediation_goes_to_its_owner(db):
    v = _vendor(db)
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, title="No MFA on admin", severity="high")
    db.add(f)
    db.flush()
    db.add(TPRARemediation(tenant_id=1, finding_id=f.id, title="Enforce MFA", owner_id=11,
                           status="open", due_date=_at(TODAY - timedelta(days=3))))
    db.commit()
    inbox = Inbox()
    reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    assert inbox.sent == [(11, "Remediation 'Enforce MFA' for Acme Cloud is 3 days overdue")]


def test_finished_remediation_is_not_chased(db):
    v = _vendor(db)
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, title="x", severity="low")
    db.add(f)
    db.flush()
    db.add(TPRARemediation(tenant_id=1, finding_id=f.id, owner_id=11, status="completed",
                           due_date=_at(TODAY - timedelta(days=3))))
    db.commit()
    assert reminders.run(db, 1, POLICY, today=TODAY, deliver=Inbox())["owed"] == 0


def test_a_lapsed_acceptance_is_marked_expired_and_both_people_told(db):
    v = _vendor(db)
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=1, title="x", severity="high")
    db.add(f)
    db.flush()
    a = TPRARiskAcceptance(tenant_id=1, finding_id=f.id, accepted_by=21, status="active",
                           expiry=_at(TODAY - timedelta(days=1)))
    db.add(a)
    db.commit()
    inbox = Inbox()
    reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    db.refresh(a)
    assert a.status == "expired", "an expired acceptance must stop mitigating"
    assert {u for u, _ in inbox.sent} == {21, 7}


def test_a_contract_is_flagged_by_its_earlier_date(db):
    v = _vendor(db)
    db.add(TPRAContract(tenant_id=1, vendor_id=v.id, title="MSA", status="active",
                        renewal_date=_at(TODAY + timedelta(days=10)),
                        expiry_date=_at(TODAY + timedelta(days=200))))
    db.commit()
    inbox = Inbox()
    reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    assert inbox.sent and "Contract 'MSA' with Acme Cloud is due in 10 days" in inbox.sent[0][1]


# ── once, however often it runs ──────────────────────────────────────────────

def test_running_twice_the_same_day_tells_nobody_twice(db):
    _vendor(db, next_reassessment_date=_at(TODAY - timedelta(days=2)))
    inbox = Inbox()
    first = reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    second = reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    assert (first["sent"], second["sent"], second["already_sent"]) == (1, 0, 1)
    assert len(inbox.sent) == 1


def test_a_new_week_brings_a_new_reminder(db):
    _vendor(db, next_reassessment_date=_at(TODAY - timedelta(days=2)))
    inbox = Inbox()
    reminders.run(db, 1, POLICY, today=TODAY, deliver=inbox)
    reminders.run(db, 1, POLICY, today=TODAY + timedelta(days=3), deliver=inbox)   # same week
    reminders.run(db, 1, POLICY, today=TODAY + timedelta(days=5), deliver=inbox)   # next week
    assert len(inbox.sent) == 2


def test_a_failed_delivery_is_tried_again_next_run(db):
    _vendor(db, next_reassessment_date=_at(TODAY))

    def broken(*args):
        raise ConnectionError("smtp down")

    assert reminders.run(db, 1, POLICY, today=TODAY, deliver=broken)["failed"] == 1
    assert db.query(TPRAReminder).count() == 0
    assert reminders.run(db, 1, POLICY, today=TODAY, deliver=Inbox())["sent"] == 1


# ── escalation ───────────────────────────────────────────────────────────────

def test_escalation_contacts_join_once_the_threshold_passes(db):
    head = Role(tenant_id=1, name="Head of TPRM")
    db.add(head)
    db.flush()
    db.add(UserRole(tenant_id=1, user_id=99, role_id=head.id))
    db.commit()
    policy = dict(POLICY, escalate_after_days=10, escalate_to=["role:Head of TPRM", "user:55"])
    _vendor(db, next_reassessment_date=_at(TODAY - timedelta(days=5)))
    inbox = Inbox()
    reminders.run(db, 1, policy, today=TODAY, deliver=inbox)
    assert {u for u, _ in inbox.sent} == {7}                    # 5 days late: owner only
    reminders.run(db, 1, policy, today=TODAY + timedelta(days=9), deliver=inbox)
    escalated = [(u, s) for u, s in inbox.sent if s.startswith("Escalation:")]
    assert {u for u, _ in escalated} == {99, 55}


def test_nothing_goes_out_when_reminders_are_switched_off(db):
    _vendor(db, next_reassessment_date=_at(TODAY))
    assert reminders.run(db, 1, dict(POLICY, enabled=False), today=TODAY, deliver=Inbox())["sent"] == 0


# ── the policy ───────────────────────────────────────────────────────────────

def test_the_policy_is_validated():
    with pytest.raises(ValueError, match="between 1 and"):
        reminders.clean_policy({"repeat_every_days": 0}, POLICY)
    with pytest.raises(ValueError, match="role:<role name>"):
        reminders.clean_policy({"escalate_to": ["the audit committee"]}, POLICY)
    with pytest.raises(ValueError, match="Unknown reminder setting"):
        reminders.clean_policy({"remind_every_hour": 1}, POLICY)
    cleaned = reminders.clean_policy({"remind_before_days": "30", "escalate_to": ["user:4"]}, POLICY)
    assert cleaned["remind_before_days"] == 30 and cleaned["escalate_to"] == ["user:4"]
