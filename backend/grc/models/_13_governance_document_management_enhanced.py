from ._12_governance import *  # noqa: F401,F403

# =============================================================================
# 10. Governance Document Management (Enhanced)
# =============================================================================

class GovernanceDocument(Base):
    """Enhanced governance document with full lifecycle management"""
    __tablename__ = "grc_governance_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    document_code = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(Text, nullable=True)
    
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String(50), nullable=True)  # pdf, docx, xlsx
    
    doc_type = Column(String(50), nullable=False)  # policy, standard, procedure, guideline, charter, framework
    doc_sub_type = Column(String(100), nullable=True)
    classification = Column(String(50), default="internal")  # public, internal, confidential, restricted
    
    parent_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    
    current_version = Column(String(50), default="1.0")
    status = Column(String(50), default="draft")  # draft, pending_review, pending_approval, approved, published, expired, archived, exception_applied
    
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    author_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    department_id = Column(Integer, nullable=True)
    
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    review_cycle_months = Column(Integer, default=12)
    next_review_date = Column(DateTime, nullable=True)
    last_reviewed_at = Column(DateTime, nullable=True)
    last_reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    regulatory_scope = Column(JSON, default=[])
    framework_ids = Column(JSON, default=[])
    # UploadedFramework ids this document is declared applicable to / audited
    # against. Drives the control-coverage panel (mapped / recommended / missing
    # controls per framework). Distinct from framework_ids (drafting citation
    # scope) so a doc can be audited against frameworks beyond what it cited.
    applicable_framework_ids = Column(JSON, default=[])
    # Further UploadedFramework ids its statements are mapped against, picked on
    # the document's Mappings tab (beyond the applicable and linked ones).
    mapping_framework_ids = Column(JSON, default=[])
    tags = Column(JSON, default=[])
    
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    published_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # when the current sign-off round began: signatures given before it no longer count (a changed document is signed again).
    # Set by _new_signoff_round below whenever the status goes to review or approval from anything else.
    signoff_round_at = Column(DateTime, nullable=True)
    # the stage of its approval route it is at while in review or approval (modules/governance/routes.py); None: by its status
    route_stage = Column(Integer, nullable=True)
    # when everyone was asked to acknowledge it (published with the life cycle on): only then are people who join later asked too
    acks_everyone_at = Column(DateTime, nullable=True)
    # the version published last: it stays in force while a newer one is on its way (modules/governance/permissions.in_force_number).
    # Set by _stamp_published below whenever the document is published.
    published_version = Column(String(50), nullable=True)
    # the version published last, never cleared (a withdrawal clears only published_version): whoever does not see drafts reads it
    # whenever the document is not published now and holds a newer number (permissions.in_force_row). Set by _remember_published.
    last_published_version = Column(String(50), nullable=True)
    # the hashes of the parts of its text its statements reflect (modules/governance/statement_reparse.py): a new version is read
    # again only where its parts differ from these
    statement_parts = Column(JSON, nullable=True)

    tenant = relationship("Tenant", back_populates="governance_documents")
    owner = relationship("GRCUser", back_populates="owned_gov_documents", foreign_keys=[owner_id])
    author = relationship("GRCUser", foreign_keys=[author_id])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    publisher = relationship("GRCUser", foreign_keys=[published_by])
    last_reviewer = relationship("GRCUser", foreign_keys=[last_reviewed_by])
    
    parent_document = relationship("GovernanceDocument", remote_side=[id], backref="child_documents")
    versions = relationship("GovernanceDocumentVersion", back_populates="document", cascade="all, delete-orphan")
    reviewers = relationship("DocumentReviewer", back_populates="document", cascade="all, delete-orphan")
    approval_steps = relationship("DocumentApprovalStep", back_populates="document", cascade="all, delete-orphan")
    audit_logs = relationship("DocumentAuditLog", back_populates="document", cascade="all, delete-orphan")
    control_links = relationship("DocumentControlLink", back_populates="document", cascade="all, delete-orphan")
    risk_links = relationship("DocumentRiskLink", back_populates="document", cascade="all, delete-orphan")
    regulatory_links = relationship("DocumentRegulatoryLink", back_populates="document", cascade="all, delete-orphan")
    asset_links = relationship("DocumentAssetLink", back_populates="document", cascade="all, delete-orphan")
    policy_statements = relationship("PolicyStatement", back_populates="document", cascade="all, delete-orphan")
    workflow_instance = relationship("DocumentWorkflowInstance", back_populates="document", uselist=False, cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_gov_doc_tenant_type", "tenant_id", "doc_type"),
        Index("ix_gov_doc_tenant_status", "tenant_id", "status"),
        Index("ix_gov_doc_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_gov_doc_next_review", "tenant_id", "next_review_date"),
        Index("ix_gov_doc_expiry", "tenant_id", "expiry_date"),
    )



from sqlalchemy import event as _event  # noqa: E402

_PENDING_SIGNOFF = ("pending_review", "pending_approval")


@_event.listens_for(GovernanceDocument.status, "set", active_history=True)
def _new_signoff_round(doc, value, old, _initiator):
    """Going to review or approval from any other status, by any path (Send, a save over an approved document, take-back,
    restore, a status set by hand, the older approvals engine, a gap fix), starts a new sign-off round: the signatures given
    before it no longer count (routers/document_signoff._signatures), so the same people sign the changed document again. Going
    back from approval to review starts one too (the reviewers who signed are asked again)."""
    if (value in _PENDING_SIGNOFF and old not in _PENDING_SIGNOFF) or (value == "pending_review" and old == "pending_approval"):
        doc.signoff_round_at = datetime.utcnow()
        doc.route_stage = None          # a route of its own starts at its first stage (whoever sets the status may set it after)


@_event.listens_for(GovernanceDocument.status, "set")
def _stamp_published(doc, value, _old, _initiator):
    """Published by any path (Publish, bulk publish, a status set by hand, the older approvals engines, a workflow): that version is
    the one in force until the next publication. A version not set yet is the column's default, 1.0."""
    if value == "published":
        doc.published_version = doc.current_version or "1.0"
    elif value in ("archived", "expired", "exception_applied"):        # withdrawn: nothing is in force; reviving it starts clean
        doc.published_version = None


@_event.listens_for(GovernanceDocument.published_version, "set")
def _remember_published(doc, value, _old, _initiator):
    """Every number put in force (a publication by any path, or a new number of the published text) is the version published last;
    it stays when a withdrawal clears what is in force, so a once-published document never serves newer, unapproved text."""
    if value:
        doc.last_published_version = value


from sqlalchemy.orm import Session as _Session  # noqa: E402

_TEXT_CHANGED = "statement_reparse_documents"      # session.info: the documents whose text or file this transaction changed


@_event.listens_for(GovernanceDocument.content, "set")
@_event.listens_for(GovernanceDocument.file_path, "set")
def _note_text_change(doc, value, old, _initiator):
    """A new text or file, by any path (a save, a new file version, a restore, a write-back, a workflow): its statements follow it once
    the change is committed (``_statements_follow`` below). A document being created is parsed by its create path instead. An old
    value that was not loaded counts as a change (no query here); the job then finds every part the same and asks no AI."""
    if value == old:
        return
    from sqlalchemy import inspect as _inspect

    state = _inspect(doc)
    if state.persistent and state.session is not None and state.identity:
        state.session.info.setdefault(_TEXT_CHANGED, set()).add(state.identity[0])


@_event.listens_for(_Session, "after_commit")
def _statements_follow(session):
    """One update of the statements per document whose text the commit changed, on real tenant sessions only (they carry their
    tenant's slug: never a test's, never the master database). Never raises into the request."""
    ids = session.info.pop(_TEXT_CHANGED, None)
    slug = session.info.get("tenant_slug")
    if not ids or not slug:
        return
    try:
        from ..modules.governance.statement_reparse import start

        start(slug, sorted(ids), session)
    except Exception:       # noqa: BLE001 - the change is saved; its statements catch up with the next one
        import logging

        logging.getLogger(__name__).warning("statements of documents %s were not updated", sorted(ids), exc_info=True)


@_event.listens_for(_Session, "after_soft_rollback")
def _forget_text_change(session, previous_transaction):
    if not getattr(previous_transaction, "nested", False):        # rolled back: nothing changed
        session.info.pop(_TEXT_CHANGED, None)


class GovernanceDocumentVersion(Base):
    """Full version history with change tracking"""
    __tablename__ = "grc_governance_document_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    
    version_number = Column(String(50), nullable=False)
    change_type = Column(String(20), default="minor")  # major, minor, patch
    
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    file_type = Column(String(50), nullable=True)
    
    change_summary = Column(Text, nullable=True)
    change_reason = Column(Text, nullable=True)
    # What this version changed against the one before it, from -> to, with who/what each change came from (the AI's
    # request and the sources it relied on, a person's edit, a revert). Written by the AI Studio and by a revert; a
    # version without it is compared with its predecessor when the change chain is read (modules/governance/change_chain.py).
    change_set = Column(JSON, nullable=True)
    
    status = Column(String(50), default="current")  # current, superseded, archived
    
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="versions")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    
    __table_args__ = (
        Index("ix_gov_doc_version", "document_id", "version_number"),
        Index("ix_gov_doc_version_status", "document_id", "status"),
    )


class DocumentReviewer(Base):
    """Assigned reviewers and approvers for documents"""
    __tablename__ = "grc_document_reviewers"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    role_type = Column(String(50), nullable=False)  # owner, author, reviewer, approver, stakeholder
    sequence = Column(Integer, default=1)
    is_required = Column(Boolean, default=True)
    notify_on_update = Column(Boolean, default=True)
    notify_on_expiry = Column(Boolean, default=True)
    
    assigned_at = Column(DateTime, default=datetime.utcnow)
    assigned_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="reviewers")
    user = relationship("GRCUser", foreign_keys=[user_id])
    assigner = relationship("GRCUser", foreign_keys=[assigned_by])
    
    __table_args__ = (
        Index("ix_doc_reviewer_doc_user", "document_id", "user_id"),
        Index("ix_doc_reviewer_role", "document_id", "role_type"),
    )


class DocumentApprovalStep(Base):
    """Multi-step approval workflow with sequence"""
    __tablename__ = "grc_document_approval_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True, index=True)
    
    step_sequence = Column(Integer, nullable=False)
    step_name = Column(String(100), nullable=True)
    approval_type = Column(String(50), default="single")  # single, any, all
    
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approver_role = Column(String(100), nullable=True)
    
    status = Column(String(50), default="pending")  # pending, approved, rejected, skipped, delegated
    
    requested_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    comments = Column(Text, nullable=True)
    
    delegated_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    delegated_at = Column(DateTime, nullable=True)
    delegation_reason = Column(Text, nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="approval_steps")
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    delegate = relationship("GRCUser", foreign_keys=[delegated_to])
    
    __table_args__ = (
        Index("ix_approval_step_doc_seq", "document_id", "step_sequence"),
        Index("ix_approval_step_status", "document_id", "status"),
        Index("ix_approval_step_approver", "approver_id", "status"),
    )


class DocumentAuditLog(Base):
    """Complete audit trail for governance documents"""
    __tablename__ = "grc_document_audit_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    action = Column(String(50), nullable=False)  # created, updated, submitted, approved, rejected, published, expired, archived, viewed, downloaded
    action_details = Column(Text, nullable=True)
    
    field_changed = Column(String(100), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    
    performed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    performed_at = Column(DateTime, default=datetime.utcnow)
    
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="audit_logs")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_doc_audit_doc_action", "document_id", "action"),
        Index("ix_doc_audit_tenant_date", "tenant_id", "performed_at"),
        Index("ix_doc_audit_user", "performed_by", "performed_at"),
    )


class PolicyReviewHistory(Base):
    """Tracks periodic and ad-hoc reviews for governance documents"""
    __tablename__ = "grc_policy_review_history"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)

    review_type = Column(String(50), default="periodic")  # periodic, ad_hoc, triggered
    review_status = Column(String(50), default="scheduled")  # scheduled, in_progress, completed, skipped

    scheduled_date = Column(DateTime, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    review_notes = Column(Text, nullable=True)
    changes_made = Column(Text, nullable=True)
    outcome = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    document = relationship("GovernanceDocument", backref="review_history")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])

    __table_args__ = (
        Index("ix_policy_review_tenant_doc", "tenant_id", "document_id"),
        Index("ix_policy_review_status", "tenant_id", "review_status"),
        Index("ix_policy_review_reviewer", "reviewer_id", "review_status"),
    )


class GovernanceActionReview(Base):
    """Tracks governance actions that require review (drafts, risk acceptance, evidence upload, committee actions, etc.)"""
    __tablename__ = "grc_governance_action_reviews"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    # Action details
    action_type = Column(String(100), nullable=False)  # document_draft_created, risk_accepted, evidence_uploaded, committee_action, etc.
    action_description = Column(Text, nullable=False)
    entity_type = Column(String(100), nullable=False)  # governance_document, risk, evidence, committee, etc.
    entity_id = Column(Integer, nullable=True)  # ID of the entity (document_id, risk_id, etc.)
    
    # Review status
    review_status = Column(String(50), default="pending_review")  # pending_review, in_review, approved, rejected, archived
    review_notes = Column(Text, nullable=True)
    
    # User information
    action_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)  # User who took the action
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)  # User reviewing the action
    
    # Timestamps
    action_date = Column(DateTime, default=datetime.utcnow, index=True)
    review_started_at = Column(DateTime, nullable=True)
    review_completed_at = Column(DateTime, nullable=True)
    
    # Additional context
    action_metadata = Column(JSON, nullable=True)  # Store additional data like tags, related entities, etc.
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    action_user = relationship("GRCUser", foreign_keys=[action_user_id], backref="governance_actions_taken")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id], backref="governance_actions_reviewed")

    __table_args__ = (
        Index("ix_gvn_action_tenant", "tenant_id"),
        Index("ix_gvn_action_status", "review_status"),
        Index("ix_gvn_action_type", "action_type"),
        Index("ix_gvn_action_user", "action_user_id"),
        Index("ix_gvn_action_date", "action_date"),
        Index("ix_gvn_action_entity", "entity_type", "entity_id"),
    )


class DocumentControlLink(Base):
    """Links documents to normalized controls"""
    __tablename__ = "grc_document_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="implements")  # implements, supports, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="document_links")
    
    __table_args__ = (
        Index("ix_doc_control_link", "document_id", "normalized_control_id"),
        UniqueConstraint("document_id", "normalized_control_id", name="uq_doc_control_link"),
    )


class DocumentRiskLink(Base):
    """Links documents to risks"""
    __tablename__ = "grc_document_risk_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="mitigates")  # mitigates, addresses, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="risk_links")
    risk = relationship("Risk", back_populates="document_links")
    
    __table_args__ = (
        Index("ix_doc_risk_link", "document_id", "risk_id"),
        UniqueConstraint("document_id", "risk_id", name="uq_doc_risk_link"),
    )


class DocumentRegulatoryLink(Base):
    """Links documents to regulatory requirements"""
    __tablename__ = "grc_document_regulatory_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    
    requirement_reference = Column(String(255), nullable=True)
    link_type = Column(String(50), default="complies")  # complies, addresses, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="regulatory_links")
    framework = relationship("Framework")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        Index("ix_doc_reg_link_doc", "document_id"),
        Index("ix_doc_reg_link_framework", "framework_id"),
    )


class DocumentAssetLink(Base):
    """Links documents to IT assets"""
    __tablename__ = "grc_document_asset_links"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    
    link_type = Column(String(50), default="governs")  # governs, applies_to, references
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    document = relationship("GovernanceDocument", back_populates="asset_links")
    asset = relationship("ITAsset")
    
    __table_args__ = (
        Index("ix_doc_asset_link", "document_id", "asset_id"),
        UniqueConstraint("document_id", "asset_id", name="uq_doc_asset_link"),
    )


class Document(Base):
    """Legacy document model - kept for backward compatibility"""
    __tablename__ = "grc_documents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    doc_type = Column(String(50), nullable=False)
    version = Column(String(50), default="1.0")
    status = Column(String(50), default="draft")
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    published_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    published_at = Column(DateTime, nullable=True)
    review_cycle_months = Column(Integer, default=12)
    next_review_date = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant", back_populates="documents")
    owner = relationship("GRCUser", back_populates="owned_documents", foreign_keys=[owner_id])
    approver = relationship("GRCUser", back_populates="approved_documents", foreign_keys=[approved_by])
    publisher = relationship("GRCUser", foreign_keys=[published_by])
    versions = relationship("DocumentVersion", back_populates="document", cascade="all, delete-orphan")
    approval_workflows = relationship("DocumentApprovalWorkflow", back_populates="document", cascade="all, delete-orphan")
    attestations = relationship("DocumentAttestation", back_populates="document", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_document_tenant_type", "tenant_id", "doc_type"),
        Index("ix_document_tenant_status", "tenant_id", "status"),
    )


class DocumentVersion(Base):
    """Legacy document version - kept for backward compatibility"""
    __tablename__ = "grc_document_versions"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    version_number = Column(String(50), nullable=False)
    content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    change_summary = Column(Text, nullable=True)
    
    document = relationship("Document", back_populates="versions")
    creator = relationship("GRCUser", back_populates="document_versions")
    
    __table_args__ = (
        Index("ix_document_version", "document_id", "version_number"),
    )


class DocumentApprovalWorkflow(Base):
    """Legacy approval workflow - kept for backward compatibility"""
    __tablename__ = "grc_document_approval_workflows"
    
    id = Column(Integer, primary_key=True, index=True)
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    status = Column(String(50), default="pending")
    approved_at = Column(DateTime, nullable=True)
    comments = Column(Text, nullable=True)
    
    document = relationship("Document", back_populates="approval_workflows")
    approver = relationship("GRCUser", back_populates="document_approvals")


class DocumentAttestation(Base):
    """Tracks user attestations/acknowledgments for legacy documents"""
    __tablename__ = "grc_document_attestations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    document_id = Column(Integer, ForeignKey("grc_documents.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    attestation_type = Column(String(50), default="acknowledgment")
    status = Column(String(50), default="pending")
    
    requested_at = Column(DateTime, default=datetime.utcnow)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    attestation_text = Column(Text, nullable=True)
    user_comments = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    document = relationship("Document", back_populates="attestations")
    user = relationship("GRCUser", foreign_keys=[user_id])
    requester = relationship("GRCUser", foreign_keys=[requested_by])
    
    __table_args__ = (
        Index("ix_doc_attestation_tenant", "tenant_id"),
        Index("ix_doc_attestation_document", "document_id"),
        Index("ix_doc_attestation_user", "user_id"),
        Index("ix_doc_attestation_status", "status"),
    )



# =============================================================================
# 10b. Document Sign-off & Document Control (production approval flow)
# =============================================================================

class DocumentSignoffAssignment(Base):
    """Per-document participant assignment for the sign-off flow. A participant is
    a role_type (prepared_by | reviewer | approver) targeting a user, role, or
    team; role/team targets are expanded to member users when routing a document
    to each participant's Pending Approvals queue."""
    __tablename__ = "grc_document_signoff_assignments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    role_type = Column(String(20), nullable=False)    # prepared_by | reviewer | approver
    target_type = Column(String(10), nullable=False)  # user | role | team
    target_id = Column(Integer, nullable=False)       # user id / role id / team id
    stage_position = Column(Integer, nullable=True)   # the route stage (grc_document_route_stages) it belongs to; None: the default route
    position = Column(Integer, nullable=True)         # its turn within that stage when people are asked one after another
    added_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_doc_signoff_assign_doc", "document_id", "role_type"),
        Index("ix_doc_signoff_assign_tenant", "tenant_id"),
    )


class DocumentSignature(Base):
    """A recorded sign / approval / rejection by a specific user acting in a
    role_type. Structured non-repudiation record backing the in-document Approval
    Signoff table stamp (who signed as what, when, decision, typed signature)."""
    __tablename__ = "grc_document_signatures"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    version_id = Column(Integer, ForeignKey("grc_governance_document_versions.id"), nullable=True)
    signer_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role_type = Column(String(20), nullable=False)    # prepared_by | reviewer | approver
    role_label = Column(String(100), nullable=True)   # Approval Signoff tier label patched into content
    decision = Column(String(20), default="signed")   # signed | rejected
    stage_position = Column(Integer, nullable=True)   # the route stage it was given at (None: before routes, by role_type)
    on_behalf_of = Column(Integer, ForeignKey("grc_users.id"), nullable=True)    # signed for this person, who delegated it
    signature_text = Column(String(255), nullable=True)  # typed name of record
    comment = Column(Text, nullable=True)
    signed_at = Column(DateTime, default=datetime.utcnow)

    signer = relationship("GRCUser", foreign_keys=[signer_user_id])

    __table_args__ = (
        Index("ix_doc_signature_doc", "document_id", "role_type"),
        Index("ix_doc_signature_signer", "signer_user_id"),
    )
