from typing import List, Optional
from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

try:
    from openai import OpenAI
    client = OpenAI()
except Exception:
    client = None

from ....models import (
    RegulatoryChange, RegulatoryImpactAssessment, RegulatoryImplementationTask,
    GovernanceDocument, NormalizedControl, GRCUser, Tenant, get_db
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


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_regulatory_change(change: RegulatoryChange) -> RegulatoryChangeResponse:
    completed_tasks = sum(1 for t in change.implementation_tasks if t.status == "completed")
    return RegulatoryChangeResponse(
        id=change.id,
        tenant_id=change.tenant_id,
        title=change.title,
        description=change.description,
        source=change.source,
        regulation_reference=change.regulation_reference,
        effective_date=change.effective_date,
        published_date=change.published_date,
        status=change.status,
        priority=change.priority,
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
    
    return RegulatoryImpactAssessmentResponse(
        id=assessment.id,
        tenant_id=assessment.tenant_id,
        regulatory_change_id=assessment.regulatory_change_id,
        assessment_type=assessment.assessment_type,
        impacted_item_id=assessment.impacted_item_id,
        impacted_item_type=assessment.impacted_item_type,
        impacted_item_name=impacted_item_name,
        impact_level=assessment.impact_level,
        impact_description=assessment.impact_description,
        gap_identified=assessment.gap_identified,
        gap_description=assessment.gap_description,
        assessed_by=assessment.assessed_by,
        assessor_name=assessment.assessor.display_name if assessment.assessor else None,
        assessed_at=assessment.assessed_at
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
    
    valid_sources = ["OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "custom"]
    if change.source not in valid_sources:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid source. Must be one of: {', '.join(valid_sources)}"
        )
    
    valid_statuses = ["identified", "under_assessment", "implementation", "completed", "closed", "not_applicable"]
    if change.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )
    
    valid_priorities = ["critical", "high", "medium", "low"]
    if change.priority not in valid_priorities:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
        )
    
    db_change = RegulatoryChange(
        tenant_id=tenant_id,
        title=change.title,
        description=change.description,
        source=change.source,
        regulation_reference=change.regulation_reference,
        effective_date=change.effective_date,
        published_date=change.published_date,
        status=change.status,
        priority=change.priority,
        assigned_to=change.assigned_to,
        created_by=current_user.id
    )
    
    db.add(db_change)
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
    
    if "source" in update_data:
        valid_sources = ["OCC", "Fed", "EBA", "PRA", "SEC", "FINRA", "custom"]
        if update_data["source"] not in valid_sources:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid source. Must be one of: {', '.join(valid_sources)}"
            )
    
    if "status" in update_data:
        valid_statuses = ["identified", "under_assessment", "implementation", "completed", "closed", "not_applicable"]
        if update_data["status"] not in valid_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            )
    
    if "priority" in update_data:
        valid_priorities = ["critical", "high", "medium", "low"]
        if update_data["priority"] not in valid_priorities:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid priority. Must be one of: {', '.join(valid_priorities)}"
            )
    
    for key, value in update_data.items():
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
    
    valid_types = ["policy", "control", "process", "technology"]
    if assessment.assessment_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid assessment_type. Must be one of: {', '.join(valid_types)}"
        )
    
    valid_levels = ["high", "medium", "low", "none"]
    if assessment.impact_level not in valid_levels:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid impact_level. Must be one of: {', '.join(valid_levels)}"
        )
    
    if assessment.impacted_item_type and assessment.impacted_item_type not in ["policy", "control", "asset", "process"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid impacted_item_type. Must be one of: policy, control, asset, process"
        )
    
    db_assessment = RegulatoryImpactAssessment(
        tenant_id=change.tenant_id,
        regulatory_change_id=change_id,
        assessment_type=assessment.assessment_type,
        impacted_item_id=assessment.impacted_item_id,
        impacted_item_type=assessment.impacted_item_type,
        impact_level=assessment.impact_level,
        impact_description=assessment.impact_description,
        gap_identified=assessment.gap_identified,
        gap_description=assessment.gap_description,
        assessed_by=current_user.id,
        assessed_at=datetime.utcnow()
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
            model="gpt-4o",
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
    """Close a regulatory change after validating all implementation tasks are completed."""
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
    
    if change.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Regulatory change is already closed"
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
    
    change.status = "closed"
    change.closed_at = datetime.utcnow()
    change.closed_by = current_user.id
    
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
