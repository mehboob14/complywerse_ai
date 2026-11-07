"""Tags — native conversion of Frappe `helpdesk/api/tags.py`.

Frappe tagged docs through core `Tag` (a shared master, claimed for the app via
`app="helpdesk"` + a colour) and core `Tag Link` (the doc↔tag join), with the
labels also cached on the doc's comma-separated `_user_tags` column. The native
engine replaces both with real tables: `HDTag` (tenant-scoped master, unique name
per tenant) and `HDTicketTag` (the join). `_user_tags` disappears — the join rows
ARE the source of truth — so the comma guard Frappe needed (a comma would split
`_user_tags`) is dropped; a join column has no such hazard. See GAP note below.

Source fns converted:
  * `update_tags`   -> update_tags()   (batch add/remove + activity log)
  * `apply_tag`     -> apply_tag()     (claim-or-create the master w/ colour, link)
  * `parse_tags`    -> parse_tags()    (comma string -> labels; kept 1:1)
  * core add_tag/remove_tag -> HDTicketTag insert/delete
  * `log_tag_activity` -> _log_tag_activity() (one HDTicketActivity row per batch)
Also exposes `serialize_ticket_tags()` — the tickets list serializes no tags yet
(common.ticket_row has no tag field); this is the helper that fills that in.

Tenant scope: HDTag carries tenant_id; HDTicketTag is scoped through its ticket,
which is resolved WITH the tenant filter first (an out-of-tenant id -> 404, never
touches another tenant's rows). Mutations return {"ok": true}; reads never 4xx.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDTag, HDTicket, HDTicketActivity, HDTicketTag, get_db
from ...routers.auth_router import require_auth
from .common import iso, require_edit, require_view, tenant_id

router = APIRouter()


class TagUpdate(BaseModel):
    added: Optional[list[dict]] = None   # [{"name": ..., "color": ...}]
    removed: Optional[list[str]] = None  # ["Tag1", "Tag2"]


def parse_tags(user_tags: Optional[str]) -> list[str]:
    """Frappe `parse_tags`: comma-separated `_user_tags` -> label list. Kept for
    callers importing a legacy `_user_tags` string; the native store is the join."""
    return [label.strip() for label in (user_tags or "").split(",") if label.strip()]


def _ticket(db: Session, tid: int, name: str) -> Optional[HDTicket]:
    """Tenant-scoped ticket fetch by contract `name` (integer PK as string)."""
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return db.query(HDTicket).filter(HDTicket.id == pk, HDTicket.tenant_id == tid).first()


def _claim_tag(db: Session, tid: int, label: str, color: str) -> Optional[HDTag]:
    """Frappe `apply_tag`'s master half: create the tenant's tag master if absent
    (with colour), or fill a colour it is missing; an existing coloured tag keeps
    its colour."""
    label = (label or "").strip()
    if not label:
        return None
    tag = db.query(HDTag).filter(HDTag.tenant_id == tid, HDTag.name == label).first()
    if tag is None:
        tag = HDTag(tenant_id=tid, name=label, color=color or "Gray")
        db.add(tag)
        db.flush()
    elif not tag.color:
        tag.color = color or "Gray"
    return tag


def apply_tag(db: Session, tid: int, ticket_id: int, label: str, color: str = "Gray") -> Optional[str]:
    """Frappe `apply_tag` + core `add_tag`: claim/create the master, then ensure the
    ticket↔tag join row exists. Returns the label, or None for an empty label."""
    tag = _claim_tag(db, tid, label, color)
    if tag is None:
        return None
    exists = (
        db.query(HDTicketTag)
        .filter(HDTicketTag.ticket_id == ticket_id, HDTicketTag.tag_id == tag.id)
        .first()
    )
    if not exists:
        db.add(HDTicketTag(ticket_id=ticket_id, tag_id=tag.id))
    return tag.name


def _remove_tag(db: Session, tid: int, ticket_id: int, label: str) -> None:
    """Core `remove_tag`: drop the ticket↔tag join (the master is left intact,
    matching Frappe, which only unlinks)."""
    label = (label or "").strip()
    if not label:
        return
    tag = db.query(HDTag).filter(HDTag.tenant_id == tid, HDTag.name == label).first()
    if not tag:
        return
    db.query(HDTicketTag).filter(
        HDTicketTag.ticket_id == ticket_id, HDTicketTag.tag_id == tag.id
    ).delete(synchronize_session=False)


def _log_tag_activity(db: Session, tid: int, ticket_id: int, added: list[str], removed: list[str]) -> None:
    """Frappe `log_tag_activity`: one activity entry per batch. Frappe wrote an
    Info comment; natively that feed is HDTicketActivity (see _60 model note)."""
    parts = []
    if added:
        parts.append(f"added tag{'s' if len(added) > 1 else ''} {', '.join(added)}")
    if removed:
        parts.append(f"removed tag{'s' if len(removed) > 1 else ''} {', '.join(removed)}")
    if parts:
        db.add(HDTicketActivity(tenant_id=tid, ticket_id=ticket_id, action=" & ".join(parts)))


def _ticket_tags(db: Session, ticket_id: int) -> list[HDTag]:
    return (
        db.query(HDTag)
        .join(HDTicketTag, HDTicketTag.tag_id == HDTag.id)
        .filter(HDTicketTag.ticket_id == ticket_id)
        .order_by(HDTag.name)
        .all()
    )


def serialize_ticket_tags(db: Session, ticket_id: int) -> list[dict]:
    """A ticket's tags as [{"name","color"}] — for the tickets list/detail, which
    serialize none today (common.ticket_row has no tag field)."""
    return [{"name": t.name, "color": t.color} for t in _ticket_tags(db, ticket_id)]


def update_tags(db: Session, tid: int, name: str, added: Optional[list[dict]], removed: Optional[list[str]]) -> dict:
    """Frappe `update_tags`: apply a batch of add/remove changes to one ticket and
    log the net change. Frappe returned the new `_user_tags` string; the native
    contract returns {"ok": true} (the ticket's tags are read back via the list/
    detail serializer)."""
    t = _ticket(db, tid, name)
    if not t:
        raise HTTPException(status_code=404, detail="not found")

    before = {tag.name for tag in _ticket_tags(db, t.id)}
    for tag in added or []:
        apply_tag(db, tid, t.id, tag.get("name", ""), tag.get("color") or "Gray")
    for label in removed or []:
        _remove_tag(db, tid, t.id, label)

    new_labels = [
        label for tag in (added or [])
        if (label := (tag.get("name") or "").strip()) and label not in before
    ]
    removed_present = [label for label in (removed or []) if label in before]
    _log_tag_activity(db, tid, t.id, new_labels, removed_present)
    db.commit()
    return {"ok": True}


# ─── endpoints ─────────────────────────────────────────────────────────────
@router.get("/helpdesk/tags")
def list_tags(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    """The tenant's tag master list (the picker). 200 + empty on none."""
    rows = (
        db.query(HDTag)
        .filter(HDTag.tenant_id == tenant_id(db))
        .order_by(HDTag.name)
        .all()
    )
    return {"tags": [{"name": r.name, "color": r.color, "modified": iso(r.updated_at)} for r in rows]}


@router.post("/helpdesk/tickets/{name}/tags")
def update_ticket_tags(
    name: str,
    body: TagUpdate,
    db: Session = Depends(get_db),
    _user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_edit),
):
    return update_tags(db, tenant_id(db), name, body.added, body.removed)
