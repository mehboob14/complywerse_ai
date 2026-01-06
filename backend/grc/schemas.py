from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime


class UserBase(BaseModel):
    username: str
    email: EmailStr
    display_name: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    display_name: Optional[str]
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime]

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TenantBase(BaseModel):
    name: str
    slug: str
    settings: Optional[Dict[str, Any]] = {}


class TenantCreate(TenantBase):
    pass


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    is_active: Optional[bool] = None
    settings: Optional[Dict[str, Any]] = None


class TenantResponse(BaseModel):
    id: int
    name: str
    slug: str
    is_active: bool
    created_at: datetime
    settings: Dict[str, Any]

    class Config:
        from_attributes = True


class BusinessUnitBase(BaseModel):
    name: str
    parent_id: Optional[int] = None


class BusinessUnitCreate(BusinessUnitBase):
    pass


class BusinessUnitResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    parent_id: Optional[int]

    class Config:
        from_attributes = True


class TenantUserCreate(BaseModel):
    user_id: int
    is_primary: bool = False


class TenantUserResponse(BaseModel):
    id: int
    user_id: int
    tenant_id: int
    is_primary: bool
    user: Optional[UserResponse] = None

    class Config:
        from_attributes = True


class FrameworkBase(BaseModel):
    name: str
    short_code: str
    regulator: Optional[str] = None
    jurisdiction: Optional[str] = None
    region: Optional[str] = None
    version: Optional[str] = None
    description: Optional[str] = None
    is_mandatory: bool = False
    enforcement_type: Optional[str] = None


class FrameworkCreate(FrameworkBase):
    is_custom: bool = True


class FrameworkUpdate(BaseModel):
    name: Optional[str] = None
    regulator: Optional[str] = None
    jurisdiction: Optional[str] = None
    version: Optional[str] = None
    description: Optional[str] = None
    is_mandatory: Optional[bool] = None
    enforcement_type: Optional[str] = None
    is_active: Optional[bool] = None


class FrameworkResponse(BaseModel):
    id: int
    name: str
    short_code: str
    regulator: Optional[str]
    jurisdiction: Optional[str]
    region: Optional[str] = None
    version: Optional[str]
    description: Optional[str]
    is_mandatory: bool
    enforcement_type: Optional[str]
    is_active: bool
    is_custom: bool
    domain_count: int = 0
    control_count: int = 0

    class Config:
        from_attributes = True


class DomainBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    order: int = 0


class DomainCreate(DomainBase):
    pass


class DomainResponse(BaseModel):
    id: int
    framework_id: int
    code: str
    name: str
    description: Optional[str]
    order: int

    class Config:
        from_attributes = True


class ObjectiveBase(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    order: int = 0


class ObjectiveCreate(ObjectiveBase):
    pass


class ObjectiveResponse(BaseModel):
    id: int
    domain_id: int
    code: str
    name: str
    description: Optional[str]
    order: int

    class Config:
        from_attributes = True


class FrameworkControlBase(BaseModel):
    code: str
    name: str
    statement: Optional[str] = None
    control_objective: Optional[str] = None
    is_mandatory: bool = True
    risk_category: str = "security"
    evidence_type: str = "policy"
    implementation_guidance: Optional[str] = None
    testing_guidance: Optional[str] = None
    order: int = 0


class FrameworkControlCreate(FrameworkControlBase):
    objective_id: int


class FrameworkControlResponse(BaseModel):
    id: int
    objective_id: int
    code: str
    name: str
    statement: Optional[str]
    control_objective: Optional[str] = None
    is_mandatory: bool
    risk_category: Optional[str] = "security"
    evidence_type: Optional[str] = "policy"
    implementation_guidance: Optional[str]
    testing_guidance: Optional[str]
    order: int

    class Config:
        from_attributes = True


class SubControlBase(BaseModel):
    code: str
    name: str
    statement: Optional[str] = None
    order: int = 0


class SubControlCreate(SubControlBase):
    control_id: int


class SubControlResponse(BaseModel):
    id: int
    control_id: int
    code: str
    name: str
    statement: Optional[str]
    description: Optional[str] = None
    evidence_recommendations: List[str] = []
    ai_matching_keywords: List[str] = []
    order: int

    class Config:
        from_attributes = True


class FrameworkImport(BaseModel):
    data: Dict[str, Any]
    format: str = "json"


class NormalizedControlBase(BaseModel):
    code: str
    name: str
    statement: Optional[str] = None
    objective: Optional[str] = None
    control_owner: Optional[str] = None
    implementation_guidance: Optional[str] = None
    testing_guidance: Optional[str] = None
    maturity_level: int = 0


class NormalizedControlCreate(NormalizedControlBase):
    pass


class NormalizedControlUpdate(BaseModel):
    name: Optional[str] = None
    statement: Optional[str] = None
    objective: Optional[str] = None
    control_owner: Optional[str] = None
    implementation_guidance: Optional[str] = None
    testing_guidance: Optional[str] = None
    maturity_level: Optional[int] = None


class NormalizedControlResponse(BaseModel):
    id: int
    code: str
    name: str
    statement: Optional[str]
    objective: Optional[str]
    control_owner: Optional[str]
    implementation_guidance: Optional[str]
    testing_guidance: Optional[str]
    maturity_level: int
    created_at: datetime

    class Config:
        from_attributes = True


class ControlMappingCreate(BaseModel):
    framework_control_id: int
    mapping_type: str = "direct"


class ControlMappingResponse(BaseModel):
    id: int
    normalized_control_id: int
    framework_control_id: int
    mapping_type: str

    class Config:
        from_attributes = True


class RequiredEvidenceBase(BaseModel):
    name: str
    description: Optional[str] = None
    evidence_type: str
    validation_criteria: Optional[str] = None


class RequiredEvidenceCreate(RequiredEvidenceBase):
    pass


class RequiredEvidenceResponse(BaseModel):
    id: int
    normalized_control_id: int
    name: str
    description: Optional[str]
    evidence_type: str
    validation_criteria: Optional[str]

    class Config:
        from_attributes = True


class EvidenceBase(BaseModel):
    name: str
    description: Optional[str] = None


class EvidenceCreate(EvidenceBase):
    pass


class EvidenceUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class EvidenceResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    file_path: Optional[str]
    file_name: Optional[str]
    file_type: Optional[str]
    version: int
    uploaded_by: Optional[int]
    uploaded_at: datetime
    status: str

    class Config:
        from_attributes = True


class EvidenceVersionCreate(BaseModel):
    changes: Optional[str] = None


class EvidenceVersionResponse(BaseModel):
    id: int
    evidence_id: int
    version_number: int
    file_path: Optional[str]
    changes: Optional[str]
    created_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class EvidenceControlMappingCreate(BaseModel):
    normalized_control_id: Optional[int] = None
    framework_control_id: Optional[int] = None


class EvidenceControlMappingResponse(BaseModel):
    id: int
    evidence_id: int
    normalized_control_id: Optional[int]
    framework_control_id: Optional[int]

    class Config:
        from_attributes = True


class AIAssessmentResponse(BaseModel):
    id: int
    evidence_id: int
    relevance_score: Optional[float]
    adequacy_score: Optional[float]
    confidence_score: Optional[float]
    gap_analysis: Dict[str, Any]
    audit_readiness: Optional[float]
    assessed_at: datetime

    class Config:
        from_attributes = True


class EvidenceReview(BaseModel):
    action: str
    notes: Optional[str] = None


class RiskBase(BaseModel):
    title: str
    description: Optional[str] = None
    category: str
    risk_category: Optional[str] = None
    risk_sub_category: Optional[str] = None
    owner_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = []


class RiskCreate(RiskBase):
    pass


class RiskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    risk_category: Optional[str] = None
    risk_sub_category: Optional[str] = None
    owner_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = None
    status: Optional[str] = None
    closure_status: Optional[str] = None
    closure_notes: Optional[str] = None


class RiskResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    category: str
    risk_sub_category: Optional[str] = None
    owner_id: Optional[int]
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = []
    inherent_likelihood: Optional[int]
    inherent_impact: Optional[int]
    inherent_score: Optional[float]
    residual_likelihood: Optional[int]
    residual_impact: Optional[int]
    residual_score: Optional[float]
    risk_appetite: Optional[str]
    status: str
    treatment_plan: Optional[str]
    closure_status: Optional[str] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closure_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RiskAssessment(BaseModel):
    inherent_likelihood: int
    inherent_impact: int
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    risk_appetite: Optional[str] = None


class RiskTreatment(BaseModel):
    treatment_plan: str


class RiskControlLinkCreate(BaseModel):
    normalized_control_id: int


class RiskAssetLinkCreate(BaseModel):
    asset_id: int


class RiskEvidenceLinkCreate(BaseModel):
    evidence_id: int


class RiskDashboard(BaseModel):
    total_risks: int
    by_category: Dict[str, int]
    by_status: Dict[str, int]
    by_score_range: Dict[str, int]
    high_risks: int
    medium_risks: int
    low_risks: int


class RiskHeatmapCell(BaseModel):
    likelihood: int
    impact: int
    count: int
    risks: List[int]


class RiskFrameworkControlLinkCreate(BaseModel):
    framework_control_id: int
    mitigation_effectiveness: str = "partial"
    notes: Optional[str] = None


class RiskGovernanceLinkCreate(BaseModel):
    governance_objective_id: int
    impact_level: str = "medium"


class RiskDetailResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    risk_category: str
    risk_sub_category: Optional[str] = None
    inherent_likelihood: Optional[int]
    inherent_impact: Optional[int]
    inherent_score: Optional[float]
    residual_likelihood: Optional[int]
    residual_impact: Optional[int]
    residual_score: Optional[float]
    risk_appetite: Optional[str]
    status: str
    treatment_plan: Optional[str]
    owner_id: Optional[int]
    owner_name: Optional[str] = None
    business_owner_id: Optional[int] = None
    business_owner_name: Optional[str] = None
    affected_department_ids: Optional[List[int]] = []
    due_date: Optional[datetime] = None
    review_date: Optional[datetime] = None
    closure_status: Optional[str] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closure_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    linked_controls: List[dict] = []
    linked_framework_controls: List[dict] = []
    linked_assets: List[dict] = []
    linked_evidence: List[dict] = []
    linked_governance: List[dict] = []
    mitigation_actions: List[dict] = []
    audit_finding_links: List[dict] = []
    
    class Config:
        from_attributes = True


class RiskHeatmapData(BaseModel):
    likelihood: int
    impact: int
    count: int
    risks: List[dict] = []


class GovernanceObjectiveBase(BaseModel):
    name: str
    description: Optional[str] = None
    owner_id: Optional[int] = None
    target_date: Optional[datetime] = None


class GovernanceObjectiveCreate(GovernanceObjectiveBase):
    pass


class GovernanceObjectiveUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    owner_id: Optional[int] = None
    status: Optional[str] = None
    target_date: Optional[datetime] = None


class GovernanceObjectiveResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    owner_id: Optional[int]
    status: str
    target_date: Optional[datetime]

    class Config:
        from_attributes = True


class ExceptionBase(BaseModel):
    title: str
    justification: Optional[str] = None
    normalized_control_id: Optional[int] = None
    expiry_date: Optional[datetime] = None


class ExceptionCreate(ExceptionBase):
    pass


class ExceptionUpdate(BaseModel):
    title: Optional[str] = None
    justification: Optional[str] = None
    expiry_date: Optional[datetime] = None


class ExceptionResponse(BaseModel):
    id: int
    tenant_id: int
    normalized_control_id: Optional[int]
    title: str
    justification: Optional[str]
    approved_by: Optional[int]
    approval_date: Optional[datetime]
    expiry_date: Optional[datetime]
    status: str

    class Config:
        from_attributes = True


class ExceptionApproval(BaseModel):
    approved: bool


class IssueBase(BaseModel):
    title: str
    description: Optional[str] = None
    severity: str = "medium"
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None


class IssueCreate(IssueBase):
    pass


class IssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None


class IssueResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    severity: str
    status: str
    owner_id: Optional[int]
    due_date: Optional[datetime]
    created_at: datetime
    closed_at: Optional[datetime]

    class Config:
        from_attributes = True


class GovernanceDashboard(BaseModel):
    total_objectives: int
    objectives_by_status: Dict[str, int]
    total_exceptions: int
    exceptions_by_status: Dict[str, int]
    pending_exceptions: int
    total_issues: int
    issues_by_status: Dict[str, int]
    issues_by_severity: Dict[str, int]
    open_issues: int


class DocumentBase(BaseModel):
    title: str
    content: Optional[str] = None
    doc_type: str
    review_cycle_months: int = 12


class DocumentCreate(DocumentBase):
    owner_id: Optional[int] = None


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    review_cycle_months: Optional[int] = None
    change_summary: Optional[str] = None


class DocumentResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    content: Optional[str]
    doc_type: str
    version: str
    status: str
    owner_id: Optional[int]
    created_at: datetime
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    review_cycle_months: int
    next_review_date: Optional[datetime]

    class Config:
        from_attributes = True


class DocumentVersionResponse(BaseModel):
    id: int
    document_id: int
    version_number: str
    content: Optional[str]
    created_at: datetime
    created_by: Optional[int]
    change_summary: Optional[str]

    class Config:
        from_attributes = True


class DocumentApprovalRequest(BaseModel):
    approver_id: int


class DocumentApprovalResponse(BaseModel):
    approved: bool
    comments: Optional[str] = None


class DocumentControlLinkCreate(BaseModel):
    normalized_control_id: int


class ITAssetBase(BaseModel):
    name: str
    description: Optional[str] = None
    asset_type: str
    owner_id: Optional[int] = None
    criticality: str = "medium"
    vendor: Optional[str] = None
    location: Optional[str] = None


class ITAssetCreate(ITAssetBase):
    confidentiality_rating: Optional[int] = None
    integrity_rating: Optional[int] = None
    availability_rating: Optional[int] = None
    valuation: Optional[float] = None


class ITAssetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    asset_type: Optional[str] = None
    owner_id: Optional[int] = None
    criticality: Optional[str] = None
    vendor: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None


class ITAssetResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    asset_type: str
    owner_id: Optional[int]
    criticality: str
    confidentiality_rating: Optional[int]
    integrity_rating: Optional[int]
    availability_rating: Optional[int]
    valuation: Optional[float]
    vendor: Optional[str]
    location: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class AssetValuation(BaseModel):
    valuation: float
    confidentiality_rating: Optional[int] = None
    integrity_rating: Optional[int] = None
    availability_rating: Optional[int] = None


class AssetControlLinkCreate(BaseModel):
    normalized_control_id: int


class AssetFrameworkControlLinkCreate(BaseModel):
    framework_control_id: int
    coverage_status: str = "partial"
    notes: Optional[str] = None


class AssetEvidenceLinkCreate(BaseModel):
    evidence_id: int
    relationship_type: str = "supports"


class AssetDetailResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    asset_type: str
    owner_id: Optional[int]
    owner_name: Optional[str] = None
    criticality: str
    confidentiality_rating: Optional[int]
    integrity_rating: Optional[int]
    availability_rating: Optional[int]
    valuation: Optional[float]
    vendor: Optional[str]
    location: Optional[str]
    status: str
    created_at: datetime
    linked_controls: List[dict] = []
    linked_framework_controls: List[dict] = []
    linked_risks: List[dict] = []
    linked_evidence: List[dict] = []
    risk_assessments: List[dict] = []
    coverage_percentage: Optional[float] = None
    
    class Config:
        from_attributes = True


class AssetCoverageAnalysis(BaseModel):
    asset_id: int
    asset_name: str
    total_controls: int
    covered_controls: int
    coverage_percentage: float
    gaps: List[dict] = []
    risk_score: Optional[float] = None


class AssetRiskAssessmentResponse(BaseModel):
    id: int
    asset_id: int
    assessment_date: datetime
    risk_score: Optional[float]
    coverage_percentage: Optional[float]
    gaps: Dict[str, Any]
    assessor_id: Optional[int]

    class Config:
        from_attributes = True


class AssetDashboard(BaseModel):
    total_assets: int
    by_type: Dict[str, int]
    by_criticality: Dict[str, int]
    by_status: Dict[str, int]
    high_value_assets: int
    assets_needing_assessment: int


class AssetCoverage(BaseModel):
    total_assets: int
    assets_with_controls: int
    coverage_percentage: float
    by_criticality: Dict[str, Dict[str, Any]]


class PaginatedResponse(BaseModel):
    items: List[Any]
    total: int
    page: int
    per_page: int
    pages: int


class MessageResponse(BaseModel):
    message: str
    id: Optional[int] = None


class CertificationJourneyCreate(BaseModel):
    framework_id: int
    name: str
    target_date: Optional[datetime] = None
    notes: Optional[str] = None
    tenant_id: Optional[int] = None


class CertificationJourneyUpdate(BaseModel):
    name: Optional[str] = None
    target_date: Optional[datetime] = None
    status: Optional[str] = None
    current_phase: Optional[int] = None
    notes: Optional[str] = None


class CertificationJourneyResponse(BaseModel):
    id: int
    tenant_id: int
    framework_id: int
    name: str
    target_date: Optional[datetime]
    started_at: datetime
    completed_at: Optional[datetime]
    status: str
    current_phase: int
    notes: Optional[str]

    class Config:
        from_attributes = True


class ControlImplementationUpdate(BaseModel):
    status: Optional[str] = None
    implementation_notes: Optional[str] = None
    is_applicable: Optional[bool] = None
    priority: Optional[int] = None


class ControlImplementationResponse(BaseModel):
    id: int
    journey_id: int
    framework_control_id: int
    status: str
    implementation_notes: Optional[str]
    implementation_date: Optional[datetime]
    verified_date: Optional[datetime]
    verified_by: Optional[int]
    is_applicable: bool
    priority: int

    class Config:
        from_attributes = True


class ImplementationEvidenceCreate(BaseModel):
    evidence_id: Optional[int] = None


class ImplementationEvidenceResponse(BaseModel):
    id: int
    implementation_id: int
    evidence_id: Optional[int]
    file_name: Optional[str]
    file_path: Optional[str]
    file_size: Optional[int]
    mime_type: Optional[str]
    uploaded_at: datetime
    uploaded_by: int
    ai_confidence_score: Optional[float]
    ai_assessment_status: Optional[str]
    ai_assessment_notes: Optional[str]
    ai_matched_controls: List[int]
    review_status: str
    reviewed_by: Optional[int]
    reviewed_at: Optional[datetime]
    review_notes: Optional[str]

    class Config:
        from_attributes = True


class ProgressSummary(BaseModel):
    total_controls: int
    implemented_count: int
    verified_count: int
    in_progress_count: int
    not_started_count: int
    not_applicable_count: int
    completion_percentage: float
    by_status: Dict[str, int]
    by_domain: List[Dict[str, Any]]


class GapAnalysis(BaseModel):
    total_gaps: int
    controls_without_evidence: List[Dict[str, Any]]
    controls_not_implemented: List[Dict[str, Any]]
    controls_pending_verification: List[Dict[str, Any]]
    evidence_pending_review: List[Dict[str, Any]]
    high_priority_gaps: List[Dict[str, Any]]


class EvidenceReviewAction(BaseModel):
    action: str
    notes: Optional[str] = None


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


class RiskKRICreate(RiskKRIBase):
    risk_id: int


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


class RiskKRIResponse(BaseModel):
    id: int
    risk_id: int
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

    class Config:
        from_attributes = True


class RiskKRIMeasurementCreate(BaseModel):
    value: float
    notes: Optional[str] = None


class RiskKRIMeasurementResponse(BaseModel):
    id: int
    kri_id: int
    value: float
    status: str
    measured_at: datetime
    measured_by: Optional[int]
    notes: Optional[str]

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


# =============================================================================
# Risk Mitigation Action Schemas
# =============================================================================

class RiskMitigationActionBase(BaseModel):
    title: str
    description: Optional[str] = None
    action_type: str = "mitigate"
    priority: str = "medium"
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    expected_residual_reduction: Optional[float] = None
    notes: Optional[str] = None


class RiskMitigationActionCreate(RiskMitigationActionBase):
    risk_id: int


class RiskMitigationActionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    action_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    expected_residual_reduction: Optional[float] = None
    actual_residual_reduction: Optional[float] = None
    evidence_id: Optional[int] = None
    notes: Optional[str] = None


class RiskMitigationActionResponse(BaseModel):
    id: int
    risk_id: int
    title: str
    description: Optional[str]
    action_type: str
    status: str
    priority: str
    owner_id: Optional[int]
    due_date: Optional[datetime]
    completed_at: Optional[datetime]
    expected_residual_reduction: Optional[float]
    actual_residual_reduction: Optional[float]
    evidence_id: Optional[int]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime
    owner_name: Optional[str] = None

    class Config:
        from_attributes = True


# =============================================================================
# Risk Audit Finding Link Schemas
# =============================================================================

class RiskAuditFindingLinkCreate(BaseModel):
    risk_id: int
    issue_id: int
    notes: Optional[str] = None


class RiskAuditFindingLinkResponse(BaseModel):
    id: int
    risk_id: int
    issue_id: int
    notes: Optional[str]
    created_at: datetime
    issue_title: Optional[str] = None
    issue_severity: Optional[str] = None

    class Config:
        from_attributes = True


# =============================================================================
# Likelihood Impact Scale Schemas
# =============================================================================

class LikelihoodImpactScaleBase(BaseModel):
    scale_type: str
    level: int
    label: str
    description: Optional[str] = None
    score_value: float
    color: Optional[str] = None
    is_default: bool = False


class LikelihoodImpactScaleCreate(LikelihoodImpactScaleBase):
    pass


class LikelihoodImpactScaleUpdate(BaseModel):
    label: Optional[str] = None
    description: Optional[str] = None
    score_value: Optional[float] = None
    color: Optional[str] = None
    is_default: Optional[bool] = None


class LikelihoodImpactScaleResponse(BaseModel):
    id: int
    tenant_id: int
    scale_type: str
    level: int
    label: str
    description: Optional[str]
    score_value: float
    color: Optional[str]
    is_default: bool
    created_at: datetime

    class Config:
        from_attributes = True


# =============================================================================
# Internal Control Schemas
# =============================================================================

class InternalControlBase(BaseModel):
    control_id: str
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


# =============================================================================
# Vulnerability Management Schemas
# =============================================================================

class VulnerabilityReportCreate(BaseModel):
    name: str
    description: Optional[str] = None
    report_type: str = "vulnerability_scan"
    scan_tool: Optional[str] = None
    scan_date: Optional[datetime] = None
    scan_scope: Optional[str] = None
    asset_scope_ids: Optional[List[int]] = []


class VulnerabilityReportUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    report_type: Optional[str] = None
    scan_tool: Optional[str] = None
    scan_date: Optional[datetime] = None
    scan_scope: Optional[str] = None
    status: Optional[str] = None


class VulnerabilityReportResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    report_type: str
    file_path: Optional[str]
    file_name: Optional[str]
    file_type: Optional[str]
    scan_tool: Optional[str]
    scan_date: Optional[datetime]
    scan_scope: Optional[str]
    asset_scope_ids: List[int] = []
    total_vulnerabilities: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    info_count: int
    status: str
    uploaded_by: Optional[int]
    uploaded_at: datetime
    created_at: datetime
    updated_at: datetime
    uploader_name: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityCreate(BaseModel):
    vuln_id: Optional[str] = None
    title: str
    description: Optional[str] = None
    severity: str = "medium"
    cvss_score: Optional[float] = None
    cvss_vector: Optional[str] = None
    cve_id: Optional[str] = None
    cwe_id: Optional[str] = None
    affected_component: Optional[str] = None
    affected_host: Optional[str] = None
    affected_port: Optional[int] = None
    affected_url: Optional[str] = None
    evidence: Optional[str] = None
    reproduction_steps: Optional[str] = None
    recommendation: Optional[str] = None
    report_id: Optional[int] = None
    discovered_at: Optional[datetime] = None
    due_date: Optional[datetime] = None


class VulnerabilityUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    cvss_score: Optional[float] = None
    cvss_vector: Optional[str] = None
    cve_id: Optional[str] = None
    cwe_id: Optional[str] = None
    affected_component: Optional[str] = None
    affected_host: Optional[str] = None
    affected_port: Optional[int] = None
    affected_url: Optional[str] = None
    evidence: Optional[str] = None
    reproduction_steps: Optional[str] = None
    recommendation: Optional[str] = None
    status: Optional[str] = None
    resolution_notes: Optional[str] = None
    due_date: Optional[datetime] = None


class VulnerabilityResponse(BaseModel):
    id: int
    tenant_id: int
    report_id: Optional[int]
    vuln_id: str
    title: str
    description: Optional[str]
    severity: str
    cvss_score: Optional[float]
    cvss_vector: Optional[str]
    cve_id: Optional[str]
    cwe_id: Optional[str]
    affected_component: Optional[str]
    affected_host: Optional[str]
    affected_port: Optional[int]
    affected_url: Optional[str]
    evidence: Optional[str]
    reproduction_steps: Optional[str]
    recommendation: Optional[str]
    ai_recommendation: Optional[str]
    ai_impact_assessment: Optional[str]
    status: str
    resolution_notes: Optional[str]
    discovered_at: datetime
    due_date: Optional[datetime]
    resolved_at: Optional[datetime]
    assigned_to: Optional[int]
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    is_exception: bool
    exception_reason: Optional[str]
    exception_approved_by: Optional[int]
    exception_expiry: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    assignee_name: Optional[str] = None
    verifier_name: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityAssign(BaseModel):
    user_id: int


class VulnerabilityStatusChange(BaseModel):
    status: str
    resolution_notes: Optional[str] = None


class VulnerabilityMitigationCreate(BaseModel):
    action_title: str
    action_description: Optional[str] = None
    action_type: str = "remediate"
    owner_id: Optional[int] = None
    priority: str = "medium"
    target_date: Optional[datetime] = None
    effort_estimate: Optional[str] = None
    notes: Optional[str] = None


class VulnerabilityMitigationUpdate(BaseModel):
    action_title: Optional[str] = None
    action_description: Optional[str] = None
    action_type: Optional[str] = None
    owner_id: Optional[int] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    target_date: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    effort_estimate: Optional[str] = None
    actual_effort: Optional[str] = None
    notes: Optional[str] = None


class VulnerabilityMitigationResponse(BaseModel):
    id: int
    vulnerability_id: int
    tenant_id: int
    action_title: str
    action_description: Optional[str]
    action_type: str
    owner_id: Optional[int]
    priority: str
    status: str
    target_date: Optional[datetime]
    completed_at: Optional[datetime]
    effort_estimate: Optional[str]
    actual_effort: Optional[str]
    notes: Optional[str]
    erm_mitigation_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int]
    owner_name: Optional[str] = None
    creator_name: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityAssetLinkCreate(BaseModel):
    asset_id: int
    impact_on_asset: Optional[str] = None
    notes: Optional[str] = None


class VulnerabilityAssetLinkResponse(BaseModel):
    id: int
    vulnerability_id: int
    asset_id: int
    impact_on_asset: Optional[str]
    notes: Optional[str]
    created_at: datetime
    created_by: Optional[int]
    asset_name: Optional[str] = None
    asset_type: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityControlLinkCreate(BaseModel):
    framework_control_id: Optional[int] = None
    normalized_control_id: Optional[int] = None
    internal_control_id: Optional[int] = None
    compliance_impact: Optional[str] = None
    notes: Optional[str] = None


class VulnerabilityControlLinkResponse(BaseModel):
    id: int
    vulnerability_id: int
    framework_control_id: Optional[int]
    normalized_control_id: Optional[int]
    internal_control_id: Optional[int]
    compliance_impact: Optional[str]
    notes: Optional[str]
    created_at: datetime
    created_by: Optional[int]
    framework_control_code: Optional[str] = None
    framework_control_name: Optional[str] = None
    normalized_control_code: Optional[str] = None
    normalized_control_name: Optional[str] = None
    internal_control_name: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityRetestCreate(BaseModel):
    result: str
    findings: Optional[str] = None
    evidence: Optional[str] = None
    retest_date: Optional[datetime] = None


class VulnerabilityRetestResponse(BaseModel):
    id: int
    vulnerability_id: int
    tenant_id: int
    retest_date: datetime
    tester_id: Optional[int]
    result: str
    findings: Optional[str]
    evidence: Optional[str]
    created_at: datetime
    tester_name: Optional[str] = None

    class Config:
        from_attributes = True


class VulnerabilityAIJobResponse(BaseModel):
    id: int
    report_id: Optional[int]
    vulnerability_id: Optional[int]
    tenant_id: int
    job_type: str
    status: str
    input_data: Dict[str, Any] = {}
    output_data: Dict[str, Any] = {}
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    created_by: Optional[int]

    class Config:
        from_attributes = True


class VulnerabilitySLAConfigCreate(BaseModel):
    severity: str
    remediation_days: int


class VulnerabilitySLAConfigUpdate(BaseModel):
    remediation_days: int


class VulnerabilitySLAConfigResponse(BaseModel):
    id: int
    tenant_id: int
    severity: str
    remediation_days: int
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class VulnerabilityExceptionCreate(BaseModel):
    exception_reason: str
    exception_expiry: Optional[datetime] = None


class VulnerabilityExceptionUpdate(BaseModel):
    exception_reason: Optional[str] = None
    exception_expiry: Optional[datetime] = None
    is_exception: Optional[bool] = None


class VulnerabilityExceptionResponse(BaseModel):
    id: int
    vuln_id: str
    title: str
    severity: str
    is_exception: bool
    exception_reason: Optional[str]
    exception_approved_by: Optional[int]
    exception_expiry: Optional[datetime]
    exception_approver_name: Optional[str] = None
    days_until_expiry: Optional[int] = None

    class Config:
        from_attributes = True


class VulnerabilityDashboard(BaseModel):
    total_vulnerabilities: int
    by_severity: Dict[str, int]
    by_status: Dict[str, int]
    sla_compliance: Dict[str, Any]
    overdue_count: int
    mttr_days: Optional[float]
    aging_buckets: Dict[str, int]
    top_affected_assets: List[Dict[str, Any]] = []
    recent_activities: List[Dict[str, Any]] = []


class OverdueVulnerabilityResponse(BaseModel):
    id: int
    vuln_id: str
    title: str
    severity: str
    status: str
    due_date: datetime
    days_overdue: int
    assigned_to: Optional[int]
    assignee_name: Optional[str] = None

    class Config:
        from_attributes = True


class AssetExposureResponse(BaseModel):
    asset_id: int
    asset_name: str
    asset_type: Optional[str]
    vulnerability_count: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int

    class Config:
        from_attributes = True
