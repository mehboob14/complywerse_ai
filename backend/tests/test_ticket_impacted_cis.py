"""Impacted-CI linkage (Batch 4 linkage B) —
grc/modules/helpdesk_native/ticket_cis.py + the CAB exposure union in
approvals.requirements_for_change.

Covers: add/list/remove (idempotent), validation (cross-tenant / retired 400),
impacted_ci_ids (primary + bridge), and — the point of the linkage — a Standard
change escalates to CAB when ANY *impacted* CI is internet-facing / PCI even
though its PRIMARY CI is not (or it has no primary CI). Harness mirrors
tests/test_change_cab_exposure.py: in-memory SQLite, direct function calls.
"""
import os

os.environ.setdefault("SESSION_SECRET", "test-impacted-cis")

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from grc.models import (
    AuditLog, GRCUser, HDApproval, HDApprovalVote, HDChangeRiskMatrix, HDChangeType,
    HDCIRelationship, HDCIRelationshipType, HDConfigurationItem, HDTicket, HDTicketCI,
)
from grc.modules.helpdesk_native import change as change_mod, ticket_cis

TENANT = 1
OTHER = 2

TABLES = (
    HDTicket, HDApproval, HDApprovalVote, HDChangeType, HDChangeRiskMatrix,
    HDConfigurationItem, HDCIRelationshipType, HDCIRelationship, HDTicketCI,
    AuditLog, GRCUser,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    for t in TABLES:
        t.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    s.add(HDChangeType(tenant_id=TENANT, code="standard", name="Standard",
                       requires_cab=False, auto_approve=True))
    s.commit()
    yield s
    s.close()


def _ci(db, code, name, tenant=TENANT, **kw):
    row = HDConfigurationItem(tenant_id=tenant, code=code, name=name, **kw)
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


# ═══════════════════════════════════════════════════════════════════════════
# add / list / remove / validate
# ═══════════════════════════════════════════════════════════════════════════
def test_add_list_remove_impacted_ci(db):
    chg = _std_change(db)
    ci = _ci(db, "CI-1", "HOST-1")
    assert ticket_cis.add_impacted(db, TENANT, str(chg.id), ci.id)["ok"] is True

    impacted = ticket_cis.list_impacted(db, TENANT, chg)
    assert [c["id"] for c in impacted] == [ci.id]

    # idempotent: a second add does not duplicate the row
    ticket_cis.add_impacted(db, TENANT, str(chg.id), ci.id)
    assert db.query(HDTicketCI).count() == 1

    ticket_cis.remove_impacted(db, TENANT, str(chg.id), ci.id)
    assert ticket_cis.list_impacted(db, TENANT, chg) == []
    # idempotent remove
    assert ticket_cis.remove_impacted(db, TENANT, str(chg.id), ci.id)["ok"] is True


def test_add_cross_tenant_ci_400(db):
    chg = _std_change(db)
    theirs = _ci(db, "CI-X", "theirs", tenant=OTHER)
    with pytest.raises(HTTPException) as exc:
        ticket_cis.add_impacted(db, TENANT, str(chg.id), theirs.id)
    assert exc.value.status_code == 400


def test_add_retired_ci_400(db):
    chg = _std_change(db)
    dead = _ci(db, "CI-R", "dead", status="retired")
    with pytest.raises(HTTPException) as exc:
        ticket_cis.add_impacted(db, TENANT, str(chg.id), dead.id)
    assert exc.value.status_code == 400


def test_impacted_ci_ids_unions_primary_and_bridge(db):
    primary = _ci(db, "CI-P", "primary")
    extra = _ci(db, "CI-E", "extra")
    chg = _std_change(db, ci_id=primary.id)
    ticket_cis.add_impacted(db, TENANT, str(chg.id), extra.id)
    # adding the primary again via the bridge must not double-count
    ticket_cis.add_impacted(db, TENANT, str(chg.id), primary.id)
    assert ticket_cis.impacted_ci_ids(db, TENANT, chg) == {primary.id, extra.id}


# ═══════════════════════════════════════════════════════════════════════════
# CAB exposure union — the point of the linkage
# ═══════════════════════════════════════════════════════════════════════════
def test_exposure_union_escalates_when_an_impacted_ci_is_exposed(db):
    # primary CI is internal/plain → would auto-approve; an IMPACTED bridge CI is
    # internet-facing → must escalate to CAB.
    primary = _ci(db, "CI-INT", "DESKTOP",
                  attributes={"ava": {"kind": "host", "network": {"internet_facing": False}}})
    exposed = _ci(db, "CI-EXT", "www.ex.com",
                  attributes={"ava": {"kind": "endpoint", "network": {"internet_facing": True}}})
    chg = _std_change(db, ci_id=primary.id)
    ticket_cis.add_impacted(db, TENANT, str(chg.id), exposed.id)

    res = change_mod.submit_and_route(db, TENANT, chg.id, "raiser@x.com")
    assert res["cab"] is True and res["approval_state"] == "pending_approval"
    assert res["escalation_reason"] == "CAB required: CI is internet-facing"
    db.refresh(chg)
    assert chg.escalation_reason == "CAB required: CI is internet-facing"


def test_exposure_union_escalates_with_no_primary_ci(db):
    # no primary CI at all, but an impacted PCI CI → escalate.
    pci = _ci(db, "CI-PCI", "card-db",
              attributes={"ava": {"kind": "host", "compliance": {"pci": True}}})
    chg = _std_change(db, ci_id=None)
    ticket_cis.add_impacted(db, TENANT, str(chg.id), pci.id)

    res = change_mod.submit_and_route(db, TENANT, chg.id, "raiser@x.com")
    assert res["cab"] is True
    assert res["escalation_reason"] == "CAB required: CI is PCI"


def test_no_impacted_ci_still_auto_approves(db):
    # primary internal + no exposed impacted CI → still auto-approves (regression).
    primary = _ci(db, "CI-OK", "box",
                  attributes={"ava": {"kind": "host", "network": {"internet_facing": False},
                                      "compliance": {"pci": False}}})
    chg = _std_change(db, ci_id=primary.id)
    res = change_mod.submit_and_route(db, TENANT, chg.id, "raiser@x.com")
    assert res["cab"] is False and res.get("auto_approved") is True


def test_impacted_cis_tenant_isolated_in_list(db):
    # a bridge row for another tenant's ticket id must not leak into this tenant.
    chg = _std_change(db)
    ci = _ci(db, "CI-T", "host")
    db.add(HDTicketCI(tenant_id=OTHER, ticket_id=chg.id, ci_id=ci.id))
    db.commit()
    assert ticket_cis.list_impacted(db, TENANT, chg) == []
