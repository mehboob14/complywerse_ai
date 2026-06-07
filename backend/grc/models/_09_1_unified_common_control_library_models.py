from ._08_normalized_control_model import *  # noqa: F401,F403

# =============================================================================
# 6.1 Unified Common Control Library Models
# =============================================================================

class CommonControlGroup(Base):
    """Groups of related controls across frameworks for unified management"""
    __tablename__ = "grc_common_control_groups"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=True, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)
    domain = Column(String(100), nullable=True)
    keywords = Column(JSON, default=[])
    ai_summary = Column(Text, nullable=True)
    evidence_types = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    control_mappings = relationship("CommonControlGroupMapping", back_populates="group", cascade="all, delete-orphan")
    ai_evidence_recommendations = relationship("AIEvidenceRecommendation", back_populates="group", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_common_control_group_tenant_code", "tenant_id", "code"),
        Index("ix_common_control_group_category", "category"),
        Index("ix_common_control_group_domain", "domain"),
        UniqueConstraint("tenant_id", "code", name="uq_common_control_group_tenant_code"),
    )


class CommonControlGroupMapping(Base):
    """Maps normalized and framework controls to common control groups"""
    __tablename__ = "grc_common_control_group_mappings"
    
    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("grc_common_control_groups.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    mapping_confidence = Column(Float, nullable=True)
    mapping_source = Column(String(50), nullable=False, default="manual")
    created_at = Column(DateTime, default=datetime.utcnow)
    
    group = relationship("CommonControlGroup", back_populates="control_mappings")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
    
    __table_args__ = (
        Index("ix_common_group_mapping_group", "group_id"),
        Index("ix_common_group_mapping_normalized", "group_id", "normalized_control_id"),
        Index("ix_common_group_mapping_framework", "group_id", "framework_control_id"),
        Index("ix_common_group_mapping_parsed", "group_id", "parsed_control_id"),
        UniqueConstraint("group_id", "normalized_control_id", name="uq_group_normalized_control"),
        UniqueConstraint("group_id", "framework_control_id", name="uq_group_framework_control"),
        UniqueConstraint("group_id", "parsed_control_id", name="uq_group_parsed_control"),
    )


class ControlSimilarityMapping(Base):
    """Tracks similarity relationships between controls"""
    __tablename__ = "grc_control_similarity_mappings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_type = Column(String(20), nullable=False)
    source_control_id = Column(Integer, nullable=False)
    target_type = Column(String(20), nullable=False)
    target_control_id = Column(Integer, nullable=False)
    similarity_score = Column(Float, nullable=False)
    similarity_type = Column(String(50), nullable=False)
    ai_reasoning = Column(Text, nullable=True)
    verified = Column(Boolean, default=False)
    verified_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    tenant = relationship("Tenant")
    verifier = relationship("GRCUser")

    __table_args__ = (
        Index("ix_control_similarity_source", "source_type", "source_control_id"),
        Index("ix_control_similarity_target", "target_type", "target_control_id"),
        Index("ix_control_similarity_tenant", "tenant_id"),
        Index("ix_control_similarity_score", "tenant_id", "similarity_score"),
    )


class ControlComparisonRun(Base):
    """One AI-driven framework-to-framework comparison job.

    Cached per (tenant, source_framework, dest_framework). Re-clicking the
    same pair returns the existing run instantly. Mappings live in
    `ControlComparisonMapping` (one row per source→dest pair).
    """
    __tablename__ = "grc_control_comparison_runs"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    source_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    dest_framework_id = Column(Integer, ForeignKey("grc_uploaded_frameworks.id"), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="queued")  # queued | running | completed | failed
    progress_total = Column(Integer, default=0)
    progress_done = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    model_used = Column(String(100), nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_by_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    task_id = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    tenant = relationship("Tenant")
    source_framework = relationship("UploadedFramework", foreign_keys=[source_framework_id])
    dest_framework = relationship("UploadedFramework", foreign_keys=[dest_framework_id])
    created_by = relationship("GRCUser")
    mappings = relationship(
        "ControlComparisonMapping", back_populates="run", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "source_framework_id", "dest_framework_id",
            name="uq_control_comparison_pair",
        ),
        Index("ix_control_comparison_run_status", "tenant_id", "status"),
    )


class ControlComparisonMapping(Base):
    """A single AI-identified mapping from one source control to one dest control.

    Many rows per source control are typical (top-N matches). Confidence is in
    [0, 1]; rationale + evidence_recommendations come from the LLM.
    """
    __tablename__ = "grc_control_comparison_mappings"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("grc_control_comparison_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    source_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    dest_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=False, index=True)
    confidence = Column(Float, nullable=False, default=0.0)
    rationale = Column(Text, nullable=True)
    evidence_recommendations = Column(JSON, default=list)
    rank = Column(Integer, default=0)  # 0 = best match, 1 = next, ...
    created_at = Column(DateTime, default=datetime.utcnow)

    run = relationship("ControlComparisonRun", back_populates="mappings")

    __table_args__ = (
        Index("ix_compare_mapping_source", "run_id", "source_control_id"),
        Index("ix_compare_mapping_dest", "run_id", "dest_control_id"),
    )


class ControlInheritance(Base):
    """Defines inheritance relationships between controls"""
    __tablename__ = "grc_control_inheritance"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    parent_type = Column(String(20), nullable=False)
    parent_control_id = Column(Integer, nullable=False)
    child_type = Column(String(20), nullable=False)
    child_control_id = Column(Integer, nullable=False)
    inheritance_type = Column(String(50), nullable=False)
    condition_description = Column(Text, nullable=True)
    coverage_percentage = Column(Integer, default=100)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_control_inheritance_parent", "parent_type", "parent_control_id"),
        Index("ix_control_inheritance_child", "child_type", "child_control_id"),
        Index("ix_control_inheritance_tenant", "tenant_id"),
    )


class AIEvidenceRecommendation(Base):
    """AI-generated evidence recommendations for controls"""
    __tablename__ = "grc_ai_evidence_recommendations"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    group_id = Column(Integer, ForeignKey("grc_common_control_groups.id"), nullable=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    framework_control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=True, index=True)
    parsed_control_id = Column(Integer, ForeignKey("grc_parsed_framework_controls.id"), nullable=True, index=True)
    evidence_type = Column(String(100), nullable=False)
    evidence_description = Column(Text, nullable=True)
    priority = Column(String(20), nullable=False, default="medium")
    ai_confidence = Column(Float, nullable=True)
    ai_reasoning = Column(Text, nullable=True)
    sample_evidence_names = Column(JSON, default=[])
    created_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    group = relationship("CommonControlGroup", back_populates="ai_evidence_recommendations")
    normalized_control = relationship("NormalizedControl")
    framework_control = relationship("FrameworkControl")
    parsed_control = relationship("ParsedFrameworkControl")
    
    __table_args__ = (
        Index("ix_ai_evidence_rec_tenant", "tenant_id"),
        Index("ix_ai_evidence_rec_group", "group_id"),
        Index("ix_ai_evidence_rec_priority", "tenant_id", "priority"),
    )


class ControlMappingAnalysis(Base):
    """Tracks AI analysis jobs for control mapping"""
    __tablename__ = "grc_control_mapping_analysis"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    analysis_type = Column(String(50), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    frameworks_analyzed = Column(JSON, default=[])
    total_controls_analyzed = Column(Integer, default=0)
    mappings_created = Column(Integer, default=0)
    groups_created = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    
    tenant = relationship("Tenant")
    creator = relationship("GRCUser")
    
    __table_args__ = (
        Index("ix_control_mapping_analysis_tenant", "tenant_id"),
        Index("ix_control_mapping_analysis_status", "tenant_id", "status"),
    )

