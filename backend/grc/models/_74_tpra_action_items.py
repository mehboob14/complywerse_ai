"""A planned action on a supplier: something to do, or have done, on a date
(vendor_risk/tpra/action_plans.py).

A to-do is done when someone says so. The others happen on their date: a
questionnaire is sent, a check-in is asked for, a reassessment is opened; what
happened, or why it could not, is kept on the row.
"""
from datetime import datetime

from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text

from ._00_base import Base


class TPRAActionItem(Base):
    __tablename__ = "grc_tpra_action_items"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)          # todo | questionnaire | checkin | reassessment
    title = Column(String(200), nullable=False)
    note = Column(Text, nullable=True)
    due_on = Column(Date, nullable=False)
    assignee_ids = Column(JSON, nullable=True)          # user ids; none means the supplier's owner
    template_id = Column(Integer, nullable=True)        # the questionnaire to send
    status = Column(String(20), nullable=False, default="scheduled")   # scheduled | done | failed | cancelled
    done_at = Column(DateTime, nullable=True)
    done_by = Column(Integer, nullable=True)            # null when the sweep did it
    result = Column(Text, nullable=True)
    result_link = Column(String(500), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (Index("ix_tpra_action_due", "tenant_id", "status", "due_on"),)
