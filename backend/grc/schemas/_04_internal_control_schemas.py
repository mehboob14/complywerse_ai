from ._03_likelihood_impact_scale_schemas import *  # noqa: F401,F403

# =============================================================================
# Internal Control Schemas
# =============================================================================

class InternalControlBase(BaseModel):
    # Optional on create — when omitted, the create endpoint auto-generates
    # the next IC-NNNN sequence for the caller's tenant. Explicit values are
    # still accepted so imports / migrations that bring their own IDs keep
    # working unchanged.
    control_id: Optional[str] = None
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    control_type: str = "preventive"
    control_nature: str = "manual"
    department_id: Optional[int] = None
    owner_id: Optional[int] = None
    backup_owner_id: Optional[int] = None
    frequency: Optional[str] = None
    regulatory_source: Optional[str] = None
    effective_date: Optional[datetime] = None
    review_date: Optional[datetime] = None
    priority: str = "medium"
    is_key_control: bool = False
    source_document_id: Optional[int] = None


class InternalControlCreate(InternalControlBase):
    pass


class InternalControlUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    sub_category: Optional[str] = None
    control_type: Optional[str] = None
    control_nature: Optional[str] = None
    department_id: Optional[int] = None
    owner_id: Optional[int] = None
    backup_owner_id: Optional[int] = None
    frequency: Optional[str] = None
    regulatory_source: Optional[str] = None
    effective_date: Optional[datetime] = None
    review_date: Optional[datetime] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    is_key_control: Optional[bool] = None
    source_document_id: Optional[int] = None
    design_effectiveness: Optional[str] = None
    operating_effectiveness: Optional[str] = None
    next_test_date: Optional[datetime] = None


class InternalControlResponse(BaseModel):
    id: int
    tenant_id: int
    control_id: str
    name: str
    description: Optional[str]
    category: Optional[str]
    sub_category: Optional[str]
    control_type: str
    control_nature: str
    department_id: Optional[int]
    owner_id: Optional[int]
    backup_owner_id: Optional[int]
    frequency: Optional[str]
    regulatory_source: Optional[str]
    effective_date: Optional[datetime]
    review_date: Optional[datetime]
    status: str
    workflow_status: Optional[str]
    design_effectiveness: Optional[str]
    operating_effectiveness: Optional[str]
    last_tested_at: Optional[datetime]
    next_test_date: Optional[datetime]
    priority: str
    is_key_control: bool
    source_document_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    owner_name: Optional[str] = None
    department_name: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlDetailResponse(InternalControlResponse):
    owner_name: Optional[str] = None
    backup_owner_name: Optional[str] = None
    department_name: Optional[str] = None
    tests: List[dict] = []
    risk_links: List[dict] = []
    framework_links: List[dict] = []
    escalations: List[dict] = []

    class Config:
        from_attributes = True


class InternalControlTestBase(BaseModel):
    test_type: str
    test_period_start: Optional[datetime] = None
    test_period_end: Optional[datetime] = None
    sample_size: Optional[int] = None
    exceptions_found: int = 0
    result: str
    findings: Optional[str] = None
    recommendations: Optional[str] = None
    evidence_references: List[Any] = []


class InternalControlTestCreate(InternalControlTestBase):
    pass


class InternalControlTestUpdate(BaseModel):
    test_type: Optional[str] = None
    test_date: Optional[datetime] = None
    test_period_start: Optional[datetime] = None
    test_period_end: Optional[datetime] = None
    sample_size: Optional[int] = None
    exceptions_found: Optional[int] = None
    result: Optional[str] = None
    findings: Optional[str] = None
    recommendations: Optional[str] = None
    management_response: Optional[str] = None
    status: Optional[str] = None
    evidence_references: Optional[List[Any]] = None


class InternalControlTestResponse(BaseModel):
    id: int
    control_id: int
    tenant_id: int
    test_type: str
    test_date: datetime
    test_period_start: Optional[datetime]
    test_period_end: Optional[datetime]
    tester_id: Optional[int]
    reviewer_id: Optional[int]
    sample_size: Optional[int]
    exceptions_found: int
    result: str
    findings: Optional[str]
    recommendations: Optional[str]
    management_response: Optional[str]
    evidence_references: List[Any]
    status: str
    reviewed_at: Optional[datetime]
    created_at: datetime
    tester_name: Optional[str] = None
    reviewer_name: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlRiskLinkCreate(BaseModel):
    risk_id: int
    link_type: str = "mitigates"
    effectiveness_rating: Optional[str] = None
    notes: Optional[str] = None


class InternalControlRiskLinkResponse(BaseModel):
    id: int
    control_id: int
    risk_id: int
    link_type: str
    effectiveness_rating: Optional[str]
    notes: Optional[str]
    created_at: datetime
    created_by: Optional[int]
    risk_title: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlFrameworkLinkCreate(BaseModel):
    framework_control_id: Optional[int] = None
    normalized_control_id: Optional[int] = None
    mapping_type: str = "satisfies"
    coverage_percentage: int = 100
    notes: Optional[str] = None


class InternalControlFrameworkLinkResponse(BaseModel):
    id: int
    internal_control_id: int
    framework_control_id: Optional[int]
    normalized_control_id: Optional[int]
    mapping_type: str
    coverage_percentage: int
    notes: Optional[str]
    created_at: datetime
    created_by: Optional[int]
    framework_control_code: Optional[str] = None
    framework_control_name: Optional[str] = None
    normalized_control_code: Optional[str] = None
    normalized_control_name: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlEscalationBase(BaseModel):
    escalation_level: int = 1
    escalation_name: str
    trigger_condition: str
    trigger_threshold: Optional[int] = None
    escalate_to_user_id: Optional[int] = None
    escalate_to_role: Optional[str] = None
    escalate_to_department_id: Optional[int] = None
    escalation_timeframe_hours: int = 24
    notification_required: bool = True
    is_active: bool = True


class InternalControlEscalationCreate(InternalControlEscalationBase):
    pass


class InternalControlEscalationUpdate(BaseModel):
    escalation_level: Optional[int] = None
    escalation_name: Optional[str] = None
    trigger_condition: Optional[str] = None
    trigger_threshold: Optional[int] = None
    escalate_to_user_id: Optional[int] = None
    escalate_to_role: Optional[str] = None
    escalate_to_department_id: Optional[int] = None
    escalation_timeframe_hours: Optional[int] = None
    notification_required: Optional[bool] = None
    is_active: Optional[bool] = None


class InternalControlEscalationResponse(BaseModel):
    id: int
    control_id: int
    tenant_id: int
    escalation_level: int
    escalation_name: str
    trigger_condition: str
    trigger_threshold: Optional[int]
    escalate_to_user_id: Optional[int]
    escalate_to_role: Optional[str]
    escalate_to_department_id: Optional[int]
    escalation_timeframe_hours: int
    notification_required: bool
    is_active: bool
    created_at: datetime
    escalate_to_user_name: Optional[str] = None
    escalate_to_department_name: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlWorkflowActionCreate(BaseModel):
    comments: Optional[str] = None


class InternalControlWorkflowActionResponse(BaseModel):
    id: int
    control_id: int
    action: str
    action_by: int
    action_at: datetime
    from_status: Optional[str]
    to_status: Optional[str]
    comments: Optional[str]
    actor_name: Optional[str] = None

    class Config:
        from_attributes = True


class InternalControlDashboard(BaseModel):
    total_controls: int
    by_status: Dict[str, int]
    by_category: Dict[str, int]
    by_control_type: Dict[str, int]
    by_department: Dict[str, int]
    key_controls: int
    pending_approval: int
    controls_needing_test: int
    effective_controls: int
    ineffective_controls: int

