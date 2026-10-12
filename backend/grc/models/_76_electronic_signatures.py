"""Electronic signatures: a signature drawn on screen, kept with the record it was made for and sealed
(services/esign.py). Append-only: signing again adds a row, nothing is overwritten."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, LargeBinary, String

from ._00_base import Base


class ElectronicSignature(Base):
    __tablename__ = "grc_electronic_signatures"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)

    # What it was made for: document_signoff | attestation_request | doc_attestation_ack | policy_attestation
    record_type = Column(String(40), nullable=False)
    record_id = Column(Integer, nullable=False)

    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=True, index=True)
    document_version = Column(String(50), nullable=True)
    content_sha256 = Column(String(64), nullable=False)   # fingerprint of what was signed (its text and file)

    signer_user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)  # none for an outside signer
    signer_name = Column(String(255), nullable=False)
    signer_email = Column(String(255), nullable=True)
    signer_title = Column(String(255), nullable=True)
    meaning = Column(String(500), nullable=False)         # what the signer is signing: "Approved by", the statement

    image_png = Column(LargeBinary, nullable=False)
    image_sha256 = Column(String(64), nullable=False)     # fingerprint of the drawn signature
    seal = Column(String(64), nullable=False)             # HMAC-SHA256 over everything above, keyed by the server's secret

    signed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(String(500), nullable=True)

    __table_args__ = (Index("ix_esign_record", "record_type", "record_id"),)
