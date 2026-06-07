from ._09_1_unified_common_control_library_models import *  # noqa: F401,F403

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
    # Designated owner of the evidence (separate from `uploaded_by`, which
    # is just whichever user happened to drop the file). The owner is who
    # the workflow holds responsible for keeping it current.
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
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

