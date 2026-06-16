"""Questionnaire template management + external vendor questionnaire access."""

import os
import uuid
from typing import List, Optional
from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireTemplate,
    VendorQuestionnaireResponse, VendorQuestionnaireEvidence, GRCUser, get_db,
)
from ....rich_audit import write_rich_audit_log
from ....routers.auth_router import require_auth, get_user_tenants

EVIDENCE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "uploads", "questionnaire-evidence")
os.makedirs(EVIDENCE_UPLOAD_DIR, exist_ok=True)

router = APIRouter(tags=["Vendor Questionnaires"])


# ── Pydantic schemas ──────────────────────────────────────────────

class TemplateCreate(BaseModel):
    tenant_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = "security"
    description: Optional[str] = None
    questions: Optional[list] = []
    is_default: Optional[bool] = False


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
    questions: Optional[list] = None
    is_default: Optional[bool] = None


class SendQuestionnaireRequest(BaseModel):
    vendor_id: int
    assessment_id: Optional[int] = None
    template_id: Optional[int] = None
    respondent_name: Optional[str] = None
    respondent_email: Optional[str] = None
    expires_in_days: Optional[int] = 30


class ExternalSubmitRequest(BaseModel):
    respondent_name: Optional[str] = None
    respondent_email: Optional[str] = None
    responses: dict = {}
    submit: bool = True  # False = save draft, True = final submit


# ── Serializers ───────────────────────────────────────────────────

def serialize_template(t: VendorQuestionnaireTemplate) -> dict:
    return {
        "id": t.id,
        "tenant_id": t.tenant_id,
        "name": t.name,
        "category": t.category,
        "description": t.description,
        "questions": t.questions or [],
        "question_count": len(t.questions or []),
        "is_default": t.is_default,
        "created_by": t.created_by,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def serialize_questionnaire_response(qr: VendorQuestionnaireResponse) -> dict:
    return {
        "id": qr.id,
        "tenant_id": qr.tenant_id,
        "vendor_id": qr.vendor_id,
        "assessment_id": qr.assessment_id,
        "template_id": qr.template_id,
        "respondent_name": qr.respondent_name,
        "respondent_email": qr.respondent_email,
        "responses": qr.responses or {},
        "status": qr.status,
        "token": qr.token,
        "expires_at": qr.expires_at.isoformat() if qr.expires_at else None,
        "submitted_at": qr.submitted_at.isoformat() if qr.submitted_at else None,
        "created_at": qr.created_at.isoformat() if qr.created_at else None,
    }


# ── Template endpoints (authenticated) ───────────────────────────

@router.get("/questionnaire-templates")
def list_templates(
    category: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}

    query = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids)
    )
    if category:
        query = query.filter(VendorQuestionnaireTemplate.category == category)
    if search:
        query = query.filter(VendorQuestionnaireTemplate.name.ilike(f"%{search}%"))

    total = query.count()
    templates = query.order_by(VendorQuestionnaireTemplate.created_at.desc()).offset(skip).limit(limit).all()

    return {
        "items": [serialize_template(t) for t in templates],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/questionnaire-templates", status_code=status.HTTP_201_CREATED)
def create_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    tenant_id = payload.tenant_id if payload.tenant_id and payload.tenant_id in tenant_ids else tenant_ids[0]

    template = VendorQuestionnaireTemplate(
        tenant_id=tenant_id,
        name=payload.name,
        category=payload.category,
        description=payload.description,
        questions=payload.questions,
        is_default=payload.is_default,
        created_by=current_user.id,
    )
    db.add(template)
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="questionnaire_template",
        resource_id=template.id,
        resource_name=template.name,
        summary=f"Created questionnaire template '{template.name}' (category: {template.category})",
        snapshot={"name": template.name, "category": template.category, "question_count": len(payload.questions or [])},
    )
    db.commit()
    db.refresh(template)
    return serialize_template(template)


@router.put("/questionnaire-templates/{template_id}")
def update_template(
    template_id: int,
    payload: TemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    template = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.id == template_id,
        VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    old_name = template.name
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    template.updated_at = datetime.utcnow()
    write_rich_audit_log(
        db=db,
        tenant_id=template.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="questionnaire_template",
        resource_id=template_id,
        resource_name=template.name,
        summary=f"Updated questionnaire template '{old_name}'",
        snapshot={"name": template.name, "category": template.category},
    )
    db.commit()
    db.refresh(template)
    return serialize_template(template)


@router.delete("/questionnaire-templates/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    template = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.id == template_id,
        VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    write_rich_audit_log(
        db=db,
        tenant_id=template.tenant_id,
        user_id=current_user.id,
        action="delete",
        resource_type="questionnaire_template",
        resource_id=template_id,
        resource_name=template.name,
        summary=f"Deleted questionnaire template '{template.name}'",
    )
    db.delete(template)
    db.commit()
    return {"message": f"Template '{template.name}' deleted successfully"}


# ── Questionnaire response management (authenticated) ────────────

@router.get("/questionnaire-responses")
def list_questionnaire_responses(
    vendor_id: Optional[int] = Query(None),
    assessment_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List questionnaire responses for the current tenant."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return []
    query = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.tenant_id.in_(tenant_ids),
    )
    if vendor_id:
        query = query.filter(VendorQuestionnaireResponse.vendor_id == vendor_id)
    if assessment_id:
        query = query.filter(VendorQuestionnaireResponse.assessment_id == assessment_id)
    return [serialize_questionnaire_response(qr) for qr in query.all()]


class UpdateQuestionnaireResponseRequest(BaseModel):
    assessment_id: Optional[int] = None


@router.patch("/questionnaire-responses/{response_id}")
def update_questionnaire_response(
    response_id: int,
    payload: UpdateQuestionnaireResponseRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Update a questionnaire response (e.g., link to assessment)."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.id == response_id,
        VendorQuestionnaireResponse.tenant_id.in_(tenant_ids),
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail="Questionnaire response not found")
    if payload.assessment_id is not None:
        qr.assessment_id = payload.assessment_id
    write_rich_audit_log(
        db=db,
        tenant_id=qr.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="vendor_questionnaire",
        resource_id=response_id,
        resource_name=f"Questionnaire response #{response_id}",
        summary=f"Updated questionnaire response #{response_id} (linked to assessment #{payload.assessment_id})",
        snapshot={"assessment_id": payload.assessment_id},
    )
    db.commit()
    db.refresh(qr)
    return serialize_questionnaire_response(qr)


# ── Send questionnaire (authenticated) ───────────────────────────

@router.post("/questionnaires/send", status_code=status.HTTP_201_CREATED)
def send_questionnaire(
    payload: SendQuestionnaireRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Send a questionnaire to a vendor. Creates a VendorQuestionnaireResponse with a unique token."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    # Verify vendor exists
    vendor = db.query(Vendor).filter(
        Vendor.id == payload.vendor_id,
        Vendor.tenant_id.in_(tenant_ids),
    ).first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")

    # Verify assessment if provided
    if payload.assessment_id:
        assessment = db.query(VendorAssessment).filter(
            VendorAssessment.id == payload.assessment_id,
            VendorAssessment.tenant_id.in_(tenant_ids),
        ).first()
        if not assessment:
            raise HTTPException(status_code=404, detail="Assessment not found")

    # Verify template if provided
    if payload.template_id:
        template = db.query(VendorQuestionnaireTemplate).filter(
            VendorQuestionnaireTemplate.id == payload.template_id,
            VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
        ).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

    token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=payload.expires_in_days)

    qr = VendorQuestionnaireResponse(
        tenant_id=vendor.tenant_id,
        vendor_id=payload.vendor_id,
        assessment_id=payload.assessment_id,
        template_id=payload.template_id,
        respondent_name=payload.respondent_name or vendor.primary_contact_name,
        respondent_email=payload.respondent_email or vendor.primary_contact_email,
        token=token,
        expires_at=expires_at,
        status="pending",
    )
    db.add(qr)
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=vendor.tenant_id,
        user_id=current_user.id,
        action="send_questionnaire",
        resource_type="vendor_questionnaire",
        resource_id=qr.id,
        resource_name=f"Questionnaire for {vendor.name}",
        summary=f"Sent questionnaire to vendor '{vendor.name}' (respondent: {qr.respondent_email or 'unspecified'})",
        snapshot={"vendor_id": payload.vendor_id, "template_id": payload.template_id, "expires_at": expires_at.isoformat()},
    )
    db.commit()
    db.refresh(qr)

    return {
        "message": "Questionnaire sent successfully",
        "token": token,
        "expires_at": expires_at.isoformat(),
        "questionnaire_response": serialize_questionnaire_response(qr),
    }


# ── External vendor access (NO AUTH) ─────────────────────────────

@router.get("/questionnaires/external/{token}")
def external_load_questionnaire(
    token: str,
    db: Session = Depends(get_db),
):
    """External vendor loads the questionnaire by token. No authentication required."""
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.token == token,
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail="Questionnaire not found or invalid token")

    # Check expiry
    if qr.expires_at and qr.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="This questionnaire link has expired")

    # Check if already submitted
    if qr.status == "submitted":
        raise HTTPException(status_code=400, detail="This questionnaire has already been submitted")

    # Load the template questions
    questions = []
    if qr.template_id:
        template = db.query(VendorQuestionnaireTemplate).filter(
            VendorQuestionnaireTemplate.id == qr.template_id,
        ).first()
        if template:
            questions = template.questions or []

    # Load vendor name
    vendor = db.query(Vendor).filter(Vendor.id == qr.vendor_id).first()

    # Load evidence files
    evidence_list = db.query(VendorQuestionnaireEvidence).filter(
        VendorQuestionnaireEvidence.response_id == qr.id,
    ).all()
    evidence_by_question: dict = {}
    for ev in evidence_list:
        if ev.question_id not in evidence_by_question:
            evidence_by_question[ev.question_id] = []
        evidence_by_question[ev.question_id].append({
            "id": ev.id,
            "file_name": ev.file_name,
            "file_type": ev.file_type,
            "file_size": ev.file_size,
            "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
        })

    return {
        "questionnaire_id": qr.id,
        "vendor_name": vendor.name if vendor else None,
        "respondent_name": qr.respondent_name,
        "respondent_email": qr.respondent_email,
        "status": qr.status,
        "expires_at": qr.expires_at.isoformat() if qr.expires_at else None,
        "questions": questions,
        "existing_responses": qr.responses or {},
        "evidence": evidence_by_question,
    }


@router.post("/questionnaires/external/{token}")
def external_submit_questionnaire(
    token: str,
    payload: ExternalSubmitRequest,
    db: Session = Depends(get_db),
):
    """External vendor submits questionnaire responses. No authentication required."""
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.token == token,
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail="Questionnaire not found or invalid token")

    # Check expiry
    if qr.expires_at and qr.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="This questionnaire link has expired")

    # Check if already submitted
    if qr.status == "submitted":
        raise HTTPException(status_code=400, detail="This questionnaire has already been submitted")

    # Update response
    qr.responses = payload.responses

    if payload.respondent_name:
        qr.respondent_name = payload.respondent_name
    if payload.respondent_email:
        qr.respondent_email = payload.respondent_email

    if payload.submit:
        # Final submission
        qr.status = "submitted"
        qr.submitted_at = datetime.utcnow()

        # Also update the linked assessment status if applicable
        if qr.assessment_id:
            assessment = db.query(VendorAssessment).filter(
                VendorAssessment.id == qr.assessment_id,
            ).first()
            if assessment and assessment.status == "draft":
                assessment.status = "submitted"
                assessment.updated_at = datetime.utcnow()
    else:
        # Save draft
        qr.status = "in_progress"

    db.commit()
    db.refresh(qr)

    return {
        "message": "Questionnaire submitted successfully" if payload.submit else "Draft saved successfully",
        "questionnaire_id": qr.id,
        "status": qr.status,
        "submitted_at": qr.submitted_at.isoformat() if qr.submitted_at else None,
    }


# ── Evidence upload (NO AUTH — token-validated) ──────────────────

def _validate_external_token(token: str, db: Session, allow_submitted: bool = False) -> VendorQuestionnaireResponse:
    """Validate external token and return the questionnaire response."""
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.token == token,
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail="Questionnaire not found or invalid token")
    if qr.expires_at and qr.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="This questionnaire link has expired")
    if not allow_submitted and qr.status == "submitted":
        raise HTTPException(status_code=400, detail="This questionnaire has already been submitted")
    return qr


@router.post("/questionnaires/external/{token}/evidence/{question_id}")
async def external_upload_evidence(
    token: str,
    question_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """Upload evidence file for a specific question. No auth — token validated."""
    qr = _validate_external_token(token, db)

    # Save file
    ext = os.path.splitext(file.filename or "")[1]
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(EVIDENCE_UPLOAD_DIR, unique_name)

    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

    evidence = VendorQuestionnaireEvidence(
        response_id=qr.id,
        question_id=question_id,
        file_name=file.filename or unique_name,
        file_path=file_path,
        file_type=file.content_type,
        file_size=len(contents),
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)

    return {
        "id": evidence.id,
        "question_id": evidence.question_id,
        "file_name": evidence.file_name,
        "file_type": evidence.file_type,
        "file_size": evidence.file_size,
        "uploaded_at": evidence.uploaded_at.isoformat() if evidence.uploaded_at else None,
    }


@router.get("/questionnaires/external/{token}/evidence")
def external_list_evidence(
    token: str,
    db: Session = Depends(get_db),
):
    """List all evidence files for a questionnaire. No auth — token validated."""
    qr = _validate_external_token(token, db, allow_submitted=True)

    evidence_list = db.query(VendorQuestionnaireEvidence).filter(
        VendorQuestionnaireEvidence.response_id == qr.id,
    ).order_by(VendorQuestionnaireEvidence.uploaded_at.desc()).all()

    result: dict = {}
    for ev in evidence_list:
        if ev.question_id not in result:
            result[ev.question_id] = []
        result[ev.question_id].append({
            "id": ev.id,
            "file_name": ev.file_name,
            "file_type": ev.file_type,
            "file_size": ev.file_size,
            "uploaded_at": ev.uploaded_at.isoformat() if ev.uploaded_at else None,
        })

    return result


@router.delete("/questionnaires/external/{token}/evidence/{evidence_id}")
def external_delete_evidence(
    token: str,
    evidence_id: int,
    db: Session = Depends(get_db),
):
    """Delete an evidence file. No auth — token validated."""
    qr = _validate_external_token(token, db)

    evidence = db.query(VendorQuestionnaireEvidence).filter(
        VendorQuestionnaireEvidence.id == evidence_id,
        VendorQuestionnaireEvidence.response_id == qr.id,
    ).first()
    if not evidence:
        raise HTTPException(status_code=404, detail="Evidence not found")

    # Remove file from disk
    if evidence.file_path and os.path.exists(evidence.file_path):
        os.remove(evidence.file_path)

    db.delete(evidence)
    db.commit()

    return {"message": "Evidence deleted successfully"}
