from ._30_compliance_assessment_documents_models import *  # noqa: F401,F403

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

