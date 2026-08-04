from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    GRCDepartment, GRCDepartmentMember, GRCVulnerabilityDepartmentAssignment,
    GRCDepartmentEscalationPath, Vulnerability, GRCUser, get_db
)
from ....schemas import (
    GRCDepartmentCreate, GRCDepartmentUpdate, GRCDepartmentResponse, GRCDepartmentDetailResponse,
    GRCDepartmentMemberCreate, GRCDepartmentMemberResponse,
    GRCVulnerabilityDepartmentAssignmentCreate, GRCVulnerabilityDepartmentAssignmentResponse,
    GRCDepartmentEscalationPathCreate, GRCDepartmentEscalationPathResponse,
    BulkVulnerabilityAssignRequest, BulkVulnerabilityAssignResponse,
    VulnerabilityResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ..services.email_service import EmailService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Departments"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_department_or_404(dept_id: int, user_tenants: List[int], db: Session) -> GRCDepartment:
    dept = db.query(GRCDepartment).filter(
        GRCDepartment.id == dept_id,
        GRCDepartment.tenant_id.in_(user_tenants)
    ).first()
    if not dept:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Department not found"
        )
    return dept


@router.get("/departments", response_model=List[GRCDepartmentResponse])
def list_departments(
    tenant_id: Optional[int] = None,
    parent_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(GRCDepartment).filter(GRCDepartment.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GRCDepartment.tenant_id == tenant_id)
    if parent_id is not None:
        query = query.filter(GRCDepartment.parent_department_id == parent_id)
    if is_active is not None:
        query = query.filter(GRCDepartment.is_active == is_active)
    if search:
        query = query.filter(
            (GRCDepartment.name.ilike(f"%{search}%")) | 
            (GRCDepartment.code.ilike(f"%{search}%"))
        )
    
    departments = query.order_by(GRCDepartment.name).offset(skip).limit(limit).all()
    
    result = []
    for dept in departments:
        member_count = db.query(func.count(GRCDepartmentMember.id)).filter(
            GRCDepartmentMember.department_id == dept.id,
            GRCDepartmentMember.is_active == True
        ).scalar() or 0
        
        result.append(GRCDepartmentResponse(
            id=dept.id,
            tenant_id=dept.tenant_id,
            name=dept.name,
            code=dept.code,
            description=dept.description,
            parent_department_id=dept.parent_department_id,
            parent_department_name=dept.parent_department.name if dept.parent_department else None,
            department_head_user_id=dept.department_head_user_id,
            department_head_name=dept.department_head.display_name if dept.department_head else None,
            is_active=dept.is_active,
            created_at=dept.created_at,
            updated_at=dept.updated_at,
            member_count=member_count
        ))
    
    return result


@router.post("/departments", response_model=GRCDepartmentResponse, status_code=status.HTTP_201_CREATED)
def create_department(
    request: GRCDepartmentCreate,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            tenant_id = user_tenants[0]
    
    existing = db.query(GRCDepartment).filter(
        GRCDepartment.tenant_id == tenant_id,
        (GRCDepartment.name == request.name) | (GRCDepartment.code == request.code)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Department with this name or code already exists")
    
    if request.parent_department_id:
        parent = db.query(GRCDepartment).filter(
            GRCDepartment.id == request.parent_department_id,
            GRCDepartment.tenant_id == tenant_id
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent department not found")
    
    dept = GRCDepartment(
        tenant_id=tenant_id,
        name=request.name,
        code=request.code,
        description=request.description,
        parent_department_id=request.parent_department_id,
        department_head_user_id=request.department_head_user_id
    )
    db.add(dept)
    db.commit()
    db.refresh(dept)
    
    return GRCDepartmentResponse(
        id=dept.id,
        tenant_id=dept.tenant_id,
        name=dept.name,
        code=dept.code,
        description=dept.description,
        parent_department_id=dept.parent_department_id,
        parent_department_name=None,
        department_head_user_id=dept.department_head_user_id,
        department_head_name=dept.department_head.display_name if dept.department_head else None,
        is_active=dept.is_active,
        created_at=dept.created_at,
        updated_at=dept.updated_at,
        member_count=0
    )


@router.get("/departments/{dept_id}", response_model=GRCDepartmentDetailResponse)
def get_department(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    dept = db.query(GRCDepartment).options(
        joinedload(GRCDepartment.department_head),
        joinedload(GRCDepartment.parent_department),
        joinedload(GRCDepartment.members).joinedload(GRCDepartmentMember.user)
    ).filter(
        GRCDepartment.id == dept_id,
        GRCDepartment.tenant_id.in_(user_tenants)
    ).first()
    
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    vuln_count = db.query(func.count(GRCVulnerabilityDepartmentAssignment.id)).filter(
        GRCVulnerabilityDepartmentAssignment.department_id == dept_id
    ).scalar() or 0
    
    members = [
        GRCDepartmentMemberResponse(
            id=m.id,
            department_id=m.department_id,
            user_id=m.user_id,
            role=m.role,
            email_notifications_enabled=m.email_notifications_enabled,
            escalation_order=m.escalation_order,
            added_at=m.added_at,
            added_by=m.added_by,
            is_active=m.is_active,
            user_name=m.user.display_name if m.user else None,
            user_email=m.user.email if m.user else None
        )
        for m in dept.members if m.is_active
    ]
    
    sub_depts = db.query(GRCDepartment).filter(
        GRCDepartment.parent_department_id == dept_id,
        GRCDepartment.is_active == True
    ).all()
    
    sub_dept_responses = [
        GRCDepartmentResponse(
            id=sd.id,
            tenant_id=sd.tenant_id,
            name=sd.name,
            code=sd.code,
            description=sd.description,
            parent_department_id=sd.parent_department_id,
            parent_department_name=dept.name,
            department_head_user_id=sd.department_head_user_id,
            department_head_name=sd.department_head.display_name if sd.department_head else None,
            is_active=sd.is_active,
            created_at=sd.created_at,
            updated_at=sd.updated_at,
            member_count=0
        )
        for sd in sub_depts
    ]
    
    return GRCDepartmentDetailResponse(
        id=dept.id,
        tenant_id=dept.tenant_id,
        name=dept.name,
        code=dept.code,
        description=dept.description,
        parent_department_id=dept.parent_department_id,
        parent_department_name=dept.parent_department.name if dept.parent_department else None,
        department_head_user_id=dept.department_head_user_id,
        department_head_name=dept.department_head.display_name if dept.department_head else None,
        is_active=dept.is_active,
        created_at=dept.created_at,
        updated_at=dept.updated_at,
        members=members,
        sub_departments=sub_dept_responses,
        vulnerability_count=vuln_count
    )


@router.put("/departments/{dept_id}", response_model=GRCDepartmentResponse)
def update_department(
    dept_id: int,
    request: GRCDepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    update_data = request.model_dump(exclude_unset=True)
    
    if "name" in update_data and update_data["name"] != dept.name:
        existing = db.query(GRCDepartment).filter(
            GRCDepartment.tenant_id == dept.tenant_id,
            GRCDepartment.name == update_data["name"],
            GRCDepartment.id != dept_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Department with this name already exists")
    
    if "code" in update_data and update_data["code"] != dept.code:
        existing = db.query(GRCDepartment).filter(
            GRCDepartment.tenant_id == dept.tenant_id,
            GRCDepartment.code == update_data["code"],
            GRCDepartment.id != dept_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Department with this code already exists")
    
    if "parent_department_id" in update_data and update_data["parent_department_id"]:
        if update_data["parent_department_id"] == dept_id:
            raise HTTPException(status_code=400, detail="Department cannot be its own parent")
        parent = db.query(GRCDepartment).filter(
            GRCDepartment.id == update_data["parent_department_id"],
            GRCDepartment.tenant_id == dept.tenant_id
        ).first()
        if not parent:
            raise HTTPException(status_code=404, detail="Parent department not found")
    
    for field, value in update_data.items():
        setattr(dept, field, value)
    
    dept.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(dept)
    
    member_count = db.query(func.count(GRCDepartmentMember.id)).filter(
        GRCDepartmentMember.department_id == dept.id,
        GRCDepartmentMember.is_active == True
    ).scalar() or 0
    
    return GRCDepartmentResponse(
        id=dept.id,
        tenant_id=dept.tenant_id,
        name=dept.name,
        code=dept.code,
        description=dept.description,
        parent_department_id=dept.parent_department_id,
        parent_department_name=dept.parent_department.name if dept.parent_department else None,
        department_head_user_id=dept.department_head_user_id,
        department_head_name=dept.department_head.display_name if dept.department_head else None,
        is_active=dept.is_active,
        created_at=dept.created_at,
        updated_at=dept.updated_at,
        member_count=member_count
    )


@router.delete("/departments/{dept_id}", response_model=MessageResponse)
def delete_department(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    dept.is_active = False
    dept.updated_at = datetime.utcnow()
    db.commit()
    
    return MessageResponse(message="Department deleted successfully", id=dept_id)


@router.post("/departments/{dept_id}/members", response_model=GRCDepartmentMemberResponse, status_code=status.HTTP_201_CREATED)
def add_department_member(
    dept_id: int,
    request: GRCDepartmentMemberCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    user = db.query(GRCUser).filter(GRCUser.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    existing = db.query(GRCDepartmentMember).filter(
        GRCDepartmentMember.department_id == dept_id,
        GRCDepartmentMember.user_id == request.user_id
    ).first()
    
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="User is already a member of this department")
        existing.is_active = True
        existing.role = request.role
        existing.email_notifications_enabled = request.email_notifications_enabled
        existing.escalation_order = request.escalation_order
        existing.added_at = datetime.utcnow()
        existing.added_by = current_user.id
        db.commit()
        db.refresh(existing)
        return GRCDepartmentMemberResponse(
            id=existing.id,
            department_id=existing.department_id,
            user_id=existing.user_id,
            role=existing.role,
            email_notifications_enabled=existing.email_notifications_enabled,
            escalation_order=existing.escalation_order,
            added_at=existing.added_at,
            added_by=existing.added_by,
            is_active=existing.is_active,
            user_name=user.display_name,
            user_email=user.email
        )
    
    member = GRCDepartmentMember(
        department_id=dept_id,
        user_id=request.user_id,
        role=request.role,
        email_notifications_enabled=request.email_notifications_enabled,
        escalation_order=request.escalation_order,
        added_by=current_user.id
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    
    return GRCDepartmentMemberResponse(
        id=member.id,
        department_id=member.department_id,
        user_id=member.user_id,
        role=member.role,
        email_notifications_enabled=member.email_notifications_enabled,
        escalation_order=member.escalation_order,
        added_at=member.added_at,
        added_by=member.added_by,
        is_active=member.is_active,
        user_name=user.display_name,
        user_email=user.email
    )


@router.delete("/departments/{dept_id}/members/{user_id}", response_model=MessageResponse)
def remove_department_member(
    dept_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    member = db.query(GRCDepartmentMember).filter(
        GRCDepartmentMember.department_id == dept_id,
        GRCDepartmentMember.user_id == user_id,
        GRCDepartmentMember.is_active == True
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Department member not found")
    
    member.is_active = False
    db.commit()
    
    return MessageResponse(message="Department member removed successfully", id=member.id)


@router.get("/departments/{dept_id}/vulnerabilities", response_model=List[VulnerabilityResponse])
def get_department_vulnerabilities(
    dept_id: int,
    status_filter: Optional[str] = None,
    severity: Optional[str] = None,
    priority: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    query = db.query(Vulnerability).join(
        GRCVulnerabilityDepartmentAssignment,
        GRCVulnerabilityDepartmentAssignment.vulnerability_id == Vulnerability.id
    ).filter(
        GRCVulnerabilityDepartmentAssignment.department_id == dept_id
    )
    
    if status_filter:
        query = query.filter(Vulnerability.status == status_filter)
    if severity:
        query = query.filter(Vulnerability.severity == severity)
    if priority:
        query = query.filter(GRCVulnerabilityDepartmentAssignment.priority == priority)
    
    vulns = query.order_by(Vulnerability.created_at.desc()).offset(skip).limit(limit).all()
    
    return [
        VulnerabilityResponse(
            id=v.id,
            tenant_id=v.tenant_id,
            report_id=v.report_id,
            vuln_id=v.vuln_id,
            title=v.title,
            description=v.description,
            severity=v.severity,
            cvss_score=v.cvss_score,
            cvss_vector=v.cvss_vector,
            cve_id=v.cve_id,
            cwe_id=v.cwe_id,
            affected_component=v.affected_component,
            affected_host=v.affected_host,
            affected_port=v.affected_port,
            affected_url=v.affected_url,
            evidence=v.evidence,
            reproduction_steps=v.reproduction_steps,
            recommendation=v.recommendation,
            ai_recommendation=v.ai_recommendation,
            ai_impact_assessment=v.ai_impact_assessment,
            status=v.status,
            resolution_notes=v.resolution_notes,
            discovered_at=v.discovered_at,
            due_date=v.due_date,
            resolved_at=v.resolved_at,
            assigned_to=v.assigned_to,
            verified_by=v.verified_by,
            verified_at=v.verified_at,
            is_exception=v.is_exception,
            exception_reason=v.exception_reason,
            exception_approved_by=v.exception_approved_by,
            exception_expiry=v.exception_expiry,
            created_at=v.created_at,
            updated_at=v.updated_at,
            assignee_name=v.assignee.display_name if v.assignee else None,
            verifier_name=v.verifier.display_name if v.verifier else None
        )
        for v in vulns
    ]


@router.post("/vulnerabilities/{vuln_id}/assign-department", response_model=GRCVulnerabilityDepartmentAssignmentResponse, status_code=status.HTTP_201_CREATED)
def assign_vulnerability_to_department(
    vuln_id: int,
    request: GRCVulnerabilityDepartmentAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    dept = db.query(GRCDepartment).filter(
        GRCDepartment.id == request.department_id,
        GRCDepartment.tenant_id.in_(user_tenants),
        GRCDepartment.is_active == True
    ).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    existing = db.query(GRCVulnerabilityDepartmentAssignment).filter(
        GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln_id,
        GRCVulnerabilityDepartmentAssignment.department_id == request.department_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Vulnerability is already assigned to this department")
    
    assignment = GRCVulnerabilityDepartmentAssignment(
        vulnerability_id=vuln_id,
        department_id=request.department_id,
        assigned_by=current_user.id,
        priority=request.priority,
        notes=request.notes,
        sla_override_days=request.sla_override_days
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    
    members = db.query(GRCDepartmentMember).options(
        joinedload(GRCDepartmentMember.user)
    ).filter(
        GRCDepartmentMember.department_id == dept.id,
        GRCDepartmentMember.is_active == True,
        GRCDepartmentMember.email_notifications_enabled == True
    ).all()
    
    email_sent = False
    for member in members:
        if member.user and member.user.email:
            try:
                EmailService.send_assignment_notification(
                    recipient_email=member.user.email,
                    recipient_name=member.user.display_name,
                    vulnerability=vuln,
                    department=dept,
                    assigned_by=current_user.display_name
                )
                email_sent = True
            except Exception as e:
                logger.error(f"Failed to send assignment email to {member.user.email}: {e}")
    
    if email_sent:
        assignment.notification_sent = True
        db.commit()
    
    return GRCVulnerabilityDepartmentAssignmentResponse(
        id=assignment.id,
        vulnerability_id=assignment.vulnerability_id,
        department_id=assignment.department_id,
        department_name=dept.name,
        department_code=dept.code,
        assigned_by=assignment.assigned_by,
        assigner_name=current_user.display_name,
        assigned_at=assignment.assigned_at,
        priority=assignment.priority,
        notes=assignment.notes,
        sla_override_days=assignment.sla_override_days,
        notification_sent=assignment.notification_sent
    )


@router.delete("/vulnerabilities/{vuln_id}/assign-department/{dept_id}", response_model=MessageResponse)
def unassign_vulnerability_from_department(
    vuln_id: int,
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    assignment = db.query(GRCVulnerabilityDepartmentAssignment).filter(
        GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln_id,
        GRCVulnerabilityDepartmentAssignment.department_id == dept_id
    ).first()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Department assignment not found")
    
    db.delete(assignment)
    db.commit()
    
    return MessageResponse(message="Department unassigned from vulnerability successfully", id=assignment.id)


@router.get("/vulnerabilities/{vuln_id}/departments", response_model=List[GRCVulnerabilityDepartmentAssignmentResponse])
def get_vulnerability_departments(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    assignments = db.query(GRCVulnerabilityDepartmentAssignment).options(
        joinedload(GRCVulnerabilityDepartmentAssignment.department),
        joinedload(GRCVulnerabilityDepartmentAssignment.assigner)
    ).filter(
        GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln_id
    ).all()
    
    return [
        GRCVulnerabilityDepartmentAssignmentResponse(
            id=a.id,
            vulnerability_id=a.vulnerability_id,
            department_id=a.department_id,
            department_name=a.department.name if a.department else None,
            department_code=a.department.code if a.department else None,
            assigned_by=a.assigned_by,
            assigner_name=a.assigner.display_name if a.assigner else None,
            assigned_at=a.assigned_at,
            priority=a.priority,
            notes=a.notes,
            sla_override_days=a.sla_override_days,
            notification_sent=a.notification_sent
        )
        for a in assignments
    ]


@router.post("/departments/{dept_id}/escalation-paths", response_model=GRCDepartmentEscalationPathResponse, status_code=status.HTTP_201_CREATED)
def create_escalation_path(
    dept_id: int,
    request: GRCDepartmentEscalationPathCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    if request.escalation_level not in [1, 2, 3]:
        raise HTTPException(status_code=400, detail="Escalation level must be 1, 2, or 3")
    
    if request.target_role not in ["lead", "head", "parent_dept_head"]:
        raise HTTPException(status_code=400, detail="Target role must be lead, head, or parent_dept_head")
    
    existing = db.query(GRCDepartmentEscalationPath).filter(
        GRCDepartmentEscalationPath.department_id == dept_id,
        GRCDepartmentEscalationPath.escalation_level == request.escalation_level
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Escalation level {request.escalation_level} already exists for this department")
    
    escalation_path = GRCDepartmentEscalationPath(
        department_id=dept_id,
        escalation_level=request.escalation_level,
        target_role=request.target_role,
        sla_threshold_percent=request.sla_threshold_percent,
        auto_escalate=request.auto_escalate
    )
    db.add(escalation_path)
    db.commit()
    db.refresh(escalation_path)
    
    return GRCDepartmentEscalationPathResponse(
        id=escalation_path.id,
        department_id=escalation_path.department_id,
        escalation_level=escalation_path.escalation_level,
        target_role=escalation_path.target_role,
        sla_threshold_percent=escalation_path.sla_threshold_percent,
        auto_escalate=escalation_path.auto_escalate,
        created_at=escalation_path.created_at,
        updated_at=escalation_path.updated_at
    )


@router.get("/departments/{dept_id}/escalation-paths", response_model=List[GRCDepartmentEscalationPathResponse])
def list_escalation_paths(
    dept_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    paths = db.query(GRCDepartmentEscalationPath).filter(
        GRCDepartmentEscalationPath.department_id == dept_id
    ).order_by(GRCDepartmentEscalationPath.escalation_level).all()
    
    return [
        GRCDepartmentEscalationPathResponse(
            id=p.id,
            department_id=p.department_id,
            escalation_level=p.escalation_level,
            target_role=p.target_role,
            sla_threshold_percent=p.sla_threshold_percent,
            auto_escalate=p.auto_escalate,
            created_at=p.created_at,
            updated_at=p.updated_at
        )
        for p in paths
    ]


@router.delete("/departments/{dept_id}/escalation-paths/{path_id}", response_model=MessageResponse)
def delete_escalation_path(
    dept_id: int,
    path_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    dept = get_department_or_404(dept_id, user_tenants, db)
    
    path = db.query(GRCDepartmentEscalationPath).filter(
        GRCDepartmentEscalationPath.id == path_id,
        GRCDepartmentEscalationPath.department_id == dept_id
    ).first()
    
    if not path:
        raise HTTPException(status_code=404, detail="Escalation path not found")
    
    db.delete(path)
    db.commit()
    
    return MessageResponse(message="Escalation path deleted successfully", id=path_id)


@router.post("/vulnerabilities/bulk-assign", response_model=BulkVulnerabilityAssignResponse)
def bulk_assign_vulnerabilities(
    request: BulkVulnerabilityAssignRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    dept = db.query(GRCDepartment).filter(
        GRCDepartment.id == request.department_id,
        GRCDepartment.tenant_id.in_(user_tenants),
        GRCDepartment.is_active == True
    ).first()
    if not dept:
        raise HTTPException(status_code=404, detail="Department not found")
    
    success_count = 0
    failed_count = 0
    assignments = []
    errors = []
    
    for vuln_id in request.vulnerability_ids:
        vuln = db.query(Vulnerability).filter(
            Vulnerability.id == vuln_id,
            Vulnerability.tenant_id.in_(user_tenants)
        ).first()
        
        if not vuln:
            failed_count += 1
            errors.append({"vulnerability_id": vuln_id, "error": "Vulnerability not found"})
            continue
        
        existing = db.query(GRCVulnerabilityDepartmentAssignment).filter(
            GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln_id,
            GRCVulnerabilityDepartmentAssignment.department_id == request.department_id
        ).first()
        
        if existing:
            failed_count += 1
            errors.append({"vulnerability_id": vuln_id, "error": "Already assigned to this department"})
            continue
        
        assignment = GRCVulnerabilityDepartmentAssignment(
            vulnerability_id=vuln_id,
            department_id=request.department_id,
            assigned_by=current_user.id,
            priority=request.priority,
            notes=request.notes
        )
        db.add(assignment)
        db.flush()
        
        assignments.append({
            "assignment": assignment,
            "vuln": vuln,
            "response": GRCVulnerabilityDepartmentAssignmentResponse(
                id=assignment.id,
                vulnerability_id=assignment.vulnerability_id,
                department_id=assignment.department_id,
                department_name=dept.name,
                department_code=dept.code,
                assigned_by=assignment.assigned_by,
                assigner_name=current_user.display_name,
                assigned_at=assignment.assigned_at,
                priority=assignment.priority,
                notes=assignment.notes,
                sla_override_days=assignment.sla_override_days,
                notification_sent=assignment.notification_sent
            )
        })
        success_count += 1
    
    db.commit()
    
    members = db.query(GRCDepartmentMember).options(
        joinedload(GRCDepartmentMember.user)
    ).filter(
        GRCDepartmentMember.department_id == dept.id,
        GRCDepartmentMember.is_active == True,
        GRCDepartmentMember.email_notifications_enabled == True
    ).all()
    
    for item in assignments:
        for member in members:
            if member.user and member.user.email:
                try:
                    EmailService.send_assignment_notification(
                        recipient_email=member.user.email,
                        recipient_name=member.user.display_name,
                        vulnerability=item["vuln"],
                        department=dept,
                        assigned_by=current_user.display_name
                    )
                    item["assignment"].notification_sent = True
                except Exception as e:
                    logger.error(f"Failed to send bulk assignment email: {e}")
    
    db.commit()
    
    return BulkVulnerabilityAssignResponse(
        success_count=success_count,
        failed_count=failed_count,
        assignments=[item["response"] for item in assignments],
        errors=errors
    )
