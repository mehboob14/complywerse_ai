"""
Attestation & Certification Management Router
Supports SOX 302/404 certifications, policy sign-offs, BCP/DR awareness with cascade reminders and escalation workflows
"""
from typing import List, Optional
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

from ....models import (
    AttestationCampaign, EscalationChain, AttestationRequest,
    GRCUser, Tenant, TenantUser, UserRole, BusinessUnit, Role,
    GovernanceDocument, Evidence, get_db
)
from ....schemas import (
    AttestationCampaignCreate, AttestationCampaignUpdate, AttestationCampaignResponse,
    AttestationCampaignDetailResponse, EscalationChainCreate, EscalationChainResponse,
    AttestationRequestCreate, AttestationRequestUpdate, AttestationRequestResponse,
    AttestationCompleteRequest, AttestationDashboardStats, AttestationReminderResponse,
    AttestationEscalateResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/attestation-campaigns", tags=["Attestation & Certification Management"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def build_campaign_response(campaign: AttestationCampaign, db: Session) -> dict:
    total_requests = db.query(func.count(AttestationRequest.id)).filter(
        AttestationRequest.campaign_id == campaign.id
    ).scalar() or 0
    
    completed_requests = db.query(func.count(AttestationRequest.id)).filter(
        AttestationRequest.campaign_id == campaign.id,
        AttestationRequest.status == "completed"
    ).scalar() or 0
    
    completion_rate = (completed_requests / total_requests * 100) if total_requests > 0 else 0.0
    
    return {
        "id": campaign.id,
        "tenant_id": campaign.tenant_id,
        "name": campaign.name,
        "description": campaign.description,
        "campaign_type": campaign.campaign_type,
        "start_date": campaign.start_date,
        "due_date": campaign.due_date,
        "status": campaign.status,
        "target_type": campaign.target_type,
        "target_department_ids": campaign.target_department_ids or [],
        "target_role_ids": campaign.target_role_ids or [],
        "target_user_ids": campaign.target_user_ids or [],
        "escalation_enabled": campaign.escalation_enabled,
        "reminder_days_before": campaign.reminder_days_before,
        "escalation_days_after": campaign.escalation_days_after,
        "attestation_text": campaign.attestation_text,
        "requires_evidence": campaign.requires_evidence,
        "linked_document_id": campaign.linked_document_id,
        "created_by": campaign.created_by,
        "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
        "total_requests": total_requests,
        "completed_requests": completed_requests,
        "completion_rate": completion_rate
    }


def build_request_response(req: AttestationRequest, db: Session) -> dict:
    user = db.query(GRCUser).filter(GRCUser.id == req.user_id).first()
    campaign = db.query(AttestationCampaign).filter(AttestationCampaign.id == req.campaign_id).first()
    escalated_to = None
    if req.escalated_to_id:
        escalated_to = db.query(GRCUser).filter(GRCUser.id == req.escalated_to_id).first()
    
    now = datetime.utcnow()
    is_overdue = req.due_date and req.due_date < now and req.status not in ["completed"]
    days_until_due = None
    if req.due_date:
        days_until_due = (req.due_date - now).days
    
    return {
        "id": req.id,
        "tenant_id": req.tenant_id,
        "campaign_id": req.campaign_id,
        "campaign_name": campaign.name if campaign else None,
        "user_id": req.user_id,
        "user_name": user.display_name or user.username if user else None,
        "user_email": user.email if user else None,
        "attestation_type": req.attestation_type,
        "status": "overdue" if is_overdue and req.status == "pending" else req.status,
        "assigned_at": req.assigned_at,
        "due_date": req.due_date,
        "completed_at": req.completed_at,
        "escalation_tier": req.escalation_tier,
        "escalated_to_id": req.escalated_to_id,
        "escalated_to_name": escalated_to.display_name or escalated_to.username if escalated_to else None,
        "reminder_sent_at": req.reminder_sent_at,
        "reminder_count": req.reminder_count,
        "escalation_sent_at": req.escalation_sent_at,
        "user_comments": req.user_comments,
        "attestation_text": req.attestation_text,
        "evidence_id": req.evidence_id,
        "is_overdue": is_overdue,
        "days_until_due": days_until_due
    }


# =============================================================================
# Campaign CRUD Endpoints
# =============================================================================

@router.get("/campaigns", response_model=List[AttestationCampaignResponse])
def list_campaigns(
    campaign_type: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """List all attestation campaigns for the user's tenants"""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(AttestationCampaign).filter(
        AttestationCampaign.tenant_id.in_(user_tenants)
    )
    
    if campaign_type:
        query = query.filter(AttestationCampaign.campaign_type == campaign_type)
    if status:
        query = query.filter(AttestationCampaign.status == status)
    
    campaigns = query.order_by(AttestationCampaign.due_date.desc()).offset(skip).limit(limit).all()
    
    return [build_campaign_response(c, db) for c in campaigns]


@router.get("/campaigns/{campaign_id}", response_model=AttestationCampaignDetailResponse)
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get a specific attestation campaign with escalation chains"""
    user_tenants = get_user_tenants(current_user, db)
    
    # Try tenant-scoped lookup first
    query = db.query(AttestationCampaign).options(
        joinedload(AttestationCampaign.escalation_chains)
    ).filter(AttestationCampaign.id == campaign_id)
    
    if user_tenants:
        campaign = query.filter(AttestationCampaign.tenant_id.in_(user_tenants)).first()
    else:
        campaign = None
    
    # Fallback: allow the creator to access their own campaign
    if not campaign:
        campaign = db.query(AttestationCampaign).options(
            joinedload(AttestationCampaign.escalation_chains)
        ).filter(
            AttestationCampaign.id == campaign_id,
            AttestationCampaign.created_by == current_user.id
        ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    response = build_campaign_response(campaign, db)
    
    creator = db.query(GRCUser).filter(GRCUser.id == campaign.created_by).first() if campaign.created_by else None
    response["creator_name"] = creator.display_name or creator.username if creator else None
    
    linked_doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == campaign.linked_document_id).first() if campaign.linked_document_id else None
    response["linked_document_title"] = linked_doc.title if linked_doc else None
    
    escalation_chains = []
    for ec in sorted(campaign.escalation_chains, key=lambda x: x.tier):
        approver = db.query(GRCUser).filter(GRCUser.id == ec.approver_id).first() if ec.approver_id else None
        bu = db.query(BusinessUnit).filter(BusinessUnit.id == ec.business_unit_id).first() if ec.business_unit_id else None
        role = db.query(Role).filter(Role.id == ec.role_id).first() if ec.role_id else None
        
        escalation_chains.append({
            "id": ec.id,
            "tenant_id": ec.tenant_id,
            "campaign_id": ec.campaign_id,
            "tier": ec.tier,
            "tier_name": ec.tier_name,
            "approver_id": ec.approver_id,
            "approver_name": approver.display_name or approver.username if approver else None,
            "business_unit_id": ec.business_unit_id,
            "business_unit_name": bu.name if bu else None,
            "role_id": ec.role_id,
            "role_name": role.name if role else None,
            "escalation_delay_days": ec.escalation_delay_days,
            "notify_on_escalation": ec.notify_on_escalation,
            "created_at": ec.created_at
        })
    
    response["escalation_chains"] = escalation_chains
    
    return response


@router.post("/campaigns", response_model=AttestationCampaignResponse, status_code=status.HTTP_201_CREATED)
def create_campaign(
    campaign_data: AttestationCampaignCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Create a new attestation campaign"""
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User not assigned to any tenant")
    
    valid_types = ["sox_302", "sox_404", "policy_signoff", "bcp_awareness", "training_acknowledgment", "annual_certification"]
    if campaign_data.campaign_type not in valid_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid campaign_type. Must be one of: {valid_types}"
        )
    
    campaign = AttestationCampaign(
        tenant_id=tenant_id,
        name=campaign_data.name,
        description=campaign_data.description,
        campaign_type=campaign_data.campaign_type,
        start_date=campaign_data.start_date,
        due_date=campaign_data.due_date,
        target_type=campaign_data.target_type,
        target_department_ids=campaign_data.target_department_ids,
        target_role_ids=campaign_data.target_role_ids,
        target_user_ids=campaign_data.target_user_ids,
        escalation_enabled=campaign_data.escalation_enabled,
        reminder_days_before=campaign_data.reminder_days_before,
        escalation_days_after=campaign_data.escalation_days_after,
        attestation_text=campaign_data.attestation_text,
        requires_evidence=campaign_data.requires_evidence,
        linked_document_id=campaign_data.linked_document_id,
        created_by=current_user.id,
        status="draft"
    )
    db.add(campaign)
    db.flush()
    
    for ec_data in campaign_data.escalation_chains:
        ec = EscalationChain(
            tenant_id=tenant_id,
            campaign_id=campaign.id,
            tier=ec_data.tier,
            tier_name=ec_data.tier_name,
            approver_id=ec_data.approver_id,
            business_unit_id=ec_data.business_unit_id,
            role_id=ec_data.role_id,
            escalation_delay_days=ec_data.escalation_delay_days,
            notify_on_escalation=ec_data.notify_on_escalation
        )
        db.add(ec)
    
    db.commit()
    db.refresh(campaign)
    
    return build_campaign_response(campaign, db)


@router.put("/campaigns/{campaign_id}", response_model=AttestationCampaignResponse)
def update_campaign(
    campaign_id: int,
    campaign_data: AttestationCampaignUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Update an attestation campaign"""
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    if campaign.status == "active" and campaign_data.status not in [None, "active", "closed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Active campaigns can only be closed"
        )
    
    update_data = campaign_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(campaign, field, value)
    
    db.commit()
    db.refresh(campaign)
    
    return build_campaign_response(campaign, db)


@router.delete("/campaigns/{campaign_id}", response_model=MessageResponse)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Delete an attestation campaign (only draft campaigns)"""
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    if campaign.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft campaigns can be deleted"
        )
    
    db.delete(campaign)
    db.commit()
    
    return MessageResponse(message="Campaign deleted successfully")


# =============================================================================
# Campaign Activation & Request Management
# =============================================================================

@router.post("/campaigns/{campaign_id}/activate", response_model=AttestationCampaignResponse)
def activate_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Activate a campaign and create attestation requests for target users"""
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    if campaign.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft campaigns can be activated"
        )
    
    target_user_ids = set()
    
    if campaign.target_type == "all_users":
        tenant_users = db.query(TenantUser).filter(
            TenantUser.tenant_id == campaign.tenant_id
        ).all()
        for tu in tenant_users:
            target_user_ids.add(tu.user_id)
    
    elif campaign.target_type == "by_department":
        if campaign.target_department_ids:
            user_roles = db.query(UserRole).filter(
                UserRole.tenant_id == campaign.tenant_id,
                UserRole.business_unit_id.in_(campaign.target_department_ids)
            ).all()
            for ur in user_roles:
                target_user_ids.add(ur.user_id)
    
    elif campaign.target_type == "by_role":
        if campaign.target_role_ids:
            user_roles = db.query(UserRole).filter(
                UserRole.tenant_id == campaign.tenant_id,
                UserRole.role_id.in_(campaign.target_role_ids)
            ).all()
            for ur in user_roles:
                target_user_ids.add(ur.user_id)
    
    elif campaign.target_type == "custom":
        if campaign.target_user_ids:
            target_user_ids = set(campaign.target_user_ids)
    
    if not target_user_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No target users found for this campaign configuration"
        )
    
    attestation_text = campaign.attestation_text
    if not attestation_text and campaign.linked_document_id:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == campaign.linked_document_id).first()
        if doc:
            attestation_text = f"I acknowledge that I have read, understood, and agree to comply with the {doc.title}."
    
    requests_created = 0
    for user_id in target_user_ids:
        existing = db.query(AttestationRequest).filter(
            AttestationRequest.campaign_id == campaign.id,
            AttestationRequest.user_id == user_id
        ).first()
        
        if not existing:
            req = AttestationRequest(
                tenant_id=campaign.tenant_id,
                campaign_id=campaign.id,
                user_id=user_id,
                attestation_type=campaign.campaign_type,
                status="pending",
                due_date=campaign.due_date,
                attestation_text=attestation_text
            )
            db.add(req)
            requests_created += 1
    
    campaign.status = "active"
    campaign.start_date = campaign.start_date or datetime.utcnow()
    
    db.commit()
    db.refresh(campaign)
    
    return build_campaign_response(campaign, db)


@router.get("/campaigns/{campaign_id}/requests", response_model=List[AttestationRequestResponse])
def list_campaign_requests(
    campaign_id: int,
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """List all attestation requests for a campaign"""
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    query = db.query(AttestationRequest).filter(
        AttestationRequest.campaign_id == campaign_id
    )
    
    if status_filter:
        query = query.filter(AttestationRequest.status == status_filter)
    
    requests = query.order_by(AttestationRequest.due_date).offset(skip).limit(limit).all()
    
    return [build_request_response(r, db) for r in requests]


# =============================================================================
# Attestation Request Actions
# =============================================================================

@router.get("/requests/{request_id}", response_model=AttestationRequestResponse)
def get_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get a specific attestation request"""
    user_tenants = get_user_tenants(current_user, db)
    
    req = db.query(AttestationRequest).filter(
        AttestationRequest.id == request_id,
        AttestationRequest.tenant_id.in_(user_tenants)
    ).first()
    
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attestation request not found")
    
    return build_request_response(req, db)


@router.post("/requests/{request_id}/complete", response_model=AttestationRequestResponse)
def complete_attestation(
    request_id: int,
    completion_data: AttestationCompleteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Complete an attestation request"""
    user_tenants = get_user_tenants(current_user, db)
    
    # Try tenant-scoped lookup first
    if user_tenants:
        att_req = db.query(AttestationRequest).filter(
            AttestationRequest.id == request_id,
            AttestationRequest.tenant_id.in_(user_tenants)
        ).first()
    else:
        att_req = None
    
    # Fallback: allow the assigned user to access their own request
    if not att_req:
        att_req = db.query(AttestationRequest).filter(
            AttestationRequest.id == request_id,
            AttestationRequest.user_id == current_user.id
        ).first()
    
    if not att_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attestation request not found")
    
    if att_req.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only complete your own attestation requests"
        )
    
    if att_req.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attestation already completed"
        )
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == att_req.campaign_id
    ).first()
    
    if campaign and campaign.requires_evidence and not completion_data.evidence_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This attestation requires evidence to be attached"
        )
    
    att_req.status = "completed"
    att_req.completed_at = datetime.utcnow()
    att_req.user_comments = completion_data.user_comments
    att_req.evidence_id = completion_data.evidence_id
    att_req.ip_address = request.client.host if request.client else None
    att_req.user_agent = request.headers.get("user-agent", "")[:500]
    
    db.commit()
    db.refresh(att_req)
    
    return build_request_response(att_req, db)


@router.post("/requests/{request_id}/remind", response_model=AttestationReminderResponse)
def send_reminder(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Send a reminder for an attestation request"""
    user_tenants = get_user_tenants(current_user, db)
    
    att_req = db.query(AttestationRequest).filter(
        AttestationRequest.id == request_id,
        AttestationRequest.tenant_id.in_(user_tenants)
    ).first()
    
    if not att_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attestation request not found")
    
    if att_req.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot send reminder for completed attestation"
        )
    
    att_req.reminder_sent_at = datetime.utcnow()
    att_req.reminder_count = (att_req.reminder_count or 0) + 1
    
    db.commit()
    
    return AttestationReminderResponse(
        message="Reminder sent successfully",
        reminder_count=att_req.reminder_count,
        reminder_sent_at=att_req.reminder_sent_at
    )


@router.post("/requests/{request_id}/escalate", response_model=AttestationEscalateResponse)
def escalate_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Escalate an attestation request to the next tier"""
    user_tenants = get_user_tenants(current_user, db)
    
    att_req = db.query(AttestationRequest).filter(
        AttestationRequest.id == request_id,
        AttestationRequest.tenant_id.in_(user_tenants)
    ).first()
    
    if not att_req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attestation request not found")
    
    if att_req.status == "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot escalate completed attestation"
        )
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == att_req.campaign_id
    ).first()
    
    if not campaign or not campaign.escalation_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Escalation is not enabled for this campaign"
        )
    
    next_tier = att_req.escalation_tier + 1
    
    escalation_chain = db.query(EscalationChain).filter(
        EscalationChain.campaign_id == att_req.campaign_id,
        EscalationChain.tier == next_tier
    ).first()
    
    escalated_to_id = None
    escalated_to_name = None
    
    if escalation_chain and escalation_chain.approver_id:
        escalated_to_id = escalation_chain.approver_id
        approver = db.query(GRCUser).filter(GRCUser.id == escalated_to_id).first()
        escalated_to_name = approver.display_name or approver.username if approver else None
    
    att_req.escalation_tier = next_tier
    att_req.escalated_to_id = escalated_to_id
    att_req.escalation_sent_at = datetime.utcnow()
    att_req.status = "escalated"
    
    db.commit()
    
    return AttestationEscalateResponse(
        message=f"Attestation escalated to tier {next_tier}",
        new_tier=next_tier,
        escalated_to_id=escalated_to_id,
        escalated_to_name=escalated_to_name
    )


# =============================================================================
# User Attestations & Dashboard
# =============================================================================

@router.get("/my-attestations", response_model=List[AttestationRequestResponse])
def get_my_attestations(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all attestation requests for the current user"""
    query = db.query(AttestationRequest).filter(
        AttestationRequest.user_id == current_user.id
    )
    
    if status_filter:
        query = query.filter(AttestationRequest.status == status_filter)
    
    requests = query.order_by(AttestationRequest.due_date).all()
    
    return [build_request_response(r, db) for r in requests]


@router.get("/dashboard", response_model=AttestationDashboardStats)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get attestation campaign dashboard statistics"""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return AttestationDashboardStats(
            total_campaigns=0,
            active_campaigns=0,
            draft_campaigns=0,
            closed_campaigns=0,
            total_requests=0,
            pending_requests=0,
            completed_requests=0,
            overdue_requests=0,
            escalated_requests=0,
            completion_rate=0.0
        )
    
    campaigns = db.query(AttestationCampaign).filter(
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).all()
    
    total_campaigns = len(campaigns)
    active_campaigns = len([c for c in campaigns if c.status == "active"])
    draft_campaigns = len([c for c in campaigns if c.status == "draft"])
    closed_campaigns = len([c for c in campaigns if c.status in ["closed", "archived"]])
    
    by_campaign_type = {}
    for c in campaigns:
        by_campaign_type[c.campaign_type] = by_campaign_type.get(c.campaign_type, 0) + 1
    
    now = datetime.utcnow()
    
    requests = db.query(AttestationRequest).filter(
        AttestationRequest.tenant_id.in_(user_tenants)
    ).all()
    
    total_requests = len(requests)
    pending_requests = 0
    completed_requests = 0
    overdue_requests = 0
    escalated_requests = 0
    by_status = {}
    
    for r in requests:
        is_overdue = r.due_date and r.due_date < now and r.status not in ["completed"]
        
        if r.status == "completed":
            completed_requests += 1
        elif r.status == "escalated":
            escalated_requests += 1
            if is_overdue:
                overdue_requests += 1
        elif is_overdue:
            overdue_requests += 1
            pending_requests += 1
        else:
            pending_requests += 1
        
        status_key = "overdue" if is_overdue and r.status != "completed" else r.status
        by_status[status_key] = by_status.get(status_key, 0) + 1
    
    completion_rate = (completed_requests / total_requests * 100) if total_requests > 0 else 0.0
    
    upcoming = db.query(AttestationCampaign).filter(
        AttestationCampaign.tenant_id.in_(user_tenants),
        AttestationCampaign.status == "active",
        AttestationCampaign.due_date >= now,
        AttestationCampaign.due_date <= now + timedelta(days=30)
    ).order_by(AttestationCampaign.due_date).limit(5).all()
    
    upcoming_deadlines = [
        {
            "campaign_id": c.id,
            "campaign_name": c.name,
            "campaign_type": c.campaign_type,
            "due_date": c.due_date.isoformat() if c.due_date else None,
            "days_remaining": (c.due_date - now).days if c.due_date else None
        }
        for c in upcoming
    ]
    
    return AttestationDashboardStats(
        total_campaigns=total_campaigns,
        active_campaigns=active_campaigns,
        draft_campaigns=draft_campaigns,
        closed_campaigns=closed_campaigns,
        total_requests=total_requests,
        pending_requests=pending_requests,
        completed_requests=completed_requests,
        overdue_requests=overdue_requests,
        escalated_requests=escalated_requests,
        completion_rate=completion_rate,
        by_campaign_type=by_campaign_type,
        by_status=by_status,
        upcoming_deadlines=upcoming_deadlines
    )


# =============================================================================
# Escalation Chain Management
# =============================================================================

@router.post("/campaigns/{campaign_id}/escalation-chains", response_model=EscalationChainResponse, status_code=status.HTTP_201_CREATED)
def add_escalation_chain(
    campaign_id: int,
    chain_data: EscalationChainCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Add an escalation chain tier to a campaign"""
    user_tenants = get_user_tenants(current_user, db)
    
    campaign = db.query(AttestationCampaign).filter(
        AttestationCampaign.id == campaign_id,
        AttestationCampaign.tenant_id.in_(user_tenants)
    ).first()
    
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    
    existing = db.query(EscalationChain).filter(
        EscalationChain.campaign_id == campaign_id,
        EscalationChain.tier == chain_data.tier,
        EscalationChain.business_unit_id == chain_data.business_unit_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Escalation chain for tier {chain_data.tier} already exists"
        )
    
    chain = EscalationChain(
        tenant_id=campaign.tenant_id,
        campaign_id=campaign_id,
        tier=chain_data.tier,
        tier_name=chain_data.tier_name,
        approver_id=chain_data.approver_id,
        business_unit_id=chain_data.business_unit_id,
        role_id=chain_data.role_id,
        escalation_delay_days=chain_data.escalation_delay_days,
        notify_on_escalation=chain_data.notify_on_escalation
    )
    db.add(chain)
    db.commit()
    db.refresh(chain)
    
    approver = db.query(GRCUser).filter(GRCUser.id == chain.approver_id).first() if chain.approver_id else None
    bu = db.query(BusinessUnit).filter(BusinessUnit.id == chain.business_unit_id).first() if chain.business_unit_id else None
    role = db.query(Role).filter(Role.id == chain.role_id).first() if chain.role_id else None
    
    return EscalationChainResponse(
        id=chain.id,
        tenant_id=chain.tenant_id,
        campaign_id=chain.campaign_id,
        tier=chain.tier,
        tier_name=chain.tier_name,
        approver_id=chain.approver_id,
        approver_name=approver.display_name or approver.username if approver else None,
        business_unit_id=chain.business_unit_id,
        business_unit_name=bu.name if bu else None,
        role_id=chain.role_id,
        role_name=role.name if role else None,
        escalation_delay_days=chain.escalation_delay_days,
        notify_on_escalation=chain.notify_on_escalation,
        created_at=chain.created_at
    )


@router.delete("/escalation-chains/{chain_id}", response_model=MessageResponse)
def delete_escalation_chain(
    chain_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Delete an escalation chain"""
    user_tenants = get_user_tenants(current_user, db)
    
    chain = db.query(EscalationChain).filter(
        EscalationChain.id == chain_id,
        EscalationChain.tenant_id.in_(user_tenants)
    ).first()
    
    if not chain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Escalation chain not found")
    
    db.delete(chain)
    db.commit()
    
    return MessageResponse(message="Escalation chain deleted successfully")
