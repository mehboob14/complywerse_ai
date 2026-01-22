import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, ForeignKey, Boolean, 
    Float, DateTime, JSON, Index, Table, UniqueConstraint
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
    governance_documents = relationship("GovernanceDocument", back_populates="tenant", cascade="all, delete-orphan")
    it_assets = relationship("ITAsset", back_populates="tenant", cascade="all, delete-orphan")
    compliance_programs = relationship("ComplianceProgram", back_populates="tenant", cascade="all, delete-orphan")
    certification_journeys = relationship("CertificationJourney", back_populates="tenant", cascade="all, delete-orphan")
    audit_packages = relationship("AuditPackage", back_populates="tenant", cascade="all, delete-orphan")


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
    owned_risks = relationship("Risk", back_populates="owner", foreign_keys="Risk.owner_id")
    owned_objectives = relationship("GovernanceObjective", back_populates="owner")
    owned_issues = relationship("Issue", back_populates="owner")
    owned_documents = relationship("Document", back_populates="owner", foreign_keys="Document.owner_id")
    approved_documents = relationship("Document", back_populates="approver", foreign_keys="Document.approved_by")
    document_versions = relationship("DocumentVersion", back_populates="creator")
    document_approvals = relationship("DocumentApprovalWorkflow", back_populates="approver")
    owned_gov_documents = relationship("GovernanceDocument", back_populates="owner", foreign_keys="GovernanceDocument.owner_id")
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
    region = Column(String(100), nullable=True, default="Global")
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
    control_objective = Column(Text, nullable=True)
    is_mandatory = Column(Boolean, default=True)
    risk_category = Column(String(50), default="security")
    evidence_type = Column(String(50), default="policy")
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    objective = relationship("ControlObjective", back_populates="controls")
    sub_controls = relationship("FrameworkSubControl", back_populates="control", cascade="all, delete-orphan")
    control_mappings = relationship("ControlMapping", back_populates="framework_control", cascade="all, delete-orphan")
    evidence_mappings = relationship("EvidenceControlMapping", back_populates="framework_control")
    curated_evidence_items = relationship("CuratedEvidenceItem", back_populates="framework_control", cascade="all, delete-orphan")
    
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
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    evidence_recommendations = Column(JSON, default=[])
    ai_matching_keywords = Column(JSON, default=[])
    
    control = relationship("FrameworkControl", back_populates="sub_controls")
    curated_evidence_items = relationship("CuratedEvidenceItem", back_populates="sub_control", cascade="all, delete-orphan")
    
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
# 6.1 Unified Common Control Library Models
# =============================================================================

class CommonControlGroup(Base):
    """Groups of related controls across frameworks for unified management"""
    __tablename__ = "grc_common_control_groups"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    domain = Column(String(100), nullable=True)
    keywords = Column(JSON, default=[])
    ai_summary = Column(Text, nullable=True)
    evidence_types = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    control_mappings = relationship("CommonControlGroupMapping", back_populates="group", cascade="all, delete-orphan")
    ai_evidence_recommendations = relationship("AIEvidenceRecommendation", back_populates="group", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_common_control_group_tenant_code", "tenant_id", "code"),
        Index("ix_common_control_group_category", "category"),
        Index("ix_common_control_group_domain", "domain"),
        UniqueConstraint("tenant_id", "code", name="uq_common_control_group_tenant_code"),
    )


class CommonControlGroupMapping(Base):
    """Maps normalized and framework controls to common control groups"""
    __tablename__ = "grc_common_control_group_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("grc_common_control_groups.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    mapping_confidence = Column(Float, nullable=True)
    mapping_source = Column(String(50), nullable=False, default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    group = relationship("CommonControlGroup", back_populates="control_mappings")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        Index("ix_common_group_mapping_group", "group_id"),
        Index("ix_common_group_mapping_normalized", "group_id", "normalized_control_id"),
        Index("ix_common_group_mapping_framework", "group_id", "framework_control_id"),
        UniqueConstraint("group_id", "normalized_control_id", name="uq_group_normalized_control"),
        UniqueConstraint("group_id", "framework_control_id", name="uq_group_framework_control"),
    )


class ControlSimilarityMapping(Base):
    """Tracks similarity relationships between controls"""
    __tablename__ = "grc_control_similarity_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False)
    source_control_id = Column(Integer, nullable=False)
    target_type = Column(String(20), nullable=False)
    target_control_id = Column(Integer, nullable=False)
    similarity_score = Column(Float, nullable=False)
    similarity_type = Column(String(50), nullable=False)
    ai_reasoning = Column(Text, nullable=True)
    verified = Column(Boolean, default=False)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    verifier = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_control_similarity_source", "source_type", "source_control_id"),
        Index("ix_control_similarity_target", "target_type", "target_control_id"),
        Index("ix_control_similarity_tenant", "tenant_id"),
        Index("ix_control_similarity_score", "tenant_id", "similarity_score"),
    )


class ControlInheritance(Base):
    """Defines inheritance relationships between controls"""
    __tablename__ = "grc_control_inheritance"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    parent_type = Column(String(20), nullable=False)
    parent_control_id = Column(Integer, nullable=False)
    child_type = Column(String(20), nullable=False)
    child_control_id = Column(Integer, nullable=False)
    inheritance_type = Column(String(50), nullable=False)
    condition_description = Column(Text, nullable=True)
    coverage_percentage = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_control_inheritance_parent", "parent_type", "parent_control_id"),
        Index("ix_control_inheritance_child", "child_type", "child_control_id"),
        Index("ix_control_inheritance_tenant", "tenant_id"),
    )


class AIEvidenceRecommendation(Base):
    """AI-generated evidence recommendations for controls"""
    __tablename__ = "grc_ai_evidence_recommendations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("grc_common_control_groups.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    evidence_type = Column(String(100), nullable=False)
    evidence_description = Column(Text, nullable=True)
    priority = Column(String(20), nullable=False, default="medium")
    ai_confidence = Column(Float, nullable=True)
    ai_reasoning = Column(Text, nullable=True)
    sample_evidence_names = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    group = relationship("CommonControlGroup", back_populates="ai_evidence_recommendations")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        Index("ix_ai_evidence_rec_tenant", "tenant_id"),
        Index("ix_ai_evidence_rec_group", "group_id"),
        Index("ix_ai_evidence_rec_priority", "tenant_id", "priority"),
    )


class ControlMappingAnalysis(Base):
    """Tracks AI analysis jobs for control mapping"""
    __tablename__ = "grc_control_mapping_analysis"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    analysis_type = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    frameworks_analyzed = Column(JSON, default=[])
    total_controls_analyzed = Column(Integer, default=0)
    mappings_created = Column(Integer, default=0)
    groups_created = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_control_mapping_analysis_tenant", "tenant_id"),
        Index("ix_control_mapping_analysis_status", "tenant_id", "status"),
    )


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
    
    ocr_content = Column(Text, nullable=True)
    ocr_status = Column(String(50), default="pending")  # pending, processing, completed, failed
    ocr_processed_at = Column(DateTime, nullable=True)
    evidence_type = Column(String(100), nullable=True)  # screenshot, document, certificate, audit_report, log, policy, procedure, etc.
    collection_date = Column(DateTime, nullable=True)
    validity_period_days = Column(Integer, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    recertification_date = Column(DateTime, nullable=True)
    is_stale = Column(Boolean, default=False)
    source_system = Column(String(255), nullable=True)
    content_summary = Column(Text, nullable=True)
    quality_score = Column(Float, nullable=True)
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    submitted_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comments = Column(Text, nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="evidence")
    uploader = relationship("GRCUser", back_populates="uploaded_evidence", foreign_keys=[uploaded_by])
    submitter = relationship("GRCUser", foreign_keys=[submitted_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    versions = relationship("EvidenceVersion", back_populates="evidence", cascade="all, delete-orphan")
    control_mappings = relationship("EvidenceControlMapping", back_populates="evidence", cascade="all, delete-orphan")
    ai_assessments = relationship("EvidenceAIAssessment", back_populates="evidence", cascade="all, delete-orphan")
    risk_links = relationship("RiskEvidenceLink", back_populates="evidence", cascade="all, delete-orphan")
    asset_links = relationship("AssetEvidenceLink", back_populates="evidence", cascade="all, delete-orphan")
    incident_links = relationship("EvidenceIncidentLink", back_populates="evidence", cascade="all, delete-orphan")
    policy_links = relationship("EvidencePolicyLink", back_populates="evidence", cascade="all, delete-orphan")
    audit_package_items = relationship("AuditPackageEvidence", back_populates="evidence", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_evidence_tenant_status", "tenant_id", "status"),
        Index("ix_evidence_ocr_status", "tenant_id", "ocr_status"),
        Index("ix_evidence_expiry", "tenant_id", "expiry_date"),
        Index("ix_evidence_stale", "tenant_id", "is_stale"),
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
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    
    # Clause-level mapping fields for auditor-defensible output
    framework_name = Column(String(255), nullable=True)  # e.g., "ISO 27001:2022"
    control_code = Column(String(100), nullable=True)  # e.g., "A.5.1"
    clause_reference = Column(String(255), nullable=True)  # Exact clause/sub-clause reference
    control_title = Column(String(500), nullable=True)  # Control title text
    matching_rationale = Column(Text, nullable=True)  # Why this evidence matches
    confidence_score = Column(Float, nullable=True)  # 0-100 confidence percentage
    coverage_type = Column(String(50), default="partial")  # full, partial, supporting, not_applicable
    
    # Evidence text snippets that matched
    matched_text_snippets = Column(JSON, default=[])  # Text excerpts from evidence
    matched_control_language = Column(Text, nullable=True)  # Control requirement text matched
    similarity_score = Column(Float, nullable=True)  # Semantic similarity score
    rule_based_validation = Column(Boolean, default=False)  # Whether rule-based validation passed
    
    # Locking mechanism to prevent drift
    is_locked = Column(Boolean, default=False)  # Locked by user validation
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    # Audit trail
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_ai = Column(Boolean, default=True)  # True if AI-generated, False if manual
    assessment_id = Column(Integer, ForeignKey("grc_evidence_ai_assessments.id"), nullable=True)
    
    evidence = relationship("Evidence", back_populates="control_mappings")
    normalized_control = relationship("NormalizedControl", back_populates="evidence_mappings")
    framework_control = relationship("FrameworkControl", back_populates="evidence_mappings")
    parsed_control = relationship("ParsedFrameworkControl", foreign_keys=[parsed_control_id])
    uploaded_framework = relationship("UploadedFramework", foreign_keys=[uploaded_framework_id])
    locker = relationship("GRCUser", foreign_keys=[locked_by])
    
    __table_args__ = (
        Index("ix_evidence_control_mapping", "evidence_id", "normalized_control_id"),
        Index("ix_evidence_control_locked", "evidence_id", "is_locked"),
        Index("ix_evidence_parsed_control", "evidence_id", "parsed_control_id"),
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
    content_summary = Column(Text, nullable=True)
    recommendations = Column(JSON, default=[])
    detected_controls = Column(JSON, default=[])
    compliance_gaps = Column(JSON, default=[])
    
    # Deterministic assessment fields
    content_hash = Column(String(64), nullable=True, index=True)  # SHA-256 hash of OCR content
    model_version = Column(String(50), nullable=True)  # AI model version used (e.g., "gpt-4o-2024-08-06")
    prompt_version = Column(String(20), default="1.0")  # Prompt template version for tracking
    
    # Assessment mode
    assessment_mode = Column(String(50), default="initial")  # initial, incremental, locked_audit
    is_locked = Column(Boolean, default=False)  # Prevent re-assessment
    locked_at = Column(DateTime, nullable=True)
    locked_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    lock_reason = Column(String(255), nullable=True)  # e.g., "Auditor validated", "User approved"
    
    # Clause-level control mappings (auditor-defensible output)
    clause_mappings = Column(JSON, default=[])  # [{framework, control_id, clause, title, rationale, confidence, coverage_type}]
    
    # Explainability data
    matched_text_excerpts = Column(JSON, default=[])  # Text snippets from evidence used for matching
    rule_validations = Column(JSON, default=[])  # Results of rule-based validations
    
    # Full audit trail
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assessment_duration_ms = Column(Integer, nullable=True)  # Time taken for AI assessment
    
    evidence = relationship("Evidence", back_populates="ai_assessments")
    locker = relationship("GRCUser", foreign_keys=[locked_by])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    control_mappings = relationship("EvidenceControlMapping", backref="source_assessment", foreign_keys="EvidenceControlMapping.assessment_id")


class EvidenceAssessmentCache(Base):
    """Cache for deterministic AI assessments - same content hash returns same results"""
    __tablename__ = "grc_evidence_assessment_cache"
    
    id = Column(Integer, primary_key=True, index=True)
    content_hash = Column(String(64), nullable=False, unique=True, index=True)  # SHA-256 hash
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    # Cached AI response (full JSON)
    cached_response = Column(JSON, nullable=False)
    
    # Tracking
    model_version = Column(String(50), nullable=False)
    prompt_version = Column(String(20), default="1.0")
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)
    use_count = Column(Integer, default=1)
    
    tenant = relationship("Tenant")
    
    __table_args__ = (
        Index("ix_assessment_cache_tenant_hash", "tenant_id", "content_hash"),
    )


class EvidenceIncidentLink(Base):
    """Links evidence to risk incidents"""
    __tablename__ = "grc_evidence_incident_links"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    link_type = Column(String(100), nullable=True)  # root_cause, mitigation, resolution
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    evidence = relationship("Evidence", back_populates="incident_links")
    incident = relationship("RiskIncident", back_populates="evidence_links")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_evidence_incident_link_evidence", "evidence_id"),
        Index("ix_evidence_incident_link_incident", "incident_id"),
    )


class EvidencePolicyLink(Base):
    """Links evidence to policy statements"""
    __tablename__ = "grc_evidence_policy_links"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    policy_statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=False, index=True)
    link_type = Column(String(100), nullable=True)  # supports, implements, validates
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    evidence = relationship("Evidence", back_populates="policy_links")
    policy_statement = relationship("PolicyStatement", back_populates="evidence_links")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_evidence_policy_link_evidence", "evidence_id"),
        Index("ix_evidence_policy_link_policy", "policy_statement_id"),
    )


class AuditPackage(Base):
    """Audit package for bundling evidence"""
    __tablename__ = "grc_audit_packages"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    audit_period_start = Column(DateTime, nullable=True)
    audit_period_end = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft, finalized, exported, archived
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    finalized_at = Column(DateTime, nullable=True)
    finalized_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    export_path = Column(String(500), nullable=True)
    exported_at = Column(DateTime, nullable=True)
    retention_until = Column(DateTime, nullable=True)
    is_legal_hold = Column(Boolean, default=False)
    package_metadata = Column(JSON, default={})
    
    tenant = relationship("Tenant", back_populates="audit_packages")
    framework = relationship("Framework")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    finalizer = relationship("GRCUser", foreign_keys=[finalized_by])
    evidence_items = relationship("AuditPackageEvidence", back_populates="package", cascade="all, delete-orphan")
    access_logs = relationship("AuditPackageAccessLog", back_populates="package", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_audit_package_tenant", "tenant_id"),
        Index("ix_audit_package_framework", "framework_id"),
        Index("ix_audit_package_status", "tenant_id", "status"),
    )


class AuditPackageEvidence(Base):
    """Evidence included in audit packages"""
    __tablename__ = "grc_audit_package_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(Integer, ForeignKey("grc_audit_packages.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    sequence = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow)
    added_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    package = relationship("AuditPackage", back_populates="evidence_items")
    evidence = relationship("Evidence", back_populates="audit_package_items")
    adder = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_audit_package_evidence_package", "package_id"),
    )


class AuditPackageAccessLog(Base):
    """Track access to audit packages"""
    __tablename__ = "grc_audit_package_access_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    package_id = Column(Integer, ForeignKey("grc_audit_packages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    action = Column(String(50), nullable=False)  # viewed, downloaded, exported
    accessed_at = Column(DateTime, default=datetime.utcnow)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    
    package = relationship("AuditPackage", back_populates="access_logs")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_audit_package_access_log_package", "package_id"),
    )


# =============================================================================
# 8. Enterprise Risk Management
# =============================================================================

class Risk(Base):
    __tablename__ = "grc_risks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # strategic, operational, financial, compliance, technology, third_party, project_change
    risk_category = Column(String(50), default="operational")  # strategic, operational, financial, compliance, technology, third_party, project_change
    risk_sub_category = Column(String(100), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    business_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    affected_department_ids = Column(JSON, default=[])
    due_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_appetite = Column(String(50), nullable=True)
    status = Column(String(50), default="open")
    treatment_plan = Column(Text, nullable=True)
    closure_status = Column(String(50), nullable=True)  # null, pending_closure, closed
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    closure_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant", back_populates="risks")
    owner = relationship("GRCUser", back_populates="owned_risks", foreign_keys=[owner_id])
    business_owner = relationship("GRCUser", foreign_keys=[business_owner_id])
    closer = relationship("GRCUser", foreign_keys=[closed_by])
    business_unit = relationship("BusinessUnit")
    control_links = relationship("RiskControlLink", back_populates="risk", cascade="all, delete-orphan")
    asset_links = relationship("RiskAssetLink", back_populates="risk", cascade="all, delete-orphan")
    evidence_links = relationship("RiskEvidenceLink", back_populates="risk", cascade="all, delete-orphan")
    framework_control_links = relationship("RiskFrameworkControlLink", back_populates="risk", cascade="all, delete-orphan")
    governance_links = relationship("RiskGovernanceLink", back_populates="risk", cascade="all, delete-orphan")
    kris = relationship("RiskKRI", back_populates="risk", cascade="all, delete-orphan")
    incidents = relationship("RiskIncident", back_populates="risk", cascade="all, delete-orphan")
    reviews = relationship("RiskReview", back_populates="risk", cascade="all, delete-orphan")
    score_history = relationship("RiskScoreHistory", back_populates="risk", cascade="all, delete-orphan")
    mitigation_actions = relationship("RiskMitigationAction", back_populates="risk", cascade="all, delete-orphan")
    audit_finding_links = relationship("RiskAuditFindingLink", back_populates="risk", cascade="all, delete-orphan")
    document_links = relationship("DocumentRiskLink", back_populates="risk", cascade="all, delete-orphan")
    
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


class RiskFrameworkControlLink(Base):
    """Links risks to framework controls"""
    __tablename__ = "grc_risk_framework_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    mitigation_effectiveness = Column(String(50), default="partial")  # full, partial, minimal, none
    notes = Column(Text, nullable=True)
    
    risk = relationship("Risk", back_populates="framework_control_links")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        UniqueConstraint("risk_id", "framework_control_id", name="uq_risk_framework_control"),
    )


class RiskGovernanceLink(Base):
    """Links risks to governance objectives"""
    __tablename__ = "grc_risk_governance_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    governance_objective_id = Column(Integer, ForeignKey("grc_governance_objectives.id"), nullable=False, index=True)
    impact_level = Column(String(50), default="medium")  # high, medium, low
    
    risk = relationship("Risk", back_populates="governance_links")
    governance_objective = relationship("GovernanceObjective")
    
    __table_args__ = (
        UniqueConstraint("risk_id", "governance_objective_id", name="uq_risk_governance"),
    )


class RiskKRI(Base):
    """Key Risk Indicators - metrics and thresholds for risk monitoring"""
    __tablename__ = "grc_risk_kris"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    metric_type = Column(String(50), default="numeric")  # numeric, percentage, count, boolean
    unit = Column(String(50), nullable=True)  # %, count, days, USD, etc.
    current_value = Column(Float, nullable=True)
    green_threshold = Column(Float, nullable=True)  # Below this is green
    amber_threshold = Column(Float, nullable=True)  # Below this is amber, above is red
    threshold_direction = Column(String(20), default="lower_is_better")  # lower_is_better, higher_is_better
    frequency = Column(String(50), default="monthly")  # daily, weekly, monthly, quarterly
    data_source = Column(String(255), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    last_measured_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="kris")
    owner = relationship("GRCUser")
    measurements = relationship("RiskKRIMeasurement", back_populates="kri", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_kri_risk", "risk_id"),
    )


class RiskKRIMeasurement(Base):
    """Historical KRI measurements for trend tracking"""
    __tablename__ = "grc_risk_kri_measurements"
    
    id = Column(Integer, primary_key=True, index=True)
    kri_id = Column(Integer, ForeignKey("grc_risk_kris.id"), nullable=False, index=True)
    value = Column(Float, nullable=False)
    status = Column(String(20), default="green")  # green, amber, red
    measured_at = Column(DateTime, default=datetime.utcnow)
    measured_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    
    kri = relationship("RiskKRI", back_populates="measurements")
    measurer = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_kri_measurement_time", "kri_id", "measured_at"),
    )


class RiskIncident(Base):
    """Risk events and incidents - actual realized risks"""
    __tablename__ = "grc_risk_incidents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    incident_date = Column(DateTime, nullable=False)
    discovered_date = Column(DateTime, default=datetime.utcnow)
    severity = Column(String(50), default="medium")  # critical, high, medium, low
    status = Column(String(50), default="open")  # open, investigating, contained, resolved, closed
    financial_impact = Column(Float, nullable=True)
    operational_impact = Column(Text, nullable=True)
    root_cause = Column(Text, nullable=True)
    corrective_actions = Column(Text, nullable=True)
    lessons_learned = Column(Text, nullable=True)
    reported_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    risk = relationship("Risk", back_populates="incidents")
    reporter = relationship("GRCUser", foreign_keys=[reported_by])
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    evidence_links = relationship("EvidenceIncidentLink", back_populates="incident", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_incident_tenant_status", "tenant_id", "status"),
        Index("ix_incident_risk", "risk_id"),
    )


class RiskReview(Base):
    """Risk review workflow - periodic assessments and approvals"""
    __tablename__ = "grc_risk_reviews"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    review_cycle = Column(String(50), default="quarterly")  # monthly, quarterly, semi_annual, annual
    review_type = Column(String(50), default="periodic")  # periodic, triggered, adhoc
    status = Column(String(50), default="pending")  # pending, in_review, approved, rejected
    due_date = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    previous_inherent_score = Column(Float, nullable=True)
    previous_residual_score = Column(Float, nullable=True)
    new_inherent_score = Column(Float, nullable=True)
    new_residual_score = Column(Float, nullable=True)
    findings = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    approval_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="reviews")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    
    __table_args__ = (
        Index("ix_review_risk_status", "risk_id", "status"),
        Index("ix_review_due_date", "due_date"),
    )


class RiskScoreHistory(Base):
    """Track risk score changes over time for trend analysis"""
    __tablename__ = "grc_risk_score_history"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    status = Column(String(50), nullable=True)
    change_reason = Column(String(255), nullable=True)
    changed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="score_history")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_score_history_risk_time", "risk_id", "recorded_at"),
    )


class RiskDependency(Base):
    """Map relationships between risks - cascading impact analysis"""
    __tablename__ = "grc_risk_dependencies"
    
    id = Column(Integer, primary_key=True, index=True)
    source_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    target_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    dependency_type = Column(String(50), default="causes")  # causes, aggravates, mitigates, related
    impact_factor = Column(Float, default=1.0)  # Multiplier for cascade calculation
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    source_risk = relationship("Risk", foreign_keys=[source_risk_id], backref="outgoing_dependencies")
    target_risk = relationship("Risk", foreign_keys=[target_risk_id], backref="incoming_dependencies")
    
    __table_args__ = (
        UniqueConstraint("source_risk_id", "target_risk_id", name="uq_risk_dependency"),
        Index("ix_dependency_source", "source_risk_id"),
        Index("ix_dependency_target", "target_risk_id"),
    )


class RiskAppetiteConfig(Base):
    """Risk appetite configuration per tenant/category"""
    __tablename__ = "grc_risk_appetite_config"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    category = Column(String(50), nullable=False)
    appetite_level = Column(String(50), default="moderate")  # averse, minimal, cautious, moderate, open, hungry
    max_acceptable_score = Column(Float, default=12.0)
    tolerance_threshold = Column(Float, nullable=True)
    escalation_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    alert_enabled = Column(Boolean, default=True)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    escalation_owner = relationship("GRCUser")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "category", name="uq_risk_appetite_tenant_category"),
    )


class RiskMitigationAction(Base):
    """Risk mitigation actions - specific actions to treat risks"""
    __tablename__ = "grc_risk_mitigation_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    action_type = Column(String(50), default="mitigate")  # mitigate, transfer, avoid, accept
    status = Column(String(50), default="open")  # open, in_progress, completed, overdue, cancelled
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expected_residual_reduction = Column(Float, nullable=True)
    actual_residual_reduction = Column(Float, nullable=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="mitigation_actions")
    owner = relationship("GRCUser")
    evidence = relationship("Evidence")
    
    __table_args__ = (
        Index("ix_mitigation_action_risk", "risk_id"),
        Index("ix_mitigation_action_status", "status"),
    )


class RiskAuditFindingLink(Base):
    """Links risks to audit findings/issues"""
    __tablename__ = "grc_risk_audit_finding_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="audit_finding_links")
    issue = relationship("Issue")
    
    __table_args__ = (
        UniqueConstraint("risk_id", "issue_id", name="uq_risk_audit_finding"),
        Index("ix_audit_finding_risk", "risk_id"),
    )


class LikelihoodImpactScale(Base):
    """Configurable likelihood and impact scales for risk scoring"""
    __tablename__ = "grc_likelihood_impact_scales"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scale_type = Column(String(20), nullable=False)  # likelihood, impact
    level = Column(Integer, nullable=False)  # 1-5 (or custom range)
    label = Column(String(100), nullable=False)  # e.g., "Rare", "Unlikely", etc.
    description = Column(Text, nullable=True)
    score_value = Column(Float, nullable=False)  # Numeric value for calculations
    color = Column(String(20), nullable=True)  # For UI display
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    
    __table_args__ = (
        Index("ix_likelihood_impact_scale_tenant", "tenant_id", "scale_type"),
        UniqueConstraint("tenant_id", "scale_type", "level", name="uq_tenant_scale_level"),
    )


class RiskReport(Base):
    """Generated risk reports for governance oversight"""
    __tablename__ = "grc_risk_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    report_type = Column(String(50), nullable=False)  # board_summary, department, audit, regulatory, breach
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    report_period_start = Column(DateTime, nullable=True)
    report_period_end = Column(DateTime, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    report_data = Column(JSON, default={})
    file_path = Column(String(500), nullable=True)
    status = Column(String(50), default="generated")  # draft, generated, reviewed, published
    
    tenant = relationship("Tenant")
    generator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_report_tenant_type", "tenant_id", "report_type"),
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
# 10. Governance Document Management (Enhanced)
# =============================================================================

class GovernanceDocument(Base):
    """Enhanced governance document with full lifecycle management"""
    __tablename__ = "grc_governance_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    document_code = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String(50), nullable=True)  # pdf, docx, xlsx
    
    doc_type = Column(String(50), nullable=False)  # policy, standard, procedure, guideline, charter, framework
    doc_sub_type = Column(String(100), nullable=True)
    classification = Column(String(50), default="internal")  # public, internal, confidential, restricted
    
    parent_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    
    current_version = Column(String(50), default="1.0")
    status = Column(String(50), default="draft")  # draft, pending_review, pending_approval, approved, published, expired, archived, exception_applied
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    author_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    department_id = Column(Integer, nullable=True)
    
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    review_cycle_months = Column(Integer, default=12)
    next_review_date = Column(DateTime, nullable=True)
    last_reviewed_at = Column(DateTime, nullable=True)
    last_reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    regulatory_scope = Column(JSON, default=[])
    framework_ids = Column(JSON, default=[])
    tags = Column(JSON, default=[])
    
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    published_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant", back_populates="governance_documents")
    owner = relationship("GRCUser", back_populates="owned_gov_documents", foreign_keys=[owner_id])
    author = relationship("GRCUser", foreign_keys=[author_id])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    publisher = relationship("GRCUser", foreign_keys=[published_by])
    last_reviewer = relationship("GRCUser", foreign_keys=[last_reviewed_by])
    
    parent_document = relationship("GovernanceDocument", remote_side=[id], backref="child_documents")
    versions = relationship("GovernanceDocumentVersion", back_populates="document", cascade="all, delete-orphan")
    reviewers = relationship("DocumentReviewer", back_populates="document", cascade="all, delete-orphan")
    approval_steps = relationship("DocumentApprovalStep", back_populates="document", cascade="all, delete-orphan")
    audit_logs = relationship("DocumentAuditLog", back_populates="document", cascade="all, delete-orphan")
    control_links = relationship("DocumentControlLink", back_populates="document", cascade="all, delete-orphan")
    risk_links = relationship("DocumentRiskLink", back_populates="document", cascade="all, delete-orphan")
    regulatory_links = relationship("DocumentRegulatoryLink", back_populates="document", cascade="all, delete-orphan")
    asset_links = relationship("DocumentAssetLink", back_populates="document", cascade="all, delete-orphan")
    policy_statements = relationship("PolicyStatement", back_populates="document", cascade="all, delete-orphan")
    workflow_instance = relationship("DocumentWorkflowInstance", back_populates="document", uselist=False, cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_gov_doc_tenant_type", "tenant_id", "doc_type"),
        Index("ix_gov_doc_tenant_status", "tenant_id", "status"),
        Index("ix_gov_doc_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_gov_doc_next_review", "tenant_id", "next_review_date"),
        Index("ix_gov_doc_expiry", "tenant_id", "expiry_date"),
    )


class GovernanceDocumentVersion(Base):
    """Full version history with change tracking"""
    __tablename__ = "grc_governance_document_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    
    version_number = Column(String(50), nullable=False)
    change_type = Column(String(20), default="minor")  # major, minor, patch
    
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String(50), nullable=True)
    
    change_summary = Column(Text, nullable=True)
    change_reason = Column(Text, nullable=True)
    
    status = Column(String(50), default="current")  # current, superseded, archived
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="versions")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    
    __table_args__ = (
        Index("ix_gov_doc_version", "document_id", "version_number"),
        Index("ix_gov_doc_version_status", "document_id", "status"),
    )


class DocumentReviewer(Base):
    """Assigned reviewers and approvers for documents"""
    __tablename__ = "grc_document_reviewers"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    role_type = Column(String(50), nullable=False)  # owner, author, reviewer, approver, stakeholder
    sequence = Column(Integer, default=1)
    is_required = Column(Boolean, default=True)
    notify_on_update = Column(Boolean, default=True)
    notify_on_expiry = Column(Boolean, default=True)
    
    assigned_at = Column(DateTime, default=datetime.utcnow)
    assigned_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="reviewers")
    user = relationship("GRCUser", foreign_keys=[user_id])
    assigner = relationship("GRCUser", foreign_keys=[assigned_by])
    
    __table_args__ = (
        Index("ix_doc_reviewer_doc_user", "document_id", "user_id"),
        Index("ix_doc_reviewer_role", "document_id", "role_type"),
    )


class DocumentApprovalStep(Base):
    """Multi-step approval workflow with sequence"""
    __tablename__ = "grc_document_approval_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True, index=True)
    
    step_sequence = Column(Integer, nullable=False)
    step_name = Column(String(100), nullable=True)
    approval_type = Column(String(50), default="single")  # single, any, all
    
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_role = Column(String(100), nullable=True)
    
    status = Column(String(50), default="pending")  # pending, approved, rejected, skipped, delegated
    
    requested_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    comments = Column(Text, nullable=True)
    
    delegated_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    delegated_at = Column(DateTime, nullable=True)
    delegation_reason = Column(Text, nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="approval_steps")
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    delegate = relationship("GRCUser", foreign_keys=[delegated_to])
    
    __table_args__ = (
        Index("ix_approval_step_doc_seq", "document_id", "step_sequence"),
        Index("ix_approval_step_status", "document_id", "status"),
        Index("ix_approval_step_approver", "approver_id", "status"),
    )


class DocumentAuditLog(Base):
    """Complete audit trail for governance documents"""
    __tablename__ = "grc_document_audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    action = Column(String(50), nullable=False)  # created, updated, submitted, approved, rejected, published, expired, archived, viewed, downloaded
    action_details = Column(Text, nullable=True)
    
    field_changed = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="audit_logs")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_doc_audit_doc_action", "document_id", "action"),
        Index("ix_doc_audit_tenant_date", "tenant_id", "performed_at"),
        Index("ix_doc_audit_user", "performed_by", "performed_at"),
    )


class DocumentControlLink(Base):
    """Links documents to normalized controls"""
    __tablename__ = "grc_document_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="implements")  # implements, supports, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="document_links")
    
    __table_args__ = (
        Index("ix_doc_control_link", "document_id", "normalized_control_id"),
        UniqueConstraint("document_id", "normalized_control_id", name="uq_doc_control_link"),
    )


class DocumentRiskLink(Base):
    """Links documents to risks"""
    __tablename__ = "grc_document_risk_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="mitigates")  # mitigates, addresses, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="risk_links")
    risk = relationship("Risk", back_populates="document_links")
    
    __table_args__ = (
        Index("ix_doc_risk_link", "document_id", "risk_id"),
        UniqueConstraint("document_id", "risk_id", name="uq_doc_risk_link"),
    )


class DocumentRegulatoryLink(Base):
    """Links documents to regulatory requirements"""
    __tablename__ = "grc_document_regulatory_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    
    requirement_reference = Column(String(255), nullable=True)
    link_type = Column(String(50), default="complies")  # complies, addresses, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="regulatory_links")
    framework = relationship("Framework")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        Index("ix_doc_reg_link_doc", "document_id"),
        Index("ix_doc_reg_link_framework", "framework_id"),
    )


class DocumentAssetLink(Base):
    """Links documents to IT assets"""
    __tablename__ = "grc_document_asset_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="governs")  # governs, applies_to, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="asset_links")
    asset = relationship("ITAsset")
    
    __table_args__ = (
        Index("ix_doc_asset_link", "document_id", "asset_id"),
        UniqueConstraint("document_id", "asset_id", name="uq_doc_asset_link"),
    )


class Document(Base):
    """Legacy document model - kept for backward compatibility"""
    __tablename__ = "grc_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    doc_type = Column(String(50), nullable=False)
    version = Column(String(50), default="1.0")
    status = Column(String(50), default="draft")
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
    
    __table_args__ = (
        Index("ix_document_tenant_type", "tenant_id", "doc_type"),
        Index("ix_document_tenant_status", "tenant_id", "status"),
    )


class DocumentVersion(Base):
    """Legacy document version - kept for backward compatibility"""
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
    """Legacy approval workflow - kept for backward compatibility"""
    __tablename__ = "grc_document_approval_workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    status = Column(String(50), default="pending")
    approved_at = Column(DateTime, nullable=True)
    comments = Column(Text, nullable=True)
    
    document = relationship("Document", back_populates="approval_workflows")
    approver = relationship("GRCUser", back_populates="document_approvals")


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
    framework_control_links = relationship("AssetFrameworkControlLink", back_populates="asset", cascade="all, delete-orphan")
    evidence_links = relationship("AssetEvidenceLink", back_populates="asset", cascade="all, delete-orphan")
    
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


class AssetFrameworkControlLink(Base):
    """Links assets to framework controls"""
    __tablename__ = "grc_asset_framework_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    coverage_status = Column(String(50), default="partial")
    notes = Column(Text, nullable=True)
    
    asset = relationship("ITAsset", back_populates="framework_control_links")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "framework_control_id", name="uq_asset_framework_control"),
    )


class AssetEvidenceLink(Base):
    """Links assets to evidence items"""
    __tablename__ = "grc_asset_evidence_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    relationship_type = Column(String(50), default="supports")
    
    asset = relationship("ITAsset", back_populates="evidence_links")
    evidence = relationship("Evidence", back_populates="asset_links")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "evidence_id", name="uq_asset_evidence"),
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
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    target_date = Column(DateTime, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="in_progress")
    current_phase = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    
    tenant = relationship("Tenant", back_populates="certification_journeys")
    framework = relationship("Framework")
    uploaded_framework = relationship("UploadedFramework")
    control_implementations = relationship("ControlImplementation", back_populates="journey", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_cert_journey_tenant_framework", "tenant_id", "framework_id"),
        Index("ix_cert_journey_tenant_uploaded_framework", "tenant_id", "uploaded_framework_id"),
    )


class CertificationPhase(Base):
    """Framework-specific certification phases"""
    __tablename__ = "grc_certification_phases"
    
    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    phase_number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    key_tasks = Column(JSON, default=[])
    deliverables = Column(JSON, default=[])
    
    framework = relationship("Framework")
    
    __table_args__ = (
        UniqueConstraint("framework_id", "phase_number", name="uq_framework_phase"),
    )


class ControlImplementation(Base):
    """Tracks implementation status of each control in a certification journey"""
    __tablename__ = "grc_control_implementations"
    
    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey("grc_certification_journeys.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    status = Column(String(50), default="not_started")
    implementation_notes = Column(Text, nullable=True)
    implementation_date = Column(DateTime, nullable=True)
    verified_date = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_applicable = Column(Boolean, default=True)
    priority = Column(Integer, default=3)
    
    journey = relationship("CertificationJourney", back_populates="control_implementations")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
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


class CuratedEvidenceItem(Base):
    """Curated, specific evidence requirements for controls"""
    __tablename__ = "grc_curated_evidence_items"
    
    id = Column(Integer, primary_key=True, index=True)
    sub_control_id = Column(Integer, ForeignKey("grc_framework_sub_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    artifact_type = Column(String(50), nullable=False)  # policy, configuration, log, screenshot, report, record, certificate
    format_guidance = Column(Text, nullable=True)
    frequency = Column(String(50), default="annual")  # one_time, monthly, quarterly, annual, as_needed
    is_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    sub_control = relationship("FrameworkSubControl", back_populates="curated_evidence_items")
    framework_control = relationship("FrameworkControl", back_populates="curated_evidence_items")
    
    __table_args__ = (
        Index("ix_curated_evidence_sub_control", "sub_control_id"),
        Index("ix_curated_evidence_framework_control", "framework_control_id"),
    )


# =============================================================================
# 15. Framework Upload & Parsing Models
# =============================================================================

class UploadedFramework(Base):
    """Stores uploaded regulatory/standards documents for parsing"""
    __tablename__ = "grc_uploaded_frameworks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String(50), nullable=False)  # pdf, docx
    
    upload_status = Column(String(50), default="uploaded")  # uploaded, parsing, parsed, published, failed
    parse_error = Column(Text, nullable=True)
    parsed_at = Column(DateTime, nullable=True)
    published_framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    published_at = Column(DateTime, nullable=True)
    
    framework_type = Column(String(100), nullable=True)  # regulatory, industry_standard, internal
    source_organization = Column(String(255), nullable=True)
    version = Column(String(50), nullable=True)
    effective_date = Column(DateTime, nullable=True)
    
    is_shared = Column(Boolean, default=False)  # Available to all tenants
    is_active = Column(Boolean, default=True)
    
    document_structure = Column(JSON, nullable=True)  # Extracted sections/chapters for phases
    
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    parsed_controls = relationship("ParsedFrameworkControl", back_populates="uploaded_framework", cascade="all, delete-orphan")
    assessments = relationship("FrameworkAssessment", back_populates="uploaded_framework", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_uploaded_framework_tenant", "tenant_id"),
        Index("ix_uploaded_framework_status", "upload_status"),
    )


class ParsedFrameworkControl(Base):
    """Structured controls extracted from uploaded documents via AI"""
    __tablename__ = "grc_parsed_framework_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    
    control_id = Column(String(100), nullable=False)  # Auto-generated: FW-001, FW-002, etc.
    original_reference = Column(String(255), nullable=True)  # Original section/clause number
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    full_text = Column(Text, nullable=True)  # Complete requirement text
    
    domain = Column(String(100), nullable=True)  # Governance, Risk, Security, etc.
    category = Column(String(100), nullable=True)  # Sub-category
    
    is_mandatory = Column(Boolean, default=True)
    priority = Column(String(20), default="medium")  # high, medium, low
    
    section_number = Column(String(50), nullable=True)
    parent_section = Column(String(255), nullable=True)
    
    ai_confidence = Column(Float, nullable=True)  # AI extraction confidence
    ai_notes = Column(Text, nullable=True)  # AI processing notes
    evidence_requirements = Column(JSON, default=list)  # AI-recommended evidence types
    
    is_verified = Column(Boolean, default=False)  # Human-verified
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    uploaded_framework = relationship("UploadedFramework", back_populates="parsed_controls")
    verifier = relationship("GRCUser", foreign_keys=[verified_by])
    evidence_mappings = relationship("ControlEvidenceMapping", back_populates="parsed_control", cascade="all, delete-orphan")
    alignments = relationship("FrameworkControlAlignment", back_populates="parsed_control", cascade="all, delete-orphan")
    assessment_items = relationship("AssessmentItem", back_populates="parsed_control", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_parsed_control_framework", "uploaded_framework_id"),
        Index("ix_parsed_control_domain", "domain"),
    )


class ControlEvidenceMapping(Base):
    """Maps parsed controls to expected evidence types"""
    __tablename__ = "grc_control_evidence_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    
    evidence_type = Column(String(50), nullable=False)  # policy, procedure, configuration, log, report, contract
    evidence_description = Column(Text, nullable=True)
    is_required = Column(Boolean, default=True)
    suggested_by_ai = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    parsed_control = relationship("ParsedFrameworkControl", back_populates="evidence_mappings")
    
    __table_args__ = (
        Index("ix_evidence_mapping_control", "parsed_control_id"),
        UniqueConstraint("parsed_control_id", "evidence_type", name="uq_control_evidence_type"),
    )


class FrameworkControlAlignment(Base):
    """Links parsed controls to existing control library"""
    __tablename__ = "grc_framework_control_alignments"
    
    id = Column(Integer, primary_key=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    
    alignment_type = Column(String(50), nullable=False)  # exact, partial, new
    match_score = Column(Float, nullable=True)  # 0.0 to 1.0
    match_reason = Column(Text, nullable=True)
    
    is_confirmed = Column(Boolean, default=False)
    confirmed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    parsed_control = relationship("ParsedFrameworkControl", back_populates="alignments")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    confirmer = relationship("GRCUser", foreign_keys=[confirmed_by])
    
    __table_args__ = (
        Index("ix_alignment_parsed_control", "parsed_control_id"),
        Index("ix_alignment_normalized_control", "normalized_control_id"),
    )


class FrameworkAssessment(Base):
    """Compliance assessment for an uploaded framework"""
    __tablename__ = "grc_framework_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assessment_date = Column(DateTime, default=datetime.utcnow)
    target_completion_date = Column(DateTime, nullable=True)
    
    status = Column(String(50), default="in_progress")  # not_started, in_progress, completed, archived
    overall_compliance_score = Column(Float, nullable=True)  # Calculated percentage
    
    lead_assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    department = Column(String(255), nullable=True)
    scope = Column(Text, nullable=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    uploaded_framework = relationship("UploadedFramework", back_populates="assessments")
    lead_assessor = relationship("GRCUser", foreign_keys=[lead_assessor_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    assessment_items = relationship("AssessmentItem", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_assessment_tenant", "tenant_id"),
        Index("ix_assessment_framework", "uploaded_framework_id"),
    )


class AssessmentItem(Base):
    """Individual control assessment within a framework assessment"""
    __tablename__ = "grc_assessment_items"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_framework_assessments.id"), nullable=False, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    
    compliance_status = Column(String(50), default="not_assessed")  # not_assessed, compliant, partially_compliant, non_compliant, not_applicable
    compliance_score = Column(Float, nullable=True)  # 0.0 to 1.0
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    department = Column(String(255), nullable=True)
    
    assessment_notes = Column(Text, nullable=True)
    gap_description = Column(Text, nullable=True)
    
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assessed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    assessment = relationship("FrameworkAssessment", back_populates="assessment_items")
    parsed_control = relationship("ParsedFrameworkControl", back_populates="assessment_items")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    assessor = relationship("GRCUser", foreign_keys=[assessed_by])
    evidence_uploads = relationship("AssessmentEvidence", back_populates="assessment_item", cascade="all, delete-orphan")
    remediation_actions = relationship("AssessmentRemediation", back_populates="assessment_item", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_assessment_item_assessment", "assessment_id"),
        Index("ix_assessment_item_control", "parsed_control_id"),
        UniqueConstraint("assessment_id", "parsed_control_id", name="uq_assessment_control"),
    )


class AssessmentEvidence(Base):
    """Evidence uploaded for assessment items"""
    __tablename__ = "grc_assessment_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_item_id = Column(Integer, ForeignKey("grc_assessment_items.id"), nullable=False, index=True)
    
    evidence_type = Column(String(50), nullable=False)  # policy, procedure, configuration, log, report, contract
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    
    description = Column(Text, nullable=True)
    collection_date = Column(DateTime, nullable=True)
    
    review_status = Column(String(50), default="pending")  # pending, accepted, rejected
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_item = relationship("AssessmentItem", back_populates="evidence_uploads")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])
    
    __table_args__ = (
        Index("ix_assessment_evidence_item", "assessment_item_id"),
    )


class AssessmentRemediation(Base):
    """Remediation actions for non-compliant assessment items"""
    __tablename__ = "grc_assessment_remediations"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_item_id = Column(Integer, ForeignKey("grc_assessment_items.id"), nullable=False, index=True)
    
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    status = Column(String(50), default="open")  # open, in_progress, completed, deferred
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    estimated_effort = Column(String(50), nullable=True)  # hours, days, weeks
    actual_effort = Column(String(50), nullable=True)
    
    completion_notes = Column(Text, nullable=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    assessment_item = relationship("AssessmentItem", back_populates="remediation_actions")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_remediation_item", "assessment_item_id"),
        Index("ix_remediation_status", "status"),
    )


# =============================================================================
# 15. Policy Statement Compliance Models
# =============================================================================

class PolicyStatement(Base):
    """Parsed policy statements extracted from governance documents"""
    __tablename__ = "grc_policy_statements"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    document_version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True, index=True)
    
    statement_code = Column(String(50), nullable=True)  # Auto-generated code like PS-001
    statement_text = Column(Text, nullable=False)
    statement_summary = Column(String(500), nullable=True)  # AI-generated summary
    
    category = Column(String(100), nullable=True)  # security, privacy, operational, etc.
    sub_category = Column(String(100), nullable=True)
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    is_mandatory = Column(Boolean, default=True)
    
    # AI parsing metadata
    ai_confidence = Column(Float, nullable=True)  # 0.0 to 1.0
    ai_extracted_keywords = Column(JSON, default=[])
    ai_suggested_controls = Column(JSON, default=[])  # Suggested control IDs
    
    # Section reference in original document
    source_section = Column(String(255), nullable=True)
    source_page = Column(Integer, nullable=True)
    
    # Status tracking
    status = Column(String(50), default="active")  # active, deprecated, superseded
    effective_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    # Relationships
    tenant = relationship("Tenant")
    document = relationship("GovernanceDocument", back_populates="policy_statements")
    document_version = relationship("GovernanceDocumentVersion")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    compliance_records = relationship("PolicyStatementCompliance", back_populates="statement", cascade="all, delete-orphan")
    evidence_links = relationship("EvidencePolicyLink", back_populates="policy_statement", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_policy_statement_tenant_doc", "tenant_id", "document_id"),
        Index("ix_policy_statement_category", "category"),
        Index("ix_policy_statement_status", "status"),
    )


class PolicyStatementCompliance(Base):
    """Compliance tracking for policy statements"""
    __tablename__ = "grc_policy_statement_compliance"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=False, index=True)
    
    compliance_status = Column(String(50), default="not_assessed")  # compliant, partially_compliant, non_compliant, not_assessed, not_applicable
    compliance_score = Column(Float, nullable=True)  # 0-100 score
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    department = Column(String(100), nullable=True)
    
    assessment_date = Column(DateTime, nullable=True)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    next_assessment_date = Column(DateTime, nullable=True)
    
    findings = Column(Text, nullable=True)
    remediation_notes = Column(Text, nullable=True)
    remediation_due_date = Column(DateTime, nullable=True)
    
    evidence_ids = Column(JSON, default=[])  # Links to evidence records
    control_ids = Column(JSON, default=[])  # Links to control implementations
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    tenant = relationship("Tenant")
    statement = relationship("PolicyStatement", back_populates="compliance_records")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    assessor = relationship("GRCUser", foreign_keys=[assessed_by])
    
    __table_args__ = (
        Index("ix_policy_compliance_tenant", "tenant_id"),
        Index("ix_policy_compliance_status", "compliance_status"),
        Index("ix_policy_compliance_owner", "owner_id"),
    )


# =============================================================================
# 16. Customizable Workflow Models
# =============================================================================

class WorkflowTemplate(Base):
    """Tenant-configurable workflow templates for governance documents"""
    __tablename__ = "grc_workflow_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    # Applicability
    doc_types = Column(JSON, default=[])  # Which document types this applies to: policy, standard, etc.
    is_default = Column(Boolean, default=False)  # Default template for tenant
    is_active = Column(Boolean, default=True)
    
    # Settings
    allow_skip = Column(Boolean, default=False)  # Allow skipping optional steps
    require_all_approvers = Column(Boolean, default=False)  # Require all approvers or just one
    auto_publish_on_complete = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    # Relationships
    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    steps = relationship("WorkflowStep", back_populates="template", cascade="all, delete-orphan", order_by="WorkflowStep.sequence")
    document_instances = relationship("DocumentWorkflowInstance", back_populates="template")
    
    __table_args__ = (
        Index("ix_workflow_template_tenant", "tenant_id"),
        Index("ix_workflow_template_active", "tenant_id", "is_active"),
    )


class WorkflowStep(Base):
    """Individual steps within a workflow template"""
    __tablename__ = "grc_workflow_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_workflow_templates.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    sequence = Column(Integer, nullable=False)  # Order of execution
    
    step_type = Column(String(50), default="approval")  # approval, review, notification, auto
    approval_mode = Column(String(50), default="any")  # any (one approver), all (all approvers), sequential
    
    is_required = Column(Boolean, default=True)
    timeout_days = Column(Integer, nullable=True)  # Auto-escalate after N days
    
    # Actions on completion
    on_approve_status = Column(String(50), nullable=True)  # Status to set on approval
    on_reject_action = Column(String(50), default="return_to_draft")  # return_to_draft, return_to_previous, cancel
    
    # Notification settings
    notify_on_pending = Column(Boolean, default=True)
    notify_on_complete = Column(Boolean, default=True)
    reminder_days = Column(Integer, nullable=True)  # Send reminder after N days
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    template = relationship("WorkflowTemplate", back_populates="steps")
    approvers = relationship("WorkflowStepApprover", back_populates="step", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_workflow_step_template_seq", "template_id", "sequence"),
    )


class WorkflowStepApprover(Base):
    """Approvers assigned to workflow steps"""
    __tablename__ = "grc_workflow_step_approvers"
    
    id = Column(Integer, primary_key=True, index=True)
    step_id = Column(Integer, ForeignKey("grc_workflow_steps.id"), nullable=False, index=True)
    
    approver_type = Column(String(50), nullable=False)  # user, role, document_owner, department_head
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=True, index=True)
    
    is_required = Column(Boolean, default=True)
    sequence = Column(Integer, default=1)  # For sequential approval mode
    
    # Relationships
    step = relationship("WorkflowStep", back_populates="approvers")
    user = relationship("GRCUser")
    role = relationship("Role")
    
    __table_args__ = (
        Index("ix_step_approver_step", "step_id"),
    )


class DocumentWorkflowInstance(Base):
    """Runtime workflow instance for a specific document"""
    __tablename__ = "grc_document_workflow_instances"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("grc_workflow_templates.id"), nullable=False, index=True)
    
    current_step_id = Column(Integer, ForeignKey("grc_workflow_steps.id"), nullable=True, index=True)
    current_step_sequence = Column(Integer, default=1)
    
    status = Column(String(50), default="active")  # active, completed, cancelled, on_hold
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    started_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    # Relationships
    document = relationship("GovernanceDocument", back_populates="workflow_instance")
    template = relationship("WorkflowTemplate", back_populates="document_instances")
    current_step = relationship("WorkflowStep")
    initiator = relationship("GRCUser", foreign_keys=[started_by])
    actions = relationship("DocumentWorkflowAction", back_populates="instance", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_doc_workflow_instance", "document_id"),
        Index("ix_doc_workflow_status", "status"),
    )


class DocumentWorkflowAction(Base):
    """Audit trail for workflow actions"""
    __tablename__ = "grc_document_workflow_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    instance_id = Column(Integer, ForeignKey("grc_document_workflow_instances.id"), nullable=False, index=True)
    step_id = Column(Integer, ForeignKey("grc_workflow_steps.id"), nullable=False, index=True)
    
    action = Column(String(50), nullable=False)  # approve, reject, delegate, skip, escalate, comment
    action_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    action_at = Column(DateTime, default=datetime.utcnow)
    
    comments = Column(Text, nullable=True)
    delegated_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    # Snapshot of step state at action time
    step_sequence = Column(Integer, nullable=True)
    step_name = Column(String(255), nullable=True)
    
    # Relationships
    instance = relationship("DocumentWorkflowInstance", back_populates="actions")
    step = relationship("WorkflowStep")
    actor = relationship("GRCUser", foreign_keys=[action_by])
    delegate = relationship("GRCUser", foreign_keys=[delegated_to])
    
    __table_args__ = (
        Index("ix_workflow_action_instance", "instance_id"),
        Index("ix_workflow_action_actor", "action_by"),
    )


# =============================================================================
# 15. Internal Control Register (ERM Sub-module)
# =============================================================================

class InternalControl(Base):
    """Organization's internal controls - independent of frameworks"""
    __tablename__ = "grc_internal_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    control_id = Column(String(50), nullable=False)  # IC-001, IC-002, etc.
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    category = Column(String(100), nullable=True)  # Operations, Financial, IT, Compliance, etc.
    sub_category = Column(String(100), nullable=True)
    control_type = Column(String(50), default="preventive")  # preventive, detective, corrective
    control_nature = Column(String(50), default="manual")  # manual, automated, hybrid
    
    department_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    backup_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    frequency = Column(String(50), nullable=True)  # daily, weekly, monthly, quarterly, annual, ad-hoc
    regulatory_source = Column(String(255), nullable=True)  # e.g., "CBB Circular 2023-04", "Board Resolution"
    effective_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    
    status = Column(String(50), default="draft")  # draft, pending_approval, active, inactive, deprecated
    workflow_status = Column(String(50), nullable=True)  # pending_review, approved, rejected
    
    design_effectiveness = Column(String(50), nullable=True)  # effective, partially_effective, ineffective, not_tested
    operating_effectiveness = Column(String(50), nullable=True)  # effective, partially_effective, ineffective, not_tested
    last_tested_at = Column(DateTime, nullable=True)
    next_test_date = Column(DateTime, nullable=True)
    
    priority = Column(String(20), default="medium")  # low, medium, high, critical
    is_key_control = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    
    department = relationship("BusinessUnit", foreign_keys=[department_id])
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    backup_owner = relationship("GRCUser", foreign_keys=[backup_owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    
    tests = relationship("InternalControlTest", back_populates="control", cascade="all, delete-orphan")
    risk_links = relationship("InternalControlRiskLink", back_populates="control", cascade="all, delete-orphan")
    framework_links = relationship("InternalControlFrameworkLink", back_populates="internal_control", cascade="all, delete-orphan")
    escalations = relationship("InternalControlEscalation", back_populates="control", cascade="all, delete-orphan")
    workflow_actions = relationship("InternalControlWorkflowAction", back_populates="control", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "control_id", name="uq_internal_control_tenant_id"),
        Index("ix_internal_control_tenant", "tenant_id"),
        Index("ix_internal_control_status", "status"),
        Index("ix_internal_control_department", "department_id"),
    )


class InternalControlTest(Base):
    """Control testing records for design and operating effectiveness"""
    __tablename__ = "grc_internal_control_tests"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    test_type = Column(String(50), nullable=False)  # design, operating
    test_date = Column(DateTime, default=datetime.utcnow)
    test_period_start = Column(DateTime, nullable=True)
    test_period_end = Column(DateTime, nullable=True)
    
    tester_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    sample_size = Column(Integer, nullable=True)
    exceptions_found = Column(Integer, default=0)
    
    result = Column(String(50), nullable=False)  # effective, partially_effective, ineffective
    findings = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    management_response = Column(Text, nullable=True)
    
    evidence_references = Column(JSON, default=[])  # List of evidence IDs or descriptions
    
    status = Column(String(50), default="completed")  # in_progress, completed, reviewed
    reviewed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    control = relationship("InternalControl", back_populates="tests")
    tester = relationship("GRCUser", foreign_keys=[tester_id])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    
    __table_args__ = (
        Index("ix_control_test_control", "control_id"),
        Index("ix_control_test_type", "test_type"),
    )


class InternalControlRiskLink(Base):
    """Links internal controls to ERM risks"""
    __tablename__ = "grc_internal_control_risk_links"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="mitigates")  # mitigates, monitors, detects
    effectiveness_rating = Column(String(50), nullable=True)  # high, medium, low
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    control = relationship("InternalControl", back_populates="risk_links")
    risk = relationship("Risk")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        UniqueConstraint("control_id", "risk_id", name="uq_control_risk_link"),
        Index("ix_internal_control_risk", "control_id", "risk_id"),
    )


class InternalControlFrameworkLink(Base):
    """Optional mapping of internal controls to framework controls"""
    __tablename__ = "grc_internal_control_framework_links"
    
    id = Column(Integer, primary_key=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    
    mapping_type = Column(String(50), default="satisfies")  # satisfies, partially_satisfies, supports
    coverage_percentage = Column(Integer, default=100)  # 0-100
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    internal_control = relationship("InternalControl", back_populates="framework_links")
    framework_control = relationship("FrameworkControl")
    normalized_control = relationship("NormalizedControl")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_internal_framework_link", "internal_control_id"),
    )


class InternalControlEscalation(Base):
    """Escalation rules for control failures"""
    __tablename__ = "grc_internal_control_escalations"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    escalation_level = Column(Integer, default=1)  # 1, 2, 3 for escalation tiers
    escalation_name = Column(String(100), nullable=False)  # e.g., "Manager Review", "Department Head", "Risk Committee"
    
    trigger_condition = Column(String(100), nullable=False)  # test_failure, overdue_test, exception_found
    trigger_threshold = Column(Integer, nullable=True)  # e.g., 3 exceptions trigger escalation
    
    escalate_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    escalate_to_role = Column(String(100), nullable=True)  # Alternative: escalate to role
    escalate_to_department_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    
    escalation_timeframe_hours = Column(Integer, default=24)  # Time to escalate after trigger
    notification_required = Column(Boolean, default=True)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    control = relationship("InternalControl", back_populates="escalations")
    escalate_to_user = relationship("GRCUser", foreign_keys=[escalate_to_user_id])
    escalate_to_department = relationship("BusinessUnit", foreign_keys=[escalate_to_department_id])
    
    __table_args__ = (
        Index("ix_escalation_control", "control_id"),
    )


class InternalControlWorkflowAction(Base):
    """Workflow actions for control approval/review"""
    __tablename__ = "grc_internal_control_workflow_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    
    action = Column(String(50), nullable=False)  # submit, approve, reject, request_changes, escalate
    action_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    action_at = Column(DateTime, default=datetime.utcnow)
    
    from_status = Column(String(50), nullable=True)
    to_status = Column(String(50), nullable=True)
    
    comments = Column(Text, nullable=True)
    
    control = relationship("InternalControl", back_populates="workflow_actions")
    actor = relationship("GRCUser", foreign_keys=[action_by])
    
    __table_args__ = (
        Index("ix_control_workflow_control", "control_id"),
        Index("ix_control_workflow_actor", "action_by"),
    )


# =============================================================================
# 16. Vulnerability Management Module
# =============================================================================

class VulnerabilityReport(Base):
    """Uploaded vulnerability/penetration test reports"""
    __tablename__ = "grc_vulnerability_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    report_type = Column(String(50), nullable=False)  # vulnerability_scan, penetration_test, code_review, configuration_audit
    
    file_path = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_type = Column(String(50), nullable=True)  # excel, csv, pdf, xml
    
    scan_tool = Column(String(100), nullable=True)  # nessus, qualys, burp_suite, owasp_zap, manual
    scan_date = Column(DateTime, nullable=True)
    scan_scope = Column(Text, nullable=True)  # Description of what was scanned
    
    asset_scope_ids = Column(JSON, default=[])  # List of asset IDs in scope
    
    total_vulnerabilities = Column(Integer, default=0)
    critical_count = Column(Integer, default=0)
    high_count = Column(Integer, default=0)
    medium_count = Column(Integer, default=0)
    low_count = Column(Integer, default=0)
    info_count = Column(Integer, default=0)
    
    status = Column(String(50), default="uploaded")  # uploaded, parsing, parsed, analyzed, closed
    
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    vulnerabilities = relationship("Vulnerability", back_populates="report", cascade="all, delete-orphan")
    ai_jobs = relationship("VulnerabilityAIJob", back_populates="report", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_vuln_report_tenant", "tenant_id"),
        Index("ix_vuln_report_status", "status"),
    )


class Vulnerability(Base):
    """Individual vulnerability findings"""
    __tablename__ = "grc_vulnerabilities"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    report_id = Column(Integer, ForeignKey("grc_vulnerability_reports.id"), nullable=True, index=True)
    
    vuln_id = Column(String(50), nullable=False)  # VULN-001, VULN-002, etc.
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    severity = Column(String(20), nullable=False)  # critical, high, medium, low, info
    cvss_score = Column(Float, nullable=True)  # 0.0 - 10.0
    cvss_vector = Column(String(100), nullable=True)
    
    cve_id = Column(String(50), nullable=True)  # CVE-2024-XXXXX
    cwe_id = Column(String(50), nullable=True)  # CWE-79, CWE-89, etc.
    
    affected_component = Column(String(255), nullable=True)  # System, application, URL, IP
    affected_host = Column(String(255), nullable=True)
    affected_port = Column(Integer, nullable=True)
    affected_url = Column(String(500), nullable=True)
    
    evidence = Column(Text, nullable=True)  # Technical evidence/proof
    reproduction_steps = Column(Text, nullable=True)
    
    recommendation = Column(Text, nullable=True)  # Manual recommendation
    ai_recommendation = Column(Text, nullable=True)  # AI-generated fix
    ai_impact_assessment = Column(Text, nullable=True)  # AI impact analysis
    
    status = Column(String(50), default="open")  # open, in_progress, resolved, accepted, false_positive
    resolution_notes = Column(Text, nullable=True)
    
    discovered_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=True)  # Based on SLA
    resolved_at = Column(DateTime, nullable=True)
    
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    
    is_exception = Column(Boolean, default=False)
    exception_reason = Column(Text, nullable=True)
    exception_approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    exception_expiry = Column(DateTime, nullable=True)
    
    workflow_template_id = Column(Integer, ForeignKey("grc_vuln_workflow_templates.id"), nullable=True, index=True)
    current_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=True, index=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    report = relationship("VulnerabilityReport", back_populates="vulnerabilities")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    verifier = relationship("GRCUser", foreign_keys=[verified_by])
    exception_approver = relationship("GRCUser", foreign_keys=[exception_approved_by])
    
    workflow_template = relationship("GRCVulnWorkflowTemplate")
    current_state = relationship("GRCVulnWorkflowState")
    workflow_history = relationship("GRCVulnWorkflowHistory", back_populates="vulnerability", cascade="all, delete-orphan")
    
    mitigations = relationship("VulnerabilityMitigation", back_populates="vulnerability", cascade="all, delete-orphan")
    asset_links = relationship("VulnerabilityAssetLink", back_populates="vulnerability", cascade="all, delete-orphan")
    control_links = relationship("VulnerabilityControlLink", back_populates="vulnerability", cascade="all, delete-orphan")
    retests = relationship("VulnerabilityRetest", back_populates="vulnerability", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "vuln_id", name="uq_vulnerability_tenant_id"),
        Index("ix_vuln_tenant", "tenant_id"),
        Index("ix_vuln_severity", "severity"),
        Index("ix_vuln_status", "status"),
        Index("ix_vuln_report", "report_id"),
        Index("ix_vuln_workflow_state", "current_state_id"),
    )


class VulnerabilityMitigation(Base):
    """Remediation tasks for vulnerabilities"""
    __tablename__ = "grc_vulnerability_mitigations"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    action_title = Column(String(255), nullable=False)
    action_description = Column(Text, nullable=True)
    action_type = Column(String(50), default="remediate")  # remediate, mitigate, transfer, accept
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    status = Column(String(50), default="pending")  # pending, in_progress, completed, cancelled
    
    target_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    effort_estimate = Column(String(50), nullable=True)  # hours, days
    actual_effort = Column(String(50), nullable=True)
    
    notes = Column(Text, nullable=True)
    
    erm_mitigation_id = Column(Integer, ForeignKey("grc_risk_mitigation_actions.id"), nullable=True)  # Link to ERM
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    vulnerability = relationship("Vulnerability", back_populates="mitigations")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_vuln_mitigation_vuln", "vulnerability_id"),
        Index("ix_vuln_mitigation_status", "status"),
    )


class VulnerabilityAssetLink(Base):
    """Links vulnerabilities to affected IT assets"""
    __tablename__ = "grc_vulnerability_asset_links"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    
    impact_on_asset = Column(String(50), nullable=True)  # confidentiality, integrity, availability
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    vulnerability = relationship("Vulnerability", back_populates="asset_links")
    asset = relationship("ITAsset")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        UniqueConstraint("vulnerability_id", "asset_id", name="uq_vuln_asset_link"),
        Index("ix_vuln_asset_link", "vulnerability_id", "asset_id"),
    )


class VulnerabilityControlLink(Base):
    """Links vulnerabilities to framework controls they violate"""
    __tablename__ = "grc_vulnerability_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True, index=True)
    
    compliance_impact = Column(String(50), nullable=True)  # non_compliant, partial, at_risk
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    vulnerability = relationship("Vulnerability", back_populates="control_links")
    framework_control = relationship("FrameworkControl")
    normalized_control = relationship("NormalizedControl")
    internal_control = relationship("InternalControl")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_vuln_control_link", "vulnerability_id"),
    )


class VulnerabilityRetest(Base):
    """Retest records after remediation"""
    __tablename__ = "grc_vulnerability_retests"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    retest_date = Column(DateTime, default=datetime.utcnow)
    tester_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    result = Column(String(50), nullable=False)  # pass, fail, partial
    findings = Column(Text, nullable=True)
    evidence = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    vulnerability = relationship("Vulnerability", back_populates="retests")
    tester = relationship("GRCUser", foreign_keys=[tester_id])
    
    __table_args__ = (
        Index("ix_vuln_retest_vuln", "vulnerability_id"),
    )


class VulnerabilityAIJob(Base):
    """AI analysis job tracking for vulnerability reports"""
    __tablename__ = "grc_vulnerability_ai_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("grc_vulnerability_reports.id"), nullable=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    job_type = Column(String(50), nullable=False)  # parse_report, analyze_vuln, suggest_fix, impact_assessment
    status = Column(String(50), default="pending")  # pending, processing, completed, failed
    
    input_data = Column(JSON, default={})
    output_data = Column(JSON, default={})
    error_message = Column(Text, nullable=True)
    
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    report = relationship("VulnerabilityReport", back_populates="ai_jobs")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_vuln_ai_job_report", "report_id"),
        Index("ix_vuln_ai_job_status", "status"),
    )


class VulnerabilitySLAConfig(Base):
    """SLA configuration by severity"""
    __tablename__ = "grc_vulnerability_sla_config"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    severity = Column(String(20), nullable=False)  # critical, high, medium, low, info
    remediation_days = Column(Integer, nullable=False)  # Days to remediate
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "severity", name="uq_vuln_sla_tenant_severity"),
        Index("ix_vuln_sla_tenant", "tenant_id"),
    )


# =============================================================================
# 19. Department Management Models
# =============================================================================

class GRCDepartment(Base):
    """Departments for vulnerability remediation and management with hierarchy support"""
    __tablename__ = "grc_departments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    code = Column(String(50), nullable=False)  # e.g., "IT-SEC", "NET-OPS"
    description = Column(Text, nullable=True)
    
    parent_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    department_head_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    department_head = relationship("GRCUser", foreign_keys=[department_head_user_id])
    parent_department = relationship("GRCDepartment", remote_side=[id], backref="sub_departments")
    members = relationship("GRCDepartmentMember", back_populates="department", cascade="all, delete-orphan")
    vulnerability_assignments = relationship("GRCVulnerabilityDepartmentAssignment", back_populates="department", cascade="all, delete-orphan")
    escalation_paths = relationship("GRCDepartmentEscalationPath", back_populates="department", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_department_tenant_name"),
        UniqueConstraint("tenant_id", "code", name="uq_department_tenant_code"),
        Index("ix_department_tenant", "tenant_id"),
        Index("ix_department_parent", "parent_department_id"),
    )


class GRCDepartmentMember(Base):
    """Department membership for users"""
    __tablename__ = "grc_department_members"
    
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    role = Column(String(50), nullable=False, default="member")  # head, lead, member
    email_notifications_enabled = Column(Boolean, default=True)
    escalation_order = Column(Integer, default=0)  # Priority for escalations
    
    added_at = Column(DateTime, default=datetime.utcnow)
    added_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    
    department = relationship("GRCDepartment", back_populates="members")
    user = relationship("GRCUser", foreign_keys=[user_id])
    added_by_user = relationship("GRCUser", foreign_keys=[added_by])
    
    __table_args__ = (
        UniqueConstraint("department_id", "user_id", name="uq_department_member"),
        Index("ix_department_member_dept", "department_id"),
        Index("ix_department_member_user", "user_id"),
    )


class GRCVulnerabilityDepartmentAssignment(Base):
    """Assignment of vulnerabilities to departments"""
    __tablename__ = "grc_vulnerability_department_assignments"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    
    assigned_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    
    priority = Column(String(20), nullable=False, default="medium")  # high, medium, low
    notes = Column(Text, nullable=True)
    sla_override_days = Column(Integer, nullable=True)  # Override default SLA
    notification_sent = Column(Boolean, default=False)
    
    vulnerability = relationship("Vulnerability")
    department = relationship("GRCDepartment", back_populates="vulnerability_assignments")
    assigner = relationship("GRCUser", foreign_keys=[assigned_by])
    
    __table_args__ = (
        UniqueConstraint("vulnerability_id", "department_id", name="uq_vuln_department_assignment"),
        Index("ix_vuln_dept_assignment_vuln", "vulnerability_id"),
        Index("ix_vuln_dept_assignment_dept", "department_id"),
    )


class GRCDepartmentEscalationPath(Base):
    """Escalation paths for departments"""
    __tablename__ = "grc_department_escalation_paths"
    
    id = Column(Integer, primary_key=True, index=True)
    department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=False, index=True)
    
    escalation_level = Column(Integer, nullable=False)  # 1, 2, 3
    target_role = Column(String(50), nullable=False)  # lead, head, parent_dept_head
    sla_threshold_percent = Column(Integer, nullable=False, default=75)  # e.g., 75, 100
    auto_escalate = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    department = relationship("GRCDepartment", back_populates="escalation_paths")
    
    __table_args__ = (
        UniqueConstraint("department_id", "escalation_level", name="uq_dept_escalation_level"),
        Index("ix_dept_escalation_dept", "department_id"),
    )


# =============================================================================
# 20. Vulnerability Workflow Template Models
# =============================================================================

class GRCVulnWorkflowTemplate(Base):
    """Workflow templates for vulnerability management"""
    __tablename__ = "grc_vuln_workflow_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    creator = relationship("GRCUser", foreign_keys=[created_by])
    states = relationship("GRCVulnWorkflowState", back_populates="template", cascade="all, delete-orphan")
    transitions = relationship("GRCVulnWorkflowTransition", back_populates="template", cascade="all, delete-orphan")
    escalations = relationship("GRCVulnWorkflowEscalation", back_populates="template", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_vuln_workflow_template_tenant", "tenant_id"),
        Index("ix_vuln_workflow_template_default", "tenant_id", "is_default"),
    )


class GRCVulnWorkflowState(Base):
    """States within a vulnerability workflow template"""
    __tablename__ = "grc_vuln_workflow_states"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_vuln_workflow_templates.id"), nullable=False, index=True)
    
    name = Column(String(100), nullable=False)
    state_type = Column(String(50), nullable=False)  # initial, in_progress, approval, resolved, closed, exception
    order_index = Column(Integer, default=0)
    color = Column(String(20), nullable=True)  # hex color for UI
    
    requires_approval = Column(Boolean, default=False)
    requires_evidence = Column(Boolean, default=False)
    
    auto_assign_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    sla_multiplier = Column(Float, default=1.0)
    is_terminal = Column(Boolean, default=False)
    
    template = relationship("GRCVulnWorkflowTemplate", back_populates="states")
    auto_assign_department = relationship("GRCDepartment")
    
    __table_args__ = (
        Index("ix_vuln_workflow_state_template", "template_id"),
        Index("ix_vuln_workflow_state_type", "state_type"),
    )


class GRCVulnWorkflowTransition(Base):
    """Allowed transitions between workflow states"""
    __tablename__ = "grc_vuln_workflow_transitions"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_vuln_workflow_templates.id"), nullable=False, index=True)
    from_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=False, index=True)
    to_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=False, index=True)
    
    name = Column(String(100), nullable=False)  # action name like "Start Work", "Submit for Review"
    
    requires_comment = Column(Boolean, default=False)
    requires_approval = Column(Boolean, default=False)
    approver_role = Column(String(50), nullable=True)  # manager, lead, security_officer
    
    allowed_roles = Column(JSON, default=[])  # roles that can perform this transition
    trigger_notification = Column(Boolean, default=True)
    
    template = relationship("GRCVulnWorkflowTemplate", back_populates="transitions")
    from_state = relationship("GRCVulnWorkflowState", foreign_keys=[from_state_id])
    to_state = relationship("GRCVulnWorkflowState", foreign_keys=[to_state_id])
    
    __table_args__ = (
        Index("ix_vuln_workflow_transition_template", "template_id"),
        Index("ix_vuln_workflow_transition_from", "from_state_id"),
        Index("ix_vuln_workflow_transition_to", "to_state_id"),
    )


class GRCVulnWorkflowEscalation(Base):
    """Escalation rules for vulnerability workflows"""
    __tablename__ = "grc_vuln_workflow_escalations"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_vuln_workflow_templates.id"), nullable=False, index=True)
    
    name = Column(String(100), nullable=False)  # e.g., "SLA Warning", "SLA Breach"
    trigger_type = Column(String(50), nullable=False)  # sla_percentage, days_open, severity_escalation
    trigger_value = Column(Float, nullable=False)  # e.g., 75.0 for 75% SLA, 30 for 30 days
    
    escalate_to_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    escalate_to_role = Column(String(50), nullable=True)  # manager, ciso
    
    auto_transition_to_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=True, index=True)
    notification_type = Column(String(20), default="both")  # email, in_app, both
    
    is_active = Column(Boolean, default=True)
    
    template = relationship("GRCVulnWorkflowTemplate", back_populates="escalations")
    escalate_to_department = relationship("GRCDepartment")
    auto_transition_to_state = relationship("GRCVulnWorkflowState")
    
    __table_args__ = (
        Index("ix_vuln_workflow_escalation_template", "template_id"),
        Index("ix_vuln_workflow_escalation_type", "trigger_type"),
    )


class GRCVulnWorkflowHistory(Base):
    """Audit trail for vulnerability workflow state changes"""
    __tablename__ = "grc_vuln_workflow_history"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    
    from_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=True, index=True)
    to_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=False, index=True)
    transition_id = Column(Integer, ForeignKey("grc_vuln_workflow_transitions.id"), nullable=True, index=True)
    
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    comment = Column(Text, nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    
    vulnerability = relationship("Vulnerability", back_populates="workflow_history")
    from_state = relationship("GRCVulnWorkflowState", foreign_keys=[from_state_id])
    to_state = relationship("GRCVulnWorkflowState", foreign_keys=[to_state_id])
    transition = relationship("GRCVulnWorkflowTransition")
    performer = relationship("GRCUser", foreign_keys=[performed_by])
    
    __table_args__ = (
        Index("ix_vuln_workflow_history_vuln", "vulnerability_id"),
        Index("ix_vuln_workflow_history_performed", "performed_at"),
    )


class GRCVulnEscalationLog(Base):
    """Escalation log for triggered escalation rules"""
    __tablename__ = "grc_vuln_escalation_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    escalation_rule_id = Column(Integer, ForeignKey("grc_vuln_workflow_escalations.id"), nullable=False, index=True)
    
    triggered_at = Column(DateTime, default=datetime.utcnow)
    
    escalated_to_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    escalated_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    notification_sent = Column(Boolean, default=False)
    auto_transitioned = Column(Boolean, default=False)
    new_state_id = Column(Integer, ForeignKey("grc_vuln_workflow_states.id"), nullable=True, index=True)
    
    notes = Column(Text, nullable=True)
    
    vulnerability = relationship("Vulnerability")
    escalation_rule = relationship("GRCVulnWorkflowEscalation")
    escalated_to_department = relationship("GRCDepartment")
    escalated_to_user = relationship("GRCUser", foreign_keys=[escalated_to_user_id])
    new_state = relationship("GRCVulnWorkflowState")
    
    __table_args__ = (
        Index("ix_vuln_escalation_log_vuln", "vulnerability_id"),
        Index("ix_vuln_escalation_log_rule", "escalation_rule_id"),
        Index("ix_vuln_escalation_log_triggered", "triggered_at"),
    )


class GRCVulnNotification(Base):
    """Notification system for vulnerability events"""
    __tablename__ = "grc_vuln_notifications"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    
    notification_type = Column(String(50), nullable=False)  # assignment, status_change, sla_warning, sla_breach, approval_required, comment_added
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    
    recipient_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    recipient_department_id = Column(Integer, ForeignKey("grc_departments.id"), nullable=True, index=True)
    triggered_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")
    recipient_user = relationship("GRCUser", foreign_keys=[recipient_user_id])
    recipient_department = relationship("GRCDepartment")
    triggered_by = relationship("GRCUser", foreign_keys=[triggered_by_user_id])
    
    __table_args__ = (
        Index("ix_vuln_notification_tenant", "tenant_id"),
        Index("ix_vuln_notification_recipient", "recipient_user_id"),
        Index("ix_vuln_notification_vuln", "vulnerability_id"),
        Index("ix_vuln_notification_type", "notification_type"),
        Index("ix_vuln_notification_read", "is_read"),
    )


# =============================================================================
# Database Initialization Functions
# =============================================================================

def init_grc_db():
    """Create all GRC tables in the database and seed framework data."""
    Base.metadata.create_all(bind=engine)
    
    from .seed_frameworks import seed_frameworks
    seed_frameworks()
    
    from .seed_subcontrols import seed_subcontrols
    seed_subcontrols()
    
    from .seed_evidence_items import seed_curated_evidence_items
    seed_curated_evidence_items()
    
    from .seed_control_evidence import seed_control_evidence
    seed_control_evidence()
    
    from .seed_certification_phases import seed_certification_phases
    seed_certification_phases()
    
    from .seed_internal_controls import seed_internal_controls
    seed_internal_controls()
    
    from .seed_vulnerabilities import seed_vulnerability_data
    seed_vulnerability_data()
    
    from .seed_vuln_workflows import seed_default_vuln_workflow
    seed_default_vuln_workflow()


def get_db():
    """FastAPI dependency for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
