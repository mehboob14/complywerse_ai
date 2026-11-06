"""The governance overview counts what the platform writes now: documents waiting in review or approval, the per-person review,
approval and acknowledgement requests (grc_document_obligations) and the attestation campaigns - not the legacy approval steps and
attestation tables nothing writes any more. On-time reviews cannot be measured yet, and the payload says so instead of a number.
Over HTTP through the whole governance router, on in-memory SQLite."""
from datetime import datetime, timedelta

import grc.models as m
from grc.modules.governance.routers.dashboard import ON_TIME_NO_DATA

from test_document_read_access import VIEWER, as_, reads  # noqa: F401  (reads is a fixture)
from test_governance_permissions import ADMIN, AUTHOR, CONTACT, EDITOR, OWNER, PUBLISHER, SAM, doc, world  # noqa: F401


def _metric(section, key):
    return next(x for x in section["metrics"] if x["key"] == key)


def test_the_overview_reads_the_live_requests_and_says_what_it_cannot_measure(reads):
    db, now = reads.db, datetime.utcnow()
    db.get(m.GovernanceDocument, 5).status = "pending_approval"
    db.get(m.GovernanceDocument, 6).status = "pending_review"
    ob = lambda **kw: m.DocumentObligation(tenant_id=1, **kw)  # noqa: E731
    db.add_all([
        ob(document_id=6, kind="review", user_id=EDITOR, status="pending", due_date=now - timedelta(days=2)),          # overdue
        ob(document_id=5, kind="approval", user_id=PUBLISHER, status="pending", due_date=now + timedelta(days=5)),
        ob(document_id=5, kind="approval", user_id=SAM, status="done", requested_at=now - timedelta(days=12), done_at=now - timedelta(days=10)),
        ob(document_id=5, kind="review", user_id=AUTHOR, status="rejected", requested_at=now - timedelta(days=6), done_at=now - timedelta(days=5)),
        ob(document_id=5, kind="review", user_id=CONTACT, status="cancelled"),                                        # withdrawn: no decision
        ob(document_id=5, kind="acknowledgement", user_id=OWNER, status="pending", due_date=now - timedelta(days=1)),
        ob(document_id=5, kind="acknowledgement", user_id=SAM, status="done", done_at=now),
        ob(document_id=5, kind="acknowledgement", user_id=EDITOR, status="cancelled"),
        m.DocumentApprovalStep(document_id=5, step_sequence=1, step_name="Legacy", approver_id=OWNER, status="pending"),  # nothing writes these now
        m.DocumentAttestationCampaign(tenant_id=1, document_id=5, name="Q3", status="active", public_token="t1"),
        m.DocumentAuditLog(document_id=5, tenant_id=1, action="reviewed", field_changed="last_reviewed_at", performed_by=OWNER,
                           performed_at=now - timedelta(days=30)),                                                    # a review done
        m.DocumentAuditLog(document_id=5, tenant_id=1, action="review_completed", performed_by=OWNER, performed_at=now - timedelta(days=400)),
    ])
    db.commit()

    http = as_(reads, ADMIN)
    pending = http.get("/governance/dashboard/pending-approvals").json()
    assert pending["count"] == 2
    assert {(a["step_name"], a["approver_id"], a["is_overdue"]) for a in pending["approvals"]} == {("Review", EDITOR, True), ("Approval", PUBLISHER, False)}
    assert as_(reads, VIEWER).get("/governance/dashboard/pending-approvals").json()["count"] == 0     # drafts never published

    overview = as_(reads, ADMIN).get("/governance/dashboard/documents-overview").json()
    approvals, reviews, attest = (overview["sections"][k] for k in ("approvals", "reviews", "attestations"))
    assert {k: approvals["counts"][k] for k in ("pending_steps", "overdue_steps", "documents_awaiting", "approved_90d", "rejected_90d",
                                                 "avg_decision_days")} == {"pending_steps": 2, "overdue_steps": 1, "documents_awaiting": 2,
                                                                           "approved_90d": 1, "rejected_90d": 1, "avg_decision_days": 1.5}
    assert (_metric(approvals, "queue_health")["score"], _metric(approvals, "decision_rate")["score"]) == (50.0, 50.0)
    assert overview["attention_queue"]["documents_awaiting_approval"] == 2

    assert {k: attest["counts"][k] for k in ("requests_12m", "completed", "open", "overdue", "active_campaigns")} == {
        "requests_12m": 2, "completed": 1, "open": 1, "overdue": 1, "active_campaigns": 1}
    assert _metric(attest, "acknowledgement_rate")["score"] == 50.0 and overview["attention_queue"]["overdue_attestations"] == 1
    evidence = _metric(attest, "evidence_linkage")
    assert evidence["score"] is None and evidence["no_data"] is True

    on_time = _metric(reviews, "on_time_rate")
    assert (on_time["score"], on_time["no_data"], on_time["note"]) == (None, True, ON_TIME_NO_DATA)
    assert reviews["counts"]["completed_365d"] == 1                                       # the review 30 days ago, not the one 400 days ago
