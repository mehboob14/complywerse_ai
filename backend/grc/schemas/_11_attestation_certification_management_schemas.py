from ._10_rcsa_risk_and_control_self_assessment_schemas import *  # noqa: F401,F403

# =============================================================================
# Attestation & Certification Management Schemas
# =============================================================================

class EscalationChainCreate(BaseModel):
    tier: int
    tier_name: Optional[str] = None
    approver_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    role_id: Optional[int] = None
    escalation_delay_days: int = 3
    notify_on_escalation: bool = True


class EscalationChainResponse(BaseModel):
    id: int
    tenant_id: int
    campaign_id: int
    tier: int
    tier_name: Optional[str]
    approver_id: Optional[int]
    approver_name: Optional[str] = None
    business_unit_id: Optional[int]
    business_unit_name: Optional[str] = None
    role_id: Optional[int]
    role_name: Optional[str] = None
    escalation_delay_days: int
    notify_on_escalation: bool
    created_at: datetime

    class Config:
        from_attributes = True


class AttestationCampaignCreate(BaseModel):
    name: str
    description: Optional[str] = None
    campaign_type: str  # sox_302, sox_404, policy_signoff, bcp_awareness, training_acknowledgment, annual_certification
    start_date: Optional[datetime] = None
    due_date: datetime
    target_type: str = "all_users"  # all_users, by_department, by_role, custom
    target_department_ids: List[int] = []
    target_role_ids: List[int] = []
    target_user_ids: List[int] = []
    escalation_enabled: bool = True
    reminder_days_before: int = 7
    escalation_days_after: int = 3
    attestation_text: Optional[str] = None
    requires_evidence: bool = False
    linked_document_id: Optional[int] = None
    escalation_chains: List[EscalationChainCreate] = []


class AttestationCampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    target_type: Optional[str] = None
    target_department_ids: Optional[List[int]] = None
    target_role_ids: Optional[List[int]] = None
    target_user_ids: Optional[List[int]] = None
    escalation_enabled: Optional[bool] = None
    reminder_days_before: Optional[int] = None
    escalation_days_after: Optional[int] = None
    attestation_text: Optional[str] = None
    requires_evidence: Optional[bool] = None
    linked_document_id: Optional[int] = None


class AttestationCampaignResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    campaign_type: str
    start_date: Optional[datetime]
    due_date: datetime
    status: str
    target_type: str
    target_department_ids: List[int] = []
    target_role_ids: List[int] = []
    target_user_ids: List[int] = []
    escalation_enabled: bool
    reminder_days_before: int
    escalation_days_after: int
    attestation_text: Optional[str]
    requires_evidence: bool
    linked_document_id: Optional[int]
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime
    total_requests: int = 0
    completed_requests: int = 0
    completion_rate: float = 0.0

    class Config:
        from_attributes = True


class AttestationCampaignDetailResponse(AttestationCampaignResponse):
    escalation_chains: List[EscalationChainResponse] = []
    creator_name: Optional[str] = None
    linked_document_title: Optional[str] = None


class AttestationRequestCreate(BaseModel):
    user_id: int
    attestation_type: Optional[str] = None
    due_date: Optional[datetime] = None
    attestation_text: Optional[str] = None


class AttestationRequestUpdate(BaseModel):
    status: Optional[str] = None
    due_date: Optional[datetime] = None
    attestation_text: Optional[str] = None


class AttestationRequestResponse(BaseModel):
    id: int
    tenant_id: int
    campaign_id: int
    campaign_name: Optional[str] = None
    user_id: int
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    attestation_type: str
    status: str
    assigned_at: datetime
    due_date: datetime
    completed_at: Optional[datetime]
    escalation_tier: int
    escalated_to_id: Optional[int]
    escalated_to_name: Optional[str] = None
    reminder_sent_at: Optional[datetime]
    reminder_count: int
    escalation_sent_at: Optional[datetime]
    user_comments: Optional[str]
    attestation_text: Optional[str]
    evidence_id: Optional[int]
    is_overdue: bool = False
    days_until_due: Optional[int] = None

    class Config:
        from_attributes = True


class AttestationCompleteRequest(BaseModel):
    user_comments: Optional[str] = None
    evidence_id: Optional[int] = None


class AttestationDashboardStats(BaseModel):
    total_campaigns: int
    active_campaigns: int
    draft_campaigns: int
    closed_campaigns: int
    total_requests: int
    pending_requests: int
    completed_requests: int
    overdue_requests: int
    escalated_requests: int
    completion_rate: float
    by_campaign_type: Dict[str, int] = {}
    by_status: Dict[str, int] = {}
    upcoming_deadlines: List[Dict[str, Any]] = []


class AttestationReminderResponse(BaseModel):
    message: str
    reminder_count: int
    reminder_sent_at: datetime


class AttestationEscalateResponse(BaseModel):
    message: str
    new_tier: int
    escalated_to_id: Optional[int]
    escalated_to_name: Optional[str]

