"""Phase 5 — ITSM mobilisation wiring, hermetic (no live ServiceNow).

A fake TicketingAdapter stands in for ServiceNow so the WIRING is proven
independently of any instance: idempotent push (one ticket per vuln×
connection), and the safety boundary — a resolved ticket advances the
remediation plan to `applied`, NEVER `verified`.
"""
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import grc.services.itsm_service as itsm
from grc.models import (
    Vulnerability, IntegrationConnection, IntegrationAuditLog,
    VulnRemediationPlan, VulnTicketLink,
)
from grc.modules.connectors.base import TicketStatus

TENANT = 1


class FakeAdapter:
    """Records pushes; returns a canned status on fetch."""
    created = []
    next_status = "new"

    def create_ticket(self, request):
        ext = f"INC{1000 + len(FakeAdapter.created)}"
        FakeAdapter.created.append((ext, request.external_id))
        return ext

    def fetch_statuses(self, external_ids):
        return [TicketStatus(external_id=e, status="Resolved",
                             normalised_status=FakeAdapter.next_status,
                             resolved_at=datetime.utcnow()) for e in external_ids]


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite://")
    for m in (Vulnerability, IntegrationConnection, IntegrationAuditLog,
              VulnRemediationPlan, VulnTicketLink):
        m.__table__.create(engine)
    s = sessionmaker(bind=engine)()
    FakeAdapter.created = []
    FakeAdapter.next_status = "new"
    monkeypatch.setattr(itsm, "_build_adapter", lambda conn: FakeAdapter())
    yield s
    s.close()


def _seed(db):
    db.add(IntegrationConnection(id=1, tenant_id=TENANT, integration_type="servicenow",
                                 category="ticketing", connection_name="SN",
                                 console_url="https://x", is_active=True))
    v = Vulnerability(id=1, tenant_id=TENANT, vuln_id="V-1", title="t", severity="high", status="open")
    db.add(v)
    db.add(VulnRemediationPlan(id=1, tenant_id=TENANT, vulnerability_id=1, fix_type="patch",
                               title="p", summary="s", fix_artifact="a", rationale="r",
                               status="approved"))
    db.commit()
    return v, db.query(IntegrationConnection).get(1)


def test_push_creates_ticket_and_link(db):
    v, conn = _seed(db)
    r = itsm.push_finding(db, v, conn, user_id=7)
    db.commit()
    assert r["created"] is True and r["external_ticket_id"].startswith("INC")
    link = db.query(VulnTicketLink).one()
    assert link.external_ticket_id == r["external_ticket_id"]
    assert link.normalised_status == "new"


def test_push_is_idempotent(db):
    v, conn = _seed(db)
    r1 = itsm.push_finding(db, v, conn, user_id=7); db.commit()
    r2 = itsm.push_finding(db, v, conn, user_id=7); db.commit()
    assert r2["created"] is False
    assert r2["external_ticket_id"] == r1["external_ticket_id"]
    assert db.query(VulnTicketLink).count() == 1  # no duplicate
    assert len(FakeAdapter.created) == 1          # no duplicate ServiceNow incident


def test_resolved_ticket_advances_plan_to_applied_not_verified(db):
    v, conn = _seed(db)
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    FakeAdapter.next_status = "resolved"
    counts = itsm.sync_ticket_statuses(db, conn); db.commit()
    assert counts["resolved"] == 1 and counts["plans_advanced"] == 1
    plan = db.query(VulnRemediationPlan).filter_by(vulnerability_id=1).one()
    assert plan.status == "applied"          # engineering did the work
    assert plan.status != "verified"         # NOT verified — scanner's job
    assert plan.applied_at is not None


def test_closed_ticket_does_NOT_advance_plan(db):
    # ServiceNow `closed` conflates fixed / won't-fix / not-reproducible, so
    # advancing on it would record undone work as done. Resolved-only.
    v, conn = _seed(db)
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    FakeAdapter.next_status = "closed"
    counts = itsm.sync_ticket_statuses(db, conn); db.commit()
    assert counts["plans_advanced"] == 0
    assert db.query(VulnRemediationPlan).filter_by(vulnerability_id=1).one().status == "approved"


def test_push_no_owner_creates_recommended_plan_not_approved(db):
    # Owner gate (mirrors the manual approve endpoint): a finding with no owner
    # must NOT be auto-approved by the push — "an approved plan with no owner is
    # work nobody has been asked to do". The plan is still CREATED (so
    # mobilisation stays visible to the counter) but as `recommended`; approval
    # routes through the gate once an owner is assigned. Finding 2 has no owner.
    db.add(IntegrationConnection(id=2, tenant_id=TENANT, integration_type="servicenow",
                                 category="ticketing", connection_name="SN2",
                                 console_url="https://y", is_active=True))
    v = Vulnerability(id=2, tenant_id=TENANT, vuln_id="V-2", title="t2", severity="low", status="open")
    db.add(v); db.commit()
    assert db.query(VulnRemediationPlan).filter_by(vulnerability_id=2).count() == 0
    r = itsm.push_finding(db, v, db.query(IntegrationConnection).get(2), user_id=7)
    db.commit()
    assert r["plan_created"] is True
    plan = db.query(VulnRemediationPlan).filter_by(vulnerability_id=2).one()
    # created + counter-visible, but NOT approved (and no headless approver stamp)
    assert plan.status == "recommended"
    assert plan.approved_by_name is None
    assert plan.approved_at is None
    assert plan.source == "itsm"
    assert plan.title and plan.summary and plan.fix_artifact and plan.rationale  # no empty fields
    assert "SN2" in plan.summary  # still names the connector


def test_push_owned_finding_creates_approved_plan(db):
    # With an owner (an assignee here), pushing IS an accountable decision to fix
    # → the plan is auto-approved, system-attributed (never headless).
    db.add(IntegrationConnection(id=3, tenant_id=TENANT, integration_type="servicenow",
                                 category="ticketing", connection_name="SN3",
                                 console_url="https://z", is_active=True))
    v = Vulnerability(id=3, tenant_id=TENANT, vuln_id="V-3", title="t3", severity="high",
                      status="open", assigned_to=7)  # has an owner
    db.add(v); db.commit()
    r = itsm.push_finding(db, v, db.query(IntegrationConnection).get(3), user_id=7)
    db.commit()
    assert r["plan_created"] is True
    plan = db.query(VulnRemediationPlan).filter_by(vulnerability_id=3).one()
    assert plan.status == "approved"
    assert plan.approved_by_name and "ITSM push" in plan.approved_by_name  # not blank
    assert plan.approved_at is not None
    assert "SN3" in plan.summary  # names the connector


def test_push_reuses_existing_plan_no_second_plan(db):
    v, conn = _seed(db)  # _seed creates an approved plan already
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    # still exactly one plan — push did NOT create a duplicate
    assert db.query(VulnRemediationPlan).filter_by(vulnerability_id=1).count() == 1


def test_reopened_finding_can_reticket(db):
    v, conn = _seed(db)
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    FakeAdapter.next_status = "resolved"
    itsm.sync_ticket_statuses(db, conn); db.commit()  # link now resolved
    # finding reopens → a NEW push must be allowed (partial-live constraint)
    r = itsm.push_finding(db, v, conn, user_id=7); db.commit()
    assert r["created"] is True
    assert len(FakeAdapter.created) == 2                      # a second ticket
    links = db.query(VulnTicketLink).filter_by(vulnerability_id=1).all()
    assert len(links) == 2
    live = [l for l in links if l.resolved_at is None]
    assert len(live) == 1                                     # exactly one live


def test_status_sync_is_idempotent_on_plan(db):
    v, conn = _seed(db)
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    FakeAdapter.next_status = "resolved"
    itsm.sync_ticket_statuses(db, conn); db.commit()
    # a second sync must not re-advance / re-audit
    counts2 = itsm.sync_ticket_statuses(db, conn); db.commit()
    assert counts2["plans_advanced"] == 0
    advanced_audits = db.query(IntegrationAuditLog).filter(
        IntegrationAuditLog.action == "itsm.plan_advanced_applied").count()
    assert advanced_audits == 1


def test_open_ticket_does_not_touch_plan(db):
    v, conn = _seed(db)
    itsm.push_finding(db, v, conn, user_id=7); db.commit()
    FakeAdapter.next_status = "in_progress"
    counts = itsm.sync_ticket_statuses(db, conn); db.commit()
    assert counts["plans_advanced"] == 0
    assert db.query(VulnRemediationPlan).one().status == "approved"  # unchanged
