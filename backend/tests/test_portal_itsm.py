"""Portal ITSM endpoints: the end-user catalogue, my-approvals list, and the
portal vote (with segregation of duties). Direct function calls on in-memory
SQLite; a grc_tenants row backs tenant_id(db).
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-portal")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    Tenant, HDServiceCategory, HDBusinessService, HDRequestItem,
    HDApproval, HDApprovalVote, HDTicket,
)
from grc.modules.helpdesk_native import portal

TENANT = 1


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for m in (Tenant, HDServiceCategory, HDBusinessService, HDRequestItem,
              HDApproval, HDApprovalVote, HDTicket):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=TENANT, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


def test_portal_catalogue_lists_enabled_only(db):
    db.add(HDServiceCategory(tenant_id=TENANT, code="CAT-A", name="Access", enabled=True))
    db.add(HDBusinessService(tenant_id=TENANT, code="SVC-1", name="Email", enabled=True))
    db.add(HDBusinessService(tenant_id=TENANT, code="SVC-2", name="Retired svc", enabled=False))
    db.add(HDRequestItem(tenant_id=TENANT, code="REQ-1", name="New mailbox", enabled=True,
                         approval_required=True))
    db.commit()
    out = portal.portal_catalogue(db=db, email="u@x.com", _=True)
    assert [c["name"] for c in out["categories"]] == ["Access"]
    assert [s["name"] for s in out["services"]] == ["Email"]          # retired excluded
    assert out["requests"][0]["approval_required"] is True


def test_portal_vote_segregation_blocks_raiser(db):
    t = HDTicket(tenant_id=TENANT, subject="chg", process="change",
                 status_category="Open", raised_by="raiser@x.com")
    db.add(t); db.flush()
    ap = HDApproval(tenant_id=TENANT, ticket_id=t.id, kind="request",
                    required_quorum=1, state="pending")
    db.add(ap); db.commit()
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        portal.portal_vote(ap.id, portal.PortalVote(decision="approve"),
                           db=db, email="raiser@x.com", _=True)
    assert ei.value.status_code == 400


def test_portal_vote_approves_and_my_approvals_excludes_voted(db):
    t = HDTicket(tenant_id=TENANT, subject="req", process="service_request",
                 status_category="Open", raised_by="raiser@x.com")
    db.add(t); db.flush()
    ap = HDApproval(tenant_id=TENANT, ticket_id=t.id, kind="request",
                    required_quorum=1, state="pending")
    db.add(ap); db.commit()
    # before voting, it shows in the approver's queue
    before = portal.portal_my_approvals(db=db, email="mgr@x.com", _=True)
    assert any(a["id"] == ap.id for a in before["approvals"])
    # a single approve meets quorum 1 → approved
    res = portal.portal_vote(ap.id, portal.PortalVote(decision="approve", comment="ok"),
                             db=db, email="mgr@x.com", _=True)
    assert res["ok"] and res["state"] == "approved"
    db.refresh(t)
    assert t.approval_state == "approved"
    # and it's gone from that approver's pending queue
    after = portal.portal_my_approvals(db=db, email="mgr@x.com", _=True)
    assert not any(a["id"] == ap.id for a in after["approvals"])


def test_portal_bad_decision_rejected(db):
    t = HDTicket(tenant_id=TENANT, subject="x", process="change", status_category="Open",
                 raised_by="r@x.com")
    db.add(t); db.flush()
    ap = HDApproval(tenant_id=TENANT, ticket_id=t.id, kind="cab", required_quorum=3, state="pending")
    db.add(ap); db.commit()
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        portal.portal_vote(ap.id, portal.PortalVote(decision="maybe"),
                           db=db, email="mgr@x.com", _=True)
    assert ei.value.status_code == 400
