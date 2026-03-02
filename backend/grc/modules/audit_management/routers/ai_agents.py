import os
import json
import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    AuditPlan, AuditPlanItem, AuditableEntity, AuditEngagement,
    AuditFinding, AuditWorkpaper, AuditProcedure, AuditReport,
    AuditBoardPack, CCMAnomaly, CCMRule, Risk, RiskKRI,
    NormalizedControl, ParsedFrameworkControl, UploadedFramework,
    RegulatoryChange, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["Audit - AI Agents"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


def get_openai_client():
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


class AuditPlanGenerateRequest(BaseModel):
    fiscal_year: str
    team_size: Optional[int] = 12
    total_budget_days: Optional[float] = 180
    focus_areas: Optional[list] = []


class ProcedureGenerateRequest(BaseModel):
    control_description: str
    framework_name: Optional[str] = None
    control_type: Optional[str] = None
    engagement_id: Optional[int] = None


class FindingDraftRequest(BaseModel):
    engagement_id: int
    anomaly_description: str
    control_area: Optional[str] = None
    severity_hint: Optional[str] = None
    evidence_notes: Optional[str] = None


class CCMInsightsRequest(BaseModel):
    days: Optional[int] = 30


class EngagementDetailsRequest(BaseModel):
    title: str
    entity_name: Optional[str] = None
    engagement_type: Optional[str] = "assurance"
    risk_context: Optional[str] = None


class BoardPackNarrativeRequest(BaseModel):
    engagement_ids: list
    period: Optional[str] = None
    focus_areas: Optional[list] = []


class RiskSuggestionsRequest(BaseModel):
    engagement_id: int


class FindingSimilarityRequest(BaseModel):
    title: str
    condition: Optional[str] = None
    tenant_id: Optional[int] = None


class FieldworkGuidanceRequest(BaseModel):
    engagement_id: int


class RegulatoryImpactRequest(BaseModel):
    regulatory_change_id: int


class GenerateTestScriptRequest(BaseModel):
    engagement_id: int
    control_area: Optional[str] = None
    focus_area: Optional[str] = None


class SuggestEngagementSkillsRequest(BaseModel):
    engagement_id: Optional[int] = None
    audit_type: Optional[str] = None
    scope_description: Optional[str] = None


AUDIT_SKILL_TAXONOMY = {
    "financial": {
        "label": "Financial Audit",
        "L1": [
            {"skill": "Audit Methodology & Standards", "cert": "CIA"},
            {"skill": "Professional Communication", "cert": None},
            {"skill": "Audit Documentation & Workpapers", "cert": None},
            {"skill": "Basic Accounting Principles", "cert": None},
            {"skill": "Sampling Techniques", "cert": None},
        ],
        "L2": [
            {"skill": "Financial Statement Analysis", "cert": "CPA"},
            {"skill": "Revenue Recognition (ASC 606 / IFRS 15)", "cert": None},
            {"skill": "GAAP / IFRS Compliance", "cert": "CPA"},
            {"skill": "Internal Controls over Financial Reporting", "cert": "CIA"},
            {"skill": "Inventory & Asset Valuation", "cert": None},
            {"skill": "Accounts Payable/Receivable Testing", "cert": None},
            {"skill": "Journal Entry Testing", "cert": None},
            {"skill": "Tax Compliance Auditing", "cert": "CPA"},
        ],
        "L3": [
            {"skill": "Complex Derivatives & Fair Value Measurement", "cert": "CFA"},
            {"skill": "Consolidation & Multi-Entity Accounting", "cert": "CPA"},
            {"skill": "SOX Section 404 Testing", "cert": "CISA"},
            {"skill": "Going Concern Assessment", "cert": None},
            {"skill": "PCAOB Standards & Inspections", "cert": "CPA"},
            {"skill": "Forensic Accounting Techniques", "cert": "CFE"},
        ],
    },
    "it_security": {
        "label": "IT / Cybersecurity Audit",
        "L1": [
            {"skill": "IT General Controls (ITGC)", "cert": None},
            {"skill": "Basic Networking & Infrastructure", "cert": None},
            {"skill": "IT Audit Documentation", "cert": None},
            {"skill": "Information Security Fundamentals", "cert": "CompTIA Security+"},
            {"skill": "Change Management Review", "cert": None},
        ],
        "L2": [
            {"skill": "Access Control & Identity Management Testing", "cert": "CISA"},
            {"skill": "Database Security Auditing", "cert": None},
            {"skill": "Vulnerability Assessment Review", "cert": "CEH"},
            {"skill": "Cloud Security (AWS/Azure/GCP)", "cert": "CCSP"},
            {"skill": "Network Security Architecture Review", "cert": None},
            {"skill": "Incident Response Evaluation", "cert": None},
            {"skill": "Data Privacy & Protection Controls", "cert": "CIPP"},
            {"skill": "Business Continuity & DR Testing", "cert": None},
        ],
        "L3": [
            {"skill": "Penetration Testing & Red Team Assessment", "cert": "OSCP"},
            {"skill": "Cloud Security Architecture (Multi-cloud)", "cert": "CCSP"},
            {"skill": "SWIFT CSP / PCI-DSS Compliance", "cert": "QSA"},
            {"skill": "Zero Trust Architecture Evaluation", "cert": None},
            {"skill": "AI/ML Security & Ethics Auditing", "cert": None},
            {"skill": "ICS/SCADA/OT Security", "cert": "GICSP"},
            {"skill": "Cryptographic Controls Assessment", "cert": None},
        ],
    },
    "operational": {
        "label": "Operational Audit",
        "L1": [
            {"skill": "Process Mapping & Flowcharting", "cert": None},
            {"skill": "Interviewing & Observation Techniques", "cert": None},
            {"skill": "Statistical Sampling", "cert": None},
            {"skill": "Root Cause Analysis", "cert": None},
            {"skill": "Report Writing", "cert": None},
        ],
        "L2": [
            {"skill": "KPI & Performance Metrics Analysis", "cert": None},
            {"skill": "Supply Chain & Procurement Review", "cert": None},
            {"skill": "Efficiency & Effectiveness Assessment", "cert": None},
            {"skill": "Vendor & Third-Party Management Audit", "cert": None},
            {"skill": "HR & Payroll Process Auditing", "cert": None},
            {"skill": "Project Management Audit", "cert": "PMP"},
            {"skill": "Contract Compliance Review", "cert": None},
        ],
        "L3": [
            {"skill": "Lean / Six Sigma Process Improvement", "cert": "Six Sigma Black Belt"},
            {"skill": "Business Process Reengineering", "cert": None},
            {"skill": "Robotic Process Automation (RPA) Audit", "cert": None},
            {"skill": "Organizational Design & Governance Review", "cert": None},
            {"skill": "Shared Services & Outsourcing Assessment", "cert": None},
        ],
    },
    "banking": {
        "label": "Banking / Financial Services Audit",
        "L1": [
            {"skill": "Regulatory Awareness (Banking)", "cert": None},
            {"skill": "Basic Banking Operations", "cert": None},
            {"skill": "Audit Documentation & Evidence", "cert": None},
            {"skill": "Compliance Fundamentals", "cert": None},
            {"skill": "Financial Crime Awareness", "cert": None},
        ],
        "L2": [
            {"skill": "Credit Risk Assessment & Loan Review", "cert": "FRM"},
            {"skill": "AML/KYC/CDD Review", "cert": "CAMS"},
            {"skill": "Treasury & Liquidity Operations Audit", "cert": None},
            {"skill": "Payment Systems & Card Processing", "cert": None},
            {"skill": "Interest Rate Risk Management", "cert": None},
            {"skill": "Regulatory Reporting (Call Reports, FR Y-9C)", "cert": None},
            {"skill": "Deposit Operations & Reconciliation", "cert": None},
            {"skill": "Trade Finance & Letters of Credit", "cert": None},
        ],
        "L3": [
            {"skill": "Basel III/IV Capital Adequacy", "cert": "FRM"},
            {"skill": "Model Risk Validation (SR 11-7)", "cert": None},
            {"skill": "Stress Testing & Scenario Analysis (CCAR/DFAST)", "cert": None},
            {"skill": "Liquidity Coverage Ratio & NSFR", "cert": None},
            {"skill": "SWIFT Security & Correspondent Banking", "cert": None},
            {"skill": "Derivatives & Structured Products Audit", "cert": "CFA"},
            {"skill": "Digital Banking & Fintech Risk", "cert": None},
        ],
    },
    "compliance": {
        "label": "Compliance Audit",
        "L1": [
            {"skill": "Regulatory Research & Interpretation", "cert": None},
            {"skill": "Policy & Procedure Review", "cert": None},
            {"skill": "Documentation & Evidence Collection", "cert": None},
            {"skill": "Compliance Testing Basics", "cert": None},
            {"skill": "Ethics & Code of Conduct Review", "cert": None},
        ],
        "L2": [
            {"skill": "Gap Analysis & Remediation Planning", "cert": None},
            {"skill": "Regulatory Change Tracking & Impact", "cert": None},
            {"skill": "Control Testing & Effectiveness", "cert": "CIA"},
            {"skill": "Whistleblower & Hotline Program Review", "cert": None},
            {"skill": "Training & Awareness Program Assessment", "cert": None},
            {"skill": "License & Permit Compliance", "cert": None},
            {"skill": "Third-Party Compliance Due Diligence", "cert": None},
        ],
        "L3": [
            {"skill": "Cross-Jurisdiction Regulatory Compliance", "cert": None},
            {"skill": "Privacy Regulation (GDPR/CCPA/LGPD)", "cert": "CIPP/E"},
            {"skill": "Sanctions & Export Control Screening", "cert": "CAMS"},
            {"skill": "Healthcare Compliance (HIPAA/HITECH)", "cert": "CHC"},
            {"skill": "Environmental Regulatory Compliance", "cert": None},
            {"skill": "Anti-Bribery & Corruption (FCPA/UK Bribery Act)", "cert": None},
        ],
    },
    "forensic": {
        "label": "Forensic / Investigation Audit",
        "L1": [
            {"skill": "Evidence Preservation & Chain of Custody", "cert": None},
            {"skill": "Interview & Interrogation Techniques", "cert": None},
            {"skill": "Documentation & Case Management", "cert": None},
            {"skill": "Fraud Awareness & Red Flags", "cert": None},
            {"skill": "Ethics in Investigations", "cert": None},
        ],
        "L2": [
            {"skill": "Data Analytics for Fraud Detection", "cert": None},
            {"skill": "Fraud Scheme Knowledge (Occupational Fraud)", "cert": "CFE"},
            {"skill": "Digital Forensics & Data Recovery", "cert": "EnCE"},
            {"skill": "Financial Statement Fraud Analysis", "cert": "CFE"},
            {"skill": "Asset Tracing & Recovery", "cert": None},
            {"skill": "Benford's Law & Statistical Anomaly Detection", "cert": None},
        ],
        "L3": [
            {"skill": "Expert Witness Testimony", "cert": "CFE"},
            {"skill": "E-Discovery & Litigation Support", "cert": None},
            {"skill": "Complex Fraud Investigation (Ponzi/Insider Trading)", "cert": None},
            {"skill": "Cryptocurrency & Blockchain Forensics", "cert": None},
            {"skill": "Anti-Money Laundering Investigation", "cert": "CAMS"},
            {"skill": "Regulatory Enforcement Defense", "cert": None},
        ],
    },
    "esg": {
        "label": "Environmental / ESG Audit",
        "L1": [
            {"skill": "ESG Framework Knowledge (GRI/SASB/TCFD)", "cert": None},
            {"skill": "Stakeholder Engagement", "cert": None},
            {"skill": "Documentation & Reporting Basics", "cert": None},
            {"skill": "Sustainability Fundamentals", "cert": None},
        ],
        "L2": [
            {"skill": "Carbon Accounting & GHG Protocol", "cert": None},
            {"skill": "Supply Chain Sustainability Assessment", "cert": None},
            {"skill": "GRI/SASB/ISSB Reporting Verification", "cert": None},
            {"skill": "Social Impact & Human Rights Due Diligence", "cert": None},
            {"skill": "Governance & Board Diversity Assessment", "cert": None},
            {"skill": "Circular Economy & Waste Management Audit", "cert": None},
        ],
        "L3": [
            {"skill": "Climate Risk Modeling (Physical & Transition)", "cert": None},
            {"skill": "Scope 3 Emissions Verification", "cert": None},
            {"skill": "EU Taxonomy & CSRD Compliance", "cert": None},
            {"skill": "Green Bond / Sustainable Finance Verification", "cert": "CFA ESG"},
            {"skill": "Biodiversity & Natural Capital Assessment", "cert": None},
        ],
    },
    "internal_audit": {
        "label": "Internal Audit (General / IIA Standards)",
        "L1": [
            {"skill": "IIA International Standards (IPPF)", "cert": "CIA"},
            {"skill": "Risk Assessment & Prioritization", "cert": None},
            {"skill": "Audit Planning & Scoping", "cert": None},
            {"skill": "Documentation & Working Papers", "cert": None},
            {"skill": "Professional Skepticism & Ethics", "cert": None},
        ],
        "L2": [
            {"skill": "Data Analytics & ACL/IDEA/Python", "cert": None},
            {"skill": "COSO ERM Framework Application", "cert": None},
            {"skill": "Continuous Auditing & Monitoring", "cert": None},
            {"skill": "Stakeholder Management & Communication", "cert": None},
            {"skill": "Quality Assurance (QAIP)", "cert": "CIA"},
            {"skill": "Co-sourcing & Outsourcing Management", "cert": None},
            {"skill": "Integrated Audit Approach (Financial + Operational)", "cert": None},
        ],
        "L3": [
            {"skill": "Enterprise Risk Quantification & Modeling", "cert": "CRMA"},
            {"skill": "Agile / Continuous Auditing Methodologies", "cert": None},
            {"skill": "AI/ML Applications in Audit", "cert": None},
            {"skill": "Audit Transformation & Innovation", "cert": None},
            {"skill": "Board & Audit Committee Advisory", "cert": None},
            {"skill": "Three Lines Model Implementation", "cert": None},
        ],
    },
}


@router.post("/generate-audit-plan")
def ai_generate_audit_plan(
    data: AuditPlanGenerateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    user_tenants = get_user_tenants(current_user, db)
    
    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants)
    ).order_by(Risk.residual_score.desc()).limit(20).all()
    
    risk_data = []
    for r in risks:
        risk_data.append({
            "title": r.title,
            "category": r.risk_category,
            "residual_score": r.residual_score,
            "treatment": r.treatment_plan,
            "status": r.status,
        })
    
    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id.in_(user_tenants),
        AuditableEntity.status == "active"
    ).all()
    
    entity_data = []
    for e in entities:
        entity_data.append({
            "name": e.name,
            "type": e.entity_type,
            "risk_score": e.risk_score,
            "last_audited": e.last_audited_date.isoformat() if e.last_audited_date else "Never",
            "cycle_months": e.audit_cycle_months,
        })
    
    prior_findings = db.query(AuditFinding).filter(
        AuditFinding.tenant_id.in_(user_tenants),
        AuditFinding.status.in_(["open", "in_progress"])
    ).limit(15).all()
    
    prior_data = [{"title": f.title, "severity": f.severity, "status": f.status} for f in prior_findings]
    
    prompt = f"""You are a Chief Audit Executive AI assistant. Generate an optimized Annual Audit Plan for fiscal year {data.fiscal_year}.

CONTEXT:
- Team size: {data.team_size} auditors
- Total budget: {data.total_budget_days} audit days
- Focus areas: {json.dumps(data.focus_areas) if data.focus_areas else 'All areas'}

RISK REGISTER (Top 20 by residual score):
{json.dumps(risk_data, indent=2)}

AUDITABLE ENTITIES:
{json.dumps(entity_data, indent=2)}

OPEN PRIOR FINDINGS:
{json.dumps(prior_data, indent=2)}

Generate an optimized audit plan as JSON with:
{{
    "plan_name": "Annual Audit Plan {data.fiscal_year}",
    "risk_alignment_score": <0-100 score showing plan-to-risk alignment>,
    "items": [
        {{
            "name": "<audit area name>",
            "risk_score": <0-100>,
            "quarter": "Q1|Q2|Q3|Q4",
            "budget_days": <number>,
            "priority": "critical|high|medium|low",
            "rationale": "<why this should be audited>",
            "framework": "<applicable framework if any>"
        }}
    ]
}}

Prioritize: (1) High-risk areas, (2) Never-audited entities, (3) Areas with open findings, (4) Regulatory requirements.
Ensure even quarterly distribution and total budget within {data.total_budget_days} days."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=3000,
        )
        
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            plan_data = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            plan_data = {"plan_name": f"AI Audit Plan {data.fiscal_year}", "items": [], "raw_response": content}
        
        plan = AuditPlan(
            tenant_id=tenant_id,
            name=plan_data.get("plan_name", f"AI-Generated Audit Plan {data.fiscal_year}"),
            fiscal_year=data.fiscal_year,
            description=f"AI-generated audit plan based on {len(risk_data)} risks, {len(entity_data)} auditable entities, and {len(prior_data)} open findings.",
            total_budget_days=data.total_budget_days,
            ai_generated=True,
            ai_generation_params={"team_size": data.team_size, "focus_areas": data.focus_areas},
            risk_alignment_score=plan_data.get("risk_alignment_score"),
            created_by_id=current_user.id,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        
        for item_data in plan_data.get("items", []):
            item = AuditPlanItem(
                plan_id=plan.id,
                name=item_data.get("name", "Unnamed"),
                risk_score=item_data.get("risk_score", 0),
                quarter=item_data.get("quarter"),
                budget_days=item_data.get("budget_days", 0),
                priority=item_data.get("priority", "medium"),
                notes=item_data.get("rationale", ""),
            )
            db.add(item)
        
        db.commit()
        
        return {
            "plan_id": plan.id,
            "plan_name": plan.name,
            "risk_alignment_score": plan.risk_alignment_score,
            "items_count": len(plan_data.get("items", [])),
            "ai_plan": plan_data,
        }
        
    except Exception as e:
        logger.error(f"AI plan generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/generate-procedures")
def ai_generate_procedures(
    data: ProcedureGenerateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    prompt = f"""You are a Senior Internal Auditor. Generate detailed audit test procedures for the following control:

Control Description: {data.control_description}
Framework: {data.framework_name or 'General'}
Control Type: {data.control_type or 'Preventive'}

Generate audit procedures as JSON:
{{
    "procedures": [
        {{
            "title": "<procedure title>",
            "description": "<detailed test steps>",
            "test_type": "control_test|substantive_test|walkthrough|inquiry|observation|inspection",
            "sampling_methodology": "statistical|judgmental|haphazard|block",
            "expected_evidence": "<what evidence to collect>"
        }}
    ]
}}

Include 3-6 procedures covering: design effectiveness testing, operating effectiveness testing, and substantive testing where applicable. Follow IIA Standard 2320 (Analysis and Evaluation)."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {"procedures": [], "raw_response": content}
        
        if data.engagement_id:
            user_tenants = get_user_tenants(current_user, db)
            eng = db.query(AuditEngagement).filter(
                AuditEngagement.id == data.engagement_id,
                AuditEngagement.tenant_id.in_(user_tenants)
            ).first()
            
            if eng:
                wp = AuditWorkpaper(
                    engagement_id=data.engagement_id,
                    title=f"AI-Generated: {data.control_description[:100]}",
                    description="Auto-generated test procedures from AI",
                    workpaper_type="test",
                    preparer_id=current_user.id,
                )
                db.add(wp)
                db.commit()
                db.refresh(wp)
                
                for idx, proc_data in enumerate(result.get("procedures", [])):
                    proc = AuditProcedure(
                        workpaper_id=wp.id,
                        procedure_number=f"P-{idx + 1:03d}",
                        title=proc_data.get("title", f"Procedure {idx + 1}"),
                        description=proc_data.get("description", ""),
                        test_type=proc_data.get("test_type", "control_test"),
                        sampling_methodology=proc_data.get("sampling_methodology"),
                        ai_generated=True,
                    )
                    db.add(proc)
                
                db.commit()
                result["workpaper_id"] = wp.id
        
        return result
        
    except Exception as e:
        logger.error(f"AI procedure generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/draft-finding")
def ai_draft_finding(
    data: FindingDraftRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    prompt = f"""You are a Senior Internal Auditor drafting an audit finding per IIA Standard 2400 (Communicating Results).

Engagement: {eng.title}
Anomaly/Issue Description: {data.anomaly_description}
Control Area: {data.control_area or 'General'}
Evidence Notes: {data.evidence_notes or 'None provided'}

Draft a finding in the standard Condition/Criteria/Cause/Effect format as JSON:
{{
    "title": "<concise finding title>",
    "condition": "<what was found — the factual observation>",
    "criteria": "<what should be — the standard, policy, or regulation>",
    "cause": "<why it happened — root cause analysis>",
    "effect": "<impact or potential impact — risk exposure>",
    "root_cause_category": "people|process|technology|governance",
    "severity": "critical|high|medium|low|observation",
    "framework_mappings": ["<applicable frameworks e.g. SOX 404, COSO, IIA 2320, ISO 27001>"],
    "recommendation": "<specific, actionable recommendation>",
    "risk_implications": "<how this finding affects the organization's risk profile>"
}}

Be specific, factual, and avoid vague language. Map to all applicable regulatory frameworks."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            finding_data = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            finding_data = {"raw_response": content}
        
        return {"draft_finding": finding_data, "engagement_id": data.engagement_id}
        
    except Exception as e:
        logger.error(f"AI finding draft error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/ccm-insights")
def ai_ccm_insights(
    data: CCMInsightsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=data.days)
    
    anomalies = db.query(CCMAnomaly).options(
        joinedload(CCMAnomaly.rule)
    ).filter(
        CCMAnomaly.tenant_id.in_(user_tenants),
        CCMAnomaly.detected_at >= cutoff
    ).all()
    
    if not anomalies:
        return {"insights": {"summary": "No anomalies detected in the specified period.", "patterns": [], "recommendations": []}}
    
    anomaly_data = []
    for a in anomalies:
        anomaly_data.append({
            "title": a.title,
            "severity": a.severity,
            "control_area": a.control_area,
            "rule": a.rule.name if a.rule else "Unknown",
            "is_false_positive": a.is_false_positive,
            "status": a.status,
            "amount": a.transaction_amount,
        })
    
    prompt = f"""You are a Continuous Control Monitoring analyst. Analyze the following {len(anomaly_data)} anomalies detected in the last {data.days} days:

{json.dumps(anomaly_data, indent=2)}

Provide analysis as JSON:
{{
    "summary": "<executive summary of monitoring activity>",
    "patterns": [
        {{
            "pattern": "<identified pattern description>",
            "frequency": "<how often>",
            "risk_level": "high|medium|low",
            "affected_area": "<control area>"
        }}
    ],
    "recommendations": [
        {{
            "action": "<recommended action>",
            "priority": "immediate|short_term|long_term",
            "rationale": "<why this matters>"
        }}
    ],
    "rule_adjustments": [
        {{
            "rule": "<rule name>",
            "adjustment": "<suggested change>",
            "reason": "<why adjust>"
        }}
    ],
    "false_positive_analysis": "<analysis of false positive rate and suggestions to reduce>"
}}"""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            insights = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            insights = {"summary": content, "patterns": [], "recommendations": []}
        
        return {"insights": insights, "anomalies_analyzed": len(anomaly_data), "period_days": data.days}
        
    except Exception as e:
        logger.error(f"AI CCM insights error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/board-pack-narrative")
def ai_board_pack_narrative(
    data: BoardPackNarrativeRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    engagements = db.query(AuditEngagement).filter(
        AuditEngagement.id.in_(data.engagement_ids),
        AuditEngagement.tenant_id.in_(user_tenants)
    ).all()
    
    if not engagements:
        raise HTTPException(status_code=404, detail="No engagements found")
    
    eng_data = []
    for eng in engagements:
        findings = db.query(AuditFinding).filter(
            AuditFinding.engagement_id == eng.id
        ).all()
        
        eng_data.append({
            "title": eng.title,
            "status": eng.status,
            "opinion": eng.opinion,
            "scope": eng.scope,
            "findings_count": len(findings),
            "critical_findings": sum(1 for f in findings if f.severity == "critical"),
            "high_findings": sum(1 for f in findings if f.severity == "high"),
            "finding_titles": [f.title for f in findings[:10]],
        })
    
    prompt = f"""You are a Chief Audit Executive preparing a Board Audit Pack. Generate executive narratives for the following audit engagements:

Period: {data.period or 'Current Quarter'}
Engagements:
{json.dumps(eng_data, indent=2)}

Generate as JSON:
{{
    "executive_summary": "<2-3 paragraph executive summary for the Board>",
    "opinion_summary": "<overall audit opinion narrative>",
    "key_themes": ["<major themes across all audits>"],
    "risk_highlights": ["<key risk areas requiring Board attention>"],
    "positive_observations": ["<areas of strong control>"],
    "action_items_for_board": ["<specific items requiring Board decision or awareness>"]
}}

Write in formal board-level language. Be concise but comprehensive. Follow IIA Standard 2060 (Reporting to Senior Management and the Board)."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            narrative = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            narrative = {"executive_summary": content, "key_themes": [], "risk_highlights": []}
        
        return {"narrative": narrative, "engagements_included": len(engagements)}
        
    except Exception as e:
        logger.error(f"AI board pack narrative error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/generate-engagement-details")
def ai_generate_engagement_details(
    data: EngagementDetailsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")

    try:
        client = get_openai_client()

        entity_context = f" for the auditable entity '{data.entity_name}'" if data.entity_name else ""
        risk_context = f"\nAdditional risk context: {data.risk_context}" if data.risk_context else ""

        prompt = f"""You are an expert internal audit professional following IIA 2024 standards.
Generate a professional description, scope, and objectives for an audit engagement.

Engagement Title: {data.title}
Engagement Type: {data.engagement_type}{entity_context}{risk_context}

Return a JSON object with exactly these keys:
- "description": A concise 2-3 sentence professional description of the engagement purpose and approach
- "scope": A detailed scope statement covering what will be examined, the time period, and any boundaries/limitations (3-5 sentences)
- "objectives": Clear audit objectives as a numbered list in a single string, typically 3-5 objectives focused on evaluating controls, compliance, and effectiveness

Return ONLY valid JSON, no markdown or extra text."""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1000
        )

        content = response.choices[0].message.content.strip()
        try:
            if "```" in content:
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {
                "description": content,
                "scope": "",
                "objectives": ""
            }

        return {
            "description": result.get("description", ""),
            "scope": result.get("scope", ""),
            "objectives": result.get("objectives", "")
        }

    except Exception as e:
        logger.error(f"AI engagement details error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/risk-assessment-suggestions")
def ai_risk_assessment_suggestions(
    data: RiskSuggestionsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    findings = db.query(AuditFinding).filter(
        AuditFinding.engagement_id == eng.id
    ).all()

    if not findings:
        return {"suggestions": [], "message": "No findings to analyze"}

    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == eng.auditable_entity_id
    ).first() if eng.auditable_entity_id else None

    linked_risk_ids = (entity.linked_risk_ids or []) if entity else []
    risks = db.query(Risk).filter(
        Risk.id.in_(linked_risk_ids),
        Risk.tenant_id.in_(user_tenants)
    ).all() if linked_risk_ids else db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants)
    ).limit(10).all()

    findings_data = [{"title": f.title, "severity": f.severity, "status": f.status, "condition": f.condition or "", "effect": f.effect or ""} for f in findings]
    risks_data = [{"id": r.id, "title": r.title, "category": r.risk_category, "inherent_score": r.inherent_score, "residual_score": r.residual_score, "status": r.status} for r in risks]

    prompt = f"""You are a Risk Assessment AI for internal audit. Based on audit findings, suggest adjustments to the Risk Register.

ENGAGEMENT: {eng.title}
FINDINGS ({len(findings_data)} total):
{json.dumps(findings_data, indent=2)}

LINKED RISKS:
{json.dumps(risks_data, indent=2)}

Analyze the findings and suggest risk score adjustments. Return JSON:
{{
    "suggestions": [
        {{
            "risk_id": <int>,
            "risk_title": "<title>",
            "current_score": <current residual score>,
            "suggested_score": <new suggested residual score>,
            "adjustment_direction": "increase|decrease|no_change",
            "rationale": "<detailed reason based on findings>"
        }}
    ],
    "overall_assessment": "<summary of how findings impact the risk profile>"
}}

Consider: finding severity distribution, control gaps identified, recurring issues, and potential cascading effects."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {"suggestions": [], "overall_assessment": content}
        return {"suggestions": result.get("suggestions", []), "overall_assessment": result.get("overall_assessment", ""), "engagement_id": eng.id, "findings_analyzed": len(findings)}
    except Exception as e:
        logger.error(f"AI risk suggestions error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/finding-similarity")
def ai_finding_similarity(
    data: FindingSimilarityRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    past_findings = db.query(AuditFinding).options(
        joinedload(AuditFinding.engagement)
    ).filter(
        AuditFinding.tenant_id.in_(user_tenants)
    ).order_by(AuditFinding.created_at.desc()).limit(50).all()

    if not past_findings:
        return {"similar_findings": [], "message": "No historical findings to compare"}

    past_data = []
    for f in past_findings:
        past_data.append({
            "id": f.id,
            "finding_number": f.finding_number,
            "title": f.title,
            "condition": f.condition or "",
            "severity": f.severity,
            "status": f.status,
            "engagement_title": f.engagement.title if f.engagement else "Unknown",
            "created_at": f.created_at.isoformat() if f.created_at else "",
        })

    prompt = f"""You are an audit finding similarity analyzer. Compare the NEW finding with HISTORICAL findings and identify similar ones.

NEW FINDING:
Title: {data.title}
Condition: {data.condition or 'Not provided'}

HISTORICAL FINDINGS:
{json.dumps(past_data, indent=2)}

Identify the top 5 most similar findings. Return JSON:
{{
    "similar_findings": [
        {{
            "finding_id": <int from historical data>,
            "finding_number": "<from historical data>",
            "title": "<from historical data>",
            "similarity_pct": <0-100 percentage>,
            "engagement_title": "<from historical data>",
            "status": "<from historical data>",
            "severity": "<from historical data>",
            "is_recurring": <true if similar issue and still open/in_progress>,
            "similarity_reason": "<brief explanation of why similar>"
        }}
    ]
}}

Only include findings with similarity >= 30%. Sort by similarity_pct descending."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1500,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {"similar_findings": []}
        return {"similar_findings": result.get("similar_findings", []), "total_compared": len(past_data)}
    except Exception as e:
        logger.error(f"AI similarity error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/fieldwork-guidance")
def ai_fieldwork_guidance(
    data: FieldworkGuidanceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == eng.auditable_entity_id
    ).first() if eng.auditable_entity_id else None

    entity_type = entity.entity_type if entity else "general"
    entity_name = entity.name if entity else eng.title
    risk_score = entity.risk_score if entity else 0

    prior_findings = db.query(AuditFinding).join(AuditEngagement).filter(
        AuditEngagement.auditable_entity_id == eng.auditable_entity_id,
        AuditFinding.tenant_id.in_(user_tenants)
    ).limit(10).all() if eng.auditable_entity_id else []

    prior_data = [{"title": f.title, "severity": f.severity, "status": f.status, "condition": f.condition or ""} for f in prior_findings]

    framework_name = ""
    if eng.framework_id:
        fw = db.query(UploadedFramework).filter(UploadedFramework.id == eng.framework_id).first()
        framework_name = fw.name if fw else ""

    audit_nature = eng.engagement_type or "assurance"
    prompt = f"""You are a Senior Internal Auditor providing fieldwork guidance. Based on the audit engagement details, generate comprehensive guidance on what types of findings to look for, with sample data examples.

ENGAGEMENT: {eng.title}
AUDIT NATURE: {audit_nature}
ENTITY: {entity_name} (Type: {entity_type}, Risk Score: {risk_score})
SCOPE: {eng.scope or 'Not defined'}
OBJECTIVES: {eng.objectives or 'Not defined'}
FRAMEWORK: {framework_name or 'General'}

PRIOR FINDINGS FOR THIS ENTITY:
{json.dumps(prior_data, indent=2) if prior_data else 'No prior findings'}

Generate fieldwork guidance as JSON:
{{
    "audit_type_classification": "technical|financial|compliance|operational|mixed",
    "guidance_areas": [
        {{
            "area_name": "<finding category to examine>",
            "description": "<what to look for in this area>",
            "risk_level": "high|medium|low",
            "sample_findings": [
                {{
                    "title": "<example finding title>",
                    "condition_example": "<what you might find - with realistic sample data>",
                    "criteria_reference": "<policy/standard this relates to>",
                    "severity": "critical|high|medium|low"
                }}
            ],
            "key_controls_to_test": ["<specific controls to evaluate>"],
            "evidence_to_collect": ["<specific documents/data to request>"],
            "sample_test_data": "<realistic example of what anomalous data looks like, e.g., 'User account admin_backup last login: 14 months ago, privileges: Full Admin, MFA: Disabled'>"
        }}
    ],
    "general_tips": ["<practical audit tips for this type of engagement>"],
    "red_flags": ["<specific warning signs to watch for>"]
}}

Generate 4-6 guidance areas relevant to the {entity_type} entity type and {audit_nature} audit nature. Include realistic, specific sample data that auditors can relate to their actual testing."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=3000,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {"audit_type_classification": "mixed", "guidance_areas": [], "general_tips": [content], "red_flags": []}
        return {
            "engagement_id": eng.id,
            "engagement_title": eng.title,
            "entity_name": entity_name,
            "audit_type_classification": result.get("audit_type_classification", "mixed"),
            "guidance_areas": result.get("guidance_areas", []),
            "general_tips": result.get("general_tips", []),
            "red_flags": result.get("red_flags", []),
            "prior_findings_count": len(prior_data),
        }
    except Exception as e:
        logger.error(f"AI fieldwork guidance error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/regulatory-impact-assessment")
def ai_regulatory_impact_assessment(
    data: RegulatoryImpactRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    reg_change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == data.regulatory_change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    if not reg_change:
        raise HTTPException(status_code=404, detail="Regulatory change not found")

    entities = db.query(AuditableEntity).filter(
        AuditableEntity.tenant_id.in_(user_tenants),
        AuditableEntity.status == "active"
    ).all()

    plan_items = db.query(AuditPlanItem).join(AuditPlan).filter(
        AuditPlan.tenant_id.in_(user_tenants),
        AuditPlan.status.in_(["draft", "approved", "active"])
    ).all()

    entities_data = [{"id": e.id, "name": e.name, "type": e.entity_type, "risk_score": e.risk_score, "risk_rating": e.risk_rating} for e in entities]
    items_data = [{"id": i.id, "name": i.name, "quarter": i.quarter, "risk_score": i.risk_score, "priority": i.priority, "status": i.status} for i in plan_items]

    prompt = f"""You are a Regulatory Compliance AI for internal audit. Analyze the impact of a new regulatory change on the audit universe and audit plans.

REGULATORY CHANGE:
Title: {reg_change.title}
Description: {reg_change.description or 'No description'}
Source: {reg_change.source or 'Unknown'}
Priority: {reg_change.priority or 'Unknown'}
Effective Date: {reg_change.effective_date.isoformat() if reg_change.effective_date else 'TBD'}

AUDIT UNIVERSE ENTITIES:
{json.dumps(entities_data, indent=2)}

CURRENT AUDIT PLAN ITEMS:
{json.dumps(items_data, indent=2)}

Assess the regulatory impact and return JSON:
{{
    "affected_entities": [
        {{
            "entity_id": <int>,
            "entity_name": "<name>",
            "impact_level": "high|medium|low",
            "reasoning": "<why this entity is affected>"
        }}
    ],
    "affected_plan_items": [
        {{
            "plan_item_id": <int>,
            "plan_item_name": "<name>",
            "impact": "<how the regulation affects this planned audit>",
            "suggested_action": "expand_scope|increase_priority|no_change"
        }}
    ],
    "suggested_new_audits": [
        {{
            "name": "<suggested new audit name>",
            "rationale": "<why this new audit is needed>",
            "priority": "critical|high|medium",
            "suggested_quarter": "Q1|Q2|Q3|Q4"
        }}
    ],
    "overall_impact_summary": "<executive summary of the regulatory impact on audit planning>"
}}"""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2500,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {"affected_entities": [], "affected_plan_items": [], "suggested_new_audits": [], "overall_impact_summary": content}
        return {
            "regulatory_change_id": reg_change.id,
            "regulatory_change_title": reg_change.title,
            "affected_entities": result.get("affected_entities", []),
            "affected_plan_items": result.get("affected_plan_items", []),
            "suggested_new_audits": result.get("suggested_new_audits", []),
            "overall_impact_summary": result.get("overall_impact_summary", ""),
        }
    except Exception as e:
        logger.error(f"AI regulatory impact error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/generate-test-script")
def ai_generate_test_script(
    data: GenerateTestScriptRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    engagement = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not engagement:
        raise HTTPException(status_code=404, detail="Engagement not found")

    findings = db.query(AuditFinding).filter(
        AuditFinding.engagement_id == data.engagement_id
    ).all()
    findings_data = [
        {
            "title": f.title,
            "condition": f.condition,
            "severity": f.severity,
            "criteria": f.criteria,
            "control_area": getattr(f, "control_area", None),
        }
        for f in findings
    ]

    entity = None
    if engagement.auditable_entity_id:
        entity = db.query(AuditableEntity).filter(AuditableEntity.id == engagement.auditable_entity_id).first()

    prompt = f"""You are an Internal Audit AI expert. Generate a comprehensive, reusable test script based on the following audit engagement context and any findings discovered.

ENGAGEMENT:
Title: {engagement.title}
Type: {engagement.engagement_type or 'assurance'}
Scope: {engagement.scope or 'Not specified'}
Objectives: {engagement.objectives or 'Not specified'}
Entity: {entity.name if entity else 'N/A'} (Type: {entity.entity_type if entity else 'N/A'})
Status: {engagement.status}

{f"CONTROL AREA FOCUS: {data.control_area}" if data.control_area else ""}
{f"ADDITIONAL FOCUS: {data.focus_area}" if data.focus_area else ""}

FINDINGS FROM THIS ENGAGEMENT ({len(findings_data)} total):
{json.dumps(findings_data, indent=2) if findings_data else "No findings yet"}

Generate a structured test script that can be reused for similar audits. Return JSON:
{{
    "title": "<descriptive test script title>",
    "objective": "<what the test verifies and why it matters>",
    "procedure_steps": [
        {{
            "step_number": 1,
            "description": "<detailed step description>",
            "expected_result": "<what a satisfactory result looks like>"
        }}
    ],
    "control_area": "<primary control area: Access Control|Change Management|Financial Controls|IT Operations|Data Protection|Governance|Risk Management|Business Continuity|Compliance|Physical Security>",
    "test_type": "<control_test|substantive_test|walkthrough|compliance_test|analytical_procedure>",
    "sampling_methodology": "<statistical|judgmental|haphazard|block|monetary_unit>",
    "expected_evidence": "<types of evidence to collect, documents to request>",
    "tags": ["<relevant tag1>", "<relevant tag2>", "<relevant tag3>"]
}}

Ensure the procedure steps are detailed enough to be followed by a junior auditor. Include 5-10 steps covering preparation, execution, evaluation, and documentation phases."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2000,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {
                "title": f"Test Script - {engagement.title}",
                "objective": content,
                "procedure_steps": [],
                "control_area": data.control_area or "",
                "test_type": "control_test",
                "sampling_methodology": "",
                "expected_evidence": "",
                "tags": [],
            }
        return {
            "generated_test_script": result,
            "engagement_id": engagement.id,
            "engagement_title": engagement.title,
        }
    except Exception as e:
        logger.error(f"AI generate test script error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/suggest-engagement-skills")
def ai_suggest_engagement_skills(
    data: SuggestEngagementSkillsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    engagement_context = ""
    detected_audit_type = data.audit_type

    if data.engagement_id:
        engagement = db.query(AuditEngagement).filter(
            AuditEngagement.id == data.engagement_id,
            AuditEngagement.tenant_id.in_(user_tenants)
        ).first()
        if not engagement:
            raise HTTPException(status_code=404, detail="Engagement not found")

        entity = None
        if engagement.auditable_entity_id:
            entity = db.query(AuditableEntity).filter(AuditableEntity.id == engagement.auditable_entity_id).first()

        findings = db.query(AuditFinding).filter(
            AuditFinding.engagement_id == data.engagement_id
        ).limit(10).all()

        engagement_context = f"""
ENGAGEMENT DETAILS:
Title: {engagement.title}
Type: {engagement.engagement_type or 'assurance'}
Scope: {engagement.scope or 'Not specified'}
Objectives: {engagement.objectives or 'Not specified'}
Entity: {entity.name if entity else 'N/A'} (Type: {entity.entity_type if entity else 'N/A'})
Findings count: {len(findings)}
Finding areas: {', '.join(set(getattr(f, 'control_area', '') or f.title for f in findings)) if findings else 'None yet'}
"""

    audit_type = detected_audit_type or "internal_audit"
    taxonomy_data = AUDIT_SKILL_TAXONOMY.get(audit_type, AUDIT_SKILL_TAXONOMY.get("internal_audit"))
    all_taxonomy_keys = list(AUDIT_SKILL_TAXONOMY.keys())

    taxonomy_summary = json.dumps({
        k: {
            "label": v["label"],
            "L1_count": len(v["L1"]),
            "L2_count": len(v["L2"]),
            "L3_count": len(v["L3"]),
            "sample_L3": [s["skill"] for s in v["L3"][:2]],
        }
        for k, v in AUDIT_SKILL_TAXONOMY.items()
    }, indent=2)

    selected_taxonomy = json.dumps(taxonomy_data, indent=2)

    prompt = f"""You are an Internal Audit Skill Assessment AI. Based on the audit context provided, recommend the required skills organized by proficiency tier (L1=Foundation, L2=Domain-Specific, L3=Specialist/Expert).

AUDIT TYPE: {audit_type} ({taxonomy_data.get('label', audit_type)})
{engagement_context}
{f"SCOPE DESCRIPTION: {data.scope_description}" if data.scope_description else ""}

REFERENCE SKILL TAXONOMY FOR {taxonomy_data.get('label', audit_type).upper()}:
{selected_taxonomy}

AVAILABLE AUDIT CATEGORIES: {json.dumps(all_taxonomy_keys)}

Based on the specific engagement context, select and prioritize the most relevant skills from the taxonomy. You may also suggest skills from other audit categories if the engagement crosses domains.

Return JSON:
{{
    "audit_type": "{audit_type}",
    "audit_type_label": "{taxonomy_data.get('label', audit_type)}",
    "recommended_skills": [
        {{
            "skill_name": "<skill name>",
            "level": "L1|L2|L3",
            "proficiency_required": "beginner|intermediate|advanced|expert|master",
            "priority": "required|recommended|nice_to_have",
            "rationale": "<why this skill is needed for this specific engagement>",
            "suggested_certification": "<relevant certification or null>",
            "category": "<skill_category: technical|domain|methodology|soft_skill|regulatory>"
        }}
    ],
    "cross_domain_skills": [
        {{
            "skill_name": "<skill from another audit domain>",
            "source_domain": "<which audit type this comes from>",
            "level": "L1|L2|L3",
            "proficiency_required": "beginner|intermediate|advanced|expert|master",
            "rationale": "<why this cross-domain skill applies>"
        }}
    ],
    "team_composition_suggestion": "<brief recommendation on ideal team skill mix for this engagement>",
    "skill_gap_warning": "<any critical skills that are hard to find or require specialized training>"
}}

Recommend 8-15 primary skills and 2-5 cross-domain skills. Prioritize practical relevance to the engagement."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=2500,
        )
        content = response.choices[0].message.content
        try:
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            result = json.loads(content)
        except (json.JSONDecodeError, IndexError):
            result = {
                "audit_type": audit_type,
                "audit_type_label": taxonomy_data.get("label", audit_type),
                "recommended_skills": [],
                "cross_domain_skills": [],
                "team_composition_suggestion": content,
                "skill_gap_warning": "",
            }
        return {
            "skill_recommendations": result,
            "taxonomy_used": audit_type,
            "engagement_id": data.engagement_id,
            "available_audit_types": [
                {"key": k, "label": v["label"]} for k, v in AUDIT_SKILL_TAXONOMY.items()
            ],
        }
    except Exception as e:
        logger.error(f"AI suggest engagement skills error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")
