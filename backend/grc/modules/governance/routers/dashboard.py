from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, Query
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
    """Single source of truth for the Documents dashboard.

    Every ratio is returned with its numerator, denominator, and formula
    string so the UI renders backend-computed numbers instead of inventing
    math client-side. Sections: documents (portfolio), mappings (linkage),
    approvals, reviews, exceptions, freshness, attention_queue, performance.
    """
    from ....models import (
        DocumentRiskLink, DocumentAssetLink, PolicyException,
        PolicyReviewHistory, PolicyGapFinding
    )

    user_tenants = get_user_tenants(current_user, db)
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        scoped = [tenant_id]
    else:
        scoped = user_tenants

    now = datetime.utcnow()

    if not scoped:
        return {"as_of": now.isoformat(), "documents": {"total": 0}, "performance": {"score": None, "components": []}}

    docs = db.query(
        GovernanceDocument.id, GovernanceDocument.status, GovernanceDocument.doc_type,
        GovernanceDocument.classification, GovernanceDocument.next_review_date,
        GovernanceDocument.expiry_date, GovernanceDocument.framework_ids
    ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()

    # ---- portfolio -------------------------------------------------------
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
    publishing_rate = round((published_count / active_count) * 100, 1) if active_count else 0.0

    # ---- mappings / linkage ---------------------------------------------
    def link_stats(model):
        rows = db.query(model.document_id).join(
            GovernanceDocument, model.document_id == GovernanceDocument.id
        ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()
        ids = [r.document_id for r in rows]
        return len(ids), set(ids)

    control_links, control_doc_ids = link_stats(DocumentControlLink)
    risk_links, risk_doc_ids = link_stats(DocumentRiskLink)
    framework_links, framework_doc_ids = link_stats(DocumentRegulatoryLink)
    asset_links, asset_doc_ids = link_stats(DocumentAssetLink)

    fw_ids_doc_ids = {d.id for d in docs if d.framework_ids and len(d.framework_ids) > 0}
    framework_doc_ids = framework_doc_ids | fw_ids_doc_ids

    any_link_ids = (control_doc_ids | risk_doc_ids | framework_doc_ids | asset_doc_ids) & active_ids
    mapped_count = len(any_link_ids)
    mapping_coverage = round((mapped_count / active_count) * 100, 1) if active_count else 0.0

    # ---- approvals -------------------------------------------------------
    steps = db.query(
        DocumentApprovalStep.status, DocumentApprovalStep.due_date,
        DocumentApprovalStep.requested_at, DocumentApprovalStep.completed_at,
        DocumentApprovalStep.document_id
    ).join(
        GovernanceDocument, DocumentApprovalStep.document_id == GovernanceDocument.id
    ).filter(GovernanceDocument.tenant_id.in_(scoped)).all()

    pending_steps = [s for s in steps if s.status == "pending"]
    overdue_steps = [s for s in pending_steps if s.due_date and s.due_date < now]
    docs_awaiting_approval = len({s.document_id for s in pending_steps})

    window_90 = now - timedelta(days=90)
    decided_90 = [s for s in steps if s.status in ("approved", "rejected") and s.completed_at and s.completed_at >= window_90]
    approved_90 = sum(1 for s in decided_90 if s.status == "approved")
    rejected_90 = sum(1 for s in decided_90 if s.status == "rejected")
    approval_rate = round((approved_90 / len(decided_90)) * 100, 1) if decided_90 else None

    cycle_days = [
        (s.completed_at - s.requested_at).total_seconds() / 86400
        for s in decided_90 if s.requested_at and s.completed_at >= s.requested_at
    ]
    avg_decision_days = round(sum(cycle_days) / len(cycle_days), 1) if cycle_days else None

    approval_health = round((1 - len(overdue_steps) / len(pending_steps)) * 100, 1) if pending_steps else 100.0

    # ---- reviews ---------------------------------------------------------
    review_universe = [d for d in docs if d.status in ("approved", "published") and d.next_review_date]
    overdue_reviews = sum(1 for d in review_universe if d.next_review_date < now)
    due_30 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=30))
    due_60 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=60))
    due_90 = sum(1 for d in review_universe if now <= d.next_review_date <= now + timedelta(days=90))
    review_health = round((1 - overdue_reviews / len(review_universe)) * 100, 1) if review_universe else 100.0

    window_365 = now - timedelta(days=365)
    completed_reviews = db.query(
        PolicyReviewHistory.scheduled_date, PolicyReviewHistory.completed_at
    ).filter(
        PolicyReviewHistory.tenant_id.in_(scoped),
        PolicyReviewHistory.review_status == "completed",
        PolicyReviewHistory.completed_at.isnot(None),
        PolicyReviewHistory.completed_at >= window_365
    ).all()
    with_schedule = [r for r in completed_reviews if r.scheduled_date]
    on_time = sum(1 for r in with_schedule if r.completed_at <= r.scheduled_date)
    on_time_review_rate = round((on_time / len(with_schedule)) * 100, 1) if with_schedule else None

    # ---- exceptions ------------------------------------------------------
    exceptions = db.query(
        PolicyException.status, PolicyException.expiry_date, PolicyException.document_id
    ).filter(PolicyException.tenant_id.in_(scoped)).all()

    exc_total = len(exceptions)
    exc_pending = sum(1 for e in exceptions if e.status == "pending_approval")
    exc_active = sum(1 for e in exceptions if e.status == "approved" and (not e.expiry_date or e.expiry_date >= now))
    exc_expiring_30 = sum(
        1 for e in exceptions
        if e.status == "approved" and e.expiry_date and now <= e.expiry_date <= now + timedelta(days=30)
    )
    exc_expired = sum(
        1 for e in exceptions
        if e.status == "expired" or (e.status == "approved" and e.expiry_date and e.expiry_date < now)
    )
    exc_attention = exc_pending + exc_expiring_30
    exception_health = round((1 - exc_attention / exc_total) * 100, 1) if exc_total else 100.0

    # ---- freshness -------------------------------------------------------
    stale_published = sum(
        1 for d in published_docs
        if (d.expiry_date and d.expiry_date < now) or (d.next_review_date and d.next_review_date < now)
    )
    freshness = round((1 - stale_published / published_count) * 100, 1) if published_count else 100.0
    expiring_docs_30 = sum(
        1 for d in docs
        if d.status in ("approved", "published") and d.expiry_date and now <= d.expiry_date <= now + timedelta(days=30)
    )

    # ---- open gaps (document-driven findings) ----------------------------
    open_gaps = db.query(func.count(PolicyGapFinding.id)).filter(
        PolicyGapFinding.tenant_id.in_(scoped),
        PolicyGapFinding.remediation_status == "open"
    ).scalar() or 0

    # ---- performance composite ------------------------------------------
    components = [
        {
            "key": "publishing", "label": "Publishing", "weight": 0.20, "target": 85,
            "score": publishing_rate, "numerator": published_count, "denominator": active_count,
            "formula": "published documents / active (non-archived) documents"
        },
        {
            "key": "mapping_coverage", "label": "Coverage", "weight": 0.20, "target": 85,
            "score": mapping_coverage, "numerator": mapped_count, "denominator": active_count,
            "formula": "documents linked to >=1 control/risk/framework/asset / active documents"
        },
        {
            "key": "review_health", "label": "Reviews", "weight": 0.20, "target": 85,
            "score": review_health, "numerator": overdue_reviews, "denominator": len(review_universe),
            "formula": "1 - (overdue reviews / documents with a review schedule)"
        },
        {
            "key": "approval_health", "label": "Approvals", "weight": 0.15, "target": 85,
            "score": approval_health, "numerator": len(overdue_steps), "denominator": len(pending_steps),
            "formula": "1 - (overdue approval steps / pending approval steps)"
        },
        {
            "key": "freshness", "label": "Freshness", "weight": 0.15, "target": 85,
            "score": freshness, "numerator": stale_published, "denominator": published_count,
            "formula": "1 - (published documents expired or review-overdue / published documents)"
        },
        {
            "key": "exception_health", "label": "Exceptions", "weight": 0.10, "target": 85,
            "score": exception_health, "numerator": exc_attention, "denominator": exc_total,
            "formula": "1 - ((pending + expiring exceptions) / total exceptions)"
        },
    ]
    performance_score = round(sum(c["score"] * c["weight"] for c in components), 1) if total_docs else None
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

    return {
        "as_of": now.isoformat(),
        "documents": {
            "total": total_docs,
            "active": active_count,
            "published": published_count,
            "publishing_rate_percent": publishing_rate,
            "by_status": by_status,
            "by_type": by_type,
            "by_classification": by_classification,
        },
        "mappings": {
            "controls": {"links": control_links, "documents": len(control_doc_ids)},
            "risks": {"links": risk_links, "documents": len(risk_doc_ids)},
            "frameworks": {"links": framework_links, "documents": len(framework_doc_ids)},
            "assets": {"links": asset_links, "documents": len(asset_doc_ids)},
            "documents_mapped": mapped_count,
            "coverage_percent": mapping_coverage,
        },
        "approvals": {
            "pending_steps": len(pending_steps),
            "overdue_steps": len(overdue_steps),
            "documents_awaiting": docs_awaiting_approval,
            "approved_90d": approved_90,
            "rejected_90d": rejected_90,
            "approval_rate_percent": approval_rate,
            "avg_decision_days": avg_decision_days,
            "health_percent": approval_health,
        },
        "reviews": {
            "scheduled_documents": len(review_universe),
            "overdue": overdue_reviews,
            "due_30d": due_30,
            "due_60d": due_60,
            "due_90d": due_90,
            "completed_365d": len(completed_reviews),
            "on_time_rate_percent": on_time_review_rate,
            "health_percent": review_health,
        },
        "exceptions": {
            "total": exc_total,
            "pending_approval": exc_pending,
            "active": exc_active,
            "expiring_30d": exc_expiring_30,
            "expired": exc_expired,
            "attention": exc_attention,
            "health_percent": exception_health,
        },
        "freshness": {
            "published": published_count,
            "stale": stale_published,
            "expiring_documents_30d": expiring_docs_30,
            "percent": freshness,
        },
        "attention_queue": {
            "documents_awaiting_approval": docs_awaiting_approval,
            "overdue_reviews": overdue_reviews,
            "expiring_documents_30d": expiring_docs_30,
            "exceptions_attention": exc_attention,
            "open_gaps": open_gaps,
            "total": docs_awaiting_approval + overdue_reviews + expiring_docs_30 + exc_attention + open_gaps,
        },
        "performance": {
            "score": performance_score,
            "grade": grade,
            "components": components,
        },
    }


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
