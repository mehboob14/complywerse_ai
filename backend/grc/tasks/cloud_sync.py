"""Phase 7 — Cloud connector sync Celery tasks.

Three layers:

  * `sync_cloud_connector(tenant_slug, connector_id)` — single-connector
    run. Looks up the row, decrypts credentials, dispatches to the
    matching adapter, records counts/status on the row. Fired by the
    admin "Sync now" button and by the beat fan-out.

  * `bulk_sync_for_tenant(tenant_slug)` — every active connector in one
    tenant. Used by manual "Sync all" backfill.

  * `daily_cloud_connector_fan_out()` — beat-scheduled (every 6h per the
    roadmap). Walks every tenant + every active connector, dispatches a
    `sync_cloud_connector` task per row. Honors per-connector
    `sync_schedule_seconds` — connectors whose `last_sync_at` is fresher
    than that window are skipped.

All tasks are best-effort: a single connector's failure logs + continues;
we never poison the queue. Routed to the existing `parsing` queue until
the dedicated `sync` queue spins up.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


def _run_single_sync(db: Session, connector_id: int) -> dict:
    """Synchronous body shared by the on-demand endpoint and the Celery
    task. Returns a small summary; mutates `CloudConnector` health fields."""
    from ..models import CloudConnector
    from ..modules.integrations.cloud import get_connector_class
    from ..services.connector_credentials import decrypt_credentials

    connector = db.query(CloudConnector).filter(CloudConnector.id == connector_id).first()
    if not connector:
        return {"status": "not_found", "connector_id": connector_id}
    if not connector.is_active:
        return {"status": "skipped", "reason": "inactive", "connector_id": connector_id}

    cls = get_connector_class(connector.provider)
    if cls is None:
        return {"status": "error", "reason": "unknown_provider", "connector_id": connector_id}

    creds = decrypt_credentials(connector.encrypted_credentials_blob)
    if creds is None:
        connector.last_sync_at = datetime.utcnow()
        connector.last_sync_status = "error"
        connector.last_sync_error = "credentials_unavailable"
        try:
            db.commit()
        except Exception:
            db.rollback()
        return {"status": "error", "reason": "credentials_unavailable", "connector_id": connector_id}

    adapter = cls(connector_id=connector.id, credentials=creds)
    try:
        result = adapter.sync(db)
    except Exception as exc:
        logger.exception("Connector sync raised for connector_id=%s", connector_id)
        connector.last_sync_at = datetime.utcnow()
        connector.last_sync_status = "error"
        connector.last_sync_error = f"{exc.__class__.__name__}: {str(exc)[:300]}"
        try:
            db.commit()
        except Exception:
            db.rollback()
        return {"status": "error", "reason": "exception", "connector_id": connector_id}

    # Record outcome on the row.
    has_errors = bool(result.errors)
    connector.last_sync_at = datetime.utcnow()
    connector.last_sync_status = "error" if has_errors and (
        result.assets_new + result.vulnerabilities_new == 0
    ) else ("partial" if has_errors else "ok")
    connector.last_sync_error = "; ".join(result.errors[:5])[:500] if result.errors else None
    metrics = dict(connector.health_metrics or {})
    metrics["last_assets_new"] = result.assets_new
    metrics["last_assets_updated"] = result.assets_updated
    metrics["last_vulnerabilities_new"] = result.vulnerabilities_new
    metrics["last_vulnerabilities_updated"] = result.vulnerabilities_updated
    metrics["last_error_count"] = len(result.errors)
    metrics["last_sync_extra"] = result.extra
    connector.health_metrics = metrics
    try:
        db.commit()
    except Exception:
        db.rollback()
        return {"status": "error", "reason": "commit_failed", "connector_id": connector_id}

    return {
        "status": connector.last_sync_status,
        "connector_id": connector_id,
        "assets_new": result.assets_new,
        "assets_updated": result.assets_updated,
        "vulnerabilities_new": result.vulnerabilities_new,
        "vulnerabilities_updated": result.vulnerabilities_updated,
        "errors": result.errors[:10],
    }


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.cloud_sync.sync_cloud_connector",
    queue="parsing",
    max_retries=1,
    default_retry_delay=120,
)
def sync_cloud_connector(self, tenant_slug: str, connector_id: int, db: Session = None) -> dict:
    """One-connector run. Logs at INFO with a short summary line."""
    summary = _run_single_sync(db, connector_id)
    logger.info(
        "sync_cloud_connector tenant=%s connector=%s status=%s assets=%d/%d vulns=%d/%d errors=%d",
        tenant_slug, connector_id, summary.get("status"),
        summary.get("assets_new", 0), summary.get("assets_updated", 0),
        summary.get("vulnerabilities_new", 0), summary.get("vulnerabilities_updated", 0),
        len(summary.get("errors") or []),
    )
    return summary


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.cloud_sync.bulk_sync_for_tenant",
    queue="parsing",
    max_retries=0,
)
def bulk_sync_for_tenant(self, tenant_slug: str, force: bool = False, db: Session = None) -> dict:
    """Sync every active connector in the tenant. Used by the admin "Sync
    all" button."""
    from ..models import CloudConnector

    rows = (
        db.query(CloudConnector)
        .filter(CloudConnector.is_active.is_(True))
        .all()
    )
    dispatched = 0
    for row in rows:
        try:
            sync_cloud_connector.delay(tenant_slug=tenant_slug, connector_id=row.id)
            dispatched += 1
        except Exception:
            logger.exception("bulk_sync_for_tenant: dispatch failed for connector=%s", row.id)
    logger.info(
        "bulk_sync_for_tenant tenant=%s dispatched=%d/%d", tenant_slug, dispatched, len(rows),
    )
    return {"status": "ok", "dispatched": dispatched, "total": len(rows)}


@celery_app.task(
    bind=True,
    name="grc.tasks.cloud_sync.daily_cloud_connector_fan_out",
    queue="parsing",
    max_retries=0,
)
def daily_cloud_connector_fan_out(self) -> dict:
    """Beat-scheduled fan-out. Honors per-connector `sync_schedule_seconds` —
    fresh connectors are skipped to keep the workers free."""
    from ..db import MasterSession, get_tenant_session_factory
    from ..models import Tenant

    master = MasterSession()
    try:
        rows = master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
        slugs = [t.slug for t in rows if t.slug]
    finally:
        master.close()

    total_dispatched = 0
    for slug in slugs:
        try:
            session_factory = get_tenant_session_factory(slug)
            db = session_factory()
        except Exception:
            logger.exception("daily_cloud_connector_fan_out: tenant session failed slug=%s", slug)
            continue
        try:
            total_dispatched += _fan_out_one_tenant(db, slug)
        except Exception:
            logger.exception("daily_cloud_connector_fan_out: per-tenant fan-out failed slug=%s", slug)
        finally:
            try:
                db.close()
            except Exception:
                pass

    logger.info("daily_cloud_connector_fan_out DONE dispatched=%d", total_dispatched)
    return {"status": "ok", "dispatched": total_dispatched}


def _fan_out_one_tenant(db: Session, tenant_slug: str) -> int:
    from ..models import CloudConnector

    rows = (
        db.query(CloudConnector)
        .filter(CloudConnector.is_active.is_(True))
        .all()
    )
    now = datetime.utcnow()
    dispatched = 0
    for row in rows:
        schedule = row.sync_schedule_seconds or 6 * 60 * 60
        if row.last_sync_at and (now - row.last_sync_at) < timedelta(seconds=schedule):
            # Still inside the per-connector window — skip.
            continue
        try:
            sync_cloud_connector.delay(tenant_slug=tenant_slug, connector_id=row.id)
            dispatched += 1
        except Exception:
            logger.exception("daily fan-out dispatch failed connector=%s tenant=%s",
                             row.id, tenant_slug)
    return dispatched
