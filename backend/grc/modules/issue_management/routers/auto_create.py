"""Auto-create an Issue from an upstream entity.

  POST /issues/from-source
       { source_type, source_id, ...optional title/description/impact/urgency overrides }

Looks up the source (vulnerability / risk / asset / control / governance
document / policy statement / IS project), pre-fills sensible defaults,
creates the issue + the source's linkage row + any links picked in the form
in a single transaction, and returns the new issue id so the client can
redirect to /issues/{id}.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    Issue, IssueActivity,
    Vulnerability, Risk, ITAsset,
    FrameworkControl, ParsedFrameworkControl, NormalizedControl, InternalControl,
    VulnerabilityAssetLink, RiskAssetLink,
    GovernanceDocument, PolicyStatement, ISProject,
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


# Sources with their own record and link table, beyond vulnerability / risk / asset / control.
# Event sources (kri_breach, mitigation_overdue, control_test_failed) are raised by those
# modules through services.auto_create.from_event, not here: they have no link table, so
# they are refused rather than looked up as a control by the same id.
_RECORD_SOURCES = {
    # source_type: (model, inline-link key, default title, category, issue_type)
    "governance_document": (GovernanceDocument, "linked_governance_document_ids",
                            lambda d: f"Document gap: {d.title}", "regulatory", "non_conformance"),
    "policy_statement": (PolicyStatement, "linked_policy_statement_ids",
                         lambda p: f"Policy non-conformance: {p.statement_code or f'PS-{p.id}'}",
                         "regulatory", "non_conformance"),
    "is_project": (ISProject, "linked_is_project_ids",
                   lambda p: f"Issue on project {p.name}", "operations", "incident"),
}

SUPPORTED_SOURCES = {
    "vulnerability", "risk", "asset",
    "control_framework", "control_parsed", "control_normalized", "control_internal",
    *_RECORD_SOURCES,
}

# Where the source itself is pinned, in the create body's inline-link vocabulary.
_SOURCE_LINK_KEY = {
    "vulnerability": "linked_vulnerability_ids", "risk": "linked_risk_ids",
    "asset": "linked_asset_ids", "control_internal": "linked_internal_control_ids",
    **{k: v[1] for k, v in _RECORD_SOURCES.items()},
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
    source_id = body.get("source_id")
    if source_type not in SUPPORTED_SOURCES or not source_id:
        raise HTTPException(
            status_code=400,
            detail=f"source_type ∈ {sorted(SUPPORTED_SOURCES)} and source_id required",
        )

    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")
    user_tenants = get_user_tenants(current_user, db)

    # ── Resolve source entity + build defaults ───────────────────────────
    title = body.get("title")
    description = body.get("description")
    impact = body.get("impact")
    urgency = body.get("urgency") or "medium"
    category = body.get("category")
    issue_type = body.get("issue_type")
    extra_asset_ids: list = []
    extra_vuln_ids: list = []

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

    elif source_type in _RECORD_SOURCES:
        model, _key, default_title, default_category, default_type = _RECORD_SOURCES[source_type]
        src = db.query(model).filter(model.id == source_id, model.tenant_id.in_(user_tenants)).first()
        if not src:
            raise HTTPException(status_code=404, detail=f"{source_type.replace('_', ' ').capitalize()} not found")
        if not title:
            title = default_title(src)
        if not category:
            category = default_category
        if not issue_type:
            issue_type = default_type
        if not impact:
            impact = "medium"

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
        tenant_id=tenant_id, title=title, description=description,
        severity=final_severity,
        severity_override=severity_override,
        severity_override_reason=severity_override_reason,
        impact=impact, urgency=urgency,
        issue_type=issue_type, category=category,
        detected_at=detected_at,
        target_closure_date=target_closure_date,
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

    # Pin the source, the assets found through it, and the links picked in the form,
    # through the same helper /issues uses (it de-duplicates ids and keeps them in tenant).
    links = dict(body)

    def _with(key: str, *items: Any) -> None:
        links[key] = [*(links.get(key) or []), *items]

    if source_type in _SOURCE_LINK_KEY:
        _with(_SOURCE_LINK_KEY[source_type], source_id)
    else:  # control_framework / control_parsed / control_normalized
        _with("linked_controls", {"target_type": source_type.replace("control_", ""), "control_id": source_id})
    _with("linked_asset_ids", *extra_asset_ids)
    link_counts = _apply_inline_linkages(db, issue=issue, tenant_id=tenant_id, body=links, user_id=current_user.id)

    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="created",
        payload={"source_type": source_type, "source_id": source_id, "auto_pinned_assets": len(extra_asset_ids)},
    ))
    if link_counts:
        _log_activity(db, issue.id, current_user.id, "linked_on_create", link_counts)
    from ..services.capa_defaults import ensure_initial_capa
    ensure_initial_capa(db, issue=issue, user_id=current_user.id)
    db.commit()
    db.refresh(issue)
    return {"id": issue.id, "code": issue.code, "title": issue.title}
