from ._10_evidence_management import *  # noqa: F401,F403

# =============================================================================
# 8. Enterprise Risk Management
# =============================================================================

class Risk(Base):
    __tablename__ = "grc_risks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # strategic, operational, financial, compliance, technology, third_party, project_change
    risk_category = Column(String(50), default="operational")  # strategic, operational, financial, compliance, technology, third_party, project_change
    risk_sub_category = Column(String(100), nullable=True)
    register_type = Column(String(100), nullable=True)  # PCI-DSS, ISO 27001, SOX, Internal, NIST, GDPR, etc.
    ubl_fields = Column(JSON, nullable=True)  # UBL template-specific structured fields
    # NCA template-specific fields preserved verbatim on bridged risks
    # (risk_cause, risk_analysis, threat, risk_area, treatment_*, residual_*,
    # following_steps, last_evaluation_date, etc.). Rendered as a read-only
    # panel on the general risk detail page so no NCA data is lost.
    template_fields = Column(JSON, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    business_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    affected_department_ids = Column(JSON, default=[])
    due_date = Column(DateTime, nullable=True)
    review_date = Column(DateTime, nullable=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_appetite = Column(String(50), nullable=True)
    status = Column(String(50), default="open")
    treatment_plan = Column(Text, nullable=True)
    # Reviewable AI-assist fields (also user-editable): root-cause analysis and
    # recommended actions, saved into their own columns rather than the description.
    root_cause = Column(Text, nullable=True)
    consequences = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    closure_status = Column(String(50), nullable=True)  # null, pending_closure, closed
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    closure_notes = Column(Text, nullable=True)
    # Provenance — where the risk came from. All nullable so existing rows are unaffected.
    # source_type values: manual | register_import | assessment | incident | rcsa | framework_gap | ubl_import | nca_import
    source_type = Column(String(50), nullable=True, index=True)
    source_assessment_id = Column(Integer, ForeignKey("grc_risk_assessments.id"), nullable=True, index=True)
    source_incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=True, index=True)
    source_rcsa_finding_id = Column(Integer, nullable=True, index=True)
    source_reference = Column(String(255), nullable=True)
    # --- CRQM (FAIR quantification) — Phase 1 ---
    # is_material gates the Quantification UI (FAIR works best on 10-30
    # well-formed scenarios, not the whole register). UI-gate only — the API
    # is deliberately not hard-restricted, so broader coverage later is free.
    is_material = Column(Boolean, default=False, nullable=True, index=True)
    # Structured scenario — a modellable statement needs all four parts
    # (actor, asset via RiskAssetLink, effect, method); free-text "cyber risk"
    # cannot be quantified. scenario_statement is the composed sentence shown
    # and reported; the parts stay queryable.
    scenario_actor = Column(String(200), nullable=True)
    scenario_method = Column(Text, nullable=True)
    scenario_effect = Column(JSON, nullable=True)  # {"confidentiality": bool, "integrity": bool, "availability": bool}
    scenario_statement = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Transient (non-persisted) human-readable provenance, populated by the list
    # endpoint from source_reference (e.g. the vendor name). Class default ensures
    # RiskResponse.from_attributes always finds the attribute.
    source_label = None

    tenant = relationship("Tenant", back_populates="risks")
    owner = relationship("GRCUser", back_populates="owned_risks", foreign_keys=[owner_id])
    business_owner = relationship("GRCUser", foreign_keys=[business_owner_id])
    closer = relationship("GRCUser", foreign_keys=[closed_by])
    business_unit = relationship("BusinessUnit")
    control_links = relationship("RiskControlLink", back_populates="risk", cascade="all, delete-orphan")
    asset_links = relationship("RiskAssetLink", back_populates="risk", cascade="all, delete-orphan")
    evidence_links = relationship("RiskEvidenceLink", back_populates="risk", cascade="all, delete-orphan")
    framework_control_links = relationship("RiskFrameworkControlLink", back_populates="risk", cascade="all, delete-orphan")
    governance_links = relationship("RiskGovernanceLink", back_populates="risk", cascade="all, delete-orphan")
    kris = relationship("RiskKRI", back_populates="risk", cascade="all, delete-orphan")
    # Disambiguate: source_incident_id (Risk -> RiskIncident.id) creates a second
    # FK path between these two tables. The collection still hangs off the
    # original RiskIncident.risk_id foreign key.
    incidents = relationship(
        "RiskIncident",
        back_populates="risk",
        cascade="all, delete-orphan",
        foreign_keys="RiskIncident.risk_id",
    )
    reviews = relationship("RiskReview", back_populates="risk", cascade="all, delete-orphan")
    score_history = relationship("RiskScoreHistory", back_populates="risk", cascade="all, delete-orphan")
    mitigation_actions = relationship("RiskMitigationAction", back_populates="risk", cascade="all, delete-orphan")
    document_links = relationship("DocumentRiskLink", back_populates="risk", cascade="all, delete-orphan")
    gap_findings = relationship("PolicyGapFinding", foreign_keys="PolicyGapFinding.risk_register_id", back_populates="risk_register_entry")
    
    __table_args__ = (
        Index("ix_risk_tenant_category", "tenant_id", "category"),
        Index("ix_risk_tenant_status", "tenant_id", "status"),
    )


class RiskControlLink(Base):
    __tablename__ = "grc_risk_control_links"

    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)

    # --- CRQM control effect (FAIR) ---
    # How much this control reduces the scenario's event frequency and/or
    # loss magnitude, as min/ml/max percentages (0-100) — ranges, like every
    # CRQM estimate, sampled per iteration by the simulation engine. NULL =
    # no effect modelled. The rationale is first-class: "why do we believe
    # 30-60%?" is what gets defended, not the number.
    freq_reduction_min_pct = Column(Float, nullable=True)
    freq_reduction_ml_pct = Column(Float, nullable=True)
    freq_reduction_max_pct = Column(Float, nullable=True)
    mag_reduction_min_pct = Column(Float, nullable=True)
    mag_reduction_ml_pct = Column(Float, nullable=True)
    mag_reduction_max_pct = Column(Float, nullable=True)
    effect_rationale = Column(Text, nullable=True)
    effect_updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    effect_updated_at = Column(DateTime, nullable=True)

    risk = relationship("Risk", back_populates="control_links")
    normalized_control = relationship("NormalizedControl", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_control_link", "risk_id", "normalized_control_id"),
    )


class RiskAssetLink(Base):
    __tablename__ = "grc_risk_asset_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    
    risk = relationship("Risk", back_populates="asset_links")
    asset = relationship("ITAsset", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_asset_link", "risk_id", "asset_id"),
    )


class RiskEvidenceLink(Base):
    __tablename__ = "grc_risk_evidence_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    
    risk = relationship("Risk", back_populates="evidence_links")
    evidence = relationship("Evidence", back_populates="risk_links")
    
    __table_args__ = (
        Index("ix_risk_evidence_link", "risk_id", "evidence_id"),
    )


class RiskFrameworkControlLink(Base):
    """Links risks to framework controls"""
    __tablename__ = "grc_risk_framework_control_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    mitigation_effectiveness = Column(String(50), default="partial")  # full, partial, minimal, none
    notes = Column(Text, nullable=True)
    
    risk = relationship("Risk", back_populates="framework_control_links")
    framework_control = relationship("FrameworkControl")
    
    __table_args__ = (
        UniqueConstraint("risk_id", "framework_control_id", name="uq_risk_framework_control"),
    )


class RiskGovernanceLink(Base):
    """Links risks to governance objectives"""
    __tablename__ = "grc_risk_governance_links"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    governance_objective_id = Column(Integer, ForeignKey("grc_governance_objectives.id"), nullable=False, index=True)
    impact_level = Column(String(50), default="medium")  # high, medium, low
    
    risk = relationship("Risk", back_populates="governance_links")
    governance_objective = relationship("GovernanceObjective")
    
    __table_args__ = (
        UniqueConstraint("risk_id", "governance_objective_id", name="uq_risk_governance"),
    )


class RiskKRI(Base):
    """Key Risk Indicators - metrics and thresholds for risk monitoring"""
    __tablename__ = "grc_risk_kris"
    
    id = Column(Integer, primary_key=True, index=True)
    # risk_id is now optional: a KRI can be enterprise/standalone (governance-level,
    # or live-fed from a platform metric) rather than tied to a single risk.
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    # Direct tenancy. KRIs were previously scoped only via risk_id → Risk, which
    # orphaned standalone / uploaded KRIs (they never appeared in any list). Backfilled
    # from the parent risk by ensure_kri_columns for existing rows.
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    # When set, the KRI is LIVE-FED: its value resolves from the cross-module metric
    # layer (a metric_catalog key) instead of manual measurements.
    metric_key = Column(String(60), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    metric_type = Column(String(50), default="numeric")  # numeric, percentage, count, boolean
    unit = Column(String(50), nullable=True)  # %, count, days, USD, etc.
    current_value = Column(Float, nullable=True)
    green_threshold = Column(Float, nullable=True)  # Below this is green
    amber_threshold = Column(Float, nullable=True)  # Below this is amber, above is red
    threshold_direction = Column(String(20), default="lower_is_better")  # lower_is_better, higher_is_better
    frequency = Column(String(50), default="monthly")  # daily, weekly, monthly, quarterly
    data_source = Column(String(255), nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_active = Column(Boolean, default=True)
    last_measured_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # ── Full metric lifecycle (unifies KPI + KRI management) ──────────────────
    kind = Column(String(10), default="kri")              # 'kri' | 'kpi'
    category = Column(String(100), nullable=True)         # domain / grouping
    formula = Column(Text, nullable=True)                 # methodology / how it's calculated
    target = Column(Float, nullable=True)                 # target value (distinct from RAG thresholds)
    reporting_period = Column(String(40), nullable=True)  # current period label, e.g. 2026-Q1
    next_due_date = Column(DateTime, nullable=True)       # when the next measurement is due
    data_provider_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)  # enters the value
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)        # reviews / signs off
    linked_control_ids = Column(JSON, default=list)       # cross-platform linkage
    linked_objective_ids = Column(JSON, default=list)
    linked_framework_id = Column(Integer, nullable=True)

    risk = relationship("Risk", back_populates="kris")
    owner = relationship("GRCUser", foreign_keys=[owner_id])
    measurements = relationship("RiskKRIMeasurement", back_populates="kri", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_kri_risk", "risk_id"),
    )


class RiskKRIMeasurement(Base):
    """Historical KRI measurements for trend tracking"""
    __tablename__ = "grc_risk_kri_measurements"
    
    id = Column(Integer, primary_key=True, index=True)
    kri_id = Column(Integer, ForeignKey("grc_risk_kris.id"), nullable=False, index=True)
    value = Column(Float, nullable=False)
    status = Column(String(20), default="green")  # green, amber, red
    measured_at = Column(DateTime, default=datetime.utcnow)
    measured_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    notes = Column(Text, nullable=True)
    # Period + review/approval workflow
    period_label = Column(String(40), nullable=True)        # e.g. 2026-Q1, 2026-07
    target = Column(Float, nullable=True)                   # target for this period (snapshot)
    review_status = Column(String(20), default="approved")  # draft | submitted | approved
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    kri = relationship("RiskKRI", back_populates="measurements")
    measurer = relationship("GRCUser", foreign_keys=[measured_by])
    
    __table_args__ = (
        Index("ix_kri_measurement_time", "kri_id", "measured_at"),
    )


class RiskIncident(Base):
    """Risk events and incidents - actual realized risks"""
    __tablename__ = "grc_risk_incidents"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    incident_date = Column(DateTime, nullable=False)
    discovered_date = Column(DateTime, default=datetime.utcnow)
    severity = Column(String(50), default="medium")  # critical, high, medium, low
    status = Column(String(50), default="open")  # open, investigating, contained, resolved, closed
    financial_impact = Column(Float, nullable=True)
    operational_impact = Column(Text, nullable=True)
    root_cause = Column(Text, nullable=True)
    corrective_actions = Column(Text, nullable=True)
    lessons_learned = Column(Text, nullable=True)
    reported_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    # Free-form labels for triage / filtering (list of strings). Additive + nullable.
    tags = Column(JSON, nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    risk = relationship("Risk", back_populates="incidents", foreign_keys=[risk_id])
    reporter = relationship("GRCUser", foreign_keys=[reported_by])
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    evidence_links = relationship("EvidenceIncidentLink", back_populates="incident", cascade="all, delete-orphan")
    asset_links = relationship("IncidentAssetLink", back_populates="incident", cascade="all, delete-orphan")
    vulnerability_links = relationship("IncidentVulnerabilityLink", back_populates="incident", cascade="all, delete-orphan")
    risk_links = relationship("IncidentRiskLink", back_populates="incident", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_incident_tenant_status", "tenant_id", "status"),
        Index("ix_incident_risk", "risk_id"),
    )


class IncidentAssetLink(Base):
    """Cross-module link: incident ↔ IT asset."""
    __tablename__ = "grc_incident_asset_links"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("grc_it_assets.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    incident = relationship("RiskIncident", back_populates="asset_links")
    asset = relationship("ITAsset")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("incident_id", "asset_id", name="uq_incident_asset_link"),
        Index("ix_incident_asset_link", "incident_id", "asset_id"),
    )


class IncidentVulnerabilityLink(Base):
    """Cross-module link: incident ↔ vulnerability."""
    __tablename__ = "grc_incident_vulnerability_links"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    vulnerability_id = Column(Integer, ForeignKey("grc_vulnerabilities.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    incident = relationship("RiskIncident", back_populates="vulnerability_links")
    vulnerability = relationship("Vulnerability")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("incident_id", "vulnerability_id", name="uq_incident_vuln_link"),
        Index("ix_incident_vuln_link", "incident_id", "vulnerability_id"),
    )


class IncidentRiskLink(Base):
    """Additional risks related to an incident (beyond the primary risk_id FK)."""
    __tablename__ = "grc_incident_risk_links"

    id = Column(Integer, primary_key=True, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    incident = relationship("RiskIncident", back_populates="risk_links")
    risk = relationship("Risk")
    creator = relationship("GRCUser", foreign_keys=[created_by])

    __table_args__ = (
        UniqueConstraint("incident_id", "risk_id", name="uq_incident_risk_link"),
        Index("ix_incident_risk_link", "incident_id", "risk_id"),
    )


class RiskReview(Base):
    """Risk review workflow - periodic assessments and approvals"""
    __tablename__ = "grc_risk_reviews"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    review_cycle = Column(String(50), default="quarterly")  # monthly, quarterly, semi_annual, annual
    review_type = Column(String(50), default="periodic")  # periodic, triggered, adhoc
    status = Column(String(50), default="pending")  # pending, in_review, approved, rejected
    due_date = Column(DateTime, nullable=False)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    reviewer_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approver_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    previous_inherent_score = Column(Float, nullable=True)
    previous_residual_score = Column(Float, nullable=True)
    new_inherent_score = Column(Float, nullable=True)
    new_residual_score = Column(Float, nullable=True)
    findings = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    approval_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="reviews")
    reviewer = relationship("GRCUser", foreign_keys=[reviewer_id])
    approver = relationship("GRCUser", foreign_keys=[approver_id])
    
    __table_args__ = (
        Index("ix_review_risk_status", "risk_id", "status"),
        Index("ix_review_due_date", "due_date"),
    )


class RiskScoreHistory(Base):
    """Track risk score changes over time for trend analysis"""
    __tablename__ = "grc_risk_score_history"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    status = Column(String(50), nullable=True)
    change_reason = Column(String(255), nullable=True)
    changed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="score_history")
    user = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_score_history_risk_time", "risk_id", "recorded_at"),
    )


class RiskDependency(Base):
    """Map relationships between risks - cascading impact analysis"""
    __tablename__ = "grc_risk_dependencies"
    
    id = Column(Integer, primary_key=True, index=True)
    source_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    target_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    dependency_type = Column(String(50), default="causes")  # causes, aggravates, mitigates, related
    impact_factor = Column(Float, default=1.0)  # Multiplier for cascade calculation
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    source_risk = relationship("Risk", foreign_keys=[source_risk_id], backref="outgoing_dependencies")
    target_risk = relationship("Risk", foreign_keys=[target_risk_id], backref="incoming_dependencies")
    
    __table_args__ = (
        UniqueConstraint("source_risk_id", "target_risk_id", name="uq_risk_dependency"),
        Index("ix_dependency_source", "source_risk_id"),
        Index("ix_dependency_target", "target_risk_id"),
    )


class RiskAppetiteConfig(Base):
    """Risk appetite configuration per tenant/category"""
    __tablename__ = "grc_risk_appetite_config"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    category = Column(String(50), nullable=False)
    appetite_level = Column(String(50), default="moderate")  # averse, minimal, cautious, moderate, open, hungry
    max_acceptable_score = Column(Float, default=12.0)
    tolerance_threshold = Column(Float, nullable=True)
    escalation_owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    alert_enabled = Column(Boolean, default=True)
    description = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    escalation_owner = relationship("GRCUser")
    
    __table_args__ = (
        UniqueConstraint("tenant_id", "category", name="uq_risk_appetite_tenant_category"),
    )


class RiskMitigationAction(Base):
    """Risk mitigation actions - specific actions to treat risks"""
    __tablename__ = "grc_risk_mitigation_actions"
    
    id = Column(Integer, primary_key=True, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    action_type = Column(String(50), default="mitigate")  # mitigate, transfer, avoid, accept
    status = Column(String(50), default="open")  # open, in_progress, completed, overdue, cancelled
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    expected_residual_reduction = Column(Float, nullable=True)
    actual_residual_reduction = Column(Float, nullable=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    risk = relationship("Risk", back_populates="mitigation_actions")
    owner = relationship("GRCUser")
    evidence = relationship("Evidence")
    # Many-to-many evidence linkage (mirrors InternalControlEvidence). The
    # legacy single `evidence_id` column above is kept for back-compat.
    evidence_links = relationship(
        "RiskMitigationActionEvidence",
        back_populates="action",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_mitigation_action_risk", "risk_id"),
        Index("ix_mitigation_action_status", "status"),
    )


class RiskMitigationActionEvidence(Base):
    """Pivot table linking evidence records to a mitigation action.

    Mirrors `InternalControlEvidence` so the same UX pattern (search, link,
    unlink, list) can be reused. A unique (action, evidence) constraint
    prevents duplicate links.
    """
    __tablename__ = "grc_risk_mitigation_action_evidence"

    id = Column(Integer, primary_key=True, index=True)
    mitigation_action_id = Column(Integer, ForeignKey("grc_risk_mitigation_actions.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    linked_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    linked_at = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text, nullable=True)

    action = relationship("RiskMitigationAction", back_populates="evidence_links")
    evidence = relationship("Evidence")
    linker = relationship("GRCUser")

    __table_args__ = (
        Index(
            "uq_risk_mitigation_action_evidence",
            "mitigation_action_id",
            "evidence_id",
            unique=True,
        ),
    )




class LikelihoodImpactScale(Base):
    """Configurable likelihood and impact scales for risk scoring"""
    __tablename__ = "grc_likelihood_impact_scales"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    scale_type = Column(String(20), nullable=False)  # likelihood, impact
    level = Column(Integer, nullable=False)  # 1-5 (or custom range)
    label = Column(String(100), nullable=False)  # e.g., "Rare", "Unlikely", etc.
    description = Column(Text, nullable=True)
    score_value = Column(Float, nullable=False)  # Numeric value for calculations
    color = Column(String(20), nullable=True)  # For UI display
    is_default = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    
    __table_args__ = (
        Index("ix_likelihood_impact_scale_tenant", "tenant_id", "scale_type"),
        UniqueConstraint("tenant_id", "scale_type", "level", name="uq_tenant_scale_level"),
    )


class RiskReport(Base):
    """Generated risk reports for governance oversight"""
    __tablename__ = "grc_risk_reports"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    report_type = Column(String(50), nullable=False)  # board_summary, department, audit, regulatory, breach
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    report_period_start = Column(DateTime, nullable=True)
    report_period_end = Column(DateTime, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow)
    generated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    report_data = Column(JSON, default={})
    file_path = Column(String(500), nullable=True)
    status = Column(String(50), default="generated")  # draft, generated, reviewed, published
    
    tenant = relationship("Tenant")
    generator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_report_tenant_type", "tenant_id", "report_type"),
    )


class RiskAssessment(Base):
    """Formal risk assessment campaigns/exercises"""
    __tablename__ = "grc_risk_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    assessment_type = Column(String(50), default="periodic")  # periodic, ad_hoc, incident_driven, regulatory
    methodology = Column(String(100), nullable=True)  # NIST, ISO31000, FAIR, OCTAVE
    scope = Column(Text, nullable=True)
    assessment_period_start = Column(DateTime, nullable=True)
    assessment_period_end = Column(DateTime, nullable=True)
    status = Column(String(50), default="draft")  # draft, in_progress, under_review, approved, closed
    lead_assessor_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    business_unit_id = Column(Integer, ForeignKey("grc_business_units.id"), nullable=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    
    tenant = relationship("Tenant")
    lead_assessor = relationship("GRCUser", foreign_keys=[lead_assessor_id])
    approver = relationship("GRCUser", foreign_keys=[approved_by])
    business_unit = relationship("BusinessUnit")
    framework = relationship("Framework")
    assessed_risks = relationship("RiskAssessmentRisk", back_populates="assessment", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_risk_assessment_tenant_status", "tenant_id", "status"),
        Index("ix_risk_assessment_dates", "assessment_period_start", "assessment_period_end"),
    )


class RiskAssessmentRisk(Base):
    """Link between risk assessments and risks with assessment-specific data"""
    __tablename__ = "grc_risk_assessment_risks"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_risk_assessments.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)    
    inherent_likelihood = Column(Integer, nullable=True)  # 1-5 scale
    inherent_impact = Column(Integer, nullable=True)  # 1-5 scale
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    risk_rating = Column(String(50), nullable=True)  # critical, high, medium, low
    treatment_decision = Column(String(50), nullable=True)  # accept, mitigate, transfer, avoid
    rationale = Column(Text, nullable=True)
    control_effectiveness = Column(String(50), nullable=True)  # effective, partially_effective, ineffective
    notes = Column(Text, nullable=True)
    assessed_at = Column(DateTime, default=datetime.utcnow)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    
    assessment = relationship("RiskAssessment", back_populates="assessed_risks")
    risk = relationship("Risk")
    assessor = relationship("GRCUser")
    linked_kris = relationship("RiskAssessmentKRI", back_populates="assessment_risk", cascade="all, delete-orphan")
    linked_incidents = relationship("RiskAssessmentIncident", back_populates="assessment_risk", cascade="all, delete-orphan")
    linked_rcsa_findings = relationship("RiskAssessmentRCSAFinding", back_populates="assessment_risk", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_assessment_risk_link", "assessment_id", "risk_id"),
        UniqueConstraint("assessment_id", "risk_id", name="uq_assessment_risk"),
    )


class RiskAssessmentKRI(Base):
    """Link between risk assessments and KRIs"""
    __tablename__ = "grc_risk_assessment_kris"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    kri_id = Column(Integer, ForeignKey("grc_risk_kris.id"), nullable=False, index=True)
    observed_value = Column(Float, nullable=True)
    threshold_status = Column(String(50), nullable=True)  # green, amber, red
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_kris")
    kri = relationship("RiskKRI")
    
    __table_args__ = (
        Index("ix_assessment_kri_link", "assessment_risk_id", "kri_id"),
    )


class RiskAssessmentIncident(Base):
    """Link between risk assessments and incidents"""
    __tablename__ = "grc_risk_assessment_incidents"
     
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    incident_id = Column(Integer, ForeignKey("grc_risk_incidents.id"), nullable=False, index=True)
    impact_on_rating = Column(String(50), nullable=True)  # increased, decreased, no_change
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_incidents")
    incident = relationship("RiskIncident")
    
    __table_args__ = (
        Index("ix_assessment_incident_link", "assessment_risk_id", "incident_id"),
    )


class RiskAssessmentRCSAFinding(Base):
    """Link between risk assessments and RCSA findings"""
    __tablename__ = "grc_risk_assessment_rcsa_findings"
    
    id = Column(Integer, primary_key=True, index=True)
    assessment_risk_id = Column(Integer, ForeignKey("grc_risk_assessment_risks.id"), nullable=False, index=True)
    rcsa_finding_id = Column(Integer, ForeignKey("grc_rcsa_findings.id"), nullable=False, index=True)
    relevance_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    assessment_risk = relationship("RiskAssessmentRisk", back_populates="linked_rcsa_findings")
    rcsa_finding = relationship("RCSAFinding")
    
    __table_args__ = (
        Index("ix_assessment_rcsa_finding_link", "assessment_risk_id", "rcsa_finding_id"),
    )


class FrameworkRiskAssessment(Base):
    """Framework-based risk assessment questionnaire"""
    __tablename__ = "grc_framework_risk_assessments"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # framework_id kept for backwards-compat with previously-published frameworks
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    # uploaded_framework_id is the primary reference going forward (all UploadedFramework statuses)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="in_progress")  # in_progress, completed, archived
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    framework = relationship("Framework")
    uploaded_framework = relationship("UploadedFramework")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    questions = relationship("FrameworkRiskQuestion", back_populates="assessment", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_fw_risk_assessment_tenant", "tenant_id"),
        Index("ix_fw_risk_assessment_framework", "framework_id"),
        Index("ix_fw_risk_assessment_uploaded_fw", "uploaded_framework_id"),
    )


class FrameworkRiskQuestion(Base):
    """Question items for framework risk assessment"""
    __tablename__ = "grc_framework_risk_questions"

    id = Column(Integer, primary_key=True, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_framework_risk_assessments.id"), nullable=False, index=True)
    question_text = Column(Text, nullable=False)
    status = Column(String(50), default="not_started")  # not_started, in_progress, completed, blocked
    assigned_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    inherent_likelihood = Column(Integer, nullable=True)
    inherent_impact = Column(Integer, nullable=True)
    inherent_score = Column(Float, nullable=True)
    residual_likelihood = Column(Integer, nullable=True)
    residual_impact = Column(Integer, nullable=True)
    residual_score = Column(Float, nullable=True)
    is_risk_accepted = Column(Boolean, default=False)
    acceptance_notes = Column(Text, nullable=True)
    linked_risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=True, index=True)
    moved_to_risk_register_at = Column(DateTime, nullable=True)
    order_index = Column(Integer, default=0)
    # Methodology metadata — populated when the question was generated by a
    # framework-specific methodology (ISO 27005, PCI DSS TRA, NIST 800-30,
    # SOC 2 TSC). All nullable so AI-generated and manually-added questions
    # remain unaffected.
    methodology_code = Column(String(50), nullable=True, index=True)
    phase_code = Column(String(50), nullable=True)
    clause_reference = Column(String(100), nullable=True)
    methodology_fields = Column(JSON, nullable=True)
    source_quote = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    assessment = relationship("FrameworkRiskAssessment", back_populates="questions")
    assignee = relationship("GRCUser", foreign_keys=[assigned_user_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_risk = relationship("Risk", foreign_keys=[linked_risk_id])
    evidence_uploads = relationship("FrameworkRiskQuestionEvidence", back_populates="question", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_fw_risk_question_assessment", "assessment_id"),
        Index("ix_fw_risk_question_status", "status"),
    )


class FrameworkRiskQuestionEvidence(Base):
    """Evidence uploaded for framework risk assessment questions"""
    __tablename__ = "grc_framework_risk_question_evidence"

    id = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("grc_framework_risk_questions.id"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    question = relationship("FrameworkRiskQuestion", back_populates="evidence_uploads")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])

    __table_args__ = (
        Index("ix_fw_risk_question_evidence_question", "question_id"),
    )

