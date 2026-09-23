"""The vendor as a node in a graph: what it depends on, and what depends on it.

All of it lives in third-party risk's own tables, so no other module's table
changes shape. A fourth party is a supplier our vendor relies on (a
subprocessor), with the service it provides and the data it sees. A platform
alias folds the many spellings of one platform into one, so concentration can be
counted. A vendor link ties a vendor to something elsewhere in the platform — an
asset, a control, a business service — by that record's own id. A vendor
product is one of the vendor's products we watch for new vulnerabilities.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint

from ._00_base import Base


class TPRAFourthParty(Base):
    __tablename__ = "grc_tpra_fourth_parties"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)       # our vendor, who relies on it
    name = Column(String(255), nullable=False)
    platform = Column(String(120), nullable=False, index=True)   # the name folded through the alias map
    service = Column(Text, nullable=True)                          # what it does for our vendor
    data_shared = Column(JSON, default=list)                      # the kinds of our data it sees
    location = Column(String(120), nullable=True)
    critical = Column(Boolean, default=False)                     # our vendor cannot serve us without it
    source = Column(String(30), default="manual")                 # manual | declared | questionnaire
    also_vendor_id = Column(Integer, nullable=True)               # when it is one of our vendors too
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class TPRAPlatformAlias(Base):
    __tablename__ = "grc_tpra_platform_aliases"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    alias = Column(String(200), nullable=False)                   # as written, normalised
    platform = Column(String(120), nullable=True)                 # what it means; empty when excluded
    excluded = Column(Boolean, default=False)                     # a generic name that says nothing
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "alias", name="uq_tpra_platform_alias"),)


class TPRAVendorLink(Base):
    __tablename__ = "grc_tpra_vendor_links"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)
    target_type = Column(String(40), nullable=False)              # asset | control | business_service
    target_id = Column(Integer, nullable=False)
    relation = Column(String(60), nullable=True)                  # e.g. hosts, provides, supports
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "vendor_id", "target_type", "target_id",
                                       name="uq_tpra_vendor_link"),)


class TPRAVendorProduct(Base):
    __tablename__ = "grc_tpra_vendor_products"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    vendor_id = Column(Integer, nullable=False, index=True)
    name = Column(String(200), nullable=False)
    cpe_vendor = Column(String(120), nullable=True)               # as in cpe:2.3:a:<vendor>:<product>
    cpe_product = Column(String(120), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("tenant_id", "vendor_id", "cpe_vendor", "cpe_product",
                                       name="uq_tpra_vendor_product"),)
