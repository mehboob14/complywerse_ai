"""HD Agent Status — native conversion of the availability catalog + its guards.

Source: helpdesk/helpdesk/doctype/hd_agent_status/hd_agent_status.py
  * validate()            -> validate_default_stays_enabled  (block disabling the default)
  * on_update()           -> reset_agents_to_default         (move agents off a disabled status)
  * on_trash()            -> reject_if_default               (block deleting the default)
  * get_default_agent_status() -> the HD Settings default

Frappe read the default from the `HD Settings` singleton
(`frappe.db.get_single_value("HD Settings", "default_agent_status")`); here it is
read straight off this tenant's `grc_hd_settings` row (HDSettings.default_agent_status_id
-> HDAgentStatus). HDAgent.availability keeps Frappe's Link semantics — it stores the
status NAME string, so agents are matched/moved by `agent_status` name.

Tenant isolation mirrors replies._get_reply: the tenant_id filter is the guard, a
cross-tenant id resolves to None -> 404.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import HDAgent, HDAgentStatus, HDSettings, get_db
from .common import require_view, require_masterdata_view, require_settings_manage, tenant_id

router = APIRouter(prefix="/helpdesk/agent-statuses", tags=["Help Desk (native)"])


# ─── request bodies ────────────────────────────────────────────────────────
class AgentStatusBody(BaseModel):
    agent_status: str
    category: str = "Active"          # Active | Away | Unavailable (reqd in Frappe)
    color: str | None = None
    status_order: int | None = None
    enabled: bool = True


class AgentStatusUpdate(BaseModel):
    agent_status: str | None = None
    category: str | None = None
    color: str | None = None
    status_order: int | None = None
    enabled: bool | None = None


# ─── tenant-scoped fetch (isolation guard) ─────────────────────────────────
def _get_status(db: Session, tid: int, name: str) -> HDAgentStatus | None:
    try:
        pk = int(name)
    except (TypeError, ValueError):
        return None
    return (
        db.query(HDAgentStatus)
        .filter(HDAgentStatus.id == pk, HDAgentStatus.tenant_id == tid)
        .first()
    )


def _default_status_id(db: Session, tid: int) -> int | None:
    """The tenant's default agent-status id, read off its grc_hd_settings row."""
    s = db.query(HDSettings).filter(HDSettings.tenant_id == tid).first()
    return s.default_agent_status_id if s else None


def get_default_agent_status(db: Session, tid: int) -> str:
    """Default status NAME from HD Settings — new agents start on it, and agents
    move to it when their status is disabled. Frappe throws when unset."""
    sid = _default_status_id(db, tid)
    row = db.query(HDAgentStatus).get(sid) if sid else None
    if not row:
        raise HTTPException(status_code=400, detail="Set a default agent status in HD Settings.")
    return row.agent_status


def _reject_if_default(db: Session, tid: int, status: HDAgentStatus) -> None:
    """Block disabling/deleting the HD-Settings default (hd_agent_status.reject_if_default)."""
    if status.id == _default_status_id(db, tid):
        raise HTTPException(
            status_code=400,
            detail=f"{status.agent_status} is the default agent status. "
                   "Set a different default in HD Settings first.",
        )


def _reset_agents_to_default(db: Session, tid: int, disabled_name: str) -> None:
    """Move agents off a just-disabled status so they aren't stuck on a status the
    picker no longer shows (hd_agent_status.reset_agents_to_default). Realtime
    broadcast + in-app notification from the Frappe version are omitted (no socket
    layer natively)."""
    agents = (
        db.query(HDAgent)
        .filter(HDAgent.tenant_id == tid, HDAgent.availability == disabled_name)
        .all()
    )
    if not agents:
        return
    default_name = get_default_agent_status(db, tid)
    for a in agents:
        a.availability = default_name


# ─── read ──────────────────────────────────────────────────────────────────
def list_agent_statuses(db: Session, tid: int) -> dict:
    rows = (
        db.query(HDAgentStatus)
        .filter(HDAgentStatus.tenant_id == tid)
        .order_by(HDAgentStatus.status_order.asc(), HDAgentStatus.agent_status.asc())
        .all()
    )
    default_id = _default_status_id(db, tid)
    return {"agent_statuses": [{
        "name": str(r.id),
        "agent_status": r.agent_status,
        "category": r.category,
        "color": r.color,
        "status_order": r.status_order,
        "enabled": bool(r.enabled),
        "is_default": r.id == default_id,
    } for r in rows]}


# ─── CRUD ────────────────────────────────────────────────────────────────────
def create_agent_status(db: Session, tid: int, payload: dict) -> dict:
    row = HDAgentStatus(
        tenant_id=tid,
        agent_status=payload.get("agent_status"),
        category=payload.get("category") or "Active",
        color=payload.get("color"),
        status_order=payload.get("status_order"),
        enabled=payload.get("enabled", True),
    )
    db.add(row)
    db.commit()
    return {"ok": True, "name": str(row.id)}


def update_agent_status(db: Session, tid: int, name: str, payload: dict) -> dict:
    row = _get_status(db, tid, name)
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    old_name, old_enabled = row.agent_status, bool(row.enabled)
    new_enabled = payload.get("enabled")
    disabling = new_enabled is False and old_enabled

    # validate(): the default must stay enabled.
    if disabling:
        _reject_if_default(db, tid, row)

    for field in ("agent_status", "category", "color", "status_order", "enabled"):
        if payload.get(field) is not None:
            setattr(row, field, payload[field])

    # agent.availability is a bare name pointer — keep it from dangling on rename.
    if row.agent_status != old_name:
        for a in db.query(HDAgent).filter(
            HDAgent.tenant_id == tid, HDAgent.availability == old_name
        ):
            a.availability = row.agent_status

    # on_update(): cascade agents off a now-disabled status.
    if disabling:
        _reset_agents_to_default(db, tid, row.agent_status)

    db.commit()
    return {"ok": True}


def delete_agent_status(db: Session, tid: int, name: str) -> dict:
    row = _get_status(db, tid, name)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    _reject_if_default(db, tid, row)            # on_trash(): reject_if_default
    db.delete(row)
    db.commit()
    return {"ok": True}


# ─── endpoints ───────────────────────────────────────────────────────────────
@router.get("")
def list_statuses(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return list_agent_statuses(db, tenant_id(db))


@router.post("")
def create_status(body: AgentStatusBody, db: Session = Depends(get_db),
                  _: bool = Depends(require_settings_manage)):
    return create_agent_status(db, tenant_id(db), body.model_dump())


@router.put("/{name}")
def edit_status(name: str, body: AgentStatusUpdate, db: Session = Depends(get_db),
                _: bool = Depends(require_settings_manage)):
    return update_agent_status(db, tenant_id(db), name, body.model_dump(exclude_unset=True))


@router.delete("/{name}")
def remove_status(name: str, db: Session = Depends(get_db), _: bool = Depends(require_settings_manage)):
    return delete_agent_status(db, tenant_id(db), name)
