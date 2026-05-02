"""
Per-database-per-tenant provisioning.

A tenant's lifecycle:
  1. Insert a row in the master catalog (`grc_tenants`).
  2. CREATE DATABASE grc_{slug} on the Postgres server.
  3. Run `Base.metadata.create_all` against the new database.
  4. Seed the new database with frameworks, normalized controls, and workflow defaults.
  5. Create the first user (the admin who registered the org) inside the new database.

If any step after CREATE DATABASE fails, we drop the database and remove the
master row to avoid orphaned state.
"""

import logging
from contextlib import contextmanager
from datetime import datetime
from typing import Optional

import bcrypt
from sqlalchemy import text
from sqlalchemy.orm import Session

from .db import (
    MasterSession,
    create_tenant_database,
    drop_tenant_database,
    get_tenant_engine,
    open_tenant_session,
    validate_slug,
    get_master_db,  # re-exported for legacy callers
)

logger = logging.getLogger(__name__)


@contextmanager
def tenant_session(slug: str):
    """Context manager yielding a Session bound to a tenant's DB. Commits on success, rolls back on error."""
    validate_slug(slug)
    session = open_tenant_session(slug)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _seed_tenant_database(session: Session) -> None:
    """Run the platform's standard seed scripts against a fresh tenant DB.

    Per product decision: seed frameworks (+ normalized controls) and workflow engine defaults.
    RBAC defaults and document templates are NOT auto-seeded.
    """
    # Frameworks + normalized controls.
    try:
        from .seed_frameworks import seed_frameworks, seed_uploaded_frameworks
        seed_frameworks(session)
        seed_uploaded_frameworks(session)
    except Exception:
        logger.exception("seed_frameworks failed for new tenant DB")
        raise

    # Workflow engine defaults.
    try:
        from .seed_workflow_engine_defaults import seed_workflow_engine_defaults
        seed_workflow_engine_defaults(session=session)
    except Exception:
        logger.exception("seed_workflow_engine_defaults failed for new tenant DB")
        raise


def _create_tenant_self_row(session: Session, *, tenant_id: int, name: str, slug: str,
                            subdomain: Optional[str], primary_contact_name: Optional[str],
                            primary_contact_email: Optional[str], primary_contact_phone: Optional[str],
                            legal_entity: Optional[str], industry: Optional[str],
                            company_size: Optional[str], geography: Optional[str],
                            regulatory_scope: Optional[str], settings: Optional[dict] = None) -> None:
    """Insert a `grc_tenants` row inside the tenant's own DB.

    The tenant's local copy of the row keeps existing FK relationships happy
    (every operational model has `tenant_id` -> `grc_tenants.id`) and lets
    `tenant_id` filters in router code continue to match.
    """
    from .models import Tenant

    self_row = Tenant(
        id=tenant_id,
        name=name,
        slug=slug,
        subdomain=subdomain,
        is_active=True,
        primary_contact_name=primary_contact_name,
        primary_contact_email=primary_contact_email,
        primary_contact_phone=primary_contact_phone,
        legal_entity=legal_entity,
        industry=industry,
        company_size=company_size,
        geography=geography,
        regulatory_scope=regulatory_scope,
        settings=settings or {},
    )
    session.add(self_row)
    session.flush()


def _create_tenant_admin_user(session: Session, *, username: str, email: str,
                              password_hash: str, display_name: str) -> int:
    """Create the first admin user inside the tenant's own DB. Returns user id."""
    from .models import GRCUser

    admin = GRCUser(
        username=username,
        email=email,
        password_hash=password_hash,
        display_name=display_name,
        is_active=True,
    )
    session.add(admin)
    session.flush()
    return admin.id


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def full_tenant_provisioning(
    *,
    slug: str,
    subdomain: Optional[str],
    org_name: str,
    admin_username: str,
    admin_email: str,
    admin_password_hash: str,
    admin_display_name: str,
    org_details: Optional[dict] = None,
) -> dict:
    """Provision a brand-new tenant: master row + dedicated DB + seed data + admin user.

    Returns: {tenant_id, slug, db_name, admin_user_id}
    """
    from .models import Tenant, Base

    org_details = org_details or {}
    validate_slug(slug)

    # Step 1: insert into master catalog
    master = MasterSession()
    try:
        existing = master.query(Tenant).filter(
            (Tenant.slug == slug) | (Tenant.subdomain == subdomain)
        ).first()
        if existing:
            raise ValueError(f"Tenant with slug={slug!r} or subdomain={subdomain!r} already exists")

        tenant_row = Tenant(
            name=org_name,
            slug=slug,
            subdomain=subdomain,
            is_active=True,
            settings=org_details.get("settings") or {},
            legal_entity=org_details.get("legal_entity"),
            industry=org_details.get("industry"),
            regulatory_scope=org_details.get("regulatory_scope"),
            company_size=org_details.get("company_size"),
            geography=org_details.get("geography"),
            primary_contact_name=admin_display_name,
            primary_contact_email=admin_email,
            primary_contact_phone=org_details.get("contact_phone"),
        )
        master.add(tenant_row)
        master.commit()
        master.refresh(tenant_row)
        tenant_id = tenant_row.id
    finally:
        master.close()

    # Step 2 onwards: create DB, schema, seed, admin. Roll back master row if any step fails.
    db_created = False
    try:
        db_name = create_tenant_database(slug)
        db_created = True

        tenant_engine = get_tenant_engine(slug)
        Base.metadata.create_all(bind=tenant_engine)

        with tenant_session(slug) as ts:
            _create_tenant_self_row(
                ts,
                tenant_id=tenant_id,
                name=org_name,
                slug=slug,
                subdomain=subdomain,
                primary_contact_name=admin_display_name,
                primary_contact_email=admin_email,
                primary_contact_phone=org_details.get("contact_phone"),
                legal_entity=org_details.get("legal_entity"),
                industry=org_details.get("industry"),
                company_size=org_details.get("company_size"),
                geography=org_details.get("geography"),
                regulatory_scope=org_details.get("regulatory_scope"),
            )
            admin_user_id = _create_tenant_admin_user(
                ts,
                username=admin_username,
                email=admin_email,
                password_hash=admin_password_hash,
                display_name=admin_display_name,
            )
            _seed_tenant_database(ts)

        logger.info("Tenant %s (id=%s) fully provisioned: db=%s, admin_user_id=%s",
                    slug, tenant_id, db_name, admin_user_id)

        return {
            "tenant_id": tenant_id,
            "slug": slug,
            "db_name": db_name,
            "admin_user_id": admin_user_id,
        }
    except Exception:
        logger.exception("Tenant provisioning failed for slug=%s; rolling back", slug)
        # Rollback: drop tenant DB if we got that far, then remove master row.
        if db_created:
            try:
                drop_tenant_database(slug)
            except Exception:
                logger.exception("Failed to drop tenant DB during rollback for slug=%s", slug)
        # Master session uses a stripped-down schema (only grc_tenants exists),
        # so we delete via raw SQL to bypass ORM cascade traversal of relationships
        # whose target tables don't live in the master DB.
        try:
            master = MasterSession()
            master.execute(text("DELETE FROM grc_tenants WHERE id = :id"), {"id": tenant_id})
            master.commit()
            master.close()
        except Exception:
            logger.exception("Failed to remove master row during rollback for slug=%s", slug)
        raise


def teardown_tenant(slug: str) -> None:
    """Admin teardown: drop the tenant's DB and remove its master row."""
    drop_tenant_database(slug)
    master = MasterSession()
    try:
        master.execute(text("DELETE FROM grc_tenants WHERE slug = :s"), {"s": slug})
        master.commit()
    finally:
        master.close()
