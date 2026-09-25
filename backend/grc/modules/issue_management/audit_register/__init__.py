"""CFSB's audit issue register: their workbook, run from Auditor Portal → Issue Register."""


def enabled(db) -> bool:
    """Whether this tenant has the register (config.AUDIT_REGISTER_TENANTS)."""
    from ....config import AUDIT_REGISTER_TENANTS
    from ....models import Tenant

    tenant = db.query(Tenant).first()
    return bool(tenant and (tenant.slug or "").lower() in AUDIT_REGISTER_TENANTS)
