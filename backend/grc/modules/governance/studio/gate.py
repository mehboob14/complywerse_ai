"""Which tenants have the AI Studio (``config.DOCUMENT_STUDIO_TENANTS``; ``*`` = every tenant)."""


def enabled(db) -> bool:
    from ....config import DOCUMENT_STUDIO_TENANTS
    from ....models import Tenant

    tenant = db.query(Tenant).first()
    return bool(tenant and ("*" in DOCUMENT_STUDIO_TENANTS or (tenant.slug or "").lower() in DOCUMENT_STUDIO_TENANTS))
