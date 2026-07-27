"""Shared upsert used by every connector: map records → grc_users +
grc_roles/grc_user_roles (entitlements), reconciled per `provider_tag`.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Callable, Dict, List

from sqlalchemy.orm import Session

from ...models import GRCUser, Role, UserRole


def _get_or_create_role(db: Session, tenant_id: int, name: str, cache: Dict[str, Role]) -> Role:
    if name in cache:
        return cache[name]
    role = db.query(Role).filter(Role.tenant_id == tenant_id, Role.name == name).first()
    if role is None:
        role = Role(tenant_id=tenant_id, name=name, description="Imported from connector")
        db.add(role); db.flush()
    cache[name] = role
    return role


def ingest(tenant_db: Session, *, tenant_id: int, records: List[Dict[str, Any]],
           map_fn: Callable, provider_tag: str) -> Dict[str, Any]:
    """Upsert mapped records. `provider_tag` scopes the user_role rows so a
    re-sync replaces only this connector's assignments."""
    from ...routers.sso_router import _make_unloginable_hash
    created = updated = skipped = ent_links = 0
    now = datetime.utcnow()
    cache: Dict[str, Role] = {}
    for raw in records:
        m = map_fn(raw)
        if not m:
            skipped += 1
            continue
        user = (
            tenant_db.query(GRCUser)
            .filter((GRCUser.external_id == m["external_id"]) | (GRCUser.email == m["email"]))
            .first()
        )
        if user is None:
            user = GRCUser(username=m["email"], email=m["email"],
                           password_hash=_make_unloginable_hash(), is_active=True,
                           external_provider=provider_tag, external_id=m["external_id"])
            tenant_db.add(user); tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = provider_tag
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m.get("department") or user.department
        user.designation = m.get("designation") or user.designation
        user.account_enabled = m["account_enabled"]
        if m.get("terminated") and not user.termination_date:
            user.termination_date = date.today()
        user.access_synced_at = now

        tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id, UserRole.source == provider_tag
        ).delete(synchronize_session=False)
        for ent in m.get("entitlements", []):
            role = _get_or_create_role(tenant_db, tenant_id, ent, cache)
            tenant_db.add(UserRole(user_id=user.id, role_id=role.id,
                                   tenant_id=tenant_id, source=provider_tag))
            ent_links += 1
    tenant_db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "entitlements_linked": ent_links, "total_in_directory": len(records)}
