from ._35_vendor_risk_management_models import *  # noqa: F401,F403

# =============================================================================
# IS Projects & Critical Tasks Models
# =============================================================================

class ISProject(Base):
    __tablename__ = "grc_is_projects"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), default="Other")
    priority = Column(String(50), default="Medium")
    status = Column(String(50), default="Planning", index=True)
    health = Column(String(50), default="On Track")
    project_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    project_owner_name = Column(String(255), nullable=True)
    sponsor = Column(String(255), nullable=True)
    department = Column(String(255), nullable=True)
    start_date = Column(DateTime, nullable=True)
    target_end_date = Column(DateTime, nullable=True)
    actual_end_date = Column(DateTime, nullable=True)
    budget_estimated = Column(Float, nullable=True)
    budget_actual = Column(Float, nullable=True)
    business_justification = Column(Text, nullable=True)
    linked_risks = Column(JSON, default=[])
    linked_controls = Column(JSON, default=[])
    linked_frameworks = Column(JSON, default=[])
    completion_percentage = Column(Integer, default=0)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    project_owner = relationship("GRCUser", foreign_keys=[project_owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    milestones = relationship("ISProjectMilestone", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("ISProjectTask", back_populates="project", cascade="all, delete-orphan")
    team_members = relationship("ISProjectTeamMember", back_populates="project", cascade="all, delete-orphan")
    status_updates = relationship("ISProjectStatusUpdate", back_populates="project", cascade="all, delete-orphan")
    risks = relationship("ISProjectRisk", back_populates="project", cascade="all, delete-orphan")
    documents = relationship("ISProjectDocument", back_populates="project", cascade="all, delete-orphan")
    budget_items = relationship("ISProjectBudgetItem", back_populates="project", cascade="all, delete-orphan")
    compliance_mappings = relationship("ISProjectComplianceMapping", back_populates="project", cascade="all, delete-orphan")
    lessons_learned = relationship("ISProjectLessonLearned", back_populates="project", cascade="all, delete-orphan")
    dependencies = relationship("ISProjectDependency", back_populates="project", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_is_project_tenant", "tenant_id"),
        Index("ix_is_project_status", "tenant_id", "status"),
        Index("ix_is_project_priority", "tenant_id", "priority"),
    )


class ISProjectMilestone(Base):
    __tablename__ = "grc_is_project_milestones"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    target_date = Column(DateTime, nullable=True)
    actual_completion_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="Pending")
    deliverables = Column(JSON, default=[])
    completion_percentage = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="milestones")
    evidence_files = relationship("ISProjectMilestoneEvidence", back_populates="milestone", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_is_project_milestone_project", "project_id"),
        Index("ix_is_project_milestone_status", "project_id", "status"),
    )


class ISProjectMilestoneEvidence(Base):
    """Links an IS project milestone to an uploaded evidence file in grc_evidence."""
    __tablename__ = "grc_is_project_milestone_evidence"

    id = Column(Integer, primary_key=True, index=True)
    milestone_id = Column(Integer, ForeignKey("grc_is_project_milestones.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    uploaded_by_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    milestone = relationship("ISProjectMilestone", back_populates="evidence_files")
    evidence = relationship("Evidence")

    __table_args__ = (
        Index("ix_is_project_milestone_evidence_milestone", "milestone_id"),
    )


class ISProjectTask(Base):
    __tablename__ = "grc_is_project_tasks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assignee_id = Column(Integer, nullable=True)
    assignee_name = Column(String(255), nullable=True)
    status = Column(String(50), default="To Do")
    priority = Column(String(50), default="Medium")
    due_date = Column(DateTime, nullable=True)
    completed_date = Column(DateTime, nullable=True)
    dependencies = Column(JSON, default=[])
    progress = Column(Integer, default=0)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="tasks")

    __table_args__ = (
        Index("ix_is_project_task_project", "project_id"),
        Index("ix_is_project_task_status", "project_id", "status"),
    )


class ISProjectTeamMember(Base):
    __tablename__ = "grc_is_project_team_members"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    user_id = Column(Integer, nullable=True)
    user_name = Column(String(255), nullable=True)
    email = Column(String(255), nullable=True)
    role = Column(String(100), default="Member")
    responsibilities = Column(Text, nullable=True)
    joined_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("ISProject", back_populates="team_members")

    __table_args__ = (
        Index("ix_is_project_team_project", "project_id"),
        Index("ix_is_project_team_user", "project_id", "user_id"),
    )


class ISProjectStatusUpdate(Base):
    __tablename__ = "grc_is_project_status_updates"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    author_id = Column(Integer, nullable=True)
    author_name = Column(String(255), nullable=True)
    update_date = Column(DateTime, default=datetime.utcnow)
    health_status = Column(String(50), default="On Track")
    what_was_done = Column(Text, nullable=True)
    whats_planned = Column(Text, nullable=True)
    blockers = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    project = relationship("ISProject", back_populates="status_updates")

    __table_args__ = (
        Index("ix_is_project_update_project", "project_id"),
        Index("ix_is_project_update_date", "project_id", "update_date"),
    )


class ISProjectRisk(Base):
    __tablename__ = "grc_is_project_risks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(String(50), default="Risk")
    severity = Column(String(50), default="Medium")
    status = Column(String(50), default="Open")
    mitigation = Column(Text, nullable=True)
    owner_name = Column(String(255), nullable=True)
    identified_date = Column(DateTime, default=datetime.utcnow)
    resolved_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="risks")

    __table_args__ = (
        Index("ix_is_project_risk_project", "project_id"),
        Index("ix_is_project_risk_status", "project_id", "status"),
    )


class ISProjectDocument(Base):
    __tablename__ = "grc_is_project_documents"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    document_type = Column(String(100), nullable=True)
    url = Column(String(1000), nullable=True)
    reference_id = Column(String(255), nullable=True)
    reference_type = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by_name = Column(String(255), nullable=True)

    project = relationship("ISProject", back_populates="documents")

    __table_args__ = (
        Index("ix_is_project_document_project", "project_id"),
    )


class ISProjectBudgetItem(Base):
    __tablename__ = "grc_is_project_budget_items"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=False)
    amount = Column(Float, default=0)
    date = Column(DateTime, nullable=True)
    status = Column(String(50), default="Pending")
    approved_by = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="budget_items")

    __table_args__ = (
        Index("ix_is_project_budget_project", "project_id"),
        Index("ix_is_project_budget_status", "project_id", "status"),
    )


class ISProjectComplianceMapping(Base):
    __tablename__ = "grc_is_project_compliance_mappings"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    control_id = Column(Integer, nullable=True)
    control_name = Column(String(255), nullable=False)
    framework_name = Column(String(255), nullable=False)
    requirement_description = Column(Text, nullable=True)
    deliverable = Column(Text, nullable=True)
    coverage_status = Column(String(50), default="Planned")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="compliance_mappings")

    __table_args__ = (
        Index("ix_is_project_compliance_project", "project_id"),
        Index("ix_is_project_compliance_framework", "project_id", "framework_name"),
    )


class ISProjectLessonLearned(Base):
    __tablename__ = "grc_is_project_lessons_learned"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    category = Column(String(100), default="Recommendation")
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    impact = Column(Text, nullable=True)
    linked_milestone_id = Column(Integer, nullable=True)
    linked_task_id = Column(Integer, nullable=True)
    author_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="lessons_learned")

    __table_args__ = (
        Index("ix_is_project_lesson_project", "project_id"),
    )


class ISProjectDependency(Base):
    __tablename__ = "grc_is_project_dependencies"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    dependency_type = Column(String(50), default="internal")
    dependent_project_id = Column(Integer, nullable=True)
    dependent_project_name = Column(String(255), nullable=True)
    external_dependency = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="Active")
    direction = Column(String(50), default="depends_on")
    impact_if_delayed = Column(Text, nullable=True)
    expected_date = Column(DateTime, nullable=True)
    resolved_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("ISProject", back_populates="dependencies")

    __table_args__ = (
        Index("ix_is_project_dependency_project", "project_id"),
    )


class ISProjectHealthSnapshot(Base):
    __tablename__ = "grc_is_project_health_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    snapshot_date = Column(DateTime, default=datetime.utcnow, index=True)
    on_track = Column(Integer, default=0)
    at_risk = Column(Integer, default=0)
    off_track = Column(Integer, default=0)
    total_projects = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_is_project_health_tenant", "tenant_id"),
    )


class CriticalTask(Base):
    __tablename__ = "grc_critical_tasks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    source = Column(String(50), default="Manual")
    source_module = Column(String(100), nullable=True)
    source_entity_id = Column(Integer, nullable=True)
    source_entity_type = Column(String(100), nullable=True)
    priority = Column(String(50), default="Medium")
    severity = Column(String(50), nullable=True)
    status = Column(String(50), default="Open", index=True)
    category = Column(String(100), default="Other")
    assigned_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    # Canonical multi-assignment list. The legacy `assigned_owner_id` above is
    # kept and auto-synced to the first entry for back-compat.
    assigned_user_ids = Column(JSON, default=list)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    sla_days = Column(Integer, nullable=True)
    escalation_level = Column(Integer, default=0)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True)
    linked_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True)
    linked_vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=True)
    # Soft references to the certification framework + requirement (control
    # implementation) that this task originates from. Soft (no FK) so the row
    # remains valid if the journey/control is later renamed or replaced.
    linked_framework_id = Column(Integer, nullable=True, index=True)
    linked_requirement_id = Column(Integer, nullable=True, index=True)
    # ── v2: bidirectional link from a Critical Task back to the Issue +
    # CAPA action that spawned it (when promoted via the issues UI). Used
    # by the Critical Task detail page to surface a "Linked Issue" chip
    # and by the status-sync helper to mirror task status onto IssueAction.
    linked_issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=True, index=True)
    linked_issue_action_id = Column(Integer, ForeignKey("grc_issue_actions.id"), nullable=True, index=True)
    evidence_notes = Column(Text, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    recurrence_pattern = Column(String(50), nullable=True)
    recurrence_interval = Column(Integer, default=1)
    parent_task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=True)
    next_recurrence_date = Column(DateTime, nullable=True)
    approval_required = Column(Boolean, default=False)
    approval_status = Column(String(50), nullable=True)
    approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    created_by = relationship("GRCUser", foreign_keys=[created_by_id])
    approved_by = relationship("GRCUser", foreign_keys=[approved_by_id])
    parent_task = relationship("CriticalTask", remote_side=[id])
    sub_tasks = relationship("CriticalTaskSubTask", back_populates="task", cascade="all, delete-orphan")
    comments = relationship("CriticalTaskComment", back_populates="task", cascade="all, delete-orphan")
    history = relationship("CriticalTaskHistory", back_populates="task", cascade="all, delete-orphan")
    approvals = relationship("CriticalTaskApproval", back_populates="task", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_critical_task_tenant", "tenant_id"),
        Index("ix_critical_task_status", "tenant_id", "status"),
        Index("ix_critical_task_priority", "tenant_id", "priority"),
        Index("ix_critical_task_due", "tenant_id", "due_date"),
    )


class CriticalTaskSubTask(Base):
    __tablename__ = "grc_critical_task_subtasks"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    status = Column(String(50), default="Open")
    assigned_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="sub_tasks")
    assigned_owner = relationship("GRCUser", foreign_keys=[assigned_owner_id])

    __table_args__ = (
        Index("ix_critical_subtask_task", "task_id"),
        Index("ix_critical_subtask_status", "task_id", "status"),
    )


class CriticalTaskComment(Base):
    __tablename__ = "grc_critical_task_comments"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="comments")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_critical_comment_task", "task_id"),
    )


class CriticalTaskHistory(Base):
    __tablename__ = "grc_critical_task_history"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    action = Column(String(100), nullable=False)
    field_changed = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("CriticalTask", back_populates="history")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_critical_history_task", "task_id"),
        Index("ix_critical_history_action", "task_id", "action"),
    )


class CriticalTaskTemplate(Base):
    __tablename__ = "grc_critical_task_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), default="Other")
    priority = Column(String(50), default="Medium")
    sla_days = Column(Integer, nullable=True)
    sub_tasks_template = Column(JSON, default=[])
    is_system = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")

    __table_args__ = (
        Index("ix_critical_template_tenant", "tenant_id"),
        UniqueConstraint("tenant_id", "name", name="uq_critical_template_name"),
    )


class CriticalTaskApproval(Base):
    __tablename__ = "grc_critical_task_approvals"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=False, index=True)
    requested_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="Pending")
    transition_from = Column(String(50), nullable=True)
    transition_to = Column(String(50), nullable=True)
    comment = Column(Text, nullable=True)
    response_comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    responded_at = Column(DateTime, nullable=True)

    task = relationship("CriticalTask", back_populates="approvals")
    requested_by = relationship("GRCUser", foreign_keys=[requested_by_id])
    approver = relationship("GRCUser", foreign_keys=[approver_id])

    __table_args__ = (
        Index("ix_critical_approval_task", "task_id"),
        Index("ix_critical_approval_status", "task_id", "status"),
    )


class NotificationPreference(Base):
    __tablename__ = "grc_notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    notify_on_assignment = Column(Boolean, default=True)
    notify_on_sla_warning = Column(Boolean, default=True)
    notify_on_sla_breach = Column(Boolean, default=True)
    notify_on_escalation = Column(Boolean, default=True)
    notify_on_approval_request = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    user = relationship("GRCUser")

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", name="uq_notification_pref_tenant_user"),
    )

