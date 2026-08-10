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
    plan = db.query(VulnRemediationPlan).one()
    assert plan.status == "applied"          # engineering did the work
    assert plan.status != "verified"         # NOT verified — scanner's job
    assert plan.applied_at is not None


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
