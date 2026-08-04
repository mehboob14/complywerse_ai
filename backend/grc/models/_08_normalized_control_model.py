from ._07_framework_normalization_models import *  # noqa: F401,F403

# =============================================================================
# 6. Normalized Control Model
# =============================================================================

class NormalizationRun(Base):
    """One grouping+normalization SESSION. The product owner's full-framework run
    is the baseline; each user's custom (framework-selected) run is its own
    isolated session. Groups and normalized controls are tagged with run_id so a
    session's results can be viewed independently and never overwrite another's."""
    __tablename__ = "grc_normalization_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    label = Column(String(255), nullable=True)            # e.g. "Full baseline", "PCI+ISO run"
    scope = Column(String(20), default="full")            # full | custom
    framework_ids = Column(JSON, nullable=True)           # selected frameworks (null = all)
    status = Column(String(20), default="running")        # running | completed | failed | cancelled
    is_baseline = Column(Boolean, default=False)          # the owner's canonical full run
    created_by = Column(Integer, nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    summary = Column(JSON, nullable=True)                 # {groups, unified_controls, coverage,...}


class NormalizedControl(Base):
    __tablename__ = "grc_normalized_controls"

    id = Column(Integer, primary_key=True, index=True)
    # Session this control belongs to (NULL = legacy/pre-sessions data).
    run_id = Column(Integer, ForeignKey("grc_normalization_runs.id"), nullable=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    objective = Column(Text, nullable=True)
    control_owner = Column(String(255), nullable=True)
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    maturity_level = Column(Integer, default=0)
    # AI-normalization metadata (additive; NULL for legacy/seed/manual rows).
    # domain groups normalized controls for the per-domain Control Library view;
    # common_group_id ties each NC back to the AI domain it was derived from;
    # source distinguishes ai_normalized from seed/manual.
    domain = Column(String(255), nullable=True, index=True)
    source = Column(String(50), nullable=True)  # seed | manual | ai_normalized
    common_group_id = Column(Integer, ForeignKey("grc_common_control_groups.id"), nullable=True, index=True)
    # AI-consolidated recommended evidence (cached): the member frameworks'
    # evidence requirements merged by meaning into one normalized list, so the
    # user uploads each item once. Computed lazily on first view.
    recommended_evidence = Column(JSON, nullable=True)
    # Human-review of the AI-built unified control: pending | approved | flagged.
    # Lets an admin confirm/fix the master list toward 100% correctness.
    review_status = Column(String(20), nullable=True, default="pending", index=True)
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    control_mappings = relationship("ControlMapping", back_populates="normalized_control", cascade="all, delete-orphan")
    member_links = relationship("NormalizedControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    required_evidence = relationship("GRCRequiredEvidence", back_populates="normalized_control", cascade="all, delete-orphan")
    evidence_mappings = relationship("EvidenceControlMapping", back_populates="normalized_control")
    risk_links = relationship("RiskControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    exceptions = relationship("Exception", back_populates="normalized_control")
    document_links = relationship("DocumentControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    asset_links = relationship("AssetControlLink", back_populates="normalized_control", cascade="all, delete-orphan")
    compliance_assessments = relationship("GRCComplianceAssessment", back_populates="normalized_control")


class ControlMapping(Base):
    __tablename__ = "grc_control_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    mapping_type = Column(String(20), nullable=False, default="direct")  # direct, partial, related
    
    normalized_control = relationship("NormalizedControl", back_populates="control_mappings")
    framework_control = relationship("FrameworkControl", back_populates="control_mappings")
    
    __table_args__ = (
        Index("ix_control_mapping_composite", "normalized_control_id", "framework_control_id"),
    )


class NormalizedControlLink(Base):
    """Links a NormalizedControl to the framework/parsed controls it consolidates.

    This is the membership that makes "comply once -> comply everywhere" work:
    when evidence is attached to a NormalizedControl, it fans out to every
    control linked here (across frameworks). Purpose-built so we don't disturb
    the legacy ControlMapping (NC<->FrameworkControl only) — our members are
    usually ParsedFrameworkControls.
    """
    __tablename__ = "grc_normalized_control_links"

    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(
        Integer, ForeignKey("grc_normalized_controls.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    mapping_type = Column(String(20), default="direct")  # direct | partial | related
    created_at = Column(DateTime, default=datetime.utcnow)

    normalized_control = relationship("NormalizedControl", back_populates="member_links")
    parsed_control = relationship("ParsedFrameworkControl")
    framework_control = relationship("FrameworkControl")

    __table_args__ = (
        Index("ix_nc_link_nc", "normalized_control_id"),
        Index("ix_nc_link_parsed", "parsed_control_id"),
        Index("ix_nc_link_framework", "framework_control_id"),
    )


class GRCRequiredEvidence(Base):
    __tablename__ = "grc_required_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    evidence_type = Column(String(100), nullable=False)
    validation_criteria = Column(Text, nullable=True)
    
    normalized_control = relationship("NormalizedControl", back_populates="required_evidence")

