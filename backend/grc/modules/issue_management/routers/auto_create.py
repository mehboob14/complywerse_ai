"""Auto-create an Issue from an upstream entity.

  POST /issues/from-source
       { source_type, source_id, ...optional title/description/impact/urgency overrides }

Looks up the source (vulnerability / risk / asset / control_test / incident),
pre-fills sensible defaults, creates the issue + the relevant linkage row
in a single transaction, and returns the new issue id so the client can
redirect to /issues/{id}.
"""
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    Issue, IssueActivity,
    IssueVulnerabilityLink, IssueRiskLink, IssueAssetLink, IssueControlLink,
    Vulnerability, Risk, ITAsset,
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

    # Pin the canonical linkage based on the source
    if source_type == "vulnerability":
        db.add(IssueVulnerabilityLink(issue_id=issue.id, vulnerability_id=source_id, created_by=current_user.id))
    elif source_type == "risk":
        db.add(IssueRiskLink(issue_id=issue.id, risk_id=source_id, created_by=current_user.id))
    elif source_type == "asset":
        db.add(IssueAssetLink(issue_id=issue.id, asset_id=source_id, created_by=current_user.id))
    else:  # control_*
        target_type = source_type.replace("control_", "")
        cl = IssueControlLink(issue_id=issue.id, created_by=current_user.id)
        if target_type == "framework":    cl.framework_control_id = source_id
        elif target_type == "parsed":     cl.parsed_framework_control_id = source_id
        elif target_type == "normalized": cl.normalized_control_id = source_id
        elif target_type == "internal":   cl.internal_control_id = source_id
        db.add(cl)

    # Auto-attach assets we discovered through the vuln/risk source
    for asset_id in set(extra_asset_ids):
        db.add(IssueAssetLink(issue_id=issue.id, asset_id=asset_id, created_by=current_user.id))

    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="created",
        payload={"source_type": source_type, "source_id": source_id, "auto_pinned_assets": len(extra_asset_ids)},
    ))
    db.commit()
    db.refresh(issue)
    return {"id": issue.id, "code": issue.code, "title": issue.title}
