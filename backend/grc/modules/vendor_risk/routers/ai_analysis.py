"""AI-powered vendor risk analysis endpoints."""

from ....config import get_openai_api_key
import os
import json
from typing import Optional
from datetime import datetime
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, VendorIncident, VendorSLARecord,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ai", tags=["Vendor AI Analysis"])


# ── OpenAI client helper ─────────────────────────────────────────

def get_openai_client():
    from openai import OpenAI
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured.",
        )
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured.",
        )
    return OpenAI(api_key=api_key, base_url=base_url)


def _run_ai_json(prompt: str, system: str, fallback: dict) -> dict:
    """Run a strict-JSON completion and return the parsed dict. On ANY failure
    (no key, network, bad JSON) return `fallback` with source='fallback' so the
    TPRA AI features degrade gracefully and never 503 the lifecycle UI."""
    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model=os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or "gpt-4o",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1800,
        )
        content = (response.choices[0].message.content or "").strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            parsed.setdefault("source", "ai")
            return parsed
        return {**fallback, "source": "fallback"}
    except Exception:
        return {**fallback, "source": "fallback"}


# ── Schemas ───────────────────────────────────────────────────────

class ScoreAssessmentRequest(BaseModel):
    assessment_id: int
    response_id: Optional[int] = None


class VendorRiskSummaryRequest(BaseModel):
    vendor_id: int


# ── Endpoints ─────────────────────────────────────────────────────

@router.post("/score-assessment")
def ai_score_assessment(
    payload: ScoreAssessmentRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """GPT-4o analyzes questionnaire responses and generates risk score, findings, recommendations."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # Load assessment
    assessment = (
        db.query(VendorAssessment)
        .options(
            joinedload(VendorAssessment.vendor),
            joinedload(VendorAssessment.template),
        )
        .filter(
            VendorAssessment.id == payload.assessment_id,
            VendorAssessment.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    # Load questionnaire response
    resp_query = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.assessment_id == payload.assessment_id,
        VendorQuestionnaireResponse.status == "submitted",
    )
    if payload.response_id:
        resp_query = resp_query.filter(VendorQuestionnaireResponse.id == payload.response_id)
    qr = resp_query.first()
    if not qr:
        raise HTTPException(status_code=400, detail="No submitted questionnaire response found")

    # Build questions context
    questions = []
    if assessment.template:
        questions = assessment.template.questions or []

    questions_text = ""
    for i, q in enumerate(questions):
        q_id = str(q.get("id", i))
        q_text = q.get("text", f"Question {i+1}")
        answer = qr.responses.get(q_id, {}) if qr.responses else {}
        if isinstance(answer, dict):
            answer_text = answer.get("answer", "No response")
        else:
            answer_text = str(answer)
        questions_text += f"Q{i+1}: {q_text}\nA: {answer_text}\n\n"

    vendor_name = assessment.vendor.name if assessment.vendor else "Unknown Vendor"

    prompt = f"""You are a third-party risk management expert. Analyze the following vendor risk assessment questionnaire responses for vendor "{vendor_name}".

Assessment Type: {assessment.assessment_type}

Questionnaire Responses:
{questions_text}

Provide your analysis in the following JSON format:
{{
    "inherent_risk_score": <number 0-100>,
    "residual_risk_score": <number 0-100>,
    "risk_rating": "<critical|high|medium|low>",
    "findings": [
        {{"category": "<string>", "finding": "<string>", "severity": "<critical|high|medium|low>", "detail": "<string>"}}
    ],
    "recommendations": [
        {{"priority": "<high|medium|low>", "recommendation": "<string>", "rationale": "<string>"}}
    ],
    "summary": "<brief overall assessment>"
}}

Be specific and actionable in your findings and recommendations. Base scores on industry-standard vendor risk scoring practices."""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a GRC (Governance, Risk, and Compliance) expert specializing in third-party vendor risk management. Always respond with valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )

        content = response.choices[0].message.content.strip()
        # Strip markdown code fences if present
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        result = json.loads(content)

        # Update assessment with AI scores
        assessment.inherent_score = result.get("inherent_risk_score")
        assessment.residual_score = result.get("residual_risk_score")
        assessment.risk_rating = result.get("risk_rating")
        assessment.findings = result.get("findings", [])
        assessment.recommendations = result.get("recommendations", [])
        assessment.status = "reviewed"
        assessment.updated_at = datetime.utcnow()
        db.commit()

        return {
            "message": "AI analysis completed successfully",
            "assessment_id": assessment.id,
            "result": result,
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid response format")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI analysis failed: {str(e)}",
        )


@router.post("/vendor-risk-summary")
def ai_vendor_risk_summary(
    payload: VendorRiskSummaryRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """GPT-4o generates a narrative summary of a vendor's overall risk posture."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # Load vendor with relationships
    vendor = (
        db.query(Vendor)
        .options(
            joinedload(Vendor.assessments),
            joinedload(Vendor.incidents),
            joinedload(Vendor.sla_records),
        )
        .filter(
            Vendor.id == payload.vendor_id,
            Vendor.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Build context
    assessments_text = ""
    for a in (vendor.assessments or [])[:5]:
        assessments_text += (
            f"- Type: {a.assessment_type}, Status: {a.status}, "
            f"Inherent Score: {a.inherent_score}, Risk Rating: {a.risk_rating}, "
            f"Date: {a.created_at.isoformat() if a.created_at else 'N/A'}\n"
        )
    if not assessments_text:
        assessments_text = "No assessments on record.\n"

    incidents_text = ""
    for inc in (vendor.incidents or [])[:5]:
        incidents_text += (
            f"- {inc.title} (Severity: {inc.severity}, Status: {inc.status}, "
            f"Date: {inc.occurred_at.isoformat() if inc.occurred_at else 'N/A'})\n"
        )
    if not incidents_text:
        incidents_text = "No incidents on record.\n"

    sla_text = ""
    for s in (vendor.sla_records or [])[:10]:
        sla_text += (
            f"- {s.sla_metric}: Target={s.target_value}, Actual={s.actual_value}, "
            f"Compliant={s.is_compliant}, Period={s.measurement_period}\n"
        )
    if not sla_text:
        sla_text = "No SLA records on file.\n"

    prompt = f"""You are a third-party risk management expert. Generate a comprehensive risk summary for the following vendor.

Vendor: {vendor.name}
Type: {vendor.vendor_type or 'N/A'}
Tier: {vendor.tier}
Status: {vendor.status}
Data Access Level: {vendor.data_access_level}
Data Types Accessed: {', '.join(vendor.data_types_accessed or []) or 'None'}
Services Provided: {', '.join(vendor.services_provided or []) or 'None'}
Current Inherent Risk Score: {vendor.inherent_risk_score or 'Not assessed'}
Current Residual Risk Score: {vendor.residual_risk_score or 'Not assessed'}
Current Risk Rating: {vendor.risk_rating or 'Not rated'}
Contract End Date: {vendor.contract_end_date.isoformat() if vendor.contract_end_date else 'N/A'}

Recent Assessments:
{assessments_text}

Recent Incidents:
{incidents_text}

SLA Performance:
{sla_text}

Provide a JSON response with:
{{
    "executive_summary": "<2-3 sentence summary for leadership>",
    "risk_posture": "<detailed paragraph on current risk posture>",
    "key_risks": ["<risk 1>", "<risk 2>", ...],
    "strengths": ["<strength 1>", "<strength 2>", ...],
    "recommended_actions": [
        {{"action": "<string>", "priority": "<high|medium|low>", "rationale": "<string>"}}
    ],
    "overall_rating": "<critical|high|medium|low>",
    "confidence": "<high|medium|low>"
}}"""

    try:
        client = get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a GRC expert specializing in vendor risk management. Always respond with valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=2000,
        )

        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        result = json.loads(content)

        return {
            "message": "Vendor risk summary generated successfully",
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "result": result,
        }

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI returned invalid response format")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"AI analysis failed: {str(e)}",
        )


# ─────────────────────────────────────────────────────────────────────────────
# TPRA lifecycle AI — graceful (never 503; falls back deterministically).
# ─────────────────────────────────────────────────────────────────────────────

class RecommendTierRequest(BaseModel):
    vendor_id: int


class GapAnalysisRequest(BaseModel):
    assessment_id: int


class RemediationPlanRequest(BaseModel):
    vendor_id: int
    assessment_id: Optional[int] = None


_TIER_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
_ACCESS_TIER = {"confidential": "critical", "restricted": "high", "internal": "medium", "public": "low", "none": "low"}


@router.post("/recommend-tier")
def ai_recommend_tier(
    payload: RecommendTierRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Stage 2 — recommend an inherent risk tier from the vendor profile."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    vendor = db.query(Vendor).filter(
        Vendor.id == payload.vendor_id, Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    fallback_tier = _ACCESS_TIER.get((vendor.data_access_level or "none").lower(), "medium")
    fallback = {
        "recommended_tier": fallback_tier,
        "rationale": (
            f"Based on data access level '{vendor.data_access_level or 'none'}' and the service profile, "
            f"a '{fallback_tier}' inherent tier is suggested. Review the blast radius if this vendor fails or is breached."
        ),
        "key_factors": [
            f"Data access: {vendor.data_access_level or 'none'}",
            f"Vendor type: {vendor.vendor_type or 'n/a'}",
        ],
    }
    prompt = (
        "You are a third-party risk expert performing inherent risk tiering (before any controls). "
        "Recommend a tier of critical|high|medium|low for this vendor based on data sensitivity, integration depth, "
        "operational criticality, and blast radius. Respond as STRICT JSON: "
        '{"recommended_tier": "critical|high|medium|low", "rationale": "<2-3 sentences>", "key_factors": ["..."]}.\n\n'
        f"Vendor: {vendor.name}\nType: {vendor.vendor_type or 'n/a'}\nIndustry: {vendor.industry or 'n/a'}\n"
        f"Data access level: {vendor.data_access_level or 'none'}\n"
        f"Data types: {', '.join(vendor.data_types_accessed or []) or 'n/a'}\n"
        f"Services: {', '.join(vendor.services_provided or []) or 'n/a'}\n"
        f"Description: {(vendor.description or '')[:600]}"
    )
    result = _run_ai_json(prompt, "You are a GRC third-party risk expert. Respond with valid JSON only.", fallback)
    rt = str(result.get("recommended_tier") or fallback_tier).lower()
    if rt not in _TIER_RANK:
        rt = fallback_tier
    result["recommended_tier"] = rt
    result["current_tier"] = vendor.tier
    return result


@router.post("/gap-analysis")
def ai_gap_analysis(
    payload: GapAnalysisRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Stage 4 — derive a real residual-vs-inherent delta and per-gap analysis."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    assessment = (
        db.query(VendorAssessment).options(joinedload(VendorAssessment.vendor))
        .filter(VendorAssessment.id == payload.assessment_id, VendorAssessment.tenant_id.in_(tenant_ids))
        .first()
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")

    findings = assessment.findings or []
    inherent = assessment.inherent_score if assessment.inherent_score is not None else 50.0
    sev_weight = {"critical": 12, "high": 8, "medium": 4, "low": 2}
    penalty = sum(sev_weight.get(str(f.get("severity") or "medium").lower(), 4) for f in findings)
    fb_residual = max(0.0, min(100.0, round(inherent - max(0, 25 - penalty), 1)))
    fallback = {
        "inherent_score": inherent,
        "residual_score": fb_residual,
        "gap_analysis": [
            {
                "gap": str(f.get("finding") or f.get("category") or "Control gap"),
                "severity": str(f.get("severity") or "medium"),
                "control_ref": str(f.get("category") or ""),
                "residual_after_controls": str(f.get("severity") or "medium"),
            }
            for f in findings
        ],
        "summary": f"{len(findings)} gap(s) assessed; residual risk estimated at {fb_residual}.",
    }
    prompt = (
        "You are a third-party risk analyst doing gap analysis. Given the vendor's findings and inherent score, "
        "estimate the RESIDUAL risk that remains after the vendor's existing controls, and explain each gap. "
        "Respond as STRICT JSON: {\"inherent_score\": <0-100>, \"residual_score\": <0-100>, "
        '"gap_analysis": [{"gap": "...", "severity": "critical|high|medium|low", "control_ref": "...", '
        '"residual_after_controls": "..."}], "summary": "..."}.\n\n'
        f"Vendor: {assessment.vendor.name if assessment.vendor else 'n/a'}\n"
        f"Assessment type: {assessment.assessment_type}\nInherent score: {inherent}\n"
        f"Findings: {json.dumps(findings)[:3000]}"
    )
    result = _run_ai_json(prompt, "You are a GRC third-party risk analyst. Respond with valid JSON only.", fallback)
    try:
        if isinstance(result.get("gap_analysis"), list):
            assessment.gap_analysis = result["gap_analysis"]
        rs = result.get("residual_score")
        if isinstance(rs, (int, float)):
            assessment.residual_score = float(rs)
        assessment.updated_at = datetime.utcnow()
        db.commit()
    except Exception:
        db.rollback()
    return result


@router.post("/remediation-plan")
def ai_remediation_plan(
    payload: RemediationPlanRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Stage 5 — draft remediation actions for a vendor's open findings.
    Returns suggested actions; the UI adds the chosen ones to the tracker."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    vendor = db.query(Vendor).filter(
        Vendor.id == payload.vendor_id, Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    findings = []
    if payload.assessment_id:
        a = db.query(VendorAssessment).filter(
            VendorAssessment.id == payload.assessment_id, VendorAssessment.tenant_id.in_(tenant_ids),
        ).first()
        if a:
            findings = a.findings or []
    if not findings:
        a = (
            db.query(VendorAssessment)
            .filter(VendorAssessment.vendor_id == vendor.id, VendorAssessment.tenant_id.in_(tenant_ids))
            .order_by(VendorAssessment.created_at.desc())
            .first()
        )
        if a:
            findings = a.findings or []

    fallback = {
        "actions": [
            {
                "title": str(f.get("finding") or f.get("category") or "Address control gap"),
                "action": "Define a remediation plan with the vendor and an agreed timeline.",
                "treatment_type": "remediate",
                "severity": str(f.get("severity") or "medium"),
                "finding_ref": str(f.get("category") or ""),
            }
            for f in findings
        ] or [{
            "title": "Establish baseline security controls",
            "action": "Request and review the vendor's SOC 2 / ISO 27001 and close any control gaps.",
            "treatment_type": "remediate", "severity": "medium", "finding_ref": "",
        }],
    }
    prompt = (
        "You are a third-party risk manager. For each finding, propose a remediation action with a treatment type "
        "of remediate|mitigate|transfer|accept. Respond as STRICT JSON: "
        '{"actions": [{"title": "...", "action": "...", "treatment_type": "remediate|mitigate|transfer|accept", '
        '"severity": "critical|high|medium|low", "finding_ref": "..."}]}.\n\n'
        f"Vendor: {vendor.name}\nFindings: {json.dumps(findings)[:3000]}"
    )
    result = _run_ai_json(prompt, "You are a GRC third-party risk manager. Respond with valid JSON only.", fallback)
    if not isinstance(result.get("actions"), list):
        result["actions"] = fallback["actions"]
    return result
