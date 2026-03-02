import json
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from ...models import GovernanceActionReview, GRCUser


def log_governance_action(
    db: Session,
    tenant_id: int,
    action_type: str,
    action_description: str,
    entity_type: str,
    action_user_id: int,
    entity_id: Optional[int] = None,
    action_metadata: Optional[Dict[str, Any]] = None
) -> GovernanceActionReview:
    """
    Log a governance action that requires review.
    
    Args:
        db: Database session
        tenant_id: Tenant ID
        action_type: Type of action (e.g., 'document_draft_created', 'risk_accepted', 'evidence_uploaded')
        action_description: Human-readable description of the action
        entity_type: Type of entity (e.g., 'governance_document', 'risk', 'evidence')
        action_user_id: ID of user who performed the action
        entity_id: ID of the entity related to the action
        action_metadata: Additional metadata about the action
    
    Returns:
        GovernanceActionReview object created
    """
    action_review = GovernanceActionReview(
        tenant_id=tenant_id,
        action_type=action_type,
        action_description=action_description,
        entity_type=entity_type,
        entity_id=entity_id,
        action_user_id=action_user_id,
        action_metadata=action_metadata or {},
        review_status="pending_review",
    )
    
    db.add(action_review)
    db.flush()  # Flush to generate the ID but don't commit yet
    
    return action_review


def get_pending_reviews(
    db: Session,
    tenant_id: int,
    skip: int = 0,
    limit: int = 100,
    action_type: Optional[str] = None,
    entity_type: Optional[str] = None
):
    """Get pending governance action reviews."""
    query = db.query(GovernanceActionReview).filter(
        GovernanceActionReview.tenant_id == tenant_id,
        GovernanceActionReview.review_status == "pending_review"
    )
    
    if action_type:
        query = query.filter(GovernanceActionReview.action_type == action_type)
    
    if entity_type:
        query = query.filter(GovernanceActionReview.entity_type == entity_type)
    
    return query.order_by(GovernanceActionReview.action_date.desc()).offset(skip).limit(limit).all()


def update_action_review_status(
    db: Session,
    review_id: int,
    status: str,
    reviewer_id: Optional[int] = None,
    review_notes: Optional[str] = None
) -> GovernanceActionReview:
    """Update the review status of a governance action."""
    review = db.query(GovernanceActionReview).filter(GovernanceActionReview.id == review_id).first()
    
    if not review:
        return None
    
    review.review_status = status
    if reviewer_id:
        review.reviewer_id = reviewer_id
    if review_notes:
        review.review_notes = review_notes
    
    if status == "in_review" and not review.review_started_at:
        review.review_started_at = datetime.utcnow()
    
    if status in ["approved", "rejected", "archived"] and not review.review_completed_at:
        review.review_completed_at = datetime.utcnow()
    
    db.flush()
    return review
