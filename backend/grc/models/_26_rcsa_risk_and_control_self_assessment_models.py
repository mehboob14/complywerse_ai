from ._25_vulnerability_workflow_template_models import *  # noqa: F401,F403

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

