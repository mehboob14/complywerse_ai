"""
Seed file for RCSA (Risk Control Self-Assessment) templates.
Creates pre-built assessment templates for SAMA, SBP, and Basel Operational Risk.
"""

from datetime import datetime
from .models import SessionLocal, RCSATemplate, RCSAQuestion


SAMA_OPERATIONAL_RISK_QUESTIONS = [
    {
        "section": "Internal Fraud Risks",
        "question_order": 1,
        "question_text": "How would you rate the current level of internal fraud risk in your department?",
        "question_type": "risk_rating",
        "risk_category": "Internal Fraud",
        "control_objective": "Identify and assess internal fraud exposure",
        "guidance_text": "Consider unauthorized transactions, theft by employees, intentional misreporting, and insider trading. Rate from 1 (Very Low) to 5 (Critical)."
    },
    {
        "section": "Internal Fraud Risks",
        "question_order": 2,
        "question_text": "Are segregation of duties controls effectively implemented for high-risk processes?",
        "question_type": "yes_no",
        "risk_category": "Internal Fraud",
        "control_objective": "Ensure proper segregation of duties",
        "guidance_text": "Evaluate if maker-checker principles are enforced for transactions, system access, and approval workflows."
    },
    {
        "section": "Internal Fraud Risks",
        "question_order": 3,
        "question_text": "Rate the effectiveness of employee screening and background verification controls.",
        "question_type": "control_rating",
        "risk_category": "Internal Fraud",
        "control_objective": "Prevent hiring of high-risk individuals",
        "guidance_text": "Consider pre-employment screening, periodic re-verification, and monitoring of staff in sensitive positions."
    },
    {
        "section": "External Fraud Risks",
        "question_order": 4,
        "question_text": "How would you rate the current exposure to external fraud threats?",
        "question_type": "risk_rating",
        "risk_category": "External Fraud",
        "control_objective": "Assess external fraud vulnerability",
        "guidance_text": "Consider phishing attacks, social engineering, account takeover, identity theft, and payment fraud schemes."
    },
    {
        "section": "External Fraud Risks",
        "question_order": 5,
        "question_text": "Rate the effectiveness of fraud detection and monitoring systems.",
        "question_type": "control_rating",
        "risk_category": "External Fraud",
        "control_objective": "Detect fraudulent activities timely",
        "guidance_text": "Evaluate real-time transaction monitoring, anomaly detection, and fraud analytics capabilities."
    },
    {
        "section": "External Fraud Risks",
        "question_order": 6,
        "question_text": "Are customer authentication controls adequate for high-risk transactions?",
        "question_type": "yes_no",
        "risk_category": "External Fraud",
        "control_objective": "Ensure strong customer authentication",
        "guidance_text": "Consider multi-factor authentication, biometrics, and step-up authentication for sensitive operations."
    },
    {
        "section": "IT and Cyber Security Risks",
        "question_order": 7,
        "question_text": "Rate the overall cyber security posture of your department's systems and applications.",
        "question_type": "risk_rating",
        "risk_category": "Technology Risk",
        "control_objective": "Maintain robust cyber security defenses",
        "guidance_text": "Consider vulnerability management, access controls, encryption, and security monitoring capabilities."
    },
    {
        "section": "IT and Cyber Security Risks",
        "question_order": 8,
        "question_text": "Rate the effectiveness of data protection and privacy controls.",
        "question_type": "control_rating",
        "risk_category": "Technology Risk",
        "control_objective": "Protect sensitive data",
        "guidance_text": "Evaluate data classification, encryption at rest and in transit, DLP controls, and privacy compliance."
    },
    {
        "section": "IT and Cyber Security Risks",
        "question_order": 9,
        "question_text": "Is there an up-to-date incident response plan for cyber security events?",
        "question_type": "yes_no",
        "risk_category": "Technology Risk",
        "control_objective": "Ensure timely incident response",
        "guidance_text": "Verify existence of documented procedures, defined roles, and regular testing of incident response capabilities."
    },
    {
        "section": "Business Continuity Risks",
        "question_order": 10,
        "question_text": "How would you rate the business continuity risk for critical processes in your area?",
        "question_type": "risk_rating",
        "risk_category": "Business Disruption",
        "control_objective": "Ensure operational resilience",
        "guidance_text": "Consider dependencies on systems, personnel, third parties, and physical facilities."
    },
    {
        "section": "Business Continuity Risks",
        "question_order": 11,
        "question_text": "Rate the effectiveness of disaster recovery and backup procedures.",
        "question_type": "control_rating",
        "risk_category": "Business Disruption",
        "control_objective": "Enable timely recovery from disruptions",
        "guidance_text": "Evaluate backup frequency, recovery testing, RTO/RPO achievements, and DR site readiness."
    },
    {
        "section": "Business Continuity Risks",
        "question_order": 12,
        "question_text": "Describe any gaps or concerns regarding business continuity preparedness.",
        "question_type": "text",
        "risk_category": "Business Disruption",
        "control_objective": "Identify continuity improvement areas",
        "guidance_text": "Provide specific details about resource gaps, untested scenarios, or single points of failure.",
        "is_required": False
    },
    {
        "section": "Regulatory Compliance Risks",
        "question_order": 13,
        "question_text": "Rate the current level of regulatory compliance risk in your area.",
        "question_type": "risk_rating",
        "risk_category": "Compliance Risk",
        "control_objective": "Maintain regulatory compliance",
        "guidance_text": "Consider SAMA regulations, AML/CFT requirements, consumer protection rules, and reporting obligations."
    },
    {
        "section": "Regulatory Compliance Risks",
        "question_order": 14,
        "question_text": "Rate the effectiveness of regulatory change management processes.",
        "question_type": "control_rating",
        "risk_category": "Compliance Risk",
        "control_objective": "Adapt to regulatory changes",
        "guidance_text": "Evaluate how well new regulations are identified, assessed, and implemented in a timely manner."
    },
    {
        "section": "Regulatory Compliance Risks",
        "question_order": 15,
        "question_text": "Are all required regulatory reports submitted accurately and on time?",
        "question_type": "yes_no",
        "risk_category": "Compliance Risk",
        "control_objective": "Ensure timely regulatory reporting",
        "guidance_text": "Review submission history, any delays or resubmissions, and data quality issues."
    }
]


SBP_RISK_ASSESSMENT_QUESTIONS = [
    {
        "section": "Credit Risk Self-Assessment",
        "question_order": 1,
        "question_text": "Rate the overall credit risk exposure in your portfolio or area of responsibility.",
        "question_type": "risk_rating",
        "risk_category": "Credit Risk",
        "control_objective": "Assess credit risk concentration",
        "guidance_text": "Consider borrower creditworthiness, collateral adequacy, sector concentrations, and NPL trends."
    },
    {
        "section": "Credit Risk Self-Assessment",
        "question_order": 2,
        "question_text": "Rate the effectiveness of credit underwriting and approval controls.",
        "question_type": "control_rating",
        "risk_category": "Credit Risk",
        "control_objective": "Ensure sound credit decisions",
        "guidance_text": "Evaluate credit analysis quality, approval authority adherence, and documentation completeness."
    },
    {
        "section": "Credit Risk Self-Assessment",
        "question_order": 3,
        "question_text": "Is credit monitoring and early warning system functioning effectively?",
        "question_type": "yes_no",
        "risk_category": "Credit Risk",
        "control_objective": "Enable proactive credit management",
        "guidance_text": "Assess portfolio monitoring reports, trigger identification, and escalation procedures."
    },
    {
        "section": "Operational Risk Self-Assessment",
        "question_order": 4,
        "question_text": "Rate the operational risk exposure from process failures in your area.",
        "question_type": "risk_rating",
        "risk_category": "Operational Risk",
        "control_objective": "Identify process vulnerabilities",
        "guidance_text": "Consider manual processes, system dependencies, error rates, and process complexity."
    },
    {
        "section": "Operational Risk Self-Assessment",
        "question_order": 5,
        "question_text": "Rate the effectiveness of operational controls and procedures.",
        "question_type": "control_rating",
        "risk_category": "Operational Risk",
        "control_objective": "Maintain robust operations",
        "guidance_text": "Evaluate SOPs, reconciliations, exception handling, and control self-testing."
    },
    {
        "section": "Operational Risk Self-Assessment",
        "question_order": 6,
        "question_text": "Are operational incidents properly recorded and analyzed?",
        "question_type": "yes_no",
        "risk_category": "Operational Risk",
        "control_objective": "Learn from incidents",
        "guidance_text": "Verify incident logging, root cause analysis, and corrective action tracking."
    },
    {
        "section": "Market Risk Awareness",
        "question_order": 7,
        "question_text": "Rate the current exposure to market risk factors affecting your area.",
        "question_type": "risk_rating",
        "risk_category": "Market Risk",
        "control_objective": "Understand market risk exposure",
        "guidance_text": "Consider interest rate risk, foreign exchange risk, equity price risk, and commodity price risk."
    },
    {
        "section": "Market Risk Awareness",
        "question_order": 8,
        "question_text": "Rate the effectiveness of market risk monitoring and reporting.",
        "question_type": "control_rating",
        "risk_category": "Market Risk",
        "control_objective": "Monitor market risk positions",
        "guidance_text": "Evaluate limit monitoring, VaR reporting, stress testing, and escalation procedures."
    },
    {
        "section": "Market Risk Awareness",
        "question_order": 9,
        "question_text": "Describe any emerging market risk concerns or limit breaches.",
        "question_type": "text",
        "risk_category": "Market Risk",
        "control_objective": "Identify market risk issues",
        "guidance_text": "Provide details on any limit utilization concerns, concentration issues, or market developments.",
        "is_required": False
    },
    {
        "section": "Liquidity Risk Monitoring",
        "question_order": 10,
        "question_text": "Rate the liquidity risk exposure in your area of operations.",
        "question_type": "risk_rating",
        "risk_category": "Liquidity Risk",
        "control_objective": "Assess liquidity position",
        "guidance_text": "Consider funding dependencies, maturity mismatches, and contingent liquidity needs."
    },
    {
        "section": "Liquidity Risk Monitoring",
        "question_order": 11,
        "question_text": "Rate the effectiveness of liquidity contingency planning.",
        "question_type": "control_rating",
        "risk_category": "Liquidity Risk",
        "control_objective": "Prepare for liquidity stress",
        "guidance_text": "Evaluate contingency funding plans, stress testing, and early warning indicators."
    },
    {
        "section": "Compliance Risk Assessment",
        "question_order": 12,
        "question_text": "Rate the compliance risk level for SBP regulations in your area.",
        "question_type": "risk_rating",
        "risk_category": "Compliance Risk",
        "control_objective": "Maintain SBP compliance",
        "guidance_text": "Consider prudential requirements, reporting obligations, and conduct regulations."
    },
    {
        "section": "Compliance Risk Assessment",
        "question_order": 13,
        "question_text": "Rate the effectiveness of AML/CFT controls in your area.",
        "question_type": "control_rating",
        "risk_category": "Compliance Risk",
        "control_objective": "Prevent money laundering",
        "guidance_text": "Evaluate customer due diligence, transaction monitoring, and suspicious activity reporting."
    },
    {
        "section": "Compliance Risk Assessment",
        "question_order": 14,
        "question_text": "Are all staff adequately trained on compliance requirements?",
        "question_type": "yes_no",
        "risk_category": "Compliance Risk",
        "control_objective": "Ensure compliance awareness",
        "guidance_text": "Review training completion rates, knowledge assessments, and refresher training frequency."
    },
    {
        "section": "Compliance Risk Assessment",
        "question_order": 15,
        "question_text": "List any compliance gaps or regulatory findings requiring attention.",
        "question_type": "text",
        "risk_category": "Compliance Risk",
        "control_objective": "Address compliance deficiencies",
        "guidance_text": "Document any open audit findings, regulatory observations, or self-identified gaps.",
        "is_required": False
    }
]


BASEL_OPERATIONAL_RISK_QUESTIONS = [
    {
        "section": "Internal Fraud",
        "question_order": 1,
        "question_text": "Rate the inherent risk of internal fraud in your business unit.",
        "question_type": "risk_rating",
        "risk_category": "Internal Fraud",
        "control_objective": "Assess internal fraud exposure",
        "guidance_text": "Per Basel II/III, internal fraud includes unauthorized activity, theft, and intentional mismarking of positions."
    },
    {
        "section": "Internal Fraud",
        "question_order": 2,
        "question_text": "Rate the effectiveness of controls to prevent and detect internal fraud.",
        "question_type": "control_rating",
        "risk_category": "Internal Fraud",
        "control_objective": "Mitigate internal fraud risk",
        "guidance_text": "Consider access controls, transaction monitoring, reconciliations, and whistleblower mechanisms."
    },
    {
        "section": "External Fraud",
        "question_order": 3,
        "question_text": "Rate the inherent risk of external fraud affecting your operations.",
        "question_type": "risk_rating",
        "risk_category": "External Fraud",
        "control_objective": "Assess external fraud exposure",
        "guidance_text": "External fraud includes theft of information, hacking, check fraud, and third-party manipulation."
    },
    {
        "section": "External Fraud",
        "question_order": 4,
        "question_text": "Rate the effectiveness of controls against external fraud threats.",
        "question_type": "control_rating",
        "risk_category": "External Fraud",
        "control_objective": "Prevent external fraud",
        "guidance_text": "Evaluate authentication controls, fraud detection systems, and customer verification procedures."
    },
    {
        "section": "Employment Practices & Workplace Safety",
        "question_order": 5,
        "question_text": "Rate the risk related to employment practices and workplace safety.",
        "question_type": "risk_rating",
        "risk_category": "Employment Practices",
        "control_objective": "Assess people-related risks",
        "guidance_text": "Consider workers compensation claims, discrimination issues, and general liability events."
    },
    {
        "section": "Employment Practices & Workplace Safety",
        "question_order": 6,
        "question_text": "Are HR policies and workplace safety controls adequate?",
        "question_type": "yes_no",
        "risk_category": "Employment Practices",
        "control_objective": "Ensure safe workplace",
        "guidance_text": "Review HR policies, safety procedures, training programs, and incident reporting mechanisms."
    },
    {
        "section": "Clients, Products & Business Practices",
        "question_order": 7,
        "question_text": "Rate the risk of losses from improper business or market practices.",
        "question_type": "risk_rating",
        "risk_category": "Business Practices",
        "control_objective": "Maintain ethical business conduct",
        "guidance_text": "Consider suitability issues, product defects, account churning, and market manipulation."
    },
    {
        "section": "Clients, Products & Business Practices",
        "question_order": 8,
        "question_text": "Rate the effectiveness of customer suitability and conduct controls.",
        "question_type": "control_rating",
        "risk_category": "Business Practices",
        "control_objective": "Ensure fair customer treatment",
        "guidance_text": "Evaluate product governance, suitability assessments, and customer complaint handling."
    },
    {
        "section": "Damage to Physical Assets",
        "question_order": 9,
        "question_text": "Rate the risk of losses from damage to physical assets.",
        "question_type": "risk_rating",
        "risk_category": "Physical Assets",
        "control_objective": "Protect physical infrastructure",
        "guidance_text": "Consider natural disasters, terrorism, vandalism, and other events affecting physical assets."
    },
    {
        "section": "Damage to Physical Assets",
        "question_order": 10,
        "question_text": "Are physical security and insurance controls adequate?",
        "question_type": "yes_no",
        "risk_category": "Physical Assets",
        "control_objective": "Mitigate physical asset risks",
        "guidance_text": "Review facility security, environmental controls, and insurance coverage adequacy."
    },
    {
        "section": "Business Disruption & System Failures",
        "question_order": 11,
        "question_text": "Rate the risk of business disruption from system failures.",
        "question_type": "risk_rating",
        "risk_category": "System Failures",
        "control_objective": "Assess technology resilience",
        "guidance_text": "Consider hardware failures, software bugs, utility outages, and telecommunications failures."
    },
    {
        "section": "Business Disruption & System Failures",
        "question_order": 12,
        "question_text": "Rate the effectiveness of business continuity and IT recovery controls.",
        "question_type": "control_rating",
        "risk_category": "System Failures",
        "control_objective": "Ensure system resilience",
        "guidance_text": "Evaluate BCP/DRP testing, redundancy arrangements, and recovery time achievements."
    },
    {
        "section": "Execution, Delivery & Process Management",
        "question_order": 13,
        "question_text": "Rate the risk of losses from failed transaction processing or process management.",
        "question_type": "risk_rating",
        "risk_category": "Process Management",
        "control_objective": "Assess process execution risks",
        "guidance_text": "Consider data entry errors, accounting errors, failed mandatory reporting, and negligent loss of client assets."
    },
    {
        "section": "Execution, Delivery & Process Management",
        "question_order": 14,
        "question_text": "Rate the effectiveness of process controls and quality assurance.",
        "question_type": "control_rating",
        "risk_category": "Process Management",
        "control_objective": "Ensure process quality",
        "guidance_text": "Evaluate standard procedures, exception handling, reconciliations, and quality checks."
    },
    {
        "section": "Execution, Delivery & Process Management",
        "question_order": 15,
        "question_text": "Describe any significant process weaknesses or control gaps identified.",
        "question_type": "text",
        "risk_category": "Process Management",
        "control_objective": "Document improvement needs",
        "guidance_text": "Provide details on manual workarounds, recurring errors, or process bottlenecks.",
        "is_required": False
    }
]


def seed_rcsa_templates():
    """Seed pre-built RCSA templates. Idempotent - checks before inserting."""
    db = SessionLocal()
    try:
        existing_sama = db.query(RCSATemplate).filter(
            RCSATemplate.source == "sama",
            RCSATemplate.is_system_template == True
        ).first()
        
        existing_sbp = db.query(RCSATemplate).filter(
            RCSATemplate.source == "sbp",
            RCSATemplate.is_system_template == True
        ).first()
        
        existing_basel = db.query(RCSATemplate).filter(
            RCSATemplate.source == "basel",
            RCSATemplate.is_system_template == True
        ).first()
        
        templates_created = 0
        
        if not existing_sama:
            sama_template = RCSATemplate(
                name="SAMA Operational Risk Assessment",
                description="Comprehensive operational risk self-assessment template aligned with Saudi Arabian Monetary Authority (SAMA) requirements. Covers internal fraud, external fraud, IT/cyber security, business continuity, and regulatory compliance risks.",
                category="operational_risk",
                source="sama",
                version="1.0",
                is_system_template=True,
                is_active=True,
                risk_categories=["Internal Fraud", "External Fraud", "Technology Risk", "Business Disruption", "Compliance Risk"],
                regulatory_mapping={
                    "framework": "SAMA Cyber Security Framework",
                    "applicable_domains": ["Cyber Security Governance", "Cyber Security Risk Management", "Cyber Security Operations"],
                    "region": "Saudi Arabia"
                }
            )
            db.add(sama_template)
            db.flush()
            
            for q_data in SAMA_OPERATIONAL_RISK_QUESTIONS:
                question = RCSAQuestion(
                    template_id=sama_template.id,
                    section=q_data["section"],
                    question_order=q_data["question_order"],
                    question_text=q_data["question_text"],
                    question_type=q_data["question_type"],
                    is_required=q_data.get("is_required", True),
                    risk_category=q_data.get("risk_category"),
                    control_objective=q_data.get("control_objective"),
                    guidance_text=q_data.get("guidance_text"),
                    ai_suggestion_enabled=True
                )
                db.add(question)
            
            templates_created += 1
            print("Created SAMA Operational Risk Assessment template with 15 questions")
        else:
            print("SAMA template already exists, skipping...")
        
        if not existing_sbp:
            sbp_template = RCSATemplate(
                name="SBP Risk Self-Assessment",
                description="Risk self-assessment template aligned with State Bank of Pakistan (SBP) regulatory requirements. Covers credit risk, operational risk, market risk, liquidity risk, and compliance risk categories.",
                category="operational_risk",
                source="sbp",
                version="1.0",
                is_system_template=True,
                is_active=True,
                risk_categories=["Credit Risk", "Operational Risk", "Market Risk", "Liquidity Risk", "Compliance Risk"],
                regulatory_mapping={
                    "framework": "SBP Risk Management Guidelines",
                    "applicable_domains": ["Credit Risk Management", "Operational Risk Management", "Market Risk Management", "Liquidity Risk Management"],
                    "region": "Pakistan"
                }
            )
            db.add(sbp_template)
            db.flush()
            
            for q_data in SBP_RISK_ASSESSMENT_QUESTIONS:
                question = RCSAQuestion(
                    template_id=sbp_template.id,
                    section=q_data["section"],
                    question_order=q_data["question_order"],
                    question_text=q_data["question_text"],
                    question_type=q_data["question_type"],
                    is_required=q_data.get("is_required", True),
                    risk_category=q_data.get("risk_category"),
                    control_objective=q_data.get("control_objective"),
                    guidance_text=q_data.get("guidance_text"),
                    ai_suggestion_enabled=True
                )
                db.add(question)
            
            templates_created += 1
            print("Created SBP Risk Self-Assessment template with 15 questions")
        else:
            print("SBP template already exists, skipping...")
        
        if not existing_basel:
            basel_template = RCSATemplate(
                name="Basel Operational Risk Assessment",
                description="Operational risk self-assessment template based on Basel II/III operational risk event categories. Covers all seven Basel loss event types for comprehensive operational risk identification.",
                category="operational_risk",
                source="basel",
                version="1.0",
                is_system_template=True,
                is_active=True,
                risk_categories=["Internal Fraud", "External Fraud", "Employment Practices", "Business Practices", "Physical Assets", "System Failures", "Process Management"],
                regulatory_mapping={
                    "framework": "Basel II/III Operational Risk Framework",
                    "applicable_domains": ["Loss Event Type Classification", "Operational Risk Capital"],
                    "region": "Global"
                }
            )
            db.add(basel_template)
            db.flush()
            
            for q_data in BASEL_OPERATIONAL_RISK_QUESTIONS:
                question = RCSAQuestion(
                    template_id=basel_template.id,
                    section=q_data["section"],
                    question_order=q_data["question_order"],
                    question_text=q_data["question_text"],
                    question_type=q_data["question_type"],
                    is_required=q_data.get("is_required", True),
                    risk_category=q_data.get("risk_category"),
                    control_objective=q_data.get("control_objective"),
                    guidance_text=q_data.get("guidance_text"),
                    ai_suggestion_enabled=True
                )
                db.add(question)
            
            templates_created += 1
            print("Created Basel Operational Risk Assessment template with 15 questions")
        else:
            print("Basel template already exists, skipping...")
        
        db.commit()
        print(f"RCSA template seeding complete. Created {templates_created} new templates.")
        
    except Exception as e:
        db.rollback()
        print(f"Error seeding RCSA templates: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_rcsa_templates()
