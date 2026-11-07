"""Software license management — two additive, tenant-scoped tables.

  grc_license_entitlements  "what we OWN"      one row per purchased SKU line
  grc_license_assignments   "what we CONSUME"  one row per detected install (or
                                               manual seat) linked to an entitlement

Entitlements are facts of procurement (quantity, metric, cost, PO, expiry) that no
scan can see, so they are entered by hand / imported. Consumption is derived from
the installed software the credentialed scans already stored on
ITAsset.detected_software_json. The service reconciles the two live.

Both tables are brand new, so Base.metadata.create_all creates them on every
tenant DB at engine init — NO Alembic, NO per-tenant column ALTER. Importing the
router at app load registers these classes on Base.metadata (see main.py).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text,
    UniqueConstraint, text,
)

from grc.models import Base


class LicenseEntitlement(Base):
    """One purchased license line ("what we own")."""

    __tablename__ = "grc_license_entitlements"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)

    publisher = Column(String(200), nullable=False)              # e.g. "Microsoft"
    product = Column(String(300), nullable=False)                # e.g. "SQL Server 2022"
    edition = Column(String(120), nullable=True)                 # "Enterprise" / "Standard"
    # perpetual | subscription | oem | volume | saas | open_source | trial
    license_type = Column(String(40), nullable=False, default="perpetual")
    # per_device | per_user_named | per_user_concurrent | per_core | per_socket |
    # per_processor | per_cal | per_installation | usage
    license_metric = Column(String(40), nullable=False, default="per_device")
    total_quantity = Column(Integer, nullable=False, default=0)  # seats / cores / devices entitled
    unit_cost = Column(Float, nullable=True)
    currency = Column(String(8), nullable=False, default="USD")

    po_reference = Column(String(120), nullable=True)
    contract_reference = Column(String(120), nullable=True)
    reseller = Column(String(200), nullable=True)

    purchase_date = Column(DateTime, nullable=True)
    start_date = Column(DateTime, nullable=True)
    expiry_date = Column(DateTime, nullable=True)                # perpetual => NULL

    maintenance_included = Column(Boolean, nullable=False, default=False)
    maintenance_expiry = Column(DateTime, nullable=True)         # Software Assurance / support
    support_level = Column(String(80), nullable=True)
    downgrade_rights = Column(Boolean, nullable=False, default=True)

    # Volume-license key (MAK/KMS). Stored ENCRYPTED via grc.crypto (enc:v1:...);
    # never returned by the API — responses only say whether one is on file.
    product_key = Column(Text, nullable=True)
    # Join seed to consumption: the software_normaliser key(s) this entitlement
    # covers. Optional — comma-separated, trailing "*" = prefix. When blank the
    # engine matches on publisher + normalised product name instead.
    software_key = Column(String(80), nullable=True, index=True)
    catalog_product_id = Column(Integer, nullable=True, index=True)   # Phase 2: grc_license_catalog

    status = Column(String(20), nullable=False, default="active")    # active | expired | retired
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    __table_args__ = (
        Index("ix_lic_ent_tenant_pub_product", "tenant_id", "publisher", "product"),
        Index("ix_lic_ent_tenant_swkey", "tenant_id", "software_key"),
        Index("ix_lic_ent_expiry", "expiry_date"),
    )


class LicenseAssignment(Base):
    """One seat of consumption ("what we consume"), Snipe-IT style: an entitlement
    linked to an asset (and/or a named user).

    entitlement_id NULL  => an install with NO valid entitlement on record (the
    "unlicensed / unmanaged software" signal). Rows written by the reconciliation
    engine carry assignment_source='auto_match'; 'manual' / 'import' rows are never
    touched by it."""

    __tablename__ = "grc_license_assignments"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)

    # An entitlement / asset that is deleted takes its seat rows with it (DB-level
    # cascade, so the existing asset-delete code needs no change).
    entitlement_id = Column(
        Integer, ForeignKey("grc_license_entitlements.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    asset_id = Column(
        Integer, ForeignKey("grc_it_assets.id", ondelete="CASCADE"),
        nullable=True, index=True,
    )
    user_identifier = Column(String(255), nullable=True)         # named user (ITAsset.assigned_user)
    software_key = Column(String(80), nullable=True, index=True) # the detected product this covers
    detected_name = Column(String(300), nullable=True)           # snapshot of the install
    detected_version = Column(String(50), nullable=True)
    quantity_consumed = Column(Integer, nullable=False, default=1)   # cores for per-core, else 1
    assignment_source = Column(String(30), nullable=False, default="auto_match")  # auto_match | manual | import
    is_reclaim_candidate = Column(Boolean, nullable=False, default=False)
    assigned_at = Column(DateTime, default=datetime.utcnow)
    assigned_by = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("entitlement_id", "asset_id", "software_key", name="uq_license_assignment"),
        # NULL entitlement_id defeats the constraint above (NULLs are distinct), so
        # pin the unlicensed rows with a partial unique index of their own.
        Index(
            "uq_lic_asg_unlicensed", "asset_id", "software_key", unique=True,
            postgresql_where=text("entitlement_id IS NULL"),
            sqlite_where=text("entitlement_id IS NULL"),
        ),
        Index("ix_lic_asg_tenant_asset", "tenant_id", "asset_id"),
    )
