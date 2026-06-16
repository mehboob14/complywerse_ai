from ._18_policy_statement_compliance_models import *  # noqa: F401,F403

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
    # Live progress while running. Set to len(controls) at start, incremented
    # as each control is processed. Read by the UI to show a real % bar
    # instead of an indeterminate sweep.
    clauses_total = Column(Integer, default=0)
    clauses_processed = Column(Integer, default=0)

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

    # AI-drafted clause text proposed to close this gap. Populated on demand
    # via the /findings/{id}/generate-fix endpoint and shown to the user in a
    # human-in-the-loop modal where they can edit it before applying.
    suggested_clause_text = Column(Text, nullable=True)
    suggested_clause_generated_at = Column(DateTime, nullable=True)
    # Side-by-side replace flow: the AI may identify a specific block of
    # existing policy text that the proposed clause should *replace* (rather
    # than appending). `replacement_mode` is "replace" or "append";
    # `original_clause_text` is the verbatim slice from document.content the
    # AI matched against (null when mode == "append").
    replacement_mode = Column(String(20), nullable=True)
    original_clause_text = Column(Text, nullable=True)
    # Audit fields populated when the user applies the (possibly edited)
    # suggestion to the document content.
    applied_at = Column(DateTime, nullable=True)
    applied_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    applied_clause_text = Column(Text, nullable=True)
    applied_version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    analysis_run = relationship("PolicyGapAnalysisRun", back_populates="findings")
    document = relationship("GovernanceDocument")
    framework = relationship("UploadedFramework")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])
    risk_acceptance_approver = relationship("GRCUser", foreign_keys=[risk_acceptance_approved_by])
    override_user = relationship("GRCUser", foreign_keys=[overridden_by])
    applier = relationship("GRCUser", foreign_keys=[applied_by])
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

