from ._19_policy_gap_analysis_models import *  # noqa: F401,F403

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

