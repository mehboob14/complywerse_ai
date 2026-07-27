from __future__ import annotations

import logging
from typing import Iterable, List, Sequence

from ....models import GRCUser, Role, UserRole, WorkflowNotification
from .email_service import _notification_html, send_email


logger = logging.getLogger(__name__)


def _normalize_ids(values: Iterable) -> list[int]:
    normalized: list[int] = []
    for value in values or []:
        try:
            parsed = int(value)
            if parsed > 0:
                normalized.append(parsed)
        except Exception:
            continue
    return normalized


def resolve_user_ids_from_roles(db, tenant_id: int, role_ids: Sequence[int]) -> list[int]:
    normalized_role_ids = _normalize_ids(role_ids)
    if not normalized_role_ids:
        return []

    rows = (
        db.query(UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .filter(
            UserRole.tenant_id == int(tenant_id),
            Role.id.in_(normalized_role_ids),
        )
        .distinct()
        .all()
    )
    return [int(r[0]) for r in rows if r and r[0]]


def resolve_target_user_ids(db, tenant_id: int, user_ids: Sequence[int], role_ids: Sequence[int]) -> list[int]:
    resolved = _normalize_ids(user_ids)
    resolved.extend(resolve_user_ids_from_roles(db, tenant_id, role_ids))
    return list(dict.fromkeys(resolved))


def _normalize_channels(channels: Sequence[str] | None) -> list[str]:
    if not channels:
        return ["in_app", "email"]

    out: list[str] = []
    for channel in channels:
        key = str(channel or "").strip().lower()
        if key in {"in_app", "in-app", "app"}:
            out.append("in_app")
        elif key in {"email", "mail"}:
            out.append("email")
    if not out:
        return ["in_app", "email"]
    return list(dict.fromkeys(out))


def send_workflow_notification(
    db,
    *,
    tenant_id: int,
    subject: str,
    message: str,
    workflow_instance_id: int | None,
    user_ids: Sequence[int] | None = None,
    role_ids: Sequence[int] | None = None,
    channels: Sequence[str] | None = None,
    notification_type: str = "info",
) -> dict:
    target_user_ids = resolve_target_user_ids(db, tenant_id, user_ids or [], role_ids or [])
    if not target_user_ids:
        return {"notified_users": 0, "channels": _normalize_channels(channels), "results": []}

    users = db.query(GRCUser).filter(
        GRCUser.id.in_(target_user_ids),
        GRCUser.is_active.is_(True),
    ).all()

    channels_normalized = _normalize_channels(channels)
    results: list[dict] = []
    for user in users:
        if "in_app" in channels_normalized:
            db.add(
                WorkflowNotification(
                    tenant_id=tenant_id,
                    user_id=user.id,
                    workflow_instance_id=workflow_instance_id,
                    notification_type=notification_type,
                    subject=subject,
                    message=message,
                )
            )

        email_result = None
        if "email" in channels_normalized and user.email:
            email_result = send_email(
                db,
                tenant_id=tenant_id,
                to=user.email,
                subject=subject,
                body_html=_notification_html(subject, message),
                body_text=message,
            )

        results.append(
            {
                "user_id": user.id,
                "email": user.email,
                "email_result": email_result,
            }
        )

    logger.info(
        "workflow.notification.sent tenant_id=%s workflow_instance_id=%s recipients=%s channels=%s",
        tenant_id,
        workflow_instance_id,
        len(results),
        ",".join(channels_normalized),
    )

    return {
        "notified_users": len(results),
        "channels": channels_normalized,
        "results": results,
    }
