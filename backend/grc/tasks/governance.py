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
from ..services.ai_usage import usage_scope

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
            with usage_scope(
                tenant_slug=tenant_slug,
                actor_user_id=user_id,
                background_job_id=self.request.id,
                module_key="governance",
                feature_key="policy_statement_parsing",
            ):
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


# ─── In-process fallback dispatchers ─────────────────────────────────────
# When Celery is configured but no worker process is consuming, the broker
# accepts the message yet no one runs it — the job sits "queued" forever
# from the user's point of view. Mirrors what we did for ai_drafting:
# `dispatch_parse_in_thread()` runs the same `_parse_policy_body` on a
# daemon thread inside the FastAPI process so the feature works without
# any worker. The Redis status writes use the same namespace as the
# Celery path, so the existing polling endpoint is identical for both.


def dispatch_parse_in_thread(tenant_slug: str, document_id: int, user_id: int) -> str:
    """Kick off policy-statement parsing on a background thread.

    Returns a synthetic task id that the API can return to the caller so
    the response shape matches the Celery `.delay().id` path. The thread
    opens its own tenant DB session, writes progress to Redis exactly the
    same way the Celery task does, and never raises out to the caller.
    """
    import threading
    import uuid

    task_id = f"thread-{uuid.uuid4().hex[:12]}"
    t = threading.Thread(
        target=_run_parse_with_own_session,
        args=(tenant_slug, document_id, user_id, task_id),
        daemon=True,
        name=f"policy-parse-{document_id}",
    )
    t.start()
    return task_id


def _run_parse_with_own_session(
    tenant_slug: str, document_id: int, user_id: int, task_id: str,
) -> None:
    """Thread entry-point: open a tenant session, run the pure-Python body,
    record status into Redis (parsing → completed / failed). Mirrors the
    Celery task's behaviour exactly minus the broker round-trip.
    """
    from ..db import open_tenant_session
    try:
        db = open_tenant_session(tenant_slug)
    except Exception as exc:
        logger.exception("Failed to open tenant session for parse doc %s", document_id)
        set_status(tenant_slug, "policy_parse", document_id,
                   {"status": "failed", "error": f"Could not open tenant DB session: {exc}"})
        return

    try:
        with tenant_lock(tenant_slug, f"policy_parse:{document_id}", ttl_seconds=1800, owner=task_id):
            from ..modules.governance.routers.policy_parser import _parse_policy_body
            set_status(tenant_slug, "policy_parse", document_id,
                       {"status": "parsing",
                        "message": "Thread worker picked up the job",
                        "task_id": task_id})
            with usage_scope(
                tenant_slug=tenant_slug,
                actor_user_id=user_id,
                background_job_id=task_id,
                module_key="governance",
                feature_key="policy_statement_parsing",
            ):
                _parse_policy_body(db, document_id, user_id, tenant_slug)
            try:
                db.commit()
            except Exception:
                db.rollback()
                raise
            logger.info("parse_policy_document(thread) DONE tenant=%s doc=%s task=%s",
                        tenant_slug, document_id, task_id)
    except LockNotAcquired:
        set_status(tenant_slug, "policy_parse", document_id,
                   {"status": "skipped",
                    "message": "Another worker is already parsing this document"})
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("Parse-policy thread crashed: %s", exc)
        set_status(tenant_slug, "policy_parse", document_id,
                   {"status": "failed", "error": str(exc)[:500]})
    finally:
        try:
            db.close()
        except Exception:
            pass


def dispatch_parse(tenant_slug: str, document_id: int, user_id: int) -> str:
    """Fire policy-statement parsing in the background. Prefers Celery (a worker
    on the `parsing` queue picks it up); falls back to an in-process daemon
    thread when the broker is unreachable or `DISABLE_CELERY_DISPATCH=1`.

    Mirrors `dispatch_auto_map`. Safe to call right after a document is created —
    the caller MUST have committed the doc (and its file_path/content) first,
    since the job re-reads it through a separate tenant session.
    """
    import os as _os
    force_thread = _os.environ.get("DISABLE_CELERY_DISPATCH", "").strip().lower() in ("1", "true", "yes", "on")
    if not force_thread:
        try:
            return parse_policy_document.delay(tenant_slug, document_id, user_id).id
        except Exception as exc:  # noqa: BLE001
            logger.warning("parse celery dispatch failed (%s); falling back to thread", exc)
    return dispatch_parse_in_thread(tenant_slug, document_id, user_id)


def dispatch_gap_analysis_in_thread(
    tenant_slug: str, run_ids: list, document_id: int, user_id: int,
) -> str:
    """Same fallback strategy as `dispatch_parse_in_thread`, applied to the
    gap-analysis pipeline. Runs `_gap_analysis_body` on a daemon thread so
    the feature works without a Celery worker.
    """
    import threading
    import uuid

    task_id = f"thread-{uuid.uuid4().hex[:12]}"
    t = threading.Thread(
        target=_run_gap_analysis_with_own_session,
        args=(tenant_slug, run_ids, document_id, user_id, task_id),
        daemon=True,
        name=f"gap-analysis-{document_id}",
    )
    t.start()
    return task_id


def _run_gap_analysis_with_own_session(
    tenant_slug: str, run_ids: list, document_id: int, user_id: int, task_id: str,
) -> None:
    from ..db import open_tenant_session
    try:
        db = open_tenant_session(tenant_slug)
    except Exception as exc:
        logger.exception("Failed to open tenant session for gap analysis doc %s", document_id)
        set_status(tenant_slug, "gap_analysis", document_id,
                   {"status": "failed", "error": f"Could not open tenant DB session: {exc}"})
        return

    try:
        with tenant_lock(tenant_slug, f"gap_analysis:{document_id}", ttl_seconds=1800, owner=task_id):
            from ..modules.governance.routers.gap_analysis import _gap_analysis_body
            set_status(tenant_slug, "gap_analysis", document_id,
                       {"status": "running",
                        "message": "Thread worker picked up the job",
                        "run_ids": run_ids,
                        "task_id": task_id})
            with usage_scope(
                tenant_slug=tenant_slug,
                actor_user_id=user_id,
                background_job_id=task_id,
                module_key="governance",
                feature_key="gap_analysis",
            ):
                _gap_analysis_body(db, run_ids, document_id, user_id, tenant_slug)
            try:
                db.commit()
            except Exception:
                db.rollback()
                raise
            logger.info("run_gap_analysis(thread) DONE tenant=%s doc=%s task=%s",
                        tenant_slug, document_id, task_id)
    except LockNotAcquired:
        set_status(tenant_slug, "gap_analysis", document_id,
                   {"status": "skipped",
                    "message": "Another worker is already running gap analysis"})
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("Gap-analysis thread crashed: %s", exc)
        set_status(tenant_slug, "gap_analysis", document_id,
                   {"status": "failed", "error": str(exc)[:500]})
    finally:
        try:
            db.close()
        except Exception:
            pass


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
            with usage_scope(
                tenant_slug=tenant_slug,
                actor_user_id=user_id,
                background_job_id=self.request.id,
                module_key="governance",
                feature_key="gap_analysis",
            ):
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


# ─── Control recommendation (statement → controls) ───────────────────────────
# After a document is parsed, recommend & link the internal (ERM) controls and
# framework controls each statement implements. Runs as its OWN background step
# (dispatched by the parse flow once statements are committed) so parsing reports
# "completed" immediately and the recommendation populates afterwards.


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.governance.auto_map_document_controls",
    max_retries=1,
)
def auto_map_document_controls(self, tenant_slug: str, document_id: int, db: Session = None) -> dict:
    """Recommend internal (ERM) + framework controls for every statement of a
    freshly-parsed document and persist the 360° linkage. Idempotent per document
    (a Redis lock prevents overlapping runs)."""
    logger.info("auto_map_document_controls START tenant=%s doc=%s task=%s", tenant_slug, document_id, self.request.id)
    try:
        with tenant_lock(tenant_slug, f"statement_auto_map:{document_id}", ttl_seconds=1800, owner=self.request.id):
            from ..modules.governance.statement_auto_map import auto_map_document
            set_status(tenant_slug, "statement_auto_map", document_id,
                       {"status": "running", "message": "Recommending controls for statements", "task_id": self.request.id})
            with usage_scope(
                tenant_slug=tenant_slug,
                background_job_id=self.request.id,
                module_key="governance",
                feature_key="statement_auto_mapping",
            ):
                result = auto_map_document(db, document_id)
            set_status(tenant_slug, "statement_auto_map", document_id, {"status": "completed", **(result or {})})
            logger.info("auto_map_document_controls DONE tenant=%s doc=%s result=%s", tenant_slug, document_id, result)
            return result or {"status": "completed"}
    except LockNotAcquired:
        set_status(tenant_slug, "statement_auto_map", document_id,
                   {"status": "skipped", "message": "Control recommendation already running for this document"})
        return {"status": "skipped"}
    except Exception as exc:
        logger.exception("auto_map_document_controls failed: %s", exc)
        set_status(tenant_slug, "statement_auto_map", document_id, {"status": "failed", "error": str(exc)[:500]})
        raise


def _run_auto_map_with_own_session(tenant_slug: str, document_id: int, task_id: str) -> None:
    """Thread entry-point mirroring the Celery task — opens its own tenant
    session so the control recommendation runs without a worker."""
    from ..db import open_tenant_session
    try:
        db = open_tenant_session(tenant_slug)
    except Exception as exc:
        logger.exception("Failed to open tenant session for auto-map doc %s", document_id)
        set_status(tenant_slug, "statement_auto_map", document_id,
                   {"status": "failed", "error": f"Could not open tenant DB session: {exc}"})
        return
    try:
        with tenant_lock(tenant_slug, f"statement_auto_map:{document_id}", ttl_seconds=1800, owner=task_id):
            from ..modules.governance.statement_auto_map import auto_map_document
            set_status(tenant_slug, "statement_auto_map", document_id,
                       {"status": "running", "message": "Thread worker picked up the job", "task_id": task_id})
            with usage_scope(
                tenant_slug=tenant_slug,
                background_job_id=task_id,
                module_key="governance",
                feature_key="statement_auto_mapping",
            ):
                result = auto_map_document(db, document_id)
            set_status(tenant_slug, "statement_auto_map", document_id, {"status": "completed", **(result or {})})
            logger.info("auto_map(thread) DONE tenant=%s doc=%s task=%s result=%s", tenant_slug, document_id, task_id, result)
    except LockNotAcquired:
        set_status(tenant_slug, "statement_auto_map", document_id,
                   {"status": "skipped", "message": "Another worker is already recommending controls"})
    except Exception as exc:  # noqa: BLE001
        try:
            db.rollback()
        except Exception:
            pass
        logger.exception("Auto-map thread crashed: %s", exc)
        set_status(tenant_slug, "statement_auto_map", document_id, {"status": "failed", "error": str(exc)[:500]})
    finally:
        try:
            db.close()
        except Exception:
            pass


def dispatch_auto_map_in_thread(tenant_slug: str, document_id: int) -> str:
    """Run the control recommendation on a daemon thread (no worker required)."""
    import threading
    import uuid
    task_id = f"thread-{uuid.uuid4().hex[:12]}"
    t = threading.Thread(
        target=_run_auto_map_with_own_session,
        args=(tenant_slug, document_id, task_id),
        daemon=True,
        name=f"auto-map-{document_id}",
    )
    t.start()
    return task_id


def dispatch_auto_map(tenant_slug: str, document_id: int) -> str:
    """Fire the control-recommendation step in the background. Prefers Celery
    (a worker on the `parsing` queue picks it up); falls back to an in-process
    daemon thread when the broker is unreachable or dispatch is disabled.

    Safe to call from inside the parse flow — the caller must have committed the
    statements first, since the job reads them through a separate session.
    """
    import os as _os
    force_thread = _os.environ.get("DISABLE_CELERY_DISPATCH", "").strip().lower() in ("1", "true", "yes", "on")
    if not force_thread:
        try:
            return auto_map_document_controls.delay(tenant_slug, document_id).id
        except Exception as exc:  # noqa: BLE001
            logger.warning("auto-map celery dispatch failed (%s); falling back to thread", exc)
    return dispatch_auto_map_in_thread(tenant_slug, document_id)


__all__ = [
    "parse_policy_document",
    "run_gap_analysis",
    "auto_map_document_controls",
    "dispatch_auto_map",
    "dispatch_auto_map_in_thread",
    "dispatch_parse",
    "dispatch_parse_in_thread",
]
