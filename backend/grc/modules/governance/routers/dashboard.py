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
    linked_to_frameworks = documents_with_frameworks.scalar() or 0
    
    documents = query.all()
    docs_with_any_link = 0
    for doc in documents:
        has_control = db.query(DocumentControlLink).filter(DocumentControlLink.document_id == doc.id).first() is not None
        has_framework = db.query(DocumentRegulatoryLink).filter(DocumentRegulatoryLink.document_id == doc.id).first() is not None
        has_framework_ids = doc.framework_ids and len(doc.framework_ids) > 0
        if has_control or has_framework or has_framework_ids:
            docs_with_any_link += 1
    
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
