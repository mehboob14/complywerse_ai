"""Statutory Audit / Audit Observations.

Tracks regulator or external-auditor requirements and observations over time:
register → work → comply / close, with evidence and cross-module linkages.

New tables (grc_audit_observation*) are created automatically by
Base.metadata.create_all on tenant engine init — no Alembic / column-add
entries required for a brand-new table family.
"""

from ._47_asset_discovery_models import *  # noqa: F401,F403


class AuditObservation(Base):
    """One statutory-audit observation or regulatory requirement to manage."""

    __tablename__ = "grc_audit_observations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    code = Column(String(50), nullable=True, index=True)  # tenant-scoped, e.g. SAO-001
    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)

    # requirement | observation | finding | recommendation
    observation_type = Column(String(40), nullable=False, default="observation", index=True)

    # Free-text regulator / source (SBP, SAMA, external auditor firm, etc.)
    regulator_source = Column(String(120), nullable=True, index=True)
    regulation_reference = Column(String(255), nullable=True)

    # critical | high | medium | low
    priority = Column(String(20), nullable=False, default="medium", index=True)

    # open | in_progress | complied | closed | cancelled
    status = Column(String(30), nullable=False, default="open", index=True)

    # e.g. "FY2025", "Q1 2026", "Statutory Audit 2025"
    audit_period = Column(String(120), nullable=True, index=True)
    due_date = Column(DateTime, nullable=True)

    management_response = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    area_domain = Column(String(255), nullable=True)

    # Free-text grouping window (e.g. "IFPD Circular", "Inspection", "Licensing")
    category = Column(String(120), nullable=True, index=True)

    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    closed_at = Column(DateTime, nullable=True)
    closed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    # Provenance when created via AI document import
    source_document_name = Column(String(255), nullable=True)
    import_batch_id = Column(String(64), nullable=True, index=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("GRCUser", foreign_keys=[owner_id])
    creator = relationship("GRCUser", foreign_keys=[created_by])
    closer = relationship("GRCUser", foreign_keys=[closed_by])

    evidence_links = relationship(
        "AuditObservationEvidenceLink", back_populates="observation", cascade="all, delete-orphan"
    )
    control_links = relationship(
        "AuditObservationControlLink", back_populates="observation", cascade="all, delete-orphan"
    )
    risk_links = relationship(
        "AuditObservationRiskLink", back_populates="observation", cascade="all, delete-orphan"
    )
    issue_links = relationship(
        "AuditObservationIssueLink", back_populates="observation", cascade="all, delete-orphan"
    )
    document_links = relationship(
        "AuditObservationDocumentLink", back_populates="observation", cascade="all, delete-orphan"
    )
    activity = relationship(
        "AuditObservationActivity", back_populates="observation", cascade="all, delete-orphan"
    )

    __table_args__ = (
        Index("ix_audit_obs_tenant_status", "tenant_id", "status"),
        Index("ix_audit_obs_tenant_priority", "tenant_id", "priority"),
        Index("ix_audit_obs_tenant_code", "tenant_id", "code"),
        Index("ix_audit_obs_tenant_source", "tenant_id", "regulator_source"),
        Index("ix_audit_obs_tenant_category", "tenant_id", "category"),
    )


class AuditObservationEvidenceLink(Base):
    __tablename__ = "grc_audit_observation_evidence_links"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False, index=True)
    relationship_type = Column(String(30), default="proof")  # proof | remediation | investigation
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    observation = relationship("AuditObservation", back_populates="evidence_links")
    evidence = relationship("Evidence")

    __table_args__ = (
        UniqueConstraint("observation_id", "evidence_id", name="uq_audit_obs_evidence"),
    )


class AuditObservationControlLink(Base):
    __tablename__ = "grc_audit_observation_control_links"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    internal_control_id = Column(Integer, ForeignKey("grc_internal_controls.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    observation = relationship("AuditObservation", back_populates="control_links")
    control = relationship("InternalControl")

    __table_args__ = (
        UniqueConstraint("observation_id", "internal_control_id", name="uq_audit_obs_control"),
    )


class AuditObservationRiskLink(Base):
    __tablename__ = "grc_audit_observation_risk_links"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    risk_id = Column(Integer, ForeignKey("grc_risks.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    observation = relationship("AuditObservation", back_populates="risk_links")
    risk = relationship("Risk")

    __table_args__ = (
        UniqueConstraint("observation_id", "risk_id", name="uq_audit_obs_risk"),
    )


class AuditObservationIssueLink(Base):
    __tablename__ = "grc_audit_observation_issue_links"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    issue_id = Column(Integer, ForeignKey("grc_issues.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    observation = relationship("AuditObservation", back_populates="issue_links")
    issue = relationship("Issue")

    __table_args__ = (
        UniqueConstraint("observation_id", "issue_id", name="uq_audit_obs_issue"),
    )


class AuditObservationDocumentLink(Base):
    __tablename__ = "grc_audit_observation_document_links"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)

    observation = relationship("AuditObservation", back_populates="document_links")
    document = relationship("GovernanceDocument")

    __table_args__ = (
        UniqueConstraint("observation_id", "document_id", name="uq_audit_obs_document"),
    )


class AuditObservationActivity(Base):
    """Lightweight timeline: status changes, notes, link/unlink, AI import."""

    __tablename__ = "grc_audit_observation_activity"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("grc_audit_observations.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    activity_type = Column(String(40), nullable=False)  # created | status_change | note | link | unlink | update
    message = Column(Text, nullable=True)
    payload = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    observation = relationship("AuditObservation", back_populates="activity")
    user = relationship("GRCUser")

    __table_args__ = (
        Index("ix_audit_obs_activity_obs", "observation_id"),
    )
