"""Auditor portal — non-control framework artifacts.

Documents, risks, assets, vulnerabilities, and vendors. Each section
returns the *list of items linked to this framework* with only the fields
an auditor cares about (title, status, owner, last-touched). Heavy detail
is fetched from the existing module-owned detail endpoints by following
the `id` on each row.

Linkage strategy per section is documented inline — each module ties to
frameworks differently (direct FK / JSON array / heuristic by short_code).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Text, cast, func
from sqlalchemy.orm import Session, joinedload

from sqlalchemy import or_

from ....models import (
    GRCUser,
    get_db,
    GovernanceDocument,
    Risk,
    ITAsset,
    Vulnerability,
    VulnerabilityAssetLink,
    Vendor,
    FrameworkRiskAssessment,
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..helpers import resolve_framework_context


router = APIRouter()


# ---- Documents -------------------------------------------------------

@router.get("/{framework_id}/documents")
def list_documents(
    framework_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Governance documents that include this framework in their
    `framework_ids` JSON array (multi-framework policies are picked up
    once per framework they're tagged to)."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    if not ctx.framework:
        return {"documents": [], "total": 0}

    # Pull all docs for the tenant, then filter in Python by parsing the
    # JSON. This avoids DB-specific JSON containment operators.
    docs = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.framework_ids.isnot(None),
    ).order_by(GovernanceDocument.updated_at.desc().nullslast()).all()

    framework_id_int = ctx.framework.id
    out = []
    for d in docs:
        fids = d.framework_ids or []
        try:
            normalized = {int(v) for v in fids if v is not None}
        except (TypeError, ValueError):
            normalized = set()
        if framework_id_int not in normalized:
            continue
        if status_filter and (d.status or "").lower() != status_filter.lower():
            continue
        out.append({
            "id": d.id,
            "title": d.title,
            "doc_type": d.doc_type,
            "doc_sub_type": d.doc_sub_type,
            "status": d.status,
            "current_version": d.current_version,
            "owner_id": d.owner_id,
            "owner_name": getattr(d, "owner_name", None),
            "effective_date": d.effective_date,
            "review_date": getattr(d, "next_review_date", None),
            "updated_at": d.updated_at,
            # Surface enough to drive an in-place preview + annotation UI
            # from the auditor portal Documents tab. Content-only AI
            # drafts have no file_path; the viewer renders `content`
            # directly as markdown/text when that's the case.
            "file_path": d.file_path,
            "file_name": d.file_name,
            "file_type": d.file_type,
            "has_content": bool((d.content or "").strip()),
        })

    return {"documents": out, "total": len(out)}


# ---- Risks -----------------------------------------------------------

@router.get("/{framework_id}/risks")
def list_risks(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Risks tied to this framework.

    Matches a risk to a framework via any of:
      1. `Risk.register_type` equals the framework's short_code
         (e.g. "SWIFT", "PCI-DSS") — what manual + new-write risks carry.
      2. `Risk.register_type` equals the framework's full name —
         covers UploadedFramework rows that have no short_code today.
      3. `Risk.source_reference == "framework_assessment:<id>"` for any
         FrameworkRiskAssessment row tied to this framework — covers
         legacy risks that were tagged with the generic
         `"Framework Assessment #<id>"` register_type before this fix.
      4. `Risk.register_type` equals legacy `"Framework Assessment #<id>"`
         — same legacy coverage, via register_type rather than provenance.

    OR-ing these candidates means both new risks (correctly tagged) and
    pre-fix legacy risks surface here without a backfill being required."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    # Build the set of register_type strings that could legitimately tag
    # a risk to this framework.
    register_type_candidates: list[str] = []
    if ctx.framework_short_code:
        register_type_candidates.append(ctx.framework_short_code)
    label = ctx.framework_label
    if label and label not in register_type_candidates and label != "Unknown Framework":
        register_type_candidates.append(label)

    # Pre-fix risks were tagged with `"Framework Assessment #<id>"`. Find
    # every FrameworkRiskAssessment for this framework so we can match
    # both that legacy tag and the new `source_reference` provenance tag.
    assessment_ids: list[int] = []
    q = db.query(FrameworkRiskAssessment.id).filter(
        FrameworkRiskAssessment.tenant_id.in_(user_tenants),
    )
    fw_filters = []
    if ctx.framework is not None:
        fw_filters.append(FrameworkRiskAssessment.uploaded_framework_id == ctx.framework.id)
    if ctx.published_framework is not None:
        fw_filters.append(FrameworkRiskAssessment.framework_id == ctx.published_framework.id)
    if fw_filters:
        assessment_ids = [r[0] for r in q.filter(or_(*fw_filters)).all()]
    legacy_register_tags = [f"Framework Assessment #{aid}" for aid in assessment_ids]
    source_refs = [f"framework_assessment:{aid}" for aid in assessment_ids]

    filter_clauses = []
    if register_type_candidates:
        filter_clauses.append(Risk.register_type.in_(register_type_candidates))
    if legacy_register_tags:
        filter_clauses.append(Risk.register_type.in_(legacy_register_tags))
    if source_refs:
        filter_clauses.append(Risk.source_reference.in_(source_refs))

    if not filter_clauses:
        return {"risks": [], "total": 0, "framework_short_code": ctx.framework_short_code}

    risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        or_(*filter_clauses),
    ).order_by(Risk.inherent_score.desc().nullslast(), Risk.id.desc()).all()

    out = [
        {
            "id": r.id,
            "title": r.title,
            "category": r.category,
            "risk_sub_category": r.risk_sub_category,
            "status": r.status,
            "owner_id": r.owner_id,
            "inherent_score": r.inherent_score,
            "residual_score": r.residual_score,
            "risk_appetite": r.risk_appetite,
            "source_type": r.source_type,
            "due_date": r.due_date,
            "updated_at": r.updated_at,
        }
        for r in risks
    ]
    return {
        "risks": out,
        "total": len(out),
        "framework_short_code": ctx.framework_short_code,
    }


# ---- Assets ----------------------------------------------------------

@router.get("/{framework_id}/assets")
def list_assets(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Assets where ITAsset.compliance_scope (JSON array of framework
    short-codes) contains this framework's short_code."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    if not ctx.framework_short_code:
        return {"assets": [], "total": 0}

    candidates = db.query(ITAsset).filter(
        ITAsset.tenant_id.in_(user_tenants),
        ITAsset.compliance_scope.isnot(None),
        cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
    ).all()

    sc = ctx.framework_short_code.lower()
    out = []
    for a in candidates:
        scope = a.compliance_scope or []
        try:
            normalized = {str(v).lower() for v in scope}
        except Exception:
            normalized = set()
        if sc not in normalized:
            continue
        out.append({
            "id": a.id,
            "name": a.name,
            "host_name": getattr(a, "host_name", None),
            "ip_address": getattr(a, "ip_address", None),
            "asset_type": a.asset_type,
            "criticality": a.criticality,
            "status": a.status,
            "owner_id": getattr(a, "owner_id", None),
            "vendor": getattr(a, "vendor", None),
            "compliance_scope": a.compliance_scope,
            "cde_environment": getattr(a, "cde_environment", None),
            "updated_at": a.updated_at,
        })

    return {"assets": out, "total": len(out)}


# ---- Vulnerabilities -------------------------------------------------

@router.get("/{framework_id}/vulnerabilities")
def list_vulnerabilities(
    framework_id: int,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Vulnerabilities on assets that include this framework in their
    compliance_scope. Returns the union, deduplicated."""
    user_tenants = get_user_tenants(current_user, db)
    ctx = resolve_framework_context(framework_id, user_tenants, db)

    if not ctx.framework_short_code:
        return {"vulnerabilities": [], "total": 0}

    rows = db.query(Vulnerability).join(
        VulnerabilityAssetLink,
        VulnerabilityAssetLink.vulnerability_id == Vulnerability.id,
    ).join(
        ITAsset, VulnerabilityAssetLink.asset_id == ITAsset.id,
    ).filter(
        Vulnerability.tenant_id.in_(user_tenants),
        cast(ITAsset.compliance_scope, Text).ilike(f"%{ctx.framework_short_code}%"),
    ).distinct().all()

    sc = ctx.framework_short_code.lower()
    out = []
    seen = set()
    for v in rows:
        if v.id in seen:
            continue
        seen.add(v.id)
        if severity and (v.severity or "").lower() != severity.lower():
            continue
        if status_filter and (v.status or "").lower() != status_filter.lower():
            continue
        out.append({
            "id": v.id,
            "cve_id": getattr(v, "cve_id", None),
            "title": v.title,
            "severity": v.severity,
            "status": v.status,
            "cvss_score": getattr(v, "cvss_score", None),
            "epss_score": getattr(v, "epss_score", None),
            "kev_flag": getattr(v, "kev_flag", None),
            "composite_priority": getattr(v, "composite_priority", None),
            "affected_host": getattr(v, "affected_host", None),
            "due_date": getattr(v, "due_date", None),
            "updated_at": v.updated_at,
        })

    return {"vulnerabilities": out, "total": len(out)}


# ---- Vendors ---------------------------------------------------------

@router.get("/{framework_id}/vendors")
def list_vendors(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Active vendors in the tenant. Vendors don't have a direct framework
    FK in this schema — the auditor sees them all and uses the vendor
    assessment data (if any) to judge framework relevance. The list stays
    tenant-scoped via `get_user_tenants`."""
    user_tenants = get_user_tenants(current_user, db)
    # Resolve context just to enforce tenant scoping + 404 on bad IDs
    resolve_framework_context(framework_id, user_tenants, db)

    rows = db.query(Vendor).filter(
        Vendor.tenant_id.in_(user_tenants),
        Vendor.status == "active",
    ).order_by(Vendor.name.asc()).all()

    out = [
        {
            "id": v.id,
            "name": v.name,
            "vendor_type": getattr(v, "vendor_type", None),
            "criticality": getattr(v, "criticality", None),
            "risk_tier": getattr(v, "risk_tier", None),
            "status": v.status,
            "data_classification_access": getattr(v, "data_classification_access", None),
            "contract_expiry": getattr(v, "contract_end_date", None) or getattr(v, "contract_expiry", None),
            "last_assessed_at": getattr(v, "last_assessed_at", None),
            "updated_at": v.updated_at,
        }
        for v in rows
    ]
    return {"vendors": out, "total": len(out)}
