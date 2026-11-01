"""Shared helpers for the native Help Desk engine.

Tenant-scoped query helpers, the serialization that flattens the native
SQLAlchemy rows into the exact shapes `docs/HELPDESK_API_CONTRACT.md` requires
(so the existing UI needs no change), and the VIEW/EDIT RBAC dependencies.

Tenancy: ComplyVerse is DB-per-tenant — `get_db` already bound the request to the
tenant's own database, so there is exactly one `grc_tenants` row in it and its
id is the `tenant_id` every native row carries (same convention the rest of the
app uses via `get_user_tenants`).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from ...models import GRCUser, Tenant, get_db
from ...routers.auth_router import require_auth, require_tenant_permission

# RBAC — mirror the app's "<area>:<resource>:<action>" permission convention.
# Administrator and the tenant primary-contact pass automatically (see
# require_tenant_permission); other roles need these granted.
require_view = require_tenant_permission("helpdesk:tickets:view")   # agent queue
require_edit = require_tenant_permission("helpdesk:tickets:edit")   # agent write

# End-user (requester) gates — a requester-only role has these but NOT tickets:*,
# so the agent console stays closed to them while the portal opens.
require_requester = require_tenant_permission("helpdesk:requests:view_own")
require_request_create = require_tenant_permission("helpdesk:requests:create")

# ─── granular segregation-of-duties gates (H1) ────────────────────────────
# Each sensitive router group binds to its OWN distinct permission instead of
# collapsing onto tickets:edit. These resolve the permission at request time
# via require_tenant_permission (same Administrator / primary-contact bypass),
# so granting an agent tickets:edit no longer silently confers SLA config,
# mailbox-credential access, change approval, KB authoring, or role grants.
#   settings:* → SLA/holiday config, HD settings, /config, mailbox/email,
#                masters write, people/role-grant write, agent_status.
#   kb:*       → KB article/category/feedback authoring vs read.
#   processes:*→ Change/Problem/Incident/Service-Request process ACTIONS vs read.
#   tickets:assign / tickets:delete / tickets:create → fine-grained ticket ops.
require_settings_manage = require_tenant_permission("helpdesk:settings:manage")
require_settings_view = require_tenant_permission("helpdesk:settings:view")
require_kb_author = require_tenant_permission("helpdesk:kb:author")
require_kb_view = require_tenant_permission("helpdesk:kb:view")
require_processes_manage = require_tenant_permission("helpdesk:processes:manage")
require_processes_view = require_tenant_permission("helpdesk:processes:view")
require_tickets_assign = require_tenant_permission("helpdesk:tickets:assign")
require_tickets_delete = require_tenant_permission("helpdesk:tickets:delete")
require_tickets_create = require_tenant_permission("helpdesk:tickets:create")


# Master-data reads (priorities, statuses, types, agents, teams, departments,
# SLA, templates, feedback) are needed BOTH by an agent filling a ticket form
# (tickets:view) AND by a settings-admin configuring the desk (settings:view).
# A settings-only admin has no tickets:view, so gating these as tickets:view
# locked it out of the very config it owns (the FE then showed the misleading
# "engine not connected" error). Accept EITHER permission. This does NOT open
# the ticket queue — /tickets and ticket detail keep require_view.
def _require_any(*perms: str):
    checkers = [require_tenant_permission(p) for p in perms]

    def dep(
        request: Request,
        token: Optional[str] = Cookie(None, alias="grc_auth_token"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
        db: Session = Depends(get_db),
    ) -> bool:
        last: Optional[HTTPException] = None
        for check in checkers:
            try:
                return check(request=request, token=token, authorization=authorization, db=db)
            except HTTPException as exc:
                if exc.status_code == status.HTTP_401_UNAUTHORIZED:
                    raise  # auth/idle failure, not a permission miss — surface it
                last = exc
        raise last or HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

    return dep


require_masterdata_view = _require_any("helpdesk:tickets:view", "helpdesk:settings:view")


def current_user_email(user: GRCUser = Depends(require_auth)) -> str:
    """The signed-in user's email — the key the requester portal isolates own
    tickets on. Reuses require_auth (so auth/idle checks all still run)."""
    return user.email


def tenant_id(db: Session) -> Optional[int]:
    """The id of this request's tenant (the only tenant in its DB)."""
    row = db.query(Tenant).first()
    return row.id if row else None


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


# ─── serialization (native row → contract shape) ──────────────────────────
def _status_label(ticket) -> Optional[str]:
    return ticket.status.label_agent if ticket.status else None


def _priority_label(ticket) -> Optional[str]:
    p = ticket.priority
    if not p:
        return None
    return p.name or p.level


def ticket_row(ticket) -> dict:
    """§A3 list row. Vuln-link fields (severity/cve_id/finding_id) have no native
    store yet — they arrive only via the out-of-scope vuln→ticket push — so they
    serialize as null (contract allows it)."""
    return {
        "name": str(ticket.id),
        "subject": ticket.subject,
        "status": _status_label(ticket),
        "priority": _priority_label(ticket),
        "type": ticket.ticket_type.name if ticket.ticket_type else None,
        "team": ticket.team.name if ticket.team else None,
        "agent": ticket.assigned_agent,
        "agreement_status": ticket.agreement_status,
        "customer": ticket.customer.customer_name if ticket.customer else None,
        "contact": ticket.contact or ticket.raised_by,
        "created": iso(ticket.created_at),
        "modified": iso(ticket.updated_at),
        "response_by": iso(ticket.response_by),
        "resolution_by": iso(ticket.resolution_by),
        "feedback_rating": ticket.feedback_rating,
        "cve_id": None,
    }


def ticket_detail(ticket, sla_block: dict) -> dict:
    """§A4 ticket block. `sla_block` is supplied by sla.compute_sla_block()."""
    return {
        "name": str(ticket.id),
        "subject": ticket.subject,
        "description": ticket.description,
        "status": _status_label(ticket),
        "priority": _priority_label(ticket),
        "ticket_type": ticket.ticket_type.name if ticket.ticket_type else None,
        "team": ticket.team.name if ticket.team else None,
        "agent": ticket.assigned_agent,
        "department": ticket.department.name if ticket.department else None,
        "department_id": ticket.department_id,
        "customer": ticket.customer.customer_name if ticket.customer else None,
        "customer_id": ticket.customer_id,
        "contact": ticket.contact or ticket.raised_by,
        "raised_by": ticket.raised_by,
        "response_by": iso(ticket.response_by),
        "resolution_by": iso(ticket.resolution_by),
        "feedback_rating": ticket.feedback_rating,
        "created": iso(ticket.created_at),
        "creation": iso(ticket.created_at),
        "severity": None,
        "cve_id": None,
        "finding_id": None,
        "sla": sla_block,
    }
