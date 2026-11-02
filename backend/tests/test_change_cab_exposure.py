"""Exposure-aware change governance (phase 2 §4): a Standard change that would
auto-approve is escalated to CAB when its affected CI — or any CI contained under
it — is internet-facing or PCI, and the reason is persisted on the change +
returned by submit_and_route. A Standard change on a plain CI (or none) still
auto-approves. Direct function calls on an in-memory SQLite (mirrors
tests/test_change_wireup.py).
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-cab-exposure")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    AuditLog, GRCUser, HDApproval, HDApprovalVote, HDChangeRiskMatrix, HDChangeType,
    HDCIRelationship, HDCIRelationshipType, HDConfigurationItem, HDTicket, HDTicketCI,
)
from grc.modules.helpdesk_native import change as change_mod

TENANT = 1

TABLES = (
    HDTicket, HDApproval, HDApprovalVote, HDChangeType, HDChangeRiskMatrix,
    HDConfigurationItem, HDCIRelationshipType, HDCIRelationship, AuditLog, GRCUser,
    HDTicketCI,  # Batch 4 linkage B — the CAB exposure check now unions the bridge CIs
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    # every scenario is a Standard (pre-authorised) change type
    s.add(HDChangeType(tenant_id=TENANT, code="standard", name="Standard",
                       requires_cab=False, auto_approve=True))
    s.commit()
    yield s
    s.close()


def _ci(db, code, name, **kw):
    row = HDConfigurationItem(tenant_id=TENANT, code=code, name=name, **kw)
    db.add(row)
    db.commit()
    return row


def _std_change(db, ci_id=None):
    t = HDTicket(tenant_id=TENANT, subject="chg", process="change", status_category="Open",
                 approval_state="draft", change_type="standard", raised_by="raiser@x.com",
                 ci_id=ci_id)
    db.add(t)
    db.commit()
    return t


def _submit(db, t):
    return change_mod.submit_and_route(db, TENANT, t.id, "raiser@x.com")


# ═══════════════════════════════════════════════════════════════════════════
# escalation
# ═══════════════════════════════════════════════════════════════════════════
def test_standard_change_on_internet_facing_ci_escalates_to_cab(db):
    ci = _ci(db, "AVA-1", "www.ex.com",
             attributes={"ava": {"kind": "endpoint", "network": {"internet_facing": True}}})
    t = _std_change(db, ci_id=ci.id)
    res = _submit(db, t)
    assert res["cab"] is True and res["approval_state"] == "pending_approval"
    assert res["escalation_reason"] == "CAB required: CI is internet-facing"
    db.refresh(t)
    assert t.escalation_reason == "CAB required: CI is internet-facing"
    assert db.query(HDApproval).filter_by(ticket_id=t.id, state="pending").count() == 1


def test_standard_change_on_pci_ci_escalates_with_reason(db):
    ci = _ci(db, "AVA-2", "card-db",
             attributes={"ava": {"kind": "host", "compliance": {"pci": True}}})
    t = _std_change(db, ci_id=ci.id)
    res = _submit(db, t)
    assert res["cab"] is True
    assert res["escalation_reason"] == "CAB required: CI is PCI"


def test_standard_change_internet_and_pci_reason_combines(db):
    ci = _ci(db, "AVA-3", "pay.ex.com",
             attributes={"ava": {"kind": "endpoint", "network": {"internet_facing": True},
                                 "compliance": {"pci": True}}})
    t = _std_change(db, ci_id=ci.id)
    res = _submit(db, t)
    assert res["escalation_reason"] == "CAB required: CI is internet-facing + PCI"


def test_standard_change_escalates_when_descendant_endpoint_is_exposed(db):
    # a domain CI with no exposure of its own, but an endpoint under it is exposed
    domain = _ci(db, "CV-DOM-ex.com", "ex.com",
                 attributes={"ava": {"kind": "domain", "network": {"internet_facing": False}}})
    endpoint = _ci(db, "AVA-9", "www.ex.com",
                   attributes={"ava": {"kind": "endpoint", "network": {"internet_facing": True}}})
    contains = HDCIRelationshipType(tenant_id=TENANT, code="REL-CONTAINS", name="Contains")
    db.add(contains)
    db.commit()
    db.add(HDCIRelationship(source_ci_id=domain.id, target_ci_id=endpoint.id,
                            rel_type_id=contains.id))
    db.commit()
    t = _std_change(db, ci_id=domain.id)
    res = _submit(db, t)
    assert res["cab"] is True
    assert res["escalation_reason"] == "CAB required: CI is internet-facing"


# ═══════════════════════════════════════════════════════════════════════════
# no escalation (still auto-approves)
# ═══════════════════════════════════════════════════════════════════════════
def test_standard_change_on_plain_internal_ci_auto_approves(db):
    ci = _ci(db, "AVA-INT", "DESKTOP-1",
             attributes={"ava": {"kind": "host", "network": {"internet_facing": False},
                                 "compliance": {"pci": False}}})
    t = _std_change(db, ci_id=ci.id)
    res = _submit(db, t)
    assert res["cab"] is False and res.get("auto_approved") is True
    db.refresh(t)
    assert t.approval_state == "approved" and t.escalation_reason is None
    assert db.query(HDApproval).count() == 0


def test_standard_change_with_no_ci_auto_approves(db):
    t = _std_change(db, ci_id=None)
    res = _submit(db, t)
    assert res["cab"] is False and res.get("auto_approved") is True
    assert db.query(HDApproval).count() == 0


def test_standard_change_on_manual_ci_never_escalates(db):
    # a manual CI (no attributes.ava) carries no exposure → no escalation
    ci = _ci(db, "CI-MAN", "manual-box")
    t = _std_change(db, ci_id=ci.id)
    res = _submit(db, t)
    assert res["cab"] is False and res.get("auto_approved") is True
