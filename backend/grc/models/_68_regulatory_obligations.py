"""Obligations: what a regulatory circular requires, one clause at a time.

Each row is one requirement the circular places on the organisation, with the
reference and the exact words it rests on (checked against the circular's own
text), what kind of obligation it is, who it applies to and by when. The
organisation's compliance with it is tracked here too, so every circular adds
to one register of regulatory obligations.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class RegulatoryObligation(Base):
    __tablename__ = "grc_regulatory_obligations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    position = Column(Integer, nullable=True)            # where it sits in the circular, for document order
    ref = Column(String(120), nullable=True)            # section / paragraph, e.g. "Para 4.2(b)"
    quote = Column(Text, nullable=True)                  # the circular's own words
    summary = Column(Text, nullable=False)               # the requirement in plain language
    # requirement | prohibition | reporting | deadline | governance | disclosure | record_keeping
    obligation_type = Column(String(30), default="requirement", nullable=False)
    applies_to = Column(JSON, default=list)              # e.g. ["banks", "DFIs"]
    deadline = Column(Date, nullable=True)
    deadline_text = Column(String(255), nullable=True)
    priority = Column(String(20), default="medium")
    verified = Column(Boolean, default=False)            # the quote was found in the circular
    match_score = Column(Float, nullable=True)
    # not_assessed | compliant | partially_compliant | non_compliant | not_applicable
    compliance_status = Column(String(30), default="not_assessed", nullable=False, index=True)
    owner_id = Column(Integer, ForeignKey("grc_users.id"), nullable=True, index=True)
    owner_ids = Column(JSON, nullable=True)               # everyone who owns it; owner_id is the first
    department = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    source = Column(String(10), default="ai")            # ai | manual
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class RegulatoryLink(Base):
    """An obligation tied to a record elsewhere on the platform: a control that
    meets it, a risk it raises, a document it changes... Proposed by the platform
    (source ai or match), decided by a person, or added by one."""

    __tablename__ = "grc_regulatory_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    regulatory_change_id = Column(Integer, ForeignKey("grc_regulatory_changes.id"), nullable=False, index=True)
    obligation_id = Column(Integer, ForeignKey("grc_regulatory_obligations.id"), nullable=True, index=True)
    target_type = Column(String(30), nullable=False)      # control | internal_control | ... (regulatory_links.TARGETS)
    target_id = Column(Integer, nullable=False)
    target_ref = Column(String(120), nullable=True)       # the record's own code, e.g. an SCF id
    target_label = Column(String(500), nullable=True)
    rationale = Column(Text, nullable=True)
    score = Column(Float, nullable=True)
    status = Column(String(12), default="proposed", nullable=False)   # proposed | confirmed | rejected
    source = Column(String(10), default="manual", nullable=False)     # ai | match | manual
    decided_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("obligation_id", "target_type", "target_id", name="uq_regulatory_link"),
        Index("ix_regulatory_link_target", "tenant_id", "target_type", "target_id"),
    )
