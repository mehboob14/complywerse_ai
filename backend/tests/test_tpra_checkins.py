"""The yearly check-in: owner still right, anything changed, contacts current.

Due a year after the last check-in (or after approval), worked out when read.
A reported change goes to the attention queue; an overdue one reminds the owner
and whoever else looks after the supplier.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAApproval, TPRAAuditLog, TPRACheckin, Vendor, get_db
from grc.modules.vendor_risk.tpra import attention, checkins, rbac, reminders
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()
TODAY = NOW.date()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    for uid, name in ((7, "owner"), (8, "stakeholder"), (9, "stranger"), (10, "newowner")):
        s.add(GRCUser(id=uid, username=name, email=f"{name}@acme.test", display_name=name.title(), is_active=True))
    s.commit()
    yield s
    s.close()


def _vendor(db, name, *, created_days=400, status="active", **kw):
    v = Vendor(tenant_id=1, name=name, status=status, tier="high", owner_id=7, stakeholder_ids=[8],
               created_at=NOW - timedelta(days=created_days), **kw)
    db.add(v)
    db.flush()
    return v


def test_due_a_year_after_approval_or_the_last_check_in(db):
    old = _vendor(db, "Old Co")                                   # added 400 days ago, never checked in
    approved = _vendor(db, "Approved Co")
    db.add(TPRAApproval(tenant_id=1, vendor_id=approved.id, assessment_id=1, decision="approve",
                        created_at=NOW - timedelta(days=340)))
    fresh = _vendor(db, "Fresh Co")
    db.add(TPRACheckin(tenant_id=1, vendor_id=fresh.id, completed_by=7, completed_at=NOW - timedelta(days=10),
                       still_owner=True, changed=False, contact_current=True))
    _vendor(db, "Requested Co", status="requested")               # not in use: never scheduled
    _vendor(db, "Onboarding Co", status="onboarding")
    db.commit()
    states = {r["vendor"].name: r["state"] for r in checkins.schedule(db, 1, TODAY)}
    assert states == {"Old Co": "overdue", "Approved Co": "due_soon", "Fresh Co": "done"}


def test_the_interval_comes_from_the_reminder_policy():
    assert reminders.clean_policy({"checkin_every_days": 180}, {})["checkin_every_days"] == 180
    with pytest.raises(ValueError, match="between 30"):
        reminders.clean_policy({"checkin_every_days": 7}, {})


@pytest.fixture()
def as_user(db, monkeypatch):
    who = {"id": 7}

    def require_write(_db, user, resource, action="edit", allow_fallback=True):
        if user.id in (7, 8, 9):
            raise HTTPException(403, "Permission denied")     # none of them is on the TPRM team

    monkeypatch.setattr(rbac, "require_write", require_write)
    app = FastAPI()
    app.include_router(checkins.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, who["id"])
    client = TestClient(app)

    def use(uid):
        who["id"] = uid
        return client
    return use


def test_a_check_in_records_changes_and_moves_the_next_one_out(db, as_user):
    v = _vendor(db, "Payroll Co", primary_contact_email="old@payroll.test")
    db.commit()
    owner = as_user(7)
    assert owner.post(f"/vendors/{v.id}/checkins", json={"still_owner": False, "changed": False,
                                                          "contact_current": True}).status_code == 400
    assert owner.post(f"/vendors/{v.id}/checkins", json={"still_owner": True, "changed": True, "change_notes": "new",
                                                          "contact_current": True}).status_code == 400
    assert owner.post(f"/vendors/{v.id}/checkins", json={"still_owner": True, "changed": False, "contact_current": False,
                                                          "contact": {"primary_contact_email": "nope"}}).status_code == 400
    made = owner.post(f"/vendors/{v.id}/checkins", json={
        "still_owner": False, "new_owner_id": 10, "changed": True,
        "change_notes": "They now also process our pensions data", "contact_current": False,
        "contact": {"primary_contact_email": "ops@payroll.test", "primary_contact_name": "  Ana   Ops "}})
    assert made.status_code == 201, made.text
    assert made.json()["new_owner"] == "Newowner" and made.json()["on_time"] is False
    db.refresh(v)
    assert (v.owner_id, v.primary_contact_email, v.primary_contact_name) == (10, "ops@payroll.test", "Ana Ops")
    actions = {r.action for r in db.query(TPRAAuditLog).filter_by(vendor_id=v.id)}
    assert {"owner_change", "create"} <= actions
    after = as_user(8).get(f"/vendors/{v.id}/checkins").json()      # the stakeholder can see and act
    assert after["state"] == "done" and after["can_check_in"] and len(after["items"]) == 1   # next one a year out
    assert as_user(9).post(f"/vendors/{v.id}/checkins", json={"still_owner": True, "changed": False,
                                                               "contact_current": True}).status_code == 403
    board = as_user(9).get("/checkins", params={"scope": "mine"}).json()
    assert board["items"] == []                                      # nothing is the stranger's


def test_overdue_check_ins_remind_and_reported_changes_need_the_team(db):
    v = _vendor(db, "Late Co")
    changed = _vendor(db, "Changed Co", created_days=20)
    db.add(TPRACheckin(tenant_id=1, vendor_id=changed.id, completed_by=7, completed_at=NOW - timedelta(days=2),
                       still_owner=True, changed=True, change_notes="Moved hosting to another country",
                       contact_current=True))
    db.commit()
    queue = {(i["condition"], i["vendor_name"]) for i in attention.open_items(db, 1, TODAY, {})}
    assert ("checkin_overdue", "Late Co") in queue and ("checkin_change", "Changed Co") in queue
    notices = [n for n in reminders.due_notices(db, 1, TODAY, {}) if n.kind == "checkin_due"]
    assert [(n.vendor_id, sorted(n.recipients)) for n in notices] == [(v.id, [7, 8])]
