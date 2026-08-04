from ._20_customizable_workflow_models import *  # noqa: F401,F403

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

