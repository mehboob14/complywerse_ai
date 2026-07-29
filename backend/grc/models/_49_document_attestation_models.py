"""Document attestation campaigns — external acknowledge-via-link flow.

Separate from legacy AttestationCampaign / PolicyAttestation (internal users).
New tables auto-create via Base.metadata.create_all / route self-heal.
"""

from ._48_statutory_audit_models import *  # noqa: F401,F403


class DocumentAttestationCampaign(Base):
    """Attestation campaign for a published governance document."""

    __tablename__ = "grc_doc_attestation_campaigns"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    message = Column(Text, nullable=True)
    due_date = Column(DateTime, nullable=True)

    # draft | active | closed
    status = Column(String(30), nullable=False, default="active", index=True)

    # Opaque token for the public acknowledgment page
    public_token = Column(String(64), nullable=False, unique=True, index=True)

    # Email domain of the campaign creator (e.g. "layeronon.com").
    # Public acknowledgments must use an email on this domain.
    allowed_email_domain = Column(String(255), nullable=True, index=True)

    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)

    document = relationship("GovernanceDocument")
    creator = relationship("GRCUser", foreign_keys=[created_by])
    recipients = relationship(
        "DocumentAttestationRecipient",
        back_populates="campaign",
        cascade="all, delete-orphan",
    )
    acknowledgments = relationship(
        "DocumentAttestationAcknowledgment",
        back_populates="campaign",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_doc_attest_camp_tenant_doc", "tenant_id", "document_id"),
        Index("ix_doc_attest_camp_tenant_status", "tenant_id", "status"),
    )


class DocumentAttestationRecipient(Base):
    """Deprecated invitee row — kept for backward compatibility; unused by new flow."""

    __tablename__ = "grc_doc_attestation_recipients"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer, ForeignKey("grc_doc_attestation_campaigns.id"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, index=True)

    completed_at = Column(DateTime, nullable=True)
    acknowledgment_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    campaign = relationship("DocumentAttestationCampaign", back_populates="recipients")

    __table_args__ = (
        UniqueConstraint("campaign_id", "email", name="uq_doc_attest_recipient_email"),
    )


class DocumentAttestationAcknowledgment(Base):
    """External acknowledgment with digital signature."""

    __tablename__ = "grc_doc_attestation_acknowledgments"

    id = Column(Integer, primary_key=True, index=True)
    campaign_id = Column(
        Integer, ForeignKey("grc_doc_attestation_campaigns.id"), nullable=False, index=True
    )
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    designation = Column(String(255), nullable=True)

    # PNG data URL or relative path under uploads/
    signature_data = Column(Text, nullable=False)
    signature_path = Column(String(500), nullable=True)

    matched_invite = Column(Boolean, default=False)  # unused; kept for schema compat
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(500), nullable=True)
    acknowledged_at = Column(DateTime, default=datetime.utcnow)

    campaign = relationship("DocumentAttestationCampaign", back_populates="acknowledgments")

    __table_args__ = (
        UniqueConstraint("campaign_id", "email", name="uq_doc_attest_ack_email"),
    )
