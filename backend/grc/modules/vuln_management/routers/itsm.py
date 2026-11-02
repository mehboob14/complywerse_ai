"""Phase 5 — ITSM mobilisation endpoints.

Push a finding to a configured ticketing connector, and pull ticket statuses
back (advancing remediation plans to `applied` on resolution). Both are
decision-bearing writes → edit-gated. Live verification requires a configured
ServiceNow connection (created via the connectors UI; credentials never pass
through here).
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import Vulnerability, IntegrationConnection, VulnTicketLink, GRCUser, get_db
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
)
from ....services import itsm_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Vulnerabilities - ITSM"])


def _conn_or_404(db, connection_id, tenants) -> IntegrationConnection:
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.id == connection_id,
        IntegrationConnection.tenant_id.in_(tenants),
        IntegrationConnection.is_active == True,  # noqa: E712
    ).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Ticketing connection not found or inactive")
    if (conn.category or "") != "ticketing":
        raise HTTPException(status_code=409, detail="Connection is not a ticketing (ITSM) connector")
    return conn


# The Help Desk engine is now the NATIVE in-app engine (grc_hd_*), not an
# external connector. We keep a hidden per-tenant "ticketing" IntegrationConnection
# row purely as the anchor for VulnTicketLink (connection_id is NOT NULL); this
# marker's integration_type tells push_finding to create a native ticket.
NATIVE_HELPDESK_TYPE = "native_helpdesk"


def _helpdesk_conn(db, tenants) -> IntegrationConnection:
    """Resolve the tenant's Help Desk ticketing anchor SERVER-SIDE (the engine
    stays invisible to the client). Post-migration the engine is internal, so if
    no ticketing connection exists we auto-create the hidden native marker instead
    of failing — "Create Help Desk ticket" must always work."""
    conn = db.query(IntegrationConnection).filter(
        IntegrationConnection.tenant_id.in_(tenants),
        IntegrationConnection.category == "ticketing",
        IntegrationConnection.is_active == True,  # noqa: E712
    ).order_by(IntegrationConnection.id.asc()).first()
    if conn:
        return conn
    tid = tenants[0] if tenants else None
    conn = IntegrationConnection(
        tenant_id=tid,
        integration_type=NATIVE_HELPDESK_TYPE,
        connection_name="Help Desk",
        console_url="internal://helpdesk-native",
        category="ticketing",
        is_active=True,
        status="connected",
    )
    db.add(conn)
    db.flush()
    return conn


@router.post("/vulnerabilities/{vuln_id}/push-to-itsm")
def push_to_itsm(
    vuln_id: int,
    connection_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenants = get_user_tenants(current_user, db)
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id, Vulnerability.tenant_id.in_(tenants)).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    # connection_id optional: the Help Desk engine is invisible, so the client
    # doesn't pass it — resolve it server-side.
    conn = _conn_or_404(db, connection_id, tenants) if connection_id else _helpdesk_conn(db, tenants)

    result = itsm_service.push_finding(db, vuln, conn, user_id=current_user.id)
    db.commit()
    if result.get("error"):
        raise HTTPException(status_code=502, detail=f"ITSM push failed: {result['error']}")
    return result


class BulkPushRequest(BaseModel):
    vuln_ids: List[int]
    connection_id: Optional[int] = None


@router.post("/vulnerabilities/bulk-push-to-itsm")
def bulk_push_to_itsm(
    body: BulkPushRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    """Create Help Desk tickets for many findings at once. Idempotent per finding
    (a live ticket is a no-op), so re-running is safe. Routes through the same
    `push_finding` path as the single-finding button."""
    tenants = get_user_tenants(current_user, db)
    conn = _conn_or_404(db, body.connection_id, tenants) if body.connection_id else _helpdesk_conn(db, tenants)
    vulns = db.query(Vulnerability).filter(
        Vulnerability.id.in_(body.vuln_ids),
        Vulnerability.tenant_id.in_(tenants),
    ).all()

    created = skipped = failed = 0
    errors: List[dict] = []
    for v in vulns:
        try:
            r = itsm_service.push_finding(db, v, conn, user_id=current_user.id)
            db.commit()
            if r.get("error"):
                failed += 1
                errors.append({"vuln_id": v.id, "error": r["error"]})
            elif r.get("created"):
                created += 1
            else:
                skipped += 1  # already had a live ticket
        except Exception as exc:  # noqa: BLE001 — one bad finding must not abort the batch
            db.rollback()
            logger.exception("bulk push failed for vuln %s", v.id)
            failed += 1
            errors.append({"vuln_id": v.id, "error": str(exc)[:300]})
    return {"requested": len(body.vuln_ids), "matched": len(vulns),
            "created": created, "skipped": skipped, "failed": failed, "errors": errors}


@router.post("/itsm/connections/{connection_id}/sync-statuses")
def sync_itsm_statuses(
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenants = get_user_tenants(current_user, db)
    conn = _conn_or_404(db, connection_id, tenants)
    counts = itsm_service.sync_ticket_statuses(db, conn)
    db.commit()
    return counts


@router.get("/helpdesk/tickets")
def helpdesk_tickets(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    """Help Desk board — every ticket ComplyVerse has opened for this tenant, joined to
    its finding, with a status summary. Powers ComplyVerse's native Help Desk screen;
    the ticket engine (Frappe) stays invisible behind the connector."""
    tenants = get_user_tenants(current_user, db)
    rows = (
        db.query(VulnTicketLink, Vulnerability, IntegrationConnection)
        .join(Vulnerability, Vulnerability.id == VulnTicketLink.vulnerability_id)
        .outerjoin(IntegrationConnection, IntegrationConnection.id == VulnTicketLink.connection_id)
        .filter(VulnTicketLink.tenant_id.in_(tenants))
        .order_by(VulnTicketLink.pushed_at.desc().nullslast())
        .all()
    )
    tickets = []
    summary = {"new": 0, "in_progress": 0, "on_hold": 0, "resolved": 0, "closed": 0, "cancelled": 0}
    for link, vuln, conn in rows:
        status = link.normalised_status or "new"
        if status in summary:
            summary[status] += 1
        tickets.append({
            "ticket_id": link.external_ticket_id,
            "status": status,
            "raw_status": link.ticket_status,
            "finding_id": vuln.id,
            "vuln_id": vuln.vuln_id,
            "title": vuln.title,
            "severity": vuln.severity,
            "cve_id": vuln.cve_id,
            "affected_host": vuln.affected_host,
            "connection": conn.connection_name if conn else None,
            "pushed_at": link.pushed_at.isoformat() if link.pushed_at else None,
            "last_synced_at": link.last_synced_at.isoformat() if link.last_synced_at else None,
            "resolved_at": link.resolved_at.isoformat() if link.resolved_at else None,
            "push_error": link.push_error,
        })
    return {"tickets": tickets, "summary": summary, "total": len(tickets)}


@router.get("/vulnerabilities/{vuln_id}/itsm-tickets")
def list_itsm_tickets(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:view")),
):
    tenants = get_user_tenants(current_user, db)
    links = db.query(VulnTicketLink).filter(
        VulnTicketLink.vulnerability_id == vuln_id,
        VulnTicketLink.tenant_id.in_(tenants),
    ).all()
    # Flag native Help Desk links so the finding's own chip can scope to them
    # (and not surface a ServiceNow link under a "HD #" label).
    conn_type = dict(
        db.query(IntegrationConnection.id, IntegrationConnection.integration_type)
        .filter(IntegrationConnection.id.in_([l.connection_id for l in links] or [0])).all()
    )
    return {"tickets": [{
        "connection_id": l.connection_id,
        "is_native": conn_type.get(l.connection_id) == "native_helpdesk",
        "external_ticket_id": l.external_ticket_id,
        "normalised_status": l.normalised_status,
        "pushed_at": l.pushed_at.isoformat() if l.pushed_at else None,
        "resolved_at": l.resolved_at.isoformat() if l.resolved_at else None,
        "plan_advanced_at": l.plan_advanced_at.isoformat() if l.plan_advanced_at else None,
        "push_error": l.push_error,
    } for l in links]}
