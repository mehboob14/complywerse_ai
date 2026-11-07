"""Native Help Desk router — the full `/helpdesk/*` surface from
`docs/HELPDESK_API_CONTRACT.md`, served from ComplyVerse's own DB instead of the Frappe
proxy.

Status: the TICKET CORE (list/detail/meta/create/status/reply/update/assign) is
converted and live here. The other sections (agents, teams, customers, contacts,
KB, saved/canned replies, dashboard, analytics, config) are wired to STUBS in
their sibling modules so the whole surface imports and responds with the
contract's empty shapes; parallel agents fill those in.

NOT MOUNTED YET. `grc/main.py` still mounts the Frappe proxy
(`modules/helpdesk/router.py`). Cutover — swapping the app from proxy → native —
is a later step; this module is self-contained and importable so it can be
tested first.

Contract invariants honoured: 200 + empty shapes on "empty" (never 4xx, §E);
mutating POSTs return {"ok": true}; status/priority values are the label strings
the UI's style maps key on.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...models import GRCUser, HDSupportGroupMap, Team, get_db
from ...routers.auth_router import require_auth
from . import (  # noqa: F401 (assignment used by tickets)
    tickets, sla, assignment, people, kb, replies, dashboard,
    masters, agent_status, contacts, tags, views, settings, analytics, department, mail,
    incident, problem, change, service_request, itsm_seed, request_templates,
    portal, attachments, catalogue_admin, cmdb_admin, cmdb_sync, governance_admin,
    approvals, relations, ticket_cis, ticket_kb,
)
from .common import tenant_id, require_view, require_masterdata_view, require_edit, require_tickets_assign, require_kb_author

router = APIRouter(prefix="/helpdesk", tags=["Help Desk (native)"])


# ─── request bodies ──────────────────────────────────────────────────────
class StatusUpdate(BaseModel):
    status: str


class ReplyBody(BaseModel):
    content: str = ""
    body: str = ""
    internal: bool = False
    cc: Optional[str] = None
    bcc: Optional[str] = None


class TicketUpdate(BaseModel):
    priority: Optional[str] = None
    ticket_type: Optional[str] = None
    status: Optional[str] = None
    agent_group: Optional[str] = None
    # §1 affected-CI linkage (agents set/clear it at triage). Explicit null clears,
    # so the route below dumps with exclude_unset (not exclude_none) to preserve it.
    ci_id: Optional[int] = None
    business_service_id: Optional[int] = None
    support_group_code: Optional[str] = None
    # ComplyVerse net-new: agents correct the intake department / customer / contact on the
    # ticket detail rail post-create (explicit null clears; route dumps exclude_unset).
    department_id: Optional[int] = None
    customer_id: Optional[int] = None
    contact: Optional[str] = None


class AssignBody(BaseModel):
    agent: Optional[str] = None
    team: Optional[str] = None


class TicketCreate(BaseModel):
    subject: str
    description: Optional[str] = None
    raised_by: Optional[str] = None
    status_id: Optional[int] = None
    priority_id: Optional[int] = None
    ticket_type_id: Optional[int] = None
    agent_group_id: Optional[int] = None
    customer_id: Optional[int] = None
    contact: Optional[str] = None
    department_id: Optional[int] = None    # ComplyVerse net-new: multi-department intake
    assigned_agent: Optional[str] = None   # §1c explicit assignee at create (agent email)
    team: Optional[str] = None             # explicit Team (by name) picked in the form
    # ITSM §0/§2: let the agent console raise ANY process (not just the default
    # incident) and type it. process is set-once; impact/urgency feed the priority
    # matrix; change_type/change_risk drive the CAB-vs-auto-approve routing
    # (approvals.requirements_for_change). create_ticket already honours all of
    # these via _extension_kwargs — they were just not reachable from this form.
    process: Optional[str] = None
    impact: Optional[str] = None
    urgency: Optional[str] = None
    change_type: Optional[str] = None
    change_risk: Optional[str] = None
    # §1 affected-CI linkage set at create (agent triage; requesters don't pick CIs)
    ci_id: Optional[int] = None
    business_service_id: Optional[int] = None
    support_group_code: Optional[str] = None  # ITIL support group → routes to its mapped team


class SavedReplyBody(BaseModel):
    title: str
    message: str = ""


# ─── dashboard (stubs) ─────────────────────────────────────────────────────
@router.get("/dashboard")
def dashboard_view(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return dashboard.recent(db, tenant_id(db))


@router.get("/dashboard-analytics")
def dashboard_analytics(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return dashboard.analytics(db, tenant_id(db))


# ─── tickets (CORE — converted) ────────────────────────────────────────────
@router.get("/tickets")
def list_tickets(status: Optional[str] = None, q: Optional[str] = None,
                 db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return tickets.list_tickets(db, tenant_id(db), status, q)


@router.get("/meta")
def meta(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return tickets.meta(db, tenant_id(db))


@router.get("/tickets/{name}")
def ticket_detail(name: str, db: Session = Depends(get_db), _: bool = Depends(require_view)):
    tid = tenant_id(db)
    detail = tickets.get_detail(db, tid, name)
    # Agent CAB read surface (flow #4): attach the approval + vote tally so the
    # detail view can show quorum progress / who voted, not just the buttons.
    t = tickets._get_ticket(db, tid, name)
    if t is not None:
        detail["approval"] = approvals.approval_detail(db, tid, t.id)
        # ITIL cross-process links (Batch 4 linkage A), reverse-resolved so an
        # incident shows its parent problem(s), a problem its incidents + changes,
        # and a change its origin.
        detail.update(relations.related_block(db, tid, t))
        # Batch 4 linkage B — the SET of CIs this ticket impacts (beyond its
        # primary `ci`); the change CAB check unions these for exposure.
        detail["impacted_cis"] = ticket_cis.list_impacted(db, tid, t)
        # Batch 4 linkage C — KB articles attached to this ticket.
        detail["kb_links"] = ticket_kb.list_links(db, tid, t)
    return detail


@router.post("/tickets")
def create_ticket(body: TicketCreate, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth), _: bool = Depends(require_edit)):
    tid = tenant_id(db)
    data = body.model_dump()
    # An explicitly-picked Team (by name) wins over department routing.
    _team = data.pop("team", None)
    if _team and not data.get("agent_group_id"):
        t = db.query(Team).filter(Team.tenant_id == tid, Team.name == _team).first()
        if t:
            data["agent_group_id"] = t.id
    # NET-NEW department routing: a chosen department stamps the ticket's Team, then
    # the existing assignment + SLA pipeline runs unchanged. An explicit agent_group wins.
    if data.get("department_id") and not data.get("agent_group_id"):
        team_id = department.resolve_department_team(db, tid, data["department_id"])
        if team_id:
            data["agent_group_id"] = team_id
    return tickets.create_ticket(db, tid, data, raised_by=current_user.email)


@router.post("/tickets/{name}/status")
def set_ticket_status(name: str, body: StatusUpdate, db: Session = Depends(get_db),
                      current_user: GRCUser = Depends(require_auth), _: bool = Depends(require_edit)):
    return tickets.set_status(db, tenant_id(db), name, body.status, actor_email=current_user.email)


@router.post("/tickets/{name}/reply")
def reply_ticket(name: str, body: ReplyBody, db: Session = Depends(get_db),
                 current_user: GRCUser = Depends(require_auth), _: bool = Depends(require_edit)):
    return tickets.reply(db, tenant_id(db), name, body.model_dump(), sender=current_user.email)


@router.post("/tickets/{name}/update")
def update_ticket(name: str, body: TicketUpdate, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth), _: bool = Depends(require_edit)):
    return tickets.update(db, tenant_id(db), name, body.model_dump(exclude_unset=True),
                          actor_email=current_user.email)


@router.post("/tickets/{name}/assign")
def assign_ticket(name: str, body: AssignBody, db: Session = Depends(get_db),
                  current_user: GRCUser = Depends(require_auth), _: bool = Depends(require_tickets_assign)):
    # Only forward the fields the client actually sent, so updating the team doesn't
    # wipe the agent (bug 1). model_fields_set tells "sent as null" from "omitted".
    sent = body.model_fields_set
    return tickets.assign(
        db, tenant_id(db), name,
        agent=body.agent if "agent" in sent else tickets._UNSET,
        team=body.team if "team" in sent else tickets._UNSET,
        actor_email=current_user.email,
    )


# ─── people (stubs) ────────────────────────────────────────────────────────
@router.get("/agents")
def agents(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return people.list_agents(db, tenant_id(db))


@router.get("/teams")
def teams(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    return people.list_teams(db, tenant_id(db))


@router.get("/support-groups")
def support_groups(db: Session = Depends(get_db), _: bool = Depends(require_masterdata_view)):
    """Light list for the ticket-form support-group picker: code, name, and whether
    the group is mapped to a team (Governance → Support groups owns the mapping)."""
    tid = tenant_id(db)
    rows = (db.query(HDSupportGroupMap)
            .filter(HDSupportGroupMap.tenant_id == tid)
            .order_by(HDSupportGroupMap.code.asc()).all())
    return {"support_groups": [
        {"code": g.code, "name": g.name, "mapped": g.team_id is not None} for g in rows]}


@router.get("/customers")
def customers(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return people.list_customers(db, tenant_id(db))


# /contacts is now served by contacts.router (full contact store).


# ─── knowledge base (stub) ──────────────────────────────────────────────────
@router.get("/articles")
def articles(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    # Agent console (tickets:view-gated) sees Draft/Archived too; the requester
    # path (portal) calls list_articles with the safe published_only default.
    return kb.list_articles(db, tenant_id(db), published_only=False)


# ─── saved / canned replies (stubs) ─────────────────────────────────────────
@router.get("/canned-responses")
def canned_responses(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return replies.list_canned_responses(db, tenant_id(db))


@router.get("/saved-replies")
def saved_replies(db: Session = Depends(get_db), _: bool = Depends(require_view)):
    return replies.list_saved_replies(db, tenant_id(db))


@router.post("/saved-replies")
def create_saved_reply(body: SavedReplyBody, db: Session = Depends(get_db),
                       _: bool = Depends(require_kb_author)):
    return replies.create_saved_reply(db, tenant_id(db), body.model_dump())


@router.put("/saved-replies/{name}")
def update_saved_reply(name: str, body: SavedReplyBody, db: Session = Depends(get_db),
                       _: bool = Depends(require_kb_author)):
    return replies.update_saved_reply(db, tenant_id(db), name, body.model_dump())


@router.delete("/saved-replies/{name}")
def delete_saved_reply(name: str, db: Session = Depends(get_db), _: bool = Depends(require_kb_author)):
    return replies.delete_saved_reply(db, tenant_id(db), name)


# /config is now served by settings.router (real HD Settings public subset).


# ─── aggregate: the full native surface main.py mounts ──────────────────────
# The core `router` (prefix /helpdesk) above + every converted module's sub-router.
# Sub-routers that are prefix-less (masters, sla config) are mounted under /helpdesk
# here; the rest already carry their own /helpdesk path and mount as-is.
helpdesk_native_router = APIRouter()
helpdesk_native_router.include_router(router)                               # ticket core + reads
helpdesk_native_router.include_router(masters.router, prefix="/helpdesk")   # status/type/template/feedback CRUD
helpdesk_native_router.include_router(sla.config_router, prefix="/helpdesk")  # SLA + holiday-list config CRUD
helpdesk_native_router.include_router(tickets.extra_router)                 # bulk-reply/assign-agent/customer-reply/delete
helpdesk_native_router.include_router(people.people_write_router)           # agent/customer/membership write
helpdesk_native_router.include_router(agent_status.router)                  # /helpdesk/agent-statuses
helpdesk_native_router.include_router(contacts.router)                      # /helpdesk/contacts (store)
helpdesk_native_router.include_router(replies.actions_router)               # rendered + apply-saved-reply-actions
helpdesk_native_router.include_router(kb.kb_write_router)                   # article/category CRUD + feedback
helpdesk_native_router.include_router(dashboard.dashboard_router)           # /helpdesk/dashboard-data
helpdesk_native_router.include_router(analytics.router)                     # /helpdesk/analytics/*
helpdesk_native_router.include_router(tags.router)                          # /helpdesk/tags, ticket tags
helpdesk_native_router.include_router(views.router)                         # /helpdesk/views
helpdesk_native_router.include_router(settings.router)                      # /helpdesk/settings + /helpdesk/config
helpdesk_native_router.include_router(department.router)                    # /helpdesk/departments (NET-NEW)
helpdesk_native_router.include_router(mail.router)                          # /helpdesk/email-accounts + email poll/feedback
helpdesk_native_router.include_router(incident.router)                      # /helpdesk/incidents (ITIL process)
helpdesk_native_router.include_router(problem.router)                       # /helpdesk/problems + link/known-error
helpdesk_native_router.include_router(change.router)                        # /helpdesk/changes + approval workflow
helpdesk_native_router.include_router(service_request.router)               # /helpdesk/service-requests + service-catalog
helpdesk_native_router.include_router(itsm_seed.router)                     # /helpdesk/itsm/seed (per-tenant ITSM seeder)
helpdesk_native_router.include_router(request_templates.router)             # /helpdesk/request-templates + /helpdesk/sla-preview
helpdesk_native_router.include_router(portal.router)                        # /helpdesk/portal/* (end-user requester surface)
helpdesk_native_router.include_router(attachments.router)                   # /helpdesk/tickets/{id}/attachments + download (persisted files)
helpdesk_native_router.include_router(ticket_cis.router)                     # /helpdesk/tickets/{id}/impacted-cis (Batch 4 linkage B)
helpdesk_native_router.include_router(ticket_kb.router)                      # /helpdesk/tickets/{id}/kb-links + kb-suggestions (Batch 4 linkage C)
helpdesk_native_router.include_router(catalogue_admin.router)                # /helpdesk/admin/catalogue (service catalogue CRUD)
helpdesk_native_router.include_router(cmdb_admin.router)                     # /helpdesk/admin/cmdb (CMDB CRUD + graph)
helpdesk_native_router.include_router(cmdb_sync.router)                      # /helpdesk/admin/cmdb (inventory sync + sync-status + /cis/{id}/software)
helpdesk_native_router.include_router(governance_admin.router)               # /helpdesk/admin/governance (priority/SLA/change/CAB/transitions/categories/org)
