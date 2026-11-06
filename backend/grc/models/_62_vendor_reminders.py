"""Every third-party-risk reminder the platform has sent, one row per notice.

The row is written before the notice goes out, under a unique key of what it is
about, who it is for, and which reminder period it belongs to. A sweep that runs
twice, or twice as often, therefore cannot send the same reminder twice — the
second insert fails and that notice is skipped. It is also the record of who was
told what, and when.
"""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class TPRAReminder(Base):
    __tablename__ = "grc_tpra_reminders"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # reassessment_due | questionnaire_waiting | remediation_overdue
    # | acceptance_expiring | contract_expiring
    kind = Column(String(40), nullable=False, index=True)
    subject_type = Column(String(40), nullable=False)     # vendor | questionnaire | remediation | acceptance | contract
    subject_id = Column(Integer, nullable=False)
    vendor_id = Column(Integer, nullable=True, index=True)
    recipient_id = Column(Integer, nullable=False, index=True)
    # The reminder period this notice belongs to: when the pre-due window opened,
    # or the first day of each repeat period once overdue.
    period = Column(Date, nullable=False)
    escalation = Column(Integer, default=0)                # 1 when sent to an escalation contact
    due_on = Column(Date, nullable=True)
    status = Column(String(12), default="sent")            # sent | failed
    detail = Column(Text, nullable=True)
    sent_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "kind", "subject_type", "subject_id", "recipient_id", "period",
                         name="uq_tpra_reminder_once"),
    )
