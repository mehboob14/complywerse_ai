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

# The advance predicate is RESOLVED-ONLY. ServiceNow `closed` conflates a real
# fix with won't-fix / not-reproducible / too-costly closures (and cancelled
# maps separately to "cancelled"), so advancing a plan on `closed` alone would
# record work that explicitly did NOT happen as done — the KEV-chip class of
# "event read as proving something it doesn't". `resolved` is the unambiguous
# "engineering completed the work" signal. A closed-WITH-a-fix-resolution-code
# refinement is a documented Open Item; until then, a ticket that jumps
# straight to closed simply under-advances (safe), never over-advances.
_ADVANCE_STATUSES = ("resolved",)


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


def _remediation_plan(db, vuln):
    """Real remediation plan for a finding (title/summary/fix_artifact/rationale)
    via the SAME generator the vuln Remediation tab uses — so the steps in the plan
    + ticket MATCH what the user saw pre-mobilisation. Uses heuristic_plan:
    deterministic + instant + data-grounded (no LLM latency in the ticket-create
    hot path). Never raises."""
    try:
        from ..modules.vuln_management.remediation.plan_generator import heuristic_plan
        from ..modules.vuln_management.routers.remediation_plans import _context, _primary_asset
        return heuristic_plan(_context(vuln, _primary_asset(vuln, db)))
    except Exception:  # noqa: BLE001 — generation must never block the push/plan
        logger.exception("remediation plan generation failed for vuln %s", getattr(vuln, "id", None))
        return None


def _ensure_remediation_plan(db: Session, vuln, connection, *, user_id: Optional[int] = None,
                             plan: Optional[Dict[str, Any]] = None) -> bool:
    """Pushing to ITSM IS mobilisation, and the `mobilized` cycle counter reads
    `VulnRemediationPlan` — so a ticketed finding MUST carry a plan or its
    mobilisation is invisible to the counter. Create a minimal one if none
    exists (idempotent — one plan per finding). Returns True if it created one.

    OWNER GATE (mirrors the manual approve endpoint): an `approved` plan with no
    owner is "work nobody has been asked to do" — it can breach its SLA with no
    person or team ever named. So the push auto-APPROVES the plan (system-
    attributed) ONLY when the finding already has an owner (an assignee or a
    department); with no owner it creates the plan as `recommended`, so the
    ticket + mobilisation are still recorded but approval must route through the
    same gate the manual path enforces. Either way the plan EXISTS, so the
    mobilised counter (ticket count + plan existence) is unaffected. When it does
    approve, the `approved` status carries a system approver name + timestamp —
    an `approved` plan with a blank approver reads as a human decision that never
    happened."""
    from ..models import VulnRemediationPlan
    existing = db.query(VulnRemediationPlan).filter(
        VulnRemediationPlan.tenant_id == vuln.tenant_id,
        VulnRemediationPlan.vulnerability_id == vuln.id,
    ).first()
    if existing:
        return False

    # Same owner test as remediation_plans.approve(): an assignee OR a department
    # satisfies it. No owner: create the plan but DO NOT auto-approve it.
    has_owner = bool(getattr(vuln, "assigned_to", None))
    if not has_owner:
        try:
            from ..models import GRCVulnerabilityDepartmentAssignment
            has_owner = db.query(GRCVulnerabilityDepartmentAssignment).filter(
                GRCVulnerabilityDepartmentAssignment.vulnerability_id == vuln.id
            ).first() is not None
        except Exception:  # noqa: BLE001 — absence of the model/table must not block the push
            logger.exception("department-assignment lookup failed for vuln_id=%s", vuln.id)

    now = datetime.utcnow()
    # Real, data-grounded remediation steps (same generator as the Remediation
    # tab) — not a generic "see the ticket" back-ref. Falls back to the generic
    # text only if generation somehow yields nothing.
    plan = plan or _remediation_plan(db, vuln) or {}
    fix_type = plan.get("fix_type") or "patch"
    title = plan.get("title") or f"Remediate {vuln.vuln_id}"
    summary = plan.get("summary") or (
        "Created when a Help Desk ticket was opened for this finding; this plan "
        "makes the mobilisation visible to reporting.")
    fix_artifact = plan.get("fix_artifact") or \
        "See the linked Help Desk ticket for remediation steps and status."
    rationale = plan.get("rationale") or "Finding mobilised to the Help Desk for remediation."
    # Customer-facing text: NEVER name the ticket engine (invisible-engine rule).
    approver = "Help Desk ticket"
    db.add(VulnRemediationPlan(
        tenant_id=vuln.tenant_id, vulnerability_id=vuln.id,
        fix_type=fix_type,
        title=title,
        summary=summary,
        fix_artifact=fix_artifact,
        rationale=rationale,
        source="itsm",
        # Auto-approve only with an owner; otherwise leave it for the gate.
        status="approved" if has_owner else "recommended",
        approved_by_name=approver if has_owner else None,
        approved_at=now if has_owner else None,
    ))
    db.flush()
    return True


def push_finding(db: Session, vuln, connection, *, user_id: Optional[int] = None) -> Dict[str, Any]:
    """Push a finding to ITSM as a ticket (idempotent among LIVE tickets).
    Ensures a remediation plan exists so the mobilisation is counter-visible.
    Never commits — caller owns the transaction."""
    from ..models import VulnTicketLink

    # Only a LIVE (unresolved) link blocks a new push — a resolved-then-reopened
    # finding must be re-ticketable (reopens are first-class in this codebase).
    live = db.query(VulnTicketLink).filter(
        VulnTicketLink.tenant_id == vuln.tenant_id,
        VulnTicketLink.vulnerability_id == vuln.id,
        VulnTicketLink.connection_id == connection.id,
        VulnTicketLink.resolved_at.is_(None),
    ).first()
    if live and live.external_ticket_id:
        # Already have a live ticket — idempotent no-op.
        _ensure_remediation_plan(db, vuln, connection, user_id=user_id)
        return {"external_ticket_id": live.external_ticket_id, "created": False,
                "status": live.normalised_status}

    link = live or VulnTicketLink(
        tenant_id=vuln.tenant_id, vulnerability_id=vuln.id,
        connection_id=connection.id, kind="vulnerability",
    )
    if link.id is None:
        db.add(link)

    _plan_out = None  # remediation plan generated inline on the native path, reused by _ensure
    try:
        if getattr(connection, "integration_type", None) == "native_helpdesk":
            # Native in-app Help Desk engine — create a real grc_hd_ticket, no
            # external connector. The ticket shows up directly in the Help Desk,
            # pre-filled: priority from the finding's severity, routed to a
            # department (-> its team -> auto-assigned); status defaults to Open;
            # and the body carries the real remediation steps.
            from ..modules.helpdesk_native import tickets as hd_tickets
            from ..modules.helpdesk_native import department as hd_dept
            from ..models import HDTicketPriority, HDDepartment, VulnRemediationPlan
            # Remediation steps for the ticket body: reuse an already-saved real
            # plan's steps if present, else generate once (reused for the plan).
            _ep = db.query(VulnRemediationPlan).filter(
                VulnRemediationPlan.tenant_id == vuln.tenant_id,
                VulnRemediationPlan.vulnerability_id == vuln.id).first()
            _ep_art = (_ep.fix_artifact or "") if _ep else ""
            if _ep_art.strip() and "see the linked help desk" not in _ep_art.lower():
                _steps = _ep_art
            else:
                _plan_out = _remediation_plan(db, vuln) or {}
                _steps = _plan_out.get("fix_artifact") or ""
            _desc = (vuln.description or "")
            if _steps:
                _desc = (_desc + "\n\n---\n**Suggested remediation steps**\n\n" + _steps).strip()
            # Task-style subject so the ticket reads as work to do, not a raw scan
            # string (e.g. "Remediate CVE-2025-26466 on ssh (port 22/tcp)").
            _base = vuln.title or (vuln.cve_id or vuln.vuln_id or "finding")
            payload = {
                "subject": f"Remediate {_base}"[:255],
                "description": _desc,
            }
            _sev = {"critical": "Urgent", "high": "High", "medium": "Medium",
                    "low": "Low", "info": "Low", "informational": "Low"}
            _pn = _sev.get((getattr(vuln, "severity", "") or "").lower(), "Medium")
            _p = (db.query(HDTicketPriority).filter(
                      HDTicketPriority.tenant_id == vuln.tenant_id,
                      HDTicketPriority.name == _pn).first()
                  or db.query(HDTicketPriority).filter(
                      HDTicketPriority.tenant_id == vuln.tenant_id,
                      HDTicketPriority.name == "Medium").first())
            if _p:
                payload["priority_id"] = _p.id
            # Route vulnerability findings to a dedicated Security department (then
            # IT), NOT just "the first department by id" — which dumped every
            # finding into whatever dept had the lowest id (e.g. Sales).
            _deps = db.query(HDDepartment).filter(
                HDDepartment.tenant_id == vuln.tenant_id,
                HDDepartment.enabled.is_(True)).order_by(HDDepartment.id.asc()).all()

            def _dep_pick():
                for d in _deps:  # prefer Security / InfoSec / Cyber
                    if any(k in (d.name or "").lower() for k in ("security", "infosec", "cyber")):
                        return d
                for d in _deps:  # then IT
                    n = (d.name or "").strip().lower()
                    if n in ("it", "information technology") or "information technology" in n:
                        return d
                return _deps[0] if _deps else None  # last resort: first enabled dept

            _dep = _dep_pick()
            if _dep:
                payload["department_id"] = _dep.id
                _team = hd_dept.resolve_department_team(db, vuln.tenant_id, _dep.id)
                if _team:
                    payload["agent_group_id"] = _team
            # Pre-fill "Affected CI": the finding is already tied to an asset, so
            # link the CMDB CI mirroring that asset (ava_asset_id). Non-fatal — a
            # finding with no linked asset / no mirrored CI just creates without one.
            try:
                from ..modules.vuln_management.routers.remediation_plans import _primary_asset
                from ..models import HDConfigurationItem
                _asset = _primary_asset(vuln, db)
                if _asset:
                    _ci = (db.query(HDConfigurationItem)
                           .filter(HDConfigurationItem.tenant_id == vuln.tenant_id,
                                   HDConfigurationItem.ava_asset_id == _asset.id)
                           .first())
                    if _ci and (_ci.status or "").strip().lower() != "retired":
                        payload["ci_id"] = _ci.id  # skip retired: create_ticket 400s on those
            except Exception:
                logger.exception("affected-CI auto-link failed for vuln %s", vuln.id)
            res = hd_tickets.create_ticket(db, vuln.tenant_id, payload, raised_by=None)
            ext_id = str(res.get("name") or res.get("id") or "")
        else:
            adapter = _build_adapter(connection)
            ext_id = adapter.create_ticket(_ticket_request(vuln))
        link.external_ticket_id = ext_id
        link.pushed_by_user_id = user_id
        link.pushed_at = datetime.utcnow()
        link.normalised_status = "new"
        link.resolved_at = None
        link.plan_advanced_at = None
        link.push_error = None
        link.updated_at = datetime.utcnow()
        plan_created = _ensure_remediation_plan(db, vuln, connection, user_id=user_id, plan=_plan_out)
        db.flush()
        _audit(db, vuln.tenant_id, connection.id, user_id, "itsm.ticket_pushed",
               link.id, {"vulnerability_id": vuln.id, "external_ticket_id": ext_id,
                         "plan_created": plan_created})
        return {"external_ticket_id": ext_id, "created": True, "status": "new",
                "plan_created": plan_created}
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

        if st.normalised_status in _ADVANCE_STATUSES:
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
                        plan.applied_by_name = "Help Desk"  # never name the engine (invisible-engine rule)
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


def native_ticket_origins(db: Session, tenant_id: int, ticket_ids) -> Dict[str, int]:
    """Reverse lookup for the Help Desk tickets list: {external_ticket_id:
    vulnerability_id} for native-helpdesk tickets that were raised from a
    vulnerability finding. Read-only, batched, non-fatal — so the HD list can label
    a ticket's origin ('Vulnerability finding') and deep-link to the finding. Same
    join + native-connection filter as reflect_native_ticket_status (so a ServiceNow
    link never counts)."""
    from ..models import VulnTicketLink, IntegrationConnection
    ids = [str(x) for x in ticket_ids if x is not None]
    if not ids:
        return {}
    try:
        rows = (db.query(VulnTicketLink.external_ticket_id, VulnTicketLink.vulnerability_id)
                .join(IntegrationConnection, IntegrationConnection.id == VulnTicketLink.connection_id)
                .filter(VulnTicketLink.tenant_id == tenant_id,
                        VulnTicketLink.external_ticket_id.in_(ids),
                        IntegrationConnection.integration_type == "native_helpdesk")
                .all())
    except Exception:  # noqa: BLE001
        logger.exception("native_ticket_origins: lookup failed")
        return {}
    return {ext: vid for ext, vid in rows if ext}


def reflect_native_ticket_status(db: Session, tenant_id: int, ticket_name: str,
                                 normalised_status: str) -> Dict[str, int]:
    """Reflect a NATIVE Help Desk ticket's resolution onto the finding it was
    pushed from — the event-driven equivalent of sync_ticket_statuses for the
    native path, which has no connector to poll.

    Called from the HD status-change chokepoint (helpdesk_native.tickets
    _apply_status_change) with the ticket's name and the normalised status
    ("resolved" when it enters Resolved, "reopened" when it leaves). The join is
    VulnTicketLink.external_ticket_id == ticket.name on the native_helpdesk
    connection (push_finding stores the created ticket's name as external_ticket_id).

    Idempotent and non-fatal; never commits — it runs inside the caller's status
    change transaction so the finding update is atomic with the resolve.
    """
    from ..models import VulnTicketLink, VulnRemediationPlan, IntegrationConnection
    counts = {"synced": 0, "resolved": 0, "plans_advanced": 0, "reopened": 0}
    try:
        links = (db.query(VulnTicketLink)
                 .join(IntegrationConnection, IntegrationConnection.id == VulnTicketLink.connection_id)
                 .filter(VulnTicketLink.tenant_id == tenant_id,
                         VulnTicketLink.external_ticket_id == str(ticket_name),
                         IntegrationConnection.integration_type == "native_helpdesk")
                 .all())
    except Exception:
        logger.exception("reflect_native_ticket_status: link lookup failed for ticket %s", ticket_name)
        return counts

    now = datetime.utcnow()
    for link in links:
        link.normalised_status = normalised_status
        link.last_synced_at = now
        link.updated_at = now
        counts["synced"] += 1

        if normalised_status in _ADVANCE_STATUSES:  # "resolved"
            if link.resolved_at is None:
                link.resolved_at = now
                counts["resolved"] += 1
            # Advance the linked remediation plan to `applied` ONCE — never to
            # `verified` (that stays the scanner/retest's call), mirroring the
            # connector-poll path in sync_ticket_statuses.
            if link.plan_advanced_at is None:
                plan = db.query(VulnRemediationPlan).filter(
                    VulnRemediationPlan.vulnerability_id == link.vulnerability_id,
                    VulnRemediationPlan.tenant_id == link.tenant_id,
                ).first()
                if plan and plan.status in ("recommended", "approved"):
                    plan.status = "applied"
                    plan.applied_at = plan.applied_at or now
                    if hasattr(plan, "applied_by_name"):
                        plan.applied_by_name = "Help Desk"  # invisible-engine rule
                    link.plan_advanced_at = now
                    counts["plans_advanced"] += 1
                    _audit(db, link.tenant_id, link.connection_id, None,
                           "itsm.plan_advanced_applied", link.id,
                           {"vulnerability_id": link.vulnerability_id,
                            "external_ticket_id": link.external_ticket_id,
                            "note": "native Help Desk resolution → plan applied "
                                    "(NOT verified; verification stays the scanner path)"})
        elif normalised_status == "reopened":
            # Ticket left Resolved → the finding is active again. Clear the link's
            # resolution so it no longer reads as closed. Leave the plan's applied
            # state alone — a reopen doesn't un-apply work that may genuinely have
            # happened; verification is still the scanner's call.
            if link.resolved_at is not None:
                link.resolved_at = None
                counts["reopened"] += 1

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
