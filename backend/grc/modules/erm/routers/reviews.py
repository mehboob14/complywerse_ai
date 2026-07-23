from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Risk, RiskReview, RiskScoreHistory, GRCUser, get_db
)
from ....schemas import (
    RiskReviewCreate, RiskReviewUpdate, RiskReviewResponse,
    RiskScoreHistoryResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/reviews", tags=["ERM - Reviews"])


def record_score_history(
    risk: Risk, 
    user: GRCUser, 
    db: Session, 
    change_reason: str = None
) -> RiskScoreHistory:
    history = RiskScoreHistory(
        risk_id=risk.id,
        inherent_likelihood=risk.inherent_likelihood,
        inherent_impact=risk.inherent_impact,
        inherent_score=risk.inherent_score,
        residual_likelihood=risk.residual_likelihood,
        residual_impact=risk.residual_impact,
        residual_score=risk.residual_score,
        status=risk.status,
        change_reason=change_reason,
        changed_by=user.id
    )
    db.add(history)
    return history


@router.get("", response_model=List[RiskReviewResponse])
def list_reviews(
    risk_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    reviewer_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskReview).join(Risk).filter(Risk.tenant_id.in_(user_tenants))
    
    if risk_id:
        query = query.filter(RiskReview.risk_id == risk_id)
    if status_filter:
        query = query.filter(RiskReview.status == status_filter)
    if reviewer_id:
        query = query.filter(RiskReview.reviewer_id == reviewer_id)
    
    reviews = query.order_by(RiskReview.due_date.asc()).offset(skip).limit(limit).all()
    
    result = []
    for review in reviews:
        review_data = RiskReviewResponse.model_validate(review)
        if review.risk:
            review_data.risk_title = review.risk.title
        result.append(review_data)
    
    return result


@router.post("", response_model=RiskReviewResponse, status_code=status.HTTP_201_CREATED)
def schedule_review(
    review: RiskReviewCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    risk = db.query(Risk).filter(
        Risk.id == review.risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    db_review = RiskReview(
        risk_id=review.risk_id,
        review_cycle=review.review_cycle,
        review_type=review.review_type,
        due_date=review.due_date,
        reviewer_id=review.reviewer_id,
        previous_inherent_score=risk.inherent_score,
        previous_residual_score=risk.residual_score
    )
    db.add(db_review)
    db.commit()
    db.refresh(db_review)
    
    review_data = RiskReviewResponse.model_validate(db_review)
    review_data.risk_title = risk.title
    return review_data


@router.post("/bulk-schedule", response_model=List[RiskReviewResponse])
def bulk_schedule_reviews(
    risk_ids: List[int],
    due_date: datetime,
    review_cycle: str = "quarterly",
    review_type: str = "periodic",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    risks = db.query(Risk).filter(
        Risk.id.in_(risk_ids),
        Risk.tenant_id.in_(user_tenants)
    ).all()
    
    if not risks:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No risks found"
        )
    
    created_reviews = []
    for risk in risks:
        db_review = RiskReview(
            risk_id=risk.id,
            review_cycle=review_cycle,
            review_type=review_type,
            due_date=due_date,
            previous_inherent_score=risk.inherent_score,
            previous_residual_score=risk.residual_score
        )
        db.add(db_review)
        created_reviews.append((db_review, risk.title))
    
    db.commit()
    
    result = []
    for db_review, risk_title in created_reviews:
        db.refresh(db_review)
        review_data = RiskReviewResponse.model_validate(db_review)
        review_data.risk_title = risk_title
        result.append(review_data)
    
    return result


@router.get("/pending", response_model=List[RiskReviewResponse])
def get_pending_reviews(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskReview.status.in_(["pending", "in_review"])
    ).order_by(RiskReview.due_date.asc()).all()
    
    result = []
    for review in reviews:
        review_data = RiskReviewResponse.model_validate(review)
        if review.risk:
            review_data.risk_title = review.risk.title
        result.append(review_data)
    
    return result


@router.get("/overdue", response_model=List[RiskReviewResponse])
def get_overdue_reviews(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    now = datetime.utcnow()
    reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskReview.status.in_(["pending", "in_review"]),
        RiskReview.due_date < now
    ).order_by(RiskReview.due_date.asc()).all()
    
    result = []
    for review in reviews:
        review_data = RiskReviewResponse.model_validate(review)
        if review.risk:
            review_data.risk_title = review.risk.title
        result.append(review_data)
    
    return result


@router.get("/{review_id}", response_model=RiskReviewResponse)
def get_review(
    review_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    review = db.query(RiskReview).options(
        joinedload(RiskReview.risk)
    ).join(Risk).filter(
        RiskReview.id == review_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found"
        )
    
    review_data = RiskReviewResponse.model_validate(review)
    if review.risk:
        review_data.risk_title = review.risk.title
    return review_data


@router.put("/{review_id}", response_model=RiskReviewResponse)
def update_review(
    review_id: int,
    review_update: RiskReviewUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    review = db.query(RiskReview).options(
        joinedload(RiskReview.risk)
    ).join(Risk).filter(
        RiskReview.id == review_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found"
        )
    
    update_data = review_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "in_review" and not review.started_at:
        update_data["started_at"] = datetime.utcnow()
        update_data["reviewer_id"] = current_user.id
    
    if update_data.get("status") in ["approved", "rejected"] and not review.completed_at:
        update_data["completed_at"] = datetime.utcnow()
        update_data["approver_id"] = current_user.id
        
        if update_data.get("status") == "approved" and review.risk:
            if update_data.get("new_inherent_score") or update_data.get("new_residual_score"):
                record_score_history(review.risk, current_user, db, f"Review #{review_id} approved")
    
    for key, value in update_data.items():
        setattr(review, key, value)
    
    db.commit()
    db.refresh(review)
    
    review_data = RiskReviewResponse.model_validate(review)
    if review.risk:
        review_data.risk_title = review.risk.title
    return review_data
