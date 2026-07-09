from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_, extract

from ....models import (
    GovernanceDocument, DocumentApprovalStep, DocumentControlLink,
    DocumentRegulatoryLink, GRCUser, Framework, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/dashboard", tags=["Governance Dashboard"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    from fastapi import HTTPException, status
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


@router.get("/summary")
def get_dashboard_summary(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_documents": 0,
            "by_type": {},
            "by_status": {},
            "by_classification": {}
        }
    
    query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    documents = query.all()
    
    by_type = {}
    by_status = {}
    by_classification = {}
    
    for doc in documents:
        doc_type = doc.doc_type or "other"
        by_type[doc_type] = by_type.get(doc_type, 0) + 1
        
        status_val = doc.status or "draft"
        by_status[status_val] = by_status.get(status_val, 0) + 1
        
        classification = doc.classification or "internal"
        by_classification[classification] = by_classification.get(classification, 0) + 1
    
    return {
        "total_documents": len(documents),
        "by_type": by_type,
        "by_status": by_status,
        "by_classification": by_classification
    }


@router.get("/compliance-coverage")
def get_compliance_coverage(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_documents": 0,
            "linked_to_controls": 0,
            "linked_to_frameworks": 0,
            "control_coverage_percent": 0.0,
            "framework_coverage_percent": 0.0,
            "overall_coverage_percent": 0.0
        }
    
    query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    total_documents = query.count()
    
    if total_documents == 0:
        return {
            "total_documents": 0,
            "linked_to_controls": 0,
            "linked_to_frameworks": 0,
            "control_coverage_percent": 0.0,
            "framework_coverage_percent": 0.0,
            "overall_coverage_percent": 0.0
        }
    
    documents_with_controls = db.query(func.count(func.distinct(DocumentControlLink.document_id))).join(
        GovernanceDocument, DocumentControlLink.document_id == GovernanceDocument.id
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    documents_with_frameworks = db.query(func.count(func.distinct(DocumentRegulatoryLink.document_id))).join(
        GovernanceDocument, DocumentRegulatoryLink.document_id == GovernanceDocument.id
    ).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        documents_with_controls = documents_with_controls.filter(GovernanceDocument.tenant_id == tenant_id)
        documents_with_frameworks = documents_with_frameworks.filter(GovernanceDocument.tenant_id == tenant_id)
    
    linked_to_controls = documents_with_controls.scalar() or 0
    
    documents = query.all()
    docs_with_any_link = 0
    docs_with_framework_link = 0
    for doc in documents:
        has_control = db.query(DocumentControlLink).filter(DocumentControlLink.document_id == doc.id).first() is not None
        has_framework = db.query(DocumentRegulatoryLink).filter(DocumentRegulatoryLink.document_id == doc.id).first() is not None
        has_framework_ids = doc.framework_ids and len(doc.framework_ids) > 0
        if has_framework or has_framework_ids:
            docs_with_framework_link += 1
        if has_control or has_framework or has_framework_ids:
            docs_with_any_link += 1

    linked_to_frameworks = docs_with_framework_link
    
    return {
        "total_documents": total_documents,
        "linked_to_controls": linked_to_controls,
        "linked_to_frameworks": linked_to_frameworks,
        "control_coverage_percent": round((linked_to_controls / total_documents) * 100, 1),
        "framework_coverage_percent": round((linked_to_frameworks / total_documents) * 100, 1),
        "overall_coverage_percent": round((docs_with_any_link / total_documents) * 100, 1)
    }


@router.get("/expiring-soon")
def get_expiring_soon(
    tenant_id: Optional[int] = None,
    days: int = Query(30, description="Number of days to look ahead (30, 60, or 90)"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"count": 0, "documents": [], "by_timeframe": {"30_days": 0, "60_days": 0, "90_days": 0}}
    
    now = datetime.utcnow()
    
    query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.expiry_date.isnot(None),
        GovernanceDocument.expiry_date >= now
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    end_30 = now + timedelta(days=30)
    end_60 = now + timedelta(days=60)
    end_90 = now + timedelta(days=90)
    end_requested = now + timedelta(days=days)
    
    count_30 = query.filter(GovernanceDocument.expiry_date <= end_30).count()
    count_60 = query.filter(GovernanceDocument.expiry_date <= end_60).count()
    count_90 = query.filter(GovernanceDocument.expiry_date <= end_90).count()
    
    documents = query.filter(GovernanceDocument.expiry_date <= end_requested).order_by(
        GovernanceDocument.expiry_date.asc()
    ).limit(50).all()
    
    docs_list = []
    for doc in documents:
        days_until = (doc.expiry_date - now).days if doc.expiry_date else None
        docs_list.append({
            "id": doc.id,
            "document_code": doc.document_code,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "status": doc.status,
            "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else None,
            "days_until_expiry": days_until,
            "owner_id": doc.owner_id
        })
    
    return {
        "count": len(documents),
        "documents": docs_list,
        "by_timeframe": {
            "30_days": count_30,
            "60_days": count_60,
            "90_days": count_90
        }
    }


@router.get("/pending-approvals")
def get_pending_approvals(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"count": 0, "approvals": []}
    
    query = db.query(DocumentApprovalStep).join(
        GovernanceDocument, DocumentApprovalStep.document_id == GovernanceDocument.id
    ).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        DocumentApprovalStep.status == "pending"
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    pending_steps = query.order_by(DocumentApprovalStep.requested_at.desc()).limit(50).all()
    
    approvals_list = []
    for step in pending_steps:
        doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == step.document_id).first()
        approver = db.query(GRCUser).filter(GRCUser.id == step.approver_id).first() if step.approver_id else None
        
        is_overdue = step.due_date and step.due_date < datetime.utcnow()
        
        approvals_list.append({
            "id": step.id,
            "document_id": step.document_id,
            "document_code": doc.document_code if doc else None,
            "document_title": doc.title if doc else None,
            "doc_type": doc.doc_type if doc else None,
            "step_sequence": step.step_sequence,
            "step_name": step.step_name,
            "approver_id": step.approver_id,
            "approver_name": approver.display_name if approver else None,
            "approver_role": step.approver_role,
            "requested_at": step.requested_at.isoformat() if step.requested_at else None,
            "due_date": step.due_date.isoformat() if step.due_date else None,
            "is_overdue": is_overdue
        })
    
    total_count = query.count()
    
    return {
        "count": total_count,
        "approvals": approvals_list
    }


@router.get("/overdue-reviews")
def get_overdue_reviews(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"count": 0, "documents": []}
    
    now = datetime.utcnow()
    
    query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date < now,
        GovernanceDocument.status.in_(["approved", "published"])
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    overdue_docs = query.order_by(GovernanceDocument.next_review_date.asc()).limit(50).all()
    
    docs_list = []
    for doc in overdue_docs:
        days_overdue = (now - doc.next_review_date).days if doc.next_review_date else 0
        owner = db.query(GRCUser).filter(GRCUser.id == doc.owner_id).first() if doc.owner_id else None
        
        docs_list.append({
            "id": doc.id,
            "document_code": doc.document_code,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "status": doc.status,
            "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
            "days_overdue": days_overdue,
            "owner_id": doc.owner_id,
            "owner_name": owner.display_name if owner else None,
            "last_reviewed_at": doc.last_reviewed_at.isoformat() if doc.last_reviewed_at else None
        })
    
    total_count = query.count()
    
    return {
        "count": total_count,
        "documents": docs_list
    }


@router.get("/recently-published")
def get_recently_published(
    tenant_id: Optional[int] = None,
    limit: int = Query(10, le=50),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"count": 0, "documents": []}
    
    query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.status == "published",
        GovernanceDocument.published_at.isnot(None)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    documents = query.order_by(GovernanceDocument.published_at.desc()).limit(limit).all()
    
    docs_list = []
    for doc in documents:
        publisher = db.query(GRCUser).filter(GRCUser.id == doc.published_by).first() if doc.published_by else None
        owner = db.query(GRCUser).filter(GRCUser.id == doc.owner_id).first() if doc.owner_id else None
        
        docs_list.append({
            "id": doc.id,
            "document_code": doc.document_code,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "classification": doc.classification,
            "current_version": doc.current_version,
            "published_at": doc.published_at.isoformat() if doc.published_at else None,
            "published_by": doc.published_by,
            "publisher_name": publisher.display_name if publisher else None,
            "owner_id": doc.owner_id,
            "owner_name": owner.display_name if owner else None
        })
    
    return {
        "count": len(documents),
        "documents": docs_list
    }


@router.get("/by-framework")
def get_documents_by_framework(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"frameworks": [], "unlinked_count": 0}
    
    query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    documents = query.all()
    
    framework_counts = {}
    unlinked_count = 0
    
    for doc in documents:
        doc_linked = False
        
        if doc.framework_ids and len(doc.framework_ids) > 0:
            for fw_id in doc.framework_ids:
                if fw_id not in framework_counts:
                    framework = db.query(Framework).filter(Framework.id == fw_id).first()
                    framework_counts[fw_id] = {
                        "framework_id": fw_id,
                        "framework_name": framework.name if framework else f"Framework {fw_id}",
                        "framework_code": framework.short_code if framework else None,
                        "document_count": 0
                    }
                framework_counts[fw_id]["document_count"] += 1
                doc_linked = True
        
        reg_links = db.query(DocumentRegulatoryLink).filter(
            DocumentRegulatoryLink.document_id == doc.id
        ).all()
        
        for link in reg_links:
            if link.framework_id:
                if link.framework_id not in framework_counts:
                    framework = db.query(Framework).filter(Framework.id == link.framework_id).first()
                    framework_counts[link.framework_id] = {
                        "framework_id": link.framework_id,
                        "framework_name": framework.name if framework else f"Framework {link.framework_id}",
                        "framework_code": framework.short_code if framework else None,
                        "document_count": 0
                    }
                framework_counts[link.framework_id]["document_count"] += 1
                doc_linked = True
        
        if not doc_linked:
            unlinked_count += 1
    
    frameworks_list = sorted(
        framework_counts.values(),
        key=lambda x: x["document_count"],
        reverse=True
    )
    
    return {
        "frameworks": frameworks_list,
        "unlinked_count": unlinked_count,
        "total_documents": len(documents)
    }


@router.get("/trends")
def get_document_trends(
    tenant_id: Optional[int] = None,
    months: int = Query(12, le=24, description="Number of months to look back"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"created": [], "published": []}
    
    now = datetime.utcnow()
    start_date = now - timedelta(days=months * 30)
    
    query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    created_query = query.filter(GovernanceDocument.created_at >= start_date)
    published_query = query.filter(
        GovernanceDocument.published_at >= start_date,
        GovernanceDocument.published_at.isnot(None)
    )
    
    created_docs = created_query.all()
    published_docs = published_query.all()
    
    created_by_month = {}
    published_by_month = {}
    
    for doc in created_docs:
        if doc.created_at:
            month_key = doc.created_at.strftime("%Y-%m")
            created_by_month[month_key] = created_by_month.get(month_key, 0) + 1
    
    for doc in published_docs:
        if doc.published_at:
            month_key = doc.published_at.strftime("%Y-%m")
            published_by_month[month_key] = published_by_month.get(month_key, 0) + 1
    
    all_months = set(created_by_month.keys()) | set(published_by_month.keys())
    
    created_series = []
    published_series = []
    
    for month in sorted(all_months):
        created_series.append({
            "month": month,
            "count": created_by_month.get(month, 0)
        })
        published_series.append({
            "month": month,
            "count": published_by_month.get(month, 0)
        })
    
    return {
        "created": created_series,
        "published": published_series,
        "summary": {
            "total_created": sum(created_by_month.values()),
            "total_published": sum(published_by_month.values()),
            "period_months": months
        }
    }


@router.get("/compliance-by-framework")
def get_compliance_by_framework(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    from ....models import PolicyGapAnalysisRun, UploadedFramework

    frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_active == True
    ).all()

    results = []
    for fw in frameworks:
        latest_run = db.query(PolicyGapAnalysisRun).filter(
            PolicyGapAnalysisRun.uploaded_framework_id == fw.id,
            PolicyGapAnalysisRun.status == "completed"
        ).order_by(PolicyGapAnalysisRun.completed_at.desc()).first()

        results.append({
            "framework_id": fw.id,
            "framework_name": fw.name,
            "compliance_percentage": latest_run.compliance_percentage if latest_run else None,
            "total_clauses": latest_run.total_clauses_analyzed if latest_run else 0,
            "fully_compliant": latest_run.fully_compliant_count if latest_run else 0,
            "partially_compliant": latest_run.partially_compliant_count if latest_run else 0,
            "not_addressed": latest_run.not_addressed_count if latest_run else 0,
            "last_assessed": latest_run.completed_at.isoformat() if latest_run and latest_run.completed_at else None
        })

    return {"frameworks": results}


@router.get("/open-gaps-summary")
def get_open_gaps_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    from ....models import PolicyGapFinding
    user_tenants = get_user_tenants(current_user, db)

    gaps = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.tenant_id.in_(user_tenants),
        PolicyGapFinding.remediation_status == "open"
    ).all()

    by_severity = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    by_framework = {}
    aging = {"0_30_days": 0, "31_60_days": 0, "61_90_days": 0, "over_90_days": 0}
    now = datetime.utcnow()

    for gap in gaps:
        severity = gap.risk_severity or "medium"
        by_severity[severity] = by_severity.get(severity, 0) + 1

        fw_name = gap.framework_name or "Unknown"
        by_framework[fw_name] = by_framework.get(fw_name, 0) + 1

        if gap.created_at:
            age_days = (now - gap.created_at).days
            if age_days <= 30:
                aging["0_30_days"] += 1
            elif age_days <= 60:
                aging["31_60_days"] += 1
            elif age_days <= 90:
                aging["61_90_days"] += 1
            else:
                aging["over_90_days"] += 1

    return {
        "total_open_gaps": len(gaps),
        "by_severity": by_severity,
        "by_framework": by_framework,
        "aging_analysis": aging
    }


@router.get("/remediation-progress")
def get_remediation_progress(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    from ....models import PolicyGapFinding
    user_tenants = get_user_tenants(current_user, db)

    all_findings = db.query(PolicyGapFinding).filter(
        PolicyGapFinding.tenant_id.in_(user_tenants),
        PolicyGapFinding.compliance_status.in_(["partially_compliant", "not_addressed"])
    ).all()

    total = len(all_findings)
    open_count = sum(1 for f in all_findings if f.remediation_status == "open")
    in_progress = sum(1 for f in all_findings if f.remediation_status == "in_progress")
    closed = sum(1 for f in all_findings if f.remediation_status == "closed")

    return {
        "total_findings": total,
        "open": open_count,
        "in_progress": in_progress,
        "closed": closed,
        "progress_percentage": round((closed / total) * 100, 1) if total > 0 else 0
    }


@router.get("/upcoming-reviews")
def get_upcoming_reviews_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    now = datetime.utcnow()
    cutoff = now + timedelta(days=90)

    documents = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date != None,
        GovernanceDocument.next_review_date <= cutoff,
        GovernanceDocument.status != "retired"
    ).order_by(GovernanceDocument.next_review_date.asc()).limit(10).all()

    results = []
    for doc in documents:
        is_overdue = doc.next_review_date < now if doc.next_review_date else False
        results.append({
            "id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
            "is_overdue": is_overdue,
            "days_until": (doc.next_review_date - now).days if doc.next_review_date else None,
            "review_cycle_months": doc.review_cycle_months
        })

    return {
        "overdue_count": sum(1 for r in results if r["is_overdue"]),
        "upcoming": results
    }


@router.get("/accepted-risks")
def get_accepted_risks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    from ....models import Risk
    user_tenants = get_user_tenants(current_user, db)

    accepted_risks = db.query(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        Risk.status == "accepted"
    ).all()

    def get_risk_level(risk):
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            return "critical"
        elif score >= 15:
            return "high"
        elif score >= 8:
            return "medium"
        else:
            return "low"

    by_level = {}
    for risk in accepted_risks:
        level = get_risk_level(risk)
        by_level[level] = by_level.get(level, 0) + 1

    return {
        "total_accepted": len(accepted_risks),
        "by_risk_level": by_level,
        "risks": [{
            "id": r.id,
            "title": r.title,
            "risk_level": get_risk_level(r),
            "residual_score": r.residual_score,
        } for r in accepted_risks[:10]]
    }


@router.get("/documents-overview")
def get_documents_overview(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Deep per-section dashboard for the Governance / Documents module.

    Every functional area of the module (Documents register, Mappings,
    Approvals & Sign-off, Reviews, Exceptions, Attestations, Committees) is a
    SECTION with its own metrics computed from that area's own entities. Each
    metric carries key/label/score/weight/numerator/denominator/formula so the
    UI renders backend truth and never invents math.

    Scoring rules:
      - achievement metrics (coverage, completion): empty universe -> score None
        (excluded; the section re-normalizes remaining weights)
      - health metrics (1 - bad/universe): empty universe -> 100 (no obligations)
      - section.score  = weighted mean of its non-null metrics
      - performance.score = weighted mean of non-null section scores
    Weights and the 85 target live here, never in the frontend.
    """
    from sqlalchemy.exc import SQLAlchemyError
    from ....models import (
        DocumentRiskLink, DocumentAssetLink, PolicyException,
        PolicyReviewHistory, PolicyGapFinding, PolicyStatement,
        StatementControlMapping, DocumentSignature, DocumentSignoffAssignment,
        PolicyStatementCompliance, DocumentAttestation, GovernanceActionReview,
        AttestationCampaign, AttestationRequest,
        GovernanceCommittee, CommitteeMeeting, MeetingMinutes, OversightAction,
        CommitteeCharter, CommitteeMember,
        RiskKRI, Risk, ISProject, ISProjectMilestone,
        ComplianceAssessmentDocument, ComplianceAssessmentDocumentItem,
    )

    user_tenants = get_user_tenants(current_user, db)
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        scoped = [tenant_id]
    else:
        scoped = user_tenants

    now = datetime.utcnow()

    def metric(key, label, weight, num, den, formula, inverse=False, empty_score=None):
        """inverse=True scores 1 - num/den (num counts the bad items)."""
        if den:
            pct = (num / den) * 100
            score = round(100 - pct, 1) if inverse else round(pct, 1)
        else:
            score = empty_score
        return {"key": key, "label": label, "weight": weight, "score": score,
                "numerator": num, "denominator": den, "formula": formula,
                "inverse": inverse, "target": 85}

    def section_score(metrics):
        avail = [m for m in metrics if m["score"] is not None]
        total_w = sum(m["weight"] for m in avail)
        if not avail or not total_w:
            return None
        return round(sum(m["score"] * m["weight"] for m in avail) / total_w, 1)

    if not scoped:
        return {"as_of": now.isoformat(), "sections": {}, "attention_queue": {},
                "performance": {"score": None, "grade": None, "components": []}}

    # ================= raw reads (each group guarded so one missing =========
    # ================= table never 500s the whole dashboard)        =========
    docs = db.query(
        GovernanceDocument.id, GovernanceDocument.status, GovernanceDocument.doc_type,
        GovernanceDocument.classification, GovernanceDocument.owner_id,
        GovernanceDocument.review_cycle_months, GovernanceDocument.next_review_date,
        GovernanceDocument.expiry_date, GovernanceDocument.framework_ids,
        GovernanceDocument.file_path,
        GovernanceDocument.content.isnot(None).label("has_content"),
    ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()

    try:
        applicable_rows = db.query(
            GovernanceDocument.id, GovernanceDocument.applicable_framework_ids
        ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()
        applicable_map = {r.id: (r.applicable_framework_ids or []) for r in applicable_rows}
    except SQLAlchemyError:
        db.rollback()
        applicable_map = {}

    by_status, by_type, by_classification = {}, {}, {}
    for d in docs:
        by_status[d.status or "draft"] = by_status.get(d.status or "draft", 0) + 1
        by_type[d.doc_type or "other"] = by_type.get(d.doc_type or "other", 0) + 1
        by_classification[d.classification or "internal"] = by_classification.get(d.classification or "internal", 0) + 1

    total_docs = len(docs)
    active_docs = [d for d in docs if (d.status or "draft") != "archived"]
    active_count = len(active_docs)
    active_ids = {d.id for d in active_docs}
    published_docs = [d for d in docs if d.status == "published"]
    published_count = len(published_docs)
    published_ids = {d.id for d in published_docs}

    # ---- link tables -----------------------------------------------------
    def link_stats(model):
        try:
            rows = db.query(model.document_id).join(
                GovernanceDocument, model.document_id == GovernanceDocument.id
            ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()
            ids = [r.document_id for r in rows]
            return len(ids), set(ids)
        except SQLAlchemyError:
            db.rollback()
            return 0, set()

    control_links, control_doc_ids = link_stats(DocumentControlLink)
    risk_links, risk_doc_ids = link_stats(DocumentRiskLink)
    reg_links, reg_doc_ids = link_stats(DocumentRegulatoryLink)
    asset_links, asset_doc_ids = link_stats(DocumentAssetLink)
    fw_tag_ids = {d.id for d in docs if d.framework_ids and len(d.framework_ids) > 0}
    fw_tag_ids |= {doc_id for doc_id, fws in applicable_map.items() if fws}
    framework_doc_ids = reg_doc_ids | fw_tag_ids

    any_link_ids = (control_doc_ids | risk_doc_ids | framework_doc_ids | asset_doc_ids) & active_ids
    mapped_count = len(any_link_ids)

    # ---- policy statements + statement-level control mappings -------------
    try:
        stmt_rows = db.query(PolicyStatement.id, PolicyStatement.document_id).filter(
            PolicyStatement.tenant_id.in_(scoped),
            PolicyStatement.status == "active"
        ).all()
        stmt_ids = {r.id for r in stmt_rows}
        docs_with_statements = {r.document_id for r in stmt_rows}
        sm_rows = db.query(
            StatementControlMapping.statement_id, StatementControlMapping.coverage_type
        ).filter(StatementControlMapping.tenant_id.in_(scoped)).all()
        mapped_stmt_ids = {r.statement_id for r in sm_rows} & stmt_ids
        stmt_mappings_total = len(sm_rows)
        stmt_mappings_full = sum(1 for r in sm_rows if r.coverage_type == "full")
    except SQLAlchemyError:
        db.rollback()
        stmt_ids, docs_with_statements, mapped_stmt_ids = set(), set(), set()
        stmt_mappings_total, stmt_mappings_full = 0, 0

    # ---- statement conformance (are policies actually followed, not just mapped) -
    try:
        psc_rows = db.query(PolicyStatementCompliance.compliance_status).filter(
            PolicyStatementCompliance.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        psc_rows = []
    # denominator = statements that carry an actual assessment verdict
    # (compliant vs partially/non-compliant); not_assessed / not_applicable
    # are excluded so an un-assessed universe is scored n/a, not a free pass.
    psc_assessed = [r for r in psc_rows
                    if r.compliance_status in ("compliant", "partially_compliant", "non_compliant")]
    psc_compliant = sum(1 for r in psc_assessed if r.compliance_status == "compliant")

    # ---- approval steps + sign-off ----------------------------------------
    try:
        steps = db.query(
            DocumentApprovalStep.status, DocumentApprovalStep.due_date,
            DocumentApprovalStep.requested_at, DocumentApprovalStep.completed_at,
            DocumentApprovalStep.document_id
        ).join(
            GovernanceDocument, DocumentApprovalStep.document_id == GovernanceDocument.id
        ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        steps = []

    pending_steps = [s for s in steps if s.status == "pending"]
    overdue_steps = [s for s in pending_steps if s.due_date and s.due_date < now]
    docs_awaiting_approval = len({s.document_id for s in pending_steps})
    window_90 = now - timedelta(days=90)
    decided_90 = [s for s in steps if s.status in ("approved", "rejected")
                  and s.completed_at and s.completed_at >= window_90]
    approved_90 = sum(1 for s in decided_90 if s.status == "approved")
    cycle_days = [(s.completed_at - s.requested_at).total_seconds() / 86400
                  for s in decided_90 if s.requested_at and s.completed_at >= s.requested_at]
    avg_decision_days = round(sum(cycle_days) / len(cycle_days), 1) if cycle_days else None

    try:
        sig_rows = db.query(
            DocumentSignature.document_id, DocumentSignature.role_type, DocumentSignature.decision
        ).filter(DocumentSignature.tenant_id.in_(scoped)).all()
        signoff_assignments = db.query(func.count(DocumentSignoffAssignment.id)).filter(
            DocumentSignoffAssignment.tenant_id.in_(scoped)).scalar() or 0
    except SQLAlchemyError:
        db.rollback()
        sig_rows, signoff_assignments = [], 0
    signed_doc_ids = {r.document_id for r in sig_rows
                      if r.role_type == "approver" and r.decision == "signed"}
    signatures_total = len(sig_rows)
    signoff_published = len(signed_doc_ids & published_ids)

    # ---- governance action-review queue (drafts/risk-acceptances/etc awaiting review) --
    try:
        ar_rows = db.query(GovernanceActionReview.review_status).filter(
            GovernanceActionReview.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        ar_rows = []
    ar_open = [r for r in ar_rows if r.review_status in ("pending_review", "in_review")]
    ar_pending = sum(1 for r in ar_open if r.review_status == "pending_review")

    # ---- reviews ----------------------------------------------------------
    review_pool = [d for d in docs if d.status in ("approved", "published")]
    review_universe = [d for d in review_pool if d.next_review_date]
    overdue_reviews = sum(1 for d in review_universe if d.next_review_date < now)
    due_30 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=30))
    due_60 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=60))
    due_90 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=90))

    try:
        window_365 = now - timedelta(days=365)
        completed_reviews = db.query(
            PolicyReviewHistory.scheduled_date, PolicyReviewHistory.completed_at
        ).filter(
            PolicyReviewHistory.tenant_id.in_(scoped),
            PolicyReviewHistory.review_status == "completed",
            PolicyReviewHistory.completed_at.isnot(None),
            PolicyReviewHistory.completed_at >= window_365
        ).all()
    except SQLAlchemyError:
        db.rollback()
        completed_reviews = []
    with_schedule = [r for r in completed_reviews if r.scheduled_date]
    on_time = sum(1 for r in with_schedule if r.completed_at <= r.scheduled_date)

    # ---- exceptions --------------------------------------------------------
    try:
        exceptions = db.query(
            PolicyException.status, PolicyException.expiry_date,
            PolicyException.document_id, PolicyException.closed_at,
            PolicyException.promoted_risk_id
        ).filter(PolicyException.tenant_id.in_(scoped)).all()
    except SQLAlchemyError:
        db.rollback()
        exceptions = []
    exc_total = len(exceptions)
    exc_pending = sum(1 for e in exceptions if e.status == "pending_approval")
    exc_active = sum(1 for e in exceptions if e.status == "approved"
                     and (not e.expiry_date or e.expiry_date >= now))
    exc_expiring_30 = sum(1 for e in exceptions if e.status == "approved" and e.expiry_date
                          and now <= e.expiry_date <= now + timedelta(days=30))
    exc_expired = sum(1 for e in exceptions if e.status == "expired"
                      or (e.status == "approved" and e.expiry_date and e.expiry_date < now))
    exc_attention = exc_pending + exc_expiring_30
    exc_closed_dated = [e for e in exceptions if e.closed_at and e.expiry_date]
    exc_closed_on_time = sum(1 for e in exc_closed_dated if e.closed_at <= e.expiry_date)
    exc_promoted = sum(1 for e in exceptions if e.promoted_risk_id)

    # ---- attestations ------------------------------------------------------
    try:
        window_365 = now - timedelta(days=365)
        att_rows = db.query(
            AttestationRequest.status, AttestationRequest.due_date,
            AttestationRequest.completed_at, AttestationRequest.evidence_id
        ).filter(
            AttestationRequest.tenant_id.in_(scoped),
            AttestationRequest.assigned_at >= window_365
        ).all()
        active_campaigns = db.query(func.count(AttestationCampaign.id)).filter(
            AttestationCampaign.tenant_id.in_(scoped),
            AttestationCampaign.status == "active").scalar() or 0
    except SQLAlchemyError:
        db.rollback()
        att_rows, active_campaigns = [], 0
    att_total = len(att_rows)
    att_completed = [a for a in att_rows if a.status == "completed" or a.completed_at]
    att_open = [a for a in att_rows if a.status in ("pending", "overdue", "escalated") and not a.completed_at]
    att_overdue = sum(1 for a in att_open if a.status == "overdue" or (a.due_date and a.due_date < now))
    att_evidence = sum(1 for a in att_completed if a.evidence_id)

    # ---- document acknowledgements (legacy read-and-acknowledge records) ----
    try:
        ack_rows = db.query(
            DocumentAttestation.status, DocumentAttestation.completed_at
        ).filter(
            DocumentAttestation.tenant_id.in_(scoped),
            DocumentAttestation.attestation_type == "acknowledgment"
        ).all()
    except SQLAlchemyError:
        db.rollback()
        ack_rows = []
    ack_total = len(ack_rows)
    ack_done = sum(1 for a in ack_rows
                   if a.status in ("completed", "acknowledged", "attested") or a.completed_at)

    # ---- committees --------------------------------------------------------
    try:
        committees_active = db.query(GovernanceCommittee.id).filter(
            GovernanceCommittee.tenant_id.in_(scoped),
            GovernanceCommittee.is_active == True  # noqa: E712
        ).all()
        committee_ids = [c.id for c in committees_active]
        meetings = db.query(
            CommitteeMeeting.id, CommitteeMeeting.committee_id,
            CommitteeMeeting.scheduled_date, CommitteeMeeting.status,
            CommitteeMeeting.quorum_required, CommitteeMeeting.quorum_present
        ).filter(CommitteeMeeting.committee_id.in_(committee_ids)).all() if committee_ids else []
        # Omission-hardened: only APPROVED minutes count as a minuted meeting.
        # A bare MeetingMinutes row (draft / pending_approval) was gameable —
        # a meeting was treated as minuted the instant any row existed.
        minutes_meeting_ids = {m.meeting_id for m in db.query(
            MeetingMinutes.meeting_id, MeetingMinutes.status).filter(
            MeetingMinutes.meeting_id.in_([m.id for m in meetings]),
            MeetingMinutes.status == "approved").all()} if meetings else set()
        actions = db.query(OversightAction.status, OversightAction.due_date).filter(
            OversightAction.tenant_id.in_(scoped)).all()
        charter_rows = db.query(
            CommitteeCharter.committee_id, CommitteeCharter.status,
            CommitteeCharter.expiry_date
        ).filter(CommitteeCharter.committee_id.in_(committee_ids)).all() if committee_ids else []
        member_rows = db.query(
            CommitteeMember.committee_id, CommitteeMember.role
        ).filter(
            CommitteeMember.committee_id.in_(committee_ids),
            CommitteeMember.is_active == True  # noqa: E712
        ).all() if committee_ids else []
    except SQLAlchemyError:
        db.rollback()
        committee_ids, meetings, minutes_meeting_ids, actions = [], [], set(), []
        charter_rows, member_rows = [], []

    committees_count = len(committee_ids)
    recent_meeting_committees = {m.committee_id for m in meetings
                                 if m.scheduled_date and m.scheduled_date >= now - timedelta(days=90)
                                 and m.status != "cancelled"}
    completed_meetings_180 = [m for m in meetings if m.status == "completed"
                              and m.scheduled_date and m.scheduled_date >= now - timedelta(days=180)]
    minuted = sum(1 for m in completed_meetings_180 if m.id in minutes_meeting_ids)
    open_actions = [a for a in actions if a.status in ("open", "in_progress", "overdue")]
    overdue_actions = sum(1 for a in open_actions
                          if a.status == "overdue" or (a.due_date and a.due_date < now))
    actions_completed = sum(1 for a in actions if a.status == "completed")
    upcoming_meetings = sum(1 for m in meetings if m.scheduled_date and m.scheduled_date >= now
                            and m.status == "scheduled")
    # Omission-hardened: quorum is measured over ALL completed meetings. A
    # completed meeting that never recorded quorum data counts AGAINST the
    # score (not-quorate) instead of being silently dropped from the
    # denominator, which previously let untracked meetings inflate the rate.
    completed_meetings_all = [m for m in meetings if m.status == "completed"]
    held_quorum = [m for m in completed_meetings_all
                   if m.quorum_present is not None and m.quorum_required]
    quorum_met_meetings = sum(1 for m in held_quorum if m.quorum_present >= m.quorum_required)

    # ---- committee charter currency + membership completeness ---------------
    committees_with_current_charter = {
        r.committee_id for r in charter_rows
        if r.status == "active" and (not r.expiry_date or r.expiry_date >= now)
    }
    charter_current_count = len(committees_with_current_charter & set(committee_ids))
    member_roles_by_committee = {}
    for r in member_rows:
        member_roles_by_committee.setdefault(r.committee_id, set()).add(r.role or "member")
    # "Complete" = at least one active member AND both a chair and a secretary
    # present, so a committee with a lone stray member does not score full.
    membership_complete_count = sum(
        1 for cid in committee_ids
        if {"chair", "secretary"} <= member_roles_by_committee.get(cid, set())
    )

    # ---- KRIs (governance oversight of key risk indicators) -----------------
    # Reuses the ERM KRI data as a governance-oversight lens (Regulatory moved to
    # the Compliance scorecard; KRIs are now a governance nav page).
    try:
        g_kris = db.query(
            RiskKRI.risk_id, RiskKRI.current_value, RiskKRI.amber_threshold,
            RiskKRI.threshold_direction, RiskKRI.frequency,
            RiskKRI.last_measured_at, RiskKRI.is_active,
        ).join(Risk, RiskKRI.risk_id == Risk.id).filter(Risk.tenant_id.in_(scoped)).all()
        g_high_risk_ids = {r.id for r in db.query(Risk.id).filter(
            Risk.tenant_id.in_(scoped), Risk.residual_score >= 12).all()}
    except SQLAlchemyError:
        db.rollback()
        g_kris, g_high_risk_ids = [], set()

    _KRI_FRESH = {"daily": 2, "weekly": 10, "monthly": 35,
                  "quarterly": 100, "annually": 380, "annual": 380}

    def _kri_red(k):
        if k.current_value is None or k.amber_threshold is None:
            return False
        if (k.threshold_direction or "lower_is_better").startswith("higher"):
            return k.current_value < k.amber_threshold
        return k.current_value > k.amber_threshold

    g_active_kris = [k for k in g_kris if k.is_active]
    g_red_kris = sum(1 for k in g_active_kris if _kri_red(k))
    g_fresh_kris = sum(1 for k in g_active_kris if k.last_measured_at and k.last_measured_at
                       >= now - timedelta(days=_KRI_FRESH.get((k.frequency or "monthly").lower(), 35)))
    g_thresholded_kris = sum(1 for k in g_active_kris if k.amber_threshold is not None)
    g_kri_risk_ids = {k.risk_id for k in g_active_kris}
    g_high_covered = len(g_high_risk_ids & g_kri_risk_ids)

    # ---- KPI Report (governance oversight of the Cyber Security KPI report) --
    import re as _re
    try:
        kpi_doc = db.query(ComplianceAssessmentDocument.id).filter(
            ComplianceAssessmentDocument.tenant_id.in_(scoped),
            ComplianceAssessmentDocument.assessment_format == "kpi_report").first()
        kpi_rows = (db.query(ComplianceAssessmentDocumentItem.remarks).filter(
            ComplianceAssessmentDocumentItem.assessment_id == kpi_doc.id).all()
            if kpi_doc else [])
    except SQLAlchemyError:
        db.rollback()
        kpi_rows = []

    def _kpi_latest(remarks):
        """Latest quarter with data -> (target, actual, lower_is_better); else None.
        remarks blob: '... | Qn: target%/actual% | ...'; some KPIs are lower-is-better."""
        if not remarks:
            return None
        pairs = _re.findall(r"Q\d\s*:\s*([\d.]+)%?\s*/\s*([\d.]+)%?", remarks)
        if not pairs:
            return None
        tgt, act = pairs[-1]
        lower = bool(_re.search(r"\bnot\b|past deadline|open past|do not", remarks, _re.I))
        return float(tgt), float(act), lower

    kpi_total = len(kpi_rows)
    _kpi_parsed = [_kpi_latest(r[0]) for r in kpi_rows]
    kpi_reported = sum(1 for p in _kpi_parsed if p is not None)
    kpi_on_target = sum(1 for p in _kpi_parsed if p is not None
                        and (p[1] <= p[0] if p[2] else p[1] >= p[0]))
    kpi_cells = sum(len(_re.findall(r"Q\d\s*:\s*[\d.]+%?\s*/\s*[\d.]+%?", r[0] or "")) for r in kpi_rows)

    # ---- IS Projects (governance portfolio oversight) -----------------------
    try:
        projects = db.query(
            ISProject.id, ISProject.status, ISProject.health, ISProject.target_end_date,
            ISProject.budget_estimated, ISProject.budget_actual, ISProject.business_justification,
        ).filter(ISProject.tenant_id.in_(scoped)).all()
        _proj_ids = [p.id for p in projects]
        milestones = (db.query(ISProjectMilestone.target_date,
                               ISProjectMilestone.actual_completion_date)
                      .filter(ISProjectMilestone.project_id.in_(_proj_ids)).all()
                      if _proj_ids else [])
    except SQLAlchemyError:
        db.rollback()
        projects, milestones = [], []

    _PROJ_DONE = ("completed", "closed", "cancelled")
    active_projects = [p for p in projects if (p.status or "").lower() not in _PROJ_DONE]
    # Omission-hardened: a project with NO target end date is NOT counted as
    # on-schedule — a missing SLA date is a governance gap, not a free pass.
    proj_on_sched = sum(1 for p in active_projects if p.target_end_date and p.target_end_date >= now)
    proj_healthy = sum(1 for p in active_projects
                       if (p.health or "").lower().replace("_", " ") in ("on track", "green"))
    # Omission-hardened: budget health is measured over ALL active projects; a
    # project that never entered a budget counts against the score (untracked)
    # instead of being silently dropped from the denominator.
    active_budgeted = [p for p in active_projects if p.budget_estimated and p.budget_actual]
    proj_overbudget = sum(1 for p in active_budgeted if p.budget_actual > p.budget_estimated)
    proj_budget_untracked = len(active_projects) - len(active_budgeted)
    ms_completed_dated = [m for m in milestones if m.actual_completion_date and m.target_date]
    ms_ontime = sum(1 for m in ms_completed_dated if m.actual_completion_date <= m.target_date)

    # ---- gap analysis (Documents detail -> Gap Analysis tab) ----------------
    try:
        gap_rows = db.query(PolicyGapFinding.remediation_status).filter(
            PolicyGapFinding.tenant_id.in_(scoped),
            PolicyGapFinding.compliance_status.in_(["partially_compliant", "not_addressed"])
        ).all()
    except SQLAlchemyError:
        db.rollback()
        gap_rows = []
    open_gaps = sum(1 for g in gap_rows if g.remediation_status == "open")
    gaps_resolved = sum(1 for g in gap_rows
                        if g.remediation_status in ("closed", "accepted_risk"))

    # ================= sections ==============================================
    stale_published = sum(1 for d in published_docs
                          if (d.expiry_date and d.expiry_date < now)
                          or (d.next_review_date and d.next_review_date < now))
    docs_wellformed = sum(1 for d in active_docs
                          if d.owner_id and d.classification and d.review_cycle_months)
    docs_with_body = [d for d in active_docs if d.file_path or d.has_content]
    docs_body_with_statements = sum(1 for d in docs_with_body if d.id in docs_with_statements)

    documents_metrics = [
        metric("publishing_rate", "Publishing", 0.20, published_count, active_count,
               "published documents / active documents"),
        metric("freshness", "Freshness", 0.20, stale_published, published_count,
               "1 - (published documents expired or review-overdue / published documents)",
               inverse=True, empty_score=100),
        metric("metadata_completeness", "Well-formed", 0.15, docs_wellformed, active_count,
               "documents with owner + classification + review cycle / active documents"),
        metric("content_readiness", "Has content", 0.15, len(docs_with_body), active_count,
               "documents with an uploaded file or authored content / active documents"),
        metric("statement_extraction", "Statements parsed", 0.15,
               docs_body_with_statements, len(docs_with_body),
               "documents with parsed policy statements / documents that have content"),
        metric("gap_remediation", "Gaps remediated", 0.15, gaps_resolved, len(gap_rows),
               "gap findings closed or risk-accepted / all non-compliant gap findings"),
    ]

    mappings_metrics = [
        metric("document_coverage", "Docs mapped", 0.35, mapped_count, active_count,
               "documents linked to >=1 control/risk/framework/asset / active documents"),
        metric("statement_coverage", "Statements mapped", 0.25, len(mapped_stmt_ids), len(stmt_ids),
               "active policy statements with >=1 control mapping / active policy statements"),
        metric("statement_conformance", "Statements conformant", 0.25, psc_compliant, len(psc_assessed),
               "policy statements assessed compliant / statements with a compliance assessment (compliant vs partial/non-compliant)"),
        metric("mapping_quality", "Full-coverage maps", 0.15, stmt_mappings_full, stmt_mappings_total,
               "statement-control mappings with coverage_type=full / all statement mappings"),
    ]

    approvals_metrics = [
        metric("queue_health", "Queue health", 0.30, len(overdue_steps), len(pending_steps),
               "1 - (overdue approval steps / pending approval steps)",
               inverse=True, empty_score=100),
        metric("action_review_health", "Action-review backlog", 0.20, ar_pending, len(ar_open),
               "1 - (action reviews still awaiting triage / open action-review items)",
               inverse=True, empty_score=100),
        metric("decision_rate", "Approval rate 90d", 0.25, approved_90, len(decided_90),
               "steps approved / steps decided, last 90 days"),
        metric("signoff_integrity", "Signed-off published", 0.25, signoff_published, published_count,
               "published documents with a recorded approver signature / published documents"),
    ]

    reviews_metrics = [
        metric("schedule_coverage", "Schedule coverage", 0.25, len(review_universe), len(review_pool),
               "approved/published documents with a next review date / approved+published documents"),
        metric("schedule_health", "Schedule health", 0.45, overdue_reviews, len(review_universe),
               "1 - (overdue reviews / documents with a review schedule)",
               inverse=True, empty_score=100),
        metric("on_time_rate", "On-time reviews 12m", 0.30, on_time, len(with_schedule),
               "reviews completed on/before their scheduled date / completed reviews, last 12 months"),
    ]

    exceptions_metrics = [
        metric("containment", "Containment", 0.60, exc_attention, exc_total,
               "1 - ((pending + expiring-30d exceptions) / total exceptions)",
               inverse=True, empty_score=100),
        metric("closure_timeliness", "Closed on time", 0.40, exc_closed_on_time, len(exc_closed_dated),
               "exceptions closed on/before their expiry date / closed exceptions with both dates"),
    ]

    attestations_metrics = [
        metric("completion_rate", "Completion 12m", 0.40, len(att_completed), att_total,
               "attestation requests completed / all requests, last 12 months"),
        metric("acknowledgement_rate", "Acknowledged", 0.25, ack_done, ack_total,
               "document acknowledgements completed / all required acknowledgement records"),
        metric("overdue_containment", "Overdue containment", 0.20, att_overdue, len(att_open),
               "1 - (overdue open requests / open requests)", inverse=True, empty_score=100),
        metric("evidence_linkage", "Evidence linked", 0.15, att_evidence, len(att_completed),
               "completed attestations linked to evidence / completed attestations"),
    ]

    committees_metrics = [
        metric("action_health", "Action health", 0.20, overdue_actions, len(open_actions),
               "1 - (overdue oversight actions / open oversight actions)",
               inverse=True, empty_score=100),
        metric("action_completion", "Actions completed", 0.15, actions_completed, len(actions),
               "completed oversight actions / all oversight actions"),
        metric("meeting_cadence", "Meeting cadence", 0.15, len(recent_meeting_committees), committees_count,
               "active committees that met in the last 90 days / active committees"),
        metric("charter_currency", "Charters current", 0.15, charter_current_count, committees_count,
               "active committees with a current (active, non-expired) charter / active committees"),
        metric("membership_completeness", "Membership complete", 0.15, membership_complete_count, committees_count,
               "active committees with active chair + secretary roles filled / active committees"),
        metric("minutes_discipline", "Minutes approved", 0.10, minuted, len(completed_meetings_180),
               "completed meetings (180d) with APPROVED minutes / completed meetings (180d)"),
        metric("quorum_rate", "Quorum met", 0.10, quorum_met_meetings, len(completed_meetings_all),
               "completed meetings that reached their quorum threshold / all completed meetings (missing quorum data counts against)"),
    ]

    kris_metrics = [
        metric("signal_health", "Signal health", 0.35, g_red_kris, len(g_active_kris),
               "1 - (breached/red KRIs / active KRIs)", inverse=True, empty_score=100),
        metric("measurement_freshness", "Measured on schedule", 0.30, g_fresh_kris, len(g_active_kris),
               "active KRIs measured within their frequency window / active KRIs"),
        metric("threshold_coverage", "Thresholds defined", 0.20, g_thresholded_kris, len(g_active_kris),
               "active KRIs with a defined amber threshold / active KRIs"),
        metric("high_risk_coverage", "High risks monitored", 0.15, g_high_covered, len(g_high_risk_ids),
               "high residual risks (>=12) with >=1 active KRI / high residual risks", empty_score=100),
    ]

    kpi_metrics = [
        metric("reporting_coverage", "KPIs reported", 0.40, kpi_reported, kpi_total,
               "KPIs with a reported actual value / all defined KPIs"),
        metric("on_target_rate", "On target", 0.40, kpi_on_target, kpi_reported,
               "KPIs meeting their target (direction-aware) / KPIs with a reported value"),
        metric("data_completeness", "Data completeness", 0.20, kpi_cells, kpi_total * 4,
               "reported quarter values across all KPIs / (KPIs x 4 quarters)"),
    ]

    # empty_score left as None so a tenant with no projects scores n/a (excluded from
    # the module rollup) instead of a misleading 100.
    projects_metrics = [
        metric("on_schedule", "On schedule", 0.30, proj_on_sched, len(active_projects),
               "active projects with a target end date not yet passed / active projects (missing target dates count against)"),
        metric("milestone_adherence", "Milestones on time", 0.25, ms_ontime, len(ms_completed_dated),
               "milestones completed on or before target date / completed milestones with a target"),
        metric("portfolio_health", "Portfolio health", 0.25, proj_healthy, len(active_projects),
               "active projects with health 'On Track' / active projects"),
        metric("budget_health", "Budget health", 0.20, proj_overbudget + proj_budget_untracked, len(active_projects),
               "1 - (projects over budget or not tracking a budget / active projects)", inverse=True),
    ]

    sections = {
        "documents": {
            "key": "documents", "label": "Documents", "weight": 0.18,
            "score": section_score(documents_metrics), "metrics": documents_metrics,
            "counts": {"total": total_docs, "active": active_count, "published": published_count,
                       "by_status": by_status, "by_type": by_type,
                       "by_classification": by_classification,
                       "expiring_30d": sum(1 for d in docs if d.status in ("approved", "published")
                                           and d.expiry_date and now <= d.expiry_date <= now + timedelta(days=30))},
        },
        "mappings": {
            "key": "mappings", "label": "Mappings", "weight": 0.18,
            "score": section_score(mappings_metrics), "metrics": mappings_metrics,
            "counts": {"controls": {"links": control_links, "documents": len(control_doc_ids)},
                       "risks": {"links": risk_links, "documents": len(risk_doc_ids)},
                       "frameworks": {"links": reg_links, "documents": len(framework_doc_ids)},
                       "assets": {"links": asset_links, "documents": len(asset_doc_ids)},
                       "documents_mapped": mapped_count,
                       "statements": len(stmt_ids), "statements_mapped": len(mapped_stmt_ids),
                       "published_unmapped": len(published_ids - any_link_ids)},
        },
        "approvals": {
            "key": "approvals", "label": "Approvals & Sign-off", "weight": 0.14,
            "score": section_score(approvals_metrics), "metrics": approvals_metrics,
            "counts": {"pending_steps": len(pending_steps), "overdue_steps": len(overdue_steps),
                       "documents_awaiting": docs_awaiting_approval,
                       "approved_90d": approved_90, "rejected_90d": len(decided_90) - approved_90,
                       "avg_decision_days": avg_decision_days,
                       "signatures": signatures_total, "signoff_assignments": signoff_assignments},
        },
        "reviews": {
            "key": "reviews", "label": "Reviews", "weight": 0.14,
            "score": section_score(reviews_metrics), "metrics": reviews_metrics,
            "counts": {"scheduled_documents": len(review_universe), "overdue": overdue_reviews,
                       "due_30d": due_30, "due_60d": due_60, "due_90d": due_90,
                       "completed_365d": len(completed_reviews)},
        },
        "exceptions": {
            "key": "exceptions", "label": "Exceptions", "weight": 0.09,
            "score": section_score(exceptions_metrics), "metrics": exceptions_metrics,
            "counts": {"total": exc_total, "pending_approval": exc_pending, "active": exc_active,
                       "expiring_30d": exc_expiring_30, "expired": exc_expired,
                       "promoted_to_risk": exc_promoted},
        },
        "attestations": {
            "key": "attestations", "label": "Attestations", "weight": 0.09,
            "score": section_score(attestations_metrics), "metrics": attestations_metrics,
            "counts": {"requests_12m": att_total, "completed": len(att_completed),
                       "open": len(att_open), "overdue": att_overdue,
                       "active_campaigns": active_campaigns},
        },
        "committees": {
            "key": "committees", "label": "Committees", "weight": 0.09,
            "score": section_score(committees_metrics), "metrics": committees_metrics,
            "counts": {"active_committees": committees_count, "upcoming_meetings": upcoming_meetings,
                       "open_actions": len(open_actions), "overdue_actions": overdue_actions,
                       "actions_completed": actions_completed, "actions_total": len(actions),
                       "quorum_met_meetings": quorum_met_meetings, "held_with_quorum": len(held_quorum)},
        },
        "kris": {
            "key": "kris", "label": "Key Risk Indicators", "weight": 0.09,
            "score": section_score(kris_metrics), "metrics": kris_metrics,
            "counts": {"active": len(g_active_kris), "red": g_red_kris,
                       "fresh": g_fresh_kris, "thresholded": g_thresholded_kris,
                       "high_risks": len(g_high_risk_ids), "high_covered": g_high_covered},
        },
        "kpi": {
            "key": "kpi", "label": "KPI Report", "weight": 0.06,
            "score": section_score(kpi_metrics), "metrics": kpi_metrics,
            "counts": {"kpis": kpi_total, "reported": kpi_reported, "on_target": kpi_on_target},
        },
        "projects": {
            "key": "projects", "label": "IS Projects", "weight": 0.06,
            "score": section_score(projects_metrics), "metrics": projects_metrics,
            "counts": {"total": len(projects), "active": len(active_projects),
                       "on_schedule": proj_on_sched, "healthy": proj_healthy,
                       "over_budget": proj_overbudget,
                       "milestones_on_time": ms_ontime, "milestones_dated": len(ms_completed_dated)},
        },
    }

    # Per-tenant fine-tuning: apply saved section + metric weight (and target)
    # overrides, recomputing section scores + the module score.
    from grc.services import scorecard_config as sc_cfg
    _cfg = sc_cfg.get_config(db, scoped[0], "governance") if scoped else {}
    _target = _cfg.get("target", 85)
    sc_cfg.apply_overrides(list(sections.values()), _cfg)
    components = [{"key": s["key"], "label": s["label"], "score": s["score"],
                   "weight": s["weight"], "target": _target} for s in sections.values()]
    scored = [c for c in components if c["score"] is not None]
    weight_sum = sum(c["weight"] for c in scored)
    performance_score = (round(sum(c["score"] * c["weight"] for c in scored) / weight_sum, 1)
                         if scored and weight_sum else None)
    if performance_score is None:
        grade = None
    elif performance_score >= 85:
        grade = "excellent"
    elif performance_score >= 70:
        grade = "good"
    elif performance_score >= 50:
        grade = "fair"
    else:
        grade = "poor"

    # Health-score history: snapshot today's weighted governance score and read
    # back a monthly series so the overview draws a real 12-month trend. Starts
    # from today and fills in over time — no fabricated history.
    health_trend = []
    try:
        from grc.services import metric_snapshots as _ms
        from calendar import month_abbr
        _ms.ensure_table(db)
        _tid = scoped[0]
        if performance_score is not None:
            _ms.upsert(db, _tid, "governance_health", now.date(), performance_score)
            db.commit()
        _by_month = {}
        for _h in _ms.read_trend(db, [_tid], "governance_health", days=400):
            _by_month[_h["date"][:7]] = _h["value"]  # ascending — last value per month wins
        for _ym, _val in list(_by_month.items())[-12:]:
            _y, _m = _ym.split("-")
            health_trend.append({"label": month_abbr[int(_m)], "year": _y, "value": round(float(_val), 1)})
    except Exception:
        db.rollback()

    expiring_docs_30 = sections["documents"]["counts"]["expiring_30d"]
    return {
        "as_of": now.isoformat(),
        "sections": sections,
        "attention_queue": {
            "documents_awaiting_approval": docs_awaiting_approval,
            "overdue_reviews": overdue_reviews,
            "expiring_documents_30d": expiring_docs_30,
            "exceptions_attention": exc_attention,
            "open_gaps": open_gaps,
            "overdue_attestations": att_overdue,
            "overdue_actions": overdue_actions,
            "red_kris": g_red_kris,
            "total": (docs_awaiting_approval + overdue_reviews + expiring_docs_30
                      + exc_attention + open_gaps + att_overdue + overdue_actions
                      + g_red_kris),
        },
        "performance": {
            "score": performance_score,
            "grade": grade,
            "formula": "weighted mean of section scores: documents 18% + mappings 18% + approvals 14% + reviews 14% + exceptions 9% + attestations 9% + committees 9% + KRIs 9% + KPI 6% + Projects 6% (renormalized)",
            "components": components,
            "health_trend": health_trend,
        },
    }


@router.get("/scorecard-config")
def get_scorecard_config(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Current section weights + target (built-in defaults merged with tenant overrides)."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"module": "governance", "sections": [], "target": 85, "default_target": 85, "customized": False}
    return sc_cfg.merged(db, tenants[0], "governance")


@router.put("/scorecard-config")
def put_scorecard_config(
    body: dict = Body(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Save section-weight, metric-weight and/or target overrides for this tenant.
    Any field omitted is left unchanged; weights renormalize to 100%."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if not tenants:
        return {"ok": False}
    cfg = sc_cfg.save_config(
        db, tenants[0], "governance",
        section_weights=body.get("weights"),
        metric_weights=body.get("metric_weights"),
        target=body.get("target"),
        updated_by=getattr(current_user, "id", None),
    )
    return {"ok": True, "config": cfg}


@router.delete("/scorecard-config")
def reset_scorecard_config(
    section: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Reset scorecard tuning to defaults — the whole module, or (with ?section=)
    just one section's metric weights."""
    from grc.services import scorecard_config as sc_cfg
    tenants = get_user_tenants(current_user, db)
    if tenants:
        sc_cfg.reset_config(db, tenants[0], "governance", section=section)
    return {"ok": True}


@router.get("/owner-statistics")
def get_owner_statistics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"owners": [], "unassigned_count": 0}
    
    query = db.query(GovernanceDocument).filter(GovernanceDocument.tenant_id.in_(user_tenants))
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    documents = query.all()
    
    owner_stats = {}
    unassigned_count = 0
    
    for doc in documents:
        if doc.owner_id:
            if doc.owner_id not in owner_stats:
                owner = db.query(GRCUser).filter(GRCUser.id == doc.owner_id).first()
                owner_stats[doc.owner_id] = {
                    "owner_id": doc.owner_id,
                    "owner_name": owner.display_name if owner else f"User {doc.owner_id}",
                    "owner_email": owner.email if owner else None,
                    "total_documents": 0,
                    "by_status": {},
                    "by_type": {}
                }
            
            owner_stats[doc.owner_id]["total_documents"] += 1
            
            status = doc.status or "draft"
            owner_stats[doc.owner_id]["by_status"][status] = \
                owner_stats[doc.owner_id]["by_status"].get(status, 0) + 1
            
            doc_type = doc.doc_type or "other"
            owner_stats[doc.owner_id]["by_type"][doc_type] = \
                owner_stats[doc.owner_id]["by_type"].get(doc_type, 0) + 1
        else:
            unassigned_count += 1
    
    owners_list = sorted(
        owner_stats.values(),
        key=lambda x: x["total_documents"],
        reverse=True
    )
    
    return {
        "owners": owners_list,
        "unassigned_count": unassigned_count,
        "total_documents": len(documents)
    }
