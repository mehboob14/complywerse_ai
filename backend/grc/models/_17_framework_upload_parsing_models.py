from ._16_certification_journey_models import *  # noqa: F401,F403

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
    # Native implementation-order priority preserved verbatim from frameworks
    # that phase rollout by priority tier rather than severity (e.g. NDMO
    # P1/P2/P3 → Year 1/2/3 of the 3-year compliance roadmap). NULL for
    # frameworks that have no such tier. Distinct from `priority`, which is the
    # generic high/medium/low severity bucket used across the platform.
    priority_level = Column(String(10), nullable=True)  # e.g. P1, P2, P3
    # Prerequisite controls this control depends on (e.g. NDMO control-level
    # "Dependencies" — DG.2 depends on DG.1). List of original reference codes.
    dependencies = Column(JSON, default=list)
    # Per-control version history rows from frameworks that carry it (NDMO's
    # "Version History" table — Date + Version). List of {date, version}.
    version_history = Column(JSON, default=list)
    # Control-level description (NDMO Figure-2 "Control Description"), distinct
    # from each specification's own description. Denormalised onto every spec
    # under the control so the flat model can render the boxed control card.
    control_description = Column(Text, nullable=True)
    # Assessment criteria — the numbered "…shall include, at minimum: 1… 2…"
    # items parsed out of the specification's Control Specification text. These
    # are the testable checklist a consultant verifies (NDMO binary per-spec
    # scoring: all must be met for 100%). Empty list = single-statement spec
    # (the requirement itself is the one binary check). List of strings.
    assessment_criteria = Column(JSON, default=list)

    section_number = Column(String(50), nullable=True)
    parent_section = Column(String(255), nullable=True)
    
    ai_confidence = Column(Float, nullable=True)  # AI extraction confidence
    ai_notes = Column(Text, nullable=True)  # AI processing notes
    evidence_requirements = Column(JSON, default=list)  # AI-recommended evidence types
    
    is_verified = Column(Boolean, default=False)  # Human-verified
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)

    # AI-driven criticality assessment. Populated on demand by the
    # /certifications/{journey_id}/analyze-critical endpoint. When True the
    # control is treated as a red-flag clause: the applicability self-approve
    # path is suppressed and the request stays pending for reviewer approval.
    is_critical = Column(Boolean, default=False, nullable=True)
    criticality_reason = Column(Text, nullable=True)
    criticality_analyzed_at = Column(DateTime, nullable=True)

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
        Index("ix_parsed_control_critical", "is_critical"),
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

    # Statement-of-Applicability template fields (owner / implementation status /
    # linked policy or evidence). Added additively — see compliance schema_migrations.
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    owner_name = Column(String(255), nullable=True)
    implementation_status = Column(String(50), nullable=True)  # not_started, in_progress, implemented, verified, not_applicable
    linked_evidence_id = Column(Integer, nullable=True)  # id in the central evidence library

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


class FrameworkControlOwnership(Base):
    """Standalone per-control owner + implementation status, independent of any
    certification journey. Lets the Controls workbench assign an owner and set the
    implementation stage directly on a parsed framework control (one record per
    control; the per-tenant DB scopes it). Surfaced via the framework-controls
    status-summary, where it OVERRIDES journey-derived status when present.
    """
    __tablename__ = "grc_framework_control_ownership"

    id = Column(Integer, primary_key=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, unique=True, index=True)
    status = Column(String(50), default="not_started")  # not_started|in_progress|implemented|verified|not_applicable
    assigned_user_ids = Column(JSON, default=list)       # ordered GRCUser ids; first = primary owner
    implementation_date = Column(DateTime, nullable=True)
    verified_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    parsed_control = relationship("ParsedFrameworkControl")

