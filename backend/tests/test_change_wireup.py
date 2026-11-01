"""Change wire-up (approvals/SLA → live change flow): submit routes to CAB or
auto-approves, CAB votes reach quorum and flip the change to approved while the
SLA clock freezes then resumes. Direct function calls on an in-memory SQLite.
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-change")  # change.py imports auth_router

from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    HDTicket, HDApproval, HDApprovalVote, HDChangeType, HDChangeRiskMatrix,
    HDSLATarget, HDServiceLevelAgreement, HDTicketPriority, HDTicketCI, AuditLog, GRCUser,
)
from grc.modules.helpdesk_native import change as change_mod

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (HDTicket, HDApproval, HDApprovalVote, HDChangeType, HDChangeRiskMatrix,
              HDSLATarget, HDServiceLevelAgreement, HDTicketPriority, HDTicketCI, AuditLog, GRCUser):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _mk_change(db, change_type, raiser="raiser@x.com", with_sla=False):
    p1 = HDTicketPriority(tenant_id=TENANT, name="Urgent", level="Urgent", code="P1", rank=1)
    db.add(p1); db.flush()
    if with_sla:
        db.add(HDSLATarget(tenant_id=TENANT, process="change", priority_label="P1",
                           priority_code="P1", service_window="24x7",
                           response_minutes=60, resolution_minutes=480))
    t = HDTicket(tenant_id=TENANT, subject="chg", process="change", status_category="Open",
                 approval_state="draft", change_type=change_type, raised_by=raiser,
                 priority_id=p1.id, created_at=datetime.utcnow())
    db.add(t); db.commit()
    return t


def test_standard_change_auto_approves(db):
    db.add(HDChangeType(tenant_id=TENANT, code="standard", name="Standard",
                        requires_cab=False, auto_approve=True))
    db.commit()
    t = _mk_change(db, "standard")
    res = change_mod.submit_and_route(db, TENANT, t.id, "raiser@x.com")
    assert res["ok"] and res["cab"] is False and res.get("auto_approved") is True
    db.refresh(t)
    assert t.approval_state == "approved"
    assert db.query(HDApproval).count() == 0          # no CAB opened


def test_normal_change_opens_cab_and_freezes_sla(db):
    db.add(HDChangeType(tenant_id=TENANT, code="normal", name="Normal", requires_cab=True))
    db.commit()
    t = _mk_change(db, "normal", with_sla=True)
    res = change_mod.submit_and_route(db, TENANT, t.id, "raiser@x.com")
    assert res["ok"] and res["cab"] is True and res["approval_id"]
    db.refresh(t)
    assert t.approval_state == "pending_approval"
    ap = db.query(HDApproval).filter_by(ticket_id=t.id, state="pending").one()
    assert ap.required_quorum == 3
    # SLA frozen while the CAB is pending
    assert t.agreement_status == "Paused" and t.on_hold_since is not None


def test_cab_quorum_approves_and_resumes_sla(db):
    db.add(HDChangeType(tenant_id=TENANT, code="normal", name="Normal", requires_cab=True))
    db.commit()
    t = _mk_change(db, "normal", with_sla=True)
    change_mod.submit_and_route(db, TENANT, t.id, "raiser@x.com")
    # three approvers incl the required Change Manager + Service Owner roles
    change_mod.vote(db, TENANT, t.id, "cm@x.com", "approve", role="ROLE-CHGMGR")
    change_mod.vote(db, TENANT, t.id, "so@x.com", "approve", role="ROLE-SVCOWN")
    db.refresh(t)
    assert t.approval_state == "pending_approval"      # quorum not yet 3
    res = change_mod.vote(db, TENANT, t.id, "te@x.com", "approve", role="ROLE-TECH")
    db.refresh(t)
    assert res["approval_state"] == "approved" and t.approval_state == "approved"
    # SLA resumed: no longer paused, hold time banked
    assert t.on_hold_since is None


def test_raiser_cannot_vote(db):
    db.add(HDChangeType(tenant_id=TENANT, code="normal", name="Normal", requires_cab=True))
    db.commit()
    t = _mk_change(db, "normal", with_sla=True, raiser="boss@x.com")
    change_mod.submit_and_route(db, TENANT, t.id, "boss@x.com")
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        change_mod.vote(db, TENANT, t.id, "boss@x.com", "approve", role="ROLE-CHGMGR")
    assert ei.value.status_code == 400


def test_reject_vote_rejects_change(db):
    db.add(HDChangeType(tenant_id=TENANT, code="normal", name="Normal", requires_cab=True))
    db.commit()
    t = _mk_change(db, "normal", with_sla=True)
    change_mod.submit_and_route(db, TENANT, t.id, "raiser@x.com")
    res = change_mod.vote(db, TENANT, t.id, "cm@x.com", "reject", role="ROLE-CHGMGR", comment="no")
    db.refresh(t)
    assert res["approval_state"] == "rejected" and t.approval_state == "rejected"
