from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any
from datetime import datetime


class UserBase(BaseModel):
    username: str
    email: EmailStr
    display_name: Optional[str] = None
    department: Optional[str] = None
    group: Optional[str] = None
    division: Optional[str] = None
    designation: Optional[str] = None


class UserCreate(UserBase):
    password: str


class OrganizationRegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str
    organization_name: str
    legal_entity: Optional[str] = None
    industry: Optional[str] = None
    regulatory_scope: Optional[str] = None
    company_size: Optional[str] = None
    geography: Optional[str] = None
    primary_contact_phone: Optional[str] = None


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    display_name: Optional[str]
    department: Optional[str]
    group: Optional[str]
    division: Optional[str]
    designation: Optional[str]
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
    maturity_level: Optional[int]
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
    parsed_control_id: Optional[int] = None
    uploaded_framework_id: Optional[int] = None


class EvidenceControlMappingResponse(BaseModel):
    id: int
    evidence_id: int
    normalized_control_id: Optional[int]
    framework_control_id: Optional[int]
    parsed_control_id: Optional[int]
    uploaded_framework_id: Optional[int]

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
    category: Optional[str] = None
    risk_category: Optional[str] = None
    risk_sub_category: Optional[str] = None
    register_type: Optional[str] = None  # PCI-DSS, ISO 27001, SOX, Internal, etc.
    owner_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = []


class RiskCreate(RiskBase):
    inherent_likelihood: Optional[int] = None
    inherent_impact: Optional[int] = None
    inherent_score: Optional[float] = None
    residual_likelihood: Optional[int] = None
    residual_impact: Optional[int] = None
    residual_score: Optional[float] = None
    risk_appetite: Optional[str] = None
    status: Optional[str] = "open"
    treatment_plan: Optional[str] = None
    closure_status: Optional[str] = None


class RiskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    risk_category: Optional[str] = None
    risk_sub_category: Optional[str] = None
    register_type: Optional[str] = None
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
    register_type: Optional[str] = None
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
    owner_name: Optional[str] = None
    custodian: Optional[str] = None
    host_name: Optional[str] = None
    ip_address: Optional[str] = None
    criticality: str = "medium"
    vendor: Optional[str] = None
    location: Optional[str] = None
    cde_environment: bool = False


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
    owner_name: Optional[str] = None
    custodian: Optional[str] = None
    host_name: Optional[str] = None
    ip_address: Optional[str] = None
    criticality: Optional[str] = None
    confidentiality_rating: Optional[int] = None
    integrity_rating: Optional[int] = None
    availability_rating: Optional[int] = None
    valuation: Optional[float] = None
    vendor: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    cde_environment: Optional[bool] = None


class ITAssetResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    asset_type: str
    owner_id: Optional[int]
    owner_name: Optional[str] = None
    custodian: Optional[str] = None
    host_name: Optional[str] = None
    ip_address: Optional[str] = None
    criticality: str
    confidentiality_rating: Optional[int]
    integrity_rating: Optional[int]
    availability_rating: Optional[int]
    valuation: Optional[float]
    vendor: Optional[str]
    location: Optional[str]
    status: str
    cde_environment: bool = False
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
    custodian: Optional[str] = None
    host_name: Optional[str] = None
    ip_address: Optional[str] = None
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
    linked_internal_controls: List[dict] = []
    linked_framework_controls: List[dict] = []
    linked_risks: List[dict] = []
    linked_evidence: List[dict] = []
    linked_vulnerabilities: List[dict] = []
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


class ProgressSummary(BaseModel):
    total_controls: int
    implemented_count: int
    verified_count: int
    in_progress_count: int
    not_started_count: int
    not_applicable_count: int
    completion_percentage: float
    with_evidence_count: int
    fully_evidenced_count: int
    approved_evidence_controls: int
    evidence_coverage_percentage: float
    readiness_percentage: float
    by_status: Dict[str, int]
    by_domain: List[Dict[str, Any]]


class CertificationJourneyResponse(BaseModel):
    id: int
    tenant_id: int
    framework_id: Optional[int] = None
    uploaded_framework_id: Optional[int] = None
    name: str
    target_date: Optional[datetime]
    started_at: datetime
    completed_at: Optional[datetime]
    status: str
    current_phase: int
    notes: Optional[str]
    progress: Optional[ProgressSummary] = None

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
    linked_assets: List[str] = []

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
    by_assignee: Dict[str, int] = {}
    mitigation_coverage: Dict[str, int] = {}
    by_department: Dict[str, int] = {}


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


# =============================================================================
# Department Management Schemas
# =============================================================================

class GRCDepartmentCreate(BaseModel):
    name: str
    code: str
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None


class GRCDepartmentUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    description: Optional[str] = None
    parent_department_id: Optional[int] = None
    department_head_user_id: Optional[int] = None
    is_active: Optional[bool] = None


class GRCDepartmentMemberResponse(BaseModel):
    id: int
    department_id: int
    user_id: int
    role: str
    email_notifications_enabled: bool
    escalation_order: int
    added_at: datetime
    added_by: Optional[int]
    is_active: bool
    user_name: Optional[str] = None
    user_email: Optional[str] = None

    class Config:
        from_attributes = True


class GRCDepartmentResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    code: str
    description: Optional[str]
    parent_department_id: Optional[int]
    parent_department_name: Optional[str] = None
    department_head_user_id: Optional[int]
    department_head_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    member_count: int = 0

    class Config:
        from_attributes = True


class GRCDepartmentDetailResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    code: str
    description: Optional[str]
    parent_department_id: Optional[int]
    parent_department_name: Optional[str] = None
    department_head_user_id: Optional[int]
    department_head_name: Optional[str] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime
    members: List[GRCDepartmentMemberResponse] = []
    sub_departments: List["GRCDepartmentResponse"] = []
    vulnerability_count: int = 0

    class Config:
        from_attributes = True


class GRCDepartmentMemberCreate(BaseModel):
    user_id: int
    role: str = "member"
    email_notifications_enabled: bool = True
    escalation_order: int = 0


class GRCVulnerabilityDepartmentAssignmentCreate(BaseModel):
    department_id: int
    priority: str = "medium"
    notes: Optional[str] = None
    sla_override_days: Optional[int] = None


class GRCVulnerabilityDepartmentAssignmentResponse(BaseModel):
    id: int
    vulnerability_id: int
    department_id: int
    department_name: Optional[str] = None
    department_code: Optional[str] = None
    assigned_by: Optional[int]
    assigner_name: Optional[str] = None
    assigned_at: datetime
    priority: str
    notes: Optional[str]
    sla_override_days: Optional[int]
    notification_sent: bool

    class Config:
        from_attributes = True


class GRCDepartmentEscalationPathCreate(BaseModel):
    escalation_level: int
    target_role: str
    sla_threshold_percent: int = 75
    auto_escalate: bool = True


class GRCDepartmentEscalationPathResponse(BaseModel):
    id: int
    department_id: int
    escalation_level: int
    target_role: str
    sla_threshold_percent: int
    auto_escalate: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BulkVulnerabilityAssignRequest(BaseModel):
    vulnerability_ids: List[int]
    department_id: int
    priority: str = "medium"
    notes: Optional[str] = None


class BulkVulnerabilityAssignResponse(BaseModel):
    success_count: int
    failed_count: int
    assignments: List[GRCVulnerabilityDepartmentAssignmentResponse] = []
    errors: List[Dict[str, Any]] = []


# =============================================================================
# Vulnerability Workflow Template Schemas
# =============================================================================

class GRCVulnWorkflowTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    is_default: bool = False
    is_active: bool = True


class GRCVulnWorkflowTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class GRCVulnWorkflowStateCreate(BaseModel):
    name: str
    state_type: str = "in_progress"
    order_index: int = 0
    color: Optional[str] = None
    requires_approval: bool = False
    requires_evidence: bool = False
    auto_assign_department_id: Optional[int] = None
    sla_multiplier: float = 1.0
    is_terminal: bool = False


class GRCVulnWorkflowStateUpdate(BaseModel):
    name: Optional[str] = None
    state_type: Optional[str] = None
    order_index: Optional[int] = None
    color: Optional[str] = None
    requires_approval: Optional[bool] = None
    requires_evidence: Optional[bool] = None
    auto_assign_department_id: Optional[int] = None
    sla_multiplier: Optional[float] = None
    is_terminal: Optional[bool] = None


class GRCVulnWorkflowStateResponse(BaseModel):
    id: int
    template_id: int
    name: str
    state_type: str
    order_index: int
    color: Optional[str]
    requires_approval: bool
    requires_evidence: bool
    auto_assign_department_id: Optional[int]
    auto_assign_department_name: Optional[str] = None
    sla_multiplier: float
    is_terminal: bool

    class Config:
        from_attributes = True


class GRCVulnWorkflowTransitionCreate(BaseModel):
    from_state_id: int
    to_state_id: int
    name: str
    requires_comment: bool = False
    requires_approval: bool = False
    approver_role: Optional[str] = None
    allowed_roles: List[str] = []
    trigger_notification: bool = True


class GRCVulnWorkflowTransitionUpdate(BaseModel):
    from_state_id: Optional[int] = None
    to_state_id: Optional[int] = None
    name: Optional[str] = None
    requires_comment: Optional[bool] = None
    requires_approval: Optional[bool] = None
    approver_role: Optional[str] = None
    allowed_roles: Optional[List[str]] = None
    trigger_notification: Optional[bool] = None


class GRCVulnWorkflowTransitionResponse(BaseModel):
    id: int
    template_id: int
    from_state_id: int
    to_state_id: int
    name: str
    requires_comment: bool
    requires_approval: bool
    approver_role: Optional[str]
    allowed_roles: List[str] = []
    trigger_notification: bool
    from_state_name: Optional[str] = None
    to_state_name: Optional[str] = None

    class Config:
        from_attributes = True


class GRCVulnWorkflowEscalationCreate(BaseModel):
    name: str
    trigger_type: str
    trigger_value: float
    escalate_to_department_id: Optional[int] = None
    escalate_to_role: Optional[str] = None
    auto_transition_to_state_id: Optional[int] = None
    notification_type: str = "both"
    is_active: bool = True


class GRCVulnWorkflowEscalationUpdate(BaseModel):
    name: Optional[str] = None
    trigger_type: Optional[str] = None
    trigger_value: Optional[float] = None
    escalate_to_department_id: Optional[int] = None
    escalate_to_role: Optional[str] = None
    auto_transition_to_state_id: Optional[int] = None
    notification_type: Optional[str] = None
    is_active: Optional[bool] = None


class GRCVulnWorkflowEscalationResponse(BaseModel):
    id: int
    template_id: int
    name: str
    trigger_type: str
    trigger_value: float
    escalate_to_department_id: Optional[int]
    escalate_to_department_name: Optional[str] = None
    escalate_to_role: Optional[str]
    auto_transition_to_state_id: Optional[int]
    auto_transition_to_state_name: Optional[str] = None
    notification_type: str
    is_active: bool

    class Config:
        from_attributes = True


class GRCVulnWorkflowHistoryResponse(BaseModel):
    id: int
    vulnerability_id: int
    from_state_id: Optional[int]
    from_state_name: Optional[str] = None
    to_state_id: int
    to_state_name: Optional[str] = None
    transition_id: Optional[int]
    transition_name: Optional[str] = None
    performed_by: int
    performer_name: Optional[str] = None
    comment: Optional[str]
    performed_at: datetime

    class Config:
        from_attributes = True


class GRCVulnWorkflowTemplateResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    is_default: bool
    is_active: bool
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    state_count: int = 0
    transition_count: int = 0
    escalation_count: int = 0

    class Config:
        from_attributes = True


class GRCVulnWorkflowTemplateDetailResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    is_default: bool
    is_active: bool
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    states: List[GRCVulnWorkflowStateResponse] = []
    transitions: List[GRCVulnWorkflowTransitionResponse] = []
    escalations: List[GRCVulnWorkflowEscalationResponse] = []

    class Config:
        from_attributes = True


class VulnWorkflowTransitionRequest(BaseModel):
    transition_id: int
    comment: Optional[str] = None


class VulnAvailableTransitionResponse(BaseModel):
    id: int
    name: str
    to_state_id: int
    to_state_name: str
    requires_comment: bool
    requires_approval: bool


# =============================================================================
# Escalation Log Schemas
# =============================================================================

class GRCVulnEscalationLogResponse(BaseModel):
    id: int
    vulnerability_id: int
    vulnerability_title: Optional[str] = None
    escalation_rule_id: int
    escalation_rule_name: Optional[str] = None
    triggered_at: datetime
    escalated_to_department_id: Optional[int]
    escalated_to_department_name: Optional[str] = None
    escalated_to_user_id: Optional[int]
    escalated_to_user_name: Optional[str] = None
    notification_sent: bool
    auto_transitioned: bool
    new_state_id: Optional[int]
    new_state_name: Optional[str] = None
    notes: Optional[str]

    class Config:
        from_attributes = True


class EscalationCheckResult(BaseModel):
    total_checked: int
    escalations_triggered: int
    vulnerabilities_affected: List[int] = []
    details: List[Dict[str, Any]] = []


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


class RCSATemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    version: Optional[str] = None
    is_active: Optional[bool] = None
    risk_categories: Optional[List[str]] = None
    regulatory_mapping: Optional[Dict[str, Any]] = None


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


# =============================================================================
# Regulatory Change Management Schemas
# =============================================================================

class RegulatoryChangeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    source: str  # OCC, Fed, EBA, PRA, SEC, FINRA, custom
    regulation_reference: Optional[str] = None
    effective_date: Optional[datetime] = None
    published_date: Optional[datetime] = None
    status: str = "identified"
    priority: str = "medium"
    assigned_to: Optional[int] = None


class RegulatoryChangeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    regulation_reference: Optional[str] = None
    effective_date: Optional[datetime] = None
    published_date: Optional[datetime] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[int] = None


class RegulatoryChangeResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    source: str
    regulation_reference: Optional[str]
    effective_date: Optional[datetime]
    published_date: Optional[datetime]
    status: str
    priority: str
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
    assessment_type: str  # policy, control, process, technology
    impacted_item_id: Optional[int] = None
    impacted_item_type: Optional[str] = None  # policy, control, asset, process
    impact_level: str = "medium"
    impact_description: Optional[str] = None
    gap_identified: bool = False
    gap_description: Optional[str] = None


class RegulatoryImpactAssessmentResponse(BaseModel):
    id: int
    tenant_id: int
    regulatory_change_id: int
    assessment_type: str
    impacted_item_id: Optional[int]
    impacted_item_type: Optional[str]
    impacted_item_name: Optional[str] = None
    impact_level: str
    impact_description: Optional[str]
    gap_identified: bool
    gap_description: Optional[str]
    assessed_by: Optional[int]
    assessor_name: Optional[str] = None
    assessed_at: datetime

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


# =============================================================================
# Board & Committee Management Schemas
# =============================================================================

class GovernanceCommitteeCreate(BaseModel):
    name: str
    description: Optional[str] = None
    committee_type: str  # board, risk_committee, audit_committee, compliance_committee, it_steering, custom
    chair_id: Optional[int] = None
    secretary_id: Optional[int] = None
    meeting_frequency: str = "quarterly"  # monthly, quarterly, annual, ad_hoc


class GovernanceCommitteeUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    committee_type: Optional[str] = None
    chair_id: Optional[int] = None
    secretary_id: Optional[int] = None
    meeting_frequency: Optional[str] = None
    is_active: Optional[bool] = None


class GovernanceCommitteeResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    description: Optional[str]
    committee_type: str
    chair_id: Optional[int]
    chair_name: Optional[str] = None
    secretary_id: Optional[int]
    secretary_name: Optional[str] = None
    meeting_frequency: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    member_count: int = 0
    meeting_count: int = 0
    pending_actions_count: int = 0

    class Config:
        from_attributes = True


class CommitteeMemberCreate(BaseModel):
    user_id: int
    role: str = "member"  # chair, secretary, member, observer


class CommitteeMemberResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    user_id: int
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    role: str
    joined_at: datetime
    left_at: Optional[datetime]
    is_active: bool

    class Config:
        from_attributes = True


class CommitteeCharterCreate(BaseModel):
    version: str = "1.0"
    title: str
    content: Optional[str] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: str = "draft"


class CommitteeCharterUpdate(BaseModel):
    version: Optional[str] = None
    title: Optional[str] = None
    content: Optional[str] = None
    effective_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: Optional[str] = None


class CommitteeCharterResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    version: str
    title: str
    content: Optional[str]
    effective_date: Optional[datetime]
    expiry_date: Optional[datetime]
    status: str
    approved_by: Optional[int]
    approver_name: Optional[str] = None
    approved_at: Optional[datetime]
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class CommitteeMeetingCreate(BaseModel):
    meeting_number: Optional[str] = None
    title: str
    meeting_type: str = "regular"  # regular, special, emergency
    scheduled_date: datetime
    location: Optional[str] = None
    virtual_link: Optional[str] = None
    quorum_required: Optional[int] = None


class CommitteeMeetingUpdate(BaseModel):
    meeting_number: Optional[str] = None
    title: Optional[str] = None
    meeting_type: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    location: Optional[str] = None
    virtual_link: Optional[str] = None
    status: Optional[str] = None
    quorum_required: Optional[int] = None
    quorum_present: Optional[int] = None


class CommitteeMeetingResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    committee_name: Optional[str] = None
    meeting_number: Optional[str]
    title: str
    meeting_type: str
    scheduled_date: datetime
    location: Optional[str]
    virtual_link: Optional[str]
    status: str
    quorum_required: Optional[int]
    quorum_present: Optional[int]
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    agenda_item_count: int = 0
    action_count: int = 0
    has_minutes: bool = False

    class Config:
        from_attributes = True


class MeetingAgendaItemCreate(BaseModel):
    item_number: int
    title: str
    description: Optional[str] = None
    item_type: str = "discussion"  # approval, discussion, information, action_review
    presenter_id: Optional[int] = None
    linked_document_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_regulatory_change_id: Optional[int] = None
    time_allocated_minutes: Optional[int] = None


class MeetingAgendaItemUpdate(BaseModel):
    item_number: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    item_type: Optional[str] = None
    presenter_id: Optional[int] = None
    linked_document_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_regulatory_change_id: Optional[int] = None
    time_allocated_minutes: Optional[int] = None
    status: Optional[str] = None
    outcome: Optional[str] = None
    decision_made: Optional[str] = None


class MeetingAgendaItemResponse(BaseModel):
    id: int
    tenant_id: int
    meeting_id: int
    item_number: int
    title: str
    description: Optional[str]
    item_type: str
    presenter_id: Optional[int]
    presenter_name: Optional[str] = None
    linked_document_id: Optional[int]
    linked_document_title: Optional[str] = None
    linked_risk_id: Optional[int]
    linked_risk_title: Optional[str] = None
    linked_regulatory_change_id: Optional[int]
    linked_regulatory_change_title: Optional[str] = None
    time_allocated_minutes: Optional[int]
    status: str
    outcome: Optional[str]
    decision_made: Optional[str]

    class Config:
        from_attributes = True


class MeetingMinutesCreate(BaseModel):
    content: Optional[str] = None
    attendees: List[Dict[str, Any]] = []
    status: str = "draft"


class MeetingMinutesUpdate(BaseModel):
    content: Optional[str] = None
    attendees: Optional[List[Dict[str, Any]]] = None
    status: Optional[str] = None


class MeetingMinutesResponse(BaseModel):
    id: int
    tenant_id: int
    meeting_id: int
    content: Optional[str]
    attendees: List[Dict[str, Any]]
    status: str
    drafted_by: Optional[int]
    drafter_name: Optional[str] = None
    drafted_at: datetime
    approved_by: Optional[int]
    approver_name: Optional[str] = None
    approved_at: Optional[datetime]

    class Config:
        from_attributes = True


class OversightActionCreate(BaseModel):
    action_number: Optional[str] = None
    title: str
    description: Optional[str] = None
    action_type: str = "follow_up"  # follow_up, policy_approval, risk_review, audit_response
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    linked_policy_id: Optional[int] = None
    linked_risk_id: Optional[int] = None
    agenda_item_id: Optional[int] = None


class OversightActionUpdate(BaseModel):
    action_number: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    action_type: Optional[str] = None
    assigned_to: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = None
    completed_at: Optional[datetime] = None
    completion_notes: Optional[str] = None
    linked_policy_id: Optional[int] = None
    linked_risk_id: Optional[int] = None


class OversightActionResponse(BaseModel):
    id: int
    tenant_id: int
    committee_id: int
    committee_name: Optional[str] = None
    meeting_id: Optional[int]
    meeting_title: Optional[str] = None
    agenda_item_id: Optional[int]
    action_number: Optional[str]
    title: str
    description: Optional[str]
    action_type: str
    assigned_to: Optional[int]
    assignee_name: Optional[str] = None
    due_date: Optional[datetime]
    status: str
    completed_at: Optional[datetime]
    completion_notes: Optional[str]
    linked_policy_id: Optional[int]
    linked_policy_title: Optional[str] = None
    linked_risk_id: Optional[int]
    linked_risk_title: Optional[str] = None
    created_by: Optional[int]
    creator_name: Optional[str] = None
    created_at: datetime
    is_overdue: bool = False

    class Config:
        from_attributes = True


class CommitteeDashboardStats(BaseModel):
    total_committees: int
    active_committees: int
    by_type: Dict[str, int]
    total_meetings: int
    upcoming_meetings: int
    completed_meetings: int
    total_actions: int
    open_actions: int
    overdue_actions: int
    in_progress_actions: int
    completed_actions: int
    action_completion_rate: float = 0.0
    upcoming_meetings_list: List[Dict[str, Any]] = []
    overdue_actions_list: List[Dict[str, Any]] = []


class ConvertStatementsRequest(BaseModel):
    statement_ids: List[int]
    category: Optional[str] = None
    priority: Optional[str] = None


class InternalControlFromStatementResponse(BaseModel):
    id: int
    control_id: str
    name: str
    description: Optional[str]
    category: Optional[str]
    priority: str
    source_document_id: int
    source_statement_id: int
    tenant_id: int
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


# =============================================================================
# RSS Feed Ingestion Schemas
# =============================================================================

class RegulatoryFeedSourceCreate(BaseModel):
    name: str
    source_url: str
    source_type: str = "rss"
    country: Optional[str] = None
    regulator: Optional[str] = None
    category: Optional[str] = None
    is_active: bool = True
    poll_interval_hours: int = 24


class RegulatoryFeedSourceUpdate(BaseModel):
    name: Optional[str] = None
    source_url: Optional[str] = None
    source_type: Optional[str] = None
    country: Optional[str] = None
    regulator: Optional[str] = None
    category: Optional[str] = None
    is_active: Optional[bool] = None
    poll_interval_hours: Optional[int] = None


class RegulatoryFeedSourceResponse(BaseModel):
    id: int
    tenant_id: int
    name: str
    source_url: str
    source_type: str
    country: Optional[str]
    regulator: Optional[str]
    category: Optional[str]
    is_active: bool
    poll_interval_hours: int
    last_polled_at: Optional[datetime]
    last_successful_poll: Optional[datetime]
    items_processed: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class RegulatoryFeedItemResponse(BaseModel):
    id: int
    tenant_id: int
    feed_source_id: int
    guid: str
    title: str
    description: Optional[str]
    link: Optional[str]
    published_date: Optional[datetime]
    content: Optional[str]
    status: str
    regulatory_change_id: Optional[int]
    processed_at: Optional[datetime]
    ai_analysis: Optional[Dict[str, Any]]
    created_at: datetime
    feed_source_name: Optional[str] = None

    class Config:
        from_attributes = True


class FeedPollResult(BaseModel):
    feed_source_id: int
    feed_source_name: str
    success: bool
    items_found: int
    new_items: int
    error_message: Optional[str] = None
    polled_at: datetime
