import os
from datetime import datetime
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, ForeignKey, Boolean, 
    Float, DateTime, JSON, Index, Table, UniqueConstraint, inspect, text
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
import logging

logger = logging.getLogger(__name__)

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
    subdomain = Column(String(100), unique=True, nullable=True, index=True)
    schema_name = Column(String(100), unique=True, nullable=True, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    settings = Column(JSON, default={})
    legal_entity = Column(String(255), nullable=True)
    industry = Column(String(100), nullable=True)
    regulatory_scope = Column(String(255), nullable=True)
    company_size = Column(String(50), nullable=True)
    geography = Column(String(100), nullable=True)
    primary_contact_name = Column(String(255), nullable=True)
    primary_contact_email = Column(String(255), nullable=True)
    primary_contact_phone = Column(String(50), nullable=True)
    
    tenant_users = relationship("TenantUser", back_populates="tenant", cascade="all, delete-orphan")
    business_units = relationship("BusinessUnit", back_populates="tenant", cascade="all, delete-orphan")
    roles = relationship("Role", back_populates="tenant", cascade="all, delete-orphan")
    user_roles = relationship("UserRole", back_populates="tenant", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="tenant", cascade="all, delete-orphan")
    evidence = relationship("Evidence", back_populates="tenant", cascade="all, delete-orphan")
    risks = relationship("Risk", back_populates="tenant", cascade="all, delete-orphan")
    governance_objectives = relationship("GovernanceObjective", back_populates="tenant", cascade="all, delete-orphan")
    exceptions = relationship("Exception", back_populates="tenant", cascade="all, delete-orphan")
    policy_exceptions = relationship("PolicyException", back_populates="tenant", cascade="all, delete-orphan")
    issues = relationship("Issue", back_populates="tenant", cascade="all, delete-orphan")
    documents = relationship("Document", back_populates="tenant", cascade="all, delete-orphan")
    governance_documents = relationship("GovernanceDocument", back_populates="tenant", cascade="all, delete-orphan")
    it_assets = relationship("ITAsset", back_populates="tenant", cascade="all, delete-orphan")
    compliance_programs = relationship("ComplianceProgram", back_populates="tenant", cascade="all, delete-orphan")
    certification_journeys = relationship("CertificationJourney", back_populates="tenant", cascade="all, delete-orphan")
    audit_packages = relationship("AuditPackage", back_populates="tenant", cascade="all, delete-orphan")
    compliance_assessment_docs = relationship("ComplianceAssessmentDocument", back_populates="tenant", cascade="all, delete-orphan")


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
    department = Column(String(255), nullable=True)
    group = Column(String(255), nullable=True)
    division = Column(String(255), nullable=True)
    designation = Column(String(255), nullable=True)
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
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    mapping_confidence = Column(Float, nullable=True)
    mapping_source = Column(String(50), nullable=False, default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    group = relationship("CommonControlGroup", back_populates="control_mappings")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
    
    __table_args__ = (
        Index("ix_common_group_mapping_group", "group_id"),
        Index("ix_common_group_mapping_normalized", "group_id", "normalized_control_id"),
        Index("ix_common_group_mapping_framework", "group_id", "framework_control_id"),
        Index("ix_common_group_mapping_parsed", "group_id", "parsed_control_id"),
        UniqueConstraint("group_id", "normalized_control_id", name="uq_group_normalized_control"),
        UniqueConstraint("group_id", "framework_control_id", name="uq_group_framework_control"),
        UniqueConstraint("group_id", "parsed_control_id", name="uq_group_parsed_control"),
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
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
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
    parsed_control = relationship("ParsedFrameworkControl")
    
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
    assessment_evidence_links = relationship("AssessmentEvidence", back_populates="linked_evidence", cascade="all, delete-orphan")
    
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
    register_type = Column(String(100), nullable=True)  # PCI-DSS, ISO 27001, SOX, Internal, NIST, GDPR, etc.
    ubl_fields = Column(JSON, nullable=True)  # UBL template-specific structured fields
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
    gap_findings = relationship("PolicyGapFinding", foreign_keys="PolicyGapFinding.risk_register_id", back_populates="risk_register_entry")
    
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


class RiskAssessment(Base):
    """Formal risk assessment campaigns/exercises"""
    __tablename__ = "grc_risk_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assessment_type = Column(String(50), default="periodic")  # periodic, ad_hoc, incident_driven, regulatory
    methodology = Column(String(100), nullable=True)  # NIST, ISO31000, FAIR, OCTAVE
    scope = Column(Text, nullable=True)
    assessment_period_start = Column(DateTime, nullable=True)
    assessment_period_end = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft, in_progress, under_review, approved, closed
    lead_assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant")
    lead_assessor = relationship("GRCUser", foreign_keys=[lead_assessor_id])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    business_unit = relationship("BusinessUnit")
    framework = relationship("Framework")
    assessed_risks = relationship("RiskAssessmentRisk", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_risk_assessment_tenant_status", "tenant_id", "status"),
        Index("ix_risk_assessment_dates", "assessment_period_start", "assessment_period_end"),
    )


class RiskAssessmentRisk(Base):
    """Link between risk assessments and risks with assessment-specific data"""
    __tablename__ = "grc_risk_assessment_risks"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_risk_assessments.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)    
    inherent_likelihood = Column(Integer, nullable=True)  # 1-5 scale
    inherent_impact = Column(Integer, nullable=True)  # 1-5 scale
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_rating = Column(String(50), nullable=True)  # critical, high, medium, low
    treatment_decision = Column(String(50), nullable=True)  # accept, mitigate, transfer, avoid
    rationale = Column(Text, nullable=True)
    control_effectiveness = Column(String(50), nullable=True)  # effective, partially_effective, ineffective
    notes = Column(Text, nullable=True)
    assessed_at = Column(DateTime, default=datetime.utcnow)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    assessment = relationship("RiskAssessment", back_populates="assessed_risks")
    risk = relationship("Risk")
    assessor = relationship("GRCUser")
    linked_kris = relationship("RiskAssessmentKRI", back_populates="assessment_risk", cascade="all, delete-orphan")
    linked_incidents = relationship("RiskAssessmentIncident", back_populates="assessment_risk", cascade="all, delete-orphan")
    linked_rcsa_findings = relationship("RiskAssessmentRCSAFinding", back_populates="assessment_risk", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_assessment_risk_link", "assessment_id", "risk_id"),
        UniqueConstraint("assessment_id", "risk_id", name="uq_assessment_risk"),
    )


class RiskAssessmentKRI(Base):
    """Link between risk assessments and KRIs"""
    __tablename__ = "grc_risk_assessment_kris"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    kri_id = Column(Integer, ForeignKey("grc_risk_kris.id"), nullable=False, index=True)
    observed_value = Column(Float, nullable=True)
    threshold_status = Column(String(50), nullable=True)  # green, amber, red
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_kris")
    kri = relationship("RiskKRI")
    
    __table_args__ = (
        Index("ix_assessment_kri_link", "assessment_risk_id", "kri_id"),
    )


class RiskAssessmentIncident(Base):
    """Link between risk assessments and incidents"""
    __tablename__ = "grc_risk_assessment_incidents"
     
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    impact_on_rating = Column(String(50), nullable=True)  # increased, decreased, no_change
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_incidents")
    incident = relationship("RiskIncident")
    
    __table_args__ = (
        Index("ix_assessment_incident_link", "assessment_risk_id", "incident_id"),
    )


class RiskAssessmentRCSAFinding(Base):
    """Link between risk assessments and RCSA findings"""
    __tablename__ = "grc_risk_assessment_rcsa_findings"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    rcsa_finding_id = Column(Integer, ForeignKey("grc_rcsa_findings.id"), nullable=False, index=True)
    relevance_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_rcsa_findings")
    rcsa_finding = relationship("RCSAFinding")
    
    __table_args__ = (
        Index("ix_assessment_rcsa_finding_link", "assessment_risk_id", "rcsa_finding_id"),
    )


class FrameworkRiskAssessment(Base):
    """Framework-based risk assessment questionnaire"""
    __tablename__ = "grc_framework_risk_assessments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # framework_id kept for backwards-compat with previously-published frameworks
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    # uploaded_framework_id is the primary reference going forward (all UploadedFramework statuses)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="in_progress")  # in_progress, completed, archived
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    framework = relationship("Framework")
    uploaded_framework = relationship("UploadedFramework")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    questions = relationship("FrameworkRiskQuestion", back_populates="assessment", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_fw_risk_assessment_tenant", "tenant_id"),
        Index("ix_fw_risk_assessment_framework", "framework_id"),
        Index("ix_fw_risk_assessment_uploaded_fw", "uploaded_framework_id"),
    )


class FrameworkRiskQuestion(Base):
    """Question items for framework risk assessment"""
    __tablename__ = "grc_framework_risk_questions"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_framework_risk_assessments.id"), nullable=False, index=True)
    question_text = Column(Text, nullable=False)
    status = Column(String(50), default="not_started")  # not_started, in_progress, completed, blocked
    assigned_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    is_risk_accepted = Column(Boolean, default=False)
    acceptance_notes = Column(Text, nullable=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    moved_to_risk_register_at = Column(DateTime, nullable=True)
    order_index = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assessment = relationship("FrameworkRiskAssessment", back_populates="questions")
    assignee = relationship("GRCUser", foreign_keys=[assigned_user_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    evidence_uploads = relationship("FrameworkRiskQuestionEvidence", back_populates="question", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_fw_risk_question_assessment", "assessment_id"),
        Index("ix_fw_risk_question_status", "status"),
    )


class FrameworkRiskQuestionEvidence(Base):
    """Evidence uploaded for framework risk assessment questions"""
    __tablename__ = "grc_framework_risk_question_evidence"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("grc_framework_risk_questions.id"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    question = relationship("FrameworkRiskQuestion", back_populates="evidence_uploads")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])

    __table_args__ = (
        Index("ix_fw_risk_question_evidence_question", "question_id"),
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


class PolicyException(Base):
    __tablename__ = "grc_policy_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    justification = Column(Text, nullable=True)
    risk_assessment = Column(Text, nullable=True)
    compensating_controls = Column(Text, nullable=True)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="draft")
    priority = Column(String(20), default="medium")
    requested_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    is_expired = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    metadata_ = Column("metadata", JSON, default={})

    tenant = relationship("Tenant", back_populates="policy_exceptions")
    document = relationship("GovernanceDocument")
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    rejector = relationship("GRCUser", foreign_keys=[rejected_by])
    comments = relationship("PolicyExceptionComment", back_populates="exception", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_pol_exc_tenant_status", "tenant_id", "status"),
        Index("ix_pol_exc_tenant_doc", "tenant_id", "document_id"),
        Index("ix_pol_exc_expiry", "tenant_id", "expiry_date"),
    )


class PolicyExceptionComment(Base):
    __tablename__ = "grc_policy_exception_comments"

    id = Column(Integer, primary_key=True, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    exception = relationship("PolicyException", back_populates="comments")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_pol_exc_comment_exception", "exception_id"),
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


class PolicyReviewHistory(Base):
    """Tracks periodic and ad-hoc reviews for governance documents"""
    __tablename__ = "grc_policy_review_history"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)

    review_type = Column(String(50), default="periodic")  # periodic, ad_hoc, triggered
    review_status = Column(String(50), default="scheduled")  # scheduled, in_progress, completed, skipped

    scheduled_date = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    review_notes = Column(Text, nullable=True)
    changes_made = Column(Text, nullable=True)
    outcome = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    document = relationship("GovernanceDocument", backref="review_history")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])

    __table_args__ = (
        Index("ix_policy_review_tenant_doc", "tenant_id", "document_id"),
        Index("ix_policy_review_status", "tenant_id", "review_status"),
        Index("ix_policy_review_reviewer", "reviewer_id", "review_status"),
    )


class GovernanceActionReview(Base):
    """Tracks governance actions that require review (drafts, risk acceptance, evidence upload, committee actions, etc.)"""
    __tablename__ = "grc_governance_action_reviews"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    # Action details
    action_type = Column(String(100), nullable=False)  # document_draft_created, risk_accepted, evidence_uploaded, committee_action, etc.
    action_description = Column(Text, nullable=False)
    entity_type = Column(String(100), nullable=False)  # governance_document, risk, evidence, committee, etc.
    entity_id = Column(Integer, nullable=True)  # ID of the entity (document_id, risk_id, etc.)
    
    # Review status
    review_status = Column(String(50), default="pending_review")  # pending_review, in_review, approved, rejected, archived
    review_notes = Column(Text, nullable=True)
    
    # User information
    action_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)  # User who took the action
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)  # User reviewing the action
    
    # Timestamps
    action_date = Column(DateTime, default=datetime.utcnow, index=True)
    review_started_at = Column(DateTime, nullable=True)
    review_completed_at = Column(DateTime, nullable=True)
    
    # Additional context
    action_metadata = Column(JSON, nullable=True)  # Store additional data like tags, related entities, etc.
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    action_user = relationship("GRCUser", foreign_keys=[action_user_id], backref="governance_actions_taken")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id], backref="governance_actions_reviewed")

    __table_args__ = (
        Index("ix_gvn_action_tenant", "tenant_id"),
        Index("ix_gvn_action_status", "review_status"),
        Index("ix_gvn_action_type", "action_type"),
        Index("ix_gvn_action_user", "action_user_id"),
        Index("ix_gvn_action_date", "action_date"),
        Index("ix_gvn_action_entity", "entity_type", "entity_id"),
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
    published_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    review_cycle_months = Column(Integer, default=12)
    next_review_date = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="documents")
    owner = relationship("GRCUser", back_populates="owned_documents", foreign_keys=[owner_id])
    approver = relationship("GRCUser", back_populates="approved_documents", foreign_keys=[approved_by])
    publisher = relationship("GRCUser", foreign_keys=[published_by])
    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan")
    approval_workflows = relationship("DocumentApprovalWorkflow", back_populates="document", cascade="all, delete-orphan")
    attestations = relationship("DocumentAttestation", back_populates="document", cascade="all, delete-orphan")
    
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


class DocumentAttestation(Base):
    """Tracks user attestations/acknowledgments for legacy documents"""
    __tablename__ = "grc_document_attestations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    attestation_type = Column(String(50), default="acknowledgment")
    status = Column(String(50), default="pending")
    
    requested_at = Column(DateTime, default=datetime.utcnow)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    attestation_text = Column(Text, nullable=True)
    user_comments = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    document = relationship("Document", back_populates="attestations")
    user = relationship("GRCUser", foreign_keys=[user_id])
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    
    __table_args__ = (
        Index("ix_doc_attestation_tenant", "tenant_id"),
        Index("ix_doc_attestation_document", "document_id"),
        Index("ix_doc_attestation_user", "user_id"),
        Index("ix_doc_attestation_status", "status"),
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
    owner_name = Column(String(255), nullable=True)
    custodian = Column(String(255), nullable=True)
    host_name = Column(String(255), nullable=True)
    ip_address = Column(String(50), nullable=True)
    criticality = Column(String(50), default="medium")  # low, medium, high, critical
    confidentiality_rating = Column(Integer, nullable=True)
    integrity_rating = Column(Integer, nullable=True)
    availability_rating = Column(Integer, nullable=True)
    valuation = Column(Float, nullable=True)
    vendor = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    status = Column(String(50), default="active")  # active, inactive, decommissioned
    cde_environment = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant", back_populates="it_assets")
    owner = relationship("GRCUser", back_populates="owned_assets")
    control_links = relationship("AssetControlLink", back_populates="asset", cascade="all, delete-orphan")
    internal_control_links = relationship("AssetInternalControlLink", back_populates="asset", cascade="all, delete-orphan")
    risk_links = relationship("RiskAssetLink", back_populates="asset", cascade="all, delete-orphan")
    risk_assessments = relationship("AssetRiskAssessment", back_populates="asset", cascade="all, delete-orphan")
    framework_control_links = relationship("AssetFrameworkControlLink", back_populates="asset", cascade="all, delete-orphan")
    evidence_links = relationship("AssetEvidenceLink", back_populates="asset", cascade="all, delete-orphan")
    security_compliance_selections = relationship(
        "AssetSecurityComplianceSelection",
        back_populates="asset",
        cascade="all, delete-orphan",
    )
    
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


class AssetInternalControlLink(Base):
    """Links assets to ERM internal controls"""
    __tablename__ = "grc_asset_internal_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    coverage_status = Column(String(50), default="partial")
    
    asset = relationship("ITAsset", back_populates="internal_control_links")
    internal_control = relationship("InternalControl")
    
    __table_args__ = (
        UniqueConstraint("asset_id", "internal_control_id", name="uq_asset_internal_control"),
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


class AssetSecurityComplianceSelection(Base):
    """Stores selected security compliance controls for an asset."""
    __tablename__ = "grc_asset_security_compliance_selections"

    id = Column(Integer, primary_key=True, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    benchmark = Column(String(100), nullable=False, default="CIS_WS2012R2")
    control_id = Column(String(128), nullable=False)
    selected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    asset = relationship("ITAsset", back_populates="security_compliance_selections")
    selector = relationship("GRCUser")

    __table_args__ = (
        UniqueConstraint("asset_id", "benchmark", "control_id", name="uq_asset_security_compliance_selection"),
        Index("ix_asset_security_compliance_asset_benchmark", "asset_id", "benchmark"),
    )


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
    generated_phases = Column(JSON, nullable=True)
    phases_completion = Column(JSON, nullable=True)  # Tracks completion status of each phase: {1: true, 2: false, ...}
    
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
    
    upload_status = Column(String(50), default="uploaded")  # uploaded, classifying, classified, parsing, parsed, published, failed
    parse_error = Column(Text, nullable=True)
    parsed_at = Column(DateTime, nullable=True)
    published_framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    published_at = Column(DateTime, nullable=True)
    
    framework_type = Column(String(100), nullable=True)  # regulatory, industry_standard, internal
    source_organization = Column(String(255), nullable=True)
    version = Column(String(50), nullable=True)
    effective_date = Column(DateTime, nullable=True)
    
    # Framework Classification: certification vs compliance
    classification = Column(String(50), nullable=True)  # certification, compliance
    classification_confidence = Column(Float, nullable=True)  # AI confidence in classification
    classification_reasoning = Column(Text, nullable=True)  # AI explanation for classification
    
    # Pre-processing Overview (displayed before loading requirements)
    framework_purpose = Column(Text, nullable=True)  # What this framework aims to achieve
    framework_scope = Column(Text, nullable=True)  # Who/what it applies to
    framework_objectives = Column(JSON, nullable=True)  # List of key objectives
    target_audience = Column(Text, nullable=True)  # Who should implement this
    
    # Certification-specific fields (if classification = 'certification')
    certification_body = Column(String(255), nullable=True)  # e.g., PCI SSC, SWIFT
    certification_validity_period = Column(String(100), nullable=True)  # e.g., "3 years", "Annual"
    certification_levels = Column(JSON, nullable=True)  # Tier levels if applicable
    certification_lifecycle = Column(JSON, nullable=True)  # Phases: preparation, assessment, remediation, certification, maintenance
    required_artifacts = Column(JSON, nullable=True)  # Policies, procedures, controls, records, evidence expectations
    
    # Compliance-specific fields (if classification = 'compliance')
    regulatory_authority = Column(String(255), nullable=True)  # e.g., SAMA, SBP, EU Commission
    compliance_deadline = Column(DateTime, nullable=True)  # When compliance is required
    penalty_for_non_compliance = Column(Text, nullable=True)  # Consequences of non-compliance
    adoption_approach = Column(JSON, nullable=True)  # Recommended implementation steps
    
    # Control hierarchy preservation
    hierarchy_structure = Column(JSON, nullable=True)  # Preserves official numbering: {domains: [{id, name, sections: [{...}]}]}
    
    is_shared = Column(Boolean, default=False)  # Available to all tenants
    is_active = Column(Boolean, default=True)
    
    document_structure = Column(JSON, nullable=True)  # Extracted sections/chapters for phases
    
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    parsed_controls = relationship("ParsedFrameworkControl", back_populates="uploaded_framework", cascade="all, delete-orphan")
    assessments = relationship("FrameworkAssessment", back_populates="uploaded_framework", cascade="all, delete-orphan")
    evidence_requirements = relationship("ControlEvidenceRequirement", back_populates="framework", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_uploaded_framework_tenant", "tenant_id"),
        Index("ix_uploaded_framework_status", "upload_status"),
        Index("ix_uploaded_framework_classification", "classification"),
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


class ClauseApplicability(Base):
    """Tracks applicability decisions for framework clauses"""
    __tablename__ = "grc_clause_applicability"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)

    is_applicable = Column(Boolean, default=True)
    justification = Column(Text, nullable=True)
    status = Column(String(50), default="pending")  # pending, approved, rejected

    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    requested_at = Column(DateTime, nullable=True)
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comment = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    framework = relationship("UploadedFramework")
    control = relationship("ParsedFrameworkControl")
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])

    __table_args__ = (
        Index("ix_clause_applicability_framework", "uploaded_framework_id"),
        Index("ix_clause_applicability_control", "control_id"),
        Index("ix_clause_applicability_status", "tenant_id", "status"),
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


class ControlEvidenceRequirement(Base):
    """AI-generated evidence requirements for each control with multi-tier review workflow"""
    __tablename__ = "grc_control_evidence_requirements"
    
    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    
    # Evidence requirement details (AI-generated)
    evidence_title = Column(String(500), nullable=False)  # e.g., "Network Diagram Documentation"
    evidence_description = Column(Text, nullable=False)  # Detailed description of what evidence is needed
    evidence_type = Column(String(100), nullable=False)  # policy, procedure, configuration, screenshot, log, report, contract, attestation
    evidence_format = Column(String(100), nullable=True)  # PDF, screenshot, export, signed document, etc.
    
    # Specificity fields for exact evidence requirements
    exact_requirements = Column(JSON, nullable=True)  # List of specific items: ["firewall rules export", "change log", etc.]
    acceptance_criteria = Column(JSON, nullable=True)  # What makes this evidence acceptable
    sample_evidence = Column(Text, nullable=True)  # Description or link to sample/template
    collection_guidance = Column(Text, nullable=True)  # How to collect this evidence
    
    # Frequency and retention
    collection_frequency = Column(String(50), nullable=True)  # one-time, monthly, quarterly, annually, on-change
    retention_period = Column(String(100), nullable=True)  # e.g., "3 years", "7 years", "indefinitely"
    
    # AI metadata
    ai_confidence = Column(Float, nullable=True)  # Confidence in this requirement
    ai_reasoning = Column(Text, nullable=True)  # Why AI generated this requirement
    
    # Multi-tier review workflow: draft -> submitted -> pending_review -> approved/rejected
    status = Column(String(50), default="draft")  # draft, submitted, pending_review, approved, rejected
    
    # Draft phase
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)  # null if AI-generated
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Submit phase
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    submission_notes = Column(Text, nullable=True)
    
    # Review phase
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    # Approval phase
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_notes = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)  # If rejected
    
    # Priority and ordering
    priority = Column(String(20), default="medium")  # high, medium, low
    display_order = Column(Integer, default=0)
    
    is_mandatory = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    framework = relationship("UploadedFramework", back_populates="evidence_requirements")
    parsed_control = relationship("ParsedFrameworkControl", backref="control_evidence_requirements")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    submitter = relationship("GRCUser", foreign_keys=[submitted_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    
    __table_args__ = (
        Index("ix_evidence_req_framework", "framework_id"),
        Index("ix_evidence_req_control", "parsed_control_id"),
        Index("ix_evidence_req_status", "status"),
    )


class EvidenceRequirementHistory(Base):
    """Audit trail for evidence requirement workflow changes"""
    __tablename__ = "grc_evidence_requirement_history"
    
    id = Column(Integer, primary_key=True, index=True)
    evidence_requirement_id = Column(Integer, ForeignKey("grc_control_evidence_requirements.id"), nullable=False, index=True)
    
    action = Column(String(50), nullable=False)  # created, submitted, review_started, approved, rejected, edited
    previous_status = Column(String(50), nullable=True)
    new_status = Column(String(50), nullable=True)
    
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    performed_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)
    changes = Column(JSON, nullable=True)  # What fields changed
    
    performer = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_evidence_req_history_req", "evidence_requirement_id"),
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
    
    # Link to main Evidence table for unified evidence management
    linked_evidence_id = Column(Integer, ForeignKey("grc_evidence.id", ondelete="CASCADE"), nullable=True, index=True)
    
    evidence_type = Column(String(50), nullable=False)  # policy, procedure, configuration, log, report, contract
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    
    description = Column(Text, nullable=True)
    collection_date = Column(DateTime, nullable=True)
    
    review_status = Column(String(50), default="pending")  # pending, accepted, rejected, ai_assessed
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_item = relationship("AssessmentItem", back_populates="evidence_uploads")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])
    linked_evidence = relationship("Evidence", back_populates="assessment_evidence_links")
    
    __table_args__ = (
        Index("ix_assessment_evidence_item", "assessment_item_id"),
        Index("ix_assessment_evidence_linked", "linked_evidence_id"),
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
    versions = relationship("PolicyStatementVersion", back_populates="statement", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_policy_statement_tenant_doc", "tenant_id", "document_id"),
        Index("ix_policy_statement_category", "category"),
        Index("ix_policy_statement_status", "status"),
    )


class PolicyStatementVersion(Base):
    """Version history for policy statements"""
    __tablename__ = "grc_policy_statement_versions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=False, index=True)
    # Version numbering is zero-based: initial snapshot is version 0.
    version_number = Column(Integer, nullable=False, default=0)

    statement_text = Column(Text, nullable=False)
    statement_summary = Column(String(500), nullable=True)
    category = Column(String(100), nullable=True)
    sub_category = Column(String(100), nullable=True)
    priority = Column(String(20), default="medium")
    is_mandatory = Column(Boolean, default=True)
    source_section = Column(String(255), nullable=True)
    source_page = Column(Integer, nullable=True)
    ai_confidence = Column(Float, nullable=True)
    ai_extracted_keywords = Column(JSON, default=[])
    status = Column(String(50), default="active")

    change_type = Column(String(20), default="edit")
    change_reason = Column(Text, nullable=True)
    changed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    changed_at = Column(DateTime, default=datetime.utcnow)

    statement = relationship("PolicyStatement", back_populates="versions")
    changer = relationship("GRCUser", foreign_keys=[changed_by])

    __table_args__ = (
        Index("ix_policy_statement_version", "statement_id", "version_number"),
        Index("ix_policy_statement_version_tenant", "tenant_id", "statement_id"),
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
# 16. Policy Gap Analysis Models
# =============================================================================

class PolicyGapAnalysisRun(Base):
    """Tracks a gap analysis execution against a framework"""
    __tablename__ = "grc_policy_gap_analysis_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    framework_name = Column(String(255), nullable=True)

    status = Column(String(50), default="queued")  # queued, running, completed, failed
    run_type = Column(String(50), default="manual")  # manual, scheduled

    total_clauses_analyzed = Column(Integer, default=0)
    fully_compliant_count = Column(Integer, default=0)
    partially_compliant_count = Column(Integer, default=0)
    not_addressed_count = Column(Integer, default=0)
    not_applicable_count = Column(Integer, default=0)
    compliance_percentage = Column(Float, default=0.0)

    ai_model_used = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)

    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    document = relationship("GovernanceDocument")
    framework = relationship("UploadedFramework")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    findings = relationship("PolicyGapFinding", back_populates="analysis_run", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_gap_run_tenant_doc", "tenant_id", "document_id"),
        Index("ix_gap_run_status", "tenant_id", "status"),
        Index("ix_gap_run_framework", "uploaded_framework_id"),
    )


class PolicyGapFinding(Base):
    """Gap analysis finding for a specific framework clause"""
    __tablename__ = "grc_policy_gap_findings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    analysis_run_id = Column(Integer, ForeignKey("grc_policy_gap_analysis_runs.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    framework_name = Column(String(255), nullable=True)

    clause_reference = Column(String(255), nullable=True)
    clause_title = Column(String(500), nullable=True)
    clause_requirement_text = Column(Text, nullable=True)

    policy_section_reference = Column(String(255), nullable=True)
    policy_section_text = Column(Text, nullable=True)

    compliance_status = Column(String(50), default="not_addressed")  # fully_compliant, partially_compliant, not_addressed, not_applicable
    not_applicable_justification = Column(Text, nullable=True)
    gap_description = Column(Text, nullable=True)
    missing_requirement = Column(Text, nullable=True)
    remediation_recommendation = Column(Text, nullable=True)
    confidence_score = Column(Float, nullable=True)
    ai_reasoning = Column(Text, nullable=True)

    risk_severity = Column(String(50), default="medium")  # low, medium, high, critical
    impact_regulatory = Column(Boolean, default=False)
    impact_operational = Column(Boolean, default=False)
    impact_financial = Column(Boolean, default=False)
    impact_reputational = Column(Boolean, default=False)

    remediation_status = Column(String(50), default="open")  # open, in_progress, closed, accepted_risk
    assigned_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    target_remediation_date = Column(DateTime, nullable=True)
    actual_close_date = Column(DateTime, nullable=True)

    risk_accepted = Column(Boolean, default=False)
    risk_acceptance_justification = Column(Text, nullable=True)
    risk_acceptance_approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    risk_acceptance_approved_at = Column(DateTime, nullable=True)
    risk_acceptance_expiry_date = Column(DateTime, nullable=True)
    risk_register_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)  # Link to created risk in risk register

    evidence_ids = Column(JSON, default=[])
    evidence_notes = Column(Text, nullable=True)

    is_overridden = Column(Boolean, default=False)
    override_status = Column(String(50), nullable=True)
    override_justification = Column(Text, nullable=True)
    overridden_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    overridden_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    analysis_run = relationship("PolicyGapAnalysisRun", back_populates="findings")
    document = relationship("GovernanceDocument")
    framework = relationship("UploadedFramework")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])
    risk_acceptance_approver = relationship("GRCUser", foreign_keys=[risk_acceptance_approved_by])
    override_user = relationship("GRCUser", foreign_keys=[overridden_by])
    risk_register_entry = relationship("Risk", foreign_keys=[risk_register_id], uselist=False)

    __table_args__ = (
        Index("ix_gap_finding_doc", "tenant_id", "document_id"),
        Index("ix_gap_finding_run", "analysis_run_id"),
        Index("ix_gap_finding_status", "tenant_id", "compliance_status"),
        Index("ix_gap_finding_remediation", "tenant_id", "remediation_status"),
    )


class PolicyAttestation(Base):
    """Tracks user attestations/acknowledgments for policies and governance documents"""
    __tablename__ = "grc_policy_attestations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    # What is being attested
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    document_version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True, index=True)
    
    # Who is attesting
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    # Attestation details
    attestation_type = Column(String(50), default="acknowledgment")  # acknowledgment, compliance, training, review
    status = Column(String(50), default="pending")  # pending, completed, expired, revoked
    
    # Dates
    requested_at = Column(DateTime, default=datetime.utcnow)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    
    # Attestation content
    attestation_text = Column(Text, nullable=True)  # The statement they're agreeing to
    user_comments = Column(Text, nullable=True)  # Optional comments from the user
    ip_address = Column(String(50), nullable=True)  # For audit trail
    user_agent = Column(String(500), nullable=True)  # For audit trail
    
    # Recurrence
    is_recurring = Column(Boolean, default=False)
    recurrence_months = Column(Integer, nullable=True)  # How often attestation needs to be renewed
    parent_attestation_id = Column(Integer, ForeignKey("grc_policy_attestations.id"), nullable=True)  # For recurring attestations
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    tenant = relationship("Tenant")
    document = relationship("GovernanceDocument", backref="attestations")
    document_version = relationship("GovernanceDocumentVersion")
    user = relationship("GRCUser", foreign_keys=[user_id], backref="attestations")
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    parent_attestation = relationship("PolicyAttestation", remote_side=[id])
    
    __table_args__ = (
        Index("ix_attestation_tenant", "tenant_id"),
        Index("ix_attestation_document", "document_id"),
        Index("ix_attestation_user", "user_id"),
        Index("ix_attestation_status", "status"),
        Index("ix_attestation_due_date", "due_date"),
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
    
    source_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    source_statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=True, index=True)
    
    department = relationship("BusinessUnit", foreign_keys=[department_id])
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    backup_owner = relationship("GRCUser", foreign_keys=[backup_owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    source_document = relationship("GovernanceDocument", foreign_keys=[source_document_id])
    source_statement = relationship("PolicyStatement")
    
    tests = relationship("InternalControlTest", back_populates="control", cascade="all, delete-orphan")
    risk_links = relationship("InternalControlRiskLink", back_populates="control", cascade="all, delete-orphan")
    framework_links = relationship("InternalControlFrameworkLink", back_populates="internal_control", cascade="all, delete-orphan")
    escalations = relationship("InternalControlEscalation", back_populates="control", cascade="all, delete-orphan")
    workflow_actions = relationship("InternalControlWorkflowAction", back_populates="control", cascade="all, delete-orphan")
    evidence_links = relationship("InternalControlEvidence", back_populates="control", cascade="all, delete-orphan")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "control_id", name="uq_internal_control_tenant_id"),
        Index("ix_internal_control_tenant", "tenant_id"),
        Index("ix_internal_control_status", "status"),
        Index("ix_internal_control_department", "department_id"),
    )


class InternalControlEvidence(Base):
    """Evidence linked to an internal control"""
    __tablename__ = "grc_internal_control_evidence"

    id = Column(Integer, primary_key=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    linked_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    linked_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)

    control = relationship("InternalControl", back_populates="evidence_links")
    evidence = relationship("Evidence")
    linker = relationship("GRCUser", foreign_keys=[linked_by])

    __table_args__ = (
        UniqueConstraint("internal_control_id", "evidence_id", name="uq_ic_evidence_link"),
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
    notification_days = Column(Integer, nullable=True)  # Optional days before due date for reminders
    escalation_days = Column(Integer, nullable=True)  # Optional days after due date for escalations
    
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
# 20. RCSA (Risk and Control Self-Assessment) Models
# =============================================================================

class RCSATemplate(Base):
    """RCSA assessment templates - pre-built (SAMA, SBP, Basel) or user-uploaded"""
    __tablename__ = "grc_rcsa_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=False)  # operational_risk, it_cyber, compliance, credit, fraud, business_continuity, third_party
    source = Column(String(50), default="custom")  # sama, sbp, basel, custom
    version = Column(String(50), default="1.0")
    
    is_system_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    risk_categories = Column(JSON, default=[])  # List of risk categories covered
    regulatory_mapping = Column(JSON, default={})  # Maps to regulatory frameworks
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    questions = relationship("RCSAQuestion", back_populates="template", cascade="all, delete-orphan")
    campaigns = relationship("RCSACampaign", back_populates="template")
    
    __table_args__ = (
        Index("ix_rcsa_template_tenant", "tenant_id"),
        Index("ix_rcsa_template_source", "source"),
        Index("ix_rcsa_template_category", "category"),
    )


class RCSAQuestion(Base):
    """Questions within an RCSA template"""
    __tablename__ = "grc_rcsa_questions"
    
    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_rcsa_templates.id"), nullable=False, index=True)
    
    section = Column(String(255), nullable=True)  # Section grouping
    question_order = Column(Integer, default=0)
    question_text = Column(Text, nullable=False)
    question_type = Column(String(50), default="risk_rating")  # risk_rating, control_rating, text, yes_no, multiple_choice, scale
    
    is_required = Column(Boolean, default=True)
    options = Column(JSON, default=[])  # For multiple choice questions
    
    risk_category = Column(String(100), nullable=True)  # Basel category mapping
    control_objective = Column(String(255), nullable=True)
    guidance_text = Column(Text, nullable=True)  # Help text for assessors
    
    ai_suggestion_enabled = Column(Boolean, default=True)  # Whether AI can suggest answers
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    template = relationship("RCSATemplate", back_populates="questions")
    responses = relationship("RCSAResponse", back_populates="question", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_rcsa_question_template", "template_id"),
        Index("ix_rcsa_question_order", "template_id", "question_order"),
    )


class RCSACampaign(Base):
    """RCSA assessment campaigns - periodic assessment cycles"""
    __tablename__ = "grc_rcsa_campaigns"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("grc_rcsa_templates.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    period_type = Column(String(50), default="quarterly")  # quarterly, semi_annual, annual, adhoc
    period_label = Column(String(100), nullable=True)  # e.g., "Q1 2026", "H1 2026"
    
    start_date = Column(DateTime, nullable=False)
    due_date = Column(DateTime, nullable=False)
    
    status = Column(String(50), default="draft")  # draft, active, closed, cancelled
    
    approval_workflow_id = Column(Integer, ForeignKey("grc_rcsa_approval_workflows.id"), nullable=True, index=True)
    
    reminder_days_before = Column(Integer, default=7)
    escalation_days_after = Column(Integer, default=3)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    template = relationship("RCSATemplate", back_populates="campaigns")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approval_workflow = relationship("RCSAApprovalWorkflow")
    assessments = relationship("RCSAAssessment", back_populates="campaign", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_rcsa_campaign_tenant", "tenant_id"),
        Index("ix_rcsa_campaign_status", "status"),
        Index("ix_rcsa_campaign_dates", "start_date", "due_date"),
    )


class RCSAAssessment(Base):
    """Individual assessment for a business unit within a campaign"""
    __tablename__ = "grc_rcsa_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("grc_rcsa_campaigns.id"), nullable=False, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=False, index=True)
    
    status = Column(String(50), default="not_started")  # not_started, in_progress, submitted, under_review, approved, rejected, requires_changes
    current_approval_tier = Column(Integer, default=0)  # Which tier is currently reviewing (0 = not submitted yet)
    
    assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assigned_at = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    overall_risk_score = Column(Float, nullable=True)  # Calculated aggregate risk score
    overall_control_score = Column(Float, nullable=True)  # Calculated aggregate control effectiveness
    ai_quality_score = Column(Integer, nullable=True)  # AI assessment of response quality (0-100)
    
    ai_suggestions_used = Column(Integer, default=0)  # Count of AI suggestions accepted
    ai_gaps_identified = Column(Integer, default=0)  # Count of AI-detected gaps
    
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    campaign = relationship("RCSACampaign", back_populates="assessments")
    business_unit = relationship("BusinessUnit")
    assessor = relationship("GRCUser", foreign_keys=[assessor_id])
    responses = relationship("RCSAResponse", back_populates="assessment", cascade="all, delete-orphan")
    findings = relationship("RCSAFinding", back_populates="assessment", cascade="all, delete-orphan")
    approval_history = relationship("RCSAApprovalHistory", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_rcsa_assessment_tenant", "tenant_id"),
        Index("ix_rcsa_assessment_campaign", "campaign_id"),
        Index("ix_rcsa_assessment_bu", "business_unit_id"),
        Index("ix_rcsa_assessment_status", "status"),
        UniqueConstraint("campaign_id", "business_unit_id", name="uq_rcsa_campaign_bu"),
    )


class RCSAResponse(Base):
    """Individual responses to RCSA questions"""
    __tablename__ = "grc_rcsa_responses"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_rcsa_assessments.id"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("grc_rcsa_questions.id"), nullable=False, index=True)
    
    response_value = Column(Text, nullable=True)  # The actual response
    
    # For risk rating questions
    likelihood_rating = Column(Integer, nullable=True)  # 1-5
    impact_rating = Column(Integer, nullable=True)  # 1-5
    risk_score = Column(Float, nullable=True)  # Calculated: likelihood * impact
    
    # For control rating questions
    control_effectiveness = Column(String(50), nullable=True)  # effective, partially_effective, ineffective, not_applicable
    control_description = Column(Text, nullable=True)
    last_tested_date = Column(DateTime, nullable=True)
    
    # AI assistance
    ai_suggestion = Column(Text, nullable=True)  # AI-generated suggestion
    ai_suggestion_accepted = Column(Boolean, default=False)
    ai_gap_detected = Column(Boolean, default=False)
    ai_gap_description = Column(Text, nullable=True)
    
    responded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    responded_at = Column(DateTime, nullable=True)
    
    assessment = relationship("RCSAAssessment", back_populates="responses")
    question = relationship("RCSAQuestion", back_populates="responses")
    responder = relationship("GRCUser", foreign_keys=[responded_by])
    
    __table_args__ = (
        Index("ix_rcsa_response_assessment", "assessment_id"),
        Index("ix_rcsa_response_question", "question_id"),
        UniqueConstraint("assessment_id", "question_id", name="uq_rcsa_assessment_question"),
    )


class RCSAResponseEvidence(Base):
    """Link table between RCSA responses and evidence"""
    __tablename__ = "grc_rcsa_response_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    response_id = Column(Integer, ForeignKey("grc_rcsa_responses.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    response = relationship("RCSAResponse", backref="evidence_links")
    evidence = relationship("Evidence")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    
    __table_args__ = (
        UniqueConstraint("response_id", "evidence_id", name="uq_rcsa_response_evidence"),
    )


class RCSAFinding(Base):
    """Findings/gaps identified during RCSA assessments"""
    __tablename__ = "grc_rcsa_findings"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_rcsa_assessments.id"), nullable=False, index=True)
    
    finding_type = Column(String(50), nullable=False)  # risk_identified, control_gap, control_weakness, process_issue
    severity = Column(String(50), default="medium")  # critical, high, medium, low
    
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    risk_category = Column(String(100), nullable=True)  # Basel operational risk category
    affected_controls = Column(JSON, default=[])  # List of affected control IDs
    
    ai_generated = Column(Boolean, default=False)  # Whether AI identified this finding
    ai_recommendation = Column(Text, nullable=True)  # AI remediation suggestion
    
    # Integration with other modules
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    linked_internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True, index=True)
    linked_mitigation_action_id = Column(Integer, ForeignKey("grc_risk_mitigation_actions.id"), nullable=True, index=True)
    
    status = Column(String(50), default="open")  # open, in_progress, remediated, accepted, closed
    remediation_due_date = Column(DateTime, nullable=True)
    remediation_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant")
    assessment = relationship("RCSAAssessment", back_populates="findings")
    linked_risk = relationship("Risk")
    linked_internal_control = relationship("InternalControl")
    linked_mitigation_action = relationship("RiskMitigationAction")
    remediation_owner = relationship("GRCUser", foreign_keys=[remediation_owner_id])
    
    __table_args__ = (
        Index("ix_rcsa_finding_tenant", "tenant_id"),
        Index("ix_rcsa_finding_assessment", "assessment_id"),
        Index("ix_rcsa_finding_status", "status"),
        Index("ix_rcsa_finding_severity", "severity"),
    )


class RCSAApprovalWorkflow(Base):
    """Multi-tier approval workflow configuration"""
    __tablename__ = "grc_rcsa_approval_workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    tiers = relationship("RCSAApprovalTier", back_populates="workflow", cascade="all, delete-orphan", order_by="RCSAApprovalTier.tier_order")
    
    __table_args__ = (
        Index("ix_rcsa_approval_workflow_tenant", "tenant_id"),
    )


class RCSAApprovalTier(Base):
    """Individual approval tiers within a workflow"""
    __tablename__ = "grc_rcsa_approval_tiers"
    
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("grc_rcsa_approval_workflows.id"), nullable=False, index=True)
    
    tier_order = Column(Integer, nullable=False)  # 1, 2, 3, etc.
    tier_name = Column(String(100), nullable=False)  # e.g., "Line Manager", "Risk Officer", "Risk Committee"
    
    approver_type = Column(String(50), nullable=False)  # role, user, bu_manager, dynamic
    approver_role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=True, index=True)
    approver_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    can_delegate = Column(Boolean, default=True)
    auto_approve_days = Column(Integer, nullable=True)  # Auto-approve after X days if no action
    
    workflow = relationship("RCSAApprovalWorkflow", back_populates="tiers")
    approver_role = relationship("Role")
    approver_user = relationship("GRCUser", foreign_keys=[approver_user_id])
    
    __table_args__ = (
        Index("ix_rcsa_approval_tier_workflow", "workflow_id"),
        UniqueConstraint("workflow_id", "tier_order", name="uq_rcsa_workflow_tier_order"),
    )


class RCSAApprovalHistory(Base):
    """Audit trail of approval actions"""
    __tablename__ = "grc_rcsa_approval_history"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_rcsa_assessments.id"), nullable=False, index=True)
    tier_id = Column(Integer, ForeignKey("grc_rcsa_approval_tiers.id"), nullable=True, index=True)
    
    action = Column(String(50), nullable=False)  # submitted, approved, rejected, returned, delegated
    tier_number = Column(Integer, nullable=False)
    
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    delegated_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    comments = Column(Text, nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    
    assessment = relationship("RCSAAssessment", back_populates="approval_history")
    tier = relationship("RCSAApprovalTier")
    performer = relationship("GRCUser", foreign_keys=[performed_by])
    delegate = relationship("GRCUser", foreign_keys=[delegated_to])
    
    __table_args__ = (
        Index("ix_rcsa_approval_history_assessment", "assessment_id"),
        Index("ix_rcsa_approval_history_action", "action"),
        Index("ix_rcsa_approval_history_performed", "performed_at"),
    )


# =============================================================================
# 16. Attestation & Certification Management Models
# =============================================================================

class AttestationCampaign(Base):
    """Campaign for organizing attestations (SOX 302/404, policy sign-offs, BCP/DR awareness)"""
    __tablename__ = "grc_attestation_campaigns"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    campaign_type = Column(String(50), nullable=False)  # sox_302, sox_404, policy_signoff, bcp_awareness, training_acknowledgment, annual_certification
    start_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=False)
    status = Column(String(50), default="draft")  # draft, active, closed, archived
    
    target_type = Column(String(50), nullable=False, default="all_users")  # all_users, by_department, by_role, custom
    target_department_ids = Column(JSON, default=[])
    target_role_ids = Column(JSON, default=[])
    target_user_ids = Column(JSON, default=[])
    
    escalation_enabled = Column(Boolean, default=True)
    reminder_days_before = Column(Integer, default=7)
    escalation_days_after = Column(Integer, default=3)
    
    attestation_text = Column(Text, nullable=True)
    requires_evidence = Column(Boolean, default=False)
    
    linked_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_document = relationship("GovernanceDocument")
    escalation_chains = relationship("EscalationChain", back_populates="campaign", cascade="all, delete-orphan")
    attestation_requests = relationship("AttestationRequest", back_populates="campaign", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_attestation_campaign_tenant", "tenant_id"),
        Index("ix_attestation_campaign_status", "status"),
        Index("ix_attestation_campaign_type", "campaign_type"),
        Index("ix_attestation_campaign_due_date", "due_date"),
    )


class EscalationChain(Base):
    """Defines cascade hierarchy for attestation escalations"""
    __tablename__ = "grc_escalation_chains"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("grc_attestation_campaigns.id"), nullable=False, index=True)
    
    tier = Column(Integer, nullable=False)  # 1=staff, 2=manager, 3=vp, 4=cro
    tier_name = Column(String(100), nullable=True)  # Optional descriptive name
    
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=True, index=True)
    
    escalation_delay_days = Column(Integer, default=3)
    notify_on_escalation = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    campaign = relationship("AttestationCampaign", back_populates="escalation_chains")
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    business_unit = relationship("BusinessUnit")
    role = relationship("Role")
    
    __table_args__ = (
        Index("ix_escalation_chain_tenant", "tenant_id"),
        Index("ix_escalation_chain_campaign", "campaign_id"),
        Index("ix_escalation_chain_tier", "campaign_id", "tier"),
        UniqueConstraint("campaign_id", "tier", "business_unit_id", name="uq_escalation_campaign_tier_bu"),
    )


class AttestationRequest(Base):
    """Individual attestation assignments to users"""
    __tablename__ = "grc_attestation_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("grc_attestation_campaigns.id"), nullable=False, index=True)
    
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    attestation_type = Column(String(50), nullable=False)  # Same as campaign_type or more specific
    
    status = Column(String(50), default="pending")  # pending, completed, overdue, escalated
    
    assigned_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    
    escalation_tier = Column(Integer, default=1)
    escalated_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    reminder_sent_at = Column(DateTime, nullable=True)
    reminder_count = Column(Integer, default=0)
    escalation_sent_at = Column(DateTime, nullable=True)
    
    user_comments = Column(Text, nullable=True)
    attestation_text = Column(Text, nullable=True)
    
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)
    
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    campaign = relationship("AttestationCampaign", back_populates="attestation_requests")
    user = relationship("GRCUser", foreign_keys=[user_id])
    escalated_to = relationship("GRCUser", foreign_keys=[escalated_to_id])
    evidence = relationship("Evidence")
    
    __table_args__ = (
        Index("ix_attestation_request_tenant", "tenant_id"),
        Index("ix_attestation_request_campaign", "campaign_id"),
        Index("ix_attestation_request_user", "user_id"),
        Index("ix_attestation_request_status", "status"),
        Index("ix_attestation_request_due_date", "due_date"),
        UniqueConstraint("campaign_id", "user_id", name="uq_attestation_campaign_user"),
    )


# =============================================================================
# 17. Regulatory Change Management Models
# =============================================================================

class RegulatoryChange(Base):
    """Register for tracking new regulations and regulatory changes"""
    __tablename__ = "grc_regulatory_changes"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    source = Column(String(50), nullable=False)  # OCC, Fed, EBA, PRA, SEC, FINRA, custom
    regulation_reference = Column(String(255), nullable=True)  # e.g., "12 CFR 30.5"
    
    effective_date = Column(DateTime, nullable=True)
    published_date = Column(DateTime, nullable=True)
    
    status = Column(String(50), default="identified")  # identified, under_assessment, implementation, completed, not_applicable
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    closer = relationship("GRCUser", foreign_keys=[closed_by])
    impact_assessments = relationship("RegulatoryImpactAssessment", back_populates="regulatory_change", cascade="all, delete-orphan")
    implementation_tasks = relationship("RegulatoryImplementationTask", back_populates="regulatory_change", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_regulatory_change_tenant", "tenant_id"),
        Index("ix_regulatory_change_status", "status"),
        Index("ix_regulatory_change_priority", "priority"),
        Index("ix_regulatory_change_source", "source"),
        Index("ix_regulatory_change_effective_date", "effective_date"),
    )


class RegulatoryImpactAssessment(Base):
    """Impact analysis for regulatory changes"""
    __tablename__ = "grc_regulatory_impact_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    
    assessment_type = Column(String(50), nullable=False)  # policy, control, process, technology
    impacted_item_id = Column(Integer, nullable=True)  # polymorphic - could be policy_id, control_id, etc.
    impacted_item_type = Column(String(50), nullable=True)  # policy, control, asset, process
    
    impact_level = Column(String(20), default="medium")  # high, medium, low, none
    impact_description = Column(Text, nullable=True)
    
    gap_identified = Column(Boolean, default=False)
    gap_description = Column(Text, nullable=True)
    
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assessed_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    regulatory_change = relationship("RegulatoryChange", back_populates="impact_assessments")
    assessor = relationship("GRCUser", foreign_keys=[assessed_by])
    implementation_tasks = relationship("RegulatoryImplementationTask", back_populates="impact_assessment")
    
    __table_args__ = (
        Index("ix_regulatory_impact_tenant", "tenant_id"),
        Index("ix_regulatory_impact_change", "regulatory_change_id"),
        Index("ix_regulatory_impact_type", "assessment_type"),
        Index("ix_regulatory_impact_level", "impact_level"),
    )


class RegulatoryImplementationTask(Base):
    """Tasks for implementing regulatory changes"""
    __tablename__ = "grc_regulatory_implementation_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    impact_assessment_id = Column(Integer, ForeignKey("grc_regulatory_impact_assessments.id"), nullable=True, index=True)
    
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    task_type = Column(String(50), nullable=False)  # policy_update, control_update, process_change, training, communication
    status = Column(String(50), default="pending")  # pending, in_progress, completed, blocked
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    linked_policy_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    regulatory_change = relationship("RegulatoryChange", back_populates="implementation_tasks")
    impact_assessment = relationship("RegulatoryImpactAssessment", back_populates="implementation_tasks")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_policy = relationship("GovernanceDocument")
    linked_control = relationship("NormalizedControl")
    
    __table_args__ = (
        Index("ix_regulatory_task_tenant", "tenant_id"),
        Index("ix_regulatory_task_change", "regulatory_change_id"),
        Index("ix_regulatory_task_status", "status"),
        Index("ix_regulatory_task_due_date", "due_date"),
        Index("ix_regulatory_task_type", "task_type"),
    )


# =============================================================================
# Board & Committee Management Models
# =============================================================================

class GovernanceCommittee(Base):
    """Committee setup for governance oversight"""
    __tablename__ = "grc_governance_committees"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    committee_type = Column(String(50), nullable=False)  # board, risk_committee, audit_committee, compliance_committee, it_steering, custom
    chair_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    secretary_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    meeting_frequency = Column(String(50), default="quarterly")  # monthly, quarterly, annual, ad_hoc
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    chair = relationship("GRCUser", foreign_keys=[chair_id])
    secretary = relationship("GRCUser", foreign_keys=[secretary_id])
    members = relationship("CommitteeMember", back_populates="committee", cascade="all, delete-orphan")
    charters = relationship("CommitteeCharter", back_populates="committee", cascade="all, delete-orphan")
    meetings = relationship("CommitteeMeeting", back_populates="committee", cascade="all, delete-orphan")
    oversight_actions = relationship("OversightAction", back_populates="committee", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_governance_committee_tenant", "tenant_id"),
        Index("ix_governance_committee_type", "committee_type"),
        Index("ix_governance_committee_active", "is_active"),
    )


class CommitteeMember(Base):
    """Committee membership records"""
    __tablename__ = "grc_committee_members"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role = Column(String(50), default="member")  # chair, secretary, member, observer
    joined_at = Column(DateTime, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="members")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_committee_member_tenant", "tenant_id"),
        Index("ix_committee_member_committee", "committee_id"),
        Index("ix_committee_member_user", "user_id"),
        Index("ix_committee_member_active", "is_active"),
        UniqueConstraint("committee_id", "user_id", name="uq_committee_member_user"),
    )


class CommitteeCharter(Base):
    """Charter documents for committees"""
    __tablename__ = "grc_committee_charters"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    version = Column(String(50), default="1.0")
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft, active, expired
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    file_path = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_type = Column(String(50), nullable=True)
    file_size = Column(Integer, nullable=True)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="charters")
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    
    __table_args__ = (
        Index("ix_committee_charter_tenant", "tenant_id"),
        Index("ix_committee_charter_committee", "committee_id"),
        Index("ix_committee_charter_status", "status"),
    )


class CommitteeMeeting(Base):
    """Meeting management for committees"""
    __tablename__ = "grc_committee_meetings"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    meeting_number = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    meeting_type = Column(String(50), default="regular")  # regular, special, emergency
    scheduled_date = Column(DateTime, nullable=False)
    location = Column(String(500), nullable=True)
    virtual_link = Column(String(1000), nullable=True)
    status = Column(String(50), default="scheduled")  # scheduled, in_progress, completed, cancelled
    quorum_required = Column(Integer, nullable=True)
    quorum_present = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="meetings")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    agenda_items = relationship("MeetingAgendaItem", back_populates="meeting", cascade="all, delete-orphan")
    minutes = relationship("MeetingMinutes", back_populates="meeting", uselist=False, cascade="all, delete-orphan")
    oversight_actions = relationship("OversightAction", back_populates="meeting")
    
    __table_args__ = (
        Index("ix_committee_meeting_tenant", "tenant_id"),
        Index("ix_committee_meeting_committee", "committee_id"),
        Index("ix_committee_meeting_status", "status"),
        Index("ix_committee_meeting_date", "scheduled_date"),
    )


class MeetingAgendaItem(Base):
    """Agenda items for meetings"""
    __tablename__ = "grc_meeting_agenda_items"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=False, index=True)
    item_number = Column(Integer, nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    item_type = Column(String(50), default="discussion")  # approval, discussion, information, action_review
    presenter_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    linked_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    linked_regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=True, index=True)
    time_allocated_minutes = Column(Integer, nullable=True)
    status = Column(String(50), default="pending")  # pending, discussed, deferred
    outcome = Column(Text, nullable=True)
    decision_made = Column(Text, nullable=True)
    
    tenant = relationship("Tenant")
    meeting = relationship("CommitteeMeeting", back_populates="agenda_items")
    presenter = relationship("GRCUser")
    linked_document = relationship("GovernanceDocument")
    linked_risk = relationship("Risk")
    linked_regulatory_change = relationship("RegulatoryChange")
    oversight_actions = relationship("OversightAction", back_populates="agenda_item")
    
    __table_args__ = (
        Index("ix_meeting_agenda_tenant", "tenant_id"),
        Index("ix_meeting_agenda_meeting", "meeting_id"),
        Index("ix_meeting_agenda_status", "status"),
    )


class MeetingMinutes(Base):
    """Minutes record for meetings"""
    __tablename__ = "grc_meeting_minutes"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=False, unique=True, index=True)
    content = Column(Text, nullable=True)
    attendees = Column(JSON, default=[])
    status = Column(String(50), default="draft")  # draft, pending_approval, approved
    drafted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    drafted_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant")
    meeting = relationship("CommitteeMeeting", back_populates="minutes")
    drafter = relationship("GRCUser", foreign_keys=[drafted_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    
    __table_args__ = (
        Index("ix_meeting_minutes_tenant", "tenant_id"),
        Index("ix_meeting_minutes_status", "status"),
    )


class OversightAction(Base):
    """Action tracking for oversight activities"""
    __tablename__ = "grc_oversight_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=True, index=True)
    agenda_item_id = Column(Integer, ForeignKey("grc_meeting_agenda_items.id"), nullable=True, index=True)
    action_number = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    action_type = Column(String(50), default="follow_up")  # follow_up, policy_approval, risk_review, audit_response
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="open")  # open, in_progress, completed, overdue
    completed_at = Column(DateTime, nullable=True)
    completion_notes = Column(Text, nullable=True)
    linked_policy_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="oversight_actions")
    meeting = relationship("CommitteeMeeting", back_populates="oversight_actions")
    agenda_item = relationship("MeetingAgendaItem", back_populates="oversight_actions")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_policy = relationship("GovernanceDocument")
    linked_risk = relationship("Risk")
    
    __table_args__ = (
        Index("ix_oversight_action_tenant", "tenant_id"),
        Index("ix_oversight_action_committee", "committee_id"),
        Index("ix_oversight_action_meeting", "meeting_id"),
        Index("ix_oversight_action_status", "status"),
        Index("ix_oversight_action_due_date", "due_date"),
        Index("ix_oversight_action_assigned", "assigned_to"),
    )


# =============================================================================
# 24. Compliance Assessment Documents Models
# =============================================================================

class ComplianceAssessmentDocument(Base):
    """Stores uploaded assessment documents (gap assessments, security checklists, audits)"""
    __tablename__ = "grc_compliance_assessment_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(500), nullable=False)
    assessment_type = Column(String(100), nullable=False)  # gap_assessment, security_checklist, internal_audit
    source = Column(String(255), nullable=True)  # SBP, Internal, External Auditor
    file_name = Column(String(500), nullable=True)
    file_path = Column(String(1000), nullable=True)
    upload_date = Column(DateTime, default=datetime.utcnow)
    status = Column(String(50), default="draft")  # draft, in_progress, completed
    due_date = Column(DateTime, nullable=True)
    assessor = Column(String(255), nullable=True)
    overall_score = Column(Float, nullable=True)
    total_items = Column(Integer, default=0)
    complied_count = Column(Integer, default=0)
    partially_complied_count = Column(Integer, default=0)
    not_complied_count = Column(Integer, default=0)
    in_progress_count = Column(Integer, default=0)
    na_count = Column(Integer, default=0)
    notes = Column(Text, nullable=True)
    assessment_format = Column(String(50), default="standard")  # standard, xlsx_maturity
    xlsx_data = Column(JSON, nullable=True)  # Parsed multi-sheet data for maturity tool uploads
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant", back_populates="compliance_assessment_docs")
    creator = relationship("GRCUser")
    items = relationship("ComplianceAssessmentDocumentItem", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_assessment_doc_tenant", "tenant_id"),
        Index("ix_compliance_assessment_doc_type", "assessment_type"),
        Index("ix_compliance_assessment_doc_status", "status"),
        Index("ix_compliance_assessment_doc_source", "source"),
    )


class ComplianceAssessmentDocumentItem(Base):
    """Individual control/question items within an assessment document"""
    __tablename__ = "grc_compliance_assessment_document_items"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_compliance_assessment_documents.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    item_number = Column(String(50), nullable=True)
    area_domain = Column(String(500), nullable=True)
    control_description = Column(Text, nullable=True)
    compliance_status = Column(String(50), default="in_progress")  # complied, partially_complied, not_complied, in_progress, na
    gaps_identified = Column(Text, nullable=True)
    proposed_solution = Column(Text, nullable=True)
    responsible_party = Column(String(255), nullable=True)
    timeline = Column(String(255), nullable=True)
    priority = Column(String(50), nullable=True)  # critical, high, medium, low
    evidence_reference = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    ai_evidence_recommendation = Column(Text, nullable=True)
    ai_recommendation_generated_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    assessment = relationship("ComplianceAssessmentDocument", back_populates="items")
    tenant = relationship("Tenant")
    evidence_uploads = relationship("AssessmentItemEvidence", back_populates="assessment_item", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_assessment_doc_item_assessment", "assessment_id"),
        Index("ix_compliance_assessment_doc_item_tenant", "tenant_id"),
        Index("ix_compliance_assessment_doc_item_status", "compliance_status"),
        Index("ix_compliance_assessment_doc_item_priority", "priority"),
    )


# =============================================================================
# Assessment Evidence Approval Workflow Models
# =============================================================================

class AssessmentEvidenceApprovalWorkflow(Base):
    """Workflow configuration for assessment evidence approval"""
    __tablename__ = "grc_assessment_evidence_approval_workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    tiers = relationship("AssessmentEvidenceApprovalTier", back_populates="workflow", cascade="all, delete-orphan")
    evidence_items = relationship("AssessmentItemEvidence", back_populates="workflow")
    
    __table_args__ = (
        Index("ix_assessment_evidence_workflow_tenant", "tenant_id"),
        Index("ix_assessment_evidence_workflow_default", "tenant_id", "is_default"),
        Index("ix_assessment_evidence_workflow_active", "tenant_id", "is_active"),
    )


class AssessmentEvidenceApprovalTier(Base):
    """Individual approval tiers within a workflow"""
    __tablename__ = "grc_assessment_evidence_approval_tiers"
    
    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(Integer, ForeignKey("grc_assessment_evidence_approval_workflows.id"), nullable=False, index=True)
    tier_order = Column(Integer, nullable=False)
    tier_name = Column(String(100), nullable=False)
    approver_type = Column(String(50), nullable=False)  # role, user
    approver_role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=True, index=True)
    approver_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    can_delegate = Column(Boolean, default=True)
    auto_approve_days = Column(Integer, nullable=True)
    
    workflow = relationship("AssessmentEvidenceApprovalWorkflow", back_populates="tiers")
    approver_role = relationship("Role")
    approver_user = relationship("GRCUser")
    approval_history = relationship("AssessmentEvidenceApprovalHistory", back_populates="tier")
    
    __table_args__ = (
        Index("ix_assessment_evidence_tier_workflow", "workflow_id"),
        Index("ix_assessment_evidence_tier_order", "workflow_id", "tier_order"),
        Index("ix_assessment_evidence_tier_role", "approver_role_id"),
        Index("ix_assessment_evidence_tier_user", "approver_user_id"),
    )


class AssessmentItemEvidence(Base):
    """Links assessment items to evidence with approval workflow status"""
    __tablename__ = "grc_assessment_item_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_item_id = Column(Integer, ForeignKey("grc_compliance_assessment_document_items.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_id = Column(Integer, ForeignKey("grc_assessment_evidence_approval_workflows.id"), nullable=True, index=True)
    current_tier = Column(Integer, default=0)
    status = Column(String(50), default="draft")  # draft, pending_review, in_approval, approved, rejected
    ai_recommendation = Column(Text, nullable=True)
    ai_recommendation_generated_at = Column(DateTime, nullable=True)
    submitted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    assessment_item = relationship("ComplianceAssessmentDocumentItem", back_populates="evidence_uploads")
    evidence = relationship("Evidence")
    tenant = relationship("Tenant")
    workflow = relationship("AssessmentEvidenceApprovalWorkflow", back_populates="evidence_items")
    submitter = relationship("GRCUser", foreign_keys=[submitted_by])
    approval_history = relationship("AssessmentEvidenceApprovalHistory", back_populates="assessment_item_evidence", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_assessment_item_evidence_item", "assessment_item_id"),
        Index("ix_assessment_item_evidence_evidence", "evidence_id"),
        Index("ix_assessment_item_evidence_tenant", "tenant_id"),
        Index("ix_assessment_item_evidence_workflow", "workflow_id"),
        Index("ix_assessment_item_evidence_status", "tenant_id", "status"),
        Index("ix_assessment_item_evidence_tier", "workflow_id", "current_tier"),
    )


class AssessmentEvidenceApprovalHistory(Base):
    """Audit trail for assessment evidence approvals"""
    __tablename__ = "grc_assessment_evidence_approval_history"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_item_evidence_id = Column(Integer, ForeignKey("grc_assessment_item_evidence.id"), nullable=False, index=True)
    tier_id = Column(Integer, ForeignKey("grc_assessment_evidence_approval_tiers.id"), nullable=True, index=True)
    action = Column(String(50), nullable=False)  # submitted, approved, rejected, returned, delegated
    tier_number = Column(Integer, nullable=False)
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    delegated_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    comments = Column(Text, nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_item_evidence = relationship("AssessmentItemEvidence", back_populates="approval_history")
    tier = relationship("AssessmentEvidenceApprovalTier", back_populates="approval_history")
    performer = relationship("GRCUser", foreign_keys=[performed_by])
    delegate = relationship("GRCUser", foreign_keys=[delegated_to])
    
    __table_args__ = (
        Index("ix_assessment_evidence_history_item", "assessment_item_evidence_id"),
        Index("ix_assessment_evidence_history_tier", "tier_id"),
        Index("ix_assessment_evidence_history_action", "action"),
        Index("ix_assessment_evidence_history_performer", "performed_by"),
        Index("ix_assessment_evidence_history_date", "performed_at"),
    )


# =============================================================================
# 24. RSS Feed Ingestion for Regulatory Changes
# =============================================================================

class RegulatoryFeedSource(Base):
    """RSS/Atom feed sources for regulatory updates"""
    __tablename__ = "grc_regulatory_feed_sources"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    source_url = Column(String(1000), nullable=False)
    source_type = Column(String(50), default="rss")  # rss, atom, api
    country = Column(String(100), nullable=True)
    regulator = Column(String(255), nullable=True)
    category = Column(String(100), nullable=True)  # notices, monetary_policy, etc.
    is_active = Column(Boolean, default=True)
    poll_interval_hours = Column(Integer, default=24)
    last_polled_at = Column(DateTime, nullable=True)
    last_successful_poll = Column(DateTime, nullable=True)
    items_processed = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    feed_items = relationship("RegulatoryFeedItem", back_populates="feed_source", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_regulatory_feed_source_tenant", "tenant_id"),
        Index("ix_regulatory_feed_source_active", "tenant_id", "is_active"),
        Index("ix_regulatory_feed_source_type", "source_type"),
        Index("ix_regulatory_feed_source_country", "country"),
        Index("ix_regulatory_feed_source_regulator", "regulator"),
    )


class RegulatoryFeedItem(Base):
    """Individual items ingested from regulatory RSS feeds"""
    __tablename__ = "grc_regulatory_feed_items"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    feed_source_id = Column(Integer, ForeignKey("grc_regulatory_feed_sources.id"), nullable=False, index=True)
    guid = Column(String(500), nullable=False)
    title = Column(String(1000), nullable=False)
    description = Column(Text, nullable=True)
    link = Column(String(1000), nullable=True)
    published_date = Column(DateTime, nullable=True)
    content = Column(Text, nullable=True)
    status = Column(String(50), default="new")  # new, processed, ignored, error
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=True, index=True)
    processed_at = Column(DateTime, nullable=True)
    ai_analysis = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    feed_source = relationship("RegulatoryFeedSource", back_populates="feed_items")
    regulatory_change = relationship("RegulatoryChange")
    
    __table_args__ = (
        Index("ix_regulatory_feed_item_tenant", "tenant_id"),
        Index("ix_regulatory_feed_item_source", "feed_source_id"),
        Index("ix_regulatory_feed_item_status", "tenant_id", "status"),
        Index("ix_regulatory_feed_item_guid", "feed_source_id", "guid"),
        Index("ix_regulatory_feed_item_regulatory_change", "regulatory_change_id"),
        Index("ix_regulatory_feed_item_published", "published_date"),
        UniqueConstraint("feed_source_id", "guid", name="uq_feed_item_source_guid"),
    )


# =============================================================================
# 25. Audit Management Module
# =============================================================================

class AuditableEntity(Base):
    __tablename__ = "grc_auditable_entities"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    entity_type = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    risk_score = Column(Float, default=0)
    risk_rating = Column(String(20), default="low")
    audit_cycle_months = Column(Integer, default=12)
    last_audited_date = Column(DateTime, nullable=True)
    next_audit_due = Column(DateTime, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    industry = Column(String(100), nullable=True)
    contact_name = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    contact_designation = Column(String(255), nullable=True)
    status = Column(String(50), default="active")
    linked_risk_ids = Column(JSON, default=[])
    metadata_json = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    business_unit = relationship("BusinessUnit")
    owner = relationship("GRCUser")

    __table_args__ = (
        Index("ix_auditable_entity_tenant", "tenant_id"),
        Index("ix_auditable_entity_risk", "tenant_id", "risk_score"),
    )


class AuditNotificationTemplate(Base):
    __tablename__ = "grc_audit_notification_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    template_type = Column(String(50), nullable=False)
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    trigger_event = Column(String(100), nullable=True)
    recipients_config = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_audit_notification_tenant", "tenant_id"),
        Index("ix_audit_notification_type", "tenant_id", "template_type"),
        Index("ix_audit_notification_active", "tenant_id", "is_active"),
    )


class AuditPlan(Base):
    __tablename__ = "grc_audit_plans"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    fiscal_year = Column(String(10), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="draft")
    approval_status = Column(String(50), default="pending")
    approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    total_budget_days = Column(Float, default=0)
    ai_generated = Column(Boolean, default=False)
    ai_generation_params = Column(JSON, default={})
    risk_alignment_score = Column(Float, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    approved_by = relationship("GRCUser", foreign_keys=[approved_by_id])
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    items = relationship("AuditPlanItem", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_audit_plan_tenant", "tenant_id"),
        Index("ix_audit_plan_year", "tenant_id", "fiscal_year"),
    )


class AuditPlanItem(Base):
    __tablename__ = "grc_audit_plan_items"

    id = Column(Integer, primary_key=True, index=True)
    plan_id = Column(Integer, ForeignKey("grc_audit_plans.id"), nullable=False, index=True)
    auditable_entity_id = Column(Integer, ForeignKey("grc_auditable_entities.id"), nullable=True)
    name = Column(String(255), nullable=False)
    risk_score = Column(Float, default=0)
    quarter = Column(String(10), nullable=True)
    scheduled_start = Column(DateTime, nullable=True)
    scheduled_end = Column(DateTime, nullable=True)
    budget_days = Column(Float, default=0)
    framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True)
    assigned_auditor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    priority = Column(String(20), default="medium")
    status = Column(String(50), default="scheduled")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    plan = relationship("AuditPlan", back_populates="items")
    auditable_entity = relationship("AuditableEntity")
    framework = relationship("UploadedFramework")
    assigned_auditor = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_plan_item_plan", "plan_id"),
    )


class AuditEngagement(Base):
    __tablename__ = "grc_audit_engagements"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plan_item_id = Column(Integer, ForeignKey("grc_audit_plan_items.id"), nullable=True)
    auditable_entity_id = Column(Integer, ForeignKey("grc_auditable_entities.id"), nullable=True)
    engagement_number = Column(String(50), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    engagement_type = Column(String(50), default="assurance")
    status = Column(String(50), default="planning")
    scope = Column(Text, nullable=True)
    objectives = Column(Text, nullable=True)
    methodology = Column(Text, nullable=True)
    framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True)
    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    budget_hours = Column(Float, default=0)
    actual_hours = Column(Float, default=0)
    lead_auditor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    opinion = Column(String(50), nullable=True)
    opinion_narrative = Column(Text, nullable=True)
    risk_rating = Column(String(20), nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    plan_item = relationship("AuditPlanItem")
    auditable_entity = relationship("AuditableEntity")
    framework = relationship("UploadedFramework")
    lead_auditor = relationship("GRCUser", foreign_keys=[lead_auditor_id])
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    team_members = relationship("AuditTeamMember", back_populates="engagement", cascade="all, delete-orphan")
    workpapers = relationship("AuditWorkpaper", back_populates="engagement", cascade="all, delete-orphan")
    findings = relationship("AuditFinding", back_populates="engagement", cascade="all, delete-orphan")
    time_entries = relationship("AuditTimeEntry", back_populates="engagement", cascade="all, delete-orphan")
    sampling_records = relationship("AuditSamplingRecord", back_populates="engagement", cascade="all, delete-orphan")
    reports = relationship("AuditReport", back_populates="engagement", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_audit_engagement_tenant", "tenant_id"),
        Index("ix_audit_engagement_status", "tenant_id", "status"),
    )


class AuditTeamMember(Base):
    __tablename__ = "grc_audit_team_members"

    id = Column(Integer, primary_key=True, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role = Column(String(50), default="auditor")
    skills = Column(JSON, default=[])
    availability_percent = Column(Float, default=100)
    conflict_of_interest = Column(Boolean, default=False)
    coi_declaration = Column(Text, nullable=True)
    assigned_at = Column(DateTime, default=datetime.utcnow)

    engagement = relationship("AuditEngagement", back_populates="team_members")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_team_engagement", "engagement_id"),
        UniqueConstraint("engagement_id", "user_id", name="uq_audit_team_member"),
    )


class AuditWorkpaper(Base):
    __tablename__ = "grc_audit_workpapers"

    id = Column(Integer, primary_key=True, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    reference_number = Column(String(50), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    workpaper_type = Column(String(50), default="test")
    status = Column(String(50), default="draft")
    preparer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    lead_signoff_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    prepared_at = Column(DateTime, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    lead_signoff_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    conclusion = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    engagement = relationship("AuditEngagement", back_populates="workpapers")
    preparer = relationship("GRCUser", foreign_keys=[preparer_id])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    lead_signoff = relationship("GRCUser", foreign_keys=[lead_signoff_id])
    procedures = relationship("AuditProcedure", back_populates="workpaper", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_audit_workpaper_engagement", "engagement_id"),
    )


class AuditProcedure(Base):
    __tablename__ = "grc_audit_procedures"

    id = Column(Integer, primary_key=True, index=True)
    workpaper_id = Column(Integer, ForeignKey("grc_audit_workpapers.id"), nullable=False, index=True)
    procedure_number = Column(String(20), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    test_type = Column(String(50), default="control_test")
    sampling_methodology = Column(String(100), nullable=True)
    sample_size = Column(Integer, nullable=True)
    population_size = Column(Integer, nullable=True)
    result = Column(String(20), nullable=True)
    result_details = Column(Text, nullable=True)
    exceptions_noted = Column(Integer, default=0)
    control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True)
    framework_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True)
    evidence_ids = Column(JSON, default=[])
    ai_generated = Column(Boolean, default=False)
    performed_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    performed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    workpaper = relationship("AuditWorkpaper", back_populates="procedures")
    control = relationship("NormalizedControl")
    framework_control = relationship("ParsedFrameworkControl")
    performed_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_procedure_workpaper", "workpaper_id"),
    )


class AuditFinding(Base):
    __tablename__ = "grc_audit_findings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    finding_number = Column(String(50), nullable=True)
    title = Column(String(255), nullable=False)
    condition = Column(Text, nullable=True)
    criteria = Column(Text, nullable=True)
    cause = Column(Text, nullable=True)
    effect = Column(Text, nullable=True)
    root_cause_category = Column(String(50), nullable=True)
    severity = Column(String(20), default="medium")
    status = Column(String(50), default="open")
    framework_mappings = Column(JSON, default=[])
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True)
    control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    ai_generated = Column(Boolean, default=False)
    theme = Column(String(100), nullable=True)
    attachment_file_name = Column(String(255), nullable=True)
    attachment_file_path = Column(String(500), nullable=True)
    attachment_content_type = Column(String(100), nullable=True)
    attachment_file_size = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    engagement = relationship("AuditEngagement", back_populates="findings")
    risk = relationship("Risk")
    control = relationship("NormalizedControl")
    owner = relationship("GRCUser")
    management_responses = relationship("AuditManagementResponse", back_populates="finding", cascade="all, delete-orphan")
    recommendations = relationship("AuditRecommendation", back_populates="finding", cascade="all, delete-orphan")
    follow_ups = relationship("AuditFollowUp", back_populates="finding", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_audit_finding_tenant", "tenant_id"),
        Index("ix_audit_finding_engagement", "engagement_id"),
        Index("ix_audit_finding_severity", "tenant_id", "severity"),
    )


class AuditManagementResponse(Base):
    __tablename__ = "grc_audit_management_responses"

    id = Column(Integer, primary_key=True, index=True)
    finding_id = Column(Integer, ForeignKey("grc_audit_findings.id"), nullable=False, index=True)
    response_type = Column(String(20), default="agree")
    response_text = Column(Text, nullable=True)
    action_plan = Column(Text, nullable=True)
    target_date = Column(DateTime, nullable=True)
    respondent_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    responded_at = Column(DateTime, default=datetime.utcnow)

    finding = relationship("AuditFinding", back_populates="management_responses")
    respondent = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_mgmt_response_finding", "finding_id"),
    )


class AuditRecommendation(Base):
    __tablename__ = "grc_audit_recommendations"

    id = Column(Integer, primary_key=True, index=True)
    finding_id = Column(Integer, ForeignKey("grc_audit_findings.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), default="medium")
    status = Column(String(50), default="open")
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    finding = relationship("AuditFinding", back_populates="recommendations")
    owner = relationship("GRCUser")
    action_plans = relationship("AuditActionPlan", back_populates="recommendation", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_audit_recommendation_finding", "finding_id"),
    )


class AuditActionPlan(Base):
    __tablename__ = "grc_audit_action_plans"

    id = Column(Integer, primary_key=True, index=True)
    recommendation_id = Column(Integer, ForeignKey("grc_audit_recommendations.id"), nullable=False, index=True)
    milestone = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="pending")
    evidence_of_completion = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    recommendation = relationship("AuditRecommendation", back_populates="action_plans")
    owner = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_action_plan_rec", "recommendation_id"),
    )


class AuditFollowUp(Base):
    __tablename__ = "grc_audit_follow_ups"

    id = Column(Integer, primary_key=True, index=True)
    finding_id = Column(Integer, ForeignKey("grc_audit_findings.id"), nullable=False, index=True)
    follow_up_type = Column(String(50), default="retest")
    retest_result = Column(String(20), nullable=True)
    retest_details = Column(Text, nullable=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)
    performed_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    closure_approved = Column(Boolean, default=False)
    closure_approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    closure_approved_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)

    finding = relationship("AuditFinding", back_populates="follow_ups")
    evidence = relationship("Evidence")
    performed_by = relationship("GRCUser", foreign_keys=[performed_by_id])
    closure_approved_by = relationship("GRCUser", foreign_keys=[closure_approved_by_id])

    __table_args__ = (
        Index("ix_audit_follow_up_finding", "finding_id"),
    )


class AuditTimeEntry(Base):
    __tablename__ = "grc_audit_time_entries"

    id = Column(Integer, primary_key=True, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    workpaper_id = Column(Integer, ForeignKey("grc_audit_workpapers.id"), nullable=True)
    date = Column(DateTime, nullable=False)
    hours = Column(Float, nullable=False)
    description = Column(Text, nullable=True)
    activity_type = Column(String(50), default="fieldwork")
    created_at = Column(DateTime, default=datetime.utcnow)

    engagement = relationship("AuditEngagement", back_populates="time_entries")
    user = relationship("GRCUser")
    workpaper = relationship("AuditWorkpaper")

    __table_args__ = (
        Index("ix_audit_time_entry_engagement", "engagement_id"),
    )


class AuditSamplingRecord(Base):
    __tablename__ = "grc_audit_sampling_records"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    workpaper_id = Column(Integer, ForeignKey("grc_audit_workpapers.id"), nullable=True)
    sampling_type = Column(String(50), nullable=False)
    population_size = Column(Integer, nullable=False)
    sample_size = Column(Integer, nullable=False)
    confidence_level = Column(Float, nullable=False)
    expected_error_rate = Column(Float, nullable=True)
    tolerable_error_rate = Column(Float, nullable=True)
    methodology = Column(String(100), nullable=True)
    interpretation = Column(Text, nullable=True)
    sampling_interval = Column(Float, nullable=True)
    parameters = Column(JSON, default={})
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    engagement = relationship("AuditEngagement", back_populates="sampling_records")
    workpaper = relationship("AuditWorkpaper")
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])

    __table_args__ = (
        Index("ix_audit_sampling_tenant", "tenant_id"),
        Index("ix_audit_sampling_engagement", "engagement_id"),
    )


class AuditReport(Base):
    __tablename__ = "grc_audit_reports"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    report_type = Column(String(50), default="engagement_report")
    executive_summary = Column(Text, nullable=True)
    opinion = Column(String(50), nullable=True)
    opinion_narrative = Column(Text, nullable=True)
    scope_summary = Column(Text, nullable=True)
    findings_summary = Column(JSON, default={})
    recommendations_summary = Column(JSON, default={})
    ai_recommendations = Column(Text, nullable=True)
    status = Column(String(50), default="draft")
    ai_generated = Column(Boolean, default=False)
    issued_date = Column(DateTime, nullable=True)
    issued_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    engagement = relationship("AuditEngagement", back_populates="reports")
    issued_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_report_tenant", "tenant_id"),
        Index("ix_audit_report_engagement", "engagement_id"),
    )


class AuditBoardPack(Base):
    __tablename__ = "grc_audit_board_packs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    period = Column(String(50), nullable=True)
    executive_summary = Column(Text, nullable=True)
    engagement_ids = Column(JSON, default=[])
    key_findings = Column(JSON, default=[])
    kpi_data = Column(JSON, default={})
    risk_heatmap_data = Column(JSON, default={})
    opinion_summary = Column(Text, nullable=True)
    status = Column(String(50), default="draft")
    ai_generated = Column(Boolean, default=False)
    prepared_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    presented_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    prepared_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_board_pack_tenant", "tenant_id"),
    )


class CCMRule(Base):
    __tablename__ = "grc_ccm_rules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    rule_code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    control_area = Column(String(100), nullable=False)
    control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True)
    rule_type = Column(String(50), default="threshold")
    threshold_value = Column(Float, nullable=True)
    threshold_operator = Column(String(20), nullable=True)
    severity = Column(String(20), default="medium")
    is_active = Column(Boolean, default=True)
    parameters = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    control = relationship("InternalControl")

    __table_args__ = (
        Index("ix_ccm_rule_tenant", "tenant_id"),
        Index("ix_ccm_rule_area", "tenant_id", "control_area"),
    )


class CCMAnomaly(Base):
    __tablename__ = "grc_ccm_anomalies"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    rule_id = Column(Integer, ForeignKey("grc_ccm_rules.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(20), default="medium")
    detected_at = Column(DateTime, default=datetime.utcnow)
    transaction_ref = Column(String(255), nullable=True)
    transaction_amount = Column(Float, nullable=True)
    control_area = Column(String(100), nullable=True)
    is_false_positive = Column(Boolean, default=False)
    false_positive_reason = Column(Text, nullable=True)
    status = Column(String(50), default="flagged")
    metadata_json = Column(JSON, default={})

    tenant = relationship("Tenant")
    rule = relationship("CCMRule")
    exceptions = relationship("CCMException", back_populates="anomaly", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_ccm_anomaly_tenant", "tenant_id"),
        Index("ix_ccm_anomaly_severity", "tenant_id", "severity"),
        Index("ix_ccm_anomaly_status", "tenant_id", "status"),
    )


class CCMException(Base):
    __tablename__ = "grc_ccm_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    anomaly_id = Column(Integer, ForeignKey("grc_ccm_anomalies.id"), nullable=False, index=True)
    workflow_status = Column(String(50), default="flagged")
    assigned_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    decision = Column(String(50), nullable=True)
    decision_notes = Column(Text, nullable=True)
    escalated_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    escalated_at = Column(DateTime, nullable=True)
    finding_id = Column(Integer, ForeignKey("grc_audit_findings.id"), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    anomaly = relationship("CCMAnomaly", back_populates="exceptions")
    assigned_to = relationship("GRCUser", foreign_keys=[assigned_to_id])
    reviewed_by = relationship("GRCUser", foreign_keys=[reviewed_by_id])
    escalated_to = relationship("GRCUser", foreign_keys=[escalated_to_id])
    finding = relationship("AuditFinding")

    __table_args__ = (
        Index("ix_ccm_exception_anomaly", "anomaly_id"),
        Index("ix_ccm_exception_status", "workflow_status"),
    )


class PBCListItem(Base):
    __tablename__ = "grc_pbc_list_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=False, index=True)
    document_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    requested_by = Column(String(255), nullable=True)
    assigned_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    status = Column(String(50), default="requested")
    due_date = Column(DateTime, nullable=True)
    submitted_date = Column(DateTime, nullable=True)
    reviewed_date = Column(DateTime, nullable=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    engagement = relationship("AuditEngagement")
    assigned_to = relationship("GRCUser")
    evidence = relationship("Evidence")

    __table_args__ = (
        Index("ix_pbc_list_tenant", "tenant_id"),
        Index("ix_pbc_list_engagement", "engagement_id"),
    )


class QAIPReview(Base):
    __tablename__ = "grc_qaip_reviews"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=True)
    review_type = Column(String(50), default="internal")
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    peer_reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    checklist = Column(JSON, default=[])
    iia_conformance = Column(JSON, default={})
    maturity_score = Column(Float, nullable=True)
    overall_rating = Column(String(50), nullable=True)
    findings = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    status = Column(String(50), default="pending")
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    engagement = relationship("AuditEngagement")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    peer_reviewer = relationship("GRCUser", foreign_keys=[peer_reviewer_id])

    __table_args__ = (
        Index("ix_qaip_review_tenant", "tenant_id"),
    )


class AuditTemplate(Base):
    __tablename__ = "grc_audit_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    template_type = Column(String(50), default="general")
    framework_type = Column(String(100), nullable=True)
    procedures = Column(JSON, default=[])
    checklist = Column(JSON, default=[])
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_audit_template_type", "framework_type"),
    )


class AuditTestScript(Base):
    __tablename__ = "grc_audit_test_scripts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    objective = Column(Text, nullable=True)
    procedure_steps = Column(JSON, default=[])
    control_area = Column(String(100), nullable=True)
    entity_type = Column(String(100), nullable=True)
    framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True)
    test_type = Column(String(50), default="control_test")
    sampling_methodology = Column(String(50), nullable=True)
    expected_evidence = Column(Text, nullable=True)
    tags = Column(JSON, default=[])
    usage_count = Column(Integer, default=0)
    last_used_date = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    framework = relationship("UploadedFramework")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_test_script_tenant", "tenant_id"),
        Index("ix_test_script_area", "tenant_id", "control_area"),
    )


class AuditorSkill(Base):
    __tablename__ = "grc_auditor_skills"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    skill_name = Column(String(255), nullable=False)
    skill_category = Column(String(100), default="general")
    proficiency_level = Column(String(50), default="intermediate")
    certification = Column(String(255), nullable=True)
    certification_expiry = Column(DateTime, nullable=True)
    years_experience = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_auditor_skill_tenant", "tenant_id"),
        Index("ix_auditor_skill_user", "tenant_id", "user_id"),
    )


class AuditorAllocation(Base):
    __tablename__ = "grc_auditor_allocations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    engagement_id = Column(Integer, ForeignKey("grc_audit_engagements.id"), nullable=True)
    allocation_type = Column(String(50), default="audit")
    allocated_hours = Column(Float, default=0)
    actual_hours = Column(Float, default=0)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    status = Column(String(50), default="planned")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")
    engagement = relationship("AuditEngagement")

    __table_args__ = (
        Index("ix_allocation_tenant", "tenant_id"),
        Index("ix_allocation_user", "tenant_id", "user_id"),
        Index("ix_allocation_dates", "tenant_id", "start_date", "end_date"),
    )


# =============================================================================
# 22. Integrations Module (Vulnerability Scanner Integration)
# =============================================================================

class IntegrationConnection(Base):
    """Vulnerability scanner connections (Nexpose, Nessus, etc.)"""
    __tablename__ = "grc_integration_connections"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    integration_type = Column(String(50), nullable=False)  # nexpose, nessus
    connection_name = Column(String(200), nullable=False)
    console_url = Column(String(500), nullable=False)
    console_port = Column(Integer, default=3780)
    auth_method = Column(String(50), default="api_key")
    credential_env_prefix = Column(String(100), nullable=False)
    username = Column(String(255), nullable=True)
    password = Column(String(500), nullable=True)
    sync_schedule = Column(String(50), default="0 */4 * * *")  # cron format
    is_active = Column(Boolean, default=True)
    status = Column(String(50), default="pending")  # pending, connected, error, deactivated
    last_sync_at = Column(DateTime, nullable=True)
    last_sync_status = Column(String(50), nullable=True)  # success, failed, partial
    last_sync_stats = Column(JSON, nullable=True)
    consecutive_failures = Column(Integer, default=0)
    created_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    sync_history = relationship("SyncHistory", back_populates="connection", cascade="all, delete-orphan")
    audit_logs = relationship("IntegrationAuditLog", back_populates="connection", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_connection_tenant", "tenant_id"),
        Index("ix_connection_type", "tenant_id", "integration_type"),
        UniqueConstraint("tenant_id", "connection_name", name="uq_connection_name_tenant"),
    )


class SyncHistory(Base):
    """Sync operation history for integration connections"""
    __tablename__ = "grc_sync_history"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    sync_type = Column(String(50), nullable=False)  # full, incremental, manual, scheduled
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    status = Column(String(50), nullable=False)  # running, completed, failed, partial
    assets_new = Column(Integer, default=0)
    assets_updated = Column(Integer, default=0)
    vulns_new = Column(Integer, default=0)
    vulns_updated = Column(Integer, default=0)
    vulns_closed = Column(Integer, default=0)
    errors_count = Column(Integer, default=0)
    error_details = Column(JSON, nullable=True)
    triggered_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    sync_metadata = Column(JSON, nullable=True)

    tenant = relationship("Tenant")
    connection = relationship("IntegrationConnection", back_populates="sync_history")

    __table_args__ = (
        Index("ix_sync_tenant", "tenant_id"),
        Index("ix_sync_connection", "connection_id"),
        Index("ix_sync_status", "tenant_id", "status"),
    )


class IntegrationAuditLog(Base):
    """Audit log for integration operations"""
    __tablename__ = "grc_integration_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    entity_type = Column(String(50), nullable=False)  # connection, exception, mapping, scoring
    entity_id = Column(Integer, nullable=False)
    action = Column(String(50), nullable=False)  # create, update, delete, approve, reject, sync
    performed_by = Column(String(255), nullable=True)
    performed_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    metadata_info = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    connection = relationship("IntegrationConnection", back_populates="audit_logs")

    __table_args__ = (
        Index("ix_audit_tenant", "tenant_id"),
        Index("ix_audit_connection", "connection_id"),
        Index("ix_audit_entity", "entity_type", "entity_id"),
    )


class IntegrationException(Base):
    """Vulnerability exceptions managed through integrations"""
    __tablename__ = "grc_integration_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    exception_type = Column(String(50), nullable=False)  # mitigate, accept, defer
    reason = Column(String(50), nullable=False)
    justification = Column(Text, nullable=False)
    status = Column(String(50), default="pending_review")  # pending_review, approved, rejected, revoked, withdrawn, expired
    requested_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    reviewed_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    push_status = Column(String(50), nullable=True)  # pending, pushed, failed
    push_error = Column(Text, nullable=True)
    nexpose_exception_id = Column(String(255), nullable=True)
    expires_at = Column(DateTime, nullable=True)
    revoked_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    revoke_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")
    connection = relationship("IntegrationConnection")

    __table_args__ = (
        Index("ix_exception_tenant", "tenant_id"),
        Index("ix_exception_vuln", "vulnerability_id"),
        Index("ix_exception_status", "status"),
    )


class ScanRecord(Base):
    """Individual scan records from vulnerability scanners"""
    __tablename__ = "grc_scan_records"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    external_scan_id = Column(String(255), nullable=False)
    scan_name = Column(String(500), nullable=True)
    scan_type = Column(String(100), nullable=True)
    start_time = Column(DateTime, nullable=True)
    end_time = Column(DateTime, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    scan_status = Column(String(50), nullable=True)  # completed, in_progress, failed, etc.
    assets_scanned = Column(Integer, nullable=True)
    engine_name = Column(String(255), nullable=True)
    vulns_found = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    connection = relationship("IntegrationConnection")

    __table_args__ = (
        Index("ix_scan_record_tenant", "tenant_id"),
        Index("ix_scan_record_connection", "connection_id"),
        Index("ix_scan_record_external_id", "tenant_id", "connection_id", "external_scan_id"),
        UniqueConstraint("tenant_id", "connection_id", "external_scan_id", name="uq_scan_record_external"),
    )


class OutboundExceptionRequest(Base):
    """Outbound exception push requests to vulnerability scanners"""
    __tablename__ = "grc_outbound_exception_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    connection_id = Column(Integer, ForeignKey("grc_integration_connections.id"), nullable=False, index=True)
    exception_type = Column(String(50), nullable=False)  # false_positive, risk_accepted, deferred
    reason = Column(String(100), nullable=False)
    justification = Column(Text, nullable=False)
    requested_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="pending_approval")  # pending_approval, approved, rejected, pushed, failed
    reviewed_by_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    review_notes = Column(Text, nullable=True)
    push_status = Column(String(50), nullable=True)  # pending, pushed, failed
    push_error = Column(Text, nullable=True)
    external_exception_id = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")
    connection = relationship("IntegrationConnection")
    requested_by = relationship("GRCUser", foreign_keys=[requested_by_user_id])
    reviewed_by = relationship("GRCUser", foreign_keys=[reviewed_by_user_id])

    __table_args__ = (
        Index("ix_outbound_exception_request_tenant", "tenant_id"),
        Index("ix_outbound_exception_request_vuln", "vulnerability_id"),
        Index("ix_outbound_exception_request_status", "status"),
        Index("ix_outbound_exception_request_connection", "connection_id"),
    )



class VulnerabilitySolution(Base):
    """Remediation solutions for vulnerabilities from scanner integrations"""
    __tablename__ = "grc_vulnerability_solutions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    external_solution_id = Column(String(255), nullable=False)
    remediation_summary = Column(Text, nullable=True)
    remediation_steps = Column(Text, nullable=True)
    solution_type = Column(String(100), nullable=True)
    remediation_estimate = Column(String(255), nullable=True)
    additional_info = Column(Text, nullable=True)
    applies_to = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vulnerability = relationship("Vulnerability")

    __table_args__ = (
        Index("ix_solution_tenant", "tenant_id"),
        Index("ix_solution_vuln", "vulnerability_id"),
        Index("ix_solution_external_id", "tenant_id", "vulnerability_id", "external_solution_id"),
        UniqueConstraint("tenant_id", "vulnerability_id", "external_solution_id", name="uq_solution_external"),
    )



# =============================================================================
# 22. Workflow Automation Engine (Standalone, Config-Driven)
# =============================================================================

class WorkflowDefinition(Base):
    __tablename__ = "grc_workflow_definitions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True, index=True)
    trigger_event = Column(String(255), nullable=False, index=True)
    trigger_conditions = Column(JSON, default={})
    definition_json = Column(JSON, default={})  # Canvas viewport/layout state (zoom, pan, positions)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    updated_by = relationship("GRCUser", foreign_keys=[updated_by_id])
    nodes = relationship("WorkflowNode", back_populates="workflow_definition", cascade="all, delete-orphan")
    edges = relationship("WorkflowEdge", back_populates="workflow_definition", cascade="all, delete-orphan")
    instances = relationship("WorkflowInstance", back_populates="workflow_definition", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_definition_tenant_trigger", "tenant_id", "trigger_event"),
    )


class WorkflowNode(Base):
    __tablename__ = "grc_workflow_nodes"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    node_key = Column(String(100), nullable=False)  # Unique key within the workflow
    node_type = Column(String(255), nullable=False, index=True)  # Node type ID from catalog
    name = Column(String(255), nullable=False)  # Display name for this node instance
    config = Column(JSON, default={})  # Node-specific configuration
    position_x = Column(Float, default=0)  # Canvas X position
    position_y = Column(Float, default=0)  # Canvas Y position
    is_start = Column(Boolean, default=False)
    is_terminal = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workflow_definition = relationship("WorkflowDefinition", back_populates="nodes")

    __table_args__ = (
        Index("ix_workflow_node_definition_key", "workflow_definition_id", "node_key"),
    )


class WorkflowEdge(Base):
    __tablename__ = "grc_workflow_edges"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    source_node_key = Column(String(100), nullable=False, index=True)
    target_node_key = Column(String(100), nullable=False, index=True)
    condition = Column(JSON, default={})  # Conditional logic, label, handles stored here
    priority = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)

    workflow_definition = relationship("WorkflowDefinition", back_populates="edges")

    __table_args__ = (
        Index("ix_workflow_edge_source", "workflow_definition_id", "source_node_key"),
        Index("ix_workflow_edge_target", "workflow_definition_id", "target_node_key"),
    )


class WorkflowInstance(Base):
    __tablename__ = "grc_workflow_instances"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    status = Column(String(50), default="running", index=True)
    current_node_key = Column(String(100), nullable=True)
    trigger_event = Column(String(255), nullable=True, index=True)
    trigger_payload = Column(JSON, default={})
    context = Column(JSON, default={})
    correlation_id = Column(String(255), nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    workflow_definition = relationship("WorkflowDefinition", back_populates="instances")
    tenant = relationship("Tenant")
    steps = relationship("WorkflowEngineStep", back_populates="workflow_instance", cascade="all, delete-orphan")
    audit_logs = relationship("WorkflowAuditLog", back_populates="workflow_instance", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_instance_tenant_status", "tenant_id", "status"),
    )


class WorkflowEngineStep(Base):
    __tablename__ = "grc_workflow_engine_steps"

    id = Column(Integer, primary_key=True, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False, index=True)
    node_key = Column(String(100), nullable=False)
    node_type = Column(String(50), nullable=False)
    status = Column(String(50), default="pending", index=True)
    input_payload = Column(JSON, default={})
    output_payload = Column(JSON, default={})
    attempts = Column(Integer, default=0)
    assigned_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    workflow_instance = relationship("WorkflowInstance", back_populates="steps")
    assigned_to_user = relationship("GRCUser")
    approvals = relationship("ApprovalRequest", back_populates="workflow_step", cascade="all, delete-orphan")
    audit_logs = relationship("WorkflowAuditLog", back_populates="workflow_step", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_step_instance_status", "workflow_instance_id", "status"),
    )


class ApprovalRequest(Base):
    __tablename__ = "grc_workflow_approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False, index=True)
    workflow_step_id = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=False, index=True)
    status = Column(String(50), default="pending", index=True)
    approval_type = Column(String(50), default="single")
    required_approvals = Column(Integer, default=1)
    received_approvals = Column(Integer, default=0)
    approver_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_role = Column(String(100), nullable=True)
    decision_comment = Column(Text, nullable=True)
    due_at = Column(DateTime, nullable=True, index=True)
    responded_at = Column(DateTime, nullable=True)
    request_metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    workflow_instance = relationship("WorkflowInstance")
    workflow_step = relationship("WorkflowEngineStep", back_populates="approvals")
    approver_user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_approval_tenant_status", "tenant_id", "status"),
    )


class WorkflowAuditLog(Base):
    __tablename__ = "grc_workflow_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=True, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=True, index=True)
    workflow_step_id = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    message = Column(Text, nullable=True)
    payload = Column(JSON, default={})
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    tenant = relationship("Tenant")
    workflow_definition = relationship("WorkflowDefinition")
    workflow_instance = relationship("WorkflowInstance", back_populates="audit_logs")
    workflow_step = relationship("WorkflowEngineStep", back_populates="audit_logs")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_audit_tenant_created", "tenant_id", "created_at"),
    )


class WorkflowDefinitionVersion(Base):
    __tablename__ = "grc_workflow_definition_versions"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    trigger_event = Column(String(255), nullable=False)
    trigger_conditions = Column(JSON, default={})
    definition_json = Column(JSON, default={})
    nodes_json = Column(JSON, default=[])
    edges_json = Column(JSON, default=[])
    change_summary = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    workflow_definition = relationship("WorkflowDefinition")
    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_definition_version", "workflow_definition_id", "version_number"),
        UniqueConstraint("workflow_definition_id", "version_number", name="uq_workflow_definition_version"),
    )


class WorkflowEngineTemplate(Base):
    __tablename__ = "grc_workflow_engine_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True, index=True)
    trigger_event = Column(String(255), nullable=False)
    trigger_conditions = Column(JSON, default={})
    definition_json = Column(JSON, default={})
    nodes_json = Column(JSON, default=[])
    edges_json = Column(JSON, default=[])
    tags = Column(JSON, default=[])
    is_system_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_template_tenant_category", "tenant_id", "category"),
        Index("ix_workflow_template_tenant_active", "tenant_id", "is_active"),
    )


class WorkflowEngineSchedule(Base):
    __tablename__ = "grc_workflow_engine_schedules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    schedule_type = Column(String(50), default="interval")  # interval, once
    interval_minutes = Column(Integer, nullable=True)
    run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    payload = Column(JSON, default={})
    is_active = Column(Boolean, default=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    workflow_definition = relationship("WorkflowDefinition")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_schedule_tenant_next", "tenant_id", "next_run_at"),
    )


class WorkflowEngineWebhookEndpoint(Base):
    __tablename__ = "grc_workflow_engine_webhooks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    token = Column(String(255), nullable=False, unique=True, index=True)
    event_name = Column(String(255), nullable=False, index=True)
    callback_url = Column(String(1000), nullable=True)
    secret = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_webhook_tenant_event", "tenant_id", "event_name"),
    )


class WorkflowEmailConfiguration(Base):
    """Email configuration for workflow notifications"""
    __tablename__ = "grc_workflow_email_configs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    config_name = Column(String(255), nullable=False)
    smtp_host = Column(String(255), nullable=False)
    smtp_port = Column(Integer, default=587)
    smtp_username = Column(String(255), nullable=False)
    smtp_password = Column(String(500), nullable=False)  # Should be encrypted in production
    from_email = Column(String(255), nullable=False)
    from_name = Column(String(255), nullable=True)
    use_tls = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "config_name", name="uq_workflow_email_config_tenant_name"),
    )


class WorkflowNotification(Base):
    """In-app notifications for workflow events"""
    __tablename__ = "grc_workflow_notifications"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=True, index=True)
    notification_type = Column(String(50), default="info")  # info, success, warning, error
    subject = Column(String(500), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, index=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")
    workflow_instance = relationship("WorkflowInstance")

    __table_args__ = (
        Index("ix_workflow_notification_user_read", "user_id", "is_read"),
    )


# =============================================================================
# 27. Vendor Risk Management Models
# =============================================================================

class Vendor(Base):
    """Third-party vendor master record for vendor risk management."""
    __tablename__ = "grc_vendors"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    tier = Column(String(20), default="medium")
    status = Column(String(50), default="active")
    vendor_type = Column(String(100), nullable=True)
    industry = Column(String(100), nullable=True)
    website = Column(String(500), nullable=True)
    primary_contact_name = Column(String(255), nullable=True)
    primary_contact_email = Column(String(255), nullable=True)
    primary_contact_phone = Column(String(100), nullable=True)
    contract_start_date = Column(DateTime, nullable=True)
    contract_end_date = Column(DateTime, nullable=True)
    contract_value = Column(Float, nullable=True)
    services_provided = Column(JSON, default=[])
    data_access_level = Column(String(50), default="none")
    data_types_accessed = Column(JSON, default=[])
    geographic_locations = Column(JSON, default=[])
    inherent_risk_score = Column(Float, nullable=True)
    residual_risk_score = Column(Float, nullable=True)
    risk_rating = Column(String(20), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    business_unit = relationship("BusinessUnit")
    assessments = relationship("VendorAssessment", back_populates="vendor", cascade="all, delete-orphan")
    questionnaire_responses = relationship("VendorQuestionnaireResponse", back_populates="vendor", cascade="all, delete-orphan")
    sla_records = relationship("VendorSLARecord", back_populates="vendor", cascade="all, delete-orphan")
    incidents = relationship("VendorIncident", back_populates="vendor", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_vendor_tenant_name", "tenant_id", "name"),
        Index("ix_vendor_tenant_status", "tenant_id", "status"),
        Index("ix_vendor_tenant_tier", "tenant_id", "tier"),
        Index("ix_vendor_tenant_rating", "tenant_id", "risk_rating"),
    )


class VendorQuestionnaireTemplate(Base):
    """Reusable vendor questionnaire templates."""
    __tablename__ = "grc_vendor_questionnaire_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), default="security")
    description = Column(Text, nullable=True)
    questions = Column(JSON, default=[])
    is_default = Column(Boolean, default=False)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    assessments = relationship("VendorAssessment", back_populates="template")
    responses = relationship("VendorQuestionnaireResponse", back_populates="template")

    __table_args__ = (
        Index("ix_vendor_questionnaire_template_tenant", "tenant_id"),
        Index("ix_vendor_questionnaire_template_category", "tenant_id", "category"),
        Index("ix_vendor_questionnaire_template_default", "tenant_id", "is_default"),
    )


class VendorAssessment(Base):
    """Risk assessments performed against a vendor."""
    __tablename__ = "grc_vendor_assessments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_type = Column(String(100), default="initial")
    template_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_templates.id"), nullable=True, index=True)
    status = Column(String(50), default="draft")
    inherent_score = Column(Float, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_rating = Column(String(20), nullable=True)
    findings = Column(JSON, default=[])
    recommendations = Column(JSON, default=[])
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vendor = relationship("Vendor", back_populates="assessments")
    template = relationship("VendorQuestionnaireTemplate", back_populates="assessments")
    assessor = relationship("GRCUser", foreign_keys=[assessed_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])
    questionnaire_responses = relationship("VendorQuestionnaireResponse", back_populates="assessment")

    __table_args__ = (
        Index("ix_vendor_assessment_tenant_vendor", "tenant_id", "vendor_id"),
        Index("ix_vendor_assessment_tenant_status", "tenant_id", "status"),
        Index("ix_vendor_assessment_tenant_type", "tenant_id", "assessment_type"),
    )


class VendorQuestionnaireResponse(Base):
    """Vendor questionnaire response instance addressed via shareable token."""
    __tablename__ = "grc_vendor_questionnaire_responses"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=True, index=True)
    template_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_templates.id"), nullable=True, index=True)
    respondent_name = Column(String(255), nullable=True)
    respondent_email = Column(String(255), nullable=True)
    responses = Column(JSON, default={})
    status = Column(String(50), default="pending")
    token = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    vendor = relationship("Vendor", back_populates="questionnaire_responses")
    assessment = relationship("VendorAssessment", back_populates="questionnaire_responses")
    template = relationship("VendorQuestionnaireTemplate", back_populates="responses")
    evidence_files = relationship("VendorQuestionnaireEvidence", back_populates="response", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_vendor_questionnaire_response_tenant", "tenant_id"),
        Index("ix_vendor_questionnaire_response_vendor", "vendor_id"),
        Index("ix_vendor_questionnaire_response_assessment", "assessment_id"),
        Index("ix_vendor_questionnaire_response_status", "tenant_id", "status"),
    )


class VendorQuestionnaireEvidence(Base):
    """Evidence uploaded against a questionnaire response question."""
    __tablename__ = "grc_vendor_questionnaire_evidence"

    id = Column(Integer, primary_key=True, index=True)
    response_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_responses.id"), nullable=False, index=True)
    question_id = Column(String(100), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_type = Column(String(255), nullable=True)
    file_size = Column(Integer, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    response = relationship("VendorQuestionnaireResponse", back_populates="evidence_files")

    __table_args__ = (
        Index("ix_vendor_questionnaire_evidence_response", "response_id"),
        Index("ix_vendor_questionnaire_evidence_question", "response_id", "question_id"),
    )


class VendorSLARecord(Base):
    """SLA measurement records for a vendor."""
    __tablename__ = "grc_vendor_sla_records"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    sla_metric = Column(String(255), nullable=False)
    target_value = Column(Float, nullable=True)
    actual_value = Column(Float, nullable=True)
    measurement_period = Column(String(50), default="monthly")
    is_compliant = Column(Boolean, default=True)
    notes = Column(Text, nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    vendor = relationship("Vendor", back_populates="sla_records")

    __table_args__ = (
        Index("ix_vendor_sla_record_tenant_vendor", "tenant_id", "vendor_id"),
        Index("ix_vendor_sla_record_period", "vendor_id", "measurement_period"),
    )


class VendorIncident(Base):
    """Operational or security incidents involving a vendor."""
    __tablename__ = "grc_vendor_incidents"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(20), default="medium")
    status = Column(String(50), default="open")
    occurred_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)
    impact_description = Column(Text, nullable=True)
    corrective_actions = Column(Text, nullable=True)
    reported_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    vendor = relationship("Vendor", back_populates="incidents")
    reporter = relationship("GRCUser", foreign_keys=[reported_by])

    __table_args__ = (
        Index("ix_vendor_incident_tenant_vendor", "tenant_id", "vendor_id"),
        Index("ix_vendor_incident_status", "tenant_id", "status"),
        Index("ix_vendor_incident_severity", "tenant_id", "severity"),
    )


# =============================================================================
# IS Projects & Critical Tasks Models
# =============================================================================

class ISProject(Base):
    __tablename__ = "grc_is_projects"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), default="Other")
    priority = Column(String(50), default="Medium")
    status = Column(String(50), default="Planning", index=True)
    health = Column(String(50), default="On Track")
    project_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    project_owner_name = Column(String(255), nullable=True)
    sponsor = Column(String(255), nullable=True)
    department = Column(String(255), nullable=True)
    start_date = Column(DateTime, nullable=True)
    target_end_date = Column(DateTime, nullable=True)
    actual_end_date = Column(DateTime, nullable=True)
    budget_estimated = Column(Float, nullable=True)
    budget_actual = Column(Float, nullable=True)
    business_justification = Column(Text, nullable=True)
    linked_risks = Column(JSON, default=[])
    linked_controls = Column(JSON, default=[])
    linked_frameworks = Column(JSON, default=[])
    completion_percentage = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    project_owner = relationship("GRCUser", foreign_keys=[project_owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    milestones = relationship("ISProjectMilestone", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("ISProjectTask", back_populates="project", cascade="all, delete-orphan")
    team_members = relationship("ISProjectTeamMember", back_populates="project", cascade="all, delete-orphan")
    status_updates = relationship("ISProjectStatusUpdate", back_populates="project", cascade="all, delete-orphan")
    risks = relationship("ISProjectRisk", back_populates="project", cascade="all, delete-orphan")
    documents = relationship("ISProjectDocument", back_populates="project", cascade="all, delete-orphan")
    budget_items = relationship("ISProjectBudgetItem", back_populates="project", cascade="all, delete-orphan")
    compliance_mappings = relationship("ISProjectComplianceMapping", back_populates="project", cascade="all, delete-orphan")
    lessons_learned = relationship("ISProjectLessonLearned", back_populates="project", cascade="all, delete-orphan")
    dependencies = relationship("ISProjectDependency", back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_is_project_tenant", "tenant_id"),
        Index("ix_is_project_status", "tenant_id", "status"),
        Index("ix_is_project_priority", "tenant_id", "priority"),
    )


class ISProjectMilestone(Base):
    __tablename__ = "grc_is_project_milestones"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    target_date = Column(DateTime, nullable=True)
    actual_completion_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="Pending")
    deliverables = Column(JSON, default=[])
    completion_percentage = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="milestones")
    evidence_files = relationship("ISProjectMilestoneEvidence", back_populates="milestone", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_is_project_milestone_project", "project_id"),
        Index("ix_is_project_milestone_status", "project_id", "status"),
    )


class ISProjectMilestoneEvidence(Base):
    """Links an IS project milestone to an uploaded evidence file in grc_evidence."""
    __tablename__ = "grc_is_project_milestone_evidence"

    id = Column(Integer, primary_key=True, index=True)
    milestone_id = Column(Integer, ForeignKey("grc_is_project_milestones.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    uploaded_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    milestone = relationship("ISProjectMilestone", back_populates="evidence_files")
    evidence = relationship("Evidence")

    __table_args__ = (
        Index("ix_is_project_milestone_evidence_milestone", "milestone_id"),
    )


class ISProjectTask(Base):
    __tablename__ = "grc_is_project_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assignee_id = Column(Integer, nullable=True)
    assignee_name = Column(String(255), nullable=True)
    status = Column(String(50), default="To Do")
    priority = Column(String(50), default="Medium")
    due_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    dependencies = Column(JSON, default=[])
    progress = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="tasks")

    __table_args__ = (
        Index("ix_is_project_task_project", "project_id"),
        Index("ix_is_project_task_status", "project_id", "status"),
    )


class ISProjectTeamMember(Base):
    __tablename__ = "grc_is_project_team_members"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    user_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    role = Column(String(100), default="Member")
    responsibilities = Column(Text, nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("ISProject", back_populates="team_members")

    __table_args__ = (
        Index("ix_is_project_team_project", "project_id"),
        Index("ix_is_project_team_user", "project_id", "user_id"),
    )


class ISProjectStatusUpdate(Base):
    __tablename__ = "grc_is_project_status_updates"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    author_id = Column(Integer, nullable=True)
    author_name = Column(String(255), nullable=True)
    update_date = Column(DateTime, default=datetime.utcnow)
    health_status = Column(String(50), default="On Track")
    what_was_done = Column(Text, nullable=True)
    whats_planned = Column(Text, nullable=True)
    blockers = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("ISProject", back_populates="status_updates")

    __table_args__ = (
        Index("ix_is_project_update_project", "project_id"),
        Index("ix_is_project_update_date", "project_id", "update_date"),
    )


class ISProjectRisk(Base):
    __tablename__ = "grc_is_project_risks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(50), default="Risk")
    severity = Column(String(50), default="Medium")
    status = Column(String(50), default="Open")
    mitigation = Column(Text, nullable=True)
    owner_name = Column(String(255), nullable=True)
    identified_date = Column(DateTime, default=datetime.utcnow)
    resolved_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="risks")

    __table_args__ = (
        Index("ix_is_project_risk_project", "project_id"),
        Index("ix_is_project_risk_status", "project_id", "status"),
    )


class ISProjectDocument(Base):
    __tablename__ = "grc_is_project_documents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    document_type = Column(String(100), nullable=True)
    url = Column(String(1000), nullable=True)
    reference_id = Column(String(255), nullable=True)
    reference_type = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_name = Column(String(255), nullable=True)

    project = relationship("ISProject", back_populates="documents")

    __table_args__ = (
        Index("ix_is_project_document_project", "project_id"),
    )


class ISProjectBudgetItem(Base):
    __tablename__ = "grc_is_project_budget_items"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=False)
    amount = Column(Float, default=0)
    date = Column(DateTime, nullable=True)
    status = Column(String(50), default="Pending")
    approved_by = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="budget_items")

    __table_args__ = (
        Index("ix_is_project_budget_project", "project_id"),
        Index("ix_is_project_budget_status", "project_id", "status"),
    )


class ISProjectComplianceMapping(Base):
    __tablename__ = "grc_is_project_compliance_mappings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    control_id = Column(Integer, nullable=True)
    control_name = Column(String(255), nullable=False)
    framework_name = Column(String(255), nullable=False)
    requirement_description = Column(Text, nullable=True)
    deliverable = Column(Text, nullable=True)
    coverage_status = Column(String(50), default="Planned")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="compliance_mappings")

    __table_args__ = (
        Index("ix_is_project_compliance_project", "project_id"),
        Index("ix_is_project_compliance_framework", "project_id", "framework_name"),
    )


class ISProjectLessonLearned(Base):
    __tablename__ = "grc_is_project_lessons_learned"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    category = Column(String(100), default="Recommendation")
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    impact = Column(Text, nullable=True)
    linked_milestone_id = Column(Integer, nullable=True)
    linked_task_id = Column(Integer, nullable=True)
    author_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="lessons_learned")

    __table_args__ = (
        Index("ix_is_project_lesson_project", "project_id"),
    )


class ISProjectDependency(Base):
    __tablename__ = "grc_is_project_dependencies"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    dependency_type = Column(String(50), default="internal")
    dependent_project_id = Column(Integer, nullable=True)
    dependent_project_name = Column(String(255), nullable=True)
    external_dependency = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="Active")
    direction = Column(String(50), default="depends_on")
    impact_if_delayed = Column(Text, nullable=True)
    expected_date = Column(DateTime, nullable=True)
    resolved_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="dependencies")

    __table_args__ = (
        Index("ix_is_project_dependency_project", "project_id"),
    )


class ISProjectHealthSnapshot(Base):
    __tablename__ = "grc_is_project_health_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    snapshot_date = Column(DateTime, default=datetime.utcnow, index=True)
    on_track = Column(Integer, default=0)
    at_risk = Column(Integer, default=0)
    off_track = Column(Integer, default=0)
    total_projects = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_is_project_health_tenant", "tenant_id"),
    )


class CriticalTask(Base):
    __tablename__ = "grc_critical_tasks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source = Column(String(50), default="Manual")
    source_module = Column(String(100), nullable=True)
    source_entity_id = Column(Integer, nullable=True)
    source_entity_type = Column(String(100), nullable=True)
    priority = Column(String(50), default="Medium")
    severity = Column(String(50), nullable=True)
    status = Column(String(50), default="Open", index=True)
    category = Column(String(100), default="Other")
    assigned_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    sla_days = Column(Integer, nullable=True)
    escalation_level = Column(Integer, default=0)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True)
    linked_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True)
    linked_finding_id = Column(Integer, ForeignKey("grc_audit_findings.id"), nullable=True)
    linked_vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=True)
    evidence_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    recurrence_pattern = Column(String(50), nullable=True)
    recurrence_interval = Column(Integer, default=1)
    parent_task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=True)
    next_recurrence_date = Column(DateTime, nullable=True)
    approval_required = Column(Boolean, default=False)
    approval_status = Column(String(50), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    approved_by = relationship("GRCUser", foreign_keys=[approved_by_id])
    parent_task = relationship("CriticalTask", remote_side=[id])
    sub_tasks = relationship("CriticalTaskSubTask", back_populates="task", cascade="all, delete-orphan")
    comments = relationship("CriticalTaskComment", back_populates="task", cascade="all, delete-orphan")
    history = relationship("CriticalTaskHistory", back_populates="task", cascade="all, delete-orphan")
    approvals = relationship("CriticalTaskApproval", back_populates="task", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_critical_task_tenant", "tenant_id"),
        Index("ix_critical_task_status", "tenant_id", "status"),
        Index("ix_critical_task_priority", "tenant_id", "priority"),
        Index("ix_critical_task_due", "tenant_id", "due_date"),
    )


class CriticalTaskSubTask(Base):
    __tablename__ = "grc_critical_task_subtasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    status = Column(String(50), default="Open")
    assigned_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="sub_tasks")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])

    __table_args__ = (
        Index("ix_critical_subtask_task", "task_id"),
        Index("ix_critical_subtask_status", "task_id", "status"),
    )


class CriticalTaskComment(Base):
    __tablename__ = "grc_critical_task_comments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="comments")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_critical_comment_task", "task_id"),
    )


class CriticalTaskHistory(Base):
    __tablename__ = "grc_critical_task_history"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    field_changed = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="history")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_critical_history_task", "task_id"),
        Index("ix_critical_history_action", "task_id", "action"),
    )


class CriticalTaskTemplate(Base):
    __tablename__ = "grc_critical_task_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), default="Other")
    priority = Column(String(50), default="Medium")
    sla_days = Column(Integer, nullable=True)
    sub_tasks_template = Column(JSON, default=[])
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_critical_template_tenant", "tenant_id"),
        UniqueConstraint("tenant_id", "name", name="uq_critical_template_name"),
    )


class CriticalTaskApproval(Base):
    __tablename__ = "grc_critical_task_approvals"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    requested_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="Pending")
    transition_from = Column(String(50), nullable=True)
    transition_to = Column(String(50), nullable=True)
    comment = Column(Text, nullable=True)
    response_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)

    task = relationship("CriticalTask", back_populates="approvals")
    requested_by = relationship("GRCUser", foreign_keys=[requested_by_id])
    approver = relationship("GRCUser", foreign_keys=[approver_id])

    __table_args__ = (
        Index("ix_critical_approval_task", "task_id"),
        Index("ix_critical_approval_status", "task_id", "status"),
    )


class NotificationPreference(Base):
    __tablename__ = "grc_notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    notify_on_assignment = Column(Boolean, default=True)
    notify_on_sla_warning = Column(Boolean, default=True)
    notify_on_sla_breach = Column(Boolean, default=True)
    notify_on_escalation = Column(Boolean, default=True)
    notify_on_approval_request = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_notification_pref_tenant_user"),
    )


# =============================================================================
# Database Initialization Functions
# =============================================================================

def _add_missing_columns():
    """Add any missing columns that may have been added to models but not migrated to database."""
    inspector = inspect(engine)
    
    # Check grc_certification_journeys table for phases_completion column
    try:
        columns = {col['name'] for col in inspector.get_columns('grc_certification_journeys')}
        
        if 'phases_completion' not in columns:
            logger.warning("Adding missing 'phases_completion' column to grc_certification_journeys table...")
            with engine.begin() as conn:
                if DATABASE_URL.startswith('sqlite'):
                    sql = text("ALTER TABLE grc_certification_journeys ADD COLUMN phases_completion TEXT")
                else:
                    sql = text("ALTER TABLE grc_certification_journeys ADD COLUMN phases_completion JSON")
                
                conn.execute(sql)
                logger.info("✓ Successfully added phases_completion column")
    except Exception as e:
        # Table might not exist yet (new installation), which is fine
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            logger.debug("grc_certification_journeys table not found - will be created")
        else:
            logger.error(f"Error checking/adding columns: {e}")

    # Ensure grc_framework_risk_assessments.framework_id is nullable (old schemas had NOT NULL)
    try:
        fw_cols = {col['name']: col for col in inspector.get_columns('grc_framework_risk_assessments')}
        needs_nullable_fix = False
        if 'framework_id' in fw_cols:
            col_info = fw_cols['framework_id']
            # nullable=False means NOT NULL constraint is set
            if not col_info.get('nullable', True):
                needs_nullable_fix = True
        if needs_nullable_fix:
            logger.warning("Migrating grc_framework_risk_assessments: making framework_id nullable...")
            with engine.begin() as conn:
                if DATABASE_URL.startswith('sqlite'):
                    # SQLite requires table recreation to drop a NOT NULL constraint
                    conn.execute(text("PRAGMA foreign_keys=off"))
                    conn.execute(text(
                        "ALTER TABLE grc_framework_risk_assessments "
                        "RENAME TO grc_framework_risk_assessments_bak"
                    ))
                    conn.execute(text("""
                        CREATE TABLE grc_framework_risk_assessments (
                            id INTEGER NOT NULL PRIMARY KEY,
                            tenant_id INTEGER NOT NULL REFERENCES grc_tenants(id),
                            framework_id INTEGER REFERENCES grc_frameworks(id),
                            uploaded_framework_id INTEGER REFERENCES grc_uploaded_frameworks(id),
                            name VARCHAR(255) NOT NULL,
                            description TEXT,
                            status VARCHAR(50),
                            created_by INTEGER NOT NULL REFERENCES grc_users(id),
                            created_at DATETIME,
                            updated_at DATETIME
                        )
                    """))
                    conn.execute(text("""
                        INSERT INTO grc_framework_risk_assessments
                            (id, tenant_id, framework_id, uploaded_framework_id,
                             name, description, status, created_by, created_at, updated_at)
                        SELECT id, tenant_id, framework_id, uploaded_framework_id,
                               name, description, status, created_by, created_at, updated_at
                        FROM grc_framework_risk_assessments_bak
                    """))
                    conn.execute(text("DROP TABLE grc_framework_risk_assessments_bak"))
                    conn.execute(text("PRAGMA foreign_keys=on"))
                else:
                    conn.execute(text(
                        "ALTER TABLE grc_framework_risk_assessments "
                        "ALTER COLUMN framework_id DROP NOT NULL"
                    ))
            logger.info("✓ framework_id is now nullable in grc_framework_risk_assessments")
    except Exception as e:
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            logger.debug("grc_framework_risk_assessments table not found - will be created")
        else:
            logger.error(f"Error fixing framework_id nullable: {e}")

    # Ensure vulnerability SLA config has notification/escalation columns
    try:
        sla_columns = {col['name'] for col in inspector.get_columns('grc_vulnerability_sla_config')}
        with engine.begin() as conn:
            if 'notification_days' not in sla_columns:
                logger.warning("Adding missing 'notification_days' column to grc_vulnerability_sla_config...")
                conn.execute(text("ALTER TABLE grc_vulnerability_sla_config ADD COLUMN notification_days INTEGER"))
                logger.info("✓ Successfully added notification_days column")
            if 'escalation_days' not in sla_columns:
                logger.warning("Adding missing 'escalation_days' column to grc_vulnerability_sla_config...")
                conn.execute(text("ALTER TABLE grc_vulnerability_sla_config ADD COLUMN escalation_days INTEGER"))
                logger.info("✓ Successfully added escalation_days column")
    except Exception as e:
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            logger.debug("grc_vulnerability_sla_config table not found - will be created")
        else:
            logger.error(f"Error checking/adding SLA columns: {e}")

    # Ensure framework risk questions include risk assessment scoring and acceptance columns
    try:
        frq_columns = {col['name'] for col in inspector.get_columns('grc_framework_risk_questions')}
        with engine.begin() as conn:
            if 'inherent_likelihood' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN inherent_likelihood INTEGER"))
            if 'inherent_impact' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN inherent_impact INTEGER"))
            if 'inherent_score' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN inherent_score FLOAT"))
            if 'residual_likelihood' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN residual_likelihood INTEGER"))
            if 'residual_impact' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN residual_impact INTEGER"))
            if 'residual_score' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN residual_score FLOAT"))
            if 'is_risk_accepted' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN is_risk_accepted BOOLEAN"))
            if 'acceptance_notes' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN acceptance_notes TEXT"))
            if 'linked_risk_id' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN linked_risk_id INTEGER"))
            if 'moved_to_risk_register_at' not in frq_columns:
                conn.execute(text("ALTER TABLE grc_framework_risk_questions ADD COLUMN moved_to_risk_register_at DATETIME"))
    except Exception as e:
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            logger.debug("grc_framework_risk_questions table not found - will be created")
        else:
            logger.error(f"Error checking/adding framework risk question columns: {e}")

    # Ensure grc_risks has ubl_fields column for UBL template-specific fields
    try:
        risk_columns = {col['name'] for col in inspector.get_columns('grc_risks')}
        if 'ubl_fields' not in risk_columns:
            logger.warning("Adding missing 'ubl_fields' column to grc_risks...")
            with engine.begin() as conn:
                if DATABASE_URL.startswith('sqlite'):
                    conn.execute(text("ALTER TABLE grc_risks ADD COLUMN ubl_fields TEXT"))
                else:
                    conn.execute(text("ALTER TABLE grc_risks ADD COLUMN ubl_fields JSON"))
            logger.info("✓ Successfully added ubl_fields column")
    except Exception as e:
        if "does not exist" in str(e).lower() or "no such table" in str(e).lower():
            logger.debug("grc_risks table not found - will be created")
        else:
            logger.error(f"Error checking/adding grc_risks.ubl_fields: {e}")


def init_grc_db():
    """Create all GRC tables in the database and seed framework data."""
    Base.metadata.create_all(bind=engine)
    
    # Add any missing columns that may have been added to models
    # _add_missing_columns()
    
    # from .seed_frameworks import seed_frameworks, seed_uploaded_frameworks
    # seed_frameworks()
    
    # seed_uploaded_frameworks()
    
    # from .seed_subcontrols import seed_subcontrols
    # seed_subcontrols()
    
    # from .seed_evidence_items import seed_curated_evidence_items
    # seed_curated_evidence_items()
    
    # from .seed_control_evidence import seed_control_evidence
    # seed_control_evidence()
    
    # from .seed_certification_phases import seed_certification_phases
    # seed_certification_phases()
    
    # Internal controls are now only created when users upload policies and select statements to convert
    # No pre-seeded controls - all controls come from user-uploaded policy documents
    
    # from .seed_vulnerabilities import seed_vulnerability_data
    # seed_vulnerability_data()
    
    # from .seed_vuln_workflows import seed_default_vuln_workflow
    # seed_default_vuln_workflow()

    # from .seed_workflow_engine_defaults import seed_workflow_engine_defaults
    # seed_workflow_engine_defaults()
    
    # from .seed_rcsa_templates import seed_rcsa_templates
    # seed_rcsa_templates()
    
    # from .seed_committees import seed_committees
    # seed_committees()


def get_db():
    """FastAPI dependency for database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
