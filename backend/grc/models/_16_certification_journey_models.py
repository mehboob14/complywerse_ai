from ._15_compliance_programs import *  # noqa: F401,F403

# =============================================================================
# 13. Certification Journey Models
# =============================================================================

class CertificationJourney(Base):
    """Tracks a tenant's certification/compliance journey for a specific framework"""
    __tablename__ = "grc_certification_journeys"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=True, index=True)
    uploaded_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=True, index=True)
    name = Column(String(255), nullable=False)
    target_date = Column(DateTime, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String(50), default="in_progress")
    current_phase = Column(Integer, default=1)
    notes = Column(Text, nullable=True)
    generated_phases = Column(JSON, nullable=True)
    phases_completion = Column(JSON, nullable=True)  # Tracks completion status of each phase: {1: true, 2: false, ...}
    stage_owners = Column(JSON, nullable=True)  # Per-stage owner assignment: {"1": {type: user|team|role, ref_id, label}, ...}

    tenant = relationship("Tenant", back_populates="certification_journeys")
    framework = relationship("Framework")
    uploaded_framework = relationship("UploadedFramework")
    control_implementations = relationship("ControlImplementation", back_populates="journey", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_cert_journey_tenant_framework", "tenant_id", "framework_id"),
        Index("ix_cert_journey_tenant_uploaded_framework", "tenant_id", "uploaded_framework_id"),
    )


class ComplianceHistory(Base):
    """Point-in-time snapshot of a certification journey's compliance posture.

    Powers the "compliance trend" chart on the framework dashboard. One row per
    (journey_id, snapshot_day) — upserted whenever progress is computed, so the
    trend builds up over time without a separate cron job. Table is created
    automatically per-tenant by the create_all self-heal on engine init."""
    __tablename__ = "grc_compliance_history"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    journey_id = Column(Integer, ForeignKey("grc_certification_journeys.id"), nullable=False, index=True)
    framework_id = Column(Integer, nullable=True, index=True)
    snapshot_day = Column(DateTime, nullable=False, index=True)  # date at 00:00 UTC
    completion_pct = Column(Float, default=0.0)
    readiness_pct = Column(Float, default=0.0)
    evidence_coverage_pct = Column(Float, default=0.0)
    total_controls = Column(Integer, default=0)
    status_counts = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("journey_id", "snapshot_day", name="uq_compliance_history_journey_day"),
        Index("ix_compliance_history_journey_day", "journey_id", "snapshot_day"),
    )


class CertificationPhase(Base):
    """Framework-specific certification phases"""
    __tablename__ = "grc_certification_phases"
    
    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    phase_number = Column(Integer, nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    key_tasks = Column(JSON, default=[])
    deliverables = Column(JSON, default=[])
    
    framework = relationship("Framework")
    
    __table_args__ = (
        UniqueConstraint("framework_id", "phase_number", name="uq_framework_phase"),
    )


class ControlImplementation(Base):
    """Tracks implementation status of each control in a certification journey"""
    __tablename__ = "grc_control_implementations"

    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey("grc_certification_journeys.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    status = Column(String(50), default="not_started")
    implementation_notes = Column(Text, nullable=True)
    implementation_date = Column(DateTime, nullable=True)
    verified_date = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    is_applicable = Column(Boolean, default=True)
    priority = Column(Integer, default=3)
    # Legacy single-assignee FK. Kept so older code paths and existing rows keep
    # working; treated as a "primary assignee" / first entry of `assigned_user_ids`.
    assigned_to_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    # Canonical multi-assignment: list of GRCUser ids.
    assigned_user_ids = Column(JSON, default=list)
    # Per-criterion met/not-met state for this control's assessment criteria
    # (the parsed spec sub-points). Keyed by criterion index: {"0": true, "1": false}.
    criteria_status = Column(JSON, default=dict)

    journey = relationship("CertificationJourney", back_populates="control_implementations")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
    verifier = relationship("GRCUser", foreign_keys=[verified_by])
    assignee = relationship("GRCUser", foreign_keys=[assigned_to_user_id])
    evidence_attachments = relationship("ImplementationEvidence", back_populates="implementation", cascade="all, delete-orphan")


class ComplianceSnapshot(Base):
    """Point-in-time compliance record for a journey (annual history).

    Captures the computed compliance state (overall %, compliant/total, and the
    per-tier + per-domain breakdown) so progress can be tracked year by year —
    NDMO requires an annual compliance assessment, so each year's result is kept
    as an immutable record.
    """
    __tablename__ = "grc_compliance_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    journey_id = Column(Integer, ForeignKey("grc_certification_journeys.id"), nullable=False, index=True)
    tenant_id = Column(Integer, nullable=True, index=True)
    year = Column(Integer, nullable=True)              # assessment year, e.g. 2026
    label = Column(String(120), nullable=True)         # e.g. "2026 Annual Assessment"
    captured_at = Column(DateTime, default=datetime.utcnow)
    captured_by = Column(Integer, nullable=True)
    overall_pct = Column(Integer, default=0)
    compliant_count = Column(Integer, default=0)
    total_count = Column(Integer, default=0)
    breakdown = Column(JSON, default=dict)             # {tiers:{P1:{...}}, domains:[...]}
    notes = Column(Text, nullable=True)


class ImplementationEvidence(Base):
    """Links evidence to control implementations with AI scoring"""
    __tablename__ = "grc_implementation_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    implementation_id = Column(Integer, ForeignKey("grc_control_implementations.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=True, index=True)
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    uploaded_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    
    ai_confidence_score = Column(Float, nullable=True)
    ai_assessment_status = Column(String(50), nullable=True)
    ai_assessment_notes = Column(Text, nullable=True)
    ai_matched_controls = Column(JSON, default=[])
    
    review_status = Column(String(50), default="pending")
    reviewed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_notes = Column(Text, nullable=True)
    
    implementation = relationship("ControlImplementation", back_populates="evidence_attachments")
    evidence = relationship("Evidence")
    uploader = relationship("GRCUser", foreign_keys=[uploaded_by])
    reviewer = relationship("GRCUser", foreign_keys=[reviewed_by])


class CuratedEvidenceItem(Base):
    """Curated, specific evidence requirements for controls"""
    __tablename__ = "grc_curated_evidence_items"
    
    id = Column(Integer, primary_key=True, index=True)
    sub_control_id = Column(Integer, ForeignKey("grc_framework_sub_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    artifact_type = Column(String(50), nullable=False)  # policy, configuration, log, screenshot, report, record, certificate
    format_guidance = Column(Text, nullable=True)
    frequency = Column(String(50), default="annual")  # one_time, monthly, quarterly, annual, as_needed
    is_required = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    sub_control = relationship("FrameworkSubControl", back_populates="curated_evidence_items")
    framework_control = relationship("FrameworkControl", back_populates="curated_evidence_items")
    
    __table_args__ = (
        Index("ix_curated_evidence_sub_control", "sub_control_id"),
        Index("ix_curated_evidence_framework_control", "framework_control_id"),
    )

