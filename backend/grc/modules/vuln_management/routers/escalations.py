from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    GRCVulnEscalationLog, GRCVulnNotification, Vulnerability,
    GRCVulnWorkflowEscalation, GRCTeam, GRCUser, GRCVulnWorkflowState,
    get_db
)
from ....schemas import (
    GRCVulnEscalationLogResponse, GRCVulnNotificationResponse,
    EscalationCheckResult, UnreadNotificationCount, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ..services.escalation_service import EscalationService
from ..services.notification_service import NotificationService

router = APIRouter(tags=["Escalations & Notifications"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("/escalations/check", response_model=EscalationCheckResult)
def run_escalation_check(
    auto_transition: bool = True,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        tenant_ids = [tenant_id]
    else:
        tenant_ids = user_tenants
    
    result = EscalationService.run_escalation_check(
        db=db,
        tenant_ids=tenant_ids,
        auto_transition=auto_transition,
        system_user_id=current_user.id
    )
    
    return EscalationCheckResult(
        total_checked=result["total_checked"],
        escalations_triggered=result["escalations_triggered"],
        vulnerabilities_affected=result["vulnerabilities_affected"],
        details=result["details"]
    )


@router.get("/escalations/logs", response_model=List[GRCVulnEscalationLogResponse])
def list_escalation_logs(
    vulnerability_id: Optional[int] = None,
    escalation_rule_id: Optional[int] = None,
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        tenant_ids = [tenant_id]
    else:
        tenant_ids = user_tenants
    
    logs = db.query(GRCVulnEscalationLog).options(
        joinedload(GRCVulnEscalationLog.vulnerability),
        joinedload(GRCVulnEscalationLog.escalation_rule),
        joinedload(GRCVulnEscalationLog.escalated_to_team),
        joinedload(GRCVulnEscalationLog.escalated_to_user),
        joinedload(GRCVulnEscalationLog.new_state)
    ).join(
        Vulnerability, GRCVulnEscalationLog.vulnerability_id == Vulnerability.id
    ).filter(
        Vulnerability.tenant_id.in_(tenant_ids)
    )
    
    if vulnerability_id:
        logs = logs.filter(GRCVulnEscalationLog.vulnerability_id == vulnerability_id)
    
    if escalation_rule_id:
        logs = logs.filter(GRCVulnEscalationLog.escalation_rule_id == escalation_rule_id)
    
    logs = logs.order_by(GRCVulnEscalationLog.triggered_at.desc()).offset(skip).limit(limit).all()
    
    return [
        GRCVulnEscalationLogResponse(
            id=log.id,
            vulnerability_id=log.vulnerability_id,
            vulnerability_title=log.vulnerability.title if log.vulnerability else None,
            escalation_rule_id=log.escalation_rule_id,
            escalation_rule_name=log.escalation_rule.name if log.escalation_rule else None,
            triggered_at=log.triggered_at,
            escalated_to_team_id=log.escalated_to_team_id,
            escalated_to_team_name=log.escalated_to_team.name if log.escalated_to_team else None,
            escalated_to_user_id=log.escalated_to_user_id,
            escalated_to_user_name=log.escalated_to_user.display_name if log.escalated_to_user else None,
            notification_sent=log.notification_sent,
            auto_transitioned=log.auto_transitioned,
            new_state_id=log.new_state_id,
            new_state_name=log.new_state.name if log.new_state else None,
            notes=log.notes
        )
        for log in logs
    ]


@router.get("/vulnerabilities/{vuln_id}/escalations", response_model=List[GRCVulnEscalationLogResponse])
def get_vulnerability_escalations(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    logs = db.query(GRCVulnEscalationLog).options(
        joinedload(GRCVulnEscalationLog.escalation_rule),
        joinedload(GRCVulnEscalationLog.escalated_to_team),
        joinedload(GRCVulnEscalationLog.escalated_to_user),
        joinedload(GRCVulnEscalationLog.new_state)
    ).filter(
        GRCVulnEscalationLog.vulnerability_id == vuln_id
    ).order_by(GRCVulnEscalationLog.triggered_at.desc()).all()
    
    return [
        GRCVulnEscalationLogResponse(
            id=log.id,
            vulnerability_id=log.vulnerability_id,
            vulnerability_title=vuln.title,
            escalation_rule_id=log.escalation_rule_id,
            escalation_rule_name=log.escalation_rule.name if log.escalation_rule else None,
            triggered_at=log.triggered_at,
            escalated_to_team_id=log.escalated_to_team_id,
            escalated_to_team_name=log.escalated_to_team.name if log.escalated_to_team else None,
            escalated_to_user_id=log.escalated_to_user_id,
            escalated_to_user_name=log.escalated_to_user.display_name if log.escalated_to_user else None,
            notification_sent=log.notification_sent,
            auto_transitioned=log.auto_transitioned,
            new_state_id=log.new_state_id,
            new_state_name=log.new_state.name if log.new_state else None,
            notes=log.notes
        )
        for log in logs
    ]


@router.get("/notifications", response_model=List[GRCVulnNotificationResponse])
def list_notifications(
    is_read: Optional[bool] = None,
    notification_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    notifications = db.query(GRCVulnNotification).options(
        joinedload(GRCVulnNotification.vulnerability),
        joinedload(GRCVulnNotification.recipient_user),
        joinedload(GRCVulnNotification.recipient_team),
        joinedload(GRCVulnNotification.triggered_by)
    ).filter(
        GRCVulnNotification.tenant_id.in_(user_tenants),
        GRCVulnNotification.recipient_user_id == current_user.id
    )
    
    if is_read is not None:
        notifications = notifications.filter(GRCVulnNotification.is_read == is_read)
    
    if notification_type:
        notifications = notifications.filter(GRCVulnNotification.notification_type == notification_type)
    
    notifications = notifications.order_by(
        GRCVulnNotification.created_at.desc()
    ).offset(skip).limit(limit).all()
    
    return [
        GRCVulnNotificationResponse(
            id=n.id,
            tenant_id=n.tenant_id,
            vulnerability_id=n.vulnerability_id,
            vulnerability_title=n.vulnerability.title if n.vulnerability else None,
            notification_type=n.notification_type,
            title=n.title,
            message=n.message,
            recipient_user_id=n.recipient_user_id,
            recipient_user_name=n.recipient_user.display_name if n.recipient_user else None,
            recipient_team_id=n.recipient_team_id,
            recipient_team_name=n.recipient_team.name if n.recipient_team else None,
            triggered_by_user_id=n.triggered_by_user_id,
            triggered_by_name=n.triggered_by.display_name if n.triggered_by else None,
            is_read=n.is_read,
            read_at=n.read_at,
            created_at=n.created_at
        )
        for n in notifications
    ]


@router.get("/notifications/unread-count", response_model=UnreadNotificationCount)
def get_unread_notification_count(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return UnreadNotificationCount(count=0)
    
    count = NotificationService.get_unread_count(db, current_user.id, user_tenants)
    return UnreadNotificationCount(count=count)


@router.put("/notifications/{notification_id}/read", response_model=GRCVulnNotificationResponse)
def mark_notification_as_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    notification = NotificationService.mark_as_read(db, notification_id, current_user.id)
    
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    return GRCVulnNotificationResponse(
        id=notification.id,
        tenant_id=notification.tenant_id,
        vulnerability_id=notification.vulnerability_id,
        vulnerability_title=notification.vulnerability.title if notification.vulnerability else None,
        notification_type=notification.notification_type,
        title=notification.title,
        message=notification.message,
        recipient_user_id=notification.recipient_user_id,
        recipient_user_name=notification.recipient_user.display_name if notification.recipient_user else None,
        recipient_team_id=notification.recipient_team_id,
        recipient_team_name=notification.recipient_team.name if notification.recipient_team else None,
        triggered_by_user_id=notification.triggered_by_user_id,
        triggered_by_name=notification.triggered_by.display_name if notification.triggered_by else None,
        is_read=notification.is_read,
        read_at=notification.read_at,
        created_at=notification.created_at
    )


@router.put("/notifications/read-all", response_model=MessageResponse)
def mark_all_notifications_as_read(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return MessageResponse(message="No notifications to mark as read")
    
    count = NotificationService.mark_all_as_read(db, current_user.id, user_tenants)
    return MessageResponse(message=f"Marked {count} notifications as read")
