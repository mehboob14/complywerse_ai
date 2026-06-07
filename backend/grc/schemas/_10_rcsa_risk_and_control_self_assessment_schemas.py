from ._09_notification_schemas import *  # noqa: F401,F403

# =============================================================================
# RCSA (Risk and Control Self-Assessment) Schemas
# =============================================================================

class RCSAQuestionCreate(BaseModel):
    section: Optional[str] = None
    question_order: int = 0
    question_text: str
    question_type: str = "risk_rating"
    is_required: bool = True
    options: List[str] = []
    risk_category: Optional[str] = None
    control_objective: Optional[str] = None
    guidance_text: Optional[str] = None
    ai_suggestion_enabled: bool = True


class RCSAQuestionUpdate(BaseModel):
    section: Optional[str] = None
    question_order: Optional[int] = None
    question_text: Optional[str] = None
    question_type: Optional[str] = None
    is_required: Optional[bool] = None
    options: Optional[List[str]] = None
    risk_category: Optional[str] = None
    control_objective: Optional[str] = None
    guidance_text: Optional[str] = None
    ai_suggestion_enabled: Optional[bool] = None


class RCSAQuestionResponse(BaseModel):
    id: int
    template_id: int
    section: Optional[str]
    question_order: int
    question_text: str
    question_type: str
    is_required: bool
    options: List[str] = []
    risk_category: Optional[str]
    control_objective: Optional[str]
    guidance_text: Optional[str]
    ai_suggestion_enabled: bool
    created_at: datetime

    class Config:
        from_attributes = True


class RCSATemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    category: str
    source: str = "custom"
    version: str = "1.0"
    risk_categories: List[str] = []
    regulatory_mapping: Dict[str, Any] = {}
    questions: List[RCSAQuestionCreate] = []


class RCSAQuestionUpsert(BaseModel):
    """Used when saving questions via PUT /templates/{id}.
    id=None or a value that doesn't match an existing DB question means create new."""
    id: Optional[int] = None
    section: Optional[str] = None
    category: Optional[str] = None          # frontend alias for section
    question_order: Optional[int] = None
    sequence: Optional[int] = None          # frontend alias for question_order
    question_text: str
    question_type: str = "text"
    is_required: bool = True
    options: Optional[List[str]] = None
    risk_category: Optional[str] = None
    control_objective: Optional[str] = None
    guidance_text: Optional[str] = None
    guidance: Optional[str] = None          # frontend alias for guidance_text
    ai_suggestion_enabled: bool = True


class RCSATemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    version: Optional[str] = None
    is_active: Optional[bool] = None
    risk_categories: Optional[List[str]] = None
    regulatory_mapping: Optional[Dict[str, Any]] = None
    questions: Optional[List[RCSAQuestionUpsert]] = None


class RCSATemplateResponse(BaseModel):
    id: int
    tenant_id: Optional[int]
    name: str
    description: Optional[str]
    category: str
    source: str
    version: str
    is_system_template: bool
    is_active: bool
    risk_categories: List[str] = []
    regulatory_mapping: Dict[str, Any] = {}
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime
    question_count: int = 0

    class Config:
        from_attributes = True


class RCSATemplateDetailResponse(RCSATemplateResponse):
    questions: List[RCSAQuestionResponse] = []


class RCSACampaignCreate(BaseModel):
    template_id: int
    name: str
    description: Optional[str] = None
    period_type: str = "quarterly"
    period_label: Optional[str] = None
    start_date: datetime
    due_date: datetime
    approval_workflow_id: Optional[int] = None
    reminder_days_before: int = 7
    escalation_days_after: int = 3
    business_unit_ids: List[int] = []


class RCSACampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    period_type: Optional[str] = None
    period_label: Optional[str] = None
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    approval_workflow_id: Optional[int] = None
    reminder_days_before: Optional[int] = None
    escalation_days_after: Optional[int] = None


class RCSACampaignResponse(BaseModel):
    id: int
    tenant_id: int
    template_id: int
    template_name: Optional[str] = None
    name: str
    description: Optional[str] = None
    period_type: str = "quarterly"
    period_label: Optional[str] = None
    start_date: datetime
    due_date: datetime
    status: str = "draft"
    approval_workflow_id: Optional[int] = None
    reminder_days_before: Optional[int] = 7
    escalation_days_after: Optional[int] = 3
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    assessment_count: int = 0
    completed_count: int = 0

    class Config:
        from_attributes = True


class RCSAAssessmentResponse(BaseModel):
    id: int
    tenant_id: int
    campaign_id: int
    campaign_name: Optional[str] = None
    business_unit_id: int
    business_unit_name: Optional[str] = None
    status: str
    current_approval_tier: int
    assessor_id: Optional[int]
    assessor_name: Optional[str] = None
    due_date: Optional[datetime] = None
    assigned_at: Optional[datetime]
    started_at: Optional[datetime]
    submitted_at: Optional[datetime]
    completed_at: Optional[datetime]
    overall_risk_score: Optional[float]
    overall_control_score: Optional[float]
    ai_quality_score: Optional[int]
    ai_suggestions_used: int
    ai_gaps_identified: int
    notes: Optional[str]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    response_count: int = 0
    finding_count: int = 0

    class Config:
        from_attributes = True


class RCSAQuestionWithResponse(BaseModel):
    id: int
    section: Optional[str] = None
    question_text: str
    guidance: Optional[str] = None
    question_type: str
    is_required: bool = True
    sequence: int = 0
    question_order: int = 0
    ai_suggestion_enabled: bool = False
    risk_category: Optional[str] = None
    control_objective: Optional[str] = None


class RCSAEvidenceFile(BaseModel):
    id: int
    filename: str
    file_size: int = 0
    uploaded_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RCSAResponseDetail(BaseModel):
    question_id: int
    likelihood: Optional[int] = None
    impact: Optional[int] = None
    effectiveness: Optional[str] = None
    yes_no_value: Optional[bool] = None
    text_value: Optional[str] = None
    evidence: List[RCSAEvidenceFile] = []


class RCSAAssessmentDetailResponse(BaseModel):
    id: int
    campaign_id: int
    campaign_name: Optional[str] = None
    business_unit: Optional[str] = None
    assessor_name: Optional[str] = None
    status: str
    due_date: Optional[datetime] = None
    progress: float = 0
    questions: List[RCSAQuestionWithResponse] = []
    responses: List[RCSAResponseDetail] = []

    class Config:
        from_attributes = True


class RCSAResponseCreate(BaseModel):
    question_id: int
    response_value: Optional[str] = None
    likelihood_rating: Optional[int] = None
    impact_rating: Optional[int] = None
    control_effectiveness: Optional[str] = None
    control_description: Optional[str] = None
    last_tested_date: Optional[datetime] = None


class RCSAResponseUpdate(BaseModel):
    response_value: Optional[str] = None
    likelihood_rating: Optional[int] = None
    impact_rating: Optional[int] = None
    control_effectiveness: Optional[str] = None
    control_description: Optional[str] = None
    last_tested_date: Optional[datetime] = None
    ai_suggestion_accepted: Optional[bool] = None


class RCSAResponseResponse(BaseModel):
    id: int
    assessment_id: int
    question_id: int
    question_text: Optional[str] = None
    question_type: Optional[str] = None
    response_value: Optional[str]
    likelihood_rating: Optional[int]
    impact_rating: Optional[int]
    risk_score: Optional[float]
    control_effectiveness: Optional[str]
    control_description: Optional[str]
    last_tested_date: Optional[datetime]
    ai_suggestion: Optional[str]
    ai_suggestion_accepted: bool
    ai_gap_detected: bool
    ai_gap_description: Optional[str]
    responded_by: Optional[int]
    responded_at: Optional[datetime]

    class Config:
        from_attributes = True


class RCSABulkResponseSave(BaseModel):
    responses: List[RCSAResponseCreate]


class RCSAFindingCreate(BaseModel):
    finding_type: str
    severity: str = "medium"
    title: str
    description: Optional[str] = None
    risk_category: Optional[str] = None
    affected_controls: List[int] = []
    remediation_due_date: Optional[datetime] = None
    remediation_owner_id: Optional[int] = None


class RCSAFindingUpdate(BaseModel):
    finding_type: Optional[str] = None
    severity: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    risk_category: Optional[str] = None
    affected_controls: Optional[List[int]] = None
    status: Optional[str] = None
    remediation_due_date: Optional[datetime] = None
    remediation_owner_id: Optional[int] = None


class RCSAFindingResponse(BaseModel):
    id: int
    tenant_id: int
    assessment_id: int
    finding_type: str
    severity: str
    title: str
    description: Optional[str]
    risk_category: Optional[str]
    affected_controls: List[int] = []
    ai_generated: bool
    ai_recommendation: Optional[str]
    linked_risk_id: Optional[int]
    linked_internal_control_id: Optional[int]
    linked_mitigation_action_id: Optional[int]
    status: str
    remediation_due_date: Optional[datetime]
    remediation_owner_id: Optional[int]
    remediation_owner_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime]

    class Config:
        from_attributes = True


class RCSAApprovalTierCreate(BaseModel):
    tier_order: int
    tier_name: str
    approver_type: str
    approver_role_id: Optional[int] = None
    approver_user_id: Optional[int] = None
    can_delegate: bool = True
    auto_approve_days: Optional[int] = None


class RCSAApprovalTierResponse(BaseModel):
    id: int
    workflow_id: int
    tier_order: int
    tier_name: str
    approver_type: str
    approver_role_id: Optional[int]
    approver_user_id: Optional[int]
    can_delegate: bool
    auto_approve_days: Optional[int]

    class Config:
        from_attributes = True


class RCSAApprovalWorkflowCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_default: bool = False
    tiers: List[RCSAApprovalTierCreate] = []


class RCSAApprovalWorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class RCSAApprovalWorkflowResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    is_default: bool
    is_active: bool
    created_by: Optional[int]
    created_at: datetime
    updated_at: datetime
    tier_count: int = 0
    tiers: List[RCSAApprovalTierResponse] = []

    class Config:
        from_attributes = True


class RCSAApprovalHistoryResponse(BaseModel):
    id: int
    assessment_id: int
    tier_id: Optional[int]
    action: str
    tier_number: int
    performed_by: int
    performer_name: Optional[str] = None
    delegated_to: Optional[int]
    delegate_name: Optional[str] = None
    comments: Optional[str]
    performed_at: datetime

    class Config:
        from_attributes = True


class RCSAApprovalAction(BaseModel):
    comments: Optional[str] = None


class RCSADelegateAction(BaseModel):
    delegate_to_user_id: int
    comments: Optional[str] = None


class RCSABUAssignRequest(BaseModel):
    business_unit_ids: List[int]
    assessor_ids: Optional[Dict[int, int]] = None


class RCSADashboardSummary(BaseModel):
    total_campaigns: int
    active_campaigns: int
    total_assessments: int
    completed_assessments: int
    pending_approval: int
    overdue_assessments: int
    completion_rate: float
    avg_risk_score: Optional[float]
    avg_control_score: Optional[float]


class RCSAFindingsBySeverity(BaseModel):
    critical: int
    high: int
    medium: int
    low: int
    total: int
    by_type: Dict[str, int] = {}


class RCSABUProgress(BaseModel):
    business_unit_id: int
    business_unit_name: str
    total_assessments: int
    completed: int
    in_progress: int
    not_started: int
    completion_rate: float
    avg_risk_score: Optional[float]


class EvidenceRecommendation(BaseModel):
    evidence_type: str
    description: str
    example_files: List[str] = []


class RCSAAISuggestionResponse(BaseModel):
    question_id: int
    suggestion: str
    confidence: float
    reasoning: Optional[str] = None
    gaps_detected: List[str] = []
    evidence_recommendations: List[EvidenceRecommendation] = []

