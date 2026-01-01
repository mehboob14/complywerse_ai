from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    Risk, RiskKRI, RiskKRIMeasurement, GRCUser, get_db
)
from ....schemas import (
    RiskKRICreate, RiskKRIUpdate, RiskKRIResponse,
    RiskKRIMeasurementCreate, RiskKRIMeasurementResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/kris", tags=["ERM - Key Risk Indicators"])


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


@router.get("", response_model=List[RiskKRIResponse])
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


@router.post("", response_model=RiskKRIResponse, status_code=status.HTTP_201_CREATED)
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


@router.get("/alerts", response_model=List[RiskKRIResponse])
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
        kri_status = calculate_kri_status(kri.current_value, kri)
        if kri_status in ["red", "amber"]:
            kri_data = RiskKRIResponse.model_validate(kri)
            kri_data.current_status = kri_status
            alerts.append(kri_data)
    
    return sorted(alerts, key=lambda x: 0 if x.current_status == "red" else 1)


@router.get("/{kri_id}", response_model=RiskKRIResponse)
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


@router.put("/{kri_id}", response_model=RiskKRIResponse)
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


@router.delete("/{kri_id}", response_model=MessageResponse)
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


@router.post("/{kri_id}/measure", response_model=RiskKRIMeasurementResponse)
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


@router.get("/{kri_id}/trend", response_model=List[RiskKRIMeasurementResponse])
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
