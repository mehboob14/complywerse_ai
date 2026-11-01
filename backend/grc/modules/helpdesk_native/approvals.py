"""Approvals engine (flow #3) — ONE engine for both service-request sign-offs and
Change Advisory Board (CAB) decisions.

An HDApproval is attached to the ticket it gates; approvers cast HDApprovalVote
rows (one per approver). The approval is decided when the votes satisfy its
quorum AND every required role has approved (CAB), or immediately rejected the
moment any vote rejects (one reject fails it). On decision the ticket's
`approval_state` is bridged to 'approved' / 'rejected' so BOTH the existing change
lifecycle (change.py) and the #2 state-machine guard (guard='approved') observe
the outcome. While pending, the ticket sits in 'pending_approval' and the #2
guard blocks it from advancing — that is the "hold until quorum".

Pure data layer: no HTTP, no other tenants. Endpoint wiring is a later step; this
module is the engine those endpoints (and the CAB board UI) will call.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    GRCUser,
    HDApproval,
    HDApprovalVote,
    HDCABConfig,
    HDChangeType,
    HDChangeRiskMatrix,
    HDRoleMap,
    HDStateTransition,
    HDTicket,
    HDTicketStatus,
    Role,
    UserRole,
)

# ITIL default CAB: a quorum of 3 that MUST include the Change Manager and the
# Service Owner. Overridable per call (e.g. from HDCABConfig) — these are the
# fallback when the caller passes nothing.
DEFAULT_CAB_QUORUM = 3
DEFAULT_CAB_ROLES = ("ROLE-CHGMGR", "ROLE-SVCOWN")

_DECISIONS = ("approve", "reject", "abstain")


# ─── governance wiring: CAB config quorum + role-map resolution ──────────────
def _cab_quorum(db: Session, tid: int) -> int:
    """CAB quorum from the governance CAB config (the 'Quorum' item's detail), so
    editing it in Governance → CAB config actually changes enforcement. Falls back
    to DEFAULT_CAB_QUORUM. shortcut: the detail is free text, so the first integer
    in it is the quorum — upgrade to a structured column if CAB config gains one."""
    try:
        row = (db.query(HDCABConfig)
               .filter(HDCABConfig.tenant_id == tid, HDCABConfig.item.ilike("%quorum%"))
               .order_by(HDCABConfig.sort_order.asc().nullslast(), HDCABConfig.id.asc())
               .first())
    except Exception:  # noqa: BLE001 — no CAB config table (e.g. unit-test DB)
        row = None
    if row and row.detail:
        m = re.search(r"\d+", row.detail)
        if m:
            return max(1, int(m.group()))
    return DEFAULT_CAB_QUORUM


def _user_role_codes(db: Session, tid: int, email: Optional[str]) -> set:
    """The ROLE-* codes a user truly holds = their ComplyVerse RBAC role names resolved
    through HDRoleMap.rbac_preset (Governance → Roles). Empty if unknown/unmapped."""
    if not email:
        return set()
    try:
        rbac = {n for (n,) in
                db.query(Role.name)
                .join(UserRole, UserRole.role_id == Role.id)
                .join(GRCUser, GRCUser.id == UserRole.user_id)
                .filter(UserRole.tenant_id == tid,
                        func.lower(GRCUser.email) == email.lower()).all()}
        if not rbac:
            return set()
        return {r.code for r in
                db.query(HDRoleMap)
                .filter(HDRoleMap.tenant_id == tid, HDRoleMap.rbac_preset.in_(rbac)).all()}
    except Exception:  # noqa: BLE001 — no users/role-map tables (e.g. unit-test DB)
        return set()


def open_approval(db: Session, tid: int, ticket: HDTicket, *, kind: str = "request",
                  required_quorum: int = 1, required_role_codes=None,
                  opened_by: Optional[str] = None) -> HDApproval:
    """Open a pending approval on `ticket` and park it in 'pending_approval'.
    kind: 'request' (single sign-off) | 'cab' | 'ecab'."""
    ap = HDApproval(
        tenant_id=tid, ticket_id=ticket.id, kind=kind,
        required_quorum=max(1, int(required_quorum or 1)),
        required_role_codes=list(required_role_codes) if required_role_codes else None,
        state="pending", opened_by=opened_by, opened_at=datetime.utcnow(),
    )
    db.add(ap)
    db.flush()
    ticket.approval_state = "pending_approval"
    _park_in_waiting(db, tid, ticket)
    db.flush()
    return ap


def cast_vote(db: Session, tid: int, approval_id: int, approver: str, decision: str,
              *, role: Optional[str] = None, comment: Optional[str] = None) -> HDApproval:
    """Record one approver's decision (one vote per approver — a re-vote updates in
    place) and re-evaluate. Votes on an already-decided approval are ignored."""
    ap = db.query(HDApproval).filter_by(id=approval_id, tenant_id=tid).first()
    if ap is None:
        raise ValueError("approval not found")
    if ap.state != "pending":
        return ap  # already decided — late votes are a no-op
    d = (decision or "").strip().lower()
    if d not in _DECISIONS:
        raise ValueError(f"decision must be one of {_DECISIONS}")
    vote = db.query(HDApprovalVote).filter_by(approval_id=ap.id, approver=approver).first()
    if vote is None:
        vote = HDApprovalVote(approval_id=ap.id, approver=approver)
        db.add(vote)
    # for a role-gated (CAB) approval, stamp the voter's real role resolved from
    # RBAC via the role map when they didn't declare one, so the gate reflects
    # identity, not self-claim. SR sign-offs (no required roles) don't touch it.
    if not role and ap.required_role_codes:
        role = next(iter(sorted(_user_role_codes(db, tid, approver))), None)
    vote.approver_role = role
    vote.decision = d
    vote.comment = comment
    vote.voted_at = datetime.utcnow()
    db.flush()
    _evaluate(db, ap)
    return ap


def _evaluate(db: Session, ap: HDApproval) -> None:
    """Decide the approval from its votes: any reject fails it; otherwise it passes
    when approve-votes meet the quorum AND every required role has approved."""
    votes = db.query(HDApprovalVote).filter_by(approval_id=ap.id).all()
    if any((v.decision or "") == "reject" for v in votes):
        _decide(db, ap, "rejected")
        return
    approvers = [v for v in votes if (v.decision or "") == "approve"]
    roles_ok = True
    if ap.required_role_codes:
        # a required role is satisfied by an approver who either declared it on the
        # vote OR truly holds it (resolved from RBAC via Governance → Roles) — the
        # role map augments the self-declared role, it doesn't replace it.
        have: set = set()
        for v in approvers:
            if v.approver_role:
                have.add(v.approver_role)
            have |= _user_role_codes(db, ap.tenant_id, v.approver)
        roles_ok = all(r in have for r in ap.required_role_codes)
    if len(approvers) >= (ap.required_quorum or 1) and roles_ok:
        _decide(db, ap, "approved")


def _decide(db: Session, ap: HDApproval, state: str) -> None:
    ap.state = state
    ap.decided_at = datetime.utcnow()
    ticket = db.query(HDTicket).filter_by(id=ap.ticket_id, tenant_id=ap.tenant_id).first()
    if ticket is not None:
        ticket.approval_state = "approved" if state == "approved" else "rejected"
        _release_from_waiting(db, ap.tenant_id, ticket, approved=(state == "approved"))
    db.flush()


# ─── status ↔ approval bridge (flow #3): keep the ticket STATUS in step with the
# approval outcome, using ONLY the seeded state machine so behaviour tracks the
# tenant's authored workflow and un-seeded tenants are unchanged. ──────────────
def _park_in_waiting(db: Session, tid: int, ticket: HDTicket) -> None:
    """Opening an approval parks the ticket in its process's approval-waiting
    status — the Paused status reachable from where it sits (service_request
    Submitted→Pending Approval). No-op when the process has no such transition
    (e.g. change at 'Draft', whose approval lifecycle is approval_state-driven),
    so this never disturbs the change flow."""
    from . import tickets  # lazy: tickets does not import approvals
    cur = ticket.status
    if cur is None:
        return
    waiting = _seeded_target(db, tid, ticket, cur.id, category="Paused")
    if waiting is not None:
        ok, _ = tickets.transition_allowed(db, tid, ticket, waiting)
        if ok:
            tickets._apply_status_change(db, tid, ticket, waiting)


def _release_from_waiting(db: Session, tid: int, ticket: HDTicket, *, approved: bool) -> None:
    """Deciding an approval releases a ticket PARKED in a waiting (Paused) status
    to the next workflow status: approved → the forward Open status (Pending
    Approval→Approved), rejected → the 'Rejected' status. Gated on the ticket
    actually sitting in a Paused status, so a change (status still Open) is never
    auto-moved — its status close stays an explicit agent action."""
    from . import tickets  # lazy
    cur = ticket.status
    if cur is None or (cur.category or "") != "Paused":
        return
    if approved:
        target = _seeded_target(db, tid, ticket, cur.id, category="Open")
    else:
        target = _seeded_target(db, tid, ticket, cur.id, category="Resolved", label="Rejected")
    if target is not None:
        ok, _ = tickets.transition_allowed(db, tid, ticket, target)
        if ok:
            tickets._apply_status_change(db, tid, ticket, target)


def _seeded_target(db: Session, tid: int, ticket: HDTicket, from_status_id: int,
                   *, category: str, label: Optional[str] = None) -> Optional[HDTicketStatus]:
    """Lowest-order status of `category` reachable from `from_status_id` via a
    seeded transition for this ticket's process (optionally pinned to one label)."""
    q = (db.query(HDTicketStatus)
         .join(HDStateTransition, HDStateTransition.to_status_id == HDTicketStatus.id)
         .filter(HDStateTransition.tenant_id == tid,
                 HDStateTransition.process == (ticket.process or "incident"),
                 HDStateTransition.from_status_id == from_status_id,
                 HDTicketStatus.tenant_id == tid,
                 HDTicketStatus.category == category))
    if label is not None:
        q = q.filter(HDTicketStatus.label_agent == label)
    return q.order_by(HDTicketStatus.order.asc()).first()


def requirements_for_change(db: Session, tid: int, ticket: HDTicket) -> Optional[dict]:
    """Decide whether a change needs CAB, and the quorum/roles/kind, from the
    tenant's seeded change_type + risk matrix. Returns None when NO approval is
    needed (a Standard / pre-authorised change), else the kwargs for open_approval.

    A Standard change with auto_approve skips CAB; a Normal/Major needs it; an
    Emergency needs an ECAB. A risk level flagged cab_required forces CAB even when
    the change type alone would not.

    Exposure-aware escalation (phase-2 §4): a change that would otherwise
    auto-approve is forced to CAB when its affected CI — or any CI contained under
    it (a domain's endpoints) — is internet-facing or PCI, and the reason is
    returned as `escalation_reason` so the caller can persist + surface it."""
    ct_code = (ticket.change_type or "").strip().lower()
    ct = (db.query(HDChangeType).filter_by(tenant_id=tid, code=ct_code).first()
          if ct_code else None)
    needs = True
    if ct is not None:
        if ct.auto_approve and not ct.requires_cab:
            needs = False
        else:
            needs = bool(ct.requires_cab)
    risk = (ticket.change_risk or "").strip().lower()
    if risk:
        rm = (db.query(HDChangeRiskMatrix)
              .filter(HDChangeRiskMatrix.tenant_id == tid,
                      func.lower(HDChangeRiskMatrix.risk_level) == risk)
              .first())
        if rm is not None and rm.cab_required:
            needs = True

    # A would-be-auto-approved change on an exposed CI escalates to CAB. The
    # exposure is unioned over EVERY impacted CI (primary ci_id + the Batch 4
    # grc_hd_ticket_ci bridge), so a change escalates when ANY impacted CI — or a
    # CI contained under it — is internet-facing / PCI, even if the primary is not.
    escalation_reason = None
    if not needs:
        from . import ticket_cis  # lazy: avoid import cycle
        flags = ticket_cis.impacted_exposure(db, tid, ticket)
        if flags and (flags["internet_facing"] or flags["pci"]):
            needs = True
            escalation_reason = _exposure_escalation_reason(flags)

    if not needs:
        return None
    kind = "ecab" if ct_code == "emergency" else "cab"
    return {"kind": kind, "required_quorum": _cab_quorum(db, tid),
            "required_role_codes": list(DEFAULT_CAB_ROLES),
            "escalation_reason": escalation_reason}


def _exposure_escalation_reason(flags: dict) -> str:
    """Human-readable CAB escalation reason from the exposure flags, e.g.
    "CAB required: CI is internet-facing + PCI"."""
    bits = []
    if flags.get("internet_facing"):
        bits.append("internet-facing")
    if flags.get("pci"):
        bits.append("PCI")
    return "CAB required: CI is " + " + ".join(bits)


def approval_detail(db: Session, tid: int, ticket_id: int) -> Optional[dict]:
    """Full approval + vote tally for a ticket — the agent CAB read surface.

    Returns None when the ticket has no approval. Unlike the portal's
    `_approval_summary` (which hides voter identities from the requester), this
    lists every vote (who, decision, role, comment) plus quorum progress and the
    required CAB roles, so the agent ticket-detail view can show the board's
    state instead of just Approve/Reject buttons (flow #4)."""
    ap = (db.query(HDApproval)
          .filter(HDApproval.tenant_id == tid, HDApproval.ticket_id == ticket_id)
          .order_by(HDApproval.id.desc())
          .first())
    if ap is None:
        return None
    votes = db.query(HDApprovalVote).filter_by(approval_id=ap.id).all()
    approve_count = sum(1 for v in votes if (v.decision or "") == "approve")
    reject_count = sum(1 for v in votes if (v.decision or "") == "reject")
    return {
        "id": ap.id, "kind": ap.kind, "state": ap.state,
        "required_quorum": ap.required_quorum,
        "required_role_codes": ap.required_role_codes,
        "approve_count": approve_count, "reject_count": reject_count,
        "opened_at": ap.opened_at.isoformat() if ap.opened_at else None,
        "decided_at": ap.decided_at.isoformat() if ap.decided_at else None,
        "votes": [{
            "approver": v.approver,
            "role": v.approver_role,
            "decision": v.decision,
            "comment": v.comment,
            "at": v.created_at.isoformat() if getattr(v, "created_at", None) else None,
        } for v in votes],
    }
