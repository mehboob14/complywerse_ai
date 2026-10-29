"""TPRM parity, piece B3: the lifecycle's rules.

1. Honest re-tiering (R3): a stage skipped earlier that the new tier needs is reopened; work already past it goes back to the
   first stage still open, with the reason in the transition, and an approval given before stops counting; lowering the tier
   skips the stages nobody has started; the next review date moves by the difference of the two cadences; nothing changes
   while an exit is under way; past the Approval gate the review is not rewound. A tier set by hand follows the same rules.
2. A gate that sees the whole vendor (R4): an approval is refused while a critical or blocking finding stands anywhere on the
   supplier, and the tier's reviewers are asked for at the gate too (Medium skips planning).
3. Stage checks (R13): every check is structured (key, text, met, fix), onboarding passes only when its checklist is done,
   monitoring is the resting state, and the last stage waits for a new cycle or the exit.
4. The pieces the workspace reads: the policy an assessment is held to, the history, waiving a condition, who is designated.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Permission, Role, RolePermission, Tenant, TPRAApproval, TPRAAuditLog, TPRAEngagement, TPRAFinding,
    TPRARemediation, TPRARiskAcceptance, TPRARoster, TPRAStageInstance, UserRole, Vendor,
)
from grc.modules.vendor_risk.routers import vendors as vendors_router
from grc.modules.vendor_risk.tpra import api, engagements, intake, service
from grc.modules.vendor_risk.tpra.engine_gates import evaluate_stage_exit
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS
from grc.modules.vendor_risk.tpra.stages import STAGE_KEYS, STAGE_ORDER

OWNER, MOVER, REVIEWER, APPROVER = 7, 70, 71, 72                  # all administrators
LOW = {k: 0.5 for k in FACTOR_KEYS}                               # 12.5
MEDIUM = {k: 1 for k in FACTOR_KEYS}                              # 25
HIGH = {k: 2.5 for k in FACTOR_KEYS}                              # 62.5
CRITICAL = {k: 3.2 for k in FACTOR_KEYS}                          # 80


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([Role(id=1, name="Administrator"),
               Permission(id=1, name="vendor_risk:approvals:approve", resource="vendor_risk", action="approve")])
    s.add_all([GRCUser(id=uid, username=f"u{uid}", display_name=f"User {uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (OWNER, MOVER, REVIEWER, APPROVER)])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (OWNER, MOVER, REVIEWER, APPROVER)])
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


def _work(db, v, tier, current, skipped=(), engagement=None):
    """An assessment at `current`: the stages before it complete (but the skipped ones), the ones after not started."""
    a = service.ensure_active_assessment(db, v, actor_id=OWNER, engagement=engagement)
    a.inherent_tier, a.inherent_score, a.current_stage = tier, 40.0, current
    for s in service.get_stage_instances(db, a.id):
        s.status = ("skipped" if s.stage_key in skipped else "complete" if STAGE_ORDER[s.stage_key] < STAGE_ORDER[current]
                    else "in_progress" if s.stage_key == current else "not_started")
    (engagement or v).lifecycle_stage = current
    db.commit()
    return a


def _status(db, a):
    return {s.stage_key: s.status for s in service.get_stage_instances(db, a.id)}


def _audit(db, **filters):
    return db.query(TPRAAuditLog).filter_by(**filters).order_by(TPRAAuditLog.id).all()


def _decide(db, a, decision="approve"):
    """A decision the Approval gate counts: made after the stage was entered."""
    db.query(TPRAStageInstance).filter_by(assessment_id=a.id, stage_key="approval").one().started_at = (
        datetime.utcnow() - timedelta(minutes=10))
    made = api.create_approval(a.id, api.ApprovalIn(decision=decision), db=db, user=_user(db, APPROVER))
    db.get(TPRAApproval, made["id"]).created_at = datetime.utcnow() - timedelta(minutes=9)
    db.commit()
    return made


# ── 1. honest re-tiering ─────────────────────────────────────────────────────

def test_raising_the_tier_reopens_a_stage_skipped_earlier_and_sends_the_work_back(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "contracting", skipped=("dd_planning",))
    result = service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    db.commit()
    assert result["tier"] == "high"
    assert result["retier"] == {"from": "medium", "to": "high", "reopened": ["dd_planning"],
                                "sent_back_to": "dd_planning", "skipped": []}
    assert (a.current_stage, v.lifecycle_stage) == ("dd_planning", "dd_planning")
    assert _status(db, a) == {"intake": "complete", "tiering": "complete", "dd_planning": "in_progress",
                              **{k: "not_started" for k in STAGE_KEYS[3:]}}
    moved = _audit(db, assessment_id=a.id, entity="stage", action="send_back")
    assert [(m.from_value, m.to_value, m.reason) for m in moved] == [
        ("contracting", "dd_planning", "Re-tiered to high, so due diligence planning now apply.")]
    assert [r.to_value for r in _audit(db, assessment_id=a.id, entity="stage", action="reopen")] == ["dd_planning"]


def test_an_approval_given_before_a_re_tier_that_sends_the_work_back_stops_counting_at_once(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "approval", skipped=("dd_planning",))
    a.residual_score, a.residual_rating, a.reviewed_by = 20.0, "low", REVIEWER
    db.commit()
    first = _decide(db, a)
    assert service.evaluate_current(db, v, a, "approval")["passed"] is True
    assert [i["in_force"] for i in api.list_approvals(a.id, db=db, user=_user(db, APPROVER))["items"]] == [True]

    service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    db.commit()
    assert a.current_stage == "dd_planning" and _status(db, a)["approval"] == "not_started"
    listed = api.list_approvals(a.id, db=db, user=_user(db, APPROVER))["items"]
    assert [(i["id"], i["decision"], i["in_force"]) for i in listed] == [(first["id"], "approve", False)]


def test_a_stage_reopened_ahead_of_the_work_is_simply_there_to_do(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "tiering", skipped=("dd_planning",))
    result = service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    db.commit()
    assert result["retier"]["reopened"] == ["dd_planning"] and result["retier"]["sent_back_to"] is None
    assert a.current_stage == "tiering" and _status(db, a)["dd_planning"] == "not_started"
    assert _audit(db, assessment_id=a.id, action="send_back") == []
    assert service.advance_stage(db, v, a, actor_id=OWNER)["to"] == "dd_planning"


def test_lowering_the_tier_skips_what_nobody_started_and_leaves_the_stage_in_progress(db):
    v = _vendor(db, tier="high")
    a = _work(db, v, "high", "dd_planning")
    result = service.run_tiering(db, v, a, actor_id=OWNER, factors=LOW)
    db.commit()
    assert result["tier"] == "low"
    assert result["retier"]["skipped"] == ["questionnaire", "scoring", "findings"]       # not dd_planning: it is under way
    assert _status(db, a)["dd_planning"] == "in_progress" and a.current_stage == "dd_planning"
    auto = _audit(db, assessment_id=a.id, entity="stage", action="skip")
    assert [(r.to_value, r.reason) for r in auto] == [(k, "Auto-skipped — right-sized by inherent tier")
                                                        for k in ("questionnaire", "scoring", "findings")]
    skipped_row = db.query(TPRAStageInstance).filter_by(assessment_id=a.id, stage_key="scoring").one()
    assert skipped_row.skipped_reason == "Auto-skipped — right-sized by inherent tier" and skipped_row.skipped_by is None

    # In progress, it can be skipped by hand; the work lands on the next stage still to do, not on a skipped one.
    service.skip_stage(db, v, a, "dd_planning", actor_id=OWNER, reason="Nothing to plan for a Low supplier")
    db.commit()
    assert a.current_stage == "contracting" and _status(db, a)["contracting"] == "in_progress"
    by_hand = _audit(db, assessment_id=a.id, entity="stage", action="skip")[-1]
    assert (by_hand.from_value, by_hand.to_value, by_hand.reason) == (
        "dd_planning", "skipped", "Nothing to plan for a Low supplier")


def test_the_next_review_moves_by_the_difference_of_the_two_cadences(db):
    start = datetime(2027, 1, 1)
    v = _vendor(db, reassessment_cadence_days=730, next_reassessment_date=start)          # Medium: every 730 days
    a = _work(db, v, "medium", "monitoring", skipped=("dd_planning",))
    service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)                             # High: every 365
    db.commit()
    assert (v.reassessment_cadence_days, v.next_reassessment_date) == (365, start - timedelta(days=365))

    v.reassessment_cadence_days, v.next_reassessment_date = 100, start                       # a cadence someone set is theirs
    db.commit()
    service.run_tiering(db, v, a, actor_id=OWNER, factors=CRITICAL)
    db.commit()
    assert (v.reassessment_cadence_days, v.next_reassessment_date) == (100, start)


def test_past_the_approval_gate_the_review_is_not_rewound(db):
    v = _vendor(db, reassessment_cadence_days=730, next_reassessment_date=datetime(2027, 1, 1))
    a = _work(db, v, "medium", "monitoring", skipped=("dd_planning",))
    result = service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    db.commit()
    assert result["tier"] == "high" and result["retier"]["reopened"] == [] and result["retier"]["sent_back_to"] is None
    assert a.current_stage == "monitoring" and _status(db, a)["dd_planning"] == "skipped"
    assert v.reassessment_cadence_days == 365                                                # the next review is sooner


def test_no_tier_changes_while_an_exit_is_under_way(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "contracting", skipped=("dd_planning",))
    v.status = "offboarded"
    db.commit()
    with pytest.raises(service.RetierRefused) as refused:
        service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    assert "offboarded" in str(refused.value) and a.inherent_tier == "medium"
    with pytest.raises(HTTPException) as http:
        api.run_tiering(a.id, api.TieringIn(factors=HIGH), db=db, user=_user(db, OWNER))
    assert http.value.status_code == 409
    with pytest.raises(HTTPException) as by_hand:
        api.override_tier(a.id, api.TierOverrideIn(tier="high", justification="A reason that is long enough"),
                          db=db, user=_user(db, OWNER))
    assert by_hand.value.status_code == 409
    assert api.get_lifecycle(v.id, db=db, user=_user(db, OWNER))["retier_blocked"] == str(refused.value)
    # the supplier's record route refuses too, rather than failing
    v.inherent_risk_score = 40.0
    db.commit()
    with pytest.raises(HTTPException) as record:
        vendors_router.update_vendor(
            v.id, vendors_router.VendorUpdate(tier="high", tier_justification="Changed by the reviewers"),
            db=db, current_user=_user(db, OWNER))
    assert record.value.status_code == 409


def test_an_engagement_is_left_alone_while_it_is_offboarded_or_once_ended(db):
    v = _vendor(db)
    made = engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, OWNER))
    payroll = db.get(TPRAEngagement, made["id"])
    p = _work(db, v, "medium", "contracting", skipped=("dd_planning",), engagement=payroll)
    payroll.offboarding = {"items": [], "reason": "Moving away", "started_at": datetime.utcnow().isoformat()}
    db.commit()
    with pytest.raises(service.RetierRefused) as refused:
        service.run_tiering(db, v, p, actor_id=OWNER, factors=HIGH)
    assert "Payroll is being offboarded" in str(refused.value)
    payroll.offboarding = {**payroll.offboarding, "completed_at": datetime.utcnow().isoformat()}
    payroll.status = "ended"
    db.commit()
    assert service.retier_problem(db, v, p) == "Payroll is being offboarded, so its tier stays as it is."
    payroll.offboarding, payroll.status = None, "active"
    db.commit()
    assert service.retier_problem(db, v, p) is None


def test_a_tier_set_by_hand_follows_the_same_rules(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "contracting", skipped=("dd_planning",))
    moved = service.record_tier_override(db, v, a, "critical", "The reviewers saw the data flows", actor_id=OWNER)
    db.commit()
    assert moved["reopened"] == ["dd_planning"] and moved["sent_back_to"] == "dd_planning"
    assert a.current_stage == "dd_planning" and a.inherent_tier == "critical"
    assert a.tier_override["to"] == "critical" and a.tier_override["justification"] == "The reviewers saw the data flows"


def test_computing_and_overriding_in_one_step_moves_the_work_once(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "contracting", skipped=("dd_planning",))
    result = api.run_tiering(a.id, api.TieringIn(
        factors=HIGH, override=api.TierOverrideIn(tier="critical", justification="Handles all of our card data")),
        db=db, user=_user(db, OWNER))
    assert (result["tier"], result["computed_tier"]) == ("critical", "high")
    assert a.inherent_tier == "critical" and a.tier_override["computed"] == "high"
    assert len(_audit(db, assessment_id=a.id, entity="stage", action="send_back")) == 1
    assert [r.action for r in _audit(db, assessment_id=a.id, entity="tiering")] == ["update", "override"]
    assert _audit(db, assessment_id=a.id, entity="tiering")[0].from_value == "medium"
    with pytest.raises(HTTPException) as short:
        api.run_tiering(a.id, api.TieringIn(factors=HIGH, override=api.TierOverrideIn(tier="low", justification="meh")),
                        db=db, user=_user(db, OWNER))
    assert short.value.status_code == 400


# ── 2. a gate that sees the whole vendor ─────────────────────────────────────

def _payroll(db, v):
    made = engagements.create_engagement(v.id, engagements.EngagementIn(name="Payroll"), db=db, user=_user(db, OWNER))
    return db.get(TPRAEngagement, made["id"])


def _finding(db, v, a, severity="critical", status="open", **kw):
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity=severity, title="No MFA", status=status, **kw)
    db.add(f)
    db.commit()
    return f


def _at_approval(db, v, **kw):
    a = _work(db, v, "medium", "approval", skipped=("dd_planning",), **kw)
    a.residual_score, a.residual_rating, a.reviewed_by = 20.0, "low", REVIEWER
    db.commit()
    return a


def test_an_approval_is_refused_while_a_critical_stands_on_another_engagement(db):
    v = _vendor(db)
    general = _at_approval(db, v)
    payroll = _payroll(db, v)
    other = _work(db, v, "medium", "scoring", skipped=("dd_planning",), engagement=payroll)
    f = _finding(db, v, other)

    gate = service.evaluate_current(db, v, general, "approval")
    assert "1 critical or blocking finding(s) block approval (1 on Payroll)." in gate["blockers"]
    check = next(c for c in gate["checks"] if c["key"] == "no_blocking")
    assert (check["met"], check["fix"]) == (False, "findings")
    with pytest.raises(HTTPException) as refused:
        api.create_approval(general.id, api.ApprovalIn(decision="approve"), db=db, user=_user(db, APPROVER))
    assert refused.value.status_code == 400
    assert "1 critical or blocking finding(s) remain open (1 on Payroll)" in refused.value.detail
    # a critical on General holds the other engagement's findings stage in the same way
    on_general = _finding(db, v, general)
    assert service.evaluate_current(db, v, other, "findings")["blockers"] == [
        "2 critical or blocking finding(s) lack remediation or a signed risk acceptance (1 here, 1 on General)."]

    for done in (f, on_general):                       # closed, accepted with a signed acceptance, or fixed: it no longer holds
        done.status = "closed"
    db.commit()
    assert service.evaluate_current(db, v, other, "findings")["passed"] is True
    assert _decide(db, general)["decision"] == "approve"
    assert service.evaluate_current(db, v, general, "approval")["passed"] is True


def test_a_finding_marked_blocking_holds_the_gate_without_being_critical(db, monkeypatch):
    monkeypatch.setattr(TPRAFinding, "is_blocking", False, raising=False)     # the column B5a adds; absent counts as false
    v = _vendor(db)
    a = _at_approval(db, v)
    f = _finding(db, v, a, severity="medium")
    _decide(db, a)
    assert service.evaluate_current(db, v, a, "approval")["passed"] is True
    f.is_blocking = True
    gate = service.evaluate_current(db, v, a, "approval")
    assert gate["blockers"] == ["1 critical or blocking finding(s) block approval (1 here, 1 marked blocking)."]
    with pytest.raises(HTTPException) as refused:
        api.create_approval(a.id, api.ApprovalIn(decision="approve"), db=db, user=_user(db, APPROVER))
    assert refused.value.status_code == 400 and "marked blocking" in refused.value.detail


def test_the_gate_counts_a_finding_in_remediation_but_not_one_accepted_or_closed(db):
    v = _vendor(db)
    a = _at_approval(db, v)
    mid = _finding(db, v, a, status="in_remediation")
    assert service.gate_summary(db, v, a) == {"count": 1, "detail": None}              # the plain, old wording
    accepted = _finding(db, v, a, status="accepted")
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=accepted.id, accepted_by=APPROVER, status="active",
                              rationale="Compensating control", expiry=datetime.utcnow() + timedelta(days=30)))
    _finding(db, v, a, status="closed")
    done = _finding(db, v, a)
    db.add(TPRARemediation(tenant_id=1, finding_id=done.id, title="MFA everywhere", status="completed"))
    deleted = _finding(db, v, a)
    deleted.deleted_at = datetime.utcnow()
    db.commit()
    assert [f.id for f, _ in service.gate_findings(db, v)] == [mid.id]
    assert service.gate_count(db, a) == 1


def test_a_mediums_reviewer_is_asked_for_at_the_gate_though_planning_is_skipped(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "approval", skipped=("dd_planning",))
    a.residual_score = 20.0
    db.commit()
    gate = service.evaluate_current(db, v, a, "approval")
    assert "Name a reviewer in Assign duties (Security); 0 named so far." in gate["blockers"]
    reviewers = next(c for c in gate["checks"] if c["key"] == "reviewers")
    assert (reviewers["met"], reviewers["fix"]) == (False, "roster")
    a.team_roster = {"security": REVIEWER}
    db.commit()
    assert next(c for c in service.evaluate_current(db, v, a, "approval")["checks"] if c["key"] == "reviewers")["met"] is True
    # a Low supplier needs none, so its row is not drawn
    low = _work(db, _vendor(db, name="Small Co", tier="low"), "low", "approval")
    assert "reviewers" not in {c["key"] for c in service.evaluate_current(db, db.get(Vendor, low.vendor_id), low, "approval")["checks"]}


# ── 3. stage checks ──────────────────────────────────────────────────────────

def test_every_check_has_a_key_a_text_a_state_and_where_to_clear_it(db):
    v = _vendor(db, owner_id=None, data_access_level="none")
    a = service.ensure_active_assessment(db, v, actor_id=OWNER)
    gate = service.evaluate_current(db, v, a, "intake")
    assert [(c["key"], c["met"], c["fix"]) for c in gate["checks"]] == [
        ("named", True, "edit_vendor"), ("owner", False, "edit_vendor"), ("classified", False, "edit_vendor")]
    assert gate["blockers"] == ["A business owner must be assigned.", "A draft data classification is required."]
    assert gate["checks"][1]["detail"] == "A business owner must be assigned." and "detail" not in gate["checks"][0]
    assert evaluate_stage_exit("tiering", {})["checks"] == [
        {"key": "tiered", "text": "A tier has been set", "met": False, "fix": "tier",
         "detail": "Inherent risk tier has not been computed."}]


def test_a_check_that_cannot_be_answered_yet_is_null_and_never_blocks(db):
    gate = evaluate_stage_exit("questionnaire", {"responses_total": 0})
    assert gate["blockers"] == ["No questionnaire has been issued."]
    assert {c["key"]: c["met"] for c in gate["checks"]} == {
        "issued": False, "answered": None, "evidenced": None, "tier_questionnaires": True, "tier_evidence": True}
    partly = evaluate_stage_exit("questionnaire", {"responses_total": 10, "responses_answered": 7, "required_evidence_missing": 2})
    assert partly["blockers"] == ["3 of 10 questions remain unanswered.", "2 required evidence item(s) missing."]


def test_every_fix_a_check_names_is_one_the_screen_knows():
    from grc.modules.vendor_risk.tpra.engine_gates import FIXES
    ctx = {"tier": "high", "responses_total": 1, "responses_answered": 0, "tier_templates_unsent": ["Security"],
           "tier_questionnaires_unanswered": ["Security"], "tier_evidence_missing": ["SOC 2"], "required_reviewers": 2,
           "open_critical_unmitigated": 1}
    seen = {c["fix"] for stage in STAGE_KEYS for c in evaluate_stage_exit(stage, ctx)["checks"] if c["fix"]}
    assert seen and seen <= set(FIXES)


def test_onboarding_passes_only_when_its_checklist_is_done(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "onboarding", skipped=("dd_planning",))
    gate = service.evaluate_current(db, v, a, "onboarding")
    assert gate["passed"] is False and gate["blockers"] == ["Work through the onboarding checklist: 0 of 3 done."]
    assert service.advance_stage(db, v, a, actor_id=OWNER)["advanced"] is False

    def save(*done):
        items = [api.ChecklistItemIn(text=f"Step {i}", done=d) for i, d in enumerate(done)]
        api.save_stage_checklist(a.id, "onboarding", api.ChecklistIn(items=items), db=db, user=_user(db, OWNER))

    save(True, False)
    assert service.evaluate_current(db, v, a, "onboarding")["blockers"] == ["Work through the onboarding checklist: 1 of 2 done."]
    save(True, True)
    assert service.evaluate_current(db, v, a, "onboarding")["passed"] is True
    assert service.advance_stage(db, v, a, actor_id=OWNER)["to"] == "monitoring"


def test_monitoring_is_the_resting_state_and_the_last_stage_waits_for_a_new_cycle(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "monitoring", skipped=("dd_planning",))
    gate = service.evaluate_current(db, v, a, "monitoring")
    assert gate["passed"] is True and [(c["key"], c["met"]) for c in gate["checks"]] == [("steady_state", True)]

    assert service.advance_stage(db, v, a, actor_id=OWNER)["to"] == "reassessment"
    last = service.evaluate_current(db, v, a, "reassessment")
    assert last["passed"] is False and [(c["key"], c["met"]) for c in last["checks"]] == [("cycle_opened", False)]
    assert service.advance_stage(db, v, a, actor_id=OWNER)["advanced"] is False            # not a click's to settle

    new = service.create_reassessment_version(db, v, OWNER, "Annual review")
    db.commit()
    assert _status(db, a)["reassessment"] == "complete" and a.lifecycle_status == "superseded"
    assert service.evaluate_current(db, v, a, "reassessment")["passed"] is True            # settled by the new cycle
    assert new.current_stage == "dd_planning" and service.evaluate_current(db, v, new, "reassessment")["passed"] is False


def test_a_review_left_in_the_middle_by_a_new_cycle_keeps_its_last_stage_as_it_was(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "questionnaire", skipped=("dd_planning",))
    service.create_reassessment_version(db, v, OWNER, "A signal opened the next review")
    db.commit()
    assert _status(db, a)["reassessment"] == "not_started"


# ── 4. what the workspace reads ──────────────────────────────────────────────

def test_the_lifecycle_says_what_the_assessment_is_held_to_what_moved_it_and_why_a_stage_was_skipped(db):
    v = _vendor(db)
    a = _work(db, v, "medium", "contracting", skipped=("dd_planning",))
    service.run_tiering(db, v, a, actor_id=OWNER, factors=HIGH)
    db.commit()
    got = api.get_lifecycle(v.id, db=db, user=_user(db, OWNER))
    assert got["policy"]["tier"] == "high" and got["policy"]["skips"] == [] and got["policy"]["cadence_days"] == 365
    assert got["policy"]["thresholds"] == {"critical": 75.0, "high": 50.0, "medium": 25.0}
    assert got["policy"]["reviewers"] == ["security", "privacy"]
    assert got["retier_blocked"] is None
    assert [(h["action"], h["from"], h["to"], h["review"]) for h in got["history"]] == [
        ("send_back", "contracting", "dd_planning", 1), ("reopen", None, "dd_planning", 1)]
    assert got["history"][0]["reason"] == "Re-tiered to high, so due diligence planning now apply."
    assert got["history"][0]["actor"] == "User 7"
    assert got["gate"]["checks"] and all({"key", "text", "met", "fix"} <= set(c) for c in got["gate"]["checks"])

    service.run_tiering(db, v, a, actor_id=OWNER, factors=LOW)
    db.commit()
    again = api.get_lifecycle(v.id, db=db, user=_user(db, OWNER))
    assert again["policy"]["skips"] == ["dd_planning", "questionnaire", "scoring", "findings"]
    skipped = {s["stage_key"]: s for s in again["stages"]}["scoring"]
    assert skipped["status"] == "skipped" and skipped["skipped_by"] is None
    assert skipped["skipped_reason"] == "Auto-skipped — right-sized by inherent tier"
    assert ("skip", "scoring", None) in [(h["action"], h["from"], h["to"]) for h in again["history"]]


def test_a_condition_can_be_waived_with_a_reason_and_counts_as_done(db):
    v = _vendor(db)
    a = _at_approval(db, v)
    made = api.create_approval(a.id, api.ApprovalIn(decision="approve_with_conditions", conditions=["Share the pen test"]),
                               db=db, user=_user(db, APPROVER))
    cid = made["conditions"][0]["id"]
    with pytest.raises(HTTPException) as bare:
        api.update_condition(made["id"], cid, api.ConditionUpdate(waived=True), db=db, user=_user(db, APPROVER))
    assert bare.value.status_code == 400
    out = api.update_condition(made["id"], cid, api.ConditionUpdate(waived=True, reason="Covered by the SOC 2 report"),
                               db=db, user=_user(db, APPROVER))
    cond = out["conditions"][0]
    assert (cond["status"], cond["waived"], cond["waived_reason"], cond["waived_by"]) == (
        "closed", True, "Covered by the SOC 2 report", APPROVER)
    assert out["open_conditions"] == 0
    note = _audit(db, entity="approval", action="update")[-1]
    assert note.extra["waived"] is True and note.extra["reason"] == "Covered by the SOC 2 report"
    # meeting one is not waiving it; opening it again clears the waiver
    reopened = api.update_condition(made["id"], cid, api.ConditionUpdate(status="open"), db=db, user=_user(db, APPROVER))
    assert reopened["conditions"][0]["status"] == "open" and "waived" not in reopened["conditions"][0]


def test_the_approvers_list_marks_who_the_roster_designates(db):
    v = _vendor(db)
    a = _at_approval(db, v)
    db.add(TPRARoster(tenant_id=1, role="exec_approver", user_id=APPROVER))
    db.commit()
    items = {i["user_id"]: i for i in api.list_approvers(a.id, db=db, user=_user(db, APPROVER))["items"]}
    assert items[APPROVER]["designated"] is True and items[REVIEWER]["designated"] is False


def test_an_answer_that_only_holds_a_minimum_tier_is_noticed_when_it_changes():
    custom = {"questions": [
        {"key": "c_cards", "section": "data", "type": "yes_no", "label": "Does it hold card data?", "min_tier": "high"},
        {"key": "c_where", "section": "data", "type": "choice", "label": "Where is it hosted?",
         "options": [{"value": "eu", "label": "In the EU"}, {"value": "abroad", "label": "Abroad", "min_tier": "high"}]},
        {"key": "c_plain", "section": "data", "type": "yes_no", "label": "Is it a charity?"},
    ]}
    before = SimpleNamespace(intake={"answers": {"c_cards": "no", "c_where": "eu", "c_plain": "no"}})
    now = SimpleNamespace(intake={"answers": {"c_cards": "yes", "c_where": "abroad", "c_plain": "yes"}})
    recorded = intake.fingerprint(before, custom)
    assert {"c_cards", "c_where"} <= set(recorded) and "c_plain" not in recorded       # the plain one never held anything
    assert intake.changes_since(recorded, now, custom) == ["now yes: does it hold card data", "where is it hosted changed to Abroad"]
    assert intake.changes_since(recorded, before, custom) == []
