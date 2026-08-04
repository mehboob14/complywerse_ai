from ._00_base import *  # noqa: F401,F403

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

