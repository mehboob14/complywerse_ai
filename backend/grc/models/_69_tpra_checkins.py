"""A stakeholder's yearly check-in on a supplier (vendor_risk/tpra/checkins.py).

Three answers — is the owner still right, has anything changed, are the contact
details current — plus what was done about them. One row per check-in; the next
one falls due a year after the last.
"""
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, Text

from ._00_base import Base


class TPRACheckin(Base):
    __tablename__ = "grc_tpra_checkins"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    due_date = Column(Date, nullable=True)            # when it was due, for on-time reporting
    completed_by = Column(Integer, nullable=True)
    completed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    still_owner = Column(Boolean, nullable=False)
    new_owner_id = Column(Integer, nullable=True)     # set when ownership moved
    changed = Column(Boolean, nullable=False)
    change_notes = Column(Text, nullable=True)
    contact_current = Column(Boolean, nullable=False)
    contact_update = Column(JSON, nullable=True)      # the contact fields that were corrected

    __table_args__ = (Index("ix_tpra_checkins_tenant_vendor", "tenant_id", "vendor_id", "completed_at"),)
