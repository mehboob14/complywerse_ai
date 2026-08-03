from ._11_enterprise_risk_management import *  # noqa: F401,F403

# =============================================================================
# 9. Governance
# =============================================================================

class GovernanceObjective(Base):
    __tablename__ = "grc_governance_objectives"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="active")
    target_date = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="governance_objectives")
    owner = relationship("GRCUser", back_populates="owned_objectives")
    
    __table_args__ = (
        Index("ix_governance_objective_tenant", "tenant_id", "status"),
    )


class Exception(Base):
    __tablename__ = "grc_exceptions"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    justification = Column(Text, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approval_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="pending")  # pending, approved, rejected, expired
    
    tenant = relationship("Tenant", back_populates="exceptions")
    normalized_control = relationship("NormalizedControl", back_populates="exceptions")
    
    __table_args__ = (
        Index("ix_exception_tenant_status", "tenant_id", "status"),
    )


class PolicyException(Base):
    __tablename__ = "grc_policy_exceptions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    justification = Column(Text, nullable=True)
    risk_assessment = Column(Text, nullable=True)
    compensating_controls = Column(Text, nullable=True)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    status = Column(String(50), default="draft")
    priority = Column(String(20), default="medium")
    requested_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    rejected_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    is_expired = Column(Boolean, default=False)
    # Linked IT assets (ids) — their CIA + criticality weight the exception's risk
    # posture score. When the exception was actually closed/revoked (for the
    # "closed on the date it had to be" timeliness metric).
    linked_asset_ids = Column(JSON, default=list)
    closed_at = Column(DateTime, nullable=True)
    # When this exception's "potential risks" were promoted into the ERM risk
    # register, the created risk's id (so we link out instead of re-promoting).
    promoted_risk_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    metadata_ = Column("metadata", JSON, default={})

    tenant = relationship("Tenant", back_populates="policy_exceptions")
    document = relationship("GovernanceDocument")
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    rejector = relationship("GRCUser", foreign_keys=[rejected_by])
    comments = relationship("PolicyExceptionComment", back_populates="exception", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_pol_exc_tenant_status", "tenant_id", "status"),
        Index("ix_pol_exc_tenant_doc", "tenant_id", "document_id"),
        Index("ix_pol_exc_expiry", "tenant_id", "expiry_date"),
    )


class PolicyExceptionComment(Base):
    __tablename__ = "grc_policy_exception_comments"

    id = Column(Integer, primary_key=True, index=True)
    exception_id = Column(Integer, ForeignKey("grc_policy_exceptions.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    comment = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    exception = relationship("PolicyException", back_populates="comments")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_pol_exc_comment_exception", "exception_id"),
    )


class DocumentAnnotation(Base):
    """Auditor / reviewer remark anchored to a governance document.

    Two kinds today:
      - text_range: anchored to a character offset range in the document's
        plain-text representation. `anchor_data` carries
        `{start_offset, end_offset, quoted_text}`. Rendered as a highlight
        span in the in-browser viewer for the matching slice.
      - general: a free-form comment with no specific anchor, shown in the
        comments sidebar but not highlighted in the body. Used when the
        underlying file type (PDF, XLSX, image) doesn't yet support
        precise selection anchoring.

    The table is intentionally narrow — threading, mentions, and
    resolved-state can layer on top later without schema churn.
    """
    __tablename__ = "grc_document_annotations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    anchor_kind = Column(String(50), nullable=False, default="general")  # text_range | general
    anchor_data = Column(JSON, default=dict)
    comment = Column(Text, nullable=False)
    status = Column(String(20), default="open")  # open | resolved
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_doc_annotation_tenant_doc", "tenant_id", "document_id"),
    )


class Issue(Base):
    """First-class issue / finding tracker.

    Issues record things that *broke* or were *found broken* and need a
    corrective + preventive response. They link to vulnerabilities, risks,
    assets, controls, evidence, and vendors so a single CISO/auditor view
    can answer "what's open, why, who owns it, what's being done about it".

    Severity is normally **computed** by the IssueSeverityMatrix from the
    user-supplied (impact, urgency) pair. The user can override the
    computed value via `severity_override`, but must supply
    `severity_override_reason` so the audit trail captures the delta.
    """
    __tablename__ = "grc_issues"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    severity = Column(String(50), default="medium")  # low, medium, high, critical, informational
    status = Column(String(50), default="open")  # legacy status — kept for back-compat
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    # ── Phase 1: Issue Management extensions ─────────────────────────────
    # All nullable so historical rows (from the skeleton model) keep rendering.
    code = Column(String(50), nullable=True, index=True)  # tenant-scoped, e.g. ISS-001
    issue_type = Column(String(40), nullable=True)
    # incident, audit_finding, non_conformance, vendor_breach, process_gap, capa, other
    category = Column(String(40), nullable=True)
    # security, privacy, operations, contract, data, regulatory, safety
    urgency = Column(String(20), nullable=True)  # high, medium, low — feeds the matrix
    impact = Column(String(20), nullable=True)   # high, medium, low — feeds the matrix
    # `severity` above stores the resolved value. When `severity_override` is
    # non-null, it wins; the matrix-suggested value is still preserved in the
    # activity-log payload for the audit trail.
    severity_override = Column(String(20), nullable=True)
    severity_override_reason = Column(Text, nullable=True)
    root_cause = Column(String(255), nullable=True)
    root_cause_analysis = Column(Text, nullable=True)  # 5-whys / fishbone notes
    detected_at = Column(DateTime, nullable=True)  # often earlier than created_at
    target_closure_date = Column(DateTime, nullable=True)  # SLA-driven, recomputed on severity change
    resolved_at = Column(DateTime, nullable=True)  # work done, distinct from formal closed_at
    reporter_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assignee_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    source_type = Column(String(40), nullable=True, index=True)
    # manual, vulnerability, risk, control_test, audit, vendor_review, incident_report, asset
    source_id = Column(Integer, nullable=True, index=True)
    workflow_state = Column(String(40), nullable=True, default="new", index=True)
    # new, triage, in_progress, resolution, closure_review, closed, cancelled
    sla_breached = Column(Boolean, nullable=True, default=False, index=True)
    approved_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    closure_notes = Column(Text, nullable=True)

    tenant = relationship("Tenant", back_populates="issues")
    owner = relationship("GRCUser", back_populates="owned_issues", foreign_keys=[owner_id])
    reporter = relationship("GRCUser", foreign_keys=[reporter_id])
    assignee = relationship("GRCUser", foreign_keys=[assignee_id])
    approver = relationship("GRCUser", foreign_keys=[approved_by_id])

    actions = relationship("IssueAction", back_populates="issue", cascade="all, delete-orphan")
    comments = relationship("IssueComment", back_populates="issue", cascade="all, delete-orphan")
    activity = relationship("IssueActivity", back_populates="issue", cascade="all, delete-orphan")
    vulnerability_links = relationship("IssueVulnerabilityLink", back_populates="issue", cascade="all, delete-orphan")
    risk_links = relationship("IssueRiskLink", back_populates="issue", cascade="all, delete-orphan")
    asset_links = relationship("IssueAssetLink", back_populates="issue", cascade="all, delete-orphan")
    control_links = relationship("IssueControlLink", back_populates="issue", cascade="all, delete-orphan")
    evidence_links = relationship("IssueEvidenceLink", back_populates="issue", cascade="all, delete-orphan")
    vendor_links = relationship("IssueVendorLink", back_populates="issue", cascade="all, delete-orphan")
    # v2 — new linkage families
    is_project_links = relationship("IssueISProjectLink", back_populates="issue", cascade="all, delete-orphan")
    governance_links = relationship("IssueGovernanceLink", back_populates="issue", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_issue_tenant_status", "tenant_id", "status"),
        Index("ix_issue_tenant_severity", "tenant_id", "severity"),
        Index("ix_issue_tenant_workflow_state", "tenant_id", "workflow_state"),
        Index("ix_issue_tenant_type", "tenant_id", "issue_type"),
        Index("ix_issue_tenant_source", "tenant_id", "source_type", "source_id"),
        Index("ix_issue_tenant_code", "tenant_id", "code"),
    )


class IssueAction(Base):
    """CAPA action — corrective, preventive, containment or verification step
    attached to an Issue. Each Issue can have many actions on different
    timelines and assignees."""
    __tablename__ = "grc_issue_actions"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    action_type = Column(String(30), nullable=False, default="corrective")
    # corrective, preventive, containment, verification
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assignee_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(30), nullable=False, default="planned")
    # planned, in_progress, blocked, completed, verified, cancelled
    completed_at = Column(DateTime, nullable=True)
    verified_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    verified_at = Column(DateTime, nullable=True)
    effectiveness_review_at = Column(DateTime, nullable=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # ── v2: bidirectional link with Critical Tasks ─────────────────────
    # When a CAPA action is "promoted to task", we mirror it into the
    # global Critical Tasks register and keep status syncing via a hook in
    # critical_tasks_router. Nullable + additive — historical rows unchanged.
    linked_critical_task_id = Column(Integer, ForeignKey("grc_critical_tasks.id"), nullable=True, index=True)

    issue = relationship("Issue", back_populates="actions")
    assignee = relationship("GRCUser", foreign_keys=[assignee_id])
    verifier = relationship("GRCUser", foreign_keys=[verified_by_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    evidence = relationship("Evidence")
    linked_critical_task = relationship("CriticalTask", foreign_keys=[linked_critical_task_id])

    __table_args__ = (
        Index("ix_issue_action_issue", "issue_id"),
        Index("ix_issue_action_status", "status"),
        Index("ix_issue_action_assignee", "assignee_id"),
    )


class IssueComment(Base):
    """Threaded comments on an Issue (parent_id self-FK supports replies)."""
    __tablename__ = "grc_issue_comments"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    parent_id = Column(Integer, ForeignKey("grc_issue_comments.id"), nullable=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    edited_at = Column(DateTime, nullable=True)

    issue = relationship("Issue", back_populates="comments")
    user = relationship("GRCUser", foreign_keys=[user_id])

    __table_args__ = (Index("ix_issue_comment_issue", "issue_id", "created_at"),)


class IssueActivity(Base):
    """Audit trail for every state-changing event on an Issue. Filled by the
    routers (not the model layer) so the schema stays simple."""
    __tablename__ = "grc_issue_activity"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    type = Column(String(40), nullable=False)
    # created, status_change, severity_change, linked, unlinked, action_added,
    # action_completed, commented, approved, reopened, cancelled
    payload = Column(JSON, default=dict)  # arbitrary event data
    created_at = Column(DateTime, default=datetime.utcnow)

    issue = relationship("Issue", back_populates="activity")
    user = relationship("GRCUser", foreign_keys=[user_id])

    __table_args__ = (Index("ix_issue_activity_issue", "issue_id", "created_at"),)


class IssueVulnerabilityLink(Base):
    __tablename__ = "grc_issue_vulnerability_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="vulnerability_links")
    vulnerability = relationship("Vulnerability")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "vulnerability_id", name="uq_issue_vuln_link"),
        Index("ix_issue_vuln_link", "issue_id", "vulnerability_id"),
    )


class IssueRiskLink(Base):
    __tablename__ = "grc_issue_risk_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    link_type = Column(String(30), default="instance_of")
    # instance_of, contributes_to, stems_from
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="risk_links")
    risk = relationship("Risk")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "risk_id", name="uq_issue_risk_link"),
        Index("ix_issue_risk_link", "issue_id", "risk_id"),
    )


class IssueAssetLink(Base):
    __tablename__ = "grc_issue_asset_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="asset_links")
    asset = relationship("ITAsset")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "asset_id", name="uq_issue_asset_link"),
        Index("ix_issue_asset_link", "issue_id", "asset_id"),
    )


class IssueControlLink(Base):
    """Polymorphic linkage to any of the four control entities — same shape
    as VulnerabilityControlLink so the UI can render mixed controls
    consistently. Exactly one of the four target columns is populated per
    row."""
    __tablename__ = "grc_issue_control_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    parsed_framework_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=True, index=True)
    link_type = Column(String(30), default="failed")
    # failed, gap, partially_effective
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="control_links")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
    normalized_control = relationship("NormalizedControl")
    internal_control = relationship("InternalControl")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (Index("ix_issue_control_link", "issue_id"),)


class IssueEvidenceLink(Base):
    __tablename__ = "grc_issue_evidence_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    relationship_type = Column(String(30), default="proof")
    # proof, remediation, investigation
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="evidence_links")
    evidence = relationship("Evidence")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "evidence_id", name="uq_issue_evidence_link"),
        Index("ix_issue_evidence_link", "issue_id", "evidence_id"),
    )


class IssueVendorLink(Base):
    """Vendor / contract linkage — drives the Contract Compliance tab."""
    __tablename__ = "grc_issue_vendor_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    contract_reference = Column(String(255), nullable=True)
    breach_clause = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="vendor_links")
    vendor = relationship("Vendor")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "vendor_id", name="uq_issue_vendor_link"),
        Index("ix_issue_vendor_link", "issue_id", "vendor_id"),
    )


class IssueSeverityMatrix(Base):
    """Per-tenant Impact × Urgency cell. Drives the computed severity
    + SLA hours for every new/edited issue. UI exposes it as a 3×3 grid
    editor on the Severity Matrix tab."""
    __tablename__ = "grc_issue_severity_matrix"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    impact = Column(String(20), nullable=False)   # high, medium, low
    urgency = Column(String(20), nullable=False)  # high, medium, low
    computed_severity = Column(String(20), nullable=False)
    # critical, high, medium, low, informational
    sla_ack_hours = Column(Integer, nullable=False, default=24)
    sla_resolve_hours = Column(Integer, nullable=False, default=168)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "impact", "urgency", name="uq_issue_severity_cell"),
        Index("ix_issue_severity_matrix_tenant", "tenant_id"),
    )


class IssueClassificationMatrix(Base):
    """Per-tenant Issue Type × Severity cell. Picks default owner + response
    SLA so on-create the right team gets routed automatically."""
    __tablename__ = "grc_issue_classification_matrix"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    issue_type = Column(String(40), nullable=False)
    severity = Column(String(20), nullable=False)
    default_owner_team_id = Column(Integer, ForeignKey("grc_teams.id"), nullable=True)
    default_owner_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    response_sla_hours = Column(Integer, nullable=True)      # mirror of severity matrix ack window
    escalation_sla_hours = Column(Integer, nullable=True)    # when to escalate if no progress
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "issue_type", "severity", name="uq_issue_classification_cell"),
        Index("ix_issue_classification_matrix_tenant", "tenant_id"),
    )


# ────────────────────────────────────────────────────────────────────────
# Issue Management v2 — cross-module linkages + automation flags
# All tables additive; created automatically via Base.metadata.create_all
# on next backend boot.
# ────────────────────────────────────────────────────────────────────────

class IssueISProjectLink(Base):
    """Links Issues to IS Projects — drives the bidirectional 'Issues' view
    on the project detail page + the 'Projects' sub-tab on the issue
    detail page."""
    __tablename__ = "grc_issue_is_project_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    is_project_id = Column(Integer, ForeignKey("grc_is_projects.id"), nullable=False, index=True)
    role = Column(String(30), default="contributor")
    # primary, contributor, observer
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="is_project_links")
    is_project = relationship("ISProject")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("issue_id", "is_project_id", name="uq_issue_is_project_link"),
        Index("ix_issue_is_project_link", "issue_id", "is_project_id"),
    )


class IssueGovernanceLink(Base):
    """Links Issues to GovernanceDocuments OR PolicyStatements (exactly one
    of the two target columns is populated per row). Drives the document
    review trigger hook + the 'Linked Issues' tab on document detail."""
    __tablename__ = "grc_issue_governance_links"

    id = Column(Integer, primary_key=True, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    governance_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    policy_statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=True, index=True)
    link_type = Column(String(30), default="non_conformance")
    # review_trigger, non_conformance, clarification
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    issue = relationship("Issue", back_populates="governance_links")
    governance_document = relationship("GovernanceDocument", foreign_keys=[governance_document_id])
    policy_statement = relationship("PolicyStatement", foreign_keys=[policy_statement_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_issue_governance_link", "issue_id"),
    )


class IssueAutomationFlags(Base):
    """Per-tenant toggle for each auto-creation trigger. Default OFF so v2
    behaviour is byte-identical to v1 until the tenant opts in. Surfaced on
    the Issues > Automation admin tab."""
    __tablename__ = "grc_issue_automation_flags"

    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), primary_key=True)
    refresh_document_review = Column(Boolean, default=False, nullable=False)
    kri_red_breach = Column(Boolean, default=False, nullable=False)
    overdue_mitigation = Column(Boolean, default=False, nullable=False)
    control_evidence_rejected = Column(Boolean, default=False, nullable=False)
    all_enabled = Column(Boolean, default=False, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

