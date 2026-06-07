from ._06_audit_trail import *  # noqa: F401,F403

# =============================================================================
# 5. Framework Normalization Models
# =============================================================================

class Framework(Base):
    __tablename__ = "grc_frameworks"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    short_code = Column(String(50), nullable=False, unique=True, index=True)
    regulator = Column(String(255), nullable=True)
    jurisdiction = Column(String(100), nullable=True)
    region = Column(String(100), nullable=True, default="Global")
    version = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    is_mandatory = Column(Boolean, default=False)
    enforcement_type = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True)
    is_custom = Column(Boolean, default=False)
    
    domains = relationship("FrameworkDomain", back_populates="framework", cascade="all, delete-orphan")
    compliance_programs = relationship("ComplianceProgram", back_populates="framework")


class FrameworkDomain(Base):
    __tablename__ = "grc_framework_domains"
    
    id = Column(Integer, primary_key=True, index=True)
    framework_id = Column(Integer, ForeignKey("grc_frameworks.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    framework = relationship("Framework", back_populates="domains")
    objectives = relationship("ControlObjective", back_populates="domain", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_domain_framework", "framework_id", "code"),
    )


class ControlObjective(Base):
    __tablename__ = "grc_control_objectives"
    
    id = Column(Integer, primary_key=True, index=True)
    domain_id = Column(Integer, ForeignKey("grc_framework_domains.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    domain = relationship("FrameworkDomain", back_populates="objectives")
    controls = relationship("FrameworkControl", back_populates="objective", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_objective_domain", "domain_id", "code"),
    )


class FrameworkControl(Base):
    __tablename__ = "grc_framework_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    objective_id = Column(Integer, ForeignKey("grc_control_objectives.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    control_objective = Column(Text, nullable=True)
    is_mandatory = Column(Boolean, default=True)
    risk_category = Column(String(50), default="security")
    evidence_type = Column(String(50), default="policy")
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    
    objective = relationship("ControlObjective", back_populates="controls")
    sub_controls = relationship("FrameworkSubControl", back_populates="control", cascade="all, delete-orphan")
    control_mappings = relationship("ControlMapping", back_populates="framework_control", cascade="all, delete-orphan")
    evidence_mappings = relationship("EvidenceControlMapping", back_populates="framework_control")
    curated_evidence_items = relationship("CuratedEvidenceItem", back_populates="framework_control", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_control_objective", "objective_id", "code"),
    )


class FrameworkSubControl(Base):
    __tablename__ = "grc_framework_sub_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    control_id = Column(Integer, ForeignKey("grc_framework_controls.id"), nullable=False, index=True)
    code = Column(String(50), nullable=False)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    description = Column(Text, nullable=True)
    order = Column(Integer, default=0)
    evidence_recommendations = Column(JSON, default=[])
    ai_matching_keywords = Column(JSON, default=[])
    
    control = relationship("FrameworkControl", back_populates="sub_controls")
    curated_evidence_items = relationship("CuratedEvidenceItem", back_populates="sub_control", cascade="all, delete-orphan")
    
    __table_args__ = (
        Index("ix_sub_control_control", "control_id", "code"),
    )

