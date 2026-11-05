"""Assets on an exception: one list, with who added each and at which stage (DECISIONS D62).

The list is ``PolicyException.linked_asset_ids``: it is what the posture score, "Move to risk register" and the page already read, so it stays the
membership. ``grc_exception_asset_links`` keeps who put each asset there and when: the requester (or someone allowed to edit exceptions) at the
request, the implementer while the implementation is open. Each can add; each can remove what they added; someone allowed to edit exceptions
can remove any. An exception that predates this has ids and no rows: they read as added by its requester at the request, and get rows the first
time the list is written.

Functions that write only ``flush``: the caller commits. The rows say who added what and when; nothing is added to the comments.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ...models import ExceptionAssetLink, GRCUser, ITAsset, PolicyException
from . import exception_approvals as A
from . import exception_controls as C

CHANGEABLE = ("draft", "pending_approval", "approved")             # an exception that was rejected, revoked or has expired keeps its assets
LOCKED = "This exception is closed: its assets are kept as they were."
NOT_YOURS = "Only the person who raised this exception, someone allowed to edit exceptions, or the people asked to implement it can change its assets."


def _problem(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def stage_for(db: Session, exc: PolicyException, user: GRCUser, may_edit: bool) -> Optional[str]:
    """What the person is to this exception's assets: ``request`` (the requester, or someone allowed to edit), ``implementation`` (asked to
    implement it, while that is open), or None."""
    if exc.status not in CHANGEABLE:
        return None
    if exc.requested_by == user.id or may_edit:
        return "request"
    return "implementation" if C.may_implement(db, exc, user) is not None else None


def rows_of(db: Session, exc: PolicyException) -> List[ExceptionAssetLink]:
    return db.query(ExceptionAssetLink).filter(ExceptionAssetLink.exception_id == exc.id).order_by(ExceptionAssetLink.id).all()


def view(db: Session, exc: PolicyException, user: GRCUser, may_edit: bool) -> List[Dict[str, Any]]:
    """The exception's assets, each with who added it and when; ``can_remove`` says whether this person may take it off."""
    ids = [int(i) for i in exc.linked_asset_ids or []]
    if not ids:
        return []
    assets = {a.id: a for a in db.query(ITAsset).filter(ITAsset.id.in_(ids))}
    rows = {r.asset_id: r for r in rows_of(db, exc)}
    names = A._names(db, {r.added_by for r in rows.values() if r.added_by} | ({exc.requested_by} if exc.requested_by else set()))
    stage = stage_for(db, exc, user, may_edit)
    out = []
    for asset_id in ids:
        a = assets.get(asset_id)
        if a is None:
            continue
        r = rows.get(asset_id)
        by = r.added_by if r is not None else exc.requested_by
        out.append({"asset_id": a.id, "name": a.name, "asset_type": a.asset_type, "criticality": a.criticality,
                    "added_by": {"id": by, "name": names.get(by, f"User #{by}")} if by else None,
                    "stage": (r.stage if r is not None else "request") or "request", "step_name": r.step_name if r is not None else None,
                    "added_at": _iso(r.created_at if r is not None else exc.created_at),
                    "can_remove": stage is not None and (may_edit or by == user.id)})
    return out


def _valid(db: Session, exc: PolicyException, raw: Iterable[Any]) -> List[int]:
    ids: List[int] = []
    for x in raw or []:
        try:
            i = int(x)
        except (TypeError, ValueError):
            raise _problem("An asset chosen does not exist.") from None
        if i not in ids:
            ids.append(i)
    if ids:
        found = {i for (i,) in db.query(ITAsset.id).filter(ITAsset.id.in_(ids), ITAsset.tenant_id == exc.tenant_id)}
        if found != set(ids):
            raise _problem("An asset chosen does not exist.")
    return ids


def _ensure_rows(db: Session, exc: PolicyException) -> Dict[int, ExceptionAssetLink]:
    """Rows for the assets an older exception already has (added by its requester at the request), and none for an asset that is gone."""
    have = {r.asset_id: r for r in rows_of(db, exc)}
    ids = [int(i) for i in exc.linked_asset_ids or []]
    for asset_id in ids:
        if asset_id not in have:
            have[asset_id] = ExceptionAssetLink(tenant_id=exc.tenant_id, exception_id=exc.id, asset_id=asset_id, added_by=exc.requested_by,
                                                stage="request", created_at=exc.created_at or datetime.utcnow())
            db.add(have[asset_id])
    for asset_id in [a for a in have if a not in ids]:
        db.delete(have.pop(asset_id))
    return have


def _set_list(exc: PolicyException, ids: List[int]) -> None:
    exc.linked_asset_ids = ids
    flag_modified(exc, "linked_asset_ids")
    exc.updated_at = datetime.utcnow()


def add(db: Session, exc: PolicyException, user: GRCUser, asset_ids: Iterable[Any], may_edit: bool) -> List[int]:
    """Put assets on the list (the ones that are already there stay as they were). Returns the ids that were new."""
    stage = stage_for(db, exc, user, may_edit)
    if stage is None:
        raise _problem(LOCKED if exc.status not in CHANGEABLE else NOT_YOURS, status.HTTP_409_CONFLICT if exc.status not in CHANGEABLE else status.HTTP_403_FORBIDDEN)
    wanted = _valid(db, exc, asset_ids)
    have = _ensure_rows(db, exc)
    new = [i for i in wanted if i not in have]
    for asset_id in new:
        db.add(ExceptionAssetLink(tenant_id=exc.tenant_id, exception_id=exc.id, asset_id=asset_id, added_by=user.id, stage=stage,
                                  step_name=None, created_at=datetime.utcnow()))
    if new:
        _set_list(exc, [*[int(i) for i in exc.linked_asset_ids or []], *new])
    db.flush()
    return new


def remove(db: Session, exc: PolicyException, user: GRCUser, asset_id: int, may_edit: bool) -> None:
    stage = stage_for(db, exc, user, may_edit)
    if stage is None:
        raise _problem(LOCKED if exc.status not in CHANGEABLE else NOT_YOURS, status.HTTP_409_CONFLICT if exc.status not in CHANGEABLE else status.HTTP_403_FORBIDDEN)
    have = _ensure_rows(db, exc)
    row = have.get(int(asset_id))
    if row is None:
        raise _problem("That asset is not on this exception.", status.HTTP_404_NOT_FOUND)
    if not may_edit and row.added_by != user.id:
        raise _problem("You can take off only the assets you added.", status.HTTP_403_FORBIDDEN)
    db.delete(row)
    _set_list(exc, [int(i) for i in exc.linked_asset_ids or [] if int(i) != int(asset_id)])
    db.flush()


def sync_from_form(db: Session, exc: PolicyException, user: GRCUser, asset_ids: Iterable[Any]) -> None:
    """The owner's form sends the list it shows: what is new is added by the person; what is missing is removed, except what the implementer
    added at the implementation (the form never takes that away)."""
    wanted = _valid(db, exc, asset_ids)
    have = _ensure_rows(db, exc)
    keep = [i for i in have if i not in wanted and have[i].stage == "implementation"]
    for asset_id in [i for i in have if i not in wanted and i not in keep]:
        db.delete(have.pop(asset_id))
    for asset_id in wanted:
        if asset_id not in have:
            db.add(ExceptionAssetLink(tenant_id=exc.tenant_id, exception_id=exc.id, asset_id=asset_id, added_by=user.id, stage="request",
                                      created_at=datetime.utcnow()))
    _set_list(exc, [*wanted, *[i for i in keep if i not in wanted]])
    db.flush()
