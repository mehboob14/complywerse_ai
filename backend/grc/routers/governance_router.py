from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..models import (
    GovernanceObjective, Exception, Issue,
    NormalizedControl, GRCUser, Tenant, get_db
)
from ..schemas import (
    GovernanceObjectiveCreate, GovernanceObjectiveUpdate, GovernanceObjectiveResponse,
    ExceptionCreate, ExceptionUpdate, ExceptionResponse, ExceptionApproval,
    IssueCreate, IssueUpdate, IssueResponse,
    GovernanceDashboard, MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/governance", tags=["Governance"])


@router.get("/objectives", response_model=List[GovernanceObjectiveResponse])
def list_objectives(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(GovernanceObjective)
    
    if tenant_id:
        query = query.filter(GovernanceObjective.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(GovernanceObjective.status == status_filter)
    
    objectives = query.offset(skip).limit(limit).all()
    return objectives


@router.post("/objectives", response_model=GovernanceObjectiveResponse, status_code=status.HTTP_201_CREATED)
def create_objective(
    objective: GovernanceObjectiveCreate,
    tenant_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    db_objective = GovernanceObjective(
        tenant_id=tenant_id,
        name=objective.name,
        description=objective.description,
        owner_id=objective.owner_id,
        target_date=objective.target_date
    )
    db.add(db_objective)
    db.commit()
    db.refresh(db_objective)
    return db_objective


@router.get("/objectives/{objective_id}", response_model=GovernanceObjectiveResponse)
def get_objective(
    objective_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    objective = db.query(GovernanceObjective).filter(
        GovernanceObjective.id == objective_id
    ).first()
    if not objective:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Objective not found"
        )
    return objective


@router.put("/objectives/{objective_id}", response_model=GovernanceObjectiveResponse)
def update_objective(
    objective_id: int,
    objective_update: GovernanceObjectiveUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    objective = db.query(GovernanceObjective).filter(
        GovernanceObjective.id == objective_id
    ).first()
    if not objective:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Objective not found"
        )
    
    update_data = objective_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(objective, field, value)
    
    db.commit()
    db.refresh(objective)
    return objective


@router.delete("/objectives/{objective_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_objective(
    objective_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    objective = db.query(GovernanceObjective).filter(
        GovernanceObjective.id == objective_id
    ).first()
    if not objective:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Objective not found"
        )
    
    db.delete(objective)
    db.commit()
    return None


@router.get("/exceptions", response_model=List[ExceptionResponse])
def list_exceptions(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Exception)
    
    if tenant_id:
        query = query.filter(Exception.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(Exception.status == status_filter)
    
    exceptions = query.offset(skip).limit(limit).all()
    return exceptions


@router.post("/exceptions", response_model=ExceptionResponse, status_code=status.HTTP_201_CREATED)
def create_exception(
    exception: ExceptionCreate,
    tenant_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    if exception.normalized_control_id:
        control = db.query(NormalizedControl).filter(
            NormalizedControl.id == exception.normalized_control_id
        ).first()
        if not control:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Control not found"
            )
    
    db_exception = Exception(
        tenant_id=tenant_id,
        title=exception.title,
        justification=exception.justification,
        normalized_control_id=exception.normalized_control_id,
        expiry_date=exception.expiry_date
    )
    db.add(db_exception)
    db.commit()
    db.refresh(db_exception)
    return db_exception


@router.put("/exceptions/{exception_id}", response_model=ExceptionResponse)
def update_exception(
    exception_id: int,
    exception_update: ExceptionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    exception = db.query(Exception).filter(Exception.id == exception_id).first()
    if not exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exception not found"
        )
    
    update_data = exception_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(exception, field, value)
    
    db.commit()
    db.refresh(exception)
    return exception


@router.post("/exceptions/{exception_id}/approve", response_model=ExceptionResponse)
def approve_exception(
    exception_id: int,
    approval: ExceptionApproval,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    exception = db.query(Exception).filter(Exception.id == exception_id).first()
    if not exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Exception not found"
        )
    
    if approval.approved:
        exception.status = "approved"
        exception.approved_by = current_user.id
        exception.approval_date = datetime.utcnow()
    else:
        exception.status = "rejected"
    
    db.commit()
    db.refresh(exception)
    return exception


@router.get("/issues", response_model=List[IssueResponse])
def list_issues(
    tenant_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    severity: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(Issue)
    
    if tenant_id:
        query = query.filter(Issue.tenant_id == tenant_id)
    if status_filter:
        query = query.filter(Issue.status == status_filter)
    if severity:
        query = query.filter(Issue.severity == severity)
    
    issues = query.order_by(Issue.created_at.desc()).offset(skip).limit(limit).all()
    return issues


@router.post("/issues", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
def create_issue(
    issue: IssueCreate,
    tenant_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    db_issue = Issue(
        tenant_id=tenant_id,
        title=issue.title,
        description=issue.description,
        severity=issue.severity,
        owner_id=issue.owner_id,
        due_date=issue.due_date
    )
    db.add(db_issue)
    db.commit()
    db.refresh(db_issue)
    return db_issue


@router.put("/issues/{issue_id}", response_model=IssueResponse)
def update_issue(
    issue_id: int,
    issue_update: IssueUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    update_data = issue_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(issue, field, value)
    
    db.commit()
    db.refresh(issue)
    return issue


@router.post("/issues/{issue_id}/close", response_model=IssueResponse)
def close_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found"
        )
    
    issue.status = "closed"
    issue.closed_at = datetime.utcnow()
    db.commit()
    db.refresh(issue)
    return issue


@router.get("/dashboard", response_model=GovernanceDashboard)
def get_governance_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    obj_query = db.query(GovernanceObjective)
    exc_query = db.query(Exception)
    issue_query = db.query(Issue)
    
    if tenant_id:
        obj_query = obj_query.filter(GovernanceObjective.tenant_id == tenant_id)
        exc_query = exc_query.filter(Exception.tenant_id == tenant_id)
        issue_query = issue_query.filter(Issue.tenant_id == tenant_id)
    
    objectives = obj_query.all()
    exceptions = exc_query.all()
    issues = issue_query.all()
    
    objectives_by_status = {}
    for obj in objectives:
        objectives_by_status[obj.status] = objectives_by_status.get(obj.status, 0) + 1
    
    exceptions_by_status = {}
    pending_exceptions = 0
    for exc in exceptions:
        exceptions_by_status[exc.status] = exceptions_by_status.get(exc.status, 0) + 1
        if exc.status == "pending":
            pending_exceptions += 1
    
    issues_by_status = {}
    issues_by_severity = {}
    open_issues = 0
    for issue in issues:
        issues_by_status[issue.status] = issues_by_status.get(issue.status, 0) + 1
        issues_by_severity[issue.severity] = issues_by_severity.get(issue.severity, 0) + 1
        if issue.status in ["open", "in_progress"]:
            open_issues += 1
    
    return GovernanceDashboard(
        total_objectives=len(objectives),
        objectives_by_status=objectives_by_status,
        total_exceptions=len(exceptions),
        exceptions_by_status=exceptions_by_status,
        pending_exceptions=pending_exceptions,
        total_issues=len(issues),
        issues_by_status=issues_by_status,
        issues_by_severity=issues_by_severity,
        open_issues=open_issues
    )
