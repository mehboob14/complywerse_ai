"""Reverse-direction lookup — "show me all Issues linked to <X>".

Powers the <RelatedIssuesPanel> component that drops onto every detail
page in the platform. One endpoint, one source-type dispatch, returns
the same payload shape for any linked entity.

  GET /by-source/{source_type}/{source_id}   the issues of ONE record (open rows; closed rows with include_closed)
  GET /by-source/counts?type=&ids=1,2,3      open / critical / closed counts of many records of one type, in one call (a row's badge)

The totals are counts over EVERY linked issue (they used to be counts over the first `limit` link rows, so a record with more
links than the limit read short), and `total_closed` is always there; only the closed ROWS wait for `include_closed`.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, or_
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
# An incident has no link table: the issue raised from it carries it as its own source (POST /issues/from-source).
INCIDENT_SOURCE = "risk_incident"
SOURCE_TYPES = sorted(list(SOURCE_DISPATCH.keys()) + [INCIDENT_SOURCE])

OPEN_STATES = {"new", "triage", "in_progress", "resolution", "closure_review"}
MAX_COUNT_IDS = 200
_SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3, "informational": 4}

# An issue with no workflow state is a new one (the older rows).
_is_open = or_(Issue.workflow_state.is_(None), Issue.workflow_state.in_(OPEN_STATES))


def _serialize_issue(i: Issue, now: datetime) -> Dict[str, Any]:
    ws = i.workflow_state or "new"
    assignee = i.assignee
    return {
        "id": i.id,
        "code": i.code,
        "title": i.title,
        "severity": i.severity,
        "workflow_state": ws,
        "status": i.status,
        "issue_type": i.issue_type,
        "category": i.category,
        "sla_breached": bool(i.sla_breached),
        # the target date has passed and the issue is still open, worked out now (sla_breached is the flag written when someone last saved it)
        "overdue": bool(ws in OPEN_STATES and i.target_closure_date and i.target_closure_date < now),
        "target_closure_date": i.target_closure_date.isoformat() if i.target_closure_date else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "assignee_id": i.assignee_id,
        "assignee_name": (getattr(assignee, "display_name", None) or getattr(assignee, "full_name", None) or getattr(assignee, "username", None)) if assignee else None,
    }


def _bad_type(source_type: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"source_type must be one of {SOURCE_TYPES}")


def _linked_issues(db: Session, user_tenants: List[int], source_type: str, source_id: int):
    """The issues of this tenant linked to the record: a query on Issue (no duplicate rows, whatever the link table holds)."""
    q = db.query(Issue).filter(Issue.tenant_id.in_(user_tenants))
    if source_type == INCIDENT_SOURCE:
        return q.filter(Issue.source_type == INCIDENT_SOURCE, Issue.source_id == source_id)
    LinkModel, fk_col = SOURCE_DISPATCH[source_type]
    return q.filter(Issue.id.in_(db.query(LinkModel.issue_id).filter(getattr(LinkModel, fk_col) == source_id)))


@router.get("/counts")
def counts_by_source(
    source_type: str = Query(..., alias="type"),
    ids: str = Query(..., description="comma-separated record ids"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Open, critical-open and closed counts for many records of one type in one call (at most 200 ids)."""
    if source_type not in SOURCE_DISPATCH and source_type != INCIDENT_SOURCE:
        raise _bad_type(source_type)
    wanted: List[int] = []
    for part in ids.split(","):
        part = part.strip()
        if part.isdigit() and int(part) > 0 and int(part) not in wanted:
            wanted.append(int(part))
    if not wanted:
        raise HTTPException(status_code=400, detail="ids must list at least one record")
    if len(wanted) > MAX_COUNT_IDS:
        raise HTTPException(status_code=400, detail=f"ask for at most {MAX_COUNT_IDS} records at a time")

    counts = {str(i): {"total_open": 0, "critical_open": 0, "total_closed": 0} for i in wanted}
    user_tenants = get_user_tenants(current_user, db)
    if user_tenants:
        if source_type == INCIDENT_SOURCE:
            rows = db.query(Issue.source_id, Issue.id, Issue.workflow_state, Issue.severity).filter(
                Issue.tenant_id.in_(user_tenants), Issue.source_type == INCIDENT_SOURCE, Issue.source_id.in_(wanted),
            ).distinct().all()
        else:
            LinkModel, fk_col = SOURCE_DISPATCH[source_type]
            fk_attr = getattr(LinkModel, fk_col)
            rows = db.query(fk_attr, Issue.id, Issue.workflow_state, Issue.severity).join(
                Issue, Issue.id == LinkModel.issue_id,
            ).filter(fk_attr.in_(wanted), Issue.tenant_id.in_(user_tenants)).distinct().all()
        for key, _issue_id, state, sev in rows:
            c = counts[str(key)]
            if (state or "new") in OPEN_STATES:
                c["total_open"] += 1
                if (sev or "").lower() == "critical":
                    c["critical_open"] += 1
            else:
                c["total_closed"] += 1
    return {"type": source_type, "counts": counts}


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
    if source_type not in SOURCE_DISPATCH and source_type != INCIDENT_SOURCE:
        raise _bad_type(source_type)
    limit = max(1, min(limit, 1000))
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"source_type": source_type, "source_id": source_id, "open": [], "closed": [], "total_open": 0, "total_closed": 0, "critical_open": 0}

    linked = _linked_issues(db, user_tenants, source_type, source_id)
    open_q = linked.filter(_is_open)
    closed_q = linked.filter(~_is_open)
    total_open = open_q.count()
    critical_open = open_q.filter(func.lower(Issue.severity) == "critical").count()
    total_closed = closed_q.count()

    # Open: critical first, then the oldest first (the order the page has always had); the cut is made in SQL so it never drops a critical one
    rank = case(*[(func.lower(Issue.severity) == word, n) for word, n in _SEV_RANK.items()], else_=9)
    now = datetime.utcnow()
    open_rows = open_q.options(joinedload(Issue.assignee)).order_by(rank, Issue.created_at.asc(), Issue.id.asc()).limit(limit).all()
    closed_rows = (
        closed_q.options(joinedload(Issue.assignee)).order_by(Issue.created_at.desc(), Issue.id.desc()).limit(limit).all()
        if include_closed else []
    )

    return {
        "source_type": source_type,
        "source_id": source_id,
        "open": [_serialize_issue(i, now) for i in open_rows],
        "closed": [_serialize_issue(i, now) for i in closed_rows],
        "total_open": total_open,
        "total_closed": total_closed,
        "critical_open": critical_open,
    }
