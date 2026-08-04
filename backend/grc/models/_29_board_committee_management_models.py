from ._28_regulatory_change_management_models import *  # noqa: F401,F403

# =============================================================================
# Board & Committee Management Models
# =============================================================================

class GovernanceCommittee(Base):
    """Committee setup for governance oversight"""
    __tablename__ = "grc_governance_committees"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    committee_type = Column(String(50), nullable=False)  # board, risk_committee, audit_committee, compliance_committee, it_steering, custom
    chair_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    secretary_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    meeting_frequency = Column(String(50), default="quarterly")  # monthly, quarterly, annual, ad_hoc
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    chair = relationship("GRCUser", foreign_keys=[chair_id])
    secretary = relationship("GRCUser", foreign_keys=[secretary_id])
    members = relationship("CommitteeMember", back_populates="committee", cascade="all, delete-orphan")
    charters = relationship("CommitteeCharter", back_populates="committee", cascade="all, delete-orphan")
    meetings = relationship("CommitteeMeeting", back_populates="committee", cascade="all, delete-orphan")
    oversight_actions = relationship("OversightAction", back_populates="committee", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_governance_committee_tenant", "tenant_id"),
        Index("ix_governance_committee_type", "committee_type"),
        Index("ix_governance_committee_active", "is_active"),
    )


class CommitteeMember(Base):
    """Committee membership records"""
    __tablename__ = "grc_committee_members"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    role = Column(String(50), default="member")  # chair, secretary, member, observer
    joined_at = Column(DateTime, default=datetime.utcnow)
    left_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="members")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_committee_member_tenant", "tenant_id"),
        Index("ix_committee_member_committee", "committee_id"),
        Index("ix_committee_member_user", "user_id"),
        Index("ix_committee_member_active", "is_active"),
        UniqueConstraint("committee_id", "user_id", name="uq_committee_member_user"),
    )


class CommitteeCharter(Base):
    """Charter documents for committees"""
    __tablename__ = "grc_committee_charters"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    version = Column(String(50), default="1.0")
    title = Column(String(500), nullable=False)
    content = Column(Text, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft, active, expired
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    file_path = Column(String(500), nullable=True)
    file_name = Column(String(255), nullable=True)
    file_type = Column(String(50), nullable=True)
    file_size = Column(Integer, nullable=True)
    # Structured sections — same shape the AI-generate flow returns
    # ([{title, content, framework_references[]}]). Populated by the
    # upload-new endpoint via the charter_parser service; left NULL on
    # rows whose `content` is the source of truth (legacy + plain-text
    # creates). The UI prefers `sections_json` when present so uploaded
    # charters render identically to AI-drafted ones.
    sections_json = Column(JSON, nullable=True)

    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="charters")
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_committee_charter_tenant", "tenant_id"),
        Index("ix_committee_charter_committee", "committee_id"),
        Index("ix_committee_charter_status", "status"),
    )


class CommitteeMeeting(Base):
    """Meeting management for committees"""
    __tablename__ = "grc_committee_meetings"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    meeting_number = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    meeting_type = Column(String(50), default="regular")  # regular, special, emergency
    scheduled_date = Column(DateTime, nullable=False)
    location = Column(String(500), nullable=True)
    virtual_link = Column(String(1000), nullable=True)
    status = Column(String(50), default="scheduled")  # scheduled, in_progress, completed, cancelled
    quorum_required = Column(Integer, nullable=True)
    quorum_present = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="meetings")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    agenda_items = relationship("MeetingAgendaItem", back_populates="meeting", cascade="all, delete-orphan")
    minutes = relationship("MeetingMinutes", back_populates="meeting", uselist=False, cascade="all, delete-orphan")
    oversight_actions = relationship("OversightAction", back_populates="meeting")
    attachments = relationship("MeetingAttachment", back_populates="meeting", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_committee_meeting_tenant", "tenant_id"),
        Index("ix_committee_meeting_committee", "committee_id"),
        Index("ix_committee_meeting_status", "status"),
        Index("ix_committee_meeting_date", "scheduled_date"),
    )


class MeetingAgendaItem(Base):
    """Agenda items for meetings"""
    __tablename__ = "grc_meeting_agenda_items"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=False, index=True)
    item_number = Column(Integer, nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    item_type = Column(String(50), default="discussion")  # approval, discussion, information, action_review
    presenter_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    linked_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    linked_regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=True, index=True)
    time_allocated_minutes = Column(Integer, nullable=True)
    status = Column(String(50), default="pending")  # pending, discussed, deferred
    outcome = Column(Text, nullable=True)
    decision_made = Column(Text, nullable=True)
    
    tenant = relationship("Tenant")
    meeting = relationship("CommitteeMeeting", back_populates="agenda_items")
    presenter = relationship("GRCUser")
    linked_document = relationship("GovernanceDocument")
    linked_risk = relationship("Risk")
    linked_regulatory_change = relationship("RegulatoryChange")
    oversight_actions = relationship("OversightAction", back_populates="agenda_item")
    
    __table_args__ = (
        Index("ix_meeting_agenda_tenant", "tenant_id"),
        Index("ix_meeting_agenda_meeting", "meeting_id"),
        Index("ix_meeting_agenda_status", "status"),
    )


class MeetingAgendaItemVote(Base):
    """Per-member vote on a single agenda item.

    Used for the voting / consensus surface on a meeting's agenda — each
    committee member records one of {agreed, disagreed, partial, abstain}
    with an optional comment. Re-voting updates the existing row
    (per the uniq constraint below), so the tally is always one-per-user.
    """
    __tablename__ = "grc_meeting_agenda_item_votes"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    agenda_item_id = Column(Integer, ForeignKey("grc_meeting_agenda_items.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    # Allowed values enforced in the router: agreed | disagreed | partial | abstain.
    vote = Column(String(20), nullable=False)
    comment = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    agenda_item = relationship("MeetingAgendaItem", backref="votes")
    user = relationship("GRCUser", foreign_keys=[user_id])

    __table_args__ = (
        UniqueConstraint("agenda_item_id", "user_id", name="uq_agenda_item_vote"),
        Index("ix_agenda_vote_item", "agenda_item_id"),
        Index("ix_agenda_vote_user", "user_id"),
    )


class MeetingMinutes(Base):
    """Minutes record for meetings"""
    __tablename__ = "grc_meeting_minutes"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=False, unique=True, index=True)
    content = Column(Text, nullable=True)
    attendees = Column(JSON, default=[])
    status = Column(String(50), default="draft")  # draft, pending_approval, approved
    drafted_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    drafted_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    approved_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant")
    meeting = relationship("CommitteeMeeting", back_populates="minutes")
    drafter = relationship("GRCUser", foreign_keys=[drafted_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    
    __table_args__ = (
        Index("ix_meeting_minutes_tenant", "tenant_id"),
        Index("ix_meeting_minutes_status", "status"),
    )


class MeetingAttachment(Base):
    """Files attached to a committee meeting (agendas, briefing docs, presentations, supporting material)."""
    __tablename__ = "grc_meeting_attachments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=False, index=True)
    file_name = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_type = Column(String(50), nullable=True)
    file_size = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    meeting = relationship("CommitteeMeeting", back_populates="attachments")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])

    __table_args__ = (
        Index("ix_meeting_attachment_tenant", "tenant_id"),
        Index("ix_meeting_attachment_meeting", "meeting_id"),
    )


class OversightAction(Base):
    """Action tracking for oversight activities"""
    __tablename__ = "grc_oversight_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    committee_id = Column(Integer, ForeignKey("grc_governance_committees.id"), nullable=False, index=True)
    meeting_id = Column(Integer, ForeignKey("grc_committee_meetings.id"), nullable=True, index=True)
    agenda_item_id = Column(Integer, ForeignKey("grc_meeting_agenda_items.id"), nullable=True, index=True)
    action_number = Column(String(50), nullable=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    action_type = Column(String(50), default="follow_up")  # follow_up, policy_approval, risk_review, audit_response
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    status = Column(String(50), default="open")  # open, in_progress, completed, overdue
    completed_at = Column(DateTime, nullable=True)
    completion_notes = Column(Text, nullable=True)
    linked_policy_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    committee = relationship("GovernanceCommittee", back_populates="oversight_actions")
    meeting = relationship("CommitteeMeeting", back_populates="oversight_actions")
    agenda_item = relationship("MeetingAgendaItem", back_populates="oversight_actions")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_policy = relationship("GovernanceDocument")
    linked_risk = relationship("Risk")
    
    __table_args__ = (
        Index("ix_oversight_action_tenant", "tenant_id"),
        Index("ix_oversight_action_committee", "committee_id"),
        Index("ix_oversight_action_meeting", "meeting_id"),
        Index("ix_oversight_action_status", "status"),
        Index("ix_oversight_action_due_date", "due_date"),
        Index("ix_oversight_action_assigned", "assigned_to"),
    )

