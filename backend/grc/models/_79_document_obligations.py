"""What a governance document asks of each person: review it, approve it, or acknowledge it
(grc/modules/governance/doc_lifecycle.py). One row per person per request, so "who is it waiting for", "who signed" and
"who has not acknowledged" are plain queries, and each pending row has a twin in Task Management."""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class DocumentObligation(Base):
    __tablename__ = "grc_document_obligations"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    document_id = Column(Integer, ForeignKey("grc_governance_documents.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)                     # review | approval | acknowledgement
    user_id = Column(Integer, ForeignKey("grc_users.id"), nullable=False, index=True)
    assignment_id = Column(Integer, nullable=True)                # the sign-off assignment (a user, role or team) this came from
    document_version = Column(String(50), nullable=True)          # the version it was asked for
    status = Column(String(20), nullable=False, default="pending")   # pending | done | rejected | cancelled
    due_date = Column(DateTime, nullable=True)
    requested_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    requested_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    done_at = Column(DateTime, nullable=True)
    signature_id = Column(Integer, nullable=True)                 # DocumentSignature of a review / approval
    esign_id = Column(Integer, nullable=True)                     # the drawn signature kept with it, when there is one
    comment = Column(Text, nullable=True)
    critical_task_id = Column(Integer, nullable=True)             # its twin in Task Management
    reminded_at = Column(DateTime, nullable=True)
    escalation_level = Column(Integer, nullable=False, default=0)    # 0 none, 1 owner told, 2 tenant administrators told
    escalated_at = Column(DateTime, nullable=True)
    emailed_at = Column(DateTime, nullable=True)                  # when the person was emailed about it, if email is on

    __table_args__ = (
        Index("ix_doc_obligation_doc_kind", "document_id", "kind", "status"),
        Index("ix_doc_obligation_user", "user_id", "status"),
    )


class DocumentLifecycleSettings(Base):
    """Per organisation: how long approvals and acknowledgements are given and when escalation starts."""
    __tablename__ = "grc_document_lifecycle_settings"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, unique=True)
    config = Column(JSON, nullable=False, default=dict)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
