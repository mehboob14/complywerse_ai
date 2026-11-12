"""Who reviews and approves by default in a department, sub-department or unit (grc/services/approval_defaults.py, the Directory).

A row says, for the whole organisation (``department_id`` NULL) or for one unit (the unit and everything under it), who a document of
that unit is sent to when its author named nobody (``doc_review`` reviewers, ``doc_approval`` approvers, or ``doc_route`` a route of
its own), and who carries out an exception of that unit (``exc_implementer``). The nearest row up the tree applies; a LOCKED row
cannot be dropped from a document by its author, nor overridden by a unit below it. Sending a document for review COPIES the default
into the document's own sign-off (changing a default never changes a document already in review).

One row per (tenant, unit, subject). The database cannot say that for the organisation-wide row (a NULL is never equal to another),
so the service looks the row up before it writes."""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

from ._00_base import Base


class ApprovalDefault(Base):
    __tablename__ = "grc_approval_defaults"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    # None: the whole organisation; else a department at any level (it applies to the department and to everything under it)
    department_id = Column(Integer, nullable=True, index=True)
    subject = Column(String(20), nullable=False)        # doc_review | doc_approval | doc_route | exc_implementer
    people = Column(JSON, default=list)                 # [{type: user | role | team | unit_owner | parent_owner, id?}]
    route = Column(JSON, nullable=True)                 # doc_route only: the stages as routes.validate takes them
    locked = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_by = Column(Integer, ForeignKey("grc_users.id", ondelete="SET NULL"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "department_id", "subject", name="uq_approval_default_unit_subject"),
                      Index("ix_approval_default_tenant_dept", "tenant_id", "department_id"))
