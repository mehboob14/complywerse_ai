"""ERM module sections dashboard.

Same architecture as the governance documents-overview: every ERM page is a
SECTION scored by its own formulas over its own tables. Sections are added
step by step (register + assessments first); the module performance score is
the weighted mean of the sections present, re-normalized, so it stays honest
while the module is being built out.

Score bands (likelihood 1-5 x impact 1-5, range 1-25): critical >= 20,
high >= 12, medium >= 6, low < 6 — the platform's existing bands.
"""
from typing import Optional
from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy.exc import SQLAlchemyError

from ....models import (
    Risk, RiskControlLink, RiskAssetLink, RiskEvidenceLink,
    RiskAssessment, RiskAssessmentRisk,
    FrameworkRiskAssessment, FrameworkRiskQuestion, FrameworkRiskQuestionEvidence,
    InternalControl, InternalControlTest, InternalControlRiskLink,
    RCSACampaign, RCSAAssessment, RCSAFinding, RCSAResponse, RCSAResponseEvidence,
    Vendor, VendorAssessment, TPRAFinding, TPRARemediation, TPRAMonitoringSignal,
    TPRAControlObligation,
    RiskKRI, RiskAppetiteConfig, RiskMitigationAction, RiskMitigationActionEvidence,
    RiskReview, RiskIncident,
    AIRiskAssessmentEntry,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["ERM Sections Dashboard"])

HIGH_RESIDUAL = 12.0  # high + critical band threshold
CRITICAL = 20.0


def _metric(key, label, weight, num, den, formula, inverse=False, empty_score=None):
    """inverse=True scores 1 - num/den (num counts the bad items)."""
    if den:
        pct = (num / den) * 100
        score = round(100 - pct, 1) if inverse else round(pct, 1)
    else:
        score = empty_score
    return {"key": key, "label": label, "weight": weight, "score": score,
            "numerator": num, "denominator": den, "formula": formula,
            "inverse": inverse, "target": 85}


def _section_score(metrics):
    avail = [m for m in metrics if m["score"] is not None]
    total_w = sum(m["weight"] for m in avail)
    if not avail or not total_w:
        return None
    return round(sum(m["score"] * m["weight"] for m in avail) / total_w, 1)


@router.get("/sections-overview")
def get_sections_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    scoped = [tenant_id] if (tenant_id and tenant_id in user_tenants) else user_tenants
    now = datetime.utcnow()
    today = date.today()

    if not scoped:
        return {"as_of": now.isoformat(), "sections": {}, "attention_queue": {},
                "performance": {"score": None, "grade": None, "components": []}}

    # ================= Risk Register =========================================
    risks = db.query(
        Risk.id, Risk.status, Risk.category, Risk.owner_id,
        Risk.inherent_score, Risk.residual_score,
        Risk.treatment_plan.isnot(None).label("has_plan"),
    ).filter(Risk.tenant_id.in_(scoped)).all()

    active = [r for r in risks if (r.status or "open") != "closed"]
    active_ids = {r.id for r in active}
    scored = [r for r in active if r.inherent_score is not None and r.residual_score is not None]
    high_residual = sum(1 for r in scored if (r.residual_score or 0) >= HIGH_RESIDUAL)
    critical_open = sum(1 for r in scored if (r.residual_score or 0) >= CRITICAL)
    sum_inherent = sum(r.inherent_score for r in scored)
    sum_residual = sum(r.residual_score for r in scored)
    reduction_pct = (round(((sum_inherent - sum_residual) / sum_inherent) * 100, 1)
                     if sum_inherent else None)
    owned = sum(1 for r in active if r.owner_id)
    treated = sum(1 for r in active
                  if r.has_plan or (r.status or "") in ("in_treatment", "mitigated", "accepted"))

    def link_ids(model):
        try:
            rows = db.query(model.risk_id).join(
                Risk, model.risk_id == Risk.id
            ).filter(Risk.tenant_id.in_(scoped)).all()
            return {r.risk_id for r in rows}
        except SQLAlchemyError:
            db.rollback()
            return set()

    linked_ids = (link_ids(RiskAssetLink) | link_ids(RiskControlLink)
                  | link_ids(RiskEvidenceLink) | link_ids(InternalControlRiskLink)) & active_ids

    register_metrics = [
        _metric("exposure_containment", "Exposure containment", 0.25, high_residual, len(scored),
                "1 - (active risks with residual score >= 12 (high/critical) / scored active risks)",
                inverse=True, empty_score=None),
        {"key": "risk_reduction", "label": "Risk reduction", "weight": 0.20,
         "score": reduction_pct,
         "numerator": round(sum_inherent - sum_residual, 1), "denominator": round(sum_inherent, 1),
         "formula": "(sum of inherent scores - sum of residual scores) / sum of inherent scores",
         "inverse": False, "target": 85},
        _metric("scoring_completeness", "Fully scored", 0.15, len(scored), len(active),
                "active risks with both inherent and residual scores / active risks"),
        _metric("ownership", "Ownership", 0.10, owned, len(active),
                "active risks with an assigned owner / active risks"),
        _metric("linkage", "Linked to context", 0.15, len(linked_ids), len(active),
                "active risks linked to >= 1 asset / control / evidence / active risks"),
        _metric("treatment_coverage", "Treatment defined", 0.15, treated, len(active),
                "active risks with a treatment plan or in treatment/mitigated/accepted status / active risks"),
    ]

    # ================= Risk Assessments ======================================
    try:
        manual = db.query(RiskAssessment.status).filter(
            RiskAssessment.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        manual = []
    try:
        fw = db.query(FrameworkRiskAssessment.id, FrameworkRiskAssessment.status).filter(
            FrameworkRiskAssessment.tenant_id.in_(scoped)).all()
        fw_ids = [f.id for f in fw]
        questions = db.query(
            FrameworkRiskQuestion.id, FrameworkRiskQuestion.status
        ).filter(FrameworkRiskQuestion.assessment_id.in_(fw_ids)).all() if fw_ids else []
        q_ids = [q.id for q in questions]
        evidenced_q = {r.question_id for r in db.query(
            FrameworkRiskQuestionEvidence.question_id
        ).filter(FrameworkRiskQuestionEvidence.question_id.in_(q_ids)).all()} if q_ids else set()
    except SQLAlchemyError:
        db.rollback()
        fw, questions, evidenced_q = [], [], set()

    manual_done = sum(1 for a in manual if a.status in ("approved", "closed"))
    fw_done = sum(1 for f in fw if f.status in ("completed", "archived"))
    assessments_total = len(manual) + len(fw)
    q_completed = [q for q in questions if q.status == "completed"]
    q_blocked = sum(1 for q in questions if q.status == "blocked")

    try:
        window_365 = now - timedelta(days=365)
        assessed_risk_ids = {r.risk_id for r in db.query(
            RiskAssessmentRisk.risk_id
        ).join(
            RiskAssessment, RiskAssessmentRisk.assessment_id == RiskAssessment.id
        ).filter(
            RiskAssessment.tenant_id.in_(scoped),
            RiskAssessmentRisk.assessed_at >= window_365,
            RiskAssessmentRisk.risk_id.isnot(None),
        ).all()} & active_ids
    except SQLAlchemyError:
        db.rollback()
        assessed_risk_ids = set()

    try:
        ai_entries = db.query(
            AIRiskAssessmentEntry.status, AIRiskAssessmentEntry.target_review_date
        ).filter(AIRiskAssessmentEntry.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        ai_entries = []
    ai_open = [e for e in ai_entries if (e.status or "Open").lower() != "closed"]
    ai_overdue = sum(1 for e in ai_open
                     if e.target_review_date and e.target_review_date < today)

    assessments_metrics = [
        _metric("assessment_completion", "Assessments completed", 0.25,
                manual_done + fw_done, assessments_total,
                "(manual assessments approved/closed + framework assessments completed) / all assessments"),
        _metric("question_progress", "Question progress", 0.20, len(q_completed), len(questions),
                "framework assessment questions completed / all framework questions"),
        _metric("register_coverage", "Register coverage 12m", 0.20,
                len(assessed_risk_ids), len(active),
                "distinct active risks assessed in the last 12 months / active risks"),
        _metric("evidence_support", "Evidence-backed answers", 0.15,
                len(evidenced_q & {q.id for q in q_completed}), len(q_completed),
                "completed framework questions with >= 1 evidence file / completed questions"),
        _metric("ai_review_health", "AI entries reviewed", 0.20, ai_overdue, len(ai_open),
                "1 - (open AI risk entries past their target review date / open AI entries)",
                inverse=True, empty_score=100),
    ]

    # ================= RCSA ===================================================
    try:
        campaigns = db.query(RCSACampaign.id, RCSACampaign.status, RCSACampaign.due_date).filter(
            RCSACampaign.tenant_id.in_(scoped)).all()
        live_campaign_ids = {c.id for c in campaigns if c.status in ("active", "closed")}
        campaign_due = {c.id: c.due_date for c in campaigns}
        rcsa_assessments = db.query(
            RCSAAssessment.id, RCSAAssessment.campaign_id, RCSAAssessment.status,
            RCSAAssessment.submitted_at,
        ).filter(RCSAAssessment.tenant_id.in_(scoped)).all()
        rcsa_findings = db.query(RCSAFinding.status).filter(
            RCSAFinding.tenant_id.in_(scoped)).all()
        a_ids = [a.id for a in rcsa_assessments]
        responses = db.query(RCSAResponse.id).filter(
            RCSAResponse.assessment_id.in_(a_ids)).all() if a_ids else []
        r_ids = [r.id for r in responses]
        evidenced_responses = {e.response_id for e in db.query(
            RCSAResponseEvidence.response_id
        ).filter(RCSAResponseEvidence.response_id.in_(r_ids)).all()} if r_ids else set()
    except SQLAlchemyError:
        db.rollback()
        campaigns, live_campaign_ids, campaign_due = [], set(), {}
        rcsa_assessments, rcsa_findings, responses, evidenced_responses = [], [], [], set()

    in_live = [a for a in rcsa_assessments if a.campaign_id in live_campaign_ids]
    submitted_family = [a for a in in_live if a.status in ("submitted", "under_review", "approved")]
    rcsa_approved = sum(1 for a in in_live if a.status == "approved")
    submitted_dated = [a for a in submitted_family
                       if a.submitted_at and campaign_due.get(a.campaign_id)]
    on_time_submissions = sum(1 for a in submitted_dated
                              if a.submitted_at <= campaign_due[a.campaign_id])
    findings_resolved = sum(1 for f in rcsa_findings
                            if f.status in ("remediated", "accepted", "closed"))
    rcsa_open_findings = sum(1 for f in rcsa_findings if f.status in ("open", "in_progress"))

    rcsa_metrics = [
        _metric("submission_rate", "Assessments submitted", 0.25,
                len(submitted_family), len(in_live),
                "assessments submitted / under review / approved / all assessments in active+closed campaigns"),
        _metric("approval_progress", "Approved through pipeline", 0.20,
                rcsa_approved, len(submitted_family),
                "assessments approved / assessments submitted into the approval pipeline"),
        _metric("findings_remediation", "Findings resolved", 0.30,
                findings_resolved, len(rcsa_findings),
                "findings remediated / accepted / closed / all RCSA findings"),
        _metric("response_evidence", "Evidence-backed responses", 0.15,
                len(evidenced_responses), len(responses),
                "assessment responses with >= 1 evidence file / all responses"),
        _metric("submission_timeliness", "Submitted on time", 0.10,
                on_time_submissions, len(submitted_dated),
                "assessments submitted on/before their campaign due date / submitted assessments with dates"),
    ]

    # ================= Internal Controls ======================================
    try:
        ic = db.query(
            InternalControl.id, InternalControl.status,
            InternalControl.design_effectiveness, InternalControl.operating_effectiveness,
            InternalControl.is_key_control, InternalControl.next_test_date,
        ).filter(InternalControl.tenant_id.in_(scoped)).all()
        ic_ids = [c.id for c in ic]
        tested_ids = {t.control_id for t in db.query(InternalControlTest.control_id).filter(
            InternalControlTest.control_id.in_(ic_ids)).all()} if ic_ids else set()
        ic_risk_linked = {l.control_id for l in db.query(InternalControlRiskLink.control_id).filter(
            InternalControlRiskLink.control_id.in_(ic_ids)).all()} if ic_ids else set()
    except SQLAlchemyError:
        db.rollback()
        ic, tested_ids, ic_risk_linked = [], set(), set()

    ic_active = [c for c in ic if c.status == "active"]
    ic_active_ids = {c.id for c in ic_active}
    ic_tested_active = tested_ids & ic_active_ids
    ic_effective = sum(1 for c in ic_active
                       if c.id in tested_ids
                       and c.design_effectiveness == "effective"
                       and c.operating_effectiveness == "effective")
    ic_with_next = [c for c in ic_active if c.next_test_date]
    ic_test_overdue = sum(1 for c in ic_with_next if c.next_test_date < now)

    controls_metrics = [
        _metric("activation", "Active controls", 0.20, len(ic_active), len(ic),
                "controls in active status / all internal controls"),
        _metric("test_coverage", "Tested", 0.25, len(ic_tested_active), len(ic_active),
                "active controls with >= 1 recorded test / active controls"),
        _metric("effectiveness", "Fully effective", 0.30, ic_effective, len(ic_tested_active),
                "tested active controls with design AND operating effectiveness = effective / tested active controls"),
        _metric("risk_linkage", "Linked to risks", 0.15, len(ic_risk_linked & ic_active_ids), len(ic_active),
                "active controls linked to >= 1 risk / active controls"),
        _metric("test_currency", "Test schedule kept", 0.10, ic_test_overdue, len(ic_with_next),
                "1 - (active controls past their next test date / active controls with a test schedule)",
                inverse=True, empty_score=100),
    ]

    # ================= Vendor Risk (TPRA) =====================================
    try:
        vendors = db.query(
            Vendor.id, Vendor.status, Vendor.tier, Vendor.next_reassessment_date,
            Vendor.residual_risk_score, Vendor.deleted_at,
        ).filter(Vendor.tenant_id.in_(scoped)).all()
        v_assessments = db.query(
            VendorAssessment.status, VendorAssessment.lifecycle_status,
            VendorAssessment.due_date, VendorAssessment.completed_at,
            VendorAssessment.deleted_at,
        ).filter(VendorAssessment.tenant_id.in_(scoped)).all()
        t_findings = db.query(TPRAFinding.status, TPRAFinding.severity,
                              TPRAFinding.deleted_at).filter(
            TPRAFinding.tenant_id.in_(scoped)).all()
        t_rems = db.query(TPRARemediation.status, TPRARemediation.due_date).filter(
            TPRARemediation.tenant_id.in_(scoped)).all()
        t_signals = db.query(TPRAMonitoringSignal.acknowledged).filter(
            TPRAMonitoringSignal.tenant_id.in_(scoped)).all()
        t_obligations = db.query(TPRAControlObligation.status).filter(
            TPRAControlObligation.tenant_id.in_(scoped),
            TPRAControlObligation.deleted_at.is_(None)).all()
    except SQLAlchemyError:
        db.rollback()
        vendors, v_assessments, t_findings, t_rems, t_signals = [], [], [], [], []
        t_obligations = []

    live_vendors = [v for v in vendors if not v.deleted_at and (v.status or "active") == "active"]
    v_with_date = [v for v in live_vendors if v.next_reassessment_date]
    v_overdue = sum(1 for v in v_with_date if v.next_reassessment_date < now)
    v_scored = sum(1 for v in live_vendors if v.residual_risk_score is not None)
    current_assessments = [a for a in v_assessments
                           if not a.deleted_at and a.lifecycle_status == "active"]
    va_done = sum(1 for a in current_assessments if a.status in ("completed", "approved"))
    live_findings = [f for f in t_findings if not f.deleted_at]
    tf_closed = sum(1 for f in live_findings if f.status in ("closed", "accepted"))
    tf_open_critical = sum(1 for f in live_findings
                           if f.status in ("open", "in_remediation") and f.severity == "critical")
    rem_open = [r for r in t_rems if r.status in ("open", "in_progress", "overdue")]
    rem_overdue = sum(1 for r in rem_open
                      if r.status == "overdue" or (r.due_date and r.due_date < now))
    signals_ack = sum(1 for s in t_signals if s.acknowledged)

    obligations_met = sum(1 for o in t_obligations if o.status in ("met", "waived"))
    obligations_breached = sum(1 for o in t_obligations if o.status == "breached")

    vendor_metrics = [
        _metric("reassessment_currency", "Reassessments current", 0.20, v_overdue, len(v_with_date),
                "1 - (active vendors past their next reassessment date / active vendors with a reassessment date)",
                inverse=True, empty_score=100),
        _metric("vendor_scoring", "Vendors risk-scored", 0.15, v_scored, len(live_vendors),
                "active vendors with a residual risk score / active vendors"),
        _metric("assessment_completion", "Assessments completed", 0.15,
                va_done, len(current_assessments),
                "current (non-superseded) vendor assessments completed or approved / current assessments"),
        _metric("findings_closure", "Findings closed", 0.20, tf_closed, len(live_findings),
                "TPRA findings closed or accepted / all TPRA findings"),
        _metric("remediation_timeliness", "Remediations on time", 0.10, rem_overdue, len(rem_open),
                "1 - (overdue remediations / open remediations)", inverse=True, empty_score=100),
        _metric("signal_triage", "Signals acknowledged", 0.10, signals_ack, len(t_signals),
                "monitoring signals acknowledged / all monitoring signals"),
        _metric("obligations_met", "Contract obligations met", 0.10,
                obligations_met, len(t_obligations),
                "contract control obligations met or waived / all contract obligations"),
    ]

    # ================= KRIs ===================================================
    FRESHNESS_WINDOWS = {"daily": 2, "weekly": 10, "monthly": 35,
                         "quarterly": 100, "annually": 380, "annual": 380}

    def kri_is_red(k) -> bool:
        if k.current_value is None or k.amber_threshold is None:
            return False
        if (k.threshold_direction or "lower_is_better").startswith("higher"):
            return k.current_value < k.amber_threshold
        return k.current_value > k.amber_threshold

    try:
        kris = db.query(
            RiskKRI.risk_id, RiskKRI.current_value, RiskKRI.green_threshold,
            RiskKRI.amber_threshold, RiskKRI.threshold_direction,
            RiskKRI.frequency, RiskKRI.last_measured_at, RiskKRI.is_active,
        ).join(Risk, RiskKRI.risk_id == Risk.id).filter(Risk.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        kris = []

    active_kris = [k for k in kris if k.is_active]
    red_kris = sum(1 for k in active_kris if kri_is_red(k))
    fresh_kris = sum(
        1 for k in active_kris
        if k.last_measured_at and k.last_measured_at >=
        now - timedelta(days=FRESHNESS_WINDOWS.get((k.frequency or "monthly").lower(), 35))
    )
    high_res_ids = {r.id for r in scored if (r.residual_score or 0) >= HIGH_RESIDUAL
                    and r.id in active_ids}
    kri_risk_ids = {k.risk_id for k in active_kris}
    high_covered = len(high_res_ids & kri_risk_ids)

    kris_metrics = [
        _metric("signal_health", "Signal health", 0.40, red_kris, len(active_kris),
                "1 - (red KRIs / active KRIs)", inverse=True, empty_score=100),
        _metric("measurement_freshness", "Measured on schedule", 0.35,
                fresh_kris, len(active_kris),
                "active KRIs measured within their frequency window / active KRIs"),
        _metric("high_risk_coverage", "High risks monitored", 0.25,
                high_covered, len(high_res_ids),
                "active risks with residual >= 12 having >= 1 active KRI / active risks with residual >= 12"),
    ]

    # ================= Risk Appetite ==========================================
    try:
        appetite_cfgs = db.query(
            RiskAppetiteConfig.category, RiskAppetiteConfig.max_acceptable_score,
            RiskAppetiteConfig.tolerance_threshold,
        ).filter(RiskAppetiteConfig.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        appetite_cfgs = []

    limit_by_cat = {c.category: (c.tolerance_threshold or c.max_acceptable_score or 12.0)
                    for c in appetite_cfgs}
    register_cats = {(r.category or "operational") for r in active}
    configured_present = {c for c in limit_by_cat if c in register_cats}
    scored_in_configured = [r for r in scored if (r.category or "operational") in limit_by_cat]
    appetite_breaches = sum(1 for r in scored_in_configured
                            if (r.residual_score or 0) > limit_by_cat[(r.category or "operational")])

    appetite_metrics = [
        _metric("appetite_compliance", "Within appetite", 0.60,
                appetite_breaches, len(scored_in_configured),
                "1 - (scored active risks above their category limit / scored active risks in configured categories)",
                inverse=True, empty_score=None),
        _metric("config_coverage", "Categories configured", 0.40,
                len(configured_present), len(register_cats),
                "risk categories with an appetite threshold / categories present in the register"),
    ]

    # ================= Mitigation Actions =====================================
    try:
        actions = db.query(
            RiskMitigationAction.id, RiskMitigationAction.status,
            RiskMitigationAction.due_date, RiskMitigationAction.evidence_id,
        ).join(Risk, RiskMitigationAction.risk_id == Risk.id).filter(
            Risk.tenant_id.in_(scoped)).all()
        evidenced_actions = {r.mitigation_action_id for r in db.query(
            RiskMitigationActionEvidence.mitigation_action_id
        ).filter(RiskMitigationActionEvidence.tenant_id.in_(scoped)).all()}
    except SQLAlchemyError:
        db.rollback()
        actions, evidenced_actions = [], set()

    open_actions = [a for a in actions if a.status in ("open", "in_progress", "overdue")]
    overdue_actions = sum(1 for a in open_actions
                          if a.status == "overdue" or (a.due_date and a.due_date < now))
    completed_actions = [a for a in actions if a.status == "completed"]
    evidenced_completed = sum(1 for a in completed_actions
                              if a.evidence_id or a.id in evidenced_actions)

    mitigation_metrics = [
        _metric("timeliness", "On schedule", 0.40, overdue_actions, len(open_actions),
                "1 - (overdue mitigation actions / open mitigation actions)",
                inverse=True, empty_score=100),
        _metric("completion", "Completed", 0.35, len(completed_actions), len(actions),
                "completed mitigation actions / all mitigation actions"),
        _metric("evidence_backed", "Evidence-backed", 0.25,
                evidenced_completed, len(completed_actions),
                "completed actions with linked evidence / completed actions"),
    ]

    # ================= Risk Reviews ===========================================
    try:
        reviews = db.query(
            RiskReview.risk_id, RiskReview.status, RiskReview.due_date,
            RiskReview.completed_at,
        ).join(Risk, RiskReview.risk_id == Risk.id).filter(
            Risk.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        reviews = []

    done_reviews = [r for r in reviews
                    if r.completed_at or r.status in ("approved", "completed")]
    open_reviews = [r for r in reviews
                    if not r.completed_at and r.status in ("pending", "in_review")]
    overdue_reviews = sum(1 for r in open_reviews if r.due_date and r.due_date < now)
    window_365 = now - timedelta(days=365)
    done_365 = [r for r in done_reviews if r.completed_at and r.completed_at >= window_365]
    reviewed_risk_ids = {r.risk_id for r in done_365} & active_ids
    on_time_reviews = sum(1 for r in done_365 if r.due_date and r.completed_at <= r.due_date)

    reviews_metrics = [
        _metric("schedule_health", "Schedule health", 0.40, overdue_reviews, len(open_reviews),
                "1 - (overdue risk reviews / open scheduled reviews)",
                inverse=True, empty_score=100),
        _metric("review_currency", "Register reviewed 12m", 0.35,
                len(reviewed_risk_ids), len(active),
                "distinct active risks reviewed in the last 12 months / active risks"),
        _metric("on_time_rate", "Completed on time", 0.25,
                on_time_reviews, len(done_365),
                "reviews completed on/before their due date / completed reviews, last 12 months"),
    ]

    # ================= Incidents ==============================================
    try:
        incidents = db.query(
            RiskIncident.severity, RiskIncident.status, RiskIncident.risk_id,
            RiskIncident.incident_date, RiskIncident.discovered_date,
        ).filter(RiskIncident.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        incidents = []

    inc_12m = [i for i in incidents
               if (i.incident_date or i.discovered_date)
               and (i.incident_date or i.discovered_date) >= window_365]
    inc_resolved_12m = sum(1 for i in inc_12m if i.status in ("resolved", "closed"))
    inc_open = [i for i in incidents if i.status not in ("resolved", "closed")]
    inc_open_critical = sum(1 for i in inc_open
                            if (i.severity or "").lower() in ("critical", "high"))
    inc_linked = sum(1 for i in incidents if i.risk_id)

    incidents_metrics = [
        _metric("resolution_rate", "Resolved 12m", 0.40, inc_resolved_12m, len(inc_12m),
                "incidents resolved or closed / incidents opened in the last 12 months"),
        _metric("critical_containment", "Critical contained", 0.35,
                inc_open_critical, len(inc_open),
                "1 - (open critical/high incidents / open incidents)",
                inverse=True, empty_score=100),
        _metric("risk_linkage", "Linked to risks", 0.25, inc_linked, len(incidents),
                "incidents linked to a register risk / all incidents"),
    ]

    sections = {
        "register": {
            "key": "register", "label": "Risk Register", "weight": 0.18,
            "score": _section_score(register_metrics), "metrics": register_metrics,
            "counts": {
                "total": len(risks), "active": len(active), "scored": len(scored),
                "high_residual": high_residual, "critical_open": critical_open,
                "avg_residual": round(sum_residual / len(scored), 1) if scored else None,
                "linked": len(linked_ids), "owned": owned,
            },
        },
        "assessments": {
            "key": "assessments", "label": "Risk Assessments", "weight": 0.14,
            "score": _section_score(assessments_metrics), "metrics": assessments_metrics,
            "counts": {
                "manual_total": len(manual), "manual_done": manual_done,
                "framework_total": len(fw), "framework_done": fw_done,
                "questions_total": len(questions), "questions_completed": len(q_completed),
                "questions_blocked": q_blocked,
                "ai_entries": len(ai_entries), "ai_open": len(ai_open), "ai_overdue": ai_overdue,
                "risks_assessed_12m": len(assessed_risk_ids),
            },
        },
        "rcsa": {
            "key": "rcsa", "label": "RCSA", "weight": 0.09,
            "score": _section_score(rcsa_metrics), "metrics": rcsa_metrics,
            "counts": {
                "campaigns_total": len(campaigns),
                "campaigns_active": sum(1 for c in campaigns if c.status == "active"),
                "assessments_in_campaigns": len(in_live),
                "pending_assessments": sum(1 for a in in_live
                                           if a.status in ("not_started", "in_progress")),
                "open_findings": rcsa_open_findings,
                "responses": len(responses),
            },
        },
        "controls": {
            "key": "controls", "label": "Internal Controls", "weight": 0.09,
            "score": _section_score(controls_metrics), "metrics": controls_metrics,
            "counts": {
                "total": len(ic), "active": len(ic_active),
                "key_controls": sum(1 for c in ic if c.is_key_control),
                "pending_approval": sum(1 for c in ic if c.status == "pending_approval"),
                "tested": len(ic_tested_active), "tests_overdue": ic_test_overdue,
            },
        },
        "vendor_risk": {
            "key": "vendor_risk", "label": "Vendor Risk", "weight": 0.08,
            "score": _section_score(vendor_metrics), "metrics": vendor_metrics,
            "counts": {
                "vendors_active": len(live_vendors),
                "vendors_overdue_reassessment": v_overdue,
                "assessments_current": len(current_assessments),
                "findings_open": sum(1 for f in live_findings
                                     if f.status in ("open", "in_remediation")),
                "findings_open_critical": tf_open_critical,
                "remediations_open": len(rem_open),
                "signals_unacknowledged": len(t_signals) - signals_ack,
                "obligations_total": len(t_obligations),
                "obligations_breached": obligations_breached,
            },
        },
        "kris": {
            "key": "kris", "label": "Key Risk Indicators", "weight": 0.09,
            "score": _section_score(kris_metrics), "metrics": kris_metrics,
            "counts": {"total": len(kris), "active": len(active_kris), "red": red_kris,
                       "fresh": fresh_kris, "high_risks": len(high_res_ids),
                       "high_risks_covered": high_covered},
        },
        "appetite": {
            "key": "appetite", "label": "Risk Appetite", "weight": 0.09,
            "score": _section_score(appetite_metrics), "metrics": appetite_metrics,
            "counts": {"configs": len(appetite_cfgs), "categories_present": len(register_cats),
                       "breaches": appetite_breaches,
                       "scored_in_configured": len(scored_in_configured)},
        },
        "mitigation": {
            "key": "mitigation", "label": "Mitigation Actions", "weight": 0.10,
            "score": _section_score(mitigation_metrics), "metrics": mitigation_metrics,
            "counts": {"total": len(actions), "open": len(open_actions),
                       "overdue": overdue_actions, "completed": len(completed_actions),
                       "evidence_backed": evidenced_completed},
        },
        "reviews": {
            "key": "reviews", "label": "Risk Reviews", "weight": 0.09,
            "score": _section_score(reviews_metrics), "metrics": reviews_metrics,
            "counts": {"open": len(open_reviews), "overdue": overdue_reviews,
                       "completed_12m": len(done_365),
                       "risks_reviewed_12m": len(reviewed_risk_ids)},
        },
        "incidents": {
            "key": "incidents", "label": "Incidents", "weight": 0.05,
            "score": _section_score(incidents_metrics), "metrics": incidents_metrics,
            "counts": {"total": len(incidents), "open": len(inc_open),
                       "open_critical": inc_open_critical,
                       "opened_12m": len(inc_12m), "resolved_12m": inc_resolved_12m},
        },
    }

    components = [{"key": s["key"], "label": s["label"], "score": s["score"],
                   "weight": s["weight"], "target": 85} for s in sections.values()]
    scored_comps = [c for c in components if c["score"] is not None]
    weight_sum = sum(c["weight"] for c in scored_comps)
    performance_score = (round(sum(c["score"] * c["weight"] for c in scored_comps) / weight_sum, 1)
                         if scored_comps and weight_sum else None)
    if performance_score is None:
        grade = None
    elif performance_score >= 85:
        grade = "excellent"
    elif performance_score >= 70:
        grade = "good"
    elif performance_score >= 50:
        grade = "fair"
    else:
        grade = "poor"

    return {
        "as_of": now.isoformat(),
        "sections": sections,
        "attention_queue": {
            "critical_open_risks": critical_open,
            "unscored_active_risks": len(active) - len(scored),
            "blocked_questions": q_blocked,
            "overdue_ai_reviews": ai_overdue,
            "rcsa_open_findings": rcsa_open_findings,
            "controls_tests_overdue": ic_test_overdue,
            "vendor_overdue_reassessments": v_overdue,
            "vendor_critical_findings": tf_open_critical,
            "vendor_overdue_remediations": rem_overdue,
            "red_kris": red_kris,
            "appetite_breaches": appetite_breaches,
            "overdue_mitigation_actions": overdue_actions,
            "overdue_risk_reviews": overdue_reviews,
            "open_critical_incidents": inc_open_critical,
            "total": (critical_open + (len(active) - len(scored)) + q_blocked + ai_overdue
                      + rcsa_open_findings + ic_test_overdue + v_overdue
                      + tf_open_critical + rem_overdue
                      + red_kris + appetite_breaches + overdue_actions
                      + overdue_reviews + inc_open_critical),
        },
        "performance": {
            "score": performance_score,
            "grade": grade,
            "formula": ("weighted mean of section scores: register 18% + assessments 14% + rcsa 9% "
                        "+ controls 9% + vendor risk 8% + kris 9% + appetite 9% + mitigation 10% "
                        "+ reviews 9% + incidents 5%"),
            "components": components,
        },
    }
