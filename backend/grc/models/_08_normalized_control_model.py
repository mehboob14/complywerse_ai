from ._07_framework_normalization_models import *  # noqa: F401,F403

# =============================================================================
# 6. Normalized Control Model
# =============================================================================

class NormalizedControl(Base):
    __tablename__ = "grc_normalized_controls"
    
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    statement = Column(Text, nullable=True)
    objective = Column(Text, nullable=True)
    control_owner = Column(String(255), nullable=True)
    implementation_guidance = Column(Text, nullable=True)
    testing_guidance = Column(Text, nullable=True)
    maturity_level = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    control_mappings = relationship("ControlMapping", back_populates="normalized_control", cascade="all, delete-orphan")
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


class GRCRequiredEvidence(Base):
    __tablename__ = "grc_required_evidence"
    
    id = Column(Integer, primary_key=True, index=True)
    normalized_control_id = Column(Integer, ForeignKey("grc_normalized_controls.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    evidence_type = Column(String(100), nullable=False)
    validation_criteria = Column(Text, nullable=True)
    
    normalized_control = relationship("NormalizedControl", back_populates="required_evidence")

