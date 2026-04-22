import os
import uuid
import json
import logging
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, subqueryload
from sqlalchemy import or_, func

from ..models import (
    ISProject, ISProjectMilestone, ISProjectMilestoneEvidence, ISProjectTask, ISProjectTeamMember,
    ISProjectStatusUpdate, ISProjectRisk, ISProjectDocument,
    ISProjectBudgetItem, ISProjectComplianceMapping, ISProjectLessonLearned,
    ISProjectDependency, ISProjectHealthSnapshot,
    Evidence, GRCUser, get_db
)
from .auth_router import require_auth, get_user_primary_tenant, require_tenant_permission

MILESTONE_EVIDENCE_DIR = "backend/uploads/is_project_milestone_evidence"
os.makedirs(MILESTONE_EVIDENCE_DIR, exist_ok=True)
IS_PROJECT_DOCUMENT_DIR = "backend/uploads/is_project_documents"
os.makedirs(IS_PROJECT_DOCUMENT_DIR, exist_ok=True)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/is-projects",
    tags=["IS Projects"],
    dependencies=[Depends(require_tenant_permission("is_projects:projects:view"))],
)


def safe_parse_date(val):
    if not val:
        return None
    try:
        return datetime.fromisoformat(str(val).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid date format: {val}")


def _recalculate_project_completion(db: Session, project: ISProject) -> None:
    tasks = db.query(ISProjectTask).filter(ISProjectTask.project_id == project.id).all()
    if not tasks:
        project.completion_percentage = 0
        return

    total = 0.0
    for task in tasks:
        if task.status in ("Done", "Completed"):
            task_progress = 100.0
        elif task.progress is not None and float(task.progress) > 0:
            task_progress = max(0, min(100, float(task.progress)))
        elif task.status in ("In Review", "Under Review"):
            task_progress = 75.0
        elif task.status == "In Progress":
            task_progress = 50.0
        else:
            task_progress = 0.0
        total += task_progress

    project.completion_percentage = round(total / len(tasks), 2)


def serialize_project(p: ISProject) -> dict:
    return {
        "id": p.id,
        "tenant_id": p.tenant_id,
        "name": p.name,
        "description": p.description,
        "category": p.category,
        "priority": p.priority,
        "status": p.status,
        "health": p.health,
        "project_owner_id": p.project_owner_id,
        "project_owner_name": p.project_owner_name,
        "sponsor": p.sponsor,
        "department": p.department,
        "start_date": p.start_date.isoformat() if p.start_date else None,
        "target_end_date": p.target_end_date.isoformat() if p.target_end_date else None,
        "actual_end_date": p.actual_end_date.isoformat() if p.actual_end_date else None,
        "budget_estimated": p.budget_estimated,
        "budget_actual": p.budget_actual,
        "business_justification": p.business_justification,
        "linked_risks": p.linked_risks or [],
        "linked_controls": p.linked_controls or [],
        "linked_frameworks": p.linked_frameworks or [],
        "completion_percentage": p.completion_percentage,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "created_by": p.created_by,
        "milestones_count": len(p.milestones) if p.milestones else 0,
        "tasks_count": len(p.tasks) if p.tasks else 0,
        "team_count": len(p.team_members) if p.team_members else 0,
        "open_risks_count": len([r for r in (p.risks or []) if r.status == "Open"]),
    }


def serialize_milestone(m: ISProjectMilestone) -> dict:
    return {
        "id": m.id,
        "project_id": m.project_id,
        "name": m.name,
        "description": m.description,
        "target_date": m.target_date.isoformat() if m.target_date else None,
        "actual_completion_date": m.actual_completion_date.isoformat() if m.actual_completion_date else None,
        "status": m.status,
        "deliverables": m.deliverables or [],
        "completion_percentage": m.completion_percentage,
        "sort_order": m.sort_order,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def serialize_task(t: ISProjectTask) -> dict:
    return {
        "id": t.id,
        "project_id": t.project_id,
        "title": t.title,
        "description": t.description,
        "assignee_id": t.assignee_id,
        "assignee_name": t.assignee_name,
        "status": t.status,
        "priority": t.priority,
        "due_date": t.due_date.isoformat() if t.due_date else None,
        "completed_date": t.completed_date.isoformat() if t.completed_date else None,
        "dependencies": t.dependencies or [],
        "progress": t.progress,
        "sort_order": t.sort_order,
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def serialize_team_member(tm: ISProjectTeamMember) -> dict:
    return {
        "id": tm.id,
        "project_id": tm.project_id,
        "user_id": tm.user_id,
        "user_name": tm.user_name,
        "email": tm.email,
        "role": tm.role,
        "responsibilities": tm.responsibilities,
        "joined_at": tm.joined_at.isoformat() if tm.joined_at else None,
    }


def serialize_status_update(su: ISProjectStatusUpdate) -> dict:
    return {
        "id": su.id,
        "project_id": su.project_id,
        "author_id": su.author_id,
        "author_name": su.author_name,
        "update_date": su.update_date.isoformat() if su.update_date else None,
        "health_status": su.health_status,
        "what_was_done": su.what_was_done,
        "whats_planned": su.whats_planned,
        "blockers": su.blockers,
        "notes": su.notes,
        "created_at": su.created_at.isoformat() if su.created_at else None,
    }


def serialize_risk(r: ISProjectRisk) -> dict:
    return {
        "id": r.id,
        "project_id": r.project_id,
        "title": r.title,
        "description": r.description,
        "type": r.type,
        "severity": r.severity,
        "status": r.status,
        "mitigation": r.mitigation,
        "owner_name": r.owner_name,
        "identified_date": r.identified_date.isoformat() if r.identified_date else None,
        "resolved_date": r.resolved_date.isoformat() if r.resolved_date else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def serialize_document(d: ISProjectDocument) -> dict:
    is_uploaded_file = d.reference_type == "uploaded_file" and bool(d.reference_id)
    file_name = d.url if is_uploaded_file else None
    return {
        "id": d.id,
        "project_id": d.project_id,
        "title": d.title,
        "description": d.description,
        "document_type": d.document_type,
        "url": d.url,
        "reference_id": d.reference_id,
        "reference_type": d.reference_type,
        "is_uploaded_file": is_uploaded_file,
        "file_name": file_name,
        "download_url": f"/api/is-projects/{d.project_id}/documents/{d.id}/download" if is_uploaded_file else None,
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "created_by_name": d.created_by_name,
    }


def serialize_budget_item(b: ISProjectBudgetItem) -> dict:
    return {
        "id": b.id,
        "project_id": b.project_id,
        "description": b.description,
        "category": b.category,
        "amount": b.amount,
        "date": b.date.isoformat() if b.date else None,
        "status": b.status,
        "approved_by": b.approved_by,
        "notes": b.notes,
        "created_at": b.created_at.isoformat() if b.created_at else None,
        "updated_at": b.updated_at.isoformat() if b.updated_at else None,
    }


def serialize_compliance_mapping(cm: ISProjectComplianceMapping) -> dict:
    return {
        "id": cm.id,
        "project_id": cm.project_id,
        "control_id": cm.control_id,
        "control_name": cm.control_name,
        "framework_name": cm.framework_name,
        "requirement_description": cm.requirement_description,
        "deliverable": cm.deliverable,
        "coverage_status": cm.coverage_status,
        "notes": cm.notes,
        "created_at": cm.created_at.isoformat() if cm.created_at else None,
        "updated_at": cm.updated_at.isoformat() if cm.updated_at else None,
    }


def serialize_lesson_learned(ll: ISProjectLessonLearned) -> dict:
    return {
        "id": ll.id,
        "project_id": ll.project_id,
        "category": ll.category,
        "title": ll.title,
        "description": ll.description,
        "impact": ll.impact,
        "linked_milestone_id": ll.linked_milestone_id,
        "linked_task_id": ll.linked_task_id,
        "author_name": ll.author_name,
        "created_at": ll.created_at.isoformat() if ll.created_at else None,
        "updated_at": ll.updated_at.isoformat() if ll.updated_at else None,
    }


def serialize_dependency(dep: ISProjectDependency) -> dict:
    return {
        "id": dep.id,
        "project_id": dep.project_id,
        "dependency_type": dep.dependency_type,
        "dependent_project_id": dep.dependent_project_id,
        "dependent_project_name": dep.dependent_project_name,
        "external_dependency": dep.external_dependency,
        "description": dep.description,
        "status": dep.status,
        "direction": dep.direction,
        "impact_if_delayed": dep.impact_if_delayed,
        "expected_date": dep.expected_date.isoformat() if dep.expected_date else None,
        "resolved_date": dep.resolved_date.isoformat() if dep.resolved_date else None,
        "created_at": dep.created_at.isoformat() if dep.created_at else None,
        "updated_at": dep.updated_at.isoformat() if dep.updated_at else None,
    }


def _get_openai_client():
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _get_openai_model():
    return os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o"


# ─── Projects CRUD ──────────────────────────────────────────────────────────

@router.get("")
def list_projects(
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    health: Optional[str] = Query(None),
    owner_id: Optional[int] = Query(None),
    owner_name: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    start_date_from: Optional[str] = Query(None),
    start_date_to: Optional[str] = Query(None),
    end_date_from: Optional[str] = Query(None),
    end_date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    query = db.query(ISProject).filter(ISProject.tenant_id == tenant_id)

    if status_filter:
        query = query.filter(ISProject.status == status_filter)
    if category:
        query = query.filter(ISProject.category == category)
    if priority:
        query = query.filter(ISProject.priority == priority)
    if health:
        query = query.filter(ISProject.health == health)
    if owner_id:
        query = query.filter(ISProject.project_owner_id == owner_id)
    if owner_name:
        query = query.filter(ISProject.project_owner_name.ilike(f"%{owner_name}%"))
    if search:
        query = query.filter(
            or_(
                ISProject.name.ilike(f"%{search}%"),
                ISProject.description.ilike(f"%{search}%"),
            )
        )
    if start_date_from:
        parsed = safe_parse_date(start_date_from)
        if parsed:
            query = query.filter(ISProject.start_date >= parsed)
    if start_date_to:
        parsed = safe_parse_date(start_date_to)
        if parsed:
            query = query.filter(ISProject.start_date <= parsed)
    if end_date_from:
        parsed = safe_parse_date(end_date_from)
        if parsed:
            query = query.filter(ISProject.target_end_date >= parsed)
    if end_date_to:
        parsed = safe_parse_date(end_date_to)
        if parsed:
            query = query.filter(ISProject.target_end_date <= parsed)

    total = query.count()
    projects = (
        query.options(
            subqueryload(ISProject.milestones),
            subqueryload(ISProject.tasks),
            subqueryload(ISProject.team_members),
            subqueryload(ISProject.risks),
        )
        .order_by(ISProject.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [serialize_project(p) for p in projects],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/my-projects")
def list_my_projects(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    owned = db.query(ISProject).filter(
        ISProject.tenant_id == tenant_id,
        ISProject.project_owner_id == current_user.id,
    ).options(
        subqueryload(ISProject.milestones),
        subqueryload(ISProject.tasks),
        subqueryload(ISProject.team_members),
        subqueryload(ISProject.risks),
    ).all()

    member_project_ids = db.query(ISProjectTeamMember.project_id).filter(
        ISProjectTeamMember.user_id == current_user.id,
    ).subquery()

    member_of = db.query(ISProject).filter(
        ISProject.tenant_id == tenant_id,
        ISProject.id.in_(member_project_ids),
        ISProject.project_owner_id != current_user.id,
    ).options(
        subqueryload(ISProject.milestones),
        subqueryload(ISProject.tasks),
        subqueryload(ISProject.team_members),
        subqueryload(ISProject.risks),
    ).all()

    owned_ids = {p.id for p in owned}

    return {
        "owned": [serialize_project(p) for p in owned],
        "member_of": [serialize_project(p) for p in member_of if p.id not in owned_ids],
        "total": len(owned) + len([p for p in member_of if p.id not in owned_ids]),
    }


@router.get("/dashboard")
def portfolio_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    projects = db.query(ISProject).filter(ISProject.tenant_id == tenant_id).options(
        subqueryload(ISProject.milestones),
    ).all()

    status_dist = {}
    category_dist = {}
    health_counts = {"On Track": 0, "At Risk": 0, "Off Track": 0}
    total_budget_est = 0
    total_budget_act = 0
    upcoming_milestones = []
    overdue_milestones = []
    now = datetime.utcnow()

    for p in projects:
        status_dist[p.status] = status_dist.get(p.status, 0) + 1
        category_dist[p.category] = category_dist.get(p.category, 0) + 1
        if p.health in health_counts:
            health_counts[p.health] += 1
        total_budget_est += p.budget_estimated or 0
        total_budget_act += p.budget_actual or 0

        for m in (p.milestones or []):
            if m.status != "Completed" and m.target_date:
                if m.target_date < now:
                    overdue_milestones.append({
                        "id": m.id,
                        "name": m.name,
                        "project_id": p.id,
                        "project_name": p.name,
                        "target_date": m.target_date.isoformat(),
                        "status": m.status,
                    })
                else:
                    upcoming_milestones.append({
                        "id": m.id,
                        "name": m.name,
                        "project_id": p.id,
                        "project_name": p.name,
                        "target_date": m.target_date.isoformat(),
                        "status": m.status,
                    })

    upcoming_milestones.sort(key=lambda x: x["target_date"])
    overdue_milestones.sort(key=lambda x: x["target_date"])

    return {
        "total_projects": len(projects),
        "status_distribution": [{"name": k, "value": v} for k, v in status_dist.items()],
        "category_distribution": [{"name": k, "value": v} for k, v in category_dist.items()],
        "health_counts": health_counts,
        "budget": {
            "total_estimated": total_budget_est,
            "total_actual": total_budget_act,
            "utilization": round((total_budget_act / total_budget_est * 100), 1) if total_budget_est > 0 else 0,
        },
        "upcoming_milestones": upcoming_milestones[:10],
        "overdue_milestones": overdue_milestones[:10],
    }


@router.get("/dashboard/enhanced-analytics")
def get_enhanced_analytics(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    projects = db.query(ISProject).filter(ISProject.tenant_id == tenant_id).options(
        subqueryload(ISProject.team_members),
        subqueryload(ISProject.budget_items),
        subqueryload(ISProject.milestones),
    ).all()

    health_distribution = {"On Track": 0, "At Risk": 0, "Off Track": 0}
    budget_data = []
    team_utilization = {}
    framework_alignment = {}

    for p in projects:
        health_distribution[p.health] = health_distribution.get(p.health, 0) + 1
        budget_data.append({
            "project_id": p.id, "project_name": p.name,
            "budget_estimated": p.budget_estimated or 0, "budget_actual": p.budget_actual or 0,
            "burn_rate_pct": round((p.budget_actual or 0) / (p.budget_estimated or 1) * 100, 1),
            "status": p.status,
        })
        for tm in (p.team_members or []):
            key = tm.user_name or tm.email or f"user_{tm.user_id}"
            if key not in team_utilization:
                team_utilization[key] = {"name": key, "projects": [], "total_projects": 0}
            team_utilization[key]["projects"].append({"project_id": p.id, "project_name": p.name, "role": tm.role})
            team_utilization[key]["total_projects"] += 1
        for fw in (p.linked_frameworks or []):
            fw_name = fw if isinstance(fw, str) else str(fw)
            if fw_name not in framework_alignment:
                framework_alignment[fw_name] = []
            framework_alignment[fw_name].append({"project_id": p.id, "project_name": p.name, "status": p.status})

    upcoming_milestones = []
    overdue_milestones = []
    now = datetime.utcnow()
    for p in projects:
        for m in (p.milestones or []):
            if m.status not in ("Completed", "Cancelled") and m.target_date:
                entry = {"project_name": p.name, "milestone_name": m.name, "target_date": m.target_date.isoformat(), "completion_pct": m.completion_percentage}
                if m.target_date < now:
                    overdue_milestones.append(entry)
                else:
                    upcoming_milestones.append(entry)
    upcoming_milestones.sort(key=lambda x: x["target_date"])
    overdue_milestones.sort(key=lambda x: x["target_date"])

    return {
        "health_distribution": health_distribution,
        "budget_overview": budget_data,
        "team_utilization": list(team_utilization.values()),
        "framework_alignment": framework_alignment,
        "upcoming_milestones": upcoming_milestones[:10],
        "overdue_milestones": overdue_milestones[:10],
        "total_projects": len(projects),
        "active_projects": len([p for p in projects if p.status in ("Planning", "In Progress")]),
    }


@router.get("/dashboard/health-trend")
def get_health_trend(db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    projects = db.query(ISProject).filter(ISProject.tenant_id == tenant_id).all()
    current = {"On Track": 0, "At Risk": 0, "Off Track": 0}
    for p in projects:
        current[p.health] = current.get(p.health, 0) + 1

    today = datetime.utcnow().date()
    existing_today = db.query(ISProjectHealthSnapshot).filter(
        ISProjectHealthSnapshot.tenant_id == tenant_id,
        func.date(ISProjectHealthSnapshot.snapshot_date) == today
    ).first()
    if not existing_today and len(projects) > 0:
        snapshot = ISProjectHealthSnapshot(
            tenant_id=tenant_id,
            snapshot_date=datetime.utcnow(),
            on_track=current["On Track"],
            at_risk=current["At Risk"],
            off_track=current["Off Track"],
            total_projects=len(projects),
        )
        db.add(snapshot)
        db.commit()

    snapshots = db.query(ISProjectHealthSnapshot).filter(
        ISProjectHealthSnapshot.tenant_id == tenant_id
    ).order_by(ISProjectHealthSnapshot.snapshot_date.desc()).limit(30).all()

    trend_data = []
    for s in reversed(snapshots):
        total = s.total_projects or 1
        trend_data.append({
            "date": s.snapshot_date.strftime("%Y-%m-%d"),
            "on_track": s.on_track,
            "at_risk": s.at_risk,
            "off_track": s.off_track,
            "total": s.total_projects,
            "health_score": round((s.on_track / total) * 100),
        })
    if not trend_data:
        total = len(projects) or 1
        trend_data.append({
            "date": today.isoformat(),
            "on_track": current["On Track"],
            "at_risk": current["At Risk"],
            "off_track": current["Off Track"],
            "total": len(projects),
            "health_score": round((current["On Track"] / total) * 100),
        })

    return {"trend": trend_data, "current": current}


@router.post("", status_code=201)
def create_project(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = ISProject(
        tenant_id=tenant_id,
        name=data.get("name", "Untitled Project"),
        description=data.get("description"),
        category=data.get("category", "Other"),
        priority=data.get("priority", "Medium"),
        status=data.get("status", "Planning"),
        health=data.get("health", "On Track"),
        project_owner_id=data.get("project_owner_id", current_user.id),
        project_owner_name=data.get("project_owner_name", current_user.email),
        sponsor=data.get("sponsor"),
        department=data.get("department"),
        start_date=safe_parse_date(data.get("start_date")),
        target_end_date=safe_parse_date(data.get("target_end_date")),
        budget_estimated=data.get("budget_estimated", 0),
        budget_actual=data.get("budget_actual", 0),
        business_justification=data.get("business_justification"),
        linked_risks=data.get("linked_risks", []),
        linked_controls=data.get("linked_controls", []),
        linked_frameworks=data.get("linked_frameworks", []),
        created_by=current_user.id,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@router.get("/{project_id}")
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(
        ISProject.id == project_id,
        ISProject.tenant_id == tenant_id,
    ).options(
        subqueryload(ISProject.milestones),
        subqueryload(ISProject.tasks),
        subqueryload(ISProject.team_members),
        subqueryload(ISProject.risks),
        subqueryload(ISProject.status_updates),
        subqueryload(ISProject.documents),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    result = serialize_project(project)
    result["milestones"] = [serialize_milestone(m) for m in (project.milestones or [])]
    result["tasks"] = [serialize_task(t) for t in (project.tasks or [])]
    result["team_members"] = [serialize_team_member(tm) for tm in (project.team_members or [])]
    result["status_updates"] = [serialize_status_update(su) for su in (project.status_updates or [])]
    result["risks_issues"] = [serialize_risk(r) for r in (project.risks or [])]
    result["documents"] = [serialize_document(d) for d in (project.documents or [])]
    return result


@router.put("/{project_id}")
def update_project(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(
        ISProject.id == project_id,
        ISProject.tenant_id == tenant_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    updatable = [
        "name", "description", "category", "priority", "status", "health",
        "project_owner_id", "project_owner_name", "sponsor", "department",
        "budget_estimated", "budget_actual", "business_justification",
        "linked_risks", "linked_controls", "linked_frameworks", "completion_percentage",
    ]
    for field in updatable:
        if field in data:
            setattr(project, field, data[field])

    if "start_date" in data:
        project.start_date = safe_parse_date(data["start_date"])
    if "target_end_date" in data:
        project.target_end_date = safe_parse_date(data["target_end_date"])
    if "actual_end_date" in data:
        project.actual_end_date = safe_parse_date(data["actual_end_date"])

    project.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(project)
    return serialize_project(project)


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(
        ISProject.id == project_id,
        ISProject.tenant_id == tenant_id,
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": "Project deleted"}


# ─── Milestones CRUD ────────────────────────────────────────────────────────

@router.get("/{project_id}/milestones")
def list_milestones(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    milestones = db.query(ISProjectMilestone).filter(
        ISProjectMilestone.project_id == project_id
    ).order_by(ISProjectMilestone.sort_order, ISProjectMilestone.target_date).all()
    return [serialize_milestone(m) for m in milestones]


@router.post("/{project_id}/milestones")
def create_milestone(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    milestone = ISProjectMilestone(
        project_id=project_id,
        name=data.get("name", ""),
        description=data.get("description"),
        target_date=safe_parse_date(data.get("target_date")),
        status=data.get("status", "Pending"),
        deliverables=data.get("deliverables", []),
        completion_percentage=data.get("completion_percentage", 0),
        sort_order=data.get("sort_order", 0),
    )
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return serialize_milestone(milestone)


@router.put("/{project_id}/milestones/{milestone_id}")
def update_milestone(
    project_id: int,
    milestone_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    milestone = db.query(ISProjectMilestone).filter(
        ISProjectMilestone.id == milestone_id, ISProjectMilestone.project_id == project_id
    ).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")

    for field in ["name", "description", "status", "deliverables", "completion_percentage", "sort_order"]:
        if field in data:
            setattr(milestone, field, data[field])
    if "target_date" in data:
        milestone.target_date = safe_parse_date(data["target_date"])
    if "actual_completion_date" in data:
        milestone.actual_completion_date = safe_parse_date(data["actual_completion_date"])
    milestone.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(milestone)
    return serialize_milestone(milestone)


@router.delete("/{project_id}/milestones/{milestone_id}")
def delete_milestone(
    project_id: int,
    milestone_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    milestone = db.query(ISProjectMilestone).filter(
        ISProjectMilestone.id == milestone_id, ISProjectMilestone.project_id == project_id
    ).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    db.delete(milestone)
    db.commit()
    return {"message": "Milestone deleted"}


# ─── Milestone Evidence ──────────────────────────────────────────────────────

def _get_milestone(project_id: int, milestone_id: int, tenant_id: int, db: Session) -> ISProjectMilestone:
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    milestone = db.query(ISProjectMilestone).filter(
        ISProjectMilestone.id == milestone_id, ISProjectMilestone.project_id == project_id
    ).first()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return milestone


def _serialize_milestone_evidence(link: ISProjectMilestoneEvidence) -> dict:
    ev = link.evidence
    return {
        "id": link.id,
        "evidence_id": ev.id,
        "name": ev.name,
        "file_name": ev.file_name,
        "file_type": ev.file_type,
        "file_path": ev.file_path,
        "uploaded_by_name": link.uploaded_by_name or "",
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "status": ev.status,
    }


@router.get("/{project_id}/milestones/{milestone_id}/evidence")
def list_milestone_evidence(
    project_id: int,
    milestone_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    _get_milestone(project_id, milestone_id, tenant_id, db)
    links = (
        db.query(ISProjectMilestoneEvidence)
        .filter(ISProjectMilestoneEvidence.milestone_id == milestone_id)
        .order_by(ISProjectMilestoneEvidence.created_at.desc())
        .all()
    )
    return [_serialize_milestone_evidence(lnk) for lnk in links]


@router.post("/{project_id}/milestones/{milestone_id}/evidence")
async def upload_milestone_evidence(
    project_id: int,
    milestone_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    milestone = _get_milestone(project_id, milestone_id, tenant_id, db)
    project = db.query(ISProject).filter(ISProject.id == project_id).first()

    # Save file to disk
    file_ext = os.path.splitext(file.filename)[1] if file.filename else ""
    file_id = str(uuid.uuid4())
    file_path = os.path.join(MILESTONE_EVIDENCE_DIR, f"{file_id}{file_ext}")
    contents = await file.read()
    with open(file_path, "wb") as fh:
        fh.write(contents)

    # Create central Evidence record
    evidence = Evidence(
        tenant_id=tenant_id,
        name=file.filename or "milestone_evidence",
        description=(
            f"Milestone evidence for project '{project.name}' — milestone '{milestone.name}'"
        ),
        file_path=file_path,
        file_name=file.filename,
        file_type=file.content_type,
        uploaded_by=current_user.id,
        status="draft",
        source_system="IS Project Milestone",
    )
    db.add(evidence)
    db.flush()

    # Create link record
    link = ISProjectMilestoneEvidence(
        milestone_id=milestone_id,
        evidence_id=evidence.id,
        uploaded_by_name=current_user.email,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return _serialize_milestone_evidence(link)


@router.delete("/{project_id}/milestones/{milestone_id}/evidence/{link_id}")
def delete_milestone_evidence(
    project_id: int,
    milestone_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    _get_milestone(project_id, milestone_id, tenant_id, db)
    link = db.query(ISProjectMilestoneEvidence).filter(
        ISProjectMilestoneEvidence.id == link_id,
        ISProjectMilestoneEvidence.milestone_id == milestone_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Evidence not found")

    evidence = link.evidence
    file_path = evidence.file_path if evidence else None

    db.delete(link)
    if evidence:
        db.delete(evidence)
    db.commit()

    if file_path and os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass

    return {"message": "Evidence deleted"}


# ─── Tasks CRUD ──────────────────────────────────────────────────────────────

@router.get("/{project_id}/tasks")
def list_tasks(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    tasks = db.query(ISProjectTask).filter(
        ISProjectTask.project_id == project_id
    ).order_by(ISProjectTask.sort_order, ISProjectTask.due_date).all()
    return [serialize_task(t) for t in tasks]


@router.post("/{project_id}/tasks")
def create_task(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task = ISProjectTask(
        project_id=project_id,
        title=data.get("title", ""),
        description=data.get("description"),
        assignee_id=data.get("assignee_id"),
        assignee_name=data.get("assignee_name"),
        status=data.get("status", "To Do"),
        priority=data.get("priority", "Medium"),
        due_date=safe_parse_date(data.get("due_date")),
        dependencies=data.get("dependencies", []),
        progress=data.get("progress", 0),
        sort_order=data.get("sort_order", 0),
    )
    if task.status in ("Done", "Completed") and not task.completed_date:
        task.completed_date = datetime.utcnow()
    db.add(task)
    _recalculate_project_completion(db, project)
    project.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.put("/{project_id}/tasks/{task_id}")
def update_task(
    project_id: int,
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task = db.query(ISProjectTask).filter(
        ISProjectTask.id == task_id, ISProjectTask.project_id == project_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for field in ["title", "description", "assignee_id", "assignee_name", "status", "priority", "dependencies", "progress", "sort_order"]:
        if field in data:
            setattr(task, field, data[field])
    if "due_date" in data:
        task.due_date = safe_parse_date(data["due_date"])
    if "completed_date" in data:
        task.completed_date = safe_parse_date(data["completed_date"])
    if "status" in data and "completed_date" not in data:
        if task.status in ("Done", "Completed") and not task.completed_date:
            task.completed_date = datetime.utcnow()
        elif task.status not in ("Done", "Completed"):
            task.completed_date = None
    task.updated_at = datetime.utcnow()
    _recalculate_project_completion(db, project)
    project.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.delete("/{project_id}/tasks/{task_id}")
def delete_task(
    project_id: int,
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task = db.query(ISProjectTask).filter(
        ISProjectTask.id == task_id, ISProjectTask.project_id == project_id
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    _recalculate_project_completion(db, project)
    project.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Task deleted"}


# ─── Team Members CRUD ──────────────────────────────────────────────────────

@router.get("/{project_id}/team")
def list_team_members(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    members = db.query(ISProjectTeamMember).filter(
        ISProjectTeamMember.project_id == project_id
    ).all()
    return [serialize_team_member(tm) for tm in members]


@router.post("/{project_id}/team")
def add_team_member(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    member = ISProjectTeamMember(
        project_id=project_id,
        user_id=data.get("user_id"),
        user_name=data.get("user_name", ""),
        email=data.get("email"),
        role=data.get("role", "Member"),
        responsibilities=data.get("responsibilities"),
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return serialize_team_member(member)


@router.put("/{project_id}/team/{member_id}")
def update_team_member(
    project_id: int,
    member_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    member = db.query(ISProjectTeamMember).filter(
        ISProjectTeamMember.id == member_id, ISProjectTeamMember.project_id == project_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    for field in ["user_id", "user_name", "email", "role", "responsibilities"]:
        if field in data:
            setattr(member, field, data[field])
    db.commit()
    db.refresh(member)
    return serialize_team_member(member)


@router.delete("/{project_id}/team/{member_id}")
def remove_team_member(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    member = db.query(ISProjectTeamMember).filter(
        ISProjectTeamMember.id == member_id, ISProjectTeamMember.project_id == project_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    db.delete(member)
    db.commit()
    return {"message": "Team member removed"}


# ─── Status Updates CRUD ────────────────────────────────────────────────────

@router.get("/{project_id}/updates")
def list_status_updates(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    updates = db.query(ISProjectStatusUpdate).filter(
        ISProjectStatusUpdate.project_id == project_id
    ).order_by(ISProjectStatusUpdate.update_date.desc()).all()
    return [serialize_status_update(su) for su in updates]


@router.post("/{project_id}/updates")
def create_status_update(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    update = ISProjectStatusUpdate(
        project_id=project_id,
        author_id=current_user.id,
        author_name=data.get("author_name", current_user.email),
        health_status=data.get("health_status", "On Track"),
        what_was_done=data.get("what_was_done"),
        whats_planned=data.get("whats_planned"),
        blockers=data.get("blockers"),
        notes=data.get("notes"),
    )
    db.add(update)

    if data.get("health_status"):
        project.health = data["health_status"]
        project.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(update)
    return serialize_status_update(update)


@router.put("/{project_id}/updates/{update_id}")
def update_status_update(
    project_id: int,
    update_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    update = db.query(ISProjectStatusUpdate).filter(
        ISProjectStatusUpdate.id == update_id, ISProjectStatusUpdate.project_id == project_id
    ).first()
    if not update:
        raise HTTPException(status_code=404, detail="Status update not found")

    for field in ["health_status", "what_was_done", "whats_planned", "blockers", "notes"]:
        if field in data:
            setattr(update, field, data[field])
    db.commit()
    db.refresh(update)
    return serialize_status_update(update)


@router.delete("/{project_id}/updates/{update_id}")
def delete_status_update(
    project_id: int,
    update_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    update = db.query(ISProjectStatusUpdate).filter(
        ISProjectStatusUpdate.id == update_id, ISProjectStatusUpdate.project_id == project_id
    ).first()
    if not update:
        raise HTTPException(status_code=404, detail="Status update not found")
    db.delete(update)
    db.commit()
    return {"message": "Status update deleted"}


# ─── Risks & Issues CRUD ────────────────────────────────────────────────────

@router.get("/{project_id}/risks")
def list_risks(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    risks = db.query(ISProjectRisk).filter(
        ISProjectRisk.project_id == project_id
    ).order_by(ISProjectRisk.created_at.desc()).all()
    return [serialize_risk(r) for r in risks]


@router.post("/{project_id}/risks")
def create_risk(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    risk = ISProjectRisk(
        project_id=project_id,
        title=data.get("title", ""),
        description=data.get("description"),
        type=data.get("type", "Risk"),
        severity=data.get("severity", "Medium"),
        status=data.get("status", "Open"),
        mitigation=data.get("mitigation"),
        owner_name=data.get("owner_name"),
    )
    db.add(risk)
    db.commit()
    db.refresh(risk)
    return serialize_risk(risk)


@router.put("/{project_id}/risks/{risk_id}")
def update_risk(
    project_id: int,
    risk_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    risk = db.query(ISProjectRisk).filter(
        ISProjectRisk.id == risk_id, ISProjectRisk.project_id == project_id
    ).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")

    for field in ["title", "description", "type", "severity", "status", "mitigation", "owner_name"]:
        if field in data:
            setattr(risk, field, data[field])
    if "resolved_date" in data:
        risk.resolved_date = safe_parse_date(data["resolved_date"])
    risk.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(risk)
    return serialize_risk(risk)


@router.delete("/{project_id}/risks/{risk_id}")
def delete_risk(
    project_id: int,
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    risk = db.query(ISProjectRisk).filter(
        ISProjectRisk.id == risk_id, ISProjectRisk.project_id == project_id
    ).first()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    db.delete(risk)
    db.commit()
    return {"message": "Risk deleted"}


# ─── Documents CRUD ─────────────────────────────────────────────────────────

def _project_document_path(tenant_id: int, project_id: int, stored_name: str) -> str:
    project_dir = os.path.join(IS_PROJECT_DOCUMENT_DIR, str(tenant_id), str(project_id))
    os.makedirs(project_dir, exist_ok=True)
    return os.path.join(project_dir, stored_name)


@router.get("/{project_id}/documents")
def list_documents(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    docs = db.query(ISProjectDocument).filter(
        ISProjectDocument.project_id == project_id
    ).order_by(ISProjectDocument.created_at.desc()).all()
    return [serialize_document(d) for d in docs]


@router.post("/{project_id}/documents")
def add_document(
    project_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = ISProjectDocument(
        project_id=project_id,
        title=data.get("title", ""),
        description=data.get("description"),
        document_type=data.get("document_type"),
        url=data.get("url"),
        reference_id=data.get("reference_id"),
        reference_type=data.get("reference_type"),
        created_by_name=data.get("created_by_name", current_user.email),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.post("/{project_id}/documents/upload")
async def upload_document(
    project_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    document_type: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    original_name = file.filename or "document"
    _, ext = os.path.splitext(original_name)
    stored_name = f"{uuid.uuid4().hex}{ext.lower()}"
    file_path = _project_document_path(tenant_id, project_id, stored_name)
    with open(file_path, "wb") as f:
        f.write(content)

    doc = ISProjectDocument(
        project_id=project_id,
        title=(title or os.path.splitext(original_name)[0] or "Document").strip(),
        description=description,
        document_type=document_type or "Reference",
        url=original_name,
        reference_id=stored_name,
        reference_type="uploaded_file",
        created_by_name=current_user.email,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.get("/{project_id}/documents/{document_id}/download")
def download_document(
    project_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    doc = db.query(ISProjectDocument).filter(
        ISProjectDocument.id == document_id,
        ISProjectDocument.project_id == project_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.reference_type != "uploaded_file" or not doc.reference_id:
        raise HTTPException(status_code=400, detail="Document is not an uploaded file")

    file_path = _project_document_path(tenant_id, project_id, doc.reference_id)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    download_name = (doc.url or doc.title or "document").strip()
    if "." not in os.path.basename(download_name):
        _, stored_ext = os.path.splitext(doc.reference_id)
        if stored_ext:
            download_name += stored_ext

    return FileResponse(
        path=file_path,
        filename=download_name,
        media_type="application/octet-stream",
    )


@router.put("/{project_id}/documents/{document_id}")
def update_document(
    project_id: int,
    document_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = db.query(ISProjectDocument).filter(
        ISProjectDocument.id == document_id, ISProjectDocument.project_id == project_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    for field in ["title", "description", "document_type", "url", "reference_id", "reference_type"]:
        if field in data:
            setattr(doc, field, data[field])
    db.commit()
    db.refresh(doc)
    return serialize_document(doc)


@router.delete("/{project_id}/documents/{document_id}")
def remove_document(
    project_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    doc = db.query(ISProjectDocument).filter(
        ISProjectDocument.id == document_id, ISProjectDocument.project_id == project_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    file_path = None
    if doc.reference_type == "uploaded_file" and doc.reference_id:
        file_path = _project_document_path(tenant_id, project_id, doc.reference_id)
    db.delete(doc)
    db.commit()
    if file_path and os.path.isfile(file_path):
        try:
            os.remove(file_path)
        except OSError:
            pass
    return {"message": "Document removed"}


# ─── Budget Items CRUD ─────────────────────────────────────────────────────

@router.get("/{project_id}/budget-items")
def list_budget_items(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    items = db.query(ISProjectBudgetItem).filter(ISProjectBudgetItem.project_id == project_id).order_by(ISProjectBudgetItem.created_at.desc()).all()
    total_spent = sum(i.amount for i in items if i.status == "Approved")
    return {"items": [serialize_budget_item(i) for i in items], "total_spent": total_spent, "budget_estimated": project.budget_estimated or 0}


@router.post("/{project_id}/budget-items")
def create_budget_item(project_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not data.get("category"):
        raise HTTPException(status_code=422, detail="Category is required")
    try:
        amount_val = float(data.get("amount", 0))
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="Amount must be a valid number")
    item = ISProjectBudgetItem(
        project_id=project_id,
        description=data.get("description", ""),
        category=data.get("category"),
        amount=amount_val,
        date=safe_parse_date(data.get("date")),
        status=data.get("status", "Pending"),
        approved_by=data.get("approved_by"),
        notes=data.get("notes"),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return serialize_budget_item(item)


@router.put("/{project_id}/budget-items/{item_id}")
def update_budget_item(project_id: int, item_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    item = db.query(ISProjectBudgetItem).filter(ISProjectBudgetItem.id == item_id, ISProjectBudgetItem.project_id == project_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Budget item not found")
    for field in ["description", "category", "notes", "status", "approved_by"]:
        if field in data:
            setattr(item, field, data[field])
    if "amount" in data:
        try:
            item.amount = float(data["amount"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=422, detail="Amount must be a valid number")
    if "date" in data:
        item.date = safe_parse_date(data["date"])
    db.commit()
    db.refresh(item)
    return serialize_budget_item(item)


@router.delete("/{project_id}/budget-items/{item_id}")
def delete_budget_item(project_id: int, item_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    item = db.query(ISProjectBudgetItem).filter(ISProjectBudgetItem.id == item_id, ISProjectBudgetItem.project_id == project_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Budget item not found")
    db.delete(item)
    db.commit()
    return {"message": "Budget item deleted"}


# ─── Compliance Mappings CRUD ──────────────────────────────────────────────

@router.get("/{project_id}/compliance-mappings")
def list_compliance_mappings(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    mappings = db.query(ISProjectComplianceMapping).filter(ISProjectComplianceMapping.project_id == project_id).order_by(ISProjectComplianceMapping.framework_name).all()
    return [serialize_compliance_mapping(m) for m in mappings]


@router.post("/{project_id}/compliance-mappings")
def create_compliance_mapping(project_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not data.get("framework_name"):
        raise HTTPException(status_code=422, detail="Framework name is required")
    if not data.get("control_name"):
        raise HTTPException(status_code=422, detail="Control name is required")
    mapping = ISProjectComplianceMapping(
        project_id=project_id,
        control_id=data.get("control_id"),
        control_name=data.get("control_name"),
        framework_name=data.get("framework_name"),
        requirement_description=data.get("requirement_description"),
        deliverable=data.get("deliverable"),
        coverage_status=data.get("coverage_status", "Planned"),
        notes=data.get("notes"),
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return serialize_compliance_mapping(mapping)


@router.put("/{project_id}/compliance-mappings/{mapping_id}")
def update_compliance_mapping(project_id: int, mapping_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    mapping = db.query(ISProjectComplianceMapping).filter(ISProjectComplianceMapping.id == mapping_id, ISProjectComplianceMapping.project_id == project_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Compliance mapping not found")
    for field in ["control_id", "control_name", "framework_name", "requirement_description", "deliverable", "coverage_status", "notes"]:
        if field in data:
            setattr(mapping, field, data[field])
    db.commit()
    db.refresh(mapping)
    return serialize_compliance_mapping(mapping)


@router.delete("/{project_id}/compliance-mappings/{mapping_id}")
def delete_compliance_mapping(project_id: int, mapping_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    mapping = db.query(ISProjectComplianceMapping).filter(ISProjectComplianceMapping.id == mapping_id, ISProjectComplianceMapping.project_id == project_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Compliance mapping not found")
    db.delete(mapping)
    db.commit()
    return {"message": "Compliance mapping deleted"}


# ─── Lessons Learned CRUD ──────────────────────────────────────────────────

@router.get("/{project_id}/lessons-learned")
def list_lessons_learned(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    lessons = db.query(ISProjectLessonLearned).filter(ISProjectLessonLearned.project_id == project_id).order_by(ISProjectLessonLearned.created_at.desc()).all()
    return [serialize_lesson_learned(ll) for ll in lessons]


@router.post("/{project_id}/lessons-learned")
def create_lesson_learned(project_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if not data.get("title"):
        raise HTTPException(status_code=422, detail="Title is required")
    lesson = ISProjectLessonLearned(
        project_id=project_id,
        category=data.get("category", "Recommendation"),
        title=data.get("title", ""),
        description=data.get("description"),
        impact=data.get("impact"),
        linked_milestone_id=data.get("linked_milestone_id"),
        linked_task_id=data.get("linked_task_id"),
        author_name=data.get("author_name", current_user.email),
    )
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return serialize_lesson_learned(lesson)


@router.put("/{project_id}/lessons-learned/{lesson_id}")
def update_lesson_learned(project_id: int, lesson_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    lesson = db.query(ISProjectLessonLearned).filter(ISProjectLessonLearned.id == lesson_id, ISProjectLessonLearned.project_id == project_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    for field in ["category", "title", "description", "impact", "linked_milestone_id", "linked_task_id", "author_name"]:
        if field in data:
            setattr(lesson, field, data[field])
    db.commit()
    db.refresh(lesson)
    return serialize_lesson_learned(lesson)


@router.delete("/{project_id}/lessons-learned/{lesson_id}")
def delete_lesson_learned(project_id: int, lesson_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    lesson = db.query(ISProjectLessonLearned).filter(ISProjectLessonLearned.id == lesson_id, ISProjectLessonLearned.project_id == project_id).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    db.delete(lesson)
    db.commit()
    return {"message": "Lesson deleted"}


# ─── Dependencies CRUD ─────────────────────────────────────────────────────

@router.get("/{project_id}/dependencies")
def list_dependencies(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    deps = db.query(ISProjectDependency).filter(ISProjectDependency.project_id == project_id).order_by(ISProjectDependency.created_at.desc()).all()
    return [serialize_dependency(d) for d in deps]


@router.post("/{project_id}/dependencies")
def create_dependency(project_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    dep = ISProjectDependency(
        project_id=project_id,
        dependency_type=data.get("dependency_type", "internal"),
        dependent_project_id=data.get("dependent_project_id"),
        dependent_project_name=data.get("dependent_project_name"),
        external_dependency=data.get("external_dependency"),
        description=data.get("description"),
        status=data.get("status", "Active"),
        direction=data.get("direction", "depends_on"),
        impact_if_delayed=data.get("impact_if_delayed"),
        expected_date=safe_parse_date(data.get("expected_date")),
        resolved_date=safe_parse_date(data.get("resolved_date")),
    )
    db.add(dep)
    db.commit()
    db.refresh(dep)
    return serialize_dependency(dep)


@router.put("/{project_id}/dependencies/{dep_id}")
def update_dependency(project_id: int, dep_id: int, data: dict, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    dep = db.query(ISProjectDependency).filter(ISProjectDependency.id == dep_id, ISProjectDependency.project_id == project_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    for field in ["dependency_type", "dependent_project_id", "dependent_project_name", "external_dependency", "description", "status", "direction", "impact_if_delayed"]:
        if field in data:
            setattr(dep, field, data[field])
    if "expected_date" in data:
        dep.expected_date = safe_parse_date(data["expected_date"])
    if "resolved_date" in data:
        dep.resolved_date = safe_parse_date(data["resolved_date"])
    db.commit()
    db.refresh(dep)
    return serialize_dependency(dep)


@router.delete("/{project_id}/dependencies/{dep_id}")
def delete_dependency(project_id: int, dep_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    dep = db.query(ISProjectDependency).filter(ISProjectDependency.id == dep_id, ISProjectDependency.project_id == project_id).first()
    if not dep:
        raise HTTPException(status_code=404, detail="Dependency not found")
    db.delete(dep)
    db.commit()
    return {"message": "Dependency deleted"}


# ─── AI Endpoints ──────────────────────────────────────────────────────────

@router.post("/{project_id}/ai/generate-plan")
def ai_generate_plan(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    client = _get_openai_client()
    prompt = f"""You are an Information Security project management expert. Generate a detailed project plan for the following IS project.

Project Name: {project.name}
Category: {project.category}
Priority: {project.priority}
Description: {project.description or 'No description provided'}
Business Justification: {project.business_justification or 'Not specified'}
Start Date: {project.start_date.strftime('%Y-%m-%d') if project.start_date else 'Not set'}
Target End Date: {project.target_end_date.strftime('%Y-%m-%d') if project.target_end_date else 'Not set'}

Generate a comprehensive project plan with:
1. 4-6 milestones with names, descriptions, target dates (relative weeks from start), and key deliverables
2. 8-12 tasks with titles, descriptions, assignee role suggestions, priorities, and estimated durations
3. A suggested timeline narrative

Return ONLY valid JSON in this exact format:
{{
  "milestones": [
    {{"name": "...", "description": "...", "target_week": 2, "deliverables": ["..."], "completion_percentage": 0}}
  ],
  "tasks": [
    {{"title": "...", "description": "...", "suggested_role": "...", "priority": "High|Medium|Low", "estimated_days": 5, "milestone_index": 0}}
  ],
  "timeline_narrative": "..."
}}"""

    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=3000,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"success": True, "plan": result}
    except Exception as e:
        logger.error(f"AI plan generation failed: {e}")
        raise HTTPException(status_code=500, detail="AI generation failed. Please try again later.")


@router.post("/{project_id}/ai/assess-risks")
def ai_assess_risks(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing_risks = db.query(ISProjectRisk).filter(ISProjectRisk.project_id == project_id).all()
    existing_risk_titles = [r.title for r in existing_risks]

    client = _get_openai_client()
    prompt = f"""You are an Information Security risk assessment expert. Analyze the following IS project and identify potential risks, dependencies, and blockers.

Project Name: {project.name}
Category: {project.category}
Priority: {project.priority}
Description: {project.description or 'No description provided'}
Department: {project.department or 'Not specified'}
Budget: ${project.budget_estimated or 0:,.0f}

Existing identified risks: {', '.join(existing_risk_titles) if existing_risk_titles else 'None yet'}

Identify 5-8 NEW project-specific risks (not duplicating existing ones). For each risk, provide:
- Title, description, severity (Critical/High/Medium/Low), type (Risk or Issue)
- Mitigation strategy
- Potential impact if not addressed

Return ONLY valid JSON:
{{
  "risks": [
    {{"title": "...", "description": "...", "severity": "High", "type": "Risk", "mitigation": "...", "impact": "..."}}
  ],
  "overall_risk_rating": "High|Medium|Low",
  "key_recommendations": ["..."]
}}"""

    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2500,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"success": True, "assessment": result}
    except Exception as e:
        logger.error(f"AI risk assessment failed: {e}")
        raise HTTPException(status_code=500, detail="AI risk assessment failed. Please try again later.")


@router.post("/{project_id}/ai/draft-status-report")
def ai_draft_status_report(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).options(
        subqueryload(ISProject.milestones),
        subqueryload(ISProject.tasks),
        subqueryload(ISProject.risks),
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    milestones_summary = []
    for m in (project.milestones or []):
        milestones_summary.append(f"- {m.name}: {m.status} ({m.completion_percentage}% complete)")

    tasks_summary = {"To Do": 0, "In Progress": 0, "Done": 0, "Blocked": 0}
    for t in (project.tasks or []):
        bucket = "Done" if t.status in ("Done", "Completed") else ("In Progress" if t.status == "In Progress" else ("Blocked" if t.status == "Blocked" else "To Do"))
        tasks_summary[bucket] += 1

    open_risks = [r for r in (project.risks or []) if r.status == "Open"]
    risk_summary = [f"- [{r.severity}] {r.title}" for r in open_risks[:5]]

    client = _get_openai_client()
    prompt = f"""You are a project management expert. Draft a professional status update report for the following IS project.

Project: {project.name}
Status: {project.status} | Health: {project.health} | Completion: {project.completion_percentage}%
Category: {project.category} | Priority: {project.priority}

Milestones:
{chr(10).join(milestones_summary) if milestones_summary else 'No milestones yet'}

Task Distribution: {json.dumps(tasks_summary)}

Open Risks:
{chr(10).join(risk_summary) if risk_summary else 'No open risks'}

Budget: Estimated ${project.budget_estimated or 0:,.0f} | Actual ${project.budget_actual or 0:,.0f}

Write a concise status report with these sections:
1. What was accomplished this period
2. What is planned next
3. Current blockers or concerns
4. Overall health assessment

Return ONLY valid JSON:
{{
  "what_was_done": "...",
  "whats_planned": "...",
  "blockers": "...",
  "notes": "...",
  "suggested_health": "On Track|At Risk|Off Track"
}}"""

    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=1500,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"success": True, "report": result}
    except Exception as e:
        logger.error(f"AI status report failed: {e}")
        raise HTTPException(status_code=500, detail="AI report generation failed. Please try again later.")


@router.post("/{project_id}/ai/suggest-team")
def ai_suggest_team(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    existing_team = db.query(ISProjectTeamMember).filter(ISProjectTeamMember.project_id == project_id).all()
    existing_roles = [f"{tm.role}: {tm.user_name}" for tm in existing_team]

    client = _get_openai_client()
    prompt = f"""You are an Information Security staffing expert. Recommend the ideal team composition for this IS project.

Project: {project.name}
Category: {project.category}
Priority: {project.priority}
Description: {project.description or 'No description provided'}
Department: {project.department or 'Not specified'}
Budget: ${project.budget_estimated or 0:,.0f}

Current team: {', '.join(existing_roles) if existing_roles else 'No team assigned yet'}

Recommend 4-8 team roles needed, including:
- Role title, responsibilities, required skills, and estimated time commitment (percentage)
- Whether this role is critical or nice-to-have
- Any gaps in the current team

Return ONLY valid JSON:
{{
  "recommended_roles": [
    {{"role": "...", "responsibilities": "...", "required_skills": ["..."], "time_commitment_pct": 50, "criticality": "Critical|Important|Nice to Have"}}
  ],
  "team_gaps": ["..."],
  "total_fte_estimate": 3.5,
  "recommendations": "..."
}}"""

    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"success": True, "team_suggestion": result}
    except Exception as e:
        logger.error(f"AI team suggestion failed: {e}")
        raise HTTPException(status_code=500, detail="AI team suggestion failed. Please try again later.")


@router.post("/{project_id}/ai/estimate-budget")
def ai_estimate_budget(project_id: int, db: Session = Depends(get_db), current_user: GRCUser = Depends(require_auth)):
    tenant_id = get_user_primary_tenant(current_user, db)
    project = db.query(ISProject).filter(ISProject.id == project_id, ISProject.tenant_id == tenant_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    team_count = db.query(ISProjectTeamMember).filter(ISProjectTeamMember.project_id == project_id).count()
    milestone_count = db.query(ISProjectMilestone).filter(ISProjectMilestone.project_id == project_id).count()

    client = _get_openai_client()
    prompt = f"""You are an Information Security budget estimation expert. Estimate the budget for this IS project.

Project: {project.name}
Category: {project.category}
Priority: {project.priority}
Description: {project.description or 'No description provided'}
Department: {project.department or 'Not specified'}
Team Size: {team_count} members
Milestones: {milestone_count}
Duration: {project.start_date.strftime('%Y-%m-%d') if project.start_date else 'TBD'} to {project.target_end_date.strftime('%Y-%m-%d') if project.target_end_date else 'TBD'}
Current Estimate: ${project.budget_estimated or 0:,.0f}

Provide a detailed budget breakdown with:
- Line items by category (Personnel, Software/Licensing, Hardware, Consulting, Training, Contingency)
- Estimated amounts for each
- Assumptions made
- Risk buffer recommendation

Return ONLY valid JSON:
{{
  "line_items": [
    {{"category": "Personnel", "description": "...", "estimated_amount": 50000, "notes": "..."}}
  ],
  "total_estimated": 150000,
  "contingency_pct": 15,
  "assumptions": ["..."],
  "recommendations": "..."
}}"""

    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        result = json.loads(response.choices[0].message.content)
        return {"success": True, "budget_estimate": result}
    except Exception as e:
        logger.error(f"AI budget estimation failed: {e}")
        raise HTTPException(status_code=500, detail="AI budget estimation failed. Please try again later.")
