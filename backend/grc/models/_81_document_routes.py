"""A governance document's approval route (grc/modules/governance/routes.py): the stages it goes through in order, and the
changes someone asked for while it waits. A document without stages follows the default route (Review, then Approval)."""
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class DocumentRouteStage(Base):
    """One stage of a document's route. Its people are the sign-off assignments with this ``stage_position``."""
    __tablename__ = "grc_document_route_stages"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    position = Column(Integer, nullable=False)                        # 1, 2, 3... the order of the stages
    name = Column(String(120), nullable=False)
    kind = Column(String(20), nullable=False, default="review")       # review | concurrence | recommendation | approval | information
    order_mode = Column(String(10), nullable=False, default="together")   # together | in_turn
    rule = Column(String(10), nullable=False, default="all")          # all | any | at_least
    min_count = Column(Integer, nullable=True)                        # for at_least
    due_days = Column(Integer, nullable=True)                         # None: Governance > Settings for its kind
    signature = Column(Boolean, nullable=False, default=True)         # a drawn e-signature to approve
    allow_reject = Column(Boolean, nullable=False, default=False)
    allow_delegate = Column(Boolean, nullable=False, default=True)
    created_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (Index("ix_doc_route_stage_doc", "document_id", "position"),)


class DocumentRouteHold(Base):
    """Someone at a stage asked for changes: the route waits for the author to make them and resubmit. One row per request;
    the open one (no ``resolved_at``) holds the document."""
    __tablename__ = "grc_document_route_holds"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    round_at = Column(DateTime, nullable=True)                        # the review round it was asked in
    stage_position = Column(Integer, nullable=True)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=False)
    on_behalf_of = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    requested_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    comment = Column(Text, nullable=False)
    assignment_id = Column(Integer, nullable=True)                    # the participant who asked (their stage's assignment)
    content_before = Column(Text, nullable=True)                      # the text when it was asked, to size the change at resubmission
    resolved_at = Column(DateTime, nullable=True)
    resolved_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    resubmit_note = Column(Text, nullable=True)
    change = Column(String(10), nullable=True)                        # none | minor | major, at resubmission
    outcome = Column(String(20), nullable=True)                       # resumed | restarted | withdrawn

    __table_args__ = (Index("ix_doc_route_hold_doc", "document_id", "resolved_at"),)
