from ._08_escalation_log_schemas import *  # noqa: F401,F403

# =============================================================================
# Notification Schemas
# =============================================================================

class GRCVulnNotificationCreate(BaseModel):
    vulnerability_id: int
    notification_type: str
    title: str
    message: Optional[str] = None
    recipient_user_id: Optional[int] = None
    recipient_department_id: Optional[int] = None


class GRCVulnNotificationResponse(BaseModel):
    id: int
    tenant_id: int
    vulnerability_id: int
    vulnerability_title: Optional[str] = None
    notification_type: str
    title: str
    message: Optional[str]
    recipient_user_id: Optional[int]
    recipient_user_name: Optional[str] = None
    recipient_department_id: Optional[int]
    recipient_department_name: Optional[str] = None
    triggered_by_user_id: Optional[int]
    triggered_by_name: Optional[str] = None
    is_read: bool
    read_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class UnreadNotificationCount(BaseModel):
    count: int


class SLACheckResult(BaseModel):
    total_checked: int
    warnings_sent: int
    breaches_detected: int
    escalations_triggered: int
    emails_sent: int
    vulnerabilities_affected: List[int] = []
    details: List[Dict[str, Any]] = []

