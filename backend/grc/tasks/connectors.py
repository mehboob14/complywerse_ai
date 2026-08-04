"""Celery tasks for external-connector sync.

`run_connector_sync` is dispatched from the on-demand sync endpoint
(`POST /connectors/{id}/sync`) and from the beat schedule. Both paths
share the same underlying `run_inline_sync` so the runtime behaviour
is identical regardless of how the sync was triggered.

Following the `TenantTask` convention: the first positional arg is
`tenant_slug: str` and the session is injected as `db=`.
"""
from __future__ import annotations

import logging
from typing import Optional

from celery import shared_task
from sqlalchemy.orm import Session

from .base import TenantTask

logger = logging.getLogger(__name__)


@shared_task(
    base=TenantTask,
    name="connectors.run_connector_sync",
    bind=True,
)
def run_connector_sync(self, tenant_slug: str, connector_id: int, db: Optional[Session] = None) -> dict:
    """Run one connector's sync. `db` is injected by TenantTask."""
    from ..models import IntegrationConnection
    from ..modules.connectors.sync_runner import run_inline_sync

    assert db is not None  # TenantTask contract
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connector_id,
    ).first()
    if not conn:
        return {"success": False, "error": "connector_not_found"}
    return run_inline_sync(conn, db)


@shared_task(
    name="connectors.sync_all_active",
    bind=True,
)
def sync_all_active(self) -> dict:
    """Beat-scheduled fan-out — iterate every tenant slug, find every
    active non-vuln-scanner connector, and dispatch
    `run_connector_sync` per row on the connectors queue.

    Not a TenantTask itself because it operates across all tenants;
    individual dispatches are TenantTasks scoped per tenant.
    """
    from ..db import MasterSession, open_tenant_session
    from ..models import IntegrationConnection
    from ..models import Tenant as MasterTenant

    dispatched = 0
    master = MasterSession()
    try:
        tenants = master.query(MasterTenant.slug).filter(
            MasterTenant.is_active.is_(True)
        ).all()
    finally:
        master.close()

    for (slug,) in tenants:
        try:
            db = open_tenant_session(slug)
            try:
                rows = (
                    db.query(IntegrationConnection.id)
                    .filter(
                        IntegrationConnection.is_active.is_(True),
                        IntegrationConnection.category.in_([
                            "ticketing", "siem", "pentest", "collab", "transcribe",
                        ]),
                    )
                    .all()
                )
            finally:
                db.close()
            for (connector_id,) in rows:
                run_connector_sync.delay(slug, connector_id)
                dispatched += 1
        except Exception:
            logger.exception("Failed to enumerate connectors for tenant %s", slug)
    return {"dispatched": dispatched}
