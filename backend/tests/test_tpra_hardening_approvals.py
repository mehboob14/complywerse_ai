"""Hardening: who may approve, which decision counts, conditions as tasks, the
settings an assessment is held to, and the defects found along the way.

1. Segregation of duties, one rule for every approve route: the assessor, the
   reviewers (the plan's and the roster's), the business owner (the supplier's,
   or the engagement's) and whoever moved the assessment into approval cannot
   approve it; the approvers list says so before anyone writes a rationale.
2. A decision counts only if it is the latest and made since the Approval stage
   was last entered: a send-back invalidates it without editing it.
3. Each condition of a decision is a Task Management task, twinned both ways; a
   deleted twin leaves the condition; an overdue one is in the attention queue.
4. An assessment keeps the tiering config and tier policy it was tiered under
   until it is tiered again; a reassessment carries its facts, roster and
   questionnaire forward and takes today's settings.
5. A finding cannot be created accepted or closed; run-scoring takes ratings and
   choices; the old Approve keeps the reviewer, rates on the tenant's bands and
   writes the supplier's scope; a reopened finding reopens its issue; an old
   critical-control finding is matched by its question, not by an id from
   another table; an acceptance covers its whole expiry day; an assessment from
   the old Assessments page never stands in for the lifecycle's; an evidence
   upload is read only up to the cap.
"""
import asyncio
import importlib
import io
from datetime import datetime, time, timedelta

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, CriticalTask, GRCUser, Issue, IssueActivity, Permission, Role, RolePermission, Tenant, TPRAApproval,
    TPRAAuditLog, TPRAEngagement, TPRAFinding, TPRAQuestion, TPRAQuestionResponse, TPRARiskAcceptance,
    TPRAStageInstance, TPRATieringConfig, UserRole, Vendor, VendorAssessment, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import assessments as legacy, questionnaires
from grc.modules.vendor_risk.tpra import api, attention, engagements, reminders, service, tier_policy
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS
from grc.routers.auth_router import require_auth

critical_tasks_router = importlib.import_module("grc.routers.critical_tasks_router")

OWNER, MOVER, REVIEWER, APPROVER, HOLDER, NOBODY = 7, 70, 71, 72, 73, 74   # 7-72 administrators
TODAY = datetime.utcnow().date()
POLICY = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
MEDIUM = {k: 1 for k in FACTOR_KEYS}                                           # 25: medium on the defaults


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Approver"),
               Permission(id=1, name="vendor_risk:approvals:approve", resource="vendor_risk", action="approve"),
               RolePermission(role_id=2, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=f"User {uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (OWNER, MOVER, REVIEWER, APPROVER, HOLDER, NOBODY)])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (OWNER, MOVER, REVIEWER, APPROVER)])
    s.add(UserRole(user_id=HOLDER, role_id=2, tenant_id=1))
    s.commit()
    yield s
    s.close()


def _user(db, uid):
    return db.get(GRCUser, uid)


def _vendor(db, **kw):
    v = Vendor(**{"tenant_id": 1, "name": "Acme Cloud", "tier": "medium", "status": "active",
                  "data_access_level": "confidential", "data_types_accessed": ["PII"], "owner_id": OWNER, **kw})
    db.add(v)
    db.commit()
    return v


def _stage(db, a, key):
    return db.query(TPRAStageInstance).filter(TPRAStageInstance.assessment_id == a.id,
                                              TPRAStageInstance.stage_key == key).one()


def _config(db, **values):
    row = db.query(TPRATieringConfig).filter(TPRATieringConfig.tenant_id == 1).first()
    if row is None:
        row = TPRATieringConfig(tenant_id=1, config_key="default", is_active=True)
        db.add(row)
    for key, value in values.items():
        setattr(row, key, value)
    db.commit()


def _at_approval(db, v, mover):
    """A scored medium assessment that `mover` has just advanced into its Approval stage."""
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    a.inherent_tier, a.inherent_score, a.residual_score, a.residual_rating = "medium", 40.0, 20.0, "low"
    for s in service.get_stage_instances(db, a.id):
        s.status = "complete" if s.stage_order < 7 else "not_started"
    _stage(db, a, "contracting").status = "in_progress"
    a.current_stage = "contracting"
    db.commit()
    assert service.advance_stage(db, v, a, actor_id=mover)["to"] == "approval"
    db.commit()
    return a


def _approve(db, a, uid, decision="approve", **kw):
    return api.create_approval(a.id, api.ApprovalIn(decision=decision, **kw), db=db, user=_user(db, uid))


# ── 1. who may approve ───────────────────────────────────────────────────────

def test_the_owner_the_reviewers_and_whoever_moved_it_to_approval_cannot_approve(db):
    v = _vendor(db)
    a = _at_approval(db, v, MOVER)
    a.team_roster = {"security": REVIEWER, "exec_approver": APPROVER}
    db.commit()
    for who, why in ((OWNER, "the business owner"), (REVIEWER, "a reviewer"), (MOVER, "moved the assessment to approval")):
        with pytest.raises(HTTPException) as refused:
            _approve(db, a, who)
        assert refused.value.status_code == 403 and why in refused.value.detail
    assert _approve(db, a, APPROVER)["decision"] == "approve"

    # An engagement's business owner is the engagement's, not the supplier's.
    payroll = db.get(TPRAEngagement, engagements.create_engagement(
        v.id, engagements.EngagementIn(name="Payroll", owner_id=HOLDER), db=db, user=_user(db, APPROVER))["id"])
    p = service.ensure_active_assessment(db, v, actor_id=APPROVER, engagement=payroll)
    db.commit()
    assert service.conflicts(db, p) == {HOLDER: "business_owner"}


def test_the_approvers_list_names_everyone_with_the_right_and_why_some_cannot(db):
    _config(db, tier_policy=tier_policy.clean({"medium": {"approver_role": "CISO"}}, tier_policy.merged({})))
    v = _vendor(db)
    a = _at_approval(db, v, MOVER)
    a.team_roster = {"privacy": REVIEWER}
    db.commit()
    out = api.list_approvers(a.id, db=db, user=_user(db, APPROVER))
    assert {i["user_id"]: (i["eligible"], i["reason"]) for i in out["items"]} == {
        OWNER: (False, "Business owner"), MOVER: (False, "Moved it to approval"), REVIEWER: (False, "Reviewer"),
        APPROVER: (True, None), HOLDER: (False, "No CISO role")}           # NOBODY holds no approve right
    assert out["me"]["user_id"] == APPROVER and out["me"]["eligible"] is True
    assert api.list_approvers(a.id, db=db, user=_user(db, NOBODY))["me"] is None
    with pytest.raises(HTTPException) as refused:                         # the same rule refuses the decision
        _approve(db, a, HOLDER)
    assert refused.value.status_code == 403 and "CISO role" in refused.value.detail


# ── 2. which decision counts ─────────────────────────────────────────────────

def test_a_decision_counts_only_if_latest_and_made_since_the_stage_was_last_entered(db):
    v = _vendor(db)
    a = _at_approval(db, v, MOVER)
    _stage(db, a, "approval").started_at = datetime.utcnow() - timedelta(minutes=10)
    first = _approve(db, a, APPROVER)
    db.get(TPRAApproval, first["id"]).created_at = datetime.utcnow() - timedelta(minutes=9)
    db.commit()
    assert service.evaluate_current(db, v, a, "approval")["passed"] is True

    # Sent back, then brought to approval again: the decision stays on the record and no longer counts.
    service.send_back(db, v, a, "findings", actor_id=APPROVER, reason="A new finding")
    for _ in range(2):                                                   # findings → contracting → approval
        assert service.advance_stage(db, v, a, actor_id=MOVER)["advanced"] is True
    db.commit()
    gate = service.evaluate_current(db, v, a, "approval")
    assert gate["passed"] is False and gate["blockers"][0].startswith("A recorded approval decision")
    listed = api.list_approvals(a.id, db=db, user=_user(db, APPROVER))["items"]
    assert [(i["id"], i["decision"], i["in_force"]) for i in listed] == [(first["id"], "approve", False)]

    again = _approve(db, a, APPROVER)
    assert service.evaluate_current(db, v, a, "approval")["passed"] is True
    assert [i["in_force"] for i in api.list_approvals(a.id, db=db, user=_user(db, APPROVER))["items"]] == [True, False]
    _approve(db, a, APPROVER, decision="defer")                           # the latest is the one that counts
    assert service.evaluate_current(db, v, a, "approval")["passed"] is False
    assert db.get(TPRAApproval, again["id"]).decision == "approve"


# ── 3. conditions are tasks ──────────────────────────────────────────────────

@pytest.fixture()
def tasks_http(db, monkeypatch):
    monkeypatch.setattr(critical_tasks_router, "_send_notification_email", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(critical_tasks_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, APPROVER)
    app.dependency_overrides[critical_tasks_router.router.dependencies[0].dependency] = lambda: True
    return TestClient(app)


def _overdue(db):
    return [i for i in attention.open_items(db, 1, TODAY, POLICY) if i["condition"] == "approval_condition_overdue"]


def test_each_condition_is_a_task_twinned_both_ways_and_a_deleted_twin_leaves_it(db, tasks_http):
    v = _vendor(db)
    a = _at_approval(db, v, MOVER)
    late = (datetime.utcnow() - timedelta(days=3)).replace(microsecond=0)
    made = _approve(db, a, APPROVER, decision="approve_with_conditions", conditions=[
        {"text": "MFA evidence within 30 days", "owner_id": HOLDER, "due_date": late.isoformat()}, "Sign the DPA"])
    mfa, dpa = made["conditions"]
    twin = db.get(CriticalTask, mfa["task_id"])
    assert (twin.source_module, twin.source_entity_type, twin.source_entity_id) == (
        "vendor_risk", "TPRAApprovalCondition", made["id"])
    assert (twin.title, twin.assigned_user_ids, twin.due_date, twin.status) == (
        "MFA evidence within 30 days", [HOLDER], late, "Open")
    assert db.get(CriticalTask, dpa["task_id"]).assigned_user_ids == []
    assert made["overdue_conditions"] == 1

    # Overdue, so in the attention queue for its owner.
    assert [(i["record_type"], i["record_id"], i["people"]) for i in _overdue(db)] == [("approval", made["id"], [HOLDER])]

    # Task Management → the condition: done there is closed here; the decision is not edited.
    for step in ("In Progress", "Under Review", "Completed"):
        assert tasks_http.post(f"/critical-tasks/{twin.id}/transition", json={"new_status": step}).status_code == 200
    db.expire_all()
    ap = db.get(TPRAApproval, made["id"])
    assert (ap.conditions[0]["status"], ap.conditions[0]["text"], ap.decision) == (
        "closed", "MFA evidence within 30 days", "approve_with_conditions")
    assert ap.conditions[0]["resolved_at"] and _overdue(db) == []
    assert db.query(TPRAAuditLog).filter(TPRAAuditLog.reason == "Changed in Task Management").count() == 1
    assert tasks_http.put(f"/critical-tasks/{dpa['task_id']}",
                          json={"assigned_user_ids": [OWNER], "due_date": "2027-03-01T00:00:00"}).status_code == 200
    db.expire_all()
    assert {k: db.get(TPRAApproval, made["id"]).conditions[1][k] for k in ("owner_id", "due_date")} == {
        "owner_id": OWNER, "due_date": "2027-03-01T00:00:00"}

    # The condition → Task Management: reopened here, open there.
    api.update_condition(made["id"], mfa["id"], api.ConditionUpdate(status="open"), db=db, user=_user(db, APPROVER))
    db.expire_all()
    assert db.get(CriticalTask, twin.id).status == "Open" and len(_overdue(db)) == 1

    # Deleting the task leaves the condition on the decision, as it was, without a twin.
    assert tasks_http.delete(f"/critical-tasks/{twin.id}").status_code == 204
    db.expire_all()
    kept = db.get(TPRAApproval, made["id"]).conditions[0]
    assert (kept["text"], kept["status"], kept["owner_id"], kept["task_id"]) == (
        "MFA evidence within 30 days", "open", HOLDER, None)
    assert db.get(CriticalTask, twin.id) is None and len(_overdue(db)) == 1


# ── 4. the settings an assessment is held to ─────────────────────────────────

def _answer(db, a, key, answer):
    q = TPRAQuestion(tenant_id=1, template_id=1, question_key=key, text=key, qtype="yes_no", weight=1.0)
    db.add(q)
    db.flush()
    db.add(TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=q.id, question_key=key, answer=answer))
    db.commit()


def test_an_assessment_keeps_the_settings_it_was_tiered_under_until_tiered_again(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    service.run_tiering(db, v, a, actor_id=OWNER, factors=MEDIUM)
    db.commit()
    assert a.inherent_tier == "medium" and a.policy_snapshot["thresholds"] == DEFAULT_TIERING_CONFIG["thresholds"]

    # The settings change: medium suppliers need a CISO and a pen test, and "medium" starts lower.
    _config(db, thresholds={"critical": 75.0, "high": 50.0, "medium": 15.0},
            tier_policy=tier_policy.clean({"medium": {"approver_role": "CISO", "evidence": ["pen_test"]}},
                                          tier_policy.merged({})))
    holder = _user(db, HOLDER)
    a.residual_score = 10.0
    db.commit()
    assert service.approval_problem(db, holder, a) is None
    assert [e["kind"] for e in api.tier_requirements(a.id, db=db, user=holder)["evidence"]] == ["assurance_report"]
    _answer(db, a, "mfa", "Partial")                                      # residual 16.25
    service.run_scoring(db, v, a, actor_id=OWNER)
    assert (a.residual_score, a.residual_rating) == (16.25, "low")        # on the bands it was tiered under

    # Tiered again: the settings as they stand.
    service.run_tiering(db, v, a, actor_id=OWNER, factors=MEDIUM)
    service.run_scoring(db, v, a, actor_id=OWNER)
    db.commit()
    assert (a.inherent_tier, a.residual_rating) == ("medium", "medium")
    assert "CISO role" in service.approval_problem(db, holder, a)[1]
    assert [e["kind"] for e in api.tier_requirements(a.id, db=db, user=holder)["evidence"]] == ["pen_test"]

    # A reassessment carries the facts, roster and questionnaire forward, and takes today's settings.
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Custom", questions=[])
    db.add(template)
    db.flush()
    a.team_roster, a.template_id = {"security": REVIEWER}, template.id
    _config(db, tier_policy=tier_policy.clean({"medium": {"approver_role": "Risk Committee"}},
                                              tier_policy.merged({})))
    v2 = service.create_reassessment_version(db, v, actor_id=OWNER, reason="Yearly")
    db.commit()
    assert (v2.tiering_basis, v2.team_roster, v2.template_id) == (a.tiering_basis, {"security": REVIEWER}, template.id)
    assert v2.policy_snapshot["tier_policy"]["medium"]["approver_role"] == "Risk Committee"
    assert a.policy_snapshot["tier_policy"]["medium"]["approver_role"] == "CISO"
    v.data_access_level = "restricted"                                    # re-tier detection works from version 2
    db.commit()
    assert tier_policy.retier_reasons(db, v, v2) == ["data access went from confidential to restricted"]


# ── 5. defects found along the way ───────────────────────────────────────────

def test_a_new_finding_cannot_be_created_accepted_or_closed(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    db.commit()
    for status in ("accepted", "closed"):
        with pytest.raises(HTTPException) as refused:
            api.create_finding(a.id, api.FindingIn(title="No MFA", severity="critical", status=status), db=db,
                               user=_user(db, APPROVER))
        assert refused.value.status_code == 400
    assert db.query(TPRAFinding).count() == 0
    assert api.create_finding(a.id, api.FindingIn(title="No MFA"), db=db, user=_user(db, APPROVER))["status"] == "open"


def test_run_scoring_takes_a_questionnaire_answered_only_with_ratings_and_choices(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    service.run_tiering(db, v, a, actor_id=OWNER, factors=MEDIUM)
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Operations", questions=[
        {"id": "patching", "text": "Rate your patching.", "type": "rating"},
        {"id": "pen", "text": "How often are you pen tested?", "type": "multiple_choice",
         "options": [{"value": "annually", "label": "Annually", "score": 1.0},
                     {"value": "never", "label": "Never", "score": 0.0}]}])
    db.add(template)
    db.flush()
    db.add(VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, assessment_id=a.id, template_id=template.id,
                                       token="t-ops", status="submitted", responses={"patching": "4", "pen": "annually"}))
    db.commit()
    scored = api.run_scoring(a.id, db=db, user=_user(db, APPROVER))
    assert scored["overall_residual"] < scored["overall_inherent"] and a.residual_score == scored["overall_residual"]


def test_the_old_approve_keeps_the_reviewer_rates_on_the_tenants_bands_and_writes_the_general_scope(db):
    _config(db, thresholds={"critical": 90.0, "high": 70.0, "medium": 30.0})
    v = _vendor(db)
    engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll", owner_id=HOLDER), db=db,
                                  user=_user(db, APPROVER))
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="reviewed", assessed_by=MOVER, reviewed_by=REVIEWER,
                         inherent_tier="medium", inherent_score=80.0, residual_score=65.0)
    db.add(a)
    db.commit()
    with pytest.raises(HTTPException) as own_supplier:
        legacy.approve_assessment(a.id, legacy.ApproveRequest(), db=db, current_user=_user(db, OWNER))
    assert own_supplier.value.status_code == 403 and "business owner" in own_supplier.value.detail

    out = legacy.approve_assessment(a.id, legacy.ApproveRequest(), db=db, current_user=_user(db, APPROVER))["assessment"]
    assert (out["status"], out["risk_rating"], out["reviewed_by"]) == ("approved", "medium", REVIEWER)   # 80/60/40: high
    general = service.general_row(db, v)
    db.refresh(v)
    assert (general.inherent_risk_score, general.residual_risk_score, general.risk_rating) == (80.0, 65.0, "medium")
    assert (v.residual_risk_score, v.risk_rating) == (65.0, "medium")      # the supplier shows its worst
    approved = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "approval", TPRAAuditLog.assessment_id == a.id).one()
    assert (approved.actor_id, approved.to_value) == (APPROVER, "approve")


def test_a_reopened_finding_reopens_the_issue_its_acceptance_closed(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    db.commit()
    f = api.create_finding(a.id, api.FindingIn(title="No MFA", severity="high"), db=db, user=_user(db, MOVER))
    issue = db.get(Issue, f["linked_issue_id"])
    accepted = api.create_acceptance(f["id"], api.AcceptanceIn(rationale="Compensating control",
                                                               expiry=datetime.utcnow() + timedelta(days=30)),
                                     db=db, user=_user(db, APPROVER))
    db.refresh(issue)
    assert issue.workflow_state == "closed"
    api.revoke_acceptance(accepted["id"], db=db, user=_user(db, APPROVER))
    db.refresh(issue)
    assert (issue.workflow_state, issue.status, issue.closed_at) == ("in_progress", "open", None)

    # Closed after its fix, then back in remediation: the issue follows it again.
    admin = _user(db, APPROVER)
    api.create_remediation(f["id"], api.RemediationIn(title="MFA everywhere", status="completed"), db=db, user=admin)
    api.update_finding(f["id"], api.FindingUpdate(status="closed"), db=db, user=admin)
    db.refresh(issue)
    assert issue.workflow_state == "closed"
    api.update_finding(f["id"], api.FindingUpdate(status="in_remediation"), db=db, user=admin)
    db.refresh(issue)
    assert issue.workflow_state == "in_progress"
    assert db.query(IssueActivity).filter(IssueActivity.issue_id == issue.id, IssueActivity.type == "reopened").count() == 2


def test_an_old_critical_control_finding_is_matched_by_its_question_not_an_id_from_another_table(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    # Raised before findings carried their question: the template's question id 3 stood in source_response_id.
    db.add(TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity="critical", status="open",
                       title="Is MFA enforced?", is_critical_control_fail=True, source_response_id=3))
    # Answered per question now; another question's row happens to have id 3.
    db.add_all([TPRAQuestion(id=3, tenant_id=1, template_id=1, question_key="dr", text="Do you test disaster recovery?",
                             qtype="yes_no", weight=1.0, critical_control=True),
                TPRAQuestion(id=4, tenant_id=1, template_id=1, question_key="3", text="Is MFA enforced?",
                             qtype="yes_no", weight=1.0, critical_control=True)])
    db.add_all([TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=3, question_key="dr", answer="No"),
                TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=4, question_key="3", answer="No")])
    db.commit()
    assert service.raise_answer_findings(db, v, a, service.collect_responses_for_scoring(db, a.id), OWNER) == 1
    db.commit()
    assert sorted(f.title for f in db.query(TPRAFinding)) == ["Do you test disaster recovery?", "Is MFA enforced?"]


def test_an_acceptance_covers_its_finding_through_its_expiry_day(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    a.current_stage = "monitoring"
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity="critical", status="accepted",
                    title="No MFA", is_critical_control_fail=True, created_by=MOVER)
    db.add(f)
    db.flush()
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=f.id, accepted_by=APPROVER, status="active",
                              rationale="Compensating control", expiry=datetime.combine(TODAY, time())))
    db.commit()
    assert service.count_open_critical(db, a.id) == 0                     # it expires today: today still counts
    reminders.run(db, 1, POLICY, today=TODAY, deliver=lambda *args: None)
    for row in (f, v):
        db.refresh(row)
    assert (f.status, v.status) == ("accepted", "active")
    assert [i["badge"] for i in attention.open_items(db, 1, TODAY, POLICY)
            if i["condition"] == "acceptance_expiring"] == ["Expires today"]

    tomorrow = TODAY + timedelta(days=1)
    assert service.acceptance_holds(db, f, datetime.combine(tomorrow, time(8))) is False
    reminders.run(db, 1, POLICY, today=tomorrow, deliver=lambda *args: None)
    db.refresh(f)
    assert f.status == "open"


def test_an_assessment_from_the_old_assessments_page_never_stands_in_for_the_lifecycles(db):
    v = _vendor(db)
    admin = _user(db, APPROVER)
    made = legacy.create_assessment(legacy.AssessmentCreate(vendor_id=v.id, assessment_type="cybersecurity"),
                                    db=db, current_user=admin)
    assert db.get(VendorAssessment, made["id"]).current_stage is None                 # stand-alone: no stage
    assert api.get_lifecycle(v.id, db=db, user=admin)["assessment"] is None          # the lifecycle has not started
    started = api.init_lifecycle(v.id, db=db, user=admin)["assessment"]
    assert started["id"] != made["id"]
    assert db.query(TPRAStageInstance).filter(TPRAStageInstance.assessment_id == made["id"]).count() == 0
    assert [(i["vendor_id"], i["assessment_id"]) for i in api.lifecycle_board(db=db, user=admin)["items"]] == [
        (v.id, started["id"])]
    v.active_assessment_id = None                                         # even with the pointer lost
    db.commit()
    assert service.get_active_assessment(db, v).id == started["id"]
    v2 = service.create_reassessment_version(db, v, actor_id=APPROVER, reason="Yearly")
    db.commit()
    assert (v2.supersedes_id, db.get(VendorAssessment, made["id"]).lifecycle_status) == (started["id"], "active")


def test_an_evidence_upload_is_read_only_up_to_the_cap(db, monkeypatch, tmp_path):
    from grc.modules.evidence.routers import evidence as evidence_router
    monkeypatch.setattr(questionnaires, "_MAX_EVIDENCE_BYTES", 10)
    monkeypatch.setattr(evidence_router, "EVIDENCE_UPLOAD_DIR", str(tmp_path))

    def upload(size):
        return asyncio.run(api._save_evidence_file(db, 1, None, None, UploadFile(
            file=io.BytesIO(b"x" * size), filename="report.pdf"), APPROVER))

    with pytest.raises(HTTPException) as refused:
        upload(11)
    assert refused.value.status_code == 413 and not list(tmp_path.rglob("*.pdf"))
    assert upload(10).file_name == "report.pdf" and len(list(tmp_path.rglob("*.pdf"))) == 1
