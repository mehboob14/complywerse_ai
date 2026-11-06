"""Files in public code naming our own domains (vendor_risk/tpra/leaks.py), and
suppliers' logos from their own websites (vendor_risk/tpra/logos.py)."""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint

from ._00_base import Base


class TPRAOwnLeak(Base):
    """A public file that names one of our own domains beside a credential word.
    Linked, never copied: the file may hold the secret itself."""
    __tablename__ = "grc_tpra_own_leaks"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    domain = Column(String(253), nullable=False)
    repository = Column(String(255), nullable=False)
    path = Column(String(500), nullable=False)
    url = Column(String(600), nullable=False)
    first_seen = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_seen = Column(DateTime, nullable=False, default=datetime.utcnow)
    status = Column(String(20), nullable=False, default="new")       # new | confirmed | dismissed
    note = Column(Text, nullable=True)
    decided_by = Column(Integer, nullable=True)
    decided_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "repository", "path", name="uq_tpra_own_leak"),)


class TPRAVendorLogo(Base):
    """A supplier's icon as its own website serves it, kept a month; no image
    means the site had none, tried again after a week."""
    __tablename__ = "grc_tpra_vendor_logos"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, ForeignKey("grc_vendors.id"), nullable=False, unique=True)
    image = Column(LargeBinary, nullable=True)
    content_type = Column(String(80), nullable=True)
    website = Column(String(500), nullable=True)       # fetched again when the website changes
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)
