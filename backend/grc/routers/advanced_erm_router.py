from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_

from ..models import (
    Risk, RiskKRI, RiskKRIMeasurement, RiskIncident, RiskReview,
    RiskScoreHistory, RiskDependency, RiskAppetiteConfig, RiskReport,
    RiskControlLink, GRCUser, Tenant, BusinessUnit, get_db
)
from ..schemas import (
    RiskKRICreate, RiskKRIUpdate, RiskKRIResponse,
    RiskKRIMeasurementCreate, RiskKRIMeasurementResponse,
    RiskIncidentCreate, RiskIncidentUpdate, RiskIncidentResponse,
    RiskReviewCreate, RiskReviewUpdate, RiskReviewResponse,
    RiskScoreHistoryResponse,
    RiskDependencyCreate, RiskDependencyResponse,
    RiskAppetiteConfigCreate, RiskAppetiteConfigUpdate, RiskAppetiteConfigResponse,
    RiskReportCreate, RiskReportResponse,
    RiskTrendData, RiskTrendsResponse,
    AggregatedRiskView, ExecutiveDashboard, BoardReportData, DepartmentRiskSummary,
    ControlEffectivenessUpdate, MessageResponse
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission

router = APIRouter(
    prefix="/advanced-erm",
    tags=["Advanced ERM"],
    dependencies=[Depends(require_tenant_permission("erm:risks:view"))],
)


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


def calculate_kri_status(value: float, kri: RiskKRI) -> str:
    if kri.green_threshold is None or kri.amber_threshold is None:
        return "unknown"
    
    if kri.threshold_direction == "lower_is_better":
        if value <= kri.green_threshold:
            return "green"
        elif value <= kri.amber_threshold:
            return "amber"
        else:
            return "red"
    else:
        if value >= kri.green_threshold:
            return "green"
        elif value >= kri.amber_threshold:
            return "amber"
        else:
            return "red"


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


# =============================================================================
# KRI Endpoints
# =============================================================================

@router.get("/kris", response_model=List[RiskKRIResponse])
def list_kris(
    risk_id: Optional[int] = None,
    status_filter: Optional[str] = None,
    is_active: Optional[bool] = True,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskKRI).join(Risk).filter(Risk.tenant_id.in_(user_tenants))
    
    if risk_id:
        query = query.filter(RiskKRI.risk_id == risk_id)
    if is_active is not None:
        query = query.filter(RiskKRI.is_active == is_active)
    
    kris = query.offset(skip).limit(limit).all()
    
    result = []
    for kri in kris:
        kri_data = RiskKRIResponse.model_validate(kri)
        if kri.current_value is not None:
            kri_data.current_status = calculate_kri_status(kri.current_value, kri)
        result.append(kri_data)
    
    if status_filter:
        result = [k for k in result if k.current_status == status_filter]
    
    return result


@router.post("/kris", response_model=RiskKRIResponse, status_code=status.HTTP_201_CREATED)
def create_kri(
    kri: RiskKRICreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    risk = db.query(Risk).filter(
        Risk.id == kri.risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    db_kri = RiskKRI(
        risk_id=kri.risk_id,
        name=kri.name,
        description=kri.description,
        metric_type=kri.metric_type,
        unit=kri.unit,
        green_threshold=kri.green_threshold,
        amber_threshold=kri.amber_threshold,
        threshold_direction=kri.threshold_direction,
        frequency=kri.frequency,
        data_source=kri.data_source,
        owner_id=kri.owner_id
    )
    db.add(db_kri)
    db.commit()
    db.refresh(db_kri)
    return db_kri


@router.get("/kris/alerts", response_model=List[RiskKRIResponse])
def get_kri_alerts(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    kris = db.query(RiskKRI).join(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskKRI.is_active == True,
        RiskKRI.current_value.isnot(None)
    ).all()
    
    alerts = []
    for kri in kris:
        status = calculate_kri_status(kri.current_value, kri)
        if status in ["red", "amber"]:
            kri_data = RiskKRIResponse.model_validate(kri)
            kri_data.current_status = status
            alerts.append(kri_data)
    
    return sorted(alerts, key=lambda x: 0 if x.current_status == "red" else 1)


@router.get("/kris/{kri_id}", response_model=RiskKRIResponse)
def get_kri(
    kri_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    kri = db.query(RiskKRI).options(
        joinedload(RiskKRI.measurements)
    ).join(Risk).filter(
        RiskKRI.id == kri_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not kri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KRI not found"
        )
    
    kri_data = RiskKRIResponse.model_validate(kri)
    if kri.current_value is not None:
        kri_data.current_status = calculate_kri_status(kri.current_value, kri)
    return kri_data


@router.put("/kris/{kri_id}", response_model=RiskKRIResponse)
def update_kri(
    kri_id: int,
    kri_update: RiskKRIUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    kri = db.query(RiskKRI).join(Risk).filter(
        RiskKRI.id == kri_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not kri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KRI not found"
        )
    
    update_data = kri_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(kri, key, value)
    
    db.commit()
    db.refresh(kri)
    
    kri_data = RiskKRIResponse.model_validate(kri)
    if kri.current_value is not None:
        kri_data.current_status = calculate_kri_status(kri.current_value, kri)
    return kri_data


@router.delete("/kris/{kri_id}", response_model=MessageResponse)
def delete_kri(
    kri_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    kri = db.query(RiskKRI).join(Risk).filter(
        RiskKRI.id == kri_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not kri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KRI not found"
        )
    
    db.delete(kri)
    db.commit()
    return {"message": "KRI deleted successfully", "id": kri_id}


@router.post("/kris/{kri_id}/measure", response_model=RiskKRIMeasurementResponse)
def record_kri_measurement(
    kri_id: int,
    measurement: RiskKRIMeasurementCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    kri = db.query(RiskKRI).join(Risk).filter(
        RiskKRI.id == kri_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not kri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KRI not found"
        )
    
    status_val = calculate_kri_status(measurement.value, kri)
    
    db_measurement = RiskKRIMeasurement(
        kri_id=kri_id,
        value=measurement.value,
        status=status_val,
        measured_by=current_user.id,
        notes=measurement.notes
    )
    db.add(db_measurement)
    
    kri.current_value = measurement.value
    kri.last_measured_at = datetime.utcnow()
    
    db.commit()
    db.refresh(db_measurement)
    return db_measurement


@router.get("/kris/{kri_id}/trend", response_model=List[RiskKRIMeasurementResponse])
def get_kri_trend(
    kri_id: int,
    days: int = 365,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    kri = db.query(RiskKRI).join(Risk).filter(
        RiskKRI.id == kri_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not kri:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KRI not found"
        )
    
    start_date = datetime.utcnow() - timedelta(days=days)
    measurements = db.query(RiskKRIMeasurement).filter(
        RiskKRIMeasurement.kri_id == kri_id,
        RiskKRIMeasurement.measured_at >= start_date
    ).order_by(RiskKRIMeasurement.measured_at.asc()).all()
    
    return measurements


# =============================================================================
# Incident Endpoints
# =============================================================================

@router.get("/incidents", response_model=List[RiskIncidentResponse])
def list_incidents(
    risk_id: Optional[int] = None,
    severity: Optional[str] = None,
    status_filter: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskIncident).filter(RiskIncident.tenant_id.in_(user_tenants))
    
    if risk_id:
        query = query.filter(RiskIncident.risk_id == risk_id)
    if severity:
        query = query.filter(RiskIncident.severity == severity)
    if status_filter:
        query = query.filter(RiskIncident.status == status_filter)
    if start_date:
        query = query.filter(RiskIncident.incident_date >= start_date)
    if end_date:
        query = query.filter(RiskIncident.incident_date <= end_date)
    
    incidents = query.order_by(RiskIncident.incident_date.desc()).offset(skip).limit(limit).all()
    
    result = []
    for incident in incidents:
        incident_data = RiskIncidentResponse.model_validate(incident)
        if incident.risk:
            incident_data.risk_title = incident.risk.title
        result.append(incident_data)
    
    return result


@router.post("/incidents", response_model=RiskIncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    incident: RiskIncidentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    if incident.risk_id:
        risk = db.query(Risk).filter(
            Risk.id == incident.risk_id,
            Risk.tenant_id == tenant_id
        ).first()
        if not risk:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Risk not found"
            )
    
    db_incident = RiskIncident(
        tenant_id=tenant_id,
        risk_id=incident.risk_id,
        title=incident.title,
        description=incident.description,
        incident_date=incident.incident_date,
        severity=incident.severity,
        financial_impact=incident.financial_impact,
        operational_impact=incident.operational_impact,
        root_cause=incident.root_cause,
        corrective_actions=incident.corrective_actions,
        reported_by=current_user.id,
        assigned_to=incident.assigned_to
    )
    db.add(db_incident)
    db.commit()
    db.refresh(db_incident)
    return db_incident


@router.get("/incidents/dashboard")
def get_incident_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "total_incidents": 0,
            "by_severity": {},
            "by_status": {},
            "total_financial_impact": 0,
            "open_incidents": 0,
            "avg_resolution_time_days": 0,
            "recent_incidents": []
        }
    
    incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).all()
    
    by_severity = {}
    by_status = {}
    total_impact = 0
    resolution_times = []
    
    for inc in incidents:
        by_severity[inc.severity] = by_severity.get(inc.severity, 0) + 1
        by_status[inc.status] = by_status.get(inc.status, 0) + 1
        if inc.financial_impact:
            total_impact += inc.financial_impact
        if inc.resolved_at and inc.discovered_date:
            days = (inc.resolved_at - inc.discovered_date).days
            resolution_times.append(days)
    
    recent = db.query(RiskIncident).filter(
        RiskIncident.tenant_id.in_(user_tenants)
    ).order_by(RiskIncident.incident_date.desc()).limit(5).all()
    
    return {
        "total_incidents": len(incidents),
        "by_severity": by_severity,
        "by_status": by_status,
        "total_financial_impact": total_impact,
        "open_incidents": by_status.get("open", 0) + by_status.get("investigating", 0),
        "avg_resolution_time_days": round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0,
        "recent_incidents": [
            {"id": i.id, "title": i.title, "severity": i.severity, "status": i.status}
            for i in recent
        ]
    }


@router.get("/incidents/{incident_id}", response_model=RiskIncidentResponse)
def get_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).options(
        joinedload(RiskIncident.risk)
    ).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    incident_data = RiskIncidentResponse.model_validate(incident)
    if incident.risk:
        incident_data.risk_title = incident.risk.title
    return incident_data


@router.put("/incidents/{incident_id}", response_model=RiskIncidentResponse)
def update_incident(
    incident_id: int,
    incident_update: RiskIncidentUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    update_data = incident_update.model_dump(exclude_unset=True)
    
    if update_data.get("status") == "resolved" and not incident.resolved_at:
        update_data["resolved_at"] = datetime.utcnow()
    
    for key, value in update_data.items():
        setattr(incident, key, value)
    
    db.commit()
    db.refresh(incident)
    return incident


@router.delete("/incidents/{incident_id}", response_model=MessageResponse)
def delete_incident(
    incident_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    incident = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id,
        RiskIncident.tenant_id.in_(user_tenants)
    ).first()
    
    if not incident:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found"
        )
    
    db.delete(incident)
    db.commit()
    return {"message": "Incident deleted successfully", "id": incident_id}


# =============================================================================
# Review Workflow Endpoints
# =============================================================================

@router.get("/reviews", response_model=List[RiskReviewResponse])
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


@router.post("/reviews", response_model=RiskReviewResponse, status_code=status.HTTP_201_CREATED)
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


@router.post("/reviews/bulk-schedule", response_model=List[RiskReviewResponse])
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


@router.get("/reviews/pending", response_model=List[RiskReviewResponse])
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


@router.get("/reviews/overdue", response_model=List[RiskReviewResponse])
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


@router.get("/reviews/{review_id}", response_model=RiskReviewResponse)
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


@router.put("/reviews/{review_id}", response_model=RiskReviewResponse)
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


# =============================================================================
# Score History & Trends
# =============================================================================

@router.get("/history/{risk_id}", response_model=List[RiskScoreHistoryResponse])
def get_score_history(
    risk_id: int,
    days: int = 365,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    start_date = datetime.utcnow() - timedelta(days=days)
    history = db.query(RiskScoreHistory).filter(
        RiskScoreHistory.risk_id == risk_id,
        RiskScoreHistory.recorded_at >= start_date
    ).order_by(RiskScoreHistory.recorded_at.asc()).all()
    
    return history


@router.get("/trends", response_model=List[RiskTrendsResponse])
def get_trends(
    risk_ids: Optional[List[int]] = Query(None),
    category: Optional[str] = None,
    days: int = 180,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants))
    
    if risk_ids:
        query = query.filter(Risk.id.in_(risk_ids))
    if category:
        query = query.filter(or_(Risk.category == category, Risk.risk_category == category))
    
    risks = query.limit(50).all()
    
    start_date = datetime.utcnow() - timedelta(days=days)
    result = []
    
    for risk in risks:
        history = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= start_date
        ).order_by(RiskScoreHistory.recorded_at.asc()).all()
        
        trend_data = [
            RiskTrendData(
                date=h.recorded_at,
                inherent_score=h.inherent_score,
                residual_score=h.residual_score,
                status=h.status
            )
            for h in history
        ]
        
        current_score = risk.residual_score or risk.inherent_score or 0
        first_score = history[0].residual_score or history[0].inherent_score if history else current_score
        score_change = current_score - first_score if first_score else 0
        
        trend_direction = "stable"
        if score_change > 1:
            trend_direction = "increasing"
        elif score_change < -1:
            trend_direction = "decreasing"
        
        result.append(RiskTrendsResponse(
            risk_id=risk.id,
            risk_title=risk.title,
            trend_data=trend_data,
            score_change=round(score_change, 2),
            trend_direction=trend_direction
        ))
    
    return result


@router.get("/trends/summary")
def get_trends_summary(
    days: int = 90,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "period_days": days,
            "total_risks_tracked": 0,
            "avg_score_change": 0,
            "risks_improved": 0,
            "risks_worsened": 0,
            "risks_stable": 0,
            "category_trends": {}
        }
    
    risks = db.query(Risk).filter(Risk.tenant_id.in_(user_tenants)).all()
    start_date = datetime.utcnow() - timedelta(days=days)
    
    improved = 0
    worsened = 0
    stable = 0
    total_change = 0
    category_changes = {}
    
    for risk in risks:
        first_history = db.query(RiskScoreHistory).filter(
            RiskScoreHistory.risk_id == risk.id,
            RiskScoreHistory.recorded_at >= start_date
        ).order_by(RiskScoreHistory.recorded_at.asc()).first()
        
        if first_history:
            current = risk.residual_score or risk.inherent_score or 0
            initial = first_history.residual_score or first_history.inherent_score or 0
            change = current - initial
            total_change += change
            
            category = risk.risk_category or risk.category
            if category not in category_changes:
                category_changes[category] = {"total_change": 0, "count": 0}
            category_changes[category]["total_change"] += change
            category_changes[category]["count"] += 1
            
            if change < -1:
                improved += 1
            elif change > 1:
                worsened += 1
            else:
                stable += 1
    
    total_tracked = improved + worsened + stable
    
    return {
        "period_days": days,
        "total_risks_tracked": total_tracked,
        "avg_score_change": round(total_change / total_tracked, 2) if total_tracked else 0,
        "risks_improved": improved,
        "risks_worsened": worsened,
        "risks_stable": stable,
        "category_trends": {
            cat: {"avg_change": round(data["total_change"] / data["count"], 2), "count": data["count"]}
            for cat, data in category_changes.items()
        }
    }


# =============================================================================
# Dependencies
# =============================================================================

@router.get("/dependencies", response_model=List[RiskDependencyResponse])
def list_dependencies(
    source_risk_id: Optional[int] = None,
    target_risk_id: Optional[int] = None,
    dependency_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(RiskDependency).join(
        Risk, RiskDependency.source_risk_id == Risk.id
    ).filter(Risk.tenant_id.in_(user_tenants))
    
    if source_risk_id:
        query = query.filter(RiskDependency.source_risk_id == source_risk_id)
    if target_risk_id:
        query = query.filter(RiskDependency.target_risk_id == target_risk_id)
    if dependency_type:
        query = query.filter(RiskDependency.dependency_type == dependency_type)
    
    dependencies = query.all()
    
    result = []
    for dep in dependencies:
        dep_data = RiskDependencyResponse.model_validate(dep)
        if dep.source_risk:
            dep_data.source_risk_title = dep.source_risk.title
        if dep.target_risk:
            dep_data.target_risk_title = dep.target_risk.title
        result.append(dep_data)
    
    return result


@router.post("/dependencies", response_model=RiskDependencyResponse, status_code=status.HTTP_201_CREATED)
def create_dependency(
    source_risk_id: int,
    dependency: RiskDependencyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    source_risk = db.query(Risk).filter(
        Risk.id == source_risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not source_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source risk not found"
        )
    
    target_risk = db.query(Risk).filter(
        Risk.id == dependency.target_risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not target_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Target risk not found"
        )
    
    if source_risk_id == dependency.target_risk_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A risk cannot depend on itself"
        )
    
    existing = db.query(RiskDependency).filter(
        RiskDependency.source_risk_id == source_risk_id,
        RiskDependency.target_risk_id == dependency.target_risk_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dependency already exists"
        )
    
    db_dependency = RiskDependency(
        source_risk_id=source_risk_id,
        target_risk_id=dependency.target_risk_id,
        dependency_type=dependency.dependency_type,
        impact_factor=dependency.impact_factor,
        description=dependency.description
    )
    db.add(db_dependency)
    db.commit()
    db.refresh(db_dependency)
    
    dep_data = RiskDependencyResponse.model_validate(db_dependency)
    dep_data.source_risk_title = source_risk.title
    dep_data.target_risk_title = target_risk.title
    return dep_data


@router.delete("/dependencies/{dependency_id}", response_model=MessageResponse)
def delete_dependency(
    dependency_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    dependency = db.query(RiskDependency).join(
        Risk, RiskDependency.source_risk_id == Risk.id
    ).filter(
        RiskDependency.id == dependency_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not dependency:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dependency not found"
        )
    
    db.delete(dependency)
    db.commit()
    return {"message": "Dependency deleted successfully", "id": dependency_id}


@router.get("/dependencies/{risk_id}/cascade")
def get_cascade_impact(
    risk_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    source_risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not source_risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    def get_cascade(current_id: int, visited: set, depth: int = 0) -> List[dict]:
        if current_id in visited or depth > 10:
            return []
        visited.add(current_id)
        
        deps = db.query(RiskDependency).filter(
            RiskDependency.source_risk_id == current_id
        ).all()
        
        results = []
        for dep in deps:
            if dep.target_risk:
                cascade_score = (dep.target_risk.residual_score or dep.target_risk.inherent_score or 0) * dep.impact_factor
                results.append({
                    "risk_id": dep.target_risk_id,
                    "risk_title": dep.target_risk.title,
                    "dependency_type": dep.dependency_type,
                    "impact_factor": dep.impact_factor,
                    "cascade_score": round(cascade_score, 2),
                    "depth": depth + 1,
                    "downstream": get_cascade(dep.target_risk_id, visited, depth + 1)
                })
        return results
    
    cascade_analysis = {
        "source_risk_id": risk_id,
        "source_risk_title": source_risk.title,
        "source_score": source_risk.residual_score or source_risk.inherent_score,
        "cascade_impact": get_cascade(risk_id, set())
    }
    
    total_cascade_score = sum(
        item["cascade_score"] for item in cascade_analysis["cascade_impact"]
    )
    cascade_analysis["total_cascade_score"] = round(total_cascade_score, 2)
    
    return cascade_analysis


# =============================================================================
# Risk Appetite
# =============================================================================

@router.get("/appetite", response_model=List[RiskAppetiteConfigResponse])
def get_appetite_config(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    
    return configs


@router.put("/appetite/{category}", response_model=RiskAppetiteConfigResponse)
def update_appetite(
    category: str,
    appetite_update: RiskAppetiteConfigUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    config = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id,
        RiskAppetiteConfig.category == category
    ).first()
    
    if not config:
        config = RiskAppetiteConfig(
            tenant_id=tenant_id,
            category=category,
            appetite_level=appetite_update.appetite_level or "moderate",
            max_acceptable_score=appetite_update.max_acceptable_score or 12.0,
            description=appetite_update.description
        )
        db.add(config)
    else:
        update_data = appetite_update.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(config, key, value)
    
    db.commit()
    db.refresh(config)
    return config


@router.get("/appetite/breaches")
def get_appetite_breaches(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    
    config_map = {c.category: c for c in configs}
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    breaches = []
    for risk in risks:
        category = risk.risk_category or risk.category
        score = risk.residual_score or risk.inherent_score or 0
        
        config = config_map.get(category)
        if config and score > config.max_acceptable_score:
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": category,
                "current_score": score,
                "appetite_level": config.appetite_level,
                "max_acceptable_score": config.max_acceptable_score,
                "breach_amount": round(score - config.max_acceptable_score, 2)
            })
    
    breaches.sort(key=lambda x: x["breach_amount"], reverse=True)
    
    return {
        "total_breaches": len(breaches),
        "breaches": breaches
    }


# =============================================================================
# Control Effectiveness
# =============================================================================

@router.put("/controls/{link_id}/effectiveness", response_model=MessageResponse)
def update_control_effectiveness(
    link_id: int,
    effectiveness: ControlEffectivenessUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    link = db.query(RiskControlLink).join(Risk).filter(
        RiskControlLink.id == link_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control link not found"
        )
    
    link.effectiveness_rating = effectiveness.effectiveness_rating
    if effectiveness.notes:
        link.notes = effectiveness.notes
    
    db.commit()
    return {"message": "Control effectiveness updated", "id": link_id}


# =============================================================================
# Reporting & Governance
# =============================================================================

@router.get("/reports", response_model=List[RiskReportResponse])
def list_reports(
    report_type: Optional[str] = None,
    status_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    query = db.query(RiskReport).filter(RiskReport.tenant_id == tenant_id)
    
    if report_type:
        query = query.filter(RiskReport.report_type == report_type)
    if status_filter:
        query = query.filter(RiskReport.status == status_filter)
    
    reports = query.order_by(RiskReport.generated_at.desc()).offset(skip).limit(limit).all()
    return reports


@router.post("/reports/generate", response_model=RiskReportResponse, status_code=status.HTTP_201_CREATED)
def generate_report(
    report: RiskReportCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    by_score_band = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            by_score_band["critical"] += 1
        elif score >= 12:
            by_score_band["high"] += 1
        elif score >= 6:
            by_score_band["medium"] += 1
        else:
            by_score_band["low"] += 1
    
    report_data = {
        "generated_at": datetime.utcnow().isoformat(),
        "total_risks": len(risks),
        "by_category": by_category,
        "by_status": by_status,
        "by_score_band": by_score_band,
        "total_incidents": len(incidents),
        "open_incidents": sum(1 for i in incidents if i.status in ["open", "investigating"]),
        "top_risks": [
            {"id": r.id, "title": r.title, "score": r.residual_score or r.inherent_score}
            for r in sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:10]
        ]
    }
    
    db_report = RiskReport(
        tenant_id=tenant_id,
        report_type=report.report_type,
        title=report.title,
        description=report.description,
        report_period_start=report.report_period_start,
        report_period_end=report.report_period_end,
        generated_by=current_user.id,
        report_data=report_data,
        status="generated"
    )
    db.add(db_report)
    db.commit()
    db.refresh(db_report)
    return db_report


@router.get("/reports/executive-dashboard", response_model=ExecutiveDashboard)
def get_executive_dashboard(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    by_score_band = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            by_score_band["critical"] += 1
        elif score >= 12:
            by_score_band["high"] += 1
        elif score >= 6:
            by_score_band["medium"] += 1
        else:
            by_score_band["low"] += 1
    
    appetite_configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in appetite_configs}
    
    breaches = []
    for risk in risks:
        category = risk.risk_category or risk.category
        score = risk.residual_score or risk.inherent_score or 0
        config = config_map.get(category)
        if config and score > config.max_acceptable_score:
            breaches.append({
                "risk_id": risk.id,
                "risk_title": risk.title,
                "category": category,
                "score": score,
                "threshold": config.max_acceptable_score
            })
    
    top_risks = sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:10]
    
    recent_incidents = db.query(RiskIncident).filter(
        RiskIncident.tenant_id == tenant_id
    ).order_by(RiskIncident.incident_date.desc()).limit(5).all()
    
    kri_alerts = db.query(RiskKRI).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskKRI.is_active == True,
        RiskKRI.current_value.isnot(None)
    ).all()
    
    kri_alert_list = []
    for kri in kri_alerts:
        status = calculate_kri_status(kri.current_value, kri)
        if status in ["red", "amber"]:
            kri_alert_list.append({
                "kri_id": kri.id,
                "name": kri.name,
                "value": kri.current_value,
                "status": status
            })
    
    now = datetime.utcnow()
    pending_reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskReview.status.in_(["pending", "in_review"])
    ).count()
    
    overdue_reviews = db.query(RiskReview).join(Risk).filter(
        Risk.tenant_id == tenant_id,
        RiskReview.status.in_(["pending", "in_review"]),
        RiskReview.due_date < now
    ).count()
    
    return ExecutiveDashboard(
        total_risks=len(risks),
        risks_by_category=by_category,
        risks_by_status=by_status,
        risks_by_score_band=by_score_band,
        appetite_breaches=breaches,
        top_risks=[
            {"id": r.id, "title": r.title, "category": r.risk_category or r.category,
             "score": r.residual_score or r.inherent_score, "status": r.status}
            for r in top_risks
        ],
        recent_incidents=[
            {"id": i.id, "title": i.title, "severity": i.severity, "date": i.incident_date.isoformat()}
            for i in recent_incidents
        ],
        kri_alerts=kri_alert_list,
        pending_reviews=pending_reviews,
        overdue_reviews=overdue_reviews,
        trend_summary={
            "total_tracked": len(risks),
            "period": "90 days"
        }
    )


@router.get("/reports/board-summary", response_model=BoardReportData)
def get_board_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count_with_score = 0
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        if risk.inherent_score:
            total_inherent += risk.inherent_score
            count_with_score += 1
        if risk.residual_score:
            total_residual += risk.residual_score
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}
    
    appetite_status = []
    for cat, count in by_category.items():
        config = config_map.get(cat)
        cat_risks = [r for r in risks if (r.risk_category or r.category) == cat]
        breaching = sum(
            1 for r in cat_risks
            if config and (r.residual_score or r.inherent_score or 0) > config.max_acceptable_score
        )
        appetite_status.append({
            "category": cat,
            "total_risks": count,
            "breaching_appetite": breaching,
            "appetite_level": config.appetite_level if config else "undefined",
            "max_score": config.max_acceptable_score if config else None
        })
    
    top_risks = sorted(risks, key=lambda x: x.residual_score or x.inherent_score or 0, reverse=True)[:5]
    
    open_incidents = sum(1 for i in incidents if i.status in ["open", "investigating"])
    total_impact = sum(i.financial_impact or 0 for i in incidents)
    
    return BoardReportData(
        report_period=f"{datetime.utcnow().strftime('%B %Y')}",
        executive_summary=f"The organization currently manages {len(risks)} identified risks across {len(by_category)} categories. {by_status.get('open', 0)} risks remain open, with {len([r for r in risks if (r.residual_score or r.inherent_score or 0) >= 20])} rated as critical.",
        risk_overview={
            "total_risks": len(risks),
            "by_category": by_category,
            "by_status": by_status,
            "avg_inherent_score": round(total_inherent / count_with_score, 1) if count_with_score else 0,
            "avg_residual_score": round(total_residual / count_with_score, 1) if count_with_score else 0
        },
        appetite_status=appetite_status,
        top_risks=[
            {
                "id": r.id,
                "title": r.title,
                "category": r.risk_category or r.category,
                "score": r.residual_score or r.inherent_score,
                "status": r.status,
                "treatment_plan": r.treatment_plan
            }
            for r in top_risks
        ],
        key_changes=[],
        incidents_summary={
            "total_incidents": len(incidents),
            "open_incidents": open_incidents,
            "total_financial_impact": total_impact
        },
        recommendations=[
            "Review and update risk assessments for critical risks",
            "Address appetite breaches through enhanced controls",
            "Complete pending risk reviews before due dates"
        ]
    )


@router.get("/reports/department/{bu_id}", response_model=DepartmentRiskSummary)
def get_department_summary(
    bu_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    bu = db.query(BusinessUnit).filter(
        BusinessUnit.id == bu_id,
        BusinessUnit.tenant_id == tenant_id
    ).first()
    
    if not bu:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Business unit not found"
        )
    
    risks = db.query(Risk).filter(
        Risk.tenant_id == tenant_id,
        Risk.business_unit_id == bu_id
    ).all()
    
    by_category = {}
    by_status = {}
    total_inherent = 0
    total_residual = 0
    count = 0
    critical_risks = []
    
    configs = db.query(RiskAppetiteConfig).filter(
        RiskAppetiteConfig.tenant_id == tenant_id
    ).all()
    config_map = {c.category: c for c in configs}
    
    breaches = 0
    
    for risk in risks:
        cat = risk.risk_category or risk.category
        by_category[cat] = by_category.get(cat, 0) + 1
        by_status[risk.status] = by_status.get(risk.status, 0) + 1
        
        score = risk.residual_score or risk.inherent_score or 0
        if risk.inherent_score:
            total_inherent += risk.inherent_score
            count += 1
        if risk.residual_score:
            total_residual += risk.residual_score
        
        if score >= 20:
            critical_risks.append({
                "id": risk.id,
                "title": risk.title,
                "score": score,
                "status": risk.status
            })
        
        config = config_map.get(cat)
        if config and score > config.max_acceptable_score:
            breaches += 1
    
    return DepartmentRiskSummary(
        business_unit_id=bu_id,
        business_unit_name=bu.name,
        total_risks=len(risks),
        by_category=by_category,
        by_status=by_status,
        critical_risks=critical_risks,
        avg_inherent_score=round(total_inherent / count, 1) if count else 0,
        avg_residual_score=round(total_residual / count, 1) if count else 0,
        appetite_breaches=breaches
    )


@router.get("/reports/audit-export")
def get_audit_export(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    incidents = db.query(RiskIncident).filter(RiskIncident.tenant_id == tenant_id).all()
    reviews = db.query(RiskReview).join(Risk).filter(Risk.tenant_id == tenant_id).all()
    configs = db.query(RiskAppetiteConfig).filter(RiskAppetiteConfig.tenant_id == tenant_id).all()
    
    return {
        "export_date": datetime.utcnow().isoformat(),
        "tenant_id": tenant_id,
        "risks": [
            {
                "id": r.id,
                "title": r.title,
                "description": r.description,
                "category": r.risk_category or r.category,
                "status": r.status,
                "inherent_likelihood": r.inherent_likelihood,
                "inherent_impact": r.inherent_impact,
                "inherent_score": r.inherent_score,
                "residual_likelihood": r.residual_likelihood,
                "residual_impact": r.residual_impact,
                "residual_score": r.residual_score,
                "treatment_plan": r.treatment_plan,
                "owner_id": r.owner_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "updated_at": r.updated_at.isoformat() if r.updated_at else None
            }
            for r in risks
        ],
        "incidents": [
            {
                "id": i.id,
                "title": i.title,
                "risk_id": i.risk_id,
                "severity": i.severity,
                "status": i.status,
                "incident_date": i.incident_date.isoformat() if i.incident_date else None,
                "financial_impact": i.financial_impact,
                "root_cause": i.root_cause,
                "corrective_actions": i.corrective_actions
            }
            for i in incidents
        ],
        "reviews": [
            {
                "id": r.id,
                "risk_id": r.risk_id,
                "review_type": r.review_type,
                "status": r.status,
                "due_date": r.due_date.isoformat() if r.due_date else None,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "findings": r.findings
            }
            for r in reviews
        ],
        "appetite_config": [
            {
                "category": c.category,
                "appetite_level": c.appetite_level,
                "max_acceptable_score": c.max_acceptable_score
            }
            for c in configs
        ],
        "summary": {
            "total_risks": len(risks),
            "total_incidents": len(incidents),
            "total_reviews": len(reviews),
            "open_risks": sum(1 for r in risks if r.status == "open"),
            "open_incidents": sum(1 for i in incidents if i.status in ["open", "investigating"])
        }
    }


@router.get("/reports/{report_id}", response_model=RiskReportResponse)
def get_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    report = db.query(RiskReport).filter(
        RiskReport.id == report_id,
        RiskReport.tenant_id == tenant_id
    ).first()
    
    if not report:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found"
        )
    
    return report


@router.get("/aggregated", response_model=List[AggregatedRiskView])
def get_aggregated_views(
    group_by: str = Query("category", description="Group by: category, status, business_unit"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_tenant_id(current_user, db)
    
    risks = db.query(Risk).filter(Risk.tenant_id == tenant_id).all()
    
    groups = {}
    
    for risk in risks:
        if group_by == "category":
            key = risk.risk_category or risk.category or "uncategorized"
        elif group_by == "status":
            key = risk.status or "unknown"
        elif group_by == "business_unit":
            key = str(risk.business_unit_id) if risk.business_unit_id else "unassigned"
        else:
            key = "all"
        
        if key not in groups:
            groups[key] = {
                "risks": [],
                "critical": 0, "high": 0, "medium": 0, "low": 0,
                "open": 0, "in_treatment": 0, "mitigated": 0,
                "inherent_total": 0, "residual_total": 0, "count_with_score": 0
            }
        
        groups[key]["risks"].append(risk)
        
        score = risk.residual_score or risk.inherent_score or 0
        if score >= 20:
            groups[key]["critical"] += 1
        elif score >= 12:
            groups[key]["high"] += 1
        elif score >= 6:
            groups[key]["medium"] += 1
        else:
            groups[key]["low"] += 1
        
        if risk.status == "open":
            groups[key]["open"] += 1
        elif risk.status == "in_treatment":
            groups[key]["in_treatment"] += 1
        elif risk.status == "mitigated":
            groups[key]["mitigated"] += 1
        
        if risk.inherent_score:
            groups[key]["inherent_total"] += risk.inherent_score
            groups[key]["count_with_score"] += 1
        if risk.residual_score:
            groups[key]["residual_total"] += risk.residual_score
    
    result = []
    for key, data in groups.items():
        count = data["count_with_score"]
        result.append(AggregatedRiskView(
            group_by=group_by,
            group_value=key,
            total_risks=len(data["risks"]),
            critical_count=data["critical"],
            high_count=data["high"],
            medium_count=data["medium"],
            low_count=data["low"],
            avg_inherent_score=round(data["inherent_total"] / count, 2) if count else 0,
            avg_residual_score=round(data["residual_total"] / count, 2) if count else 0,
            open_count=data["open"],
            in_treatment_count=data["in_treatment"],
            mitigated_count=data["mitigated"]
        ))
    
    return sorted(result, key=lambda x: x.total_risks, reverse=True)
