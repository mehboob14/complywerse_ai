"""Third-party risk: a supplier's paperwork (vendor_risk/tpra/paperwork.py).

A SOC report read once into fields: which report, the period it covers, the
auditor's opinion and what the auditor found, the criteria in scope, the controls
the report expects us to run (CUECs) and the subservice organisations it names.
What follows from them (too old to rely on, a bridge letter owed, the verdict) is
worked out each time the review is read; the findings it raised are kept.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class TPRASocReview(Base):
    __tablename__ = "grc_tpra_soc_reviews"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    evidence_id = Column(Integer, nullable=True)            # the report, in the evidence library
    report_kind = Column(String(10), nullable=False, default="soc2")      # soc1 | soc2 | soc3
    report_type = Column(String(10), nullable=False, default="type2")     # type1 | type2
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    issued_on = Column(Date, nullable=True)
    auditor_firm = Column(String(200), nullable=True)
    opinion = Column(String(20), nullable=False, default="unqualified")   # unqualified | qualified | adverse | disclaimer
    tsc = Column(JSON, nullable=True)                       # security, availability, processing_integrity, confidentiality, privacy
    exceptions_count = Column(Integer, nullable=False, default=0)
    exceptions_summary = Column(Text, nullable=True)
    material_findings = Column(Boolean, nullable=False, default=False)
    bridge_letter = Column(String(20), nullable=True)       # received | needed | not_needed
    bridge_letter_until = Column(Date, nullable=True)
    # The controls the report says we must run: [{id, text, owner_id, status open|in_place|not_applicable, note}]
    cuecs = Column(JSON, nullable=True)
    subservice_orgs = Column(JSON, nullable=True)           # [{name, method carve_out|inclusive, fourth_party_id}]
    reviewer_id = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    raised_finding_ids = Column(JSON, nullable=True)        # every finding this review raised, oldest first
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    archived_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_tpra_soc_review_vendor", "tenant_id", "vendor_id"),)
