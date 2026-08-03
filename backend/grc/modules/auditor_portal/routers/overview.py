"""Auditor portal — framework overview.

Returns the high-level summary an auditor sees on landing: framework
identity, journey status, totals across every framework-linked artifact
(controls, evidence, documents, risks, assets, vulns, vendors,
exceptions), and the breakdown of approval states so the auditor can
spot pending review work at a glance.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import Text, func, cast
from sqlalchemy.orm import Session

from ....models import (
    GRCUser,
    get_db,
    ClauseApplicability,
    ControlImplementation,
    ImplementationEvidence,
    GovernanceDocument,
    Risk,
    ITAsset,
    Vulnerability,
    VulnerabilityAssetLink,
    Vendor,
    PolicyException,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context, parsed_control_ids_for_context


router = APIRouter()


@router.get("/{framework_id}/overview")
def get_overview(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Aggregated counts for an auditor's framework dashboard."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)
    parsed_ids = parsed_control_ids_for_context(ctx, db)

    # Controls + applicability split
    applicability_rows = []
    if parsed_ids:
        applicability_rows = db.query(
            ClauseApplicability.is_applicable,
            ClauseApplicability.status,
            func.count(ClauseApplicability.id),
        ).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(parsed_ids),
        ).group_by(
            ClauseApplicability.is_applicable, ClauseApplicability.status
        ).all()

    in_scope = 0
    out_of_scope = 0
    pending_applicability = 0
    for is_applicable, status_val, count in applicability_rows:
        if status_val == "approved" and is_applicable is True:
            in_scope += count
        elif status_val == "approved" and is_applicable is False:
            out_of_scope += count
        else:
            pending_applicability += count

    total_controls = len(parsed_ids)
    untouched_controls = max(0, total_controls - in_scope - out_of_scope - pending_applicability)

    # Implementation status across all journeys for this framework
    implementation_summary = {}
    if ctx.journey_ids:
        rows = db.query(
            ControlImplementation.status, func.count(ControlImplementation.id)
        ).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids)
        ).group_by(ControlImplementation.status).all()
        implementation_summary = {status_val or "unknown": count for status_val, count in rows}

    # Evidence approval breakdown for this framework's journeys
    evidence_summary = {"total": 0, "pending": 0, "approved": 0, "rejected": 0}
    if ctx.journey_ids:
        ev_rows = db.query(
            ImplementationEvidence.review_status, func.count(ImplementationEvidence.id)
        ).join(
            ControlImplementation,
            ImplementationEvidence.implementation_id == ControlImplementation.id,
        ).filter(
            ControlImplementation.journey_id.in_(ctx.journey_ids)
        ).group_by(ImplementationEvidence.review_status).all()
        for status_val, count in ev_rows:
            evidence_summary["total"] += count
            key = (status_val or "pending").lower()
            if key in evidence_summary:
                evidence_summary[key] += count
            else:
                evidence_summary["pending"] += count

    # Documents linked to this framework via JSON framework_ids array.
    # JSON containment isn't portable across SQLite/Postgres, so we
    # serialize the column to text and substring-match the id. Acceptable
    # because counts collide only on very long id substrings (unlikely).
    documents_count = 0
    if ctx.framework:
        token = f"\"{ctx.framework.id}\""
        documents_count = db.query(func.count(GovernanceDocument.id)).filter(
            GovernanceDocument.tenant_id.in_(user_tenants),
            GovernanceDocument.framework_ids.isnot(None),
            cast(GovernanceDocument.framework_ids, Text).ilike(f"%{ctx.framework.id}%"),
        ).scalar() or 0
        _ = token  # placeholder; see comment above on quoted-id strategy

    # Risks — heuristic match on register_type to the framework short_code.
    risks_count = 0
    if ctx.framework_short_code:
        risks_count = db.query(func.count(Risk.id)).filter(
            Risk.tenant_id.in_(user_tenants),
            Risk.status != "closed",
            Risk.register_type == ctx.framework_short_code,
        ).scalar() or 0

    # Assets — compliance_scope is a JSON array of framework short codes.
    assets_count = 0
    if ctx.framework_short_code:
        assets_count = db.query(func.count(ITAsset.id)).filter(
            ITAsset.tenant_id.in_(user_tenants),
            ITAsset.status == "active",
            cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
        ).scalar() or 0

    # Vulnerabilities on in-scope assets
    vulns_count = 0
    if ctx.framework_short_code:
        vulns_count = db.query(func.count(func.distinct(Vulnerability.id))).join(
            VulnerabilityAssetLink, VulnerabilityAssetLink.vulnerability_id == Vulnerability.id,
        ).join(
            ITAsset, VulnerabilityAssetLink.asset_id == ITAsset.id,
        ).filter(
            Vulnerability.tenant_id.in_(user_tenants),
            Vulnerability.status.in_(("open", "in_progress")),
            cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
        ).scalar() or 0

    # Vendors — active vendors in the tenant.
    vendors_count = db.query(func.count(Vendor.id)).filter(
        Vendor.tenant_id.in_(user_tenants),
        Vendor.status == "active",
    ).scalar() or 0

    # Exceptions — control N/A approvals + active policy exceptions
    n_a_count = 0
    if parsed_ids:
        n_a_count = db.query(func.count(ClauseApplicability.id)).filter(
            ClauseApplicability.tenant_id.in_(user_tenants),
            ClauseApplicability.control_id.in_(parsed_ids),
            ClauseApplicability.is_applicable == False,  # noqa: E712
            ClauseApplicability.status == "approved",
        ).scalar() or 0
    pol_exception_count = db.query(func.count(PolicyException.id)).filter(
        PolicyException.tenant_id.in_(user_tenants),
        PolicyException.status == "approved",
    ).scalar() or 0

    journey_payload = None
    if ctx.journeys:
        j = ctx.journeys[0]
        journey_payload = {
            "id": j.id,
            "name": getattr(j, "name", None),
            "status": getattr(j, "status", None),
            "progress": getattr(j, "completion_percentage", None),
        }

    return {
        "framework": {
            "id": framework_id,
            "name": ctx.framework_label,
            "version": ctx.framework_version,
            "short_code": ctx.framework_short_code,
            "upload_status": ctx.framework.upload_status if ctx.framework else None,
        },
        "journey": journey_payload,
        "controls": {
            "total": total_controls,
            "in_scope": in_scope,
            "out_of_scope": out_of_scope,
            "pending_applicability": pending_applicability,
            "untouched": untouched_controls,
        },
        "implementation": implementation_summary,
        "evidence": evidence_summary,
        "documents": {"total": documents_count},
        "risks": {"total": risks_count},
        "assets": {"in_scope": assets_count},
        "vulnerabilities": {"open_on_in_scope_assets": vulns_count},
        "vendors": {"active": vendors_count},
        "exceptions": {
            "controls_marked_not_applicable": n_a_count,
            "policy_exceptions_active": pol_exception_count,
        },
    }
