"""
Connection layer for per-database-per-tenant Postgres.

- `master_engine` / `MasterSession` — the catalog DB (`grc_master`) holding the tenants registry.
- `get_tenant_engine(slug)` — lazy, cached per-slug engine for a tenant's own database.
- `get_master_db()` — FastAPI dependency yielding a master-DB session.
- `get_tenant_db(request)` — FastAPI dependency yielding a session bound to the
  tenant resolved by `TenantMiddleware` (via `request.state.tenant_slug`).

Tenant DB names follow the template in `TENANT_DB_URL_TEMPLATE` (default `grc_{slug}`).
"""

import os
import re
import logging
import threading
from typing import Dict, Optional

from fastapi import HTTPException, Request, status
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger(__name__)


def _normalize_pg_url(url: str) -> str:
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


POSTGRES_ADMIN_URL = _normalize_pg_url(
    os.environ.get("POSTGRES_ADMIN_URL", "postgresql://postgres:postgres@localhost:5432/postgres")
)
MASTER_DATABASE_URL = _normalize_pg_url(
    os.environ.get("MASTER_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/grc_master")
)
TENANT_DB_URL_TEMPLATE = _normalize_pg_url(
    os.environ.get("TENANT_DB_URL_TEMPLATE", "postgresql://postgres:postgres@localhost:5432/grc_{slug}")
)


# Slug must be safe for use as a Postgres database name (we still quote it on CREATE,
# but a strict character set is the real defence against injection).
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")


def validate_slug(slug: str) -> str:
    if not slug or not _SLUG_RE.match(slug):
        raise ValueError(
            f"Invalid tenant slug {slug!r}: must be 1-40 chars, lowercase a-z/0-9/_/-, starting alphanumeric"
        )
    return slug


def tenant_db_name(slug: str) -> str:
    """Database name for a tenant slug (e.g. 'acme' -> 'grc_acme')."""
    validate_slug(slug)
    # Pull just the database segment from the template.
    # e.g. postgresql://.../grc_{slug} -> grc_{slug} -> grc_acme
    return TENANT_DB_URL_TEMPLATE.rsplit("/", 1)[-1].format(slug=slug)


def tenant_db_url(slug: str) -> str:
    validate_slug(slug)
    return TENANT_DB_URL_TEMPLATE.format(slug=slug)


# ----- Master engine ---------------------------------------------------------

master_engine: Engine = create_engine(MASTER_DATABASE_URL, pool_pre_ping=True, future=True)
MasterSession = sessionmaker(autocommit=False, autoflush=False, bind=master_engine, future=True)


def get_master_db():
    """FastAPI dependency: yields a session bound to the master catalog DB."""
    db = MasterSession()
    try:
        yield db
    finally:
        db.close()


# ----- Per-tenant engine cache ----------------------------------------------

_tenant_engines: Dict[str, Engine] = {}
_tenant_sessions: Dict[str, sessionmaker] = {}
_tenant_cache_lock = threading.Lock()


def get_tenant_engine(slug: str) -> Engine:
    validate_slug(slug)
    if slug in _tenant_engines:
        return _tenant_engines[slug]
    with _tenant_cache_lock:
        if slug not in _tenant_engines:
            url = tenant_db_url(slug)
            # Pool sized for the CIS scan-all path. Each parallel scan
            # worker holds a tenant connection for the duration of its
            # WinRM/SSH probe (seconds, sometimes minutes per rule). With
            # the default pool (5 + 10 overflow = 15 max), a 10-worker
            # scan + concurrent UI polls (per-user-summary, auth/me,
            # workflow notifications…) exhausted the pool in seconds and
            # every request started returning 500 with
            # ``QueuePool limit reached, timed out``. The CIS handoff
            # ships ``COMPLYVERSE_SCAN_CONCURRENCY=10`` by default, so we
            # provision 20 + 20 = 40 to keep ~half the pool free for
            # request-serving even during the largest scan. Per-engine
            # is per-tenant, so multi-tenant deployments multiply this
            # by tenant count against Postgres' ``max_connections`` (100
            # by default) — bump pg's setting if you onboard >5 tenants
            # scanning concurrently.
            engine = create_engine(
                url,
                pool_pre_ping=True,
                future=True,
                pool_size=20,
                max_overflow=20,
                pool_timeout=10,       # fail-fast: 30 s timeout was hiding the real problem
                pool_recycle=3600,     # recycle every hour to avoid stale-connection edge cases
            )
            _tenant_engines[slug] = engine
            _tenant_sessions[slug] = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
            # Run any registered idempotent schema self-heals so this engine
            # is safe to use immediately. Local import avoids a circular
            # dependency at module-load time (the migrations module imports
            # from this file).
            try:
                # First, create any tables that the model registry knows
                # about but this tenant DB hasn't been populated with yet
                # (e.g. a brand-new pivot table introduced after the tenant
                # was originally provisioned). `create_all` only creates
                # missing tables — existing ones are left untouched, so
                # this is safe to call on every engine init.
                from .models import Base as _Base
                _Base.metadata.create_all(bind=engine)
            except Exception:
                logger.exception("create_all failed for slug=%s", slug)
            try:
                from .modules.compliance.schema_migrations import _ensure_for_engine
                _ensure_for_engine(engine)
            except Exception:
                # Self-heal must never break engine creation; the underlying
                # query path will surface a clear error if the column is
                # genuinely missing.
                logger.exception("schema self-heal failed for slug=%s", slug)
            try:
                from .modules.identity.schema_migrations import (
                    _ensure_for_engine as _ensure_identity_for_engine,
                )
                _ensure_identity_for_engine(engine)
            except Exception:
                logger.exception("identity schema self-heal failed for slug=%s", slug)
        return _tenant_engines[slug]


def get_tenant_session_factory(slug: str) -> sessionmaker:
    if slug not in _tenant_sessions:
        get_tenant_engine(slug)
    return _tenant_sessions[slug]


def dispose_tenant_engine(slug: str) -> None:
    with _tenant_cache_lock:
        engine = _tenant_engines.pop(slug, None)
        _tenant_sessions.pop(slug, None)
    if engine is not None:
        engine.dispose()


def open_tenant_session(slug: str) -> Session:
    """Open a Session for a tenant DB. Caller is responsible for closing it."""
    validate_slug(slug)
    db = get_tenant_session_factory(slug)()
    db.info["tenant_schema"] = slug
    db.info["tenant_slug"] = slug
    return db


def get_tenant_db(request: Request):
    """FastAPI dependency: yields a session bound to the request's tenant DB.

    Resolution order:
      1. `request.state.tenant_slug` set by TenantMiddleware (subdomain or X-Tenant-Slug).
      2. Otherwise raises 400.
    """
    slug: Optional[str] = getattr(request.state, "tenant_slug", None) if request else None
    if not slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant context required. Provide X-Tenant-Slug header or access via tenant subdomain.",
        )
    db = open_tenant_session(slug)
    try:
        from .services.ai_usage import bind_tenant
        bind_tenant(slug)  # ensure AI-usage capture can attribute this request's tenant
    except Exception:
        pass
    try:
        yield db
    finally:
        db.close()


# ----- DB provisioning helpers ----------------------------------------------

def _ensure_database(admin_url: str, db_name: str) -> bool:
    """CREATE DATABASE if it doesn't exist. Returns True if created, False if it already existed."""
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", future=True)
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :n"),
                {"n": db_name},
            ).scalar()
            if exists:
                return False
            conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            return True
    finally:
        admin_engine.dispose()


def _drop_database(admin_url: str, db_name: str) -> None:
    """Force-drop a database. Used for failed-provisioning cleanup and dev resets."""
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT", future=True)
    try:
        with admin_engine.connect() as conn:
            # Disconnect any sessions still holding the DB.
            conn.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :n AND pid <> pg_backend_pid()"
                ),
                {"n": db_name},
            )
            conn.execute(text(f'DROP DATABASE IF EXISTS "{db_name}"'))
    finally:
        admin_engine.dispose()


def ensure_master_database() -> None:
    """Make sure the master DB exists. Called at app startup."""
    master_db_name = MASTER_DATABASE_URL.rsplit("/", 1)[-1]
    created = _ensure_database(POSTGRES_ADMIN_URL, master_db_name)
    if created:
        logger.info("Master database %s created.", master_db_name)


def create_tenant_database(slug: str) -> str:
    """Create a brand-new Postgres database for a tenant. Returns the DB name."""
    db_name = tenant_db_name(slug)
    created = _ensure_database(POSTGRES_ADMIN_URL, db_name)
    if not created:
        raise RuntimeError(f"Tenant database {db_name!r} already exists")
    logger.info("Tenant database %s created for slug=%s", db_name, slug)
    return db_name


def drop_tenant_database(slug: str) -> None:
    """Drop a tenant's database. Used on rollback or admin teardown."""
    dispose_tenant_engine(slug)
    db_name = tenant_db_name(slug)
    _drop_database(POSTGRES_ADMIN_URL, db_name)
    logger.info("Tenant database %s dropped for slug=%s", db_name, slug)
