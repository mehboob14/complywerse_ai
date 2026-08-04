from ._34_workflow_automation_engine_standalone_config_driven import *  # noqa: F401,F403

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
    # ── TPRA 8-stage lifecycle (additive) ─────────────────────────────────────
    # Current lifecycle stage: intake → tiering → due_diligence → rating →
    # remediation → contracting → monitoring → offboarding (+ terminated).
    lifecycle_stage = Column(String(40), default="intake", index=True)
    # Append-only audit of stage transitions: [{stage, at, by, note}].
    lifecycle_history = Column(JSON, default=list)
    # Stage 7 — continuous monitoring cadence + next due date.
    reassessment_cadence_days = Column(Integer, nullable=True)
    next_reassessment_date = Column(DateTime, nullable=True)
    # Stage 6 — link the executed contract to a Governance Document (loose
    # coupling: plain id, no FK/relationship to avoid cross-module constraints).
    contract_document_id = Column(Integer, nullable=True)
    # Stage 8 — offboarding checklist: [{item, done, at, by}].
    offboarding_checklist = Column(JSON, default=list)
    # Stage 5 — remediation/treatment tracker: [{id, finding_ref, title, action,
    # treatment_type, severity, owner_id, due_date, status, accepted_by,
    # accepted_at, rationale, created_at}].
    remediation_actions = Column(JSON, default=list)
    # ── TPRA productionization (additive; see _41_tpra_lifecycle_models) ───────
    # Pointer to the vendor's current (latest, non-superseded) assessment version.
    active_assessment_id = Column(Integer, nullable=True, index=True)
    # Soft-delete: vendors carry history, so they are never hard-deleted.
    deleted_at = Column(DateTime, nullable=True)
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
    # Stage 4 — AI gap analysis output (residual vs inherent delta): list of
    # {gap, control_ref, severity, inherent_contribution, residual_after_controls}.
    gap_analysis = Column(JSON, default=list)
    # Stage 4→linkage — the Risk Register entry created/updated on approval.
    linked_risk_id = Column(Integer, nullable=True, index=True)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    # ── TPRA productionization: versioned assessment + lifecycle (additive) ────
    # Version chain so reassessments never overwrite prior history.
    version_no = Column(Integer, default=1)
    supersedes_id = Column(Integer, nullable=True, index=True)
    # Lifecycle status of THIS assessment version: active | superseded | archived.
    lifecycle_status = Column(String(30), default="active", index=True)
    # Current stage key (mirrors the latest in-progress TPRAStageInstance).
    current_stage = Column(String(40), default="intake", index=True)
    inherent_tier = Column(String(20), nullable=True)     # critical | high | medium | low
    residual_rating = Column(String(20), nullable=True)
    rating_grade = Column(String(2), nullable=True)       # A–F at-a-glance grade
    # Per-domain residual breakdown: {domain_key: {inherent, residual, score}}.
    domain_scores = Column(JSON, default=dict)
    # Assessment-level RACI team roster (assign once, reused across all stages):
    # {role_key: user_id} e.g. {"business_owner": 4, "tprm_lead": 7, ...}.
    team_roster = Column(JSON, default=dict)
    # Optimistic-concurrency token for edits.
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
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
    # Linkage — the Issue auto-created for a critical incident (loose: plain id).
    linked_issue_id = Column(Integer, nullable=True, index=True)
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

