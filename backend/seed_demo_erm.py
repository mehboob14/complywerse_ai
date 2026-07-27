"""Seed a demo ERM data set — step 1: Risk Register + Risk Assessments only
(matching the two sections live in /erm/dashboard/sections-overview).
Later steps extend this seeder as more ERM sections come online.

Everything is tagged: risk/assessment titles start with ``[DEMO]`` so the set
can be removed cleanly.

Usage (from backend/):
    python seed_demo_erm.py seed     [--tenant complyverse]
    python seed_demo_erm.py cleanup  [--tenant complyverse]
"""
import argparse
import sys
from datetime import datetime, timedelta, date

from grc.models import (
    GRCUser, Risk, RiskAssetLink, RiskEvidenceLink, RiskControlLink,
    RiskAssessment, RiskAssessmentRisk,
    FrameworkRiskAssessment, FrameworkRiskQuestion, FrameworkRiskQuestionEvidence,
    AIRiskAssessmentEntry, ITAsset, Evidence, NormalizedControl, UploadedFramework,
    BusinessUnit,
    RCSATemplate, RCSAQuestion, RCSACampaign, RCSAAssessment, RCSAResponse,
    RCSAResponseEvidence, RCSAFinding,
    InternalControl, InternalControlTest, InternalControlRiskLink,
    Vendor, VendorAssessment, TPRAFinding, TPRARemediation, TPRAMonitoringSignal,
    TPRAContract, TPRAControlObligation,
    RiskKRI, RiskAppetiteConfig, RiskMitigationAction, RiskReview, RiskIncident,
)
from grc.models._38_database_initialization_functions import open_tenant_session
from grc.routers.auth_router import get_user_tenants


def _ensure_model_columns(db, models):
    """Tenant DBs provisioned before a model gained columns miss them (create_all
    only adds tables). Add any missing columns additively, like the app's own
    lazy self-heals."""
    from sqlalchemy import text
    dialect = db.get_bind().dialect
    for mdl in models:
        t = mdl.__table__
        existing = {r[0] for r in db.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_name=:t"
        ), {"t": t.name})}
        for col in t.columns:
            if col.name in existing:
                continue
            ddl_type = col.type.compile(dialect=dialect)
            db.execute(text(
                f'ALTER TABLE {t.name} ADD COLUMN IF NOT EXISTS "{col.name}" {ddl_type}'))
    db.commit()


def demo_risk_ids(db):
    return [r.id for r in db.query(Risk.id).filter(Risk.title.like("[DEMO]%")).all()]


def cleanup(db):
    removed = {}
    rids = demo_risk_ids(db)
    if rids:
        for model, key in [(RiskAssetLink, "asset_links"), (RiskEvidenceLink, "evidence_links"),
                           (RiskControlLink, "control_links"), (RiskAssessmentRisk, "assessment_risks")]:
            removed[key] = db.query(model).filter(model.risk_id.in_(rids)).delete(synchronize_session=False)
    demo_assessments = db.query(RiskAssessment).filter(RiskAssessment.name.like("[DEMO]%")).all()
    for a in demo_assessments:
        db.query(RiskAssessmentRisk).filter(
            RiskAssessmentRisk.assessment_id == a.id).delete(synchronize_session=False)
        db.delete(a)
    removed["assessments"] = len(demo_assessments)
    demo_fw = db.query(FrameworkRiskAssessment).filter(
        FrameworkRiskAssessment.name.like("[DEMO]%")).all()
    for f in demo_fw:
        q_ids = [q.id for q in db.query(FrameworkRiskQuestion.id).filter(
            FrameworkRiskQuestion.assessment_id == f.id).all()]
        if q_ids:
            db.query(FrameworkRiskQuestionEvidence).filter(
                FrameworkRiskQuestionEvidence.question_id.in_(q_ids)).delete(synchronize_session=False)
        db.query(FrameworkRiskQuestion).filter(
            FrameworkRiskQuestion.assessment_id == f.id).delete(synchronize_session=False)
        db.delete(f)
    removed["framework_assessments"] = len(demo_fw)
    removed["ai_entries"] = db.query(AIRiskAssessmentEntry).filter(
        AIRiskAssessmentEntry.ai_system_use_case.like("[DEMO]%")
    ).delete(synchronize_session=False)
    # RCSA demo set
    for tmpl in db.query(RCSATemplate).filter(RCSATemplate.name.like("[DEMO]%")).all():
        for camp in db.query(RCSACampaign).filter(RCSACampaign.template_id == tmpl.id).all():
            a_ids = [a.id for a in db.query(RCSAAssessment.id).filter(
                RCSAAssessment.campaign_id == camp.id).all()]
            if a_ids:
                r_ids = [r.id for r in db.query(RCSAResponse.id).filter(
                    RCSAResponse.assessment_id.in_(a_ids)).all()]
                if r_ids:
                    db.query(RCSAResponseEvidence).filter(
                        RCSAResponseEvidence.response_id.in_(r_ids)).delete(synchronize_session=False)
                db.query(RCSAResponse).filter(
                    RCSAResponse.assessment_id.in_(a_ids)).delete(synchronize_session=False)
                db.query(RCSAFinding).filter(
                    RCSAFinding.assessment_id.in_(a_ids)).delete(synchronize_session=False)
                db.query(RCSAAssessment).filter(
                    RCSAAssessment.id.in_(a_ids)).delete(synchronize_session=False)
            db.delete(camp)
        db.query(RCSAQuestion).filter(RCSAQuestion.template_id == tmpl.id).delete(synchronize_session=False)
        db.delete(tmpl)
        removed["rcsa_templates"] = removed.get("rcsa_templates", 0) + 1
    # internal controls demo set
    demo_ics = db.query(InternalControl).filter(InternalControl.name.like("[DEMO]%")).all()
    for c in demo_ics:
        db.query(InternalControlTest).filter(
            InternalControlTest.control_id == c.id).delete(synchronize_session=False)
        db.query(InternalControlRiskLink).filter(
            InternalControlRiskLink.control_id == c.id).delete(synchronize_session=False)
        db.delete(c)
    removed["internal_controls"] = len(demo_ics)
    # vendor demo set
    demo_vendors = db.query(Vendor).filter(Vendor.name.like("[DEMO]%")).all()
    for v in demo_vendors:
        f_ids = [f.id for f in db.query(TPRAFinding.id).filter(TPRAFinding.vendor_id == v.id).all()]
        if f_ids:
            db.query(TPRARemediation).filter(
                TPRARemediation.finding_id.in_(f_ids)).delete(synchronize_session=False)
        db.query(TPRAFinding).filter(TPRAFinding.vendor_id == v.id).delete(synchronize_session=False)
        c_ids = [c.id for c in db.query(TPRAContract.id).filter(TPRAContract.vendor_id == v.id).all()]
        if c_ids:
            db.query(TPRAControlObligation).filter(
                TPRAControlObligation.contract_id.in_(c_ids)).delete(synchronize_session=False)
        db.query(TPRAContract).filter(TPRAContract.vendor_id == v.id).delete(synchronize_session=False)
        db.query(TPRAMonitoringSignal).filter(
            TPRAMonitoringSignal.vendor_id == v.id).delete(synchronize_session=False)
        db.query(VendorAssessment).filter(
            VendorAssessment.vendor_id == v.id).delete(synchronize_session=False)
        db.delete(v)
    removed["vendors"] = len(demo_vendors)
    if rids:
        # risk children first (FKs), then the risks themselves
        for model, key in [(RiskKRI, "kris"), (RiskMitigationAction, "mitigation_actions"),
                           (RiskReview, "risk_reviews")]:
            removed[key] = db.query(model).filter(model.risk_id.in_(rids)).delete(synchronize_session=False)
    removed["incidents"] = db.query(RiskIncident).filter(
        RiskIncident.title.like("[DEMO]%")).delete(synchronize_session=False)
    removed["appetite_configs"] = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.description.like("[DEMO]%")).delete(synchronize_session=False)
    if rids:
        removed["risks"] = db.query(Risk).filter(Risk.id.in_(rids)).delete(synchronize_session=False)
    db.commit()
    return removed


def seed(db, tenant_slug):
    now = datetime.utcnow()
    user = (db.query(GRCUser).filter(GRCUser.username == "admin").first()
            or db.query(GRCUser).first())
    if not user:
        sys.exit("No users in tenant DB.")
    tid = get_user_tenants(user, db)[0]

    # (title, category, status, inh_L, inh_I, res_L, res_I, owner, plan)
    risk_specs = [
        ("[DEMO] Ransomware attack on core systems", "technology", "in_treatment", 4, 5, 3, 4, True, True),
        ("[DEMO] Third-party data processor breach", "third_party", "in_treatment", 4, 4, 3, 3, True, True),
        ("[DEMO] Regulatory non-compliance fine (PDPL)", "compliance", "open", 3, 5, 3, 4, True, True),
        ("[DEMO] Key person dependency in treasury", "operational", "open", 4, 3, 3, 3, True, False),
        ("[DEMO] Cloud provider outage", "technology", "mitigated", 3, 4, 2, 3, True, True),
        ("[DEMO] FX volatility on USD liabilities", "financial", "accepted", 3, 3, 3, 3, True, True),
        ("[DEMO] Insider fraud in payments", "operational", "open", 2, 5, 2, 4, True, True),
        ("[DEMO] Reputational damage from service outage", "reputational", "open", 3, 4, None, None, True, False),
        ("[DEMO] Legacy system end-of-life", "technology", "open", 4, 3, 3, 2, False, False),
        ("[DEMO] Strategic misalignment of digital program", "strategic", "open", 2, 4, None, None, False, False),
        ("[DEMO] Physical security breach at HQ", "operational", "closed", 3, 3, 1, 2, True, True),
        ("[DEMO] Vendor concentration in payment rails", "third_party", "open", 3, 4, 2, 4, True, True),
    ]
    risks = []
    for i, (title, cat, status, il, ii, rl, ri, owned, plan) in enumerate(risk_specs):
        r = Risk(
            tenant_id=tid, title=title, category=cat, status=status,
            owner_id=user.id if owned else None,
            inherent_likelihood=il, inherent_impact=ii,
            inherent_score=float(il * ii) if il and ii else None,
            residual_likelihood=rl, residual_impact=ri,
            residual_score=float(rl * ri) if rl and ri else None,
            treatment_plan=f"Treatment plan for {title[7:]}" if plan else None,
            source_type="manual", created_at=now - timedelta(days=200 - i * 12),
        )
        db.add(r)
        risks.append(r)
    db.flush()

    # linkage: assets / controls / evidence on ~7 of 10 active risks
    asset = db.query(ITAsset).first()
    controls = [c.id for c in db.query(NormalizedControl.id).limit(4).all()]
    evidence = db.query(Evidence).first()
    for idx, r in enumerate(risks[:7]):
        if controls:
            db.add(RiskControlLink(risk_id=r.id, normalized_control_id=controls[idx % len(controls)]))
    if asset:
        db.add(RiskAssetLink(risk_id=risks[0].id, asset_id=asset.id))
    if evidence:
        db.add(RiskEvidenceLink(risk_id=risks[1].id, evidence_id=evidence.id))

    # manual assessments: one approved (recent), one in progress
    a_done = RiskAssessment(tenant_id=tid, name="[DEMO] Annual enterprise risk assessment 2026",
                            assessment_type="annual", methodology="qualitative",
                            status="approved", lead_assessor_id=user.id,
                            approved_by=user.id, approved_at=now - timedelta(days=30),
                            completed_at=now - timedelta(days=30),
                            created_at=now - timedelta(days=60))
    a_wip = RiskAssessment(tenant_id=tid, name="[DEMO] Q3 operational risk review",
                           assessment_type="periodic", methodology="semi_quantitative",
                           status="in_progress", lead_assessor_id=user.id,
                           created_at=now - timedelta(days=10))
    db.add_all([a_done, a_wip])
    db.flush()
    for r in risks[:8]:  # 8 of 11 active risks assessed in the last 12 months
        db.add(RiskAssessmentRisk(
            assessment_id=a_done.id, risk_id=r.id,
            inherent_likelihood=r.inherent_likelihood, inherent_impact=r.inherent_impact,
            inherent_score=r.inherent_score,
            residual_likelihood=r.residual_likelihood, residual_impact=r.residual_impact,
            residual_score=r.residual_score,
            risk_rating="high" if (r.residual_score or 0) >= 12 else "medium",
            treatment_decision="mitigate", control_effectiveness="partially_effective",
            assessed_at=now - timedelta(days=35), assessed_by=user.id))

    # framework assessment: 6 questions — 4 completed (2 with evidence), 1 in progress, 1 blocked
    fw_row = db.query(UploadedFramework).filter(UploadedFramework.is_active == True).first()  # noqa: E712
    f = FrameworkRiskAssessment(tenant_id=tid, name="[DEMO] NCA ECC risk questionnaire",
                                uploaded_framework_id=fw_row.id if fw_row else None,
                                status="in_progress", created_by=user.id)
    db.add(f)
    db.flush()
    q_states = ["completed", "completed", "completed", "completed", "in_progress", "blocked"]
    questions = []
    for i, st in enumerate(q_states):
        scored = st == "completed"
        q = FrameworkRiskQuestion(
            assessment_id=f.id, question_text=f"[DEMO] Control question {i+1}",
            status=st, assigned_user_id=user.id,
            inherent_likelihood=4 if scored else None, inherent_impact=4 if scored else None,
            inherent_score=16.0 if scored else None,
            residual_likelihood=2 if scored else None, residual_impact=3 if scored else None,
            residual_score=6.0 if scored else None,
            order_index=i, created_by=user.id)
        db.add(q)
        questions.append(q)
    db.flush()
    for q in questions[:2]:
        db.add(FrameworkRiskQuestionEvidence(question_id=q.id, file_name="evidence.pdf",
                                             file_path="/demo/evidence.pdf", file_size=1024,
                                             uploaded_by=user.id))

    # AI risk assessment entries: closed, open on-schedule, open overdue
    ai_specs = [("Chatbot PII leakage", "Closed", -10), ("Model drift in scoring", "Open", 45),
                ("Prompt injection in agent", "Open", -5)]
    for name, status, days in ai_specs:
        db.add(AIRiskAssessmentEntry(
            tenant_id=tid, ai_system_use_case=f"[DEMO] {name}", risk_category="ai",
            likelihood=3, impact=4, risk_score=12, residual_risk_level="Medium",
            status=status, source="manual", risk_owner_user_id=user.id,
            target_review_date=date.today() + timedelta(days=days)))

    # ---------------- RCSA ----------------
    bus = []
    for bu_name in ("Operations", "Finance", "Technology"):
        b = db.query(BusinessUnit).filter(BusinessUnit.tenant_id == tid,
                                          BusinessUnit.name == bu_name).first()
        if not b:
            b = BusinessUnit(tenant_id=tid, name=bu_name)
            db.add(b)
            db.flush()
        bus.append(b)
    ev = db.query(Evidence).filter(Evidence.tenant_id == tid).first()
    if not ev:
        ev = Evidence(tenant_id=tid, name="[DEMO] RCSA supporting evidence")
        db.add(ev)
        db.flush()
    tmpl = RCSATemplate(tenant_id=tid, name="[DEMO] Operational RCSA", category="operational",
                        is_active=True, created_by=user.id)
    db.add(tmpl)
    db.flush()
    rq = [RCSAQuestion(template_id=tmpl.id, question_text=f"[DEMO] RCSA question {i+1}",
                       question_type="risk_rating") for i in range(3)]
    db.add_all(rq)
    camp = RCSACampaign(tenant_id=tid, template_id=tmpl.id, name="[DEMO] Q2 2026 RCSA",
                        period_type="quarterly", period_label="Q2 2026",
                        start_date=now - timedelta(days=40), due_date=now - timedelta(days=5),
                        status="active", created_by=user.id)
    db.add(camp)
    db.flush()
    # three assessments: approved (on time), submitted (late), in_progress
    a1 = RCSAAssessment(tenant_id=tid, campaign_id=camp.id, business_unit_id=bus[0].id,
                        status="approved", assessor_id=user.id,
                        submitted_at=now - timedelta(days=10), overall_risk_score=3.1,
                        overall_control_score=3.8)
    a2 = RCSAAssessment(tenant_id=tid, campaign_id=camp.id, business_unit_id=bus[1].id,
                        status="submitted", assessor_id=user.id,
                        submitted_at=now - timedelta(days=2))
    a3 = RCSAAssessment(tenant_id=tid, campaign_id=camp.id, business_unit_id=bus[2].id,
                        status="in_progress", assessor_id=user.id)
    db.add_all([a1, a2, a3])
    db.flush()
    responses = []
    for a in (a1, a2):
        for q in rq:
            r = RCSAResponse(assessment_id=a.id, question_id=q.id, responded_by=user.id,
                             likelihood_rating=3, impact_rating=3, risk_score=9.0)
            db.add(r)
            responses.append(r)
    db.flush()
    for r in responses[:2]:  # 2 of 6 responses evidence-backed
        db.add(RCSAResponseEvidence(response_id=r.id, evidence_id=ev.id, uploaded_by=user.id))
    db.add(RCSAFinding(tenant_id=tid, assessment_id=a1.id, finding_type="control_gap",
                       severity="high", title="[DEMO] Reconciliation control gap",
                       status="open"))
    db.add(RCSAFinding(tenant_id=tid, assessment_id=a1.id, finding_type="control_weakness",
                       severity="medium", title="[DEMO] Manual approval workaround",
                       status="remediated"))

    # ---------------- Internal Controls ----------------
    ic_specs = [
        # (control_id, name, status, design, operating, tested, next_test_days, key, link_risk)
        ("DEMO-IC-001", "[DEMO] Payment dual authorisation", "active", "effective", "effective", True, 90, True, True),
        ("DEMO-IC-002", "[DEMO] Privileged access review", "active", "effective", "partially_effective", True, -10, True, True),
        ("DEMO-IC-003", "[DEMO] Backup restoration drill", "active", "not_tested", "not_tested", False, 30, False, True),
        ("DEMO-IC-004", "[DEMO] Vendor onboarding checklist", "pending_approval", "not_tested", "not_tested", False, None, False, False),
    ]
    for i, (cid, name, status, de, oe, tested, next_days, key, link) in enumerate(ic_specs):
        c = InternalControl(tenant_id=tid, control_id=cid, name=name, category="Operations",
                            control_type="preventive", control_nature="manual",
                            frequency="monthly", status=status,
                            design_effectiveness=de, operating_effectiveness=oe,
                            is_key_control=key, owner_id=user.id,
                            next_test_date=now + timedelta(days=next_days) if next_days is not None else None)
        db.add(c)
        db.flush()
        if tested:
            db.add(InternalControlTest(tenant_id=tid, control_id=c.id, test_type="operating",
                                       test_date=now - timedelta(days=20),
                                       result="effective" if oe == "effective" else "partially_effective",
                                       tester_id=user.id, status="completed"))
        if link:
            db.add(InternalControlRiskLink(control_id=c.id, risk_id=risks[i].id,
                                           link_type="mitigates", created_by=user.id))

    # ---------------- Vendor Risk (TPRA) ----------------
    _ensure_model_columns(db, [Vendor, VendorAssessment])
    v1 = Vendor(tenant_id=tid, name="[DEMO] CloudPay Processing", tier="critical",
                status="active", lifecycle_stage="monitoring",
                inherent_risk_score=72.0, residual_risk_score=41.0, risk_rating="medium",
                next_reassessment_date=now + timedelta(days=120),
                reassessment_cadence_days=365)
    v2 = Vendor(tenant_id=tid, name="[DEMO] DataVault Archiving", tier="high",
                status="active", lifecycle_stage="findings",
                inherent_risk_score=65.0, residual_risk_score=58.0, risk_rating="high",
                next_reassessment_date=now - timedelta(days=15),
                reassessment_cadence_days=365)
    db.add_all([v1, v2])
    db.flush()
    va1 = VendorAssessment(tenant_id=tid, vendor_id=v1.id, status="approved",
                           assessment_type="initial", lifecycle_status="active",
                           current_stage="monitoring", version_no=1,
                           inherent_score=72.0, residual_score=41.0, risk_rating="medium",
                           completed_at=now - timedelta(days=60))
    va2 = VendorAssessment(tenant_id=tid, vendor_id=v2.id, status="in_progress",
                           assessment_type="initial", lifecycle_status="active",
                           current_stage="findings", version_no=1,
                           inherent_score=65.0, due_date=now + timedelta(days=20))
    db.add_all([va1, va2])
    db.flush()
    tf1 = TPRAFinding(tenant_id=tid, vendor_id=v1.id, assessment_id=va1.id,
                      domain="cybersecurity", severity="high",
                      title="[DEMO] MFA gap for admin portal", status="closed")
    tf2 = TPRAFinding(tenant_id=tid, vendor_id=v2.id, assessment_id=va2.id,
                      domain="data_privacy", severity="critical",
                      title="[DEMO] No DPA for EU data", status="in_remediation",
                      is_critical_control_fail=True)
    db.add_all([tf1, tf2])
    db.flush()
    db.add(TPRARemediation(tenant_id=tid, finding_id=tf2.id, owner_id=user.id,
                           status="open", due_date=now - timedelta(days=3),
                           treatment_type="remediate"))
    db.add(TPRAMonitoringSignal(tenant_id=tid, vendor_id=v1.id, signal_type="security_rating",
                                severity="medium", source="SecurityScorecard",
                                occurred_at=now - timedelta(days=4), acknowledged=True))
    db.add(TPRAMonitoringSignal(tenant_id=tid, vendor_id=v2.id, signal_type="adverse_media",
                                severity="high", source="News monitor",
                                occurred_at=now - timedelta(days=1), acknowledged=False))
    ct = TPRAContract(tenant_id=tid, vendor_id=v1.id, assessment_id=va1.id,
                      contract_type="dpa", title="[DEMO] Data processing agreement",
                      status="active")
    db.add(ct)
    db.flush()
    db.add(TPRAControlObligation(tenant_id=tid, contract_id=ct.id,
                                 obligation="Annual SOC 2 report delivery", status="met"))
    db.add(TPRAControlObligation(tenant_id=tid, contract_id=ct.id,
                                 obligation="Breach notification within 24h", status="open"))

    # ---------------- KRIs ----------------
    # risks[0]=ransomware (res 12, high), risks[2]=PDPL (res 12, high)
    kri_specs = [
        # (risk_idx, name, value, green, amber, freq, measured_days_ago, active)
        (0, "[DEMO] Unpatched critical CVEs", 4, 5, 10, "weekly", 3, True),      # green, fresh
        (0, "[DEMO] Phishing click rate %", 14, 5, 10, "monthly", 12, True),     # red, fresh
        (2, "[DEMO] Open PDPL gaps", 6, 3, 8, "monthly", 50, True),              # amber, stale
        (4, "[DEMO] Cloud SLA breaches", 0, 1, 3, "quarterly", 20, True),        # green, fresh
    ]
    for idx, name, val, green, amber, freq, ago, act in kri_specs:
        db.add(RiskKRI(risk_id=risks[idx].id, name=name, metric_type="count",
                       current_value=float(val), green_threshold=float(green),
                       amber_threshold=float(amber), threshold_direction="lower_is_better",
                       frequency=freq, owner_id=user.id, is_active=act,
                       last_measured_at=now - timedelta(days=ago)))

    # ---------------- Risk Appetite ----------------
    appetite_specs = [("technology", "cautious", 12.0), ("operational", "cautious", 12.0),
                      ("compliance", "averse", 10.0), ("financial", "moderate", 15.0)]
    for cat, level, limit in appetite_specs:
        db.add(RiskAppetiteConfig(tenant_id=tid, category=cat, appetite_level=level,
                                  max_acceptable_score=limit,
                                  description=f"[DEMO] {cat} appetite"))

    # ---------------- Mitigation Actions ----------------
    action_specs = [
        # (risk_idx, title, status, due_days, completed_days_ago, evidence)
        (0, "[DEMO] Deploy EDR on all endpoints", "completed", -30, 35, True),
        (1, "[DEMO] Contractual breach-notice clause", "completed", -10, 12, False),
        (2, "[DEMO] PDPL gap remediation plan", "in_progress", 25, None, False),
        (3, "[DEMO] Cross-train treasury backup", "open", -6, None, False),   # overdue
        (6, "[DEMO] Four-eyes payment approval", "open", 40, None, False),
    ]
    for idx, title, status, due_days, done_ago, ev in action_specs:
        db.add(RiskMitigationAction(
            risk_id=risks[idx].id, title=title, action_type="mitigate", status=status,
            priority="high", owner_id=user.id,
            due_date=now + timedelta(days=due_days),
            completed_at=now - timedelta(days=done_ago) if done_ago else None,
            evidence_id=evidence.id if (ev and evidence) else None))

    # ---------------- Risk Reviews ----------------
    review_specs = [
        # (risk_idx, status, due_days, completed_days_ago)
        (0, "approved", -30, 32),   # done, on time (completed before due)
        (1, "approved", -60, 55),   # done, late
        (2, "pending", 20, None),   # open, future
        (3, "pending", -8, None),   # open, overdue
    ]
    for idx, status, due_days, done_ago in review_specs:
        db.add(RiskReview(risk_id=risks[idx].id, review_cycle="quarterly",
                          review_type="periodic", status=status,
                          due_date=now + timedelta(days=due_days),
                          completed_at=now - timedelta(days=done_ago) if done_ago else None,
                          reviewer_id=user.id))

    # ---------------- Incidents ----------------
    incident_specs = [
        # (risk_idx|None, title, severity, status, days_ago)
        (0, "[DEMO] Attempted ransomware blocked at gateway", "high", "resolved", 90),
        (6, "[DEMO] Duplicate payment released", "medium", "closed", 150),
        (1, "[DEMO] Processor data exposure under investigation", "critical", "investigating", 6),
        (None, "[DEMO] Badge system outage at HQ", "medium", "open", 15),
    ]
    for idx, title, sev, status, ago in incident_specs:
        db.add(RiskIncident(tenant_id=tid, risk_id=risks[idx].id if idx is not None else None,
                            title=title, severity=sev, status=status,
                            incident_date=now - timedelta(days=ago),
                            reported_by=user.id,
                            resolved_at=now - timedelta(days=ago - 5)
                            if status in ("resolved", "closed") else None))

    db.commit()
    return len(risk_specs)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("command", choices=["seed", "cleanup"])
    p.add_argument("--tenant", default="complyverse")
    args = p.parse_args()
    db = open_tenant_session(args.tenant)
    try:
        if args.command == "cleanup":
            print("Removed:", cleanup(db))
        else:
            removed = cleanup(db)
            n = seed(db, args.tenant)
            print(f"Seeded {n} demo risks + assessments into '{args.tenant}'. Prior demo rows removed: {removed}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
