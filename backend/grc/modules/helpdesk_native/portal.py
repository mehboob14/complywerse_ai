"""Requester portal — the end-user surface of Help Desk.

A normal employee (a "requester") can raise a request, track ONLY their own
requests, reply on them, and browse the self-service catalog / request library
/ knowledge base. This is the non-agent view: every endpoint is gated by the
`helpdesk:requests:*` perms (which a requester-only role has but the agent
`helpdesk:tickets:*` perms it does NOT), and own-ticket isolation is enforced
server-side on `raised_by == current_user.email` — the client is never trusted
to say whose tickets it wants. Administrator + primary-contact bypass the gate
as everywhere, which is fine.

Tenant isolation is inherited from get_db (DB-per-tenant) + tenant_id(db); the
extra layer here is the per-USER filter.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import (
    get_db,
    HDApproval,
    HDApprovalVote,
    HDBusinessService,
    HDCIType,
    HDConfigurationItem,
    HDIncidentCategory,
    HDRequestItem,
    HDServiceCategory,
    HDTicket,
    HDTicketFeedbackOption,
)
from . import department, kb, itsm_seed, tickets, approvals, sla
from .common import (
    current_user_email,
    require_request_create,
    require_requester,
    tenant_id,
)

router = APIRouter(prefix="/helpdesk/portal", tags=["Help Desk (requester portal)"])


# ─── request bodies ──────────────────────────────────────────────────────
class RequestCreate(BaseModel):
    subject: str
    description: Optional[str] = None
    process: Optional[str] = None          # defaults to 'incident' in create_ticket
    department_id: Optional[int] = None    # routed to a Team, like the agent form
    impact: Optional[str] = None           # feeds the priority matrix
    urgency: Optional[str] = None
    request_category: Optional[str] = None
    request_subcategory: Optional[str] = None
    incident_category_id: Optional[int] = None  # incident taxonomy tag (report-an-issue)
    request_item_id: Optional[int] = None  # links the ticket to the chosen catalogue item
    ci_id: Optional[int] = None            # the affected asset / CI this request is about (optional)
    fields: Optional[Any] = None           # wizard field answers (already folded into description by the UI)


class RequestReply(BaseModel):
    content: str = ""


class FeedbackSubmit(BaseModel):
    rating: float                          # option rating (0..1)
    comment: Optional[str] = None


class PortalVote(BaseModel):
    decision: str                          # approve | reject | abstain
    comment: Optional[str] = None
    role: Optional[str] = None             # the ROLE-* the approver votes as (CAB)


# ─── own-ticket helper ─────────────────────────────────────────────────────
def _own_ticket(db: Session, tid: int, name: str, email: str):
    """Fetch a ticket ONLY if it belongs to this requester (tenant-scoped +
    raised_by match). Anything else → 404, so a requester can neither read nor
    act on another user's ticket (and can't tell one exists)."""
    ticket = tickets._get_ticket(db, tid, name)
    if not ticket or (ticket.raised_by or "").lower() != (email or "").lower():
        raise HTTPException(status_code=404, detail="not found")
    return ticket


# ─── requests (create / track-own / reply) ─────────────────────────────────
@router.post("/requests")
def create_request(body: RequestCreate, db: Session = Depends(get_db),
                   email: str = Depends(current_user_email),
                   _: bool = Depends(require_request_create)):
    """Raise a request. raised_by is FORCED to the signed-in user (the body has
    no raised_by field, so create_ticket falls back to this kwarg) — a requester
    can never file as someone else."""
    tid = tenant_id(db)
    data = body.model_dump(exclude_none=True)
    # request_item_id / fields are handled here (create_ticket doesn't take them):
    # the UI already folds field answers into `description`; we just persist the
    # catalogue link after the ticket exists.
    req_item_id = data.pop("request_item_id", None)
    inc_cat_id = data.pop("incident_category_id", None)
    data.pop("fields", None)
    # Load the catalogue item up front so its OWN config drives routing + approval
    # (previously both were dropped, making the admin's catalogue setup cosmetic).
    ri = (db.query(HDRequestItem).filter_by(tenant_id=tid, id=req_item_id).first()
          if req_item_id else None)
    # Routing: an explicit department pick wins; otherwise the catalogue item's
    # own fulfilment team (grc_teams) routes the request to the right queue.
    if data.get("department_id"):
        team_id = department.resolve_department_team(db, tid, data["department_id"])
        if team_id:
            data["agent_group_id"] = team_id
    elif ri is not None and ri.fulfilment_team_id and not data.get("agent_group_id"):
        data["agent_group_id"] = ri.fulfilment_team_id
    res = tickets.create_ticket(db, tid, data, raised_by=email)
    # Tag the reported incident's category (validated to this tenant). Report-an-issue
    # sends incident_category_id; service requests never do, so the two paths don't overlap.
    if inc_cat_id is not None and res.get("ok"):
        t = tickets._get_ticket(db, tid, res["name"])
        if t is not None and db.query(HDIncidentCategory.id).filter(
                HDIncidentCategory.id == inc_cat_id, HDIncidentCategory.tenant_id == tid).first():
            t.incident_category_id = inc_cat_id
            db.flush()
            db.commit()
    if req_item_id and res.get("ok"):
        t = tickets._get_ticket(db, tid, res["name"])
        if t is not None:
            t.request_item_id = req_item_id
            db.flush()
            # ITSM: an approval-gated catalogue item opens a sign-off approval so
            # the request parks in 'pending_approval', surfaces in My Approvals,
            # and freezes its SLA until signed off — the service-request mirror of
            # the change CAB routing (approvals engine, flow #3). When the item
            # names an approver_role (ROLE-*), the approval is role-gated to it
            # (resolved via HDRoleMap, like CAB); SoD on the vote stops self-approval.
            if ri is not None and ri.approval_required:
                roles = [ri.approver_role] if ri.approver_role else None
                approvals.open_approval(db, tid, t, kind="request",
                                        required_quorum=1, required_role_codes=roles,
                                        opened_by=email)
                try:
                    sla.recompute(db, t, prev_status_category=t.status_category)
                except Exception:  # noqa: BLE001 — SLA pause must never block the sign-off
                    pass
                res["approval_state"] = t.approval_state
            db.commit()
    return res


@router.get("/my-requests")
def my_requests(status: Optional[str] = None, q: Optional[str] = None,
                db: Session = Depends(get_db),
                email: str = Depends(current_user_email),
                _: bool = Depends(require_requester)):
    """List ONLY the caller's own requests (raised_by filtered at the SQL layer
    in list_tickets — never trusting a client-supplied owner)."""
    return tickets.list_tickets(db, tenant_id(db), status, q, raised_by=email)


def _approval_summary(db: Session, tid: int, ticket_id: int, viewer: str) -> Optional[dict]:
    """The latest approval gating this ticket (pending or decided), with the
    vote tally and whether the VIEWER may still act on it. get_detail already
    carries the bare `approval_state`; this adds the summary the ticket-detail UI
    needs to render the approval card (quorum, counts, can-vote). None when the
    ticket has no approval."""
    ap = (db.query(HDApproval)
          .filter(HDApproval.tenant_id == tid, HDApproval.ticket_id == ticket_id)
          .order_by(HDApproval.id.desc())
          .first())
    if ap is None:
        return None
    approve_count = (db.query(HDApprovalVote)
                     .filter_by(approval_id=ap.id, decision="approve").count())
    viewer_voted = (db.query(HDApprovalVote)
                    .filter_by(approval_id=ap.id, approver=viewer).first() is not None)
    t = db.query(HDTicket).filter_by(id=ticket_id, tenant_id=tid).first()
    is_raiser = bool(t and (t.raised_by or "").lower() == (viewer or "").lower())
    return {
        "id": ap.id, "kind": ap.kind, "state": ap.state,
        "required_quorum": ap.required_quorum,
        "required_role_codes": ap.required_role_codes,
        "approve_count": approve_count,
        "opened_at": ap.opened_at.isoformat() if ap.opened_at else None,
        "decided_at": ap.decided_at.isoformat() if ap.decided_at else None,
        # a requester can never approve their own request (segregation of duties)
        "can_vote": ap.state == "pending" and not viewer_voted and not is_raiser,
    }


@router.get("/requests/{name}")
def request_detail(name: str, db: Session = Depends(get_db),
                   email: str = Depends(current_user_email),
                   _: bool = Depends(require_requester)):
    """Full detail + conversation for the caller's OWN request only; 404 otherwise.
    Adds an `approval` summary block (the bare approval_state is already on the
    ticket) so the UI can render the approval status/card."""
    tid = tenant_id(db)
    ticket = _own_ticket(db, tid, name, email)  # ownership gate (raises 404)
    detail = tickets.get_detail(db, tid, name)
    detail["approval"] = _approval_summary(db, tid, ticket.id, email)
    if detail.get("ticket"):
        detail["ticket"]["feedback_rating"] = ticket.feedback_rating
    return detail


@router.post("/requests/{name}/reply")
def reply_request(name: str, body: RequestReply, db: Session = Depends(get_db),
                  email: str = Depends(current_user_email),
                  _: bool = Depends(require_request_create)):
    """The requester replies on their OWN request (customer-reply path: files a
    Received message + reopens per the lifecycle). Ownership-guarded."""
    tid = tenant_id(db)
    _own_ticket(db, tid, name, email)  # ownership gate (raises 404)
    return tickets.receive_customer_reply(db, tid, name, body.content, sender=email)


@router.get("/feedback-options")
def portal_feedback_options(db: Session = Depends(get_db),
                            _: bool = Depends(require_requester)):
    """The CSAT scale a requester can rate a resolved request with."""
    tid = tenant_id(db)
    opts = (db.query(HDTicketFeedbackOption)
            .filter(HDTicketFeedbackOption.tenant_id == tid,
                    HDTicketFeedbackOption.disabled == False)  # noqa: E712
            .order_by(HDTicketFeedbackOption.rating.asc())
            .all())
    return {"options": [{"rating": o.rating, "label": o.label} for o in opts]}


@router.post("/requests/{name}/feedback")
def submit_feedback(name: str, body: FeedbackSubmit, db: Session = Depends(get_db),
                    email: str = Depends(current_user_email),
                    _: bool = Depends(require_requester)):
    """Rate your OWN request once it's resolved/closed. Ownership-guarded; only in
    the Resolved category (Resolved + Closed share it). Idempotent — re-rating
    overwrites. Matches the rating to a feedback option so agent CSAT reports align."""
    tid = tenant_id(db)
    ticket = _own_ticket(db, tid, name, email)
    if (ticket.status_category or "") != "Resolved":
        raise HTTPException(status_code=400, detail="You can rate a request once it's resolved.")
    opt = (db.query(HDTicketFeedbackOption)
           .filter(HDTicketFeedbackOption.tenant_id == tid,
                   HDTicketFeedbackOption.rating == body.rating)
           .first())
    ticket.feedback_rating = body.rating
    ticket.feedback_id = opt.id if opt else None
    ticket.feedback_extra = (body.comment or "").strip() or None
    db.commit()
    return {"ok": True}


# ─── self-service reads (so the requester form + help page work) ────────────
@router.get("/catalog")
def catalog(db: Session = Depends(get_db), email: str = Depends(current_user_email),
            _: bool = Depends(require_requester)):
    """The category→subcategory service catalog (shared with the agent form)."""
    return itsm_seed.SERVICE_CATALOG


@router.get("/templates")
def templates(department_id: Optional[int] = None, process: Optional[str] = None,
              db: Session = Depends(get_db), email: str = Depends(current_user_email),
              _: bool = Depends(require_requester)):
    """The predefined request library, optionally filtered by department/process."""
    from .request_templates import list_request_templates
    return list_request_templates(department_id, process, db, True)


@router.get("/kb")
def knowledge_base(db: Session = Depends(get_db), email: str = Depends(current_user_email),
                   _: bool = Depends(require_requester)):
    """Browse the knowledge base (gated on requests:view_own so any requester can
    read self-help; authoring stays behind the agent kb:author/edit gates)."""
    return kb.list_articles(db, tenant_id(db))


@router.get("/assets")
def portal_assets(q: Optional[str] = None, db: Session = Depends(get_db),
                  email: str = Depends(current_user_email),
                  _: bool = Depends(require_requester)):
    """Assets (CMDB CIs) a requester can attach to a request/report.

    With NO query -> the caller's OWN assets (CI.owner == their email), falling
    back to the tenant's linkable assets when they own none (CI.owner is usually a
    team/blank, so most requesters own nothing — an empty default was wrong); with
    a query -> a tenant-wide name/code search so they can find a shared asset
    (printer, server, meeting-room PC). Owned assets always sort first and are
    badged "mine". Retired CIs are excluded (they can't be linked). Only
    id/code/name/type/owner are returned (no sensitive attributes)."""
    tid = tenant_id(db)
    el = (email or "").strip().lower()
    ql = (q or "").strip().lower()
    # Exclude installed-software CIs: a requester attaches a real asset (host /
    # workstation / service), not a software package. Without this, searching
    # "DESKTOP" surfaced "Chrome Remote Desktop Host" etc. alongside the workstation.
    soft_type_id = (db.query(HDCIType.id)
                    .filter(HDCIType.tenant_id == tid, HDCIType.code == "CIT-SOFTWARE")
                    .scalar())
    query = db.query(HDConfigurationItem).filter(
        HDConfigurationItem.tenant_id == tid,
        func.lower(func.coalesce(HDConfigurationItem.status, "")) != "retired")
    if soft_type_id is not None:
        query = query.filter(HDConfigurationItem.ci_type_id != soft_type_id)
    cis = query.all()
    mine = lambda c: el != "" and (c.owner or "").strip().lower() == el  # noqa: E731
    if ql:
        hits = [c for c in cis if ql in (c.name or "").lower() or ql in (c.code or "").lower()]
    else:
        own = [c for c in cis if mine(c)]
        # CI.owner is usually a team/blank, so a requester rarely "owns" a CI and
        # the default list came back empty. Fall back to the tenant's linkable
        # assets (search already exposes these) so the picker is never empty; owned
        # assets still sort first and keep the "Mine" badge.
        hits = own if own else cis
    hits.sort(key=lambda c: (not mine(c), (c.name or "").lower()))
    return {"assets": [{"id": c.id, "code": c.code, "name": c.name,
                        "type": c.ci_type.name if c.ci_type else None,
                        "owner": c.owner, "mine": mine(c)} for c in hits[:50]]}


@router.get("/incident-categories")
def portal_incident_categories(db: Session = Depends(get_db),
                               _: bool = Depends(require_requester)):
    """Incident categories a requester can tag a reported issue with (report-an-issue).
    Tenant-scoped; id + name only."""
    tid = tenant_id(db)
    rows = (db.query(HDIncidentCategory)
            .filter(HDIncidentCategory.tenant_id == tid,
                    HDIncidentCategory.level == "category")  # top-level only for the picker
            .order_by(HDIncidentCategory.sort_order.asc().nullslast(), HDIncidentCategory.name.asc())
            .all())
    return {"categories": [{"id": c.id, "name": c.name} for c in rows]}


@router.get("/catalogue")
def portal_catalogue(db: Session = Depends(get_db), email: str = Depends(current_user_email),
                     _: bool = Depends(require_requester)):
    """The live service catalogue for the end-user request wizard: enabled
    categories, business services and request items from the ingested tables.
    Read-only + requester-gated (the admin /helpdesk/admin/catalogue surface is
    settings-gated and not for end users)."""
    tid = tenant_id(db)
    cats = db.query(HDServiceCategory).filter_by(tenant_id=tid, enabled=True).all()
    svcs = db.query(HDBusinessService).filter_by(tenant_id=tid, enabled=True).all()
    reqs = db.query(HDRequestItem).filter_by(tenant_id=tid, enabled=True).all()
    return {
        "categories": [{"id": c.id, "name": c.name, "description": c.description,
                        "parent_id": c.parent_id} for c in cats],
        "services": [{"id": s.id, "name": s.name, "category_id": s.category_id,
                      "description": s.description} for s in svcs],
        "requests": [{"id": r.id, "code": r.code, "name": r.name, "description": r.description,
                      "category_id": r.category_id, "business_service_id": r.business_service_id,
                      "approval_required": r.approval_required, "sla_hours": r.sla_hours,
                      "cost": r.cost} for r in reqs],
    }


@router.get("/my-approvals")
def portal_my_approvals(db: Session = Depends(get_db), email: str = Depends(current_user_email),
                        _: bool = Depends(require_requester)):
    """Pending approvals the signed-in user can still act on (hasn't voted yet).
    Interim scope: tenant-wide pending approvals minus ones this user already
    voted on — a precise user→ROLE eligibility filter waits on the user-role map."""
    tid = tenant_id(db)
    voted = [v[0] for v in db.query(HDApprovalVote.approval_id)
             .join(HDApproval, HDApproval.id == HDApprovalVote.approval_id)
             .filter(HDApproval.tenant_id == tid, HDApprovalVote.approver == email).all()]
    q = db.query(HDApproval).filter(HDApproval.tenant_id == tid, HDApproval.state == "pending")
    if voted:
        q = q.filter(~HDApproval.id.in_(voted))
    out = []
    for ap in q.order_by(HDApproval.id.desc()).all():
        t = db.query(HDTicket).filter_by(id=ap.ticket_id, tenant_id=tid).first()
        approve_count = (db.query(HDApprovalVote)
                         .filter_by(approval_id=ap.id, decision="approve").count())
        # Enrich with the context an approver needs to decide WITHOUT opening the
        # requester-owned ticket (the detail page is own-ticket gated; an approver
        # is by SoD never the raiser). The My Approvals card already renders these.
        ci = cost = risk = None
        if t is not None:
            if t.ci_id:
                c = db.query(HDConfigurationItem).filter_by(id=t.ci_id, tenant_id=tid).first()
                ci = {"id": c.id, "name": c.name, "code": c.code} if c else None
            if t.request_item_id:
                ri = db.query(HDRequestItem).filter_by(id=t.request_item_id, tenant_id=tid).first()
                cost = ri.cost if ri else None
            risk = getattr(t, "risk_level", None) or getattr(t, "risk", None)
        out.append({
            "id": ap.id, "kind": ap.kind, "ticket_name": str(ap.ticket_id),
            "subject": t.subject if t else None,
            "description": t.description if t else None,
            "process": t.process if t else None,
            "requested_by": t.raised_by if t else None,
            "ci": ci, "cost": cost, "risk": risk,
            "opened_at": ap.opened_at.isoformat() if ap.opened_at else None,
            "required_quorum": ap.required_quorum, "approve_count": approve_count,
        })
    return {"approvals": out}


@router.post("/approvals/{aid}/vote")
def portal_vote(aid: int, body: PortalVote, db: Session = Depends(get_db),
                email: str = Depends(current_user_email),
                _: bool = Depends(require_request_create)):
    """Cast a vote on a pending approval from the portal, resuming the ticket's SLA
    once the approval is decided. Segregation of duties: you cannot vote on a
    request you raised."""
    tid = tenant_id(db)
    decision = (body.decision or "").strip().lower()
    if decision not in ("approve", "reject", "abstain"):
        raise HTTPException(status_code=400, detail="decision must be approve, reject or abstain")
    ap = db.query(HDApproval).filter_by(id=aid, tenant_id=tid).first()
    if ap is None:
        raise HTTPException(status_code=404, detail="not found")
    t = db.query(HDTicket).filter_by(id=ap.ticket_id, tenant_id=tid).first()
    if t and (t.raised_by or "").lower() == (email or "").lower():
        raise HTTPException(status_code=400,
                            detail="You cannot vote on a request you raised (segregation of duties).")
    approvals.cast_vote(db, tid, aid, email, decision, role=body.role, comment=body.comment)
    db.refresh(ap)
    if t is not None and ap.state in ("approved", "rejected"):
        try:
            sla.recompute(db, t, prev_status_category=t.status_category)
        except Exception:  # noqa: BLE001 — SLA resume must never fail the vote
            pass
    db.commit()
    return {"ok": True, "state": ap.state}
