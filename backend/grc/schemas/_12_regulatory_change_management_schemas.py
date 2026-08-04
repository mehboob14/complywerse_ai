from ._11_attestation_certification_management_schemas import *  # noqa: F401,F403

# =============================================================================
# Regulatory Change Management Schemas
# =============================================================================

class RegulatoryChangeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    source: Optional[str] = "custom"  # SBP, SAMA, QCB, MAS, NCA, OCC, Fed, EBA, PRA, SEC, FINRA, custom
    regulation_reference: Optional[str] = None
    reference_number: Optional[str] = None  # legacy alias for regulation_reference
    effective_date: Optional[Union[datetime, str]] = None
    published_date: Optional[Union[datetime, str]] = None
    publication_date: Optional[Union[datetime, str]] = None  # legacy alias for published_date
    status: Optional[str] = "identified"
    priority: Optional[str] = "medium"
    assigned_to: Optional[int] = None
    regulatory_body: Optional[str] = None
    impact_summary: Optional[str] = None


class RegulatoryChangeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    regulation_reference: Optional[str] = None
    reference_number: Optional[str] = None  # legacy alias for regulation_reference
    effective_date: Optional[Union[datetime, str]] = None
    published_date: Optional[Union[datetime, str]] = None
    publication_date: Optional[Union[datetime, str]] = None  # legacy alias for published_date
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None
    regulatory_body: Optional[str] = None
    impact_summary: Optional[str] = None


class RegulatoryChangeResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    source: str
    regulation_reference: Optional[str]
    reference_number: Optional[str] = None  # legacy alias for regulation_reference
    effective_date: Optional[datetime]
    published_date: Optional[datetime]
    publication_date: Optional[datetime] = None  # legacy alias for published_date
    status: str
    priority: str
    regulatory_body: Optional[str] = None
    impact_summary: Optional[str] = None
    gap_count: int = 0
    assigned_to: Optional[int]
    assignee_name: Optional[str] = None
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closed_by_name: Optional[str] = None
    assessment_count: int = 0
    task_count: int = 0
    completed_task_count: int = 0

    class Config:
        from_attributes = True


class RegulatoryImpactAssessmentCreate(BaseModel):
    assessment_type: Optional[str] = "process"  # policy, control, process, technology
    impacted_item_id: Optional[int] = None
    impacted_item_type: Optional[str] = None  # policy, control, asset, process
    impact_level: Optional[str] = "medium"
    impact_description: Optional[str] = None
    affected_areas: Optional[str] = None  # legacy alias for impact_description
    compliance_gaps: Optional[str] = None  # legacy alias for gap_description
    recommendations: Optional[str] = None  # legacy field
    gap_identified: Optional[bool] = False
    gap_description: Optional[str] = None
    status: Optional[str] = None  # legacy UI field
    assessment_date: Optional[Union[datetime, str]] = None  # legacy alias for assessed_at


class RegulatoryImpactAssessmentResponse(BaseModel):
    id: int
    tenant_id: int
    regulatory_change_id: int
    change_id: int  # legacy alias for regulatory_change_id
    assessment_type: str
    impacted_item_id: Optional[int]
    impacted_item_type: Optional[str]
    impacted_item_name: Optional[str] = None
    impact_level: str
    impact_description: Optional[str]
    affected_areas: Optional[str] = None  # legacy alias for impact_description
    gap_identified: bool
    gap_description: Optional[str]
    compliance_gaps: Optional[str] = None  # legacy alias for gap_description
    recommendations: Optional[str] = None  # legacy field extracted from impact_description
    assessed_by: Optional[int]
    assessor_id: Optional[int] = None  # legacy alias for assessed_by
    assessor_name: Optional[str] = None
    assessed_at: datetime
    assessment_date: datetime  # legacy alias for assessed_at
    status: str = "completed"  # legacy UI field

    class Config:
        from_attributes = True


class RegulatoryImplementationTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: str  # policy_update, control_update, process_change, training, communication
    priority: str = "medium"
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    linked_policy_id: Optional[int] = None
    linked_control_id: Optional[int] = None
    impact_assessment_id: Optional[int] = None


class RegulatoryImplementationTaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    linked_policy_id: Optional[int] = None
    linked_control_id: Optional[int] = None


class RegulatoryImplementationTaskResponse(BaseModel):
    id: int
    tenant_id: int
    regulatory_change_id: int
    impact_assessment_id: Optional[int]
    title: str
    description: Optional[str]
    task_type: str
    status: str
    priority: str
    assigned_to: Optional[int]
    assignee_name: Optional[str] = None
    assignee_department: Optional[str] = None
    due_date: Optional[datetime]
    completed_at: Optional[datetime]
    linked_policy_id: Optional[int]
    linked_policy_title: Optional[str] = None
    linked_control_id: Optional[int]
    linked_control_name: Optional[str] = None
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    is_overdue: bool = False

    class Config:
        from_attributes = True


class RegulatoryChangeDashboardStats(BaseModel):
    total_changes: int
    by_status: Dict[str, int]
    by_priority: Dict[str, int]
    by_source: Dict[str, int]
    total_assessments: int
    assessments_with_gaps: int
    total_tasks: int
    pending_tasks: int
    in_progress_tasks: int
    completed_tasks: int
    blocked_tasks: int
    overdue_tasks: int
    upcoming_effective_dates: List[Dict[str, Any]] = []
    task_completion_rate: float = 0.0


class RegulatoryGapAnalysisRunRequest(BaseModel):
    """Scope a regulatory gap-analysis run.

    - document_ids: governance documents (policies) to analyze against.
      Empty list means "all eligible approved/published policies".
    - include_all_controls: when true (default), also evaluate control gaps.
    - assigned_to: optional user id; when set, an implementation task is
      created for each identified gap and assigned to that user.
    """
    document_ids: List[int] = []
    include_all_controls: bool = True
    assigned_to: Optional[int] = None


class RegulatoryGapAnalysisResponse(BaseModel):
    regulatory_change_id: int
    regulatory_change_title: str
    analysis_summary: str
    impacted_policies: List[Dict[str, Any]] = []
    impacted_controls: List[Dict[str, Any]] = []
    identified_gaps: List[Dict[str, Any]] = []
    recommended_actions: List[str] = []
    risk_level: str
    confidence_score: float
    tasks_created: int = 0


class IncompleteTaskDetail(BaseModel):
    id: int
    title: str
    status: str
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None


class RegulatoryChangeClosureReadinessResponse(BaseModel):
    ready_to_close: bool
    total_tasks: int
    completed_tasks: int
    incomplete_tasks: List[IncompleteTaskDetail] = []


class RegulatoryChangeCloseResponse(BaseModel):
    message: str
    regulatory_change: RegulatoryChangeResponse

