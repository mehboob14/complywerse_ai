"""One row per asset holding only the SBP fields Ava can't derive (stored +
reason + any overridden derived values), as a JSON blob. A dedicated table is
created by create_all automatically — NO per-tenant column ALTER — and keeps the
regulatory data cleanly separable/reversible.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, JSON, String, UniqueConstraint

from grc.models import Base


class SbpAssetInventory(Base):
    __tablename__ = "grc_sbp_asset_inventory"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(Integer, nullable=False, index=True)
    asset_id = Column(Integer, nullable=False, index=True)  # -> grc_it_assets.id
    data = Column(JSON, nullable=False, default=dict)        # {field_key: value}
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(String(255), nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "asset_id", name="uq_sbp_asset"),)
