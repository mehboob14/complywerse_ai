"""Compatibility shim for the CIS integration package's rich audit helper.

The CIS-side ``run_service.py`` calls ``write_rich_audit_log(...)`` with a
keyword-rich signature that carries pre-computed display fields
(``resource_name``, ``resource_url``, ``summary``, ``snapshot``) so the
audit UI / AI summary can render without re-fetching.

Main repo's audit pipeline writes ``AuditLog`` rows via the HTTP
middleware in ``audit_logger.py``. There's no out-of-band helper that
captures these business-event style entries, so this module wraps the
``AuditLog`` model directly. Failure here is *never* allowed to break a
plugin-run commit, so every write is wrapped in try/except.

Shape parity with the middleware-written rows:

* ``changes`` carries the same dict shape — method/path/duration are
  null because there's no HTTP context.
* ``actor_type`` is set to ``workflow`` when ``user_id`` is None,
  matching the audit-log UI's filter.
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Dict, Iterator, Optional

from .models import AuditLog

logger = logging.getLogger(__name__)


# ─── Workflow actor context ──────────────────────────────────────────────
# ContextVars that propagate through the call stack (incl. async tasks) so
# audit-write callsites buried deep inside platform CRUD endpoints can be
# tagged as workflow-originated without each callsite threading explicit
# kwargs. The trigger dispatcher's poll filter then skips these rows to
# prevent workflow-on-workflow recursion (loop prevention).
_workflow_actor_source: ContextVar[Optional[str]] = ContextVar(
    "workflow_actor_source", default=None
)
_workflow_actor_type: ContextVar[Optional[str]] = ContextVar(
    "workflow_actor_type", default=None
)
_workflow_actor_workflow_id: ContextVar[Optional[int]] = ContextVar(
    "workflow_actor_workflow_id", default=None
)


@contextmanager
def workflow_actor_context(
    source: str = "workflow",
    actor_type: str = "workflow_engine",
    actor_workflow_id: Optional[int] = None,
) -> Iterator[None]:
    """Mark the current call stack as workflow-originated so any audit rows
    written inside the block default to ``actor_source=source``,
    ``actor_type=actor_type`` and ``actor_workflow_id=actor_workflow_id``.

    Used around code that executes platform CRUD on behalf of the workflow
    runtime — most importantly the action handler dispatch in
    ``step_executor.execute_action_step`` — so those audit rows can be
    skipped by the trigger dispatcher to avoid self-triggering loops.
    """
    token_source = _workflow_actor_source.set(source)
    token_type = _workflow_actor_type.set(actor_type)
    token_wid = _workflow_actor_workflow_id.set(actor_workflow_id)
    try:
        yield
    finally:
        _workflow_actor_source.reset(token_source)
        _workflow_actor_type.reset(token_type)
        _workflow_actor_workflow_id.reset(token_wid)


def current_actor_source(default: str = "user") -> str:
    """Return the active workflow actor source, or ``default`` if none set."""
    return _workflow_actor_source.get() or default


def current_actor_type(default: str = "user") -> str:
    """Return the active workflow actor type, or ``default`` if none set."""
    return _workflow_actor_type.get() or default


def current_actor_workflow_id() -> Optional[int]:
    """Return the active workflow definition id, or None if not in a workflow."""
    return _workflow_actor_workflow_id.get()


SENSITIVE_KEYS = {
    "password", "password_hash", "token", "access_token",
    "refresh_token", "secret", "api_key", "authorization", "cookie",
}

SKIP_INTERNAL_KEYS = {"_sa_instance_state"}


def model_to_dict(obj: Any) -> Dict[str, Any]:
    """Convert a SQLAlchemy model instance to a plain dict of column values."""
    result: Dict[str, Any] = {}
    for col in obj.__class__.__table__.columns:
        val = getattr(obj, col.name, None)
        if isinstance(val, datetime):
            val = val.isoformat()
        result[col.name] = val
    return result


def _sanitize(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: "***" if k.lower() in SENSITIVE_KEYS else _sanitize(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_sanitize(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def write_rich_audit_log(
    *,
    db,
    tenant_id: int,
    user_id: Optional[int],
    action: str,
    resource_type: str,
    resource_id: Optional[int] = None,
    resource_name: Optional[str] = None,
    resource_url: Optional[str] = None,
    summary: Optional[str] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    # CIS-merge extension — accepted (and merged into snapshot when
    # provided) so the audit_logger.py shim can pass through the
    # extended signature it expects. Backward-compatible: existing
    # callers that don't pass these stay unchanged.
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    actor_type: Optional[str] = None,
    actor_workflow_id: Optional[int] = None,
    # Loop-prevention tag. Persisted inside ``changes['actor_source']`` (no
    # dedicated column on AuditLog) so the trigger dispatcher can skip
    # workflow-written rows when polling for new platform events. When None,
    # inherited from the active workflow_actor_context (else "user").
    actor_source: Optional[str] = None,
) -> None:
    """Append one audit-log row from non-HTTP code (workflows, schedulers).

    Mirrors the shape of HTTP-middleware-written rows so the audit-log UI
    and the AI summary endpoint render uniformly. Swallows all exceptions
    to guarantee that audit-logging failure can never roll back the
    caller's transaction.
    """
    try:
        # Merge the CIS-shim extensions into snapshot so a single payload
        # carries everything an audit-UI renderer needs.
        merged_snapshot: Dict[str, Any] = dict(snapshot or {})
        if before is not None:
            merged_snapshot["before"] = before
        if after is not None:
            merged_snapshot["after"] = after
        # Inherit actor identity from an enclosing workflow_actor_context when
        # the caller didn't pass explicit values, so platform CRUD handlers
        # executed by the step executor self-tag without per-callsite changes.
        if actor_workflow_id is None:
            actor_workflow_id = current_actor_workflow_id()
        if actor_workflow_id is not None:
            merged_snapshot["actor_workflow_id"] = actor_workflow_id
        resolved_actor_source = actor_source or current_actor_source(
            "user" if user_id else "workflow"
        )
        resolved_actor_type = actor_type or current_actor_type(
            "user" if user_id else "workflow"
        )
        changes: Dict[str, Any] = {
            "method": None,
            "path": resource_url,
            "query": {},
            "status_code": None,
            "duration_ms": None,
            "user_agent": None,
            "request": None,
            "actor": None,
            "actor_display": None,
            "actor_type": resolved_actor_type,
            "actor_source": resolved_actor_source,
            "resource_name": resource_name,
            "summary": summary,
            "snapshot": merged_snapshot,
        }
        row = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            changes=changes,
            ip_address=ip_address,
        )
        db.add(row)
        # Caller controls commit boundary; we only need the row attached.
    except Exception:  # noqa: BLE001
        logger.exception("write_rich_audit_log failed; continuing")


__all__ = [
    "write_rich_audit_log",
    "workflow_actor_context",
    "current_actor_source",
    "current_actor_type",
    "current_actor_workflow_id",
    "model_to_dict",
    "SENSITIVE_KEYS",
]
