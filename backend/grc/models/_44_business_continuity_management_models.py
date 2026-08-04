from ._43_framework_templates_models import *  # noqa: F401,F403

# =============================================================================
# 44. Business Continuity Management (BCM) & Drill Tracking
# =============================================================================
# Orchestration layer only — reuses existing infrastructure rather than
# duplicating it:
#   * Findings auto-create records in the Issue/CAPA module (grc_issues).
#   * Plans reference documents in Policy & Document (grc_governance_documents).
#   * BIA/Findings can create/link entries in the Risk Register (grc_risks).
#   * Drills can link real incidents from Incident Mgmt (grc_risk_incidents).
#   * Writes are audited via the shared grc_audit_logs service.
# Every table is brand-new (grc_bcm_*), so it auto-creates on tenant engine
# init via Base.metadata.create_all — no schema-migration entries required.


class BcmPlan(Base):
    """A Business Continuity Plan for a critical business process/unit.

    Lightweight own status flow (Draft -> Under Review -> Approved -> Retired);
    references — never duplicates — a governance document for the plan body.
    """
    __tablename__ = "grc_bcm_plans"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    business_unit = Column(String(255), nullable=True)  # free-text scope/BU

    # Draft | under_review | approved | retired
    status = Column(String(30), default="draft", nullable=False, index=True)

    # Pointer into Policy & Document module (never a duplicate upload).
    document_ref_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True)

    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # Plan-level recovery objectives (hours). Required before Approved.
    rto_hours = Column(Integer, nullable=True)
    rpo_hours = Column(Integer, nullable=True)

    # Minimum testing cadence: annual | semi_annual | quarterly.
    testing_frequency = Column(String(20), default="annual", nullable=False)

    version = Column(Integer, default=1)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_date = Column(DateTime, nullable=True)
    next_review_due = Column(DateTime, nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    document = relationship("GovernanceDocument", foreign_keys=[document_ref_id])
    bia_records = relationship("BcmBiaRecord", back_populates="plan", cascade="all, delete-orphan")
    drills = relationship("BcmDrill", back_populates="plan", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_bcm_plan_tenant", "tenant_id"),
        Index("ix_bcm_plan_tenant_status", "tenant_id", "status"),
    )


class BcmBiaRecord(Base):
    """Business Impact Analysis line — one critical process within a plan.

    Carries criticality + recovery objectives (RTO/RPO/MTPD). MTPD is the outer
    tolerance; RTO must be shorter than MTPD (enforced in the router).
    """
    __tablename__ = "grc_bcm_bia_records"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("grc_bcm_plans.id"), nullable=False, index=True)

    process_name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # critical | high | medium | low
    criticality_rating = Column(String(20), default="medium", nullable=False)

    rto_hours = Column(Integer, nullable=True)
    rpo_hours = Column(Integer, nullable=True)
    mtpd_hours = Column(Integer, nullable=True)

    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True)
    # IT inventory assets (grc_it_assets ids) this process depends on — links
    # continuity planning to the real asset register rather than free text.
    linked_asset_ids = Column(JSON, default=list)

    # A BIA record is "complete" only once it has at least one recovery strategy.
    is_complete = Column(Boolean, default=False)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    plan = relationship("BcmPlan", back_populates="bia_records")
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    dependencies = relationship("BcmBiaDependency", back_populates="bia", cascade="all, delete-orphan")
    recovery_strategies = relationship("BcmRecoveryStrategy", back_populates="bia", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_bcm_bia_tenant", "tenant_id"),
        Index("ix_bcm_bia_plan", "plan_id"),
    )


class BcmBiaDependency(Base):
    """A typed, named dependency of a critical process — never free text.

    Auditors want the process tied to a NAMED system/vendor/role/site.
    """
    __tablename__ = "grc_bcm_bia_dependencies"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    bia_id = Column(Integer, ForeignKey("grc_bcm_bia_records.id"), nullable=False, index=True)

    # system | vendor | staff | facility
    dependency_type = Column(String(20), nullable=False)
    name = Column(String(255), nullable=False)
    criticality = Column(String(20), default="medium")
    # Vendor-type only: confirmed | requested | not_provided | na
    external_bcp_status = Column(String(20), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    bia = relationship("BcmBiaRecord", back_populates="dependencies")

    __table_args__ = (
        Index("ix_bcm_dep_tenant", "tenant_id"),
        Index("ix_bcm_dep_bia", "bia_id"),
    )


class BcmRecoveryStrategy(Base):
    """How a process will be recovered — a distinct structured artifact,
    sitting between the BIA and the plan document."""
    __tablename__ = "grc_bcm_recovery_strategies"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    bia_id = Column(Integer, ForeignKey("grc_bcm_bia_records.id"), nullable=False, index=True)

    # alternate_site | remote_work | manual_workaround | vendor_failover |
    # warm_site | cold_site | hot_site
    strategy_type = Column(String(40), nullable=False)
    description = Column(Text, nullable=True)
    activation_procedure_ref = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True)

    # proposed | approved | rejected
    status = Column(String(20), default="proposed", nullable=False)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_date = Column(DateTime, nullable=True)
    review_comments = Column(Text, nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    bia = relationship("BcmBiaRecord", back_populates="recovery_strategies")
    procedure_document = relationship("GovernanceDocument", foreign_keys=[activation_procedure_ref])
    approver = relationship("GRCUser", foreign_keys=[approved_by])

    __table_args__ = (
        Index("ix_bcm_strategy_tenant", "tenant_id"),
        Index("ix_bcm_strategy_bia", "bia_id"),
    )


class BcmDrill(Base):
    """A continuity test exercise OR a real incident-triggered invocation.

    source_type distinguishes rehearsed drills from real-world invocations so
    they can be reported separately while sharing one structure.
    """
    __tablename__ = "grc_bcm_drills"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    plan_id = Column(Integer, ForeignKey("grc_bcm_plans.id"), nullable=False, index=True)

    title = Column(String(255), nullable=False)
    # tabletop | simulation | full_failover | call_tree
    drill_type = Column(String(30), default="tabletop", nullable=False)
    scenario = Column(Text, nullable=True)

    scheduled_date = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)

    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    participants = Column(JSON, default=list)  # list of {id?, name}

    # scheduled | in_progress | completed | under_review | closed | cancelled
    # ("overdue" is DERIVED at read time from scheduled_date, never stored).
    status = Column(String(20), default="scheduled", nullable=False, index=True)

    # scheduled_test | incident_triggered
    source_type = Column(String(20), default="scheduled_test", nullable=False)
    linked_incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    plan = relationship("BcmPlan", back_populates="drills")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_incident = relationship("RiskIncident", foreign_keys=[linked_incident_id])
    result = relationship("BcmDrillResult", back_populates="drill", uselist=False, cascade="all, delete-orphan")
    findings = relationship("BcmFinding", back_populates="drill", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_bcm_drill_tenant", "tenant_id"),
        Index("ix_bcm_drill_plan", "plan_id"),
        Index("ix_bcm_drill_tenant_status", "tenant_id", "status"),
    )


class BcmDrillResult(Base):
    """Recorded outcome of a drill/invocation. One per drill.

    A drill cannot move to 'closed' without a result (enforced in the router).
    """
    __tablename__ = "grc_bcm_drill_results"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    drill_id = Column(Integer, ForeignKey("grc_bcm_drills.id"), nullable=False, unique=True, index=True)

    rto_met = Column(Boolean, nullable=True)
    rpo_met = Column(Boolean, nullable=True)
    actual_rto_hours = Column(Integer, nullable=True)
    actual_rpo_hours = Column(Integer, nullable=True)
    summary = Column(Text, nullable=True)

    # Optional pointer into the Evidence module (grc_evidence).
    evidence_ref_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)

    recorded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow)

    drill = relationship("BcmDrill", back_populates="result")
    recorder = relationship("GRCUser", foreign_keys=[recorded_by])

    __table_args__ = (
        Index("ix_bcm_result_tenant", "tenant_id"),
    )


class BcmFinding(Base):
    """A gap/failure surfaced during a drill. Its remediation status is DERIVED
    from the linked Issue/CAPA record (never stored independently), so the two
    can't drift out of sync. Findings cannot be manually closed."""
    __tablename__ = "grc_bcm_findings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    drill_id = Column(Integer, ForeignKey("grc_bcm_drills.id"), nullable=False, index=True)

    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    # critical | high | medium | low
    severity = Column(String(20), default="medium", nullable=False)

    # Set when an Issue/CAPA is auto-created (or manually created) for it.
    linked_issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    drill = relationship("BcmDrill", back_populates="findings")
    linked_issue = relationship("Issue", foreign_keys=[linked_issue_id])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        Index("ix_bcm_finding_tenant", "tenant_id"),
        Index("ix_bcm_finding_drill", "drill_id"),
    )


class BcmSettings(Base):
    """Per-tenant BCM configuration (singleton per tenant)."""
    __tablename__ = "grc_bcm_settings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, unique=True, index=True)

    # Findings at/above this severity auto-create an Issue/CAPA.
    # critical | high | medium | low
    finding_issue_threshold = Column(String(20), default="high", nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_bcm_settings_tenant", "tenant_id"),
    )
