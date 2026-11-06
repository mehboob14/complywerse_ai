"""A module's own settings, per tenant: status levels, SLA days, extra fields.

The audit issue register proved the shape — one row per tenant, one JSON
document, defaults in code, every patched key validated (see
``modules/issue_management/audit_register/settings.py``). This generalises it by
module key so Internal Audit, Statutory Audit and the modules after them share
one table and one validator instead of a settings table each.

Status levels matter most: they were Python constants in fifteen places, so a
tenant could not add "Awaiting regulator" without a release.
"""
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String, UniqueConstraint

from ._00_base import Base


class ModuleSettings(Base):
    __tablename__ = "grc_module_settings"

    id = Column(Integer, primary_key=True, index=True)
    tenant_id = Column(Integer, ForeignKey("grc_tenants.id"), nullable=False, index=True)
    # A key from services/module_settings.MODULES — "statutory_audit", "internal_audit", …
    module_key = Column(String(60), nullable=False, index=True)
    # Only what the tenant changed; defaults are merged in on read, so a new
    # default reaches every tenant without a backfill.
    config = Column(JSON, nullable=False, default=dict)
    updated_by = Column(Integer, ForeignKey("grc_users.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", name="uq_module_settings_tenant_module"),
    )
