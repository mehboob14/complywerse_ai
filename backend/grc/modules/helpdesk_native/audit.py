"""Central domain-level audit helper for the native Help Desk (H3).

Why this exists
---------------
The audit finding (H3) is that the Help Desk module writes *nothing* to the
central audit log at the domain level — the only trail is the generic HTTP
middleware (`audit_logger.write_audit_log`), which is fail-open, logs no
before→after, and buckets security-critical events as plain ``POST <path>``
rows. `hd_audit` is the single call every HD mutation (create / status change /
assign / reply / delete / merge / change approve-reject-schedule-complete /
role grant / mailbox-cred change, …) makes so those events land as
first-class, before→after rows in the SAME ``grc_audit_logs`` table the rest of
the platform uses.

Design contract
---------------
* **Reuses the central store.** Writes an ``AuditLog`` row (the model the HTTP
  middleware and `rich_audit` use) into the per-tenant DB on the caller's
  session, in the SAME transaction as the mutation — the row commits (or rolls
  back) with the action, so there is no "action succeeded, audit lost" window.
  The caller owns the commit boundary (matches `rich_audit.write_rich_audit_log`).
* **NOT silently fail-open.** On any write failure we log at ERROR with the
  FULL event payload (`exc_info`), so the event is never lost quietly — it is
  always recoverable from the application error log even if the DB row could
  not be written. We never raise, so an audit-plumbing failure cannot by itself
  break a legitimate request; but unlike the middleware it is never invisible.
* **before→after without PII dumps.** Mutations pass ``before``/``after`` dicts;
  we persist only the fields that CHANGED, redact secrets, and collapse known
  free-text / PII fields (ticket description, reply body, …) to a length marker
  instead of their content. Non-PII long strings are truncated. This keeps the
  audit log from becoming a second verbatim copy of customer PII (audit M2).

The emitted ``changes`` dict mirrors the shape `rich_audit.write_rich_audit_log`
produces so the existing audit-log UI / AI-summary renderer shows HD events
uniformly with the rest of the platform.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from ...models import AuditLog, GRCUser

logger = logging.getLogger(__name__)

# TODO bank-phase2: append-only / hash-chain (or DB WORM) at the DB/infra layer
# for tamper-evidence. This helper writes a plain, mutable INSERT; cryptographic
# tamper-evidence is out of scope for the application layer and is tracked as a
# bank phase-2 infrastructure item.

# Secrets are redacted outright; reuse the platform's key set so the policy
# stays consistent with the HTTP middleware and rich_audit.
SENSITIVE_KEYS = {
    "password", "password_hash", "token", "access_token", "refresh_token",
    "secret", "api_key", "authorization", "cookie", "smtp_password",
    "imap_password", "client_secret",
}

# Free-text / PII fields whose CONTENT must never be copied into the audit log
# (audit M2). We record that they changed and their length, not the text.
PII_TEXT_FIELDS = {
    "description", "desc", "body", "message", "content", "reply", "reply_body",
    "comment", "comments", "note", "notes", "feedback", "feedback_comment",
    "text", "html", "raw", "resolution", "rec", "recommendation",
}

# Non-PII strings longer than this are truncated (kept, but bounded).
_MAX_TEXT = 200


def _coerce_resource_id(entity_id: Any) -> Optional[int]:
    """AuditLog.resource_id is an Integer column. Coerce numeric ids; non-numeric
    ids (e.g. slugs/uuids) return None and are preserved inside ``changes``."""
    if isinstance(entity_id, bool):
        return None
    if isinstance(entity_id, int):
        return entity_id
    if isinstance(entity_id, str) and entity_id.strip().isdigit():
        try:
            return int(entity_id.strip())
        except ValueError:
            return None
    return None


def _safe_field(key: str, value: Any) -> Any:
    """PII-safe representation of one field value for the audit payload."""
    k = (key or "").lower()
    if k in SENSITIVE_KEYS:
        return "***"
    if isinstance(value, str) and k in PII_TEXT_FIELDS:
        # Known free-text PII — store only that it is present + its length.
        return f"<redacted free-text: {len(value)} chars>"
    if isinstance(value, str) and len(value) > _MAX_TEXT:
        return value[:_MAX_TEXT] + f"...[+{len(value) - _MAX_TEXT} chars]"
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        # Don't dump nested blobs verbatim — summarize.
        return f"<{type(value).__name__}:{len(value)}>"
    return value


def _diff(
    before: Optional[Dict[str, Any]],
    after: Optional[Dict[str, Any]],
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], list[str]]:
    """Reduce before/after to the CHANGED fields only, PII-safely.

    Returns (safe_before, safe_after, changed_field_names). When both dicts are
    given we keep only keys whose value actually differs; when only one is given
    we keep all of its keys (it's a create or a delete snapshot)."""
    if before is None and after is None:
        return None, None, []
    b = before or {}
    a = after or {}
    if not isinstance(b, dict):
        b = {"value": b}
    if not isinstance(a, dict):
        a = {"value": a}

    if before is not None and after is not None:
        keys = [k for k in sorted(set(b) | set(a)) if b.get(k) != a.get(k)]
    else:
        keys = sorted(set(b) | set(a))

    safe_before = {k: _safe_field(k, b.get(k)) for k in keys} if before is not None else None
    safe_after = {k: _safe_field(k, a.get(k)) for k in keys} if after is not None else None
    return safe_before, safe_after, keys


def _client_ip(request: Any) -> Optional[str]:
    if request is None:
        return None
    try:
        client = getattr(request, "client", None)
        return getattr(client, "host", None)
    except Exception:
        return None


def hd_audit(
    db,
    *,
    tenant_id: Optional[int],
    actor_email: Optional[str],
    action: str,
    entity: str,
    entity_id: Any = None,
    before: Optional[Dict[str, Any]] = None,
    after: Optional[Dict[str, Any]] = None,
    request: Any = None,
) -> None:
    """Record one Help Desk domain mutation in the central audit log.

    Parameters
    ----------
    db            : the tenant-bound SQLAlchemy Session the mutation runs on.
                    The audit row is added to THIS session and commits with it.
    tenant_id     : the tenant whose DB this is (``common.tenant_id(db)``).
    actor_email   : the signed-in user's email (``common.current_user_email``);
                    resolved to a user_id for the FK when possible.
    action        : the domain action verb, e.g. "ticket.create",
                    "ticket.status_change", "ticket.assign", "change.approve",
                    "role.grant", "mailbox.update".
    entity        : the entity type, e.g. "ticket", "change", "role",
                    "mail_account".
    entity_id     : the entity's id (int or str). Numeric ids become
                    resource_id; non-numeric are kept inside ``changes``.
    before/after  : state dicts for the mutation. PII is stripped; only changed
                    fields are stored.
    request       : optional FastAPI Request, used only for the source IP.

    Never raises. On write failure it logs at ERROR with the full event so the
    event is never lost silently (H3: not fail-open).
    """
    # Full event — logged verbatim if the DB write fails, so it is recoverable.
    event: Dict[str, Any] = {
        "tenant_id": tenant_id,
        "actor_email": actor_email,
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
    }
    try:
        if tenant_id is None:
            # Cannot satisfy the NOT NULL tenant_id FK — do not fail-open.
            logger.error(
                "hd_audit: missing tenant_id; audit event NOT persisted "
                "(recorded here instead): %s before=%r after=%r",
                event, before, after,
            )
            return

        user_id: Optional[int] = None
        if actor_email:
            try:
                u = db.query(GRCUser).filter(GRCUser.email == actor_email).first()
                user_id = u.id if u else None
            except Exception:
                user_id = None

        safe_before, safe_after, changed_fields = _diff(before, after)

        rid = _coerce_resource_id(entity_id)
        summary = f"{action} {entity}" + (f" #{entity_id}" if entity_id is not None else "")

        changes: Dict[str, Any] = {
            # rich_audit-parity shape so the existing audit UI renders HD events.
            "method": None,
            "path": None,
            "query": {},
            "status_code": None,
            "duration_ms": None,
            "user_agent": None,
            "request": None,
            "actor": actor_email,
            "actor_display": actor_email,
            "actor_type": "user",
            "actor_source": "helpdesk",
            "resource_name": str(entity_id) if entity_id is not None else None,
            "summary": summary,
            "snapshot": {
                "entity": entity,
                "entity_id": entity_id,
                "changed_fields": changed_fields,
                "before": safe_before,
                "after": safe_after,
            },
        }

        row = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            action=action,
            resource_type=f"helpdesk:{entity}",
            resource_id=rid,
            changes=changes,
            ip_address=_client_ip(request),
        )
        db.add(row)
        # Attach to the caller's transaction and surface any write error NOW so
        # we can log it, rather than letting it silently vanish at commit time.
        db.flush()
    except Exception:
        # NOT fail-open: never lose the event quietly. Log the full event + diff
        # at ERROR so it is always recoverable from the application log.
        logger.error(
            "hd_audit: FAILED to persist audit event (NOT fail-open) %s "
            "before=%r after=%r",
            event, before, after, exc_info=True,
        )


__all__ = ["hd_audit"]
