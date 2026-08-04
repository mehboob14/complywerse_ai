"""
Rich audit logging helper.
Kept in a separate module to avoid circular imports with audit_logger.py
(which depends on auth_router, which indirectly re-imports routers that use this helper).
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Any, Dict, Iterator, Optional

from sqlalchemy.orm import Session


# ContextVar that propagates through the call stack (incl. async tasks) so that
# audit-write callsites buried deep inside platform CRUD endpoints can be tagged
# as workflow-originated without each callsite having to thread an explicit
# actor_source kwarg. The trigger dispatcher's poll filter then skips these rows
# to prevent workflow-on-workflow recursion.
_workflow_actor_source: ContextVar[Optional[str]] = ContextVar(
    "workflow_actor_source", default=None
)

# ContextVars that carry actor_type and actor_workflow_id for the duration of
# a workflow step execution so that any write_rich_audit_log call made deep
# inside platform CRUD handlers automatically gets tagged as "workflow_engine"
# without every callsite having to thread these kwargs explicitly.
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
    """Mark the current call stack as workflow-originated so that any audit
    rows written inside the block default to ``actor_source=source``,
    ``actor_type=actor_type``, and ``actor_workflow_id=actor_workflow_id``.

    Use this around any code that executes platform CRUD operations on behalf
    of the workflow runtime — most importantly the action handler dispatch in
    ``step_executor.execute_action_step``."""
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
    """Return the active workflow actor source, or ``default`` if none is set."""
    return _workflow_actor_source.get() or default


def current_actor_type(default: str = "user") -> str:
    """Return the active workflow actor type, or ``default`` if none is set."""
    return _workflow_actor_type.get() or default


def current_actor_workflow_id() -> Optional[int]:
    """Return the active workflow definition ID, or None if not in a workflow context."""
    return _workflow_actor_workflow_id.get()


SENSITIVE_KEYS = {
    "password", "password_hash", "token", "access_token",
    "refresh_token", "secret", "api_key", "authorization", "cookie",
}

SKIP_INTERNAL_KEYS = {"_sa_instance_state"}


def model_to_dict(obj: Any) -> Dict[str, Any]:
    """Convert a SQLAlchemy model instance to a plain dict of its column values."""
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
    db: Session,
    tenant_id: int,
    user_id: Optional[int],
    action: str,
    resource_type: str,
    resource_id: Optional[int] = None,
    resource_name: Optional[str] = None,
    resource_url: Optional[str] = None,
    summary: Optional[str] = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    actor_type: str = "user",
    actor_workflow_id: Optional[int] = None,
    ip_address: Optional[str] = None,
    actor_source: Optional[str] = None,
) -> None:
    """Write a semantically-rich audit log entry with before/after diffs and human summary.

    ``actor_source`` is persisted to the ``actor_source`` column for loop
    prevention. When ``None`` (the default) the value is taken from the active
    :func:`workflow_actor_context` if one is set, otherwise falls back to
    ``"user"``. Pass ``actor_source="workflow"`` explicitly from any audit-write
    that is itself the result of a workflow firing so the trigger dispatcher
    can skip those rows when polling for new platform events.

    When called from within a :func:`workflow_actor_context`, ``actor_type``
    and ``actor_workflow_id`` are automatically inherited from the context so
    that platform CRUD handlers executed by the workflow runtime produce audit
    rows tagged as "workflow_engine" without needing to thread these kwargs
    through every call site.
    """
    from .models import AuditLog

    if actor_source is None:
        actor_source = current_actor_source("user")

    # Inherit actor_type / actor_workflow_id from an enclosing workflow context
    # when the caller has not explicitly overridden them (i.e. they are still
    # at their default "user" / None values).  This lets platform CRUD handlers
    # that are called by the step executor be automatically tagged as
    # "workflow_engine" without any per-callsite change.
    if actor_type == "user":
        ctx_type = current_actor_type()
        if ctx_type and ctx_type != "user":
            actor_type = ctx_type
    if actor_workflow_id is None:
        actor_workflow_id = current_actor_workflow_id()

    changes: Dict[str, Any] = {"actor_type": actor_type}
    if summary:
        changes["summary"] = summary
    if actor_workflow_id is not None:
        changes["actor_workflow_id"] = actor_workflow_id
    if resource_name:
        changes["resource_name"] = resource_name
    if resource_url:
        changes["resource_url"] = resource_url
    if before is not None:
        changes["before"] = _sanitize(before)
    if after is not None:
        changes["after"] = _sanitize(after)
    if snapshot is not None:
        changes["snapshot"] = _sanitize(snapshot)
    if before is not None and after is not None:
        all_keys = set(before.keys()) | set(after.keys())
        field_diff: Dict[str, Any] = {}
        for k in all_keys:
            old_val = before.get(k)
            new_val = after.get(k)
            if str(old_val) != str(new_val):
                field_diff[k] = {"old": _sanitize(old_val), "new": _sanitize(new_val)}
        if field_diff:
            changes["field_diff"] = field_diff

    log = AuditLog(
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        changes=changes,
        ip_address=ip_address,
        actor_source=actor_source,
        timestamp=datetime.utcnow(),
    )
    db.add(log)
