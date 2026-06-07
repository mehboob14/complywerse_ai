from ._17_framework_upload_parsing_models import *  # noqa: F401,F403

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
    assigned_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)

    # Relationships
    tenant = relationship("Tenant")
    document = relationship("GovernanceDocument", back_populates="policy_statements")
    document_version = relationship("GovernanceDocumentVersion")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    assignee = relationship("GRCUser", foreign_keys=[assigned_to_user_id])
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

