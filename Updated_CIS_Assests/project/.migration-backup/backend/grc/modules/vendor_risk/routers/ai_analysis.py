"""AI-powered vendor risk analysis endpoints."""

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
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
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
