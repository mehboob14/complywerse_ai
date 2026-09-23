"""Questionnaire template management + external vendor questionnaire access."""

import logging
import os
import uuid
from typing import List, Literal, Optional
from datetime import date, datetime, timedelta
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireTemplate, TPRATemplateVersion,
    VendorQuestionnaireResponse, VendorQuestionnaireEvidence, GRCUser, get_db,
    Evidence, TPRAEvidenceLink,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..tpra import portal, rbac, versions
from ..tpra import questionnaire_evidence as qevidence
from ..tpra import follow_ups, workbook
from ..tpra.service import write_audit

logger = logging.getLogger(__name__)

EVIDENCE_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "uploads", "questionnaire-evidence")
os.makedirs(EVIDENCE_UPLOAD_DIR, exist_ok=True)

# TPRM-009 — hardening for the PUBLIC (token-only, unauthenticated) evidence upload.
_MAX_EVIDENCE_BYTES = 25 * 1024 * 1024        # 25 MB hard cap (read is bounded, no unbounded memory)
_MAX_EVIDENCE_PER_RESPONSE = 100              # abuse guard: cap files per questionnaire
_ALLOWED_EVIDENCE_EXT = {
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".rtf", ".md",
    ".ppt", ".pptx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip",
    ".json", ".xml", ".log",
}

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
    expires_in_days: Optional[int] = 30     # the link stops working
    due_in_days: Optional[int] = 14         # the answers are due; reminders run on this
    # A certificate in the library answering the questions the template lets it.
    certificate_evidence_id: Optional[int] = None
    certificate_mode: Literal["off", "prefill", "skip"] = "off"


class ExternalSubmitRequest(BaseModel):
    respondent_name: Optional[str] = None
    respondent_email: Optional[str] = None
    responses: dict = {}
    comments: dict = {}                     # {question key: comment}
    # Required to submit: {name, email, title?, confirm: true}
    attestation: Optional[dict] = None
    submit: bool = True  # False = save draft, True = final submit


class ReviewRequest(BaseModel):
    question_key: str
    decision: Literal["accept", "clarify", "clear"]
    note: Optional[str] = None


class ReturnRequest(BaseModel):
    due_in_days: int = Field(7, ge=1, le=90)


class AttachEvidenceRequest(BaseModel):
    question_key: str
    evidence_id: int


class ResendRequest(BaseModel):
    expires_in_days: int = Field(30, ge=1, le=365)
    due_in_days: int = Field(14, ge=1, le=365)


# ── Serializers ───────────────────────────────────────────────────

def serialize_template(t: VendorQuestionnaireTemplate, latest_version: Optional[int] = None) -> dict:
    return {
        "id": t.id,
        "tenant_id": t.tenant_id,
        "name": t.name,
        "category": t.category,
        "description": t.description,
        "questions": t.questions or [],
        "question_count": len(t.questions or []),
        "is_default": t.is_default,
        # Sent questionnaires are pinned to a numbered version; edits make the next one.
        "latest_version": latest_version,
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
        # An accepted questionnaire's link is closed; there is nothing to share.
        "token": None if qr.status == "accepted" else qr.token,
        "template_version_id": qr.template_version_id,
        "expires_at": qr.expires_at.isoformat() if qr.expires_at else None,
        "due_date": qr.due_date.isoformat() if qr.due_date else None,
        "last_sent_at": qr.last_sent_at.isoformat() if qr.last_sent_at else None,
        "submitted_at": qr.submitted_at.isoformat() if qr.submitted_at else None,
        "attested_by": {"name": qr.attested_name, "title": qr.attested_title, "email": qr.attested_email,
                        "at": qr.attested_at.isoformat() if qr.attested_at else None} if qr.attested_name else None,
        "comments": qr.vendor_comments or {},
        "review": qr.review or {},
        "accepted_at": qr.accepted_at.isoformat() if qr.accepted_at else None,
        "certificate": {"evidence_id": qr.certificate_evidence_id, "mode": qr.certificate_mode}
        if qr.certificate_evidence_id else None,
        "parent_response_id": qr.parent_response_id,           # set on a follow-up
        "trigger_key": qr.trigger_key,
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
    published = dict(db.query(TPRATemplateVersion.template_id, func.max(TPRATemplateVersion.version_no))
                     .filter(TPRATemplateVersion.template_id.in_([t.id for t in templates] or [-1]))
                     .group_by(TPRATemplateVersion.template_id).all())

    return {
        "items": [serialize_template(t, published.get(t.id)) for t in templates],
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
    rbac.require_write(db, current_user, "templates", "create")
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
    rbac.require_write(db, current_user, "templates", "edit")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    template = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.id == template_id,
        VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)

    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)
    return serialize_template(template)


@router.delete("/questionnaire-templates/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "templates", "delete")
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")

    template = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.id == template_id,
        VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    if versions.latest(db, template.id) is not None or db.query(VendorQuestionnaireResponse.id).filter(
            VendorQuestionnaireResponse.template_id == template.id).first():
        raise HTTPException(status_code=409, detail=(
            "This template has been sent to vendors, and their answers are kept against it. "
            "Edit it instead: questionnaires already sent keep the version they were sent on."))

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
    rbac.require_write(db, current_user, "assessments", "edit")
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
        if qr.status in portal.ANSWERED:
            _materialise(db, db.query(VendorAssessment).filter(
                VendorAssessment.id == qr.assessment_id).first(), qr)
    db.commit()
    db.refresh(qr)
    return serialize_questionnaire_response(qr)


# ── Send questionnaire (authenticated) ───────────────────────────

def _email_link(db: Session, qr: VendorQuestionnaireResponse, is_reminder: bool = False) -> None:
    """Best effort: the analyst always has the copyable link, and this does
    nothing when email is not configured."""
    if not qr.respondent_email:
        return
    try:
        from ....tasks.tprm import send_questionnaire_invite
        from ....models import Tenant as _Tenant
        tenant = db.query(_Tenant).filter(_Tenant.id == qr.tenant_id).first()
        if tenant and tenant.slug:
            send_questionnaire_invite.delay(tenant_slug=tenant.slug, response_id=qr.id,
                                            base_url=portal.base_url(), is_reminder=is_reminder)
    except Exception:  # noqa: BLE001
        logger.warning("could not queue the questionnaire email for response %s", qr.id)


@router.post("/questionnaires/send", status_code=status.HTTP_201_CREATED)
def send_questionnaire(
    payload: SendQuestionnaireRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Send a questionnaire to a vendor. Creates a VendorQuestionnaireResponse with a unique token."""
    rbac.require_write(db, current_user, "assessments", "create")
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

    # Verify template if provided, and freeze it as the vendor will see it.
    version = None
    if payload.template_id:
        template = db.query(VendorQuestionnaireTemplate).filter(
            VendorQuestionnaireTemplate.id == payload.template_id,
            VendorQuestionnaireTemplate.tenant_id.in_(tenant_ids),
        ).first()
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        version = versions.publish(db, template, current_user.id)

    certificate = None
    if payload.certificate_mode != "off":
        if version is None:
            raise HTTPException(status_code=400, detail="A certificate can only answer a template's questions")
        certificate = db.query(Evidence).filter(
            Evidence.id == payload.certificate_evidence_id, Evidence.tenant_id.in_(tenant_ids)).first()
        problem = qevidence.certificate_problem(db, certificate, vendor)
        if problem is None and not qevidence.covered(version.questions or []):
            problem = ("None of this template's questions can be answered by a certificate. "
                       "Mark them in the template first.")
        if problem:
            raise HTTPException(status_code=400, detail=problem)

    expires_in = max(1, min(int(payload.expires_in_days or 30), 365))
    due_in = max(1, min(int(payload.due_in_days or 14), expires_in))
    now = datetime.utcnow()
    qr = VendorQuestionnaireResponse(
        tenant_id=vendor.tenant_id,
        vendor_id=payload.vendor_id,
        assessment_id=payload.assessment_id,
        template_id=payload.template_id,
        template_version_id=version.id if version else None,
        respondent_name=payload.respondent_name or vendor.primary_contact_name,
        respondent_email=payload.respondent_email or vendor.primary_contact_email,
        token=str(uuid.uuid4()),
        expires_at=now + timedelta(days=expires_in),
        due_date=now + timedelta(days=due_in),
        last_sent_at=now,
        status="pending",
    )
    db.add(qr)
    db.flush()
    if certificate is not None:
        qevidence.apply_certificate(db, qr, version.questions or [], certificate, payload.certificate_mode,
                                    current_user.id)
    db.commit()
    db.refresh(qr)
    _email_link(db, qr)

    return {
        "message": "Vendor questionnaire link generated",
        "token": qr.token,
        "expires_at": qr.expires_at.isoformat(),
        "due_date": qr.due_date.isoformat(),
        "questionnaire_response": serialize_questionnaire_response(qr),
    }


# ── Review (authenticated) ────────────────────────────────────────
# Per question: accept, or ask the vendor to clarify. Then either return the
# questionnaire to the vendor, who can change only what was asked about, or
# accept it, which closes the link for good.

def _response_or_404(db: Session, user: GRCUser, response_id: int) -> VendorQuestionnaireResponse:
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.id == response_id,
        VendorQuestionnaireResponse.tenant_id.in_(get_user_tenants(user, db) or [-1]),
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail="Questionnaire response not found")
    return qr


def _audit(db: Session, qr: VendorQuestionnaireResponse, user: GRCUser, action: str,
           to_value=None, reason: Optional[str] = None, **extra) -> None:
    write_audit(db, qr.tenant_id, entity="questionnaire", action=action, vendor_id=qr.vendor_id,
                assessment_id=qr.assessment_id, entity_id=qr.id, actor_id=user.id,
                to_value=to_value, reason=reason, extra=extra)


@router.post("/questionnaire-responses/{response_id}/review")
def review_question(
    response_id: int,
    payload: ReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    if qr.status not in portal.REVIEWABLE:
        raise HTTPException(status_code=409, detail="Only a submitted questionnaire can be reviewed")
    key = payload.question_key
    if key not in {str(q.get("id")) for q in versions.questions_for(db, qr)}:
        raise HTTPException(status_code=404, detail="That question is not in this questionnaire")
    note = " ".join((payload.note or "").split())[:4000] or None
    if payload.decision == "clarify" and not note:
        raise HTTPException(status_code=400, detail="Say what the vendor needs to clarify")

    review = dict(qr.review or {})
    if payload.decision == "clear":
        review.pop(key, None)
    else:
        review[key] = {"status": "accepted" if payload.decision == "accept" else "clarify", "note": note,
                       "by": current_user.id, "at": datetime.utcnow().isoformat()}
    qr.review = review
    qr.status = "under_review"
    _audit(db, qr, current_user, "review", to_value=payload.decision, reason=note, question_key=key)
    db.commit()
    return serialize_questionnaire_response(qr)


@router.post("/questionnaire-responses/{response_id}/return")
def return_to_vendor(
    response_id: int,
    payload: ReturnRequest = ReturnRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    if qr.status not in portal.REVIEWABLE:
        raise HTTPException(status_code=409, detail="Only a submitted questionnaire can be returned")
    asks = portal.clarifications(qr.review)
    if not asks:
        raise HTTPException(status_code=400, detail="Ask the vendor about at least one question first")
    now = datetime.utcnow()
    qr.status = "returned"
    qr.due_date = now + timedelta(days=payload.due_in_days)
    if qr.expires_at is None or qr.expires_at < qr.due_date + timedelta(days=7):
        qr.expires_at = qr.due_date + timedelta(days=7)          # the link outlives the new due date
    _audit(db, qr, current_user, "return", to_value="returned", questions=sorted(asks))
    db.commit()
    _email_link(db, qr, is_reminder=True)
    return serialize_questionnaire_response(qr)


@router.post("/questionnaire-responses/{response_id}/accept")
def accept_questionnaire(
    response_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    if qr.status not in portal.REVIEWABLE:
        raise HTTPException(status_code=409, detail="Only a submitted questionnaire can be accepted")
    waiting = portal.clarifications(qr.review)
    if waiting:
        raise HTTPException(status_code=409, detail=(
            f"{len(waiting)} question{'s are' if len(waiting) != 1 else ' is'} marked for clarification. "
            "Return the questionnaire to the vendor, or clear those first."))
    now = datetime.utcnow()
    questions = versions.questions_for(db, qr)
    review = dict(qr.review or {})
    for q in portal.visible_questions(questions, qr.responses or {}):
        key = str(q.get("id"))
        if (review.get(key) or {}).get("status") != "accepted":
            review[key] = {**(review.get(key) or {}), "status": "accepted", "by": current_user.id, "at": now.isoformat()}
    qr.review = review
    qr.status = "accepted"
    qr.accepted_by, qr.accepted_at = current_user.id, now
    qr.token = f"closed-{uuid.uuid4().hex}"                     # the vendor's link stops working
    if qr.assessment_id:
        _materialise(db, db.query(VendorAssessment).filter(VendorAssessment.id == qr.assessment_id).first(), qr)
    _audit(db, qr, current_user, "accept", to_value="accepted")
    children = follow_ups.send(db, qr, questions, current_user.id, now=now)
    for child in children:
        _audit(db, qr, current_user, "follow_up", to_value=child.template_id, trigger=child.trigger_key,
               follow_up_id=child.id)
    db.commit()
    for child in children:
        _email_link(db, child)
    return {**serialize_questionnaire_response(qr), "follow_ups": [c.id for c in children]}


@router.post("/questionnaire-responses/{response_id}/resend")
def resend_questionnaire(
    response_id: int,
    payload: ResendRequest = ResendRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """A new link, and the old one stops working."""
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    if qr.status not in portal.WAITING_ON_VENDOR:
        raise HTTPException(status_code=409, detail="Only a questionnaire still waiting on the vendor can be resent")
    now = datetime.utcnow()
    qr.token = str(uuid.uuid4())
    qr.expires_at = now + timedelta(days=payload.expires_in_days)
    qr.due_date = now + timedelta(days=min(payload.due_in_days, payload.expires_in_days))
    qr.last_sent_at = now
    _audit(db, qr, current_user, "resend", to_value="resent")
    db.commit()
    _email_link(db, qr, is_reminder=True)
    return serialize_questionnaire_response(qr)


# ── External vendor access (NO AUTH) ─────────────────────────────

_GONE = "This questionnaire link is no longer valid. Ask your contact for a new one."


def _validate_external_token(token: str, db: Session, allow_submitted: bool = False) -> VendorQuestionnaireResponse:
    """The questionnaire behind a vendor's link, if the link still works."""
    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.token == token,
    ).first()
    if not qr:
        raise HTTPException(status_code=404, detail=_GONE)
    if not portal.throttle.allow(token):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Too many requests for this questionnaire. Wait a few minutes and try again.")
    if qr.expires_at and qr.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="This questionnaire link has expired. Ask your contact to send a new one.")
    if not allow_submitted and qr.status not in portal.WAITING_ON_VENDOR:
        raise HTTPException(status_code=400, detail="This questionnaire has already been submitted")
    return qr


@router.get("/questionnaires/external/{token}")
def external_load_questionnaire(
    token: str,
    db: Session = Depends(get_db),
):
    """External vendor loads the questionnaire by token. No authentication required."""
    qr = _validate_external_token(token, db)

    # The questions as they were sent, whatever has happened to the template since.
    questions = versions.questions_for(db, qr)
    db.commit()                      # a link sent before versions existed is pinned now
    fixed = qevidence.locked(qr, questions)
    if fixed:
        questions = [{**q, "locked": True} if str(q.get("id")) in fixed else q for q in questions]
    certificate = db.get(Evidence, qr.certificate_evidence_id) if qr.certificate_evidence_id else None

    vendor = db.query(Vendor).filter(Vendor.id == qr.vendor_id).first()
    evidence_by_question: dict = {}
    for ev in db.query(VendorQuestionnaireEvidence).filter(VendorQuestionnaireEvidence.response_id == qr.id):
        evidence_by_question.setdefault(ev.question_id, []).append({
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
        "due_date": qr.due_date.isoformat() if qr.due_date else None,
        "questions": questions,
        "existing_responses": qr.responses or {},
        "comments": qr.vendor_comments or {},
        # While returned, only these can change: {question key: what the reviewer asked}.
        "clarifications": portal.clarifications(qr.review) if qr.status == "returned" else {},
        "attestation": {"name": qr.attested_name, "title": qr.attested_title, "email": qr.attested_email},
        # A certificate answered some questions: in skip mode they cannot be changed.
        "certificate": {"name": certificate.name, "mode": qr.certificate_mode,
                        "expires": certificate.expiry_date.isoformat() if certificate.expiry_date else None}
        if certificate else None,
        "evidence": evidence_by_question,
    }


def _materialise(db: Session, assessment, qr) -> None:
    """Write the answers as per-question rows for review and scoring. A vendor's
    submission must never fail over this: the answers are already saved, and
    scoring reads them from the questionnaire itself until the rows exist."""
    if assessment is None:
        return
    try:
        with db.begin_nested():
            from ..tpra.service import materialise_responses

            materialise_responses(db, assessment, qr)
    except Exception:  # noqa: BLE001
        logger.exception("Could not write per-question answers for questionnaire %s", qr.id)


@router.post("/questionnaires/external/{token}")
def external_submit_questionnaire(
    token: str,
    payload: ExternalSubmitRequest,
    db: Session = Depends(get_db),
):
    """External vendor saves or submits answers. No authentication required."""
    qr = _validate_external_token(token, db)
    return _save_answers(db, qr, payload)


def _save_answers(db: Session, qr: VendorQuestionnaireResponse, payload: ExternalSubmitRequest) -> dict:
    """Save a vendor's answers, from the portal or a workbook.

    Which questions apply is worked out again here, so an answer to one the
    vendor could not see neither counts nor blocks. While a questionnaire is
    returned, only the questions the reviewer asked about can change. Submitting
    takes a named person attesting to the answers."""
    questions = versions.questions_for(db, qr)
    answers = portal.merge(qr.status, questions, qr.responses or {}, payload.responses or {}, qr.review)
    answers.update(qevidence.locked(qr, questions))
    open_to_comment = (set(portal.clarifications(qr.review)) if qr.status == "returned"
                       else {str(q.get("id")) for q in questions})
    comments = dict(qr.vendor_comments or {})
    for key, text in (payload.comments or {}).items():
        if key in open_to_comment:
            text = str(text or "").strip()[:4000]
            if text:
                comments[key] = text
            else:
                comments.pop(key, None)

    if payload.respondent_name:
        qr.respondent_name = payload.respondent_name[:255]
    if payload.respondent_email:
        qr.respondent_email = payload.respondent_email[:255]

    now = datetime.utcnow()
    if payload.submit:
        missing = portal.missing_required(questions, answers)
        if missing:
            raise HTTPException(status_code=400, detail=(
                f"{len(missing)} required question{'s' if len(missing) != 1 else ''} still need an answer"))
        try:
            who = portal.clean_attestation(payload.attestation)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        qr.attested_name, qr.attested_email, qr.attested_title, qr.attested_at = (
            who["name"], who["email"], who["title"], who["at"])
        if qr.status == "returned":
            review = dict(qr.review or {})
            for key in portal.clarifications(review):
                review[key] = {**review[key], "status": "answered", "answered_at": now.isoformat()}
            qr.review = review
        qr.status = "submitted"
        qr.submitted_at = now
    elif qr.status != "returned":
        qr.status = "in_progress"
    qr.responses = answers
    qr.vendor_comments = comments

    if payload.submit and qr.assessment_id:
        assessment = db.query(VendorAssessment).filter(VendorAssessment.id == qr.assessment_id).first()
        if assessment and assessment.status == "draft":
            assessment.status = "submitted"
            assessment.updated_at = now
        _materialise(db, assessment, qr)

    db.commit()
    db.refresh(qr)

    return {
        "message": "Questionnaire submitted successfully" if payload.submit else "Draft saved successfully",
        "questionnaire_id": qr.id,
        "status": qr.status,
        "submitted_at": qr.submitted_at.isoformat() if qr.submitted_at else None,
    }


# ── Evidence upload (NO AUTH — token-validated) ──────────────────

@router.post("/questionnaires/external/{token}/evidence/{question_id}")
async def external_upload_evidence(
    token: str,
    question_id: str,
    file: UploadFile = File(...),
    expires_on: Optional[date] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload evidence file for a specific question. No auth — token validated.

    Hardened (TPRM-009): extension allow-list, 25 MB size cap (bounded read),
    per-questionnaire file cap, and a UUID-based on-disk name derived only from the
    validated extension (no path traversal from the client filename).

    The file also becomes an evidence-library record linked to the question, with
    the expiry the vendor gives (a certificate's), and is reviewed against the
    question in the background."""
    qr = _validate_external_token(token, db)
    question = next((q for q in versions.questions_for(db, qr) if str(q.get("id")) == question_id), None)
    if question is None:
        raise HTTPException(status_code=404, detail="That question is not in this questionnaire")
    if qr.status == "returned" and question_id not in portal.clarifications(qr.review):
        raise HTTPException(status_code=409, detail="Only the questions your contact asked about can change now")

    # Extension allow-list — reject executables/scripts/unknown types.
    filename = (file.filename or "").strip()
    ext = os.path.splitext(filename)[1].lower()
    if ext not in _ALLOWED_EVIDENCE_EXT:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"File type '{ext or 'unknown'}' is not allowed. Allowed: {', '.join(sorted(_ALLOWED_EVIDENCE_EXT))}",
        )

    # Abuse guard: cap the number of files per questionnaire response.
    if db.query(VendorQuestionnaireEvidence).filter(
        VendorQuestionnaireEvidence.response_id == qr.id
    ).count() >= _MAX_EVIDENCE_PER_RESPONSE:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                            detail="Upload limit reached for this questionnaire.")

    # Bounded read — never load an unbounded file into memory. Reading cap+1 lets
    # us detect (and reject) anything over the limit without buffering the whole file.
    contents = await file.read(_MAX_EVIDENCE_BYTES + 1)
    if len(contents) > _MAX_EVIDENCE_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            detail=f"File exceeds the {_MAX_EVIDENCE_BYTES // (1024 * 1024)} MB limit.")
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")

    # On-disk name is a UUID + the validated extension only — the client filename
    # never touches the path (path-traversal safe). The original name is kept for display.
    unique_name = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join(EVIDENCE_UPLOAD_DIR, unique_name)
    with open(file_path, "wb") as f:
        f.write(contents)

    display_name = (os.path.basename(filename) or unique_name)[:255]
    library = qevidence.attach_upload(
        db, qr, question, db.query(Vendor).filter(Vendor.id == qr.vendor_id).first(),
        file_path=file_path, file_name=display_name, file_type=file.content_type, expires_on=expires_on)
    evidence = VendorQuestionnaireEvidence(
        response_id=qr.id,
        question_id=(question_id or "")[:100],
        file_name=display_name,
        file_path=file_path,
        file_type=file.content_type,
        file_size=len(contents),
        evidence_id=library.id,
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    qevidence.review(db, qr, question, library)

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

    # The vendor withdrew it before submitting: its library record goes too.
    if evidence.evidence_id:
        library = db.get(Evidence, evidence.evidence_id)
        if library is not None:
            library.status = "archived"
        for link in db.query(TPRAEvidenceLink).filter(TPRAEvidenceLink.evidence_id == evidence.evidence_id,
                                                      TPRAEvidenceLink.deleted_at.is_(None)):
            link.deleted_at = datetime.utcnow()

    # Remove file from disk
    if evidence.file_path and os.path.exists(evidence.file_path):
        os.remove(evidence.file_path)

    db.delete(evidence)
    db.commit()

    return {"message": "Evidence deleted successfully"}


# ── Evidence behind the answers (authenticated) ──────────────────

@router.get("/questionnaire-responses/{response_id}/evidence")
def questionnaire_evidence(
    response_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The library evidence behind each answer, with its review against that question."""
    return qevidence.by_question(db, _response_or_404(db, current_user, response_id))


@router.get("/questionnaire-responses/{response_id}/library")
def search_library(
    response_id: int,
    search: str = Query("", max_length=100),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Library evidence an analyst could attach to an answer instead of asking for it again."""
    qr = _response_or_404(db, current_user, response_id)
    q = db.query(Evidence).filter(Evidence.tenant_id == qr.tenant_id,
                                  ~Evidence.status.in_(("archived", "superseded", "rejected")))
    if search.strip():
        q = q.filter(Evidence.name.ilike(f"%{search.strip()}%"))
    return [{"id": e.id, "name": e.name, "evidence_type": e.evidence_type,
             "expiry_date": e.expiry_date.isoformat() if e.expiry_date else None}
            for e in q.order_by(Evidence.uploaded_at.desc()).limit(20)]


@router.post("/questionnaire-responses/{response_id}/evidence")
def attach_library_evidence(
    response_id: int,
    payload: AttachEvidenceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    question = next((q for q in versions.questions_for(db, qr) if str(q.get("id")) == payload.question_key), None)
    if question is None:
        raise HTTPException(status_code=404, detail="That question is not in this questionnaire")
    evidence = db.query(Evidence).filter(Evidence.id == payload.evidence_id,
                                         Evidence.tenant_id == qr.tenant_id).first()
    if evidence is None:
        raise HTTPException(status_code=404, detail="That evidence is not in the library")
    link = qevidence.attach_library(db, qr, question, evidence, current_user.id)
    _audit(db, qr, current_user, "evidence", to_value="attached", question_key=payload.question_key,
           evidence_id=evidence.id)
    db.commit()
    qevidence.review(db, qr, question, evidence)
    return {"link_id": link.id}


@router.delete("/questionnaire-responses/{response_id}/evidence/{link_id}")
def detach_evidence(
    response_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    link = db.query(TPRAEvidenceLink).filter(TPRAEvidenceLink.id == link_id, TPRAEvidenceLink.questionnaire_id == qr.id,
                                             TPRAEvidenceLink.deleted_at.is_(None)).first()
    if link is None:
        raise HTTPException(status_code=404, detail="Evidence link not found")
    link.deleted_at = datetime.utcnow()
    _audit(db, qr, current_user, "evidence", to_value="detached", question_key=link.question_key,
           evidence_id=link.evidence_id)
    db.commit()
    return {"ok": True}


# ── Offline: a workbook out and back (portal and analyst) ────────

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _workbook_file(db: Session, qr: VendorQuestionnaireResponse) -> Response:
    questions = versions.questions_for(db, qr)
    db.commit()                      # a link sent before versions existed is pinned now
    vendor = db.query(Vendor).filter(Vendor.id == qr.vendor_id).first()
    content = workbook.build(qr, questions, vendor.name if vendor else "your organisation",
                             qevidence.locked(qr, questions))
    return Response(content=content, media_type=_XLSX, headers={
        "Content-Disposition": f'attachment; filename="questionnaire-{qr.id}.xlsx"'})


async def _read_workbook(db: Session, qr: VendorQuestionnaireResponse, file: UploadFile) -> dict:
    if not (file.filename or "").lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="Upload the .xlsx workbook downloaded for this questionnaire")
    content = await file.read(workbook.MAX_BYTES + 1)
    try:
        return workbook.read(content, qr, versions.questions_for(db, qr))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/questionnaires/external/{token}/workbook")
def external_workbook(token: str, db: Session = Depends(get_db)):
    """The questionnaire as a workbook, to answer offline. No auth — token validated."""
    return _workbook_file(db, _validate_external_token(token, db))


@router.post("/questionnaires/external/{token}/workbook")
async def external_import_workbook(
    token: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """A completed workbook, saved as a draft. The vendor then checks it and
    submits in the portal, where the attestation is confirmed."""
    qr = _validate_external_token(token, db)
    parsed = await _read_workbook(db, qr, file)
    saved = _save_answers(db, qr, ExternalSubmitRequest(
        responses=parsed["responses"], comments=parsed["comments"], submit=False))
    return {**saved, "imported": len(parsed["responses"]), "attestation": parsed["attestation"]}


@router.get("/questionnaire-responses/{response_id}/workbook")
def download_workbook(
    response_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    return _workbook_file(db, _response_or_404(db, current_user, response_id))


@router.post("/questionnaire-responses/{response_id}/workbook")
async def import_workbook(
    response_id: int,
    file: UploadFile = File(...),
    submit: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """A workbook the vendor sent back by email. Submitting it needs the vendor's
    own attestation, filled in on the workbook's Attestation sheet."""
    rbac.require_write(db, current_user, "assessments", "edit")
    qr = _response_or_404(db, current_user, response_id)
    if qr.status not in portal.WAITING_ON_VENDOR:
        raise HTTPException(status_code=409, detail="Only a questionnaire still waiting on the vendor can take answers")
    parsed = await _read_workbook(db, qr, file)
    saved = _save_answers(db, qr, ExternalSubmitRequest(
        responses=parsed["responses"], comments=parsed["comments"],
        attestation=parsed["attestation"] if submit else None, submit=submit))
    _audit(db, qr, current_user, "import", to_value="submitted" if submit else "draft",
           answers=len(parsed["responses"]))
    db.commit()
    return {**saved, "imported": len(parsed["responses"])}


@router.get("/questionnaires/certificates")
def vendor_certificates(
    vendor_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """In-date evidence already held for a vendor: what can answer questions for it."""
    tenant_ids = get_user_tenants(current_user, db) or [-1]
    ids = {i for (i,) in db.query(TPRAEvidenceLink.evidence_id).filter(
        TPRAEvidenceLink.vendor_id == vendor_id, TPRAEvidenceLink.tenant_id.in_(tenant_ids),
        TPRAEvidenceLink.deleted_at.is_(None))}
    rows = db.query(Evidence).filter(Evidence.id.in_(ids or [-1]), Evidence.expiry_date.isnot(None),
                                     Evidence.expiry_date >= datetime.utcnow(),
                                     ~Evidence.status.in_(("archived", "superseded", "rejected"))).all()
    return [{"id": e.id, "name": e.name, "expiry_date": e.expiry_date.isoformat(),
             "read": bool((e.ocr_content or "").strip())} for e in rows]
