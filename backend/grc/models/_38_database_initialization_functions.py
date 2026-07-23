from ._37_artifact_catalog_tenant_artifacts import *  # noqa: F401,F403

# =============================================================================
# Database Initialization Functions
# =============================================================================

def init_master_db():
    """Bootstrap the master catalog DB with the bare minimum tables.

    The catalog only needs the `grc_tenants` table — every other model lives
    inside per-tenant databases. Tables referenced by FKs from `grc_tenants`
    (e.g. through back_populates) are intentionally NOT created here.
    """
    from ..db import ensure_master_database
    ensure_master_database()
    Tenant.__table__.create(bind=engine, checkfirst=True)


def create_tenant_schema(tenant_engine):
    """Build the full GRC schema in a freshly-created tenant database."""
    Base.metadata.create_all(bind=tenant_engine)


# Backwards-compat shim: a few legacy callers still import init_grc_db.
# Now it just bootstraps the master DB; per-tenant schemas are created at
# provisioning time inside `tenant_manager.full_tenant_provisioning`.
def init_grc_db():
    init_master_db()


# `get_db` is now tenant-scoped — every request must carry tenant context
# (subdomain or X-Tenant-Slug header) so existing routers keep working unchanged.
#
# Wrapper around the underlying tenant-DB dependency that lazily heals the
# schema. `Base.metadata.create_all` (used at tenant provisioning time) creates
# missing tables but does NOT add new columns to tables that already exist, so
# tenants provisioned before a column was introduced need an explicit
# `ALTER TABLE`. The self-heal is idempotent and memoized per engine, so the
# overhead is a single set lookup after the first call.
from fastapi import HTTPException as _HTTPException, Request as _Request, status as _status


def get_db(request: _Request):
    slug = getattr(request.state, "tenant_slug", None) if request else None
    if not slug:
        raise _HTTPException(
            status_code=_status.HTTP_400_BAD_REQUEST,
            detail="Tenant context required. Provide X-Tenant-Slug header or access via tenant subdomain.",
        )
    db = open_tenant_session(slug)
    try:
        try:
            from ..modules.compliance.schema_migrations import ensure_assigned_column
            ensure_assigned_column(db)
        except Exception:
            # Self-heal failures should never block a request.
            pass
        yield db
    finally:
        db.close()
