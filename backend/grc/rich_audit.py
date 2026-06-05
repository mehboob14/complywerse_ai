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
from typing import Any, Dict, Optional

from .models import AuditLog

logger = logging.getLogger(__name__)


def write_rich_audit_log(
    *,
    db,
    tenant_id: int,
    user_id: Optional[int],
    action: str,
    resource_type: str,
    resource_id: Optional[int],
    resource_name: Optional[str] = None,
    resource_url: Optional[str] = None,
    summary: Optional[str] = None,
    snapshot: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
) -> None:
    """Append one audit-log row from non-HTTP code (workflows, schedulers).

    Mirrors the shape of HTTP-middleware-written rows so the audit-log UI
    and the AI summary endpoint render uniformly. Swallows all exceptions
    to guarantee that audit-logging failure can never roll back the
    caller's transaction.
    """
    try:
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
            "actor_type": "user" if user_id else "workflow",
            "resource_name": resource_name,
            "summary": summary,
            "snapshot": snapshot or {},
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


__all__ = ["write_rich_audit_log"]
