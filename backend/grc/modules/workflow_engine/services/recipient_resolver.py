from typing import Iterable

from sqlalchemy.orm import Session

from ....models import GRCUser, Role, TenantUser, UserRole


class WorkflowRecipientResolver:
    @staticmethod
    def _normalize_ids(values: Iterable) -> list[int]:
        ids: list[int] = []
        for value in values or []:
            try:
                parsed = int(value)
                if parsed > 0:
                    ids.append(parsed)
            except Exception:
                continue
        return ids

    @classmethod
    def resolve_user_ids(
        cls,
        db: Session,
        tenant_id: int,
        user_ids: Iterable | None = None,
        role_ids: Iterable | None = None,
        role_names: Iterable[str] | None = None,
    ) -> list[int]:
        normalized_user_ids = set(cls._normalize_ids(user_ids or []))
        normalized_role_ids = set(cls._normalize_ids(role_ids or []))

        if role_names:
            role_rows = db.query(Role.id).filter(
                Role.tenant_id == tenant_id,
                Role.name.in_([name for name in role_names if name]),
            ).all()
            normalized_role_ids.update(int(row.id) for row in role_rows)

        if normalized_role_ids:
            role_user_rows = db.query(UserRole.user_id).filter(
                UserRole.tenant_id == tenant_id,
                UserRole.role_id.in_(list(normalized_role_ids)),
            ).all()
            normalized_user_ids.update(int(row.user_id) for row in role_user_rows if row.user_id)

        if not normalized_user_ids:
            return []

        valid_rows = db.query(GRCUser.id).join(
            TenantUser,
            TenantUser.user_id == GRCUser.id,
        ).filter(
            GRCUser.id.in_(list(normalized_user_ids)),
            GRCUser.is_active == True,
            TenantUser.tenant_id == tenant_id,
        ).all()

        resolved = sorted({int(row.id) for row in valid_rows})
        return resolved

    @classmethod
    def resolve_emails_for_users(cls, db: Session, tenant_id: int, user_ids: Iterable) -> list[str]:
        normalized_ids = cls._normalize_ids(user_ids or [])
        if not normalized_ids:
            return []

        users = db.query(GRCUser.email).join(
            TenantUser,
            TenantUser.user_id == GRCUser.id,
        ).filter(
            GRCUser.id.in_(normalized_ids),
            TenantUser.tenant_id == tenant_id,
            GRCUser.is_active == True,
            GRCUser.email.isnot(None),
        ).all()

        emails = sorted({str(item.email).strip() for item in users if item.email})
        return emails
