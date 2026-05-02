from typing import List, Optional
from datetime import datetime
import os
import json
import uuid
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    Framework, FrameworkControl, FrameworkDomain, ControlObjective,
    FrameworkRiskAssessment, FrameworkRiskQuestion, FrameworkRiskQuestionEvidence,
    GRCUser, TenantUser, Evidence, Risk, get_db, UploadedFramework, ParsedFrameworkControl
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/framework-risk-assessments", tags=["ERM - Framework Risk Assessments"])

UPLOAD_DIR = "uploads/framework_risk_evidence"
os.makedirs(UPLOAD_DIR, exist_ok=True)

DEFAULT_QUESTION_COUNT = 20
VALID_QUESTION_STATUSES = {"not_started", "in_progress", "completed", "blocked"}


_AVAILABLE_STATUSES = ('parsed', 'classified', 'completed', 'published')


class FrameworkRiskAssessmentCreate(BaseModel):
    uploaded_framework_id: int
    name: Optional[str] = None
    description: Optional[str] = None


class FrameworkRiskAssessmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None


class FrameworkRiskQuestionCreate(BaseModel):
    question_text: str
    assigned_user_id: Optional[int] = None
    status: Optional[str] = None


class FrameworkRiskQuestionUpdate(BaseModel):
    question_text: Optional[str] = None
    assigned_user_id: Optional[int] = None
    status: Optional[str] = None
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    is_risk_accepted: Optional[bool] = None
    acceptance_notes: Optional[str] = None


class GenerateQuestionsRequest(BaseModel):
    count: Optional[int] = DEFAULT_QUESTION_COUNT
    replace_existing: Optional[bool] = True


class MoveQuestionToRiskRegisterRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[int] = None
    treatment_plan: Optional[str] = None


def _iter_openai_client_candidates() -> List[OpenAI]:
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = bool(base_url and "modelfarm" in base_url)

    candidates: List[OpenAI] = []
    seen_keys = set()
    for key_name in ("OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY"):
        api_key = (os.environ.get(key_name) or "").strip()
        if not api_key:
            continue
        if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
            continue
        if api_key in seen_keys:
            continue
        seen_keys.add(api_key)
        candidates.append(OpenAI(api_key=api_key, base_url=base_url))

    # Modelfarm deployments may be configured without explicit API key.
    if is_modelfarm and not candidates:
        candidates.append(OpenAI(api_key=None, base_url=base_url))

    if not candidates:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. No valid OpenAI key configured."
        )

    return candidates


def _generate_questions_fallback(framework: Framework, controls: List[dict], count: int) -> List[str]:
    base_templates = [
        "For {} requirement {}, what is the inherent risk scenario being mitigated, and how do you currently score likelihood and impact?",
        "For {} control {}, what is the current residual risk after control operation, and what evidence supports that rating?",
        "If {} requirement {} fails, what are the business, regulatory, and operational impacts, and what trigger thresholds define high risk?",
        "How do you monitor key risk indicators tied to {} control {}, and how often are risk trend changes reviewed by risk owners?",
        "For {} requirement {}, what open risk treatment actions exist, who owns them, and what is the target closure timeline?",
    ]

    questions: List[str] = []
    sampled = controls[: max(1, min(len(controls), count))]
    if sampled:
        for idx, control in enumerate(sampled):
            template = base_templates[idx % len(base_templates)]
            clause_ref = (
                control.get("clause_number")
                or control.get("section_number")
                or control.get("code")
                or f"REQ-{idx + 1}"
            ).strip()
            questions.append(f"[{clause_ref}] {template.format(framework.name, clause_ref)}")

    while len(questions) < count:
        i = len(questions) + 1
        questions.append(
            f"For {framework.name}, explain the current risk posture for requirement #{i}, including evidence, control owner, monitoring cadence, and open gaps."
        )

    return questions[:count]


def _remove_file_if_not_in_repository(file_path: Optional[str], db: Session) -> None:
    if not file_path:
        return
    linked_repo_item = db.query(Evidence.id).filter(Evidence.file_path == file_path).first()
    if linked_repo_item:
        return
    if os.path.exists(file_path):
        try:
            os.remove(file_path)
        except Exception:
            pass


def _serialize_evidence(e: FrameworkRiskQuestionEvidence) -> dict:
    return {
        "id": e.id,
        "question_id": e.question_id,
        "file_name": e.file_name,
        "file_path": e.file_path,
        "file_size": e.file_size,
        "mime_type": e.mime_type,
        "description": e.description,
        "uploaded_by": e.uploaded_by,
        "uploader_name": e.uploader.display_name if e.uploader else None,
        "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
    }


def _serialize_question(q: FrameworkRiskQuestion) -> dict:
    return {
        "id": q.id,
        "assessment_id": q.assessment_id,
        "question_text": q.question_text,
        "status": q.status,
        "assigned_user_id": q.assigned_user_id,
        "assigned_user_name": q.assignee.display_name if q.assignee else None,
        "inherent_likelihood": q.inherent_likelihood,
        "inherent_impact": q.inherent_impact,
        "inherent_score": q.inherent_score,
        "residual_likelihood": q.residual_likelihood,
        "residual_impact": q.residual_impact,
        "residual_score": q.residual_score,
        "is_risk_accepted": q.is_risk_accepted,
        "acceptance_notes": q.acceptance_notes,
        "linked_risk_id": q.linked_risk_id,
        "moved_to_risk_register_at": q.moved_to_risk_register_at.isoformat() if q.moved_to_risk_register_at else None,
        "order_index": q.order_index,
        "created_by": q.created_by,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
        "evidence": [_serialize_evidence(e) for e in q.evidence_uploads],
    }


def _serialize_assessment(a: FrameworkRiskAssessment, questions: Optional[List[FrameworkRiskQuestion]] = None) -> dict:
    framework_name = None
    if a.uploaded_framework:
        framework_name = a.uploaded_framework.name
    elif a.framework:
        framework_name = a.framework.name
    return {
        "id": a.id,
        "tenant_id": a.tenant_id,
        "framework_id": a.uploaded_framework_id or a.framework_id,
        "framework_name": framework_name,
        "uploaded_framework_id": a.uploaded_framework_id,
        "name": a.name,
        "description": a.description,
        "status": a.status,
        "created_by": a.created_by,
        "creator_name": a.creator.display_name if a.creator else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
        "questions": [_serialize_question(q) for q in (questions or [])],
        "questions_count": len(questions or []),
    }


def _serialize_assigned_question(q: FrameworkRiskQuestion) -> dict:
    assessment = q.assessment
    framework_name = None
    if assessment:
        if assessment.uploaded_framework:
            framework_name = assessment.uploaded_framework.name
        elif assessment.framework:
            framework_name = assessment.framework.name

    return {
        "id": q.id,
        "assessment_id": q.assessment_id,
        "assessment_name": assessment.name if assessment else None,
        "framework_name": framework_name,
        "question_text": q.question_text,
        "status": q.status,
        "assigned_user_id": q.assigned_user_id,
        "assigned_user_name": q.assignee.display_name if q.assignee else None,
        "order_index": q.order_index,
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
        "evidence_count": len(q.evidence_uploads or []),
    }


def _get_assessment_or_404(assessment_id: int, user_tenants: List[int], db: Session) -> FrameworkRiskAssessment:
    assessment = db.query(FrameworkRiskAssessment).options(
        joinedload(FrameworkRiskAssessment.framework),
        joinedload(FrameworkRiskAssessment.uploaded_framework),
        joinedload(FrameworkRiskAssessment.creator)
    ).filter(
        FrameworkRiskAssessment.id == assessment_id,
        FrameworkRiskAssessment.tenant_id.in_(user_tenants)
    ).first()
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework risk assessment not found")
    return assessment


def _get_question_or_404(assessment_id: int, question_id: int, db: Session) -> FrameworkRiskQuestion:
    question = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(
        FrameworkRiskQuestion.id == question_id,
        FrameworkRiskQuestion.assessment_id == assessment_id
    ).first()
    if not question:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")
    return question


def _fetch_framework_context(uploaded_framework_id: int, db: Session) -> dict:
    """Fetch context from UploadedFramework using ParsedFrameworkControl."""
    fw = db.query(UploadedFramework).filter(UploadedFramework.id == uploaded_framework_id).first()
    if not fw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found")

    parsed_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == uploaded_framework_id
    ).order_by(ParsedFrameworkControl.id.asc()).all()

    control_summaries = [
        {
            "code": c.control_id or "",
            "clause_number": (c.original_reference or c.section_number or c.control_id or "").strip(),
            "title": c.title or "",
            "statement": c.description or "",
            "original_text": c.full_text or c.description or "",
            "section_number": c.section_number or "",
        }
        for c in parsed_controls
        if (c.full_text or c.description)
    ]

    # Build a lightweight framework-like object for AI prompt
    class _FWProxy:
        def __init__(self, fw):
            self.name = fw.name
            self.short_code = fw.framework_type or fw.name[:10].upper()
            self.version = fw.version or "1.0"
            self.description = fw.description or ""
            self.regulator = fw.source_organization or fw.regulatory_authority or ""
            self.jurisdiction = ""

    return {
        "framework": _FWProxy(fw),
        "controls": control_summaries,
    }


def _chunk_controls_for_generation(controls: List[dict], max_chars_per_chunk: int = 90000) -> List[List[dict]]:
    """
    Split control context for at most two AI requests.
    Keeps full original text, but prevents overlong prompt payloads.
    """
    if not controls:
        return []

    chunks: List[List[dict]] = [[]]
    current_chars = 0
    for control in controls:
        text = control.get("original_text") or control.get("statement") or ""
        weight = len(text) + len(control.get("title") or "") + 200
        if chunks[-1] and current_chars + weight > max_chars_per_chunk and len(chunks) < 2:
            chunks.append([])
            current_chars = 0
        chunks[-1].append(control)
        current_chars += weight

    return chunks[:2]


def _format_question_with_clause(question_text: str, clause_reference: str) -> str:
    question_text = (question_text or "").strip()
    clause_reference = (clause_reference or "").strip()
    if not question_text:
        return ""
    if clause_reference:
        return f"[{clause_reference}] {question_text}"
    return question_text


def _generate_questions_batch_with_ai(
    framework: Framework,
    controls_batch: List[dict],
    question_count: int,
    model: str,
) -> List[str]:
    if question_count <= 0 or not controls_batch:
        return []

    # Provide complete original clause text context for accuracy.
    controls_payload = []
    for c in controls_batch:
        clause_ref = (c.get("clause_number") or c.get("section_number") or c.get("code") or "").strip()
        controls_payload.append({
            "clause_reference": clause_ref,
            "control_code": (c.get("code") or "").strip(),
            "title": (c.get("title") or "").strip(),
            "original_text": (c.get("original_text") or c.get("statement") or "").strip(),
        })

    payload = {
        "framework": {
            "name": framework.name,
            "short_code": framework.short_code,
            "version": framework.version,
            "description": framework.description,
            "regulator": framework.regulator,
            "jurisdiction": framework.jurisdiction,
        },
        "question_count": question_count,
        "controls": controls_payload,
        "instructions": [
            "Generate risk-assessment questions ONLY from the provided original clause text.",
            "Do not invent clauses, controls, or wording not present in the provided controls array.",
            "Each question must target inherent risk, residual risk, control effectiveness, KRIs, treatment, monitoring, governance, or exceptions.",
            "If you provide a clause reference, it MUST match one of the provided clause_reference values exactly.",
            "Return strict JSON object with key 'questions'.",
            "Each element in questions must be an object with fields: question_text, clause_reference, source_quote.",
            "source_quote must be an exact short quote from original_text used to ground the question.",
        ],
    }

    valid_clause_refs = {
        (c.get("clause_reference") or "").strip()
        for c in controls_payload
        if (c.get("clause_reference") or "").strip()
    }

    content = ""
    last_error: Optional[Exception] = None
    for client in _iter_openai_client_candidates():
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a strict GRC risk assessor. "
                            "You must ground every question in supplied framework clause text only. "
                            "Never hallucinate clause references."
                        ),
                    },
                    {"role": "user", "content": json.dumps(payload)},
                ],
                temperature=0.1,
                max_tokens=3200,
                response_format={"type": "json_object"},
            )
            content = (response.choices[0].message.content or "").strip()
            if content:
                break
        except Exception as e:
            last_error = e
            continue

    if not content:
        if last_error:
            raise last_error
        return []

    parsed = json.loads(content)
    raw_questions = parsed.get("questions") if isinstance(parsed, dict) else []
    if not isinstance(raw_questions, list):
        return []

    output: List[str] = []
    for item in raw_questions:
        if not isinstance(item, dict):
            continue
        question_text = (item.get("question_text") or "").strip()
        clause_reference = (item.get("clause_reference") or "").strip()
        if not question_text:
            continue

        # Never allow invalid clause references to leak into output.
        if clause_reference and clause_reference not in valid_clause_refs:
            clause_reference = ""

        formatted = _format_question_with_clause(question_text, clause_reference)
        if formatted:
            output.append(formatted)

    return output


def _dedupe_questions(questions: List[str]) -> List[str]:
    seen = set()
    unique: List[str] = []
    for q in questions:
        key = re.sub(r"\s+", " ", q.strip().lower())
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(q.strip())
    return unique


def _validate_assigned_user_for_tenant(tenant_id: int, assigned_user_id: Optional[int], db: Session) -> None:
    if not assigned_user_id:
        return

    # Per-tenant DB: every active grc_users row belongs to this tenant.
    # The previous check joined through grc_tenant_users which is only
    # populated for the bootstrap admin, so users created via /admin/users
    # were rejected here.
    exists = db.query(GRCUser.id).filter(
        GRCUser.id == assigned_user_id,
        GRCUser.is_active.is_(True),
    ).first()

    if not exists:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assigned user must belong to the same tenant as the assessment"
        )


def _validate_risk_scale_value(field_name: str, value: Optional[int]) -> None:
    if value is None:
        return
    if value < 1 or value > 5:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be between 1 and 5"
        )


def _recalculate_question_scores(question: FrameworkRiskQuestion) -> None:
    if question.inherent_likelihood and question.inherent_impact:
        question.inherent_score = float(question.inherent_likelihood * question.inherent_impact)
    else:
        question.inherent_score = None

    if question.residual_likelihood and question.residual_impact:
        question.residual_score = float(question.residual_likelihood * question.residual_impact)
    else:
        question.residual_score = None


def _resolve_framework_id_for_assessment(uploaded_fw: UploadedFramework, db: Session) -> int:
    """Ensure framework_id is always populated.

    `grc_framework_risk_assessments.framework_id` is NOT NULL in some legacy
    schemas, so uploaded frameworks that aren't yet published would otherwise
    fail insert. We materialize a bridge `Framework` row so the FK resolves.
    """
    if uploaded_fw.published_framework_id:
        return uploaded_fw.published_framework_id

    bridge_short_code = f"UPFW_{uploaded_fw.id}"
    bridge_framework = db.query(Framework).filter(
        Framework.short_code == bridge_short_code
    ).first()

    if not bridge_framework:
        bridge_framework = Framework(
            name=uploaded_fw.name,
            short_code=bridge_short_code,
            regulator=uploaded_fw.source_organization or uploaded_fw.regulatory_authority,
            jurisdiction="Global",
            version=uploaded_fw.version or "1.0",
            description=uploaded_fw.description,
            is_custom=True,
            is_active=True,
        )
        db.add(bridge_framework)
        db.flush()

    return bridge_framework.id


def _generate_questions_with_ai(framework: Framework, controls: List[dict], count: int) -> List[str]:
    if not controls:
        return []

    model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o")
    control_chunks = _chunk_controls_for_generation(controls)
    if not control_chunks:
        return []

    # Distribute requested count across at most 2 requests, then merge.
    chunk_count = len(control_chunks)
    base = count // chunk_count
    remainder = count % chunk_count
    allocations = [base + (1 if i < remainder else 0) for i in range(chunk_count)]

    merged_questions: List[str] = []
    last_error: Optional[Exception] = None
    for idx, chunk in enumerate(control_chunks):
        try:
            batch_questions = _generate_questions_batch_with_ai(
                framework=framework,
                controls_batch=chunk,
                question_count=allocations[idx],
                model=model,
            )
            merged_questions.extend(batch_questions)
        except Exception as e:
            last_error = e
            logger.warning("AI generation chunk %s failed for framework %s: %s", idx + 1, framework.name, e)

    merged_questions = _dedupe_questions(merged_questions)
    if merged_questions:
        return merged_questions[:count]

    if last_error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI question generation is unavailable due to key/auth configuration."
        )
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="AI question generation is unavailable."
    )


@router.get("/available-frameworks")
def list_available_frameworks_for_risk_assessment(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Returns all UploadedFramework items that are in a processed state —
    identical to the 'Available Frameworks' shown on the /frameworks page.
    """
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    uploaded = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(_AVAILABLE_STATUSES),
        UploadedFramework.is_active == True,
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.is_shared == True
        )
    ).order_by(UploadedFramework.name).all()

    # Deduplicate by (name, version)
    seen: dict = {}
    status_priority = {'classified': 4, 'published': 3, 'completed': 2, 'parsed': 1}
    for fw in uploaded:
        key = (fw.name.lower().strip(), (fw.version or '').lower().strip())
        pri = status_priority.get(fw.upload_status or '', 0)
        if key not in seen or pri > seen[key]['_pri']:
            seen[key] = {'_pri': pri, '_fw': fw}

    result = []
    for entry in seen.values():
        fw = entry['_fw']
        result.append({
            'id': fw.id,
            'name': fw.name,
            'short_code': fw.framework_type or fw.name[:10].upper(),
            'version': fw.version or '1.0',
        })

    result.sort(key=lambda x: x['name'])
    return result


@router.get("/my-assigned-questions")
def list_my_assigned_framework_questions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    questions = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads),
        joinedload(FrameworkRiskQuestion.assessment).joinedload(FrameworkRiskAssessment.framework),
        joinedload(FrameworkRiskQuestion.assessment).joinedload(FrameworkRiskAssessment.uploaded_framework),
    ).join(FrameworkRiskAssessment, FrameworkRiskQuestion.assessment_id == FrameworkRiskAssessment.id).filter(
        FrameworkRiskQuestion.assigned_user_id == current_user.id,
        FrameworkRiskAssessment.tenant_id.in_(user_tenants),
        FrameworkRiskAssessment.status != "archived",
    ).order_by(
        FrameworkRiskAssessment.updated_at.desc(),
        FrameworkRiskQuestion.order_index.asc(),
        FrameworkRiskQuestion.created_at.asc(),
    ).all()

    return [_serialize_assigned_question(q) for q in questions]


@router.get("")
def list_framework_risk_assessments(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    assessments = db.query(FrameworkRiskAssessment).options(
        joinedload(FrameworkRiskAssessment.framework),
        joinedload(FrameworkRiskAssessment.uploaded_framework),
        joinedload(FrameworkRiskAssessment.creator)
    ).filter(
        FrameworkRiskAssessment.tenant_id.in_(user_tenants)
    ).order_by(FrameworkRiskAssessment.created_at.desc()).all()

    results = []
    for a in assessments:
        questions_count = db.query(func.count(FrameworkRiskQuestion.id)).filter(
            FrameworkRiskQuestion.assessment_id == a.id
        ).scalar() or 0
        results.append({
            **_serialize_assessment(a, []),
            "questions_count": questions_count
        })

    return results


@router.post("", status_code=status.HTTP_201_CREATED)
def create_framework_risk_assessment(
    data: FrameworkRiskAssessmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")

    uploaded_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == data.uploaded_framework_id,
        UploadedFramework.upload_status.in_(_AVAILABLE_STATUSES),
        UploadedFramework.is_active == True,
    ).first()
    if not uploaded_fw:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework not found or not yet processed")

    name = data.name or f"{uploaded_fw.name} Risk Assessment"
    framework_id = _resolve_framework_id_for_assessment(uploaded_fw, db)

    assessment = FrameworkRiskAssessment(
        tenant_id=tenant_id,
        uploaded_framework_id=data.uploaded_framework_id,
        framework_id=framework_id,
        name=name,
        description=data.description,
        status="in_progress",
        created_by=current_user.id,
    )
    db.add(assessment)
    db.commit()
    db.refresh(assessment)

    assessment = db.query(FrameworkRiskAssessment).options(
        joinedload(FrameworkRiskAssessment.framework),
        joinedload(FrameworkRiskAssessment.uploaded_framework),
        joinedload(FrameworkRiskAssessment.creator)
    ).filter(FrameworkRiskAssessment.id == assessment.id).first()

    return _serialize_assessment(assessment, [])


@router.get("/{assessment_id}")
def get_framework_risk_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    questions = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(
        FrameworkRiskQuestion.assessment_id == assessment_id
    ).order_by(FrameworkRiskQuestion.order_index.asc(), FrameworkRiskQuestion.created_at.asc()).all()

    return _serialize_assessment(assessment, questions)


@router.put("/{assessment_id}")
def update_framework_risk_assessment(
    assessment_id: int,
    data: FrameworkRiskAssessmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(assessment, key, value)

    assessment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(assessment)

    assessment = db.query(FrameworkRiskAssessment).options(
        joinedload(FrameworkRiskAssessment.framework),
        joinedload(FrameworkRiskAssessment.uploaded_framework),
        joinedload(FrameworkRiskAssessment.creator)
    ).filter(FrameworkRiskAssessment.id == assessment.id).first()

    questions = db.query(FrameworkRiskQuestion).filter(
        FrameworkRiskQuestion.assessment_id == assessment_id
    ).all()

    return _serialize_assessment(assessment, questions)


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_framework_risk_assessment(
    assessment_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    db.delete(assessment)
    db.commit()
    return None


@router.post("/{assessment_id}/generate-questions")
def generate_framework_questions(
    assessment_id: int,
    data: GenerateQuestionsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)

    count = data.count or DEFAULT_QUESTION_COUNT
    if count < 1 or count > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question count must be between 1 and 50")

    if data.replace_existing:
        existing_questions = db.query(FrameworkRiskQuestion).options(
            joinedload(FrameworkRiskQuestion.evidence_uploads)
        ).filter(
            FrameworkRiskQuestion.assessment_id == assessment_id
        ).all()
        for question in existing_questions:
            for evidence in question.evidence_uploads:
                if evidence.file_path and os.path.exists(evidence.file_path):
                    try:
                        os.remove(evidence.file_path)
                    except Exception:
                        pass
        db.query(FrameworkRiskQuestion).filter(
            FrameworkRiskQuestion.assessment_id == assessment_id
        ).delete(synchronize_session=False)
        db.commit()

    # Use uploaded_framework_id first (all statuses), fall back to published framework_id
    fw_ref_id = assessment.uploaded_framework_id or assessment.framework_id
    if not fw_ref_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment has no framework linked")
    context = _fetch_framework_context(fw_ref_id, db)
    framework = context["framework"]
    controls = context["controls"]

    generation_source = "ai"
    generation_warning = None
    try:
        questions = _generate_questions_with_ai(framework, controls, count)
    except HTTPException as e:
        logger.warning(f"AI question generation unavailable, using fallback: {e.detail}")
        generation_source = "fallback"
        generation_warning = e.detail
        questions = _generate_questions_fallback(framework, controls, count)
    except Exception as e:
        logger.error(f"AI question generation failed, using fallback: {e}")
        generation_source = "fallback"
        generation_warning = "AI question generation failed; fallback questions were generated."
        questions = _generate_questions_fallback(framework, controls, count)

    if len(questions) < count:
        fallback_needed = count - len(questions)
        for i in range(fallback_needed):
            questions.append(f"Describe how your organization addresses key risks related to {framework.name} requirement #{i + 1}.")

    created = []
    for idx, q in enumerate(questions[:count], start=1):
        question = FrameworkRiskQuestion(
            assessment_id=assessment_id,
            question_text=q,
            status="not_started",
            order_index=idx,
            created_by=current_user.id,
        )
        db.add(question)
        created.append(question)

    db.commit()

    questions = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(
        FrameworkRiskQuestion.assessment_id == assessment_id
    ).order_by(FrameworkRiskQuestion.order_index.asc()).all()

    return {
        "assessment_id": assessment_id,
        "questions": [_serialize_question(q) for q in questions],
        "count": len(questions),
        "generation_source": generation_source,
        "generation_warning": generation_warning,
    }


@router.post("/{assessment_id}/questions", status_code=status.HTTP_201_CREATED)
def create_framework_question(
    assessment_id: int,
    data: FrameworkRiskQuestionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)

    if not data.question_text or not data.question_text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question text is required")

    status_value = data.status or "not_started"
    if status_value not in VALID_QUESTION_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid question status")

    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    _validate_assigned_user_for_tenant(assessment.tenant_id, data.assigned_user_id, db)

    max_order = db.query(func.max(FrameworkRiskQuestion.order_index)).filter(
        FrameworkRiskQuestion.assessment_id == assessment_id
    ).scalar() or 0

    question = FrameworkRiskQuestion(
        assessment_id=assessment_id,
        question_text=data.question_text.strip(),
        status=status_value,
        assigned_user_id=data.assigned_user_id,
        order_index=max_order + 1,
        created_by=current_user.id,
    )
    db.add(question)
    db.commit()
    db.refresh(question)

    question = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(FrameworkRiskQuestion.id == question.id).first()

    return _serialize_question(question)


@router.put("/{assessment_id}/questions/{question_id}")
def update_framework_question(
    assessment_id: int,
    question_id: int,
    data: FrameworkRiskQuestionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    question = _get_question_or_404(assessment_id, question_id, db)

    update_data = data.model_dump(exclude_unset=True)
    if "question_text" in update_data and (not update_data["question_text"] or not str(update_data["question_text"]).strip()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question text is required")

    if "status" in update_data and update_data["status"] not in VALID_QUESTION_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid question status")

    if "inherent_likelihood" in update_data:
        _validate_risk_scale_value("inherent_likelihood", update_data["inherent_likelihood"])
    if "inherent_impact" in update_data:
        _validate_risk_scale_value("inherent_impact", update_data["inherent_impact"])
    if "residual_likelihood" in update_data:
        _validate_risk_scale_value("residual_likelihood", update_data["residual_likelihood"])
    if "residual_impact" in update_data:
        _validate_risk_scale_value("residual_impact", update_data["residual_impact"])

    if "assigned_user_id" in update_data:
        _validate_assigned_user_for_tenant(assessment.tenant_id, update_data["assigned_user_id"], db)

    for key, value in update_data.items():
        setattr(question, key, value)

    _recalculate_question_scores(question)

    question.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(question)

    question = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(FrameworkRiskQuestion.id == question.id).first()

    return _serialize_question(question)


@router.post("/{assessment_id}/questions/{question_id}/move-to-risk-register")
def move_framework_question_to_risk_register(
    assessment_id: int,
    question_id: int,
    data: MoveQuestionToRiskRegisterRequest = MoveQuestionToRiskRegisterRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    question = _get_question_or_404(assessment_id, question_id, db)

    if question.linked_risk_id:
        existing_risk = db.query(Risk).filter(
            Risk.id == question.linked_risk_id,
            Risk.tenant_id == assessment.tenant_id
        ).first()
        return {
            "message": "Question already moved to risk register",
            "risk_id": question.linked_risk_id,
            "risk_title": existing_risk.title if existing_risk else None,
            "question": _serialize_question(question),
        }

    if not question.is_risk_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set 'Accept Risk' before moving this question to the risk register"
        )

    owner_id = data.owner_id or question.assigned_user_id
    if owner_id:
        _validate_assigned_user_for_tenant(assessment.tenant_id, owner_id, db)
    else:
        # Per-tenant DB fallback: if the creator is still an active user,
        # use them as the owner. We no longer require a TenantUser link.
        creator_active = db.query(GRCUser.id).filter(
            GRCUser.id == assessment.created_by,
            GRCUser.is_active.is_(True),
        ).first()
        if creator_active:
            owner_id = assessment.created_by

    framework_name = None
    if assessment.uploaded_framework:
        framework_name = assessment.uploaded_framework.name
    elif assessment.framework:
        framework_name = assessment.framework.name

    default_title = f"[Framework Assessment #{assessment.id}] Q{question.order_index or question.id} Risk"
    risk_title = (data.title or default_title).strip()
    risk_description_parts = [
        f"Source: Framework Risk Assessment '{assessment.name}'",
        f"Framework: {framework_name or 'N/A'}",
        f"Question: {question.question_text}",
    ]
    if question.acceptance_notes:
        risk_description_parts.append(f"Acceptance Notes: {question.acceptance_notes}")
    if data.description:
        risk_description_parts.append(f"Additional Context: {data.description}")

    category_value = "framework_assessment"
    register_type_value = f"Framework Assessment #{assessment.id}"

    risk = Risk(
        tenant_id=assessment.tenant_id,
        title=risk_title,
        description="\n".join(risk_description_parts),
        category=category_value,
        risk_category=category_value,
        risk_sub_category=assessment.name,
        register_type=register_type_value,
        owner_id=owner_id,
        inherent_likelihood=question.inherent_likelihood,
        inherent_impact=question.inherent_impact,
        inherent_score=question.inherent_score,
        residual_likelihood=question.residual_likelihood,
        residual_impact=question.residual_impact,
        residual_score=question.residual_score,
        treatment_plan=(data.treatment_plan or question.acceptance_notes),
        status="accepted",
    )
    db.add(risk)
    db.flush()

    question.linked_risk_id = risk.id
    question.moved_to_risk_register_at = datetime.utcnow()
    if question.status == "not_started":
        question.status = "completed"
    question.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(question)

    question = db.query(FrameworkRiskQuestion).options(
        joinedload(FrameworkRiskQuestion.assignee),
        joinedload(FrameworkRiskQuestion.evidence_uploads).joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(FrameworkRiskQuestion.id == question.id).first()

    return {
        "message": "Risk moved to risk register successfully",
        "risk_id": risk.id,
        "risk_title": risk.title,
        "register_type": register_type_value,
        "question": _serialize_question(question),
    }


@router.delete("/{assessment_id}/questions/{question_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_framework_question(
    assessment_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    question = _get_question_or_404(assessment_id, question_id, db)

    for evidence in question.evidence_uploads:
        _remove_file_if_not_in_repository(evidence.file_path, db)

    db.delete(question)
    db.commit()
    return None


@router.post("/{assessment_id}/questions/{question_id}/evidence", status_code=status.HTTP_201_CREATED)
async def upload_question_evidence(
    assessment_id: int,
    question_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    assessment = _get_assessment_or_404(assessment_id, user_tenants, db)
    question = _get_question_or_404(assessment_id, question_id, db)

    file_ext = os.path.splitext(file.filename or "")[1]
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_filename)

    try:
        with open(file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        file_size = len(content)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to save file: {str(e)}")

    evidence = FrameworkRiskQuestionEvidence(
        question_id=question.id,
        file_name=file.filename or "uploaded_file",
        file_path=file_path,
        file_size=file_size,
        mime_type=file.content_type,
        description=description,
        uploaded_by=current_user.id,
    )
    db.add(evidence)

    repo_evidence = Evidence(
        tenant_id=assessment.tenant_id,
        name=file.filename or "Framework risk evidence",
        description=(
            description
            or f"Evidence uploaded for framework risk assessment '{assessment.name}', question #{question.order_index}"
        ),
        file_path=file_path,
        file_name=file.filename or "uploaded_file",
        file_type=file.content_type,
        uploaded_by=current_user.id,
        status="draft",
        evidence_type="document",
        source_system="ERM Framework Risk Assessment",
    )
    db.add(repo_evidence)

    db.commit()
    db.refresh(evidence)

    evidence = db.query(FrameworkRiskQuestionEvidence).options(
        joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(FrameworkRiskQuestionEvidence.id == evidence.id).first()

    return _serialize_evidence(evidence)


@router.get("/{assessment_id}/questions/{question_id}/evidence")
def list_question_evidence(
    assessment_id: int,
    question_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)
    _get_question_or_404(assessment_id, question_id, db)

    evidence = db.query(FrameworkRiskQuestionEvidence).options(
        joinedload(FrameworkRiskQuestionEvidence.uploader)
    ).filter(FrameworkRiskQuestionEvidence.question_id == question_id).order_by(
        FrameworkRiskQuestionEvidence.uploaded_at.desc()
    ).all()

    return {
        "question_id": question_id,
        "items": [_serialize_evidence(e) for e in evidence]
    }


@router.delete("/{assessment_id}/evidence/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_question_evidence(
    assessment_id: int,
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    _get_assessment_or_404(assessment_id, user_tenants, db)

    evidence = db.query(FrameworkRiskQuestionEvidence).options(
        joinedload(FrameworkRiskQuestionEvidence.question)
    ).filter(
        FrameworkRiskQuestionEvidence.id == evidence_id
    ).first()

    if not evidence or evidence.question.assessment_id != assessment_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")

    _remove_file_if_not_in_repository(evidence.file_path, db)

    db.delete(evidence)
    db.commit()
    return None
