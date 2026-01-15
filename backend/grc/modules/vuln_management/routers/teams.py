from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    GRCTeam, GRCTeamMember, GRCVulnerabilityTeamAssignment,
    Vulnerability, GRCUser, get_db
)
from ....schemas import (
    GRCTeamCreate, GRCTeamUpdate, GRCTeamResponse, GRCTeamDetailResponse,
    GRCTeamMemberCreate, GRCTeamMemberResponse,
    GRCVulnerabilityTeamAssignmentCreate, GRCVulnerabilityTeamAssignmentResponse,
    VulnerabilityResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(tags=["Teams"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_team_or_404(team_id: int, user_tenants: List[int], db: Session) -> GRCTeam:
    team = db.query(GRCTeam).filter(
        GRCTeam.id == team_id,
        GRCTeam.tenant_id.in_(user_tenants)
    ).first()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Team not found"
        )
    return team


@router.get("/teams", response_model=List[GRCTeamResponse])
def list_teams(
    tenant_id: Optional[int] = None,
    team_type: Optional[str] = None,
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
    
    query = db.query(GRCTeam).filter(GRCTeam.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GRCTeam.tenant_id == tenant_id)
    if team_type:
        query = query.filter(GRCTeam.team_type == team_type)
    if is_active is not None:
        query = query.filter(GRCTeam.is_active == is_active)
    if search:
        query = query.filter(GRCTeam.name.ilike(f"%{search}%"))
    
    teams = query.order_by(GRCTeam.name).offset(skip).limit(limit).all()
    
    result = []
    for team in teams:
        member_count = db.query(func.count(GRCTeamMember.id)).filter(
            GRCTeamMember.team_id == team.id,
            GRCTeamMember.is_active == True
        ).scalar() or 0
        
        result.append(GRCTeamResponse(
            id=team.id,
            tenant_id=team.tenant_id,
            name=team.name,
            description=team.description,
            team_type=team.team_type,
            manager_id=team.manager_id,
            manager_name=team.manager.display_name if team.manager else None,
            is_active=team.is_active,
            created_at=team.created_at,
            updated_at=team.updated_at,
            member_count=member_count
        ))
    
    return result


@router.post("/teams", response_model=GRCTeamResponse, status_code=status.HTTP_201_CREATED)
def create_team(
    request: GRCTeamCreate,
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
    
    existing = db.query(GRCTeam).filter(
        GRCTeam.tenant_id == tenant_id,
        GRCTeam.name == request.name
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Team with this name already exists")
    
    team = GRCTeam(
        tenant_id=tenant_id,
        name=request.name,
        description=request.description,
        team_type=request.team_type,
        manager_id=request.manager_id
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    
    return GRCTeamResponse(
        id=team.id,
        tenant_id=team.tenant_id,
        name=team.name,
        description=team.description,
        team_type=team.team_type,
        manager_id=team.manager_id,
        manager_name=team.manager.display_name if team.manager else None,
        is_active=team.is_active,
        created_at=team.created_at,
        updated_at=team.updated_at,
        member_count=0
    )


@router.get("/teams/{team_id}", response_model=GRCTeamDetailResponse)
def get_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    team = db.query(GRCTeam).options(
        joinedload(GRCTeam.manager),
        joinedload(GRCTeam.members).joinedload(GRCTeamMember.user)
    ).filter(
        GRCTeam.id == team_id,
        GRCTeam.tenant_id.in_(user_tenants)
    ).first()
    
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    
    vuln_count = db.query(func.count(GRCVulnerabilityTeamAssignment.id)).filter(
        GRCVulnerabilityTeamAssignment.team_id == team_id
    ).scalar() or 0
    
    members = [
        GRCTeamMemberResponse(
            id=m.id,
            team_id=m.team_id,
            user_id=m.user_id,
            role=m.role,
            joined_at=m.joined_at,
            is_active=m.is_active,
            user_name=m.user.display_name if m.user else None,
            user_email=m.user.email if m.user else None
        )
        for m in team.members if m.is_active
    ]
    
    return GRCTeamDetailResponse(
        id=team.id,
        tenant_id=team.tenant_id,
        name=team.name,
        description=team.description,
        team_type=team.team_type,
        manager_id=team.manager_id,
        manager_name=team.manager.display_name if team.manager else None,
        is_active=team.is_active,
        created_at=team.created_at,
        updated_at=team.updated_at,
        members=members,
        vulnerability_count=vuln_count
    )


@router.put("/teams/{team_id}", response_model=GRCTeamResponse)
def update_team(
    team_id: int,
    request: GRCTeamUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    team = get_team_or_404(team_id, user_tenants, db)
    
    update_data = request.model_dump(exclude_unset=True)
    
    if "name" in update_data and update_data["name"] != team.name:
        existing = db.query(GRCTeam).filter(
            GRCTeam.tenant_id == team.tenant_id,
            GRCTeam.name == update_data["name"],
            GRCTeam.id != team_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Team with this name already exists")
    
    for field, value in update_data.items():
        setattr(team, field, value)
    
    team.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(team)
    
    member_count = db.query(func.count(GRCTeamMember.id)).filter(
        GRCTeamMember.team_id == team.id,
        GRCTeamMember.is_active == True
    ).scalar() or 0
    
    return GRCTeamResponse(
        id=team.id,
        tenant_id=team.tenant_id,
        name=team.name,
        description=team.description,
        team_type=team.team_type,
        manager_id=team.manager_id,
        manager_name=team.manager.display_name if team.manager else None,
        is_active=team.is_active,
        created_at=team.created_at,
        updated_at=team.updated_at,
        member_count=member_count
    )


@router.delete("/teams/{team_id}", response_model=MessageResponse)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    team = get_team_or_404(team_id, user_tenants, db)
    
    team.is_active = False
    team.updated_at = datetime.utcnow()
    db.commit()
    
    return MessageResponse(message="Team deleted successfully", id=team_id)


@router.post("/teams/{team_id}/members", response_model=GRCTeamMemberResponse, status_code=status.HTTP_201_CREATED)
def add_team_member(
    team_id: int,
    request: GRCTeamMemberCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    team = get_team_or_404(team_id, user_tenants, db)
    
    user = db.query(GRCUser).filter(GRCUser.id == request.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    existing = db.query(GRCTeamMember).filter(
        GRCTeamMember.team_id == team_id,
        GRCTeamMember.user_id == request.user_id
    ).first()
    
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=400, detail="User is already a member of this team")
        existing.is_active = True
        existing.role = request.role
        existing.joined_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        return GRCTeamMemberResponse(
            id=existing.id,
            team_id=existing.team_id,
            user_id=existing.user_id,
            role=existing.role,
            joined_at=existing.joined_at,
            is_active=existing.is_active,
            user_name=user.display_name,
            user_email=user.email
        )
    
    member = GRCTeamMember(
        team_id=team_id,
        user_id=request.user_id,
        role=request.role
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    
    return GRCTeamMemberResponse(
        id=member.id,
        team_id=member.team_id,
        user_id=member.user_id,
        role=member.role,
        joined_at=member.joined_at,
        is_active=member.is_active,
        user_name=user.display_name,
        user_email=user.email
    )


@router.delete("/teams/{team_id}/members/{user_id}", response_model=MessageResponse)
def remove_team_member(
    team_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    team = get_team_or_404(team_id, user_tenants, db)
    
    member = db.query(GRCTeamMember).filter(
        GRCTeamMember.team_id == team_id,
        GRCTeamMember.user_id == user_id,
        GRCTeamMember.is_active == True
    ).first()
    
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    
    member.is_active = False
    db.commit()
    
    return MessageResponse(message="Team member removed successfully", id=member.id)


@router.get("/teams/{team_id}/vulnerabilities", response_model=List[VulnerabilityResponse])
def get_team_vulnerabilities(
    team_id: int,
    status_filter: Optional[str] = None,
    severity: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    team = get_team_or_404(team_id, user_tenants, db)
    
    query = db.query(Vulnerability).join(
        GRCVulnerabilityTeamAssignment,
        GRCVulnerabilityTeamAssignment.vulnerability_id == Vulnerability.id
    ).filter(
        GRCVulnerabilityTeamAssignment.team_id == team_id
    )
    
    if status_filter:
        query = query.filter(Vulnerability.status == status_filter)
    if severity:
        query = query.filter(Vulnerability.severity == severity)
    
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


@router.post("/vulnerabilities/{vuln_id}/assign-team", response_model=GRCVulnerabilityTeamAssignmentResponse, status_code=status.HTTP_201_CREATED)
def assign_vulnerability_to_team(
    vuln_id: int,
    request: GRCVulnerabilityTeamAssignmentCreate,
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
    
    team = db.query(GRCTeam).filter(
        GRCTeam.id == request.team_id,
        GRCTeam.tenant_id.in_(user_tenants),
        GRCTeam.is_active == True
    ).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    
    existing = db.query(GRCVulnerabilityTeamAssignment).filter(
        GRCVulnerabilityTeamAssignment.vulnerability_id == vuln_id,
        GRCVulnerabilityTeamAssignment.team_id == request.team_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Vulnerability is already assigned to this team")
    
    if request.is_primary:
        db.query(GRCVulnerabilityTeamAssignment).filter(
            GRCVulnerabilityTeamAssignment.vulnerability_id == vuln_id,
            GRCVulnerabilityTeamAssignment.is_primary == True
        ).update({"is_primary": False})
    
    assignment = GRCVulnerabilityTeamAssignment(
        vulnerability_id=vuln_id,
        team_id=request.team_id,
        assigned_by=current_user.id,
        notes=request.notes,
        is_primary=request.is_primary
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    
    return GRCVulnerabilityTeamAssignmentResponse(
        id=assignment.id,
        vulnerability_id=assignment.vulnerability_id,
        team_id=assignment.team_id,
        team_name=team.name,
        assigned_by=assignment.assigned_by,
        assigner_name=current_user.display_name,
        assigned_at=assignment.assigned_at,
        notes=assignment.notes,
        is_primary=assignment.is_primary
    )


@router.delete("/vulnerabilities/{vuln_id}/assign-team/{team_id}", response_model=MessageResponse)
def unassign_vulnerability_from_team(
    vuln_id: int,
    team_id: int,
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
    
    assignment = db.query(GRCVulnerabilityTeamAssignment).filter(
        GRCVulnerabilityTeamAssignment.vulnerability_id == vuln_id,
        GRCVulnerabilityTeamAssignment.team_id == team_id
    ).first()
    
    if not assignment:
        raise HTTPException(status_code=404, detail="Team assignment not found")
    
    db.delete(assignment)
    db.commit()
    
    return MessageResponse(message="Team unassigned from vulnerability successfully", id=assignment.id)


@router.get("/vulnerabilities/{vuln_id}/teams", response_model=List[GRCVulnerabilityTeamAssignmentResponse])
def get_vulnerability_teams(
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
    
    assignments = db.query(GRCVulnerabilityTeamAssignment).options(
        joinedload(GRCVulnerabilityTeamAssignment.team),
        joinedload(GRCVulnerabilityTeamAssignment.assigner)
    ).filter(
        GRCVulnerabilityTeamAssignment.vulnerability_id == vuln_id
    ).all()
    
    return [
        GRCVulnerabilityTeamAssignmentResponse(
            id=a.id,
            vulnerability_id=a.vulnerability_id,
            team_id=a.team_id,
            team_name=a.team.name if a.team else None,
            assigned_by=a.assigned_by,
            assigner_name=a.assigner.display_name if a.assigner else None,
            assigned_at=a.assigned_at,
            notes=a.notes,
            is_primary=a.is_primary
        )
        for a in assignments
    ]
