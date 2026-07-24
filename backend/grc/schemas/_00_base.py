from pydantic import BaseModel, EmailStr
from typing import Optional, List, Dict, Any, Union
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
    ubl_fields: Optional[Dict[str, Any]] = None
    template_fields: Optional[Dict[str, Any]] = None  # verbatim register-template fields (e.g. 1LINK RCSA)
    owner_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = []
    # The risk's owning team / business unit. Frontends now send `team_id`
    # (sourced from admin/teams). The risk handler resolves it to a real
    # BusinessUnit row (auto-mirroring by name) and stores it on
    # `business_unit_id`. Direct `business_unit_id` is still accepted so
    # API callers that already know the BU id can keep using it.
    team_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    # Provenance — manual | register_import | assessment | incident | rcsa | framework_gap | ubl_import | nca_import
    source_type: Optional[str] = None
    source_assessment_id: Optional[int] = None
    source_incident_id: Optional[int] = None
    source_rcsa_finding_id: Optional[int] = None
    source_reference: Optional[str] = None


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
    root_cause: Optional[str] = None
    consequences: Optional[str] = None
    recommendations: Optional[str] = None
    closure_status: Optional[str] = None


class RiskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    risk_category: Optional[str] = None
    risk_sub_category: Optional[str] = None
    register_type: Optional[str] = None
    ubl_fields: Optional[Dict[str, Any]] = None
    template_fields: Optional[Dict[str, Any]] = None  # verbatim register-template fields
    owner_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    affected_department_ids: Optional[List[int]] = None
    # Team / business unit re-assignment. Same shape as RiskBase — pass
    # team_id and the handler will auto-mirror to a BusinessUnit row.
    team_id: Optional[int] = None
    business_unit_id: Optional[int] = None
    status: Optional[str] = None
    treatment_plan: Optional[str] = None
    root_cause: Optional[str] = None
    consequences: Optional[str] = None
    recommendations: Optional[str] = None
    closure_status: Optional[str] = None
    closure_notes: Optional[str] = None
    source_type: Optional[str] = None
    source_assessment_id: Optional[int] = None
    source_incident_id: Optional[int] = None
    source_rcsa_finding_id: Optional[int] = None
    source_reference: Optional[str] = None


class RiskResponse(BaseModel):
    id: int
    tenant_id: int
    title: str
    description: Optional[str]
    category: str
    risk_sub_category: Optional[str] = None
    register_type: Optional[str] = None
    ubl_fields: Optional[Dict[str, Any]] = None
    template_fields: Optional[Dict[str, Any]] = None
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
    root_cause: Optional[str] = None
    consequences: Optional[str] = None
    recommendations: Optional[str] = None
    closure_status: Optional[str] = None
    closed_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closure_notes: Optional[str] = None
    source_type: Optional[str] = None
    source_assessment_id: Optional[int] = None
    source_incident_id: Optional[int] = None
    source_rcsa_finding_id: Optional[int] = None
    source_reference: Optional[str] = None
    # Human-readable provenance (e.g. the vendor name) resolved from source_reference.
    source_label: Optional[str] = None
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
    register_type: Optional[str] = None
    ubl_fields: Optional[Dict[str, Any]] = None
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
    # `criticality` is system-derived from the CIA + exposure inputs by
    # default. Clients may still pass a value but it's overridden by the
    # derived bucket unless `criticality_manual_override=True` is also
    # set (see services/asset_criticality.py).
    criticality: Optional[str] = None
    vendor: Optional[str] = None
    location: Optional[str] = None
    cde_environment: bool = False
    pci_dss: Optional[dict] = None
    # Phase 5.1 — Exposure metadata. All optional; writers may supply.
    internet_facing: Optional[bool] = None
    network_segment: Optional[str] = None
    data_classification: Optional[str] = None
    business_function: Optional[str] = None
    compliance_scope: Optional[List[str]] = None
    # Phase 5.2 — Ownership chain.
    primary_owner_id: Optional[int] = None
    secondary_owner_id: Optional[int] = None
    owning_team: Optional[str] = None
    # FK to grc_teams.id — preferred over the free-text owning_team field.
    owning_team_id: Optional[int] = None
    escalation_contact_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    # Phase 5.3 — Lifecycle state (only the starting state; transitions go
    # through the dedicated POST /lifecycle-transition endpoint so the state
    # machine + auto-close hook can run.)
    lifecycle_state: Optional[str] = None
    # Audit-traceable override of the derived criticality bucket.
    # `criticality_manual_override=True` + a `criticality` value tells the
    # server to keep the user's bucket; the derived numeric score is
    # still stored in `criticality_score` so the audit log shows both
    # "what the system computed" and "what the user chose to publish".
    criticality_manual_override: Optional[bool] = None
    criticality_override_reason: Optional[str] = None


class ITAssetCreate(ITAssetBase):
    confidentiality_rating: Optional[int] = None
    integrity_rating: Optional[int] = None
    availability_rating: Optional[int] = None
    valuation: Optional[float] = None
    # CIS / Compliance tab compatibility. Operators creating an asset
    # manually in IT Assets often already know the OS — accepting these
    # fields up-front means the strict matcher can resolve a benchmark
    # without a Connect Wizard handshake first. Without them, manually
    # created assets land with os_normalized=NULL → 0 applicable rules
    # → "OS not in feed yet" banner on the Compliance tab.
    os_family: Optional[str] = None
    os_version: Optional[str] = None
    os_normalized: Optional[str] = None
    os_build: Optional[str] = None
    os_edition: Optional[str] = None


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
    # OS profile fields — match what ITAssetCreate accepts so an asset
    # imported with vague OS data ("Windows 11") can be patched to the
    # exact build (windows-11-23H2) without going through Connect Wizard.
    os_family: Optional[str] = None
    os_version: Optional[str] = None
    os_normalized: Optional[str] = None
    os_build: Optional[str] = None
    os_edition: Optional[str] = None
    # ── Risk Posture v2 business-context fields ────────────────────────
    # The Risk Posture asset detail page Save button writes through this
    # endpoint. `operational_dependency` is the v2 wire name; the assets
    # router translates it to the renamed column `op_dep_business_impact`
    # (the existing Integer column with the same wire name is for
    # Criticality Assessments — separate domain).
    is_customer_facing: Optional[bool] = None
    is_internet_facing: Optional[bool] = None
    regulated_data_type: Optional[str] = None
    operational_dependency: Optional[str] = None   # v2 wire name; maps to op_dep_business_impact
    business_impact_notes: Optional[str] = None
    vendor: Optional[str] = None
    location: Optional[str] = None
    status: Optional[str] = None
    cde_environment: Optional[bool] = None
    pci_dss: Optional[dict] = None
    # Phase 5 — Operational context fields. Lifecycle state is intentionally
    # NOT updatable through this generic endpoint; clients must use
    # POST /assets/{id}/lifecycle-transition so the state machine runs.
    internet_facing: Optional[bool] = None
    network_segment: Optional[str] = None
    data_classification: Optional[str] = None
    business_function: Optional[str] = None
    compliance_scope: Optional[List[str]] = None
    primary_owner_id: Optional[int] = None
    secondary_owner_id: Optional[int] = None
    owning_team: Optional[str] = None
    owning_team_id: Optional[int] = None
    escalation_contact_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    # Manual override of the derived criticality bucket (see ITAssetBase).
    criticality_manual_override: Optional[bool] = None
    criticality_override_reason: Optional[str] = None


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
    pci_dss: Optional[dict] = None
    created_at: datetime
    # Phase 5 fields — all optional on the response so older rows that
    # haven't been touched since the migration still serialize cleanly.
    internet_facing: Optional[bool] = None
    network_segment: Optional[str] = None
    data_classification: Optional[str] = None
    business_function: Optional[str] = None
    compliance_scope: Optional[List[str]] = None
    primary_owner_id: Optional[int] = None
    secondary_owner_id: Optional[int] = None
    owning_team: Optional[str] = None
    owning_team_id: Optional[int] = None
    owning_team_name: Optional[str] = None
    escalation_contact_id: Optional[int] = None
    business_owner_id: Optional[int] = None
    lifecycle_state: Optional[str] = None
    decommissioned_at: Optional[datetime] = None
    retirement_reason: Optional[str] = None
    replacement_asset_id: Optional[int] = None
    criticality_score: Optional[float] = None
    criticality_manual_override: Optional[bool] = None
    criticality_override_reason: Optional[str] = None
    last_seen_at: Optional[datetime] = None
    last_seen_source: Optional[str] = None

    class Config:
        from_attributes = True


class LifecycleTransitionRequest(BaseModel):
    """Body for POST /assets/{id}/lifecycle-transition.

    `to_state` is required. `reason` and `replacement_asset_id` are recorded
    when transitioning into a terminal state (decommissioned / retired).
    """
    to_state: str
    reason: Optional[str] = None
    replacement_asset_id: Optional[int] = None


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
    # Phase 5 operational context fields.
    internet_facing: Optional[bool] = None
    network_segment: Optional[str] = None
    data_classification: Optional[str] = None
    business_function: Optional[str] = None
    compliance_scope: Optional[List[str]] = None
    primary_owner_id: Optional[int] = None
    primary_owner_name: Optional[str] = None
    secondary_owner_id: Optional[int] = None
    secondary_owner_name: Optional[str] = None
    owning_team: Optional[str] = None
    escalation_contact_id: Optional[int] = None
    escalation_contact_name: Optional[str] = None
    business_owner_id: Optional[int] = None
    business_owner_name: Optional[str] = None
    lifecycle_state: Optional[str] = None
    decommissioned_at: Optional[datetime] = None
    retirement_reason: Optional[str] = None
    replacement_asset_id: Optional[int] = None
    replacement_asset_name: Optional[str] = None
    criticality_score: Optional[float] = None
    last_seen_at: Optional[datetime] = None
    last_seen_source: Optional[str] = None

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

