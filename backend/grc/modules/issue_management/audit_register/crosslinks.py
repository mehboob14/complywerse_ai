"""Where a register finding also belongs elsewhere in the platform.

- An MRA is the regulator's own finding, so it is kept in Statutory Audit as an
  observation (linked to the issue), carrying the regulator's status.
- A self-identified event is a loss event: an incident in ERM → Incidents.
- A line of business is one of the bank's business units, through the LOB
  mapping the register keeps (``AuditRegisterAlias`` kind "lob").

Each is created once, then kept in step by every import and every edit here.
The register is the source: what these records show follows the finding.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Dict, Optional

from sqlalchemy.orm import Session

from ....models import (AuditIssueProfile, AuditObservation, AuditObservationIssueLink,
                        AuditRegisterAlias, BusinessUnit, Issue, RiskIncident)

REGULATOR_STATUSES = ("Submitted to regulator", "Accepted by regulator", "MRA closed by regulator")
_PRIORITY = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}
_INCIDENT_SEVERITY = {"critical": "critical", "high": "high", "medium": "medium", "low": "low"}


def alias_key(text: Optional[str]) -> str:
    """How a workbook name is matched: case and spacing ignored."""
    return " ".join(re.sub(r"\s+", " ", str(text or "")).lower().split())[:255]


# ── MRAs → Statutory Audit ───────────────────────────────────────────────────

def observation_status(profile: AuditIssueProfile, issue: Issue) -> str:
    """Statutory Audit's status for the MRA.

    "Closed" is the regulator's to give ("MRA has been closed by regulator");
    Audit Services validating it, or management submitting it to the regulator,
    makes it "complied" until then.
    """
    said = (profile.regulator_status or "").lower()
    if said.startswith("mra closed"):
        return "closed"
    if said or issue.workflow_state == "closed":
        return "complied"
    return "open" if issue.workflow_state == "new" else "in_progress"


def sync_observation(db: Session, issue: Issue, profile: AuditIssueProfile,
                     actor_id: Optional[int] = None, create: bool = False) -> int:
    """Refresh the MRA's observation, or create it when ``create``. Returns 1
    when one was created."""
    if profile.source != "regulator":
        return 0
    # Not its _ensure_tables guard: on failure that rolls the whole session back,
    # an import included. The tables and the category column are healed per
    # tenant at startup (schema_migrations).
    from ...auditor_portal.routers.statutory_audit import _next_code

    link =(db.query(AuditObservationIssueLink)
            .filter(AuditObservationIssueLink.issue_id == issue.id).first())
    observation = db.get(AuditObservation, link.observation_id) if link else None
    if observation is None and not create:
        return 0          # removed in Statutory Audit: not brought back behind its back
    created = observation is None
    if created:
        observation = AuditObservation(tenant_id=issue.tenant_id,
                                       code=_next_code(db, issue.tenant_id),
                                       observation_type="finding", created_by=actor_id)
        db.add(observation)

    status = observation_status(profile, issue)
    observation.title = (issue.title or profile.issue_ref or "MRA")[:500]
    observation.description = profile.issue_text
    observation.regulator_source = (profile.regulator or "")[:120] or None
    observation.regulation_reference = " · ".join(
        x for x in (profile.report_name, profile.issue_ref) if x)[:255] or None
    observation.priority = _PRIORITY.get(issue.severity or "", "medium")
    observation.due_date = issue.due_date
    observation.management_response = profile.management_action_plan
    observation.owner_id = issue.owner_id
    observation.area_domain = (profile.lob or "")[:255] or None
    observation.category = "MRA"
    observation.source_document_name = (profile.report_name or "")[:255] or None
    observation.audit_period = str(profile.report_date.year) if profile.report_date else None
    if status in ("closed", "complied") and observation.status not in ("closed", "complied"):
        observation.closed_at = datetime.utcnow()
    elif status not in ("closed", "complied"):
        observation.closed_at = None
    observation.status = status
    observation.updated_at = datetime.utcnow()
    db.flush()
    if not link:
        db.add(AuditObservationIssueLink(observation_id=observation.id, issue_id=issue.id,
                                         notes="From the audit issue register",
                                         created_by=actor_id))
    return int(created)


def observation_for(db: Session, issue_id: int) -> Optional[AuditObservation]:
    link = (db.query(AuditObservationIssueLink)
            .filter(AuditObservationIssueLink.issue_id == issue_id).first())
    return db.get(AuditObservation, link.observation_id) if link else None


# ── Self ID → Incidents ──────────────────────────────────────────────────────

def sync_incident(db: Session, issue: Issue, profile: AuditIssueProfile,
                  as_of=None, create: bool = False) -> int:
    """The self-identified event as an ERM incident: refreshed, or created when
    ``create``. Returns 1 when created."""
    if profile.source != "self_id":
        return 0
    incident = db.get(RiskIncident, profile.incident_id) if profile.incident_id else None
    if incident is None and not create:
        return 0          # deleted in ERM → Incidents: left deleted
    created = incident is None
    if created:
        incident = RiskIncident(tenant_id=issue.tenant_id, status="open")
        db.add(incident)
    # The client's own sheet has dates Excel cannot read ("3/31/2-26"); the
    # incident still needs one, so the pack's date stands in until it is fixed.
    when = profile.event_date or profile.as_of_date or as_of
    incident.title = (issue.title or "Self-identified event")[:255]
    incident.description = profile.issue_text
    incident.incident_date = (datetime.combine(when, datetime.min.time()) if when
                              else incident.incident_date or datetime.utcnow())
    incident.severity = _INCIDENT_SEVERITY.get(issue.severity or "", "medium")
    incident.financial_impact = float(profile.monetary_impact) if profile.monetary_impact is not None else None
    incident.operational_impact = profile.impact_to_client
    incident.corrective_actions = profile.actions_to_address
    incident.assigned_to = issue.owner_id
    incident.tags = ["Audit register", issue.code or f"issue {issue.id}"]
    if issue.workflow_state == "closed":
        incident.status = "resolved"
        incident.resolved_at = incident.resolved_at or issue.closed_at or datetime.utcnow()
    elif incident.status in ("resolved", "closed"):          # reopened, or restored after a delete
        incident.status, incident.resolved_at = "open", None
    db.flush()
    profile.incident_id = incident.id
    return int(created)


# ── LOB → Business Units ─────────────────────────────────────────────────────

def business_unit_for(db: Session, tenant_id: int, lob: Optional[str]) -> Optional[int]:
    """The LOB's business unit: its mapping, else a unit of the same name."""
    key = alias_key(lob)
    if not key:
        return None
    alias = (db.query(AuditRegisterAlias)
             .filter(AuditRegisterAlias.tenant_id == tenant_id, AuditRegisterAlias.kind == "lob",
                     AuditRegisterAlias.alias_key == key).first())
    if alias:
        return alias.target_id
    for unit in db.query(BusinessUnit).filter(BusinessUnit.tenant_id == tenant_id).all():
        if alias_key(unit.name) == key:
            return unit.id
    return None


def sync_business_unit(db: Session, profile: AuditIssueProfile) -> int:
    unit_id = business_unit_for(db, profile.tenant_id, profile.lob)
    changed = unit_id != profile.business_unit_id
    profile.business_unit_id = unit_id
    return int(changed and unit_id is not None)


def sync_crosslinks(db: Session, issue: Issue, profile: AuditIssueProfile, *,
                    actor_id: Optional[int] = None, as_of=None,
                    create: bool = False) -> Dict[str, int]:
    """Keep the finding's Statutory Audit observation, incident and business
    unit in step. ``create`` (a new finding, or Re-link) also makes the
    observation or incident when there is none; otherwise one deleted in its
    own module stays deleted."""
    return {
        "observations": sync_observation(db, issue, profile, actor_id, create),
        "incidents": sync_incident(db, issue, profile, as_of, create),
        "business_units": sync_business_unit(db, profile),
    }
