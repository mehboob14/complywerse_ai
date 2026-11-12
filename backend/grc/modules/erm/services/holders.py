"""Who holds a permission: the people to tell when a record waits for their decision."""
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from .monitor_changes import permission_holders


def holder_ids(db: Session, *names: str, tenant_id: Optional[int], but_not: Iterable[Optional[int]] = ()) -> List[int]:
    """Active people of the tenant holding one of the permissions (monitor_changes.permission_holders, the one rule),
    leaving out ``but_not`` (who acted, or may not decide); the tenant's administrators when nobody else is left."""
    from ...governance.permissions import admin_user_ids

    excluded = {i for i in but_not if i}
    return sorted((permission_holders(db, tenant_id, names) - excluded) or (admin_user_ids(db) - excluded))
