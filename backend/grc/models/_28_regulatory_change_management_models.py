from ._27_attestation_certification_management_models import *  # noqa: F401,F403

# =============================================================================
# 17. Regulatory Change Management Models
# =============================================================================

class RegulatoryChange(Base):
    """Register for tracking new regulations and regulatory changes"""
    __tablename__ = "grc_regulatory_changes"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    source = Column(String(50), nullable=False)  # OCC, Fed, EBA, PRA, SEC, FINRA, custom
    regulation_reference = Column(String(255), nullable=True)  # e.g., "12 CFR 30.5"
    
    effective_date = Column(DateTime, nullable=True)
    published_date = Column(DateTime, nullable=True)
    
    status = Column(String(50), default="identified")  # identified, under_assessment, implementation, completed, not_applicable
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    closer = relationship("GRCUser", foreign_keys=[closed_by])
    impact_assessments = relationship("RegulatoryImpactAssessment", back_populates="regulatory_change", cascade="all, delete-orphan")
    implementation_tasks = relationship("RegulatoryImplementationTask", back_populates="regulatory_change", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_regulatory_change_tenant", "tenant_id"),
        Index("ix_regulatory_change_status", "status"),
        Index("ix_regulatory_change_priority", "priority"),
        Index("ix_regulatory_change_source", "source"),
        Index("ix_regulatory_change_effective_date", "effective_date"),
    )


class RegulatoryImpactAssessment(Base):
    """Impact analysis for regulatory changes"""
    __tablename__ = "grc_regulatory_impact_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    
    assessment_type = Column(String(50), nullable=False)  # policy, control, process, technology
    impacted_item_id = Column(Integer, nullable=True)  # polymorphic - could be policy_id, control_id, etc.
    impacted_item_type = Column(String(50), nullable=True)  # policy, control, asset, process
    
    impact_level = Column(String(20), default="medium")  # high, medium, low, none
    impact_description = Column(Text, nullable=True)
    
    gap_identified = Column(Boolean, default=False)
    gap_description = Column(Text, nullable=True)
    
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assessed_at = Column(DateTime, default=datetime.utcnow)
    
    tenant = relationship("Tenant")
    regulatory_change = relationship("RegulatoryChange", back_populates="impact_assessments")
    assessor = relationship("GRCUser", foreign_keys=[assessed_by])
    implementation_tasks = relationship("RegulatoryImplementationTask", back_populates="impact_assessment")
    
    __table_args__ = (
        Index("ix_regulatory_impact_tenant", "tenant_id"),
        Index("ix_regulatory_impact_change", "regulatory_change_id"),
        Index("ix_regulatory_impact_type", "assessment_type"),
        Index("ix_regulatory_impact_level", "impact_level"),
    )


class RegulatoryImplementationTask(Base):
    """Tasks for implementing regulatory changes"""
    __tablename__ = "grc_regulatory_implementation_tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    impact_assessment_id = Column(Integer, ForeignKey("grc_regulatory_impact_assessments.id"), nullable=True, index=True)
    
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    
    task_type = Column(String(50), nullable=False)  # policy_update, control_update, process_change, training, communication
    status = Column(String(50), default="pending")  # pending, in_progress, completed, blocked
    priority = Column(String(20), default="medium")  # critical, high, medium, low
    
    assigned_to = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    
    linked_policy_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    linked_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    tenant = relationship("Tenant")
    regulatory_change = relationship("RegulatoryChange", back_populates="implementation_tasks")
    impact_assessment = relationship("RegulatoryImpactAssessment", back_populates="implementation_tasks")
    assignee = relationship("GRCUser", foreign_keys=[assigned_to])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    linked_policy = relationship("GovernanceDocument")
    linked_control = relationship("NormalizedControl")
    
    __table_args__ = (
        Index("ix_regulatory_task_tenant", "tenant_id"),
        Index("ix_regulatory_task_change", "regulatory_change_id"),
        Index("ix_regulatory_task_status", "status"),
        Index("ix_regulatory_task_due_date", "due_date"),
        Index("ix_regulatory_task_type", "task_type"),
    )

