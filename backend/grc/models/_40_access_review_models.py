from ._39_ai_risk_assessment_template import *  # noqa: F401,F403

# =============================================================================
# 40. Access Review / User Access Certification Models
# =============================================================================
#
# These tables implement the auditor's "user access review" workflow:
#   1. Build a population of users (synced + enriched from Entra Graph).
#   2. Draw a SAMPLE (random / risk-based / full).
#   3. Run automated CHECKS that emit FINDINGS (exceptions): MFA missing,
#      ghost/terminated-still-active accounts, SoD conflicts, over-privilege.
#   4. A reviewer makes a DECISION per sampled user (approve/revoke/exception).
#   5. The campaign produces a report: population, sample, # exceptions, verdict.
#
# Reuses existing primitives: grc_users (extended with mfa_enabled etc. via
# identity/schema_migrations), grc_roles / grc_user_roles (RBAC), grc_evidence
# (per-item evidence), and the attestation escalation pattern (tier columns).


class AccessReviewCampaign(Base):
    """A user-access certification campaign over a population of users."""
    __tablename__ = "grc_access_review_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # user_access | privileged_access | terminated_access
    review_type = Column(String(40), nullable=False, default="user_access")
    # draft | population_built | sampled | in_review | completed | archived
    status = Column(String(30), nullable=False, default="draft")

    # Population + sampling
    population_size = Column(Integer, default=0)
    sampling_method = Column(String(20), default="random")  # random | risk_based | full
    requested_sample_size = Column(Integer, default=25)
    # {"include_admins": bool, "include_terminated": bool, "departments": [..]}
    risk_filters = Column(JSON, default=dict)

    # Audit period the review covers
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    due_date = Column(DateTime, nullable=True)

    # Reviewer sign-off / escalation (mirrors attestation campaign pattern)
    escalation_enabled = Column(Boolean, default=True)
    reminder_days_before = Column(Integer, default=7)
    escalation_days_after = Column(Integer, default=3)

    # Cached report rollup (recomputed on close)
    exceptions_found = Column(Integer, default=0)
    items_reviewed = Column(Integer, default=0)

    # AI auto-summary (LLM narrative of the campaign for the auditor)
    ai_summary = Column(Text, nullable=True)
    ai_summary_at = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    tenant = relationship("Tenant")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    items = relationship(
        "AccessReviewItem", back_populates="campaign", cascade="all, delete-orphan"
    )
    findings = relationship(
        "AccessReviewFinding", back_populates="campaign", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_access_review_campaign_tenant", "tenant_id"),
        Index("ix_access_review_campaign_status", "status"),
    )


class AccessReviewItem(Base):
    """One sampled user, with a point-in-time snapshot of their access state.

    The snapshot columns are denormalized on purpose: an audit must show what
    the access looked like *at review time*, even if the user is later changed
    or deleted.
    """
    __tablename__ = "grc_access_review_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(
        Integer,
        ForeignKey("grc_access_review_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)

    # --- Snapshot of the user at sample time ---
    username = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True)
    display_name = Column(String(255), nullable=True)
    department = Column(String(255), nullable=True)
    designation = Column(String(255), nullable=True)
    roles_snapshot = Column(JSON, default=list)  # list of role names
    mfa_enabled = Column(Boolean, nullable=True)
    account_enabled = Column(Boolean, nullable=True)
    last_sign_in = Column(DateTime, nullable=True)
    is_terminated = Column(Boolean, default=False)
    termination_date = Column(Date, nullable=True)
    is_privileged = Column(Boolean, default=False)

    # --- Reviewer decision ---
    # pending | approved | revoke | exception
    decision = Column(String(20), nullable=False, default="pending")
    decision_comment = Column(Text, nullable=True)
    decision_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    decision_at = Column(DateTime, nullable=True)

    # --- AI assist (LLM recommendation from the snapshot + findings) ---
    # approved | revoke | exception — advisory only; the human still decides.
    ai_recommendation = Column(String(20), nullable=True)
    ai_reason = Column(Text, nullable=True)
    ai_recommended_at = Column(DateTime, nullable=True)

    # --- Risk analytics (computed deterministically during run-checks) ---
    risk_score = Column(Integer, nullable=True)            # 0-100
    is_anomaly = Column(Boolean, default=False)            # peer-group outlier
    anomaly_note = Column(Text, nullable=True)

    # Reviewer assignment + escalation
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    escalation_tier = Column(Integer, default=1)
    escalated_to_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reminder_sent_at = Column(DateTime, nullable=True)
    escalation_sent_at = Column(DateTime, nullable=True)

    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    campaign = relationship("AccessReviewCampaign", back_populates="items")
    user = relationship("GRCUser", foreign_keys=[user_id])
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    decided_by = relationship("GRCUser", foreign_keys=[decision_by])
    escalated_to = relationship("GRCUser", foreign_keys=[escalated_to_id])
    evidence = relationship("Evidence")
    findings = relationship(
        "AccessReviewFinding", back_populates="item", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_access_review_item_campaign", "campaign_id"),
        Index("ix_access_review_item_user", "user_id"),
        Index("ix_access_review_item_decision", "decision"),
        UniqueConstraint("campaign_id", "user_id", name="uq_access_review_campaign_user"),
    )


class AccessReviewFinding(Base):
    """An exception raised by an automated check against a sampled user."""
    __tablename__ = "grc_access_review_findings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(
        Integer,
        ForeignKey("grc_access_review_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id = Column(
        Integer,
        ForeignKey("grc_access_review_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # mfa_missing | ghost_account | sod_conflict | over_privileged |
    # stale_account | no_approval
    finding_type = Column(String(40), nullable=False)
    severity = Column(String(20), nullable=False, default="medium")  # low|medium|high|critical
    title = Column(String(255), nullable=False)
    detail = Column(Text, nullable=True)

    sod_rule_id = Column(
        Integer, ForeignKey("grc_sod_rules.id", ondelete="SET NULL"), nullable=True
    )

    # open | remediated | accepted_risk | false_positive
    status = Column(String(20), nullable=False, default="open")
    remediation_note = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    campaign = relationship("AccessReviewCampaign", back_populates="findings")
    item = relationship("AccessReviewItem", back_populates="findings")
    sod_rule = relationship("SoDRule")

    __table_args__ = (
        Index("ix_access_review_finding_campaign", "campaign_id"),
        Index("ix_access_review_finding_item", "item_id"),
        Index("ix_access_review_finding_type", "finding_type"),
    )


class AccessReviewEscalation(Base):
    """One tier of the escalation chain for an access-review campaign.

    When a sampled item is still undecided past the campaign due date, the
    `escalate-overdue` action bumps it to the next tier and records that tier's
    approver as the item's `escalated_to_id`. Mirrors the attestation
    EscalationChain but scoped to access-review campaigns.
    """
    __tablename__ = "grc_access_review_escalations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    campaign_id = Column(
        Integer,
        ForeignKey("grc_access_review_campaigns.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    tier = Column(Integer, nullable=False)  # 1, 2, 3, ...
    tier_name = Column(String(100), nullable=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    escalation_delay_days = Column(Integer, default=3)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    approver = relationship("GRCUser", foreign_keys=[approver_id])

    __table_args__ = (
        Index("ix_access_review_escalation_campaign", "campaign_id"),
        UniqueConstraint("campaign_id", "tier", name="uq_access_review_escalation_tier"),
    )


class SoDRule(Base):
    """A Segregation-of-Duties conflict: holding BOTH roles is a toxic combo."""
    __tablename__ = "grc_sod_rules"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    role_a_id = Column(Integer, ForeignKey("grc_roles.id", ondelete="CASCADE"), nullable=False)
    role_b_id = Column(Integer, ForeignKey("grc_roles.id", ondelete="CASCADE"), nullable=False)
    severity = Column(String(20), nullable=False, default="high")
    is_active = Column(Boolean, default=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    role_a = relationship("Role", foreign_keys=[role_a_id])
    role_b = relationship("Role", foreign_keys=[role_b_id])

    __table_args__ = (
        Index("ix_sod_rule_tenant", "tenant_id"),
        UniqueConstraint("tenant_id", "role_a_id", "role_b_id", name="uq_sod_rule_pair"),
    )


class AccessReviewRuleConfig(Base):
    """Per-tenant enable/disable + severity override for a catalog rule.

    The rule *definitions* live in code (modules/access_review/rule_catalog.py);
    this table only records which catalog rules a tenant has turned on/off and
    any severity override. A missing row means "use the catalog default".
    """
    __tablename__ = "grc_access_review_rule_config"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    rule_id = Column(String(40), nullable=False)  # e.g. 'AUTH-01'
    enabled = Column(Boolean, nullable=False, default=True)
    severity = Column(String(20), nullable=True)  # override; null = catalog default
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_arr_rule_config_tenant", "tenant_id"),
        UniqueConstraint("tenant_id", "rule_id", name="uq_arr_rule_config"),
    )
