"""Seed a realistic demo governance-document portfolio so the Documents
dashboard formulas have data to compute against.

Everything is tagged: document codes start with ``DEMO-`` and exception titles
with ``[DEMO]``, so the set can be removed cleanly at any time.

Usage (from backend/):
    python seed_demo_governance_docs.py seed      [--tenant complyverse]
    python seed_demo_governance_docs.py cleanup   [--tenant complyverse]
"""
import argparse
import sys
from datetime import datetime, timedelta

from grc.models import (
    GRCUser, GovernanceDocument, DocumentApprovalStep, DocumentControlLink,
    PolicyReviewHistory, PolicyException, NormalizedControl, UploadedFramework,
    PolicyGapAnalysisRun, PolicyGapFinding,
    PolicyStatement, StatementControlMapping, DocumentSignature,
    DocumentSignoffAssignment, AttestationCampaign, AttestationRequest,
    GovernanceCommittee, CommitteeMember, CommitteeMeeting, MeetingMinutes,
    OversightAction,
    RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
    RegulatoryFeedSource, RegulatoryFeedItem,
)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants


def demo_doc_ids(db):
    rows = db.query(GovernanceDocument.id).filter(
        GovernanceDocument.document_code.like("DEMO-%")
    ).all()
    return [r.id for r in rows]


def cleanup(db):
    ids = demo_doc_ids(db)
    removed = {"gap_findings": 0, "gap_runs": 0, "control_links": 0,
               "approval_steps": 0, "review_history": 0, "exceptions": 0, "documents": 0,
               "statements": 0, "stmt_mappings": 0, "signatures": 0, "signoff_assignments": 0,
               "attestations": 0, "committees": 0}
    # demo committee + meetings + minutes + actions
    demo_committees = db.query(GovernanceCommittee).filter(
        GovernanceCommittee.name.like("[DEMO]%")).all()
    for com in demo_committees:
        db.query(CommitteeMember).filter(
            CommitteeMember.committee_id == com.id).delete(synchronize_session=False)
        meeting_ids = [m.id for m in db.query(CommitteeMeeting.id).filter(
            CommitteeMeeting.committee_id == com.id).all()]
        if meeting_ids:
            db.query(MeetingMinutes).filter(
                MeetingMinutes.meeting_id.in_(meeting_ids)).delete(synchronize_session=False)
        db.query(OversightAction).filter(
            OversightAction.committee_id == com.id).delete(synchronize_session=False)
        db.query(CommitteeMeeting).filter(
            CommitteeMeeting.committee_id == com.id).delete(synchronize_session=False)
        db.delete(com)
        removed["committees"] += 1
    # demo regulatory changes + assessments + tasks + feeds
    demo_changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.title.like("[DEMO]%")).all()
    for ch in demo_changes:
        db.query(RegulatoryImplementationTask).filter(
            RegulatoryImplementationTask.regulatory_change_id == ch.id).delete(synchronize_session=False)
        db.query(RegulatoryImpactAssessment).filter(
            RegulatoryImpactAssessment.regulatory_change_id == ch.id).delete(synchronize_session=False)
        db.query(RegulatoryFeedItem).filter(
            RegulatoryFeedItem.regulatory_change_id == ch.id
        ).update({"regulatory_change_id": None}, synchronize_session=False)
        db.delete(ch)
        removed["regulatory_changes"] = removed.get("regulatory_changes", 0) + 1
    demo_sources = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.name.like("[DEMO]%")).all()
    for src in demo_sources:
        db.query(RegulatoryFeedItem).filter(
            RegulatoryFeedItem.feed_source_id == src.id).delete(synchronize_session=False)
        db.delete(src)
        removed["feed_sources"] = removed.get("feed_sources", 0) + 1

    # demo attestation campaigns + requests
    demo_campaigns = db.query(AttestationCampaign).filter(
        AttestationCampaign.name.like("[DEMO]%")).all()
    for camp in demo_campaigns:
        removed["attestations"] += db.query(AttestationRequest).filter(
            AttestationRequest.campaign_id == camp.id).delete(synchronize_session=False)
        db.delete(camp)
    if ids:
        stmt_ids = [s.id for s in db.query(PolicyStatement.id).filter(
            PolicyStatement.document_id.in_(ids)).all()]
        if stmt_ids:
            removed["stmt_mappings"] = db.query(StatementControlMapping).filter(
                StatementControlMapping.statement_id.in_(stmt_ids)).delete(synchronize_session=False)
        removed["statements"] = db.query(PolicyStatement).filter(
            PolicyStatement.document_id.in_(ids)).delete(synchronize_session=False)
        removed["signatures"] = db.query(DocumentSignature).filter(
            DocumentSignature.document_id.in_(ids)).delete(synchronize_session=False)
        removed["signoff_assignments"] = db.query(DocumentSignoffAssignment).filter(
            DocumentSignoffAssignment.document_id.in_(ids)).delete(synchronize_session=False)
    if ids:
        removed["gap_findings"] = db.query(PolicyGapFinding).filter(
            PolicyGapFinding.document_id.in_(ids)).delete(synchronize_session=False)
        removed["gap_runs"] = db.query(PolicyGapAnalysisRun).filter(
            PolicyGapAnalysisRun.document_id.in_(ids)).delete(synchronize_session=False)
        removed["control_links"] = db.query(DocumentControlLink).filter(
            DocumentControlLink.document_id.in_(ids)).delete(synchronize_session=False)
        removed["approval_steps"] = db.query(DocumentApprovalStep).filter(
            DocumentApprovalStep.document_id.in_(ids)).delete(synchronize_session=False)
        removed["review_history"] = db.query(PolicyReviewHistory).filter(
            PolicyReviewHistory.document_id.in_(ids)).delete(synchronize_session=False)
    removed["exceptions"] = db.query(PolicyException).filter(
        PolicyException.title.like("[DEMO]%")).delete(synchronize_session=False)
    if ids:
        removed["documents"] = db.query(GovernanceDocument).filter(
            GovernanceDocument.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return removed


def seed(db, tenant_slug):
    # grc_policy_exceptions gained additive columns after this tenant was
    # provisioned; the API self-heals them lazily, so do the same here.
    from grc.routers.policy_exception_router import _ensure_columns
    _ensure_columns(db)

    now = datetime.utcnow()
    user = (db.query(GRCUser).filter(GRCUser.username == "admin").first()
            or db.query(GRCUser).first())
    if not user:
        sys.exit("No users found in tenant DB - cannot assign owners.")
    tid = get_user_tenants(user, db)[0]

    fw_rows = db.query(UploadedFramework.id, UploadedFramework.name).filter(
        UploadedFramework.is_active == True  # noqa: E712
    ).limit(2).all()
    fw_ids = [r.id for r in fw_rows]
    fw_name = fw_rows[0].name if fw_rows else "ISO 27001"
    controls = [r.id for r in db.query(NormalizedControl.id).limit(6).all()]

    def month_ago(n, day_offset=0):
        return now - timedelta(days=30 * n + day_offset)

    D = []  # (code, title, type, status, kwargs)
    docs_spec = [
        ("DEMO-POL-001", "Information Security Policy", "policy", "published",
         dict(created_at=month_ago(5), published_at=month_ago(4), effective_date=month_ago(4),
              next_review_date=now + timedelta(days=240), review_cycle_months=12,
              framework_ids=fw_ids[:1], classification="internal")),
        ("DEMO-POL-002", "Data Protection Policy", "policy", "published",
         dict(created_at=month_ago(5, 10), published_at=month_ago(4, 12),
              next_review_date=now - timedelta(days=12), review_cycle_months=6,
              classification="confidential")),
        ("DEMO-POL-003", "Access Control Policy", "policy", "published",
         dict(created_at=month_ago(4), published_at=month_ago(3),
              next_review_date=now + timedelta(days=100),
              expiry_date=now + timedelta(days=21), framework_ids=fw_ids,
              classification="internal")),
        ("DEMO-STD-004", "Password Standard", "standard", "published",
         dict(created_at=month_ago(4, 8), published_at=month_ago(3, 5),
              next_review_date=now + timedelta(days=20), review_cycle_months=12)),
        ("DEMO-STD-005", "Encryption Standard", "standard", "approved",
         dict(created_at=month_ago(3), next_review_date=now + timedelta(days=45),
              framework_ids=fw_ids[:1])),
        ("DEMO-PRC-006", "Incident Response Procedure", "procedure", "published",
         dict(created_at=month_ago(3, 6), published_at=month_ago(2),
              next_review_date=now + timedelta(days=75))),
        ("DEMO-PRC-007", "Backup and Recovery Procedure", "procedure", "draft",
         dict(created_at=month_ago(2))),
        ("DEMO-GDL-008", "Remote Work Guideline", "guideline", "pending_review",
         dict(created_at=month_ago(2, 10), framework_ids=fw_ids[:1])),
        ("DEMO-CHR-009", "GRC Committee Charter", "charter", "pending_approval",
         dict(created_at=month_ago(1, 15))),
        ("DEMO-FRW-010", "Internal Control Framework", "framework", "published",
         dict(created_at=month_ago(1), published_at=now - timedelta(days=9),
              next_review_date=now + timedelta(days=300), framework_ids=fw_ids)),
        ("DEMO-POL-011", "Acceptable Use Policy", "policy", "expired",
         dict(created_at=month_ago(5, 20), expiry_date=now - timedelta(days=30))),
        ("DEMO-POL-012", "Vendor Management Policy", "policy", "pending_approval",
         dict(created_at=now - timedelta(days=12))),
    ]
    for code, title, dtype, status, kw in docs_spec:
        doc = GovernanceDocument(
            tenant_id=tid, document_code=code, title=title, doc_type=dtype,
            status=status, owner_id=user.id, author_id=user.id,
            published_by=user.id if kw.get("published_at") else None, **kw)
        db.add(doc)
        D.append(doc)
    db.flush()
    doc = {d.document_code: d for d in D}

    # control links (mapping coverage)
    link_map = [("DEMO-POL-001", 0), ("DEMO-POL-001", 1), ("DEMO-POL-002", 2),
                ("DEMO-STD-004", 3), ("DEMO-PRC-006", 4), ("DEMO-FRW-010", 5)]
    for code, idx in link_map:
        if idx < len(controls):
            db.add(DocumentControlLink(document_id=doc[code].id,
                                       normalized_control_id=controls[idx],
                                       link_type="implements", created_by=user.id))

    # approval steps: 2 pending (1 overdue), 4 approved + 1 rejected in last 90d
    db.add(DocumentApprovalStep(document_id=doc["DEMO-CHR-009"].id, step_sequence=1,
                                step_name="Compliance sign-off", status="pending",
                                approver_id=user.id,
                                requested_at=now - timedelta(days=14),
                                due_date=now - timedelta(days=4)))
    db.add(DocumentApprovalStep(document_id=doc["DEMO-POL-012"].id, step_sequence=1,
                                step_name="CISO approval", status="pending",
                                approver_id=user.id,
                                requested_at=now - timedelta(days=3),
                                due_date=now + timedelta(days=4)))
    decided = [("DEMO-POL-001", 60, 4, "approved"), ("DEMO-POL-003", 45, 6, "approved"),
               ("DEMO-STD-004", 30, 3, "approved"), ("DEMO-FRW-010", 12, 7, "approved"),
               ("DEMO-PRC-007", 20, 5, "rejected")]
    for code, days_back, cycle, status in decided:
        req = now - timedelta(days=days_back)
        db.add(DocumentApprovalStep(document_id=doc[code].id, step_sequence=1,
                                    step_name="Management approval", status=status,
                                    approver_id=user.id, requested_at=req,
                                    due_date=req + timedelta(days=10),
                                    completed_at=req + timedelta(days=cycle)))

    # review history: 6 completed in last year, 4 on time + 2 late
    reviews = [("DEMO-POL-001", 200, 0), ("DEMO-POL-002", 170, 9),
               ("DEMO-POL-003", 140, 0), ("DEMO-STD-004", 100, 0),
               ("DEMO-PRC-006", 70, 15), ("DEMO-FRW-010", 40, 0)]
    for code, sched_back, late_by in reviews:
        sched = now - timedelta(days=sched_back)
        db.add(PolicyReviewHistory(tenant_id=tid, document_id=doc[code].id,
                                   review_type="periodic", review_status="completed",
                                   scheduled_date=sched,
                                   completed_at=sched + timedelta(days=late_by),
                                   reviewer_id=user.id, outcome="reviewed"))

    # exceptions: pending, approved-expiring, approved-active
    db.add(PolicyException(tenant_id=tid, document_id=doc["DEMO-POL-002"].id,
                           title="[DEMO] Legacy system exempt from encryption-at-rest",
                           status="pending_approval", priority="high",
                           requested_by=user.id))
    db.add(PolicyException(tenant_id=tid, document_id=doc["DEMO-POL-003"].id,
                           title="[DEMO] Shared account for plant floor terminal",
                           status="approved", priority="medium", approved_by=user.id,
                           approved_at=now - timedelta(days=80),
                           expiry_date=now + timedelta(days=12)))
    db.add(PolicyException(tenant_id=tid, document_id=doc["DEMO-POL-001"].id,
                           title="[DEMO] Extended password rotation for service accounts",
                           status="approved", priority="low", approved_by=user.id,
                           approved_at=now - timedelta(days=30),
                           expiry_date=now + timedelta(days=200)))

    # one completed gap-analysis run with 3 open findings
    run = PolicyGapAnalysisRun(
        tenant_id=tid, document_id=doc["DEMO-POL-001"].id,
        uploaded_framework_id=fw_ids[0] if fw_ids else None, framework_name=fw_name,
        status="completed", total_clauses_analyzed=24, fully_compliant_count=18,
        partially_compliant_count=4, not_addressed_count=2, compliance_percentage=75.0,
        started_at=now - timedelta(days=6), completed_at=now - timedelta(days=6),
        created_by=user.id)
    db.add(run)
    db.flush()
    gaps = [("A.5.7 Threat intelligence", "high", "not_addressed", "open"),
            ("A.8.16 Monitoring activities", "medium", "partially_compliant", "open"),
            ("A.6.3 Awareness training cadence", "low", "partially_compliant", "open"),
            ("A.5.10 Acceptable use of assets", "medium", "partially_compliant", "closed"),
            ("A.7.4 Physical security monitoring", "low", "partially_compliant", "accepted_risk")]
    for clause, sev, comp, rem in gaps:
        db.add(PolicyGapFinding(tenant_id=tid, analysis_run_id=run.id,
                                document_id=doc["DEMO-POL-001"].id,
                                uploaded_framework_id=fw_ids[0] if fw_ids else None,
                                framework_name=fw_name, clause_reference=clause,
                                compliance_status=comp, risk_severity=sev,
                                remediation_status=rem,
                                gap_description=f"Demo gap for {clause}"))

    # document body content (content_readiness metric) - all but two drafts
    for code in ["DEMO-POL-001", "DEMO-POL-002", "DEMO-POL-003", "DEMO-STD-004",
                 "DEMO-STD-005", "DEMO-PRC-006", "DEMO-GDL-008", "DEMO-FRW-010",
                 "DEMO-POL-011", "DEMO-POL-012"]:
        doc[code].content = (f"# {doc[code].title}\n\n1. Purpose\nThis {doc[code].doc_type} "
                             "defines mandatory requirements.\n\n2. Scope\nAll staff and systems.")

    # parsed policy statements (statement_extraction) + statement-control
    # mappings (statement_coverage / mapping_quality)
    stmt_specs = [
        ("DEMO-POL-001", 3), ("DEMO-POL-002", 2), ("DEMO-POL-003", 2),
        ("DEMO-STD-004", 2), ("DEMO-PRC-006", 1),
    ]
    statements = []
    for code, n in stmt_specs:
        for i in range(n):
            s = PolicyStatement(tenant_id=tid, document_id=doc[code].id,
                                statement_code=f"{code}-PS-{i+1:03d}",
                                statement_text=f"Requirement {i+1} of {doc[code].title}.",
                                category="security", status="active")
            db.add(s)
            statements.append(s)
    db.flush()
    # map 7 of 10 statements to controls; 4 full / 3 partial
    for i, s in enumerate(statements[:7]):
        db.add(StatementControlMapping(
            tenant_id=tid, statement_id=s.id, control_kind="normalized",
            normalized_control_id=controls[i % len(controls)] if controls else None,
            coverage_type="full" if i < 4 else "partial", confidence=0.9))

    # sign-off flow (signoff_integrity): approver signatures on 4 of 6 published
    for code in ["DEMO-POL-001", "DEMO-POL-003", "DEMO-STD-004", "DEMO-FRW-010"]:
        db.add(DocumentSignoffAssignment(tenant_id=tid, document_id=doc[code].id,
                                         role_type="approver", target_type="user",
                                         target_id=user.id, added_by=user.id))
        db.add(DocumentSignature(tenant_id=tid, document_id=doc[code].id,
                                 signer_user_id=user.id, role_type="approver",
                                 role_label="CISO", decision="signed",
                                 signature_text=user.username,
                                 signed_at=now - timedelta(days=25)))

    # a closed-on-time exception (closure_timeliness)
    db.add(PolicyException(tenant_id=tid, document_id=doc["DEMO-STD-004"].id,
                           title="[DEMO] Temporary MFA bypass for migration window",
                           status="expired", priority="high", approved_by=user.id,
                           approved_at=now - timedelta(days=120),
                           expiry_date=now - timedelta(days=60),
                           closed_at=now - timedelta(days=65)))

    # attestation campaign + requests (completion / overdue containment)
    camp = AttestationCampaign(tenant_id=tid, name="[DEMO] Annual Policy Acknowledgment",
                               campaign_type="policy_signoff", status="active",
                               start_date=now - timedelta(days=20),
                               due_date=now + timedelta(days=10),
                               target_type="all_users")
    db.add(camp)
    db.flush()
    att_users = db.query(GRCUser.id).limit(5).all()
    for i, (uid,) in enumerate(att_users):
        completed = i < 3  # 3 completed, 1 pending, 1 overdue
        db.add(AttestationRequest(
            tenant_id=tid, campaign_id=camp.id, user_id=uid,
            attestation_type="policy_signoff",
            status="completed" if completed else ("overdue" if i == 4 else "pending"),
            assigned_at=now - timedelta(days=20),
            due_date=now - timedelta(days=2) if i == 4 else now + timedelta(days=10),
            completed_at=now - timedelta(days=5) if completed else None))

    # governance committee + meetings + minutes + oversight actions
    com = GovernanceCommittee(tenant_id=tid, name="[DEMO] GRC Steering Committee",
                              committee_type="risk_committee", chair_id=user.id,
                              meeting_frequency="monthly", is_active=True)
    db.add(com)
    db.flush()
    # 5 members so attendance has a real base (4 attendees / 5 members = 80%)
    member_ids = [user.id] + [uid for (uid,) in db.query(GRCUser.id).filter(
        GRCUser.id != user.id).limit(4).all()]
    for i, uid in enumerate(member_ids):
        db.add(CommitteeMember(tenant_id=tid, committee_id=com.id, user_id=uid,
                               role="chair" if i == 0 else "member", is_active=True))
    held = CommitteeMeeting(tenant_id=tid, committee_id=com.id, meeting_number="2026-06",
                            title="June oversight meeting", meeting_type="regular",
                            scheduled_date=now - timedelta(days=20), status="completed",
                            quorum_required=3, quorum_present=4, created_by=user.id)
    db.add(held)
    db.add(CommitteeMeeting(tenant_id=tid, committee_id=com.id, meeting_number="2026-07",
                            title="July oversight meeting", meeting_type="regular",
                            scheduled_date=now + timedelta(days=15), status="scheduled",
                            created_by=user.id))
    db.flush()
    db.add(MeetingMinutes(tenant_id=tid, meeting_id=held.id,
                          content="Reviewed policy exceptions and gaps.",
                          status="approved", drafted_by=user.id,
                          drafted_at=now - timedelta(days=19)))
    actions = [("Close encryption exception", "open", now + timedelta(days=14), None),
               ("Remediate ISO A.5.7 gap", "in_progress", now + timedelta(days=30), None),
               ("Approve committee charter refresh", "open", now - timedelta(days=5), None),
               ("Distribute updated security policy", "completed",
                now - timedelta(days=10), now - timedelta(days=12))]
    for i, (title, status, due, done_at) in enumerate(actions):
        db.add(OversightAction(tenant_id=tid, committee_id=com.id, meeting_id=held.id,
                               action_number=f"DEMO-A-{i+1:02d}", title=title,
                               action_type="follow_up", status=status, due_date=due,
                               completed_at=done_at,
                               assigned_to=user.id, created_by=user.id))

    # regulatory changes: 1 resolved, 1 assessed + in implementation, 1 untouched
    ch_done = RegulatoryChange(tenant_id=tid, title="[DEMO] PDPL amendment - retention limits",
                               source="custom", status="completed", priority="high",
                               published_date=now - timedelta(days=120),
                               effective_date=now - timedelta(days=30),
                               created_by=user.id, closed_at=now - timedelta(days=35))
    ch_impl = RegulatoryChange(tenant_id=tid, title="[DEMO] SAMA cyber circular update",
                               source="custom", status="implementation", priority="critical",
                               published_date=now - timedelta(days=45),
                               effective_date=now + timedelta(days=60), created_by=user.id)
    ch_new = RegulatoryChange(tenant_id=tid, title="[DEMO] NCA cloud controls addendum",
                              source="custom", status="identified", priority="medium",
                              published_date=now - timedelta(days=7), created_by=user.id)
    db.add_all([ch_done, ch_impl, ch_new])
    db.flush()
    db.add(RegulatoryImpactAssessment(tenant_id=tid, regulatory_change_id=ch_done.id,
                                      assessment_type="policy", impact_level="high",
                                      gap_identified=False, assessed_by=user.id))
    db.add(RegulatoryImpactAssessment(tenant_id=tid, regulatory_change_id=ch_impl.id,
                                      assessment_type="policy", impacted_item_type="policy",
                                      impacted_item_id=doc["DEMO-POL-001"].id,
                                      impact_level="high", gap_identified=True,
                                      gap_description="Policy lacks cloud incident SLAs",
                                      assessed_by=user.id))
    reg_tasks = [(ch_done.id, "Update retention schedule", "completed", now - timedelta(days=40)),
                 (ch_impl.id, "Draft cloud incident SLA clause", "in_progress", now + timedelta(days=20)),
                 (ch_impl.id, "Notify control owners", "pending", now - timedelta(days=3))]
    for cid, title, status, due in reg_tasks:
        db.add(RegulatoryImplementationTask(tenant_id=tid, regulatory_change_id=cid,
                                            title=title, task_type="policy_update",
                                            status=status, due_date=due,
                                            assigned_to=user.id))
    src = RegulatoryFeedSource(tenant_id=tid, name="[DEMO] Central Bank circulars",
                               source_url="https://example.org/rss", source_type="rss",
                               regulator="Central Bank", is_active=True,
                               poll_interval_hours=24,
                               last_polled_at=now - timedelta(hours=6),
                               last_successful_poll=now - timedelta(hours=6),
                               items_processed=4)
    db.add(src)
    db.flush()
    feed_items = [("Circular 2026-14: outsourcing rules", "processed", ch_impl.id),
                  ("Circular 2026-15: FX reporting", "processed", None),
                  ("Press release: governor speech", "ignored", None),
                  ("Circular 2026-16: cloud guidance", "new", None)]
    for i, (title, status, change_id) in enumerate(feed_items):
        db.add(RegulatoryFeedItem(tenant_id=tid, feed_source_id=src.id,
                                  guid=f"demo-feed-{i+1}", title=title, status=status,
                                  regulatory_change_id=change_id,
                                  published_date=now - timedelta(days=10 - i),
                                  processed_at=now - timedelta(days=2) if status != "new" else None))

    db.commit()
    return len(docs_spec)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["seed", "cleanup"])
    p.add_argument("--tenant", default="complyverse")
    args = p.parse_args()

    db = open_tenant_session(args.tenant)
    try:
        if args.command == "cleanup":
            removed = cleanup(db)
            print("Removed:", removed)
        else:
            removed = cleanup(db)  # idempotent: clear any previous demo set first
            n = seed(db, args.tenant)
            print(f"Seeded {n} demo documents (+ links, approvals, reviews, "
                  f"exceptions, gap findings) into tenant '{args.tenant}'.")
            print("Previous demo rows removed:", removed)
    finally:
        db.close()


if __name__ == "__main__":
    main()
