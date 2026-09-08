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
from contextlib import contextmanager
from typing import Dict, Iterator, Optional

from fastapi import HTTPException, Request, status
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

logger = logging.getLogger(__name__)

# Postgres advisory-lock class for tenant schema init (ASCII 'GRCS').
# Paired with hashtext(slug) so concurrent uvicorn workers serialize
# create_all / column ensures per tenant DB and avoid pg_type races.
_SCHEMA_INIT_LOCK_CLASS = 0x47524353


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


def _exception_chain(exc: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        yield cur
        seen.add(id(cur))
        nxt = getattr(cur, "orig", None)
        if nxt is None:
            nxt = cur.__cause__ or cur.__context__
        cur = nxt if isinstance(nxt, BaseException) else None


def is_schema_already_exists_error(exc: BaseException) -> bool:
    """True for concurrent DDL races: duplicate table / type / column / relation.

    Postgres SERIAL/CREATE TABLE registers a composite type named like the
    table; two workers racing create_all hit UniqueViolation on
    ``pg_type_typname_nsp_index``. DuplicateColumn races hit ALTER TABLE ADD.
    """
    for err in _exception_chain(exc):
        pgcode = getattr(err, "pgcode", None)
        # 42P07 duplicate_table, 42701 duplicate_column, 42710 duplicate_object,
        # 23505 unique_violation (pg_type name collision during CREATE TABLE)
        if pgcode in ("42P07", "42701", "42710", "23505"):
            return True
        msg = str(err).lower()
        if (
            "already exists" in msg
            or "duplicate column" in msg
            or "duplicate key value violates unique constraint" in msg
            or "pg_type_typname_nsp_index" in msg
        ):
            return True
    return False


def _drop_orphan_relation_type(engine: Engine, table_name: str) -> bool:
    """Drop a leftover composite type when the matching table is missing.

    Aborted concurrent CREATE TABLE can leave ``pg_type.typname = table`` with
    no relation; subsequent create_all then fails on UniqueViolation.
    """
    if engine.dialect.name != "postgresql":
        return False
    # Only allow safe identifier characters from our own metadata names.
    if not re.match(r"^[a-z_][a-z0-9_]*$", table_name):
        return False
    try:
        with engine.begin() as conn:
            has_table = conn.execute(
                text(
                    "SELECT EXISTS ("
                    "  SELECT 1 FROM pg_class c"
                    "  JOIN pg_namespace n ON n.oid = c.relnamespace"
                    "  WHERE n.nspname = 'public' AND c.relname = :n"
                    "    AND c.relkind IN ('r', 'p')"
                    ")"
                ),
                {"n": table_name},
            ).scalar()
            if has_table:
                return False
            has_type = conn.execute(
                text(
                    "SELECT EXISTS ("
                    "  SELECT 1 FROM pg_type t"
                    "  JOIN pg_namespace n ON n.oid = t.typnamespace"
                    "  WHERE n.nspname = 'public' AND t.typname = :n AND t.typtype = 'c'"
                    ")"
                ),
                {"n": table_name},
            ).scalar()
            if not has_type:
                return False
            conn.execute(text(f'DROP TYPE IF EXISTS "{table_name}" CASCADE'))
        logger.warning(
            "Dropped orphan PG composite type %s (table missing) on %s",
            table_name,
            getattr(engine.url, "database", "?"),
        )
        return True
    except Exception:
        logger.debug(
            "orphan type cleanup failed for %s on %s",
            table_name,
            getattr(engine.url, "database", "?"),
            exc_info=True,
        )
        return False


def safe_metadata_create_all(engine: Engine, *, slug: str, attempts: int = 3) -> None:
    """Race-tolerant ``Base.metadata.create_all`` for multi-worker startup.

    Prefer calling under :func:`_tenant_schema_init_lock`. Retries after
    benign duplicate-type/table errors and cleans orphaned composite types.
    """
    from .models import Base as _Base

    last_err: Optional[BaseException] = None
    for attempt in range(1, attempts + 1):
        try:
            _Base.metadata.create_all(bind=engine, checkfirst=True)
            return
        except Exception as e:
            last_err = e
            if not is_schema_already_exists_error(e):
                raise
            logger.info(
                "create_all benign schema race for slug=%s (attempt %s/%s): %s",
                slug,
                attempt,
                attempts,
                e,
            )
            # Recover orphaned types from a prior aborted CREATE TABLE.
            try:
                from sqlalchemy import inspect as sa_inspect

                inspector = sa_inspect(engine)
                for table in _Base.metadata.sorted_tables:
                    if not inspector.has_table(table.name):
                        _drop_orphan_relation_type(engine, table.name)
            except Exception:
                logger.debug(
                    "create_all orphan-type scan failed for slug=%s", slug, exc_info=True
                )
            if attempt >= attempts:
                # Winner likely finished; treat as success so migrations/seeds continue.
                return
    if last_err is not None:
        raise last_err


def _ensure_vulnerability_host_identity(engine: Engine) -> None:
    """Additive column for tenants created before `host_identity` existed on
    grc_vulnerabilities. Holds the scanned machine's real {host_name,fqdn,ip} so
    a finding can auto-link to its asset when that asset is discovered LATER
    (affected_host stays the scanner's internal id — load-bearing elsewhere)."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    if not inspector.has_table("grc_vulnerabilities"):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE grc_vulnerabilities ADD COLUMN IF NOT EXISTS host_identity JSON"
        ))


def _ensure_asset_origin_source(engine: Engine) -> None:
    """Additive column: how an asset was BORN (easm | network_sweep | connect |
    agent | manual). last_seen_source mutates on every sync, so it cannot answer
    "where did this asset come from"; origin_source is stamped at creation and
    never updated."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    if not inspector.has_table("grc_it_assets"):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS origin_source VARCHAR(30)"
        ))


def _ensure_asset_ephi_environment(engine: Engine) -> None:
    """HIPAA ePHI flag: colleague added a non-nullable bool, but existing asset
    rows hold NULL. Backfill those to false and pin a server default so GET
    /assets cannot 500 on ResponseValidationError. Schema remains Optional."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    if not inspector.has_table("grc_it_assets"):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS ephi_environment BOOLEAN"
        ))
        conn.execute(text(
            "UPDATE grc_it_assets SET ephi_environment = false WHERE ephi_environment IS NULL"
        ))
        conn.execute(text(
            "ALTER TABLE grc_it_assets ALTER COLUMN ephi_environment SET DEFAULT false"
        ))


def _ensure_asset_dns_aliases(engine: Engine) -> None:
    """Additive column holding other DNS names that resolve to the same host, so
    the host-centric model can carry ftp/www/mail as aliases on one asset row."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import inspect as sa_inspect
    inspector = sa_inspect(engine)
    if not inspector.has_table("grc_it_assets"):
        return
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE grc_it_assets ADD COLUMN IF NOT EXISTS dns_aliases JSON"
        ))


def _ensure_statutory_audit_tables(engine: Engine) -> None:
    """Focused IF NOT EXISTS / checkfirst ensure for statutory-audit tables.

    create_all remains the primary path; this backstops races and orphaned
    types for the grc_audit_observation* family specifically.
    """
    try:
        from .models import (
            AuditObservation,
            AuditObservationActivity,
            AuditObservationControlLink,
            AuditObservationDocumentLink,
            AuditObservationEvidenceLink,
            AuditObservationIssueLink,
            AuditObservationRiskLink,
        )
    except Exception:
        logger.debug("statutory audit models unavailable for ensure", exc_info=True)
        return

    models = (
        AuditObservation,
        AuditObservationEvidenceLink,
        AuditObservationControlLink,
        AuditObservationRiskLink,
        AuditObservationIssueLink,
        AuditObservationDocumentLink,
        AuditObservationActivity,
    )
    try:
        from sqlalchemy import inspect as sa_inspect

        inspector = sa_inspect(engine)
        for model in models:
            table = model.__table__
            if inspector.has_table(table.name):
                continue
            try:
                table.create(bind=engine, checkfirst=True)
            except Exception as te:
                if is_schema_already_exists_error(te):
                    logger.debug(
                        "statutory audit table %s already exists (race)", table.name
                    )
                    continue
                if _drop_orphan_relation_type(engine, table.name):
                    try:
                        table.create(bind=engine, checkfirst=True)
                        continue
                    except Exception as te2:
                        if is_schema_already_exists_error(te2):
                            continue
                        logger.warning(
                            "statutory audit create %s failed after orphan cleanup: %s",
                            table.name,
                            te2,
                        )
                        continue
                logger.warning("statutory audit create %s failed: %s", table.name, te)
        # Additive column for tenants that got the table before `category` existed.
        if engine.dialect.name == "postgresql" and inspector.has_table(
            AuditObservation.__tablename__
        ):
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE grc_audit_observations "
                        "ADD COLUMN IF NOT EXISTS category VARCHAR(120)"
                    )
                )
    except Exception:
        logger.warning(
            "statutory audit table ensure failed on %s",
            getattr(engine.url, "database", "?"),
            exc_info=True,
        )


@contextmanager
def _tenant_schema_init_lock(engine: Engine, slug: str) -> Iterator[None]:
    """Serialize schema init across uvicorn workers via a PG session advisory lock."""
    if engine.dialect.name != "postgresql":
        yield
        return
    lock_key = f"grc:schema_init:{slug}"
    conn = engine.connect()
    try:
        conn.execute(
            text("SELECT pg_advisory_lock(:c, hashtext(:k))"),
            {"c": _SCHEMA_INIT_LOCK_CLASS, "k": lock_key},
        )
        conn.commit()
        try:
            yield
        finally:
            try:
                conn.execute(
                    text("SELECT pg_advisory_unlock(:c, hashtext(:k))"),
                    {"c": _SCHEMA_INIT_LOCK_CLASS, "k": lock_key},
                )
                conn.commit()
            except Exception:
                logger.debug("advisory unlock failed for slug=%s", slug, exc_info=True)
    finally:
        conn.close()


def _init_tenant_schema(engine: Engine, slug: str) -> None:
    """create_all + column self-heals under a per-tenant advisory lock."""
    with _tenant_schema_init_lock(engine, slug):
        try:
            safe_metadata_create_all(engine, slug=slug)
        except Exception:
            logger.exception("create_all failed for slug=%s", slug)
        try:
            _ensure_statutory_audit_tables(engine)
        except Exception:
            logger.exception("statutory audit schema ensure failed for slug=%s", slug)
        try:
            _ensure_vulnerability_host_identity(engine)
        except Exception:
            logger.exception("vulnerability host_identity ensure failed for slug=%s", slug)
        try:
            _ensure_asset_origin_source(engine)
        except Exception:
            logger.exception("asset origin_source ensure failed for slug=%s", slug)
        try:
            _ensure_asset_dns_aliases(engine)
        except Exception:
            logger.exception("asset dns_aliases ensure failed for slug=%s", slug)
        try:
            _ensure_asset_ephi_environment(engine)
        except Exception:
            logger.exception("asset ephi_environment ensure failed for slug=%s", slug)
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
            # from this file). Serialized across workers via PG advisory lock.
            _init_tenant_schema(engine, slug)
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
