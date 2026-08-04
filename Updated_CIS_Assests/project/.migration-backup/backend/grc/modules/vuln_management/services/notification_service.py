from typing import Optional, List
from datetime import datetime
from sqlalchemy.orm import Session

from ....models import (
    GRCVulnNotification, Vulnerability, GRCUser, GRCDepartment, GRCDepartmentMember
)


class NotificationService:
    NOTIFICATION_TYPES = [
        "assignment",
        "status_change", 
        "sla_warning",
        "sla_breach",
        "approval_required",
        "comment_added"
    ]
    
    @staticmethod
    def create_notification(
        db: Session,
        tenant_id: int,
        vulnerability_id: int,
        notification_type: str,
        title: str,
        message: Optional[str] = None,
        recipient_user_id: Optional[int] = None,
        recipient_department_id: Optional[int] = None,
        triggered_by_user_id: Optional[int] = None
    ) -> GRCVulnNotification:
        if notification_type not in NotificationService.NOTIFICATION_TYPES:
            raise ValueError(f"Invalid notification type: {notification_type}")
        
        notification = GRCVulnNotification(
            tenant_id=tenant_id,
            vulnerability_id=vulnerability_id,
            notification_type=notification_type,
            title=title,
            message=message,
            recipient_user_id=recipient_user_id,
            recipient_department_id=recipient_department_id,
            triggered_by_user_id=triggered_by_user_id
        )
        db.add(notification)
        db.commit()
        db.refresh(notification)
        return notification
    
    @staticmethod
    def create_assignment_notification(
        db: Session,
        vulnerability: Vulnerability,
        assigned_to_user_id: int,
        assigned_by_user_id: int
    ) -> GRCVulnNotification:
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="assignment",
            title=f"Vulnerability Assigned: {vulnerability.vuln_id}",
            message=f"You have been assigned to vulnerability '{vulnerability.title}' ({vulnerability.severity} severity).",
            recipient_user_id=assigned_to_user_id,
            triggered_by_user_id=assigned_by_user_id
        )
    
    @staticmethod
    def create_status_change_notification(
        db: Session,
        vulnerability: Vulnerability,
        old_state_name: Optional[str],
        new_state_name: str,
        changed_by_user_id: int,
        notify_user_id: Optional[int] = None
    ) -> GRCVulnNotification:
        message = f"Vulnerability '{vulnerability.title}' transitioned"
        if old_state_name:
            message += f" from '{old_state_name}'"
        message += f" to '{new_state_name}'."
        
        recipient = notify_user_id or vulnerability.assigned_to
        
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="status_change",
            title=f"Status Changed: {vulnerability.vuln_id}",
            message=message,
            recipient_user_id=recipient,
            triggered_by_user_id=changed_by_user_id
        )
    
    @staticmethod
    def create_approval_required_notification(
        db: Session,
        vulnerability: Vulnerability,
        approver_role: Optional[str],
        transition_name: str,
        requested_by_user_id: int,
        approver_user_id: Optional[int] = None,
        approver_department_id: Optional[int] = None
    ) -> GRCVulnNotification:
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="approval_required",
            title=f"Approval Required: {vulnerability.vuln_id}",
            message=f"Approval is required for transition '{transition_name}' on vulnerability '{vulnerability.title}'.",
            recipient_user_id=approver_user_id,
            recipient_department_id=approver_department_id,
            triggered_by_user_id=requested_by_user_id
        )
    
    @staticmethod
    def create_sla_warning_notification(
        db: Session,
        vulnerability: Vulnerability,
        sla_percentage: float,
        days_remaining: int
    ) -> GRCVulnNotification:
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="sla_warning",
            title=f"SLA Warning: {vulnerability.vuln_id}",
            message=f"SLA is {sla_percentage:.0f}% consumed. {days_remaining} days remaining to remediate '{vulnerability.title}'.",
            recipient_user_id=vulnerability.assigned_to
        )
    
    @staticmethod
    def create_sla_breach_notification(
        db: Session,
        vulnerability: Vulnerability,
        days_overdue: int
    ) -> GRCVulnNotification:
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="sla_breach",
            title=f"SLA Breach: {vulnerability.vuln_id}",
            message=f"SLA has been breached! Vulnerability '{vulnerability.title}' is {days_overdue} days overdue.",
            recipient_user_id=vulnerability.assigned_to
        )
    
    @staticmethod
    def create_comment_notification(
        db: Session,
        vulnerability: Vulnerability,
        comment_by_user_id: int,
        comment_snippet: str
    ) -> GRCVulnNotification:
        return NotificationService.create_notification(
            db=db,
            tenant_id=vulnerability.tenant_id,
            vulnerability_id=vulnerability.id,
            notification_type="comment_added",
            title=f"New Comment: {vulnerability.vuln_id}",
            message=f"New comment on '{vulnerability.title}': {comment_snippet[:100]}...",
            recipient_user_id=vulnerability.assigned_to,
            triggered_by_user_id=comment_by_user_id
        )
    
    @staticmethod
    def get_notifications_for_user(
        db: Session,
        user_id: int,
        tenant_ids: List[int],
        is_read: Optional[bool] = None,
        notification_type: Optional[str] = None,
        skip: int = 0,
        limit: int = 50
    ) -> List[GRCVulnNotification]:
        query = db.query(GRCVulnNotification).filter(
            GRCVulnNotification.tenant_id.in_(tenant_ids),
            GRCVulnNotification.recipient_user_id == user_id
        )
        
        if is_read is not None:
            query = query.filter(GRCVulnNotification.is_read == is_read)
        
        if notification_type:
            query = query.filter(GRCVulnNotification.notification_type == notification_type)
        
        return query.order_by(GRCVulnNotification.created_at.desc()).offset(skip).limit(limit).all()
    
    @staticmethod
    def get_unread_count(db: Session, user_id: int, tenant_ids: List[int]) -> int:
        return db.query(GRCVulnNotification).filter(
            GRCVulnNotification.tenant_id.in_(tenant_ids),
            GRCVulnNotification.recipient_user_id == user_id,
            GRCVulnNotification.is_read == False
        ).count()
    
    @staticmethod
    def mark_as_read(db: Session, notification_id: int, user_id: int) -> Optional[GRCVulnNotification]:
        notification = db.query(GRCVulnNotification).filter(
            GRCVulnNotification.id == notification_id,
            GRCVulnNotification.recipient_user_id == user_id
        ).first()
        
        if notification:
            notification.is_read = True
            notification.read_at = datetime.utcnow()
            db.commit()
            db.refresh(notification)
        
        return notification
    
    @staticmethod
    def mark_all_as_read(db: Session, user_id: int, tenant_ids: List[int]) -> int:
        result = db.query(GRCVulnNotification).filter(
            GRCVulnNotification.tenant_id.in_(tenant_ids),
            GRCVulnNotification.recipient_user_id == user_id,
            GRCVulnNotification.is_read == False
        ).update({
            "is_read": True,
            "read_at": datetime.utcnow()
        })
        db.commit()
        return result
