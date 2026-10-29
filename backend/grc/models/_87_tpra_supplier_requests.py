"""Third-party risk: what we ask a supplier for outside a questionnaire, and messages with them
(vendor_risk/tpra/supplier_requests.py, vendor_risk/tpra/supplier_portal.py).

A request asks a supplier for a document, for a plan to fix a finding a reviewer
shared, or for information. The supplier answers in the portal; a reviewer accepts
the answer or returns it with a note. A file the supplier sends is in the evidence
library at once and becomes the supplier's paperwork (a TPRAEvidenceLink) only when
the request is accepted.

A message is about the supplier, one request, or one questionnaire (one of its
questions when question_key is set). The supplier only ever sees shared messages;
one a supplier's contact writes is always shared.
"""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class TPRASupplierRequest(Base):
    __tablename__ = "grc_tpra_supplier_requests"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    assessment_id = Column(Integer, ForeignKey("grc_vendor_assessments.id"), nullable=True, index=True)
    kind = Column(String(20), nullable=False)                # document | finding | information
    title = Column(String(255), nullable=False)
    detail = Column(Text, nullable=True)                     # what the supplier is told
    evidence_kind = Column(String(40), nullable=True)        # a document's: one of the tier policy's evidence types
    finding_id = Column(Integer, ForeignKey("grc_tpra_findings.id"), nullable=True, index=True)
    contact_id = Column(Integer, ForeignKey("grc_tpra_vendor_contacts.id"), nullable=True)   # none: any portal contact
    due_date = Column(Date, nullable=True)
    # open → submitted → accepted, or returned (open to the supplier again) → submitted …; cancelled
    status = Column(String(20), nullable=False, default="open", index=True)
    requested_by = Column(Integer, nullable=True)
    requested_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    response_text = Column(Text, nullable=True)
    plan_text = Column(Text, nullable=True)                  # a finding's: how the supplier will fix it
    target_date = Column(Date, nullable=True)                # ... and by when
    responded_at = Column(DateTime, nullable=True)
    responded_by_contact_id = Column(Integer, nullable=True)
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_note = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_tpra_supplier_requests_vendor", "vendor_id", "status"),)


class TPRASupplierRequestFile(Base):
    """A file a supplier sent for a request: in the evidence library from the start,
    the supplier's paperwork (link_id) once the request is accepted."""
    __tablename__ = "grc_tpra_supplier_request_files"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    request_id = Column(Integer, ForeignKey("grc_tpra_supplier_requests.id"), nullable=False, index=True)
    evidence_id = Column(Integer, ForeignKey("grc_evidence.id"), nullable=False)
    link_id = Column(Integer, ForeignKey("grc_tpra_evidence_links.id"), nullable=True)
    file_name = Column(String(255), nullable=False)
    file_size = Column(Integer, nullable=True)
    coverage_from = Column(Date, nullable=True)              # the period the document vouches for, as the supplier says
    coverage_to = Column(Date, nullable=True)
    contact_id = Column(Integer, nullable=True)              # who sent it
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class TPRAMessage(Base):
    __tablename__ = "grc_tpra_messages"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    subject_type = Column(String(20), nullable=False)        # vendor | request | questionnaire
    subject_id = Column(Integer, nullable=True)              # none for the supplier's own thread
    question_key = Column(String(100), nullable=True)        # a questionnaire's question
    visibility = Column(String(10), nullable=False, default="internal")     # internal | shared
    author_kind = Column(String(10), nullable=False)         # user | contact | system
    author_user_id = Column(Integer, nullable=True)
    author_contact_id = Column(Integer, nullable=True)
    body = Column(Text, nullable=False)                      # at most 8,000 characters
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)

    __table_args__ = (Index("ix_tpra_messages_thread", "vendor_id", "subject_type", "subject_id"),)
