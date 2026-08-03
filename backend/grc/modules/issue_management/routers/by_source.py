"""Reverse-direction lookup — "show me all Issues linked to <X>".

Powers the <RelatedIssuesPanel> component that drops onto every detail
page in the platform. One endpoint, one source-type dispatch, returns
the same payload shape for any linked entity.
"""
from __future__ import annotations

from typing import List, Dict, Any, Optional, Tuple
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Issue,
    IssueVulnerabilityLink, IssueRiskLink, IssueAssetLink,
    IssueControlLink, IssueEvidenceLink, IssueVendorLink,
    IssueISProjectLink, IssueGovernanceLink,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

_require_view = require_tenant_permission("issue_management:issues:view")

router = APIRouter(
    prefix="/by-source",
    tags=["Issue Management - Reverse Lookup"],
    dependencies=[Depends(_require_view)],
)


# Source-type → (link model, link FK column name on the link model)
SOURCE_DISPATCH: Dict[str, Tuple[type, str]] = {
    "vulnerability":      (IssueVulnerabilityLink, "vulnerability_id"),
    "risk":               (IssueRiskLink,          "risk_id"),
    "asset":              (IssueAssetLink,         "asset_id"),
    "evidence":           (IssueEvidenceLink,      "evidence_id"),
    "vendor":             (IssueVendorLink,        "vendor_id"),
    "is_project":         (IssueISProjectLink,     "is_project_id"),
    "governance_document":(IssueGovernanceLink,    "governance_document_id"),
    "policy_statement":   (IssueGovernanceLink,    "policy_statement_id"),
    # Controls are polymorphic — handled separately below.
    "control_framework":  (IssueControlLink,       "framework_control_id"),
    "control_parsed":     (IssueControlLink,       "parsed_framework_control_id"),
    "control_normalized": (IssueControlLink,       "normalized_control_id"),
    "control_internal":   (IssueControlLink,       "internal_control_id"),
}


def _serialize_issue(i: Issue) -> Dict[str, Any]:
    return {
        "id": i.id,
        "code": i.code,
        "title": i.title,
        "severity": i.severity,
        "workflow_state": i.workflow_state or "new",
        "status": i.status,
        "issue_type": i.issue_type,
        "category": i.category,
        "sla_breached": bool(i.sla_breached),
        "target_closure_date": i.target_closure_date.isoformat() if i.target_closure_date else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "assignee_id": i.assignee_id,
    }


@router.get("/{source_type}/{source_id}")
def list_issues_by_source(
    source_type: str,
    source_id: int,
    include_closed: bool = False,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List Issues linked to a given source entity.

    Returns the *issues themselves*, not the link rows — so the caller can
    render them directly. Splits into open vs closed buckets for the UI.
    """
    if source_type not in SOURCE_DISPATCH:
        raise HTTPException(
            status_code=400,
            detail=f"source_type must be one of {sorted(SOURCE_DISPATCH.keys())}",
        )
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"open": [], "closed": [], "total_open": 0, "total_closed": 0, "critical_open": 0}

    LinkModel, fk_col = SOURCE_DISPATCH[source_type]
    fk_attr = getattr(LinkModel, fk_col)

    rows = db.query(LinkModel).options(joinedload(LinkModel.issue)).join(
        Issue, Issue.id == LinkModel.issue_id,
    ).filter(
        fk_attr == source_id,
        Issue.tenant_id.in_(user_tenants),
    ).limit(limit).all()

    open_states = {"new", "triage", "in_progress", "resolution", "closure_review"}
    open_list: List[Dict[str, Any]] = []
    closed_list: List[Dict[str, Any]] = []
    critical_open = 0

    for row in rows:
        issue = row.issue
        if issue is None:
            continue
        ws = issue.workflow_state or "new"
        payload = _serialize_issue(issue)
        if ws in open_states:
            open_list.append(payload)
            if (issue.severity or "").lower() == "critical":
                critical_open += 1
        else:
            if include_closed:
                closed_list.append(payload)

    # Open: sort by severity (critical first) then created_at desc
    sev_rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "informational": 4}
    open_list.sort(key=lambda x: (
        sev_rank.get((x["severity"] or "").lower(), 9),
        x["created_at"] or "",
    ), reverse=False)

    return {
        "source_type": source_type,
        "source_id": source_id,
        "open": open_list,
        "closed": closed_list,
        "total_open": len(open_list),
        "total_closed": len(closed_list),
        "critical_open": critical_open,
    }
