"""Phase 5 — ITSM mobilisation endpoints.

Push a finding to a configured ticketing connector, and pull ticket statuses
back (advancing remediation plans to `applied` on resolution). Both are
decision-bearing writes → edit-gated. Live verification requires a configured
ServiceNow connection (created via the connectors UI; credentials never pass
through here).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
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


@router.post("/vulnerabilities/{vuln_id}/push-to-itsm")
def push_to_itsm(
    vuln_id: int,
    connection_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = Depends(require_tenant_permission("vulnerabilities:vulnerability_register:edit")),
):
    tenants = get_user_tenants(current_user, db)
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id, Vulnerability.tenant_id.in_(tenants)).first()
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    conn = _conn_or_404(db, connection_id, tenants)

    result = itsm_service.push_finding(db, vuln, conn, user_id=current_user.id)
    db.commit()
    if result.get("error"):
        raise HTTPException(status_code=502, detail=f"ITSM push failed: {result['error']}")
    return result


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
    return {"tickets": [{
        "connection_id": l.connection_id,
        "external_ticket_id": l.external_ticket_id,
        "normalised_status": l.normalised_status,
        "pushed_at": l.pushed_at.isoformat() if l.pushed_at else None,
        "resolved_at": l.resolved_at.isoformat() if l.resolved_at else None,
        "plan_advanced_at": l.plan_advanced_at.isoformat() if l.plan_advanced_at else None,
        "push_error": l.push_error,
    } for l in links]}
