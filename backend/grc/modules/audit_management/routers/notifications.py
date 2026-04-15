from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from ....models import AuditNotificationTemplate, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/notifications", tags=["Audit - Notifications"])


TEMPLATE_TYPES = [
    "fieldwork_start",
    "finding_response_deadline",
    "overdue_action_plan",
    "qaip_review",
    "certification_expiry",
    "engagement_kickoff",
    "finding_notification",
    "remediation_due",
    "remediation_overdue",
    "report_issued",
    "plan_approved",
    "follow_up_scheduled",
    "engagement_completed",
    "custom",
]

DEFAULT_TEMPLATES = [
    {
        "name": "Fieldwork Start Reminder",
        "template_type": "fieldwork_start",
        "subject": "Fieldwork Starting Soon: {{engagement_title}}",
        "body": "Dear {{recipient_name}},\n\nThis is a reminder that fieldwork for audit engagement \"{{engagement_title}}\" ({{engagement_number}}) is scheduled to begin on {{planned_start}}.\n\nScope: {{engagement_scope}}\nPlanned End: {{planned_end}}\nLead Auditor: {{lead_auditor}}\nTeam Members: {{team_members}}\n\nPlease ensure all relevant documentation, system access, and key contacts are available for the audit team.\n\nBest regards,\nInternal Audit Team",
        "trigger_event": "fieldwork_starting",
    },
    {
        "name": "Finding Response Deadline",
        "template_type": "finding_response_deadline",
        "subject": "Management Response Required: {{finding_title}} [{{severity}}] - Due {{due_date}}",
        "body": "Dear {{recipient_name}},\n\nA management response is required for the following audit finding.\n\nFinding: {{finding_title}}\nEngagement: {{engagement_title}}\nSeverity: {{severity}}\nResponse Deadline: {{due_date}}\nDays Remaining: {{days_remaining}}\n\nCondition: {{finding_condition}}\nCriteria: {{finding_criteria}}\n\nPlease submit your management response including the action plan, responsible party, and target completion date by the deadline.\n\nBest regards,\nInternal Audit Team",
        "trigger_event": "finding_response_due",
    },
    {
        "name": "Overdue Action Plan Alert",
        "template_type": "overdue_action_plan",
        "subject": "OVERDUE Action Plan: {{finding_title}} - Immediate Attention Required",
        "body": "Dear {{recipient_name}},\n\nThe action plan for finding \"{{finding_title}}\" is now OVERDUE.\n\nEngagement: {{engagement_title}}\nSeverity: {{severity}}\nOriginal Due Date: {{due_date}}\nDays Overdue: {{days_overdue}}\nAction Plan Owner: {{action_plan_owner}}\nCurrent Status: {{finding_status}}\n\nPlease escalate this matter and provide an updated completion timeline immediately.\n\nBest regards,\nInternal Audit Team",
        "trigger_event": "action_plan_overdue",
    },
    {
        "name": "QAIP Review Schedule",
        "template_type": "qaip_review",
        "subject": "Quality Assurance Review Scheduled: {{review_title}}",
        "body": "Dear {{recipient_name}},\n\nA Quality Assurance and Improvement Program (QAIP) review has been scheduled.\n\nReview Title: {{review_title}}\nReview Type: {{review_type}}\nScheduled Date: {{scheduled_date}}\nReviewer: {{reviewer_name}}\nScope: {{review_scope}}\n\nPlease ensure all relevant workpapers and documentation are prepared for the review.\n\nBest regards,\nInternal Audit Team",
        "trigger_event": "qaip_review_scheduled",
    },
    {
        "name": "Certification Expiry Alert",
        "template_type": "certification_expiry",
        "subject": "Certification Expiring: {{certification_name}} - {{days_until_expiry}} Days Remaining",
        "body": "Dear {{recipient_name}},\n\nThis is to notify you that the following certification is approaching its expiry date.\n\nCertification: {{certification_name}}\nFramework: {{framework_name}}\nExpiry Date: {{expiry_date}}\nDays Until Expiry: {{days_until_expiry}}\nCertifying Body: {{certifying_body}}\n\nPlease initiate the renewal process to ensure continued compliance.\n\nBest regards,\nInternal Audit Team",
        "trigger_event": "certification_expiry_approaching",
    },
]


class NotificationTemplateCreate(BaseModel):
    name: str
    template_type: str
    subject: str
    body: str
    is_active: Optional[bool] = True
    trigger_event: Optional[str] = None
    recipients_config: Optional[dict] = {}


class NotificationTemplateUpdate(BaseModel):
    name: Optional[str] = None
    template_type: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    is_active: Optional[bool] = None
    trigger_event: Optional[str] = None
    recipients_config: Optional[dict] = None


@router.get("/templates")
def list_templates(
    template_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    query = db.query(AuditNotificationTemplate).filter(
        AuditNotificationTemplate.tenant_id.in_(user_tenants)
    )
    if template_type:
        query = query.filter(AuditNotificationTemplate.template_type == template_type)
    templates = query.order_by(AuditNotificationTemplate.name).all()
    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "template_type": t.template_type,
                "subject": t.subject,
                "body": t.body,
                "is_active": t.is_active,
                "trigger_event": t.trigger_event,
                "recipients_config": t.recipients_config or {},
                "created_at": t.created_at.isoformat() if t.created_at else None,
                "updated_at": t.updated_at.isoformat() if t.updated_at else None,
            }
            for t in templates
        ],
        "template_types": TEMPLATE_TYPES,
    }


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(
    data: NotificationTemplateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    template = AuditNotificationTemplate(
        tenant_id=tenant_id,
        name=data.name,
        template_type=data.template_type,
        subject=data.subject,
        body=data.body,
        is_active=data.is_active,
        trigger_event=data.trigger_event,
        recipients_config=data.recipients_config or {},
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {"id": template.id, "message": "Template created"}


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    data: NotificationTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = db.query(AuditNotificationTemplate).filter(
        AuditNotificationTemplate.id == template_id,
        AuditNotificationTemplate.tenant_id.in_(user_tenants)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    for field in ["name", "template_type", "subject", "body", "is_active", "trigger_event", "recipients_config"]:
        val = getattr(data, field, None)
        if val is not None:
            setattr(template, field, val)

    db.commit()
    return {"message": "Template updated"}


@router.delete("/templates/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = db.query(AuditNotificationTemplate).filter(
        AuditNotificationTemplate.id == template_id,
        AuditNotificationTemplate.tenant_id.in_(user_tenants)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()
    return {"message": "Template deleted"}


@router.post("/templates/seed-defaults")
def seed_default_templates(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    existing = db.query(AuditNotificationTemplate).filter(
        AuditNotificationTemplate.tenant_id == tenant_id
    ).count()
    if existing > 0:
        return {"message": "Templates already exist", "seeded": 0}

    count = 0
    for tmpl in DEFAULT_TEMPLATES:
        template = AuditNotificationTemplate(
            tenant_id=tenant_id,
            name=tmpl["name"],
            template_type=tmpl["template_type"],
            subject=tmpl["subject"],
            body=tmpl["body"],
            trigger_event=tmpl["trigger_event"],
        )
        db.add(template)
        count += 1

    db.commit()
    return {"message": f"Seeded {count} default templates", "seeded": count}
