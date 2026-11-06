"""A change to a governance document (its text or file, or one of its statements) made by someone who is neither its owner nor its
author: it waits for them to accept or reject it (grc/modules/governance/proposals.py, DECISIONS D35). Nothing in the document or
its statements changes before that; accepted, it is applied as the next version, credited to whoever proposed it."""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class DocumentChangeProposal(Base):
    __tablename__ = "grc_document_change_proposals"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False, default="document")      # document | statement
    # edit | studio | file | version | restore | take_back | gap_fix | gap_undo | write_back
    # | statement_add | statement_edit | statement_delete | statement_rollback
    source = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, default="pending")     # pending | accepted | rejected | withdrawn
    proposed_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    proposed_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    message = Column(Text, nullable=True)                              # why: the proposer's (a gap fix's comes from its finding)
    change_type = Column(String(10), nullable=True)                    # major | minor as the proposer chose it (None: decided when applied)
    base_version_id = Column(Integer, nullable=True)                   # the version it was made on
    base_number = Column(String(50), nullable=True)
    base_hash = Column(String(64), nullable=True)                      # the document (or the statement) then: stale when it no longer matches
    statement_id = Column(Integer, ForeignKey("grc_policy_statements.id"), nullable=True)
    finding_id = Column(Integer, nullable=True)                        # a gap fix or its undo: the gap analysis finding
    studio_session_id = Column(Integer, nullable=True)                 # an AI Studio save: the draft it came from
    proposed_content = Column(Text, nullable=True)                     # the text the document would have
    proposed_file_path = Column(String(500), nullable=True)            # ... or its new file, kept beside the library's files
    proposed_file_name = Column(String(255), nullable=True)
    proposed_file_type = Column(String(50), nullable=True)
    proposed_file_size = Column(Integer, nullable=True)
    payload = Column(JSON, nullable=True)                              # what its writer needs to apply it; a statement's fields before/after
    change_set = Column(JSON, nullable=True)                           # who made what, as it was proposed (change_chain.build_change_set)
    hold_id = Column(Integer, nullable=True)                           # the route hold it holds while the document is in review
    decided_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    decided_at = Column(DateTime, nullable=True)
    decision_note = Column(Text, nullable=True)
    applied_version_id = Column(Integer, nullable=True)                # the version it became

    __table_args__ = (Index("ix_doc_change_proposal_doc", "document_id", "status"),)
