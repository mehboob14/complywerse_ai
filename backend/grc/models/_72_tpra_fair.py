"""A FAIR analysis of one loss scenario at one supplier (vendor_risk/tpra/fair.py).

The inputs are ranges for each factor of the FAIR taxonomy; the result is the
simulated year the inputs imply. Both are kept, with where each prefilled input
came from, so the reasoning behind a number stays with it.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text

from ._00_base import Base


class TPRAFairAnalysis(Base):
    __tablename__ = "grc_tpra_fair_analyses"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    effect = Column(String(20), nullable=False, default="confidentiality")   # confidentiality | integrity | availability
    scenario = Column(Text, nullable=True)
    asset = Column(String(255), nullable=True)            # what is at risk
    threat = Column(String(255), nullable=True)           # the threat community
    inputs = Column(JSON, nullable=False)                 # a [least, most likely, most] range per factor
    notes = Column(JSON, nullable=True)                   # where each prefilled input came from
    result = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, default="draft")   # draft | final
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    run_at = Column(DateTime, nullable=True)
    row_version = Column(Integer, nullable=False, default=1)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_tpra_fair_tenant_vendor", "tenant_id", "vendor_id"),)
