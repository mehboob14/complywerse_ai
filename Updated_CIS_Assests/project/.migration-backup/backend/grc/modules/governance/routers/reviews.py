from typing import List, Optional
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_, func, extract
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, DocumentReviewer, DocumentAuditLog, GRCUser, get_db, GovernanceActionReview
)
from ....routers.auth_router import require_auth, get_user_tenants
from ..action_logger import update_action_review_status
from ....rich_audit import write_rich_audit_log

router = APIRouter(prefix="/reviews", tags=["Governance - Reviews"])


class CompleteReviewRequest(BaseModel):
    notes: Optional[str] = None
    next_review_date: Optional[datetime] = None


class UpdateReviewCycleRequest(BaseModel):
    review_cycle_months: int
    recalculate_next_review: bool = True


class SkipReviewRequest(BaseModel):
    reason: str
    reschedule_months: Optional[int] = None


class UpdateActionReviewRequest(BaseModel):
    review_status: str  # pending_review, in_review, approved, rejected, archived
    review_notes: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def create_audit_log(
    db: Session,
    document_id: int,
    tenant_id: int,
    user_id: int,
    action: str,
    action_details: Optional[str] = None,
    field_changed: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    resource_name: Optional[str] = None,
) -> DocumentAuditLog:
    audit_log = DocumentAuditLog(
        document_id=document_id,
        tenant_id=tenant_id,
        action=action,
        action_details=action_details,
        field_changed=field_changed,
        old_value=old_value,
        new_value=new_value,
        performed_by=user_id,
        performed_at=datetime.utcnow()
    )
    db.add(audit_log)
    _snapshot = None
    if field_changed:
        _snapshot = {"field": field_changed, "old_value": old_value, "new_value": new_value}
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=user_id,
        action=action,
        resource_type="governance_document",
        resource_id=document_id,
        resource_name=resource_name or f"Document #{document_id}",
        summary=action_details or action,
        snapshot=_snapshot,
    )
    return audit_log


def serialize_review_document(doc: GovernanceDocument) -> dict:
    now = datetime.utcnow()
    days_until_review = None
    is_overdue = False
    
    if doc.next_review_date:
        delta = (doc.next_review_date - now).days
        days_until_review = delta
        is_overdue = delta < 0
    
    return {
        "id": doc.id,
        "tenant_id": doc.tenant_id,
        "document_code": doc.document_code,
        "title": doc.title,
        "doc_type": doc.doc_type,
        "classification": doc.classification,
        "status": doc.status,
        "current_version": doc.current_version,
        "owner_id": doc.owner_id,
        "owner_name": doc.owner.display_name if doc.owner else None,
        "review_cycle_months": doc.review_cycle_months,
        "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
        "last_reviewed_at": doc.last_reviewed_at.isoformat() if doc.last_reviewed_at else None,
        "last_reviewed_by": doc.last_reviewed_by,
        "last_reviewer_name": doc.last_reviewer.display_name if doc.last_reviewer else None,
        "days_until_review": days_until_review,
        "is_overdue": is_overdue,
        "effective_date": doc.effective_date.isoformat() if doc.effective_date else None,
        "expiry_date": doc.expiry_date.isoformat() if doc.expiry_date else None,
    }


@router.get("/upcoming")
def get_upcoming_reviews(
    days: int = Query(30, ge=1, le=365, description="Number of days to look ahead"),
    tenant_id: Optional[int] = None,
    doc_type: Optional[str] = None,
    owner_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    now = datetime.utcnow()
    future_date = now + timedelta(days=days)
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.last_reviewer)
    ).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date >= now,
        GovernanceDocument.next_review_date <= future_date,
        GovernanceDocument.status.notin_(["archived", "expired"])
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    if doc_type:
        query = query.filter(GovernanceDocument.doc_type == doc_type)
    if owner_id:
        query = query.filter(GovernanceDocument.owner_id == owner_id)
    
    total = query.count()
    documents = query.order_by(GovernanceDocument.next_review_date.asc()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_review_document(doc) for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit,
        "days_ahead": days
    }


@router.get("/overdue")
def get_overdue_reviews(
    tenant_id: Optional[int] = None,
    doc_type: Optional[str] = None,
    owner_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    now = datetime.utcnow()
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.last_reviewer)
    ).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date < now,
        GovernanceDocument.status.notin_(["archived", "expired"])
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    if doc_type:
        query = query.filter(GovernanceDocument.doc_type == doc_type)
    if owner_id:
        query = query.filter(GovernanceDocument.owner_id == owner_id)
    
    total = query.count()
    documents = query.order_by(GovernanceDocument.next_review_date.asc()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_review_document(doc) for doc in documents],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("/{document_id}/start", status_code=status.HTTP_201_CREATED)
def start_document_review(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Mark a periodic document review as started; logs an audit entry."""
    user_tenants = get_user_tenants(current_user, db)

    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()

    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )

    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="reviewed",
        action_details="Review cycle started.",
    )
    db.commit()

    return {
        "message": "Review started",
        "document_id": document_id,
        "review_status": "in_progress",
    }


@router.post("/{document_id}/complete")
def complete_review(
    document_id: int,
    review_data: CompleteReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    now = datetime.utcnow()
    old_last_reviewed = document.last_reviewed_at.isoformat() if document.last_reviewed_at else None
    old_next_review = document.next_review_date.isoformat() if document.next_review_date else None
    
    document.last_reviewed_at = now
    document.last_reviewed_by = current_user.id
    
    if review_data.next_review_date:
        document.next_review_date = review_data.next_review_date
    elif document.review_cycle_months:
        document.next_review_date = now + relativedelta(months=document.review_cycle_months)
    
    document.updated_at = now
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="reviewed",
        action_details=f"Review completed. {review_data.notes if review_data.notes else ''}".strip(),
        field_changed="last_reviewed_at",
        old_value=old_last_reviewed,
        new_value=now.isoformat()
    )
    
    db.commit()
    db.refresh(document)
    
    return {
        "message": "Review completed successfully",
        "document": serialize_review_document(document),
        "next_review_date": document.next_review_date.isoformat() if document.next_review_date else None
    }


@router.get("/my-reviews")
def get_reviews_due_by_user(
    include_owned: bool = True,
    include_assigned: bool = True,
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    now = datetime.utcnow()
    future_90_days = now + timedelta(days=90)
    
    conditions = []
    
    if include_owned:
        conditions.append(GovernanceDocument.owner_id == current_user.id)
    
    if include_assigned:
        reviewer_doc_ids = db.query(DocumentReviewer.document_id).filter(
            DocumentReviewer.user_id == current_user.id,
            DocumentReviewer.role_type.in_(["reviewer", "owner", "approver"])
        ).subquery()
        conditions.append(GovernanceDocument.id.in_(reviewer_doc_ids))
    
    if not conditions:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.last_reviewer)
    ).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date <= future_90_days,
        GovernanceDocument.status.notin_(["archived", "expired"]),
        or_(*conditions)
    )
    
    if status_filter == "overdue":
        query = query.filter(GovernanceDocument.next_review_date < now)
    elif status_filter == "upcoming":
        query = query.filter(GovernanceDocument.next_review_date >= now)
    
    total = query.count()
    documents = query.order_by(GovernanceDocument.next_review_date.asc()).offset(skip).limit(limit).all()
    
    overdue_count = sum(1 for doc in documents if doc.next_review_date and doc.next_review_date < now)
    upcoming_count = total - overdue_count
    
    return {
        "items": [serialize_review_document(doc) for doc in documents],
        "total": total,
        "overdue_count": overdue_count,
        "upcoming_count": upcoming_count,
        "skip": skip,
        "limit": limit
    }


@router.get("/calendar")
def get_review_calendar(
    year: int = Query(None, ge=2020, le=2100),
    month: Optional[int] = Query(None, ge=1, le=12),
    group_by: str = Query("month", pattern="^(month|week)$"),
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"calendar": [], "summary": {}}
    
    now = datetime.utcnow()
    if year is None:
        year = now.year
    
    if month:
        start_date = datetime(year, month, 1)
        if month == 12:
            end_date = datetime(year + 1, 1, 1)
        else:
            end_date = datetime(year, month + 1, 1)
    else:
        start_date = datetime(year, 1, 1)
        end_date = datetime(year + 1, 1, 1)
    
    query = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner)
    ).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date >= start_date,
        GovernanceDocument.next_review_date < end_date,
        GovernanceDocument.status.notin_(["archived", "expired"])
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    documents = query.order_by(GovernanceDocument.next_review_date.asc()).all()
    
    calendar_data = {}
    
    for doc in documents:
        if group_by == "month":
            key = doc.next_review_date.strftime("%Y-%m")
            label = doc.next_review_date.strftime("%B %Y")
        else:
            iso_year, iso_week, _ = doc.next_review_date.isocalendar()
            key = f"{iso_year}-W{iso_week:02d}"
            label = f"Week {iso_week}, {iso_year}"
        
        if key not in calendar_data:
            calendar_data[key] = {
                "period": key,
                "label": label,
                "documents": [],
                "count": 0
            }
        
        calendar_data[key]["documents"].append({
            "id": doc.id,
            "title": doc.title,
            "doc_type": doc.doc_type,
            "next_review_date": doc.next_review_date.isoformat() if doc.next_review_date else None,
            "owner_name": doc.owner.display_name if doc.owner else None
        })
        calendar_data[key]["count"] += 1
    
    calendar_list = sorted(calendar_data.values(), key=lambda x: x["period"])
    
    return {
        "calendar": calendar_list,
        "summary": {
            "year": year,
            "month": month,
            "group_by": group_by,
            "total_reviews": len(documents),
            "periods_with_reviews": len(calendar_list)
        }
    }


@router.put("/{document_id}/review-cycle")
def update_review_cycle(
    document_id: int,
    cycle_data: UpdateReviewCycleRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if cycle_data.review_cycle_months < 1 or cycle_data.review_cycle_months > 60:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Review cycle must be between 1 and 60 months"
        )
    
    old_cycle = document.review_cycle_months
    old_next_review = document.next_review_date.isoformat() if document.next_review_date else None
    
    document.review_cycle_months = cycle_data.review_cycle_months
    
    if cycle_data.recalculate_next_review:
        base_date = document.last_reviewed_at or document.effective_date or datetime.utcnow()
        document.next_review_date = base_date + relativedelta(months=cycle_data.review_cycle_months)
    
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="review_cycle_updated",
        action_details=f"Review cycle changed from {old_cycle} to {cycle_data.review_cycle_months} months",
        field_changed="review_cycle_months",
        old_value=str(old_cycle) if old_cycle else None,
        new_value=str(cycle_data.review_cycle_months)
    )
    
    db.commit()
    db.refresh(document)
    
    return {
        "message": "Review cycle updated successfully",
        "document_id": document.id,
        "review_cycle_months": document.review_cycle_months,
        "next_review_date": document.next_review_date.isoformat() if document.next_review_date else None
    }


@router.post("/{document_id}/skip")
def skip_review(
    document_id: int,
    skip_data: SkipReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if not skip_data.reason or len(skip_data.reason.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A reason with at least 10 characters is required to skip a review"
        )
    
    old_next_review = document.next_review_date.isoformat() if document.next_review_date else None
    
    reschedule_months = skip_data.reschedule_months or document.review_cycle_months or 12
    now = datetime.utcnow()
    document.next_review_date = now + relativedelta(months=reschedule_months)
    document.updated_at = now
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="review_skipped",
        action_details=f"Review skipped. Reason: {skip_data.reason}. Rescheduled for {reschedule_months} months.",
        field_changed="next_review_date",
        old_value=old_next_review,
        new_value=document.next_review_date.isoformat()
    )
    
    db.commit()
    db.refresh(document)
    
    return {
        "message": "Review skipped and rescheduled successfully",
        "document_id": document.id,
        "reason": skip_data.reason,
        "next_review_date": document.next_review_date.isoformat() if document.next_review_date else None,
        "rescheduled_months": reschedule_months
    }


@router.get("/statistics")
def get_review_statistics(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_documents": 0,
            "total_with_review_date": 0,
            "overdue": 0,
            "due_this_week": 0,
            "due_this_month": 0,
            "due_next_30_days": 0,
            "by_doc_type": {},
            "by_status": {},
            "never_reviewed": 0
        }
    
    now = datetime.utcnow()
    end_of_week = now + timedelta(days=(7 - now.weekday()))
    end_of_month = datetime(now.year, now.month + 1, 1) if now.month < 12 else datetime(now.year + 1, 1, 1)
    next_30_days = now + timedelta(days=30)
    
    base_query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.status.notin_(["archived", "expired"])
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        base_query = base_query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    total_documents = base_query.count()
    
    with_review_date = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None)
    ).count()
    
    overdue = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date < now
    ).count()
    
    due_this_week = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date >= now,
        GovernanceDocument.next_review_date <= end_of_week
    ).count()
    
    due_this_month = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date >= now,
        GovernanceDocument.next_review_date < end_of_month
    ).count()
    
    due_next_30_days = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date >= now,
        GovernanceDocument.next_review_date <= next_30_days
    ).count()
    
    never_reviewed = base_query.filter(
        GovernanceDocument.last_reviewed_at.is_(None)
    ).count()
    
    docs_with_reviews = base_query.filter(
        GovernanceDocument.next_review_date.isnot(None),
        GovernanceDocument.next_review_date <= next_30_days
    ).all()
    
    by_doc_type = {}
    by_status = {"overdue": 0, "due_soon": 0, "on_track": 0}
    
    for doc in docs_with_reviews:
        doc_type = doc.doc_type or "unknown"
        if doc_type not in by_doc_type:
            by_doc_type[doc_type] = {"total": 0, "overdue": 0, "due_soon": 0}
        
        by_doc_type[doc_type]["total"] += 1
        
        if doc.next_review_date < now:
            by_doc_type[doc_type]["overdue"] += 1
            by_status["overdue"] += 1
        elif doc.next_review_date <= now + timedelta(days=7):
            by_doc_type[doc_type]["due_soon"] += 1
            by_status["due_soon"] += 1
        else:
            by_status["on_track"] += 1
    
    return {
        "total_documents": total_documents,
        "total_with_review_date": with_review_date,
        "overdue": overdue,
        "due_this_week": due_this_week,
        "due_this_month": due_this_month,
        "due_next_30_days": due_next_30_days,
        "by_doc_type": by_doc_type,
        "by_status": by_status,
        "never_reviewed": never_reviewed
    }


@router.get("/{document_id}/history")
def get_review_history(
    document_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    review_actions = ["reviewed", "review_skipped", "review_cycle_updated"]
    
    audit_logs = db.query(DocumentAuditLog).options(
        joinedload(DocumentAuditLog.user)
    ).filter(
        DocumentAuditLog.document_id == document_id,
        DocumentAuditLog.action.in_(review_actions)
    ).order_by(DocumentAuditLog.performed_at.desc()).offset(skip).limit(limit).all()
    
    total = db.query(DocumentAuditLog).filter(
        DocumentAuditLog.document_id == document_id,
        DocumentAuditLog.action.in_(review_actions)
    ).count()
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "items": [
            {
                "id": log.id,
                "action": log.action,
                "action_details": log.action_details,
                "field_changed": log.field_changed,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "performed_by": log.performed_by,
                "performer_name": log.user.display_name if log.user else None,
                "performed_at": log.performed_at.isoformat() if log.performed_at else None
            }
            for log in audit_logs
        ],
        "total": total,
        "skip": skip,
        "limit": limit
    }

@router.get("/governance-actions/pending")
def get_pending_governance_actions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get pending governance action reviews for current user's tenants"""
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.tenant_id.in_(user_tenants),
        GovernanceActionReview.review_status == "pending_review"
    )
    
    if action_type:
        query = query.filter(GovernanceActionReview.action_type == action_type)
    
    if entity_type:
        query = query.filter(GovernanceActionReview.entity_type == entity_type)
    
    total = query.count()
    reviews = query.order_by(GovernanceActionReview.action_date.desc()).offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": review.id,
                "action_type": review.action_type,
                "action_description": review.action_description,
                "entity_type": review.entity_type,
                "entity_id": review.entity_id,
                "review_status": review.review_status,
                "action_user_id": review.action_user_id,
                "action_user_name": review.action_user.display_name if review.action_user else None,
                "action_date": review.action_date.isoformat(),
                "action_metadata": review.action_metadata,
                "review_notes": review.review_notes,
                "reviewer_id": review.reviewer_id,
                "reviewer_name": review.reviewer.display_name if review.reviewer else None,
                "review_started_at": review.review_started_at.isoformat() if review.review_started_at else None,
                "review_completed_at": review.review_completed_at.isoformat() if review.review_completed_at else None,
            }
            for review in reviews
        ]
    }


@router.get("/governance-actions")
def get_all_governance_actions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status_filter: Optional[str] = None,
    action_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get all governance action reviews for current user's tenants"""
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.tenant_id.in_(user_tenants)
    )
    
    if status_filter:
        query = query.filter(GovernanceActionReview.review_status == status_filter)
    
    if action_type:
        query = query.filter(GovernanceActionReview.action_type == action_type)
    
    total = query.count()
    reviews = query.order_by(GovernanceActionReview.action_date.desc()).offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [
            {
                "id": review.id,
                "action_type": review.action_type,
                "action_description": review.action_description,
                "entity_type": review.entity_type,
                "entity_id": review.entity_id,
                "review_status": review.review_status,
                "action_user_id": review.action_user_id,
                "action_user_name": review.action_user.display_name if review.action_user else None,
                "action_date": review.action_date.isoformat(),
                "action_metadata": review.action_metadata,
                "review_notes": review.review_notes,
                "reviewer_id": review.reviewer_id,
                "reviewer_name": review.reviewer.display_name if review.reviewer else None,
                "review_started_at": review.review_started_at.isoformat() if review.review_started_at else None,
                "review_completed_at": review.review_completed_at.isoformat() if review.review_completed_at else None,
            }
            for review in reviews
        ]
    }


@router.put("/governance-actions/{review_id}")
def update_governance_action_review(
    review_id: int,
    request: UpdateActionReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Update the review status of a governance action"""
    user_tenants = get_user_tenants(current_user, db)
    
    review = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.id == review_id,
        GovernanceActionReview.tenant_id.in_(user_tenants)
    ).first()
    
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review record not found or access denied"
        )
    
    review = update_action_review_status(
        db=db,
        review_id=review_id,
        status=request.review_status,
        reviewer_id=current_user.id,
        review_notes=request.review_notes
    )
    
    db.commit()
    db.refresh(review)
    
    return {
        "id": review.id,
        "action_type": review.action_type,
        "action_description": review.action_description,
        "entity_type": review.entity_type,
        "entity_id": review.entity_id,
        "review_status": review.review_status,
        "action_user_id": review.action_user_id,
        "action_user_name": review.action_user.display_name if review.action_user else None,
        "action_date": review.action_date.isoformat(),
        "action_metadata": review.action_metadata,
        "review_notes": review.review_notes,
        "reviewer_id": review.reviewer_id,
        "reviewer_name": review.reviewer.display_name if review.reviewer else None,
        "review_started_at": review.review_started_at.isoformat() if review.review_started_at else None,
        "review_completed_at": review.review_completed_at.isoformat() if review.review_completed_at else None,
    }


@router.get("/my-pending-reviews")
def get_my_pending_reviews(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get pending reviews for actions taken by the current user"""
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.tenant_id.in_(user_tenants),
        GovernanceActionReview.action_user_id == current_user.id,
        GovernanceActionReview.review_status == "pending_review"
    )
    
    if action_type:
        query = query.filter(GovernanceActionReview.action_type == action_type)
    
    if entity_type:
        query = query.filter(GovernanceActionReview.entity_type == entity_type)
    
    total = query.count()
    reviews = query.order_by(GovernanceActionReview.action_date.desc()).offset(skip).limit(limit).all()
    
    # Get entity details if it's a governance document
    items_with_details = []
    for review in reviews:
        item = {
            "id": review.id,
            "action_type": review.action_type,
            "action_description": review.action_description,
            "entity_type": review.entity_type,
            "entity_id": review.entity_id,
            "review_status": review.review_status,
            "action_user_id": review.action_user_id,
            "action_user_name": review.action_user.display_name if review.action_user else None,
            "action_date": review.action_date.isoformat(),
            "action_metadata": review.action_metadata,
            "review_notes": review.review_notes,
            "reviewer_id": review.reviewer_id,
            "reviewer_name": review.reviewer.display_name if review.reviewer else None,
            "review_started_at": review.review_started_at.isoformat() if review.review_started_at else None,
            "review_completed_at": review.review_completed_at.isoformat() if review.review_completed_at else None,
        }
        
        # Add document details if entity is a governance_document
        if review.entity_type == "governance_document" and review.entity_id:
            doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == review.entity_id).first()
            if doc:
                item["document_title"] = doc.title
                item["document_code"] = doc.document_code
                item["doc_type"] = doc.doc_type
                item["document_status"] = doc.status
        
        items_with_details.append(item)
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": items_with_details
    }


@router.get("/my-pending-approvals")
def get_my_pending_approvals(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Get pending approvals for items that need approval by the current user.
    This includes:
    1. Actions from other users where current user is the document owner
    2. Actions from other users where current user is assigned as reviewer
    3. Actions where current user has admin/governance role
    """
    user_tenants = get_user_tenants(current_user, db)
    
    # Get all pending actions from OTHER users
    query = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.tenant_id.in_(user_tenants),
        GovernanceActionReview.action_user_id != current_user.id,
        GovernanceActionReview.review_status == "pending_review"
    )
    
    if action_type:
        query = query.filter(GovernanceActionReview.action_type == action_type)
    
    if entity_type:
        query = query.filter(GovernanceActionReview.entity_type == entity_type)
    
    all_reviews = query.order_by(GovernanceActionReview.action_date.desc()).all()
    
    # Filter to items where current user should approve
    items_needing_approval = []
    for review in all_reviews:
        should_approve = False
        
        # Check if current user is document owner
        if review.entity_type == "governance_document" and review.entity_id:
            doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == review.entity_id).first()
            if doc and doc.owner_id == current_user.id:
                should_approve = True
        
        # Check if current user is assigned as reviewer
        if review.entity_type == "governance_document" and review.entity_id:
            reviewer_assignment = db.query(DocumentReviewer).filter(
                DocumentReviewer.document_id == review.entity_id,
                DocumentReviewer.user_id == current_user.id,
                DocumentReviewer.role_type.in_(["reviewer", "approver"])
            ).first()
            if reviewer_assignment:
                should_approve = True
        
        # Check if user has admin/governance role
        if hasattr(current_user, 'role') and current_user.role in ['admin', 'governance_admin']:
            should_approve = True
        
        if should_approve:
            item = {
                "id": review.id,
                "action_type": review.action_type,
                "action_description": review.action_description,
                "entity_type": review.entity_type,
                "entity_id": review.entity_id,
                "review_status": review.review_status,
                "action_user_id": review.action_user_id,
                "action_user_name": review.action_user.display_name if review.action_user else None,
                "action_date": review.action_date.isoformat(),
                "action_metadata": review.action_metadata,
                "review_notes": review.review_notes,
                "reviewer_id": review.reviewer_id,
                "reviewer_name": review.reviewer.display_name if review.reviewer else None,
                "review_started_at": review.review_started_at.isoformat() if review.review_started_at else None,
                "review_completed_at": review.review_completed_at.isoformat() if review.review_completed_at else None,
            }
            
            # Add document details if entity is a governance_document
            if review.entity_type == "governance_document" and review.entity_id:
                doc = db.query(GovernanceDocument).filter(GovernanceDocument.id == review.entity_id).first()
                if doc:
                    item["document_title"] = doc.title
                    item["document_code"] = doc.document_code
                    item["doc_type"] = doc.doc_type
                    item["document_status"] = doc.status
            
            items_needing_approval.append(item)
    
    # Apply pagination
    total = len(items_needing_approval)
    paginated_items = items_needing_approval[skip:skip + limit]
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": paginated_items
    }
