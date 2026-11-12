"""Monitor (KRIs and risk appetite): a change to what is in force is proposed by one person and decided by another, and
the person who acts next is told.

A proposal lives in one JSON column of the row it changes (RiskKRI.threshold_change, RiskAppetiteConfig.limit_change):
{status pending|approved|rejected, changes, proposed_by, proposed_at, decided_by, decided_at, note}. While it is pending
the values in force stay; approval hands the changes back for the caller to apply.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Iterable, Optional, Set

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ....models import GRCUser, RiskAppetiteConfig, RiskAppetiteStatement, UserRole
from ....routers.auth_router import PLATFORM_GRANT, has_tenant_permission, platform_account
from ....services.segregation import ensure_independent
from ...workflow_engine.services.notification_service import send_workflow_notification

logger = logging.getLogger(__name__)
PENDING = "pending"


# ── who acts next, and telling them ─────────────────────────────────────────────────────────────────────────────────
def permission_holders(db: Session, tenant_id: Optional[int], permissions: Iterable[str]) -> Set[int]:
    """Active people of the tenant who hold one of the permissions (an administrator holds them all).
    shortcut: one permission check per person with a role; fine for a tenant's tens of people, query in bulk past that."""
    ids = {uid for (uid,) in db.query(UserRole.user_id).filter(
        PLATFORM_GRANT, or_(UserRole.tenant_id == tenant_id, UserRole.tenant_id.is_(None))).distinct()}
    if not ids:
        return set()
    people = db.query(GRCUser).filter(GRCUser.id.in_(ids), GRCUser.is_active.is_(True), platform_account()).all()
    return {u.id for u in people if has_tenant_permission(db, u, *permissions)}


def notify(db: Session, tenant_id: Optional[int], user_ids: Iterable[Optional[int]], subject: str, message: str, link: str,
           actor_id: Optional[int] = None) -> None:
    """Tell the people who act next, never the one who just acted. Runs after the caller committed its work and commits
    on its own, so a failure here is logged and never undoes that work."""
    to = sorted({u for u in user_ids if u and u != actor_id})
    if not to or not tenant_id:
        return
    try:
        send_workflow_notification(db, tenant_id=tenant_id, subject=subject, message=message, workflow_instance_id=None,
                                   user_ids=to, link=link)
        db.commit()
    except Exception:  # noqa: BLE001 — a notice must not undo the decision it reports
        db.rollback()
        logger.exception("monitor notice %r could not be sent", subject)


# ── a proposed change and its decision ──────────────────────────────────────────────────────────────────────────────
def pending_change(row: Any, column: str) -> Optional[dict]:
    change = getattr(row, column)
    return change if isinstance(change, dict) and change.get("status") == PENDING else None


def changed(row: Any, sent: Dict[str, Any]) -> Dict[str, Any]:
    """What `sent` would change on the row (a value equal to the one in force is no change)."""
    return {field: value for field, value in sent.items() if value != getattr(row, field)}


def propose(row: Any, column: str, changes: Dict[str, Any], user: GRCUser) -> None:
    """Record the proposal; a change still pending is folded in (one proposal per row, the latest proposer owns it)."""
    earlier = (pending_change(row, column) or {}).get("changes", {})
    setattr(row, column, {"status": PENDING, "changes": {**earlier, **changes}, "proposed_by": user.id,
                          "proposed_at": datetime.utcnow().isoformat()})


def decide(row: Any, column: str, user: GRCUser, approve: bool, note: Optional[str], what: str) -> Dict[str, Any]:
    """Approve or send back the pending change, not by its proposer; sending back needs a note. Returns the changes,
    which the caller applies when approved."""
    change = pending_change(row, column)
    if not change:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"No {what} is waiting for a decision.")
    ensure_independent(change.get("proposed_by"), user, f"{'approve' if approve else 'send back'} this {what}")
    note = (note or "").strip() or None
    if not approve and not note:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Write the reason for sending it back.")
    setattr(row, column, {**change, "status": "approved" if approve else "rejected", "decided_by": user.id,
                          "decided_at": datetime.utcnow().isoformat(), "note": note})
    return change["changes"]


# ── appetite limits frozen into the approved statement ──────────────────────────────────────────────────────────────
LIMIT_FIELDS = ("appetite_level", "max_acceptable_score", "tolerance_threshold", "limit_kri_ids", "escalation_owner_id",
                "concentration_limit")


def approved_statement(db: Session, tenant_id: int) -> Optional[RiskAppetiteStatement]:
    """The approved version in force: once there is one, a limit change is a proposal."""
    return (db.query(RiskAppetiteStatement).filter(RiskAppetiteStatement.tenant_id == tenant_id,
                                                   RiskAppetiteStatement.status == "approved")
            .order_by(RiskAppetiteStatement.version.desc()).first())


def limits_snapshot(db: Session, tenant_id: int) -> Dict[str, dict]:
    """Each category's limits as they stand: what approving a statement version freezes into it."""
    return {c.category: {f: getattr(c, f) for f in LIMIT_FIELDS}
            for c in db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == tenant_id)}


def limits_source(config: RiskAppetiteConfig, statement: Optional[RiskAppetiteStatement]) -> dict:
    """Where a category's limits in force come from: as approved with version N, changed (by an approved limit change)
    since it, added since it, or no approved version yet / one approved before limits were frozen with it."""
    if statement is None:
        return {"version": None, "state": "no_approved_version"}
    if (pending_change(config, "limit_change") or {}).get("changes", {}).get("add"):
        return {"version": statement.version, "state": "proposed"}     # a new limit waiting for approval, not in force
    if statement.limits is None:
        return {"version": statement.version, "state": "not_recorded"}
    frozen = statement.limits.get(config.category)
    if frozen is None:
        return {"version": statement.version, "state": "added"}
    same = all(frozen.get(f) == getattr(config, f) for f in LIMIT_FIELDS)
    return {"version": statement.version, "state": "as_approved" if same else "changed"}
