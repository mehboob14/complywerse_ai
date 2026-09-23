"""Outside-in monitoring: where each feed got to, what people ruled out, and scores.

A connector polls each vendor on its tier's cadence; the cursor says when it last
did. A rejection remembers an alert someone ruled out as not about the vendor,
so the same article is never raised again. An external rating is one score from
a ratings provider, kept as history so a drop can be seen.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class TPRAMonitoringCursor(Base):
    __tablename__ = "grc_tpra_monitoring_cursors"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False)
    provider = Column(String(60), nullable=False)
    last_polled_at = Column(DateTime, nullable=True)
    last_status = Column(String(20), nullable=True)        # ok | failed
    last_error = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "vendor_id", "provider", name="uq_tpra_monitoring_cursor"),
    )


class TPRASignalRejection(Base):
    __tablename__ = "grc_tpra_signal_rejections"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False)
    provider = Column(String(60), nullable=False)
    fingerprint = Column(String(64), nullable=False)        # sha256 of the article URL
    reason = Column(Text, nullable=True)
    rejected_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "vendor_id", "provider", "fingerprint", name="uq_tpra_signal_rejection"),
    )


class TPRAExternalRating(Base):
    __tablename__ = "grc_tpra_external_ratings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False)
    provider = Column(String(60), nullable=False)
    score = Column(Float, nullable=False)                  # 0..100, higher is better
    grade = Column(String(8), nullable=True)
    captured_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    external_id = Column(String(200), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ix_tpra_external_rating_vendor", "vendor_id", "provider", "captured_at"),
    )
