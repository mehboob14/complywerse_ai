from ._14_it_asset_inventory import *  # noqa: F401,F403

# =============================================================================
# 12. Compliance Programs
# =============================================================================

class ComplianceProgram(Base):
    __tablename__ = "grc_compliance_programs"
    
    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(50), default="not_started")  # not_started, in_progress, completed
    start_date = Column(DateTime, nullable=True)
    target_date = Column(DateTime, nullable=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    
    tenant = relationship("Tenant", back_populates="compliance_programs")
    framework = relationship("Framework", back_populates="compliance_programs")
    owner = relationship("GRCUser", back_populates="owned_programs")
    assessments = relationship("GRCComplianceAssessment", back_populates="program", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_compliance_program_tenant", "tenant_id", "status"),
    )


class GRCComplianceAssessment(Base):
    __tablename__ = "grc_compliance_assessments"
    
    id = Column(Integer, primary_key=True, index=True)
    program_id = Column(Integer, ForeignKey("grc_compliance_programs.id"), nullable=False, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=True, index=True)
    status = Column(String(50), default="not_assessed")  # not_assessed, compliant, partial, non_compliant
    maturity_level = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    assessed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    assessed_at = Column(DateTime, nullable=True)
    
    program = relationship("ComplianceProgram", back_populates="assessments")
    normalized_control = relationship("NormalizedControl", back_populates="compliance_assessments")
    assessor = relationship("GRCUser", back_populates="compliance_assessments")
    
    __table_args__ = (
        Index("ix_compliance_assessment_program", "program_id", "status"),
    )

