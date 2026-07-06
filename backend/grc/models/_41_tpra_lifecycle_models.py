from ._40_ai_recommendation_store import *  # noqa: F401,F403

# =============================================================================
# 41. TPRA (Third-Party Risk Assessment) — normalized lifecycle models
# -----------------------------------------------------------------------------
# Productionizes the vendor-risk module into an 11-stage, gated, versioned TPRA
# platform. These tables are ADDITIVE — the legacy JSON blobs on `grc_vendors`
# and `grc_vendor_assessments` are retained for back-compat (read-through during
# the transition) and never dropped. New tenants get these via create_all; the
# columns added to existing vendor tables are applied via schema_migrations.
#
# Conventions matched from the existing codebase: tenant_id Integer FK + index,
# datetime.utcnow defaults, JSON defaults, indexes in __table_args__. Every
# history-bearing row carries `deleted_at` (soft-delete) and `row_version`
# (optimistic concurrency). Cross-module links are loose FKs (plain Integer)
# to avoid cross-DB constraint coupling, consistent with the existing module.
# =============================================================================

# Canonical 11-stage lifecycle (data-driven; the engine/UI read this, never
# hard-code stage logic). Gates on 02 (Inherent Risk Tiering) and 08 (Approval).
TPRA_STAGES = [
    {"key": "intake",          "order": 1,  "label": "Intake & Scoping",          "phase": "Onboarding diligence",   "gate": False},
    {"key": "tiering",         "order": 2,  "label": "Inherent Risk Tiering",     "phase": "Onboarding diligence",   "gate": True},
    {"key": "dd_planning",     "order": 3,  "label": "Due Diligence Planning",    "phase": "Onboarding diligence",   "gate": False},
    {"key": "questionnaire",   "order": 4,  "label": "Questionnaire & Evidence",  "phase": "Onboarding diligence",   "gate": False},
    {"key": "scoring",         "order": 5,  "label": "Risk Analysis & Scoring",   "phase": "Decision & contracting", "gate": False},
    {"key": "findings",        "order": 6,  "label": "Findings & Remediation",    "phase": "Decision & contracting", "gate": False},
    {"key": "contracting",     "order": 7,  "label": "Contracting & Controls",    "phase": "Decision & contracting", "gate": False},
    {"key": "approval",        "order": 8,  "label": "Approval Decision",         "phase": "Decision & contracting", "gate": True},
    {"key": "onboarding",      "order": 9,  "label": "Onboarding & Enablement",   "phase": "In-life management",     "gate": False},
    {"key": "monitoring",      "order": 10, "label": "Continuous Monitoring",     "phase": "In-life management",     "gate": False},
    {"key": "reassessment",    "order": 11, "label": "Reassessment & Offboarding","phase": "In-life management",     "gate": False},
]

# The ten risk domains scored per assessment.
TPRA_RISK_DOMAINS = [
    {"key": "cybersecurity",        "label": "Cybersecurity"},
    {"key": "data_privacy",         "label": "Data Privacy"},
    {"key": "operational",          "label": "Operational Resilience"},
    {"key": "financial",            "label": "Financial Viability"},
    {"key": "compliance",           "label": "Compliance & Regulatory"},
    {"key": "reputational",         "label": "Reputational"},
    {"key": "geographic",           "label": "Geographic/Geopolitical"},
    {"key": "fourth_party",         "label": "Fourth-Party/Concentration"},
    {"key": "esg",                  "label": "ESG & Sustainability"},
    {"key": "legal",                "label": "Legal & Contractual"},
]


class TPRAStageInstance(Base):
    """One row per (assessment, stage). Holds status, gate decision, exit-criteria
    result and role assignments — replaces the single mutable lifecycle blob so
    each assessment version keeps its own stage history."""
    __tablename__ = "grc_tpra_stage_instances"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=False, index=True)
    stage_key = Column(String(40), nullable=False, index=True)
    stage_order = Column(Integer, nullable=False, default=0)
    is_gate = Column(Boolean, default=False)
    # not_started | in_progress | blocked | complete | skipped
    status = Column(String(20), default="not_started", index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    assigned_roles = Column(JSON, default=list)         # [{role, user_id?}]
    exit_criteria_result = Column(JSON, default=dict)   # {passed: bool, blockers: [str]}
    gate_decision = Column(JSON, default=dict)          # {decision, by, at, rationale}
    # Interactive per-stage task checklist (the "steps I can do" surface). Seeded
    # from the stage's activities in the UI; [{text, done, note?, owner_id?, due_date?}].
    checklist = Column(JSON, default=list)
    skipped_reason = Column(Text, nullable=True)
    skipped_by = Column(Integer, nullable=True)
    row_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_stage_assessment", "assessment_id", "stage_order"),
        Index("ix_tpra_stage_status", "tenant_id", "status"),
        UniqueConstraint("assessment_id", "stage_key", name="uq_tpra_stage_assessment_key"),
    )


class TPRAQuestion(Base):
    """Normalized questionnaire question (replaces template.questions JSON for new
    flows; legacy JSON retained). Carries domain, weight and critical_control flag
    so scoring can weight critical controls and attribute findings to domains."""
    __tablename__ = "grc_tpra_questions"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    template_id = Column(Integer, ForeignKey("grc_vendor_questionnaire_templates.id"), nullable=False, index=True)
    # Stable external key matching the legacy JSON question id where backfilled.
    question_key = Column(String(100), nullable=True, index=True)
    text = Column(Text, nullable=False)
    domain = Column(String(40), default="cybersecurity", index=True)
    # text | yes_no | multiple_choice | rating  (answer normalized to Yes/Partial/No/N-A for scoring)
    qtype = Column(String(30), default="yes_no")
    options = Column(JSON, default=list)
    weight = Column(Float, default=1.0)
    critical_control = Column(Boolean, default=False)
    evidence_required = Column(Boolean, default=False)
    order = Column(Integer, default=0)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_question_template", "template_id", "order"),
        Index("ix_tpra_question_domain", "tenant_id", "domain"),
    )


class TPRAQuestionResponse(Base):
    """Normalized per-question answer for an assessment. Backfilled from the legacy
    responses JSON; kept in sync so the external token flow keeps working."""
    __tablename__ = "grc_tpra_question_responses"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=False, index=True)
    question_id = Column(Integer, ForeignKey("grc_tpra_questions.id"), nullable=True, index=True)
    # Loose link to the legacy response row this was derived from (back-compat).
    legacy_response_id = Column(Integer, nullable=True, index=True)
    question_key = Column(String(100), nullable=True, index=True)
    # Yes | Partial | No | N-A  (normalized answer used for scoring)
    answer = Column(String(20), nullable=True)
    raw_value = Column(Text, nullable=True)      # original free-form / option value
    note = Column(Text, nullable=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_qresponse_assessment", "assessment_id", "question_id"),
    )


class TPRAFinding(Base):
    """A scored gap in a risk domain. Source response + critical-control failure
    flag drive blocking behaviour at the gates."""
    __tablename__ = "grc_tpra_findings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=False, index=True)
    domain = Column(String(40), default="cybersecurity", index=True)
    severity = Column(String(20), default="medium")      # critical | high | medium | low
    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    source_response_id = Column(Integer, nullable=True, index=True)
    is_critical_control_fail = Column(Boolean, default=False)
    # open | in_remediation | accepted | closed
    status = Column(String(30), default="open", index=True)
    # Loose ref to grc_risks.id once this finding is promoted into the ERM Risk
    # Register as a vendor-sourced risk (set by service.promote_finding_to_register).
    linked_risk_id = Column(Integer, nullable=True, index=True)
    # Loose ref to grc_issues.id — the shared Issue/Action item this finding mirrors
    # into (unified owner/SLA/workflow). Set by service.ensure_finding_issue (TPRM-003).
    linked_issue_id = Column(Integer, nullable=True, index=True)
    created_by = Column(Integer, nullable=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    remediations = relationship(
        "TPRARemediation", back_populates="finding", cascade="all, delete-orphan"
    )
    acceptances = relationship(
        "TPRARiskAcceptance", back_populates="finding", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_tpra_finding_assessment", "assessment_id", "status"),
        Index("ix_tpra_finding_severity", "tenant_id", "severity"),
    )


class TPRARemediation(Base):
    """A remediation task driving a finding to closure (owner + plan + due date)."""
    __tablename__ = "grc_tpra_remediations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    finding_id = Column(Integer, ForeignKey("grc_tpra_findings.id"), nullable=False, index=True)
    title = Column(String(255), nullable=True)
    plan = Column(Text, nullable=True)
    # remediate | mitigate | transfer
    treatment_type = Column(String(30), default="remediate")
    owner_id = Column(Integer, nullable=True)
    due_date = Column(DateTime, nullable=True)
    # open | in_progress | completed | overdue
    status = Column(String(30), default="open", index=True)
    completed_at = Column(DateTime, nullable=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    finding = relationship("TPRAFinding", back_populates="remediations")

    __table_args__ = (
        Index("ix_tpra_remediation_finding", "finding_id", "status"),
    )


class TPRARiskAcceptance(Base):
    """A formally signed-off acceptance of a finding's residual risk."""
    __tablename__ = "grc_tpra_risk_acceptances"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    finding_id = Column(Integer, ForeignKey("grc_tpra_findings.id"), nullable=False, index=True)
    rationale = Column(Text, nullable=True)
    accepted_by = Column(Integer, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    expiry = Column(DateTime, nullable=True)
    # active | expired | revoked
    status = Column(String(20), default="active", index=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    finding = relationship("TPRAFinding", back_populates="acceptances")

    __table_args__ = (
        Index("ix_tpra_acceptance_finding", "finding_id", "status"),
    )


class TPRAContract(Base):
    """Contract / agreement record carrying the controls the assessment requires."""
    __tablename__ = "grc_tpra_contracts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=True, index=True)
    # master | dpa | sla | security_addendum
    contract_type = Column(String(40), default="master")
    title = Column(String(255), nullable=True)
    terms = Column(Text, nullable=True)
    # Loose link to a Governance Document holding the executed file.
    document_id = Column(Integer, nullable=True)
    effective_date = Column(DateTime, nullable=True)
    renewal_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)
    # draft | active | expired | terminated
    status = Column(String(30), default="draft", index=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    obligations = relationship(
        "TPRAControlObligation", back_populates="contract", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_tpra_contract_vendor", "vendor_id", "status"),
    )


class TPRAControlObligation(Base):
    """A binding control obligation captured in a contract, with renewal tracking."""
    __tablename__ = "grc_tpra_control_obligations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    contract_id = Column(Integer, ForeignKey("grc_tpra_contracts.id"), nullable=False, index=True)
    obligation = Column(Text, nullable=False)
    control_ref = Column(String(100), nullable=True)
    # Loose link to the finding this obligation closes, if any.
    finding_id = Column(Integer, nullable=True, index=True)
    renewal_date = Column(DateTime, nullable=True)
    # open | met | breached | waived
    status = Column(String(30), default="open", index=True)
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    contract = relationship("TPRAContract", back_populates="obligations")

    __table_args__ = (
        Index("ix_tpra_obligation_contract", "contract_id", "status"),
    )


class TPRAApproval(Base):
    """Append-only accountable go/no-go decision on the residual risk (stage 08)."""
    __tablename__ = "grc_tpra_approvals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=False, index=True)
    # approve | approve_with_conditions | defer | reject
    decision = Column(String(40), nullable=False)
    conditions = Column(JSON, default=list)
    recommendation = Column(String(40), nullable=True)   # advisory engine recommendation
    rationale = Column(Text, nullable=True)
    approver_id = Column(Integer, nullable=True)
    residual_rating = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_approval_assessment", "assessment_id"),
    )


class TPRAMonitoringSignal(Base):
    """A continuous-monitoring signal that can trigger a reassessment."""
    __tablename__ = "grc_tpra_monitoring_signals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    # security_rating | breach | adverse_media | financial | sla | cert_expiry
    signal_type = Column(String(40), nullable=False, index=True)
    severity = Column(String(20), default="medium")
    source = Column(String(120), nullable=True)
    title = Column(String(255), nullable=True)
    detail = Column(Text, nullable=True)
    occurred_at = Column(DateTime, default=datetime.utcnow)
    triggered_reassessment = Column(Boolean, default=False)
    # Loose link to the reassessment assessment this signal spawned, if any.
    triggered_assessment_id = Column(Integer, nullable=True)
    acknowledged = Column(Boolean, default=False)
    acknowledged_by = Column(Integer, nullable=True)      # who cleared the signal
    acknowledged_at = Column(DateTime, nullable=True)     # when it was cleared
    row_version = Column(Integer, default=1)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_signal_vendor", "vendor_id", "signal_type"),
        Index("ix_tpra_signal_severity", "tenant_id", "severity"),
    )


class TPRAAuditLog(Base):
    """Append-only audit of every create/edit/delete/transition/gate decision."""
    __tablename__ = "grc_tpra_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=True, index=True)
    assessment_id = Column(Integer, nullable=True, index=True)
    entity = Column(String(60), nullable=False)        # e.g. "finding", "stage", "approval"
    entity_id = Column(Integer, nullable=True)
    action = Column(String(40), nullable=False)        # create | update | delete | restore | transition | gate
    actor_id = Column(Integer, nullable=True)
    from_value = Column(Text, nullable=True)
    to_value = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    extra = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    __table_args__ = (
        Index("ix_tpra_audit_entity", "tenant_id", "entity", "entity_id"),
        Index("ix_tpra_audit_vendor", "vendor_id", "created_at"),
    )


class TPRATieringConfig(Base):
    """Configurable weights/thresholds for the inherent-risk tiering engine.
    One active row per tenant (key='default'); the engine reads it instead of
    using magic numbers."""
    __tablename__ = "grc_tpra_tiering_config"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    config_key = Column(String(60), default="default", index=True)
    # {data_sensitivity, business_criticality, system_access, regulatory_scope, fourth_party}
    weights = Column(JSON, default=dict)
    # {critical: float, high: float, medium: float}  score cut-offs (descending)
    thresholds = Column(JSON, default=dict)
    # {critical: days, high: days, medium: days, low: days}
    cadence_days = Column(JSON, default=dict)
    is_active = Column(Boolean, default=True)
    row_version = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_tiering_config_tenant", "tenant_id", "config_key"),
    )


class TPRARiskDomain(Base):
    """Seeded reference set of the ten risk domains (per tenant for editability)."""
    __tablename__ = "grc_risk_domains"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    domain_key = Column(String(40), nullable=False, index=True)
    label = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_domain_tenant", "tenant_id", "domain_key"),
        UniqueConstraint("tenant_id", "domain_key", name="uq_tpra_domain_tenant_key"),
    )


class TPRARiskSnapshot(Base):
    """Time-series of inherent/residual risk at portfolio and per-vendor scope.

    Written whenever an assessment is scored/re-scored, when a finding closes, and
    by a daily scheduled job — so the dashboard trend is REAL history (not a
    generated curve) and a vendor profile can show its own residual trajectory.
    Append-only; never updated or deleted in normal operation.
    """
    __tablename__ = "grc_tpra_risk_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # scope: 'portfolio' (vendor_id NULL) | 'vendor'
    scope = Column(String(20), nullable=False, default="vendor", index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=True, index=True)
    assessment_id = Column(Integer, nullable=True)  # loose ref: which assessment drove it
    inherent_score = Column(Float, nullable=True)
    residual_score = Column(Float, nullable=True)
    rating_grade = Column(String(2), nullable=True)        # A–F
    residual_rating = Column(String(20), nullable=True)    # critical|high|medium|low
    open_findings = Column(Integer, default=0)
    critical_findings = Column(Integer, default=0)
    vendor_count = Column(Integer, nullable=True)          # portfolio scope only
    domain_scores = Column(JSON, default=dict)             # vendor scope only
    # score | finding_close | schedule | seed
    source = Column(String(20), default="score", index=True)
    captured_at = Column(DateTime, default=datetime.utcnow, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_snapshot_scope_time", "tenant_id", "scope", "captured_at"),
        Index("ix_tpra_snapshot_vendor_time", "vendor_id", "captured_at"),
    )


class TPRAEvidenceLink(Base):
    """Attaches a central `grc_evidence` record to the TPRA lifecycle — at the
    assessment level (the Questionnaire & Evidence stage "evidence pack") and/or
    a specific finding (or a per-question response). Reuses the platform Evidence
    model so uploaded/linked vendor evidence also shows in the central evidence
    library. Supports both upload (new Evidence) and linkage (existing Evidence).
    Soft-deletable; never hard-deleted in normal operation.
    """
    __tablename__ = "grc_tpra_evidence_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=True, index=True)
    finding_id = Column(Integer, ForeignKey("grc_tpra_findings.id"), nullable=True, index=True)
    response_id = Column(Integer, nullable=True, index=True)   # optional: per-question response
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    note = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_evlink_assessment", "assessment_id"),
        Index("ix_tpra_evlink_finding", "finding_id"),
    )
