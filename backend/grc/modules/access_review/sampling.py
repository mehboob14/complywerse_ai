"""Draw a sample of users for an access review.

Three methods:
  * full        — every user in the population (100% coverage)
  * risk_based  — deliberately include high-risk users (admins, terminated,
                  selected departments), then top up with a stride sample
  * random      — deterministic stride sample across the whole population

We use stride selection rather than random.shuffle so a given population +
sample size always yields the same sample — reproducible for audit evidence.
"""

from __future__ import annotations

from typing import Any, Dict, List, Set

from ...models import GRCUser, Role, UserRole

PRIVILEGED_ROLE_NAMES = {"administrator", "admin", "super admin", "owner", "superuser"}
# Substrings that mark a role as privileged regardless of exact naming, so a
# tenant's "Tenant Admin" / "Global Administrator" / "Root Owner" still counts.
_PRIVILEGED_SUBSTRINGS = ("admin", "owner", "root", "superuser")


def _is_privileged_role_name(name: str | None) -> bool:
    n = (name or "").strip().lower()
    if not n:
        return False
    return n in PRIVILEGED_ROLE_NAMES or any(s in n for s in _PRIVILEGED_SUBSTRINGS)


def privileged_user_ids(tenant_db, tenant_id: int) -> Set[int]:
    """User ids holding any privileged role.

    Matches the known privileged role names case-insensitively, plus any role
    whose name contains a privileged substring (admin/owner/root/superuser) —
    so detection survives tenant-specific role naming instead of relying on an
    exact match against a fixed set.
    """
    rows = (
        tenant_db.query(UserRole.user_id, Role.name)
        .join(Role, Role.id == UserRole.role_id)
        .all()
    )
    return {uid for uid, name in rows if _is_privileged_role_name(name)}


def _stride_select(items: List[GRCUser], n: int) -> List[GRCUser]:
    """Evenly-spaced selection of n items (mirrors the ERM generator pattern)."""
    if n <= 0 or not items:
        return []
    if n >= len(items):
        return list(items)
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def build_population(
    tenant_db, tenant_id: int, review_type: str = "user_access"
) -> List[GRCUser]:
    """The users in scope for the review, stable-ordered for reproducibility.

    The population is scoped by `review_type` so the three review kinds aren't
    identical:
      * user_access        — every user (default)
      * privileged_access  — only users holding a privileged role
      * terminated_access  — only users with a termination date recorded
    """
    users = (
        tenant_db.query(GRCUser)
        .order_by(GRCUser.id.asc())
        .all()
    )
    if review_type == "privileged_access":
        priv = privileged_user_ids(tenant_db, tenant_id)
        return [u for u in users if u.id in priv]
    if review_type == "terminated_access":
        return [u for u in users if getattr(u, "termination_date", None)]
    return users


def draw_sample(
    tenant_db,
    tenant_id: int,
    population: List[GRCUser],
    *,
    method: str = "random",
    size: int = 25,
    filters: Dict[str, Any] | None = None,
) -> List[GRCUser]:
    filters = filters or {}
    if method == "full":
        return list(population)

    if method == "risk_based":
        priv = privileged_user_ids(tenant_db, tenant_id)
        depts = {d.lower() for d in (filters.get("departments") or [])}
        include_admins = filters.get("include_admins", True)
        include_terminated = filters.get("include_terminated", True)

        must_include: List[GRCUser] = []
        included_ids: Set[int] = set()
        for u in population:
            hit = False
            if include_admins and u.id in priv:
                hit = True
            if include_terminated and getattr(u, "termination_date", None):
                hit = True
            if depts and (u.department or "").lower() in depts:
                hit = True
            if hit and u.id not in included_ids:
                must_include.append(u)
                included_ids.add(u.id)

        # Top up with a stride sample of the remaining population.
        remaining = [u for u in population if u.id not in included_ids]
        top_up = max(0, size - len(must_include))
        return must_include + _stride_select(remaining, top_up)

    # default: random (deterministic stride)
    return _stride_select(list(population), size)
