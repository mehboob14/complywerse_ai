"""Integration tests for the TPRA lifecycle service against a real (SQLite) DB.

Exercises the normalized models + service end to end: stage instantiation, gate
blocking, tiering, scoring auto-findings, the findings gate, soft-delete,
send-back invalidation, versioned reassessment (no history loss), RBAC deny, and
audit logging. Uses an in-memory SQLite DB with only the tables the service
touches (FKs to uncreated tables are inert on SQLite).
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, GRCUser, Role, Permission, RolePermission, UserRole, Risk,
    Vendor, VendorAssessment,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
    TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAControlObligation,
    TPRAApproval, TPRAMonitoringSignal, TPRAAuditLog, TPRATieringConfig, TPRARiskDomain,
    TPRARiskSnapshot,
)
from grc.modules.vendor_risk.tpra import service, rbac
from grc.modules.vendor_risk.tpra.engine_snapshots import write_portfolio_snapshot

_TABLES = [
    Tenant, GRCUser, Role, Permission, RolePermission, UserRole, Risk,
    Vendor, VendorAssessment,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
    TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAControlObligation,
    TPRAApproval, TPRAMonitoringSignal, TPRAAuditLog, TPRATieringConfig, TPRARiskDomain,
    TPRARiskSnapshot,
]


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    Session = sessionmaker(bind=engine)
    s = Session()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


def _vendor(db, **kw):
    defaults = dict(
        tenant_id=1, name="Acme Cloud", tier="high", status="active",
        data_access_level="confidential", data_types_accessed=["PII"], owner_id=7,
    )
    defaults.update(kw)
    v = Vendor(**defaults)
    db.add(v)
    db.commit()
    return v


# ── Stage instantiation + gate-blocked advance ───────────────────────────────

def test_ensure_active_assessment_creates_11_stages(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    stages = service.get_stage_instances(db, a.id)
    assert len(stages) == 11
    assert stages[0].stage_key == "intake" and stages[0].status == "in_progress"
    assert all(s.status == "not_started" for s in stages[1:])
    assert v.active_assessment_id == a.id


def test_advance_blocked_when_intake_incomplete(db):
    v = _vendor(db, owner_id=None)  # no business owner
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    res = service.advance_stage(db, v, a, actor_id=1)
    assert res["advanced"] is False
    assert any("owner" in b.lower() for b in res["blockers"])


def test_advance_through_intake_when_complete(db):
    v = _vendor(db)  # has name + owner + classification
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    res = service.advance_stage(db, v, a, actor_id=1)
    db.commit()
    assert res["advanced"] is True
    assert res["to"] == "tiering"
    assert a.current_stage == "tiering"


# ── Tiering gate ─────────────────────────────────────────────────────────────

def test_run_tiering_sets_tier_and_unblocks_gate(db):
    v = _vendor(db, data_access_level="restricted", data_types_accessed=["PII", "financial"])
    a = service.ensure_active_assessment(db, v, actor_id=1)
    a.current_stage = "tiering"
    db.commit()
    # Gate blocked before tiering is run.
    assert service.evaluate_current(db, v, a, "tiering")["passed"] is False
    result = service.run_tiering(db, v, a, actor_id=1)
    db.commit()
    assert result["tier"] in ("high", "critical")
    assert a.inherent_tier == result["tier"]
    # Now the tiering gate passes.
    assert service.evaluate_current(db, v, a, "tiering")["passed"] is True


# ── Scoring auto-findings + findings gate ────────────────────────────────────

def _add_question_and_response(db, a, answer, critical=True, domain="cybersecurity"):
    q = TPRAQuestion(tenant_id=1, template_id=1, question_key="mfa", text="MFA enforced?",
                     domain=domain, qtype="yes_no", weight=2.0, critical_control=critical)
    db.add(q)
    db.flush()
    db.add(TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=q.id,
                                question_key="mfa", answer=answer))
    db.flush()
    return q


def test_scoring_creates_blocking_critical_finding_and_gate_blocks(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="No", critical=True)
    db.commit()

    result = service.run_scoring(db, v, a, actor_id=1)
    db.commit()
    assert result["findings_created"] == 1
    assert a.residual_score is not None
    # A critical finding now blocks the findings gate.
    assert service.count_open_critical(db, a.id) == 1
    assert service.evaluate_current(db, v, a, "findings")["passed"] is False


def test_scoring_idempotent_findings(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="No", critical=True)
    db.commit()
    service.run_scoring(db, v, a, actor_id=1)
    db.commit()
    service.run_scoring(db, v, a, actor_id=1)  # re-run
    db.commit()
    assert db.query(TPRAFinding).filter(TPRAFinding.assessment_id == a.id).count() == 1


def test_remediation_completion_unblocks_findings_gate(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="No", critical=True)
    db.commit()
    service.run_scoring(db, v, a, actor_id=1)
    db.commit()
    finding = db.query(TPRAFinding).filter(TPRAFinding.assessment_id == a.id).first()
    rem = TPRARemediation(tenant_id=1, finding_id=finding.id, title="Roll out MFA",
                          status="completed")
    db.add(rem)
    db.commit()
    assert service.count_open_critical(db, a.id) == 0


def test_risk_acceptance_unblocks_findings_gate(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="No", critical=True)
    db.commit()
    service.run_scoring(db, v, a, actor_id=1)
    db.commit()
    finding = db.query(TPRAFinding).filter(TPRAFinding.assessment_id == a.id).first()
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=finding.id, rationale="Accepted",
                              status="active"))
    db.commit()
    assert service.count_open_critical(db, a.id) == 0


# ── Send-back invalidation ───────────────────────────────────────────────────

def test_send_back_invalidates_downstream(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    # Force a few stages complete and move current to "scoring".
    for s in service.get_stage_instances(db, a.id):
        if s.stage_order <= 5:
            s.status = "complete"
    a.current_stage = "scoring"
    db.commit()
    res = service.send_back(db, v, a, target_stage="questionnaire", actor_id=1, reason="missing evidence")
    db.commit()
    assert res["sent_back_to"] == "questionnaire"
    stages = {s.stage_key: s for s in service.get_stage_instances(db, a.id)}
    assert stages["questionnaire"].status == "in_progress"
    assert stages["scoring"].status == "not_started"  # downstream invalidated
    assert a.current_stage == "questionnaire"


def test_send_back_rejects_forward_target(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    a.current_stage = "intake"
    db.commit()
    with pytest.raises(ValueError):
        service.send_back(db, v, a, target_stage="approval", actor_id=1, reason="x")


# ── Versioned reassessment (no history loss) ─────────────────────────────────

def test_reassessment_supersedes_without_losing_history(db):
    v = _vendor(db)
    a1 = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a1, actor_id=1)
    db.commit()
    a1_id, a1_tier = a1.id, a1.inherent_tier

    a2 = service.create_reassessment_version(db, v, actor_id=1, reason="annual review")
    db.commit()

    # Prior version still exists, now superseded; new version active, carries tier.
    prior = db.query(VendorAssessment).filter(VendorAssessment.id == a1_id).first()
    assert prior is not None
    assert prior.lifecycle_status == "superseded"
    assert a2.version_no == 2
    assert a2.supersedes_id == a1_id
    assert a2.lifecycle_status == "active"
    assert a2.inherent_tier == a1_tier  # tier carried forward
    assert v.active_assessment_id == a2.id
    # Both versions have their own stage instances.
    assert len(service.get_stage_instances(db, a1_id)) == 11
    assert len(service.get_stage_instances(db, a2.id)) == 11


# ── Skip rules ───────────────────────────────────────────────────────────────

def test_skip_allowed_for_low_tier_only(db):
    v = _vendor(db, tier="low")
    a = service.ensure_active_assessment(db, v, actor_id=1)
    a.inherent_tier = "low"
    a.current_stage = "dd_planning"
    db.commit()
    res = service.skip_stage(db, v, a, "dd_planning", actor_id=1, reason="low risk")
    db.commit()
    assert res["skipped"] == "dd_planning"
    stages = {s.stage_key: s for s in service.get_stage_instances(db, a.id)}
    assert stages["dd_planning"].status == "skipped"


def test_skip_rejected_for_gate(db):
    v = _vendor(db, tier="low")
    a = service.ensure_active_assessment(db, v, actor_id=1)
    a.inherent_tier = "low"
    db.commit()
    with pytest.raises(ValueError):
        service.skip_stage(db, v, a, "tiering", actor_id=1, reason="x")  # gate


# ── Audit logging ────────────────────────────────────────────────────────────

def test_transitions_write_audit_log(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    service.advance_stage(db, v, a, actor_id=1)
    db.commit()
    logs = db.query(TPRAAuditLog).filter(TPRAAuditLog.vendor_id == v.id).all()
    actions = {l.action for l in logs}
    assert "create" in actions       # assessment creation
    assert "transition" in actions   # the advance


# ── RBAC ─────────────────────────────────────────────────────────────────────

def test_rbac_denies_user_without_roles(db):
    u = GRCUser(id=50, username="nobody", email="nobody@acme.test")
    db.add(u)
    db.commit()
    assert rbac.user_has_any_permission(db, u, {"vendor_risk:findings:edit"}) is False
    with pytest.raises(Exception):
        rbac.require_write(db, u, "findings", "edit")


def test_lifecycle_board_summarizes_vendors(db):
    from grc.modules.vendor_risk.tpra import api
    u = GRCUser(id=99, username="boarduser", email="board@acme.test")
    db.add(u)
    # Vendor A: in lifecycle with a critical finding; Vendor B: not started.
    va = _vendor(db, name="Acme A")
    vb = _vendor(db, name="Bravo B")
    a = service.ensure_active_assessment(db, va, actor_id=99)
    db.add(TPRAFinding(tenant_id=1, vendor_id=va.id, assessment_id=a.id, domain="cybersecurity",
                       severity="critical", title="x", status="open", is_critical_control_fail=True))
    db.commit()

    res = api.lifecycle_board(db=db, user=u)
    items = {r["vendor_name"]: r for r in res["items"]}
    assert items["Acme A"]["has_assessment"] is True
    assert items["Acme A"]["open_findings"] == 1
    assert items["Acme A"]["open_critical"] == 1
    assert items["Acme A"]["current_stage"] == "intake"
    assert items["Bravo B"]["has_assessment"] is False
    assert items["Bravo B"]["open_findings"] == 0


def test_rbac_allows_administrator(db):
    u = GRCUser(id=51, username="admin", email="admin@acme.test")
    role = Role(id=1, name="Administrator")
    db.add_all([u, role, UserRole(user_id=51, role_id=1, tenant_id=1)])
    db.commit()
    assert rbac.user_has_any_permission(db, u, {"vendor_risk:findings:edit"}) is True
    rbac.require_write(db, u, "findings", "edit")  # no raise


# ── RiskSnapshot time-series (TPRM revamp Phase 1) ───────────────────────────

def test_scoring_writes_a_vendor_snapshot_with_grade(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="Yes", critical=True)
    db.commit()

    result = service.run_scoring(db, v, a, actor_id=1)
    db.commit()

    # The scoring engine now emits an A–F grade, persisted on the assessment.
    assert result["rating_grade"] in ("A", "B", "C", "D", "F")
    assert a.rating_grade == result["rating_grade"]

    snaps = db.query(TPRARiskSnapshot).filter(
        TPRARiskSnapshot.vendor_id == v.id, TPRARiskSnapshot.source == "score",
    ).all()
    assert len(snaps) == 1
    assert snaps[0].scope == "vendor"
    assert snaps[0].residual_score == a.residual_score
    assert snaps[0].rating_grade == a.rating_grade


def test_scoring_rolls_up_to_risk_register(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    service.run_tiering(db, v, a, actor_id=1)
    _add_question_and_response(db, a, answer="Partial", critical=False)
    db.commit()

    service.run_scoring(db, v, a, actor_id=1)
    db.commit()

    risk = db.query(Risk).filter(
        Risk.tenant_id == 1, Risk.source_reference.like(f"vendor:{v.id}%")
    ).first()
    assert risk is not None
    assert risk.category == "third_party"
    assert risk.residual_score == a.residual_score
    assert a.linked_risk_id == risk.id
    # Re-scoring updates the SAME register entry (no duplicate).
    service.run_scoring(db, v, a, actor_id=1)
    db.commit()
    assert db.query(Risk).filter(Risk.source_reference.like(f"vendor:{v.id}%")).count() == 1


# ── Wave 2: finding / acceptance governance ──────────────────────────────────

def _admin(db, uid, email):
    """A user with the Administrator role (bypasses RBAC; SoD still applies)."""
    role = db.query(Role).filter(Role.name == "Administrator").first()
    if not role:
        role = Role(id=1, name="Administrator")
        db.add(role)
        db.flush()
    u = GRCUser(id=uid, username=f"admin{uid}", email=email)
    db.add(u)
    db.add(UserRole(user_id=uid, role_id=role.id, tenant_id=1))
    db.commit()
    return u


def _critical_finding(db, v, a, created_by):
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, domain="cybersecurity",
                    severity="critical", title="MFA missing", status="open",
                    is_critical_control_fail=True, created_by=created_by)
    db.add(f)
    db.commit()
    return f


def test_finding_cannot_be_flipped_to_accepted_directly(db):
    from grc.modules.vendor_risk.tpra import api
    u = _admin(db, 60, "a60@acme.test")
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=60)
    db.commit()
    f = _critical_finding(db, v, a, created_by=60)
    with pytest.raises(HTTPException) as ei:
        api.update_finding(f.id, api.FindingUpdate(status="accepted"), db=db, user=u)
    assert ei.value.status_code == 400


def test_finding_cannot_be_closed_without_completed_remediation(db):
    from grc.modules.vendor_risk.tpra import api
    u = _admin(db, 61, "a61@acme.test")
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=61)
    db.commit()
    f = _critical_finding(db, v, a, created_by=61)
    with pytest.raises(HTTPException) as ei:
        api.update_finding(f.id, api.FindingUpdate(status="closed"), db=db, user=u)
    assert ei.value.status_code == 400
    # After a completed remediation (evidence of fix), closing is allowed.
    db.add(TPRARemediation(tenant_id=1, finding_id=f.id, title="Rolled out MFA", status="completed"))
    db.commit()
    res = api.update_finding(f.id, api.FindingUpdate(status="closed"), db=db, user=u)
    assert res["status"] == "closed"


def test_acceptance_sod_author_cannot_self_accept_critical(db):
    from grc.modules.vendor_risk.tpra import api
    author = _admin(db, 62, "a62@acme.test")
    other = _admin(db, 63, "a63@acme.test")
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=62)
    db.commit()
    f = _critical_finding(db, v, a, created_by=62)
    exp = datetime.utcnow() + timedelta(days=90)
    # The author accepting their own critical → segregation-of-duties 403.
    with pytest.raises(HTTPException) as ei:
        api.create_acceptance(f.id, api.AcceptanceIn(rationale="ok", expiry=exp), db=db, user=author)
    assert ei.value.status_code == 403
    # An independent accountable owner may accept.
    res = api.create_acceptance(f.id, api.AcceptanceIn(rationale="ok", expiry=exp), db=db, user=other)
    assert res is not None
    db.refresh(f)
    assert f.status == "accepted"


def test_critical_acceptance_requires_expiry(db):
    from grc.modules.vendor_risk.tpra import api
    other = _admin(db, 64, "a64@acme.test")
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    f = _critical_finding(db, v, a, created_by=999)  # raised by someone else
    with pytest.raises(HTTPException) as ei:
        api.create_acceptance(f.id, api.AcceptanceIn(rationale="ok", expiry=None), db=db, user=other)
    assert ei.value.status_code == 400


def test_expired_acceptance_no_longer_mitigates_critical(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=1)
    db.commit()
    f = _critical_finding(db, v, a, created_by=1)
    # An already-expired active acceptance must NOT mitigate the critical.
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=f.id, rationale="old", status="active",
                              expiry=datetime.utcnow() - timedelta(days=1)))
    db.commit()
    assert service.count_open_critical(db, a.id) == 1
    # A future-dated acceptance DOES mitigate.
    db.query(TPRARiskAcceptance).filter(TPRARiskAcceptance.finding_id == f.id).update(
        {"expiry": datetime.utcnow() + timedelta(days=30)})
    db.commit()
    assert service.count_open_critical(db, a.id) == 0


def test_portfolio_snapshot_aggregates_active_vendors(db):
    v1 = _vendor(db, name="V1")
    v1.inherent_risk_score, v1.residual_risk_score = 80.0, 40.0
    v2 = _vendor(db, name="V2")
    v2.inherent_risk_score, v2.residual_risk_score = 60.0, 20.0
    retired = _vendor(db, name="Gone", status="retired")
    retired.inherent_risk_score, retired.residual_risk_score = 100.0, 100.0
    db.commit()

    snap = write_portfolio_snapshot(db, tenant_id=1, source="schedule", commit=True)
    assert snap.scope == "portfolio" and snap.vendor_id is None
    assert snap.vendor_count == 2                     # retired excluded
    assert snap.inherent_score == 70.0               # (80+60)/2
    assert snap.residual_score == 30.0               # (40+20)/2
