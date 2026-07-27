"""
Framework-upload Celery tasks: parse, enhance, generate evidence requirements.

These wrap the existing pure-Python bodies in
`grc.modules.framework_upload.routers.parser`. The Celery layer adds:

  * Per-tenant DB session via `TenantTask`.
  * Redis lock per (tenant, framework_id) so a double-click can't run twice.
  * Status mirrored to Redis (`job_status` namespace) so multi-worker setups
    have a single source of truth for parse progress.
"""

from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from ..job_status import set_status
from .base import TenantTask, tenant_lock, LockNotAcquired

logger = logging.getLogger(__name__)


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.frameworks.parse_framework",
    max_retries=2,
)
def parse_framework(self, tenant_slug: str, framework_id: int, file_path: str, file_type: str, framework_name: str, db: Session = None) -> dict:
    """Parse an uploaded framework document into controls + evidence reqs."""
    logger.info("parse_framework START tenant=%s framework=%s task=%s", tenant_slug, framework_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"framework_parse:{framework_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.framework_upload.routers.parser import _run_background_parsing_body
            set_status(tenant_slug, "framework_parse", framework_id,
                       {"status": "parsing", "message": "Worker picked up the parse", "task_id": self.request.id})
            result = _run_background_parsing_body(db, framework_id, file_path, file_type, framework_name, tenant_slug)
            return result or {"status": "completed"}
    except LockNotAcquired:
        set_status(tenant_slug, "framework_parse", framework_id,
                   {"status": "skipped", "message": "Already parsing this framework"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("parse_framework failed: %s", exc)
        set_status(tenant_slug, "framework_parse", framework_id,
                   {"status": "failed", "error": str(exc)[:500]})
        raise


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.frameworks.enhance_framework_controls",
    max_retries=2,
)
def enhance_framework_controls(self, tenant_slug: str, framework_id: int, framework_name: str, db: Session = None) -> dict:
    """AI-enhance all parsed controls in a framework with evidence requirements."""
    logger.info("enhance_framework_controls START tenant=%s framework=%s task=%s", tenant_slug, framework_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"framework_enhance:{framework_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.framework_upload.routers.parser import _enhance_controls_body
            set_status(tenant_slug, "framework_enhance", framework_id,
                       {"status": "running", "message": "Worker picked up the enhancement", "task_id": self.request.id})
            result = _enhance_controls_body(db, framework_id, framework_name)
            return result or {"status": "completed"}
    except LockNotAcquired:
        set_status(tenant_slug, "framework_enhance", framework_id,
                   {"status": "skipped", "message": "Already enhancing this framework"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("enhance_framework_controls failed: %s", exc)
        set_status(tenant_slug, "framework_enhance", framework_id,
                   {"status": "failed", "error": str(exc)[:500]})
        raise


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.frameworks.generate_evidence_requirements",
    max_retries=2,
)
def generate_evidence_requirements(self, tenant_slug: str, framework_id: int, framework_name: str, db: Session = None) -> dict:
    """Generate AI-driven evidence requirements per control in the framework."""
    logger.info("generate_evidence_requirements START tenant=%s framework=%s task=%s", tenant_slug, framework_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"framework_evidence_reqs:{framework_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.framework_upload.routers.parser import _generate_evidence_reqs_body
            set_status(tenant_slug, "framework_evidence_reqs", framework_id,
                       {"status": "running", "message": "Worker picked up evidence requirement generation", "task_id": self.request.id})
            result = _generate_evidence_reqs_body(db, framework_id, framework_name)
            return result or {"status": "completed"}
    except LockNotAcquired:
        set_status(tenant_slug, "framework_evidence_reqs", framework_id,
                   {"status": "skipped", "message": "Already generating evidence requirements for this framework"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("generate_evidence_requirements failed: %s", exc)
        set_status(tenant_slug, "framework_evidence_reqs", framework_id,
                   {"status": "failed", "error": str(exc)[:500]})
        raise


__all__ = ["parse_framework", "enhance_framework_controls", "generate_evidence_requirements"]
