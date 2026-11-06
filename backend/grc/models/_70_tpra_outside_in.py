"""What a supplier's internet-facing estate shows from outside (vendor_risk/tpra/outside_in.py).

A scan is kept whole — the hosts it reached, what it found on each, and the
score those findings earned — so the history of a supplier's posture is on
record. A waiver sets one finding aside until a date, for a reason, and stops
counting against the score only while it is in date.
"""
from datetime import datetime

from sqlalchemy import Column, Date, DateTime, ForeignKey, Index, Integer, JSON, String, Text

from ._00_base import Base


class TPRASurfaceScan(Base):
    __tablename__ = "grc_tpra_surface_scans"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="running")   # running | done | failed
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
    requested_by = Column(Integer, nullable=True)                     # empty when the schedule ran it
    domains = Column(JSON, nullable=True)
    hosts = Column(JSON, nullable=True)                               # one summary per host reached
    findings = Column(JSON, nullable=True)                            # every finding, waived or not
    score = Column(Integer, nullable=True)                            # 0..100 with the waivers then in date
    grade = Column(String(2), nullable=True)
    categories = Column(JSON, nullable=True)                          # category -> 0..100
    technologies = Column(JSON, nullable=True)                        # what the hosts showed they run
    error = Column(Text, nullable=True)

    __table_args__ = (Index("ix_tpra_surface_scans_vendor", "tenant_id", "vendor_id", "started_at"),)


class TPRASurfaceWaiver(Base):
    __tablename__ = "grc_tpra_surface_waivers"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, index=True)
    finding_key = Column(String(200), nullable=False)                 # e.g. no_dmarc, cve:CVE-2024-1234
    host = Column(String(255), nullable=True)                         # empty: on every host
    reason = Column(Text, nullable=False)
    expires_on = Column(Date, nullable=False)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by = Column(Integer, nullable=True)

    __table_args__ = (Index("ix_tpra_surface_waivers_vendor", "tenant_id", "vendor_id", "finding_key"),)
