"""Frozen third-party risk reports: the committee pack, the register, a vendor's file.

A report is generated once and kept as it was, so the pack a committee saw is the
pack on record however the data moves afterwards. An approved report can be shared
with an examiner through a link that needs no login; only the token's hash is
stored, the link expires, and it can be revoked. Every view through it is written
to the third-party risk audit log.
"""
from datetime import datetime

from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Integer, String

from ._00_base import Base


class TPRAReport(Base):
    __tablename__ = "grc_tpra_reports"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # committee_pack | register | vendor_file
    kind = Column(String(30), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    vendor_id = Column(Integer, nullable=True, index=True)   # vendor_file only
    period_start = Column(Date, nullable=True)
    period_end = Column(Date, nullable=True)
    content = Column(JSON, nullable=False)
    content_hash = Column(String(64), nullable=False)
    generated_by = Column(Integer, nullable=True)
    generated_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    approved_by = Column(Integer, nullable=True)
    approved_at = Column(DateTime, nullable=True)
    share_token_hash = Column(String(64), nullable=True, index=True)
    share_expires_at = Column(DateTime, nullable=True)
    share_revoked_at = Column(DateTime, nullable=True)
    shared_by = Column(Integer, nullable=True)
    deleted_at = Column(DateTime, nullable=True)
