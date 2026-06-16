"""
Notification configuration router for workflow notifications
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from ....models import GRCUser, WorkflowNotification, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ..schemas import EmailConfigCreate, EmailConfigUpdate, EmailConfigResponse

router = APIRouter(prefix="/notifications", tags=["Workflow Notifications"])


def _to_utc_iso(value):
    if value is None:
        return None
    if getattr(value, "tzinfo", None) is not None:
        return value.isoformat()
    return value.isoformat() + "Z"


def _resolve_tenant_id(current_user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")
    return tenant_id


@router.post("/email-config", response_model=EmailConfigResponse)
def create_email_config(
    config: EmailConfigCreate,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """
    Configure email settings for workflow notifications (one-time setup).
    Users will be prompted to configure this when they add a notification node.
    """
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    # Check if config already exists
    existing = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.tenant_id == tenant_id,
        WorkflowEmailConfiguration.config_name == config.config_name
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=400, 
            detail=f"Email configuration '{config.config_name}' already exists"
        )
    
    # Create new configuration
    email_config = WorkflowEmailConfiguration(
        tenant_id=tenant_id,
        config_name=config.config_name,
        smtp_host=config.smtp_host,
        smtp_port=config.smtp_port,
        smtp_username=config.smtp_username,
        smtp_password=config.smtp_password,  # Should be encrypted in production
        from_email=config.from_email,
        from_name=config.from_name,
        use_tls=config.use_tls,
        is_active=True
    )
    
    db.add(email_config)
    db.commit()
    db.refresh(email_config)
    
    return email_config


@router.get("/email-config", response_model=List[EmailConfigResponse])
def list_email_configs(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """List all email configurations for the tenant"""
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    configs = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.tenant_id == tenant_id
    ).all()
    
    return configs


@router.get("/email-config/{config_id}", response_model=EmailConfigResponse)
def get_email_config(
    config_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Get a specific email configuration"""
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    config = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.id == config_id,
        WorkflowEmailConfiguration.tenant_id == tenant_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Email configuration not found")
    
    return config


@router.patch("/email-config/{config_id}", response_model=EmailConfigResponse)
def update_email_config(
    config_id: int,
    update_data: EmailConfigUpdate,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Update email configuration"""
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    config = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.id == config_id,
        WorkflowEmailConfiguration.tenant_id == tenant_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Email configuration not found")
    
    # Update fields
    for field, value in update_data.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    
    db.commit()
    db.refresh(config)
    
    return config


@router.delete("/email-config/{config_id}")
def delete_email_config(
    config_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Delete email configuration"""
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    config = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.id == config_id,
        WorkflowEmailConfiguration.tenant_id == tenant_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Email configuration not found")
    
    db.delete(config)
    db.commit()
    
    return {"message": "Email configuration deleted successfully"}


@router.post("/email-config/{config_id}/test")
def test_email_config(
    config_id: int,
    test_email: str,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Test email configuration by sending a test email"""
    from ....models import WorkflowEmailConfiguration
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    tenant_id = _resolve_tenant_id(current_user, db)
    
    config = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.id == config_id,
        WorkflowEmailConfiguration.tenant_id == tenant_id
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="Email configuration not found")
    
    try:
        # Create test message
        msg = MIMEMultipart()
        msg['From'] = f"{config.from_name or 'ComplyVerse'} <{config.from_email}>"
        msg['To'] = test_email
        msg['Subject'] = "Test Email from ComplyVerse Workflow Engine"
        
        body = """
        <html>
        <body>
            <h2>Email Configuration Test</h2>
            <p>This is a test email from your ComplyVerse workflow engine.</p>
            <p>If you received this, your email configuration is working correctly!</p>
            <hr>
            <p><small>Configuration: {config_name}</small></p>
        </body>
        </html>
        """.format(config_name=config.config_name)
        
        msg.attach(MIMEText(body, 'html'))
        
        # Send email
        if config.use_tls:
            server = smtplib.SMTP(config.smtp_host, config.smtp_port)
            server.starttls()
        else:
            server = smtplib.SMTP(config.smtp_host, config.smtp_port)
        
        server.login(config.smtp_username, config.smtp_password)
        server.send_message(msg)
        server.quit()
        
        return {
            "success": True,
            "message": f"Test email sent successfully to {test_email}"
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to send test email: {str(e)}"
        )


@router.get("/check-setup")
def check_notification_setup(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db)
):
    """Check if user has configured notifications"""
    from ....models import WorkflowEmailConfiguration
    tenant_id = _resolve_tenant_id(current_user, db)
    
    email_configs = db.query(WorkflowEmailConfiguration).filter(
        WorkflowEmailConfiguration.tenant_id == tenant_id,
        WorkflowEmailConfiguration.is_active == True
    ).count()
    
    return {
        "has_email_config": email_configs > 0,
        "email_config_count": email_configs,
        "requires_setup": email_configs == 0,
        "message": "Email notifications configured" if email_configs > 0 else "Please configure email settings to use notification nodes"
    }


@router.get("/in-app")
def list_in_app_notifications(
    unread_only: bool = False,
    limit: int = 100,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"items": [], "total": 0}

    safe_limit = max(1, min(limit, 200))
    query = db.query(WorkflowNotification).filter(
        WorkflowNotification.tenant_id.in_(tenant_ids),
        WorkflowNotification.user_id == current_user.id,
    )
    if unread_only:
        query = query.filter(WorkflowNotification.is_read.is_(False))

    items = query.order_by(WorkflowNotification.created_at.desc()).limit(safe_limit).all()
    return {
        "items": [
            {
                "id": item.id,
                "workflow_instance_id": item.workflow_instance_id,
                "notification_type": item.notification_type,
                "subject": item.subject,
                "message": item.message,
                "is_read": item.is_read,
                "read_at": _to_utc_iso(item.read_at),
                "created_at": _to_utc_iso(item.created_at),
            }
            for item in items
        ],
        "total": len(items),
    }


@router.post("/in-app/{notification_id}/read")
def mark_in_app_notification_read(
    notification_id: int,
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    tenant_ids = get_user_tenants(current_user, db)
    notification = db.query(WorkflowNotification).filter(
        WorkflowNotification.id == notification_id,
        WorkflowNotification.tenant_id.in_(tenant_ids),
        WorkflowNotification.user_id == current_user.id,
    ).first()

    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    from datetime import datetime
    notification.is_read = True
    notification.read_at = datetime.utcnow()
    db.commit()

    return {"status": "ok", "notification_id": notification.id}


@router.post("/in-app/read-all")
def mark_all_in_app_notifications_read(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"status": "ok", "updated": 0}

    from datetime import datetime
    rows = db.query(WorkflowNotification).filter(
        WorkflowNotification.tenant_id.in_(tenant_ids),
        WorkflowNotification.user_id == current_user.id,
        WorkflowNotification.is_read.is_(False),
    ).all()

    now = datetime.utcnow()
    for row in rows:
        row.is_read = True
        row.read_at = now

    db.commit()
    return {"status": "ok", "updated": len(rows)}


@router.get("/in-app/unread-count")
def get_unread_notification_count(
    current_user: GRCUser = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Fast endpoint polled by the navbar bell badge."""
    tenant_ids = get_user_tenants(current_user, db)
    if not tenant_ids:
        return {"count": 0}
    count = db.query(WorkflowNotification).filter(
        WorkflowNotification.tenant_id.in_(tenant_ids),
        WorkflowNotification.user_id == current_user.id,
        WorkflowNotification.is_read.is_(False),
    ).count()
    return {"count": count}
