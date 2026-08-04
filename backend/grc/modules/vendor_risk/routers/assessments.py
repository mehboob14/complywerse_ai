"""Vendor assessment CRUD + risk scoring endpoints."""

import logging
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireTemplate,
    VendorQuestionnaireResponse, VendorQuestionnaireEvidence, GRCUser, TenantUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Vendor Assessments"])


# ── Pydantic schemas ──────────────────────────────────────────────

class AssessmentCreate(BaseModel):
    tenant_id: Optional[int] = None
    vendor_id: int
    assessment_type: Optional[str] = "initial"
    template_id: Optional[int] = None
    assessed_by: Optional[int] = None
    status: Optional[str] = "draft"
    due_date: Optional[datetime] = None
    findings: Optional[list] = []
    recommendations: Optional[list] = []


class AssessmentUpdate(BaseModel):
    assessment_type: Optional[str] = None
    template_id: Optional[int] = None
    status: Optional[str] = None
    inherent_score: Optional[float] = None
    residual_score: Optional[float] = None
    risk_rating: Optional[str] = None
    findings: Optional[list] = None
    recommendations: Optional[list] = None
    due_date: Optional[datetime] = None


class ScoreRequest(BaseModel):
    """Manual scoring override or trigger for weighted-average calculation."""
    response_id: Optional[int] = None


class ApproveRequest(BaseModel):
    # Deprecated & IGNORED — risk_rating is recomputed server-side from the score
    # (TPRM-005). Kept only so older clients that still send it don't 422.
    risk_rating: Optional[str] = None
    recommendations: Optional[list] = None


# ── Serializers ───────────────────────────────────────────────────

def serialize_assessment(a: VendorAssessment) -> dict:
    data = {
        "id": a.id,
        "tenant_id": a.tenant_id,
        "vendor_id": a.vendor_id,
        "assessment_type": a.assessment_type,
        "template_id": a.template_id,
        "status": a.status,
        "inherent_score": a.inherent_score,
        "residual_score": a.residual_score,
        "risk_rating": a.risk_rating,
        "findings": a.findings or [],
        "recommendations": a.recommendations or [],
        "gap_analysis": getattr(a, "gap_analysis", None) or [],
        "linked_risk_id": getattr(a, "linked_risk_id", None),
        "assessed_by": a.assessed_by,
        "reviewed_by": a.reviewed_by,
        "due_date": a.due_date.isoformat() if a.due_date else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }
    if a.vendor:
        data["vendor_name"] = a.vendor.name
    if a.assessor:
        data["assessor"] = {"id": a.assessor.id, "full_name": a.assessor.display_name or a.assessor.username}
    if a.reviewer:
        data["reviewer"] = {"id": a.reviewer.id, "full_name": a.reviewer.display_name or a.reviewer.username}
    if a.template:
        data["template_name"] = a.template.name
    return data


# ── Helpers ───────────────────────────────────────────────────────

def get_assessment_or_404(
    assessment_id: int, tenant_ids: List[int], db: Session,
) -> VendorAssessment:
    assessment = (
        db.query(VendorAssessment)
        .options(
            joinedload(VendorAssessment.vendor),
            joinedload(VendorAssessment.assessor),
            joinedload(VendorAssessment.reviewer),
            joinedload(VendorAssessment.template),
        )
        .filter(
            VendorAssessment.id == assessment_id,
            VendorAssessment.tenant_id.in_(tenant_ids),
        )
        .first()
    )
    if not assessment:
        raise HTTPException(status_code=404, detail="Assessment not found")
    return assessment


def _calculate_risk_rating(score: float) -> str:
    if score >= 80:
        return "critical"
    elif score >= 60:
        return "high"
    elif score >= 40:
        return "medium"
    else:
        return "low"


# ── Endpoints ─────────────────────────────────────────────────────

@router.get("/assessments")
def list_assessments(
    vendor_id: Optional[int] = Query(None),
    assessment_status: Optional[str] = Query(None, alias="status"),
    assessment_type: Optional[str] = Query(None, alias="type"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    query = (
        db.query(VendorAssessment)
        .options(
            joinedload(VendorAssessment.vendor),
            joinedload(VendorAssessment.assessor),
            joinedload(VendorAssessment.reviewer),
            joinedload(VendorAssessment.template),
        )
        .filter(VendorAssessment.tenant_id.in_(tenant_ids))
    )

    if vendor_id:
        query = query.filter(VendorAssessment.vendor_id == vendor_id)
    if assessment_status:
        query = query.filter(VendorAssessment.status == assessment_status)
    if assessment_type:
        query = query.filter(VendorAssessment.assessment_type == assessment_type)

    total = query.count()
    assessments = query.order_by(VendorAssessment.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "items": [serialize_assessment(a) for a in assessments],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/assessments", status_code=status.HTTP_201_CREATED)
def create_assessment(
    payload: AssessmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # Verify vendor belongs to user's tenant
    vendor = db.query(Vendor).filter(
        Vendor.id == payload.vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    tenant_id = payload.tenant_id if payload.tenant_id and payload.tenant_id in tenant_ids else vendor.tenant_id
    assessed_by = current_user.id
    if payload.assessed_by:
        # Per-tenant DB: every active grc_users row belongs to this tenant.
        assessor = (
            db.query(GRCUser)
            .filter(
                GRCUser.id == payload.assessed_by,
                GRCUser.is_active.is_(True),
            )
            .first()
        )
        if not assessor:
            raise HTTPException(status_code=400, detail="Selected assessor is not part of your tenant")
        assessed_by = payload.assessed_by

    assessment = VendorAssessment(
        tenant_id=tenant_id,
        vendor_id=payload.vendor_id,
        assessment_type=payload.assessment_type,
        template_id=payload.template_id,
        status=payload.status,
        due_date=payload.due_date,
        findings=payload.findings,
        recommendations=payload.recommendations,
        assessed_by=assessed_by,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)

    # Reload with relationships
    assessment = get_assessment_or_404(assessment.id, tenant_ids, db)
    return serialize_assessment(assessment)


@router.get("/assessments/{assessment_id}")
def get_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)
    result = serialize_assessment(assessment)

    # Attach questionnaire responses if any
    responses = (
        db.query(VendorQuestionnaireResponse)
        .filter(VendorQuestionnaireResponse.assessment_id == assessment_id)
        .all()
    )
    qr_data = []
    for r in responses:
        # Load template questions
        questions = []
        if r.template_id:
            tmpl = db.query(VendorQuestionnaireTemplate).filter(
                VendorQuestionnaireTemplate.id == r.template_id,
            ).first()
            if tmpl:
                questions = tmpl.questions or []

        # Load evidence files
        ev_list = db.query(VendorQuestionnaireEvidence).filter(
            VendorQuestionnaireEvidence.response_id == r.id,
        ).all()
        evidence_by_q: dict = {}
        for ev in ev_list:
            if ev.question_id not in evidence_by_q:
                evidence_by_q[ev.question_id] = []
            evidence_by_q[ev.question_id].append({
                "id": ev.id,
                "file_name": ev.file_name,
                "file_type": ev.file_type,
                "file_size": ev.file_size,
                # Surface the on-disk path so the in-browser evidence
                # viewer can fetch + render the file. Stored privately
                # but served via the auth-gated /uploads mount.
                "file_path": ev.file_path,
            })

        qr_data.append({
            "id": r.id,
            "respondent_name": r.respondent_name,
            "respondent_email": r.respondent_email,
            "responses": r.responses or {},
            "status": r.status,
            "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
            "questions": questions,
            "evidence": evidence_by_q,
        })
    result["questionnaire_responses"] = qr_data

    return result


@router.put("/assessments/{assessment_id}")
def update_assessment(
    assessment_id: int,
    payload: AssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(assessment, key, value)

    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)
    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)
    return serialize_assessment(assessment)


@router.delete("/assessments/{assessment_id}")
def delete_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    # Preserve questionnaire history but detach it from the assessment being deleted.
    unlinked_count = (
        db.query(VendorQuestionnaireResponse)
        .filter(VendorQuestionnaireResponse.assessment_id == assessment.id)
        .update({VendorQuestionnaireResponse.assessment_id: None}, synchronize_session=False)
    )

    assessment_label = f"{assessment.assessment_type or 'assessment'} #{assessment.id}"
    db.delete(assessment)
    db.commit()

    return {
        "message": f"Deleted {assessment_label} successfully",
        "unlinked_questionnaire_responses": int(unlinked_count or 0),
    }


@router.post("/assessments/{assessment_id}/score")
def score_assessment(
    assessment_id: int,
    payload: ScoreRequest = ScoreRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Calculate risk score from questionnaire responses (weighted average)."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    # Find the questionnaire response to score
    resp_query = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.assessment_id == assessment_id,
        VendorQuestionnaireResponse.status == "submitted",
    )
    if payload.response_id:
        resp_query = resp_query.filter(VendorQuestionnaireResponse.id == payload.response_id)

    qr = resp_query.first()
    if not qr:
        raise HTTPException(status_code=400, detail="No submitted questionnaire response found for this assessment")

    # Load template questions for weights
    template = None
    if assessment.template_id:
        template = db.query(VendorQuestionnaireTemplate).filter(
            VendorQuestionnaireTemplate.id == assessment.template_id,
        ).first()

    questions = (template.questions or []) if template else []
    responses = qr.responses or {}

    # TPRM-CRITICAL FIX — score through the GOVERNED engine instead of a weighted
    # average of raw answer strings. The old path did float("yes") → 0, so every
    # string answer counted as zero (an all-"no" critical questionnaire scored
    # "low"), and it treated questionnaire answers as INHERENT risk. Correct model:
    # inherent risk comes from tiering; questionnaire answers drive control POSTURE,
    # which REDUCES inherent to residual (a failed critical control floors "high").
    from ..tpra.engine_scoring import (
        score_assessment as engine_score,
        build_responses_from_answers,
    )
    from ..tpra.bootstrap import get_tiering_config

    inherent = assessment.inherent_score
    if not inherent:
        # Neutral provisional inherent when tiering hasn't run for this assessment,
        # so residual still responds to the answers rather than collapsing to a
        # false "low". Run the tiering stage for a real inherent value.
        inherent = 50.0
    cfg = get_tiering_config(db, assessment.tenant_id)
    resp_list = build_responses_from_answers(questions, responses)
    result = engine_score(resp_list, inherent_score=inherent, config=cfg)

    assessment.inherent_score = result["overall_inherent"]
    assessment.residual_score = result["overall_residual"]
    assessment.residual_rating = result["residual_rating"]
    assessment.risk_rating = result["residual_rating"]   # keep the legacy field in sync
    assessment.rating_grade = result["rating_grade"]
    assessment.domain_scores = result["domain_scores"]
    assessment.status = "reviewed"
    assessment.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(assessment)
    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    return {
        "message": "Assessment scored successfully",
        "inherent_score": assessment.inherent_score,
        "residual_score": assessment.residual_score,
        "risk_rating": assessment.risk_rating,
        "assessment": serialize_assessment(assessment),
    }


@router.post("/assessments/{assessment_id}/approve")
def approve_assessment(
    assessment_id: int,
    payload: ApproveRequest = ApproveRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Approve an assessment and update the vendor's risk scores."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    if assessment.status not in ("reviewed", "submitted", "in_progress"):
        raise HTTPException(
            status_code=400,
            detail=f"Assessment in status '{assessment.status}' cannot be approved"
        )

    assessment.status = "approved"
    assessment.reviewed_by = current_user.id
    assessment.completed_at = datetime.utcnow()
    assessment.updated_at = datetime.utcnow()

    # TPRM-005: NEVER trust a client-supplied risk_rating — always recompute it
    # server-side from the (server-computed) score. payload.risk_rating is ignored.
    _basis = assessment.residual_score if assessment.residual_score is not None else assessment.inherent_score
    if _basis is not None:
        assessment.risk_rating = _calculate_risk_rating(_basis)
    if payload.recommendations:
        assessment.recommendations = payload.recommendations

    # Update vendor risk scores from assessment. Residual is clamped ≤ inherent
    # (TPRM-004): controls can only reduce risk.
    vendor = db.query(Vendor).filter(Vendor.id == assessment.vendor_id).first()
    if vendor and assessment.inherent_score is not None:
        vendor.inherent_risk_score = assessment.inherent_score
        _res = assessment.residual_score
        if _res is not None:
            _res = min(_res, assessment.inherent_score)
            assessment.residual_score = _res
        vendor.residual_risk_score = _res
        vendor.risk_rating = assessment.risk_rating
        vendor.updated_at = datetime.utcnow()

    # ── Linkage: surface the vendor's residual risk in the enterprise Risk
    # Register so it rolls up to the ERM dashboard. Fully guarded — a linkage
    # failure must never block the approval itself.
    try:
        if vendor is not None:
            from ....models import Risk
            desc = (
                f"Residual third-party risk from the {assessment.assessment_type} assessment of "
                f"vendor '{vendor.name}'. Rating: {assessment.risk_rating or 'n/a'}. "
                f"Open findings: {len(assessment.findings or [])}."
            )
            existing = None
            if getattr(assessment, "linked_risk_id", None):
                existing = db.query(Risk).filter(Risk.id == assessment.linked_risk_id).first()
            if existing:
                existing.description = desc
                existing.inherent_score = assessment.inherent_score
                existing.residual_score = assessment.residual_score
                existing.updated_at = datetime.utcnow()
            else:
                risk = Risk(
                    tenant_id=assessment.tenant_id,
                    business_unit_id=vendor.business_unit_id,
                    title=f"Third-party risk: {vendor.name}",
                    description=desc,
                    category="third_party",
                    risk_category="third_party",
                    register_type="Third-Party Risk",
                    owner_id=vendor.owner_id,
                    inherent_score=assessment.inherent_score,
                    residual_score=assessment.residual_score,
                    status="open",
                    source_type="assessment",
                    source_reference=f"vendor:{vendor.id}/vendor_assessment:{assessment.id}",
                )
                db.add(risk)
                db.flush()
                assessment.linked_risk_id = risk.id
    except Exception:  # noqa: BLE001 — linkage is best-effort
        logger.warning("vendor assessment → Risk Register linkage skipped", exc_info=True)

    db.commit()
    db.refresh(assessment)
    assessment = get_assessment_or_404(assessment_id, tenant_ids, db)

    return {
        "message": "Assessment approved and vendor risk scores updated",
        "assessment": serialize_assessment(assessment),
    }
