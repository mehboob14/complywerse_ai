from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Risk, RiskIncident, GRCUser, get_db
)
from ....schemas import (
    RiskIncidentCreate, RiskIncidentUpdate, RiskIncidentResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/incidents", tags=["ERM - Incidents"])


def get_user_tenant_id(user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to any tenant"
        )
    return tenant_id


@router.get("", response_model=List[RiskIncidentResponse])
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


@router.post("", response_model=RiskIncidentResponse, status_code=status.HTTP_201_CREATED)
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


@router.get("/dashboard")
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


@router.get("/{incident_id}", response_model=RiskIncidentResponse)
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


@router.put("/{incident_id}", response_model=RiskIncidentResponse)
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


@router.delete("/{incident_id}", response_model=MessageResponse)
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
