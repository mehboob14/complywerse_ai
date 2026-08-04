from ._26_rcsa_risk_and_control_self_assessment_models import *  # noqa: F401,F403

# =============================================================================
# 16. Attestation & Certification Management Models
# =============================================================================

class AttestationCampaign(Base):
    """Campaign for organizing attestations (SOX 302/404, policy sign-offs, BCP/DR awareness)"""
    __tablename__ = "grc_attestation_campaigns"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    
    campaign_type = Column(String(50), nullable=False)  # sox_302, sox_404, policy_signoff, bcp_awareness, training_acknowledgment, annual_certification
    start_date = Column(DateTime, nullable=True)
    due_date = Column(DateTime, nullable=False)
    status = Column(String(50), default="draft")  # draft, active, closed, archived
    
    target_type = Column(String(50), nullable=False, default="all_users")  # all_users, by_department, by_role, custom
    target_department_ids = Column(JSON, default=[])
    target_role_ids = Column(JSON, default=[])
    target_user_ids = Column(JSON, default=[])
    
    escalation_enabled = Column(Boolean, default=True)
    reminder_days_before = Column(Integer, default=7)
    escalation_days_after = Column(Integer, default=3)
    
    attestation_text = Column(Text, nullable=True)
    requires_evidence = Column(Boolean, default=False)
    
    linked_document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_document = relationship("GovernanceDocument")
    escalation_chains = relationship("EscalationChain", back_populates="campaign", cascade="all, delete-orphan")
    attestation_requests = relationship("AttestationRequest", back_populates="campaign", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_attestation_campaign_tenant", "tenant_id"),
        Index("ix_attestation_campaign_status", "status"),
        Index("ix_attestation_campaign_type", "campaign_type"),
        Index("ix_attestation_campaign_due_date", "due_date"),
    )


class EscalationChain(Base):
    """Defines cascade hierarchy for attestation escalations"""
    __tablename__ = "grc_escalation_chains"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("grc_attestation_campaigns.id"), nullable=False, index=True)
    
    tier = Column(Integer, nullable=False)  # 1=staff, 2=manager, 3=vp, 4=cro
    tier_name = Column(String(100), nullable=True)  # Optional descriptive name
    
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    role_id = Column(Integer, ForeignKey("grc_roles.id"), nullable=True, index=True)
    
    escalation_delay_days = Column(Integer, default=3)
    notify_on_escalation = Column(Boolean, default=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    campaign = relationship("AttestationCampaign", back_populates="escalation_chains")
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    business_unit = relationship("BusinessUnit")
    role = relationship("Role")
    
    __table_args__ = (
        Index("ix_escalation_chain_tenant", "tenant_id"),
        Index("ix_escalation_chain_campaign", "campaign_id"),
        Index("ix_escalation_chain_tier", "campaign_id", "tier"),
        UniqueConstraint("campaign_id", "tier", "business_unit_id", name="uq_escalation_campaign_tier_bu"),
    )


class AttestationRequest(Base):
    """Individual attestation assignments to users"""
    __tablename__ = "grc_attestation_requests"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("grc_attestation_campaigns.id"), nullable=False, index=True)
    
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    attestation_type = Column(String(50), nullable=False)  # Same as campaign_type or more specific
    
    status = Column(String(50), default="pending")  # pending, completed, overdue, escalated
    
    assigned_at = Column(DateTime, default=datetime.utcnow)
    due_date = Column(DateTime, nullable=False)
    completed_at = Column(DateTime, nullable=True)
    
    escalation_tier = Column(Integer, default=1)
    escalated_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    reminder_sent_at = Column(DateTime, nullable=True)
    reminder_count = Column(Integer, default=0)
    escalation_sent_at = Column(DateTime, nullable=True)
    
    user_comments = Column(Text, nullable=True)
    attestation_text = Column(Text, nullable=True)
    
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)
    
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    campaign = relationship("AttestationCampaign", back_populates="attestation_requests")
    user = relationship("GRCUser", foreign_keys=[user_id])
    escalated_to = relationship("GRCUser", foreign_keys=[escalated_to_id])
    evidence = relationship("Evidence")
    
    __table_args__ = (
        Index("ix_attestation_request_tenant", "tenant_id"),
        Index("ix_attestation_request_campaign", "campaign_id"),
        Index("ix_attestation_request_user", "user_id"),
        Index("ix_attestation_request_status", "status"),
        Index("ix_attestation_request_due_date", "due_date"),
        UniqueConstraint("campaign_id", "user_id", name="uq_attestation_campaign_user"),
    )

