"""A tenant's own wording for an email third-party risk sends (vendor_risk/tpra/emails.py).

Only changed emails have a row; without one the built-in wording is used, so a
reset is a delete.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class TPRAEmailTemplate(Base):
    __tablename__ = "grc_tpra_email_templates"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    key = Column(String(60), nullable=False)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    updated_by = Column(Integer, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "key", name="uq_tpra_email_template"),)
