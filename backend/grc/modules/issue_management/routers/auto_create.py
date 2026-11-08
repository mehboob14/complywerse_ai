"""Auto-create an Issue from an upstream entity.

  POST /issues/from-source
       { source_type, source_id, ...optional title/description/impact/urgency overrides,
         owner_id, assignee_id, root_cause, due_date, linked_*_ids }

Looks up the source (vulnerability / risk / asset / control / governance document /
policy statement / IS project / risk incident), pre-fills sensible defaults, creates
the issue + the source's own linkage row + whatever else the person linked
(`linked_*`, the same body as POST /issues) in a single transaction, and returns the
new issue id so the client can open /issues/{id}.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    Issue, IssueActivity,
    IssueVulnerabilityLink, IssueRiskLink, IssueAssetLink, IssueControlLink,
    IssueISProjectLink, IssueGovernanceLink,
    Vulnerability, Risk, ITAsset, ISProject, GovernanceDocument, PolicyStatement,
    RiskIncident, IncidentAssetLink, IncidentVulnerabilityLink,
    FrameworkControl, ParsedFrameworkControl, NormalizedControl, InternalControl,
    VulnerabilityAssetLink, RiskAssetLink,
    GRCUser, get_db,
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant,
    require_tenant_permission,
)
from ..services.severity_resolver import resolve_severity
from ..services.code_generator import next_issue_code
from .issues import _apply_inline_linkages, _log_activity


_require_create = require_tenant_permission("issue_management:issues:create")

router = APIRouter(
    prefix="/issues",
    tags=["Issue Management - Auto-Create"],
    dependencies=[Depends(_require_create)],
)


SUPPORTED_SOURCES = {
    "vulnerability", "risk", "asset",
    "control_framework", "control_parsed", "control_normalized", "control_internal",
    # v2 — governance + event-driven sources. UI uses these for the "+ Create
    # Issue from..." buttons on document/policy detail pages and the auto-create
    # hooks in KRI / mitigation / control-test flows.
    "governance_document", "policy_statement",
    "kri_breach", "mitigation_overdue", "control_test_failed", "is_project",
    # a risk incident (Risk Management > Incidents): no link table, `Issue.source_type/source_id` is the link
    "risk_incident",
}

# Declared above for the platform's own hooks (services/auto_create.from_event raises them when the event happens, from the
# event's own record). A person cannot raise them from a record, so asking here is refused in plain words (it used to be
# read as a control and answered "Control not found", or linked the issue to a control with the same number).
EVENT_SOURCES = {"kri_breach", "mitigation_overdue", "control_test_failed"}

# `from-source` body key -> the family of link rows the source itself writes: the same family in `linked_*` is not written twice.
_LINK_KEY = {
    "vulnerability": "linked_vulnerability_ids",
    "risk": "linked_risk_ids",
    "asset": "linked_asset_ids",
    "is_project": "linked_is_project_ids",
    "governance_document": "linked_governance_document_ids",
    "policy_statement": "linked_policy_statement_ids",
    "control_internal": "linked_internal_control_ids",
}


def _severity_to_impact(sev: Optional[str]) -> str:
    sev = (sev or "").lower()
    if sev == "critical": return "high"
    if sev == "high":     return "high"
    if sev == "medium":   return "medium"
    return "low"


@router.post("/from-source", status_code=status.HTTP_201_CREATED)
def create_from_source(
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    source_type = (body.get("source_type") or "").lower()
    if source_type in EVENT_SOURCES:
        raise HTTPException(
            status_code=400,
            detail="Issues for this kind of event are raised by the platform itself when it happens; they cannot be raised from a record.",
        )
    try:
        source_id = int(body.get("source_id") or 0)
    except (TypeError, ValueError):
        source_id = 0
    if source_type not in SUPPORTED_SOURCES or source_id <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"source_type ∈ {sorted(SUPPORTED_SOURCES - EVENT_SOURCES)} and source_id required",
        )

    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    user_tenants = get_user_tenants(current_user, db)

    # ── Resolve source entity + build defaults ───────────────────────────
    title = (body.get("title") or "").strip() or None
    description = body.get("description")
    impact = body.get("impact")
    urgency = body.get("urgency") or "medium"
    category = body.get("category")
    issue_type = body.get("issue_type")
    root_cause = body.get("root_cause")
    if root_cause is not None and len(str(root_cause)) > 255:
        raise HTTPException(status_code=400, detail="The root cause is limited to 255 characters; put the detail in the description.")
    due_date_raw = body.get("due_date")
    try:
        due_date = datetime.fromisoformat(due_date_raw) if due_date_raw else None
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="The due date is not a valid date.")
    extra_asset_ids: list = []
    extra_vuln_ids: list = []
    extra_risk_ids: list = []

    if source_type == "vulnerability":
        v = db.query(Vulnerability).filter(
            Vulnerability.id == source_id,
            Vulnerability.tenant_id.in_(user_tenants),
        ).first()
        if not v:
            raise HTTPException(status_code=404, detail="Vulnerability not found")
        if not title:
            code = v.vuln_id or f"VULN-{v.id}"
            title = f"{code} — {v.title}"
        if not description:
            description = v.description
        if not impact:
            impact = _severity_to_impact(v.severity)
        if not category:
            category = "security"
        if not issue_type:
            issue_type = "audit_finding" if (v.cve_id or v.cwe_id) else "incident"
        # auto-link the asset(s) the vuln affects, too
        extra_asset_ids = [link.asset_id for link in db.query(VulnerabilityAssetLink).filter(
            VulnerabilityAssetLink.vulnerability_id == v.id,
        ).all()]

    elif source_type == "risk":
        r = db.query(Risk).filter(Risk.id == source_id, Risk.tenant_id.in_(user_tenants)).first()
        if not r:
            raise HTTPException(status_code=404, detail="Risk not found")
        if not title:
            title = f"Risk materialised: {r.title}"
        if not description:
            description = getattr(r, "description", None)
        if not impact:
            residual = getattr(r, "residual_score", None) or getattr(r, "residual_risk_score", None) or 0
            impact = "high" if residual >= 15 else "medium" if residual >= 5 else "low"
        if not category:
            category = "operations"
        if not issue_type:
            issue_type = "non_conformance"
        extra_asset_ids = [link.asset_id for link in db.query(RiskAssetLink).filter(
            RiskAssetLink.risk_id == r.id,
        ).all()]

    elif source_type == "asset":
        a = db.query(ITAsset).filter(ITAsset.id == source_id, ITAsset.tenant_id.in_(user_tenants)).first()
        if not a:
            raise HTTPException(status_code=404, detail="Asset not found")
        if not title:
            title = f"Issue on {a.name}"
        if not impact:
            crit = (a.criticality or "medium").lower()
            impact = "high" if crit in ("critical", "high") else "medium" if crit == "medium" else "low"
        if not category:
            category = "operations"
        if not issue_type:
            issue_type = "incident"

    elif source_type == "governance_document":
        # The document's own title is not read here: who may see a document is Governance's rule (drafts, departments), not this
        # route's, so a person who may raise issues must not learn a title through the issue it names. The caller names the issue.
        if not db.query(GovernanceDocument.id).filter(
            GovernanceDocument.id == source_id, GovernanceDocument.tenant_id.in_(user_tenants),
        ).first():
            raise HTTPException(status_code=404, detail="Document not found")
        title = title or "Non-conformance on a governed document"
        category = category or "regulatory"
        issue_type = issue_type or "non_conformance"
        impact = impact or "medium"

    elif source_type == "policy_statement":
        if not db.query(PolicyStatement.id).filter(
            PolicyStatement.id == source_id, PolicyStatement.tenant_id.in_(user_tenants),
        ).first():
            raise HTTPException(status_code=404, detail="Policy statement not found")
        title = title or "Non-conformance on a policy statement"
        category = category or "regulatory"
        issue_type = issue_type or "non_conformance"
        impact = impact or "medium"

    elif source_type == "is_project":
        p = db.query(ISProject).filter(ISProject.id == source_id, ISProject.tenant_id.in_(user_tenants)).first()
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        title = title or f"Project issue: {p.name}"
        category = category or "operations"
        issue_type = issue_type or "process_gap"
        impact = impact or "medium"

    elif source_type == "risk_incident":
        inc = db.query(RiskIncident).filter(RiskIncident.id == source_id, RiskIncident.tenant_id.in_(user_tenants)).first()
        if not inc:
            raise HTTPException(status_code=404, detail="Incident not found")
        title = title or f"Incident: {inc.title}"
        if not description:
            description = inc.description
        impact = impact or _severity_to_impact(inc.severity)
        category = category or "operations"
        issue_type = issue_type or "incident"
        # the incident's own risk, assets and vulnerabilities come with it
        extra_risk_ids = [inc.risk_id] if inc.risk_id else []
        extra_asset_ids = [l.asset_id for l in db.query(IncidentAssetLink).filter(IncidentAssetLink.incident_id == inc.id).all()]
        extra_vuln_ids = [l.vulnerability_id for l in db.query(IncidentVulnerabilityLink).filter(IncidentVulnerabilityLink.incident_id == inc.id).all()]

    else:  # control_framework / control_parsed / control_normalized / control_internal
        target_type = source_type.replace("control_", "")
        if target_type == "framework":
            ctrl = db.query(FrameworkControl).filter(FrameworkControl.id == source_id).first()
            ctrl_code, ctrl_name = (ctrl.code if ctrl else None), (ctrl.name if ctrl else None)
        elif target_type == "parsed":
            ctrl = db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id == source_id).first()
            ctrl_code, ctrl_name = (ctrl.control_id if ctrl else None), (ctrl.title if ctrl else None)
        elif target_type == "normalized":
            ctrl = db.query(NormalizedControl).filter(NormalizedControl.id == source_id).first()
            ctrl_code = getattr(ctrl, "code", None) or getattr(ctrl, "control_id", None)
            ctrl_name = getattr(ctrl, "name", None) or getattr(ctrl, "title", None)
        else:  # internal
            ctrl = db.query(InternalControl).filter(
                InternalControl.id == source_id,
                InternalControl.tenant_id.in_(user_tenants),
            ).first()
            ctrl_code, ctrl_name = (ctrl.control_id if ctrl else None), (ctrl.name if ctrl else None)
        if not ctrl:
            raise HTTPException(status_code=404, detail="Control not found")
        if not title:
            title = f"Control gap: {ctrl_code or ''} — {ctrl_name or ''}".strip(" —")
        if not category:
            category = "regulatory"
        if not issue_type:
            issue_type = "non_conformance"
        if not impact:
            impact = "medium"

    # ── Create issue + linkage ───────────────────────────────────────────
    severity_override = body.get("severity_override")
    severity_override_reason = body.get("severity_override_reason")
    if severity_override and not severity_override_reason:
        raise HTTPException(status_code=400, detail="Say why the severity is overridden.")
    computed_severity, ack_hours, resolve_hours = resolve_severity(
        impact=impact, urgency=urgency, tenant_id=tenant_id, db=db,
    )
    final_severity = severity_override or computed_severity
    detected_at_raw = body.get("detected_at")
    detected_at = datetime.fromisoformat(detected_at_raw) if detected_at_raw else datetime.utcnow()
    target_closure_date = detected_at + timedelta(hours=resolve_hours)
    from ....routers.auth_router import refuse_imported_accounts
    refuse_imported_accounts(db, [body.get("owner_id"), body.get("assignee_id")])

    issue = Issue(
        tenant_id=tenant_id, title=(title or "")[:255], description=description,
        severity=final_severity,
        severity_override=severity_override,
        severity_override_reason=severity_override_reason,
        impact=impact, urgency=urgency,
        issue_type=issue_type, category=category,
        root_cause=root_cause,
        detected_at=detected_at,
        target_closure_date=target_closure_date,
        due_date=due_date,
        owner_id=body.get("owner_id"),
        reporter_id=current_user.id,
        assignee_id=body.get("assignee_id"),
        source_type=source_type if not source_type.startswith("control_") else "control_test",
        source_id=source_id,
        workflow_state="new", status="open",
    )
    db.add(issue)
    db.flush()
    issue.code = next_issue_code(tenant_id, db)

    # Pin the canonical linkage based on the source
    pinned: Dict[str, Set[int]] = {}               # link family -> ids already written below (not written again from `linked_*`)
    pinned_controls: Set[Tuple[str, int]] = set()

    def pin(key: str, ids) -> None:
        pinned.setdefault(key, set()).update(int(i) for i in ids)

    if source_type == "vulnerability":
        db.add(IssueVulnerabilityLink(issue_id=issue.id, vulnerability_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["vulnerability"], [source_id])
    elif source_type == "risk":
        db.add(IssueRiskLink(issue_id=issue.id, risk_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["risk"], [source_id])
    elif source_type == "asset":
        db.add(IssueAssetLink(issue_id=issue.id, asset_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["asset"], [source_id])
    elif source_type == "governance_document":
        db.add(IssueGovernanceLink(issue_id=issue.id, governance_document_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["governance_document"], [source_id])
    elif source_type == "policy_statement":
        db.add(IssueGovernanceLink(issue_id=issue.id, policy_statement_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["policy_statement"], [source_id])
    elif source_type == "is_project":
        db.add(IssueISProjectLink(issue_id=issue.id, is_project_id=source_id, created_by=current_user.id))
        pin(_LINK_KEY["is_project"], [source_id])
    elif source_type == "risk_incident":
        pass                                        # no link table: Issue.source_type/source_id is the link (by-source reads it)
    else:  # control_*
        target_type = source_type.replace("control_", "")
        cl = IssueControlLink(issue_id=issue.id, created_by=current_user.id)
        if target_type == "framework":    cl.framework_control_id = source_id
        elif target_type == "parsed":     cl.parsed_framework_control_id = source_id
        elif target_type == "normalized": cl.normalized_control_id = source_id
        elif target_type == "internal":   cl.internal_control_id = source_id
        db.add(cl)
        pinned_controls.add((target_type, source_id))
        if target_type == "internal":
            pin(_LINK_KEY["control_internal"], [source_id])

    # Auto-attach what we discovered through the vuln/risk/incident source
    for asset_id in set(extra_asset_ids) - pinned.get("linked_asset_ids", set()):
        db.add(IssueAssetLink(issue_id=issue.id, asset_id=asset_id, created_by=current_user.id))
    pin("linked_asset_ids", extra_asset_ids)
    for risk_id in set(extra_risk_ids) - pinned.get("linked_risk_ids", set()):
        db.add(IssueRiskLink(issue_id=issue.id, risk_id=risk_id, created_by=current_user.id))
    pin("linked_risk_ids", extra_risk_ids)
    for vuln_id in set(extra_vuln_ids) - pinned.get("linked_vulnerability_ids", set()):
        db.add(IssueVulnerabilityLink(issue_id=issue.id, vulnerability_id=vuln_id, created_by=current_user.id))
    pin("linked_vulnerability_ids", extra_vuln_ids)

    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="created",
        payload={"source_type": source_type, "source_id": source_id, "auto_pinned_assets": len(extra_asset_ids)},
    ))

    # Whatever else the person linked in the form (the same body and the same rules as POST /issues): written in this transaction,
    # without the links the source itself has just written.
    extra = {k: v for k, v in body.items() if k.startswith("linked_")}
    for key, ids in pinned.items():
        if key in extra:
            extra[key] = [v for v in (extra[key] or []) if str(v).lstrip("-").isdigit() and int(v) not in ids]
    if extra.get("linked_controls"):
        extra["linked_controls"] = [
            e for e in extra["linked_controls"]
            if not (isinstance(e, dict) and (e.get("target_type"), _as_int(e.get("control_id"))) in pinned_controls)
        ]
    link_counts = _apply_inline_linkages(db, issue=issue, tenant_id=tenant_id, body=extra, user_id=current_user.id)
    if link_counts:
        _log_activity(db, issue.id, current_user.id, "linked_on_create", link_counts)

    from ..services.capa_defaults import ensure_initial_capa
    ensure_initial_capa(db, issue=issue, user_id=current_user.id)
    db.commit()
    db.refresh(issue)
    return {"id": issue.id, "code": issue.code, "title": issue.title, "linked": link_counts}


def _as_int(v) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
