"""Third-party risk: a supplier's contacts and their personal portal links
(vendor_risk/tpra/contacts.py, vendor_risk/tpra/supplier_portal.py).

A contact reaches the supplier portal through a private link sent by email. Only
the link's sha256 is kept, so a copy of the database holds no working link; each
link runs out on its own date and can be revoked. A contact is archived, never
deleted.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text

from ._00_base import Base


class TPRAVendorContact(Base):
    __tablename__ = "grc_tpra_vendor_contacts"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True, index=True)      # kept in lower case: a new link is asked for by email
    phone = Column(String(100), nullable=True)
    job_title = Column(String(255), nullable=True)
    roles = Column(JSON, nullable=True)                 # primary | security | privacy | commercial | legal | technical | billing
    is_primary = Column(Boolean, nullable=False, default=False)   # copied to the supplier's primary_contact_*
    portal_access = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    last_portal_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    archived_at = Column(DateTime, nullable=True)


class TPRAPortalToken(Base):
    """One personal link. The raw token is emailed or shown once and never stored."""
    __tablename__ = "grc_tpra_portal_tokens"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    contact_id = Column(Integer, ForeignKey("grc_tpra_vendor_contacts.id"), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)     # sha256 hex of the raw token
    purpose = Column(String(20), nullable=False)        # invite | reminder | request | questionnaire
    created_by = Column(Integer, nullable=True)         # none when the platform sent it on its own
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by = Column(Integer, nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    use_count = Column(Integer, nullable=False, default=0)
