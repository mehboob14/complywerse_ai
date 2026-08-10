"""CTEM Phase 5 — ITSM mobilisation over the existing connectors module.

Wires the vulnerability lifecycle INTO the already-built ServiceNow ticketing
adapter (grc/modules/connectors): push a finding as a ticket, and roll the
ticket's resolution back onto the finding's remediation plan.

Two safety rules, both consistent with earlier phases:
  * Idempotent push — one live ticket per (vuln, connection); a repeat push
    returns the existing link, never a duplicate ServiceNow incident.
  * A resolved ticket advances the remediation plan to `applied` (engineering
    did the work), NEVER to `verified`. Verification stays the scanner/retest
    path — a ticket close is not proof the finding is gone (same boundary as
    scanner auto-close).
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Normalised ticket statuses that mean "engineering completed the work".
_RESOLVED_STATUSES = ("resolved", "closed")


def _build_adapter(connection):
    """Instantiate the connectors-module adapter for this connection, using
    the same registry factory + credential decryption the connectors router
    uses (one construction path, no divergence)."""
    from ..modules.connectors.registry import build_adapter
    from ..services.connector_credentials import decrypt_credentials
    creds = decrypt_credentials(connection.encrypted_credentials) or {}
    tokens = decrypt_credentials(connection.oauth_tokens) or {}
    return build_adapter(
        provider=connection.integration_type,
        console_url=connection.console_url,
        credentials=creds,
        config=connection.provider_config or {},
        oauth_tokens=tokens,
    )


def _ticket_request(vuln):
    from ..modules.connectors.base import TicketRequest
    return TicketRequest(
        kind="vulnerability",
        summary=(vuln.title or f"Vulnerability {vuln.vuln_id}")[:255],
        description=(vuln.description or "")[:4000],
        severity=(vuln.severity or "medium"),
        external_id=str(vuln.id),
        extra_fields={"vuln_id": vuln.vuln_id, "cve_id": getattr(vuln, "cve_id", None)},
    )


def push_finding(db: Session, vuln, connection, *, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Push a finding to ITSM as a ticket (idempotent). Returns the link
    summary. Never commits — caller owns the transaction."""
    from ..models import VulnTicketLink

    link = db.query(VulnTicketLink).filter(
        VulnTicketLink.tenant_id == vuln.tenant_id,
        VulnTicketLink.vulnerability_id == vuln.id,
        VulnTicketLink.connection_id == connection.id,
    ).first()
    if link and link.external_ticket_id:
        # Already pushed — idempotent no-op, return the existing ticket.
        return {"external_ticket_id": link.external_ticket_id, "created": False,
                "status": link.normalised_status}

    if link is None:
        link = VulnTicketLink(
            tenant_id=vuln.tenant_id, vulnerability_id=vuln.id,
            connection_id=connection.id, kind="vulnerability",
        )
        db.add(link)

    try:
        adapter = _build_adapter(connection)
        ext_id = adapter.create_ticket(_ticket_request(vuln))
        link.external_ticket_id = ext_id
        link.pushed_by_user_id = user_id
        link.pushed_at = datetime.utcnow()
        link.normalised_status = "new"
        link.push_error = None
        link.updated_at = datetime.utcnow()
        db.flush()
        _audit(db, vuln.tenant_id, connection.id, user_id, "itsm.ticket_pushed",
               link.id, {"vulnerability_id": vuln.id, "external_ticket_id": ext_id})
        return {"external_ticket_id": ext_id, "created": True, "status": "new"}
    except Exception as e:
        link.push_error = str(e)[:500]
        link.updated_at = datetime.utcnow()
        db.flush()
        logger.exception("ITSM push failed for vuln %s", vuln.id)
        return {"external_ticket_id": None, "created": False, "error": str(e)[:300]}


def sync_ticket_statuses(db: Session, connection, *, limit: int = 500) -> Dict[str, int]:
    """Pull current status for every pushed ticket on this connection and roll
    resolutions onto the linked remediation plans. Never commits."""
    from ..models import VulnTicketLink, VulnRemediationPlan

    links = db.query(VulnTicketLink).filter(
        VulnTicketLink.tenant_id == connection.tenant_id,
        VulnTicketLink.connection_id == connection.id,
        VulnTicketLink.external_ticket_id.isnot(None),
    ).limit(limit).all()
    if not links:
        return {"synced": 0, "resolved": 0, "plans_advanced": 0}

    by_ext = {l.external_ticket_id: l for l in links}
    counts = {"synced": 0, "resolved": 0, "plans_advanced": 0}
    now = datetime.utcnow()
    try:
        adapter = _build_adapter(connection)
        statuses = adapter.fetch_statuses(list(by_ext.keys()))
    except Exception:
        logger.exception("ITSM status fetch failed for connection %s", connection.id)
        return counts

    for st in statuses:
        link = by_ext.get(st.external_id)
        if link is None:
            continue
        link.ticket_status = st.status
        link.normalised_status = st.normalised_status
        link.last_synced_at = now
        counts["synced"] += 1

        if st.normalised_status in _RESOLVED_STATUSES:
            if link.resolved_at is None:
                link.resolved_at = st.resolved_at or now
                counts["resolved"] += 1
            # Advance the linked remediation plan to `applied` ONCE — never to
            # `verified` (that's the scanner/retest's call).
            if link.plan_advanced_at is None:
                plan = db.query(VulnRemediationPlan).filter(
                    VulnRemediationPlan.vulnerability_id == link.vulnerability_id,
                    VulnRemediationPlan.tenant_id == link.tenant_id,
                ).first()
                if plan and plan.status in ("recommended", "approved"):
                    plan.status = "applied"
                    plan.applied_at = plan.applied_at or now
                    if hasattr(plan, "applied_by_name"):
                        plan.applied_by_name = f"ITSM:{connection.integration_type}"
                    link.plan_advanced_at = now
                    counts["plans_advanced"] += 1
                    _audit(db, link.tenant_id, connection.id, None,
                           "itsm.plan_advanced_applied", link.id,
                           {"vulnerability_id": link.vulnerability_id,
                            "external_ticket_id": link.external_ticket_id,
                            "note": "ServiceNow resolution → plan applied (NOT verified; "
                                    "verification remains the scanner/retest path)"})
        link.updated_at = now

    db.flush()
    return counts


def _audit(db, tenant_id, connection_id, user_id, action, resource_id, detail):
    try:
        from ..models import IntegrationAuditLog
        db.add(IntegrationAuditLog(
            tenant_id=tenant_id, connection_id=connection_id,
            entity_type="itsm_ticket_link", entity_id=resource_id, action=action,
            performed_by_user_id=user_id,
            performed_by=(f"user:{user_id}" if user_id else "SYSTEM"),
            metadata_info=detail,
        ))
    except Exception:
        logger.exception("ITSM audit write failed (non-fatal)")
