"""Changes — the approval workflow over the shared ticket engine (spec §5).

A change is an HDTicket with process='change'; its lifecycle is the
`approval_state` column: draft → pending_approval → approved → scheduled →
in_progress → review → closed, plus reject (from pending_approval) and a
cancel-from-anywhere. Each action resolves its target state against an
allowed-transition map and rejects an illegal move with 400 — the same shape as
tickets.is_valid_status_transition. Writes route through Agent A's
`update_ticket`; `complete` also closes the ticket itself (status 'Closed'),
and `approve` stamps the signed-in agent + time.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDApproval, HDTicket, get_db
from ...routers.auth_router import require_auth
from . import tickets, approvals, sla  # write path + approvals/SLA engines; resolve at call time
from .audit import hd_audit
from .common import require_processes_manage, require_processes_view, tenant_id

router = APIRouter(prefix="/helpdesk/changes", tags=["Help Desk (native)"])

DRAFT = "draft"

# action -> (allowed-from states, resulting approval_state). `None` allowed-from
# means "any state" (cancel). A move whose current state is not in allowed-from
# is rejected with 400, mirroring tickets.is_valid_status_transition.
TRANSITIONS = {
    "submit":   ({"draft"}, "pending_approval"),
    "approve":  ({"pending_approval"}, "approved"),
    "reject":   ({"pending_approval"}, "rejected"),
    "schedule": ({"approved"}, "scheduled"),
    "start":    ({"scheduled"}, "in_progress"),
    "review":   ({"in_progress"}, "review"),
    "complete": ({"review"}, "closed"),
    "cancel":   (None, "cancelled"),
}


def _target_state(action: str, current: str) -> str:
    """Resulting approval_state for `action` from `current`, or 400 on an illegal
    move. Pure — the self-check exercises it with no DB."""
    allowed_from, to_state = TRANSITIONS[action]
    if allowed_from is not None and current not in allowed_from:
        raise HTTPException(status_code=400,
                            detail=f"Cannot {action} a change in state '{current}'")
    return to_state


def _get_change(db: Session, tid: int, cid: int) -> Optional[HDTicket]:
    return (
        db.query(HDTicket)
        .filter(HDTicket.id == cid, HDTicket.tenant_id == tid)
        .first()
    )


def _sync_terminal_status(db: Session, tid: int, cid: int, label: str) -> None:
    """Move a change's TICKET status to its terminal label (Closed/Cancelled) and
    close the SLA clock. A change's authoritative lifecycle is `approval_state`; its
    ticket-status track is disjoint (it may sit at 'Approved', not in the change
    status chain), so there's no seeded transition into 'Closed' — we set it
    directly and recompute the SLA here, which stamps the resolution. Idempotent."""
    ticket = _get_change(db, tid, cid)
    st = tickets._status_by_label(db, tid, label)
    if not ticket or not st or ticket.status_id == st.id:
        return
    old_cat = ticket.status_category
    ticket.status_id = st.id
    ticket.status_category = st.category
    if st.category == tickets.RESOLVED and ticket.resolution_date is None:
        ticket.resolution_date = datetime.utcnow()
    try:
        sla.recompute(db, ticket, prev_status_category=old_cat)
    except Exception:  # noqa: BLE001 — SLA close must never block the state change
        pass
    db.commit()


def _apply(db: Session, tid: int, cid: int, action: str,
           extra: Optional[dict] = None, actor_email: Optional[str] = None) -> dict:
    """Fetch, guard the transition (400 if illegal), write the new approval_state
    (+ any extra extension fields) through Agent A's update_ticket, then record the
    process action in the central audit log (before→after approval_state)."""
    ticket = _get_change(db, tid, cid)
    if not ticket:
        return {"ok": False, "error": "not found"}
    from_state = ticket.approval_state or DRAFT
    to_state = _target_state(action, from_state)  # may raise 400
    payload = {"approval_state": to_state}
    if extra:
        payload.update(extra)
    r = tickets.update_ticket(db, tid, cid, payload)
    if r.get("ok"):
        hd_audit(
            db, tenant_id=tid, actor_email=actor_email,
            action=f"change.{action}", entity="change", entity_id=cid,
            before={"approval_state": from_state},
            after={"approval_state": to_state},
        )
    return r


# ─── approvals / CAB wire-up (flow #3+#4 → live change flow) ──────────────────
class VoteBody(BaseModel):
    role: Optional[str] = None       # the ROLE-* the approver is voting as (CAB)
    comment: Optional[str] = None


def _open_approval(db: Session, tid: int, cid: int) -> Optional[HDApproval]:
    """The pending approval gating this change, if any."""
    return (db.query(HDApproval)
            .filter(HDApproval.tenant_id == tid, HDApproval.ticket_id == cid,
                    HDApproval.state == "pending")
            .order_by(HDApproval.id.desc())
            .first())


def submit_and_route(db: Session, tid: int, cid: int, actor_email: Optional[str]) -> dict:
    """Submit a change, then route it: a Standard/pre-authorised change (no CAB
    needed per the seeded rules) auto-approves; anything else opens a CAB/ECAB
    approval and FREEZES the SLA clock while it waits (approval_state drives the
    SLA pause in sla.recompute)."""
    r = _apply(db, tid, cid, "submit", actor_email=actor_email)
    if not r.get("ok"):
        return r
    change = _get_change(db, tid, cid)
    req = approvals.requirements_for_change(db, tid, change)
    if req is None:
        _apply(db, tid, cid, "approve",
               {"approved_by": "system:auto-standard", "approved_at": datetime.utcnow()},
               actor_email=actor_email)
        return {"ok": True, "approval_state": "approved", "cab": False, "auto_approved": True}
    ap = approvals.open_approval(db, tid, change, kind=req["kind"],
                                 required_quorum=req["required_quorum"],
                                 required_role_codes=req["required_role_codes"],
                                 opened_by=actor_email)
    # phase-2 §4: when the CAB was forced by CI exposure, record WHY on the change
    # itself so the change list/detail + UI read it with no extra join.
    escalation_reason = req.get("escalation_reason")
    if escalation_reason:
        change.escalation_reason = escalation_reason
    try:
        sla.recompute(db, change, prev_status_category=change.status_category)
    except Exception:  # noqa: BLE001 — SLA pause must never block opening the CAB
        pass
    db.commit()
    hd_audit(db, tenant_id=tid, actor_email=actor_email, action="change.cab_opened",
             entity="change", entity_id=cid,
             after={"kind": ap.kind, "required_quorum": ap.required_quorum,
                    "escalation_reason": escalation_reason})
    return {"ok": True, "approval_state": "pending_approval", "cab": True,
            "approval_id": ap.id, "required_quorum": ap.required_quorum,
            "escalation_reason": escalation_reason}


def vote(db: Session, tid: int, cid: int, actor_email: Optional[str], decision: str,
         role: Optional[str] = None, comment: Optional[str] = None) -> dict:
    """Cast an approve/reject on the change's open approval (CAB), resuming the SLA
    clock once the approval is decided. Segregation of duties: the voter must not
    be the change's raiser. With no open approval, falls back to the legacy
    single-approver action so older changes still work."""
    change = _get_change(db, tid, cid)
    if not change:
        return {"ok": False, "error": "not found"}
    raiser = (change.raised_by or "").strip().lower()
    if raiser and raiser == (actor_email or "").strip().lower():
        raise HTTPException(status_code=400,
                            detail="You cannot vote on a change you raised (segregation of duties).")
    ap = _open_approval(db, tid, cid)
    if ap is None:
        extra = ({"approved_by": actor_email, "approved_at": datetime.utcnow()}
                 if decision == "approve" else None)
        return _apply(db, tid, cid, decision, extra, actor_email=actor_email)
    approvals.cast_vote(db, tid, ap.id, actor_email, decision, role=role, comment=comment)
    db.refresh(change)
    if change.approval_state in ("approved", "rejected"):
        try:
            sla.recompute(db, change, prev_status_category=change.status_category)
        except Exception:  # noqa: BLE001
            pass
    db.commit()
    hd_audit(db, tenant_id=tid, actor_email=actor_email, action=f"change.vote.{decision}",
             entity="change", entity_id=cid,
             after={"approval_state": change.approval_state, "approval_id": ap.id})
    return {"ok": True, "approval_state": change.approval_state, "approval_id": ap.id}


class ScheduleBody(BaseModel):
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None


class OriginBody(BaseModel):
    # the incident/problem this change was raised from (Batch 4 linkage A)
    origin_ticket_id: int


def set_origin(db: Session, tid: int, cid: int, origin_ticket_id: Optional[int],
               actor_email: Optional[str] = None) -> dict:
    """Link (or, with None, unlink) the incident/problem a change originated from.
    Validates both tickets are in THIS tenant, the target is an incident or
    problem, and the change does not originate from itself; infers origin_process
    from the target. Writes through Agent A's update_ticket."""
    change = _get_change(db, tid, cid)
    if not change:
        return {"ok": False, "error": "not found"}
    if (change.process or "") != "change":
        raise HTTPException(status_code=400, detail="origin can only be set on a change")

    if origin_ticket_id is None:
        payload = {"origin_ticket_id": None, "origin_process": None}
    else:
        origin = (db.query(HDTicket)
                  .filter(HDTicket.id == origin_ticket_id, HDTicket.tenant_id == tid)
                  .first())
        if origin is None:
            raise HTTPException(status_code=400,
                                detail="origin ticket does not exist in this tenant")
        if origin.id == change.id:
            raise HTTPException(status_code=400, detail="a change cannot originate from itself")
        op = (origin.process or "incident")
        if op not in ("incident", "problem"):
            raise HTTPException(status_code=400,
                                detail="a change can only originate from an incident or problem")
        payload = {"origin_ticket_id": origin.id, "origin_process": op}

    r = tickets.update_ticket(db, tid, cid, payload)
    if r.get("ok"):
        hd_audit(db, tenant_id=tid, actor_email=actor_email, action="change.set_origin",
                 entity="change", entity_id=cid, after=payload)
    return r


@router.get("")
def list_changes(db: Session = Depends(get_db), _: bool = Depends(require_processes_view)):
    return tickets.list_tickets(db, tenant_id(db), process="change")


@router.post("/{cid}/submit")
def submit_change(cid: int, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    return submit_and_route(db, tenant_id(db), cid, current_user.email)


@router.post("/{cid}/approve")
def approve_change(cid: int, body: Optional[VoteBody] = None, db: Session = Depends(get_db),
                   current_user: GRCUser = Depends(require_auth),
                   _: bool = Depends(require_processes_manage)):
    return vote(db, tenant_id(db), cid, current_user.email, "approve",
                role=(body.role if body else None), comment=(body.comment if body else None))


@router.post("/{cid}/reject")
def reject_change(cid: int, body: Optional[VoteBody] = None, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    return vote(db, tenant_id(db), cid, current_user.email, "reject",
                role=(body.role if body else None), comment=(body.comment if body else None))


@router.post("/{cid}/schedule")
def schedule_change(cid: int, body: ScheduleBody, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth),
                    _: bool = Depends(require_processes_manage)):
    return _apply(db, tenant_id(db), cid, "schedule",
                  {"planned_start": body.planned_start, "planned_end": body.planned_end},
                  actor_email=current_user.email)


@router.post("/{cid}/start")
def start_change(cid: int, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth),
                 _: bool = Depends(require_processes_manage)):
    return _apply(db, tenant_id(db), cid, "start", actor_email=current_user.email)


@router.post("/{cid}/review")
def review_change(cid: int, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    return _apply(db, tenant_id(db), cid, "review", actor_email=current_user.email)


@router.post("/{cid}/complete")
def complete_change(cid: int, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth),
                    _: bool = Depends(require_processes_manage)):
    # Set approval_state=closed, then ACTUALLY close the ticket via the label path
    # (tickets.update → _apply_status_change → SLA recompute). update_ticket only
    # writes extension fields, so the status close must go through update().
    tid = tenant_id(db)
    r = _apply(db, tid, cid, "complete", actor_email=current_user.email)
    if r.get("ok"):
        _sync_terminal_status(db, tid, cid, "Closed")
    return r


@router.post("/{cid}/cancel")
def cancel_change(cid: int, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    tid = tenant_id(db)
    r = _apply(db, tid, cid, "cancel", actor_email=current_user.email)
    if r.get("ok"):
        _sync_terminal_status(db, tid, cid, "Cancelled")
    return r


@router.post("/{cid}/link-origin")
def link_origin(cid: int, body: OriginBody, db: Session = Depends(get_db),
                current_user: GRCUser = Depends(require_auth),
                _: bool = Depends(require_processes_manage)):
    return set_origin(db, tenant_id(db), cid, body.origin_ticket_id, current_user.email)


@router.post("/{cid}/unlink-origin")
def unlink_origin(cid: int, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth),
                  _: bool = Depends(require_processes_manage)):
    return set_origin(db, tenant_id(db), cid, None, current_user.email)


if __name__ == "__main__":  # pure transition-map self-check, no DB
    from fastapi import HTTPException as _HE

    legal = [("submit", "draft"), ("approve", "pending_approval"),
             ("schedule", "approved"), ("start", "scheduled"),
             ("review", "in_progress"), ("complete", "review"),
             ("reject", "pending_approval")]
    for action, frm in legal:
        assert _target_state(action, frm) == TRANSITIONS[action][1], (action, frm)
    # cancel from anywhere
    for frm in ("draft", "approved", "in_progress", "review"):
        assert _target_state("cancel", frm) == "cancelled"
    # illegal moves → 400
    for action, bad in [("approve", "draft"), ("start", "approved"),
                        ("complete", "in_progress"), ("submit", "approved"),
                        ("reject", "approved")]:
        try:
            _target_state(action, bad)
        except _HE as e:
            assert e.status_code == 400
        else:
            raise AssertionError(f"{action} from {bad} should be illegal")
    print("change.py transition map OK")
