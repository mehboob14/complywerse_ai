from ._33_integrations_module_vulnerability_scanner_integration import *  # noqa: F401,F403

# =============================================================================
# 22. Workflow Automation Engine (Standalone, Config-Driven)
# =============================================================================

class WorkflowDefinition(Base):
    __tablename__ = "grc_workflow_definitions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    version = Column(Integer, default=1)
    is_active = Column(Boolean, default=True, index=True)
    trigger_event = Column(String(255), nullable=False, index=True)   # primary trigger (back-compat + index)
    trigger_conditions = Column(JSON, default={})
    # Multi-trigger OR logic: the workflow fires when ANY of these platform
    # events occurs. `trigger_event` remains the primary/first entry (keeps the
    # existing NOT NULL + tenant_trigger index working); the full set lives here.
    trigger_events = Column(JSON, default=list)
    definition_json = Column(JSON, default={})  # Canvas viewport/layout state (zoom, pan, positions)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    updated_by = relationship("GRCUser", foreign_keys=[updated_by_id])
    nodes = relationship("WorkflowNode", back_populates="workflow_definition", cascade="all, delete-orphan")
    edges = relationship("WorkflowEdge", back_populates="workflow_definition", cascade="all, delete-orphan")
    instances = relationship("WorkflowInstance", back_populates="workflow_definition", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_definition_tenant_trigger", "tenant_id", "trigger_event"),
    )


class WorkflowNode(Base):
    __tablename__ = "grc_workflow_nodes"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    node_key = Column(String(100), nullable=False)  # Unique key within the workflow
    node_type = Column(String(255), nullable=False, index=True)  # Node type ID from catalog
    name = Column(String(255), nullable=False)  # Display name for this node instance
    config = Column(JSON, default={})  # Node-specific configuration
    position_x = Column(Float, default=0)  # Canvas X position
    position_y = Column(Float, default=0)  # Canvas Y position
    is_start = Column(Boolean, default=False)
    is_terminal = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    workflow_definition = relationship("WorkflowDefinition", back_populates="nodes")

    __table_args__ = (
        Index("ix_workflow_node_definition_key", "workflow_definition_id", "node_key"),
    )


class WorkflowEdge(Base):
    __tablename__ = "grc_workflow_edges"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    source_node_key = Column(String(100), nullable=False, index=True)
    target_node_key = Column(String(100), nullable=False, index=True)
    condition = Column(JSON, default={})  # Conditional logic, label, handles stored here
    priority = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)

    workflow_definition = relationship("WorkflowDefinition", back_populates="edges")

    __table_args__ = (
        Index("ix_workflow_edge_source", "workflow_definition_id", "source_node_key"),
        Index("ix_workflow_edge_target", "workflow_definition_id", "target_node_key"),
    )


class WorkflowInstance(Base):
    __tablename__ = "grc_workflow_instances"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    status = Column(String(50), default="running", index=True)
    current_node_key = Column(String(100), nullable=True)
    trigger_event = Column(String(255), nullable=True, index=True)
    trigger_payload = Column(JSON, default={})
    context = Column(JSON, default={})
    correlation_id = Column(String(255), nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow, index=True)
    completed_at = Column(DateTime, nullable=True)
    failed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    workflow_definition = relationship("WorkflowDefinition", back_populates="instances")
    tenant = relationship("Tenant")
    steps = relationship("WorkflowEngineStep", back_populates="workflow_instance", cascade="all, delete-orphan")
    audit_logs = relationship("WorkflowAuditLog", back_populates="workflow_instance", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_instance_tenant_status", "tenant_id", "status"),
    )


class WorkflowEngineStep(Base):
    __tablename__ = "grc_workflow_engine_steps"

    id = Column(Integer, primary_key=True, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False, index=True)
    node_key = Column(String(100), nullable=False)
    node_type = Column(String(50), nullable=False)
    status = Column(String(50), default="pending", index=True)
    input_payload = Column(JSON, default={})
    output_payload = Column(JSON, default={})
    attempts = Column(Integer, default=0)
    assigned_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)

    workflow_instance = relationship("WorkflowInstance", back_populates="steps")
    assigned_to_user = relationship("GRCUser")
    approvals = relationship("ApprovalRequest", back_populates="workflow_step", cascade="all, delete-orphan")
    audit_logs = relationship("WorkflowAuditLog", back_populates="workflow_step", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_workflow_step_instance_status", "workflow_instance_id", "status"),
    )


class ApprovalRequest(Base):
    __tablename__ = "grc_workflow_approval_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=False, index=True)
    workflow_step_id = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=False, index=True)
    status = Column(String(50), default="pending", index=True)
    approval_type = Column(String(50), default="single")
    required_approvals = Column(Integer, default=1)
    received_approvals = Column(Integer, default=0)
    approver_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_role = Column(String(100), nullable=True)
    decision_comment = Column(Text, nullable=True)
    due_at = Column(DateTime, nullable=True, index=True)
    responded_at = Column(DateTime, nullable=True)
    request_metadata = Column(JSON, default={})
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    workflow_instance = relationship("WorkflowInstance")
    workflow_step = relationship("WorkflowEngineStep", back_populates="approvals")
    approver_user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_approval_tenant_status", "tenant_id", "status"),
    )


class WorkflowAuditLog(Base):
    __tablename__ = "grc_workflow_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=True, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=True, index=True)
    workflow_step_id = Column(Integer, ForeignKey("grc_workflow_engine_steps.id"), nullable=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    message = Column(Text, nullable=True)
    payload = Column(JSON, default={})
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    tenant = relationship("Tenant")
    workflow_definition = relationship("WorkflowDefinition")
    workflow_instance = relationship("WorkflowInstance", back_populates="audit_logs")
    workflow_step = relationship("WorkflowEngineStep", back_populates="audit_logs")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_audit_tenant_created", "tenant_id", "created_at"),
    )


class WorkflowDefinitionVersion(Base):
    __tablename__ = "grc_workflow_definition_versions"

    id = Column(Integer, primary_key=True, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    version_number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    trigger_event = Column(String(255), nullable=False)
    trigger_conditions = Column(JSON, default={})
    definition_json = Column(JSON, default={})
    nodes_json = Column(JSON, default=[])
    edges_json = Column(JSON, default=[])
    change_summary = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    workflow_definition = relationship("WorkflowDefinition")
    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_definition_version", "workflow_definition_id", "version_number"),
        UniqueConstraint("workflow_definition_id", "version_number", name="uq_workflow_definition_version"),
    )


class WorkflowEngineTemplate(Base):
    __tablename__ = "grc_workflow_engine_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True, index=True)
    trigger_event = Column(String(255), nullable=False)
    trigger_conditions = Column(JSON, default={})
    definition_json = Column(JSON, default={})
    nodes_json = Column(JSON, default=[])
    edges_json = Column(JSON, default=[])
    tags = Column(JSON, default=[])
    is_system_template = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_template_tenant_category", "tenant_id", "category"),
        Index("ix_workflow_template_tenant_active", "tenant_id", "is_active"),
    )


class WorkflowEngineSchedule(Base):
    __tablename__ = "grc_workflow_engine_schedules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    workflow_definition_id = Column(Integer, ForeignKey("grc_workflow_definitions.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    schedule_type = Column(String(50), default="interval")  # interval, once
    interval_minutes = Column(Integer, nullable=True)
    run_at = Column(DateTime, nullable=True)
    next_run_at = Column(DateTime, nullable=True, index=True)
    payload = Column(JSON, default={})
    is_active = Column(Boolean, default=True, index=True)
    last_run_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    workflow_definition = relationship("WorkflowDefinition")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_schedule_tenant_next", "tenant_id", "next_run_at"),
    )


class WorkflowEngineWebhookEndpoint(Base):
    __tablename__ = "grc_workflow_engine_webhooks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    token = Column(String(255), nullable=False, unique=True, index=True)
    event_name = Column(String(255), nullable=False, index=True)
    callback_url = Column(String(1000), nullable=True)
    secret = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True, index=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    created_by = relationship("GRCUser")

    __table_args__ = (
        Index("ix_workflow_webhook_tenant_event", "tenant_id", "event_name"),
    )


class WorkflowEmailConfiguration(Base):
    """Email configuration for workflow notifications"""
    __tablename__ = "grc_workflow_email_configs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    config_name = Column(String(255), nullable=False)
    smtp_host = Column(String(255), nullable=False)
    smtp_port = Column(Integer, default=587)
    smtp_username = Column(String(255), nullable=False)
    smtp_password = Column(String(500), nullable=False)  # Should be encrypted in production
    from_email = Column(String(255), nullable=False)
    from_name = Column(String(255), nullable=True)
    use_tls = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        UniqueConstraint("tenant_id", "config_name", name="uq_workflow_email_config_tenant_name"),
    )


class WorkflowNotification(Base):
    """In-app notifications for workflow events"""
    __tablename__ = "grc_workflow_notifications"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    workflow_instance_id = Column(Integer, ForeignKey("grc_workflow_instances.id"), nullable=True, index=True)
    notification_type = Column(String(50), default="info")  # info, success, warning, error
    subject = Column(String(500), nullable=False)
    message = Column(Text, nullable=False)
    is_read = Column(Boolean, default=False, index=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")
    workflow_instance = relationship("WorkflowInstance")

    __table_args__ = (
        Index("ix_workflow_notification_user_read", "user_id", "is_read"),
    )

