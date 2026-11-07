"""Impacted-CI linkage (Batch 4 linkage B) — the SET of CIs a ticket impacts,
beyond its single primary grc_hd_ticket.ci_id.

A change usually touches more than one configuration item. This adds a tenant-
scoped bridge (grc_hd_ticket_ci) the agent fills in on the change, the ticket
detail carries the impacted CIs, and — most importantly — the CAB exposure
escalation (approvals.requirements_for_change) considers EVERY impacted CI, not
just the primary one, so a change is forced to CAB when ANY impacted CI (or a CI
contained under it) is internet-facing / PCI.

Validation + tenant scoping reuse tickets._validate_ci (CI must exist in this
tenant and not be retired) and cmdb_admin.ci_ticket_ref / ci_exposure_flags, so
the impacted CIs render and escalate exactly like the primary one.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDTicketCI, get_db
from ...routers.auth_router import require_auth
from . import tickets, cmdb_admin
from .audit import hd_audit
from .common import require_processes_manage, require_processes_view, tenant_id

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


# ─── domain ──────────────────────────────────────────────────────────────────
def impacted_ci_ids(db: Session, tid: int, ticket) -> set:
    """Every CI this ticket impacts: its primary ci_id (when set) + the bridge
    CIs. A set, so the primary is never double-counted."""
    ids = set()
    if ticket.ci_id:
        ids.add(ticket.ci_id)
    for (cid,) in (db.query(HDTicketCI.ci_id)
                   .filter(HDTicketCI.tenant_id == tid, HDTicketCI.ticket_id == ticket.id)
                   .all()):
        ids.add(cid)
    return ids


def impacted_exposure(db: Session, tid: int, ticket) -> Optional[dict]:
    """internet_facing / pci ORed over EVERY impacted CI (primary + bridge), each
    rolled up over its CMDB descendants (cmdb_admin.ci_exposure_flags). None when
    the ticket impacts no resolvable CI — so a change with no CI behaves exactly
    as before. The CAB escalation calls this in place of the single-CI check."""
    internet = pci = False
    saw = False
    for cid in impacted_ci_ids(db, tid, ticket):
        flags = cmdb_admin.ci_exposure_flags(db, tid, cid)
        if flags is None:
            continue
        saw = True
        internet = internet or bool(flags["internet_facing"])
        pci = pci or bool(flags["pci"])
    if not saw:
        return None
    return {"internet_facing": internet, "pci": pci}


def list_impacted(db: Session, tid: int, ticket) -> list:
    """Compact CI refs (cmdb_admin.ci_ticket_ref — exposure + the ci.security
    snapshot) for the BRIDGE CIs, newest-linked last. The primary ci_id keeps its
    own `ci` object on the detail; this is the additional set."""
    rows = (db.query(HDTicketCI)
            .filter(HDTicketCI.tenant_id == tid, HDTicketCI.ticket_id == ticket.id)
            .order_by(HDTicketCI.id.asc())
            .all())
    return [cmdb_admin.ci_ticket_ref(r.ci) for r in rows if r.ci is not None]


def add_impacted(db: Session, tid: int, name: str, ci_id: int,
                 actor_email: Optional[str] = None) -> dict:
    """Link an impacted CI to a ticket (idempotent on the unique pair). The CI
    must exist in this tenant and not be retired (tickets._validate_ci → 400)."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"ok": False, "error": "not found"}
    ci = tickets._validate_ci(db, tid, ci_id)   # 400 on cross-tenant / retired
    existing = (db.query(HDTicketCI)
                .filter(HDTicketCI.tenant_id == tid, HDTicketCI.ticket_id == ticket.id,
                        HDTicketCI.ci_id == ci.id)
                .first())
    if existing is None:
        db.add(HDTicketCI(tenant_id=tid, ticket_id=ticket.id, ci_id=ci.id))
        db.commit()
        hd_audit(db, tenant_id=tid, actor_email=actor_email, action="ticket.impacted_ci.add",
                 entity="ticket", entity_id=ticket.id, after={"ci_id": ci.id})
    return {"ok": True}


def remove_impacted(db: Session, tid: int, name: str, ci_id: int,
                    actor_email: Optional[str] = None) -> dict:
    """Unlink an impacted CI (idempotent — a missing pair is a no-op)."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"ok": False, "error": "not found"}
    row = (db.query(HDTicketCI)
           .filter(HDTicketCI.tenant_id == tid, HDTicketCI.ticket_id == ticket.id,
                   HDTicketCI.ci_id == ci_id)
           .first())
    if row is not None:
        db.delete(row)
        db.commit()
        hd_audit(db, tenant_id=tid, actor_email=actor_email, action="ticket.impacted_ci.remove",
                 entity="ticket", entity_id=ticket.id, after={"ci_id": ci_id})
    return {"ok": True}


# ─── routes ────────────────────────────────────────────────────────────────
class ImpactedCI(BaseModel):
    ci_id: int


@router.get("/tickets/{name}/impacted-cis")
def get_impacted(name: str, db: Session = Depends(get_db),
                 _: bool = Depends(require_processes_view)):
    tid = tenant_id(db)
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket:
        return {"impacted_cis": []}
    return {"impacted_cis": list_impacted(db, tid, ticket)}


@router.post("/tickets/{name}/impacted-cis")
def post_impacted(name: str, body: ImpactedCI, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    return add_impacted(db, tenant_id(db), name, body.ci_id, current_user.email)


@router.delete("/tickets/{name}/impacted-cis/{ci_id}")
def delete_impacted(name: str, ci_id: int, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth),
                    _: bool = Depends(require_processes_manage)):
    return remove_impacted(db, tenant_id(db), name, ci_id, current_user.email)
