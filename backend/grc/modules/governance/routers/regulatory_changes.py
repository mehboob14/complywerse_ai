from ....config import get_openai_model
from typing import Any, List, Optional
from datetime import datetime, timezone, timedelta
import json
import re

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
    GovernanceDocument, NormalizedControl, InternalControl, InternalControlFrameworkLink, Framework, GRCUser, Tenant, AuditLog, UserRole, Role,
    AuditObservation, GRCDepartment, get_db
)
from ....schemas import (
    RegulatoryChangeCreate, RegulatoryChangeUpdate, RegulatoryChangeResponse,
    RegulatoryImpactAssessmentCreate, RegulatoryImpactAssessmentResponse,
    RegulatoryImplementationTaskCreate, RegulatoryImplementationTaskUpdate,
    RegulatoryImplementationTaskResponse, RegulatoryChangeDashboardStats,
    RegulatoryGapAnalysisResponse, RegulatoryGapAnalysisRunRequest, MessageResponse,
    RegulatoryChangeClosureReadinessResponse, RegulatoryChangeCloseResponse,
    IncompleteTaskDetail
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/regulatory-changes", tags=["Governance - Regulatory Change Management"])

REGULATORY_CHANGE_SOURCES = [
    "SBP", "SAMA", "QCB", "MAS", "NCA",
    "OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "custom",
]

REGULATORY_SOURCE_ALIASES = {
    "sbp": "SBP",
    "state bank": "SBP",
    "state bank of pakistan": "SBP",
    "state_bank": "SBP",
    "sama": "SAMA",
    "saudi central bank": "SAMA",
    "qcb": "QCB",
    "qatar central bank": "QCB",
    "mas": "MAS",
    "monetary authority of singapore": "MAS",
    "nca": "NCA",
    "national cybersecurity authority": "NCA",
}


def normalize_regulatory_source(source: Optional[str], *, fallback: str = "custom") -> str:
    """Normalize free-text / alias source to a canonical regulatory-change code."""
    raw = (source or fallback).strip() if isinstance(source, str) else fallback
    if not raw:
        return fallback
    return REGULATORY_SOURCE_ALIASES.get(raw.lower(), raw)


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


def _desc_snippet(text: Optional[str], width: int = 200) -> str:
    """Collapse whitespace and truncate — used to feed control/policy/observation
    descriptions into the AI prompt without blowing the token budget."""
    t = re.sub(r"\s+", " ", (text or "")).strip()
    return (t[: width].rstrip() + "…") if len(t) > width else t


def _compose_impact_narrative(item_label: str, data: dict) -> tuple[str, Optional[str]]:
    """Build a specific, human-readable impact_description (and a gap_description)
    from the AI's per-item fields, instead of a generic "Control X - modification"
    template. Missing fields are simply omitted so nothing reads as boilerplate.

    Returns (impact_description, gap_description).
    """
    def _clean(v) -> str:
        s = str(v or "").strip()
        return "" if s.lower() in ("null", "none", "n/a", "na", "") else s

    basis = _clean(data.get("regulatory_basis"))
    current = _clean(data.get("current_state"))
    gap = _clean(data.get("gap_detail")) or _clean(data.get("action_needed"))
    audit_ref = _clean(data.get("related_audit_observation"))
    depts_raw = data.get("affected_departments") or []
    if isinstance(depts_raw, str):
        depts_raw = [depts_raw]
    depts = [d for d in (_clean(x) for x in depts_raw) if d]

    lines = [item_label]
    if basis:
        lines.append(f"Regulatory basis: {basis}")
    if current:
        lines.append(f"Current state: {current}")
    if gap:
        lines.append(f"Required change: {gap}")
    if depts:
        lines.append(f"Affected departments: {', '.join(depts)}")
    if audit_ref:
        lines.append(f"Related audit observation: {audit_ref}")
    return "\n".join(lines), (gap or None)


def serialize_impact_assessment(assessment: RegulatoryImpactAssessment, db: Session) -> RegulatoryImpactAssessmentResponse:
    impacted_item_name = None
    if assessment.impacted_item_type == "policy" and assessment.impacted_item_id:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == assessment.impacted_item_id).first()
        impacted_item_name = doc.title if doc else None
    elif assessment.impacted_item_type == "control" and assessment.impacted_item_id:
        # SBP circular uploads map controls to ERM InternalControl records.
        # Legacy rows may still be stored against NormalizedControl.
        ic = db.query(InternalControl).filter(InternalControl.id == assessment.impacted_item_id).first()
        if ic:
            impacted_item_name = ic.name
        else:
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
    
    source = normalize_regulatory_source(change.source if isinstance(change.source, str) else None)
    status_value = (change.status or "identified").strip() if isinstance(change.status, str) else "identified"
    priority_value = (change.priority or "medium").strip() if isinstance(change.priority, str) else "medium"

    effective_date = normalize_optional_datetime(change.effective_date, "effective_date")
    published_date_raw = change.published_date if change.published_date is not None else change.publication_date
    published_date = normalize_optional_datetime(published_date_raw, "published_date")
    regulation_reference = change.regulation_reference or change.reference_number

    if source not in REGULATORY_CHANGE_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source. Must be one of: {', '.join(REGULATORY_CHANGE_SOURCES)}"
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


def _analyze_and_persist(
    db: Session,
    change: RegulatoryChange,
    document_text: str,
    current_user: GRCUser,
    *,
    update_change_fields: bool,
    title_hint: Optional[str] = None,
    filename: Optional[str] = None,
) -> dict:
    """Run the AI regulatory-impact analysis over ``document_text`` and generate
    detailed, platform-grounded impact assessments + implementation tasks for
    ``change``.

    Shared by the upload endpoint (new change → ``update_change_fields=True``)
    and the regenerate endpoint (existing change → ``False``). Every impacted
    policy/control is asked to cite the exact driving clause, compare against
    what the mapped internal control/policy currently does, name the concrete
    gap and the affected departments, and cross-reference an open audit
    observation when relevant — so assessments are specific, not generic.

    AI-generated assessments/tasks from a previous run are cleared first, so
    regenerate is idempotent and never touches manually-added rows.
    """
    if not client:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="OpenAI client not configured.")

    tenant_id = change.tenant_id
    source_value = change.source if change.source in REGULATORY_CHANGE_SOURCES else "custom"

    # Local truncated copy for the prompt; the full text stays on change.source_text.
    doc_text = (document_text or "").strip()
    if not doc_text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No source text available to analyze.")
    if len(doc_text) > 12000:
        doc_text = doc_text[:12000] + "\n\n...[truncated]"

    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    # For most regulators we map controls to NormalizedControl. For SBP circulars
    # we restrict control mapping to ERM InternalControl so impact/gap analysis
    # only considers what exists internally.
    controls = db.query(NormalizedControl).all()
    internal_controls = None
    if source_value == "SBP":
        internal_controls = (
            db.query(InternalControl)
            .filter(InternalControl.tenant_id == tenant_id, InternalControl.status != "deprecated")
            .all()
        )
    policies = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id == tenant_id,
        GovernanceDocument.doc_type == "policy",
        GovernanceDocument.status.in_(["approved", "published"]),
    ).all()

    frameworks_text = "\n".join([f"- {fw.name} ({fw.short_code}): {fw.description or 'No description'}" for fw in frameworks]) if frameworks else "No frameworks registered"
    if source_value == "SBP" and internal_controls is not None:
        controls_text = "\n".join([
            f"- {ic.control_id}: {ic.name}" + (f" — {_desc_snippet(ic.description)}" if ic.description else "")
            for ic in internal_controls[:120]
        ]) if internal_controls else "No internal controls registered"
        controls_id_field = "InternalControl.control_id"
    else:
        controls_text = "\n".join([
            f"- {ctrl.code}: {ctrl.name}" + (f" — {_desc_snippet(getattr(ctrl, 'description', None))}" if getattr(ctrl, 'description', None) else "")
            for ctrl in controls[:120]
        ]) if controls else "No controls registered"
        controls_id_field = "NormalizedControl.code"
    policies_text = "\n".join([
        f"- {pol.title}" + (f" — {_desc_snippet(pol.description)}" if pol.description else "")
        for pol in policies[:120]
    ]) if policies else "No policies registered"

    # Grounding so assessments are specific: open audit observations (to
    # cross-reference existing findings) + departments (to name who is affected).
    audit_observations = (
        db.query(AuditObservation)
        .filter(AuditObservation.tenant_id == tenant_id, AuditObservation.status != "closed")
        .order_by(AuditObservation.created_at.desc())
        .limit(40)
        .all()
    )
    audit_observations_text = "\n".join([
        f"- {ao.code or ao.id}: {ao.title} [{ao.area_domain or ao.category or 'general'}; {ao.status}]"
        + (f" — {_desc_snippet(ao.description)}" if ao.description else "")
        for ao in audit_observations
    ]) if audit_observations else "No open audit observations recorded"
    departments = db.query(GRCDepartment).filter(GRCDepartment.tenant_id == tenant_id).limit(60).all()
    departments_text = ", ".join([d.name for d in departments if d.name]) if departments else "No departments registered"

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
Analyze the regulatory document and produce a platform-aware compliance impact result.
{sbp_context}
Be SPECIFIC and evidence-based. For every impacted policy and control you MUST:
- cite the exact clause / statement in THIS document that drives the impact (quote or
  closely paraphrase it, with any section or paragraph reference);
- compare it against what the named internal control / policy CURRENTLY does, using the
  descriptions provided in PLATFORM CONTEXT;
- state the concrete, specific change required (never a bare word like "modification");
- name the affected departments from the DEPARTMENTS list;
- cross-reference an OPEN AUDIT OBSERVATION whenever one overlaps.

Extract (from the text):
1) Key requirements summary
2) Priority and estimated effective date
3) Impacted policies (by exact policy title) with driving clause, current state, concrete gap
4) Impacted controls using our {controls_id_field} values, with driving clause, current control behaviour, concrete gap
5) Implementation tasks / recommendations to remediate
6) Overall organizational impact

Return ONLY valid JSON in this exact schema:
{{
  "title": "string (short regulation title; use title_hint when provided)",
  "summary": "string",
  "priority": "critical|high|medium|low",
  "effective_date_estimate": "YYYY-MM-DD or null",
  "impact_overview": "string (2-4 sentences on business / compliance impact)",
  "impacted_policies": [{{
    "title": "exact policy title from EXISTING POLICIES (or a new policy name)",
    "action_needed": "review|update|create_new",
    "regulatory_basis": "the exact clause/statement from THIS document that drives the impact, with section/para reference",
    "current_state": "what the named policy currently covers (from its description), or 'No existing policy covers this'",
    "gap_detail": "the specific, concrete change required to comply",
    "affected_departments": ["names from DEPARTMENTS that own or execute this"],
    "related_audit_observation": "code/title of a relevant item from AUDIT OBSERVATIONS, or null"
  }}],
  "impacted_controls": [{{
    "id": "value from {controls_id_field}",
    "name": "control name",
    "gap_type": "new_requirement|modification|obsolete",
    "regulatory_basis": "the exact clause/statement from THIS document driving the control impact, with reference",
    "current_state": "what the named control currently does (from its description), or 'No existing control covers this'",
    "gap_detail": "the specific, concrete change the control needs — not just 'modification'",
    "affected_departments": ["names from DEPARTMENTS"],
    "related_audit_observation": "code/title from AUDIT OBSERVATIONS if this overlaps an open finding, else null"
  }}],
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

The returned impacted_controls.id MUST be values from {controls_id_field} whenever possible.
If you are unsure, still provide the best-matching codes from the platform text you see above.

TEXT:
{doc_text}

PLATFORM CONTEXT (used to map ids and ground the analysis):
EXISTING FRAMEWORKS:
{frameworks_text}

EXISTING CONTROLS (id: name — what it currently does):
{controls_text}

EXISTING POLICIES (title — summary):
{policies_text}

OPEN AUDIT OBSERVATIONS (cross-reference when relevant):
{audit_observations_text}

DEPARTMENTS (pick affected_departments from these names):
{departments_text}
"""

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
        analysis = json.loads(response.choices[0].message.content.strip())
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"AI extraction failed: {str(e)}")

    # Change-level fields (upload only — regenerate leaves title/priority as set).
    if update_change_fields:
        ai_title = (analysis.get("title") or title_hint or filename or change.title or "Regulatory document").strip()
        ai_summary = analysis.get("summary") or ""
        impact_overview = (analysis.get("impact_overview") or "").strip()
        if impact_overview:
            ai_summary = f"{ai_summary}\n\nImpact assessment:\n{impact_overview}".strip() if ai_summary else f"Impact assessment:\n{impact_overview}"
        ai_priority = (analysis.get("priority") or "medium").strip()
        if ai_priority not in ["critical", "high", "medium", "low"]:
            ai_priority = "medium"
        eff_str = analysis.get("effective_date_estimate")
        if isinstance(eff_str, str) and eff_str.strip() and eff_str.strip().lower() != "null":
            try:
                change.effective_date = datetime.strptime(eff_str.strip(), "%Y-%m-%d")
            except Exception:
                pass
        change.title = ai_title[:500]
        change.description = ai_summary
        change.priority = ai_priority
    db.flush()

    # Clear prior AI-generated rows so regenerate is idempotent and leaves any
    # manually-added assessments/tasks intact. The is_ai_generated flag catches
    # rows from this build; the impacted_item_type in (policy, control) clause
    # catches legacy AI rows created before the flag existed — manual entries
    # from the Add-Assessment modal are always assessment_type "process" with no
    # impacted item, so they are preserved.
    prior = db.query(RegulatoryImpactAssessment).filter(
        RegulatoryImpactAssessment.regulatory_change_id == change.id,
        or_(
            RegulatoryImpactAssessment.is_ai_generated == True,
            RegulatoryImpactAssessment.impacted_item_type.in_(["policy", "control"]),
        ),
    ).all()
    prior_ids = [a.id for a in prior]
    if prior_ids:
        db.query(RegulatoryImplementationTask).filter(
            RegulatoryImplementationTask.impact_assessment_id.in_(prior_ids)
        ).update({RegulatoryImplementationTask.impact_assessment_id: None}, synchronize_session=False)
        for a in prior:
            db.delete(a)
    db.query(RegulatoryImplementationTask).filter(
        RegulatoryImplementationTask.regulatory_change_id == change.id,
        RegulatoryImplementationTask.is_ai_generated == True,
    ).delete(synchronize_session=False)
    db.flush()

    # Resolve control + policy ids for impacted items.
    if source_value == "SBP":
        controls_by_code = {str(c.control_id).strip().lower(): c for c in (internal_controls or [])}

        def resolve_control(code: Optional[str], name: Optional[str]):
            key = (code or "").strip().lower()
            if key and key in controls_by_code:
                return controls_by_code[key]
            nkey = (name or "").strip().lower()
            if nkey and internal_controls:
                for c in internal_controls:
                    if (str(c.control_id).lower() == nkey) or (nkey in str(c.name).lower()):
                        return c
            return None
    else:
        controls_by_code = {str(c.code).strip().lower(): c for c in controls}

        def resolve_control(code: Optional[str], name: Optional[str]):
            key = (code or "").strip().lower()
            if key and key in controls_by_code:
                return controls_by_code[key]
            nkey = (name or "").strip().lower()
            if nkey:
                for c in controls:
                    if (str(c.code).lower() == nkey) or (nkey in str(c.name).lower()) or (nkey in str(c.code).lower()):
                        return c
            return None

    policies_by_title = {str(p.title).strip().lower(): p for p in policies}

    def resolve_policy(title: Optional[str]):
        tkey = (title or "").strip().lower()
        if tkey and tkey in policies_by_title:
            return policies_by_title[tkey]
        if tkey:
            for p in policies:
                if tkey in str(p.title).lower():
                    return p
        return None

    policy_assessments_by_key: dict = {}
    control_assessments_by_code: dict = {}

    for pol_impact in (analysis.get("impacted_policies") or []):
        pol_title = pol_impact.get("title")
        action_needed = pol_impact.get("action_needed") or "review"
        gap_identified = action_needed in ["update", "create_new"]
        impacted_policy = resolve_policy(pol_title)
        narrative, gap_text = _compose_impact_narrative(f"Policy '{pol_title}' — {action_needed}", pol_impact)
        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=change.id,
            assessment_type="policy",
            impacted_item_type="policy",
            impacted_item_id=impacted_policy.id if impacted_policy else None,
            impact_level="medium",
            impact_description=narrative,
            gap_identified=gap_identified,
            gap_description=gap_text if gap_identified else None,
            is_ai_generated=True,
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
        impacted_control = resolve_control(ctrl_code, ctrl_name)
        impacted_item_id = impacted_control.id if impacted_control else None
        if source_value == "SBP":
            # Only a gap when the referenced ERM internal control does not exist;
            # if it exists we already cover the requirement at the controls layer.
            gap_identified = impacted_item_id is None
            impact_level = "high" if gap_identified else "medium"
        else:
            gap_identified = gap_type in ["new_requirement", "modification"]
            impact_level = "high" if gap_type == "new_requirement" else "medium"
        narrative, gap_text = _compose_impact_narrative(f"Control '{ctrl_code}: {ctrl_name}' — {gap_type}", ctrl_impact)
        impact_assessment = RegulatoryImpactAssessment(
            tenant_id=tenant_id,
            regulatory_change_id=change.id,
            assessment_type="control",
            impacted_item_type="control",
            impacted_item_id=impacted_item_id,
            impact_level=impact_level,
            impact_description=narrative,
            gap_identified=gap_identified,
            gap_description=gap_text if gap_identified else None,
            is_ai_generated=True,
            assessed_by=current_user.id,
            assessed_at=datetime.utcnow(),
        )
        db.add(impact_assessment)
        db.flush()
        if ctrl_code:
            control_assessments_by_code[str(ctrl_code).strip().lower()] = impact_assessment

    # Implementation tasks from AI recommendations.
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

        impact_assessment_id = None
        if task_type == "control_update":
            for code_key, a in control_assessments_by_code.items():
                if code_key and code_key in lower:
                    impact_assessment_id = a.id
                    break
        elif task_type == "policy_update":
            for title_key, a in policy_assessments_by_key.items():
                if title_key and title_key in lower:
                    impact_assessment_id = a.id
                    break

        db.add(RegulatoryImplementationTask(
            tenant_id=tenant_id,
            regulatory_change_id=change.id,
            impact_assessment_id=impact_assessment_id,
            title=task_title[:500],
            description=task_description,
            task_type=task_type,
            status="pending",
            priority=task_priority,
            assigned_to=None,
            due_date=due_date,
            linked_policy_id=None,
            linked_control_id=None,
            is_ai_generated=True,
            created_by=current_user.id,
        ))

    if change.status in (None, "identified"):
        change.status = "under_assessment"
    if implementation_tasks and change.status in (None, "identified", "under_assessment"):
        change.status = "implementation"

    return {
        "assessments_created": len(analysis.get("impacted_policies") or []) + len(analysis.get("impacted_controls") or []),
        "tasks_created": len(implementation_tasks),
    }


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

    # Accept common document types; extraction falls back across engines.
    filename = file.filename or "regulatory_document"
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext in {"pdf"}:
        file_type = "pdf"
    elif ext in {"docx"}:
        file_type = "docx"
    elif ext in {"doc"}:
        file_type = "doc"
    elif ext in {"txt", "md", "csv", "json", "log", "rtf"}:
        file_type = "txt"
    elif ext in {"xlsx", "xls"}:
        file_type = ext
    elif ext in {"png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp", "gif"}:
        file_type = ext
    else:
        # Accept anything else too — the extractor auto-detects by content
        # (magic bytes) and OCRs scans/images, so users can upload any document.
        file_type = ext or "bin"

    try:
        from .policy_parser import extract_text_from_bytes
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Text extraction deps unavailable: {str(e)}")

    contents = file.file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty.")

    try:
        extracted_text = extract_text_from_bytes(contents, file_type, filename)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Could not read the uploaded document: {str(e)}",
        )

    content_text = extracted_text or ""
    if not content_text.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "We couldn't read any text from this document — even after OCR. "
                "It may be empty, password-protected/corrupt, or a very low-quality "
                "scan. For scanned files, configure OpenAI (used for AI OCR) or "
                "install Tesseract on the server, then try again."
            ),
        )

    # Resolve source, persist the full extracted text, then run the shared AI
    # impact analysis (the same routine the regenerate endpoint reuses).
    source_value = normalize_regulatory_source(source if isinstance(source, str) else None)
    if source_value not in REGULATORY_CHANGE_SOURCES:
        source_value = "custom"

    db_change = RegulatoryChange(
        tenant_id=tenant_id,
        title=(title_hint or filename or "Regulatory document").strip()[:500],
        description=None,
        source=source_value,
        source_text=content_text,
        status="identified",
        priority="medium",
        created_by=current_user.id,
        assigned_to=None,
    )
    db.add(db_change)
    db.flush()

    _analyze_and_persist(
        db,
        db_change,
        content_text,
        current_user,
        update_change_fields=True,
        title_hint=title_hint,
        filename=filename,
    )

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
            source_value = normalize_regulatory_source(source_value)
            update_data["source"] = source_value
        if source_value not in REGULATORY_CHANGE_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid source. Must be one of: {', '.join(REGULATORY_CHANGE_SOURCES)}"
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
    responses = [serialize_impact_assessment(a, db) for a in assessments]

    # SBP circulars: ensure "gap_identified" only reflects missing ERM
    # InternalControls (not just AI guesses). This makes the UI's
    # impact/gap view consistent.
    if change.source == "SBP":
        control_ids = {r.impacted_item_id for r in responses if r.impacted_item_type == "control" and r.impacted_item_id}
        if control_ids:
            internal_control_rows = db.query(InternalControl.id).filter(InternalControl.id.in_(control_ids)).all()
            internal_control_ids = {row[0] for row in internal_control_rows}
            normalized_ids = control_ids - internal_control_ids

            mapped_normalized_control_ids: set[int] = set()
            if normalized_ids:
                mapped_rows = (
                    db.query(InternalControlFrameworkLink.normalized_control_id)
                    .join(InternalControl, InternalControl.id == InternalControlFrameworkLink.internal_control_id)
                    .filter(
                        InternalControl.tenant_id == change.tenant_id,
                        InternalControlFrameworkLink.normalized_control_id.in_(normalized_ids),
                    )
                    .all()
                )
                mapped_normalized_control_ids = {row[0] for row in mapped_rows}

            # Override gaps when an internal control is already covered.
            for resp in responses:
                if resp.impacted_item_type != "control" or not resp.impacted_item_id:
                    continue
                internal_exists = (
                    resp.impacted_item_id in internal_control_ids
                    or resp.impacted_item_id in mapped_normalized_control_ids
                )
                if internal_exists:
                    resp.gap_identified = False
                    resp.gap_description = None
                    resp.compliance_gaps = None

    return responses


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


@router.post("/changes/{change_id}/assessments/regenerate", response_model=List[RegulatoryImpactAssessmentResponse])
def regenerate_impact_assessments(
    change_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Re-run the AI impact analysis for an existing change and replace its
    AI-generated assessments/tasks with detailed, platform-grounded ones
    (driving clause, current control/policy state, concrete gap, affected
    departments, related audit observations). Uses the stored source document
    when available, otherwise the change summary. Manually-added assessments
    and tasks are preserved.
    """
    user_tenants = get_user_tenants(current_user, db)
    change = db.query(RegulatoryChange).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants),
    ).first()
    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")

    source_text = (getattr(change, "source_text", None) or "").strip()
    if not source_text:
        # Pre-existing changes (uploaded before source_text was captured) fall
        # back to their stored summary so they can still be enriched.
        source_text = (change.description or "").strip()
    if not source_text:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="This change has no source document or description to analyze. Add a description or re-upload the document, then regenerate.",
        )

    _analyze_and_persist(db, change, source_text, current_user, update_change_fields=False)
    db.commit()

    assessments = db.query(RegulatoryImpactAssessment).options(
        joinedload(RegulatoryImpactAssessment.assessor)
    ).filter(
        RegulatoryImpactAssessment.regulatory_change_id == change_id
    ).order_by(RegulatoryImpactAssessment.assessed_at.desc()).all()
    return [serialize_impact_assessment(a, db) for a in assessments]


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

def _sbp_control_gap_assessments(
    change: RegulatoryChange,
    impact_assessments: list,
    db: Session,
) -> list:
    """For SBP circulars, only treat control impacts as gaps when no
    matching ERM InternalControl exists (direct id or via framework link)."""
    all_control_ids = {
        a.impacted_item_id
        for a in impact_assessments
        if a.impacted_item_type == "control" and a.impacted_item_id
    }

    internal_control_ids: set[int] = set()
    mapped_normalized_control_ids: set[int] = set()
    if all_control_ids:
        internal_control_rows = (
            db.query(InternalControl.id).filter(InternalControl.id.in_(all_control_ids)).all()
        )
        internal_control_ids = {row[0] for row in internal_control_rows}

        normalized_ids = all_control_ids - internal_control_ids
        if normalized_ids:
            mapped_rows = (
                db.query(InternalControlFrameworkLink.normalized_control_id)
                .join(InternalControl, InternalControl.id == InternalControlFrameworkLink.internal_control_id)
                .filter(
                    InternalControl.tenant_id == change.tenant_id,
                    InternalControlFrameworkLink.normalized_control_id.in_(normalized_ids),
                )
                .all()
            )
            mapped_normalized_control_ids = {row[0] for row in mapped_rows}

    gap_assessments = []
    for a in impact_assessments:
        if a.impacted_item_type == "control" and a.impacted_item_id:
            internal_exists = (
                a.impacted_item_id in internal_control_ids
                or a.impacted_item_id in mapped_normalized_control_ids
            )
            if not internal_exists:
                gap_assessments.append(a)
        elif a.gap_identified:
            gap_assessments.append(a)
    return gap_assessments


def _build_gap_analysis_payload(
    change: RegulatoryChange,
    db: Session,
    *,
    document_ids: Optional[List[int]] = None,
    include_all_controls: bool = True,
    synthesize_missing_docs: bool = False,
    assignee_id: Optional[int] = None,
    assignee_name: Optional[str] = None,
) -> RegulatoryGapAnalysisResponse:
    """Build a structured gap-analysis payload from impact assessments,
    optionally scoped to selected documents and control inclusion.

    ``document_ids=None`` means do not filter policy gaps (include all existing).
    ``synthesize_missing_docs`` only applies when the user explicitly selected
    documents — it creates review rows for selected docs that were not already
    flagged, without flooding the DB when running against "all policies".
    """
    impact_assessments = list(change.impact_assessments or [])

    if change.source == "SBP":
        gap_assessments = _sbp_control_gap_assessments(change, impact_assessments, db)
    else:
        gap_assessments = [a for a in impact_assessments if a.gap_identified]

    # Scope policy gaps to the selected document set (None/empty = all existing).
    selected_docs = set(document_ids) if document_ids is not None else set()
    filter_policies = document_ids is not None
    scoped: list = []
    for a in gap_assessments:
        if a.impacted_item_type == "control":
            if include_all_controls:
                scoped.append(a)
            continue
        if a.impacted_item_type == "policy":
            if filter_policies and a.impacted_item_id and a.impacted_item_id not in selected_docs:
                continue
            scoped.append(a)
            continue
        scoped.append(a)

    # Ensure every explicitly selected document appears as a policy gap row
    # even when upload-time AI did not already flag it.
    if synthesize_missing_docs and selected_docs:
        already = {
            a.impacted_item_id
            for a in scoped
            if a.impacted_item_type == "policy" and a.impacted_item_id
        }
        missing_ids = selected_docs - already
        if missing_ids:
            for doc in (
                db.query(GovernanceDocument)
                .filter(
                    GovernanceDocument.id.in_(missing_ids),
                    GovernanceDocument.tenant_id == change.tenant_id,
                )
                .all()
            ):
                assessment = RegulatoryImpactAssessment(
                    tenant_id=change.tenant_id,
                    regulatory_change_id=change.id,
                    assessment_type="policy",
                    impacted_item_type="policy",
                    impacted_item_id=doc.id,
                    impact_level=change.priority or "medium",
                    impact_description=(
                        f"Selected document '{doc.title}' needs review against "
                        f"regulatory change '{change.title}'."
                    ),
                    gap_identified=True,
                    gap_description=(
                        f"Review and update '{doc.title}' to align with the "
                        f"requirements in '{change.title}'."
                    ),
                    assessed_by=change.created_by,
                    assessed_at=datetime.utcnow(),
                )
                db.add(assessment)
                db.flush()
                scoped.append(assessment)

    policy_ids = {
        a.impacted_item_id
        for a in scoped
        if a.impacted_item_type == "policy" and a.impacted_item_id
    }
    control_ids = {
        a.impacted_item_id
        for a in scoped
        if a.impacted_item_type == "control" and a.impacted_item_id
    }

    policies_by_id: dict[int, str] = {}
    if policy_ids:
        for p in db.query(GovernanceDocument).filter(GovernanceDocument.id.in_(policy_ids)).all():
            policies_by_id[p.id] = p.title

    controls_by_id: dict[int, str] = {}
    if control_ids:
        for c in db.query(InternalControl).filter(InternalControl.id.in_(control_ids)).all():
            controls_by_id[c.id] = c.name
        missing = control_ids - set(controls_by_id.keys())
        if missing:
            for c in db.query(NormalizedControl).filter(NormalizedControl.id.in_(missing)).all():
                controls_by_id[c.id] = c.name

    impacted_policies: list[dict[str, Any]] = []
    impacted_controls: list[dict[str, Any]] = []
    identified_gaps: list[dict[str, Any]] = []
    recommended_actions: list[str] = []

    def _name_from_text(*texts: Optional[str]) -> Optional[str]:
        patterns = (
            r"(?i)(?:policy|document|control)\s+['\"]([^'\"]+)['\"]",
            r"(?i)['\"]([^'\"]+)['\"]\s+(?:requires|needs|must)",
        )
        for text in texts:
            if not text:
                continue
            for pattern in patterns:
                match = re.search(pattern, text)
                if match:
                    return match.group(1).strip()
        return None

    for a in scoped:
        area = (a.impacted_item_type or a.assessment_type or "process").lower()
        item_name = None
        if area == "policy" and a.impacted_item_id and a.impacted_item_id in policies_by_id:
            item_name = policies_by_id[a.impacted_item_id]
            impacted_policies.append({
                "id": a.impacted_item_id,
                "title": item_name,
                "impact_level": a.impact_level,
                "reason": a.gap_description or a.impact_description or "Requires review",
            })
        elif area == "control" and a.impacted_item_id and a.impacted_item_id in controls_by_id:
            item_name = controls_by_id[a.impacted_item_id]
            impacted_controls.append({
                "id": a.impacted_item_id,
                "name": item_name,
                "impact_level": a.impact_level,
                "reason": a.gap_description or a.impact_description or "Requires review",
            })
        elif a.impacted_item_id and area == "policy":
            item_name = f"Document #{a.impacted_item_id}"
        elif a.impacted_item_id and area == "control":
            item_name = f"Control #{a.impacted_item_id}"
        else:
            item_name = _name_from_text(a.gap_description, a.impact_description)

        remediation = (a.gap_description or "").strip()
        impact_desc = (a.impact_description or "").strip()
        if not remediation or remediation.lower().startswith("action needed:"):
            remediation = impact_desc or f"Review {item_name or area} against '{change.title}'."

        if area == "policy":
            current_state = f"'{item_name or 'Selected document'}' not yet confirmed aligned"
            required_state = f"Aligned with requirements in '{change.title}'"
        elif area == "control":
            current_state = (
                f"No matching internal control for '{item_name or 'requirement'}'"
                if change.source == "SBP"
                else f"Control '{item_name or 'requirement'}' needs update"
            )
            required_state = (
                f"Internal control covering '{item_name or 'requirement'}'"
                if change.source == "SBP"
                else f"Updated control covering '{change.title}'"
            )
        else:
            current_state = "Gap identified"
            required_state = "Remediated"

        identified_gaps.append({
            "id": a.id,
            "area": area,
            "item_name": item_name,
            "item_id": a.impacted_item_id,
            "description": remediation,
            "severity": (a.impact_level or change.priority or "medium").lower(),
            "current_state": current_state,
            "required_state": required_state,
            "remediation_plan": remediation,
            "status": "identified",
            "assigned_to": assignee_id,
            "assignee_name": assignee_name,
        })
        if remediation not in recommended_actions:
            recommended_actions.append(remediation)

    risk_level = (change.priority or "medium").lower()
    confidence_score = 0.9 if scoped else 0.6
    doc_note = (
        f"{len(selected_docs)} selected document(s)"
        if selected_docs
        else "all eligible documents"
    )
    ctrl_note = "including all controls" if include_all_controls else "controls excluded"
    analysis_summary = (
        f"Gap analysis scoped to {doc_note}, {ctrl_note}. "
        f"Found {len(identified_gaps)} gap(s)."
        if scoped or selected_docs
        else "No gaps identified for the current selection."
    )

    return RegulatoryGapAnalysisResponse(
        regulatory_change_id=change.id,
        regulatory_change_title=change.title,
        analysis_summary=analysis_summary,
        impacted_policies=impacted_policies,
        impacted_controls=impacted_controls,
        identified_gaps=identified_gaps,
        recommended_actions=recommended_actions[:12] if recommended_actions else [],
        risk_level=risk_level,
        confidence_score=confidence_score,
        tasks_created=0,
    )


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

    return _build_gap_analysis_payload(change, db, include_all_controls=True)


@router.post("/changes/{change_id}/gap-analysis/run", response_model=RegulatoryGapAnalysisResponse)
def run_gap_analysis(
    change_id: int,
    body: RegulatoryGapAnalysisRunRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Run a scoped gap analysis: selected documents + all controls by default.

    Optionally creates implementation tasks for each identified gap and
    assigns them to ``assigned_to``.
    """
    user_tenants = get_user_tenants(current_user, db)

    change = db.query(RegulatoryChange).options(
        joinedload(RegulatoryChange.impact_assessments)
    ).filter(
        RegulatoryChange.id == change_id,
        RegulatoryChange.tenant_id.in_(user_tenants)
    ).first()

    if not change:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Regulatory change not found")

    explicit_document_ids = list(body.document_ids or [])
    document_ids: Optional[List[int]] = None
    synthesize_missing_docs = False
    if explicit_document_ids:
        valid_ids = {
            row[0]
            for row in db.query(GovernanceDocument.id)
            .filter(
                GovernanceDocument.id.in_(explicit_document_ids),
                GovernanceDocument.tenant_id == change.tenant_id,
            )
            .all()
        }
        invalid = set(explicit_document_ids) - valid_ids
        if invalid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid document_ids for this tenant: {sorted(invalid)}",
            )
        document_ids = sorted(valid_ids)
        synthesize_missing_docs = True

    assignee_id = body.assigned_to
    assignee_name = None
    if assignee_id is not None:
        user = db.query(GRCUser).filter(GRCUser.id == assignee_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")
        assignee_name = user.display_name

    payload = _build_gap_analysis_payload(
        change,
        db,
        document_ids=document_ids,
        include_all_controls=bool(body.include_all_controls),
        synthesize_missing_docs=synthesize_missing_docs,
        assignee_id=assignee_id,
        assignee_name=assignee_name,
    )

    tasks_created = 0
    if assignee_id is not None and payload.identified_gaps:
        now = datetime.utcnow()
        existing_titles = {
            (t.title or "").strip().lower()
            for t in db.query(RegulatoryImplementationTask)
            .filter(RegulatoryImplementationTask.regulatory_change_id == change.id)
            .all()
        }
        for gap in payload.identified_gaps:
            area = (gap.get("area") or "process").lower()
            item_name = gap.get("item_name") or area
            title = f"Close gap: {item_name}"[:500]
            if title.strip().lower() in existing_titles:
                continue
            task_type = "policy_update" if area == "policy" else (
                "control_update" if area == "control" else "process_change"
            )
            db_task = RegulatoryImplementationTask(
                tenant_id=change.tenant_id,
                regulatory_change_id=change.id,
                impact_assessment_id=gap.get("id"),
                title=title,
                description=gap.get("remediation_plan") or gap.get("description") or "",
                task_type=task_type,
                status="pending",
                priority=(gap.get("severity") or change.priority or "medium"),
                assigned_to=assignee_id,
                due_date=now + timedelta(days=30),
                linked_policy_id=gap.get("item_id") if area == "policy" else None,
                linked_control_id=gap.get("item_id") if area == "control" else None,
                created_by=current_user.id,
            )
            db.add(db_task)
            existing_titles.add(title.strip().lower())
            tasks_created += 1

        if tasks_created and change.status in ("identified", "under_assessment"):
            change.status = "implementation"

    db.commit()
    payload.tasks_created = tasks_created
    if tasks_created:
        payload.analysis_summary = (
            f"{payload.analysis_summary} Created {tasks_created} task(s)"
            + (f" assigned to {assignee_name}." if assignee_name else ".")
        )
    return payload


# =============================================================================
# Closure Readiness and Close Endpoints
# =============================================================================
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
