"""1LINK ERM onboarding seed — populates ONE tenant with 1LINK's actual ERM
framework so the platform reflects their world on handover.

Everything here is ADDITIVE and IDEMPOTENT: it only inserts rows (governance
committees, risk-appetite statements, a 3x3 likelihood/impact scale, and a
representative RCSA risk register with controls, mitigation actions and KRIs)
through the existing models, guarding every insert on an existence check so a
re-run is a no-op. It never modifies or deletes existing data and touches no
other tenant — call it explicitly for 1LINK's tenant (CLI or admin endpoint).

Grounded in 1LINK's ERM Framework v2.0:
  • scoring is a 3x3 (likelihood x impact, 1-3) → Low/Medium/High, not the 5x5 default
  • risk appetite is qualitative (no operational-loss data yet for quantitative limits)
  • governance runs Board → BRMITC → MANCOM → GRCC on a three-lines-of-defense model
  • the register carries ERM classification + Basel II event types + a 10-factor
    impact model + a full control-design assessment — preserved verbatim in
    Risk.template_fields (the platform's existing "template fields" stash).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

REGISTER_LABEL = "1LINK"
SEED_TAG = "1link-erm-seed"   # marks seeded risks (source_reference prefix) for idempotency


# ── 3x3 likelihood / impact scale ─────────────────────────────────────────────
SCALES = {
    "likelihood": [
        (1, "Low", "Unlikely to occur / rare", 1.0, "#22c55e"),
        (2, "Medium", "Possible / occasional", 2.0, "#f59e0b"),
        (3, "High", "Likely / frequent", 3.0, "#ef4444"),
    ],
    "impact": [
        (1, "Low", "Minor / absorbable impact", 1.0, "#22c55e"),
        (2, "Medium", "Moderate / manageable impact", 2.0, "#f59e0b"),
        (3, "High", "Severe / material impact", 3.0, "#ef4444"),
    ],
}


# ── Governance bodies (three lines of defense) ────────────────────────────────
COMMITTEES = [
    dict(name="Board of Directors", committee_type="board", meeting_frequency="quarterly",
         description="Ultimate accountability for 1LINK's risk management, strategy and "
                     "risk appetite. Approves the ERM Framework."),
    dict(name="Board Risk Management & IT Committee (BRMITC)", committee_type="risk_committee",
         meeting_frequency="quarterly",
         description="Board-level oversight of enterprise & IT risk. Reviews and approves ERM "
                     "policies, articulates risk appetite and tolerance, and receives integrated "
                     "risk reporting. Approver of the ERM Framework v2.0."),
    dict(name="Management Committee (MANCOM)", committee_type="custom", meeting_frequency="monthly",
         description="Highest level of management oversight; reviews strategy-setting policies "
                     "and monitors progress before Board consideration."),
    dict(name="Governance, Risk & Compliance Committee (GRCC)", committee_type="risk_committee",
         meeting_frequency="monthly",
         description="Supervises, aggregates and integrates the Company's risk profile. Reviews "
                     "residual risk ratings and KRIs, and recommends the risk strategy and appetite "
                     "to BRMITC (second line of defense)."),
    dict(name="Board Audit Committee (BAC)", committee_type="audit_committee", meeting_frequency="quarterly",
         description="Independent assurance over the effectiveness of risk management and internal "
                     "controls (third line of defense)."),
    dict(name="Control Committee", committee_type="custom", meeting_frequency="monthly",
         description="Debates and delineates the threats posed by identified risks and their impact "
                     "on the organisation's ability to perform and transact."),
]


# ── Qualitative risk appetite (per category) ──────────────────────────────────
# appetite_level ∈ averse|minimal|cautious|moderate|open|hungry; scores on the 3x3 scale (max 9).
APPETITE = [
    dict(category="operational", appetite_level="cautious", max_acceptable_score=6.0, tolerance_threshold=6.0,
         description="Risk-profile based tolerance from the RCSA exercise (limits on the number of "
                     "high/medium/low-risk areas). Quantitative operational-loss limits to be set once "
                     "sufficient loss data is available."),
    dict(category="financial", appetite_level="minimal", max_acceptable_score=4.0, tolerance_threshold=4.0,
         description="Conservative. As an FMI, 1LINK maintains liquid net assets of at least six months "
                     "of operating expenses (PFMI) and closely monitors settlement and liquidity exposure."),
    dict(category="compliance", appetite_level="averse", max_acceptable_score=3.0, tolerance_threshold=3.0,
         description="Low tolerance for regulatory sanctions; zero tolerance for wilful non-compliance "
                     "with SBP and applicable regulations."),
    dict(category="technology", appetite_level="cautious", max_acceptable_score=6.0, tolerance_threshold=6.0,
         description="Proactive detection and effective preventive/detective controls across systems, "
                     "networks and digital assets; low tolerance for unmitigated cyber exposure."),
    dict(category="strategic", appetite_level="cautious", max_acceptable_score=6.0, tolerance_threshold=6.0,
         description="Measured risk-taking in pursuit of strategic objectives, monitored against the "
                     "evolving payments and fintech landscape."),
    dict(category="third_party", appetite_level="minimal", max_acceptable_score=4.0, tolerance_threshold=4.0,
         description="Outsourcing arrangements must align with strategic objectives and risk appetite; "
                     "zero tolerance for brand damage arising from partner or outsourcing lapses."),
    dict(category="reputational", appetite_level="averse", max_acceptable_score=3.0, tolerance_threshold=3.0,
         description="Low appetite for any attempt to damage the 1LINK brand; zero tolerance for negative "
                     "brand effects through the actions or lapses of partners and outsourcing agencies."),
]


def _tf(cls, sub, basel1, basel2, dept, func, product, process, control, impact_factors,
        overall_impact, inherent_rating, residual_rating, response, plan, timeline, status, poc,
        risk_id):
    """Assemble the verbatim register row stashed in Risk.template_fields."""
    return {
        "register": REGISTER_LABEL,
        "risk_id": risk_id,
        "erm_classification": cls,
        "erm_sub_category": sub,
        "basel_ii_event_type_1": basel1,
        "basel_ii_event_type_2": basel2,
        "department": dept, "function": func, "product": product,
        "process": process,
        "business_impact_factors": impact_factors,
        "overall_impact": overall_impact,
        "inherent_rating": inherent_rating,
        "control": control,
        "residual_rating": residual_rating,
        "risk_response": response,
        "mitigation_plan": plan,
        "mitigation_timeline": timeline,
        "implementation_status": status,
        "poc": poc,
    }


def _ctrl(ref, objective, desc, owner, nature, mechanism, frequency, design, key, operating, rating):
    return {"reference": ref, "objective": objective, "description": desc, "owner": owner,
            "coso_classification": "Control Activities", "nature": nature, "mechanism": mechanism,
            "frequency": frequency, "design_assessment": design, "key_control": key,
            "operating_effectiveness": operating, "control_rating": rating}


# ── Representative RCSA register (payments FMI) ────────────────────────────────
# Each: title, description, category, sub_category, inherent (L,I), residual (L,I),
# appetite label, status, treatment, mitigation action, optional KRI, template_fields.
RISKS = [
    dict(
        risk_id="RK-SET-01", title="Settlement default by a participating member",
        description="A participating bank fails to meet its net settlement obligation in a clearing "
                    "cycle, exposing 1LINK and other participants to settlement risk.",
        category="financial", sub_category="Settlement Risk",
        inherent=(2, 3), residual=(1, 3), appetite="Minimal", status="open",
        treatment="Collateral / settlement guarantee arrangements, real-time exposure monitoring and "
                  "member limits; escalation to the Settlement function and GRCC.",
        mitigation=dict(title="Strengthen settlement guarantee & member limit monitoring",
                        action_type="mitigate", status="in_progress", priority="high",
                        timeline="Q3 2025"),
        kri=dict(name="Settlement failures per month", metric_type="count", unit="events",
                 green=1, amber=3, direction="lower_is_better", frequency="monthly",
                 data_source="Settlement operations", current=0),
        control=_ctrl("CR-SET-01", "Ensure member settlement obligations are secured and monitored.",
                      "Real-time monitoring of member net debit positions against limits; settlement "
                      "guarantee fund maintained.", "Head of Settlement", "Preventive", "Automated",
                      "Continuous", "Effective", "Yes", "Effective", 1),
        dept="Finance", func="Settlement", product="Clearing & Settlement", process="Net settlement",
        basel1="Execution, Delivery & Process Management", basel2="Transaction Capture, Execution & Maintenance",
        impact_factors={"Financial Impact": 3, "Impact on Financial Ecosystem": 3,
                        "Regulatory Compliance Obligations": 2, "Average Monthly Volume": 3},
        overall_impact="High", inherent_rating="High", residual_rating="Medium",
        response="Mitigate", poc="AGM Settlement",
    ),
    dict(
        risk_id="RK-LIQ-01", title="Liquidity shortfall against PFMI resilience floor",
        description="Insufficient liquid net assets to withstand a general business loss, breaching the "
                    "PFMI requirement to hold at least six months of operating expenses in liquid assets.",
        category="financial", sub_category="Liquidity Risk",
        inherent=(1, 3), residual=(1, 2), appetite="Minimal", status="open",
        treatment="Maintain liquid net assets ≥ 6 months of operating expenses funded by equity; monthly "
                  "cashflow forecasting and monitoring by Finance.",
        mitigation=dict(title="Monthly liquidity coverage forecast & board reporting",
                        action_type="mitigate", status="completed", priority="medium", timeline="Ongoing"),
        kri=dict(name="Liquid net assets (months of operating expenses)", metric_type="numeric", unit="months",
                 green=6, amber=4, direction="higher_is_better", frequency="monthly",
                 data_source="Finance", current=7),
        control=_ctrl("CR-LIQ-01", "Maintain PFMI liquidity resilience.",
                      "Monthly cashflow forecasts and liquidity coverage monitoring; equity-funded liquid buffer.",
                      "Chief Financial Officer", "Detective", "Manual", "Monthly", "Effective", "Yes", "Effective", 1),
        dept="Finance", func="Finance", product="N/A", process="Treasury & liquidity",
        basel1="Business Disruption & System Failures", basel2="N/A",
        impact_factors={"Financial Impact": 3, "Strategic Importance": 3, "Regulatory Compliance Obligations": 3},
        overall_impact="High", inherent_rating="Medium", residual_rating="Low",
        response="Mitigate", poc="CFO",
    ),
    dict(
        risk_id="RK-CYB-01", title="Cyber-attack or data breach on the payment switch",
        description="A malicious actor exploits a vulnerability in 1LINK's switch or supporting systems, "
                    "causing service disruption, financial loss or exposure of sensitive data.",
        category="technology", sub_category="Cybersecurity Risk",
        inherent=(2, 3), residual=(2, 2), appetite="Cautious", status="open",
        treatment="Layered preventive and detective controls, continuous vulnerability management, SOC "
                  "monitoring, and periodic penetration testing.",
        mitigation=dict(title="Remediate critical/high vulnerabilities within SLA",
                        action_type="mitigate", status="in_progress", priority="critical", timeline="Q4 2025"),
        kri=dict(name="Critical/High vulnerabilities open beyond SLA", metric_type="count", unit="findings",
                 green=5, amber=15, direction="lower_is_better", frequency="weekly",
                 data_source="Vulnerability management", current=8),
        control=_ctrl("CR-CYB-01", "Prevent and detect cyber intrusions.",
                      "Firewalls, EDR, SIEM/SOC monitoring, vulnerability scanning and patching, periodic "
                      "penetration tests.", "Chief Risk & IS Officer", "Preventive", "Automated", "Continuous",
                      "Effective", "Yes", "Partially Effective", 2),
        dept="Information Security", func="Cyber Security", product="Switch", process="Cyber defense",
        basel1="External Fraud", basel2="Systems Security",
        impact_factors={"Financial Impact": 3, "Impact on Financial Ecosystem": 3,
                        "Regulatory Compliance Obligations": 3, "Dependency on External Vendors": 2},
        overall_impact="High", inherent_rating="High", residual_rating="Medium",
        response="Mitigate", poc="CISO",
    ),
    dict(
        risk_id="RK-FRD-01", title="Transaction / card fraud",
        description="Fraudulent transactions arising from compromised cards, credentials or channels result "
                    "in financial loss and customer harm.",
        category="operational", sub_category="Fraud Risk",
        inherent=(2, 2), residual=(1, 2), appetite="Averse", status="open",
        treatment="Real-time fraud monitoring rules, transaction limits, EMV/3-D Secure, and coordinated "
                  "response with member banks.",
        mitigation=dict(title="Tune real-time fraud detection rules",
                        action_type="mitigate", status="in_progress", priority="high", timeline="Q3 2025"),
        kri=dict(name="Fraud loss rate (basis points of volume)", metric_type="numeric", unit="bps",
                 green=2, amber=5, direction="lower_is_better", frequency="monthly",
                 data_source="Fraud & risk", current=1.4),
        control=_ctrl("CR-FRD-01", "Detect and prevent fraudulent transactions.",
                      "Real-time transaction monitoring rules and velocity checks; 3-D Secure and EMV.",
                      "Head of Risk & Fraud", "Detective", "Automated", "Continuous", "Effective", "Yes",
                      "Effective", 1),
        dept="Risk & Fraud", func="Fraud Management", product="Card scheme (PayPak)", process="Transaction monitoring",
        basel1="External Fraud", basel2="Theft & Fraud",
        impact_factors={"Financial Impact": 2, "Criticality on Revenue": 2, "Size & Diversity of Customer Base": 3},
        overall_impact="Medium", inherent_rating="Medium", residual_rating="Low",
        response="Mitigate", poc="Head of Fraud",
    ),
    dict(
        risk_id="RK-TPR-01", title="Critical vendor / outsourcing partner outage",
        description="Failure or service degradation of a critical third-party (e.g. hosting, connectivity, "
                    "or a key technology vendor) disrupts 1LINK's services.",
        category="third_party", sub_category="Outsourcing & Third-party Risk",
        inherent=(2, 3), residual=(1, 2), appetite="Minimal", status="open",
        treatment="Due diligence, SLAs with penalties, business continuity and exit plans, and continuous "
                  "monitoring of critical vendors.",
        mitigation=dict(title="Formalise BCP & exit plans for critical vendors",
                        action_type="mitigate", status="open", priority="high", timeline="Q4 2025"),
        kri=dict(name="Critical vendor SLA breaches per quarter", metric_type="count", unit="breaches",
                 green=0, amber=2, direction="lower_is_better", frequency="quarterly",
                 data_source="Vendor risk / TPRA", current=0),
        control=_ctrl("CR-TPR-01", "Ensure resilience of critical outsourcing arrangements.",
                      "SLA monitoring, periodic vendor risk assessments, BCP/DR and defined exit strategies.",
                      "Head of Procurement", "Preventive", "Manual", "Quarterly", "Partially Effective", "Yes",
                      "Effective", 1),
        dept="Information Technology", func="Vendor Management", product="N/A", process="Third-party management",
        basel1="Business Disruption & System Failures", basel2="Vendor & Supplier",
        impact_factors={"Dependency on External Vendors": 3, "Impact on Financial Ecosystem": 2,
                        "Geographical Spread of Service Delivery": 2},
        overall_impact="High", inherent_rating="High", residual_rating="Low",
        response="Mitigate", poc="Head of Procurement",
    ),
    dict(
        risk_id="RK-CMP-01", title="Regulatory non-compliance (SBP / PFMI)",
        description="Failure to comply with State Bank of Pakistan regulations or PFMI obligations leads to "
                    "sanctions, penalties or restrictions.",
        category="compliance", sub_category="Compliance Risk",
        inherent=(2, 3), residual=(1, 2), appetite="Averse", status="open",
        treatment="Regulatory obligations register, compliance monitoring, KRIs as early-warning triggers, "
                  "and timely remediation of observations.",
        mitigation=dict(title="Close open regulatory observations",
                        action_type="mitigate", status="in_progress", priority="high", timeline="Q3 2025"),
        kri=dict(name="Open regulatory observations", metric_type="count", unit="observations",
                 green=0, amber=3, direction="lower_is_better", frequency="monthly",
                 data_source="Compliance", current=2),
        control=_ctrl("CR-CMP-01", "Maintain compliance with SBP and PFMI requirements.",
                      "Regulatory obligations mapping, periodic compliance reviews and remediation tracking.",
                      "Head of Compliance", "Preventive", "Manual", "Quarterly", "Effective", "Yes", "Effective", 1),
        dept="Compliance", func="Regulatory Compliance", product="N/A", process="Compliance monitoring",
        basel1="Clients, Products & Business Practices", basel2="Regulatory Compliance",
        impact_factors={"Regulatory Compliance Obligations": 3, "Strategic Importance": 3},
        overall_impact="High", inherent_rating="High", residual_rating="Low",
        response="Mitigate", poc="Head of Compliance",
    ),
    dict(
        risk_id="RK-OPS-01", title="Switch / system unavailability (SLA breach)",
        description="Unplanned downtime of the payment switch or core systems breaches availability SLAs and "
                    "disrupts participants and customers.",
        category="operational", sub_category="Operational Risk (IT)",
        inherent=(2, 3), residual=(2, 2), appetite="Cautious", status="open",
        treatment="High-availability architecture, DR site, capacity management and 24x7 monitoring.",
        mitigation=dict(title="DR drill and capacity uplift", action_type="mitigate", status="open",
                        priority="high", timeline="Q4 2025"),
        kri=dict(name="Switch availability (%)", metric_type="percentage", unit="%",
                 green=99.9, amber=99.5, direction="higher_is_better", frequency="monthly",
                 data_source="IT Operations", current=99.95),
        control=_ctrl("CR-OPS-01", "Ensure high availability of core payment systems.",
                      "Redundant HA architecture, DR failover, 24x7 NOC monitoring and capacity management.",
                      "Head of IT Operations", "Preventive", "Automated", "Continuous", "Effective", "Yes",
                      "Effective", 1),
        dept="Operations", func="IT Operations", product="Switch", process="Service availability",
        basel1="Business Disruption & System Failures", basel2="Systems",
        impact_factors={"Impact on Financial Ecosystem": 3, "Average Monthly Volume": 3,
                        "Criticality on Revenue": 2},
        overall_impact="High", inherent_rating="High", residual_rating="Medium",
        response="Mitigate", poc="Head of IT Ops",
    ),
    dict(
        risk_id="RK-DPR-01", title="Personal / sensitive data exposure",
        description="Unauthorised collection, use or disclosure of personal or sensitive data leads to "
                    "regulatory penalties and loss of trust.",
        category="compliance", sub_category="Data Privacy Risk",
        inherent=(1, 3), residual=(1, 2), appetite="Averse", status="open",
        treatment="Data classification, access controls, encryption, DLP and privacy-by-design reviews.",
        mitigation=dict(title="Roll out data classification & DLP coverage",
                        action_type="mitigate", status="in_progress", priority="medium", timeline="Q4 2025"),
        control=_ctrl("CR-DPR-01", "Protect personal and sensitive data.",
                      "Data classification, least-privilege access, encryption at rest/in transit and DLP.",
                      "Chief Risk & IS Officer", "Preventive", "Automated", "Continuous", "Effective", "Yes",
                      "Partially Effective", 2),
        dept="Compliance", func="Information Security", product="N/A", process="Data protection",
        basel1="Clients, Products & Business Practices", basel2="Privacy",
        impact_factors={"Regulatory Compliance Obligations": 3, "Size & Diversity of Customer Base": 3},
        overall_impact="High", inherent_rating="Medium", residual_rating="Low",
        response="Mitigate", poc="CISO",
    ),
    dict(
        risk_id="RK-REP-01", title="Reputational damage via partner / outsourcing lapse",
        description="Actions or lapses of business partners or outsourcing agencies (e.g. co-branding, "
                    "sponsorships) cause negative effects on the 1LINK brand.",
        category="reputational", sub_category="Reputational Risk",
        inherent=(1, 3), residual=(1, 2), appetite="Averse", status="open",
        treatment="Strong governance, partner code of conduct, brand-usage controls and proactive "
                  "reputation monitoring; zero-tolerance stance on brand harm.",
        mitigation=dict(title="Partner brand-usage controls & monitoring",
                        action_type="mitigate", status="open", priority="medium", timeline="Q1 2026"),
        control=_ctrl("CR-REP-01", "Protect the 1LINK brand from partner-driven harm.",
                      "Partner due diligence, brand-usage agreements and social/media monitoring.",
                      "Chief Strategy Officer", "Preventive", "Manual", "As required", "Partially Effective",
                      "No", "Effective", 1),
        dept="Corporate", func="Corporate Affairs", product="Brand (PayPak)", process="Brand & partnerships",
        basel1="Clients, Products & Business Practices", basel2="Suitability, Disclosure & Fiduciary",
        impact_factors={"Strategic Importance": 3, "Criticality on Revenue": 2},
        overall_impact="High", inherent_rating="Medium", residual_rating="Low",
        response="Mitigate", poc="CSO",
    ),
    dict(
        risk_id="RK-STR-01", title="Strategic disruption from fintech / scheme competition",
        description="Adverse shifts in the payments landscape (new fintech entrants, scheme dynamics or "
                    "regulatory change) erode 1LINK's strategic position.",
        category="strategic", sub_category="Strategic Risk",
        inherent=(2, 2), residual=(2, 2), appetite="Cautious", status="open",
        treatment="Continuous environmental scanning, strategic planning refresh and product innovation "
                  "monitored by MANCOM and BRMITC.",
        mitigation=dict(title="Quarterly strategic risk & horizon scan to BRMITC",
                        action_type="mitigate", status="in_progress", priority="medium", timeline="Ongoing"),
        control=_ctrl("CR-STR-01", "Anticipate and respond to strategic shifts.",
                      "Environmental scanning (fintech, regulatory), strategy reviews and innovation pipeline.",
                      "Chief Strategy Officer", "Directive", "Manual", "Quarterly", "Effective", "No",
                      "Effective", 1),
        dept="Strategy", func="Corporate Strategy", product="N/A", process="Strategic planning",
        basel1="N/A", basel2="N/A",
        impact_factors={"Strategic Importance": 3, "Criticality on Revenue": 2},
        overall_impact="Medium", inherent_rating="Medium", residual_rating="Medium",
        response="Mitigate", poc="CSO",
    ),
    dict(
        risk_id="RK-OPS-02", title="Inadequate documentation of process changes",
        description="Inadequate documentation of changes may cause confusion and lead to operational "
                    "inefficiencies.",
        category="operational", sub_category="Operational Risk",
        inherent=(2, 1), residual=(1, 1), appetite="Moderate", status="open",
        treatment="Standardised BRD process; changes documented, reviewed and approved before implementation.",
        mitigation=dict(title="Enforce BRD sign-off for all process changes",
                        action_type="mitigate", status="completed", priority="low", timeline="Ongoing"),
        control=_ctrl("CR-OPS-02", "Ensure changes are clearly documented, reviewed and approved.",
                      "The team evaluates the submitted process and facilitates the creation of a Business "
                      "Requirement Document (BRD).", "AGM/RGM Process", "Preventive", "Manual", "As required",
                      "Effective", "Yes", "Effective", 1),
        dept="Finance", func="Finance", product="N/A", process="Change / documentation",
        basel1="Execution, Delivery & Process Management", basel2="Transaction Capture, Execution & Maintenance",
        impact_factors={"Financial Impact": 1, "Extent of Functions Impacted by Process": 1},
        overall_impact="Low", inherent_rating="Medium", residual_rating="Low",
        response="Accept", poc="AGM Finance",
    ),
    dict(
        risk_id="RK-FIN-01", title="Financial reporting misstatement",
        description="Errors or omissions in financial reporting lead to inaccurate disclosures, audit "
                    "findings or regulatory concern.",
        category="compliance", sub_category="Financial Reporting Risk",
        inherent=(1, 2), residual=(1, 1), appetite="Minimal", status="open",
        treatment="Reconciliations, segregation of duties, review controls and external audit assurance.",
        mitigation=dict(title="Strengthen reconciliation & review controls",
                        action_type="mitigate", status="completed", priority="low", timeline="Ongoing"),
        control=_ctrl("CR-FIN-01", "Ensure accurate and complete financial reporting.",
                      "Monthly reconciliations, maker-checker review, and external audit.",
                      "Chief Financial Officer", "Detective", "Manual", "Monthly", "Effective", "Yes",
                      "Effective", 1),
        dept="Finance", func="Financial Control", product="N/A", process="Financial reporting",
        basel1="Execution, Delivery & Process Management", basel2="Accounting Errors",
        impact_factors={"Financial Impact": 2, "Regulatory Compliance Obligations": 2},
        overall_impact="Medium", inherent_rating="Low", residual_rating="Low",
        response="Mitigate", poc="Financial Controller",
    ),
]


def _first_user_id(db: Session, tenant_id: int) -> Optional[int]:
    """First user in this (physically per-tenant) DB — matches startup_seed's owner
    resolution. Users carry no tenant_id column; the DB IS the tenant boundary."""
    from ..models import GRCUser
    row = db.query(GRCUser.id).order_by(GRCUser.id.asc()).first()
    return row[0] if row else None


def seed_onelink(db: Session, tenant_id: int) -> dict:
    """Idempotently seed 1LINK's ERM framework into one tenant. Additive only."""
    from ..models import (
        GovernanceCommittee, LikelihoodImpactScale, Risk, RiskAppetiteConfig,
        RiskKRI, RiskMitigationAction,
    )
    summary = {"scales": 0, "committees": 0, "appetite": 0, "risks": 0,
               "mitigation_actions": 0, "kris": 0}
    owner_id = _first_user_id(db, tenant_id)
    now = datetime.utcnow()

    # 1) 3x3 scales
    for scale_type, levels in SCALES.items():
        for level, label, desc, score, color in levels:
            exists = (db.query(LikelihoodImpactScale.id)
                      .filter(LikelihoodImpactScale.tenant_id == tenant_id,
                              LikelihoodImpactScale.scale_type == scale_type,
                              LikelihoodImpactScale.level == level).first())
            if exists:
                continue
            db.add(LikelihoodImpactScale(tenant_id=tenant_id, scale_type=scale_type, level=level,
                                         label=label, description=desc, score_value=score,
                                         color=color, is_default=True))
            summary["scales"] += 1

    # 2) Committees
    for c in COMMITTEES:
        exists = (db.query(GovernanceCommittee.id)
                  .filter(GovernanceCommittee.tenant_id == tenant_id,
                          GovernanceCommittee.name == c["name"]).first())
        if exists:
            continue
        db.add(GovernanceCommittee(tenant_id=tenant_id, name=c["name"],
                                   committee_type=c["committee_type"], description=c["description"],
                                   meeting_frequency=c["meeting_frequency"], is_active=True))
        summary["committees"] += 1

    # 3) Appetite — UPSERT by tenant+category. A tenant is auto-seeded with default
    #    appetite rows on provisioning, so we must UPDATE those in place with 1LINK's
    #    statements (skipping would leave generic values); reputational is net-new.
    for a in APPETITE:
        row = (db.query(RiskAppetiteConfig)
               .filter(RiskAppetiteConfig.tenant_id == tenant_id,
                       RiskAppetiteConfig.category == a["category"]).first())
        is_new = row is None
        if is_new:
            row = RiskAppetiteConfig(tenant_id=tenant_id, category=a["category"])
            db.add(row)
        row.appetite_level = a["appetite_level"]
        row.max_acceptable_score = a["max_acceptable_score"]
        row.tolerance_threshold = a["tolerance_threshold"]
        row.description = a["description"]
        row.alert_enabled = True
        if is_new:
            summary["appetite"] += 1

    # 4) Risks (+ mitigation actions + KRIs). Guard by title.
    for r in RISKS:
        exists = (db.query(Risk.id)
                  .filter(Risk.tenant_id == tenant_id, Risk.title == r["title"]).first())
        if exists:
            continue
        il, ii = r["inherent"]
        rl, ri_ = r["residual"]
        tf = _tf(r["category"].replace("_", " ").title(), r["sub_category"],
                 r["basel1"], r["basel2"], r["dept"], r["func"], r["product"], r["process"],
                 r["control"], r["impact_factors"], r["overall_impact"], r["inherent_rating"],
                 r["residual_rating"], r["response"], r["mitigation"]["title"],
                 r["mitigation"]["timeline"], r["mitigation"]["status"], r["poc"], r["risk_id"])
        risk = Risk(
            tenant_id=tenant_id, title=r["title"], description=r["description"],
            category=r["category"], risk_category=r["category"], risk_sub_category=r["sub_category"],
            register_type=REGISTER_LABEL,
            owner_id=owner_id, business_owner_id=owner_id,
            inherent_likelihood=il, inherent_impact=ii, inherent_score=float(il * ii),
            residual_likelihood=rl, residual_impact=ri_, residual_score=float(rl * ri_),
            risk_appetite=r["appetite"], status=r["status"], treatment_plan=r["treatment"],
            source_type="register_import", source_reference=f"{SEED_TAG}:{r['risk_id']}",
            template_fields=tf, review_date=now + timedelta(days=90),
        )
        db.add(risk)
        db.flush()  # get risk.id
        summary["risks"] += 1

        m = r["mitigation"]
        db.add(RiskMitigationAction(
            risk_id=risk.id, title=m["title"], action_type=m["action_type"],
            status=m["status"], priority=m["priority"], owner_id=owner_id,
            description=r["treatment"]))
        summary["mitigation_actions"] += 1

        k = r.get("kri")
        if k:
            db.add(RiskKRI(
                risk_id=risk.id, name=k["name"], metric_type=k["metric_type"], unit=k["unit"],
                current_value=float(k["current"]), green_threshold=float(k["green"]),
                amber_threshold=float(k["amber"]), threshold_direction=k["direction"],
                frequency=k["frequency"], data_source=k["data_source"], owner_id=owner_id,
                is_active=True, last_measured_at=now))
            summary["kris"] += 1

    db.commit()
    return summary
