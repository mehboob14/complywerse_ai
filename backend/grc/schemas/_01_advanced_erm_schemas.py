from ._00_base import *  # noqa: F401,F403
from pydantic import field_validator

# =============================================================================
# Advanced ERM Schemas
# =============================================================================

class RiskKRIBase(BaseModel):
    name: str
    description: Optional[str] = None
    metric_type: str = "numeric"
    unit: Optional[str] = None
    green_threshold: Optional[float] = None
    amber_threshold: Optional[float] = None
    threshold_direction: str = "lower_is_better"
    frequency: str = "monthly"
    data_source: Optional[str] = None
    owner_id: Optional[int] = None
    metric_key: Optional[str] = None  # bind to a metric_catalog key → live-fed value
    # Full lifecycle
    kind: str = "kri"                 # 'kri' | 'kpi'
    category: Optional[str] = None
    formula: Optional[str] = None
    target: Optional[float] = None
    reporting_period: Optional[str] = None
    next_due_date: Optional[datetime] = None
    data_provider_id: Optional[int] = None
    reviewer_id: Optional[int] = None
    linked_control_ids: Optional[List[int]] = None
    linked_objective_ids: Optional[List[int]] = None
    linked_framework_id: Optional[int] = None

    @field_validator("kind", mode="before")
    @classmethod
    def _default_kind(cls, v):
        return v if v else "kri"


class RiskKRICreate(RiskKRIBase):
    risk_id: Optional[int] = None


class RiskKRIUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    metric_type: Optional[str] = None
    unit: Optional[str] = None
    current_value: Optional[float] = None
    green_threshold: Optional[float] = None
    amber_threshold: Optional[float] = None
    threshold_direction: Optional[str] = None
    frequency: Optional[str] = None
    data_source: Optional[str] = None
    owner_id: Optional[int] = None
    is_active: Optional[bool] = None
    metric_key: Optional[str] = None
    kind: Optional[str] = None
    category: Optional[str] = None
    formula: Optional[str] = None
    target: Optional[float] = None
    reporting_period: Optional[str] = None
    next_due_date: Optional[datetime] = None
    data_provider_id: Optional[int] = None
    reviewer_id: Optional[int] = None
    linked_control_ids: Optional[List[int]] = None
    linked_objective_ids: Optional[List[int]] = None
    linked_framework_id: Optional[int] = None


class RiskKRIResponse(BaseModel):
    id: int
    risk_id: Optional[int] = None
    name: str
    description: Optional[str]
    metric_type: str
    unit: Optional[str]
    current_value: Optional[float]
    green_threshold: Optional[float]
    amber_threshold: Optional[float]
    threshold_direction: str
    frequency: str
    data_source: Optional[str]
    owner_id: Optional[int]
    is_active: bool
    last_measured_at: Optional[datetime]
    created_at: datetime
    current_status: Optional[str] = None
    metric_key: Optional[str] = None
    is_live: bool = False           # True when value is fed from a platform metric
    module: Optional[str] = None    # source module of the bound metric
    module_label: Optional[str] = None
    kind: str = "kri"
    category: Optional[str] = None
    formula: Optional[str] = None
    target: Optional[float] = None
    reporting_period: Optional[str] = None
    next_due_date: Optional[datetime] = None
    data_provider_id: Optional[int] = None
    reviewer_id: Optional[int] = None
    linked_control_ids: Optional[List[int]] = None
    linked_objective_ids: Optional[List[int]] = None
    linked_framework_id: Optional[int] = None

    @field_validator("kind", mode="before")
    @classmethod
    def _default_kind(cls, v):
        # ORM rows may still have NULL kind before backfill; never fail hydration.
        return v if v else "kri"

    class Config:
        from_attributes = True


class RiskKRIMeasurementCreate(BaseModel):
    value: float
    notes: Optional[str] = None
    period_label: Optional[str] = None
    target: Optional[float] = None
    review_status: Optional[str] = None  # draft | submitted | approved


class RiskKRIMeasurementResponse(BaseModel):
    id: int
    kri_id: int
    value: float
    status: str
    measured_at: datetime
    measured_by: Optional[int]
    notes: Optional[str]
    period_label: Optional[str] = None
    target: Optional[float] = None
    review_status: Optional[str] = None
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RiskIncidentBase(BaseModel):
    title: str
    description: Optional[str] = None
    incident_date: datetime
    severity: str = "medium"
    financial_impact: Optional[float] = None
    operational_impact: Optional[str] = None
    root_cause: Optional[str] = None
    corrective_actions: Optional[str] = None


class RiskIncidentCreate(RiskIncidentBase):
    risk_id: Optional[int] = None
    assigned_to: Optional[int] = None
    tags: Optional[List[str]] = None
    linked_asset_ids: Optional[List[int]] = None
    linked_vulnerability_ids: Optional[List[int]] = None
    linked_risk_ids: Optional[List[int]] = None
    linked_evidence_ids: Optional[List[int]] = None


class RiskIncidentUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    incident_date: Optional[datetime] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    financial_impact: Optional[float] = None
    operational_impact: Optional[str] = None
    root_cause: Optional[str] = None
    corrective_actions: Optional[str] = None
    lessons_learned: Optional[str] = None
    assigned_to: Optional[int] = None
    risk_id: Optional[int] = None
    tags: Optional[List[str]] = None
    linked_asset_ids: Optional[List[int]] = None
    linked_vulnerability_ids: Optional[List[int]] = None
    linked_risk_ids: Optional[List[int]] = None
    linked_evidence_ids: Optional[List[int]] = None


class RiskIncidentResponse(BaseModel):
    id: int
    tenant_id: int
    risk_id: Optional[int]
    title: str
    description: Optional[str]
    incident_date: datetime
    discovered_date: datetime
    severity: str
    status: str
    financial_impact: Optional[float]
    operational_impact: Optional[str]
    root_cause: Optional[str]
    corrective_actions: Optional[str]
    lessons_learned: Optional[str]
    reported_by: Optional[int]
    assigned_to: Optional[int]
    resolved_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    risk_title: Optional[str] = None
    tags: Optional[List[str]] = None
    assignee_name: Optional[str] = None
    link_counts: Optional[Dict[str, int]] = None

    class Config:
        from_attributes = True


class RiskReviewCreate(BaseModel):
    risk_id: int
    review_cycle: str = "quarterly"
    review_type: str = "periodic"
    due_date: datetime
    reviewer_id: Optional[int] = None


class RiskReviewUpdate(BaseModel):
    status: Optional[str] = None
    reviewer_id: Optional[int] = None
    approver_id: Optional[int] = None
    new_inherent_score: Optional[float] = None
    new_residual_score: Optional[float] = None
    findings: Optional[str] = None
    recommendations: Optional[str] = None
    approval_notes: Optional[str] = None


class RiskReviewResponse(BaseModel):
    id: int
    risk_id: int
    review_cycle: str
    review_type: str
    status: str
    due_date: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    reviewer_id: Optional[int]
    approver_id: Optional[int]
    previous_inherent_score: Optional[float]
    previous_residual_score: Optional[float]
    new_inherent_score: Optional[float]
    new_residual_score: Optional[float]
    findings: Optional[str]
    recommendations: Optional[str]
    approval_notes: Optional[str]
    created_at: datetime
    risk_title: Optional[str] = None

    class Config:
        from_attributes = True


class RiskScoreHistoryResponse(BaseModel):
    id: int
    risk_id: int
    inherent_likelihood: Optional[int]
    inherent_impact: Optional[int]
    inherent_score: Optional[float]
    residual_likelihood: Optional[int]
    residual_impact: Optional[int]
    residual_score: Optional[float]
    status: Optional[str]
    change_reason: Optional[str]
    changed_by: Optional[int]
    recorded_at: datetime

    class Config:
        from_attributes = True


class RiskDependencyCreate(BaseModel):
    source_risk_id: Optional[int] = None  # Optional, can be provided in body or as query param
    target_risk_id: int
    dependency_type: str = "causes"
    impact_factor: float = 1.0
    description: Optional[str] = None


class RiskDependencyResponse(BaseModel):
    id: int
    source_risk_id: int
    target_risk_id: int
    dependency_type: str
    impact_factor: float
    description: Optional[str]
    created_at: datetime
    source_risk_title: Optional[str] = None
    target_risk_title: Optional[str] = None

    class Config:
        from_attributes = True


class RiskAppetiteConfigCreate(BaseModel):
    category: str
    appetite_level: str = "moderate"
    max_acceptable_score: float = 12.0
    tolerance_threshold: Optional[float] = None
    escalation_owner_id: Optional[int] = None
    alert_enabled: bool = True
    description: Optional[str] = None


class RiskAppetiteConfigUpdate(BaseModel):
    appetite_level: Optional[str] = None
    max_acceptable_score: Optional[float] = None
    tolerance_threshold: Optional[float] = None
    escalation_owner_id: Optional[int] = None
    alert_enabled: Optional[bool] = None
    description: Optional[str] = None


class RiskAppetiteConfigResponse(BaseModel):
    id: int
    tenant_id: int
    category: str
    appetite_level: str
    max_acceptable_score: float
    tolerance_threshold: Optional[float] = None
    escalation_owner_id: Optional[int] = None
    alert_enabled: bool = True
    description: Optional[str]
    updated_at: datetime

    class Config:
        from_attributes = True


class RiskReportCreate(BaseModel):
    report_type: str
    title: str
    description: Optional[str] = None
    report_period_start: Optional[datetime] = None
    report_period_end: Optional[datetime] = None


class RiskReportResponse(BaseModel):
    id: int
    tenant_id: int
    report_type: str
    title: str
    description: Optional[str]
    report_period_start: Optional[datetime]
    report_period_end: Optional[datetime]
    generated_at: datetime
    generated_by: Optional[int]
    report_data: Dict[str, Any]
    file_path: Optional[str]
    status: str

    class Config:
        from_attributes = True


class RiskTrendData(BaseModel):
    date: datetime
    inherent_score: Optional[float]
    residual_score: Optional[float]
    status: Optional[str]


class RiskTrendsResponse(BaseModel):
    risk_id: int
    risk_title: str
    trend_data: List[RiskTrendData]
    score_change: float
    trend_direction: str


class AggregatedRiskView(BaseModel):
    group_by: str
    group_value: str
    total_risks: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    avg_inherent_score: float
    avg_residual_score: float
    open_count: int
    in_treatment_count: int
    mitigated_count: int


class ExecutiveDashboard(BaseModel):
    total_risks: int
    risks_by_category: Dict[str, int]
    risks_by_status: Dict[str, int]
    risks_by_score_band: Dict[str, int]
    appetite_breaches: List[Dict[str, Any]]
    top_risks: List[Dict[str, Any]]
    recent_incidents: List[Dict[str, Any]]
    kri_alerts: List[Dict[str, Any]]
    pending_reviews: int
    overdue_reviews: int
    trend_summary: Dict[str, Any]


class BoardReportData(BaseModel):
    report_period: str
    executive_summary: str
    risk_overview: Dict[str, Any]
    appetite_status: List[Dict[str, Any]]
    top_risks: List[Dict[str, Any]]
    key_changes: List[Dict[str, Any]]
    incidents_summary: Dict[str, Any]
    recommendations: List[str]


class DepartmentRiskSummary(BaseModel):
    business_unit_id: int
    business_unit_name: str
    total_risks: int
    by_category: Dict[str, int]
    by_status: Dict[str, int]
    critical_risks: List[Dict[str, Any]]
    avg_inherent_score: float
    avg_residual_score: float
    appetite_breaches: int


class ControlEffectivenessUpdate(BaseModel):
    effectiveness_rating: str
    notes: Optional[str] = None

