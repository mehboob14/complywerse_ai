import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, ForeignKey, Boolean, 
    Float, DateTime, JSON, Index, Table
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/grc_db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# =============================================================================
# 1. Multi-tenancy Models
# =============================================================================

class Tenant(Base):
    __tablename__ = "grc_tenants"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    slug = Column(String(100), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(JSON, default={})
    
    tenant_users = relationship("TenantUser", back_populates="tenant", cascade="all, delete-orphan")
    business_units = relationship("BusinessUnit", back_populates="tenant", cascade="all, delete-orphan")
    roles = relationship("Role", back_populates="tenant", cascade="all, delete-orphan")
    user_roles = relationship("UserRole", back_populates="tenant", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="tenant", cascade="all, delete-orphan")
    evidence = relationship("Evidence", back_populates="tenant", cascade="all, delete-orphan")
    risks = relationship("Risk", back_populates="tenant", cascade="all, delete-orphan")
    governance_objectives = relationship("GovernanceObjective", back_populates="tenant", cascade="all, delete-orphan")
    exceptions = relationship("Exception", back_populates="tenant", cascade="all, delete-orphan")
    issues = relationship("Issue", back_populates="tenant", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="tenant", cascade="all, delete-orphan")
    it_assets = relationship("ITAsset", back_populates="tenant", cascade="all, delete-orphan")
    compliance_programs = relationship("ComplianceProgram", back_populates="tenant", cascade="all, delete-orphan")
    certification_journeys = relationship("CertificationJourney", back_populates="tenant", cascade="all, delete-orphan")


class TenantUser(Base):
    __tablename__ = "grc_tenant_users"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    is_primary = Column(Boolean, default=False)
    
    user = relationship("GRCUser", back_populates="tenant_users")
    tenant = relationship("Tenant", back_populates="tenant_users")
    
    __table_args__ = (
        Index("ix_tenant_user_composite", "tenant_id", "user_id"),
    )


class BusinessUnit(Base):
    __tablename__ = "grc_business_units"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    parent_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    
    tenant = relationship("Tenant", back_populates="business_units")
    parent = relationship("BusinessUnit", remote_side=[id], backref="children")
    user_roles = relationship("UserRole", back_populates="business_unit")
    
    __table_args__ = (
        Index("ix_business_unit_tenant", "tenant_id"),
    )


# =============================================================================
# 2. RBAC Models
# =============================================================================

class Role(Base):
    __tablename__ = "grc_roles"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    is_system_role = Column(Boolean, default=False)
    
    tenant = relationship("Tenant", back_populates="roles")
    role_permissions = relationship("RolePermission", back_populates="role", cascade="all, delete-orphan")
    user_roles = relationship("UserRole", back_populates="role", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_role_tenant_name", "tenant_id", "name"),
    )


class Permission(Base):
    __tablename__ = "grc_permissions"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    resource = Column(String(100), nullable=False)
    action = Column(String(50), nullable=False)
    
    role_permissions = relationship("RolePermission", back_populates="permission", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_permission_resource_action", "resource", "action"),
    )


class RolePermission(Base):
    __tablename__ = "grc_role_permissions"
    
    id = Column(Integer, primary_key=True, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=False, index=True)
    permission_id = Column(Integer, ForeignKey("grc_permissions.id"), nullable=False, index=True)
    
    role = relationship("Role", back_populates="role_permissions")
    permission = relationship("Permission", back_populates="role_permissions")
    
    __table_args__ = (
        Index("ix_role_permission_composite", "role_id", "permission_id"),
    )


class UserRole(Base):
    __tablename__ = "grc_user_roles"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    
    user = relationship("GRCUser", back_populates="user_roles")
    role = relationship("Role", back_populates="user_roles")
    tenant = relationship("Tenant", back_populates="user_roles")
    business_unit = relationship("BusinessUnit", back_populates="user_roles")
    
    __table_args__ = (
        Index("ix_user_role_tenant", "tenant_id", "user_id"),
    )


# =============================================================================
# 3. User Model (Extended)
# =============================================================================

class GRCUser(Base):
    __tablename__ = "grc_users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
    
    tenant_users = relationship("TenantUser", back_populates="user", cascade="all, delete-orphan")
    user_roles = relationship("UserRole", back_populates="user", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="user")
    uploaded_evidence = relationship("Evidence", back_populates="uploader", foreign_keys="Evidence.uploaded_by")
    evidence_versions = relationship("EvidenceVersion", back_populates="creator")
    owned_risks = relationship("Risk", back_populates="owner")
    owned_objectives = relationship("GovernanceObjective", back_populates="owner")
    owned_issues = relationship("Issue", back_populates="owner")
    owned_documents = relationship("Document", back_populates="owner", foreign_keys="Document.owner_id")
    approved_documents = relationship("Document", back_populates="approver", foreign_keys="Document.approved_by")
    document_versions = relationship("DocumentVersion", back_populates="creator")
    document_approvals = relationship("DocumentApprovalWorkflow", back_populates="approver")
    owned_assets = relationship("ITAsset", back_populates="owner")
    asset_assessments = relationship("AssetRiskAssessment", back_populates="assessor")
    owned_programs = relationship("ComplianceProgram", back_populates="owner")
    compliance_assessments = relationship("GRCComplianceAssessment", back_populates="assessor")


# =============================================================================
# 4. Audit Trail
# =============================================================================

class AuditLog(Base):
    __tablename__ = "grc_audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(100), nullable=False)
    resource_id = Column(Integer, nullable=True)
    changes = Column(JSON, default={})
    ip_address = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True)
    
    tenant = relationship("Tenant", back_populates="audit_logs")
    user = relationship("GRCUser", back_populates="audit_logs")
    
    __table_args__ = (
        Index("ix_audit_log_tenant_timestamp", "tenant_id", "timestamp"),
        Index("ix_audit_log_resource", "resource_type", "resource_id"),
    )


# =============================================================================
# 5. Framework Normalization Models
# =============================================================================

class Framework(Base):
    __tablename__ = "grc_frameworks"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    short_code = Column(String(50), nullable=False, unique=True, index=True)
    regulator = Column(String(255), nullable=True)
    jurisdiction = Column(String(100), nullable=True)
    version = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    is_mandatory = Column(Boolean, default=False)
    enforcement_type = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    is_custom = Column(Boolean, default=False)
    
    domains = relationship("FrameworkDomain", back_populates="framework", cascade="all, delete-orphan")
    compliance_programs = relationship("ComplianceProgram", back_populates="framework")


class FrameworkDomain(Base):
    __tablename__ = "grc_framework_domains"
    
    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    framework = relationship("Framework", back_populates="domains")
    objectives = relationship("ControlObjective", back_populates="domain", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_domain_framework", "framework_id", "code"),
    )


class ControlObjective(Base):
    __tablename__ = "grc_control_objectives"
    
    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("grc_framework_domains.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    domain = relationship("FrameworkDomain", back_populates="objectives")
    controls = relationship("FrameworkControl", back_populates="objective", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_objective_domain", "domain_id", "code"),
    )


class FrameworkControl(Base):
    __tablename__ = "grc_framework_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    objective_id = Column(Integer, ForeignKey("grc_control_objectives.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    is_mandatory = Column(Boolean, default=True)
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    objective = relationship("ControlObjective", back_populates="controls")
    sub_controls = relationship("FrameworkSubControl", back_populates="control", cascade="all, delete-orphan")
    control_mappings = relationship("ControlMapping", back_populates="framework_control", cascade="all, delete-orphan")
    evidence_mappings = relationship("EvidenceControlMapping", back_populates="framework_control")
    
    __table_args__ = (
        Index("ix_control_objective", "objective_id", "code"),
    )


class FrameworkSubControl(Base):
    __tablename__ = "grc_framework_sub_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    control = relationship("FrameworkControl", back_populates="sub_controls")
    
    __table_args__ = (
        Index("ix_sub_control_control", "control_id", "code"),
    )


# =============================================================================
# 6. Normalized Control Model
# =============================================================================

class NormalizedControl(Base):
    __tablename__ = "grc_normalized_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    objective = Column(Text, nullable=True)
    control_owner = Column(String(255), nullable=True)
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    maturity_level = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    control_mappings = relationship("ControlMapping", back_populates="normalized_control", cascade="all, delete-orphan")
    required_evidence = relationship("GRCRequiredEvidence", back_populates="normalized_control", cascade="all, delete-orphan")
    evidence_mappings = relationship("EvidenceControlMapping", back_populates="normalized_control")
    risk_links = relationship("RiskControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    exceptions = relationship("Exception", back_populates="normalized_control")
    document_links = relationship("DocumentControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    asset_links = relationship("AssetControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    compliance_assessments = relationship("GRCComplianceAssessment", back_populates="normalized_control")


class ControlMapping(Base):
    __tablename__ = "grc_control_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    mapping_type = Column(String(20), nullable=False, default="direct")  # direct, partial, related
    
    normalized_control = relationship("NormalizedControl", back_populates="control_mappings")
    framework_control = relationship("FrameworkControl", back_populates="control_mappings")
    
    __table_args__ = (
        Index("ix_control_mapping_composite", "normalized_control_id", "framework_control_id"),
    )


class GRCRequiredEvidence(Base):
    __tablename__ = "grc_required_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    evidence_type = Column(String(100), nullable=False)
    validation_criteria = Column(Text, nullable=True)
    
    normalized_control = relationship("NormalizedControl", back_populates="required_evidence")


# =============================================================================
# 7. Evidence Management
# =============================================================================

class Evidence(Base):
    __tablename__ = "grc_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    file_path = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_type = Column(String(100), nullable=True)
    version = Column(Integer, default=1)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default="draft")  # draft, pending_review, approved, rejected
    
    tenant = relationship("Tenant", back_populates="evidence")
    uploader = relationship("GRCUser", back_populates="uploaded_evidence", foreign_keys=[uploaded_by])
    versions = relationship("EvidenceVersion", back_populates="evidence", cascade="all, delete-orphan")
    control_mappings = relationship("EvidenceControlMapping", back_populates="evidence", cascade="all, delete-orphan")
    ai_assessments = relationship("EvidenceAIAssessment", back_populates="evidence", cascade="all, delete-orphan")
    risk_links = relationship("RiskEvidenceLink", back_populates="evidence", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_evidence_tenant_status", "tenant_id", "status"),
    )


class EvidenceVersion(Base):
    __tablename__ = "grc_evidence_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    file_path = Column(String(500), nullable=True)
    changes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    evidence = relationship("Evidence", back_populates="versions")
    creator = relationship("GRCUser", back_populates="evidence_versions")
    
    __table_args__ = (
        Index("ix_evidence_version", "evidence_id", "version_number"),
    )


class EvidenceControlMapping(Base):
    __tablename__ = "grc_evidence_control_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    
    evidence = relationship("Evidence", back_populates="control_mappings")
    normalized_control = relationship("NormalizedControl", back_populates="evidence_mappings")
    framework_control = relationship("FrameworkControl", back_populates="evidence_mappings")
    
    __table_args__ = (
        Index("ix_evidence_control_mapping", "evidence_id", "normalized_control_id"),
    )


class EvidenceAIAssessment(Base):
    __tablename__ = "grc_evidence_ai_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    relevance_score = Column(Float, nullable=True)
    adequacy_score = Column(Float, nullable=True)
    confidence_score = Column(Float, nullable=True)
    gap_analysis = Column(JSON, default={})
    audit_readiness = Column(Float, nullable=True)
    assessed_at = Column(DateTime, default=datetime.utcnow)
    
    evidence = relationship("Evidence", back_populates="ai_assessments")


# =============================================================================
# 8. Enterprise Risk Management
# =============================================================================

class Risk(Base):
    __tablename__ = "grc_risks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # strategic, operational, financial, compliance, technology, third_party
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_appetite = Column(String(50), nullable=True)
    status = Column(String(50), default="open")
    treatment_plan = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant", back_populates="risks")
    owner = relationship("GRCUser", back_populates="owned_risks")
    control_links = relationship("RiskControlLink", back_populates="risk", cascade="all, delete-orphan")
    asset_links = relationship("RiskAssetLink", back_populates="risk", cascade="all, delete-orphan")
    evidence_links = relationship("RiskEvidenceLink", back_populates="risk", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_risk_tenant_category", "tenant_id", "category"),
        Index("ix_risk_tenant_status", "tenant_id", "status"),
    )


class RiskControlLink(Base):
    __tablename__ = "grc_risk_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    risk = relationship("Risk", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_control_link", "risk_id", "normalized_control_id"),
    )


class RiskAssetLink(Base):
    __tablename__ = "grc_risk_asset_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    
    risk = relationship("Risk", back_populates="asset_links")
    asset = relationship("ITAsset", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_asset_link", "risk_id", "asset_id"),
    )


class RiskEvidenceLink(Base):
    __tablename__ = "grc_risk_evidence_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    
    risk = relationship("Risk", back_populates="evidence_links")
    evidence = relationship("Evidence", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_evidence_link", "risk_id", "evidence_id"),
    )


# =============================================================================
# 9. Governance
# =============================================================================

class GovernanceObjective(Base):
    __tablename__ = "grc_governance_objectives"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="active")
    target_date = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="governance_objectives")
    owner = relationship("GRCUser", back_populates="owned_objectives")
    
    __table_args__ = (
        Index("ix_governance_objective_tenant", "tenant_id", "status"),
    )


class Exception(Base):
    __tablename__ = "grc_exceptions"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    justification = Column(Text, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approval_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="pending")  # pending, approved, rejected, expired
    
    tenant = relationship("Tenant", back_populates="exceptions")
    normalized_control = relationship("NormalizedControl", back_populates="exceptions")
    
    __table_args__ = (
        Index("ix_exception_tenant_status", "tenant_id", "status"),
    )


class Issue(Base):
    __tablename__ = "grc_issues"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(50), default="medium")  # low, medium, high, critical
    status = Column(String(50), default="open")  # open, in_progress, resolved, closed
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="issues")
    owner = relationship("GRCUser", back_populates="owned_issues")
    
    __table_args__ = (
        Index("ix_issue_tenant_status", "tenant_id", "status"),
        Index("ix_issue_tenant_severity", "tenant_id", "severity"),
    )


# =============================================================================
# 10. Policy/Document Management
# =============================================================================

class Document(Base):
    __tablename__ = "grc_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    doc_type = Column(String(50), nullable=False)  # policy, procedure, standard, guideline
    version = Column(String(50), default="1.0")
    status = Column(String(50), default="draft")  # draft, pending_approval, approved, archived
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    review_cycle_months = Column(Integer, default=12)
    next_review_date = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="documents")
    owner = relationship("GRCUser", back_populates="owned_documents", foreign_keys=[owner_id])
    approver = relationship("GRCUser", back_populates="approved_documents", foreign_keys=[approved_by])
    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan")
    approval_workflows = relationship("DocumentApprovalWorkflow", back_populates="document", cascade="all, delete-orphan")
    control_links = relationship("DocumentControlLink", back_populates="document", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_document_tenant_type", "tenant_id", "doc_type"),
        Index("ix_document_tenant_status", "tenant_id", "status"),
    )


class DocumentVersion(Base):
    __tablename__ = "grc_document_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    version_number = Column(String(50), nullable=False)
    content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    change_summary = Column(Text, nullable=True)
    
    document = relationship("Document", back_populates="versions")
    creator = relationship("GRCUser", back_populates="document_versions")
    
    __table_args__ = (
        Index("ix_document_version", "document_id", "version_number"),
    )


class DocumentApprovalWorkflow(Base):
    __tablename__ = "grc_document_approval_workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    status = Column(String(50), default="pending")  # pending, approved, rejected
    approved_at = Column(DateTime, nullable=True)
    comments = Column(Text, nullable=True)
    
    document = relationship("Document", back_populates="approval_workflows")
    approver = relationship("GRCUser", back_populates="document_approvals")


class DocumentControlLink(Base):
    __tablename__ = "grc_document_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    document = relationship("Document", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="document_links")
    
    __table_args__ = (
        Index("ix_document_control_link", "document_id", "normalized_control_id"),
    )


# =============================================================================
# 11. IT Asset Inventory
# =============================================================================

class ITAsset(Base):
    __tablename__ = "grc_it_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    asset_type = Column(String(50), nullable=False)  # application, infrastructure, data, cloud, third_party
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    criticality = Column(String(50), default="medium")  # low, medium, high, critical
    confidentiality_rating = Column(Integer, nullable=True)
    integrity_rating = Column(Integer, nullable=True)
    availability_rating = Column(Integer, nullable=True)
    valuation = Column(Float, nullable=True)
    vendor = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    status = Column(String(50), default="active")  # active, inactive, decommissioned
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant", back_populates="it_assets")
    owner = relationship("GRCUser", back_populates="owned_assets")
    control_links = relationship("AssetControlLink", back_populates="asset", cascade="all, delete-orphan")
    risk_links = relationship("RiskAssetLink", back_populates="asset", cascade="all, delete-orphan")
    risk_assessments = relationship("AssetRiskAssessment", back_populates="asset", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_it_asset_tenant_type", "tenant_id", "asset_type"),
        Index("ix_it_asset_tenant_criticality", "tenant_id", "criticality"),
    )


class AssetControlLink(Base):
    __tablename__ = "grc_asset_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    asset = relationship("ITAsset", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="asset_links")
    
    __table_args__ = (
        Index("ix_asset_control_link", "asset_id", "normalized_control_id"),
    )


class AssetRiskAssessment(Base):
    __tablename__ = "grc_asset_risk_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    assessment_date = Column(DateTime, default=datetime.utcnow)
    risk_score = Column(Float, nullable=True)
    coverage_percentage = Column(Float, nullable=True)
    gaps = Column(JSON, default={})
    assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    asset = relationship("ITAsset", back_populates="risk_assessments")
    assessor = relationship("GRCUser", back_populates="asset_assessments")


# =============================================================================
# 12. Compliance Programs
# =============================================================================

class ComplianceProgram(Base):
    __tablename__ = "grc_compliance_programs"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="not_started")  # not_started, in_progress, completed
    start_date = Column(DateTime, nullable=True)
    target_date = Column(DateTime, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant", back_populates="compliance_programs")
    framework = relationship("Framework", back_populates="compliance_programs")
    owner = relationship("GRCUser", back_populates="owned_programs")
    assessments = relationship("GRCComplianceAssessment", back_populates="program", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_program_tenant", "tenant_id", "status"),
    )


class GRCComplianceAssessment(Base):
    __tablename__ = "grc_compliance_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    program_id = Column(Integer, ForeignKey("grc_compliance_programs.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    status = Column(String(50), default="not_assessed")  # not_assessed, compliant, partial, non_compliant
    maturity_level = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assessed_at = Column(DateTime, nullable=True)
    
    program = relationship("ComplianceProgram", back_populates="assessments")
    normalized_control = relationship("NormalizedControl", back_populates="compliance_assessments")
    assessor = relationship("GRCUser", back_populates="compliance_assessments")
    
    __table_args__ = (
        Index("ix_compliance_assessment_program", "program_id", "status"),
    )


# =============================================================================
# 13. Certification Journey Models
# =============================================================================

class CertificationJourney(Base):
    """Tracks a tenant's certification/compliance journey for a specific framework"""
    __tablename__ = "grc_certification_journeys"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    target_date = Column(DateTime, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="in_progress")
    current_phase = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    
    tenant = relationship("Tenant", back_populates="certification_journeys")
    framework = relationship("Framework")
    control_implementations = relationship("ControlImplementation", back_populates="journey", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_cert_journey_tenant_framework", "tenant_id", "framework_id"),
    )


class ControlImplementation(Base):
    """Tracks implementation status of each control in a certification journey"""
    __tablename__ = "grc_control_implementations"
    
    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey("grc_certification_journeys.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    status = Column(String(50), default="not_started")
    implementation_notes = Column(Text, nullable=True)
    implementation_date = Column(DateTime, nullable=True)
    verified_date = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_applicable = Column(Boolean, default=True)
    priority = Column(Integer, default=3)
    
    journey = relationship("CertificationJourney", back_populates="control_implementations")
    framework_control = relationship("FrameworkControl")
    verifier = relationship("GRCUser")
    evidence_attachments = relationship("ImplementationEvidence", back_populates="implementation", cascade="all, delete-orphan")


class ImplementationEvidence(Base):
    """Links evidence to control implementations with AI scoring"""
    __tablename__ = "grc_implementation_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    implementation_id = Column(Integer, ForeignKey("grc_control_implementations.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    
    ai_confidence_score = Column(Float, nullable=True)
    ai_assessment_status = Column(String(50), nullable=True)
    ai_assessment_notes = Column(Text, nullable=True)
    ai_matched_controls = Column(JSON, default=[])
    
    review_status = Column(String(50), default="pending")
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    implementation = relationship("ControlImplementation", back_populates="evidence_attachments")
    evidence = relationship("Evidence")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])


# =============================================================================
# Database Initialization Functions
# =============================================================================

def init_grc_db():
    """Create all GRC tables in the database and seed framework data."""
    Base.metadata.create_all(bind=engine)
    
    from .seed_frameworks import seed_frameworks
    seed_frameworks()


def get_db():
    """FastAPI dependency for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
