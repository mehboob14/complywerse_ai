from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from ....models import Risk, RiskReview, GRCUser, get_db, risk_priority_for_score
from ....schemas import RiskReviewCreate, RiskReviewUpdate, RiskReviewResponse
from ....routers.auth_router import require_auth, get_user_tenants, refuse_imported_accounts, require_tenant_permission
from ....rich_audit import write_rich_audit_log
from ....services.segregation import ensure_independent
from ...workflow_engine.services.notification_service import send_workflow_notification
from ..services.holders import holder_ids
from .risks import _bucket_status, record_risk_change, rescore_after_edit, risk_snapshot

router = APIRouter(prefix="/reviews", tags=["ERM - Reviews"])

# Writes: the risk assessment permission, or the ERM risk permission the risk editors hold today (admins pass).
EDIT_GRANTS = ("risks:risk_assessment:edit", "erm:risks:edit")      # who approves, returns and reassigns
CAN_CREATE = [Depends(require_tenant_permission("risks:risk_assessment:create", "erm:risks:create"))]
CAN_EDIT = [Depends(require_tenant_permission(*EDIT_GRANTS))]
# Scheduled is stored as "pending", the name older rows and the dashboards use.
OPEN_STATUSES = ("pending", "scheduled", "in_review", "submitted")
WORKING = ("pending", "scheduled", "in_review")     # the reviewer can still change the proposal
SUBMIT = ("submitted", "completed")                 # "completed" is the old call: now a submission for approval
RETURN = ("returned", "rejected")                   # a challenge: back to in review with a note
# The next review by residual band (inherent when there is no residual); medium, low and unscored risks yearly.
REVIEW_CYCLE = {"critical": ("quarterly", 90), "high": ("semi_annual", 180)}
YEARLY = ("annual", 365)
PROPOSAL = ("inherent_likelihood", "inherent_impact", "residual_likelihood", "residual_impact")


class _Proposal(BaseModel):
    proposed_inherent_likelihood: Optional[int] = Field(None, ge=1, le=5)
    proposed_inherent_impact: Optional[int] = Field(None, ge=1, le=5)
    proposed_residual_likelihood: Optional[int] = Field(None, ge=1, le=5)
    proposed_residual_impact: Optional[int] = Field(None, ge=1, le=5)


class ReviewChange(RiskReviewUpdate, _Proposal):
    pass


class ReviewOut(RiskReviewResponse, _Proposal):
    submitted_by: Optional[int] = None


class ReassignIn(BaseModel):
    reviewer_id: int
    note: Optional[str] = None


def _name(user: Optional[GRCUser]) -> str:
    return (user.display_name or user.username) if user else "Someone"


def tell(db: Session, review: RiskReview, risk: Risk, user_ids, actor: Optional[GRCUser], subject: str, message: str) -> None:
    """In-app (and email where set up) to the people who act next, never the one who just acted, with a link to the review."""
    to = sorted({u for u in user_ids if u and u != getattr(actor, "id", None)})
    if to:
        send_workflow_notification(db, tenant_id=risk.tenant_id, subject=subject, message=message,
                                   workflow_instance_id=None, user_ids=to, link=f"/erm/reviews?review={review.id}")


def tell_approvers(db: Session, review: RiskReview, risk: Risk, actor: Optional[GRCUser]) -> None:
    """A submitted proposal goes to whoever may approve it: the risk editors other than its reviewer and its submitter."""
    tell(db, review, risk, holder_ids(db, *EDIT_GRANTS, tenant_id=risk.tenant_id, but_not=(review.reviewer_id, review.submitted_by)), actor,
         f"Risk review to approve: {risk.title}",
         f"{_name(actor)} submitted the review of {risk.title} with a proposed score change. Approve it or return it.")


def _reassign(db: Session, review: RiskReview, reviewer_id: Optional[int], user: GRCUser, note: Optional[str] = None) -> None:
    """An approver (the edit grant, but not the review's own reviewer) hands a review not yet submitted to someone else;
    kept in the audit log, and the new reviewer is told."""
    if review.status not in WORKING:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Only a review not yet submitted is reassigned: return it first.")
    if reviewer_id == review.reviewer_id:
        return
    if reviewer_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name the new reviewer.")
    if review.reviewer_id == user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="This review is yours: someone who approves reviews reassigns it.")
    refuse_imported_accounts(db, [reviewer_id])
    reviewer = db.query(GRCUser).filter(GRCUser.id == reviewer_id, GRCUser.is_active.is_(True)).first()
    if reviewer is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reviewer not found")
    note = (note or "").strip() or None
    risk = review.risk
    write_rich_audit_log(db=db, tenant_id=risk.tenant_id, user_id=user.id, action="risk_review_reassigned",
                         resource_type="risk_review", resource_id=review.id, resource_name=risk.title, summary=note,
                         snapshot={"from": review.reviewer_id, "to": reviewer_id, "note": note})
    review.reviewer_id = reviewer_id
    tell(db, review, risk, [reviewer_id], user, f"Risk review assigned to you: {risk.title}",
         f"{_name(user)} gave you the review of {risk.title}, due {review.due_date:%d %b %Y}."
         + (f" Note: {note}" if note else ""))


def _out(review: RiskReview) -> ReviewOut:
    data = ReviewOut.model_validate(review)
    if review.risk:
        data.risk_title = review.risk.title
    return data


def _open_review(db: Session, risk_id: int, but_not: Optional[int] = None) -> Optional[RiskReview]:
    query = db.query(RiskReview).filter(RiskReview.risk_id == risk_id, RiskReview.status.in_(OPEN_STATUSES))
    return query.filter(RiskReview.id != but_not).first() if but_not else query.first()


def _schedule_next(db: Session, risk: Risk, after: datetime, due: Optional[datetime] = None) -> RiskReview:
    """A periodic review one band cycle after `after` (or on `due`), assigned to the risk owner: none when it has none."""
    cycle, days = REVIEW_CYCLE.get(risk_priority_for_score(risk.residual_score or risk.inherent_score), YEARLY)
    review = RiskReview(risk_id=risk.id, review_cycle=cycle, review_type="periodic", status="pending",
                        due_date=due or after + timedelta(days=days), reviewer_id=risk.owner_id,
                        previous_inherent_score=risk.inherent_score, previous_residual_score=risk.residual_score)
    db.add(review)
    return review


def _approve(db: Session, review: RiskReview, notes: Optional[str], user: GRCUser) -> None:
    """Write the proposal to the risk with the review as the reason, close the review and schedule the next one."""
    ensure_independent(review.reviewer_id, user, "approve this review")
    ensure_independent(review.submitted_by, user, "approve this review")
    risk = review.risk
    before = risk_snapshot(risk)
    changes = {f: getattr(review, f"proposed_{f}") for f in PROPOSAL if getattr(review, f"proposed_{f}") is not None}
    for side in ("inherent", "residual"):      # the old call proposed a bare score
        score = getattr(review, f"new_{side}_score")
        if score is not None and not any(f.startswith(side) for f in changes):
            changes[f"{side}_score"] = score
    for field, value in changes.items():
        setattr(risk, field, value)
    rescore_after_edit(risk, changes)

    now = datetime.utcnow()
    review.status, review.approver_id, review.completed_at = "approved", user.id, now
    review.previous_inherent_score, review.previous_residual_score = before["inherent_score"], before["residual_score"]
    review.new_inherent_score, review.new_residual_score = risk.inherent_score, risk.residual_score
    if notes:
        review.approval_notes = notes
    if _bucket_status(risk.status) != "closed":
        risk.review_date = (_open_review(db, risk.id, but_not=review.id) or _schedule_next(db, risk, now)).due_date
    findings = " ".join((review.findings or "").split())[:200]
    record_risk_change(db, risk, before, user, f"Review #{review.id}: {findings}" if findings else f"Review #{review.id}",
                       label=f"Review #{review.id} approved")


@router.get("", response_model=List[ReviewOut])
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

    return [_out(review) for review in query.order_by(RiskReview.due_date.asc()).offset(skip).limit(limit).all()]


@router.post("", response_model=ReviewOut, status_code=status.HTTP_201_CREATED, dependencies=CAN_CREATE)
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

    refuse_imported_accounts(db, [review.reviewer_id])
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
    return _out(db_review)


@router.post("/schedule-due", dependencies=CAN_CREATE)
def schedule_due_reviews(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """A review for every active risk with none open, assigned to the risk owner and due on the risk's review date, else
    one band cycle after its last completed review (or its creation). Risks with no owner are listed to be assigned."""
    user_tenants = get_user_tenants(current_user, db)
    covered = db.query(RiskReview.risk_id).filter(RiskReview.status.in_(OPEN_STATUSES))
    risks = [r for r in db.query(Risk).filter(Risk.tenant_id.in_(user_tenants), Risk.id.notin_(covered)).all()
             if _bucket_status(r.status) != "closed"]
    last_done = dict(db.query(RiskReview.risk_id, func.max(RiskReview.completed_at))
                     .filter(RiskReview.risk_id.in_([r.id for r in risks])).group_by(RiskReview.risk_id).all())
    now = datetime.utcnow()
    made = [_schedule_next(db, r, last_done.get(r.id) or r.created_at or now, due=r.review_date) for r in risks]
    db.commit()
    return {"created": [_out(review) for review in made],
            "without_owner": [{"risk_id": r.id, "risk_title": r.title} for r in risks if r.owner_id is None]}


@router.get("/pending", response_model=List[ReviewOut])
def get_pending_reviews(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskReview.status.in_(OPEN_STATUSES)
    ).order_by(RiskReview.due_date.asc()).all()
    return [_out(review) for review in reviews]


@router.get("/overdue", response_model=List[ReviewOut])
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
        RiskReview.status.in_(OPEN_STATUSES),
        RiskReview.due_date < now
    ).order_by(RiskReview.due_date.asc()).all()
    return [_out(review) for review in reviews]


@router.get("/{review_id}", response_model=ReviewOut)
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
    return _out(review)


@router.put("/{review_id}", response_model=ReviewOut, dependencies=CAN_EDIT)
def update_review(
    review_id: int,
    review_update: ReviewChange,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Start (in_review), submit the proposal (submitted, or the old "completed"), approve it (approved: someone other
    than the reviewer and the submitter) or return it with a note (returned: back to in review)."""
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
    if review.status not in OPEN_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This review is closed.")

    data = review_update.model_dump(exclude_unset=True)
    data.pop("approver_id", None)          # stamped by the approval, never sent
    new_status = data.pop("status", None)
    notes = (data.pop("approval_notes", None) or "").strip()

    if new_status == "approved" or new_status in RETURN:
        if review.status != "submitted":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="Only a submitted review can be approved or returned.")
        if new_status == "approved":
            _approve(db, review, notes, current_user)
            tell(db, review, review.risk, [review.reviewer_id], current_user, f"Risk review approved: {review.risk.title}",
                 f"{_name(current_user)} approved your review of {review.risk.title}; the register now has its scores."
                 + (f" Note: {notes}" if notes else ""))
        elif not notes:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail="Say what the reviewer needs to change.")
        else:
            review.status, review.approval_notes = "in_review", notes
            tell(db, review, review.risk, [review.reviewer_id], current_user, f"Risk review returned: {review.risk.title}",
                 f"{_name(current_user)} returned your review of {review.risk.title}: {notes}")
    else:
        if review.status not in WORKING:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail="This review is awaiting approval: approve it or return it to change it.")
        if new_status not in (None, "in_review", *SUBMIT):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail=f"Unknown review status: {new_status}")
        if "reviewer_id" in data:           # the old call changed the reviewer silently: it takes the reassign road now
            _reassign(db, review, data.pop("reviewer_id"), current_user)
        for key, value in data.items():
            setattr(review, key, value)
        if new_status:
            review.started_at = review.started_at or datetime.utcnow()
            # An unassigned review goes to whoever starts it; an assigned reviewer is never replaced.
            review.reviewer_id = review.reviewer_id or current_user.id
            review.status = "submitted" if new_status in SUBMIT else "in_review"
            if new_status in SUBMIT:
                review.submitted_by = current_user.id
                tell_approvers(db, review, review.risk, current_user)

    db.commit()
    db.refresh(review)
    return _out(review)


@router.post("/{review_id}/reassign", response_model=ReviewOut, dependencies=CAN_EDIT)
def reassign_review(review_id: int, body: ReassignIn, db: Session = Depends(get_db),
                    current_user: GRCUser = Depends(require_auth)):
    """Give a review not yet submitted to another reviewer (an approver does this; the reviewer cannot pass on their own)."""
    review = db.query(RiskReview).options(joinedload(RiskReview.risk)).join(Risk).filter(
        RiskReview.id == review_id, Risk.tenant_id.in_(get_user_tenants(current_user, db))).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found")
    _reassign(db, review, body.reviewer_id, current_user, body.note)
    db.commit()
    db.refresh(review)
    return _out(review)
