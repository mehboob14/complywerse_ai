"""
Governance Celery tasks — policy parsing and gap analysis.

These wrap the existing pure-Python body of the old threaded background
functions. The Celery task layer adds:

  * Tenant-scoped DB session (via `TenantTask`).
  * Redis lock so a second click on the same document doesn't run twice.
  * Per-tenant rate limit (caller checks before dispatch).
  * Progress reporting via `job_status.set_status` so the existing UI poll
    endpoint keeps working unchanged.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from ..job_status import set_status as _raw_set_status
from .base import TenantTask, tenant_lock, LockNotAcquired

logger = logging.getLogger(__name__)


def set_status(tenant_slug: str, namespace: str, resource_id: Any, payload: dict, **kwargs) -> None:
    """Wrapper around `job_status.set_status` that auto-stamps `updated_at`.

    Every status write needs a heartbeat timestamp so the parse-status / runs
    endpoints can detect entries left behind by crashed workers and clear
    them, instead of showing a phantom progress bar forever.
    """
    payload = {**payload, "updated_at": datetime.utcnow().isoformat()}
    _raw_set_status(tenant_slug, namespace, resource_id, payload, **kwargs)


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.governance.parse_policy_document",
    max_retries=2,
)
def parse_policy_document(self, tenant_slug: str, document_id: int, user_id: int, db: Session = None) -> dict:
    """Extract policy statements from a governance document via OpenAI.

    Idempotency: a Redis lock keyed on (tenant, document) prevents two parallel
    parses of the same doc.
    """
    logger.info("parse_policy_document START tenant=%s doc=%s task=%s", tenant_slug, document_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"policy_parse:{document_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.governance.routers.policy_parser import _parse_policy_body
            set_status(tenant_slug, "policy_parse", document_id,
                       {"status": "parsing", "message": "Worker picked up the job", "task_id": self.request.id})
            result = _parse_policy_body(db, document_id, user_id, tenant_slug)
            logger.info("parse_policy_document DONE tenant=%s doc=%s", tenant_slug, document_id)
            return result or {"status": "completed"}
    except LockNotAcquired:
        set_status(tenant_slug, "policy_parse", document_id,
                   {"status": "skipped", "message": "Another worker is already parsing this document"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("parse_policy_document failed: %s", exc)
        set_status(tenant_slug, "policy_parse", document_id,
                   {"status": "failed", "error": str(exc)[:500]})
        raise


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.governance.run_gap_analysis",
    max_retries=2,
)
def run_gap_analysis(self, tenant_slug: str, run_ids: list, document_id: int, user_id: int, db: Session = None) -> dict:
    """Run the gap-analysis algorithm against a document for one or more
    framework runs."""
    logger.info("run_gap_analysis START tenant=%s doc=%s task=%s", tenant_slug, document_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"gap_analysis:{document_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.governance.routers.gap_analysis import _gap_analysis_body
            set_status(tenant_slug, "gap_analysis", document_id,
                       {"status": "running", "message": "Worker picked up the job", "run_ids": run_ids, "task_id": self.request.id})
            result = _gap_analysis_body(db, run_ids, document_id, user_id, tenant_slug)
            logger.info("run_gap_analysis DONE tenant=%s doc=%s", tenant_slug, document_id)
            return result or {"status": "completed", "run_ids": run_ids}
    except LockNotAcquired:
        set_status(tenant_slug, "gap_analysis", document_id,
                   {"status": "skipped", "message": "Another gap analysis is already running for this document"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("run_gap_analysis failed: %s", exc)
        set_status(tenant_slug, "gap_analysis", document_id,
                   {"status": "failed", "error": str(exc)[:500], "run_ids": run_ids})
        raise


__all__ = ["parse_policy_document", "run_gap_analysis"]
