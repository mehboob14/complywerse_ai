"""The seven lifecycle defects on the guide's "fix first" list, each pinned.

1. Planning for a high or critical supplier could never pass: only the plan's one
   reviewer was counted, never the people named in Assign duties.
2. A Low supplier skips scoring, yet its approval was refused for having no residual.
3. Stage 4 counted text, choice and rating answers as unanswered.
4. The risk-register sync for vendor 1 also matched vendor 12 and vendor 1's own
   promoted findings, so one register entry could overwrite another.
5. The old "Approve Assessment" skipped segregation of duties, the tier's approver
   and the open-critical check that the lifecycle's approval applies.
6. An acceptance that ran out left its finding "accepted": still counted as mitigated.
7. A failed critical control floored the rating at high but left the grade an A.
"""
from datetime import datetime, time, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Risk, Role, Tenant, TPRAAuditLog, TPRAFinding, TPRAQuestion, TPRAQuestionResponse,
    TPRARemediation, TPRARiskAcceptance, TPRAStageInstance, TPRATieringConfig, UserRole, Vendor,
    VendorAssessment, VendorQuestionnaireResponse, VendorQuestionnaireTemplate,
)
from grc.modules.vendor_risk.routers import assessments as legacy
from grc.modules.vendor_risk.tpra import api, attention, dashboard, rbac, reminders, service, tier_policy
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.modules.vendor_risk.tpra.engine_gates import evaluate_stage_exit
from grc.modules.vendor_risk.tpra.engine_scoring import residual_to_grade, score_assessment
from grc.modules.vendor_risk.tpra.engine_tiering import FACTOR_KEYS

TODAY = datetime.utcnow().date()
POLICY = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
ASSESSOR, APPROVER, ANALYST = 70, 71, 72          # 70 and 71 are administrators; 72 is not


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", is_active=True)
               for uid in (7, ASSESSOR, APPROVER, ANALYST)])
    s.add_all([UserRole(user_id=uid, role_id=1, tenant_id=1) for uid in (ASSESSOR, APPROVER)])
    s.commit()
    yield s
    s.close()


def _vendor(db, **kw):
    v = Vendor(**{"tenant_id": 1, "name": "Acme Cloud", "tier": "high", "status": "active",
                  "data_access_level": "confidential", "data_types_accessed": ["PII"], "owner_id": 7, **kw})
    db.add(v)
    db.commit()
    return v


def _stage(db, a, key):
    return db.query(TPRAStageInstance).filter(TPRAStageInstance.assessment_id == a.id,
                                              TPRAStageInstance.stage_key == key).one()


def _user(db, uid):
    return db.get(GRCUser, uid)


# ── 1. reviewers named in Assign duties ──────────────────────────────────────

def test_planning_counts_the_different_people_named_to_review(db):
    v = _vendor(db, tier="critical")
    a = service.ensure_active_assessment(db, v, actor_id=7)
    a.inherent_tier, a.current_stage, a.template_id, a.reviewed_by = "critical", "dd_planning", 1, 21
    db.commit()
    assert service.evaluate_current(db, v, a, "dd_planning")["blockers"] == [
        "Name 3 different reviewers in Assign duties (Security, Privacy, Legal); 1 named so far."]

    # The owner, the TPRM team and the approver do not review it; one person in two seats is one reviewer.
    a.team_roster = {"business_owner": 30, "tprm_lead": 31, "tprm_analyst": 33, "exec_approver": 32,
                     "security": 21, "privacy": 22}
    db.commit()
    assert service.reviewers_assigned(db, a) == 2
    a.team_roster = {**a.team_roster, "legal": 23}
    db.commit()
    assert service.reviewers_assigned(db, a) == 3
    assert service.evaluate_current(db, v, a, "dd_planning")["passed"] is True


# ── 2. a Low supplier is approved on its inherent score ──────────────────────

def test_a_low_supplier_whose_tier_skips_scoring_is_approved_on_its_inherent_score(db):
    v = _vendor(db, tier="low", data_access_level="internal")
    a = service.ensure_active_assessment(db, v, actor_id=7)
    a.current_stage = "tiering"
    db.commit()
    service.run_tiering(db, v, a, actor_id=7, factors={**{k: 0 for k in FACTOR_KEYS}, "data_sensitivity": 1})
    db.commit()
    assert (a.inherent_tier, a.inherent_score, a.residual_score) == ("low", 7.5, None)
    assert _stage(db, a, "scoring").status == "skipped"

    decided = api.create_approval(a.id, api.ApprovalIn(decision="approve"), db=db, user=_user(db, APPROVER))
    assert decided["residual_rating"] == "low"
    db.refresh(a)
    db.refresh(v)
    assert (a.residual_score, a.residual_rating, v.residual_risk_score, v.risk_rating) == (7.5, "low", 7.5, "low")
    # Nothing was scored or graded to get there, and the basis is on the record.
    assert a.rating_grade is None and not a.domain_scores and db.query(TPRAQuestionResponse).count() == 0
    note = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "scoring").one()
    assert note.extra["rating_basis"] == "inherent_score" and "inherent score" in note.reason
    assert service.evaluate_current(db, v, a, "approval")["passed"] is True


def test_a_tier_that_must_be_scored_still_needs_a_score_to_be_approved(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=7)
    a.inherent_tier, a.inherent_score = "high", 60.0
    _stage(db, a, "scoring").status = "skipped"          # skipped while it was Low, then re-tiered
    db.commit()
    with pytest.raises(HTTPException) as refused:
        api.create_approval(a.id, api.ApprovalIn(decision="approve"), db=db, user=_user(db, APPROVER))
    assert refused.value.status_code == 400 and a.residual_score is None


# ── 3. every kind of answer counts ───────────────────────────────────────────

QUESTIONS = [
    {"id": "sdlc", "text": "Describe your SDLC.", "type": "text"},
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no"},
    {"id": "pen", "text": "How often are you pen tested?", "type": "multiple_choice", "options": ["Annually", "Never"]},
    {"id": "patching", "text": "Rate your patching.", "type": "rating"},
    {"id": "dr", "text": "Do you run a second data centre?", "type": "yes_no"},
]
ANSWERS = {"sdlc": "Agile with peer review", "mfa": "yes", "pen": "Annually", "patching": "4", "dr": "N/A"}


@pytest.mark.parametrize("saved_rows", [False, True])        # the portal's blob, then the per-question rows
def test_text_choice_rating_and_not_applicable_answers_all_count(db, saved_rows):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=7)
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Custom", questions=QUESTIONS)
    db.add(template)
    db.flush()
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=v.id, assessment_id=a.id, template_id=template.id,
                                     token="t-1", status="submitted", responses=dict(ANSWERS))
    db.add(qr)
    db.commit()

    def counted():
        if saved_rows:
            service.materialise_responses(db, a, qr)
            db.commit()
        ctx = service.build_stage_context(db, v, a, "questionnaire")
        return ctx["responses_answered"], ctx["responses_total"], evaluate_stage_exit("questionnaire", ctx)

    answered, total, gate = counted()
    assert (answered, total) == (5, 5) and not any("unanswered" in b for b in gate["blockers"])
    qr.responses = {k: x for k, x in ANSWERS.items() if k != "sdlc"}
    db.commit()
    answered, total, gate = counted()
    assert (answered, total) == (4, 5) and "1 of 5 questions remain unanswered." in gate["blockers"]


# ── 4. the register entry is the supplier's own ──────────────────────────────

def test_scoring_vendor_1_leaves_vendor_12_and_its_own_promoted_findings_alone(db):
    one, _ = _vendor(db, id=1, name="One"), _vendor(db, id=12, name="Twelve")
    others = [Risk(tenant_id=1, title="Third-party risk: Twelve", category="third_party", residual_score=33.0,
                   source_type="assessment", source_reference="vendor:12/vendor_assessment:99"),
              Risk(tenant_id=1, title="One: data leak", category="third_party", residual_score=85.0,
                   source_type="vendor", source_reference="vendor:1/tpra_finding:5")]
    db.add_all(others)
    db.commit()
    a = service.ensure_active_assessment(db, one, actor_id=7)
    service.run_tiering(db, one, a, actor_id=7)
    a.linked_risk_id = others[0].id                      # a link the old prefix match left behind
    q = TPRAQuestion(tenant_id=1, template_id=1, question_key="mfa", text="MFA?", qtype="yes_no", weight=1.0)
    db.add(q)
    db.flush()
    db.add(TPRAQuestionResponse(tenant_id=1, assessment_id=a.id, question_id=q.id, question_key="mfa", answer="Yes"))
    db.commit()

    for _ in range(2):                                    # a re-score updates the same entry
        service.run_scoring(db, one, a, actor_id=7)
        db.commit()
    own = db.query(Risk).filter(Risk.source_reference == f"vendor:1/vendor_assessment:{a.id}").one()
    assert a.linked_risk_id == own.id and own.title == "Third-party risk: One"
    assert [(r.title, r.residual_score) for r in others] == [("Third-party risk: Twelve", 33.0),
                                                             ("One: data leak", 85.0)]
    assert db.query(Risk).count() == 3


# ── 5. the old Approve button keeps the approval rules ───────────────────────

def _legacy_approve(db, a, uid):
    return legacy.approve_assessment(a.id, legacy.ApproveRequest(), db=db, current_user=_user(db, uid))


def test_the_old_approve_button_sends_a_lifecycle_assessment_to_its_approval_stage(db):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=7)
    a.status, a.inherent_score, a.residual_score = "reviewed", 60.0, 20.0
    db.commit()
    with pytest.raises(HTTPException) as refused:
        _legacy_approve(db, a, APPROVER)
    assert refused.value.status_code == 409 and "Approval stage" in refused.value.detail
    db.refresh(a)
    assert a.status == "reviewed"


def test_the_old_approve_button_applies_segregation_of_duties_and_the_critical_check(db):
    v = _vendor(db)
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="reviewed", assessed_by=ASSESSOR,
                         inherent_tier="high", inherent_score=60.0, residual_score=30.0)
    db.add(a)
    db.commit()
    with pytest.raises(HTTPException) as own_work:
        _legacy_approve(db, a, ASSESSOR)
    assert own_work.value.status_code == 403 and "Segregation of duties" in own_work.value.detail

    critical = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity="critical",
                           title="No MFA", status="open")
    db.add(critical)
    db.commit()
    with pytest.raises(HTTPException) as blocked:
        _legacy_approve(db, a, APPROVER)
    assert blocked.value.status_code == 400 and "1 unmitigated critical" in blocked.value.detail

    db.add(TPRARemediation(tenant_id=1, finding_id=critical.id, title="MFA everywhere", status="completed"))
    db.commit()
    assert _legacy_approve(db, a, APPROVER)["assessment"]["status"] == "approved"


def test_the_old_approve_button_needs_the_tiers_approver(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             tier_policy=tier_policy.clean({"high": {"approver_role": "CISO"}},
                                                           tier_policy.merged({}))))
    v = _vendor(db)
    a = VendorAssessment(tenant_id=1, vendor_id=v.id, status="reviewed", inherent_tier="high",
                         inherent_score=60.0, residual_score=30.0)
    db.add(a)
    db.commit()
    with pytest.raises(HTTPException) as refused:
        _legacy_approve(db, a, ANALYST)
    assert refused.value.status_code == 403 and "CISO role" in refused.value.detail


# ── 6. an acceptance that runs out reopens its finding ───────────────────────

def _accepted_critical_on_an_onboarded_vendor(db, expiry, acceptance_status="active", severity="critical"):
    v = _vendor(db)
    a = service.ensure_active_assessment(db, v, actor_id=7)
    a.current_stage = "monitoring"
    f = TPRAFinding(tenant_id=1, vendor_id=v.id, assessment_id=a.id, severity=severity, title="No MFA",
                    status="accepted", is_critical_control_fail=severity == "critical", created_by=7,
                    created_at=datetime.utcnow() - timedelta(days=3))
    db.add(f)
    db.flush()
    acceptance = TPRARiskAcceptance(tenant_id=1, finding_id=f.id, accepted_by=APPROVER, status=acceptance_status,
                                    rationale="Compensating control", expiry=expiry)
    db.add(acceptance)
    db.commit()
    return v, a, f, acceptance


def _sweep(db):
    reminders.run(db, 1, POLICY, today=TODAY, deliver=lambda *args: None)


def test_an_acceptance_that_ran_out_reopens_its_finding_once(db):
    ran_out = datetime.combine(TODAY - timedelta(days=1), time(9))
    v, a, f, acceptance = _accepted_critical_on_an_onboarded_vendor(db, ran_out)
    assert service.count_open_critical(db, a.id) == 1      # no longer mitigating, before the sweep is by

    _sweep(db)
    for row in (f, acceptance, v):
        db.refresh(row)
    assert (acceptance.status, f.status, v.status) == ("expired", "open", "suspended")
    reopened = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "finding", TPRAAuditLog.action == "reopen").one()
    assert (reopened.actor_id, reopened.reason) == (None, f"Acceptance expired on {ran_out:%d %b %Y}")
    # Open again everywhere: the approval gate and the counts that read the status.
    assert "1 unmitigated critical finding(s) block approval." in service.evaluate_current(db, v, a, "approval")["blockers"]
    board = api.lifecycle_board(db=db, user=_user(db, 7))
    assert next(i for i in board["items"] if i["vendor_id"] == v.id)["open_critical"] == 1

    rows = db.query(TPRAAuditLog).count()
    _sweep(db)                                             # a second run changes nothing
    db.refresh(f)
    assert f.status == "open" and db.query(TPRAAuditLog).count() == rows


def test_a_finding_left_accepted_by_an_earlier_lapse_is_reopened_too(db):
    _, _, f, _ = _accepted_critical_on_an_onboarded_vendor(db, datetime.utcnow() - timedelta(days=40), "expired")
    _sweep(db)
    db.refresh(f)
    assert f.status == "open"


def test_a_renewed_acceptance_keeps_its_finding_accepted(db):
    _, a, f, _ = _accepted_critical_on_an_onboarded_vendor(db, datetime.utcnow() - timedelta(days=30))
    db.add(TPRARiskAcceptance(tenant_id=1, finding_id=f.id, accepted_by=APPROVER, status="active",
                              expiry=datetime.utcnow() + timedelta(days=90)))
    db.commit()
    _sweep(db)
    db.refresh(f)
    assert f.status == "accepted" and service.count_open_critical(db, a.id) == 0


def test_revoking_an_acceptance_still_reopens_its_finding(db):
    _, a, f, acceptance = _accepted_critical_on_an_onboarded_vendor(db, datetime.utcnow() + timedelta(days=30))
    api.revoke_acceptance(acceptance.id, db=db, user=_user(db, APPROVER))
    db.refresh(f)
    assert f.status == "open" and service.count_open_critical(db, a.id) == 1
    assert db.query(TPRAAuditLog).filter(TPRAAuditLog.action == "reopen").one().actor_id == APPROVER


def test_a_lapsed_acceptance_stays_in_the_queue_until_someone_decides_again(db):
    _, _, f, _ = _accepted_critical_on_an_onboarded_vendor(
        db, datetime.combine(TODAY - timedelta(days=2), time(9)), severity="high")
    _sweep(db)

    def lapsed():
        return [i for i in attention.open_items(db, 1, TODAY, POLICY) if i["condition"] == "acceptance_expiring"]

    assert [i["record_id"] for i in lapsed()] and f.status == "open"      # reopened, nobody has decided yet
    api.create_remediation(f.id, api.RemediationIn(title="Roll out MFA"), db=db, user=_user(db, APPROVER))
    assert lapsed() == []


# ── 7. the grade follows the critical-control floor ──────────────────────────

GOOD_BUT_ONE_CRITICAL_FAILS = [{"domain": "cybersecurity", "answer": "Yes", "weight": 1.0}] * 9 + [
    {"domain": "cybersecurity", "answer": "No", "weight": 1.0, "critical_control": True}]


def test_a_failed_critical_control_grades_no_better_than_where_high_starts():
    out = score_assessment(GOOD_BUT_ONE_CRITICAL_FAILS, inherent_score=30.0)
    assert (out["residual_rating"], out["rating_basis"]) == ("high", "critical_control_floor")
    assert residual_to_grade(out["overall_residual"]) == "A"               # what the score alone would read
    assert out["rating_grade"] == residual_to_grade(50.0) == "D"
    # The cap moves with the tenant's thresholds.
    stricter = {**DEFAULT_TIERING_CONFIG, "thresholds": {"critical": 80.0, "high": 30.0, "medium": 15.0}}
    assert score_assessment(GOOD_BUT_ONE_CRITICAL_FAILS, 30.0, config=stricter)["rating_grade"] == "C"
    # Without a failed critical control the grade is the score's own.
    clean = score_assessment(GOOD_BUT_ONE_CRITICAL_FAILS[:9], inherent_score=30.0)
    assert clean["rating_grade"] == residual_to_grade(clean["overall_residual"])


def test_the_dashboard_grade_agrees_with_the_floored_rating(db, monkeypatch):
    monkeypatch.setattr(dashboard, "_tids", lambda user, db: [1])
    monkeypatch.setattr(dashboard, "_prep_tpra_db", lambda db, tids: None)
    _vendor(db, inherent_risk_score=30.0, residual_risk_score=11.1, risk_rating="high")
    top = dashboard.program_dashboard(scope="portfolio", db=db, user=_user(db, 7))["top_residual_vendors"]
    assert (top[0]["rating"], top[0]["grade"]) == ("high", "D")
