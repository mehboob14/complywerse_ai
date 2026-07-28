from ....config import get_openai_model
from typing import Any, List, Optional
from datetime import datetime, timezone, timedelta
import json

from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

try:
    from openai import OpenAI
    client = OpenAI()
except Exception:
    client = None

from ....models import (
    RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
    GovernanceDocument, NormalizedControl, Framework, GRCUser, Tenant, AuditLog, UserRole, Role, get_db
)
from ....schemas import (
    RegulatoryChangeCreate, RegulatoryChangeUpdate, RegulatoryChangeResponse,
    RegulatoryImpactAssessmentCreate, RegulatoryImpactAssessmentResponse,
    RegulatoryImplementationTaskCreate, RegulatoryImplementationTaskUpdate,
    RegulatoryImplementationTaskResponse, RegulatoryChangeDashboardStats,
    RegulatoryGapAnalysisResponse, MessageResponse,
    RegulatoryChangeClosureReadinessResponse, RegulatoryChangeCloseResponse,
    IncompleteTaskDetail
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/regulatory-changes", tags=["Governance - Regulatory Change Management"])


def normalize_optional_datetime(value: Any, field_name: str) -> Optional[datetime]:
    """Normalize optional datetime inputs, accepting datetime or ISO strings (including empty strings)."""
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid {field_name}. Use ISO 8601 date/datetime format."
            )
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid {field_name}. Expected datetime or ISO date string."
    )


def split_legacy_recommendations(impact_description: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """Split legacy recommendations encoded inside impact_description."""
    if not impact_description:
        return None, None

    marker = "\n\nRecommendations:"
    if marker in impact_description:
        areas, recs = impact_description.split(marker, 1)
        return areas.strip() or None, recs.strip() or None

    if impact_description.startswith("Recommendations:"):
        return None, impact_description.replace("Recommendations:", "", 1).strip() or None

    return impact_description, None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def check_user_has_admin_access(user: GRCUser, tenant_id: int, db: Session) -> bool:
    """Check if user has admin-level access for the given tenant."""
    admin_role_names = ["admin", "grc_admin", "administrator", "super_admin", "tenant_admin"]
    user_roles = db.query(UserRole).join(Role).filter(
        UserRole.user_id == user.id,
        UserRole.tenant_id == tenant_id
    ).all()
    for user_role in user_roles:
        if user_role.role and user_role.role.name.lower() in admin_role_names:
            return True
    return False


def can_close_regulatory_change(user: GRCUser, change: RegulatoryChange, db: Session) -> bool:
    """Check if user has permission to close the regulatory change."""
    if change.created_by == user.id:
        return True
    if change.assigned_to == user.id:
        return True
    if check_user_has_admin_access(user, change.tenant_id, db):
        return True
    return False


def create_audit_log_entry(
    db: Session,
    tenant_id: int,
    user_id: int,
    action: str,
    resource_type: str,
    resource_id: int,
    changes: dict = None,
    ip_address: str = None
) -> AuditLog:
    """Create an audit log entry for tracking actions."""
    audit_log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        changes=changes or {},
        ip_address=ip_address,
        timestamp=datetime.utcnow()
    )
    db.add(audit_log)
    return audit_log


def serialize_regulatory_change(change: RegulatoryChange) -> RegulatoryChangeResponse:
    completed_tasks = sum(1 for t in change.implementation_tasks if t.status == "completed")
    gap_count = sum(1 for a in change.impact_assessments if a.gap_identified)
    return RegulatoryChangeResponse(
        id=change.id,
        tenant_id=change.tenant_id,
        title=change.title,
        description=change.description,
        source=change.source,
        regulation_reference=change.regulation_reference,
        reference_number=change.regulation_reference,
        effective_date=change.effective_date,
        published_date=change.published_date,
        publication_date=change.published_date,
        status=change.status,
        priority=change.priority,
        regulatory_body=None,
        impact_summary=None,
        gap_count=gap_count,
        assigned_to=change.assigned_to,
        assignee_name=change.assignee.display_name if change.assignee else None,
        created_by=change.created_by,
        creator_name=change.creator.display_name if change.creator else None,
        created_at=change.created_at,
        updated_at=change.updated_at,
        closed_at=change.closed_at,
        closed_by=change.closed_by,
        closed_by_name=change.closer.display_name if change.closer else None,
        assessment_count=len(change.impact_assessments),
        task_count=len(change.implementation_tasks),
        completed_task_count=completed_tasks
    )


def serialize_impact_assessment(assessment: RegulatoryImpactAssessment, db: Session) -> RegulatoryImpactAssessmentResponse:
    impacted_item_name = None
    if assessment.impacted_item_type == "policy" and assessment.impacted_item_id:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == assessment.impacted_item_id).first()
        impacted_item_name = doc.title if doc else None
    elif assessment.impacted_item_type == "control" and assessment.impacted_item_id:
        ctrl = db.query(NormalizedControl).filter(NormalizedControl.id == assessment.impacted_item_id).first()
        impacted_item_name = ctrl.name if ctrl else None

    affected_areas, recommendations = split_legacy_recommendations(assessment.impact_description)
    
    return RegulatoryImpactAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        regulatory_change_id=assessment.regulatory_change_id,
        change_id=assessment.regulatory_change_id,
        assessment_type=assessment.assessment_type,
        impacted_item_id=assessment.impacted_item_id,
        impacted_item_type=assessment.impacted_item_type,
        impacted_item_name=impacted_item_name,
        impact_level=assessment.impact_level,
        impact_description=assessment.impact_description,
        affected_areas=affected_areas,
        gap_identified=assessment.gap_identified,
        gap_description=assessment.gap_description,
        compliance_gaps=assessment.gap_description,
        recommendations=recommendations,
        assessed_by=assessment.assessed_by,
        assessor_id=assessment.assessed_by,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assessed_at=assessment.assessed_at,
        assessment_date=assessment.assessed_at,
        status="completed"
    )


def serialize_implementation_task(task: RegulatoryImplementationTask) -> RegulatoryImplementationTaskResponse:
    is_overdue = False
    if task.due_date and task.status not in ["completed", "blocked"]:
        is_overdue = task.due_date < datetime.utcnow()
    
    return RegulatoryImplementationTaskResponse(
        id=task.id,
        tenant_id=task.tenant_id,
        regulatory_change_id=task.regulatory_change_id,
        impact_assessment_id=task.impact_assessment_id,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        status=task.status,
        priority=task.priority,
        assigned_to=task.assigned_to,
        assignee_name=task.assignee.display_name if task.assignee else None,
        assignee_department=task.assignee.department if task.assignee else None,
        due_date=task.due_date,
        completed_at=task.completed_at,
        linked_policy_id=task.linked_policy_id,
        linked_policy_title=task.linked_policy.title if task.linked_policy else None,
        linked_control_id=task.linked_control_id,
        linked_control_name=task.linked_control.name if task.linked_control else None,
        created_by=task.created_by,
        creator_name=task.creator.display_name if task.creator else None,
        created_at=task.created_at,
        updated_at=task.updated_at,
        is_overdue=is_overdue
    )


# =============================================================================
# Regulatory Changes CRUD Endpoints
# =============================================================================

@router.get("/changes", response_model=List[RegulatoryChangeResponse])
def list_regulatory_changes(
    tenant_id: Optional[int] = None,
    source: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.assignee),
        joinedload(RegulatoryChange.creator),
        joinedload(RegulatoryChange.impact_assessments),
        joinedload(RegulatoryChange.implementation_tasks)
    ).filter(RegulatoryChange.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(RegulatoryChange.tenant_id == tenant_id)
    if source:
        query = query.filter(RegulatoryChange.source == source)
    if status:
        query = query.filter(RegulatoryChange.status == status)
    if priority:
        query = query.filter(RegulatoryChange.priority == priority)
    if assigned_to:
        query = query.filter(RegulatoryChange.assigned_to == assigned_to)
    if search:
        search_filter = or_(
            RegulatoryChange.title.ilike(f"%{search}%"),
            RegulatoryChange.description.ilike(f"%{search}%"),
            RegulatoryChange.regulation_reference.ilike(f"%{search}%")
        )
        query = query.filter(search_filter)
    
    changes = query.order_by(RegulatoryChange.created_at.desc()).offset(skip).limit(limit).all()
    return [serialize_regulatory_change(c) for c in changes]


@router.get("/changes/{change_id}", response_model=RegulatoryChangeResponse)
def get_regulatory_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.assignee),
        joinedload(RegulatoryChange.creator),
        joinedload(RegulatoryChange.impact_assessments),
        joinedload(RegulatoryChange.implementation_tasks)
    ).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    return serialize_regulatory_change(change)


@router.post("/changes", response_model=RegulatoryChangeResponse, status_code=status.HTTP_201_CREATED)
def create_regulatory_change(
    change: RegulatoryChangeCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    source = (change.source or "custom").strip() if isinstance(change.source, str) else "custom"
    status_value = (change.status or "identified").strip() if isinstance(change.status, str) else "identified"
    priority_value = (change.priority or "medium").strip() if isinstance(change.priority, str) else "medium"

    effective_date = normalize_optional_datetime(change.effective_date, "effective_date")
    published_date_raw = change.published_date if change.published_date is not None else change.publication_date
    published_date = normalize_optional_datetime(published_date_raw, "published_date")
    regulation_reference = change.regulation_reference or change.reference_number

    valid_sources = ["OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "SBP", "custom"]
    if source not in valid_sources:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source. Must be one of: {', '.join(valid_sources)}"
        )
    
    valid_statuses = ["identified", "under_assessment", "implementation", "completed", "closed", "not_applicable"]
    if status_value not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )
    
    valid_priorities = ["critical", "high", "medium", "low"]
    if priority_value not in valid_priorities:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
        )
    
    db_change = RegulatoryChange(
        tenant_id=tenant_id,
        title=change.title,
        description=change.description,
        source=source,
        regulation_reference=regulation_reference,
        effective_date=effective_date,
        published_date=published_date,
        status=status_value,
        priority=priority_value,
        assigned_to=change.assigned_to,
        created_by=current_user.id
    )
    
    db.add(db_change)
    db.commit()
    db.refresh(db_change)
    
    return serialize_regulatory_change(db_change)


@router.post("/changes/upload", response_model=RegulatoryChangeResponse, status_code=status.HTTP_201_CREATED)
def upload_regulatory_change_document(
    file: UploadFile = File(...),
    source: Optional[str] = Form("custom"),  # OCC, Fed, EBA, PRA, SEC, FINRA, SBP, custom
    title_hint: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """
    Upload a regulatory document (PDF/DOCX/DOC) and run AI extraction:
    - extract requirements (summary + priority + effective date)
    - map impacted policies + impacted controls to our platform records
    - generate implementation recommendations (implementation tasks)
    - for SBP (State Bank of Pakistan) circulars, produce banking-sector impact analysis
    """
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")

    # Only allow types we can extract text from synchronously.
    filename = file.filename or "regulatory_document"
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext in {"pdf"}:
        file_type = "pdf"
    elif ext in {"docx"}:
        file_type = "docx"
    elif ext in {"doc"}:
        file_type = "doc"
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported file type. Use PDF or Word (.doc/.docx).")

    try:
        from tempfile import NamedTemporaryFile
        from .policy_parser import extract_text_from_file
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Text extraction deps unavailable: {str(e)}")

    contents = file.file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    with NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        extracted_text = extract_text_from_file(tmp_path, file_type)
    finally:
        try:
            import os
            os.remove(tmp_path)
        except Exception:
            pass

    content_text = extracted_text or ""
    if not content_text.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Could not extract text from the uploaded document.")

    # Truncate aggressively to fit prompt budgets.
    if len(content_text) > 12000:
        content_text = content_text[:12000] + "\n\n...[truncated]"

    # Resolve source + priority defaults.
    source_value = (source or "custom").strip() if isinstance(source, str) else "custom"
    source_aliases = {
        "sbp": "SBP",
        "state bank": "SBP",
        "state bank of pakistan": "SBP",
        "state_bank": "SBP",
    }
    source_value = source_aliases.get(source_value.lower(), source_value)
    valid_sources = ["OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "SBP", "custom"]
    if source_value not in valid_sources:
        source_value = "custom"

    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    controls = db.query(NormalizedControl).all()
    policies = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == tenant_id,
        GovernanceDocument.doc_type == "policy",
        GovernanceDocument.status.in_(["approved", "published"]),
    ).all()

    frameworks_text = "\n".join([f"- {fw.name} ({fw.short_code}): {fw.description or 'No description'}" for fw in frameworks]) if frameworks else "No frameworks registered"
    controls_text = "\n".join([f"- {ctrl.code}: {ctrl.name}" for ctrl in controls[:120]]) if controls else "No controls registered"
    policies_text = "\n".join([f"- {pol.title}" for pol in policies[:120]]) if policies else "No policies registered"

    sbp_context = ""
    if source_value == "SBP":
        sbp_context = """
This document is a State Bank of Pakistan (SBP) circular / prudential regulation.
Focus impact on Pakistani banks / DFIs / MFBs / payment institutions as applicable:
capital, liquidity, credit risk, AML/CFT, cybersecurity, digital banking, outsourcing,
consumer protection, and regulatory reporting. Call out deadlines, reporting duties,
and board/management accountability when present. Write a clear operational impact narrative.
"""

    prompt = f"""You are a Senior GRC Compliance Expert.
Analyze the uploaded regulatory document and produce a platform-aware compliance impact result.
{sbp_context}
Extract (from the text):
1) Key requirements summary
2) Priority and estimated effective date
3) Impacted policies (by exact policy title when possible)
4) Impacted controls using our NormalizedControl.code values
5) Compliance gaps (what is missing or needs to change)
6) Implementation tasks / recommendations to remediate
7) Overall organizational impact

Return ONLY valid JSON in this exact schema:
{{
  "title": "string (short regulation title; use title_hint when provided)",
  "summary": "string",
  "priority": "critical|high|medium|low",
  "effective_date_estimate": "YYYY-MM-DD or null",
  "impact_overview": "string (2-4 sentences on business / compliance impact)",
  "impacted_policies": [{{"title": "policy title", "action_needed": "review|update|create_new"}}],
  "impacted_controls": [{{"id": "NormalizedControl.code", "name": "control name", "gap_type": "new_requirement|modification|obsolete", "action_needed": "description"}}],
  "implementation_tasks": [
    {{
      "title": "task title",
      "description": "task description",
      "priority": "critical|high|medium|low",
      "suggested_deadline_days": 30,
      "task_tags": ["policy_update|control_update|process_change|training|communication"]
    }}
  ],
  "compliance_gaps": ["gap strings"],
  "recommendations": ["recommendation strings"]
}}

The returned impacted_controls.id MUST be values from NormalizedControl.code whenever possible.
If you are unsure, still provide the best-matching codes from the platform text you see above.

TEXT:
{content_text}

PLATFORM CONTEXT (used to map ids):
EXISTING FRAMEWORKS:
{frameworks_text}

EXISTING CONTROLS (sample; you must map by code):
{controls_text}

EXISTING POLICIES (sample):
{policies_text}
"""

    if not client:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OpenAI client not configured.")

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a compliance assistant. Respond only with valid JSON."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=4500,
            response_format={"type": "json_object"},
        )
        response_text = response.choices[0].message.content.strip()
        analysis = json.loads(response_text)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"AI extraction failed: {str(e)}")

    ai_title = (analysis.get("title") or title_hint or filename).strip()
    ai_summary = analysis.get("summary") or ""
    impact_overview = (analysis.get("impact_overview") or "").strip()
    if impact_overview:
        ai_summary = f"{ai_summary}\n\nImpact assessment:\n{impact_overview}".strip() if ai_summary else f"Impact assessment:\n{impact_overview}"
    ai_priority = (analysis.get("priority") or "medium").strip()
    if ai_priority not in ["critical", "high", "medium", "low"]:
        ai_priority = "medium"
    eff_str = analysis.get("effective_date_estimate")
    effective_date = None
    if isinstance(eff_str, str) and eff_str.strip() and eff_str.strip().lower() != "null":
        try:
            effective_date = datetime.strptime(eff_str.strip(), "%Y-%m-%d")
        except Exception:
            effective_date = None

    # Resolve control + policy ids for impacted items.
    controls_by_code = {str(c.code).strip().lower(): c for c in controls}

    def resolve_control(code: Optional[str], name: Optional[str]) -> Optional[NormalizedControl]:
        key = (code or "").strip().lower()
        if key and key in controls_by_code:
            return controls_by_code[key]
        nkey = (name or "").strip().lower()
        if nkey:
            # fallback: substring match on code or name
            for c in controls:
                if (str(c.code).lower() == nkey) or (nkey in str(c.name).lower()) or (nkey in str(c.code).lower()):
                    return c
        return None

    policies_by_title = {str(p.title).strip().lower(): p for p in policies}

    def resolve_policy(title: Optional[str]) -> Optional[GovernanceDocument]:
        tkey = (title or "").strip().lower()
        if tkey and tkey in policies_by_title:
            return policies_by_title[tkey]
        if tkey:
            for p in policies:
                if tkey in str(p.title).lower():
                    return p
        return None

    db_change = RegulatoryChange(
        tenant_id=tenant_id,
        title=ai_title,
        description=ai_summary,
        source=source_value,
        regulation_reference=None,
        effective_date=effective_date,
        published_date=None,
        status="identified",
        priority=ai_priority,
        created_by=current_user.id,
        assigned_to=None,
    )
    db.add(db_change)
    db.flush()

    policy_assessments_by_key: dict[str, RegulatoryImpactAssessment] = {}
    control_assessments_by_code: dict[str, RegulatoryImpactAssessment] = {}

    for pol_impact in (analysis.get("impacted_policies") or []):
        pol_title = pol_impact.get("title")
        action_needed = pol_impact.get("action_needed") or "review"
        gap_identified = action_needed in ["update", "create_new"]
        impacted_policy = resolve_policy(pol_title)
        impacted_item_id = impacted_policy.id if impacted_policy else None

        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=db_change.id,
            assessment_type="policy",
            impacted_item_type="policy",
            impacted_item_id=impacted_item_id,
            impact_level="medium",
            impact_description=f"Policy '{pol_title}' requires {action_needed}",
            gap_identified=gap_identified,
            gap_description=f"Action needed: {action_needed}" if gap_identified else None,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow(),
        )
        db.add(impact_assessment)
        db.flush()
        if pol_title:
            policy_assessments_by_key[str(pol_title).strip().lower()] = impact_assessment

    for ctrl_impact in (analysis.get("impacted_controls") or []):
        ctrl_code = ctrl_impact.get("id")
        ctrl_name = ctrl_impact.get("name")
        gap_type = ctrl_impact.get("gap_type") or "modification"
        action_needed = ctrl_impact.get("action_needed") or ""

        impacted_control = resolve_control(ctrl_code, ctrl_name)
        impacted_item_id = impacted_control.id if impacted_control else None

        gap_identified = gap_type in ["new_requirement", "modification"]
        impact_level = "high" if gap_type == "new_requirement" else "medium"
        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=db_change.id,
            assessment_type="control",
            impacted_item_type="control",
            impacted_item_id=impacted_item_id,
            impact_level=impact_level,
            impact_description=f"Control '{ctrl_code}: {ctrl_name}' - {gap_type}",
            gap_identified=gap_identified,
            gap_description=action_needed if gap_identified else None,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow(),
        )
        db.add(impact_assessment)
        db.flush()
        if ctrl_code:
            control_assessments_by_code[str(ctrl_code).strip().lower()] = impact_assessment

    # Create implementation tasks from AI recommendations.
    implementation_tasks = analysis.get("implementation_tasks") or []
    now = datetime.utcnow()
    for task_data in implementation_tasks:
        task_title = (task_data.get("title") or "Implementation Task").strip()
        task_description = task_data.get("description") or ""
        task_priority = (task_data.get("priority") or "medium").strip()
        if task_priority not in ["critical", "high", "medium", "low"]:
            task_priority = "medium"
        deadline_days = task_data.get("suggested_deadline_days") or 30
        try:
            deadline_days_int = int(deadline_days)
        except Exception:
            deadline_days_int = 30
        due_date = now + timedelta(days=deadline_days_int)

        # Determine task_type.
        task_type = "process_change"
        lower = task_title.lower()
        if "policy" in lower:
            task_type = "policy_update"
        elif "control" in lower:
            task_type = "control_update"
        elif "training" in lower:
            task_type = "training"
        elif "communication" in lower or "notify" in lower:
            task_type = "communication"

        # Best-effort impact_assessment link via title keywords.
        impact_assessment_id = None
        if task_type == "control_update":
            # if AI used control codes in the title, match them.
            for code_key, a in control_assessments_by_code.items():
                if code_key and code_key in lower:
                    impact_assessment_id = a.id
                    break
        elif task_type == "policy_update":
            for title_key, a in policy_assessments_by_key.items():
                if title_key and title_key in lower:
                    impact_assessment_id = a.id
                    break

        db_task = RegulatoryImplementationTask(
            tenant_id=tenant_id,
            regulatory_change_id=db_change.id,
            impact_assessment_id=impact_assessment_id,
            title=task_title,
            description=task_description,
            task_type=task_type,
            status="pending",
            priority=task_priority,
            assigned_to=None,
            due_date=due_date,
            linked_policy_id=None,
            linked_control_id=None,
            created_by=current_user.id,
        )
        db.add(db_task)

    db_change.status = "under_assessment"
    if (analysis.get("implementation_tasks") or []):
        db_change.status = "implementation"

    db.commit()
    db.refresh(db_change)

    return serialize_regulatory_change(db_change)


@router.put("/changes/{change_id}", response_model=RegulatoryChangeResponse)
def update_regulatory_change(
    change_id: int,
    change: RegulatoryChangeUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    update_data = change.model_dump(exclude_unset=True)

    if "reference_number" in update_data and not update_data.get("regulation_reference"):
        update_data["regulation_reference"] = update_data.get("reference_number")
    if "publication_date" in update_data and "published_date" not in update_data:
        update_data["published_date"] = update_data.get("publication_date")

    if "effective_date" in update_data:
        update_data["effective_date"] = normalize_optional_datetime(update_data.get("effective_date"), "effective_date")
    if "published_date" in update_data:
        update_data["published_date"] = normalize_optional_datetime(update_data.get("published_date"), "published_date")

    if "source" in update_data:
        source_value = update_data.get("source")
        if isinstance(source_value, str):
            source_value = source_value.strip() or "custom"
            update_data["source"] = source_value
        valid_sources = ["OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "SBP", "custom"]
        if source_value not in valid_sources:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid source. Must be one of: {', '.join(valid_sources)}"
            )
    
    if "status" in update_data:
        status_value = update_data.get("status")
        if isinstance(status_value, str):
            status_value = status_value.strip()
            update_data["status"] = status_value
        valid_statuses = ["identified", "under_assessment", "implementation", "completed", "closed", "not_applicable"]
        if status_value not in valid_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            )
    
    if "priority" in update_data:
        priority_value = update_data.get("priority")
        if isinstance(priority_value, str):
            priority_value = priority_value.strip()
            update_data["priority"] = priority_value
        valid_priorities = ["critical", "high", "medium", "low"]
        if priority_value not in valid_priorities:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
            )

    # Remove non-model legacy aliases that should not be persisted directly.
    update_data.pop("reference_number", None)
    update_data.pop("publication_date", None)
    update_data.pop("regulatory_body", None)
    update_data.pop("impact_summary", None)

    for key, value in update_data.items():
        if hasattr(RegulatoryChange, key):
            setattr(db_change, key, value)
    
    db.commit()
    db.refresh(db_change)
    
    db_change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.assignee),
        joinedload(RegulatoryChange.creator),
        joinedload(RegulatoryChange.impact_assessments),
        joinedload(RegulatoryChange.implementation_tasks)
    ).filter(RegulatoryChange.id == change_id).first()
    
    return serialize_regulatory_change(db_change)


@router.delete("/changes/{change_id}", response_model=MessageResponse)
def delete_regulatory_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    db.delete(db_change)
    db.commit()
    
    return MessageResponse(message="Regulatory change deleted successfully")


# =============================================================================
# Impact Assessment Endpoints
# =============================================================================

@router.get("/changes/{change_id}/assessments", response_model=List[RegulatoryImpactAssessmentResponse])
def list_impact_assessments(
    change_id: int,
    assessment_type: Optional[str] = None,
    impact_level: Optional[str] = None,
    gap_identified: Optional[bool] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    query = db.query(RegulatoryImpactAssessment).options(
        joinedload(RegulatoryImpactAssessment.assessor)
    ).filter(RegulatoryImpactAssessment.regulatory_change_id == change_id)
    
    if assessment_type:
        query = query.filter(RegulatoryImpactAssessment.assessment_type == assessment_type)
    if impact_level:
        query = query.filter(RegulatoryImpactAssessment.impact_level == impact_level)
    if gap_identified is not None:
        query = query.filter(RegulatoryImpactAssessment.gap_identified == gap_identified)
    
    assessments = query.order_by(RegulatoryImpactAssessment.assessed_at.desc()).all()
    return [serialize_impact_assessment(a, db) for a in assessments]


@router.post("/changes/{change_id}/assessments", response_model=RegulatoryImpactAssessmentResponse, status_code=status.HTTP_201_CREATED)
def create_impact_assessment(
    change_id: int,
    assessment: RegulatoryImpactAssessmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    assessment_type = (assessment.assessment_type or "process").strip() if isinstance(assessment.assessment_type, str) else "process"
    valid_types = ["policy", "control", "process", "technology"]
    if assessment_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid assessment_type. Must be one of: {', '.join(valid_types)}"
        )

    impact_level = (assessment.impact_level or "medium").strip().lower() if isinstance(assessment.impact_level, str) else "medium"
    valid_levels = ["critical", "high", "medium", "low", "none"]
    if impact_level not in valid_levels:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid impact_level. Must be one of: {', '.join(valid_levels)}"
        )

    if assessment.impacted_item_type and assessment.impacted_item_type not in ["policy", "control", "asset", "process"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid impacted_item_type. Must be one of: policy, control, asset, process"
        )

    impact_description = assessment.impact_description or assessment.affected_areas
    recommendations = (assessment.recommendations or "").strip() if assessment.recommendations else ""
    if recommendations:
        if impact_description:
            impact_description = f"{impact_description}\n\nRecommendations: {recommendations}"
        else:
            impact_description = f"Recommendations: {recommendations}"

    gap_description = assessment.gap_description or assessment.compliance_gaps
    gap_identified = bool(assessment.gap_identified) or bool((gap_description or "").strip())
    assessed_at = normalize_optional_datetime(assessment.assessment_date, "assessment_date") or datetime.utcnow()
    
    db_assessment = RegulatoryImpactAssessment(
        tenant_id=change.tenant_id,
        regulatory_change_id=change_id,
        assessment_type=assessment_type,
        impacted_item_id=assessment.impacted_item_id,
        impacted_item_type=assessment.impacted_item_type,
        impact_level=impact_level,
        impact_description=impact_description,
        gap_identified=gap_identified,
        gap_description=gap_description,
        assessed_by=current_user.id,
        assessed_at=assessed_at
    )
    
    db.add(db_assessment)
    
    if change.status == "identified":
        change.status = "under_assessment"
    
    db.commit()
    db.refresh(db_assessment)
    
    return serialize_impact_assessment(db_assessment, db)


# =============================================================================
# Implementation Task Endpoints
# =============================================================================

@router.get("/changes/{change_id}/tasks", response_model=List[RegulatoryImplementationTaskResponse])
def list_implementation_tasks(
    change_id: int,
    task_type: Optional[str] = None,
    status: Optional[str] = None,
    priority: Optional[str] = None,
    assigned_to: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    query = db.query(RegulatoryImplementationTask).options(
        joinedload(RegulatoryImplementationTask.assignee),
        joinedload(RegulatoryImplementationTask.creator),
        joinedload(RegulatoryImplementationTask.linked_policy),
        joinedload(RegulatoryImplementationTask.linked_control)
    ).filter(RegulatoryImplementationTask.regulatory_change_id == change_id)
    
    if task_type:
        query = query.filter(RegulatoryImplementationTask.task_type == task_type)
    if status:
        query = query.filter(RegulatoryImplementationTask.status == status)
    if priority:
        query = query.filter(RegulatoryImplementationTask.priority == priority)
    if assigned_to:
        query = query.filter(RegulatoryImplementationTask.assigned_to == assigned_to)
    
    tasks = query.order_by(RegulatoryImplementationTask.due_date.asc().nullslast()).all()
    return [serialize_implementation_task(t) for t in tasks]


@router.post("/changes/{change_id}/tasks", response_model=RegulatoryImplementationTaskResponse, status_code=status.HTTP_201_CREATED)
def create_implementation_task(
    change_id: int,
    task: RegulatoryImplementationTaskCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    valid_types = ["policy_update", "control_update", "process_change", "training", "communication"]
    if task.task_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task_type. Must be one of: {', '.join(valid_types)}"
        )
    
    valid_priorities = ["critical", "high", "medium", "low"]
    if task.priority not in valid_priorities:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
        )
    
    if task.impact_assessment_id:
        assessment = db.query(RegulatoryImpactAssessment).filter(
            RegulatoryImpactAssessment.id == task.impact_assessment_id,
            RegulatoryImpactAssessment.regulatory_change_id == change_id
        ).first()
        if not assessment:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid impact_assessment_id"
            )
    
    db_task = RegulatoryImplementationTask(
        tenant_id=change.tenant_id,
        regulatory_change_id=change_id,
        impact_assessment_id=task.impact_assessment_id,
        title=task.title,
        description=task.description,
        task_type=task.task_type,
        status="pending",
        priority=task.priority,
        assigned_to=task.assigned_to,
        due_date=task.due_date,
        linked_policy_id=task.linked_policy_id,
        linked_control_id=task.linked_control_id,
        created_by=current_user.id
    )
    
    db.add(db_task)
    
    if change.status in ["identified", "under_assessment"]:
        change.status = "implementation"
    
    db.commit()
    db.refresh(db_task)
    
    db_task = db.query(RegulatoryImplementationTask).options(
        joinedload(RegulatoryImplementationTask.assignee),
        joinedload(RegulatoryImplementationTask.creator),
        joinedload(RegulatoryImplementationTask.linked_policy),
        joinedload(RegulatoryImplementationTask.linked_control)
    ).filter(RegulatoryImplementationTask.id == db_task.id).first()
    
    return serialize_implementation_task(db_task)


@router.patch("/tasks/{task_id}", response_model=RegulatoryImplementationTaskResponse)
def update_implementation_task(
    task_id: int,
    task: RegulatoryImplementationTaskUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_task = db.query(RegulatoryImplementationTask).filter(
        RegulatoryImplementationTask.id == task_id,
        RegulatoryImplementationTask.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    
    update_data = task.model_dump(exclude_unset=True)
    
    if "task_type" in update_data:
        valid_types = ["policy_update", "control_update", "process_change", "training", "communication"]
        if update_data["task_type"] not in valid_types:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid task_type. Must be one of: {', '.join(valid_types)}"
            )
    
    if "status" in update_data:
        valid_statuses = ["pending", "in_progress", "completed", "blocked"]
        if update_data["status"] not in valid_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            )
        if update_data["status"] == "completed" and db_task.status != "completed":
            update_data["completed_at"] = datetime.utcnow()
    
    if "priority" in update_data:
        valid_priorities = ["critical", "high", "medium", "low"]
        if update_data["priority"] not in valid_priorities:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
            )
    
    for key, value in update_data.items():
        setattr(db_task, key, value)
    
    db.commit()
    db.refresh(db_task)
    
    db_task = db.query(RegulatoryImplementationTask).options(
        joinedload(RegulatoryImplementationTask.assignee),
        joinedload(RegulatoryImplementationTask.creator),
        joinedload(RegulatoryImplementationTask.linked_policy),
        joinedload(RegulatoryImplementationTask.linked_control)
    ).filter(RegulatoryImplementationTask.id == task_id).first()
    
    return serialize_implementation_task(db_task)


@router.delete("/tasks/{task_id}", response_model=MessageResponse)
def delete_implementation_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    db_task = db.query(RegulatoryImplementationTask).filter(
        RegulatoryImplementationTask.id == task_id,
        RegulatoryImplementationTask.tenant_id.in_(user_tenants)
    ).first()
    
    if not db_task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    
    db.delete(db_task)
    db.commit()
    
    return MessageResponse(message="Task deleted successfully")


# =============================================================================
# Dashboard Endpoint
# =============================================================================

@router.get("/dashboard", response_model=RegulatoryChangeDashboardStats)
def get_regulatory_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return RegulatoryChangeDashboardStats(
            total_changes=0, by_status={}, by_priority={}, by_source={},
            total_assessments=0, assessments_with_gaps=0, total_tasks=0,
            pending_tasks=0, in_progress_tasks=0, completed_tasks=0,
            blocked_tasks=0, overdue_tasks=0, upcoming_effective_dates=[],
            task_completion_rate=0.0
        )
    
    filter_tenants = user_tenants
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    
    total_changes = db.query(func.count(RegulatoryChange.id)).filter(
        RegulatoryChange.tenant_id.in_(filter_tenants)
    ).scalar() or 0
    
    status_counts = db.query(
        RegulatoryChange.status, func.count(RegulatoryChange.id)
    ).filter(
        RegulatoryChange.tenant_id.in_(filter_tenants)
    ).group_by(RegulatoryChange.status).all()
    by_status = {s: c for s, c in status_counts}
    
    priority_counts = db.query(
        RegulatoryChange.priority, func.count(RegulatoryChange.id)
    ).filter(
        RegulatoryChange.tenant_id.in_(filter_tenants)
    ).group_by(RegulatoryChange.priority).all()
    by_priority = {p: c for p, c in priority_counts}
    
    source_counts = db.query(
        RegulatoryChange.source, func.count(RegulatoryChange.id)
    ).filter(
        RegulatoryChange.tenant_id.in_(filter_tenants)
    ).group_by(RegulatoryChange.source).all()
    by_source = {s: c for s, c in source_counts}
    
    total_assessments = db.query(func.count(RegulatoryImpactAssessment.id)).filter(
        RegulatoryImpactAssessment.tenant_id.in_(filter_tenants)
    ).scalar() or 0
    
    assessments_with_gaps = db.query(func.count(RegulatoryImpactAssessment.id)).filter(
        RegulatoryImpactAssessment.tenant_id.in_(filter_tenants),
        RegulatoryImpactAssessment.gap_identified == True
    ).scalar() or 0
    
    total_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants)
    ).scalar() or 0
    
    pending_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants),
        RegulatoryImplementationTask.status == "pending"
    ).scalar() or 0
    
    in_progress_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants),
        RegulatoryImplementationTask.status == "in_progress"
    ).scalar() or 0
    
    completed_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants),
        RegulatoryImplementationTask.status == "completed"
    ).scalar() or 0
    
    blocked_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants),
        RegulatoryImplementationTask.status == "blocked"
    ).scalar() or 0
    
    overdue_tasks = db.query(func.count(RegulatoryImplementationTask.id)).filter(
        RegulatoryImplementationTask.tenant_id.in_(filter_tenants),
        RegulatoryImplementationTask.status.in_(["pending", "in_progress"]),
        RegulatoryImplementationTask.due_date < datetime.utcnow()
    ).scalar() or 0
    
    upcoming_changes = db.query(RegulatoryChange).filter(
        RegulatoryChange.tenant_id.in_(filter_tenants),
        RegulatoryChange.effective_date >= datetime.utcnow(),
        RegulatoryChange.status.in_(["identified", "under_assessment", "implementation"])
    ).order_by(RegulatoryChange.effective_date.asc()).limit(10).all()
    
    upcoming_effective_dates = [
        {
            "id": c.id,
            "title": c.title,
            "effective_date": c.effective_date.isoformat() if c.effective_date else None,
            "status": c.status,
            "priority": c.priority
        }
        for c in upcoming_changes
    ]
    
    task_completion_rate = (completed_tasks / total_tasks * 100) if total_tasks > 0 else 0.0
    
    return RegulatoryChangeDashboardStats(
        total_changes=total_changes,
        by_status=by_status,
        by_priority=by_priority,
        by_source=by_source,
        total_assessments=total_assessments,
        assessments_with_gaps=assessments_with_gaps,
        total_tasks=total_tasks,
        pending_tasks=pending_tasks,
        in_progress_tasks=in_progress_tasks,
        completed_tasks=completed_tasks,
        blocked_tasks=blocked_tasks,
        overdue_tasks=overdue_tasks,
        upcoming_effective_dates=upcoming_effective_dates,
        task_completion_rate=round(task_completion_rate, 2)
    )


# =============================================================================
# AI Gap Analysis Endpoint
# =============================================================================

@router.get("/changes/{change_id}/gap-analysis", response_model=RegulatoryGapAnalysisResponse)
def get_gap_analysis(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.impact_assessments)
    ).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    policies = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == change.tenant_id,
        GovernanceDocument.status.in_(["approved", "published"])
    ).limit(50).all()
    
    controls = db.query(NormalizedControl).limit(50).all()
    
    policy_list = [{"id": p.id, "title": p.title, "type": p.doc_type} for p in policies]
    control_list = [{"id": c.id, "name": c.name, "code": c.code} for c in controls]
    
    existing_assessments = [
        {
            "type": a.assessment_type,
            "item_type": a.impacted_item_type,
            "item_id": a.impacted_item_id,
            "impact_level": a.impact_level,
            "gap_identified": a.gap_identified,
            "gap_description": a.gap_description
        }
        for a in change.impact_assessments
    ]
    
    if not client:
        return RegulatoryGapAnalysisResponse(
            regulatory_change_id=change.id,
            regulatory_change_title=change.title,
            analysis_summary="AI analysis unavailable. OpenAI client not configured.",
            impacted_policies=[],
            impacted_controls=[],
            identified_gaps=[],
            recommended_actions=["Configure OpenAI API to enable AI-powered gap analysis"],
            risk_level="unknown",
            confidence_score=0.0
        )
    
    prompt = f"""Analyze the following regulatory change and identify potential impacts on existing policies and controls.

Regulatory Change:
- Title: {change.title}
- Description: {change.description or 'Not provided'}
- Source: {change.source}
- Reference: {change.regulation_reference or 'Not provided'}
- Effective Date: {change.effective_date.isoformat() if change.effective_date else 'Not specified'}

Existing Policies (sample):
{json.dumps(policy_list[:20], indent=2)}

Existing Controls (sample):
{json.dumps(control_list[:20], indent=2)}

Existing Assessments:
{json.dumps(existing_assessments, indent=2)}

Provide a JSON response with the following structure:
{{
    "analysis_summary": "Brief summary of the regulatory change impact",
    "impacted_policies": [
        {{"id": <policy_id>, "title": "<title>", "impact_level": "high|medium|low", "reason": "<why impacted>"}}
    ],
    "impacted_controls": [
        {{"id": <control_id>, "name": "<name>", "impact_level": "high|medium|low", "reason": "<why impacted>"}}
    ],
    "identified_gaps": [
        {{"area": "<policy|control|process>", "description": "<gap description>", "severity": "critical|high|medium|low"}}
    ],
    "recommended_actions": ["<action 1>", "<action 2>"],
    "risk_level": "critical|high|medium|low",
    "confidence_score": 0.0-1.0
}}

Focus on regulatory compliance gaps and potential areas of non-compliance."""

    try:
        response = client.chat.completions.create(
            model=get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a regulatory compliance expert specializing in gap analysis. Provide structured JSON responses."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            response_format={"type": "json_object"}
        )
        
        result = json.loads(response.choices[0].message.content)
        
        return RegulatoryGapAnalysisResponse(
            regulatory_change_id=change.id,
            regulatory_change_title=change.title,
            analysis_summary=result.get("analysis_summary", "Analysis completed"),
            impacted_policies=result.get("impacted_policies", []),
            impacted_controls=result.get("impacted_controls", []),
            identified_gaps=result.get("identified_gaps", []),
            recommended_actions=result.get("recommended_actions", []),
            risk_level=result.get("risk_level", "medium"),
            confidence_score=result.get("confidence_score", 0.7)
        )
        
    except Exception as e:
        return RegulatoryGapAnalysisResponse(
            regulatory_change_id=change.id,
            regulatory_change_title=change.title,
            analysis_summary=f"AI analysis encountered an error: {str(e)}",
            impacted_policies=[],
            impacted_controls=[],
            identified_gaps=[],
            recommended_actions=["Review the regulatory change manually", "Consult with compliance team"],
            risk_level="unknown",
            confidence_score=0.0
        )


# =============================================================================
# Closure Readiness and Close Endpoints
# =============================================================================

@router.get("/changes/{change_id}/closure-readiness", response_model=RegulatoryChangeClosureReadinessResponse)
def get_closure_readiness(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Check if all implementation tasks are completed and the regulatory change is ready to close."""
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.implementation_tasks).joinedload(RegulatoryImplementationTask.assignee)
    ).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    total_tasks = len(change.implementation_tasks)
    completed_tasks = sum(1 for t in change.implementation_tasks if t.status == "completed")
    
    incomplete_tasks = [
        IncompleteTaskDetail(
            id=task.id,
            title=task.title,
            status=task.status,
            assignee_id=task.assigned_to,
            assignee_name=task.assignee.display_name if task.assignee else None
        )
        for task in change.implementation_tasks
        if task.status != "completed"
    ]
    
    ready_to_close = total_tasks > 0 and completed_tasks == total_tasks
    
    return RegulatoryChangeClosureReadinessResponse(
        ready_to_close=ready_to_close,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        incomplete_tasks=incomplete_tasks
    )


@router.post("/changes/{change_id}/close", response_model=RegulatoryChangeCloseResponse)
def close_regulatory_change(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Close a regulatory change after validating status, permissions, and task completion."""
    user_tenants = get_user_tenants(current_user, db)
    
    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.assignee),
        joinedload(RegulatoryChange.creator),
        joinedload(RegulatoryChange.closer),
        joinedload(RegulatoryChange.impact_assessments),
        joinedload(RegulatoryChange.implementation_tasks).joinedload(RegulatoryImplementationTask.assignee)
    ).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()
    
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")
    
    allowed_statuses_for_close = ["under_assessment", "implementation", "completed"]
    invalid_statuses = ["closed", "identified", "not_applicable"]
    
    if change.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Regulatory change is already closed"
        )
    
    if change.status == "identified":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot close regulatory change from status '{change.status}'. The change must be in one of the following statuses before closing: {', '.join(allowed_statuses_for_close)}. The change needs to progress through assessment or implementation first."
        )
    
    if change.status == "not_applicable":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot close regulatory change from status '{change.status}'. Changes marked as 'not_applicable' cannot be closed. To close this change, first update its status to one of: {', '.join(allowed_statuses_for_close)}."
        )
    
    if change.status not in allowed_statuses_for_close:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status transition. Cannot close regulatory change from status '{change.status}'. Allowed statuses for closing are: {', '.join(allowed_statuses_for_close)}."
        )
    
    if not can_close_regulatory_change(current_user, change, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to close this regulatory change. Only the creator, assignee, or an administrator can close this change."
        )
    
    incomplete_tasks = [
        {
            "id": task.id,
            "title": task.title,
            "status": task.status,
            "assignee_id": task.assigned_to,
            "assignee_name": task.assignee.display_name if task.assignee else None
        }
        for task in change.implementation_tasks
        if task.status != "completed"
    ]
    
    if incomplete_tasks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "message": "Cannot close regulatory change. Some tasks are not completed.",
                "incomplete_tasks": incomplete_tasks
            }
        )
    
    previous_status = change.status
    change.status = "closed"
    change.closed_at = datetime.utcnow()
    change.closed_by = current_user.id
    
    create_audit_log_entry(
        db=db,
        tenant_id=change.tenant_id,
        user_id=current_user.id,
        action="regulatory_change_closed",
        resource_type="regulatory_change",
        resource_id=change.id,
        changes={
            "previous_status": previous_status,
            "new_status": "closed",
            "closed_at": change.closed_at.isoformat(),
            "closed_by": current_user.id,
            "closed_by_name": current_user.display_name or current_user.username
        }
    )
    
    db.commit()
    db.refresh(change)
    
    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.assignee),
        joinedload(RegulatoryChange.creator),
        joinedload(RegulatoryChange.closer),
        joinedload(RegulatoryChange.impact_assessments),
        joinedload(RegulatoryChange.implementation_tasks)
    ).filter(RegulatoryChange.id == change_id).first()
    
    return RegulatoryChangeCloseResponse(
        message="Regulatory change closed successfully",
        regulatory_change=serialize_regulatory_change(change)
    )
